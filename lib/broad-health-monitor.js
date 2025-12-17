/**
 * Broad Health Monitor - AI Health Scanning System
 * 
 * Continuously monitors all zones for out-of-target environmental conditions.
 * Provides quick overview of farm health status.
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
    console.error('[Health Monitor] Failed to load target ranges:', error.message);
    return null;
  }
}

/**
 * Check if a value is within range
 */
function isInRange(value, min, max) {
  return value !== null && value !== undefined && value >= min && value <= max;
}

/**
 * Calculate severity based on deviation from target range
 */
function calculateSeverity(metric, current, min, max, thresholds) {
  if (isInRange(current, min, max)) {
    return 'healthy';
  }

  const deviation = current < min ? min - current : current - max;
  const threshold = thresholds[metric];

  if (!threshold) {
    return 'warning';
  }

  if (deviation >= threshold.critical_deviation) {
    return 'critical';
  } else if (deviation >= threshold.warning_deviation) {
    return 'warning';
  }

  return 'info';
}

/**
 * Check zone health against target ranges
 */
function checkZoneHealth(zone, targets, severityThresholds) {
  const zoneTargets = targets.zones[zone.id] || targets.defaults;
  const issues = [];

  // Temperature check
  if (zone.sensors?.tempC?.current !== undefined) {
    const temp = zone.sensors.tempC.current;
    const severity = calculateSeverity(
      'temperature',
      temp,
      zoneTargets.temp_min,
      zoneTargets.temp_max,
      severityThresholds
    );

    if (severity !== 'healthy') {
      issues.push({
        metric: 'temperature',
        current: temp,
        unit: '°C',
        target: `${zoneTargets.temp_min}-${zoneTargets.temp_max}°C`,
        severity,
        deviation: temp < zoneTargets.temp_min 
          ? zoneTargets.temp_min - temp 
          : temp - zoneTargets.temp_max
      });
    }
  }

  // Humidity check
  if (zone.sensors?.rh?.current !== undefined) {
    const rh = zone.sensors.rh.current;
    const severity = calculateSeverity(
      'humidity',
      rh,
      zoneTargets.rh_min,
      zoneTargets.rh_max,
      severityThresholds
    );

    if (severity !== 'healthy') {
      issues.push({
        metric: 'humidity',
        current: rh,
        unit: '%',
        target: `${zoneTargets.rh_min}-${zoneTargets.rh_max}%`,
        severity,
        deviation: rh < zoneTargets.rh_min 
          ? zoneTargets.rh_min - rh 
          : rh - zoneTargets.rh_max
      });
    }
  }

  // VPD check
  if (zone.sensors?.vpd?.current !== undefined) {
    const vpd = zone.sensors.vpd.current;
    const severity = calculateSeverity(
      'vpd',
      vpd,
      zoneTargets.vpd_min,
      zoneTargets.vpd_max,
      severityThresholds
    );

    if (severity !== 'healthy') {
      issues.push({
        metric: 'vpd',
        current: vpd,
        unit: 'kPa',
        target: `${zoneTargets.vpd_min}-${zoneTargets.vpd_max} kPa`,
        severity,
        deviation: vpd < zoneTargets.vpd_min 
          ? zoneTargets.vpd_min - vpd 
          : vpd - zoneTargets.vpd_max
      });
    }
  }

  // CO2 check
  if (zone.sensors?.co2?.current !== undefined) {
    const co2 = zone.sensors.co2.current;
    const severity = calculateSeverity(
      'co2',
      co2,
      zoneTargets.co2_min,
      zoneTargets.co2_max,
      severityThresholds
    );

    if (severity !== 'healthy') {
      issues.push({
        metric: 'co2',
        current: co2,
        unit: 'ppm',
        target: `${zoneTargets.co2_min}-${zoneTargets.co2_max} ppm`,
        severity,
        deviation: co2 < zoneTargets.co2_min 
          ? zoneTargets.co2_min - co2 
          : co2 - zoneTargets.co2_max
      });
    }
  }

  // Determine overall zone status
  const hasCritical = issues.some(i => i.severity === 'critical');
  const hasWarning = issues.some(i => i.severity === 'warning');

  return {
    zone_id: zone.id,
    zone_name: zone.name || zone.id,
    room: zone.room,
    status: hasCritical ? 'critical' : (hasWarning ? 'warning' : (issues.length > 0 ? 'info' : 'healthy')),
    issues,
    severity: hasCritical ? 'critical' : (hasWarning ? 'warning' : 'info'),
    last_reading: zone.sensors?.tempC?.updatedAt || zone.updatedAt
  };
}

/**
 * Generate health recommendations based on issues
 */
