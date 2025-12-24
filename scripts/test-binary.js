#!/usr/bin/env node
/**
 * Test a compiled Light Engine binary
 * Verifies binary runs correctly without errors
 */

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BINARIES_DIR = path.join(__dirname, '..', 'install-server', 'binaries');

// Get binary path from command line or default to linux-x64
const binaryName = process.argv[2] || 'lightengine-linux-x64';
const binaryPath = path.join(BINARIES_DIR, binaryName);

console.log('=========================================');
console.log('Light Engine Binary Test');
console.log('=========================================');
console.log(`Binary: ${binaryName}`);
console.log(`Path: ${binaryPath}`);
console.log('');

// Check if binary exists
const fs = await import('fs');
if (!fs.existsSync(binaryPath)) {
  console.error(`✗ Binary not found: ${binaryPath}`);
  console.error('');
  console.error('Available binaries:');
  if (fs.existsSync(BINARIES_DIR)) {
    const files = fs.readdirSync(BINARIES_DIR);
    files.filter(f => f.startsWith('lightengine-')).forEach(f => {
      console.error(`  - ${f}`);
    });
  } else {
    console.error('  (none - run npm run build:pkg first)');
  }
  process.exit(1);
}

console.log('Starting binary...');
console.log('(Will stop after 5 seconds)');
console.log('');

// Spawn binary with test environment
const proc = spawn(binaryPath, [], {
  env: {
    ...process.env,
    NODE_ENV: 'test',
    PORT: '8099',
    DEMO_MODE: 'true',
    DATABASE_URL: 'sqlite::memory:'
  },
  stdio: 'pipe'
});

let stdout = '';
let stderr = '';
let hasError = false;

proc.stdout.on('data', (data) => {
  const output = data.toString();
  stdout += output;
  process.stdout.write(output);
});

proc.stderr.on('data', (data) => {
  const output = data.toString();
  stderr += output;
  
  // Check for critical errors
  if (output.includes('Error') || output.includes('FATAL')) {
    hasError = true;
  }
  
  process.stderr.write(output);
});

proc.on('error', (error) => {
  console.error('');
  console.error(`✗ Failed to start binary: ${error.message}`);
  process.exit(1);
});

// Stop after 5 seconds
setTimeout(() => {
  proc.kill('SIGTERM');
  
  console.log('');
  console.log('=========================================');
  console.log('Test Results');
  console.log('=========================================');
  
  if (hasError) {
    console.log('Status: ✗ FAILED');
    console.log('Errors detected in stderr output');
  } else if (stdout.includes('Listening on port') || stdout.includes('Server started')) {
    console.log('Status: ✓ PASSED');
    console.log('Binary started successfully');
  } else {
    console.log('Status: ⚠ UNKNOWN');
    console.log('Binary may have issues - check output above');
  }
  
  console.log('');
  process.exit(hasError ? 1 : 0);
}, 5000);

// Handle user interrupt
process.on('SIGINT', () => {
  proc.kill('SIGTERM');
  console.log('');
  console.log('Test interrupted');
  process.exit(0);
});
