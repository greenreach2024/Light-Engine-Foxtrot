/**
 * Email Service — GreenReach Central
 * Transport: Google Workspace SMTP (smtp.gmail.com).
 * Fallback: console log stub in dev.
 *
 * Google SMTP requires an App Password for peter@greenreachgreens.com.
 * Generate at: https://myaccount.google.com/apppasswords
 * Set SMTP_HOST=smtp.gmail.com, SMTP_PORT=587, SMTP_USER=peter@greenreachgreens.com,
 * SMTP_PASS=<app-password> in Cloud Run env / Secret Manager.
 */

import nodemailer from 'nodemailer';
import notificationStore from './notification-store.js';

const FROM_EMAIL = process.env.FROM_EMAIL || process.env.EMAIL_FROM || 'peter@greenreachgreens.com';
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
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
          <div style="background-color: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
            <h1 style="color: #2d3748; margin-bottom: 20px; font-size: 24px;">Order Confirmation</h1>
            <p style="color: #4a5568; font-size: 16px; line-height: 1.6;">Hi ${buyer.contactName || buyer.businessName},</p>
            <p style="color: #4a5568; font-size: 16px; line-height: 1.6;">Thank you for your order <strong>#${order.master_order_id}</strong>. We're excited to fulfill your wholesale needs!</p>
            
            <div style="background-color: #f7fafc; padding: 20px; border-radius: 6px; margin: 20px 0;">
              <h3 style="color: #2d3748; margin-top: 0; font-size: 18px;">Order Details</h3>
              <p style="margin: 5px 0; color: #4a5568;"><strong>Total:</strong> $${Number(order.grand_total || 0).toFixed(2)} CAD</p>
              ${order.delivery_date ? `<p style="margin: 5px 0; color: #4a5568;"><strong>Delivery Date:</strong> ${order.delivery_date}</p>` : ''}
            </div>
            
            <div style="background-color: #f7fafc; padding: 20px; border-radius: 6px; margin: 20px 0;">
              <h3 style="color: #2d3748; margin-top: 0; font-size: 18px;">Items Ordered</h3>
              <div style="color: #4a5568; line-height: 1.6;">
                ${items ? items.split('\n').map(item => `<div style="margin: 5px 0;">${item}</div>`).join('') : '<p>See your account for detailed item list</p>'}
              </div>
            </div>
            
            <p style="color: #4a5568; font-size: 16px; line-height: 1.6;">You can check your order status anytime in the <a href="https://greenreachgreens.com/wholesale" style="color: #10b981; text-decoration: none;">wholesale portal</a>.</p>
            
            <div style="border-top: 1px solid #e2e8f0; margin: 30px 0; padding-top: 20px;">
              <p style="color: #718096; font-size: 14px; margin: 0;">Questions? Reply to this email or contact peter@greenreachgreens.com</p>
              <p style="color: #718096; font-size: 14px; margin: 10px 0 0 0;">-- GreenReach Farms<br>${BUSINESS_ADDRESS}</p>
            </div>
          </div>
        </div>
      `,
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
        'peter@greenreachgreens.com | greenreachgreens.com'
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
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
        <div style="background-color: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
          <h1 style="color: #2d3748; margin-bottom: 20px; font-size: 24px;">Invoice ${invoice_number || order_id || ''}</h1>
          <p style="color: #4a5568; font-size: 16px; line-height: 1.6;">Hi ${buyer_name || 'there'},</p>
          <p style="color: #4a5568; font-size: 16px; line-height: 1.6;">Please find your invoice details below:</p>
          
          <table style="width:100%; border-collapse: collapse; margin: 20px 0; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 6px; overflow: hidden;">
            <thead>
              <tr style="background-color: #f7fafc;">
                <th style="padding: 12px; text-align: left; border-bottom: 2px solid #e2e8f0; font-weight: 600; color: #2d3748;">Item</th>
                <th style="padding: 12px; text-align: center; border-bottom: 2px solid #e2e8f0; font-weight: 600; color: #2d3748;">Qty</th>
                <th style="padding: 12px; text-align: right; border-bottom: 2px solid #e2e8f0; font-weight: 600; color: #2d3748;">Unit Price</th>
                <th style="padding: 12px; text-align: right; border-bottom: 2px solid #e2e8f0; font-weight: 600; color: #2d3748;">Total</th>
              </tr>
            </thead>
            <tbody>${lineItems}</tbody>
            <tfoot>
              <tr style="background-color: #f7fafc;">
                <td colspan="3" style="padding: 12px; text-align: right; font-weight: bold; color: #2d3748;">Subtotal:</td>
                <td style="padding: 12px; text-align: right; font-weight: bold; color: #2d3748;">$${Number(subtotal).toFixed(2)}</td>
              </tr>
              <tr style="background-color: #f7fafc;">
                <td colspan="3" style="padding: 12px; text-align: right; font-weight: bold; color: #2d3748;">Tax (HST):</td>
                <td style="padding: 12px; text-align: right; font-weight: bold; color: #2d3748;">$${Number(tax_amount).toFixed(2)}</td>
              </tr>
              <tr style="background-color: #f7fafc; border-top: 2px solid #e2e8f0;">
                <td colspan="3" style="padding: 12px; text-align: right; font-weight: bold; font-size: 18px; color: #2d3748;">Total Due:</td>
                <td style="padding: 12px; text-align: right; font-weight: bold; font-size: 18px; color: #10b981;">$${Number(total).toFixed(2)} CAD</td>
              </tr>
            </tfoot>
          </table>
          
          <div style="background-color: #f7fafc; padding: 20px; border-radius: 6px; margin: 20px 0;">
            <p style="margin: 0; color: #4a5568;"><strong>Payment Terms:</strong> ${payment_terms}</p>
            ${due_date ? `<p style="margin: 10px 0 0 0; color: #4a5568;"><strong>Due Date:</strong> ${due_date}</p>` : ''}
          </div>
          
          <p style="color: #4a5568; font-size: 16px; line-height: 1.6;">If you have questions about this invoice, reply to this email or contact us at peter@greenreachgreens.com.</p>
          
          <div style="border-top: 1px solid #e2e8f0; margin: 30px 0; padding-top: 20px;">
            <p style="color: #718096; font-size: 14px; margin: 0;">-- GreenReach Farms<br>${BUSINESS_ADDRESS}</p>
          </div>
        </div>
      </div>
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
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
        <div style="background-color: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
          <h1 style="color: #c53030; margin-bottom: 20px; font-size: 24px;">Payment Failed</h1>
          <p style="color: #4a5568; font-size: 16px; line-height: 1.6;">Hi ${buyer_name || 'there'},</p>
          <p style="color: #4a5568; font-size: 16px; line-height: 1.6;">We were unable to process your payment of <strong>$${Number(amount || 0).toFixed(2)} CAD</strong> for order <strong>#${String(order_id || '').substring(0, 8)}</strong>.</p>
          
          ${reason ? `<div style="background-color: #fef2f2; padding: 15px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #c53030;">
            <p style="margin: 0; color: #742a2a; font-weight: 500;"><strong>Reason:</strong> ${reason}</p>
          </div>` : ''}
          
          <p style="color: #4a5568; font-size: 16px; line-height: 1.6;">Please update your payment method and try again through the <a href="https://greenreachgreens.com/wholesale" style="color: #10b981; text-decoration: none;">wholesale portal</a>, or contact us for assistance.</p>
          
          <p style="color: #4a5568; font-size: 16px; line-height: 1.6;">If you believe this is an error, please reply to this email or contact peter@greenreachgreens.com.</p>
          
          <div style="border-top: 1px solid #e2e8f0; margin: 30px 0; padding-top: 20px;">
            <p style="color: #718096; font-size: 14px; margin: 0;">-- GreenReach Farms<br>${BUSINESS_ADDRESS}</p>
          </div>
        </div>
      </div>
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
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
        <div style="background-color: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
          <h1 style="color: #2d3748; margin-bottom: 20px; font-size: 24px;">Refund Processed</h1>
          <p style="color: #4a5568; font-size: 16px; line-height: 1.6;">Hi ${buyer_name || 'there'},</p>
          <p style="color: #4a5568; font-size: 16px; line-height: 1.6;">A refund of <strong>$${Number(amount || 0).toFixed(2)} CAD</strong> has been processed for order <strong>#${String(order_id || '').substring(0, 8)}</strong>.</p>
          
          <div style="background-color: #f0fdf4; padding: 20px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #10b981;">
            <p style="margin: 0; color: #166534;">The refund should appear in your account within 5-10 business days depending on your bank.</p>
          </div>
          
          ${refund_id ? `<p style="color: #4a5568; font-size: 16px; line-height: 1.6;"><strong>Refund Reference:</strong> ${refund_id}</p>` : ''}
          
          <p style="color: #4a5568; font-size: 16px; line-height: 1.6;">If you have questions, reply to this email or contact peter@greenreachgreens.com.</p>
          
          <div style="border-top: 1px solid #e2e8f0; margin: 30px 0; padding-top: 20px;">
            <p style="color: #718096; font-size: 14px; margin: 0;">-- GreenReach Farms<br>${BUSINESS_ADDRESS}</p>
          </div>
        </div>
      </div>
    `;

    return this.sendEmail({
      to: buyerEmail,
      subject: `Refund Processed - Order #${String(order_id || '').substring(0, 8)}`,
      html,
      text: `Refund Processed\n\nA refund of $${Number(amount || 0).toFixed(2)} CAD has been processed for order #${String(order_id || '').substring(0, 8)}.\nThe refund should appear in your account within 5-10 business days.\n${refund_id ? `Refund Reference: ${refund_id}\n` : ''}\n-- GreenReach Farms\n${BUSINESS_ADDRESS}`
    });
  }

  /**
   * Send a lot recall notification to admin and affected buyers.
   * Safety-critical — always require explicit admin confirmation before calling.
   *
   * @param {Object}   recallData
   * @param {string}   recallData.lot_number     - Lot identifier (e.g. GREE-20260319-001)
   * @param {string}   recallData.crop            - Crop name
   * @param {string}   recallData.reason          - Reason for recall (required)
   * @param {string}   recallData.farm_name       - Originating farm name
   * @param {string[]} recallData.affected_orders - Order IDs linked to this lot
   * @param {Array}    recallData.buyer_contacts  - Array of { name, email } for affected buyers
   * @param {string}   recallData.admin_email     - Admin address for confirmation copy
   * @param {string}   [recallData.instructions]  - Optional return/disposal instructions
   */
  async sendRecallNotification(recallData) {
    const {
      lot_number,
      crop,
      reason,
      farm_name,
      affected_orders = [],
      buyer_contacts = [],
      admin_email,
      instructions
    } = recallData;

    if (!lot_number || !reason) {
      return { success: false, error: 'lot_number and reason are required for recall notifications' };
    }

    const recallDate = new Date().toLocaleDateString('en-CA');
    const orderList = affected_orders.length
      ? affected_orders.map(id => `  • ${id}`).join('\n')
      : '  • None on record';

    // Admin confirmation copy
    if (admin_email) {
      const adminHtml = `
        <div style="font-family:sans-serif;max-width:680px;border:2px solid #dc2626;border-radius:6px;padding:24px;">
          <h2 style="color:#dc2626;margin-top:0;">Lot Recall Initiated — ${lot_number}</h2>
          <table style="border-collapse:collapse;width:100%;margin-bottom:16px;">
            <tr><td style="padding:8px;border-bottom:1px solid #eee;font-weight:600;">Lot Number</td><td style="padding:8px;border-bottom:1px solid #eee;">${lot_number}</td></tr>
            <tr><td style="padding:8px;border-bottom:1px solid #eee;font-weight:600;">Crop</td><td style="padding:8px;border-bottom:1px solid #eee;">${crop || 'Unknown'}</td></tr>
            <tr><td style="padding:8px;border-bottom:1px solid #eee;font-weight:600;">Farm</td><td style="padding:8px;border-bottom:1px solid #eee;">${farm_name || 'Unknown'}</td></tr>
            <tr><td style="padding:8px;border-bottom:1px solid #eee;font-weight:600;">Recall Date</td><td style="padding:8px;border-bottom:1px solid #eee;">${recallDate}</td></tr>
            <tr><td style="padding:8px;border-bottom:1px solid #eee;font-weight:600;">Reason</td><td style="padding:8px;border-bottom:1px solid #eee;">${reason}</td></tr>
            <tr><td style="padding:8px;border-bottom:1px solid #eee;font-weight:600;">Affected Orders</td><td style="padding:8px;border-bottom:1px solid #eee;">${affected_orders.join(', ') || 'None'}</td></tr>
            <tr><td style="padding:8px;font-weight:600;">Buyers Notified</td><td style="padding:8px;">${buyer_contacts.length}</td></tr>
          </table>
          ${instructions ? `<p><strong>Instructions:</strong> ${instructions}</p>` : ''}
          <p style="font-size:12px;color:#666;">Initiated by F.A.Y.E. (Farm Autonomy &amp; Yield Engine) — admin confirmed</p>
        </div>`;
      const adminText = [
        `LOT RECALL INITIATED — ${lot_number}`,
        `Lot: ${lot_number}  Crop: ${crop || 'Unknown'}  Farm: ${farm_name || 'Unknown'}`,
        `Date: ${recallDate}  Reason: ${reason}`,
        `Affected Orders:\n${orderList}`,
        `Buyers to notify: ${buyer_contacts.length}`,
        instructions ? `Instructions: ${instructions}` : '',
        `— F.A.Y.E. (Farm Autonomy & Yield Engine)`
      ].filter(Boolean).join('\n');
      await this.sendEmail({
        to: admin_email,
        subject: `[RECALL] Lot ${lot_number} — ${crop || 'Produce'} — Action Required`,
        html: adminHtml,
        text: adminText
      });
    }

    // One email per affected buyer
    const buyerResults = [];
    for (const buyer of buyer_contacts) {
      if (!buyer.email) continue;
      const buyerHtml = `
        <div style="font-family:sans-serif;max-width:640px;">
          <h2 style="color:#dc2626;">Important: Product Recall Notice</h2>
          <p>Dear ${buyer.name || 'Valued Customer'},</p>
          <p>One or more orders you received from <strong>GreenReach Farms</strong> may include produce from a recalled lot.</p>
          <table style="border-collapse:collapse;width:100%;margin:16px 0;">
            <tr><td style="padding:8px;border-bottom:1px solid #eee;font-weight:600;">Lot Number</td><td style="padding:8px;border-bottom:1px solid #eee;">${lot_number}</td></tr>
            <tr><td style="padding:8px;border-bottom:1px solid #eee;font-weight:600;">Product</td><td style="padding:8px;border-bottom:1px solid #eee;">${crop || 'Produce'}</td></tr>
            <tr><td style="padding:8px;font-weight:600;">Recall Reason</td><td style="padding:8px;">${reason}</td></tr>
          </table>
          <p><strong>Please do not consume or distribute this product.</strong> ${instructions || 'Dispose of the product safely or contact us for return instructions.'}</p>
          <p>We sincerely apologize for the inconvenience. Contact us at <a href="mailto:peter@greenreachgreens.com">peter@greenreachgreens.com</a>.</p>
          <p>-- GreenReach Farms</p>
        </div>`;
      const buyerText = [
        `IMPORTANT: Product Recall Notice`,
        `Dear ${buyer.name || 'Valued Customer'},`,
        `One or more orders you received from GreenReach Farms may include produce from a recalled lot.`,
        `Lot: ${lot_number}  Product: ${crop || 'Produce'}  Reason: ${reason}`,
        `Please do not consume or distribute this product.`,
        instructions || 'Dispose safely or contact us for return instructions.',
        `Contact: peter@greenreachgreens.com`,
        `-- GreenReach Farms  ${BUSINESS_ADDRESS}`
      ].join('\n');
      const r = await this.sendEmail({
        to: buyer.email,
        subject: `[RECALL NOTICE] ${crop || 'Produce'} — Lot ${lot_number}`,
        html: buyerHtml,
        text: buyerText
      });
      buyerResults.push({ email: buyer.email, ...r });
    }

    return {
      success: true,
      lot_number,
      admin_notified: !!admin_email,
      buyers_notified: buyerResults.filter(r => r.success).length,
      buyers_failed: buyerResults.filter(r => !r.success).length,
      buyer_results: buyerResults
    };
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
