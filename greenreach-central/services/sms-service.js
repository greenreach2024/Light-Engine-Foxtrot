/**
 * SMS Service -- GreenReach Central
 * Uses AWS SNS to send transactional SMS.
 * Hardcoded recipient allowlist enforced at service level.
 */

// Approved recipients -- only these numbers can receive SMS from F.A.Y.E.
// Adding numbers here requires a code change + deploy (intentional safety gate).
const APPROVED_RECIPIENTS = new Set([
  '+16138881031'
]);

const FROM_LABEL = 'GreenReach';

let snsClient = null;
let snsReady = false;

// Normalise phone to E.164 format
function normalisePhone(phone) {
  const digits = phone.replace(/[^0-9]/g, '');
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits;
  if (phone.startsWith('+') && digits.length >= 10) return '+' + digits;
  return null;
}

// Lazy-init SNS client
async function getSNS() {
  if (snsClient !== null) return snsReady ? snsClient : null;
  try {
    const { SNSClient } = await import('@aws-sdk/client-sns');
    snsClient = new SNSClient({
      region: process.env.AWS_REGION || 'us-east-1',
      ...(process.env.AWS_ACCESS_KEY_ID ? {
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
        }
      } : {})
    });
    snsReady = true;
    console.log('[sms] AWS SNS client initialised');
    return snsClient;
  } catch (err) {
    snsClient = false;
    snsReady = false;
    console.warn('[sms] AWS SNS not available -- SMS will be logged only:', err.message);
    return null;
  }
}

class SmsService {
  /**
   * Send an SMS message.
   * Enforces hardcoded recipient allowlist -- rejects any number not in APPROVED_RECIPIENTS.
   * Returns { success, messageId }.
   */
  async sendSms({ to, message }) {
    const normalised = normalisePhone(to);
    if (!normalised) {
      console.error(`[sms] Invalid phone number format: ${to}`);
      return { success: false, error: 'Invalid phone number format' };
    }

    if (!APPROVED_RECIPIENTS.has(normalised)) {
      console.error(`[sms] BLOCKED -- recipient not in allowlist: ${normalised}`);
      return { success: false, error: 'Recipient not in approved allowlist' };
    }

    // Enforce message length (SMS limit: 160 chars for single segment)
    const trimmed = (message || '').substring(0, 1600); // Allow up to 10 segments max
    console.log(`[sms] -> ${normalised} | ${trimmed.substring(0, 80)}...`);

    const client = await getSNS();
    if (client) {
      try {
        const { PublishCommand } = await import('@aws-sdk/client-sns');
        const cmd = new PublishCommand({
          PhoneNumber: normalised,
          Message: trimmed,
          MessageAttributes: {
            'AWS.SNS.SMS.SenderID': { DataType: 'String', StringValue: FROM_LABEL },
            'AWS.SNS.SMS.SMSType': { DataType: 'String', StringValue: 'Transactional' }
          }
        });
        const result = await client.send(cmd);
        const messageId = result.MessageId || `sns-${Date.now()}`;
        console.log(`[sms] Sent via SNS: ${messageId}`);
        return { success: true, messageId };
      } catch (snsErr) {
        console.error('[sms] SNS send failed:', snsErr.message);
        // Fall through to stub
      }
    }

    // Stub fallback (dev / SNS unavailable)
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
    return Array.from(APPROVED_RECIPIENTS);
  }
}

export default new SmsService();
