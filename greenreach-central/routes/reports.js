/**
 * Reports Routes
 * Financial / operational reports for farm admin.
 */
import express from 'express';
import { query, isDatabaseAvailable } from '../config/database.js';
import { listAllOrders, listPayments, listAllBuyers } from '../services/wholesaleMemoryStore.js';
import { adminAuthMiddleware } from '../middleware/adminAuth.js';

const router = express.Router();

/**
 * Ensure the data_charges table exists. Called lazily from the
 * /data-charges endpoints so we don't need a migration file to start
 * ingesting.
 *
 * One row per (farm_id, period_start, period_end, source). `amount_usd`
 * is the authoritative billable amount. `bytes_egress` and `api_calls`
 * are optional breakdowns — whatever the ingesting source can measure
 * for attribution. `source` is a free-form label (e.g. 'cloud_run_egress',
 * 'mqtt_counter', 'vertex_ai_usage') so the reader can break charges out
 * by origin.
 */
async function ensureDataChargesTable() {
  if (!isDatabaseAvailable()) return false;
  try {
    // farm_id is NOT NULL DEFAULT '' (not nullable) so the composite UNIQUE
    // constraint below actually enforces idempotency: in PostgreSQL, NULLs
    // are treated as distinct in UNIQUE constraints, which would make the
    // ON CONFLICT upsert a no-op for system-wide (unattributable) charges
    // and silently create duplicates on re-ingest. The empty-string
    // sentinel '' means "not attributable to any single farm" — callers
    // that omit farm_id have their value coerced to '' before insert.
    await query(`
      CREATE TABLE IF NOT EXISTS data_charges (
        id SERIAL PRIMARY KEY,
        farm_id VARCHAR(255) NOT NULL DEFAULT '',
        period_start TIMESTAMPTZ NOT NULL,
        period_end TIMESTAMPTZ NOT NULL,
        bytes_egress BIGINT DEFAULT 0,
        api_calls BIGINT DEFAULT 0,
        amount_usd NUMERIC(12,4) NOT NULL DEFAULT 0,
        source VARCHAR(64) NOT NULL DEFAULT 'manual',
        note TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(farm_id, period_start, period_end, source)
      )
    `);
    // Best-effort in-place migration for an older deploy that created the
    // table with a nullable farm_id. Safe to run every boot: the UPDATE is
    // a no-op when nothing is NULL, and the ALTERs succeed idempotently.
    try {
      await query(`UPDATE data_charges SET farm_id = '' WHERE farm_id IS NULL`);
      await query(`ALTER TABLE data_charges ALTER COLUMN farm_id SET DEFAULT ''`);
      await query(`ALTER TABLE data_charges ALTER COLUMN farm_id SET NOT NULL`);
    } catch (_) { /* older shapes or permission quirks — non-fatal */ }
    await query(`CREATE INDEX IF NOT EXISTS idx_data_charges_period_end ON data_charges(period_end)`);
    return true;
  } catch (err) {
    console.warn('[Reports] ensureDataChargesTable failed:', err.message);
    return false;
  }
}

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
 *
 * Aggregates data-usage charges from the `data_charges` table. The table
 * is populated by whichever operational script knows the metering source
 * (Cloud Run egress export, MQTT message counter, Vertex AI usage, etc.)
 * via POST /api/reports/data-charges/ingest below.
 *
 * Query params:
 *   from, to  (YYYY-MM-DD, optional) — inclusive window on period_end.
 *             Defaults to "no lower bound .. now" for lifetime total.
 *   farm_id   (optional) — scope to a single farm.
 *
 * When the DB is unavailable or no rows exist in the requested window,
 * returns `available:false` with a clear reason string so the dashboard
 * can render "Not yet wired" instead of a silent $0.
 */
