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

// All delivery routes require authentication
router.use(adminAuthMiddleware);

// Read-only readiness endpoint is available to any authenticated admin (dashboard KPI)
// Write/config routes below are gated to admin + operations roles
router.get('/readiness', async (req, res) => {
  try {
    if (!isDatabaseAvailable()) {
      return res.json({ success: true, farms: [], summary: { total: 0, enabled: 0, ready: 0 }, message: 'Database unavailable' });
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
      ready: r.enabled && Number(r.active_windows) > 0 && Number(r.active_zones) > 0
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

// All remaining delivery routes require admin or operations role
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

function extractFarmId(req) {
  return req.query.farm_id || req.body?.farm_id || req.headers['x-farm-id'] || null;
}

async function getDriversForFarm(farmId) {
  if (!isDatabaseAvailable()) {
    return deliveryConfig.drivers;
  }
  const result = await query(
    `SELECT driver_id, name, phone, email, vehicle, zones,
            pay_per_delivery, cold_chain_bonus, cold_chain_certified,
            deliveries_30d, rating, status, hired_at, updated_at
       FROM delivery_drivers
      WHERE farm_id = $1
      ORDER BY name ASC`,
    [farmId]
  );
  return result.rows.map(r => ({
    id: r.driver_id,
    name: r.name,
    phone: r.phone,
    email: r.email || '',
    vehicle: r.vehicle || '',
    zones: Array.isArray(r.zones) ? r.zones : [],
    pay_per_delivery: Number(r.pay_per_delivery || 5.5),
    cold_chain_bonus: Number(r.cold_chain_bonus || 2),
    cold_chain_certified: Boolean(r.cold_chain_certified),
    deliveries_30d: Number(r.deliveries_30d || 0),
    rating: r.rating == null ? null : Number(r.rating),
    status: r.status || 'active',
    hired_at: r.hired_at,
    updated_at: r.updated_at
  }));
}

async function getDeliveryStatsForFarm(farmId) {
  if (!isDatabaseAvailable()) {
    return {
      stats: deliveryConfig.stats,
      recent_fees: deliveryConfig.recent_fees
    };
  }

  try {
    const statsResult = await query(
      `SELECT
         COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days')::int AS deliveries_30d,
         COALESCE(SUM(delivery_fee) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days'), 0)::numeric AS fees_collected,
         COALESCE(SUM(driver_payout_amount) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days'), 0)::numeric AS driver_payouts,
         COALESCE(SUM(platform_margin) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days'), 0)::numeric AS platform_revenue
       FROM delivery_orders
       WHERE farm_id = $1`,
      [farmId]
    );

    const row = statsResult.rows[0] || {};
    const stats = {
      deliveries_30d: Number(row.deliveries_30d || 0),
      revenue_30d: Number(row.platform_revenue || 0),
      fees_collected: Number(row.fees_collected || 0),
      driver_payouts: Number(row.driver_payouts || 0),
      platform_revenue: Number(row.platform_revenue || 0)
    };

    const recentResult = await query(
      `SELECT delivery_id, order_id, delivery_fee, driver_payout_amount, platform_margin, created_at
         FROM delivery_orders
        WHERE farm_id = $1
          AND delivery_fee > 0
        ORDER BY created_at DESC
        LIMIT 20`,
      [farmId]
    );

    const recent_fees = recentResult.rows.map(r => ({
      delivery_id: r.delivery_id,
      order_id: r.order_id,
      delivery_fee: Number(r.delivery_fee || 0),
      driver_payout: Number(r.driver_payout_amount || 0),
      platform_margin: Number(r.platform_margin || 0),
      created_at: r.created_at
    }));

    return { stats, recent_fees };
  } catch (error) {
    console.warn('[Admin Delivery] Stats query fallback:', error.message);
    return {
      stats: deliveryConfig.stats,
      recent_fees: deliveryConfig.recent_fees
    };
  }
}

/**
 * GET /config - Get full delivery configuration for a farm
 * Query: ?farm_id=XXX (required)
 */
router.get('/config', async (req, res) => {
  try {
    const farmId = extractFarmId(req);
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

    const drivers = await getDriversForFarm(farmId);
    const { stats } = await getDeliveryStatsForFarm(farmId);

    res.json({
      success: true,
      config: { ...settings, zones, drivers, stats }
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
    const farmId = extractFarmId(req);
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
    const farmId = extractFarmId(req);
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
  const farmId = extractFarmId(req);
  if (!farmId) {
    return res.status(400).json({ success: false, error: 'farm_id is required' });
  }

  getDriversForFarm(farmId)
    .then(drivers => res.json({ success: true, drivers }))
    .catch(error => {
      console.error('[Admin Delivery] Drivers list failed:', error);
      res.status(500).json({ success: false, error: error.message });
    });
});

/**
 * POST /drivers - Add a new driver
 */
router.post('/drivers', async (req, res) => {
  const { farm_id, name, phone, vehicle, zones, email, pay_per_delivery, cold_chain_bonus, cold_chain_certified } = req.body;
  const farmId = farm_id || extractFarmId(req);
  
  if (!farmId) {
    return res.status(400).json({ success: false, error: 'farm_id is required' });
  }

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
    pay_per_delivery: Math.max(0, Number(pay_per_delivery) || 5.5),
    cold_chain_bonus: Math.max(0, Number(cold_chain_bonus) || 2),
    cold_chain_certified: Boolean(cold_chain_certified),
    deliveries_30d: 0,
    rating: null,
    status: 'active',
    hired_at: new Date().toISOString()
  };
  
  if (isDatabaseAvailable()) {
    try {
      await query(
        `INSERT INTO delivery_drivers (
          farm_id, driver_id, name, phone, email, vehicle, zones,
          pay_per_delivery, cold_chain_bonus, cold_chain_certified,
          deliveries_30d, rating, status, hired_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7::jsonb,
          $8, $9, $10,
          $11, $12, $13, $14, NOW()
        )`,
        [
          farmId,
          driver.id,
          driver.name,
          driver.phone,
          driver.email,
          driver.vehicle,
          JSON.stringify(driver.zones || []),
          driver.pay_per_delivery,
          driver.cold_chain_bonus,
          driver.cold_chain_certified,
          driver.deliveries_30d,
          driver.rating,
          driver.status,
          driver.hired_at
        ]
      );
      console.log('[Admin Delivery] Driver added:', driver.id, driver.name, 'farm:', farmId);
      return res.json({ success: true, driver });
    } catch (error) {
      console.error('[Admin Delivery] Driver create failed:', error);
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  deliveryConfig.drivers.push(driver);
  console.log('[Admin Delivery] Driver added (in-memory):', driver.id, driver.name);
  return res.json({ success: true, driver });
});

/**
 * PUT /drivers/:id - Update a driver
 */
router.put('/drivers/:id', async (req, res) => {
  const farmId = extractFarmId(req);
  if (!farmId) {
    return res.status(400).json({ success: false, error: 'farm_id is required' });
  }

  const driverId = req.params.id;
  const { name, phone, vehicle, zones, email, status, pay_per_delivery, cold_chain_bonus, cold_chain_certified } = req.body;

  if (isDatabaseAvailable()) {
    try {
      const existing = await query(
        `SELECT * FROM delivery_drivers WHERE farm_id = $1 AND driver_id = $2 LIMIT 1`,
        [farmId, driverId]
      );
      if (!existing.rows.length) {
        return res.status(404).json({ success: false, error: 'Driver not found' });
      }

      const row = existing.rows[0];
      await query(
        `UPDATE delivery_drivers
            SET name = $3,
                phone = $4,
                email = $5,
                vehicle = $6,
                zones = $7::jsonb,
                status = $8,
                pay_per_delivery = $9,
                cold_chain_bonus = $10,
                cold_chain_certified = $11,
                updated_at = NOW()
          WHERE farm_id = $1
            AND driver_id = $2`,
        [
          farmId,
          driverId,
          name !== undefined ? name : row.name,
          phone !== undefined ? phone : row.phone,
          email !== undefined ? email : row.email,
          vehicle !== undefined ? vehicle : row.vehicle,
          JSON.stringify(zones !== undefined ? zones : (Array.isArray(row.zones) ? row.zones : [])),
          status !== undefined ? status : row.status,
          pay_per_delivery !== undefined ? Math.max(0, Number(pay_per_delivery) || 0) : row.pay_per_delivery,
          cold_chain_bonus !== undefined ? Math.max(0, Number(cold_chain_bonus) || 0) : row.cold_chain_bonus,
          cold_chain_certified !== undefined ? Boolean(cold_chain_certified) : row.cold_chain_certified
        ]
      );

      const updated = await getDriversForFarm(farmId);
      const driver = updated.find(d => d.id === driverId);
      console.log('[Admin Delivery] Driver updated:', driverId, 'farm:', farmId);
      return res.json({ success: true, driver });
    } catch (error) {
      console.error('[Admin Delivery] Driver update failed:', error);
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  const driver = deliveryConfig.drivers.find(d => d.id === driverId);
  if (!driver) {
    return res.status(404).json({ success: false, error: 'Driver not found' });
  }

  if (name !== undefined) driver.name = name;
  if (phone !== undefined) driver.phone = phone;
  if (email !== undefined) driver.email = email;
  if (vehicle !== undefined) driver.vehicle = vehicle;
  if (zones !== undefined) driver.zones = zones;
  if (status !== undefined) driver.status = status;
  if (pay_per_delivery !== undefined) driver.pay_per_delivery = Math.max(0, Number(pay_per_delivery) || 0);
  if (cold_chain_bonus !== undefined) driver.cold_chain_bonus = Math.max(0, Number(cold_chain_bonus) || 0);
  if (cold_chain_certified !== undefined) driver.cold_chain_certified = Boolean(cold_chain_certified);
  driver.updated_at = new Date().toISOString();

  console.log('[Admin Delivery] Driver updated (in-memory):', driver.id);
  return res.json({ success: true, driver });
});

/**
 * GET /fees - Get fee distribution summary
 */
router.get('/fees', async (req, res) => {
  try {
    const farmId = extractFarmId(req);
    if (!farmId) {
      return res.status(400).json({ success: false, error: 'farm_id is required' });
    }

    const { stats, recent_fees } = await getDeliveryStatsForFarm(farmId);
    return res.json({
      success: true,
      stats,
      recent_fees
    });
  } catch (error) {
    console.error('[Admin Delivery] Fee stats failed:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /driver-payouts - Driver payout ledger
 * Query: farm_id (required), driver_id?, from?, to?
 */
router.get('/driver-payouts', async (req, res) => {
  try {
    const farmId = extractFarmId(req);
    if (!farmId) {
      return res.status(400).json({ success: false, error: 'farm_id is required' });
    }
    if (!isDatabaseAvailable()) {
      return res.json({ success: true, payouts: [] });
    }

    const { driver_id, from, to } = req.query;
    const values = [farmId];
    const clauses = ['farm_id = $1'];

    if (driver_id) {
      values.push(driver_id);
      clauses.push(`driver_id = $${values.length}`);
    }
    if (from) {
      values.push(from);
      clauses.push(`created_at >= $${values.length}::timestamptz`);
    }
    if (to) {
      values.push(to);
      clauses.push(`created_at <= $${values.length}::timestamptz`);
    }

    const result = await query(
      `SELECT id, farm_id, driver_id, delivery_id, order_id,
              base_amount, cold_chain_bonus, tip_amount, total_payout,
              payout_status, payout_method, paid_at, created_at, updated_at
         FROM driver_payouts
        WHERE ${clauses.join(' AND ')}
        ORDER BY created_at DESC
        LIMIT 500`,
      values
    );

    return res.json({ success: true, payouts: result.rows });
  } catch (error) {
    console.error('[Admin Delivery] Driver payouts list failed:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PATCH /driver-payouts/:id - Mark payout as paid / update payout status
 * Body: { farm_id, payout_status?, payout_method? }
 */
router.patch('/driver-payouts/:id', async (req, res) => {
  try {
    const farmId = extractFarmId(req);
    if (!farmId) {
      return res.status(400).json({ success: false, error: 'farm_id is required' });
    }
    if (!isDatabaseAvailable()) {
      return res.status(503).json({ success: false, error: 'Database unavailable' });
    }

    const payoutId = Number(req.params.id);
    if (!Number.isFinite(payoutId) || payoutId <= 0) {
      return res.status(400).json({ success: false, error: 'Invalid payout id' });
    }

    const payoutStatus = String(req.body?.payout_status || 'paid').toLowerCase();
    const payoutMethod = req.body?.payout_method || null;
    const paidAt = payoutStatus === 'paid' ? new Date().toISOString() : null;

    const result = await query(
      `UPDATE driver_payouts
          SET payout_status = $3,
              payout_method = COALESCE($4, payout_method),
              paid_at = CASE WHEN $3 = 'paid' THEN COALESCE($5::timestamptz, NOW()) ELSE NULL END,
              updated_at = NOW()
        WHERE id = $1
          AND farm_id = $2
      RETURNING *`,
      [payoutId, farmId, payoutStatus, payoutMethod, paidAt]
    );

    if (!result.rows.length) {
      return res.status(404).json({ success: false, error: 'Payout not found' });
    }

    return res.json({ success: true, payout: result.rows[0] });
  } catch (error) {
    console.error('[Admin Delivery] Driver payout update failed:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// NOTE: /readiness endpoint is defined above the requireAdminRole middleware
// so all authenticated admins can access it (dashboard KPI, read-only)

export default router;
