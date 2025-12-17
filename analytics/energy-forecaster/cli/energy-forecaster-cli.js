#!/usr/bin/env node
import { forecastDailyEnergy, buildFixtureIndex } from '../calculators/energy-calculator.js';

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

function toNumber(value, fallback = undefined) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function buildRecipe(args) {
  return {
    ppfd: toNumber(args.ppfd),
    photoperiodHours: toNumber(args.photoperiod),
    cw: toNumber(args.cw),
    ww: toNumber(args.ww),
    bl: toNumber(args.bl),
    rd: toNumber(args.rd)
  };
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.fixture) {
    console.error('Usage: energy-forecaster-cli --fixture <fixtureId> [--ppfd 520] [--photoperiod 13] [--rate peak]');
    process.exit(1);
  }

  const recipe = buildRecipe(args);
  const fixtureIndex = buildFixtureIndex();
  const fixture = fixtureIndex[args.fixture] || args.fixture;

  try {
    const result = forecastDailyEnergy({
      recipe,
      fixture,
      photoperiodHours: recipe.photoperiodHours,
      rateLabel: args.rate,
      utilityOptions: { tariffKey: args.tariff || 'default', rateLabel: args.rate }
    });

    console.log(JSON.stringify({
      fixture: result.fixtureId,
      photoperiodHours: result.photoperiodHours,
      dimLevel: result.dimLevel,
      totalWatts: result.totalWatts,
      channelWatts: result.channelWatts,
      kWhPerDay: result.kWhPerDay,
      costPerDay: result.costPerDay,
      rate: result.rate
    }, null, 2));
  } catch (error) {
    console.error('Energy forecast failed:', error.message);
    process.exit(1);
  }
}

main();
