#!/usr/bin/env node

/**
 * Solver UI Test Script
 * Tests the matrix solver UI with band-based recipes
 */

const fs = require('fs');
const path = require('path');

console.log('=== Solver UI Test - Band-Based Recipes ===\n');

// Load plans
const plansPath = path.join(__dirname, '../public/data/plans.json');
const plansData = JSON.parse(fs.readFileSync(plansPath, 'utf8'));

// Find band-based plans
const bandBasedPlans = plansData.plans.filter(p => 
  p.id && p.id.includes('BandBased')
);

console.log(`Found ${bandBasedPlans.length} band-based plans:\n`);

bandBasedPlans.forEach(plan => {
  console.log(`📋 ${plan.name} (${plan.id})`);
  console.log(`   Crop: ${plan.crop || 'N/A'}`);
  console.log(`   Photoperiod: ${plan.photoperiod || 'N/A'}`);
  console.log(`   Days: ${plan.days.length}`);
  
  // Check each day for bandTargets
  plan.days.forEach(day => {
    if (day.bandTargets) {
      console.log(`   ✅ Day ${day.day}: Has bandTargets`);
      console.log(`      B: ${day.bandTargets.B}%, G: ${day.bandTargets.G}%, R: ${day.bandTargets.R}%, FR: ${day.bandTargets.FR}%`);
      console.log(`      Stage: ${day.stage || 'N/A'}`);
      console.log(`      PPFD: ${day.ppfd || 'N/A'} µmol·m⁻²·s⁻¹`);
    } else {
      console.log(`   ❌ Day ${day.day}: No bandTargets (has spectrum channels instead)`);
    }
  });
  
  console.log();
});

// Check for legacy plans (channel-based)
const legacyPlans = plansData.plans.filter(p => {
  if (!p.days || p.days.length === 0) return false;
  const firstDay = p.days[0];
  return !firstDay.bandTargets && firstDay.spectrum;
});

console.log(`\nFound ${legacyPlans.length} legacy channel-based plans:\n`);

legacyPlans.slice(0, 3).forEach(plan => {
  console.log(`📋 ${plan.name} (${plan.id})`);
  const firstDay = plan.days[0];
  if (firstDay.spectrum) {
    console.log(`   Channel recipe: CW=${firstDay.spectrum.cw || 0}%, WW=${firstDay.spectrum.ww || 0}%, BL=${firstDay.spectrum.bl || 0}%, RD=${firstDay.spectrum.rd || 0}%`);
  }
  console.log();
});

console.log('\n=== Expected Behavior ===\n');

console.log('✅ BAND-BASED PLANS (Solver UI should appear):');
console.log('   - DEMO: Band-Based Vegetative Spectrum');
console.log('     • Golden gradient solver section visible');
console.log('     • Target bands: B:25%, G:35%, R:40%, FR:0%');
console.log('     • Achieved bands calculated from solved channels');
console.log('     • Computed channels: CW/WW/BL/RD displayed');
console.log('     • Error metric with color coding (green = good fit)');
console.log('');
console.log('   - DEMO: Band-Based Flowering Spectrum');
console.log('     • Golden gradient solver section visible');
console.log('     • Target bands: B:18%, G:27%, R:50%, FR:5%');
console.log('     • More red-dominant spectrum for flowering');
console.log('');

console.log('❌ LEGACY PLANS (Solver UI should hide):');
console.log('   - DEMO-Lettuce-28Day');
console.log('   - DEMO-Strawberry-EverFruiting');
console.log('   - Any plan with spectrum.cw/ww/bl/rd values');
console.log('   - Solver section should not appear');
console.log('');

console.log('\n=== Manual Test Checklist ===\n');

console.log('[ ] Step 1: Open http://localhost:8091');
console.log('[ ] Step 2: Navigate to Groups V2 panel');
console.log('[ ] Step 3: Click ➕ New Group button');
console.log('[ ] Step 4: Fill in basic info:');
console.log('      - Name: "Solver Test"');
console.log('      - Room: Any room');
console.log('      - Zone: Any zone');
console.log('[ ] Step 5: Select "DEMO: Band-Based Vegetative Spectrum" from plan dropdown');
console.log('[ ] Step 6: Verify solver section appears with golden gradient');
console.log('[ ] Step 7: Check console for log: "[updatePlanCardForDay] Day has band targets:"');
console.log('[ ] Step 8: Verify target bands display correctly:');
console.log('      - Blue: 25.0%');
console.log('      - Green: 35.0%');
console.log('      - Red: 40.0%');
console.log('      - Far-Red: 0.0%');
console.log('[ ] Step 9: Verify achieved bands are calculated');
console.log('[ ] Step 10: Verify computed channels shown (CW/WW/BL/RD)');
console.log('[ ] Step 11: Check error metric (should be green with low RMS error)');
console.log('[ ] Step 12: Switch to "DEMO: Band-Based Flowering Spectrum"');
console.log('[ ] Step 13: Verify solver updates with new targets:');
console.log('      - Blue: 18.0%');
console.log('      - Green: 27.0%');
console.log('      - Red: 50.0%');
console.log('      - Far-Red: 5.0%');
console.log('[ ] Step 14: Switch to "DEMO-Lettuce-28Day" (legacy)');
console.log('[ ] Step 15: Verify solver section disappears');
console.log('[ ] Step 16: Check console for log: "[updatePlanCardForDay] Using legacy channel-based recipe"');
console.log('');

console.log('\n=== Console Commands for Testing ===\n');

console.log('// Check if solver function exists');
console.log('typeof window.solveChannelsFromBands');
console.log('');

console.log('// Check if calibration matrix exists');
console.log('window.STATE.calibrationMatrix');
console.log('');

console.log('// Test solver directly');
console.log('window.testMatrixSolver({ B: 0.25, G: 0.35, R: 0.40, FR: 0 })');
console.log('');

console.log('// Check current plan day data');
console.log('window.STATE.currentPlan?.days[0]');
console.log('');

console.log('\n✅ Test script complete!');
console.log('Open http://localhost:8091 to begin manual testing.\n');
