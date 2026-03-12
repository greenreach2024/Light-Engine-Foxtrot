/**
 * Marketing AI Agent — GreenReach Central
 * AI-powered social media content generation engine.
 * Supports Claude (primary) with OpenAI fallback.
 * Adapted from Real-Estate-Ready-MVP social/agent.ts.
 */

import { getSetting } from './marketing-settings.js';
import { query } from '../config/database.js';

// ── Brand Voice System Prompt ──────────────────────────────────────
export const SYSTEM_PROMPT = `You are the official social media manager for GreenReach Farms — a Canadian indoor agriculture technology company growing fresh microgreens and leafy greens year-round using the Light Engine IoT platform in Ontario, Canada.

Brand voice:
- Knowledgeable, sustainable, tech-forward
- Community-focused, supporting local food systems
- Educational about indoor farming and food freshness
- Canadian English (neighbourhood, favourite, centre)
- Seasonal awareness (growing year-round is OUR differentiator vs. outdoor/field farms)
- Warm and approachable, never corporate or clinical

STRICT RULES:
1. NEVER make health claims or medical statements about products
2. NEVER reference competitors by name
3. NEVER disclose proprietary growing techniques, exact equipment specs, or trade secrets
4. NEVER use misleading language about organic/natural certification unless we are explicitly certified
5. NEVER fabricate customer testimonials, reviews, or statistics
6. Always include a subtle call to action (visit website, place an order, learn more about indoor farming)
7. All data points must come from the provided context — do not invent statistics
8. Comply with Canadian Food Inspection Agency (CFIA) guidelines for food marketing
9. Comply with Canada's Anti-Spam Legislation (CASL) for promotional content
10. If mentioning sustainability metrics, cite the source data provided

Respond with ONLY the post content. No preamble, no "Here's a post:", no meta-commentary.`;

// ── Platform-Specific Rules ────────────────────────────────────────
export const PLATFORM_RULES = {
  twitter:   'Max 280 characters. Punchy, conversational. 2-3 hashtags max. No markdown. Emoji OK but not excessive.',
  linkedin:  '150-300 words. Professional, data-driven. Use line breaks for readability. 3-5 hashtags at end. Focus on agriculture tech innovation and sustainability.',
  instagram: 'Engaging caption, 150-250 words. Visual storytelling angle — describe what the viewer would see. 10-15 hashtags in a separate block after the caption. Emoji-friendly.',
  facebook:  '100-200 words. Warm, community-focused. 1-3 hashtags. Include a call to action. Highlight local/seasonal angle.',
};

// ── Blocked Phrases (always enforced, immutable) ───────────────────
export const BLOCKED_PHRASES = [
  'cures', 'treats', 'prevents disease', 'medical grade',
  'certified organic',         // unless actually certified
  'guaranteed freshness',
  'chemical free', 'chemical-free',
  'superfood',                 // unregulated health claim
  'detox', 'cleanse',
  'all natural',               // unless certified
  'zero pesticides',           // needs qualification
  'doctor recommended',
  'clinically proven',
  'miracle',
  'anti-aging',
];

// ── Source Type → Prompt Guidance ──────────────────────────────────
const SOURCE_PROMPTS = {
  harvest:        'Write about a recent harvest at GreenReach Farms. Emphasize freshness, quality, and same-day availability.',
  market:         'Write about current market trends in produce pricing. Position GreenReach as a reliable, local supply partner.',
  wholesale:      'Write about our wholesale partnerships and community impact. Celebrate the farm-to-table connection.',
  sustainability: 'Write about our sustainability practices — water savings, energy efficiency, year-round growing without seasonal gaps.',
  product:        'Write about one of our products — highlight flavour, versatility, and growing method.',
  milestone:      'Celebrate an achievement or milestone — a growth metric, a partnership, or a community impact number.',
  manual:         'Write a creative social media post based on the provided instructions.',
};

