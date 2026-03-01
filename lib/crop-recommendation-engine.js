/**
 * HYDROPONIC CROP RECOMMENDATION ENGINE
 * 
 * Phase 1: Delta-Based Scoring System (Rules Engine)
 * 
 * Purpose: Intelligently recommend crops for replanting based on:
 * - Nutrient compatibility (EC/pH fit with current zone conditions)
 * - Market demand velocity (recent sales trends)
 * - Harvest staggering (avoid labor bottlenecks)
 * - Light utilization (match DLI requirements to zone capacity)
 * - VPD environmental fit (vapor pressure deficit compatibility)
 * 
 * Architecture approved by: Architecture Agent (2026-02-04)
 * Approach: Delta-based scoring (NOT binary hard constraints)
 * 
 * CRITICAL: This is a HYDROPONIC system
 * - No soil-based crop rotation needed (no nutrient depletion)
 * - Year-round production (no seasonal production limits)
 * - Fast growth cycles (20-30% faster than soil)
 * - Nutrient compatibility is PRIMARY constraint (shared tanks)
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Load nutrient profile database
 */
async function loadNutrientProfiles() {
  const profilePath = path.join(__dirname, '..', 'public', 'data', 'nutrient-profiles.json');
  const data = await fs.readFile(profilePath, 'utf8');
  return JSON.parse(data);
}

/**
 * Load lighting recipes (crop requirements)
 */
async function loadLightingRecipes() {
  const recipePath = path.join(__dirname, '..', 'public', 'data', 'lighting-recipes.json');
  const data = await fs.readFile(recipePath, 'utf8');
  return JSON.parse(data);
}

/**
 * Get current zone conditions from groups configuration
 */
async function loadGroupsConfig() {
  const groupsPath = path.join(__dirname, '..', 'public', 'data', 'groups.json');
  const data = await fs.readFile(groupsPath, 'utf8');
  return JSON.parse(data);
}

/**
 * Extract average crop requirements from lighting recipe
 * @param {Array} recipeStages - Array of day-by-day recipe stages
 * @returns {Object} Average requirements { ec, ph, dli, vpd, temp, duration }
 */
function calculateCropAverages(recipeStages) {
  if (!recipeStages || recipeStages.length === 0) {
    return null;
  }

  const totals = recipeStages.reduce((acc, stage) => {
    acc.ec += stage.ec || 0;
    acc.ph += stage.ph || 0;
    acc.dli += stage.dli || 0;
    acc.vpd += stage.vpd || 0;
    acc.temp += stage.temperature || 0;
    return acc;
  }, { ec: 0, ph: 0, dli: 0, vpd: 0, temp: 0 });

  const count = recipeStages.length;
  const lastStage = recipeStages[recipeStages.length - 1];

  return {
    ec_target: totals.ec / count,
    ph_target: totals.ph / count,
    dli_target: totals.dli / count,
    vpd_target: totals.vpd / count,
    temp_target: totals.temp / count,
    duration_days: Math.ceil(lastStage.day)
  };
}

/**
 * Find which nutrient profile a crop belongs to
 */
function getCropNutrientProfile(cropId, nutrientProfiles) {
  for (const [profileKey, profile] of Object.entries(nutrientProfiles.profiles)) {
    if (profile.compatible_crops.includes(cropId)) {
      return { key: profileKey, ...profile };
    }
  }
  return null;
}

/**
 * Score nutrient compatibility based on EC/pH delta from zone conditions
 * @param {Object} cropRequirements - Crop's optimal { ec_target, ph_target }
 * @param {Object} zoneConditions - Zone's current { ec, ph }
 * @param {Object} coefficients - Penalty coefficients from nutrient-profiles.json
 * @returns {number} Score 0-100
 */
function scoreNutrientFit(cropRequirements, zoneConditions, coefficients) {
  if (!cropRequirements || !zoneConditions) {
    return 50; // Neutral score if data missing
  }

  // Calculate EC delta
  const ecDelta = Math.abs((zoneConditions.ec || 1.5) - cropRequirements.ec_target);
  const ecScore = Math.max(0, 100 - (ecDelta * coefficients.ec_penalty_per_unit));

  // Calculate pH delta (more critical than EC)
  const phDelta = Math.abs((zoneConditions.ph || 5.8) - cropRequirements.ph_target);
  const phScore = Math.max(0, 100 - (phDelta * coefficients.ph_penalty_per_unit));

  // pH is weighted higher (60%) because it's less adjustable mid-cycle
  return (ecScore * 0.4) + (phScore * 0.6);
}

