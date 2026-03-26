/**
 * Crop Pricing API
 * GET /api/crop-pricing - Get current farm crop pricing
 * PUT /api/crop-pricing - Update crop pricing (admin only)
 */

import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { farmStore } from '../lib/farm-data-store.js';

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RECIPES_FILE = path.resolve(__dirname, '../public/data/lighting-recipes.json');

// Crop utilities — Phase 2a unified crop registry
const _require = createRequire(import.meta.url);
const cropUtils = _require('../public/js/crop-utils.js');

/**
 * Extract a human-readable crop name from a plan ID.
 * Delegates to cropUtils.planIdToCropName() (Phase 2a).
 */
function planIdToCropName(planId) {
  if (!planId || typeof planId !== 'string') return null;
  const result = cropUtils.planIdToCropName(planId);
  return result === 'Unknown' ? null : result;
}

/**
 * GET /api/crop-pricing
 * Returns current crop pricing configuration merged with all crops from lighting recipes.
 * Each crop includes an `isGrowing` flag based on current groups data.
 */
router.get('/', async (req, res) => {
  try {
    const fid = farmStore.farmIdFromReq(req);

    // Load existing pricing data (farm-scoped)
    const pricingData = await farmStore.get(fid, 'crop_pricing') || { crops: [] };
    
    // Build a map of existing prices by crop name
    const priceMap = {};
    (pricingData.crops || []).forEach(c => {
      priceMap[c.crop] = c;
    });
    
    // Load all crops from lighting-recipes.json (global reference data)
    let allCropNames = [];
    try {
      const recipesData = JSON.parse(fs.readFileSync(RECIPES_FILE, 'utf8'));
      if (recipesData.crops) {
        allCropNames = Object.keys(recipesData.crops).sort();
      }
    } catch (e) {
      console.warn('[crop-pricing] Could not load lighting-recipes.json:', e.message);
    }

    // Determine which crops are currently growing from farm-scoped groups
    const growingCrops = new Set();
    const groups = await farmStore.get(fid, 'groups') || [];
    (Array.isArray(groups) ? groups : []).forEach(g => {
      const cropName = g.crop || planIdToCropName(g.plan);
      if (cropName) growingCrops.add(cropName);
    });
    
    // Merge: all recipe crops + any extra crops in pricing that aren't in recipes
    const allCropSet = new Set([...allCropNames, ...Object.keys(priceMap)]);
    
    const mergedCrops = Array.from(allCropSet).sort().map(cropName => {
      const existing = priceMap[cropName];
      return {
        crop: cropName,
        unit: existing?.unit || 'oz',
        retailPrice: existing?.retailPrice || 0,
        wholesalePrice: existing?.wholesalePrice || 0,
        ws1Discount: existing?.ws1Discount || 15,
        ws2Discount: existing?.ws2Discount || 25,
        ws3Discount: existing?.ws3Discount || 35,
        floor_price: existing?.floor_price ?? 0,
        sku_factor: existing?.sku_factor ?? 0.65,
        isTaxable: existing?.isTaxable || false,
        isGrowing: growingCrops.has(cropName),
        hasPricing: !!existing
      };
    });
    
    res.json({
      ok: true,
      pricing: {
        ...pricingData,
        crops: mergedCrops,
        totalCrops: mergedCrops.length,
        growingCrops: growingCrops.size,
        pricedCrops: Object.keys(priceMap).length
      }
    });
  } catch (error) {
    console.error('[crop-pricing] Failed to read pricing:', error);
    res.status(500).json({
      ok: false,
      error: 'failed_to_load_pricing'
    });
  }
});

/**
 * PUT /api/crop-pricing
 * Update crop pricing configuration
 * Body: { crops: [...] }
 */
router.put('/', async (req, res) => {
  try {
    const { crops } = req.body;
    
    if (!crops || !Array.isArray(crops)) {
      return res.status(400).json({
        ok: false,
        error: 'invalid_crops_array'
      });
    }
    
    const fid = farmStore.farmIdFromReq(req);

    // Load existing data
    const data = await farmStore.get(fid, 'crop_pricing') || { crops: [] };
    
    // Update crops
    data.crops = crops;
    data.lastUpdated = new Date().toISOString();
    
    // Save to farm-scoped store
    await farmStore.set(fid, 'crop_pricing', data);
    
    console.log(`[crop-pricing] Updated ${crops.length} crop prices for farm ${fid || 'default'}`);
    
    res.json({
      ok: true,
      message: 'Pricing updated successfully',
      crops: data.crops
    });
  } catch (error) {
    console.error('[crop-pricing] Failed to update pricing:', error);
    res.status(500).json({
      ok: false,
      error: 'failed_to_update_pricing'
    });
  }
});

