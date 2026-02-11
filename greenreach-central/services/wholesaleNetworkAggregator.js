/**
 * Wholesale Network Aggregator Service
 * Aggregates real inventory data across registered network farms
 */
import { listNetworkFarms } from './networkFarmsStore.js';
import logger from '../utils/logger.js';

// In-memory cache for aggregated inventory (refreshed by wholesaleNetworkSync)
let inventoryCache = {
  farms: [],       // [{farm_id, farm_name, lots: [...]}]
  skus: [],        // aggregated SKU view
  lastRefresh: null,
  errors: []
};

/**
 * Fetch inventory from a single farm
 */
async function fetchFarmInventory(farm) {
  const baseUrl = farm.api_url || farm.url;
  if (!baseUrl) return null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const response = await fetch(`${baseUrl}/api/wholesale/inventory`, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' }
    });
    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json();
    return {
      farm_id: data.farm_id || farm.farm_id,
      farm_name: data.farm_name || farm.name || farm.farm_id,
      lots: Array.isArray(data.lots) ? data.lots : [],
      timestamp: data.inventory_timestamp || new Date().toISOString()
    };
  } catch (err) {
    logger.warn(`[NetworkAgg] Failed to fetch from farm ${farm.farm_id}: ${err.message}`);
    return null;
  }
}

/**
 * Refresh inventory cache by polling all registered farms
 */
export async function refreshNetworkInventory() {
  const farms = await listNetworkFarms();
  if (!farms || farms.length === 0) {
    logger.info('[NetworkAgg] No farms registered in network — nothing to aggregate');
    return inventoryCache;
  }

  logger.info(`[NetworkAgg] Refreshing inventory from ${farms.length} farms...`);

  const results = await Promise.allSettled(farms.map(f => fetchFarmInventory(f)));
  const farmInventories = [];
  const errors = [];

  results.forEach((result, idx) => {
    if (result.status === 'fulfilled' && result.value) {
      farmInventories.push(result.value);
    } else {
      const farmId = farms[idx]?.farm_id || `farm-${idx}`;
      errors.push({ farm_id: farmId, error: result.reason?.message || 'null response' });
    }
  });

  // Aggregate by SKU across all farms
  const skuMap = new Map();
  for (const farmInv of farmInventories) {
    for (const lot of farmInv.lots) {
      const sku = lot.sku_id;
      if (!skuMap.has(sku)) {
        skuMap.set(sku, {
          sku_id: sku,
          product_name: lot.sku_name || lot.crop_type || sku,
          size: lot.pack_size || 5,
          unit: lot.unit || 'case',
          price_per_unit: lot.price_per_unit || 12.50,
          total_qty_available: 0,
          organic: lot.quality_flags?.includes('organic') || false,
          farms: []
        });
      }
      const entry = skuMap.get(sku);
      entry.total_qty_available += lot.qty_available || 0;
      entry.farms.push({
        farm_id: farmInv.farm_id,
        farm_name: farmInv.farm_name,
        lot_id: lot.lot_id,
        qty_available: lot.qty_available || 0,
        harvest_date_start: lot.harvest_date_start,
        harvest_date_end: lot.harvest_date_end,
        price_per_unit: lot.price_per_unit || 12.50,
        quality_flags: lot.quality_flags || [],
        location: lot.location
      });
    }
  }

  inventoryCache = {
    farms: farmInventories,
    skus: Array.from(skuMap.values()),
    lastRefresh: new Date().toISOString(),
    errors
  };

  logger.info(`[NetworkAgg] Aggregated ${inventoryCache.skus.length} SKUs from ${farmInventories.length} farms`);
  return inventoryCache;
}

export async function addMarketEvent(event) {
  return { success: true };
}

export async function allocateCartFromNetwork(cart, sourcing, buyerLocation) {
  // Use cached inventory to allocate cart items across farms
  if (!inventoryCache.skus.length) {
    await refreshNetworkInventory();
  }

  const allocations = [];
  const unavailable = [];

  for (const item of cart) {
    const skuData = inventoryCache.skus.find(s => s.sku_id === item.sku_id);
    if (!skuData || skuData.total_qty_available < (item.quantity || 1)) {
      unavailable.push(item);
      continue;
    }

    // Allocate from first farm with sufficient stock
    let remaining = item.quantity || 1;
    const itemAllocations = [];

    for (const farm of skuData.farms) {
      if (remaining <= 0) break;
      const alloc = Math.min(remaining, farm.qty_available);
      if (alloc > 0) {
        itemAllocations.push({
          sku_id: item.sku_id,
          farm_id: farm.farm_id,
          farm_name: farm.farm_name,
          quantity: alloc,
          price_per_unit: farm.price_per_unit
        });
        remaining -= alloc;
      }
    }

    if (remaining > 0) {
      unavailable.push({ ...item, quantity: remaining });
    }
    allocations.push(...itemAllocations);
  }

  return { allocations, unavailable };
}

export async function buildAggregateCatalog() {
  // Refresh if stale (> 5 min old) or empty
  const fiveMinAgo = Date.now() - 5 * 60 * 1000;
  if (!inventoryCache.lastRefresh || new Date(inventoryCache.lastRefresh).getTime() < fiveMinAgo) {
    await refreshNetworkInventory();
  }

  return {
    skus: inventoryCache.skus,
    farms: inventoryCache.farms.map(f => ({
      farm_id: f.farm_id,
      farm_name: f.farm_name,
      lot_count: f.lots.length,
      timestamp: f.timestamp
    })),
    lastRefresh: inventoryCache.lastRefresh
  };
}

export async function generateNetworkRecommendations(buyerId) {
  return [];
}

export function getBuyerLocationFromBuyer(buyer) {
  return buyer.location || { zip: '00000', state: 'XX', lat: 0, lng: 0 };
}

export async function getNetworkTrends(options) {
  return {
    trends: [],
    summary: {}
  };
}

export async function listMarketEvents(filters) {
  return [];
}

export async function listNetworkSnapshots(filters) {
  return [];
}
