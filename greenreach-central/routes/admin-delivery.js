/**
 * Admin Delivery Management API
 * GreenReach Central admin endpoints for managing delivery zones, drivers, fees
 * 
 * Endpoints:
 *   GET    /api/admin/delivery/config     - Get full delivery configuration
 *   PUT    /api/admin/delivery/config     - Update global delivery settings
 *   GET    /api/admin/delivery/zones      - List delivery zones
 *   POST   /api/admin/delivery/zones      - Create delivery zone
 *   PUT    /api/admin/delivery/zones/:id  - Update delivery zone
 *   DELETE /api/admin/delivery/zones/:id  - Delete delivery zone
 *   GET    /api/admin/delivery/drivers    - List drivers
 *   POST   /api/admin/delivery/drivers    - Add driver
 *   PUT    /api/admin/delivery/drivers/:id - Update driver
 *   GET    /api/admin/delivery/fees       - Get fee distribution data
 */

import express from 'express';
import { adminAuthMiddleware, requireAdminRole } from '../middleware/adminAuth.js';
import { query, isDatabaseAvailable } from '../config/database.js';

const router = express.Router();

// Protect all admin delivery routes: require authenticated admin with 'admin' or 'operations' role
router.use(adminAuthMiddleware);
router.use(requireAdminRole('admin', 'operations'));

// In-memory fallback for non-DB fields (drivers, fees, stats not yet in DB)
const deliveryConfig = {
  drivers: [],
  recent_fees: [],
  stats: {
    deliveries_30d: 0,
    revenue_30d: 0,
    fees_collected: 0,
    driver_payouts: 0,
    platform_revenue: 0
  }
};

/**
 * GET /config - Get full delivery configuration for a farm
 * Query: ?farm_id=XXX (required)
 */
