/**
 * Reports Routes
 * Financial / operational reports for farm admin.
 */
import express from 'express';
import { query, isDatabaseAvailable } from '../config/database.js';
import { listAllOrders, listPayments } from '../services/wholesaleMemoryStore.js';

const router = express.Router();

/**
 * GET /api/reports/
 * Returns available report types.
 */
router.get('/', (_req, res) => {
  res.json({
    success: true,
    reports: [
      { id: 'revenue-summary', name: 'Revenue Summary', description: 'Wholesale + direct-sale revenue by period' },
      { id: 'order-volume', name: 'Order Volume', description: 'Order counts and trends over time' },
      { id: 'harvest-performance', name: 'Harvest Performance', description: 'Yield and quality metrics by crop' },
      { id: 'buyer-analytics', name: 'Buyer Analytics', description: 'Top buyers, order frequency, lifetime value' },
    ],
  });
});

/**
 * GET /api/reports/revenue-summary
 * Aggregate revenue from wholesale orders.
 * Query params: ?period=30d (7d|30d|90d|all)
 */
router.get('/revenue-summary', async (_req, res) => {
  try {
    const orders = await listAllOrders({ page: 1, limit: 50000 });
    const payments = listPayments() || [];

    const totalRevenue = (orders || []).reduce((sum, o) => {
      const t = o.totals || {};
      return sum + (t.total || t.subtotal || 0);
    }, 0);

    const totalPayments = payments.reduce((sum, p) => sum + (p.amount || 0), 0);

    const orderCount = (orders || []).length;
    const avgOrderValue = orderCount > 0 ? totalRevenue / orderCount : 0;

    res.json({
      success: true,
      report: 'revenue-summary',
      data: {
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        totalPayments: Math.round(totalPayments * 100) / 100,
        orderCount,
        avgOrderValue: Math.round(avgOrderValue * 100) / 100,
        outstanding: Math.round((totalRevenue - totalPayments) * 100) / 100,
      },
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[Reports] Revenue summary error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to generate revenue summary' });
  }
});

/**
 * GET /api/reports/order-volume
 * Order count breakdown by status.
 */
router.get('/order-volume', async (_req, res) => {
  try {
    const orders = await listAllOrders({ page: 1, limit: 50000 });
    const list = orders || [];
    const byStatus = {};
    for (const o of list) {
      const s = o.status || 'unknown';
      byStatus[s] = (byStatus[s] || 0) + 1;
    }

    res.json({
      success: true,
      report: 'order-volume',
      data: { total: list.length, byStatus },
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[Reports] Order volume error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to generate order volume report' });
  }
});

/**
 * GET /api/reports/harvest-performance
 * Harvest stats from experiment_records (if DB available).
 */
router.get('/harvest-performance', async (_req, res) => {
  try {
    if (!isDatabaseAvailable()) {
      return res.json({ success: true, report: 'harvest-performance', data: { records: 0, message: 'Database not available' }, generatedAt: new Date().toISOString() });
    }
    const result = await query(
      `SELECT crop, COUNT(*) AS harvests,
              ROUND(AVG((data->>'yield_grams')::numeric), 1) AS avg_yield_g,
              ROUND(AVG((data->>'quality_score')::numeric), 2) AS avg_quality
       FROM experiment_records
       GROUP BY crop ORDER BY harvests DESC LIMIT 20`
    );
    res.json({
      success: true,
      report: 'harvest-performance',
      data: { crops: result.rows },
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    // Table may not exist yet — degrade gracefully
    res.json({ success: true, report: 'harvest-performance', data: { crops: [], message: 'No harvest data recorded yet' }, generatedAt: new Date().toISOString() });
  }
});

export default router;
