/**
 * F.A.Y.E. Policy Engine — v3.1
 * ==============================
 * Governance layer that sits above the learning engine.
 * Learning suggests. Policy decides what is allowed.
 *
 * Three concepts:
 *
 * 1. ACTION CLASSES — Trust attaches to action types, not tools.
 *    A single tool can perform actions with different risk profiles.
 *    Classes: recommend, classify, notify, modify, transact, override.
 *
 * 2. HARD BOUNDARIES — Non-negotiable rules the system enforces
 *    regardless of trust level or learning outcomes.
 *
 * 3. SHADOW MODE — Before F.A.Y.E. executes actions automatically,
 *    she first simulates what she would have done and logs it.
 *    Promotions require shadow mode validation.
 */

import logger from '../utils/logger.js';
import { query, isDatabaseAvailable } from '../config/database.js';

const TAG = '[F.A.Y.E. Policy]';

// ── Action Classes ───────────────────────────────────────────────
// Trust attaches to the action TYPE, not the tool. A tool like send_email
// could be "notify" (internal summary, low risk) or "transact" (refund
// receipt to external customer, high risk).

export const ACTION_CLASSES = {
  recommend: {
    description: 'Propose a course of action for admin review',
    default_tier: 'auto',
    examples: ['suggest classification', 'propose diagnosis', 'recommend pricing']
  },
  classify: {
    description: 'Assign a category, label, or status to data',
    default_tier: 'quick_confirm',
    examples: ['classify transaction', 'tag alert', 'label pattern']
  },
  notify: {
    description: 'Send internal notifications or surface information',
    default_tier: 'auto',
    examples: ['create alert', 'internal email summary', 'daily briefing']
  },
  modify: {
    description: 'Change system state or configuration',
    default_tier: 'confirm',
    examples: ['update farm notes', 'adjust thresholds', 'resolve alert']
  },
  transact: {
    description: 'Financial operations — payments, refunds, pricing changes',
    default_tier: 'admin',
    examples: ['process refund', 'adjust pricing', 'modify order']
  },
  override: {
    description: 'Override safety controls or escalation decisions',
    default_tier: 'admin',
    examples: ['force-resolve', 'bypass confirmation', 'override threshold']
  }
};

// Map tools to their action class based on what they actually DO
export const TOOL_ACTION_MAP = {
  // recommend
  'get_trial_balance': 'recommend',
  'get_revenue_summary': 'recommend',
  'get_order_dashboard': 'recommend',
  'get_market_prices': 'recommend',
  'evaluate_trust_promotion': 'recommend',
  'get_domain_ownership': 'recommend',
  'get_knowledge': 'recommend',
  'search_knowledge': 'recommend',
  'get_patterns': 'recommend',
  'get_frequent_patterns': 'recommend',
  'get_outcome_stats': 'recommend',
  'get_false_positive_rate': 'recommend',

  // classify
  'classify_transaction': 'classify',
  'store_insight': 'classify',
  'record_outcome': 'classify',
  'rate_alert': 'classify',
  'set_domain_ownership': 'classify',

  // notify
  'create_alert': 'notify',
  'acknowledge_alert': 'notify',
  'save_admin_memory': 'notify',
  'update_farm_notes': 'notify',

  // modify
  'resolve_alert': 'modify',
  'archive_insight': 'modify',
  'send_admin_email': 'modify',
  'send_sms': 'modify',

  // transact
  'process_refund': 'transact',

  // read-only external access (maps to recommend -- no write actions)
  'fetch_market_trends': 'recommend',
  'get_approved_market_sources': 'recommend',

  // inter-agent communication
  'send_message_to_evie': 'notify',
  'get_evie_messages': 'recommend',
  'get_agent_conversation': 'recommend',

  // conversation history recall
  'recall_conversations': 'recommend',
  'search_past_conversations': 'recommend',

  // security & feedback
  'run_security_audit': 'recommend',
  'record_recommendation_feedback': 'classify',
  'get_webhook_config': 'recommend'
};

/**
 * Get the action class for a tool.
 * Falls back to 'recommend' for read-only tools.
 */
export function getActionClass(toolName) {
  return TOOL_ACTION_MAP[toolName] || 'recommend';
}

/**
 * Get the effective trust tier for a tool based on its action class.
 * Action class provides the baseline; per-tool overrides can tighten but not loosen.
 */
