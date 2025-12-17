import test from 'node:test';
import assert from 'node:assert/strict';
import { computeFixturePower, forecastDailyEnergy } from '../calculators/energy-calculator.js';

const fixture = {
  id: 'TEST_FIXTURE',
  name: 'Test Fixture',
  nominalPowerWatts: 500,
  referencePPFD: 600,
  channelPowerRatios: { cw: 0.25, ww: 0.25, bl: 0.25, rd: 0.25 }
};

test('computeFixturePower returns per-channel watt breakdown', () => {
  const recipe = { cw: 30, ww: 30, bl: 20, rd: 20 };
  const result = computeFixturePower(recipe, fixture);
  assert.equal(result.totalWatts, 500);
  const total = Object.values(result.channelWatts).reduce((sum, value) => sum + value, 0);
  assert.ok(Math.abs(total - 500) < 0.5);
});

test('forecastDailyEnergy calculates kWh and cost', () => {
  const recipe = { ppfd: 600, photoperiodHours: 12 };
  const result = forecastDailyEnergy({ recipe, fixture, photoperiodHours: 12, rateLabel: 'peak', utilityOptions: { tariffKey: 'default' } });
  assert.equal(result.photoperiodHours, 12);
  assert.equal(result.kWhPerDay, Number(((500 * 12) / 1000).toFixed(3)));
  assert.ok(result.costPerDay > 0);
});
