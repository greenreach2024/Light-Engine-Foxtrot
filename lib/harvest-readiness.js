/**
 * Harvest Readiness System — Phase 5, Ticket 5.2
 *
 * Replaces fixed harvest dates with readiness-based notifications.
 * Analyzes growth rate, weight trend, and quality scores to recommend
 * the optimal harvest window for each active group.
 *
 * Push: "Group 12 basil ready now — optimal quality window: next 48 hours."
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import HarvestPredictor from './harvest-predictor.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '..', 'data');
const READINESS_LOG_PATH = path.join(DATA_DIR, 'harvest-readiness-log.json');

// Readiness thresholds
const READINESS_CONFIG = {
  // Days before predicted harvest to start readiness monitoring
  monitoring_window_days: 5,
  // Minimum confidence to trigger readiness notification
  min_confidence: 0.6,
  // Hours after readiness notification before quality declines
  optimal_window_hours: 48,
  // Weight trend: minimum samples for trend analysis
  min_weight_samples: 3,
  // Quality decline rate per day past optimal (%/day)
  quality_decline_rate: 2,
  // Re-notification interval (hours) — don't spam
  re_notify_hours: 12
};

/**
 * Load readiness log (tracks what notifications have been sent).
 */
function loadReadinessLog() {
  try {
    return JSON.parse(fs.readFileSync(READINESS_LOG_PATH, 'utf-8'));
  } catch {
    return { notifications: [], last_scan: null };
  }
}

