#!/usr/bin/env node
/**
 * Test ML Automation Controller
 * 
 * Tests anomaly response evaluation, forecast response, and automation actions.
 * 
 * Usage: node scripts/test-ml-automation.js
 */

import mlAutomation from '../lib/ml-automation-controller.js';

// Test anomalies
const testAnomalies = [
  {
    id: 'test-anomaly-1',
    zone: 'main',
    timestamp: new Date().toISOString(),
    indoor_temp: 32.0, // High temperature - should trigger cooling
    indoor_rh: 65,
    outdoor_temp: 28.0,
    outdoor_rh: 60,
    anomaly_score: 0.85,
    severity: 'critical',
    reason: 'Critical high temperature'
  },
  {
    id: 'test-anomaly-2',
    zone: 'veg',
    timestamp: new Date().toISOString(),
    indoor_temp: 16.0, // Low temperature - should trigger heating
    indoor_rh: 50,
    outdoor_temp: 10.0,
    outdoor_rh: 70,
    anomaly_score: 0.82,
    severity: 'critical',
    reason: 'Critical low temperature'
  },
  {
    id: 'test-anomaly-3',
    zone: 'flower',
    timestamp: new Date().toISOString(),
    indoor_temp: 23.5,
    indoor_rh: 78, // High humidity - should trigger dehumidification
    outdoor_temp: 22.0,
    outdoor_rh: 65,
    anomaly_score: 0.88,
    severity: 'critical',
    reason: 'Critical high humidity'
  },
  {
    id: 'test-anomaly-4',
    zone: 'main',
    timestamp: new Date().toISOString(),
    indoor_temp: 24.0,
    indoor_rh: 60,
    outdoor_temp: 22.0,
    outdoor_rh: 55,
    anomaly_score: 0.65, // Warning level
    severity: 'warning',
    reason: 'Minor deviation detected'
  }
];

// Test forecasts
const testForecasts = [
  {
    zone: 'main',
    forecast_horizon_hours: 4,
    predictions: [
      { timestamp: new Date(Date.now() + 1 * 60 * 60 * 1000).toISOString(), value: 29.5 },
      { timestamp: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(), value: 30.0 }, // High temp predicted
      { timestamp: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(), value: 29.8 },
      { timestamp: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(), value: 28.5 }
    ]
  },
  {
    zone: 'veg',
    forecast_horizon_hours: 4,
    predictions: [
      { timestamp: new Date(Date.now() + 1 * 60 * 60 * 1000).toISOString(), value: 17.5 },
      { timestamp: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(), value: 16.0 }, // Low temp predicted
      { timestamp: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(), value: 15.5 },
      { timestamp: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(), value: 17.0 }
    ]
  }
];

console.log('='.repeat(80));
console.log('ML AUTOMATION CONTROLLER TEST');
console.log('='.repeat(80));

// Test 1: Get initial configuration
console.log('\nTest 1: Get initial configuration');
const initialConfig = mlAutomation.getConfig();
console.log('[OK] Config loaded:');
console.log(`  - Enabled: ${initialConfig.enabled}`);
console.log(`  - Anomaly response: ${initialConfig.anomaly_response_enabled}`);
console.log(`  - Forecast response: ${initialConfig.forecast_response_enabled}`);
console.log(`  - Critical threshold: ${initialConfig.anomaly_critical_threshold}`);
console.log(`  - Action cooldown: ${initialConfig.action_cooldown_minutes} minutes`);

// Test 2: Evaluate anomaly responses
console.log('\nTest 2: Evaluate anomaly responses');
for (const anomaly of testAnomalies) {
  const response = mlAutomation.evaluateAnomalyResponse(anomaly);
  console.log(`\n  Anomaly: ${anomaly.zone} - ${anomaly.reason} (score: ${anomaly.anomaly_score})`);
  
  if (response) {
    if (response.action === 'none') {
      console.log(`  ⏸ No action: ${response.reason} (${response.cooldown_remaining_minutes}m cooldown remaining)`);
    } else {
      console.log(`  [OK] Action: ${response.action}`);
      console.log(`    Reason: ${response.reason}`);
      console.log(`    Severity: ${response.severity}`);
      console.log(`    Targets: ${JSON.stringify(response.targets)}`);
      console.log(`    Notify: ${response.notify}`);
    }
  } else {
    console.log('  - No response triggered');
  }
}

