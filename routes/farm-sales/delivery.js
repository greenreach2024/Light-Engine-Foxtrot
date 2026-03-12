/**
 * Farm Sales - Delivery Management
 * Route planning and delivery scheduling for D2C orders (MULTI-TENANT)
 */

import express from 'express';
import { farmAuthMiddleware } from '../../lib/farm-auth.js';
import { wholesaleAuthMiddleware } from '../../lib/wholesale-auth.js';
import { farmStores } from '../../lib/farm-store.js';
import { query, isDatabaseEnabled, transaction } from '../../lib/database.js';

const router = express.Router();

// ─── Feature Flag: DELIVERY_ENABLED ────────────────────────────────────
// Set DELIVERY_ENABLED=false to disable all delivery endpoints.
// Default: true (enabled). When disabled, all routes return 503.
router.use((req, res, next) => {
  if (process.env.DELIVERY_ENABLED === 'false') {
    return res.status(503).json({
      ok: false,
      error: 'delivery_disabled',
      message: 'Delivery service is not enabled for this environment'
    });
  }
  next();
});

function deliveryAuthMiddleware(req, res, next) {
  const farmIdHeader = req.headers['x-farm-id'];
  let apiKeyHeader = req.headers['x-api-key'];

  if (!apiKeyHeader && farmIdHeader && typeof req.headers.authorization === 'string' && req.headers.authorization.startsWith('Bearer ')) {
    apiKeyHeader = req.headers.authorization.slice('Bearer '.length).trim();
    if (apiKeyHeader) {
      req.headers['x-api-key'] = apiKeyHeader;
    }
  }

  if (farmIdHeader && apiKeyHeader) {
    return wholesaleAuthMiddleware(req, res, next);
  }

  return farmAuthMiddleware(req, res, next);
}

// Apply authentication to all routes
router.use(deliveryAuthMiddleware);

// In-memory route storage (shared Map, tenant-isolated via farm_id on each record)
const routes = new Map();

/**
 * Delivery time windows (configurable by farm)
 */
const TIME_WINDOWS = {
  MORNING: { id: 'morning', label: 'Morning (8am-12pm)', start: '08:00', end: '12:00' },
  AFTERNOON: { id: 'afternoon', label: 'Afternoon (12pm-4pm)', start: '12:00', end: '16:00' },
  EVENING: { id: 'evening', label: 'Evening (4pm-8pm)', start: '16:00', end: '20:00' }
};

/**
 * Delivery zones (would be configured per farm's service area)
 */
const DELIVERY_ZONES = {
  ZONE_A: { id: 'zone_a', name: 'Downtown', fee: 8, min_order: 25 },
  ZONE_B: { id: 'zone_b', name: 'Suburbs', fee: 8, min_order: 35 },
  ZONE_C: { id: 'zone_c', name: 'Rural', fee: 12, min_order: 50 }
};

// Farm-scoped MVP settings (in-memory fallback; PostgreSQL primary when DB_ENABLED)
const deliverySettingsByFarm = new Map();
const deliveryWindowsByFarm = new Map();

function generateEntityId(prefix = 'ENT') {
  const now = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `${prefix}-${now}${rand}`;
}

function parseCoordinates(input) {
  if (!input) return null;

  if (Array.isArray(input) && input.length >= 2) {
    const latitude = Number(input[0]);
    const longitude = Number(input[1]);
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      return { latitude, longitude };
    }
  }

  const latitude = Number(input.latitude ?? input.lat);
  const longitude = Number(input.longitude ?? input.lng ?? input.lon);
  if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
    return { latitude, longitude };
  }

  return null;
}

function getDeliveryCoordinates(delivery) {
  return parseCoordinates(delivery?.address?.coordinates) ||
    parseCoordinates(delivery?.address?.location) ||
    parseCoordinates(delivery?.address);
}

function haversineMiles(a, b) {
  if (!a || !b) return null;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const earthRadiusMiles = 3958.8;

  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);

  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return earthRadiusMiles * c;
}

function nearestNeighborSequence(deliveries, origin = null) {
  if (!Array.isArray(deliveries) || deliveries.length <= 1) {
    return deliveries || [];
  }

  const withCoords = [];
  const withoutCoords = [];

  deliveries.forEach((delivery) => {
    const coords = getDeliveryCoordinates(delivery);
    if (coords) {
      withCoords.push({ delivery, coords });
    } else {
      withoutCoords.push(delivery);
    }
  });

  if (withCoords.length <= 1) {
    return [...deliveries];
  }

  const route = [];
  const remaining = [...withCoords];
  let currentPoint = parseCoordinates(origin) || remaining[0].coords;

  while (remaining.length > 0) {
    let nextIndex = 0;
    let nextDistance = Infinity;

    for (let index = 0; index < remaining.length; index += 1) {
      const candidateDistance = haversineMiles(currentPoint, remaining[index].coords);
      if (candidateDistance !== null && candidateDistance < nextDistance) {
        nextDistance = candidateDistance;
        nextIndex = index;
      }
    }

    const [selected] = remaining.splice(nextIndex, 1);
    route.push(selected.delivery);
    currentPoint = selected.coords;
  }

  return [...route, ...withoutCoords];
}

function estimateRouteDistanceMiles(stops, origin = null) {
  if (!Array.isArray(stops) || stops.length === 0) return 0;

  let miles = 0;
  let previous = parseCoordinates(origin);
  for (const stop of stops) {
    const coords = getDeliveryCoordinates(stop);
    if (previous && coords) {
      miles += haversineMiles(previous, coords) || 0;
    }
    if (coords) previous = coords;
  }
  return Number(miles.toFixed(2));
}

function estimateRouteDurationMinutes(stops, options = {}) {
  const averageMph = Math.max(5, Number(options.averageMph || 25));
  const stopServiceMinutes = Math.max(1, Number(options.stopServiceMinutes || 8));
  const travelMinutes = Math.round((estimateRouteDistanceMiles(stops, options.origin) / averageMph) * 60);
  return Math.max(
    stops.length * stopServiceMinutes,
    travelMinutes + stops.length * Math.max(1, stopServiceMinutes - 2)
  );
}

function toDeliveryFromRow(row) {
  const payload = row?.payload || {};
  return {
    ...payload,
    delivery_id: row.delivery_id,
    order_id: row.order_id,
    delivery_date: row.delivery_date,
    time_slot: row.time_slot,
    zone: payload.zone || { id: row.zone_id },
    route_id: row.route_id,
    driver: payload.driver || (row.driver_id ? { id: row.driver_id } : null),
    status: row.status,
    delivery_fee: Number(row.delivery_fee || payload.delivery_fee || 0),
    tip_amount: Number(row.tip_amount || payload.tip_amount || 0),
    driver_payout_amount: Number(row.driver_payout_amount || payload.driver_payout_amount || 0),
    platform_margin: Number(row.platform_margin || payload.platform_margin || 0),
    instructions: row.instructions,
    address: row.address || payload.address,
    contact: row.contact || payload.contact,
    timestamps: {
      ...(payload.timestamps || {}),
      updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : payload.timestamps?.updated_at
    }
  };
}

