/**
 * Test script for Model Retraining Pipeline
 * 
 * Tests all components of the automated model retraining workflow.
 */

import {
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
  loadHistory,
  saveHistory,
  CONFIG,
} from '../lib/model-retrainer.js';

const log = {
  info: (msg) => console.log(`[TEST] ${msg}`),
  success: (msg) => console.log(`[TEST] ✓ ${msg}`),
  error: (msg) => console.error(`[TEST] ✗ ${msg}`),
};

/**
 * Test 1: Storage initialization
 */
async function testStorageInit() {
  log.info('Test 1: Initialize storage');
  
  const result = await initializeStorage();
  
  if (result) {
    log.success('Storage initialized');
  } else {
    log.error('Storage initialization failed');
  }
  
  return result;
}

/**
 * Test 2: Check model age
 */
async function testModelAge() {
  log.info('Test 2: Check model age');
  
  const zones = ['main', 'veg', 'flower'];
  
  for (const zone of zones) {
    const ageCheck = await checkModelAge(zone);
    log.info(`  Zone: ${zone}`);
    log.info(`    Needs retraining: ${ageCheck.needs_retraining}`);
    log.info(`    Age: ${ageCheck.age_days ? ageCheck.age_days.toFixed(2) + ' days' : 'N/A'}`);
    log.info(`    Last trained: ${ageCheck.last_trained || 'Never'}`);
  }
  
  log.success('Model age check complete');
  return true;
}

/**
 * Test 3: Calculate validation metrics
 */
function testCalculateMetrics() {
  log.info('Test 3: Calculate validation metrics');
  
  // Test case 1: Perfect predictions
  const actual1 = [20, 21, 22, 23, 24];
  const predicted1 = [20, 21, 22, 23, 24];
  const metrics1 = calculateMetrics(actual1, predicted1);
  
  log.info('  Perfect predictions:');
  log.info(`    RMSE: ${metrics1.rmse.toFixed(4)} (expected: 0)`);
  log.info(`    MAE: ${metrics1.mae.toFixed(4)} (expected: 0)`);
  log.info(`    MAPE: ${metrics1.mape ? metrics1.mape.toFixed(4) : 'N/A'}% (expected: 0)`);
  
  if (metrics1.rmse < 0.001 && metrics1.mae < 0.001) {
    log.success('Perfect predictions test passed');
  } else {
    log.error('Perfect predictions test failed');
    return false;
  }
  
  // Test case 2: Predictions with error
  const actual2 = [20, 21, 22, 23, 24];
  const predicted2 = [20.5, 21.5, 22.5, 23.5, 24.5];
  const metrics2 = calculateMetrics(actual2, predicted2);
  
  log.info('  Predictions with +0.5°C error:');
  log.info(`    RMSE: ${metrics2.rmse.toFixed(4)} (expected: ~0.5)`);
  log.info(`    MAE: ${metrics2.mae.toFixed(4)} (expected: 0.5)`);
  log.info(`    MAPE: ${metrics2.mape ? metrics2.mape.toFixed(4) : 'N/A'}% (expected: ~2.2%)`);
  
  if (Math.abs(metrics2.rmse - 0.5) < 0.01 && Math.abs(metrics2.mae - 0.5) < 0.01) {
    log.success('Error predictions test passed');
  } else {
    log.error('Error predictions test failed');
    return false;
  }
  
  // Test case 3: Edge case - empty arrays
  try {
    calculateMetrics([], []);
    log.error('Empty array test should have thrown error');
    return false;
  } catch (err) {
    log.success('Empty array test passed (error thrown as expected)');
  }
  
  log.success('Calculate metrics tests complete');
  return true;
}

/**
 * Test 4: Compare models
 */
function testCompareModels() {
  log.info('Test 4: Compare baseline and candidate models');
  
  const baselineMetrics = {
    rmse: 3.0,
    mae: 2.5,
    mape: 10.0,
  };
  
  // Test case 1: Improved candidate
  const candidateMetrics1 = {
    rmse: 2.5,
    mae: 2.0,
    mape: 8.0,
  };
  
  const comparison1 = compareModels(baselineMetrics, candidateMetrics1);
  
  log.info('  Improved candidate:');
  log.info(`    RMSE improvement: ${comparison1.rmse_improvement_pct.toFixed(2)}%`);
  log.info(`    MAE improvement: ${comparison1.mae_improvement_pct.toFixed(2)}%`);
  log.info(`    MAPE improvement: ${comparison1.mape_improvement_pct.toFixed(2)}%`);
  log.info(`    Avg improvement: ${comparison1.avg_improvement_pct.toFixed(2)}%`);
  log.info(`    Should promote: ${comparison1.should_promote}`);
  
  if (comparison1.should_promote) {
    log.success('Improved candidate test passed');
  } else {
    log.error('Improved candidate test failed');
    return false;
  }
  
  // Test case 2: Worse candidate
  const candidateMetrics2 = {
    rmse: 3.5,
    mae: 3.0,
    mape: 12.0,
  };
  
  const comparison2 = compareModels(baselineMetrics, candidateMetrics2);
  
  log.info('  Worse candidate:');
  log.info(`    RMSE improvement: ${comparison2.rmse_improvement_pct.toFixed(2)}%`);
  log.info(`    Should promote: ${comparison2.should_promote}`);
  
  if (!comparison2.should_promote) {
    log.success('Worse candidate test passed');
  } else {
    log.error('Worse candidate test failed');
    return false;
  }
  
  log.success('Compare models tests complete');
  return true;
}

