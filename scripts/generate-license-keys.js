#!/usr/bin/env node
/**
 * Generate RSA key pair for Light Engine licensing
 * 
 * Usage: node scripts/generate-license-keys.js
 * 
 * Generates:
 * - config/greenreach-private.pem (KEEP SECRET - for signing licenses)
 * - config/greenreach-public.pem (embed in app - for validation)
 */

import crypto from 'crypto';
import fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configDir = path.join(__dirname, '..', 'config');
const privateKeyPath = path.join(configDir, 'greenreach-private.pem');
const publicKeyPath = path.join(configDir, 'greenreach-public.pem');

async function generateKeys() {
  console.log('🔐 Generating RSA-2048 key pair for Light Engine licensing...\n');

  // Ensure config directory exists
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }

  // Check if keys already exist
  if (existsSync(privateKeyPath) || existsSync(publicKeyPath)) {
    console.error('❌ Keys already exist!');
    console.error('   Private:', privateKeyPath);
    console.error('   Public:', publicKeyPath);
    console.error('\n⚠️  Delete existing keys first if you want to regenerate.');
    console.error('⚠️  WARNING: Regenerating will invalidate all existing licenses!\n');
    process.exit(1);
  }

  // Generate RSA key pair
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: {
      type: 'spki',
      format: 'pem',
    },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'pem',
    },
  });

  // Write keys to files
  await fs.writeFile(privateKeyPath, privateKey, { mode: 0o600 });
  await fs.writeFile(publicKeyPath, publicKey, { mode: 0o644 });

  console.log('✅ RSA key pair generated successfully!\n');
  console.log('📁 Private Key (KEEP SECRET):');
  console.log(`   ${privateKeyPath}`);
  console.log('   - Use this to SIGN licenses on GreenReach servers');
  console.log('   - NEVER commit this to git');
  console.log('   - Store securely (AWS Secrets Manager, etc.)\n');

  console.log('📁 Public Key (embed in app):');
  console.log(`   ${publicKeyPath}`);
  console.log('   - Use this to VALIDATE licenses on edge devices');
  console.log('   - Safe to commit to git');
  console.log('   - Will be bundled with the app\n');

  console.log('🔒 Permissions:');
  console.log('   Private key: 0600 (owner read/write only)');
  console.log('   Public key: 0644 (world readable)\n');

  console.log('📝 Next steps:');
  console.log('   1. Add config/greenreach-private.pem to .gitignore');
  console.log('   2. Store private key in secure location');
  console.log('   3. Use scripts/generate-demo-license.js to create test licenses');
  console.log('   4. Deploy public key with edge device builds\n');
}

generateKeys().catch(err => {
  console.error('❌ Failed to generate keys:', err.message);
  process.exit(1);
});
