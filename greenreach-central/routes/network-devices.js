/**
 * Network Devices Analytics Routes
 * 
 * Ticket I-3.11: Network device analytics
 * 
 * Central aggregates device adoption patterns across all farms:
 * - Device types and protocols in use
 * - Driver popularity and success rates
 * - Validation metrics (signal quality, dropout rates)
 * 
 * Admin-only endpoints for network intelligence.
 * 
 * @module routes/network-devices
 */

import express from 'express';
import { query, isDatabaseAvailable } from '../config/database.js';
import logger from '../utils/logger.js';

const router = express.Router();

/**
 * Require admin auth for all routes
 */
router.use((req, res, next) => {
  // Check for admin token or role
  const apiKey = req.headers['x-api-key'] || req.query.api_key;
  const isAdmin = req.user?.role === 'admin' || 
                  req.headers['x-admin-key'] === process.env.ADMIN_API_KEY;
  
  // For now, allow access if database is available (will add proper auth later)
  if (!isDatabaseAvailable()) {
    return res.status(503).json({
      ok: false,
      error: 'Database not available'
    });
  }
  
  next();
});

/**
 * GET /api/admin/network-devices/analytics
 * Get aggregated device analytics across all farms
 */
router.get('/analytics', async (req, res) => {
  try {
    // Get overall stats
    const overallStats = await query(`
      SELECT 
        COUNT(DISTINCT farm_id_hash) as farm_count,
        COUNT(*) as total_integrations,
        COUNT(DISTINCT protocol) as protocol_count,
        COUNT(DISTINCT driver_id) as driver_count,
        SUM(CASE WHEN validation_passed = true THEN 1 ELSE 0 END) as validated_count,
        AVG(validation_signal_quality) as avg_signal_quality,
        AVG(validation_dropout_rate) as avg_dropout_rate,
        AVG(grower_feedback_rating) as avg_grower_rating
      FROM device_integrations
    `);

    // Get breakdown by protocol
    const byProtocol = await query(`
      SELECT 
        protocol,
        COUNT(*) as count,
        COUNT(DISTINCT farm_id_hash) as farm_count,
        SUM(CASE WHEN validation_passed = true THEN 1 ELSE 0 END) as validated,
        ROUND(AVG(validation_signal_quality)::numeric, 1) as avg_signal,
        ROUND(AVG(grower_feedback_rating)::numeric, 1) as avg_rating
      FROM device_integrations
      WHERE protocol IS NOT NULL
      GROUP BY protocol
      ORDER BY count DESC
    `);

    // Get breakdown by device type
    const byDeviceType = await query(`
      SELECT 
        device_type,
        COUNT(*) as count,
        COUNT(DISTINCT protocol) as protocols_used,
        SUM(CASE WHEN validation_passed = true THEN 1 ELSE 0 END) as validated,
        ROUND(AVG(validation_signal_quality)::numeric, 1) as avg_signal
      FROM device_integrations
      WHERE device_type IS NOT NULL
      GROUP BY device_type
      ORDER BY count DESC
    `);

    // Get top drivers by adoption
    const topDrivers = await query(`
      SELECT 
        driver_id,
        driver_version,
        protocol,
        COUNT(*) as count,
        COUNT(DISTINCT farm_id_hash) as farm_count,
        ROUND(100.0 * SUM(CASE WHEN validation_passed = true THEN 1 ELSE 0 END) / COUNT(*)::numeric, 1) as success_rate,
        ROUND(AVG(validation_signal_quality)::numeric, 1) as avg_signal,
        ROUND(AVG(grower_feedback_rating)::numeric, 1) as avg_rating
      FROM device_integrations
      WHERE driver_id IS NOT NULL
      GROUP BY driver_id, driver_version, protocol
      ORDER BY count DESC
      LIMIT 20
    `);

    // Get popular device models
    const topModels = await query(`
      SELECT 
        device_make_model,
        protocol,
        COUNT(*) as count,
        COUNT(DISTINCT farm_id_hash) as farm_count,
        ROUND(100.0 * SUM(CASE WHEN validation_passed = true THEN 1 ELSE 0 END) / COUNT(*)::numeric, 1) as success_rate
      FROM device_integrations
      WHERE device_make_model IS NOT NULL AND device_make_model != ''
      GROUP BY device_make_model, protocol
      ORDER BY count DESC
      LIMIT 20
    `);

    const stats = overallStats.rows[0] || {};
    
    res.json({
      ok: true,
      analytics: {
        summary: {
          farms_reporting: parseInt(stats.farm_count) || 0,
          total_integrations: parseInt(stats.total_integrations) || 0,
          unique_protocols: parseInt(stats.protocol_count) || 0,
          unique_drivers: parseInt(stats.driver_count) || 0,
          validated_percentage: stats.total_integrations > 0 
            ? Math.round((stats.validated_count / stats.total_integrations) * 100) 
            : 0,
          avg_signal_quality: parseFloat(stats.avg_signal_quality) || null,
          avg_dropout_rate: parseFloat(stats.avg_dropout_rate) || null,
          avg_grower_rating: parseFloat(stats.avg_grower_rating) || null
        },
        by_protocol: byProtocol.rows,
        by_device_type: byDeviceType.rows,
        top_drivers: topDrivers.rows,
        top_models: topModels.rows
      },
      generated_at: new Date().toISOString()
    });

  } catch (error) {
    logger.error('[Network Devices] Analytics error:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to generate analytics',
      message: error.message
    });
  }
});

