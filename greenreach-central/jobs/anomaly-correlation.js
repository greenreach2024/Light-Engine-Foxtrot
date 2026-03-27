/**
 * Cross-Farm Anomaly Correlation -- Phase 3, Task 33
 *
 * Detects when similar environmental anomalies or loss patterns appear
 * across multiple farms simultaneously, indicating network-wide issues
 * (weather events, supply chain problems, seasonal patterns).
 *
 * Runs weekly via server.js scheduler.
 * Results pushed to farms via AI recommendations (network_intelligence.anomaly_alerts).
 */

import { query } from '../config/database.js';

/**
 * Fetch recent loss events grouped by time window and cause.
 * Groups loss events from the last 30 days into weekly buckets
 * and counts how many distinct farms are affected per cause per week.
 */
async function fetchLossPatterns(daysBack = 30) {
  try {
    const result = await query(`
      SELECT
        date_trunc('week', recorded_at) AS week,
        cause,
        crop,
        COUNT(DISTINCT farm_id) AS farm_count,
        COUNT(*) AS event_count,
        AVG(loss_percentage) AS avg_loss_pct,
        ARRAY_AGG(DISTINCT farm_id) AS affected_farms
      FROM loss_events
      WHERE recorded_at >= NOW() - INTERVAL '${daysBack} days'
        AND cause IS NOT NULL
      GROUP BY week, cause, crop
      HAVING COUNT(DISTINCT farm_id) >= 2
      ORDER BY week DESC, farm_count DESC
    `);
    return result.rows;
  } catch (err) {
    console.warn('[AnomalyCorrelation] Loss pattern query failed:', err.message);
    return [];
  }
}

/**
 * Fetch environmental deviations across farms.
 * Identifies crops where multiple farms show similar env stress
 * (e.g., high temp deviation from benchmark).
 */
async function fetchEnvironmentalDeviations() {
  try {
    const result = await query(`
      WITH benchmarks AS (
        SELECT crop, avg_temp_c, avg_humidity_pct, avg_ppfd
        FROM crop_benchmarks
        WHERE harvest_count >= 3
      ),
      recent AS (
        SELECT
          er.farm_id,
          er.crop,
          er.recorded_at,
          (er.environment_achieved_avg->>'temp_c')::DECIMAL AS actual_temp,
          (er.environment_achieved_avg->>'humidity_pct')::DECIMAL AS actual_humidity,
          (er.environment_achieved_avg->>'ppfd')::DECIMAL AS actual_ppfd
        FROM experiment_records er
        WHERE er.recorded_at >= NOW() - INTERVAL '30 days'
          AND er.environment_achieved_avg IS NOT NULL
      )
      SELECT
        r.crop,
        COUNT(DISTINCT r.farm_id) AS farm_count,
        AVG(ABS(r.actual_temp - b.avg_temp_c)) AS avg_temp_deviation,
        AVG(ABS(r.actual_humidity - b.avg_humidity_pct)) AS avg_humidity_deviation,
        AVG(ABS(r.actual_ppfd - b.avg_ppfd)) AS avg_ppfd_deviation,
        ARRAY_AGG(DISTINCT r.farm_id) AS affected_farms
      FROM recent r
      JOIN benchmarks b ON r.crop = b.crop
      WHERE ABS(r.actual_temp - b.avg_temp_c) > 3
         OR ABS(r.actual_humidity - b.avg_humidity_pct) > 15
         OR ABS(r.actual_ppfd - b.avg_ppfd) > 100
      GROUP BY r.crop
      HAVING COUNT(DISTINCT r.farm_id) >= 2
      ORDER BY farm_count DESC
    `);
    return result.rows;
  } catch (err) {
    console.warn('[AnomalyCorrelation] Env deviation query failed:', err.message);
    return [];
  }
}

/**
 * Correlate anomalies across farms and generate network-wide alerts.
 */
export async function correlateAnomalies() {
  console.log('[AnomalyCorrelation] Starting cross-farm anomaly correlation...');

  const lossPatterns = await fetchLossPatterns(30);
  const envDeviations = await fetchEnvironmentalDeviations();

  const correlations = [];

  // Loss pattern correlations: same cause affecting multiple farms
  for (const pattern of lossPatterns) {
    const severity = pattern.farm_count >= 3 ? 'high' : 'medium';
    correlations.push({
      type: 'loss_pattern_correlation',
      severity,
      crop: pattern.crop,
      cause: pattern.cause,
      farm_count: parseInt(pattern.farm_count),
      event_count: parseInt(pattern.event_count),
      avg_loss_pct: parseFloat(parseFloat(pattern.avg_loss_pct || 0).toFixed(1)),
      affected_farms: pattern.affected_farms,
      week: pattern.week,
      message: `${pattern.crop}: "${pattern.cause}" affecting ${pattern.farm_count} farms (avg ${parseFloat(pattern.avg_loss_pct || 0).toFixed(1)}% loss)`
    });
  }

  // Environmental deviation correlations: same crop under stress across farms
  for (const dev of envDeviations) {
    const severity = dev.farm_count >= 3 ? 'high' : 'medium';
    const stressors = [];
    if (parseFloat(dev.avg_temp_deviation) > 3) stressors.push(`temp +/-${parseFloat(dev.avg_temp_deviation).toFixed(1)}C`);
    if (parseFloat(dev.avg_humidity_deviation) > 15) stressors.push(`RH +/-${parseFloat(dev.avg_humidity_deviation).toFixed(0)}%`);
    if (parseFloat(dev.avg_ppfd_deviation) > 100) stressors.push(`PPFD +/-${parseFloat(dev.avg_ppfd_deviation).toFixed(0)}`);

    correlations.push({
      type: 'environmental_correlation',
      severity,
      crop: dev.crop,
      farm_count: parseInt(dev.farm_count),
      stressors,
      affected_farms: dev.affected_farms,
      message: `${dev.crop}: environmental stress across ${dev.farm_count} farms (${stressors.join(', ')})`
    });
  }

  // Persist results
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS network_anomaly_correlations (
        id SERIAL PRIMARY KEY,
        correlations JSONB NOT NULL,
        correlation_count INTEGER DEFAULT 0,
        computed_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await query(
      `INSERT INTO network_anomaly_correlations (correlations, correlation_count)
       VALUES ($1, $2)`,
      [JSON.stringify(correlations), correlations.length]
    );
  } catch (err) {
    console.warn('[AnomalyCorrelation] Could not persist results:', err.message);
  }

  console.log(`[AnomalyCorrelation] Found ${correlations.length} cross-farm correlations (${lossPatterns.length} loss patterns, ${envDeviations.length} env deviations)`);
  return { correlations, computed_at: new Date().toISOString() };
}

/**
 * Get latest anomaly correlations for the AI push payload.
 */
export async function getAnomalyCorrelations() {
  try {
    const result = await query(`
      SELECT correlations, computed_at
      FROM network_anomaly_correlations
      ORDER BY computed_at DESC
      LIMIT 1
    `);
    if (result.rows?.[0]) {
      const row = result.rows[0];
      const correlations = typeof row.correlations === 'string'
        ? JSON.parse(row.correlations)
        : row.correlations;
      return { correlations, computed_at: row.computed_at };
    }
  } catch {
    // Table may not exist yet
  }
  return { correlations: [], computed_at: null };
}

export default { correlateAnomalies, getAnomalyCorrelations };
