/**
 * SCOTT Social Push — fire-and-forget helper
 * Generates a social post via SCOTT, saves to marketing_posts,
 * runs auto-approve, and publishes if approved.
 */

import { generateSocialPost } from './marketing-ai-agent.js';
import { tryAutoApprove } from './marketing-rules-engine.js';
import { publishToPlatform } from './marketing-platforms.js';
import { query } from '../config/database.js';

/**
 * Push a social media notification via SCOTT.
 * Non-blocking — caller should .catch() and move on.
 *
 * @param {Object} opts
 * @param {string} opts.platform - 'linkedin' | 'twitter' | 'instagram' | 'facebook'
 * @param {string} opts.sourceType - e.g. 'wholesale', 'milestone', 'announcement'
 * @param {string} [opts.sourceId] - optional ID of the source record
 * @param {Object} [opts.sourceContext] - context object for prompt generation
 * @param {string} [opts.customInstructions] - extra instructions for SCOTT
 */
export async function pushSocialNotification({
  platform = 'linkedin',
  sourceType,
  sourceId,
  sourceContext,
  customInstructions,
}) {
  // 1. Generate content via SCOTT AI
  const post = await generateSocialPost({
    platform,
    sourceType,
    sourceId,
    sourceContext,
    customInstructions,
  });

  if (post.error) {
    console.warn('[SCOTT] Generation failed:', post.error);
    return { success: false, error: post.error };
  }

  // 2. Save draft to marketing_posts
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
      'scott-auto',
    ]
  );
  const saved = insertResult.rows[0];

  // 3. Log creation
  await query(
    `INSERT INTO marketing_post_history (post_id, action, actor_id, details)
     VALUES ($1, 'created', $2, $3)`,
    [saved.id, 'scott-auto', JSON.stringify({
      model: post.model, provider: post.provider, cost: post.cost,
      complianceViolations: post.complianceViolations,
      trigger: sourceType,
    })]
  );

  // 4. Auto-approve check
  const autoResult = await tryAutoApprove(saved.id);

  // 5. If approved, publish immediately
  const updated = await query('SELECT * FROM marketing_posts WHERE id = $1', [saved.id]);
  const finalPost = updated.rows[0];

  if (finalPost.status === 'approved') {
    try {
      const pubResult = await publishToPlatform(finalPost.platform, finalPost.content, finalPost.image_url);
      await query(
        `UPDATE marketing_posts SET status = 'published', published_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [saved.id]
      );
      await query(
        `INSERT INTO marketing_post_history (post_id, action, actor_id, details)
         VALUES ($1, 'published', $2, $3)`,
        [saved.id, 'scott-auto', JSON.stringify(pubResult)]
      );
      console.log('[SCOTT] Published to', finalPost.platform, '- post', saved.id);
      return { success: true, postId: saved.id, status: 'published', autoApprove: autoResult };
    } catch (pubErr) {
      console.warn('[SCOTT] Publish failed for post', saved.id, ':', pubErr.message);
      return { success: true, postId: saved.id, status: 'approved', publishError: pubErr.message };
    }
  }

  console.log('[SCOTT] Post', saved.id, 'saved as', finalPost.status, '(awaiting manual review)');
  return { success: true, postId: saved.id, status: finalPost.status, autoApprove: autoResult };
}
