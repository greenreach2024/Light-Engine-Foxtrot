/**
 * Farm Sales - Inventory Integration
 * Connects tray inventory with farm sales using lighting-recipes.json as source of truth
 */

import express from 'express';
import { farmAuthMiddleware } from '../../lib/farm-auth.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Note: These endpoints work without auth for demo mode
// farmId can be passed as query param or from auth middleware

// Load lighting recipes (source of truth for crops)
let lightingRecipes = null;
function loadLightingRecipes() {
  if (!lightingRecipes) {
    const recipesPath = path.join(__dirname, '../../public/data/lighting-recipes.json');
    try {
      const data = fs.readFileSync(recipesPath, 'utf8');
      lightingRecipes = JSON.parse(data);
      console.log(`[farm-sales] Loaded ${Object.keys(lightingRecipes.crops || {}).length} crop recipes`);
    } catch (error) {
      console.error('[farm-sales] Failed to load lighting-recipes.json:', error);
      lightingRecipes = { crops: {} };
    }
  }
  return lightingRecipes;
}

// Load crop pricing from crop-pricing.json (source of truth for prices)
let cropPricingData = null;
function loadCropPricing() {
  const pricingPath = path.join(__dirname, '../../public/data/crop-pricing.json');
  try {
    const data = fs.readFileSync(pricingPath, 'utf8');
    cropPricingData = JSON.parse(data);
  } catch (error) {
    console.error('[farm-sales] Failed to load crop-pricing.json:', error);
    cropPricingData = { crops: {} };
  }
  return cropPricingData;
}

/**
 * Get pricing for crop — reads from crop-pricing.json, 
 * falls back to lighting-recipes growth-time heuristic only if not found.
 */
function getCropPricing(cropName) {
  // 1. Try crop-pricing.json first (canonical pricing)
  const pricing = loadCropPricing();
  const crops = pricing.crops || {};
  const normalised = cropName.toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const [key, val] of Object.entries(crops)) {
    if (key.toLowerCase().replace(/[^a-z0-9]/g, '') === normalised) {
      const retailLb = parseFloat(val.retail_per_lb || val.retailPerLb || 0);
      const wholesaleLb = parseFloat(val.wholesale_per_lb || val.wholesalePerLb || 0);
      if (retailLb > 0) {
        return {
          unit_price: wholesaleLb || retailLb * 0.7,
          retail_price: retailLb
        };
      }
    }
  }

  // 2. Fallback — derive from lighting-recipes growth days
  const recipes = loadLightingRecipes();
  const cropData = recipes.crops[cropName];
  
  if (!cropData || cropData.length === 0) {
    return { unit_price: 16.46, retail_price: 23.52 }; // CAD default (greens)
  }

  const lastStage = cropData[cropData.length - 1];
  const growthDays = lastStage.day || 21;
  
  if (growthDays < 14) {
    return { unit_price: 16.46, retail_price: 23.52 };
  } else if (growthDays < 30) {
    return { unit_price: 17.58, retail_price: 25.12 };
  } else {
    return { unit_price: 30.24, retail_price: 43.20 };
  }
}

/**
 * GET /api/farm-sales/inventory/from-trays
 * Get farm sales inventory derived from actual tray inventory
 * Uses lighting-recipes.json for crop data
 */
router.get('/from-trays', async (req, res) => {
  try {
    // Get farm_id from auth middleware or query param (for demo mode)
    const farmId = req.farm_id || req.query.farmId || 'TEST-FARM-001';
    
    // Fetch tray inventory from backend
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:8000';
    const response = await fetch(`${backendUrl}/api/inventory/current?farmId=${farmId}`);
    
    if (!response.ok) {
      throw new Error(`Backend returned ${response.status}`);
    }

    const trayData = await response.json();
    const recipes = loadLightingRecipes();
    
    // Convert tray inventory to farm sales products
    const products = new Map();
    
    // Process all active tray runs
    for (const room of trayData.rooms || []) {
      for (const zone of room.zones || []) {
        for (const group of zone.groups || []) {
          // In real implementation, need to query tray runs in this group
          // For now, create inventory from available recipes
        }
      }
    }

    // Build inventory from recipes
    const cropNames = Object.keys(recipes.crops || {});
    const inventory = [];
    
    for (const cropName of cropNames) {
      const pricing = getCropPricing(cropName);
      const cropData = recipes.crops[cropName];
      const harvestDay = cropData[cropData.length - 1]?.day || 21;
      
      // Generate SKU from crop name
      const sku = cropName
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '-')
        .substring(0, 20);
      
      inventory.push({
        sku_id: sku,
        name: cropName,
        category: 'leafy_greens',
        unit: 'tray',
        quantity: 0, // Will be populated from actual tray counts
        available: 0,
        reserved: 0,
        unit_price: pricing.unit_price,
        retail_price: pricing.retail_price,
        harvest_days: Math.round(harvestDay),
        recipe_id: cropName,
        updated_at: new Date().toISOString()
      });
    }

    res.json({
      ok: true,
      farm_id: farmId,
      inventory,
      source: 'tray_inventory',
      recipe_source: 'lighting-recipes.json',
      totals: {
        total_skus: inventory.length,
        total_quantity: inventory.reduce((sum, p) => sum + p.quantity, 0),
        total_available: inventory.reduce((sum, p) => sum + p.available, 0)
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('[farm-sales] Tray inventory integration failed:', error);
    res.status(500).json({
      ok: false,
      error: 'tray_inventory_failed',
      message: error.message
    });
  }
});

/**
 * GET /api/farm-sales/inventory/crops
 * Get list of available crops from lighting-recipes.json
 */
router.get('/crops', (req, res) => {
  try {
    const recipes = loadLightingRecipes();
    const crops = Object.keys(recipes.crops || {}).map(cropName => {
      const cropData = recipes.crops[cropName];
      const lastStage = cropData[cropData.length - 1] || {};
      const pricing = getCropPricing(cropName);
      
      return {
        name: cropName,
        recipe_id: cropName,
        harvest_days: Math.round(lastStage.day || 21),
        stage: lastStage.stage || 'Unknown',
        ppfd: lastStage.ppfd || 0,
        temperature: lastStage.temperature || 20,
        unit_price: pricing.unit_price,
        retail_price: pricing.retail_price
      };
    });

    res.json({
      ok: true,
      crops,
      total: crops.length,
      source: 'lighting-recipes.json'
    });

  } catch (error) {
    console.error('[farm-sales] Crops list failed:', error);
    res.status(500).json({
      ok: false,
      error: 'crops_list_failed',
      message: error.message
    });
  }
});

export default router;
