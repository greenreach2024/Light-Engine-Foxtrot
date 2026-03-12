/**
 * Network Planting Coordinator — Claim #19 Implementation
 *
 * Cross-farm demand coordination that:
 * - Aggregates what every farm in the network is currently growing
 * - Detects crop saturation (too many farms on same crop)
 * - Identifies crop gaps (demand exists but no/few farms producing)
 * - Generates farm-SPECIFIC recommendations considering what OTHER farms are doing
 * - Suggests staggered planting to prevent simultaneous harvest flooding
 * - Coordinates diversification to maximize network coverage
 *
 * This replaces per-farm-only recommendations with true network-level coordination.
 */

import logger from '../utils/logger.js';

/**
 * Generate network-coordinated planting recommendations for a specific farm.
 *
 * Unlike per-farm recommendations, this considers what ALL other farms are
 * already growing to avoid market flooding and fill supply gaps.
 *
 * @param {Object} pool - Database pool
 * @param {string} farmId - The farm requesting recommendations
 * @param {Object} opts - { marketData, forecastDays }
 * @returns {Object} Coordinated recommendations with network context
 */
export async function getCoordinatedPlantingRecommendations(pool, farmId, opts = {}) {
  const forecastDays = opts.forecastDays || 30;

  try {
    // ── 1. Get network-wide planting state ──────────────────────────────

    const networkState = await getNetworkPlantingState(pool, forecastDays);
    const farmState = await getFarmCurrentState(pool, farmId);
    const demandSignals = await getDemandSignals(pool, forecastDays);

    // ── 2. Compute crop saturation index across network ─────────────────

    const saturationIndex = computeSaturationIndex(networkState, demandSignals);

    // ── 3. Generate farm-specific recommendations ───────────────────────

    const recommendations = [];

    // Recommend EXPANSION: crops with high demand but low network supply
    for (const [crop, sat] of Object.entries(saturationIndex)) {
      if (sat.status === 'undersupplied') {
        const farmAlreadyGrowing = farmState.activeCrops.includes(crop);
        const otherFarmsCount = sat.active_farms
          .filter(f => f.farm_id !== farmId).length;

        recommendations.push({
          type: 'expand',
          crop,
          priority: sat.gap_severity === 'critical' ? 'critical' : 'high',
          action: farmAlreadyGrowing ? 'increase_production' : 'start_growing',
          reasoning: buildExpansionReasoning(crop, sat, otherFarmsCount, farmAlreadyGrowing),
          network_context: {
            farms_currently_growing: sat.active_farm_count,
            farms_excluding_you: otherFarmsCount,
            monthly_demand: sat.monthly_demand,
            monthly_supply: sat.monthly_supply,
            gap: sat.gap,
            recommended_additional_trays: Math.max(2, Math.ceil(sat.gap / (otherFarmsCount + 1))),
          },
          confidence: sat.demand_confidence,
          estimated_revenue_uplift: sat.gap * (sat.avg_order_value || 25)
        });
      }
    }

    // Recommend REDUCTION: crops where this farm + network are oversupplied
    for (const [crop, sat] of Object.entries(saturationIndex)) {
      if (sat.status === 'oversupplied' && farmState.activeCrops.includes(crop)) {
        const farmContribution = sat.active_farms
          .find(f => f.farm_id === farmId);

        if (!farmContribution) continue;

        recommendations.push({
          type: 'reduce',
          crop,
          priority: sat.excess > sat.monthly_demand * 0.5 ? 'high' : 'medium',
          action: 'consider_reducing',
          reasoning: buildReductionReasoning(crop, sat, farmContribution),
          network_context: {
            farms_currently_growing: sat.active_farm_count,
            monthly_demand: sat.monthly_demand,
            monthly_supply: sat.monthly_supply,
            excess: sat.excess,
            your_contribution_percent: farmContribution
              ? +((farmContribution.harvests / sat.monthly_supply) * 100).toFixed(1)
              : 0
          },
          suggested_replacement_crops: findReplacementCrops(saturationIndex, farmState)
        });
      }
    }

    // Recommend DIVERSIFICATION: crops no one in the network is growing but have demand potential
    for (const [crop, sat] of Object.entries(saturationIndex)) {
      if (sat.status === 'unserved' && !farmState.activeCrops.includes(crop)) {
        recommendations.push({
          type: 'diversify',
          crop,
          priority: 'medium',
          action: 'consider_new_crop',
          reasoning: `No farm in the network is currently producing ${crop}, but market demand signals exist (${sat.monthly_demand} orders/mo). First-mover advantage opportunity.`,
          network_context: {
            farms_currently_growing: 0,
            monthly_demand: sat.monthly_demand,
            monthly_supply: 0
          },
          confidence: 'medium'
        });
      }
    }

    // Recommend STAGGERING: when multiple farms harvest same crop same week
    const staggerAlerts = await detectHarvestClustering(pool, farmId, forecastDays);
    for (const alert of staggerAlerts) {
      recommendations.push({
        type: 'stagger',
        crop: alert.crop,
        priority: alert.farm_count >= 4 ? 'high' : 'medium',
        action: 'adjust_planting_schedule',
        reasoning: alert.message,
        network_context: {
          conflicting_farms: alert.farms,
          conflict_week: alert.week,
          suggested_offset_days: alert.suggested_offset
        },
        confidence: 'high'
      });
    }

    // Sort: critical > high > medium > low
    const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    recommendations.sort((a, b) =>
      (priorityOrder[a.priority] ?? 3) - (priorityOrder[b.priority] ?? 3)
    );

    return {
      ok: true,
      farm_id: farmId,
      recommendations,
      count: recommendations.length,
      network_summary: {
        total_farms: networkState.totalFarms,
        active_crops: Object.keys(saturationIndex).length,
        undersupplied: Object.values(saturationIndex).filter(s => s.status === 'undersupplied').length,
        oversupplied: Object.values(saturationIndex).filter(s => s.status === 'oversupplied').length,
        balanced: Object.values(saturationIndex).filter(s => s.status === 'balanced').length,
        unserved: Object.values(saturationIndex).filter(s => s.status === 'unserved').length
      },
      saturation_index: saturationIndex,
      generated_at: new Date().toISOString()
    };
  } catch (err) {
    logger.error('[NetworkCoord] Error:', err.message);
    return { ok: false, farm_id: farmId, recommendations: [], error: err.message };
  }
}

