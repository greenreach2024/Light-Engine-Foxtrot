/**
 * F.A.Y.E. Learning Engine — Phase 6 (Autonomy)
 * ================================================
 * Persistent learning system that allows F.A.Y.E. to:
 *
 * 1. Track outcomes of recommendations and actions
 * 2. Extract and store reusable insights from conversations
 * 3. Recognize recurring patterns across alerts, issues, and operations
 * 4. Build a knowledge base that improves responses over time
 * 5. Self-evaluate alert accuracy (false positive tracking)
 * 6. Evaluate trust tier promotions based on tool success rates
 * 7. Track domain ownership levels and advancement criteria
 *
 * Tables:
 *   faye_knowledge     — Reusable insights keyed by domain + topic
 *   faye_outcomes      — Action/recommendation outcome tracking
 *   faye_patterns      — Recurring pattern detection across alerts/operations
 *
 * See FAYE_VISION.md for the full autonomy progression framework.
 */

import { query, isDatabaseAvailable } from '../config/database.js';
import logger from '../utils/logger.js';
import { checkSensitiveContent } from './faye-policy.js';

const TAG = '[F.A.Y.E. Learning]';

// ── Knowledge Base Operations ────────────────────────────────────

/**
 * Store a learned insight. Upserts by domain + topic.
 * Screens for sensitive content before storage.
 * @param {string} domain - e.g. 'accounting', 'farm_network', 'orders', 'operations'
 * @param {string} topic - specific topic key within domain
 * @param {string} insight - the learned information
 * @param {string} source - where the insight came from (conversation, intelligence_loop, admin_feedback)
 * @param {number} confidence - 0.0 to 1.0
 */
export async function storeInsight(domain, topic, insight, source = 'conversation', confidence = 0.7) {
  if (!isDatabaseAvailable()) return null;

  // Governance: check for sensitive content
  const contentCheck = checkSensitiveContent(insight);
  if (!contentCheck.safe) {
    logger.warn(`${TAG} Blocked insight storage — sensitive content detected in: ${domain}/${topic}`);
    return { blocked: true, reason: 'Sensitive content detected (PII, credentials, or financial tokens). Cannot store in knowledge base.' };
  }

  try {
    const result = await query(`
      INSERT INTO faye_knowledge (domain, topic, insight, source, confidence, access_count)
      VALUES ($1, $2, $3, $4, $5, 0)
      ON CONFLICT (domain, topic)
      DO UPDATE SET
        insight = EXCLUDED.insight,
        source = EXCLUDED.source,
        confidence = EXCLUDED.confidence,
        updated_at = NOW(),
        access_count = faye_knowledge.access_count + 1
      RETURNING id
    `, [domain, topic, insight, source, confidence]);
    logger.info(`${TAG} Stored insight: ${domain}/${topic} (confidence: ${confidence})`);
    return result.rows[0]?.id;
  } catch (err) {
    logger.error(`${TAG} Failed to store insight:`, err.message);
    return null;
  }
}

/**
 * Retrieve insights for a given domain, ordered by confidence and recency.
 */
export async function getInsights(domain, limit = 10) {
  if (!isDatabaseAvailable()) return [];
  try {
    const result = await query(`
      SELECT domain, topic, insight, confidence, source, access_count, updated_at
      FROM faye_knowledge
      WHERE domain = $1 AND archived = FALSE
      ORDER BY confidence DESC, updated_at DESC
      LIMIT $2
    `, [domain, limit]);
    return result.rows;
  } catch (err) {
    logger.error(`${TAG} Failed to get insights:`, err.message);
    return [];
  }
}

/**
 * Retrieve all active insights across all domains for system prompt injection.
 * Returns the top N most relevant (high-confidence, recently accessed).
 */
