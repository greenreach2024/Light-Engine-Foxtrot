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

test('taxonomy has exactly 14 events after adding agent_decision', () => {
  const taxPath = path.resolve('./data/event-taxonomy.json');
  const taxonomy = JSON.parse(fs.readFileSync(taxPath, 'utf-8'));
  assert.equal(Object.keys(taxonomy.events).length, 14);
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

// ── PPFD/DLI Heatmap + Device Overlay (#17) ──────────────────────────
test('3D viewer has PPFD and DLI overlay buttons', () => {
  const html = fs.readFileSync(path.resolve('./greenreach-central/public/views/3d-farm-viewer.html'), 'utf-8');
  assert.ok(html.includes('data-overlay="ppfd"'), 'should have PPFD overlay button');
  assert.ok(html.includes('data-overlay="dli"'), 'should have DLI overlay button');
});

test('OVERLAY_CFG includes ppfd and dli', () => {
  const html = fs.readFileSync(path.resolve('./greenreach-central/public/views/3d-farm-viewer.html'), 'utf-8');
  assert.ok(html.includes("ppfd:"), 'should have ppfd in OVERLAY_CFG');
  assert.ok(html.includes("dli:"), 'should have dli in OVERLAY_CFG');
  assert.ok(html.includes("umol"), 'should have PPFD unit');
  assert.ok(html.includes("mol/m2/d"), 'should have DLI unit');
});

test('getZoneMetricValueAtFrame handles ppfd and dli', () => {
  const html = fs.readFileSync(path.resolve('./greenreach-central/public/views/3d-farm-viewer.html'), 'utf-8');
  assert.ok(html.includes("metricKey === 'ppfd'"), 'should handle ppfd metric');
  assert.ok(html.includes("metricKey === 'dli'"), 'should handle dli metric');
  assert.ok(html.includes('g.targetPpfd'), 'should read group targetPpfd');
});

// ── Agent Write Actions + Inter-Agent Handoff (#18) ──────────────────
test('assistant-chat has get_active_light_schedules tool', () => {
  const chatText = fs.readFileSync(path.resolve('./greenreach-central/routes/assistant-chat.js'), 'utf-8');
  assert.ok(chatText.includes("name: 'get_active_light_schedules'"), 'should define get_active_light_schedules tool');
  assert.ok(chatText.includes("case 'get_active_light_schedules':"), 'should have execution handler');
});

test('assistant-chat has handoff_to_agent tool', () => {
  const chatText = fs.readFileSync(path.resolve('./greenreach-central/routes/assistant-chat.js'), 'utf-8');
  assert.ok(chatText.includes("name: 'handoff_to_agent'"), 'should define handoff_to_agent tool');
  assert.ok(chatText.includes("case 'handoff_to_agent':"), 'should have execution handler');
  assert.ok(chatText.includes("target_agent"), 'should accept target_agent parameter');
  assert.ok(chatText.includes("from: 'evie'"), 'should set handoff source as evie');
});

test('handoff_to_agent routes to existing agent channels', () => {
  const chatText = fs.readFileSync(path.resolve('./greenreach-central/routes/assistant-chat.js'), 'utf-8');
  assert.ok(chatText.includes("target_agent === 'faye'"), 'should route faye handoffs to escalate_to_faye');
  assert.ok(chatText.includes("target_agent === 'gwen'"), 'should route gwen handoffs to ask_gwen');
  assert.ok(chatText.includes('agent_handoffs'), 'should queue unknown agents for async processing');
});

test('scheduling read tools are auto-tier', () => {
  const chatText = fs.readFileSync(path.resolve('./greenreach-central/routes/assistant-chat.js'), 'utf-8');
  assert.ok(chatText.includes("'get_active_light_schedules'"), 'get_active_light_schedules in auto tier');
  assert.ok(chatText.includes("'handoff_to_agent'"), 'handoff_to_agent in auto tier');
  // set_light_schedule should remain in confirm tier (write protection)
  assert.ok(chatText.includes("'set_light_schedule'"), 'set_light_schedule should still be confirm tier');
});

// ── Phase 4 #19: Offline seed queue parity ────────────────────────────
test('offline seed queue: syncPendingActions handles seed type', () => {
  const html = fs.readFileSync(path.resolve('./greenreach-central/public/views/tray-inventory.html'), 'utf-8');
  assert.ok(html.includes("case 'seed':"), 'seed case exists in syncPendingActions switch');
  assert.ok(html.includes("/api/trays/${action.data.trayId}/seed"), 'seed sync posts to correct API endpoint');
});

test('offline seed queue: submitSeed checks isOnline before fetch', () => {
  const html = fs.readFileSync(path.resolve('./greenreach-central/public/views/tray-inventory.html'), 'utf-8');
  // Find the submitSeed function and verify it checks isOnline
  const submitSeedSection = html.slice(html.indexOf('async function submitSeed('));
  assert.ok(submitSeedSection.includes("if (!isOnline)"), 'submitSeed checks offline status before fetch');
  assert.ok(submitSeedSection.includes("queueOfflineAction('seed'"), 'submitSeed queues offline action for seeds');
});

test('offline seed queue: network error fallback queues seed offline', () => {
  const html = fs.readFileSync(path.resolve('./greenreach-central/public/views/tray-inventory.html'), 'utf-8');
  const submitSeedSection = html.slice(html.indexOf('async function submitSeed('));
  const catchSection = submitSeedSection.slice(submitSeedSection.indexOf('} catch (err)'));
  assert.ok(catchSection.includes("queueOfflineAction('seed'"), 'catch block queues seed action on network error');
  assert.ok(catchSection.includes('Saved Offline'), 'catch block shows Saved Offline UI');
});

// ── Phase 4 #20: Demand refresh idempotency ────────────────────────────
test('inventory endpoints have TTL cache and in-flight dedup', () => {
  const sf = fs.readFileSync(path.resolve('./server-foxtrot.js'), 'utf-8');
  assert.ok(sf.includes('_inventoryCache'), 'inventory cache object exists');
  assert.ok(sf.includes('TTL: 30_000'), '30-second TTL configured');
  assert.ok(sf.includes('_inventoryCache.current.inFlight'), 'current inventory has in-flight dedup');
  assert.ok(sf.includes("req.query.refresh === 'true'"), 'force refresh bypass supported');
});

test('inventory forecast endpoint has TTL cache', () => {
  const sf = fs.readFileSync(path.resolve('./server-foxtrot.js'), 'utf-8');
  assert.ok(sf.includes('_inventoryCache.forecast.data'), 'forecast cache exists');
  assert.ok(sf.includes('_inventoryCache.forecast.at'), 'forecast cache timestamp tracked');
});

test('getCropHarvestDays tries crop registry before 45d default', () => {
  const sf = fs.readFileSync(path.resolve('./server-foxtrot.js'), 'utf-8');
  const fn = sf.slice(sf.indexOf('function getCropHarvestDays('));
  assert.ok(fn.includes('cropUtils.getCropGrowDays(cropName)'), 'tries crop registry before default');
  // Verify there are multiple fallback-to-registry attempts
  const registryAttempts = (fn.match(/getCropGrowDays/g) || []).length;
  assert.ok(registryAttempts >= 3, `should try registry in multiple fallback paths (found ${registryAttempts})`);
});

test('recipe-modifiers/compute has in-flight dedup', () => {
  const sf = fs.readFileSync(path.resolve('./server-foxtrot.js'), 'utf-8');
  assert.ok(sf.includes('_recipeModifierComputeInFlight'), 'recipe modifier compute has in-flight guard');
});

test('reportHarvestSchedule has in-flight dedup', () => {
  const sf = fs.readFileSync(path.resolve('./server-foxtrot.js'), 'utf-8');
  assert.ok(sf.includes('_harvestReportInFlight'), 'harvest report has in-flight guard');
  assert.ok(sf.includes('_doReportHarvestSchedule'), 'inner function extracted for dedup wrapper');
});

// ── Phase 4 #21: Scheduler decision ledger ────────────────────────────
test('decision ledger module exists with NDJSON append-only pattern', () => {
  const ledger = fs.readFileSync(path.resolve('./lib/decision-ledger.js'), 'utf-8');
  assert.ok(ledger.includes('appendFileSync'), 'uses appendFileSync for append-only writes');
  assert.ok(ledger.includes('.ndjson'), 'uses .ndjson file extension');
  assert.ok(ledger.includes('agent-decisions'), 'stores in agent-decisions directory');
  assert.ok(ledger.includes('function record('), 'has record function');
  assert.ok(ledger.includes('function recordOutcome('), 'has recordOutcome function');
  assert.ok(ledger.includes('function read('), 'has read function');
});

test('decision ledger API endpoints are wired in server-foxtrot', () => {
  const sf = fs.readFileSync(path.resolve('./server-foxtrot.js'), 'utf-8');
  assert.ok(sf.includes("app.get('/api/agent-decisions/:agent'"), 'GET decisions by agent');
  assert.ok(sf.includes("app.get('/api/agent-decisions/:agent/dates'"), 'GET available dates');
  assert.ok(sf.includes("app.post('/api/agent-decisions'"), 'POST new decision');
  assert.ok(sf.includes("app.post('/api/agent-decisions/:agent/outcome'"), 'POST outcome update');
});

test('event taxonomy includes agent_decision event type', () => {
  const taxonomy = JSON.parse(fs.readFileSync(path.resolve('./data/event-taxonomy.json'), 'utf-8'));
  assert.ok(taxonomy.events.agent_decision, 'agent_decision event type exists');
  assert.strictEqual(taxonomy.events.agent_decision.category, 'ai');
  assert.ok(taxonomy.events.agent_decision.payload.agent, 'payload includes agent field');
  assert.ok(taxonomy.events.agent_decision.payload.chosen, 'payload includes chosen field');
});

// ---- Phase 4 #22: Controller bindings + auto-assign ----

test('controller-bindings route module exists and exports router', () => {
  const src = fs.readFileSync(path.resolve('./routes/controller-bindings.js'), 'utf-8');
  assert.ok(src.includes("import { Router }") || src.includes("Router()"), 'uses express Router');
  assert.ok(src.includes("router.get('/'"), 'GET / list endpoint');
  assert.ok(src.includes("router.post('/'"), 'POST / create endpoint');
  assert.ok(src.includes("router.delete('/:id'"), 'DELETE /:id endpoint');
  assert.ok(src.includes("router.post('/auto-suggest'"), 'POST /auto-suggest endpoint');
  assert.ok(src.includes("router.post('/accept-suggestion'"), 'POST /accept-suggestion endpoint');
});

test('controller-bindings schema file has valid structure', () => {
  const bindings = JSON.parse(fs.readFileSync(path.resolve('./public/data/controller-bindings.json'), 'utf-8'));
  assert.strictEqual(bindings['$schema'], 'controller-bindings-v1');
  assert.ok(Array.isArray(bindings.bindings), 'bindings is an array');
});

test('controller-bindings router is mounted in server-foxtrot', () => {
  const sf = fs.readFileSync(path.resolve('./server-foxtrot.js'), 'utf-8');
  assert.ok(sf.includes("import controllerBindingsRouter"), 'imports controller bindings router');
  assert.ok(sf.includes("/api/controller-bindings"), 'mounts at /api/controller-bindings');
});

// ---- Phase 4 #23: Stock equipment catalog ----

test('stock-equipment.catalog.json has valid structure and entries', () => {
  const catalog = JSON.parse(fs.readFileSync(path.resolve('./public/data/stock-equipment.catalog.json'), 'utf-8'));
  assert.strictEqual(catalog['$schema'], 'stock-equipment-catalog-v1');
  assert.ok(Array.isArray(catalog.lights), 'has lights array');
  assert.ok(Array.isArray(catalog.fans), 'has fans array');
  assert.ok(Array.isArray(catalog.dehumidifiers), 'has dehumidifiers array');
  assert.ok(Array.isArray(catalog.hvac), 'has hvac array');
  assert.ok(catalog.manufacturers && typeof catalog.manufacturers === 'object', 'has manufacturers object');
  assert.ok(catalog.lights.length >= 5, 'at least 5 lights from hardcoded + catalog');
  assert.ok(Object.keys(catalog.manufacturers).length >= 5, 'at least 5 manufacturers');
  // Validate each light has required fields
  catalog.lights.forEach(l => {
    assert.ok(l.id, `light missing id: ${JSON.stringify(l)}`);
    assert.ok(l.manufacturer, `light ${l.id} missing manufacturer`);
    assert.ok(typeof l.wattage === 'number', `light ${l.id} missing wattage`);
  });
});

test('stock catalog exists in both public directories', () => {
  const le = fs.existsSync(path.resolve('./public/data/stock-equipment.catalog.json'));
  const central = fs.existsSync(path.resolve('./greenreach-central/public/data/stock-equipment.catalog.json'));
  assert.ok(le, 'catalog in root public/data/');
  assert.ok(central, 'catalog in greenreach-central/public/data/');
});

test('groups-v2.js loads stock equipment catalog', () => {
  const gv2 = fs.readFileSync(path.resolve('./public/groups-v2.js'), 'utf-8');
  assert.ok(gv2.includes('stock-equipment.catalog.json'), 'references catalog file');
  assert.ok(gv2.includes('window.STATE.equipmentCatalog'), 'stores on STATE.equipmentCatalog');
});

// ---- Phase 4 #24: 3D viewer mobile + accessibility ----

test('3D viewer has keyboard navigation and accessibility', () => {
  const html = fs.readFileSync(path.resolve('./greenreach-central/public/views/3d-farm-viewer.html'), 'utf-8');
  // Canvas accessibility
  assert.ok(html.includes('role="img"'), 'canvas has role attribute');
  assert.ok(html.includes('tabindex="0"'), 'canvas is focusable');
  assert.ok(html.includes('aria-label='), 'canvas has aria-label');
  // Screen reader announcements
  assert.ok(html.includes('a11yAnnouncer'), 'has aria-live announcer region');
  assert.ok(html.includes('aria-live="polite"'), 'announcer uses polite mode');
  // Keyboard nav
  assert.ok(html.includes("e.key === 'ArrowLeft'"), 'arrow key orbit left');
  assert.ok(html.includes("e.key === 'ArrowRight'"), 'arrow key orbit right');
  assert.ok(html.includes("e.key === 'Tab'"), 'Tab cycles zones');
  assert.ok(html.includes("e.key === 'Enter'"), 'Enter opens detail panel');
  assert.ok(html.includes("e.key === '+'"), 'plus key zooms in');
  assert.ok(html.includes("e.key === '-'"), 'minus key zooms out');
});

test('3D viewer has mobile touch multi-touch guard', () => {
  const html = fs.readFileSync(path.resolve('./greenreach-central/public/views/3d-farm-viewer.html'), 'utf-8');
  assert.ok(html.includes('_touchCount'), 'tracks touch count');
  assert.ok(html.includes('_touchCount > 1'), 'guards drag on multi-touch');
  assert.ok(html.includes("{ passive: true }"), 'touch listeners are passive');
});

test('3D viewer toolbar buttons have aria-labels', () => {
  const html = fs.readFileSync(path.resolve('./greenreach-central/public/views/3d-farm-viewer.html'), 'utf-8');
  assert.ok(html.includes('id="detailClose" aria-label="Close detail panel"'), 'close button has aria-label');
});

// ---- Phase 4 #25: ML pipeline reactivation ----

test('JS anomaly detector module exists with Z-score detection', () => {
  const src = fs.readFileSync(path.resolve('./lib/ml-anomaly-js.js'), 'utf-8');
  assert.ok(src.includes('export function detectAnomalies'), 'exports detectAnomalies');
  assert.ok(src.includes('export async function runFullScan'), 'exports runFullScan');
  assert.ok(src.includes('Z_THRESHOLD'), 'uses Z-score threshold');
  assert.ok(src.includes('STUCK_THRESHOLD'), 'detects stuck sensors');
  assert.ok(src.includes("engine: 'js-zscore'"), 'identifies engine type');
});

test('JS forecast module exists with Holt-Winters', () => {
  const src = fs.readFileSync(path.resolve('./lib/ml-forecast-js.js'), 'utf-8');
  assert.ok(src.includes('export function holtWintersForecast'), 'exports holtWintersForecast');
  assert.ok(src.includes('export function forecastZone'), 'exports forecastZone');
  assert.ok(src.includes('confidence'), 'includes confidence intervals');
  assert.ok(src.includes("engine: 'js-holt-winters'"), 'identifies engine type');
});

test('harvest predictor includes confidence intervals', () => {
  const src = fs.readFileSync(path.resolve('./lib/harvest-predictor.js'), 'utf-8');
  assert.ok(src.includes('confidenceInterval'), 'returns confidenceInterval field');
  assert.ok(src.includes('early:'), 'has early date');
  assert.ok(src.includes('late:'), 'has late date');
  assert.ok(src.includes('stdDevDays'), 'includes standard deviation in days');
  assert.ok(src.includes('sampleSize'), 'includes sample size');
});

test('ML schedule falls back to JS anomaly engine', () => {
  const sf = fs.readFileSync(path.resolve('./server-foxtrot.js'), 'utf-8');
  assert.ok(sf.includes("import('./lib/ml-anomaly-js.js')"), 'imports JS anomaly fallback');
  assert.ok(sf.includes('Python unavailable, used JS anomaly engine'), 'logs fallback usage');
});

// ---- Phase 4 #26: Advanced transpiration model ----

test('transpiration model exports crop/stage-aware lookup', () => {
  const src = fs.readFileSync(path.resolve('./lib/transpiration-model.js'), 'utf-8');
  assert.ok(src.includes('export function getTranspirationRate'), 'exports getTranspirationRate');
  assert.ok(src.includes('export function getVPDTarget'), 'exports getVPDTarget');
  assert.ok(src.includes('export function estimateGrowthStage'), 'exports estimateGrowthStage');
  assert.ok(src.includes('export function computeTranspirationLoad'), 'exports computeTranspirationLoad');
});

test('transpiration table has per-stage rates for key crops', async () => {
  const mod = await import('../lib/transpiration-model.js');
  // Lettuce: mature should be around 30 g/plant/day
  const lettuce = mod.getTranspirationRate('lettuce', 'mature');
  assert.strictEqual(lettuce.gPerPlantPerDay, 30);
  assert.strictEqual(lettuce.source, 'crop_specific');
  // Seedling should be much lower
  const lettuceSeedling = mod.getTranspirationRate('lettuce', 'seedling');
  assert.ok(lettuceSeedling.gPerPlantPerDay < lettuce.gPerPlantPerDay, 'seedling < mature');
  // Tomato: fruiting crop should be higher
  const tomato = mod.getTranspirationRate('tomato', 'mature');
  assert.ok(tomato.gPerPlantPerDay > 100, 'tomato mature > 100g');
  // Unknown crop falls back to default
  const unknown = mod.getTranspirationRate('alien_crop', 'mature');
  assert.strictEqual(unknown.source, 'default');
});

test('growth stage estimation from days since seed', async () => {
  const mod = await import('../lib/transpiration-model.js');
  assert.strictEqual(mod.estimateGrowthStage('lettuce', 1, 35), 'germination');
  assert.strictEqual(mod.estimateGrowthStage('lettuce', 5, 35), 'seedling');
  assert.strictEqual(mod.estimateGrowthStage('lettuce', 15, 35), 'vegetative');
  assert.strictEqual(mod.estimateGrowthStage('lettuce', 30, 35), 'mature');
});

test('VPD targets vary by growth stage', async () => {
  const mod = await import('../lib/transpiration-model.js');
  const seedling = mod.getVPDTarget('seedling');
  const mature = mod.getVPDTarget('mature');
  assert.ok(seedling.optimal < mature.optimal, 'seedling VPD target < mature VPD target');
});
