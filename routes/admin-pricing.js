/**
 * Admin Pricing Routes (LE)
 * Wholesale pricing authority: offers, cost surveys, batch pricing
 * Mounted at /api/admin/pricing in server-foxtrot.js
 *
 * Uses Central-compatible pricing_offers schema:
 *   offer_id, crop, wholesale_price, unit, reasoning, confidence,
 *   predicted_acceptance, effective_date, expires_at, status, created_by,
 *   tier, metadata
 *
 * Supports both formula payload { crop, floor_price, sku_factor }
 * and legacy payload { sku_id, offer_price }.
 */

import express from 'express';
import { adminAuthMiddleware } from '../server/middleware/admin-auth.js';

const router = express.Router();

// Require admin auth on all routes
router.use(adminAuthMiddleware);

// ── Helpers ─────────────────────────────────────────────────────────────────

function generateOfferId(crop) {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const cropCode = String(crop || 'UNK').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `OFFER-${date}-${cropCode}-${random}`;
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function inferPriceUnit(crop, fallback = 'oz') {
  const text = String(crop || '').toLowerCase();
  if (/berry|strawberry|raspberry|blackberry|blueberry/.test(text)) return 'pint';
  if (/tomato/.test(text) && !/cherry tomato|grape tomato/.test(text)) return 'unit';
  if (/cherry tomato|grape tomato|leafy|lettuce|kale|arugula|spinach|greens|herb|basil|cilantro|parsley|mint/.test(text)) {
    return 'oz';
  }
  return fallback;
}

function percentile(sortedValues, p) {
  if (!Array.isArray(sortedValues) || sortedValues.length === 0) return 0;
  if (sortedValues.length === 1) return sortedValues[0];
  const idx = (sortedValues.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedValues[lo];
  const w = idx - lo;
  return sortedValues[lo] * (1 - w) + sortedValues[hi] * w;
}

function removeAnomalies(values) {
  const clean = (Array.isArray(values) ? values : [])
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v) && v > 0);
  if (clean.length < 4) return { kept: clean, removedCount: 0 };
  const sorted = [...clean].sort((a, b) => a - b);
  const q1 = percentile(sorted, 0.25);
  const q3 = percentile(sorted, 0.75);
  const iqr = Math.max(0, q3 - q1);
  if (iqr === 0) return { kept: sorted, removedCount: 0 };
  const lower = q1 - (1.5 * iqr);
  const upper = q3 + (1.5 * iqr);
  const kept = sorted.filter((v) => v >= lower && v <= upper);
  if (kept.length < 3) return { kept: sorted, removedCount: 0 };
  return { kept, removedCount: Math.max(0, sorted.length - kept.length) };
}

async function getRetailAggregateForCrop(db, crop) {
  if (!db) return { average: 0, sampleCount: 0, removedCount: 0 };
  try {
    const result = await db.query(
      `SELECT retail_price FROM farm_inventory
       WHERE COALESCE(quantity_available, manual_quantity_lbs, 0) > 0
         AND COALESCE(retail_price, 0) > 0
         AND product_name ILIKE $1`,
      [`%${crop}%`]
    );
    const values = result.rows.map((row) => Number(row.retail_price || 0));
    const filtered = removeAnomalies(values);
    const avg = filtered.kept.length
      ? (filtered.kept.reduce((sum, v) => sum + v, 0) / filtered.kept.length)
      : 0;
    return { average: roundMoney(avg), sampleCount: values.length, removedCount: filtered.removedCount };
  } catch (err) {
    if (err.code === '42P01') return { average: 0, sampleCount: 0, removedCount: 0 };
    throw err;
  }
}

async function getMaxFarmCost(db, crop) {
  if (!db) return null;
  try {
    const result = await db.query(
      `SELECT MAX(cost_per_unit) as max_cost, unit FROM farm_cost_surveys
       WHERE crop = $1 AND (valid_until IS NULL OR valid_until >= CURRENT_DATE)
       GROUP BY unit ORDER BY max_cost DESC LIMIT 1`,
      [crop]
    );
    return result.rows.length === 0 ? null : result.rows[0];
  } catch (err) {
    if (err.code === '42P01') return null;
    throw err;
  }
}

// ── Table Bootstrap ─────────────────────────────────────────────────────────

