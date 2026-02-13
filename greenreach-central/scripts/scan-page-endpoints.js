import fs from 'fs';
import path from 'path';

const base = process.env.BASE || 'http://127.0.0.1:3100';
const root = process.cwd();
const dirs = [
  path.join(root, 'public', 'views'),
  path.join(root, 'public')
];

function listHtmlFiles(dir, includeRootOnly = false) {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isFile() && e.name.endsWith('.html')) files.push(full);
    if (!includeRootOnly && e.isDirectory()) {
      files.push(...listHtmlFiles(full, false));
    }
  }
  return files;
}

function extractEndpoints(content) {
  const endpoints = new Set();
  const patterns = [
    /fetch\(\s*['"]([^'"]+)['"]/g,
    /fetch\(\s*`([^`$]+)`/g,
    /axios\.(?:get|post|put|delete)\(\s*['"]([^'"]+)['"]/g
  ];

  for (const re of patterns) {
    let m;
    while ((m = re.exec(content)) !== null) {
      const endpoint = m[1];
      if (!endpoint) continue;
      if (!endpoint.startsWith('/')) continue;
      if (endpoint.includes('${')) continue;
      endpoints.add(endpoint);
    }
  }

  return [...endpoints];
}

async function checkEndpoint(url) {
  try {
    const res = await fetch(url, { method: 'GET' });
    return { status: res.status, ok: res.ok };
  } catch (error) {
    return { status: 'ERR', ok: false, error: error.message };
  }
}

async function main() {
  const files = [
    ...listHtmlFiles(dirs[0], false),
    ...listHtmlFiles(dirs[1], true)
  ];

  const failures = [];

  for (const file of files) {
    const rel = path.relative(root, file).replaceAll('\\', '/');
    const content = fs.readFileSync(file, 'utf8');
    const endpoints = extractEndpoints(content);
    if (endpoints.length === 0) continue;

    for (const ep of endpoints) {
      const url = `${base}${ep}`;
      const result = await checkEndpoint(url);
      if (result.status === 'ERR' || result.status >= 400) {
        failures.push({ file: rel, endpoint: ep, status: result.status, error: result.error || '' });
      }
    }
  }

  if (failures.length === 0) {
    console.log('✅ No failing static endpoints detected');
    return;
  }

  console.log('❌ Failing endpoints:');
  for (const f of failures) {
    console.log(`${f.file} | ${f.endpoint} | ${f.status}${f.error ? ` | ${f.error}` : ''}`);
  }

  const grouped = new Map();
  for (const f of failures) {
    if (!grouped.has(f.file)) grouped.set(f.file, []);
    grouped.get(f.file).push(f);
  }

  console.log('\n=== By page ===');
  for (const [file, items] of grouped.entries()) {
    console.log(`${file} -> ${items.length} failures`);
  }

  process.exitCode = 1;
}

main();
