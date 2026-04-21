/**
 * Advanced Transpiration Model
 * Phase 4 #26: Crop/stage-aware transpiration lookup
 *
 * Replaces flat defaults (0.5 L/plant/day) with crop-specific,
 * growth-stage-aware transpiration rates (g/plant/day).
 *
 * Growth stages:
 *   germination -> seedling -> vegetative -> mature -> flowering
 *
 * Sources: FAO Penman-Monteith reference tables adapted for indoor
 * controlled environment agriculture.
 */

// Transpiration rates: g of water per plant per day by crop and growth stage
const TRANSPIRATION_TABLE = {
  // Leafy greens
  lettuce:       { germination: 2, seedling: 8,  vegetative: 22, mature: 30, flowering: 25 },
  basil:         { germination: 2, seedling: 10, vegetative: 20, mature: 28, flowering: 35 },
  kale:          { germination: 3, seedling: 10, vegetative: 25, mature: 35, flowering: 30 },
  spinach:       { germination: 2, seedling: 8,  vegetative: 18, mature: 25, flowering: 20 },
  arugula:       { germination: 2, seedling: 7,  vegetative: 16, mature: 22, flowering: 18 },
  chard:         { germination: 3, seedling: 10, vegetative: 22, mature: 30, flowering: 25 },
  bok_choy:      { germination: 2, seedling: 8,  vegetative: 20, mature: 28, flowering: 22 },
  mustard_greens:{ germination: 2, seedling: 8,  vegetative: 18, mature: 25, flowering: 20 },
  collard_greens:{ germination: 3, seedling: 10, vegetative: 25, mature: 32, flowering: 28 },

  // Microgreens (short lifecycle, lower rates)
  microgreens:   { germination: 1, seedling: 4,  vegetative: 8,  mature: 8,  flowering: 0 },
  pea_shoots:    { germination: 1, seedling: 5,  vegetative: 10, mature: 10, flowering: 0 },
  sunflower_micro: { germination: 1, seedling: 5, vegetative: 10, mature: 10, flowering: 0 },
  radish_micro:  { germination: 1, seedling: 4,  vegetative: 8,  mature: 8,  flowering: 0 },

  // Herbs
  cilantro:      { germination: 2, seedling: 8,  vegetative: 18, mature: 25, flowering: 20 },
  parsley:       { germination: 2, seedling: 8,  vegetative: 18, mature: 25, flowering: 20 },
  mint:          { germination: 2, seedling: 10, vegetative: 22, mature: 30, flowering: 25 },
  dill:          { germination: 2, seedling: 7,  vegetative: 16, mature: 22, flowering: 18 },
  chives:        { germination: 2, seedling: 6,  vegetative: 15, mature: 20, flowering: 15 },
  oregano:       { germination: 2, seedling: 7,  vegetative: 16, mature: 22, flowering: 18 },
  thyme:         { germination: 1, seedling: 5,  vegetative: 12, mature: 18, flowering: 15 },

  // Fruiting (high transpiration)
  tomato:        { germination: 3, seedling: 15, vegetative: 60, mature: 120, flowering: 150 },
  pepper:        { germination: 3, seedling: 12, vegetative: 50, mature: 100, flowering: 130 },
  cucumber:      { germination: 3, seedling: 15, vegetative: 70, mature: 130, flowering: 160 },
  strawberry:    { germination: 2, seedling: 10, vegetative: 40, mature: 80,  flowering: 100 },
  eggplant:      { germination: 3, seedling: 12, vegetative: 50, mature: 100, flowering: 120 },

  // Flowers
  marigold:      { germination: 2, seedling: 8,  vegetative: 20, mature: 30, flowering: 35 },
  zinnia:        { germination: 2, seedling: 8,  vegetative: 22, mature: 32, flowering: 38 },
  nasturtium:    { germination: 2, seedling: 10, vegetative: 25, mature: 35, flowering: 40 }
};

// Class-level defaults (fallback when specific crop not in table)
const CLASS_DEFAULTS = {
  leafy_greens:  { germination: 2, seedling: 8,  vegetative: 20, mature: 30, flowering: 25 },
  microgreens:   { germination: 1, seedling: 4,  vegetative: 8,  mature: 8,  flowering: 0 },
  herbs:         { germination: 2, seedling: 8,  vegetative: 18, mature: 25, flowering: 20 },
  fruiting:      { germination: 3, seedling: 14, vegetative: 55, mature: 120, flowering: 140 },
  flowers:       { germination: 2, seedling: 8,  vegetative: 22, mature: 32, flowering: 38 },
  default:       { germination: 2, seedling: 8,  vegetative: 20, mature: 30, flowering: 25 }
};

const GROWTH_STAGES = ['germination', 'seedling', 'vegetative', 'mature', 'flowering'];

