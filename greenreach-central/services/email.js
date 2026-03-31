/**
 * Email Service — AWS SES via SDK
 * 
 * Sends transactional emails (welcome, credentials, receipts) using
 * the AWS SES API. Falls back gracefully — email failures never block
 * the purchase pipeline.
 * 
 * Required: @aws-sdk/client-ses installed, AWS credentials available
 * (via environment, IAM role, or shared credentials file).
 * 
 * Env vars (optional overrides):
 *   SES_FROM_EMAIL   — Sender address (default: info@greenreachgreens.com)
 *   SES_REGION       — AWS region for SES (default: us-east-1)
 *   SES_ENABLED      — Set to 'false' to disable (default: true)
 */

import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

import nodemailer from 'nodemailer';

// SMTP fallback config (WorkMail) — used when SES sandbox blocks recipients
const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '465');
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const SMTP_ENABLED = !!(SMTP_HOST && SMTP_USER && SMTP_PASS);


import { sendBuyerWelcomeEmail as _sendBuyerWelcomeEmail, sendBuyerMonthlyStatement as _sendBuyerMonthlyStatement, sendProducerMonthlyStatement as _sendProducerMonthlyStatement } from './email-new-templates.js';

const SES_FROM =  process.env.SES_FROM_EMAIL || 'info@greenreachgreens.com';
const SES_REGION = process.env.SES_REGION || 'us-east-1';
const SES_ENABLED = process.env.SES_ENABLED !== 'false';

let _sesClient = null;

function getSesClient() {
  if (_sesClient) return _sesClient;
  try {
    _sesClient = new SESClient({ region: SES_REGION });
    return _sesClient;
  } catch (err) {
    console.error('[Email] Failed to create SES client:', err.message);
    return null;
  }
}

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
    console.log('[Email] SMTP transport ready (WorkMail fallback)');
    return _smtpTransport;
  } catch (err) {
    console.error('[Email] Failed to create SMTP transport:', err.message);
    return null;
  }
}

async function sendViaSmtp({ to, subject, html, text }) {
  const transport = getSmtpTransport();
  if (!transport) return { sent: false, error: 'SMTP not configured' };
  // WorkMail requires From address to match the authenticated sender (SMTP_USER)
  const smtpFrom = SMTP_USER || SES_FROM;
  try {
    const result = await transport.sendMail({
      from: `GreenReach <${smtpFrom}>`,
      to,
      subject,
      html: html || undefined,
      text: text || undefined
    });
    console.log(`[Email] SMTP sent to ${to}: ${subject} (id: ${result.messageId})`);
    return { sent: true, messageId: result.messageId, via: 'smtp' };
  } catch (err) {
    console.error(`[Email] SMTP failed to ${to}:`, err.message);
    return { sent: false, error: err.message };
  }
}

/**
 * Send a raw email via SES.
 * Returns { sent: true } on success, { sent: false, error } on failure.
 * Never throws — all errors are caught and returned.
 */
async function sendEmail({ to, subject, html, text }) {
  if (!SES_ENABLED && !SMTP_ENABLED) {
    console.log(`[Email] Disabled -- skipping email to ${to}`);
    return { sent: false, error: 'Email sending is disabled' };
  }

  // Try SES first
  if (SES_ENABLED) {
    const client = getSesClient();
    if (client) {
      try {
        const params = {
          Source: `GreenReach <${SES_FROM}>`,
          Destination: { ToAddresses: [to] },
          Message: {
            Subject: { Data: subject, Charset: 'UTF-8' },
            Body: {},
          },
        };
        if (html) params.Message.Body.Html = { Data: html, Charset: 'UTF-8' };
        if (text) params.Message.Body.Text = { Data: text, Charset: 'UTF-8' };

        const command = new SendEmailCommand(params);
        const result = await client.send(command);
        console.log(`[Email] SES sent to ${to}: ${subject} (MessageId: ${result.MessageId})`);
        return { sent: true, messageId: result.MessageId, via: 'ses' };
      } catch (err) {
        const isSandbox = err.message && (err.message.includes('not verified') || err.message.includes('MessageRejected'));
        if (isSandbox && SMTP_ENABLED) {
          console.log(`[Email] SES sandbox blocked ${to}, falling back to SMTP`);
        } else {
          console.error(`[Email] SES failed to ${to}:`, err.message);
          if (!SMTP_ENABLED) return { sent: false, error: err.message };
          console.log(`[Email] Falling back to SMTP for ${to}`);
        }
      }
    }
  }

  // SMTP fallback (WorkMail)
  return sendViaSmtp({ to, subject, html, text });
}

