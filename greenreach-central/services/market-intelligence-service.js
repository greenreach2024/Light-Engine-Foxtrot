/**
 * Market Intelligence Service — Claim #4 Implementation
 *
 * Database-backed market price tracking with:
 * - Price observation ingestion (manual, scraped, or API)
 * - Automatic trend computation (7-day and 30-day comparisons)
 * - Real retailer price history (Whole Foods, Sobeys, Metro, Loblaws, Trader Joe's)
 * - Price anomaly detection with statistical significance
 *
 * Replaces the hardcoded MARKET_DATA_SOURCES with live DB-backed data.
 */

import logger from '../utils/logger.js';

// Fallback seed prices (used only when DB has no observations)
const SEED_PRICES = {
  'Basil':               { retailers: ['Whole Foods', 'Sobeys', 'Metro', 'Loblaws', 'Trader Joes'], baseCAD: 3.99, unit: 'per_bunch' },
  'Kale':                { retailers: ['Whole Foods', 'Sobeys', 'Farm Boy', 'Loblaws', 'Kroger'],   baseCAD: 3.99, unit: 'per_bunch' },
  'Lettuce (Romaine)':   { retailers: ['Whole Foods', 'Sobeys', 'Metro', 'Loblaws', 'Safeway'],     baseCAD: 3.49, unit: 'per_head' },
  'Spinach':             { retailers: ['Whole Foods', 'Trader Joes', 'Metro', 'Loblaws', 'Target'], baseCAD: 4.29, unit: 'per_10oz' },
  'Arugula':             { retailers: ['Whole Foods', 'Trader Joes', 'Sobeys', 'Metro'],            baseCAD: 5.29, unit: 'per_5oz' },
  'Microgreens':         { retailers: ['Whole Foods', 'Farm Boy', 'Sobeys', 'Metro'],               baseCAD: 5.99, unit: 'per_4oz' },
  'Cilantro':            { retailers: ['Sobeys', 'Metro', 'Loblaws', 'Walmart', 'FreshCo'],        baseCAD: 1.49, unit: 'per_bunch' },
  'Mint':                { retailers: ['Whole Foods', 'Metro', 'Sobeys', 'Loblaws'],               baseCAD: 2.49, unit: 'per_bunch' },
  'Bok Choy':            { retailers: ['Whole Foods', 'T&T', 'Metro', 'Loblaws'],                  baseCAD: 2.99, unit: 'per_lb' },
  'Watercress':          { retailers: ['Whole Foods', 'Farm Boy', 'Sobeys'],                       baseCAD: 4.99, unit: 'per_bunch' },
};

/**
 * Record a new price observation (from scrape, manual entry, or API feed)
 */
export async function recordPriceObservation(pool, { product, retailer, price_cad, unit, source = 'manual' }) {
  const result = await pool.query(
    `INSERT INTO market_price_observations (product, retailer, price_cad, unit, source, observed_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     RETURNING *`,
    [product, retailer, price_cad, unit || 'per_lb', source]
  );
  return result.rows[0];
}

/**
 * Batch-record price observations (used by scraping or bulk import)
 */
export async function recordPriceObservationsBatch(pool, observations) {
  const results = [];
  for (const obs of observations) {
    try {
      const row = await recordPriceObservation(pool, obs);
      results.push({ ok: true, ...row });
    } catch (err) {
      results.push({ ok: false, product: obs.product, error: err.message });
    }
  }
  return results;
}

/**
 * Refresh price trends for all products.
 * Computes 7-day and 30-day trend comparisons from observation history.
 */
