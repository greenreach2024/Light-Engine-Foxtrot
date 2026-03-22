/**
 * F.A.Y.E. Intelligence Loop — Phase 3
 * ======================================
 * Background service that runs periodic anomaly detection and generates
 * admin_alerts automatically. Checks every 15 minutes for:
 *
 * 1. Payment failure rate spikes
 * 2. Stale farm heartbeats (farms gone dark)
 * 3. Order volume anomalies (sudden drops or spikes)
 * 4. Accounting imbalances (debits ≠ credits)
 * 5. Unclassified transaction buildup
 *
 * Also handles daily briefing email dispatch via emailService.
 */

import { query, isDatabaseAvailable } from '../config/database.js';
import emailService from '../services/email-service.js';
import logger from '../utils/logger.js';
import { trackPattern, storeInsight } from '../services/faye-learning.js';

const TAG = '[F.A.Y.E. Intelligence]';
const CHECK_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const BRIEFING_HOUR = 7; // 7 AM daily email briefing

let checkInterval = null;
let briefingTimeout = null;
let lastBriefingDate = null;

// ── Alert Creation ──────────────────────────────────────────────────

async function createAlert(domain, severity, title, detail, source = 'faye-intelligence') {
  if (!isDatabaseAvailable()) return null;
  try {
    const result = await query(
      `INSERT INTO admin_alerts (domain, severity, title, detail, source, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [domain, severity, title, detail, source, JSON.stringify({ auto: true, ts: Date.now() })]
    );
    logger.info(`${TAG} Alert created: [${severity}] ${title}`);

    // Fire webhook for critical/high alerts
    if (severity === 'critical' || severity === 'high') {
      dispatchWebhookAlert({ id: result.rows[0]?.id, domain, severity, title, detail });
    }

    return result.rows[0]?.id;
  } catch (err) {
    logger.error(`${TAG} Failed to create alert:`, err.message);
    return null;
  }
}

// Escape SQL LIKE wildcards to prevent pattern injection
function escapeLikePattern(str) {
  return str.replace(/%/g, '\\%').replace(/_/g, '\\_');
}

// Deduplicate: don't re-alert within 2 hours for the same domain+title
async function hasRecentAlert(domain, titlePattern) {
  if (!isDatabaseAvailable()) return true; // fail-safe: skip if DB is down
  try {
    const result = await query(
      `SELECT id FROM admin_alerts
       WHERE domain = $1 AND title LIKE $2
         AND created_at > NOW() - INTERVAL '2 hours'
         AND resolved = FALSE
       LIMIT 1`,
      [domain, `%${escapeLikePattern(titlePattern)}%`]
    );
    return result.rows.length > 0;
  } catch { return false; } // query error: allow alert creation rather than silently suppressing
}

// ══════════════════════════════════════════════════════════════════
// Anomaly Detectors
// ══════════════════════════════════════════════════════════════════

async function checkPaymentFailures() {
  if (!isDatabaseAvailable()) return;
  try {
    // Payment failure rate in last hour vs baseline
    const recent = await query(`
      SELECT COUNT(*) FILTER (WHERE status = 'failed') AS failures,
             COUNT(*) AS total
      FROM accounting_transactions
      WHERE txn_date > NOW() - INTERVAL '1 hour'
    `);
    const { failures, total } = recent.rows[0] || {};
    const failRate = total > 0 ? Number(failures) / Number(total) : 0;

    if (Number(total) >= 3 && failRate > 0.3) {
      if (!(await hasRecentAlert('payments', 'failure rate'))) {
        await createAlert('payments', 'high',
          `Payment failure rate spike: ${(failRate * 100).toFixed(0)}%`,
          `${failures} of ${total} transactions failed in the last hour. Normal rate is < 5%.`);
        await trackPattern('payment_failure_spike', 'payments',
          `Payment failure rate spiked to ${(failRate * 100).toFixed(0)}%`,
          { failures: Number(failures), total: Number(total), rate: failRate });
      }
    }
  } catch (err) { logger.warn(`${TAG} Payment check error:`, err.message); }
}

async function checkFarmHeartbeats() {
  if (!isDatabaseAvailable()) return;
  try {
    const stale = await query(`
      SELECT farm_id, farm_name,
             EXTRACT(EPOCH FROM (NOW() - last_seen_at)) / 60 AS minutes_stale
      FROM farm_heartbeats
      WHERE last_seen_at < NOW() - INTERVAL '30 minutes'
    `);

    for (const farm of stale.rows) {
      const mins = Math.round(Number(farm.minutes_stale));
      if (mins > 60 && !(await hasRecentAlert('farms', farm.farm_id))) {
        const severity = mins > 240 ? 'critical' : mins > 120 ? 'high' : 'medium';
        await createAlert('farms', severity,
          `Farm offline: ${farm.farm_name || farm.farm_id}`,
          `No heartbeat for ${mins} minutes. Farm may be experiencing connectivity or hardware issues.`);
        await trackPattern(`farm_offline:${farm.farm_id}`, 'farms',
          `Farm "${farm.farm_name || farm.farm_id}" went offline (${mins} min)`,
          { farm_id: farm.farm_id, minutes_stale: mins, severity });
      }
    }
  } catch (err) { logger.warn(`${TAG} Heartbeat check error:`, err.message); }
}

async function checkOrderVolumeAnomaly() {
  if (!isDatabaseAvailable()) return;
  try {
    // Compare today's order count to 7-day average
    const stats = await query(`
      WITH daily AS (
        SELECT txn_date::date AS day, COUNT(*) AS cnt
        FROM accounting_transactions t
        JOIN accounting_sources s ON t.source_id = s.id
        WHERE s.source_key LIKE 'wholesale_%'
          AND t.txn_date > NOW() - INTERVAL '8 days'
        GROUP BY day
      )
      SELECT
        MAX(CASE WHEN day = CURRENT_DATE THEN cnt ELSE 0 END) AS today,
        AVG(CASE WHEN day < CURRENT_DATE THEN cnt END) AS avg_7d
      FROM daily
    `);

    const { today, avg_7d } = stats.rows[0] || {};
    const todayCount = Number(today || 0);
    const avgCount = Number(avg_7d || 0);

    if (avgCount >= 2) {
      // Alert if today is < 30% of average (significant drop)
      if (todayCount > 0 && todayCount < avgCount * 0.3) {
        if (!(await hasRecentAlert('orders', 'volume drop'))) {
          await createAlert('orders', 'high',
            `Order volume drop: ${todayCount} today vs ${avgCount.toFixed(0)} avg`,
            `Today's order count is ${((todayCount / avgCount) * 100).toFixed(0)}% of the 7-day average.`);
          await trackPattern('order_volume_drop', 'orders',
            `Order volume dropped to ${((todayCount / avgCount) * 100).toFixed(0)}% of average`,
            { today: todayCount, avg: avgCount });
        }
      }
      // Alert if today is > 300% of average (unusual spike)
      if (todayCount > avgCount * 3) {
        if (!(await hasRecentAlert('orders', 'volume spike'))) {
          await createAlert('orders', 'medium',
            `Order volume spike: ${todayCount} today vs ${avgCount.toFixed(0)} avg`,
            `Today's order count is ${((todayCount / avgCount) * 100).toFixed(0)}% of the 7-day average. This may be positive activity or an anomaly.`);
          await trackPattern('order_volume_spike', 'orders',
            `Order volume spiked to ${((todayCount / avgCount) * 100).toFixed(0)}% of average`,
            { today: todayCount, avg: avgCount });
        }
      }
    }
  } catch (err) { logger.warn(`${TAG} Order volume check error:`, err.message); }
}

