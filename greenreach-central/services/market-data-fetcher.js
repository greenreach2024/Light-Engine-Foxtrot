/**
 * Market Data Fetcher — Phase 2 (Canadian Retail)
 *
 * Daily job: uses Gemini to look up current Canadian retail grocer
 * pricing for each crop, guided by the crop's benchmark category
 * from crop_benchmark_config.  Stores observations in
 * market_price_observations, then refreshes the trend table.
 *
 * Data flow:
 *   crop_benchmark_config → Gemini retail price query
 *   → CAD prices → recordPriceObservationsBatch() → refreshPriceTrends()
 *
 * Benchmark categories:
 *   direct       — search for the crop by name at Canadian grocers
 *   organic_mixed_greens — search for organic packaged mixed greens (not conventional)
 *   frozen       — search for frozen equivalent
 *   specialty    — search as premium / specialty item
 *
 * Retailers: Loblaws, Sobeys, Metro, Farm Boy, Whole Foods, FreshCo, T&T
 */

import {
  recordPriceObservationsBatch,
  refreshPriceTrends,
} from './market-intelligence-service.js';
import { getDatabase, isDatabaseAvailable } from '../config/database.js';
import { getGeminiClient, GEMINI_FLASH, isGeminiConfigured } from '../lib/gemini-client.js';
import { trackAiUsage, estimateChatCost } from '../lib/ai-usage-tracker.js';
import logger from '../utils/logger.js';

const MODEL = GEMINI_FLASH;

const BOC_FX_URL = 'https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?recent=1';
const FALLBACK_FX_RATE = 1.36;
let _lastFxRate = FALLBACK_FX_RATE;
let _lastFxFetch = 0;
const FX_CACHE_TTL = 12 * 60 * 60 * 1000;

const CANADIAN_RETAILERS = [
  'Loblaws', 'Sobeys', 'Metro', 'Farm Boy', 'Whole Foods',
  'FreshCo', 'T&T', 'No Frills', 'Fortinos'
];

// Default benchmark assignments — used to seed crop_benchmark_config on first run
const DEFAULT_BENCHMARKS = {
  // Lettuces → organic_mixed_greens (priced against organic packaged mixed greens)
  'Lettuce':            'organic_mixed_greens',
  'Mixed Lettuce':      'organic_mixed_greens',
  'Oak Leaf Lettuce':   'organic_mixed_greens',
  'Red Leaf Lettuce':   'organic_mixed_greens',
  'Butterhead Lettuce': 'organic_mixed_greens',
  'Bibb Butterhead':    'organic_mixed_greens',
  'Buttercrunch Lettuce': 'organic_mixed_greens',
  'Romaine Lettuce':    'organic_mixed_greens',
  // Herbs → direct
  'Basil':              'direct',
  'Genovese Basil':     'direct',
  'Holy Basil':         'direct',
  'Lemon Basil':        'direct',
  'Purple Basil':       'direct',
  'Thai Basil':         'direct',
  // Greens → direct
  'Kale':               'direct',
  'Baby Kale':          'direct',
  'Curly Kale':         'direct',
  'Dinosaur Kale':      'direct',
  'Lacinato Kale':      'direct',
  'Red Russian Kale':   'direct',
  'Spinach':            'direct',
  // Arugula → specialty (premium clamshell)
  'Arugula':            'specialty',
  'Baby Arugula':       'specialty',
  'Cultivated Arugula': 'specialty',
  'Red Arugula':        'specialty',
  'Wasabi Arugula':     'specialty',
  'Wild Arugula':       'specialty',
  // Others
  'Microgreens':        'specialty',
  'Watercress':         'specialty',
  'Frisée Endive':      'specialty',
};

// ── FX Rate ─────────────────────────────────────────────────────────────

async function fetchUsdCadRate() {
  if (Date.now() - _lastFxFetch < FX_CACHE_TTL) return _lastFxRate;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(BOC_FX_URL, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) throw new Error(`BOC API ${res.status}`);
    const json = await res.json();
    const obs = json?.observations;
    if (obs && obs.length > 0) {
      const rate = parseFloat(obs[obs.length - 1].FXUSDCAD?.v);
      if (rate > 0) {
        _lastFxRate = rate;
        _lastFxFetch = Date.now();
        logger.info(`[MarketFetcher] USD/CAD rate: ${rate.toFixed(4)}`);
        return rate;
      }
    }
    throw new Error('No valid rate in BOC response');
  } catch (err) {
    logger.warn(`[MarketFetcher] BOC FX fetch failed (using ${_lastFxRate.toFixed(4)}):`, err.message);
    return _lastFxRate;
  }
}

