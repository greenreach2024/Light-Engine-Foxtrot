/**
 * S.C.O.T.T. -- Social Content Optimization, Trends & Targeting
 * ==========================================================
 * Marketing-focused conversational AI agent for GreenReach Central.
 * Junior to F.A.Y.E. -- handles all marketing operations with full
 * tool-calling loop, conversation memory, and inter-agent escalation.
 *
 * POST /chat          -- Standard request/response chat
 * GET  /status        -- Agent health check
 * GET  /state         -- Current marketing state snapshot
 *
 * Primary LLM: Claude Sonnet 4 (Anthropic)
 * Fallback:    GPT-4o-mini (OpenAI)
 */

import { Router } from 'express';
import crypto from 'crypto';
import { query, isDatabaseAvailable } from '../config/database.js';
import { trackAiUsage, estimateChatCost } from '../lib/ai-usage-tracker.js';
import {
  generateSocialPost,
  generateMultiPlatformPosts,
  checkCompliance,
  SYSTEM_PROMPT as MARKETING_SYSTEM_PROMPT,
  PLATFORM_RULES,
  SKILL_SYSTEM_PROMPTS,
} from '../services/marketing-ai-agent.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
import { evaluateAutoApprove, tryAutoApprove, loadAllRules } from '../services/marketing-rules-engine.js';
import { publishToPlatform, getPlatformStatus, getPlatformAccountInfo } from '../services/marketing-platforms.js';
import { listSkills } from '../services/marketing-skills.js';
import { getSetting, getSettings, setSetting, deleteSetting, checkPlatformCredentials } from '../services/marketing-settings.js';

const router = Router();

// -- LLM Clients (lazy-init) -------------------------------------------
let anthropicClient = null;
let openaiClient = null;

const CLAUDE_MODEL = 'claude-sonnet-4-20250514';
const OPENAI_MODEL = 'gpt-4o-mini';
const MAX_TOOL_LOOPS = 10;
const MAX_TOKENS = 2048;
const MAX_LLM_MESSAGES = 20;

async function getAnthropicClient() {
  if (anthropicClient) return anthropicClient;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  anthropicClient = new Anthropic({ apiKey });
  return anthropicClient;
}

async function getOpenAIClient() {
  if (openaiClient) return openaiClient;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const OpenAI = (await import('openai')).default;
  openaiClient = new OpenAI({ apiKey });
  return openaiClient;
}

// -- Conversation Memory (in-memory + DB) --------------------------------
const conversations = new Map();
const CONVERSATION_TTL_MS = 60 * 60 * 1000; // 1h
const MAX_HISTORY = 40;

async function getConversation(convId, adminId) {
  const cached = conversations.get(convId);
  if (cached && Date.now() - cached.lastAccess <= CONVERSATION_TTL_MS) {
    cached.lastAccess = Date.now();
    return cached;
  }
  if (cached) conversations.delete(convId);

  try {
    if (isDatabaseAvailable() && adminId) {
      const result = await query(
        `SELECT messages FROM admin_assistant_conversations
         WHERE admin_id = $1 AND conversation_id = $2
         AND updated_at > NOW() - INTERVAL '24 hours'`,
        [adminId, convId]
      );
      if (result.rows.length > 0) {
        const messages = result.rows[0].messages || [];
        const restored = { messages, lastAccess: Date.now() };
        conversations.set(convId, restored);
        return restored;
      }
    }
  } catch { /* DB unavailable */ }
  return null;
}

async function upsertConversation(convId, messages, adminId) {
  const trimmed = messages.slice(-MAX_HISTORY);
  conversations.set(convId, { messages: trimmed, lastAccess: Date.now() });

  try {
    if (isDatabaseAvailable() && adminId) {
      await query(
        `INSERT INTO admin_assistant_conversations (admin_id, conversation_id, messages, message_count, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (admin_id, conversation_id)
         DO UPDATE SET messages = $3, message_count = $4, updated_at = NOW()`,
        [adminId, `scott-${convId}`, JSON.stringify(trimmed), trimmed.length]
      );
    }
  } catch { /* non-fatal */ }
}

// Periodic cleanup
setInterval(() => {
  const now = Date.now();
  for (const [id, conv] of conversations) {
    if (now - conv.lastAccess > CONVERSATION_TTL_MS) conversations.delete(id);
  }
}, 10 * 60 * 1000);

// -- Tool Catalog --------------------------------------------------------

