/**
 * Health Check & Predictive Alerting Service
 * ─────────────────────────────────────────────
 * Periodically checks sensor telemetry across all farms, detects anomalies,
 * predicts threshold breaches, and pushes real-time alerts via WebSocket.
 *
 * Part of the E.V.I.E. (Environmental Vision & Intelligence Engine) upgrade.
 */

import { getDatabase } from '../config/database.js';
import logger from '../utils/logger.js';

// ── Configuration ────────────────────────────────────────────────────────────
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // Every 5 minutes
const TREND_WINDOW = 6; // Number of recent readings for trend analysis

// Environmental thresholds (°C / % RH / ppm)
const THRESHOLDS = {
  temperature: { min: 16, max: 32, warnMin: 18, warnMax: 30 },
  humidity:    { min: 30, max: 85, warnMin: 40, warnMax: 80 },
  co2:         { min: 200, max: 2000, warnMin: 300, warnMax: 1500 },
  vpd:         { min: 0.4, max: 1.6, warnMin: 0.6, warnMax: 1.4 }
};

let checkInterval = null;

/**
 * Start the periodic health check loop.
 */
export function startHealthCheckService(app) {
  logger.info('Health check & predictive alerting service started');

  // Initial check after 30s (let server finish booting)
  setTimeout(() => runHealthCheck(app), 30_000);

  // Then repeat every CHECK_INTERVAL_MS
  checkInterval = setInterval(() => runHealthCheck(app), CHECK_INTERVAL_MS);
}

/**
 * Stop the service (used during graceful shutdown).
 */
export function stopHealthCheckService() {
  if (checkInterval) {
    clearInterval(checkInterval);
    checkInterval = null;
  }
}

/**
 * Run a single health check across all farms.
 */
async function runHealthCheck(app) {
  const db = getDatabase();
  if (!db) return;

  try {
    const { rows: farms } = await db.query(
      `SELECT DISTINCT farm_id FROM farm_data WHERE data_type = 'telemetry' AND farm_id IS NOT NULL`
    );

    for (const { farm_id } of farms) {
      await checkFarmHealth(app, db, farm_id);
    }
  } catch (err) {
    logger.error('[HealthCheck] Error during check cycle:', err.message);
  }
}

/**
 * Check health for a single farm — analyze sensors, detect anomalies, predict breaches.
 */
async function checkFarmHealth(app, db, farmId) {
  try {
    const { rows } = await db.query(
      `SELECT data FROM farm_data WHERE farm_id = $1 AND data_type = 'telemetry' ORDER BY updated_at DESC LIMIT 1`,
      [farmId]
    );
    if (!rows.length || !rows[0].data) return;

    const telemetry = rows[0].data;
    const zones = Array.isArray(telemetry?.zones) ? telemetry.zones : [];

    const alerts = [];

    for (const zone of zones) {
      const zoneId = zone.id || zone.zone_id || 'unknown';
      const readings = extractReadings(zone);
      if (!readings) continue;

      const currentAlerts = checkCurrentValues(zoneId, readings);
      alerts.push(...currentAlerts);

      const trendAlerts = analyzeTrends(zoneId, readings, zone);
      alerts.push(...trendAlerts);
    }

    // Broadcast alerts via WebSocket
    if (alerts.length > 0 && app.locals.broadcastToFarm) {
      for (const alert of alerts) {
        app.locals.broadcastToFarm(farmId, {
          type: 'evie_alert',
          alert_type: alert.severity,
          zone: alert.zone,
          metric: alert.metric,
          value: alert.value,
          message: alert.message,
          suggestion: alert.suggestion
        });
      }
      logger.info(`[HealthCheck] ${alerts.length} alert(s) broadcast for farm ${farmId}`);
    }
  } catch (err) {
    logger.warn(`[HealthCheck] Farm ${farmId} check failed:`, err.message);
  }
}

/**
 * Extract sensor readings from a zone object (handles various data shapes).
 */
function extractReadings(zone) {
  if (Array.isArray(zone?.sensors) && zone.sensors[0]?.readings) {
    return zone.sensors[0].readings;
  }
  if (zone?.readings) return zone.readings;
  if (zone?.temperature_c != null || zone?.humidity != null) return zone;
  return null;
}

/**
 * Check current sensor values against thresholds.
 */
