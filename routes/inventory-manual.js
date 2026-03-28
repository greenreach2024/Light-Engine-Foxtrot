/**
 * Manual Inventory Routes
 * Handles manual product inventory entries for farms not using tray-based automation.
 * Mounted at /api/inventory in server-foxtrot.js (AFTER inline inventory routes).
 *
 * Endpoints:
 *   GET  /:farmId       - List all inventory for a farm (auto + manual merged)
 *   POST /manual        - Add or upsert a manual inventory product
 *   DELETE /manual/:productId - Remove a manual entry (or zero manual portion if hybrid)
 */

import express from 'express';
import jwt from 'jsonwebtoken';

const router = express.Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getJwtSecret() {
  if (!process.env.JWT_SECRET && (process.env.NODE_ENV === 'production' || process.env.DEPLOYMENT_MODE === 'cloud')) {
    throw new Error('JWT_SECRET environment variable is required in production');
  }
  return process.env.JWT_SECRET || 'dev-fallback-secret';
}

async function resolveFarmId(req) {
  const db = req.app.locals.db;
  // Try Bearer token first
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const payload = jwt.verify(authHeader.substring(7), getJwtSecret(), {
        issuer: 'greenreach-central',
        audience: 'greenreach-farms'
      });
      if (payload?.farm_id) return payload.farm_id;
    } catch (_) { /* fall through */ }
  }

  let farmId = req.query.farmId || req.headers['x-farm-id'] || null;

  // Admin token -- resolve to actual farm
  if (farmId === 'ADMIN' && db) {
    try {
      const r = await db.query('SELECT farm_id FROM farms LIMIT 1');
      if (r.rows.length) return r.rows[0].farm_id;
    } catch (_) { /* fall through */ }
  }

  // Canonicalize to a real farm row
  if (farmId && farmId !== 'ADMIN' && db) {
    try {
      const exact = await db.query('SELECT farm_id FROM farms WHERE farm_id = $1 LIMIT 1', [farmId]);
      if (exact.rows.length) return exact.rows[0].farm_id;

      // Fallback: most recently active farm
      const fb = await db.query(
        "SELECT farm_id FROM farms WHERE status = 'active' ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST LIMIT 1"
      );
      if (fb.rows.length) return fb.rows[0].farm_id;
    } catch (_) { /* preserve original */ }
  }

  return farmId;
}

// Ensure farm_inventory table exists (lazy, once per process)
let _tableReady = false;
async function ensureTable(db) {
  if (_tableReady || !db) return;
  try {
    await db.query(
      "CREATE TABLE IF NOT EXISTS farm_inventory (" +
      "  id SERIAL PRIMARY KEY," +
      "  farm_id TEXT NOT NULL," +
      "  product_id TEXT NOT NULL," +
      "  product_name TEXT NOT NULL," +
      "  sku_id TEXT," +
      "  sku_name TEXT," +
      "  sku TEXT," +
      "  quantity NUMERIC DEFAULT 0," +
      "  unit TEXT DEFAULT 'lb'," +
      "  price NUMERIC DEFAULT 0," +
      "  available_for_wholesale BOOLEAN DEFAULT true," +
      "  manual_quantity_lbs NUMERIC DEFAULT 0," +
      "  auto_quantity_lbs NUMERIC DEFAULT 0," +
      "  quantity_available NUMERIC DEFAULT 0," +
      "  quantity_unit TEXT DEFAULT 'lb'," +
      "  wholesale_price NUMERIC DEFAULT 0," +
      "  retail_price NUMERIC DEFAULT 0," +
      "  inventory_source TEXT DEFAULT 'manual'," +
      "  category TEXT," +
      "  variety TEXT," +
      "  last_updated TIMESTAMPTZ DEFAULT NOW()," +
      "  UNIQUE(farm_id, product_id)" +
      ")"
    );
    _tableReady = true;
  } catch (err) {
    // Table likely already exists with a different schema
    if (err.code === '42P07') { _tableReady = true; return; }
    console.error('[inventory-manual] ensureTable error:', err.message);
  }
}

// ---------------------------------------------------------------------------
// GET /:farmId -- list all inventory for a farm
// ---------------------------------------------------------------------------
router.get('/:farmId', async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) return res.json({ farm_id: req.params.farmId, products: [], count: 0 });

    await ensureTable(db);

    const { farmId } = req.params;
    const result = await db.query(
      "SELECT *, COALESCE(auto_quantity_lbs, 0) + COALESCE(manual_quantity_lbs, 0) AS available_lbs " +
      "FROM farm_inventory WHERE farm_id = $1 AND COALESCE(status, 'active') != 'inactive' ORDER BY product_name",
      [farmId]
    );

    res.json({
      farm_id: farmId,
      products: result.rows,
      count: result.rows.length
    });
  } catch (err) {
    console.error('[inventory-manual] GET /:farmId error:', err.message);
    res.status(500).json({ error: 'Failed to fetch inventory' });
  }
});

