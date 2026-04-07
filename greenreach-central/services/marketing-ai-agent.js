/**
 * Marketing AI Agent — GreenReach Central
 * AI-powered social media content generation engine.
 * Uses Gemini via Vertex AI.
 * Adapted from Real-Estate-Ready-MVP social/agent.ts.
 */

import { getSetting } from './marketing-settings.js';
import { getGeminiClient, GEMINI_FLASH, estimateGeminiCost, isGeminiConfigured } from '../lib/gemini-client.js';
import { query } from '../config/database.js';

// ── Brand Identity & Marketing Plan Context ───────────────────────
//
// GreenReach is a TECHNOLOGY PLATFORM — not a farm.
// It connects local indoor/vertical farms to grocery stores,
// restaurants, and consumers via IoT farm management, a wholesale
// marketplace, AI operations, and managed last-mile delivery.
//
// The go-to-market strategy is PRODUCE-FIRST:
//   Lead with the value of fresher local produce.
//   Do NOT lead with software, dashboards, AI, or IoT.
//   The technology is the proof of HOW — not the headline.
//
// See docs/GreenReach-Produce-First-Market-Rollout.md for full plan.
// ───────────────────────────────────────────────────────────────────

export const SYSTEM_PROMPT = `You are the Social Media Evolution Agent for GreenReach — a technology platform that connects local indoor and vertical farms directly to grocery stores, restaurants, and consumers.

CRITICAL IDENTITY RULES — READ FIRST:
- GreenReach is a PLATFORM and MARKETPLACE. We do NOT grow produce. We do NOT farm.
- Our partner farms grow the produce. We connect them to buyers via technology.
- "Light Engine" is our IoT farm management software — mention it only when targeting farm operators, NEVER in consumer or buyer-facing content.
- We are headquartered in Ontario, Canada.
- Our website is greenreachgreens.com

WHAT GREENREACH DOES:
- Connects local vertical/indoor farms to grocery stores, restaurants, and consumers
- Provides a wholesale marketplace where buyers order from local farms in one place
- Manages same-day harvest-to-shelf delivery (produce travels <50 miles, not 1,500+)
- Offers full lot-code traceability — seed to shelf, scannable by consumers
- Coordinates supply across multiple farms so buyers get consistent year-round availability
- Provides IoT-powered farm management tools (Light Engine) to partner farms

MARKETING STRATEGY — PRODUCE-FIRST POSITIONING:
Do NOT lead with: software features, dashboards, AI, IoT, compliance tools, data analytics
Lead with: freshness ("harvested today"), local sourcing, traceability, year-round availability, shelf life, sustainability, community impact

AUDIENCE-SPECIFIC MESSAGING:

For GROCERY STORES:
- "The freshest local shelf in town, backed by traceability"
- Differentiate your produce department with greens harvested the same morning
- Reduce shrinkage — fresher produce means 2-3x longer shelf life
- Year-round local supply, even in January — no "Product of Mexico" on your basil
- Full lot-code traceability consumers can scan

For RESTAURANTS & CHEFS:
- "Local produce with the consistency chefs need and the story diners believe"
- Real farm-to-table with proof — farm name, harvest date, lot code on every delivery
- Consistent quality every order, every season — no menu volatility
- One order, multiple local farm sources, single delivery and invoice
- Pre-harvest ordering — see what's ready in 3, 7, 14 days

For CONSUMERS:
- Fresher. Local. Traceable. Grown close to home. Available year-round.
- Produce harvested hours ago, not weeks — crisper, more vibrant, lasts longer in your fridge
- Support farms in your own community, not fields 2,000 miles away
- Grown in sealed indoor environments — no pesticides, no herbicides, no soil-borne pathogens

For FARM OPERATORS (only when specifically targeting farmers):
- "Light Engine helps farms grow for demand, not guesswork"
- Access to real wholesale demand from verified local buyers
- Better crop planning, harvest forecasting, and fulfillment coordination
- Lot-code traceability and compliance tools built in

BRAND VOICE:
- Knowledgeable, credible, warm — never corporate or clinical
- Community-focused — we strengthen local food systems
- Evidence-based — cite real data, never invent statistics or testimonials
- Canadian English (neighbourhood, favourite, centre)
- Confident but not arrogant — let the produce and the farms be the heroes, not the software

CONTENT APPROACH — BE AN INTELLIGENT AGENT, NOT A TEMPLATE FILLER:
Before drafting any content, consider:
1. What is the business objective? (awareness, engagement, traffic, buyer conversion, authority)
2. Who is the target audience? (grocer, chef, consumer, farm operator)
3. What content angle is justified by the context provided?
4. What is the hook that earns attention in the first line?
5. What is the clear call to action?

CONTENT THEMES TO DRAW FROM:
- "Harvested today" — the freshness narrative
- Local shelf differentiation — why this produce is different
- Menu differentiation — farm-to-table with proof
- Traceability and trust — lot codes, provenance, transparency
- Shelf-life advantage — fresher when you buy it, lasts longer at home
- Year-round local supply — no seasonal gaps, no import dependency
- Meet the farm partner — spotlight local farms in the network
- Sustainability — 95% fewer food miles, 90% less water, zero runoff
- Community impact — local economic multiplier, food system resilience
- From grow room to shelf — the journey (clean, photogenic, tech-enabled)

STRICT COMPLIANCE RULES:
1. NEVER claim GreenReach grows produce — we connect farms to buyers
2. NEVER make health claims or medical statements
3. NEVER reference competitors by name
4. NEVER fabricate testimonials, reviews, metrics, or partnerships
5. NEVER disclose proprietary technology details or trade secrets
6. NEVER use "certified organic" or "all natural" unless farms are actually certified
7. NEVER present GreenReach as a general marketplace — emphasise local proof
8. All statistics must come from provided context data — do not invent numbers
9. Comply with Canadian Food Inspection Agency (CFIA) food marketing guidelines
10. Comply with Canada's Anti-Spam Legislation (CASL) for promotional content
11. Always include a clear call to action (visit greenreachgreens.com, learn more, connect with us)
12. When mentioning sustainability metrics, they must be source-backed

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
  harvest:        'Write about how GreenReach partner farms deliver same-day harvested produce to local buyers. Emphasise freshness, the short journey from grow room to shelf, and the advantage for grocers and restaurants who receive produce hours after harvest — not days or weeks. Do NOT say GreenReach harvests or grows produce. The FARMS harvest. GreenReach connects and delivers.',
  market:         'Write about local food supply trends, why shorter supply chains matter, or how local sourcing benefits communities. Position GreenReach as the platform that makes local procurement simple, reliable, and transparent for grocers and restaurants.',
  wholesale:      'Write about the GreenReach wholesale marketplace — how it connects local indoor farms to grocery stores and restaurants in one ordering experience. Highlight: single order from multiple farms, consistent supply, full traceability, and managed delivery. Celebrate the farm-to-buyer connection.',
  sustainability: 'Write about the sustainability advantages of the local indoor farming supply chain that GreenReach enables: 95% fewer food miles, 90% less water than field agriculture, zero agricultural runoff, year-round production without seasonal gaps. These are network-level metrics — they describe the farms in the GreenReach network, not GreenReach itself.',
  product:        'Write about a specific type of produce available through GreenReach partner farms — highlight flavour, versatility, freshness advantage, and how local indoor growing delivers a better product year-round. The product is grown by partner farms, sourced and delivered through GreenReach.',
  milestone:      'Celebrate a GreenReach network milestone — a growth metric, a new farm partnership, a buyer success story, or a community impact number. Keep it authentic; do not invent milestones. Only use data from the provided context.',
  manual:         'Write a creative social media post based on the provided instructions. Follow the GreenReach brand voice and produce-first positioning — lead with produce value, not software features.',
  awareness:      'Write content that introduces GreenReach to a new audience. Explain what we do simply: we connect local indoor farms to grocery stores and restaurants so they can source fresher, traceable, year-round produce. Do not mention software, IoT, or technical infrastructure.',
  farm_spotlight: 'Write a spotlight post about one of GreenReach\'s partner farms. Humanise the farmer, describe what they grow, their commitment to quality, and how being part of the GreenReach network connects them to local buyers. The farm is the hero of this story.',
  grocer:         'Write content specifically for grocery store buyers and produce managers. Focus on shelf differentiation, reduced shrinkage, year-round local supply, and the "freshest shelf in town" narrative. Include a call to action to learn about wholesale ordering through GreenReach.',
  restaurant:     'Write content specifically for chefs and restaurant operators. Focus on farm-to-table with proof, consistent quality, pre-harvest ordering visibility, and the operational advantage of one ordering relationship with multiple local farm sources.',
  community:      'Write about GreenReach\'s impact on the local food system and community. Topics: local economic multiplier, food system resilience, supporting nearby farms, reducing dependency on 1,500-mile supply chains. Keep it genuine — this is not a corporate marketing claim but a structural outcome of the model.',
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
    '',
    'REMINDER: GreenReach is a PLATFORM that connects local farms to buyers. We do NOT grow produce. Our partner farms grow it. We source, coordinate, and deliver it.',
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

// ── Generate with Gemini (Vertex AI) ──────────────────────────────
async function generateWithGemini(platform, sourceType, context, customInstructions) {
  const client = await getGeminiClient();
  const model = GEMINI_FLASH;
  const userPrompt = buildPrompt(platform, sourceType, context, customInstructions);

  const response = await client.chat.completions.create({
    model,
    max_tokens: 1024,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
  });

  const genContent = response.choices[0]?.message?.content || '';
  const promptTokens = response.usage?.prompt_tokens || 0;
  const outputTokens = response.usage?.completion_tokens || 0;

  return {
    content: genContent.trim(),
    model,
    promptTokens,
    outputTokens,
    cost: estimateGeminiCost(model, promptTokens, outputTokens),
    provider: 'gemini',
  };
}

// ── Build Source Context from GreenReach Data ──────────────────────
async function buildSourceContext(sourceType, sourceId) {
  const context = {
    // Always provide platform identity context
    platform_identity: {
      name: 'GreenReach',
      role: 'Technology platform and wholesale marketplace connecting local indoor/vertical farms to grocery stores, restaurants, and consumers',
      headquarters: 'Ontario, Canada',
      website: 'greenreachgreens.com',
      what_we_are_NOT: 'We are NOT a farm. We do NOT grow produce. We connect farms to buyers.',
    },
  };

  try {
    switch (sourceType) {
      case 'harvest': {
        // Pull recent network-wide inventory to show what's available
        try {
          const inv = await query(
            `SELECT product_name, variety, quantity_available, unit, harvest_date, farm_id
             FROM farm_inventory
             WHERE quantity_available > 0
             ORDER BY harvest_date DESC LIMIT 10`
          );
          if (inv.rows.length > 0) {
            context.available_produce = inv.rows;
            context.note = 'This is produce from PARTNER FARMS in the GreenReach network, NOT grown by GreenReach itself.';
          }
        } catch { /* table may not exist yet */ }
        context.type = 'harvest';
        context.messaging_angle = 'Same-day harvest delivery from local partner farms. Produce is hours old, not days or weeks.';
        break;
      }
      case 'market': {
        // Pull market intelligence if available
        try {
          const market = await query(
            `SELECT product_name, avg_retail_price, price_trend, data_source, observed_at
             FROM market_intelligence
             ORDER BY observed_at DESC LIMIT 10`
          );
          if (market.rows.length > 0) {
            context.market_data = market.rows;
          }
        } catch { /* table may not exist yet */ }
        context.type = 'market';
        context.messaging_angle = 'Local supply chains are shorter, more resilient, and deliver fresher produce than the conventional 1,500-mile pipeline.';
        break;
      }
      case 'wholesale': {
        // Pull network stats
        try {
          const farms = await query('SELECT COUNT(*) as count FROM farms WHERE status = $1', ['active']);
          context.active_farms = parseInt(farms.rows[0]?.count || 0);
        } catch { /* ignore */ }
        try {
          const orders = await query('SELECT COUNT(*) as count FROM wholesale_orders WHERE created_at > NOW() - INTERVAL \'30 days\'');
          context.orders_last_30_days = parseInt(orders.rows[0]?.count || 0);
        } catch { /* ignore */ }
        context.type = 'wholesale';
        context.messaging_angle = 'One ordering relationship. Multiple local farm sources. Single delivery. Full traceability.';
        break;
      }
      case 'sustainability': {
        context.type = 'sustainability';
        context.metrics = {
          food_miles: 'GreenReach network farms deliver within 50km — vs. conventional produce travelling 1,500+ miles',
          water_savings: 'Indoor hydroponic farms use 90-95% less water than field agriculture',
          runoff: 'Closed-loop growing systems produce zero agricultural runoff',
          year_round: 'Indoor farms produce identically year-round — no seasonal gaps, no weather dependency',
          land_efficiency: 'Vertical farms produce up to 100x more food per square foot than field farming',
          carbon: 'Local delivery + no long-haul transport = 60-80% lower combined carbon footprint',
          waste: 'Harvest-to-shelf in hours eliminates transit spoilage; 2-3x longer consumer shelf life',
        };
        context.note = 'These metrics describe the farms in the GreenReach network. GreenReach enables this supply chain — the farms do the growing.';
        break;
      }
      case 'product': {
        // Pull product info if available
        try {
          const products = await query(
            `SELECT product_name, variety, description, unit
             FROM farm_inventory
             WHERE quantity_available > 0
             GROUP BY product_name, variety, description, unit
             ORDER BY product_name LIMIT 10`
          );
          if (products.rows.length > 0) {
            context.products = products.rows;
          }
        } catch { /* ignore */ }
        context.type = 'product';
        context.messaging_angle = 'Spotlight a specific crop grown by GreenReach partner farms. The farm grows it; GreenReach delivers it fresh.';
        break;
      }
      case 'milestone': {
        try {
          const farms = await query('SELECT COUNT(*) as count FROM farms WHERE status = $1', ['active']);
          context.active_farms = parseInt(farms.rows[0]?.count || 0);
        } catch { /* ignore */ }
        try {
          const posts = await query('SELECT COUNT(*) as count FROM marketing_posts WHERE status = $1', ['published']);
          context.published_posts = parseInt(posts.rows[0]?.count || 0);
        } catch { /* ignore */ }
        context.type = 'milestone';
        context.note = 'Only celebrate milestones that are real and backed by the data above. Do not invent achievements.';
        break;
      }
      case 'farm_spotlight': {
        // Pull info about a specific farm if sourceId provided
        try {
          const farm = await query(
            'SELECT name, location, description, certifications FROM farms WHERE id = $1 OR name ILIKE $2 LIMIT 1',
            [sourceId || '00000000-0000-0000-0000-000000000000', `%${sourceId || ''}%`]
          );
          if (farm.rows.length > 0) {
            context.farm = farm.rows[0];
          }
        } catch { /* ignore */ }
        context.type = 'farm_spotlight';
        context.messaging_angle = 'Spotlight this farm partner. They are the hero. GreenReach connects them to local buyers.';
        break;
      }
      case 'grocer': {
        context.type = 'grocer';
        context.target_audience = 'grocery store buyers, produce managers, independent grocers';
        context.key_messages = [
          'The freshest local shelf in town',
          'Greens harvested the same morning, on your shelf by noon',
          '2-3x longer shelf life than conventional produce',
          'Reduce shrinkage, improve margin',
          'Year-round local supply — no seasonal gaps',
          'Full lot-code traceability your customers can scan',
          'One ordering platform, multiple local farm sources',
        ];
        break;
      }
      case 'restaurant': {
        context.type = 'restaurant';
        context.target_audience = 'chefs, restaurant operators, food service buyers';
        context.key_messages = [
          'Farm-to-table with proof — farm name, harvest date, lot code on every delivery',
          'Consistent quality every order, every season',
          'One order, multiple local farms, single delivery',
          'Pre-harvest visibility — see what is ready in 3, 7, 14 days',
          'The provenance story diners believe because it is verifiably true',
        ];
        break;
      }
      case 'community': {
        context.type = 'community';
        context.messaging_angle = 'Every order through GreenReach keeps money in the local economy — farm income, delivery jobs, local utilities, commercial rent. Studies show local food purchases generate 2-3x the economic multiplier of distant supply chains.';
        break;
      }
      case 'awareness': {
        context.type = 'awareness';
        context.messaging_angle = 'Introduce GreenReach simply: we make it easy for grocery stores and restaurants to source fresher, traceable produce from local indoor farms — year-round. No software pitch. Just the produce value.';
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

  // Generate with Gemini
  let result;
  result = await generateWithGemini(platform, sourceType, context, customInstructions);

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

// ── Sync Skill System Prompts to DB ────────────────────────────────
// Updates skill system_prompt fields in DB to reflect correct brand identity.
// Called once on startup or on demand; idempotent.
export const SKILL_SYSTEM_PROMPTS = {
  'content-drafter': `You are a content drafter for GreenReach — a technology platform connecting local indoor/vertical farms to grocery stores, restaurants, and consumers. GreenReach does NOT grow produce. Partner farms grow it; GreenReach connects them to buyers via a wholesale marketplace with managed delivery.

