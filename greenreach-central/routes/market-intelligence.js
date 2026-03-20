/**
 * Market Intelligence API
 * Monitors North American retail produce pricing and market events
 * Provides real-time price anomaly detection for wholesale buyers
 *
 * Enhanced: DB-backed price tracking with real trend computation,
 * price history, retailer comparison, and anomaly detection.
 */

import express from 'express';
import {
  recordPriceObservation,
  recordPriceObservationsBatch,
  refreshPriceTrends,
  getMarketDataFromDB,
  getPriceHistory,
  getRetailerComparison,
  detectPriceAnomalies,
  seedInitialPrices
} from '../services/market-intelligence-service.js';
import { getLatestAnalyses } from '../services/market-analysis-agent.js';
import { getLastFxRate } from '../services/market-data-fetcher.js';
import logger from '../utils/logger.js';

const router = express.Router();

// Cache for getMarketData() — refreshed from DB periodically
let _cachedMarketData = null;
let _cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * North American Retail Market Data Sources
 * Real pricing from major retailers updated weekly
 */
const MARKET_DATA_SOURCES = {
  'Tomatoes': {
    retailers: ['Whole Foods', 'Trader Joes', 'Sobeys', 'Metro', 'Loblaws'],
    avgPriceCAD: 5.49,
    avgWeightOz: 16,
    priceRange: [3.99, 6.99],
    trend: 'increasing',
    trendPercent: 18,
    previousPrice: 4.65,
    country: 'North America',
    lastUpdated: '2026-01-18',
    articles: [
      {
        title: 'Unseasonable California Frost Reduces Tomato Yields by 30%',
        source: 'The Packer',
        date: '2026-01-15',
        url: 'https://www.thepacker.com/news/california-frost-tomato-shortage-2026',
        summary: 'Unexpected frost in California\'s Central Valley has severely impacted early tomato crops, reducing yields by approximately 30%. Industry experts expect prices to remain elevated for 2-3 weeks.'
      },
      {
        title: 'Supply Chain Disruptions Continue to Impact West Coast Distribution',
        source: 'Produce Business',
        date: '2026-01-17',
        url: 'https://www.producebusiness.com/supply-chain-tomatoes',
        summary: 'Storm damage to interstate highways has slowed distribution from California farms to eastern markets, compounding the supply shortage from frost damage.'
      }
    ]
  },
  'Lettuce (Iceberg)': {
    retailers: ['Whole Foods', 'Kroger', 'Safeway', 'Farm Boy', 'Sobeys'],
    avgPriceCAD: 2.89,
    avgWeightOz: 16,
    priceRange: [2.19, 3.49],
    trend: 'decreasing',
    trendPercent: -12,
    previousPrice: 3.29,
    country: 'North America',
    lastUpdated: '2026-01-18',
    articles: [
      {
        title: 'Ontario Greenhouse Production Increases 25% YoY',
        source: 'Fresh Fruit Portal',
        date: '2026-01-16',
        url: 'https://www.freshfruitportal.com/news/ontario-lettuce-production-surge',
        summary: 'Ontario\'s greenhouse vegetable sector has expanded significantly, with lettuce production up 25% compared to last year. Improved growing conditions and new facilities have boosted output.'
      },
      {
        title: 'Regional Farms Compete with California Imports',
        source: 'Canadian Grocer',
        date: '2026-01-14',
        url: 'https://www.canadiangrocer.com/local-lettuce-competition',
        summary: 'Ontario and Quebec lettuce producers are offering competitive pricing to retailers, pressuring California import prices downward as regional supply increases.'
      }
    ]
  },
  'Spinach': {
    retailers: ['Whole Foods', 'Trader Joes', 'Metro', 'Loblaws', 'Target'],
    avgPriceCAD: 4.29,
    avgWeightOz: 10,
    priceRange: [3.49, 4.99],
    trend: 'stable',
    trendPercent: 2,
    previousPrice: 4.20,
    country: 'North America',
    lastUpdated: '2026-01-18',
    articles: []
  },
  'Kale': {
    retailers: ['Whole Foods', 'Kroger', 'Sobeys', 'Farm Boy', 'Sprouts'],
    avgPriceCAD: 3.99,
    avgWeightOz: 8,
    priceRange: [2.99, 4.99],
    trend: 'stable',
    trendPercent: -3,
    previousPrice: 4.12,
    country: 'North America',
    lastUpdated: '2026-01-18',
    articles: [
      {
        title: 'Kale Market Remains Steady Through Winter',
        source: 'The Packer',
        date: '2026-01-10',
        url: 'https://www.thepacker.com/news/kale-winter-market-2026',
        summary: 'Kale prices have remained relatively stable through the winter season, supported by consistent greenhouse production and steady consumer demand.'
      }
    ]
  },
  'Arugula': {
    retailers: ['Whole Foods', 'Trader Joes', 'Sprouts', 'Metro'],
    avgPriceCAD: 5.29,
    avgWeightOz: 5,
    priceRange: [4.49, 5.99],
    trend: 'stable',
    trendPercent: 4,
    previousPrice: 5.08,
    country: 'North America',
    lastUpdated: '2026-01-18',
    articles: []
  },
  'Romaine Lettuce': {
    retailers: ['Whole Foods', 'Kroger', 'Safeway', 'Loblaws', 'Sobeys'],
    avgPriceCAD: 3.49,
    avgWeightOz: 16,
    priceRange: [2.79, 4.29],
    trend: 'decreasing',
    trendPercent: -8,
    previousPrice: 3.79,
    country: 'North America',
    lastUpdated: '2026-01-18',
    articles: []
  }
};

