/**
 * Market Analysis Agent — Phase 2A
 *
 * Daily job: reads recent price observations + trends from DB,
 * sends a batch prompt to GPT-4o-mini for per-crop market outlook,
 * and stores the analysis in `market_ai_analysis`.
 *
 * Designed to be farm-agnostic — market conditions are global.
 * Downstream consumers (demand-forecast, AI Pusher) read from this table.
 */

import { getGeminiClient, GEMINI_FLASH, estimateGeminiCost, isGeminiConfigured } from '../lib/gemini-client.js';
import { getDatabase, isDatabaseAvailable } from '../config/database.js';
import { trackAiUsage, estimateChatCost } from '../lib/ai-usage-tracker.js';
import logger from '../utils/logger.js';

const MODEL = GEMINI_FLASH;

let gemini = null;
async function ensureGemini() {
  if (gemini) return gemini;
  gemini = await getGeminiClient();
  return gemini;
}

if (!isGeminiConfigured()) {
  logger.warn('[MarketAnalyst] No Gemini credentials — AI analysis disabled');
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function ensureTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS market_ai_analysis (
      id              SERIAL PRIMARY KEY,
      product         VARCHAR(100) NOT NULL,
      analysis_date   DATE NOT NULL DEFAULT CURRENT_DATE,
      outlook         VARCHAR(20) DEFAULT 'stable',
      confidence      VARCHAR(10) DEFAULT 'medium',
      price_forecast  NUMERIC(8,2),
      action          VARCHAR(50),
      reasoning       TEXT,
      data_points     INT DEFAULT 0,
      model           VARCHAR(50) DEFAULT 'gpt-4o-mini',
      prompt_tokens   INT DEFAULT 0,
      completion_tokens INT DEFAULT 0,
      estimated_cost  NUMERIC(8,6) DEFAULT 0,
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(product, analysis_date)
    )
  `);
}

/**
 * Build a context block for one crop from recent observations + trend row.
 */
function buildCropContext(product, trend, recentObs) {
  const lines = [`### ${product}`];
  if (trend) {
    lines.push(`Current avg: $${parseFloat(trend.avg_price_cad).toFixed(2)} CAD`);
    if (trend.price_7d_ago) lines.push(`7-day-ago avg: $${parseFloat(trend.price_7d_ago).toFixed(2)}`);
    if (trend.price_30d_ago) lines.push(`30-day-ago avg: $${parseFloat(trend.price_30d_ago).toFixed(2)}`);
    lines.push(`Trend: ${trend.trend} (${parseFloat(trend.trend_percent).toFixed(1)}%)`);
    lines.push(`Observations: ${trend.observation_count}, Retailers: ${trend.retailer_count}`);
  }
  if (recentObs.length > 0) {
    const prices = recentObs.map(o => parseFloat(o.price_cad));
    lines.push(`Recent range: $${Math.min(...prices).toFixed(2)} — $${Math.max(...prices).toFixed(2)}`);
  }
  return lines.join('\n');
}

// ── Core Analysis ───────────────────────────────────────────────────────────

/**
 * Analyze all crops with current observations.
 * Batches crops into a single prompt to keep token costs low.
 */
