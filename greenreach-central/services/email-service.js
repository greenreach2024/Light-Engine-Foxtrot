/**
 * Email Service — GreenReach Central
 * Tries AWS SES (IAM role on EB), falls back to console log in dev.
 */

const FROM_EMAIL = process.env.FROM_EMAIL || process.env.EMAIL_FROM || 'noreply@greenreachgreens.com';
const FROM_NAME = process.env.FROM_NAME || 'GreenReach Farms';

let sesClient = null;
let sesReady = false;

// Lazy-init SES client on first use
async function getSES() {
  if (sesClient !== null) return sesReady ? sesClient : null;
  try {
    const { SESClient } = await import('@aws-sdk/client-ses');
    sesClient = new SESClient({
      region: process.env.AWS_REGION || 'us-east-1',
      ...(process.env.AWS_ACCESS_KEY_ID ? {
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
        }
      } : {})
    });
    sesReady = true;
    console.log('[email] AWS SES client initialised');
    return sesClient;
  } catch (err) {
    sesClient = false; // mark as failed so we don't retry
    sesReady = false;
    console.warn('[email] AWS SES not available — emails will be logged only:', err.message);
    return null;
  }
}

class EmailService {
  /**
   * Send an email. Returns { success, messageId }.
   * In dev/test without SES, logs to console instead.
   */
  async sendEmail({ to, subject, text, html, from, cc, bcc }) {
    const fromAddress = from || `${FROM_NAME} <${FROM_EMAIL}>`;
    console.log(`[email] → ${to} | ${subject}`);

    const client = await getSES();
    if (client) {
      try {
        const { SendEmailCommand } = await import('@aws-sdk/client-ses');

        const Destination = { ToAddresses: Array.isArray(to) ? to : [to] };
        if (cc) Destination.CcAddresses = Array.isArray(cc) ? cc : [cc];
        if (bcc) Destination.BccAddresses = Array.isArray(bcc) ? bcc : [bcc];

        const cmd = new SendEmailCommand({
          Source: fromAddress,
          Destination,
          Message: {
            Subject: { Data: subject, Charset: 'UTF-8' },
            Body: {
              ...(text ? { Text: { Data: text, Charset: 'UTF-8' } } : {}),
              ...(html ? { Html: { Data: html, Charset: 'UTF-8' } } : {})
            }
          }
        });

        const result = await client.send(cmd);
        const messageId = result.MessageId || result.$metadata?.requestId || `ses-${Date.now()}`;
        console.log(`[email] ✅ Sent via SES: ${messageId}`);
        return { success: true, messageId };
      } catch (sesErr) {
        console.error('[email] ❌ SES send failed:', sesErr.message);
        // Fall through to stub
      }
    }

    // Stub fallback (dev / SES unavailable)
    console.log(`[email] STUB — would send to ${to}: ${subject}`);
    if (text) console.log(`[email] Body preview: ${text.substring(0, 200)}`);
    return { success: true, messageId: `stub-${Date.now()}`, stub: true };
  }

  async sendOrderConfirmation(order, buyer) {
    const items = (order.farm_sub_orders || [])
      .flatMap(sub => (sub.items || []).map(it => `  • ${it.product_name || it.sku_id} × ${it.quantity}`))
      .join('\n');

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
        '— GreenReach Farms'
      ].filter(Boolean).join('\n')
    });
  }
}

export default new EmailService();