// ═══════════════════════════════════════════════════════════════
// Welcome Email — sent after purchase + farm provisioning
// ═══════════════════════════════════════════════════════════════

/**
 * Send welcome email with login credentials to new subscriber.
 * @param {Object} params
 * @param {string} params.email - Recipient email
 * @param {string} params.farmId - Farm ID (e.g., FARM-XXXXXXXX-XXXXXXXX)
 * @param {string} params.farmName - Farm display name
 * @param {string} params.contactName - User's name
 * @param {string} params.tempPassword - Generated temporary password
 * @param {string} params.planType - Subscription plan (cloud/edge)
 */
export async function sendWelcomeEmail({ email, farmId, farmName, contactName, tempPassword, planType }) {
  const loginUrl = 'https://greenreachgreens.com/farm-admin-login.html';
  const dashboardUrl = 'https://greenreachgreens.com/farm-admin.html';
  const firstName = (contactName || '').split(/\s+/)[0] || 'there';

  const subject = `Welcome to Light Engine — Your Farm Account is Ready`;

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Oxygen,Ubuntu,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:white;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
        
        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#0f172a 0%,#1e293b 100%);padding:32px 40px;text-align:center;">
            <h1 style="color:white;margin:0;font-size:24px;font-weight:700;">Welcome to Light Engine</h1>
            <p style="color:#94a3b8;margin:8px 0 0;font-size:14px;">Your farm management platform is ready</p>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:32px 40px;">
            <p style="color:#1a202c;font-size:16px;line-height:1.6;margin:0 0 20px;">
              Hi ${firstName},
            </p>
            <p style="color:#4a5568;font-size:15px;line-height:1.6;margin:0 0 24px;">
              Your payment has been confirmed and your Light Engine ${planType === 'cloud' ? 'Cloud' : 'Farm Server'} account for <strong>${farmName}</strong> is now active. Here are your login credentials:
            </p>

            <!-- Credentials Box -->
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

            <!-- Login Button -->
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr><td align="center" style="padding:8px 0 24px;">
                <a href="${dashboardUrl}" style="display:inline-block;background:#10b981;color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:16px;">
                  Go to Your Farm Dashboard
                </a>
              </td></tr>
            </table>

            <!-- Getting Started -->
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

            <!-- Login Link -->
            <p style="color:#64748b;font-size:13px;text-align:center;margin:0 0 8px;">
              Login page for other devices:
            </p>
            <p style="text-align:center;margin:0 0 24px;">
              <a href="${loginUrl}" style="color:#3b82f6;font-size:14px;text-decoration:none;font-weight:600;">${loginUrl}</a>
            </p>

            <!-- Warning -->
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

        <!-- Footer -->
        <tr>
          <td style="background:#f8fafc;padding:24px 40px;border-top:1px solid #e2e8f0;text-align:center;">
            <p style="color:#94a3b8;font-size:12px;margin:0 0 4px;">
              GreenReach — The foundation for smarter farms
            </p>
            <p style="color:#94a3b8;font-size:12px;margin:0;">
              <a href="https://greenreachgreens.com" style="color:#64748b;text-decoration:none;">greenreachgreens.com</a> &nbsp;|&nbsp;
              <a href="mailto:info@greenreachgreens.com" style="color:#64748b;text-decoration:none;">info@greenreachgreens.com</a>
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = `Welcome to Light Engine!

Hi ${firstName},

Your payment has been confirmed and your Light Engine account for "${farmName}" is now active.

YOUR LOGIN CREDENTIALS
──────────────────────
Farm ID:        ${farmId}
Temp Password:  ${tempPassword}
Email:          ${email}

GETTING STARTED
──────────────────────
1. Open your dashboard: ${dashboardUrl}
2. Enter your Farm ID and Temporary Password to log in
3. Set up your grow rooms, zones, and crops in Farm Settings
4. Start managing your farm operations

Login page for other devices: ${loginUrl}

IMPORTANT: Save this email — you'll need these credentials to log in from other devices.

—
GreenReach — The foundation for smarter farms
greenreachgreens.com | info@greenreachgreens.com`;

  return sendEmail({ to: email, subject, html, text });
}

