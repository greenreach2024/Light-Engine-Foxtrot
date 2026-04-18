import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

const testsDir = path.resolve('tests');
const excludedFiles = new Set(['acceptance.test.mjs']);

const entries = await readdir(testsDir, { withFileTypes: true });
const testFiles = entries
  .filter((entry) => entry.isFile())
  .map((entry) => entry.name)
  .filter((name) => name.endsWith('.mjs'))
  .filter((name) => !excludedFiles.has(name))
  .sort()
  .map((name) => path.join('tests', name));

if (testFiles.length === 0) {
  console.error('No node test files found in tests/.');
  process.exit(1);
}

const args = [
  '--test',
  '--test-concurrency=1',
  '--test-timeout=20000',
  '--test-force-exit',
  ...testFiles,
];

const child = spawn(process.execPath, args, {
  stdio: 'inherit',
  env: process.env,
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});