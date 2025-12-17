import { forecastGroupEnergy, buildFixtureIndex } from '../calculators/energy-calculator.js';

/**
 * Generate a CSV-ready summary for an array of groups.
 * @param {Array} groups
 * @param {Object} options
 * @returns {Array<{groupId: string, totalKWhPerDay: number, totalCostPerDay: number}>}
 */
export function buildDailySummary(groups = [], options = {}) {
  const fixtures = options.fixturesById || buildFixtureIndex();
  const utilityOptions = options.utilityOptions || {};
  return groups.map((group) => {
    const forecast = forecastGroupEnergy(group, { fixturesById: fixtures, utilityOptions });
    return {
      groupId: forecast.groupId,
      totalKWhPerDay: forecast.totalKWhPerDay,
      totalCostPerDay: forecast.totalCostPerDay
    };
  });
}

export default {
  buildDailySummary
};
