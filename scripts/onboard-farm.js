#!/usr/bin/env node
/**
 * Farm Onboarding Setup Script
 * Helps configure a new pilot farm in the system
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

console.log('═══════════════════════════════════════════════════════════════');
console.log('  GreenReach Wholesale - Farm Onboarding Setup');
console.log('═══════════════════════════════════════════════════════════════\n');

async function runOnboarding() {
  try {
    // Collect farm information
    console.log('Step 1: Farm Information\n');
    
    const farmName = await question('Farm Name: ');
    const farmId = await question('Farm ID (e.g., GR-00001): ');
    const contactName = await question('Primary Contact Name: ');
    const email = await question('Email Address: ');
    const phone = await question('Phone Number (for SMS): ');
    const address = await question('Farm Address: ');
    const city = await question('City: ');
    const province = await question('Province: ');
    const postalCode = await question('Postal Code: ');
    
    console.log('\nStep 2: API Configuration\n');
    
    const farmApiUrl = await question(`Farm API URL (default: http://localhost:8091): `) || 'http://localhost:8091';
    
    // Generate API key
    const apiKey = generateApiKey();
    console.log(`\nGenerated API Key: ${apiKey}`);
    console.log('⚠️  Save this key securely - it will be needed for API requests\n');
    
    console.log('Step 3: Notification Preferences\n');
    
    const smsEnabled = (await question('Enable SMS notifications? (y/n): ')).toLowerCase() === 'y';
    const emailEnabled = (await question('Enable email notifications? (y/n): ')).toLowerCase() === 'y';
    const pushEnabled = (await question('Enable push notifications? (y/n): ')).toLowerCase() === 'y';
    
    console.log('\nStep 4: Inventory Setup\n');
    
    const inventoryMethod = await question('Inventory update method (manual/api/realtime): ');
    const minOrderValue = await question('Minimum order value ($): ');
    
    console.log('\nStep 5: Logistics\n');
    
    const pickupAvailable = (await question('Offer farm pickup? (y/n): ')).toLowerCase() === 'y';
    const deliveryAvailable = (await question('Offer delivery? (y/n): ')).toLowerCase() === 'y';
    
    let deliveryRadius, deliveryFee;
    if (deliveryAvailable) {
      deliveryRadius = await question('Delivery radius (km): ');
      deliveryFee = await question('Delivery fee ($): ');
    }
    
    // Create farm configuration object
    const farmConfig = {
      farm_id: farmId,
      farm_name: farmName,
      contact_name: contactName,
      email,
      phone,
      address: {
        street: address,
        city,
        province,
        postal_code: postalCode
      },
      api: {
        api_url: farmApiUrl,
        api_key: apiKey
      },
      notifications: {
        sms_enabled: smsEnabled,
        email_enabled: emailEnabled,
        push_enabled: pushEnabled
      },
      inventory: {
        update_method: inventoryMethod,
        min_order_value: parseFloat(minOrderValue)
      },
      logistics: {
        pickup_available: pickupAvailable,
        delivery_available: deliveryAvailable,
        delivery_radius: deliveryAvailable ? parseInt(deliveryRadius) : null,
        delivery_fee: deliveryAvailable ? parseFloat(deliveryFee) : null
      },
      status: 'pilot',
      created_at: new Date().toISOString()
    };
    
    // Save to file
    const configDir = path.join(__dirname, '..', 'config', 'farms');
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    
    const configFile = path.join(configDir, `${farmId}.json`);
    fs.writeFileSync(configFile, JSON.stringify(farmConfig, null, 2));
    
    // Add to farm API keys file
    const apiKeysFile = path.join(__dirname, '..', 'public', 'data', 'farm-api-keys.json');
    let apiKeys = {};
    
    if (fs.existsSync(apiKeysFile)) {
      apiKeys = JSON.parse(fs.readFileSync(apiKeysFile, 'utf8'));
    }
    
    apiKeys[farmId] = {
      api_key: apiKey,
      farm_name: farmName,
      status: 'active',
      created_at: new Date().toISOString(),
      last_rotated: new Date().toISOString(),
      last_used: null
    };
    
    fs.writeFileSync(apiKeysFile, JSON.stringify(apiKeys, null, 2));
    
    // Generate onboarding checklist
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('  Farm Onboarding Complete!');
    console.log('═══════════════════════════════════════════════════════════════\n');
    
    console.log('✅ Farm Configuration Saved');
    console.log(`   Location: ${configFile}\n`);
    
    console.log('✅ API Key Generated and Saved');
    console.log(`   Farm ID: ${farmId}`);
    console.log(`   API Key: ${apiKey}\n`);
    
    console.log('📋 Next Steps for Farm:\n');
    console.log('1. Test Notifications:');
    console.log(`   npm run test:notifications\n`);
    
    console.log('2. Upload Initial Inventory:');
    console.log(`   Visit: ${farmApiUrl}/wholesale-catalog.html\n`);
    
    console.log('3. Configure Notification Settings:');
    console.log(`   Visit: ${farmApiUrl}/notification-settings.html\n`);
    
    console.log('4. Review Onboarding Guide:');
    console.log('   Open: FARM_ONBOARDING_GUIDE.md\n');
    
    console.log('5. Schedule Training Call:');
    console.log('   Email: ops@urbanyeild.ca\n');
    
    console.log('⚠️  Important:');
    console.log(`   - Share API key securely with farm: ${apiKey}`);
    console.log(`   - Add farm to pilot Slack channel`);
    console.log(`   - Send welcome email with login credentials`);
    console.log(`   - Schedule 30-minute onboarding call\n`);
    
    // Generate email template
    console.log('📧 Welcome Email Template:\n');
    console.log('─────────────────────────────────────────────────────────────');
    console.log(`Subject: Welcome to GreenReach Wholesale Pilot - ${farmName}\n`);
    console.log(`Hi ${contactName},\n`);
    console.log(`Welcome to the GreenReach Wholesale pilot program! We're excited to have ${farmName} join our network.\n`);
    console.log(`Your farm is now set up in our system:\n`);
    console.log(`Farm ID: ${farmId}`);
    console.log(`API Key: ${apiKey}`);
    console.log(`Farm Portal: ${farmApiUrl}\n`);
    console.log(`Next steps:`);
    console.log(`1. Review the Farm Onboarding Guide (attached)`);
    console.log(`2. Test your notifications`);
    console.log(`3. Upload your initial product catalog`);
    console.log(`4. Join our Slack channel: #greenreach-pilot`);
    console.log(`5. Schedule your onboarding call: [calendar link]\n`);
    console.log(`Questions? Reply to this email or call +1-709-398-3166.\n`);
    console.log(`Cheers,`);
    console.log(`The GreenReach Team`);
    console.log('─────────────────────────────────────────────────────────────\n');
    
    rl.close();
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Onboarding failed:', error);
    rl.close();
    process.exit(1);
  }
}

function generateApiKey() {
  const crypto = await import('crypto');
  return crypto.randomBytes(32).toString('hex');
}

runOnboarding();
