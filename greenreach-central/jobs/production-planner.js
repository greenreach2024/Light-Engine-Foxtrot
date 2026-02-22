/**
 * Production Planner — Phase 5, Ticket 5.4
 *
 * Central auto-generates weekly seeding plans per farm based on:
 * - Demand forecast (wholesale orders)
 * - Succession needs (avoid harvest gaps)
 * - Network supply balance (avoid oversupply across farms)
 * - Farm capacity (zone availability)
 *
 * Farms receive plans as suggestions (auto-apply with override in Phase 5).
 */

const { pool } = require('../db');

/**
 * Gather demand forecast from wholesale orders.
 * Groups by crop and projects weekly demand.
 *
 * @param {number} [forecastWeeks=4] - weeks to look ahead
 * @returns {Promise<Object>} - { crop: { weeklyDemand, totalOrdered, avgOrderSize } }
 */
async function gatherDemandForecast(forecastWeeks = 4) {
  try {
    // Get recent order history (last 8 weeks as baseline)
    const { rows } = await pool.query(`
      SELECT item_crop AS crop,
             SUM(item_quantity) AS total_qty,
             COUNT(DISTINCT id) AS order_count,
             MIN(created_at) AS first_order,
             MAX(created_at) AS last_order
      FROM wholesale_orders
      WHERE created_at > NOW() - INTERVAL '8 weeks'
        AND status NOT IN ('cancelled', 'refunded')
      GROUP BY item_crop
      ORDER BY total_qty DESC
    `);

    const forecast = {};
    for (const row of rows) {
      const weeksOfData = Math.max(1, Math.ceil(
        (new Date(row.last_order) - new Date(row.first_order)) / (7 * 86400000)
      ));
      const weeklyDemand = Math.ceil(row.total_qty / weeksOfData);
      forecast[row.crop] = {
        weeklyDemand,
        totalOrdered: parseInt(row.total_qty),
        orderCount: parseInt(row.order_count),
        avgOrderSize: Math.round(row.total_qty / row.order_count),
        weeksOfHistory: weeksOfData
      };
    }
    return forecast;
  } catch (err) {
    console.warn('[production-planner] Demand forecast query failed:', err.message);
    return {};
  }
}

/**
 * Get network supply status — what each farm is currently growing.
 *
 * @returns {Promise<Array>} - [ { farm_id, farm_name, crop, active_trays, next_harvest_est } ]
 */
async function getNetworkSupply() {
  try {
    const { rows: farms } = await pool.query('SELECT farm_id, farm_name, url FROM farms WHERE active = true');
    const supply = [];

    for (const farm of farms) {
      try {
        const { rows: records } = await pool.query(`
          SELECT crop,
                 COUNT(*) AS record_count,
                 AVG(grow_days) AS avg_grow_days,
                 MAX(recorded_at) AS last_recorded
          FROM experiment_records
          WHERE farm_id = $1
            AND recorded_at > NOW() - INTERVAL '60 days'
          GROUP BY crop
        `, [farm.farm_id]);

        for (const rec of records) {
          // Estimate active trays from recent activity
          const daysSinceRecord = (Date.now() - new Date(rec.last_recorded)) / 86400000;
          const isLikelyActive = daysSinceRecord < (rec.avg_grow_days || 35) * 1.5;

          supply.push({
            farm_id: farm.farm_id,
            farm_name: farm.farm_name,
            crop: rec.crop,
            record_count: parseInt(rec.record_count),
            avg_grow_days: Math.round(rec.avg_grow_days || 30),
            last_recorded: rec.last_recorded,
            likely_active: isLikelyActive
          });
        }
      } catch {
        // Non-fatal per farm
      }
    }
    return supply;
  } catch (err) {
    console.warn('[production-planner] Network supply query failed:', err.message);
    return [];
  }
}

/**
 * Get farm capacity data from Central's knowledge of each farm.
 *
 * @returns {Promise<Array>} - [ { farm_id, farm_name, estimatedCapacity } ]
 */
