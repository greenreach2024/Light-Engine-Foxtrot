/**
 * Cross-Farm Yield Regression — Phase 3, Ticket 3.2
 *
 * Central runs weekly:
 *   weight_per_plant ~ f(blue_pct, red_pct, ppfd, temp_c, humidity_pct, grow_days)
 *
 * Uses OLS linear regression (no external ML library — pure JS).
 * Publishes network recipe modifiers per crop to all farms via AI push channel.
 *
 * Schedule: called weekly by server.js setInterval or manual trigger.
 */

import { query } from '../config/database.js';

/**
 * Fetch all experiment records from Central's PostgreSQL database.
 * Schema: farm_id, crop, recipe_params_avg (jsonb), outcomes (jsonb), grow_days, recorded_at
 */
async function fetchExperimentRecords() {
  try {
    const result = await query(`
      SELECT
        farm_id,
        crop,
        grow_days,
        recipe_params_avg,
        outcomes,
        recorded_at
      FROM experiment_records
      WHERE outcomes->>'weight_per_plant_oz' IS NOT NULL
        AND recipe_params_avg->>'ppfd' IS NOT NULL
      ORDER BY recorded_at DESC
      LIMIT 5000
    `);
    return result.rows || [];
  } catch (err) {
    console.error('[yield-regression] Failed to fetch experiment records:', err.message);
    return [];
  }
}

/**
 * Simple OLS linear regression (multiple features).
 * Returns coefficients for: intercept + each feature.
 *
 * Uses normal equation: beta = (X^T X)^-1 X^T y
 * Good enough for <5000 rows and 6 features.
 */
function linearRegression(X, y) {
  const n = X.length;
  const p = X[0].length; // includes intercept column

  // X^T X
  const XtX = Array.from({ length: p }, () => Array(p).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < p; j++) {
      for (let k = 0; k < p; k++) {
        XtX[j][k] += X[i][j] * X[i][k];
      }
    }
  }

  // X^T y
  const Xty = Array(p).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < p; j++) {
      Xty[j] += X[i][j] * y[i];
    }
  }

  // Invert X^T X using Gauss-Jordan
  const inv = invertMatrix(XtX);
  if (!inv) return null;

  // beta = inv * Xty
  const beta = Array(p).fill(0);
  for (let j = 0; j < p; j++) {
    for (let k = 0; k < p; k++) {
      beta[j] += inv[j][k] * Xty[k];
    }
  }

  // R-squared
  const yMean = y.reduce((a, b) => a + b, 0) / n;
  let ssTot = 0, ssRes = 0;
  for (let i = 0; i < n; i++) {
    let yPred = 0;
    for (let j = 0; j < p; j++) yPred += X[i][j] * beta[j];
    ssRes += (y[i] - yPred) ** 2;
    ssTot += (y[i] - yMean) ** 2;
  }
  const rSquared = ssTot > 0 ? 1 - ssRes / ssTot : 0;

  return { beta, rSquared };
}

/**
 * Gauss-Jordan matrix inversion.
 */
function invertMatrix(matrix) {
  const n = matrix.length;
  const aug = matrix.map((row, i) => {
    const identity = Array(n).fill(0);
    identity[i] = 1;
    return [...row, ...identity];
  });

  for (let col = 0; col < n; col++) {
    // Partial pivoting
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(aug[row][col]) > Math.abs(aug[maxRow][col])) maxRow = row;
    }
    [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];

    const pivot = aug[col][col];
    if (Math.abs(pivot) < 1e-10) return null; // Singular

    for (let j = 0; j < 2 * n; j++) aug[col][j] /= pivot;

    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = aug[row][col];
      for (let j = 0; j < 2 * n; j++) {
        aug[row][j] -= factor * aug[col][j];
      }
    }
  }

  return aug.map(row => row.slice(n));
}

/**
 * Run yield regression for all crops with sufficient data.
 * Returns per-crop network recipe modifiers.
 */
