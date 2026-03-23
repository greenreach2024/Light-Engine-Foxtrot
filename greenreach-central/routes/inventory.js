/**
 * Inventory Routes
 * Receive and store inventory data from edge devices
 */
import express from 'express';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { randomBytes } from 'crypto';
import { query, isDatabaseAvailable } from '../config/database.js';
import { farmStore } from '../lib/farm-data-store.js';

// Load crop registry for weight estimation
let cropRegistryCache = null;
function getCropRegistry() {
  if (cropRegistryCache) return cropRegistryCache;
  try {
    const crPath = path.join(process.cwd(), 'public', 'data', 'crop-registry.json');
    if (fs.existsSync(crPath)) {
      cropRegistryCache = JSON.parse(fs.readFileSync(crPath, 'utf8')).crops || {};
    }
  } catch (_) { /* optional */ }
  return cropRegistryCache || {};
}

/**
 * Calculate auto_quantity_lbs from groups/trays for a farm.
 * Aggregates: total_plants * yieldFactor * avg_weight_per_plant (from benchmarks or crop defaults).
 * Only updates products that have inventory_source='auto' (does not overwrite manual entries).
 */
export async function recalculateAutoInventoryFromGroups(farmId) {
  if (!isDatabaseAvailable()) return { updated: 0 };

  // Get groups for this farm
  let groups = [];
  const gResult = await query(
    'SELECT data FROM farm_data WHERE farm_id = $1 AND data_type = $2',
    [farmId, 'groups']
  );
  if (gResult.rows.length > 0) {
    const raw = gResult.rows[0].data;
    groups = Array.isArray(raw) ? raw : (raw?.groups || []);
  }
  if (groups.length === 0) return { updated: 0 };

  const cropRegistry = getCropRegistry();

  // Try to load benchmark data for more accurate weights
  let benchmarks = {};
  try {
    const bResult = await query('SELECT crop, avg_weight_per_plant_oz FROM crop_benchmarks');
    for (const row of bResult.rows) {
      benchmarks[row.crop] = Number(row.avg_weight_per_plant_oz) || 0;
    }
  } catch (_) { /* benchmarks optional */ }

  // Aggregate by crop: total plants, yield factor, weight per plant
  const cropTotals = {};
  for (const group of groups) {
    if (group?.active === false) continue;
    const cropName = group?.crop || group?.recipe || group?.plan;
    if (!cropName || cropName === 'Unknown') continue;

    const totalPlants = Number(group?.plants || 0) || (Number(group?.trays || 0) * 12);
    if (totalPlants <= 0) continue;

    const cropEntry = cropRegistry[cropName];
    const yieldFactor = cropEntry?.growth?.yieldFactor || 0.85;
    // Weight source priority: farm benchmarks > hardcoded estimate (2 oz per plant avg)
    const avgWeightOz = benchmarks[cropName] || 2.0;

    if (!cropTotals[cropName]) {
      cropTotals[cropName] = { totalPlants: 0, yieldFactor, avgWeightOz };
    }
    cropTotals[cropName].totalPlants += totalPlants;
  }

  // Upsert weight estimates into farm_inventory
  let updated = 0;
  for (const [cropName, data] of Object.entries(cropTotals)) {
    const estimatedOz = data.totalPlants * data.yieldFactor * data.avgWeightOz;
    const estimatedLbs = Math.round((estimatedOz / 16) * 100) / 100;

    const productId = cropName.toLowerCase().replace(/\s+/g, '-');
    await query(
      `INSERT INTO farm_inventory (
        farm_id, product_id, product_name, quantity, auto_quantity_lbs,
        quantity_available, unit, quantity_unit, inventory_source, last_updated
      ) VALUES ($1,$2,$3,$4,$5,$6,'lb','lb','auto',NOW())
      ON CONFLICT (farm_id, product_id) DO UPDATE SET
        auto_quantity_lbs = EXCLUDED.auto_quantity_lbs,
        quantity = EXCLUDED.quantity,
        quantity_available = EXCLUDED.auto_quantity_lbs + COALESCE(farm_inventory.manual_quantity_lbs, 0),
        last_updated = NOW()
      WHERE farm_inventory.inventory_source != 'manual'`,
      [farmId, productId, cropName, estimatedLbs, estimatedLbs, estimatedLbs]
    );
    updated++;
  }

  return { updated, crops: Object.keys(cropTotals) };
}

