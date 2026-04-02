/**
 * Wholesale Network Aggregator Service
 * Aggregates real inventory data across registered network farms
 */
import { listNetworkFarms } from './networkFarmsStore.js';
import { generatePredictedInventoryEnhanced } from './harvest-prediction-engine.js';
import logger from '../utils/logger.js';
import { listAllOrders } from './wholesaleMemoryStore.js';

// In-memory cache for aggregated inventory (refreshed by wholesaleNetworkSync)
let inventoryCache = {
  farms: [],       // [{farm_id, farm_name, lots: [...]}]
  skus: [],        // aggregated SKU view
  lastRefresh: null,
  errors: []
};

function toFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function extractCoordinates(rawLocation) {
  if (!rawLocation || typeof rawLocation !== 'object') return null;

  const latitude = toFiniteNumber(
    rawLocation.latitude
      ?? rawLocation.lat
      ?? rawLocation.location?.latitude
      ?? rawLocation.location?.lat
  );
  const longitude = toFiniteNumber(
    rawLocation.longitude
      ?? rawLocation.lng
      ?? rawLocation.lon
      ?? rawLocation.location?.longitude
      ?? rawLocation.location?.lng
      ?? rawLocation.location?.lon
  );

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude };
}

function haversineDistanceKm(aLat, aLng, bLat, bLng) {
  const toRad = (deg) => (Number(deg) * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = (sinLat * sinLat) + (Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng);
  return 6371 * (2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)));
}

function resolveCustomSearchRadiusKm(value) {
  const direct = Number(value);
  if (Number.isFinite(direct) && direct > 0) return direct;

  const envCustom = Number(process.env.WHOLESALE_CUSTOM_PRODUCT_RADIUS_KM);
  if (Number.isFinite(envCustom) && envCustom > 0) return envCustom;

  const envDefault = Number(process.env.WHOLESALE_SEARCH_RADIUS_KM);
  if (Number.isFinite(envDefault) && envDefault > 0) return envDefault;

  return 120;
}

function isCustomCatalogSku(sku) {
  if (!sku || typeof sku !== 'object') return false;

  if (sku.is_custom === true) return true;
  if (String(sku.inventory_source || '').toLowerCase() === 'custom') return true;
  if (Array.isArray(sku.quality_flags) && sku.quality_flags.includes('custom_product')) return true;

  return Array.isArray(sku.farms) && sku.farms.some((farm) => {
    if (!farm || typeof farm !== 'object') return false;
    if (farm.is_custom === true) return true;
    if (String(farm.inventory_source || '').toLowerCase() === 'custom') return true;
    return Array.isArray(farm.quality_flags) && farm.quality_flags.includes('custom_product');
  });
}

/**
 * Fetch inventory from a single farm
 */