export function getActionClassTier(toolName) {
  const actionClass = getActionClass(toolName);
  return ACTION_CLASSES[actionClass]?.default_tier || 'confirm';
}

// ── Hard Boundaries (Policy Firewall) ────────────────────────────
// These rules are enforced regardless of trust level or learning.
// They cannot be overridden by promotion, shadow mode, or admin memory.

export const HARD_BOUNDARIES = [
  {
    id: 'hb-001',
    rule: 'Never issue refunds automatically. All refunds require explicit admin confirmation with amount and target stated.',
    applies_to: ['process_refund'],
    action_class: 'transact',
    max_tier: 'admin' // Can never be promoted above this
  },
  {
    id: 'hb-002',
    rule: 'Never change product pricing without explicit admin approval.',
    applies_to: ['update_pricing', 'set_product_price', 'bulk_price_update'],
    action_class: 'transact',
    max_tier: 'admin'
  },
  {
    id: 'hb-003',
    rule: 'Never send external customer-facing communications without a human-reviewed template.',
    applies_to: ['send_admin_email'],
    action_class: 'modify',
    max_tier: 'confirm'
  },
  {
    id: 'hb-003b',
    rule: 'Never send SMS messages automatically. All SMS requires admin confirmation. Recipient is hardcoded to approved numbers only.',
    applies_to: ['send_sms'],
    action_class: 'modify',
    max_tier: 'confirm'
  },
  {
    id: 'hb-004',
    rule: 'Never deactivate a farm or remove a buyer from the network without admin confirmation.',
    applies_to: [],
    action_class: 'override',
    max_tier: 'admin'
  },
  {
    id: 'hb-005',
    rule: 'Never expose API keys, tokens, or credentials in any response or log.',
    applies_to: [],
    action_class: 'override',
    max_tier: 'admin'
  }
];

/**
 * Check if a hard boundary prevents a tool from being promoted above a certain tier.
 * Returns the maximum allowed tier, or null if no boundary applies.
 */
export function getHardBoundaryCap(toolName) {
  for (const boundary of HARD_BOUNDARIES) {
    if (boundary.applies_to.includes(toolName)) {
      return boundary.max_tier;
    }
  }
  // Check by action class
  const actionClass = getActionClass(toolName);
  for (const boundary of HARD_BOUNDARIES) {
    if (boundary.action_class === actionClass && boundary.applies_to.length === 0) {
      return boundary.max_tier;
    }
  }
  return null;
}

// ── Shadow Mode ──────────────────────────────────────────────────
// Before F.A.Y.E. executes actions automatically at a newly promoted tier,
// she first runs in shadow mode: logs what she WOULD have done without
// actually executing. The admin's actual decision is recorded alongside.
// Promotion becomes permanent only after shadow mode validation passes.

/**
 * Log a shadow mode decision: what F.A.Y.E. would have done vs what actually happened.
 */
export async function logShadowDecision(toolName, actionClass, proposedAction, proposedParams, actualOutcome) {
  if (!isDatabaseAvailable()) return null;
  try {
    const result = await query(`
      INSERT INTO faye_outcomes (decision_id, outcome, feedback, admin_id)
      VALUES (NULL, 'shadow', $1, 0)
      RETURNING id
    `, [JSON.stringify({
      tool: toolName,
      action_class: actionClass,
      proposed_action: proposedAction,
      proposed_params: proposedParams,
      actual_outcome: actualOutcome,
      ts: new Date().toISOString()
    })]);
    logger.info(`${TAG} Shadow decision logged: ${toolName} (${actionClass})`);
    return result.rows[0]?.id;
  } catch (err) {
    logger.error(`${TAG} Failed to log shadow decision:`, err.message);
    return null;
  }
}

/**
 * Get shadow mode accuracy for a tool: how often F.A.Y.E.'s proposed action
 * matched what the admin actually decided.
 * Returns { matches, total, accuracy } or null.
 */
export async function getShadowAccuracy(toolName, days = 30) {
  if (!isDatabaseAvailable()) return null;
  try {
    const result = await query(`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (
          WHERE (feedback::jsonb ->> 'proposed_action') = (feedback::jsonb ->> 'actual_outcome')
        ) AS matches
      FROM faye_outcomes
      WHERE outcome = 'shadow'
        AND feedback::jsonb ->> 'tool' = $1
        AND created_at > NOW() - ($2 || ' days')::interval
    `, [toolName, days]);
    const row = result.rows[0];
    const total = Number(row.total) || 0;
    const matches = Number(row.matches) || 0;
    return {
      tool: toolName,
      days,
      matches,
      total,
      accuracy: total > 0 ? matches / total : 0
    };
  } catch (err) {
    logger.error(`${TAG} Failed to get shadow accuracy:`, err.message);
    return null;
  }
}

