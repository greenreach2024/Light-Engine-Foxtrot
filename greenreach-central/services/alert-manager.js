/**
 * Alert Manager Service
 * Evaluates environmental conditions and generates alerts
 */
import { query, isDatabaseAvailable } from '../config/database.js';
import logger from '../utils/logger.js';

/**
 * Alert thresholds (presets)
 * Strategy:
 * - Use VPD as primary plant-stress alert.
 * - Use RH primarily as high-RH disease/condensation risk.
 * - Keep RH-low at minimal-spam levels (or disable via config).
 */
const ALERT_PRESETS = {
  A: {
    name: 'Leafy greens (balanced)',
    temperature: {
      warning: { min: 16, max: 24 },
      critical: { min: 12, max: 28 }
    },
    humidity: {
      low: { warning: 35, critical: 25, enabled: true },
      high: { warning: 85, critical: 90, enabled: true }
    },
    vpd: {
      warning: { min: 0.50, max: 1.40 },
      critical: { min: 0.35, max: 1.80 }
    },
    co2: {
      warning: { min: 350, max: 1400 },
      critical: { min: 300, max: 2000 }
    }
  },
  B: {
    name: 'Leafy greens (quality-biased)',
    temperature: {
      warning: { min: 17, max: 23 },
      critical: { min: 14, max: 27 }
    },
    humidity: {
      low: { warning: 40, critical: 30, enabled: true },
      high: { warning: 80, critical: 90, enabled: true }
    },
    vpd: {
      warning: { min: 0.60, max: 1.25 },
      critical: { min: 0.40, max: 1.60 }
    },
    co2: {
      warning: { min: 400, max: 1200 },
      critical: { min: 300, max: 2000 }
    }
  },
  C: {
    name: 'Propagation / seedlings',
    temperature: {
      warning: { min: 18, max: 24 },
      critical: { min: 16, max: 27 }
    },
    humidity: {
      low: { warning: 55, critical: 45, enabled: true },
      high: { warning: 85, critical: 95, enabled: true }
    },
    vpd: {
      warning: { min: 0.30, max: 0.90 },
      critical: { min: 0.20, max: 1.20 }
    },
    co2: {
      warning: { min: 350, max: 1400 },
      critical: { min: 300, max: 2000 }
    }
  }
};

const DEFAULT_PRESET = String(process.env.ALERT_PRESET || 'A').toUpperCase();
const ALERT_THRESHOLDS = ALERT_PRESETS[DEFAULT_PRESET] || ALERT_PRESETS.A;

// Persistence and hysteresis
const PERSISTENCE_MS = {
  warning: 10 * 60 * 1000,
  critical: 25 * 60 * 1000
};

const RESOLVE_PERSISTENCE_MS = 10 * 60 * 1000;

const RESOLVE_BUFFER = {
  temperature: 0.5,  // °C
  humidity: 2,       // %
  vpd: 0.05,         // kPa
  co2: 50            // ppm
};

const EXTREME_IMMEDIATE = {
  temperature: { min: 10, max: 32 }
};

const alertState = new Map();
const resolveState = new Map();

/**
 * Evaluate telemetry data and generate alerts
 * @param {string} farmId - Farm identifier
 * @param {Object} telemetryData - Telemetry data containing zones
 */
export async function evaluateAndGenerateAlerts(farmId, telemetryData) {
  try {
    if (!telemetryData || !telemetryData.zones || !Array.isArray(telemetryData.zones)) {
      logger.warn(`[AlertManager] No zones data for farm ${farmId}`);
      return;
    }

    logger.info(`[AlertManager] Evaluating ${telemetryData.zones.length} zones for farm ${farmId}`);
    
    const alerts = [];
    
    for (const zone of telemetryData.zones) {
      const zoneAlerts = evaluateZone(farmId, zone);
      alerts.push(...zoneAlerts);
    }
    
    // Store alerts in database
    if (alerts.length > 0 && await isDatabaseAvailable()) {
      logger.info(`[AlertManager] Generated ${alerts.length} alerts for farm ${farmId}`);
      await storeAlerts(farmId, alerts);
    }
    
  } catch (error) {
    logger.error(`[AlertManager] Error evaluating alerts for farm ${farmId}:`, error);
  }
}

/**
 * Evaluate a single zone and generate alerts
 * @param {string} farmId - Farm identifier
 * @param {Object} zone - Zone data with sensors
 * @returns {Array} Array of alert objects
 */
