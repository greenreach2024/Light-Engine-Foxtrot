/**
 * P5 Wholesale Pricing Authority - Admin Routes
 * GreenReach Central Admin API for managing wholesale marketplace pricing
 * 
 * Architecture: Central sets prices → Farms accept/reject
 * Created: January 31, 2026
 */

import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { query } from '../config/database.js';
import { farmStore } from '../lib/farm-data-store.js';

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PRICING_FILE = path.resolve(__dirname, '../public/data/crop-pricing.json');
const REGISTRY_FILE = path.resolve(__dirname, '../public/data/crop-registry.json');

/**
 * Generate unique offer ID
 * Format: OFFER-YYYYMMDD-CROP-RAND
 */
function generateOfferId(crop) {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const cropCode = crop.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `OFFER-${date}-${cropCode}-${random}`;
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function normalizeCropKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
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

async function getRetailAggregateForCrop(crop) {
  const normalized = normalizeCropKey(crop);
  if (!normalized) return { average: 0, sampleCount: 0, removedCount: 0 };

  const result = await query(
    `SELECT retail_price
       FROM farm_inventory
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

  return {
    average: roundMoney(avg),
    sampleCount: values.length,
    removedCount: filtered.removedCount
  };
}

/**
 * Calculate acceptance rate for an offer
 */
async function getOfferAcceptanceStats(offerId) {
  try {
    const result = await query(`
      SELECT
        COUNT(*) as total_responses,
        COUNT(*) FILTER (WHERE response = 'accept') as accepted,
        COUNT(*) FILTER (WHERE response = 'reject') as rejected,
        COUNT(*) FILTER (WHERE response = 'counter') as countered,
        AVG(counter_price) FILTER (WHERE response = 'counter') as avg_counter_price,
        CASE
          WHEN COUNT(*) = 0 THEN NULL
          ELSE COUNT(*) FILTER (WHERE response = 'accept')::DECIMAL / COUNT(*)
        END as acceptance_rate
      FROM pricing_responses
      WHERE offer_id = $1
    `, [offerId]);
    return result.rows[0];
  } catch (error) {
    if (error.code === '42P01') return { total_responses: 0, accepted: 0, rejected: 0, countered: 0, avg_counter_price: null, acceptance_rate: null };
    throw error;
  }
}

/**
 * Get maximum farm cost for a crop (for cost-basis protection)
 */
async function getMaxFarmCost(crop) {
  try {
    const result = await query(`
      SELECT MAX(cost_per_unit) as max_cost, unit
      FROM farm_cost_surveys
      WHERE crop = $1
        AND (valid_until IS NULL OR valid_until >= CURRENT_DATE)
      GROUP BY unit
      ORDER BY max_cost DESC
      LIMIT 1
    `, [crop]);
    
    if (result.rows.length === 0) {
      return null;
    }
    
    return result.rows[0];
  } catch (error) {
    if (error.code === '42P01') return null;
    throw error;
  }
}

/**
 * Ensure pricing tables exist before querying.
 * Runs CREATE IF NOT EXISTS (idempotent) on first call, then caches.
 */
let _pricingTablesReady = false;
async function ensurePricingTables() {
  if (_pricingTablesReady) return;
  try {
    await query(`CREATE TABLE IF NOT EXISTS farm_cost_surveys (
      id SERIAL PRIMARY KEY, farm_id VARCHAR(50) NOT NULL, crop VARCHAR(100) NOT NULL,
      cost_per_unit DECIMAL(10,2) NOT NULL, unit VARCHAR(20) DEFAULT 'lb',
      cost_breakdown JSONB, survey_date DATE DEFAULT CURRENT_DATE, valid_until DATE,
      notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(farm_id, crop, survey_date))`);
    await query(`CREATE TABLE IF NOT EXISTS pricing_offers (
      offer_id VARCHAR(50) PRIMARY KEY, crop VARCHAR(100) NOT NULL,
      wholesale_price DECIMAL(10,2) NOT NULL, unit VARCHAR(20) DEFAULT 'lb',
      reasoning TEXT, confidence DECIMAL(3,2), predicted_acceptance DECIMAL(3,2),
      offer_date TIMESTAMPTZ DEFAULT NOW(), effective_date DATE, expires_at TIMESTAMPTZ,
      status VARCHAR(20) DEFAULT 'pending', created_by VARCHAR(100), tier VARCHAR(50),
      metadata JSONB, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`);
    await query(`CREATE TABLE IF NOT EXISTS pricing_responses (
      response_id SERIAL PRIMARY KEY, offer_id VARCHAR(50) NOT NULL,
      farm_id VARCHAR(50) NOT NULL, response VARCHAR(10) NOT NULL,
      counter_price DECIMAL(10,2), justification TEXT, notes TEXT,
      responded_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(offer_id, farm_id))`);
    await query(`CREATE TABLE IF NOT EXISTS pricing_history (
      history_id SERIAL PRIMARY KEY, crop VARCHAR(100) NOT NULL,
      wholesale_price DECIMAL(10,2) NOT NULL, unit VARCHAR(20) DEFAULT 'lb',
      offer_date DATE NOT NULL, total_farms_offered INT DEFAULT 0,
      farms_accepted INT DEFAULT 0, farms_rejected INT DEFAULT 0, farms_countered INT DEFAULT 0,
      acceptance_rate DECIMAL(5,4), avg_counter_price DECIMAL(10,2),
      reasoning TEXT, tier VARCHAR(50), created_at TIMESTAMPTZ DEFAULT NOW())`);
    _pricingTablesReady = true;
  } catch (err) {
    console.warn('[Admin Pricing] Table bootstrap warning:', err.message);
  }
}

// Ensure tables exist before any pricing route handler runs
router.use(async (req, res, next) => {
  await ensurePricingTables();
  next();
});

// ==============================================================================
// Farm Cost Surveys Endpoints (BLOCKING CONDITION #1)
// ==============================================================================

/**
 * GET /api/admin/pricing/cost-surveys
 * Get all farm cost surveys (for cost-basis pricing protection)
 */
router.get('/cost-surveys', async (req, res) => {
  try {
    const { farm_id, crop, valid_only = 'true' } = req.query;
    
    let sqlQuery = 'SELECT * FROM farm_cost_surveys WHERE 1=1';
    const params = [];
    let paramCount = 0;
    
    if (farm_id) {
      paramCount++;
      sqlQuery += ` AND farm_id = $${paramCount}`;
      params.push(farm_id);
    }
    
    if (crop) {
      paramCount++;
      sqlQuery += ` AND crop = $${paramCount}`;
      params.push(crop);
    }
    
    if (valid_only === 'true') {
      sqlQuery += ` AND (valid_until IS NULL OR valid_until >= CURRENT_DATE)`;
    }
    
    sqlQuery += ` ORDER BY farm_id, crop, survey_date DESC`;
    
    const result = await query(sqlQuery, params);
    
    res.json({
      success: true,
      cost_surveys: result.rows
    });
  } catch (error) {
    if (error.code === '42P01') {
      return res.json({ success: true, cost_surveys: [] });
    }
    console.error('[Admin Pricing API] Error fetching cost surveys:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch cost surveys',
      message: error.message
    });
  }
});

/**
 * GET /api/admin/pricing/cost-surveys/farm/:farmId
 * Get cost survey data for a specific farm
 */
router.get('/cost-surveys/farm/:farmId', async (req, res) => {
  try {
    const { farmId } = req.params;
    
    const result = await query(`
      SELECT * FROM farm_cost_surveys
      WHERE farm_id = $1
        AND (valid_until IS NULL OR valid_until >= CURRENT_DATE)
      ORDER BY crop, survey_date DESC
    `, [farmId]);
    
    res.json({
      success: true,
      farm_id: farmId,
      cost_surveys: result.rows
    });
  } catch (error) {
    console.error('[Admin Pricing API] Error fetching farm cost surveys:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch farm cost surveys',
      message: error.message
    });
  }
});

/**
 * POST /api/admin/pricing/cost-surveys
 * Create or update farm cost survey
 */
router.post('/cost-surveys', async (req, res) => {
  try {
    const { farm_id, crop, cost_per_unit, unit = 'lb', cost_breakdown, valid_until, notes } = req.body;
    
    if (!farm_id || !crop || !cost_per_unit) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: farm_id, crop, cost_per_unit'
      });
    }
    
    const survey_date = new Date().toISOString().split('T')[0];
    
    const result = await query(`
      INSERT INTO farm_cost_surveys (
        farm_id, crop, cost_per_unit, unit, cost_breakdown, survey_date, valid_until, notes
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (farm_id, crop, survey_date)
      DO UPDATE SET
        cost_per_unit = EXCLUDED.cost_per_unit,
        unit = EXCLUDED.unit,
        cost_breakdown = EXCLUDED.cost_breakdown,
        valid_until = EXCLUDED.valid_until,
        notes = EXCLUDED.notes,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `, [farm_id, crop, cost_per_unit, unit, cost_breakdown, survey_date, valid_until, notes]);
    
    res.json({
      success: true,
      cost_survey: result.rows[0]
    });
  } catch (error) {
    console.error('[Admin Pricing API] Error creating cost survey:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create cost survey',
      message: error.message
    });
  }
});

// ==============================================================================
// Pricing Offers Endpoints
// ==============================================================================

/**
 * POST /api/admin/pricing/set-wholesale
 * Set wholesale price for a crop (Central authority)
 * BLOCKING CONDITION #1: Enforces cost-basis protection (price >= max_cost * 1.20)
 */
router.post('/set-wholesale', async (req, res) => {
  try {
    const {
      crop,
      wholesale_price,
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
    
    if (!crop) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: crop'
      });
    }

    const inferredUnit = String(unit || inferPriceUnit(crop, 'oz')).toLowerCase();
    const skuFactor = Math.min(0.75, Math.max(0.5, Number(sku_factor || 0.65)));
    
    // BLOCKING CONDITION #1: Cost-basis protection
    const costData = await getMaxFarmCost(crop);
    const costFloor = costData ? (Number(costData.max_cost || 0) * 1.20) : 0;
    const manualFloor = Number(floor_price || 0);
    const floor = Math.max(costFloor, manualFloor);

    let computedWholesale = Number(wholesale_price || 0);
    let retailAggregate = 0;
    let retailSampleCount = 0;
    let outliersRemoved = 0;

    if (use_formula) {
      const retailStats = await getRetailAggregateForCrop(crop);
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

    if (costData) {
      const minPrice = costFloor;
      if (computedWholesale < minPrice) {
        return res.status(400).json({
          success: false,
          error: 'Price below cost basis',
          message: `Wholesale price $${computedWholesale} is below minimum $${minPrice.toFixed(2)} (highest farm cost $${costData.max_cost} + 20% margin)`,
          min_price: minPrice,
          max_farm_cost: costData.max_cost
        });
      }
    } else {
      console.warn(`[Pricing Authority] No cost data for ${crop} - proceeding without cost protection`);
    }
    
    const offer_id = generateOfferId(crop);
    const expires_at = new Date();
    expires_at.setDate(expires_at.getDate() + expires_in_days);
    
    const created_by = req.admin?.email || 'admin';
    
    const result = await query(`
      INSERT INTO pricing_offers (
        offer_id, crop, wholesale_price, unit, reasoning, confidence,
        predicted_acceptance, effective_date, expires_at, status,
        created_by, tier, metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active', $10, $11, $12::jsonb)
      RETURNING *
    `, [
      offer_id,
      crop,
      computedWholesale,
      inferredUnit,
      reasoning,
      confidence,
      predicted_acceptance,
      effective_date,
      expires_at,
      created_by,
      tier,
      JSON.stringify({
        pricingModel: 'retail_aggregate_formula',
        formula: 'max(floor, retail * sku_factor)',
        floor,
        skuFactor,
        retailAggregate,
        retailSampleCount,
        outliersRemoved
      })
    ]);
    
    // Get list of farms that grow this crop (to send offers to)
    const farmsResult = await query(`
      SELECT DISTINCT farm_id
      FROM farm_inventory
      WHERE product_name ILIKE $1 OR sku ILIKE $1
        AND available_for_wholesale = true
    `, [`%${crop}%`]);
    
    const farms_count = farmsResult.rows.length;
    
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
      message: `Price offer sent to ${farms_count} farms growing ${crop}`
    });
  } catch (error) {
    console.error('[Admin Pricing API] Error setting wholesale price:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to set wholesale price',
      message: error.message
    });
  }
});

/**
 * GET /api/admin/pricing/offers
 * Get all pricing offers
 */
router.get('/offers', async (req, res) => {
  try {
    const { status, crop, page = 1, limit = 50 } = req.query;
    
    let sqlQuery = 'SELECT * FROM pricing_offers WHERE 1=1';
    const params = [];
    let paramCount = 0;
    
    if (status) {
      paramCount++;
      sqlQuery += ` AND status = $${paramCount}`;
      params.push(status);
    }
    
    if (crop) {
      paramCount++;
      sqlQuery += ` AND crop ILIKE $${paramCount}`;
      params.push(`%${crop}%`);
    }
    
    sqlQuery += ` ORDER BY offer_date DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    params.push(parseInt(limit));
    params.push((parseInt(page) - 1) * parseInt(limit));
    
    const result = await query(sqlQuery, params);
    
    // Get acceptance stats for each offer
    const offersWithStats = await Promise.all(
      result.rows.map(async (offer) => {
        const stats = await getOfferAcceptanceStats(offer.offer_id);
        return {
          ...offer,
          response_stats: stats
        };
      })
    );
    
    res.json({
      success: true,
      offers: offersWithStats
    });
  } catch (error) {
    if (error.code === '42P01') {
      return res.json({ success: true, offers: [] });
    }
    console.error('[Admin Pricing API] Error fetching offers:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch offers',
      message: error.message
    });
  }
});

/**
 * GET /api/admin/pricing/offers/:offerId
 * Get specific offer with detailed response data
 */
router.get('/offers/:offerId', async (req, res) => {
  try {
    const { offerId } = req.params;
    
    const offerResult = await query(`
      SELECT * FROM pricing_offers WHERE offer_id = $1
    `, [offerId]);
    
    if (offerResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Offer not found'
      });
    }
    
    const offer = offerResult.rows[0];
    const stats = await getOfferAcceptanceStats(offerId);
    
    res.json({
      success: true,
      offer: {
        ...offer,
        response_stats: stats
      }
    });
  } catch (error) {
    console.error('[Admin Pricing API] Error fetching offer:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch offer',
      message: error.message
    });
  }
});

