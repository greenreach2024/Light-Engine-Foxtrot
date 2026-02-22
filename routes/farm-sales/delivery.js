/**
 * Farm Sales - Delivery Management
 * Route planning and delivery scheduling for D2C orders (MULTI-TENANT)
 * 
 * Includes:
 * - Farm delivery settings (enable/disable, fees, zones, schedules)
 * - Delivery scheduling and tracking
 * - Route optimization
 * - Wholesale delivery integration
 */

import express from 'express';
import { farmAuthMiddleware } from '../../lib/farm-auth.js';
import { farmStores } from '../../lib/farm-store.js';

const router = express.Router();

// In-memory farm delivery settings (would be persisted to DB in production)
const farmDeliverySettings = new Map();

// In-memory route storage (shared across farms for optimization)
const routes = new Map();
const routeSequence = { current: 100 };

/**
 * Default delivery time windows
 */
const DEFAULT_TIME_WINDOWS = {
  MORNING: { id: 'morning', label: 'Morning (8am-12pm)', start: '08:00', end: '12:00', enabled: true },
  AFTERNOON: { id: 'afternoon', label: 'Afternoon (12pm-4pm)', start: '12:00', end: '16:00', enabled: true },
  EVENING: { id: 'evening', label: 'Evening (4pm-8pm)', start: '16:00', end: '20:00', enabled: false }
};

/**
 * Default delivery zones
 */
const DEFAULT_DELIVERY_ZONES = [
  { id: 'zone_local', name: 'Local (0-10 km)', fee: 0, min_order: 25, max_distance_km: 10 },
  { id: 'zone_nearby', name: 'Nearby (10-25 km)', fee: 5, min_order: 35, max_distance_km: 25 },
  { id: 'zone_extended', name: 'Extended (25-50 km)', fee: 10, min_order: 50, max_distance_km: 50 }
];

/**
 * Get farm delivery settings (creates defaults if not exists)
 */
function getFarmDeliverySettings(farmId) {
  if (!farmDeliverySettings.has(farmId)) {
    farmDeliverySettings.set(farmId, {
      farm_id: farmId,
      enabled: false,
      delivery_types: {
        wholesale: false,
        d2c: false
      },
      fee_structure: 'zone_based', // 'flat', 'zone_based', 'distance_based', 'free_over_min'
      flat_fee: 5.00,
      free_delivery_minimum: 100,
      zones: JSON.parse(JSON.stringify(DEFAULT_DELIVERY_ZONES)),
      time_windows: JSON.parse(JSON.stringify(DEFAULT_TIME_WINDOWS)),
      delivery_days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
      lead_time_hours: 24, // Minimum hours advance notice for delivery
      max_deliveries_per_window: 20,
      driver_instructions: '',
      contact_phone: '',
      pickup_location: {
        address: '',
        notes: ''
      },
      updated_at: new Date().toISOString()
    });
  }
  return farmDeliverySettings.get(farmId);
}

// Helper to get time windows for a farm
function getTimeWindowsForFarm(farmId) {
  const settings = getFarmDeliverySettings(farmId);
  return settings.time_windows;
}

// Helper to get zones for a farm
function getZonesForFarm(farmId) {
  const settings = getFarmDeliverySettings(farmId);
  return settings.zones;
}

// Legacy TIME_WINDOWS for backwards compatibility
const TIME_WINDOWS = DEFAULT_TIME_WINDOWS;
const DELIVERY_ZONES = {
  ZONE_A: { id: 'zone_a', name: 'Downtown', fee: 0, min_order: 25 },
  ZONE_B: { id: 'zone_b', name: 'Suburbs', fee: 5, min_order: 35 },
  ZONE_C: { id: 'zone_c', name: 'Rural', fee: 10, min_order: 50 }
};

// ============================================================================
// PUBLIC ROUTES (no auth required - for buyers checking delivery availability)
// ============================================================================

/**
 * GET /api/farm-sales/delivery/settings/public/:farmId
 * Get public delivery settings for a farm (for buyers to see delivery options)
 */
router.get('/settings/public/:farmId', (req, res) => {
  try {
    const { farmId } = req.params;
    const settings = getFarmDeliverySettings(farmId);
    
    // Return only public-facing settings
    res.json({
      ok: true,
      delivery_enabled: settings.enabled,
      delivery_types: settings.delivery_types,
      fee_structure: settings.fee_structure,
      flat_fee: settings.flat_fee,
      free_delivery_minimum: settings.free_delivery_minimum,
      zones: settings.zones.map(z => ({
        id: z.id,
        name: z.name,
        fee: z.fee,
        min_order: z.min_order
      })),
      time_windows: Object.entries(settings.time_windows)
        .filter(([_, w]) => w.enabled)
        .map(([_, w]) => ({
          id: w.id,
          label: w.label,
          start: w.start,
          end: w.end
        })),
      delivery_days: settings.delivery_days,
      lead_time_hours: settings.lead_time_hours
    });
  } catch (error) {
    console.error('[delivery] Get public settings failed:', error);
    res.status(500).json({
      ok: false,
      error: 'settings_fetch_failed',
      message: error.message
    });
  }
});

