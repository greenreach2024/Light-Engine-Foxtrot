/**
 * Inventory Routes
 * Receive and store inventory data from edge devices
 */
import express from 'express';
import jwt from 'jsonwebtoken';
import { createRequire } from 'module';
import { query, isDatabaseAvailable } from '../config/database.js';

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
  return process.env.JWT_SECRET || require('crypto').randomBytes(32).toString('hex');
}
const JWT_SECRET = getJwtSecret();

function resolveFarmId(req) {
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

  return req.query.farmId || req.headers['x-farm-id'] || null;
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

/**
 * GET /api/inventory/current
 * Returns current inventory summary (cloud)
 */
router.get('/current', async (req, res) => {
  try {
    const farmId = resolveFarmId(req);
    if (!farmId) {
      return res.status(400).json({
        status: 'error',
        message: 'Farm ID unavailable'
      });
    }

    const groups = await loadFarmGroups(farmId);
    const dataAvailable = groups.length > 0;

    const totals = groups.reduce((acc, group) => {
      const trayCount = coerceNumber(group.trays)
        || coerceNumber(group.trayCount)
        || 0;
      const plantCount = coerceNumber(group.plants)
        || coerceNumber(group.plantCount)
        || 0;

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
          trays: []
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
    const farmId = resolveFarmId(req);
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

    // Clear existing inventory for this farm
    await query('DELETE FROM farm_inventory WHERE farm_id = $1', [farmId]);

    // Insert new inventory (match migration schema)
    for (const product of products) {
      await query(
        `INSERT INTO farm_inventory (
          farm_id, 
          product_id,
          product_name,
          sku, 
          quantity, 
          unit, 
          price,
          available_for_wholesale,
          last_updated
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
        [
          farmId,
          product.product_id || product.sku,
          product.product_name,
          product.sku || product.product_id,
          product.quantity || 0,
          product.unit || 'unit',
          product.price || 0,
          (product.available_for_wholesale !== undefined ? product.available_for_wholesale : 1)
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
      'SELECT * FROM farm_inventory WHERE farm_id = $1 ORDER BY product_name',
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

export default router;

