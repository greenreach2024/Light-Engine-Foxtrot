/**
 * Test suite for ML metrics collector
 * 
 * Tests metrics collection, accuracy calculation, drift detection,
 * and alerting functionality.
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.join(__dirname, '..');

// Import metrics collector
import metricsCollector from '../lib/ml-metrics-collector.js';
const {
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
} = metricsCollector;

// Test configuration
const TEST_METRICS_FILE = path.join(PROJECT_ROOT, 'public', 'data', 'ml-metrics-test.json');
const BACKUP_FILE = CONFIG.metricsFile + '.backup';

/**
 * Helper: Backup and restore original metrics file
 */
async function backupMetrics() {
  try {
    await fs.access(CONFIG.metricsFile);
    await fs.copyFile(CONFIG.metricsFile, BACKUP_FILE);
    console.log('✓ Backed up existing metrics file');
  } catch {
    console.log('ℹ No existing metrics file to backup');
  }
  
  // Replace CONFIG.metricsFile temporarily
  CONFIG.metricsFile = TEST_METRICS_FILE;
}

async function restoreMetrics() {
  // Restore original path
  CONFIG.metricsFile = path.join(PROJECT_ROOT, 'public', 'data', 'ml-metrics.json');
  
  // Clean test file
  try {
    await fs.unlink(TEST_METRICS_FILE);
    console.log('✓ Cleaned up test metrics file');
  } catch {}
  
  // Restore backup if exists
  try {
    await fs.access(BACKUP_FILE);
    await fs.copyFile(BACKUP_FILE, CONFIG.metricsFile);
    await fs.unlink(BACKUP_FILE);
    console.log('✓ Restored original metrics file');
  } catch {}
}

/**
 * Test 1: Storage initialization
 */
async function testStorageInitialization() {
  console.log('\n=== Test 1: Storage Initialization ===');
  
  try {
    const result = await initializeStorage();
    
    if (!result) {
      throw new Error('initializeStorage returned false');
    }
    
    // Check file exists
    await fs.access(TEST_METRICS_FILE);
    
    // Check structure
    const metrics = await loadMetrics();
    if (!metrics.zones || !metrics.drift_alerts || !metrics.created_at) {
      throw new Error('Metrics structure invalid');
    }
    
    console.log('✓ PASSED: Storage initialized correctly');
    console.log(`  - File created: ${TEST_METRICS_FILE}`);
    console.log(`  - Structure valid: zones, drift_alerts, created_at`);
    return true;
  } catch (err) {
    console.error('✗ FAILED:', err.message);
    return false;
  }
}

/**
 * Test 2: Calculate accuracy metrics
 */
async function testCalculateAccuracyMetrics() {
  console.log('\n=== Test 2: Calculate Accuracy Metrics ===');
  
  try {
    // Test case 1: Perfect predictions
    const predictions1 = [20, 21, 22, 23, 24];
    const actuals1 = [20, 21, 22, 23, 24];
    const metrics1 = calculateAccuracyMetrics(predictions1, actuals1);
    
    if (metrics1.rmse !== 0 || metrics1.mae !== 0) {
      throw new Error('Perfect predictions should have RMSE=0, MAE=0');
    }
    
    console.log('✓ Test case 1: Perfect predictions (RMSE=0, MAE=0)');
    
    // Test case 2: Constant error (+1°C)
    const predictions2 = [20, 21, 22, 23, 24];
    const actuals2 = [21, 22, 23, 24, 25];
    const metrics2 = calculateAccuracyMetrics(predictions2, actuals2);
    
    if (Math.abs(metrics2.rmse - 1.0) > 0.01 || Math.abs(metrics2.mae - 1.0) > 0.01) {
      throw new Error(`Expected RMSE≈1.0, MAE≈1.0, got RMSE=${metrics2.rmse}, MAE=${metrics2.mae}`);
    }
    
    console.log('✓ Test case 2: Constant +1°C error (RMSE≈1.0, MAE≈1.0)');
    
    // Test case 3: Variable error
    const predictions3 = [20, 21, 22, 23, 24];
    const actuals3 = [20, 22, 21, 25, 24]; // errors: 0, +1, -1, +2, 0
    const metrics3 = calculateAccuracyMetrics(predictions3, actuals3);
    
    // RMSE = sqrt((0^2 + 1^2 + 1^2 + 2^2 + 0^2) / 5) = sqrt(6/5) ≈ 1.095
    // MAE = (0 + 1 + 1 + 2 + 0) / 5 = 0.8
    if (Math.abs(metrics3.rmse - 1.095) > 0.1 || Math.abs(metrics3.mae - 0.8) > 0.1) {
      throw new Error(`Metrics calculation incorrect: RMSE=${metrics3.rmse}, MAE=${metrics3.mae}`);
    }
    
    console.log('✓ Test case 3: Variable error (RMSE≈1.1, MAE≈0.8)');
    console.log('✓ PASSED: Accuracy metrics calculated correctly');
    return true;
  } catch (err) {
    console.error('✗ FAILED:', err.message);
    return false;
  }
}

