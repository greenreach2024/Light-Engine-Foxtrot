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
  const endpoints = new Map();

  const fetchWithOptions = /fetch\(\s*['"]([^'"]+)['"]\s*,\s*\{([\s\S]*?)\}\s*\)/g;
  let m;
  while ((m = fetchWithOptions.exec(content)) !== null) {
    const endpoint = m[1];
    const options = m[2] || '';
    if (!endpoint || !endpoint.startsWith('/') || endpoint.includes('${')) continue;
    const methodMatch = options.match(/method\s*:\s*['"](GET|POST|PUT|PATCH|DELETE)['"]/i);
    const method = methodMatch ? methodMatch[1].toUpperCase() : 'GET';
    endpoints.set(`${method} ${endpoint}`, { endpoint, method });
  }

  const fetchSimple = /fetch\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m = fetchSimple.exec(content)) !== null) {
    const endpoint = m[1];
    if (!endpoint || !endpoint.startsWith('/') || endpoint.includes('${')) continue;
    const key = `GET ${endpoint}`;
    if (!endpoints.has(key)) endpoints.set(key, { endpoint, method: 'GET' });
  }

  const axiosCalls = /axios\.(get|post|put|patch|delete)\(\s*['"]([^'"]+)['"]/g;
  while ((m = axiosCalls.exec(content)) !== null) {
    const method = m[1].toUpperCase();
    const endpoint = m[2];
    if (!endpoint || !endpoint.startsWith('/') || endpoint.includes('${')) continue;
    endpoints.set(`${method} ${endpoint}`, { endpoint, method });
  }

  return [...endpoints.values()];
}

async function checkEndpoint(url, method = 'GET') {
  try {
    const opts = { method };
    if (method !== 'GET') {
      opts.headers = { 'Content-Type': 'application/json' };
      opts.body = '{}';
    }
    const res = await fetch(url, opts);
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
      const url = `${base}${ep.endpoint}`;
      const result = await checkEndpoint(url, ep.method);
      if (result.status === 'ERR' || result.status >= 400) {
        failures.push({ file: rel, endpoint: ep.endpoint, method: ep.method, status: result.status, error: result.error || '' });
      }
    }
  }

  if (failures.length === 0) {
    console.log('✅ No failing static endpoints detected');
    return;
  }

  console.log('❌ Failing endpoints:');
  for (const f of failures) {
    console.log(`${f.file} | ${f.method} ${f.endpoint} | ${f.status}${f.error ? ` | ${f.error}` : ''}`);
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
