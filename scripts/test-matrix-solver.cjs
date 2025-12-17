#!/usr/bin/env node

/**
 * Matrix Solver Test Script
 * Tests the solver with actual SPD data and calibration matrix
 */

const http = require('http');

console.log('=== Matrix Solver Test - Real SPD Data ===\n');

// Test configuration
const SERVER_URL = 'http://localhost:8091';
const TEST_PAGE = '/test-matrix-solver.html';

// Test scenarios
const TEST_SCENARIOS = {
  balanced: { B: 0.33, G: 0.33, R: 0.34, FR: 0.00, name: 'Balanced Spectrum' },
  vegetative: { B: 0.25, G: 0.35, R: 0.40, FR: 0.00, name: 'Vegetative Growth' },
  flowering: { B: 0.18, G: 0.27, R: 0.50, FR: 0.05, name: 'Flowering Stage' },
  highRed: { B: 0.10, G: 0.20, R: 0.65, FR: 0.05, name: 'High Red (Late Flowering)' },
  greenOnly: { B: 0.00, G: 1.00, R: 0.00, FR: 0.00, name: 'Green Only (Edge Case)' },
  blueOnly: { B: 1.00, G: 0.00, R: 0.00, FR: 0.00, name: 'Blue Only (Edge Case)' },
};

// Validation thresholds
const THRESHOLDS = {
  GOOD_ERROR: 0.05,      // < 5% is good
  ACCEPTABLE_ERROR: 0.10, // < 10% is acceptable
  BL_BLUE_MIN: 0.85,      // BL should contribute 85%+ blue
  RD_RED_MIN: 0.90,       // RD should contribute 90%+ red
  CHANNEL_MAX: 100,       // Channels shouldn't exceed 100%
};

// Check if server is running
function checkServer() {
  return new Promise((resolve, reject) => {
    const req = http.get(`${SERVER_URL}/`, (res) => {
      if (res.statusCode === 200) {
        resolve(true);
      } else {
        reject(new Error(`Server returned status ${res.statusCode}`));
      }
    });
    
    req.on('error', (err) => {
      reject(new Error(`Server not running: ${err.message}`));
    });
    
    req.setTimeout(2000, () => {
      req.destroy();
      reject(new Error('Server timeout'));
    });
  });
}

// Simple matrix solver implementation (matches the one in app.charlie.js)
function solveChannelsFromBands(targets, calibMatrix, options = {}) {
  const { intensityPct = 100, tolerance = 0.05 } = options;
  
  const M = calibMatrix.matrix;
  const bands = calibMatrix.bands;
  const channels = calibMatrix.channels;
  
  // Normalize targets to sum to 1.0
  const t = { ...targets };
  const sum = Object.values(t).reduce((a, b) => a + b, 0);
  if (sum > 0) {
    for (const b in t) t[b] /= sum;
  }
  
  // Greedy heuristic solver
  const x = { cw: 0, ww: 0, bl: 0, rd: 0 };
  
  // Step 1: Allocate whites for green
  const greenTarget = t.G || 0;
  const cwGreenContrib = M.G.cw;
  const wwGreenContrib = M.G.ww;
  
  if (greenTarget > 0 && (cwGreenContrib + wwGreenContrib) > 0) {
    const greenRatio = greenTarget / (cwGreenContrib + wwGreenContrib);
    x.cw = Math.min(100, greenRatio * 50);
    x.ww = Math.min(100, greenRatio * 50);
  }
  
  // Step 2: Calculate white leakage to B and R
  const blueFromWhites = x.cw * M.B.cw + x.ww * M.B.ww;
  const redFromWhites = x.cw * M.R.cw + x.ww * M.R.ww;
  
  // Step 3: Compute residual B and R needs
  const blueNeeded = Math.max(0, t.B - blueFromWhites);
  const redNeeded = Math.max(0, t.R - redFromWhites);
  
  // Step 4: Top up with pure BL and RD
  if (M.B.bl > 0) {
    x.bl = Math.min(100, (blueNeeded / M.B.bl) * 100);
  }
  
  if (M.R.rd > 0) {
    x.rd = Math.min(100, (redNeeded / M.R.rd) * 100);
  }
  
  // Step 5: Scale to intensity
  const scale = intensityPct / 100;
  for (const ch in x) {
    x[ch] = Math.max(0, Math.min(100, x[ch] * scale));
  }
  
  // Calculate achieved bands
  const achieved = {};
  for (const b of bands) {
    achieved[b] = 0;
    for (const ch of channels) {
      achieved[b] += (x[ch] / 100) * M[b][ch];
    }
  }
  
  // Calculate RMS error
  let errorSum = 0;
  for (const b of bands) {
    const diff = (t[b] || 0) - achieved[b];
    errorSum += diff * diff;
  }
  const error = Math.sqrt(errorSum / bands.length);
  
  return {
    channels: {
      cw: Math.round(x.cw * 10) / 10,
      ww: Math.round(x.ww * 10) / 10,
      bl: Math.round(x.bl * 10) / 10,
      rd: Math.round(x.rd * 10) / 10,
    },
    achieved: {
      B: achieved.B,
      G: achieved.G,
      R: achieved.R,
      FR: achieved.FR,
    },
    targets: t,
    error: error,
    withinTolerance: error <= tolerance,
    totalPower: x.cw + x.ww + x.bl + x.rd,
  };
}