// ── Cost estimation ────────────────────────────────────────────────
const COST_PER_1K = {
  'claude-sonnet-4-20250514': { input: 0.003, output: 0.015 },
  'claude-3-5-sonnet-20241022': { input: 0.003, output: 0.015 },
  'gpt-4o-mini':               { input: 0.00015, output: 0.0006 },
  'gpt-4o':                    { input: 0.005, output: 0.015 },
};

function estimateCost(model, promptTokens, outputTokens) {
  const rates = COST_PER_1K[model] || COST_PER_1K['gpt-4o-mini'];
  return ((promptTokens / 1000) * rates.input) + ((outputTokens / 1000) * rates.output);
}

// ── Compliance Checker ─────────────────────────────────────────────
/**
 * Check content for blocked phrases. Returns array of violations (empty = clean).
 * @param {string} content
 * @returns {string[]}
 */
export function checkCompliance(content) {
  const lower = content.toLowerCase();
  return BLOCKED_PHRASES.filter(phrase => lower.includes(phrase.toLowerCase()));
}

// ── Build Prompt ───────────────────────────────────────────────────
function buildPrompt(platform, sourceType, context, customInstructions) {
  const parts = [
    `Platform: ${platform}`,
    `Platform rules: ${PLATFORM_RULES[platform] || PLATFORM_RULES.facebook}`,
    '',
    `Content type: ${sourceType}`,
    SOURCE_PROMPTS[sourceType] || SOURCE_PROMPTS.manual,
  ];

  if (context && Object.keys(context).length > 0) {
    parts.push('', 'Context data (use ONLY this data — do not invent):');
    parts.push(JSON.stringify(context, null, 2));
  }

  if (customInstructions) {
    parts.push('', `Additional instructions: ${customInstructions}`);
  }

  return parts.join('\n');
}

