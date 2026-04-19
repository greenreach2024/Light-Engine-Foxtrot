/**
 * Device Health Tracker
 * 
 * Ticket I-3.10: Device uptime tracking
 * 
 * Tracks connection success/failure per device to compute rolling 24h uptime %.
 * Stores health metrics in deviceHealthDB (NeDB).
 * Triggers alerts when uptime falls below threshold.
 * 
 * @module lib/device-health-tracker
 */

import Datastore from '@seald-io/nedb';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { resolveRuntimeStatePath } from './runtime-state.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load thresholds from config
let thresholds = {
  default: { minUptime: 90, alertOnFailure: 3 },
  light: { minUptime: 95, alertOnFailure: 2 },
  sensor: { minUptime: 85, alertOnFailure: 5 },
  hvac: { minUptime: 95, alertOnFailure: 2 },
  plug: { minUptime: 90, alertOnFailure: 3 },
  irrigation: { minUptime: 90, alertOnFailure: 3 }
};

try {
  const thresholdsPath = path.join(__dirname, '../data/device-thresholds.json');
  if (fs.existsSync(thresholdsPath)) {
    thresholds = JSON.parse(fs.readFileSync(thresholdsPath, 'utf-8'));
  }
} catch (err) {
  console.warn('[device-health] Failed to load thresholds, using defaults:', err.message);
}

// NeDB store for device health metrics
let healthDB = null;

/**
 * Initialize health tracker with database
 * @param {Datastore} db - NeDB store for health data
 */
export function initHealthTracker(db) {
  healthDB = db;
  console.log('[device-health] Health tracker initialized');
}

/**
 * Create default NeDB store if none provided
 */
export function createHealthDB(dataDir = './data') {
  return new Datastore({
    filename: resolveRuntimeStatePath(path.join(dataDir, 'device-health.db')),
    autoload: true,
    timestampData: true
  });
}

/**
 * Record a device check result (success or failure)
 * @param {string} deviceId - Device identifier
 * @param {boolean} success - True if device responded successfully
 * @param {Object} [details] - Optional details (latency, error message)
 */
export async function recordDeviceCheck(deviceId, success, details = {}) {
  if (!healthDB) {
    console.warn('[device-health] DB not initialized, skipping record');
    return;
  }

  const record = {
    deviceId,
    success,
    timestamp: new Date().toISOString(),
    latencyMs: details.latencyMs || null,
    error: details.error || null,
    protocol: details.protocol || null,
    deviceType: details.deviceType || null
  };

  await healthDB.insert(record);
  
  // Check for consecutive failures (alert trigger)
  if (!success) {
    await checkForAlertCondition(deviceId, details.deviceType);
  }
}

/**
 * Check if device should trigger an alert based on consecutive failures
 */
async function checkForAlertCondition(deviceId, deviceType) {
  const threshold = thresholds[deviceType] || thresholds.default;
  const failureThreshold = threshold.alertOnFailure || 3;
  
  // Get last N checks
  const recentChecks = await healthDB.find({
    deviceId,
    timestamp: { $gte: new Date(Date.now() - 60 * 60 * 1000).toISOString() } // Last hour
  });
  
  // Sort by timestamp descending
  recentChecks.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  
  // Count consecutive failures
  let consecutiveFailures = 0;
  for (const check of recentChecks) {
    if (!check.success) {
      consecutiveFailures++;
    } else {
      break;
    }
  }
  
  if (consecutiveFailures >= failureThreshold) {
    console.warn(`[device-health] ⚠️ ALERT: Device ${deviceId} has ${consecutiveFailures} consecutive failures`);
    // Alert is logged; actual notification would be via alert system
    return { alert: true, consecutiveFailures };
  }
  
  return { alert: false, consecutiveFailures };
}

/**
 * Calculate rolling 24-hour uptime percentage for a device
 * @param {string} deviceId - Device identifier
 * @returns {Promise<{uptime: number, checks: number, successes: number, failures: number}>}
 */
export async function getDeviceUptime(deviceId) {
  if (!healthDB) {
    return { uptime: null, checks: 0, successes: 0, failures: 0, error: 'DB not initialized' };
  }

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  
  const checks = await healthDB.find({
    deviceId,
    timestamp: { $gte: oneDayAgo }
  });
  
  const successes = checks.filter(c => c.success).length;
  const failures = checks.filter(c => !c.success).length;
  const total = checks.length;
  
  const uptime = total > 0 ? Math.round((successes / total) * 100) : null;
  
  return { uptime, checks: total, successes, failures };
}