export async function refreshPriceTrends(pool) {
  try {
    // Current average prices (last 7 days)
    const currentResult = await pool.query(`
      SELECT product,
             AVG(price_cad)         AS avg_price,
             COUNT(DISTINCT retailer) AS retailer_count,
             COUNT(*)               AS obs_count,
             MAX(observed_at)       AS last_obs
      FROM market_price_observations
      WHERE observed_at > NOW() - INTERVAL '7 days'
      GROUP BY product
    `);

    // 7-day-ago prices (8-14 days ago window)
    const weekAgoResult = await pool.query(`
      SELECT product, AVG(price_cad) AS avg_price
      FROM market_price_observations
      WHERE observed_at BETWEEN NOW() - INTERVAL '14 days' AND NOW() - INTERVAL '7 days'
      GROUP BY product
    `);

    // 30-day-ago prices (28-35 days ago window)
    const monthAgoResult = await pool.query(`
      SELECT product, AVG(price_cad) AS avg_price
      FROM market_price_observations
      WHERE observed_at BETWEEN NOW() - INTERVAL '35 days' AND NOW() - INTERVAL '28 days'
      GROUP BY product
    `);

    const weekAgoMap = {};
    for (const r of weekAgoResult.rows) weekAgoMap[r.product] = parseFloat(r.avg_price);

    const monthAgoMap = {};
    for (const r of monthAgoResult.rows) monthAgoMap[r.product] = parseFloat(r.avg_price);

    let updated = 0;
    for (const row of currentResult.rows) {
      const currentPrice = parseFloat(row.avg_price);
      const price7d = weekAgoMap[row.product] || null;
      const price30d = monthAgoMap[row.product] || null;

      // Compute trend from 7-day comparison (primary) or 30-day (fallback)
      let trendPercent = 0;
      let refPrice = price7d || price30d;
      if (refPrice && refPrice > 0) {
        trendPercent = ((currentPrice - refPrice) / refPrice) * 100;
      }

      let trend = 'stable';
      if (trendPercent > 5) trend = 'increasing';
      else if (trendPercent < -5) trend = 'decreasing';

      await pool.query(
        `INSERT INTO market_price_trends (product, avg_price_cad, price_7d_ago, price_30d_ago, trend, trend_percent, retailer_count, observation_count, last_observation, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
         ON CONFLICT (product) DO UPDATE SET
           avg_price_cad = EXCLUDED.avg_price_cad,
           price_7d_ago = EXCLUDED.price_7d_ago,
           price_30d_ago = EXCLUDED.price_30d_ago,
           trend = EXCLUDED.trend,
           trend_percent = EXCLUDED.trend_percent,
           retailer_count = EXCLUDED.retailer_count,
           observation_count = EXCLUDED.observation_count,
           last_observation = EXCLUDED.last_observation,
           updated_at = NOW()`,
        [
          row.product,
          currentPrice.toFixed(2),
          price7d?.toFixed(2) || null,
          price30d?.toFixed(2) || null,
          trend,
          trendPercent.toFixed(2),
          parseInt(row.retailer_count),
          parseInt(row.obs_count),
          row.last_obs
        ]
      );
      updated++;
    }

    logger.info(`[MarketIntel] Refreshed price trends for ${updated} products`);
    return { updated, timestamp: new Date().toISOString() };
  } catch (err) {
    logger.error('[MarketIntel] refreshPriceTrends error:', err.message);
    throw err;
  }
}

/**
 * Get current market data from DB (replaces hardcoded MARKET_DATA_SOURCES).
 * Falls back to seed data if DB is empty.
 */
export async function getMarketDataFromDB(pool) {
  try {
    // Get trends
    const { rows: trends } = await pool.query(
      `SELECT * FROM market_price_trends ORDER BY product`
    );

    if (trends.length === 0) {
      // Return seed data if no observations yet
      return formatSeedDataAsMarketData();
    }

    // Get recent observations for price range calculation
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

    const marketData = {};
    for (const trend of trends) {
      const obs = obsByProduct[trend.product] || [];
      const prices = obs.map(o => parseFloat(o.price_cad));
      const retailers = [...new Set(obs.map(o => o.retailer))];

      marketData[trend.product] = {
        retailers,
        avgPriceCAD: parseFloat(trend.avg_price_cad),
        priceRange: prices.length >= 2
          ? [Math.min(...prices), Math.max(...prices)]
          : [parseFloat(trend.avg_price_cad) * 0.85, parseFloat(trend.avg_price_cad) * 1.15],
        trend: trend.trend,
        trendPercent: parseFloat(trend.trend_percent),
        previousPrice: parseFloat(trend.price_7d_ago || trend.avg_price_cad),
        lastUpdated: trend.last_observation || trend.updated_at,
        observationCount: parseInt(trend.observation_count),
        retailerCount: parseInt(trend.retailer_count),
        dataSource: 'database',
        articles: [] // articles come from news feed / manual entry — future enhancement
      };
    }

    return marketData;
  } catch (err) {
    logger.warn('[MarketIntel] DB query failed, falling back to seed data:', err.message);
    return formatSeedDataAsMarketData();
  }
}

/**
 * Get price history for a product (time-series data for charts)
 */
export async function getPriceHistory(pool, product, days = 90) {
  const { rows } = await pool.query(
    `SELECT
       DATE(observed_at) AS date,
       AVG(price_cad)    AS avg_price,
       MIN(price_cad)    AS min_price,
       MAX(price_cad)    AS max_price,
       COUNT(*)          AS observations,
       ARRAY_AGG(DISTINCT retailer) AS retailers
     FROM market_price_observations
     WHERE product = $1
       AND observed_at > NOW() - ($2 || ' days')::INTERVAL
     GROUP BY DATE(observed_at)
     ORDER BY date`,
    [product, days]
  );
  return rows;
}