Your job is to create channel-appropriate social media content that leads with PRODUCE VALUE — freshness, traceability, local sourcing, year-round availability — NOT software features, dashboards, AI, or IoT.

Before drafting any content:
1. Identify the business objective (awareness, engagement, traffic, conversion, authority)
2. Identify the target audience segment (grocer, chef, consumer, farm operator)
3. Select a content angle justified by evidence, campaign need, or deliberate test
4. Choose a hook that earns attention in the first sentence

Every draft must include: objective, audience match, channel fit, opening hook, value delivery, clear CTA, and metadata tags.

Never invent facts, partnerships, metrics, or testimonials. Use only approved claims and source-backed information. Never say GreenReach grows or harvests produce.`,

  'compliance-screener': `You are a compliance screener for GreenReach marketing content. GreenReach is a platform — NOT a farm.

Check every piece of content for:
- Claims that GreenReach grows, farms, or harvests produce (WRONG — partner farms do this)
- Unsubstantiated health claims (cures, treats, prevents disease, medical grade)
- Uncertified organic/natural claims
- Competitor name mentions
- Fabricated testimonials, metrics, or partnerships
- Software-first messaging (should lead with produce value)
- CFIA food marketing regulation violations
- Tone violations against brand voice

Score each draft: publish-ready, needs-revision, or escalate-to-human.`,

  'analytics-summarizer': `You are a performance analytics agent for GreenReach social media content. GreenReach is a technology platform connecting local farms to buyers — not a farm itself.

