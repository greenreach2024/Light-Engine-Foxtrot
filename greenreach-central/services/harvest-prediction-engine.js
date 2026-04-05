/**
 * Harvest Prediction Engine — Claim #17 Implementation
 *
 * Statistical harvest predictions with:
 * - Mean + standard deviation of grow cycle durations per crop per farm
 * - Confidence intervals (68%/95%) based on historical variance
 * - Growth rate modeling from recent performance trends
 * - Multi-factor confidence scoring (data volume, recency, consistency)
 * - 3/7/14/30 day prediction windows with probability estimates
 *
 * Replaces simple arithmetic (seedDate + avgGrowDays) with real statistical model.
 */

import logger from '../utils/logger.js';

/**
 * Generate statistical harvest predictions for a farm or across the network.
 *
 * @param {Object} pool - Database connection pool
 * @param {Object} opts - { farmId, horizonDays, minHarvests }
 * @returns {Object} predictions with statistical confidence
 */
export async function generateHarvestPredictions(pool, opts = {}) {
  const farmId = opts.farmId || null;
  const horizonDays = opts.horizonDays || 45;
  const minHarvests = opts.minHarvests || 3;

  try {
    // Get harvest history with per-record grow durations
    const farmFilter = farmId ? 'AND er.farm_id = $1' : '';
    const params = farmId ? [farmId] : [];

    const { rows } = await pool.query(`
      SELECT
        er.farm_id,
        f.name AS farm_name,
        er.crop,
        er.recorded_at,
        COALESCE(
          (er.outcomes->>'grow_days')::float,
          er.planned_grow_days,
          28
        ) AS grow_days,
        (er.outcomes->>'weight_per_plant_oz')::float AS weight_oz,
        (er.outcomes->>'quality_score')::float AS quality_score,
        er.planned_grow_days
      FROM experiment_records er
      JOIN farms f ON f.farm_id = er.farm_id
      WHERE er.recorded_at > NOW() - INTERVAL '180 days'
        ${farmFilter}
      ORDER BY er.farm_id, er.crop, er.recorded_at DESC
    `, params);

    // Group by farm + crop
    const groups = {};
    for (const row of rows) {
      const key = `${row.farm_id}::${row.crop}`;
      if (!groups[key]) {
        groups[key] = {
          farm_id: row.farm_id,
          farm_name: row.farm_name,
          crop: row.crop,
          harvests: []
        };
      }
      groups[key].harvests.push({
        date: new Date(row.recorded_at),
        grow_days: parseFloat(row.grow_days),
        weight_oz: row.weight_oz ? parseFloat(row.weight_oz) : null,
        quality_score: row.quality_score ? parseFloat(row.quality_score) : null,
        planned_grow_days: row.planned_grow_days
      });
    }

    const now = new Date();
    const predictions = [];

    for (const group of Object.values(groups)) {
      if (group.harvests.length < minHarvests) continue;

      const stats = computeHarvestStatistics(group.harvests);
      const prediction = buildPrediction(group, stats, now, horizonDays);

      if (prediction) {
        predictions.push(prediction);
      }
    }

    // Sort by days until available
    predictions.sort((a, b) => a.days_until_available - b.days_until_available);

    logger.info(`[HarvestPredict] Generated ${predictions.length} statistical predictions`);

    return {
      ok: true,
      predictions,
      count: predictions.length,
      horizon_days: horizonDays,
      generated_at: now.toISOString(),
      methodology: 'Statistical model using mean + standard deviation of historical grow cycles with multi-factor confidence scoring'
    };
  } catch (err) {
    logger.error('[HarvestPredict] Error:', err.message);
    return { ok: false, predictions: [], count: 0, error: err.message };
  }
}

/**
 * Compute statistical properties of a harvest history series.
 */