/**
 * Test 5: History management
 */
async function testHistoryManagement() {
  log.info('Test 5: History management');
  
  // Load history
  const history = await loadHistory();
  
  log.info('  Current history:');
  log.info(`    Total models: ${history.models ? history.models.length : 0}`);
  log.info(`    Total A/B tests: ${history.ab_tests ? history.ab_tests.length : 0}`);
  log.info(`    Total rollbacks: ${history.rollbacks ? history.rollbacks.length : 0}`);
  
  // Add a test model entry
  const testModel = {
    zone: 'test',
    version: Date.now(),
    trained_at: new Date().toISOString(),
    metrics: {
      rmse: 2.5,
      mae: 1.8,
      mape: 8.5,
      sample_count: 100,
    },
    training_samples: 500,
  };
  
  history.models = history.models || [];
  history.models.push(testModel);
  
  // Save history
  const saved = await saveHistory(history);
  
  if (saved) {
    log.success('History saved successfully');
    
    // Load again to verify
    const reloaded = await loadHistory();
    const lastModel = reloaded.models[reloaded.models.length - 1];
    
    if (lastModel.zone === 'test') {
      log.success('History persistence verified');
      
      // Clean up test entry
      reloaded.models = reloaded.models.filter(m => m.zone !== 'test');
      await saveHistory(reloaded);
      log.success('Test entry cleaned up');
      
      return true;
    } else {
      log.error('History persistence verification failed');
      return false;
    }
  } else {
    log.error('History save failed');
    return false;
  }
}

/**
 * Test 6: Configuration validation
 */
function testConfiguration() {
  log.info('Test 6: Validate configuration');
  
  log.info('  Configuration values:');
  log.info(`    Models directory: ${CONFIG.modelsDir}`);
  log.info(`    Min training samples: ${CONFIG.minTrainingSamples}`);
  log.info(`    Train/test split: ${CONFIG.trainTestSplitRatio}`);
  log.info(`    Max model age: ${CONFIG.maxModelAge / (24 * 60 * 60 * 1000)} days`);
  log.info(`    Max acceptable RMSE: ${CONFIG.maxAcceptableRMSE}°C`);
  log.info(`    Max acceptable MAPE: ${CONFIG.maxAcceptableMAPE}%`);
  log.info(`    Min improvement threshold: ${CONFIG.minImprovementThreshold * 100}%`);
  log.info(`    A/B testing enabled: ${CONFIG.abTestingEnabled}`);
  log.info(`    Initial traffic percent: ${CONFIG.initialTrafficPercent}%`);
  log.info(`    Auto rollback enabled: ${CONFIG.autoRollbackEnabled}`);
  log.info(`    Rollback threshold: ${CONFIG.rollbackThresholdMultiplier}x baseline`);
  
  // Validate reasonable values
  const checks = [
    CONFIG.minTrainingSamples > 0,
    CONFIG.trainTestSplitRatio > 0 && CONFIG.trainTestSplitRatio < 1,
    CONFIG.maxModelAge > 0,
    CONFIG.maxAcceptableRMSE > 0,
    CONFIG.maxAcceptableMAPE > 0,
    CONFIG.minImprovementThreshold >= 0,
    CONFIG.initialTrafficPercent > 0 && CONFIG.initialTrafficPercent <= 100,
    CONFIG.rollbackThresholdMultiplier > 1,
  ];
  
  if (checks.every(c => c)) {
    log.success('Configuration validation passed');
    return true;
  } else {
    log.error('Configuration validation failed');
    return false;
  }
}

/**
 * Run all tests
 */
async function runAllTests() {
  console.log('='.repeat(60));
  console.log('Model Retraining Pipeline - Test Suite');
  console.log('='.repeat(60));
  console.log('');
  
  const tests = [
    { name: 'Storage Initialization', fn: testStorageInit },
    { name: 'Model Age Check', fn: testModelAge },
    { name: 'Calculate Metrics', fn: testCalculateMetrics },
    { name: 'Compare Models', fn: testCompareModels },
    { name: 'History Management', fn: testHistoryManagement },
    { name: 'Configuration Validation', fn: testConfiguration },
  ];
  
  let passed = 0;
  let failed = 0;
  
  for (const test of tests) {
    console.log('-'.repeat(60));
    try {
      const result = await test.fn();
      if (result) {
        passed++;
      } else {
        failed++;
      }
    } catch (err) {
      log.error(`${test.name} threw error: ${err.message}`);
      failed++;
    }
    console.log('');
  }
  
  console.log('='.repeat(60));
  console.log(`Test Results: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(60));
  
  return failed === 0;
}

// Run tests
if (import.meta.url === `file://${process.argv[1]}`) {
  runAllTests().then(success => {
    process.exit(success ? 0 : 1);
  }).catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}

export { runAllTests };
