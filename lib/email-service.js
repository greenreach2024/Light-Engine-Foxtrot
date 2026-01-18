/**
 * Email Service Module
 * Supports AWS SES, SendGrid, and SMTP providers
 * Default: AWS SES (free tier: 62,000 emails/month)
 */

import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

// Email provider configuration
const EMAIL_PROVIDER = process.env.EMAIL_PROVIDER || 'ses'; // 'ses', 'sendgrid', or 'smtp'
const FROM_EMAIL = process.env.FROM_EMAIL || 'noreply@farm.local';
const FROM_NAME = process.env.FROM_NAME || 'Light Engine Foxtrot';

// AWS SES configuration
const sesClient = EMAIL_PROVIDER === 'ses' ? new SESClient({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: process.env.AWS_ACCESS_KEY_ID ? {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  } : undefined // Use default credentials if not specified
}) : null;

// SendGrid configuration (if using SendGrid)
let sendgridClient = null;
if (EMAIL_PROVIDER === 'sendgrid') {
  try {
    const sgMail = await import('@sendgrid/mail');
    sgMail.default.setApiKey(process.env.SENDGRID_API_KEY);
    sendgridClient = sgMail.default;
  } catch (error) {
    console.error('[email] SendGrid not available:', error.message);
  }
}

// Nodemailer configuration (if using SMTP)
let nodemailerTransport = null;
if (EMAIL_PROVIDER === 'smtp') {
  try {
    const nodemailer = await import('nodemailer');
    nodemailerTransport = nodemailer.default.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
  } catch (error) {
    console.error('[email] SMTP transport not available:', error.message);
  }
}

/**
 * Send email using configured provider
 * @param {Object} options Email options
 * @param {string} options.to Recipient email address
 * @param {string} options.subject Email subject
 * @param {string} options.text Plain text body
 * @param {string} options.html HTML body (optional)
 * @param {string} options.from From address (optional, uses default)
 * @param {string|string[]} options.cc CC recipients (optional)
 * @param {string|string[]} options.bcc BCC recipients (optional)
 * @returns {Promise<Object>} Send result
 */
export async function sendEmail({ to, subject, text, html, from, cc, bcc }) {
  const fromAddress = from || `${FROM_NAME} <${FROM_EMAIL}>`;

  console.log('[email] ===== SENDING EMAIL =====');
  console.log('[email] Provider:', EMAIL_PROVIDER);
  console.log('[email] From:', fromAddress);
  console.log('[email] To:', to);
  console.log('[email] CC:', cc || 'none');
  console.log('[email] BCC:', bcc || 'none');
  console.log('[email] Subject:', subject);

  try {
    switch (EMAIL_PROVIDER) {
      case 'ses':
        return await sendViaSES({ to, subject, text, html, from: fromAddress, cc, bcc });
      
      case 'sendgrid':
        return await sendViaSendGrid({ to, subject, text, html, from: fromAddress, cc, bcc });
      
      case 'smtp':
        return await sendViaSMTP({ to, subject, text, html, from: fromAddress, cc, bcc });
      
      default:
        throw new Error(`Unknown email provider: ${EMAIL_PROVIDER}`);
    }
  } catch (error) {
    console.error('[email] ❌ Send failed:', error.message);
    console.error('[email] Error stack:', error.stack);
    throw error;
  }
}

/**
 * Send email via AWS SES
 */
async function sendViaSES({ to, subject, text, html, from, cc, bcc }) {
  if (!sesClient) {
    throw new Error('AWS SES client not configured');
  }

  const params = {
    Source: from,
    Destination: {
      ToAddresses: Array.isArray(to) ? to : [to]
    },
    Message: {
      Subject: {
        Data: subject,
        Charset: 'UTF-8'
      },
      Body: {
        Text: {
          Data: text,
          Charset: 'UTF-8'
        }
      }
    }
  };

  // Add CC if provided
  if (cc) {
    params.Destination.CcAddresses = Array.isArray(cc) ? cc : [cc];
  }

  // Add BCC if provided
  if (bcc) {
    params.Destination.BccAddresses = Array.isArray(bcc) ? bcc : [bcc];
  }

  if (html) {
    params.Message.Body.Html = {
      Data: html,
      Charset: 'UTF-8'
    };
  }

  const command = new SendEmailCommand(params);
  const result = await sesClient.send(command);
  
  console.log('[email] SES send success:', { messageId: result.MessageId, to });
  return { success: true, messageId: result.MessageId, provider: 'ses' };
}

/**
 * Send email via SendGrid
 */
async function sendViaSendGrid({ to, subject, text, html, from, cc, bcc }) {
  if (!sendgridClient) {
    throw new Error('SendGrid client not configured');
  }

  const msg = {
    to: Array.isArray(to) ? to : [to],
    from,
    subject,
    text,
    html: html || text
  };

  // Add CC if provided
  if (cc) {
    msg.cc = Array.isArray(cc) ? cc : [cc];
  }

  // Add BCC if provided
  if (bcc) {
    msg.bcc = Array.isArray(bcc) ? bcc : [bcc];
  }

  const result = await sendgridClient.send(msg);
  
  console.log('[email] SendGrid send success:', { to, cc, bcc });
  return { success: true, messageId: result[0].headers['x-message-id'], provider: 'sendgrid' };
}

