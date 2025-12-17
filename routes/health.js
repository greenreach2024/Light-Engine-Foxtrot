/**
 * Health API Routes
 * 
 * Endpoints for AI health monitoring and scanning
 */

import { Router } from 'express';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { scanAllZones, getZoneStatus, getOutOfTargetConditions } from '../lib/broad-health-monitor.js';
import { calculateFarmHealthScore, getHealthScoreWithInsights } from '../lib/health-scorer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const router = Router();

/**
 * Load current environmental data
 */
function loadEnvData() {
  try {
    const envPath = join(__dirname, '..', 'public', 'data', 'env.json');
    const data = readFileSync(envPath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('[Health API] Failed to load env data:', error.message);
    return null;
  }
}

/**
 * GET /api/health/scan
 * Perform full health scan of all zones
 */
router.get('/scan', (req, res) => {
  try {
    const envData = loadEnvData();
    
    if (!envData) {
      return res.status(500).json({
        ok: false,
        error: 'Failed to load environmental data'
      });
    }

    const healthReport = scanAllZones(envData);
    
    res.json(healthReport);
  } catch (error) {
    console.error('[Health API] Scan error:', error);
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

/**
 * GET /api/health/status/:zoneId
 * Get health status for a specific zone
 */
router.get('/status/:zoneId', (req, res) => {
  try {
    const { zoneId } = req.params;
    const envData = loadEnvData();
    
    if (!envData) {
      return res.status(500).json({
        ok: false,
        error: 'Failed to load environmental data'
      });
    }

    const zoneHealth = getZoneStatus(envData, zoneId);
    
    res.json(zoneHealth);
  } catch (error) {
    console.error('[Health API] Status error:', error);
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

/**
 * GET /api/health/out-of-target
 * Get only zones with out-of-target conditions
 */
router.get('/out-of-target', (req, res) => {
  try {
    const envData = loadEnvData();
    
    if (!envData) {
      return res.status(500).json({
        ok: false,
        error: 'Failed to load environmental data'
      });
    }

    const outOfTarget = getOutOfTargetConditions(envData);
    
    res.json(outOfTarget);
  } catch (error) {
    console.error('[Health API] Out-of-target error:', error);
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

/**
 * GET /api/health/status
 * Get overall farm health status (summary only)
 */
router.get('/status', (req, res) => {
  try {
    const envData = loadEnvData();
    
    if (!envData) {
      return res.status(500).json({
        ok: false,
        error: 'Failed to load environmental data'
      });
    }

    const healthReport = scanAllZones(envData);
    
    // Return only summary data
    res.json({
      ok: healthReport.ok,
      overall_status: healthReport.overall_status,
      summary: healthReport.summary,
      timestamp: healthReport.timestamp
    });
  } catch (error) {
    console.error('[Health API] Status error:', error);
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

/**
 * GET /api/health/score
 * Get comprehensive 0-100 health score for entire farm
 */
router.get('/score', (req, res) => {
  try {
    const envData = loadEnvData();
    
    if (!envData) {
      return res.status(500).json({
        ok: false,
        error: 'Failed to load environmental data'
      });
    }

    const scoreData = calculateFarmHealthScore(envData);
    
    res.json(scoreData);
  } catch (error) {
    console.error('[Health API] Score error:', error);
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

/**
 * GET /api/health/insights
 * Get health score with AI-generated insights and recommendations
 */
router.get('/insights', (req, res) => {
  try {
    const envData = loadEnvData();
    
    if (!envData) {
      return res.status(500).json({
        ok: false,
        error: 'Failed to load environmental data'
      });
    }

    const insights = getHealthScoreWithInsights(envData);
    
    res.json(insights);
  } catch (error) {
    console.error('[Health API] Insights error:', error);
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

export default router;