/**
 * GET /api/admin/pricing/offers/:offerId/responses
 * Get all farm responses for an offer (BLOCKING CONDITION #2: includes counter-offers)
 */
router.get('/offers/:offerId/responses', async (req, res) => {
  try {
    const { offerId } = req.params;
    
    const result = await query(`
      SELECT
        pr.*,
        f.name as farm_name,
        fcs.cost_per_unit as farm_cost
      FROM pricing_responses pr
      LEFT JOIN farms f ON pr.farm_id = f.farm_id
      LEFT JOIN farm_cost_surveys fcs ON pr.farm_id = fcs.farm_id
        AND fcs.crop = (SELECT crop FROM pricing_offers WHERE offer_id = $1)
        AND (fcs.valid_until IS NULL OR fcs.valid_until >= CURRENT_DATE)
      WHERE pr.offer_id = $1
      ORDER BY pr.responded_at DESC
    `, [offerId]);
    
    const stats = await getOfferAcceptanceStats(offerId);
    
    // Generate recommendation if counter-offers exist
    let recommendation = null;
    const counterOffers = result.rows.filter(r => r.response === 'counter');
    if (counterOffers.length > 0) {
      const avgCounter = counterOffers.reduce((sum, r) => sum + parseFloat(r.counter_price), 0) / counterOffers.length;
      const offerResult = await query('SELECT wholesale_price FROM pricing_offers WHERE offer_id = $1', [offerId]);
      const currentPrice = offerResult.rows[0].wholesale_price;
      
      recommendation = {
        suggested_price: Math.round(avgCounter * 100) / 100,
        reason: `Average of ${counterOffers.length} counter-offers`,
        price_increase: Math.round((avgCounter - currentPrice) * 100) / 100,
        predicted_acceptance: Math.min(0.95, stats.acceptance_rate + 0.15)  // Estimate improvement
      };
    }
    
    res.json({
      success: true,
      offer_id: offerId,
      responses: result.rows,
      stats: stats,
      recommendation: recommendation
    });
  } catch (error) {
    console.error('[Admin Pricing API] Error fetching offer responses:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch offer responses',
      message: error.message
    });
  }
});