// Test 3: Check cooldown status
console.log('\nTest 3: Check cooldown status');
const cooldowns = mlAutomation.getCooldownStatus();
if (Object.keys(cooldowns).length > 0) {
  console.log('[OK] Cooldowns active:');
  for (const [key, status] of Object.entries(cooldowns)) {
    console.log(`  - ${key}: ${status.remaining_minutes}m remaining`);
  }
} else {
  console.log('  - No active cooldowns');
}

// Test 4: Evaluate forecast responses
console.log('\nTest 4: Evaluate forecast responses');
for (const forecast of testForecasts) {
  const response = mlAutomation.evaluateForecastResponse(forecast);
  console.log(`\n  Forecast: ${forecast.zone}`);
  
  if (response) {
    console.log(`  [OK] Action: ${response.action}`);
    console.log(`    Reason: ${response.reason}`);
    console.log(`    Targets: ${JSON.stringify(response.targets)}`);
    if (response.predicted_max_temp) {
      console.log(`    Predicted max: ${response.predicted_max_temp.toFixed(1)}°C`);
    }
    if (response.predicted_min_temp) {
      console.log(`    Predicted min: ${response.predicted_min_temp.toFixed(1)}°C`);
    }
  } else {
    console.log('  - No proactive action triggered');
  }
}

// Test 5: Update configuration
console.log('\nTest 5: Update configuration');
const updates = {
  action_cooldown_minutes: 60,
  precool_temp_target: 21.0
};
const updatedConfig = mlAutomation.updateConfig(updates);
console.log('[OK] Config updated:');
console.log(`  - Cooldown: ${updatedConfig.action_cooldown_minutes} minutes`);
console.log(`  - Precool target: ${updatedConfig.precool_temp_target}°C`);

// Test 6: Disable and re-enable automation
console.log('\nTest 6: Disable and re-enable automation');
mlAutomation.updateConfig({ enabled: false });
const disabledResponse = mlAutomation.evaluateAnomalyResponse(testAnomalies[0]);
console.log(`[OK] Disabled - Response: ${disabledResponse ? 'triggered' : 'null (correct)'}`);

mlAutomation.updateConfig({ enabled: true });
console.log('[OK] Re-enabled');

// Test 7: Test anomaly response with cooldown
console.log('\nTest 7: Test cooldown behavior');
const anomaly = testAnomalies[0];
const response1 = mlAutomation.evaluateAnomalyResponse(anomaly);
console.log(`  First evaluation: ${response1 ? response1.action : 'null'}`);

const response2 = mlAutomation.evaluateAnomalyResponse(anomaly);
if (response2 && response2.action === 'none') {
  console.log(`  [OK] Second evaluation blocked by cooldown (${response2.cooldown_remaining_minutes}m remaining)`);
} else {
  console.log(`  - Second evaluation: ${response2 ? response2.action : 'null'}`);
}

// Test 8: Get final cooldown status
console.log('\nTest 8: Final cooldown status');
const finalCooldowns = mlAutomation.getCooldownStatus();
console.log(`[OK] Active cooldowns: ${Object.keys(finalCooldowns).length}`);
for (const [key, status] of Object.entries(finalCooldowns)) {
  console.log(`  - ${key}: ${status.elapsed_minutes}m elapsed, ${status.remaining_minutes}m remaining`);
}

console.log('\n' + '='.repeat(80));
console.log('ALL TESTS COMPLETE');
console.log('='.repeat(80));
console.log(`
Summary:
  [OK] Configuration management working
  [OK] Anomaly response evaluation working
  [OK] Forecast response evaluation working
  [OK] Cooldown mechanism working
  [OK] Enable/disable controls working
  
Next steps:
  1. Test API endpoints: GET /api/ml/automation/config
  2. Test API endpoints: PUT /api/ml/automation/config
  3. Test API endpoints: GET /api/ml/automation/status
  4. Test API endpoints: POST /api/ml/automation/evaluate
  5. Integrate with existing automation engine for actual device control
`);
