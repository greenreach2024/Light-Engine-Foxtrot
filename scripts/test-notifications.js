#!/usr/bin/env node
/**
 * Test Script: Notification Delivery
 * Verifies email, SMS, and push notifications are working correctly
 */

import dotenv from 'dotenv';
dotenv.config();

import notificationService from '../services/wholesale-notification-service.js';

console.log('═══════════════════════════════════════════════════════════════');
console.log('  Notification Delivery Test');
console.log('═══════════════════════════════════════════════════════════════');
console.log('');

const TEST_FARM_CONTACT = {
  farm_id: 'test-farm-001',
  farm_name: 'Test Farm',
  email: process.env.TEST_EMAIL || 'test@example.com',
  phone: process.env.TEST_PHONE || null
};

const TEST_ORDER = {
  id: 'TEST-ORDER-' + Date.now(),
  buyer_name: 'Test Buyer',
  buyer_email: process.env.TEST_EMAIL || 'test@example.com',
  total_amount: 125.00,
  verification_deadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  delivery_date: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
  delivery_address: '123 Test St, Kingston, ON K7L 1A1'
};

const TEST_SUB_ORDER = {
  id: 'SUB-' + Date.now(),
  farm_id: TEST_FARM_CONTACT.farm_id,
  farm_name: TEST_FARM_CONTACT.farm_name,
  sub_total: 125.00,
  items: [
    {
      sku_id: 'SKU-ARUGULA-5LB',
      product_name: 'Arugula, 5lb case',
      quantity: 10,
      unit: 'case',
      price_per_unit: 12.50
    }
  ]
};

async function testEmail() {
  console.log('Test 1: Email Notification');
  console.log('─────────────────────────────────────────────────────────────');
  
  try {
    await notificationService.notifyFarmNewOrder(
      TEST_FARM_CONTACT,
      TEST_ORDER,
      TEST_SUB_ORDER
    );
    
    console.log(`✅ Email sent to ${TEST_FARM_CONTACT.email}`);
    console.log('   Check your inbox for new order notification');
    return true;
  } catch (error) {
    console.error('❌ Email failed:', error.message);
    console.log('');
    console.log('Troubleshooting:');
    console.log('  • Check SMTP_HOST, SMTP_USER, SMTP_PASS in .env');
    console.log('  • For Gmail: Use App Password, not regular password');
    console.log('  • For AWS SES: Verify sender email domain');
    return false;
  }
}

async function testSMS() {
  console.log('');
  console.log('Test 2: SMS Notification');
  console.log('─────────────────────────────────────────────────────────────');
  
  if (!TEST_FARM_CONTACT.phone) {
    console.log('⚠️  Skipped: No test phone number provided');
    console.log('   Set TEST_PHONE environment variable to test SMS');
    return null;
  }
  
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
    console.log('⚠️  Skipped: Twilio not configured');
    console.log('   Run: npm run setup:notifications');
    return null;
  }
  
  try {
    // Send deadline reminder (includes SMS)
    await notificationService.sendDeadlineReminder(
      TEST_FARM_CONTACT,
      TEST_ORDER,
      TEST_SUB_ORDER,
      6 // 6 hours remaining (triggers SMS)
    );
    
    console.log(`✅ SMS sent to ${TEST_FARM_CONTACT.phone}`);
    console.log('   Check your phone for urgent deadline alert');
    return true;
  } catch (error) {
    console.error('❌ SMS failed:', error.message);
    console.log('');
    console.log('Troubleshooting:');
    console.log('  • Check TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN in .env');
    console.log('  • Verify phone number format: +16135551234');
    console.log('  • Trial accounts can only send to verified numbers');
    return false;
  }
}

async function testPush() {
  console.log('');
  console.log('Test 3: Push Notification');
  console.log('─────────────────────────────────────────────────────────────');
  
  if (!process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
    console.log('⚠️  Skipped: Firebase not configured');
    console.log('   Run: npm run setup:notifications');
    return null;
  }
  
  console.log('⚠️  Push notifications require device token');
  console.log('   Device must:');
  console.log('     1. Load farm admin page');
  console.log('     2. Allow notifications permission');
  console.log('     3. Register device token in database');
  console.log('');
  console.log('   Push notification testing requires live farm device');
  console.log('   Manual test: Place real order and check device');
  
  return null;
}

async function runTests() {
  console.log(`Test recipient: ${TEST_FARM_CONTACT.email}`);
  if (TEST_FARM_CONTACT.phone) {
    console.log(`Test phone: ${TEST_FARM_CONTACT.phone}`);
  }
  console.log('');
  
  const emailResult = await testEmail();
  const smsResult = await testSMS();
  const pushResult = await testPush();
  
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Test Summary');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
  
  const results = [];
  if (emailResult === true) results.push('✅ Email');
  if (emailResult === false) results.push('❌ Email');
  if (smsResult === true) results.push('✅ SMS');
  if (smsResult === false) results.push('❌ SMS');
  if (smsResult === null) results.push('⚠️  SMS (not configured)');
  if (pushResult === null) results.push('⚠️  Push (requires device)');
  
  console.log(results.join('\n'));
  console.log('');
  
  if (emailResult && (smsResult === true || smsResult === null)) {
    console.log('✅ Core notification system working!');
    console.log('');
    console.log('Next steps:');
    console.log('  1. Complete Twilio setup for SMS (if not done)');
    console.log('  2. Test push on real farm device');
    console.log('  3. Place test wholesale order to verify end-to-end');
  } else {
    console.log('❌ Some notifications failed');
    console.log('');
    console.log('Please fix configuration issues before production launch.');
  }
}

// Check for test email
if (!process.env.TEST_EMAIL) {
  console.error('❌ TEST_EMAIL environment variable not set');
  console.log('');
  console.log('Usage:');
  console.log('  TEST_EMAIL=your@email.com npm run test:notifications');
  console.log('');
  console.log('Optional:');
  console.log('  TEST_PHONE=+16135551234 TEST_EMAIL=your@email.com npm run test:notifications');
  process.exit(1);
}

// Run tests
runTests().catch(error => {
  console.error('Test failed with error:', error);
  process.exit(1);
});