function generateRecommendations(issues) {
  const recommendations = [];

  for (const issue of issues) {
    let recommendation = '';

    if (issue.metric === 'temperature') {
      if (issue.current < issue.target.split('-')[0].replace('°C', '')) {
        recommendation = 'Check heating system. Verify thermostat settings and ensure no cold air leaks.';
      } else {
        recommendation = 'Check cooling system. Verify HVAC operation and airflow. Consider increasing ventilation.';
      }
    } else if (issue.metric === 'humidity') {
      if (issue.current < issue.target.split('-')[0].replace('%', '')) {
        recommendation = 'Increase humidification. Check humidifier operation and water supply.';
      } else {
        recommendation = 'Increase dehumidification. Check dehumidifier settings and ensure adequate ventilation.';
      }
    } else if (issue.metric === 'vpd') {
      if (issue.current < issue.target.split('-')[0]) {
        recommendation = 'VPD too low. Increase temperature or decrease humidity to improve plant transpiration.';
      } else {
        recommendation = 'VPD too high. Decrease temperature or increase humidity to prevent plant stress.';
      }
    } else if (issue.metric === 'co2') {
      if (issue.current < issue.target.split('-')[0]) {
        recommendation = 'CO2 levels low. Check CO2 supplementation system and ensure proper distribution.';
      } else {
        recommendation = 'CO2 levels high. Increase ventilation and check CO2 injection timing.';
      }
    }

    if (recommendation) {
      recommendations.push({
        zone_id: issue.zone_id,
        metric: issue.metric,
        recommendation
      });
    }
  }

  return recommendations;
}

/**
 * Scan all zones and generate health report
 */
export function scanAllZones(envData) {
  const targetRanges = loadTargetRanges();
  
  if (!targetRanges) {
    return {
      ok: false,
      error: 'Failed to load target ranges configuration',
      overall_status: 'unknown'
    };
  }

  if (!envData || !envData.zones || envData.zones.length === 0) {
    return {
      ok: true,
      overall_status: 'no-data',
      message: 'No environmental data available yet. Waiting for sensors to report...',
      out_of_target: [],
      warnings: [],
      recommendations: [],
      summary: {
        total_zones: 0,
        healthy: 0,
        warning: 0,
        critical: 0
      },
      timestamp: new Date().toISOString()
    };
  }

  const healthReport = {
    ok: true,
    overall_status: 'healthy',
    out_of_target: [],
    warnings: [],
    recommendations: [],
    summary: {
      total_zones: envData.zones.length,
      healthy: 0,
      warning: 0,
      critical: 0
    },
    timestamp: new Date().toISOString()
  };

  // Check each zone
  for (const zone of envData.zones) {
    const zoneHealth = checkZoneHealth(
      zone,
      targetRanges,
      targetRanges.severity_thresholds
    );

    // Update summary counts
    if (zoneHealth.status === 'healthy') {
      healthReport.summary.healthy++;
    } else if (zoneHealth.status === 'warning') {
      healthReport.summary.warning++;
      healthReport.out_of_target.push(zoneHealth);
    } else if (zoneHealth.status === 'critical') {
      healthReport.summary.critical++;
      healthReport.out_of_target.push(zoneHealth);
    }

    // Update overall status
    if (zoneHealth.status === 'critical' && healthReport.overall_status !== 'critical') {
      healthReport.overall_status = 'critical';
    } else if (zoneHealth.status === 'warning' && healthReport.overall_status === 'healthy') {
      healthReport.overall_status = 'warning';
    }
  }

  // Generate recommendations for out-of-target zones
  for (const zoneIssue of healthReport.out_of_target) {
    const recs = generateRecommendations(zoneIssue.issues.map(i => ({
      ...i,
      zone_id: zoneIssue.zone_id
    })));
    healthReport.recommendations.push(...recs);
  }

  return healthReport;
}

/**
 * Get detailed status for a specific zone
 */
export function getZoneStatus(envData, zoneId) {
  const targetRanges = loadTargetRanges();
  
  if (!targetRanges) {
    return {
      ok: false,
      error: 'Failed to load target ranges configuration'
    };
  }

  const zone = envData?.zones?.find(z => z.id === zoneId);
  
  if (!zone) {
    return {
      ok: false,
      error: `Zone ${zoneId} not found`
    };
  }

  const zoneHealth = checkZoneHealth(
    zone,
    targetRanges,
    targetRanges.severity_thresholds
  );

  return {
    ok: true,
    ...zoneHealth,
    timestamp: new Date().toISOString()
  };
}

/**
 * Get only out-of-target conditions
 */
export function getOutOfTargetConditions(envData) {
  const scanResult = scanAllZones(envData);
  
  return {
    ok: scanResult.ok,
    overall_status: scanResult.overall_status,
    out_of_target: scanResult.out_of_target,
    count: scanResult.out_of_target.length,
    timestamp: scanResult.timestamp
  };
}

export default {
  scanAllZones,
  getZoneStatus,
  getOutOfTargetConditions
};