/**
 * Score lighting efficiency based on DLI utilization
 * @param {number} cropDLI - Crop's DLI requirement
 * @param {number} zoneDLI - Zone's maximum DLI capacity
 * @param {Object} coefficients - Penalty coefficients
 * @returns {number} Score 0-100
 */
function scoreLightFit(cropDLI, zoneDLI, coefficients) {
  if (!cropDLI || !zoneDLI) {
    return 50; // Neutral if data missing
  }

  const utilizationRatio = cropDLI / zoneDLI;

  if (utilizationRatio > 1.0) {
    // Insufficient light - steep penalty (crop won't thrive)
    const excess = utilizationRatio - 1.0;
    return Math.max(0, 100 - (excess * coefficients.dli_penalty_per_10percent_excess * 10));
  } else if (utilizationRatio < 0.6) {
    // Wasting light capacity - moderate penalty (inefficiency)
    const underutilization = (0.6 - utilizationRatio) * 10; // Convert to percent
    return Math.max(50, 100 - (underutilization * coefficients.dli_penalty_per_10percent_underutilization / 10));
  } else {
    // Sweet spot (60-100% utilization)
    return 100;
  }
}

/**
 * Score VPD compatibility
 * @param {Object} cropRequirements - { vpd_target }
 * @param {number} zoneVPD - Zone's target VPD
 * @param {Object} coefficients - Penalty coefficients
 * @returns {number} Score 0-100
 */
function scoreVPDFit(cropRequirements, zoneVPD, coefficients) {
  if (!cropRequirements || !zoneVPD) {
    return 80; // Assume acceptable if unknown
  }

  const cropVPDRange = {
    min: cropRequirements.vpd_target - 0.2,
    max: cropRequirements.vpd_target + 0.2
  };

  if (zoneVPD >= cropVPDRange.min && zoneVPD <= cropVPDRange.max) {
    // Within acceptable range
    const delta = Math.abs(zoneVPD - cropRequirements.vpd_target);
    return Math.max(80, 100 - (delta * coefficients.vpd_penalty_per_unit));
  } else {
    // Outside range - penalize based on distance
    const delta = Math.min(
      Math.abs(zoneVPD - cropVPDRange.min),
      Math.abs(zoneVPD - cropVPDRange.max)
    );
    return Math.max(0, 70 - (delta * coefficients.vpd_penalty_per_unit));
  }
}

/**
 * Calculate demand velocity score based on real wholesale sales data.
 * Falls back to heuristic when no sales data is available.
 *
 * @param {string} cropId - e.g. "crop-buttercrunch-lettuce"
 * @param {Object} [demandData] - Map of crop name → { totalQty, orderCount, trend }
 *   Built from /api/wholesale/orders/history by the caller.
 * @returns {number} Score 0-100
 */
function scoreDemandVelocity(cropId, demandData) {
  // If real demand data is available, use it
  if (demandData && Object.keys(demandData).length > 0) {
    const cropSlug = cropId.replace(/^crop-/, '').toLowerCase();
    const cropName = cropSlug.replace(/-/g, ' ');

    // Find a matching entry (fuzzy: either key contains cropName or cropName contains key)
    let match = null;
    for (const [product, data] of Object.entries(demandData)) {
      const pLower = product.toLowerCase();
      const pSlug = pLower.replace(/\s+/g, '-');
      if (pLower === cropName || pSlug === cropSlug ||
          pLower.includes(cropName) || cropName.includes(pLower) ||
          pSlug.includes(cropSlug) || cropSlug.includes(pSlug) ||
          pLower.split(/\s+/).some(w => cropName.includes(w) && w.length > 3)) {
        match = data;
        break;
      }
    }

    if (match) {
      // Score based on relative order volume
      // totalQty is total units sold in the period; orderCount is # of orders
      const qtyScore = Math.min(100, 50 + match.totalQty * 2);   // More sold → higher
      const freqScore = Math.min(100, 50 + match.orderCount * 10); // More orders → higher
      const trendBonus = match.trend === 'increasing' ? 10 : match.trend === 'decreasing' ? -10 : 0;
      const velocity = typeof match.velocity === 'number' ? match.velocity : 0;
      const velocityBonus = Math.max(-15, Math.min(15, velocity * 20));
      return Math.max(0, Math.min(100, Math.round((qtyScore * 0.55 + freqScore * 0.35) + trendBonus + velocityBonus)));
    }

    // Crop not found in sales data → low demand signal
    return 40;
  }

  // Fallback: heuristic when no sales data available
  const popularCrops = [
    'crop-buttercrunch-lettuce',
    'crop-astro-arugula',
    'crop-genovese-basil',
    'crop-lacinato-kale'
  ];

  if (popularCrops.includes(cropId)) {
    return 85; // High demand
  }

  return 65; // Moderate demand (neutral)
}