export async function getTopInsights(limit = 15) {
  if (!isDatabaseAvailable()) return [];
  try {
    const result = await query(`
      SELECT id, domain, topic, insight, confidence
      FROM faye_knowledge
      WHERE archived = FALSE AND confidence >= 0.5
      ORDER BY confidence DESC, access_count DESC, updated_at DESC
      LIMIT $1
    `, [limit]);
    // Bump access_count only for the rows actually returned
    if (result.rows.length > 0) {
      const ids = result.rows.map(r => r.id).filter(Boolean);
      if (ids.length > 0) {
        await query(`
          UPDATE faye_knowledge SET access_count = access_count + 1
          WHERE id = ANY($1::int[])
        `, [ids]).catch(() => {}); // Non-critical
      }
    }
    // Strip internal id before returning
    return result.rows.map(({ id, ...rest }) => rest);
  } catch (err) {
    logger.error(`${TAG} Failed to get top insights:`, err.message);
    return [];
  }
}

/**
 * Search insights by keyword across all domains.
 */
export async function searchInsights(keyword, limit = 10) {
  if (!isDatabaseAvailable()) return [];
  try {
    const searchTerm = `%${keyword.replace(/%/g, '\\%').replace(/_/g, '\\_')}%`;
    const result = await query(`
      SELECT domain, topic, insight, confidence, source, updated_at
      FROM faye_knowledge
      WHERE archived = FALSE
        AND (topic ILIKE $1 OR insight ILIKE $1 OR domain ILIKE $1)
      ORDER BY confidence DESC, updated_at DESC
      LIMIT $2
    `, [searchTerm, limit]);
    return result.rows;
  } catch (err) {
    logger.error(`${TAG} Failed to search insights:`, err.message);
    return [];
  }
}

/**
 * Archive (soft-delete) an insight that is no longer valid.
 */
export async function archiveInsight(domain, topic) {
  if (!isDatabaseAvailable()) return false;
  try {
    await query(`
      UPDATE faye_knowledge SET archived = TRUE, updated_at = NOW()
      WHERE domain = $1 AND topic = $2
    `, [domain, topic]);
    logger.info(`${TAG} Archived insight: ${domain}/${topic}`);
    return true;
  } catch (err) {
    logger.error(`${TAG} Failed to archive insight:`, err.message);
    return false;
  }
}

// ── Outcome Tracking ─────────────────────────────────────────────

/**
 * Record an outcome for a previous action/recommendation.
 * Links to the faye_decision_log entry if available.
 */
export async function recordOutcome(decisionId, outcome, feedback, adminId) {
  if (!isDatabaseAvailable()) return null;
  try {
    const result = await query(`
      INSERT INTO faye_outcomes (decision_id, outcome, feedback, admin_id)
      VALUES ($1, $2, $3, $4)
      RETURNING id
    `, [decisionId || null, outcome, feedback, adminId]);
    logger.info(`${TAG} Outcome recorded: ${outcome} (decision: ${decisionId || 'none'})`);
    return result.rows[0]?.id;
  } catch (err) {
    logger.error(`${TAG} Failed to record outcome:`, err.message);
    return null;
  }
}

/**
 * Get outcome statistics for a specific tool or domain.
 */
export async function getOutcomeStats(toolName, days = 30) {
  if (!isDatabaseAvailable()) return null;
  try {
    const result = await query(`
      SELECT
        o.outcome,
        COUNT(*) AS cnt,
        AVG(CASE WHEN o.outcome = 'positive' THEN 1 WHEN o.outcome = 'negative' THEN 0 ELSE 0.5 END) AS success_rate
      FROM faye_outcomes o
      LEFT JOIN faye_decision_log d ON d.id = o.decision_id
      WHERE ($1::varchar IS NULL OR d.tool_name = $1)
        AND o.created_at > NOW() - ($2 || ' days')::interval
      GROUP BY o.outcome
    `, [toolName || null, days]);
    return { tool: toolName || 'all', days, outcomes: result.rows };
  } catch (err) {
    logger.error(`${TAG} Failed to get outcome stats:`, err.message);
    return null;
  }
}

// ── Pattern Recognition ──────────────────────────────────────────

/**
 * Record or increment a recurring pattern.
 * Patterns track things like: "farm X goes offline every Tuesday at 3 AM"
 * or "order volume drops every time we get a critical payment alert"
 */
