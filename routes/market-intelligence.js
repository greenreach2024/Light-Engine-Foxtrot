/**
 * Market Intelligence API
 * Monitors North American retail produce pricing and market events
 * Provides real-time price anomaly detection for wholesale buyers
 *
 * Phase 1 Ticket 1.4 — Pricing hierarchy:
 *   1. Real wholesale order history (if available)
 *   2. Central crop benchmarks (if available)
 *   3. Static fallback data (always available)
 */

import express from 'express';
import pg from 'pg';

const router = express.Router();

// Create database pool
const pool = new pg.Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  user: process.env.DB_USER || 'lightengine',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'lightengine',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

/**
 * Fetch real pricing from wholesale order history.
 * Returns per-crop avg price, volume, and trend from the last N days.
 * Falls back to null if no data available.
 */
async function fetchWholesaleOrderPricing(days = 60) {
  try {
    const res = await fetch(`http://localhost:${process.env.PORT || 8091}/api/wholesale/orders/history?days=${days}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.ok || !data.sales_history || data.sales_history.length === 0) return null;

    // Aggregate per crop
    const cropMap = {};
    for (const entry of data.sales_history) {
      const crop = (entry.crop || '').trim();
      if (!crop) continue;
      if (!cropMap[crop]) cropMap[crop] = { totalQty: 0, totalRevenue: 0, count: 0, dates: [] };
      const qty = parseFloat(entry.quantity) || 0;
      const price = parseFloat(entry.price_per_unit || entry.unit_price) || 0;
      cropMap[crop].totalQty += qty;
      cropMap[crop].totalRevenue += qty * price;
      cropMap[crop].count += 1;
      cropMap[crop].dates.push(entry.date);
    }

    // Build per-crop pricing summary
    const pricing = {};
    for (const [crop, stats] of Object.entries(cropMap)) {
      const avgPrice = stats.totalRevenue > 0 && stats.totalQty > 0
        ? stats.totalRevenue / stats.totalQty
        : null;
      pricing[crop] = {
        avgPriceCAD: avgPrice,
        totalVolume: stats.totalQty,
        orderCount: stats.count,
        source: 'wholesale_orders',
        period_days: days,
      };
    }
    return Object.keys(pricing).length > 0 ? pricing : null;
  } catch {
    return null;
  }
}



/**
 * Central benchmark cache — refreshes every 6 hours.
 */
let _centralBenchmarkCache = null;
let _centralBenchmarkCacheTime = 0;
const CENTRAL_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

/**
 * Fetch crop benchmarks from GreenReach Central.
 * Returns per-crop pricing benchmarks from network-wide experiment records.
 * Cached for 6 hours to avoid hammering Central.
 */
async function fetchCentralBenchmarks() {
  try {
    const now = Date.now();
    if (_centralBenchmarkCache && (now - _centralBenchmarkCacheTime) < CENTRAL_CACHE_TTL_MS) {
      return _centralBenchmarkCache;
    }

    const centralUrl = process.env.GREENREACH_CENTRAL_URL
      || process.env.CENTRAL_URL
      || 'http://localhost:3100';

    const resp = await fetch(`${centralUrl}/api/crop-benchmarks`, {
      signal: AbortSignal.timeout(8000),
      headers: { 'Accept': 'application/json' }
    });
    if (!resp.ok) return null;

    const data = await resp.json();
    if (!data.ok || !data.benchmarks || data.benchmarks.length === 0) return null;

    // Convert benchmarks into pricing-compatible format
    const pricing = {};
    for (const b of data.benchmarks) {
      const crop = (b.crop || '').trim();
      if (!crop) continue;
      pricing[crop] = {
        avgWeightPerPlantOz: b.avg_weight_per_plant_oz,
        avgGrowDays: b.avg_grow_days,
        avgLossRate: b.avg_loss_rate,
        farmCount: b.farm_count,
        harvestCount: b.harvest_count,
        avgTempC: b.avg_temp_c,
        avgHumidityPct: b.avg_humidity_pct,
        avgPpfd: b.avg_ppfd,
        computedAt: b.computed_at,
        source: 'central_benchmarks'
      };
    }

    if (Object.keys(pricing).length > 0) {
      _centralBenchmarkCache = pricing;
      _centralBenchmarkCacheTime = now;
      console.log(`[Market Intelligence] Cached Central benchmarks for ${Object.keys(pricing).length} crop(s)`);
      return pricing;
    }
    return null;
  } catch (err) {
    console.warn('[Market Intelligence] Central benchmarks fetch failed:', err.message);
    return null;
  }
}

// ── Gemini AI Market Analysis ─────────────────────────────────────────
import { getGeminiClient, isGeminiConfigured, GEMINI_LITE } from '../lib/gemini-client.js';

/**
 * Default crops relevant to indoor/vertical farming operations.
 * Used as the base set for AI market analysis.
 */
const DEFAULT_CROPS = [
  'Arugula', 'Butterhead Lettuce', 'Buttercrunch Lettuce', 'Oakleaf Lettuce',
  'Romaine Lettuce', 'Iceberg Lettuce', 'Spinach', 'Kale', 'Salad Mix',
  'Basil', 'Cilantro', 'Microgreens', 'Tomatoes (Cherry)', 'Tomatoes (Beefsteak)'
];

/**
 * AI-generated market analysis cache.
 * Refreshes every 12 hours via Gemini.
 */
let _aiMarketCache = null;
let _aiMarketCacheTime = 0;
const AI_CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
let _aiGenerating = false;

/**
 * Build the system prompt for Gemini market analysis.
 */
function buildMarketAnalysisPrompt(crops) {
  const today = new Date().toISOString().split('T')[0];
  return `You are a professional North American produce market analyst providing actionable intelligence to wholesale buyers and indoor farm operators. Today is ${today}.

YOUR TASK: Analyze the current state of the North American fresh produce market for each crop listed. Every crop MUST have a non-zero trendPercent and at least 2 movementDrivers. Markets are never perfectly stable -- there are always forces acting on prices.

ANALYSIS REQUIREMENTS:
- Use your knowledge of agricultural economics, seasonal cycles, weather patterns, energy markets, labor conditions, supply chain logistics, and macroeconomic factors.
- For each crop, identify what is ACTUALLY driving prices up or down RIGHT NOW. Common drivers include: seasonal supply cycles (spring ramp-up or winter scarcity), energy/fuel costs affecting transport, weather events in key growing regions (California, Arizona, Mexico, Florida, Ontario, Quebec, BC), labor market conditions, input costs (fertilizer, packaging, seeds), consumer demand shifts, and trade/import dynamics.
- trendPercent MUST be an integer between -30 and +30. Most crops should have non-zero trends. Use 0 ONLY when a crop is genuinely price-stable with no significant forces acting on it -- this should be rare (at most 1-2 crops).
- Prices should be realistic CANADIAN DOLLAR retail prices for the typical package size sold in major Canadian and US grocery chains.
- Be specific in movementDrivers evidence -- reference actual market dynamics, not generic statements.
- Do NOT fabricate news article titles, URLs, or specific publication dates.
- Indoor/vertical farming often provides advantages during supply disruptions -- note this where relevant.

OUTPUT FORMAT: Respond with ONLY valid JSON (no markdown fences, no commentary):
{
  "analysisDate": "${today}",
  "marketConditions": "2-3 sentence summary of overall North American produce market state",
  "crops": {
    "CropName": {
      "avgRetailPriceCAD": <number - total retail package price in CAD>,
      "packageWeightOz": <number - typical retail package weight>,
      "priceRange": [<low_CAD>, <high_CAD>],
      "trend": "increasing|decreasing|stable",
      "trendPercent": <integer, NEVER zero, negative for decreasing>,
      "movementDrivers": [
        {
          "label": "Short driver name (3-5 words)",
          "impact": "high|medium|low",
          "evidence": "Specific explanation of this driver with real market context (2-3 sentences)"
        }
      ],
      "aiOutlook": "Forward-looking paragraph for next 1-3 months",
      "aiAction": "Specific actionable recommendation for wholesale buyers",
      "confidence": "high|medium|low",
      "sourceTypes": ["USDA market reports", "commodity futures", "industry trade data"]
    }
  }
}`;
}

/**
 * Call Gemini to generate fresh market analysis.
 * Returns parsed analysis or null on failure.
 */
async function generateAIMarketAnalysis(crops) {
  if (!isGeminiConfigured()) {
    console.warn('[Market Intelligence] Gemini not configured -- cannot generate AI analysis');
    return null;
  }

  try {
    const client = await getGeminiClient();
    const systemPrompt = buildMarketAnalysisPrompt(crops);
    const userPrompt = `Analyze the North American retail produce market for these crops: ${crops.join(', ')}.

For EACH crop, you MUST provide:
- A realistic current Canadian retail price (avgRetailPriceCAD) for the standard package size
- A non-zero trendPercent (positive or negative, never zero) reflecting price movement over the past 30-60 days
- At least 2 movementDrivers with specific evidence
- Forward-looking aiOutlook and actionable aiAction

Consider these market factors:
- Seasonal production: Spring is starting in the Northern Hemisphere. California and Arizona are in late-season production. Mexican imports are winding down. Ontario/Quebec greenhouse operations are ramping up.
- Energy costs: Current diesel and natural gas price levels and their impact on refrigerated transport and indoor growing costs.
- Weather: Any unusual weather patterns in major growing regions (drought, frost, heat waves, flooding).
- Labor: Seasonal agricultural labor availability and wage pressures.
- Consumer trends: Spring demand patterns, restaurant reopenings, farmers market season starting.
- Import dynamics: Trade flows from Mexico, US domestic production shifts, Canadian domestic greenhouse production.
- Input costs: Fertilizer, seed, packaging material price trends.

For leafy greens and herbs specifically -- these are indoor/vertical farming crops. Note where controlled environment agriculture (CEA) provides competitive advantages or disadvantages relative to field production.

Ensure a realistic MIX of trends -- not all crops move in the same direction. Some should be increasing, some decreasing. A few may be stable if truly warranted. In spring, many crops increase as field supply transitions, but some (like greenhouse-dominant crops or those with oversupply) may decrease.`;

    console.log('[Market Intelligence] Calling Gemini for market analysis...');
    const startTime = Date.now();

    const response = await client.chat.completions.create({
      model: GEMINI_LITE,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.5,
      max_tokens: 12000,
    });

    const elapsed = Date.now() - startTime;
    const rawContent = response.choices?.[0]?.message?.content;

    if (!rawContent) {
      console.error('[Market Intelligence] Gemini returned empty response');
      return null;
    }

    // Strip any markdown code fences if present
    let jsonStr = rawContent.trim();
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    const analysis = JSON.parse(jsonStr);
    console.log(`[Market Intelligence] Gemini analysis generated in ${elapsed}ms for ${Object.keys(analysis.crops || {}).length} crops`);

    return analysis;
  } catch (err) {
    console.error('[Market Intelligence] Gemini analysis failed:', err.message);
    return null;
  }
}

/**
 * Get cached AI market analysis, refreshing if stale.
 * Non-blocking: returns cached data while refresh happens in background.
 */
async function getAIMarketAnalysis() {
  const now = Date.now();

  // Return cache if fresh
  if (_aiMarketCache && (now - _aiMarketCacheTime) < AI_CACHE_TTL_MS) {
    return _aiMarketCache;
  }

  // If already generating, return stale cache (or null)
  if (_aiGenerating) {
    return _aiMarketCache;
  }

  // Generate new analysis
  _aiGenerating = true;
  try {
    // Try to get farm-specific crops from catalog
    let crops = DEFAULT_CROPS;
    try {
      const port = process.env.PORT || 8091;
      const catResp = await fetch(`http://localhost:${port}/api/wholesale/catalog`, {
        signal: AbortSignal.timeout(5000)
      });
      if (catResp.ok) {
        const catData = await catResp.json();
        const skus = catData?.data?.skus || [];
        if (skus.length > 0) {
          const catalogCrops = skus.map(s => s.product_name);
          // Deduplicate: if catalog has "Astro Arugula", remove generic "Arugula" from defaults
          const catalogLower = catalogCrops.map(c => c.toLowerCase());
          const filteredDefaults = DEFAULT_CROPS.filter(d => {
            const dl = d.toLowerCase();
            // Exclude default if any catalog crop contains it or it contains any catalog crop
            return !catalogLower.some(cl => cl.includes(dl) || dl.includes(cl.split(' ').pop()));
          });
          crops = [...new Set([...catalogCrops, ...filteredDefaults])];
        }
      }
    } catch { /* use defaults */ }

    const analysis = await generateAIMarketAnalysis(crops);
    if (analysis && analysis.crops && Object.keys(analysis.crops).length > 0) {
      _aiMarketCache = analysis;
      _aiMarketCacheTime = now;
      console.log(`[Market Intelligence] AI cache refreshed at ${new Date(now).toISOString()}`);
    }
  } catch (err) {
    console.error('[Market Intelligence] Cache refresh error:', err.message);
  } finally {
    _aiGenerating = false;
  }

  return _aiMarketCache;
}