function toRouteFromRow(row) {
  const payload = row?.payload || {};
  return {
    ...payload,
    route_id: row.route_id,
    farm_id: row.farm_id,
    date: row.route_date,
    time_slot: row.time_slot,
    zone: row.zone_id,
    status: row.status,
    created_at: row.created_at ? new Date(row.created_at).toISOString() : payload.created_at,
    updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : payload.updated_at
  };
}

async function insertDeliveryRecord(farmId, delivery, dbClient = null) {
  if (!isDatabaseEnabled()) {
    farmStores.deliveries.set(farmId, delivery.delivery_id, delivery);
    return;
  }
  const executor = dbClient || { query };
  await executor.query(
    `INSERT INTO delivery_orders (
      farm_id, delivery_id, order_id, delivery_date, time_slot, zone_id,
      route_id, driver_id, status, address, contact, instructions,
      delivery_fee, tip_amount, driver_payout_amount, platform_margin,
      payload, created_at, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6,
      $7, $8, $9, $10::jsonb, $11::jsonb, $12,
      $13, $14, $15, $16,
      $17::jsonb, NOW(), NOW()
    )`,
    [
      farmId,
      delivery.delivery_id,
      delivery.order_id,
      delivery.delivery_date,
      delivery.time_slot,
      delivery.zone?.id || null,
      delivery.route_id || null,
      delivery.driver?.id || null,
      delivery.status || 'scheduled',
      JSON.stringify(delivery.address || {}),
      JSON.stringify(delivery.contact || {}),
      delivery.instructions || null,
      Number(delivery.delivery_fee || 0),
      Number(delivery.tip_amount || 0),
      Number(delivery.driver_payout_amount || 0),
      Number(delivery.platform_margin || 0),
      JSON.stringify(delivery)
    ]
  );
}

async function getDeliveryRecord(farmId, deliveryId, dbClient = null) {
  if (!isDatabaseEnabled()) {
    return farmStores.deliveries.get(farmId, deliveryId) || null;
  }
  const executor = dbClient || { query };
  const result = await executor.query(
    'SELECT * FROM delivery_orders WHERE farm_id = $1 AND delivery_id = $2 LIMIT 1',
    [farmId, deliveryId]
  );
  if (!result.rows.length) return null;
  return toDeliveryFromRow(result.rows[0]);
}

async function updateDeliveryRecord(farmId, deliveryId, delivery, dbClient = null) {
  if (!isDatabaseEnabled()) {
    farmStores.deliveries.set(farmId, deliveryId, delivery);
    return;
  }
  const executor = dbClient || { query };
  await executor.query(
    `UPDATE delivery_orders
     SET route_id = $3,
         driver_id = $4,
         status = $5,
         address = $6::jsonb,
         contact = $7::jsonb,
         instructions = $8,
       delivery_fee = $9,
       tip_amount = $10,
       driver_payout_amount = $11,
       platform_margin = $12,
       payload = $13::jsonb,
         updated_at = NOW()
     WHERE farm_id = $1 AND delivery_id = $2`,
    [
      farmId,
      deliveryId,
      delivery.route_id || null,
      delivery.driver?.id || null,
      delivery.status || 'scheduled',
      JSON.stringify(delivery.address || {}),
      JSON.stringify(delivery.contact || {}),
      delivery.instructions || null,
      Number(delivery.delivery_fee || 0),
      Number(delivery.tip_amount || 0),
      Number(delivery.driver_payout_amount || 0),
      Number(delivery.platform_margin || 0),
      JSON.stringify(delivery)
    ]
  );
}

async function ensureDriverPayoutForDelivery(farmId, delivery, dbClient = null) {
  if (!isDatabaseEnabled()) return null;
  const executor = dbClient || { query };
  const driverId = delivery?.driver?.id || null;
  if (!driverId) return null;

  const existing = await executor.query(
    `SELECT id FROM driver_payouts
      WHERE farm_id = $1 AND delivery_id = $2
      LIMIT 1`,
    [farmId, delivery.delivery_id]
  );
  if (existing.rows.length > 0) {
    return { created: false, payout_id: existing.rows[0].id };
  }

  const driverResult = await executor.query(
    `SELECT pay_per_delivery, cold_chain_bonus, cold_chain_certified
       FROM delivery_drivers
      WHERE farm_id = $1 AND driver_id = $2
      LIMIT 1`,
    [farmId, driverId]
  );
  if (!driverResult.rows.length) {
    return null;
  }

  const driver = driverResult.rows[0];
  const baseAmount = Number(driver.pay_per_delivery || 0);
  const coldBonus = Boolean(driver.cold_chain_certified) ? Number(driver.cold_chain_bonus || 0) : 0;
  const tipAmount = Number(delivery.tip_amount || 0);
  const totalPayout = baseAmount + coldBonus + tipAmount;

  const deliveryFee = Number(delivery.delivery_fee || 0);
  const platformMargin = deliveryFee - baseAmount - coldBonus;
  delivery.driver_payout_amount = baseAmount + coldBonus;
  delivery.platform_margin = platformMargin;

  const insertResult = await executor.query(
    `INSERT INTO driver_payouts (
       farm_id, driver_id, delivery_id, order_id,
       base_amount, cold_chain_bonus, tip_amount, total_payout,
       payout_status, created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4,
       $5, $6, $7, $8,
       'pending', NOW(), NOW()
     ) RETURNING id`,
    [
      farmId,
      driverId,
      delivery.delivery_id,
      delivery.order_id || null,
      baseAmount,
      coldBonus,
      tipAmount,
      totalPayout
    ]
  );

  return { created: true, payout_id: insertResult.rows[0]?.id || null };
}

async function listDeliveriesForSlot(farmId, date, timeSlot, dbClient = null) {
  if (!isDatabaseEnabled()) {
    return farmStores.deliveries.getAllForFarm(farmId)
      .filter(d => d.delivery_date === date && d.time_slot === timeSlot);
  }
  const executor = dbClient || { query };
  const result = await executor.query(
    `SELECT *
       FROM delivery_orders
      WHERE farm_id = $1
        AND delivery_date = $2
        AND time_slot = $3`,
    [farmId, date, timeSlot]
  );
  return result.rows.map(toDeliveryFromRow);
}

async function listUnassignedScheduledDeliveries(farmId, date, timeSlot, dbClient = null) {
  if (!isDatabaseEnabled()) {
    return farmStores.deliveries.getAllForFarm(farmId)
      .filter(d => d.delivery_date === date && d.time_slot === timeSlot && d.status === 'scheduled' && !d.route_id);
  }
  const executor = dbClient || { query };
  const result = await executor.query(
    `SELECT *
       FROM delivery_orders
      WHERE farm_id = $1
        AND delivery_date = $2
        AND time_slot = $3
        AND status = 'scheduled'
        AND route_id IS NULL
      ORDER BY created_at ASC`,
    [farmId, date, timeSlot]
  );
  return result.rows.map(toDeliveryFromRow);
}