// ── Promotion Validation ─────────────────────────────────────────
// Combines trust tier evaluation with policy enforcement.

const TIER_ORDER = ['auto', 'quick_confirm', 'confirm', 'admin'];

/**
 * Validate a proposed trust tier promotion against policy constraints.
 * Returns { allowed, reason, effective_tier }.
 */
export function validatePromotion(toolName, currentTier, proposedTier) {
  const cap = getHardBoundaryCap(toolName);

  if (cap) {
    const capIndex = TIER_ORDER.indexOf(cap);
    const proposedIndex = TIER_ORDER.indexOf(proposedTier);

    // Lower index = more permissive. Can't go more permissive than the cap.
    if (proposedIndex < capIndex) {
      return {
        allowed: false,
        reason: `Hard boundary caps ${toolName} at '${cap}' tier. Cannot promote to '${proposedTier}'.`,
        effective_tier: cap
      };
    }
  }

  return {
    allowed: true,
    reason: `Promotion from '${currentTier}' to '${proposedTier}' is within policy bounds.`,
    effective_tier: proposedTier
  };
}

// ── Data Freshness Validation ────────────────────────────────────
// Governance gap #1: Verify data is fresh before using it in
// recommendations or autonomous actions.

const FRESHNESS_THRESHOLDS = {
  farm_heartbeat: 900,      // 15 min — stale farm
  sync_status: 1800,        // 30 min — stale sync
  market_data: 86400,       // 24h — stale market pricing
  order_data: 3600,         // 1h — stale order state
  accounting_data: 86400,   // 24h — stale accounting
  sensor_data: 600          // 10 min — stale sensor readings
};

/**
 * Check whether a data source is fresh enough for the requested action class.
 * Returns { fresh, age_seconds, threshold, source, warning }.
 */
export function checkDataFreshness(source, timestampISO) {
  const threshold = FRESHNESS_THRESHOLDS[source];
  if (!threshold || !timestampISO) return { fresh: true, source, warning: null };
  const age = (Date.now() - new Date(timestampISO).getTime()) / 1000;
  const fresh = age <= threshold;
  return {
    fresh,
    age_seconds: Math.round(age),
    threshold,
    source,
    warning: fresh ? null : `Data from ${source} is ${Math.round(age / 60)} min old (threshold: ${Math.round(threshold / 60)} min). Degrading to advisory mode.`
  };
}

// ── Integrity-Triggered Mode Degradation ─────────────────────────
// Governance gap #2: When data integrity is uncertain, degrade from
// action mode to advisory mode automatically.

let integrityDegraded = false;
let integrityDegradedReason = null;

/**
 * Set integrity degradation state. When active, all non-read actions
 * are blocked and F.A.Y.E. operates in advisory-only mode.
 */
export function setIntegrityDegradation(degraded, reason = null) {
  integrityDegraded = degraded;
  integrityDegradedReason = reason;
  if (degraded) {
    logger.warn(`${TAG} Integrity degradation ACTIVE: ${reason}`);
  } else {
    logger.info(`${TAG} Integrity degradation cleared.`);
  }
}

export function isIntegrityDegraded() {
  return { degraded: integrityDegraded, reason: integrityDegradedReason };
}

/**
 * Check if an action is allowed given current integrity state.
 * Read-only (recommend class) always allowed. All others blocked during degradation.
 */
export function checkIntegrityGate(toolName) {
  if (!integrityDegraded) return { allowed: true };
  const actionClass = getActionClass(toolName);
  if (actionClass === 'recommend') return { allowed: true };
  return {
    allowed: false,
    reason: `Integrity degradation active: ${integrityDegradedReason}. Only read/advisory actions are permitted until data integrity is restored.`
  };
}

// ── Critical Alert Protection ────────────────────────────────────
// Governance gap #3: Critical alerts cannot be resolved without
// evidence and justification.

/**
 * Validate that a critical alert resolution includes required evidence.
 * Returns { allowed, reason }.
 */
