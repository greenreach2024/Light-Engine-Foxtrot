/**
 * Weekly KPI Dashboard API — Phase 2, Ticket 2.4
 * 
 * GET /api/kpis           — returns the 7 core business metrics
 * GET /api/kpis/history   — returns weekly KPI snapshots (future)
 * 
 * Metrics:
 *   1. fill_rate           — % of orders fully fulfilled
 *   2. otif                — on-time-in-full delivery rate
 *   3. contribution_margin — revenue minus tracked variable costs
 *   4. loss_rate           — fraction of planted sites lost
 *   5. forecast_error      — |predicted - actual| / predicted yield
 *   6. labor_minutes_per_kg — labor time per kg harvested (placeholder)
 *   7. input_reduction     — % of fields auto-filled vs manual
 */

import express from 'express';

const router = express.Router();

/**
 * GET /api/kpis
 * Compute and return the 7 core KPIs from available data sources.
 */
router.get('/', async (req, res) => {
  try {
    const stores = req.app.get('farmStores') || {};
    const kpis = {};

    // ── 1. Fill Rate ────────────────────────────────────────────────────
    // Ratio of fulfilled / total from farm-sales orders (NeDB)
    try {
      const allOrders = stores.orders?.getAll?.() || [];
      const total = allOrders.length;
      const fulfilled = allOrders.filter(o =>
        o.status === 'fulfilled' || o.status === 'completed'
      ).length;
      kpis.fill_rate = {
        value: total > 0 ? +((fulfilled / total) * 100).toFixed(1) : null,
        unit: '%',
        numerator: fulfilled,
        denominator: total,
        source: 'farm_sales_orders'
      };
    } catch (_) {
      kpis.fill_rate = { value: null, unit: '%', source: 'unavailable' };
    }

    // ── 2. OTIF (On Time In Full) ────────────────────────────────────────
    // Stubbed — requires comparing requested_delivery_date vs actual.
    // Will be computed once delivery confirmation timestamps are tracked.
    kpis.otif = {
      value: null,
      unit: '%',
      source: 'not_yet_instrumented',
      note: 'Requires delivery timestamp vs. requested date comparison'
    };

    // ── 3. Contribution Margin ──────────────────────────────────────────
    // Revenue from orders minus energy costs from harvest records
    try {
      const allOrders = stores.orders?.getAll?.() || [];
      const revenue = allOrders.reduce((sum, o) => sum + (o.payment?.amount || 0), 0);

      // Variable cost: energy cost per crop from harvest outcomes (if tracked)
      // Currently only revenue is reliably available
      kpis.contribution_margin = {
        value: revenue > 0 ? +revenue.toFixed(2) : null,
        unit: 'USD',
        revenue,
        variable_costs: null,
        source: 'farm_sales_orders',
        note: 'Variable costs not yet unified — showing gross revenue only'
      };
    } catch (_) {
      kpis.contribution_margin = { value: null, unit: 'USD', source: 'unavailable' };
    }

    // ── 4. Loss Rate ────────────────────────────────────────────────────
    // Aggregate from harvestOutcomesDB loss_rate field
    try {
      const port = process.env.PORT || 8091;
      const statsRes = await fetch(`http://localhost:${port}/api/harvest/experiment-stats`, {
        signal: AbortSignal.timeout(3000)
      });
      if (statsRes.ok) {
        const statsData = await statsRes.json();
        const crops = statsData.crops || statsData.data?.crops || [];
        if (crops.length > 0) {
          const totalPlanted = crops.reduce((s, c) => s + (c.total_planted || 0), 0);
          const totalLost = crops.reduce((s, c) => s + (c.total_lost || 0), 0);
          kpis.loss_rate = {
            value: totalPlanted > 0 ? +((totalLost / totalPlanted) * 100).toFixed(1) : 0,
            unit: '%',
            total_planted: totalPlanted,
            total_lost: totalLost,
            crops_tracked: crops.length,
            source: 'harvest_outcomes'
          };
        } else {
          kpis.loss_rate = { value: null, unit: '%', source: 'no_harvest_data' };
        }
      } else {
        kpis.loss_rate = { value: null, unit: '%', source: 'api_error' };
      }
    } catch (_) {
      // Fallback: try to query tray runs directly
      kpis.loss_rate = { value: null, unit: '%', source: 'unavailable' };
    }

    // ── 5. Forecast Error ───────────────────────────────────────────────
    // |target_weight_oz - actual_weight| / target_weight_oz per tray run
    try {
      const port = process.env.PORT || 8091;
      const runsRes = await fetch(`http://localhost:${port}/api/harvest/experiment-records?limit=200`, {
        signal: AbortSignal.timeout(3000)
      });
      if (runsRes.ok) {
        const runsData = await runsRes.json();
        const records = runsData.records || runsData.data || [];
        const withForecast = records.filter(r =>
          r.target_weight_oz && r.total_weight_oz && r.target_weight_oz > 0
        );
        if (withForecast.length > 0) {
          const errors = withForecast.map(r =>
            Math.abs(r.total_weight_oz - r.target_weight_oz) / r.target_weight_oz
          );
          const avgError = errors.reduce((a, b) => a + b, 0) / errors.length;
          kpis.forecast_error = {
            value: +(avgError * 100).toFixed(1),
            unit: '%',
            sample_size: withForecast.length,
            source: 'experiment_records'
          };
        } else {
          kpis.forecast_error = { value: null, unit: '%', source: 'no_forecast_data' };
        }
      } else {
        kpis.forecast_error = { value: null, unit: '%', source: 'api_error' };
      }
    } catch (_) {
      kpis.forecast_error = { value: null, unit: '%', source: 'unavailable' };
    }

    // ── 6. Labor Minutes / kg ────────────────────────────────────────────
    // No labor tracking exists yet — placeholder
    kpis.labor_minutes_per_kg = {
      value: null,
      unit: 'min/kg',
      source: 'not_yet_instrumented',
      note: 'Labor time tracking not yet implemented'
    };

    // ── 7. User-Input Reduction ──────────────────────────────────────────
    // Ratio of auto-filled plant counts vs manual entries
    try {
      const port = process.env.PORT || 8091;
      const trainRes = await fetch(`http://localhost:${port}/api/tray-runs/summary`, {
        signal: AbortSignal.timeout(3000)
      }).catch(() => null);

      // Fallback: compute from available tray run data
      kpis.input_reduction = {
        value: null,
        unit: '%',
        source: 'partial',
        tracked_fields: ['plant_count_source', 'target_weight_source'],
        note: 'Only plant_count auto-fill tracked. More fields to be instrumented.'
      };
    } catch (_) {
      kpis.input_reduction = { value: null, unit: '%', source: 'unavailable' };
    }

    res.json({
      ok: true,
      generated_at: new Date().toISOString(),
      period: 'current',
      kpis
    });

  } catch (error) {
    console.error('[KPIs] Error computing KPIs:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * GET /api/kpis/history
 * Placeholder for weekly KPI snapshots (to be persisted by a scheduler).
 */
router.get('/history', (req, res) => {
  res.json({
    ok: true,
    snapshots: [],
    note: 'Weekly KPI snapshots will be stored once the scheduler is implemented.'
  });
});

export default router;