/**
 * GET /api/crop-pricing/:cropName
 * Get pricing for a specific crop
 */
router.get('/:cropName', async (req, res) => {
  try {
    const cropName = decodeURIComponent(req.params.cropName);
    const fid = farmStore.farmIdFromReq(req);
    const data = await farmStore.get(fid, 'crop_pricing') || { crops: [] };
    const cropPricing = (data.crops || []).find(c => c.crop === cropName);
    
    if (!cropPricing) {
      return res.status(404).json({
        ok: false,
        error: 'crop_not_found',
        crop: cropName
      });
    }
    
    res.json({
      ok: true,
      pricing: cropPricing
    });
  } catch (error) {
    console.error('[crop-pricing] Failed to get crop pricing:', error);
    res.status(500).json({
      ok: false,
      error: 'failed_to_load_crop_pricing'
    });
  }
});

/**
 * GET /api/crop-pricing/export
 * Download pricing as CSV
 */
router.get('/export', async (req, res) => {
  try {
    const fid = farmStore.farmIdFromReq(req);
    const data = await farmStore.get(fid, 'crop_pricing') || { crops: [] };
    const crops = data.crops || [];

    const csvEscape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = ['Crop', 'Unit', 'Retail Price', 'WS1 Discount %', 'WS2 Discount %', 'WS3 Discount %', 'Taxable'].map(csvEscape).join(',');
    const rows = crops.map(c =>
      [c.crop, c.unit || 'lb', c.retailPrice || 0, c.ws1Discount || 0, c.ws2Discount || 0, c.ws3Discount || 0, c.isTaxable ? 'Yes' : 'No'].map(csvEscape).join(',')
    );

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="crop-pricing-${new Date().toISOString().slice(0,10)}.csv"`);
    res.send([header, ...rows].join('\n'));
  } catch (error) {
    console.error('[crop-pricing] CSV export failed:', error);
    res.status(500).json({ ok: false, error: 'export_failed' });
  }
});

/**
 * Export pricing data for internal use by other routes
 */
export async function getCropPricing(farmId) {
  try {
    const data = await farmStore.get(farmId, 'crop_pricing') || { crops: [] };
    return data.crops || [];
  } catch (e) {
    console.warn('[crop-pricing] Could not load pricing:', e.message);
    return [];
  }
}

/**
 * POST /api/crop-pricing/decisions
 * Phase 3B — Record a pricing decision (accepted/rejected/modified AI recommendation)
 */
router.post('/decisions', async (req, res) => {
  try {
    const pool = req.app?.locals?.dbPool;
    if (!pool) return res.status(503).json({ ok: false, error: 'Database not available' });

    const fid = farmStore.farmIdFromReq(req) || 'default';
    const { decisions } = req.body;
    if (!Array.isArray(decisions) || decisions.length === 0) {
      return res.status(400).json({ ok: false, error: 'decisions array required' });
    }

    // Ensure table exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS pricing_decisions (
        id              SERIAL PRIMARY KEY,
        farm_id         VARCHAR(100) NOT NULL,
        crop            VARCHAR(150) NOT NULL,
        previous_price  NUMERIC(10,2),
        recommended_price NUMERIC(10,2),
        applied_price   NUMERIC(10,2) NOT NULL,
        market_average  NUMERIC(10,2),
        ai_outlook      VARCHAR(20),
        ai_action       VARCHAR(50),
        trend           VARCHAR(20),
        data_source     VARCHAR(20) DEFAULT 'static',
        decision        VARCHAR(20) DEFAULT 'accepted',
        created_at      TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    let recorded = 0;
    for (const d of decisions) {
      if (!d.crop || d.applied_price == null) continue;
      await pool.query(
        `INSERT INTO pricing_decisions (farm_id, crop, previous_price, recommended_price, applied_price, market_average, ai_outlook, ai_action, trend, data_source, decision)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [fid, d.crop, d.previous_price, d.recommended_price, d.applied_price, d.market_average, d.ai_outlook || null, d.ai_action || null, d.trend || null, d.data_source || 'static', d.decision || 'accepted']
      );
      recorded++;
    }

    console.log(`[crop-pricing] Recorded ${recorded} pricing decisions for farm ${fid}`);
    return res.json({ ok: true, recorded });
  } catch (error) {
    console.error('[crop-pricing] Pricing decisions error:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

export default router;
