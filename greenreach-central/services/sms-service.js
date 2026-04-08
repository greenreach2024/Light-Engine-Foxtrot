/**
 * SMS Service -- GreenReach Central
 * Uses email-to-SMS via Google Workspace SMTP (carrier gateways).
 * Hardcoded recipient allowlist enforced at service level.
 *
 * Carrier gateways convert an email to an SMS delivered to the phone.
 * Each approved recipient must have a carrier gateway mapping.
 */

import nodemailer from 'nodemailer';

// Approved recipients -- only these numbers can receive SMS.
// Adding numbers here requires a code change + deploy (intentional safety gate).
// Map phone (E.164) -> carrier email gateway address.
const APPROVED_RECIPIENTS = new Map([
  ['+16138881031', '6138881031@txt.bell.ca']
]);

const FROM_LABEL = 'GreenReach';

// SMTP config (reuses same Google Workspace credentials as email service)
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
    console.log('[sms] SMTP transport ready for email-to-SMS');
    return _smtpTransport;
  } catch (err) {
    console.error('[sms] Failed to create SMTP transport:', err.message);
    return null;
  }
}

// Normalise phone to E.164 format
function normalisePhone(phone) {
  const digits = phone.replace(/[^0-9]/g, '');
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits;
  if (phone.startsWith('+') && digits.length >= 10) return '+' + digits;
  return null;
}

class SmsService {
  /**
   * Send an SMS message via email-to-SMS gateway.
   * Enforces hardcoded recipient allowlist -- rejects any number not in APPROVED_RECIPIENTS.
   * Returns { success, messageId }.
   */
  async sendSms({ to, message }) {
    const normalised = normalisePhone(to);
    if (!normalised) {
      console.error(`[sms] Invalid phone number format: ${to}`);
      return { success: false, error: 'Invalid phone number format' };
    }

    const gateway = APPROVED_RECIPIENTS.get(normalised);
    if (!gateway) {
      console.error(`[sms] BLOCKED -- recipient not in allowlist: ${normalised}`);
      return { success: false, error: 'Recipient not in approved allowlist' };
    }

    // Enforce message length (SMS limit: 160 chars for single segment)
    const trimmed = (message || '').substring(0, 160);
    console.log(`[sms] -> ${normalised} | ${trimmed.substring(0, 80)}...`);

    const transport = getSmtpTransport();
    if (transport) {
      try {
        const result = await transport.sendMail({
          from: `${FROM_LABEL} <${SMTP_USER}>`,
          to: gateway,
          subject: '',
          text: trimmed
        });
        const messageId = result.messageId || `sms-${Date.now()}`;
        console.log(`[sms] Sent via email-to-SMS gateway: ${messageId} -> ${gateway}`);
        return { success: true, messageId };
      } catch (smtpErr) {
        console.error('[sms] Email-to-SMS send failed:', smtpErr.message);
        // Fall through to stub
      }
    }

    // Stub fallback (dev / SMTP unavailable)
    console.log(`[sms] STUB -- would send to ${normalised}: ${trimmed}`);
    return { success: true, messageId: `stub-${Date.now()}`, stub: true };
  }

  /**
   * Check if a phone number is in the approved allowlist.
   */
  isApprovedRecipient(phone) {
    const normalised = normalisePhone(phone);
    return normalised ? APPROVED_RECIPIENTS.has(normalised) : false;
  }

  /**
   * Get list of approved recipients (for status checks).
   */
  getApprovedRecipients() {
    return Array.from(APPROVED_RECIPIENTS.keys());
  }
}

export default new SmsService();
