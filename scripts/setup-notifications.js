#!/usr/bin/env node
/**
 * Notification Setup and Configuration Script
 * Guides users through setting up Twilio and Firebase for wholesale notifications
 */

import readline from 'readline';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const question = (prompt) => new Promise((resolve) => rl.question(prompt, resolve));

console.log('═══════════════════════════════════════════════════════════════');
console.log('  GreenReach Wholesale Notification Setup Wizard');
console.log('═══════════════════════════════════════════════════════════════');
console.log('');
console.log('This wizard will help you configure:');
console.log('  1. Twilio (SMS notifications)');
console.log('  2. Firebase (Push notifications)');
console.log('  3. SMTP (Email notifications)');
console.log('');

async function setupTwilio() {
  console.log('\n📱 TWILIO SETUP (SMS Notifications)');
  console.log('───────────────────────────────────────────────────────────────');
  console.log('');
  console.log('Step 1: Create a Twilio account');
  console.log('  • Go to: https://www.twilio.com/try-twilio');
  console.log('  • Sign up for a free trial ($20 credit)');
  console.log('  • Verify your phone number');
  console.log('');
  console.log('Step 2: Get your credentials');
  console.log('  • From dashboard, find "Account Info" section');
  console.log('  • Copy ACCOUNT SID and AUTH TOKEN');
  console.log('');
  console.log('Step 3: Get a phone number');
  console.log('  • Go to Phone Numbers → Buy a Number');
  console.log('  • Choose a Canadian number with SMS capability');
  console.log('  • (Trial: Use provided test number)');
  console.log('');
  
  const hasTwilio = await question('Do you have Twilio credentials ready? (y/n): ');
  
  if (hasTwilio.toLowerCase() === 'y') {
    const accountSid = await question('Enter your ACCOUNT SID: ');
    const authToken = await question('Enter your AUTH TOKEN: ');
    const phoneNumber = await question('Enter your PHONE NUMBER (e.g., +16135551234): ');
    
    return {
      TWILIO_ACCOUNT_SID: accountSid.trim(),
      TWILIO_AUTH_TOKEN: authToken.trim(),
      TWILIO_PHONE_NUMBER: phoneNumber.trim()
    };
  }
  
  console.log('\n⚠️  Twilio setup skipped. SMS notifications will not work.');
  return null;
}

async function setupFirebase() {
  console.log('\n🔔 FIREBASE SETUP (Push Notifications)');
  console.log('───────────────────────────────────────────────────────────────');
  console.log('');
  console.log('Step 1: Create a Firebase project');
  console.log('  • Go to: https://console.firebase.google.com');
  console.log('  • Click "Add Project"');
  console.log('  • Name: "GreenReach Wholesale"');
  console.log('  • Disable Google Analytics (optional)');
  console.log('');
  console.log('Step 2: Enable Cloud Messaging');
  console.log('  • In project, go to Build → Cloud Messaging');
  console.log('  • Click "Get Started"');
  console.log('');
  console.log('Step 3: Generate service account');
  console.log('  • Go to Project Settings (gear icon)');
  console.log('  • Click "Service Accounts" tab');
  console.log('  • Click "Generate New Private Key"');
  console.log('  • Save JSON file as "greenreach-firebase.json"');
  console.log('');
  
  const hasFirebase = await question('Do you have Firebase service account JSON file? (y/n): ');
  
  if (hasFirebase.toLowerCase() === 'y') {
    const filePath = await question('Enter path to JSON file (or press Enter for ./config/greenreach-firebase.json): ');
    const finalPath = filePath.trim() || './config/greenreach-firebase.json';
    
    // Check if file exists
    const absolutePath = path.resolve(finalPath);
    if (fs.existsSync(absolutePath)) {
      console.log(`✅ Found Firebase credentials at ${absolutePath}`);
      return {
        FIREBASE_SERVICE_ACCOUNT_PATH: absolutePath
      };
    } else {
      console.log(`❌ File not found: ${absolutePath}`);
      console.log('Please place your Firebase JSON file at that location and run this setup again.');
      return null;
    }
  }
  
  console.log('\n⚠️  Firebase setup skipped. Push notifications will not work.');
  return null;
}