function saveReadinessLog(data) {
  fs.writeFileSync(READINESS_LOG_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Analyze growth rate for a crop based on historical experiment records.
 * Returns trend data: avg growth rate (oz/day), acceleration, projected weight.
 *
 * @param {string} crop - crop name
 * @param {Array} experimentRecords - from harvestOutcomesDB
 * @returns {{ avgGrowthRate, trend, projectedWeight, sampleCount }}
 */
export function analyzeGrowthRate(crop, experimentRecords) {
  const cropKey = (crop || '').toLowerCase();
  const relevant = experimentRecords
    .filter(r => (r.crop || '').toLowerCase().includes(cropKey) &&
      r.outcomes?.weight_per_plant_oz != null &&
      r.grow_days != null && r.grow_days > 0)
    .sort((a, b) => new Date(a.recorded_at) - new Date(b.recorded_at));

  if (relevant.length < READINESS_CONFIG.min_weight_samples) {
    return { avgGrowthRate: null, trend: 'insufficient_data', projectedWeight: null, sampleCount: relevant.length };
  }

  // Growth rate = weight / grow_days for each record
  const growthRates = relevant.map(r => ({
    rate: r.outcomes.weight_per_plant_oz / r.grow_days,
    weight: r.outcomes.weight_per_plant_oz,
    days: r.grow_days,
    date: r.recorded_at
  }));

  const avgRate = growthRates.reduce((s, r) => s + r.rate, 0) / growthRates.length;

  // Trend: compare recent half vs earlier half
  const midpoint = Math.floor(growthRates.length / 2);
  const earlyAvg = growthRates.slice(0, midpoint).reduce((s, r) => s + r.rate, 0) / midpoint || avgRate;
  const lateAvg = growthRates.slice(midpoint).reduce((s, r) => s + r.rate, 0) / (growthRates.length - midpoint) || avgRate;
  const trendDelta = ((lateAvg - earlyAvg) / earlyAvg) * 100;

  let trend = 'stable';
  if (trendDelta > 5) trend = 'improving';
  else if (trendDelta < -5) trend = 'declining';

  // Average weight at harvest
  const avgWeight = relevant.reduce((s, r) => s + r.outcomes.weight_per_plant_oz, 0) / relevant.length;

  return {
    avgGrowthRate: +avgRate.toFixed(4),
    trend,
    trendDelta: +trendDelta.toFixed(1),
    projectedWeight: +avgWeight.toFixed(2),
    avgGrowDays: +(relevant.reduce((s, r) => s + r.grow_days, 0) / relevant.length).toFixed(1),
    sampleCount: relevant.length,
    recentRate: +lateAvg.toFixed(4)
  };
}

/**
 * Analyze quality scores for a crop.
 * Determines optimal harvest day for peak quality.
 */
export function analyzeQualityTrend(crop, experimentRecords) {
  const cropKey = (crop || '').toLowerCase();
  const relevant = experimentRecords
    .filter(r => (r.crop || '').toLowerCase().includes(cropKey) &&
      r.outcomes?.quality_score != null &&
      r.grow_days != null)
    .sort((a, b) => a.grow_days - b.grow_days);

  if (relevant.length < READINESS_CONFIG.min_weight_samples) {
    return { optimalDay: null, avgQuality: null, pattern: 'insufficient_data', sampleCount: relevant.length };
  }

  // Find the grow_days that maximizes quality
  let bestDay = relevant[0].grow_days;
  let bestQuality = relevant[0].outcomes.quality_score;

  const qualityByDay = {};
  for (const r of relevant) {
    const dayBucket = Math.round(r.grow_days);
    if (!qualityByDay[dayBucket]) qualityByDay[dayBucket] = [];
    qualityByDay[dayBucket].push(r.outcomes.quality_score);
  }

  for (const [day, scores] of Object.entries(qualityByDay)) {
    const avg = scores.reduce((s, v) => s + v, 0) / scores.length;
    if (avg > bestQuality) {
      bestQuality = avg;
      bestDay = parseInt(day);
    }
  }

  const avgQuality = relevant.reduce((s, r) => s + r.outcomes.quality_score, 0) / relevant.length;

  return {
    optimalDay: bestDay,
    peakQuality: +bestQuality.toFixed(1),
    avgQuality: +avgQuality.toFixed(1),
    pattern: bestDay < relevant[relevant.length - 1].grow_days ? 'peaks_then_declines' : 'improves_with_time',
    sampleCount: relevant.length
  };
}

/**
 * Assess harvest readiness for a single group.
 * Combines prediction data with growth/quality analysis.
 *
 * @param {object} group - group data ({ id, crop, planConfig, ... })
 * @param {object} prediction - from HarvestPredictor.predict()
 * @param {object} growthAnalysis - from analyzeGrowthRate()
 * @param {object} qualityAnalysis - from analyzeQualityTrend()
 * @returns {{ readiness, level, window, message }}
 */
export function assessReadiness(group, prediction, growthAnalysis, qualityAnalysis) {
  const now = new Date();
  const predictedDate = new Date(prediction.predictedDate);
  const daysRemaining = prediction.daysRemaining;
  const crop = group.crop || 'Unknown';

  // Base readiness from days remaining
  let readinessScore = 0;
  if (daysRemaining <= 0) {
    readinessScore = 100; // Past due
  } else if (daysRemaining <= 2) {
    readinessScore = 90;
  } else if (daysRemaining <= READINESS_CONFIG.monitoring_window_days) {
    readinessScore = 50 + (READINESS_CONFIG.monitoring_window_days - daysRemaining) * 10;
  } else {
    readinessScore = Math.max(0, 50 - (daysRemaining - READINESS_CONFIG.monitoring_window_days) * 5);
  }

  // Boost from quality analysis: if we're at or past optimal day
  if (qualityAnalysis?.optimalDay != null) {
    const currentGrowDays = prediction.baseline.days - daysRemaining;
    if (currentGrowDays >= qualityAnalysis.optimalDay) {
      readinessScore = Math.min(100, readinessScore + 15);
    }
  }

  // Boost from growth rate: if improving trend, slightly earlier harvest
  if (growthAnalysis?.trend === 'improving') {
    readinessScore = Math.min(100, readinessScore + 5);
  } else if (growthAnalysis?.trend === 'declining') {
    readinessScore = Math.min(100, readinessScore + 10); // Harvest sooner if declining
  }

  // Readiness level
  let level, message;
  if (readinessScore >= 90) {
    level = 'ready_now';
    const windowHours = daysRemaining <= 0
      ? READINESS_CONFIG.optimal_window_hours
      : Math.max(READINESS_CONFIG.optimal_window_hours, daysRemaining * 24);
    message = `${crop} (Group ${group.id}) ready now — optimal quality window: next ${windowHours} hours.`;
  } else if (readinessScore >= 70) {
    level = 'almost_ready';
    message = `${crop} (Group ${group.id}) approaching harvest readiness — ${daysRemaining} day${daysRemaining === 1 ? '' : 's'} remaining.`;
  } else if (readinessScore >= 50) {
    level = 'monitoring';
    message = `${crop} (Group ${group.id}) in pre-harvest monitoring window — ${daysRemaining} days until predicted harvest.`;
  } else {
    level = 'growing';
    message = `${crop} (Group ${group.id}) growing — estimated ${daysRemaining} days to harvest.`;
  }

  // Optimal harvest window
  const windowStart = qualityAnalysis?.optimalDay != null
    ? new Date(new Date(prediction.seedDate).getTime() + qualityAnalysis.optimalDay * 86400000)
    : predictedDate;
  const windowEnd = new Date(windowStart.getTime() + READINESS_CONFIG.optimal_window_hours * 3600000);

  return {
    groupId: group.id,
    crop,
    readinessScore,
    level,
    message,
    daysRemaining,
    predictedDate: predictedDate.toISOString(),
    optimalWindow: {
      start: windowStart.toISOString(),
      end: windowEnd.toISOString(),
      hours: READINESS_CONFIG.optimal_window_hours
    },
    growthAnalysis: growthAnalysis || null,
    qualityAnalysis: qualityAnalysis || null,
    confidence: prediction.confidence,
    factors: prediction.factors
  };
}

/**
 * Scan all active groups for harvest readiness.
 * Returns notifications for groups that are ready or approaching readiness.
 *
 * @param {object} harvestOutcomesDB - NeDB with experiment records
 * @param {object} [auditDB] - NeDB audit store for logging
 * @returns {Promise<Array>} Readiness assessments for notifiable groups
 */
export async function scanHarvestReadiness(harvestOutcomesDB, auditDB) {
  const predictor = new HarvestPredictor(DATA_DIR);
  const activeGroups = await predictor.getActiveGroups();

  if (activeGroups.length === 0) {
    return [];
  }

  // Load all experiment records for growth analysis
  let experimentRecords = [];
  if (harvestOutcomesDB) {
    try {
      experimentRecords = await harvestOutcomesDB.find({});
    } catch { experimentRecords = []; }
  }

  const log = loadReadinessLog();
  const notifications = [];
  const now = new Date();

  for (const group of activeGroups) {
    try {
      const prediction = await predictor.predict(group.id);
      const crop = group.crop || 'Unknown';

      // Only process groups in monitoring window or past due
      if (prediction.daysRemaining > READINESS_CONFIG.monitoring_window_days + 2) continue;

      const growthAnalysis = analyzeGrowthRate(crop, experimentRecords);
      const qualityAnalysis = analyzeQualityTrend(crop, experimentRecords);
      const assessment = assessReadiness(group, prediction, growthAnalysis, qualityAnalysis);

      // Only notify for ready_now or almost_ready
      if (assessment.level !== 'ready_now' && assessment.level !== 'almost_ready') continue;

      // Check re-notification throttle
      const lastNotif = log.notifications.find(n => n.groupId === group.id && n.level === assessment.level);
      if (lastNotif) {
        const hoursSince = (now - new Date(lastNotif.timestamp)) / 3600000;
        if (hoursSince < READINESS_CONFIG.re_notify_hours) continue;
      }

      notifications.push(assessment);

      // Log notification
      log.notifications.push({
        groupId: group.id,
        crop,
        level: assessment.level,
        message: assessment.message,
        readinessScore: assessment.readinessScore,
        timestamp: now.toISOString()
      });

      // Audit log
      if (auditDB) {
        await auditDB.insert({
          type: 'harvest_readiness',
          action: 'notification',
          agent_class: 'grow-advisor',
          crop,
          group_id: group.id,
          level: assessment.level,
          readiness_score: assessment.readinessScore,
          message: assessment.message,
          human_decision: 'auto',
          tier: 'auto',
          timestamp: now.toISOString()
        }).catch(() => {});
      }
    } catch (err) {
      // Non-fatal per group
      console.warn(`[harvest-readiness] Error assessing group ${group.id}:`, err.message);
    }
  }

  // Keep only last 100 notification entries
  if (log.notifications.length > 100) {
    log.notifications = log.notifications.slice(-100);
  }
  log.last_scan = now.toISOString();
  saveReadinessLog(log);

  if (notifications.length > 0) {
    console.log(`[harvest-readiness] ${notifications.length} group(s) flagged for harvest readiness`);
  }

  return notifications;
}

/**
 * Format readiness notification for push delivery.
 * Returns a simple push-ready message object.
 */
export function formatReadinessNotification(assessment) {
  return {
    title: assessment.level === 'ready_now'
      ? `🌿 Harvest Ready: ${assessment.crop}`
      : `📊 Approaching Harvest: ${assessment.crop}`,
    body: assessment.message,
    data: {
      type: 'harvest_readiness',
      groupId: assessment.groupId,
      crop: assessment.crop,
      level: assessment.level,
      readinessScore: assessment.readinessScore,
      optimalWindow: assessment.optimalWindow,
      daysRemaining: assessment.daysRemaining
    },
    priority: assessment.level === 'ready_now' ? 'high' : 'normal'
  };
}

export default {
  analyzeGrowthRate,
  analyzeQualityTrend,
  assessReadiness,
  scanHarvestReadiness,
  formatReadinessNotification
};