function computeHarvestStatistics(harvests) {
  const growDays = harvests.map(h => h.grow_days).filter(d => d > 0 && d < 120);
  const weights = harvests.map(h => h.weight_oz).filter(w => w != null && w > 0);
  const qualities = harvests.map(h => h.quality_score).filter(q => q != null);

  // ── Grow cycle statistics ──
  const n = growDays.length;
  const mean = growDays.reduce((s, d) => s + d, 0) / n;
  const variance = growDays.reduce((s, d) => s + (d - mean) ** 2, 0) / (n - 1 || 1);
  const stdDev = Math.sqrt(variance);
  const coeffOfVariation = mean > 0 ? (stdDev / mean) * 100 : 0;

  // Confidence interval (t-distribution approximation for small samples)
  const tValue = n >= 30 ? 1.96 : n >= 15 ? 2.13 : n >= 10 ? 2.26 : n >= 5 ? 2.78 : 4.30;
  const marginOfError = tValue * (stdDev / Math.sqrt(n));

  // ── Recent trend (are grow cycles getting shorter/longer?) ──
  let recentTrend = 0;
  if (growDays.length >= 4) {
    const recentHalf = growDays.slice(0, Math.floor(n / 2));
    const olderHalf = growDays.slice(Math.floor(n / 2));
    const recentMean = recentHalf.reduce((s, d) => s + d, 0) / recentHalf.length;
    const olderMean = olderHalf.reduce((s, d) => s + d, 0) / olderHalf.length;
    recentTrend = recentMean - olderMean; // negative = getting faster
  }

  // ── Yield statistics ──
  const yieldMean = weights.length > 0
    ? weights.reduce((s, w) => s + w, 0) / weights.length
    : null;
  const yieldStdDev = weights.length > 1
    ? Math.sqrt(weights.reduce((s, w) => s + (w - yieldMean) ** 2, 0) / (weights.length - 1))
    : null;

  // ── Quality statistics ──
  const qualityMean = qualities.length > 0
    ? qualities.reduce((s, q) => s + q, 0) / qualities.length
    : null;

  // ── Inter-harvest interval (time between successive harvests) ──
  const sortedDates = harvests.map(h => h.date).sort((a, b) => a - b);
  const intervals = [];
  for (let i = 1; i < sortedDates.length; i++) {
    intervals.push((sortedDates[i] - sortedDates[i - 1]) / 86400000);
  }
  const avgInterval = intervals.length > 0
    ? intervals.reduce((s, d) => s + d, 0) / intervals.length
    : mean;

  return {
    sample_size: n,
    grow_days: {
      mean: +mean.toFixed(1),
      std_dev: +stdDev.toFixed(1),
      coeff_of_variation: +coeffOfVariation.toFixed(1),
      min: Math.min(...growDays),
      max: Math.max(...growDays),
      confidence_interval_95: {
        lower: +(mean - marginOfError).toFixed(1),
        upper: +(mean + marginOfError).toFixed(1)
      },
      margin_of_error: +marginOfError.toFixed(1),
      recent_trend_days: +recentTrend.toFixed(1)
    },
    yield: yieldMean ? {
      mean_oz: +yieldMean.toFixed(2),
      std_dev_oz: yieldStdDev ? +yieldStdDev.toFixed(2) : null
    } : null,
    quality: qualityMean ? {
      mean: +qualityMean.toFixed(2)
    } : null,
    harvest_interval: {
      avg_days: +avgInterval.toFixed(1)
    },
    last_harvest: sortedDates[sortedDates.length - 1]
  };
}

/**
 * Build a prediction from statistical data.
 */
