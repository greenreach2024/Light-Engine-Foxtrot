/**
 * LED Aging Detection — Phase 3, Task 27
 *
 * Tracks cumulative operating hours per LED fixture and detects degradation.
 * LEDs typically degrade to ~70% output (L70) by 50,000 hours.
 * 
 * Features:
 * - Cumulative hour tracking per device (persisted to NeDB)
 * - Estimated remaining L70 life
 * - Degradation compensation factor for spectral solver
 * - Alerts when fixture approaches end-of-life
 *
 * Data Pipe: Farm → Central via experiment record farm_context.fixture_hours
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const AGING_DATA_PATH = path.join(__dirname, '..', 'data', 'led-aging.json');

// LED degradation constants (typical high-power white/color LEDs)
const L70_HOURS = 50000;          // Hours to 70% output (industry standard)
const WARNING_THRESHOLD = 0.85;   // Alert at 85% estimated life remaining
const CRITICAL_THRESHOLD = 0.75;  // Critical alert at 75%
const COMPENSATION_MAX = 1.15;    // Max 15% compensation boost

/**
 * Load the aging data file.
 * @returns {{ devices: Record<string, DeviceAging>, updated_at: string }}
 */
export function loadAgingData() {
  try {
    const raw = fs.readFileSync(AGING_DATA_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return { devices: {}, updated_at: null };
  }
}

/**
 * Save aging data to disk.
 */
function saveAgingData(data) {
  data.updated_at = new Date().toISOString();
  fs.writeFileSync(AGING_DATA_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Record that a device was active for a given duration.
 * Called from the schedule executor or daily resolver.
 *
 * @param {string} deviceId
 * @param {number} hoursOn - hours the fixture was powered on
 * @param {object} [meta] - optional { vendor, model, installDate }
 */
export function recordFixtureHours(deviceId, hoursOn, meta = {}) {
  if (!deviceId || !Number.isFinite(hoursOn) || hoursOn <= 0) return;

  const data = loadAgingData();
  if (!data.devices[deviceId]) {
    data.devices[deviceId] = {
      cumulative_hours: 0,
      first_tracked: new Date().toISOString(),
      last_updated: null,
      vendor: meta.vendor || null,
      model: meta.model || null,
      install_date: meta.installDate || null,
      daily_log: []
    };
  }

  const dev = data.devices[deviceId];
  dev.cumulative_hours = +(dev.cumulative_hours + hoursOn).toFixed(1);
  dev.last_updated = new Date().toISOString();

  // Keep last 90 daily entries for trend analysis
  const today = new Date().toISOString().slice(0, 10);
  const existing = dev.daily_log.find(d => d.date === today);
  if (existing) {
    existing.hours = +(existing.hours + hoursOn).toFixed(1);
  } else {
    dev.daily_log.push({ date: today, hours: +hoursOn.toFixed(1) });
  }
  if (dev.daily_log.length > 90) {
    dev.daily_log = dev.daily_log.slice(-90);
  }

  saveAgingData(data);
}

/**
 * Get the estimated degradation factor for a device.
 * Returns a value between 0.0 (dead) and 1.0 (new).
 * Based on exponential decay model: output = e^(-k * hours)
 * where k is calibrated so output = 0.7 at L70_HOURS.
 *
 * @param {string} deviceId
 * @returns {{ factor: number, hours: number, remaining_hours: number, status: string }}
 */
export function getDeviceDegradation(deviceId) {
  const data = loadAgingData();
  const dev = data.devices?.[deviceId];

  if (!dev) {
    return { factor: 1.0, hours: 0, remaining_hours: L70_HOURS, status: 'unknown' };
  }

  const hours = dev.cumulative_hours || 0;
  // Exponential decay: factor = exp(-k * hours), k = -ln(0.7) / L70_HOURS
  const k = -Math.log(0.7) / L70_HOURS;
  const factor = Math.exp(-k * hours);

  const remaining = Math.max(0, L70_HOURS - hours);
  let status = 'good';
  if (factor <= CRITICAL_THRESHOLD) {
    status = 'critical';
  } else if (factor <= WARNING_THRESHOLD) {
    status = 'warning';
  }

  return {
    factor: +factor.toFixed(4),
    hours: +hours.toFixed(1),
    remaining_hours: +remaining.toFixed(0),
    life_pct: +((1 - hours / L70_HOURS) * 100).toFixed(1),
    status
  };
}

/**
 * Get a compensation multiplier to counteract aging.
 * Boosts output to approximate original PPFD, capped at COMPENSATION_MAX.
 *
 * @param {string} deviceId
 * @returns {number} multiplier (1.0 = no compensation, up to COMPENSATION_MAX)
 */
export function getAgingCompensation(deviceId) {
  const { factor } = getDeviceDegradation(deviceId);
  if (factor >= 0.99) return 1.0;
  // Compensate: multiply output by 1/factor, but cap at max
  return Math.min(COMPENSATION_MAX, +(1 / factor).toFixed(4));
}

/**
 * Get cumulative hours for a device (for experiment record farm_context).
 *
 * @param {string} deviceId
 * @returns {number|null}
 */
export function getFixtureHours(deviceId) {
  const data = loadAgingData();
  return data.devices?.[deviceId]?.cumulative_hours ?? null;
}

/**
 * Get aging alerts for all devices.
 * Returns devices that need attention.
 *
 * @returns {Array<{ deviceId: string, status: string, hours: number, life_pct: number, message: string }>}
 */
export function getAgingAlerts() {
  const data = loadAgingData();
  const alerts = [];

  for (const [deviceId, dev] of Object.entries(data.devices || {})) {
    const deg = getDeviceDegradation(deviceId);
    if (deg.status === 'warning' || deg.status === 'critical') {
      alerts.push({
        deviceId,
        status: deg.status,
        hours: deg.hours,
        life_pct: deg.life_pct,
        factor: deg.factor,
        message: `LED fixture ${deviceId}: ${deg.hours.toFixed(0)}h cumulative (${deg.life_pct.toFixed(0)}% life remaining) — ${deg.status === 'critical' ? 'replacement recommended' : 'aging detected'}`
      });
    }
  }

  return alerts;
}

/**
 * Log daily fixture hours based on photoperiod schedule.
 * Called once per daily resolver run for each active device.
 *
 * @param {string} deviceId
 * @param {number|null} photoperiodHours - today's scheduled on-hours
 */
export function logDailyFixtureRun(deviceId, photoperiodHours) {
  if (!deviceId || !Number.isFinite(photoperiodHours) || photoperiodHours <= 0) return;
  recordFixtureHours(deviceId, photoperiodHours);
}

export default {
  loadAgingData,
  recordFixtureHours,
  getDeviceDegradation,
  getAgingCompensation,
  getFixtureHours,
  getAgingAlerts,
  logDailyFixtureRun
};