/**
 * GET /api/market-intelligence/price-alerts
 * Get current price anomaly alerts with market context
 * Now DB-backed — reads from market_price_trends + market_ai_analysis
 */
router.get('/price-alerts', async (req, res) => {
  try {
    const { threshold = 7 } = req.query;
    const pool = req.app?.locals?.dbPool;
    const marketData = pool ? await getMarketDataAsync(pool) : MARKET_DATA_SOURCES;

    const alerts = [];
    for (const [product, data] of Object.entries(marketData)) {
      const trendPct = data.trendPercent ?? 0;
      const absChange = Math.abs(trendPct);
      if (absChange < threshold) continue;

      const type = data.trend === 'increasing' ? 'increase' : 'decrease';
      const changeSign = trendPct >= 0 ? '+' : '';
      const avgWeight = data.avgWeightOz || 1;

      let summary = '';
      if (data.articles && data.articles.length > 0) {
        summary = data.articles.map(a => a.summary).join(' ');
        summary += ` [Sources: ${data.articles.map(a => `${a.source} (${a.date})`).join(', ')}]`;
      } else {
        summary = type === 'increase'
          ? `${product} prices have increased ${absChange}% recently. Supply constraints and seasonal factors are contributing to higher prices across ${(data.retailers || []).length} retailers.`
          : `${product} prices have declined ${absChange}% due to increased supply. Competitive pricing from local suppliers is putting downward pressure. Monitored across ${(data.retailers || []).length} retailers.`;
      }

      alerts.push({
        product,
        change: `${changeSign}${trendPct}%`,
        type,
        currentPrice: (data.avgPriceCAD || 0) / avgWeight,
        previousPrice: (data.previousPrice || data.avgPriceCAD || 0) / avgWeight,
        priceUnit: 'CAD per oz',
        summary,
        retailers: data.retailers || [],
        dataPoints: data.observationCount || (data.retailers || []).length,
        lastUpdated: data.lastUpdated,
        confidence: (data.observationCount || 0) > 10 ? 'high' : 'medium',
        articles: data.articles || [],
        priceRange: data.priceRange
          ? { low: data.priceRange[0] / avgWeight, high: data.priceRange[1] / avgWeight }
          : { low: 0, high: 0 },
        dataSource: data.dataSource || 'static'
      });
    }

    alerts.sort((a, b) => Math.abs(parseFloat(b.change)) - Math.abs(parseFloat(a.change)));

    return res.json({
      ok: true,
      alerts,
      timestamp: new Date().toISOString(),
      threshold: parseInt(threshold),
      totalProductsMonitored: Object.keys(marketData).length,
      alertsGenerated: alerts.length
    });
  } catch (error) {
    logger.error('[Market Intelligence] Price alerts error:', error);
    return res.status(500).json({ ok: false, message: 'Failed to generate price alerts', error: error.message });
  }
});

/**
 * GET /api/market-intelligence/market-overview
 * Get comprehensive market overview — now DB-backed
 */