// ── Data Gathering ────────────────────────────────────────────────────

async function getNetworkPlantingState(pool, days) {
  try {
    // What is every farm in the network currently producing?
    const { rows } = await pool.query(`
      SELECT
        er.farm_id,
        f.farm_name,
        er.crop,
        COUNT(*) AS harvest_count,
        AVG(COALESCE(er.planned_grow_days, 28)) AS avg_grow_days,
        MAX(er.recorded_at) AS last_harvest,
        AVG((er.outcomes->>'weight_per_plant_oz')::float) AS avg_weight_oz,
        AVG((er.outcomes->>'quality_score')::float) AS avg_quality
      FROM experiment_records er
      JOIN farms f ON f.farm_id = er.farm_id
      WHERE er.recorded_at > NOW() - ($1 || ' days')::INTERVAL
      GROUP BY er.farm_id, f.farm_name, er.crop
      ORDER BY er.crop, harvest_count DESC
    `, [days * 2]); // look back 2x for better context

    // Count unique active farms
    const farmIds = new Set(rows.map(r => r.farm_id));

    return {
      totalFarms: farmIds.size,
      farmCropProduction: rows.map(r => ({
        farm_id: r.farm_id,
        farm_name: r.farm_name,
        crop: r.crop,
        harvests: Math.round(parseInt(r.harvest_count) / 2), // normalize to monthly
        avg_grow_days: Math.round(parseFloat(r.avg_grow_days)),
        last_harvest: r.last_harvest,
        avg_weight_oz: parseFloat(r.avg_weight_oz) || 0,
        avg_quality: parseFloat(r.avg_quality) || 0
      }))
    };
  } catch (err) {
    logger.warn('[NetworkCoord] getNetworkPlantingState failed:', err.message);
    return { totalFarms: 0, farmCropProduction: [] };
  }
}

async function getFarmCurrentState(pool, farmId) {
  try {
    const { rows } = await pool.query(`
      SELECT DISTINCT crop
      FROM experiment_records
      WHERE farm_id = $1
        AND recorded_at > NOW() - INTERVAL '45 days'
    `, [farmId]);

    return {
      activeCrops: rows.map(r => r.crop)
    };
  } catch {
    return { activeCrops: [] };
  }
}