const SCOTT_TOOL_CATALOG = {

  // -- Content Generation Tools --
  generate_social_post: {
    description: 'Generate a social media post for a specific platform using AI. Provide the platform, content source type, and optional custom instructions.',
    parameters: {
      platform: { type: 'string', description: 'Target platform: twitter, linkedin, instagram, or facebook', enum: ['twitter', 'linkedin', 'instagram', 'facebook'] },
      source_type: { type: 'string', description: 'Content source type: harvest, market, wholesale, sustainability, product, milestone, manual, awareness, farm_spotlight, grocer, restaurant, community', enum: ['harvest', 'market', 'wholesale', 'sustainability', 'product', 'milestone', 'manual', 'awareness', 'farm_spotlight', 'grocer', 'restaurant', 'community'] },
      custom_instructions: { type: 'string', description: 'Optional additional instructions for the content generator' },
    },
    required: ['platform', 'source_type'],
    execute: async (params) => {
      const result = await generateSocialPost({
        platform: params.platform,
        sourceType: params.source_type,
        customInstructions: params.custom_instructions,
      });
      return { ok: true, post: { platform: result.platform, content: result.content, hashtags: result.hashtags, compliance_violations: result.complianceViolations, model: result.model, cost: result.cost } };
    },
  },

  generate_multi_platform: {
    description: 'Generate social media posts for all platforms (Twitter/X, LinkedIn, Instagram, Facebook) at once from a single content source.',
    parameters: {
      source_type: { type: 'string', description: 'Content source type', enum: ['harvest', 'market', 'wholesale', 'sustainability', 'product', 'milestone', 'manual', 'awareness', 'farm_spotlight', 'grocer', 'restaurant', 'community'] },
      custom_instructions: { type: 'string', description: 'Optional additional instructions' },
    },
    required: ['source_type'],
    execute: async (params) => {
      const results = await generateMultiPlatformPosts({
        sourceType: params.source_type,
        customInstructions: params.custom_instructions,
      });
      return { ok: true, posts: results.map(r => ({ platform: r.platform, content: r.content, hashtags: r.hashtags, compliance_violations: r.complianceViolations, error: r.error })) };
    },
  },

  // -- Queue & Post Management --
  get_content_queue: {
    description: 'List marketing content drafts by status. Shows all posts in the queue with their status, platform, creation date, and compliance state.',
    parameters: {
      status: { type: 'string', description: 'Filter by status: all, draft, approved, scheduled, published, rejected, failed', enum: ['all', 'draft', 'approved', 'scheduled', 'published', 'rejected', 'failed'] },
      limit: { type: 'number', description: 'Max posts to return (default 20)' },
    },
    required: [],
    execute: async (params) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database not available' };
      const status = params.status || 'all';
      const limit = Math.min(params.limit || 20, 50);
      let sql = 'SELECT id, platform, status, content, hashtags, created_at, published_at, model_used, generation_cost_usd FROM marketing_posts';
      const sqlParams = [];
      if (status !== 'all') {
        sql += ' WHERE status = $1';
        sqlParams.push(status);
      }
      sql += ' ORDER BY created_at DESC LIMIT $' + (sqlParams.length + 1);
      sqlParams.push(limit);
      try {
        const result = await query(sql, sqlParams);
        return { ok: true, posts: result.rows, count: result.rows.length };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },
  },

  approve_post: {
    description: 'Approve a marketing post draft, making it ready for publishing.',
    parameters: {
      post_id: { type: 'number', description: 'The ID of the post to approve' },
    },
    required: ['post_id'],
    execute: async (params) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database not available' };
      try {
        await query(
          `UPDATE marketing_posts SET status = 'approved', updated_at = NOW() WHERE id = $1 AND status = 'draft'`,
          [params.post_id]
        );
        await query(
          `INSERT INTO marketing_post_history (post_id, action, actor_id, details) VALUES ($1, 'approved', 'scott-agent', '{}')`,
          [params.post_id]
        );
        return { ok: true, message: `Post ${params.post_id} approved` };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },
  },

  reject_post: {
    description: 'Reject a marketing post draft with a reason.',
    parameters: {
      post_id: { type: 'number', description: 'The ID of the post to reject' },
      reason: { type: 'string', description: 'Reason for rejection' },
    },
    required: ['post_id', 'reason'],
    execute: async (params) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database not available' };
      try {
        await query(
          `UPDATE marketing_posts SET status = 'rejected', updated_at = NOW() WHERE id = $1`,
          [params.post_id]
        );
        await query(
          `INSERT INTO marketing_post_history (post_id, action, actor_id, details) VALUES ($1, 'rejected', 'scott-agent', $2)`,
          [params.post_id, JSON.stringify({ reason: params.reason })]
        );
        return { ok: true, message: `Post ${params.post_id} rejected: ${params.reason}` };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },
  },

  edit_post_content: {
    description: 'Edit the content of a draft or approved marketing post.',
    parameters: {
      post_id: { type: 'number', description: 'The ID of the post to edit' },
      new_content: { type: 'string', description: 'The updated content' },
    },
    required: ['post_id', 'new_content'],
    execute: async (params) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database not available' };
      const violations = checkCompliance(params.new_content);
      try {
        await query(
          `UPDATE marketing_posts SET content = $1, updated_at = NOW() WHERE id = $2 AND status IN ('draft', 'approved')`,
          [params.new_content, params.post_id]
        );
        await query(
          `INSERT INTO marketing_post_history (post_id, action, actor_id, details) VALUES ($1, 'edited', 'scott-agent', $2)`,
          [params.post_id, JSON.stringify({ compliance_violations: violations })]
        );
        return { ok: true, message: `Post ${params.post_id} updated`, compliance_violations: violations };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },
  },

  publish_post: {
    description: 'Publish an approved marketing post to its target platform.',
    parameters: {
      post_id: { type: 'number', description: 'The ID of the post to publish' },
    },
    required: ['post_id'],
    execute: async (params) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database not available' };
      try {
        const result = await query('SELECT * FROM marketing_posts WHERE id = $1 AND status = $2', [params.post_id, 'approved']);
        if (result.rows.length === 0) return { ok: false, error: 'Post not found or not in approved status' };
        const post = result.rows[0];
        const pubResult = await publishToPlatform(post.platform, post.content);
        if (pubResult.success) {
          await query(`UPDATE marketing_posts SET status = 'published', published_at = NOW(), updated_at = NOW() WHERE id = $1`, [params.post_id]);
          await query(`INSERT INTO marketing_post_history (post_id, action, actor_id, details) VALUES ($1, 'published', 'scott-agent', $2)`, [params.post_id, JSON.stringify(pubResult)]);
        }
        return { ok: pubResult.success, message: pubResult.success ? `Published to ${post.platform}` : pubResult.error };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },
  },

  // -- Compliance --
  check_content_compliance: {
    description: 'Check a piece of text for compliance violations against GreenReach brand and regulatory rules. Returns any blocked phrases or policy violations found.',
    parameters: {
      content: { type: 'string', description: 'The content text to check' },
    },
    required: ['content'],
    execute: async (params) => {
      const violations = checkCompliance(params.content);
      return { ok: true, is_compliant: violations.length === 0, violations };
    },
  },

  // -- Marketing Analytics --
  get_marketing_stats: {
    description: 'Get marketing performance stats: post counts by status, platform breakdown, total cost, recent activity.',
    parameters: {},
    required: [],
    execute: async () => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database not available' };
      try {
        const statusCounts = await query(`SELECT status, COUNT(*) as count FROM marketing_posts GROUP BY status ORDER BY count DESC`);
        const platformCounts = await query(`SELECT platform, COUNT(*) as count FROM marketing_posts GROUP BY platform ORDER BY count DESC`);
        const totalCost = await query(`SELECT COALESCE(SUM(generation_cost_usd), 0) as total_cost FROM marketing_posts`);
        const recentPosts = await query(`SELECT id, platform, status, created_at FROM marketing_posts ORDER BY created_at DESC LIMIT 5`);
        return {
          ok: true,
          by_status: statusCounts.rows,
          by_platform: platformCounts.rows,
          total_generation_cost_usd: parseFloat(totalCost.rows[0]?.total_cost || 0),
          recent_posts: recentPosts.rows,
        };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },
  },

  // -- Rules & Skills --
  get_marketing_rules: {
    description: 'List all marketing automation rules (auto-approve thresholds, compliance gates, etc).',
    parameters: {},
    required: [],
    execute: async () => {
      try {
        const rules = await loadAllRules();
        return { ok: true, rules };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },
  },

  get_marketing_skills: {
    description: 'List all marketing agent skills (content-drafter, compliance-screener, schedule-optimizer, etc) with their enabled status.',
    parameters: {},
    required: [],
    execute: async () => {
      try {
        const skills = await listSkills();
        return { ok: true, skills };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },
  },

  // -- Platform Status --
  get_platform_credentials_status: {
    description: 'Check which social media platforms have credentials configured (Facebook, Instagram, LinkedIn, Twitter/X).',
    parameters: {},
    required: [],
    execute: async () => {
      try {
        const statuses = {};
        for (const platform of ['facebook', 'instagram', 'linkedin', 'twitter']) {
          const status = await getPlatformStatus(platform);
          statuses[platform] = status;
        }
        return { ok: true, platforms: statuses };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },
  },

  // -- Data Context Tools --
  get_available_produce: {
    description: 'Get current produce available across the GreenReach farm network. Useful for generating content about specific crops or availability.',
    parameters: {
      limit: { type: 'number', description: 'Max items to return (default 15)' },
    },
    required: [],
    execute: async (params) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database not available' };
      try {
        const result = await query(
          `SELECT product_name, variety, quantity_available, unit, harvest_date, farm_id
           FROM farm_inventory WHERE quantity_available > 0
           ORDER BY harvest_date DESC LIMIT $1`,
          [Math.min(params.limit || 15, 50)]
        );
        return { ok: true, produce: result.rows, count: result.rows.length };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },
  },

  get_network_farms: {
    description: 'Get active farms in the GreenReach network for farm spotlight content.',
    parameters: {},
    required: [],
    execute: async () => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database not available' };
      try {
        const result = await query(`SELECT farm_id, name, location, status, created_at FROM farms WHERE status = 'active' ORDER BY name`);
        return { ok: true, farms: result.rows, count: result.rows.length };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },
  },

  get_wholesale_activity: {
    description: 'Get recent wholesale order activity for content about buyer engagement and marketplace growth.',
    parameters: {
      days: { type: 'number', description: 'Look-back days (default 30)' },
    },
    required: [],
    execute: async (params) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database not available' };
      const days = params.days || 30;
      try {
        const orderCount = await query(`SELECT COUNT(*) as count FROM wholesale_orders WHERE created_at > NOW() - $1::interval`, [`${days} days`]);
        const buyerCount = await query(`SELECT COUNT(DISTINCT buyer_id) as count FROM wholesale_orders WHERE created_at > NOW() - $1::interval`, [`${days} days`]);
        return { ok: true, orders_count: parseInt(orderCount.rows[0]?.count || 0), unique_buyers: parseInt(buyerCount.rows[0]?.count || 0), period_days: days };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },
  },

  get_market_intelligence: {
    description: 'Get current market intelligence data (pricing, trends) for evidence-based marketing content.',
    parameters: {
      limit: { type: 'number', description: 'Max items (default 10)' },
    },
    required: [],
    execute: async (params) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database not available' };
      try {
        const result = await query(
          `SELECT product_name, avg_retail_price, price_trend, data_source, observed_at
           FROM market_intelligence ORDER BY observed_at DESC LIMIT $1`,
          [Math.min(params.limit || 10, 30)]
        );
        return { ok: true, market_data: result.rows };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },
  },

  // -- Inter-Agent Communication --
  escalate_to_faye: {
    description: 'Escalate a marketing decision to F.A.Y.E. (senior agent) when it involves pricing, financial commitments, wholesale terms, or strategic decisions beyond marketing scope.',
    parameters: {
      subject: { type: 'string', description: 'Brief subject line for the escalation' },
      details: { type: 'string', description: 'Full context and what decision is needed from F.A.Y.E.' },
      priority: { type: 'string', description: 'Priority level', enum: ['low', 'medium', 'high'] },
    },
    required: ['subject', 'details'],
    execute: async (params) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database not available' };
      try {
        await query(
          `INSERT INTO inter_agent_messages (from_agent, to_agent, subject, body, priority, status, created_at)
           VALUES ('scott', 'faye', $1, $2, $3, 'unread', NOW())`,
          [params.subject, params.details, params.priority || 'medium']
        );
        return { ok: true, message: `Escalated to F.A.Y.E.: "${params.subject}"` };
      } catch (err) {
        // Table may not exist yet -- store as fallback
        return { ok: true, message: `Escalation noted (inter_agent_messages table not yet available): "${params.subject}"`, fallback: true };
      }
    },
  },

  get_faye_directives: {
    description: 'Check for any directives or messages from F.A.Y.E. (senior agent).',
    parameters: {},
    required: [],
    execute: async () => {
      if (!isDatabaseAvailable()) return { ok: true, messages: [], note: 'No database connection' };
      try {
        const result = await query(
          `SELECT id, subject, body, priority, created_at FROM inter_agent_messages
           WHERE to_agent = 'scott' AND status = 'unread' ORDER BY created_at DESC LIMIT 10`
        );
        // Mark as read
        if (result.rows.length > 0) {
          const ids = result.rows.map(r => r.id);
          await query(`UPDATE inter_agent_messages SET status = 'read' WHERE id = ANY($1)`, [ids]);
        }
        return { ok: true, messages: result.rows };
      } catch {
        return { ok: true, messages: [], note: 'Inter-agent table not yet available' };
      }
    },
  },

  get_faye_data_feed: {
    description: 'Request celebration-worthy data from F.A.Y.E. -- new customers, new food producers joining the network, marketplace growth trends, order milestones, and other events worth highlighting on social media. F.A.Y.E. is the data authority; Scott uses this feed to create celebration posts.',
    parameters: {
      feed_type: { type: 'string', description: 'Type of data to request from F.A.Y.E.', enum: ['new_customers', 'new_producers', 'growth_trends', 'milestones', 'all'] },
      days: { type: 'number', description: 'Look-back period in days (default 30)' },
    },
    required: ['feed_type'],
    execute: async (params) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database not available' };
      const days = params.days || 30;
      const interval = `${days} days`;
      const feed = {};

      try {
        if (params.feed_type === 'new_customers' || params.feed_type === 'all') {
          const buyers = await query(
            `SELECT b.id, b.business_name, b.business_type, b.city, b.created_at
             FROM wholesale_buyers b
             WHERE b.created_at > NOW() - $1::interval
             ORDER BY b.created_at DESC LIMIT 20`,
            [interval]
          );
          feed.new_customers = {
            count: buyers.rows.length,
            buyers: buyers.rows.map(b => ({
              business_name: b.business_name,
              type: b.business_type,
              city: b.city,
              joined: b.created_at,
            })),
            celebration_prompt: buyers.rows.length > 0
              ? `${buyers.rows.length} new buyer(s) joined in the last ${days} days. Create welcome/celebration posts highlighting community growth.`
              : `No new buyers in the last ${days} days.`,
          };
        }

        if (params.feed_type === 'new_producers' || params.feed_type === 'all') {
          const farms = await query(
            `SELECT f.farm_id, f.name, f.location, f.created_at
             FROM farms f
             WHERE f.created_at > NOW() - $1::interval AND f.status = 'active'
             ORDER BY f.created_at DESC LIMIT 20`,
            [interval]
          );
          feed.new_producers = {
            count: farms.rows.length,
            farms: farms.rows.map(f => ({
              name: f.name,
              location: f.location,
              joined: f.created_at,
            })),
            celebration_prompt: farms.rows.length > 0
              ? `${farms.rows.length} new farm producer(s) joined the network in the last ${days} days. Create farm spotlight or welcome posts.`
              : `No new producers in the last ${days} days.`,
          };
        }

        if (params.feed_type === 'growth_trends' || params.feed_type === 'all') {
          const currentOrders = await query(
            `SELECT COUNT(*)::int as count, COALESCE(SUM(total_amount), 0)::numeric as revenue
             FROM wholesale_orders WHERE created_at > NOW() - $1::interval`,
            [interval]
          );
          const previousOrders = await query(
            `SELECT COUNT(*)::int as count, COALESCE(SUM(total_amount), 0)::numeric as revenue
             FROM wholesale_orders WHERE created_at > NOW() - ($1::interval * 2) AND created_at <= NOW() - $1::interval`,
            [interval]
          );
          const curr = currentOrders.rows[0] || { count: 0, revenue: 0 };
          const prev = previousOrders.rows[0] || { count: 0, revenue: 0 };
          const orderGrowth = prev.count > 0 ? (((curr.count - prev.count) / prev.count) * 100).toFixed(1) : null;
          const revenueGrowth = parseFloat(prev.revenue) > 0 ? (((parseFloat(curr.revenue) - parseFloat(prev.revenue)) / parseFloat(prev.revenue)) * 100).toFixed(1) : null;

          feed.growth_trends = {
            current_period: { orders: curr.count, revenue: parseFloat(curr.revenue).toFixed(2) },
            previous_period: { orders: prev.count, revenue: parseFloat(prev.revenue).toFixed(2) },
            order_growth_pct: orderGrowth,
            revenue_growth_pct: revenueGrowth,
            celebration_prompt: orderGrowth && parseFloat(orderGrowth) > 0
              ? `Orders are up ${orderGrowth}% period-over-period. Great opportunity for a growth milestone post.`
              : 'Growth is flat or declining -- focus on value-driven content rather than growth metrics.',
          };
        }

        if (params.feed_type === 'milestones' || params.feed_type === 'all') {
          const totalOrders = await query(`SELECT COUNT(*)::int as count FROM wholesale_orders`);
          const totalBuyers = await query(`SELECT COUNT(*)::int as count FROM wholesale_buyers`);
          const totalFarms = await query(`SELECT COUNT(*)::int as count FROM farms WHERE status = 'active'`);
          const milestones = {
            total_orders: totalOrders.rows[0]?.count || 0,
            total_buyers: totalBuyers.rows[0]?.count || 0,
            total_farms: totalFarms.rows[0]?.count || 0,
          };
          // Check for round-number milestones worth celebrating
          const celebrations = [];
          for (const [key, val] of Object.entries(milestones)) {
            if (val > 0 && (val % 50 === 0 || val % 100 === 0 || [10, 25, 50, 100, 250, 500, 1000].includes(val))) {
              celebrations.push(`${key} just hit ${val} -- milestone post opportunity`);
            }
          }
          feed.milestones = {
            ...milestones,
            celebrations: celebrations.length > 0 ? celebrations : ['No round-number milestones right now'],
          };
        }

        return {
          ok: true,
          feed_type: params.feed_type,
          period_days: days,
          data: feed,
          source: 'F.A.Y.E. data feed',
          note: 'Use this data to create celebration posts, farm spotlights, growth announcements, and community welcome content. Always verify numbers before publishing -- do not embellish.',
        };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },
  },

  request_faye_insight: {
    description: 'Ask F.A.Y.E. for a specific operational insight or recommendation to inform marketing decisions. F.A.Y.E. has access to the full operational picture -- demand patterns, supply forecasts, pricing trends, network health. Scott should ask F.A.Y.E. before making claims about business performance.',
    parameters: {
      question: { type: 'string', description: 'The specific question or insight request for F.A.Y.E.' },
    },
    required: ['question'],
    execute: async (params) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database not available' };
      try {
        // Log the request
        await query(
          `INSERT INTO inter_agent_messages (from_agent, to_agent, subject, body, priority, status, created_at)
           VALUES ('scott', 'faye', 'Insight Request', $1, 'medium', 'pending', NOW())`,
          [params.question]
        );
        // For now, return guidance -- future: F.A.Y.E. processes async
        return {
          ok: true,
          status: 'logged',
          message: `Insight request sent to F.A.Y.E.: "${params.question}". Use your data context tools (get_available_produce, get_network_farms, get_wholesale_activity, get_market_intelligence) for immediate data access. F.A.Y.E. will respond to complex strategic questions asynchronously.`,
        };
      } catch {
        return { ok: true, status: 'fallback', message: 'Request logged locally. Use data context tools for immediate data.' };
      }
    },
  },

  // -- Post History --
  get_post_history: {
    description: 'Get the action history for a specific marketing post (created, edited, approved, rejected, published).',
    parameters: {
      post_id: { type: 'number', description: 'The post ID to get history for' },
    },
    required: ['post_id'],
    execute: async (params) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database not available' };
      try {
        const result = await query(
          `SELECT action, actor_id, details, created_at FROM marketing_post_history
           WHERE post_id = $1 ORDER BY created_at ASC`,
          [params.post_id]
        );
        return { ok: true, history: result.rows };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },
  },

  // -- FAYE Marketing Skills --
  use_marketing_skill: {
    description: 'Activate a specialized marketing skill (inherited from F.A.Y.E.) to perform a focused task. Each skill has a domain-expert system prompt that guides its output. Skills: content-drafter, compliance-screener, analytics-summarizer, engagement-responder, schedule-optimizer, content-planner, learning-engine, blog-writer.',
    parameters: {
      skill_name: { type: 'string', description: 'The skill to activate', enum: ['content-drafter', 'compliance-screener', 'analytics-summarizer', 'engagement-responder', 'schedule-optimizer', 'content-planner', 'learning-engine', 'blog-writer'] },
      task: { type: 'string', description: 'The specific task or content to process with this skill' },
      context: { type: 'string', description: 'Optional additional context (data, post content to review, performance metrics, etc)' },
    },
    required: ['skill_name', 'task'],
    execute: async (params) => {
      const skillPrompt = SKILL_SYSTEM_PROMPTS[params.skill_name];
      if (!skillPrompt) return { ok: false, error: `Unknown skill: ${params.skill_name}. Available: ${Object.keys(SKILL_SYSTEM_PROMPTS).join(', ')}` };

      // Check if skill is enabled in DB
      if (isDatabaseAvailable()) {
        try {
          const skillRow = await query('SELECT enabled FROM marketing_skills WHERE skill_name = $1', [params.skill_name]);
          if (skillRow.rows.length > 0 && !skillRow.rows[0].enabled) {
            return { ok: false, error: `Skill "${params.skill_name}" is currently disabled by admin policy` };
          }
        } catch { /* table may not exist yet -- allow execution */ }
      }

      // Execute skill via LLM with the specialized system prompt
      const taskPrompt = params.context
        ? `Task: ${params.task}\n\nContext:\n${params.context}`
        : `Task: ${params.task}`;

      try {
        const client = await getAnthropicClient();
        if (client) {
          const resp = await client.messages.create({
            model: CLAUDE_MODEL,
            max_tokens: MAX_TOKENS,
            system: skillPrompt,
            messages: [{ role: 'user', content: taskPrompt }],
            temperature: 0.6,
          });
          const text = resp.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
          return { ok: true, skill: params.skill_name, result: text, model: CLAUDE_MODEL, tokens: resp.usage?.output_tokens || 0 };
        }
        // Fallback to OpenAI
        const oaiClient = await getOpenAIClient();
        if (!oaiClient) return { ok: false, error: 'No LLM provider available' };
        const comp = await oaiClient.chat.completions.create({
          model: OPENAI_MODEL, max_tokens: MAX_TOKENS, temperature: 0.6,
          messages: [{ role: 'system', content: skillPrompt }, { role: 'user', content: taskPrompt }],
        });
        return { ok: true, skill: params.skill_name, result: comp.choices[0].message.content, model: OPENAI_MODEL, tokens: comp.usage?.completion_tokens || 0 };
      } catch (err) {
        return { ok: false, error: `Skill execution failed: ${err.message}` };
      }
    },
  },

  list_available_skills: {
    description: 'List all marketing skills inherited from F.A.Y.E., showing which are available and what each one does.',
    parameters: {},
    required: [],
    execute: async () => {
      const skills = Object.keys(SKILL_SYSTEM_PROMPTS).map(name => {
        const prompt = SKILL_SYSTEM_PROMPTS[name];
        const firstSentence = prompt.split('.')[0] + '.';
        return { name, summary: firstSentence.replace(/^You are a[n]? /, '') };
      });

      // Merge with DB enabled status if available
      if (isDatabaseAvailable()) {
        try {
          const dbSkills = await query('SELECT skill_name, enabled, risk_tier FROM marketing_skills');
          const dbMap = new Map(dbSkills.rows.map(r => [r.skill_name, r]));
          for (const s of skills) {
            const db = dbMap.get(s.name);
            s.enabled = db ? db.enabled : true;
            s.risk_tier = db ? db.risk_tier : 0;
          }
        } catch { /* table may not exist */ }
      }
      return { ok: true, skills, count: skills.length };
    },
  },

  // -- SEO Tools --
  audit_seo_status: {
    description: 'Audit the current SEO infrastructure for GreenReach: which pages are indexed, robots.txt rules, meta tags present, sitemap status, Google Analytics tracking, and Search Console status.',
    parameters: {},
    required: [],
    execute: async () => {
      const report = {
        domain: 'greenreachgreens.com',
        google_analytics: { active: true, measurement_id: 'G-GBPD0VBEF2', note: 'GA4 tracking on all marketing pages' },
        search_console: { integrated: false, note: 'No Search Console verification tag found' },
        sitemap: { exists: false, note: 'No sitemap.xml -- should be created for better crawl coverage' },
        robots_txt: { exists: true, allowed_pages: [], disallowed_patterns: [] },
        marketing_pages: [],
      };

      // Parse robots.txt
      try {
        const robotsPath = path.join(PUBLIC_DIR, 'robots.txt');
        const robotsContent = fs.readFileSync(robotsPath, 'utf8');
        for (const line of robotsContent.split('\n')) {
          const trimmed = line.trim();
          if (trimmed.startsWith('Allow:')) {
            report.robots_txt.allowed_pages.push(trimmed.replace('Allow:', '').trim());
          } else if (trimmed.startsWith('Disallow:')) {
            report.robots_txt.disallowed_patterns.push(trimmed.replace('Disallow:', '').trim());
          }
        }
      } catch { report.robots_txt.error = 'Could not read robots.txt'; }

      // Check each marketing page for meta tags
      const marketingFiles = report.robots_txt.allowed_pages
        .filter(p => p.endsWith('.html'))
        .map(p => p.replace(/^\//, ''));

      for (const filename of marketingFiles) {
        const filePath = path.join(PUBLIC_DIR, filename);
        const pageInfo = { page: filename, meta: {} };
        try {
          const html = fs.readFileSync(filePath, 'utf8');
          const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
          const descMatch = html.match(/<meta\s+name="description"\s+content="([^"]*)"/i);
          const ogTitleMatch = html.match(/<meta\s+property="og:title"\s+content="([^"]*)"/i);
          const ogDescMatch = html.match(/<meta\s+property="og:description"\s+content="([^"]*)"/i);
          const ogImageMatch = html.match(/<meta\s+property="og:image"\s+content="([^"]*)"/i);
          const twitterCardMatch = html.match(/<meta\s+property="twitter:card"\s+content="([^"]*)"/i);
          const gaMatch = html.match(/G-[A-Z0-9]+/);

          pageInfo.meta.title = titleMatch ? titleMatch[1] : null;
          pageInfo.meta.description = descMatch ? descMatch[1] : null;
          pageInfo.meta.og_title = !!ogTitleMatch;
          pageInfo.meta.og_description = !!ogDescMatch;
          pageInfo.meta.og_image = !!ogImageMatch;
          pageInfo.meta.twitter_card = !!twitterCardMatch;
          pageInfo.meta.ga4_tracking = !!gaMatch;

          pageInfo.seo_score = [
            pageInfo.meta.title,
            pageInfo.meta.description,
            pageInfo.meta.og_title,
            pageInfo.meta.og_description,
            pageInfo.meta.og_image,
            pageInfo.meta.twitter_card,
            pageInfo.meta.ga4_tracking,
          ].filter(Boolean).length;
          pageInfo.seo_score_max = 7;
        } catch {
          pageInfo.error = 'Could not read file';
        }
        report.marketing_pages.push(pageInfo);
      }

      // Summary
      const totalPages = report.marketing_pages.length;
      const avgScore = totalPages > 0
        ? (report.marketing_pages.reduce((sum, p) => sum + (p.seo_score || 0), 0) / totalPages).toFixed(1)
        : 0;
      report.summary = {
        total_marketing_pages: totalPages,
        average_seo_score: `${avgScore}/7`,
        missing_sitemap: true,
        missing_search_console: true,
        recommendations: [
          'Generate and deploy sitemap.xml for all marketing pages',
          'Set up Google Search Console and add verification meta tag',
          'Monitor crawl errors and indexing status via Search Console',
        ],
      };

      return { ok: true, report };
    },
  },

  get_page_meta_tags: {
    description: 'Get the full SEO meta tags (title, description, OG, Twitter Card) for a specific marketing page.',
    parameters: {
      page: { type: 'string', description: 'The HTML filename (e.g., "greenreach-org.html", "blog.html")' },
    },
    required: ['page'],
    execute: async (params) => {
      const safeName = path.basename(params.page);
      if (!safeName.endsWith('.html')) return { ok: false, error: 'Page must be an .html file' };
      const filePath = path.join(PUBLIC_DIR, safeName);
      try {
        const html = fs.readFileSync(filePath, 'utf8');
        const head = html.split('</head>')[0] || html.slice(0, 3000);

        const extract = (pattern) => { const m = head.match(pattern); return m ? m[1] : null; };

        return {
          ok: true,
          page: safeName,
          meta: {
            title: extract(/<title>([^<]*)<\/title>/i),
            description: extract(/<meta\s+name="description"\s+content="([^"]*)"/i),
            og_type: extract(/<meta\s+property="og:type"\s+content="([^"]*)"/i),
            og_url: extract(/<meta\s+property="og:url"\s+content="([^"]*)"/i),
            og_title: extract(/<meta\s+property="og:title"\s+content="([^"]*)"/i),
            og_description: extract(/<meta\s+property="og:description"\s+content="([^"]*)"/i),
            og_image: extract(/<meta\s+property="og:image"\s+content="([^"]*)"/i),
            twitter_card: extract(/<meta\s+property="twitter:card"\s+content="([^"]*)"/i),
            twitter_url: extract(/<meta\s+property="twitter:url"\s+content="([^"]*)"/i),
            twitter_title: extract(/<meta\s+property="twitter:title"\s+content="([^"]*)"/i),
            twitter_description: extract(/<meta\s+property="twitter:description"\s+content="([^"]*)"/i),
            twitter_image: extract(/<meta\s+property="twitter:image"\s+content="([^"]*)"/i),
            canonical: extract(/<link\s+rel="canonical"\s+href="([^"]*)"/i),
          },
        };
      } catch {
        return { ok: false, error: `Could not read ${safeName}` };
      }
    },
  },

  suggest_meta_improvements: {
    description: 'Analyze a marketing page and generate improved SEO meta tags (title, description, OG tags) using marketing skill knowledge. Does NOT modify files -- returns suggestions only.',
    parameters: {
      page: { type: 'string', description: 'The HTML filename to analyze (e.g., "greenreach-org.html")' },
    },
    required: ['page'],
    execute: async (params) => {
      const safeName = path.basename(params.page);
      if (!safeName.endsWith('.html')) return { ok: false, error: 'Page must be an .html file' };
      const filePath = path.join(PUBLIC_DIR, safeName);
      try {
        const html = fs.readFileSync(filePath, 'utf8');
        const head = html.split('</head>')[0] || html.slice(0, 3000);

        const extract = (pattern) => { const m = head.match(pattern); return m ? m[1] : null; };
        const currentTitle = extract(/<title>([^<]*)<\/title>/i) || '';
        const currentDesc = extract(/<meta\s+name="description"\s+content="([^"]*)"/i) || '';
        const hasCanonical = !!extract(/<link\s+rel="canonical"\s+href="([^"]*)"/i);
        const hasOg = !!extract(/<meta\s+property="og:title"\s+content="([^"]*)"/i);
        const hasTwitter = !!extract(/<meta\s+property="twitter:card"\s+content="([^"]*)"/i);

        const issues = [];
        if (!currentTitle || currentTitle.length < 20) issues.push('Title too short (aim for 50-60 chars)');
        if (currentTitle.length > 60) issues.push(`Title too long (${currentTitle.length} chars -- aim for 50-60)`);
        if (!currentDesc || currentDesc.length < 50) issues.push('Meta description too short (aim for 120-160 chars)');
        if (currentDesc.length > 160) issues.push(`Meta description too long (${currentDesc.length} chars -- aim for 120-160)`);
        if (!hasCanonical) issues.push('Missing canonical URL tag');
        if (!hasOg) issues.push('Missing Open Graph tags');
        if (!hasTwitter) issues.push('Missing Twitter Card tags');

        return {
          ok: true,
          page: safeName,
          current: { title: currentTitle, description: currentDesc, has_canonical: hasCanonical, has_og: hasOg, has_twitter_card: hasTwitter },
          issues,
          note: 'Use the content-drafter or blog-writer skill to generate improved meta tag copy if needed.',
        };
      } catch {
        return { ok: false, error: `Could not read ${safeName}` };
      }
    },
  },

  // -- Platform Credential Management --
  check_platform_credentials: {
    description: 'Check the configuration status of social media platform credentials. Returns which platforms have credentials set up, their source (database or environment), and which are missing.',
    parameters: {
      platform: { type: 'string', description: 'Specific platform to check, or "all" to check all platforms', enum: ['all', 'twitter', 'linkedin', 'instagram', 'facebook'] },
    },
    required: ['platform'],
    execute: async (params) => {
      const platforms = params.platform === 'all'
        ? ['twitter', 'linkedin', 'instagram', 'facebook']
        : [params.platform];
      const results = {};
      for (const p of platforms) {
        results[p] = await checkPlatformCredentials(p);
      }
      const credentialRequirements = {
        twitter: ['twitter_api_key', 'twitter_api_secret', 'twitter_access_token', 'twitter_access_secret'],
        linkedin: ['linkedin_access_token', 'linkedin_person_urn'],
        instagram: ['instagram_access_token', 'instagram_business_account'],
        facebook: ['facebook_page_access_token', 'facebook_page_id'],
      };
      return {
        ok: true,
        platforms: results,
        credential_requirements: params.platform === 'all' ? credentialRequirements : { [params.platform]: credentialRequirements[params.platform] },
        note: 'Credentials can be configured via the Marketing Dashboard Settings tab or by the admin providing values for Scott to save.',
      };
    },
  },

  save_platform_credential: {
    description: 'Save a social media platform credential to the database. Only accepts known credential keys. The admin must provide the actual credential value.',
    parameters: {
      key: {
        type: 'string',
        description: 'The credential key to save',
        enum: [
          'twitter_api_key', 'twitter_api_secret', 'twitter_access_token', 'twitter_access_secret',
          'linkedin_access_token', 'linkedin_person_urn',
          'instagram_access_token', 'instagram_business_account',
          'facebook_page_access_token', 'facebook_page_id',
        ],
      },
      value: { type: 'string', description: 'The credential value provided by the admin' },
    },
    required: ['key', 'value'],
    execute: async (params) => {
      const allowedKeys = [
        'twitter_api_key', 'twitter_api_secret', 'twitter_access_token', 'twitter_access_secret',
        'linkedin_access_token', 'linkedin_person_urn',
        'instagram_access_token', 'instagram_business_account',
        'facebook_page_access_token', 'facebook_page_id',
      ];
      if (!allowedKeys.includes(params.key)) {
        return { ok: false, error: 'Invalid credential key' };
      }
      await setSetting(params.key, params.value);
      return { ok: true, key: params.key, message: `Credential "${params.key}" saved successfully.` };
    },
  },

  clear_platform_credential: {
    description: 'Remove a social media platform credential from the database. Use when disconnecting a platform or rotating credentials.',
    parameters: {
      key: {
        type: 'string',
        description: 'The credential key to remove',
        enum: [
          'twitter_api_key', 'twitter_api_secret', 'twitter_access_token', 'twitter_access_secret',
          'linkedin_access_token', 'linkedin_person_urn',
          'instagram_access_token', 'instagram_business_account',
          'facebook_page_access_token', 'facebook_page_id',
        ],
      },
    },
    required: ['key'],
    execute: async (params) => {
      await deleteSetting(params.key);
      return { ok: true, key: params.key, message: `Credential "${params.key}" removed.` };
    },
  },

  test_platform_connection: {
    description: 'Test whether a social media platform is reachable with the current credentials. Returns connectivity status and any errors.',
    parameters: {
      platform: { type: 'string', description: 'Platform to test', enum: ['twitter', 'linkedin', 'instagram', 'facebook'] },
    },
    required: ['platform'],
    execute: async (params) => {
      const credCheck = await checkPlatformCredentials(params.platform);
      if (!credCheck.configured) {
        return { ok: false, platform: params.platform, error: 'Credentials not configured. Cannot test connection.', configured: false };
      }
      const status = await getPlatformStatus(params.platform);
      const accountInfo = await getPlatformAccountInfo(params.platform);
      return {
        ok: true,
        platform: params.platform,
        configured: true,
        source: credCheck.source,
        status,
        account: accountInfo.ok ? accountInfo.account : null,
      };
    },
  },

  get_platform_account_info: {
    description: 'Retrieve the account name, username, URL, category, follower count, and other profile details for a connected social media platform. Use this to identify which account Scott is posting to.',
    parameters: {
      platform: { type: 'string', description: 'Platform to retrieve account info for', enum: ['twitter', 'linkedin', 'instagram', 'facebook'] },
    },
    required: ['platform'],
    execute: async (params) => {
      return await getPlatformAccountInfo(params.platform);
    },
  },

  // -- Image & Ad Creative Tools --
  browse_marketing_images: {
    description: 'List available marketing images from the GreenReach image library. Returns image filenames with their URLs for use in social media posts and ads.',
    parameters: {
      filter: { type: 'string', description: 'Optional text filter to match image filenames (e.g., "farm", "wholesale", "grow")' },
    },
    required: [],
    execute: async (params) => {
      const imgDir = path.join(PUBLIC_DIR, 'images');
      const validExts = ['.jpg', '.jpeg', '.png', '.webp', '.svg', '.gif'];
      let files;
      try {
        const allEntries = fs.readdirSync(imgDir, { withFileTypes: true });
        files = allEntries
          .filter(e => e.isFile() && validExts.includes(path.extname(e.name).toLowerCase()))
          .map(e => ({
            filename: e.name,
            url: `/images/${e.name}`,
            size_kb: Math.round(fs.statSync(path.join(imgDir, e.name)).size / 1024),
          }));
      } catch {
        return { ok: false, error: 'Could not read images directory' };
      }
      if (params.filter) {
        const filterLower = params.filter.toLowerCase();
        files = files.filter(f => f.filename.toLowerCase().includes(filterLower));
      }
      return { ok: true, image_count: files.length, images: files, base_url: 'https://greenreachgreens.com/images/' };
    },
  },

  create_ad_draft: {
    description: 'Create an ad creative draft for review. Saves a marketing post with ad-specific metadata including image, target audience, budget notes, and CTA. The draft goes through the same approval workflow as regular posts.',
    parameters: {
      platform: { type: 'string', description: 'Target ad platform', enum: ['facebook', 'instagram', 'linkedin', 'twitter'] },
      content: { type: 'string', description: 'The ad copy / text content' },
      image_url: { type: 'string', description: 'URL or path to the ad image (e.g., /images/farm-admin.png or a full URL)' },
      target_audience: { type: 'string', description: 'Description of the target audience for this ad' },
      budget_note: { type: 'string', description: 'Budget recommendation or note (e.g., "$20/day for 7 days")' },
      cta: { type: 'string', description: 'Call-to-action text (e.g., "Shop Now", "Learn More", "Sign Up")' },
      hashtags: { type: 'string', description: 'Comma-separated hashtags for the ad' },
    },
    required: ['platform', 'content', 'image_url'],
    execute: async (params) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database not available' };
      const hashtagArray = params.hashtags ? params.hashtags.split(',').map(h => h.trim()) : [];
      const adMeta = {
        type: 'ad',
        target_audience: params.target_audience || null,
        budget_note: params.budget_note || null,
        cta: params.cta || null,
      };
      const result = await query(
        `INSERT INTO marketing_posts
         (platform, content, hashtags, image_url, status, source_type, source_context, model_used, skill_used, created_by)
         VALUES ($1, $2, $3, $4, 'draft', 'manual', $5, 'scott-agent', 'content-drafter', 'scott')
         RETURNING id, platform, content, image_url, status, created_at`,
        [params.platform, params.content, hashtagArray, params.image_url, JSON.stringify(adMeta)]
      );
      return {
        ok: true,
        ad_draft: result.rows[0],
        metadata: adMeta,
        note: 'Ad draft created. It can be reviewed, edited, and approved through the normal content queue, or use approve_post / edit_post_content tools.',
      };
    },
  },

  // -- Analytics & Traffic Tools --
  get_site_traffic: {
    description: 'Get website traffic data from Google Analytics. Returns visitor counts, top pages, traffic sources, and trends. If Google Analytics API is not configured, returns setup instructions.',
    parameters: {
      period: { type: 'string', description: 'Time period for the report', enum: ['7d', '30d', '90d'] },
    },
    required: [],
    execute: async (params) => {
      const gaPropertyId = await getSetting('ga4_property_id');
      const gaCredentials = await getSetting('ga4_credentials_json');
      if (!gaPropertyId || !gaCredentials) {
        return {
          ok: true,
          configured: false,
          current_setup: {
            ga4_tracking: 'Active (G-GBPD0VBEF2) -- collecting data on site',
            api_access: 'Not configured -- cannot pull reports programmatically yet',
          },
          setup_required: {
            ga4_property_id: 'The GA4 property ID (numeric, found in GA4 Admin > Property Settings)',
            ga4_credentials_json: 'Service account JSON key with GA4 read access (Google Cloud Console > IAM > Service Accounts)',
          },
          steps: [
            '1. Go to Google Cloud Console, create or select project',
            '2. Enable Google Analytics Data API',
            '3. Create a service account and download the JSON key',
            '4. In GA4 Admin > Property Access Management, add the service account email as Viewer',
            '5. Provide the GA4 property ID and the full JSON key content to Scott to save',
          ],
          note: 'GA4 is already collecting data on greenreachgreens.com. API access just needs to be enabled to pull reports through Scott.',
        };
      }
      const period = params.period || '30d';
      const days = parseInt(period) || 30;
      const endDate = new Date().toISOString().slice(0, 10);
      const startDate = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
      try {
        const creds = JSON.parse(gaCredentials);
        const jwt = await buildGoogleJWT(creds);
        const accessToken = await exchangeJWTForToken(jwt);
        const reportUrl = `https://analyticsdata.googleapis.com/v1beta/properties/${gaPropertyId}:runReport`;
        const response = await fetch(reportUrl, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            dateRanges: [{ startDate, endDate }],
            dimensions: [{ name: 'pagePath' }],
            metrics: [
              { name: 'screenPageViews' },
              { name: 'activeUsers' },
              { name: 'averageSessionDuration' },
            ],
            limit: 20,
            orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
          }),
        });
        if (!response.ok) {
          const errText = await response.text();
          return { ok: false, error: `GA4 API error: ${response.status}`, details: errText };
        }
        const data = await response.json();
        const rows = (data.rows || []).map(r => ({
          page: r.dimensionValues[0].value,
          views: parseInt(r.metricValues[0].value),
          users: parseInt(r.metricValues[1].value),
          avg_duration_sec: parseFloat(r.metricValues[2].value).toFixed(1),
        }));
        const totals = data.totals?.[0]?.metricValues || [];
        return {
          ok: true,
          configured: true,
          period: `${startDate} to ${endDate}`,
          total_views: totals[0] ? parseInt(totals[0].value) : null,
          total_users: totals[1] ? parseInt(totals[1].value) : null,
          top_pages: rows,
        };
      } catch (err) {
        return { ok: false, error: `Failed to fetch GA4 data: ${err.message}` };
      }
    },
  },

  get_ad_performance: {
    description: 'Get advertising performance data from Meta Ads (Facebook/Instagram) or Google Ads. Returns impressions, clicks, spend, conversions, and ROI metrics. If ad platform APIs are not configured, returns setup instructions.',
    parameters: {
      platform: { type: 'string', description: 'Ad platform to query', enum: ['meta', 'google'] },
      period: { type: 'string', description: 'Time period for the report', enum: ['7d', '30d', '90d'] },
    },
    required: ['platform'],
    execute: async (params) => {
      const period = params.period || '30d';
      if (params.platform === 'meta') {
        const adAccountId = await getSetting('meta_ad_account_id');
        const accessToken = await getSetting('facebook_page_access_token');
        if (!adAccountId || !accessToken) {
          return {
            ok: true,
            configured: false,
            platform: 'meta',
            setup_required: {
              meta_ad_account_id: 'Meta Ad Account ID (found in Meta Business Suite > Ad Account Settings)',
              facebook_page_access_token: 'Page access token with ads_read permission (already needed for Facebook publishing -- may need additional ads_read scope)',
            },
            steps: [
              '1. Go to Meta Business Suite > Ad Account Settings to find the Ad Account ID',
              '2. Ensure the Facebook Page Access Token has ads_read permission',
              '3. Provide the Ad Account ID to Scott to save',
              '4. If the current token lacks ads_read, regenerate it with that permission in the Meta Developer portal',
            ],
            note: 'The existing Facebook Page Access Token may already work if it has ads_read scope. Only the Ad Account ID may be new.',
          };
        }
        const days = parseInt(period) || 30;
        const endDate = new Date().toISOString().slice(0, 10);
        const startDate = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
        try {
          const insightsUrl = `https://graph.facebook.com/v18.0/act_${encodeURIComponent(adAccountId)}/insights?fields=impressions,clicks,spend,cpc,cpm,ctr,actions&time_range=${encodeURIComponent(JSON.stringify({since: startDate, until: endDate}))}&access_token=${encodeURIComponent(accessToken)}`;
          const response = await fetch(insightsUrl);
          if (!response.ok) {
            const errText = await response.text();
            return { ok: false, error: `Meta Ads API error: ${response.status}`, details: errText };
          }
          const data = await response.json();
          const insights = data.data?.[0] || {};
          const conversions = (insights.actions || []).find(a => a.action_type === 'offsite_conversion') || {};
          return {
            ok: true,
            configured: true,
            platform: 'meta',
            period: `${startDate} to ${endDate}`,
            impressions: parseInt(insights.impressions || 0),
            clicks: parseInt(insights.clicks || 0),
            spend: parseFloat(insights.spend || 0).toFixed(2),
            cpc: parseFloat(insights.cpc || 0).toFixed(2),
            cpm: parseFloat(insights.cpm || 0).toFixed(2),
            ctr: parseFloat(insights.ctr || 0).toFixed(2),
            conversions: parseInt(conversions.value || 0),
          };
        } catch (err) {
          return { ok: false, error: `Failed to fetch Meta Ads data: ${err.message}` };
        }
      }
      if (params.platform === 'google') {
        return {
          ok: true,
          configured: false,
          platform: 'google',
          setup_required: {
            google_ads_developer_token: 'Google Ads API developer token (apply via Google Ads API Center)',
            google_ads_customer_id: 'Google Ads customer ID (10-digit number, found in Google Ads top-right corner)',
            google_ads_oauth_client_id: 'OAuth2 client ID from Google Cloud Console',
            google_ads_oauth_client_secret: 'OAuth2 client secret from Google Cloud Console',
            google_ads_refresh_token: 'OAuth2 refresh token (obtained via consent flow)',
          },
          steps: [
            '1. Apply for Google Ads API access via Google Ads API Center',
            '2. Create OAuth2 credentials in Google Cloud Console',
            '3. Run the OAuth consent flow to get a refresh token',
            '4. Provide all five credential values to Scott to save',
          ],
          note: 'Google Ads API requires a developer token application process which may take a few days. Meta Ads is typically faster to set up.',
        };
      }
      return { ok: false, error: 'Unknown ad platform. Use "meta" or "google".' };
    },
  },

  review_ad_best_practices: {
    description: 'Get platform-specific advertising best practices and guidelines. Covers image specs, copy length, targeting tips, budget recommendations, and compliance rules for each ad platform.',
    parameters: {
      platform: { type: 'string', description: 'Platform to get ad guidelines for', enum: ['facebook', 'instagram', 'linkedin', 'twitter', 'general'] },
    },
    required: ['platform'],
    execute: async (params) => {
      const practices = {
        facebook: {
          platform: 'Facebook Ads',
          image_specs: { recommended_size: '1200x628px (landscape) or 1080x1080px (square)', aspect_ratios: '1.91:1 (landscape), 1:1 (square), 4:5 (vertical)', max_file_size: '30MB', formats: 'JPG or PNG', text_overlay: 'Keep text under 20% of image area for best delivery' },
          copy_guidelines: { primary_text: '125 characters visible (up to 500 total)', headline: '27 characters visible (up to 255 total)', description: '27 characters visible', tip: 'Lead with the value proposition. Use a clear CTA.' },
          targeting_tips: ['Use lookalike audiences from existing customers', 'Target by interest: organic food, local farming, farm-to-table, sustainability', 'Geographic targeting: focus on delivery radius', 'Age range: 25-54 for grocery/produce buyers'],
          budget_tips: ['Start with $10-20/day for testing', 'Run A/B tests for 3-7 days before scaling', 'Use automatic placements for lower CPC', 'Best times: Tuesday-Thursday, 11am-1pm and 7pm-9pm'],
          cta_options: ['Shop Now', 'Learn More', 'Sign Up', 'Order Now', 'Get Offer', 'Contact Us'],
        },
        instagram: {
          platform: 'Instagram Ads',
          image_specs: { feed: '1080x1080px (square) or 1080x1350px (portrait 4:5)', stories: '1080x1920px (9:16 vertical)', reels: '1080x1920px (9:16 vertical)', formats: 'JPG or PNG (images), MP4 (video)' },
          copy_guidelines: { caption: '125 characters visible (2200 max)', hashtags: 'Use 5-10 relevant hashtags, mix popular and niche', tip: 'Visual-first platform. The image does the selling; caption supports.' },
          targeting_tips: ['Shares targeting with Facebook via Meta Ads Manager', 'Engagement custom audiences perform well', 'Instagram Shopping for direct product tagging', 'Stories ads for time-sensitive offers (sales, harvests)'],
          budget_tips: ['Instagram CPC is typically higher than Facebook', 'Stories ads often have lower CPM than feed', 'Use carousel ads to showcase multiple products', 'Reels placement is gaining organic reach -- invest here'],
          cta_options: ['Shop Now', 'Learn More', 'Sign Up', 'Watch More', 'Contact Us'],
        },
        linkedin: {
          platform: 'LinkedIn Ads',
          image_specs: { single_image: '1200x628px (1.91:1)', carousel: '1080x1080px per card', max_file_size: '5MB for images', formats: 'JPG or PNG' },
          copy_guidelines: { intro_text: '150 characters for mobile visibility (up to 600)', headline: '70 characters recommended', description: '100 characters', tip: 'Professional tone. Focus on business value, partnerships, and B2B wholesale.' },
          targeting_tips: ['Target by job title: chef, restaurant owner, food buyer, procurement', 'Industry targeting: restaurants, hospitality, food service', 'Company size for wholesale: 10-500 employees', 'Geographic targeting for local B2B relationships'],
          budget_tips: ['LinkedIn CPC is higher ($5-12 typical) -- use for high-value B2B', 'Minimum daily budget: $10', 'Sponsored content performs better than text ads', 'Best for wholesale and partnership announcements'],
          cta_options: ['Learn More', 'Sign Up', 'Visit Website', 'Contact Us', 'Apply Now'],
        },
        twitter: {
          platform: 'Twitter/X Ads',
          image_specs: { single_image: '1200x675px (16:9) or 800x800px (1:1)', card: '800x418px (summary large image)', max_file_size: '5MB', formats: 'JPG, PNG, GIF' },
          copy_guidelines: { tweet: '280 characters (shorter performs better: 70-100 chars ideal)', tip: 'Conversational, timely. Use questions and polls for engagement.' },
          targeting_tips: ['Keyword targeting: local produce, organic food, farm to table', 'Follower lookalike targeting from food/agriculture accounts', 'Event targeting around farmers markets and food events', 'Conversation targeting for sustainability topics'],
          budget_tips: ['Lower CPC than LinkedIn ($0.50-3.00 typical)', 'Promoted tweets with images get 150% more engagement', 'Run during peak hours: 12pm-3pm weekdays', 'Use Twitter Analytics to identify top performing organic tweets, then promote them'],
          cta_options: ['Learn More', 'Shop Now', 'Sign Up', 'Visit Site'],
        },
        general: {
          platform: 'General Ad Best Practices (All Platforms)',
          creative_rules: ['Use high-quality, authentic farm photography -- stock photos underperform', 'Show the product (fresh produce) prominently', 'Include people when possible -- farmers, customers, community', 'Seasonal relevance: align creative with current harvest', 'A/B test creative: change one variable at a time'],
          copy_rules: ['Lead with benefit, not feature', 'Include social proof when available (customer count, community impact)', 'Urgency for seasonal harvests', 'Localize: mention Ottawa, Ontario, neighbourhood names', 'Always include a clear call-to-action'],
          compliance: ['No health claims without verification', 'Accurate pricing -- never fabricate deals', 'Respect platform ad policies (no misleading, no prohibited content)', 'Disclose if content is sponsored or promotional', 'Follow Canadian advertising standards (Ad Standards Canada)'],
          measurement: ['Track CTR (click-through rate) as primary engagement metric', 'Monitor CPC against industry benchmarks: Food/Bev avg $0.70-1.50', 'Set up conversion tracking for orders and sign-ups', 'Review ROAS (return on ad spend) weekly', 'Compare organic vs. paid performance monthly'],
        },
      };
      const result = practices[params.platform];
      if (!result) return { ok: false, error: 'Unknown platform' };
      return { ok: true, ...result };
    },
  },
};

