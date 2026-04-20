/**
 * CCA (Cut-and-Come-Again) Harvest Tests -- Unit
 *
 * Validates:
 * - lookupCCAStrategy returns correct data for CCA crops
 * - lookupCCAStrategy returns null for non-CCA crops
 * - partial_harvest event exists in taxonomy with correct schema
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const DATA_DIR = path.resolve('./public/data');

// -- lookupCCAStrategy --
test('lookupCCAStrategy returns CCA data for basil', async () => {
  const { lookupCCAStrategy } = await import('../lib/harvest-predictor.js');
  const result = lookupCCAStrategy('basil', DATA_DIR);
  assert.ok(result, 'basil should be a CCA crop');
  assert.equal(result.strategy, 'cut_and_come_again');
  assert.ok(result.maxHarvests >= 2, 'maxHarvests should be >= 2');
  assert.ok(result.regrowthDays > 0, 'regrowthDays should be positive');
  assert.ok(result.regrowthYieldFactor > 0 && result.regrowthYieldFactor <= 1, 'yield factor in (0,1]');
});

test('lookupCCAStrategy returns CCA data for lettuce', async () => {
  const { lookupCCAStrategy } = await import('../lib/harvest-predictor.js');
  const result = lookupCCAStrategy('lettuce', DATA_DIR);
  assert.ok(result, 'lettuce should be a CCA crop');
  assert.equal(result.strategy, 'cut_and_come_again');
});

test('lookupCCAStrategy returns CCA data for kale', async () => {
  const { lookupCCAStrategy } = await import('../lib/harvest-predictor.js');
  const result = lookupCCAStrategy('kale', DATA_DIR);
  assert.ok(result, 'kale should be a CCA crop');
  assert.equal(result.strategy, 'cut_and_come_again');
});

test('lookupCCAStrategy returns null for microgreens', async () => {
  const { lookupCCAStrategy } = await import('../lib/harvest-predictor.js');
  const result = lookupCCAStrategy('microgreens', DATA_DIR);
  assert.equal(result, null, 'microgreens are not CCA');
});

test('lookupCCAStrategy returns null for unknown crop', async () => {
  const { lookupCCAStrategy } = await import('../lib/harvest-predictor.js');
  const result = lookupCCAStrategy('nonexistent_crop_xyz', DATA_DIR);
  assert.equal(result, null);
});

// -- Event Taxonomy --
test('event-taxonomy.json includes partial_harvest event', () => {
  const taxPath = path.resolve('./data/event-taxonomy.json');
  const taxonomy = JSON.parse(fs.readFileSync(taxPath, 'utf-8'));
  assert.ok(taxonomy.events.partial_harvest, 'partial_harvest event should exist');
  assert.equal(taxonomy.events.partial_harvest.category, 'grow');
  const payload = taxonomy.events.partial_harvest.payload;
  assert.ok(payload.cut_number, 'payload should have cut_number');
  assert.ok(payload.remaining_cuts, 'payload should have remaining_cuts');
  assert.ok(payload.max_cuts, 'payload should have max_cuts');
  assert.ok(payload.next_expected_cut_date, 'payload should have next_expected_cut_date');
  assert.ok(payload.regrowth_days, 'payload should have regrowth_days');
  assert.ok(payload.yield_factor, 'payload should have yield_factor');
});

test('harvest event still exists in taxonomy', () => {
  const taxPath = path.resolve('./data/event-taxonomy.json');
  const taxonomy = JSON.parse(fs.readFileSync(taxPath, 'utf-8'));
  assert.ok(taxonomy.events.harvest, 'harvest event should still exist');
  assert.equal(taxonomy.events.harvest.category, 'grow');
});

test('taxonomy has exactly 13 events after adding partial_harvest', () => {
  const taxPath = path.resolve('./data/event-taxonomy.json');
  const taxonomy = JSON.parse(fs.readFileSync(taxPath, 'utf-8'));
  assert.equal(Object.keys(taxonomy.events).length, 13);
});

// ── Degraded Compromise Surfacing (#14) ──────────────────────────────
test('recipe-environmental-targets tracks dropped trays', async () => {
  // Verify the module has dropped_trays tracking in _calculateWeightedTargets
  const moduleText = fs.readFileSync(
    path.resolve('./automation/recipe-environmental-targets.js'), 'utf-8'
  );
  assert.ok(moduleText.includes('droppedTrays'), 'should have droppedTrays tracking');
  assert.ok(moduleText.includes("reason: 'recipe_not_found'"), 'should track recipe_not_found');
  assert.ok(moduleText.includes("reason: 'no_schedule_day'"), 'should track no_schedule_day');
  assert.ok(moduleText.includes('defaults.degraded = true'), 'should set degraded flag');
  assert.ok(moduleText.includes('dropped_trays:'), 'should include dropped_trays in return');
});

test('daily plan resolver tracks skipped groups', () => {
  const serverText = fs.readFileSync(path.resolve('./server-foxtrot.js'), 'utf-8');
  assert.ok(serverText.includes('skippedGroups'), 'should have skippedGroups array');
  assert.ok(serverText.includes("reason: 'no_plan_key'"), 'should track no_plan_key skip');
  assert.ok(serverText.includes("reason: 'plan_not_found'"), 'should track plan_not_found skip');
  assert.ok(serverText.includes("reason: 'no_devices'"), 'should track no_devices skip');
  assert.ok(serverText.includes('skipped_groups:'), 'should persist skipped_groups');
});

test('zone recommendations includes plan_resolver degraded info', () => {
  const routeText = fs.readFileSync(
    path.resolve('./routes/zone-recommendations.js'), 'utf-8'
  );
  assert.ok(routeText.includes('plan_resolver:'), 'should include plan_resolver in response');
  assert.ok(routeText.includes('degradedInfo'), 'should compute degradedInfo');
});

test('grow-management.html has degraded compromise banner', () => {
  const htmlText = fs.readFileSync(
    path.resolve('./greenreach-central/public/views/grow-management.html'), 'utf-8'
  );
  assert.ok(htmlText.includes('degradedBanner'), 'should have degradedBanner element');
  assert.ok(htmlText.includes('checkDegradedCompromise'), 'should have checkDegradedCompromise function');
});
