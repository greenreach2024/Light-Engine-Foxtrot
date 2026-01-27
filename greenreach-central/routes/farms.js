/**
 * Farm Management Routes
 * Handles edge device farm registration, heartbeats, and status tracking
 */

import express from 'express';
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
    // Try in-memory first, then database
    const farms = Array.from(inMemoryFarms.values()).map(farm => ({
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
    
    // Use in-memory storage only
    const farm = inMemoryFarms.get(farmId);
    if (!farm) {
      return res.status(404).json({ error: 'Farm not found' });
    }
    
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
    
    // Persist to database (required for farm_data FK)
    const { query } = await import('../config/database.js');
    
    // Upsert farm
    await query(
      `INSERT INTO farms (farm_id, name, status, last_heartbeat, metadata, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (farm_id) 
       DO UPDATE SET 
         status = $3,
         last_heartbeat = $4,
         metadata = EXCLUDED.metadata,
         updated_at = NOW()`,
      [farmId, metadata?.name || farmId, 'online', now, JSON.stringify(metadata || {})]
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
    const { farmId, name, location, contact } = req.body;
    
    const now = new Date().toISOString();
    const { query } = await import('../config/database.js');
    
    // Persist to database
    await query(
      `INSERT INTO farms (farm_id, name, status, last_heartbeat, metadata, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
       ON CONFLICT (farm_id) DO NOTHING`,
      [farmId, name || farmId, 'online', now, JSON.stringify({ location, contact })]
    );
    
    // Also keep in-memory
    inMemoryFarms.set(farmId, {
      farm_id: farmId,
      name: name || farmId,
      status: 'online',
      last_heartbeat: now,
      metadata: { location, contact },
      created_at: now,
      updated_at: now
    });
    
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