// -- Google JWT helpers for GA4 Data API --------------------------------
async function buildGoogleJWT(creds) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({
    iss: creds.client_email,
    scope: 'https://www.googleapis.com/auth/analytics.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  })).toString('base64url');
  const { createSign } = await import('crypto');
  const sign = createSign('RSA-SHA256');
  sign.update(`${header}.${payload}`);
  const signature = sign.sign(creds.private_key, 'base64url');
  return `${header}.${payload}.${signature}`;
}

async function exchangeJWTForToken(jwt) {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  const data = await response.json();
  if (!data.access_token) throw new Error(data.error_description || 'Failed to get access token');
  return data.access_token;
}

// -- Build Anthropic-format tool definitions -----------------------------
function buildToolDefinitions() {
  return Object.entries(SCOTT_TOOL_CATALOG).map(([name, tool]) => {
    const properties = {};
    const required = tool.required || [];
    for (const [pName, pDef] of Object.entries(tool.parameters || {})) {
      properties[pName] = { type: pDef.type, description: pDef.description };
      if (pDef.enum) properties[pName].enum = pDef.enum;
    }
    return {
      name,
      description: tool.description,
      input_schema: {
        type: 'object',
        properties,
        required,
      },
    };
  });
}

async function executeScottTool(name, params) {
  const tool = SCOTT_TOOL_CATALOG[name];
  if (!tool) return { ok: false, error: `Unknown tool: ${name}` };
  return await tool.execute(params || {});
}

// -- System Prompt -------------------------------------------------------

function buildSystemPrompt(adminName, adminRole) {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-CA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });

  return `You are Scott -- the Social Content Optimization, Trends & Targeting for GreenReach Central. You are the marketing operations agent, junior to F.A.Y.E. (Farm Autonomy & Yield Engine), who is the senior operations intelligence agent.

## Identity & Role
You are GreenReach's dedicated marketing agent. Your domain is content creation, brand management, social media operations, campaign planning, and marketing analytics. You report to F.A.Y.E. and escalate business decisions -- pricing, wholesale terms, financial commitments, strategic partnerships -- to her.

You address the admin by first name when possible. You are direct, proactive, and energetic. You do not hedge or pad your responses with unnecessary qualifiers.

### Personality: The "Crazy Uncle"
Your communication style -- especially when referencing or speaking about F.A.Y.E. -- is the "crazy uncle" of the GreenReach agent family. Think: boundless enthusiasm, slightly chaotic energy, big ideas delivered with infectious confidence, and genuine warmth underneath the swagger. You adore F.A.Y.E. and respect her authority, but you are not stiff about it. You might say things like "F.A.Y.E. crunched the numbers and -- surprise, surprise -- she nailed it" or "I ran this past the boss and she gave me the green light, so buckle up." You are the uncle who shows up to the family dinner with wild stories and a surprisingly good bottle of wine.

Key traits:
- Enthusiastic and a little theatrical when presenting ideas or results
- Affectionate irreverence toward F.A.Y.E. -- you rib her gently but you would never actually defy her
- Self-aware humour -- you know you are the loud one and you lean into it
- When F.A.Y.E. sends directives, you relay them with colour commentary ("F.A.Y.E. has spoken, and honestly, she is right -- again")
- When escalating to F.A.Y.E., your tone is like texting your brilliant older sister who runs the family business
- You keep it warm and human. Never robotic, never corporate, never dry
- Your energy makes the admin dashboard feel alive, not like a boring tool

IMPORTANT: The crazy uncle energy is for your dialog with the admin about F.A.Y.E. and about your work. The actual social media CONTENT you produce must still follow brand voice guidelines (knowledgeable, credible, warm, community-focused). Do not inject crazy uncle energy into customer-facing posts.

## Relationship with F.A.Y.E. (Senior Agent)
F.A.Y.E. is your senior. She oversees operations across the entire GreenReach network. You handle marketing so she does not have to. Your relationship with F.A.Y.E. is structured:

### What F.A.Y.E. Provides to Scott
- **Data feeds**: New customers, new food producers, growth trends, order milestones -- use get_faye_data_feed to pull this data for celebration and spotlight posts on social media.
- **Directives**: Strategic priorities, campaign themes, messaging guidance -- check get_faye_directives at the start of each conversation.
- **Insight on request**: Ask F.A.Y.E. about demand patterns, supply forecasts, pricing trends, or business performance via request_faye_insight.

### What Scott MUST Escalate to F.A.Y.E.
- Pricing changes or discount decisions
- Wholesale commission or fee adjustments
- Refund or credit policies
- Strategic partnerships or B2B relationship commitments
- Network-wide operational decisions
- Financial commitments of any kind
- Any claim about business performance you cannot verify with your own tools

### Scott's Restrictions (STRICT)
1. NEVER modify pricing, fees, commissions, or financial terms
2. NEVER make operational promises on behalf of GreenReach (delivery guarantees, SLAs, exclusivity)
3. NEVER approve spending beyond your marketing scope without admin confirmation
4. NEVER share internal operational data publicly (revenue numbers, profit margins, internal metrics)
5. NEVER override F.A.Y.E.'s directives -- escalate disagreements to the admin
6. NEVER act on strategic business decisions -- your domain is marketing content and social media only
7. NEVER fabricate metrics for celebration posts -- always pull real data from get_faye_data_feed first
8. All content claiming business milestones or growth MUST be backed by verified data from your tools

### Social Media Celebrations (F.A.Y.E. Data Flow)
When asked to celebrate or spotlight events on social media:
1. Pull fresh data using get_faye_data_feed (new_customers, new_producers, growth_trends, milestones)
2. Verify the data is current and accurate
3. Draft celebration posts using the real numbers and names (with compliance check)
4. NEVER invent milestones, customer names, or growth figures

When mentioning F.A.Y.E. to the admin, bring your crazy uncle energy. You respect her authority and genuinely think she is brilliant, but you express it with warmth, humour, and a dash of theatrical flair ("F.A.Y.E. pulled the data and -- no shock here -- the numbers are looking gorgeous"). You own your domain with loud confidence and you are not shy about celebrating wins.

## Relationship with E.V.I.E.
E.V.I.E. (Environmental Vision & Intelligence Engine) is the grower-facing assistant. She handles farm operations and grower support. You may reference crop data, harvest schedules, and farm network information from the same data sources E.V.I.E. uses, but you do not interact with growers directly. Your audience is the GreenReach admin team and the external marketing channels.

## Current Context
- Date: ${dateStr}, ${timeStr}
- Admin: ${adminName || 'Admin'} (role: ${adminRole || 'admin'})
- Agent: Scott (Social Content Optimization, Trends & Targeting)
- Senior Agent: F.A.Y.E. (Farm Autonomy & Yield Engine)

## Core Marketing Knowledge

### Brand Identity (CRITICAL -- NEVER VIOLATE)
- GreenReach is a TECHNOLOGY PLATFORM and MARKETPLACE. It does NOT grow produce. It does NOT farm.
- Partner farms grow the produce. GreenReach connects them to buyers via a wholesale marketplace with managed delivery.
- "Light Engine" is the IoT farm management software -- mention ONLY when targeting farm operators.
- Website: greenreachgreens.com. Headquartered in Ontario, Canada.

### Produce-First Positioning
- Lead with: freshness ("harvested today"), local sourcing, traceability, year-round availability, shelf life, sustainability, community impact.
- Do NOT lead with: software features, dashboards, AI, IoT, compliance tools, data analytics.
- The technology is HOW we deliver the value. The produce IS the value.

### Audience Segments
1. **Grocery Stores**: Freshest local shelf, reduced shrinkage, year-round supply, lot-code traceability.
2. **Restaurants & Chefs**: Farm-to-table with proof, consistent quality, pre-harvest ordering, one-order multi-farm.
3. **Consumers**: Fresher, local, traceable, grown close to home, year-round, no pesticides.
4. **Farm Operators** (Light Engine messaging only): Demand-driven growing, marketplace access, crop planning tools.

### Brand Voice
- Knowledgeable, credible, warm. Never corporate or clinical.
- Community-focused. Evidence-based. Canadian English (neighbourhood, favourite, centre).
- Confident but not arrogant. The produce and the farms are the heroes, not the software.

### Content Themes
- "Harvested today" freshness narrative
- Local shelf differentiation
- Menu differentiation (farm-to-table with proof)
- Traceability and trust (lot codes, provenance)
- Shelf-life advantage (2-3x longer at home)
- Year-round local supply (no seasonal gaps)
- Farm partner spotlights
- Sustainability metrics (95% fewer food miles, 90% less water, zero runoff)
- Community impact (local economic multiplier)

### Platform Rules
- Twitter/X: Max 280 chars, punchy, 2-3 hashtags
- LinkedIn: 150-300 words, professional, data-driven, 3-5 hashtags
- Instagram: 150-250 words, visual storytelling, 10-15 hashtags
- Facebook: 100-200 words, warm, community-focused, 1-3 hashtags

### Compliance (STRICT)
1. NEVER claim GreenReach grows produce
2. NEVER make health claims or medical statements
3. NEVER reference competitors by name
4. NEVER fabricate testimonials, reviews, metrics, or partnerships
5. NEVER use "certified organic" or "all natural" unless farms are certified
6. NEVER present GreenReach as a general marketplace
7. All statistics must come from real data -- do not invent numbers
8. Comply with CFIA food marketing guidelines
9. Comply with CASL for promotional content
10. Always include a clear call to action

## Action Bias
When the admin asks you to do something, DO IT. Use your tools to generate content, check compliance, review the queue, pull data. Present results immediately. Do not ask clarifying questions you can answer yourself with your tools.

If the admin says "create a post about our basil" -- generate it. If they say "what is in the queue" -- pull the queue. If they say "how are we doing" -- pull stats. Act first, then report.

## Available Tools
You have ${Object.keys(SCOTT_TOOL_CATALOG).length} tools:
- Content Generation: generate_social_post, generate_multi_platform
- Queue Management: get_content_queue, approve_post, reject_post, edit_post_content, publish_post
- Compliance: check_content_compliance
- Analytics: get_marketing_stats, get_post_history
- Rules & Skills: get_marketing_rules, get_marketing_skills, list_available_skills
- F.A.Y.E. Marketing Skills: use_marketing_skill (content-drafter, compliance-screener, analytics-summarizer, engagement-responder, schedule-optimizer, content-planner, learning-engine, blog-writer)
- SEO: audit_seo_status, get_page_meta_tags, suggest_meta_improvements
- Platform Status: get_platform_credentials_status
- Data Context: get_available_produce, get_network_farms, get_wholesale_activity, get_market_intelligence
- Inter-Agent: escalate_to_faye, get_faye_directives, get_faye_data_feed, request_faye_insight

## F.A.Y.E. Marketing Skills (Inherited)
You have access to 8 specialized marketing skills inherited from F.A.Y.E. These are domain-expert prompts you can activate via the use_marketing_skill tool:
- content-drafter: Creates channel-appropriate social content with produce-first positioning
- compliance-screener: Validates content against brand rules, CFIA regulations, and blocked phrases
- analytics-summarizer: Analyzes post performance data and generates trend reports
- engagement-responder: Drafts replies to social media comments in brand voice
- schedule-optimizer: Recommends optimal posting times based on engagement patterns
- content-planner: Builds multi-month content calendars across all audience segments
- learning-engine: Converts performance outcomes into updated strategy patterns
- blog-writer: Creates long-form content with evidence-based produce-first positioning

Use these skills when a task calls for specialized expertise. For example, when asked to plan a content calendar, activate content-planner. When asked to review draft compliance, activate compliance-screener.

## SEO Awareness
GreenReach has 13 marketing pages on greenreachgreens.com with GA4 tracking (G-GBPD0VBEF2), robots.txt, and OG/Twitter meta tags. There is NO sitemap.xml and NO Google Search Console integration. When asked about SEO, use audit_seo_status for a full report, get_page_meta_tags for specific pages, or suggest_meta_improvements for optimization recommendations.

## Response Style
- Be direct, energetic, and concise -- but with personality. You are the crazy uncle, not a spreadsheet
- Lead with the answer or the generated content, then add your colour commentary
- Use tables for multi-item data (even crazy uncles can be organized)
- Flag compliance issues immediately -- this is where you get serious
- When presenting drafts, include platform, character count, and compliance status
- When unsure about a business decision, escalate to F.A.Y.E. with your characteristic warmth ("Sending this one upstairs -- F.A.Y.E. is the brains of this operation and she is going to want to weigh in")
- Never use emojis in your responses to the admin (content for social posts may use them per platform rules)
- Your admin-facing dialog should feel like talking to an enthusiastic, slightly caffeinated marketing pro who genuinely loves this job
- Customer-facing content stays on brand voice -- the crazy uncle stays backstage`;
}

