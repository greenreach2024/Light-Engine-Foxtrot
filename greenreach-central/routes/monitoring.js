import express from 'express';
import { query } from '../config/database.js';
import { authMiddleware } from '../middleware/auth.js';
import logger from '../utils/logger.js';

const router = express.Router();

// GET /api/monitoring/dashboard - Get dashboard overview of all farms
router.get('/dashboard', authMiddleware, async (req, res, next) => {
  try {
    // Get farm counts by status
    const statusCounts = await query(`
      SELECT status, COUNT(*) as count
      FROM farms
      GROUP BY status
    `);

    // Get recent alerts
    const recentAlerts = await query(`
      SELECT 
        a.alert_id, a.farm_id, f.name as farm_name,
        a.alert_type, a.severity, a.title, a.message,
        a.status, a.created_at
      FROM farm_alerts a
      JOIN farms f ON a.farm_id = f.farm_id
      WHERE a.status = 'active'
      ORDER BY a.created_at DESC
      LIMIT 20
    `);

    // Get farms with critical health issues
    const criticalFarms = await query(`
      SELECT 
        f.farm_id, f.name, h.overall_status,
        h.cpu_usage, h.memory_usage, h.disk_usage,
        h.offline_devices, h.alert_count,
        h.last_heartbeat
      FROM farms f
      LEFT JOIN farm_health h ON f.farm_id = h.farm_id
      WHERE h.overall_status IN ('critical', 'warning', 'offline')
         OR f.last_heartbeat < NOW() - INTERVAL '10 minutes'
      ORDER BY 
        CASE h.overall_status
          WHEN 'critical' THEN 1
          WHEN 'offline' THEN 2
          WHEN 'warning' THEN 3
        END,
        h.last_heartbeat ASC
    `);

    // Get sync statistics
    const syncStats = await query(`
      SELECT 
        sync_type,
        COUNT(*) as total_syncs,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as successful,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
        AVG(duration_ms) as avg_duration
      FROM sync_logs
      WHERE created_at > NOW() - INTERVAL '24 hours'
      GROUP BY sync_type
    `);

    res.json({
      success: true,
      dashboard: {
        farmStatus: statusCounts.rows,
        recentAlerts: recentAlerts.rows,
        criticalFarms: criticalFarms.rows,
        syncStats: syncStats.rows,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    next(error);
  }
});

// GET /api/monitoring/farms/:id/health - Get farm health details
router.get('/farms/:id/health', authMiddleware, async (req, res, next) => {
  try {
    const { id } = req.params;

    const result = await query(`
      SELECT 
        h.*,
        f.name as farm_name,
        f.status as farm_status,
        f.last_heartbeat as farm_last_heartbeat
      FROM farm_health h
      JOIN farms f ON h.farm_id = f.farm_id
      WHERE h.farm_id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Health data not found'
      });
    }

    res.json({
      success: true,
      health: result.rows[0]
    });

  } catch (error) {
    next(error);
  }
});

// GET /api/monitoring/map - Get all farms for map view
router.get('/map', authMiddleware, async (req, res, next) => {
  try {
    const result = await query(`
      SELECT 
        f.farm_id, f.name, f.city, f.state,
        f.latitude, f.longitude, f.status,
        h.overall_status, h.alert_count,
        f.last_heartbeat
      FROM farms f
      LEFT JOIN farm_health h ON f.farm_id = h.farm_id
      WHERE f.latitude IS NOT NULL AND f.longitude IS NOT NULL
      ORDER BY f.name
    `);

    res.json({
      success: true,
      farms: result.rows
    });

  } catch (error) {
    next(error);
  }
});

export default router;