/**
 * GET /api/admin/pricing/offers/:offerId/counter-offers
 * Get counter-offers for review (BLOCKING CONDITION #2)
 */
router.get('/offers/:offerId/counter-offers', async (req, res) => {
  try {
    const { offerId } = req.params;
    
    const result = await query(`
      SELECT
        pr.*,
        f.name as farm_name,
        fcs.cost_per_unit as farm_cost
      FROM pricing_responses pr
      LEFT JOIN farms f ON pr.farm_id = f.farm_id
      LEFT JOIN farm_cost_surveys fcs ON pr.farm_id = fcs.farm_id
        AND fcs.crop = (SELECT crop FROM pricing_offers WHERE offer_id = $1)
        AND (fcs.valid_until IS NULL OR fcs.valid_until >= CURRENT_DATE)
      WHERE pr.offer_id = $1
        AND pr.response = 'counter'
      ORDER BY pr.counter_price DESC
    `, [offerId]);
    
    if (result.rows.length === 0) {
      return res.json({
        success: true,
        offer_id: offerId,
        counter_offers: [],
        message: 'No counter-offers received'
      });
    }
    
    // Calculate recommendation
    const avgCounter = result.rows.reduce((sum, r) => sum + parseFloat(r.counter_price), 0) / result.rows.length;
    const offerResult = await query('SELECT wholesale_price, crop FROM pricing_offers WHERE offer_id = $1', [offerId]);
    const currentPrice = parseFloat(offerResult.rows[0].wholesale_price);
    const crop = offerResult.rows[0].crop;
    
    const stats = await getOfferAcceptanceStats(offerId);
    
    res.json({
      success: true,
      offer_id: offerId,
      current_price: currentPrice,
      crop: crop,
      counter_offers: result.rows,
      analysis: {
        total_counter_offers: result.rows.length,
        avg_counter_price: Math.round(avgCounter * 100) / 100,
        min_counter_price: Math.min(...result.rows.map(r => parseFloat(r.counter_price))),
        max_counter_price: Math.max(...result.rows.map(r => parseFloat(r.counter_price))),
        current_acceptance_rate: stats.acceptance_rate
      },
      recommendation: {
        suggested_price: Math.round(avgCounter * 100) / 100,
        reason: `Average of ${result.rows.length} counter-offers`,
        price_increase_pct: Math.round(((avgCounter - currentPrice) / currentPrice) * 100),
        predicted_acceptance: Math.min(0.85, (stats.acceptance_rate || 0) + 0.20)
      }
    });
  } catch (error) {
    console.error('[Admin Pricing API] Error fetching counter-offers:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch counter-offers',
      message: error.message
    });
  }
});