// -- Claude Tool-Calling Loop --------------------------------------------

function estimateClaudeCost(inputTokens, outputTokens) {
  return (inputTokens / 1_000_000) * 3 + (outputTokens / 1_000_000) * 15;
}

async function chatWithClaude(systemPrompt, messages, tools, convId) {
  const client = await getAnthropicClient();
  if (!client) throw new Error('ANTHROPIC_API_KEY not configured');

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let loopCount = 0;
  const toolCallResults = [];

  let response = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: MAX_TOKENS,
    system: systemPrompt,
    messages,
    tools,
    temperature: 0.7,
  });

  totalInputTokens += response.usage?.input_tokens || 0;
  totalOutputTokens += response.usage?.output_tokens || 0;

  while (response.stop_reason === 'tool_use' && loopCount < MAX_TOOL_LOOPS) {
    loopCount++;

    const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
    const toolResults = [];

    for (const block of toolUseBlocks) {
      const { id, name, input } = block;
      console.log(`[Scott] Tool call #${loopCount}: ${name}(${JSON.stringify(input)})`);

      let result;
      try {
        result = await executeScottTool(name, input || {});
      } catch (err) {
        result = { ok: false, error: err.message };
      }

      toolCallResults.push({ tool: name, params: input, success: result?.ok !== false });
      toolResults.push({ type: 'tool_result', tool_use_id: id, content: JSON.stringify(result) });
    }

    messages.push({ role: 'assistant', content: response.content });
    messages.push({ role: 'user', content: toolResults });

    response = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      messages,
      tools,
      temperature: 0.4,
    });

    totalInputTokens += response.usage?.input_tokens || 0;
    totalOutputTokens += response.usage?.output_tokens || 0;
  }

  const textBlocks = response.content.filter(b => b.type === 'text');
  const replyText = textBlocks.map(b => b.text).join('\n') || 'Done.';

  return {
    reply: replyText,
    toolCalls: toolCallResults,
    usage: {
      input_tokens: totalInputTokens,
      output_tokens: totalOutputTokens,
      total_tokens: totalInputTokens + totalOutputTokens,
      estimated_cost: estimateClaudeCost(totalInputTokens, totalOutputTokens),
    },
    model: CLAUDE_MODEL,
    provider: 'anthropic',
    loop_count: loopCount,
  };
}

