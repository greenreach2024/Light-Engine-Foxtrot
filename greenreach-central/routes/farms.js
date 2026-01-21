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
router.post('/:farmId/heartbeat', express.json(), async (req, res, next) => {
  try {
    const { farmId } = req.params;
    const { cpu_usage, memory_usage, disk_usage, metadata } = req.body;
    
    // Use in-memory storage only
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
router.post('/register', express.json(), async (req, res, next) => {
  try {
    const { farmId, name, location, contact } = req.body;
    
    // Use in-memory storage only
    const now = new Date().toISOString();
    inMemoryFarms.set(farmId, {
      farm_id: farmId,
      name: name || farmId,
      status: 'online',
      last_heartbeat: now,
      metadata: { location, contact },
      created_at: now,
      updated_at: now
    });
    logger.info(`Farm registered (in-memory): ${farmId}`);
    
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
