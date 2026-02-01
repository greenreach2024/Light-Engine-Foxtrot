#!/usr/bin/env node
/**
 * Validation Script: Succession Planting Automation (P4)
 * 
 * Validates:
 * - Service integration (lib/succession-planner.js)
 * - Tray format calculations (microgreens vs full heads)
 * - Crop-specific spacing (baby greens vs full lettuce vs tomato)
 * - Server integration (API endpoints)
 * - Backward scheduling accuracy
 * - Capacity constraints
 * - GreenReach Central integration (bidirectional communication)
 * 
 * Framework Compliance:
 * - Progressive enhancement (minimal → enhanced data)
 * - Zero configuration (auto from demand)
 * - Simplicity (clear, actionable outputs)
 */

import SuccessionPlanner from '../lib/succession-planner.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Test tracking
const tests = [];
const results = { passed: 0, failed: 0, total: 0 };

function test(name, fn) {
  tests.push({ name, fn });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

// ============================================================================
// SERVICE VALIDATION
// ============================================================================

test('SuccessionPlanner: Can instantiate service', () => {
  const dataDir = path.join(__dirname, '..', 'public', 'data');
  const planner = new SuccessionPlanner(dataDir);
  assert(planner, 'Service should be created');
  assert(planner.generateSchedule, 'generateSchedule method should exist');
  assert(planner.suggestFromDemand, 'suggestFromDemand method should exist');
});

test('SuccessionPlanner: Get tray format for full head lettuce', () => {
  const dataDir = path.join(__dirname, '..', 'public', 'data');
  const planner = new SuccessionPlanner(dataDir);
  
  const format = planner.getTrayFormatForCrop('Butterhead Lettuce');
  assert(format.plantSiteCount === 128, `Expected 128 plants/tray for Butterhead Lettuce, got ${format.plantSiteCount}`);
  assert(format.density === 'standard', 'Expected standard density');
  assert(!format.isWeightBased, 'Expected head-based (not weight-based)');
});

test('SuccessionPlanner: Get tray format for baby greens', () => {
  const dataDir = path.join(__dirname, '..', 'public', 'data');
  const planner = new SuccessionPlanner(dataDir);
  
  const format = planner.getTrayFormatForCrop('Baby Arugula');
  assert(format.plantSiteCount === 200, `Expected 200 plants/tray for Baby Arugula, got ${format.plantSiteCount}`);
  assert(format.density === 'high', 'Expected high density');
  assert(!format.isWeightBased, 'Expected head-based (not weight-based)');
});

test('SuccessionPlanner: Get tray format for microgreens', () => {
  const dataDir = path.join(__dirname, '..', 'public', 'data');
  const planner = new SuccessionPlanner(dataDir);
  
  const format = planner.getTrayFormatForCrop('Microgreens');
  assert(format.plantSiteCount === 21, `Expected 21 plants/tray for Microgreens, got ${format.plantSiteCount}`);
  assert(format.density === 'ultra-high', 'Expected ultra-high density');
  assert(format.isWeightBased, 'Expected weight-based');
});

test('SuccessionPlanner: Get tray format for tomatoes', () => {
  const dataDir = path.join(__dirname, '..', 'public', 'data');
  const planner = new SuccessionPlanner(dataDir);
  
  const format = planner.getTrayFormatForCrop('Tomato');
  assert(format.plantSiteCount === 8, `Expected 8 plants/tray for Tomato, got ${format.plantSiteCount}`);
  assert(format.density === 'low', 'Expected low density');
  assert(!format.isWeightBased, 'Expected head-based (not weight-based)');
});

test('SuccessionPlanner: Get growth duration for lettuce', async () => {
  const dataDir = path.join(__dirname, '..', 'public', 'data');
  const planner = new SuccessionPlanner(dataDir);
  
  const duration = await planner.getGrowthDuration('Butterhead Lettuce');
  assert(duration === 32, `Expected 32 days for Butterhead Lettuce, got ${duration}`);
});

test('SuccessionPlanner: Get growth duration for baby greens', async () => {
  const dataDir = path.join(__dirname, '..', 'public', 'data');
  const planner = new SuccessionPlanner(dataDir);
  
  const duration = await planner.getGrowthDuration('Baby Arugula');
  assert(duration === 21, `Expected 21 days for Baby Arugula, got ${duration}`);
});

test('SuccessionPlanner: Get growth duration for microgreens', async () => {
  const dataDir = path.join(__dirname, '..', 'public', 'data');
  const planner = new SuccessionPlanner(dataDir);
  
  const duration = await planner.getGrowthDuration('Microgreens');
  assert(duration === 10, `Expected 10 days for Microgreens, got ${duration}`);
});

// ============================================================================
// SCHEDULE GENERATION
// ============================================================================

test('SuccessionPlanner: Generate schedule for lettuce (minimal params)', async () => {
  const dataDir = path.join(__dirname, '..', 'public', 'data');
  const planner = new SuccessionPlanner(dataDir);
  
  const schedule = await planner.generateSchedule({
    crop: 'Butterhead Lettuce',
    weeklyDemand: 100,
    startDate: '2026-03-01',
    weeks: 4
  });
  
  assert(schedule.ok, 'Schedule should be generated successfully');
  assert(schedule.schedule.length === 4, `Expected 4 weeks, got ${schedule.schedule.length}`);
  assert(schedule.crop === 'Butterhead Lettuce', 'Crop should match');
  assert(schedule.weeklyDemand === 100, 'Weekly demand should match');
  
  // Check first week calculation
  const week1 = schedule.schedule[0];
  assert(week1.crop === 'Butterhead Lettuce', 'Week 1 crop should match');
  assert(week1.plantsPerTray === 128, 'Expected 128 plants/tray');
  assert(week1.traysNeeded === 1, 'Expected 1 tray for 100 heads (128 plants/tray)');
  assert(week1.growthDays === 32, 'Expected 32 days growth period');
  
  // Verify backward scheduling
  const harvestDate = new Date(week1.harvestDate);
  const seedDate = new Date(week1.seedDate);
  const daysDiff = Math.round((harvestDate - seedDate) / (1000 * 60 * 60 * 24));
  assert(daysDiff === 32, `Expected 32 days between seed and harvest, got ${daysDiff}`);
});

test('SuccessionPlanner: Generate schedule for baby greens (high density)', async () => {
  const dataDir = path.join(__dirname, '..', 'public', 'data');
  const planner = new SuccessionPlanner(dataDir);
  
  const schedule = await planner.generateSchedule({
    crop: 'Baby Arugula',
    weeklyDemand: 150,
    startDate: '2026-03-01',
    weeks: 4
  });
  
  assert(schedule.ok, 'Schedule should be generated successfully');
  assert(schedule.schedule.length === 4, 'Expected 4 weeks');
  
  const week1 = schedule.schedule[0];
  assert(week1.plantsPerTray === 200, 'Baby Arugula should use 200 plants/tray (high density)');
  assert(week1.traysNeeded === 1, 'Expected 1 tray for 150 heads (200 plants/tray)');
  assert(week1.growthDays === 21, 'Expected 21 days growth period');
});

test('SuccessionPlanner: Generate schedule for tomatoes (low density)', async () => {
  const dataDir = path.join(__dirname, '..', 'public', 'data');
  const planner = new SuccessionPlanner(dataDir);
  
  const schedule = await planner.generateSchedule({
    crop: 'Tomato',
    weeklyDemand: 20,
    startDate: '2026-03-01',
    weeks: 4
  });
  
  assert(schedule.ok, 'Schedule should be generated successfully');
  assert(schedule.schedule.length === 4, 'Expected 4 weeks');
  
  const week1 = schedule.schedule[0];
  assert(week1.plantsPerTray === 8, 'Tomato should use 8 plants/tray (low density)');
  assert(week1.traysNeeded === 3, 'Expected 3 trays for 20 plants (8 plants/tray)');
});

test('SuccessionPlanner: Generate schedule with facility capacity', async () => {
  const dataDir = path.join(__dirname, '..', 'public', 'data');
  const planner = new SuccessionPlanner(dataDir);
  
  const schedule = await planner.generateSchedule({
    crop: 'Butterhead Lettuce',
    weeklyDemand: 100,
    startDate: '2026-03-01',
    weeks: 12,
    facility: {
      totalTrays: 100,
      currentlyUsed: 50,
      zoneCapacity: {
        germination: 20,
        grow: 80
      }
    }
  });
  
  assert(schedule.ok, 'Schedule should be generated successfully');
  assert(schedule.facilityStats, 'Facility stats should be included');
  assert(schedule.facilityStats.totalCapacity === 100, 'Total capacity should match');
  assert(schedule.facilityStats.currentlyUsed === 50, 'Current usage should match');
  assert(schedule.facilityStats.utilizationPct <= 100, 'Utilization should be <= 100%');
});

test('SuccessionPlanner: Detect capacity bottlenecks', async () => {
  const dataDir = path.join(__dirname, '..', 'public', 'data');
  const planner = new SuccessionPlanner(dataDir);
  
  // Schedule that will exceed capacity
  const schedule = await planner.generateSchedule({
    crop: 'Butterhead Lettuce',
    weeklyDemand: 500,
    startDate: '2026-03-01',
    weeks: 12,
    facility: {
      totalTrays: 20,
      currentlyUsed: 10
    }
  });
  
  assert(schedule.ok, 'Schedule should still be generated');
  assert(schedule.gaps.length > 0, 'Should detect gaps when demand exceeds capacity');
  assert(schedule.facilityStats.bottlenecks.length > 0, 'Should identify bottlenecks');
});

test('SuccessionPlanner: Continuous harvest optimization', async () => {
  const dataDir = path.join(__dirname, '..', 'public', 'data');
  const planner = new SuccessionPlanner(dataDir);
  
  const schedule = await planner.generateSchedule({
    crop: 'Butterhead Lettuce',
    weeklyDemand: 100,
    startDate: '2026-03-01',
    weeks: 8
  });
  
  assert(schedule.ok, 'Schedule should be generated successfully');
  assert(schedule.continuousHarvestPlan, 'Should include continuous harvest optimization');
  assert(schedule.continuousHarvestPlan.harvestFrequency, 'Should specify harvest frequency');
  assert(schedule.continuousHarvestPlan.consistency, 'Should provide consistency rating');
});

// ============================================================================
// DEMAND FORECASTING INTEGRATION
// ============================================================================

test('SuccessionPlanner: Generate suggestions from demand forecast', async () => {
  const dataDir = path.join(__dirname, '..', 'public', 'data');
  const planner = new SuccessionPlanner(dataDir);
  
  const suggestions = await planner.suggestFromDemand({
    farmId: 'TEST-FARM-001',
    demandForecast: [
      {
        crop: 'Butterhead Lettuce',
        quantity: 100,
        targetDate: '2026-03-01',
        duration: 8,
        priority: 'high'
      },
      {
        crop: 'Baby Arugula',
        quantity: 150,
        targetDate: '2026-03-05',
        duration: 8,
        priority: 'medium'
      }
    ],
    facility: {
      totalTrays: 100,
      currentlyUsed: 40
    }
  });
  
  assert(suggestions.ok, 'Suggestions should be generated successfully');
  assert(suggestions.suggestions.length === 2, 'Expected 2 crop suggestions');
  assert(suggestions.totalCrops === 2, 'Total crops should match');
  
  const lettuce = suggestions.suggestions[0];
  assert(lettuce.crop === 'Butterhead Lettuce', 'First suggestion should be lettuce');
  assert(lettuce.schedule.length === 8, 'Expected 8 weeks for lettuce');
  
  const arugula = suggestions.suggestions[1];
  assert(arugula.crop === 'Baby Arugula', 'Second suggestion should be arugula');
  assert(arugula.schedule.length === 8, 'Expected 8 weeks for arugula');
});

// ============================================================================
// SERVER INTEGRATION
// ============================================================================

test('Server: POST /api/planting/schedule/generate endpoint exists', async () => {
  // Check that server-foxtrot.js imports succession-planner
  const serverPath = path.join(__dirname, '..', 'server-foxtrot.js');
  const content = fs.readFileSync(serverPath, 'utf-8');
  
  assert(content.includes("import SuccessionPlanner from './lib/succession-planner.js'"), 
    'Server should import SuccessionPlanner');
  assert(content.includes('const successionPlanner = new SuccessionPlanner(DATA_DIR)'),
    'Server should initialize succession planner');
  assert(content.includes("app.post('/api/planting/schedule/generate'"),
    'Server should define POST /api/planting/schedule/generate endpoint');
});

test('Server: POST /api/planting/suggest-from-demand endpoint exists', async () => {
  const serverPath = path.join(__dirname, '..', 'server-foxtrot.js');
  const content = fs.readFileSync(serverPath, 'utf-8');
  
  assert(content.includes("app.post('/api/planting/suggest-from-demand'"),
    'Server should define POST /api/planting/suggest-from-demand endpoint');
});

test('Server: POST /api/planting/ai-recommendations endpoint exists', async () => {
  const serverPath = path.join(__dirname, '..', 'server-foxtrot.js');
  const content = fs.readFileSync(serverPath, 'utf-8');
  
  assert(content.includes("app.post('/api/planting/ai-recommendations'"),
    'Server should define POST /api/planting/ai-recommendations endpoint');
  assert(content.includes('CENTRAL_API_KEY'),
    'Endpoint should verify API key for Central authentication');
});

test('Server: GET /api/planting/tray-formats endpoint exists', async () => {
  const serverPath = path.join(__dirname, '..', 'server-foxtrot.js');
  const content = fs.readFileSync(serverPath, 'utf-8');
  
  assert(content.includes("app.get('/api/planting/tray-formats'"),
    'Server should define GET /api/planting/tray-formats endpoint');
});

// ============================================================================
// CACHING
// ============================================================================

test('SuccessionPlanner: Cache works for repeated calls', async () => {
  const dataDir = path.join(__dirname, '..', 'public', 'data');
  const planner = new SuccessionPlanner(dataDir);
  
  const params = {
    crop: 'Butterhead Lettuce',
    weeklyDemand: 100,
    startDate: '2026-03-01',
    weeks: 4
  };
  
  // First call
  const result1 = await planner.generateSchedule(params);
  assert(!result1.cached, 'First call should not be cached');
  
  // Second call (should be cached)
  const result2 = await planner.generateSchedule(params);
  assert(result2.cached, 'Second call should be cached');
  assert(result2.cachedAt, 'Should have cache timestamp');
  
  // Clear cache
  planner.clearCache();
  
  // Third call (cache cleared)
  const result3 = await planner.generateSchedule(params);
  assert(!result3.cached, 'Call after cache clear should not be cached');
  
  // Verify cache stats
  const stats = planner.getCacheStats();
  assert(stats.entries === 1, `Expected 1 cache entry, got ${stats.entries}`);
  assert(stats.ttlMs === 300000, 'Cache TTL should be 5 minutes (300000ms)');
});

// ============================================================================
// PROGRESSIVE ENHANCEMENT
// ============================================================================

test('SuccessionPlanner: Works with minimal data (crop + demand + date)', async () => {
  const dataDir = path.join(__dirname, '..', 'public', 'data');
  const planner = new SuccessionPlanner(dataDir);
  
  // Minimal parameters (no facility, no weeks specified)
  const schedule = await planner.generateSchedule({
    crop: 'Basil',
    weeklyDemand: 50,
    startDate: '2026-03-01'
    // No facility, no weeks (should default to 12)
  });
  
  assert(schedule.ok, 'Should work with minimal parameters');
  assert(schedule.schedule.length === 12, 'Should default to 12 weeks');
  assert(schedule.facilityStats.totalCapacity === 999, 'Should use unlimited capacity when not specified');
});

test('SuccessionPlanner: Enhances with facility data', async () => {
  const dataDir = path.join(__dirname, '..', 'public', 'data');
  const planner = new SuccessionPlanner(dataDir);
  
  // With facility constraints
  const schedule = await planner.generateSchedule({
    crop: 'Basil',
    weeklyDemand: 50,
    startDate: '2026-03-01',
    weeks: 8,
    facility: {
      totalTrays: 50,
      currentlyUsed: 20
    }
  });
  
  assert(schedule.ok, 'Should work with facility data');
  assert(schedule.facilityStats.totalCapacity === 50, 'Should use specified capacity');
  assert(schedule.facilityStats.utilizationPct >= 0, 'Should calculate utilization');
});

// ============================================================================
// RUN ALL TESTS
// ============================================================================

(async function runTests() {
  console.log('\n=== Succession Planting Automation (P4) - Validation ===\n');
  
  for (const { name, fn } of tests) {
    results.total++;
    try {
      await fn();
      results.passed++;
      console.log(`✅ ${name}`);
    } catch (error) {
      results.failed++;
      console.error(`❌ ${name}`);
      console.error(`   ${error.message}`);
    }
  }
  
  console.log('\n=== Results ===');
  console.log(`Total:  ${results.total}`);
  console.log(`Passed: ${results.passed}`);
  console.log(`Failed: ${results.failed}`);
  console.log(`Success Rate: ${Math.round((results.passed / results.total) * 100)}%\n`);
  
  if (results.failed > 0) {
    process.exit(1);
  }
})();
