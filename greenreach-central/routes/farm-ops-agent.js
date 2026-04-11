/**
 * Farm Operations Agent — Daily To-Do Generator, Tool Gateway, and Command Taxonomy
 * ==================================================================================
 *
 * Deterministic, citation-backed daily task engine for Light Engine / GreenReach Central.
 *
 * Scoring formula (per build plan):
 *   score = 0.35*Urgency + 0.25*Impact + 0.15*Risk + 0.15*Confidence - 0.10*Effort
 *
 * Data sources:
 *   - wholesale-orders-status.json   → wholesale orders due / overdue
 *   - harvest-log.json               → harvest readiness + cycle timing
 *   - rooms.json / room-map-*.json   → active rooms, zones, tray positions
 *   - env-cache.json / env.json      → live environment readings
 *   - target-ranges.json             → environmental target ranges
 *   - system-alerts.json             → sensor outages, anomalies
 *   - crop-registry.json             → crop cycle lengths, seeding windows
 *   - device-meta.json               → IoT device status
 *   - demand-succession-suggestions  → upcoming seeding suggestions
 *   - ai-recommendations.json        → AI/ML-derived actions
 *
 * Endpoints:
 *   GET  /daily-todo           → ranked task list for today
 *   POST /tool-gateway         → schema-validated tool execution with audit
 *   GET  /tool-catalog         → list available tools with schemas
 *   POST /parse-command        → intent + slot extraction from natural language
 *   GET  /audit-log            → paginated audit trail of agent actions
 */

import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { createRequire } from 'module';
import farmStore from '../lib/farm-data-store.js';
import { query as dbQuery, isDatabaseAvailable } from '../config/database.js';
import leamBridge from '../lib/leam-bridge.js';
import { readJSON as gcsReadJSON, writeJSON as gcsWriteJSON } from '../services/gcs-storage.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '..', 'public', 'data');

// Load crop-utils (UMD module) for name/alias/planId resolution
const require_ = createRequire(import.meta.url);
const cropUtils = require_(path.join(__dirname, '..', 'public', 'js', 'crop-utils.js'));

const router = express.Router();

// ============================================================================
// Helpers
// ============================================================================