async function insertRouteRecord(route, dbClient = null) {
  if (!isDatabaseEnabled()) {
    routes.set(route.route_id, route);
    return;
  }
  const executor = dbClient || { query };
  await executor.query(
    `INSERT INTO delivery_routes (
      farm_id, route_id, route_date, time_slot, zone_id, status, payload, created_at, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7::jsonb, NOW(), NOW()
    )`,
    [
      route.farm_id,
      route.route_id,
      route.date,
      route.time_slot,
      route.zone,
      route.status,
      JSON.stringify(route)
    ]
  );
}

async function listRoutesForFarm(farmId, filters = {}, dbClient = null) {
  if (!isDatabaseEnabled()) {
    let filtered = Array.from(routes.values()).filter(r => r.farm_id === farmId);
    if (filters.date) filtered = filtered.filter(r => r.date === filters.date);
    if (filters.time_slot) filtered = filtered.filter(r => r.time_slot === filters.time_slot);
    if (filters.status) filtered = filtered.filter(r => r.status === filters.status);
    return filtered;
  }
  const executor = dbClient || { query };
  const values = [farmId];
  const clauses = ['farm_id = $1'];

  if (filters.date) {
    values.push(filters.date);
    clauses.push(`route_date = $${values.length}`);
  }
  if (filters.time_slot) {
    values.push(filters.time_slot);
    clauses.push(`time_slot = $${values.length}`);
  }
  if (filters.status) {
    values.push(filters.status);
    clauses.push(`status = $${values.length}`);
  }

  const result = await executor.query(
    `SELECT * FROM delivery_routes WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC`,
    values
  );
  return result.rows.map(toRouteFromRow);
}

function getDefaultDeliverySettings() {
  return {
    enabled: false,
    base_fee: 8,
    min_order: 25,
    lead_time_hours: 24,
    max_deliveries_per_window: 20,
    updated_at: new Date().toISOString()
  };
}

/**
 * Get delivery settings for a farm (DB-first, in-memory fallback)
 */
async function getFarmDeliverySettings(farmId, dbClient = null) {
  const executor = dbClient || { query };
  if (isDatabaseEnabled()) {
    try {
      const result = await executor.query(
        'SELECT * FROM farm_delivery_settings WHERE farm_id = $1',
        [farmId]
      );
      if (result.rows.length > 0) {
        const row = result.rows[0];
        return {
          enabled: row.enabled,
          base_fee: Number(row.base_fee),
          min_order: Number(row.min_order),
          lead_time_hours: row.lead_time_hours,
          max_deliveries_per_window: row.max_deliveries_per_window,
          updated_at: row.updated_at?.toISOString() || new Date().toISOString()
        };
      }
    } catch (err) {
      console.warn('[farm-sales] DB settings read failed, using in-memory:', err.message);
    }
  }
  // Fallback to in-memory
  if (!deliverySettingsByFarm.has(farmId)) {
    deliverySettingsByFarm.set(farmId, getDefaultDeliverySettings());
  }
  return deliverySettingsByFarm.get(farmId);
}

/**
 * Save delivery settings for a farm (upsert to DB + update in-memory)
 */
async function saveFarmDeliverySettings(farmId, settings, dbClient = null) {
  const executor = dbClient || { query };
  // Always update in-memory
  deliverySettingsByFarm.set(farmId, settings);

  if (isDatabaseEnabled()) {
    try {
      await executor.query(
        `INSERT INTO farm_delivery_settings (farm_id, enabled, base_fee, min_order, lead_time_hours, max_deliveries_per_window, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (farm_id) DO UPDATE SET
           enabled = EXCLUDED.enabled,
           base_fee = EXCLUDED.base_fee,
           min_order = EXCLUDED.min_order,
           lead_time_hours = EXCLUDED.lead_time_hours,
           max_deliveries_per_window = EXCLUDED.max_deliveries_per_window,
           updated_at = NOW()`,
        [farmId, settings.enabled, settings.base_fee, settings.min_order, settings.lead_time_hours, settings.max_deliveries_per_window]
      );
    } catch (err) {
      console.warn('[farm-sales] DB settings write failed, in-memory only:', err.message);
    }
  }
}

function getDefaultDeliveryWindows() {
  return Object.values(TIME_WINDOWS).map((window) => ({
    ...window,
    active: true
  }));
}

/**
 * Get delivery windows for a farm (DB-first, in-memory fallback)
 */
async function getFarmDeliveryWindows(farmId, dbClient = null) {
  const executor = dbClient || { query };
  if (isDatabaseEnabled()) {
    try {
      const result = await executor.query(
        'SELECT * FROM farm_delivery_windows WHERE farm_id = $1 ORDER BY window_id',
        [farmId]
      );
      if (result.rows.length > 0) {
        return result.rows.map(row => ({
          id: row.window_id,
          label: row.label,
          start: row.start_time,
          end: row.end_time,
          active: row.active
        }));
      }
    } catch (err) {
      console.warn('[farm-sales] DB windows read failed, using in-memory:', err.message);
    }
  }
  // Fallback to in-memory
  if (!deliveryWindowsByFarm.has(farmId)) {
    deliveryWindowsByFarm.set(farmId, getDefaultDeliveryWindows());
  }
  return deliveryWindowsByFarm.get(farmId);
}

/**
 * Save delivery windows for a farm (upsert to DB + update in-memory)
 */
async function saveFarmDeliveryWindows(farmId, windows, dbClient = null) {
  const executor = dbClient || { query };
  // Always update in-memory
  deliveryWindowsByFarm.set(farmId, windows);

  if (isDatabaseEnabled()) {
    try {
      for (const w of windows) {
        await executor.query(
          `INSERT INTO farm_delivery_windows (farm_id, window_id, label, start_time, end_time, active, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW())
           ON CONFLICT (farm_id, window_id) DO UPDATE SET
             label = EXCLUDED.label,
             start_time = EXCLUDED.start_time,
             end_time = EXCLUDED.end_time,
             active = EXCLUDED.active,
             updated_at = NOW()`,
          [farmId, w.id, w.label, w.start, w.end, w.active]
        );
      }
    } catch (err) {
      console.warn('[farm-sales] DB windows write failed, in-memory only:', err.message);
    }
  }
}

function normalizeWindowsInput(input = []) {
  if (!Array.isArray(input)) return null;
  const allowedIds = new Set(Object.values(TIME_WINDOWS).map((w) => w.id));

  const normalized = input
    .map((item) => ({
      id: String(item.id || '').trim(),
      active: item.active !== false
    }))
    .filter((item) => allowedIds.has(item.id));

  if (!normalized.length) return null;

  const byId = new Map(normalized.map((w) => [w.id, w.active]));
  return Object.values(TIME_WINDOWS).map((window) => ({
    ...window,
    active: byId.has(window.id) ? byId.get(window.id) : true
  }));
}

