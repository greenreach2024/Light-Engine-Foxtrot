/**
 * GreenReach: Wholesale Financial Exports
 * CSV exports for orders, payments, and tax summaries (CRA-compliant)
 */

import express from 'express';
import { query, isDatabaseAvailable } from '../config/database.js';

const router = express.Router();

/**
 * Escape a value for CSV output
 */
function csvEscape(value) {
  const str = String(value ?? '');
  if (str.includes('"') || str.includes(',') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * GET /api/wholesale/exports/orders
 * Export wholesale orders as CSV
 * 
 * Query params:
 *   from - start date (YYYY-MM-DD)
 *   to   - end date (YYYY-MM-DD)
 */
router.get('/orders', async (req, res) => {
  try {
    if (!await isDatabaseAvailable()) {
      return res.status(503).json({ ok: false, error: 'Database unavailable' });
    }

    const { from, to } = req.query;
    let sql = 'SELECT master_order_id, buyer_id, buyer_email, status, order_data, created_at, updated_at FROM wholesale_orders';
    const params = [];
    const conditions = [];

    if (from) {
      params.push(from);
      conditions.push(`created_at >= $${params.length}::date`);
    }
    if (to) {
      params.push(to + 'T23:59:59Z');
      conditions.push(`created_at <= $${params.length}::timestamp`);
    }
    if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ' ORDER BY created_at DESC LIMIT 5000';

    const result = await query(sql, params);

    // Build CSV rows — one row per line item across all sub-orders
    const header = [
      'order_id', 'date', 'buyer_name', 'buyer_email', 'farm_id', 'farm_name',
      'sku_id', 'sku_name', 'quantity', 'unit', 'unit_price', 'line_total',
      'subtotal', 'tax_rate', 'tax_label', 'tax_amount', 'broker_fee', 'total', 'status'
    ].join(',');

    const rows = [];
    for (const row of result.rows) {
      const order = row.order_data || {};
      const subOrders = order.farm_sub_orders || order.sub_orders || [];
      for (const sub of subOrders) {
        for (const item of (sub.line_items || [])) {
          rows.push([
            order.master_order_id || row.master_order_id,
            row.created_at ? new Date(row.created_at).toISOString().split('T')[0] : '',
            order.buyer_account?.name || order.buyer_account?.contactName || '',
            row.buyer_email || order.buyer_account?.email || '',
            sub.farm_id || '',
            sub.farm_name || '',
            item.sku_id || '',
            item.sku_name || '',
            item.qty || 0,
            item.unit || '',
            item.unit_price || 0,
            item.line_total || 0,
            sub.subtotal || 0,
            sub.tax_rate || 0,
            sub.tax_label || '',
            sub.tax_amount || 0,
            sub.broker_fee_amount || 0,
            sub.total || 0,
            order.status || row.status || ''
          ].map(csvEscape).join(','));
        }
      }
    }

    const csv = header + '\n' + rows.join('\n') + '\n';
    const filename = `wholesale-orders-${new Date().toISOString().split('T')[0]}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);

  } catch (err) {
    console.error('[Export] Orders export error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to export orders' });
  }
});

/**
 * GET /api/wholesale/exports/payments
 * Export payment history as CSV
 * 
 * Query params:
 *   from - start date (YYYY-MM-DD)
 *   to   - end date (YYYY-MM-DD)
 */
router.get('/payments', async (req, res) => {
  try {
    if (!await isDatabaseAvailable()) {
      return res.status(503).json({ ok: false, error: 'Database unavailable' });
    }

    const { from, to } = req.query;
    let sql = 'SELECT payment_id, order_id, amount, currency, provider, status, metadata, created_at FROM payment_records';
    const params = [];
    const conditions = [];

    if (from) {
      params.push(from);
      conditions.push(`created_at >= $${params.length}::date`);
    }
    if (to) {
      params.push(to + 'T23:59:59Z');
      conditions.push(`created_at <= $${params.length}::timestamp`);
    }
    if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ' ORDER BY created_at DESC';

    const result = await query(sql, params);

    const header = ['payment_id', 'order_id', 'date', 'amount', 'currency', 'provider', 'status'].join(',');
    const rows = result.rows.map(row => [
      row.payment_id,
      row.order_id,
      row.created_at ? new Date(row.created_at).toISOString().split('T')[0] : '',
      Number(row.amount),
      row.currency || 'CAD',
      row.provider || '',
      row.status || ''
    ].map(csvEscape).join(','));

    const csv = header + '\n' + rows.join('\n') + '\n';
    const filename = `wholesale-payments-${new Date().toISOString().split('T')[0]}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);

  } catch (err) {
    console.error('[Export] Payments export error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to export payments' });
  }
});

