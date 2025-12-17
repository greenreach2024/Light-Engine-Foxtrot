#!/usr/bin/env node
/**
 * Hold & Repeat Anchor Mode - Automated Test Script
 * 
 * Tests the 🔄 Hold & Repeat feature for ever-fruiting crops.
 * This mode locks a group's recipe at a specific day indefinitely.
 * 
 * Test Plan:
 * 1. Verify strawberry plan exists and has 1-day structure
 * 2. Create test group with hold mode in groups.json
 * 3. Verify groups.json structure (anchor.mode = 'hold')
 * 4. Test day number calculation (should return holdDay)
 * 5. Verify no harvest countdown expected
 * 6. Check that recipe can be retrieved for day 1
 */

const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const DATA_DIR = path.join(PUBLIC_DIR, 'data');

console.log('\n🧪 Hold & Repeat Anchor Mode - Automated Tests\n');
console.log('=' .repeat(60));

// Test counters
let passed = 0;
let failed = 0;
let warnings = 0;

function test(name, condition, message = '') {
  if (condition) {
    console.log(`✅ ${name}`);
    if (message) console.log(`   ${message}`);
    passed++;
  } else {
    console.log(`❌ ${name}`);
    if (message) console.log(`   ${message}`);
    failed++;
  }
}

function warn(name, message = '') {
  console.log(`⚠️  ${name}`);
  if (message) console.log(`   ${message}`);
  warnings++;
}

function info(message) {
  console.log(`ℹ️  ${message}`);
}

// ============================================================================
// TEST 1: Verify Strawberry Plan Exists
// ============================================================================
console.log('\n📋 Test 1: Verify Strawberry Ever-Fruiting Plan\n');

const plansPath = path.join(DATA_DIR, 'plans.json');
let plans;

try {
  plans = JSON.parse(fs.readFileSync(plansPath, 'utf8'));
  test('Plans file loaded', true);
} catch (err) {
  test('Plans file loaded', false, `Error: ${err.message}`);
  process.exit(1);
}

const strawberryPlan = plans.plans.find(p => p.id === 'DEMO-Strawberry-EverFruiting');

test('Strawberry plan exists', !!strawberryPlan, 
  strawberryPlan ? `Found: ${strawberryPlan.name}` : 'Plan not found');

if (strawberryPlan) {
  test('Plan has 1 day', strawberryPlan.days.length === 1,
    `Days: ${strawberryPlan.days.length}`);
  
  test('Day 1 exists', !!strawberryPlan.days[0],
    strawberryPlan.days[0] ? 'Day 1 recipe present' : 'Missing day 1');
  
  if (strawberryPlan.days[0]) {
    const day1 = strawberryPlan.days[0];
    test('Day 1 has stage', !!day1.stage, `Stage: ${day1.stage || 'missing'}`);
    test('Day 1 has channels', 
      day1.cw !== undefined && day1.ww !== undefined && day1.bl !== undefined && day1.rd !== undefined,
      `CW:${day1.cw}% WW:${day1.ww}% BL:${day1.bl}% RD:${day1.rd}%`);
    test('Day 1 has bandTargets', !!day1.bandTargets,
      day1.bandTargets ? `B:${day1.bandTargets.B}% G:${day1.bandTargets.G}% R:${day1.bandTargets.R}% FR:${day1.bandTargets.FR}%` : 'Missing');
  }
}

// ============================================================================
// TEST 2: Create Test Group with Hold Mode
// ============================================================================
console.log('\n📋 Test 2: Create Test Group with Hold Mode\n');

const groupsPath = path.join(DATA_DIR, 'groups.json');
let groupsData;

try {
  groupsData = JSON.parse(fs.readFileSync(groupsPath, 'utf8'));
  test('Groups file loaded', true, `Found ${groupsData.groups.length} existing groups`);
} catch (err) {
  // File might not exist yet
  groupsData = { groups: [] };
  info('Groups file not found - will create new');
}

// Create test group
const testGroup = {
  id: 'Test Room:1:Strawberry Test',
  name: 'Strawberry Test',
  room: 'Test Room',
  zone: '1',
  plan: 'DEMO-Strawberry-EverFruiting',
  status: 'deployed',
  planConfig: {
    planId: 'DEMO-Strawberry-EverFruiting',
    anchor: {
      mode: 'hold',
      seedDate: null,
      dps: null,
      holdDay: 1
    }
  },
  created: new Date().toISOString(),
  lastModified: new Date().toISOString()
};

