/**
 * Nightly AI Checklist Service
 * ==============================
 * Runs at 2 AM ET daily (before the 3 AM system audit).
 * Implements the self-evolving grower app nightly loop:
 *
 * 1. E.V.I.E. compiles a Daily User Use Note from conversation data
 * 2. F.A.Y.E. compiles a Business Context Brief from operations data
 * 3. Both agents exchange learning notes via inter-agent messaging
 * 4. Notes are persisted to faye_knowledge for long-term trend analysis
 * 5. Nightly checklist questions are evaluated against thresholds
 * 6. High-priority flags generate immediate alerts; medium flags are queued
 *
 * Designed to run BEFORE the nightly-audit.js (3 AM) so the system audit
 * benefits from any alerts or insights generated here.
 */

import { query, isDatabaseAvailable } from '../config/database.js';
import { sendAgentMessage, storeInsight, trackPattern } from '../services/faye-learning.js';
import logger from '../utils/logger.js';

const TAG = '[NightlyChecklist]';
const CHECKLIST_HOUR = parseInt(process.env.NIGHTLY_CHECKLIST_HOUR || '2', 10); // 2 AM ET

let checklistTimeout = null;
let checklistInterval = null;
let lastChecklistDate = null;

// ══════════════════════════════════════════════════════════════════
// 1. E.V.I.E. Daily User Use Note
// ══════════════════════════════════════════════════════════════════

async function buildEvieUserUseNote() {
  if (!isDatabaseAvailable()) return null;

  const today = new Date().toISOString().slice(0, 10);
  const note = { date: today, sections: {} };

  try {
    // Interaction summary — conversations from the past 24 hours
    const convStats = await query(`
      SELECT COUNT(DISTINCT conversation_id) AS total_conversations,
             COUNT(DISTINCT farm_id) AS unique_growers,
             COUNT(*) AS total_messages,
             ROUND(COUNT(*)::numeric / NULLIF(COUNT(DISTINCT conversation_id), 0), 1) AS avg_turns
      FROM assistant_conversations
      WHERE created_at > NOW() - INTERVAL '24 hours'
    `).catch(() => ({ rows: [{}] }));
    note.sections.interaction_summary = convStats.rows[0] || {};

    // Tool usage patterns — which tools were called
    const toolStats = await query(`
      SELECT tool_name, COUNT(*) AS call_count
      FROM assistant_tool_calls
      WHERE created_at > NOW() - INTERVAL '24 hours'
      GROUP BY tool_name
      ORDER BY call_count DESC
      LIMIT 15
    `).catch(() => ({ rows: [] }));
    note.sections.tool_usage = toolStats.rows;

    // Escalations to F.A.Y.E.
    const escalations = await query(`
      SELECT COUNT(*) AS cnt
      FROM agent_messages
      WHERE sender = 'evie' AND recipient = 'faye'
        AND message_type = 'escalation'
        AND created_at > NOW() - INTERVAL '24 hours'
    `).catch(() => ({ rows: [{ cnt: 0 }] }));
    note.sections.escalation_count = Number(escalations.rows[0]?.cnt || 0);

    // Sensor coverage — how many sensors are reporting
    const sensorStats = await query(`
      SELECT COUNT(*) AS total_sensors,
             COUNT(*) FILTER (WHERE last_reading_at > NOW() - INTERVAL '1 hour') AS reporting
      FROM device_registry
      WHERE device_type = 'sensor'
    `).catch(() => ({ rows: [{ total_sensors: 0, reporting: 0 }] }));
    note.sections.sensor_health = sensorStats.rows[0] || {};

    // Environment compliance — zones within target ranges
    const envStats = await query(`
      SELECT COUNT(*) AS total_zones,
             COUNT(*) FILTER (WHERE temperature BETWEEN target_temp_min AND target_temp_max
                              AND humidity BETWEEN target_humidity_min AND target_humidity_max) AS compliant
      FROM zone_readings_latest
    `).catch(() => ({ rows: [{ total_zones: 0, compliant: 0 }] }));
    note.sections.environment_compliance = envStats.rows[0] || {};

  } catch (err) {
    logger.warn(`${TAG} Error building E.V.I.E. User Use Note:`, err.message);
  }

  return note;
}