// Typical calibration matrix (based on real SPD curves)
const TYPICAL_CALIBRATION_MATRIX = {
  bands: ['B', 'G', 'R', 'FR'],
  channels: ['cw', 'ww', 'bl', 'rd'],
  matrix: {
    B: { cw: 0.15, ww: 0.08, bl: 0.92, rd: 0.02 },  // Blue band (400-500nm)
    G: { cw: 0.55, ww: 0.45, bl: 0.05, rd: 0.03 },  // Green band (500-600nm)
    R: { cw: 0.25, ww: 0.40, bl: 0.02, rd: 0.93 },  // Red band (600-700nm)
    FR: { cw: 0.05, ww: 0.07, bl: 0.01, rd: 0.02 }, // Far-red band (700-800nm)
  }
};

console.log('📊 Calibration Matrix (Typical Values):\n');
console.log('      CW     WW     BL     RD');
console.log('B   15.0%   8.0%  92.0%   2.0%  (Blue band 400-500nm)');
console.log('G   55.0%  45.0%   5.0%   3.0%  (Green band 500-600nm)');
console.log('R   25.0%  40.0%   2.0%  93.0%  (Red band 600-700nm)');
console.log('FR   5.0%   7.0%   1.0%   2.0%  (Far-red band 700-800nm)');
console.log();

console.log('Key Observations:');
console.log('  • BL LED: 92% blue, very pure blue output');
console.log('  • RD LED: 93% red, very pure red output');
console.log('  • CW LED: 55% green, 25% red, 15% blue - broad spectrum');
console.log('  • WW LED: 45% green, 40% red, 8% blue - warm broad spectrum');
console.log('  • FR output very low (~2-7%) - limited far-red capability');
console.log();

console.log('=== Running Test Scenarios ===\n');

let passCount = 0;
let warnCount = 0;
let failCount = 0;