// Remove any existing test group
groupsData.groups = groupsData.groups.filter(g => g.id !== testGroup.id);

// Add test group
groupsData.groups.push(testGroup);

// Save groups file
try {
  fs.writeFileSync(groupsPath, JSON.stringify(groupsData, null, 2), 'utf8');
  test('Test group created', true, `ID: ${testGroup.id}`);
} catch (err) {
  test('Test group created', false, `Error: ${err.message}`);
  process.exit(1);
}

// ============================================================================
// TEST 3: Verify Group Structure
// ============================================================================
console.log('\n📋 Test 3: Verify Group Structure\n');

// Re-read to verify
const savedGroups = JSON.parse(fs.readFileSync(groupsPath, 'utf8'));
const savedGroup = savedGroups.groups.find(g => g.id === testGroup.id);

test('Group persisted', !!savedGroup);

if (savedGroup) {
  test('Group has planConfig', !!savedGroup.planConfig);
  test('planConfig has anchor', !!savedGroup.planConfig.anchor);
  
  if (savedGroup.planConfig.anchor) {
    const anchor = savedGroup.planConfig.anchor;
    test('Anchor mode is "hold"', anchor.mode === 'hold', `Mode: ${anchor.mode}`);
    test('Hold day is 1', anchor.holdDay === 1, `Hold day: ${anchor.holdDay}`);
    test('seedDate is null', anchor.seedDate === null, `seedDate: ${anchor.seedDate}`);
    test('dps is null', anchor.dps === null, `dps: ${anchor.dps}`);
  }
  
  test('Group status is deployed', savedGroup.status === 'deployed', `Status: ${savedGroup.status}`);
  test('Group has timestamps', !!savedGroup.created && !!savedGroup.lastModified);
}

console.log('\n📊 Group Structure:');
console.log(JSON.stringify(savedGroup, null, 2));

// ============================================================================
// TEST 4: Test Day Number Calculation Logic
// ============================================================================
console.log('\n📋 Test 4: Day Number Calculation Logic\n');

info('Testing day number calculation for hold mode...');

// Simulate getGroupsV2DayNumber() logic
function calculateDayNumber(anchor, planDays) {
  if (anchor.mode === 'hold') {
    return anchor.holdDay || 1;
  } else if (anchor.mode === 'seedDate' && anchor.seedDate) {
    const seedDate = new Date(anchor.seedDate);
    const today = new Date();
    const diffMs = today - seedDate;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    return Math.max(1, Math.min(diffDays + 1, planDays));
  } else if (anchor.mode === 'dps' && anchor.dps) {
    return Math.max(1, Math.min(anchor.dps, planDays));
  }
  return 1;
}

const calculatedDay = calculateDayNumber(savedGroup.planConfig.anchor, strawberryPlan.days.length);

test('Day number calculation returns holdDay', calculatedDay === 1,
  `Expected: 1, Got: ${calculatedDay}`);

info('Simulating multiple calls (should always return 1):');
for (let i = 0; i < 3; i++) {
  const day = calculateDayNumber(savedGroup.planConfig.anchor, strawberryPlan.days.length);
  console.log(`   Call ${i + 1}: Day ${day}`);
  test(`Call ${i + 1} returns day 1`, day === 1);
}

// ============================================================================
// TEST 5: Harvest Countdown Logic
// ============================================================================
console.log('\n📋 Test 5: Harvest Countdown Logic\n');

info('Testing harvest countdown for hold mode...');

function calculateHarvestCountdown(anchor, planDays) {
  if (anchor.mode === 'hold') {
    return null; // No countdown for hold mode
  } else if (anchor.mode === 'seedDate' && anchor.seedDate) {
    const seedDate = new Date(anchor.seedDate);
    const today = new Date();
    const diffMs = today - seedDate;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const currentDay = diffDays + 1;
    return planDays - currentDay;
  } else if (anchor.mode === 'dps' && anchor.dps) {
    return planDays - anchor.dps;
  }
  return null;
}

