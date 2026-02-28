/**
 * Orders Routes
 * Farm-scoped order views: wholesale sub-orders assigned to the requesting farm,
 * plus direct-sale orders (when available).
 */
import express from 'express';
import { query, isDatabaseAvailable } from '../config/database.js';
import { listAllOrders } from '../services/wholesaleMemoryStore.js';

const router = express.Router();

/**
 * GET /api/orders/
 * Returns orders visible to the authenticated farm.
 * Query params: ?status=confirmed&page=1&limit=20
 */
router.get('/', async (req, res) => {
  try {
    const farmId = req.farmId;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const statusFilter = req.query.status || null;

    // Pull from wholesale memory store (includes DB fallback)
    const allOrders = await listAllOrders({ page: 1, limit: 10000, status: statusFilter });
    const orders = allOrders || [];

    // Filter to orders containing sub-orders for this farm
    const farmOrders = farmId
      ? orders.filter(o => {
          const subs = o.farmSubOrders || o.farm_sub_orders || [];
          return subs.some(s => s.farm_id === farmId || s.farmId === farmId);
        })
      : orders;

    // Paginate
    const total = farmOrders.length;
    const start = (page - 1) * limit;
    const pageOrders = farmOrders.slice(start, start + limit);

    // Summarize
    const summary = {
      total,
      confirmed: farmOrders.filter(o => o.status === 'confirmed').length,
      pending: farmOrders.filter(o => (o.status || '').includes('pending')).length,
      shipped: farmOrders.filter(o => o.status === 'shipped').length,
      delivered: farmOrders.filter(o => o.status === 'delivered').length,
    };

    res.json({
      success: true,
      orders: pageOrders,
      pagination: { page, pageSize: limit, totalItems: total, totalPages: Math.ceil(total / limit) },
      summary,
    });
  } catch (err) {
    console.error('[Orders] Error listing orders:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load orders' });
  }
});

/**
 * GET /api/orders/:orderId
 * Return a single order by master_order_id.
 */
router.get('/:orderId', async (req, res) => {
  try {
    const allOrders = await listAllOrders({ page: 1, limit: 10000 });
    const order = (allOrders || []).find(
      o => o.master_order_id === req.params.orderId || o.id === req.params.orderId
    );
    if (!order) return res.status(404).json({ success: false, error: 'Order not found' });
    res.json({ success: true, order });
  } catch (err) {
    console.error('[Orders] Error fetching order:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load order' });
  }
});

export default router;