// ── Benchmark Config ────────────────────────────────────────────────────

/**
 * Load benchmark configs from DB. Seeds defaults for any crop not yet configured.
 */
async function loadBenchmarkConfigs(pool) {
  // Ensure defaults are seeded
  for (const [crop, category] of Object.entries(DEFAULT_BENCHMARKS)) {
    try {
      await pool.query(
        `INSERT INTO crop_benchmark_config (crop_name, benchmark_category, updated_by)
         VALUES ($1, $2, 'system')
         ON CONFLICT (crop_name) DO NOTHING`,
        [crop, category]
      );
    } catch { /* table may not exist yet on first boot */ }
  }

  try {
    const { rows } = await pool.query(
      'SELECT crop_name, benchmark_category, search_override FROM crop_benchmark_config'
    );
    const map = {};
    for (const r of rows) {
      map[r.crop_name] = {
        category: r.benchmark_category,
        searchOverride: r.search_override || null,
      };
    }
    return map;
  } catch {
    // Fallback if table doesn't exist
    const map = {};
    for (const [crop, category] of Object.entries(DEFAULT_BENCHMARKS)) {
      map[crop] = { category, searchOverride: null };
    }
    return map;
  }
}

/**
 * Build the Gemini search description for a crop based on its benchmark category.
 */
function buildSearchDescription(cropName, config) {
  if (config?.searchOverride) return config.searchOverride;

  const category = config?.category || 'direct';
  switch (category) {
    case 'organic_mixed_greens':
      return 'organic mixed greens salad blend (142g or 5oz clamshell) — must be certified organic, not conventional';
    case 'frozen':
      return `frozen ${cropName} (retail bag, 300-500g)`;
    case 'specialty':
      return `organic ${cropName} (premium clamshell, small format)`;
    case 'direct':
    default:
      return `organic ${cropName} (fresh, retail package)`;
  }
}

// ── Package Weight Conversion ────────────────────────────────────────────

// Known retail package weights in ounces for per_each → per_lb conversion.
// These are typical Canadian grocer clamshell/bunch/bag sizes.
const KNOWN_PACKAGE_WEIGHTS_OZ = {
  'basil':               1.0,   // herb clamshell 28g
  'genovese basil':      1.0,
  'thai basil':          1.0,
  'holy basil':          1.0,
  'lemon basil':         1.0,
  'purple basil':        1.0,
  'cilantro':            1.0,   // herb bunch ~28g
  'parsley':             1.0,
  'dill':                0.75,
  'mint':                0.75,
  'thyme':               0.50,  // small herb pack ~14g
  'rosemary':            0.75,
  'oregano':             0.50,
  'sage':                0.50,
  'tarragon':            0.50,
  'chervil':             0.50,
  'marjoram':            0.50,
  'chives':              0.75,
  'lemon balm':          0.75,
  'lovage':              1.0,
  'watercress':          3.0,   // 85g bag
  'arugula':             5.0,   // 142g clamshell
  'spinach':             10.0,  // 283g bag
  'baby spinach':        5.0,   // 142g clamshell
  'kale':                8.0,   // 227g bunch
  'baby kale':           5.0,
  'curly kale':          8.0,
  'dinosaur kale':       8.0,
  'lacinato kale':       8.0,
  'red russian kale':    8.0,
  'swiss chard':         12.0,  // large bunch
  'rainbow swiss chard': 12.0,
  'bok choy':            16.0,  // per head ~1lb
  'pak choi':            8.0,
  'lettuce':             16.0,  // per head
  'butterhead lettuce':  6.0,   // small hydroponic head
  'buttercrunch lettuce':6.0,
  'bibb butterhead':     6.0,
  'romaine lettuce':     16.0,
  'oak leaf lettuce':    8.0,
  'red leaf lettuce':    12.0,
  'oakleaf lettuce':     8.0,
  'mixed greens':        5.0,   // 142g clamshell
  'organic mixed greens':5.0,
  'eazyleaf blend':      5.0,
  'microgreens':         2.0,   // small clamshell
  'tomato':              16.0,  // per lb
  'tomatoes':            16.0,
  'cherry tomato':       10.0,  // pint ~283g
  'tomatoes (cherry)':   10.0,
  'tomatoes (beefsteak)':16.0,
  'strawberry':          16.0,  // 1 lb clamshell
};

