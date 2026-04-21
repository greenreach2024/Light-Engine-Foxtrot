/**
 * Tests for lib/grow-system-scoring.js
 *
 * Validates the Plant Transpiration (T), Heat Management (H), and
 * Environmental Benchmark (E) scoring surface. Data-driven against the
 * real public/data/grow-systems.json so changes to template shape break
 * the tests instead of silently drifting.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'fs/promises';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

import {
  clamp,
  roomVolumeM3,
  scoreTranspiration,
  scoreHeatManagement,
  scoreAirflowDeficit,
  scoreVpdRisk,
  scoreEnvBenchmark,
  scoreTemplate,
  benchmarkTier,
  SCORING_CONSTANTS
} from '../lib/grow-system-scoring.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REGISTRY_PATH = resolve(__dirname, '..', 'public', 'data', 'grow-systems.json');

const registry = JSON.parse(await readFile(REGISTRY_PATH, 'utf-8'));
const templatesById = Object.fromEntries(registry.templates.map(t => [t.id, t]));

const NFT_RACK = templatesById['nft-rack-3tier'];
const DWC_POND = templatesById['dwc-pond-4x8'];
const DRIP_RAIL = templatesById['drip-rail-fruiting-8ft'];
const MICROGREEN_RACK = templatesById['vertical-tier-5-microgreen'];

// Basic sanity: registry loads and has the fixtures we rely on.
test('registry templates load and expose expected ids', () => {
  assert.ok(NFT_RACK, 'nft-rack-3tier present');
  assert.ok(DWC_POND, 'dwc-pond-4x8 present');
  assert.ok(DRIP_RAIL, 'drip-rail-fruiting-8ft present');
  assert.ok(MICROGREEN_RACK, 'vertical-tier-5-microgreen present');
});

// ---- clamp -----------------------------------------------------------------
test('clamp snaps values into [0,100] and handles NaN', () => {
  assert.equal(clamp(50), 50);
  assert.equal(clamp(-10), 0);
  assert.equal(clamp(250), 100);
  assert.equal(clamp(Number.NaN), 0);
  assert.equal(clamp(Number.POSITIVE_INFINITY), 100);
  assert.equal(clamp(42, 10, 50), 42);
  assert.equal(clamp(5, 10, 50), 10);
});

// ---- roomVolumeM3 ----------------------------------------------------------
test('roomVolumeM3 supports both naming conventions and rejects invalid', () => {
  assert.equal(roomVolumeM3({ dimensions: { lengthM: 5, widthM: 4, ceilingHeightM: 3 } }), 60);
  assert.equal(roomVolumeM3({ dimensions: { length_m: 10, width_m: 5, ceiling_height_m: 2 } }), 100);
  assert.equal(roomVolumeM3(null), 0);
  assert.equal(roomVolumeM3({}), 0);
  assert.equal(roomVolumeM3({ dimensions: { lengthM: 0, widthM: 5, ceilingHeightM: 3 } }), 0);
  assert.equal(roomVolumeM3({ dimensions: { lengthM: -1, widthM: 5, ceilingHeightM: 3 } }), 0);
});

// ---- scoreTranspiration ----------------------------------------------------
test('scoreTranspiration grows linearly with quantity', () => {
  const one = scoreTranspiration({ template: NFT_RACK, cropClass: 'leafy_greens', quantity: 1 });
  const two = scoreTranspiration({ template: NFT_RACK, cropClass: 'leafy_greens', quantity: 2 });
  assert.ok(one.dailyWaterKg > 0);
  assert.ok(Math.abs(two.dailyWaterKg - 2 * one.dailyWaterKg) < 1e-6);
  assert.ok(two.score >= one.score);
  assert.ok(two.plantsTotal === 2 * one.plantsTotal);
});

test('scoreTranspiration ranks fruiting higher than microgreens per-unit', () => {
  // Fruiting: 120 g/plant/day typical — drives heavy moisture load fast.
  // Microgreens: 8 g/plant/day — very low moisture per plant.
  const fruiting = scoreTranspiration({ template: DRIP_RAIL, cropClass: 'fruiting', quantity: 1 });
  const micro = scoreTranspiration({ template: MICROGREEN_RACK, cropClass: 'microgreens', quantity: 1 });
  // Both include description text with g/plant/day so we sanity-check those.
  assert.ok(fruiting.gPerPlantPerDay >= micro.gPerPlantPerDay);
});

test('scoreTranspiration clamps at 100 under extreme deployments', () => {
  const huge = scoreTranspiration({ template: NFT_RACK, cropClass: 'leafy_greens', quantity: 20 });
  assert.equal(huge.score, 100);
});

test('scoreTranspiration rejects missing cropClass / bad quantity', () => {
  assert.throws(() => scoreTranspiration({ template: NFT_RACK, cropClass: '', quantity: 1 }), /cropClass/);
  assert.throws(() => scoreTranspiration({ template: NFT_RACK, cropClass: 'leafy_greens', quantity: 0 }), /quantity/);
  assert.throws(() => scoreTranspiration({ template: NFT_RACK, cropClass: 'leafy_greens', quantity: -3 }), /quantity/);
});

// ---- scoreHeatManagement --------------------------------------------------
test('scoreHeatManagement falls back to template footprint when no room provided', () => {
  const h = scoreHeatManagement({ template: NFT_RACK, cropClass: 'leafy_greens', quantity: 1 });
  assert.equal(h.volumeSource, 'template');
  assert.ok(h.wPerM3 > 0);
  assert.ok(h.totalHeatW > 0);
  assert.ok(h.score > 0 && h.score <= 100);
});

test('scoreHeatManagement uses room volume when provided and it dilutes the score', () => {
  const noRoom = scoreHeatManagement({ template: NFT_RACK, cropClass: 'leafy_greens', quantity: 1 });
  const bigRoom = scoreHeatManagement({
    template: NFT_RACK,
    cropClass: 'leafy_greens',
    quantity: 1,
    room: { dimensions: { lengthM: 10, widthM: 10, ceilingHeightM: 3 } } // 300 m3
  });
  assert.equal(bigRoom.volumeSource, 'room');
  assert.ok(bigRoom.wPerM3 < noRoom.wPerM3, 'bigger room must have lower W/m3');
  assert.ok(bigRoom.score < noRoom.score);
});

test('scoreHeatManagement in a cramped room pushes W/m3 up', () => {
  const small = scoreHeatManagement({
    template: NFT_RACK,
    cropClass: 'leafy_greens',
    quantity: 4,
    room: { dimensions: { lengthM: 3, widthM: 3, ceilingHeightM: 2.4 } } // ~21.6 m3
  });
  assert.ok(small.wPerM3 > 200, `expected >200 W/m3 in cramped deployment, got ${small.wPerM3}`);
  assert.ok(small.score >= 60);
});

test('scoreHeatManagement handles invalid template footprint gracefully', () => {
  const tmpl = { ...NFT_RACK, footprintM: { length: 0, width: 0 }, heightM: 0 };
  const h = scoreHeatManagement({ template: tmpl, cropClass: 'leafy_greens', quantity: 1 });
  assert.equal(h.volumeSource, 'unknown');
  assert.equal(h.score, 50);
  assert.equal(h.wPerM3, null);
});

// ---- scoreAirflowDeficit ---------------------------------------------------
test('scoreAirflowDeficit returns neutral when volume is unknown', () => {
  const a = scoreAirflowDeficit({});
  assert.equal(a.score, 50);
  assert.equal(a.volumeSource, 'unknown');
});

test('scoreAirflowDeficit returns neutral when supplyCFM is missing', () => {
  const a = scoreAirflowDeficit({ dimensions: { lengthM: 5, widthM: 4, ceilingHeightM: 3 } });
  assert.equal(a.score, 50);
  assert.ok(a.requiredCFM > 0);
  assert.equal(a.supplyCFM, null);
});

test('scoreAirflowDeficit is 0 when supply exceeds required', () => {
  const a = scoreAirflowDeficit({
    dimensions: { lengthM: 5, widthM: 4, ceilingHeightM: 3 }, // 60 m3, typical envelope -> ~1060 CFM
    supplyCFM: 5000
  });
  assert.equal(a.score, 0);
});

test('scoreAirflowDeficit reports deficit when supply under-sized', () => {
  const a = scoreAirflowDeficit({
    dimensions: { lengthM: 10, widthM: 10, ceilingHeightM: 4 }, // 400 m3 -> ~7060 CFM required
    supplyCFM: 1000
  });
  assert.ok(a.score > 70, `expected severe deficit score, got ${a.score}`);
});

// ---- scoreVpdRisk ----------------------------------------------------------
test('scoreVpdRisk returns neutral without a recipe', () => {
  assert.equal(scoreVpdRisk({}).score, 20);
  assert.equal(scoreVpdRisk({ recipe: {} }).score, 20);
});

test('scoreVpdRisk rises with tight humidity and high VPD targets', () => {
  const lax = scoreVpdRisk({ recipe: { max_humidity: 85, vpd: 0.8 }, transpirationScore: 30 });
  const tight = scoreVpdRisk({ recipe: { max_humidity: 50, vpd: 1.4 }, transpirationScore: 80 });
  assert.ok(tight.score > lax.score, `expected tight > lax, got ${tight.score} vs ${lax.score}`);
});

// ---- scoreEnvBenchmark -----------------------------------------------------
test('scoreEnvBenchmark combines all four components with published weights', () => {
  const e = scoreEnvBenchmark({
    template: NFT_RACK,
    cropClass: 'leafy_greens',
    quantity: 1,
    room: { dimensions: { lengthM: 5, widthM: 4, ceilingHeightM: 3 }, supplyCFM: 1500 },
    recipe: { max_humidity: 70, vpd: 1.0 }
  });
  assert.ok(e.score >= 0 && e.score <= 100);
  const sumWeights = Object.values(e.weights).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sumWeights - 1) < 1e-9, 'weights sum to 1');
  assert.ok('transpiration' in e.breakdown);
  assert.ok('heatManagement' in e.breakdown);
  assert.ok('airflowDeficit' in e.breakdown);
  assert.ok('vpdRisk' in e.breakdown);
});

test('scoreEnvBenchmark drops when room is cramped and fans are undersized', () => {
  const good = scoreEnvBenchmark({
    template: NFT_RACK,
    cropClass: 'leafy_greens',
    quantity: 1,
    room: { dimensions: { lengthM: 8, widthM: 6, ceilingHeightM: 3 }, supplyCFM: 6000 }
  });
  const bad = scoreEnvBenchmark({
    template: NFT_RACK,
    cropClass: 'leafy_greens',
    quantity: 4,
    room: { dimensions: { lengthM: 3, widthM: 3, ceilingHeightM: 2.4 }, supplyCFM: 400 }
  });
  assert.ok(good.score > bad.score, `expected good > bad, got ${good.score} vs ${bad.score}`);
});

// ---- scoreTemplate + benchmarkTier ----------------------------------------
test('scoreTemplate returns all three scores and a tier label', () => {
  const s = scoreTemplate({
    template: NFT_RACK,
    cropClass: 'leafy_greens',
    quantity: 1,
    room: { dimensions: { lengthM: 5, widthM: 4, ceilingHeightM: 3 }, supplyCFM: 1500 }
  });
  assert.equal(s.templateId, 'nft-rack-3tier');
  assert.equal(s.cropClass, 'leafy_greens');
  assert.equal(s.quantity, 1);
  assert.ok(['benchmark', 'favorable', 'manageable', 'demanding', 'stressed'].includes(s.tier));
  assert.ok(typeof s.transpiration.score === 'number');
  assert.ok(typeof s.heatManagement.score === 'number');
  assert.ok(typeof s.envBenchmark.score === 'number');
});

test('benchmarkTier buckets correctly around the published thresholds', () => {
  assert.equal(benchmarkTier(95), 'benchmark');
  assert.equal(benchmarkTier(80), 'benchmark');
  assert.equal(benchmarkTier(79.9), 'favorable');
  assert.equal(benchmarkTier(60), 'favorable');
  assert.equal(benchmarkTier(59), 'manageable');
  assert.equal(benchmarkTier(39), 'demanding');
  assert.equal(benchmarkTier(10), 'stressed');
});

// ---- SCORING_CONSTANTS -----------------------------------------------------
test('SCORING_CONSTANTS exposes tunable thresholds and benchmark weights', () => {
  assert.equal(SCORING_CONSTANTS.T_REF_KG_PER_DAY, 30);
  assert.equal(SCORING_CONSTANTS.H_REF_W_PER_M3, 250);
  assert.ok(SCORING_CONSTANTS.LIGHTING_HEAT_FRACTION > 0.5);
  assert.ok(SCORING_CONSTANTS.LIGHTING_HEAT_FRACTION <= 1);
  assert.ok(SCORING_CONSTANTS.E_WEIGHTS.transpirationStress > 0);
  assert.ok(SCORING_CONSTANTS.E_WEIGHTS.heatStress > 0);
});
