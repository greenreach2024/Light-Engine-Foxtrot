/**
 * Farm Management Routes
 * Handles edge device farm registration, heartbeats, and status tracking
 */

import express from 'express';
import { query } from '../config/database.js';
import logger from '../utils/logger.js';

const router = express.Router();

/**
 * GET /api/farms/:farmId
 * Get farm details
 */
router.get('/:farmId', async (req, res, next) => {
  try {
    const { farmId } = req.params;
    
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
