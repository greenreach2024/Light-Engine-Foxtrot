/**
 * Market Data Fetcher — Phase 1A
 *
 * Daily job: fetches wholesale produce prices from the USDA AMS terminal
 * market reports, converts USD → CAD via Bank of Canada, and stores
 * observations in `market_price_observations`.  Then calls
 * `refreshPriceTrends()` so the trend table stays current.
 *
 * Data flow:
 *   USDA MARS API → USD prices → Bank of Canada FX → CAD prices
 *   → recordPriceObservationsBatch() → refreshPriceTrends()
 *
 * Environment variables:
 *   USDA_API_KEY   – Optional. If set, queries USDA MARS v1.2.
 *                    If absent, the job logs a warning and uses fallback
 *                    prices from usda-crop-mapping.json so the pipeline
 *                    is never empty.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  recordPriceObservationsBatch,
  refreshPriceTrends,
} from './market-intelligence-service.js';
import { getDatabase, isDatabaseAvailable } from '../config/database.js';
import logger from '../utils/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Config ──────────────────────────────────────────────────────────────────

const USDA_API_KEY = process.env.USDA_API_KEY || '';
const USDA_BASE_URL = 'https://marsapi.ams.usda.gov/services/v1.2/reports';
const BOC_FX_URL = 'https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?recent=1';
const FALLBACK_FX_RATE = 1.36; // reasonable fallback if BOC API is down

let _lastFxRate = FALLBACK_FX_RATE;
let _lastFxFetch = 0;
const FX_CACHE_TTL = 12 * 60 * 60 * 1000; // 12 hours

// Load crop mapping at module init
let cropMapping = { crops: {} };
try {
  const raw = readFileSync(join(__dirname, '..', 'data', 'usda-crop-mapping.json'), 'utf8');
  cropMapping = JSON.parse(raw);
  logger.info(`[MarketFetcher] Loaded ${Object.keys(cropMapping.crops).length} crop mappings`);
} catch (err) {
  logger.warn('[MarketFetcher] Could not load usda-crop-mapping.json — using empty mapping', err.message);
}

// ── FX Rate ─────────────────────────────────────────────────────────────────

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

// ── USDA Fetch ──────────────────────────────────────────────────────────────

/**
 * Fetch terminal market prices from USDA AMS for our mapped commodities.
 * Returns array of { product, retailer, price_usd, unit }.
 */
async function fetchUSDATerminalPrices() {
  if (!USDA_API_KEY) {
    logger.info('[MarketFetcher] No USDA_API_KEY — using fallback prices');
    return null; // signals caller to use fallback
  }

  const observations = [];
  // Unique USDA commodity names from our mapping
  const usdaNames = [...new Set(
    Object.values(cropMapping.crops).map(c => c.usdaName)
  )];

  for (const commodity of usdaNames) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const url = `${USDA_BASE_URL}?api_key=${encodeURIComponent(USDA_API_KEY)}&commodity=${encodeURIComponent(commodity)}&report=terminal&recent=7`;
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      if (!res.ok) {
        logger.warn(`[MarketFetcher] USDA ${commodity}: HTTP ${res.status}`);
        continue;
      }

      const json = await res.json();
      const results = json?.results || json?.data || [];
      if (!Array.isArray(results) || results.length === 0) continue;

      // Each result has: commodity_name, city_name, low_price, high_price, mostly_low, mostly_high, unit_of_sale, report_date
      for (const r of results) {
        const avgPrice = ((parseFloat(r.low_price) || 0) + (parseFloat(r.high_price) || 0)) / 2;
        if (avgPrice <= 0) continue;

        observations.push({
          product: commodity,
          retailer: r.city_name || 'USDA Terminal',
          price_usd: avgPrice,
          unit: mapUsdaUnit(r.unit_of_sale),
        });
      }
    } catch (err) {
      logger.warn(`[MarketFetcher] USDA fetch for ${commodity} failed:`, err.message);
    }
  }

  return observations.length > 0 ? observations : null;
}

function mapUsdaUnit(usdaUnit) {
  if (!usdaUnit) return 'per_lb';
  const u = usdaUnit.toLowerCase();
  if (u.includes('bunch')) return 'per_bunch';
  if (u.includes('head')) return 'per_head';
  if (u.includes('carton') || u.includes('crate')) return 'per_case';
  if (u.includes('oz')) return 'per_oz';
  return 'per_lb';
}

