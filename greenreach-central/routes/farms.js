/**
 * Farm Management Routes
 * Handles edge device farm registration, heartbeats, and status tracking
 */

import express from 'express';
import crypto from 'crypto';
import logger from '../utils/logger.js';
import { query, isDatabaseAvailable } from '../config/database.js';
import { getInMemoryGroups } from './sync.js';
import { upsertNetworkFarm } from '../services/networkFarmsStore.js';

const router = express.Router();

// In-memory storage (no database required)
const inMemoryFarms = new Map();
const inMemoryHeartbeats = [];

/**
 * GET /api/farms
 * List all farms
 */
router.get('/', async (req, res, next) => {
  try {
    // Query database for all farms
    const { query } = await import('../config/database.js');
    const result = await query(
      `SELECT farm_id, name, status, last_heartbeat, metadata 
       FROM farms 
       ORDER BY created_at DESC`
    );
    
    const farms = result.rows.map(farm => ({
      farmId: farm.farm_id,
      name: farm.name,
      status: farm.status,
      lastHeartbeat: farm.last_heartbeat,
      metadata: farm.metadata || {}
    }));
    
    res.json({ farms });
  } catch (error) {
    logger.error('Error listing farms:', error);
    next(error);
  }
});

/**
 * GET /api/farms/:farmId
 * Get farm details
 */
/**
 * POST /api/farms/:farmId/heartbeat
 * Receive heartbeat from edge device
 */