async function checkAccountingBalance() {
  if (!isDatabaseAvailable()) return;
  try {
    const result = await query(`
      SELECT SUM(CASE WHEN le.entry_type = 'debit' THEN le.amount ELSE 0 END) AS total_debits,
             SUM(CASE WHEN le.entry_type = 'credit' THEN le.amount ELSE 0 END) AS total_credits
      FROM accounting_ledger_entries le
      WHERE le.created_at > NOW() - INTERVAL '24 hours'
    `);

    const { total_debits, total_credits } = result.rows[0] || {};
    const debits = Number(total_debits || 0);
    const credits = Number(total_credits || 0);
    const imbalance = Math.abs(debits - credits);

    if (imbalance > 0.01 && (debits + credits) > 0) {
      if (!(await hasRecentAlert('accounting', 'imbalance'))) {
        await createAlert('accounting', 'high',
          `Accounting imbalance detected: $${imbalance.toFixed(2)}`,
          `24h totals — Debits: $${debits.toFixed(2)}, Credits: $${credits.toFixed(2)}. Double-entry integrity may be compromised.`);
        await trackPattern('accounting_imbalance', 'accounting',
          `Accounting imbalance of $${imbalance.toFixed(2)} detected`,
          { debits, credits, imbalance });
      }
    }
  } catch (err) { logger.warn(`${TAG} Accounting balance check error:`, err.message); }
}