async function getDemandSignals(pool, days) {
  try {
    const { rows } = await pool.query(`
      SELECT
        crop,
        COUNT(*) AS order_count,
        SUM(COALESCE((details->>'cases')::int, 1)) AS total_cases,
        COUNT(DISTINCT buyer_id) AS unique_buyers,
        AVG(COALESCE(total_amount, 0)) AS avg_order_value
      FROM wholesale_orders
      WHERE created_at > NOW() - ($1 || ' days')::INTERVAL
        AND status NOT IN ('cancelled', 'rejected')
      GROUP BY crop
      ORDER BY total_cases DESC
    `, [days * 2]);

    const signals = {};
    for (const row of rows) {
      signals[row.crop] = {
        order_count: Math.round(parseInt(row.order_count) / 2), // normalize to monthly
        total_cases: Math.round(parseInt(row.total_cases) / 2),
        unique_buyers: parseInt(row.unique_buyers),
        avg_order_value: parseFloat(row.avg_order_value) || 0,
        confidence: parseInt(row.order_count) >= 10 ? 'high' : parseInt(row.order_count) >= 5 ? 'medium' : 'low'
      };
    }
    return signals;
  } catch {
    return {};
  }
}

// ── Analysis ──────────────────────────────────────────────────────────

function computeSaturationIndex(networkState, demandSignals) {
  const index = {};

  // Build supply per crop from network state
  const supplyCrops = {};
  for (const prod of networkState.farmCropProduction) {
    if (!supplyCrops[prod.crop]) {
      supplyCrops[prod.crop] = {
        monthly_supply: 0,
        active_farms: [],
        active_farm_count: 0,
        avg_quality: []
      };
    }
    supplyCrops[prod.crop].monthly_supply += prod.harvests;
    supplyCrops[prod.crop].active_farms.push({
      farm_id: prod.farm_id,
      farm_name: prod.farm_name,
      harvests: prod.harvests,
      avg_quality: prod.avg_quality
    });
    supplyCrops[prod.crop].active_farm_count++;
    if (prod.avg_quality > 0) supplyCrops[prod.crop].avg_quality.push(prod.avg_quality);
  }

  // Merge supply and demand
  const allCrops = new Set([...Object.keys(supplyCrops), ...Object.keys(demandSignals)]);

  for (const crop of allCrops) {
    const supply = supplyCrops[crop] || { monthly_supply: 0, active_farms: [], active_farm_count: 0, avg_quality: [] };
    const demand = demandSignals[crop] || { total_cases: 0, order_count: 0, unique_buyers: 0, avg_order_value: 0, confidence: 'low' };

    const monthlySupply = supply.monthly_supply;
    const monthlyDemand = demand.total_cases || demand.order_count;

    let status, gap = 0, excess = 0, gapSeverity = 'none';

    if (monthlyDemand > 0 && monthlySupply < monthlyDemand * 0.8) {
      status = 'undersupplied';
      gap = monthlyDemand - monthlySupply;
      gapSeverity = gap > monthlyDemand * 0.5 ? 'critical' : 'moderate';
    } else if (monthlySupply > monthlyDemand * 1.3 && monthlyDemand > 0) {
      status = 'oversupplied';
      excess = monthlySupply - monthlyDemand;
    } else if (monthlyDemand > 0 && supply.active_farm_count === 0) {
      status = 'unserved';
      gap = monthlyDemand;
      gapSeverity = 'critical';
    } else {
      status = 'balanced';
    }

    const qualities = supply.avg_quality.length > 0
      ? supply.avg_quality.reduce((s, q) => s + q, 0) / supply.avg_quality.length
      : 0;

    index[crop] = {
      status,
      monthly_supply: monthlySupply,
      monthly_demand: monthlyDemand,
      gap,
      excess,
      gap_severity: gapSeverity,
      active_farm_count: supply.active_farm_count,
      active_farms: supply.active_farms,
      avg_network_quality: +qualities.toFixed(2),
      unique_buyers: demand.unique_buyers,
      avg_order_value: demand.avg_order_value,
      demand_confidence: demand.confidence
    };
  }

  return index;
}

