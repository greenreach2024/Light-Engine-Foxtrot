/**
 * Model Retraining Pipeline
 * 
 * Automated workflow for periodically retraining SARIMAX models with fresh data.
 * Includes validation metrics, A/B testing, and rollback capabilities.
 * 
 * Features:
 * - Automatic model retraining with configurable intervals
 * - Train/test split with validation metrics (RMSE, MAE, MAPE)
 * - Model versioning and metadata storage
 * - A/B testing with gradual rollout (baseline vs candidate)
 * - Automatic rollback on quality degradation
 * - Model performance history tracking
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.join(__dirname, '..');

// Configuration
const CONFIG = {
  // Model storage paths
  modelsDir: path.join(PROJECT_ROOT, 'public', 'data', 'ml-models'),
  historyFile: path.join(PROJECT_ROOT, 'public', 'data', 'ml-models', 'training-history.json'),
  
  // Retraining settings
  minTrainingSamples: 168, // 1 week of hourly data minimum
  trainTestSplitRatio: 0.8, // 80% train, 20% test
  maxModelAge: 7 * 24 * 60 * 60 * 1000, // 7 days in milliseconds
  
  // Quality thresholds
  maxAcceptableRMSE: 3.0, // Maximum RMSE for temperature predictions (°C)
  maxAcceptableMAPE: 15.0, // Maximum MAPE (%)
  minImprovementThreshold: 0.05, // 5% improvement to justify model replacement
  
  // A/B testing
  abTestingEnabled: true,
  initialTrafficPercent: 10, // Start with 10% of predictions using new model
  trafficIncrementPercent: 20, // Increase by 20% each evaluation
  evaluationWindowHours: 24, // Evaluate performance over 24 hours
  
  // Rollback
  autoRollbackEnabled: true,
  rollbackThresholdMultiplier: 1.5, // Rollback if RMSE > 1.5x baseline
};

/**
 * Initialize model storage directories
 */
async function initializeStorage() {
  try {
    await fs.mkdir(CONFIG.modelsDir, { recursive: true });
    
    // Initialize history file if it doesn't exist
    try {
      await fs.access(CONFIG.historyFile);
    } catch {
      const initialHistory = {
        models: [],
        ab_tests: [],
        rollbacks: [],
        created_at: new Date().toISOString(),
      };
      await fs.writeFile(CONFIG.historyFile, JSON.stringify(initialHistory, null, 2));
    }
    
    return true;
  } catch (error) {
    console.error('[Model Retrainer] Failed to initialize storage:', error);
    return false;
  }
}

/**
 * Load training history from file
 */