async function fetchFarmInventory(farm) {
  const baseUrl = farm.api_url || farm.url;
  if (!baseUrl) {
    return {
      farm_id: farm.farm_id,
      farm_name: farm.farm_name || farm.name || farm.farm_id,
      error: 'missing api_url/url'
    };
  }

  try {
    const headers = { 'Accept': 'application/json' };
    if (farm.auth_farm_id && farm.api_key) {
      headers['X-Farm-ID'] = farm.auth_farm_id;
      headers['X-API-Key'] = farm.api_key;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const response = await fetch(`${baseUrl}/api/wholesale/inventory`, {
      signal: controller.signal,
      headers
    });
    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid JSON payload');
    }

    return {
      farm_id: farm.farm_id,
      inventory_farm_id: data.farm_id || farm.farm_id,
      farm_name: data.farm_name || farm.name || farm.farm_id,
      lots: Array.isArray(data.lots) ? data.lots : [],
      timestamp: data.inventory_timestamp || new Date().toISOString()
    };
  } catch (err) {
    const diagnostic = `${err?.name === 'AbortError' ? 'timeout' : (err.message || 'request failed')} | url=${baseUrl} | auth_headers=${farm.auth_farm_id && farm.api_key ? 'present' : 'missing'}`;
    logger.warn(`[NetworkAgg] Failed to fetch from farm ${farm.farm_id}: ${diagnostic}`);
    return {
      farm_id: farm.farm_id,
      farm_name: farm.farm_name || farm.name || farm.farm_id,
      error: diagnostic
    };
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

  const farmsWithUrl = farms.filter((farm) => Boolean(farm?.api_url || farm?.url));
  const farmsMissingUrl = farms.filter((farm) => !(farm?.api_url || farm?.url));

  if (farmsMissingUrl.length > 0) {
    logger.warn(`[NetworkAgg] ${farmsMissingUrl.length} farms skipped: missing api_url/url`);
  }

  const results = await Promise.allSettled(farmsWithUrl.map(f => fetchFarmInventory(f)));
  const farmInventories = [];
  const errors = farmsMissingUrl.map((farm) => ({
    farm_id: farm.farm_id,
    farm_name: farm.farm_name || farm.name || farm.farm_id,
    type: 'missing_api_url',
    error: 'Farm missing api_url/url'
  }));

  results.forEach((result, idx) => {
    if (result.status === 'fulfilled' && result.value && !result.value.error) {
      const farmMeta = farmsWithUrl[idx] || {};
      farmInventories.push({
        ...result.value,
        certifications: Array.isArray(farmMeta.certifications) ? farmMeta.certifications : [],
        practices: Array.isArray(farmMeta.practices) ? farmMeta.practices : [],
        fulfillment_standards: farmMeta.fulfillment_standards || {},
        contact: farmMeta.contact || {},
        location: farmMeta.location || {}
      });
    } else {
      const farm = farmsWithUrl[idx];
      const farmId = farm?.farm_id || `farm-${idx}`;
      const errorMessage = result.status === 'rejected'
        ? (result.reason?.message || 'request rejected')
        : (result.value?.error || 'request failed');
      errors.push({
        farm_id: farmId,
        farm_name: farm?.farm_name || farm?.name || farmId,
        type: 'fetch_failed',
        error: errorMessage
      });
    }
  });

  // Aggregate by SKU across all farms
  const skuMap = new Map();
  for (const farmInv of farmInventories) {
    for (const lot of farmInv.lots) {
      const sku = lot.sku_id || lot.product_id || lot.crop_type;
      if (!sku) continue;

      const rawQualityFlags = Array.isArray(lot.quality_flags) ? lot.quality_flags : [];
      const inventorySource = String(lot.inventory_source || '').toLowerCase();
      const isCustomLot = Boolean(lot.is_custom)
        || inventorySource === 'custom'
        || rawQualityFlags.includes('custom_product');
      const qualityFlags = isCustomLot
        ? Array.from(new Set([...rawQualityFlags, 'custom_product']))
        : rawQualityFlags;

      if (!skuMap.has(sku)) {
        skuMap.set(sku, {
          sku_id: sku,
          product_name: lot.sku_name || lot.crop_type || sku,
          size: lot.pack_size || 5,
          unit: lot.unit || 'case',
          price_per_unit: lot.price_per_unit || 12.50,
          total_qty_available: 0,
          organic: lot.quality_flags?.includes('organic') || false,
          description: lot.description || null,
          thumbnail_url: lot.thumbnail_url || null,
          inventory_source: lot.inventory_source || null,
          is_custom: isCustomLot,
          farms: []
        });
      }
      const entry = skuMap.get(sku);
      const qtyAvailable = Number(lot.qty_available || 0);
      entry.total_qty_available += qtyAvailable;
      entry.is_custom = entry.is_custom || isCustomLot;
      if (!entry.description && lot.description) entry.description = lot.description;
      if (!entry.thumbnail_url && lot.thumbnail_url) entry.thumbnail_url = lot.thumbnail_url;
      if (!entry.inventory_source && lot.inventory_source) entry.inventory_source = lot.inventory_source;
      entry.farms.push({
        farm_id: farmInv.farm_id,
        farm_name: farmInv.farm_name,
        lot_id: lot.lot_id,
        qty_available: qtyAvailable,
        harvest_date_start: lot.harvest_date_start,
        harvest_date_end: lot.harvest_date_end,
        price_per_unit: lot.price_per_unit || 12.50,
        quality_flags: qualityFlags,
        location: lot.location,
        farm_location: farmInv.location || {},
        is_custom: isCustomLot,
        inventory_source: lot.inventory_source || null,
        description: lot.description || null,
        thumbnail_url: lot.thumbnail_url || null
      });
    }
  }

  inventoryCache = {
    farms: farmInventories,
    skus: Array.from(skuMap.values()),
    lastRefresh: new Date().toISOString(),
    errors
  };

  if (errors.length > 0) {
    logger.warn(`[NetworkAgg] Refresh completed with ${errors.length} farm diagnostics`);
  }
  logger.info(`[NetworkAgg] Aggregated ${inventoryCache.skus.length} SKUs from ${farmInventories.length} farms`);
  return inventoryCache;
}

export async function addMarketEvent(event) {
  return { success: true };
}

function normalizeAllocationResult({ allocations, unavailable, commissionRate = 0.12 }) {
  const farmMap = new Map();

  for (const alloc of allocations || []) {
    const farmId = String(alloc.farm_id || 'unknown-farm');
    if (!farmMap.has(farmId)) {
      farmMap.set(farmId, {
        farm_id: farmId,
        farm_name: alloc.farm_name || farmId,
        subtotal: 0,
        status: 'pending',
        items: []
      });
    }

    const quantity = Number(alloc.quantity || 0);
    const pricePerUnit = Number(alloc.price_per_unit || 0);
    const lineTotal = quantity * pricePerUnit;
    const farmSubOrder = farmMap.get(farmId);

    farmSubOrder.items.push({
      sku_id: alloc.sku_id,
      product_name: alloc.product_name || alloc.sku_id,
      quantity,
      unit: alloc.unit || 'case',
      size: alloc.size || 5,
      price_per_unit: pricePerUnit,
      line_total: lineTotal,
      lot_id: alloc.lot_id || null,
      harvest_date_start: alloc.harvest_date_start || null,
      harvest_date_end: alloc.harvest_date_end || null,
      quality_flags: alloc.quality_flags || []
    });
    farmSubOrder.subtotal += lineTotal;
  }

  const farmSubOrders = Array.from(farmMap.values());
  const subtotal = farmSubOrders.reduce((sum, sub) => sum + Number(sub.subtotal || 0), 0);
  const brokerFeeTotal = Math.round(subtotal * Number(commissionRate || 0) * 100) / 100;
  const netToFarmsTotal = Math.round((subtotal - brokerFeeTotal) * 100) / 100;
  const grandTotal = Math.round(subtotal * 100) / 100;

  const paymentSplit = farmSubOrders.map((sub) => {
    const gross = Number(sub.subtotal || 0);
    const brokerFee = Math.round(gross * Number(commissionRate || 0) * 100) / 100;
    const net = Math.round((gross - brokerFee) * 100) / 100;
    return {
      farm_id: sub.farm_id,
      farm_name: sub.farm_name,
      gross_amount: gross,
      broker_fee: brokerFee,
      net_amount: net
    };
  });

  return {
    allocation: {
      subtotal,
      broker_fee_total: brokerFeeTotal,
      net_to_farms_total: netToFarmsTotal,
      grand_total: grandTotal,
      farm_sub_orders: farmSubOrders,
      unavailable_items: unavailable || []
    },
    payment_split: paymentSplit,
    allocations: allocations || [],
    unavailable: unavailable || []
  };
}

export async function allocateCartFromNetwork(cartOrInput, sourcing, buyerLocation) {
  const input = Array.isArray(cartOrInput)
    ? { cart: cartOrInput, sourcing, buyerLocation }
    : (cartOrInput || {});
  const cart = Array.isArray(input.cart) ? input.cart : [];
  const commissionRate = Number(input.commissionRate ?? 0.12);

  // Use cached inventory to allocate cart items across farms
  if (!inventoryCache.skus.length) {
    await refreshNetworkInventory();
  }

  // ── Phase 5 Ticket 5.5: Quality-based autonomous routing ──
  // Load quality scores from crop benchmarks (Central DB) for each farm×crop
  let qualityScores = {};
  try {
    const { getDatabase: getDB } = await import('../config/database.js');
    const pool = getDB();
    const { rows } = await pool.query(`
      SELECT farm_id, crop,
             AVG(quality_score) AS avg_quality,
             AVG(weight_per_plant_oz) AS avg_weight,
             AVG(loss_rate) AS avg_loss,
             COUNT(*) AS record_count
      FROM experiment_records
      WHERE quality_score IS NOT NULL
        AND recorded_at > NOW() - INTERVAL '90 days'
      GROUP BY farm_id, crop
    `);
    for (const row of rows) {
      const key = `${row.farm_id}::${(row.crop || '').toLowerCase()}`;
      qualityScores[key] = {
        avg_quality: parseFloat(row.avg_quality) || 0,
        avg_weight: parseFloat(row.avg_weight) || 0,
        avg_loss: parseFloat(row.avg_loss) || 0,
        record_count: parseInt(row.record_count)
      };
    }
  } catch {
    // Quality scoring unavailable — fall back to first-available
  }

  const allocations = [];
  const unavailable = [];

  for (const item of cart) {
    const skuData = inventoryCache.skus.find(s => s.sku_id === item.sku_id);
    if (!skuData || skuData.total_qty_available < (item.quantity || 1)) {
      unavailable.push(item);
      continue;
    }

    // Sort farms by quality score (highest first) for quality-based routing
    const cropName = (skuData.product_name || '').toLowerCase();
    const rankedFarms = [...skuData.farms].sort((a, b) => {
      const keyA = `${a.farm_id}::${cropName}`;
      const keyB = `${b.farm_id}::${cropName}`;
      const scoreA = qualityScores[keyA]?.avg_quality || 0;
      const scoreB = qualityScores[keyB]?.avg_quality || 0;
      // Primary: quality score (desc), Secondary: lower loss rate (asc)
      if (scoreB !== scoreA) return scoreB - scoreA;
      const lossA = qualityScores[keyA]?.avg_loss || 1;
      const lossB = qualityScores[keyB]?.avg_loss || 1;
      return lossA - lossB;
    });

    let remaining = item.quantity || 1;
    const itemAllocations = [];

    for (const farm of rankedFarms) {
      if (remaining <= 0) break;
      const alloc = Math.min(remaining, farm.qty_available);
      if (alloc > 0) {
        const qualityKey = `${farm.farm_id}::${cropName}`;
        itemAllocations.push({
          sku_id: item.sku_id,
          farm_id: farm.farm_id,
          farm_name: farm.farm_name,
          quantity: alloc,
          price_per_unit: farm.price_per_unit,
          product_name: skuData.product_name || item.sku_id,
          unit: skuData.unit || 'case',
          size: skuData.size || 5,
          quality_score: qualityScores[qualityKey]?.avg_quality || null,
          routing_reason: qualityScores[qualityKey] ? 'quality_ranked' : 'first_available',
          lot_id: farm.lot_id || null,
          harvest_date_start: farm.harvest_date_start || null,
          harvest_date_end: farm.harvest_date_end || null,
          quality_flags: farm.quality_flags || []
        });
        remaining -= alloc;
      }
    }

    if (remaining > 0) {
      unavailable.push({ ...item, quantity: remaining });
    }
    allocations.push(...itemAllocations);
  }

  return normalizeAllocationResult({ allocations, unavailable, commissionRate });
}

export async function buildAggregateCatalog(options = {}) {
  // Refresh if stale (> 5 min old) or empty
  const fiveMinAgo = Date.now() - 5 * 60 * 1000;
  if (!inventoryCache.lastRefresh || new Date(inventoryCache.lastRefresh).getTime() < fiveMinAgo) {
    await refreshNetworkInventory();
  }

  // ── Phase 5 Ticket 5.6: Include predicted inventory (enhanced with statistical engine) ──
  let predictedInventory = [];
  try {
    const { getDatabase: getDB } = await import('../config/database.js');
    const dbPool = getDB();
    predictedInventory = await generatePredictedInventoryEnhanced(dbPool);
  } catch {
    // Fallback to legacy prediction if enhanced engine fails
    try {
      predictedInventory = await generatePredictedInventory();
    } catch {
      // Non-fatal — predicted inventory is best-effort
    }
  }

  // Apply pending-payment reservation holds so catalog availability reflects standing orders.
  const skusWithPendingHolds = await (async () => {
    try {
      const orders = await listAllOrders({ page: 1, limit: 50000 });
      const holdByFarmSku = new Map();

      for (const order of (orders || [])) {
        if (String(order?.status || '') !== 'pending_payment') continue;
        for (const sub of (order?.farm_sub_orders || [])) {
          const farmId = String(sub?.farm_id || '').trim();
          if (!farmId) continue;
          for (const item of (sub?.items || [])) {
            const skuId = String(item?.sku_id || '').trim();
            const qty = Number(item?.quantity || 0);
            if (!skuId || qty <= 0) continue;
            const key = `${farmId}::${skuId}`;
            holdByFarmSku.set(key, (holdByFarmSku.get(key) || 0) + qty);
          }
        }
      }

      return (inventoryCache.skus || []).map((sku) => {
        const farms = (sku.farms || []).map((farm) => {
          const key = `${String(farm.farm_id || '').trim()}::${String(sku.sku_id || '').trim()}`;
          const holdQty = Number(holdByFarmSku.get(key) || 0);
          const baseQty = Number(farm.qty_available ?? farm.quantity_available ?? 0);
          const adjustedQty = Math.max(0, baseQty - holdQty);
          return {
            ...farm,
            qty_available: adjustedQty,
            quantity_available: adjustedQty,
            qty_reserved: Number(farm.qty_reserved || 0) + holdQty
          };
        });

        const totalQty = farms.reduce((sum, f) => sum + Number(f.qty_available || 0), 0);
        return {
          ...sku,
          farms,
          total_qty_available: totalQty,
          qty_available: totalQty
        };
      });
    } catch (err) {
      logger.warn(`[NetworkAgg] Pending-hold adjustment skipped: ${err.message}`);
      return inventoryCache.skus || [];
    }
  })();

  const buyerCoords = extractCoordinates(options?.buyerLocation || null);
  const customSearchRadiusKm = resolveCustomSearchRadiusKm(options?.customProductRadiusKm ?? options?.searchRadiusKm);
  const enforceCustomSearchArea = options?.enforceCustomSearchArea === true;
  const farmLocationById = new Map((inventoryCache.farms || []).map((farm) => [String(farm.farm_id || ''), farm.location || {}]));

  const skus = (skusWithPendingHolds || [])
    .map((sku) => {
      const farms = Array.isArray(sku?.farms) ? sku.farms : [];
      const skuIsCustom = isCustomCatalogSku(sku);

      const scopedFarms = farms
        .map((farm) => {
          const fallbackFarmLocation = farmLocationById.get(String(farm?.farm_id || '')) || {};
          const farmLocation = farm?.farm_location || farm?.location || fallbackFarmLocation;
          const farmCoords = extractCoordinates(farmLocation);

          if (skuIsCustom && enforceCustomSearchArea) {
            if (!buyerCoords || !farmCoords) return null;
            const distanceKm = haversineDistanceKm(
              buyerCoords.latitude,
              buyerCoords.longitude,
              farmCoords.latitude,
              farmCoords.longitude
            );
            if (!(distanceKm <= customSearchRadiusKm)) return null;

            return {
              ...farm,
              distance_km: Number(distanceKm.toFixed(2))
            };
          }

          if (!farmCoords) return farm;
          return {
            ...farm,
            distance_km: buyerCoords
              ? Number(haversineDistanceKm(
                buyerCoords.latitude,
                buyerCoords.longitude,
                farmCoords.latitude,
                farmCoords.longitude
              ).toFixed(2))
              : farm.distance_km
          };
        })
        .filter(Boolean);

      if (scopedFarms.length === 0) return null;

      const totalQty = scopedFarms.reduce((sum, farm) => {
        const qty = Number(farm.qty_available ?? farm.quantity_available ?? 0);
        return sum + (Number.isFinite(qty) ? qty : 0);
      }, 0);

      if (!(totalQty > 0)) return null;

      return {
        ...sku,
        farms: scopedFarms,
        total_qty_available: totalQty,
        qty_available: totalQty,
        is_custom: skuIsCustom
      };
    })
    .filter(Boolean);

  return {
    skus,
    predicted: predictedInventory,
    farms: inventoryCache.farms.map(f => ({
      farm_id: f.farm_id,
      farm_name: f.farm_name,
      lot_count: f.lots.length,
      timestamp: f.timestamp,
      certifications: Array.isArray(f.certifications) ? f.certifications : [],
      practices: Array.isArray(f.practices) ? f.practices : [],
      fulfillment_standards: f.fulfillment_standards || {},
      location: f.location || {},
      contact: f.contact || {}
    })),
    lastRefresh: inventoryCache.lastRefresh,
    diagnostics: {
      error_count: inventoryCache.errors.length,
      missing_api_url_farms: inventoryCache.errors
        .filter((entry) => entry.type === 'missing_api_url')
        .map((entry) => ({ farm_id: entry.farm_id, farm_name: entry.farm_name })),
      fetch_failures: inventoryCache.errors
        .filter((entry) => entry.type === 'fetch_failed')
        .map((entry) => ({ farm_id: entry.farm_id, farm_name: entry.farm_name, error: entry.error })),
      inventory_errors: inventoryCache.errors
    }
  };
}

/**
 * Phase 5 Ticket 5.6: Predictive Inventory Listing
 *
 * Based on Central's harvest predictions and experiment records,
 * auto-list products on wholesale marketplace before harvest.
 * Buyers see "Available Feb 28" with confidence level.
 */
export async function generatePredictedInventory() {
  try {
    const { getDatabase: getDB } = await import('../config/database.js');
    const pool = getDB();

    // Get active crops across network with estimated harvest dates
    const { rows } = await pool.query(`
      SELECT er.farm_id, er.crop,
             f.farm_name,
             AVG(er.grow_days) AS avg_grow_days,
             AVG(er.outcomes->>'weight_per_plant_oz')::numeric AS avg_weight,
             AVG(er.outcomes->>'quality_score')::numeric AS avg_quality,
             MAX(er.recorded_at) AS last_harvest,
             COUNT(*) AS harvest_count
      FROM experiment_records er
      JOIN farms f ON f.farm_id = er.farm_id
      WHERE er.recorded_at > NOW() - INTERVAL '90 days'
        AND er.outcomes->>'weight_per_plant_oz' IS NOT NULL
      GROUP BY er.farm_id, er.crop, f.farm_name
      HAVING COUNT(*) >= 3
      ORDER BY er.crop, avg_quality DESC
    `);

    const predictions = [];
    const now = new Date();

    for (const row of rows) {
      const lastHarvest = new Date(row.last_harvest);
      const avgGrowDays = Math.round(parseFloat(row.avg_grow_days) || 30);

      // Estimate next harvest: last harvest + avg grow cycle
      // Assume farm re-seeds shortly after harvest
      const daysSinceLastHarvest = (now - lastHarvest) / 86400000;
      const daysToNextHarvest = Math.max(0, avgGrowDays - daysSinceLastHarvest);
      const estimatedAvailableDate = new Date(now.getTime() + daysToNextHarvest * 86400000);

      // Confidence based on data volume and recency
      let confidence = 0.5;
      const harvestCount = parseInt(row.harvest_count);
      if (harvestCount >= 10) confidence += 0.2;
      else if (harvestCount >= 5) confidence += 0.1;
      if (daysSinceLastHarvest < avgGrowDays * 2) confidence += 0.15; // Recent activity
      if (parseFloat(row.avg_quality) >= 8) confidence += 0.1; // Consistent quality
      confidence = Math.min(0.95, confidence);

      // Skip if availability is too far out (> 45 days)
      if (daysToNextHarvest > 45) continue;

      // Estimate quantity based on historical yields
      const avgWeightOz = parseFloat(row.avg_weight) || 2;
      const estimatedPlants = 50; // Default estimate per batch
      const estimatedCases = Math.max(1, Math.round((avgWeightOz * estimatedPlants) / (5 * 16))); // 5lb cases

      const cropName = row.crop || 'Unknown';
      predictions.push({
        type: 'predicted',
        farm_id: row.farm_id,
        farm_name: row.farm_name,
        crop: cropName,
        product_name: cropName,
        estimated_available_date: estimatedAvailableDate.toISOString().split('T')[0],
        days_until_available: Math.round(daysToNextHarvest),
        available_now: daysToNextHarvest <= 0,
        confidence: +confidence.toFixed(2),
        confidence_label: confidence >= 0.8 ? 'high' : confidence >= 0.6 ? 'medium' : 'low',
        estimated_quantity: estimatedCases,
        unit: 'case',
        avg_quality_score: parseFloat(row.avg_quality)?.toFixed(1) || null,
        avg_weight_oz: avgWeightOz.toFixed(2),
        harvest_history_count: harvestCount,
        display_text: daysToNextHarvest <= 0
          ? `Available now from ${row.farm_name}`
          : `Available ${estimatedAvailableDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} (${Math.round(confidence * 100)}% confidence)`
      });
    }

    // Sort by availability date (soonest first)
    predictions.sort((a, b) => a.days_until_available - b.days_until_available);

    logger.info(`[NetworkAgg] Generated ${predictions.length} predicted inventory listings`);
    return predictions;
  } catch (err) {
    logger.warn(`[NetworkAgg] Predicted inventory generation failed: ${err.message}`);
    return [];
  }
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
  const snapshots = [];

  for (const farm of inventoryCache.farms) {
    const totalAvailable = (farm.lots || []).reduce((sum, lot) => sum + (lot.qty_available || 0), 0);
    snapshots.push({
      ok: true,
      status: 200,
      total_available: totalAvailable,
      fetched_at: farm.timestamp || inventoryCache.lastRefresh,
      farm: { farm_name: farm.farm_name, farm_id: farm.farm_id }
    });
  }

  for (const err of inventoryCache.errors) {
    snapshots.push({
      ok: false,
      status: err.error || err.type || 'error',
      total_available: 0,
      fetched_at: inventoryCache.lastRefresh,
      farm: { farm_name: err.farm_name, farm_id: err.farm_id }
    });
  }

  return snapshots;
}