let _tablesReady = false;
async function ensureTables(db) {
  if (_tablesReady || !db) return;
  try {
    await db.query(`CREATE TABLE IF NOT EXISTS pricing_offers (
      offer_id VARCHAR(50) PRIMARY KEY,
      crop VARCHAR(100) NOT NULL,
      wholesale_price DECIMAL(10,2) NOT NULL,
      unit VARCHAR(20) DEFAULT 'lb',
      reasoning TEXT,
      confidence DECIMAL(3,2),
      predicted_acceptance DECIMAL(3,2),
      offer_date TIMESTAMPTZ DEFAULT NOW(),
      effective_date DATE,
      expires_at TIMESTAMPTZ,
      status VARCHAR(20) DEFAULT 'pending',
      created_by VARCHAR(100),
      tier VARCHAR(50),
      metadata JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    await db.query(`CREATE TABLE IF NOT EXISTS farm_cost_surveys (
      id SERIAL PRIMARY KEY,
      farm_id VARCHAR(50) NOT NULL,
      crop VARCHAR(100) NOT NULL,
      cost_per_unit DECIMAL(10,2) NOT NULL,
      unit VARCHAR(20) DEFAULT 'lb',
      cost_breakdown JSONB,
      survey_date DATE DEFAULT CURRENT_DATE,
      valid_until DATE,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(farm_id, crop, survey_date)
    )`);
    await db.query(`CREATE TABLE IF NOT EXISTS pricing_responses (
      response_id SERIAL PRIMARY KEY,
      offer_id VARCHAR(50) NOT NULL,
      farm_id VARCHAR(50) NOT NULL,
      response VARCHAR(10) NOT NULL,
      counter_price DECIMAL(10,2),
      justification TEXT,
      notes TEXT,
      responded_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(offer_id, farm_id)
    )`);
    await db.query(`CREATE TABLE IF NOT EXISTS pricing_history (
      history_id SERIAL PRIMARY KEY,
      crop VARCHAR(100) NOT NULL,
      wholesale_price DECIMAL(10,2) NOT NULL,
      unit VARCHAR(20) DEFAULT 'lb',
      offer_date DATE NOT NULL,
      total_farms_offered INT DEFAULT 0,
      farms_accepted INT DEFAULT 0,
      farms_rejected INT DEFAULT 0,
      farms_countered INT DEFAULT 0,
      acceptance_rate DECIMAL(5,4),
      avg_counter_price DECIMAL(10,2),
      reasoning TEXT,
      tier VARCHAR(50),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    _tablesReady = true;
  } catch (err) {
    console.error('[Admin Pricing] Table bootstrap error:', err.message);
  }
}

// ── Routes ──────────────────────────────────────────────────────────────────

/**
 * GET /api/admin/pricing/offers
 */
router.get('/offers', async (req, res) => {
  const db = req.db;
  if (!db) return res.json({ success: true, offers: [] });
  try {
    await ensureTables(db);
    const { status } = req.query;
    let sql = 'SELECT * FROM pricing_offers ORDER BY created_at DESC';
    const params = [];
    if (status) {
      sql = 'SELECT * FROM pricing_offers WHERE status = $1 ORDER BY created_at DESC';
      params.push(status);
    }
    const result = await db.query(sql, params);
    res.json({ success: true, offers: result.rows });
  } catch (err) {
    if (err.code === '42P01') return res.json({ success: true, offers: [] });
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
    if (err.code === '42P01') return res.json({ success: true, cost_surveys: [] });
    console.error('[Admin Pricing] GET /cost-surveys error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/admin/pricing/current-prices
 * Returns current wholesale pricing from active offers
 */
router.get('/current-prices', async (req, res) => {
  const db = req.db;
  if (!db) return res.json({ success: true, prices: [] });
  try {
    await ensureTables(db);
    const result = await db.query(`
      SELECT DISTINCT ON (crop) offer_id, crop, wholesale_price, unit, tier, updated_at
      FROM pricing_offers WHERE status = 'active'
      ORDER BY crop, updated_at DESC
    `);
    res.json({ success: true, prices: result.rows });
  } catch (err) {
    if (err.code === '42P01') return res.json({ success: true, prices: [] });
    console.error('[Admin Pricing] GET /current-prices error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/admin/pricing/set-wholesale
 * Set wholesale price for a crop using formula or flat price.
 *
 * Formula payload: { crop, floor_price, sku_factor, use_formula: true, tier, reasoning }
 * Legacy payload:  { sku_id, offer_price, unit }  (backward compat)
 */
router.post('/set-wholesale', express.json(), async (req, res) => {
  const db = req.db;
  if (!db) return res.status(503).json({ success: false, error: 'Database not available' });
  try {
    await ensureTables(db);

    const {
      crop,
      sku_id,
      sku_name,
      wholesale_price,
      offer_price,
      unit,
      floor_price,
      sku_factor,
      use_formula = true,
      reasoning,
      confidence,
      predicted_acceptance,
      effective_date,
      expires_in_days = 14,
      tier = 'demand-based'
    } = req.body;

    // Determine crop name: formula path uses 'crop', legacy uses 'sku_id'
    const cropName = crop || sku_id || sku_name;
    if (!cropName) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: crop (or sku_id)'
      });
    }

    const inferredUnit = String(unit || inferPriceUnit(cropName, 'oz')).toLowerCase();
    const skuFactor = Math.min(0.75, Math.max(0.5, Number(sku_factor || 0.65)));

    // Cost-basis protection
    const costData = await getMaxFarmCost(db, cropName);
    const costFloor = costData ? (Number(costData.max_cost || 0) * 1.20) : 0;
    const manualFloor = Number(floor_price || 0);
    const floor = Math.max(costFloor, manualFloor);

    let computedWholesale = Number(wholesale_price || offer_price || 0);
    let retailAggregate = 0;
    let retailSampleCount = 0;
    let outliersRemoved = 0;

    if (use_formula && !offer_price) {
      const retailStats = await getRetailAggregateForCrop(db, cropName);
      retailAggregate = Number(retailStats.average || 0);
      retailSampleCount = Number(retailStats.sampleCount || 0);
      outliersRemoved = Number(retailStats.removedCount || 0);

      if (retailAggregate > 0) {
        computedWholesale = Math.max(floor, retailAggregate * skuFactor);
      }
    }

    if (!(computedWholesale > 0)) {
      return res.status(400).json({
        success: false,
        error: 'Unable to compute wholesale price',
        message: 'Provide a valid wholesale price or ensure farm retail pricing exists for this crop.'
      });
    }

    computedWholesale = roundMoney(computedWholesale);

    if (costData && computedWholesale < costFloor) {
      return res.status(400).json({
        success: false,
        error: 'Price below cost basis',
        message: `Wholesale price $${computedWholesale} is below minimum $${costFloor.toFixed(2)} (highest farm cost $${costData.max_cost} + 20% margin)`,
        min_price: costFloor,
        max_farm_cost: costData.max_cost
      });
    }

    const offer_id = generateOfferId(cropName);
    const expires_at = new Date();
    expires_at.setDate(expires_at.getDate() + expires_in_days);
    const created_by = req.admin?.email || 'admin';

    const result = await db.query(`
      INSERT INTO pricing_offers (
        offer_id, crop, wholesale_price, unit, reasoning, confidence,
        predicted_acceptance, effective_date, expires_at, status,
        created_by, tier, metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active', $10, $11, $12::jsonb)
      RETURNING *
    `, [
      offer_id,
      cropName,
      computedWholesale,
      inferredUnit,
      reasoning || null,
      confidence || null,
      predicted_acceptance || null,
      effective_date || null,
      expires_at,
      created_by,
      tier,
      JSON.stringify({
        pricingModel: use_formula ? 'retail_aggregate_formula' : 'manual',
        formula: use_formula ? 'max(floor, retail * sku_factor)' : 'flat',
        floor,
        skuFactor,
        retailAggregate,
        retailSampleCount,
        outliersRemoved
      })
    ]);

    // Count farms growing this crop
    let farms_count = 0;
    try {
      const farmsResult = await db.query(`
        SELECT DISTINCT farm_id FROM farm_inventory
        WHERE product_name ILIKE $1 AND available_for_wholesale = true
      `, [`%${cropName}%`]);
      farms_count = farmsResult.rows.length;
    } catch (e) { /* table may not exist */ }

    res.json({
      success: true,
      offer: result.rows[0],
      farms_notified: farms_count,
      pricing_summary: {
        unit: inferredUnit,
        floor: roundMoney(floor),
        skuFactor,
        retailAggregate,
        computedWholesale,
        retailSampleCount,
        outliersRemoved
      },
      message: `Price offer created for ${cropName}`
    });
  } catch (error) {
    console.error('[Admin Pricing] POST /set-wholesale error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to set wholesale price', message: error.message });
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
    if (!Array.isArray(updates) || updates.length === 0) {
      return res.status(400).json({ success: false, error: 'updates array required' });
    }
    const results = [];
    for (const u of updates) {
      const cropName = u.crop || u.sku_id || u.sku_name;
      const price = Number(u.wholesale_price || u.offer_price || 0);
      if (!cropName || !(price > 0)) continue;
      const id = generateOfferId(cropName);
      const r = await db.query(`
        INSERT INTO pricing_offers (offer_id, crop, wholesale_price, unit, status, tier)
        VALUES ($1, $2, $3, $4, 'active', $5)
        RETURNING *
      `, [id, cropName, price, u.unit || 'lb', u.tier || 'demand-based']);
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
 */
router.post('/offers/:offerId/cancel', async (req, res) => {
  const db = req.db;
  if (!db) return res.status(503).json({ success: false, error: 'Database not available' });
  try {
    await ensureTables(db);
    const { offerId } = req.params;
    const result = await db.query(`
      UPDATE pricing_offers SET status = 'cancelled', updated_at = NOW()
      WHERE offer_id = $1 RETURNING *
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
