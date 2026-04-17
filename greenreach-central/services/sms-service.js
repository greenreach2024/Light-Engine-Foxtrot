/**
 * SMS Service -- GreenReach Central
 * Uses Twilio as primary transport and email-to-SMS via Google Workspace SMTP as fallback.
 * Configured recipient allowlist enforced at service level.
 *
 * Carrier gateways convert an email to an SMS delivered to the phone.
 * Each approved recipient must have an allowlisted phone number and optional carrier mappings.
 */

import nodemailer from 'nodemailer';
import twilio from 'twilio';

// Approved recipients are controlled by configuration to avoid hardcoded destinations.
// `SMS_APPROVED_RECIPIENTS` supports JSON: {"+15551234567":["5551234567@txt.att.net"]}
// `ADMIN_ALERT_PHONE` is accepted as an approved recipient when present.
const SMS_APPROVED_RECIPIENTS = String(process.env.SMS_APPROVED_RECIPIENTS || '').trim();
const ADMIN_ALERT_PHONE = String(process.env.ADMIN_ALERT_PHONE || '').trim();

const FROM_LABEL = 'GreenReach';

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || '';
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || '';
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER || '';
const TWILIO_ENABLED = !!(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_PHONE_NUMBER);

// SMTP config (reuses same Google Workspace credentials as email service)
const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587');
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const SMTP_ENABLED = !!(SMTP_HOST && SMTP_USER && SMTP_PASS);

let _smtpTransport = null;
let _twilioClient = null;

function asGatewayArray(gateways) {
  const values = Array.isArray(gateways) ? gateways : [gateways];
  return values.map((value) => String(value || '').trim()).filter(Boolean);
}

function loadApprovedRecipients() {
  const approved = new Map();

  if (SMS_APPROVED_RECIPIENTS) {
    try {
      const parsed = JSON.parse(SMS_APPROVED_RECIPIENTS);
      for (const [phone, gateways] of Object.entries(parsed || {})) {
        const key = String(phone || '').trim();
        if (!key) continue;
        approved.set(key, asGatewayArray(gateways));
      }
    } catch (err) {
      console.error('[sms] Failed to parse SMS_APPROVED_RECIPIENTS:', err.message);
    }
  }

  if (ADMIN_ALERT_PHONE && !approved.has(ADMIN_ALERT_PHONE)) {
    approved.set(ADMIN_ALERT_PHONE, []);
  }

  return approved;
}

const APPROVED_RECIPIENTS = loadApprovedRecipients();

function loadGatewayOverrides() {
  const raw = String(process.env.SMS_GATEWAY_OVERRIDES || '').trim();
  if (!raw) return new Map();
  try {
    const parsed = JSON.parse(raw);
    const entries = Object.entries(parsed || {}).map(([phone, gateways]) => {
      return [phone, asGatewayArray(gateways)];
    }).filter(([, gateways]) => gateways.length > 0);
    return new Map(entries);
  } catch (err) {
    console.error('[sms] Failed to parse SMS_GATEWAY_OVERRIDES:', err.message);
    return new Map();
  }
}

function isApprovedPhone(phone) {
  const overrides = loadGatewayOverrides();
  return APPROVED_RECIPIENTS.has(phone) || overrides.has(phone);
}

function getApprovedGateways(phone) {
  const overrides = loadGatewayOverrides();
  const overrideGateways = overrides.get(phone);
  if (overrideGateways?.length) return overrideGateways;
  const configured = APPROVED_RECIPIENTS.get(phone);
  if (!configured) return [];
  return Array.isArray(configured) ? configured : [configured];
}

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

function getTwilioClient() {
  if (_twilioClient) return _twilioClient;
  if (!TWILIO_ENABLED) return null;
  try {
    _twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
    console.log('[sms] Twilio client ready');
    return _twilioClient;
  } catch (err) {
    console.error('[sms] Failed to create Twilio client:', err.message);
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
  * Send an SMS message via Twilio when configured, otherwise fallback to email-to-SMS gateways.
  * Enforces configured recipient allowlist.
   * Returns { success, messageId }.
   */
  async sendSms({ to, message }) {
    const normalised = normalisePhone(to);
    if (!normalised) {
      console.error(`[sms] Invalid phone number format: ${to}`);
      return { success: false, error: 'Invalid phone number format' };
    }

    if (!isApprovedPhone(normalised)) {
      console.error(`[sms] BLOCKED -- recipient not in allowlist: ${normalised}`);
      return { success: false, error: 'Recipient not in approved allowlist' };
    }

    const gateways = getApprovedGateways(normalised);

    // Enforce message length (SMS limit: 160 chars for single segment)
    const trimmed = (message || '').substring(0, 160);
    console.log(`[sms] -> ${normalised} | ${trimmed.substring(0, 80)}...`);

    const twilioClient = getTwilioClient();
    if (twilioClient) {
      try {
        const result = await twilioClient.messages.create({
          body: trimmed,
          from: TWILIO_PHONE_NUMBER,
          to: normalised
        });
        console.log(`[sms] Sent via Twilio: ${result.sid} -> ${normalised}`);
        return { success: true, messageId: result.sid, provider: 'twilio' };
      } catch (twilioErr) {
        console.error(`[sms] Twilio send failed for ${normalised}:`, twilioErr.message);
      }
    }

    const transport = getSmtpTransport();
    if (transport) {
      for (const gateway of gateways) {
        try {
          const result = await transport.sendMail({
            from: `${FROM_LABEL} <${SMTP_USER}>`,
            to: gateway,
            subject: '',
            text: trimmed
          });
          const messageId = result.messageId || `sms-${Date.now()}`;
          console.log(`[sms] Sent via email-to-SMS gateway: ${messageId} -> ${gateway}`);
          return { success: true, messageId, gateway, provider: 'smtp-gateway' };
        } catch (smtpErr) {
          console.error(`[sms] Email-to-SMS send failed for ${gateway}:`, smtpErr.message);
        }
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
    return normalised ? isApprovedPhone(normalised) : false;
  }

  /**
   * Get list of approved recipients (for status checks).
   */
  getApprovedRecipients() {
    return Array.from(new Set([
      ...APPROVED_RECIPIENTS.keys(),
      ...loadGatewayOverrides().keys()
    ]));
  }
}

export default new SmsService();