function evaluateZone(farmId, zone) {
  const alerts = [];
  const zoneId = zone.id || zone.zone_id || zone.zoneId || 'unknown';
  const zoneName = zone.name || zone.zone_name || zone.zoneName || zoneId;
  
  const sensors = zone.sensors || {};
  
  // Evaluate temperature
  const temp = sensors.tempC?.current ?? sensors.temperature?.current ?? zone.temperature_c ?? zone.temperature ?? null;
  if (temp !== null && typeof temp === 'number') {
    const tempAlerts = evaluateMetric(farmId, 'temperature', temp, zoneId, zoneName);
    alerts.push(...tempAlerts);
  }
  
  // Evaluate humidity
  const humidity = sensors.rh?.current ?? sensors.humidity?.current ?? zone.humidity ?? zone.rh ?? null;
  if (humidity !== null && typeof humidity === 'number') {
    const humidityAlerts = evaluateMetric(farmId, 'humidity', humidity, zoneId, zoneName);
    alerts.push(...humidityAlerts);
  }
  
  // Evaluate VPD
  const vpd = sensors.vpd?.current ?? zone.vpd ?? null;
  if (vpd !== null && typeof vpd === 'number') {
    const vpdAlerts = evaluateMetric(farmId, 'vpd', vpd, zoneId, zoneName);
    alerts.push(...vpdAlerts);
  }
  
  // Evaluate CO2
  const co2 = sensors.co2?.current ?? zone.co2 ?? null;
  if (co2 !== null && typeof co2 === 'number') {
    const co2Alerts = evaluateMetric(farmId, 'co2', co2, zoneId, zoneName);
    alerts.push(...co2Alerts);
  }
  
  return alerts;
}

/**
 * Evaluate a single metric against thresholds
 * @param {string} metric - Metric name (temperature, humidity, vpd, co2)
 * @param {number} value - Current value
 * @param {string} zoneId - Zone identifier
 * @param {string} zoneName - Zone name
 * @returns {Object|null} Alert object or null if no alert
 */
function evaluateMetric(farmId, metric, value, zoneId, zoneName) {
  const thresholds = ALERT_THRESHOLDS[metric];
  if (!thresholds) return [];

  const alerts = [];
  const now = Date.now();

  if (metric === 'humidity') {
    if (thresholds.low?.enabled) {
      const lowAlert = evaluateDirectionalMetric(
        farmId,
        metric,
        'low',
        value,
        thresholds.low,
        zoneId,
        zoneName,
        now
      );
      if (lowAlert) alerts.push(lowAlert);
    }
    if (thresholds.high?.enabled) {
      const highAlert = evaluateDirectionalMetric(
        farmId,
        metric,
        'high',
        value,
        thresholds.high,
        zoneId,
        zoneName,
        now
      );
      if (highAlert) alerts.push(highAlert);
    }
    return alerts;
  }

  const lowAlert = evaluateDirectionalMetric(
    farmId,
    metric,
    'low',
    value,
    { warning: thresholds.warning.min, critical: thresholds.critical.min },
    zoneId,
    zoneName,
    now
  );
  if (lowAlert) alerts.push(lowAlert);

  const highAlert = evaluateDirectionalMetric(
    farmId,
    metric,
    'high',
    value,
    { warning: thresholds.warning.max, critical: thresholds.critical.max },
    zoneId,
    zoneName,
    now
  );
  if (highAlert) alerts.push(highAlert);

  return alerts;
}

function evaluateDirectionalMetric(farmId, metric, direction, value, levels, zoneId, zoneName, now) {
  const isLow = direction === 'low';
  const criticalThreshold = levels.critical;
  const warningThreshold = levels.warning;

  let severity = null;
  let message = null;

  if (isLow) {
    if (value < criticalThreshold) {
      severity = 'critical';
      message = `${capitalize(metric)} critically low in ${zoneName}: ${formatValue(metric, value)} (minimum: ${formatValue(metric, criticalThreshold)})`;
    } else if (value < warningThreshold) {
      severity = 'warning';
      message = `${capitalize(metric)} below optimal range in ${zoneName}: ${formatValue(metric, value)} (recommended minimum: ${formatValue(metric, warningThreshold)})`;
    }
  } else {
    if (value > criticalThreshold) {
      severity = 'critical';
      message = `${capitalize(metric)} critically high in ${zoneName}: ${formatValue(metric, value)} (maximum: ${formatValue(metric, criticalThreshold)})`;
    } else if (value > warningThreshold) {
      severity = 'warning';
      message = `${capitalize(metric)} above optimal range in ${zoneName}: ${formatValue(metric, value)} (recommended maximum: ${formatValue(metric, warningThreshold)})`;
    }
  }

  if (!severity) {
    clearAlertState(farmId, metric, direction, zoneId);
    return null;
  }

  const isExtremeImmediate = metric === 'temperature'
    && EXTREME_IMMEDIATE.temperature
    && ((isLow && value < EXTREME_IMMEDIATE.temperature.min)
      || (!isLow && value > EXTREME_IMMEDIATE.temperature.max));

  if (!isExtremeImmediate && !passesPersistenceGate(farmId, metric, direction, zoneId, severity, now)) {
    return null;
  }

  const thresholdValue = severity === 'critical' ? criticalThreshold : warningThreshold;
  return {
    alert_type: `environmental_${metric}_${direction}`,
    severity,
    message,
    zone_id: zoneId,
    zone_name: zoneName,
    metric,
    direction,
    value,
    threshold: thresholdValue,
    timestamp: new Date().toISOString()
  };
}