async function loadHistory() {
  try {
    const content = await fs.readFile(CONFIG.historyFile, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.error('[Model Retrainer] Failed to load history:', error);
    return {
      models: [],
      ab_tests: [],
      rollbacks: [],
      created_at: new Date().toISOString(),
    };
  }
}

/**
 * Save training history to file
 */
async function saveHistory(history) {
  try {
    // Atomic write: temp file + rename
    const tempFile = `${CONFIG.historyFile}.tmp`;
    await fs.writeFile(tempFile, JSON.stringify(history, null, 2));
    await fs.rename(tempFile, CONFIG.historyFile);
    return true;
  } catch (error) {
    console.error('[Model Retrainer] Failed to save history:', error);
    return false;
  }
}

/**
 * Check if model needs retraining based on age
 */
async function checkModelAge(zone) {
  try {
    const modelPath = path.join(CONFIG.modelsDir, `${zone}-model-metadata.json`);
    const metadata = JSON.parse(await fs.readFile(modelPath, 'utf-8'));
    
    const modelAge = Date.now() - new Date(metadata.trained_at).getTime();
    const needsRetraining = modelAge > CONFIG.maxModelAge;
    
    return {
      needs_retraining: needsRetraining,
      age_ms: modelAge,
      age_days: modelAge / (24 * 60 * 60 * 1000),
      last_trained: metadata.trained_at,
    };
  } catch (error) {
    // Model doesn't exist or metadata missing - needs training
    return {
      needs_retraining: true,
      age_ms: null,
      age_days: null,
      last_trained: null,
      reason: 'Model not found or metadata missing',
    };
  }
}

/**
 * Calculate validation metrics for model predictions
 */
function calculateMetrics(actual, predicted) {
  if (actual.length !== predicted.length || actual.length === 0) {
    throw new Error('Actual and predicted arrays must have same non-zero length');
  }
  
  let sumSquaredError = 0;
  let sumAbsoluteError = 0;
  let sumPercentageError = 0;
  let validMAPECount = 0;
  
  for (let i = 0; i < actual.length; i++) {
    const error = actual[i] - predicted[i];
    sumSquaredError += error * error;
    sumAbsoluteError += Math.abs(error);
    
    // MAPE only for non-zero actuals
    if (Math.abs(actual[i]) > 0.01) {
      sumPercentageError += Math.abs(error / actual[i]) * 100;
      validMAPECount++;
    }
  }
  
  const n = actual.length;
  const rmse = Math.sqrt(sumSquaredError / n);
  const mae = sumAbsoluteError / n;
  const mape = validMAPECount > 0 ? sumPercentageError / validMAPECount : null;
  
  return { rmse, mae, mape, sample_count: n };
}

/**
 * Train a new SARIMAX model using Python backend
 * 
 * NOTE: This is currently a mock implementation that demonstrates
 * the workflow. In production, this would call the actual Python
 * training script and save a real model file.
 */
async function trainModel(zone, options = {}) {
  const {
    forecastHours = 4,
    historyDays = 30,
    outputDir = CONFIG.modelsDir,
  } = options;
  
  console.log(`[Model Retrainer] Training model for zone: ${zone} (MOCK)`);
  
  // Simulate training time
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Mock training result
  // In production, this would:
  // 1. Load historical environmental data (last 30 days)
  // 2. Train SARIMAX model with outdoor influence features
  // 3. Validate on test set (last 20% of data)
  // 4. Save model to .pkl file
  // 5. Return training metrics
  
  const modelPath = path.join(outputDir, `${zone}-model-v${Date.now()}.pkl`);
  
  // Create dummy model file (in production this would be the actual trained model)
  await fs.writeFile(modelPath, JSON.stringify({
    zone,
    trained_at: new Date().toISOString(),
    model_type: 'SARIMAX',
    order: [1, 0, 1],
    seasonal_order: [1, 0, 1, 24],
  }));
  
  const result = {
    zone,
    model_path: modelPath,
    training_samples: 500 + Math.floor(Math.random() * 200), // Simulate variable sample size
    test_samples: 100 + Math.floor(Math.random() * 50),
    metrics: {
      train_rmse: 2.0 + Math.random() * 0.5,
      train_mae: 1.5 + Math.random() * 0.3,
      test_rmse: 2.3 + Math.random() * 0.5,
      test_mae: 1.7 + Math.random() * 0.3,
    },
    trained_at: new Date().toISOString(),
  };
  
  console.log(`[Model Retrainer] [OK] Model training complete for ${zone}`);
  console.log(`[Model Retrainer]   Test RMSE: ${result.metrics.test_rmse.toFixed(2)}°C`);
  console.log(`[Model Retrainer]   Test MAE: ${result.metrics.test_mae.toFixed(2)}°C`);
  
  return result;
}

/**
 * Validate a trained model against test set
 */
async function validateModel(zone, modelPath, testData) {
  // In production, this would run predictions on test set
  // For now, we'll use metrics from training process
  
  // This is a placeholder - actual validation would involve:
  // 1. Load test data (last 20% of time series)
  // 2. Generate predictions using trained model
  // 3. Calculate RMSE, MAE, MAPE
  // 4. Compare against baseline model
  
  console.log(`[Model Retrainer] Validating model for zone: ${zone}`);
  
  return {
    zone,
    model_path: modelPath,
    metrics: {
      rmse: 2.5, // Placeholder - would be calculated from test predictions
      mae: 1.8,
      mape: 8.5,
      sample_count: 100,
    },
    test_data_size: testData ? testData.length : 0,
    validated_at: new Date().toISOString(),
  };
}

/**
 * Compare candidate model against baseline
 */
function compareModels(baselineMetrics, candidateMetrics) {
  const rmseImprovement = ((baselineMetrics.rmse - candidateMetrics.rmse) / baselineMetrics.rmse) * 100;
  const maeImprovement = ((baselineMetrics.mae - candidateMetrics.mae) / baselineMetrics.mae) * 100;
  const mapeImprovement = baselineMetrics.mape && candidateMetrics.mape
    ? ((baselineMetrics.mape - candidateMetrics.mape) / baselineMetrics.mape) * 100
    : null;
  
  const avgImprovement = mapeImprovement !== null
    ? (rmseImprovement + maeImprovement + mapeImprovement) / 3
    : (rmseImprovement + maeImprovement) / 2;
  
  const isAcceptable = candidateMetrics.rmse <= CONFIG.maxAcceptableRMSE &&
                       (candidateMetrics.mape === null || candidateMetrics.mape <= CONFIG.maxAcceptableMAPE);
  
  const isImprovement = avgImprovement > CONFIG.minImprovementThreshold;
  
  return {
    rmse_improvement_pct: rmseImprovement,
    mae_improvement_pct: maeImprovement,
    mape_improvement_pct: mapeImprovement,
    avg_improvement_pct: avgImprovement,
    is_acceptable: isAcceptable,
    is_improvement: isImprovement,
    should_promote: isAcceptable && isImprovement,
  };
}

/**
 * Promote candidate model to production
 */
async function promoteModel(zone, candidatePath, metadata) {
  try {
    const baselinePath = path.join(CONFIG.modelsDir, `${zone}-model.pkl`);
    
    // Backup current baseline (if exists)
    const backupPath = path.join(CONFIG.modelsDir, `${zone}-model-backup.pkl`);
    try {
      await fs.copyFile(baselinePath, backupPath);
    } catch {
      // No baseline to backup (first model)
    }
    
    // Promote candidate to baseline
    await fs.copyFile(candidatePath, baselinePath);
    
    // Save metadata
    const metadataPath = path.join(CONFIG.modelsDir, `${zone}-model-metadata.json`);
    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
    
    console.log(`[Model Retrainer] [OK] Promoted to production for zone: ${zone}`);
    
    return true;
  } catch (error) {
    console.error('[Model Retrainer] Failed to promote model:', error);
    return false;
  }
}

/**
 * Rollback to previous model version
 */
async function rollbackModel(zone, reason) {
  try {
    const baselinePath = path.join(CONFIG.modelsDir, `${zone}-model.pkl`);
    const backupPath = path.join(CONFIG.modelsDir, `${zone}-model-backup.pkl`);
    
    // Check if backup exists
    try {
      await fs.access(backupPath);
    } catch {
      throw new Error('No backup model available for rollback');
    }
    
    // Restore backup
    await fs.copyFile(backupPath, baselinePath);
    
    // Record rollback in history
    const history = await loadHistory();
    history.rollbacks.push({
      zone,
      reason,
      rolled_back_at: new Date().toISOString(),
    });
    await saveHistory(history);
    
    console.log(`[Model Retrainer] ⚠ Rolled back model for zone: ${zone}. Reason: ${reason}`);
    
    return true;
  } catch (error) {
    console.error('[Model Retrainer] Failed to rollback model:', error);
    return false;
  }
}

/**
 * Run A/B test for candidate model
 */
async function runABTest(zone, candidateVersion, metrics) {
  if (!CONFIG.abTestingEnabled) {
    return { success: false, reason: 'A/B testing disabled' };
  }
  
  const history = await loadHistory();
  
  // Create A/B test record
  const abTest = {
    zone,
    candidate_version: candidateVersion,
    baseline_metrics: metrics.baseline,
    candidate_metrics: metrics.candidate,
    traffic_percent: CONFIG.initialTrafficPercent,
    started_at: new Date().toISOString(),
    status: 'running',
    evaluations: [],
  };
  
  history.ab_tests.push(abTest);
  await saveHistory(history);
  
  console.log(`[Model Retrainer] Started A/B test for zone: ${zone} (${CONFIG.initialTrafficPercent}% traffic)`);
  
  return {
    success: true,
    test_id: history.ab_tests.length - 1,
    traffic_percent: CONFIG.initialTrafficPercent,
  };
}

/**
 * Evaluate ongoing A/B test and adjust traffic
 */
async function evaluateABTest(zone, testId) {
  const history = await loadHistory();
  const abTest = history.ab_tests[testId];
  
  if (!abTest || abTest.status !== 'running') {
    return { success: false, reason: 'Test not found or not running' };
  }
  
  // In production, this would collect real prediction metrics
  // For now, use simulated evaluation
  const evaluation = {
    evaluated_at: new Date().toISOString(),
    traffic_percent: abTest.traffic_percent,
    candidate_rmse: abTest.candidate_metrics.rmse * (0.95 + Math.random() * 0.1), // Simulate slight variation
    decision: 'continue',
  };
  
  // Check if candidate is performing well
  const performanceRatio = evaluation.candidate_rmse / abTest.baseline_metrics.rmse;
  
  if (performanceRatio > CONFIG.rollbackThresholdMultiplier) {
    // Candidate performing poorly - rollback
    evaluation.decision = 'rollback';
    abTest.status = 'failed';
    await rollbackModel(zone, `A/B test failed: RMSE ${performanceRatio.toFixed(2)}x baseline`);
  } else if (abTest.traffic_percent >= 100) {
    // Test complete - promote candidate
    evaluation.decision = 'promote';
    abTest.status = 'completed';
  } else {
    // Increase traffic
    abTest.traffic_percent = Math.min(100, abTest.traffic_percent + CONFIG.trafficIncrementPercent);
    evaluation.new_traffic_percent = abTest.traffic_percent;
  }
  
  abTest.evaluations.push(evaluation);
  await saveHistory(history);
  
  console.log(`[Model Retrainer] A/B test evaluation for zone ${zone}: ${evaluation.decision} (traffic: ${abTest.traffic_percent}%)`);
  
  return {
    success: true,
    decision: evaluation.decision,
    traffic_percent: abTest.traffic_percent,
  };
}

/**
 * Main retraining workflow for a zone
 */
async function retrainZone(zone, options = {}) {
  const { force = false } = options;
  
  console.log(`[Model Retrainer] Starting retraining workflow for zone: ${zone}`);
  
  const result = {
    zone,
    timestamp: new Date().toISOString(),
    success: false,
    steps: [],
  };
  
  try {
    // Step 1: Initialize storage
    await initializeStorage();
    result.steps.push({ step: 'initialize', status: 'ok' });
    
    // Step 2: Check if retraining needed
    if (!force) {
      const ageCheck = await checkModelAge(zone);
      result.steps.push({ step: 'age_check', status: 'ok', data: ageCheck });
      
      if (!ageCheck.needs_retraining) {
        console.log(`[Model Retrainer] Model for ${zone} is recent (${ageCheck.age_days?.toFixed(1)} days). Skipping.`);
        result.success = true;
        result.skipped = true;
        result.reason = 'Model is recent';
        return result;
      }
    }
    
    // Step 3: Train new candidate model
    const candidateVersion = Date.now();
    const trainingResult = await trainModel(zone, {
      outputDir: CONFIG.modelsDir,
    });
    result.steps.push({ step: 'train', status: 'ok', data: trainingResult });
    
    // Step 4: Validate candidate model
    const validationResult = await validateModel(zone, trainingResult.model_path, null);
    result.steps.push({ step: 'validate', status: 'ok', data: validationResult });
    
    // Step 5: Load baseline metrics (if exists)
    let baselineMetrics;
    try {
      const baselineMeta = await fs.readFile(
        path.join(CONFIG.modelsDir, `${zone}-model-metadata.json`),
        'utf-8'
      );
      baselineMetrics = JSON.parse(baselineMeta).metrics;
    } catch {
      baselineMetrics = null; // No baseline - first model
    }
    
    // Step 6: Compare models
    if (baselineMetrics) {
      const comparison = compareModels(baselineMetrics, validationResult.metrics);
      result.steps.push({ step: 'compare', status: 'ok', data: comparison });
      
      if (!comparison.should_promote) {
        console.log(`[Model Retrainer] ⚠ Candidate model not better than baseline for zone: ${zone}`);
        result.success = false;
        result.reason = 'Candidate model not better than baseline';
        return result;
      }
    }
    
    // Step 7: Promote or start A/B test
    const metadata = {
      zone,
      version: candidateVersion,
      trained_at: new Date().toISOString(),
      metrics: validationResult.metrics,
      training_samples: trainingResult.training_samples || 0,
    };
    
    if (CONFIG.abTestingEnabled && baselineMetrics) {
      // Start A/B test
      const abTestResult = await runABTest(zone, candidateVersion, {
        baseline: baselineMetrics,
        candidate: validationResult.metrics,
      });
      result.steps.push({ step: 'ab_test', status: 'ok', data: abTestResult });
      result.ab_test_started = true;
    } else {
      // Direct promotion (first model or A/B testing disabled)
      const promoted = await promoteModel(zone, trainingResult.model_path, metadata);
      result.steps.push({ step: 'promote', status: promoted ? 'ok' : 'failed' });
      result.promoted = promoted;
    }
    
    // Step 8: Record in history
    const history = await loadHistory();
    history.models.push(metadata);
    await saveHistory(history);
    result.steps.push({ step: 'record_history', status: 'ok' });
    
    result.success = true;
    console.log(`[Model Retrainer] [OK] Retraining workflow complete for zone: ${zone}`);
    
  } catch (error) {
    console.error(`[Model Retrainer] Retraining failed for zone ${zone}:`, error);
    result.success = false;
    result.error = error.message;
    result.steps.push({ step: 'error', status: 'failed', error: error.message });
  }
  
  return result;
}

/**
 * Retrain all zones
 */
async function retrainAll(options = {}) {
  const zones = ['main', 'veg', 'flower', 'propagation']; // Default zones
  const results = [];
  
  console.log('[Model Retrainer] Starting retraining for all zones');
  
  for (const zone of zones) {
    const result = await retrainZone(zone, options);
    results.push(result);
  }
  
  const summary = {
    total: results.length,
    succeeded: results.filter(r => r.success).length,
    failed: results.filter(r => !r.success && !r.skipped).length,
    skipped: results.filter(r => r.skipped).length,
    results,
  };
  
  console.log(`[Model Retrainer] Retraining complete: ${summary.succeeded} succeeded, ${summary.failed} failed, ${summary.skipped} skipped`);
  
  return summary;
}

// Export functions
export {
  initializeStorage,
  checkModelAge,
  calculateMetrics,
  trainModel,
  validateModel,
  compareModels,
  promoteModel,
  rollbackModel,
  runABTest,
  evaluateABTest,
  retrainZone,
  retrainAll,
  loadHistory,
  saveHistory,
  CONFIG,
};
