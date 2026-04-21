// tests/recipe-nutrient-targets.test.mjs -- N-tank target resolution
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  resolveTankTargets,
  DEFAULT_TANK_CONFIG,
  resolveGroupTargets,
  classifyStage,
  diffTargets
} from '../automation/recipe-nutrient-targets.js';

// A minimal enriched group stub
function stubGroup(name, { fruiting = false, days = 5, dayOffset = 0 } = {}) {
  const now = new Date();
  const planted = new Date(now.getTime() - (dayOffset + days) * 86400000);
  return {
    groupId: name,
    name,
    cropType: fruiting ? 'Tomato' : 'Lettuce',
    plan: {
      days: Array.from({ length: days }, (_, i) => ({
        day: i + 1,
        ec: fruiting ? 2.2 : 1.4,
        ph: fruiting ? 5.8 : 6.2,
        stage: fruiting ? 'earlyFlowering' : 'vegetative'
      }))
    },
    plantedAt: planted.toISOString()
  };
}

describe('resolveTankTargets', () => {
  it('returns backward-compatible tank1/tank2 shape with default config', () => {
    const groups = [stubGroup('veg1'), stubGroup('fruit1', { fruiting: true })];
    const result = resolveTankTargets(groups);
    assert.ok(result.tank1, 'tank1 should be present');
    assert.ok(result.tank2, 'tank2 should be present');
    assert.ok(result.tanks, 'tanks map should be present');
    assert.ok(result.calculatedAt);
    assert.equal(result.aggregator, 'weighted');
    assert.equal(result.tanks.tank1, result.tank1);
    assert.equal(result.tanks.tank2, result.tank2);
  });

  it('produces valid EC/pH from groups', () => {
    const groups = [stubGroup('veg1'), stubGroup('fruit1', { fruiting: true })];
    const result = resolveTankTargets(groups);
    assert.equal(typeof result.tank1.ec, 'number');
    assert.equal(typeof result.tank1.ph, 'number');
    assert.equal(typeof result.tank2.ec, 'number');
    assert.equal(typeof result.tank2.ph, 'number');
  });

  it('handles empty groups with fallback defaults', () => {
    const result = resolveTankTargets([]);
    assert.equal(result.tank1.reason, 'no-active-groups');
    assert.equal(result.tank2.reason, 'no-active-groups');
    assert.equal(typeof result.tank1.ec, 'number');
    assert.equal(typeof result.tank2.ec, 'number');
  });

  it('supports custom N-tank config with 3 tanks', () => {
    const customConfig = [
      { id: 'micro', scopeId: 'tank-micro', filter: () => true, fallbackStage: 'establishment' },
      { id: 'veg', scopeId: 'tank-veg', filter: (r) => !r.isFruiting, fallbackStage: 'vegetative' },
      { id: 'fruit', scopeId: 'tank-fruit', filter: (r) => r.isFruiting, fallbackStage: 'earlyFlowering' },
    ];
    const groups = [stubGroup('v1'), stubGroup('f1', { fruiting: true })];
    const result = resolveTankTargets(groups, { tankConfig: customConfig });
    assert.ok(result.tanks.micro, 'micro tank should exist');
    assert.ok(result.tanks.veg, 'veg tank should exist');
    assert.ok(result.tanks.fruit, 'fruit tank should exist');
    // micro gets first dibs (filter returns true for all), veg/fruit get remainder
    assert.ok(result.tanks.micro.sources.length > 0 || result.tanks.veg.sources.length > 0,
      'at least one non-fruit tank should have sources');
  });

  it('DEFAULT_TANK_CONFIG is exported and has 2 entries', () => {
    assert.ok(Array.isArray(DEFAULT_TANK_CONFIG));
    assert.equal(DEFAULT_TANK_CONFIG.length, 2);
    assert.equal(DEFAULT_TANK_CONFIG[0].id, 'tank1');
    assert.equal(DEFAULT_TANK_CONFIG[1].id, 'tank2');
    assert.equal(DEFAULT_TANK_CONFIG[0].scopeId, 'tank-1');
    assert.equal(DEFAULT_TANK_CONFIG[1].scopeId, 'tank-2');
  });
});

describe('diffTargets', () => {
  it('detects drift above tolerance', () => {
    const d = diffTargets({ ec: 1.4, ph: 6.0 }, { ec: 1.6, ph: 6.0 });
    assert.equal(d.ec.changed, true);
    assert.equal(d.ph.changed, false);
    assert.equal(d.changed, true);
  });

  it('ignores noise below tolerance', () => {
    const d = diffTargets({ ec: 1.4, ph: 6.0 }, { ec: 1.42, ph: 6.02 });
    assert.equal(d.changed, false);
  });
});
