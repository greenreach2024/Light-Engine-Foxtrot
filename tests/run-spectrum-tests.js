#!/usr/bin/env node
/**
 * Standalone test runner for spectrum_env_math tests
 * Usage: node tests/run-spectrum-tests.js
 */

import {
  WL,
  BANDS,
  BASIS,
  integrate,
  integrateBand,
  mixSPD,
  calculateBandPercentages,
  splitGreenIntoWhites,
  calculateYPF,
  calculateVPD,
  calculateBlueAdjustment,
  calculatePPFDAdjustment
} from '../public/spectrum_env_math.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`[OK] ${name}`);
    passed++;
  } catch (err) {
    console.error(`[ERROR] ${name}`);
    console.error(`   ${err.message}`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

function assertEquals(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(message || `Expected ${expected}, got ${actual}`);
  }
}

function assertClose(actual, expected, tolerance = 0.01, message) {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(message || `Expected ${expected} ± ${tolerance}, got ${actual}`);
  }
}

console.log('\n🧪 Running Spectrum Math Tests...\n');

// Wavelength Grid Tests
console.log('Wavelength Grid:');
test('WL has correct range 400-750nm', () => {
  assertEquals(WL[0], 400);
  assertEquals(WL[WL.length - 1], 750);
});

test('WL has correct length (71 points)', () => {
  assertEquals(WL.length, 71);
});

test('WL has 5nm spacing', () => {
  for (let i = 1; i < WL.length; i++) {
    assertEquals(WL[i] - WL[i-1], 5);
  }
});

// BASIS Function Tests
console.log('\nBASIS Functions:');
test('BASIS arrays match WL length', () => {
  ['cw', 'ww', 'bl', 'rd', 'fr'].forEach(ch => {
    assertEquals(BASIS[ch].length, WL.length, `BASIS.${ch} length mismatch`);
  });
});

test('BASIS functions normalized to peak = 1.0', () => {
  ['cw', 'ww', 'bl', 'rd', 'fr'].forEach(ch => {
    const max = Math.max(...BASIS[ch]);
    assertClose(max, 1.0, 0.01, `BASIS.${ch} peak should be 1.0`);
  });
});

test('BASIS.bl peaks in blue region (400-500nm)', () => {
  const blueIndices = WL.map((wl, i) => wl >= 400 && wl <= 500 ? i : -1).filter(i => i >= 0);
  const peakIndex = BASIS.bl.indexOf(Math.max(...BASIS.bl));
  assert(blueIndices.includes(peakIndex), 'Blue LED should peak in 400-500nm');
});

test('BASIS.rd peaks in red region (600-700nm)', () => {
  const redIndices = WL.map((wl, i) => wl >= 600 && wl <= 700 ? i : -1).filter(i => i >= 0);
  const peakIndex = BASIS.rd.indexOf(Math.max(...BASIS.rd));
  assert(redIndices.includes(peakIndex), 'Red LED should peak in 600-700nm');
});

// Integration Tests
console.log('\nIntegration:');
test('integrate() over full range', () => {
  const spd = new Array(WL.length).fill(1);
  const result = integrate(spd, 400, 750);
  assertClose(result, 350, 5, 'Full range integral should be ~350 (71 points * 5nm spacing)');
});

test('integrate() partial range', () => {
  const spd = new Array(WL.length).fill(1);
  const result = integrate(spd, 500, 600);
  assertClose(result, 100, 5, 'Partial range integral should be ~100');
});

test('integrateBand() BLUE', () => {
  const spd = new Array(WL.length).fill(1);
  const result = integrateBand(spd, 'BLUE');
  assertClose(result, 100, 5, 'Blue band (400-500nm) should be ~100');
});

test('integrateBand() PAR', () => {
  const spd = new Array(WL.length).fill(1);
  const result = integrateBand(spd, 'PAR');
  assertClose(result, 300, 10, 'PAR band (400-700nm) should be ~300');
});

// SPD Mixing Tests
console.log('\nSPD Mixing:');
test('mixSPD() with single channel', () => {
  const mix = { bl: 100 };
  const result = mixSPD(mix);
  assertEquals(result.length, WL.length);
  assert(result.some(v => v > 0), 'Mixed SPD should have non-zero values');
});

test('mixSPD() multi-channel', () => {
  const mix = { cw: 50, bl: 25, rd: 25 };
  const result = mixSPD(mix);
  assertEquals(result.length, WL.length);
  const sum = result.reduce((a, b) => a + b, 0);
  assert(sum > 0, 'Mixed SPD should have non-zero sum');
});

test('mixSPD() zero mix returns zeros', () => {
  const mix = { cw: 0, ww: 0, bl: 0, rd: 0 };
  const result = mixSPD(mix);
  const sum = result.reduce((a, b) => a + b, 0);
  assertClose(sum, 0, 0.001, 'Zero mix should produce zero SPD');
});

// Band Percentage Tests
console.log('\nBand Percentages:');
test('calculateBandPercentages() sum to 100%', () => {
  const spd = mixSPD({ cw: 50, bl: 25, rd: 25 });
  const bands = calculateBandPercentages(spd);
  const total = Object.values(bands).reduce((a, b) => a + b, 0);
  assertClose(total, 100, 0.1, 'Band percentages should sum to 100%');
});

test('calculateBandPercentages() pure blue', () => {
  const spd = mixSPD({ bl: 100 });
  const bands = calculateBandPercentages(spd);
  assert(bands.BLUE > 80, 'Pure blue SPD should have >80% blue band content');
});