async function getFarmCapacities() {
  try {
    const { rows } = await pool.query(`
      SELECT farm_id, farm_name,
             (SELECT COUNT(DISTINCT crop) FROM experiment_records WHERE farm_id = f.farm_id) AS crop_diversity,
             (SELECT COUNT(*) FROM experiment_records WHERE farm_id = f.farm_id AND recorded_at > NOW() - INTERVAL '30 days') AS recent_records
      FROM farms f
      WHERE active = true
    `);

    return rows.map(r => ({
      farm_id: r.farm_id,
      farm_name: r.farm_name,
      crop_diversity: parseInt(r.crop_diversity),
      recent_activity: parseInt(r.recent_records),
      // Estimated tray capacity based on activity level
      estimatedCapacity: Math.max(20, parseInt(r.recent_records) * 3)
    }));
  } catch (err) {
    console.warn('[production-planner] Farm capacity query failed:', err.message);
    return [];
  }
}

/**
 * Generate weekly seeding plan for the network.
 * Allocates seeding tasks to farms based on demand, supply balance, and capacity.
 *
 * @param {object} [options]
 * @param {number} [options.forecastWeeks=4]
 * @returns {Promise<object>} - { plans: [{ farm_id, farm_name, seedingTasks }], summary }
 */
async function generateWeeklyPlan(options = {}) {
  const { forecastWeeks = 4 } = options;

  const [demand, supply, capacities] = await Promise.all([
    gatherDemandForecast(forecastWeeks),
    getNetworkSupply(),
    getFarmCapacities()
  ]);

  if (Object.keys(demand).length === 0 || capacities.length === 0) {
    return {
      plans: [],
      summary: { message: 'Insufficient data — need demand history and active farms', generated_at: new Date().toISOString() }
    };
  }

  // Build per-crop supply map: which farms are already growing what
  const cropSupply = {};
  for (const s of supply) {
    if (!cropSupply[s.crop]) cropSupply[s.crop] = [];
    cropSupply[s.crop].push(s);
  }

  // Calculate supply gaps per crop
  const gaps = {};
  for (const [crop, forecast] of Object.entries(demand)) {
    const cropKey = crop.toLowerCase().replace(/\s+/g, '-');
    const currentSuppliers = (cropSupply[crop] || []).filter(s => s.likely_active);
    const estimatedWeeklySupply = currentSuppliers.length * 2; // rough: 2 harvests/farm/week avg

    const gap = forecast.weeklyDemand - estimatedWeeklySupply;
    if (gap > 0) {
      gaps[crop] = {
        weeklyDemand: forecast.weeklyDemand,
        currentSupply: estimatedWeeklySupply,
        gap,
        currentFarms: currentSuppliers.map(s => s.farm_id)
      };
    }
  }

  // Allocate seeding tasks to farms
  const farmPlans = {};
  for (const cap of capacities) {
    farmPlans[cap.farm_id] = {
      farm_id: cap.farm_id,
      farm_name: cap.farm_name,
      capacity: cap.estimatedCapacity,
      seedingTasks: [],
      totalTraysAssigned: 0
    };
  }

  // Sort gaps by size (largest gap first) for priority allocation
  const sortedGaps = Object.entries(gaps).sort((a, b) => b[1].gap - a[1].gap);

  for (const [crop, gapInfo] of sortedGaps) {
    let remaining = gapInfo.gap;

    // Prefer farms already growing this crop (they have experience)
    const experiencedFarms = capacities
      .filter(f => (gapInfo.currentFarms || []).includes(f.farm_id))
      .sort((a, b) => b.recent_activity - a.recent_activity);

    const otherFarms = capacities
      .filter(f => !(gapInfo.currentFarms || []).includes(f.farm_id))
      .sort((a, b) => b.estimatedCapacity - a.estimatedCapacity);

    const farmOrder = [...experiencedFarms, ...otherFarms];

    for (const farm of farmOrder) {
      if (remaining <= 0) break;
      const plan = farmPlans[farm.farm_id];
      const availableCapacity = plan.capacity - plan.totalTraysAssigned;
      if (availableCapacity <= 0) continue;

      const traysToSeed = Math.min(remaining, Math.ceil(availableCapacity * 0.3)); // Max 30% of capacity per crop
      if (traysToSeed <= 0) continue;

      plan.seedingTasks.push({
        crop,
        trays: traysToSeed,
        priority: remaining >= gapInfo.gap ? 'high' : 'medium',
        reason: `Demand gap: ${gapInfo.weeklyDemand} units/week, current supply: ${gapInfo.currentSupply}`,
        suggestedSeedDate: new Date(Date.now() + 86400000).toISOString().split('T')[0], // Tomorrow
        estimatedHarvestDate: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0], // ~30 days
        auto_apply: true // Phase 5: auto-apply with override
      });

      plan.totalTraysAssigned += traysToSeed;
      remaining -= traysToSeed;
    }
  }

  // Remove farms with no tasks
  const plansWithTasks = Object.values(farmPlans).filter(p => p.seedingTasks.length > 0);

  // Succession planning: ensure staggered planting across network
  for (const plan of plansWithTasks) {
    for (let i = 0; i < plan.seedingTasks.length; i++) {
      const task = plan.seedingTasks[i];
      if (task.trays > 3) {
        // Split into 2 succession batches (stagger by 1 week)
        const batch1 = Math.ceil(task.trays / 2);
        const batch2 = task.trays - batch1;
        task.trays = batch1;
        task.succession_note = `Batch 1 of 2 — stagger with batch 2 (${batch2} trays) in 7 days`;
        plan.seedingTasks.push({
          ...task,
          trays: batch2,
          suggestedSeedDate: new Date(Date.now() + 8 * 86400000).toISOString().split('T')[0],
          estimatedHarvestDate: new Date(Date.now() + 37 * 86400000).toISOString().split('T')[0],
          succession_note: `Batch 2 of 2 — staggered from batch 1`,
          priority: 'medium'
        });
      }
    }
  }

  const summary = {
    generated_at: new Date().toISOString(),
    forecast_weeks: forecastWeeks,
    crops_with_demand: Object.keys(demand).length,
    crops_with_gaps: Object.keys(gaps).length,
    farms_with_plans: plansWithTasks.length,
    total_tasks: plansWithTasks.reduce((s, p) => s + p.seedingTasks.length, 0),
    total_trays: plansWithTasks.reduce((s, p) => s + p.totalTraysAssigned, 0),
    demand_snapshot: demand,
    gaps_identified: gaps
  };

  console.log(`[production-planner] Generated ${summary.total_tasks} seeding tasks across ${summary.farms_with_plans} farms (${summary.crops_with_gaps} crops with gaps)`);

  return { plans: plansWithTasks, summary };
}

