/**
 * Health Scoring Engine
 * 
 * Calculates comprehensive 0-100 health scores for zones and entire farm.
 * Scoring algorithm weights multiple factors:
 * - Target compliance (40%)
 * - Stability/variance (30%)
 * - Anomaly history (20%)
 * - Sensor reliability (10%)
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Load target ranges configuration
 */
function loadTargetRanges() {
  try {
    const configPath = join(__dirname, '..', 'public', 'data', 'target-ranges.json');
    const data = readFileSync(configPath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('[Health Scorer] Failed to load target ranges:', error.message);
    return null;
  }
}

/**
 * Load anomaly history
 */
function loadAnomalyHistory() {
  try {
    const histPath = join(__dirname, '..', 'public', 'data', 'anomaly-history.json');
    const data = readFileSync(histPath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.warn('[Health Scorer] No anomaly history found');
    return { anomalies: [] };
  }
}

/**
 * Calculate target compliance score (0-100)
 * Returns 100 if all metrics are within target ranges
 */
function calculateTargetCompliance(zone, targets) {
  const zoneTargets = targets.zones[zone.id] || targets.defaults;
  const sensors = zone.sensors || {};
  
  const metrics = [
    {
      name: 'tempC',
      value: sensors.tempC?.current,
      min: zoneTargets.temp_min,
      max: zoneTargets.temp_max,
      weight: 0.3
    },
    {
      name: 'rh',
      value: sensors.rh?.current,
      min: zoneTargets.rh_min,
      max: zoneTargets.rh_max,
      weight: 0.3
    },
    {
      name: 'vpd',
      value: sensors.vpd?.current,
      min: zoneTargets.vpd_min,
      max: zoneTargets.vpd_max,
      weight: 0.25
    },
    {
      name: 'co2',
      value: sensors.co2?.current,
      min: zoneTargets.co2_min,
      max: zoneTargets.co2_max,
      weight: 0.15
    }
  ];

  let totalScore = 0;
  let totalWeight = 0;

  for (const metric of metrics) {
    if (metric.value === null || metric.value === undefined) {
      continue; // Skip missing sensors
    }

    totalWeight += metric.weight;

    // Calculate how far out of range (0 = perfect, higher = worse)
    let deviation = 0;
    if (metric.value < metric.min) {
      deviation = metric.min - metric.value;
    } else if (metric.value > metric.max) {
      deviation = metric.value - metric.max;
    }

    // Normalize deviation to 0-1 scale (assuming max deviation = 2x range width is score 0)
    const rangeWidth = metric.max - metric.min;
    const maxDeviation = rangeWidth * 2;
    const normalizedDeviation = Math.min(deviation / maxDeviation, 1);

    // Convert to score (1 = perfect, 0 = worst)
    const metricScore = 1 - normalizedDeviation;
    totalScore += metricScore * metric.weight;
  }

  // Normalize to 0-100
  return totalWeight > 0 ? (totalScore / totalWeight) * 100 : 0;
}

/**
 * Calculate stability score based on recent variance (0-100)
 * Lower variance = higher score
 */
function calculateStability(zone) {
  const sensors = zone.sensors || {};
  const metrics = ['tempC', 'rh', 'vpd'];
  
  let totalStability = 0;
  let count = 0;

  for (const metric of metrics) {
    const history = sensors[metric]?.history;
    
    if (!history || history.length < 5) {
      continue; // Need at least 5 readings
    }

    // Calculate coefficient of variation (CV) = std dev / mean
    const values = history.map(h => h.value).filter(v => v !== null);
    if (values.length === 0) continue;

    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);
    const cv = mean !== 0 ? stdDev / Math.abs(mean) : 0;

    // Convert CV to score (lower CV = higher score)
    // Assume CV > 0.2 (20% variation) = score 0
    const stabilityScore = Math.max(0, 1 - (cv / 0.2));
    
    totalStability += stabilityScore;
    count++;
  }

  return count > 0 ? (totalStability / count) * 100 : 100; // Default 100 if no data
}

/**
 * Calculate anomaly score based on recent anomaly frequency (0-100)
 * Fewer anomalies = higher score
 */
function calculateAnomalyScore(zone, anomalyHistory) {
  const zoneAnomalies = anomalyHistory.anomalies.filter(a => 
    a.zone === zone.id || a.zone === zone.name
  );

  // Count anomalies in last 24 hours
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const recentAnomalies = zoneAnomalies.filter(a => {
    const timestamp = new Date(a.timestamp).getTime();
    return timestamp > oneDayAgo;
  });

  // Score based on anomaly count (assuming 10+ anomalies = score 0)
  const maxAnomalies = 10;
  const score = Math.max(0, 1 - (recentAnomalies.length / maxAnomalies));
  
  return score * 100;
}

/**
 * Calculate sensor reliability score (0-100)
 * Based on data freshness and sensor availability
 */
function calculateSensorReliability(zone) {
  const sensors = zone.sensors || {};
  const expectedSensors = ['tempC', 'rh', 'vpd'];
  
  let availableCount = 0;
  let recentCount = 0;
  const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;

  for (const sensorName of expectedSensors) {
    const sensor = sensors[sensorName];
    
    if (sensor && sensor.current !== null && sensor.current !== undefined) {
      availableCount++;
      
      // Check if data is recent (within 5 minutes)
      if (sensor.updatedAt) {
        const timestamp = new Date(sensor.updatedAt).getTime();
        if (timestamp > fiveMinutesAgo) {
          recentCount++;
        }
      }
    }
  }

  // Score based on availability and freshness
  const availabilityScore = availableCount / expectedSensors.length;
  const freshnessScore = availableCount > 0 ? recentCount / availableCount : 0;
  
  return ((availabilityScore * 0.6) + (freshnessScore * 0.4)) * 100;
}

/**
 * Calculate comprehensive zone health score (0-100)
 */
export function calculateZoneHealthScore(zone, targets, anomalyHistory) {
  // Weight factors
  const weights = {
    targetCompliance: 0.40,
    stability: 0.30,
    anomalyScore: 0.20,
    sensorReliability: 0.10
  };

  // Calculate component scores
  const targetCompliance = calculateTargetCompliance(zone, targets);
  const stability = calculateStability(zone);
  const anomalyScore = calculateAnomalyScore(zone, anomalyHistory);
  const sensorReliability = calculateSensorReliability(zone);

  // Weighted total
  const totalScore = 
    (targetCompliance * weights.targetCompliance) +
    (stability * weights.stability) +
    (anomalyScore * weights.anomalyScore) +
    (sensorReliability * weights.sensorReliability);

  return {
    overall: Math.round(totalScore),
    components: {
      target_compliance: Math.round(targetCompliance),
      stability: Math.round(stability),
      anomaly_score: Math.round(anomalyScore),
      sensor_reliability: Math.round(sensorReliability)
    },
    grade: getHealthGrade(totalScore)
  };
}

/**
 * Calculate farm-wide health score
 */
export function calculateFarmHealthScore(envData) {
  const targets = loadTargetRanges();
  const anomalyHistory = loadAnomalyHistory();
  
  if (!targets) {
    return {
      ok: false,
      error: 'Failed to load target ranges configuration'
    };
  }
  
  if (!envData || !envData.zones || envData.zones.length === 0) {
    return {
      ok: true,
      farm_score: 0,
      grade: 'N/A',
      zones: [],
      summary: {
        total_zones: 0,
        excellent: 0,
        good: 0,
        fair: 0,
        poor: 0
      },
      message: 'No environmental data available yet. Waiting for sensors...',
      timestamp: new Date().toISOString()
    };
  }

  const zoneScores = [];
  
  for (const zone of envData.zones) {
    const score = calculateZoneHealthScore(zone, targets, anomalyHistory);
    zoneScores.push({
      zone_id: zone.id,
      zone_name: zone.name || zone.id,
      ...score
    });
  }

  // Calculate farm average (weighted by zone importance if needed)
  const avgScore = zoneScores.reduce((sum, z) => sum + z.overall, 0) / zoneScores.length;
  
  return {
    ok: true,
    farm_score: Math.round(avgScore),
    grade: getHealthGrade(avgScore),
    zones: zoneScores,
    summary: {
      total_zones: zoneScores.length,
      excellent: zoneScores.filter(z => z.overall >= 90).length,
      good: zoneScores.filter(z => z.overall >= 70 && z.overall < 90).length,
      fair: zoneScores.filter(z => z.overall >= 50 && z.overall < 70).length,
      poor: zoneScores.filter(z => z.overall < 50).length
    },
    timestamp: new Date().toISOString()
  };
}

/**
 * Convert numeric score to letter grade
 */
function getHealthGrade(score) {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

/**
 * Get health score with AI insights
 */
export function getHealthScoreWithInsights(envData) {
  const scoreData = calculateFarmHealthScore(envData);
  
  if (!scoreData.ok) {
    return scoreData;
  }

  // Generate insights
  const insights = [];
  const poorZones = scoreData.zones.filter(z => z.overall < 70);
  
  if (poorZones.length > 0) {
    insights.push({
      type: 'warning',
      message: `${poorZones.length} zone(s) have health scores below 70`,
      zones: poorZones.map(z => z.zone_name)
    });
  }

  // Identify zones with low stability
  const unstableZones = scoreData.zones.filter(z => z.components.stability < 60);
  if (unstableZones.length > 0) {
    insights.push({
      type: 'stability',
      message: `${unstableZones.length} zone(s) showing high environmental variance`,
      zones: unstableZones.map(z => z.zone_name),
      recommendation: 'Check HVAC systems and automation schedules'
    });
  }

  // Identify zones with sensor issues
  const sensorIssues = scoreData.zones.filter(z => z.components.sensor_reliability < 70);
  if (sensorIssues.length > 0) {
    insights.push({
      type: 'sensor',
      message: `${sensorIssues.length} zone(s) have stale or missing sensor data`,
      zones: sensorIssues.map(z => z.zone_name),
      recommendation: 'Verify sensor connectivity and battery levels'
    });
  }

  return {
    ...scoreData,
    insights
  };
}

export default {
  calculateZoneHealthScore,
  calculateFarmHealthScore,
  getHealthScoreWithInsights
};
