const fs = require('fs');
const path = require('path');

function readIfExists(fp) {
  try {
    return fs.readFileSync(fp, 'utf8');
  } catch {
    return null;
  }
}

function firstMatch(html, re) {
  const match = html.match(re);
  return match ? match[1].replace(/\s+/g, ' ').trim() : null;
}

function extract(html) {
  const title = firstMatch(html, /<title>\s*([\s\S]*?)\s*<\/title>/i);
  const metaDesc =
    firstMatch(html, /<meta\s+name=["']description["']\s+content=["']([^"']+)["'][^>]*>/i) ||
    firstMatch(html, /<meta\s+content=["']([^"']+)["']\s+name=["']description["'][^>]*>/i);
  const h1 = firstMatch(html, /<h1[^>]*>\s*([\s\S]*?)\s*<\/h1>/i);

  const hasAuthGuard = /auth-guard\.js/.test(html);
  const hasSquare = /square\.js/.test(html) || /web\.squarecdn\.com/.test(html);
  const hasAiAgent = /ai-agent/i.test(html);

  return { title, metaDesc, h1, hasAuthGuard, hasSquare, hasAiAgent };
}

function listHtml(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith('.html'))
    .map((d) => path.join(dir, d.name))
    .sort((a, b) => a.localeCompare(b));
}

function toRel(root, fp) {
  return fp.replace(root + path.sep, '').split(path.sep).join('/');
}

function main() {
  const root = process.cwd();

  const pages = [];

  for (const fp of listHtml(path.join(root, 'public'))) {
    const html = readIfExists(fp);
    if (!html) continue;
    pages.push({ path: toRel(root, fp), section: 'public', ...extract(html) });
  }

  for (const fp of listHtml(path.join(root, 'public', 'views'))) {
    const html = readIfExists(fp);
    if (!html) continue;
    pages.push({ path: toRel(root, fp), section: 'public/views', ...extract(html) });
  }

  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'docs', 'page-metadata.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), pages }, null, 2)
  );

  process.stdout.write(`WROTE docs/page-metadata.json pages=${pages.length}\n`);
}

main();