/**
 * GET /api/wholesale/exports/tax-summary
 * Export monthly tax summary as CSV (CRA-ready)
 * 
 * Query params:
 *   year - tax year (default: current year)
 */
router.get('/tax-summary', async (req, res) => {
  try {
    if (!await isDatabaseAvailable()) {
      return res.status(503).json({ ok: false, error: 'Database unavailable' });
    }

    const year = parseInt(req.query.year) || new Date().getFullYear();
    const startDate = `${year}-01-01`;
    const endDate = `${year}-12-31T23:59:59Z`;

    const result = await query(
      'SELECT order_data, created_at FROM wholesale_orders WHERE created_at >= $1::date AND created_at <= $2::timestamp ORDER BY created_at ASC',
      [startDate, endDate]
    );

    // Aggregate by month
    const monthly = {};
    for (let m = 1; m <= 12; m++) {
      const key = String(m).padStart(2, '0');
      monthly[key] = { sales: 0, tax: 0, broker_fees: 0, net_revenue: 0, order_count: 0 };
    }

    for (const row of result.rows) {
      const order = row.order_data || {};
      const month = new Date(row.created_at).toISOString().substring(5, 7);
      if (!monthly[month]) continue;

      const subOrders = order.farm_sub_orders || order.sub_orders || [];
      for (const sub of subOrders) {
        monthly[month].sales += sub.subtotal || 0;
        monthly[month].tax += sub.tax_amount || 0;
        monthly[month].broker_fees += sub.broker_fee_amount || 0;
        monthly[month].net_revenue += (sub.subtotal || 0) - (sub.broker_fee_amount || 0);
      }
      monthly[month].order_count++;
    }

    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const header = ['month', 'total_sales', 'tax_collected', 'broker_fees', 'net_revenue', 'order_count'].join(',');

    let totalSales = 0, totalTax = 0, totalFees = 0, totalNet = 0, totalOrders = 0;

    // Sort by month number to ensure Jan-Dec order (V8 reorders integer-like keys)
    const sortedMonths = Object.entries(monthly).sort((a, b) => parseInt(a[0]) - parseInt(b[0]));
    const rows = sortedMonths.map(([m, data]) => {
      totalSales += data.sales;
      totalTax += data.tax;
      totalFees += data.broker_fees;
      totalNet += data.net_revenue;
      totalOrders += data.order_count;

      const monthIdx = parseInt(m) - 1;
      return [
        `${monthNames[monthIdx]} ${year}`,
        data.sales.toFixed(2),
        data.tax.toFixed(2),
        data.broker_fees.toFixed(2),
        data.net_revenue.toFixed(2),
        data.order_count
      ].map(csvEscape).join(',');
    });

    // Annual totals row
    rows.push([
      `TOTAL ${year}`,
      totalSales.toFixed(2),
      totalTax.toFixed(2),
      totalFees.toFixed(2),
      totalNet.toFixed(2),
      totalOrders
    ].map(csvEscape).join(','));

    const csv = header + '\n' + rows.join('\n') + '\n';
    const filename = `tax-summary-${year}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);

  } catch (err) {
    console.error('[Export] Tax summary export error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to export tax summary' });
  }
});

/**
 * GET /api/wholesale/exports/delivery-fees
 * Export delivery fee ledger as CSV
 *
 * Query params:
 *   from - start date (YYYY-MM-DD)
 *   to   - end date (YYYY-MM-DD)
 *   farm_id - optional farm filter
 */
router.get('/delivery-fees', async (req, res) => {
  try {
    if (!await isDatabaseAvailable()) {
      return res.status(503).json({ ok: false, error: 'Database unavailable' });
    }

    const { from, to, farm_id } = req.query;
    let sql = `SELECT farm_id, delivery_id, order_id, delivery_date, status,
                      delivery_fee, tip_amount, driver_payout_amount, platform_margin,
                      created_at, updated_at
                 FROM delivery_orders`;
    const params = [];
    const conditions = [];

    if (farm_id) {
      params.push(farm_id);
      conditions.push(`farm_id = $${params.length}`);
    }
    if (from) {
      params.push(from);
      conditions.push(`created_at >= $${params.length}::date`);
    }
    if (to) {
      params.push(`${to}T23:59:59Z`);
      conditions.push(`created_at <= $${params.length}::timestamp`);
    }
    if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ' ORDER BY created_at DESC';

    const result = await query(sql, params);

    const header = [
      'farm_id', 'delivery_id', 'order_id', 'delivery_date', 'status',
      'delivery_fee', 'tip_amount', 'driver_payout_amount', 'platform_margin',
      'created_at', 'updated_at'
    ].join(',');

    const rows = result.rows.map((row) => [
      row.farm_id,
      row.delivery_id,
      row.order_id,
      row.delivery_date ? new Date(row.delivery_date).toISOString().split('T')[0] : '',
      row.status || '',
      Number(row.delivery_fee || 0).toFixed(2),
      Number(row.tip_amount || 0).toFixed(2),
      Number(row.driver_payout_amount || 0).toFixed(2),
      Number(row.platform_margin || 0).toFixed(2),
      row.created_at ? new Date(row.created_at).toISOString() : '',
      row.updated_at ? new Date(row.updated_at).toISOString() : ''
    ].map(csvEscape).join(','));

    const csv = header + '\n' + rows.join('\n') + '\n';
    const filename = `delivery-fees-${new Date().toISOString().split('T')[0]}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(csv);
  } catch (err) {
    console.error('[Export] Delivery fees export error:', err.message);
    return res.status(500).json({ ok: false, error: 'Failed to export delivery fees' });
  }
});

