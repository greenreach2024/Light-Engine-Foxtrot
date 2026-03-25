/**
 * GreenReach: Wholesale Catalog Aggregation
 * Aggregates inventory from all Light Engine farms into unified catalog
 * Applies ATP (available-to-promise) logic and merges duplicate SKUs
 */

import express from 'express';
import jwt from 'jsonwebtoken';
import { query } from '../../lib/database.js';
import { getBuyerDiscount } from '../../lib/wholesale/buyer-discount-service.js';
const router = express.Router();

function resolveBuyerFromHeader(req) {
  const authHeader = req.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : '';
  if (!token) return null;
  const secret = process.env.WHOLESALE_JWT_SECRET || process.env.JWT_SECRET || 'dev-greenreach-wholesale-secret';
  try {
    const payload = jwt.verify(token, secret);
    return payload?.buyerId || payload?.sub || null;
  } catch { return null; }
}

// Helper function to get active farms from database
async function getActiveFarms() {
  try {
    const result = await query(
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

    // Farms don't have inventory endpoints yet, so start with empty catalog
    // but merge in any farm_inventory rows from PostgreSQL
    let catalogItems = [];

    try {
      const invResult = await query(
        `SELECT fi.*, f.name AS farm_name
         FROM farm_inventory fi
         LEFT JOIN farms f ON f.farm_id = fi.farm_id
         WHERE fi.available_for_wholesale = true
           AND COALESCE(fi.quantity_available, fi.quantity, 0) > 0
         ORDER BY fi.product_name`
      );

      // Group by sku_id to merge across farms
      const skuMap = {};
      for (const row of invResult.rows) {
        const skuKey = row.sku_id || row.product_id;
        if (!skuMap[skuKey]) {
          skuMap[skuKey] = {
            sku_id: skuKey,
            sku_name: row.product_name,
            category: row.category || 'produce',
            unit: row.unit || 'lb',
            pack_size: 1,
            total_available: 0,
            min_price: Infinity,
            max_price: 0,
            farms: []
          };
        }
        const qty = Number(row.quantity_available || row.quantity || 0);
        const price = Number(row.wholesale_price || row.retail_price || row.price || 0);
        skuMap[skuKey].total_available += qty;
        skuMap[skuKey].min_price = Math.min(skuMap[skuKey].min_price, price || Infinity);
        skuMap[skuKey].max_price = Math.max(skuMap[skuKey].max_price, price);
        skuMap[skuKey].farms.push({
          farm_id: row.farm_id,
          farm_name: row.farm_name || row.farm_id,
          qty_available: qty,
          price_per_unit: price,
          quality_flags: []
        });
      }

      catalogItems = Object.values(skuMap).map(item => ({
        ...item,
        min_price: item.min_price === Infinity ? 0 : item.min_price
      }));

      if (category) {
        catalogItems = catalogItems.filter(i => i.category === category);
      }
    } catch (invErr) {
      console.warn('[Wholesale Catalog] farm_inventory query failed:', invErr.message);
    }
    
    // Resolve buyer discount if authenticated (optional -- catalog is public)
    const buyerId = resolveBuyerFromHeader(req);
    const buyerDiscount = buyerId ? await getBuyerDiscount(buyerId) : null;

    // Apply discount to catalog prices if buyer is authenticated
    if (buyerDiscount && buyerDiscount.rate > 0) {
      for (const item of catalogItems) {
        item.buyer_discount_rate = buyerDiscount.rate;
        for (const farm of item.farms) {
          farm.discounted_price = Math.round(farm.price_per_unit * (1 - buyerDiscount.rate) * 100) / 100;
        }
        item.min_discounted_price = Math.min(...item.farms.map(f => f.discounted_price || f.price_per_unit));
        item.max_discounted_price = Math.max(...item.farms.map(f => f.discounted_price || f.price_per_unit));
      }
    }
    
    console.log(`[Wholesale Catalog] Returning ${catalogItems.length} SKUs from ${REGISTERED_FARMS.length} farms`);

    res.json({
      ok: true,
      catalog_timestamp: new Date().toISOString(),
      total_skus: catalogItems.length,
      total_farms: REGISTERED_FARMS.length,
      buyer_discount: buyerDiscount,
      farms: REGISTERED_FARMS.map(f => ({
        farm_id: f.farmId,
        farm_name: f.name,
        status: f.status
      })),
      items: catalogItems
    });

  } catch (error) {
    console.error('[Wholesale Catalog] Error fetching farms:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to fetch wholesale catalog',
      message: error.message
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

    // Query farm_inventory for this SKU
    const invResult = await query(
      `SELECT fi.*, f.name AS farm_name
       FROM farm_inventory fi
       LEFT JOIN farms f ON f.farm_id = fi.farm_id
       WHERE (fi.sku_id = $1 OR fi.product_id = $1)
         AND fi.available_for_wholesale = true
       ORDER BY f.name`,
      [skuId]
    );

    const farms = invResult.rows.map(row => ({
      farm_id: row.farm_id,
      farm_name: row.farm_name || row.farm_id,
      qty_available: Number(row.quantity_available || row.quantity || 0),
      price_per_unit: Number(row.wholesale_price || row.retail_price || row.price || 0),
      quality_flags: []
    }));

    res.json({
      ok: true,
      sku_id: skuId,
      farms,
      total_available: farms.reduce((sum, f) => sum + f.qty_available, 0)
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