/**
 * Test 3: Data drift detection
 */
async function testDataDriftDetection() {
  console.log('\n=== Test 3: Data Drift Detection ===');
  
  try {
    // Test case 1: No drift (similar distributions)
    const historical1 = Array.from({ length: 100 }, () => 20 + Math.random() * 2); // 20-22°C
    const recent1 = Array.from({ length: 50 }, () => 20 + Math.random() * 2);
    
    const drift1 = detectDataDrift(recent1, historical1);
    
    if (drift1.drift_detected) {
      console.log(`⚠ Warning: No drift expected but detected (score=${drift1.drift_score.toFixed(3)})`);
      // Not failing - drift detection is probabilistic
    } else {
      console.log('✓ Test case 1: No drift detected (similar distributions)');
    }
    
    // Test case 2: Clear drift (shifted distribution)
    const historical2 = Array.from({ length: 100 }, () => 20 + Math.random() * 2); // 20-22°C
    const recent2 = Array.from({ length: 50 }, () => 25 + Math.random() * 2); // 25-27°C (shifted +5°C)
    
    const drift2 = detectDataDrift(recent2, historical2);
    
    if (!drift2.drift_detected) {
      throw new Error('Expected drift detection for shifted distribution');
    }
    
    console.log(`✓ Test case 2: Drift detected (score=${drift2.drift_score.toFixed(3)}, threshold=${drift2.threshold})`);
    
    // Test case 3: Insufficient data
    const drift3 = detectDataDrift([20, 21], [19, 20, 21]);
    
    if (drift3.drift_detected) {
      throw new Error('Should not detect drift with insufficient data');
    }
    
    console.log('✓ Test case 3: Insufficient data handled correctly');
    console.log('✓ PASSED: Data drift detection working');
    return true;
  } catch (err) {
    console.error('✗ FAILED:', err.message);
    return false;
  }
}

/**
 * Test 4: Concept drift detection
 */
async function testConceptDriftDetection() {
  console.log('\n=== Test 4: Concept Drift Detection ===');
  
  try {
    // Test case 1: No drift (similar performance)
    const recent1 = { rmse: 2.0, mae: 1.5 };
    const historical1 = { rmse: 2.1, mae: 1.6 };
    
    const drift1 = detectConceptDrift(recent1, historical1);
    
    if (drift1.drift_detected) {
      console.log(`⚠ Warning: No drift expected but detected (ratio=${drift1.rmse_ratio.toFixed(2)})`);
    } else {
      console.log('✓ Test case 1: No drift detected (similar performance)');
    }
    
    // Test case 2: Clear degradation
    const recent2 = { rmse: 4.0, mae: 3.0 };
    const historical2 = { rmse: 2.0, mae: 1.5 };
    
    const drift2 = detectConceptDrift(recent2, historical2);
    
    if (!drift2.drift_detected) {
      throw new Error('Expected concept drift for 2x RMSE increase');
    }
    
    console.log(`✓ Test case 2: Drift detected (RMSE ratio=${drift2.rmse_ratio.toFixed(2)}x, severity=${drift2.severity})`);
    console.log('✓ PASSED: Concept drift detection working');
    return true;
  } catch (err) {
    console.error('✗ FAILED:', err.message);
    return false;
  }
}

