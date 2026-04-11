/**
 * Crop Pricing API
 * GET /api/crop-pricing - Get current farm crop pricing
 * PUT /api/crop-pricing - Update crop pricing (admin only)
 *
 * Persistence: GCS on Cloud Run, local fs fallback for development.
 */

import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { readJSON, writeJSON } from '../services/gcs-storage.js';

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PRICING_FILE = path.resolve(__dirname, '../public/data/crop-pricing.json');
const PRICING_REL = 'public/data/crop-pricing.json';
const RECIPES_FILE = path.resolve(__dirname, '../public/data/lighting-recipes.json');
const GROUPS_FILE = path.resolve(__dirname, '../public/data/groups.json');

// Recipe metadata for display names & descriptions
const RECIPE_META_PATH = process.env.DEPLOYMENT_MODE === 'cloud'
    ? '/app/data/recipes-v2/_recipe-meta.json'
    : path.resolve(__dirname, '../greenreach-central/data/recipes-v2/_recipe-meta.json');

function loadRecipeMetaSync() {
    try { return JSON.parse(fs.readFileSync(RECIPE_META_PATH, 'utf8')); } catch { return {}; }
}

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
 * Each crop includes an `isGrowing` flag based on current groups.json.
 */
router.get('/', async (req, res) => {
  try {
    // Load existing pricing data (GCS first, local fallback)
    // Fall back to local baked-in file if GCS has null OR an empty crops array.
    let pricingData = await readJSON(PRICING_REL, null);
    if (!pricingData || !(pricingData.crops?.length > 0)) {
      try { pricingData = JSON.parse(fs.readFileSync(PRICING_FILE, 'utf8')); } catch { pricingData = { crops: [] }; }
    }
    
    // Build a map of existing prices by crop name
    const priceMap = {};
    (pricingData.crops || []).forEach(c => {
      priceMap[c.crop] = c;
    });
    
    // Load all crops from lighting-recipes.json
    let allCropNames = [];
    try {
      const recipesData = JSON.parse(fs.readFileSync(RECIPES_FILE, 'utf8'));
      if (recipesData.crops) {
        allCropNames = Object.keys(recipesData.crops).sort();
      }
    } catch (e) {
      console.warn('[crop-pricing] Could not load lighting-recipes.json:', e.message);
    }

    // Determine which crops are currently growing from groups.json
    const growingCrops = new Set();
    try {
      const groupsData = JSON.parse(fs.readFileSync(GROUPS_FILE, 'utf8'));
      (groupsData.groups || []).forEach(g => {
        const cropName = g.crop || planIdToCropName(g.plan);
        if (cropName) growingCrops.add(cropName);
      });
    } catch (e) { /* no groups file */ }
    
    // Merge: all recipe crops + any extra crops in pricing that aren't in recipes
    const allCropSet = new Set([...allCropNames, ...Object.keys(priceMap)]);
    
    // Load recipe metadata for display names & descriptions
    const recipeMeta = loadRecipeMetaSync();

    const mergedCrops = Array.from(allCropSet).sort().map(cropName => {
      const existing = priceMap[cropName];
      const meta = recipeMeta[cropName] || {};
      return {
        crop: cropName,
        displayName: meta.displayName || null,
        description: meta.description || null,
        unit: existing?.unit || 'lb',
        retailPrice: existing?.retailPrice || 0,
        wholesalePrice: existing?.wholesalePrice || 0,
        ws1Discount: existing?.ws1Discount ?? 20,
        ws2Discount: existing?.ws2Discount || 25,
        ws3Discount: existing?.ws3Discount || 35,
        floor_price: existing?.floor_price ?? 0,
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
    console.error('[crop-pricing] Failed to read pricing file:', error);
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
    
    // Load existing data (GCS first, local fallback)
    let data = await readJSON(PRICING_REL, null);
    if (!data) {
      try { data = JSON.parse(fs.readFileSync(PRICING_FILE, 'utf8')); } catch { data = { crops: [] }; }
    }
    
    // Update crops
    data.crops = crops;
    data.lastUpdated = new Date().toISOString();
    
    // Persist to GCS (and write local copy for immediate reads)
    await writeJSON(PRICING_REL, data);
    try { fs.writeFileSync(PRICING_FILE, JSON.stringify(data, null, 2), 'utf8'); } catch { /* local write optional */ }
    
    console.log(`[crop-pricing] Updated ${crops.length} crop prices (GCS + local)`);
    
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
    let data = await readJSON(PRICING_REL, null);
    if (!data) {
      try { data = JSON.parse(fs.readFileSync(PRICING_FILE, 'utf8')); } catch { data = { crops: [] }; }
    }
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

// On startup: if GCS has pricing data, hydrate local; if GCS is empty/missing, seed GCS from the baked-in local file.
(async () => {
  try {
    const gcsData = await readJSON(PRICING_REL, null);
    if (gcsData && gcsData.crops && gcsData.crops.length > 0) {
      // GCS has data — write it to local for fast subsequent reads
      fs.mkdirSync(path.dirname(PRICING_FILE), { recursive: true });
      fs.writeFileSync(PRICING_FILE, JSON.stringify(gcsData, null, 2), 'utf8');
      console.log(`[crop-pricing] Hydrated local pricing file from GCS (${gcsData.crops.length} crops)`);
    } else {
      // GCS is empty or missing — seed it from the baked-in local pricing file
      try {
        const localData = JSON.parse(fs.readFileSync(PRICING_FILE, 'utf8'));
        if (localData && localData.crops && localData.crops.length > 0) {
          await writeJSON(PRICING_REL, localData);
          console.log(`[crop-pricing] Seeded GCS pricing from local baked-in file (${localData.crops.length} crops)`);
        }
      } catch (seedErr) {
        console.warn('[crop-pricing] GCS pricing seed from local failed:', seedErr.message);
      }
    }
  } catch (err) {
    console.warn('[crop-pricing] GCS hydration skipped:', err.message);
  }
})();

export default router;