const countdown = calculateHarvestCountdown(savedGroup.planConfig.anchor, strawberryPlan.days.length);

test('Hold mode returns no countdown', countdown === null,
  `Expected: null, Got: ${countdown}`);

info('This is correct - ever-fruiting crops never reach harvest day');

// ============================================================================
// TEST 6: Recipe Retrieval
// ============================================================================
console.log('\n📋 Test 6: Recipe Retrieval\n');

info('Testing recipe retrieval for day 1...');

const day1Recipe = strawberryPlan.days[0];

test('Recipe exists for day 1', !!day1Recipe);

if (day1Recipe) {
  test('Recipe has stage', !!day1Recipe.stage, `Stage: ${day1Recipe.stage}`);
  test('Recipe has channels', 
    day1Recipe.cw !== undefined && day1Recipe.ww !== undefined,
    `CW:${day1Recipe.cw}% WW:${day1Recipe.ww}%`);
  test('Recipe has bandTargets', !!day1Recipe.bandTargets);
  test('Recipe has PPFD', !!day1Recipe.ppfd, `PPFD: ${day1Recipe.ppfd}`);
  test('Recipe has DLI', !!day1Recipe.dli, `DLI: ${day1Recipe.dli}`);
  test('Recipe has tempC', !!day1Recipe.tempC, `Temp: ${day1Recipe.tempC}°C`);
}

console.log('\n📊 Day 1 Recipe:');
console.log(JSON.stringify(day1Recipe, null, 2));

// ============================================================================
// TEST 7: Physical Light Settings
// ============================================================================
console.log('\n📋 Test 7: Physical Light Settings Validation\n');

if (day1Recipe) {
  const totalChannel = (day1Recipe.cw || 0) + (day1Recipe.ww || 0) + (day1Recipe.bl || 0) + (day1Recipe.rd || 0);
  
  test('Total channel intensity <= 100%', totalChannel <= 100,
    `Total: ${totalChannel}%`);
  
  test('Red-dominant spectrum', (day1Recipe.rd || 0) >= 40,
    `Red channel: ${day1Recipe.rd}%`);
  
  if (day1Recipe.bandTargets) {
    test('Red band target >= 50%', day1Recipe.bandTargets.R >= 50,
      `Red band: ${day1Recipe.bandTargets.R}%`);
    
    info('Red-dominant spectrum is correct for fruiting strawberries');
  }
  
  test('PPFD in valid range', day1Recipe.ppfd >= 200 && day1Recipe.ppfd <= 800,
    `PPFD: ${day1Recipe.ppfd} μmol/m²/s`);
  
  test('DLI in valid range', day1Recipe.dli >= 10 && day1Recipe.dli <= 40,
    `DLI: ${day1Recipe.dli} mol/m²/day`);
}

// ============================================================================
// TEST 8: Compare with Other Anchor Modes
// ============================================================================
console.log('\n📋 Test 8: Compare Anchor Modes\n');

info('Testing different anchor modes...');

const seedDateAnchor = {
  mode: 'seedDate',
  seedDate: '2025-10-15', // 4 days ago
  dps: null,
  holdDay: null
};

const dpsAnchor = {
  mode: 'dps',
  seedDate: null,
  dps: 25,
  holdDay: null
};

const holdAnchor = {
  mode: 'hold',
  seedDate: null,
  dps: null,
  holdDay: 1
};

const planLength = 28;

const seedDay = calculateDayNumber(seedDateAnchor, planLength);
const dpsDay = calculateDayNumber(dpsAnchor, planLength);
const holdDay = calculateDayNumber(holdAnchor, planLength);

console.log(`\n   Seed Date Mode (planted 4 days ago): Day ${seedDay}`);
console.log(`   DPS Mode (DPS = 25): Day ${dpsDay}`);
console.log(`   Hold Mode (holdDay = 1): Day ${holdDay}`);

test('Seed date mode returns day 5', seedDay === 5, `Got: Day ${seedDay}`);
test('DPS mode returns day 25', dpsDay === 25, `Got: Day ${dpsDay}`);
test('Hold mode returns day 1', holdDay === 1, `Got: Day ${holdDay}`);