/**
 * Calculate harvest staggering score
 * Prevents clustering of harvest dates
 * @param {string} cropId
 * @param {number} cropDuration - Days to harvest
 * @param {Array} currentInventory - Current planted trays
 * @param {Date} targetSeedDate
 * @returns {number} Score 0-100
 */
function scoreHarvestStagger(cropId, cropDuration, currentInventory, targetSeedDate) {
  if (!currentInventory || currentInventory.length === 0) {
    return 100; // Perfect - no clustering risk
  }

  const targetHarvestDate = new Date(targetSeedDate);
  targetHarvestDate.setDate(targetHarvestDate.getDate() + cropDuration);

  // Count trays harvesting in same week
  const weekStart = new Date(targetHarvestDate);
  weekStart.setDate(weekStart.getDate() - 3);
  const weekEnd = new Date(targetHarvestDate);
  weekEnd.setDate(weekEnd.getDate() + 3);

  let traysInWindow = 0;
  for (const tray of currentInventory) {
    if (tray.expectedHarvest) {
      const harvestDate = new Date(tray.expectedHarvest);
      if (harvestDate >= weekStart && harvestDate <= weekEnd) {
        traysInWindow++;
      }
    }
  }

  // Penalty: -5 points per tray in same harvest window
  const totalTrays = currentInventory.length;
  const clusteringPct = (traysInWindow / totalTrays) * 100;

  if (clusteringPct < 15) return 100; // Excellent distribution
  if (clusteringPct < 25) return 85;  // Good
  if (clusteringPct < 35) return 70;  // Acceptable
  if (clusteringPct < 50) return 50;  // Moderate clustering
  return 30; // Heavy clustering - avoid if possible
}

/**
 * Score inventory consistency to ensure steady supply
 * Rewards crops that fill gaps in harvest pipeline
 * 
 * @param {string} cropId
 * @param {number} cropDuration - Days from seed to harvest
 * @param {Array} currentInventory - Current planted trays
 * @param {Date} targetSeedDate
 * @returns {number} Score 0-100
 */
function scoreInventoryConsistency(cropId, cropDuration, currentInventory, targetSeedDate) {
  if (!currentInventory || currentInventory.length === 0) {
    return 100; // First crop - perfect score
  }

  // Count trays of this same crop currently in production
  const cropName = cropId.replace('crop-', '').toLowerCase();
  const sameCropTrays = currentInventory.filter(tray => {
    const traysCrop = (tray.currentCrop || '').toLowerCase();
    return traysCrop.includes(cropName);
  });

  const totalTrays = currentInventory.length;
  const sameCropPct = (sameCropTrays.length / totalTrays) * 100;

  // Calculate harvest timeline gaps (next 4 weeks)
  const harvestTimeline = new Array(28).fill(0); // 28 days = 4 weeks
  const today = new Date();

  for (const tray of currentInventory) {
    if (tray.expectedHarvest) {
      const harvestDate = new Date(tray.expectedHarvest);
      const daysUntilHarvest = Math.floor((harvestDate - today) / (1000 * 60 * 60 * 24));
      if (daysUntilHarvest >= 0 && daysUntilHarvest < 28) {
        harvestTimeline[daysUntilHarvest]++;
      }
    }
  }

  // Find gaps (days with 0-1 harvests)
  const gapDays = harvestTimeline.filter(count => count <= 1).length;
  const gapPct = (gapDays / 28) * 100;

  // Scoring logic:
  // 1. If same crop < 20% of inventory: Good diversity (+20 bonus)
  // 2. If harvest pipeline has gaps (>40%): Reward filling gaps (+30 bonus)
  // 3. If same crop > 50% of inventory: Penalize over-concentration (-40)

  let score = 70; // Base score

  if (sameCropPct < 20) {
    score += 20; // Good diversity
  } else if (sameCropPct > 50) {
    score -= 40; // Too concentrated
  }

  if (gapPct > 40) {
    score += 30; // Rewards filling pipeline gaps
  }

  return Math.max(0, Math.min(100, score));
}