export async function trackPattern(patternKey, domain, description, metadata = {}) {
  if (!isDatabaseAvailable()) return null;
  try {
    // Append to metadata history instead of overwriting.
    // Stores an array of timestamped occurrences for root-cause analysis.
    const occurrence = { ts: new Date().toISOString(), ...metadata };
    const result = await query(`
      INSERT INTO faye_patterns (pattern_key, domain, description, metadata, occurrence_count, last_seen_at)
      VALUES ($1, $2, $3, $4, 1, NOW())
      ON CONFLICT (pattern_key)
      DO UPDATE SET
        occurrence_count = faye_patterns.occurrence_count + 1,
        last_seen_at = NOW(),
        metadata = (
          CASE
            WHEN jsonb_typeof(faye_patterns.metadata::jsonb) = 'object'
              AND faye_patterns.metadata::jsonb ? 'history'
            THEN jsonb_set(
              faye_patterns.metadata::jsonb,
              '{history}',
              (faye_patterns.metadata::jsonb -> 'history') || $5::jsonb
            )
            ELSE jsonb_build_object(
              'history', jsonb_build_array(faye_patterns.metadata::jsonb, $5::jsonb)
            )
          END
        )::text,
        description = CASE
          WHEN faye_patterns.occurrence_count >= 3 THEN faye_patterns.description
          ELSE EXCLUDED.description
        END
      RETURNING id, occurrence_count
    `, [patternKey, domain, description, JSON.stringify({ history: [occurrence] }), JSON.stringify(occurrence)]);
    const row = result.rows[0];
    if (row && row.occurrence_count >= 3) {
      logger.info(`${TAG} Recurring pattern detected (${row.occurrence_count}x): ${patternKey}`);
    }
    return row;
  } catch (err) {
    logger.error(`${TAG} Failed to track pattern:`, err.message);
    return null;
  }
}

/**
 * Get active patterns for a domain, ordered by frequency.
 */
export async function getPatterns(domain, limit = 10) {
  if (!isDatabaseAvailable()) return [];
  try {
    const result = await query(`
      SELECT pattern_key, domain, description, occurrence_count, last_seen_at, metadata
      FROM faye_patterns
      WHERE ($1::varchar IS NULL OR domain = $1)
        AND suppressed = FALSE
        AND last_seen_at > NOW() - INTERVAL '90 days'
      ORDER BY occurrence_count DESC, last_seen_at DESC
      LIMIT $2
    `, [domain || null, limit]);
    return result.rows;
  } catch (err) {
    logger.error(`${TAG} Failed to get patterns:`, err.message);
    return [];
  }
}

/**
 * Get frequent patterns for system prompt injection.
 * Only returns patterns seen 3+ times in the last 90 days.
 */
export async function getFrequentPatterns(limit = 10) {
  if (!isDatabaseAvailable()) return [];
  try {
    const result = await query(`
      SELECT pattern_key, domain, description, occurrence_count, last_seen_at
      FROM faye_patterns
      WHERE suppressed = FALSE
        AND occurrence_count >= 3
        AND last_seen_at > NOW() - INTERVAL '90 days'
      ORDER BY occurrence_count DESC
      LIMIT $1
    `, [limit]);
    return result.rows;
  } catch (err) {
    logger.error(`${TAG} Failed to get frequent patterns:`, err.message);
    return [];
  }
}

// ── Alert Learning ───────────────────────────────────────────────

/**
 * Track alert accuracy. Called when an alert is resolved or dismissed.
 * Feeds into false-positive learning for the intelligence loop.
 */
export async function trackAlertAccuracy(alertId, wasAccurate, notes) {
  if (!isDatabaseAvailable()) return false;
  try {
    // Record as an outcome linked to the alert
    await query(`
      INSERT INTO faye_outcomes (decision_id, outcome, feedback, admin_id)
      VALUES (NULL, $1, $2, 0)
    `, [wasAccurate ? 'positive' : 'false_positive', `alert:${alertId} — ${notes || 'no notes'}`]);

    // If false positive, track the pattern
    if (!wasAccurate) {
      // Get the alert details to build a pattern key
      const alertResult = await query(
        'SELECT domain, title FROM admin_alerts WHERE id = $1',
        [alertId]
      );
      if (alertResult.rows.length > 0) {
        const alert = alertResult.rows[0];
        await trackPattern(
          `false_positive:${alert.domain}`,
          alert.domain,
          `False positive alert: "${alert.title}" — consider adjusting thresholds`,
          { alert_id: alertId, notes }
        );
      }
    }
    return true;
  } catch (err) {
    logger.error(`${TAG} Failed to track alert accuracy:`, err.message);
    return false;
  }
}