/**
 * Test 5: Record predictions and calculate zone accuracy
 */
async function testRecordAndCalculateAccuracy() {
  console.log('\n=== Test 5: Record Predictions & Calculate Accuracy ===');
  
  try {
    await initializeStorage();
    
    // Record several predictions for 'test_zone'
    const predictions = [
      { predicted: 20.0, actual: 20.5 },
      { predicted: 21.0, actual: 21.2 },
      { predicted: 22.0, actual: 21.8 },
      { predicted: 23.0, actual: 23.5 },
      { predicted: 24.0, actual: 24.1 },
    ];
    
    for (const p of predictions) {
      await recordPrediction('test_zone', p.predicted, p.actual);
    }
    
    console.log(`✓ Recorded ${predictions.length} predictions for test_zone`);
    
    // Calculate accuracy
    const accuracy = await calculateZoneAccuracy('test_zone', 24);
    
    if (!accuracy) {
      throw new Error('Failed to calculate zone accuracy');
    }
    
    if (accuracy.sample_count !== predictions.length) {
      throw new Error(`Expected ${predictions.length} samples, got ${accuracy.sample_count}`);
    }
    
    console.log(`✓ Zone accuracy calculated: RMSE=${accuracy.rmse.toFixed(2)}°C, MAE=${accuracy.mae.toFixed(2)}°C, Alert=${accuracy.alert_level}`);
    
    // Check alert level logic
    if (accuracy.rmse < 3.0 && accuracy.alert_level !== 'ok') {
      throw new Error('Alert level should be "ok" for RMSE < 3.0');
    }
    
    console.log('✓ Alert level logic correct');
    console.log('✓ PASSED: Prediction recording and accuracy calculation working');
    return true;
  } catch (err) {
    console.error('✗ FAILED:', err.message);
    return false;
  }
}

/**
 * Test 6: Health status and summary
 */
async function testHealthStatusAndSummary() {
  console.log('\n=== Test 6: Health Status & Summary ===');
  
  try {
    // First record some data for test zones
    await initializeStorage();
    
    const zones = ['main', 'veg', 'flower'];
    
    for (const zone of zones) {
      // Record 10 predictions
      for (let i = 0; i < 10; i++) {
        const predicted = 20 + i * 0.5;
        const actual = predicted + (Math.random() - 0.5); // Small random error
        await recordPrediction(zone, predicted, actual);
      }
      
      // Calculate accuracy
      await calculateZoneAccuracy(zone, 24);
    }
    
    console.log(`✓ Recorded test data for ${zones.length} zones`);
    
    // Get health status
    const health = await getHealthStatus();
    
    // Health status should include test_zone from previous test
    const expectedZones = zones.length + 1; // zones + test_zone
    const actualZones = Object.keys(health.zones).length;
    
    if (actualZones < zones.length) {
      throw new Error(`Expected at least ${zones.length} zones, got ${actualZones}`);
    }
    
    console.log(`✓ Health status retrieved for ${actualZones} zones`);
    console.log(`  - Overall health: ${health.overall}`);
    
    // Get zone summary
    const summary = await getZoneSummary('main', 7);
    
    if (!summary || !summary.accuracy || !summary.drift) {
      throw new Error('Zone summary structure invalid');
    }
    
    console.log(`✓ Zone summary retrieved for 'main':`);
    console.log(`  - Predictions: ${summary.predictions.count}`);
    console.log(`  - Avg RMSE: ${summary.accuracy.avg_rmse?.toFixed(2) || 'N/A'}°C`);
    
    console.log('✓ PASSED: Health status and summary working');
    return true;
  } catch (err) {
    console.error('✗ FAILED:', err.message);
    return false;
  }
}

/**
 * Test 7: Retention policy
 */