export async function runYieldRegression() {
  console.log('[yield-regression] Starting cross-farm yield regression...');
  const records = await fetchExperimentRecords();
  if (records.length === 0) {
    console.log('[yield-regression] No experiment records available');
    return { modifiers: {}, computed_at: new Date().toISOString() };
  }

  // Group by crop
  const byCrop = {};
  for (const rec of records) {
    const crop = (rec.crop || '').toLowerCase();
    if (!crop) continue;
    if (!byCrop[crop]) byCrop[crop] = [];

    const rp = typeof rec.recipe_params_avg === 'string'
      ? JSON.parse(rec.recipe_params_avg)
      : rec.recipe_params_avg || {};
    const out = typeof rec.outcomes === 'string'
      ? JSON.parse(rec.outcomes)
      : rec.outcomes || {};

    const weight = parseFloat(out.weight_per_plant_oz);
    if (isNaN(weight) || weight <= 0) continue;

    byCrop[crop].push({
      blue_pct: parseFloat(rp.blue_pct) || 0,
      red_pct: parseFloat(rp.red_pct) || 0,
      ppfd: parseFloat(rp.ppfd) || 0,
      temp_c: parseFloat(rp.temp_c) || 0,
      humidity_pct: parseFloat(rp.humidity_pct) || 0,
      grow_days: parseInt(rec.grow_days) || 0,
      weight,
      farm_id: rec.farm_id
    });
  }

  const networkModifiers = {};
  const featureNames = ['intercept', 'blue_pct', 'red_pct', 'ppfd', 'temp_c', 'humidity_pct', 'grow_days'];

  for (const [crop, rows] of Object.entries(byCrop)) {
    if (rows.length < 10) {
      console.log(`[yield-regression] ${crop}: ${rows.length} records (need 10+), skipping`);
      continue;
    }

    // Build feature matrix with intercept column
    const X = rows.map(r => [1, r.blue_pct, r.red_pct, r.ppfd, r.temp_c, r.humidity_pct, r.grow_days]);
    const y = rows.map(r => r.weight);

    const result = linearRegression(X, y);
    if (!result) {
      console.warn(`[yield-regression] ${crop}: regression failed (singular matrix)`);
      continue;
    }

    const { beta, rSquared } = result;
    const confidence = Math.min(1, rSquared * 0.7 + Math.min(rows.length / 100, 0.3));

    // Compute optimal offsets from average: direction of positive coefficient
    const avgs = {
      blue_pct: rows.reduce((s, r) => s + r.blue_pct, 0) / rows.length,
      red_pct: rows.reduce((s, r) => s + r.red_pct, 0) / rows.length,
      ppfd: rows.reduce((s, r) => s + r.ppfd, 0) / rows.length,
      temp_c: rows.reduce((s, r) => s + r.temp_c, 0) / rows.length
    };

    // Suggest offsets: nudge in direction of positive coefficient, clamped to ±5%
    const clamp5 = v => Math.max(-5, Math.min(5, v));
    const ppfdNudge = avgs.ppfd > 0 ? clamp5(beta[3] / avgs.ppfd * 100 * 2) : 0;
    const blueNudge = clamp5(beta[1] * 2);
    const redNudge = clamp5(beta[2] * 2);
    const tempNudge = avgs.temp_c > 0 ? clamp5(beta[4] / avgs.temp_c * 100 * 2) : 0;

    networkModifiers[crop] = {
      ppfd_offset_pct: +ppfdNudge.toFixed(2),
      blue_pct_offset: +blueNudge.toFixed(2),
      red_pct_offset: +redNudge.toFixed(2),
      temp_offset_pct: +tempNudge.toFixed(2),
      confidence: +confidence.toFixed(2),
      r_squared: +rSquared.toFixed(3),
      record_count: rows.length,
      farm_count: new Set(rows.map(r => r.farm_id)).size,
      coefficients: Object.fromEntries(featureNames.map((name, i) => [name, +beta[i].toFixed(4)])),
      source: 'network_regression',
      computed_at: new Date().toISOString()
    };

    console.log(`[yield-regression] ${crop}: R²=${rSquared.toFixed(3)}, ${rows.length} records from ${networkModifiers[crop].farm_count} farms`);
  }

  const result = {
    modifiers: networkModifiers,
    computed_at: new Date().toISOString(),
    crop_count: Object.keys(networkModifiers).length,
    total_records: records.length
  };

  // Store in database for push channel
  try {
    await query(`
      INSERT INTO network_recipe_modifiers (modifiers, computed_at)
      VALUES ($1, NOW())
      ON CONFLICT (id) DO UPDATE SET modifiers = $1, computed_at = NOW()
    `, [JSON.stringify(result)]);
  } catch (err) {
    // Table may not exist yet — that's OK, the pusher will query experiment records directly
    console.warn('[yield-regression] Could not persist to DB (table may not exist):', err.message);
  }

  console.log(`[yield-regression] Complete: ${result.crop_count} crops with modifiers`);
  return result;
}

/**
 * Get the latest network modifiers (for the push channel).
 */
export async function getNetworkModifiers() {
  try {
    const result = await query(`
      SELECT modifiers FROM network_recipe_modifiers
      ORDER BY computed_at DESC LIMIT 1
    `);
    if (result.rows?.[0]?.modifiers) {
      return typeof result.rows[0].modifiers === 'string'
        ? JSON.parse(result.rows[0].modifiers)
        : result.rows[0].modifiers;
    }
  } catch {
    // Table doesn't exist or no data
  }
  return { modifiers: {}, computed_at: null };
}

export default { runYieldRegression, getNetworkModifiers };