/**
 * Get false positive rate for a specific alert domain.
 */
export async function getFalsePositiveRate(domain, days = 30) {
  if (!isDatabaseAvailable()) return null;
  try {
    // Filter by domain via the feedback field which stores "alert:{id} -- {notes}"
    // and cross-reference with admin_alerts to match the specific domain
    const result = await query(`
      SELECT
        COUNT(*) FILTER (WHERE o.outcome = 'false_positive') AS false_positives,
        COUNT(*) FILTER (WHERE o.outcome = 'positive') AS true_positives,
        COUNT(*) AS total
      FROM faye_outcomes o
      LEFT JOIN admin_alerts a ON a.id = (
        CASE WHEN o.feedback LIKE 'alert:%'
          THEN CAST(NULLIF(split_part(split_part(o.feedback, ':', 2), ' ', 1), '') AS INTEGER)
          ELSE NULL
        END
      )
      WHERE o.feedback LIKE 'alert:%'
        AND o.created_at > NOW() - ($1 || ' days')::interval
        AND ($2::varchar IS NULL OR a.domain = $2)
    `, [days, domain || null]);
    const row = result.rows[0];
    const total = Number(row.total);
    return {
      domain: domain || 'all',
      days,
      false_positives: Number(row.false_positives),
      true_positives: Number(row.true_positives),
      total,
      false_positive_rate: total > 0 ? Number(row.false_positives) / total : 0
    };
  } catch (err) {
    logger.error(`${TAG} Failed to get false positive rate:`, err.message);
    return null;
  }
}

// ── Trust Tier Promotion ─────────────────────────────────────────

/**
 * Evaluate whether a tool qualifies for trust tier promotion.
 * Returns promotion recommendation or null if no change.
 *
 * Thresholds (from FAYE_VISION.md):
 *   CONFIRM -> AUTO: success rate > 95% over 50+ uses
 *   ADMIN -> CONFIRM: success rate > 98% over 100+ uses
 *   Demotion: 3 consecutive negative outcomes
 */
export async function evaluateTrustPromotion(toolName, currentTier, days = 60) {
  if (!isDatabaseAvailable()) return null;
  try {
    // Get outcome stats for this tool
    const result = await query(`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE o.outcome = 'positive') AS positives,
        COUNT(*) FILTER (WHERE o.outcome = 'negative') AS negatives
      FROM faye_outcomes o
      LEFT JOIN faye_decision_log d ON d.id = o.decision_id
      WHERE d.tool_name = $1
        AND o.created_at > NOW() - ($2 || ' days')::interval
    `, [toolName, days]);

    const { total, positives, negatives } = result.rows[0] || {};
    const totalNum = Number(total) || 0;
    const posNum = Number(positives) || 0;
    const negNum = Number(negatives) || 0;

    if (totalNum === 0) return null;

    const successRate = posNum / totalNum;

    // Check for demotion: 3 consecutive failures
    const recentResult = await query(`
      SELECT o.outcome FROM faye_outcomes o
      LEFT JOIN faye_decision_log d ON d.id = o.decision_id
      WHERE d.tool_name = $1
      ORDER BY o.created_at DESC
      LIMIT 3
    `, [toolName]);

    const recentOutcomes = recentResult.rows.map(r => r.outcome);
    const consecutiveFailures = recentOutcomes.length === 3 &&
      recentOutcomes.every(o => o === 'negative');

    if (consecutiveFailures) {
      logger.info(`${TAG} Trust demotion candidate: ${toolName} (3 consecutive failures)`);
      return {
        tool: toolName,
        action: 'demote',
        currentTier,
        reason: `3 consecutive negative outcomes`,
        successRate,
        totalUses: totalNum
      };
    }

    // Check for promotion
    if (currentTier === 'CONFIRM' && successRate > 0.95 && totalNum >= 50) {
      logger.info(`${TAG} Trust promotion candidate: ${toolName} CONFIRM->AUTO (${(successRate * 100).toFixed(1)}% over ${totalNum} uses)`);
      return {
        tool: toolName,
        action: 'promote',
        currentTier: 'CONFIRM',
        newTier: 'AUTO',
        reason: `${(successRate * 100).toFixed(1)}% success rate over ${totalNum} uses`,
        successRate,
        totalUses: totalNum
      };
    }

    if (currentTier === 'ADMIN' && successRate > 0.98 && totalNum >= 100) {
      logger.info(`${TAG} Trust promotion candidate: ${toolName} ADMIN->CONFIRM (${(successRate * 100).toFixed(1)}% over ${totalNum} uses)`);
      return {
        tool: toolName,
        action: 'promote',
        currentTier: 'ADMIN',
        newTier: 'CONFIRM',
        reason: `${(successRate * 100).toFixed(1)}% success rate over ${totalNum} uses`,
        successRate,
        totalUses: totalNum
      };
    }

    return null;
  } catch (err) {
    logger.error(`${TAG} Failed to evaluate trust promotion:`, err.message);
    return null;
  }
}