router.post('/:farmId/heartbeat', async (req, res, next) => {
  try {
    const { farmId } = req.params;
    const { cpu_usage, memory_usage, disk_usage, metadata } = req.body;
    
    const now = new Date().toISOString();
    const contactName = metadata?.contact?.name
      || metadata?.contactName
      || metadata?.contact_name
      || metadata?.name
      || metadata?.farm_name
      || farmId;
    
    // Generate secrets for new farms
    const jwtSecret = crypto.randomBytes(32).toString('hex');
    const apiKey = crypto.randomBytes(32).toString('hex');
    const apiSecret = crypto.randomBytes(32).toString('hex');
    const planType = metadata?.plan_type || metadata?.planType || 'edge';
    
    // Persist to database (required for farm_data FK)
    const { query } = await import('../config/database.js');
    
    // Extract api_url if present in metadata
    const heartbeatApiUrl = metadata?.api_url || metadata?.url || metadata?.edge_url || null;
    
    // Upsert farm (include api_url if provided)
    await query(
      `INSERT INTO farms (farm_id, name, contact_name, status, last_heartbeat, jwt_secret, api_key, api_secret, plan_type, api_url, metadata, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
       ON CONFLICT (farm_id) 
       DO UPDATE SET 
         status = $4,
         last_heartbeat = $5,
         jwt_secret = COALESCE(farms.jwt_secret, EXCLUDED.jwt_secret),
         api_key = COALESCE(farms.api_key, EXCLUDED.api_key),
         api_secret = COALESCE(farms.api_secret, EXCLUDED.api_secret),
         plan_type = COALESCE(EXCLUDED.plan_type, farms.plan_type, 'edge'),
         api_url = COALESCE(EXCLUDED.api_url, farms.api_url),
         metadata = EXCLUDED.metadata,
         name = COALESCE(EXCLUDED.name, farms.name),
         contact_name = COALESCE(EXCLUDED.contact_name, farms.contact_name),
         updated_at = NOW()`,
      [farmId, metadata?.name || farmId, contactName, 'active', now, jwtSecret, apiKey, apiSecret, planType, heartbeatApiUrl, JSON.stringify(metadata || {})]
    );
    
    // Store heartbeat
    await query(
      `INSERT INTO farm_heartbeats (farm_id, cpu_usage, memory_usage, disk_usage, metadata, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [farmId, cpu_usage, memory_usage, disk_usage, JSON.stringify(metadata || {}), now]
    );
    
    // Also keep in-memory for fast access
    inMemoryFarms.set(farmId, {
      farm_id: farmId,
      name: metadata?.name || farmId,
      status: 'active',
      last_heartbeat: now,
      metadata: metadata || {},
      updated_at: now
    });
    
    // Auto-register this farm in the wholesale network store
    // so the aggregator can fetch its inventory
    try {
      // Try to get api_url from: metadata, DB column, or construct from request IP
      let apiUrl = metadata?.api_url || metadata?.url || metadata?.edge_url || null;
      if (!apiUrl) {
        // Check DB for stored api_url
        const farmRow = await query('SELECT api_url FROM farms WHERE farm_id = $1', [farmId]);
        if (farmRow.rows[0]?.api_url) {
          apiUrl = farmRow.rows[0].api_url;
        }
      }
      // NOTE: Do NOT fall back to req.ip — behind NAT/load balancers it gives unreachable IPs

      
      if (apiUrl) {
        await upsertNetworkFarm(farmId, {
          name: metadata?.name || farmId,
          api_url: apiUrl,
          url: apiUrl,
          status: 'active',
          contact: metadata?.contact || {},
          location: metadata?.location || {}
        });
        logger.info(`[Heartbeat] Farm ${farmId} registered in wholesale network (${apiUrl})`);
      }
    } catch (networkErr) {
      // Non-fatal — don't break heartbeat flow
      logger.warn(`[Heartbeat] Failed to register farm ${farmId} in network store:`, networkErr.message);
    }
    
    logger.info(`Heartbeat received from ${farmId}: CPU=${cpu_usage}%, MEM=${memory_usage}%, DISK=${disk_usage}%`);
    
    res.json({
      success: true,
      farm: inMemoryFarms.get(farmId)
    });
  } catch (error) {
    logger.error('Error processing heartbeat:', error);
    next(error);
  }
});

/**
 * POST /api/farms/register
 * Register a new farm
 */
router.post('/register', async (req, res, next) => {
  try {
    const {
      farmId,
      name,
      location,
      contact,
      registration_code,
      farm_name,
      contact_email
    } = req.body;

    const now = new Date().toISOString();
    const { query } = await import('../config/database.js');

    const resolvedFarmId = farmId || registration_code;
    if (!resolvedFarmId) {
      return res.status(400).json({
        success: false,
        error: 'Missing farmId or registration_code'
      });
    }

    const resolvedName = name || farm_name || resolvedFarmId;

    const metadata = {
      location: location || {},
      contact: {
        ...(typeof contact === 'object' && contact ? contact : {}),
        ...(contact_email ? { email: contact_email } : {}),
        ...(farm_name ? { name: farm_name } : {})
      }
    };

    // Generate required security fields for new farms
    const jwtSecret = crypto.randomBytes(32).toString('hex');
    const apiKey = crypto.randomBytes(32).toString('hex');
    const apiSecret = crypto.randomBytes(32).toString('hex');

    // Persist to database
    await query(
      `INSERT INTO farms (farm_id, name, status, last_heartbeat, jwt_secret, api_key, api_secret, plan_type, metadata, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
       ON CONFLICT (farm_id) DO UPDATE SET
         name = EXCLUDED.name,
         metadata = EXCLUDED.metadata,
         jwt_secret = COALESCE(farms.jwt_secret, EXCLUDED.jwt_secret),
         api_key = COALESCE(farms.api_key, EXCLUDED.api_key),
         api_secret = COALESCE(farms.api_secret, EXCLUDED.api_secret),
         updated_at = NOW()`,
      [resolvedFarmId, resolvedName, 'active', now, jwtSecret, apiKey, apiSecret, 'edge', JSON.stringify(metadata)]
    );

    // Also keep in-memory
    inMemoryFarms.set(resolvedFarmId, {
      farm_id: resolvedFarmId,
      name: resolvedName,
      status: 'active',
      last_heartbeat: now,
      metadata,
      created_at: now,
      updated_at: now
    });

    logger.info(`Farm registered: ${resolvedFarmId}`);

    res.status(201).json({
      success: true,
      farmId: resolvedFarmId,
      message: 'Farm registered successfully'
    });
  } catch (error) {
    logger.error('Error registering farm:', error);
    next(error);
  }
});

/**
 * GET /api/farm/profile
 * Get authenticated user's farm profile
 * Requires JWT token with farm_id
 */
router.get('/profile', async (req, res, next) => {
  try {
    // Extract farm_id from JWT token
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No authorization token provided' });
    }

    const token = authHeader.substring(7);
    const jwt = await import('jsonwebtoken');
    const JWT_SECRET = process.env.JWT_SECRET || 'greenreach-jwt-secret-2025';
    
    let decoded;
    try {
      decoded = jwt.default.verify(token, JWT_SECRET);
    } catch (error) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const farmId = decoded.farm_id;
    if (!farmId) {
      return res.status(400).json({ error: 'No farm_id in token' });
    }

    // Query database for farm data
    const { query } = await import('../config/database.js');
    const result = await query(
      `SELECT farm_id, name, status, metadata, created_at
       FROM farms 
       WHERE farm_id = $1`,
      [farmId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Farm not found' });
    }

    const farm = result.rows[0];
    
    // Return farm profile in format expected by frontend
    res.json({
      status: 'success',
      farm: {
        farmId: farm.farm_id,
        name: farm.name,
        status: farm.status,
        metadata: farm.metadata || {},
        rooms: farm.metadata?.rooms || [],
        groups: farm.metadata?.groups || [],
        createdAt: farm.created_at
      }
    });
  } catch (error) {
    logger.error('Error fetching farm profile:', error);
    next(error);
  }
});

/**
 * GET /api/farm/activity/:farmId
 * Return recent activity for a farm (cloud)
 */
router.get('/activity/:farmId', async (req, res) => {
  try {
    const { farmId } = req.params;

    if (!farmId) {
      return res.status(400).json({
        status: 'error',
        message: 'Farm ID required'
      });
    }

    let activity = [];
    let dataAvailable = false;

    if (await isDatabaseAvailable()) {
      try {
        const result = await query(
          `SELECT action, resource_type, metadata, created_at
           FROM admin_audit_log
           WHERE resource_id = $1 OR metadata::text LIKE $2
           ORDER BY created_at DESC
           LIMIT 20`,
          [farmId, `%${farmId}%`]
        );

        activity = result.rows.map(row => ({
          timestamp: row.created_at,
          description: row.action || 'Activity event',
          user: row.metadata?.user || row.metadata?.email || 'System',
          status: 'active'
        }));

        dataAvailable = activity.length > 0;
      } catch (error) {
        logger.warn(`[Farm Activity] admin_audit_log unavailable: ${error.message}`);
      }
    }

    res.json({
      status: dataAvailable ? 'success' : 'unavailable',
      dataAvailable,
      activity
    });
  } catch (error) {
    logger.error('Error fetching farm activity:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch activity'
    });
  }
});

/**
 * GET /api/farms/:farmId/groups
 * Compatibility route (public read access)
 */
router.get('/:farmId/groups', async (req, res) => {
  try {
    const { farmId } = req.params;

    logger.info(`[Farms] Restoring groups for farm ${farmId}`);

    let groups = [];

    if (await isDatabaseAvailable()) {
      const result = await query(
        `SELECT data FROM farm_data 
         WHERE farm_id = $1 AND data_type = $2`,
        [farmId, 'groups']
      );

      if (result.rows.length > 0) {
        groups = result.rows[0].data;
      }

      logger.info(`[Farms] Retrieved ${groups.length} groups from database for farm ${farmId}`);
    } else {
      const inMemoryGroups = getInMemoryGroups();
      groups = inMemoryGroups.get(farmId) || [];
      logger.info(`[Farms] Retrieved ${groups.length} groups from memory for farm ${farmId}`);
    }

    res.json({
      success: true,
      groups,
      count: groups.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('[Farms] Error restoring groups:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to restore groups',
      message: error.message
    });
  }
});

/**
 * GET /api/farms/:farmId
 * Get farm details
 */
router.get('/:farmId', async (req, res, next) => {
  try {
    const { farmId } = req.params;

    // Query database for farm
    const { query } = await import('../config/database.js');
    const result = await query(
      `SELECT farm_id, name, status, last_heartbeat, metadata 
       FROM farms 
       WHERE farm_id = $1`,
      [farmId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Farm not found' });
    }

    const farm = result.rows[0];
    res.json({
      farmId: farm.farm_id,
      name: farm.name,
      status: farm.status,
      lastHeartbeat: farm.last_heartbeat,
      metadata: farm.metadata || {}
    });
  } catch (error) {
    logger.error('Error fetching farm:', error);
    next(error);
  }
});

export default router;
