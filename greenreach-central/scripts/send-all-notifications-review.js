/**
 * Send All Notification Templates to admin@greenreachgreens.com
 * One-time review script — sends every email template with sample data.
 * Run: node scripts/send-all-notifications-review.js
 */

import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { sendBuyerWelcomeEmail, sendBuyerMonthlyStatement, sendProducerMonthlyStatement } from '../services/email-new-templates.js';

const REVIEW_EMAIL = 'admin@greenreachgreens.com';
const SES_FROM = process.env.SES_FROM_EMAIL || 'admin@greenreachgreens.com';
const SES_REGION = process.env.SES_REGION || 'us-east-1';

const ses = new SESClient({ region: SES_REGION });

async function send({ subject, html, text }) {
  const params = {
    Source: `GreenReach <${SES_FROM}>`,
    Destination: { ToAddresses: [REVIEW_EMAIL] },
    Message: {
      Subject: { Data: subject, Charset: 'UTF-8' },
      Body: {},
    },
  };
  if (html) params.Message.Body.Html = { Data: html, Charset: 'UTF-8' };
  if (text) params.Message.Body.Text = { Data: text, Charset: 'UTF-8' };

  const result = await ses.send(new SendEmailCommand(params));
  console.log(`  Sent: ${subject} (${result.MessageId})`);
}

// Pause between sends to avoid SES throttle
const pause = (ms) => new Promise(r => setTimeout(r, ms));

