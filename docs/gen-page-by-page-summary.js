const fs = require('fs');
const path = require('path');

function loadJson(fp) {
  return JSON.parse(fs.readFileSync(fp, 'utf8'));
}

function link(relPath) {
  // summary lives in docs/, so link up one level
  return `[${relPath}](../${relPath})`;
}

function q(s) {
  return s ? `“${String(s).replace(/\s+/g, ' ').trim()}”` : null;
}

function pageLine(p) {
  const bits = [];
  if (p.h1) bits.push(`H1: ${q(p.h1)}`);
  if (p.metaDesc) bits.push(`Meta: ${q(p.metaDesc)}`);

  const flags = [];
  if (p.hasAuthGuard) flags.push('auth');
  if (p.hasSquare) flags.push('square');
  if (p.hasAiAgent) flags.push('ai');
  if (flags.length) bits.push(`Signals: ${flags.join(', ')}`);

  const suffix = bits.length ? ` — ${bits.join(' · ')}` : '';
  return `- ${link(p.path)} — ${p.title || 'NO_TITLE'}${suffix}`;
}

function main() {
  const root = process.cwd();
  const meta = loadJson(path.join(root, 'docs', 'page-metadata.json'));
  const pages = meta.pages || [];

  const views = pages.filter((p) => p.section === 'public/views').sort((a, b) => a.path.localeCompare(b.path));
  const top = pages.filter((p) => p.section === 'public').sort((a, b) => a.path.localeCompare(b.path));

  const out = [];
  out.push('# Light Engine — Page-by-Page Summary');
  out.push('');
  out.push(`Generated: ${meta.generatedAt}`);
  out.push('');
  out.push('This summary is derived from each page’s `<title>`, first `<h1>`, optional meta description, and a few in-page script signals.');
  out.push('');

  out.push('## Operational Views (public/views)');
  out.push('');
  for (const p of views) out.push(pageLine(p));
  out.push('');

  out.push('## Top-Level Pages (public/)');
  out.push('');
  for (const p of top) out.push(pageLine(p));
  out.push('');

  fs.writeFileSync(path.join(root, 'docs', 'PAGE_BY_PAGE_SUMMARY.md'), out.join('\n'));
  process.stdout.write(`WROTE docs/PAGE_BY_PAGE_SUMMARY.md pages=${pages.length}\n`);
}

main();