function readJSON(filename, fallback = null) {
  // Synchronous local fallback for startup; runtime writes go through GCS
  try {
    const filePath = path.join(DATA_DIR, filename);
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

async function readJSONAsync(filename, fallback = null) {
  try {
    return await gcsReadJSON(`data/${filename}`, fallback);
  } catch {
    return fallback;
  }
}

async function writeJSONAsync(filename, data) {
  await gcsWriteJSON(`data/${filename}`, data);
}

function writeJSON(filename, data) {
  // Synchronous local write as fallback; prefer writeJSONAsync for new code
  const filePath = path.join(DATA_DIR, filename);
  const tmpPath = filePath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
  fs.renameSync(tmpPath, filePath);
  // Also persist to GCS asynchronously (fire-and-forget for backward compat)
  gcsWriteJSON(`data/${filename}`, data).catch(err => {
    console.warn(`[farm-ops-agent] GCS write failed for ${filename}:`, err.message);
  });
}

// ---------------------------------------------------------------------------
// Sensor data sync — keeps env-cache.json and device-meta.json fresh
// ---------------------------------------------------------------------------
function syncSensorData() {
  try {
    const iotDevices = readJSON('iot-devices.json', null);
    if (!iotDevices || !Array.isArray(iotDevices) || iotDevices.length === 0) return;

    // --- Update device-meta.json with latest telemetry ---
    const raw = readJSON('device-meta.json', { devices: {}, lastUpdated: null, version: '1.0.0' });
    const isWrapper = raw.devices && typeof raw.devices === 'object' && !Array.isArray(raw.devices);
    const devices = isWrapper ? raw.devices : {};
    let metaChanged = false;

    for (const d of iotDevices) {
      if (devices[d.id] && d.telemetry) {
        devices[d.id].telemetry = d.telemetry;
        devices[d.id].status = 'online';
        metaChanged = true;
      }
    }
    if (metaChanged) {
      raw.devices = devices;
      raw.lastUpdated = new Date().toISOString();
      writeJSON('device-meta.json', raw);
    }

    // --- Rebuild env-cache.json from sensor readings ---
    const sensors = iotDevices.filter(d => d.telemetry && d.telemetry.temperature != null);
    if (sensors.length === 0) return;

    const zoneReadings = {};
    for (const s of sensors) {
      const zoneKey = s.zone ? `zone-${s.zone}` : null;
      if (!zoneKey) continue;
      if (!zoneReadings[zoneKey]) zoneReadings[zoneKey] = [];
      zoneReadings[zoneKey].push({
        temperature: s.telemetry.temperature,
        humidity: s.telemetry.humidity,
        battery: s.telemetry.battery,
        sensor_name: s.name
      });
    }

    const zones = {};
    for (const [zid, readings] of Object.entries(zoneReadings)) {
      const avgT = readings.reduce((s, r) => s + r.temperature, 0) / readings.length;
      const avgH = readings.reduce((s, r) => s + r.humidity, 0) / readings.length;
      const avgB = readings.reduce((s, r) => s + (r.battery || 0), 0) / readings.length;
      zones[zid] = {
        temperature: Math.round(avgT * 10) / 10,
        humidity: Math.round(avgH * 10) / 10,
        avg_battery: Math.round(avgB),
        sensor_count: readings.length,
        sensors: readings.map(r => r.sensor_name)
      };
    }

    const allT = sensors.filter(s => s.zone);
    const roomTemp = allT.length > 0
      ? Math.round((allT.reduce((s, r) => s + r.telemetry.temperature, 0) / allT.length) * 10) / 10
      : null;
    const roomHum = allT.length > 0
      ? Math.round((allT.reduce((s, r) => s + r.telemetry.humidity, 0) / allT.length) * 10) / 10
      : null;

    // Determine room_id from rooms.json
    const rooms = readJSON('rooms.json', {});
    const roomList = rooms.rooms || [];
    const roomId = roomList.length > 0 ? (roomList[0].id || roomList[0].room_id || 'room-default') : 'room-default';

    writeJSON('env-cache.json', {
      [roomId]: {
        temperature: roomTemp,
        humidity: roomHum,
        co2: null,
        par: null,
        vpd: null,
        zones,
        sensor_count: allT.length,
        source: 'iot-devices.json'
      },
      meta: { updatedAt: new Date().toISOString(), source: 'syncSensorData' }
    });

    // --- Proactive Alert Generation ---
    // Compare zone readings to targets and generate alerts for breaches
    try {
      const targetRanges = readJSON('target-ranges.json', {});
      const zt = targetRanges.zones || {};
      const dt = targetRanges.defaults || {};
      const existingAlerts = readJSON('system-alerts.json', []);
      const alertList = Array.isArray(existingAlerts) ? existingAlerts : (existingAlerts.alerts || []);
      let alertsChanged = false;

      for (const [zid, zdata] of Object.entries(zones)) {
        const targets = zt[zid] || dt;
        if (!targets.temp_min && !targets.temp_max) continue;

        // Temperature check
        if (zdata.temperature < targets.temp_min) {
          const alertId = `env-temp-low-${zid}`;
          if (!alertList.some(a => a.id === alertId && !a.resolved && !a.dismissed)) {
            alertList.push({ id: alertId, alert_type: 'environment', severity: 'warning', zone: zid, message: `${zid}: Temperature ${zdata.temperature}°C is below target minimum ${targets.temp_min}°C`, reading: zdata.temperature, target_min: targets.temp_min, created_at: new Date().toISOString(), resolved: false, dismissed: false, source: 'syncSensorData' });
            alertsChanged = true;
          }
        } else if (zdata.temperature > targets.temp_max) {
          const alertId = `env-temp-high-${zid}`;
          if (!alertList.some(a => a.id === alertId && !a.resolved && !a.dismissed)) {
            alertList.push({ id: alertId, alert_type: 'environment', severity: 'warning', zone: zid, message: `${zid}: Temperature ${zdata.temperature}°C exceeds target maximum ${targets.temp_max}°C`, reading: zdata.temperature, target_max: targets.temp_max, created_at: new Date().toISOString(), resolved: false, dismissed: false, source: 'syncSensorData' });
            alertsChanged = true;
          }
        } else {
          // Auto-resolve old temp alerts for this zone if back in range
          for (const a of alertList) {
            if (a.id?.startsWith(`env-temp-`) && a.id?.endsWith(zid) && !a.resolved) {
              a.resolved = true; a.resolved_at = new Date().toISOString();
              alertsChanged = true;
            }
          }
        }

        // Humidity check
        if (targets.rh_min && zdata.humidity < targets.rh_min) {
          const alertId = `env-rh-low-${zid}`;
          if (!alertList.some(a => a.id === alertId && !a.resolved && !a.dismissed)) {
            alertList.push({ id: alertId, alert_type: 'environment', severity: 'warning', zone: zid, message: `${zid}: Humidity ${zdata.humidity}% is below target minimum ${targets.rh_min}%`, reading: zdata.humidity, target_min: targets.rh_min, created_at: new Date().toISOString(), resolved: false, dismissed: false, source: 'syncSensorData' });
            alertsChanged = true;
          }
        } else if (targets.rh_max && zdata.humidity > targets.rh_max) {
          const alertId = `env-rh-high-${zid}`;
          if (!alertList.some(a => a.id === alertId && !a.resolved && !a.dismissed)) {
            alertList.push({ id: alertId, alert_type: 'environment', severity: 'warning', zone: zid, message: `${zid}: Humidity ${zdata.humidity}% exceeds target maximum ${targets.rh_max}%`, reading: zdata.humidity, target_max: targets.rh_max, created_at: new Date().toISOString(), resolved: false, dismissed: false, source: 'syncSensorData' });
            alertsChanged = true;
          }
        } else {
          for (const a of alertList) {
            if (a.id?.startsWith(`env-rh-`) && a.id?.endsWith(zid) && !a.resolved) {
              a.resolved = true; a.resolved_at = new Date().toISOString();
              alertsChanged = true;
            }
          }
        }

        // Low battery check (< 20%)
        if (zdata.avg_battery < 20) {
          const alertId = `battery-low-${zid}`;
          if (!alertList.some(a => a.id === alertId && !a.resolved && !a.dismissed)) {
            alertList.push({ id: alertId, alert_type: 'hardware', severity: 'info', zone: zid, message: `${zid}: Average sensor battery ${zdata.avg_battery}% — consider replacing batteries soon`, reading: zdata.avg_battery, created_at: new Date().toISOString(), resolved: false, dismissed: false, source: 'syncSensorData' });
            alertsChanged = true;
          }
        }
      }

      // Nutrient alert check
      try {
        const nutrientData = readJSON('nutrient-dashboard.json', { tanks: {} });
        for (const [tid, tank] of Object.entries(nutrientData.tanks || {})) {
          const ad = tank.autodose || {};
          const ph = tank.sensors?.ph?.current;
          const ec = tank.sensors?.ec?.current;
          if (ph != null && ad.phTarget != null && Math.abs(ph - ad.phTarget) > (ad.phTolerance || 0.3)) {
            const alertId = `nutrient-ph-${tid}`;
            if (!alertList.some(a => a.id === alertId && !a.resolved && !a.dismissed)) {
              alertList.push({ id: alertId, alert_type: 'nutrient', severity: 'warning', message: `${tid}: pH ${ph} is outside target ${ad.phTarget} ± ${ad.phTolerance || 0.3}`, created_at: new Date().toISOString(), resolved: false, dismissed: false, source: 'syncSensorData' });
              alertsChanged = true;
            }
          }
          if (ec != null && ad.ecTarget != null && Math.abs(ec - ad.ecTarget) > (ad.ecTolerance || 100)) {
            const alertId = `nutrient-ec-${tid}`;
            if (!alertList.some(a => a.id === alertId && !a.resolved && !a.dismissed)) {
              alertList.push({ id: alertId, alert_type: 'nutrient', severity: 'warning', message: `${tid}: EC ${ec} µS/cm is outside target ${ad.ecTarget} ± ${ad.ecTolerance || 100}`, created_at: new Date().toISOString(), resolved: false, dismissed: false, source: 'syncSensorData' });
              alertsChanged = true;
            }
          }
        }
      } catch { /* nutrient check non-fatal */ }

      // Keep only last 200 alerts, trim old resolved ones
      if (alertList.length > 200) {
        const active = alertList.filter(a => !a.resolved && !a.dismissed);
        const resolved = alertList.filter(a => a.resolved || a.dismissed).slice(-50);
        alertList.length = 0;
        alertList.push(...active, ...resolved);
        alertsChanged = true;
      }

      if (alertsChanged) writeJSON('system-alerts.json', alertList);
    } catch (alertErr) {
      console.error('[SyncSensorData] Alert generation error:', alertErr.message);
    }
  } catch (err) {
    console.error('[SyncSensorData] Error:', err.message);
  }
}

// Run sensor sync on startup and every 5 minutes
syncSensorData();
setInterval(syncSensorData, 5 * 60 * 1000);

// Initialize crop-utils registry cache (must happen after readJSON is defined)
try {
  const _registryData = readJSON('crop-registry.json', null);
  if (_registryData) cropUtils.setRegistry(_registryData);
} catch { /* ok — tools will still work, just without alias resolution */ }

/** Resolve a user-supplied crop name/alias/planId to its canonical registry name. */
function resolveCropName(input) {
  if (!input) return input;
  return cropUtils.normalizeCropName(input) || input;
}

/** Infer a normalised device type from raw device type strings (e.g. "MeterPlus" → "sensor"). */
function inferDeviceType(rawType) {
  const t = (rawType || '').toLowerCase();
  if (/meter|sensor|thermo|hygro|temp|humid|co2|ph|ec|par|ppfd/.test(t)) return 'sensor';
  if (/light|led|strip|bulb|lamp|color/.test(t)) return 'light_controller';
  if (/fan|ventilat|airflow|exhaust|circul/.test(t)) return 'fan_controller';
  if (/dehumid/.test(t)) return 'dehumidifier';
  if (/humidif/.test(t)) return 'humidifier';
  if (/hvac|heat|cool|ac\b|air.?condition/.test(t)) return 'hvac';
  if (/irrig|pump|water|valve|drip/.test(t)) return 'irrigation';
  if (/cam|motion/.test(t)) return 'camera';
  if (/hub|gateway|bridge/.test(t)) return 'hub';
  if (/plug|relay|switch|bot|curtain|blind/.test(t)) return 'relay';
  return 'other';
}

function todayISO() { return new Date().toISOString().slice(0, 10); }

function daysBetween(dateA, dateB) {
  const a = new Date(dateA);
  const b = new Date(dateB);
  return Math.round((b - a) / 86400000);
}

/**
 * Compute priority score.
 * All inputs are 0–1 floats except effort which is 0–1 (lower is easier).
 */
function priorityScore({ urgency = 0, impact = 0, risk = 0, confidence = 0.5, effort = 0.5 }) {
  return +(0.35 * urgency + 0.25 * impact + 0.15 * risk + 0.15 * confidence - 0.10 * effort).toFixed(4);
}

// ============================================================================
// 1. Daily To-Do Generator
// ============================================================================

/**
 * Gather tasks from all data sources and return a scored, ranked list.
 */
function generateDailyTodo() {
  const today = todayISO();
  const tasks = [];

  // --- Source A: Wholesale orders due soon or overdue ---
  const orders = readJSON('wholesale-orders-status.json', []);
  const orderArr = Array.isArray(orders) ? orders : (orders.orders || []);
  for (const order of orderArr) {
    if (!order.delivery_date && !order.due_date) continue;
    const due = order.delivery_date || order.due_date;
    const daysUntil = daysBetween(today, due);
    const status = (order.status || '').toLowerCase();
    if (status === 'delivered' || status === 'cancelled') continue;

    if (daysUntil <= 3) {
      const overdue = daysUntil < 0;
      tasks.push({
        id: `order-${order.order_id || order.id}`,
        category: 'wholesale',
        title: overdue
          ? `OVERDUE: Order ${order.order_id || order.id} was due ${Math.abs(daysUntil)} day(s) ago`
          : `Order ${order.order_id || order.id} due in ${daysUntil} day(s)`,
        why: `${order.buyer_name || 'Buyer'} — ${order.total_items || '?'} items, status: ${order.status || 'pending'}`,
        deadline: due,
        estimated_minutes: 30,
        actions: ['View order details', 'Begin fulfillment', 'Contact buyer'],
        dependencies: [],
        score: priorityScore({
          urgency: overdue ? 1.0 : Math.max(0, 1 - daysUntil / 3),
          impact: 0.9,
          risk: overdue ? 0.95 : 0.6,
          confidence: 0.95,
          effort: 0.3
        })
      });
    }
  }

  // --- Source B: Harvest readiness ---
  const harvestLog = readJSON('harvest-log.json', []);
  const harvests = Array.isArray(harvestLog) ? harvestLog : (harvestLog.harvests || harvestLog.records || []);
  const cropRegistry = readJSON('crop-registry.json', {});
  const crops = cropRegistry.crops || cropRegistry;

  // Check rooms for trays that may be ready to harvest
  const rooms = readJSON('rooms.json', {});
  const roomList = rooms.rooms || Object.values(rooms).filter(r => typeof r === 'object');

  for (const room of roomList) {
    const roomId = room.id || room.room_id;
    const roomMap = readJSON(`room-map-${roomId}.json`, null);
    if (!roomMap) continue;

    const zones = roomMap.zones || [];
    for (const zone of zones) {
      const trays = zone.trays || zone.positions || [];
      for (const tray of trays) {
        if (!tray.crop || !tray.planted_date) continue;
        const cropInfo = crops[tray.crop] || {};
        const cycleDays = cropInfo.cycle_days || cropInfo.growthDays || 28;
        const plantedDaysAgo = daysBetween(tray.planted_date, today);
        const daysUntilHarvest = cycleDays - plantedDaysAgo;

        if (daysUntilHarvest <= 2 && daysUntilHarvest >= -3) {
          tasks.push({
            id: `harvest-${roomId}-${zone.zone || zone.id}-${tray.position || tray.id}`,
            category: 'harvest',
            title: daysUntilHarvest <= 0
              ? `Ready to harvest: ${tray.crop} in ${room.name || roomId}`
              : `Harvest in ${daysUntilHarvest} day(s): ${tray.crop}`,
            why: `Planted ${plantedDaysAgo}d ago (cycle: ${cycleDays}d) — ${room.name || roomId}, Zone ${zone.zone || zone.id}`,
            deadline: new Date(new Date(tray.planted_date).getTime() + cycleDays * 86400000).toISOString().slice(0, 10),
            estimated_minutes: 20,
            actions: ['Harvest tray', 'Print label', 'Log harvest weight'],
            dependencies: [],
            score: priorityScore({
              urgency: daysUntilHarvest <= 0 ? 0.95 : 0.7,
              impact: 0.7,
              risk: daysUntilHarvest < -1 ? 0.8 : 0.3,
              confidence: 0.85,
              effort: 0.25
            })
          });
        }
      }
    }
  }

  // --- Source C: Seeding windows / succession planting ---
  const succSuggestions = readJSON('demand-succession-suggestions.json', {});
  const suggestions = succSuggestions.suggestions || succSuggestions.upcoming || [];
  for (const sug of (Array.isArray(suggestions) ? suggestions : Object.values(suggestions))) {
    const seedBy = sug.seed_by || sug.target_date;
    if (!seedBy) continue;
    const daysUntil = daysBetween(today, seedBy);
    if (daysUntil >= 0 && daysUntil <= 5) {
      tasks.push({
        id: `seed-${sug.crop || 'unknown'}-${seedBy}`,
        category: 'seeding',
        title: `Seed ${sug.crop || 'crop'}: window closes in ${daysUntil} day(s)`,
        why: sug.reason || `Succession planting for demand forecast`,
        deadline: seedBy,
        estimated_minutes: 45,
        actions: ['Seed trays', 'Update room map', 'Order supplies if needed'],
        dependencies: sug.requires || [],
        score: priorityScore({
          urgency: Math.max(0, 1 - daysUntil / 5),
          impact: 0.6,
          risk: 0.4,
          confidence: sug.confidence || 0.6,
          effort: 0.4
        })
      });
    }
  }

  // --- Source D: Environment anomalies & sensor outages ---
  const alerts = readJSON('system-alerts.json', []);
  const alertArr = Array.isArray(alerts) ? alerts : (alerts.alerts || []);
  for (const alert of alertArr) {
    if (alert.resolved || alert.dismissed) continue;
    const severity = (alert.severity || alert.level || 'info').toLowerCase();
    if (severity === 'info') continue;

    tasks.push({
      id: `alert-${alert.id || crypto.randomUUID().slice(0, 8)}`,
      category: 'anomaly',
      title: alert.title || alert.message || `${severity} alert`,
      why: alert.description || alert.details || 'System alert requires attention',
      deadline: today,
      estimated_minutes: 15,
      actions: ['Investigate', 'Acknowledge alert', 'Check sensor'],
      dependencies: [],
      score: priorityScore({
        urgency: severity === 'critical' ? 1.0 : severity === 'warning' ? 0.8 : 0.5,
        impact: severity === 'critical' ? 0.9 : 0.5,
        risk: severity === 'critical' ? 1.0 : 0.6,
        confidence: 0.9,
        effort: 0.2
      })
    });
  }

  // --- Source E: Environment drift (readings vs targets) ---
  const envCache = readJSON('env-cache.json', {});
  const targetRanges = readJSON('target-ranges.json', {});
  const zoneTargets = targetRanges.zones || {};
  const defaultTargets = targetRanges.defaults || {};

  for (const room of roomList) {
    const roomId = room.id || room.room_id;
    const envData = envCache[roomId] || envCache[room.name];
    if (!envData) continue;

    // Check each zone within the room (zone-level granularity)
    const zonesToCheck = envData.zones ? Object.entries(envData.zones) : [];
    // Also check room-level if no zone data
    if (zonesToCheck.length === 0 && (envData.temperature != null || envData.humidity != null)) {
      zonesToCheck.push([roomId, envData]);
    }

    for (const [zoneId, zoneEnv] of zonesToCheck) {
      const zt = zoneTargets[zoneId] || defaultTargets;
      if (!zt.temp_min && !zt.rh_min) continue;

      const checks = [
        { metric: 'temperature', value: zoneEnv.temperature || zoneEnv.temp, min: zt.temp_min, max: zt.temp_max, unit: '°C' },
        { metric: 'humidity', value: zoneEnv.humidity || zoneEnv.rh, min: zt.rh_min, max: zt.rh_max, unit: '%' },
        { metric: 'co2', value: zoneEnv.co2, min: zt.co2_min, max: zt.co2_max, unit: 'ppm' }
      ];

      for (const chk of checks) {
        if (chk.value == null || chk.min == null || chk.max == null) continue;
        const drift = chk.value < chk.min ? chk.min - chk.value : chk.value > chk.max ? chk.value - chk.max : 0;
        if (drift <= 0) continue;

        const range = chk.max - chk.min;
        const driftPct = range > 0 ? drift / range : 0.5;
        const label = zoneId !== roomId ? `${room.name || roomId} ${zoneId}` : (room.name || roomId);

        tasks.push({
          id: `env-drift-${zoneId}-${chk.metric}`,
          category: 'environment',
          title: `${chk.metric} out of range in ${label}`,
          why: `Current: ${chk.value}${chk.unit}, target: ${chk.min}–${chk.max}${chk.unit} (${drift.toFixed(1)}${chk.unit} off)`,
          deadline: today,
          estimated_minutes: 10,
          actions: ['Adjust controller', 'Check HVAC', 'Verify sensor'],
          dependencies: [],
          score: priorityScore({
            urgency: driftPct > 0.5 ? 0.9 : 0.6,
            impact: 0.6,
            risk: driftPct > 0.5 ? 0.7 : 0.4,
            confidence: 0.8,
            effort: 0.15
          })
        });
      }
    }
  }

  // --- Source F: AI recommendations ---
  const aiRecs = readJSON('ai-recommendations.json', {});
  const recActions = aiRecs.recommended_actions || aiRecs.actions || [];
  for (const rec of (Array.isArray(recActions) ? recActions : [])) {
    if (rec.dismissed || rec.completed) continue;
    tasks.push({
      id: `ai-rec-${rec.id || crypto.randomUUID().slice(0, 8)}`,
      category: 'ai-recommendation',
      title: rec.title || rec.action || 'AI recommendation',
      why: rec.reason || rec.explanation || 'Machine learning model suggests this action',
      deadline: rec.deadline || today,
      estimated_minutes: rec.estimated_minutes || 20,
      actions: rec.steps || ['Review recommendation', 'Accept or dismiss'],
      dependencies: rec.dependencies || [],
      score: priorityScore({
        urgency: rec.urgency || 0.5,
        impact: rec.impact || 0.5,
        risk: rec.risk || 0.3,
        confidence: rec.confidence || 0.6,
        effort: rec.effort || 0.4
      })
    });
  }

  // Sort by score descending
  tasks.sort((a, b) => b.score - a.score);

  return {
    ok: true,
    date: today,
    generated_at: new Date().toISOString(),
    task_count: tasks.length,
    tasks,
    scoring_formula: 'score = 0.35*Urgency + 0.25*Impact + 0.15*Risk + 0.15*Confidence - 0.10*Effort'
  };
}

router.get('/daily-todo', (req, res) => {
  try {
    const result = generateDailyTodo();
    // Optional: filter by category
    if (req.query.category) {
      result.tasks = result.tasks.filter(t => t.category === req.query.category);
      result.task_count = result.tasks.length;
    }
    // Optional: limit
    if (req.query.limit) {
      const limit = parseInt(req.query.limit, 10);
      if (limit > 0) {
        result.tasks = result.tasks.slice(0, limit);
        result.task_count = result.tasks.length;
      }
    }
    res.json(result);
  } catch (error) {
    console.error('[farm-ops-agent] daily-todo error:', error.message);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ============================================================================
// 2. Tool Gateway — Schema-validated tool execution with audit trail
// ============================================================================

/**
 * Tool catalog: defines every tool the agent can invoke.
 * Each tool has: name, description, category (read/write/dangerous),
 * required/optional slots, and the handler function.
 */
export const TOOL_CATALOG = {
  // --- Read tools ---
  'get_system_health': {
    description: 'Get the latest nightly system audit results — checks database, inventory pricing, POS readiness, wholesale catalog, farm sync freshness, AI services, payment gateways, Light Engine reachability, and auth. Returns overall status (pass/warn/fail) with per-check details.',
    category: 'read',
    required: [],
    optional: ['run_fresh'],
    handler: async (params) => {
      try {
        const { getLatestAudit, runNightlyAudit } = await import('../services/nightly-audit.js');
        const result = params.run_fresh === true
          ? await runNightlyAudit()
          : await getLatestAudit();
        return { ok: true, ...result };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }
  },
  'get_daily_todo': {
    description: 'Generate the ranked daily to-do list',
    category: 'read',
    required: [],
    optional: ['category', 'limit'],
    handler: async (params) => {
      const result = generateDailyTodo();
      if (params.category) result.tasks = result.tasks.filter(t => t.category === params.category);
      if (params.limit) result.tasks = result.tasks.slice(0, parseInt(params.limit, 10));
      result.task_count = result.tasks.length;
      return result;
    }
  },
  'get_room_status': {
    description: 'Get current environment and tray status for a room',
    category: 'read',
    required: ['room_id'],
    optional: [],
    handler: async ({ room_id }) => {
      const rooms = readJSON('rooms.json', {});
      const roomList = rooms.rooms || Object.values(rooms);
      const room = roomList.find(r => (r.id || r.room_id) === room_id);
      if (!room) return { ok: false, error: `Room ${room_id} not found` };
      const envCache = readJSON('env-cache.json', {});
      const roomMap = readJSON(`room-map-${room_id}.json`, null);
      const targetRanges = readJSON('target-ranges.json', {});
      const envData = envCache[room_id] || null;
      // Include per-zone targets alongside readings
      const zoneStatus = {};
      if (envData?.zones) {
        const zt = targetRanges.zones || {};
        const dt = targetRanges.defaults || {};
        for (const [zid, zenv] of Object.entries(envData.zones)) {
          const t = zt[zid] || dt;
          zoneStatus[zid] = {
            readings: zenv,
            targets: { temp_min: t.temp_min, temp_max: t.temp_max, rh_min: t.rh_min, rh_max: t.rh_max },
            temp_ok: zenv.temperature >= t.temp_min && zenv.temperature <= t.temp_max,
            humidity_ok: zenv.humidity >= t.rh_min && zenv.humidity <= t.rh_max
          };
        }
      }
      return {
        ok: true,
        room,
        environment: envData,
        zone_status: zoneStatus,
        zones: roomMap?.zones || [],
        zone_count: (roomMap?.zones || []).length
      };
    }
  },
  'get_orders': {
    description: 'List wholesale orders, optionally filtered by status',
    category: 'read',
    required: [],
    optional: ['status', 'limit'],
    handler: async ({ status, limit }) => {
      let orders = readJSON('wholesale-orders-status.json', []);
      orders = Array.isArray(orders) ? orders : (orders.orders || []);
      if (status) orders = orders.filter(o => (o.status || '').toLowerCase() === status.toLowerCase());
      if (limit) orders = orders.slice(0, parseInt(limit, 10));
      return { ok: true, count: orders.length, orders };
    }
  },
  'get_harvest_log': {
    description: 'Get recent harvest records',
    category: 'read',
    required: [],
    optional: ['crop', 'limit'],
    handler: async ({ crop, limit }) => {
      let harvests = readJSON('harvest-log.json', []);
      harvests = Array.isArray(harvests) ? harvests : (harvests.harvests || harvests.records || []);
      if (crop) harvests = harvests.filter(h => (h.crop || '').toLowerCase() === crop.toLowerCase());
      if (limit) harvests = harvests.slice(-parseInt(limit, 10));
      return { ok: true, count: harvests.length, harvests };
    }
  },
  'get_alerts': {
    description: 'Get active system alerts and anomalies',
    category: 'read',
    required: [],
    optional: ['severity'],
    handler: async ({ severity }) => {
      let alerts = readJSON('system-alerts.json', []);
      alerts = (Array.isArray(alerts) ? alerts : (alerts.alerts || [])).filter(a => !a.resolved && !a.dismissed);
      if (severity) alerts = alerts.filter(a => (a.severity || a.level || '').toLowerCase() === severity.toLowerCase());
      return { ok: true, count: alerts.length, alerts };
    }
  },

  // --- Phase 2A: Expanded Read Tools ---
  'get_pricing_decisions': {
    description: 'Get recent pricing decisions and their outcomes',
    category: 'read',
    required: [],
    optional: ['crop', 'limit'],
    handler: async (params) => {
      if (!isDatabaseAvailable()) return { ok: true, decisions: [], message: 'Database unavailable' };
      try {
        const limit = parseInt(params.limit) || 10;
        const values = [];
        let sql = 'SELECT * FROM pricing_decisions';
        if (params.crop) {
          values.push(`%${params.crop}%`);
          sql += ' WHERE crop ILIKE $1';
        }
        sql += ` ORDER BY created_at DESC LIMIT $${values.length + 1}`;
        values.push(limit);
        const result = await dbQuery(sql, values);
        return { ok: true, decisions: result.rows, count: result.rows.length };
      } catch (err) {
        return { ok: true, decisions: [], message: err.message };
      }
    }
  },
  'get_planting_assignments': {
    description: 'Get all active planting assignments — what is planted where, seed dates, expected harvest dates',
    category: 'read',
    required: [],
    optional: ['farm_id', 'status'],
    handler: async (params) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
      const farm_id = params.farm_id;
      if (!farm_id) return { ok: false, error: 'farm_id is required' };
      const status = params.status || 'active';
      try {
        const result = await dbQuery(
          `SELECT group_id, crop_name, crop_id, seed_date, harvest_date, status, notes, updated_at
           FROM planting_assignments WHERE farm_id = $1 AND status = $2
           ORDER BY seed_date ASC`,
          [farm_id, status]
        );
        const assignments = (result.rows || []).map(r => ({
          group_id: r.group_id, crop: r.crop_name, crop_id: r.crop_id,
          seed_date: r.seed_date ? new Date(r.seed_date).toISOString().split('T')[0] : null,
          harvest_date: r.harvest_date ? new Date(r.harvest_date).toISOString().split('T')[0] : null,
          status: r.status, notes: r.notes
        }));
        return { ok: true, count: assignments.length, assignments };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }
  },
  'get_scheduled_harvests': {
    description: 'Get upcoming harvests — active plantings with expected harvest dates and days remaining',
    category: 'read',
    required: [],
    optional: ['farm_id', 'days_ahead'],
    handler: async (params) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
      const farm_id = params.farm_id;
      if (!farm_id) return { ok: false, error: 'farm_id is required' };
      const daysAhead = params.days_ahead || 60;
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() + daysAhead);
      try {
        const result = await dbQuery(
          `SELECT group_id, crop_name, seed_date, harvest_date, status, notes
           FROM planting_assignments
           WHERE farm_id = $1 AND status = 'active' AND harvest_date IS NOT NULL AND harvest_date <= $2
           ORDER BY harvest_date ASC`,
          [farm_id, cutoff.toISOString().split('T')[0]]
        );
        const today = new Date(); today.setHours(0,0,0,0);
        const upcoming = (result.rows || []).map(r => {
          const hd = new Date(r.harvest_date);
          const daysRemaining = Math.ceil((hd - today) / 86400000);
          return {
            group_id: r.group_id, crop: r.crop_name,
            seed_date: r.seed_date ? new Date(r.seed_date).toISOString().split('T')[0] : null,
            harvest_date: new Date(r.harvest_date).toISOString().split('T')[0],
            days_remaining: daysRemaining,
            status: daysRemaining <= 0 ? 'ready' : daysRemaining <= 3 ? 'imminent' : 'upcoming',
            notes: r.notes
          };
        });
        const ready = upcoming.filter(h => h.status === 'ready').length;
        const imminent = upcoming.filter(h => h.status === 'imminent').length;
        return { ok: true, count: upcoming.length, ready, imminent, upcoming_harvests: upcoming };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }
  },
  'get_capacity': {
    description: 'Get farm capacity utilization — total trays, used, available, utilization percentage',
    category: 'read',
    required: [],
    optional: ['farm_id'],
    handler: async (params) => {
      const farm_id = params.farm_id;
      if (!farm_id) return { ok: false, error: 'farm_id is required' };
      const groups = await farmStore.get(farm_id, 'groups') || [];
      const totalCapacity = groups.reduce((sum, g) => {
        const trays = Number(g.trays) || (Array.isArray(g.trays) ? g.trays.length : 0) || Number(g.trayCount) || 0;
        return sum + trays;
      }, 0) || 0;
      let usedCapacity = 0;
      if (isDatabaseAvailable()) {
        try {
          const result = await dbQuery('SELECT COUNT(*) as count FROM planting_assignments WHERE farm_id = $1', [farm_id]);
          usedCapacity = parseInt(result.rows[0]?.count || 0);
        } catch { /* ok */ }
      }
      const availableCapacity = Math.max(0, totalCapacity - usedCapacity);
      const utilizationPercent = totalCapacity > 0 ? Math.round((usedCapacity / totalCapacity) * 10000) / 100 : 0;
      return { ok: true, farmId: farm_id, totalCapacity, usedCapacity, availableCapacity, utilizationPercent };
    }
  },
  'get_inventory_summary': {
    description: 'Get current crop inventory — includes both tray-synced (auto) and manual inventory with quantities in lbs, source type, and pricing.',
    category: 'read',
    required: [],
    optional: ['farm_id'],
    handler: async (params) => {
      const farm_id = params.farm_id;
      if (!farm_id) return { ok: false, error: 'farm_id is required' };
      // Read from farmStore (legacy JSON)
      const storeInventory = await farmStore.get(farm_id, 'inventory') || [];
      // Read from farm_inventory DB table (auto + manual quantities)
      let dbInventory = [];
      if (isDatabaseAvailable()) {
        try {
          const result = await dbQuery(
            `SELECT product_id, product_name, sku, unit,
                    COALESCE(auto_quantity_lbs, 0) AS auto_lbs,
                    COALESCE(manual_quantity_lbs, 0) AS manual_lbs,
                    COALESCE(auto_quantity_lbs, 0) + COALESCE(manual_quantity_lbs, 0) AS available_lbs,
                    quantity_unit, wholesale_price, retail_price,
                    inventory_source, category, available_for_wholesale,
                    last_updated
             FROM farm_inventory WHERE farm_id = $1
             ORDER BY product_name`, [farm_id]
          );
          dbInventory = result.rows;
        } catch { /* table may not exist yet */ }
      }
      // Enrich DB inventory with crop-pricing fallback (same as inventory page)
      if (dbInventory.length > 0) {
        try {
          const pricingData = await farmStore.get(farm_id, 'crop_pricing') || { crops: [] };
          const priceMap = {};
          (pricingData.crops || []).forEach(c => {
            if (c.crop) priceMap[c.crop.toLowerCase()] = c;
          });
          for (const row of dbInventory) {
            const cp = row.product_name ? priceMap[row.product_name.toLowerCase()] : null;
            if (cp) {
              if (!Number(row.retail_price) && cp.retailPrice) row.retail_price = Number(cp.retailPrice);
              if (!Number(row.wholesale_price) && cp.wholesalePrice) row.wholesale_price = Number(cp.wholesalePrice);
            }
          }
        } catch { /* crop_pricing lookup failed */ }
      }
      return {
        ok: true,
        farm_inventory: dbInventory,
        store_inventory: Array.isArray(storeInventory) ? storeInventory : Object.values(storeInventory),
        db_count: dbInventory.length,
        store_count: Array.isArray(storeInventory) ? storeInventory.length : Object.keys(storeInventory).length
      };
    }
  },
  'get_crop_info': {
    description: 'Get detailed crop registry info — growth parameters, pricing, categories',
    category: 'read',
    required: [],
    optional: ['crop'],
    handler: async (params) => {
      const registry = readJSON('crop-registry.json', {});
      let crops = registry.crops || registry;
      if (typeof crops === 'object' && !Array.isArray(crops)) {
        crops = Object.entries(crops).map(([name, info]) => ({ name, ...info }));
      }
      if (params.crop) {
        // Resolve alias/planId to canonical name first, then fall back to substring
        const resolved = resolveCropName(params.crop);
        crops = crops.filter(c => {
          const cName = (c.name || '').toLowerCase();
          const rLower = resolved.toLowerCase();
          const pLower = params.crop.toLowerCase();
          return cName === rLower || cName.includes(pLower) ||
            (c.id || '').toLowerCase().includes(pLower) ||
            (c.aliases || []).some(a => a.toLowerCase().includes(pLower));
        });
      }
      return { ok: true, crops, count: crops.length };
    }
  },
  'get_farm_insights': {
    description: 'Get AI environmental insights and recipe recommendations',
    category: 'read',
    required: [],
    optional: ['farm_id'],
    handler: async (params) => {
      const farm_id = params.farm_id;
      if (!farm_id) return { ok: false, error: 'farm_id is required' };
      if (!isDatabaseAvailable()) return { ok: true, insights: [], message: 'Database unavailable' };
      try {
        const result = await dbQuery(
          'SELECT * FROM ai_insights WHERE farm_id = $1 ORDER BY created_at DESC LIMIT 5',
          [farm_id]
        );
        return { ok: true, insights: result.rows, count: result.rows.length };
      } catch {
        return { ok: true, insights: [], message: 'No AI insights available yet' };
      }
    }
  },
  'get_ai_recommendations': {
    description: 'Get AI Pusher recommendations from network intelligence',
    category: 'read',
    required: [],
    optional: ['limit'],
    handler: async (params) => {
      const aiRecs = readJSON('ai-recommendations.json', {});
      let recs = aiRecs.recommended_actions || aiRecs.actions || aiRecs.recommendations || [];
      recs = recs.filter(r => !r.dismissed && !r.completed);
      if (params.limit) recs = recs.slice(0, parseInt(params.limit, 10));
      return {
        ok: true,
        recommendations: recs,
        count: recs.length,
        generated_at: aiRecs.generated_at || null,
        farm_id: aiRecs.farm_id || null
      };
    }
  },

  // --- Write tools ---
  'dismiss_alert': {
    description: 'Dismiss a system alert by ID',
    category: 'write',
    required: ['alert_id'],
    optional: ['reason'],
    undoable: true,
    handler: async ({ alert_id, reason }) => {
      let alerts = readJSON('system-alerts.json', []);
      alerts = Array.isArray(alerts) ? alerts : (alerts.alerts || []);
      const alert = alerts.find(a => a.id === alert_id);
      if (!alert) return { ok: false, error: `Alert ${alert_id} not found` };
      const previousState = { dismissed: alert.dismissed, dismissed_at: alert.dismissed_at, dismiss_reason: alert.dismiss_reason };
      alert.dismissed = true;
      alert.dismissed_at = new Date().toISOString();
      alert.dismiss_reason = reason || 'Agent-dismissed';
      writeJSON('system-alerts.json', alerts);
      return { ok: true, alert_id, dismissed: true, _undo_state: previousState };
    },
    undoHandler: async ({ alert_id }, previousState) => {
      let alerts = readJSON('system-alerts.json', []);
      alerts = Array.isArray(alerts) ? alerts : (alerts.alerts || []);
      const alert = alerts.find(a => a.id === alert_id);
      if (!alert) return { ok: false, error: `Alert ${alert_id} not found for undo` };
      alert.dismissed = previousState.dismissed || false;
      alert.dismissed_at = previousState.dismissed_at || undefined;
      alert.dismiss_reason = previousState.dismiss_reason || undefined;
      writeJSON('system-alerts.json', alerts);
      return { ok: true, alert_id, undone: true };
    }
  },
  'get_device_status': {
    description: 'Get current IoT device inventory — assigned and unassigned devices, rooms, counts',
    category: 'read',
    required: [],
    optional: [],
    handler: async () => {
      const raw = readJSON('device-meta.json', {});
      const devices = raw.devices || (Array.isArray(raw) ? {} : (() => { const { version, lastUpdated, farmId, ...rest } = raw; return rest; })());
      const rooms = readJSON('rooms.json', {});
      const roomList = (rooms.rooms || Object.values(rooms).filter(r => r != null && typeof r === 'object'));
      const entries = Object.entries(devices);
      const assigned = entries.filter(([_, d]) => d && d.room_id);
      const unassigned = entries.filter(([_, d]) => d && !d.room_id);
      return {
        ok: true,
        total_devices: entries.length,
        assigned: assigned.length,
        unassigned: unassigned.length,
        unassigned_devices: unassigned.map(([id, d]) => ({ id, type: d.type || d.protocol || 'unknown', name: d.name || id })),
        assigned_devices: assigned.map(([id, d]) => ({ id, type: d.type || d.protocol || 'unknown', room_id: d.room_id, zone: d.zone })),
        rooms: roomList.map(r => ({ id: r.id || r.room_id, name: r.name })),
      };
    }
  },
  'auto_assign_devices': {
    description: 'Auto-assign unassigned IoT devices to rooms/zones based on type and availability',
    category: 'write',
    required: [],
    optional: ['room_id'],
    undoable: true,
    handler: async ({ room_id }) => {
      const raw = readJSON('device-meta.json', {});
      // Extract devices map from wrapper format { devices: {}, version, ... } or bare map
      const isWrapper = raw.devices && typeof raw.devices === 'object' && !Array.isArray(raw.devices);
      const devices = isWrapper ? raw.devices : (() => { const { version, lastUpdated, farmId, ...rest } = raw; return rest; })();
      const rooms = readJSON('rooms.json', {});
      const roomList = (rooms.rooms || Object.values(rooms).filter(r => r != null && typeof r === 'object'));

      // Snapshot for undo
      const previousAssignments = {};
      const assignments = [];
      const unassigned = Object.entries(devices).filter(([_, d]) => d && !d.room_id);

      if (unassigned.length === 0) {
        return { ok: true, assigned: 0, message: 'All devices are already assigned.' };
      }

      // Simple round-robin assignment: assign to rooms that have fewest devices
      const roomDeviceCounts = {};
      for (const r of roomList) {
        if (!r) continue;
        const rid = r.id || r.room_id;
        if (!rid) continue;
        if (room_id && rid !== room_id) continue;
        roomDeviceCounts[rid] = Object.values(devices).filter(d => d && d.room_id === rid).length;
      }

      const availableRooms = Object.keys(roomDeviceCounts);
      if (availableRooms.length === 0) {
        return { ok: true, assigned: 0, message: 'No rooms available for assignment.' };
      }

      for (const [deviceId, device] of unassigned) {
        // Pick room with fewest devices
        availableRooms.sort((a, b) => (roomDeviceCounts[a] || 0) - (roomDeviceCounts[b] || 0));
        const targetRoom = availableRooms[0];
        const roomObj = roomList.find(r => (r.id || r.room_id) === targetRoom);
        const targetZone = (roomObj?.zones?.length > 0) ? roomObj.zones[0].toLowerCase().replace(/\s+/g, '-') : 'zone-1';
        previousAssignments[deviceId] = { room_id: device.room_id, zone: device.zone };
        device.room_id = targetRoom;
        device.zone = targetZone;
        device.assigned_at = new Date().toISOString();
        device.assigned_by = 'farm-ops-agent';
        roomDeviceCounts[targetRoom] = (roomDeviceCounts[targetRoom] || 0) + 1;
        assignments.push({ device_id: deviceId, room_id: targetRoom, zone: targetZone, device_type: device.type || device.protocol || 'unknown' });
      }

      // Save back in original wrapper format
      if (isWrapper) {
        raw.devices = devices;
        raw.lastUpdated = new Date().toISOString();
        writeJSON('device-meta.json', raw);
      } else {
        writeJSON('device-meta.json', devices);
      }
      return { ok: true, assigned: assignments.length, assignments, _undo_state: previousAssignments };
    },
    undoHandler: async (params, previousAssignments) => {
      const raw = readJSON('device-meta.json', {});
      const isWrapper = raw.devices && typeof raw.devices === 'object' && !Array.isArray(raw.devices);
      const devices = isWrapper ? raw.devices : raw;
      let undone = 0;
      for (const [deviceId, prev] of Object.entries(previousAssignments)) {
        if (devices[deviceId]) {
          devices[deviceId].room_id = prev.room_id || undefined;
          devices[deviceId].zone = prev.zone || undefined;
          delete devices[deviceId].assigned_at;
          delete devices[deviceId].assigned_by;
          undone++;
        }
      }
      if (isWrapper) { raw.lastUpdated = new Date().toISOString(); }
      writeJSON('device-meta.json', isWrapper ? raw : devices);
      return { ok: true, undone, message: `Reverted ${undone} device assignment(s)` };
    }
  },
  'register_device': {
    description: 'Register a new IoT device (sensor, light controller, fan controller, dehumidifier, etc.) into the device inventory.',
    category: 'write',
    required: ['name', 'type'],
    optional: ['room_id', 'zone', 'protocol', 'brand', 'model', 'device_id'],
    undoable: true,
    handler: async ({ name, type, room_id, zone, protocol, brand, model, device_id }) => {
      const VALID_TYPES = ['sensor', 'light_controller', 'fan_controller', 'dehumidifier', 'hvac', 'humidifier', 'irrigation', 'camera', 'hub', 'relay', 'meter', 'other'];
      const normType = String(type || '').toLowerCase().replace(/[\s-]+/g, '_');
      if (!VALID_TYPES.includes(normType)) {
        return { ok: false, error: `Invalid device type "${type}". Valid types: ${VALID_TYPES.join(', ')}` };
      }
      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return { ok: false, error: 'Device name is required' };
      }

      const raw = readJSON('device-meta.json', { devices: {}, lastUpdated: null, version: '1.0.0' });
      const isWrapper = raw.devices && typeof raw.devices === 'object' && !Array.isArray(raw.devices);
      const devices = isWrapper ? raw.devices : (() => { const { version, lastUpdated, farmId, ...rest } = raw; return rest; })();

      // Generate device ID if not provided
      const id = device_id || `dev-${normType}-${crypto.randomBytes(4).toString('hex')}`;

      // Check for duplicate
      if (devices[id]) {
        return { ok: false, error: `Device "${id}" already exists` };
      }

      // Validate room_id if provided
      if (room_id) {
        const rooms = readJSON('rooms.json', {});
        const roomList = rooms.rooms || Object.values(rooms).filter(r => r != null && typeof r === 'object');
        const validRoom = roomList.find(r => (r.id || r.room_id) === room_id);
        if (!validRoom) {
          return { ok: false, error: `Room "${room_id}" not found. Available rooms: ${roomList.map(r => r.id || r.room_id).join(', ')}` };
        }
        // Validate zone if provided
        if (zone && validRoom.zones && validRoom.zones.length > 0) {
          const normZone = zone.toLowerCase().replace(/\s+/g, '-');
          const validZones = validRoom.zones.map(z => z.toLowerCase().replace(/\s+/g, '-'));
          if (!validZones.includes(normZone)) {
            return { ok: false, error: `Zone "${zone}" not found in room "${room_id}". Available zones: ${validRoom.zones.join(', ')}` };
          }
        }
      }

      const device = {
        name: name.trim(),
        type: normType,
        protocol: protocol || 'manual',
        brand: brand || '',
        model: model || '',
        room_id: room_id || null,
        zone: zone ? zone.toLowerCase().replace(/\s+/g, '-') : null,
        status: 'online',
        registered_at: new Date().toISOString(),
        registered_by: 'farm-ops-agent'
      };
      if (room_id) {
        device.assigned_at = new Date().toISOString();
        device.assigned_by = 'farm-ops-agent';
      }

      devices[id] = device;

      if (isWrapper) {
        raw.devices = devices;
        raw.lastUpdated = new Date().toISOString();
        writeJSON('device-meta.json', raw);
      } else {
        writeJSON('device-meta.json', { devices, lastUpdated: new Date().toISOString(), version: '1.0.0' });
      }

      // Update room category count if type matches a hardware category
      if (room_id) {
        try {
          const rooms = readJSON('rooms.json', {});
          const roomList = rooms.rooms || [];
          const room = roomList.find(r => (r.id || r.room_id) === room_id);
          if (room?.category && room.category[normType] !== undefined) {
            room.category[normType].count = (room.category[normType].count || 0) + 1;
            writeJSON('rooms.json', rooms);
          }
        } catch { /* non-fatal */ }
      }

      return {
        ok: true,
        device_id: id,
        device,
        message: `Registered ${normType} "${name}"${room_id ? ` in room ${room_id}${zone ? ` ${zone}` : ''}` : ' (unassigned)'}`,
        _undo_state: { device_id: id, room_id, type: normType }
      };
    },
    undoHandler: async (params, state) => {
      const raw = readJSON('device-meta.json', { devices: {} });
      const isWrapper = raw.devices && typeof raw.devices === 'object' && !Array.isArray(raw.devices);
      const devices = isWrapper ? raw.devices : raw;
      const id = state?.device_id || params?.device_id;
      if (id && devices[id]) {
        delete devices[id];
        if (isWrapper) raw.lastUpdated = new Date().toISOString();
        writeJSON('device-meta.json', isWrapper ? raw : devices);

        // Decrement room category count
        if (state?.room_id && state?.type) {
          try {
            const rooms = readJSON('rooms.json', {});
            const roomList = rooms.rooms || [];
            const room = roomList.find(r => (r.id || r.room_id) === state.room_id);
            if (room?.category?.[state.type]) {
              room.category[state.type].count = Math.max(0, (room.category[state.type].count || 1) - 1);
              writeJSON('rooms.json', rooms);
            }
          } catch { /* non-fatal */ }
        }
        return { ok: true, undone: true, message: `Removed device ${id}` };
      }
      return { ok: false, error: `Device ${id} not found for undo` };
    }
  },
  'scan_devices': {
    description: 'Unified device discovery scan. Supports wireless (SwitchBot, Light Engine, LEAM BLE/network), wired (bus channel scan), or all modes. Returns a normalized discovery result with asset_kind, source, registration_state, and a discovery_session_id for follow-up actions.',
    category: 'read',
    required: [],
    optional: ['protocol', 'mode', 'bus_type'],
    handler: async (params) => {
      const { protocol, mode, bus_type } = params;
      const scanMode = mode || 'wireless'; // wireless | wired | all
      const farmId = params.farm_id || process.env.FARM_ID;
      const sessionId = 'ds-' + crypto.randomBytes(6).toString('hex');
      const discovered = [];

      // 1. Check Light Engine edge proxy
      const edgeUrl = process.env.FARM_EDGE_URL || process.env.LE_API_URL || process.env.LIGHT_ENGINE_URL || process.env.EDGE_URL;
      console.log('[scan_devices] Edge URL:', edgeUrl ? edgeUrl : '(none)');
      if (edgeUrl) {
        try {
          const resp = await fetch(`${edgeUrl}/discovery/scan`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ protocol: protocol || 'all' }),
            signal: AbortSignal.timeout(8000)
          });
          if (resp.ok) {
            const data = await resp.json();
            const edgeDevices = Array.isArray(data.devices) ? data.devices : [];
            console.log('[scan_devices] LE edge returned', edgeDevices.length, 'device(s)');
            discovered.push(...edgeDevices.map(d => ({
              name: d.name || d.deviceName || 'Unknown Device',
              device_id: d.deviceId || d.id || null,
              type: inferDeviceType(d.deviceType || d.type || ''),
              device_type_raw: d.deviceType || d.type || 'unknown',
              protocol: d.protocol || 'light-engine',
              brand: d.brand || '',
              source: 'light-engine'
            })));
          }
        } catch (err) {
          console.warn('[scan_devices] LE edge scan failed:', err.message);
        }
      }

      // 1b. LEAM companion agent scan (BLE + network discovery)
      if (scanMode !== 'wired') {
        try {
          const leamStatus = leamBridge.getClientStatus(farmId);
          if (leamStatus.connected) {
            const leamResult = await leamBridge.sendCommand(farmId, 'scan_all', {
              duration: 12000
            });
            if (leamResult.ok && leamResult.data) {
              const leamDevices = Array.isArray(leamResult.data.devices) ? leamResult.data.devices : [];
              for (const d of leamDevices) {
                const devId = d.deviceId || d.id || d.mac || null;
                // Avoid duplicates from other sources
                if (devId && discovered.some(x => x.device_id === devId)) continue;
                discovered.push({
                  name: d.name || d.deviceName || 'Unknown Device',
                  device_id: devId,
                  type: inferDeviceType(d.deviceType || d.type || ''),
                  device_type_raw: d.deviceType || d.type || 'unknown',
                  protocol: d.protocol || 'ble',
                  brand: d.brand || '',
                  source: 'leam'
                });
              }
            }
          }
        } catch (err) {
          // LEAM scan failed or not connected -- continue with other sources
        }
      }

      // 2. SwitchBot cloud API scan using stored credentials
      if (!protocol || protocol === 'all' || protocol === 'switchbot') {
        try {
          let sbCreds = null;
          // Try farmStore (DB)
          try {
            const fid = process.env.FARM_ID || 'default';
            const dbCreds = await farmStore.get(fid, 'switchbot_credentials');
            if (dbCreds?.token && dbCreds?.secret) sbCreds = dbCreds;
          } catch { /* ok */ }
          // Fall back to farm.json
          if (!sbCreds) {
            try {
              const farmJson = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'farm.json'), 'utf8'));
              const sb = farmJson?.integrations?.switchbot;
              if (sb?.token && sb?.secret) sbCreds = sb;
            } catch { /* ok */ }
          }
          if (sbCreds) {
            const t = Date.now().toString();
            const nonce = crypto.randomBytes(16).toString('hex');
            const strToSign = sbCreds.token + t + nonce;
            const { createHmac } = await import('crypto');
            const sign = createHmac('sha256', sbCreds.secret).update(strToSign, 'utf8').digest('base64');
            const sbResp = await fetch('https://api.switch-bot.com/v1.1/devices', {
              headers: { 'Authorization': sbCreds.token, 't': t, 'sign': sign, 'nonce': nonce, 'Content-Type': 'application/json' },
              signal: AbortSignal.timeout(10000)
            });
            const sbBody = await sbResp.json().catch(() => ({}));
            if (sbResp.ok && sbBody.statusCode === 100) {
              const deviceList = sbBody.body?.deviceList || [];
              const infraredList = sbBody.body?.infraredRemoteList || [];
              for (const d of [...deviceList, ...infraredList]) {
                discovered.push({
                  name: d.deviceName || d.remoteType || `SwitchBot ${d.deviceType}`,
                  device_id: d.deviceId,
                  type: inferDeviceType(d.deviceType || d.remoteType || ''),
                  device_type_raw: d.deviceType || d.remoteType || 'unknown',
                  protocol: 'switchbot',
                  brand: 'SwitchBot',
                  source: 'switchbot-cloud'
                });
              }
            }
          }
        } catch (sbErr) { console.warn('[scan_devices] SwitchBot cloud scan failed:', sbErr.message); }
      }

      // 3. Check what's already registered to avoid duplicates
      const raw = readJSON('device-meta.json', { devices: {} });
      const existingDevices = raw.devices || {};
      const existingIds = new Set(Object.keys(existingDevices));
      const existingNames = new Set(Object.values(existingDevices).map(d => (d.name || '').toLowerCase()));

      // Also check DB-stored devices via farmStore
      try {
        const dbDevices = await farmStore.get(farmId, 'devices');
        if (Array.isArray(dbDevices)) {
          for (const d of dbDevices) {
            if (d.device_code) existingIds.add(d.device_code);
            if (d.name) existingNames.add(d.name.toLowerCase());
          }
        }
      } catch { /* non-fatal */ }

      const newDevices = discovered.filter(d => {
        if (d.device_id && existingIds.has(d.device_id)) return false;
        if (existingNames.has((d.name || '').toLowerCase())) return false;
        return true;
      });

      // 4. Wired bus channel scan (if mode is 'wired' or 'all')
      const wiredChannels = [];
      if (scanMode === 'wired' || scanMode === 'all') {
        try {
          const farmUrl = process.env.FARM_API_URL || process.env.LE_API_URL;
          if (farmUrl) {
            const busResp = await fetch(`${farmUrl}/api/devices/scan-bus`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ bus_type: bus_type || 'all', timeout_ms: 5000 }),
              signal: AbortSignal.timeout(8000)
            });
            if (busResp.ok) {
              const busData = await busResp.json();
              const channels = busData.channels || busData.devices || [];
              for (const ch of channels) {
                wiredChannels.push({
                  asset_kind: 'wired_channel',
                  source: 'bus-scan',
                  discovered_id: ch.address || ch.channel_id || ch.id,
                  display_name: ch.name || ch.label || `${(ch.bus_type || 'unknown').toUpperCase()} @ ${ch.address || ch.id}`,
                  protocol: ch.bus_type || ch.protocol || 'wired',
                  bus_id: ch.bus_id || null,
                  node_id: ch.node_id || null,
                  channel_id: ch.channel_id || ch.address || ch.id,
                  registration_state: 'new',
                  recommended_next_action: 'save_bus_mapping'
                });
              }
            }
          }
        } catch { /* bus scan failed -- non-fatal */ }

        // Check which wired channels are already mapped
        if (wiredChannels.length > 0) {
          try {
            const mapped = await dbQuery(
              'SELECT device_id, metadata FROM devices WHERE farm_id = $1 AND metadata IS NOT NULL',
              [farmId]
            );
            const mappedAddresses = new Set();
            for (const row of mapped.rows) {
              try {
                const meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
                if (meta?.bus_address) mappedAddresses.add(meta.bus_address);
                if (meta?.bus_mapping?.bus_address) mappedAddresses.add(meta.bus_mapping.bus_address);
              } catch { /* skip */ }
            }
            for (const ch of wiredChannels) {
              if (mappedAddresses.has(ch.discovered_id) || mappedAddresses.has(ch.channel_id)) {
                ch.registration_state = 'mapped';
                ch.recommended_next_action = null;
              }
            }
          } catch { /* non-fatal */ }
        }
      }

      // 5. Normalize wireless devices into unified schema
      const unifiedWireless = discovered.map(d => ({
        asset_kind: 'wireless_device',
        source: d.source || 'unknown',
        discovered_id: d.device_id || null,
        display_name: d.name || 'Unknown Device',
        protocol: d.protocol || 'unknown',
        bus_id: null,
        node_id: null,
        channel_id: null,
        registration_state: (d.device_id && existingIds.has(d.device_id)) || existingNames.has((d.name || '').toLowerCase()) ? 'registered' : 'new',
        recommended_next_action: (d.device_id && existingIds.has(d.device_id)) || existingNames.has((d.name || '').toLowerCase()) ? null : 'register_device',
        device_type: d.type || null,
        brand: d.brand || null
      }));

      // 6. Build unified response
      const allAssets = [...unifiedWireless, ...wiredChannels];
      const newAssets = allAssets.filter(a => a.registration_state === 'new');
      const registeredAssets = allAssets.filter(a => a.registration_state !== 'new');

      return {
        ok: true,
        discovery_session_id: sessionId,
        mode: scanMode,
        total_discovered: allAssets.length,
        new_assets: newAssets.length,
        registered_assets: registeredAssets.length,
        assets: allAssets,
        // Legacy fields for backward compat
        new_devices: newDevices.length,
        devices: newDevices,
        all_discovered: discovered,
        wired_channels: wiredChannels,
        summary: {
          wireless_new: unifiedWireless.filter(a => a.registration_state === 'new').length,
          wireless_registered: unifiedWireless.filter(a => a.registration_state === 'registered').length,
          wired_unmapped: wiredChannels.filter(a => a.registration_state === 'new').length,
          wired_mapped: wiredChannels.filter(a => a.registration_state === 'mapped').length
        },
        note: newAssets.length > 0
          ? `Found ${newAssets.length} new asset(s). Use register_device for wireless devices or save_bus_mapping for wired channels.`
          : allAssets.length > 0
            ? 'All discovered assets are already registered or mapped.'
            : 'No devices found. Check that devices are powered on and connected.'
      };
    }
  },

  // --- Environment Control Tools ---
  'update_target_ranges': {
    description: 'Update environmental target ranges for a zone (temperature min/max, humidity min/max, CO2 min/max, VPD min/max)',
    category: 'write',
    required: ['zone_id'],
    optional: ['temp_min', 'temp_max', 'rh_min', 'rh_max', 'co2_min', 'co2_max', 'vpd_min', 'vpd_max'],
    undoable: true,
    handler: async (params) => {
      const targetRanges = readJSON('target-ranges.json', { zones: {}, defaults: {} });
      const zones = targetRanges.zones || {};
      const zoneId = params.zone_id.toLowerCase().replace(/\s+/g, '-');
      const previous = zones[zoneId] ? { ...zones[zoneId] } : null;

      if (!zones[zoneId]) {
        zones[zoneId] = { ...targetRanges.defaults, name: params.zone_id };
      }

      const numFields = ['temp_min', 'temp_max', 'rh_min', 'rh_max', 'co2_min', 'co2_max', 'vpd_min', 'vpd_max'];
      const changes = {};
      for (const f of numFields) {
        if (params[f] != null) {
          const val = parseFloat(params[f]);
          if (isNaN(val)) return { ok: false, error: `Invalid value for ${f}: ${params[f]}` };
          changes[f] = { from: zones[zoneId][f], to: val };
          zones[zoneId][f] = val;
        }
      }
      if (Object.keys(changes).length === 0) return { ok: false, error: 'No target fields provided' };

      // Validate min < max
      if (zones[zoneId].temp_min >= zones[zoneId].temp_max) return { ok: false, error: 'temp_min must be less than temp_max' };
      if (zones[zoneId].rh_min >= zones[zoneId].rh_max) return { ok: false, error: 'rh_min must be less than rh_max' };

      targetRanges.zones = zones;
      targetRanges.metadata = targetRanges.metadata || {};
      targetRanges.metadata.last_updated = new Date().toISOString();
      writeJSON('target-ranges.json', targetRanges);

      return { ok: true, zone_id: zoneId, changes, _undo_state: { zone_id: zoneId, previous } };
    },
    undoHandler: async (params, prevState) => {
      const targetRanges = readJSON('target-ranges.json', { zones: {} });
      if (prevState.previous) {
        targetRanges.zones[prevState.zone_id] = prevState.previous;
      } else {
        delete targetRanges.zones[prevState.zone_id];
      }
      targetRanges.metadata = targetRanges.metadata || {};
      targetRanges.metadata.last_updated = new Date().toISOString();
      writeJSON('target-ranges.json', targetRanges);
      return { ok: true, message: `Target ranges reverted for ${prevState.zone_id}` };
    }
  },
  'get_environment_readings': {
    description: 'Get current real-time environment readings from all sensors — temperature, humidity, battery levels per zone',
    category: 'read',
    required: [],
    optional: ['zone_id'],
    handler: async ({ zone_id }) => {
      const envCache = readJSON('env-cache.json', {});
      const targetRanges = readJSON('target-ranges.json', {});
      const zt = targetRanges.zones || {};
      const dt = targetRanges.defaults || {};

      // Collect all rooms/zones
      const readings = [];
      for (const [key, data] of Object.entries(envCache)) {
        if (key === 'meta') continue;
        if (data.zones) {
          for (const [zid, zdata] of Object.entries(data.zones)) {
            if (zone_id && zid !== zone_id) continue;
            const targets = zt[zid] || dt;
            readings.push({
              room_id: key,
              zone_id: zid,
              temperature: zdata.temperature,
              humidity: zdata.humidity,
              battery: zdata.avg_battery,
              sensor_count: zdata.sensor_count,
              sensors: zdata.sensors,
              targets: { temp_min: targets.temp_min, temp_max: targets.temp_max, rh_min: targets.rh_min, rh_max: targets.rh_max },
              temp_status: zdata.temperature >= targets.temp_min && zdata.temperature <= targets.temp_max ? 'ok' : zdata.temperature < targets.temp_min ? 'low' : 'high',
              humidity_status: zdata.humidity >= targets.rh_min && zdata.humidity <= targets.rh_max ? 'ok' : zdata.humidity < targets.rh_min ? 'low' : 'high'
            });
          }
        }
      }
      return { ok: true, readings, count: readings.length, updated_at: envCache.meta?.updatedAt || null };
    }
  },
  'set_light_schedule': {
    description: 'Set or update the light schedule for a zone — on/off times, PPFD, photoperiod hours',
    category: 'write',
    required: ['zone_id', 'on_time', 'off_time'],
    optional: ['ppfd', 'photoperiod_hours'],
    undoable: true,
    handler: async (params) => {
      const schedules = readJSON('schedules.json', { schedules: [] });
      const zoneId = params.zone_id.toLowerCase().replace(/\s+/g, '-');
      const list = schedules.schedules || [];
      const existing = list.find(s => s.zone_id === zoneId && s.type === 'light');
      const previous = existing ? { ...existing } : null;

      // Validate time format HH:MM
      const timeRe = /^\d{1,2}:\d{2}$/;
      if (!timeRe.test(params.on_time) || !timeRe.test(params.off_time)) {
        return { ok: false, error: 'Times must be HH:MM format (e.g. "06:00", "22:00")' };
      }

      const entry = {
        id: existing?.id || crypto.randomUUID(),
        zone_id: zoneId,
        type: 'light',
        on_time: params.on_time,
        off_time: params.off_time,
        ppfd: params.ppfd ? parseInt(params.ppfd) : (existing?.ppfd || null),
        photoperiod_hours: params.photoperiod_hours ? parseFloat(params.photoperiod_hours) : null,
        updated_at: new Date().toISOString(),
        updated_by: 'farm-ops-agent'
      };

      if (existing) Object.assign(existing, entry);
      else list.push(entry);

      schedules.schedules = list;
      writeJSON('schedules.json', schedules);

      return { ok: true, schedule: entry, was_update: !!previous, _undo_state: { zone_id: zoneId, previous } };
    },
    undoHandler: async (params, prevState) => {
      const schedules = readJSON('schedules.json', { schedules: [] });
      const list = schedules.schedules || [];
      if (prevState.previous) {
        const idx = list.findIndex(s => s.zone_id === prevState.zone_id && s.type === 'light');
        if (idx >= 0) list[idx] = prevState.previous;
      } else {
        schedules.schedules = list.filter(s => !(s.zone_id === prevState.zone_id && s.type === 'light'));
      }
      writeJSON('schedules.json', schedules);
      return { ok: true, message: `Light schedule reverted for ${prevState.zone_id}` };
    }
  },
  'seed_benchmarks': {
    description: 'Seed crop benchmarks from the crop registry into benchmark config',
    category: 'write',
    required: [],
    optional: ['crops'],
    undoable: true,
    handler: async (params) => {
      const registry = readJSON('crop-registry.json', {});
      const crops = registry.crops || registry;
      const benchmarkPath = path.join(DATA_DIR, 'crop-benchmarks.json');
      const existing = readJSON('crop-benchmarks.json', { benchmarks: {}, seeded_at: null });
      const previousState = JSON.parse(JSON.stringify(existing));

      const filterCrops = params.crops ? params.crops.split(',').map(c => c.trim().toLowerCase()) : null;
      let seeded = 0;
      for (const [name, info] of Object.entries(crops)) {
        if (filterCrops && !filterCrops.some(f => name.toLowerCase().includes(f))) continue;
        const growth = info.growth || {};
        existing.benchmarks[name] = {
          days_to_harvest: growth.daysToHarvest || growth.cycle_days || 28,
          yield_factor: growth.yieldFactor || 0.85,
          harvest_strategy: growth.harvestStrategy || 'single',
          max_harvests: growth.maxHarvests || 1,
          regrowth_days: growth.regrowthDays || null,
          retail_price_per_lb: growth.retailPricePerLb || null,
          category: info.category || 'unknown',
          source: 'crop-registry',
          seeded_at: new Date().toISOString()
        };
        seeded++;
      }
      existing.seeded_at = new Date().toISOString();
      existing.crop_count = Object.keys(existing.benchmarks).length;
      writeJSON('crop-benchmarks.json', existing);

      return {
        ok: true,
        seeded,
        total_benchmarks: existing.crop_count,
        _undo_state: previousState
      };
    }
  },

  // --- Phase 2B: New Write Tools ---
  'update_crop_price': {
    description: 'Update retail or wholesale price for a crop (prices are per unit shown in the crop record, typically per lb)',
    category: 'write',
    required: ['crop'],
    optional: ['retail_price', 'wholesale_price', 'farm_id'],
    undoable: true,
    handler: async (params) => {
      const farm_id = params.farm_id;
      if (!farm_id) return { ok: false, error: 'farm_id is required' };
      const resolvedName = resolveCropName(params.crop);
      const data = await farmStore.get(farm_id, 'crop_pricing') || { crops: [] };
      const crops = Array.isArray(data) ? data : (data.crops || []);
      const cropIdx = crops.findIndex(c => {
        const cName = (c.crop || '').toLowerCase();
        const target = resolvedName.toLowerCase();
        const raw = params.crop.toLowerCase();
        return cName === target || cName === raw || cName.includes(raw);
      });
      let previous;
      if (cropIdx === -1) {
        // Auto-add crop from registry data when not found in pricing
        const registry = readJSON('crop-registry.json', {});
        const regCrops = registry.crops || registry;
        const regData = regCrops[resolvedName] || {};
        const g = regData.growth || {};
        const p = regData.pricing || {};
        const retailPerLb = g.retailPricePerLb || (p.retailPerOz ? p.retailPerOz * 16 : 0);
        crops.push({
          crop: resolvedName,
          unit: 'lb',
          retailPrice: retailPerLb,
          wholesalePrice: parseFloat((retailPerLb * 0.70).toFixed(2)),
          ws1Discount: p.wholesaleDiscounts?.tier1 || 15,
          ws2Discount: p.wholesaleDiscounts?.tier2 || 25,
          ws3Discount: p.wholesaleDiscounts?.tier3 || 35,
          currency: p.currency || 'CAD',
          pricingSource: 'auto-added'
        });
        previous = {};
      } else {
        previous = { ...crops[cropIdx] };
      }
      const idx = cropIdx === -1 ? crops.length - 1 : cropIdx;
      if (params.retail_price != null) {
        crops[idx].retailPrice = parseFloat(params.retail_price);
        // Auto-fill wholesale from retail if wholesale not explicitly provided
        if (params.wholesale_price == null) {
          crops[idx].wholesalePrice = parseFloat((crops[idx].retailPrice * 0.70).toFixed(2));
        }
      }
      if (params.wholesale_price != null) crops[idx].wholesalePrice = parseFloat(params.wholesale_price);
      // Save back in the original wrapper format
      if (Array.isArray(data)) {
        await farmStore.set(farm_id, 'crop_pricing', crops);
      } else {
        data.crops = crops;
        data.lastUpdated = new Date().toISOString();
        await farmStore.set(farm_id, 'crop_pricing', data);
      }
      if (isDatabaseAvailable()) {
        try {
          await dbQuery(
            'INSERT INTO pricing_decisions (farm_id, crop, previous_price, applied_price, decision, created_at) VALUES ($1, $2, $3, $4, $5, NOW())',
            [farm_id, resolvedName, previous.retailPrice || 0, crops[idx].retailPrice || 0, 'assistant-chat']
          );
        } catch { /* ok */ }
      }
      return {
        ok: true, crop: resolvedName, unit: crops[idx].unit || 'lb',
        previous: { retail: previous.retailPrice || 0, wholesale: previous.wholesalePrice || 0 },
        updated: { retail: crops[idx].retailPrice, wholesale: crops[idx].wholesalePrice },
        _undo_state: { farm_id, previous, cropIdx: idx }
      };
    },
    undoHandler: async ({ crop }, prevState) => {
      const data = await farmStore.get(prevState.farm_id, 'crop_pricing') || { crops: [] };
      const crops = Array.isArray(data) ? data : (data.crops || []);
      if (crops[prevState.cropIdx]) {
        Object.assign(crops[prevState.cropIdx], prevState.previous);
        if (Array.isArray(data)) {
          await farmStore.set(prevState.farm_id, 'crop_pricing', crops);
        } else {
          data.crops = crops;
          await farmStore.set(prevState.farm_id, 'crop_pricing', data);
        }
      }
      return { ok: true, message: `Price reverted for ${crop}` };
    }
  },
  'create_planting_assignment': {
    description: 'Schedule a new planting assignment for a crop in a group/zone',
    category: 'write',
    required: ['crop_name', 'group_id'],
    optional: ['farm_id', 'tray_id', 'crop_id', 'seed_date', 'harvest_date', 'notes'],
    undoable: true,
    handler: async (params) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
      const farm_id = params.farm_id;
      if (!farm_id) return { ok: false, error: 'farm_id is required' };
      const seed_date = params.seed_date || new Date().toISOString().split('T')[0];
      const canonicalCrop = resolveCropName(params.crop_name);
      const growDays = cropUtils.getCropGrowDays(canonicalCrop);
      // Calculate harvest_date from seed_date (not today) so future-dated plantings get correct harvest
      const harvest_date = params.harvest_date || (growDays
        ? new Date(new Date(seed_date + 'T00:00:00').getTime() + growDays * 86400000).toISOString().split('T')[0]
        : null);

      // Auto-resolve crop_id from registry (DB column is NOT NULL)
      let crop_id = params.crop_id;
      if (!crop_id) {
        const registry = readJSON('crop-registry.json', {});
        const crops = registry.crops || {};
        const entry = crops[canonicalCrop];
        crop_id = entry?.planId || `crop-${canonicalCrop.toLowerCase().replace(/\s+/g, '-')}`;
      }

      // Smart group_id resolution: if user passes a zone name like "Zone 1",
      // find the first available group in that zone
      let resolvedGroupId = params.group_id;
      const groups = await farmStore.get(farm_id, 'groups') || [];
      const groupExists = groups.some(g => (g.id || g.group_id) === resolvedGroupId);

      if (!groupExists) {
        // Try to match by zone name — find first group in that zone
        const zoneMatch = groups.find(g =>
          g.zone && (g.zone.toLowerCase() === resolvedGroupId.toLowerCase() ||
                     resolvedGroupId.toLowerCase().includes(g.zone.toLowerCase()))
        );
        if (zoneMatch) {
          // Find first unoccupied group in this zone
          let occupiedGroups = new Set();
          try {
            const occupied = await dbQuery(
              "SELECT group_id FROM planting_assignments WHERE farm_id = $1 AND status = 'active'",
              [farm_id]
            );
            occupiedGroups = new Set(occupied.rows.map(r => r.group_id));
          } catch { /* ok */ }
          const sameZone = groups.filter(g => g.zone === zoneMatch.zone);
          const freeGroup = sameZone.find(g => !occupiedGroups.has(g.id || g.group_id));
          resolvedGroupId = freeGroup ? (freeGroup.id || freeGroup.group_id) : (zoneMatch.id || zoneMatch.group_id);
        } else {
          const validZones = [...new Set(groups.map(g => g.zone).filter(Boolean))];
          return { ok: false, error: `Group/zone "${params.group_id}" not found. Valid zones: ${validZones.join(', ')}. Use a zone name like "Zone 1" and the system will auto-assign an available group.` };
        }
      }

      try {
        const result = await dbQuery(
          `INSERT INTO planting_assignments (farm_id, group_id, tray_id, crop_id, crop_name, seed_date, harvest_date, status, notes, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', $8, NOW())
           ON CONFLICT (farm_id, group_id) DO UPDATE SET crop_name=$5, seed_date=$6, harvest_date=$7, notes=$8, status='active', updated_at=NOW()
           RETURNING *`,
          [farm_id, resolvedGroupId, params.tray_id || null, crop_id,
           canonicalCrop, seed_date, harvest_date, params.notes || null]
        );
        return { ok: true, assignment: result.rows[0], resolved_name: canonicalCrop, resolved_group: resolvedGroupId, _undo_state: { farm_id, group_id: resolvedGroupId } };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },
    undoHandler: async (params, prevState) => {
      try {
        await dbQuery('DELETE FROM planting_assignments WHERE farm_id = $1 AND group_id = $2', [prevState.farm_id, prevState.group_id]);
        return { ok: true, message: 'Planting assignment removed' };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }
  },
  'mark_harvest_complete': {
    description: 'Record a completed harvest with crop, quantity, zone, and yield data',
    category: 'write',
    required: ['crop', 'quantity'],
    optional: ['zone', 'unit', 'yield_lbs', 'notes'],
    undoable: false,
    handler: async (params) => {
      let harvests = readJSON('harvest-log.json', []);
      harvests = Array.isArray(harvests) ? harvests : (harvests.harvests || harvests.records || []);
      const entry = {
        id: crypto.randomUUID(),
        crop: params.crop,
        quantity: parseInt(params.quantity),
        unit: params.unit || 'trays',
        zone: params.zone || null,
        yield_lbs: params.yield_lbs ? parseFloat(params.yield_lbs) : null,
        notes: params.notes || null,
        harvested_at: new Date().toISOString(),
        recorded_by: 'assistant-chat'
      };
      harvests.push(entry);
      writeJSON('harvest-log.json', harvests);

      // Auto-add to inventory (harvest → inventory pipeline)
      let inventoryUpdated = false;
      try {
        const farm_id = params.farm_id || null;
        let inventory = await farmStore.get(farm_id, 'inventory') || [];
        if (!Array.isArray(inventory)) inventory = Object.values(inventory);
        const existing = inventory.find(i => (i.crop || i.name || '').toLowerCase() === params.crop.toLowerCase());
        if (existing) {
          existing.quantity = (existing.quantity || 0) + parseInt(params.quantity);
          existing.updated_at = new Date().toISOString();
          existing.last_harvest = entry.harvested_at;
        } else {
          inventory.push({
            id: crypto.randomUUID(),
            crop: params.crop,
            name: params.crop,
            quantity: parseInt(params.quantity),
            unit: params.unit || 'trays',
            zone: params.zone || null,
            status: 'available',
            added_at: new Date().toISOString(),
            added_by: 'harvest-pipeline',
            last_harvest: entry.harvested_at
          });
        }
        await farmStore.set(farm_id, 'inventory', inventory);
        inventoryUpdated = true;
      } catch { /* non-fatal: harvest is still logged */ }

      return { ok: true, harvest: entry, inventory_updated: inventoryUpdated };
    }
  },
  'update_order_status': {
    description: 'Update a wholesale order status (confirmed, packed, shipped, delivered)',
    category: 'write',
    required: ['order_id', 'status'],
    optional: [],
    undoable: true,
    handler: async (params) => {
      let ordersData = readJSON('wholesale-orders-status.json', []);
      let orders = Array.isArray(ordersData) ? ordersData : (ordersData.orders || []);
      const order = orders.find(o => (o.order_id || o.id) === params.order_id);
      if (!order) return { ok: false, error: `Order ${params.order_id} not found` };
      const validStatuses = ['pending', 'confirmed', 'packed', 'shipped', 'delivered', 'cancelled'];
      if (!validStatuses.includes(params.status.toLowerCase())) {
        return { ok: false, error: `Invalid status. Valid: ${validStatuses.join(', ')}` };
      }
      const previousStatus = order.status;
      order.status = params.status.toLowerCase();
      order.updated_at = new Date().toISOString();
      if (Array.isArray(ordersData)) writeJSON('wholesale-orders-status.json', ordersData);
      else { ordersData.orders = orders; writeJSON('wholesale-orders-status.json', ordersData); }
      return { ok: true, order_id: params.order_id, previousStatus, newStatus: order.status, buyer: order.buyer_name || order.buyer, _undo_state: { order_id: params.order_id, previousStatus } };
    },
    undoHandler: async (params, prevState) => {
      let ordersData = readJSON('wholesale-orders-status.json', []);
      let orders = Array.isArray(ordersData) ? ordersData : (ordersData.orders || []);
      const order = orders.find(o => (o.order_id || o.id) === prevState.order_id);
      if (!order) return { ok: false, error: 'Order not found for undo' };
      order.status = prevState.previousStatus;
      order.updated_at = new Date().toISOString();
      if (Array.isArray(ordersData)) writeJSON('wholesale-orders-status.json', ordersData);
      else { ordersData.orders = orders; writeJSON('wholesale-orders-status.json', ordersData); }
      return { ok: true, message: `Order reverted to ${prevState.previousStatus}` };
    }
  },
  'add_inventory_item': {
    description: 'Add or update a crop in the farm inventory',
    category: 'write',
    required: ['crop_name', 'quantity'],
    optional: ['farm_id', 'unit', 'status', 'zone'],
    undoable: true,
    handler: async (params) => {
      const farm_id = params.farm_id;
      if (!farm_id) return { ok: false, error: 'farm_id is required' };
      let inventory = await farmStore.get(farm_id, 'inventory') || [];
      if (!Array.isArray(inventory)) inventory = Object.values(inventory);
      const existing = inventory.find(i => (i.crop || i.name || '').toLowerCase() === params.crop_name.toLowerCase());
      let previousState = null;
      if (existing) {
        previousState = { ...existing };
        existing.quantity = (existing.quantity || 0) + parseInt(params.quantity);
        existing.unit = params.unit || existing.unit || 'units';
        existing.updated_at = new Date().toISOString();
        if (params.status) existing.status = params.status;
      } else {
        inventory.push({
          id: crypto.randomUUID(),
          crop: params.crop_name,
          name: params.crop_name,
          quantity: parseInt(params.quantity),
          unit: params.unit || 'units',
          zone: params.zone || null,
          status: params.status || 'available',
          added_at: new Date().toISOString(),
          added_by: 'assistant-chat'
        });
      }
      await farmStore.set(farm_id, 'inventory', inventory);
      return {
        ok: true, crop: params.crop_name,
        quantity: existing?.quantity || parseInt(params.quantity),
        isUpdate: !!previousState,
        _undo_state: { farm_id, previousState, crop_name: params.crop_name }
      };
    },
    undoHandler: async (params, prevState) => {
      let inventory = await farmStore.get(prevState.farm_id, 'inventory') || [];
      if (!Array.isArray(inventory)) inventory = Object.values(inventory);
      if (prevState.previousState) {
        const item = inventory.find(i => (i.crop || i.name || '').toLowerCase() === prevState.crop_name.toLowerCase());
        if (item) Object.assign(item, prevState.previousState);
      } else {
        inventory = inventory.filter(i => (i.crop || i.name || '').toLowerCase() !== prevState.crop_name.toLowerCase());
      }
      await farmStore.set(prevState.farm_id, 'inventory', inventory);
      return { ok: true, message: `Inventory change reverted for ${prevState.crop_name}` };
    }
  },

  // --- Nutrient Management Tools ---
  'update_manual_inventory': {
    description: 'Update manual crop inventory weight in the farm_inventory table. Use when a grower says something like "we have 23 lbs of basil available" or "update tomato inventory to 50 lbs". Resolves crop name to product_id, converts to lbs, writes manual_quantity_lbs. WRITE operation — confirm with user first.',
    category: 'write',
    required: ['crop_name', 'quantity_lbs'],
    optional: ['farm_id', 'price', 'wholesale_price', 'retail_price', 'category', 'available_for_wholesale'],
    undoable: true,
    handler: async (params) => {
      if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
      const farm_id = params.farm_id;
      if (!farm_id) return { ok: false, error: 'farm_id is required' };
      const cropName = String(params.crop_name).trim();
      const manualQty = Math.max(0, Number(params.quantity_lbs) || 0);
      const productId = cropName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const unitPrice = Number(params.price || params.retail_price) || 0;

      // Check if product already exists
      const existing = await dbQuery(
        'SELECT product_id, manual_quantity_lbs, auto_quantity_lbs, inventory_source FROM farm_inventory WHERE farm_id = $1 AND product_id = $2',
        [farm_id, productId]
      );

      let previousState = null;
      let result;

      if (existing.rows.length) {
        // Update existing row
        previousState = { ...existing.rows[0] };
        const setClauses = [
          'manual_quantity_lbs = $2',
          'quantity_available = COALESCE(auto_quantity_lbs, 0) + $2 - COALESCE(sold_quantity_lbs, 0)',
          `inventory_source = CASE WHEN COALESCE(auto_quantity_lbs, 0) > 0 THEN 'hybrid' ELSE 'manual' END`,
          'last_updated = NOW()'
        ];
        const updateParams = [farm_id, manualQty];
        let idx = 3;
        if (unitPrice > 0) {
          setClauses.push(`retail_price = $${idx}`, `price = $${idx}`);
          updateParams.push(unitPrice); idx++;
        }
        if (params.wholesale_price) {
          setClauses.push(`wholesale_price = $${idx}`);
          updateParams.push(Number(params.wholesale_price)); idx++;
        }
        updateParams.push(productId);
        result = await dbQuery(
          `UPDATE farm_inventory SET ${setClauses.join(', ')} WHERE farm_id = $1 AND product_id = $${idx} RETURNING *`,
          updateParams
        );
      } else {
        // Insert new row
        result = await dbQuery(
          `INSERT INTO farm_inventory (
            farm_id, product_id, product_name, sku, quantity, unit, price,
            available_for_wholesale, manual_quantity_lbs, quantity_available,
            quantity_unit, wholesale_price, retail_price, inventory_source,
            category, last_updated
          ) VALUES ($1,$2,$3,$4,$5,'lb',$6,$7,$8,$9,'lb',$10,$11,'manual',$12,NOW())
          RETURNING *`,
          [
            farm_id, productId, cropName, productId, manualQty, unitPrice,
            params.available_for_wholesale !== false,
            manualQty, manualQty,
            Number(params.wholesale_price) || unitPrice,
            unitPrice,
            params.category || null
          ]
        );
      }

      const row = result.rows[0];
      return {
        ok: true,
        crop: cropName,
        manual_lbs: Number(row.manual_quantity_lbs),
        auto_lbs: Number(row.auto_quantity_lbs || 0),
        total_available_lbs: Number(row.quantity_available),
        inventory_source: row.inventory_source,
        isUpdate: !!previousState,
        _undo_state: { farm_id, productId, previousState }
      };
    },
    undoHandler: async (params, prevState) => {
      if (prevState.previousState) {
        await dbQuery(
          `UPDATE farm_inventory SET
            manual_quantity_lbs = $2,
            quantity_available = COALESCE(auto_quantity_lbs, 0) + $2 - COALESCE(sold_quantity_lbs, 0),
            inventory_source = $3,
            last_updated = NOW()
           WHERE farm_id = $1 AND product_id = $4`,
          [prevState.farm_id, prevState.previousState.manual_quantity_lbs || 0,
           prevState.previousState.inventory_source || 'auto', prevState.productId]
        );
      } else {
        await dbQuery('DELETE FROM farm_inventory WHERE farm_id = $1 AND product_id = $2',
          [prevState.farm_id, prevState.productId]);
      }
      return { ok: true, message: 'Manual inventory change reverted' };
    }
  },
  'get_nutrient_status': {
    description: 'Get current nutrient solution status — pH, EC, temperature, autodose config, tank info, recent dosing events',
    category: 'read',
    required: [],
    optional: ['tank_id'],
    handler: async ({ tank_id }) => {
      const data = readJSON('nutrient-dashboard.json', { sensors: {}, tanks: {} });
      const sensors = data.sensors || {};
      const tanks = data.tanks || {};

      if (tank_id && tanks[tank_id]) {
        const tank = tanks[tank_id];
        return {
          ok: true,
          tank_id,
          provider: tank.nutrientProvider,
          ph: tank.sensors?.ph?.current,
          ec: tank.sensors?.ec?.current,
          temperature: tank.sensors?.temperature?.current,
          autodose: tank.autodose || {},
          recent_dosing: (tank.dosing?.history || []).slice(-5),
          updated_at: data.metadata?.updatedAt
        };
      }

      // Summary of all tanks
      const summary = { ph: sensors.ph?.current, ec: sensors.ec?.current, temperature: sensors.temperature?.current };
      const tankList = [];
      for (const [tid, tank] of Object.entries(tanks)) {
        tankList.push({
          tank_id: tid,
          provider: tank.nutrientProvider,
          ph: tank.sensors?.ph?.current,
          ec: tank.sensors?.ec?.current,
          autodose_enabled: tank.autodose?.autodoseEnabled ?? false,
          ph_target: tank.autodose?.phTarget,
          ec_target: tank.autodose?.ecTarget
        });
      }
      return { ok: true, ...summary, tanks: tankList, updated_at: data.metadata?.updatedAt };
    }
  },

  'update_nutrient_targets': {
    description: 'Update nutrient solution targets — pH target, EC target, tolerances, autodose settings for a tank',
    category: 'write',
    required: ['tank_id'],
    optional: ['ph_target', 'ph_tolerance', 'ec_target', 'ec_tolerance', 'autodose_enabled'],
    undoable: true,
    handler: async (params) => {
      const data = readJSON('nutrient-dashboard.json', { sensors: {}, tanks: {} });
      const tank = data.tanks?.[params.tank_id];
      if (!tank) return { ok: false, error: `Tank "${params.tank_id}" not found. Available: ${Object.keys(data.tanks || {}).join(', ')}` };

      const previousAutodose = { ...tank.autodose };

      if (params.ph_target != null) tank.autodose.phTarget = parseFloat(params.ph_target);
      if (params.ph_tolerance != null) tank.autodose.phTolerance = parseFloat(params.ph_tolerance);
      if (params.ec_target != null) tank.autodose.ecTarget = parseInt(params.ec_target);
      if (params.ec_tolerance != null) tank.autodose.ecTolerance = parseInt(params.ec_tolerance);
      if (params.autodose_enabled != null) tank.autodose.autodoseEnabled = params.autodose_enabled === true || params.autodose_enabled === 'true';

      // Also sync top-level setpoints
      if (params.ph_target != null) tank.phSetpoint = parseFloat(params.ph_target);
      if (params.ph_tolerance != null) tank.phTolerance = parseFloat(params.ph_tolerance);
      if (params.ec_target != null) tank.ecSetpoint = parseInt(params.ec_target);
      if (params.ec_tolerance != null) tank.ecTolerance = parseInt(params.ec_tolerance);

      data.metadata = { ...data.metadata, updatedAt: new Date().toISOString() };
      writeJSON('nutrient-dashboard.json', data);

      return {
        ok: true,
        tank_id: params.tank_id,
        autodose: tank.autodose,
        _undo_state: { tank_id: params.tank_id, previousAutodose }
      };
    },
    undoHandler: async (params, prevState) => {
      const data = readJSON('nutrient-dashboard.json', { sensors: {}, tanks: {} });
      const tank = data.tanks?.[prevState.tank_id];
      if (tank) {
        tank.autodose = prevState.previousAutodose;
        tank.phSetpoint = prevState.previousAutodose.phTarget;
        tank.phTolerance = prevState.previousAutodose.phTolerance;
        tank.ecSetpoint = prevState.previousAutodose.ecTarget;
        tank.ecTolerance = prevState.previousAutodose.ecTolerance;
        data.metadata = { ...data.metadata, updatedAt: new Date().toISOString() };
        writeJSON('nutrient-dashboard.json', data);
      }
      return { ok: true, message: `Nutrient targets reverted for ${prevState.tank_id}` };
    }
  },

  'get_dosing_history': {
    description: 'Get recent autodose events — pump activations, pH/EC corrections, calibration history',
    category: 'read',
    required: [],
    optional: ['tank_id', 'limit'],
    handler: async ({ tank_id, limit }) => {
      const data = readJSON('nutrient-dashboard.json', { sensors: {}, tanks: {} });
      const maxEntries = parseInt(limit) || 20;
      const results = [];

      for (const [tid, tank] of Object.entries(data.tanks || {})) {
        if (tank_id && tid !== tank_id) continue;
        const history = (tank.dosing?.history || []).slice(-maxEntries);
        results.push({
          tank_id: tid,
          provider: tank.nutrientProvider,
          dosing_events: history,
          count: history.length,
          calibration: tank.calibration || null
        });
      }
      return { ok: true, tanks: results, updated_at: data.metadata?.updatedAt };
    }
  },

  // --- Yield Forecasting Tools ---
  'get_yield_forecast': {
    description: 'Forecast yields and revenue. Works with active plantings OR hypothetical scenarios (pass crop + tray_format for "what if" forecasting without active plantings). Supports wholesale pricing.',
    category: 'read',
    required: [],
    optional: ['farm_id', 'crop', 'tray_format', 'tray_count', 'pricing_tier'],
    handler: async (params) => {
      const farm_id = params.farm_id;
      if (!farm_id) return { ok: false, error: 'farm_id is required' };

      // Resolve tray format for plant count
      let plantsPerTray = 50;
      let trayName = 'Standard (50 sites)';
      let isWeightBased = false;
      let targetWeightPerSite = 0;
      if (params.tray_format) {
        const trayFormats = readJSON('tray-formats.json', []);
        const tray = trayFormats.find(t =>
          t.trayFormatId === params.tray_format ||
          (t.name || '').toLowerCase().includes(params.tray_format.toLowerCase()) ||
          (t.trayFormatId || '').toLowerCase().includes(params.tray_format.toLowerCase())
        );
        if (tray) {
          if (tray.isWeightBased) {
            plantsPerTray = 1;
            isWeightBased = true;
            targetWeightPerSite = tray.targetWeightPerSite || 8;
            trayName = tray.name + ' (weight-based, ' + targetWeightPerSite + ' oz target)';
          } else {
            plantsPerTray = tray.plantSiteCount || 50;
            trayName = tray.name + ' (' + plantsPerTray + ' sites)';
          }
        }
      }

      const useWholesale = params.pricing_tier === 'wholesale';

      // Get benchmarks (from DB if available, else empty)
      const benchMap = {};
      if (isDatabaseAvailable()) {
        try {
          const benchmarks = await dbQuery('SELECT * FROM crop_benchmarks');
          for (const b of benchmarks.rows) benchMap[b.crop_name?.toLowerCase()] = b;
        } catch { /* ok */ }
      }

      // Get pricing from crop-pricing.json + registry fallback
      const pricing = readJSON('crop-pricing.json', {});
      const priceMap = {};
      if (pricing.crops) {
        for (const c of pricing.crops) priceMap[c.crop?.toLowerCase()] = c;
      }
      // Registry fallback
      const registry = readJSON('crop-registry.json', {});
      const regCrops = registry.crops || registry;
      for (const [name, data] of Object.entries(regCrops)) {
        if (!priceMap[name.toLowerCase()]) {
          const g = data.growth || {};
          const p = data.pricing || {};
          const retailPerLb = g.retailPricePerLb || (p.retailPerOz ? p.retailPerOz * 16 : 0);
          if (retailPerLb > 0) {
            priceMap[name.toLowerCase()] = {
              crop: name, retailPrice: retailPerLb,
              wholesalePrice: parseFloat((retailPerLb * 0.70).toFixed(2))
            };
          }
        }
      }

      const forecasts = [];
      const now = new Date();

      // Try active plantings from DB first
      let hasPlantings = false;
      if (isDatabaseAvailable()) {
        try {
          const plantings = await dbQuery(
            'SELECT * FROM planting_assignments WHERE farm_id = $1 AND status = $2 ORDER BY expected_harvest_date ASC',
            [farm_id, 'active']
          );
          for (const p of plantings.rows) {
            if (params.crop) {
              const resolved = resolveCropName(params.crop);
              const cLower = (p.crop_name || '').toLowerCase();
              if (cLower !== resolved.toLowerCase() && !cLower.includes(params.crop.toLowerCase())) continue;
            }
            hasPlantings = true;
            const cropKey = p.crop_name?.toLowerCase();
            const bench = benchMap[cropKey] || {};
            const price = priceMap[cropKey] || {};

            const seedDate = new Date(p.seed_date);
            const harvestDate = p.expected_harvest_date ? new Date(p.expected_harvest_date) : null;
            const daysRemaining = harvestDate ? Math.max(0, Math.ceil((harvestDate - now) / (1000 * 60 * 60 * 24))) : null;
            const growDays = harvestDate ? Math.ceil((harvestDate - seedDate) / (1000 * 60 * 60 * 24)) : bench.avg_grow_days;

            const trays = params.tray_count || p.tray_count || 1;
            const avgWeightOz = bench.avg_weight_per_plant_oz || 2;
            const lossRate = bench.avg_loss_rate || 0.05;
            const estYieldLbs = isWeightBased
              ? ((targetWeightPerSite * (1 - lossRate)) / 16).toFixed(1)
              : ((trays * plantsPerTray * avgWeightOz * (1 - lossRate)) / 16).toFixed(1);

            const retailPerLb = price.retailPrice || price.price_per_lb || price.pricePerLb || 0;
            const wholesalePerLb = price.wholesalePrice || parseFloat((retailPerLb * 0.70).toFixed(2));
            const pricePerLb = useWholesale ? wholesalePerLb : retailPerLb;
            const estRevenue = (estYieldLbs * pricePerLb).toFixed(2);

            const cyclesPerYear = growDays > 0 ? Math.floor(365 / growDays) : 0;

            forecasts.push({
              crop: p.crop_name,
              zone: p.zone_id,
              seed_date: p.seed_date,
              expected_harvest: p.expected_harvest_date,
              days_remaining: daysRemaining,
              grow_days: growDays,
              tray_format: trayName,
              tray_count: trays,
              est_yield_lbs: parseFloat(estYieldLbs),
              est_revenue_cad: parseFloat(estRevenue),
              cycles_per_year: cyclesPerYear,
              annual_revenue_per_tray_cad: parseFloat((parseFloat(estRevenue) * cyclesPerYear).toFixed(2)),
              pricing_tier: useWholesale ? 'wholesale' : 'retail',
              price_per_lb: pricePerLb,
              benchmark_available: !!benchMap[cropKey]
            });
          }
        } catch { /* ok */ }
      }

      // Hypothetical forecasting: if no active plantings found for this crop, use registry data
      if (!hasPlantings && params.crop) {
        const resolved = resolveCropName(params.crop);
        const regData = regCrops[resolved] || {};
        const growth = regData.growth || {};
        const price = priceMap[resolved.toLowerCase()] || {};
        const bench = benchMap[resolved.toLowerCase()] || {};

        const growDays = bench.avg_grow_days || growth.daysToHarvest || 28;
        const lossRate = bench.avg_loss_rate || 0.05;
        const avgWeightOz = bench.avg_weight_per_plant_oz || 2;
        const trays = params.tray_count || 1;

        const estYieldLbs = isWeightBased
          ? ((targetWeightPerSite * (1 - lossRate)) / 16).toFixed(1)
          : ((trays * plantsPerTray * avgWeightOz * (1 - lossRate)) / 16).toFixed(1);

        const retailPerLb = price.retailPrice || growth.retailPricePerLb || 0;
        const wholesalePerLb = price.wholesalePrice || parseFloat((retailPerLb * 0.70).toFixed(2));
        const pricePerLb = useWholesale ? wholesalePerLb : retailPerLb;
        const estRevenue = (estYieldLbs * pricePerLb).toFixed(2);
        const cyclesPerYear = growDays > 0 ? Math.floor(365 / growDays) : 0;

        // Regrowth harvests (cut-and-come-again)
        const maxHarvests = growth.maxHarvests || 1;
        const regrowthDays = growth.regrowthDays || 0;
        const regrowthYieldFactor = growth.regrowthYieldFactor || 0.85;
        let totalAnnualYield = parseFloat(estYieldLbs) * cyclesPerYear;
        let totalAnnualRevenue = parseFloat(estRevenue) * cyclesPerYear;

        if (maxHarvests > 1 && regrowthDays > 0) {
          // Each cycle gets primary harvest + regrowth harvests
          const regrowthHarvests = maxHarvests - 1;
          const regrowthYieldPerCycle = parseFloat(estYieldLbs) * regrowthYieldFactor * regrowthHarvests;
          totalAnnualYield += regrowthYieldPerCycle * cyclesPerYear;
          totalAnnualRevenue += (regrowthYieldPerCycle * pricePerLb) * cyclesPerYear;
        }

        forecasts.push({
          crop: resolved,
          type: 'hypothetical',
          note: 'No active planting — forecast based on registry growth data and pricing',
          grow_days: growDays,
          tray_format: trayName,
          plants_per_tray: plantsPerTray,
          tray_count: trays,
          est_yield_lbs_per_harvest: parseFloat(estYieldLbs),
          est_revenue_per_harvest_cad: parseFloat(estRevenue),
          cycles_per_year: cyclesPerYear,
          max_harvests_per_cycle: maxHarvests,
          regrowth_days: regrowthDays,
          annual_yield_lbs: parseFloat(totalAnnualYield.toFixed(1)),
          annual_revenue_per_tray_cad: parseFloat(totalAnnualRevenue.toFixed(2)),
          pricing_tier: useWholesale ? 'wholesale' : 'retail',
          price_per_lb: pricePerLb,
          retail_price_per_lb: retailPerLb,
          wholesale_price_per_lb: wholesalePerLb,
          benchmark_available: !!benchMap[resolved.toLowerCase()]
        });
      }

      return {
        ok: true,
        forecasts,
        count: forecasts.length,
        total_est_revenue: parseFloat(forecasts.reduce((s, f) => s + (f.est_revenue_cad || f.annual_revenue_per_tray_cad || 0), 0).toFixed(2))
      };
    }
  },

  'get_cost_analysis': {
    description: 'Analyze cost-per-tray and profitability for crops. Supports tray format selection and wholesale vs retail pricing. Falls back to crop registry if crop not in pricing table.',
    category: 'read',
    required: [],
    optional: ['crop', 'pricing_tier', 'tray_format'],
    handler: async (params) => {
      const pricing = readJSON('crop-pricing.json', {});
      let crops = pricing.crops || [];

      // Fall back to crop-registry.json for crops not in pricing table
      const registry = readJSON('crop-registry.json', {});
      const regCrops = registry.crops || registry;
      const pricingCropNames = new Set(crops.map(c => (c.crop || '').toLowerCase()));
      for (const [name, data] of Object.entries(regCrops)) {
        if (!pricingCropNames.has(name.toLowerCase())) {
          const g = data.growth || {};
          const p = data.pricing || {};
          const retailPerLb = g.retailPricePerLb || (p.retailPerOz ? p.retailPerOz * 16 : 0);
          if (retailPerLb > 0) {
            crops.push({
              crop: name,
              unit: 'lb',
              retailPrice: retailPerLb,
              wholesalePrice: parseFloat((retailPerLb * 0.70).toFixed(2)),
              currency: p.currency || 'CAD',
              pricingSource: 'crop-registry-fallback'
            });
          }
        }
      }

      // Resolve tray format for plant count
      let plantsPerTray = 50; // default
      let trayName = 'Standard (50 sites)';
      if (params.tray_format) {
        const trayFormats = readJSON('tray-formats.json', []);
        const tray = trayFormats.find(t =>
          t.trayFormatId === params.tray_format ||
          (t.name || '').toLowerCase().includes(params.tray_format.toLowerCase()) ||
          (t.trayFormatId || '').toLowerCase().includes(params.tray_format.toLowerCase())
        );
        if (tray) {
          // For weight-based trays (microgreens), use 1 site but targetWeight
          if (tray.isWeightBased) {
            plantsPerTray = 1;
            trayName = tray.name + ' (weight-based)';
          } else {
            plantsPerTray = tray.plantSiteCount || 50;
            trayName = tray.name + ' (' + plantsPerTray + ' sites)';
          }
        }
      }

      const useWholesale = params.pricing_tier === 'wholesale';

      // Get benchmarks from DB
      let benchRows = [];
      if (isDatabaseAvailable()) {
        try {
          const res = await dbQuery('SELECT * FROM crop_benchmarks');
          benchRows = res.rows;
        } catch { /* ok */ }
      }
      const benchMap = {};
      for (const b of benchRows) benchMap[b.crop_name?.toLowerCase()] = b;

      const analysis = [];
      for (const c of crops) {
        if (params.crop) {
          const resolved = resolveCropName(params.crop);
          const cLower = (c.crop || '').toLowerCase();
          const pLower = params.crop.toLowerCase();
          const rLower = resolved.toLowerCase();
          if (cLower !== rLower && cLower !== pLower && !cLower.includes(pLower)) continue;
        }
        const bench = benchMap[c.crop?.toLowerCase()] || {};
        const growDays = bench.avg_grow_days || 28;
        const lossRate = bench.avg_loss_rate || 0.05;

        // Estimated costs per tray
        const seedCostPerTray = 1.50;
        const mediaCostPerTray = 0.80;
        const nutrientCostPerDay = 0.15;
        const electricityPerDay = 0.25;
        const totalCostPerTray = seedCostPerTray + mediaCostPerTray + (nutrientCostPerDay + electricityPerDay) * growDays;

        // Use retailPrice or wholesalePrice based on tier
        const retailPerLb = c.retailPrice || c.price_per_lb || c.pricePerLb || 0;
        const wholesalePerLb = c.wholesalePrice || parseFloat((retailPerLb * 0.70).toFixed(2));
        const pricePerLb = useWholesale ? wholesalePerLb : retailPerLb;

        const avgWeightOz = bench.avg_weight_per_plant_oz || 2;
        const yieldPerTrayLbs = (plantsPerTray * avgWeightOz * (1 - lossRate)) / 16;
        const revenuePerTray = yieldPerTrayLbs * pricePerLb;
        const margin = revenuePerTray > 0 ? ((revenuePerTray - totalCostPerTray) / revenuePerTray * 100).toFixed(1) : 0;

        // Annual projection: cycles per year based on grow days
        const cyclesPerYear = Math.floor(365 / growDays);
        const annualRevenuePerTray = parseFloat((revenuePerTray * cyclesPerYear).toFixed(2));

        analysis.push({
          crop: c.crop,
          grow_days: growDays,
          cycles_per_year: cyclesPerYear,
          tray_format: trayName,
          plants_per_tray: plantsPerTray,
          pricing_tier: useWholesale ? 'wholesale' : 'retail',
          cost_per_tray_cad: parseFloat(totalCostPerTray.toFixed(2)),
          yield_per_tray_lbs: parseFloat(yieldPerTrayLbs.toFixed(2)),
          revenue_per_tray_cad: parseFloat(revenuePerTray.toFixed(2)),
          annual_revenue_per_tray_cad: annualRevenuePerTray,
          margin_pct: parseFloat(margin),
          price_per_lb: pricePerLb,
          retail_price_per_lb: retailPerLb,
          wholesale_price_per_lb: wholesalePerLb
        });
      }

      analysis.sort((a, b) => b.margin_pct - a.margin_pct);
      return { ok: true, analysis, count: analysis.length };
    }
  },

  // ─── Research Platform Tools (E.V.I.E.) ─────────────────────────────
  'get_my_studies': {
    description: 'List all research studies for the current farm. Returns study titles, status, PI, protocol count, and linked entity count.',
    category: 'read',
    required: [],
    optional: ['status'],
    handler: async (params) => {
      try {
        const farmId = params.farm_id || process.env.FARM_ID;
        const queryParams = [farmId];
        const statusFilter = params.status ? `AND s.status = $${queryParams.push(params.status)}` : '';
        const result = await dbQuery(`
          SELECT s.id, s.title, s.status, s.objectives, s.created_at,
            u.email as pi_email,
            (SELECT COUNT(*) FROM study_protocols sp WHERE sp.study_id = s.id) as protocol_count,
            (SELECT COUNT(*) FROM study_links sl WHERE sl.study_id = s.id) as linked_entities
          FROM studies s LEFT JOIN farm_users u ON s.pi_user_id = u.id
          WHERE s.farm_id = $1 ${statusFilter}
          ORDER BY s.updated_at DESC LIMIT 20
        `, queryParams);
        return { ok: true, studies: result.rows, count: result.rows.length };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }
  },
  'get_study_timeline': {
    description: 'Get milestones and timeline for a specific study. Shows planned dates, actual dates, and status of each milestone.',
    category: 'read',
    required: ['study_id'],
    optional: [],
    handler: async (params) => {
      try {
        const milestones = await dbQuery(
          'SELECT * FROM trial_milestones WHERE study_id = $1 ORDER BY COALESCE(actual_date, planned_date) ASC',
          [params.study_id]
        );
        const deviations = await dbQuery(
          'SELECT id, deviation_type, description, recorded_at FROM protocol_deviations WHERE study_id = $1 ORDER BY recorded_at DESC LIMIT 10',
          [params.study_id]
        );
        return { ok: true, milestones: milestones.rows, deviations: deviations.rows };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }
  },
  'record_observation': {
    description: 'Record a manual research observation into a dataset. Provide dataset_id, variable_name, value, and optional unit.',
    category: 'write',
    required: ['dataset_id', 'variable_name', 'value'],
    optional: ['unit', 'sample_id', 'notes'],
    undoable: false,
    handler: async (params) => {
      try {
        const result = await dbQuery(`
          INSERT INTO research_observations (dataset_id, observation_type, variable_name, raw_value, unit, sample_id, observed_at)
          VALUES ($1, 'manual', $2, $3, $4, $5, NOW())
          RETURNING id, variable_name, raw_value, unit, observed_at
        `, [params.dataset_id, params.variable_name, params.value, params.unit || null, params.sample_id || null]);
        return { ok: true, observation: result.rows[0] };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }
  },
  'get_dataset_summary': {
    description: 'Get summary statistics for a research dataset including observation counts by variable, date range, and quality flag counts.',
    category: 'read',
    required: ['dataset_id'],
    optional: [],
    handler: async (params) => {
      try {
        const ds = await dbQuery('SELECT * FROM research_datasets WHERE id = $1', [params.dataset_id]);
        if (ds.rows.length === 0) return { ok: false, error: 'Dataset not found' };
        const stats = await dbQuery(`
          SELECT variable_name, COUNT(*) as count,
            MIN(raw_value) as min_val, MAX(raw_value) as max_val, AVG(raw_value) as avg_val,
            MIN(observed_at) as first_obs, MAX(observed_at) as last_obs
          FROM research_observations WHERE dataset_id = $1
          GROUP BY variable_name ORDER BY variable_name
        `, [params.dataset_id]);
        const flags = await dbQuery(`
          SELECT dqf.flag_type, COUNT(*) as count
          FROM data_quality_flags dqf
          JOIN research_observations ro ON dqf.observation_id = ro.id
          WHERE ro.dataset_id = $1
          GROUP BY dqf.flag_type
        `, [params.dataset_id]);
        return { ok: true, dataset: ds.rows[0], variable_stats: stats.rows, quality_flags: flags.rows };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }
  },
  'get_eln_entries': {
    description: 'Get recent electronic lab notebook entries for a notebook. Returns entries with signatures and attachment counts.',
    category: 'read',
    required: ['notebook_id'],
    optional: ['entry_type', 'limit'],
    handler: async (params) => {
      try {
        const limit = parseInt(params.limit, 10) || 20;
        const queryParams = [params.notebook_id];
        const typeFilter = params.entry_type ? `AND e.entry_type = $${queryParams.push(params.entry_type)}` : '';
        queryParams.push(limit);
        const limitIdx = queryParams.length;
        const result = await dbQuery(`
          SELECT e.*, u.email as created_by_email,
            (SELECT COUNT(*) FROM eln_signatures es WHERE es.entry_id = e.id) as signature_count,
            (SELECT COUNT(*) FROM eln_attachments ea WHERE ea.entry_id = e.id) as attachment_count
          FROM eln_entries e LEFT JOIN farm_users u ON e.created_by = u.id
          WHERE e.notebook_id = $1 ${typeFilter}
          ORDER BY e.created_at DESC LIMIT $${limitIdx}
        `, queryParams);
        return { ok: true, entries: result.rows, count: result.rows.length };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }
  },
  'get_calibration_status': {
    description: 'Get current calibration status for all devices. Shows overdue calibrations and next due dates.',
    category: 'read',
    required: [],
    optional: ['device_id'],
    handler: async (params) => {
      try {
        const farmId = params.farm_id || process.env.FARM_ID;
        const queryParams = [farmId];
        const deviceFilter = params.device_id ? `AND cl.device_id = $${queryParams.push(params.device_id)}` : '';
        const result = await dbQuery(`
          SELECT cl.device_id, cl.sensor_id, cl.calibration_type, cl.offset_value,
            cl.calibrated_at, cl.next_due,
            CASE WHEN cl.next_due < NOW() THEN true ELSE false END as overdue
          FROM calibration_logs cl
          WHERE cl.farm_id = $1 AND cl.status = 'current' ${deviceFilter}
          ORDER BY cl.next_due ASC NULLS LAST
        `, queryParams);
        const overdue = result.rows.filter(r => r.overdue);
        return { ok: true, calibrations: result.rows, overdue_count: overdue.length, overdue };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }
  },
  'get_study_budget': {
    description: 'Get budget status for a study including planned vs actual spending by category.',
    category: 'read',
    required: ['study_id'],
    optional: [],
    handler: async (params) => {
      try {
        const budgets = await dbQuery(`
          SELECT gb.*, 
            COALESCE(SUM(bli.planned_amount), 0) as total_planned,
            COALESCE(SUM(bli.actual_amount), 0) as total_actual
          FROM grant_budgets gb
          LEFT JOIN budget_line_items bli ON bli.budget_id = gb.id
          WHERE gb.study_id = $1
          GROUP BY gb.id
        `, [params.study_id]);
        return { ok: true, budgets: budgets.rows };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }
  },

  // ─── Phase 1 Research Operations Tools ─────────────────────────────────
  'get_recipe_versions': {
    description: 'List beta recipe versions for the farm. Shows recipe title, status, version number, and deployment count.',
    category: 'read',
    required: [],
    optional: ['status'],
    handler: async (params) => {
      try {
        const farmId = params.farm_id || process.env.FARM_ID;
        const queryParams = [farmId];
        const statusFilter = params.status ? `AND rv.status = $${queryParams.push(params.status)}` : '';
        const result = await dbQuery(`
          SELECT rv.id, rv.title, rv.status, rv.version_number, rv.created_at,
            (SELECT COUNT(*) FROM recipe_deployments rd WHERE rd.recipe_version_id = rv.id) as deployment_count
          FROM recipe_versions rv WHERE rv.farm_id = $1 ${statusFilter}
          ORDER BY rv.updated_at DESC LIMIT 30
        `, queryParams);
        return { ok: true, recipes: result.rows, count: result.rows.length };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }
  },
  'get_audit_log': {
    description: 'Query the research audit log. Returns recent audit entries filtered by entity or action.',
    category: 'read',
    required: [],
    optional: ['entity_type', 'action', 'limit'],
    handler: async (params) => {
      try {
        const farmId = params.farm_id || process.env.FARM_ID;
        const limit = parseInt(params.limit, 10) || 50;
        const queryParams = [farmId];
        let filters = '';
        if (params.entity_type) { filters += ` AND al.entity_type = $${queryParams.push(params.entity_type)}`; }
        if (params.action) { filters += ` AND al.action = $${queryParams.push(params.action)}`; }
        queryParams.push(limit);
        const result = await dbQuery(`
          SELECT al.* FROM audit_log al
          WHERE al.farm_id = $1 ${filters}
          ORDER BY al.created_at DESC LIMIT $${queryParams.length}
        `, queryParams);
        return { ok: true, entries: result.rows, count: result.rows.length };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }
  },
  'get_workspace_tasks': {
    description: 'List tasks for a study. Returns title, assignee, status, priority, and due date.',
    category: 'read',
    required: ['study_id'],
    optional: ['status'],
    handler: async (params) => {
      try {
        const queryParams = [params.study_id];
        const statusFilter = params.status ? `AND wt.status = $${queryParams.push(params.status)}` : '';
        const result = await dbQuery(`
          SELECT wt.* FROM workspace_tasks wt
          WHERE wt.study_id = $1 ${statusFilter}
          ORDER BY wt.priority ASC, wt.due_date ASC NULLS LAST LIMIT 50
        `, queryParams);
        return { ok: true, tasks: result.rows, count: result.rows.length };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }
  },
  'get_batch_chain': {
    description: 'Trace the full provenance chain for a batch (seed-to-ship). Returns all traceability events in chronological order.',
    category: 'read',
    required: ['batch_id'],
    optional: [],
    handler: async (params) => {
      try {
        const farmId = params.farm_id || process.env.FARM_ID;
        const result = await dbQuery(`
          WITH RECURSIVE chain AS (
            SELECT * FROM batch_traceability WHERE batch_id = $1 AND farm_id = $2
            UNION ALL
            SELECT bt.* FROM batch_traceability bt
            INNER JOIN chain c ON bt.batch_id = c.previous_batch_id AND bt.farm_id = c.farm_id
          )
          SELECT * FROM chain ORDER BY timestamp
        `, [params.batch_id, farmId]);
        return { ok: true, chain: result.rows, count: result.rows.length };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }
  },
  'get_data_quality_summary': {
    description: 'Get a summary of data quality alerts for a dataset, grouped by type and severity.',
    category: 'read',
    required: ['dataset_id'],
    optional: ['resolved'],
    handler: async (params) => {
      try {
        const queryParams = [params.dataset_id];
        let resolvedFilter = '';
        if (params.resolved !== undefined) {
          resolvedFilter = ` AND resolved = $${queryParams.push(params.resolved === 'true')}`;
        }
        const summary = await dbQuery(`
          SELECT alert_type, severity, COUNT(*) as count
          FROM data_quality_alerts WHERE dataset_id = $1 ${resolvedFilter}
          GROUP BY alert_type, severity ORDER BY count DESC
        `, queryParams);
        const total = await dbQuery(`
          SELECT COUNT(*) as total, SUM(CASE WHEN resolved THEN 1 ELSE 0 END) as resolved_count
          FROM data_quality_alerts WHERE dataset_id = $1
        `, [params.dataset_id]);
        return { ok: true, by_type: summary.rows, totals: total.rows[0] };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }
  },

  // ─── Phase 2 Research Operations Tools ─────────────────────────────────
  'get_grant_dashboard': {
    description: 'Get grant administration dashboard for the farm. Shows active grants, upcoming milestones, pending reports, and HQP counts.',
    category: 'read',
    required: [],
    optional: ['grant_id'],
    handler: async (params) => {
      try {
        const farmId = params.farm_id || process.env.FARM_ID;
        if (params.grant_id) {
          const dash = await dbQuery(`
            SELECT ga.id, ga.title, ga.funding_agency, ga.status, ga.amount_awarded,
              (SELECT COUNT(*) FROM grant_milestones gm WHERE gm.grant_id = ga.id AND gm.status = 'pending') as pending_milestones,
              (SELECT COUNT(*) FROM grant_reports gr WHERE gr.grant_id = ga.id AND gr.status = 'pending') as pending_reports,
              (SELECT COUNT(*) FROM trainee_records tr WHERE tr.grant_id = ga.id AND tr.status = 'active') as active_hqp
            FROM grant_applications ga WHERE ga.id = $1 AND ga.farm_id = $2
          `, [params.grant_id, farmId]);
          return { ok: true, grant: dash.rows[0] || null };
        }
        const grants = await dbQuery(`
          SELECT ga.id, ga.title, ga.funding_agency, ga.status, ga.amount_awarded, ga.end_date,
            (SELECT COUNT(*) FROM trainee_records tr WHERE tr.grant_id = ga.id AND tr.status = 'active') as active_hqp
          FROM grant_applications ga WHERE ga.farm_id = $1 AND ga.status IN ('active', 'awarded')
          ORDER BY ga.end_date ASC NULLS LAST
        `, [farmId]);
        return { ok: true, grants: grants.rows, count: grants.rows.length };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }
  },
  'get_ethics_status': {
    description: 'Get ethics and biosafety approval status. Shows active approvals, expiring within 60 days, and pending reviews.',
    category: 'read',
    required: [],
    optional: ['study_id'],
    handler: async (params) => {
      try {
        const farmId = params.farm_id || process.env.FARM_ID;
        const queryParams = [farmId];
        let studyFilter = '';
        if (params.study_id) { studyFilter = ` AND ea.study_id = $${queryParams.push(params.study_id)}`; }
        const active = await dbQuery(`SELECT ea.id, ea.protocol_title, ea.ethics_type, ea.status, ea.expiry_date FROM ethics_applications ea WHERE ea.farm_id = $1 AND ea.status = 'approved' ${studyFilter} ORDER BY ea.expiry_date ASC NULLS LAST`, queryParams);
        const expiring = await dbQuery(`SELECT ea.id, ea.protocol_title, ea.expiry_date FROM ethics_applications ea WHERE ea.farm_id = $1 AND ea.status = 'approved' AND ea.expiry_date <= NOW() + INTERVAL '60 days' ${studyFilter} ORDER BY ea.expiry_date ASC`, queryParams);
        return { ok: true, active: active.rows, expiring_soon: expiring.rows };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }
  },
  'get_hqp_summary': {
    description: 'Get HQP (trainee) summary. Shows trainee counts by type, active trainees, and milestone progress.',
    category: 'read',
    required: [],
    optional: ['grant_id'],
    handler: async (params) => {
      try {
        const farmId = params.farm_id || process.env.FARM_ID;
        const queryParams = [farmId];
        let grantFilter = '';
        if (params.grant_id) { grantFilter = ` AND tr.grant_id = $${queryParams.push(params.grant_id)}`; }
        const byType = await dbQuery(`SELECT trainee_type, status, COUNT(*) as count FROM trainee_records tr WHERE tr.farm_id = $1 ${grantFilter} GROUP BY trainee_type, status ORDER BY count DESC`, queryParams);
        const milestones = await dbQuery(`SELECT tm.status, COUNT(*) as count FROM trainee_milestones tm WHERE tm.farm_id = $1 GROUP BY tm.status`, [farmId]);
        return { ok: true, by_type: byType.rows, milestone_status: milestones.rows };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }
  },
  'get_partner_network': {
    description: 'Get partner institution network summary. Shows partners by type and agreement status.',
    category: 'read',
    required: [],
    optional: [],
    handler: async (params) => {
      try {
        const farmId = params.farm_id || process.env.FARM_ID;
        const partners = await dbQuery(`SELECT partner_type, status, COUNT(*) as count FROM partner_institutions WHERE farm_id = $1 GROUP BY partner_type, status ORDER BY count DESC`, [farmId]);
        const agreements = await dbQuery(`SELECT dsa.agreement_type, dsa.status, COUNT(*) as count FROM data_sharing_agreements dsa JOIN partner_institutions p ON dsa.partner_id = p.id WHERE p.farm_id = $1 GROUP BY dsa.agreement_type, dsa.status ORDER BY count DESC`, [farmId]);
        return { ok: true, partners: partners.rows, agreements: agreements.rows };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }
  },
  'get_security_overview': {
    description: 'Get research data security overview. Shows data classifications, open incidents, and recent audits.',
    category: 'read',
    required: [],
    optional: [],
    handler: async (params) => {
      try {
        const farmId = params.farm_id || process.env.FARM_ID;
        const classifications = await dbQuery(`SELECT classification_level, COUNT(*) as count FROM data_classifications WHERE farm_id = $1 GROUP BY classification_level`, [farmId]);
        const incidents = await dbQuery(`SELECT severity, status, COUNT(*) as count FROM security_incidents WHERE farm_id = $1 AND status NOT IN ('closed', 'dismissed') GROUP BY severity, status ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 END`, [farmId]);
        return { ok: true, classifications: classifications.rows, open_incidents: incidents.rows };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }
  },

  // ─── Research Platform Phase 3 Tools ─────────────────────────────────
  'get_research_dashboard': {
    description: 'Get unified research operations dashboard. Shows study health, grant status, compliance summary, HQP outcomes, and output metrics across the entire farm.',
    category: 'read',
    required: [],
    optional: [],
    handler: async (params) => {
      try {
        const farmId = params.farm_id || process.env.FARM_ID;
        const [studies, grants, compliance, outputs] = await Promise.all([
          dbQuery(`SELECT status, COUNT(*) as count FROM research_studies WHERE farm_id = $1 GROUP BY status`, [farmId]),
          dbQuery(`SELECT status, COUNT(*) as count FROM research_grants WHERE farm_id = $1 GROUP BY status`, [farmId]),
          dbQuery(`SELECT COUNT(*) as open_alerts FROM compliance_alerts WHERE farm_id = $1 AND status NOT IN ('resolved', 'dismissed')`, [farmId]),
          dbQuery(`SELECT COUNT(*) as total_datasets, SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_datasets FROM research_datasets WHERE farm_id = $1`, [farmId])
        ]);
        return { ok: true, studies: studies.rows, grants: grants.rows, compliance: compliance.rows[0], outputs: outputs.rows[0] };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }
  },

  'get_deadline_summary': {
    description: 'Get upcoming research deadlines across all modules. Shows grant milestones, ethics renewals, trainee deadlines, and task due dates with urgency classification.',
    category: 'read',
    required: [],
    optional: ['days_ahead'],
    handler: async (params) => {
      try {
        const farmId = params.farm_id || process.env.FARM_ID;
        const days = parseInt(params.days_ahead, 10) || 30;
        const [grantMilestones, ethicsExpiry, tasks] = await Promise.all([
          dbQuery(`SELECT gm.title, gm.due_date, rg.title as grant_title FROM grant_milestones gm JOIN research_grants rg ON rg.id = gm.grant_id WHERE rg.farm_id = $1 AND gm.status = 'pending' AND gm.due_date <= NOW() + make_interval(days => $2) ORDER BY gm.due_date ASC`, [farmId, days]),
          dbQuery(`SELECT ea.protocol_title, ea.expiry_date FROM ethics_applications ea WHERE ea.farm_id = $1 AND ea.status = 'approved' AND ea.expiry_date <= NOW() + make_interval(days => $2) ORDER BY ea.expiry_date ASC`, [farmId, days]),
          dbQuery(`SELECT title, due_date, priority FROM workspace_tasks WHERE farm_id = $1 AND status NOT IN ('completed', 'cancelled') AND due_date <= NOW() + make_interval(days => $2) ORDER BY due_date ASC`, [farmId, days])
        ]);
        return { ok: true, grant_milestones: grantMilestones.rows, ethics_expiring: ethicsExpiry.rows, tasks_due: tasks.rows };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }
  },

  'get_publication_pipeline': {
    description: 'Get publication pipeline status. Shows publications by status (draft, submitted, in review, accepted, published) and grant compliance gaps.',
    category: 'read',
    required: [],
    optional: [],
    handler: async (params) => {
      try {
        const farmId = params.farm_id || process.env.FARM_ID;
        const pipeline = await dbQuery(`SELECT status, COUNT(*) as count FROM publications WHERE farm_id = $1 GROUP BY status ORDER BY CASE status WHEN 'draft' THEN 1 WHEN 'submitted' THEN 2 WHEN 'in_review' THEN 3 WHEN 'accepted' THEN 4 WHEN 'published' THEN 5 ELSE 6 END`, [farmId]);
        const recent = await dbQuery(`SELECT title, status, publication_type, updated_at FROM publications WHERE farm_id = $1 ORDER BY updated_at DESC LIMIT 5`, [farmId]);
        return { ok: true, pipeline: pipeline.rows, recent: recent.rows };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }
  },

  'get_equipment_status': {
    description: 'Get lab equipment status overview. Shows equipment counts by status, upcoming bookings, and maintenance due alerts.',
    category: 'read',
    required: [],
    optional: [],
    handler: async (params) => {
      try {
        const farmId = params.farm_id || process.env.FARM_ID;
        const [statusCounts, upcomingBookings, maintenanceDue] = await Promise.all([
          dbQuery(`SELECT status, COUNT(*) as count FROM lab_equipment WHERE farm_id = $1 GROUP BY status`, [farmId]),
          dbQuery(`SELECT eb.start_time, eb.end_time, eb.purpose, le.name as equipment_name FROM equipment_bookings eb JOIN lab_equipment le ON le.id = eb.equipment_id WHERE le.farm_id = $1 AND eb.status = 'confirmed' AND eb.start_time > NOW() ORDER BY eb.start_time ASC LIMIT 10`, [farmId]),
          dbQuery(`SELECT le.name, le.maintenance_interval_days, (SELECT MAX(em.performed_at) FROM equipment_maintenance em WHERE em.equipment_id = le.id) as last_maintenance FROM lab_equipment le WHERE le.farm_id = $1 AND le.status NOT IN ('retired') AND le.maintenance_interval_days IS NOT NULL`, [farmId])
        ]);
        return { ok: true, status_counts: statusCounts.rows, upcoming_bookings: upcomingBookings.rows, maintenance_items: maintenanceDue.rows };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }
  },

  'get_data_lineage': {
    description: 'Get data lineage and governance overview. Shows dataset provenance events, untracked datasets, and classification compliance.',
    category: 'read',
    required: [],
    optional: ['dataset_id'],
    handler: async (params) => {
      try {
        const farmId = params.farm_id || process.env.FARM_ID;
        if (params.dataset_id) {
          const chain = await dbQuery(`SELECT * FROM dataset_lineage WHERE dataset_id = $1 AND farm_id = $2 ORDER BY created_at ASC`, [params.dataset_id, farmId]);
          return { ok: true, dataset_id: params.dataset_id, chain: chain.rows };
        }
        const [eventTypes, untracked, annotations] = await Promise.all([
          dbQuery(`SELECT event_type, COUNT(*) as count FROM dataset_lineage WHERE farm_id = $1 GROUP BY event_type ORDER BY count DESC`, [farmId]),
          dbQuery(`SELECT rd.id, rd.name FROM research_datasets rd LEFT JOIN dataset_lineage dl ON dl.dataset_id = rd.id WHERE rd.farm_id = $1 AND dl.id IS NULL LIMIT 20`, [farmId]),
          dbQuery(`SELECT annotation_type, COUNT(*) as count FROM data_annotations WHERE farm_id = $1 GROUP BY annotation_type ORDER BY count DESC`, [farmId])
        ]);
        return { ok: true, event_types: eventTypes.rows, untracked_datasets: untracked.rows, annotation_types: annotations.rows };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }
  },

  // ─── EVIE Scanning Integration Tools ─────────────────────────────────
  'scan_bus_channels': {
    description: 'Scan all bus channels (I2C, SPI, 1-Wire, UART) for connected devices. Returns discovered devices with addresses, protocols, and suggested types. Use this to begin device onboarding.',
    category: 'read',
    required: [],
    optional: ['bus_type', 'timeout_ms'],
    handler: async (params) => {
      try {
        const busType = params.bus_type || 'all';
        const timeout = parseInt(params.timeout_ms, 10) || 5000;
        // Cloud-farm architecture: scan request is proxied to the LE instance
        const farmUrl = process.env.FARM_API_URL || process.env.LE_API_URL;
        if (!farmUrl) {
          return { ok: false, error: 'No farm API URL configured for bus scanning' };
        }
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout + 2000);
        try {
          const resp = await fetch(`${farmUrl}/api/devices/scan-bus`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bus_type: busType, timeout_ms: timeout }),
            signal: controller.signal
          });
          clearTimeout(timeoutId);
          const data = await resp.json();
          return { ok: true, ...data };
        } catch (fetchErr) {
          clearTimeout(timeoutId);
          return { ok: false, error: `Bus scan failed: ${fetchErr.message}` };
        }
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }
  },
  'get_bus_mappings': {
    description: 'Get current bus-to-device mappings with coverage summary. Shows which physical addresses/channels are mapped to which registered devices, total mapped channels, and unmapped channels by bus type.',
    category: 'read',
    required: [],
    optional: ['bus_type'],
    handler: async (params) => {
      try {
        const farmId = params.farm_id || process.env.FARM_ID;
        // Query devices table for all devices with bus mapping metadata
        const devices = await dbQuery(`
          SELECT device_id, name, device_type, status, metadata, updated_at
          FROM devices WHERE farm_id = $1
          ORDER BY device_type, name
        `, [farmId]);

        // Extract bus mappings from device metadata
        const mappings = [];
        const busCounts = {};
        for (const d of devices.rows) {
          let meta = null;
          try {
            meta = typeof d.metadata === 'string' ? JSON.parse(d.metadata) : d.metadata;
          } catch { /* skip */ }
          const busInfo = meta?.bus_mapping || (meta?.bus_type ? meta : null);
          if (busInfo?.bus_type && busInfo?.bus_address) {
            mappings.push({
              address: busInfo.bus_address,
              bus_type: busInfo.bus_type,
              device_id: d.device_id,
              device_name: d.name,
              device_type: d.device_type,
              status: d.status,
              mapped_at: busInfo.mapped_at || d.updated_at
            });
            busCounts[busInfo.bus_type] = (busCounts[busInfo.bus_type] || 0) + 1;
          }
        }

        // Filter by bus_type if requested
        const filtered = params.bus_type
          ? mappings.filter(m => m.bus_type === params.bus_type)
          : mappings;

        return {
          ok: true,
          total_mapped_channels: filtered.length,
          mappings_by_bus: busCounts,
          mappings: filtered,
          registered_devices: devices.rows,
          recent_mapping_updates: mappings
            .filter(m => m.mapped_at)
            .sort((a, b) => new Date(b.mapped_at) - new Date(a.mapped_at))
            .slice(0, 5)
        };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }
  },
  'save_bus_mapping': {
    description: 'Save a bus channel to device mapping after scanning. Maps a discovered physical address to a registered device ID.',
    category: 'write',
    required: ['bus_address', 'device_id', 'bus_type'],
    optional: ['device_name', 'device_type'],
    undoable: true,
    handler: async (params) => {
      try {
        const farmId = params.farm_id || process.env.FARM_ID;
        // Register or update the device with bus mapping metadata
        const metadata = JSON.stringify({
          bus_type: params.bus_type,
          bus_address: params.bus_address,
          mapped_at: new Date().toISOString()
        });
        const result = await dbQuery(`
          INSERT INTO devices (device_id, farm_id, name, device_type, status, metadata)
          VALUES ($1, $2, $3, $4, 'active', $5)
          ON CONFLICT (device_id) DO UPDATE SET
            metadata = jsonb_set(COALESCE(devices.metadata, '{}'), '{bus_mapping}', $5::jsonb),
            updated_at = NOW()
          RETURNING *
        `, [params.device_id, farmId, params.device_name || params.device_id,
            params.device_type || 'sensor', metadata]);
        return { ok: true, device: result.rows[0], message: `Mapped ${params.bus_address} (${params.bus_type}) to device ${params.device_id}` };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }
  }

};

// Discovery session cache: sessionId -> { assets, created_at, farm_id }
const discoverySessions = new Map();
const DISCOVERY_SESSION_TTL_MS = 15 * 60 * 1000; // 15 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, sess] of discoverySessions) {
    if (now - sess.created_at > DISCOVERY_SESSION_TTL_MS) discoverySessions.delete(id);
  }
}, 5 * 60 * 1000);

// Idempotency cache: key → { result, created_at }
const idempotencyCache = new Map();
const IDEMPOTENCY_TTL_MS = 30 * 60 * 1000; // 30 minutes

// Undo history: stores last N write operations with undo state
const undoHistory = [];
const MAX_UNDO_HISTORY = 50;

// Audit log (in-memory, persisted to GCS on each write)
const AUDIT_LOG_PATH = path.join(DATA_DIR, 'agent-audit-log.json');

function loadAuditLog() {
  try {
    if (fs.existsSync(AUDIT_LOG_PATH)) {
      return JSON.parse(fs.readFileSync(AUDIT_LOG_PATH, 'utf8'));
    }
  } catch {}
  return [];
}

function appendAuditEntry(entry) {
  const log = loadAuditLog();
  log.push(entry);
  // Keep last 1000 entries
  const trimmed = log.slice(-1000);
  // Write locally and persist to GCS
  try {
    fs.writeFileSync(AUDIT_LOG_PATH, JSON.stringify(trimmed, null, 2));
  } catch {}
  gcsWriteJSON('data/agent-audit-log.json', trimmed).catch(err => {
    console.warn('[farm-ops-agent] GCS audit log write failed:', err.message);
  });
  return trimmed;
}

/**
 * POST /tool-gateway
 * Body: { tool, params, idempotency_key? }
 *
 * Validates required slots, runs the tool, logs the result.
 * If idempotency_key is provided and matches a recent call, returns cached result.
 */
router.post('/tool-gateway', async (req, res) => {
  const { tool, params = {}, idempotency_key } = req.body;

  if (!tool) return res.status(400).json({ ok: false, error: 'Missing required field: tool' });

  const toolDef = TOOL_CATALOG[tool];
  if (!toolDef) {
    return res.status(404).json({
      ok: false,
      error: `Unknown tool: ${tool}`,
      available_tools: Object.keys(TOOL_CATALOG)
    });
  }

  // Validate required slots
  const missingSlots = toolDef.required.filter(slot => params[slot] == null);
  if (missingSlots.length > 0) {
    return res.status(400).json({
      ok: false,
      error: `Missing required parameters: ${missingSlots.join(', ')}`,
      tool,
      required: toolDef.required,
      optional: toolDef.optional
    });
  }

  // Check idempotency
  if (idempotency_key) {
    const cached = idempotencyCache.get(idempotency_key);
    if (cached && Date.now() - cached.created_at < IDEMPOTENCY_TTL_MS) {
      return res.json({
        ok: true,
        cached: true,
        idempotency_key,
        result: cached.result
      });
    }
  }

  // Safety: write tools use two-phase commit (preview → confirm)
  // On first call without confirm:true, return a preview of what will happen.
  // Client must re-send with confirm:true to actually execute.
  const { confirm } = req.body;
  if (toolDef.category === 'write' && !confirm) {
    return res.json({
      ok: true,
      phase: 'preview',
      tool,
      category: toolDef.category,
      description: toolDef.description,
      params,
      undoable: !!toolDef.undoable,
      message: 'This is a write operation. Review and re-send with confirm: true to execute.',
      required: toolDef.required,
      optional: toolDef.optional
    });
  }

  // Dangerous tools require explicit confirmation even beyond two-phase
  if (toolDef.category === 'dangerous' && !confirm) {
    return res.status(403).json({
      ok: false,
      error: 'This tool requires explicit confirmation. Send confirm: true to proceed.',
      tool,
      category: toolDef.category
    });
  }

  // Execute
  const startTime = Date.now();
  try {
    const result = await toolDef.handler(params);
    const durationMs = Date.now() - startTime;

    const auditEntry = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      tool,
      category: toolDef.category,
      params: toolDef.category === 'read' ? {} : params, // Don't log params for reads
      success: true,
      duration_ms: durationMs,
      idempotency_key: idempotency_key || null
    };
    appendAuditEntry(auditEntry);

    // Cache result for idempotency
    if (idempotency_key) {
      idempotencyCache.set(idempotency_key, { result, created_at: Date.now() });
    }

    // Store undo state for undoable write tools
    if (toolDef.undoable && toolDef.category === 'write' && result._undo_state) {
      undoHistory.push({
        id: auditEntry.id,
        tool,
        params,
        undo_state: result._undo_state,
        timestamp: auditEntry.timestamp
      });
      if (undoHistory.length > MAX_UNDO_HISTORY) undoHistory.shift();
      delete result._undo_state; // Don't expose internals to client
    }

    res.json({ ok: true, tool, result, undoable: !!toolDef.undoable, duration_ms: durationMs });
  } catch (error) {
    const durationMs = Date.now() - startTime;
    appendAuditEntry({
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      tool,
      category: toolDef.category,
      params,
      success: false,
      error: error.message,
      duration_ms: durationMs,
      idempotency_key: idempotency_key || null
    });
    res.status(500).json({ ok: false, tool, error: error.message });
  }
});

/**
 * GET /tool-catalog — returns available tools with schemas
 */
router.get('/tool-catalog', (req, res) => {
  const catalog = Object.entries(TOOL_CATALOG).map(([name, def]) => ({
    name,
    description: def.description,
    category: def.category,
    required_params: def.required,
    optional_params: def.optional,
    undoable: !!def.undoable
  }));
  res.json({ ok: true, tools: catalog, count: catalog.length });
});

/**
 * POST /undo — Undo the last write operation (or a specific one by audit ID)
 * Body: { audit_id? }
 */
router.post('/undo', async (req, res) => {
  const { audit_id } = req.body || {};
  try {
    let entry;
    if (audit_id) {
      const idx = undoHistory.findIndex(e => e.id === audit_id);
      if (idx === -1) return res.status(404).json({ ok: false, error: `No undoable action found with ID ${audit_id}` });
      entry = undoHistory.splice(idx, 1)[0];
    } else {
      entry = undoHistory.pop();
      if (!entry) return res.status(404).json({ ok: false, error: 'No undoable actions in history' });
    }

    const toolDef = TOOL_CATALOG[entry.tool];
    if (!toolDef || !toolDef.undoHandler) {
      return res.status(400).json({ ok: false, error: `Tool ${entry.tool} does not support undo` });
    }

    const result = await toolDef.undoHandler(entry.params, entry.undo_state);
    appendAuditEntry({
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      tool: entry.tool,
      category: 'undo',
      params: { original_audit_id: entry.id },
      success: true,
      duration_ms: 0
    });
    res.json({ ok: true, undone_tool: entry.tool, undone_at: entry.timestamp, result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * GET /undo-history — list undoable actions
 */
router.get('/undo-history', (req, res) => {
  res.json({
    ok: true,
    count: undoHistory.length,
    entries: undoHistory.map(e => ({
      id: e.id,
      tool: e.tool,
      params: e.params,
      timestamp: e.timestamp
    }))
  });
});

// ============================================================================
// 3. Command Taxonomy — Natural Language → Intent + Slots
// ============================================================================

/**
 * Command families and their patterns.
 * Each family maps to a set of regex patterns that extract intent and slots.
 */
const COMMAND_FAMILIES = [
  {
    intent: 'daily_todo',
    family: 'status',
    patterns: [
      /what.*(?:should|need|do).*today/i,
      /daily\s*(?:to.?do|tasks?|list)/i,
      /(?:morning|daily)\s*(?:briefing|summary|report)/i,
      /what'?s\s*(?:on\s*)?(?:my|the)\s*(?:plate|agenda|list)/i,
      /priorit(?:y|ize|ies)/i
    ],
    slots: {},
    tool: 'get_daily_todo'
  },
  {
    intent: 'room_status',
    family: 'status',
    patterns: [
      /(?:how|what).*(?:room|grow\s*space)\s+(\S+)/i,
      /status\s*(?:of|for)\s*(?:room|space)\s+(\S+)/i,
      /(?:room|space)\s+(\S+)\s*status/i,
      /check\s+(?:room|space)\s+(\S+)/i
    ],
    slots: { room_id: 1 },  // capture group index
    tool: 'get_room_status'
  },
  {
    intent: 'harvest_check',
    family: 'harvest',
    patterns: [
      /(?:what|which).*ready\s*(?:to\s*)?harvest/i,
      /harvest\s*(?:readiness|ready|status)/i,
      /(?:anything|what)\s*(?:to|ready\s*to)\s*(?:pick|harvest|cut)/i
    ],
    slots: {},
    tool: 'get_daily_todo',
    tool_params: { category: 'harvest' }
  },
  {
    intent: 'order_status',
    family: 'wholesale',
    patterns: [
      /(?:pending|open|upcoming)\s*orders?/i,
      /(?:wholesale|order)\s*(?:status|summary|list)/i,
      /(?:any|how\s*many)\s*(?:orders?|wholesale)/i
    ],
    slots: {},
    tool: 'get_orders'
  },
  {
    intent: 'alert_check',
    family: 'anomaly',
    patterns: [
      /(?:any|show)?\s*alert(?:s)?/i,
      /(?:anomal(?:y|ies)|warning|critical|problem)/i,
      /(?:sensor|device)\s*(?:outage|down|offline|issue)/i,
      /what'?s\s*wrong/i
    ],
    slots: {},
    tool: 'get_alerts'
  },
  {
    intent: 'dismiss_alert',
    family: 'anomaly',
    patterns: [
      /dismiss\s*(?:alert|warning)\s*(\S+)/i,
      /(?:clear|resolve|acknowledge)\s*(?:alert|warning|issue)\s*(\S+)/i
    ],
    slots: { alert_id: 1 },
    tool: 'dismiss_alert'
  },
  {
    intent: 'planting_schedule',
    family: 'planting',
    patterns: [
      /(?:show|get|what'?s?)\s*(?:the\s+)?(?:current\s+)?(?:planting|growing)\s*(?:schedule|assignments?|plan)/i,
      /what(?:'s|\s+is)\s*(?:planted|growing)\s*(?:right now|currently|now)?/i,
      /(?:current|active)\s*(?:plantings?|crops?|assignments?)/i
    ],
    slots: {},
    tool: 'get_planting_assignments'
  },
  {
    intent: 'scheduled_harvests',
    family: 'planting',
    patterns: [
      /(?:upcoming|scheduled|next|expected)\s*harvests?/i,
      /(?:when|what)\s*(?:is|are)\s*(?:the\s+)?(?:next\s+)?harvests?/i,
      /(?:harvest|zone)\s*(?:forecast|schedule|timeline)/i,
      /(?:zones?|groups?)\s*(?:freeing|opening|available)\s*(?:up|soon)?/i
    ],
    slots: {},
    tool: 'get_scheduled_harvests'
  },
  {
    intent: 'device_status',
    family: 'device_onboarding',
    patterns: [
      /(?:check|show|list|get|what)\s*(?:are\s*)?(?:my\s*)?(?:devices?|sensors?|iot)/i,
      /(?:device|sensor|iot)\s*(?:status|inventory|list|check)/i,
      /(?:any|how\s*many)\s*(?:unassigned|new)\s*(?:devices?|sensors?)/i,
      /what\s*(?:devices?|hardware|sensors?)\s*(?:do\s*I|are)/i
    ],
    slots: {},
    tool: 'get_device_status'
  },
  {
    intent: 'scan_devices',
    family: 'device_onboarding',
    patterns: [
      /scan\s*(?:for\s*)?(?:new\s*)?(?:devices?|sensors?|lights?|hardware)/i,
      /discover\s*(?:new\s*)?(?:devices?|sensors?|hardware)/i,
      /find\s*(?:new\s*)?(?:devices?|sensors?|hardware)\s*(?:on|in)/i,
      /(?:network|protocol)\s*scan/i
    ],
    slots: {},
    tool: 'scan_devices'
  },
  {
    intent: 'register_device',
    family: 'device_onboarding',
    patterns: [
      /(?:add|register|introduce|set\s*up|install|connect)\s*(?:a?\s*new\s*)?(?:device|sensor|light|fan|dehumidifier|humidifier|controller|hvac|camera|meter)/i,
      /(?:new|add)\s*(?:dehumidifier|humidifier|sensor|fan|light|hvac|camera)/i,
      /(?:introduce|put|place)\s*(?:a?\s*)?(?:dehumidifier|humidifier|sensor|fan|light)\s*(?:in|into|to)/i
    ],
    slots: {},
    tool: 'register_device'
  },
  {
    intent: 'environment_readings',
    family: 'environment',
    patterns: [
      /(?:what|how|check|show|get)\s*(?:is|are|the)?\s*(?:temperature|humidity|environment|conditions|readings|climate)/i,
      /(?:how\s*)?(?:warm|cold|hot|humid|dry)\s*(?:is|are)?\s*(?:it|the|zone|room)/i,
      /(?:sensor|environment|env)\s*(?:data|readings|status|check)/i,
      /(?:current|live|real)\s*(?:temp|temperature|humidity|readings)/i
    ],
    slots: {},
    tool: 'get_environment_readings'
  },
  {
    intent: 'update_targets',
    family: 'environment',
    patterns: [
      /(?:set|change|update|adjust)\s*(?:target|range|setpoint)s?\s*(?:for|in|to)/i,
      /(?:set|change)\s*(?:temp|temperature|humidity)\s*(?:target|range|min|max)/i,
      /(?:target|ideal|optimal)\s*(?:temp|temperature|humidity)\s*(?:should|to|for)/i
    ],
    slots: {},
    tool: 'update_target_ranges'
  },
  {
    intent: 'light_schedule',
    family: 'environment',
    patterns: [
      /(?:set|change|update|adjust)\s*(?:light|lighting)\s*(?:schedule|timer|on|off)/i,
      /(?:lights?|photoperiod)\s*(?:on|off|schedule|hours|time)/i,
      /(?:when|what\s*time)\s*(?:should|do)\s*(?:the\s*)?lights/i
    ],
    slots: {},
    tool: 'set_light_schedule'
  },
  {
    intent: 'auto_assign',
    family: 'device_onboarding',
    patterns: [
      /auto[- ]?assign\s*(?:devices?|sensors?|lights?)/i,
      /assign\s*(?:devices?|sensors?)\s*(?:to\s*zones?|automatically)/i
    ],
    slots: {},
    tool: 'auto_assign_devices'
  },
  {
    intent: 'seed_window',
    family: 'planting',
    patterns: [
      /(?:what|when)\s*(?:should|to)\s*(?:seed|plant|sow)/i,
      /(?:seeding|planting|succession)\s*(?:window|schedule|plan)/i,
      /(?:need|time)\s*to\s*(?:seed|plant|start)/i
    ],
    slots: {},
    tool: 'get_daily_todo',
    tool_params: { category: 'seeding' }
  },
  {
    intent: 'seed_benchmarks',
    family: 'planting',
    patterns: [
      /(?:seed|load|import)\s*benchmark/i,
      /benchmark\s*(?:data|seed|import|setup)/i,
      /(?:crop|yield)\s*benchmark/i
    ],
    slots: {},
    tool: 'seed_benchmarks'
  },
  {
    intent: 'undo_last',
    family: 'status',
    patterns: [
      /undo\s*(?:last|that|previous)/i,
      /(?:revert|rollback|take\s*back)/i
    ],
    slots: {},
    tool: null,
    special: 'undo'
  },
  {
    intent: 'nutrient_status',
    family: 'nutrients',
    patterns: [
      /(?:what|how|check|show|get)\s*(?:is|are|the)?\s*(?:ph|ec|nutrient|solution|tank|reservoir)/i,
      /(?:nutrient|solution|tank|reservoir)\s*(?:status|readings|levels?|check)/i,
      /(?:ph|ec)\s*(?:level|reading|current|now)/i,
      /(?:autodose|auto-dose|dosing)\s*(?:status|config|settings?)/i
    ],
    slots: {},
    tool: 'get_nutrient_status'
  },
  {
    intent: 'nutrient_targets',
    family: 'nutrients',
    patterns: [
      /(?:set|change|update|adjust)\s*(?:ph|ec|nutrient)\s*(?:target|setpoint|level)/i,
      /(?:ph|ec)\s*(?:target|setpoint|should)\s*(?:be|to|at)/i,
      /(?:autodose|auto-dose)\s*(?:enable|disable|turn|toggle|on|off)/i,
      /(?:change|update)\s*(?:nutrient|tank|dosing)\s*(?:target|settings?)/i
    ],
    slots: {},
    tool: 'update_nutrient_targets'
  },
  {
    intent: 'dosing_history',
    family: 'nutrients',
    patterns: [
      /(?:dosing|dose)\s*(?:history|log|events?|recent)/i,
      /(?:recent|last|latest)\s*(?:dosing|dose|pump)\s*(?:events?|activity)/i,
      /(?:when|what)\s*(?:was|were)\s*(?:the\s*)?(?:last|recent)\s*(?:dose|dosing|pump)/i,
      /(?:calibration|calibrate)\s*(?:history|data|log)/i
    ],
    slots: {},
    tool: 'get_dosing_history'
  },
  {
    intent: 'yield_forecast',
    family: 'planting',
    patterns: [
      /(?:yield|harvest)\s*(?:forecast|projection|estimate|expected)/i,
      /(?:how\s*much|what)\s*(?:will|should)\s*(?:we|I)?\s*(?:harvest|yield|get)/i,
      /(?:expected|upcoming|projected)\s*(?:yield|harvest|revenue)/i,
      /(?:forecast|project|estimate)\s*(?:revenue|income|harvest)/i
    ],
    slots: {},
    tool: 'get_yield_forecast'
  },
  {
    intent: 'cost_analysis',
    family: 'planting',
    patterns: [
      /(?:cost|expense)\s*(?:per|analysis|breakdown|estimate)/i,
      /(?:profitability|profit|margin)\s*(?:analysis|by\s*crop|per\s*tray)/i,
      /(?:cost|how\s*much)\s*(?:per\s*tray|to\s*grow)/i,
      /(?:most|least|best|worst)\s*(?:profitable|margin)/i
    ],
    slots: {},
    tool: 'get_cost_analysis'
  }
];

/**
 * Fuzzy keyword matching — provides medium-confidence matches when regex fails.
 * Uses word overlap scoring against command family keywords.
 */
const INTENT_KEYWORDS = {
  daily_todo: ['today', 'todo', 'tasks', 'priorities', 'morning', 'briefing', 'agenda', 'list', 'plan'],
  room_status: ['room', 'space', 'status', 'check', 'environment', 'growing'],
  harvest_check: ['harvest', 'ready', 'pick', 'cut', 'ripe', 'mature'],
  order_status: ['order', 'orders', 'wholesale', 'pending', 'delivery', 'buyer'],
  alert_check: ['alert', 'alerts', 'warning', 'problem', 'issue', 'sensor', 'outage', 'anomaly'],
  dismiss_alert: ['dismiss', 'clear', 'resolve', 'acknowledge'],
  auto_assign: ['assign', 'auto', 'device', 'devices', 'light', 'lights', 'sensor'],
  device_status: ['device', 'devices', 'sensor', 'sensors', 'iot', 'hardware', 'inventory', 'list'],
  scan_devices: ['scan', 'discover', 'find', 'network', 'new', 'detect', 'hardware', 'switchbot'],
  register_device: ['add', 'register', 'introduce', 'install', 'connect', 'setup', 'dehumidifier', 'humidifier', 'fan', 'light', 'controller', 'camera', 'meter'],
  environment_readings: ['temperature', 'humidity', 'readings', 'sensors', 'climate', 'conditions', 'env', 'how', 'warm', 'cold', 'humid', 'dry'],
  update_targets: ['target', 'targets', 'range', 'setpoint', 'set', 'adjust', 'temp', 'humidity', 'min', 'max'],
  light_schedule: ['light', 'lights', 'photoperiod', 'schedule', 'on', 'off', 'ppfd', 'dli'],
  planting_schedule: ['planting', 'planted', 'growing', 'schedule', 'assignment', 'current', 'active'],
  scheduled_harvests: ['upcoming', 'harvest', 'next', 'forecast', 'freeing', 'available', 'zone'],
  seed_window: ['seed', 'plant', 'sow', 'planting', 'succession', 'schedule'],
  seed_benchmarks: ['benchmark', 'benchmarks', 'import', 'crop', 'yield', 'baseline'],
  undo_last: ['undo', 'revert', 'rollback', 'takeback'],
  nutrient_status: ['nutrient', 'nutrients', 'ph', 'ec', 'solution', 'tank', 'reservoir', 'autodose', 'dosing'],
  nutrient_targets: ['nutrient', 'ph', 'ec', 'target', 'setpoint', 'autodose', 'enable', 'disable'],
  dosing_history: ['dosing', 'dose', 'pump', 'calibration', 'history', 'recent'],
  yield_forecast: ['yield', 'forecast', 'projection', 'estimate', 'revenue', 'expected', 'upcoming'],
  cost_analysis: ['cost', 'profitability', 'profit', 'margin', 'expense', 'tray', 'per']
};

function fuzzyMatch(text) {
  const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  if (words.length === 0) return null;

  let bestIntent = null;
  let bestScore = 0;

  for (const [intent, keywords] of Object.entries(INTENT_KEYWORDS)) {
    const overlap = words.filter(w => keywords.some(kw => kw.includes(w) || w.includes(kw))).length;
    const score = overlap / Math.max(words.length, keywords.length);
    if (score > bestScore) {
      bestScore = score;
      bestIntent = intent;
    }
  }

  if (bestScore >= 0.15 && bestIntent) {
    const cmd = COMMAND_FAMILIES.find(c => c.intent === bestIntent);
    const confidence = Math.min(0.7, 0.3 + bestScore);
    return {
      ok: true,
      intent: bestIntent,
      family: cmd?.family || 'unknown',
      confidence,
      slots: cmd?.tool_params || {},
      suggested_tool: cmd?.tool || null,
      match_type: 'fuzzy',
      original_text: text,
      requires_confirmation: confidence < 0.5
    };
  }
  return null;
}

/**
 * Parse a natural-language command into intent + slots + suggested tool.
 * Uses regex matching first (high confidence), then fuzzy keyword matching
 * (medium confidence), then abstains.
 */
function parseNaturalCommand(text) {
  const normalized = text.trim();
  if (!normalized) return { ok: false, error: 'Empty command' };

  for (const cmd of COMMAND_FAMILIES) {
    for (const pattern of cmd.patterns) {
      const match = normalized.match(pattern);
      if (match) {
        // Extract slots from capture groups
        const extractedSlots = {};
        for (const [slotName, groupIndex] of Object.entries(cmd.slots)) {
          if (match[groupIndex]) {
            extractedSlots[slotName] = match[groupIndex];
          }
        }

        return {
          ok: true,
          intent: cmd.intent,
          family: cmd.family,
          confidence: 0.85,
          slots: { ...extractedSlots, ...(cmd.tool_params || {}) },
          suggested_tool: cmd.tool,
          matched_pattern: pattern.source,
          original_text: normalized
        };
      }
    }
  }

  // No regex match — try fuzzy keyword matching
  const fuzzyResult = fuzzyMatch(normalized);
  if (fuzzyResult) return fuzzyResult;

  // No match — return abstain response
  return {
    ok: true,
    intent: 'unknown',
    family: 'unknown',
    confidence: 0.0,
    slots: {},
    suggested_tool: null,
    original_text: normalized,
    abstain_reason: 'No matching command pattern found. Please try rephrasing or use "what should I do today?" for the daily task list.',
    available_intents: COMMAND_FAMILIES.map(c => ({
      intent: c.intent,
      family: c.family,
      example: c.patterns[0].source
    }))
  };
}

/**
 * POST /parse-command
 * Body: { text }
 * Returns parsed intent, slots, and suggested tool.
 */
router.post('/parse-command', (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ ok: false, error: 'Missing required field: text' });

  try {
    const result = parseNaturalCommand(text);
    res.json(result);
  } catch (error) {
    console.error('[farm-ops-agent] parse-command error:', error.message);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ============================================================================
// 4. Audit Log
// ============================================================================

/**
 * GET /audit-log — paginated audit trail
 * Query: page (default 1), per_page (default 50), tool (optional filter)
 */
router.get('/audit-log', (req, res) => {
  try {
    let log = loadAuditLog();
    if (req.query.tool) {
      log = log.filter(e => e.tool === req.query.tool);
    }
    const perPage = Math.min(parseInt(req.query.per_page || '50', 10), 200);
    const page = parseInt(req.query.page || '1', 10);
    const start = (page - 1) * perPage;
    const paged = log.slice(start, start + perPage);
    res.json({
      ok: true,
      total: log.length,
      page,
      per_page: perPage,
      entries: paged
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * Execute a tool programmatically (used by assistant-chat.js).
 * Skips HTTP layer — calls handler directly with audit logging.
 */
export async function executeTool(toolName, params = {}) {
  const toolDef = TOOL_CATALOG[toolName];
  if (!toolDef) return { ok: false, error: `Unknown tool: ${toolName}` };

  // Validate required params
  const missing = toolDef.required.filter(slot => params[slot] == null);
  if (missing.length > 0) return { ok: false, error: `Missing: ${missing.join(', ')}` };

  const result = await toolDef.handler(params);

  // Audit
  appendAuditEntry({
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    tool: toolName,
    category: toolDef.category,
    params: toolDef.category === 'read' ? {} : params,
    success: true,
    source: 'assistant-chat'
  });

  // Clean undo state from response
  if (result?._undo_state) delete result._undo_state;

  return result;
}

export default router;