export async function runMarketAnalysis() {
  if (!isDatabaseAvailable()) {
    logger.warn('[MarketAnalyst] Database not available — skipping');
    return { status: 'skipped', reason: 'no_database' };
  }
  if (!isGeminiConfigured()) {
    logger.warn('[MarketAnalyst] Gemini not configured — skipping');
    return { status: 'skipped', reason: 'no_gemini' };
  }

  const pool = getDatabase();
  await ensureTable(pool);

  // Get all trends
  const { rows: trends } = await pool.query('SELECT * FROM market_price_trends ORDER BY product');
  if (trends.length === 0) {
    logger.info('[MarketAnalyst] No price trends yet — skipping analysis');
    return { status: 'skipped', reason: 'no_data' };
  }

  // Get recent observations (14 days)
  const { rows: recentObs } = await pool.query(`
    SELECT product, retailer, price_cad, observed_at
    FROM market_price_observations
    WHERE observed_at > NOW() - INTERVAL '14 days'
    ORDER BY product, observed_at DESC
  `);

  const obsByProduct = {};
  for (const obs of recentObs) {
    if (!obsByProduct[obs.product]) obsByProduct[obs.product] = [];
    obsByProduct[obs.product].push(obs);
  }

  // Build prompt
  const cropBlocks = trends.map(t =>
    buildCropContext(t.product, t, obsByProduct[t.product] || [])
  );

  const systemPrompt = `You are a produce market analyst for a Canadian indoor farm network. Analyze the price data below and for each crop output a JSON object on its own line with exactly these fields:
- "product": the crop name (must match input exactly)
- "outlook": one of "bullish", "bearish", "stable", or "volatile"
- "confidence": "high" if >20 data points and clear trend, "medium" if 5-20, "low" if <5
- "price_forecast": your best estimate for next-week average price in CAD (number)
- "action": one of "increase_production", "hold", "reduce_price", "opportunistic_sell", "monitor"
- "reasoning": 1-2 sentence explanation

Respond ONLY with one JSON object per line (JSONL), no markdown fences, no extra text.`;

  const userPrompt = `Today's date: ${new Date().toISOString().slice(0, 10)}\n\n${cropBlocks.join('\n\n')}`;

  let completion;
  try {
    const client = await ensureGemini();
    completion = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 2000,
    });
  } catch (err) {
    logger.error('[MarketAnalyst] Gemini call failed:', err.message);
    return { status: 'error', reason: err.message };
  }

  const responseText = completion.choices?.[0]?.message?.content || '';
  const promptTokens = completion.usage?.prompt_tokens || 0;
  const completionTokens = completion.usage?.completion_tokens || 0;

  // Track AI usage
  trackAiUsage({
    farm_id: 'system',
    endpoint: 'market-analysis-agent',
    model: MODEL,
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens,
    estimated_cost: estimateChatCost(MODEL, promptTokens, completionTokens),
    status: 'success',
  });

  // Parse JSONL response
  const analyses = [];
  const lines = responseText.split('\n').filter(l => l.trim());
  for (const line of lines) {
    try {
      const obj = JSON.parse(line.trim());
      if (obj.product) analyses.push(obj);
    } catch {
      // skip malformed lines
    }
  }

  // Upsert into DB
  let stored = 0;
  const costPerCrop = analyses.length > 0
    ? estimateChatCost(MODEL, promptTokens, completionTokens) / analyses.length
    : 0;

  for (const a of analyses) {
    const trend = trends.find(t => t.product === a.product);
    try {
      await pool.query(`
        INSERT INTO market_ai_analysis
          (product, analysis_date, outlook, confidence, price_forecast, action, reasoning, data_points, model, prompt_tokens, completion_tokens, estimated_cost)
        VALUES ($1, CURRENT_DATE, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (product, analysis_date) DO UPDATE SET
          outlook = EXCLUDED.outlook,
          confidence = EXCLUDED.confidence,
          price_forecast = EXCLUDED.price_forecast,
          action = EXCLUDED.action,
          reasoning = EXCLUDED.reasoning,
          data_points = EXCLUDED.data_points,
          model = EXCLUDED.model,
          prompt_tokens = EXCLUDED.prompt_tokens,
          completion_tokens = EXCLUDED.completion_tokens,
          estimated_cost = EXCLUDED.estimated_cost,
          created_at = NOW()
      `, [
        a.product,
        a.outlook || 'stable',
        a.confidence || 'medium',
        a.price_forecast || null,
        a.action || 'monitor',
        a.reasoning || '',
        parseInt(trend?.observation_count) || 0,
        MODEL,
        Math.round(promptTokens / Math.max(analyses.length, 1)),
        Math.round(completionTokens / Math.max(analyses.length, 1)),
        costPerCrop,
      ]);
      stored++;
    } catch (err) {
      logger.warn(`[MarketAnalyst] Failed to store analysis for ${a.product}:`, err.message);
    }
  }

  const summary = {
    status: 'completed',
    analyzed: analyses.length,
    stored,
    tokens: { prompt: promptTokens, completion: completionTokens },
    timestamp: new Date().toISOString(),
  };

  logger.info(`[MarketAnalyst] Analysis complete — ${stored}/${trends.length} crops analyzed`);
  return summary;
}

// ── Read Helpers (for downstream consumers) ─────────────────────────────────

/**
 * Get latest AI analysis for all crops (for demand-forecast endpoint).
 */
export async function getLatestAnalyses(pool) {
  try {
    const { rows } = await pool.query(`
      SELECT DISTINCT ON (product)
        product, outlook, confidence, price_forecast, action, reasoning,
        data_points, analysis_date
      FROM market_ai_analysis
      ORDER BY product, analysis_date DESC
    `);
    return rows;
  } catch {
    return [];
  }
}

/**
 * Get AI analysis for a specific crop.
 */
export async function getCropAnalysis(pool, product) {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM market_ai_analysis
       WHERE product = $1
       ORDER BY analysis_date DESC LIMIT 1`,
      [product]
    );
    return rows[0] || null;
  } catch {
    return null;
  }
}

// ── Scheduler ───────────────────────────────────────────────────────────────

let _intervalHandle = null;
const ANALYSIS_INTERVAL_MS = 24 * 60 * 60 * 1000; // Daily
const INITIAL_DELAY_MS = 5 * 60 * 1000; // 5 min after boot (after fetcher runs)

export function startMarketAnalysisAgent() {
  logger.info('[MarketAnalyst] Starting daily market analysis agent');

  setTimeout(async () => {
    try {
      await runMarketAnalysis();
    } catch (err) {
      logger.error('[MarketAnalyst] Initial analysis failed:', err.message);
    }
  }, INITIAL_DELAY_MS);

  _intervalHandle = setInterval(async () => {
    try {
      await runMarketAnalysis();
    } catch (err) {
      logger.error('[MarketAnalyst] Scheduled analysis failed:', err.message);
    }
  }, ANALYSIS_INTERVAL_MS);

  logger.info('[MarketAnalyst] Scheduled: initial run in 5min, then every 24h');
}

export function stopMarketAnalysisAgent() {
  if (_intervalHandle) {
    clearInterval(_intervalHandle);
    _intervalHandle = null;
    logger.info('[MarketAnalyst] Stopped');
  }
}