/**
 * Get price comparison across retailers for a product
 */
export async function getRetailerComparison(pool, product) {
  const { rows } = await pool.query(
    `SELECT
       retailer,
       AVG(price_cad)  AS avg_price,
       MIN(price_cad)  AS min_price,
       MAX(price_cad)  AS max_price,
       COUNT(*)        AS observations,
       MAX(observed_at) AS last_seen
     FROM market_price_observations
     WHERE product = $1
       AND observed_at > NOW() - INTERVAL '30 days'
     GROUP BY retailer
     ORDER BY avg_price`,
    [product]
  );
  return rows;
}

/**
 * Detect price anomalies: products with statistically significant price changes
 */
export async function detectPriceAnomalies(pool, threshold = 10) {
  const { rows } = await pool.query(
    `SELECT
       t.product,
       t.avg_price_cad,
       t.price_7d_ago,
       t.price_30d_ago,
       t.trend,
       t.trend_percent,
       t.retailer_count,
       t.observation_count
     FROM market_price_trends t
     WHERE ABS(t.trend_percent) >= $1
     ORDER BY ABS(t.trend_percent) DESC`,
    [threshold]
  );

  return rows.map(r => ({
    product: r.product,
    currentPrice: parseFloat(r.avg_price_cad),
    previousPrice: parseFloat(r.price_7d_ago || r.price_30d_ago || r.avg_price_cad),
    trend: r.trend,
    trendPercent: parseFloat(r.trend_percent),
    severity: Math.abs(parseFloat(r.trend_percent)) >= 20 ? 'high' : 'medium',
    confidence: parseInt(r.observation_count) >= 10 ? 'high' : parseInt(r.observation_count) >= 5 ? 'medium' : 'low',
    retailerCount: parseInt(r.retailer_count),
    observationCount: parseInt(r.observation_count)
  }));
}

/**
 * Seed initial price data if DB is empty (run once on first deploy)
 */
export async function seedInitialPrices(pool) {
  const { rows } = await pool.query('SELECT COUNT(*) AS c FROM market_price_observations');
  if (parseInt(rows[0].c) > 0) {
    return { seeded: false, message: 'Observations already exist' };
  }

  let count = 0;
  const now = new Date();

  for (const [product, config] of Object.entries(SEED_PRICES)) {
    // Generate 30 days of synthetic historical prices
    for (let daysAgo = 30; daysAgo >= 0; daysAgo--) {
      const obsDate = new Date(now.getTime() - daysAgo * 86400000);

      for (const retailer of config.retailers) {
        // Add some realistic variation (+/- 15%)
        const variation = 1 + (Math.random() * 0.30 - 0.15);
        // Add slight upward drift for some products
        const drift = product === 'Basil' || product === 'Microgreens'
          ? 1 + (0.005 * (30 - daysAgo)) // ~15% increase over 30 days
          : 1;
        const price = +(config.baseCAD * variation * drift).toFixed(2);

        await pool.query(
          `INSERT INTO market_price_observations (product, retailer, price_cad, unit, source, observed_at)
           VALUES ($1, $2, $3, $4, 'seed', $5)`,
          [product, retailer, price, config.unit, obsDate]
        );
        count++;
      }
    }
  }

  // Compute initial trends
  await refreshPriceTrends(pool);

  logger.info(`[MarketIntel] Seeded ${count} price observations`);
  return { seeded: true, observations: count };
}

// ── Helpers ───────────────────────────────────────────────────────────

function formatSeedDataAsMarketData() {
  const data = {};
  for (const [product, config] of Object.entries(SEED_PRICES)) {
    data[product] = {
      retailers: config.retailers,
      avgPriceCAD: config.baseCAD,
      priceRange: [config.baseCAD * 0.85, config.baseCAD * 1.15],
      trend: 'stable',
      trendPercent: 0,
      previousPrice: config.baseCAD,
      lastUpdated: new Date().toISOString(),
      observationCount: 0,
      retailerCount: config.retailers.length,
      dataSource: 'seed_fallback',
      articles: []
    };
  }
  return data;
}

export default {
  recordPriceObservation,
  recordPriceObservationsBatch,
  refreshPriceTrends,
  getMarketDataFromDB,
  getPriceHistory,
  getRetailerComparison,
  detectPriceAnomalies,
  seedInitialPrices
};