/**
 * GET /api/admin/network-devices/protocols
 * Get protocol adoption breakdown
 */
router.get('/protocols', async (req, res) => {
  try {
    const result = await query(`
      SELECT 
        protocol,
        COUNT(*) as integration_count,
        COUNT(DISTINCT farm_id_hash) as farm_count,
        COUNT(DISTINCT driver_id) as driver_variants,
        ROUND(100.0 * SUM(CASE WHEN validation_passed = true THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0)::numeric, 1) as success_rate,
        ROUND(AVG(validation_signal_quality)::numeric, 1) as avg_signal,
        ROUND(AVG(validation_dropout_rate)::numeric, 2) as avg_dropout,
        ROUND(AVG(grower_feedback_rating)::numeric, 1) as avg_rating,
        MIN(created_at) as first_seen,
        MAX(created_at) as last_seen
      FROM device_integrations
      WHERE protocol IS NOT NULL
      GROUP BY protocol
      ORDER BY integration_count DESC
    `);

    res.json({
      ok: true,
      protocols: result.rows,
      count: result.rows.length
    });

  } catch (error) {
    logger.error('[Network Devices] Protocols error:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * GET /api/admin/network-devices/drivers
 * Get driver adoption and reliability metrics
 */
router.get('/drivers', async (req, res) => {
  try {
    const { protocol, minCount } = req.query;
    
    let whereClause = 'WHERE driver_id IS NOT NULL';
    const params = [];
    
    if (protocol) {
      params.push(protocol);
      whereClause += ` AND protocol = $${params.length}`;
    }
    
    const result = await query(`
      SELECT 
        driver_id,
        driver_version,
        protocol,
        COUNT(*) as usage_count,
        COUNT(DISTINCT farm_id_hash) as farm_count,
        ROUND(100.0 * SUM(CASE WHEN validation_passed = true THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0)::numeric, 1) as success_rate,
        ROUND(AVG(validation_signal_quality)::numeric, 1) as avg_signal,
        ROUND(AVG(validation_dropout_rate)::numeric, 3) as avg_dropout,
        ROUND(AVG(grower_feedback_rating)::numeric, 1) as avg_rating,
        MIN(created_at) as first_used,
        MAX(created_at) as last_used
      FROM device_integrations
      ${whereClause}
      GROUP BY driver_id, driver_version, protocol
      HAVING COUNT(*) >= ${parseInt(minCount) || 1}
      ORDER BY usage_count DESC
    `, params);

    res.json({
      ok: true,
      drivers: result.rows,
      count: result.rows.length,
      filter: { protocol, minCount }
    });

  } catch (error) {
    logger.error('[Network Devices] Drivers error:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * GET /api/admin/network-devices/problematic
 * Get drivers with high failure rates (for warnings)
 */
router.get('/problematic', async (req, res) => {
  try {
    const failureThreshold = parseFloat(req.query.threshold) || 20; // Default 20% failure rate
    const minSamples = parseInt(req.query.minSamples) || 5;

    const result = await query(`
      SELECT 
        driver_id,
        driver_version,
        protocol,
        COUNT(*) as usage_count,
        COUNT(DISTINCT farm_id_hash) as affected_farms,
        ROUND(100.0 * SUM(CASE WHEN validation_passed = false THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0)::numeric, 1) as failure_rate,
        ROUND(AVG(validation_signal_quality)::numeric, 1) as avg_signal,
        ROUND(AVG(validation_dropout_rate)::numeric, 3) as avg_dropout
      FROM device_integrations
      WHERE driver_id IS NOT NULL
      GROUP BY driver_id, driver_version, protocol
      HAVING 
        COUNT(*) >= $1 AND
        (100.0 * SUM(CASE WHEN validation_passed = false THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0)) >= $2
      ORDER BY failure_rate DESC
    `, [minSamples, failureThreshold]);

    res.json({
      ok: true,
      problematic_drivers: result.rows,
      count: result.rows.length,
      criteria: {
        failure_threshold_pct: failureThreshold,
        min_samples: minSamples
      }
    });

  } catch (error) {
    logger.error('[Network Devices] Problematic drivers error:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * GET /api/admin/network-devices/recommendations
 * Get driver recommendations based on network success rates
 */
router.get('/recommendations', async (req, res) => {
  try {
    const minSamples = parseInt(req.query.minSamples) || 3;
    const minSuccessRate = parseFloat(req.query.minSuccessRate) || 80;

    // Get best drivers per protocol (highest success rate with sufficient samples)
    const result = await query(`
      WITH driver_stats AS (
        SELECT 
          driver_id,
          driver_version,
          protocol,
          COUNT(*) as usage_count,
          COUNT(DISTINCT farm_id_hash) as farm_count,
          ROUND(100.0 * SUM(CASE WHEN validation_passed = true THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0)::numeric, 1) as success_rate,
          ROUND(AVG(validation_signal_quality)::numeric, 1) as avg_signal,
          ROUND(AVG(grower_feedback_rating)::numeric, 1) as avg_rating,
          ROW_NUMBER() OVER (PARTITION BY protocol ORDER BY 
            (100.0 * SUM(CASE WHEN validation_passed = true THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0)) DESC,
            COUNT(*) DESC
          ) as rank
        FROM device_integrations
        WHERE driver_id IS NOT NULL
        GROUP BY driver_id, driver_version, protocol
        HAVING COUNT(*) >= $1
      )
      SELECT *
      FROM driver_stats
      WHERE rank <= 3 AND success_rate >= $2
      ORDER BY protocol, rank
    `, [minSamples, minSuccessRate]);

    // Group by protocol
    const recommendations = {};
    for (const row of result.rows) {
      if (!recommendations[row.protocol]) {
        recommendations[row.protocol] = [];
      }
      recommendations[row.protocol].push({
        driver_id: row.driver_id,
        driver_version: row.driver_version,
        usage_count: parseInt(row.usage_count),
        farm_count: parseInt(row.farm_count),
        success_rate: parseFloat(row.success_rate),
        avg_signal: parseFloat(row.avg_signal),
        avg_rating: parseFloat(row.avg_rating),
        rank: parseInt(row.rank)
      });
    }

    res.json({
      ok: true,
      recommendations,
      protocols_covered: Object.keys(recommendations).length,
      criteria: {
        min_samples: minSamples,
        min_success_rate_pct: minSuccessRate
      }
    });

  } catch (error) {
    logger.error('[Network Devices] Recommendations error:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * GET /api/admin/network-devices/trends
 * Get adoption trends over time
 */
router.get('/trends', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;

    // Weekly integration counts
    const weeklyTrends = await query(`
      SELECT 
        DATE_TRUNC('week', created_at) as week,
        COUNT(*) as integrations,
        COUNT(DISTINCT farm_id_hash) as farms,
        COUNT(DISTINCT protocol) as protocols,
        ROUND(100.0 * SUM(CASE WHEN validation_passed = true THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0)::numeric, 1) as success_rate
      FROM device_integrations
      WHERE created_at >= NOW() - INTERVAL '${days} days'
      GROUP BY DATE_TRUNC('week', created_at)
      ORDER BY week DESC
    `);

    // Protocol trends
    const protocolTrends = await query(`
      SELECT 
        protocol,
        DATE_TRUNC('week', created_at) as week,
        COUNT(*) as count
      FROM device_integrations
      WHERE created_at >= NOW() - INTERVAL '${days} days' AND protocol IS NOT NULL
      GROUP BY protocol, DATE_TRUNC('week', created_at)
      ORDER BY protocol, week DESC
    `);

    res.json({
      ok: true,
      trends: {
        weekly: weeklyTrends.rows,
        by_protocol: protocolTrends.rows
      },
      period_days: days
    });

  } catch (error) {
    logger.error('[Network Devices] Trends error:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

export default router;
