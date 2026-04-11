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
 * North American Organic Retail Market Data Sources
 * Pricing from premium grocers: Whole Foods, Farm Boy, Sobeys, Metro
 * All prices in CAD at organic retail tier
 */
const MARKET_DATA_SOURCES = {
  'Tomatoes': {
    retailers: ['Whole Foods', 'Farm Boy', 'Sobeys', 'Metro', 'Loblaws'],
    avgPriceCAD: 8.15,
    avgWeightOz: 16,
    priceRange: [6.49, 9.99],
    trend: 'increasing',
    trendPercent: 18,
    previousPrice: 6.90,
    country: 'North America',
    lastUpdated: '2026-06-18',
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
    retailers: ['Whole Foods', 'Farm Boy', 'Sobeys', 'Metro', 'Loblaws'],
    avgPriceCAD: 5.49,
    avgWeightOz: 16,
    priceRange: [4.49, 6.99],
    trend: 'decreasing',
    trendPercent: -12,
    previousPrice: 6.25,
    country: 'North America',
    lastUpdated: '2026-06-18',
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
  'Butterhead Lettuce': {
    retailers: ['Whole Foods', 'Farm Boy', 'Sobeys', 'Metro', 'Loblaws'],
    avgPriceCAD: 8.15,
    avgWeightOz: 6,
    priceRange: [6.79, 9.49],
    trend: 'stable',
    trendPercent: 3,
    previousPrice: 7.92,
    country: 'North America',
    lastUpdated: '2026-06-18',
    articles: []
  },
  'Spinach': {
    retailers: ['Whole Foods', 'Farm Boy', 'Sobeys', 'Metro', 'Loblaws'],
    avgPriceCAD: 6.79,
    avgWeightOz: 5,
    priceRange: [5.49, 7.99],
    trend: 'stable',
    trendPercent: 2,
    previousPrice: 6.66,
    country: 'North America',
    lastUpdated: '2026-06-18',
    articles: []
  },
  'Kale': {
    retailers: ['Whole Foods', 'Farm Boy', 'Sobeys', 'Sprouts', 'Loblaws'],
    avgPriceCAD: 6.11,
    avgWeightOz: 8,
    priceRange: [4.99, 7.49],
    trend: 'stable',
    trendPercent: -3,
    previousPrice: 6.30,
    country: 'North America',
    lastUpdated: '2026-06-18',
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
    retailers: ['Whole Foods', 'Farm Boy', 'Sobeys', 'Metro'],
    avgPriceCAD: 6.79,
    avgWeightOz: 5,
    priceRange: [5.49, 7.99],
    trend: 'stable',
    trendPercent: 4,
    previousPrice: 6.53,
    country: 'North America',
    lastUpdated: '2026-06-18',
    articles: []
  },
  'Romaine Lettuce': {
    retailers: ['Whole Foods', 'Farm Boy', 'Sobeys', 'Loblaws', 'Metro'],
    avgPriceCAD: 6.11,
    avgWeightOz: 16,
    priceRange: [4.99, 7.49],
    trend: 'decreasing',
    trendPercent: -8,
    previousPrice: 6.64,
    country: 'North America',
    lastUpdated: '2026-06-18',
    articles: []
  },
  'Basil': {
    retailers: ['Whole Foods', 'Farm Boy', 'Sobeys', 'Metro', 'Loblaws'],
    avgPriceCAD: 32.64,
    avgWeightOz: 16,
    priceRange: [24.48, 43.52],
    trend: 'stable',
    trendPercent: 2,
    previousPrice: 32.00,
    country: 'North America',
    lastUpdated: '2026-06-18',
    articles: []
  },
  'Microgreens': {
    retailers: ['Whole Foods', 'Farm Boy', 'Sobeys', 'Specialty Stores'],
    avgPriceCAD: 8.15,
    avgWeightOz: 2,
    priceRange: [6.79, 9.49],
    trend: 'increasing',
    trendPercent: 8,
    previousPrice: 7.55,
    country: 'North America',
    lastUpdated: '2026-06-18',
    articles: []
  }
};

const NATIONAL_RETAILER_INDEX = new Map([
  ['whole foods', 'Whole Foods'],
  ['trader joes', 'Trader Joes'],
  ['trader joe s', 'Trader Joes'],
  ['sobeys', 'Sobeys'],
  ['metro', 'Metro'],
  ['loblaws', 'Loblaws'],
  ['kroger', 'Kroger'],
  ['safeway', 'Safeway'],
  ['farm boy', 'Farm Boy'],
  ['sprouts', 'Sprouts'],
  ['target', 'Target'],
  ['walmart', 'Walmart'],
  ['freshco', 'FreshCo'],
  ['t t', 'T&T'],
]);

const PRODUCT_WEIGHT_HINTS_OZ = {
  basil: 1,
  'genovese basil': 1,
  kale: 8,
  spinach: 10,
  arugula: 5,
  lettuce: 16,
  'lettuce romaine': 16,
  'romaine lettuce': 16,
  'lettuce iceberg': 16,
  tomatoes: 16,
  'cherry tomatoes': 10,
  microgreens: 4,
  cilantro: 1,
  mint: 0.75,
  'bok choy': 16,
  watercress: 3,
};

const DRIVER_SIGNAL_DEFINITIONS = [
  {
    key: 'globalEvents',
    label: 'Global Events',
    keywords: ['tariff', 'export', 'import', 'currency', 'fx', 'trade', 'policy', 'duty', 'sanction', 'global'],
    neutralEvidence: 'No explicit global trade or macro-policy signal in the latest AI reasoning.',
  },
  {
    key: 'weather',
    label: 'Weather',
    keywords: ['weather', 'frost', 'freeze', 'storm', 'drought', 'flood', 'heat', 'wildfire', 'cold snap', 'rainfall'],
    neutralEvidence: 'No explicit weather disruption signal in the latest AI reasoning.',
  },
  {
    key: 'oilFuel',
    label: 'Oil & Fuel',
    keywords: ['oil', 'fuel', 'diesel', 'gas', 'energy', 'freight', 'shipping cost', 'transport cost'],
    neutralEvidence: 'No explicit oil/fuel cost signal in the latest AI reasoning.',
  },
  {
    key: 'fertilizerInputs',
    label: 'Fertilizer Inputs',
    keywords: ['fertilizer', 'fertiliser', 'potash', 'nitrogen', 'ammonia', 'input cost'],
    neutralEvidence: 'No explicit fertilizer input-cost signal in the latest AI reasoning.',
  },
  {
    key: 'conflictWar',
    label: 'Conflict & War Logistics',
    keywords: ['war', 'conflict', 'geopolitical', 'port disruption', 'route disruption', 'red sea', 'black sea', 'blockade'],
    neutralEvidence: 'No explicit conflict-related logistics signal in the latest AI reasoning.',
  },
];

const IMPACT_UP_KEYWORDS = [
  'increase',
  'increased',
  'higher',
  'rise',
  'rising',
  'upward',
  'shortage',
  'tight supply',
  'constraint',
  'disruption',
  'spike',
  'elevated',
  'expensive',
  'premium',
  'surge',
];

const IMPACT_DOWN_KEYWORDS = [
  'decrease',
  'decreased',
  'lower',
  'decline',
  'declined',
  'fall',
  'falling',
  'downward',
  'surplus',
  'oversupply',
  'eased',
  'softened',
  'discount',
  'improved supply',
  'recovery',
];

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const CONFIDENCE_RANK = {
  low: 1,
  medium: 2,
  high: 3,
};

function normalizeToken(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function toFiniteNumber(value, fallback = 0) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getNationalRetailers(retailers = []) {
  const matched = new Map();
  for (const retailer of retailers) {
    const normalized = normalizeToken(retailer);
    const canonical = NATIONAL_RETAILER_INDEX.get(normalized);
    if (canonical) matched.set(canonical, true);
  }
  return Array.from(matched.keys());
}

function inferAverageWeightOz(product, data) {
  const explicitWeight = toFiniteNumber(data?.avgWeightOz, NaN);
  if (Number.isFinite(explicitWeight) && explicitWeight > 0) return explicitWeight;

  const staticWeight = toFiniteNumber(MARKET_DATA_SOURCES[product]?.avgWeightOz, NaN);
  if (Number.isFinite(staticWeight) && staticWeight > 0) return staticWeight;

  const normalizedProduct = normalizeToken(product);
  if (PRODUCT_WEIGHT_HINTS_OZ[normalizedProduct]) return PRODUCT_WEIGHT_HINTS_OZ[normalizedProduct];

  for (const [hint, weight] of Object.entries(PRODUCT_WEIGHT_HINTS_OZ)) {
    if (normalizedProduct.includes(hint) || hint.includes(normalizedProduct)) {
      return weight;
    }
  }

  return 1;
}

function splitIntoSentences(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .split(/[.!?]\s+/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function findEvidenceSentence(sentences, keywords = []) {
  const loweredKeywords = keywords.map((keyword) => keyword.toLowerCase());
  for (const sentence of sentences) {
    const lowerSentence = sentence.toLowerCase();
    if (loweredKeywords.some((keyword) => lowerSentence.includes(keyword))) {
      return sentence;
    }
  }
  return '';
}

function classifyImpactDirection(text, trendPercent = 0) {
  const lowerText = String(text || '').toLowerCase();
  const upwardSignal = IMPACT_UP_KEYWORDS.some((keyword) => lowerText.includes(keyword));
  const downwardSignal = IMPACT_DOWN_KEYWORDS.some((keyword) => lowerText.includes(keyword));

  if (upwardSignal && !downwardSignal) return 'upward';
  if (downwardSignal && !upwardSignal) return 'downward';
  if (upwardSignal && downwardSignal) return 'mixed';

  if (Math.abs(trendPercent) >= 10) {
    return trendPercent > 0 ? 'upward' : 'downward';
  }

  return 'neutral';
}

function buildSeasonalityDriver(trendPercent, now = new Date()) {
  const month = now.getUTCMonth();
  const monthLabel = MONTH_NAMES[month] || 'Current';
  const isWinter = month === 11 || month <= 1;
  const isSummer = month >= 5 && month <= 7;

  if (isWinter && trendPercent > 3) {
    return {
      key: 'seasonality',
      label: 'Seasonality',
      impact: 'upward',
      evidence: `${monthLabel} is a winter month; colder-season transport and field-supply constraints align with the observed +${Math.abs(trendPercent).toFixed(1)}% move.`,
      hasEvidence: true,
    };
  }

  if (isSummer && trendPercent < -3) {
    return {
      key: 'seasonality',
      label: 'Seasonality',
      impact: 'downward',
      evidence: `${monthLabel} is peak growing season in many regions; broader supply aligns with the observed ${trendPercent.toFixed(1)}% move.`,
      hasEvidence: true,
    };
  }

  return {
    key: 'seasonality',
    label: 'Seasonality',
    impact: 'neutral',
    evidence: `${monthLabel} seasonality is currently not the dominant signal versus measured retailer price movement.`,
    hasEvidence: true,
  };
}

function computeAnalysisFreshness(analysisDate) {
  if (!analysisDate) return 'missing';

  const parsedDate = new Date(analysisDate);
  if (Number.isNaN(parsedDate.getTime())) return 'missing';

  const ageHours = (Date.now() - parsedDate.getTime()) / 3600000;
  if (ageHours <= 72) return 'fresh';
  if (ageHours <= 168) return 'aging';
  return 'stale';
}

function normalizeConfidenceLabel(value) {
  const normalized = String(value || '').toLowerCase();
  return normalized in CONFIDENCE_RANK ? normalized : null;
}

function confidenceFromObservations(observationCount) {
  if (observationCount >= 25) return 'high';
  if (observationCount >= 8) return 'medium';
  return 'low';
}

function combineConfidence(observationCount, aiConfidence, analysisFreshness) {
  const observationConfidence = confidenceFromObservations(observationCount);
  const normalizedAiConfidence = normalizeConfidenceLabel(aiConfidence);

  let rank = CONFIDENCE_RANK[observationConfidence];
  if (normalizedAiConfidence) {
    rank = Math.min(rank, CONFIDENCE_RANK[normalizedAiConfidence]);
  }

  if (analysisFreshness === 'stale' || analysisFreshness === 'missing') {
    rank = Math.max(1, rank - 1);
  }

  if (rank >= 3) return 'high';
  if (rank === 2) return 'medium';
  return 'low';
}

function buildMovementDrivers({ trendPercent, aiReasoning, articles = [] }) {
  const articleSignals = articles
    .map((article) => `${article?.title || ''}. ${article?.summary || ''}`.trim())
    .filter(Boolean)
    .join(' ');

  const sentences = splitIntoSentences(`${aiReasoning || ''}. ${articleSignals}`);
  const drivers = [buildSeasonalityDriver(trendPercent)];

  for (const definition of DRIVER_SIGNAL_DEFINITIONS) {
    const evidence = findEvidenceSentence(sentences, definition.keywords);
    if (evidence) {
      drivers.push({
        key: definition.key,
        label: definition.label,
        impact: classifyImpactDirection(evidence, trendPercent),
        evidence,
        hasEvidence: true,
      });
    } else {
      drivers.push({
        key: definition.key,
        label: definition.label,
        impact: 'neutral',
        evidence: definition.neutralEvidence,
        hasEvidence: false,
      });
    }
  }

  return drivers;
}

function buildMovementSummary({
  product,
  trendPercent,
  currentPricePerOzCAD,
  previousPricePerOzCAD,
  observationCount,
  nationalRetailers,
  movementDrivers,
  analysisFreshness,
}) {
  const trendDirection = trendPercent >= 0 ? 'up' : 'down';
  const primarySignals = movementDrivers.filter((driver) => driver.hasEvidence).slice(0, 2);

  const signalText = primarySignals.length > 0
    ? primarySignals.map((driver) => `${driver.label}: ${driver.evidence}`).join(' ')
    : 'No explicit macro-event keyword signal was found in the latest AI reasoning; movement currently follows observed supply-demand data.';

  const retailerCoverage = nationalRetailers.length > 0
    ? `${nationalRetailers.length} national retailers`
    : 'available retailers (national tags unavailable)';

  const freshnessNote = (analysisFreshness === 'stale' || analysisFreshness === 'missing')
    ? ' AI narrative freshness is reduced, so confidence is intentionally conservative.'
    : '';

  return `${product} is ${trendDirection} ${Math.abs(trendPercent).toFixed(1)}% (${previousPricePerOzCAD.toFixed(2)} to ${currentPricePerOzCAD.toFixed(2)} CAD/oz). Coverage includes ${observationCount} observations across ${retailerCoverage}. ${signalText}${freshnessNote}`.trim();
}

function buildPricingRecommendationsFromSignals(marketData, aiAnalyses, fxRate) {
  const aiMap = new Map((aiAnalyses || []).map((analysis) => [analysis.product, analysis]));
  const recommendations = [];

  for (const [product, data] of Object.entries(marketData || {})) {
    const avgWeightOz = inferAverageWeightOz(product, data);
    const avgPriceCAD = toFiniteNumber(data.avgPriceCAD, 0);
    const previousPriceCAD = toFiniteNumber(data.previousPrice, avgPriceCAD);

    const currentPricePerOzCAD = avgWeightOz > 0 ? avgPriceCAD / avgWeightOz : avgPriceCAD;
    const previousPricePerOzCAD = avgWeightOz > 0 ? previousPriceCAD / avgWeightOz : previousPriceCAD;

    let trendPercent = toFiniteNumber(data.trendPercent, NaN);
    if (!Number.isFinite(trendPercent)) {
      const referencePrice = previousPriceCAD > 0 ? previousPriceCAD : avgPriceCAD;
      trendPercent = referencePrice > 0
        ? ((avgPriceCAD - referencePrice) / referencePrice) * 100
        : 0;
    }

    const trend = data.trend || (trendPercent > 5 ? 'increasing' : trendPercent < -5 ? 'decreasing' : 'stable');

    const priceRangeCAD = Array.isArray(data.priceRange) && data.priceRange.length >= 2
      ? data.priceRange.map((price) => toFiniteNumber(price, avgPriceCAD))
      : [avgPriceCAD * 0.9, avgPriceCAD * 1.1];

    const priceRangePerOz = priceRangeCAD.map((price) => (avgWeightOz > 0 ? price / avgWeightOz : price));

    const retailers = Array.isArray(data.retailers) ? data.retailers : [];
    const nationalRetailers = getNationalRetailers(retailers);
    const articles = Array.isArray(data.articles) ? data.articles : [];

    const ai = aiMap.get(product) || null;
    const aiReasoning = typeof ai?.reasoning === 'string' ? ai.reasoning.trim() : '';
    const observationCount = Math.max(0, Math.round(toFiniteNumber(data.observationCount, 0)));
    const analysisFreshness = computeAnalysisFreshness(ai?.analysis_date);

    const movementDrivers = buildMovementDrivers({
      trendPercent,
      aiReasoning,
      articles,
    });

    const confidence = combineConfidence(observationCount, ai?.confidence, analysisFreshness);
    const summary = buildMovementSummary({
      product,
      trendPercent,
      currentPricePerOzCAD,
      previousPricePerOzCAD,
      observationCount,
      nationalRetailers,
      movementDrivers,
      analysisFreshness,
    });

    recommendations.push({
      product,
      avgPriceCAD,
      previousPriceCAD,
      pricePerOzCAD: currentPricePerOzCAD,
      previousPricePerOzCAD,
      priceRange: priceRangePerOz,
      trend,
      trendPercent,
      change: `${trendPercent >= 0 ? '+' : ''}${trendPercent.toFixed(1)}%`,
      retailers,
      nationalRetailers,
      nationalRetailerCount: nationalRetailers.length,
      observationCount,
      lastUpdated: data.lastUpdated,
      dataSource: data.dataSource || 'static',
      articles,
      aiOutlook: ai?.outlook || null,
      aiConfidence: ai?.confidence || null,
      aiForecastPrice: ai?.price_forecast ? parseFloat(ai.price_forecast) : null,
      aiAction: ai?.action || null,
      aiReasoning: aiReasoning || null,
      aiAnalysisDate: ai?.analysis_date || null,
      analysisFreshness,
      movementDrivers,
      summary,
      confidence,
      fxRate,
    });
  }

  recommendations.sort((a, b) => Math.abs(b.trendPercent) - Math.abs(a.trendPercent));
  return recommendations;
}

/**
 * GET /api/market-intelligence/price-alerts
 * Get current price anomaly alerts with market context
 * Now DB-backed — reads from market_price_trends + market_ai_analysis
 */
router.get('/price-alerts', async (req, res) => {
  try {
    const { threshold = 7 } = req.query;
    const parsedThreshold = Number.parseFloat(threshold);
    const thresholdValue = Number.isFinite(parsedThreshold) ? Math.max(0, parsedThreshold) : 7;

    const pool = req.app?.locals?.dbPool;
    const [marketData, aiAnalyses] = await Promise.all([
      pool ? getMarketDataAsync(pool) : Promise.resolve(MARKET_DATA_SOURCES),
      pool ? getLatestAnalyses(pool) : Promise.resolve([]),
    ]);

    const fxRate = getLastFxRate();
    const recommendations = buildPricingRecommendationsFromSignals(marketData, aiAnalyses, fxRate);

    const nationallyMonitored = recommendations.filter((entry) => entry.nationalRetailerCount > 0);
    const monitoredPool = nationallyMonitored.length > 0 ? nationallyMonitored : recommendations;

    const alerts = monitoredPool
      .filter((entry) => Math.abs(entry.trendPercent) >= thresholdValue)
      .map((entry) => ({
        product: entry.product,
        change: entry.change,
        type: entry.trendPercent > 0 ? 'increase' : entry.trendPercent < 0 ? 'decrease' : 'stable',
        currentPrice: entry.pricePerOzCAD,
        previousPrice: entry.previousPricePerOzCAD,
        priceUnit: 'CAD per oz',
        summary: entry.summary,
        movementDrivers: entry.movementDrivers,
        retailers: entry.nationalRetailers.length > 0 ? entry.nationalRetailers : entry.retailers,
        dataPoints: entry.observationCount || (entry.retailers || []).length,
        lastUpdated: entry.lastUpdated,
        confidence: entry.confidence,
        aiOutlook: entry.aiOutlook,
        aiAction: entry.aiAction,
        aiConfidence: entry.aiConfidence,
        analysisFreshness: entry.analysisFreshness,
        articles: entry.articles || [],
        priceRange: {
          low: toFiniteNumber(entry.priceRange?.[0], 0),
          high: toFiniteNumber(entry.priceRange?.[1], 0),
        },
        dataSource: entry.dataSource || 'static',
      }))
      .sort((a, b) => Math.abs(parseFloat(b.change)) - Math.abs(parseFloat(a.change)));

    return res.json({
      ok: true,
      alerts,
      timestamp: new Date().toISOString(),
      threshold: thresholdValue,
      totalProductsMonitored: monitoredPool.length,
      alertsGenerated: alerts.length,
      monitorScope: nationallyMonitored.length > 0 ? 'national_retailers' : 'all_retailers',
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
    const recommendations = buildPricingRecommendationsFromSignals(marketData, aiAnalyses, fxRate);

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
  // DEPRECATED: Use getMarketDataAsync(pool) instead — this sync fallback will be removed in a future release
  console.warn('[Market Intelligence] DEPRECATED: getMarketData() called — migrate to getMarketDataAsync(pool)');
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
