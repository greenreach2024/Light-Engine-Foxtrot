/**
 * Sync Routes
 * Handles edge-to-cloud data synchronization
 * 
 * Authentication: Uses farm API keys (X-API-Key header)
 * Data Flow: Edge devices push updates to cloud
 */

import express from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';
import { evaluateAndGenerateAlerts, autoResolveAlerts } from '../services/alert-manager.js';
import { query, isDatabaseAvailable } from '../config/database.js';
import { upsertNetworkFarm } from '../services/networkFarmsStore.js';
import { recalculateAutoInventoryFromGroups } from './inventory.js';

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// In-memory storage for farms without database
const inMemoryStore = {
  rooms: new Map(),      // farmId -> rooms array
  groups: new Map(),     // farmId -> groups array
  schedules: new Map(),  // farmId -> schedules array
  inventory: new Map(),  // farmId -> inventory array
  telemetry: new Map(),  // farmId -> telemetry data
};

export function getInMemoryGroups() {
  return inMemoryStore.groups;
}

/**
 * Hydrate in-memory Maps from the farm_data DB table on startup.
 * This ensures data survives server restarts when PostgreSQL is available.
 */
export async function hydrateFromDatabase() {
  if (!isDatabaseAvailable()) {
    logger.info('[Sync] Database unavailable — skipping hydration');
    return { hydrated: false, reason: 'no_database' };
  }

  try {
    const result = await query(
      `SELECT farm_id, data_type, data FROM farm_data ORDER BY farm_id`
    );

    let count = 0;
    for (const row of result.rows) {
      const { farm_id, data_type, data } = row;
      if (!data) continue;

      switch (data_type) {
        case 'rooms':
          inMemoryStore.rooms.set(farm_id, Array.isArray(data) ? data : (data.rooms || []));
          count++;
          break;
        case 'groups':
          inMemoryStore.groups.set(farm_id, Array.isArray(data) ? data : (data.groups || []));
          count++;
          break;
        case 'schedules':
          inMemoryStore.schedules.set(farm_id, Array.isArray(data) ? data : (data.schedules || []));
          count++;
          break;
        case 'inventory':
          inMemoryStore.inventory.set(farm_id, Array.isArray(data) ? data : []);
          count++;
          break;
        case 'telemetry':
          if (!inMemoryStore.telemetry) inMemoryStore.telemetry = new Map();
          inMemoryStore.telemetry.set(farm_id, data);
          count++;
          break;
        case 'devices':
          if (!inMemoryStore.devices) inMemoryStore.devices = new Map();
          inMemoryStore.devices.set(farm_id, Array.isArray(data) ? data : (data.devices || []));
          count++;
          break;
        case 'config':
          if (!inMemoryStore.config) inMemoryStore.config = new Map();
          inMemoryStore.config.set(farm_id, data);
          count++;
          break;
        default:
          // Unknown data type — store generically
          if (!inMemoryStore[data_type]) inMemoryStore[data_type] = new Map();
          inMemoryStore[data_type].set(farm_id, data);
          count++;
      }
    }

    const farmIds = [...new Set(result.rows.map(r => r.farm_id))];
    logger.info(`[Sync] Hydrated ${count} data sets for ${farmIds.length} farm(s) from database`);
    return { hydrated: true, datasets: count, farms: farmIds.length, farmIds };
  } catch (err) {
    logger.error('[Sync] Hydration failed:', err.message);
    return { hydrated: false, reason: err.message };
  }
}

/**
 * One-time migration: move farm_data rows stored under farm_id='default'
 * to the correct farm ID. This fixes data written before farmIdFromReq
 * was updated to parse JWT tokens.
 */
export async function migrateDefaultFarmData() {
  if (!isDatabaseAvailable()) return;
  try {
    // Find all data stored under 'default'
    const defaultRows = await query(
      `SELECT data_type, data FROM farm_data WHERE farm_id = 'default'`
    );
    if (defaultRows.rows.length === 0) return;

    // Find the real farm ID(s) from the farms table
    const farmsResult = await query(`SELECT farm_id FROM farms LIMIT 10`);
    if (farmsResult.rows.length === 0) {
      logger.warn('[Migration] No farms found in DB — skipping default data migration');
      return;
    }

    // For single-farm setups, migrate to the one farm. For multi-farm,
    // only migrate if there's exactly one farm (can't guess which one).
    const farmIds = farmsResult.rows.map(r => r.farm_id).filter(id => id && id !== 'default');
    if (farmIds.length !== 1) {
      logger.info(`[Migration] ${farmIds.length} farms found — skipping ambiguous default data migration`);
      return;
    }

    const realFarmId = farmIds[0];
    let migrated = 0;

    for (const row of defaultRows.rows) {
      // Only migrate if no data exists under the real farm ID for this data_type
      const existing = await query(
        `SELECT 1 FROM farm_data WHERE farm_id = $1 AND data_type = $2`,
        [realFarmId, row.data_type]
      );
      if (existing.rows.length === 0) {
        await query(
          `INSERT INTO farm_data (farm_id, data_type, data, updated_at)
           VALUES ($1, $2, $3, NOW())`,
          [realFarmId, row.data_type, JSON.stringify(row.data)]
        );
        migrated++;
        logger.info(`[Migration] Copied default/${row.data_type} → ${realFarmId}`);
      }
    }

    // Clean up default rows after successful migration
    if (migrated > 0) {
      await query(`DELETE FROM farm_data WHERE farm_id = 'default'`);
      logger.info(`[Migration] Migrated ${migrated} data set(s) from 'default' to '${realFarmId}', cleaned up default rows`);
    }
  } catch (err) {
    logger.warn('[Migration] Default farm data migration failed (non-fatal):', err.message);
  }
}

/**
 * Get the in-memory store reference (used by farm-data middleware).
 */
export function getInMemoryStore() {
  return inMemoryStore;
}

function loadFarmApiKeys() {
  const candidatePaths = [
    path.join(__dirname, '..', 'public', 'data', 'farm-api-keys.json'),
    path.join(__dirname, '..', '..', 'public', 'data', 'farm-api-keys.json')
  ];

  for (const filePath of candidatePaths) {
    if (!fs.existsSync(filePath)) continue;

    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return parsed;
    } catch (error) {
      logger.warn(`[Sync] Failed to parse farm API keys at ${filePath}:`, error.message);
    }
  }

  return null;
}

export async function isValidFarmApiKey(farmId, apiKey) {
  if (await isDatabaseAvailable()) {
    try {
      const dbResult = await query(
        `SELECT farm_id FROM farms WHERE farm_id = $1 AND api_key = $2 LIMIT 1`,
        [farmId, apiKey]
      );

      if (dbResult.rows.length > 0) {
        return true;
      }
    } catch (error) {
      logger.warn(`[Sync] Database API key validation failed for farm ${farmId}:`, error.message);
    }
  }

  const keyFile = loadFarmApiKeys();
  if (!keyFile || typeof keyFile !== 'object') {
    return false;
  }

  const entry = keyFile[farmId];
  if (!entry || typeof entry !== 'object') {
    return false;
  }

  return entry.api_key === apiKey && (entry.status || 'active') === 'active';
}

/**
 * Middleware: Authenticate farm device via API key
 */
