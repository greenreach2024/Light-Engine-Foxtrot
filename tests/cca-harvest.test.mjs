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

// ── Per-Group Autonomy Override + Kill Switch (#15) ──────────────────
test('agent-permissions.json has autonomy config', () => {
  const perms = JSON.parse(fs.readFileSync(path.resolve('./data/agent-permissions.json'), 'utf-8'));
  assert.strictEqual(perms._version, '1.1.0', 'version should be 1.1.0');
  assert.ok(perms.autonomy, 'should have autonomy section');
  assert.strictEqual(perms.autonomy.enabled, true, 'global enabled should default to true');
  assert.ok(perms.autonomy.scheduling, 'should have scheduling config');
  assert.strictEqual(perms.autonomy.scheduling.default, true, 'scheduling default should be true');
});

test('daily plan resolver has autonomy kill switch', () => {
  const serverText = fs.readFileSync(path.resolve('./server-foxtrot.js'), 'utf-8');
  assert.ok(serverText.includes('autonomy_killed'), 'should set autonomy_killed flag');
  assert.ok(serverText.includes('autonomyGlobal'), 'should read global autonomy flag');
  assert.ok(serverText.includes('autonomySchedulingDefault'), 'should read scheduling default');
});

test('daily plan resolver checks per-group autonomy', () => {
  const serverText = fs.readFileSync(path.resolve('./server-foxtrot.js'), 'utf-8');
  assert.ok(serverText.includes("group.autonomy?.scheduling"), 'should check group autonomy');
  assert.ok(serverText.includes("reason: 'autonomy_disabled'"), 'should track autonomy_disabled skip reason');
});

test('autonomy API endpoints exist', () => {
  const serverText = fs.readFileSync(path.resolve('./server-foxtrot.js'), 'utf-8');
  assert.ok(serverText.includes("app.get('/api/autonomy'"), 'should have GET /api/autonomy');
  assert.ok(serverText.includes("app.put('/api/autonomy'"), 'should have PUT /api/autonomy');
  assert.ok(serverText.includes("app.put('/api/autonomy/group/:groupId'"), 'should have PUT /api/autonomy/group/:groupId');
});

// ── Recipe Snapshot Pinning (#16) ────────────────────────────────────
test('seed endpoint pins recipe snapshot with hash', () => {
  const serverText = fs.readFileSync(path.resolve('./server-foxtrot.js'), 'utf-8');
  assert.ok(serverText.includes('recipe_snapshot_hash:'), 'should store recipe_snapshot_hash on tray run');
  assert.ok(serverText.includes('recipe_snapshot:'), 'should store recipe_snapshot on tray run');
  assert.ok(serverText.includes("createHash('sha256')"), 'should use SHA-256 for recipe hash');
});

test('GET /api/trays includes recipe drift detection', () => {
  const serverText = fs.readFileSync(path.resolve('./server-foxtrot.js'), 'utf-8');
  assert.ok(serverText.includes('recipeDrift'), 'should include recipeDrift in tray response');
  assert.ok(serverText.includes('recipeSnapshotHash'), 'should include recipeSnapshotHash in tray response');
  assert.ok(serverText.includes('liveRecipes'), 'should load live recipes for drift comparison');
});
