/**
 * Billing Routes (Cloud)
 * Provides usage/limits endpoints for farm admin UI
 */
import express from 'express';
import { query, isDatabaseAvailable } from '../config/database.js';

const router = express.Router();

/**
 * GET /api/billing/receipts
 * Return billing receipts (stub — no payment system configured yet)
 */
router.get('/receipts', (req, res) => {
  res.json({
    status: 'ok',
    receipts: [],
    total: 0
  });
});

/**
 * GET /api/billing/usage/:farmId
 * Return usage and limits (cloud)
 * Queries actual farm data to report real usage metrics.
 */
router.get('/usage/:farmId', async (req, res) => {
  const { farmId } = req.params;

  if (!farmId) {
    return res.status(400).json({ status: 'error', message: 'Farm ID required' });
  }

  try {
    let deviceCount = 0;
    let dataTypes = 0;

    // Count devices and data types from farmStore
    if (req.farmStore) {
      const devices = await req.farmStore.get(farmId, 'devices');
      deviceCount = Array.isArray(devices) ? devices.length : 0;
    }

    // Count data types stored in DB
    if (isDatabaseAvailable()) {
      try {
        const dtResult = await query(
          'SELECT COUNT(DISTINCT data_type) AS count FROM farm_data WHERE farm_id = $1',
          [farmId]
        );
        dataTypes = parseInt(dtResult.rows[0]?.count || 0);
      } catch { /* table may not exist */ }
    }

    return res.json({
      status: 'ok',
      dataAvailable: true,
      plan: 'pilot',
      limits: {
        devices: 50,
        api_calls_per_day: 10000,
        storage_gb: 5,
      },
      usage: {
        devices: deviceCount,
        data_types: dataTypes,
        api_calls_today: null, // requires request-counter middleware
        storage_gb: null,
      },
      renewsAt: null,
      overages: { devices: 0, api_calls: 0, storage: 0 },
    });
  } catch (err) {
    console.error('[Billing] Usage error:', err.message);
    return res.json({
      status: 'error',
      dataAvailable: false,
      message: 'Failed to compute usage',
    });
  }
});

export default router;