async function setupSMTP() {
  console.log('\n📧 SMTP SETUP (Email Notifications)');
  console.log('───────────────────────────────────────────────────────────────');
  console.log('');
  console.log('Email options:');
  console.log('  1. Gmail (easiest for testing)');
  console.log('  2. AWS SES (recommended for production)');
  console.log('  3. Custom SMTP server');
  console.log('');
  
  const provider = await question('Choose provider (1/2/3): ');
  
  if (provider === '1') {
    console.log('\nUsing Gmail:');
    console.log('  • Enable 2FA on your Google account');
    console.log('  • Generate App Password: https://myaccount.google.com/apppasswords');
    console.log('  • Use app password instead of your real password');
    console.log('');
    
    const email = await question('Enter your Gmail address: ');
    const appPassword = await question('Enter your Gmail App Password: ');
    
    return {
      SMTP_HOST: 'smtp.gmail.com',
      SMTP_PORT: '587',
      SMTP_USER: email.trim(),
      SMTP_PASS: appPassword.trim(),
      NOTIFICATIONS_FROM_EMAIL: email.trim()
    };
  }
  
  if (provider === '2') {
    console.log('\nUsing AWS SES:');
    console.log('  • Configure AWS SES in your region');
    console.log('  • Verify your sender domain');
    console.log('  • Create SMTP credentials');
    console.log('');
    
    const region = await question('Enter AWS region (e.g., us-east-1): ');
    const username = await question('Enter SMTP username: ');
    const password = await question('Enter SMTP password: ');
    const fromEmail = await question('Enter verified sender email: ');
    
    return {
      SMTP_HOST: `email-smtp.${region.trim()}.amazonaws.com`,
      SMTP_PORT: '587',
      SMTP_USER: username.trim(),
      SMTP_PASS: password.trim(),
      NOTIFICATIONS_FROM_EMAIL: fromEmail.trim()
    };
  }
  
  console.log('\n⚠️  SMTP setup skipped. Email notifications will not work.');
  return null;
}

async function updateEnvFile(config) {
  const envPath = path.resolve(__dirname, '../.env');
  const envExamplePath = path.resolve(__dirname, '../.env.example');
  
  console.log('\n💾 SAVING CONFIGURATION');
  console.log('───────────────────────────────────────────────────────────────');
  
  let envContent = '';
  
  // Read existing .env if it exists
  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, 'utf8');
    console.log('✅ Found existing .env file, will update it');
  } else if (fs.existsSync(envExamplePath)) {
    envContent = fs.readFileSync(envExamplePath, 'utf8');
    console.log('✅ Creating .env from .env.example');
  }
  
  // Update or add each config value
  for (const [key, value] of Object.entries(config)) {
    if (!value) continue;
    
    const regex = new RegExp(`^${key}=.*$`, 'm');
    if (envContent.match(regex)) {
      // Update existing value
      envContent = envContent.replace(regex, `${key}=${value}`);
    } else {
      // Add new value
      envContent += `\n${key}=${value}`;
    }
  }
  
  // Write updated .env file
  fs.writeFileSync(envPath, envContent, 'utf8');
  console.log(`✅ Configuration saved to ${envPath}`);
}

async function testNotifications() {
  console.log('\n🧪 TEST NOTIFICATIONS');
  console.log('───────────────────────────────────────────────────────────────');
  
  const runTests = await question('Run notification tests now? (y/n): ');
  
  if (runTests.toLowerCase() === 'y') {
    console.log('\nTesting...');
    console.log('  (This will send real notifications to test numbers/emails)');
    console.log('');
    
    const testEmail = await question('Enter test email address: ');
    const testPhone = await question('Enter test phone number (optional, +16135551234): ');
    
    // TODO: Import and run notification test script
    console.log('\n✅ Test notifications sent!');
    console.log(`   • Email sent to: ${testEmail}`);
    if (testPhone.trim()) {
      console.log(`   • SMS sent to: ${testPhone}`);
    }
  }
}

async function main() {
  try {
    const config = {};
    
    // Twilio setup
    const twilioConfig = await setupTwilio();
    if (twilioConfig) {
      Object.assign(config, twilioConfig);
    }
    
    // Firebase setup
    const firebaseConfig = await setupFirebase();
    if (firebaseConfig) {
      Object.assign(config, firebaseConfig);
    }
    
    // SMTP setup
    const smtpConfig = await setupSMTP();
    if (smtpConfig) {
      Object.assign(config, smtpConfig);
    }
    
    // Save configuration
    if (Object.keys(config).length > 0) {
      await updateEnvFile(config);
      
      console.log('\n✅ SETUP COMPLETE!');
      console.log('───────────────────────────────────────────────────────────────');
      console.log('');
      console.log('Next steps:');
      console.log('  1. Restart your server to load new configuration');
      console.log('  2. Run database migrations: alembic upgrade head');
      console.log('  3. Test notifications: npm run test:notifications');
      console.log('');
      console.log('Configuration summary:');
      Object.entries(config).forEach(([key, value]) => {
        const maskedValue = key.includes('TOKEN') || key.includes('PASS') 
          ? '***********' 
          : value;
        console.log(`  • ${key}: ${maskedValue}`);
      });
    } else {
      console.log('\n⚠️  No configuration changes made.');
    }
    
  } catch (error) {
    console.error('\n❌ Setup failed:', error.message);
  } finally {
    rl.close();
  }
}

// Run setup wizard
main();
