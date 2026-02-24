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

const router = express.Router();

// Protect all admin delivery routes: require authenticated admin with 'admin' or 'operations' role
router.use(adminAuthMiddleware);
router.use(requireAdminRole('admin', 'operations'));

// In-memory store (will be replaced with database in Phase 0.3 migration)
const deliveryConfig = {
  enabled: true,
  base_fee: 0,
  min_order: 25,
  zones: [
    { id: 'ZONE_A', name: 'Zone A — Local', description: '0-10 km from farm', fee: 0, min_order: 25, windows: ['morning', 'afternoon', 'evening'], status: 'active' },
    { id: 'ZONE_B', name: 'Zone B — Regional', description: '10-25 km from farm', fee: 5, min_order: 35, windows: ['morning', 'afternoon'], status: 'active' },
    { id: 'ZONE_C', name: 'Zone C — Extended', description: '25-50 km from farm', fee: 10, min_order: 50, windows: ['morning'], status: 'active' }
  ],
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
 * GET /config - Get full delivery configuration
 */
router.get('/config', (req, res) => {
  res.json({
    success: true,
    config: deliveryConfig
  });
});

/**
 * PUT /config - Update global delivery settings
 */
router.put('/config', (req, res) => {
  const { base_fee, min_order, enabled } = req.body;
  
  if (base_fee !== undefined) deliveryConfig.base_fee = parseFloat(base_fee);
  if (min_order !== undefined) deliveryConfig.min_order = parseFloat(min_order);
  if (enabled !== undefined) deliveryConfig.enabled = enabled;
  
  console.log('[Admin Delivery] Config updated:', { base_fee: deliveryConfig.base_fee, min_order: deliveryConfig.min_order, enabled: deliveryConfig.enabled });
  
  res.json({
    success: true,
    config: deliveryConfig
  });
});

/**
 * GET /zones - List delivery zones
 */
router.get('/zones', (req, res) => {
  res.json({
    success: true,
    zones: deliveryConfig.zones
  });
});

/**
 * POST /zones - Create a new delivery zone
 */
router.post('/zones', (req, res) => {
  const { id, name, description, fee, min_order, windows, status } = req.body;
  
  if (!id || !name) {
    return res.status(400).json({ success: false, error: 'Zone id and name are required' });
  }
  
  if (deliveryConfig.zones.find(z => z.id === id)) {
    return res.status(409).json({ success: false, error: `Zone ${id} already exists` });
  }
  
  const zone = {
    id,
    name,
    description: description || '',
    fee: parseFloat(fee || 0),
    min_order: parseFloat(min_order || 25),
    windows: windows || ['morning', 'afternoon', 'evening'],
    status: status || 'active',
    created_at: new Date().toISOString()
  };
  
  deliveryConfig.zones.push(zone);
  console.log('[Admin Delivery] Zone created:', zone.id);
  
  res.json({ success: true, zone });
});

/**
 * PUT /zones/:id - Update a delivery zone
 */
router.put('/zones/:id', (req, res) => {
  const zone = deliveryConfig.zones.find(z => z.id === req.params.id);
  if (!zone) {
    return res.status(404).json({ success: false, error: 'Zone not found' });
  }
  
  const { name, description, fee, min_order, windows, status } = req.body;
  if (name !== undefined) zone.name = name;
  if (description !== undefined) zone.description = description;
  if (fee !== undefined) zone.fee = parseFloat(fee);
  if (min_order !== undefined) zone.min_order = parseFloat(min_order);
  if (windows !== undefined) zone.windows = windows;
  if (status !== undefined) zone.status = status;
  zone.updated_at = new Date().toISOString();
  
  console.log('[Admin Delivery] Zone updated:', zone.id);
  res.json({ success: true, zone });
});

/**
 * DELETE /zones/:id - Remove a delivery zone
 */
router.delete('/zones/:id', (req, res) => {
  const idx = deliveryConfig.zones.findIndex(z => z.id === req.params.id);
  if (idx === -1) {
    return res.status(404).json({ success: false, error: 'Zone not found' });
  }
  
  const removed = deliveryConfig.zones.splice(idx, 1)[0];
  console.log('[Admin Delivery] Zone deleted:', removed.id);
  res.json({ success: true, deleted: removed.id });
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

export default router;
