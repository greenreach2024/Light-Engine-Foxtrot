/**
 * Reports Routes
 * Financial / operational reports for farm admin.
 */
import express from 'express';
import { query, isDatabaseAvailable } from '../config/database.js';
import { listAllOrders, listPayments, listAllBuyers } from '../services/wholesaleMemoryStore.js';

const router = express.Router();

/**
 * Parse an optional ISO date (YYYY-MM-DD) from a query param. Returns null
 * when the value is absent or unparseable so callers can decide whether to
 * apply a default window.
 */
function parseDateParam(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

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
      return sum + Number(o.grand_total || o.totals?.grand_total || o.totals?.subtotal || 0);
    }, 0);

    const brokerFeeTotal = (orders || []).reduce((sum, o) => {
      return sum + Number(o.broker_fee_total || o.totals?.broker_fee_total || 0);
    }, 0);

    const totalPayments = payments.reduce((sum, p) => sum + (p.amount || 0), 0);

    const orderCount = (orders || []).length;
    const avgOrderValue = orderCount > 0 ? totalRevenue / orderCount : 0;

    // Diagnostics — surface whether wholesale orders are actually landing in
    // the DB. A silent persistOrder() failure (it has a .catch that only
    // console.errors) would otherwise look identical to "no orders yet".
    // We re-query the DB here so the dashboard can show "N in DB vs M in
    // memory" and the operator can tell a persist failure from an empty
    // store. On failure we still return the main payload.
    let diagnostics = { db_available: isDatabaseAvailable() };
    if (isDatabaseAvailable()) {
      try {
        const dbCountRes = await query('SELECT COUNT(*)::int AS c FROM wholesale_orders');
        diagnostics.orders_in_db = dbCountRes.rows?.[0]?.c ?? 0;
        diagnostics.orders_returned = orderCount;
        diagnostics.payments_in_memory = payments.length;
      } catch (err) {
        diagnostics.db_error = err.message;
      }
    }

    res.json({
      success: true,
      report: 'revenue-summary',
      data: {
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        totalPayments: Math.round(totalPayments * 100) / 100,
        orderCount,
        avgOrderValue: Math.round(avgOrderValue * 100) / 100,
        brokerFeeTotal: Math.round(brokerFeeTotal * 100) / 100,
        outstanding: Math.round((totalRevenue - totalPayments) * 100) / 100,
      },
      diagnostics,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[Reports] Revenue summary error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to generate revenue summary' });
  }
});

/**
 * GET /api/reports/subscription-revenue
 * Aggregates completed Light Engine subscription checkouts.
 *
 * Source of truth: checkout_sessions table (see routes/purchase.js). A row
 * lands here the moment we create a Square Payment Link, and is updated
 * to status='completed' once provisioning succeeds (either via the
 * browser-based return path or the 2-minute reconciler in PR #84/#85).
 * That's the same set of rows that produced farms in admin, so summing
 * them matches cash received.
 *
 * Query params:
 *   from, to (YYYY-MM-DD, optional) — inclusive range on completed_at.
 *     Defaults to "no lower bound .. now" which gives a lifetime total.
 */
