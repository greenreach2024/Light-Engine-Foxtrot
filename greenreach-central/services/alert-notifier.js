/**
 * Alert Notifier -- GreenReach Central
 * =====================================
 * Dispatches email + SMS when high/critical severity alerts fire.
 * Uses email-service (Google Workspace SMTP) and sms-service (email-to-SMS gateway) under the hood.
 *
 * Rate-limited per alert_type to prevent notification storms.
 * Fire-and-forget -- errors are logged but never thrown.
 */

import emailService from './email-service.js';
import smsService from './sms-service.js';

const TAG = '[AlertNotifier]';

// Rate limit: one notification per alert_type per 15 minutes
const COOLDOWN_MS = 15 * 60 * 1000;
const recentAlerts = new Map(); // alert_type -> last_sent_ms

// Severity levels that trigger email + SMS
const NOTIFY_SEVERITIES = new Set(['critical', 'high']);

// ENV-driven recipients
function getAlertEmail() {
  return process.env.ADMIN_ALERT_EMAIL || process.env.ADMIN_EMAIL || null;
}
function getAlertPhone() {
  return process.env.ADMIN_ALERT_PHONE || process.env.ADMIN_PHONE || null;
}

/**
 * Notify admin of a high/critical alert via email + SMS.
 * Call this after writing the alert to system-alerts.json / DB.
 *
 * @param {{
 *   alert_type: string,
 *   severity: string,
 *   title?: string,
 *   message?: string,
 *   detail?: string,
 *   zone?: string,
 *   reading?: number,
 *   target_min?: number,
 *   target_max?: number,
 *   farm_id?: string
 * }} alert
 */
async function notify(alert) {
  try {
    if (!alert || !NOTIFY_SEVERITIES.has(alert.severity)) return;

    // Rate limit by alert_type
    const key = alert.alert_type || 'unknown';
    const lastSent = recentAlerts.get(key) || 0;
    if (Date.now() - lastSent < COOLDOWN_MS) {
      console.log(`${TAG} Skipping ${key} -- cooldown active (${Math.round((COOLDOWN_MS - (Date.now() - lastSent)) / 1000)}s remaining)`);
      return;
    }
    recentAlerts.set(key, Date.now());

    // Prune old entries (keep map from growing)
    if (recentAlerts.size > 200) {
      const cutoff = Date.now() - COOLDOWN_MS;
      for (const [k, v] of recentAlerts) {
        if (v < cutoff) recentAlerts.delete(k);
      }
    }

    const title = alert.title || alert.message || `${alert.alert_type} alert`;
    const detail = alert.detail || alert.message || '';
    const severityLabel = alert.severity.toUpperCase();
    const zoneInfo = alert.zone ? ` in ${alert.zone}` : '';
    const readingInfo = alert.reading != null
      ? ` | Reading: ${alert.reading}${alert.target_min != null ? ` (target: ${alert.target_min}-${alert.target_max})` : ''}`
      : '';

    // -- Email --
    const alertEmail = getAlertEmail();
    if (alertEmail) {
      const subject = `[${severityLabel}] ${title}`;
      const text = `${severityLabel} Alert: ${title}${zoneInfo}${readingInfo}\n\n${detail}\n\nAlert type: ${alert.alert_type}\nTime: ${new Date().toISOString()}\n\nLog in to the admin dashboard or ask E.V.I.E. for details.`;
      const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;max-width:580px;margin:0 auto">
  <div style="background:${alert.severity === 'critical' ? '#d32f2f' : '#f57c00'};color:#fff;padding:14px 20px;border-radius:8px 8px 0 0">
    <h2 style="margin:0;font-size:18px">${severityLabel} Alert: ${title}</h2>
  </div>
  <div style="padding:16px 20px;background:#fff;border:1px solid #e0e0e0;border-top:none;border-radius:0 0 8px 8px">
    ${zoneInfo ? `<p style="margin:0 0 8px"><strong>Zone:</strong> ${alert.zone}</p>` : ''}
    ${readingInfo ? `<p style="margin:0 0 8px"><strong>Reading:</strong> ${alert.reading} (target: ${alert.target_min || '?'} - ${alert.target_max || '?'})</p>` : ''}
    ${detail ? `<p style="margin:0 0 12px;color:#333">${detail}</p>` : ''}
    <p style="margin:0;color:#666;font-size:13px">Alert type: ${alert.alert_type} | ${new Date().toISOString()}</p>
    <p style="margin:12px 0 0;font-size:13px;color:#666">Open the admin dashboard or ask E.V.I.E. for live status.</p>
  </div>
</div>`;

      emailService.sendEmail({ to: alertEmail, subject, text, html }).then(result => {
        if (result.success) {
          console.log(`${TAG} Email sent to ${alertEmail}: ${subject}`);
        } else {
          console.warn(`${TAG} Email failed to ${alertEmail}: ${result.error || 'unknown'}`);
        }
      }).catch(err => {
        console.error(`${TAG} Email error:`, err.message);
      });
    }

    // -- SMS --
    const alertPhone = getAlertPhone();
    if (alertPhone) {
      const smsText = `[GreenReach ${severityLabel}] ${title}${zoneInfo}${readingInfo}`.substring(0, 160);
      smsService.sendSms({ to: alertPhone, message: smsText }).then(result => {
        if (result.success) {
          console.log(`${TAG} SMS sent to ${alertPhone}`);
        } else {
          console.warn(`${TAG} SMS failed: ${result.error || 'unknown'}`);
        }
      }).catch(err => {
        console.error(`${TAG} SMS error:`, err.message);
      });
    }

    if (!alertEmail && !alertPhone) {
      console.log(`${TAG} No ADMIN_ALERT_EMAIL or ADMIN_ALERT_PHONE configured -- ${severityLabel} alert logged only: ${title}`);
    }
  } catch (err) {
    console.error(`${TAG} Unexpected error:`, err.message);
  }
}

export default { notify };
