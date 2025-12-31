#!/usr/bin/env node
/**
 * Email Service Test Script
 * Tests email delivery with configured provider (SES, SendGrid, or SMTP)
 */

import dotenv from 'dotenv';
dotenv.config();

import nodemailer from 'nodemailer';

console.log('═══════════════════════════════════════════════════════════════');
console.log('  Email Service Test');
console.log('═══════════════════════════════════════════════════════════════');
console.log('');

// Configuration
const config = {
  provider: process.env.EMAIL_PROVIDER || 'smtp',
  enabled: process.env.EMAIL_ENABLED === 'true',
  from: process.env.EMAIL_FROM || process.env.NOTIFICATIONS_FROM_EMAIL || 'test@example.com',
  fromName: process.env.EMAIL_FROM_NAME || 'Light Engine Test',
  testEmail: process.env.TEST_EMAIL || 'test@example.com'
};

console.log('📧 Email Configuration');
console.log('─────────────────────────────────────────────────────────────');
console.log(`Provider: ${config.provider}`);
console.log(`Enabled: ${config.enabled ? '✅ Yes' : '⚠️  No (emails will be logged only)'}`);
console.log(`From: ${config.fromName} <${config.from}>`);
console.log(`Test Email: ${config.testEmail}`);
console.log('');

/**
 * Create email transporter based on provider
 */
function createTransporter() {
  console.log('🔌 Connecting to Email Provider');
  console.log('─────────────────────────────────────────────────────────────');
  
  if (!config.enabled) {
    console.log('⚠️  Email disabled (EMAIL_ENABLED=false)');
    console.log('   Emails will be logged to console only');
    console.log('   Set EMAIL_ENABLED=true to send real emails');
    return null;
  }
  
  if (config.provider === 'sendgrid') {
    // SendGrid via SMTP
    if (!process.env.SENDGRID_API_KEY) {
      console.log('❌ SendGrid API key not found');
      console.log('   Set SENDGRID_API_KEY environment variable');
      return null;
    }
    
    console.log('✅ SendGrid configured');
    return nodemailer.createTransport({
      host: 'smtp.sendgrid.net',
      port: 587,
      secure: false,
      auth: {
        user: 'apikey',
        pass: process.env.SENDGRID_API_KEY
      }
    });
  } else if (config.provider === 'ses') {
    // AWS SES via SMTP
    const region = process.env.AWS_REGION || 'us-east-1';
    
    if (!process.env.AWS_ACCESS_KEY_ID) {
      console.log('⚠️  AWS credentials not found in environment');
      console.log('   Checking ~/.aws/credentials or EC2 instance role...');
    }
    
    console.log(`✅ AWS SES configured (region: ${region})`);
    
    // Note: When running on EC2/EB, use instance role instead of SMTP
    // For now, we'll try SES SMTP interface
    return nodemailer.createTransport({
      host: `email-smtp.${region}.amazonaws.com`,
      port: 587,
      secure: false,
      auth: {
        user: process.env.AWS_SES_SMTP_USER || '',
        pass: process.env.AWS_SES_SMTP_PASS || ''
      }
    });
  } else if (config.provider === 'smtp') {
    // Generic SMTP (Gmail, Outlook, etc.)
    if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
      console.log('❌ SMTP credentials incomplete');
      console.log('   Required: SMTP_HOST, SMTP_USER, SMTP_PASS');
      return null;
    }
    
    console.log(`✅ SMTP configured (${process.env.SMTP_HOST})`);
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
  } else {
    console.log(`❌ Unknown provider: ${config.provider}`);
    console.log('   Supported: ses, sendgrid, smtp');
    return null;
  }
}

/**
 * Test 1: Connection Test
 */
