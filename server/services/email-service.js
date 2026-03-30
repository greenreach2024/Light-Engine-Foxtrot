/**
 * Unified Email Service
 * Supports AWS SES (preferred), SendGrid, and SMTP fallback
 * 
 * Environment Variables:
 * - EMAIL_PROVIDER: 'ses' | 'sendgrid' | 'smtp' (default: 'ses')
 * - AWS_REGION: AWS region for SES (default: 'us-east-1')
 * - AWS_ACCESS_KEY_ID: AWS credentials (optional if using IAM role)
 * - AWS_SECRET_ACCESS_KEY: AWS credentials (optional if using IAM role)
 * - SENDGRID_API_KEY: SendGrid API key
 * - SMTP_HOST: SMTP server hostname
 * - SMTP_PORT: SMTP server port (default: 587)
 * - SMTP_USER: SMTP username
 * - SMTP_PASS: SMTP password
 * - EMAIL_FROM: Default sender email address
 * - EMAIL_FROM_NAME: Default sender name
 */

import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import nodemailer from 'nodemailer';

class EmailService {
  constructor() {
    this.provider = process.env.EMAIL_PROVIDER || 'ses';
    this.fromEmail = process.env.EMAIL_FROM || 'noreply@farm.local';
    this.fromName = process.env.EMAIL_FROM_NAME || 'Light Engine Foxtrot';
    this.initialized = false;
    this.transporter = null;
    this.sesClient = null;
  }

  /**
   * Initialize email service based on configured provider
   */
  async initialize() {
    if (this.initialized) return;

    try {
      switch (this.provider) {
        case 'ses':
          await this.initializeSES();
          break;
        case 'sendgrid':
          await this.initializeSendGrid();
          break;
        case 'smtp':
          await this.initializeSMTP();
          break;
        default:
          throw new Error(`Unknown email provider: ${this.provider}`);
      }
      
      this.initialized = true;
      console.log(`[email-service] Initialized with provider: ${this.provider}`);
    } catch (error) {
      console.error('[email-service] Initialization failed:', error.message);
      throw error;
    }
  }

  /**
   * Initialize AWS SES client
   */
  async initializeSES() {
    const region = process.env.AWS_REGION || 'us-east-1';
    
    const config = { region };
    
    // Use explicit credentials if provided, otherwise rely on IAM role
    if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
      config.credentials = {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
      };
    }
    