async function checkUnclassifiedTransactions() {
  if (!isDatabaseAvailable()) return;
  try {
    const result = await query(`
      SELECT COUNT(*) AS cnt
      FROM accounting_transactions t
      LEFT JOIN accounting_classifications c ON t.id = c.transaction_id
      WHERE c.id IS NULL
        AND t.txn_date > NOW() - INTERVAL '7 days'
    `);

    const unclassified = Number(result.rows[0]?.cnt || 0);
    if (unclassified >= 10) {
      if (!(await hasRecentAlert('accounting', 'unclassified'))) {
        await createAlert('accounting', 'medium',
          `${unclassified} unclassified transactions (7-day backlog)`,
          `There are ${unclassified} transactions from the past 7 days without accounting classifications.`);
        await trackPattern('unclassified_txn_backlog', 'accounting',
          `${unclassified} unclassified transactions accumulated over 7 days`,
          { count: unclassified });
      }
    }
  } catch (err) { logger.warn(`${TAG} Unclassified txn check error:`, err.message); }
}

// ══════════════════════════════════════════════════════════════════
// Webhook Dispatch (fire-and-forget for critical/high alerts)
// ══════════════════════════════════════════════════════════════════

function dispatchWebhookAlert(alert) {
  const url = process.env.FAYE_WEBHOOK_URL;
  if (!url) return;

  const payload = JSON.stringify({
    source: 'faye-intelligence',
    event: 'alert',
    severity: alert.severity,
    title: alert.title,
    detail: alert.detail,
    domain: alert.domain,
    alert_id: alert.id,
    timestamp: new Date().toISOString()
  });

  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
    signal: AbortSignal.timeout(10000)
  })
  .then(r => { if (!r.ok) logger.warn(`${TAG} Webhook returned ${r.status}`); })
  .catch(err => logger.warn(`${TAG} Webhook dispatch failed:`, err.message));
}

// ══════════════════════════════════════════════════════════════════
// Auto-Resolve Known Patterns
// ══════════════════════════════════════════════════════════════════

async function checkAutoResolvePatterns() {
  if (!isDatabaseAvailable()) return;
  try {
    // Find open alerts whose pattern has been resolved positively 3+ times
    const candidates = await query(`
      SELECT a.id, a.domain, a.title, a.severity,
             fp.pattern_key, fp.occurrences, fp.last_outcome
      FROM admin_alerts a
      JOIN faye_patterns fp ON fp.domain = a.domain
        AND a.title LIKE '%' || fp.pattern_key || '%'
      WHERE a.resolved = FALSE
        AND a.severity IN ('low', 'medium')
        AND fp.occurrences >= 3
        AND fp.last_outcome = 'resolved_benign'
        AND a.created_at > NOW() - INTERVAL '24 hours'
      LIMIT 10
    `);

    for (const c of candidates.rows) {
      await query(
        `UPDATE admin_alerts SET resolved = TRUE, resolved_at = NOW(),
         metadata = jsonb_set(COALESCE(metadata, '{}')::jsonb, '{auto_resolved}', 'true')
         WHERE id = $1`,
        [c.id]
      );
      logger.info(`${TAG} Auto-resolved alert #${c.id}: "${c.title}" (pattern "${c.pattern_key}" seen ${c.occurrences}x)`);
      await storeInsight('auto_resolve', c.domain,
        `Auto-resolved "${c.title}" — pattern "${c.pattern_key}" historically benign (${c.occurrences} occurrences)`,
        { alert_id: c.id, pattern_key: c.pattern_key, occurrences: c.occurrences });
    }

    if (candidates.rows.length > 0) {
      await trackPattern('auto_resolve_batch', 'system',
        `Auto-resolved ${candidates.rows.length} alerts based on known benign patterns`,
        { count: candidates.rows.length });
    }
  } catch (err) { logger.warn(`${TAG} Auto-resolve check error:`, err.message); }
}

// ══════════════════════════════════════════════════════════════════
// Main Anomaly Check Runner
// ══════════════════════════════════════════════════════════════════

export async function runAnomalyCheck() {
  if (!isDatabaseAvailable()) {
    logger.warn(`${TAG} Skipping anomaly check — database unavailable`);
    return;
  }
  logger.info(`${TAG} Running anomaly detection cycle...`);
  const start = Date.now();

  await Promise.allSettled([
    checkPaymentFailures(),
    checkFarmHeartbeats(),
    checkOrderVolumeAnomaly(),
    checkAccountingBalance(),
    checkUnclassifiedTransactions(),
    checkAutoResolvePatterns()
  ]);

  logger.info(`${TAG} Anomaly cycle complete in ${Date.now() - start}ms`);
}

// ══════════════════════════════════════════════════════════════════
// Daily Briefing Email
// ══════════════════════════════════════════════════════════════════