async function testConnection(transporter) {
  console.log('');
  console.log('Test 1: Connection Test');
  console.log('─────────────────────────────────────────────────────────────');
  
  if (!transporter) {
    console.log('⏭️  Skipped (transporter not configured)');
    return false;
  }
  
  try {
    await transporter.verify();
    console.log('✅ Connection successful');
    return true;
  } catch (error) {
    console.log('❌ Connection failed:', error.message);
    console.log('');
    console.log('Troubleshooting:');
    if (config.provider === 'sendgrid') {
      console.log('  • Verify SENDGRID_API_KEY is correct');
      console.log('  • Check SendGrid account status');
      console.log('  • Ensure sender email is verified');
    } else if (config.provider === 'smtp') {
      console.log('  • Check SMTP_HOST, SMTP_USER, SMTP_PASS');
      console.log('  • For Gmail: Use App Password, not regular password');
      console.log('  • Check firewall/network settings');
    } else if (config.provider === 'ses') {
      console.log('  • Verify AWS credentials are configured');
      console.log('  • Check AWS_REGION is correct');
      console.log('  • Ensure sender email is verified in SES');
      console.log('  • If in sandbox mode, recipient must be verified');
    }
    return false;
  }
}

/**
 * Test 2: Simple Email
 */
async function testSimpleEmail(transporter) {
  console.log('');
  console.log('Test 2: Simple Email');
  console.log('─────────────────────────────────────────────────────────────');
  
  if (!transporter) {
    console.log('⏭️  Skipped (transporter not configured)');
    logMockEmail('Simple Test Email', '<h1>Success!</h1><p>Email service is working.</p>');
    return false;
  }
  
  const mailOptions = {
    from: `${config.fromName} <${config.from}>`,
    to: config.testEmail,
    subject: 'Test Email from Light Engine Foxtrot',
    text: 'Success! Email service is working correctly.',
    html: `
      <html>
        <body style="font-family: Arial, sans-serif; padding: 20px;">
          <div style="max-width: 600px; margin: 0 auto;">
            <div style="background: linear-gradient(135deg, #2d5016 0%, #3d6b1f 100%); color: white; padding: 30px; text-align: center; border-radius: 8px;">
              <h1>✅ Email Service Working!</h1>
            </div>
            <div style="padding: 30px; background: #f5f5f5; margin-top: 20px; border-radius: 8px;">
              <p>This is a test email from Light Engine Foxtrot.</p>
              <p><strong>Provider:</strong> ${config.provider}</p>
              <p><strong>Time:</strong> ${new Date().toLocaleString()}</p>
            </div>
          </div>
        </body>
      </html>
    `
  };
  
  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ Email sent successfully!`);
    console.log(`   To: ${config.testEmail}`);
    console.log(`   Message ID: ${info.messageId}`);
    if (info.response) {
      console.log(`   Response: ${info.response}`);
    }
    return true;
  } catch (error) {
    console.log('❌ Email failed:', error.message);
    return false;
  }
}

/**
 * Test 3: Order Confirmation Template
 */
async function testOrderTemplate(transporter) {
  console.log('');
  console.log('Test 3: Order Confirmation Template');
  console.log('─────────────────────────────────────────────────────────────');
  
  const orderHtml = `
    <!DOCTYPE html>
    <html>
      <body style="font-family: Arial, sans-serif; padding: 20px;">
        <div style="max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #2d5016 0%, #3d6b1f 100%); color: white; padding: 30px 20px; text-align: center; border-radius: 8px 8px 0 0;">
            <h1>Order Confirmation</h1>
            <p style="margin: 0; font-size: 1.2rem;">Order #TEST-${Date.now()}</p>
          </div>
          
          <div style="padding: 30px; background: #f5f5f5;">
            <div style="background: #d4edda; border-left: 4px solid #38a169; padding: 15px; margin-bottom: 20px; border-radius: 4px;">
              <strong>✓ Order Placed Successfully</strong><br/>
              Thank you for your order!
            </div>
            
            <h3>Order Details</h3>
            <p><strong>Total:</strong> $125.00 CAD</p>
            <p><strong>Delivery:</strong> Farm Pickup</p>
            
            <h3>Items</h3>
            <table style="width: 100%; border-collapse: collapse; margin: 15px 0;">
              <thead>
                <tr style="background: #e8f4e8;">
                  <th style="padding: 10px; text-align: left; border-bottom: 1px solid #ddd;">Product</th>
                  <th style="padding: 10px; text-align: right; border-bottom: 1px solid #ddd;">Qty</th>
                  <th style="padding: 10px; text-align: right; border-bottom: 1px solid #ddd;">Price</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style="padding: 10px; border-bottom: 1px solid #ddd;">Butterhead Lettuce</td>
                  <td style="padding: 10px; text-align: right; border-bottom: 1px solid #ddd;">5 heads</td>
                  <td style="padding: 10px; text-align: right; border-bottom: 1px solid #ddd;">$25.00</td>
                </tr>
                <tr>
                  <td style="padding: 10px; border-bottom: 1px solid #ddd;">Fresh Basil</td>
                  <td style="padding: 10px; text-align: right; border-bottom: 1px solid #ddd;">10 bunches</td>
                  <td style="padding: 10px; text-align: right; border-bottom: 1px solid #ddd;">$100.00</td>
                </tr>
              </tbody>
            </table>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="http://localhost:8091/wholesale.html?view=orders" 
                 style="display: inline-block; background: #82c341; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; font-weight: bold;">
                Track Your Order →
              </a>
            </div>
          </div>
        </div>
      </body>
    </html>
  `;
  
  if (!transporter) {
    console.log('⏭️  Skipped (transporter not configured)');
    logMockEmail('Order Confirmation #TEST-123', orderHtml);
    return false;
  }
  
  const mailOptions = {
    from: `${config.fromName} <${config.from}>`,
    to: config.testEmail,
    subject: `Order Confirmation #TEST-${Date.now()}`,
    html: orderHtml,
    text: 'Order placed successfully! Check your email for details.'
  };
  
  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ Order confirmation sent!`);
    console.log(`   To: ${config.testEmail}`);
    console.log(`   Message ID: ${info.messageId}`);
    return true;
  } catch (error) {
    console.log('❌ Email failed:', error.message);
    return false;
  }
}

/**
 * Log mock email when service disabled
 */
function logMockEmail(subject, html) {
  console.log(`