// ── Domain Ownership Tracking ────────────────────────────────────

// L5 (Strategic) is defined in the vision but capped here until strategy features ship.
// The engine currently supports L0-L4. L5 will be added in v3.3.
const DOMAIN_LEVELS = ['L0', 'L1', 'L2', 'L3', 'L4'];
const DOMAINS = [
  'alert_triage', 'accounting', 'farm_health',
  'orders', 'payments', 'network', 'evie_oversight', 'market_intel'
];

/**
 * Get current autonomy level for an operational domain.
 * Stored in faye_knowledge with domain='autonomy'.
 */
export async function getDomainOwnership(domainName) {
  if (!isDatabaseAvailable()) return { domain: domainName, level: 'L0', detail: 'No data' };
  try {
    const result = await query(`
      SELECT insight, confidence, updated_at
      FROM faye_knowledge
      WHERE domain = 'autonomy' AND topic = $1 AND archived = FALSE
    `, [`domain_ownership:${domainName}`]);

    if (result.rows.length === 0) {
      return { domain: domainName, level: 'L0', detail: 'Not yet tracked' };
    }

    const row = result.rows[0];
    // Insight format: "L2: Advisory — proposes actions with confidence levels"
    const levelMatch = row.insight.match(/^(L\d)/);
    return {
      domain: domainName,
      level: levelMatch ? levelMatch[1] : 'L0',
      detail: row.insight,
      confidence: row.confidence,
      updatedAt: row.updated_at
    };
  } catch (err) {
    logger.error(`${TAG} Failed to get domain ownership:`, err.message);
    return { domain: domainName, level: 'L0', detail: 'Error' };
  }
}

/**
 * Get ownership levels for all operational domains.
 */
export async function getAllDomainOwnership() {
  const results = [];
  for (const d of DOMAINS) {
    results.push(await getDomainOwnership(d));
  }
  return results;
}

/**
 * Update the autonomy level for a domain.
 * @param {string} domainName - one of DOMAINS
 * @param {string} level - L0 through L4
 * @param {string} detail - description of current capability at this level
 */
/**
 * Update the autonomy level for a domain.
 * Level and confidence are independent: a domain can be at L2 with weak evidence
 * or at L2 with strong evidence. Level tracks maturity, confidence tracks certainty.
 * @param {string} domainName - one of DOMAINS
 * @param {string} level - L0 through L4
 * @param {string} detail - description of current capability at this level
 * @param {number} confidence - 0.0 to 1.0, how certain we are about this assessment (default: 0.5)
 */