    this.sesClient = new SESClient(config);
    console.log(`[email-service] AWS SES configured for region: ${region}`);
  }

  /**
   * Initialize SendGrid via nodemailer
   */
  async initializeSendGrid() {
    const apiKey = process.env.SENDGRID_API_KEY;
    
    if (!apiKey) {
      throw new Error('SENDGRID_API_KEY is required for SendGrid provider');
    }
    
    this.transporter = nodemailer.createTransport({
      host: 'smtp.sendgrid.net',
      port: 587,
      secure: false,
      auth: {
        user: 'apikey',
        pass: apiKey
      }
    });
    
    console.log('[email-service] SendGrid SMTP configured');
  }

  /**
   * Initialize generic SMTP
   */
  async initializeSMTP() {
    const host = process.env.SMTP_HOST;
    const port = parseInt(process.env.SMTP_PORT || '587');
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    
    if (!host || !user || !pass) {
      throw new Error('SMTP_HOST, SMTP_USER, and SMTP_PASS are required for SMTP provider');
    }
    
    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass }
    });
    
    console.log(`[email-service] SMTP configured: ${host}:${port}`);
  }

  /**
   * Send email via AWS SES
   */
  async sendViaSES({ to, subject, html, text }) {
    const command = new SendEmailCommand({
      Source: `${this.fromName} <${this.fromEmail}>`,
      Destination: {
        ToAddresses: Array.isArray(to) ? to : [to]
      },
      Message: {
        Subject: { Data: subject },
        Body: {
          Html: { Data: html },
          Text: { Data: text || this.stripHtml(html) }
        }
      }
    });
    
    const response = await this.sesClient.send(command);
    return {
      success: true,
      messageId: response.MessageId,
      provider: 'ses'
    };
  }

  /**
   * Send email via nodemailer (SendGrid or SMTP)
   */
  async sendViaNodemailer({ to, subject, html, text, cc, bcc, attachments }) {
    const info = await this.transporter.sendMail({
      from: `${this.fromName} <${this.fromEmail}>`,
      to: Array.isArray(to) ? to.join(', ') : to,
      cc: cc ? (Array.isArray(cc) ? cc.join(', ') : cc) : undefined,
      bcc: bcc ? (Array.isArray(bcc) ? bcc.join(', ') : bcc) : undefined,
      subject,
      text: text || this.stripHtml(html),
      html,
      attachments
    });
    
    return {
      success: true,
      messageId: info.messageId,
      provider: this.provider
    };
  }

  /**
   * Send email with automatic provider selection
   * 
   * @param {Object} options - Email options
   * @param {string|string[]} options.to - Recipient email(s)
   * @param {string} options.subject - Email subject
   * @param {string} options.html - HTML content
   * @param {string} [options.text] - Plain text content (auto-generated if not provided)
   * @param {string|string[]} [options.cc] - CC recipients
   * @param {string|string[]} [options.bcc] - BCC recipients
   * @param {Array} [options.attachments] - Nodemailer attachments array
   * @returns {Promise<Object>} Result with success, messageId, and provider
   */
  async sendEmail(options) {
    if (!this.initialized) {
      await this.initialize();
    }
    
    const { to, subject, html, text, cc, bcc, attachments } = options;
    
    // Validate required fields
    if (!to || !subject || !html) {
      throw new Error('to, subject, and html are required');
    }
    
    try {
      let result;
      
      if (this.provider === 'ses') {
        result = await this.sendViaSES({ to, subject, html, text });
      } else {
        result = await this.sendViaNodemailer({ to, subject, html, text, cc, bcc, attachments });
      }
      
      console.log(`[email-service] Email sent via ${result.provider} to ${to}`, {
        messageId: result.messageId,
        subject
      });
      
      return result;
    } catch (error) {
      console.error('[email-service] Failed to send email:', error.message);
      throw error;
    }
  }

  /**
   * Send order confirmation email
   */
  async sendOrderConfirmation({ to, orderId, customerName, items, total, farmName }) {
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #2e7d32; color: white; padding: 20px; text-align: center; }
          .content { background: #f9f9f9; padding: 20px; }
          .order-details { background: white; padding: 15px; margin: 15px 0; border-radius: 5px; }
          .item { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #eee; }
          .total { font-size: 1.2em; font-weight: bold; color: #2e7d32; text-align: right; margin-top: 15px; }
          .footer { text-align: center; color: #666; font-size: 0.9em; margin-top: 20px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Order Confirmation</h1>
          </div>
          <div class="content">
            <p>Hi ${customerName},</p>
            <p>Thank you for your order from ${farmName}!</p>
            
            <div class="order-details">
              <h2>Order #${orderId}</h2>
              ${items.map(item => `
                <div class="item">
                  <span>${item.name} x ${item.quantity}</span>
                  <span>$${item.price.toFixed(2)}</span>
                </div>
              `).join('')}
              <div class="total">Total: $${total.toFixed(2)}</div>
            </div>
            
            <p>You will receive a notification when your order is ready for pickup.</p>
          </div>
          <div class="footer">
            <p>${farmName} - Light Engine Foxtrot</p>
          </div>
        </div>
      </body>
      </html>
    `;
    
    return this.sendEmail({
      to,
      subject: `Order Confirmation #${orderId} - ${farmName}`,
      html
    });
  }

  /**
   * Send recall notification email
   */
  async sendRecallNotification({ to, lotCode, productName, reason, customerName }) {
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #d32f2f; color: white; padding: 20px; text-align: center; }
          .alert { background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 15px 0; }
          .content { background: #f9f9f9; padding: 20px; }
          .footer { text-align: center; color: #666; font-size: 0.9em; margin-top: 20px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Product Recall Notice</h1>
          </div>
          <div class="content">
            <p>Dear ${customerName},</p>
            
            <div class="alert">
              <strong>IMPORTANT:</strong> This is a mandatory recall notification.
            </div>
            
            <p>We are issuing a voluntary recall for the following product you purchased:</p>
            
            <ul>
              <li><strong>Product:</strong> ${productName}</li>
              <li><strong>Lot Code:</strong> ${lotCode}</li>
              <li><strong>Reason:</strong> ${reason}</li>
            </ul>
            
            <p><strong>What you should do:</strong></p>
            <ol>
              <li>Do not consume this product</li>
              <li>Return the product to our farm for a full refund</li>
              <li>Contact us if you have any health concerns</li>
            </ol>
            
            <p>We apologize for any inconvenience and take food safety very seriously.</p>
          </div>
          <div class="footer">
            <p>Light Engine Foxtrot - Farm Management System</p>
          </div>
        </div>
      </body>
      </html>
    `;
    
    return this.sendEmail({
      to,
      subject: `URGENT: Product Recall Notice - ${productName}`,
      html
    });
  }

  /**
   * Strip HTML tags for plain text fallback
   */
  stripHtml(html) {
    return html
      .replace(/<style[^>]*>.*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Test email configuration
   */
  async testConnection() {
    if (!this.initialized) {
      await this.initialize();
    }
    
    if (this.transporter) {
      return await this.transporter.verify();
    }
    
    // For SES, just check if client is initialized
    return this.sesClient !== null;
  }
}

// Export singleton instance
export default new EmailService();