function checkCurrentValues(zoneId, readings) {
  const alerts = [];

  const tempC = readings.temperature_c ?? readings.temp ?? readings.tempC ?? null;
  const rh = readings.humidity ?? readings.humidity_pct ?? readings.rh ?? null;
  const co2 = readings.co2 ?? readings.co2_ppm ?? null;
  const vpd = readings.vpd ?? null;

  if (tempC != null) {
    if (tempC > THRESHOLDS.temperature.max || tempC < THRESHOLDS.temperature.min) {
      alerts.push({
        zone: zoneId, metric: 'temperature', value: tempC, severity: 'critical',
        message: `Temperature ${tempC > THRESHOLDS.temperature.max ? 'critically high' : 'critically low'} at ${tempC.toFixed(1)}°C in ${zoneId}`,
        suggestion: tempC > THRESHOLDS.temperature.max
          ? 'Increase ventilation or activate cooling system'
          : 'Check heating system and close any open vents'
      });
    } else if (tempC > THRESHOLDS.temperature.warnMax || tempC < THRESHOLDS.temperature.warnMin) {
      alerts.push({
        zone: zoneId, metric: 'temperature', value: tempC, severity: 'warning',
        message: `Temperature trending ${tempC > THRESHOLDS.temperature.warnMax ? 'high' : 'low'} at ${tempC.toFixed(1)}°C in ${zoneId}`,
        suggestion: 'Monitor closely — consider adjusting climate controls'
      });
    }
  }

  if (rh != null) {
    if (rh > THRESHOLDS.humidity.max || rh < THRESHOLDS.humidity.min) {
      alerts.push({
        zone: zoneId, metric: 'humidity', value: rh, severity: 'critical',
        message: `Humidity ${rh > THRESHOLDS.humidity.max ? 'critically high' : 'critically low'} at ${rh.toFixed(0)}% in ${zoneId}`,
        suggestion: rh > THRESHOLDS.humidity.max
          ? 'Increase airflow — risk of mold/mildew'
          : 'Add humidification or reduce ventilation'
      });
    } else if (rh > THRESHOLDS.humidity.warnMax || rh < THRESHOLDS.humidity.warnMin) {
      alerts.push({
        zone: zoneId, metric: 'humidity', value: rh, severity: 'warning',
        message: `Humidity at ${rh.toFixed(0)}% in ${zoneId}`,
        suggestion: 'Keep an eye on moisture levels'
      });
    }
  }

  if (co2 != null && co2 > THRESHOLDS.co2.max) {
    alerts.push({
      zone: zoneId, metric: 'co2', value: co2, severity: 'critical',
      message: `CO₂ at ${co2} ppm in ${zoneId} — exceeds safe limit`,
      suggestion: 'Increase fresh air exchange immediately'
    });
  }

  if (vpd != null) {
    if (vpd > THRESHOLDS.vpd.max || vpd < THRESHOLDS.vpd.min) {
      alerts.push({
        zone: zoneId, metric: 'vpd', value: vpd, severity: 'warning',
        message: `VPD ${vpd > THRESHOLDS.vpd.max ? 'high' : 'low'} at ${vpd.toFixed(2)} kPa in ${zoneId}`,
        suggestion: vpd > THRESHOLDS.vpd.max
          ? 'Increase humidity or reduce temperature to optimize transpiration'
          : 'Decrease humidity or increase temperature'
      });
    }
  }

  return alerts;
}

/**
 * Analyze trends to predict future threshold breaches (simple linear extrapolation).
 */
function analyzeTrends(zoneId, readings, zone) {
  const alerts = [];

  const history = zone?.history || zone?.readings_history;
  if (!Array.isArray(history) || history.length < 3) return alerts;

  const recent = history.slice(-TREND_WINDOW);

  // Temperature trend
  const temps = recent.map(r => r.temperature_c ?? r.temp ?? r.tempC).filter(v => v != null);
  if (temps.length >= 3) {
    const trend = linearTrend(temps);
    // Predict value in 60 minutes (assuming ~5 min intervals → 12 steps)
    const predicted60 = temps[temps.length - 1] + (trend * 12);
    if (predicted60 > THRESHOLDS.temperature.max && temps[temps.length - 1] <= THRESHOLDS.temperature.max) {
      alerts.push({
        zone: zoneId, metric: 'temperature_trend', value: temps[temps.length - 1], severity: 'predictive',
        message: `Temperature in ${zoneId} rising — predicted to reach ${predicted60.toFixed(1)}°C within 60 min`,
        suggestion: 'Consider activating cooling preemptively'
      });
    } else if (predicted60 < THRESHOLDS.temperature.min && temps[temps.length - 1] >= THRESHOLDS.temperature.min) {
      alerts.push({
        zone: zoneId, metric: 'temperature_trend', value: temps[temps.length - 1], severity: 'predictive',
        message: `Temperature in ${zoneId} dropping — predicted to reach ${predicted60.toFixed(1)}°C within 60 min`,
        suggestion: 'Consider activating heating preemptively'
      });
    }
  }

  return alerts;
}

/**
 * Calculate simple linear trend (slope) from an array of values.
 */
function linearTrend(values) {
  if (values.length < 2) return 0;
  const n = values.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += values[i];
    sumXY += i * values[i];
    sumX2 += i * i;
  }
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return 0;
  return (n * sumXY - sumX * sumY) / denom;
}