/**
 * Compute window availability for a given farm/date/zone.
 * Extracted from the GET /windows handler so it can be called directly
 * (eliminates the self-fetch anti-pattern identified in audit F-9).
 *
 * @param {string} farmId
 * @param {string} date  - YYYY-MM-DD
 * @param {string} [zone] - optional zone ID
 * @returns {{ ok: boolean, windows: Array, error?: string }}
 */
async function getWindowAvailability(farmId, date, zone, dbClient = null) {
  const deliveryDate = new Date(date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (deliveryDate < today) {
    return { ok: false, windows: [], error: 'invalid_date' };
  }

  const settings = await getFarmDeliverySettings(farmId, dbClient);
  const configuredWindows = await getFarmDeliveryWindows(farmId, dbClient);
  const activeWindows = configuredWindows.filter((w) => w.active);
  const effectiveWindowTemplates = activeWindows.length
    ? activeWindows
    : configuredWindows;

  let existingDeliveries = [];
  if (isDatabaseEnabled()) {
    const executor = dbClient || { query };
    const result = await executor.query(
      `SELECT *
         FROM delivery_orders
        WHERE farm_id = $1
          AND delivery_date = $2
          AND status IN ('scheduled', 'assigned', 'en_route')`,
      [farmId, date]
    );
    existingDeliveries = result.rows.map(toDeliveryFromRow);
  } else {
    existingDeliveries = farmStores.deliveries.getAllForFarm(farmId)
      .filter(d => d.delivery_date === date);
  }

  const windows = effectiveWindowTemplates.map(window => {
    const windowDeliveries = existingDeliveries.filter(d => d.time_slot === window.id);
    const capacity = Number(settings.max_deliveries_per_window || 20);
    const available = capacity - windowDeliveries.length;

    return {
      ...window,
      available: available > 0,
      slots_remaining: available,
      total_capacity: capacity
    };
  });

  return {
    ok: true,
    farm_id: farmId,
    date,
    zone: zone ? DELIVERY_ZONES[zone.toUpperCase()] : null,
    windows
  };
}

/**
 * GET /api/farm-sales/delivery/windows
 * Get available delivery windows for a date
 * 
 * Query params:
 * - date: YYYY-MM-DD
 * - zone: Delivery zone ID
 */
router.get('/windows', async (req, res) => {
  try {
    const { date, zone } = req.query;
    const farmId = req.farm_id;

    // Config mode (MVP): return farm-scoped delivery window settings
    if (!date) {
      return res.json({
        ok: true,
        farm_id: farmId,
        windows: await getFarmDeliveryWindows(farmId)
      });
    }

    const result = await getWindowAvailability(farmId, date, zone);
    if (!result.ok) {
      return res.status(400).json({
        ok: false,
        error: result.error,
        message: result.error === 'invalid_date' ? 'Cannot schedule delivery in the past' : result.error
      });
    }

    res.json(result);

  } catch (error) {
    console.error('[farm-sales] Delivery windows failed:', error);
    res.status(500).json({
      ok: false,
      error: 'windows_failed',
      message: error.message
    });
  }
});

/**
 * PUT /api/farm-sales/delivery/windows
 * Update active delivery windows for farm
 */
router.put('/windows', async (req, res) => {
  try {
    const farmId = req.farm_id;
    const normalized = normalizeWindowsInput(req.body?.windows);

    if (!normalized) {
      return res.status(400).json({
        ok: false,
        error: 'invalid_windows',
        message: 'windows must be a non-empty array with valid window IDs'
      });
    }

    await saveFarmDeliveryWindows(farmId, normalized);

    return res.json({
      ok: true,
      farm_id: farmId,
      windows: normalized,
      updated_at: new Date().toISOString()
    });
  } catch (error) {
    console.error('[farm-sales] Delivery windows update failed:', error);
    return res.status(500).json({
      ok: false,
      error: 'windows_update_failed',
      message: error.message
    });
  }
});

/**
 * GET /api/farm-sales/delivery/settings
 * Get farm-scoped delivery settings
 */
router.get('/settings', async (req, res) => {
  try {
    const farmId = req.farm_id;
    return res.json({
      ok: true,
      farm_id: farmId,
      settings: await getFarmDeliverySettings(farmId)
    });
  } catch (error) {
    console.error('[farm-sales] Delivery settings get failed:', error);
    return res.status(500).json({
      ok: false,
      error: 'settings_get_failed',
      message: error.message
    });
  }
});

/**
 * PUT /api/farm-sales/delivery/settings
 * Update farm-scoped delivery settings
 */
router.put('/settings', async (req, res) => {
  try {
    const farmId = req.farm_id;
    const current = await getFarmDeliverySettings(farmId);
    const incoming = req.body || {};

    const next = {
      ...current,
      enabled: incoming.enabled === undefined ? current.enabled : Boolean(incoming.enabled),
      base_fee: incoming.base_fee === undefined ? current.base_fee : Math.max(0, Number(incoming.base_fee) || 0),
      min_order: incoming.min_order === undefined ? current.min_order : Math.max(0, Number(incoming.min_order) || 0),
      lead_time_hours: incoming.lead_time_hours === undefined ? current.lead_time_hours : Math.max(0, Number(incoming.lead_time_hours) || 0),
      max_deliveries_per_window:
        incoming.max_deliveries_per_window === undefined
          ? current.max_deliveries_per_window
          : Math.max(1, Number(incoming.max_deliveries_per_window) || 1),
      updated_at: new Date().toISOString()
    };

    await saveFarmDeliverySettings(farmId, next);

    return res.json({
      ok: true,
      farm_id: farmId,
      settings: next
    });
  } catch (error) {
    console.error('[farm-sales] Delivery settings update failed:', error);
    return res.status(500).json({
      ok: false,
      error: 'settings_update_failed',
      message: error.message
    });
  }
});

// ─── Zone Configuration API (MVP — postal_prefix only, no PostGIS) ─────────

/**
 * Get farm delivery zones from DB, falling back to hardcoded DELIVERY_ZONES
 */
async function getFarmDeliveryZones(farmId) {
  if (isDatabaseEnabled()) {
    try {
      const result = await query(
        "SELECT * FROM farm_delivery_zones WHERE farm_id = $1 AND status = 'active' ORDER BY zone_id",
        [farmId]
      );
      if (result.rows.length > 0) {
        return result.rows.map(row => ({
          id: row.zone_id,
          name: row.name,
          description: row.description || '',
          fee: Number(row.fee),
          min_order: Number(row.min_order),
          postal_prefix: row.postal_prefix,
          status: row.status
        }));
      }
    } catch (err) {
      console.warn('[farm-sales] DB zones read failed, using defaults:', err.message);
    }
  }
  // Fallback to hardcoded defaults
  return Object.values(DELIVERY_ZONES);
}

/**
 * Find matching zone by postal code (longest prefix match)
 */
async function findMatchingZone(farmId, postalCode) {
  if (!postalCode) return null;
  const cleanPostal = postalCode.toUpperCase().replace(/\s/g, '');

  if (isDatabaseEnabled()) {
    try {
      const result = await query(
        `SELECT zone_id, name, fee, min_order, postal_prefix
         FROM farm_delivery_zones
         WHERE farm_id = $1
           AND status = 'active'
           AND postal_prefix IS NOT NULL
           AND $2 LIKE postal_prefix || '%'
         ORDER BY LENGTH(postal_prefix) DESC
         LIMIT 1`,
        [farmId, cleanPostal]
      );
      if (result.rows.length > 0) {
        const row = result.rows[0];
        return { id: row.zone_id, name: row.name, fee: Number(row.fee), min_order: Number(row.min_order) };
      }
    } catch (err) {
      console.warn('[farm-sales] DB zone match failed:', err.message);
    }
  }
  return null;
}

/**
 * GET /api/farm-sales/delivery/zones
 * List farm's delivery zones
 */
router.get('/zones', async (req, res) => {
  try {
    const farmId = req.farm_id;
    const zones = await getFarmDeliveryZones(farmId);
    return res.json({ ok: true, farm_id: farmId, zones });
  } catch (error) {
    console.error('[farm-sales] Delivery zones list failed:', error);
    return res.status(500).json({ ok: false, error: 'zones_list_failed', message: error.message });
  }
});

/**
 * POST /api/farm-sales/delivery/zones
 * Create a delivery zone for this farm
 */
router.post('/zones', async (req, res) => {
  try {
    const farmId = req.farm_id;
    const { zone_id, name, description, fee, min_order, postal_prefix } = req.body || {};

    if (!zone_id || !name) {
      return res.status(400).json({ ok: false, error: 'zone_id and name are required' });
    }

    const zone = {
      id: zone_id,
      name,
      description: description || '',
      fee: Math.max(0, Number(fee) || 0),
      min_order: Math.max(0, Number(min_order) || 25),
      postal_prefix: postal_prefix || null,
      status: 'active'
    };

    if (isDatabaseEnabled()) {
      try {
        await query(
          `INSERT INTO farm_delivery_zones (farm_id, zone_id, name, description, fee, min_order, postal_prefix, status, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', NOW())
           ON CONFLICT (farm_id, zone_id) DO UPDATE SET
             name = EXCLUDED.name,
             description = EXCLUDED.description,
             fee = EXCLUDED.fee,
             min_order = EXCLUDED.min_order,
             postal_prefix = EXCLUDED.postal_prefix,
             status = 'active',
             updated_at = NOW()`,
          [farmId, zone.id, zone.name, zone.description, zone.fee, zone.min_order, zone.postal_prefix]
        );
      } catch (err) {
        console.error('[farm-sales] DB zone create failed:', err.message);
        return res.status(500).json({ ok: false, error: 'zone_create_failed', message: err.message });
      }
    }

    return res.status(201).json({ ok: true, zone });
  } catch (error) {
    console.error('[farm-sales] Zone creation failed:', error);
    return res.status(500).json({ ok: false, error: 'zone_create_failed', message: error.message });
  }
});

/**
 * PATCH /api/farm-sales/delivery/zones/:zoneId
 * Update a delivery zone
 */
router.patch('/zones/:zoneId', async (req, res) => {
  try {
    const farmId = req.farm_id;
    const { zoneId } = req.params;
    const { name, description, fee, min_order, postal_prefix } = req.body || {};

    if (isDatabaseEnabled()) {
      try {
        const existing = await query(
          'SELECT * FROM farm_delivery_zones WHERE farm_id = $1 AND zone_id = $2',
          [farmId, zoneId]
        );
        if (existing.rows.length === 0) {
          return res.status(404).json({ ok: false, error: 'zone_not_found' });
        }

        const row = existing.rows[0];
        await query(
          `UPDATE farm_delivery_zones SET
            name = $3, description = $4, fee = $5, min_order = $6, postal_prefix = $7, updated_at = NOW()
           WHERE farm_id = $1 AND zone_id = $2`,
          [
            farmId, zoneId,
            name !== undefined ? name : row.name,
            description !== undefined ? description : row.description,
            fee !== undefined ? Math.max(0, Number(fee) || 0) : row.fee,
            min_order !== undefined ? Math.max(0, Number(min_order) || 0) : row.min_order,
            postal_prefix !== undefined ? postal_prefix : row.postal_prefix
          ]
        );

        return res.json({ ok: true, zone_id: zoneId, updated: true });
      } catch (err) {
        console.error('[farm-sales] DB zone update failed:', err.message);
        return res.status(500).json({ ok: false, error: 'zone_update_failed', message: err.message });
      }
    }

    return res.status(503).json({ ok: false, error: 'database_required', message: 'Zone updates require database' });
  } catch (error) {
    console.error('[farm-sales] Zone update failed:', error);
    return res.status(500).json({ ok: false, error: 'zone_update_failed', message: error.message });
  }
});

/**
 * DELETE /api/farm-sales/delivery/zones/:zoneId
 * Soft-deactivate a delivery zone (status = 'inactive')
 */
router.delete('/zones/:zoneId', async (req, res) => {
  try {
    const farmId = req.farm_id;
    const { zoneId } = req.params;

    if (isDatabaseEnabled()) {
      try {
        const result = await query(
          "UPDATE farm_delivery_zones SET status = 'inactive', updated_at = NOW() WHERE farm_id = $1 AND zone_id = $2 RETURNING zone_id",
          [farmId, zoneId]
        );
        if (result.rows.length === 0) {
          return res.status(404).json({ ok: false, error: 'zone_not_found' });
        }
        return res.json({ ok: true, zone_id: zoneId, deactivated: true });
      } catch (err) {
        console.error('[farm-sales] DB zone delete failed:', err.message);
        return res.status(500).json({ ok: false, error: 'zone_delete_failed', message: err.message });
      }
    }

    return res.status(503).json({ ok: false, error: 'database_required', message: 'Zone deletion requires database' });
  } catch (error) {
    console.error('[farm-sales] Zone deletion failed:', error);
    return res.status(500).json({ ok: false, error: 'zone_delete_failed', message: error.message });
  }
});

/**
 * POST /api/farm-sales/delivery/quote
 * Compute a simple delivery quote for current farm
 *
 * CANONICAL FEE MODEL (MVP v2.1.0)
 * ──────────────────────────────────
 *   fee = max(base_fee, zone_fee)
 *     • base_fee  — farm-level default from deliverySettingsByFarm
 *     • zone_fee  — zone-specific fee from DELIVERY_ZONES config
 *   Eligibility checks (in order):
 *     1. settings.enabled must be true
 *     2. requested_window must belong to farm's active windows
 *     3. subtotal >= max(settings.min_order, zone.min_order)
 *   Future (Phase 2): add km/min logging for distance-based pricing.
 */
router.post('/quote', async (req, res) => {
  try {
    const farmId = req.farm_id;
    const { subtotal = 0, zone, requested_window } = req.body || {};
    const settings = await getFarmDeliverySettings(farmId);
    const configuredWindows = await getFarmDeliveryWindows(farmId);
    const activeWindows = configuredWindows.filter((w) => w.active).map((w) => w.id);

    const requestedZone = String(zone || '').trim().toUpperCase();
    // Try DB zones first (by zone_id or postal_prefix), then hardcoded fallback
    let zoneConfig = null;
    if (isDatabaseEnabled()) {
      try {
        // Try exact zone_id match from DB
        const dbResult = await query(
          "SELECT zone_id, name, fee, min_order FROM farm_delivery_zones WHERE farm_id = $1 AND zone_id = $2 AND status = 'active'",
          [farmId, requestedZone]
        );
        if (dbResult.rows.length > 0) {
          const row = dbResult.rows[0];
          zoneConfig = { id: row.zone_id, name: row.name, fee: Number(row.fee), min_order: Number(row.min_order) };
        }
      } catch (err) {
        console.warn('[farm-sales] DB zone lookup failed, using hardcoded:', err.message);
      }
    }
    if (!zoneConfig) {
      zoneConfig = DELIVERY_ZONES[requestedZone] || null;
    }
    const effectiveMinOrder = Math.max(
      Number(settings.min_order || 0),
      Number(zoneConfig?.min_order || 0)
    );
    const baseFee = Number(settings.base_fee || 0);
    const zoneFee = Number(zoneConfig?.fee || 0);
    const fee = Math.max(baseFee, zoneFee);
    const numericSubtotal = Math.max(0, Number(subtotal) || 0);

    if (!settings.enabled) {
      return res.json({
        ok: true,
        eligible: false,
        fee,
        minimum_order: effectiveMinOrder,
        windows: activeWindows,
        reason: 'delivery_disabled'
      });
    }

    if (requested_window && activeWindows.length && !activeWindows.includes(requested_window)) {
      return res.json({
        ok: true,
        eligible: false,
        fee,
        minimum_order: effectiveMinOrder,
        windows: activeWindows,
        reason: 'window_unavailable'
      });
    }

    if (numericSubtotal < effectiveMinOrder) {
      return res.json({
        ok: true,
        eligible: false,
        fee,
        minimum_order: effectiveMinOrder,
        windows: activeWindows,
        reason: 'below_minimum_order'
      });
    }

    return res.json({
      ok: true,
      eligible: true,
      fee,
      minimum_order: effectiveMinOrder,
      windows: activeWindows,
      reason: null
    });
  } catch (error) {
    console.error('[farm-sales] Delivery quote failed:', error);
    return res.status(500).json({
      ok: false,
      error: 'quote_failed',
      message: error.message
    });
  }
});

/**
 * POST /api/farm-sales/delivery/schedule
 * Schedule delivery for order
 * 
 * Body:
 * {
 *   order_id: string,
 *   delivery_date: 'YYYY-MM-DD',
 *   time_slot: 'morning'|'afternoon'|'evening',
 *   address: { street, city, state, zip, coordinates? },
 *   zone: 'zone_a'|'zone_b'|'zone_c',
 *   instructions?: string,
 *   contact: { name, phone }
 * }
 */
router.post('/schedule', async (req, res) => {
  try {
    const { order_id, delivery_date, time_slot, address, zone, instructions, contact, delivery_fee, tip_amount } = req.body;
    const farmId = req.farm_id;

    // Validate required fields
    if (!order_id || !delivery_date || !time_slot || !address || !zone) {
      return res.status(400).json({
        ok: false,
        error: 'missing_required_fields',
        message: 'order_id, delivery_date, time_slot, address, and zone are required'
      });
    }

    const normalizedTimeSlot = String(time_slot || '').trim().toLowerCase();
    const normalizedZone = String(zone || '').trim().toUpperCase();

    // Validate time slot format
    if (!TIME_WINDOWS[normalizedTimeSlot.toUpperCase()]) {
      return res.status(400).json({
        ok: false,
        error: 'invalid_time_slot',
        message: `Time slot must be one of: ${Object.keys(TIME_WINDOWS).join(', ')}`
      });
    }

    // Atomic reservation when DB is enabled; fallback to in-memory path otherwise.
    if (isDatabaseEnabled()) {
      const scheduled = await transaction(async (client) => {
        const lockKey = `delivery-slot:${farmId}:${delivery_date}:${normalizedTimeSlot}`;
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [lockKey]);

        const settings = await getFarmDeliverySettings(farmId, client);
        const configuredWindows = await getFarmDeliveryWindows(farmId, client);
        const activeWindows = configuredWindows.filter((w) => w.active);
        const effectiveWindows = activeWindows.length ? activeWindows : configuredWindows;
        const selectedWindow = effectiveWindows.find((w) => w.id === normalizedTimeSlot);

        if (!selectedWindow) {
          return { error: 'invalid_or_inactive_window' };
        }

        let deliveryZone = null;
        const zoneResult = await client.query(
          `SELECT zone_id, name, description, fee, min_order
             FROM farm_delivery_zones
            WHERE farm_id = $1 AND zone_id = $2 AND status = 'active'
            LIMIT 1`,
          [farmId, normalizedZone]
        );

        if (zoneResult.rows.length) {
          const row = zoneResult.rows[0];
          deliveryZone = {
            id: row.zone_id,
            name: row.name,
            description: row.description || '',
            fee: Number(row.fee),
            min_order: Number(row.min_order)
          };
        } else {
          deliveryZone = DELIVERY_ZONES[normalizedZone] || null;
        }

        if (!deliveryZone) {
          return { error: 'invalid_zone' };
        }

        const currentCountResult = await client.query(
          `SELECT COUNT(*) AS count
             FROM delivery_orders
            WHERE farm_id = $1
              AND delivery_date = $2
              AND time_slot = $3
              AND status IN ('scheduled', 'assigned', 'en_route')`,
          [farmId, delivery_date, normalizedTimeSlot]
        );
        const currentCount = Number(currentCountResult.rows[0]?.count || 0);
        const capacity = Number(settings.max_deliveries_per_window || 20);

        if (currentCount >= capacity) {
          return { error: 'window_unavailable' };
        }

        const deliveryId = generateEntityId('DEL');
        const timestamp = new Date().toISOString();
        const delivery = {
          delivery_id: deliveryId,
          order_id,
          delivery_date,
          time_slot: normalizedTimeSlot,
          window: TIME_WINDOWS[normalizedTimeSlot.toUpperCase()],
          address,
          zone: deliveryZone,
          instructions,
          contact,
          delivery_fee: Math.max(0, Number(delivery_fee ?? deliveryZone.fee ?? 0) || 0),
          tip_amount: Math.max(0, Number(tip_amount || 0) || 0),
          driver_payout_amount: 0,
          platform_margin: 0,
          status: 'scheduled',
          route_id: null,
          driver: null,
          timestamps: {
            scheduled_at: timestamp,
            assigned_at: null,
            dispatched_at: null,
            delivered_at: null,
            updated_at: timestamp
          },
          tracking: {
            status_history: [
              { status: 'scheduled', timestamp }
            ]
          }
        };

        await insertDeliveryRecord(farmId, delivery, client);
        return { delivery, fee: Number(deliveryZone.fee || 0) };
      });

      if (scheduled.error) {
        if (scheduled.error === 'window_unavailable') {
          return res.status(400).json({
            ok: false,
            error: 'window_unavailable',
            message: 'Selected delivery window is full'
          });
        }
        if (scheduled.error === 'invalid_or_inactive_window') {
          return res.status(400).json({
            ok: false,
            error: 'invalid_time_slot',
            message: 'Selected time slot is not active for this farm'
          });
        }
        if (scheduled.error === 'invalid_zone') {
          return res.status(400).json({
            ok: false,
            error: 'invalid_zone',
            message: 'Selected zone is not valid for this farm'
          });
        }
      }

      return res.status(201).json({
        ok: true,
        delivery_id: scheduled.delivery.delivery_id,
        delivery: scheduled.delivery,
        fee: scheduled.fee
      });
    }

    // Non-DB fallback path
    const deliveryZone = DELIVERY_ZONES[normalizedZone];
    if (!deliveryZone) {
      return res.status(400).json({
        ok: false,
        error: 'invalid_zone',
        message: `Zone must be one of: ${Object.keys(DELIVERY_ZONES).join(', ')}`
      });
    }

    const windowData = await getWindowAvailability(farmId, delivery_date, normalizedZone);
    const selectedWindow = windowData.windows?.find(w => w.id === normalizedTimeSlot);
    if (!selectedWindow?.available) {
      return res.status(400).json({
        ok: false,
        error: 'window_unavailable',
        message: 'Selected delivery window is full'
      });
    }

    const deliveryId = farmStores.deliveries.generateId(farmId, 'DEL', 6);
    const timestamp = new Date().toISOString();
    const delivery = {
      delivery_id: deliveryId,
      order_id,
      delivery_date,
      time_slot: normalizedTimeSlot,
      window: TIME_WINDOWS[normalizedTimeSlot.toUpperCase()],
      address,
      zone: deliveryZone,
      instructions,
      contact,
      delivery_fee: Math.max(0, Number(delivery_fee ?? deliveryZone.fee ?? 0) || 0),
      tip_amount: Math.max(0, Number(tip_amount || 0) || 0),
      driver_payout_amount: 0,
      platform_margin: 0,
      status: 'scheduled',
      route_id: null,
      driver: null,
      timestamps: {
        scheduled_at: timestamp,
        assigned_at: null,
        dispatched_at: null,
        delivered_at: null,
        updated_at: timestamp
      },
      tracking: {
        status_history: [
          { status: 'scheduled', timestamp }
        ]
      }
    };

    await insertDeliveryRecord(farmId, delivery);

    res.status(201).json({
      ok: true,
      delivery_id: deliveryId,
      delivery,
      fee: deliveryZone.fee
    });

  } catch (error) {
    console.error('[farm-sales] Delivery scheduling failed:', error);
    res.status(500).json({
      ok: false,
      error: 'schedule_failed',
      message: error.message
    });
  }
});

