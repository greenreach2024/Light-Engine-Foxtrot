/**
 * GreenReach Admin - Federated Health Monitoring Routes
 * Aggregates health data from multiple Light Engine farms
 */

import express from 'express';

const router = express.Router();

/**
 * Registered Light Engine farms
 * GreenReach is the parent company that owns and distributes Light Engine
 * Each farm runs their own Light Engine instance, GreenReach aggregates them all
 * In production, this would come from a database
 */
const REGISTERED_FARMS = [
  {
    farmId: 'FARM-TEST-WIZARD-001',
    name: 'This is Your Farm',
    url: 'http://100.65.187.59:8091',
    location: 'Kingston, ON',
    size: '1 Room, 4 Groups',
    plan: 'Enterprise'
  }
  // Additional farms will be added here as they deploy Light Engine
  // Example:
  // {
  //   farmId: 'urban-greens-1',
  //   name: 'Urban Greens Co.',
  //   url: 'https://urbangreens.lightengine.app',
  //   location: 'Seattle, WA',
  //   size: 'Medium (25 zones)',
  //   plan: 'Pro'
  // }
];

/**
 * GET /api/admin/health/fleet
 * Aggregate health status across all registered farms
 */
router.get('/fleet', async (req, res) => {
  try {
    console.log('[Admin Health] Fetching fleet health from', REGISTERED_FARMS.length, 'farms');
    
    const farmHealthPromises = REGISTERED_FARMS.map(async (farm) => {
      try {
        const response = await fetch(`${farm.url}/api/health/insights`, {
          timeout: 5000,
          headers: { 'User-Agent': 'GreenReach-Admin/1.0' }
        });
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        
        const data = await response.json();
        
        return {
          farmId: farm.farmId,
          name: farm.name,
          location: farm.location,
          size: farm.size,
          plan: farm.plan,
          online: true,
          health: {
            score: data.farm_score || 0,
            grade: data.grade || 'N/A',
            zones: data.zones || [],
            total_zones: data.summary?.total_zones || 0,
            excellent: data.summary?.excellent || 0,
            good: data.summary?.good || 0,
            fair: data.summary?.fair || 0,
            poor: data.summary?.poor || 0,
            insights: data.insights || [],
            message: data.message
          },
          timestamp: data.timestamp || new Date().toISOString()
        };
      } catch (error) {
        console.warn(`[Admin Health] Failed to fetch health for ${farm.name}:`, error.message);
        return {
          farmId: farm.farmId,
          name: farm.name,
          location: farm.location,
          size: farm.size,
          plan: farm.plan,
          online: false,
          error: error.message,
          health: {
            score: 0,
            grade: 'OFFLINE',
            zones: [],
            total_zones: 0,
            excellent: 0,
            good: 0,
            fair: 0,
            poor: 0,
            insights: [],
            message: `Farm offline or unreachable: ${error.message}`
          },
          timestamp: new Date().toISOString()
        };
      }
    });
    
    const farmHealthResults = await Promise.all(farmHealthPromises);
    
    // Calculate fleet-wide statistics
    const onlineFarms = farmHealthResults.filter(f => f.online);
    const offlineFarms = farmHealthResults.filter(f => !f.online);
    
    const totalZones = farmHealthResults.reduce((sum, f) => sum + f.health.total_zones, 0);
    const totalExcellent = farmHealthResults.reduce((sum, f) => sum + f.health.excellent, 0);
    const totalGood = farmHealthResults.reduce((sum, f) => sum + f.health.good, 0);
    const totalFair = farmHealthResults.reduce((sum, f) => sum + f.health.fair, 0);
    const totalPoor = farmHealthResults.reduce((sum, f) => sum + f.health.poor, 0);
    
    // Calculate weighted fleet health score
    let fleetScore = 0;
    if (onlineFarms.length > 0) {
      const totalScore = onlineFarms.reduce((sum, f) => sum + f.health.score, 0);
      fleetScore = Math.round(totalScore / onlineFarms.length);
    }
    
    // Determine fleet grade
    let fleetGrade = 'F';
    if (fleetScore >= 90) fleetGrade = 'A';
    else if (fleetScore >= 80) fleetGrade = 'B';
    else if (fleetScore >= 70) fleetGrade = 'C';
    else if (fleetScore >= 60) fleetGrade = 'D';
    
    // Generate fleet-level insights
    const insights = [];
    if (offlineFarms.length > 0) {
      insights.push(`Alert: ${offlineFarms.length} farm${offlineFarms.length > 1 ? 's' : ''} offline or unreachable`);
    }
    if (totalPoor > 0) {
      insights.push(`Critical: ${totalPoor} zone${totalPoor > 1 ? 's' : ''} across fleet need immediate attention`);
    }
    if (totalExcellent > 0) {
      insights.push(`Performance: ${totalExcellent} zone${totalExcellent > 1 ? 's' : ''} performing excellently`);
    }
    if (onlineFarms.length === REGISTERED_FARMS.length && fleetScore >= 80) {
      insights.push(`Status: All farms online with good health (${fleetScore}/100)`);
    }
    
    // Identify farms needing attention (score < 70 or offline)
    const farmsNeedingAttention = farmHealthResults.filter(f => 
      !f.online || f.health.score < 70
    );
    
    const response = {
      ok: true,
      fleet: {
        total_farms: REGISTERED_FARMS.length,
        online_farms: onlineFarms.length,
        offline_farms: offlineFarms.length,
        fleet_score: fleetScore,
        fleet_grade: fleetGrade,
        total_zones: totalZones,
        zone_summary: {
          excellent: totalExcellent,
          good: totalGood,
          fair: totalFair,
          poor: totalPoor
        },
        insights: insights,
        farms_needing_attention: farmsNeedingAttention.length
      },
      farms: farmHealthResults,
      timestamp: new Date().toISOString()
    };
    
    console.log(`[Admin Health] Fleet health: ${fleetScore}/100 (${fleetGrade}), ${onlineFarms.length}/${REGISTERED_FARMS.length} farms online`);
    
    res.json(response);
    
  } catch (error) {
    console.error('[Admin Health] Fleet health error:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to fetch fleet health',
      message: error.message
    });
  }
});

/**
 * GET /api/admin/health/farms
 * List all registered farms with basic info
 */
router.get('/farms', (req, res) => {
  res.json({
    ok: true,
    farms: REGISTERED_FARMS,
    count: REGISTERED_FARMS.length
  });
});

export default router;
