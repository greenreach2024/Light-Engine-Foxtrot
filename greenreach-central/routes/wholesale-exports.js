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
    sql += ' ORDER BY created_at DESC';

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

export default router;
