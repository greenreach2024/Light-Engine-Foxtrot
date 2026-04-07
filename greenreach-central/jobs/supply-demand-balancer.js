/**
 * Supply/Demand Balancer — Phase 4, Ticket 4.3
 *
 * Central job that aggregates demand forecasts + harvest predictions across the
 * network, identifies supply gaps and surpluses, and pushes recommendations to farms.
 *
 * Data sources:
 *  - experiment_records table (actual yields + planned grow days)
 *  - wholesale orders (demand signals)
 *  - crop benchmarks (expected yields per crop)
 *
 * Output:
 *  - Supply/demand gap analysis per crop
 *  - Farm-specific expansion/reduction recommendations
 *  - Risk alerts for network-level flooding or shortages
 */

import { query as dbQuery } from '../config/database.js';

const pool = {
  query: (...args) => dbQuery(...args)
};

/**
 * Detect harvest schedule conflicts — ticket 4.2
 * Multiple farms harvesting the same crop in the same week = market flooding risk.
 *
 * @param {number} [lookAheadDays=14] — how far ahead to scan
 * @returns {Array} conflicts: [{ crop, week, farms[], risk_level }]
 */
export async function detectHarvestConflicts(lookAheadDays = 14) {
  try {
    // Query recent experiment records to estimate upcoming harvests.
    // planned_grow_days + planting date → estimated harvest date.
    const result = await pool.query(`
      SELECT
        er.farm_id,
        f.name AS farm_name,
        er.crop,
        er.recorded_at,
        er.outcomes->>'grow_days' AS actual_grow_days,
        er.planned_grow_days,
        er.outcomes->>'weight_per_plant_oz' AS weight_oz
      FROM experiment_records er
      JOIN farms f ON f.farm_id = er.farm_id
      WHERE er.recorded_at > NOW() - INTERVAL '90 days'
      ORDER BY er.crop, er.recorded_at DESC
    `);

    // Build per-crop harvest cadence: average grow days per farm per crop
    const cropFarmCadence = {};
    for (const row of result.rows) {
      const key = `${row.crop}::${row.farm_id}`;
      if (!cropFarmCadence[key]) {
        cropFarmCadence[key] = {
          crop: row.crop,
          farm_id: row.farm_id,
          farm_name: row.farm_name,
          harvests: [],
          avg_grow_days: 0
        };
      }
      cropFarmCadence[key].harvests.push({
        date: new Date(row.recorded_at),
        grow_days: parseInt(row.actual_grow_days || row.planned_grow_days) || 30
      });
    }

    // Estimate next harvest per farm/crop
    const upcomingHarvests = [];
    const now = new Date();
    const lookAheadMs = lookAheadDays * 24 * 60 * 60 * 1000;

    for (const entry of Object.values(cropFarmCadence)) {
      if (entry.harvests.length === 0) continue;

      const avgGrowDays = entry.harvests.reduce((s, h) => s + h.grow_days, 0) / entry.harvests.length;
      const lastHarvest = entry.harvests[0].date; // already sorted DESC
      const estimatedNext = new Date(lastHarvest.getTime() + avgGrowDays * 24 * 60 * 60 * 1000);

      if (estimatedNext >= now && estimatedNext <= new Date(now.getTime() + lookAheadMs)) {
        // Get ISO week number
        const weekStart = new Date(estimatedNext);
        weekStart.setDate(weekStart.getDate() - weekStart.getDay());
        const weekKey = weekStart.toISOString().slice(0, 10);

        upcomingHarvests.push({
          crop: entry.crop,
          farm_id: entry.farm_id,
          farm_name: entry.farm_name,
          estimated_harvest: estimatedNext.toISOString(),
          week: weekKey,
          avg_grow_days: Math.round(avgGrowDays)
        });
      }
    }

    // Group by crop+week → detect conflicts (2+ farms same crop same week)
    const byWeekCrop = {};
    for (const h of upcomingHarvests) {
      const key = `${h.crop}::${h.week}`;
      if (!byWeekCrop[key]) byWeekCrop[key] = { crop: h.crop, week: h.week, farms: [] };
      byWeekCrop[key].farms.push({
        farm_id: h.farm_id,
        farm_name: h.farm_name,
        estimated_harvest: h.estimated_harvest
      });
    }

    const conflicts = Object.values(byWeekCrop)
      .filter(g => g.farms.length >= 2)
      .map(g => ({
        crop: g.crop,
        week: g.week,
        farm_count: g.farms.length,
        farms: g.farms,
        risk_level: g.farms.length >= 4 ? 'high' : g.farms.length >= 3 ? 'medium' : 'low',
        message: `${g.farms.length} farms harvesting ${g.crop} week of ${g.week} — consider staggering or redirecting to avoid market flooding.`
      }));

    return conflicts;
  } catch (error) {
    console.error('[SupplyDemand] detectHarvestConflicts error:', error.message);
    return [];
  }
}