// Target VPD ranges by growth stage (kPa)
const VPD_TARGETS = {
  germination: { min: 0.3, max: 0.6, optimal: 0.4 },
  seedling:    { min: 0.4, max: 0.8, optimal: 0.6 },
  vegetative:  { min: 0.8, max: 1.2, optimal: 1.0 },
  mature:      { min: 0.8, max: 1.2, optimal: 1.0 },
  flowering:   { min: 1.0, max: 1.5, optimal: 1.2 }
};

/**
 * Look up transpiration rate for a crop at a given growth stage.
 * @param {string} crop - crop name (e.g. 'lettuce', 'basil', 'tomato')
 * @param {string} stage - growth stage ('germination'|'seedling'|'vegetative'|'mature'|'flowering')
 * @param {string} [cropClass] - optional crop class fallback ('leafy_greens'|'herbs'|'fruiting'|'microgreens')
 * @returns {{ gPerPlantPerDay: number, stage: string, source: string }}
 */
export function getTranspirationRate(crop, stage = 'mature', cropClass = null) {
  const normalizedCrop = (crop || '').toLowerCase().replace(/[\s-]+/g, '_');
  const normalizedStage = GROWTH_STAGES.includes(stage) ? stage : 'mature';

  // Try exact crop match
  if (TRANSPIRATION_TABLE[normalizedCrop]) {
    return {
      gPerPlantPerDay: TRANSPIRATION_TABLE[normalizedCrop][normalizedStage],
      stage: normalizedStage,
      source: 'crop_specific'
    };
  }

  // Try partial match
  for (const [key, rates] of Object.entries(TRANSPIRATION_TABLE)) {
    if (normalizedCrop.includes(key) || key.includes(normalizedCrop)) {
      return {
        gPerPlantPerDay: rates[normalizedStage],
        stage: normalizedStage,
        source: 'crop_partial_match'
      };
    }
  }

  // Fall back to crop class
  const classKey = (cropClass || 'default').toLowerCase().replace(/[\s-]+/g, '_');
  const classRates = CLASS_DEFAULTS[classKey] || CLASS_DEFAULTS.default;
  return {
    gPerPlantPerDay: classRates[normalizedStage],
    stage: normalizedStage,
    source: cropClass ? 'crop_class' : 'default'
  };
}

/**
 * Get VPD target for a growth stage.
 * @param {string} stage
 * @returns {{ min: number, max: number, optimal: number }}
 */
export function getVPDTarget(stage = 'mature') {
  return VPD_TARGETS[stage] || VPD_TARGETS.mature;
}

/**
 * Estimate growth stage from days since seeding.
 * @param {string} crop - crop name
 * @param {number} daysSinceSeed - days since seed date
 * @param {number} [daysToHarvest] - total days to harvest (if known)
 * @returns {string} growth stage
 */
export function estimateGrowthStage(crop, daysSinceSeed, daysToHarvest = null) {
  const total = daysToHarvest || 35; // default lifecycle
  const ratio = daysSinceSeed / total;

  if (ratio < 0.08) return 'germination';
  if (ratio < 0.25) return 'seedling';
  if (ratio < 0.65) return 'vegetative';
  if (ratio < 0.90) return 'mature';
  return 'flowering';
}

/**
 * Compute total transpiration load for a zone/room.
 * @param {Array<{crop: string, plantCount: number, daysSinceSeed: number, daysToHarvest?: number, cropClass?: string}>} crops
 * @returns {{ totalGPerDay: number, totalLPerDay: number, latentBtuPerHr: number, breakdown: Array }}
 */
export function computeTranspirationLoad(crops) {
  const breakdown = [];
  let totalGPerDay = 0;

  for (const entry of crops) {
    const stage = estimateGrowthStage(entry.crop, entry.daysSinceSeed || 0, entry.daysToHarvest);
    const rate = getTranspirationRate(entry.crop, stage, entry.cropClass);
    const plantG = rate.gPerPlantPerDay * (entry.plantCount || 0);
    totalGPerDay += plantG;
    breakdown.push({
      crop: entry.crop,
      plantCount: entry.plantCount,
      stage,
      gPerPlantPerDay: rate.gPerPlantPerDay,
      totalGPerDay: plantG,
      source: rate.source
    });
  }

  const totalLPerDay = totalGPerDay / 1000;
  // Latent heat of vaporization: 2454 kJ/kg at 20C = 2454 J/g
  // 1 BTU = 1055.06 J
  const latentJPerDay = totalGPerDay * 2454;
  const latentBtuPerHr = Math.round((latentJPerDay / 1055.06 / 24) * 100) / 100;

  return { totalGPerDay, totalLPerDay: Math.round(totalLPerDay * 100) / 100, latentBtuPerHr, breakdown };
}

export default {
  getTranspirationRate,
  getVPDTarget,
  estimateGrowthStage,
  computeTranspirationLoad,
  GROWTH_STAGES,
  TRANSPIRATION_TABLE,
  CLASS_DEFAULTS,
  VPD_TARGETS
};