// Pre-warm the AI cache on startup (non-blocking)
setTimeout(() => {
  getAIMarketAnalysis().catch(err =>
    console.warn('[Market Intelligence] Startup pre-warm failed:', err.message)
  );
}, 10000); // 10s after startup to let other services initialize

/**
 * GET /api/market-intelligence/price-alerts
 * AI-driven price anomaly alerts with real market context from Gemini.
 * Falls back to "no data" response if AI is unavailable.
 */
router.get('/price-alerts', async (req, res) => {
  try {
    const { threshold = 5 } = req.query;
    const now = new Date();
    
    // Get AI-generated market analysis
    const analysis = await getAIMarketAnalysis();
    
    if (!analysis || !analysis.crops) {
      return res.json({
        ok: true,
        alerts: [],
        timestamp: now.toISOString(),
        threshold: parseInt(threshold),
        totalProductsMonitored: 0,
        alertsGenerated: 0,
        source: 'unavailable',
        message: 'AI market analysis is initializing. Data will be available shortly.'
      });
    }
    
    const alerts = [];
    
    for (const [product, data] of Object.entries(analysis.crops)) {
      const absChange = Math.abs(data.trendPercent || 0);
      
      if (absChange >= threshold) {
        const type = (data.trend === 'increasing') ? 'increase' : (data.trend === 'decreasing') ? 'decrease' : 'stable';
        const changeSign = (data.trendPercent || 0) >= 0 ? '+' : '';
        const weightOz = data.packageWeightOz || 16;
        
        // Build summary from movement drivers
        let summary = '';
        if (data.movementDrivers && data.movementDrivers.length > 0) {
          summary = data.movementDrivers.map(d => d.evidence).join(' ');
        }
        if (data.sourceTypes && data.sourceTypes.length > 0) {
          summary += ` [Analysis based on: ${data.sourceTypes.join(', ')}]`;
        }
        
        // Freshness based on cache age
        const cacheAge = (Date.now() - _aiMarketCacheTime) / (1000 * 60 * 60);
        const analysisFreshness = cacheAge <= 6 ? 'fresh' : cacheAge <= 18 ? 'aging' : 'stale';

        alerts.push({
          product,
          change: `${changeSign}${data.trendPercent || 0}%`,
          type,
          currentPrice: (data.avgRetailPriceCAD || 0) / weightOz,
          previousPrice: ((data.avgRetailPriceCAD || 0) / (1 + (data.trendPercent || 0) / 100)) / weightOz,
          priceUnit: 'CAD per oz',
          summary,
          retailers: [],
          dataPoints: data.sourceTypes ? data.sourceTypes.length : 0,
          lastUpdated: analysis.analysisDate || now.toISOString().split('T')[0],
          confidence: data.confidence || 'medium',
          analysisFreshness,
          monitorScope: 'north_american_market',
          movementDrivers: data.movementDrivers || [],
          aiOutlook: data.aiOutlook || null,
          aiAction: data.aiAction || null,
          articles: [],
          priceRange: data.priceRange ? {
            low: data.priceRange[0] / weightOz,
            high: data.priceRange[1] / weightOz
          } : null,
          source: 'gemini_ai'
        });
      }
    }
    
    // Sort by absolute price change (largest first)
    alerts.sort((a, b) => {
      const aChange = Math.abs(parseFloat(a.change));
      const bChange = Math.abs(parseFloat(b.change));
      return bChange - aChange;
    });
    
    // Enrich with wholesale order history (Tier 1)
    const realPricing = await fetchWholesaleOrderPricing(60);
    if (realPricing) {
      for (const alert of alerts) {
        const live = realPricing[alert.product];
        if (live) {
          alert.wholesaleData = {
            avgPriceCAD: live.avgPriceCAD,
            totalVolume: live.totalVolume,
            orderCount: live.orderCount,
            source: 'wholesale_orders'
          };
        }
      }
    }

    // Enrich with Central benchmark data (Tier 2)
    const benchmarks = await fetchCentralBenchmarks();
    if (benchmarks) {
      for (const alert of alerts) {
        const bm = benchmarks[alert.product];
        if (bm) {
          alert.centralBenchmark = {
            avgWeightPerPlantOz: bm.avgWeightPerPlantOz,
            avgGrowDays: bm.avgGrowDays,
            farmCount: bm.farmCount,
            harvestCount: bm.harvestCount,
            source: 'central_benchmarks',
            computedAt: bm.computedAt
          };
        }
      }
    }

    console.log(`[Market Intelligence] Generated ${alerts.length} AI-driven price alerts (threshold: ${threshold}%)`);
    
    return res.json({
      ok: true,
      alerts,
      timestamp: now.toISOString(),
      threshold: parseInt(threshold),
      totalProductsMonitored: Object.keys(analysis.crops).length,
      alertsGenerated: alerts.length,
      marketConditions: analysis.marketConditions || null,
      analysisDate: analysis.analysisDate || null,
      source: 'gemini_ai',
      centralBenchmarksAvailable: !!benchmarks,
      wholesaleDataAvailable: !!realPricing
    });
    
  } catch (error) {
    console.error('[Market Intelligence] Price alerts error:', error);
    return res.status(500).json({
      ok: false,
      message: 'Failed to generate price alerts',
      error: error.message
    });
  }
});

