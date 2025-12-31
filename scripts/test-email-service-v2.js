#!/usr/bin/env node

/**
 * Test Email Service Configuration
 * Tests all email providers and sends test emails
 * 
 * Usage:
 *   node scripts/test-email-service.js --provider ses --to your@email.com
 *   node scripts/test-email-service.js --provider sendgrid --to your@email.com
 *   node scripts/test-email-service.js --provider smtp --to your@email.com
 *   node scripts/test-email-service.js --all --to your@email.com
 */

import emailService from '../server/services/email-service.js';

const args = process.argv.slice(2);
const getArg = (flag) => {
  const index = args.indexOf(flag);
  return index !== -1 && args[index + 1] ? args[index + 1] : null;
};

const provider = getArg('--provider');
const to = getArg('--to');
const testAll = args.includes('--all');

async function testEmailService() {
  console.log('\n=== Email Service Test ===\n');
  
  if (!to) {
    console.error('Error: --to email address is required');
    console.log('\nUsage:');
    console.log('  node scripts/test-email-service.js --provider ses --to your@email.com');
    console.log('  node scripts/test-email-service.js --all --to your@email.com');
    process.exit(1);
  }
  
  const providers = testAll ? ['ses', 'sendgrid', 'smtp'] : [provider || process.env.EMAIL_PROVIDER || 'ses'];
  
  for (const prov of providers) {
    console.log(`\n--- Testing ${prov.toUpperCase()} provider ---\n`);
    
    // Temporarily override provider
    const originalProvider = process.env.EMAIL_PROVIDER;
    process.env.EMAIL_PROVIDER = prov;
    
    // Reset email service
    emailService.initialized = false;
    emailService.provider = prov;
    
    try {
      // Test 1: Initialize
      console.log('1. Initializing email service...');
      await emailService.initialize();
      console.log('   ✓ Initialization successful');
      
      // Test 2: Verify connection
      console.log('\n2. Verifying connection...');
      const isConnected = await emailService.testConnection();
      console.log(`   ✓ Connection verified: ${isConnected}`);
      
      // Test 3: Send test email
      console.log('\n3. Sending test email...');
      const result = await emailService.sendEmail({
        to,
        subject: `Email Test - ${prov.toUpperCase()} Provider`,
        html: `
          <h1>Email Service Test</h1>
          <p>This is a test email from Light Engine Foxtrot.</p>
          <p><strong>Provider:</strong> ${prov}</p>
          <p><strong>Timestamp:</strong> ${new Date().toISOString()}</p>
          <p>If you received this email, the ${prov.toUpperCase()} provider is configured correctly!</p>
        `
      });
      
      console.log(`   ✓ Email sent successfully`);
      console.log(`   Message ID: ${result.messageId}`);
      console.log(`   Provider: ${result.provider}`);
      
      // Test 4: Send order confirmation
      console.log('\n4. Sending order confirmation email...');
      const orderResult = await emailService.sendOrderConfirmation({
        to,
        orderId: 'TEST-' + Date.now(),
        customerName: 'Test Customer',
        items: [
          { name: 'Organic Tomatoes', quantity: 2, price: 5.99 },
          { name: 'Fresh Lettuce', quantity: 1, price: 3.49 }
        ],
        total: 15.47,
        farmName: 'Test Farm'
      });
      
      console.log(`   ✓ Order confirmation sent`);
      console.log(`   Message ID: ${orderResult.messageId}`);
      
      console.log(`\n✓ All tests passed for ${prov.toUpperCase()}\n`);
      
    } catch (error) {
      console.error(`\n✗ Test failed for ${prov.toUpperCase()}:`, error.message);
      
      if (prov === 'ses' && error.message.includes('credentials')) {
        console.log('\nAWS SES Configuration:');
        console.log('  - Set AWS_REGION (default: us-east-1)');
        console.log('  - Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY');
        console.log('  - Or use IAM role on EC2/Elastic Beanstalk');
        console.log('  - Verify sender email in SES console');
      } else if (prov === 'sendgrid') {
        console.log('\nSendGrid Configuration:');
        console.log('  - Set SENDGRID_API_KEY');
        console.log('  - Get API key from: https://app.sendgrid.com/settings/api_keys');
      } else if (prov === 'smtp') {
        console.log('\nSMTP Configuration:');
        console.log('  - Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS');
      }
    } finally {
      // Restore original provider
      if (originalProvider) {
        process.env.EMAIL_PROVIDER = originalProvider;
      }
    }
  }
  
  console.log('\n=== Test Complete ===\n');
}

testEmailService().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
