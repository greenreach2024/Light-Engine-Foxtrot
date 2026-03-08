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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '..', 'public', 'data');

const router = express.Router();

// ============================================================================
// Helpers
// ============================================================================

function readJSON(filename, fallback = null) {
  try {
    const filePath = path.join(DATA_DIR, filename);
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJSON(filename, data) {
  const filePath = path.join(DATA_DIR, filename);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
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
  const seenAlertKeys = new Set();
  for (const alert of alertArr) {
    if (alert.resolved || alert.dismissed) continue;
    const severity = (alert.severity || alert.level || 'info').toLowerCase();
    if (severity === 'info') continue;

    // Deduplicate alerts with the same type + key details
    const d = (alert.details && typeof alert.details === 'object') ? alert.details : {};
    const dedupKey = `${alert.type || ''}-${d.sku_id || ''}-${d.error || ''}-${d.message || ''}-${d.farm_id || ''}-${d.sub_order_id || ''}`;
    if (seenAlertKeys.has(dedupKey)) continue;
    seenAlertKeys.add(dedupKey);

    // Build a specific, actionable title from alert type + details
    const details = d;
    const alertTypeLabels = {
      overselling_detected: details.sku_id
        ? `Overselling: ${details.sku_id} (oversold by ${details.oversold_by || '?'})`
        : 'Inventory overselling detected',
      reservation_conflict: details.sku_id
        ? `Inventory conflict: ${details.sku_id} — need ${details.requested || '?'}, have ${details.available || '?'}`
        : 'Inventory reservation conflict',
      payment_failure: `Payment failed${details.buyer_email ? ` for ${details.buyer_email}` : ''}${details.error ? `: ${details.error}` : ''}`,
      notification_failure: `Notification failed${details.error ? `: ${details.error}` : ''}`,
      farm_offline: `Farm offline${details.farm_id ? ` (${details.farm_id})` : ''}`,
      deadline_missed: `Deadline missed${details.sub_order_id ? ` — order ${details.sub_order_id}` : ''}`
    };
    const alertTitle = alert.title || alert.message
      || alertTypeLabels[alert.type]
      || details.message
      || `${severity} alert`;

    // Build a human-readable 'why' string — never pass raw objects to the client
    let alertWhy = alert.description;
    if (!alertWhy) {
      if (typeof alert.details === 'string') {
        alertWhy = alert.details;
      } else if (details.message) {
        alertWhy = details.message;
        if (details.sku_id) alertWhy += ` (${details.sku_id})`;
      } else {
        // Summarize key details as a readable string
        const parts = [];
        if (details.sku_id) parts.push(`SKU: ${details.sku_id}`);
        if (details.error) parts.push(details.error);
        if (details.farm_id) parts.push(`Farm: ${details.farm_id}`);
        if (details.sub_order_id) parts.push(`Order: ${details.sub_order_id}`);
        alertWhy = parts.length ? parts.join(' — ') : 'System alert requires attention';
      }
    }

    // Build specific actions based on alert type
    const alertActions = {
      overselling_detected: ['Check inventory levels', 'Adjust reservations', 'Contact affected buyers'],
      reservation_conflict: ['Review available stock', 'Update inventory', 'Adjust order quantities'],
      payment_failure: ['Retry payment', 'Contact buyer', 'Review order'],
      notification_failure: ['Check notification service', 'Verify API credentials', 'Retry notification'],
      farm_offline: ['Check network connectivity', 'Verify farm API status', 'Restart services'],
      deadline_missed: ['Review order timeline', 'Contact buyer', 'Update delivery estimate']
    };

    tasks.push({
      id: `alert-${alert.id || crypto.randomUUID().slice(0, 8)}`,
      category: 'anomaly',
      title: alertTitle,
      why: alertWhy,
      deadline: today,
      estimated_minutes: 15,
      actions: alertActions[alert.type] || ['Investigate', 'Acknowledge alert', 'Check sensor'],
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
  const targets = targetRanges.targets || targetRanges;

  for (const room of roomList) {
    const roomId = room.id || room.room_id;
    const envData = envCache[roomId] || envCache[room.name];
    const roomTargets = targets[roomId] || targets[room.name];
    if (!envData || !roomTargets) continue;

    const checks = [
      { metric: 'temperature', value: envData.temperature || envData.temp, min: roomTargets.temp_min, max: roomTargets.temp_max, unit: '°F' },
      { metric: 'humidity', value: envData.humidity || envData.rh, min: roomTargets.rh_min, max: roomTargets.rh_max, unit: '%' },
      { metric: 'co2', value: envData.co2, min: roomTargets.co2_min, max: roomTargets.co2_max, unit: 'ppm' }
    ];

    for (const chk of checks) {
      if (chk.value == null || chk.min == null || chk.max == null) continue;
      const drift = chk.value < chk.min ? chk.min - chk.value : chk.value > chk.max ? chk.value - chk.max : 0;
      if (drift <= 0) continue;

      const range = chk.max - chk.min;
      const driftPct = range > 0 ? drift / range : 0.5;

      tasks.push({
        id: `env-drift-${roomId}-${chk.metric}`,
        category: 'environment',
        title: `${chk.metric} out of range in ${room.name || roomId}`,
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
const TOOL_CATALOG = {
  // --- Read tools ---
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
      return {
        ok: true,
        room,
        environment: envCache[room_id] || null,
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
  'auto_assign_devices': {
    description: 'Auto-assign unassigned IoT devices to rooms/zones based on type and availability',
    category: 'write',
    required: [],
    optional: ['room_id'],
    undoable: true,
    handler: async ({ room_id }) => {
      const deviceMeta = readJSON('device-meta.json', {});
      const rooms = readJSON('rooms.json', {});
      const roomList = rooms.rooms || Object.values(rooms).filter(r => typeof r === 'object');

      // Snapshot for undo
      const previousAssignments = {};
      const assignments = [];
      const unassigned = Object.entries(deviceMeta).filter(([_, d]) => !d.room_id);

      if (unassigned.length === 0) {
        return { ok: true, assigned: 0, message: 'All devices are already assigned.' };
      }

      // Simple round-robin assignment: assign to rooms that have fewest devices
      const roomDeviceCounts = {};
      for (const r of roomList) {
        const rid = r.id || r.room_id;
        if (room_id && rid !== room_id) continue;
        roomDeviceCounts[rid] = Object.values(deviceMeta).filter(d => d.room_id === rid).length;
      }

      const availableRooms = Object.keys(roomDeviceCounts);
      if (availableRooms.length === 0) {
        return { ok: true, assigned: 0, message: 'No rooms available for assignment.' };
      }

      for (const [deviceId, device] of unassigned) {
        // Pick room with fewest devices
        availableRooms.sort((a, b) => (roomDeviceCounts[a] || 0) - (roomDeviceCounts[b] || 0));
        const targetRoom = availableRooms[0];
        previousAssignments[deviceId] = { room_id: device.room_id, zone: device.zone };
        device.room_id = targetRoom;
        device.zone = 'zone-1';
        device.assigned_at = new Date().toISOString();
        device.assigned_by = 'farm-ops-agent';
        roomDeviceCounts[targetRoom] = (roomDeviceCounts[targetRoom] || 0) + 1;
        assignments.push({ device_id: deviceId, room_id: targetRoom, zone: 'zone-1', device_type: device.type || device.protocol || 'unknown' });
      }

      writeJSON('device-meta.json', deviceMeta);
      return { ok: true, assigned: assignments.length, assignments, _undo_state: previousAssignments };
    },
    undoHandler: async (params, previousAssignments) => {
      const deviceMeta = readJSON('device-meta.json', {});
      let undone = 0;
      for (const [deviceId, prev] of Object.entries(previousAssignments)) {
        if (deviceMeta[deviceId]) {
          deviceMeta[deviceId].room_id = prev.room_id || undefined;
          deviceMeta[deviceId].zone = prev.zone || undefined;
          delete deviceMeta[deviceId].assigned_at;
          delete deviceMeta[deviceId].assigned_by;
          undone++;
        }
      }
      writeJSON('device-meta.json', deviceMeta);
      return { ok: true, undone, message: `Reverted ${undone} device assignment(s)` };
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
  }
};

// Idempotency cache: key → { result, created_at }
const idempotencyCache = new Map();
const IDEMPOTENCY_TTL_MS = 30 * 60 * 1000; // 30 minutes

// Undo history: stores last N write operations with undo state
const undoHistory = [];
const MAX_UNDO_HISTORY = 50;

// Audit log (in-memory, persisted to file on each write)
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
  fs.writeFileSync(AUDIT_LOG_PATH, JSON.stringify(trimmed, null, 2));
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
  seed_window: ['seed', 'plant', 'sow', 'planting', 'succession', 'schedule'],
  seed_benchmarks: ['benchmark', 'benchmarks', 'import', 'crop', 'yield', 'baseline'],
  undo_last: ['undo', 'revert', 'rollback', 'takeback']
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

export default router;
