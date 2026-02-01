#!/usr/bin/env node
/**
 * P3 Farm Summary Integration Validation
 * Validates that harvest prediction badges are properly integrated into Farm Summary
 */

const fs = require('fs');
const path = require('path');

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('  P3 FARM SUMMARY INTEGRATION VALIDATION');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

const checks = [];
let passed = 0;
let failed = 0;

// Test 1: Check if farm-summary.html exists
try {
  const farmSummaryPath = path.join(__dirname, '..', 'public', 'views', 'farm-summary.html');
  const farmSummaryContent = fs.readFileSync(farmSummaryPath, 'utf-8');
  
  // Test 1a: Script import
  if (farmSummaryContent.includes('harvest-predictions.js')) {
    checks.push({ name: 'Script import exists', status: 'PASS', details: 'Found <script src="/harvest-predictions.js"></script>' });
    passed++;
  } else {
    checks.push({ name: 'Script import exists', status: 'FAIL', details: 'harvest-predictions.js script tag not found' });
    failed++;
  }
  
  // Test 1b: Badge placeholder
  if (farmSummaryContent.includes('ai-prediction-${group.id}')) {
    checks.push({ name: 'Badge placeholder exists', status: 'PASS', details: 'Found <div id="ai-prediction-${group.id}"> in group cards' });
    passed++;
  } else {
    checks.push({ name: 'Badge placeholder exists', status: 'FAIL', details: 'Badge placeholder not found in group cards' });
    failed++;
  }
  
  // Test 1c: Rendering logic
  if (farmSummaryContent.includes('window.harvestPredictions') && 
      farmSummaryContent.includes('renderBadge')) {
    checks.push({ name: 'Badge rendering logic exists', status: 'PASS', details: 'Found harvestPredictions.renderBadge() calls' });
    passed++;
  } else {
    checks.push({ name: 'Badge rendering logic exists', status: 'FAIL', details: 'Badge rendering logic not found' });
    failed++;
  }
  
  // Test 1d: Auto-refresh exists
  if (farmSummaryContent.includes('setInterval') && 
      (farmSummaryContent.includes('300000') || farmSummaryContent.includes('5 * 60 * 1000'))) {
    checks.push({ name: 'Auto-refresh mechanism exists', status: 'PASS', details: 'Found setInterval with 5-minute refresh' });
    passed++;
  } else {
    checks.push({ name: 'Auto-refresh mechanism exists', status: 'FAIL', details: 'Auto-refresh timer not found' });
    failed++;
  }
  
} catch (error) {
  checks.push({ name: 'Farm Summary file check', status: 'FAIL', details: error.message });
  failed++;
}

// Test 2: Check if harvest-predictions.js exists
try {
  const componentPath = path.join(__dirname, '..', 'public', 'harvest-predictions.js');
  const componentContent = fs.readFileSync(componentPath, 'utf-8');
  
  if (componentContent.includes('class HarvestPredictions')) {
    checks.push({ name: 'HarvestPredictions component exists', status: 'PASS', details: 'Component file found with HarvestPredictions class' });
    passed++;
  } else {
    checks.push({ name: 'HarvestPredictions component exists', status: 'FAIL', details: 'HarvestPredictions class not found' });
    failed++;
  }
  
  if (componentContent.includes('renderBadge')) {
    checks.push({ name: 'renderBadge method exists', status: 'PASS', details: 'Found renderBadge() method in component' });
    passed++;
  } else {
    checks.push({ name: 'renderBadge method exists', status: 'FAIL', details: 'renderBadge() method not found' });
    failed++;
  }
  
} catch (error) {
  checks.push({ name: 'Component file check', status: 'FAIL', details: error.message });
  failed++;
}

// Test 3: Check if API endpoint works
const http = require('http');
const testAPIEndpoint = new Promise((resolve) => {
  const req = http.get('http://localhost:8091/api/harvest/predictions/all', (res) => {
    let data = '';
    res.on('data', (chunk) => data += chunk);
    res.on('end', () => {
      try {
        const json = JSON.parse(data);
        if (json.ok && Array.isArray(json.predictions)) {
          checks.push({ name: 'API endpoint working', status: 'PASS', details: `API returned ${json.count} prediction(s)` });
          passed++;
        } else {
          checks.push({ name: 'API endpoint working', status: 'FAIL', details: 'API response invalid format' });
          failed++;
        }
      } catch (e) {
        checks.push({ name: 'API endpoint working', status: 'FAIL', details: 'API response not JSON' });
        failed++;
      }
      resolve();
    });
  });
  
  req.on('error', (error) => {
    checks.push({ name: 'API endpoint working', status: 'FAIL', details: `API unreachable: ${error.message}` });
    failed++;
    resolve();
  });
  
  req.setTimeout(5000, () => {
    checks.push({ name: 'API endpoint working', status: 'FAIL', details: 'API timeout (5s)' });
    failed++;
    req.destroy();
    resolve();
  });
});

// Run async tests and display results
testAPIEndpoint.then(() => {
  console.log('📊 VALIDATION RESULTS:\n');
  
  checks.forEach((check, i) => {
    const icon = check.status === 'PASS' ? '✓' : '✗';
    const color = check.status === 'PASS' ? '\x1b[32m' : '\x1b[31m';
    console.log(`${i + 1}. ${color}${icon} ${check.name}\x1b[0m`);
    console.log(`   ${check.details}\n`);
  });
  
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  VALIDATION SUMMARY');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  ✓ Passed: ${passed}`);
  console.log(`  ✗ Failed: ${failed}`);
  console.log(`  Score: ${passed}/${passed + failed} (${Math.round(passed / (passed + failed) * 100)}%)`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  if (failed === 0) {
    console.log('✓ All validation checks passed!');
    console.log('✓ P3 Farm Summary integration is COMPLETE and WORKING\n');
    process.exit(0);
  } else {
    console.log('✗ Some validation checks failed.');
    console.log('⚠ P3 Farm Summary integration needs attention\n');
    process.exit(1);
  }
});
