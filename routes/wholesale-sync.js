/**
 * Light Engine: Wholesale Inventory Sync Routes
 * Exposes farm inventory lots and harvest windows to GreenReach
 * Called by GreenReach for catalog aggregation and ATP (available-to-promise)
 */

import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to real farm data
const PUBLIC_DIR = path.resolve(__dirname, '../public');
const GROUPS_FILE = path.join(PUBLIC_DIR, 'data', 'groups.json');
const RECIPES_FILE = path.join(PUBLIC_DIR, 'data', 'lighting-recipes.json');

/**
 * GET /api/wholesale/inventory
 * Return farm inventory lots with availability for wholesale orders
 * 
 * Response format:
 * {
 *   farm_id: string,
 *   farm_name: string,
 *   inventory_timestamp: ISO timestamp,
 *   lots: [{
 *     lot_id: string,
 *     sku_id: string,
 *     sku_name: string,
 *     qty_available: number,
 *     qty_reserved: number,
 *     unit: string,
 *     pack_size: number,
 *     price_per_unit: number,
 *     harvest_date_start: ISO date,
 *     harvest_date_end: ISO date,
 *     quality_flags: string[],
 *     location: string (zone/shelf identifier)
 *   }]
 * }
 */
router.get('/inventory', async (req, res) => {
  try {
    console.log('[Wholesale Sync] GreenReach requesting farm inventory');

    // Load real farm data from groups.json
    const groupsData = JSON.parse(fs.readFileSync(GROUPS_FILE, 'utf8'));
    const groups = groupsData.groups || [];

    // Load recipes for grow cycle information
    const recipesData = JSON.parse(fs.readFileSync(RECIPES_FILE, 'utf8'));
    const recipes = recipesData.recipes || {};

    // Build lots from real groups
    const lots = [];
    const today = new Date();

    groups.forEach((group) => {
      const cropName = group.crop || group.recipe;
      const recipe = recipes[cropName];
      
      // Get grow days from recipe or use default
      let growDays = 35;
      if (recipe && recipe.day_by_day && Array.isArray(recipe.day_by_day)) {
        growDays = recipe.day_by_day.length;
      }

      // Calculate days since seed
      let daysOld = 0;
      if (group.planConfig?.anchor?.seedDate) {
        const seedDate = new Date(group.planConfig.anchor.seedDate);
        daysOld = Math.floor((today - seedDate) / (1000 * 60 * 60 * 24));
      }

      // Calculate harvest dates
      const daysUntilHarvest = Math.max(0, growDays - daysOld);
      const harvestStart = new Date(today.getTime() + daysUntilHarvest * 24 * 60 * 60 * 1000);
      const harvestEnd = new Date(harvestStart.getTime() + 2 * 24 * 60 * 60 * 1000); // 2-day harvest window

      // Calculate available quantity
      const trayCount = group.trays || 4;
      const plantsPerTray = (group.plants || 48) / trayCount;
      const lbsPerPlant = 0.125; // ~2oz per plant average
      const totalLbs = Math.round(trayCount * plantsPerTray * lbsPerPlant);
      const qtyAvailable = Math.ceil(totalLbs / 5); // Convert to 5lb cases

      // Create wholesale lot
      const lot = {
        lot_id: `LOT-${group.id}`,
        sku_id: `SKU-${cropName.toUpperCase().replace(/\s+/g, '-')}-5LB`,
        sku_name: `${cropName}, 5lb case`,
        qty_available: qtyAvailable,
        qty_reserved: 0,
        unit: 'case',
        pack_size: 5, // 5 lbs per case
        price_per_unit: 12.50, // Default wholesale price
        harvest_date_start: harvestStart.toISOString(),
        harvest_date_end: harvestEnd.toISOString(),
        quality_flags: ['local', 'vertical_farm', 'pesticide_free'],
        location: group.zone || group.roomId || 'Unknown',
        crop_type: cropName,
        days_to_harvest: daysUntilHarvest
      };

      lots.push(lot);
    });
    
    // Load farm identity from farm.json for consistent naming
    const farmPath = path.join(PUBLIC_DIR, 'data', 'farm.json');
    let farmInfo = { farmId: 'light-engine-demo', name: 'GreenReach Demo Farm' };
    try {
      const farmData = JSON.parse(fs.readFileSync(farmPath, 'utf8'));
      if (farmData.farmId) farmInfo.farmId = farmData.farmId;
      if (farmData.name) farmInfo.name = farmData.name;
    } catch (err) {
      console.log('[Wholesale Sync] Using default farm identity');
    }
    
    const farmInventory = {
      farm_id: farmInfo.farmId,
      farm_name: farmInfo.name,
      inventory_timestamp: new Date().toISOString(),
      lots: lots
    };

    res.json({
      ok: true,
      ...farmInventory
    });

  } catch (error) {
    console.error('[Wholesale Sync] Failed to fetch inventory:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to retrieve farm inventory',
      message: error.message
    });
  }
});