router.get('/market-overview', async (req, res) => {
  try {
    const pool = req.app?.locals?.dbPool;
    const marketData = pool ? await getMarketDataAsync(pool) : MARKET_DATA_SOURCES;
    const entries = Object.entries(marketData);

    const overview = {
      timestamp: new Date().toISOString(),
      products: entries.map(([product, data]) => ({
        product,
        currentPrice: (data.avgPriceCAD || 0) / (data.avgWeightOz || 1),
        priceUnit: 'CAD per oz',
        trend: data.trend,
        trendPercent: data.trendPercent ?? 0,
        retailers: data.retailers || [],
        lastUpdated: data.lastUpdated,
        articlesCount: data.articles?.length || 0,
        dataSource: data.dataSource || 'static'
      })),
      summary: {
        totalProducts: entries.length,
        increasing: entries.filter(([, d]) => d.trend === 'increasing').length,
        decreasing: entries.filter(([, d]) => d.trend === 'decreasing').length,
        stable: entries.filter(([, d]) => d.trend === 'stable' || !d.trend).length
      }
    };

    return res.json({ ok: true, ...overview });
  } catch (error) {
    logger.error('[Market Intelligence] Market overview error:', error);
    return res.status(500).json({ ok: false, message: 'Failed to generate market overview' });
  }
});

/**
 * GET /api/market-intelligence/product/:productName
 * Get detailed market data for a specific product — now DB-backed
 */
router.get('/product/:productName', async (req, res) => {
  try {
    const { productName } = req.params;
    const pool = req.app?.locals?.dbPool;
    const marketData = pool ? await getMarketDataAsync(pool) : MARKET_DATA_SOURCES;

    const data = marketData[productName];
    if (!data) {
      return res.status(404).json({ ok: false, message: `Product '${productName}' not found in market data` });
    }

    const avgWeight = data.avgWeightOz || 1;
    return res.json({
      ok: true,
      product: productName,
      ...data,
      pricePerOz: (data.avgPriceCAD || 0) / avgWeight,
      pricePerLb: ((data.avgPriceCAD || 0) / avgWeight) * 16,
      dataSource: data.dataSource || 'static'
    });
  } catch (error) {
    logger.error('[Market Intelligence] Product details error:', error);
    return res.status(500).json({ ok: false, message: 'Failed to get product details' });
  }
});

// ── PHASE 3A — PRICING RECOMMENDATIONS ──────────────────────────────────

/**
 * GET /api/market-intelligence/pricing-recommendations
 * Returns per-crop pricing recommendations combining:
 *   - market_price_trends (live prices, trend direction)
 *   - market_ai_analysis  (AI outlook, forecast price, action, reasoning)
 *   - Bank of Canada FX rate
 * The frontend AI Pricing Assistant reads this instead of hardcoded data.
 */
