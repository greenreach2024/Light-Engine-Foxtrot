#!/usr/bin/env node
/**
 * Check Email Configuration
 * Verifies all required environment variables for email sending
 */

console.log('=== Email Configuration Check ===\n');

const config = {
  EMAIL_PROVIDER: process.env.EMAIL_PROVIDER || 'ses (default)',
  FROM_EMAIL: process.env.FROM_EMAIL || '❌ NOT SET',
  FROM_NAME: process.env.FROM_NAME || 'Light Engine Foxtrot (default)',
  AWS_REGION: process.env.AWS_REGION || 'us-east-1 (default)',
  AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID ? '✅ SET' : '❌ NOT SET',
  AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY ? '✅ SET' : '❌ NOT SET',
  SENDGRID_API_KEY: process.env.SENDGRID_API_KEY ? '✅ SET' : '❌ NOT SET',
  SMTP_HOST: process.env.SMTP_HOST || '❌ NOT SET',
  SMTP_PORT: process.env.SMTP_PORT || '587 (default)',
  SMTP_USER: process.env.SMTP_USER ? '✅ SET' : '❌ NOT SET',
  SMTP_PASS: process.env.SMTP_PASS ? '✅ SET' : '❌ NOT SET'
};

console.log('Environment Variables:');
console.log('----------------------');
Object.entries(config).forEach(([key, value]) => {
  console.log(`${key}: ${value}`);
});

console.log('\nProvider-Specific Requirements:');
console.log('--------------------------------');

const provider = process.env.EMAIL_PROVIDER || 'ses';
console.log(`\nCurrent Provider: ${provider}`);

if (provider === 'ses') {
  console.log('\nAWS SES Requirements:');
  console.log('- FROM_EMAIL must be verified in AWS SES');
  console.log('- AWS credentials (automatic from IAM role or explicit keys)');
  console.log('- AWS_REGION (default: us-east-1)');
  
  const sesReady = process.env.FROM_EMAIL;
  console.log(`\nStatus: ${sesReady ? '✅ Ready (check FROM_EMAIL verification in SES)' : '❌ FROM_EMAIL not set'}`);
} else if (provider === 'sendgrid') {
  console.log('\nSendGrid Requirements:');
  console.log('- SENDGRID_API_KEY');
  console.log('- FROM_EMAIL');
  
  const sgReady = process.env.SENDGRID_API_KEY && process.env.FROM_EMAIL;
  console.log(`\nStatus: ${sgReady ? '✅ Ready' : '❌ Missing required variables'}`);
} else if (provider === 'smtp') {
  console.log('\nSMTP Requirements:');
  console.log('- SMTP_HOST');
  console.log('- SMTP_USER');
  console.log('- SMTP_PASS');
  console.log('- FROM_EMAIL');
  
  const smtpReady = process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS && process.env.FROM_EMAIL;
  console.log(`\nStatus: ${smtpReady ? '✅ Ready' : '❌ Missing required variables'}`);
}

console.log('\n=== End Configuration Check ===');