/**
 * GET /api/wholesale/schedule
 * Return farm pickup windows and delivery logistics
 * 
 * Response format:
 * {
 *   farm_id: string,
 *   pickup_windows: [{
 *     day: string (Monday, Tuesday, etc.),
 *     time_start: string (HH:MM),
 *     time_end: string (HH:MM),
 *     capacity: number (max orders per window),
 *     current_bookings: number
 *   }],
 *   lead_time_hours: number,
 *   delivery_notes: string
 * }
 */
router.get('/schedule', async (req, res) => {
  try {
    console.log('[Wholesale Sync] GreenReach requesting pickup schedule');

    const farmSchedule = {
      farm_id: 'demo-farm-1',
      farm_name: 'Light Engine Demo Farm',
      pickup_windows: [
        {
          day: 'Monday',
          time_start: '06:00',
          time_end: '10:00',
          capacity: 20,
          current_bookings: 5
        },
        {
          day: 'Tuesday',
          time_start: '06:00',
          time_end: '10:00',
          capacity: 20,
          current_bookings: 8
        },
        {
          day: 'Thursday',
          time_start: '06:00',
          time_end: '10:00',
          capacity: 20,
          current_bookings: 3
        },
        {
          day: 'Friday',
          time_start: '06:00',
          time_end: '10:00',
          capacity: 20,
          current_bookings: 12
        }
      ],
      lead_time_hours: 48, // Minimum 48 hours notice required
      delivery_notes: 'Loading dock access. Palletized orders only for quantities over 500 lbs.'
    };

    res.json({
      ok: true,
      ...farmSchedule
    });

  } catch (error) {
    console.error('[Wholesale Sync] Failed to fetch schedule:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to retrieve pickup schedule',
      message: error.message
    });
  }
});

/**
 * GET /api/wholesale/pricing
 * Return wholesale pricing matrix by SKU and quantity tiers
 * 
 * Response format:
 * {
 *   farm_id: string,
 *   pricing: [{
 *     sku_id: string,
 *     sku_name: string,
 *     base_price: number,
 *     volume_tiers: [{
 *       min_qty: number,
 *       max_qty: number,
 *       price_per_unit: number
 *     }],
 *     min_order_qty: number
 *   }]
 * }
 */
router.get('/pricing', async (req, res) => {
  try {
    console.log('[Wholesale Sync] GreenReach requesting pricing data');

    const pricingData = {
      farm_id: 'demo-farm-1',
      pricing: [
        {
          sku_id: 'SKU-ROMAINE-5LB',
          sku_name: 'Romaine Lettuce, 5lb case',
          base_price: 12.50,
          volume_tiers: [
            { min_qty: 1, max_qty: 19, price_per_unit: 12.50 },
            { min_qty: 20, max_qty: 49, price_per_unit: 11.50 },
            { min_qty: 50, max_qty: null, price_per_unit: 10.50 }
          ],
          min_order_qty: 5
        },
        {
          sku_id: 'SKU-BASIL-1LB',
          sku_name: 'Sweet Basil, 1lb bunch',
          base_price: 8.00,
          volume_tiers: [
            { min_qty: 1, max_qty: 49, price_per_unit: 8.00 },
            { min_qty: 50, max_qty: 99, price_per_unit: 7.50 },
            { min_qty: 100, max_qty: null, price_per_unit: 7.00 }
          ],
          min_order_qty: 10
        }
      ]
    };

    res.json({
      ok: true,
      ...pricingData
    });

  } catch (error) {
    console.error('[Wholesale Sync] Failed to fetch pricing:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to retrieve pricing data',
      message: error.message
    });
  }
});

export default router;