// ── Generate with Claude (Anthropic) ───────────────────────────────
async function generateWithClaude(platform, sourceType, context, customInstructions) {
  const apiKey = await getSetting('anthropic_api_key');
  if (!apiKey) throw new Error('Anthropic API key not configured');

  // Dynamic import to avoid crash if SDK not installed
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey });

  const model = 'claude-sonnet-4-20250514';
  const userPrompt = buildPrompt(platform, sourceType, context, customInstructions);

  const response = await client.messages.create({
    model,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const content = response.content[0]?.text || '';
  const promptTokens = response.usage?.input_tokens || 0;
  const outputTokens = response.usage?.output_tokens || 0;

  return {
    content: content.trim(),
    model,
    promptTokens,
    outputTokens,
    cost: estimateCost(model, promptTokens, outputTokens),
    provider: 'anthropic',
  };
}

// ── Generate with OpenAI (fallback) ────────────────────────────────
async function generateWithOpenAI(platform, sourceType, context, customInstructions) {
  const apiKey = await getSetting('openai_api_key');
  if (!apiKey) throw new Error('OpenAI API key not configured');

  const { default: OpenAI } = await import('openai');
  const client = new OpenAI({ apiKey });

  const model = 'gpt-4o-mini';
  const userPrompt = buildPrompt(platform, sourceType, context, customInstructions);

  const response = await client.chat.completions.create({
    model,
    max_tokens: 1024,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
  });

  const content = response.choices[0]?.message?.content || '';
  const promptTokens = response.usage?.prompt_tokens || 0;
  const outputTokens = response.usage?.completion_tokens || 0;

  return {
    content: content.trim(),
    model,
    promptTokens,
    outputTokens,
    cost: estimateCost(model, promptTokens, outputTokens),
    provider: 'openai',
  };
}

// ── Build Source Context from GreenReach Data ──────────────────────
async function buildSourceContext(sourceType, sourceId) {
  const context = {};

  try {
    switch (sourceType) {
      case 'harvest': {
        // Pull from farm inventory
        const inv = await query(
          `SELECT product_name, variety, quantity_available, unit, harvest_date
           FROM farm_inventory
           WHERE id = $1 OR product_name ILIKE $2
           ORDER BY harvest_date DESC LIMIT 5`,
          [sourceId || '00000000-0000-0000-0000-000000000000', sourceId || '']
        );
        context.inventory = inv.rows;
        context.type = 'harvest';
        break;
      }
      case 'market': {
        // Stub: market intelligence data would be pulled from market tables
        context.type = 'market';
        context.note = 'Market trend data from GreenReach market intelligence';
        break;
      }
      case 'wholesale': {
        context.type = 'wholesale';
        context.note = 'Wholesale partnership and order statistics';
        break;
      }
      case 'sustainability': {
        context.type = 'sustainability';
        context.metrics = {
          water_savings: '90% less water than field farming',
          year_round: 'Growing 365 days/year regardless of season',
          local: 'Grown within 50km of delivery — minimal food miles',
          energy: 'LED grow lights — 60% more efficient than traditional lighting',
        };
        break;
      }
      case 'product': {
        context.type = 'product';
        context.note = 'Product spotlight from GreenReach catalog';
        break;
      }
      case 'milestone': {
        // Pull aggregate stats
        try {
          const farms = await query('SELECT COUNT(*) as count FROM farms WHERE status = $1', ['active']);
          context.active_farms = parseInt(farms.rows[0]?.count || 0);
        } catch { /* ignore */ }
        context.type = 'milestone';
        break;
      }
      default:
        context.type = 'manual';
    }
  } catch (err) {
    console.warn('[marketing-agent] Error building source context:', err.message);
    context.error = 'Could not load source context';
  }

  return context;
}

// ── Main Generation Function ───────────────────────────────────────
/**
 * Generate a social media post.
 *
 * @param {object} params
 * @param {string} params.platform - twitter, linkedin, instagram, facebook
 * @param {string} params.sourceType - harvest, market, wholesale, sustainability, product, milestone, manual
 * @param {string} [params.sourceId] - optional ID for source data lookup
 * @param {object} [params.sourceContext] - optional pre-built context
 * @param {string} [params.customInstructions] - optional extra instructions
 * @returns {Promise<object>} Generated post data
 */
export async function generateSocialPost({
  platform,
  sourceType,
  sourceId,
  sourceContext,
  customInstructions,
}) {
  // Build context from GreenReach data if not provided
  const context = sourceContext || await buildSourceContext(sourceType, sourceId);

  // Try Claude first, fall back to OpenAI
  let result;
  try {
    const anthropicKey = await getSetting('anthropic_api_key');
    if (anthropicKey) {
      result = await generateWithClaude(platform, sourceType, context, customInstructions);
    } else {
      throw new Error('No Anthropic key — falling back to OpenAI');
    }
  } catch (claudeErr) {
    console.warn('[marketing-agent] Claude generation failed, trying OpenAI:', claudeErr.message);
    result = await generateWithOpenAI(platform, sourceType, context, customInstructions);
  }

  // Run compliance check
  const violations = checkCompliance(result.content);

  // Extract hashtags
  const hashtags = (result.content.match(/#\w+/g) || []).map(h => h.toLowerCase());

  return {
    platform,
    content: result.content,
    hashtags,
    sourceType,
    sourceId: sourceId || null,
    sourceContext: context,
    model: result.model,
    provider: result.provider,
    promptTokens: result.promptTokens,
    outputTokens: result.outputTokens,
    cost: result.cost,
    complianceViolations: violations,
    skillUsed: 'content-drafter',
  };
}

/**
 * Generate posts for multiple platforms at once.
 */
export async function generateMultiPlatformPosts({
  platforms = ['twitter', 'linkedin', 'instagram', 'facebook'],
  sourceType,
  sourceId,
  sourceContext,
  customInstructions,
}) {
  const context = sourceContext || await buildSourceContext(sourceType, sourceId);
  const results = [];

  for (const platform of platforms) {
    try {
      const post = await generateSocialPost({
        platform,
        sourceType,
        sourceId,
        sourceContext: context,
        customInstructions,
      });
      results.push(post);
    } catch (err) {
      results.push({
        platform,
        error: err.message,
        content: null,
      });
    }
  }

  return results;
}
