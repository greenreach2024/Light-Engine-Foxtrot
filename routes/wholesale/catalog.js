/**
 * GreenReach: Wholesale Catalog Aggregation
 * Aggregates inventory from all Light Engine farms into unified catalog
 * Applies ATP (available-to-promise) logic and merges duplicate SKUs
 */

import express from 'express';
const router = express.Router();

// Import registered farms from admin-health
// In production, this would come from database
const REGISTERED_FARMS = [
  {
    farmId: 'demo-farm-1',
    name: 'Light Engine Demo Farm',
    url: 'http://light-engine-demo-env.eba-smmuh8fc.us-east-1.elasticbeanstalk.com',
    location: 'AWS us-east-1',
    region: 'Pacific Northwest',
    status: 'active'
  }
];

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
    
    console.log('[Wholesale Catalog] Aggregating inventory from', REGISTERED_FARMS.length, 'farms');
    if (category) console.log('  Filter: category =', category);
    if (delivery_date) console.log('  Filter: delivery_date =', delivery_date);
    if (zip) console.log('  Buyer zip:', zip);

    // Fetch inventory from all farms in parallel
    const farmInventoryPromises = REGISTERED_FARMS.map(async (farm) => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000); // 5 second timeout

        const response = await fetch(`${farm.url}/api/wholesale/inventory`, {
          signal: controller.signal
        });
        clearTimeout(timeout);

        if (!response.ok) {
          console.warn(`[Wholesale Catalog] Farm ${farm.name} returned ${response.status}`);
          return { farm, inventory: null, error: `HTTP ${response.status}` };
        }

        const data = await response.json();
        return { farm, inventory: data, error: null };

      } catch (error) {
        console.error(`[Wholesale Catalog] Failed to fetch inventory from ${farm.name}:`, error.message);
        return { farm, inventory: null, error: error.message };
      }
    });

    const farmInventories = await Promise.all(farmInventoryPromises);

    // Aggregate inventory by SKU
    const catalogMap = new Map();

    for (const { farm, inventory, error } of farmInventories) {
      if (!inventory || !inventory.lots) {
        console.warn(`[Wholesale Catalog] Skipping ${farm.name}: ${error || 'No inventory'}`);
        continue;
      }

      for (const lot of inventory.lots) {
        // Apply category filter
        if (category && !lot.sku_id.toLowerCase().includes(category.toLowerCase())) {
          continue;
        }

        // Apply ATP logic: only include lots with harvest window matching delivery date
        if (delivery_date) {
          const deliveryTime = new Date(delivery_date).getTime();
          const harvestStart = new Date(lot.harvest_date_start).getTime();
          const harvestEnd = new Date(lot.harvest_date_end).getTime();
          
          // Lot must be harvestable before or at delivery date
          if (harvestStart > deliveryTime) {
            continue;
          }
        }

        // Get or create catalog entry for this SKU
        if (!catalogMap.has(lot.sku_id)) {
          catalogMap.set(lot.sku_id, {
            sku_id: lot.sku_id,
            sku_name: lot.sku_name,
            category: lot.category || 'produce',
            unit: lot.unit,
            pack_size: lot.pack_size,
            total_available: 0,
            min_price: Infinity,
            max_price: 0,
            farms: []
          });
        }

        const catalogEntry = catalogMap.get(lot.sku_id);

        // Calculate distance if zip provided
        let distance_miles = null;
        if (zip) {
          // TODO: Implement actual distance calculation
          // For now, use mock distance based on region
          distance_miles = farm.region === 'Pacific Northwest' ? 50 : 200;
        }

        // Add farm availability
        catalogEntry.farms.push({
          farm_id: farm.farmId,
          farm_name: farm.name,
          region: farm.region,
          lot_id: lot.lot_id,
          qty_available: lot.qty_available,
          price_per_unit: lot.price_per_unit,
          harvest_date_start: lot.harvest_date_start,
          harvest_date_end: lot.harvest_date_end,
          quality_flags: lot.quality_flags || [],
          distance_miles
        });

        // Update aggregates
        catalogEntry.total_available += lot.qty_available;
        catalogEntry.min_price = Math.min(catalogEntry.min_price, lot.price_per_unit);
        catalogEntry.max_price = Math.max(catalogEntry.max_price, lot.price_per_unit);
      }
    }

    // Convert map to array and sort farms by distance (if zip provided) or price
    const catalogItems = Array.from(catalogMap.values()).map(item => {
      // Sort farms by distance (closest first) or price (lowest first)
      item.farms.sort((a, b) => {
        if (zip && a.distance_miles !== null && b.distance_miles !== null) {
          return a.distance_miles - b.distance_miles;
        }
        return a.price_per_unit - b.price_per_unit;
      });
      return item;
    });

    // Sort catalog by SKU name
    catalogItems.sort((a, b) => a.sku_name.localeCompare(b.sku_name));

    console.log(`[Wholesale Catalog] Aggregated ${catalogItems.length} SKUs from ${REGISTERED_FARMS.length} farms`);

    res.json({
      ok: true,
      catalog_timestamp: new Date().toISOString(),
      total_skus: catalogItems.length,
      total_farms: REGISTERED_FARMS.length,
      online_farms: farmInventories.filter(f => f.inventory !== null).length,
      items: catalogItems
    });

  } catch (error) {
    console.error('[Wholesale Catalog] Failed to aggregate catalog:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to aggregate catalog',
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

    // Fetch inventory from all farms
    const farmInventoryPromises = REGISTERED_FARMS.map(async (farm) => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        const response = await fetch(`${farm.url}/api/wholesale/inventory`, {
          signal: controller.signal
        });
        clearTimeout(timeout);

        if (!response.ok) {
          return { farm, lots: [], error: `HTTP ${response.status}` };
        }

        const data = await response.json();
        
        // Filter to just this SKU
        const skuLots = (data.lots || []).filter(lot => lot.sku_id === skuId);
        
        return { farm, lots: skuLots, error: null };

      } catch (error) {
        return { farm, lots: [], error: error.message };
      }
    });

    const farmAvailability = await Promise.all(farmInventoryPromises);

    // Build response
    const availability = {
      sku_id: skuId,
      total_available: 0,
      farms: []
    };

    for (const { farm, lots, error } of farmAvailability) {
      if (lots.length === 0) continue;

      for (const lot of lots) {
        availability.total_available += lot.qty_available;
        
        availability.farms.push({
          farm_id: farm.farmId,
          farm_name: farm.name,
          region: farm.region,
          lot_id: lot.lot_id,
          qty_available: lot.qty_available,
          price_per_unit: lot.price_per_unit,
          harvest_date_start: lot.harvest_date_start,
          harvest_date_end: lot.harvest_date_end,
          quality_flags: lot.quality_flags || []
        });
      }
    }

    if (availability.farms.length === 0) {
      return res.status(404).json({
        ok: false,
        error: 'SKU not found or not available',
        sku_id: skuId
      });
    }

    // Sort by price
    availability.farms.sort((a, b) => a.price_per_unit - b.price_per_unit);

    res.json({
      ok: true,
      ...availability
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
