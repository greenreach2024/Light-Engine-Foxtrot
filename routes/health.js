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
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const AI_RECOMMENDATIONS_PATH = path.join(__dirname, '../data/ai-recommendations.json');

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const router = Router();

/**
 * Load current environmental data from in-memory cache
 * Reads from DATA_DIR/env.json if available, otherwise returns empty structure
 */
async function loadEnvData() {
  try {
    const envPath = join(__dirname, '..', 'data', 'env.json');
    const data = readFileSync(envPath, 'utf8');
    const parsed = JSON.parse(data);
    
    // Transform to expected format if zones exist
    if (Array.isArray(parsed.zones) && parsed.zones.length > 0) {
      return { zones: parsed.zones };
    }
    
    // Return empty structure if no zones
    return { zones: [] };
  } catch (error) {
    console.warn('[Health API] Failed to load env data from data/env.json:', error.message);
    // Return empty structure instead of null to avoid errors
    return { zones: [] };
  }
}

/**
 * GET /api/health/scan
 * Perform full health scan of all zones
 */
router.get('/scan', async (req, res) => {
  try {
    const envData = await loadEnvData();
    
    if (!envData || !envData.zones) {
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
router.get('/status/:zoneId', async (req, res) => {
  try {
    const { zoneId } = req.params;
    const envData = await loadEnvData();
    
    if (!envData || !envData.zones) {
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
router.get('/out-of-target', async (req, res) => {
  try {
    const envData = await loadEnvData();
    
    if (!envData || !envData.zones) {
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
router.get('/score', async (req, res) => {
  try {
    const envData = await loadEnvData();
    
    if (!envData || !envData.zones) {
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
 * Merges rule-based insights with GPT-4 recommendations from Central
 */
router.get('/insights', async (req, res) => {
  try {
    const envData = await loadEnvData();
    
    if (!envData || !envData.zones) {
      return res.status(500).json({
        ok: false,
        error: 'Failed to load environmental data'
      });
    }

    const insights = getHealthScoreWithInsights(envData);
    
    // Load AI recommendations from Central (if available)
    try {
      const aiRecsData = await fs.readFile(AI_RECOMMENDATIONS_PATH, 'utf-8');
      const aiRecs = JSON.parse(aiRecsData);
      
      // Only include recommendations that are recent (within last 24 hours)
      const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
      const recentRecs = aiRecs.recommendations?.filter(rec => 
        new Date(rec.timestamp).getTime() > oneDayAgo
      ) || [];
      
      if (recentRecs.length > 0) {
        // Prepend AI recommendations to insights
        insights.insights = [
          ...recentRecs.map(rec => ({
            type: 'ai',
            message: rec.message,
            recommendation: rec.recommendation,
            zones: rec.zones || [],
            priority: rec.priority || 'medium',
            source: 'GPT-4 Analysis'
          })),
          ...insights.insights
        ];
      }
    } catch (err) {
      // AI recommendations not available yet - continue with rule-based only
      console.log('[Health API] No AI recommendations available:', err.message);
    }
    
    res.json(insights);
  } catch (error) {
    console.error('[Health API] Insights error:', error);
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

/**
 * POST /api/health/ai-recommendations
 * Receive AI-generated recommendations from GreenReach Central
 * Protected endpoint - requires API key authentication
 */
router.post('/ai-recommendations', async (req, res) => {
  try {
    // Verify API key (Central should send X-API-Key header)
    const apiKey = req.headers['x-api-key'];
    const validKey = process.env.CENTRAL_API_KEY || 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    
    if (apiKey !== validKey) {
      return res.status(401).json({
        ok: false,
        error: 'Unauthorized'
      });
    }
    
    const { recommendations, farm_id, generated_at } = req.body;
    
    if (!recommendations || !Array.isArray(recommendations)) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid recommendations format'
      });
    }
    
    // Store recommendations
    const data = {
      farm_id,
      generated_at: generated_at || new Date().toISOString(),
      received_at: new Date().toISOString(),
      recommendations: recommendations.map(rec => ({
        ...rec,
        timestamp: rec.timestamp || new Date().toISOString()
      }))
    };
    
    await fs.writeFile(AI_RECOMMENDATIONS_PATH, JSON.stringify(data, null, 2));
    
    console.log('[Health API] ✓ Received', recommendations.length, 'AI recommendations from Central');
    
    res.json({
      ok: true,
      message: 'AI recommendations stored successfully',
      count: recommendations.length
    });
  } catch (error) {
    console.error('[Health API] Error storing AI recommendations:', error);
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

export default router;
