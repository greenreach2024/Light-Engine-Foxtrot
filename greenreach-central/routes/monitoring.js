/**
 * Monitoring Routes
 * Real-time environment monitoring: sensor data, device status, room conditions.
 */
import express from 'express';
import { getInMemoryStore } from './sync.js';
import { query, isDatabaseAvailable } from '../config/database.js';

const router = express.Router();

/**
 * GET /api/monitoring/
 * Returns latest telemetry snapshot for the authenticated farm.
 */
router.get('/', (req, res) => {
  try {
    const farmId = req.farmId;
    const store = getInMemoryStore();

    if (!farmId) {
      // Admin view — list all farms with telemetry
      const farmIds = [...(store.telemetry?.keys() || [])];
      return res.json({
        success: true,
        farms: farmIds.map(fid => ({
          farm_id: fid,
          hasData: !!(store.telemetry?.get(fid)),
        })),
        total: farmIds.length,
      });
    }

    const telemetry = store.telemetry?.get(farmId) || null;
    const rooms = store.rooms?.get(farmId) || [];
    const groups = store.groups?.get(farmId) || [];
    const devices = store.devices?.get(farmId) || [];

    res.json({
      success: true,
      farmId,
      telemetry,
      rooms: rooms.length,
      groups: groups.length,
      devices: devices.length,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[Monitoring] Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load monitoring data' });
  }
});

/**
 * GET /api/monitoring/rooms
 * Returns room list with latest sensor readings.
 */
router.get('/rooms', (req, res) => {
  try {
    const farmId = req.farmId;
    const store = getInMemoryStore();
    const rooms = store.rooms?.get(farmId) || [];
    res.json({ success: true, rooms, total: rooms.length });
  } catch (err) {
    console.error('[Monitoring] Rooms error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load rooms' });
  }
});

/**
 * GET /api/monitoring/devices
 * Returns device list for the farm.
 */
router.get('/devices', (req, res) => {
  try {
    const farmId = req.farmId;
    const store = getInMemoryStore();
    const devices = store.devices?.get(farmId) || [];
    res.json({ success: true, devices, total: devices.length });
  } catch (err) {
    console.error('[Monitoring] Devices error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load devices' });
  }
});

/**
 * GET /api/monitoring/heartbeats
 * Returns recent heartbeat records from DB.
 */
router.get('/heartbeats', async (req, res) => {
  try {
    const farmId = req.farmId;
    const limit = Math.min(100, parseInt(req.query.limit) || 20);

    if (!isDatabaseAvailable()) {
      return res.json({ success: true, heartbeats: [], message: 'Database not available' });
    }

    const result = farmId
      ? await query(
          `SELECT * FROM farm_heartbeats WHERE farm_id = $1 ORDER BY timestamp DESC LIMIT $2`,
          [farmId, limit]
        )
      : await query(
          'SELECT * FROM farm_heartbeats ORDER BY timestamp DESC LIMIT $1',
          [limit]
        );

    res.json({ success: true, heartbeats: result.rows, total: result.rows.length });
  } catch (err) {
    console.error('[Monitoring] Heartbeats error:', err.message);
    res.json({ success: true, heartbeats: [], message: 'Heartbeat data not available' });
  }
});

export default router;
