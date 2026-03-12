/**
 * Marketing Rules Engine — GreenReach Central
 * Auto-approve evaluation chain with 6-rule logic.
 * Adapted from Real-Estate-Ready-MVP social/rules-engine.ts.
 */

import { query } from '../config/database.js';
import { checkCompliance } from './marketing-ai-agent.js';

// Platform character limits
const CHAR_LIMITS = {
  twitter:   280,
  linkedin:  3000,
  instagram: 2200,
  facebook:  63206,
};

/**
 * Load all enabled rules from the database.
 * @returns {Promise<Array>}
 */
export async function loadRules() {
  try {
    const result = await query(
      'SELECT * FROM marketing_rules WHERE enabled = true ORDER BY rule_name'
    );
    return result.rows;
  } catch {
    return [];
  }
}

/**
 * Load all rules (enabled and disabled) for display.
 */
export async function loadAllRules() {
  const result = await query('SELECT * FROM marketing_rules ORDER BY rule_type, rule_name');
  return result.rows;
}

/**
 * Toggle a rule on/off.
 */
export async function toggleRule(ruleId, enabled) {
  const result = await query(
    'UPDATE marketing_rules SET enabled = $1, updated_at = NOW() WHERE rule_name = $2 RETURNING *',
    [enabled, ruleId]
  );
  return result.rows[0] || null;
}

/**
 * Update rule conditions.
 */
export async function updateRule(ruleId, updates) {
  const fields = [];
  const values = [];
  let idx = 1;

  if (updates.conditions !== undefined) {
    fields.push(`conditions = $${idx++}`);
    values.push(JSON.stringify(updates.conditions));
  }
  if (updates.enabled !== undefined) {
    fields.push(`enabled = $${idx++}`);
    values.push(updates.enabled);
  }

  if (fields.length === 0) return null;

  fields.push('updated_at = NOW()');
  values.push(ruleId);

  const result = await query(
    `UPDATE marketing_rules SET ${fields.join(', ')} WHERE rule_name = $${idx} RETURNING *`,
    values
  );
  return result.rows[0] || null;
}

/**
 * Evaluate whether a post can be auto-approved.
 * Returns { approved: boolean, reasons: string[], evaluations: object[] }.
 *
 * 6-Rule Chain:
 *  1. require_approval_all — Stage 1 blocker
 *  2. Content filter — blocked phrases
 *  3. Rate limit — max posts/day per platform
 *  4. Source type eligibility — only certain types auto-approve
 *  5. Character limit — platform-specific
 *  6. Rejection rate — 30-day rejection rate > 5% blocks auto-approve
 */