async function detectHarvestClustering(pool, farmId, lookAheadDays) {
  try {
    // Predict upcoming harvests across network
    const { rows } = await pool.query(`
      SELECT
        er.farm_id,
        f.farm_name,
        er.crop,
        MAX(er.recorded_at) AS last_harvest,
        AVG(COALESCE(er.planned_grow_days, 28)) AS avg_grow_days
      FROM experiment_records er
      JOIN farms f ON f.farm_id = er.farm_id
      WHERE er.recorded_at > NOW() - INTERVAL '90 days'
      GROUP BY er.farm_id, f.farm_name, er.crop
      HAVING COUNT(*) >= 2
    `);

    const now = new Date();
    const upcoming = [];

    for (const row of rows) {
      const lastHarvest = new Date(row.last_harvest);
      const avgGrowDays = parseFloat(row.avg_grow_days);
      const daysSinceLast = (now - lastHarvest) / 86400000;
      const daysToNext = Math.max(0, avgGrowDays - daysSinceLast);

      if (daysToNext <= lookAheadDays) {
        const harvestDate = new Date(now.getTime() + daysToNext * 86400000);
        const weekStart = new Date(harvestDate);
        weekStart.setDate(weekStart.getDate() - weekStart.getDay());

        upcoming.push({
          farm_id: row.farm_id,
          farm_name: row.farm_name,
          crop: row.crop,
          estimated_harvest: harvestDate,
          week: weekStart.toISOString().split('T')[0]
        });
      }
    }

    // Group by crop + week → detect clusters
    const clusters = {};
    for (const h of upcoming) {
      const key = `${h.crop}::${h.week}`;
      if (!clusters[key]) clusters[key] = { crop: h.crop, week: h.week, farms: [] };
      clusters[key].farms.push({ farm_id: h.farm_id, farm_name: h.farm_name });
    }

    // Return clusters involving our farm with 2+ farms
    const alerts = [];
    for (const cluster of Object.values(clusters)) {
      const involvesFarm = cluster.farms.some(f => f.farm_id === farmId);
      if (cluster.farms.length >= 2 && involvesFarm) {
        const otherFarms = cluster.farms.filter(f => f.farm_id !== farmId);
        alerts.push({
          crop: cluster.crop,
          week: cluster.week,
          farm_count: cluster.farms.length,
          farms: otherFarms.map(f => f.farm_name),
          suggested_offset: Math.ceil(7 / cluster.farms.length), // stagger evenly across week
          message: `${cluster.farms.length} farms (including yours) are projected to harvest ${cluster.crop} the week of ${cluster.week}. Consider shifting your planting date by ${Math.ceil(7 / cluster.farms.length)} days to stagger harvests and avoid market flooding.`
        });
      }
    }

    return alerts;
  } catch (err) {
    logger.warn('[NetworkCoord] detectHarvestClustering error:', err.message);
    return [];
  }
}

// ── Reasoning Generators ──────────────────────────────────────────────

function buildExpansionReasoning(crop, sat, otherFarmsCount, alreadyGrowing) {
  const parts = [];
  parts.push(`Network demand for ${crop}: ${sat.monthly_demand} orders/mo, but only ${sat.monthly_supply} harvests/mo (${sat.gap} shortfall).`);

  if (otherFarmsCount === 0) {
    parts.push('No other farms in the network are currently producing this crop — sole supplier opportunity.');
  } else {
    parts.push(`${otherFarmsCount} other farm${otherFarmsCount > 1 ? 's' : ''} currently growing, but not meeting demand.`);
  }

  if (alreadyGrowing) {
    parts.push('You are already growing this crop — consider expanding production.');
  } else {
    parts.push('Adding this crop would help the network fill an active demand gap.');
  }

  if (sat.unique_buyers > 1) {
    parts.push(`${sat.unique_buyers} unique buyers ordering this crop.`);
  }

  return parts.join(' ');
}

function buildReductionReasoning(crop, sat, farmContribution) {
  const parts = [];
  parts.push(`Network supply of ${crop} (${sat.monthly_supply}/mo) exceeds demand (${sat.monthly_demand}/mo) by ${sat.excess} units.`);
  parts.push(`${sat.active_farm_count} farms producing this crop.`);

  if (farmContribution && sat.monthly_supply > 0) {
    const percent = ((farmContribution.harvests / sat.monthly_supply) * 100).toFixed(0);
    parts.push(`Your farm contributes ~${percent}% of network supply.`);
  }

  parts.push('Consider reallocating some capacity to undersupplied crops.');
  return parts.join(' ');
}

function findReplacementCrops(saturationIndex, farmState) {
  return Object.entries(saturationIndex)
    .filter(([crop, sat]) =>
      sat.status === 'undersupplied' &&
      !farmState.activeCrops.includes(crop)
    )
    .sort((a, b) => b[1].gap - a[1].gap)
    .slice(0, 3)
    .map(([crop, sat]) => ({
      crop,
      gap: sat.gap,
      monthly_demand: sat.monthly_demand,
      farms_currently_growing: sat.active_farm_count
    }));
}

export default {
  getCoordinatedPlantingRecommendations
};
