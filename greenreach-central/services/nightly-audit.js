/**
 * Nightly System Audit — GreenReach Central
 *
 * Runs every 24 hours (default 3 AM ET) and programmatically verifies every
 * critical path: database, inventory pricing, POS readiness, wholesale catalog,
 * farm sync freshness, AI services, payment gateways, and Light Engine
 * reachability.  Results are persisted to `system_audits` and surfaced via
 * the admin API and E.V.I.E.'s `get_system_health` tool.
 */

import { query, isDatabaseAvailable, getDatabase } from '../config/database.js';
import { farmStore } from '../lib/farm-data-store.js';
import emailService from '../services/email-service.js';
import logger from '../utils/logger.js';

// ── Configuration ───────────────────────────────────────────────────
const AUDIT_HOUR = parseInt(process.env.NIGHTLY_AUDIT_HOUR || '3', 10); // 3 AM
const TAG = '[NightlyAudit]';

let auditInterval = null;

// ── Public API ──────────────────────────────────────────────────────

export function startNightlyAuditService() {
  // Calculate ms until next AUDIT_HOUR
  const now = new Date();
  const next = new Date(now);
  next.setHours(AUDIT_HOUR, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  const msUntilNext = next - now;

  logger.info(`${TAG} Scheduled for ${next.toISOString()} (in ${Math.round(msUntilNext / 60000)} min)`);

  // Verify email transport works 30s after startup
  setTimeout(() => verifyEmailTransport(), 30_000);

  setTimeout(() => {
    runNightlyAudit().catch(e => logger.error(`${TAG} Fatal:`, e));
    auditInterval = setInterval(() => {
      runNightlyAudit().catch(e => logger.error(`${TAG} Fatal:`, e));
    }, 24 * 60 * 60 * 1000);
  }, msUntilNext);
}

/**
 * Send a one-time transport verification email after startup.
 * Logs success/failure so operators can confirm email delivery.
 */
async function verifyEmailTransport() {
  const to = process.env.ADMIN_ALERT_EMAIL || process.env.ADMIN_EMAIL;
  if (!to) {
    logger.warn(`${TAG} No ADMIN_ALERT_EMAIL set -- cannot verify email transport`);
    return;
  }
  try {
    const ts = new Date().toISOString();
    const result = await emailService.sendEmail({
      to,
      subject: `GreenReach Central -- Email Transport OK (${ts})`,
      text: `Email transport verified at ${ts}.\nAudit scheduled for ${AUDIT_HOUR}:00 UTC daily.\nThis is an automated startup check.`,
      html: `<div style="font-family:sans-serif;max-width:500px;padding:16px">
        <h3 style="color:#388e3c;margin:0 0 8px">Email Transport Verified</h3>
        <p>Central started at <strong>${ts}</strong></p>
        <p>Nightly audit scheduled for <strong>${AUDIT_HOUR}:00 UTC</strong> daily.</p>
        <p style="font-size:12px;color:#888">This is an automated startup check. If you receive this, email delivery is working.</p>
      </div>`
    });
    if (result.success) {
      logger.info(`${TAG} Email transport OK (via ${result.via || 'unknown'}, id: ${result.messageId})`);
    } else {
      logger.error(`${TAG} Email transport FAILED: ${result.error || 'no transport configured'}`);
    }
  } catch (err) {
    logger.error(`${TAG} Email transport verify error:`, err.message);
  }
}

export function stopNightlyAuditService() {
  if (auditInterval) { clearInterval(auditInterval); auditInterval = null; }
}

/**
 * Return the latest audit result (for E.V.I.E. / admin API).
 * If no DB row exists yet, runs a fresh lightweight audit.
 */
export async function getLatestAudit() {
  if (!isDatabaseAvailable()) return { status: 'unavailable', reason: 'Database offline' };
  try {
    const { rows } = await query(
      `SELECT * FROM system_audits ORDER BY created_at DESC LIMIT 1`
    );
    if (rows.length) return rows[0];
  } catch { /* table may not exist yet */ }
  // No prior result — run a fresh one
  return runNightlyAudit();
}

// ── Core Audit Runner ───────────────────────────────────────────────

export async function runNightlyAudit() {
  const startMs = Date.now();
  logger.info(`${TAG} Starting nightly audit...`);

  const checks = [];

  // 1. Database connectivity
  checks.push(await checkDatabase());

  // 2. Active farms + sync freshness
  checks.push(await checkFarmSync());

  // 3. Inventory pricing integrity
  checks.push(await checkInventoryPricing());

  // 4. POS readiness
  checks.push(await checkPOSReadiness());

  // 5. Wholesale catalog
  checks.push(await checkWholesaleCatalog());

  // 6. Background service freshness
  checks.push(await checkBackgroundServices());

  // 7. Light Engine reachability
  checks.push(await checkLightEngine());

  // 8. AI services
  checks.push(await checkAIServices());

  // 9. Payment gateway credentials
  checks.push(await checkPaymentGateways());

  // 10. Auth system
  checks.push(await checkAuthSystem());

  // Summarise
  const failures = checks.filter(c => c.status === 'fail');
  const warnings = checks.filter(c => c.status === 'warn');
  const overallStatus = failures.length > 0 ? 'fail' : warnings.length > 0 ? 'warn' : 'pass';

  const result = {
    audit_date: new Date().toISOString().slice(0, 10),
    status: overallStatus,
    checks,
    summary: {
      total: checks.length,
      passed: checks.filter(c => c.status === 'pass').length,
      warnings: warnings.length,
      failures: failures.length,
      duration_ms: Date.now() - startMs
    }
  };

  // Persist to DB
  try {
    if (isDatabaseAvailable()) {
      await query(
        `INSERT INTO system_audits (audit_date, status, checks, summary, created_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (audit_date) DO UPDATE SET
           status = EXCLUDED.status,
           checks = EXCLUDED.checks,
           summary = EXCLUDED.summary,
           created_at = NOW()`,
        [result.audit_date, result.status, JSON.stringify(checks), JSON.stringify(result.summary)]
      );
    }
  } catch (err) {
    logger.warn(`${TAG} Could not persist audit results:`, err.message);
  }

  // Log summary
  const emoji = overallStatus === 'pass' ? '[OK]' : overallStatus === 'warn' ? '[WARN]' : '[FAIL]';
  logger.info(`${TAG} ${emoji} Audit complete: ${result.summary.passed}/${result.summary.total} passed, ${result.summary.warnings} warnings, ${result.summary.failures} failures (${result.summary.duration_ms}ms)`);

  if (failures.length > 0) {
    logger.error(`${TAG} FAILURES:`, failures.map(f => `${f.name}: ${f.message}`).join('; '));
  }

  // -- Email audit report (always send -- pass, warn, or fail) --
  try {
    await sendAuditReport(result);
  } catch (alertErr) {
    logger.warn(`${TAG} Could not send audit report email:`, alertErr.message);
  }

  return result;
}

// ── Email Alert ─────────────────────────────────────────────────────

const ALERT_EMAIL = process.env.ADMIN_ALERT_EMAIL || process.env.ADMIN_EMAIL || null;

async function sendAuditReport(result) {
  if (!ALERT_EMAIL) {
    logger.warn(`${TAG} No ADMIN_ALERT_EMAIL configured — skipping email notification`);
    return;
  }

  const { status, checks, summary, audit_date } = result;
  const failures = checks.filter(c => c.status === 'fail');
  const warnings = checks.filter(c => c.status === 'warn');
  const statusLabel = status === 'fail' ? 'FAILURE' : status === 'warn' ? 'WARNING' : 'ALL CLEAR';
  const statusColor = status === 'fail' ? '#d32f2f' : status === 'warn' ? '#f57c00' : '#388e3c';

  const checkRows = checks.map(c => {
    const icon = c.status === 'pass' ? '[OK]' : c.status === 'warn' ? '[WARN]' : '[FAIL]';
    const bg = c.status === 'pass' ? '#e8f5e9' : c.status === 'warn' ? '#fff3e0' : '#ffebee';
    return `<tr style="background:${bg}">
      <td style="padding:6px 10px">${icon} ${c.name.replace(/_/g, ' ')}</td>
      <td style="padding:6px 10px;text-transform:uppercase;font-weight:600">${c.status}</td>
      <td style="padding:6px 10px">${c.message}</td>
    </tr>`;
  }).join('\n');

  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;max-width:640px;margin:0 auto">
  <div style="background:${statusColor};color:#fff;padding:16px 20px;border-radius:8px 8px 0 0">
    <h2 style="margin:0;font-size:20px">GreenReach Nightly Audit: ${statusLabel}</h2>
    <p style="margin:6px 0 0;opacity:0.9">${audit_date} &mdash; ${summary.failures} failure(s), ${summary.warnings} warning(s), ${summary.passed} passed</p>
  </div>

  ${failures.length > 0 ? `
  <div style="background:#ffebee;padding:14px 20px;border-left:4px solid #d32f2f">
    <h3 style="margin:0 0 8px;color:#b71c1c;font-size:15px">[FAIL] Failures Requiring Attention</h3>
    <ul style="margin:0;padding-left:20px">
      ${failures.map(f => `<li><strong>${f.name.replace(/_/g, ' ')}</strong>: ${f.message}</li>`).join('\n      ')}
    </ul>
  </div>` : ''}

  ${warnings.length > 0 ? `
  <div style="background:#fff3e0;padding:14px 20px;border-left:4px solid #f57c00">
    <h3 style="margin:0 0 8px;color:#e65100;font-size:15px">[WARN] Warnings</h3>
    <ul style="margin:0;padding-left:20px">
      ${warnings.map(w => `<li><strong>${w.name.replace(/_/g, ' ')}</strong>: ${w.message}</li>`).join('\n      ')}
    </ul>
  </div>` : ''}

  <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px">
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

  <p style="color:#666;font-size:12px;padding:0 20px">
    Audit ran in ${summary.duration_ms}ms. Log in to the admin dashboard or ask E.V.I.E. <em>"how's the system?"</em> for live status.
  </p>
</div>`;

  const text = `GreenReach Nightly Audit: ${statusLabel} (${audit_date})\n\n` +
    `${summary.failures} failure(s), ${summary.warnings} warning(s), ${summary.passed}/${summary.total} passed\n\n` +
    (failures.length ? 'FAILURES:\n' + failures.map(f => `  [FAIL] ${f.name}: ${f.message}`).join('\n') + '\n\n' : '') +
    (warnings.length ? 'WARNINGS:\n' + warnings.map(w => `  [WARN] ${w.name}: ${w.message}`).join('\n') + '\n\n' : '') +
    'Full details available on the admin dashboard or via E.V.I.E.';

  const emailResult = await emailService.sendEmail({
    to: ALERT_EMAIL,
    subject: `GreenReach Nightly Audit: ${statusLabel} -- ${audit_date}`,
    text,
    html
  });

  if (emailResult.success) {
    logger.info(`${TAG} Alert email sent to ${ALERT_EMAIL} (${emailResult.messageId})`);
  }
}

// ── Individual Checks ───────────────────────────────────────────────

async function checkDatabase() {
  const name = 'database_connectivity';
  try {
    if (!isDatabaseAvailable()) return { name, status: 'fail', message: 'Database pool not initialised' };
    const { rows } = await query('SELECT COUNT(*) AS cnt FROM farms');
    const cnt = parseInt(rows[0]?.cnt || 0);
    if (cnt === 0) return { name, status: 'warn', message: 'No farms registered' };
    return { name, status: 'pass', message: `${cnt} farm(s) in database`, details: { farm_count: cnt } };
  } catch (err) {
    return { name, status: 'fail', message: err.message };
  }
}

async function checkFarmSync() {
  const name = 'farm_sync_freshness';
  try {
    if (!isDatabaseAvailable()) return { name, status: 'fail', message: 'DB unavailable' };
    const { rows } = await query(
      `SELECT farm_id, name,
              MAX(synced_at) AS last_sync,
              EXTRACT(EPOCH FROM (NOW() - MAX(synced_at)))/3600 AS hours_since_sync
       FROM farm_inventory
       JOIN farms USING (farm_id)
       GROUP BY farm_id, name
       ORDER BY hours_since_sync DESC`
    );
    if (!rows.length) return { name, status: 'warn', message: 'No inventory sync records found' };

    const stale = rows.filter(r => parseFloat(r.hours_since_sync) > 48);
    if (stale.length > 0) {
      return {
        name, status: 'warn',
        message: `${stale.length} farm(s) not synced in 48h: ${stale.map(f => f.name || f.farm_id).join(', ')}`,
        details: { stale_farms: stale.map(f => ({ farm_id: f.farm_id, hours_ago: Math.round(parseFloat(f.hours_since_sync)) })) }
      };
    }
    return { name, status: 'pass', message: `All ${rows.length} farm(s) synced within 48h` };
  } catch (err) {
    return { name, status: 'fail', message: err.message };
  }
}

async function checkInventoryPricing() {
  const name = 'inventory_pricing';
  try {
    if (!isDatabaseAvailable()) return { name, status: 'fail', message: 'DB unavailable' };

    // Find items with quantity > 0 and $0 prices
    const { rows } = await query(
      `SELECT farm_id, product_name,
              COALESCE(auto_quantity_lbs,0) + COALESCE(manual_quantity_lbs,0) AS available_lbs,
              COALESCE(retail_price,0) AS retail_price,
              COALESCE(wholesale_price,0) AS wholesale_price
       FROM farm_inventory
       WHERE (COALESCE(auto_quantity_lbs,0) + COALESCE(manual_quantity_lbs,0)) > 0
         AND (COALESCE(retail_price,0) = 0 OR COALESCE(wholesale_price,0) = 0)`
    );

    if (rows.length > 0) {
      const zeroRetail = rows.filter(r => parseFloat(r.retail_price) === 0);
      const zeroWholesale = rows.filter(r => parseFloat(r.wholesale_price) === 0);
      return {
        name, status: 'warn',
        message: `${rows.length} in-stock item(s) with $0 pricing (${zeroRetail.length} retail, ${zeroWholesale.length} wholesale)`,
        details: {
          zero_price_items: rows.slice(0, 20).map(r => ({
            farm_id: r.farm_id,
            product: r.product_name,
            available_lbs: parseFloat(r.available_lbs),
            retail: parseFloat(r.retail_price),
            wholesale: parseFloat(r.wholesale_price)
          }))
        }
      };
    }
    return { name, status: 'pass', message: 'All in-stock items have non-zero pricing' };
  } catch (err) {
    return { name, status: 'fail', message: err.message };
  }
}

async function checkPOSReadiness() {
  const name = 'pos_readiness';
  try {
    if (!isDatabaseAvailable()) return { name, status: 'fail', message: 'DB unavailable' };

    // Check that at least one farm has priced inventory for POS
    const { rows } = await query(
      `SELECT DISTINCT farm_id FROM farm_inventory
       WHERE COALESCE(retail_price,0) > 0
         AND (COALESCE(auto_quantity_lbs,0) + COALESCE(manual_quantity_lbs,0)) > 0`
    );

    // Also check crop pricing is configured
    let cropPricingCount = 0;
    try {
      const farms = await query('SELECT farm_id FROM farms');
      for (const farm of farms.rows.slice(0, 50)) {
        const pricing = await farmStore.get(farm.farm_id, 'crop_pricing');
        if (pricing?.crops?.length > 0) cropPricingCount++;
      }
    } catch { /* farmStore may not be ready */ }

    if (rows.length === 0 && cropPricingCount === 0) {
      return { name, status: 'warn', message: 'No farms have POS-ready inventory or crop pricing configured' };
    }
    return {
      name, status: 'pass',
      message: `${rows.length} farm(s) have POS-ready inventory, ${cropPricingCount} have crop pricing configured`
    };
  } catch (err) {
    return { name, status: 'fail', message: err.message };
  }
}

async function checkWholesaleCatalog() {
  const name = 'wholesale_catalog';
  try {
    if (!isDatabaseAvailable()) return { name, status: 'fail', message: 'DB unavailable' };

    const { rows } = await query(
      `SELECT COUNT(*) AS total,
              COUNT(*) FILTER (WHERE COALESCE(wholesale_price,0) = 0) AS zero_price,
              COUNT(*) FILTER (WHERE available_for_wholesale = true) AS wholesale_enabled
       FROM farm_inventory
       WHERE (COALESCE(auto_quantity_lbs,0) + COALESCE(manual_quantity_lbs,0)) > 0`
    );

    const { total, zero_price, wholesale_enabled } = rows[0] || {};
    const t = parseInt(total || 0);
    const zp = parseInt(zero_price || 0);
    const we = parseInt(wholesale_enabled || 0);

    if (t === 0) return { name, status: 'warn', message: 'No in-stock items in catalog' };
    if (zp > 0) {
      return {
        name, status: 'warn',
        message: `${zp}/${t} in-stock items have $0 wholesale price`,
        details: { total_items: t, zero_price_items: zp, wholesale_enabled: we }
      };
    }
    return {
      name, status: 'pass',
      message: `${we} wholesale-enabled items, all priced`,
      details: { total_items: t, wholesale_enabled: we }
    };
  } catch (err) {
    return { name, status: 'fail', message: err.message };
  }
}

async function checkBackgroundServices() {
  const name = 'background_services';
  try {
    if (!isDatabaseAvailable()) return { name, status: 'warn', message: 'DB unavailable — cannot check service timestamps' };

    const stale = [];

    // Check AI usage (ai_recommendations_pusher writes daily)
    try {
      const { rows } = await query(
        `SELECT MAX(created_at) AS last_run FROM ai_usage WHERE created_at > NOW() - INTERVAL '48 hours'`
      );
      if (!rows[0]?.last_run) stale.push('ai_recommendations');
    } catch { /* table may not exist */ }

    // Check market data freshness
    try {
      const { rows } = await query(
        `SELECT MAX(fetched_at) AS last_fetch FROM market_prices WHERE fetched_at > NOW() - INTERVAL '48 hours'`
      );
      if (!rows[0]?.last_fetch) stale.push('market_data_fetcher');
    } catch { /* table may not exist */ }

    // Check experiment/benchmark freshness
    try {
      const { rows } = await query(
        `SELECT MAX(recorded_at) AS last_record FROM experiment_records WHERE recorded_at > NOW() - INTERVAL '14 days'`
      );
      if (!rows[0]?.last_record) stale.push('benchmark_aggregation');
    } catch { /* table may not exist */ }

    if (stale.length > 0) {
      return { name, status: 'warn', message: `Stale background services: ${stale.join(', ')}`, details: { stale_services: stale } };
    }
    return { name, status: 'pass', message: 'All background services ran within expected windows' };
  } catch (err) {
    return { name, status: 'fail', message: err.message };
  }
}

async function checkLightEngine() {
  const name = 'light_engine_reachability';
  try {
    const edgeUrl = process.env.FARM_EDGE_URL;
    if (!edgeUrl) return { name, status: 'warn', message: 'FARM_EDGE_URL not configured — Light Engine connectivity not tested' };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(`${edgeUrl}/health`, {
        signal: controller.signal,
        headers: { 'Accept': 'application/json' }
      });
      clearTimeout(timeout);
      if (res.ok) return { name, status: 'pass', message: `Light Engine reachable (${res.status})` };
      return { name, status: 'warn', message: `Light Engine responded ${res.status}` };
    } catch (err) {
      clearTimeout(timeout);
      return { name, status: 'warn', message: `Light Engine unreachable: ${err.message}` };
    }
  } catch (err) {
    return { name, status: 'fail', message: err.message };
  }
}

async function checkAIServices() {
  const name = 'ai_services';
  try {
    // Check Gemini / Vertex AI availability
    const gcpProject = process.env.GCP_PROJECT;
    const geminiKey = process.env.GEMINI_API_KEY;
    if (!gcpProject && !geminiKey) return { name, status: 'fail', message: 'Gemini not configured (no GCP_PROJECT or GEMINI_API_KEY)' };

    // Lightweight model list check (no tokens consumed)
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      let res;
      if (gcpProject) {
        // Vertex AI: use ADC token to list models
        const { GoogleAuth } = await import('google-auth-library');
        const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
        const token = await auth.getAccessToken();
        const region = process.env.GCP_REGION || 'us-east1';
        res = await fetch(
          `https://${region}-aiplatform.googleapis.com/v1/projects/${gcpProject}/locations/${region}/publishers/google/models`, {
          signal: controller.signal,
          headers: { 'Authorization': `Bearer ${token}` }
        });
      } else {
        // Gemini Developer API
        res = await fetch(`https://generativelanguage.googleapis.com/v1/models?key=${geminiKey}`, {
          signal: controller.signal
        });
      }
      clearTimeout(timeout);
      if (res.ok) return { name, status: 'pass', message: 'Gemini API reachable and configured' };
      if (res.status === 401 || res.status === 403) return { name, status: 'fail', message: 'Gemini credentials rejected (' + res.status + ')' };
      return { name, status: 'warn', message: `Gemini API returned ${res.status}` };
    } catch (err) {
      clearTimeout(timeout);
      return { name, status: 'warn', message: `Gemini API unreachable: ${err.message}` };
    }
  } catch (err) {
    return { name, status: 'fail', message: err.message };
  }
}

