/**
 * Admin Pricing Routes
 * Wholesale pricing authority: offers, cost surveys, batch pricing
 * Mounted at /api/admin/pricing in server-foxtrot.js
 */

import express from 'express';
import { adminAuthMiddleware } from '../server/middleware/admin-auth.js';

const router = express.Router();

// Require admin auth on all routes
router.use(adminAuthMiddleware);

// Ensure pricing tables exist (lazy, once per process)
let _tablesReady = false;
async function ensureTables(db) {
  if (_tablesReady || !db) return;
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS pricing_offers (
        id SERIAL PRIMARY KEY,
        sku_id TEXT NOT NULL,
        sku_name TEXT,
        offer_price NUMERIC(10,2),
        unit TEXT DEFAULT 'lb',
        status TEXT DEFAULT 'active',
        notes TEXT,
        response_stats JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS farm_cost_surveys (
        id SERIAL PRIMARY KEY,
        sku_id TEXT NOT NULL,
        farm_id TEXT,
        cost_per_unit NUMERIC(10,2),
        unit TEXT DEFAULT 'lb',
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS pricing_responses (
        id SERIAL PRIMARY KEY,
        offer_id INTEGER REFERENCES pricing_offers(id),
        farm_id TEXT,
        response TEXT,
        counter_price NUMERIC(10,2),
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    _tablesReady = true;
  } catch (err) {
    console.error('[Admin Pricing] Table bootstrap error:', err.message);
  }
}

/**
 * GET /api/admin/pricing/offers
 * Query params: ?status=active (optional filter)
 */
router.get('/offers', async (req, res) => {
  const db = req.db;
  if (!db) return res.json({ success: true, offers: [] });
  try {
    await ensureTables(db);
    const { status } = req.query;
    let query = 'SELECT * FROM pricing_offers ORDER BY created_at DESC';
    const params = [];
    if (status) {
      query = 'SELECT * FROM pricing_offers WHERE status = $1 ORDER BY created_at DESC';
      params.push(status);
    }
    const result = await db.query(query, params);
    res.json({ success: true, offers: result.rows });
  } catch (err) {
    if (err.code === '42P01') {
      return res.json({ success: true, offers: [] });
    }
    console.error('[Admin Pricing] GET /offers error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/admin/pricing/cost-surveys
 */
router.get('/cost-surveys', async (req, res) => {
  const db = req.db;
  if (!db) return res.json({ success: true, cost_surveys: [] });
  try {
    await ensureTables(db);
    const result = await db.query('SELECT * FROM farm_cost_surveys ORDER BY created_at DESC');
    res.json({ success: true, cost_surveys: result.rows });
  } catch (err) {
    if (err.code === '42P01') {
      return res.json({ success: true, cost_surveys: [] });
    }
    console.error('[Admin Pricing] GET /cost-surveys error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/admin/pricing/current-prices
 * Returns current wholesale pricing from crop-pricing.json
 */
router.get('/current-prices', async (req, res) => {
  const db = req.db;
  if (!db) return res.json({ success: true, prices: [] });
  try {
    await ensureTables(db);
    const result = await db.query(`
      SELECT DISTINCT ON (sku_id) sku_id, sku_name, offer_price, unit, updated_at
      FROM pricing_offers WHERE status = 'active'
      ORDER BY sku_id, updated_at DESC
    `);
    res.json({ success: true, prices: result.rows });
  } catch (err) {
    if (err.code === '42P01') {
      return res.json({ success: true, prices: [] });
    }
    console.error('[Admin Pricing] GET /current-prices error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/admin/pricing/set-wholesale
 * Set wholesale price for a SKU
 */
router.post('/set-wholesale', express.json(), async (req, res) => {
  const db = req.db;
  if (!db) return res.status(503).json({ success: false, error: 'Database not available' });
  try {
    await ensureTables(db);
    const { sku_id, sku_name, offer_price, unit } = req.body;
    if (!sku_id || offer_price == null) {
      return res.status(400).json({ success: false, error: 'sku_id and offer_price required' });
    }
    const result = await db.query(`
      INSERT INTO pricing_offers (sku_id, sku_name, offer_price, unit, status)
      VALUES ($1, $2, $3, $4, 'active')
      RETURNING *
    `, [sku_id, sku_name || sku_id, offer_price, unit || 'lb']);
    res.json({ success: true, offer: result.rows[0] });
  } catch (err) {
    console.error('[Admin Pricing] POST /set-wholesale error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/admin/pricing/batch-update
 * Batch update wholesale prices
 */
router.post('/batch-update', express.json(), async (req, res) => {
  const db = req.db;
  if (!db) return res.status(503).json({ success: false, error: 'Database not available' });
  try {
    await ensureTables(db);
    const { updates } = req.body;
    if (!Array.isArray(updates)) {
      return res.status(400).json({ success: false, error: 'updates array required' });
    }
    const results = [];
    for (const u of updates) {
      const r = await db.query(`
        INSERT INTO pricing_offers (sku_id, sku_name, offer_price, unit, status)
        VALUES ($1, $2, $3, $4, 'active')
        RETURNING *
      `, [u.sku_id, u.sku_name || u.sku_id, u.offer_price, u.unit || 'lb']);
      results.push(r.rows[0]);
    }
    res.json({ success: true, updated: results.length, offers: results });
  } catch (err) {
    console.error('[Admin Pricing] POST /batch-update error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/admin/pricing/offers/:offerId/cancel
 * Cancel a pricing offer
 */
router.post('/offers/:offerId/cancel', async (req, res) => {
  const db = req.db;
  if (!db) return res.status(503).json({ success: false, error: 'Database not available' });
  try {
    await ensureTables(db);
    const { offerId } = req.params;
    const result = await db.query(`
      UPDATE pricing_offers SET status = 'cancelled', updated_at = NOW()
      WHERE id = $1 RETURNING *
    `, [offerId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Offer not found' });
    }
    res.json({ success: true, offer: result.rows[0] });
  } catch (err) {
    console.error('[Admin Pricing] POST /offers/:id/cancel error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
