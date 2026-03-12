/**
 * Admin Marketing Routes — GreenReach Central
 * All API endpoints for the AI-powered marketing agent.
 * Mounted at /api/admin/marketing (auth handled by parent router).
 */

import express from 'express';
import { query } from '../config/database.js';
import { generateSocialPost, generateMultiPlatformPosts, checkCompliance } from '../services/marketing-ai-agent.js';
import { evaluateAutoApprove, tryAutoApprove, loadAllRules, toggleRule, updateRule } from '../services/marketing-rules-engine.js';
import { publishToPlatform, getPlatformStatus } from '../services/marketing-platforms.js';
import { listSkills, updateSkill } from '../services/marketing-skills.js';
import { getSetting, setSetting, deleteSetting, checkPlatformCredentials } from '../services/marketing-settings.js';

const router = express.Router();

// ════════════════════════════════════════════════════════════════════
// POST /generate — Generate AI content draft(s)
// ════════════════════════════════════════════════════════════════════
router.post('/generate', async (req, res) => {
  try {
    const { platform, platforms, sourceType, sourceId, sourceContext, customInstructions } = req.body;

    if (!sourceType) {
      return res.status(400).json({ success: false, error: 'sourceType is required' });
    }

    let results;

    if (platforms && Array.isArray(platforms)) {
      // Multi-platform generation
      results = await generateMultiPlatformPosts({
        platforms,
        sourceType,
        sourceId,
        sourceContext,
        customInstructions,
      });
    } else {
      // Single platform
      const targetPlatform = platform || 'linkedin';
      const post = await generateSocialPost({
        platform: targetPlatform,
        sourceType,
        sourceId,
        sourceContext,
        customInstructions,
      });
      results = [post];
    }

    // Save drafts to DB and run auto-approve
    const savedPosts = [];
    for (const post of results) {
      if (post.error) {
        savedPosts.push(post);
        continue;
      }

      // Save draft
      const insertResult = await query(
        `INSERT INTO marketing_posts
         (platform, content, hashtags, status, source_type, source_id, source_context,
          model_used, prompt_tokens, output_tokens, generation_cost_usd, skill_used, created_by)
         VALUES ($1, $2, $3, 'draft', $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING *`,
        [
          post.platform,
          post.content,
          post.hashtags || [],
          post.sourceType,
          post.sourceId,
          JSON.stringify(post.sourceContext || {}),
          post.model,
          post.promptTokens,
          post.outputTokens,
          post.cost,
          post.skillUsed || 'content-drafter',
          req.admin?.email || 'admin',
        ]
      );
      const saved = insertResult.rows[0];

      // Log creation
      await query(
        `INSERT INTO marketing_post_history (post_id, action, actor_id, details)
         VALUES ($1, 'created', $2, $3)`,
        [saved.id, req.admin?.email || 'admin', JSON.stringify({
          model: post.model, provider: post.provider, cost: post.cost,
          complianceViolations: post.complianceViolations,
        })]
      );

      // Try auto-approve
      const autoResult = await tryAutoApprove(saved.id);

      // Re-fetch to get updated status
      const updated = await query('SELECT * FROM marketing_posts WHERE id = $1', [saved.id]);

      savedPosts.push({
        ...updated.rows[0],
        complianceViolations: post.complianceViolations,
        autoApproveResult: autoResult,
      });
    }

    res.json({
      success: true,
      posts: savedPosts,
      count: savedPosts.length,
    });
  } catch (error) {
    console.error('[admin-marketing] Generate error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ════════════════════════════════════════════════════════════════════
// GET /queue — List posts with optional status filter
// ════════════════════════════════════════════════════════════════════
router.get('/queue', async (req, res) => {
  try {
    const { status, platform, limit = 50, offset = 0 } = req.query;

    let sql = 'SELECT * FROM marketing_posts';
    const conditions = [];
    const values = [];
    let idx = 1;

    if (status && status !== 'all') {
      conditions.push(`status = $${idx++}`);
      values.push(status);
    }
    if (platform) {
      conditions.push(`platform = $${idx++}`);
      values.push(platform);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ` ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
    values.push(parseInt(limit), parseInt(offset));

    const result = await query(sql, values);

    // Get total counts per status
    const countsResult = await query(
      `SELECT status, COUNT(*) as count FROM marketing_posts GROUP BY status`
    );
    const counts = {};
    for (const row of countsResult.rows) {
      counts[row.status] = parseInt(row.count);
    }

    res.json({
      success: true,
      posts: result.rows,
      total: result.rows.length,
      counts,
    });
  } catch (error) {
    console.error('[admin-marketing] Queue error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ════════════════════════════════════════════════════════════════════
// PATCH /queue — Approve, reject, edit, or schedule a post
// ════════════════════════════════════════════════════════════════════
router.patch('/queue', async (req, res) => {
  try {
    const { postId, action, content, rejection_reason, scheduled_for } = req.body;

    if (!postId || !action) {
      return res.status(400).json({ success: false, error: 'postId and action are required' });
    }

    const post = await query('SELECT * FROM marketing_posts WHERE id = $1', [postId]);
    if (post.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Post not found' });
    }

    const actor = req.admin?.email || 'admin';
    let updatedPost;

    switch (action) {
      case 'approve':
        updatedPost = await query(
          `UPDATE marketing_posts SET status = 'approved', approved_by = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
          [actor, postId]
        );
        await query(
          `INSERT INTO marketing_post_history (post_id, action, actor_id) VALUES ($1, 'approved', $2)`,
          [postId, actor]
        );
        break;

      case 'reject':
        updatedPost = await query(
          `UPDATE marketing_posts SET status = 'rejected', rejection_reason = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
          [rejection_reason || 'No reason provided', postId]
        );
        await query(
          `INSERT INTO marketing_post_history (post_id, action, actor_id, details) VALUES ($1, 'rejected', $2, $3)`,
          [postId, actor, JSON.stringify({ reason: rejection_reason })]
        );
        break;

      case 'edit':
        if (!content) {
          return res.status(400).json({ success: false, error: 'content is required for edit action' });
        }
        // Run compliance on edited content
        const violations = checkCompliance(content);
        updatedPost = await query(
          `UPDATE marketing_posts SET content = $1, status = 'draft', updated_at = NOW() WHERE id = $2 RETURNING *`,
          [content, postId]
        );
        await query(
          `INSERT INTO marketing_post_history (post_id, action, actor_id, details) VALUES ($1, 'edited', $2, $3)`,
          [postId, actor, JSON.stringify({ complianceViolations: violations })]
        );
        break;

      case 'schedule':
        if (!scheduled_for) {
          return res.status(400).json({ success: false, error: 'scheduled_for is required for schedule action' });
        }
        updatedPost = await query(
          `UPDATE marketing_posts SET status = 'scheduled', scheduled_for = $1, approved_by = $2, updated_at = NOW() WHERE id = $3 RETURNING *`,
          [scheduled_for, actor, postId]
        );
        await query(
          `INSERT INTO marketing_post_history (post_id, action, actor_id, details) VALUES ($1, 'scheduled', $2, $3)`,
          [postId, actor, JSON.stringify({ scheduled_for })]
        );
        break;

      default:
        return res.status(400).json({ success: false, error: `Unknown action: ${action}` });
    }

    res.json({ success: true, post: updatedPost?.rows[0] || null });
  } catch (error) {
    console.error('[admin-marketing] Queue PATCH error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ════════════════════════════════════════════════════════════════════
// DELETE /queue — Delete draft/rejected posts
// ════════════════════════════════════════════════════════════════════
router.delete('/queue', async (req, res) => {
  try {
    const { postId } = req.body;
    if (!postId) {
      return res.status(400).json({ success: false, error: 'postId is required' });
    }

    const post = await query('SELECT status FROM marketing_posts WHERE id = $1', [postId]);
    if (post.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Post not found' });
    }

    if (!['draft', 'rejected'].includes(post.rows[0].status)) {
      return res.status(400).json({ success: false, error: 'Only draft or rejected posts can be deleted' });
    }

    await query('DELETE FROM marketing_posts WHERE id = $1', [postId]);
    res.json({ success: true, deleted: postId });
  } catch (error) {
    console.error('[admin-marketing] Queue DELETE error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ════════════════════════════════════════════════════════════════════
// POST /publish — Publish to social platform
// ════════════════════════════════════════════════════════════════════
router.post('/publish', async (req, res) => {
  try {
    const { postId } = req.body;
    if (!postId) {
      return res.status(400).json({ success: false, error: 'postId is required' });
    }

    const postResult = await query('SELECT * FROM marketing_posts WHERE id = $1', [postId]);
    if (postResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Post not found' });
    }

    const post = postResult.rows[0];
    if (!['approved', 'scheduled'].includes(post.status)) {
      return res.status(400).json({ success: false, error: 'Post must be approved or scheduled to publish' });
    }

    // Publish to platform
    const result = await publishToPlatform(post.platform, post.content, post.image_url);
    const actor = req.admin?.email || 'admin';

    if (result.success) {
      await query(
        `UPDATE marketing_posts
         SET status = 'published', published_at = NOW(), platform_post_id = $1, updated_at = NOW()
         WHERE id = $2`,
        [result.platformPostId, postId]
      );
      await query(
        `INSERT INTO marketing_post_history (post_id, action, actor_id, details) VALUES ($1, 'published', $2, $3)`,
        [postId, actor, JSON.stringify({ platformPostId: result.platformPostId, stubbed: result.stubbed })]
      );
    } else {
      await query(
        `UPDATE marketing_posts SET status = 'failed', updated_at = NOW() WHERE id = $1`,
        [postId]
      );
      await query(
        `INSERT INTO marketing_post_history (post_id, action, actor_id, details) VALUES ($1, 'failed', $2, $3)`,
        [postId, actor, JSON.stringify({ error: result.error })]
      );
    }

    const updated = await query('SELECT * FROM marketing_posts WHERE id = $1', [postId]);

    res.json({
      success: result.success,
      post: updated.rows[0],
      publishResult: result,
    });
  } catch (error) {
    console.error('[admin-marketing] Publish error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ════════════════════════════════════════════════════════════════════
// POST /cron — Process scheduled posts (called by external cron)
// ════════════════════════════════════════════════════════════════════
router.post('/cron', async (req, res) => {
  try {
    // Find scheduled posts that are due
    const dueResult = await query(
      `SELECT * FROM marketing_posts
       WHERE status = 'scheduled' AND scheduled_for <= NOW()
       ORDER BY scheduled_for ASC
       LIMIT 20`
    );

    const results = [];
    for (const post of dueResult.rows) {
      const publishResult = await publishToPlatform(post.platform, post.content, post.image_url);

      if (publishResult.success) {
        await query(
          `UPDATE marketing_posts
           SET status = 'published', published_at = NOW(), platform_post_id = $1, updated_at = NOW()
           WHERE id = $2`,
          [publishResult.platformPostId, post.id]
        );
        await query(
          `INSERT INTO marketing_post_history (post_id, action, actor_id, details) VALUES ($1, 'published', 'cron', $2)`,
          [post.id, JSON.stringify({ platformPostId: publishResult.platformPostId, stubbed: publishResult.stubbed })]
        );
      } else {
        await query(
          `UPDATE marketing_posts SET status = 'failed', updated_at = NOW() WHERE id = $1`,
          [post.id]
        );
        await query(
          `INSERT INTO marketing_post_history (post_id, action, actor_id, details) VALUES ($1, 'failed', 'cron', $2)`,
          [post.id, JSON.stringify({ error: publishResult.error })]
        );
      }

      results.push({ postId: post.id, platform: post.platform, success: publishResult.success });
    }

    res.json({ success: true, processed: results.length, results });
  } catch (error) {
    console.error('[admin-marketing] Cron error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ════════════════════════════════════════════════════════════════════
// GET /metrics — Aggregate and per-post engagement metrics
// ════════════════════════════════════════════════════════════════════
router.get('/metrics', async (req, res) => {
  try {
    // Aggregate stats
    const stats = await query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'published') as total_published,
        COUNT(*) FILTER (WHERE status = 'draft') as total_drafts,
        COUNT(*) FILTER (WHERE status = 'approved') as total_approved,
        COUNT(*) FILTER (WHERE status = 'rejected') as total_rejected,
        COUNT(*) FILTER (WHERE status = 'scheduled') as total_scheduled,
        COUNT(*) FILTER (WHERE status = 'failed') as total_failed,
        COALESCE(SUM(generation_cost_usd), 0) as total_cost,
        COALESCE(SUM(prompt_tokens), 0) as total_prompt_tokens,
        COALESCE(SUM(output_tokens), 0) as total_output_tokens
      FROM marketing_posts
    `);

    // Per-platform stats
    const platformStats = await query(`
      SELECT platform,
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'published') as published,
        COALESCE(SUM(generation_cost_usd), 0) as cost
      FROM marketing_posts
      GROUP BY platform
      ORDER BY platform
    `);

    // Recent published posts with metrics
    const recentPublished = await query(`
      SELECT id, platform, content, metrics, published_at, generation_cost_usd, model_used
      FROM marketing_posts
      WHERE status = 'published'
      ORDER BY published_at DESC
      LIMIT 20
    `);

    // Cost over time (last 30 days, daily)
    const costTrend = await query(`
      SELECT DATE(created_at) as date,
        COUNT(*) as posts,
        COALESCE(SUM(generation_cost_usd), 0) as cost
      FROM marketing_posts
      WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY DATE(created_at)
      ORDER BY date
    `);

    res.json({
      success: true,
      summary: stats.rows[0],
      platforms: platformStats.rows,
      recentPublished: recentPublished.rows,
      costTrend: costTrend.rows,
    });
  } catch (error) {
    console.error('[admin-marketing] Metrics error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ════════════════════════════════════════════════════════════════════
// PATCH /metrics — Update engagement metrics for a published post
// ════════════════════════════════════════════════════════════════════
router.patch('/metrics', async (req, res) => {
  try {
    const { postId, metrics } = req.body;
    if (!postId || !metrics) {
      return res.status(400).json({ success: false, error: 'postId and metrics are required' });
    }

    const result = await query(
      `UPDATE marketing_posts SET metrics = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [JSON.stringify(metrics), postId]
    );

    res.json({ success: true, post: result.rows[0] });
  } catch (error) {
    console.error('[admin-marketing] Metrics PATCH error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ════════════════════════════════════════════════════════════════════
// GET /rules — List marketing rules
// ════════════════════════════════════════════════════════════════════
router.get('/rules', async (req, res) => {
  try {
    const rules = await loadAllRules();
    res.json({ success: true, rules });
  } catch (error) {
    console.error('[admin-marketing] Rules error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ════════════════════════════════════════════════════════════════════
// PATCH /rules — Toggle or update a rule
// ════════════════════════════════════════════════════════════════════
router.patch('/rules', async (req, res) => {
  try {
    const { ruleId, enabled, conditions } = req.body;
    if (!ruleId) {
      return res.status(400).json({ success: false, error: 'ruleId is required' });
    }

    if (enabled !== undefined) {
      const updated = await toggleRule(ruleId, enabled);
      return res.json({ success: true, rule: updated });
    }
    if (conditions !== undefined) {
      const updated = await updateRule(ruleId, { conditions });
      return res.json({ success: true, rule: updated });
    }

    res.status(400).json({ success: false, error: 'enabled or conditions update required' });
  } catch (error) {
    console.error('[admin-marketing] Rules PATCH error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ════════════════════════════════════════════════════════════════════
// GET /skills — List agent skills
// ════════════════════════════════════════════════════════════════════
router.get('/skills', async (req, res) => {
  try {
    const skills = await listSkills();
    res.json({ success: true, skills });
  } catch (error) {
    console.error('[admin-marketing] Skills error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ════════════════════════════════════════════════════════════════════
// PATCH /skills — Toggle or update a skill
// ════════════════════════════════════════════════════════════════════
router.patch('/skills', async (req, res) => {
  try {
    const { skillName, enabled, approval_mode, description } = req.body;
    if (!skillName) {
      return res.status(400).json({ success: false, error: 'skillName is required' });
    }

    const updated = await updateSkill(skillName, { enabled, approval_mode, description });
    res.json({ success: true, skill: updated });
  } catch (error) {
    console.error('[admin-marketing] Skills PATCH error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ════════════════════════════════════════════════════════════════════
// GET /settings — Get marketing-related settings
// ════════════════════════════════════════════════════════════════════
router.get('/settings', async (req, res) => {
  try {
    const platformStatus = await getPlatformStatus();

    // Check AI provider status
    const anthropicKey = await getSetting('anthropic_api_key');
    const openaiKey = await getSetting('openai_api_key');

    res.json({
      success: true,
      ai: {
        anthropic: { configured: !!anthropicKey, provider: 'Claude' },
        openai: { configured: !!openaiKey, provider: 'OpenAI' },
        primary: anthropicKey ? 'anthropic' : (openaiKey ? 'openai' : 'none'),
      },
      platforms: platformStatus,
    });
  } catch (error) {
    console.error('[admin-marketing] Settings error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ════════════════════════════════════════════════════════════════════
// PUT /settings — Update marketing-related settings (API keys etc)
// ════════════════════════════════════════════════════════════════════
router.put('/settings', async (req, res) => {
  try {
    const { settings } = req.body;
    if (!settings || typeof settings !== 'object') {
      return res.status(400).json({ success: false, error: 'settings object is required' });
    }

    // Allowlist of settable keys
    const allowedKeys = [
      'anthropic_api_key', 'openai_api_key',
      'twitter_api_key', 'twitter_api_secret', 'twitter_access_token', 'twitter_access_secret',
      'linkedin_access_token', 'linkedin_person_urn',
      'instagram_access_token', 'instagram_business_account',
      'facebook_page_access_token', 'facebook_page_id',
      'marketing_notify_email',
    ];

    const saved = {};
    for (const [key, value] of Object.entries(settings)) {
      if (!allowedKeys.includes(key)) continue;
      if (value === null || value === '') {
        await deleteSetting(key);
        saved[key] = null;
      } else {
        await setSetting(key, value);
        saved[key] = '***configured***';
      }
    }

    res.json({ success: true, saved });
  } catch (error) {
    console.error('[admin-marketing] Settings PUT error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ════════════════════════════════════════════════════════════════════
// GET /history/:postId — Get audit trail for a specific post
// ════════════════════════════════════════════════════════════════════
router.get('/history/:postId', async (req, res) => {
  try {
    const { postId } = req.params;
    const result = await query(
      'SELECT * FROM marketing_post_history WHERE post_id = $1 ORDER BY created_at DESC',
      [postId]
    );
    res.json({ success: true, history: result.rows });
  } catch (error) {
    console.error('[admin-marketing] History error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
