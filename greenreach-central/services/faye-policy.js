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

  // transact
  'process_refund': 'transact'
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
    applies_to: [],
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

/**
 * Build policy context for system prompt injection.
 */
export function buildPolicyContext() {
  const boundaries = HARD_BOUNDARIES.map(b => `- [${b.id}] ${b.rule}`).join('\n');
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
- **override**: Safety control overrides (admin)`;
}