// ── 1. Welcome Email ────────────────────────────────────────────────
async function sendWelcome() {
  const firstName = 'Sarah';
  const farmName = 'Riverside Greens';
  const farmId = 'FARM-ABCD1234-EF567890';
  const email = REVIEW_EMAIL;
  const tempPassword = 'Maple-River-7842';
  const planType = 'cloud';
  const loginUrl = 'https://greenreachgreens.com/farm-admin-login.html';
  const dashboardUrl = 'https://greenreachgreens.com/farm-admin.html';

  const subject = '[REVIEW 1/8] Welcome to Light Engine -- Your Farm Account is Ready';

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Oxygen,Ubuntu,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:white;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:linear-gradient(135deg,#0f172a 0%,#1e293b 100%);padding:32px 40px;text-align:center;">
            <h1 style="color:white;margin:0;font-size:24px;font-weight:700;">Welcome to Light Engine</h1>
            <p style="color:#94a3b8;margin:8px 0 0;font-size:14px;">Your farm management platform is ready</p>
          </td>
        </tr>
        <tr>
          <td style="padding:32px 40px;">
            <p style="color:#1a202c;font-size:16px;line-height:1.6;margin:0 0 20px;">Hi ${firstName},</p>
            <p style="color:#4a5568;font-size:15px;line-height:1.6;margin:0 0 24px;">
              Your payment has been confirmed and your Light Engine Cloud account for <strong>${farmName}</strong> is now active. Here are your login credentials:
            </p>
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdf4;border:2px solid #86efac;border-radius:10px;margin:0 0 24px;">
              <tr><td style="padding:20px 24px;">
                <p style="color:#166534;font-weight:700;font-size:15px;margin:0 0 16px;">Your Login Credentials</p>
                <table width="100%" cellspacing="0" cellpadding="0">
                  <tr>
                    <td style="padding:8px 0;color:#6b7280;font-size:13px;font-weight:500;text-transform:uppercase;letter-spacing:0.5px;width:140px;">Farm ID</td>
                    <td style="padding:8px 0;color:#1a202c;font-size:16px;font-weight:700;font-family:'SF Mono','Fira Code',Consolas,monospace;">${farmId}</td>
                  </tr>
                  <tr>
                    <td style="padding:8px 0;border-top:1px solid #d1fae5;color:#6b7280;font-size:13px;font-weight:500;text-transform:uppercase;letter-spacing:0.5px;">Temp Password</td>
                    <td style="padding:8px 0;border-top:1px solid #d1fae5;color:#1a202c;font-size:16px;font-weight:700;font-family:'SF Mono','Fira Code',Consolas,monospace;">${tempPassword}</td>
                  </tr>
                  <tr>
                    <td style="padding:8px 0;border-top:1px solid #d1fae5;color:#6b7280;font-size:13px;font-weight:500;text-transform:uppercase;letter-spacing:0.5px;">Email</td>
                    <td style="padding:8px 0;border-top:1px solid #d1fae5;color:#1a202c;font-size:15px;font-weight:600;">${email}</td>
                  </tr>
                </table>
              </td></tr>
            </table>
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr><td align="center" style="padding:8px 0 24px;">
                <a href="${dashboardUrl}" style="display:inline-block;background:#10b981;color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:16px;">
                  Go to Your Farm Dashboard
                </a>
              </td></tr>
            </table>
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;margin:0 0 24px;">
              <tr><td style="padding:20px 24px;">
                <p style="color:#2d3748;font-weight:700;font-size:15px;margin:0 0 14px;">Getting Started</p>
                <p style="color:#4a5568;font-size:14px;line-height:1.7;margin:0 0 8px;">
                  <strong>1.</strong> Open your dashboard using the button above or visit the login page
                </p>
                <p style="color:#4a5568;font-size:14px;line-height:1.7;margin:0 0 8px;">
                  <strong>2.</strong> Enter your <strong>Farm ID</strong> and <strong>Temporary Password</strong> to log in
                </p>
                <p style="color:#4a5568;font-size:14px;line-height:1.7;margin:0 0 8px;">
                  <strong>3.</strong> Set up your grow rooms, zones, and crops in Farm Settings
                </p>
                <p style="color:#4a5568;font-size:14px;line-height:1.7;margin:0;">
                  <strong>4.</strong> Start managing your farm operations
                </p>
              </td></tr>
            </table>
            <p style="color:#64748b;font-size:13px;text-align:center;margin:0 0 8px;">
              Login page for other devices:
            </p>
            <p style="text-align:center;margin:0 0 24px;">
              <a href="${loginUrl}" style="color:#3b82f6;font-size:14px;text-decoration:none;font-weight:600;">${loginUrl}</a>
            </p>
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#fef3c7;border-left:4px solid #f59e0b;border-radius:6px;margin:0 0 16px;">
              <tr><td style="padding:14px 16px;">
                <p style="color:#92400e;font-weight:700;font-size:13px;margin:0 0 4px;">Keep This Email</p>
                <p style="color:#78350f;font-size:13px;line-height:1.5;margin:0;">
                  Save this email for your records. You'll need these credentials to log in from other devices.
                </p>
              </td></tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="background:#f8fafc;padding:24px 40px;border-top:1px solid #e2e8f0;text-align:center;">
            <p style="color:#94a3b8;font-size:12px;margin:0 0 4px;">
              GreenReach -- The foundation for smarter farms
            </p>
            <p style="color:#94a3b8;font-size:12px;margin:0;">
              <a href="https://greenreachgreens.com" style="color:#64748b;text-decoration:none;">greenreachgreens.com</a> &nbsp;|&nbsp;
              <a href="mailto:admin@greenreachgreens.com" style="color:#64748b;text-decoration:none;">admin@greenreachgreens.com</a>
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = `[REVIEW 1/8] Welcome to Light Engine!

Hi ${firstName},

Your payment has been confirmed and your Light Engine account for "${farmName}" is now active.

YOUR LOGIN CREDENTIALS
----------------------------------------------
Farm ID:        ${farmId}
Temp Password:  ${tempPassword}
Email:          ${email}

GETTING STARTED
----------------------------------------------
1. Open your dashboard: ${dashboardUrl}
2. Enter your Farm ID and Temporary Password to log in
3. Set up your grow rooms, zones, and crops in Farm Settings
4. Start managing your farm operations

Login page: ${loginUrl}

IMPORTANT: Save this email.

-- GreenReach`;

  await send({ subject, html, text });
}

// ── 2. Team Invite Email ────────────────────────────────────────────
async function sendInvite() {
  const displayName = 'Jordan';
  const farmName = 'Riverside Greens';
  const farmId = 'FARM-ABCD1234-EF567890';
  const email = REVIEW_EMAIL;
  const tempPassword = 'Birch-Creek-3196';
  const roleLabel = 'Manager';
  const personalMessage = 'Welcome aboard! Looking forward to working with you this season. Let me know if you have any questions getting set up.';
  const loginUrl = 'https://greenreachgreens.com/farm-admin-login.html';
  const dashboardUrl = 'https://greenreachgreens.com/farm-admin.html';

  const subject = `[REVIEW 2/8] You've been invited to ${farmName}`;

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Oxygen,Ubuntu,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:white;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:linear-gradient(135deg,#0f172a 0%,#1e293b 100%);padding:32px 40px;text-align:center;">
            <h1 style="color:white;margin:0;font-size:24px;font-weight:700;">You're Invited</h1>
            <p style="color:#94a3b8;margin:8px 0 0;font-size:14px;">Join ${farmName} on Light Engine</p>
          </td>
        </tr>
        <tr>
          <td style="padding:32px 40px;">
            <p style="color:#1a202c;font-size:16px;line-height:1.6;margin:0 0 20px;">Hi ${displayName},</p>
            <p style="color:#4a5568;font-size:15px;line-height:1.6;margin:0 0 24px;">
              You have been added as a <strong>${roleLabel}</strong> on <strong>${farmName}</strong>. Use the credentials below to log in:
            </p>
            <p style="color:#4a5568;font-size:14px;line-height:1.6;margin:0 0 24px;padding:16px;background:#f8fafc;border-left:3px solid #10b981;border-radius:4px;font-style:italic;">"${personalMessage}"</p>
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdf4;border:2px solid #86efac;border-radius:10px;margin:0 0 24px;">
              <tr><td style="padding:20px 24px;">
                <p style="color:#166534;font-weight:700;font-size:15px;margin:0 0 16px;">Your Login Credentials</p>
                <table width="100%" cellspacing="0" cellpadding="0">
                  <tr>
                    <td style="padding:8px 0;color:#6b7280;font-size:13px;font-weight:500;text-transform:uppercase;letter-spacing:0.5px;width:140px;">Farm ID</td>
                    <td style="padding:8px 0;color:#1a202c;font-size:16px;font-weight:700;font-family:'SF Mono','Fira Code',Consolas,monospace;">${farmId}</td>
                  </tr>
                  <tr>
                    <td style="padding:8px 0;border-top:1px solid #d1fae5;color:#6b7280;font-size:13px;font-weight:500;text-transform:uppercase;letter-spacing:0.5px;">Email</td>
                    <td style="padding:8px 0;border-top:1px solid #d1fae5;color:#1a202c;font-size:15px;font-weight:600;">${email}</td>
                  </tr>
                  <tr>
                    <td style="padding:8px 0;border-top:1px solid #d1fae5;color:#6b7280;font-size:13px;font-weight:500;text-transform:uppercase;letter-spacing:0.5px;">Temp Password</td>
                    <td style="padding:8px 0;border-top:1px solid #d1fae5;color:#1a202c;font-size:16px;font-weight:700;font-family:'SF Mono','Fira Code',Consolas,monospace;">${tempPassword}</td>
                  </tr>
                </table>
              </td></tr>
            </table>
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr><td align="center" style="padding:8px 0 24px;">
                <a href="${dashboardUrl}" style="display:inline-block;background:#10b981;color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:16px;">
                  Go to Farm Dashboard
                </a>
              </td></tr>
            </table>
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#fef3c7;border-left:4px solid #f59e0b;border-radius:6px;margin:0 0 16px;">
              <tr><td style="padding:14px 16px;">
                <p style="color:#92400e;font-weight:700;font-size:13px;margin:0 0 4px;">Save This Email</p>
                <p style="color:#78350f;font-size:13px;line-height:1.5;margin:0;">
                  Keep this email for your records. Please change your password after first login.
                </p>
              </td></tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="background:#f8fafc;padding:24px 40px;border-top:1px solid #e2e8f0;text-align:center;">
            <p style="color:#94a3b8;font-size:12px;margin:0 0 4px;">GreenReach -- The foundation for smarter farms</p>
            <p style="color:#94a3b8;font-size:12px;margin:0;">
              <a href="https://greenreachgreens.com" style="color:#64748b;text-decoration:none;">greenreachgreens.com</a>
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = `[REVIEW 2/8] You're Invited to ${farmName}!

Hi ${displayName},

You have been added as a ${roleLabel} on ${farmName}.

Message from admin: "${personalMessage}"

YOUR LOGIN CREDENTIALS
----------------------------------------------
Farm ID:        ${farmId}
Email:          ${email}
Temp Password:  ${tempPassword}

Login: ${dashboardUrl}
Change your password after first login.

-- GreenReach`;

  await send({ subject, html, text });
}

// ── 3. Order Confirmation (Wholesale) ───────────────────────────────
async function sendOrderConfirmation() {
  const orderId = 'ORD-2026-0329-A7F3';
  const buyerName = 'Fresh Market Co-op';
  const items = [
    { name: 'Organic Basil (1 lb)', qty: 12 },
    { name: 'Mixed Microgreens Tray', qty: 8 },
    { name: 'Lettuce Blend (2 lb bag)', qty: 20 },
  ];
  const total = 487.60;
  const deliveryDate = 'April 2, 2026';

  const subject = `[REVIEW 3/8] Order Confirmation #${orderId}`;

  const itemRows = items.map(it =>
    `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;">${it.name}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:center;">${it.qty}</td>
    </tr>`
  ).join('\n');

  const itemText = items.map(it => `  - ${it.name} x ${it.qty}`).join('\n');

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Oxygen,Ubuntu,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:white;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:linear-gradient(135deg,#0f172a 0%,#1e293b 100%);padding:32px 40px;text-align:center;">
            <h1 style="color:white;margin:0;font-size:24px;font-weight:700;">Order Confirmed</h1>
            <p style="color:#94a3b8;margin:8px 0 0;font-size:14px;">#${orderId}</p>
          </td>
        </tr>
        <tr>
          <td style="padding:32px 40px;">
            <p style="color:#1a202c;font-size:16px;line-height:1.6;margin:0 0 20px;">
              Hi ${buyerName},
            </p>
            <p style="color:#4a5568;font-size:15px;line-height:1.6;margin:0 0 24px;">
              Thank you for your order. Here is your confirmation:
            </p>
            <table width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 24px;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
              <thead>
                <tr style="background:#f8fafc;">
                  <th style="padding:10px 12px;text-align:left;font-size:13px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Product</th>
                  <th style="padding:10px 12px;text-align:center;font-size:13px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Qty</th>
                </tr>
              </thead>
              <tbody>
                ${itemRows}
              </tbody>
            </table>

            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdf4;border:2px solid #86efac;border-radius:10px;margin:0 0 24px;">
              <tr><td style="padding:16px 24px;">
                <table width="100%" cellspacing="0" cellpadding="0">
                  <tr>
                    <td style="color:#166534;font-size:15px;font-weight:600;">Total</td>
                    <td style="color:#166534;font-size:20px;font-weight:700;text-align:right;">$${total.toFixed(2)} CAD</td>
                  </tr>
                  <tr>
                    <td style="color:#6b7280;font-size:13px;padding-top:8px;">Delivery Date</td>
                    <td style="color:#1a202c;font-size:14px;font-weight:600;text-align:right;padding-top:8px;">${deliveryDate}</td>
                  </tr>
                </table>
              </td></tr>
            </table>

            <p style="color:#4a5568;font-size:14px;line-height:1.6;margin:0;">
              You can check your order status any time in the wholesale portal.
            </p>
          </td>
        </tr>
        <tr>
          <td style="background:#f8fafc;padding:24px 40px;border-top:1px solid #e2e8f0;text-align:center;">
            <p style="color:#94a3b8;font-size:12px;margin:0 0 4px;">GreenReach -- The foundation for smarter farms</p>
            <p style="color:#94a3b8;font-size:12px;margin:0;">
              <a href="https://greenreachgreens.com" style="color:#64748b;text-decoration:none;">greenreachgreens.com</a>
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = `[REVIEW 3/8] Order Confirmation #${orderId}

Hi ${buyerName},

Thank you for your order #${orderId}.

Items:
${itemText}

Total: $${total.toFixed(2)} CAD
Delivery date: ${deliveryDate}

You can check your order status any time in the wholesale portal.

-- GreenReach Farms`;

  await send({ subject, html, text });
}

// ── 4. Payment Confirmed (Square Webhook) ───────────────────────────
async function sendPaymentConfirmed() {
  const amount = 487.60;
  const orderId = 'ORD-2026-0329-A7F3';

  const subject = `[REVIEW 4/8] GreenReach Order #${orderId.substring(0, 8)} - Payment Confirmed`;

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Oxygen,Ubuntu,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:white;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:linear-gradient(135deg,#0f172a 0%,#1e293b 100%);padding:32px 40px;text-align:center;">
            <h1 style="color:white;margin:0;font-size:24px;font-weight:700;">Payment Confirmed</h1>
            <p style="color:#94a3b8;margin:8px 0 0;font-size:14px;">Order #${orderId.substring(0, 8)}</p>
          </td>
        </tr>
        <tr>
          <td style="padding:32px 40px;">
            <p style="color:#4a5568;font-size:15px;line-height:1.6;margin:0 0 24px;">
              Your payment of <strong>$${amount.toFixed(2)} CAD</strong> has been confirmed.
            </p>
            <p style="color:#4a5568;font-size:15px;line-height:1.6;margin:0 0 24px;">
              Order <strong>#${orderId.substring(0, 8)}</strong> is now being prepared for fulfillment.
            </p>
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdf4;border:2px solid #86efac;border-radius:10px;margin:0 0 24px;">
              <tr><td style="padding:20px 24px;text-align:center;">
                <p style="color:#166534;font-size:13px;font-weight:500;text-transform:uppercase;letter-spacing:0.5px;margin:0 0 8px;">Amount Paid</p>
                <p style="color:#166534;font-size:28px;font-weight:700;margin:0;">$${amount.toFixed(2)} CAD</p>
              </td></tr>
            </table>
            <p style="color:#64748b;font-size:14px;text-align:center;margin:0;">
              Check your order status in the wholesale portal.
            </p>
          </td>
        </tr>
        <tr>
          <td style="background:#f8fafc;padding:24px 40px;border-top:1px solid #e2e8f0;text-align:center;">
            <p style="color:#94a3b8;font-size:12px;margin:0 0 4px;">GreenReach -- The foundation for smarter farms</p>
            <p style="color:#94a3b8;font-size:12px;margin:0;">
              <a href="https://greenreachgreens.com" style="color:#64748b;text-decoration:none;">greenreachgreens.com</a>
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = `[REVIEW 4/8] Payment Confirmed

Your payment of $${amount.toFixed(2)} CAD has been confirmed.
Order #${orderId.substring(0, 8)} is now being prepared for fulfillment.

-- GreenReach Farms`;

  await send({ subject, html, text });
}

// ── 5. Nightly Audit Alert ──────────────────────────────────────────
async function sendAuditAlert() {
  const auditDate = '2026-03-29';
  const statusLabel = 'WARNING';
  const statusColor = '#f57c00';

  const checks = [
    { name: 'database_connectivity', status: 'pass', message: '1 farm(s) in database' },
    { name: 'sensor_data_freshness', status: 'pass', message: 'Last reading 4m ago (within 15m threshold)' },
    { name: 'heartbeat_check', status: 'pass', message: 'Last heartbeat 2m ago' },
    { name: 'square_credentials', status: 'pass', message: 'Square access token valid' },
    { name: 'disk_usage', status: 'warn', message: '78% used (threshold: 80%)' },
    { name: 'ssl_certificate', status: 'pass', message: 'Certificate valid for 247 days' },
    { name: 'email_delivery', status: 'pass', message: 'SES verified and active' },
    { name: 'wholesale_inventory_sync', status: 'warn', message: '2 SKUs have 0 quantity (possible overselling)' },
  ];

  const failures = checks.filter(c => c.status === 'fail');
  const warnings = checks.filter(c => c.status === 'warn');

  const checkRows = checks.map(c => {
    const icon = c.status === 'pass' ? 'PASS' : c.status === 'warn' ? 'WARN' : 'FAIL';
    const bg = c.status === 'pass' ? '#e8f5e9' : c.status === 'warn' ? '#fff3e0' : '#ffebee';
    return `<tr style="background:${bg}">
      <td style="padding:6px 10px">${icon} &nbsp; ${c.name.replace(/_/g, ' ')}</td>
      <td style="padding:6px 10px;text-transform:uppercase;font-weight:600">${c.status}</td>
      <td style="padding:6px 10px">${c.message}</td>
    </tr>`;
  }).join('\n');

  const subject = `[REVIEW 5/8] GreenReach Audit ${statusLabel} -- ${auditDate}`;

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Oxygen,Ubuntu,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:white;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:${statusColor};color:#fff;padding:24px 40px;border-radius:12px 12px 0 0;">
            <h2 style="margin:0;font-size:20px">GreenReach Nightly Audit: ${statusLabel}</h2>
            <p style="margin:6px 0 0;opacity:0.9">${auditDate} -- ${failures.length} failure(s), ${warnings.length} warning(s), ${checks.filter(c=>c.status==='pass').length} passed</p>
          </td>
        </tr>

        ${warnings.length > 0 ? `
        <tr><td>
          <div style="background:#fff3e0;padding:14px 20px;border-left:4px solid #f57c00">
            <h3 style="margin:0 0 8px;color:#e65100;font-size:15px">Warnings</h3>
            <ul style="margin:0;padding-left:20px">
              ${warnings.map(w => `<li><strong>${w.name.replace(/_/g, ' ')}</strong>: ${w.message}</li>`).join('\n              ')}
            </ul>
          </div>
        </td></tr>` : ''}

        <tr><td style="padding:20px 40px;">
          <table style="width:100%;border-collapse:collapse;font-size:14px">
            <thead>
              <tr style="background:#f5f5f5">
                <th style="padding:8px 10px;text-align:left">Check</th>
                <th style="padding:8px 10px;text-align:left">Status</th>
                <th style="padding:8px 10px;text-align:left">Details</th>
              </tr>
            </thead>
            <tbody>
              ${checkRows}
            </tbody>
          </table>
        </td></tr>

        <tr>
          <td style="padding:12px 40px;">
            <p style="color:#666;font-size:12px;margin:0;">
              Audit ran in 342ms. Log in to the admin dashboard or ask E.V.I.E. "how's the system?" for live status.
            </p>
          </td>
        </tr>
        <tr>
          <td style="background:#f8fafc;padding:24px 40px;border-top:1px solid #e2e8f0;text-align:center;">
            <p style="color:#94a3b8;font-size:12px;margin:0 0 4px;">GreenReach -- The foundation for smarter farms</p>
            <p style="color:#94a3b8;font-size:12px;margin:0;">
              <a href="https://greenreachgreens.com" style="color:#64748b;text-decoration:none;">greenreachgreens.com</a>
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = `[REVIEW 5/8] GreenReach Nightly Audit: ${statusLabel} (${auditDate})

${failures.length} failure(s), ${warnings.length} warning(s), ${checks.filter(c=>c.status==='pass').length}/${checks.length} passed

${warnings.length ? 'WARNINGS:\n' + warnings.map(w => `  WARN ${w.name}: ${w.message}`).join('\n') + '\n' : ''}
ALL CHECKS:
${checks.map(c => `  ${c.status.toUpperCase().padEnd(5)} ${c.name}: ${c.message}`).join('\n')}

Audit ran in 342ms. Log in to the admin dashboard for live status.

-- GreenReach`;

  await send({ subject, html, text });
}


// ── 6. Buyer Welcome Email (new wholesale buyer) ────────────────────
async function sendBuyerWelcome() {
  // Intercept the sendEmail call to capture HTML, then re-send with REVIEW prefix
  const captured = {};
  const mockSendEmail = async ({ to, subject, html, text }) => {
    captured.subject = subject;
    captured.html = html;
    captured.text = text;
    return { MessageId: 'mock' };
  };

  await sendBuyerWelcomeEmail(mockSendEmail, {
    email: REVIEW_EMAIL,
    businessName: 'Fresh Market Co-op',
    contactName: 'Jordan Adler',
    buyerType: 'grocery',
  });

  await send({
    subject: '[REVIEW 6/8] ' + captured.subject,
    html: captured.html,
    text: captured.text,
  });
}

// ── 7. Buyer Monthly Statement ──────────────────────────────────────
async function sendBuyerStatement() {
  const captured = {};
  const mockSendEmail = async ({ to, subject, html, text }) => {
    captured.subject = subject;
    captured.html = html;
    captured.text = text;
    return { MessageId: 'mock' };
  };

  await sendBuyerMonthlyStatement(mockSendEmail, {
    email: REVIEW_EMAIL,
    businessName: 'Fresh Market Co-op',
    contactName: 'Jordan Adler',
    statementMonth: 'March 2026',
    statementPeriod: 'Mar 1 - Mar 31, 2026',
    lineItems: [
      {
        orderDate: 'Mar 4',
        orderId: 'ORD-2026-0304-B2C1',
        productName: 'Organic Basil (1 lb)',
        farmName: 'The Notable Sprout',
        lotCode: 'TNS-20260302-001',
        harvestDate: 'Mar 2',
        quantity: 12,
        unit: 'lb',
        weightGrams: 5443,
        unitPrice: 8.50,
        lineTotal: 102.00,
        esgScore: 88,
        esgGrade: 'A',
      },
      {
        orderDate: 'Mar 4',
        orderId: 'ORD-2026-0304-B2C1',
        productName: 'Mixed Microgreens Tray',
        farmName: 'The Notable Sprout',
        lotCode: 'TNS-20260303-002',
        harvestDate: 'Mar 3',
        quantity: 8,
        unit: 'tray',
        weightGrams: 1360,
        unitPrice: 14.00,
        lineTotal: 112.00,
        esgScore: 92,
        esgGrade: 'A',
      },
      {
        orderDate: 'Mar 11',
        orderId: 'ORD-2026-0311-D4F8',
        productName: 'Lettuce Blend (2 lb)',
        farmName: 'Riverside Greens',
        lotCode: 'RSG-20260309-004',
        harvestDate: 'Mar 9',
        quantity: 20,
        unit: 'bag',
        weightGrams: 18144,
        unitPrice: 6.75,
        lineTotal: 135.00,
        esgScore: 74,
        esgGrade: 'B',
      },
      {
        orderDate: 'Mar 18',
        orderId: 'ORD-2026-0318-A1E2',
        productName: 'Organic Basil (1 lb)',
        farmName: 'The Notable Sprout',
        lotCode: 'TNS-20260316-008',
        harvestDate: 'Mar 16',
        quantity: 10,
        unit: 'lb',
        weightGrams: 4536,
        unitPrice: 8.50,
        lineTotal: 85.00,
        esgScore: 88,
        esgGrade: 'A',
      },
      {
        orderDate: 'Mar 25',
        orderId: 'ORD-2026-0325-C3G9',
        productName: 'Cilantro Bunch',
        farmName: 'Valley Herb Farm',
        lotCode: 'VHF-20260323-003',
        harvestDate: 'Mar 23',
        quantity: 15,
        unit: 'bunch',
        weightGrams: 2268,
        unitPrice: 3.50,
        lineTotal: 52.50,
        esgScore: 62,
        esgGrade: 'C',
      },
    ],
    totals: {
      subtotal: 486.50,
      discountPercent: 4,
      discountAmount: 19.46,
      total: 467.04,
    },
    environmentalSummary: {
      avgFoodMiles: 42,
      avgCarbonKg: 0.8,
      totalOrders: 4,
      topGrade: 'A',
    },
    discountTier: {
      label: '$250 - $499',
      percent: 4,
      nextTier: '$500 - $999',
      nextPercent: 6,
      amountToNext: 32.96,
    },
  });

  await send({
    subject: '[REVIEW 7/8] ' + captured.subject,
    html: captured.html,
    text: captured.text,
  });
}

// ── 8. Producer Monthly Statement ───────────────────────────────────
async function sendProducerStatement() {
  const captured = {};
  const mockSendEmail = async ({ to, subject, html, text }) => {
    captured.subject = subject;
    captured.html = html;
    captured.text = text;
    return { MessageId: 'mock' };
  };

  await sendProducerMonthlyStatement(mockSendEmail, {
    email: REVIEW_EMAIL,
    farmName: 'The Notable Sprout',
    contactName: 'Peter Gilbert',
    farmId: 'FARM-MLTP9LVH-B0B85039',
    statementMonth: 'March 2026',
    statementPeriod: 'Mar 1 - Mar 31, 2026',
    lineItems: [
      {
        orderDate: 'Mar 4',
        orderId: 'ORD-2026-0304-B2C1',
        productName: 'Organic Basil (1 lb)',
        buyerName: 'Fresh Market Co-op',
        lotCode: 'TNS-20260302-001',
        harvestDate: 'Mar 2',
        quantity: 12,
        unit: 'lb',
        weightGrams: 5443,
        unitPrice: 8.50,
        lineTotal: 102.00,
      },
      {
        orderDate: 'Mar 4',
        orderId: 'ORD-2026-0304-B2C1',
        productName: 'Mixed Microgreens Tray',
        buyerName: 'Fresh Market Co-op',
        lotCode: 'TNS-20260303-002',
        harvestDate: 'Mar 3',
        quantity: 8,
        unit: 'tray',
        weightGrams: 1360,
        unitPrice: 14.00,
        lineTotal: 112.00,
      },
      {
        orderDate: 'Mar 11',
        orderId: 'ORD-2026-0311-D4F8',
        productName: 'Organic Basil (1 lb)',
        buyerName: 'Urban Bites Bistro',
        lotCode: 'TNS-20260309-005',
        harvestDate: 'Mar 9',
        quantity: 6,
        unit: 'lb',
        weightGrams: 2722,
        unitPrice: 8.50,
        lineTotal: 51.00,
      },
      {
        orderDate: 'Mar 18',
        orderId: 'ORD-2026-0318-A1E2',
        productName: 'Organic Basil (1 lb)',
        buyerName: 'Fresh Market Co-op',
        lotCode: 'TNS-20260316-008',
        harvestDate: 'Mar 16',
        quantity: 10,
        unit: 'lb',
        weightGrams: 4536,
        unitPrice: 8.50,
        lineTotal: 85.00,
      },
    ],
    totals: {
      grossRevenue: 350.00,
      brokerFee: 42.00,
      brokerFeePercent: 12,
      netRevenue: 308.00,
      totalUnits: 36,
    },
    esgAssessment: {
      totalScore: 88,
      grade: 'A',
      environmental: { score: 92, breakdown: { energy: 'A', water: 'A', carbon: 'A', food_miles: 'A' } },
      social: { score: 78, breakdown: { fair_wages: 'B', community: 'B', training: 'A' } },
      governance: { score: 85, breakdown: { certifications: 'A', traceability: 'A', data_quality: 'B' } },
    },
    environmentalComparison: {
      avgFoodMiles: 38,
      avgCarbonKg: 0.6,
    },
  });

  await send({
    subject: '[REVIEW 8/8] ' + captured.subject,
    html: captured.html,
    text: captured.text,
  });
}

// ── Run All ─────────────────────────────────────────────────────────
async function main() {
  console.log(`\nSending all 8 notification templates to ${REVIEW_EMAIL}...\n`);

  try {
    console.log('[1/8] Welcome Email (new subscriber onboarding)');
    await sendWelcome();
    await pause(1000);

    console.log('[2/8] Team Invite Email (admin invites team member)');
    await sendInvite();
    await pause(1000);

    console.log('[3/8] Order Confirmation (wholesale buyer)');
    await sendOrderConfirmation();
    await pause(1000);

    console.log('[4/8] Payment Confirmed (Square webhook)');
    await sendPaymentConfirmed();
    await pause(1000);

    console.log('[5/8] Nightly Audit Alert (system health)');
    await sendAuditAlert();
    await pause(1000);

    console.log('[6/8] Buyer Welcome Email (new wholesale buyer)');
    await sendBuyerWelcome();
    await pause(1000);

    console.log('[7/8] Buyer Monthly Statement (itemized + ESG + GAP)');
    await sendBuyerStatement();
    await pause(1000);

    console.log('[8/8] Producer Monthly Statement (revenue + ESG breakdown)');
    await sendProducerStatement();

    console.log(`\nAll 8 notifications sent to ${REVIEW_EMAIL}. Check inbox.\n`);
  } catch (err) {
    console.error('Failed:', err.message);
    process.exit(1);
  }
}

main();
