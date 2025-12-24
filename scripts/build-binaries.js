#!/usr/bin/env node
/**
 * Build Light Engine binaries for edge devices using pkg
 * Creates platform-specific executables with embedded Node.js runtime
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'install-server', 'binaries');

// Ensure output directory exists
if (!fs.existsSync(DIST_DIR)) {
  fs.mkdirSync(DIST_DIR, { recursive: true });
}

console.log('=========================================');
console.log('Light Engine Binary Builder');
console.log('=========================================');
console.log(`Output directory: ${DIST_DIR}`);
console.log('');

// Platforms to build for
const platforms = [
  { name: 'linux-x64', target: 'node18-linux-x64' },
  { name: 'linux-arm64', target: 'node18-linux-arm64' }
];

// Build each platform
for (const platform of platforms) {
  console.log(`Building for ${platform.name}...`);
  
  const outputPath = path.join(DIST_DIR, `lightengine-${platform.name}`);
  
  try {
    // Run pkg to create binary
    const pkgCmd = `npx pkg server-foxtrot.js ` +
      `--target ${platform.target} ` +
      `--output ${outputPath} ` +
      `--compress Brotli ` +
      `--options expose-gc`;
    
    console.log(`  Command: ${pkgCmd}`);
    execSync(pkgCmd, {
      cwd: ROOT_DIR,
      stdio: 'inherit'
    });
    
    // Generate SHA-256 checksum
    console.log(`  Generating checksum...`);
    const fileBuffer = fs.readFileSync(outputPath);
    const hash = crypto.createHash('sha256');
    hash.update(fileBuffer);
    const checksum = hash.digest('hex');
    
    // Save checksum file
    const checksumPath = `${outputPath}.sha256`;
    fs.writeFileSync(checksumPath, `${checksum}  lightengine-${platform.name}\n`);
    
    // Get file size
    const stats = fs.statSync(outputPath);
    const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
    
    console.log(`  ✓ Built: ${platform.name}`);
    console.log(`  Size: ${sizeMB} MB`);
    console.log(`  Checksum: ${checksum}`);
    console.log('');
    
  } catch (error) {
    console.error(`  ✗ Failed to build ${platform.name}:`, error.message);
    process.exit(1);
  }
}

console.log('=========================================');
console.log('Build Complete!');
console.log('=========================================');
console.log('');
console.log('Binaries created:');
platforms.forEach(p => {
  const outputPath = path.join(DIST_DIR, `lightengine-${p.name}`);
  if (fs.existsSync(outputPath)) {
    const stats = fs.statSync(outputPath);
    console.log(`  ✓ ${p.name} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
  }
});
console.log('');
console.log('Next steps:');
console.log('  1. Test binaries on target systems');
console.log('  2. Start installation server: cd install-server && npm start');
console.log('  3. Deploy to install.greenreach.io');
console.log('  4. Test one-line installer: curl -sSL https://install.greenreach.io | bash');
console.log('');
