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

/**
 * GET /api/crop-pricing
 * Returns current crop pricing configuration
 */
router.get('/', (req, res) => {
  try {
    const data = JSON.parse(fs.readFileSync(PRICING_FILE, 'utf8'));
    res.json({
      ok: true,
      pricing: data
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