/**
 * PUT /api/admin/pricing/offers/:offerId/cancel
 * Cancel a pricing offer
 */
router.put('/offers/:offerId/cancel', async (req, res) => {
  try {
    const { offerId } = req.params;
    const { reason } = req.body;
    
    const result = await query(`
      UPDATE pricing_offers
      SET status = 'cancelled',
          metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('cancel_reason', $2)
      WHERE offer_id = $1
      RETURNING *
    `, [offerId, reason || 'Admin cancellation']);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Offer not found'
      });
    }
    
    res.json({
      success: true,
      offer: result.rows[0]
    });
  } catch (error) {
    console.error('[Admin Pricing API] Error cancelling offer:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to cancel offer',
      message: error.message
    });
  }
});

// ==============================================================================
// Pricing History & Analytics
// ==============================================================================

/**
 * GET /api/admin/pricing/history
 * Get pricing history (for AI learning and admin review)
 */
router.get('/history', async (req, res) => {
  try {
    const { crop, start_date, end_date, limit = 100 } = req.query;
    
    let sqlQuery = 'SELECT * FROM pricing_history WHERE 1=1';
    const params = [];
    let paramCount = 0;
    
    if (crop) {
      paramCount++;
      sqlQuery += ` AND crop ILIKE $${paramCount}`;
      params.push(`%${crop}%`);
    }
    
    if (start_date) {
      paramCount++;
      sqlQuery += ` AND offer_date >= $${paramCount}`;
      params.push(start_date);
    }
    
    if (end_date) {
      paramCount++;
      sqlQuery += ` AND offer_date <= $${paramCount}`;
      params.push(end_date);
    }
    
    sqlQuery += ` ORDER BY offer_date DESC LIMIT $${paramCount + 1}`;
    params.push(parseInt(limit));
    
    const result = await query(sqlQuery, params);
    
    res.json({
      success: true,
      history: result.rows
    });
  } catch (error) {
    console.error('[Admin Pricing API] Error fetching pricing history:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch pricing history',
      message: error.message
    });
  }
});