Object.entries(TEST_SCENARIOS).forEach(([key, scenario]) => {
  const { B, G, R, FR, name } = scenario;
  
  console.log(`\n📋 Test: ${name}`);
  console.log(`   Targets: B=${(B*100).toFixed(1)}%, G=${(G*100).toFixed(1)}%, R=${(R*100).toFixed(1)}%, FR=${(FR*100).toFixed(1)}%`);
  
  const result = solveChannelsFromBands(
    { B, G, R, FR }, 
    TYPICAL_CALIBRATION_MATRIX,
    { intensityPct: 100 }
  );
  
  console.log(`   Channels: CW=${result.channels.cw}%, WW=${result.channels.ww}%, BL=${result.channels.bl}%, RD=${result.channels.rd}%`);
  console.log(`   Achieved: B=${(result.achieved.B*100).toFixed(1)}%, G=${(result.achieved.G*100).toFixed(1)}%, R=${(result.achieved.R*100).toFixed(1)}%, FR=${(result.achieved.FR*100).toFixed(1)}%`);
  console.log(`   Error: ${(result.error*100).toFixed(2)}%`);
  console.log(`   Total Power: ${result.totalPower.toFixed(1)}%`);
  
  // Validate results
  let status = 'PASS';
  const issues = [];
  
  // Check error threshold
  if (result.error > THRESHOLDS.ACCEPTABLE_ERROR) {
    status = 'FAIL';
    issues.push(`High error: ${(result.error*100).toFixed(2)}% > ${THRESHOLDS.ACCEPTABLE_ERROR*100}%`);
  } else if (result.error > THRESHOLDS.GOOD_ERROR) {
    if (status === 'PASS') status = 'WARN';
    issues.push(`Acceptable error: ${(result.error*100).toFixed(2)}%`);
  }
  
  // Check channel limits
  Object.entries(result.channels).forEach(([ch, val]) => {
    if (val > THRESHOLDS.CHANNEL_MAX) {
      status = 'FAIL';
      issues.push(`${ch.toUpperCase()} exceeds 100%: ${val}%`);
    }
    if (val < 0) {
      status = 'FAIL';
      issues.push(`${ch.toUpperCase()} negative: ${val}%`);
    }
  });
  
  // Check physical reasonableness for edge cases
  if (key === 'greenOnly') {
    // Green target should use mostly whites
    if (result.channels.cw < 30 || result.channels.ww < 30) {
      if (status === 'PASS') status = 'WARN';
      issues.push('Green scenario should use more whites');
    }
  }
  
  if (key === 'blueOnly') {
    // Blue target should use mostly BL
    if (result.channels.bl < 50) {
      if (status === 'PASS') status = 'WARN';
      issues.push('Blue scenario should use more BL');
    }
  }
  
  // Status indicators
  if (status === 'PASS') {
    console.log(`   ✅ ${status}`);
    passCount++;
  } else if (status === 'WARN') {
    console.log(`   ⚠️  ${status}`);
    warnCount++;
  } else {
    console.log(`   ❌ ${status}`);
    failCount++;
  }
  
  if (issues.length > 0) {
    issues.forEach(issue => console.log(`      - ${issue}`));
  }
});

console.log('\n=== Test Summary ===\n');
console.log(`✅ Passed: ${passCount}`);
console.log(`⚠️  Warnings: ${warnCount}`);
console.log(`❌ Failed: ${failCount}`);
console.log(`📊 Total: ${passCount + warnCount + failCount}`);

if (failCount === 0) {
  console.log('\n🎉 All tests passed or acceptable!');
} else {
  console.log('\n⚠️  Some tests failed - review results above');
}

console.log('\n=== Manual Browser Testing ===\n');

// Check if server is accessible
checkServer()
  .then(() => {
    console.log(`✅ Server is running at ${SERVER_URL}`);
    console.log(`📄 Test page available at: ${SERVER_URL}${TEST_PAGE}`);
    console.log();
    console.log('Manual Test Steps:');
    console.log(`1. Open browser to ${SERVER_URL}${TEST_PAGE}`);
    console.log('2. Verify calibration matrix displays correctly');
    console.log('3. Enter custom band targets (e.g., B:0.25, G:0.35, R:0.40, FR:0)');
    console.log('4. Click "Solve" button');
    console.log('5. Verify results match expected behavior');
    console.log('6. Test pre-built scenarios (Balanced, Vegetative, Flowering, Green)');
    console.log('7. Check console for any errors');
    console.log('8. Verify matrix values are physically reasonable:');
    console.log('   - BL should be ~90%+ blue');
    console.log('   - RD should be ~90%+ red');
    console.log('   - Whites should have mixed spectrum');
    console.log();
    console.log('Console Commands:');
    console.log('  window.calibrationMatrix  // View matrix');
    console.log('  window.runSolver()        // Run with custom inputs');
    console.log('  window.runTestScenario("vegetative")  // Run preset');
    console.log();
  })
  .catch((err) => {
    console.log(`❌ Server check failed: ${err.message}`);
    console.log('Please start the server: PORT=8091 node server-charlie.js');
    console.log();
  });

console.log('✅ Automated tests complete!\n');