test('calculateBandPercentages() pure red', () => {
  const spd = mixSPD({ rd: 100 });
  const bands = calculateBandPercentages(spd);
  assert(bands.RED > 80, 'Pure red SPD should have >80% red band content');
});

// Green Split Tests
console.log('\nGreen Split:');
test('splitGreenIntoWhites() returns valid proportions', () => {
  const result = splitGreenIntoWhites(50);
  assert(result.cw > 0 && result.ww > 0, 'Both CW and WW should be non-zero');
  assertClose(result.cw + result.ww, 50, 0.1, 'Split should sum to input value');
});

test('splitGreenIntoWhites() WW dominant', () => {
  const result = splitGreenIntoWhites(100);
  assert(result.ww > result.cw, 'WW should contribute more green than CW');
});

test('splitGreenIntoWhites() zero input', () => {
  const result = splitGreenIntoWhites(0);
  assertEquals(result.cw, 0);
  assertEquals(result.ww, 0);
});

// YPF Tests
console.log('\nYPF Calculations:');
test('calculateYPF() non-zero for PAR', () => {
  const spd = new Array(WL.length).fill(0);
  // Fill PAR region
  for (let i = 0; i < WL.length; i++) {
    if (WL[i] >= 400 && WL[i] <= 700) spd[i] = 1;
  }
  const ypf = calculateYPF(spd);
  assert(ypf > 0, 'YPF should be non-zero for PAR spectrum');
});

test('calculateYPF() zero outside PAR', () => {
  const spd = new Array(WL.length).fill(0);
  // Fill outside PAR
  for (let i = 0; i < WL.length; i++) {
    if (WL[i] < 400 || WL[i] > 700) spd[i] = 1;
  }
  const ypf = calculateYPF(spd);
  assertClose(ypf, 0, 0.01, 'YPF should be ~0 for non-PAR spectrum');
});

// VPD Tests
console.log('\nVPD Calculations:');
test('calculateVPD() typical conditions', () => {
  const vpd = calculateVPD(24, 60);
  assert(vpd > 0 && vpd < 5, 'VPD should be between 0-5 kPa for typical conditions');
});

test('calculateVPD() 100% RH yields ~0 VPD', () => {
  const vpd = calculateVPD(24, 100);
  assertClose(vpd, 0, 0.1, 'VPD should be ~0 at 100% RH');
});

test('calculateVPD() increases with temperature', () => {
  const vpd1 = calculateVPD(20, 60);
  const vpd2 = calculateVPD(30, 60);
  assert(vpd2 > vpd1, 'VPD should increase with temperature');
});

// Blue Adjustment Tests
console.log('\nBlue Adjustments:');
test('calculateBlueAdjustment() zero at target VPD', () => {
  const adj = calculateBlueAdjustment(1.0, 1.0);
  assertClose(adj, 0, 0.01, 'Blue adjustment should be 0 at target VPD');
});

test('calculateBlueAdjustment() positive for high VPD', () => {
  const adj = calculateBlueAdjustment(2.0, 1.0);
  assert(adj > 0, 'Blue should increase for high VPD');
  assert(adj <= 20, 'Blue adjustment should be ≤ 20%');
});

test('calculateBlueAdjustment() negative for low VPD', () => {
  const adj = calculateBlueAdjustment(0.5, 1.0);
  assert(adj < 0, 'Blue should decrease for low VPD');
  assert(adj >= -20, 'Blue adjustment should be ≥ -20%');
});

// PPFD Adjustment Tests
console.log('\nPPFD Adjustments:');
test('calculatePPFDAdjustment() zero at target temp', () => {
  const adj = calculatePPFDAdjustment(24, 24);
  assertClose(adj, 0, 0.01, 'PPFD adjustment should be 0 at target temp');
});

test('calculatePPFDAdjustment() negative for hot canopy', () => {
  const adj = calculatePPFDAdjustment(30, 24);
  assert(adj < 0, 'PPFD should decrease for hot canopy');
  assert(adj >= -30, 'PPFD adjustment should be ≥ -30%');
});

test('calculatePPFDAdjustment() positive for cool canopy', () => {
  const adj = calculatePPFDAdjustment(20, 24);
  assert(adj > 0, 'PPFD should increase for cool canopy');
  assert(adj <= 30, 'PPFD adjustment should be ≤ 30%');
});

// Integration Test
console.log('\nIntegration Workflow:');
test('Full workflow: mix → bands → YPF', () => {
  // Create typical grow spectrum (pure red to test band calculation)
  const mix = { bl: 30, rd: 70 };
  const spd = mixSPD(mix);
  const bands = calculateBandPercentages(spd);
  const ypf = calculateYPF(spd);
  
  // Validation
  assert(spd.length === WL.length, 'SPD should match WL length');
  assertClose(Object.values(bands).reduce((a,b) => a+b, 0), 100, 0.1, 'Bands should sum to 100%');
  assert(ypf > 0, 'YPF should be positive for grow spectrum');
  assert(bands.RED > bands.GREEN, 'Red-heavy spectrum should have more red than green');
  assert(bands.BLUE > bands.FAR_RED, 'Blue should be present and greater than far-red');
});

// Summary
console.log(`\n${'='.repeat(50)}`);
console.log(`[OK] Passed: ${passed}`);
console.log(`[ERROR] Failed: ${failed}`);
console.log(`[STATS] Total: ${passed + failed}`);
console.log(`${'='.repeat(50)}\n`);

process.exit(failed > 0 ? 1 : 0);