function formatUserUseNote(note) {
  if (!note) return 'No user use data available for today.';

  const s = note.sections;
  const lines = [
    `E.V.I.E. Daily User Use Note -- ${note.date}`,
    `════════════════════════════════════════`,
    '',
    `Interaction Summary:`,
    `  Conversations: ${s.interaction_summary?.total_conversations || 0}`,
    `  Unique growers: ${s.interaction_summary?.unique_growers || 0}`,
    `  Total messages: ${s.interaction_summary?.total_messages || 0}`,
    `  Avg turns/session: ${s.interaction_summary?.avg_turns || 'N/A'}`,
    '',
    `Top Tools Used:`,
    ...(s.tool_usage || []).slice(0, 8).map(t => `  ${t.tool_name}: ${t.call_count} calls`),
    '',
    `Escalations to F.A.Y.E.: ${s.escalation_count || 0}`,
    '',
    `Sensor Health:`,
    `  Total sensors: ${s.sensor_health?.total_sensors || 0}`,
    `  Currently reporting: ${s.sensor_health?.reporting || 0}`,
    '',
    `Environment Compliance:`,
    `  Total zones: ${s.environment_compliance?.total_zones || 0}`,
    `  Zones in range: ${s.environment_compliance?.compliant || 0}`
  ];

  return lines.join('\n');
}

// ══════════════════════════════════════════════════════════════════
// 2. F.A.Y.E. Business Context Brief
// ══════════════════════════════════════════════════════════════════

async function buildFayeBusinessBrief() {
  if (!isDatabaseAvailable()) return null;

  const today = new Date().toISOString().slice(0, 10);
  const brief = { date: today, sections: {} };

  try {
    // Order trends — today vs 7-day average
    const orderStats = await query(`
      WITH daily AS (
        SELECT txn_date::date AS day, COUNT(*) AS cnt, SUM(total_amount) AS revenue
        FROM accounting_transactions t
        JOIN accounting_sources s ON t.source_id = s.id
        WHERE s.source_key LIKE 'wholesale_%'
          AND t.txn_date > NOW() - INTERVAL '8 days'
        GROUP BY day
      )
      SELECT
        MAX(CASE WHEN day = CURRENT_DATE THEN cnt ELSE 0 END) AS today_orders,
        MAX(CASE WHEN day = CURRENT_DATE THEN revenue ELSE 0 END) AS today_revenue,
        ROUND(AVG(CASE WHEN day < CURRENT_DATE THEN cnt END), 1) AS avg_daily_orders,
        ROUND(AVG(CASE WHEN day < CURRENT_DATE THEN revenue END), 2) AS avg_daily_revenue
      FROM daily
    `).catch(() => ({ rows: [{}] }));
    brief.sections.order_trends = orderStats.rows[0] || {};

    // Active alerts
    const alertStats = await query(`
      SELECT severity, COUNT(*) AS cnt
      FROM admin_alerts
      WHERE resolved = FALSE
      GROUP BY severity
    `).catch(() => ({ rows: [] }));
    brief.sections.active_alerts = alertStats.rows;

    // Farm network health
    const farmStats = await query(`
      SELECT COUNT(*) AS total_farms,
             COUNT(*) FILTER (WHERE last_seen_at > NOW() - INTERVAL '15 minutes') AS online,
             COUNT(*) FILTER (WHERE last_seen_at < NOW() - INTERVAL '1 hour') AS stale
      FROM farm_heartbeats
    `).catch(() => ({ rows: [{}] }));
    brief.sections.farm_health = farmStats.rows[0] || {};

    // Recent pricing changes
    const priceChanges = await query(`
      SELECT crop_name, old_price, new_price, updated_at
      FROM crop_price_history
      WHERE updated_at > NOW() - INTERVAL '24 hours'
      ORDER BY updated_at DESC
      LIMIT 5
    `).catch(() => ({ rows: [] }));
    brief.sections.price_changes = priceChanges.rows;

  } catch (err) {
    logger.warn(`${TAG} Error building F.A.Y.E. Business Brief:`, err.message);
  }

  return brief;
}

function formatBusinessBrief(brief) {
  if (!brief) return 'No business data available for today.';

  const s = brief.sections;
  const alerts = (s.active_alerts || []).map(a => `${a.severity}: ${a.cnt}`).join(', ') || 'None';

  const lines = [
    `F.A.Y.E. Business Context Brief -- ${brief.date}`,
    `════════════════════════════════════════`,
    '',
    `Order Trends:`,
    `  Today: ${s.order_trends?.today_orders || 0} orders ($${Number(s.order_trends?.today_revenue || 0).toFixed(2)})`,
    `  7-day avg: ${s.order_trends?.avg_daily_orders || 0} orders ($${Number(s.order_trends?.avg_daily_revenue || 0).toFixed(2)})`,
    '',
    `Active Alerts: ${alerts}`,
    '',
    `Farm Network:`,
    `  Total farms: ${s.farm_health?.total_farms || 0}`,
    `  Online: ${s.farm_health?.online || 0}`,
    `  Stale (>1h): ${s.farm_health?.stale || 0}`,
    '',
    `Price Changes (24h):`,
    ...(s.price_changes || []).map(p => `  ${p.crop_name}: $${p.old_price} -> $${p.new_price}`),
    ...(!(s.price_changes || []).length ? ['  None'] : [])
  ];

  return lines.join('\n');
}

