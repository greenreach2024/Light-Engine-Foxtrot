/**
 * Billing Routes (Cloud)
 * Provides usage/limits endpoints for farm admin UI
 */
import express from 'express';
import { query, isDatabaseAvailable } from '../config/database.js';
import { listPayments, listAllOrders } from '../services/wholesaleMemoryStore.js';

const router = express.Router();

/**
 * GET /api/billing/receipts
 * Return billing receipts derived from payment records + orders.
 * Query params: ?page=1&limit=20&status=created
 */
router.get('/receipts', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const statusFilter = req.query.status || null;

    const farmId = req.farmId || null;
    const payments = listPayments() || [];
    const orders = await listAllOrders({ page: 1, limit: 50000 });
    const orderMap = new Map((orders || []).map(o => [o.master_order_id, o]));

    // Build receipt objects from payments, filtered to logged-in farm
    let receipts = payments
      .filter(p => {
        if (!farmId) return true;
        // Purchase payments store farm_id in metadata
        if (p.farm_id) return p.farm_id === farmId;
        // Wholesale payments: check if order has a sub-order for this farm
        const order = orderMap.get(p.order_id);
        if (order && order.farm_sub_orders) {
          return order.farm_sub_orders.some(sub => sub.farm_id === farmId);
        }
        return false;
      })
      .map(p => {
        const order = orderMap.get(p.order_id) || {};
        return {
          receipt_id: p.payment_id,
          order_id: p.order_id,
          date: p.created_at,
          amount: p.amount,
          currency: p.currency || 'CAD',
          status: p.status,
          provider: p.provider,
          broker_fee: p.broker_fee_amount || 0,
          net_to_farms: p.net_to_farms_total || 0,
          buyer_id: order.buyer_id || null,
          order_status: order.status || null,
          items_count: (order.farm_sub_orders || []).reduce(
            (sum, sub) => sum + (sub.items || []).length, 0
          ),
        };
      });

    if (statusFilter) {
      receipts = receipts.filter(r => r.status === statusFilter);
    }

    const total = receipts.length;
    const start = (page - 1) * limit;
    const pageReceipts = receipts.slice(start, start + limit);

    res.json({
      status: 'ok',
      receipts: pageReceipts,
      total,
      pagination: { page, pageSize: limit, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    console.error('[Billing] Receipts error:', err.message);
    res.status(500).json({ status: 'error', message: 'Failed to load receipts' });
  }
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
    let apiCallsToday = 0;
    let storageBytes = 0;

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

      // API call count for today
      try {
        const callResult = await query(
          'SELECT api_calls FROM api_usage_daily WHERE farm_id = $1 AND usage_date = CURRENT_DATE',
          [farmId]
        );
        apiCallsToday = parseInt(callResult.rows[0]?.api_calls || 0);
      } catch { /* table may not exist yet */ }

      // Storage: sum JSONB data size for this farm
      try {
        const storageResult = await query(
          'SELECT COALESCE(SUM(pg_column_size(data)), 0)::bigint AS total_bytes FROM farm_data WHERE farm_id = $1',
          [farmId]
        );
        storageBytes = parseInt(storageResult.rows[0]?.total_bytes || 0);
      } catch { /* table may not exist */ }
    }

    const storageGb = Math.round((storageBytes / (1024 * 1024 * 1024)) * 1000) / 1000;

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
        api_calls_today: apiCallsToday,
        storage_gb: storageGb,
      },
      metering_available: true,
      overages: {
        devices: Math.max(0, deviceCount - 50),
        api_calls: Math.max(0, apiCallsToday - 10000),
        storage_gb: Math.max(0, storageGb - 5),
      },
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