/**
 * GET /api/wholesale/exports/driver-payouts
 * Export driver payout ledger as CSV
 *
 * Query params:
 *   from - start date (YYYY-MM-DD)
 *   to   - end date (YYYY-MM-DD)
 *   farm_id - optional farm filter
 *   driver_id - optional driver filter
 */
router.get('/driver-payouts', async (req, res) => {
  try {
    if (!await isDatabaseAvailable()) {
      return res.status(503).json({ ok: false, error: 'Database unavailable' });
    }

    const { from, to, farm_id, driver_id } = req.query;
    let sql = `SELECT farm_id, driver_id, delivery_id, order_id,
                      base_amount, cold_chain_bonus, tip_amount, total_payout,
                      payout_status, payout_method, paid_at, created_at, updated_at
                 FROM driver_payouts`;
    const params = [];
    const conditions = [];

    if (farm_id) {
      params.push(farm_id);
      conditions.push(`farm_id = $${params.length}`);
    }
    if (driver_id) {
      params.push(driver_id);
      conditions.push(`driver_id = $${params.length}`);
    }
    if (from) {
      params.push(from);
      conditions.push(`created_at >= $${params.length}::date`);
    }
    if (to) {
      params.push(`${to}T23:59:59Z`);
      conditions.push(`created_at <= $${params.length}::timestamp`);
    }
    if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ' ORDER BY created_at DESC';

    const result = await query(sql, params);

    const header = [
      'farm_id', 'driver_id', 'delivery_id', 'order_id',
      'base_amount', 'cold_chain_bonus', 'tip_amount', 'total_payout',
      'payout_status', 'payout_method', 'paid_at', 'created_at', 'updated_at'
    ].join(',');

    const rows = result.rows.map((row) => [
      row.farm_id,
      row.driver_id,
      row.delivery_id || '',
      row.order_id || '',
      Number(row.base_amount || 0).toFixed(2),
      Number(row.cold_chain_bonus || 0).toFixed(2),
      Number(row.tip_amount || 0).toFixed(2),
      Number(row.total_payout || 0).toFixed(2),
      row.payout_status || '',
      row.payout_method || '',
      row.paid_at ? new Date(row.paid_at).toISOString() : '',
      row.created_at ? new Date(row.created_at).toISOString() : '',
      row.updated_at ? new Date(row.updated_at).toISOString() : ''
    ].map(csvEscape).join(','));

    const csv = header + '\n' + rows.join('\n') + '\n';
    const filename = `driver-payouts-${new Date().toISOString().split('T')[0]}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(csv);
  } catch (err) {
    console.error('[Export] Driver payouts export error:', err.message);
    return res.status(500).json({ ok: false, error: 'Failed to export driver payouts' });
  }
});

/**
 * GET /api/wholesale/exports/delivery-reconciliation
 * Export delivery reconciliation report as CSV (delivery_orders vs driver_payouts)
 *
 * Query params:
 *   farm_id   - optional farm filter
 *   from      - optional start date/timestamp
 *   to        - optional end date/timestamp
 *   threshold - anomaly threshold (default: 0.01)
 */
router.get('/delivery-reconciliation', async (req, res) => {
  try {
    if (!await isDatabaseAvailable()) {
      return res.status(503).json({ ok: false, error: 'Database unavailable' });
    }

    const { farm_id, from, to } = req.query;
    const threshold = Math.max(0, Number(req.query.threshold || 0.01));

    const params = [];
    const deliveryClauses = [];
    const payoutClauses = [];

    if (farm_id) {
      params.push(String(farm_id));
      deliveryClauses.push(`farm_id = $${params.length}`);
      payoutClauses.push(`farm_id = $${params.length}`);
    }
    if (from) {
      params.push(from);
      deliveryClauses.push(`created_at >= $${params.length}::timestamptz`);
      payoutClauses.push(`created_at >= $${params.length}::timestamptz`);
    }
    if (to) {
      params.push(to);
      deliveryClauses.push(`created_at <= $${params.length}::timestamptz`);
      payoutClauses.push(`created_at <= $${params.length}::timestamptz`);
    }

    const deliveryWhere = deliveryClauses.length ? `WHERE ${deliveryClauses.join(' AND ')}` : '';
    const payoutWhere = payoutClauses.length ? `WHERE ${payoutClauses.join(' AND ')}` : '';

    const result = await query(
      `WITH delivery AS (
         SELECT
           farm_id,
           DATE(created_at) AS day,
           COUNT(*)::int AS delivery_count,
           COALESCE(SUM(delivery_fee), 0)::numeric AS delivery_fee_total,
           COALESCE(SUM(driver_payout_amount), 0)::numeric AS driver_payout_total_orders,
           COALESCE(SUM(platform_margin), 0)::numeric AS platform_margin_total
         FROM delivery_orders
         ${deliveryWhere}
         GROUP BY farm_id, DATE(created_at)
       ),
       payouts AS (
         SELECT
           farm_id,
           DATE(created_at) AS day,
           COUNT(*)::int AS payout_count,
           COALESCE(SUM(total_payout), 0)::numeric AS payout_total_ledger
         FROM driver_payouts
         ${payoutWhere}
         GROUP BY farm_id, DATE(created_at)
       )
       SELECT
         COALESCE(d.farm_id, p.farm_id) AS farm_id,
         COALESCE(d.day, p.day) AS day,
         COALESCE(d.delivery_count, 0) AS delivery_count,
         COALESCE(p.payout_count, 0) AS payout_count,
         COALESCE(d.delivery_fee_total, 0)::numeric AS delivery_fee_total,
         COALESCE(d.driver_payout_total_orders, 0)::numeric AS driver_payout_total_orders,
         COALESCE(p.payout_total_ledger, 0)::numeric AS payout_total_ledger,
         COALESCE(d.platform_margin_total, 0)::numeric AS platform_margin_total,
         (COALESCE(d.delivery_fee_total, 0) - COALESCE(p.payout_total_ledger, 0))::numeric AS expected_margin,
         (COALESCE(d.driver_payout_total_orders, 0) - COALESCE(p.payout_total_ledger, 0))::numeric AS payout_delta,
         (COALESCE(d.platform_margin_total, 0) - (COALESCE(d.delivery_fee_total, 0) - COALESCE(p.payout_total_ledger, 0)))::numeric AS margin_delta
       FROM delivery d
       FULL OUTER JOIN payouts p
         ON d.farm_id = p.farm_id
        AND d.day = p.day
       ORDER BY day DESC, farm_id ASC`,
      params
    );

    const header = [
      'farm_id',
      'day',
      'delivery_count',
      'payout_count',
      'delivery_fee_total',
      'driver_payout_total_orders',
      'payout_total_ledger',
      'platform_margin_total',
      'expected_margin',
      'payout_delta',
      'margin_delta',
      'anomaly',
      'flags'
    ].join(',');

    const rows = result.rows.map((r) => {
      const payoutDelta = Number(r.payout_delta || 0);
      const marginDelta = Number(r.margin_delta || 0);
      const expectedMargin = Number(r.expected_margin || 0);
      const recordedMargin = Number(r.platform_margin_total || 0);

      const flags = [];
      if (Math.abs(payoutDelta) > threshold) flags.push('payout_mismatch');
      if (Math.abs(marginDelta) > threshold) flags.push('margin_mismatch');
      if (expectedMargin < -threshold) flags.push('negative_expected_margin');
      if (recordedMargin < -threshold) flags.push('negative_recorded_margin');
      if (Number(r.delivery_count || 0) !== Number(r.payout_count || 0)) flags.push('count_mismatch');

      return [
        r.farm_id,
        r.day,
        Number(r.delivery_count || 0),
        Number(r.payout_count || 0),
        Number(r.delivery_fee_total || 0).toFixed(2),
        Number(r.driver_payout_total_orders || 0).toFixed(2),
        Number(r.payout_total_ledger || 0).toFixed(2),
        Number(r.platform_margin_total || 0).toFixed(2),
        expectedMargin.toFixed(2),
        payoutDelta.toFixed(2),
        marginDelta.toFixed(2),
        flags.length > 0 ? 'true' : 'false',
        flags.join(';')
      ].map(csvEscape).join(',');
    });

    const csv = header + '\n' + rows.join('\n') + '\n';
    const filename = `delivery-reconciliation-${new Date().toISOString().split('T')[0]}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(csv);
  } catch (err) {
    console.error('[Export] Delivery reconciliation export error:', err.message);
    return res.status(500).json({ ok: false, error: 'Failed to export delivery reconciliation' });
  }
});

export default router;