/**
 * Phase 2 Task 2.10: Load network benchmarks from Central's AI push data.
 * Returns a map of crop → { network_optimal_temp_c, network_optimal_humidity_pct, network_optimal_ppfd, ... }
 */
async function loadNetworkBenchmarks() {
  try {
    const aiRecsPath = path.join(__dirname, '..', 'public', 'data', 'ai-recommendations.json');
    const raw = await fs.readFile(aiRecsPath, 'utf8');
    const data = JSON.parse(raw);
    return data?.network_intelligence?.crop_benchmarks || {};
  } catch (_) {
    return {};
  }
}

/**
 * Phase 2 Task 2.10: Score based on network benchmark fit.
 * Compares current zone conditions to network-averaged optimal conditions for the crop.
 * If network data says "basil grows best at 22°C, 70% humidity, 250 PPFD"
 * and the zone is at 23°C, 68% humidity, 240 PPFD → high score.
 *
 * @param {string} cropId       e.g. "crop-genovese-basil"
 * @param {Object} zone         { ec, ph, vpd, dli_capacity, temp, humidity }
 * @param {Object} benchmarks   Network benchmarks map from Central
 * @returns {number} Score 0-100, or 50 if no benchmark data
 */
function scoreNetworkBenchmarkFit(cropId, zone, benchmarks) {
  if (!benchmarks || Object.keys(benchmarks).length === 0) return 50;

  // Find crop benchmark — try various name formats
  const cropName = cropId.replace(/^crop-/, '').replace(/-/g, ' ').toLowerCase();
  let benchmark = null;
  for (const [key, val] of Object.entries(benchmarks)) {
    if (key.toLowerCase() === cropName || key.toLowerCase().includes(cropName) || cropName.includes(key.toLowerCase())) {
      benchmark = val;
      break;
    }
  }
  if (!benchmark) return 50; // No benchmark available for this crop

  let score = 100;
  let factors = 0;

  // Temperature fit
  if (benchmark.network_optimal_temp_c && zone.temp) {
    const tempDelta = Math.abs(zone.temp - benchmark.network_optimal_temp_c);
    score -= Math.min(30, tempDelta * 5); // -5 per degree off
    factors++;
  }

  // Humidity fit
  if (benchmark.network_optimal_humidity_pct && zone.humidity) {
    const humDelta = Math.abs(zone.humidity - benchmark.network_optimal_humidity_pct);
    score -= Math.min(20, humDelta * 0.5); // -0.5 per % off
    factors++;
  }

  // PPFD fit  
  if (benchmark.network_optimal_ppfd && zone.dli_capacity) {
    // Rough conversion: PPFD × 16h × 3600 / 1e6 ≈ zone DLI
    const benchDLI = (benchmark.network_optimal_ppfd * 16 * 3600) / 1e6;
    const dliDelta = Math.abs(zone.dli_capacity - benchDLI);
    score -= Math.min(20, dliDelta * 2); // -2 per mol/m²/d off
    factors++;
  }

  // If we had no comparison factors, return neutral
  if (factors === 0) return 50;

  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * MAIN RECOMMENDATION ENGINE
 * Generate crop recommendations for a specific group/tray
 * 
 * @param {Object} params
 * @param {string} params.groupId - Group ID from groups.json
 * @param {string} params.currentCrop - Current crop being replaced
 * @param {Array} params.availableCrops - List of crop IDs to consider
 * @param {Date} params.targetSeedDate - When the new crop will be seeded
 * @param {Array} params.currentInventory - Current farm inventory
 * @param {Object} params.zoneConditions - Current zone EC/pH/VPD/DLI
 * @returns {Promise<Object>} Recommendations with scores
 */
async function generateCropRecommendations(params) {
  const {
    groupId,
    currentCrop,
    availableCrops = [],
    targetSeedDate = new Date(),
    currentInventory = [],
    zoneConditions = {},
    demandData = null          // Map of crop name → { totalQty, orderCount, trend }
  } = params;

  // Load data files
  const nutrientProfiles = await loadNutrientProfiles();
  const lightingRecipes = await loadLightingRecipes();
  const coefficients = nutrientProfiles.scoring_coefficients;

  // Phase 2 Task 2.10: Load network benchmarks from Central
  const networkBenchmarks = await loadNetworkBenchmarks();

  // Default zone conditions if not provided
  const zone = {
    ec: zoneConditions.ec || 1.5,
    ph: zoneConditions.ph || 5.8,
    vpd: zoneConditions.vpd || 1.0,
    dli_capacity: zoneConditions.dli_capacity || 22,
    temp: zoneConditions.temp || null,
    humidity: zoneConditions.humidity || null
  };

  const hasNetworkData = Object.keys(networkBenchmarks).length > 0;
  const recommendations = [];

  // Score each available crop
  for (const cropId of availableCrops) {
    const recipe = lightingRecipes.crops[cropId.replace('crop-', '').replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())];
    
    if (!recipe) {
      continue; // Skip if no recipe data
    }

    const cropReqs = calculateCropAverages(recipe);
    if (!cropReqs) continue;

    // Calculate individual scores
    const nutrientScore = scoreNutrientFit(cropReqs, zone, coefficients);
    const lightScore = scoreLightFit(cropReqs.dli_target, zone.dli_capacity, coefficients);
    const vpdScore = scoreVPDFit(cropReqs, zone.vpd, coefficients);
    const demandScore = scoreDemandVelocity(cropId, demandData);
    const staggerScore = scoreHarvestStagger(cropId, cropReqs.duration_days, currentInventory, targetSeedDate);
    const inventoryScore = scoreInventoryConsistency(cropId, cropReqs.duration_days, currentInventory, targetSeedDate);
    const networkScore = scoreNetworkBenchmarkFit(cropId, zone, networkBenchmarks);

    // Weighted overall score (Phase 2: includes network intelligence)
    // When network data is available, allocate 5% weight to it (taken from VPD)
    const overallScore = hasNetworkData
      ? (
          nutrientScore * 0.28 +      // Nutrient fit (PRIMARY for hydroponics)
          demandScore * 0.25 +         // Market demand
          inventoryScore * 0.18 +      // Inventory consistency
          staggerScore * 0.14 +        // Harvest timing
          lightScore * 0.07 +          // Light efficiency
          networkScore * 0.05 +        // Network benchmark fit (Phase 2)
          vpdScore * 0.03              // Environmental fit
        )
      : (
          nutrientScore * 0.30 +
          demandScore * 0.25 +
          inventoryScore * 0.20 +
          staggerScore * 0.15 +
          lightScore * 0.07 +
          vpdScore * 0.03
        );

    const scoreResult = {
      nutrient_fit: Math.round(nutrientScore),
      demand: Math.round(demandScore),
      inventory_consistency: Math.round(inventoryScore),
      harvest_stagger: Math.round(staggerScore),
      light_efficiency: Math.round(lightScore),
      vpd_fit: Math.round(vpdScore),
      overall: Math.round(overallScore)
    };
    if (hasNetworkData) {
      scoreResult.network_benchmark = Math.round(networkScore);
    }

    recommendations.push({
      cropId,
      cropName: cropId.replace('crop-', '').replace(/-/g, ' '),
      confidence: overallScore / 100,
      scores: scoreResult,
      deltas: {
        ec: `${(zone.ec - cropReqs.ec_target).toFixed(2)} (crop optimal: ${cropReqs.ec_target.toFixed(1)}, current: ${zone.ec.toFixed(1)})`,
        ph: `${(zone.ph - cropReqs.ph_target).toFixed(2)} (crop optimal: ${cropReqs.ph_target.toFixed(1)}, current: ${zone.ph.toFixed(1)})`,
        dli: `${(zone.dli_capacity - cropReqs.dli_target).toFixed(1)} (crop needs: ${cropReqs.dli_target.toFixed(1)}, available: ${zone.dli_capacity})`
      },
      expectedHarvestDate: new Date(targetSeedDate.getTime() + (cropReqs.duration_days * 24 * 60 * 60 * 1000)).toISOString().split('T')[0],
      durationDays: cropReqs.duration_days
    });
  }

  // Sort by overall score (descending)
  recommendations.sort((a, b) => b.scores.overall - a.scores.overall);

  // Return top 3 recommendations + alternatives
  return {
    groupId,
    currentCrop,
    targetSeedDate: targetSeedDate.toISOString().split('T')[0],
    zoneConditions: zone,
    topRecommendation: recommendations[0] || null,
    alternatives: recommendations.slice(1, 4),
    allScored: recommendations
  };
}

export {
  generateCropRecommendations,
  scoreNutrientFit,
  scoreLightFit,
  scoreVPDFit,
  scoreDemandVelocity,
  scoreHarvestStagger,
  scoreInventoryConsistency,
  scoreNetworkBenchmarkFit,
  loadNutrientProfiles,
  loadLightingRecipes,
  loadNetworkBenchmarks,
  calculateCropAverages,
  getCropNutrientProfile
};