// ══════════════════════════════════════════════════════════════════
// 3. Learning Notes Exchange
// ══════════════════════════════════════════════════════════════════

async function exchangeLearningNotes() {
  logger.info(`${TAG} Exchanging daily learning notes between E.V.I.E. and F.A.Y.E....`);

  const [userUseNote, businessBrief] = await Promise.allSettled([
    buildEvieUserUseNote(),
    buildFayeBusinessBrief()
  ]);

  const noteData = userUseNote.status === 'fulfilled' ? userUseNote.value : null;
  const briefData = businessBrief.status === 'fulfilled' ? businessBrief.value : null;

  const noteText = formatUserUseNote(noteData);
  const briefText = formatBusinessBrief(briefData);

  // E.V.I.E. -> F.A.Y.E.: User Use Note
  await sendAgentMessage(
    'evie', 'faye', 'observation',
    `Daily User Use Note -- ${new Date().toISOString().slice(0, 10)}`,
    noteText,
    { type: 'daily_user_use_note', date: new Date().toISOString().slice(0, 10) },
    'normal'
  );

  // F.A.Y.E. -> E.V.I.E.: Business Context Brief
  await sendAgentMessage(
    'faye', 'evie', 'directive',
    `Daily Business Context Brief -- ${new Date().toISOString().slice(0, 10)}`,
    briefText,
    { type: 'daily_business_brief', date: new Date().toISOString().slice(0, 10) },
    'normal'
  );

  // Persist both to faye_knowledge for long-term trend analysis
  const today = new Date().toISOString().slice(0, 10);
  await storeInsight('nightly_checklist', `user_use_note_${today}`, noteText, 'nightly-checklist', 0.9);
  await storeInsight('nightly_checklist', `business_brief_${today}`, briefText, 'nightly-checklist', 0.9);

  logger.info(`${TAG} Learning notes exchanged and persisted.`);

  return { noteData, briefData };
}

// ══════════════════════════════════════════════════════════════════
// 4. Nightly Checklist Questions
// ══════════════════════════════════════════════════════════════════