// ---------------------------------------------------------------------------
// POST /manual -- add or upsert a manual inventory product
// ---------------------------------------------------------------------------
router.post('/manual', async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) return res.status(503).json({ error: 'Database not available' });

    await ensureTable(db);

    const farmId = await resolveFarmId(req);
    if (!farmId) return res.status(401).json({ error: 'Farm ID required' });

    const { product_name, quantity_lbs, category } = req.body;
    if (!product_name || quantity_lbs === undefined) {
      return res.status(400).json({ error: 'product_name and quantity_lbs are required' });
    }

    const manualQty = Math.max(0, Number(quantity_lbs) || 0);
    const productId = product_name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

    console.log('[inventory-manual] POST: farm=' + farmId + ' product=' + product_name + ' qty=' + manualQty);

    let result;
    try {
      result = await db.query(
        "INSERT INTO farm_inventory (" +
        "  farm_id, product_id, product_name, sku_id, sku_name, sku," +
        "  quantity, unit, price, available_for_wholesale," +
        "  manual_quantity_lbs, quantity_available, quantity_unit," +
        "  wholesale_price, retail_price, inventory_source, category, last_updated" +
        ") VALUES ($1,$2,$3,$4,$5,$6,$7,'lb',0,true,$8,$9,'lb',0,0,'manual',$10,NOW())" +
        " ON CONFLICT (farm_id, product_id) DO UPDATE SET" +
        "  product_name = EXCLUDED.product_name," +
        "  manual_quantity_lbs = EXCLUDED.manual_quantity_lbs," +
        "  quantity_available = COALESCE(farm_inventory.auto_quantity_lbs, 0) + EXCLUDED.manual_quantity_lbs - COALESCE(farm_inventory.sold_quantity_lbs, 0)," +
        "  inventory_source = CASE" +
        "    WHEN COALESCE(farm_inventory.auto_quantity_lbs, 0) > 0 THEN 'hybrid'" +
        "    ELSE 'manual'" +
        "  END," +
        "  category = COALESCE(EXCLUDED.category, farm_inventory.category)," +
        "  last_updated = NOW()" +
        " RETURNING *",
        [
          farmId,               // $1
          productId,            // $2
          product_name,         // $3
          productId,            // $4 sku_id
          product_name,         // $5 sku_name
          productId,            // $6 sku
          manualQty,            // $7 quantity
          manualQty,            // $8 manual_quantity_lbs
          manualQty,            // $9 quantity_available
          category || null      // $10 category
        ]
      );
    } catch (insertErr) {
      console.error('[inventory-manual] Full INSERT failed:', insertErr.message);
      // Fallback: base columns only
      result = await db.query(
        "INSERT INTO farm_inventory (" +
        "  farm_id, product_id, product_name, sku_id, sku_name, sku," +
        "  quantity, unit, price, available_for_wholesale, last_updated" +
        ") VALUES ($1,$2,$3,$4,$5,$6,$7,'lb',0,true,NOW())" +
        " ON CONFLICT (farm_id, product_id) DO UPDATE SET" +
        "  product_name = EXCLUDED.product_name," +
        "  quantity = EXCLUDED.quantity," +
        "  last_updated = NOW()" +
        " RETURNING *",
        [farmId, productId, product_name, productId, product_name, productId, manualQty]
      );
    }

    console.log('[inventory-manual] Saved: ' + farmId + ' / ' + product_name + ' = ' + manualQty + ' lb');
    res.json({
      success: true,
      product: result.rows[0],
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('[inventory-manual] POST /manual error:', err.message);
    res.status(500).json({ error: 'Failed to save manual inventory', detail: err.message });
  }
});

// ---------------------------------------------------------------------------
// DELETE /manual/:productId -- remove a manual entry
// ---------------------------------------------------------------------------
router.delete('/manual/:productId', async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) return res.status(503).json({ error: 'Database not available' });

    await ensureTable(db);

    const farmId = await resolveFarmId(req);
    if (!farmId) return res.status(401).json({ error: 'Farm ID required' });

    const { productId } = req.params;

    // Check current state
    const check = await db.query(
      'SELECT inventory_source, auto_quantity_lbs FROM farm_inventory WHERE farm_id = $1 AND product_id = $2',
      [farmId, productId]
    );

    if (!check.rows.length) {
      return res.status(404).json({ error: 'Product not found' });
    }

    if (check.rows[0].inventory_source === 'hybrid' || Number(check.rows[0].auto_quantity_lbs) > 0) {
      // Has auto data -- zero out manual portion, revert to auto-only
      await db.query(
        "UPDATE farm_inventory SET" +
        "  manual_quantity_lbs = 0," +
        "  quantity_available = COALESCE(auto_quantity_lbs, 0) - COALESCE(sold_quantity_lbs, 0)," +
        "  inventory_source = 'auto'," +
        "  last_updated = NOW()" +
        " WHERE farm_id = $1 AND product_id = $2",
        [farmId, productId]
      );
      return res.json({ success: true, action: 'cleared_manual', product_id: productId });
    }

    // Pure manual -- delete entirely
    await db.query('DELETE FROM farm_inventory WHERE farm_id = $1 AND product_id = $2', [farmId, productId]);
    res.json({ success: true, action: 'deleted', product_id: productId });
  } catch (err) {
    console.error('[inventory-manual] DELETE error:', err.message);
    res.status(500).json({ error: 'Failed to delete inventory item' });
  }
});

export default router;