router.get('/data-charges', async (req, res) => {
  try {
    if (!isDatabaseAvailable()) {
      return res.json({
        success: true,
        report: 'data-charges',
        data: { totalCharges: 0, available: false, reason: 'Database not available' },
        generatedAt: new Date().toISOString(),
      });
    }
    await ensureDataChargesTable();

    const fromDate = parseDateParam(req.query.from);
    const toDate = parseDateParam(req.query.to);
    const requestedFarmId = typeof req.query.farm_id === 'string' && req.query.farm_id.trim()
      ? req.query.farm_id.trim()
      : null;

    // Multi-tenant isolation (CONTRIBUTING.md): non-admin callers may only
    // see their own farm's charges — a farm-JWT user cannot query across
    // farms by omitting or spoofing ?farm_id. Only admin-JWT / API-key
    // callers (farmId === 'ADMIN') may query network-wide or scope to an
    // arbitrary farm. A non-admin with no farm context is rejected.
    const isAdmin = req.user?.farmId === 'ADMIN' || req.user?.authMethod === 'admin-jwt';
    let farmId;
    if (isAdmin) {
      farmId = requestedFarmId; // may be null = network-wide
    } else {
      const callerFarmId = req.user?.farmId || null;
      if (!callerFarmId) {
        return res.status(401).json({ success: false, error: 'farm context required' });
      }
      // Silently ignore any caller-supplied farm_id for non-admins so they
      // can't leak across tenants by guessing query params.
      farmId = callerFarmId;
    }

    const clauses = [];
    const params = [];
    if (fromDate) { params.push(fromDate.toISOString()); clauses.push(`period_end >= $${params.length}`); }
    if (toDate) {
      // `to` is documented as inclusive on the calendar day, but parseDateParam
      // returns midnight UTC — using `period_end <= midnight` drops every row
      // whose period_end falls later the same day. Bump to next-day midnight
      // and use `<` (same pattern as /subscription-revenue above).
      const toBoundary = new Date(toDate.getTime() + 24 * 60 * 60 * 1000);
      params.push(toBoundary.toISOString());
      clauses.push(`period_end < $${params.length}`);
    }
    if (farmId)   { params.push(farmId);                 clauses.push(`farm_id = $${params.length}`); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const totalsRes = await query(
      `SELECT COUNT(*)::int AS row_count,
              COALESCE(SUM(amount_usd), 0)::float AS total_charges,
              COALESCE(SUM(bytes_egress), 0)::bigint AS total_bytes,
              COALESCE(SUM(api_calls), 0)::bigint AS total_api_calls
       FROM data_charges ${where}`,
      params
    );
    const totals = totalsRes.rows[0] || { row_count: 0, total_charges: 0, total_bytes: 0, total_api_calls: 0 };

    if (Number(totals.row_count) === 0) {
      return res.json({
        success: true,
        report: 'data-charges',
        data: {
          totalCharges: 0,
          available: false,
          reason: 'No data-charge records ingested yet. POST to /api/reports/data-charges/ingest to populate.',
        },
        generatedAt: new Date().toISOString(),
      });
    }

    const bySourceRes = await query(
      `SELECT source,
              COUNT(*)::int AS row_count,
              COALESCE(SUM(amount_usd), 0)::float AS amount_usd,
              COALESCE(SUM(bytes_egress), 0)::bigint AS bytes_egress,
              COALESCE(SUM(api_calls), 0)::bigint AS api_calls
       FROM data_charges ${where}
       GROUP BY source
       ORDER BY amount_usd DESC`,
      params
    );

    res.json({
      success: true,
      report: 'data-charges',
      data: {
        available: true,
        totalCharges: Math.round(Number(totals.total_charges) * 100) / 100,
        totalBytesEgress: Number(totals.total_bytes || 0),
        totalApiCalls: Number(totals.total_api_calls || 0),
        rowCount: Number(totals.row_count || 0),
        bySource: bySourceRes.rows.map(r => ({
          source: r.source,
          rowCount: Number(r.row_count || 0),
          amountUsd: Math.round(Number(r.amount_usd || 0) * 100) / 100,
          bytesEgress: Number(r.bytes_egress || 0),
          apiCalls: Number(r.api_calls || 0),
        })),
      },
      diagnostics: {
        from: fromDate ? fromDate.toISOString() : null,
        to: toDate ? toDate.toISOString() : null,
        farm_id: farmId,
        scope: isAdmin ? (farmId ? 'admin_farm' : 'admin_network') : 'farm_self',
      },
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[Reports] Data charges error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to generate data-charges report' });
  }
});

/**
 * POST /api/reports/data-charges/ingest
 *
 * Admin-only. Ingests one or more data-charge records. Intended to be
 * called by an operator script that pulls billable usage from a source
 * of truth (Cloud Run egress export, MQTT counter, Vertex AI usage
 * dashboard, etc.) and posts the result here.
 *
 * Body shape:
 *   { records: [
 *       { farm_id?, period_start, period_end, amount_usd,
 *         bytes_egress?, api_calls?, source?, note? },
 *       ...
 *   ] }
 *
 * Upserts on (farm_id, period_start, period_end, source) so re-running
 * an ingest for the same window is safe.
 */
router.post('/data-charges/ingest', adminAuthMiddleware, express.json(), async (req, res) => {
  try {
    if (!isDatabaseAvailable()) {
      return res.status(503).json({ success: false, error: 'Database not available' });
    }
    await ensureDataChargesTable();

    const records = Array.isArray(req.body?.records) ? req.body.records : null;
    if (!records || records.length === 0) {
      return res.status(400).json({ success: false, error: 'Body must be { records: [...] } with at least one record' });
    }

    let inserted = 0;
    const errors = [];
    for (const [i, r] of records.entries()) {
      const periodStart = r.period_start ? new Date(r.period_start) : null;
      const periodEnd   = r.period_end   ? new Date(r.period_end)   : null;
      if (!periodStart || Number.isNaN(periodStart.getTime())) { errors.push({ index: i, error: 'period_start missing/invalid' }); continue; }
      if (!periodEnd   || Number.isNaN(periodEnd.getTime()))   { errors.push({ index: i, error: 'period_end missing/invalid' });   continue; }
      const amountUsd = Number(r.amount_usd);
      if (!Number.isFinite(amountUsd)) { errors.push({ index: i, error: 'amount_usd must be a number' }); continue; }

      try {
        await query(
          `INSERT INTO data_charges
             (farm_id, period_start, period_end, bytes_egress, api_calls, amount_usd, source, note)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (farm_id, period_start, period_end, source) DO UPDATE SET
             bytes_egress = EXCLUDED.bytes_egress,
             api_calls    = EXCLUDED.api_calls,
             amount_usd   = EXCLUDED.amount_usd,
             note         = EXCLUDED.note`,
          [
            // farm_id is NOT NULL DEFAULT '' so the UNIQUE constraint can
            // enforce idempotency on records with no farm attribution;
            // coerce to empty string on insert so the ON CONFLICT target
            // matches both new and existing rows.
            (r.farm_id && String(r.farm_id).trim()) || '',
            periodStart.toISOString(),
            periodEnd.toISOString(),
            Number(r.bytes_egress || 0),
            Number(r.api_calls || 0),
            amountUsd,
            (r.source || 'manual').toString().slice(0, 64),
            r.note ? String(r.note) : null,
          ]
        );
        inserted += 1;
      } catch (err) {
        errors.push({ index: i, error: err.message });
      }
    }

    res.json({
      success: errors.length === 0,
      ingested: inserted,
      rejected: errors.length,
      errors: errors.slice(0, 50),
    });
  } catch (err) {
    console.error('[Reports] Data charges ingest error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to ingest data charges' });
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
