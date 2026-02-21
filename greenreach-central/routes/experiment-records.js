/**
 * Experiment Records & Crop Benchmarks Routes
 * AI Vision Phase 1 — Central-Side (Tasks 1.7, 1.8, 1.11, 1.12)
 *
 * Endpoints:
 *   POST /api/sync/experiment-records   — Ingest experiment records from farms
 *   GET  /api/experiment-records        — Query all experiment records
 *   GET  /api/crop-benchmarks           — Get nightly-computed crop benchmarks
 *   POST /api/crop-benchmarks/compute   — Manually trigger benchmark computation
 *
 * Scheduled:
 *   Nightly 2 AM: computeCropBenchmarks() aggregates experiment records per crop
 */
import { Router } from 'express';
import { query, isDatabaseAvailable } from '../config/database.js';

const router = Router();

// ─── POST /api/sync/experiment-records ────────────────────────────────
// Ingest experiment records from individual farms (Task 1.7, Rule 2.2)
// Farms POST on harvest via syncExperimentToCenter()
router.post('/sync/experiment-records', async (req, res) => {
  try {
    const { farm_id, records } = req.body;

    if (!farm_id) {
      return res.status(400).json({ ok: false, error: 'farm_id required' });
    }
    if (!Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ ok: false, error: 'records array required' });
    }

    if (!(await isDatabaseAvailable())) {
      return res.status(503).json({ ok: false, error: 'Database not available' });
    }

    // Ensure farm exists in farms table (auto-register if needed)
    const farmCheck = await query('SELECT farm_id FROM farms WHERE farm_id = $1', [farm_id]);
    if (farmCheck.rows.length === 0) {
      await query(
        `INSERT INTO farms (farm_id, name, status, created_at)
         VALUES ($1, $2, 'active', NOW())
         ON CONFLICT (farm_id) DO NOTHING`,
        [farm_id, farm_id]
      );
    }

    let ingested = 0;
    for (const record of records) {
      try {
        // Validate canonical schema fields (Rule 3.1)
        if (!record.crop) {
          console.warn(`[ExperimentRecords] Skipping record without crop from ${farm_id}`);
          continue;
        }

        await query(
          `INSERT INTO experiment_records
           (farm_id, crop, recipe_id, grow_days, planned_grow_days,
            recipe_params_avg, environment_achieved_avg, outcomes,
            farm_context, recorded_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            farm_id,
            record.crop,
            record.recipe_id || null,
            record.grow_days || null,
            record.planned_grow_days || null,
            JSON.stringify(record.recipe_params_avg || {}),
            JSON.stringify(record.environment_achieved_avg || {}),
            JSON.stringify(record.outcomes || {}),
            JSON.stringify(record.farm_context || {}),
            record.recorded_at || new Date().toISOString()
          ]
        );
        ingested++;
      } catch (recErr) {
        console.warn(`[ExperimentRecords] Failed to insert record:`, recErr.message);
      }
    }

    console.log(`[ExperimentRecords] ✓ Ingested ${ingested}/${records.length} records from ${farm_id}`);

    res.json({
      ok: true,
      ingested,
      total_submitted: records.length,
      farm_id
    });
  } catch (error) {
    console.error('[ExperimentRecords] Ingest error:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ─── GET /api/experiment-records ──────────────────────────────────────
// Query experiment records across all farms
router.get('/experiment-records', async (req, res) => {
  try {
    if (!(await isDatabaseAvailable())) {
      return res.json({ ok: true, records: [], total: 0 });
    }

    const { crop, farm_id, since, limit } = req.query;
    const maxRows = parseInt(limit) || 500;
    let sql = 'SELECT * FROM experiment_records WHERE 1=1';
    const params = [];

    if (crop) {
      params.push(crop);
      sql += ` AND crop = $${params.length}`;
    }
    if (farm_id) {
      params.push(farm_id);
      sql += ` AND farm_id = $${params.length}`;
    }
    if (since) {
      params.push(since);
      sql += ` AND recorded_at >= $${params.length}`;
    }

    sql += ' ORDER BY recorded_at DESC';
    params.push(maxRows);
    sql += ` LIMIT $${params.length}`;

    const result = await query(sql, params);

    res.json({
      ok: true,
      total: result.rows.length,
      records: result.rows.map(r => ({
        id: r.id,
        farm_id: r.farm_id,
        crop: r.crop,
        recipe_id: r.recipe_id,
        grow_days: r.grow_days,
        planned_grow_days: r.planned_grow_days,
        recipe_params_avg: r.recipe_params_avg,
        environment_achieved_avg: r.environment_achieved_avg,
        outcomes: r.outcomes,
        farm_context: r.farm_context,
        recorded_at: r.recorded_at,
        ingested_at: r.ingested_at
      }))
    });
  } catch (error) {
    console.error('[ExperimentRecords] Query error:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ─── GET /api/crop-benchmarks ─────────────────────────────────────────
// Return nightly-computed crop benchmarks (Task 1.8)
router.get('/crop-benchmarks', async (req, res) => {
  try {
    if (!(await isDatabaseAvailable())) {
      return res.json({ ok: true, benchmarks: [] });
    }

    const result = await query(
      'SELECT * FROM crop_benchmarks ORDER BY harvest_count DESC'
    );

    res.json({
      ok: true,
      benchmarks: result.rows.map(r => ({
        crop: r.crop,
        farm_count: r.farm_count,
        harvest_count: r.harvest_count,
        avg_weight_per_plant_oz: parseFloat(r.avg_weight_per_plant_oz),
        min_weight_per_plant_oz: parseFloat(r.min_weight_per_plant_oz),
        max_weight_per_plant_oz: parseFloat(r.max_weight_per_plant_oz),
        avg_grow_days: parseFloat(r.avg_grow_days),
        avg_loss_rate: parseFloat(r.avg_loss_rate),
        avg_temp_c: parseFloat(r.avg_temp_c),
        avg_humidity_pct: parseFloat(r.avg_humidity_pct),
        avg_ppfd: parseFloat(r.avg_ppfd),
        computed_at: r.computed_at
      }))
    });
  } catch (error) {
    console.error('[CropBenchmarks] Query error:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ─── POST /api/crop-benchmarks/compute ────────────────────────────────
// Manually trigger benchmark computation (also called by nightly job)
router.post('/crop-benchmarks/compute', async (req, res) => {
  try {
    const result = await computeCropBenchmarks();
    res.json({ ok: true, ...result });
  } catch (error) {
    console.error('[CropBenchmarks] Compute error:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * Compute Crop Benchmarks (Task 1.8)
 * Aggregates experiment records per crop across ALL farms.
 * Network benchmarks — anonymized, no farm identity exposed (Rule 7.1).
 */
export async function computeCropBenchmarks() {
  if (!(await isDatabaseAvailable())) {
    console.log('[CropBenchmarks] Database not available — skipping');
    return { computed: 0 };
  }

  console.log('[CropBenchmarks] Computing nightly crop benchmarks...');

  try {
    const result = await query(`
      SELECT
        crop,
        COUNT(DISTINCT farm_id) AS farm_count,
        COUNT(*) AS harvest_count,
        AVG((outcomes->>'weight_per_plant_oz')::DECIMAL) AS avg_weight,
        MIN((outcomes->>'weight_per_plant_oz')::DECIMAL) AS min_weight,
        MAX((outcomes->>'weight_per_plant_oz')::DECIMAL) AS max_weight,
        AVG(grow_days) AS avg_grow_days,
        AVG((outcomes->>'loss_rate')::DECIMAL) AS avg_loss_rate,
        AVG((recipe_params_avg->>'temp_c')::DECIMAL) AS avg_temp_c,
        AVG((recipe_params_avg->>'humidity_pct')::DECIMAL) AS avg_humidity_pct,
        AVG((recipe_params_avg->>'ppfd')::DECIMAL) AS avg_ppfd
      FROM experiment_records
      WHERE outcomes->>'weight_per_plant_oz' IS NOT NULL
      GROUP BY crop
    `);

    let computed = 0;
    for (const row of result.rows) {
      await query(`
        INSERT INTO crop_benchmarks
          (crop, farm_count, harvest_count, avg_weight_per_plant_oz,
           min_weight_per_plant_oz, max_weight_per_plant_oz,
           avg_grow_days, avg_loss_rate, avg_temp_c, avg_humidity_pct, avg_ppfd, computed_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
        ON CONFLICT (crop) DO UPDATE SET
          farm_count = $2, harvest_count = $3,
          avg_weight_per_plant_oz = $4, min_weight_per_plant_oz = $5,
          max_weight_per_plant_oz = $6, avg_grow_days = $7,
          avg_loss_rate = $8, avg_temp_c = $9, avg_humidity_pct = $10,
          avg_ppfd = $11, computed_at = NOW()
      `, [
        row.crop,
        parseInt(row.farm_count),
        parseInt(row.harvest_count),
        row.avg_weight ? parseFloat(row.avg_weight).toFixed(3) : null,
        row.min_weight ? parseFloat(row.min_weight).toFixed(3) : null,
        row.max_weight ? parseFloat(row.max_weight).toFixed(3) : null,
        row.avg_grow_days ? parseFloat(row.avg_grow_days).toFixed(1) : null,
        row.avg_loss_rate ? parseFloat(row.avg_loss_rate).toFixed(3) : null,
        row.avg_temp_c ? parseFloat(row.avg_temp_c).toFixed(1) : null,
        row.avg_humidity_pct ? parseFloat(row.avg_humidity_pct).toFixed(1) : null,
        row.avg_ppfd ? parseFloat(row.avg_ppfd).toFixed(1) : null,
      ]);
      computed++;
    }

    console.log(`[CropBenchmarks] ✓ Computed benchmarks for ${computed} crop(s) from ${result.rows.length} aggregate rows`);
    return { computed, crops: result.rows.map(r => r.crop) };
  } catch (error) {
    console.error('[CropBenchmarks] Compute failed:', error);
    return { computed: 0, error: error.message };
  }
}

/**
 * getCropBenchmarksForPush() — used by AI recommendations pusher (Task 1.9)
 * Returns benchmarks formatted for the network_intelligence payload.
 */
export async function getCropBenchmarksForPush() {
  if (!(await isDatabaseAvailable())) return {};

  try {
    const result = await query(
      'SELECT * FROM crop_benchmarks WHERE harvest_count >= 1 ORDER BY harvest_count DESC'
    );

    const benchmarks = {};
    for (const row of result.rows) {
      benchmarks[row.crop] = {
        network_avg_weight: parseFloat(row.avg_weight_per_plant_oz) || 0,
        network_min_weight: parseFloat(row.min_weight_per_plant_oz) || 0,
        network_max_weight: parseFloat(row.max_weight_per_plant_oz) || 0,
        network_avg_grow_days: parseFloat(row.avg_grow_days) || 0,
        network_avg_loss_rate: parseFloat(row.avg_loss_rate) || 0,
        network_optimal_temp_c: parseFloat(row.avg_temp_c) || null,
        network_optimal_humidity_pct: parseFloat(row.avg_humidity_pct) || null,
        network_optimal_ppfd: parseFloat(row.avg_ppfd) || null,
        contributing_farms: parseInt(row.farm_count) || 0,
        harvest_count: parseInt(row.harvest_count) || 0,
        computed_at: row.computed_at
      };
    }

    return benchmarks;
  } catch (error) {
    console.error('[CropBenchmarks] Failed to get benchmarks for push:', error);
    return {};
  }
}

/**
 * Start nightly benchmark scheduler (Task 1.8)
 * Runs at 2:00 AM daily.
 */
export function startBenchmarkScheduler() {
  function scheduleNext() {
    const now = new Date();
    const next = new Date(now);
    next.setHours(2, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    const delay = next.getTime() - now.getTime();

    setTimeout(async () => {
      await computeCropBenchmarks();
      scheduleNext(); // Reschedule
    }, delay);

    const hoursUntil = (delay / 1000 / 3600).toFixed(1);
    console.log(`[CropBenchmarks] Next benchmark computation in ${hoursUntil}h`);
  }

  // Compute once on startup, then schedule nightly
  computeCropBenchmarks().then(() => scheduleNext());
}

export default router;