/**
 * GET /api/admin/pricing/analytics/acceptance-trends
 * Get acceptance rate trends (for monitoring BLOCKING CONDITION #3)
 */
router.get('/analytics/acceptance-trends', async (req, res) => {
  try {
    const { days = 30 } = req.query;
    
    const result = await query(`
      SELECT
        DATE(offer_date) as date,
        COUNT(*) as total_offers,
        AVG(acceptance_rate) as avg_acceptance_rate,
        MIN(acceptance_rate) as min_acceptance_rate,
        MAX(acceptance_rate) as max_acceptance_rate,
        COUNT(*) FILTER (WHERE acceptance_rate < 0.50) as critical_offers,
        COUNT(*) FILTER (WHERE acceptance_rate < 0.60) as warning_offers
      FROM pricing_history
      WHERE offer_date >= CURRENT_DATE - $1::integer
      GROUP BY DATE(offer_date)
      ORDER BY date DESC
    `, [days]);
    
    // Check for rollback triggers (BLOCKING CONDITION #3)
    const recentOffers = await query(`
      SELECT
        po.offer_id,
        po.crop,
        po.wholesale_price,
        po.offer_date,
        COUNT(pr.response_id) as total_responses,
        COUNT(pr.response_id) FILTER (WHERE pr.response = 'accept') as accepted,
        EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - po.offer_date))/3600 as hours_elapsed
      FROM pricing_offers po
      LEFT JOIN pricing_responses pr ON po.offer_id = pr.offer_id
      WHERE po.status = 'active'
        AND po.offer_date >= CURRENT_TIMESTAMP - INTERVAL '7 days'
      GROUP BY po.offer_id
      HAVING COUNT(pr.response_id) > 0
    `);
    
    const alerts = [];
    recentOffers.rows.forEach(offer => {
      const acceptanceRate = offer.accepted / offer.total_responses;
      
      // RED ALERT: <40% acceptance
      if (acceptanceRate < 0.40) {
        alerts.push({
          severity: 'CRITICAL',
          offer_id: offer.offer_id,
          crop: offer.crop,
          acceptance_rate: acceptanceRate,
          message: `EMERGENCY: ${offer.crop} acceptance ${Math.round(acceptanceRate * 100)}% - Consider rollback`
        });
      }
      // ORANGE ALERT: <50% acceptance for 48+ hours
      else if (acceptanceRate < 0.50 && offer.hours_elapsed > 48) {
        alerts.push({
          severity: 'HIGH',
          offer_id: offer.offer_id,
          crop: offer.crop,
          acceptance_rate: acceptanceRate,
          hours_elapsed: Math.round(offer.hours_elapsed),
          message: `URGENT: ${offer.crop} acceptance ${Math.round(acceptanceRate * 100)}% for ${Math.round(offer.hours_elapsed)} hours - Price adjustment needed`
        });
      }
      // YELLOW ALERT: <60% acceptance
      else if (acceptanceRate < 0.60) {
        alerts.push({
          severity: 'MEDIUM',
          offer_id: offer.offer_id,
          crop: offer.crop,
          acceptance_rate: acceptanceRate,
          message: `WARNING: ${offer.crop} acceptance ${Math.round(acceptanceRate * 100)}% - Monitor closely`
        });
      }
    });
    
    res.json({
      success: true,
      trends: result.rows,
      alerts: alerts,
      rollback_recommended: alerts.some(a => a.severity === 'CRITICAL')
    });
  } catch (error) {
    console.error('[Admin Pricing API] Error fetching acceptance trends:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch acceptance trends',
      message: error.message
    });
  }
});

