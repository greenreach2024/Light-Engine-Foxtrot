import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function loadHtml(relativePath) {
  const fullPath = path.join(__dirname, '..', relativePath);
  return readFile(fullPath, 'utf8');
}

test('primary app pages contain expected script/style references', async () => {
  const loginHtml = await loadHtml(path.join('public', 'login.html'));
  const dashboardHtml = await loadHtml(path.join('public', 'LE-dashboard.html'));

  const scriptMatches = Array.from(dashboardHtml.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)).map((match) => match[1]);
  const linkMatches = Array.from(loginHtml.matchAll(/<link\b[^>]*\bhref="([^"]+)"/g)).map((match) => match[1]);
  const inlineStyleBlocks = Array.from(loginHtml.matchAll(/<style\b[^>]*>[\s\S]*?<\/style>/g));

  // Normalize to strip query strings and leading ./
  const norm = (p) => String(p).replace(/^\.\//, '').split('?')[0];
  const scripts = scriptMatches.map(norm);
  const links = linkMatches.map(norm);

  assert.ok(scripts.length > 0, 'LE-dashboard.html should include at least one script asset');
  assert.ok(links.length > 0 || inlineStyleBlocks.length > 0, 'login.html should include stylesheet assets or inline styles');
});