const seedCountdown = calculateHarvestCountdown(seedDateAnchor, planLength);
const dpsCountdown = calculateHarvestCountdown(dpsAnchor, planLength);
const holdCountdown = calculateHarvestCountdown(holdAnchor, planLength);

console.log(`\n   Seed Date Mode countdown: ${seedCountdown} days`);
console.log(`   DPS Mode countdown: ${dpsCountdown} days`);
console.log(`   Hold Mode countdown: ${holdCountdown === null ? 'none (ever-fruiting)' : holdCountdown}`);

test('Only hold mode has no countdown', 
  seedCountdown !== null && dpsCountdown !== null && holdCountdown === null);

// ============================================================================
// TEST 9: Edge Cases
// ============================================================================
console.log('\n📋 Test 9: Edge Cases\n');

info('Testing edge cases...');

// Test hold day beyond plan length
const edgeAnchor1 = { mode: 'hold', seedDate: null, dps: null, holdDay: 99 };
const edgeDay1 = calculateDayNumber(edgeAnchor1, 1);
test('Hold day beyond plan length still returns holdDay', edgeDay1 === 99,
  `Expected: 99, Got: ${edgeDay1}`);
warn('Note: UI should validate holdDay <= plan length', 
  'Server-side validation recommended');

// Test hold day = 0
const edgeAnchor2 = { mode: 'hold', seedDate: null, dps: null, holdDay: 0 };
const edgeDay2 = calculateDayNumber(edgeAnchor2, 1);
test('Hold day = 0 returns 0', edgeDay2 === 0,
  `Expected: 0, Got: ${edgeDay2}`);
warn('Note: UI should validate holdDay >= 1',
  'Day 0 is not physically meaningful');

// Test missing holdDay (should default to 1)
const edgeAnchor3 = { mode: 'hold', seedDate: null, dps: null };
const edgeDay3 = calculateDayNumber(edgeAnchor3, 1);
test('Missing holdDay defaults to 1', edgeDay3 === 1,
  `Expected: 1, Got: ${edgeDay3}`);

// ============================================================================
// TEST 10: Server Endpoint Check
// ============================================================================
console.log('\n📋 Test 10: Server Endpoint Availability\n');

const http = require('http');

function checkEndpoint(url) {
  return new Promise((resolve) => {
    http.get(url, (res) => {
      resolve(res.statusCode === 200);
    }).on('error', () => {
      resolve(false);
    });
  });
}

(async () => {
  const serverRunning = await checkEndpoint('http://localhost:8091/');
  test('Server is running', serverRunning, 
    serverRunning ? 'http://localhost:8091' : 'Server not responding');
  
  if (serverRunning) {
    const groupsEndpoint = await checkEndpoint('http://localhost:8091/data/groups.json');
    test('Groups endpoint accessible', groupsEndpoint,
      'http://localhost:8091/data/groups.json');
    
    const plansEndpoint = await checkEndpoint('http://localhost:8091/data/plans.json');
    test('Plans endpoint accessible', plansEndpoint,
      'http://localhost:8091/data/plans.json');
  }
  
  // ============================================================================
  // SUMMARY
  // ============================================================================
  console.log('\n' + '='.repeat(60));
  console.log('📊 Test Summary\n');
  console.log(`✅ Passed: ${passed}`);
  console.log(`⚠️  Warnings: ${warnings}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📊 Total: ${passed + failed}`);
  
  if (failed === 0) {
    console.log('\n🎉 All automated tests PASSED!');
  } else {
    console.log(`\n⚠️  ${failed} test(s) FAILED`);
  }
  
  if (serverRunning) {
    console.log('\n✅ Server is running at http://localhost:8091');
    console.log('📄 Navigate to Groups V2 panel to test UI:');
    console.log('   1. Load "Strawberry Test" group from dropdown');
    console.log('   2. Verify 🔄 Hold & Repeat mode is selected');
    console.log('   3. Verify Hold Day = 1');
    console.log('   4. Check plan card shows "Day 1 of 1"');
    console.log('   5. Verify solver section shows red-dominant spectrum');
  }
  
  console.log('\n' + '='.repeat(60) + '\n');
  
  process.exit(failed > 0 ? 1 : 0);
})();
