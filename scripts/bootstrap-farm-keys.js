#!/usr/bin/env node

/**
 * Bootstrap Farm API Keys for Wholesale Integration
 * Generates initial API keys for demo/test farms
 * Run once during setup: node scripts/bootstrap-farm-keys.js
 */

import { generateApiKey } from '../lib/wholesale-auth.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('🔐 Light Engine: Farm API Key Bootstrap\n');

// Demo Farm Configuration
const DEMO_FARM = {
  farm_id: 'light-engine-demo',
  farm_name: 'Light Engine Demo Farm'
};

// Check if API keys already exist
const API_KEYS_FILE = path.join(__dirname, '..', 'public', 'data', 'farm-api-keys.json');

if (fs.existsSync(API_KEYS_FILE)) {
  console.log('⚠️  API keys file already exists');
  console.log(`   Location: ${API_KEYS_FILE}`);
  console.log('\n📋 Current registered farms:');
  
  const keysData = JSON.parse(fs.readFileSync(API_KEYS_FILE, 'utf8'));
  const farms = Object.entries(keysData);
  
  if (farms.length === 0) {
    console.log('   (none)');
  } else {
    farms.forEach(([farmId, data]) => {
      console.log(`   ✓ ${farmId}: ${data.farm_name} (${data.status})`);
    });
  }
  
  console.log('\n❓ Generate demo farm key anyway? (y/n)');
  
  // Read from stdin
  process.stdin.once('data', (data) => {
    const answer = data.toString().trim().toLowerCase();
    if (answer === 'y' || answer === 'yes') {
      generateDemoFarm();
    } else {
      console.log('❌ Cancelled');
      process.exit(0);
    }
  });
} else {
  console.log('📁 API keys file does not exist - will create');
  generateDemoFarm();
}

function generateDemoFarm() {
  try {
    console.log('\n🔑 Generating API key for demo farm...');
    console.log(`   Farm ID: ${DEMO_FARM.farm_id}`);
    console.log(`   Farm Name: ${DEMO_FARM.farm_name}`);
    
    const apiKey = generateApiKey(DEMO_FARM.farm_id, DEMO_FARM.farm_name);
    
    console.log('\n✅ API key generated successfully!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔐 IMPORTANT: Save these credentials securely');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`\nFarm ID:   ${DEMO_FARM.farm_id}`);
    console.log(`API Key:   ${apiKey}`);
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    console.log('\n📝 Usage in API requests:');
    console.log('   Headers:');
    console.log(`     X-Farm-ID: ${DEMO_FARM.farm_id}`);
    console.log(`     X-API-Key: ${apiKey}`);
    
    console.log('\n🧪 Test with curl:');
    console.log(`   curl -X POST http://localhost:8091/api/wholesale/inventory/reserve \\`);
    console.log(`     -H "X-Farm-ID: ${DEMO_FARM.farm_id}" \\`);
    console.log(`     -H "X-API-Key: ${apiKey}" \\`);
    console.log(`     -H "Content-Type: application/json" \\`);
    console.log(`     -d '{"order_id":"TEST-001","items":[{"sku_id":"basil-sweet","quantity":10}]}'`);
    
    console.log('\n✨ Next steps:');
    console.log('   1. Configure GreenReach Central to use these credentials');
    console.log('   2. Update farm registration flow to auto-generate keys');
    console.log('   3. Test wholesale order flow end-to-end');
    console.log('   4. Implement admin authentication (Task #14)');
    
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error generating API key:', error.message);
    process.exit(1);
  }
}