export async function setDomainOwnership(domainName, level, detail, confidence = 0.5) {
  if (!DOMAINS.includes(domainName)) {
    logger.warn(`${TAG} Unknown domain: ${domainName}`);
    return null;
  }
  if (!DOMAIN_LEVELS.includes(level)) {
    logger.warn(`${TAG} Invalid level: ${level}`);
    return null;
  }
  if (confidence < 0 || confidence > 1) {
    logger.warn(`${TAG} Confidence out of range: ${confidence}`);
    return null;
  }

  const insight = `${level}: ${detail}`;
  return storeInsight('autonomy', `domain_ownership:${domainName}`, insight, 'self_assessment', confidence);
}

/**
 * Build autonomy context for system prompt injection.
 * Shows current domain ownership levels and any pending trust promotions.
 */
export async function buildAutonomyContext() {
  try {
    const ownership = await getAllDomainOwnership();
    const parts = [];

    const tracked = ownership.filter(o => o.level !== 'L0' || o.detail !== 'Not yet tracked');
    if (tracked.length > 0) {
      parts.push('');
      parts.push('## Domain Ownership Status');
      parts.push('Your current autonomy level per operational domain:');
      for (const o of ownership) {
        parts.push(`- **${o.domain}**: ${o.level} — ${o.detail}`);
      }
    }

    return parts.length > 0 ? parts.join('\n') : '';
  } catch (err) {
    logger.error(`${TAG} Failed to build autonomy context:`, err.message);
    return '';
  }
}

// ── Conversation Learning ────────────────────────────────────────

/**
 * Extract and store an insight from a conversation context.
 * Called by the LLM via tool use when it identifies something worth remembering.
 */
export async function learnFromConversation(domain, topic, insight, adminId) {
  const source = `conversation:admin_${adminId}`;
  return storeInsight(domain, topic, insight, source, 0.6);
}

/**
 * Build a learning context block for the system prompt.
 * Combines top insights + frequent patterns into a prompt-friendly format.
 */
export async function buildLearningContext() {
  try {
    const [insights, patterns] = await Promise.all([
      getTopInsights(12),
      getFrequentPatterns(8)
    ]);

    const parts = [];

    if (insights.length > 0) {
      parts.push('## Learned Knowledge');
      parts.push('These are insights you have learned from past operations and admin feedback:');
      for (const ins of insights) {
        parts.push(`- [${ins.domain}] ${ins.topic}: ${ins.insight} (confidence: ${(ins.confidence * 100).toFixed(0)}%)`);
      }
    }

    if (patterns.length > 0) {
      parts.push('');
      parts.push('## Recognized Patterns');
      parts.push('These recurring patterns have been observed across operations:');
      for (const p of patterns) {
        parts.push(`- [${p.domain}] ${p.description} (seen ${p.occurrence_count}x, last: ${new Date(p.last_seen_at).toLocaleDateString('en-CA')})`);
      }
    }

    return parts.length > 0 ? '\n' + parts.join('\n') : '';
  } catch (err) {
    logger.error(`${TAG} Failed to build learning context:`, err.message);
    return '';
  }
}

// ── Inter-Agent Communication ────────────────────────────────────
// F.A.Y.E. <-> E.V.I.E. messaging system.
// Messages are persisted in the agent_messages table for audit trail
// and recalled by both agents when needed.

/**
 * Message types for inter-agent communication:
 * - escalation: E.V.I.E. escalates a grower issue to F.A.Y.E.
 * - directive: F.A.Y.E. sends an instruction/directive to E.V.I.E.
 * - observation: Either agent shares an observation with the other.
 * - response: Reply to a prior message.
 * - status_update: Informational update about an ongoing item.
 */
const VALID_MESSAGE_TYPES = ['escalation', 'directive', 'observation', 'response', 'status_update'];
const VALID_PRIORITIES = ['low', 'normal', 'high', 'critical'];

let agentMessagesTableEnsured = false;
async function ensureAgentMessagesTable() {
  if (agentMessagesTableEnsured || !isDatabaseAvailable()) return;
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS agent_messages (
        id SERIAL PRIMARY KEY,
        sender VARCHAR(20) NOT NULL,
        recipient VARCHAR(20) NOT NULL,
        message_type VARCHAR(30) NOT NULL,
        subject VARCHAR(200) NOT NULL,
        body TEXT NOT NULL,
        context JSONB DEFAULT '{}',
        priority VARCHAR(10) DEFAULT 'normal',
        reply_to_id INTEGER REFERENCES agent_messages(id),
        status VARCHAR(10) DEFAULT 'unread',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);
    agentMessagesTableEnsured = true;
  } catch (err) {
    logger.warn(`${TAG} Failed to ensure agent_messages table:`, err.message);
  }
}