/**
 * Look up retail + wholesale price for a crop from the Crop Pricing page data.
 * Returns { retailPrice, wholesalePrice } or nulls if not found.
 */
async function resolveCropPricing(farmId, productName) {
  try {
    const pricingData = await farmStore.get(farmId, 'crop_pricing');
    if (!pricingData?.crops?.length) return { retailPrice: 0, wholesalePrice: 0 };
    const nameLC = (productName || '').toLowerCase();
    const match = pricingData.crops.find(c => (c.crop || '').toLowerCase() === nameLC);
    if (!match) return { retailPrice: 0, wholesalePrice: 0 };
    return {
      retailPrice: Number(match.retailPrice) || 0,
      wholesalePrice: Number(match.wholesalePrice) || 0
    };
  } catch {
    return { retailPrice: 0, wholesalePrice: 0 };
  }
}

// Load crop utilities (Phase 2b)
const require = createRequire(import.meta.url);
const cropUtils = require('../public/js/crop-utils.js');
try {
  const fs = await import('fs');
  const path = await import('path');
  const registryPath = path.default.join(path.default.dirname(new URL(import.meta.url).pathname), '..', 'public', 'data', 'crop-registry.json');
  const registryData = JSON.parse(fs.default.readFileSync(registryPath, 'utf8'));
  cropUtils.setRegistry(registryData);
} catch (e) { console.warn('[inventory] crop registry load failed:', e.message); }

const router = express.Router();

function getJwtSecret() {
  if (!process.env.JWT_SECRET && (process.env.NODE_ENV === 'production' || process.env.DEPLOYMENT_MODE === 'cloud')) {
    throw new Error('JWT_SECRET environment variable is required in production');
  }
  return process.env.JWT_SECRET || randomBytes(32).toString('hex');
}
const JWT_SECRET = getJwtSecret();

async function resolveFarmId(req) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    try {
      const payload = jwt.verify(token, JWT_SECRET, {
        issuer: 'greenreach-central',
        audience: 'greenreach-farms'
      });
      if (payload?.farm_id) return payload.farm_id;
    } catch (error) {
      // Ignore token errors and fallback to other sources
    }
  }

  const farmId = req.query.farmId || req.headers['x-farm-id'] || req.user?.farmId || null;

  // Admin JWT sets farmId to literal 'ADMIN' — resolve to the actual farm
  if (farmId === 'ADMIN' && await isDatabaseAvailable()) {
    try {
      const result = await query('SELECT farm_id FROM farms LIMIT 1');
      if (result.rows.length > 0) return result.rows[0].farm_id;
    } catch (_) { /* fall through */ }
  }

  // Canonicalize non-admin farm IDs so manual writes land on the real farm row
  // used by wholesale/catalog and other cross-page queries.
  if (farmId && farmId !== 'ADMIN' && await isDatabaseAvailable()) {
    try {
      const exact = await query('SELECT farm_id FROM farms WHERE farm_id = $1 LIMIT 1', [farmId]);
      if (exact.rows.length > 0) return exact.rows[0].farm_id;

      const userFarmId = req.user?.farmId;
      if (userFarmId && userFarmId !== 'ADMIN') {
        const fromUser = await query('SELECT farm_id FROM farms WHERE farm_id = $1 LIMIT 1', [userFarmId]);
        if (fromUser.rows.length > 0) return fromUser.rows[0].farm_id;
      }

      const fallback = await query(`
        SELECT farm_id
        FROM farms
        WHERE status = 'active'
        ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
        LIMIT 1
      `);
      if (fallback.rows.length > 0) return fallback.rows[0].farm_id;
    } catch (_) {
      // Preserve previous behavior if farms table lookup fails.
    }
  }

  return farmId;
}

