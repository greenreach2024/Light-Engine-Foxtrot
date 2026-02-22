/**
 * Farm Sales - Delivery Management
 * Route planning and delivery scheduling for D2C orders (MULTI-TENANT)
 */

import express from 'express';
import { farmAuthMiddleware } from '../../lib/farm-auth.js';
import { farmStores } from '../../lib/farm-store.js';

const router = express.Router();

// Apply authentication to all routes
router.use(farmAuthMiddleware);

// In-memory route storage (shared across farms for optimization)
const routes = new Map();
const routeSequence = { current: 100 };

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
  ZONE_A: { id: 'zone_a', name: 'Downtown', fee: 0, min_order: 25 },
  ZONE_B: { id: 'zone_b', name: 'Suburbs', fee: 5, min_order: 35 },
  ZONE_C: { id: 'zone_c', name: 'Rural', fee: 10, min_order: 50 }
};

// Farm-scoped MVP settings (in-memory for now; persistence in follow-up slice)
const deliverySettingsByFarm = new Map();
const deliveryWindowsByFarm = new Map();

function getDefaultDeliverySettings() {
  return {
    enabled: false,
    base_fee: 0,
    min_order: 25,
    lead_time_hours: 24,
    max_deliveries_per_window: 20,
    updated_at: new Date().toISOString()
  };
}

function getFarmDeliverySettings(farmId) {
  if (!deliverySettingsByFarm.has(farmId)) {
    deliverySettingsByFarm.set(farmId, getDefaultDeliverySettings());
  }
  return deliverySettingsByFarm.get(farmId);
}

function getDefaultDeliveryWindows() {
  return Object.values(TIME_WINDOWS).map((window) => ({
    ...window,
    active: true
  }));
}

