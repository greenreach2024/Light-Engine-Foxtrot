/**
 * Farm Management Routes
 * Handles edge device farm registration, heartbeats, and status tracking
 */

import express from 'express';
import { query } from '../config/database.js';
import logger from '../utils/logger.js';

const router = express.Router();

// In-memory fallback storage when database is unavailable
const inMemoryFarms = new Map();
const inMemoryHeartbeats = [];

// Helper to check if database is available
function isDatabaseAvailable(req) {
  return req.app.locals.databaseReady === true;
}

/**
 * GET /api/farms
 * List all farms
 */
router.get('/', async (req, res, next) => {
  try {
    if (!isDatabaseAvailable(req)) {
      // Use in-memory storage
      const farms = Array.from(inMemoryFarms.values()).map(farm => ({
        farmId: farm.farm_id,
        name: farm.name,
        status: farm.status,
        lastHeartbeat: farm.last_heartbeat,
        metadata: farm.metadata || {}
      }));
      return res.json({ farms });
    }
    
    const result = await query(
      `SELECT * FROM farms ORDER BY name ASC`
    );
    
    const farms = result.rows.map(farm => ({
      farmId: farm.farm_id,
      name: farm.name,
      status: farm.status,
      lastHeartbeat: farm.last_heartbeat,
      metadata: farm.metadata ? JSON.parse(farm.metadata) : {}
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
    
    if (!isDatabaseAvailable(req)) {
      // Use in-memory storage
      const farm = inMemoryFarms.get(farmId);
      if (!farm) {
        return res.status(404).json({ error: 'Farm not found' });
      }
      return res.json({
        farmId: farm.farm_id,
        name: farm.name,
        status: farm.status,
        lastHeartbeat: farm.last_heartbeat,
        metadata: farm.metadata || {}
      });
    }
    
    const result = await query(
      `SELECT * FROM farms WHERE farm_id = $1`,
      [farmId]
    );
    
    const farm = result.rows[0];
    
    if (!farm) {
      return res.status(404).json({ error: 'Farm not found' });
    }
    
    res.json({
      farmId: farm.farm_id,
      name: farm.name,
      status: farm.status,
      lastHeartbeat: farm.last_heartbeat,
      metadata: farm.metadata ? JSON.parse(farm.metadata) : {}
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
router.post('/:farmId/heartbeat', express.json(), async (req, res, next) => {
  try {
    const { farmId } = req.params;
    const { cpu_usage, memory_usage, disk_usage, metadata } = req.body;
    
    if (!isDatabaseAvailable(req)) {
      // Use in-memory storage
      const existingFarm = inMemoryFarms.get(farmId);
      const now = new Date().toISOString();
      
      if (!existingFarm) {
        // Auto-register farm
        inMemoryFarms.set(farmId, {
          farm_id: farmId,
          name: metadata?.name || farmId,
          status: 'online',
          last_heartbeat: now,
          metadata: metadata || {},
          created_at: now,
          updated_at: now
        });
        logger.info(`Auto-registered farm (in-memory): ${farmId}`);
      } else {
        // Update existing
        existingFarm.last_heartbeat = now;
        existingFarm.status = 'online';
        existingFarm.metadata = { ...existingFarm.metadata, ...(metadata || {}) };
        existingFarm.updated_at = now;
      }
      
      // Store heartbeat
      inMemoryHeartbeats.push({
        farm_id: farmId,
        cpu_usage,
        memory_usage,
        disk_usage,
        metadata,
        timestamp: now
      });
      
      // Keep only last 1000 heartbeats
      if (inMemoryHeartbeats.length > 1000) {
        inMemoryHeartbeats.shift();
      }
      
      return res.json({
        success: true,
        farm: inMemoryFarms.get(farmId)
      });
    }
    
    // Check if farm exists
    const existingFarm = await query(
      `SELECT farm_id FROM farms WHERE farm_id = $1`,
      [farmId]
    );
    
    if (existingFarm.rows.length === 0) {
      // Auto-register farm on first heartbeat
      await query(
        `INSERT INTO farms (farm_id, name, status, last_heartbeat, metadata) 
         VALUES ($1, $2, $3, $4, $5)`,
        [farmId, farmId, 'online', new Date().toISOString(), JSON.stringify(metadata || {})]
      );
      logger.info(`Auto-registered farm: ${farmId}`);
    } else {
      // Update existing farm
      await query(
        `UPDATE farms SET 
          last_heartbeat = $1,
          status = 'online',
          metadata = $2,
          updated_at = NOW()
        WHERE farm_id = $3`,
        [new Date().toISOString(), JSON.stringify(metadata || {}), farmId]
      );
    }
    
    // Store heartbeat metrics
    await query(
      `INSERT INTO farm_heartbeats (farm_id, cpu_usage, memory_usage, disk_usage, timestamp)
       VALUES ($1, $2, $3, $4, $5)`,
      [farmId, cpu_usage, memory_usage, disk_usage, new Date().toISOString()]
    );
    
    logger.info(`Heartbeat received from ${farmId}: CPU=${cpu_usage}%, MEM=${memory_usage}%, DISK=${disk_usage}%`);
    
    res.json({
      success: true,
      message: 'Heartbeat received',
      farmId,
      timestamp: new Date().toISOString()
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
router.post('/register', express.json(), async (req, res, next) => {
  try {
    const { farmId, name, location, contact } = req.body;
    
    // Check if farm already exists
    const existing = await query(
      `SELECT farm_id FROM farms WHERE farm_id = $1`,
      [farmId]
    );
    
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Farm already registered' });
    }
    
    await query(
      `INSERT INTO farms (farm_id, name, status, last_heartbeat, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        farmId,
        name || farmId,
        'online',
        new Date().toISOString(),
        JSON.stringify({ location, contact })
      ]
    );
    
    logger.info(`Farm registered: ${farmId}`);
    
    res.status(201).json({
      success: true,
      farmId,
      message: 'Farm registered successfully'
    });
  } catch (error) {
    logger.error('Error registering farm:', error);
    next(error);
  }
});

export default router;
