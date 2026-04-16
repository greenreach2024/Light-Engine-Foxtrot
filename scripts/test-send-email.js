#!/usr/bin/env node
/**
 * Test Email Sending
 * Sends a test email to verify configuration
 */

import { sendEmail } from '../lib/email-service.js';

const testEmail = process.argv[2] || 'admin@greenreachgreens.com';

console.log('=== Testing Email Service ===\n');
console.log('Environment Variables:');
console.log('  EMAIL_PROVIDER:', process.env.EMAIL_PROVIDER || 'ses (default)');
console.log('  EMAIL_FROM:', process.env.EMAIL_FROM || 'not set');
console.log('  FROM_EMAIL:', process.env.FROM_EMAIL || 'not set');
console.log('  AWS_REGION:', process.env.AWS_REGION || 'us-east-1 (default)');
console.log('  Test recipient:', testEmail);
console.log('');

async function testSend() {
  try {
    console.log('Attempting to send test email...\n');
    
    const result = await sendEmail({
      to: testEmail,
      cc: 'admin@greenreachgreens.com',
      subject: 'Test Email from GreenReach Central',
      text: 'This is a test email to verify the email service is working correctly.',
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
          <h2 style="color: #10b981;">Test Email</h2>
          <p>This is a test email to verify the email service is working correctly.</p>
          <p><strong>Sent at:</strong> ${new Date().toISOString()}</p>
          <hr>
          <p style="color: #666; font-size: 12px;">GreenReach Central Admin System</p>
        </div>
      `
    });
    
    console.log('✅ Email sent successfully!');
    console.log('Result:', result);
    console.log('\nCheck the inbox for:', testEmail);
    console.log('Also check CC inbox:', 'admin@greenreachgreens.com');
  } catch (error) {
    console.error('❌ Email send failed!');
    console.error('Error:', error.message);
    console.error('\nTroubleshooting:');
    console.error('1. Verify emails in AWS SES: npm run verify-emails');
    console.error('2. Check email verification status in AWS Console');
    console.error('3. Ensure SES is not in sandbox mode or recipient is verified');
    console.error('\nFull error:');
    console.error(error);
    process.exit(1);
  }
}

testSend();