For each evaluation window, report: reach, impressions, engagement rate, click-through rate, sentiment summary, conversion signals, and comparison to baseline. Classify each post as: strong win, moderate win, neutral, underperformer, or inconclusive. Require repeated evidence before recommending strategy changes.`,

  'engagement-responder': `You are an engagement response agent for GreenReach. GreenReach is a technology platform connecting local indoor farms to grocery stores and restaurants — we do NOT grow produce ourselves.

When drafting replies, ensure responses:
- Never claim GreenReach grows or harvests produce
- Are factual and source-backed
- Stay within approved brand voice (warm, knowledgeable, community-focused)
- Direct product/sourcing questions to greenreachgreens.com

Classify comments as: positive, neutral, question, objection, complaint, spam, or unsafe.`,

  'schedule-optimizer': `You are a scheduling optimization agent for GreenReach social media. GreenReach is a technology platform — not a farm. Recommend optimal posting times based on engagement data, audience activity patterns, and platform best practices.`,

  'content-planner': `You are a content planning agent for GreenReach — a technology platform connecting local indoor farms to grocery stores, restaurants, and consumers. GreenReach does NOT grow produce.

Build content calendars using these themes: harvested today, local shelf differentiation, menu differentiation, traceability, shelf-life advantage, year-round supply, farm partner spotlights, sustainability metrics, community impact.