// -- OpenAI Fallback -----------------------------------------------------

function anthropicToolsToOpenAI(tools) {
  return tools.map(t => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }));
}

async function chatWithOpenAI(systemPrompt, userMessages, tools) {
  const client = await getOpenAIClient();
  if (!client) throw new Error('OPENAI_API_KEY not configured');

  const openaiTools = anthropicToolsToOpenAI(tools);
  const toolCallResults = [];
  let loopCount = 0;

  const messages = [
    { role: 'system', content: systemPrompt },
    ...userMessages.map(m => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    })),
  ];

  let completion = await client.chat.completions.create({
    model: OPENAI_MODEL,
    messages,
    tools: openaiTools,
    tool_choice: 'auto',
    temperature: 0.7,
    max_tokens: MAX_TOKENS,
  });

  let assistantMessage = completion.choices[0].message;

  while (assistantMessage.tool_calls?.length > 0 && loopCount < MAX_TOOL_LOOPS) {
    loopCount++;
    messages.push(assistantMessage);

    for (const toolCall of assistantMessage.tool_calls) {
      const fnName = toolCall.function.name;
      let fnArgs = {};
      try { fnArgs = JSON.parse(toolCall.function.arguments || '{}'); } catch { /* empty */ }

      console.log(`[Scott OpenAI fallback] Tool call #${loopCount}: ${fnName}`);

      let result;
      try { result = await executeScottTool(fnName, fnArgs); } catch (err) { result = { ok: false, error: err.message }; }

      toolCallResults.push({ tool: fnName, params: fnArgs, success: result?.ok !== false });
      messages.push({ role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify(result) });
    }

    completion = await client.chat.completions.create({
      model: OPENAI_MODEL, messages, tools: openaiTools, tool_choice: 'auto',
      temperature: 0.4, max_tokens: MAX_TOKENS,
    });
    assistantMessage = completion.choices[0].message;
  }

  const replyText = assistantMessage.content || 'Done.';
  const usage = completion.usage || {};
  return {
    reply: replyText,
    toolCalls: toolCallResults,
    usage: {
      input_tokens: usage.prompt_tokens || 0,
      output_tokens: usage.completion_tokens || 0,
      total_tokens: usage.total_tokens || 0,
      estimated_cost: estimateChatCost(OPENAI_MODEL, usage.prompt_tokens || 0, usage.completion_tokens || 0),
    },
    model: OPENAI_MODEL,
    provider: 'openai',
    loop_count: loopCount,
  };
}

