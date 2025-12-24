#!/usr/bin/env node
/**
 * Generate demo license for testing
 * 
 * Usage: node scripts/generate-demo-license.js [farmId] [tier]
 * 
 * Example:
 *   node scripts/generate-demo-license.js DEMO-001 full
 *   node scripts/generate-demo-license.js BUTTERHEAD-001 inventory-only
 */

import crypto from 'crypto';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateFingerprint } from '../lib/license-manager.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const privateKeyPath = path.join(__dirname, '..', 'config', 'greenreach-private.pem');
const outputPath = path.join(__dirname, '..', 'config', 'demo-license.json');

const farmId = process.argv[2] || 'DEMO-001';
const tier = process.argv[3] || 'full';

const TIERS = {
  'inventory-only': {
    features: ['inventory', 'scheduling', 'wholesale', 'reporting'],
    name: 'Inventory Only',
  },
  'full': {
    features: ['inventory', 'scheduling', 'wholesale', 'reporting', 'automation', 'climate_control', 'sensors'],
    name: 'Full Control',
  },
  'enterprise': {
    features: ['*'], // All features
    name: 'Enterprise',
  },
};

async function generateLicense() {
  console.log(`🎫 Generating demo license...\n`);
  console.log(`   Farm ID: ${farmId}`);
  console.log(`   Tier: ${tier}\n`);

  // Check if private key exists
  if (!existsSync(privateKeyPath)) {
    console.error('❌ Private key not found!');
    console.error(`   Expected: ${privateKeyPath}`);
    console.error('\n   Run: node scripts/generate-license-keys.js first\n');
    process.exit(1);
  }

  // Validate tier
  if (!TIERS[tier]) {
    console.error(`❌ Invalid tier: ${tier}`);
    console.error(`   Valid tiers: ${Object.keys(TIERS).join(', ')}\n`);
    process.exit(1);
  }

  // Generate hardware fingerprint
  const fingerprint = await generateFingerprint();

  // Create license data
  const licenseData = {
    licenseId: `LIC-${Date.now()}`,
    farmId,
    farmName: `Demo Farm ${farmId}`,
    tier,
    features: TIERS[tier].features,
    fingerprint,
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(), // 1 year
    version: '1.0.0',
  };

  // Load private key
  const privateKey = await fs.readFile(privateKeyPath, 'utf-8');

  // Sign license
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(JSON.stringify(licenseData));
  const signature = signer.sign(privateKey, 'base64');

  // Create license object
  const license = {
    data: licenseData,
    signature,
    lastValidated: new Date().toISOString(),
  };

  // Write license file
  await fs.writeFile(outputPath, JSON.stringify(license, null, 2), 'utf-8');

  console.log('✅ Demo license generated successfully!\n');
  console.log(`📁 License file: ${outputPath}\n`);
  console.log('📋 License Details:');
  console.log(`   License ID: ${licenseData.licenseId}`);
  console.log(`   Farm ID: ${licenseData.farmId}`);
  console.log(`   Tier: ${tier} (${TIERS[tier].name})`);
  console.log(`   Features: ${licenseData.features.join(', ')}`);
  console.log(`   Issued: ${licenseData.issuedAt}`);
  console.log(`   Expires: ${licenseData.expiresAt}`);
  console.log(`   Fingerprint: ${fingerprint.substring(0, 16)}...`);
  console.log(`   Signature: ${signature.substring(0, 32)}...\n`);

  console.log('🧪 Test the license:');
  console.log(`   LICENSE_PATH=${outputPath} npm start\n`);
}

generateLicense().catch(err => {
  console.error('❌ Failed to generate license:', err.message);
  process.exit(1);
});
