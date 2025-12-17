/**
 * Light Engine: Wholesale Inventory Sync Routes
 * Exposes farm inventory lots and harvest windows to GreenReach
 * Called by GreenReach for catalog aggregation and ATP (available-to-promise)
 */

import express from 'express';
const router = express.Router();

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

    // TODO: Query farm inventory database
    // For now, return demo structure showing what GreenReach will receive
    
    const farmInventory = {
      farm_id: 'demo-farm-1',
      farm_name: 'Light Engine Demo Farm',
      inventory_timestamp: new Date().toISOString(),
      lots: [
        {
          lot_id: 'LOT-2025-001',
          sku_id: 'SKU-ROMAINE-5LB',
          sku_name: 'Romaine Lettuce, 5lb case',
          qty_available: 50,
          qty_reserved: 0,
          unit: 'case',
          pack_size: 5, // 5 lbs per case
          price_per_unit: 12.50, // $12.50 per case wholesale
          harvest_date_start: new Date(Date.now() + 24*60*60*1000).toISOString(), // Tomorrow
          harvest_date_end: new Date(Date.now() + 48*60*60*1000).toISOString(), // 2 days
          quality_flags: ['certified_organic', 'local', 'gfsi_compliant'],
          location: 'Zone-A-Shelf-3'
        },
        {
          lot_id: 'LOT-2025-002',
          sku_id: 'SKU-BASIL-1LB',
          sku_name: 'Sweet Basil, 1lb bunch',
          qty_available: 100,
          qty_reserved: 10,
          unit: 'bunch',
          pack_size: 1,
          price_per_unit: 8.00, // $8.00 per bunch
          harvest_date_start: new Date().toISOString(), // Today
          harvest_date_end: new Date(Date.now() + 24*60*60*1000).toISOString(), // Tomorrow
          quality_flags: ['certified_organic', 'local'],
          location: 'Zone-B-Shelf-1'
        },
        {
          lot_id: 'LOT-2025-003',
          sku_id: 'SKU-ARUGULA-3LB',
          sku_name: 'Arugula, 3lb case',
          qty_available: 75,
          qty_reserved: 5,
          unit: 'case',
          pack_size: 3,
          price_per_unit: 10.00,
          harvest_date_start: new Date(Date.now() + 24*60*60*1000).toISOString(),
          harvest_date_end: new Date(Date.now() + 36*60*60*1000).toISOString(),
          quality_flags: ['certified_organic', 'local'],
          location: 'Zone-A-Shelf-5'
        }
      ]
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