// ── Fallback Generator ─────────────────────────────────────────────────────

/**
 * Generate simulated market observations from the mapping fallback prices +
 * realistic daily variation. This keeps the pipeline flowing even without
 * a USDA key, so downstream AI analysis always has data.
 */
function generateFallbackObservations() {
  const obs = [];
  const retailers = cropMapping.retailers || ['Whole Foods', 'Sobeys', 'Metro', 'Loblaws'];

  for (const [product, config] of Object.entries(cropMapping.crops)) {
    const base = config.fallbackCAD;
    if (!base) continue;

    // Pick 2-3 random retailers for this product
    const picked = retailers
      .sort(() => Math.random() - 0.5)
      .slice(0, 2 + Math.floor(Math.random() * 2));

    for (const retailer of picked) {
      // +/- 12% realistic variation
      const variation = 1 + (Math.random() * 0.24 - 0.12);
      obs.push({
        product,
        retailer,
        price_cad: +(base * variation).toFixed(2),
        unit: config.unit || 'per_lb',
        source: 'fallback',
      });
    }
  }
  return obs;
}

// ── Main Fetch Cycle ────────────────────────────────────────────────────────

/**
 * Run one fetch cycle: get prices, convert currencies, record observations,
 * refresh trends.  Called by the daily scheduler.
 */
export async function runMarketDataFetch() {
  if (!isDatabaseAvailable()) {
    logger.warn('[MarketFetcher] Database not available — skipping');
    return { status: 'skipped', reason: 'no_database' };
  }

  const pool = getDatabase();
  const fxRate = await fetchUsdCadRate();

  // Try USDA first, fall back to generated data
  let rawObs = await fetchUSDATerminalPrices();
  let source = 'usda';

  if (!rawObs) {
    rawObs = generateFallbackObservations();
    source = 'fallback';
  }

  // Convert USD → CAD for USDA data (fallback is already CAD)
  const observations = rawObs.map(obs => {
    const priceCAD = source === 'usda'
      ? +(obs.price_usd * fxRate).toFixed(2)
      : obs.price_cad;
    return {
      product: obs.product,
      retailer: obs.retailer,
      price_cad: priceCAD,
      unit: obs.unit || 'per_lb',
      source,
    };
  });

  // Resolve USDA commodity names back to our crop-registry resolveAs names
  const resolvedObs = observations.map(obs => {
    // Find the first mapping entry whose usdaName matches
    const match = Object.entries(cropMapping.crops).find(
      ([, cfg]) => cfg.usdaName === obs.product
    );
    return {
      ...obs,
      product: match ? match[0] : obs.product,
    };
  });

  // Record in DB
  const results = await recordPriceObservationsBatch(pool, resolvedObs);
  const successes = results.filter(r => r.ok).length;
  const failures = results.filter(r => !r.ok).length;

  // Refresh trend table
  await refreshPriceTrends(pool);

  const summary = {
    status: 'completed',
    source,
    fxRate: fxRate.toFixed(4),
    observations: resolvedObs.length,
    recorded: successes,
    failed: failures,
    timestamp: new Date().toISOString(),
  };

  logger.info(`[MarketFetcher] ${source} fetch complete — ${successes} recorded, ${failures} failed, FX ${fxRate.toFixed(4)}`);
  return summary;
}

// ── Scheduler ───────────────────────────────────────────────────────────────

let _intervalHandle = null;
const FETCH_INTERVAL_MS = 24 * 60 * 60 * 1000; // Daily
const INITIAL_DELAY_MS = 2 * 60 * 1000; // 2 min after boot

export function startMarketDataFetcher() {
  logger.info('[MarketFetcher] Starting daily market data fetcher');

  // First run after short delay (let DB settle)
  setTimeout(async () => {
    try {
      await runMarketDataFetch();
    } catch (err) {
      logger.error('[MarketFetcher] Initial fetch failed:', err.message);
    }
  }, INITIAL_DELAY_MS);

  // Then daily
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

/** Return the most recent USD/CAD FX rate (cached from Bank of Canada). */
export function getLastFxRate() {
  return _lastFxRate;
}