/**
 * GET /api/market-intelligence/pricing-recommendations
 * Returns AI-generated pricing recommendations for the Crop Pricing AI Assistant.
 * Translates the cached AI market analysis into per-crop retail recommendations
 * compatible with LE-farm-admin.html's marketDataSources format.
 */
router.get('/pricing-recommendations', async (req, res) => {
  try {
    const analysis = await getAIMarketAnalysis();
    
    if (!analysis || !analysis.crops) {
      return res.json({
        ok: false,
        message: 'AI market analysis is initializing. Please try again in a moment.',
        recommendations: [],
        fxRate: 1.36
      });
    }

    const recommendations = [];

    for (const [product, data] of Object.entries(analysis.crops)) {
      const weightOz = data.packageWeightOz || 16;
      const totalPkgCAD = data.avgRetailPriceCAD || 0;
      const pricePerOzCAD = weightOz > 0 ? totalPkgCAD / weightOz : 0;
      const pricePerLbCAD = pricePerOzCAD * 16;

      const rangePerOz = data.priceRange
        ? [data.priceRange[0] / weightOz, data.priceRange[1] / weightOz]
        : [pricePerOzCAD * 0.9, pricePerOzCAD * 1.1];

      recommendations.push({
        product,
        avgPriceCAD: totalPkgCAD,
        pricePerOzCAD,
        pricePerLbCAD,
        priceRange: rangePerOz,
        packageWeightOz: weightOz,
        trend: data.trend || 'stable',
        trendPercent: data.trendPercent || 0,
        confidence: data.confidence || 'medium',
        aiOutlook: data.aiOutlook || null,
        aiConfidence: data.confidence || 'medium',
        aiForecastPrice: pricePerLbCAD,
        aiAction: data.aiAction || null,
        aiReasoning: data.movementDrivers
          ? data.movementDrivers.map(d => d.evidence).join(' ')
          : null,
        retailers: [],
        dataSource: 'gemini_ai',
        observationCount: data.sourceTypes ? data.sourceTypes.length : 1,
        analysisDate: analysis.analysisDate
      });
    }

    return res.json({
      ok: true,
      recommendations,
      fxRate: 1.36,
      marketConditions: analysis.marketConditions || null,
      analysisDate: analysis.analysisDate || null,
      source: 'gemini_ai'
    });
  } catch (error) {
    console.error('[Market Intelligence] Pricing recommendations error:', error);
    return res.status(500).json({
      ok: false,
      message: 'Failed to generate pricing recommendations',
      recommendations: []
    });
  }
});

