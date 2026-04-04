/**
 * Billing Receipts Router
 * GET /api/billing/receipts         - List payment receipts
 * GET /api/billing/receipts/:id     - Get receipt detail
 * GET /api/billing/receipts/:id/download - Download HTML receipt
 */
import express from 'express';
import { query, isDatabaseAvailable } from '../config/database.js';
import logger from '../utils/logger.js';

const router = express.Router();

/**
 * GET /api/billing/receipts
 * List receipts for a farm. Sorted by most recent first.
 * Query: farm_id, limit, offset, status, from, to
 */
router.get('/', async (req, res) => {
  if (!await isDatabaseAvailable()) {
    return res.status(503).json({ ok: false, error: 'database_unavailable' });
  }

  try {
    const farmId = req.query.farm_id || req.farmId;
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = parseInt(req.query.offset) || 0;

    if (!farmId) {
      return res.status(400).json({ ok: false, error: 'farm_id required' });
    }

    let sql = `
      SELECT payment_id, order_id, amount, currency, provider, status, metadata, created_at
      FROM payment_records
      WHERE (metadata->>'farm_id' = $1 OR metadata->>'farmId' = $1)
    `;
    const params = [farmId];
    let idx = 2;

    if (req.query.status) {
      sql += ` AND status = $${idx++}`;
      params.push(req.query.status);
    }
    if (req.query.from) {
      sql += ` AND created_at >= $${idx++}`;
      params.push(req.query.from);
    }
    if (req.query.to) {
      sql += ` AND created_at <= $${idx++}`;
      params.push(req.query.to);
    }

    sql += ` ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
    params.push(limit, offset);

    const result = await query(sql, params);

    return res.json({
      ok: true,
      receipts: result.rows.map(r => ({
        payment_id: r.payment_id,
        order_id: r.order_id,
        amount: Number(r.amount),
        currency: r.currency || 'CAD',
        provider: r.provider,
        status: r.status,
        channel: r.metadata?.channel || 'unknown',
        created_at: r.created_at
      })),
      pagination: { limit, offset, count: result.rows.length }
    });
  } catch (error) {
    logger.error('[Receipts] List error:', error);
    return res.status(500).json({ ok: false, error: 'receipts_list_failed' });
  }
});

/**
 * GET /api/billing/receipts/:paymentId
 * Get receipt detail for a specific payment
 */
router.get('/:paymentId', async (req, res) => {
  if (!await isDatabaseAvailable()) {
    return res.status(503).json({ ok: false, error: 'database_unavailable' });
  }

  try {
    const { paymentId } = req.params;
    const farmId = req.query.farm_id || req.farmId;

    const result = await query(
      `SELECT payment_id, order_id, amount, currency, provider, status, metadata, created_at
       FROM payment_records WHERE payment_id = $1`,
      [paymentId]
    );

    if (!result.rows.length) {
      return res.status(404).json({ ok: false, error: 'receipt_not_found' });
    }

    const record = result.rows[0];
    const recordFarmId = record.metadata?.farm_id || record.metadata?.farmId;
    if (farmId && recordFarmId && recordFarmId !== farmId) {
      return res.status(403).json({ ok: false, error: 'access_denied' });
    }

    return res.json({
      ok: true,
      receipt: {
        payment_id: record.payment_id,
        order_id: record.order_id,
        amount: Number(record.amount),
        currency: record.currency || 'CAD',
        provider: record.provider,
        status: record.status,
        metadata: record.metadata,
        created_at: record.created_at
      }
    });
  } catch (error) {
    logger.error('[Receipts] Detail error:', error);
    return res.status(500).json({ ok: false, error: 'receipt_detail_failed' });
  }
});

/**
 * GET /api/billing/receipts/:paymentId/download
 * Generate downloadable HTML receipt
 */
router.get('/:paymentId/download', async (req, res) => {
  if (!await isDatabaseAvailable()) {
    return res.status(503).json({ ok: false, error: 'database_unavailable' });
  }

  try {
    const { paymentId } = req.params;
    const farmId = req.query.farm_id || req.farmId;

    const result = await query(
      `SELECT payment_id, order_id, amount, currency, provider, status, metadata, created_at
       FROM payment_records WHERE payment_id = $1`,
      [paymentId]
    );

    if (!result.rows.length) {
      return res.status(404).json({ ok: false, error: 'receipt_not_found' });
    }

    const r = result.rows[0];
    const recordFarmId = r.metadata?.farm_id || r.metadata?.farmId;
    if (farmId && recordFarmId && recordFarmId !== farmId) {
      return res.status(403).json({ ok: false, error: 'access_denied' });
    }

    const date = new Date(r.created_at).toLocaleDateString('en-CA', {
      year: 'numeric', month: 'long', day: 'numeric'
    });
    const amount = Number(r.amount).toFixed(2);

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Receipt ${r.payment_id}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 600px; margin: 40px auto; padding: 20px; color: #333; }
    h1 { font-size: 1.5rem; margin-bottom: 4px; }
    .subtitle { color: #666; margin-bottom: 24px; }
    table { width: 100%; border-collapse: collapse; margin: 16px 0; }
    th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid #eee; }
    th { font-weight: 600; color: #555; }
    .total { font-size: 1.25rem; font-weight: 700; margin-top: 16px; }
    .status { display: inline-block; padding: 2px 10px; border-radius: 12px; font-size: 0.85rem; }
    .status-completed { background: #d4edda; color: #155724; }
    .status-refunded { background: #f8d7da; color: #721c24; }
    .footer { margin-top: 32px; font-size: 0.8rem; color: #999; text-align: center; }
  </style>
</head>
<body>
  <h1>Payment Receipt</h1>
  <p class="subtitle">${date}</p>
  <table>
    <tr><th>Payment ID</th><td>${r.payment_id}</td></tr>
    <tr><th>Order ID</th><td>${r.order_id || 'N/A'}</td></tr>
    <tr><th>Provider</th><td>${(r.provider || 'unknown').toUpperCase()}</td></tr>
    <tr><th>Status</th><td><span class="status status-${r.status}">${r.status}</span></td></tr>
    <tr><th>Channel</th><td>${r.metadata?.channel || 'N/A'}</td></tr>
  </table>
  <p class="total">Total: $${amount} ${r.currency || 'CAD'}</p>
  <div class="footer">
    <p>GreenReach Farms -- greenreachgreens.com</p>
    <p>This receipt was generated automatically.</p>
  </div>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Content-Disposition', `inline; filename="receipt-${r.payment_id}.html"`);
    return res.send(html);
  } catch (error) {
    logger.error('[Receipts] Download error:', error);
    return res.status(500).json({ ok: false, error: 'receipt_download_failed' });
  }
});

export default router;