/**
 * Push seeding plan to a specific farm via Central→Edge API.
 *
 * @param {object} farm - { farm_id, url }
 * @param {Array} seedingTasks - tasks for this farm
 * @returns {Promise<object>}
 */
async function pushPlanToFarm(farm, seedingTasks) {
  try {
    const fetch = (await import('node-fetch')).default;
    const response = await fetch(`${farm.url}/api/health/ai-recommendations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'greenreach-central',
        type: 'production_plan',
        production_plan: {
          seeding_tasks: seedingTasks,
          generated_at: new Date().toISOString(),
          auto_apply: true,
          override_available: true
        }
      }),
      timeout: 10000
    });
    const result = await response.json();
    return { ok: true, farm_id: farm.farm_id, ...result };
  } catch (err) {
    console.warn(`[production-planner] Failed to push plan to ${farm.farm_id}:`, err.message);
    return { ok: false, farm_id: farm.farm_id, error: err.message };
  }
}

/**
 * Full pipeline: generate plan and push to all farms.
 */
async function generateAndDistributePlan(options = {}) {
  const { plans, summary } = await generateWeeklyPlan(options);

  if (plans.length === 0) {
    return { distributed: 0, summary };
  }

  // Get farm URLs
  const { rows: farms } = await pool.query('SELECT farm_id, url FROM farms WHERE active = true');
  const farmUrlMap = {};
  for (const f of farms) farmUrlMap[f.farm_id] = f;

  const results = [];
  for (const plan of plans) {
    const farm = farmUrlMap[plan.farm_id];
    if (farm?.url) {
      const result = await pushPlanToFarm(farm, plan.seedingTasks);
      results.push(result);
    }
  }

  return {
    distributed: results.filter(r => r.ok).length,
    failed: results.filter(r => !r.ok).length,
    results,
    summary
  };
}

module.exports = {
  gatherDemandForecast,
  getNetworkSupply,
  getFarmCapacities,
  generateWeeklyPlan,
  pushPlanToFarm,
  generateAndDistributePlan
};
