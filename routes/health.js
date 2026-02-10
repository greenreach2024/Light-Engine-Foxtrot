/**
 * Health API Routes
 * 
 * Endpoints for AI health monitoring and scanning
 */

import { Router } from 'express';
import { readFileSync } from 'fs';
import fs from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { scanAllZones, getZoneStatus, getOutOfTargetConditions } from '../lib/broad-health-monitor.js';
import { calculateFarmHealthScore, getHealthScoreWithInsights } from '../lib/health-scorer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const AI_RECOMMENDATIONS_PATH = join(__dirname, '../data/ai-recommendations.json');

const router = Router();

/**
 * Load target ranges configuration (shared utility)
 */
function loadTargetRanges() {
  try {
    const configPath = join(__dirname, '..', 'public', 'data', 'target-ranges.json');
    const data = readFileSync(configPath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('[Health API] Failed to load target ranges:', error.message);
    return null;
  }
}

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

/**
 * GET /api/farm/vitality
 * Farm Vitality Multi-View Dashboard API
 * Returns normalized 0-100 scores for all farm metrics with data freshness tracking
 */
router.get('/vitality', async (req, res) => {
  try {
    const vitalityData = await calculateFarmVitality();
    res.json(vitalityData);
  } catch (error) {
    console.error('[Farm Vitality] Error calculating vitality:', error);
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

/**
 * Calculate comprehensive farm vitality with data staleness detection
 */
async function calculateFarmVitality() {
  const now = Date.now();
  
  // Load all data sources
  const envData = await loadEnvData();
  const groupsData = await loadGroupsData();
  const nutrientsData = await loadNutrientsData();
  
  // Calculate component scores
  const environmental = await calculateEnvironmentalScore(envData, now);
  const cropReadiness = await calculateCropReadinessScore(groupsData, now);
  const nutrientHealth = await calculateNutrientHealthScore(nutrientsData, now);
  const operations = await calculateOperationsScore(envData, groupsData, nutrientsData, now);
  
  // Calculate overall farm vitality (weighted average)
  const overallScore = Math.round(
    (environmental.score * 0.35) +
    (cropReadiness.score * 0.30) +
    (nutrientHealth.score * 0.20) +
    (operations.score * 0.15)
  );
  
  return {
    ok: true,
    overall_score: overallScore,
    overall_status: getVitalityStatus(overallScore),
    timestamp: new Date().toISOString(),
    components: {
      environment: environmental,
      crop_readiness: cropReadiness,
      nutrient_health: nutrientHealth,
      operations: operations
    },
    data_freshness: {
      environment: environmental.data_freshness,
      nutrients: nutrientHealth.data_freshness,
      inventory: cropReadiness.data_freshness
    }
  };
}

/**
 * Load groups (crop inventory) data
 */
async function loadGroupsData
() {
  try {
    const groupsPath = join(__dirname, '..', 'public', 'data', 'groups.json');
    const data = await fs.readFile(groupsPath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.warn('[Farm Vitality] Failed to load groups data:', error.message);
    return { groups: [], updatedAt: null };
  }
}

/**
 * Load nutrients data
 */
async function loadNutrientsData() {
  try {
    const nutrientPath = join(__dirname, '..', 'greenreach-central', 'public', 'data', 'nutrient-dashboard.json');
    const data = await fs.readFile(nutrientPath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.warn('[Farm Vitality] Failed to load nutrients data:', error.message);
    return { zones: [], updatedAt: null };
  }
}

/**
 * Calculate environmental score with sigmoid scoring
 */
async function calculateEnvironmentalScore(envData, now) {
  if (!envData || !envData.zones || envData.zones.length === 0) {
    return {
      score: 0,
      label: "Environment",
      status: "no_data",
      data_freshness: { age_minutes: null, stale: true }
    };
  }
  
  const targets = loadTargetRanges();
  if (!targets) {
    return { score: 0, label: "Environment", status: "error", data_freshness: { age_minutes: null, stale: true } };
  }
  
  let totalScore = 0;
  let newestTimestamp = 0;
  
  for (const zone of envData.zones) {
    const zoneTargets = targets.zones[zone.id] || targets.defaults;
    const sensors = zone.sensors || {};
    
    // Track newest data timestamp
    if (sensors.tempC?.updatedAt) {
      const ts = new Date(sensors.tempC.updatedAt).getTime();
      if (ts > newestTimestamp) newestTimestamp = ts;
    }
    
    // Calculate metric scores with sigmoid curve
    const tempScore = calculateMetricScore(sensors.tempC?.current, zoneTargets.temp_min, zoneTargets.temp_max, 2, 5);
    const rhScore = calculateMetricScore(sensors.rh?.current, zoneTargets.rh_min, zoneTargets.rh_max, 5, 15);
    const vpdScore = calculateMetricScore(sensors.vpd?.current, zoneTargets.vpd_min, zoneTargets.vpd_max, 0.15, 0.4);
    const co2Score = sensors.co2?.current ? calculateMetricScore(sensors.co2.current, zoneTargets.co2_min, zoneTargets.co2_max, 100, 300) : 100;
    
    const zoneScore = (vpdScore * 0.35) + (tempScore * 0.30) + (rhScore * 0.25) + (co2Score * 0.10);
    totalScore += zoneScore;
  }
  
  const avgScore = Math.round(totalScore / envData.zones.length);
  const ageMinutes = newestTimestamp ? Math.round((now - newestTimestamp) / (1000 * 60)) : null;
  
  return {
    score: avgScore,
    label: "Environment",
    status: getVitalityStatus(avgScore),
    data_freshness: calculateDataFreshness(ageMinutes, 30)
  };
}

/**
 * Calculate metric score with crop stress curve (sigmoid-like)
 */
function calculateMetricScore(current, targetMin, targetMax, tolerance, critical) {
  if (current === null || current === undefined) return 50; // Default neutral score
  
  const target = (targetMin + targetMax) / 2;
  const deviation = Math.abs(current - target);
  
  // Within tolerance = excellent (90-100)
  if (deviation <= tolerance) {
    return 100 - (deviation / tolerance) * 10;
  }
  
  // Beyond tolerance but not critical = degrading (30-90)
  if (deviation < critical) {
    const beyondTolerance = deviation - tolerance;
    const criticalRange = critical - tolerance;
    const degradation = (beyondTolerance / criticalRange) * 60;
    return 90 - degradation;
  }
  
  // Critical = severe (0-30)
  return Math.max(0, 30 - (deviation - critical) * 5);
}

/**
 * Calculate crop readiness score (planning quality)
 */
async function calculateCropReadinessScore(groupsData, now) {
  if (!groupsData || !groupsData.groups || groupsData.groups.length === 0) {
    return {
      score: 50,
      label: "Crop Readiness",
      status: "neutral",
      data_freshness: { age_minutes: null, stale: true }
    };
  }
  
  let plantsReady48h = 0;
  let totalCapacity = 0;
  let newestTimestamp = 0;
  
  for (const group of groupsData.groups) {
    const capacity = group.plantCapacity || 0;
    totalCapacity += capacity;
    
    // Check if ready within 48h (based on daysPostSeeding and harvest window)
    const daysPS = group.daysPostSeeding || 0;
    const harvestStart = group.recipe?.harvestWindow?.start || 30;
    const daysUntilReady = harvestStart - daysPS;
    
    if (daysUntilReady >= 0 && daysUntilReady <= 2) {
      plantsReady48h += capacity;
    }
    
    // Track freshness
    if (group.lastUpdated) {
      const ts = new Date(group.lastUpdated).getTime();
      if (ts > newestTimestamp) newestTimestamp = ts;
    }
  }
  
  const readyPercent = totalCapacity > 0 ? (plantsReady48h / totalCapacity) * 100 : 0;
  
  // Planning score: Ideal is 40-60% ready
  let planningScore = 100;
  if (readyPercent < 40) {
    planningScore = readyPercent * 2.5; // 0-40% → 0-100 score
  } else if (readyPercent > 60) {
    planningScore = 100 - ((readyPercent - 60) * 2); // >60% = waste risk penalty
  }
  
  const ageMinutes = newestTimestamp ? Math.round((now - newestTimestamp) / (1000 * 60)) : null;
  
  return {
    score: Math.round(planningScore),
    label: "Crop Readiness",
    status: getVitalityStatus(planningScore),
    plants_ready_48h: plantsReady48h,
    total_capacity: totalCapacity,
    ready_percent: Math.round(readyPercent),
    data_freshness: calculateDataFreshness(ageMinutes, 60)
  };
}

/**
 * Calculate nutrient health score
 */
async function calculateNutrientHealthScore(nutrientsData, now) {
  if (!nutrientsData || !nutrientsData.zones || nutrientsData.zones.length === 0) {
    return {
      score: 50,
      label: "Nutrients",
      status: "neutral",
      data_freshness: { age_minutes: null, stale: true }
    };
  }
  
  let totalScore = 0;
  let zoneCount = 0;
  let newestTimestamp = 0;
  
  for (const zone of nutrientsData.zones) {
    const ph = zone.sensors?.ph?.current;
    const ec = zone.sensors?.ec?.current;
    
    // Track freshness
    if (zone.sensors?.ph?.updatedAt) {
      const ts = new Date(zone.sensors.ph.updatedAt).getTime();
      if (ts > newestTimestamp) newestTimestamp = ts;
    }
    
    // pH ideal: 5.5-6.5
    const phScore = ph ? calculateMetricScore(ph, 5.5, 6.5, 0.2, 0.8) : 50;
    
    // EC ideal: varies by crop, assume 1.2-2.0 mS/cm
    const ecScore = ec ? calculateMetricScore(ec, 1.2, 2.0, 0.2, 0.8) : 50;
    
    const zoneScore = (phScore * 0.5) + (ecScore * 0.5);
    totalScore += zoneScore;
    zoneCount++;
  }
  
  const avgScore = zoneCount > 0 ? Math.round(totalScore / zoneCount) : 50;
  const ageMinutes = newestTimestamp ? Math.round((now - newestTimestamp) / (1000 * 60)) : null;
  
  return {
    score: avgScore,
    label: "Nutrients",
    status: getVitalityStatus(avgScore),
    data_freshness: calculateDataFreshness(ageMinutes, 15)
  };
}

/**
 * Calculate operations score with data freshness
 */
async function calculateOperationsScore(envData, groupsData, nutrientsData, now) {
  // Data freshness scoring
  const envAge = getDataAge(envData?.zones?.[0]?.sensors?.tempC?.updatedAt, now);
  const groupsAge = getDataAge(groupsData?.groups?.[0]?.lastUpdated, now);
  const nutrientsAge = getDataAge(nutrientsData?.zones?.[0]?.sensors?.ph?.updatedAt, now);
  
  const envFreshness = calculateDataFreshness(envAge, 30);
  const groupsFreshness = calculateDataFreshness(groupsAge, 60);
  const nutrientsFreshness = calculateDataFreshness(nutrientsAge, 15);
  
  const avgFreshnessScore = (
    (envFreshness.score + groupsFreshness.score + nutrientsFreshness.score) / 3
  );
  
  // Sensor reliability (from health scorer)
  const sensorScore = envData?.zones?.length > 0 ? 95 : 50;
  
  // System uptime (assume 99% for now)
  const uptimeScore = 99;
  
  // Alert frequency (no alert system yet, assume good)
  const alertScore = 95;
  
  // Automation status (assume 90% for now)
  const automationScore = 90;
  
  const operationsScore = Math.round(
    (sensorScore * 0.25) +
    (uptimeScore * 0.20) +
    (avgFreshnessScore * 0.25) +
    (alertScore * 0.20) +
    (automationScore * 0.10)
  );
  
  return {
    score: operationsScore,
    label: "Systems",
    status: getVitalityStatus(operationsScore),
    sensor_reliability: sensorScore,
    system_uptime: uptimeScore,
    active_alerts: 0,
    data_freshness: {
      environment: envFreshness,
      nutrients: nutrientsFreshness,
      inventory: groupsFreshness
    },
    warnings: [
      ...( envFreshness.stale ? ['Environmental data is stale'] : []),
      ...(nutrientsFreshness.stale ? ['Nutrient data is stale'] : []),
      ...(groupsFreshness.stale ? ['Inventory data is stale'] : [])
    ]
  };
}

/**
 * Get data age in minutes
 */
function getDataAge(timestamp, now) {
  if (!timestamp) return null;
  try {
    const ts = new Date(timestamp).getTime();
    return Math.round((now - ts) / (1000 * 60));
  } catch (error) {
    return null;
  }
}

/**
 * Calculate data freshness with quality levels
 */
function calculateDataFreshness(ageMinutes, thresholdMinutes) {
  if (ageMinutes === null) {
    return { age_minutes: null, stale: true, status: 'no_data', score: 0 };
  }
  
  // Fresh: <= 50% of threshold
  if (ageMinutes <= thresholdMinutes * 0.5) {
    return { age_minutes: ageMinutes, stale: false, status: 'fresh', score: 100 };
  }
  
  // Acceptable: <= threshold
  if (ageMinutes <= thresholdMinutes) {
    return { age_minutes: ageMinutes, stale: false, status: 'acceptable', score: 70 };
  }
  
  // Stale: <= 2x threshold
  if (ageMinutes <= thresholdMinutes * 2) {
    return { age_minutes: ageMinutes, stale: true, status: 'stale', score: 40 };
  }
  
  // Critical: > 2x threshold
  return { age_minutes: ageMinutes, stale: true, status: 'critical', score: 0 };
}

/**
 * Get vitality status from score
 */
function getVitalityStatus(score) {
  if (score >= 85) return 'excellent';
  if (score >= 70) return 'good';
  if (score >= 50) return 'fair';
  if (score >= 30) return 'degraded';
  return 'critical';
}

/**
 * GET /api/health/ai-character
 * Generate AI character definition for dashboard visualization
 * Query params:
 *   - componentType: environment, crops, nutrients, systems
 *   - score: 0-100
 *   - emotion: happy, neutral, worried, critical (optional, derived from score if not provided)
 */
router.get('/ai-character', async (req, res) => {
  try {
    const { componentType, score, emotion } = req.query;
    
    if (!componentType) {
      return res.status(400).json({
        ok: false,
        error: 'componentType query parameter is required'
      });
    }
    
    const scoreNum = parseInt(score) || 75;
    let emotionStr = emotion;
    
    // Derive emotion from score if not provided
    if (!emotionStr) {
      if (scoreNum >= 80) emotionStr = 'happy';
      else if (scoreNum >= 50) emotionStr = 'neutral';
      else if (scoreNum >= 30) emotionStr = 'worried';
      else emotionStr = 'critical';
    }
    
    // Import AI character generator
    const { default: aiCharacterGenerator } = await import('../lib/ai-character-generator.js');
    
    // Generate character
    const character = aiCharacterGenerator.generateCharacter(
      componentType,
      scoreNum,
      emotionStr
    );
    
    res.json({
      ok: true,
      character,
      meta: {
        componentType,
        score: scoreNum,
        emotion: emotionStr,
        generated_at: new Date().toISOString()
      }
    });
    
  } catch (error) {
    console.error('[Health API] AI character generation error:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to generate character',
      message: error.message
    });
  }
});

export default router;