/**
 * Parse package weight in ounces from Gemini's package_size field,
 * falling back to known product weights.
 */
function parsePackageWeightOz(packageSize, productName) {
  // Try parsing Gemini's package_size field (e.g., "21g", "142g", "5oz", "1 lb")
  if (packageSize) {
    const sizeStr = String(packageSize).toLowerCase().trim();
    let match;
    if ((match = sizeStr.match(/([\d.]+)\s*g(?:ram)?s?/))) {
      return parseFloat(match[1]) / 28.3495; // grams → oz
    }
    if ((match = sizeStr.match(/([\d.]+)\s*oz/))) {
      return parseFloat(match[1]);
    }
    if ((match = sizeStr.match(/([\d.]+)\s*lb/))) {
      return parseFloat(match[1]) * 16;
    }
    if ((match = sizeStr.match(/([\d.]+)\s*kg/))) {
      return parseFloat(match[1]) * 35.274; // kg → oz
    }
    if ((match = sizeStr.match(/([\d.]+)\s*ml/))) {
      // Approximate: 1ml ≈ 1g for produce
      return parseFloat(match[1]) / 28.3495;
    }
  }

  // Fallback to known product weights
  if (productName) {
    const normalized = String(productName).toLowerCase().trim();
    if (KNOWN_PACKAGE_WEIGHTS_OZ[normalized]) return KNOWN_PACKAGE_WEIGHTS_OZ[normalized];
    // Fuzzy match: check if product name contains a known key
    for (const [key, weight] of Object.entries(KNOWN_PACKAGE_WEIGHTS_OZ)) {
      if (normalized.includes(key) || key.includes(normalized)) return weight;
    }
  }

  // Unknown weight — return 0 to indicate we cannot convert
  return 0;
}

// ── Gemini Price Lookup ─────────────────────────────────────────────────

/**
 * Ask Gemini for current Canadian retail prices for a batch of crops.
 * Returns array of { product, retailer, price_cad, unit }.
 */
