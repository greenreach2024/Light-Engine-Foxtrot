/**
 * ML Performance Metrics & Monitoring
 * 
 * Collects and analyzes ML model performance metrics including:
 * - Prediction accuracy (RMSE, MAE, MAPE)
 * - Prediction vs actual comparisons
 * - Data drift detection (feature distribution changes)
 * - Concept drift detection (model performance degradation)
 * - Alerting for model quality issues
 * 
 * Metrics are stored with 30-day retention for historical analysis.
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.join(__dirname, '..');

// Configuration
const CONFIG = {
  metricsFile: path.join(PROJECT_ROOT, 'public', 'data', 'ml-metrics.json'),
  retentionDays: 30,
  maxMetricsPerZone: 1000, // Max metrics records per zone
  
  // Drift detection thresholds
  dataInputDriftThreshold: 0.15, // 15% change in mean/std triggers alert
  conceptDriftThreshold: 1.3, // 30% increase in error triggers alert
  minSamplesForDrift: 50, // Minimum samples needed for drift detection
  
  // Performance thresholds (alerts)
  rmseWarningThreshold: 3.0, // °C
  rmseCriticalThreshold: 4.0, // °C
  mapeWarningThreshold: 15.0, // %
  mapeCriticalThreshold: 25.0, // %
};

/**
 * Initialize metrics storage
 */
async function initializeStorage() {
  try {
    await fs.access(CONFIG.metricsFile);
  } catch {
    const initialMetrics = {
      zones: {},
      drift_alerts: [],
      created_at: new Date().toISOString(),
      last_updated: new Date().toISOString(),
    };
    await fs.writeFile(CONFIG.metricsFile, JSON.stringify(initialMetrics, null, 2));
  }
  return true;
}

/**
 * Load metrics from file
 */