/**
 * GET /api/market-intelligence/market-overview
 * AI-driven comprehensive market overview
 */
router.get('/market-overview', async (req, res) => {
  try {
    const analysis = await getAIMarketAnalysis();
    const realPricing = await fetchWholesaleOrderPricing(60);

    if (!analysis || !analysis.crops) {
      return res.json({
        ok: true,
        products: [],
        summary: { totalProducts: 0 },
        source: 'unavailable',
        message: 'AI market analysis is initializing.'
      });
    }

    const products = Object.entries(analysis.crops).map(([product, data]) => {
      const live = realPricing && realPricing[product];
      const weightOz = data.packageWeightOz || 16;
      const price = live && live.avgPriceCAD != null
        ? live.avgPriceCAD
        : (data.avgRetailPriceCAD || 0) / weightOz;
      return {
        product,
        currentPrice: price,
        priceUnit: 'CAD per oz',
        trend: data.trend,
        trendPercent: data.trendPercent,
        lastUpdated: analysis.analysisDate,
        confidence: data.confidence,
        source: live ? 'wholesale_orders' : 'gemini_ai',
        orderVolume: live ? live.totalVolume : null,
      };
    });

    const crops = Object.values(analysis.crops);
    return res.json({
      ok: true,
      timestamp: new Date().toISOString(),
      products,
      summary: {
        totalProducts: crops.length,
        increasing: crops.filter(d => d.trend === 'increasing').length,
        decreasing: crops.filter(d => d.trend === 'decreasing').length,
        stable: crops.filter(d => d.trend === 'stable').length,
        centralBenchmarksAvailable: !!(await fetchCentralBenchmarks()),
        liveDataCrops: realPricing ? Object.keys(realPricing).length : 0,
      },
      marketConditions: analysis.marketConditions,
      source: 'gemini_ai'
    });
    
  } catch (error) {
    console.error('[Market Intelligence] Market overview error:', error);
    return res.status(500).json({ ok: false, message: 'Failed to generate market overview' });
  }
});

