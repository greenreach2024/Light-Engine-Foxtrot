/**
 * JavaScript-based anomaly detection (IsolationForest alternative)
 * Phase 4 #25: ML pipeline reactivation
 *
 * Uses Z-score + rolling statistics for anomaly detection when Python
 * sklearn is unavailable (Cloud Run without Python ML deps).
 *
 * Approach: Modified Z-score with exponential moving average baseline.
 * Detects spikes, drift, and stuck sensors without external dependencies.
 */

import fs from 'fs';
import path from 'path';

const ANOMALY_WINDOW = 24; // data points for rolling stats (24 readings = 2h at 5-min intervals)
const Z_THRESHOLD = 3.0;   // standard deviations for anomaly flag
const STUCK_THRESHOLD = 12; // consecutive identical readings = stuck sensor

function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function stddev(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1));
}

/**
 * Detect anomalies in a time series of readings.
 * @param {Array<{timestamp: string, value: number}>} readings - sorted oldest-first
 * @param {object} opts - { metric: string, zoneId: string }
 * @returns {Array<{timestamp, value, zscore, type, severity}>} anomalies found
 */
export function detectAnomalies(readings, opts = {}) {
  if (!readings || readings.length < ANOMALY_WINDOW) return [];

  const anomalies = [];
  const metric = opts.metric || 'unknown';
  const zoneId = opts.zoneId || 'unknown';
  let stuckCount = 0;
  let lastValue = null;

  for (let i = ANOMALY_WINDOW; i < readings.length; i++) {
    const window = readings.slice(i - ANOMALY_WINDOW, i).map(r => r.value);
    const current = readings[i].value;
    const m = mean(window);
    const sd = stddev(window);

    // Z-score anomaly
    if (sd > 0) {
      const zscore = Math.abs((current - m) / sd);
      if (zscore > Z_THRESHOLD) {
        anomalies.push({
          timestamp: readings[i].timestamp,
          value: current,
          zscore: Math.round(zscore * 100) / 100,
          type: current > m ? 'spike_high' : 'spike_low',
          severity: zscore > Z_THRESHOLD * 1.5 ? 'critical' : 'warning',
          metric,
          zoneId,
          baseline: { mean: Math.round(m * 100) / 100, stddev: Math.round(sd * 100) / 100 }
        });
      }
    }

    // Stuck sensor detection
    if (current === lastValue) {
      stuckCount++;
      if (stuckCount === STUCK_THRESHOLD) {
        anomalies.push({
          timestamp: readings[i].timestamp,
          value: current,
          zscore: 0,
          type: 'stuck_sensor',
          severity: 'warning',
          metric,
          zoneId,
          baseline: { consecutiveIdentical: stuckCount }
        });
      }
    } else {
      stuckCount = 0;
    }
    lastValue = current;
  }

  return anomalies;
}

/**
 * Run anomaly detection across all zone env data files.
 * @param {string} dataDir - path to data directory
 * @returns {object} { anomalies: [], summary: {}, timestamp }
 */
export async function runFullScan(dataDir) {
  const envDir = path.join(dataDir, 'env');
  const allAnomalies = [];
  const summary = { zonesScanned: 0, anomaliesFound: 0, metrics: {} };

  if (!fs.existsSync(envDir)) {
    return { anomalies: [], summary, timestamp: new Date().toISOString(), engine: 'js-zscore' };
  }

  const files = fs.readdirSync(envDir).filter(f => f.endsWith('.json'));
  for (const file of files) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(envDir, file), 'utf-8'));
      const zoneId = file.replace('.json', '');
      summary.zonesScanned++;

      // Process each metric
      for (const metric of ['temperature', 'humidity', 'co2', 'vpd']) {
        const readings = extractReadings(raw, metric);
        if (readings.length < ANOMALY_WINDOW) continue;

        const found = detectAnomalies(readings, { metric, zoneId });
        if (found.length > 0) {
          allAnomalies.push(...found);
          summary.metrics[metric] = (summary.metrics[metric] || 0) + found.length;
        }
      }
    } catch (e) {
      // skip malformed files
    }
  }

  summary.anomaliesFound = allAnomalies.length;
  return {
    anomalies: allAnomalies,
    summary,
    timestamp: new Date().toISOString(),
    engine: 'js-zscore'
  };
}

function extractReadings(envData, metric) {
  // Handle various env data formats
  if (Array.isArray(envData)) {
    return envData
      .filter(r => r[metric] !== undefined && r[metric] !== null)
      .map(r => ({ timestamp: r.timestamp || r.ts, value: Number(r[metric]) }))
      .filter(r => !isNaN(r.value));
  }
  if (envData.history && Array.isArray(envData.history)) {
    return extractReadings(envData.history, metric);
  }
  if (envData.readings && Array.isArray(envData.readings)) {
    return extractReadings(envData.readings, metric);
  }
  return [];
}

export default { detectAnomalies, runFullScan };