function coerceNumber(value) {
  return Number.isFinite(value) ? value : 0;
}

function pickFarmName(farmId) {
  return farmId || 'Unknown Farm';
}

async function loadFarmGroups(farmId) {
  if (!farmId) return [];

  if (await isDatabaseAvailable()) {
    try {
      const result = await query(
        `SELECT groups FROM farm_backups WHERE farm_id = $1`,
        [farmId]
      );

      if (result.rows.length > 0 && Array.isArray(result.rows[0].groups)) {
        return result.rows[0].groups;
      }
    } catch (error) {
      console.warn('[Inventory] farm_backups lookup failed:', error.message);
    }
  }

  return [];
}

async function loadManualInventoryItems(farmId) {
  if (!farmId || !(await isDatabaseAvailable())) return [];

  try {
    const result = await query(
      `SELECT
         product_id,
         sku,
         sku_name,
         product_name,
         quantity_available,
         manual_quantity_lbs,
         last_updated,
         updated_at,
         created_at
       FROM farm_inventory
       WHERE farm_id = $1
         AND COALESCE(quantity_available, manual_quantity_lbs, 0) > 0
       ORDER BY updated_at DESC NULLS LAST, last_updated DESC NULLS LAST, created_at DESC NULLS LAST`,
      [farmId]
    );

    return result.rows || [];
  } catch (error) {
    console.warn('[Inventory] farm_inventory lookup failed:', error.message);
    return [];
  }
}

/**
 * GET /api/inventory/current
 * Returns current inventory summary (cloud)
 */
router.get('/current', async (req, res) => {
  try {
    const farmId = await resolveFarmId(req);
    if (!farmId) {
      return res.status(400).json({
        status: 'error',
        message: 'Farm ID unavailable'
      });
    }

    const groups = await loadFarmGroups(farmId);
    const manualItems = await loadManualInventoryItems(farmId);

    const groupTrays = groups.map((group, index) => {
      const trayCount = coerceNumber(group.trays) || coerceNumber(group.trayCount) || 0;
      const plantCount = coerceNumber(group.plants) || coerceNumber(group.plantCount) || 0;
      const seedDateValue = group?.planConfig?.anchor?.seedDate || group?.seedDate || group?.createdAt || null;
      const seedDate = seedDateValue ? new Date(seedDateValue) : null;

      return {
        trayId: group.id || group.groupId || group.group_id || `group-${index + 1}`,
        crop: group.crop || group.recipe || group.name || 'Mixed crops',
        trayCount,
        plantCount,
        seedingDate: seedDate && !Number.isNaN(seedDate.getTime()) ? seedDate.toISOString() : null,
        source: 'backup-groups'
      };
    });

    const manualTrays = manualItems.map((item, index) => {
      const qty = coerceNumber(Number(item.quantity_available ?? item.manual_quantity_lbs ?? 0));
      const updated = item.last_updated || item.updated_at || item.created_at || null;
      const ts = updated ? new Date(updated) : null;

      return {
        trayId: item.product_id || item.sku || `manual-${index + 1}`,
        crop: item.product_name || item.sku_name || item.sku || 'Manual Inventory',
        trayCount: 1,
        plantCount: qty,
        seedingDate: ts && !Number.isNaN(ts.getTime()) ? ts.toISOString() : null,
        source: 'manual-inventory'
      };
    });

    const trays = [...groupTrays, ...manualTrays].filter((tray) => coerceNumber(tray.plantCount) > 0);
    const dataAvailable = trays.length > 0;

    const totals = trays.reduce((acc, tray) => {
      const trayCount = coerceNumber(tray.trayCount) || 1;
      const plantCount = coerceNumber(tray.plantCount) || 0;

      acc.trays += trayCount;
      acc.plants += plantCount;
      return acc;
    }, { trays: 0, plants: 0 });

    const payload = {
      activeTrays: totals.trays,
      totalPlants: totals.plants,
      farmCount: dataAvailable ? 1 : 0,
      byFarm: dataAvailable ? [
        {
          farmId,
          name: pickFarmName(farmId),
          activeTrays: totals.trays,
          totalPlants: totals.plants,
          trays
        }
      ] : []
    };

    res.json({
      status: dataAvailable ? 'success' : 'unavailable',
      dataAvailable,
      data: payload
    });
  } catch (error) {
    console.error('[Inventory] Failed to load current inventory:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to load inventory'
    });
  }
});