router.get('/subscription-revenue', async (req, res) => {
  try {
    if (!isDatabaseAvailable()) {
      return res.json({
        success: true,
        report: 'subscription-revenue',
        data: {
          totalRevenue: 0,
          totalSubscriptions: 0,
          byPlan: {},
          recentSessions: [],
        },
        diagnostics: { db_available: false, reason: 'Database not available' },
        generatedAt: new Date().toISOString(),
      });
    }

    const fromDate = parseDateParam(req.query.from);
    const toDate = parseDateParam(req.query.to);

    const where = ["status = 'completed'"];
    const params = [];
    if (fromDate) {
      params.push(fromDate.toISOString());
      where.push(`completed_at >= $${params.length}`);
    }
    if (toDate) {
      // Inclusive end-of-day: bump to the next day at 00:00 UTC.
      const toBoundary = new Date(toDate.getTime() + 24 * 60 * 60 * 1000);
      params.push(toBoundary.toISOString());
      where.push(`completed_at < $${params.length}`);
    }
    const whereSql = where.join(' AND ');

    const totalsRes = await query(
      `SELECT
         COALESCE(SUM(amount_cents), 0)::bigint AS total_cents,
         COUNT(*)::int AS count,
         currency
       FROM checkout_sessions
       WHERE ${whereSql}
       GROUP BY currency`,
      params
    );
    const byCurrency = {};
    let totalCentsAllCurrencies = 0;
    let totalCount = 0;
    for (const row of totalsRes.rows || []) {
      const cents = Number(row.total_cents) || 0;
      byCurrency[row.currency || 'CAD'] = {
        totalCents: cents,
        total: Math.round(cents) / 100,
        count: Number(row.count) || 0,
      };
      totalCentsAllCurrencies += cents;
      totalCount += Number(row.count) || 0;
    }

    const byPlanRes = await query(
      `SELECT plan_type, currency,
              COALESCE(SUM(amount_cents), 0)::bigint AS total_cents,
              COUNT(*)::int AS count
       FROM checkout_sessions
       WHERE ${whereSql}
       GROUP BY plan_type, currency
       ORDER BY plan_type`,
      params
    );
    const byPlan = {};
    for (const row of byPlanRes.rows || []) {
      const plan = row.plan_type || 'unknown';
      const cents = Number(row.total_cents) || 0;
      byPlan[plan] = byPlan[plan] || { totalCents: 0, total: 0, count: 0, currency: row.currency || 'CAD' };
      byPlan[plan].totalCents += cents;
      byPlan[plan].total = Math.round(byPlan[plan].totalCents) / 100;
      byPlan[plan].count += Number(row.count) || 0;
    }

    const recentRes = await query(
      `SELECT session_id, plan_type, amount_cents, currency, farm_name,
              email, provisioned_farm_id, status, completed_at, created_at
       FROM checkout_sessions
       WHERE ${whereSql}
       ORDER BY completed_at DESC NULLS LAST, created_at DESC
       LIMIT 50`,
      params
    );

    // Also show pending/errored sessions so the operator can spot stranded
    // payments the reconciler hasn't cleared yet — this is exactly the
    // "subscription fees not showing up" class of issue.
    const strandedRes = await query(
      `SELECT session_id, plan_type, amount_cents, currency, farm_name,
              email, status, error_message, created_at
       FROM checkout_sessions
       WHERE status IN ('pending', 'paid', 'error')
         AND created_at >= NOW() - INTERVAL '30 days'
       ORDER BY created_at DESC
       LIMIT 50`
    );

    res.json({
      success: true,
      report: 'subscription-revenue',
      data: {
        totalCents: totalCentsAllCurrencies,
        totalRevenue: Math.round(totalCentsAllCurrencies) / 100,
        totalSubscriptions: totalCount,
        byCurrency,
        byPlan,
        recentSessions: recentRes.rows || [],
        strandedSessions: strandedRes.rows || [],
      },
      diagnostics: {
        db_available: true,
        from: fromDate ? fromDate.toISOString() : null,
        to: toDate ? toDate.toISOString() : null,
      },
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[Reports] Subscription revenue error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to generate subscription revenue report' });
  }
});

/**
 * GET /api/reports/data-charges
 * Stub. We don't yet meter data egress / MQTT message count / API-hit
 * billing. Returning {available:false} lets the dashboard show an
 * explicit "Not yet wired" tile instead of a silent $0 the operator
 * would reasonably interpret as "no charges this period". When a
 * metering source is added (Cloud Run egress pull, a metering table,
 * a billing provider webhook), replace this stub with the real
 * aggregation.
 */
router.get('/data-charges', async (_req, res) => {
  res.json({
    success: true,
    report: 'data-charges',
    data: {
      totalCharges: 0,
      available: false,
      reason: 'Data-charge metering not yet wired. See docs/roadmap for metering source.',
    },
    generatedAt: new Date().toISOString(),
  });
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

/**
 * GET /api/reports/buyer-analytics
 * Top buyers, order frequency, lifetime value.
 * Aggregates from wholesale orders + buyer records.
 */
router.get('/buyer-analytics', async (_req, res) => {
  try {
    const orders = await listAllOrders({ page: 1, limit: 50000 });
    const buyers = listAllBuyers() || [];
    const list = orders || [];

    // Aggregate per buyer
    const buyerStats = new Map();
    for (const o of list) {
      const bid = o.buyer_id;
      if (!bid) continue;
      const totals = o.totals || {};
      const orderTotal = totals.total || totals.grand_total || totals.subtotal || 0;
      if (!buyerStats.has(bid)) {
        buyerStats.set(bid, { buyer_id: bid, orders: 0, totalSpend: 0, firstOrder: o.created_at, lastOrder: o.created_at });
      }
      const s = buyerStats.get(bid);
      s.orders += 1;
      s.totalSpend += orderTotal;
      if (o.created_at < s.firstOrder) s.firstOrder = o.created_at;
      if (o.created_at > s.lastOrder) s.lastOrder = o.created_at;
    }

    // Enrich with buyer name/type
    const buyerMap = new Map(buyers.map(b => [b.id, b]));
    const topBuyers = Array.from(buyerStats.values())
      .map(s => {
        const buyer = buyerMap.get(s.buyer_id) || {};
        return {
          buyer_id: s.buyer_id,
          businessName: buyer.businessName || buyer.business_name || 'Unknown',
          buyerType: buyer.buyerType || buyer.buyer_type || null,
          totalOrders: s.orders,
          totalSpend: Math.round(s.totalSpend * 100) / 100,
          avgOrderValue: s.orders > 0 ? Math.round((s.totalSpend / s.orders) * 100) / 100 : 0,
          firstOrderDate: s.firstOrder,
          lastOrderDate: s.lastOrder,
        };
      })
      .sort((a, b) => b.totalSpend - a.totalSpend);

    const activeBuyers = buyers.filter(b => b.status === 'active' || !b.status).length;

    res.json({
      success: true,
      report: 'buyer-analytics',
      data: {
        totalBuyers: buyers.length,
        activeBuyers,
        topBuyers: topBuyers.slice(0, 20),
        buyersWithOrders: buyerStats.size,
        totalLifetimeValue: Math.round(topBuyers.reduce((s, b) => s + b.totalSpend, 0) * 100) / 100,
      },
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[Reports] Buyer analytics error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to generate buyer analytics report' });
  }
});

export default router;