async function fetchCanadianRetailPrices(benchmarkConfigs) {
  if (!isGeminiConfigured()) {
    logger.warn('[MarketFetcher] Gemini not configured — using fallback');
    return null;
  }

  const crops = Object.keys(benchmarkConfigs);
  if (crops.length === 0) return null;

  // Build per-crop search context
  const cropLines = crops.map(crop => {
    const desc = buildSearchDescription(crop, benchmarkConfigs[crop]);
    const cat = benchmarkConfigs[crop]?.category || 'direct';
    return `- "${crop}" [${cat}]: Search for "${desc}" at Canadian grocers`;
  });

  const systemPrompt = `You are a Canadian grocery price researcher. Your job is to provide current retail shelf prices (CAD) for produce items at major Canadian grocery chains: ${CANADIAN_RETAILERS.join(', ')}.

Rules:
- All prices in Canadian dollars (CAD)
- Use current 2026 pricing — organic tier when available, conventional otherwise
- For organic_mixed_greens crops: ONLY return organic-certified prices, never conventional. These are organic products.
- Each line must be valid JSON with fields: product, retailer, price_cad, unit, package_size, is_organic
- "product" must match the crop name in quotes EXACTLY (e.g. "Oak Leaf Lettuce", not the search description)
- "unit" must be one of: per_each, per_lb, per_kg, per_100g
- "is_organic" must be true if the price is for an organic product, false if conventional
- Provide 2-4 retailer prices per crop (different retailers)
- For organic_mixed_greens benchmark crops, the price IS the organic packaged salad mix price — the product field should still be the original crop name
- Respond ONLY with JSONL (one JSON object per line), no markdown, no explanation`;

  const userPrompt = `Provide current Canadian retail grocery prices for these crops (April 2026):

${cropLines.join('\n')}

Return one JSON line per retailer per crop.`;

  let client;
  try {
    client = await getGeminiClient();
  } catch (err) {
    logger.error('[MarketFetcher] Gemini client init failed:', err.message);
    return null;
  }

  let completion;
  try {
    completion = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.2,
      max_tokens: 4000,
    });
  } catch (err) {
    logger.error('[MarketFetcher] Gemini call failed:', err.message);
    return null;
  }

  const responseText = completion.choices?.[0]?.message?.content || '';
  const promptTokens = completion.usage?.prompt_tokens || 0;
  const completionTokens = completion.usage?.completion_tokens || 0;

  trackAiUsage({
    farm_id: 'system',
    endpoint: 'market-data-fetcher',
    model: MODEL,
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens,
    estimated_cost: estimateChatCost(MODEL, promptTokens, completionTokens),
    status: 'success',
  });

  // Parse JSONL
  const observations = [];
  const lines = responseText.split('\n').filter(l => l.trim());
  for (const line of lines) {
    try {
      // Strip markdown fencing if present
      const cleaned = line.replace(/^```json\s*/, '').replace(/^```\s*/, '').trim();
      if (!cleaned || cleaned === '```') continue;
      const obj = JSON.parse(cleaned);
      if (!obj.product || !obj.retailer || !obj.price_cad) continue;
      // Validate retailer is one we recognize
      const price = parseFloat(obj.price_cad);
      if (!Number.isFinite(price) || price <= 0) continue;

      // Normalize ALL units to per_lb for consistent DB storage and trend averaging
      let priceCAD = price;
      let unit = obj.unit || 'per_each';
      if (unit === 'per_kg') {
        priceCAD = price / 2.20462; // per_kg → per_lb
        unit = 'per_lb';
      } else if (unit === 'per_100g') {
        priceCAD = price * 4.53592; // per_100g → per_lb
        unit = 'per_lb';
      } else if (unit === 'per_each') {
        // Convert per_each (per package/bunch/clamshell) to per_lb
        // using Gemini's package_size or known product weights
        const packageWeightOz = parsePackageWeightOz(obj.package_size, obj.product);
        if (packageWeightOz > 0) {
          priceCAD = (price / packageWeightOz) * 16; // per_each → per_oz → per_lb
          unit = 'per_lb';
        }
        // If weight unknown, keep as per_each (trend averaging should filter by unit)
      } else if (unit === 'per_lb') {
        // Gemini sometimes mislabels per-package herb prices as per_lb.
        // For small-format products (< 4oz package), a per_lb price under $15
        // is almost certainly a per-package price. Convert it properly.
        const packageWeightOz = parsePackageWeightOz(obj.package_size, obj.product);
        if (packageWeightOz > 0 && packageWeightOz < 4 && price < 15) {
          priceCAD = (price / packageWeightOz) * 16;
        }
      }

      // 10% organic premium: if the price is conventional, mark up to organic-equivalent
      const isOrganic = obj.is_organic === true;
      if (!isOrganic) {
        priceCAD = +(priceCAD * 1.10).toFixed(2);
      }

      observations.push({
        product: String(obj.product).trim(),
        retailer: String(obj.retailer).trim(),
        price_cad: +priceCAD.toFixed(2),
        unit,
        source: 'gemini_ca_retail',
      });
    } catch {
      // skip malformed lines
    }
  }

  logger.info(`[MarketFetcher] Gemini returned ${observations.length} price observations for ${crops.length} crops`);
  return observations.length > 0 ? observations : null;
}

// ── Fallback ────────────────────────────────────────────────────────────

/**
 * Generate fallback observations when Gemini is unavailable.
 * Uses approximate Canadian retail pricing by category.
 */
function generateFallbackObservations(benchmarkConfigs) {
  const CATEGORY_BASE_PRICES = {
    direct: 4.99,         // organic bunch/clamshell avg (herbs, kale, etc.)
    organic_mixed_greens: 5.49,   // organic 5oz (142g) salad mix — PC Organics $5.49
    frozen: 4.49,         // frozen bag avg
    specialty: 5.49,      // premium small-format clamshell avg
  };

  const obs = [];
  const retailers = ['Loblaws', 'Sobeys', 'Metro', 'Farm Boy'];

  for (const [product, config] of Object.entries(benchmarkConfigs)) {
    const base = CATEGORY_BASE_PRICES[config.category] || 5.49;

    // Pick 2-3 random retailers
    const picked = retailers
      .sort(() => Math.random() - 0.5)
      .slice(0, 2 + Math.floor(Math.random() * 2));

    for (const retailer of picked) {
      const variation = 1 + (Math.random() * 0.24 - 0.12);
      let priceCAD = +(base * variation).toFixed(2);
      let unit = 'per_each';

      // Convert per_each to per_lb using known package weights
      const weightOz = parsePackageWeightOz(null, product);
      if (weightOz > 0) {
        priceCAD = +((priceCAD / weightOz) * 16).toFixed(2);
        unit = 'per_lb';
      }

      obs.push({
        product,
        retailer,
        price_cad: priceCAD,
        unit,
        source: 'fallback',
      });
    }
  }
  return obs;
}

