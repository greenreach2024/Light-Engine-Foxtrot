/**
 * Farm Management Routes
 * Handles edge device farm registration, heartbeats, and status tracking
 */

import express from 'express';
import crypto from 'crypto';
import logger from '../utils/logger.js';

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
    
    // Generate jwt_secret and extract plan_type
    const jwtSecret = crypto.randomBytes(32).toString('hex');
    const planType = metadata?.plan_type || metadata?.planType || 'edge';
    
    // Persist to database (required for farm_data FK)
    const { query } = await import('../config/database.js');
    
    // Upsert farm
    await query(
      `INSERT INTO farms (farm_id, name, contact_name, status, last_heartbeat, jwt_secret, plan_type, metadata, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
       ON CONFLICT (farm_id) 
       DO UPDATE SET 
         status = $4,
         last_heartbeat = $5,
         jwt_secret = COALESCE(farms.jwt_secret, EXCLUDED.jwt_secret),
         plan_type = COALESCE(EXCLUDED.plan_type, farms.plan_type, 'edge'),
         metadata = EXCLUDED.metadata,
         name = COALESCE(EXCLUDED.name, farms.name),
         contact_name = COALESCE(EXCLUDED.contact_name, farms.contact_name),
         updated_at = NOW()`,
      [farmId, metadata?.name || farmId, contactName, 'online', now, jwtSecret, planType, JSON.stringify(metadata || {})]
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
      status: 'online',
      last_heartbeat: now,
      metadata: metadata || {},
      updated_at: now
    });
    
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

    // Persist to database
    await query(
      `INSERT INTO farms (farm_id, name, status, last_heartbeat, metadata, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
       ON CONFLICT (farm_id) DO UPDATE SET
         name = EXCLUDED.name,
         metadata = EXCLUDED.metadata,
         updated_at = NOW()`,
      [resolvedFarmId, resolvedName, 'online', now, JSON.stringify(metadata)]
    );

    // Also keep in-memory
    inMemoryFarms.set(resolvedFarmId, {
      farm_id: resolvedFarmId,
      name: resolvedName,
      status: 'online',
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

export default router;