async function checkPaymentGateways() {
  const name = 'payment_gateways';
  try {
    const issues = [];

    // Check Stripe
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      issues.push('STRIPE_SECRET_KEY not set');
    } else if (!stripeKey.startsWith('sk_')) {
      issues.push('STRIPE_SECRET_KEY format invalid');
    }

    // Check Square — per-farm credentials in farmStore
    let squareFarms = 0;
    try {
      if (isDatabaseAvailable()) {
        const { rows } = await query('SELECT farm_id FROM farms');
        for (const farm of rows.slice(0, 50)) {
          const oauth = await farmStore.get(farm.farm_id, 'square_oauth');
          if (oauth?.access_token) squareFarms++;
        }
      }
    } catch { /* non-fatal */ }

    if (issues.length > 0) {
      return { name, status: 'warn', message: issues.join('; '), details: { square_connected_farms: squareFarms } };
    }
    return {
      name, status: 'pass',
      message: `Stripe configured, ${squareFarms} farm(s) with Square connected`,
      details: { square_connected_farms: squareFarms }
    };
  } catch (err) {
    return { name, status: 'fail', message: err.message };
  }
}

async function checkAuthSystem() {
  const name = 'auth_system';
  try {
    const jwtSecret = process.env.JWT_SECRET || process.env.SESSION_SECRET;
    if (!jwtSecret) return { name, status: 'fail', message: 'JWT_SECRET not configured' };
    if (jwtSecret.length < 16) return { name, status: 'warn', message: 'JWT_SECRET is too short (< 16 chars)' };
    if (jwtSecret === 'changeme' || jwtSecret === 'secret') {
      return { name, status: 'fail', message: 'JWT_SECRET is set to an insecure default value' };
    }
    return { name, status: 'pass', message: 'JWT secret configured and adequate length' };
  } catch (err) {
    return { name, status: 'fail', message: err.message };
  }
}