/**
 * Get health status for all tracked devices
 * @returns {Promise<Array<{deviceId: string, uptime: number, status: string, lastCheck: string}>>}
 */
export async function getAllDeviceHealth() {
  if (!healthDB) {
    return [];
  }

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  
  // Get all checks from last 24h
  const allChecks = await healthDB.find({
    timestamp: { $gte: oneDayAgo }
  });
  
  // Group by device
  const deviceMap = new Map();
  for (const check of allChecks) {
    if (!deviceMap.has(check.deviceId)) {
      deviceMap.set(check.deviceId, {
        deviceId: check.deviceId,
        deviceType: check.deviceType,
        checks: [],
        lastCheck: check.timestamp
      });
    }
    const device = deviceMap.get(check.deviceId);
    device.checks.push(check);
    if (check.timestamp > device.lastCheck) {
      device.lastCheck = check.timestamp;
    }
  }
  
  // Calculate uptime for each device
  const results = [];
  for (const [deviceId, data] of deviceMap) {
    const successes = data.checks.filter(c => c.success).length;
    const total = data.checks.length;
    const uptime = total > 0 ? Math.round((successes / total) * 100) : null;
    
    // Determine status based on threshold
    const threshold = thresholds[data.deviceType] || thresholds.default;
    let status = 'healthy';
    if (uptime !== null && uptime < threshold.minUptime) {
      status = 'degraded';
    }
    if (uptime !== null && uptime < 50) {
      status = 'critical';
    }
    
    results.push({
      deviceId,
      deviceType: data.deviceType,
      uptime,
      status,
      checks: total,
      successes,
      failures: total - successes,
      lastCheck: data.lastCheck,
      threshold: threshold.minUptime
    });
  }
  
  // Sort by uptime ascending (worst first)
  results.sort((a, b) => (a.uptime ?? 100) - (b.uptime ?? 100));
  
  return results;
}

/**
 * Get summary health metrics for integration sync
 * Returns aggregated data suitable for Central sync
 */
export async function getHealthSummaryForSync() {
  if (!healthDB) {
    return null;
  }

  const devices = await getAllDeviceHealth();
  
  if (devices.length === 0) {
    return null;
  }
  
  // Aggregate by device type
  const byType = {};
  for (const device of devices) {
    const type = device.deviceType || 'unknown';
    if (!byType[type]) {
      byType[type] = { count: 0, totalUptime: 0, degraded: 0 };
    }
    byType[type].count++;
    byType[type].totalUptime += device.uptime ?? 0;
    if (device.status !== 'healthy') {
      byType[type].degraded++;
    }
  }
  
  // Calculate averages
  const summary = {};
  for (const [type, data] of Object.entries(byType)) {
    summary[type] = {
      device_count: data.count,
      avg_uptime: Math.round(data.totalUptime / data.count),
      degraded_count: data.degraded
    };
  }
  
  return {
    total_devices: devices.length,
    healthy: devices.filter(d => d.status === 'healthy').length,
    degraded: devices.filter(d => d.status === 'degraded').length,
    critical: devices.filter(d => d.status === 'critical').length,
    by_type: summary,
    collected_at: new Date().toISOString()
  };
}

/**
 * Prune old health records (older than 7 days)
 * Call this periodically (e.g., daily) to prevent unbounded growth
 */
export async function pruneOldRecords() {
  if (!healthDB) return { pruned: 0 };
  
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  
  const numRemoved = await healthDB.remove(
    { timestamp: { $lt: sevenDaysAgo } },
    { multi: true }
  );
  
  if (numRemoved > 0) {
    console.log(`[device-health] Pruned ${numRemoved} old health records`);
  }
  
  return { pruned: numRemoved };
}

/**
 * Get current thresholds configuration
 */
export function getThresholds() {
  return { ...thresholds };
}

/**
 * Update thresholds at runtime
 * @param {Object} newThresholds - Threshold updates (merged with existing)
 */
export function updateThresholds(newThresholds) {
  thresholds = { ...thresholds, ...newThresholds };
  
  // Optionally persist to file
  try {
    const thresholdsPath = path.join(__dirname, '../data/device-thresholds.json');
    fs.writeFileSync(thresholdsPath, JSON.stringify(thresholds, null, 2));
    console.log('[device-health] Thresholds updated and persisted');
  } catch (err) {
    console.warn('[device-health] Failed to persist thresholds:', err.message);
  }
}

export default {
  initHealthTracker,
  createHealthDB,
  recordDeviceCheck,
  getDeviceUptime,
  getAllDeviceHealth,
  getHealthSummaryForSync,
  pruneOldRecords,
  getThresholds,
  updateThresholds
};