router.get('/config', async (req, res) => {
  try {
    const farmId = req.query.farm_id;
    if (!farmId) {
      return res.status(400).json({ success: false, error: 'farm_id query parameter is required' });
    }

    let settings = { enabled: false, base_fee: 0, min_order: 25 };
    let zones = [];

    if (isDatabaseAvailable()) {
      const settingsResult = await query(
        'SELECT * FROM farm_delivery_settings WHERE farm_id = $1', [farmId]
      );
      if (settingsResult.rows.length > 0) {
        const row = settingsResult.rows[0];
        settings = { enabled: row.enabled, base_fee: Number(row.base_fee), min_order: Number(row.min_order) };
      }

      const zonesResult = await query(
        'SELECT * FROM farm_delivery_zones WHERE farm_id = $1 ORDER BY zone_id', [farmId]
      );
      zones = zonesResult.rows.map(r => ({
        id: r.zone_id, name: r.name, description: r.description || '',
        fee: Number(r.fee), min_order: Number(r.min_order),
        postal_prefix: r.postal_prefix, status: r.status
      }));
    }

    res.json({
      success: true,
      config: { ...settings, zones, drivers: deliveryConfig.drivers, stats: deliveryConfig.stats }
    });
  } catch (error) {
    console.error('[Admin Delivery] Config get failed:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /config - Update delivery settings for a farm
 * Body: { farm_id, base_fee?, min_order?, enabled? }
 */
router.put('/config', async (req, res) => {
  try {
    const { farm_id, base_fee, min_order, enabled } = req.body;
    if (!farm_id) {
      return res.status(400).json({ success: false, error: 'farm_id is required' });
    }

    if (isDatabaseAvailable()) {
      await query(
        `INSERT INTO farm_delivery_settings (farm_id, enabled, base_fee, min_order, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (farm_id) DO UPDATE SET
           enabled = COALESCE($2, farm_delivery_settings.enabled),
           base_fee = COALESCE($3, farm_delivery_settings.base_fee),
           min_order = COALESCE($4, farm_delivery_settings.min_order),
           updated_at = NOW()`,
        [farm_id, enabled ?? null, base_fee != null ? parseFloat(base_fee) : null, min_order != null ? parseFloat(min_order) : null]
      );

      const result = await query('SELECT * FROM farm_delivery_settings WHERE farm_id = $1', [farm_id]);
      const row = result.rows[0];
      console.log('[Admin Delivery] Config updated for farm:', farm_id);
      return res.json({
        success: true,
        config: { enabled: row.enabled, base_fee: Number(row.base_fee), min_order: Number(row.min_order) }
      });
    }

    res.status(503).json({ success: false, error: 'Database unavailable' });
  } catch (error) {
    console.error('[Admin Delivery] Config update failed:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /zones - List delivery zones for a farm
 * Query: ?farm_id=XXX (required)
 */
router.get('/zones', async (req, res) => {
  try {
    const farmId = req.query.farm_id;
    if (!farmId) {
      return res.status(400).json({ success: false, error: 'farm_id query parameter is required' });
    }

    if (isDatabaseAvailable()) {
      const result = await query(
        'SELECT * FROM farm_delivery_zones WHERE farm_id = $1 ORDER BY zone_id', [farmId]
      );
      const zones = result.rows.map(r => ({
        id: r.zone_id, name: r.name, description: r.description || '',
        fee: Number(r.fee), min_order: Number(r.min_order),
        postal_prefix: r.postal_prefix, status: r.status,
        created_at: r.created_at, updated_at: r.updated_at
      }));
      return res.json({ success: true, zones });
    }

    res.status(503).json({ success: false, error: 'Database unavailable' });
  } catch (error) {
    console.error('[Admin Delivery] Zones list failed:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /zones - Create a new delivery zone
 * Body: { farm_id, id, name, description?, fee?, min_order?, postal_prefix? }
 */
router.post('/zones', async (req, res) => {
  try {
    const { farm_id, id, name, description, fee, min_order, postal_prefix } = req.body;
    if (!farm_id || !id || !name) {
      return res.status(400).json({ success: false, error: 'farm_id, zone id and name are required' });
    }

    if (isDatabaseAvailable()) {
      const existing = await query(
        'SELECT 1 FROM farm_delivery_zones WHERE farm_id = $1 AND zone_id = $2', [farm_id, id]
      );
      if (existing.rows.length > 0) {
        return res.status(409).json({ success: false, error: `Zone ${id} already exists for farm ${farm_id}` });
      }

      await query(
        `INSERT INTO farm_delivery_zones (farm_id, zone_id, name, description, fee, min_order, postal_prefix, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'active')`,
        [farm_id, id, name, description || '', parseFloat(fee || 0), parseFloat(min_order || 25), postal_prefix || null]
      );

      console.log('[Admin Delivery] Zone created:', id, 'for farm:', farm_id);
      return res.json({ success: true, zone: { id, name, description: description || '', fee: parseFloat(fee || 0), min_order: parseFloat(min_order || 25), postal_prefix: postal_prefix || null, status: 'active' } });
    }

    res.status(503).json({ success: false, error: 'Database unavailable' });
  } catch (error) {
    console.error('[Admin Delivery] Zone create failed:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /zones/:id - Update a delivery zone
 * Body: { farm_id, name?, description?, fee?, min_order?, postal_prefix?, status? }
 */
router.put('/zones/:id', async (req, res) => {
  try {
    const zoneId = req.params.id;
    const { farm_id, name, description, fee, min_order, postal_prefix, status } = req.body;
    if (!farm_id) {
      return res.status(400).json({ success: false, error: 'farm_id is required' });
    }

    if (isDatabaseAvailable()) {
      const existing = await query(
        'SELECT * FROM farm_delivery_zones WHERE farm_id = $1 AND zone_id = $2', [farm_id, zoneId]
      );
      if (existing.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Zone not found' });
      }

      const row = existing.rows[0];
      await query(
        `UPDATE farm_delivery_zones SET
          name = $3, description = $4, fee = $5, min_order = $6, postal_prefix = $7, status = $8, updated_at = NOW()
         WHERE farm_id = $1 AND zone_id = $2`,
        [
          farm_id, zoneId,
          name !== undefined ? name : row.name,
          description !== undefined ? description : row.description,
          fee !== undefined ? parseFloat(fee) : row.fee,
          min_order !== undefined ? parseFloat(min_order) : row.min_order,
          postal_prefix !== undefined ? postal_prefix : row.postal_prefix,
          status !== undefined ? status : row.status
        ]
      );

      console.log('[Admin Delivery] Zone updated:', zoneId, 'for farm:', farm_id);
      return res.json({ success: true, zone_id: zoneId, updated: true });
    }

    res.status(503).json({ success: false, error: 'Database unavailable' });
  } catch (error) {
    console.error('[Admin Delivery] Zone update failed:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /zones/:id - Soft-deactivate a delivery zone
 * Query: ?farm_id=XXX (required)
 */
router.delete('/zones/:id', async (req, res) => {
  try {
    const zoneId = req.params.id;
    const farmId = req.query.farm_id || req.body?.farm_id;
    if (!farmId) {
      return res.status(400).json({ success: false, error: 'farm_id is required' });
    }

    if (isDatabaseAvailable()) {
      const result = await query(
        "UPDATE farm_delivery_zones SET status = 'inactive', updated_at = NOW() WHERE farm_id = $1 AND zone_id = $2 RETURNING zone_id",
        [farmId, zoneId]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Zone not found' });
      }
      console.log('[Admin Delivery] Zone deactivated:', zoneId, 'for farm:', farmId);
      return res.json({ success: true, deleted: zoneId });
    }

    res.status(503).json({ success: false, error: 'Database unavailable' });
  } catch (error) {
    console.error('[Admin Delivery] Zone delete failed:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /drivers - List all drivers
 */
router.get('/drivers', (req, res) => {
  res.json({
    success: true,
    drivers: deliveryConfig.drivers
  });
});

/**
 * POST /drivers - Add a new driver
 */
router.post('/drivers', (req, res) => {
  const { name, phone, vehicle, zones, email } = req.body;
  
  if (!name || !phone) {
    return res.status(400).json({ success: false, error: 'Driver name and phone are required' });
  }
  
  const driver = {
    id: 'DRV-' + Date.now().toString(36).toUpperCase(),
    name,
    phone,
    email: email || '',
    vehicle: vehicle || '',
    zones: zones || [],
    deliveries_30d: 0,
    rating: null,
    status: 'active',
    hired_at: new Date().toISOString()
  };
  
  deliveryConfig.drivers.push(driver);
  console.log('[Admin Delivery] Driver added:', driver.id, driver.name);
  
  res.json({ success: true, driver });
});

/**
 * PUT /drivers/:id - Update a driver
 */
router.put('/drivers/:id', (req, res) => {
  const driver = deliveryConfig.drivers.find(d => d.id === req.params.id);
  if (!driver) {
    return res.status(404).json({ success: false, error: 'Driver not found' });
  }
  
  const { name, phone, vehicle, zones, email, status } = req.body;
  if (name !== undefined) driver.name = name;
  if (phone !== undefined) driver.phone = phone;
  if (email !== undefined) driver.email = email;
  if (vehicle !== undefined) driver.vehicle = vehicle;
  if (zones !== undefined) driver.zones = zones;
  if (status !== undefined) driver.status = status;
  driver.updated_at = new Date().toISOString();
  
  console.log('[Admin Delivery] Driver updated:', driver.id);
  res.json({ success: true, driver });
});

/**
 * GET /fees - Get fee distribution summary
 */
router.get('/fees', (req, res) => {
  res.json({
    success: true,
    stats: deliveryConfig.stats,
    recent_fees: deliveryConfig.recent_fees
  });
});

/**
 * GET /readiness - Delivery readiness overview across all farms
 * Returns list of farms with delivery enabled status and window counts
 */
router.get('/readiness', async (req, res) => {
  try {
    if (!isDatabaseAvailable()) {
      return res.json({ success: true, farms: [], message: 'Database unavailable' });
    }

    const settingsResult = await query(
      `SELECT s.farm_id, s.enabled, s.base_fee, s.min_order,
              (SELECT COUNT(*) FROM farm_delivery_windows w WHERE w.farm_id = s.farm_id AND w.active = true) AS active_windows,
              (SELECT COUNT(*) FROM farm_delivery_zones z WHERE z.farm_id = s.farm_id AND z.status = 'active') AS active_zones
       FROM farm_delivery_settings s
       ORDER BY s.enabled DESC, s.farm_id`
    );

    const farms = settingsResult.rows.map(r => ({
      farm_id: r.farm_id,
      enabled: r.enabled,
      base_fee: Number(r.base_fee),
      min_order: Number(r.min_order),
      active_windows: Number(r.active_windows),
      active_zones: Number(r.active_zones),
      ready: r.enabled && Number(r.active_windows) > 0
    }));

    res.json({
      success: true,
      farms,
      summary: {
        total: farms.length,
        enabled: farms.filter(f => f.enabled).length,
        ready: farms.filter(f => f.ready).length
      }
    });
  } catch (error) {
    console.error('[Admin Delivery] Readiness check failed:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