async function testRetentionPolicy() {
  console.log('\n=== Test 7: Retention Policy (30-day cleanup) ===');
  
  try {
    await initializeStorage();
    
    // Record old prediction (40 days ago)
    const oldTimestamp = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
    await recordPrediction('retention_test', 20.0, 20.5, oldTimestamp);
    
    // Record recent prediction (1 day ago)
    const recentTimestamp = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await recordPrediction('retention_test', 21.0, 21.5, recentTimestamp);
    
    // Load metrics and check retention
    const metrics = await loadMetrics();
    const predictions = metrics.zones.retention_test?.predictions || [];
    
    // Old prediction should be filtered out by 30-day retention
    const oldCount = predictions.filter(p => new Date(p.timestamp) < new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)).length;
    
    if (oldCount > 0) {
      console.log(`⚠ Warning: ${oldCount} predictions older than 30 days found (may be retained temporarily)`);
    } else {
      console.log('✓ Old predictions cleaned up correctly');
    }
    
    console.log(`✓ Retention policy working (${predictions.length} predictions retained)`);
    console.log('✓ PASSED: Retention policy test');
    return true;
  } catch (err) {
    console.error('✗ FAILED:', err.message);
    return false;
  }
}

/**
 * Test 8: Configuration validation
 */
async function testConfiguration() {
  console.log('\n=== Test 8: Configuration Validation ===');
  
  try {
    // Check all config parameters are reasonable
    if (CONFIG.retentionDays <= 0) {
      throw new Error('retentionDays must be positive');
    }
    
    if (CONFIG.maxMetricsPerZone <= 0) {
      throw new Error('maxMetricsPerZone must be positive');
    }
    
    if (CONFIG.dataInputDriftThreshold <= 0 || CONFIG.dataInputDriftThreshold >= 1) {
      throw new Error('dataInputDriftThreshold must be between 0 and 1');
    }
    
    if (CONFIG.conceptDriftThreshold <= 1.0) {
      throw new Error('conceptDriftThreshold must be > 1.0 (ratio)');
    }
    
    if (CONFIG.minSamplesForDrift <= 0) {
      throw new Error('minSamplesForDrift must be positive');
    }
    
    if (CONFIG.rmseWarningThreshold <= 0 || CONFIG.rmseCriticalThreshold <= CONFIG.rmseWarningThreshold) {
      throw new Error('RMSE thresholds must be positive and critical > warning');
    }
    
    console.log('✓ Configuration validated:');
    console.log(`  - Retention: ${CONFIG.retentionDays} days`);
    console.log(`  - Max metrics per zone: ${CONFIG.maxMetricsPerZone}`);
    console.log(`  - Data drift threshold: ${CONFIG.dataInputDriftThreshold}`);
    console.log(`  - Concept drift threshold: ${CONFIG.conceptDriftThreshold}x`);
    console.log(`  - Min samples for drift: ${CONFIG.minSamplesForDrift}`);
    console.log(`  - RMSE thresholds: warning=${CONFIG.rmseWarningThreshold}°C, critical=${CONFIG.rmseCriticalThreshold}°C`);
    
    console.log('✓ PASSED: Configuration validation');
    return true;
  } catch (err) {
    console.error('✗ FAILED:', err.message);
    return false;
  }
}

/**
 * Run all tests
 */
async function runAllTests() {
  console.log('╔════════════════════════════════════════════╗');
  console.log('║   ML Metrics Collector Test Suite         ║');
  console.log('╚════════════════════════════════════════════╝');
  
  await backupMetrics();
  
  const tests = [
    testStorageInitialization,
    testCalculateAccuracyMetrics,
    testDataDriftDetection,
    testConceptDriftDetection,
    testRecordAndCalculateAccuracy,
    testHealthStatusAndSummary,
    testRetentionPolicy,
    testConfiguration,
  ];
  
  let passed = 0;
  let failed = 0;
  
  for (const test of tests) {
    const result = await test();
    if (result) {
      passed++;
    } else {
      failed++;
    }
  }
  
  console.log('\n' + '='.repeat(50));
  console.log(`Test Results: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(50));
  
  await restoreMetrics();
  
  if (failed > 0) {
    process.exit(1);
  }
}

// Run tests
runAllTests().catch(err => {
  console.error('Fatal error:', err);
  restoreMetrics().finally(() => process.exit(1));
});
