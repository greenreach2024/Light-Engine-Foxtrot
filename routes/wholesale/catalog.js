/**
 * GreenReach: Wholesale Catalog Aggregation
 * Aggregates inventory from all Light Engine farms into unified catalog
 * Applies ATP (available-to-promise) logic and merges duplicate SKUs
 */

import express from 'express';
import { dbQuery } from '../../lib/database.js';
const router = express.Router();

// Helper function to get active farms from database
async function getActiveFarms() {
  try {
    const result = await dbQuery(
      `SELECT farm_id, name, contact_name, email, status 
       FROM farms 
       WHERE status = 'active'
       ORDER BY name`
    );
    
    // For now, farms don't have inventory endpoints yet
    // Return farm info for display even without inventory
    return result.rows.map(farm => ({
      farmId: farm.farm_id,
      name: farm.name,
      contactName: farm.contact_name,
      email: farm.email,
      status: farm.status,
      // TODO: Add farm URL when farms have their own inventory endpoints
      url: null
    }));
  } catch (error) {
    console.error('[Wholesale Catalog] Error fetching farms from database:', error);
    return [];
  }
}

/**
 * GET /api/wholesale/catalog
 * Aggregated catalog from all farms with ATP availability
 * 
 * Query params:
 * - category: Filter by category (leafy_greens, herbs, microgreens, produce)
 * - delivery_date: ISO date for ATP calculation (default: +2 days)
 * - zip: Buyer zip code for farm proximity sorting
 * 
 * Response:
 * {
 *   ok: true,
 *   catalog_timestamp: ISO timestamp,
 *   total_skus: number,
 *   total_farms: number,
 *   items: [{
 *     sku_id: string,
 *     sku_name: string,
 *     category: string,
 *     unit: string,
 *     pack_size: number,
 *     total_available: number,
 *     min_price: number,
 *     max_price: number,
 *     farms: [{
 *       farm_id: string,
 *       farm_name: string,
 *       region: string,
 *       qty_available: number,
 *       price_per_unit: number,
 *       harvest_date_start: ISO date,
 *       harvest_date_end: ISO date,
 *       quality_flags: string[],
 *       distance_miles: number (if zip provided)
 *     }]
 *   }]
 * }
 */
router.get('/', async (req, res) => {
  try {
    const { category, delivery_date, zip } = req.query;
    
    // Get active farms from database
    const REGISTERED_FARMS = await getActiveFarms();
    
    console.log('[Wholesale Catalog] Found', REGISTERED_FARMS.length, 'active farms in database');
    if (category) console.log('  Filter: category =', category);
    if (delivery_date) console.log('  Filter: delivery_date =', delivery_date);
    if (zip) console.log('  Buyer zip:', zip);

    // Farms don't have inventory endpoints yet, so return empty catalog with farm info
    const catalogItems = [];
    
    console.log(`[Wholesale Catalog] Returning ${catalogItems.length} SKUs from ${REGISTERED_FARMS.length} farms`);
    console.log('[Wholesale Catalog] Note: Farms do not have inventory yet - showing farms but empty catalog');

    res.json({
      ok: true,
      catalog_timestamp: new Date().toISOString(),
      total_skus: catalogItems.length,
      total_farms: REGISTERED_FARMS.length,
      farms: REGISTERED_FARMS.map(f => ({
        farm_id: f.farmId,
        farm_name: f.name,
        status: f.status
      })),
      items: catalogItems
    });

  }
});

/**
 * GET /api/wholesale/catalog/sku/:skuId
 * Get detailed availability for a specific SKU across all farms
 */
router.get('/sku/:skuId', async (req, res) => {
  try {
    const { skuId } = req.params;
    const { delivery_date, zip } = req.query;

    console.log(`[Wholesale Catalog] Fetching availability for SKU ${skuId}`);
    
    // Get active farms from database
    const REGISTERED_FARMS = await getActiveFarms();

    // Farms don't have inventory endpoints yet
    res.json({
      ok: true,
      sku_id: skuId,
      farms: [],
      total_available: 0,
      message: 'Farms do not have inventory yet'
    });

  } catch (error) {
    console.error('[Wholesale Catalog] Failed to fetch SKU availability:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to fetch SKU availability',
      message: error.message
    });
  }
});

export default router;
