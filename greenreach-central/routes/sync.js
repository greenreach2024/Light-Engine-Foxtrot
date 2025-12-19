import express from 'express';
import { query, getClient } from '../config/database.js';
import { ValidationError } from '../middleware/errorHandler.js';
import logger from '../utils/logger.js';

const router = express.Router();

// POST /api/sync/health - Sync health data from edge device
router.post('/health', async (req, res, next) => {
  try {
    const farmId = req.headers['x-farm-id'];
    const apiKey = req.headers['x-api-key'];
    
    if (!farmId || !apiKey) {
      throw new ValidationError('Farm ID and API key required');
    }

    // Verify farm and API key
    const farmCheck = await query(
      'SELECT farm_id FROM farms WHERE farm_id = $1 AND api_key = $2',
      [farmId, apiKey]
    );

    if (farmCheck.rows.length === 0) {
      throw new ValidationError('Invalid farm ID or API key');
    }

    const {
      overall_status,
      cpu_usage,
      memory_usage,
      disk_usage,
      active_devices,
      offline_devices,
      alert_count,
      avg_temperature,
      avg_humidity,
      avg_co2,
      uptime_seconds
    } = req.body;

    // Upsert health record
    await query(`
      INSERT INTO farm_health (
        farm_id, overall_status, 
        cpu_usage, memory_usage, disk_usage,
        active_devices, offline_devices, alert_count,
        avg_temperature, avg_humidity, avg_co2,
        uptime_seconds, last_heartbeat
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
      ON CONFLICT (farm_id) DO UPDATE SET
        overall_status = EXCLUDED.overall_status,
        cpu_usage = EXCLUDED.cpu_usage,
        memory_usage = EXCLUDED.memory_usage,
        disk_usage = EXCLUDED.disk_usage,
        active_devices = EXCLUDED.active_devices,
        offline_devices = EXCLUDED.offline_devices,
        alert_count = EXCLUDED.alert_count,
        avg_temperature = EXCLUDED.avg_temperature,
        avg_humidity = EXCLUDED.avg_humidity,
        avg_co2 = EXCLUDED.avg_co2,
        uptime_seconds = EXCLUDED.uptime_seconds,
        last_heartbeat = NOW(),
        updated_at = NOW()
    `, [
      farmId, overall_status,
      cpu_usage, memory_usage, disk_usage,
      active_devices, offline_devices, alert_count,
      avg_temperature, avg_humidity, avg_co2,
      uptime_seconds
    ]);

    // Update farm heartbeat
    await query(
      'UPDATE farms SET last_heartbeat = NOW() WHERE farm_id = $1',
      [farmId]
    );

    logger.info('Health data synced', { farmId });

    res.json({
      success: true,
      message: 'Health data synced successfully'
    });

  } catch (error) {
    next(error);
  }
});

// POST /api/sync/alerts - Sync alerts from edge device
router.post('/alerts', async (req, res, next) => {
  try {
    const farmId = req.headers['x-farm-id'];
    const apiKey = req.headers['x-api-key'];
    
    if (!farmId || !apiKey) {
      throw new ValidationError('Farm ID and API key required');
    }

    // Verify farm and API key
    const farmCheck = await query(
      'SELECT farm_id FROM farms WHERE farm_id = $1 AND api_key = $2',
      [farmId, apiKey]
    );

    if (farmCheck.rows.length === 0) {
      throw new ValidationError('Invalid farm ID or API key');
    }

    const { alerts } = req.body;
    
    if (!Array.isArray(alerts)) {
      throw new ValidationError('Alerts must be an array');
    }

    let insertedCount = 0;

    for (const alert of alerts) {
      await query(`
        INSERT INTO farm_alerts (
          farm_id, alert_type, severity, title, message,
          source, metadata, status, notified
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', false)
      `, [
        farmId,
        alert.alert_type,
        alert.severity,
        alert.title,
        alert.message,
        alert.source,
        JSON.stringify(alert.metadata || {})
      ]);
      insertedCount++;
    }

    logger.info('Alerts synced', { farmId, count: insertedCount });

    res.json({
      success: true,
      message: 'Alerts synced successfully',
      count: insertedCount
    });

  } catch (error) {
    next(error);
  }
});

export default router;
