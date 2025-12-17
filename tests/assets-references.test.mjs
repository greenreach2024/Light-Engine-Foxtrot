import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function loadIndexHtml() {
  const indexPath = path.join(__dirname, '..', 'public', 'index.html');
  return readFile(indexPath, 'utf8');
}

test('public/index.html references include core Charlie assets', async () => {
  const html = await loadIndexHtml();

  const scriptMatches = Array.from(html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)).map((match) => match[1]);
  const linkMatches = Array.from(html.matchAll(/<link\b[^>]*\bhref="([^"]+)"/g)).map((match) => match[1]);

  // Normalize to strip query strings and leading ./
  const norm = (p) => String(p).replace(/^\.\//, '').split('?')[0];
  const scripts = scriptMatches.map(norm);
  const links = linkMatches.map(norm);

  assert.ok(scripts.includes('app.charlie.js'), 'index.html must include app.charlie.js');
  assert.ok(links.includes('styles.charlie.css'), 'index.html must include styles.charlie.css');
});
