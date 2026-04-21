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
  'butterhead lettuce': 6,
  'bibb butterhead': 6,
  'buttercrunch lettuce': 6,
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

const CAUSAL_CONNECTORS = [
  'due to',
  'because',
  'because of',
  'driven by',
  'caused by',
  'amid',
  'following',
  'after',
  'on the back of',
  'pressured by',
  'lifted by',
  'impacted by',
  'tightened by',
  'eased by',
];

const MARKET_SIGNAL_TERMS = [
  'supply',
  'demand',
  'inventory',
  'yield',
  'harvest',
  'production',
  'weather',
  'storm',
  'frost',
  'drought',
  'flood',
  'tariff',
  'trade',
  'import',
  'export',
  'currency',
  'fx',
  'fuel',
  'energy',
  'freight',
  'shipping',
  'transport',
  'labor',
  'strike',
  'policy',
  'logistics',
  'disease',
  'outbreak',
  'greenhouse',
  'input cost',
  'fertilizer',
];

const DRIVER_LABEL_PATTERNS = [
  /due to ([^.;,]+)/i,
  /because of ([^.;,]+)/i,
  /driven by ([^.;,]+)/i,
  /caused by ([^.;,]+)/i,
  /amid ([^.;,]+)/i,
  /following ([^.;,]+)/i,
  /after ([^.;,]+)/i,
  /pressured by ([^.;,]+)/i,
  /lifted by ([^.;,]+)/i,
  /impacted by ([^.;,]+)/i,
];

const DRIVER_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'this', 'that', 'into', 'over', 'under', 'amid', 'after',
  'because', 'due', 'driven', 'caused', 'while', 'across', 'latest', 'retail', 'market', 'price',
  'prices', 'north', 'american', 'canadian', 'us', 'usa', 'cad', 'per', 'oz'
]);

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

function toTitleCase(value) {
  return String(value || '')
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1).toLowerCase())
    .join(' ');
}

function compactLabel(value, maxWords = 4) {
  const words = String(value || '')
    .replace(/[^a-zA-Z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, maxWords);
  return toTitleCase(words.join(' '));
}

function inferDriverLabel(sentence, fallbackIndex = 1) {
  const source = String(sentence || '').trim();
  if (!source) return `Market Driver ${fallbackIndex}`;

  for (const pattern of DRIVER_LABEL_PATTERNS) {
    const match = source.match(pattern);
    if (match && match[1]) {
      const label = compactLabel(match[1], 4);
      if (label) return label;
    }
  }

  const tokens = source
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 4 && !DRIVER_STOPWORDS.has(token));

  const fallback = compactLabel(tokens.slice(0, 4).join(' '), 4);
  return fallback || `Market Driver ${fallbackIndex}`;
}