async function authenticateFarm(req, res, next) {
  try {
    const apiKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');
    const farmId = req.headers['x-farm-id'] || req.body?.farmId || req.params?.farmId;

    if (!apiKey) {
      return res.status(401).json({
        success: false,
        error: 'API key required',
        message: 'Include X-API-Key header or Authorization: Bearer <key>'
      });
    }

    if (!farmId) {
      return res.status(400).json({
        success: false,
        error: 'Farm ID required',
        message: 'Include X-Farm-ID header, farmId in request body, or :farmId in route path'
      });
    }

    if (req.params?.farmId && req.params.farmId !== farmId) {
      return res.status(403).json({
        success: false,
        error: 'Farm ID mismatch'
      });
    }

    // Validate API key format (64-char hex)
    if (!/^[a-f0-9]{64}$/.test(apiKey)) {
      return res.status(401).json({
        success: false,
        error: 'Invalid API key format'
      });
    }

    const validApiKey = await isValidFarmApiKey(farmId, apiKey);
    if (!validApiKey) {
      return res.status(401).json({
        success: false,
        error: 'Invalid API key'
      });
    }

    req.farmId = farmId;
    req.apiKey = apiKey;
    req.authenticated = true;

    logger.info(`[Sync] Authenticated farm: ${farmId}`);
    next();
  } catch (error) {
    logger.error('[Sync] Authentication middleware failed:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Authentication failure'
    });
  }
}

/**
 * POST /api/sync/rooms
 * Sync room configurations from edge to cloud
 */

/**
 * POST /api/sync/harvest
 * Sync harvest data from edge to cloud -- bridges tray-runs to farm_inventory (E-010 fix)
 * Called by sync-service after POST /api/tray-runs/:id/harvest on LE.
 */
router.post("/harvest", authenticateFarm, async (req, res) => {
  const startedAt = Date.now();
  try {
    const { farmId } = req;
    const { harvests } = req.body;

    if (!Array.isArray(harvests) || harvests.length === 0) {
      return res.status(400).json({ success: false, error: "harvests must be a non-empty array" });
    }

    logger.info(`[Sync] Syncing ${harvests.length} harvests for farm ${farmId}`);

    if (!(await isDatabaseAvailable())) {
      return res.status(503).json({ success: false, error: "Database unavailable" });
    }

    let upserted = 0;
    for (const h of harvests) {
      const crop = h.crop || h.crop_name || "Unknown";
      const productId = crop.toLowerCase().replace(/\s+/g, "-");
      const weightLbs = h.actual_weight_oz ? Math.round((h.actual_weight_oz / 16) * 100) / 100 : 0;

      if (weightLbs <= 0) continue;

      await query(
        `INSERT INTO farm_inventory (
          farm_id, product_id, product_name, lot_code, auto_quantity_lbs,
          quantity_available, unit, quantity_unit, inventory_source,
          category, variety, last_updated
        ) VALUES ($1,$2,$3,$4,$5,$5,'lb','lb','auto',$6,$7,NOW())
        ON CONFLICT (farm_id, product_id) DO UPDATE SET
          auto_quantity_lbs = farm_inventory.auto_quantity_lbs + $5,
          quantity_available = (farm_inventory.auto_quantity_lbs + $5)
            + COALESCE(farm_inventory.manual_quantity_lbs, 0)
            - COALESCE(farm_inventory.sold_quantity_lbs, 0),
          lot_code = COALESCE($4, farm_inventory.lot_code),
          product_name = COALESCE(NULLIF($3, 'Unknown'), farm_inventory.product_name),
          variety = COALESCE($7, farm_inventory.variety),
          last_updated = NOW()`,
        [farmId, productId, crop, h.lot_code || null, weightLbs, h.category || null, h.variety || null]
      );
      upserted++;
    }

    logger.info(`[Sync] Upserted ${upserted} harvest records into farm_inventory for farm ${farmId}`);

    res.json({
      success: true,
      message: `Synced ${upserted} harvests`,
      farmId,
      count: upserted,
      timestamp: new Date().toISOString()
    });
    recordSyncMetric(req, { type: "sync-harvest", success: true, farmId, records: upserted, lagMs: Date.now() - startedAt });

  } catch (error) {
    logger.error("[Sync] Error syncing harvests:", error);
    recordSyncMetric(req, { type: "sync-harvest", success: false, lagMs: Date.now() - startedAt, error: error.message });
    res.status(500).json({
      success: false,
      error: "Failed to sync harvests",
      message: error.message
    });
  }
});

/**
 * POST /api/sync/rooms
 * Sync room configurations from edge to cloud
 */
router.post('/rooms', authenticateFarm, async (req, res) => {
  try {
    const { farmId } = req;
    const { rooms } = req.body;
    
    if (!Array.isArray(rooms)) {
      return res.status(400).json({ 
        success: false,
        error: 'Rooms must be an array' 
      });
    }
    
    logger.info(`[Sync] Syncing ${rooms.length} rooms for farm ${farmId}`);
    
    // Always update in-memory cache
    inMemoryStore.rooms.set(farmId, rooms);
    
    if (await isDatabaseAvailable()) {
      // Write-through to farm_data table (canonical multi-tenant store)
      await query(
        `INSERT INTO farm_data (farm_id, data_type, data, updated_at)
         VALUES ($1, 'rooms', $2, NOW())
         ON CONFLICT (farm_id, data_type)
         DO UPDATE SET data = $2, updated_at = NOW()`,
        [farmId, JSON.stringify(rooms)]
      );
      
      logger.info(`[Sync] Saved ${rooms.length} rooms to farm_data + memory for farm ${farmId}`);
    } else {
      logger.info(`[Sync] Saved ${rooms.length} rooms to memory for farm ${farmId}`);
    }
    
    res.json({ 
      success: true,
      message: `Synced ${rooms.length} rooms`,
      farmId,
      count: rooms.length,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error('[Sync] Error syncing rooms:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to sync rooms',
      message: error.message 
    });
  }
});

/**
 * POST /api/sync/groups
 * Sync group configurations from edge to cloud
 */
router.post('/groups', authenticateFarm, async (req, res) => {
  try {
    const { farmId } = req;
    const { groups } = req.body;
    
    if (!Array.isArray(groups)) {
      return res.status(400).json({ 
        success: false,
        error: 'Groups must be an array' 
      });
    }
    
    logger.info(`[Sync] Syncing ${groups.length} groups for farm ${farmId}`);
    
    // Always update in-memory cache
    inMemoryStore.groups.set(farmId, groups);
    
    if (await isDatabaseAvailable()) {
      // Write-through to farm_data table (canonical multi-tenant store)
      await query(
        `INSERT INTO farm_data (farm_id, data_type, data, updated_at)
         VALUES ($1, 'groups', $2, NOW())
         ON CONFLICT (farm_id, data_type)
         DO UPDATE SET data = $2, updated_at = NOW()`,
        [farmId, JSON.stringify(groups)]
      );
      
      logger.info(`[Sync] Saved ${groups.length} groups to farm_data + memory for farm ${farmId}`);
    } else {
      logger.info(`[Sync] Saved ${groups.length} groups to memory for farm ${farmId}`);
    }
    
    res.json({ 
      success: true,
      message: `Synced ${groups.length} groups`,
      farmId,
      count: groups.length,
      timestamp: new Date().toISOString()
    });
    
    // Fire-and-forget: recalculate auto inventory after groups change
    recalculateAutoInventoryFromGroups(farmId).catch(err =>
      logger.error(`[Sync] Background inventory recalc failed for farm ${farmId}:`, err)
    );

  } catch (error) {
    logger.error('[Sync] Error syncing groups:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to sync groups',
      message: error.message 
    });
  }
});

