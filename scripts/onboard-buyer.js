#!/usr/bin/env node
/**
 * Buyer Onboarding Setup Script
 * Creates buyer account and sets up payment method
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';
import crypto from 'crypto';

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
console.log('  GreenReach Wholesale - Buyer Onboarding Setup');
console.log('═══════════════════════════════════════════════════════════════\n');

async function runOnboarding() {
  try {
    // Collect buyer information
    console.log('Step 1: Buyer Information\n');
    
    const buyerType = await question('Buyer Type (restaurant/cafe/catering/retail/individual): ');
    const businessName = await question('Business/Name: ');
    const contactName = await question('Primary Contact Name: ');
    const email = await question('Email Address: ');
    const phone = await question('Phone Number: ');
    
    console.log('\nStep 2: Delivery Information\n');
    
    const deliveryAddress = await question('Delivery Street Address: ');
    const deliveryCity = await question('City: ');
    const deliveryProvince = await question('Province: ');
    const deliveryPostalCode = await question('Postal Code: ');
    const deliveryInstructions = await question('Special Delivery Instructions (optional): ');
    
    console.log('\nStep 3: Ordering Preferences\n');
    
    const orderFrequency = await question('Expected Order Frequency (one-time/weekly/bi-weekly/monthly): ');
    const preferredDelivery = (await question('Prefer delivery over pickup? (y/n): ')).toLowerCase() === 'y';
    const organicOnly = (await question('Organic products only? (y/n): ')).toLowerCase() === 'y';
    
    console.log('\nStep 4: Notification Preferences\n');
    
    const notifyEmail = (await question('Email notifications? (y/n): ')).toLowerCase() === 'y';
    const notifySMS = (await question('SMS notifications? (y/n): ')).toLowerCase() === 'y';
    
    console.log('\nStep 5: Payment Method\n');
    console.log('Options:');
    console.log('  1. Manual (invoice/e-transfer) - default for pilot');
    console.log('  2. Credit Card (Stripe)');
    console.log('  3. Invoice Terms (Net 30 - requires approval)\n');
    
    const paymentMethod = await question('Select payment method (1/2/3): ');
    
    let paymentDetails = {};
    if (paymentMethod === '2') {
      console.log('\n💳 Credit Card Setup');
      console.log('   Card will be added via secure Stripe portal');
      console.log('   Link will be sent to buyer email after registration\n');
      paymentDetails = { type: 'credit_card', status: 'pending_setup' };
    } else if (paymentMethod === '3') {
      const creditLimit = await question('Requested Credit Limit ($): ');
      paymentDetails = {
        type: 'invoice_terms',
        terms: 'net_30',
        credit_limit: parseFloat(creditLimit),
        status: 'pending_approval'
      };
    } else {
      paymentDetails = { type: 'manual', status: 'active' };
    }
    
    // Generate buyer ID and credentials
    const buyerId = `BUYER-${Date.now().toString().slice(-6)}`;
    const tempPassword = generateTempPassword();
    
    // Create buyer configuration object
    const buyerConfig = {
      buyer_id: buyerId,
      buyer_type: buyerType,
      business_name: businessName,
      contact_name: contactName,
      email,
      phone,
      delivery_address: {
        street: deliveryAddress,
        city: deliveryCity,
        province: deliveryProvince,
        postal_code: deliveryPostalCode,
        instructions: deliveryInstructions
      },
      preferences: {
        order_frequency: orderFrequency,
        prefers_delivery: preferredDelivery,
        organic_only: organicOnly
      },
      notifications: {
        email_enabled: notifyEmail,
        sms_enabled: notifySMS
      },
      payment: paymentDetails,
      credentials: {
        username: email,
        temp_password: tempPassword,
        password_reset_required: true
      },
      status: 'pilot',
      created_at: new Date().toISOString()
    };
    
    // Save to file
    const configDir = path.join(__dirname, '..', 'config', 'buyers');
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    
    const configFile = path.join(configDir, `${buyerId}.json`);
    fs.writeFileSync(configFile, JSON.stringify(buyerConfig, null, 2));
    
    // Add to buyers registry
    const buyersFile = path.join(__dirname, '..', 'public', 'data', 'wholesale-buyers.json');
    let buyers = { buyers: [] };
    
    if (fs.existsSync(buyersFile)) {
      buyers = JSON.parse(fs.readFileSync(buyersFile, 'utf8'));
    }
    
    buyers.buyers.push({
      buyer_id: buyerId,
      business_name: businessName,
      buyer_type: buyerType,
      email,
      status: 'active',
      created_at: new Date().toISOString()
    });
    
    fs.writeFileSync(buyersFile, JSON.stringify(buyers, null, 2));
    
    // Generate onboarding summary
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('  Buyer Onboarding Complete!');
    console.log('═══════════════════════════════════════════════════════════════\n');
    
    console.log('✅ Buyer Account Created');
    console.log(`   Configuration: ${configFile}\n`);
    
    console.log('🔐 Login Credentials');
    console.log(`   Buyer ID: ${buyerId}`);
    console.log(`   Username: ${email}`);
    console.log(`   Temporary Password: ${tempPassword}`);
    console.log(`   ⚠️  Password reset required on first login\n`);
    
    console.log('📋 Next Steps for Buyer:\n');
    console.log('1. Access Wholesale Portal:');
    console.log('   http://light-engine-foxtrot-prod.eba-ukiyyqf9.us-east-1.elasticbeanstalk.com/wholesale.html\n');
    
    console.log('2. First Login:');
    console.log(`   - Use email: ${email}`);
    console.log(`   - Use password: ${tempPassword}`);
    console.log('   - Set new secure password\n');
    
    console.log('3. Complete Profile:');
    console.log('   - Add additional delivery addresses');
    console.log('   - Upload business documents (if applicable)');
    console.log('   - Set up payment method\n');
    
    console.log('4. Browse Products:');
    console.log('   - Explore available farms and products');
    console.log('   - Favorite farms and products\n');
    
    console.log('5. Place Test Order:');
    console.log('   - Start with small order to test process');
    console.log('   - Verify notifications working\n');
    
    console.log('6. Review Buyer Guide:');
    console.log('   Open: BUYER_ONBOARDING_GUIDE.md\n');
    
    if (paymentDetails.type === 'invoice_terms') {
      console.log('⚠️  Credit Application Pending:');
      console.log('   - Review credit application');
      console.log('   - Check business references');
      console.log('   - Approve or decline credit terms');
      console.log('   - Notify buyer of decision\n');
    }
    
    // Generate welcome email
    console.log('📧 Welcome Email Template:\n');
    console.log('─────────────────────────────────────────────────────────────');
    console.log(`Subject: Welcome to GreenReach Wholesale - Your Account is Ready!\n`);
    console.log(`Hi ${contactName},\n`);
    console.log(`Welcome to GreenReach Wholesale! Your buyer account has been created.\n`);
    console.log(`Login Details:`);
    console.log(`Portal: http://light-engine-foxtrot-prod.eba-ukiyyqf9.us-east-1.elasticbeanstalk.com/wholesale.html`);
    console.log(`Username: ${email}`);
    console.log(`Temporary Password: ${tempPassword}\n`);
    console.log(`⚠️  You'll be prompted to change your password on first login.\n`);
    console.log(`Getting Started:`);
    console.log(`1. Log in and complete your profile`);
    console.log(`2. Browse our network of local farms`);
    console.log(`3. Place your first order`);
    console.log(`4. Review the Buyer Guide (attached) for tips\n`);
    console.log(`As a pilot program member, you receive:`);
    console.log(`✅ Free membership (normally $25/month)`);
    console.log(`✅ Free delivery on first order (up to $15)`);
    console.log(`✅ Priority support\n`);
    console.log(`Questions? Reply to this email or call +1-709-398-3166.\n`);
    console.log(`Happy shopping!`);
    console.log(`The GreenReach Team\n`);
    console.log(`P.S. Join our pilot Slack: #greenreach-pilot [invite link]`);
    console.log('─────────────────────────────────────────────────────────────\n');
    
    console.log('✅ Summary:');
    console.log(`   - Buyer account created: ${buyerId}`);
    console.log(`   - Credentials generated`);
    console.log(`   - Configuration saved`);
    console.log(`   - Welcome email template generated\n`);
    
    console.log('⏭️  Next: Send welcome email to buyer and schedule onboarding call\n');
    
    rl.close();
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Onboarding failed:', error);
    rl.close();
    process.exit(1);
  }
}

function generateTempPassword() {
  // Generate secure 12-character password
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%';
  let password = '';
  for (let i = 0; i < 12; i++) {
    password += chars[Math.floor(Math.random() * chars.length)];
  }
  return password;
}

runOnboarding();