/**
 * Send an inter-agent message.
 * @param {string} sender - 'faye' or 'evie'
 * @param {string} recipient - 'faye' or 'evie'
 * @param {string} messageType - one of VALID_MESSAGE_TYPES
 * @param {string} subject - brief subject line
 * @param {string} body - full message content
 * @param {object} context - additional context (farm_id, order_id, alert_id, etc.)
 * @param {string} priority - low, normal, high, critical
 * @param {number} replyToId - if replying to a previous message
 */
export async function sendAgentMessage(sender, recipient, messageType, subject, body, context = {}, priority = 'normal', replyToId = null) {
  if (!isDatabaseAvailable()) {
    logger.warn(`${TAG} Cannot send agent message: DB unavailable`);
    return null;
  }
  await ensureAgentMessagesTable();
  if (!VALID_MESSAGE_TYPES.includes(messageType)) {
    logger.warn(`${TAG} Invalid message type: ${messageType}`);
    return null;
  }
  if (!VALID_PRIORITIES.includes(priority)) {
    priority = 'normal';
  }
  if (!['faye', 'evie'].includes(sender) || !['faye', 'evie'].includes(recipient)) {
    logger.warn(`${TAG} Invalid sender/recipient: ${sender} -> ${recipient}`);
    return null;
  }

  try {
    const result = await query(`
      INSERT INTO agent_messages (sender, recipient, message_type, subject, body, context, priority, reply_to_id, status, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'unread', NOW())
      RETURNING id, created_at
    `, [sender, recipient, messageType, subject, body, JSON.stringify(context), priority, replyToId]);

    const row = result.rows[0];
    logger.info(`${TAG} Agent message sent: ${sender} -> ${recipient} [${messageType}] "${subject}" (id: ${row.id})`);
    return { id: row.id, created_at: row.created_at };
  } catch (err) {
    logger.error(`${TAG} Failed to send agent message:`, err.message);
    return null;
  }
}

/**
 * Get unread messages for an agent.
 */
export async function getUnreadMessages(recipient, limit = 20) {
  if (!isDatabaseAvailable()) return [];
  await ensureAgentMessagesTable();
  try {
    const result = await query(`
      SELECT id, sender, message_type, subject, body, context, priority, reply_to_id, created_at
      FROM agent_messages
      WHERE recipient = $1 AND status = 'unread'
      ORDER BY
        CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
        created_at DESC
      LIMIT $2
    `, [recipient, limit]);
    return result.rows;
  } catch (err) {
    logger.error(`${TAG} Failed to get unread messages:`, err.message);
    return [];
  }
}

/**
 * Get message history between agents (both directions).
 */
export async function getAgentMessageHistory(limit = 50, messageType = null) {
  if (!isDatabaseAvailable()) return [];
  try {
    let sql = `
      SELECT id, sender, recipient, message_type, subject, body, context, priority, status, reply_to_id, created_at
      FROM agent_messages
    `;
    const values = [];
    if (messageType) {
      sql += ' WHERE message_type = $1';
      values.push(messageType);
    }
    sql += ` ORDER BY created_at DESC LIMIT $${values.length + 1}`;
    values.push(limit);

    const result = await query(sql, values);
    return result.rows;
  } catch (err) {
    logger.error(`${TAG} Failed to get agent message history:`, err.message);
    return [];
  }
}

/**
 * Mark messages as read.
 */
export async function markMessagesRead(recipient, messageIds) {
  if (!isDatabaseAvailable() || !messageIds?.length) return false;
  try {
    await query(`
      UPDATE agent_messages SET status = 'read'
      WHERE recipient = $1 AND id = ANY($2::int[])
    `, [recipient, messageIds]);
    return true;
  } catch (err) {
    logger.error(`${TAG} Failed to mark messages read:`, err.message);
    return false;
  }
}

