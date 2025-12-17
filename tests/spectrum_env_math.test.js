/**
 * Unit Tests for spectrum_env_math.js
 * Run with: node --test tests/spectrum_env_math.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
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

// ============================================================================
// Wavelength Grid Tests
// ============================================================================

describe('Wavelength Grid', () => {
  it('should have correct range 400-750nm', () => {
    assert.equal(WL[0], 400);
    assert.equal(WL[WL.length - 1], 750);
  });
  
  it('should have 5nm step size', () => {
    const steps = new Set();
    for (let i = 1; i < WL.length; i++) {
      steps.add(WL[i] - WL[i - 1]);
    }
    assert.equal(steps.size, 1);
    assert.equal(steps.values().next().value, 5);
  });
  
  it('should have 71 points', () => {
    assert.equal(WL.length, 71);
  });
});

// ============================================================================
// BASIS Tests
// ============================================================================

describe('BASIS SPD Functions', () => {
  it('should have matching array lengths', () => {
    Object.keys(BASIS).forEach(channel => {
      assert.equal(
        BASIS[channel].length,
        WL.length,
        `BASIS.${channel} length mismatch`
      );
    });
  });
  
  it('should have normalized peaks (max = 1.0)', () => {
    Object.keys(BASIS).forEach(channel => {
      const max = Math.max(...BASIS[channel]);
      assert.ok(
        Math.abs(max - 1.0) < 0.01,
        `BASIS.${channel} peak not normalized: ${max}`
      );
    });
  });
  
  it('should have non-negative values', () => {
    Object.keys(BASIS).forEach(channel => {
      BASIS[channel].forEach((val, i) => {
        assert.ok(
          val >= 0,
          `BASIS.${channel}[${i}] is negative: ${val}`
        );
      });
    });
  });
  
  it('blue peak should be around 450nm', () => {
    const peakIdx = BASIS.bl.indexOf(Math.max(...BASIS.bl));
    const peakWL = WL[peakIdx];
    assert.ok(
      Math.abs(peakWL - 450) <= 10,
      `Blue peak at ${peakWL}nm, expected ~450nm`
    );
  });
  
  it('red peak should be around 660nm', () => {
    const peakIdx = BASIS.rd.indexOf(Math.max(...BASIS.rd));
    const peakWL = WL[peakIdx];
    assert.ok(
      Math.abs(peakWL - 660) <= 10,
      `Red peak at ${peakWL}nm, expected ~660nm`
    );
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe('Integration Functions', () => {
  it('integrate should handle full range', () => {
    const flatSPD = new Array(WL.length).fill(1.0);
    const result = integrate(flatSPD, 400, 750);
    // 71 points, 5nm step, trapezoidal rule ≈ 350 * 5 / 2 = 875
    assert.ok(result > 0, 'Integration should be positive');
    assert.ok(result < 2000, 'Integration should be reasonable');
  });
  
  it('integrate should return zero for non-overlapping range', () => {
    const result = integrate(BASIS.bl, 600, 700);
    assert.ok(result < 0.1, 'Blue should have minimal red content');
  });
  
  it('integrateBand should work with named bands', () => {
    const result = integrateBand(BASIS.bl, 'BLUE');
    assert.ok(result > 0, 'Blue LED should have blue content');
  });
  
  it('integrateBand should throw on invalid band', () => {
    assert.throws(() => {
      integrateBand(BASIS.bl, 'INVALID_BAND');
    });
  });
});

// ============================================================================
// Mixing Tests
// ============================================================================

describe('SPD Mixing', () => {
  it('mixSPD should handle all zeros', () => {
    const mix = { cw: 0, ww: 0, bl: 0, rd: 0, fr: 0 };
    const result = mixSPD(mix);
    assert.equal(result.length, WL.length);
    assert.ok(result.every(v => v === 0), 'All zeros should yield zero SPD');
  });
  
  it('mixSPD should handle single channel', () => {
    const mix = { cw: 0, ww: 0, bl: 100, rd: 0, fr: 0 };
    const result = mixSPD(mix);
    
    // Result should match BASIS.bl
    for (let i = 0; i < WL.length; i++) {
      assert.ok(
        Math.abs(result[i] - BASIS.bl[i]) < 0.01,
        `Mismatch at ${WL[i]}nm`
      );
    }
  });
  
  it('mixSPD should handle multiple channels', () => {
    const mix = { cw: 50, ww: 50, bl: 0, rd: 0, fr: 0 };
    const result = mixSPD(mix);
    
    // Result should be average of cw and ww
    for (let i = 0; i < WL.length; i++) {
      const expected = (BASIS.cw[i] + BASIS.ww[i]) / 2;
      assert.ok(
        Math.abs(result[i] - expected) < 0.01,
        `Mismatch at ${WL[i]}nm`
      );
    }
  });
});

// ============================================================================
// Band Percentage Tests
// ============================================================================

describe('Band Percentage Calculation', () => {
  it('should sum to 100% for standard bands', () => {
    const spd = mixSPD({ cw: 50, ww: 50, bl: 0, rd: 0, fr: 0 });
    const bands = calculateBandPercentages(spd);
    
    const total = bands.BLUE + bands.GREEN + bands.RED + bands.FAR_RED;
    assert.ok(
      Math.abs(total - 100) < 0.1,
      `Total should be ~100%, got ${total}%`
    );
  });
  
  it('blue LED should have high blue percentage', () => {
    const spd = mixSPD({ cw: 0, ww: 0, bl: 100, rd: 0, fr: 0 });
    const bands = calculateBandPercentages(spd);
    
    assert.ok(
      bands.BLUE > 80,
      `Blue LED should be >80% blue, got ${bands.BLUE}%`
    );
  });
  
  it('red LED should have high red percentage', () => {
    const spd = mixSPD({ cw: 0, ww: 0, bl: 0, rd: 100, fr: 0 });
    const bands = calculateBandPercentages(spd);
    
    assert.ok(
      bands.RED > 80,
      `Red LED should be >80% red, got ${bands.RED}%`
    );
  });
});

// ============================================================================
// Green Split Tests
// ============================================================================

describe('Green Split (SPD-Weighted)', () => {
  it('should return zeros for zero green', () => {
    const result = splitGreenIntoWhites(0);
    assert.equal(result.cw, 0);
    assert.equal(result.ww, 0);
  });
  
  it('should return zeros for null green', () => {
    const result = splitGreenIntoWhites(null);
    assert.equal(result.cw, 0);
    assert.equal(result.ww, 0);
  });
  
  it('should split 100% green into CW and WW', () => {
    const result = splitGreenIntoWhites(100);
    
    // Should sum to 100
    const total = result.cw + result.ww;
    assert.ok(
      Math.abs(total - 100) < 0.1,
      `Total should be 100%, got ${total}%`
    );
    
    // WW should get more green (has more yellow/green phosphor)
    assert.ok(
      result.ww > result.cw,
      `WW (${result.ww}%) should get more green than CW (${result.cw}%)`
    );
  });
  
  it('should maintain proportionality', () => {
    const result50 = splitGreenIntoWhites(50);
    const result100 = splitGreenIntoWhites(100);
    
    // 50% should be half of 100%
    assert.ok(
      Math.abs(result50.cw * 2 - result100.cw) < 0.1,
      'CW should scale linearly'
    );
    assert.ok(
      Math.abs(result50.ww * 2 - result100.ww) < 0.1,
      'WW should scale linearly'
    );
  });
});

// ============================================================================
// YPF Tests
// ============================================================================

describe('YPF Calculation', () => {
  it('should return positive value for white light', () => {
    const spd = mixSPD({ cw: 50, ww: 50, bl: 0, rd: 0, fr: 0 });
    const ypf = calculateYPF(spd);
    assert.ok(ypf > 0, 'YPF should be positive for white light');
  });
  
  it('should return zero for all-zero SPD', () => {
    const spd = new Array(WL.length).fill(0);
    const ypf = calculateYPF(spd);
    assert.ok(Math.abs(ypf) < 0.001, 'YPF should be zero for zero SPD');
  });
  
  it('red LED should have high YPF (McCree peak)', () => {
    const spdRed = mixSPD({ cw: 0, ww: 0, bl: 0, rd: 100, fr: 0 });
    const spdBlue = mixSPD({ cw: 0, ww: 0, bl: 100, rd: 0, fr: 0 });
    
    const ypfRed = calculateYPF(spdRed);
    const ypfBlue = calculateYPF(spdBlue);
    
    assert.ok(
      ypfRed > ypfBlue,
      'Red should have higher YPF than blue (McCree curve)'
    );
  });
});

// ============================================================================
// VPD Tests
// ============================================================================

describe('VPD Calculation', () => {
  it('should calculate VPD correctly', () => {
    // 25°C, 60% RH → VPD ≈ 1.27 kPa
    const vpd = calculateVPD(25, 60);
    assert.ok(vpd > 1.0 && vpd < 1.5, `VPD should be ~1.27 kPa, got ${vpd}`);
  });
  
  it('should return zero for 100% RH', () => {
    const vpd = calculateVPD(25, 100);
    assert.ok(vpd < 0.01, 'VPD should be ~0 at 100% RH');
  });
  
  it('should increase with temperature at constant RH', () => {
    const vpd20 = calculateVPD(20, 60);
    const vpd30 = calculateVPD(30, 60);
    assert.ok(vpd30 > vpd20, 'VPD should increase with temperature');
  });
  
  it('should decrease with RH at constant temp', () => {
    const vpd40 = calculateVPD(25, 40);
    const vpd80 = calculateVPD(25, 80);
    assert.ok(vpd40 > vpd80, 'VPD should decrease with RH');
  });
});

// ============================================================================
// Environmental Adjustment Tests
// ============================================================================

describe('Blue Adjustment (VPD-driven)', () => {
  it('should return zero at target VPD', () => {
    const adjust = calculateBlueAdjustment(1.0, 1.0);
    assert.ok(Math.abs(adjust) < 0.01, 'Should be zero at target');
  });
  
  it('should increase blue for high VPD', () => {
    const adjust = calculateBlueAdjustment(2.0, 1.0);
    assert.ok(adjust > 0, 'High VPD should increase blue');
  });
  
  it('should decrease blue for low VPD', () => {
    const adjust = calculateBlueAdjustment(0.5, 1.0);
    assert.ok(adjust < 0, 'Low VPD should decrease blue');
  });
  
  it('should clamp to max adjustment', () => {
    const adjust = calculateBlueAdjustment(10.0, 1.0, 20);
    assert.ok(adjust <= 20, 'Should not exceed +20%');
    assert.ok(adjust >= -20, 'Should not go below -20%');
  });
  
  it('should handle null VPD', () => {
    const adjust = calculateBlueAdjustment(null, 1.0);
    assert.equal(adjust, 0, 'Null VPD should return 0');
  });
});

describe('PPFD Adjustment (Temperature-driven)', () => {
  it('should return zero at target temperature', () => {
    const adjust = calculatePPFDAdjustment(24, 24);
    assert.ok(Math.abs(adjust) < 0.01, 'Should be zero at target');
  });
  
  it('should decrease PPFD for high temperature', () => {
    const adjust = calculatePPFDAdjustment(30, 24);
    assert.ok(adjust < 0, 'High temp should decrease PPFD');
  });
  
  it('should increase PPFD for low temperature', () => {
    const adjust = calculatePPFDAdjustment(18, 24);
    assert.ok(adjust > 0, 'Low temp should increase PPFD');
  });
  
  it('should clamp to max adjustment', () => {
    const adjust = calculatePPFDAdjustment(50, 24, 30);
    assert.ok(adjust <= 30, 'Should not exceed +30%');
    assert.ok(adjust >= -30, 'Should not go below -30%');
  });
  
  it('should handle null temperature', () => {
    const adjust = calculatePPFDAdjustment(null, 24);
    assert.equal(adjust, 0, 'Null temp should return 0');
  });
});

// ============================================================================
// Integration Test: Full Workflow
// ============================================================================

describe('Integration: Full Spectrum Workflow', () => {
  it('should calculate spectrum from channel mix with green split', () => {
    // Recipe with green but no CW/WW specified
    const recipe = { bl: 30, gn: 20, rd: 50 };
    
    // Split green
    const greenSplit = splitGreenIntoWhites(recipe.gn);
    
    // Build full mix
    const mix = {
      cw: greenSplit.cw,
      ww: greenSplit.ww,
      bl: recipe.bl,
      rd: recipe.rd,
      fr: 0
    };
    
    // Generate SPD
    const spd = mixSPD(mix);
    
    // Calculate band percentages
    const bands = calculateBandPercentages(spd);
    
    // Verify results
    assert.ok(bands.BLUE > 0, 'Should have blue content');
    assert.ok(bands.GREEN > 0, 'Should have green content');
    assert.ok(bands.RED > 0, 'Should have red content');
    
    const total = bands.BLUE + bands.GREEN + bands.RED + bands.FAR_RED;
    assert.ok(
      Math.abs(total - 100) < 0.1,
      `Bands should sum to 100%, got ${total}%`
    );
  });
  
  it('should apply environmental adjustments', () => {
    // Starting conditions
    const baseBlue = 30;
    const basePPFD = 400;
    
    // Environmental data
    const temp = 28; // Hot
    const rh = 50;
    const vpd = calculateVPD(temp, rh);
    
    // Calculate adjustments
    const blueAdj = calculateBlueAdjustment(vpd, 1.0, 20);
    const ppfdAdj = calculatePPFDAdjustment(temp, 24, 30);
    
    // Apply adjustments
    const adjBlue = baseBlue + blueAdj;
    const adjPPFD = basePPFD * (1 + ppfdAdj / 100);
    
    // Verify reasonable results
    assert.ok(adjBlue > 0 && adjBlue <= 100, 'Blue should be in valid range');
    assert.ok(adjPPFD > 0, 'PPFD should be positive');
    
    // Hot + high VPD should increase blue and decrease PPFD
    assert.ok(adjBlue > baseBlue, 'Blue should increase for high VPD');
    assert.ok(adjPPFD < basePPFD, 'PPFD should decrease for high temp');
  });
});

console.log('All tests completed. Run with: node --test tests/spectrum_env_math.test.js');