function getFarmDeliveryWindows(farmId) {
  if (!deliveryWindowsByFarm.has(farmId)) {
    deliveryWindowsByFarm.set(farmId, getDefaultDeliveryWindows());
  }
  return deliveryWindowsByFarm.get(farmId);
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
 * GET /api/farm-sales/delivery/windows
 * Get available delivery windows for a date
 * 
 * Query params:
 * - date: YYYY-MM-DD
 * - zone: Delivery zone ID
 */
router.get('/windows', (req, res) => {
  try {
    const { date, zone } = req.query;
    const farmId = req.farm_id;

    // Config mode (MVP): return farm-scoped delivery window settings
    if (!date) {
      return res.json({
        ok: true,
        farm_id: farmId,
        windows: getFarmDeliveryWindows(farmId)
      });
    }

    const deliveryDate = new Date(date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const settings = getFarmDeliverySettings(farmId);
    const configuredWindows = getFarmDeliveryWindows(farmId);
    const activeWindows = configuredWindows.filter((w) => w.active);
    const effectiveWindowTemplates = activeWindows.length
      ? activeWindows
      : configuredWindows;

    // Can't deliver in the past
    if (deliveryDate < today) {
      return res.status(400).json({
        ok: false,
        error: 'invalid_date',
        message: 'Cannot schedule delivery in the past'
      });
    }

    // Get existing deliveries for this date to check capacity (farm-scoped)
    const existingDeliveries = farmStores.deliveries.getAllForFarm(farmId)
      .filter(d => d.delivery_date === date);

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

    res.json({
      ok: true,
      farm_id: farmId,
      date,
      zone: zone ? DELIVERY_ZONES[zone.toUpperCase()] : null,
      windows
    });

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
router.put('/windows', (req, res) => {
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

    deliveryWindowsByFarm.set(farmId, normalized);

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
router.get('/settings', (req, res) => {
  try {
    const farmId = req.farm_id;
    return res.json({
      ok: true,
      farm_id: farmId,
      settings: getFarmDeliverySettings(farmId)
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
router.put('/settings', (req, res) => {
  try {
    const farmId = req.farm_id;
    const current = getFarmDeliverySettings(farmId);
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

    deliverySettingsByFarm.set(farmId, next);

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

/**
 * POST /api/farm-sales/delivery/quote
 * Compute a simple delivery quote for current farm
 */
router.post('/quote', (req, res) => {
  try {
    const farmId = req.farm_id;
    const { subtotal = 0, zone, requested_window } = req.body || {};
    const settings = getFarmDeliverySettings(farmId);
    const configuredWindows = getFarmDeliveryWindows(farmId);
    const activeWindows = configuredWindows.filter((w) => w.active).map((w) => w.id);

    const requestedZone = String(zone || '').trim().toUpperCase();
    const zoneConfig = DELIVERY_ZONES[requestedZone] || null;
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
 * GET /api/farm-sales/delivery/zones
 * Get delivery zones and fee structure
 */
router.get('/zones', (req, res) => {
  res.json({
    ok: true,
    zones: Object.values(DELIVERY_ZONES)
  });
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
    const { order_id, delivery_date, time_slot, address, zone, instructions, contact } = req.body;
    const farmId = req.farm_id;

    // Validate required fields
    if (!order_id || !delivery_date || !time_slot || !address || !zone) {
      return res.status(400).json({
        ok: false,
        error: 'missing_required_fields',
        message: 'order_id, delivery_date, time_slot, address, and zone are required'
      });
    }

    // Validate time slot
    if (!TIME_WINDOWS[time_slot.toUpperCase()]) {
      return res.status(400).json({
        ok: false,
        error: 'invalid_time_slot',
        message: `Time slot must be one of: ${Object.keys(TIME_WINDOWS).join(', ')}`
      });
    }

    // Validate zone
    const deliveryZone = DELIVERY_ZONES[zone.toUpperCase()];
    if (!deliveryZone) {
      return res.status(400).json({
        ok: false,
        error: 'invalid_zone',
        message: `Zone must be one of: ${Object.keys(DELIVERY_ZONES).join(', ')}`
      });
    }

    // Check window availability
    const windowCheck = await fetch(
      `http://localhost:8091/api/farm-sales/delivery/windows?date=${delivery_date}&zone=${zone}`
    );
    const windowData = await windowCheck.json();
    const selectedWindow = windowData.windows?.find(w => w.id === time_slot);

    if (!selectedWindow?.available) {
      return res.status(400).json({
        ok: false,
        error: 'window_unavailable',
        message: 'Selected delivery window is full'
      });
    }

    const deliveryId = farmStores.deliveries.generateId(farmId, 'DEL', 6);
    const timestamp = new Date().toISOString();

    // Create delivery
    const delivery = {
      delivery_id: deliveryId,
      order_id,
      delivery_date,
      time_slot,
      window: TIME_WINDOWS[time_slot.toUpperCase()],
      address,
      zone: deliveryZone,
      instructions,
      contact,
      status: 'scheduled',
      route_id: null, // Assigned when route is optimized
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

    farmStores.deliveries.set(farmId, deliveryId, delivery);

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
router.get('/:deliveryId', (req, res) => {
  const { deliveryId } = req.params;
  const farmId = req.farm_id;
  const delivery = farmStores.deliveries.get(farmId, deliveryId);

  if (!delivery) {
    return res.status(404).json({
      ok: false,
      error: 'delivery_not_found',
      delivery_id: deliveryId
    });
  }

  res.json({
    ok: true,
    delivery
  });
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
router.patch('/:deliveryId', (req, res) => {
  try {
    const { deliveryId } = req.params;
    const { status, driver, notes } = req.body;
    const farmId = req.farm_id;
    const delivery = farmStores.deliveries.get(farmId, deliveryId);

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

    delivery.timestamps.updated_at = timestamp;
    farmStores.deliveries.set(farmId, deliveryId, delivery);

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
router.post('/routes/optimize', (req, res) => {
  try {
    const { date, time_slot, driver_count = 2 } = req.body;
    const farmId = req.farm_id;

    if (!date || !time_slot) {
      return res.status(400).json({
        ok: false,
        error: 'missing_parameters',
        message: 'date and time_slot required'
      });
    }

    // Get unassigned deliveries for this date/window (farm-scoped)
    const unassignedDeliveries = farmStores.deliveries.getAllForFarm(farmId)
      .filter(d => 
        d.delivery_date === date &&
        d.time_slot === time_slot &&
        d.status === 'scheduled' &&
        !d.route_id
      );

    if (unassignedDeliveries.length === 0) {
      return res.json({
        ok: true,
        message: 'No unassigned deliveries for this date/window',
        routes: []
      });
    }

    // Simple zone-based routing (TODO: implement proper TSP optimization)
    const routesByZone = {};
    unassignedDeliveries.forEach(delivery => {
      const zone = delivery.zone.id;
      if (!routesByZone[zone]) {
        routesByZone[zone] = [];
      }
      routesByZone[zone].push(delivery);
    });

    const optimizedRoutes = [];
    let driverIndex = 1;

    Object.entries(routesByZone).forEach(([zone, zoneDeliveries]) => {
      // Split zone deliveries across drivers
      const deliveriesPerDriver = Math.ceil(zoneDeliveries.length / driver_count);
      
      for (let i = 0; i < zoneDeliveries.length; i += deliveriesPerDriver) {
        const routeDeliveries = zoneDeliveries.slice(i, i + deliveriesPerDriver);
        const routeId = `RT-${String(routeSequence.current++).padStart(4, '0')}`;
        const timestamp = new Date().toISOString();

        const route = {
          route_id: routeId,
          date,
          time_slot,
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
            estimated_duration_minutes: routeDeliveries.length * 15, // 15 min per stop
            estimated_distance_miles: routeDeliveries.length * 3 // 3 miles between stops
          },
          created_at: timestamp
        };

        routes.set(routeId, route);
        optimizedRoutes.push(route);

        // Assign route to deliveries
        routeDeliveries.forEach(delivery => {
          delivery.route_id = routeId;
          delivery.status = 'assigned';
          delivery.timestamps.assigned_at = timestamp;
          farmStores.deliveries.set(farmId, delivery.delivery_id, delivery);
        });
      }
    });

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
router.get('/routes', (req, res) => {
  try {
    const { date, time_slot, status } = req.query;
    
    let filtered = Array.from(routes.values());

    if (date) {
      filtered = filtered.filter(r => r.date === date);
    }
    if (time_slot) {
      filtered = filtered.filter(r => r.time_slot === time_slot);
    }
    if (status) {
      filtered = filtered.filter(r => r.status === status);
    }

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