/**
 * Get messages for a specific context (e.g. all messages about a particular farm or order).
 */
export async function getMessagesByContext(contextKey, contextValue, limit = 20) {
  if (!isDatabaseAvailable()) return [];
  try {
    const result = await query(`
      SELECT id, sender, recipient, message_type, subject, body, context, priority, status, created_at
      FROM agent_messages
      WHERE context::jsonb ->> $1 = $2
      ORDER BY created_at DESC
      LIMIT $3
    `, [contextKey, String(contextValue), limit]);
    return result.rows;
  } catch (err) {
    logger.error(`${TAG} Failed to get messages by context:`, err.message);
    return [];
  }
}

/**
 * Build inter-agent context for system prompt injection.
 * Shows recent unread messages and active threads.
 */
export async function buildInterAgentContext(agentName) {
  try {
    const unread = await getUnreadMessages(agentName, 10);
    if (unread.length === 0) return '';

    const parts = ['\n## Inter-Agent Messages'];
    parts.push(`You have ${unread.length} unread message(s) from ${agentName === 'faye' ? 'E.V.I.E.' : 'F.A.Y.E.'}:`);
    for (const msg of unread) {
      const priority = msg.priority === 'critical' || msg.priority === 'high' ? ` [${msg.priority.toUpperCase()}]` : '';
      parts.push(`- [${msg.message_type}]${priority} "${msg.subject}" — ${msg.body.slice(0, 200)}${msg.body.length > 200 ? '...' : ''} (${new Date(msg.created_at).toLocaleString('en-CA')})`);
    }
    parts.push('');
    parts.push('Use get_evie_messages (or get_faye_directives) to see full details. Reply with send_message_to_evie (or escalate_to_faye).');
    return parts.join('\n');
  } catch (err) {
    logger.error(`${TAG} Failed to build inter-agent context:`, err.message);
    return '';
  }
}

// ── Conversation History Recall ──────────────────────────────────
// Persistent conversation recall — lets F.A.Y.E. access past
// conversations beyond the current session.

/**
 * Get recent conversation summaries for F.A.Y.E. to recall context
 * from past sessions.
 */
export async function getConversationRecap(adminId, days = 30, limit = 20) {
  if (!isDatabaseAvailable()) return [];
  try {
    const result = await query(`
      SELECT summary, message_count, created_at
      FROM admin_assistant_summaries
      WHERE admin_id = $1
        AND created_at > NOW() - ($2 || ' days')::interval
      ORDER BY created_at DESC
      LIMIT $3
    `, [adminId, days, limit]);
    return result.rows;
  } catch (err) {
    logger.error(`${TAG} Failed to get conversation recap:`, err.message);
    return [];
  }
}

/**
 * Search past conversations by keyword.
 * Searches across both conversation messages and summaries.
 */
export async function searchConversationHistory(adminId, keyword, limit = 10) {
  if (!isDatabaseAvailable() || !keyword) return [];
  try {
    const searchTerm = `%${keyword.replace(/%/g, '\\%').replace(/_/g, '\\_')}%`;
    // Search summaries first (faster, already distilled)
    const summaryResult = await query(`
      SELECT 'summary' AS source, summary AS content, message_count, created_at
      FROM admin_assistant_summaries
      WHERE admin_id = $1 AND summary ILIKE $2
      ORDER BY created_at DESC
      LIMIT $3
    `, [adminId, searchTerm, limit]);

    // Also search raw conversation messages
    const convResult = await query(`
      SELECT 'conversation' AS source, messages::text AS content, message_count, updated_at AS created_at
      FROM admin_assistant_conversations
      WHERE admin_id = $1 AND messages::text ILIKE $2
      ORDER BY updated_at DESC
      LIMIT $3
    `, [adminId, searchTerm, limit]);

    return [...summaryResult.rows, ...convResult.rows]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, limit);
  } catch (err) {
    logger.error(`${TAG} Failed to search conversation history:`, err.message);
    return [];
  }
}
