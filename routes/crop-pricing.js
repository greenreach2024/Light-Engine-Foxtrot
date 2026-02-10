/**
 * Crop Pricing API
 * GET /api/crop-pricing - Get current farm crop pricing
 * PUT /api/crop-pricing - Update crop pricing (admin only)
 */

import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PRICING_FILE = path.resolve(__dirname, '../public/data/crop-pricing.json');
const RECIPES_FILE = path.resolve(__dirname, '../public/data/lighting-recipes.json');
const GROUPS_FILE = path.resolve(__dirname, '../public/data/groups.json');

/**
 * Extract a human-readable crop name from a plan ID
 * e.g. "crop-bibb-butterhead" → "Bibb Butterhead"
 */
function planIdToCropName(planId) {
  if (!planId || typeof planId !== 'string') return null;
  const cleanId = planId.replace(/^crop-/, '');
  return cleanId
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * GET /api/crop-pricing
 * Returns current crop pricing configuration merged with all crops from lighting recipes.
 * Each crop includes an `isGrowing` flag based on current groups.json.
 */
router.get('/', (req, res) => {
  try {
    // Load existing pricing data
    let pricingData = { crops: [] };
    try {
      pricingData = JSON.parse(fs.readFileSync(PRICING_FILE, 'utf8'));
    } catch (e) { /* no pricing file yet */ }
    
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
    
    const mergedCrops = Array.from(allCropSet).sort().map(cropName => {
      const existing = priceMap[cropName];
      return {
        crop: cropName,
        unit: existing?.unit || 'lb',
        retailPrice: existing?.retailPrice || 0,
        wholesalePrice: existing?.wholesalePrice || 0,
        ws1Discount: existing?.ws1Discount || 15,
        ws2Discount: existing?.ws2Discount || 25,
        ws3Discount: existing?.ws3Discount || 35,
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
router.put('/', (req, res) => {
  try {
    const { crops } = req.body;
    
    if (!crops || !Array.isArray(crops)) {
      return res.status(400).json({
        ok: false,
        error: 'invalid_crops_array'
      });
    }
    
    // Load existing data
    const data = JSON.parse(fs.readFileSync(PRICING_FILE, 'utf8'));
    
    // Update crops
    data.crops = crops;
    data.lastUpdated = new Date().toISOString();
    
    // Save to file
    fs.writeFileSync(PRICING_FILE, JSON.stringify(data, null, 2), 'utf8');
    
    console.log(`[crop-pricing] Updated ${crops.length} crop prices`);
    
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
router.get('/:cropName', (req, res) => {
  try {
    const cropName = decodeURIComponent(req.params.cropName);
    const data = JSON.parse(fs.readFileSync(PRICING_FILE, 'utf8'));
    const cropPricing = data.crops.find(c => c.crop === cropName);
    
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

export default router;