/**
 * Analyze supply/demand balance across the network — ticket 4.3
 *
 * Compares projected supply (from experiment records + grow cadence) against
 * wholesale demand (from order history) to find gaps and surpluses.
 *
 * @param {number} [forecastDays=30] — planning horizon
 * @returns {{ gaps: Array, surpluses: Array, recommendations: Array }}
 */
export async function analyzeSupplyDemand(forecastDays = 30) {
  try {
    // 1. Demand: aggregate recent wholesale orders by crop
    const demandResult = await pool.query(`
      SELECT
        crop,
        SUM(COALESCE((details->>'cases')::int, 1)) AS total_cases_ordered,
        COUNT(*) AS order_count,
        AVG(COALESCE((details->>'cases')::int, 1)) AS avg_cases_per_order
      FROM wholesale_orders
      WHERE created_at > NOW() - INTERVAL '60 days'
        AND status NOT IN ('cancelled', 'rejected')
      GROUP BY crop
      ORDER BY total_cases_ordered DESC
    `);

    // 2. Supply: project from recent experiment records
    const supplyResult = await pool.query(`
      SELECT
        crop,
        COUNT(DISTINCT farm_id) AS active_farms,
        AVG((outcomes->>'weight_per_plant_oz')::float) AS avg_weight_oz,
        COUNT(*) AS harvest_count_60d,
        AVG(COALESCE(planned_grow_days, 28)) AS avg_grow_days
      FROM experiment_records
      WHERE recorded_at > NOW() - INTERVAL '60 days'
      GROUP BY crop
      ORDER BY harvest_count_60d DESC
    `);

    const demandByCrop = {};
    for (const row of demandResult.rows) {
      demandByCrop[row.crop] = {
        total_cases: parseInt(row.total_cases_ordered),
        order_count: parseInt(row.order_count),
        avg_per_order: parseFloat(row.avg_cases_per_order).toFixed(1),
        monthly_demand: Math.round(parseInt(row.total_cases_ordered) / 2) // 60d → 30d
      };
    }

    const supplyByCrop = {};
    for (const row of supplyResult.rows) {
      const harvestsPerMonth = (parseInt(row.harvest_count_60d) / 2); // 60d → 30d
      supplyByCrop[row.crop] = {
        active_farms: parseInt(row.active_farms),
        avg_weight_oz: parseFloat(row.avg_weight_oz || 0).toFixed(1),
        harvests_per_month: Math.round(harvestsPerMonth),
        avg_grow_days: Math.round(parseFloat(row.avg_grow_days))
      };
    }

    // 3. Identify gaps and surpluses
    const allCrops = new Set([...Object.keys(demandByCrop), ...Object.keys(supplyByCrop)]);
    const gaps = [];
    const surpluses = [];
    const recommendations = [];

    for (const crop of allCrops) {
      const demand = demandByCrop[crop];
      const supply = supplyByCrop[crop];

      if (demand && (!supply || supply.harvests_per_month < demand.monthly_demand * 0.8)) {
        const shortfall = demand.monthly_demand - (supply?.harvests_per_month || 0);
        gaps.push({
          crop,
          monthly_demand: demand.monthly_demand,
          projected_supply: supply?.harvests_per_month || 0,
          shortfall,
          active_farms: supply?.active_farms || 0,
          severity: shortfall > demand.monthly_demand * 0.5 ? 'critical' : 'moderate'
        });
        recommendations.push({
          type: 'expand',
          crop,
          message: `Network needs ~${demand.monthly_demand} harvests/month of ${crop}, trajectory: ${supply?.harvests_per_month || 0}. Suggest ${Math.ceil(shortfall / 2)} farms expand production.`,
          priority: shortfall > demand.monthly_demand * 0.5 ? 'high' : 'medium'
        });
      }

      if (supply && (!demand || supply.harvests_per_month > (demand?.monthly_demand || 0) * 1.3)) {
        const excess = supply.harvests_per_month - (demand?.monthly_demand || 0);
        surpluses.push({
          crop,
          monthly_demand: demand?.monthly_demand || 0,
          projected_supply: supply.harvests_per_month,
          excess,
          active_farms: supply.active_farms
        });
        if (excess > 3) {
          recommendations.push({
            type: 'reduce',
            crop,
            message: `${crop} supply (${supply.harvests_per_month}/mo) exceeds demand (${demand?.monthly_demand || 0}/mo). Consider reallocating ${Math.ceil(excess / 2)} groups to higher-demand crops.`,
            priority: 'low'
          });
        }
      }
    }

    return {
      forecast_days: forecastDays,
      analyzed_at: new Date().toISOString(),
      crop_count: allCrops.size,
      gaps,
      surpluses,
      recommendations: recommendations.sort((a, b) =>
        (a.priority === 'high' ? 0 : a.priority === 'medium' ? 1 : 2) -
        (b.priority === 'high' ? 0 : b.priority === 'medium' ? 1 : 2)
      )
    };
  } catch (error) {
    console.error('[SupplyDemand] analyzeSupplyDemand error:', error.message);
    return { forecast_days: forecastDays, analyzed_at: new Date().toISOString(), crop_count: 0, gaps: [], surpluses: [], recommendations: [] };
  }
}