📧 MOCK EMAIL (would be sent if EMAIL_ENABLED=true)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
To: ${config.testEmail}
From: ${config.fromName} <${config.from}>
Subject: ${subject}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${html.substring(0, 300)}...
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  `);
}

/**
 * Main test runner
 */
async function runTests() {
  const transporter = createTransporter();
  
  const results = {
    connection: false,
    simpleEmail: false,
    orderTemplate: false
  };
  
  if (transporter) {
    results.connection = await testConnection(transporter);
    
    if (results.connection) {
      results.simpleEmail = await testSimpleEmail(transporter);
      results.orderTemplate = await testOrderTemplate(transporter);
    }
  } else {
    // Run tests in mock mode
    await testSimpleEmail(null);
    await testOrderTemplate(null);
  }
  
  // Summary
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Test Summary');
  console.log('═══════════════════════════════════════════════════════════════');
  
  if (!config.enabled) {
    console.log('⚠️  Email service is DISABLED (EMAIL_ENABLED=false)');
    console.log('   Emails are logged to console only');
    console.log('');
    console.log('To enable email service:');
    console.log('  1. Choose provider: ses, sendgrid, or smtp');
    console.log('  2. Set required environment variables (see EMAIL_SETUP_GUIDE.md)');
    console.log('  3. Set EMAIL_ENABLED=true');
    console.log('  4. Run this test again');
  } else if (!transporter) {
    console.log('❌ Email service configuration incomplete');
    console.log('');
    console.log('See EMAIL_SETUP_GUIDE.md for setup instructions');
  } else {
    const passed = Object.values(results).filter(Boolean).length;
    const total = Object.keys(results).length;
    
    console.log(`${results.connection ? '✅' : '❌'} Connection Test`);
    console.log(`${results.simpleEmail ? '✅' : '❌'} Simple Email`);
    console.log(`${results.orderTemplate ? '✅' : '❌'} Order Confirmation Template`);
    console.log('');
    console.log(`Result: ${passed}/${total} tests passed`);
    
    if (passed === total) {
      console.log('');
      console.log('🎉 All tests passed! Email service is ready for production.');
      console.log('');
      console.log('Next steps:');
      console.log('  1. Check your inbox at:', config.testEmail);
      console.log('  2. Verify emails are not in spam');
      console.log('  3. Deploy to production with eb setenv');
    } else {
      console.log('');
      console.log('⚠️  Some tests failed. Review configuration and try again.');
    }
  }
  
  console.log('');
}

// Run tests
runTests().catch(error => {
  console.error('Test runner error:', error);
  process.exit(1);
});