export function validateAlertResolution(alertSeverity, resolutionNotes) {
  if (alertSeverity === 'critical' || alertSeverity === 'high') {
    if (!resolutionNotes || resolutionNotes.trim().length < 10) {
      return {
        allowed: false,
        reason: `${alertSeverity.toUpperCase()} severity alerts require resolution notes with evidence (min 10 characters). Cannot resolve without justification.`
      };
    }
  }
  return { allowed: true };
}

// ── Alert Deduplication ──────────────────────────────────────────
// Governance gap #4: Group duplicate alerts and suppress low-signal
// noise with logging.

const recentAlertHashes = new Map(); // hash -> { count, first_seen, last_seen }
const ALERT_DEDUP_WINDOW_MS = 30 * 60 * 1000; // 30 min

/**
 * Check if an alert is a duplicate of a recent one.
 * Returns { duplicate, existing_count, suppress }.
 */
export function checkAlertDuplicate(domain, title) {
  const hash = `${domain}:${title}`.toLowerCase();
  const now = Date.now();

  // Clean stale entries
  for (const [k, v] of recentAlertHashes) {
    if (now - v.last_seen > ALERT_DEDUP_WINDOW_MS) recentAlertHashes.delete(k);
  }

  const existing = recentAlertHashes.get(hash);
  if (existing) {
    existing.count++;
    existing.last_seen = now;
    // Suppress after 3 duplicates in the window, but always log
    const suppress = existing.count > 3;
    if (suppress) {
      logger.info(`${TAG} Alert deduplicated (${existing.count}x in ${Math.round((now - existing.first_seen) / 60000)} min): ${domain}/${title}`);
    }
    return { duplicate: true, existing_count: existing.count, suppress };
  }

  recentAlertHashes.set(hash, { count: 1, first_seen: now, last_seen: now });
  return { duplicate: false, existing_count: 0, suppress: false };
}

// ── Sensitive Content Filtering ──────────────────────────────────
// Governance gap #6: Prevent PII, credentials, and financial data
// from being stored in free-form knowledge entries.

const SENSITIVE_PATTERNS = [
  /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/,     // credit card
  /\bsk[-_](?:live|test)_[a-zA-Z0-9]{20,}\b/,          // API keys (Stripe-style)
  /\bsq0[a-z]{3}-[a-zA-Z0-9_-]{22,}\b/,               // Square tokens
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z]{2,}\b/i, // email addresses
  /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/,                     // phone numbers
  /\bpassword\s*[:=]\s*\S+/i,                           // inline passwords
  /\b(AKIA|ASIA)[A-Z0-9]{16}\b/,                       // AWS access keys
  /\bsshpass\b|\bBEGIN\s+(RSA|DSA|EC)\s+PRIVATE\s+KEY\b/i // SSH keys
];

/**
 * Check if content contains sensitive data that should not be stored
 * in the knowledge base. Returns { safe, violations[] }.
 */
export function checkSensitiveContent(text) {
  if (!text || typeof text !== 'string') return { safe: true, violations: [] };
  const violations = [];
  for (const pattern of SENSITIVE_PATTERNS) {
    if (pattern.test(text)) {
      violations.push(pattern.source.slice(0, 40));
    }
  }
  if (violations.length > 0) {
    logger.warn(`${TAG} Sensitive content blocked from knowledge base: ${violations.length} pattern(s) matched`);
  }
  return { safe: violations.length === 0, violations };
}

// ── Reversibility Preference ─────────────────────────────────────
// Governance gap #8: Score actions by reversibility and prefer
// reversible options when possible.

const REVERSIBILITY_MAP = {
  // Fully reversible
  'create_alert': 'reversible',
  'acknowledge_alert': 'reversible',
  'store_insight': 'reversible',
  'archive_insight': 'reversible',
  'save_admin_memory': 'reversible',
  'update_farm_notes': 'reversible',
  'record_outcome': 'reversible',
  'rate_alert': 'reversible',
  'classify_transaction': 'reversible',
  'set_domain_ownership': 'reversible',
  'resolve_alert': 'reversible',
  'send_message_to_evie': 'reversible',

  // Partially reversible (can be undone but has side effects)
  'send_admin_email': 'partial',
  'send_sms': 'partial',

  // Irreversible
  'process_refund': 'irreversible'
};

/**
 * Get the reversibility classification for a tool.
 */