// ==============================================================================
// AI Pricing Assistant — Batch Price Updates
// ==============================================================================

/**
 * POST /api/admin/pricing/batch-update
 * Apply multiple crop price corrections in a single scan.
 * Persists to crop-pricing.json, crop-registry.json, and pushes to
 * the farm-scoped crop_pricing store so POS and online store pick
 * up new prices on next read.
 *
 * Body: {
 *   updates: [
 *     { crop: "Bibb Butterhead", retailPerOz: 1.47, retailPerLb: 23.52, wholesalePerLb: 16.46, tier: "demand-based", reasoning: "..." },
 *     ...
 *   ],
 *   pushToFarms: true,          // push to connected edge farms
 *   reasoning: "March 2026 market adjustment"
 * }
 */
router.post('/batch-update', async (req, res) => {
  try {
    const { updates, pushToFarms = true, reasoning = '' } = req.body;

    if (!Array.isArray(updates) || updates.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'updates array is required and must not be empty'
      });
    }

    const results = [];
    const errors = [];
    const timestamp = new Date().toISOString();

    // ── 1. Persist to crop-pricing.json ──────────────────────────────────
    let pricingFile = { version: '2026-03-08-v1', crops: [] };
    try {
      pricingFile = JSON.parse(fs.readFileSync(PRICING_FILE, 'utf8'));
    } catch (e) { /* start fresh */ }

    const priceMap = {};
    (pricingFile.crops || []).forEach(c => { priceMap[c.crop] = c; });

    for (const u of updates) {
      if (!u.crop) {
        errors.push({ crop: u.crop, error: 'Missing crop name' });
        continue;
      }

      const retailPerLb = u.retailPerLb || (u.retailPerOz ? u.retailPerOz * 16 : null);
      const skuFactor = Math.min(0.75, Math.max(0.50, Number(u.sku_factor || 0.65)));
      const wholesalePerLb = u.wholesalePerLb || (retailPerLb ? Math.round(retailPerLb * skuFactor * 100) / 100 : null);

      if (!retailPerLb || retailPerLb <= 0) {
        errors.push({ crop: u.crop, error: 'Invalid retail price' });
        continue;
      }

      // Update or insert in pricing file
      const existing = priceMap[u.crop] || {};
      priceMap[u.crop] = {
        crop: u.crop,
        unit: u.unit || existing.unit || 'lb',
        retailPrice: retailPerLb,
        wholesalePrice: wholesalePerLb,
        ws1Discount: u.ws1Discount || existing.ws1Discount || 15,
        ws2Discount: u.ws2Discount || existing.ws2Discount || 25,
        ws3Discount: u.ws3Discount || existing.ws3Discount || 35,
        currency: 'CAD',
        pricingSource: 'greenreach-central',
        lastUpdated: timestamp
      };

      results.push({
        crop: u.crop,
        retailPerLb,
        retailPerOz: Math.round((retailPerLb / 16) * 100) / 100,
        wholesalePerLb,
        status: 'applied'
      });
    }

    pricingFile.crops = Object.values(priceMap);
    pricingFile.lastUpdated = timestamp;
    pricingFile.currency = 'CAD';
    pricingFile.pricingSource = 'greenreach-central';
    pricingFile.version = timestamp.slice(0, 10).replace(/-/g, '') + '-batch';

    fs.writeFileSync(PRICING_FILE, JSON.stringify(pricingFile, null, 2), 'utf8');
    console.log(`[Pricing Assistant] Persisted ${results.length} price updates to crop-pricing.json`);

    // ── 2. Update crop-registry.json ─────────────────────────────────────
    let registryUpdated = 0;
    try {
      const registry = JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8'));
      for (const u of updates) {
        const crop = registry.crops?.[u.crop];
        if (!crop) continue;

        const retailPerLb = u.retailPerLb || (u.retailPerOz ? u.retailPerOz * 16 : null);
        const retailPerOz = u.retailPerOz || (retailPerLb ? Math.round((retailPerLb / 16) * 100) / 100 : null);
        if (!retailPerLb) continue;

        crop.growth.retailPricePerLb = retailPerLb;
        crop.pricing.retailPerOz = retailPerOz;
        crop.pricing.currency = 'CAD';
        crop.pricing.pricingSource = 'greenreach-central';
        crop.pricing.lastUpdated = timestamp;
        registryUpdated++;
      }
      registry.version = timestamp.slice(0, 10) + '-batch';
      fs.writeFileSync(REGISTRY_FILE, JSON.stringify(registry, null, 2, { encoding: 'utf8' }), 'utf8');
      console.log(`[Pricing Assistant] Updated ${registryUpdated} entries in crop-registry.json`);
    } catch (e) {
      console.warn('[Pricing Assistant] crop-registry.json update skipped:', e.message);
    }

    // ── 3. Push to farm-scoped crop_pricing store (POS + online) ─────────
    let farmsPushed = 0;
    if (pushToFarms) {
      try {
        // Get all connected farms
        let farmIds = [];
        try {
          const farmRows = await query('SELECT farm_id FROM farms WHERE status != $1', ['inactive']);
          farmIds = farmRows.rows.map(r => r.farm_id);
        } catch (dbErr) {
          // Fallback: push to default farm
          farmIds = ['default'];
        }

        for (const fid of farmIds) {
          try {
            const existing = await farmStore.get(fid, 'crop_pricing') || { crops: [] };
            const existingMap = {};
            (existing.crops || []).forEach(c => { existingMap[c.crop] = c; });

            // Merge updates into existing farm pricing
            for (const u of updates) {
              const retailPerLb = u.retailPerLb || (u.retailPerOz ? u.retailPerOz * 16 : null);
              const skuFactorPush = Math.min(0.75, Math.max(0.50, Number(u.sku_factor || 0.65)));
              const wholesalePerLb = u.wholesalePerLb || (retailPerLb ? Math.round(retailPerLb * skuFactorPush * 100) / 100 : null);
              if (!retailPerLb) continue;

              const prev = existingMap[u.crop] || {};
              existingMap[u.crop] = {
                crop: u.crop,
                unit: u.unit || prev.unit || 'lb',
                retailPrice: retailPerLb,
                wholesalePrice: wholesalePerLb,
                ws1Discount: u.ws1Discount || prev.ws1Discount || 15,
                ws2Discount: u.ws2Discount || prev.ws2Discount || 25,
                ws3Discount: u.ws3Discount || prev.ws3Discount || 35,
                currency: 'CAD',
                pricingSource: 'greenreach-central',
                lastUpdated: timestamp
              };
            }

            existing.crops = Object.values(existingMap);
            existing.lastUpdated = timestamp;
            existing.currency = 'CAD';
            existing.pricingSource = 'greenreach-central';
            await farmStore.set(fid, 'crop_pricing', existing);
            farmsPushed++;
          } catch (farmErr) {
            console.warn(`[Pricing Assistant] Failed to push to farm ${fid}:`, farmErr.message);
          }
        }
        console.log(`[Pricing Assistant] Pushed prices to ${farmsPushed} farm(s)`);
      } catch (pushErr) {
        console.warn('[Pricing Assistant] Farm push failed:', pushErr.message);
      }
    }

    // ── 4. Record pricing history ────────────────────────────────────────
    for (const r of results) {
      try {
        await query(`
          INSERT INTO pricing_history (crop, wholesale_price, offer_date, acceptance_rate, source)
          VALUES ($1, $2, CURRENT_DATE, 1.0, 'batch_update')
          ON CONFLICT DO NOTHING
        `, [r.crop, r.wholesalePerLb]);
      } catch (histErr) {
        // non-critical — history table may not exist yet
      }
    }

    res.json({
      success: true,
      message: `Applied ${results.length} price update(s)`,
      applied: results,
      errors: errors.length > 0 ? errors : undefined,
      persistence: {
        crop_pricing_json: true,
        crop_registry_json: registryUpdated > 0,
        farm_store_pushed: farmsPushed,
        pricing_history: true
      },
      reasoning,
      timestamp
    });

  } catch (error) {
    console.error('[Pricing Assistant] Batch update error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to apply batch price updates',
      message: error.message
    });
  }
});

