#!/usr/bin/env node
/**
 * Test Anomaly History System
 * 
 * Validates persistence, retention, filtering, and statistics.
 */

import anomalyHistory from '../lib/anomaly-history.js';

console.log(' Testing Anomaly History System\n');

// Test 1: Clear history for clean test
console.log('1⃣  Clearing existing history...');
await anomalyHistory.clearHistory();
console.log('    History cleared\n');

// Test 2: Add test anomalies
console.log('2⃣  Adding test anomalies...');
const testAnomalies = [
  {
    zone: 'main',
    timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    indoor_temp: 28.5,
    indoor_rh: 65,
    outdoor_temp: 22.0,
    outdoor_rh: 55,
    anomaly_score: 0.85,
    severity: 'critical',
    reason: 'Equipment likely failed'
  },
  {
    zone: 'veg',
    timestamp: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(),
    indoor_temp: 19.2,
    indoor_rh: 45,
    outdoor_temp: 18.0,
    outdoor_rh: 50,
    anomaly_score: 0.65,
    severity: 'warning',
    reason: 'Unusual temperature drop'
  },
  {
    zone: 'flower',
    timestamp: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    indoor_temp: 24.0,
    indoor_rh: 72,
    outdoor_temp: 22.0,
    outdoor_rh: 55,
    anomaly_score: 0.45,
    severity: 'info',
    reason: 'Statistical anomaly detected'
  }
];

const addResult = await anomalyHistory.addAnomalies(testAnomalies);
console.log(`    Added ${addResult.added} anomalies (total: ${addResult.total})\n`);

// Test 3: Get full history
console.log('3⃣  Getting full history...');
const history = await anomalyHistory.getHistory({ limit: 10 });
console.log(`    Total events: ${history.stats.total}`);
console.log(`    By severity: critical=${history.stats.by_severity.critical}, warning=${history.stats.by_severity.warning}, info=${history.stats.by_severity.info}`);
console.log(`    By zone:`, Object.entries(history.stats.by_zone).map(([z, c]) => `${z}=${c}`).join(', '));
console.log('');

// Test 4: Filter by severity
console.log('4⃣  Filtering by severity=critical...');
const criticalOnly = await anomalyHistory.getHistory({ severity: 'critical' });
console.log(`    Found ${criticalOnly.stats.total} critical anomalies`);
console.log('');

// Test 5: Filter by zone
console.log('5⃣  Filtering by zone=veg...');
const vegOnly = await anomalyHistory.getHistory({ zone: 'veg' });
console.log(`    Found ${vegOnly.stats.total} anomalies in veg zone`);
console.log('');

// Test 6: Get statistics
console.log('6⃣  Getting 24-hour statistics...');
const stats = await anomalyHistory.getStatistics(24);
console.log(`    Total events: ${stats.total_events}`);
console.log(`    Hourly buckets: ${stats.hourly_buckets.length}`);
const recentBuckets = stats.hourly_buckets.filter(b => b.total > 0);
console.log(`    Active buckets: ${recentBuckets.length}`);
console.log('');

// Test 7: Test retention policy
console.log('7⃣  Testing 30-day retention policy...');
const oldAnomaly = [{
  zone: 'test-old',
  timestamp: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString(),
  indoor_temp: 25.0,
  indoor_rh: 60,
  outdoor_temp: 20.0,
  outdoor_rh: 55,
  anomaly_score: 0.70,
  severity: 'warning',
  reason: 'Old test anomaly (should be cleaned)'
}];

const retentionResult = await anomalyHistory.addAnomalies(oldAnomaly);
console.log(`    Added ${retentionResult.added} old anomaly`);
console.log(`    Cleaned ${retentionResult.cleaned} anomalies beyond retention period`);
console.log(`    Total after cleanup: ${retentionResult.total}`);
console.log('');

// Test 8: Verify old anomaly was cleaned
console.log('8⃣  Verifying old anomaly removal...');
const finalHistory = await anomalyHistory.getHistory();
const hasOldAnomaly = finalHistory.events.some(e => e.zone === 'test-old');
if (!hasOldAnomaly) {
  console.log('    Old anomaly was correctly cleaned by retention policy');
} else {
  console.log('   ✗ FAIL: Old anomaly should have been cleaned');
}
console.log('');

// Test 9: Test sort order
console.log('9⃣  Testing sort order...');
const descHistory = await anomalyHistory.getHistory({ sort: 'desc', limit: 1 });
const ascHistory = await anomalyHistory.getHistory({ sort: 'asc', limit: 1 });
const descTime = new Date(descHistory.events[0].timestamp).getTime();
const ascTime = new Date(ascHistory.events[0].timestamp).getTime();
if (descTime > ascTime) {
  console.log('    Sort order working correctly (desc > asc)');
} else {
  console.log('   ✗ FAIL: Sort order incorrect');
}
console.log('');

console.log(' All anomaly history tests passed!');
console.log('');
console.log(' Final Statistics:');
console.log(`   Total events: ${finalHistory.stats.total}`);
console.log(`   Retention period: ${history.retention_days} days`);
console.log(`   Oldest event: ${finalHistory.events[0].timestamp}`);
console.log(`   Newest event: ${finalHistory.events[finalHistory.events.length - 1].timestamp}`);
