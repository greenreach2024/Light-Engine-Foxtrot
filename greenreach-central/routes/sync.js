/**
 * Sync Routes
 * Handles edge-to-cloud data synchronization
 * 
 * Authentication: Uses farm API keys (X-API-Key header)
 * Data Flow: Edge devices push updates to cloud
 */

import express from 'express';
import logger from '../utils/logger.js';
import { evaluateAndGenerateAlerts, autoResolveAlerts } from '../services/alert-manager.js';
import { query, isDatabaseAvailable } from '../config/database.js';

const router = express.Router();

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
 * Middleware: Authenticate farm device via API key
 */
function authenticateFarm(req, res, next) {
  const apiKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');
  const farmId = req.headers['x-farm-id'] || req.body?.farmId;
  
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
      message: 'Include X-Farm-ID header or farmId in request body' 
    });
  }
  
  // Validate API key format (64-char hex)
  if (!/^[a-f0-9]{64}$/.test(apiKey)) {
    return res.status(401).json({ 
      success: false,
      error: 'Invalid API key format' 
    });
  }
  
  // In production, validate against database
  // For now, accept valid-format keys
  req.farmId = farmId;
  req.apiKey = apiKey;
  req.authenticated = true;
  
  logger.info(`[Sync] Authenticated farm: ${farmId}`);
  next();
}

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
    
    if (await isDatabaseAvailable()) {
      // Just store the data - don't auto-register farm (has required fields)
      // Farm must already exist in database
      
      // Store in database
      await query(
        `INSERT INTO farm_data (farm_id, data_type, data, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (farm_id, data_type) 
         DO UPDATE SET data = $3, updated_at = NOW()`,
        [farmId, 'rooms', JSON.stringify(rooms)]
      );
      
      logger.info(`[Sync] Saved ${rooms.length} rooms to database for farm ${farmId}`);
    } else {
      // Store in-memory
      inMemoryStore.rooms.set(farmId, rooms);
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
    
    if (await isDatabaseAvailable()) {
      // Just store the data - don't auto-register farm (has required fields)
      // Farm must already exist in database
      
      // Store in database
      await query(
        `INSERT INTO farm_data (farm_id, data_type, data, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (farm_id, data_type) 
         DO UPDATE SET data = $3, updated_at = NOW()`,
        [farmId, 'groups', JSON.stringify(groups)]
      );
      
      logger.info(`[Sync] Saved ${groups.length} groups to database for farm ${farmId}`);
    } else {
      // Store in-memory
      inMemoryStore.groups.set(farmId, groups);
      logger.info(`[Sync] Saved ${groups.length} groups to memory for farm ${farmId}`);
    }
    
    res.json({ 
      success: true,
      message: `Synced ${groups.length} groups`,
      farmId,
      count: groups.length,
      timestamp: new Date().toISOString()
    });
    
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
    
    if (await isDatabaseAvailable()) {
      // Store in database
      await query(
        `INSERT INTO farm_data (farm_id, data_type, data, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (farm_id, data_type) 
         DO UPDATE SET data = $3, updated_at = NOW()`,
        [farmId, 'schedules', JSON.stringify(schedules)]
      );
      
      logger.info(`[Sync] Saved ${schedules.length} schedules to database for farm ${farmId}`);
    } else {
      // Store in-memory
      inMemoryStore.schedules.set(farmId, schedules);
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
 * POST /api/sync/inventory
 * Sync inventory/product data from edge to cloud
 */
router.post('/inventory', authenticateFarm, async (req, res) => {
  try {
    const { farmId } = req;
    const { products } = req.body;
    
    if (!Array.isArray(products)) {
      return res.status(400).json({ 
        success: false,
        error: 'Products must be an array' 
      });
    }
    
    logger.info(`[Sync] Syncing ${products.length} products for farm ${farmId}`);
    
    if (await isDatabaseAvailable()) {
      // Upsert each product into products table
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
      
      logger.info(`[Sync] Saved ${products.length} products to database for farm ${farmId}`);
    } else {
      // Store in-memory
      inMemoryStore.inventory.set(farmId, products);
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
      const planType = metadata?.plan_type || metadata?.planType || 'free';
      const apiKeyValue = req.apiKey; // From authenticateFarm middleware
      const apiSecret = metadata?.api_secret || metadata?.apiSecret || 'auto-generated';
      
      // Upsert farm - production schema discovered via error messages
      // Required fields: farm_id, name, contact_name, plan_type, api_key, api_secret
      await query(
        `INSERT INTO farms (farm_id, name, contact_name, plan_type, api_key, api_secret, status, last_heartbeat, metadata, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8, NOW(), NOW())
         ON CONFLICT (farm_id) 
         DO UPDATE SET 
           status = EXCLUDED.status,
           name = COALESCE(EXCLUDED.name, farms.name),
           contact_name = COALESCE(EXCLUDED.contact_name, farms.contact_name),
           plan_type = COALESCE(EXCLUDED.plan_type, farms.plan_type),
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
 * GET /api/sync/:farmId/rooms
 * Retrieve rooms data for a farm (public read access)
 */
router.get('/:farmId/rooms', async (req, res) => {
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
        rooms = result.rows[0].data;
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
router.get('/:farmId/groups', async (req, res) => {
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
        groups = result.rows[0].data;
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
 * GET /api/sync/:farmId/inventory
 * Retrieve inventory (trays) data for a farm (public read access)
 */
router.get('/:farmId/inventory', async (req, res) => {
  try {
    const { farmId } = req.params;
    
    logger.info(`[Sync] Retrieving inventory for farm ${farmId}`);
    
    let inventory = [];
    
    if (await isDatabaseAvailable()) {
      // Retrieve from database
      const result = await query(
        `SELECT data FROM farm_data 
         WHERE farm_id = $1 AND data_type = $2`,
        [farmId, 'inventory']
      );
      
      if (result.rows.length > 0) {
        inventory = result.rows[0].data;
      }
      
      logger.info(`[Sync] Retrieved ${inventory.length} inventory items from database for farm ${farmId}`);
    } else {
      // Retrieve from memory
      inventory = inMemoryStore.inventory?.get(farmId) || [];
      logger.info(`[Sync] Retrieved ${inventory.length} inventory items from memory for farm ${farmId}`);
    }
    
    res.json({ 
      success: true,
      inventory,
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
 * GET /api/sync/:farmId/telemetry
 * Retrieve latest telemetry data for a farm
 */
router.get('/:farmId/telemetry', async (req, res) => {
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
      return res.status(404).json({ 
        success: false,
        error: 'No telemetry data found for this farm' 
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

export default router;