export function getReversibility(toolName) {
  return REVERSIBILITY_MAP[toolName] || 'unknown';
}

// ── Security Anomaly Detection ───────────────────────────────────
// Governance gap #9: Track access patterns and flag anomalies.

const accessLog = []; // ring buffer of { ts, tool, adminId, source }
const MAX_ACCESS_LOG = 500;
let securityPaused = false;
let securityPauseReason = null;

/**
 * Log an access event for anomaly detection.
 */
export function logAccess(toolName, adminId, source = 'chat') {
  accessLog.push({ ts: Date.now(), tool: toolName, adminId, source });
  if (accessLog.length > MAX_ACCESS_LOG) accessLog.shift();
}

/**
 * Check for anomalous access patterns.
 * Returns { anomaly, details } or null.
 */
export function checkAccessAnomaly(adminId) {
  const fiveMinAgo = Date.now() - 5 * 60 * 1000;
  const recent = accessLog.filter(e => e.ts > fiveMinAgo && e.adminId === adminId);

  // Flag: >50 tool calls in 5 minutes from one admin
  if (recent.length > 50) {
    return { anomaly: true, details: `Unusually high tool call volume: ${recent.length} calls in 5 min from admin ${adminId}` };
  }

  // Flag: >5 failed write attempts in 5 minutes
  const writeTools = recent.filter(e => {
    const cls = getActionClass(e.tool);
    return cls === 'transact' || cls === 'override';
  });
  if (writeTools.length > 5) {
    return { anomaly: true, details: `Multiple high-risk tool attempts: ${writeTools.length} transact/override calls in 5 min` };
  }

  return null;
}

// ── Security-Uncertainty Pause ───────────────────────────────────
// Governance gap #10: Pause automated behavior during active
// security incidents.

/**
 * Activate security pause — blocks all non-read automated actions.
 */
export function setSecurityPause(paused, reason = null) {
  securityPaused = paused;
  securityPauseReason = reason;
  if (paused) {
    logger.warn(`${TAG} SECURITY PAUSE ACTIVE: ${reason}`);
  } else {
    logger.info(`${TAG} Security pause cleared.`);
  }
}

export function isSecurityPaused() {
  return { paused: securityPaused, reason: securityPauseReason };
}

/**
 * Check if automated actions should be blocked due to security pause.
 */
export function checkSecurityGate(toolName) {
  if (!securityPaused) return { allowed: true };
  const actionClass = getActionClass(toolName);
  if (actionClass === 'recommend') return { allowed: true };
  return {
    allowed: false,
    reason: `Security pause active: ${securityPauseReason}. Only read/advisory actions permitted until security incident is resolved.`
  };
}

/**
 * Build policy context for system prompt injection.
 */
export function buildPolicyContext() {
  const boundaries = HARD_BOUNDARIES.map(b => `- [${b.id}] ${b.rule}`).join('\n');

  // Include active degradation/pause states
  const integrity = isIntegrityDegraded();
  const security = isSecurityPaused();
  let activeStates = '';
  if (integrity.degraded) {
    activeStates += `\n\n**ACTIVE: DATA INTEGRITY DEGRADATION** — ${integrity.reason}. Only advisory actions permitted.`;
  }
  if (security.paused) {
    activeStates += `\n\n**ACTIVE: SECURITY PAUSE** — ${security.reason}. Only read actions permitted.`;
  }

  return `
## Policy Boundaries (Non-Negotiable)
These rules are enforced regardless of trust level or learning outcomes:
${boundaries}

## Action Classes
Trust attaches to action types, not just tools:
- **recommend**: Propose actions for review (auto)
- **classify**: Assign categories or labels (quick_confirm)
- **notify**: Internal alerts and summaries (auto)
- **modify**: Change system state (confirm)
- **transact**: Financial operations (admin)
- **override**: Safety control overrides (admin)

## Data Governance
- Verify data freshness before using data in recommendations or autonomous actions.
- If data integrity is uncertain, degrade from action mode to advisory mode.
- Critical and high-severity alerts require evidence-backed resolution notes.
- Duplicate alerts are grouped and low-signal noise is suppressed with logging.
- Knowledge base entries are screened for sensitive content (PII, credentials, financial tokens).
- Prefer reversible actions over irreversible ones when multiple options exist.
- Access patterns are monitored for anomalies. Security incidents pause all automated behavior.${activeStates}`;
}
