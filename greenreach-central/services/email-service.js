/**
 * Email Service — GreenReach Central
 * Transport: Google Workspace SMTP (smtp.gmail.com).
 * Fallback: console log stub in dev.
 *
 * Google SMTP requires an App Password for info@greenreachgreens.com.
 * Generate at: https://myaccount.google.com/apppasswords
 * Set SMTP_HOST=smtp.gmail.com, SMTP_PORT=587, SMTP_USER=info@greenreachgreens.com,
 * SMTP_PASS=<app-password> in Cloud Run env / Secret Manager.
 */

import nodemailer from 'nodemailer';
import notificationStore from './notification-store.js';

const FROM_EMAIL = process.env.FROM_EMAIL || process.env.EMAIL_FROM || 'info@greenreachgreens.com';
const FROM_NAME = process.env.FROM_NAME || 'GreenReach Farms';

// Business address for CAN-SPAM / CASL compliance (included in all email footers)
const BUSINESS_ADDRESS = 'GreenReach Greens -- Ottawa, ON, Canada';

// SMTP config (Google Workspace) — primary email transport
const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587');
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const SMTP_ENABLED = !!(SMTP_HOST && SMTP_USER && SMTP_PASS);

let _smtpTransport = null;

function getSmtpTransport() {
  if (_smtpTransport) return _smtpTransport;
  if (!SMTP_ENABLED) return null;
  try {
    _smtpTransport = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS }
    });
    console.log('[email] SMTP transport ready (Google Workspace)');
    return _smtpTransport;
  } catch (err) {
    console.error('[email] Failed to create SMTP transport:', err.message);
    return null;
  }
}

class EmailService {
  /**
   * Send an email via Google Workspace SMTP. Returns { success, messageId }.
   */
  async sendEmail({ to, subject, text, html, from, cc, bcc, farmId, notifCategory }) {
    const fromAddress = from || `${FROM_NAME} <${FROM_EMAIL}>`;
    console.log(`[email] -> ${to} | ${subject}`);


    // Google Workspace SMTP
    if (SMTP_ENABLED) {
      const transport = getSmtpTransport();
      if (transport) {
        try {
          const smtpFrom = `${FROM_NAME} <${SMTP_USER || FROM_EMAIL}>`;
          const mailOpts = { from: smtpFrom, to, subject };
          if (html) mailOpts.html = html;
          if (text) mailOpts.text = text;
          if (cc) mailOpts.cc = cc;
          if (bcc) mailOpts.bcc = bcc;
          const result = await transport.sendMail(mailOpts);
          console.log(`[email] SMTP sent to ${to}: ${subject} (id: ${result.messageId})`);
          return { success: true, messageId: result.messageId, via: 'smtp' };
        } catch (smtpErr) {
          console.error(`[email] SMTP failed to ${to}:`, smtpErr.message);
        }
      }
    }

    // Stub fallback -- NO email sent (SMTP unavailable)
    console.warn(`[EMAIL WARNING] NO TRANSPORT AVAILABLE -- email to ${to} was NOT sent: ${subject}`);
    console.warn(`[EMAIL WARNING] Configure SMTP_HOST/SMTP_USER/SMTP_PASS env vars (Google Workspace App Password)`);
    if (text) console.warn(`[email] Body preview: ${text.substring(0, 200)}`);
    return { success: false, messageId: `stub-${Date.now()}`, stub: true, error: "No email transport configured" };
  }

  /**
   * Push an in-app notification to EVIE after any sendEmail call.
   * Called automatically by sendOrderConfirmation and can be called manually.
   */
  async _pushNotification(farmId, subject, body, category) {
    if (!farmId) return;
    try {
      await notificationStore.pushNotification(farmId, {
        category: category || 'general',
        title: subject,
        body: body || null,
        severity: 'info',
        source: 'email'
      });
    } catch (err) {
      console.warn('[email] Notification push failed (non-fatal):', err.message);
    }
  }

  async sendOrderConfirmation(order, buyer) {
    const items = (order.farm_sub_orders || [])
      .flatMap(sub => (sub.items || []).map(it => `  • ${it.product_name || it.sku_id} × ${it.quantity}`))
      .join('\n');

    // Push in-app notification to all farms in the order
    const farmIds = (order.farm_sub_orders || []).map(sub => sub.farm_id).filter(Boolean);
    for (const fid of [...new Set(farmIds)]) {
      await this._pushNotification(fid, `New Order #${order.master_order_id}`,
        `Order from ${buyer.contactName || buyer.businessName || buyer.email} - $${Number(order.grand_total || 0).toFixed(2)}`,
        'order');
    }

    return this.sendEmail({
      to: buyer.email,
      subject: `Order Confirmation #${order.master_order_id}`,
      text: [
        `Hi ${buyer.contactName || buyer.businessName},`,
        '',
        `Thank you for your order #${order.master_order_id}.`,
        '',
        'Items:',
        items || '  (see your account for details)',
        '',
        `Total: $${Number(order.grand_total || 0).toFixed(2)}`,
        order.delivery_date ? `Delivery date: ${order.delivery_date}` : '',
        '',
        'You can check your order status any time in the wholesale portal.',
        '',
        '-- GreenReach Farms',
        `${BUSINESS_ADDRESS}`,
        'info@greenreachgreens.com | greenreachgreens.com'
      ].filter(Boolean).join('\n')
    });
  }
}

/**
 * Send a research invitation email (Light Engine Research Beta)
 * @param {Object} param0 { name, email, code }
 */
async function sendResearchInviteEmail({ name, email, code }) {
  const subject = 'Invitation: Light Engine Research Beta Access';
  const html = `
    <h2>Welcome to the Light Engine Research Beta</h2>
    <p>Hi ${name},</p>
    <p>You have been invited to explore the new Light Engine Research Beta. Your access code is:</p>
    <div style="font-size:1.5em;font-weight:bold;margin:16px 0;">${code}</div>
    <p><b>What is Light Engine?</b><br>
    The Light Engine is a cloud-based platform built to support indoor growers and researchers. It provides live data streaming from a growing network of farms, bridging research and real-world practice.</p>
    <ul>
      <li><b>For Growers:</b> Real-time monitoring, AI-driven insights, and the ability to test new lighting, nutrient, and environment recipes.</li>
      <li><b>For Researchers:</b> Introduce theoretical protocols, run experiments across multiple farms, and receive real-world feedback to accelerate validation.</li>
    </ul>
    <p>This is a unique opportunity to access live data, collaborate with growers, and help move the CEA industry forward. Please use your code to register for the Research Beta. We welcome your feedback and ideas!</p>
    <p>Best regards,<br>GreenReach & Light Engine Team</p>
  `;
  const text = `Hi ${name},\n\nYou have been invited to the Light Engine Research Beta.\nYour access code: ${code}\n\nWhat is Light Engine?\n- For Growers: Real-time monitoring, AI-driven insights, and the ability to test new lighting, nutrient, and environment recipes.\n- For Researchers: Introduce theoretical protocols, run experiments across multiple farms, and receive real-world feedback to accelerate validation.\n\nThis is a unique opportunity to access live data, collaborate with growers, and help move the CEA industry forward.\n\nBest,\nGreenReach & Light Engine Team`;
  await emailService.sendEmail({ to: email, subject, html, text });
}

export { sendResearchInviteEmail };

export default new EmailService();