export default { sendWelcomeEmail, sendInviteEmail, sendBuyerWelcomeEmail, sendBuyerMonthlyStatement, sendProducerMonthlyStatement };

// ═══════════════════════════════════════════════════════════════
// Team Invite Email — sent when admin invites a user to the farm
// ═══════════════════════════════════════════════════════════════

/**
 * Send invitation email with login credentials to a new team member.
 * @param {Object} params
 * @param {string} params.email - Recipient email
 * @param {string} params.farmId - Farm ID
 * @param {string} params.farmName - Farm display name
 * @param {string} params.firstName - Invited user's first name
 * @param {string} params.role - Assigned role (admin/manager/operator/viewer)
 *  *  *  *  *  *  *  *  *  *  *  *  *  *  *  *  *  * por *  *  *  *  *  *  *  *  *  *  *  *  *  *  *  *  *  * por *Optional personal message from admin
 */
export async function sendInviteEmail({ email, farmId, farmName, firstName, role, tempPassword, personalMessage }) {
  const loginUrl = 'https://greenreachgreens.com/farm-admin-login.html';
  const dashboardUrl = 'https://greenreachgreens.com/farm-admin.html';
  const displayName = firstName || 'there';
  const roleLabel = (role || 'operator').charAt(0).toUpperCase() + (role || 'operator').slice(1);
  const messageBlock = personalMessage
    ? `<p style="color:#4a5568;font-size:14px;line-height:1.6;margin:0 0 24px;padding:16px;background:#f8fafc;border-left:3px solid #10b981;border-radius:4px;font-style:italic;">"${personalMessage}"</p>`
    : '';
  const messageText = personalMessage ? `\nMessage from admin: "${personalMessage}"\n` : '';

  const subject = `You've been invited to ${farmName || 'a Light Engine farm'}`;

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
            <p style="color:#94a3b8;margin:8px 0 0;font-size:14px;">Join ${farmName || 'a Light Engine farm'} on Light Engine</p>
          </td>
        </tr>
        <tr>
          <td style="padding:32px 40px;">
            <p style="color:#1a202c;font-size:16px;line-height:1.6;margin:0 0 20px;">
              Hi ${displayName},
            </p>
            <p style="color:#4a5568;font-size:15px;line-height:1.6;margin:0 0 24px;">
              You have been added as a <strong>${roleLabel}</strong> on <strong>${farmName || 'Light Engine'}</strong>. Use the credentials below to log in:
            </p>
            ${messageBlock}
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

  const text = `You're Invited to ${farmName || 'Light Engine'}!

Hi ${displayName},

You have been added as a ${roleLabel} on ${farmName || 'Light Engine'}.
${messageText}
YOUR LOGIN CREDENTIALS
----------------------------------------------
Farm ID:        ${farmId}
Email:          ${email}
Temp Password:  ${tempPassword}

GETTING STARTED
----------------------------------------------
1. Open: ${dashboardUrl}
2. Enter your Farm ID and Temporary Password
3. Change your password after first login

Login page: ${loginUrl}

IMPORTANT: Save this email and change your password after first login.

--
GreenReach -- The foundation for smarter farms
greenreachgreens.com`;

  return sendEmail({ to: email, subject, html, text });
}


// ===================================================================
// Wrapper exports for new notification templates
// ===================================================================

export async function sendBuyerWelcomeEmail(params) {
  return _sendBuyerWelcomeEmail(sendEmail, params);
}

export async function sendBuyerMonthlyStatement(params) {
  return _sendBuyerMonthlyStatement(sendEmail, params);
}

export async function sendProducerMonthlyStatement(params) {
  return _sendProducerMonthlyStatement(sendEmail, params);
}