export async function evaluateAutoApprove(post) {
  const rules = await loadRules();
  const evaluations = [];
  let blocked = false;

  // ── Rule 1: require_approval_all ──────────────────────
  const requireAll = rules.find(r => r.rule_name === 'require_approval_all');
  if (requireAll) {
    evaluations.push({
      rule: 'require_approval_all',
      result: 'blocked',
      reason: 'Stage 1 mode: all posts require human approval',
    });
    blocked = true;
  }

  // ── Rule 2: Content filter (blocked phrases) ─────────
  const violations = checkCompliance(post.content);
  if (violations.length > 0) {
    evaluations.push({
      rule: 'content_filter',
      result: 'blocked',
      reason: `Blocked phrases found: ${violations.join(', ')}`,
    });
    blocked = true;
  } else {
    evaluations.push({
      rule: 'content_filter',
      result: 'passed',
      reason: 'No blocked phrases detected',
    });
  }

  // Also check dynamic filter rules from DB
  const filterRules = rules.filter(r => r.rule_type === 'content_filter');
  for (const rule of filterRules) {
    const phrases = rule.conditions?.blocked_phrases || [];
    const lower = post.content.toLowerCase();
    const found = phrases.filter(p => lower.includes(p.toLowerCase()));
    if (found.length > 0) {
      evaluations.push({
        rule: rule.rule_name,
        result: 'blocked',
        reason: `Rule '${rule.rule_name}' triggered: ${found.join(', ')}`,
      });
      blocked = true;
    }
  }

  // ── Rule 3: Rate limit ────────────────────────────────
  const rateLimitRule = rules.find(r => r.rule_name === 'rate_limit_daily');
  if (rateLimitRule) {
    const maxPerDay = rateLimitRule.conditions?.max_per_day || 10;
    try {
      const todayCount = await query(
        `SELECT COUNT(*) as cnt FROM marketing_posts
         WHERE platform = $1
           AND status IN ('published', 'approved', 'scheduled')
           AND created_at >= CURRENT_DATE`,
        [post.platform]
      );
      const count = parseInt(todayCount.rows[0]?.cnt || 0);
      if (count >= maxPerDay) {
        evaluations.push({
          rule: 'rate_limit_daily',
          result: 'blocked',
          reason: `Daily limit reached: ${count}/${maxPerDay} for ${post.platform}`,
        });
        blocked = true;
      } else {
        evaluations.push({
          rule: 'rate_limit_daily',
          result: 'passed',
          reason: `${count}/${maxPerDay} posts today for ${post.platform}`,
        });
      }
    } catch {
      evaluations.push({
        rule: 'rate_limit_daily',
        result: 'skipped',
        reason: 'Could not check rate limit (DB error)',
      });
    }
  }

  // ── Rule 4: Source type eligibility ───────────────────
  const autoApproveRule = rules.find(r => r.rule_name === 'auto_approve_low_risk');
  if (autoApproveRule) {
    const allowed = autoApproveRule.conditions?.allowed_source_types || ['market', 'milestone'];
    if (!allowed.includes(post.source_type)) {
      evaluations.push({
        rule: 'source_type_eligibility',
        result: 'blocked',
        reason: `Source type '${post.source_type}' not in auto-approve list: ${allowed.join(', ')}`,
      });
      blocked = true;
    } else {
      evaluations.push({
        rule: 'source_type_eligibility',
        result: 'passed',
        reason: `Source type '${post.source_type}' is eligible for auto-approve`,
      });
    }

    // Check minimum published threshold
    const minPublished = autoApproveRule.conditions?.min_published || 50;
    try {
      const publishedCount = await query(
        `SELECT COUNT(*) as cnt FROM marketing_posts WHERE status = 'published'`
      );
      const total = parseInt(publishedCount.rows[0]?.cnt || 0);
      if (total < minPublished) {
        evaluations.push({
          rule: 'trust_threshold',
          result: 'blocked',
          reason: `Only ${total}/${minPublished} posts published — trust threshold not met`,
        });
        blocked = true;
      }
    } catch {
      // skip
    }
  }

  // ── Rule 5: Character limit ───────────────────────────
  const limit = CHAR_LIMITS[post.platform] || 63206;
  if (post.content.length > limit) {
    evaluations.push({
      rule: 'character_limit',
      result: 'blocked',
      reason: `Content (${post.content.length} chars) exceeds ${post.platform} limit (${limit})`,
    });
    blocked = true;
  } else {
    evaluations.push({
      rule: 'character_limit',
      result: 'passed',
      reason: `${post.content.length}/${limit} characters`,
    });
  }

  // ── Rule 6: 30-day rejection rate ────────────────────
  try {
    const stats = await query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'rejected') as rejected,
         COUNT(*) as total
       FROM marketing_posts
       WHERE created_at >= NOW() - INTERVAL '30 days'
         AND status IN ('published', 'approved', 'rejected')`
    );
    const rejected = parseInt(stats.rows[0]?.rejected || 0);
    const total = parseInt(stats.rows[0]?.total || 0);
    const rate = total > 0 ? rejected / total : 0;
    const maxRate = 0.05;

    if (rate > maxRate) {
      evaluations.push({
        rule: 'rejection_rate',
        result: 'blocked',
        reason: `30-day rejection rate ${(rate * 100).toFixed(1)}% exceeds ${maxRate * 100}% threshold`,
      });
      blocked = true;
    } else {
      evaluations.push({
        rule: 'rejection_rate',
        result: 'passed',
        reason: `30-day rejection rate: ${(rate * 100).toFixed(1)}%`,
      });
    }
  } catch {
    evaluations.push({
      rule: 'rejection_rate',
      result: 'skipped',
      reason: 'Could not check rejection rate',
    });
  }

  return {
    approved: !blocked,
    reasons: evaluations.filter(e => e.result === 'blocked').map(e => e.reason),
    evaluations,
  };
}

/**
 * Try to auto-approve a post. If approved, updates status and logs audit entry.
 * @param {string} postId
 * @returns {Promise<{ autoApproved: boolean, reasons: string[] }>}
 */
export async function tryAutoApprove(postId) {
  // Load the post
  const postResult = await query(
    'SELECT * FROM marketing_posts WHERE id = $1',
    [postId]
  );
  const post = postResult.rows[0];
  if (!post) throw new Error(`Post ${postId} not found`);
  if (post.status !== 'draft') {
    return { autoApproved: false, reasons: ['Post is not in draft status'] };
  }

  const evaluation = await evaluateAutoApprove(post);

  if (evaluation.approved) {
    // Auto-approve the post
    await query(
      `UPDATE marketing_posts SET status = 'approved', approved_by = 'auto-approve-engine', updated_at = NOW() WHERE id = $1`,
      [postId]
    );
    // Log audit
    await query(
      `INSERT INTO marketing_post_history (post_id, action, actor_id, details) VALUES ($1, 'auto_approved', 'system', $2)`,
      [postId, JSON.stringify({ evaluations: evaluation.evaluations })]
    );
  }

  return {
    autoApproved: evaluation.approved,
    reasons: evaluation.reasons,
    evaluations: evaluation.evaluations,
  };
}