/**
 * GET /api/inventory/forecast/:days?
 * Returns harvest forecast list (cloud)
 */
router.get('/forecast/:days?', async (req, res) => {
  try {
    const farmId = await resolveFarmId(req);
    if (!farmId) {
      return res.status(400).json({
        status: 'error',
        message: 'Farm ID unavailable'
      });
    }

    const groups = await loadFarmGroups(farmId);
    const daysLimit = req.params.days ? parseInt(req.params.days, 10) : null;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const forecast = [];

    groups.forEach((group) => {
      const seedDateValue = group?.planConfig?.anchor?.seedDate || group?.seedDate;
      if (!seedDateValue) return;

      const seedDate = new Date(seedDateValue);
      if (Number.isNaN(seedDate.getTime())) return;

      const cropName = group.crop || group.recipe || group.name || 'Mixed crops';
      const growDays = cropUtils.getCropGrowDays(cropName) || 35;

      const harvestDate = new Date(seedDate);
      harvestDate.setDate(seedDate.getDate() + growDays);

      const daysToHarvest = Math.floor((harvestDate - today) / (1000 * 60 * 60 * 24));
      if (daysLimit !== null && daysToHarvest > daysLimit) return;

      forecast.push({
        harvestDate: harvestDate.toISOString(),
        cropName
      });
    });

    const dataAvailable = forecast.length > 0;

    res.json({
      status: dataAvailable ? 'success' : 'unavailable',
      dataAvailable,
      data: dataAvailable ? forecast.sort((a, b) => new Date(a.harvestDate) - new Date(b.harvestDate)) : []
    });
  } catch (error) {
    console.error('[Inventory] Failed to load forecast:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to load forecast'
    });
  }
});

/**
 * POST /api/inventory/:farmId/sync
 * Receive inventory sync from edge device
 */
