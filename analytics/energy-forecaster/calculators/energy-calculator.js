import { createRequire } from 'node:module';
import { UtilityRateAdapter } from '../adapters/utility-rate-adapter.js';

const require = createRequire(import.meta.url);
const fixturesData = require('../data/fixtures.json');

const CHANNEL_KEYS = ['cw', 'ww', 'bl', 'rd'];

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function normalizeMix(mix = {}) {
  const normalized = {};
  let sum = 0;
  for (const key of CHANNEL_KEYS) {
    const value = clamp(toNumber(mix[key]), 0, 100);
    normalized[key] = value;
    sum += value;
  }
  if (sum === 0) {
    CHANNEL_KEYS.forEach((key) => { normalized[key] = 25; });
    sum = 100;
  }
  const factor = sum === 0 ? 1 : sum / 100;
  CHANNEL_KEYS.forEach((key) => { normalized[key] = normalized[key] / factor; });
  return normalized;
}

function lookupFixture(fixtureId) {
  if (!fixtureId) return null;
  const record = fixturesData.fixtures.find((entry) => entry.id === fixtureId || entry.name === fixtureId);
  return record || null;
}

function buildFixtureProfile(fixtureIdOrObject) {
  if (!fixtureIdOrObject) return null;
  if (typeof fixtureIdOrObject === 'object') {
    return fixtureIdOrObject;
  }
  return lookupFixture(fixtureIdOrObject);
}

function computeDimLevel(recipe, fixture) {
  if (!fixture?.referencePPFD) return 1;
  const targetPPFD = toNumber(recipe?.ppfd, fixture.referencePPFD);
  if (targetPPFD <= 0) return 0;
  const ratio = targetPPFD / fixture.referencePPFD;
  return clamp(ratio, 0, 2);
}

export function computeFixturePower(recipe, fixtureInput, options = {}) {
  const fixture = buildFixtureProfile(fixtureInput);
  if (!fixture) {
    throw new Error('Fixture specification not found');
  }
  const dim = clamp(toNumber(options.dimLevel, computeDimLevel(recipe, fixture)), 0, 2);
  const mix = normalizeMix(recipe || {});
  const ratios = normalizeMix(fixture.channelPowerRatios || {});
  const baselinePower = toNumber(fixture.nominalPowerWatts, 0) * dim;
  if (baselinePower <= 0) {
    return { totalWatts: 0, channelWatts: {}, dimLevel: dim };
  }

  let ratioSum = 0;
  CHANNEL_KEYS.forEach((key) => {
    ratioSum += mix[key] * ratios[key];
  });
  if (ratioSum <= 0) {
    ratioSum = CHANNEL_KEYS.length;
  }

  const channelWatts = {};
  CHANNEL_KEYS.forEach((key) => {
    const contribution = mix[key] * ratios[key];
    const share = contribution / ratioSum;
    channelWatts[key] = Number((baselinePower * share).toFixed(2));
  });

  return {
    dimLevel: Number(dim.toFixed(3)),
    totalWatts: Number(baselinePower.toFixed(2)),
    channelWatts
  };
}

export function forecastDailyEnergy({ recipe, fixture, photoperiodHours, dimLevel, rateLabel, utilityOptions = {} }) {
  const power = computeFixturePower(recipe, fixture, { dimLevel });
  const hours = clamp(toNumber(photoperiodHours, recipe?.photoperiodHours || 12), 0, 24);
  const kWhPerDay = Number(((power.totalWatts * hours) / 1000).toFixed(3));
  const rateAdapter = new UtilityRateAdapter(utilityOptions);
  const rateInfo = rateLabel ? rateAdapter.getRateByLabel(rateLabel) : rateAdapter.getRateForDate(new Date());
  const cost = Number((kWhPerDay * rateInfo.rate).toFixed(3));

  return {
    fixtureId: typeof fixture === 'object' ? fixture.id : fixture,
    dimLevel: power.dimLevel,
    photoperiodHours: hours,
    totalWatts: power.totalWatts,
    channelWatts: power.channelWatts,
    kWhPerDay,
    rate: rateInfo,
    costPerDay: cost
  };
}

export function forecastGroupEnergy(group, { fixturesById = {}, utilityOptions = {} } = {}) {
  if (!group || !Array.isArray(group.lights)) {
    return { groupId: group?.id || null, fixtures: [], totalKWhPerDay: 0, totalCostPerDay: 0 };
  }
  const fixtures = [];
  let totalKWh = 0;
  let totalCost = 0;

  for (const light of group.lights) {
    const fixtureId = light.fixtureId || light.id || light.deviceId;
    const fixture = fixturesById[fixtureId] || lookupFixture(fixtureId);
    if (!fixture) continue;
    const recipe = group.planRecipe || light.recipe || {};
    const photoperiodHours = group.photoperiodHours || group.planConfig?.schedule?.photoperiodHours || 12;
    const result = forecastDailyEnergy({ recipe, fixture, photoperiodHours, rateLabel: utilityOptions.rateLabel, utilityOptions });
    fixtures.push({ fixtureId: fixture.id, name: fixture.name, ...result });
    totalKWh += result.kWhPerDay;
    totalCost += result.costPerDay;
  }

  return {
    groupId: group.id || group.name || null,
    fixtures,
    totalKWhPerDay: Number(totalKWh.toFixed(3)),
    totalCostPerDay: Number(totalCost.toFixed(2))
  };
}

export function buildFixtureIndex() {
  const index = {};
  for (const entry of fixturesData.fixtures) {
    if (!entry?.id) continue;
    index[entry.id] = entry;
  }
  return index;
}

export default {
  computeFixturePower,
  forecastDailyEnergy,
  forecastGroupEnergy,
  buildFixtureIndex
};