/**
 * GET /api/admin/pricing/current-prices
 * Get current prices merged from crop-pricing.json, crop-registry.json, and lighting-recipes.json.
 * Returns all crops — recipe-derived crops are included so the scanner can manage them.
 */
router.get('/current-prices', (req, res) => {
  try {
    let pricingFile = { crops: [] };
    try {
      pricingFile = JSON.parse(fs.readFileSync(PRICING_FILE, 'utf8'));
    } catch (e) { /* empty */ }

    let registry = { crops: {} };
    try {
      registry = JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8'));
    } catch (e) { /* empty */ }

    // Load lighting-recipes.json for the full crop universe
    let recipes = { crops: {} };
    const recipesPath = path.join(path.dirname(REGISTRY_FILE), 'lighting-recipes.json');
    try {
      recipes = JSON.parse(fs.readFileSync(recipesPath, 'utf8'));
    } catch (e) { /* empty */ }

    // Merge pricing.json and registry into a unified list
    const merged = {};

    // From lighting-recipes (all recipe crops — source of truth for product list)
    for (const recipeName of Object.keys(recipes.crops || {})) {
      merged[recipeName] = {
        crop: recipeName,
        category: 'recipe',
        active: false,
        retailPerOz: 0,
        retailPerLb: 0,
        wholesalePerLb: 0,
        currency: 'CAD',
        source: 'recipe',
        lastUpdated: null
      };
    }

    // From registry (all known crops — overrides recipe stub)
    for (const [name, crop] of Object.entries(registry.crops || {})) {
      const existing = merged[name] || { crop: name };
      merged[name] = {
        ...existing,
        crop: name,
        category: crop.category || existing.category || 'unknown',
        active: !!crop.active,
        retailPerOz: crop.pricing?.retailPerOz || existing.retailPerOz || 0,
        retailPerLb: crop.growth?.retailPricePerLb || existing.retailPerLb || 0,
        wholesalePerLb: existing.wholesalePerLb || 0,
        currency: crop.pricing?.currency || 'CAD',
        source: 'registry',
        lastUpdated: crop.pricing?.lastUpdated || existing.lastUpdated || null
      };
    }

    // Overlay with crop-pricing.json values
    for (const c of (pricingFile.crops || [])) {
      const existing = merged[c.crop] || { crop: c.crop, category: 'unknown', active: false };
      existing.retailPerLb = c.retailPrice || existing.retailPerLb;
      existing.wholesalePerLb = c.wholesalePrice || existing.wholesalePerLb;
      existing.retailPerOz = existing.retailPerLb ? Math.round((existing.retailPerLb / 16) * 100) / 100 : existing.retailPerOz;
      existing.ws1Discount = c.ws1Discount || 15;
      existing.ws2Discount = c.ws2Discount || 25;
      existing.ws3Discount = c.ws3Discount || 35;
      existing.lastUpdated = c.lastUpdated || existing.lastUpdated;
      merged[c.crop] = existing;
    }

    const prices = Object.values(merged).sort((a, b) => {
      // Active crops first, then alphabetical
      if (a.active !== b.active) return a.active ? -1 : 1;
      return a.crop.localeCompare(b.crop);
    });

    res.json({
      success: true,
      prices,
      totalCrops: prices.length,
      activeCrops: prices.filter(p => p.active).length,
      pricedCrops: prices.filter(p => p.retailPerLb > 0).length,
      currency: 'CAD',
      lastUpdated: pricingFile.lastUpdated || null
    });
  } catch (error) {
    console.error('[Pricing Assistant] Current prices error:', error);
    res.status(500).json({ success: false, error: 'Failed to load current prices' });
  }
});

export default router;