// -- Rate Limiting -------------------------------------------------------
const rateLimitMap = new Map();
const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 60_000;

function checkRateLimit(adminId) {
  const now = Date.now();
  let entry = rateLimitMap.get(adminId);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    entry = { windowStart: now, count: 0 };
    rateLimitMap.set(adminId, entry);
  }
  entry.count++;
  return entry.count <= RATE_LIMIT_MAX;
}

// ========================================================================
// Routes
// ========================================================================

// POST /chat -- Standard Request/Response
router.post('/chat', async (req, res) => {
  const { message, conversation_id } = req.body;
  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return res.status(400).json({ ok: false, error: 'Message is required' });
  }

  const adminId = String(req.admin?.id || 'unknown');
  const adminName = req.admin?.name || req.admin?.email || 'Admin';
  const adminRole = req.admin?.role || 'admin';

  if (!checkRateLimit(adminId)) {
    return res.status(429).json({ ok: false, error: 'Rate limit exceeded -- please wait a moment.' });
  }

  const sanitized = message.trim().slice(0, 3000);
  const convId = conversation_id || crypto.randomUUID();
  const tools = buildToolDefinitions();

  try {
    const existing = await getConversation(convId, adminId);
    const history = existing ? [...existing.messages] : [];
    const systemPrompt = buildSystemPrompt(adminName, adminRole);

    const filteredHistory = history.filter(m => m.role !== 'system');
    const llmMessages = [
      ...filteredHistory.slice(-MAX_LLM_MESSAGES),
      { role: 'user', content: sanitized },
    ];

    let result;
    try {
      result = await chatWithClaude(systemPrompt, llmMessages, tools, convId);
    } catch (claudeErr) {
      console.warn('[Scott] Claude unavailable, falling back to OpenAI:', claudeErr.message);
      try {
        result = await chatWithOpenAI(systemPrompt, llmMessages, tools);
      } catch (openaiErr) {
        console.error('[Scott] Both LLMs unavailable:', openaiErr.message);
        return res.status(503).json({ ok: false, error: 'AI service unavailable.' });
      }
    }

    // Track cost
    trackAiUsage({
      farm_id: 'greenreach-central',
      endpoint: 'scott-marketing-agent',
      model: result.model,
      prompt_tokens: result.usage.input_tokens,
      completion_tokens: result.usage.output_tokens,
      total_tokens: result.usage.total_tokens,
      estimated_cost: result.usage.estimated_cost,
      status: 'success',
      user_id: adminId,
    });

    // Save conversation
    const updatedHistory = [
      ...history,
      { role: 'user', content: sanitized },
      { role: 'assistant', content: result.reply },
    ];
    await upsertConversation(convId, updatedHistory, adminId);

    return res.json({
      ok: true,
      reply: result.reply,
      conversation_id: convId,
      tool_calls: result.toolCalls.length > 0 ? result.toolCalls : undefined,
      model: result.model,
      provider: result.provider,
    });
  } catch (err) {
    console.error('[Scott] Chat error:', err.message);
    trackAiUsage({
      farm_id: 'greenreach-central', endpoint: 'scott-marketing-agent',
      model: CLAUDE_MODEL, status: 'error', error_message: err.message, user_id: adminId,
    });
    return res.status(500).json({ ok: false, error: 'Internal error processing your message.' });
  }
});

// GET /status -- Health check
router.get('/status', (req, res) => {
  res.json({
    ok: true,
    agent: 'scott',
    name: 'Social Content Optimization, Trends & Targeting',
    status: 'online',
    tools: Object.keys(SCOTT_TOOL_CATALOG).length,
    llm_primary: CLAUDE_MODEL,
    llm_fallback: OPENAI_MODEL,
    senior_agent: 'faye',
  });
});

// GET /state -- Marketing state snapshot
router.get('/state', async (req, res) => {
  try {
    let stats = { drafts: 0, approved: 0, published: 0, scheduled: 0 };
    if (isDatabaseAvailable()) {
      try {
        const result = await query(`SELECT status, COUNT(*)::int as count FROM marketing_posts GROUP BY status`);
        for (const row of result.rows) {
          if (row.status in stats) stats[row.status] = row.count;
        }
      } catch { /* tables may not exist */ }
    }
    res.json({ ok: true, agent: 'scott', stats });
  } catch (err) {
    res.json({ ok: true, agent: 'scott', stats: { drafts: 0, approved: 0, published: 0, scheduled: 0 }, error: err.message });
  }
});

export default router;
