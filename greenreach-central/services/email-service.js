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

    // RFC 8058 List-Unsubscribe header for CAN-SPAM / CASL compliance
    const unsubscribeUrl = `https://greenreachgreens.com/unsubscribe?email=${encodeURIComponent(to)}`;
    const unsubscribeHeaders = {
      'List-Unsubscribe': `<${unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
    };

    // Google Workspace SMTP
    if (SMTP_ENABLED) {
      const transport = getSmtpTransport();
      if (transport) {
        try {
          const smtpFrom = `${FROM_NAME} <${SMTP_USER || FROM_EMAIL}>`;
          const mailOpts = { from: smtpFrom, to, subject, headers: unsubscribeHeaders };
          if (html) mailOpts.html = html + `\n<p style="font-size:11px;color:#999;margin-top:30px;">${BUSINESS_ADDRESS}<br><a href="${unsubscribeUrl}" style="color:#999;">Unsubscribe</a></p>`;
          if (text) mailOpts.text = text + `\n\n${BUSINESS_ADDRESS}\nUnsubscribe: ${unsubscribeUrl}`;
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

  /**
   * Send an invoice email to a buyer with line items and payment terms
   */
  async sendInvoiceEmail(buyerEmail, invoiceData) {
    const {
      invoice_number,
      buyer_name,
      items = [],
      subtotal = 0,
      tax_amount = 0,
      total = 0,
      due_date,
      payment_terms = 'Due on receipt',
      order_id
    } = invoiceData;

    const lineItems = items.map(it =>
      `<tr><td style="padding:8px;border-bottom:1px solid #ddd;">${it.name || it.product_name || it.sku_id}</td>` +
      `<td style="padding:8px;border-bottom:1px solid #ddd;text-align:center;">${it.quantity || it.qty}</td>` +
      `<td style="padding:8px;border-bottom:1px solid #ddd;text-align:right;">$${Number(it.unit_price || 0).toFixed(2)}</td>` +
      `<td style="padding:8px;border-bottom:1px solid #ddd;text-align:right;">$${Number(it.line_total || 0).toFixed(2)}</td></tr>`
    ).join('');

    const html = `
      <h2 style="color:#2d3748;">Invoice ${invoice_number || order_id || ''}</h2>
      <p>Hi ${buyer_name || 'there'},</p>
      <p>Please find your invoice details below:</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;">
        <thead>
          <tr style="background:#f7fafc;">
            <th style="padding:8px;text-align:left;border-bottom:2px solid #e2e8f0;">Item</th>
            <th style="padding:8px;text-align:center;border-bottom:2px solid #e2e8f0;">Qty</th>
            <th style="padding:8px;text-align:right;border-bottom:2px solid #e2e8f0;">Unit Price</th>
            <th style="padding:8px;text-align:right;border-bottom:2px solid #e2e8f0;">Total</th>
          </tr>
        </thead>
        <tbody>${lineItems}</tbody>
        <tfoot>
          <tr><td colspan="3" style="padding:8px;text-align:right;font-weight:bold;">Subtotal:</td><td style="padding:8px;text-align:right;">$${Number(subtotal).toFixed(2)}</td></tr>
          <tr><td colspan="3" style="padding:8px;text-align:right;font-weight:bold;">Tax (HST):</td><td style="padding:8px;text-align:right;">$${Number(tax_amount).toFixed(2)}</td></tr>
          <tr><td colspan="3" style="padding:8px;text-align:right;font-weight:bold;font-size:16px;">Total Due:</td><td style="padding:8px;text-align:right;font-weight:bold;font-size:16px;">$${Number(total).toFixed(2)} CAD</td></tr>
        </tfoot>
      </table>
      <p><strong>Payment Terms:</strong> ${payment_terms}</p>
      ${due_date ? `<p><strong>Due Date:</strong> ${due_date}</p>` : ''}
      <p>If you have questions about this invoice, reply to this email or contact us at info@greenreachgreens.com.</p>
      <p>-- GreenReach Farms</p>
    `;

    const textItems = items.map(it => `  - ${it.name || it.product_name} x${it.quantity || it.qty} @ $${Number(it.unit_price || 0).toFixed(2)} = $${Number(it.line_total || 0).toFixed(2)}`).join('\n');

    return this.sendEmail({
      to: buyerEmail,
      subject: `Invoice ${invoice_number || order_id || ''} from GreenReach Farms`,
      html,
      text: `Invoice ${invoice_number || order_id || ''}\n\nItems:\n${textItems}\n\nSubtotal: $${Number(subtotal).toFixed(2)}\nTax: $${Number(tax_amount).toFixed(2)}\nTotal: $${Number(total).toFixed(2)} CAD\n\nPayment Terms: ${payment_terms}\n${due_date ? `Due Date: ${due_date}\n` : ''}-- GreenReach Farms\n${BUSINESS_ADDRESS}`
    });
  }

  /**
   * Send a payment failure alert to a buyer with retry instructions
   */
  async sendPaymentFailureEmail(buyerEmail, failureData) {
    const {
      order_id,
      amount,
      reason,
      buyer_name
    } = failureData;

    const html = `
      <h2 style="color:#c53030;">Payment Failed</h2>
      <p>Hi ${buyer_name || 'there'},</p>
      <p>We were unable to process your payment of <strong>$${Number(amount || 0).toFixed(2)} CAD</strong> for order <strong>#${String(order_id || '').substring(0, 8)}</strong>.</p>
      ${reason ? `<p><strong>Reason:</strong> ${reason}</p>` : ''}
      <p>Please update your payment method and try again through the wholesale portal, or contact us for assistance.</p>
      <p>If you believe this is an error, please reply to this email or contact info@greenreachgreens.com.</p>
      <p>-- GreenReach Farms</p>
    `;

    return this.sendEmail({
      to: buyerEmail,
      subject: `Payment Failed - Order #${String(order_id || '').substring(0, 8)}`,
      html,
      text: `Payment Failed\n\nWe were unable to process your payment of $${Number(amount || 0).toFixed(2)} CAD for order #${String(order_id || '').substring(0, 8)}.\n${reason ? `Reason: ${reason}\n` : ''}Please update your payment method and try again.\n\n-- GreenReach Farms\n${BUSINESS_ADDRESS}`
    });
  }

  /**
   * Send a refund confirmation email to a buyer
   */
  async sendRefundConfirmationEmail(buyerEmail, refundData) {
    const {
      order_id,
      amount,
      refund_id,
      buyer_name
    } = refundData;

    const html = `
      <h2 style="color:#2d3748;">Refund Processed</h2>
      <p>Hi ${buyer_name || 'there'},</p>
      <p>A refund of <strong>$${Number(amount || 0).toFixed(2)} CAD</strong> has been processed for order <strong>#${String(order_id || '').substring(0, 8)}</strong>.</p>
      <p>The refund should appear in your account within 5-10 business days depending on your bank.</p>
      ${refund_id ? `<p><strong>Refund Reference:</strong> ${refund_id}</p>` : ''}
      <p>If you have questions, reply to this email or contact info@greenreachgreens.com.</p>
      <p>-- GreenReach Farms</p>
    `;

    return this.sendEmail({
      to: buyerEmail,
      subject: `Refund Processed - Order #${String(order_id || '').substring(0, 8)}`,
      html,
      text: `Refund Processed\n\nA refund of $${Number(amount || 0).toFixed(2)} CAD has been processed for order #${String(order_id || '').substring(0, 8)}.\nThe refund should appear in your account within 5-10 business days.\n${refund_id ? `Refund Reference: ${refund_id}\n` : ''}\n-- GreenReach Farms\n${BUSINESS_ADDRESS}`
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