/**
 * Generate network risk alerts for the AI push payload.
 * Combines harvest conflicts + supply/demand gaps.
 */

// Phase 3 Task 34: Adaptive loss pattern alerts
// Compares each farm's recent loss rate against its own rolling baseline
async function detectAdaptiveLossAlerts() {
  const alerts = [];
  try {
    const result = await pool.query(`
      WITH farm_baselines AS (
        SELECT
          farm_id,
          crop,
          AVG(loss_pct) AS baseline_loss,
          STDDEV(loss_pct) AS loss_stddev,
          COUNT(*) AS history_count
        FROM loss_events
        WHERE event_date >= NOW() - INTERVAL '90 days'
          AND event_date < NOW() - INTERVAL '14 days'
        GROUP BY farm_id, crop
        HAVING COUNT(*) >= 3
      ),
      recent_losses AS (
        SELECT
          farm_id,
          crop,
          AVG(loss_pct) AS recent_loss,
          array_agg(DISTINCT cause) FILTER (WHERE cause IS NOT NULL) AS causes,
          COUNT(*) AS event_count
        FROM loss_events
        WHERE event_date >= NOW() - INTERVAL '14 days'
        GROUP BY farm_id, crop
      )
      SELECT
        r.farm_id,
        r.crop,
        r.recent_loss,
        r.causes,
        r.event_count,
        b.baseline_loss,
        b.loss_stddev,
        b.history_count,
        CASE
          WHEN b.loss_stddev > 0 THEN (r.recent_loss - b.baseline_loss) / b.loss_stddev
          ELSE CASE WHEN r.recent_loss > b.baseline_loss * 1.5 THEN 3 ELSE 0 END
        END AS z_score
      FROM recent_losses r
      JOIN farm_baselines b ON r.farm_id = b.farm_id AND r.crop = b.crop
      WHERE r.recent_loss > b.baseline_loss * 1.3
      ORDER BY r.recent_loss - b.baseline_loss DESC
    `);

    for (const row of result.rows) {
      const zScore = parseFloat(row.z_score) || 0;
      const severity = zScore >= 3 ? 'high' : zScore >= 2 ? 'medium' : 'low';
      const baselinePct = parseFloat(row.baseline_loss || 0).toFixed(1);
      const recentPct = parseFloat(row.recent_loss || 0).toFixed(1);
      const causes = row.causes && row.causes.length > 0
        ? row.causes.join(', ')
        : 'unknown';

      alerts.push({
        type: 'loss_pattern',
        severity,
        crop: row.crop,
        farm_id: row.farm_id,
        message: `${row.crop} loss spike on farm ${row.farm_id}: ${recentPct}% vs ${baselinePct}% baseline (causes: ${causes})`,
        details: {
          recent_loss_pct: parseFloat(recentPct),
          baseline_loss_pct: parseFloat(baselinePct),
          z_score: parseFloat(zScore.toFixed(2)),
          event_count: parseInt(row.event_count),
          causes: row.causes || [],
          history_depth: parseInt(row.history_count)
        }
      });
    }
  } catch (err) {
    console.error('[SupplyDemand] Adaptive loss alert error:', err.message);
  }
  return alerts;
}

export async function generateNetworkRiskAlerts() {
  const conflicts = await detectHarvestConflicts(14);
  const balance = await analyzeSupplyDemand(30);

  const alerts = [];

  for (const c of conflicts) {
    alerts.push({
      type: 'harvest_conflict',
      severity: c.risk_level,
      crop: c.crop,
      message: c.message,
      details: { week: c.week, farm_count: c.farm_count, farms: c.farms }
    });
  }

  for (const g of balance.gaps) {
    alerts.push({
      type: 'supply_gap',
      severity: g.severity === 'critical' ? 'high' : 'medium',
      crop: g.crop,
      message: `Supply gap: ${g.crop} — demand ${g.monthly_demand}/mo, supply ${g.projected_supply}/mo (shortfall: ${g.shortfall})`,
      details: g
    });
  }

  // T34: Adaptive loss pattern alerts
  const lossAlerts = await detectAdaptiveLossAlerts();
  alerts.push(...lossAlerts);
  if (lossAlerts.length > 0) {
    console.log(`[SupplyDemand] ${lossAlerts.length} adaptive loss alert(s)`);
  }

  return alerts;
}

export default {
  detectHarvestConflicts,
  analyzeSupplyDemand,
  generateNetworkRiskAlerts
};