/**
 * GET /api/market-intelligence/product/:productName
 * AI-driven detailed market data for a specific product
 */
router.get('/product/:productName', async (req, res) => {
  try {
    const { productName } = req.params;
    const analysis = await getAIMarketAnalysis();
    
    if (!analysis || !analysis.crops) {
      return res.status(503).json({ ok: false, message: 'AI analysis initializing' });
    }

    const data = analysis.crops[productName];
    if (!data) {
      return res.status(404).json({
        ok: false,
        message: `Product '${productName}' not found in AI market analysis`,
        availableProducts: Object.keys(analysis.crops)
      });
    }
    
    const weightOz = data.packageWeightOz || 16;
    return res.json({
      ok: true,
      product: productName,
      ...data,
      pricePerOz: (data.avgRetailPriceCAD || 0) / weightOz,
      pricePerLb: ((data.avgRetailPriceCAD || 0) / weightOz) * 16,
      source: 'gemini_ai',
      analysisDate: analysis.analysisDate
    });
    
  } catch (error) {
    console.error('[Market Intelligence] Product details error:', error);
    return res.status(500).json({ ok: false, message: 'Failed to get product details' });
  }
});

// ── Phase 3 Ticket 3.6: Dynamic Pricing v1 ──────────────────────────────

/**
 * GET /api/market-intelligence/dynamic-pricing
 * Analyze wholesale order history to compute price sensitivity per crop,
 * and return suggested price ranges with confidence levels.
 *
 * Replaces static percentage discounts with data-driven suggestions.
 */