async function sendDailyBriefing() {
  const today = new Date().toISOString().slice(0, 10);
  if (lastBriefingDate === today) return; // Already sent today
  lastBriefingDate = today;

  if (!isDatabaseAvailable()) return;

  try {
    // Gather key metrics
    const [alertStats, orderStats, farmStats] = await Promise.allSettled([
      query(`SELECT severity, COUNT(*) AS cnt FROM admin_alerts WHERE resolved = FALSE GROUP BY severity`),
      query(`
        SELECT COUNT(*) AS order_count,
               COALESCE(SUM(t.total_amount), 0) AS revenue
        FROM accounting_transactions t
        JOIN accounting_sources s ON t.source_id = s.id
        WHERE s.source_key LIKE 'wholesale_%' AND t.txn_date::date = CURRENT_DATE - 1
      `),
      query(`SELECT COUNT(*) AS total,
                    COUNT(*) FILTER (WHERE last_seen_at > NOW() - INTERVAL '15 minutes') AS online
             FROM farm_heartbeats`)
    ]);

    const alerts = alertStats.status === 'fulfilled' ? alertStats.value.rows : [];
    const orders = orderStats.status === 'fulfilled' ? orderStats.value.rows[0] : {};
    const farms = farmStats.status === 'fulfilled' ? farmStats.value.rows[0] : {};

    const alertSummary = alerts.map(a => `${a.severity}: ${a.cnt}`).join(', ') || 'None';
    const briefingTo = process.env.ADMIN_BRIEFING_EMAIL || process.env.ADMIN_EMAIL;
    if (!briefingTo) { logger.info(`${TAG} No ADMIN_BRIEFING_EMAIL set, skipping briefing.`); return; }

    await emailService.sendEmail({
      to: briefingTo,
      subject: `Daily Operations Briefing — ${today}`,
      text: [
        `F.A.Y.E. Daily Briefing — ${today}`,
        `═══════════════════════════════════`,
        ``,
        `Open Alerts: ${alertSummary}`,
        `Yesterday's Orders: ${orders.order_count || 0} ($${Number(orders.revenue || 0).toFixed(2)})`,
        `Farms Online: ${farms.online || 0} / ${farms.total || 0}`,
        ``,
        `— F.A.Y.E. (Farm Autonomy & Yield Engine)`
      ].join('\n'),
      html: `<div style="font-family:sans-serif;max-width:600px">
        <h2 style="color:#10b981">F.A.Y.E. Daily Briefing — ${today}</h2>
        <table style="border-collapse:collapse;width:100%">
          <tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Open Alerts</strong></td><td style="padding:8px;border-bottom:1px solid #eee">${alertSummary}</td></tr>
          <tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Yesterday's Orders</strong></td><td style="padding:8px;border-bottom:1px solid #eee">${orders.order_count || 0} ($${Number(orders.revenue || 0).toFixed(2)})</td></tr>
          <tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Farms Online</strong></td><td style="padding:8px;border-bottom:1px solid #eee">${farms.online || 0} / ${farms.total || 0}</td></tr>
        </table>
        <hr style="border:none;border-top:1px solid #ddd;margin:20px 0">
        <p style="font-size:12px;color:#888">Automated by F.A.Y.E. (Farm Autonomy & Yield Engine)</p>
      </div>`
    });
    logger.info(`${TAG} Daily briefing sent to ${briefingTo}`);
  } catch (err) {
    logger.error(`${TAG} Briefing email error:`, err.message);
  }
}

// ══════════════════════════════════════════════════════════════════
// Service Lifecycle
// ══════════════════════════════════════════════════════════════════

export function startFayeIntelligence() {
  logger.info(`${TAG} Starting intelligence loop (every ${CHECK_INTERVAL_MS / 60000} min)`);

  // Run first check after 60s (let DB warm up)
  setTimeout(() => {
    runAnomalyCheck().catch(e => logger.error(`${TAG} Anomaly check error:`, e));
  }, 60_000);

  // Schedule recurring checks
  checkInterval = setInterval(() => {
    runAnomalyCheck().catch(e => logger.error(`${TAG} Anomaly check error:`, e));

    // Check if it's briefing time
    const hour = new Date().getHours();
    if (hour === BRIEFING_HOUR) {
      sendDailyBriefing().catch(e => logger.error(`${TAG} Briefing error:`, e));
    }
  }, CHECK_INTERVAL_MS);

  // Schedule first briefing
  const now = new Date();
  const nextBriefing = new Date(now);
  nextBriefing.setHours(BRIEFING_HOUR, 0, 0, 0);
  if (nextBriefing <= now) nextBriefing.setDate(nextBriefing.getDate() + 1);
  const msUntilBriefing = nextBriefing - now;
  briefingTimeout = setTimeout(() => {
    sendDailyBriefing().catch(e => logger.error(`${TAG} Briefing error:`, e));
  }, msUntilBriefing);

  logger.info(`${TAG} Next briefing at ${nextBriefing.toISOString()}`);
}

export function stopFayeIntelligence() {
  if (checkInterval) { clearInterval(checkInterval); checkInterval = null; }
  if (briefingTimeout) { clearTimeout(briefingTimeout); briefingTimeout = null; }
  logger.info(`${TAG} Intelligence loop stopped`);
}