router.post('/:farmId/sync', async (req, res) => {
  try {
    const { farmId } = req.params;
    const { products } = req.body;

    if (!products || !Array.isArray(products)) {
      return res.status(400).json({ error: 'Products array required' });
    }

    console.log(`[Inventory Sync] Received ${products.length} products from farm ${farmId}`);

    // Upsert each product — only touch auto columns, preserve manual entries
    for (const product of products) {
      const productId = product.product_id || product.sku;
      const autoQty = Number(product.quantity) || 0;
      const unitPrice = Number(product.price) || 0;

      // Resolve prices from Crop Pricing page when edge device doesn't supply them
      let syncRetail = unitPrice;
      let syncWholesale = unitPrice;
      if (!unitPrice && product.product_name) {
        const cropPrices = await resolveCropPricing(farmId, product.product_name);
        syncRetail = cropPrices.retailPrice || 0;
        syncWholesale = cropPrices.wholesalePrice || 0;
      }

      await query(
        `INSERT INTO farm_inventory (
          farm_id, product_id, product_name, sku, quantity, unit, price,
          available_for_wholesale, auto_quantity_lbs, quantity_available,
          quantity_unit, wholesale_price, retail_price, inventory_source,
          category, variety, synced_at, last_updated
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW(),NOW())
        ON CONFLICT (farm_id, product_id) DO UPDATE SET
          product_name = EXCLUDED.product_name,
          sku = EXCLUDED.sku,
          quantity = EXCLUDED.quantity,
          unit = EXCLUDED.unit,
          price = EXCLUDED.price,
          available_for_wholesale = EXCLUDED.available_for_wholesale,
          auto_quantity_lbs = EXCLUDED.auto_quantity_lbs,
          quantity_available = EXCLUDED.auto_quantity_lbs + COALESCE(farm_inventory.manual_quantity_lbs, 0),
          quantity_unit = EXCLUDED.quantity_unit,
          wholesale_price = CASE WHEN EXCLUDED.wholesale_price > 0 THEN EXCLUDED.wholesale_price ELSE COALESCE(NULLIF(farm_inventory.wholesale_price, 0), EXCLUDED.wholesale_price) END,
          retail_price = CASE WHEN EXCLUDED.retail_price > 0 THEN EXCLUDED.retail_price ELSE COALESCE(NULLIF(farm_inventory.retail_price, 0), EXCLUDED.retail_price) END,
          inventory_source = CASE
            WHEN COALESCE(farm_inventory.manual_quantity_lbs, 0) > 0 THEN 'hybrid'
            ELSE 'auto'
          END,
          category = COALESCE(EXCLUDED.category, farm_inventory.category),
          variety = COALESCE(EXCLUDED.variety, farm_inventory.variety),
          synced_at = NOW(),
          last_updated = NOW()
        `,
        [
          farmId,
          productId,
          product.product_name,
          product.sku || productId,
          autoQty,
          product.unit || 'lb',
          unitPrice,
          (product.available_for_wholesale !== undefined ? product.available_for_wholesale : true),
          autoQty,                              // auto_quantity_lbs
          autoQty,                              // quantity_available (initial; ON CONFLICT adds manual)
          product.unit || 'lb',                 // quantity_unit
          syncWholesale,                        // wholesale_price
          syncRetail,                           // retail_price
          'auto',                               // inventory_source (initial; ON CONFLICT may set 'hybrid')
          product.category || null,             // category
          product.variety || null               // variety
        ]
      );
    }

    res.json({ 
      success: true, 
      farm_id: farmId,
      products_synced: products.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[Inventory Sync] Error:', error);
    res.status(500).json({ error: 'Failed to sync inventory' });
  }
});

/**
 * GET /api/inventory/:farmId
 * Get current inventory for a farm
 */
router.get('/:farmId', async (req, res) => {
  try {
    const { farmId } = req.params;

    const result = await query(
      `SELECT *,
        COALESCE(auto_quantity_lbs, 0) + COALESCE(manual_quantity_lbs, 0) AS available_lbs
       FROM farm_inventory WHERE farm_id = $1 ORDER BY product_name`,
      [farmId]
    );

    res.json({ 
      farm_id: farmId,
      products: result.rows,
      count: result.rows.length
    });
  } catch (error) {
    console.error('[Inventory] Error:', error);
    res.status(500).json({ error: 'Failed to fetch inventory' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// MANUAL INVENTORY — for growers not using tray-based automation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/inventory/manual
 * Add or update a product with manual quantity (weight-based).
 * Body: { product_name, sku?, quantity_lbs, unit?, price, wholesale_price?,
 *         category?, variety?, available_for_wholesale? }
 */
router.post('/manual', async (req, res) => {
  try {
    const farmId = await resolveFarmId(req);
    if (!farmId) return res.status(401).json({ error: 'Farm ID required' });

    const { product_name, sku, quantity_lbs, unit, price, wholesale_price,
            retail_price, category, variety, available_for_wholesale } = req.body;

    if (!product_name || quantity_lbs === undefined) {
      return res.status(400).json({ error: 'product_name and quantity_lbs are required' });
    }

    const manualQty = Math.max(0, Number(quantity_lbs) || 0);
    const legacyQty = manualQty;
    const productId = sku || product_name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

    // Resolve pricing from the Crop Pricing page when not explicitly provided
    const cropPrices = await resolveCropPricing(farmId, product_name);
    const unitPrice = Number(price) || cropPrices.retailPrice || 0;
    const resolvedRetail = Number(retail_price) || cropPrices.retailPrice || unitPrice;
    const resolvedWholesale = Number(wholesale_price) || cropPrices.wholesalePrice || unitPrice;

    console.log(`[Manual Inventory] Attempting: farm=${farmId} product=${product_name} qty=${manualQty} id=${productId}`);

    let result;
    try {
      // Full INSERT with all extended columns (requires compatibility migration)
      result = await query(
        `INSERT INTO farm_inventory (
          farm_id, product_id, product_name, sku_id, sku_name, sku, quantity, unit, price,
          available_for_wholesale, manual_quantity_lbs, quantity_available,
          quantity_unit, wholesale_price, retail_price, inventory_source,
          category, variety, last_updated
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'manual',$16,$17,NOW())
        ON CONFLICT (farm_id, product_id) DO UPDATE SET
          product_name = EXCLUDED.product_name,
          sku_id = EXCLUDED.sku_id,
          sku_name = EXCLUDED.sku_name,
          manual_quantity_lbs = EXCLUDED.manual_quantity_lbs,
          quantity_available = COALESCE(farm_inventory.auto_quantity_lbs, 0) + EXCLUDED.manual_quantity_lbs,
          quantity_unit = EXCLUDED.quantity_unit,
          wholesale_price = EXCLUDED.wholesale_price,
          retail_price = EXCLUDED.retail_price,
          price = EXCLUDED.price,
          available_for_wholesale = EXCLUDED.available_for_wholesale,
          inventory_source = CASE
            WHEN COALESCE(farm_inventory.auto_quantity_lbs, 0) > 0 THEN 'hybrid'
            ELSE 'manual'
          END,
          category = COALESCE(EXCLUDED.category, farm_inventory.category),
          variety = COALESCE(EXCLUDED.variety, farm_inventory.variety),
          last_updated = NOW()
        RETURNING *`,
        [
          farmId,
          productId,
          product_name,
          sku || productId,
          product_name,
          sku || productId,
          legacyQty,
          unit || 'lb',
          unitPrice,
          available_for_wholesale !== false,
          manualQty,
          manualQty,
          unit || 'lb',
          resolvedWholesale,
          resolvedRetail,
          category || null,
          variety || null
        ]
      );
    } catch (insertErr) {
      // Log the full PG error for diagnostics
      console.error('[Manual Inventory] Full INSERT failed:', {
        message: insertErr.message,
        code: insertErr.code,
        detail: insertErr.detail,
        hint: insertErr.hint,
        column: insertErr.column,
        table: insertErr.table,
        constraint: insertErr.constraint,
        where: insertErr.where,
        stack: insertErr.stack
      });

      // Fallback: use only the base columns from migration 009
      // (farm_id, product_id, product_name, sku, quantity, unit, price,
      //  available_for_wholesale, last_updated)
      console.log('[Manual Inventory] Trying fallback INSERT with base columns only');
      result = await query(
        `INSERT INTO farm_inventory (
          farm_id, product_id, product_name, sku_id, sku_name, sku, quantity, unit, price,
          available_for_wholesale, last_updated
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
        ON CONFLICT (farm_id, product_id) DO UPDATE SET
          product_name = EXCLUDED.product_name,
          sku_id = EXCLUDED.sku_id,
          sku_name = EXCLUDED.sku_name,
          quantity = EXCLUDED.quantity,
          price = EXCLUDED.price,
          available_for_wholesale = EXCLUDED.available_for_wholesale,
          last_updated = NOW()
        RETURNING *`,
        [
          farmId,
          productId,
          product_name,
          sku || productId,
          product_name,
          sku || productId,
          legacyQty,
          unit || 'lb',
          unitPrice,
          available_for_wholesale !== false
        ]
      );
      console.log('[Manual Inventory] Fallback INSERT succeeded');
    }

    console.log(`[Manual Inventory] Saved: ${farmId}: ${product_name} = ${manualQty} ${unit || 'lb'}`);

    res.json({
      success: true,
      product: result.rows[0],
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    const errDetail = typeof error === 'string' ? error
      : (error?.message || error?.detail || JSON.stringify(error) || 'Unknown error');
    console.error('[Manual Inventory] Error:', {
      message: error?.message,
      code: error?.code,
      detail: error?.detail,
      hint: error?.hint,
      column: error?.column,
      table: error?.table,
      constraint: error?.constraint,
      stack: error?.stack
    });
    res.status(500).json({ error: 'Failed to save manual inventory', detail: errDetail });
  }
});

/**
 * PUT /api/inventory/manual/:productId
 * Update manual quantity for an existing product.
 * Body: { quantity_lbs, price?, wholesale_price?, retail_price?, available_for_wholesale? }
 */
router.put('/manual/:productId', async (req, res) => {
  try {
    const farmId = await resolveFarmId(req);
    if (!farmId) return res.status(401).json({ error: 'Farm ID required' });

    const { productId } = req.params;
    const { quantity_lbs, price, wholesale_price, retail_price, available_for_wholesale } = req.body;

    if (quantity_lbs === undefined) {
      return res.status(400).json({ error: 'quantity_lbs is required' });
    }

    const manualQty = Math.max(0, Number(quantity_lbs) || 0);

    const setClauses = [
      'manual_quantity_lbs = $2',
      'quantity_available = COALESCE(auto_quantity_lbs, 0) + $2',
      `inventory_source = CASE WHEN COALESCE(auto_quantity_lbs, 0) > 0 THEN 'hybrid' ELSE 'manual' END`,
      'last_updated = NOW()'
    ];
    const params = [farmId, manualQty];
    let idx = 3;

    if (price !== undefined) {
      setClauses.push(`price = $${idx}`);
      params.push(Number(price));
      idx++;
    }
    if (wholesale_price !== undefined) {
      setClauses.push(`wholesale_price = $${idx}`);
      params.push(Number(wholesale_price));
      idx++;
    }
    if (retail_price !== undefined) {
      setClauses.push(`retail_price = $${idx}`);
      params.push(Number(retail_price));
      idx++;
    }
    if (available_for_wholesale !== undefined) {
      setClauses.push(`available_for_wholesale = $${idx}`);
      params.push(Boolean(available_for_wholesale));
      idx++;
    }

    params.push(productId);

    const result = await query(
      `UPDATE farm_inventory SET ${setClauses.join(', ')}
       WHERE farm_id = $1 AND product_id = $${idx}
       RETURNING *`,
      params
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Product not found' });
    }

    res.json({ success: true, product: result.rows[0] });
  } catch (error) {
    console.error('[Manual Inventory] Update error:', error);
    res.status(500).json({ error: 'Failed to update inventory' });
  }
});

/**
 * DELETE /api/inventory/manual/:productId
 * Remove a manual inventory entry (only if source is 'manual').
 */
router.delete('/manual/:productId', async (req, res) => {
  try {
    const farmId = await resolveFarmId(req);
    if (!farmId) return res.status(401).json({ error: 'Farm ID required' });

    const { productId } = req.params;

    // If hybrid, just zero out manual portion instead of deleting
    const check = await query(
      'SELECT inventory_source, auto_quantity_lbs FROM farm_inventory WHERE farm_id = $1 AND product_id = $2',
      [farmId, productId]
    );

    if (!check.rows.length) {
      return res.status(404).json({ error: 'Product not found' });
    }

    if (check.rows[0].inventory_source === 'hybrid' || Number(check.rows[0].auto_quantity_lbs) > 0) {
      // Has auto data — zero out manual, revert to auto-only
      await query(
        `UPDATE farm_inventory SET
          manual_quantity_lbs = 0,
          quantity_available = COALESCE(auto_quantity_lbs, 0),
          inventory_source = 'auto',
          last_updated = NOW()
         WHERE farm_id = $1 AND product_id = $2`,
        [farmId, productId]
      );
      return res.json({ success: true, action: 'cleared_manual', product_id: productId });
    }

    // Pure manual — safe to delete
    await query('DELETE FROM farm_inventory WHERE farm_id = $1 AND product_id = $2', [farmId, productId]);
    res.json({ success: true, action: 'deleted', product_id: productId });
  } catch (error) {
    console.error('[Manual Inventory] Delete error:', error);
    res.status(500).json({ error: 'Failed to delete inventory item' });
  }
});

export default router;