function sentenceSignalScore(sentence) {
  const text = String(sentence || '').toLowerCase();
  if (!text) return 0;

  let score = 0;
  if (CAUSAL_CONNECTORS.some((connector) => text.includes(connector))) score += 2;
  if (MARKET_SIGNAL_TERMS.some((term) => text.includes(term))) score += 1;
  if (/\d/.test(text)) score += 1;
  if (text.length >= 55) score += 1;

  return score;
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

  return null;
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
  const drivers = [];
  const seenEvidence = new Set();
  const now = new Date();

  const pushDriver = ({ label, evidence, source }) => {
    const cleanEvidence = String(evidence || '').trim();
    if (!cleanEvidence) return;

    const dedupeKey = normalizeToken(cleanEvidence);
    if (!dedupeKey || seenEvidence.has(dedupeKey)) return;
    seenEvidence.add(dedupeKey);

    const keySeed = normalizeToken(label || cleanEvidence).replace(/\s+/g, '_').slice(0, 48);
    drivers.push({
      key: keySeed || `driver_${drivers.length + 1}`,
      label: label || inferDriverLabel(cleanEvidence, drivers.length + 1),
      impact: classifyImpactDirection(cleanEvidence, trendPercent),
      evidence: cleanEvidence,
      hasEvidence: true,
      source: source || 'inferred',
    });
  };

  const seasonality = buildSeasonalityDriver(trendPercent, now);
  if (seasonality) {
    pushDriver({
      label: seasonality.label,
      evidence: seasonality.evidence,
      source: 'seasonality',
    });
  }

  const sentenceCandidates = [];

  for (const article of (Array.isArray(articles) ? articles : [])) {
    const articleSentences = splitIntoSentences(`${article?.title || ''}. ${article?.summary || ''}`);
    for (const sentence of articleSentences) {
      sentenceCandidates.push({
        sentence,
        source: 'article',
        score: sentenceSignalScore(sentence) + 1,
      });
    }
  }

  const aiSentences = splitIntoSentences(aiReasoning || '');
  for (const sentence of aiSentences) {
    sentenceCandidates.push({
      sentence,
      source: 'ai_reasoning',
      score: sentenceSignalScore(sentence),
    });
  }

  sentenceCandidates
    .filter((candidate) => candidate.score >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .forEach((candidate, index) => {
      pushDriver({
        label: inferDriverLabel(candidate.sentence, index + 1),
        evidence: candidate.sentence,
        source: candidate.source,
      });
    });

  if (drivers.length === 0) {
    const direction = trendPercent >= 0 ? 'increase' : 'decrease';
    const movementEvidence = `Observed retailer movement shows a ${Math.abs(trendPercent).toFixed(1)}% ${direction}; no high-confidence external event narrative is currently attached.`;
    pushDriver({
      label: 'Observed Retail Movement',
      evidence: movementEvidence,
      source: 'observed_data',
    });
  }

  return drivers.slice(0, 4);
}

function isRecentDate(value, maxAgeDays = 14) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return false;

  const ageMs = Date.now() - parsed.getTime();
  if (ageMs < 0) return false;
  return ageMs <= (Number(maxAgeDays) || 14) * 24 * 60 * 60 * 1000;
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

// Category rollup: map granular SKUs ("Red Russian Kale", "Lacinato
// Kale", "Dinosaur Kale", "Curly Kale", "Baby Kale", "Tuscan Kale",
// etc.) into a single bucket so the Retail Price Watch card doesn't
// get dominated by six variants of the same leafy green. Any product
// not matched by a rule falls through to its own bucket (no rollup).
const CATEGORY_ROLLUP_RULES = [
  { category: 'Kale',    pattern: /kale/i },
  { category: 'Basil',   pattern: /basil/i },
  { category: 'Lettuce', pattern: /lettuce|romaine|butterhead|iceberg|boston/i },
  { category: 'Arugula', pattern: /arugula|rocket/i },
  { category: 'Spinach', pattern: /spinach/i },
  { category: 'Chard',   pattern: /chard/i },
  { category: 'Mint',    pattern: /\bmint\b/i },
  { category: 'Cilantro',pattern: /cilantro|coriander/i },
  { category: 'Parsley', pattern: /parsley/i },
  { category: 'Microgreens', pattern: /microgreen/i },
];

function rollupCategoryForProduct(product) {
  const name = String(product || '');
  if (!name) return null;
  for (const rule of CATEGORY_ROLLUP_RULES) {
    if (rule.pattern.test(name)) return rule.category;
  }
  return null;
}

// Pick the "best" representative variant for a rolled-up category:
// prefer the one with the most national retailer coverage and the
// most observations. This is what the Price Watch card surfaces as
// e.g. "Kale +4.8%" instead of five near-duplicate kale rows.
function pickRepresentativeVariant(variants) {
  return variants.slice().sort((a, b) => {
    const retailerDelta = (b.nationalRetailerCount || 0) - (a.nationalRetailerCount || 0);
    if (retailerDelta !== 0) return retailerDelta;
    const obsDelta = (b.observationCount || 0) - (a.observationCount || 0);
    if (obsDelta !== 0) return obsDelta;
    return Math.abs(b.trendPercent || 0) - Math.abs(a.trendPercent || 0);
  })[0];
}

// Dedup granular SKUs into category-level entries. The representative
// keeps its per-variant fields (price, retailers, articles) but gains
// a `categoryLabel`, `variantCount`, and `variantProducts` array so
// the UI can still say "Kale (5 variants tracked)".
function rollupRecommendationsByCategory(recommendations) {
  const buckets = new Map();
  const passthrough = [];
  for (const entry of recommendations || []) {
    const category = rollupCategoryForProduct(entry.product);
    if (!category) {
      passthrough.push(entry);
      continue;
    }
    if (!buckets.has(category)) buckets.set(category, []);
    buckets.get(category).push(entry);
  }

  const rolled = [];
  for (const [category, variants] of buckets.entries()) {
    const rep = pickRepresentativeVariant(variants);
    if (!rep) continue;
    const averagedTrend = variants.reduce((acc, v) => acc + (v.trendPercent || 0), 0) / variants.length;
    rolled.push({
      ...rep,
      // Only overwrite the display name when we've actually merged
      // multiple variants. A lone "Red Russian Kale" should stay
      // "Red Russian Kale" in the UI rather than get genericised to
      // "Kale" just because it matches a rollup rule.
      categoryLabel: variants.length > 1 ? category : null,
      variantCount: variants.length,
      variantProducts: variants.map((v) => v.product),
      categoryAverageTrendPercent: averagedTrend,
      isCategoryRollup: variants.length > 1,
    });
  }

  return passthrough.concat(rolled);
}

// Outlier sanity gate. We surface a dashboard alert only if either
// (a) |trendPercent| is inside SUSPECT_CAP_PCT (default 100%), or
// (b) at least MIN_CONFIRM_RETAILERS distinct national retailers
// within the recency window corroborate the same direction of change.
// Entries that fail both get marked `dataQualityFlag: 'under_review'`
// so the UI can hide them from alerts (while still being available in
// the richer topSignals list for debugging).
const DEFAULT_SUSPECT_CAP_PCT = 100;
const DEFAULT_MIN_CONFIRM_RETAILERS = 2;

function applyOutlierSanityCap(recommendations, options = {}) {
  const capPct = Number.isFinite(options.capPct) ? options.capPct : DEFAULT_SUSPECT_CAP_PCT;
  const minConfirmRetailers = Number.isFinite(options.minConfirmRetailers)
    ? options.minConfirmRetailers
    : DEFAULT_MIN_CONFIRM_RETAILERS;

  return (recommendations || []).map((entry) => {
    const trendPct = Math.abs(entry.trendPercent || 0);
    if (trendPct <= capPct) return entry;

    const retailerCount = Math.max(
      entry.nationalRetailerCount || 0,
      Array.isArray(entry.retailers) ? entry.retailers.length : 0
    );
    if (retailerCount >= minConfirmRetailers) return entry;

    return {
      ...entry,
      dataQualityFlag: 'under_review',
      dataQualityReason: `Observed ${entry.change || `${trendPct.toFixed(1)}%`} swing exceeds ${capPct}% but fewer than ${minConfirmRetailers} national retailers confirmed it within the recency window.`,
    };
  });
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
    const dynamicArticles = Array.isArray(data.articles) ? data.articles : [];
    const staticArticles = Array.isArray(MARKET_DATA_SOURCES?.[product]?.articles)
      ? MARKET_DATA_SOURCES[product].articles
      : [];
    const articles = dynamicArticles.length > 0 ? dynamicArticles : staticArticles;

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
    const { threshold = 7, recencyDays = 14 } = req.query;
    const parsedThreshold = Number.parseFloat(threshold);
    const thresholdValue = Number.isFinite(parsedThreshold) ? Math.max(0, parsedThreshold) : 7;
    const parsedRecency = Number.parseInt(recencyDays, 10);
    const recencyWindowDays = Number.isFinite(parsedRecency)
      ? Math.max(1, Math.min(parsedRecency, 60))
      : 14;

    const pool = req.app?.locals?.dbPool;
    const [marketData, aiAnalyses] = await Promise.all([
      pool ? getMarketDataAsync(pool) : Promise.resolve(MARKET_DATA_SOURCES),
      pool ? getLatestAnalyses(pool) : Promise.resolve([]),
    ]);

    const fxRate = getLastFxRate();
    const rawRecommendations = buildPricingRecommendationsFromSignals(marketData, aiAnalyses, fxRate);

    // Dedup near-duplicate SKUs into a single category row (e.g. five
    // kale variants become one "Kale" entry) so the Retail Price Watch
    // card doesn't get visually swamped. Then drop / flag any entry
    // whose %-change is clearly an ingestion artefact.
    const rolledRecommendations = rollupRecommendationsByCategory(rawRecommendations);
    const sanitizedRecommendations = applyOutlierSanityCap(rolledRecommendations, {
      capPct: DEFAULT_SUSPECT_CAP_PCT,
      minConfirmRetailers: DEFAULT_MIN_CONFIRM_RETAILERS,
    });

    const nationallyMonitored = sanitizedRecommendations.filter((entry) => entry.nationalRetailerCount > 0);
    const monitoredPool = nationallyMonitored.length > 0 ? nationallyMonitored : sanitizedRecommendations;
    const recentPool = monitoredPool.filter((entry) => isRecentDate(entry.lastUpdated, recencyWindowDays));

    const toAlertEntry = (entry) => ({
      product: entry.categoryLabel || entry.product,
      category: entry.categoryLabel || null,
      variantCount: entry.variantCount || 1,
      variantProducts: entry.variantProducts || [entry.product],
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
      dataQualityFlag: entry.dataQualityFlag || null,
      dataQualityReason: entry.dataQualityReason || null,
    });

    const alerts = recentPool
      .filter((entry) => Math.abs(entry.trendPercent) >= thresholdValue)
      .filter((entry) => entry.dataQualityFlag !== 'under_review')
      .map(toAlertEntry)
      .sort((a, b) => Math.abs(parseFloat(b.change)) - Math.abs(parseFloat(a.change)));

    const topSignals = recentPool
      .slice(0, 5)
      .map((entry) => ({
        ...toAlertEntry(entry),
        aboveThreshold: Math.abs(entry.trendPercent) >= thresholdValue,
      }));

    const underReviewCount = recentPool.filter((entry) => entry.dataQualityFlag === 'under_review').length;
    const categoriesRolledUp = rolledRecommendations.filter((entry) => entry.isCategoryRollup).length;
    const aiLive = sanitizedRecommendations.some((entry) => entry.analysisFreshness === 'fresh');

    return res.json({
      ok: true,
      alerts,
      topSignals,
      timestamp: new Date().toISOString(),
      threshold: thresholdValue,
      recencyWindowDays,
      totalProductsMonitored: monitoredPool.length,
      recentlyChangedProducts: recentPool.length,
      alertsGenerated: alerts.length,
      categoriesRolledUp,
      underReviewCount,
      aiNarrativeLive: aiLive,
      displayLabel: aiLive ? 'Retail Price Watch + AI' : 'Retail Price Watch',
      outlierPolicy: {
        capPct: DEFAULT_SUSPECT_CAP_PCT,
        minConfirmRetailers: DEFAULT_MIN_CONFIRM_RETAILERS,
        note: `Changes greater than ${DEFAULT_SUSPECT_CAP_PCT}% require ${DEFAULT_MIN_CONFIRM_RETAILERS}+ national retailers within the recency window before they surface as alerts.`,
      },
      monitorScope: nationallyMonitored.length > 0 ? 'national_retailers' : 'all_retailers',
      sourceBasis: [
        'North American national retailer observations',
        aiLive ? 'AI movement-driver analysis' : 'AI narrative currently stale; showing retailer observations only',
      ],
      newsPolicy: 'Only verifiable external links are attached. Some crops may have no linked articles in the current feed.',
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