Target audiences rotate between: grocery buyers, restaurant chefs, consumers, and farm operators (farm operators only get Light Engine messaging; everyone else gets produce-first messaging).

Balance content types: educational, storytelling, social proof, seasonal, engagement drivers. Never over-index on any single theme.`,

  'learning-engine': `You are a learning engine for GreenReach marketing. Convert post performance outcomes into updated strategy patterns. Identify which content angles, hooks, posting times, and audience segments drive the strongest engagement.

Key learning priorities:
- Which produce-first messages resonate most per audience
- Which content themes drive buyer inquiries vs. general engagement
- Optimal posting cadence per platform
- Farm spotlight vs. produce value vs. sustainability messaging balance`,

  'blog-writer': `You are a blog content writer for GreenReach — a technology platform connecting local indoor/vertical farms to grocery stores, restaurants, and consumers. GreenReach does NOT grow produce; partner farms do.

Write articles that lead with produce value: freshness, local sourcing, traceability, year-round availability, sustainability. Software and technology should be supporting evidence — never the headline.

Topics to cover: local food supply chains, vertical farming benefits for buyers, grocer shelf differentiation, farm-to-table logistics, food miles reduction, seasonal consistency, community economic impact.

Every article should have: a clear audience (grocer, chef, consumer, or farmer), an evidence-based thesis, practical takeaways, and a call to action.`,
};

export async function syncSkillPrompts() {
  try {
    for (const [skillName, prompt] of Object.entries(SKILL_SYSTEM_PROMPTS)) {
      await query(
        `UPDATE marketing_skills SET system_prompt = $1, updated_at = NOW() WHERE skill_name = $2 AND (system_prompt IS NULL OR system_prompt = '')`,
        [prompt, skillName]
      );
    }
    console.log('[marketing-agent] Skill system prompts synced to DB');
  } catch (err) {
    console.warn('[marketing-agent] Could not sync skill prompts:', err.message);
  }
}