/**
 * POST /api/sync/schedules
 * Sync lighting schedules from edge to cloud
 */
router.post('/schedules', authenticateFarm, async (req, res) => {
  try {
    const { farmId } = req;
    const { schedules } = req.body;
    
    if (!Array.isArray(schedules)) {
      return res.status(400).json({ 
        success: false,
        error: 'Schedules must be an array' 
      });
    }
    
    logger.info(`[Sync] Syncing ${schedules.length} schedules for farm ${farmId}`);
    
    // Always update in-memory cache
    inMemoryStore.schedules.set(farmId, schedules);
    
    if (await isDatabaseAvailable()) {
      // Write-through to farm_data table (canonical multi-tenant store)
      await query(
        `INSERT INTO farm_data (farm_id, data_type, data, updated_at)
         VALUES ($1, 'schedules', $2, NOW())
         ON CONFLICT (farm_id, data_type)
         DO UPDATE SET data = $2, updated_at = NOW()`,
        [farmId, JSON.stringify(schedules)]
      );
      
      logger.info(`[Sync] Saved ${schedules.length} schedules to farm_data + memory for farm ${farmId}`);
    } else {
      logger.info(`[Sync] Saved ${schedules.length} schedules to memory for farm ${farmId}`);
    }
    
    res.json({ 
      success: true,
      message: `Synced ${schedules.length} schedules`,
      farmId,
      count: schedules.length,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error('[Sync] Error syncing schedules:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to sync schedules',
      message: error.message 
    });
  }
});

/**
 * POST /api/sync/config
 * Sync farm config/settings from edge to cloud (backup)
 */
router.post('/config', authenticateFarm, async (req, res) => {
  try {
    const { farmId } = req;
    const { config } = req.body;
    
    if (!config || typeof config !== 'object') {
      return res.status(400).json({ 
        success: false,
        error: 'Config must be an object' 
      });
    }
    
    logger.info(`[Sync] Syncing config for farm ${farmId}`);
    
    // Always update in-memory cache
    if (!inMemoryStore.config) inMemoryStore.config = new Map();
    inMemoryStore.config.set(farmId, config);
    
    if (await isDatabaseAvailable()) {
      await query(
        `INSERT INTO farm_data (farm_id, data_type, data, updated_at)
         VALUES ($1, 'config', $2, NOW())
         ON CONFLICT (farm_id, data_type)
         DO UPDATE SET data = $2, updated_at = NOW()`,
        [farmId, JSON.stringify(config)]
      );
      logger.info(`[Sync] Saved config to farm_data + memory for farm ${farmId}`);
    } else {
      logger.info(`[Sync] Saved config to memory for farm ${farmId}`);
    }
    
    res.json({ 
      success: true,
      message: 'Config synced',
      farmId,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error('[Sync] Error syncing config:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to sync config',
      message: error.message 
    });
  }
});

/**
 * POST /api/sync/inventory
 * Sync inventory/product data from edge to cloud
 */
router.post('/inventory', authenticateFarm, async (req, res) => {
  try {
    const { farmId } = req;
    const products = Array.isArray(req.body?.products)
      ? req.body.products
      : (Array.isArray(req.body?.inventory) ? req.body.inventory : null);
    
    if (!Array.isArray(products)) {
      return res.status(400).json({ 
        success: false,
        error: 'Products must be an array' 
      });
    }
    
    logger.info(`[Sync] Syncing ${products.length} products for farm ${farmId}`);
    
    // Always update in-memory cache
    inMemoryStore.inventory.set(farmId, products);
    
    if (await isDatabaseAvailable()) {
      // Upsert each product into products table (legacy per-row store)
      for (const product of products) {
        const { sku_id, product_name, quantity_available, unit, price_per_unit, organic, certifications } = product;
        
        await query(
          `INSERT INTO products (sku_id, farm_id, name, quantity, unit, price, organic, certifications, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
           ON CONFLICT (sku_id, farm_id) 
           DO UPDATE SET 
             name = $3, 
             quantity = $4, 
             unit = $5, 
             price = $6, 
             organic = $7, 
             certifications = $8, 
             updated_at = NOW()`,
          [sku_id, farmId, product_name, quantity_available, unit, price_per_unit, organic || false, JSON.stringify(certifications || [])]
        );
      }
      
      // Also write to farm_data for unified multi-tenant access
      await query(
        `INSERT INTO farm_data (farm_id, data_type, data, updated_at)
         VALUES ($1, 'inventory', $2, NOW())
         ON CONFLICT (farm_id, data_type)
         DO UPDATE SET data = $2, updated_at = NOW()`,
        [farmId, JSON.stringify(products)]
      );
      
      logger.info(`[Sync] Saved ${products.length} products to DB + memory for farm ${farmId}`);
    } else {
      logger.info(`[Sync] Saved ${products.length} products to memory for farm ${farmId}`);
    }
    
    res.json({ 
      success: true,
      message: `Synced ${products.length} products`,
      farmId,
      count: products.length,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error('[Sync] Error syncing inventory:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to sync inventory',
      message: error.message 
    });
  }
});

/**
 * GET /api/sync/status
 * Get sync status for a farm
 */
router.get('/status', authenticateFarm, async (req, res) => {
  try {
    const { farmId } = req;
    
    if (await isDatabaseAvailable()) {
      // Get last sync times from database
      const result = await query(
        `SELECT data_type, updated_at, 
         jsonb_array_length(data) as count
         FROM farm_data 
         WHERE farm_id = $1
         ORDER BY updated_at DESC`,
        [farmId]
      );
      
      const syncStatus = result.rows.reduce((acc, row) => {
        acc[row.data_type] = {
          lastSync: row.updated_at,
          count: row.count
        };
        return acc;
      }, {});
      
      res.json({ 
        success: true,
        farmId,
        database: true,
        syncStatus,
        timestamp: new Date().toISOString()
      });
    } else {
      // Return in-memory status
      const syncStatus = {
        rooms: {
          count: inMemoryStore.rooms.get(farmId)?.length || 0,
          lastSync: inMemoryStore.rooms.has(farmId) ? 'in-memory' : null
        },
        groups: {
          count: inMemoryStore.groups.get(farmId)?.length || 0,
          lastSync: inMemoryStore.groups.has(farmId) ? 'in-memory' : null
        },
        schedules: {
          count: inMemoryStore.schedules.get(farmId)?.length || 0,
          lastSync: inMemoryStore.schedules.has(farmId) ? 'in-memory' : null
        },
        inventory: {
          count: inMemoryStore.inventory.get(farmId)?.length || 0,
          lastSync: inMemoryStore.inventory.has(farmId) ? 'in-memory' : null
        }
      };
      
      res.json({ 
        success: true,
        farmId,
        database: false,
        syncStatus,
        timestamp: new Date().toISOString()
      });
    }
    
  } catch (error) {
    logger.error('[Sync] Error getting sync status:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to get sync status',
      message: error.message 
    });
  }
});

/**
 * GET /api/sync/:farmId/config
 * Retrieve latest synced config for a farm
 */
router.get('/:farmId/config', authenticateFarm, async (req, res) => {
  try {
    const { farmId } = req.params;
    let config = null;

    if (await isDatabaseAvailable()) {
      const result = await query(
        `SELECT data, updated_at FROM farm_data
         WHERE farm_id = $1 AND data_type = 'config'
         LIMIT 1`,
        [farmId]
      );

      if (result.rows.length > 0) {
        config = result.rows[0].data;
      }
    } else if (inMemoryStore.config) {
      config = inMemoryStore.config.get(farmId) || null;
    }

    return res.json({
      success: true,
      farmId,
      config: config || {},
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('[Sync] Error retrieving config:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve config',
      message: error.message
    });
  }
});

/**
 * POST /api/sync/heartbeat
 * Periodic health check from edge device
 */
router.post('/heartbeat', authenticateFarm, async (req, res) => {
  try {
    const { farmId } = req;
    const { status, metadata, stats } = req.body;
    
    logger.info(`[Sync] Heartbeat from farm ${farmId}, status: ${status}`);
    
    if (await isDatabaseAvailable()) {
      // Map edge device status to database valid statuses
      let dbStatus = 'active';  // Default to active
      if (status === 'offline' || status === 'suspended') {
        dbStatus = 'suspended';
      } else if (status === 'inactive') {
        dbStatus = 'inactive';
      }
      
      // Extract farm data from metadata with safe defaults
      const farmName = metadata?.farmName || metadata?.name || farmId;
      const contactName = metadata?.contact_name 
        || metadata?.contactName 
        || metadata?.contact?.name
        || 'Farm Admin';
      const planType = metadata?.plan_type || metadata?.planType || 'edge'; // Default to edge device
      const apiKeyValue = req.apiKey; // From authenticateFarm middleware
      const apiSecret = metadata?.api_secret || metadata?.apiSecret || crypto.randomBytes(32).toString('hex');
      const jwtSecret = crypto.randomBytes(32).toString('hex'); // Generate secure JWT secret
      
      logger.info(`[Sync] UPSERT values: farmId=${farmId}, jwtSecret=${jwtSecret ? 'SET(' + jwtSecret.length + ')' : 'NULL'}`);
      
      // UPSERT farm - creates on first heartbeat or updates existing
      await query(
        `INSERT INTO farms (
           farm_id, name, contact_name, plan_type, api_key, api_secret, jwt_secret,
           status, last_heartbeat, metadata, created_at, updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9, NOW(), NOW())
         ON CONFLICT (farm_id) 
         DO UPDATE SET 
           status = EXCLUDED.status,
           name = COALESCE(EXCLUDED.name, farms.name),
           contact_name = COALESCE(EXCLUDED.contact_name, farms.contact_name),
           plan_type = COALESCE(EXCLUDED.plan_type, farms.plan_type),
           api_key = COALESCE(farms.api_key, EXCLUDED.api_key),
           api_secret = COALESCE(farms.api_secret, EXCLUDED.api_secret),
           jwt_secret = COALESCE(farms.jwt_secret, EXCLUDED.jwt_secret),
           last_heartbeat = NOW(),
           metadata = EXCLUDED.metadata,
           updated_at = NOW()`,
        [
          farmId, 
          farmName,
          contactName,
          planType,
          apiKeyValue,
          apiSecret,
          jwtSecret,
          dbStatus, 
          JSON.stringify(metadata || {})
        ]
      );
      
      logger.info(`[Sync] Farm ${farmId} upserted successfully with status ${dbStatus}`);
    }
    
    res.json({ 
      success: true,
      message: 'Heartbeat received',
      farmId,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error('[Sync] Error processing heartbeat:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to process heartbeat',
      message: error.message 
    });
  }
});

/**
 * POST /api/sync/health
 * Backward-compatible alias for heartbeat endpoint.
 */
router.post('/health', authenticateFarm, async (req, res) => {
  try {
    const { farmId } = req;
    const normalizedBody = {
      status: req.body?.status || 'active',
      metadata: req.body?.metadata || {},
      stats: req.body?.stats || req.body?.health || {}
    };

    req.body = normalizedBody;

    // Reuse heartbeat behavior
    const { status, metadata, stats } = req.body;
    logger.info(`[Sync] Health alias from farm ${farmId}, status: ${status}`);

    if (await isDatabaseAvailable()) {
      let dbStatus = 'active';
      if (status === 'offline' || status === 'suspended') dbStatus = 'suspended';
      else if (status === 'inactive') dbStatus = 'inactive';

      const farmName = metadata?.farmName || metadata?.name || farmId;
      const contactName = metadata?.contact_name || metadata?.contactName || metadata?.contact?.name || 'Farm Admin';
      const planType = metadata?.plan_type || metadata?.planType || 'edge';
      const apiKeyValue = req.apiKey;
      const apiSecret = metadata?.api_secret || metadata?.apiSecret || crypto.randomBytes(32).toString('hex');
      const jwtSecret = crypto.randomBytes(32).toString('hex');

      await query(
        `INSERT INTO farms (
           farm_id, name, contact_name, plan_type, api_key, api_secret, jwt_secret,
           status, last_heartbeat, metadata, created_at, updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9, NOW(), NOW())
         ON CONFLICT (farm_id)
         DO UPDATE SET
           status = EXCLUDED.status,
           name = COALESCE(EXCLUDED.name, farms.name),
           contact_name = COALESCE(EXCLUDED.contact_name, farms.contact_name),
           plan_type = COALESCE(EXCLUDED.plan_type, farms.plan_type),
           api_key = COALESCE(farms.api_key, EXCLUDED.api_key),
           api_secret = COALESCE(farms.api_secret, EXCLUDED.api_secret),
           jwt_secret = COALESCE(farms.jwt_secret, EXCLUDED.jwt_secret),
           last_heartbeat = NOW(),
           metadata = EXCLUDED.metadata,
           updated_at = NOW()`,
        [
          farmId,
          farmName,
          contactName,
          planType,
          apiKeyValue,
          apiSecret,
          jwtSecret,
          dbStatus,
          JSON.stringify({ ...metadata, stats })
        ]
      );
    }

    return res.json({
      success: true,
      message: 'Health received',
      farmId,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('[Sync] Error processing health alias:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to process health',
      message: error.message
    });
  }
});

/**
 * Deep merge utility - preserves existing (Central) values over new (Edge) values
 * Used to prevent Edge metadata from overwriting manual Central edits
 */
function deepMergePreferExisting(edge, central) {
  const result = { ...edge };
  
  for (const key in central) {
    if (central[key] && typeof central[key] === 'object' && !Array.isArray(central[key])) {
      result[key] = deepMergePreferExisting(edge[key] || {}, central[key]);
    } else if (central[key] !== null && central[key] !== undefined && central[key] !== '') {
      result[key] = central[key]; // Central wins
    }
  }
  
  return result;
}

/**
 * POST /api/sync/farm-registration
 * One-time farm metadata registration from edge device
 * Called on edge startup to sync farm.json data to Central
 */
router.post('/farm-registration', authenticateFarm, async (req, res) => {
  try {
    const { farmId } = req;
    const { farmData } = req.body;
    
    logger.info(`[Sync] Farm registration from ${farmId}`);
    
    if (!farmData) {
      return res.status(400).json({
        success: false,
        error: 'Missing farmData in request body'
      });
    }
    
    // Validate required fields
    if (!farmData.farmId || !farmData.name) {
      return res.status(400).json({
        success: false,
        error: 'farmData missing required fields (farmId, name)'
      });
    }
    
    // Validate farmId format
    if (!/^FARM-[A-Z0-9]+-[A-Z0-9]+$/i.test(farmData.farmId) && !/^[a-z0-9-]+$/i.test(farmData.farmId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid farmId format'
      });
    }
    
    if (await isDatabaseAvailable()) {
      // Build metadata object from farm.json
      const metadata = {
        contact: farmData.contact || {},
        location: {
          region: farmData.region,
          city: farmData.location,
          coordinates: farmData.coordinates
        },
        status: farmData.status
      };
      
      // Check if farm exists
      const existingFarm = await query(
        'SELECT farm_id, email, api_url, metadata FROM farms WHERE farm_id = $1',
        [farmId]
      );
      
      if (existingFarm.rows.length > 0) {
        const currentFarm = existingFarm.rows[0];
        const currentMetadata = currentFarm.metadata || {};
        
        // Merge strategy: Central wins, Edge fills gaps
        const mergedMetadata = deepMergePreferExisting(metadata, currentMetadata);
        
        // Only update empty fields (preserve Central edits)
        const updates = [];
        const values = [];
        let paramCount = 1;
        
        updates.push(`metadata = $${paramCount++}`);
        values.push(JSON.stringify(mergedMetadata));
        
        updates.push(`updated_at = NOW()`);
        
        if (!currentFarm.email && farmData.contact?.email) {
          updates.push(`email = $${paramCount++}`);
          values.push(farmData.contact.email);
        }
        
        if (!currentFarm.api_url && farmData.api_url) {
          updates.push(`api_url = $${paramCount++}`);
          values.push(farmData.api_url);
        }
        
        values.push(farmId); // WHERE clause parameter
        
        await query(
          `UPDATE farms SET ${updates.join(', ')} WHERE farm_id = $${paramCount}`,
          values
        );
        
        logger.info(`[Sync] Farm ${farmId} registration updated (metadata merged)`);
      } else {
        // Farm doesn't exist - create with full metadata
        // Generate unique registration code
        const registrationCode = `REG-${farmId.split('-').pop()}-${Date.now().toString(36).toUpperCase()}`;
        const jwtSecret = crypto.randomBytes(32).toString('hex'); // Generate JWT secret for new farm
        const apiKey = crypto.randomBytes(32).toString('hex');
        const apiSecret = crypto.randomBytes(32).toString('hex');
        
        await query(
          `INSERT INTO farms (
            farm_id, name, email, contact_name, plan_type, api_url, jwt_secret, api_key, api_secret, status, metadata, registration_code,
            last_heartbeat, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW(), NOW())`,
          [
            farmId,
            farmData.name,
            farmData.contact?.email || null,
            farmData.contact?.name || farmData.contact?.contactName || 'Farm Admin',
            'edge', // Default to edge device
            farmData.api_url,
            jwtSecret,
            apiKey,
            apiSecret,
            'active',
            JSON.stringify(metadata),
            registrationCode
          ]
        );
        
        logger.info(`[Sync] Farm ${farmId} registered for first time with jwt_secret`);
      }
    }
    
    // Also register in wholesale network store so aggregator can reach this farm
    if (farmData.api_url) {
      try {
        await upsertNetworkFarm(farmId, {
          name: farmData.name,
          api_url: farmData.api_url,
          url: farmData.api_url,
          status: 'active',
          contact: farmData.contact || {},
          location: { region: farmData.region, city: farmData.location }
        });
        logger.info(`[Sync] Farm ${farmId} registered in wholesale network (${farmData.api_url})`);
      } catch (netErr) {
        logger.warn(`[Sync] Failed to register farm ${farmId} in network store:`, netErr.message);
      }
    }
    
    res.json({
      success: true,
      message: 'Farm registration successful',
      farmId,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error('[Sync] Error processing farm registration:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to register farm',
      message: error.message
    });
  }
});

/**
 * GET /api/sync/:farmId/rooms
 * Retrieve rooms data for a farm (public read access)
 */
router.get('/:farmId/rooms', authenticateFarm, async (req, res) => {
  try {
    const { farmId } = req.params;
    
    logger.info(`[Sync] Restoring rooms for farm ${farmId}`);
    
    let rooms = [];
    
    if (await isDatabaseAvailable()) {
      // Retrieve from database
      const result = await query(
        `SELECT data FROM farm_data 
         WHERE farm_id = $1 AND data_type = $2`,
        [farmId, 'rooms']
      );
      
      if (result.rows.length > 0) {
        const raw = result.rows[0].data;
        // Handle both flat array and {rooms:[...]} wrapper formats
        rooms = Array.isArray(raw) ? raw : (raw?.rooms || []);
      }
      
      logger.info(`[Sync] Retrieved ${rooms.length} rooms from database for farm ${farmId}`);
    } else {
      // Retrieve from memory
      rooms = inMemoryStore.rooms.get(farmId) || [];
      logger.info(`[Sync] Retrieved ${rooms.length} rooms from memory for farm ${farmId}`);
    }
    
    res.json({ 
      success: true,
      rooms,
      count: rooms.length,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error('[Sync] Error restoring rooms:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to restore rooms',
      message: error.message 
    });
  }
});

/**
 * GET /api/sync/:farmId/groups
 * Retrieve groups (recipes) data for a farm (public read access)
 */
router.get('/:farmId/groups', authenticateFarm, async (req, res) => {
  try {
    const { farmId } = req.params;
    
    logger.info(`[Sync] Restoring groups for farm ${farmId}`);
    
    let groups = [];
    
    if (await isDatabaseAvailable()) {
      // Retrieve from database
      const result = await query(
        `SELECT data FROM farm_data 
         WHERE farm_id = $1 AND data_type = $2`,
        [farmId, 'groups']
      );
      
      if (result.rows.length > 0) {
        const raw = result.rows[0].data;
        // Handle both flat array and {groups:[...]} wrapper formats
        groups = Array.isArray(raw) ? raw : (raw?.groups || []);
      }
      
      logger.info(`[Sync] Retrieved ${groups.length} groups from database for farm ${farmId}`);
    } else {
      // Retrieve from memory
      groups = inMemoryStore.groups.get(farmId) || [];
      logger.info(`[Sync] Retrieved ${groups.length} groups from memory for farm ${farmId}`);
    }
    
    res.json({ 
      success: true,
      groups,
      count: groups.length,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error('[Sync] Error restoring groups:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to restore groups',
      message: error.message 
    });
  }
});

/**
 * Build synthetic tray inventory from groups data.
 * Each group with a trays count expands into individual tray records.
 */
async function buildSyntheticTraysFromGroups(groups) {
  if (!Array.isArray(groups) || groups.length === 0) return [];

  // Load crop registry and tray formats
  let cropRegistry = {};
  let trayFormats = [];
  try {
    const crPath = path.join(process.cwd(), 'public', 'data', 'crop-registry.json');
    if (fs.existsSync(crPath)) {
      cropRegistry = JSON.parse(fs.readFileSync(crPath, 'utf8')).crops || {};
    }
    const tfPath = path.join(process.cwd(), 'public', 'data', 'tray-formats.json');
    if (fs.existsSync(tfPath)) {
      trayFormats = JSON.parse(fs.readFileSync(tfPath, 'utf8'));
    }
  } catch (_) { /* data files optional */ }

  const trayFormatMap = {};
  for (const fmt of trayFormats) {
    if (fmt.trayFormatId) trayFormatMap[fmt.trayFormatId] = fmt;
  }

  const now = new Date();
  const fallbackGrowthDays = 35;
  const msPerDay = 1000 * 60 * 60 * 24;
  const trays = [];

  for (const group of groups) {
    const groupId = group?.id || group?.groupId;
    if (!groupId) continue;

    const trayCount = Math.max(0, Number(group?.trays || 0));
    if (!trayCount) continue;

    // Resolve crop info from registry
    const cropName = group?.crop || group?.recipe || group?.plan || 'Unknown';
    const cropEntry = cropRegistry[cropName] || null;
    const cropGrowthDays = cropEntry?.growth?.daysToHarvest || fallbackGrowthDays;
    const yieldFactor = cropEntry?.growth?.yieldFactor || 0.85;

    // Resolve tray format if linked
    const trayFormat = group?.trayFormatId ? trayFormatMap[group.trayFormatId] : null;

    const totalPlants = Number(group?.plants || 0);
    const plantsPerTray = trayFormat
      ? trayFormat.plantSiteCount
      : Math.max(1, Math.round((totalPlants > 0 ? totalPlants : trayCount * 12) / trayCount));

    const recipeName = group?.recipe || cropName;

    const seedDateRaw = group?.planConfig?.anchor?.seedDate;
    const seedDate = seedDateRaw ? new Date(seedDateRaw) : null;
    const daysOld = seedDate && !Number.isNaN(seedDate.getTime())
      ? Math.max(1, Math.floor((now - seedDate) / msPerDay) + 1)
      : 1;
    const daysToHarvest = Math.max(0, cropGrowthDays - daysOld);

    // Estimate weight per tray: plants x yieldFactor x targetWeightPerSite (oz)
    const weightPerSiteOz = trayFormat?.isWeightBased && trayFormat.targetWeightPerSite
      ? trayFormat.targetWeightPerSite
      : null;
    const estimatedWeightOz = weightPerSiteOz
      ? plantsPerTray * yieldFactor * weightPerSiteOz
      : null;

    const roomLabel = group?.roomId || group?.room || 'ROOM-1';
    const zoneLabel = group?.zoneId || (group?.zone != null ? `ZONE-${group.zone}` : 'ZONE-1');
    const location = `${roomLabel} - ${zoneLabel}`;

    for (let i = 0; i < trayCount; i++) {
      const tray = {
        tray_code: `${groupId}#${i + 1}`,
        trayId: `${groupId}#${i + 1}`,
        groupId,
        recipe_name: recipeName,
        recipe: recipeName,
        plant_count: plantsPerTray,
        plantCount: plantsPerTray,
        age_days: daysOld,
        daysOld,
        days_to_harvest: daysToHarvest,
        daysToHarvest,
        crop_growth_days: cropGrowthDays,
        location,
        status: group?.active === false ? 'inactive' : 'active'
      };

      if (trayFormat) {
        tray.trayFormatId = trayFormat.trayFormatId;
        tray.trayFormatName = trayFormat.name;
        tray.systemType = trayFormat.systemType;
      }
      if (estimatedWeightOz !== null) {
        tray.estimated_weight_oz = Math.round(estimatedWeightOz * 100) / 100;
      }
      if (yieldFactor) {
        tray.yield_factor = yieldFactor;
      }

      trays.push(tray);
    }
  }

  return trays;
}

/**
 * GET /api/sync/:farmId/inventory
 * Retrieve inventory (trays) data for a farm (public read access).
 * Falls back to building synthetic trays from groups data when
 * no explicit inventory records exist.
 */
router.get('/:farmId/inventory', authenticateFarm, async (req, res) => {
  try {
    const { farmId } = req.params;
    
    logger.info(`[Sync] Retrieving inventory for farm ${farmId}`);
    
    let inventory = [];
    
    // 1. Try explicit inventory records in farm_data table
    if (await isDatabaseAvailable()) {
      const result = await query(
        `SELECT data FROM farm_data 
         WHERE farm_id = $1 AND data_type = $2`,
        [farmId, 'inventory']
      );
      
      if (result.rows.length > 0) {
        inventory = result.rows[0].data;
        if (!Array.isArray(inventory)) inventory = [];
      }
    } else {
      inventory = inMemoryStore.inventory?.get(farmId) || [];
    }
    
    // 2. If no explicit inventory, synthesize trays from groups
    if (inventory.length === 0) {
      let groups = [];

      // 2a. Try groups from farm_data table
      if (await isDatabaseAvailable()) {
        const gResult = await query(
          `SELECT data FROM farm_data WHERE farm_id = $1 AND data_type = $2`,
          [farmId, 'groups']
        );
        if (gResult.rows.length > 0) {
          const raw = gResult.rows[0].data;
          groups = Array.isArray(raw) ? raw : (raw?.groups || []);
        }
      } else {
        groups = inMemoryStore.groups?.get(farmId) || [];
      }

      // 2b. Fall back to synced groups.json static file
      if (groups.length === 0) {
        try {
          const fs = await import('fs');
          const path = await import('path');
          const groupsPath = path.default.join(process.cwd(), 'public', 'data', 'groups.json');
          if (fs.default.existsSync(groupsPath)) {
            const raw = JSON.parse(fs.default.readFileSync(groupsPath, 'utf8'));
            groups = Array.isArray(raw) ? raw : (raw?.groups || []);
          }
        } catch (_) { /* ignore */ }
      }

      if (groups.length > 0) {
        inventory = await buildSyntheticTraysFromGroups(groups);
        logger.info(`[Sync] Built ${inventory.length} synthetic trays from ${groups.length} groups for farm ${farmId}`);
      }
    } else {
      logger.info(`[Sync] Retrieved ${inventory.length} inventory items from store for farm ${farmId}`);
    }
    
    res.json({ 
      success: true,
      inventory,
      trays: inventory,
      count: inventory.length,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error('[Sync] Error retrieving inventory:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to retrieve inventory',
      message: error.message 
    });
  }
});

/**
 * POST /api/sync/telemetry
 * Sync environmental sensor data from edge to cloud
 * Real-time sensor readings (temperature, humidity, CO2, etc.)
 */
router.post('/telemetry', authenticateFarm, async (req, res) => {
  try {
    const { farmId } = req;
    const { zones, sensors, timestamp } = req.body;
    
    if (!zones && !sensors) {
      return res.status(400).json({ 
        success: false,
        error: 'Telemetry data required (zones or sensors)' 
      });
    }
    
    const telemetryData = {
      zones: zones || [],
      sensors: sensors || {},
      timestamp: timestamp || new Date().toISOString()
    };
    
    logger.info(`[Sync] Syncing telemetry for farm ${farmId}: ${zones?.length || 0} zones`);
    
    if (await isDatabaseAvailable()) {
      // Store in database with upsert
      await query(
        `INSERT INTO farm_data (farm_id, data_type, data, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (farm_id, data_type) 
         DO UPDATE SET data = $3, updated_at = NOW()`,
        [farmId, 'telemetry', JSON.stringify(telemetryData)]
      );
      logger.info(`[Sync] Stored telemetry in database for farm ${farmId}`);
    } else {
      // Store in memory
      if (!inMemoryStore.telemetry) {
        inMemoryStore.telemetry = new Map();
      }
      inMemoryStore.telemetry.set(farmId, telemetryData);
      logger.info(`[Sync] Stored telemetry in memory for farm ${farmId}`);
    }
    
    // ALERT GENERATION: Evaluate telemetry and generate alerts
    try {
      await evaluateAndGenerateAlerts(farmId, telemetryData);
      await autoResolveAlerts(farmId, telemetryData);
    } catch (alertError) {
      logger.error(`[Sync] Error generating alerts for farm ${farmId}:`, alertError);
      // Don't fail the telemetry sync if alert generation fails
    }
    
    res.json({ 
      success: true,
      message: `Synced telemetry data for ${zones?.length || 0} zones`,
      farmId,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error('[Sync] Error syncing telemetry:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to sync telemetry',
      message: error.message 
    });
  }
});

/**
 * GET /api/sync/:farmId/devices
 * Retrieve IoT device list for a farm
 */
router.get('/:farmId/devices', authenticateFarm, async (req, res) => {
  try {
    const { farmId } = req.params;
    let devices = [];

    if (await isDatabaseAvailable()) {
      const result = await query(
        `SELECT data FROM farm_data WHERE farm_id = $1 AND data_type = 'devices'`,
        [farmId]
      );
      if (result.rows.length > 0 && result.rows[0].data) {
        const raw = result.rows[0].data;
        devices = Array.isArray(raw) ? raw : (raw.devices || []);
      }
    }

    // Fall back to in-memory store
    if (devices.length === 0 && inMemoryStore.devices) {
      devices = inMemoryStore.devices.get(farmId) || [];
    }

    // Fall back to synced iot-devices.json file
    if (devices.length === 0) {
      try {
        const fs = await import('fs');
        const path = await import('path');
        const devicesPath = path.default.join(process.cwd(), 'public', 'data', 'iot-devices.json');
        if (fs.default.existsSync(devicesPath)) {
          const raw = JSON.parse(fs.default.readFileSync(devicesPath, 'utf8'));
          devices = Array.isArray(raw) ? raw : (raw.devices || []);
        }
      } catch (_) { /* ignore */ }
    }

    res.json({
      success: true,
      farmId,
      devices,
      count: devices.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('[Sync] Error retrieving devices:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve devices',
      message: error.message
    });
  }
});

/**
 * GET /api/sync/:farmId/telemetry
 * Retrieve latest telemetry data for a farm
 */
router.get('/:farmId/telemetry', authenticateFarm, async (req, res) => {
  try {
    const { farmId } = req.params;
    
    let telemetryData = null;
    
    if (await isDatabaseAvailable()) {
      const result = await query(
        `SELECT data, updated_at FROM farm_data 
         WHERE farm_id = $1 AND data_type = $2`,
        [farmId, 'telemetry']
      );
      
      if (result.rows.length > 0) {
        telemetryData = result.rows[0].data;
        telemetryData.lastUpdated = result.rows[0].updated_at;
      }
    } else {
      // Retrieve from memory
      if (inMemoryStore.telemetry) {
        telemetryData = inMemoryStore.telemetry.get(farmId);
      }
    }
    
    if (!telemetryData) {
      return res.json({ 
        success: true,
        farmId,
        telemetry: { zones: [] },
        source: 'fallback',
        timestamp: new Date().toISOString()
      });
    }
    
    res.json({ 
      success: true,
      farmId,
      telemetry: telemetryData,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error('[Sync] Error retrieving telemetry:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to retrieve telemetry',
      message: error.message 
    });
  }
});

/**
 * POST /api/sync/restore
 * Trigger full data restore from cloud (called by edge device)
 * Uses authenticated farm ID from middleware
 */
router.post('/restore', authenticateFarm, async (req, res) => {
  try {
    const { farmId } = req;
    
    logger.info(`[Sync] Full restore requested for farm ${farmId}`);
    
    let rooms = [];
    let groups = [];
    
    if (await isDatabaseAvailable()) {
      // Retrieve rooms
      const roomsResult = await query(
        `SELECT data FROM farm_data 
         WHERE farm_id = $1 AND data_type = $2`,
        [farmId, 'rooms']
      );
      if (roomsResult.rows.length > 0) {
        rooms = roomsResult.rows[0].data;
      }
      
      // Retrieve groups
      const groupsResult = await query(
        `SELECT data FROM farm_data 
         WHERE farm_id = $1 AND data_type = $2`,
        [farmId, 'groups']
      );
      if (groupsResult.rows.length > 0) {
        groups = groupsResult.rows[0].data;
      }
      
      logger.info(`[Sync] Retrieved ${rooms.length} rooms, ${groups.length} groups from database for farm ${farmId}`);
    } else {
      // Retrieve from memory
      rooms = inMemoryStore.rooms.get(farmId) || [];
      groups = inMemoryStore.groups.get(farmId) || [];
      logger.info(`[Sync] Retrieved ${rooms.length} rooms, ${groups.length} groups from memory for farm ${farmId}`);
    }
    
    res.json({ 
      success: true,
      message: `Restored ${rooms.length} rooms, ${groups.length} groups`,
      data: {
        rooms,
        groups
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error('[Sync] Error during full restore:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to restore data',
      message: error.message 
    });
  }
});

/**
 * GET /api/sync/data/:farmId
 * Retrieve synced data for a farm (for recovery/debugging)
 */
router.get('/data/:farmId', authenticateFarm, async (req, res) => {
  try {
    const { farmId } = req.params;
    
    const data = {
      farmId,
      rooms: inMemoryStore.rooms.get(farmId) || [],
      groups: inMemoryStore.groups.get(farmId) || [],
      schedules: inMemoryStore.schedules.get(farmId) || [],
      inventory: inMemoryStore.inventory.get(farmId) || [],
      telemetry: inMemoryStore.telemetry.get(farmId) || null,
      timestamp: new Date().toISOString()
    };
    
    res.json(data);
    
  } catch (error) {
    logger.error('[Sync] Error retrieving farm data:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to retrieve farm data',
      message: error.message 
    });
  }
});

/**
 * POST /api/sync/restore/:farmId
 * Edge device recovery endpoint - restore data from Central backup
 * Phase 2: Durable Backup System
 */
router.post('/restore/:farmId', authenticateFarm, async (req, res) => {
  try {
    const { farmId } = req.params;
    
    // Verify requesting farm matches farmId param (security)
    if (req.farmId !== farmId) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden',
        message: 'Farm ID mismatch - can only restore own data'
      });
    }
    
    logger.info(`[Recovery] Restore request from farm ${farmId}`);
    
    if (await isDatabaseAvailable()) {
      // Fetch from farm_backups table
      const result = await query(
        `SELECT groups, rooms, schedules, config, last_synced 
         FROM farm_backups 
         WHERE farm_id = $1`,
        [farmId]
      );
      
      if (!result.rows || result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'No backup found',
          message: `No backup data found for farm ${farmId}. Farm may need to sync data first.`
        });
      }
      
      const backup = result.rows[0];
      const groups = backup.groups || [];
      const rooms = backup.rooms || [];
      const schedules = backup.schedules || [];
      
      logger.info(`[Recovery] Restored ${groups.length} groups, ${rooms.length} rooms, ${schedules.length} schedules for farm ${farmId}`);
      
      res.json({
        success: true,
        farmId,
        data: {
          groups,
          rooms,
          schedules,
          config: backup.config
        },
        backup_info: {
          last_synced: backup.last_synced,
          group_count: groups.length,
          room_count: rooms.length,
          schedule_count: schedules.length
        },
        restored_at: new Date().toISOString()
      });
      
    } else {
      // Fallback to in-memory
      const groups = inMemoryStore.groups.get(farmId) || [];
      const rooms = inMemoryStore.rooms.get(farmId) || [];
      const schedules = inMemoryStore.schedules.get(farmId) || [];
      
      if (groups.length === 0 && rooms.length === 0 && schedules.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'No backup found',
          message: `No backup data in memory for farm ${farmId}`
        });
      }
      
      logger.info(`[Recovery] Restored from memory: ${groups.length} groups, ${rooms.length} rooms, ${schedules.length} schedules for farm ${farmId}`);
      
      res.json({
        success: true,
        farmId,
        data: { groups, rooms, schedules },
        backup_info: {
          source: 'in-memory',
          group_count: groups.length,
          room_count: rooms.length,
          schedule_count: schedules.length
        },
        restored_at: new Date().toISOString()
      });
    }
    
  } catch (error) {
    logger.error('[Recovery] Error restoring farm data:', error);
    res.status(500).json({
      success: false,
      error: 'Recovery failed',
      message: error.message
    });
  }
});

/**
 * POST /api/sync/device-integrations
 * Receive anonymized device integration records from edge devices.
 * Part of Integration Assistant Phase 1 (Ticket I-1.9).
 * 
 * Records contain:
 * - farm_id_hash: pseudonymous farm hash (HMAC-SHA-256 preferred)
 * - farm_id_hash_legacy: optional legacy SHA-256 farm hash (migration support)
 * - farm_hash_version: optional version marker (e.g., hmac-sha256:v2)
 * - records: Array of integration records with device info, validation metrics, feedback
 * 
 * Data is stored in device_integrations table for network learning.
 */
router.post('/device-integrations', authenticateFarm, async (req, res) => {
  try {
    const { farmId } = req;
    const { farm_id_hash, farm_id_hash_legacy, farm_hash_version, records } = req.body;
    
    if (!Array.isArray(records)) {
      return res.status(400).json({
        success: false,
        error: 'records must be an array'
      });
    }
    
    if (records.length === 0) {
      return res.json({
        success: true,
        message: 'No records to sync',
        inserted: 0,
        timestamp: new Date().toISOString()
      });
    }
    
    // Validate we have a hash (privacy requirement)
    const hashToUse = farm_id_hash || (farmId ? 
      crypto.createHash('sha256').update(farmId).digest('hex') : null);
    
    if (!hashToUse) {
      return res.status(400).json({
        success: false,
        error: 'farm_id_hash is required for privacy'
      });
    }

    const legacyHash = farm_id_hash_legacy && farm_id_hash_legacy !== hashToUse
      ? farm_id_hash_legacy
      : null;
    
    logger.info(`[Sync] Receiving ${records.length} device integration record(s) for farm hash ${hashToUse.substring(0, 8)}... version=${farm_hash_version || 'unspecified'}`);
    
    if (!await isDatabaseAvailable()) {
      // Store in memory if no DB
      if (!inMemoryStore.integrations) inMemoryStore.integrations = new Map();
      const existing = inMemoryStore.integrations.get(hashToUse) || [];
      inMemoryStore.integrations.set(hashToUse, [...existing, ...records]);
      
      logger.info(`[Sync] Stored ${records.length} integration record(s) in memory for farm hash ${hashToUse.substring(0, 8)}...`);
      
      return res.json({
        success: true,
        message: `Stored ${records.length} integration record(s) in memory`,
        inserted: records.length,
        storage: 'memory',
        timestamp: new Date().toISOString()
      });
    }
    
    // Insert into device_integrations table
    let inserted = 0;
    let errors = 0;
    
    for (const record of records) {
      try {
        // Migration assist: if this record exists under legacy hash, move it to the new hash.
        if (legacyHash) {
          await query(
            `UPDATE device_integrations
             SET farm_id_hash = $1, updated_at = NOW()
             WHERE farm_id_hash = $2 AND record_id = $3`,
            [hashToUse, legacyHash, record.record_id]
          );
        }

        await query(
          `INSERT INTO device_integrations (
            farm_id_hash, record_id, device_type, device_make_model,
            driver_id, driver_version, protocol, capabilities,
            install_context, validation_passed, validation_signal_quality,
            validation_dropout_rate, validation_latency_ms,
            grower_feedback_rating, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
          ON CONFLICT (farm_id_hash, record_id) DO UPDATE SET
            validation_passed = EXCLUDED.validation_passed,
            validation_signal_quality = EXCLUDED.validation_signal_quality,
            validation_dropout_rate = EXCLUDED.validation_dropout_rate,
            validation_latency_ms = EXCLUDED.validation_latency_ms,
            grower_feedback_rating = EXCLUDED.grower_feedback_rating,
            updated_at = NOW()`,
          [
            hashToUse,
            record.record_id,
            record.device_type || null,
            record.device_make_model || null,
            record.driver_id || null,
            record.driver_version || null,
            record.protocol || null,
            JSON.stringify(record.capabilities || {}),
            JSON.stringify(record.install_context || {}),
            record.validation?.passed ?? null,
            record.validation?.signal_quality ?? null,
            record.validation?.dropout_rate ?? null,
            record.validation?.latency_ms ?? null,
            record.feedback?.rating ?? null,
            record.created_at || new Date().toISOString()
          ]
        );
        inserted++;
      } catch (err) {
        logger.warn(`[Sync] Failed to insert integration record ${record.record_id}:`, err.message);
        errors++;
      }
    }
    
    logger.info(`[Sync] Inserted ${inserted} device integration record(s) for farm hash ${hashToUse.substring(0, 8)}... (${errors} errors)`);
    
    res.json({
      success: true,
      message: `Synced ${inserted} integration record(s)`,
      inserted,
      errors,
      storage: 'database',
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error('[Sync] Error syncing device integrations:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to sync device integrations',
      message: error.message
    });
  }
});

export default router;