async function loadMetrics() {
  try {
    const content = await fs.readFile(CONFIG.metricsFile, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.error('[ML Metrics] Failed to load metrics:', error);
    return {
      zones: {},
      drift_alerts: [],
      created_at: new Date().toISOString(),
      last_updated: new Date().toISOString(),
    };
  }
}

/**
 * Save metrics to file
 */
async function saveMetrics(metrics) {
  try {
    metrics.last_updated = new Date().toISOString();
    const tempFile = `${CONFIG.metricsFile}.tmp`;
    await fs.writeFile(tempFile, JSON.stringify(metrics, null, 2));
    await fs.rename(tempFile, CONFIG.metricsFile);
    return true;
  } catch (error) {
    console.error('[ML Metrics] Failed to save metrics:', error);
    return false;
  }
}

/**
 * Calculate metrics for prediction vs actual comparison
 */
function calculateAccuracyMetrics(predictions, actuals) {
  if (predictions.length !== actuals.length || predictions.length === 0) {
    throw new Error('Predictions and actuals must have same non-zero length');
  }
  
  let sumSquaredError = 0;
  let sumAbsoluteError = 0;
  let sumPercentageError = 0;
  let validMAPECount = 0;
  
  const errors = [];
  
  for (let i = 0; i < predictions.length; i++) {
    const error = actuals[i] - predictions[i];
    const absError = Math.abs(error);
    
    errors.push(error);
    sumSquaredError += error * error;
    sumAbsoluteError += absError;
    
    // MAPE only for non-zero actuals
    if (Math.abs(actuals[i]) > 0.01) {
      sumPercentageError += (absError / Math.abs(actuals[i])) * 100;
      validMAPECount++;
    }
  }
  
  const n = predictions.length;
  const rmse = Math.sqrt(sumSquaredError / n);
  const mae = sumAbsoluteError / n;
  const mape = validMAPECount > 0 ? sumPercentageError / validMAPECount : null;
  
  // Calculate error distribution statistics
  const meanError = errors.reduce((sum, e) => sum + e, 0) / n;
  const variance = errors.reduce((sum, e) => sum + Math.pow(e - meanError, 2), 0) / n;
  const stdError = Math.sqrt(variance);
  
  return {
    rmse,
    mae,
    mape,
    sample_count: n,
    mean_error: meanError,
    std_error: stdError,
    max_error: Math.max(...errors.map(Math.abs)),
  };
}

/**
 * Detect data drift by comparing recent vs historical feature distributions
 */
function detectDataDrift(recentFeatures, historicalFeatures) {
  if (!recentFeatures || !historicalFeatures) {
    return { drift_detected: false, reason: 'Insufficient data' };
  }
  
  if (recentFeatures.length < CONFIG.minSamplesForDrift) {
    return { drift_detected: false, reason: 'Insufficient recent samples' };
  }
  
  // Calculate mean and std for recent data
  const recentMean = recentFeatures.reduce((sum, val) => sum + val, 0) / recentFeatures.length;
  const recentVariance = recentFeatures.reduce((sum, val) => sum + Math.pow(val - recentMean, 2), 0) / recentFeatures.length;
  const recentStd = Math.sqrt(recentVariance);
  
  // Calculate mean and std for historical data
  const historicalMean = historicalFeatures.reduce((sum, val) => sum + val, 0) / historicalFeatures.length;
  const historicalVariance = historicalFeatures.reduce((sum, val) => sum + Math.pow(val - historicalMean, 2), 0) / historicalFeatures.length;
  const historicalStd = Math.sqrt(historicalVariance);
  
  // Calculate drift score (normalized difference in distribution)
  const meanDrift = Math.abs(recentMean - historicalMean) / (historicalStd + 0.001); // Avoid division by zero
  const stdDrift = Math.abs(recentStd - historicalStd) / (historicalStd + 0.001);
  
  const driftScore = (meanDrift + stdDrift) / 2;
  const driftDetected = driftScore > CONFIG.dataInputDriftThreshold;
  
  return {
    drift_detected: driftDetected,
    drift_score: driftScore,
    threshold: CONFIG.dataInputDriftThreshold,
    recent_mean: recentMean,
    historical_mean: historicalMean,
    recent_std: recentStd,
    historical_std: historicalStd,
    mean_drift: meanDrift,
    std_drift: stdDrift,
  };
}

/**
 * Detect concept drift by comparing recent vs historical model performance
 */
function detectConceptDrift(recentMetrics, historicalMetrics) {
  if (!recentMetrics || !historicalMetrics) {
    return { drift_detected: false, reason: 'Insufficient metrics' };
  }
  
  // Compare RMSE (primary indicator)
  const rmseRatio = recentMetrics.rmse / historicalMetrics.rmse;
  const rmseDrift = rmseRatio > CONFIG.conceptDriftThreshold;
  
  // Compare MAE as secondary indicator
  const maeRatio = recentMetrics.mae / historicalMetrics.mae;
  const maeDrift = maeRatio > CONFIG.conceptDriftThreshold;
  
  const driftDetected = rmseDrift || maeDrift;
  
  return {
    drift_detected: driftDetected,
    rmse_ratio: rmseRatio,
    mae_ratio: maeRatio,
    threshold: CONFIG.conceptDriftThreshold,
    recent_rmse: recentMetrics.rmse,
    historical_rmse: historicalMetrics.rmse,
    recent_mae: recentMetrics.mae,
    historical_mae: historicalMetrics.mae,
    severity: rmseDrift && maeDrift ? 'critical' : 'warning',
  };
}

/**
 * Record prediction and actual value for metrics tracking
 */
async function recordPrediction(zone, prediction, actual, timestamp = null) {
  await initializeStorage();
  
  const metrics = await loadMetrics();
  
  // Initialize zone if not exists
  if (!metrics.zones[zone]) {
    metrics.zones[zone] = {
      predictions: [],
      accuracy_history: [],
      drift_checks: [],
    };
  }
  
  const zoneMetrics = metrics.zones[zone];
  
  // Add prediction record
  zoneMetrics.predictions.push({
    timestamp: timestamp || new Date().toISOString(),
    predicted: prediction,
    actual: actual,
    error: actual - prediction,
    abs_error: Math.abs(actual - prediction),
  });
  
  // Limit predictions to max size (FIFO)
  if (zoneMetrics.predictions.length > CONFIG.maxMetricsPerZone) {
    zoneMetrics.predictions = zoneMetrics.predictions.slice(-CONFIG.maxMetricsPerZone);
  }
  
  // Clean up old records (30-day retention)
  const cutoffDate = new Date(Date.now() - CONFIG.retentionDays * 24 * 60 * 60 * 1000);
  zoneMetrics.predictions = zoneMetrics.predictions.filter(p => 
    new Date(p.timestamp) > cutoffDate
  );
  
  await saveMetrics(metrics);
  
  return true;
}

/**
 * Calculate and store accuracy metrics for a zone
 */
async function calculateZoneAccuracy(zone, windowHours = 24) {
  const metrics = await loadMetrics();
  
  if (!metrics.zones[zone] || !metrics.zones[zone].predictions) {
    return null;
  }
  
  const zoneMetrics = metrics.zones[zone];
  
  // Filter predictions within time window
  const cutoffTime = new Date(Date.now() - windowHours * 60 * 60 * 1000);
  const recentPredictions = zoneMetrics.predictions.filter(p => 
    new Date(p.timestamp) > cutoffTime
  );
  
  if (recentPredictions.length === 0) {
    return null;
  }
  
  // Extract predictions and actuals
  const predictions = recentPredictions.map(p => p.predicted);
  const actuals = recentPredictions.map(p => p.actual);
  
  // Calculate accuracy metrics
  const accuracy = calculateAccuracyMetrics(predictions, actuals);
  
  // Add metadata
  accuracy.zone = zone;
  accuracy.window_hours = windowHours;
  accuracy.calculated_at = new Date().toISOString();
  
  // Determine alert level
  if (accuracy.rmse >= CONFIG.rmseCriticalThreshold) {
    accuracy.alert_level = 'critical';
  } else if (accuracy.rmse >= CONFIG.rmseWarningThreshold) {
    accuracy.alert_level = 'warning';
  } else {
    accuracy.alert_level = 'ok';
  }
  
  // Store in history
  if (!zoneMetrics.accuracy_history) {
    zoneMetrics.accuracy_history = [];
  }
  
  zoneMetrics.accuracy_history.push(accuracy);
  
  // Limit history size
  if (zoneMetrics.accuracy_history.length > 720) { // 30 days of hourly checks
    zoneMetrics.accuracy_history = zoneMetrics.accuracy_history.slice(-720);
  }
  
  await saveMetrics(metrics);
  
  return accuracy;
}

/**
 * Check for data drift in recent predictions
 */
async function checkDataDrift(zone, feature = 'temperature') {
  const metrics = await loadMetrics();
  
  if (!metrics.zones[zone]) {
    return { drift_detected: false, reason: 'No metrics for zone' };
  }
  
  const zoneMetrics = metrics.zones[zone];
  const predictions = zoneMetrics.predictions || [];
  
  if (predictions.length < CONFIG.minSamplesForDrift * 2) {
    return { drift_detected: false, reason: 'Insufficient data for drift detection' };
  }
  
  // Split into recent (last 20%) and historical (first 80%)
  const splitIndex = Math.floor(predictions.length * 0.8);
  const historicalData = predictions.slice(0, splitIndex).map(p => p.actual);
  const recentData = predictions.slice(splitIndex).map(p => p.actual);
  
  // Detect drift
  const driftResult = detectDataDrift(recentData, historicalData);
  
  // Record drift check
  if (!zoneMetrics.drift_checks) {
    zoneMetrics.drift_checks = [];
  }
  
  zoneMetrics.drift_checks.push({
    type: 'data_drift',
    feature,
    ...driftResult,
    checked_at: new Date().toISOString(),
  });
  
  // Limit drift checks history
  if (zoneMetrics.drift_checks.length > 168) { // 7 days of hourly checks
    zoneMetrics.drift_checks = zoneMetrics.drift_checks.slice(-168);
  }
  
  // Add drift alert if detected
  if (driftResult.drift_detected) {
    metrics.drift_alerts.push({
      zone,
      type: 'data_drift',
      feature,
      drift_score: driftResult.drift_score,
      severity: driftResult.drift_score > 0.3 ? 'critical' : 'warning',
      detected_at: new Date().toISOString(),
    });
    
    // Limit alerts
    if (metrics.drift_alerts.length > 100) {
      metrics.drift_alerts = metrics.drift_alerts.slice(-100);
    }
  }
  
  await saveMetrics(metrics);
  
  return driftResult;
}

/**
 * Check for concept drift (model performance degradation)
 */
async function checkConceptDrift(zone) {
  const metrics = await loadMetrics();
  
  if (!metrics.zones[zone] || !metrics.zones[zone].accuracy_history) {
    return { drift_detected: false, reason: 'No accuracy history for zone' };
  }
  
  const accuracyHistory = metrics.zones[zone].accuracy_history;
  
  if (accuracyHistory.length < 48) { // Need at least 48 hours of data
    return { drift_detected: false, reason: 'Insufficient accuracy history' };
  }
  
  // Compare recent (last 24h) vs historical (previous 24-48h)
  const recentMetrics = accuracyHistory.slice(-24); // Last 24 records
  const historicalMetrics = accuracyHistory.slice(-48, -24); // Previous 24 records
  
  // Calculate average metrics for each period
  const avgRecent = {
    rmse: recentMetrics.reduce((sum, m) => sum + m.rmse, 0) / recentMetrics.length,
    mae: recentMetrics.reduce((sum, m) => sum + m.mae, 0) / recentMetrics.length,
  };
  
  const avgHistorical = {
    rmse: historicalMetrics.reduce((sum, m) => sum + m.rmse, 0) / historicalMetrics.length,
    mae: historicalMetrics.reduce((sum, m) => sum + m.mae, 0) / historicalMetrics.length,
  };
  
  // Detect concept drift
  const driftResult = detectConceptDrift(avgRecent, avgHistorical);
  
  // Record drift check
  const zoneMetrics = metrics.zones[zone];
  if (!zoneMetrics.drift_checks) {
    zoneMetrics.drift_checks = [];
  }
  
  zoneMetrics.drift_checks.push({
    type: 'concept_drift',
    ...driftResult,
    checked_at: new Date().toISOString(),
  });
  
  // Add drift alert if detected
  if (driftResult.drift_detected) {
    metrics.drift_alerts.push({
      zone,
      type: 'concept_drift',
      rmse_ratio: driftResult.rmse_ratio,
      severity: driftResult.severity,
      detected_at: new Date().toISOString(),
    });
    
    // Limit alerts
    if (metrics.drift_alerts.length > 100) {
      metrics.drift_alerts = metrics.drift_alerts.slice(-100);
    }
  }
  
  await saveMetrics(metrics);
  
  return driftResult;
}

/**
 * Get health status for all zones
 */
async function getHealthStatus() {
  const metrics = await loadMetrics();
  
  const status = {
    overall: 'healthy',
    zones: {},
    alerts: metrics.drift_alerts.slice(-10), // Last 10 alerts
    timestamp: new Date().toISOString(),
  };
  
  // Check each zone
  for (const [zone, zoneMetrics] of Object.entries(metrics.zones)) {
    const latestAccuracy = zoneMetrics.accuracy_history?.slice(-1)[0];
    
    if (!latestAccuracy) {
      status.zones[zone] = {
        health: 'unknown',
        reason: 'No accuracy data',
      };
      continue;
    }
    
    const health = {
      health: latestAccuracy.alert_level,
      rmse: latestAccuracy.rmse,
      mae: latestAccuracy.mae,
      mape: latestAccuracy.mape,
      sample_count: latestAccuracy.sample_count,
      last_updated: latestAccuracy.calculated_at,
    };
    
    // Check for recent drift alerts
    const recentDriftAlerts = metrics.drift_alerts.filter(alert => 
      alert.zone === zone &&
      new Date(alert.detected_at) > new Date(Date.now() - 24 * 60 * 60 * 1000)
    );
    
    if (recentDriftAlerts.length > 0) {
      health.drift_alerts = recentDriftAlerts.length;
      health.health = 'warning';
    }
    
    status.zones[zone] = health;
    
    // Update overall status
    if (health.health === 'critical') {
      status.overall = 'critical';
    } else if (health.health === 'warning' && status.overall !== 'critical') {
      status.overall = 'warning';
    }
  }
  
  return status;
}

/**
 * Get metrics summary for a zone
 */
async function getZoneSummary(zone, days = 7) {
  const metrics = await loadMetrics();
  
  if (!metrics.zones[zone]) {
    return null;
  }
  
  const zoneMetrics = metrics.zones[zone];
  const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  
  // Filter recent accuracy history
  const recentAccuracy = (zoneMetrics.accuracy_history || []).filter(a => 
    new Date(a.calculated_at) > cutoffDate
  );
  
  // Filter recent drift checks
  const recentDriftChecks = (zoneMetrics.drift_checks || []).filter(d => 
    new Date(d.checked_at) > cutoffDate
  );
  
  // Calculate summary statistics
  const summary = {
    zone,
    days,
    accuracy: {
      count: recentAccuracy.length,
      avg_rmse: recentAccuracy.length > 0 
        ? recentAccuracy.reduce((sum, a) => sum + a.rmse, 0) / recentAccuracy.length 
        : null,
      avg_mae: recentAccuracy.length > 0 
        ? recentAccuracy.reduce((sum, a) => sum + a.mae, 0) / recentAccuracy.length 
        : null,
      avg_mape: recentAccuracy.length > 0 && recentAccuracy[0].mape !== null
        ? recentAccuracy.reduce((sum, a) => sum + (a.mape || 0), 0) / recentAccuracy.length 
        : null,
      latest: recentAccuracy.slice(-1)[0] || null,
    },
    drift: {
      data_drift_checks: recentDriftChecks.filter(d => d.type === 'data_drift').length,
      concept_drift_checks: recentDriftChecks.filter(d => d.type === 'concept_drift').length,
      drift_detected: recentDriftChecks.some(d => d.drift_detected),
      latest_drift: recentDriftChecks.slice(-1)[0] || null,
    },
    predictions: {
      count: zoneMetrics.predictions?.length || 0,
      recent_count: (zoneMetrics.predictions || []).filter(p => 
        new Date(p.timestamp) > cutoffDate
      ).length,
    },
  };
  
  return summary;
}

// Export functions
export default {
  initializeStorage,
  loadMetrics,
  saveMetrics,
  calculateAccuracyMetrics,
  detectDataDrift,
  detectConceptDrift,
  recordPrediction,
  calculateZoneAccuracy,
  checkDataDrift,
  checkConceptDrift,
  getHealthStatus,
  getZoneSummary,
  CONFIG,
};