/**
 * GET /api/farm-sales/delivery/:deliveryId
 * Get delivery status and tracking
 */
router.get('/:deliveryId', async (req, res) => {
  try {
    const { deliveryId } = req.params;
    const farmId = req.farm_id;
    const delivery = await getDeliveryRecord(farmId, deliveryId);

    if (!delivery) {
      return res.status(404).json({
        ok: false,
        error: 'delivery_not_found',
        delivery_id: deliveryId
      });
    }

    return res.json({
      ok: true,
      delivery
    });
  } catch (error) {
    console.error('[farm-sales] Delivery get failed:', error);
    return res.status(500).json({ ok: false, error: 'delivery_get_failed', message: error.message });
  }
});

/**
 * PATCH /api/farm-sales/delivery/:deliveryId
 * Update delivery status
 * 
 * Body:
 * {
 *   status: 'scheduled'|'assigned'|'en_route'|'delivered'|'failed',
 *   driver?: { id, name },
 *   notes?: string
 * }
 */
router.patch('/:deliveryId', async (req, res) => {
  try {
    const { deliveryId } = req.params;
    const { status, driver, notes } = req.body;
    const farmId = req.farm_id;
    const delivery = await getDeliveryRecord(farmId, deliveryId);

    if (!delivery) {
      return res.status(404).json({
        ok: false,
        error: 'delivery_not_found',
        delivery_id: deliveryId
      });
    }

    const timestamp = new Date().toISOString();

    // Update status
    if (status) {
      delivery.status = status;
      delivery.tracking = delivery.tracking || { status_history: [] };
      delivery.tracking.status_history = delivery.tracking.status_history || [];
      delivery.tracking.status_history.push({
        status,
        timestamp,
        notes
      });

      // Update specific timestamps
      if (status === 'assigned' && !delivery.timestamps.assigned_at) {
        delivery.timestamps.assigned_at = timestamp;
      }
      if (status === 'en_route' && !delivery.timestamps.dispatched_at) {
        delivery.timestamps.dispatched_at = timestamp;
      }
      if (status === 'delivered' && !delivery.timestamps.delivered_at) {
        delivery.timestamps.delivered_at = timestamp;
      }
    }

    // Assign driver
    if (driver) {
      delivery.driver = driver;
    }

    delivery.timestamps = delivery.timestamps || {};
    delivery.timestamps.updated_at = timestamp;
    if (status === 'delivered' && isDatabaseEnabled()) {
      await transaction(async (client) => {
        await ensureDriverPayoutForDelivery(farmId, delivery, client);
        await updateDeliveryRecord(farmId, deliveryId, delivery, client);
      });
    } else {
      await updateDeliveryRecord(farmId, deliveryId, delivery);
    }

    res.json({
      ok: true,
      delivery
    });

  } catch (error) {
    console.error('[farm-sales] Delivery update failed:', error);
    res.status(500).json({
      ok: false,
      error: 'update_failed',
      message: error.message
    });
  }
});