async function runChecklistQuestions() {
  logger.info(`${TAG} Running nightly checklist questions...`);
  const flags = [];

  // --- Sensor Health ---
  try {
    const sensorCheck = await query(`
      SELECT COUNT(*) AS total,
             COUNT(*) FILTER (WHERE last_reading_at > NOW() - INTERVAL '1 hour') AS active,
             COUNT(*) FILTER (WHERE last_reading_at < NOW() - INTERVAL '6 hours' OR last_reading_at IS NULL) AS dead
      FROM device_registry
      WHERE device_type = 'sensor'
    `).catch(() => ({ rows: [{ total: 0, active: 0, dead: 0 }] }));

    const { total, active, dead } = sensorCheck.rows[0] || {};
    const coverage = Number(total) > 0 ? Number(active) / Number(total) : 1;
    if (coverage < 0.95 && Number(total) > 0) {
      flags.push({
        theme: 'Sensor Health',
        question: 'Are all expected sensors online and reporting?',
        severity: coverage < 0.7 ? 'high' : 'medium',
        detail: `Sensor coverage: ${(coverage * 100).toFixed(0)}% (${active}/${total} reporting). ${dead} sensors dead (>6h).`
      });
    }
  } catch (err) { logger.warn(`${TAG} Sensor check error:`, err.message); }

  // --- Environment Compliance ---
  try {
    const envCheck = await query(`
      SELECT COUNT(*) AS total_zones,
             COUNT(*) FILTER (WHERE temperature < target_temp_min OR temperature > target_temp_max) AS temp_violations,
             COUNT(*) FILTER (WHERE humidity < target_humidity_min OR humidity > target_humidity_max) AS humidity_violations
      FROM zone_readings_latest
    `).catch(() => ({ rows: [{ total_zones: 0, temp_violations: 0, humidity_violations: 0 }] }));

    const { total_zones, temp_violations, humidity_violations } = envCheck.rows[0] || {};
    if (Number(temp_violations) > 0 || Number(humidity_violations) > 0) {
      flags.push({
        theme: 'Environment',
        question: 'Are environmental setpoints consistent with active crop recipes?',
        severity: (Number(temp_violations) + Number(humidity_violations)) > 2 ? 'high' : 'medium',
        detail: `${temp_violations} zone(s) with temperature out of range, ${humidity_violations} zone(s) with humidity out of range.`
      });
    }
  } catch (err) { logger.warn(`${TAG} Environment check error:`, err.message); }

  // --- Job Health (using system_audits table) ---
  try {
    const jobCheck = await query(`
      SELECT status, COUNT(*) AS cnt
      FROM system_audits
      WHERE created_at > NOW() - INTERVAL '24 hours'
      GROUP BY status
    `).catch(() => ({ rows: [] }));

    const failedJobs = jobCheck.rows.find(r => r.status === 'fail');
    if (failedJobs && Number(failedJobs.cnt) > 0) {
      flags.push({
        theme: 'Ops/DevOps',
        question: 'Did any nightly processing jobs fail?',
        severity: 'high',
        detail: `${failedJobs.cnt} audit check(s) failed in the last 24 hours.`
      });
    }
  } catch (err) { logger.warn(`${TAG} Job health check error:`, err.message); }

  // --- Stale External Data ---
  try {
    const weatherFreshness = await query(`
      SELECT MAX(updated_at) AS last_update
      FROM weather_cache
    `).catch(() => ({ rows: [{ last_update: null }] }));

    const lastWeather = weatherFreshness.rows[0]?.last_update;
    if (lastWeather) {
      const hoursStale = (Date.now() - new Date(lastWeather).getTime()) / (1000 * 60 * 60);
      if (hoursStale > 24) {
        flags.push({
          theme: 'Data & Drift',
          question: 'Are external data feeds current?',
          severity: 'medium',
          detail: `Weather data is ${Math.round(hoursStale)} hours stale. Last update: ${new Date(lastWeather).toISOString()}.`
        });
      }
    }
  } catch { /* table may not exist — non-fatal */ }

  // --- Accounting Integrity ---
  try {
    const accountingCheck = await query(`
      SELECT
        SUM(CASE WHEN le.entry_type = 'debit' THEN le.amount ELSE 0 END) AS debits,
        SUM(CASE WHEN le.entry_type = 'credit' THEN le.amount ELSE 0 END) AS credits
      FROM accounting_ledger_entries le
      WHERE le.created_at > NOW() - INTERVAL '24 hours'
    `).catch(() => ({ rows: [{ debits: 0, credits: 0 }] }));

    const { debits, credits } = accountingCheck.rows[0] || {};
    const imbalance = Math.abs(Number(debits || 0) - Number(credits || 0));
    if (imbalance > 0.01 && (Number(debits) + Number(credits)) > 0) {
      flags.push({
        theme: 'Compliance',
        question: 'Is accounting double-entry integrity maintained?',
        severity: 'high',
        detail: `Imbalance of $${imbalance.toFixed(2)} in last 24h. Debits: $${Number(debits || 0).toFixed(2)}, Credits: $${Number(credits || 0).toFixed(2)}.`
      });
    }
  } catch (err) { logger.warn(`${TAG} Accounting check error:`, err.message); }

  // --- Active Experiments ---
  try {
    const trialCheck = await query(`
      SELECT COUNT(*) AS active_trials,
             COUNT(*) FILTER (WHERE end_date < CURRENT_DATE AND status = 'running') AS overdue
      FROM experiments
      WHERE status IN ('running', 'paused')
    `).catch(() => ({ rows: [{ active_trials: 0, overdue: 0 }] }));

    const { overdue } = trialCheck.rows[0] || {};
    if (Number(overdue) > 0) {
      flags.push({
        theme: 'Experimentation',
        question: 'Are any trials past their end date but still running?',
        severity: 'medium',
        detail: `${overdue} experiment(s) are past their planned end date and still marked as running.`
      });
    }
  } catch { /* table may not exist — non-fatal */ }

  return flags;
}

// ══════════════════════════════════════════════════════════════════
// 5. Alert Generation from Flags
// ══════════════════════════════════════════════════════════════════