/**
 * Store alerts in database (with deduplication)
 * @param {string} farmId - Farm identifier
 * @param {Array} alerts - Array of alert objects
 */
async function storeAlerts(farmId, alerts) {
  try {
    // Check for existing active alerts to avoid duplicates
    const existingAlertsResult = await query(
      `SELECT alert_type, zone_id, severity 
       FROM farm_alerts 
       WHERE farm_id = $1 AND resolved = false`,
      [farmId],
      { isAdmin: true }
    );
    
    const existingAlerts = new Set(
      existingAlertsResult.rows.map(row => 
        `${row.alert_type}:${row.zone_id}:${row.severity}`
      )
    );
    
    // Insert only new alerts
    let insertedCount = 0;
    for (const alert of alerts) {
      const alertKey = `${alert.alert_type}:${alert.zone_id}:${alert.severity}`;
      
      if (existingAlerts.has(alertKey)) {
        // Update timestamp of existing alert
        await query(
          `UPDATE farm_alerts 
           SET updated_at = NOW()
           WHERE farm_id = $1 
             AND alert_type = $2 
             AND zone_id = $3 
             AND severity = $4
             AND resolved = false`,
          [farmId, alert.alert_type, alert.zone_id, alert.severity]
    ,
      { isAdmin: true }
        );
        logger.debug(`[AlertManager] Updated existing alert: ${alertKey}`);
      } else {
        // Insert new alert
        await query(
          `INSERT INTO farm_alerts 
           (farm_id, alert_type, severity, message, zone_id, device_id, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
          [
            farmId,
            alert.alert_type,
            alert.severity,
            alert.message,
            alert.zone_id,
            null  // device_id not applicable for environmental alerts
          ]
    ,
      { isAdmin: true }
        );
        insertedCount++;
        logger.info(`[AlertManager] Created new alert: ${alert.severity} - ${alert.message}`);
      }
    }
    
    logger.info(`[AlertManager] Inserted ${insertedCount} new alerts for farm ${farmId}`);
    
  } catch (error) {
    logger.error(`[AlertManager] Error storing alerts:`, error);
  }
}

/**
 * Auto-resolve alerts when conditions return to normal
 * @param {string} farmId - Farm identifier
 * @param {Object} telemetryData - Current telemetry data
 */
export async function autoResolveAlerts(farmId, telemetryData) {
  try {
    if (!await isDatabaseAvailable()) return;
    
    // Get all active environmental alerts
    const activeAlertsResult = await query(
      `SELECT alert_type, zone_id, severity 
       FROM farm_alerts 
       WHERE farm_id = $1 
         AND resolved = false 
         AND alert_type LIKE 'environmental_%'`,
      [farmId],
      { isAdmin: true }
    );
    
    if (activeAlertsResult.rows.length === 0) return;
    
    const zones = telemetryData.zones || [];
    const zoneMap = new Map(zones.map(z => [z.id || z.zone_id || z.zoneId, z]));
    
    let resolvedCount = 0;
    
    for (const alert of activeAlertsResult.rows) {
      const parts = String(alert.alert_type || '').replace('environmental_', '').split('_');
      const metric = parts[0];
      const direction = parts[1] || null;
      const zone = zoneMap.get(alert.zone_id);
      
      if (!zone) continue;
      
      // Get current value
      const sensors = zone.sensors || {};
      let currentValue = null;
      
      switch (metric) {
        case 'temperature':
          currentValue = sensors.tempC?.current ?? sensors.temperature?.current ?? zone.temperature_c ?? zone.temperature ?? null;
          break;
        case 'humidity':
          currentValue = sensors.rh?.current ?? sensors.humidity?.current ?? zone.humidity ?? zone.rh ?? null;
          break;
        case 'vpd':
          currentValue = sensors.vpd?.current ?? zone.vpd ?? null;
          break;
        case 'co2':
          currentValue = sensors.co2?.current ?? zone.co2 ?? null;
          break;
      }
      
      if (currentValue === null) continue;
      
      // Check if value is now within acceptable range (with hysteresis)
      const thresholds = ALERT_THRESHOLDS[metric];
      if (!thresholds) continue;

      const buffer = RESOLVE_BUFFER[metric] ?? 0;
      const isResolved = isWithinResolveRange(
        metric,
        currentValue,
        alert.severity,
        direction,
        thresholds,
        buffer
      );

      if (isResolved && passesResolvePersistence(farmId, metric, direction, alert.zone_id)) {
        await query(
          `UPDATE farm_alerts 
           SET resolved = true, resolved_at = NOW(), updated_at = NOW()
           WHERE farm_id = $1
             AND alert_type = $2
             AND zone_id = $3
             AND severity = $4
             AND resolved = false`,
          [farmId, alert.alert_type, alert.zone_id, alert.severity],
          { isAdmin: true }
        );
        resolvedCount++;
        logger.info(`[AlertManager] Auto-resolved ${metric} alert in zone ${alert.zone_id}`);
      } else if (!isResolved) {
        clearResolveState(farmId, metric, direction, alert.zone_id);
      }
    }
    
    if (resolvedCount > 0) {
      logger.info(`[AlertManager] Auto-resolved ${resolvedCount} alerts for farm ${farmId}`);
    }
    
  } catch (error) {
    logger.error(`[AlertManager] Error auto-resolving alerts:`, error);
  }
}

function passesPersistenceGate(farmId, metric, direction, zoneId, severity, now) {
  const key = `${farmId}:${zoneId}:${metric}:${direction}:${severity}`;
  const existing = alertState.get(key);
  if (!existing) {
    alertState.set(key, { firstSeen: now, lastSeen: now });
    return false;
  }
  existing.lastSeen = now;
  const requiredMs = PERSISTENCE_MS[severity] ?? 0;
  return now - existing.firstSeen >= requiredMs;
}

function clearAlertState(farmId, metric, direction, zoneId) {
  const prefix = `${farmId}:${zoneId}:${metric}:${direction}`;
  for (const key of alertState.keys()) {
    if (key.startsWith(prefix)) {
      alertState.delete(key);
    }
  }
}

function isWithinResolveRange(metric, value, severity, direction, thresholds, buffer) {
  if (metric === 'humidity') {
    const low = thresholds.low;
    const high = thresholds.high;
    if (direction === 'low' && low?.enabled) {
      const thresholdValue = severity === 'critical' ? low.critical : low.warning;
      return value >= thresholdValue + buffer;
    }
    if (direction === 'high' && high?.enabled) {
      const thresholdValue = severity === 'critical' ? high.critical : high.warning;
      return value <= thresholdValue - buffer;
    }
    return true;
  }

  const thresholdRange = severity === 'critical' ? thresholds.critical : thresholds.warning;
  if (direction === 'low') {
    return value >= thresholdRange.min + buffer;
  }
  if (direction === 'high') {
    return value <= thresholdRange.max - buffer;
  }
  return value >= thresholdRange.min + buffer && value <= thresholdRange.max - buffer;
}

function passesResolvePersistence(farmId, metric, direction, zoneId) {
  const key = `${farmId}:${zoneId}:${metric}:${direction || 'any'}:resolve`;
  const now = Date.now();
  const existing = resolveState.get(key);
  if (!existing) {
    resolveState.set(key, { firstSeen: now, lastSeen: now });
    return false;
  }
  existing.lastSeen = now;
  return now - existing.firstSeen >= RESOLVE_PERSISTENCE_MS;
}

function clearResolveState(farmId, metric, direction, zoneId) {
  const key = `${farmId}:${zoneId}:${metric}:${direction || 'any'}:resolve`;
  resolveState.delete(key);
}

/**
 * Helper function to capitalize first letter
 */
function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Helper function to format values with units
 */
function formatValue(metric, value) {
  switch (metric) {
    case 'temperature':
      return `${value.toFixed(1)}°C`;
    case 'humidity':
      return `${value.toFixed(1)}%`;
    case 'vpd':
      return `${value.toFixed(2)} kPa`;
    case 'co2':
      return `${Math.round(value)} ppm`;
    default:
      return value.toFixed(1);
  }
}

export default {
  evaluateAndGenerateAlerts,
  autoResolveAlerts,
  ALERT_THRESHOLDS
};