/**
 * Send email via SMTP (Nodemailer)
 */
async function sendViaSMTP({ to, subject, text, html, from, cc, bcc }) {
  if (!nodemailerTransport) {
    throw new Error('SMTP transport not configured');
  }

  const mailOptions = {
    from,
    to: Array.isArray(to) ? to.join(', ') : to,
    subject,
    text,
    html: html || text
  };

  // Add CC if provided
  if (cc) {
    mailOptions.cc = Array.isArray(cc) ? cc.join(', ') : cc;
  }

  // Add BCC if provided
  if (bcc) {
    mailOptions.bcc = Array.isArray(bcc) ? bcc.join(', ') : bcc;
  }

  const result = await nodemailerTransport.sendMail(mailOptions);
  
  console.log('[email] SMTP send success:', { messageId: result.messageId, to });
  return { success: true, messageId: result.messageId, provider: 'smtp' };
}

/**
 * Send order confirmation email
 */
export async function sendOrderConfirmation({ to, orderNumber, orderDetails, total, customerName }) {
  const subject = `Order Confirmation #${orderNumber}`;
  
  const text = `
Hi ${customerName},

Thank you for your order!

Order Number: ${orderNumber}
Total: $${total.toFixed(2)}

Order Details:
${orderDetails}

We'll send you another email when your order is ready for pickup.

Thank you for supporting local farms!

- Light Engine Foxtrot Farm
  `;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #2e7d32; color: white; padding: 20px; text-align: center; }
    .content { padding: 20px; background: #f9f9f9; }
    .order-details { background: white; padding: 15px; margin: 20px 0; border-left: 4px solid #2e7d32; }
    .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Order Confirmation</h1>
    </div>
    <div class="content">
      <p>Hi ${customerName},</p>
      <p>Thank you for your order!</p>
      
      <div class="order-details">
        <h2>Order #${orderNumber}</h2>
        <p><strong>Total:</strong> $${total.toFixed(2)}</p>
        <h3>Items:</h3>
        <pre>${orderDetails}</pre>
      </div>
      
      <p>We'll send you another email when your order is ready for pickup.</p>
      <p>Thank you for supporting local farms!</p>
    </div>
    <div class="footer">
      <p>Light Engine Foxtrot Farm</p>
    </div>
  </div>
</body>
</html>
  `;

  return sendEmail({ to, subject, text, html });
}

/**
 * Send wholesale order notification
 */
export async function sendWholesaleOrderNotification({ to, buyerName, orderNumber, items, total }) {
  const subject = `New Wholesale Order #${orderNumber}`;
  
  const text = `
New wholesale order received!

Buyer: ${buyerName}
Order Number: ${orderNumber}
Total: $${total.toFixed(2)}

Items:
${items}

Please process this order in the admin dashboard.
  `;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #1976d2; color: white; padding: 20px; text-align: center; }
    .content { padding: 20px; background: #f9f9f9; }
    .order-info { background: white; padding: 15px; margin: 20px 0; border-left: 4px solid #1976d2; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>New Wholesale Order</h1>
    </div>
    <div class="content">
      <p>A new wholesale order has been received:</p>
      
      <div class="order-info">
        <p><strong>Buyer:</strong> ${buyerName}</p>
        <p><strong>Order Number:</strong> ${orderNumber}</p>
        <p><strong>Total:</strong> $${total.toFixed(2)}</p>
        <h3>Items:</h3>
        <pre>${items}</pre>
      </div>
      
      <p>Please process this order in the admin dashboard.</p>
    </div>
  </div>
</body>
</html>
  `;

  return sendEmail({ to, subject, text, html });
}

/**
 * Test email configuration
 */
export async function testEmailConfig() {
  try {
    console.log(`[email] Testing email configuration (provider: ${EMAIL_PROVIDER})`);
    
    const result = await sendEmail({
      to: FROM_EMAIL,
      subject: 'Email Service Test',
      text: `This is a test email from Light Engine Foxtrot.\n\nProvider: ${EMAIL_PROVIDER}\nTimestamp: ${new Date().toISOString()}`,
      html: `<h1>Email Service Test</h1><p>Provider: <strong>${EMAIL_PROVIDER}</strong></p><p>Timestamp: ${new Date().toISOString()}</p>`
    });
    
    console.log('[email] Test email sent successfully:', result);
    return { success: true, ...result };
  } catch (error) {
    console.error('[email] Test email failed:', error.message);
    return { success: false, error: error.message };
  }
}

export default {
  sendEmail,
  sendOrderConfirmation,
  sendWholesaleOrderNotification,
  testEmailConfig
};