/**
 * POST /api/farm-sales/delivery/routes/optimize
 * Generate optimized delivery routes for date/window
 * 
 * Body:
 * {
 *   date: 'YYYY-MM-DD',
 *   time_slot: 'morning'|'afternoon'|'evening',
 *   driver_count?: number (default 2)
 * }
 */
router.post('/routes/optimize', async (req, res) => {
  try {
    const {
      date,
      time_slot,
      driver_count = 2,
      origin: originOverride,
      max_stops_per_route,
      max_route_duration_minutes,
      driver_capacities,
      service_minutes_per_stop,
      average_mph
    } = req.body || {};
    const farmId = req.farm_id;

    if (!date || !time_slot) {
      return res.status(400).json({
        ok: false,
        error: 'missing_parameters',
        message: 'date and time_slot required'
      });
    }

    // Get unassigned deliveries for this date/window (farm-scoped)
    const normalizedTimeSlot = String(time_slot || '').trim().toLowerCase();
    const unassignedDeliveries = await listUnassignedScheduledDeliveries(farmId, date, normalizedTimeSlot);

    if (unassignedDeliveries.length === 0) {
      return res.json({
        ok: true,
        message: 'No unassigned deliveries for this date/window',
        routes: []
      });
    }

    const settings = await getFarmDeliverySettings(farmId);
    const deliveryWindows = await getFarmDeliveryWindows(farmId);
    const selectedWindow = deliveryWindows.find((window) => window.id === normalizedTimeSlot);

    if (!selectedWindow || selectedWindow.active === false) {
      return res.status(400).json({
        ok: false,
        error: 'inactive_time_slot',
        message: `time_slot '${normalizedTimeSlot}' is not active for this farm`
      });
    }

    const leadTimeHours = Math.max(0, Number(settings.lead_time_hours || 0));
    if (leadTimeHours > 0 && selectedWindow.start) {
      const [hourPart, minutePart] = String(selectedWindow.start).split(':');
      const deliveryWindowStart = new Date(`${date}T${String(hourPart || '00').padStart(2, '0')}:${String(minutePart || '00').padStart(2, '0')}:00`);
      const earliestAllowed = new Date(Date.now() + (leadTimeHours * 60 * 60 * 1000));
      if (Number.isFinite(deliveryWindowStart.getTime()) && deliveryWindowStart < earliestAllowed) {
        return res.status(400).json({
          ok: false,
          error: 'lead_time_not_met',
          message: `Route optimization requires at least ${leadTimeHours} hours of lead time for this window`
        });
      }
    }

    const normalizedDriverCount = Math.max(1, Number(driver_count) || 1);
    const origin = originOverride || {
      latitude: Number(process.env.DELIVERY_ROUTE_ORIGIN_LAT),
      longitude: Number(process.env.DELIVERY_ROUTE_ORIGIN_LNG)
    };

    const parsedDriverCapacities = Array.isArray(driver_capacities)
      ? driver_capacities.map((value) => Math.max(1, Number(value) || 1)).filter(Number.isFinite)
      : [];
    const maxStopsPerRoute = Math.max(
      1,
      Number(max_stops_per_route) || Math.ceil(Number(settings.max_deliveries_per_window || 20) / normalizedDriverCount)
    );
    const maxRouteDurationMinutes = Math.max(30, Number(max_route_duration_minutes) || 180);
    const stopServiceMinutes = Math.max(1, Number(service_minutes_per_stop) || 8);
    const averageMph = Math.max(5, Number(average_mph) || 25);

    // Zone-aware routing + nearest-neighbor sequence (fallbacks safely when coordinates are absent)
    const routesByZone = {};
    unassignedDeliveries.forEach(delivery => {
      const zone = String(delivery?.zone?.id || 'zone_unassigned');
      if (!routesByZone[zone]) {
        routesByZone[zone] = [];
      }
      routesByZone[zone].push(delivery);
    });

    const optimizedRoutes = [];
    let driverIndex = 1;

    for (const [zone, zoneDeliveries] of Object.entries(routesByZone)) {
      const orderedDeliveries = nearestNeighborSequence(zoneDeliveries, origin);
      const remainingDeliveries = [...orderedDeliveries];
      let zoneRouteIndex = 0;

      while (remainingDeliveries.length > 0) {
        const capacityForRoute = parsedDriverCapacities.length
          ? parsedDriverCapacities[zoneRouteIndex % parsedDriverCapacities.length]
          : maxStopsPerRoute;

        const routeDeliveries = [];
        while (remainingDeliveries.length > 0 && routeDeliveries.length < capacityForRoute) {
          const candidate = remainingDeliveries[0];
          const projected = [...routeDeliveries, candidate];
          const projectedDuration = estimateRouteDurationMinutes(projected, {
            origin,
            averageMph,
            stopServiceMinutes
          });

          if (routeDeliveries.length > 0 && projectedDuration > maxRouteDurationMinutes) {
            break;
          }

          routeDeliveries.push(candidate);
          remainingDeliveries.shift();
        }

        if (!routeDeliveries.length && remainingDeliveries.length) {
          routeDeliveries.push(remainingDeliveries.shift());
        }

        zoneRouteIndex += 1;
        const routeId = generateEntityId('RT');
        const timestamp = new Date().toISOString();
        const estimatedDistanceMiles = estimateRouteDistanceMiles(routeDeliveries, origin);
        const estimatedDurationMinutes = estimateRouteDurationMinutes(routeDeliveries, {
          origin,
          averageMph,
          stopServiceMinutes
        });

        const route = {
          route_id: routeId,
          farm_id: farmId,
          date,
          time_slot: normalizedTimeSlot,
          zone,
          driver_number: driverIndex++,
          status: 'pending',
          deliveries: routeDeliveries.map(d => ({
            delivery_id: d.delivery_id,
            order_id: d.order_id,
            address: d.address,
            contact: d.contact,
            sequence: routeDeliveries.indexOf(d) + 1
          })),
          stats: {
            total_stops: routeDeliveries.length,
            estimated_duration_minutes: estimatedDurationMinutes,
            estimated_distance_miles: estimatedDistanceMiles,
            constraints: {
              max_stops_per_route: capacityForRoute,
              max_route_duration_minutes: maxRouteDurationMinutes,
              stop_service_minutes: stopServiceMinutes,
              average_mph: averageMph
            }
          },
          created_at: timestamp
        };

        await insertRouteRecord(route);
        optimizedRoutes.push(route);

        // Assign route to deliveries
        for (const delivery of routeDeliveries) {
          delivery.route_id = routeId;
          delivery.status = 'assigned';
          delivery.timestamps = delivery.timestamps || {};
          delivery.timestamps.assigned_at = timestamp;
          await updateDeliveryRecord(farmId, delivery.delivery_id, delivery);
        }
      }
    }

    res.json({
      ok: true,
      message: `Created ${optimizedRoutes.length} optimized routes`,
      routes: optimizedRoutes
    });

  } catch (error) {
    console.error('[farm-sales] Route optimization failed:', error);
    res.status(500).json({
      ok: false,
      error: 'optimization_failed',
      message: error.message
    });
  }
});

/**
 * GET /api/farm-sales/delivery/routes
 * List delivery routes
 * 
 * Query params:
 * - date: YYYY-MM-DD
 * - time_slot: Filter by time slot
 * - status: Filter by status
 */
router.get('/routes', async (req, res) => {
  try {
    const { date, time_slot, status } = req.query;
    const farmId = req.farm_id;

    const filtered = await listRoutesForFarm(farmId, {
      date,
      time_slot,
      status
    });

    res.json({
      ok: true,
      total: filtered.length,
      routes: filtered
    });

  } catch (error) {
    console.error('[farm-sales] Routes list failed:', error);
    res.status(500).json({
      ok: false,
      error: 'routes_list_failed',
      message: error.message
    });
  }
});

export default router;