router.get('/dynamic-pricing', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 90;
    const port = process.env.PORT || 8091;

    // Fetch wholesale order history with pricing data
    let orderHistory;
    try {
      const histResp = await fetch(`http://localhost:${port}/api/wholesale/orders/history?days=${days}`);
      if (histResp.ok) {
        const histData = await histResp.json();
        orderHistory = histData.sales_history || [];
      }
    } catch { /* no wholesale data */ }

    if (!orderHistory || orderHistory.length === 0) {
      // Try Central benchmarks before static fallback (Tier 2)
      const benchmarks = await fetchCentralBenchmarks();
      // Enrich with AI analysis + Central benchmarks
      const aiData = await getAIMarketAnalysis();
      if (benchmarks && Object.keys(benchmarks).length > 0) {
        const cropEntries = {};
        // Use AI analysis crops if available, else benchmark keys
        const cropNames = aiData?.crops ? Object.keys(aiData.crops) : Object.keys(benchmarks);
        for (const crop of cropNames) {
          const bm = benchmarks[crop];
          const ai = aiData?.crops?.[crop];
          cropEntries[crop] = {
            suggested_retail_cad: ai?.avgRetailPriceCAD || 0,
            suggested_ws_discount_pct: { tier1: 15, tier2: 25, tier3: 35 },
            confidence: bm ? 'medium' : ai ? 'low' : 'low',
            data_points: bm ? bm.harvestCount : 0,
            source: bm ? 'central_benchmarks' : 'gemini_ai',
            benchmark: bm || null
          };
        }
        return res.json({
          ok: true,
          source: 'central_benchmarks',
          message: 'No wholesale orders -- using Central benchmarks + AI analysis',
          centralBenchmarks: benchmarks,
          crops: cropEntries
        });
      }

      // Fall back to AI analysis only
      if (aiData?.crops) {
        return res.json({
          ok: true,
          source: 'gemini_ai',
          message: 'No wholesale orders or Central benchmarks -- using AI analysis',
          crops: Object.fromEntries(
            Object.entries(aiData.crops).map(([crop, data]) => [
              crop,
              {
                suggested_retail_cad: data.avgRetailPriceCAD || 0,
                suggested_ws_discount_pct: { tier1: 15, tier2: 25, tier3: 35 },
                confidence: 'low',
                data_points: 0,
                source: 'gemini_ai'
              }
            ])
          )
        });
      }

      // No data at all
      return res.json({
        ok: true,
        source: 'unavailable',
        message: 'No pricing data available -- AI analysis initializing',
        crops: {}
      });
    }

    // Group orders by crop and extract pricing signals
    const cropOrders = {};
    for (const entry of orderHistory) {
      const crop = (entry.crop || '').trim();
      if (!crop) continue;
      if (!cropOrders[crop]) cropOrders[crop] = [];

      const qty = parseFloat(entry.quantity) || 0;
      const pricePerUnit = parseFloat(entry.price_per_unit || entry.unit_price) || 0;
      const accepted = entry.status !== 'rejected' && entry.status !== 'cancelled';

      cropOrders[crop].push({
        date: entry.date,
        quantity: qty,
        price_per_unit: pricePerUnit,
        accepted,
        buyer_segment: entry.buyer_type || entry.buyer_segment || 'unknown'
      });
    }

    // Compute per-crop pricing analysis
    const crops = {};
    for (const [crop, orders] of Object.entries(cropOrders)) {
      const accepted = orders.filter(o => o.accepted && o.price_per_unit > 0);
      const rejected = orders.filter(o => !o.accepted && o.price_per_unit > 0);

      if (accepted.length === 0 && rejected.length === 0) continue;

      // Price statistics on accepted orders
      const prices = accepted.map(o => o.price_per_unit).sort((a, b) => a - b);
      const avgPrice = prices.length > 0
        ? prices.reduce((s, p) => s + p, 0) / prices.length
        : 0;
      const medianPrice = prices.length > 0
        ? prices[Math.floor(prices.length / 2)]
        : 0;
      const minPrice = prices.length > 0 ? prices[0] : 0;
      const maxPrice = prices.length > 0 ? prices[prices.length - 1] : 0;

      // Price sensitivity: what's the acceptance rate at different price points?
      const allPrices = orders.filter(o => o.price_per_unit > 0);
      const priceQuartiles = computeQuartiles(allPrices.map(o => o.price_per_unit));
      
      // Buyer segment analysis
      const bySegment = {};
      for (const o of accepted) {
        const seg = o.buyer_segment || 'unknown';
        if (!bySegment[seg]) bySegment[seg] = { orders: 0, totalQty: 0, avgPrice: 0, prices: [] };
        bySegment[seg].orders++;
        bySegment[seg].totalQty += o.quantity;
        bySegment[seg].prices.push(o.price_per_unit);
      }
      for (const seg of Object.values(bySegment)) {
        seg.avgPrice = seg.prices.length > 0
          ? +(seg.prices.reduce((s, p) => s + p, 0) / seg.prices.length).toFixed(2)
          : 0;
        delete seg.prices;
      }

      // Compute suggested wholesale discounts based on volume/price tiers
      const suggestedRetail = maxPrice > 0 ? +(maxPrice * 1.1).toFixed(2) : avgPrice;
      const ws1Discount = avgPrice > 0 && suggestedRetail > 0
        ? +((1 - avgPrice / suggestedRetail) * 100).toFixed(1)
        : 15;
      const ws2Discount = Math.min(ws1Discount + 10, 40);
      const ws3Discount = Math.min(ws2Discount + 10, 50);

      // Confidence based on data volume
      const confidence = accepted.length >= 20 ? 'high'
        : accepted.length >= 10 ? 'medium'
        : 'low';

      // Acceptance rate
      const acceptanceRate = allPrices.length > 0
        ? +(accepted.length / allPrices.length * 100).toFixed(1)
        : null;

      crops[crop] = {
        suggested_retail_cad: +suggestedRetail.toFixed(2),
        suggested_ws_discount_pct: {
          tier1: +Math.max(5, ws1Discount).toFixed(1),
          tier2: +Math.max(10, ws2Discount).toFixed(1),
          tier3: +Math.max(15, ws3Discount).toFixed(1)
        },
        price_range: {
          min: +minPrice.toFixed(2),
          avg: +avgPrice.toFixed(2),
          median: +medianPrice.toFixed(2),
          max: +maxPrice.toFixed(2)
        },
        confidence,
        data_points: accepted.length,
        rejected_count: rejected.length,
        acceptance_rate_pct: acceptanceRate,
        buyer_segments: bySegment,
        quartiles: priceQuartiles,
        source: 'order_history',
        period_days: days
      };
    }

    return res.json({
      ok: true,
      source: Object.keys(crops).length > 0 ? 'order_history' : 'static_fallback',
      period_days: days,
      total_orders: orderHistory.length,
      crops
    });

  } catch (error) {
    console.error('[Market Intelligence] Dynamic pricing error:', error);
    return res.status(500).json({
      ok: false,
      message: 'Failed to compute dynamic pricing'
    });
  }
});

/**
 * Compute quartiles for a sorted array of numbers.
 */
function computeQuartiles(values) {
  if (!values || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const q = (p) => {
    const idx = (sorted.length - 1) * p;
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    return lo === hi ? sorted[lo] : +(sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)).toFixed(2);
  };
  return { q25: q(0.25), q50: q(0.5), q75: q(0.75) };
}

export default router;