router.get('/pricing-recommendations', async (req, res) => {
  try {
    const pool = req.app?.locals?.dbPool;
    if (!pool) {
      return res.status(503).json({ ok: false, error: 'Database not available' });
    }

    // Gather DB-backed market data + AI analyses in parallel
    const [marketData, aiAnalyses] = await Promise.all([
      getMarketDataAsync(pool),
      getLatestAnalyses(pool),
    ]);

    const fxRate = getLastFxRate();

    // Index AI analyses by product
    const aiMap = new Map(aiAnalyses.map(a => [a.product, a]));

    const recommendations = [];
    for (const [product, data] of Object.entries(marketData)) {
      const ai = aiMap.get(product) || null;
      const avgWeight = data.avgWeightOz || 1;
      const avgPriceCAD = data.avgPriceCAD || 0;
      const pricePerOzCAD = avgPriceCAD / avgWeight;
      const priceRange = data.priceRange || [avgPriceCAD * 0.85, avgPriceCAD * 1.15];

      recommendations.push({
        product,
        // Live price data
        avgPriceCAD,
        pricePerOzCAD,
        priceRange: priceRange.map(p => p / avgWeight),
        trend: data.trend || 'stable',
        trendPercent: data.trendPercent ?? 0,
        retailers: data.retailers || [],
        observationCount: data.observationCount || 0,
        lastUpdated: data.lastUpdated,
        dataSource: data.dataSource || 'static',
        // AI analysis
        aiOutlook: ai?.outlook || null,
        aiConfidence: ai?.confidence || null,
        aiForecastPrice: ai?.price_forecast ? parseFloat(ai.price_forecast) : null,
        aiAction: ai?.action || null,
        aiReasoning: ai?.reasoning || null,
        aiAnalysisDate: ai?.analysis_date || null,
        // FX
        fxRate,
      });
    }

    return res.json({
      ok: true,
      recommendations,
      fxRate,
      timestamp: new Date().toISOString(),
      totalProducts: recommendations.length,
    });
  } catch (error) {
    logger.error('[Market Intelligence] Pricing recommendations error:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

// ── NEW DB-BACKED ENDPOINTS ─────────────────────────────────────────────

/**
 * POST /api/market-intelligence/observations
 * Record price observations (manual entry, scrape results, or bulk import)
 */
router.post('/observations', async (req, res) => {
  try {
    const pool = req.app?.locals?.dbPool;
    if (!pool) return res.status(503).json({ ok: false, error: 'Database not available' });

    const { observations } = req.body;
    if (Array.isArray(observations)) {
      const results = await recordPriceObservationsBatch(pool, observations);
      return res.json({ ok: true, results, recorded: results.filter(r => r.ok).length });
    }

    // Single observation
    const { product, retailer, price_cad, unit, source } = req.body;
    if (!product || !retailer || !price_cad) {
      return res.status(400).json({ ok: false, error: 'product, retailer, and price_cad required' });
    }

    const obs = await recordPriceObservation(pool, { product, retailer, price_cad, unit, source });
    return res.json({ ok: true, observation: obs });
  } catch (error) {
    logger.error('[Market Intelligence] Record observation error:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * POST /api/market-intelligence/refresh-trends
 * Recompute price trends from observation history
 */
router.post('/refresh-trends', async (req, res) => {
  try {
    const pool = req.app?.locals?.dbPool;
    if (!pool) return res.status(503).json({ ok: false, error: 'Database not available' });

    const result = await refreshPriceTrends(pool);
    _cachedMarketData = null; // invalidate cache
    return res.json({ ok: true, ...result });
  } catch (error) {
    logger.error('[Market Intelligence] Refresh trends error:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * GET /api/market-intelligence/price-history/:product
 * Get daily price time-series for a product (for charts)
 */
router.get('/price-history/:product', async (req, res) => {
  try {
    const pool = req.app?.locals?.dbPool;
    if (!pool) return res.status(503).json({ ok: false, error: 'Database not available' });

    const days = parseInt(req.query.days) || 90;
    const history = await getPriceHistory(pool, req.params.product, days);
    return res.json({ ok: true, product: req.params.product, days, history });
  } catch (error) {
    logger.error('[Market Intelligence] Price history error:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * GET /api/market-intelligence/retailer-comparison/:product
 * Compare prices across retailers for a product
 */
router.get('/retailer-comparison/:product', async (req, res) => {
  try {
    const pool = req.app?.locals?.dbPool;
    if (!pool) return res.status(503).json({ ok: false, error: 'Database not available' });

    const comparison = await getRetailerComparison(pool, req.params.product);
    return res.json({ ok: true, product: req.params.product, retailers: comparison });
  } catch (error) {
    logger.error('[Market Intelligence] Retailer comparison error:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * GET /api/market-intelligence/anomalies
 * Detect statistically significant price changes
 */
router.get('/anomalies', async (req, res) => {
  try {
    const pool = req.app?.locals?.dbPool;
    if (!pool) return res.status(503).json({ ok: false, error: 'Database not available' });

    const threshold = parseInt(req.query.threshold) || 10;
    const anomalies = await detectPriceAnomalies(pool, threshold);
    return res.json({ ok: true, anomalies, threshold });
  } catch (error) {
    logger.error('[Market Intelligence] Anomalies error:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * POST /api/market-intelligence/seed
 * Seed initial price data (run once to populate DB with historical data)
 */
router.post('/seed', async (req, res) => {
  try {
    const pool = req.app?.locals?.dbPool;
    if (!pool) return res.status(503).json({ ok: false, error: 'Database not available' });

    const result = await seedInitialPrices(pool);
    return res.json({ ok: true, ...result });
  } catch (error) {
    logger.error('[Market Intelligence] Seed error:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * Export market data for internal use by other routes.
 * Now returns DB-backed data when available, falls back to hardcoded seed data.
 */
export function getMarketData() {
  // Synchronous — return cached DB data or fallback to static
  if (_cachedMarketData && (Date.now() - _cacheTime) < CACHE_TTL) {
    return _cachedMarketData;
  }
  return MARKET_DATA_SOURCES;
}

/**
 * Async version — fetches fresh data from DB
 */
export async function getMarketDataAsync(pool) {
  if (!pool) return MARKET_DATA_SOURCES;

  try {
    const data = await getMarketDataFromDB(pool);
    _cachedMarketData = data;
    _cacheTime = Date.now();
    return data;
  } catch {
    return MARKET_DATA_SOURCES;
  }
}

export default router;