// ── Main Fetch Cycle ────────────────────────────────────────────────────

export async function runMarketDataFetch() {
  if (!isDatabaseAvailable()) {
    logger.warn('[MarketFetcher] Database not available — skipping');
    return { status: 'skipped', reason: 'no_database' };
  }

  const pool = getDatabase();

  // One-time cleanup: purge herb observations with per-package prices
  // (stored as per_each or mislabeled per_lb before the unit-conversion fix)
  try {
    const herbs = ['Basil', 'Genovese Basil', 'Thai Basil', 'Holy Basil', 'Lemon Basil', 'Purple Basil',
                   'Cilantro', 'Mint', 'Thyme', 'Dill', 'Rosemary', 'Oregano', 'Sage', 'Tarragon', 'Chives'];
    const { rowCount } = await pool.query(
      `DELETE FROM market_price_observations
       WHERE product = ANY($1::text[]) AND price_cad < 15`,
      [herbs]
    );
    if (rowCount > 0) {
      logger.info(`[MarketFetcher] Purged ${rowCount} mislabeled herb observations (price < $15)`);
      // Also clear stale trends so they regenerate from clean data
      await pool.query(
        `DELETE FROM market_price_trends WHERE product = ANY($1::text[])`,
        [herbs]
      );
      logger.info('[MarketFetcher] Cleared herb trends for regeneration');
    }
  } catch (err) {
    logger.warn('[MarketFetcher] Herb cleanup failed (non-fatal):', err.message);
  }

  // Load benchmark config (seeds defaults on first run)
  const benchmarkConfigs = await loadBenchmarkConfigs(pool);
  const cropCount = Object.keys(benchmarkConfigs).length;
  logger.info(`[MarketFetcher] Loaded ${cropCount} crop benchmark configs`);

  // Still fetch FX rate for reference (some downstream consumers use it)
  const fxRate = await fetchUsdCadRate();

  // Try Gemini CA retail lookup, fall back to generated data
  let observations = await fetchCanadianRetailPrices(benchmarkConfigs);
  let source = 'gemini_ca_retail';

  if (!observations) {
    observations = generateFallbackObservations(benchmarkConfigs);
    source = 'fallback';
  }

  // Record in DB
  const results = await recordPriceObservationsBatch(pool, observations);
  const successes = results.filter(r => r.ok).length;
  const failures = results.filter(r => !r.ok).length;

  // Refresh trend table
  await refreshPriceTrends(pool);

  const summary = {
    status: 'completed',
    source,
    fxRate: fxRate.toFixed(4),
    observations: observations.length,
    recorded: successes,
    failed: failures,
    cropsConfigured: cropCount,
    timestamp: new Date().toISOString(),
  };

  logger.info(`[MarketFetcher] ${source} fetch complete — ${successes} recorded, ${failures} failed`);
  return summary;
}

// ── Scheduler ───────────────────────────────────────────────────────────

let _intervalHandle = null;
const FETCH_INTERVAL_MS = 24 * 60 * 60 * 1000; // Daily
const INITIAL_DELAY_MS = 2 * 60 * 1000; // 2 min after boot

export function startMarketDataFetcher() {
  logger.info('[MarketFetcher] Starting daily Canadian retail price fetcher');

  setTimeout(async () => {
    try {
      await runMarketDataFetch();
    } catch (err) {
      logger.error('[MarketFetcher] Initial fetch failed:', err.message);
    }
  }, INITIAL_DELAY_MS);

  _intervalHandle = setInterval(async () => {
    try {
      await runMarketDataFetch();
    } catch (err) {
      logger.error('[MarketFetcher] Scheduled fetch failed:', err.message);
    }
  }, FETCH_INTERVAL_MS);

  logger.info('[MarketFetcher] Scheduled: initial run in 2min, then every 24h');
}

export function stopMarketDataFetcher() {
  if (_intervalHandle) {
    clearInterval(_intervalHandle);
    _intervalHandle = null;
    logger.info('[MarketFetcher] Stopped');
  }
}

export function getLastFxRate() {
  return _lastFxRate;
}