function buildPrediction(group, stats, now, horizonDays) {
  const lastHarvest = stats.last_harvest;
  const daysSinceLast = (now - lastHarvest) / 86400000;

  // Use the average interval to estimate next harvest start,
  // then apply grow cycle mean for estimation
  const expectedCycleDays = stats.grow_days.mean;
  const daysToNext = Math.max(0, expectedCycleDays - daysSinceLast);
  const estimatedDate = new Date(now.getTime() + daysToNext * 86400000);

  // Skip if too far out
  if (daysToNext > horizonDays) return null;

  // ── Multi-factor confidence score ──
  let confidence = 0.40; // base

  // Factor 1: Data volume (more harvests → more confident)
  if (stats.sample_size >= 20) confidence += 0.20;
  else if (stats.sample_size >= 10) confidence += 0.15;
  else if (stats.sample_size >= 5) confidence += 0.10;
  else confidence += 0.03;

  // Factor 2: Consistency (low coefficient of variation → more confident)
  if (stats.grow_days.coeff_of_variation < 10) confidence += 0.15;
  else if (stats.grow_days.coeff_of_variation < 20) confidence += 0.10;
  else if (stats.grow_days.coeff_of_variation < 30) confidence += 0.05;

  // Factor 3: Recency (recent harvests → more confident)
  if (daysSinceLast < expectedCycleDays) confidence += 0.12;
  else if (daysSinceLast < expectedCycleDays * 1.5) confidence += 0.06;

  // Factor 4: Quality consistency
  if (stats.quality?.mean >= 8) confidence += 0.08;
  else if (stats.quality?.mean >= 6) confidence += 0.04;

  confidence = Math.min(0.95, +confidence.toFixed(2));

  // ── Prediction windows ──
  const windows = {
    earliest: new Date(now.getTime() + Math.max(0, daysToNext - stats.grow_days.std_dev) * 86400000),
    expected: estimatedDate,
    latest:   new Date(now.getTime() + (daysToNext + stats.grow_days.std_dev) * 86400000)
  };

  // ── Probability of being ready by specific dates ──
  const readyBy = {};
  for (const checkDays of [3, 7, 14, 30]) {
    const targetDate = new Date(now.getTime() + checkDays * 86400000);
    // Use normal distribution CDF approximation
    const z = (checkDays - daysToNext) / (stats.grow_days.std_dev || 1);
    readyBy[`${checkDays}_days`] = {
      date: targetDate.toISOString().split('T')[0],
      probability: +normalCDF(z).toFixed(2)
    };
  }

  // Estimated quantity
  const estimatedCases = stats.yield
    ? Math.max(1, Math.round((stats.yield.mean_oz * 50) / (5 * 16))) // 5lb cases
    : 1;

  return {
    type: 'statistical_prediction',
    farm_id: group.farm_id,
    farm_name: group.farm_name,
    crop: group.crop,

    // Prediction
    estimated_available_date: estimatedDate.toISOString().split('T')[0],
    days_until_available: Math.round(daysToNext),
    available_now: daysToNext <= 0,

    // Confidence
    confidence,
    confidence_label: confidence >= 0.80 ? 'high' : confidence >= 0.60 ? 'medium' : 'low',

    // Statistical detail
    prediction_window: {
      earliest: windows.earliest.toISOString().split('T')[0],
      expected: windows.expected.toISOString().split('T')[0],
      latest: windows.latest.toISOString().split('T')[0],
      range_days: +(stats.grow_days.std_dev * 2).toFixed(1),
      note: `68% chance harvest occurs between ${windows.earliest.toISOString().split('T')[0]} and ${windows.latest.toISOString().split('T')[0]}`
    },

    ready_by_probability: readyBy,

    // Statistics
    statistics: stats,

    // Estimated yield
    estimated_quantity: estimatedCases,
    unit: 'case',
    avg_quality_score: stats.quality?.mean || null,

    // Display
    display_text: daysToNext <= 0
      ? `Available now from ${group.farm_name} (${Math.round(confidence * 100)}% confidence)`
      : `Available ${estimatedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ±${Math.round(stats.grow_days.std_dev)}d (${Math.round(confidence * 100)}% confidence)`
  };
}

/**
 * Normal CDF approximation (Abramowitz and Stegun)
 */
function normalCDF(z) {
  if (z < -6) return 0;
  if (z > 6) return 1;

  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.sqrt(2);
  const t = 1 / (1 + p * x);

  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

  return 0.5 * (1 + sign * y);
}

/**
 * Get aggregated prediction summary for the wholesale catalog.
 * This is the enhanced replacement for generatePredictedInventory().
 */
export async function generatePredictedInventoryEnhanced(pool) {
  const result = await generateHarvestPredictions(pool, {
    horizonDays: 45,
    minHarvests: 3
  });

  if (!result.ok) return [];

  // Map to the format expected by the wholesale catalog
  return result.predictions.map(p => ({
    type: 'predicted',
    farm_id: p.farm_id,
    farm_name: p.farm_name,
    crop: p.crop,
    product_name: p.crop,
    estimated_available_date: p.estimated_available_date,
    days_until_available: p.days_until_available,
    available_now: p.available_now,
    confidence: p.confidence,
    confidence_label: p.confidence_label,
    estimated_quantity: p.estimated_quantity,
    unit: p.unit,
    avg_quality_score: p.avg_quality_score,
    prediction_window: p.prediction_window,
    ready_by_probability: p.ready_by_probability,
    statistics_summary: {
      sample_size: p.statistics.sample_size,
      grow_cycle_mean: p.statistics.grow_days.mean,
      grow_cycle_std_dev: p.statistics.grow_days.std_dev,
      consistency: p.statistics.grow_days.coeff_of_variation < 15 ? 'high' : p.statistics.grow_days.coeff_of_variation < 30 ? 'medium' : 'low'
    },
    display_text: p.display_text
  }));
}

export default {
  generateHarvestPredictions,
  generatePredictedInventoryEnhanced,
  computeHarvestStatistics
};