async function processChecklistFlags(flags) {
  if (!flags.length) {
    logger.info(`${TAG} No flags raised. All checklist items clear.`);
    return;
  }

  logger.info(`${TAG} ${flags.length} flag(s) raised. Processing...`);

  for (const flag of flags) {
    try {
      // Store as insight for learning
      await storeInsight(
        'nightly_checklist',
        `checklist_${flag.theme.toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
        `[${flag.severity.toUpperCase()}] ${flag.question} — ${flag.detail}`,
        'nightly-checklist',
        flag.severity === 'high' ? 0.95 : 0.8
      );

      // Track as pattern
      await trackPattern(
        `checklist_flag:${flag.theme}`,
        'nightly_checklist',
        flag.detail,
        { severity: flag.severity, question: flag.question }
      );

      // High-severity: create admin alert (re-uses faye-intelligence alert mechanism)
      if (flag.severity === 'high') {
        // Check for existing recent alert to avoid duplicates
        const existing = await query(`
          SELECT id FROM admin_alerts
          WHERE domain = 'nightly_checklist'
            AND title LIKE $1
            AND created_at > NOW() - INTERVAL '20 hours'
            AND resolved = FALSE
          LIMIT 1
        `, [`%${flag.theme}%`]).catch(() => ({ rows: [] }));

        if (existing.rows.length === 0) {
          await query(`
            INSERT INTO admin_alerts (domain, severity, title, detail, source, metadata)
            VALUES ($1, $2, $3, $4, $5, $6)
          `, [
            'nightly_checklist',
            flag.severity,
            `Nightly Checklist: ${flag.theme}`,
            flag.detail,
            'nightly-checklist',
            JSON.stringify({ question: flag.question, auto: true, ts: Date.now() })
          ]);
        }
      }
    } catch (err) {
      logger.warn(`${TAG} Error processing flag "${flag.theme}":`, err.message);
    }
  }

  // Send summary to F.A.Y.E.
  const summary = flags.map(f => `[${f.severity.toUpperCase()}] ${f.theme}: ${f.detail}`).join('\n');
  await sendAgentMessage(
    'evie', 'faye', 'observation',
    `Nightly Checklist Results -- ${new Date().toISOString().slice(0, 10)}`,
    `${flags.length} item(s) flagged:\n${summary}`,
    { type: 'nightly_checklist_results', flag_count: flags.length },
    flags.some(f => f.severity === 'high') ? 'high' : 'normal'
  );
}

// ══════════════════════════════════════════════════════════════════
// 6. Main Runner
// ══════════════════════════════════════════════════════════════════

export async function runNightlyChecklist() {
  const today = new Date().toISOString().slice(0, 10);
  if (lastChecklistDate === today) {
    logger.info(`${TAG} Already ran today (${today}). Skipping.`);
    return;
  }
  lastChecklistDate = today;

  if (!isDatabaseAvailable()) {
    logger.warn(`${TAG} Skipping nightly checklist — database unavailable`);
    return;
  }

  const start = Date.now();
  logger.info(`${TAG} ═══ Starting Nightly AI Checklist ═══`);

  try {
    // Step 1: Exchange learning notes (E.V.I.E. User Use Note + F.A.Y.E. Business Brief)
    await exchangeLearningNotes();

    // Step 2: Run checklist questions
    const flags = await runChecklistQuestions();

    // Step 3: Process flags (generate alerts, store insights)
    await processChecklistFlags(flags);

    logger.info(`${TAG} ═══ Nightly AI Checklist complete in ${Date.now() - start}ms (${flags.length} flags) ═══`);
  } catch (err) {
    logger.error(`${TAG} Fatal error in nightly checklist:`, err.message);
  }
}

// ══════════════════════════════════════════════════════════════════
// 7. Service Lifecycle
// ══════════════════════════════════════════════════════════════════

export function startNightlyChecklist() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(CHECKLIST_HOUR, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  const msUntilNext = next - now;

  logger.info(`${TAG} Scheduled for ${next.toISOString()} (in ${Math.round(msUntilNext / 60000)} min)`);

  checklistTimeout = setTimeout(() => {
    runNightlyChecklist().catch(e => logger.error(`${TAG} Fatal:`, e));
    checklistInterval = setInterval(() => {
      runNightlyChecklist().catch(e => logger.error(`${TAG} Fatal:`, e));
    }, 24 * 60 * 60 * 1000);
  }, msUntilNext);
}

export function stopNightlyChecklist() {
  if (checklistTimeout) { clearTimeout(checklistTimeout); checklistTimeout = null; }
  if (checklistInterval) { clearInterval(checklistInterval); checklistInterval = null; }
  logger.info(`${TAG} Nightly checklist stopped`);
}