// ============================================================================
// AUTHENTICATED ROUTES (farm auth required)
// ============================================================================

// Apply authentication to remaining routes
router.use(farmAuthMiddleware);

/**
 * GET /api/farm-sales/delivery/settings
 * Get full delivery settings for the authenticated farm
 */
router.get('/settings', (req, res) => {
  try {
    const farmId = req.farm_id;
    const settings = getFarmDeliverySettings(farmId);
    
    res.json({
      ok: true,
      settings
    });
  } catch (error) {
    console.error('[delivery] Get settings failed:', error);
    res.status(500).json({
      ok: false,
      error: 'settings_fetch_failed',
      message: error.message
    });
  }
});

/**
 * PUT /api/farm-sales/delivery/settings
 * Update delivery settings for the authenticated farm
 */
router.put('/settings', (req, res) => {
  try {
    const farmId = req.farm_id;
    const updates = req.body;
    const settings = getFarmDeliverySettings(farmId);
    
    // Merge updates
    const allowedFields = [
      'enabled', 'delivery_types', 'fee_structure', 'flat_fee',
      'free_delivery_minimum', 'zones', 'time_windows', 'delivery_days',
      'lead_time_hours', 'max_deliveries_per_window', 'driver_instructions',
      'contact_phone', 'pickup_location'
    ];
    
    allowedFields.forEach(field => {
      if (updates[field] !== undefined) {
        settings[field] = updates[field];
      }
    });
    
    settings.updated_at = new Date().toISOString();
    farmDeliverySettings.set(farmId, settings);
    
    console.log(`[delivery] Updated settings for farm ${farmId}:`, {
      enabled: settings.enabled,
      delivery_types: settings.delivery_types
    });
    
    res.json({
      ok: true,
      message: 'Delivery settings updated',
      settings
    });
  } catch (error) {
    console.error('[delivery] Update settings failed:', error);
    res.status(500).json({
      ok: false,
      error: 'settings_update_failed',
      message: error.message
    });
  }
});

/**
 * POST /api/farm-sales/delivery/zones
 * Add a new delivery zone
 */
router.post('/zones', (req, res) => {
  try {
    const farmId = req.farm_id;
    const { name, fee, min_order, max_distance_km } = req.body;
    const settings = getFarmDeliverySettings(farmId);
    
    const newZone = {
      id: `zone_${Date.now()}`,
      name: name || 'New Zone',
      fee: fee || 0,
      min_order: min_order || 0,
      max_distance_km: max_distance_km || 25
    };
    
    settings.zones.push(newZone);
    settings.updated_at = new Date().toISOString();
    farmDeliverySettings.set(farmId, settings);
    
    res.status(201).json({
      ok: true,
      zone: newZone,
      zones: settings.zones
    });
  } catch (error) {
    console.error('[delivery] Add zone failed:', error);
    res.status(500).json({
      ok: false,
      error: 'zone_add_failed',
      message: error.message
    });
  }
});

/**
 * DELETE /api/farm-sales/delivery/zones/:zoneId
 * Remove a delivery zone
 */
router.delete('/zones/:zoneId', (req, res) => {
  try {
    const farmId = req.farm_id;
    const { zoneId } = req.params;
    const settings = getFarmDeliverySettings(farmId);
    
    const initialLength = settings.zones.length;
    settings.zones = settings.zones.filter(z => z.id !== zoneId);
    
    if (settings.zones.length === initialLength) {
      return res.status(404).json({
        ok: false,
        error: 'zone_not_found',
        message: `Zone ${zoneId} not found`
      });
    }
    
    settings.updated_at = new Date().toISOString();
    farmDeliverySettings.set(farmId, settings);
    
    res.json({
      ok: true,
      message: 'Zone removed',
      zones: settings.zones
    });
  } catch (error) {
    console.error('[delivery] Remove zone failed:', error);
    res.status(500).json({
      ok: false,
      error: 'zone_remove_failed',
      message: error.message
    });
  }
});

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

    if (!date) {
      return res.status(400).json({
        ok: false,
        error: 'date_required',
        message: 'Date parameter required (YYYY-MM-DD)'
      });
    }

    const deliveryDate = new Date(date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

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

    const windows = Object.values(TIME_WINDOWS).map(window => {
      const windowDeliveries = existingDeliveries.filter(d => d.time_slot === window.id);
      const capacity = 20; // Max deliveries per window
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

export default router;
