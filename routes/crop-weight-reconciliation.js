/**
 * Crop Weight Reconciliation Routes
 * 
 * Records actual harvest weights from full-tray weigh-ins, calculates
 * per-plant and per-tray averages, tracks variance from expected yields,
 * and provides analytics for cross-farm comparison via GreenReach Central.
 *
 * Key design:
 *  - Random tray selection: during harvest, 1-in-N trays flagged for full weigh-in
 *  - Full-tray weighing: weigh the entire cut crop from a registered tray
 *    with known plant locations → avg weight per plant and per tray
 *  - Updates: plant weight benchmarks, inventory yield estimates
 *  - Central sync: data sent to GreenReach Central for cross-farm AI training
 */

import { Router } from 'express';
import path from 'path';
import fs from 'fs';

const router = Router();

// ─── In-memory store (NeDB or SQLite in production) ───────────────────────
const weighInRecords = [];       // All weigh-in records
const cropWeightBenchmarks = {}; // recipe_id → { avgWeightPerPlant, avgWeightPerTray, samples, ... }

// ─── Helpers ──────────────────────────────────────────────────────────────

function generateWeighInId() {
  return `WI-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Decide if a tray should be flagged for weigh-in during harvest.
 * Crops without verified benchmarks: 80% chance (configurable).
 * Crops with verified benchmarks: 20% chance (maintenance sampling).
 * @param {string} cropKey - recipe_id or crop name
 */
function shouldWeighTray(cropKey) {
  const hasVerified = hasCropBenchmark(cropKey);
  const ratio = hasVerified
    ? (parseFloat(process.env.WEIGH_IN_RATIO_VERIFIED) || 0.20)
    : (parseFloat(process.env.WEIGH_IN_RATIO_UNVERIFIED) || 0.80);
  return Math.random() < ratio;
}

/**
 * Given a weigh-in record, update the running benchmark for that crop/recipe.
 */
function updateBenchmark(record) {
  const key = record.recipe_id || record.crop_name || 'unknown';
  if (!cropWeightBenchmarks[key]) {
    cropWeightBenchmarks[key] = {
      recipe_id: record.recipe_id,
      crop_name: record.crop_name,
      tray_format: record.tray_format_name,
      system_type: record.system_type,
      samples: [],
      avg_weight_per_plant_oz: 0,
      avg_weight_per_tray_oz: 0,
      min_weight_per_plant_oz: Infinity,
      max_weight_per_plant_oz: 0,
      updated_at: null
    };
  }

  const bm = cropWeightBenchmarks[key];
  bm.samples.push({
    weigh_in_id: record.weigh_in_id,
    weight_per_plant_oz: record.weight_per_plant_oz,
    weight_per_tray_oz: record.total_weight_oz,
    grow_days: record.grow_days,
    zone: record.zone,
    recorded_at: record.recorded_at
  });

  // Recalculate rolling averages
  const n = bm.samples.length;
  const totalPerPlant = bm.samples.reduce((s, x) => s + x.weight_per_plant_oz, 0);
  const totalPerTray = bm.samples.reduce((s, x) => s + x.weight_per_tray_oz, 0);
  bm.avg_weight_per_plant_oz = +(totalPerPlant / n).toFixed(3);
  bm.avg_weight_per_tray_oz = +(totalPerTray / n).toFixed(2);
  bm.min_weight_per_plant_oz = Math.min(...bm.samples.map(s => s.weight_per_plant_oz));
  bm.max_weight_per_plant_oz = Math.max(...bm.samples.map(s => s.weight_per_plant_oz));
  bm.updated_at = new Date().toISOString();
}

// ─── Endpoints ────────────────────────────────────────────────────────────

/**
 * GET /api/crop-weights/should-weigh
 * Called during harvest to determine if a tray should be weighed.
 * Query: ?tray_run_id=xxx
 * Returns: { shouldWeigh: bool, reason: string }
 */
router.get('/should-weigh', (req, res) => {
  const { tray_run_id, crop_name, recipe_id } = req.query;
  const cropKey = recipe_id || crop_name || null;
  const weigh = shouldWeighTray(cropKey);
  const hasVerified = cropKey ? hasCropBenchmark(cropKey) : false;
  res.json({
    shouldWeigh: weigh,
    tray_run_id,
    has_verified_weight: hasVerified,
    reason: weigh
      ? (hasVerified
          ? 'Routine sampling to keep weight data accurate for this crop.'
          : 'This crop needs verified weight data — please weigh the full harvest.')
      : 'No weigh-in required for this tray.'
  });
});

/**
 * POST /api/crop-weights/record
 * Record a full-tray weigh-in after harvest.
 * Body: {
 *   tray_run_id, tray_id, recipe_id, crop_name,
 *   tray_format_id, tray_format_name, system_type,
 *   planted_site_count, total_weight_oz, weight_unit,
 *   grow_days, zone, room, environment_data: { temp, humidity, co2, light_hours },
 *   notes
 * }
 */
router.post('/record', (req, res) => {
  try {
    const {
      tray_run_id, tray_id, recipe_id, crop_name,
      tray_format_id, tray_format_name, system_type,
      planted_site_count, total_weight_oz, weight_unit,
      grow_days, zone, room,
      environment_data, notes
    } = req.body;

    // Validate required fields
    if (!tray_run_id || !total_weight_oz || !planted_site_count) {
      return res.status(400).json({
        error: 'Missing required fields: tray_run_id, total_weight_oz, planted_site_count'
      });
    }

    const plantCount = parseInt(planted_site_count) || 1;
    const totalOz = parseFloat(total_weight_oz);
    const weightPerPlant = totalOz / plantCount;

    // Look up existing benchmark to calculate variance
    const benchmarkKey = recipe_id || crop_name || 'unknown';
    const existingBenchmark = cropWeightBenchmarks[benchmarkKey];
    let variance_pct = null;
    if (existingBenchmark && existingBenchmark.avg_weight_per_plant_oz > 0) {
      variance_pct = +((weightPerPlant - existingBenchmark.avg_weight_per_plant_oz) /
        existingBenchmark.avg_weight_per_plant_oz * 100).toFixed(1);
    }

    const record = {
      weigh_in_id: generateWeighInId(),
      tray_run_id,
      tray_id: tray_id || null,
      recipe_id: recipe_id || null,
      crop_name: crop_name || null,
      tray_format_id: tray_format_id || null,
      tray_format_name: tray_format_name || null,
      system_type: system_type || null,
      planted_site_count: plantCount,
      total_weight_oz: totalOz,
      weight_unit: weight_unit || 'oz',
      weight_per_plant_oz: +weightPerPlant.toFixed(3),
      grow_days: grow_days ? parseInt(grow_days) : null,
      zone: zone || null,
      room: room || null,
      environment_data: environment_data || {},
      variance_pct,
      notes: notes || '',
      farm_id: req.headers['x-farm-id'] || req.query.farm_id || null,
      recorded_at: new Date().toISOString(),
      recorded_by: req.headers['x-user-id'] || 'activity-hub'
    };

    weighInRecords.push(record);
    updateBenchmark(record);

    console.log(`[crop-weights] Weigh-in recorded: ${record.crop_name || record.recipe_id} → ${totalOz} oz / ${plantCount} plants = ${record.weight_per_plant_oz} oz/plant (variance: ${variance_pct ?? 'N/A'}%)`);

    // Persist to JSON file as backup
    try {
      const dataDir = path.join(process.cwd(), 'data');
      if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
      const filePath = path.join(dataDir, 'crop-weight-records.json');
      fs.writeFileSync(filePath, JSON.stringify(weighInRecords, null, 2));
    } catch (e) {
      console.warn('[crop-weights] Could not persist to file:', e.message);
    }

    res.json({
      success: true,
      weigh_in_id: record.weigh_in_id,
      weight_per_plant_oz: record.weight_per_plant_oz,
      weight_per_tray_oz: totalOz,
      variance_pct,
      benchmark: existingBenchmark ? {
        avg_weight_per_plant_oz: existingBenchmark.avg_weight_per_plant_oz,
        sample_count: existingBenchmark.samples.length
      } : null,
      message: variance_pct !== null
        ? `${Math.abs(variance_pct)}% ${variance_pct >= 0 ? 'above' : 'below'} average`
        : 'First weigh-in for this crop — baseline established'
    });
  } catch (error) {
    console.error('[crop-weights] Error recording weigh-in:', error);
    res.status(500).json({ error: 'Failed to record weigh-in', details: error.message });
  }
});

/**
 * GET /api/crop-weights/records
 * List all weigh-in records with optional filtering.
 * Query: ?recipe_id=x, ?crop_name=x, ?days=30, ?limit=100
 */
router.get('/records', (req, res) => {
  let records = [...weighInRecords];

  if (req.query.recipe_id) {
    records = records.filter(r => r.recipe_id === req.query.recipe_id);
  }
  if (req.query.crop_name) {
    records = records.filter(r => (r.crop_name || '').toLowerCase().includes(req.query.crop_name.toLowerCase()));
  }
  if (req.query.days) {
    const cutoff = Date.now() - parseInt(req.query.days) * 86400000;
    records = records.filter(r => new Date(r.recorded_at).getTime() >= cutoff);
  }

  // Sort newest first
  records.sort((a, b) => new Date(b.recorded_at) - new Date(a.recorded_at));

  const limit = parseInt(req.query.limit) || 100;
  res.json({
    total: records.length,
    records: records.slice(0, limit)
  });
});

/**
 * GET /api/crop-weights/benchmarks
 * Get per-crop weight benchmarks (averages, min, max, sample count).
 */
router.get('/benchmarks', (req, res) => {
  const benchmarks = Object.values(cropWeightBenchmarks).map(bm => ({
    recipe_id: bm.recipe_id,
    crop_name: bm.crop_name,
    tray_format: bm.tray_format,
    system_type: bm.system_type,
    avg_weight_per_plant_oz: bm.avg_weight_per_plant_oz,
    avg_weight_per_tray_oz: bm.avg_weight_per_tray_oz,
    min_weight_per_plant_oz: bm.min_weight_per_plant_oz === Infinity ? 0 : bm.min_weight_per_plant_oz,
    max_weight_per_plant_oz: bm.max_weight_per_plant_oz,
    sample_count: bm.samples.length,
    updated_at: bm.updated_at
  }));

  res.json({ benchmarks });
});

/**
 * GET /api/crop-weights/analytics
 * Detailed analytics for Central comparison dashboard.
 * Groups by crop, environment, grow time, tray type.
 * Query: ?group_by=crop|system_type|zone|grow_days_bucket
 */
router.get('/analytics', (req, res) => {
  const groupBy = req.query.group_by || 'crop';
  const records = [...weighInRecords];

  if (records.length === 0) {
    return res.json({ group_by: groupBy, groups: [], total_records: 0 });
  }

  // Group records
  const groups = {};
  for (const r of records) {
    let key;
    switch (groupBy) {
      case 'system_type':
        key = r.system_type || 'unknown';
        break;
      case 'zone':
        key = r.zone || 'unknown';
        break;
      case 'grow_days_bucket':
        if (!r.grow_days) { key = 'unknown'; break; }
        if (r.grow_days <= 14) key = '1-14 days';
        else if (r.grow_days <= 28) key = '15-28 days';
        else if (r.grow_days <= 42) key = '29-42 days';
        else key = '43+ days';
        break;
      case 'tray_format':
        key = r.tray_format_name || 'unknown';
        break;
      case 'crop':
      default:
        key = r.crop_name || r.recipe_id || 'unknown';
    }

    if (!groups[key]) {
      groups[key] = {
        key,
        records: [],
        avg_weight_per_plant_oz: 0,
        avg_weight_per_tray_oz: 0,
        total_weight_oz: 0,
        sample_count: 0
      };
    }
    groups[key].records.push(r);
    groups[key].sample_count++;
  }

  // Calculate aggregates
  const result = Object.values(groups).map(g => {
    const totalPerPlant = g.records.reduce((s, r) => s + r.weight_per_plant_oz, 0);
    const totalPerTray = g.records.reduce((s, r) => s + r.total_weight_oz, 0);
    return {
      key: g.key,
      sample_count: g.sample_count,
      avg_weight_per_plant_oz: +(totalPerPlant / g.sample_count).toFixed(3),
      avg_weight_per_tray_oz: +(totalPerTray / g.sample_count).toFixed(2),
      total_weight_oz: +totalPerTray.toFixed(2),
      min_per_plant_oz: +Math.min(...g.records.map(r => r.weight_per_plant_oz)).toFixed(3),
      max_per_plant_oz: +Math.max(...g.records.map(r => r.weight_per_plant_oz)).toFixed(3),
      std_dev_per_plant_oz: g.sample_count > 1
        ? +Math.sqrt(
            g.records.reduce((sum, r) => sum + Math.pow(r.weight_per_plant_oz - (totalPerPlant / g.sample_count), 2), 0)
            / (g.sample_count - 1)
          ).toFixed(3)
        : 0,
      // Include environment averages if available
      avg_environment: g.records.some(r => r.environment_data?.temp) ? {
        temp: +(g.records.filter(r => r.environment_data?.temp).reduce((s, r) => s + r.environment_data.temp, 0) /
          g.records.filter(r => r.environment_data?.temp).length).toFixed(1),
        humidity: +(g.records.filter(r => r.environment_data?.humidity).reduce((s, r) => s + r.environment_data.humidity, 0) /
          g.records.filter(r => r.environment_data?.humidity).length || 0).toFixed(1),
      } : null,
      recent_trend: g.records.length >= 3
        ? g.records.slice(-3).map(r => r.weight_per_plant_oz)
        : null
    };
  });

  result.sort((a, b) => b.sample_count - a.sample_count);

  res.json({
    group_by: groupBy,
    groups: result,
    total_records: records.length,
    generated_at: new Date().toISOString()
  });
});

/**
 * GET /api/crop-weights/ai-training-export
 * Export all weight data in a flat format optimized for AI/ML training.
 * Each row = one weigh-in with all context columns.
 */
router.get('/ai-training-export', (req, res) => {
  const format = req.query.format || 'json';

  const rows = weighInRecords.map(r => ({
    weigh_in_id: r.weigh_in_id,
    farm_id: r.farm_id,
    crop_name: r.crop_name,
    recipe_id: r.recipe_id,
    system_type: r.system_type,
    tray_format: r.tray_format_name,
    planted_site_count: r.planted_site_count,
    total_weight_oz: r.total_weight_oz,
    weight_per_plant_oz: r.weight_per_plant_oz,
    grow_days: r.grow_days,
    zone: r.zone,
    room: r.room,
    temp_f: r.environment_data?.temp || null,
    humidity_pct: r.environment_data?.humidity || null,
    co2_ppm: r.environment_data?.co2 || null,
    light_hours: r.environment_data?.light_hours || null,
    variance_pct: r.variance_pct,
    recorded_at: r.recorded_at
  }));

  if (format === 'csv') {
    if (rows.length === 0) {
      return res.type('text/csv').send('No data');
    }
    const headers = Object.keys(rows[0]);
    const csv = [
      headers.join(','),
      ...rows.map(r => headers.map(h => {
        const v = r[h];
        if (v === null || v === undefined) return '';
        if (typeof v === 'string' && v.includes(',')) return `"${v}"`;
        return v;
      }).join(','))
    ].join('\n');

    res.setHeader('Content-Disposition', 'attachment; filename=crop-weight-training-data.csv');
    return res.type('text/csv').send(csv);
  }

  res.json({
    schema_version: '1.0',
    export_date: new Date().toISOString(),
    total_records: rows.length,
    columns: rows.length > 0 ? Object.keys(rows[0]) : [],
    data: rows
  });
});

/**
 * POST /api/crop-weights/bulk-import
 * Import weigh-in data from Central (for multi-farm aggregation).
 */
router.post('/bulk-import', (req, res) => {
  const { records: incoming } = req.body;
  if (!Array.isArray(incoming)) {
    return res.status(400).json({ error: 'Expected { records: [...] }' });
  }

  let imported = 0;
  for (const r of incoming) {
    if (r.total_weight_oz && r.planted_site_count) {
      const record = {
        ...r,
        weigh_in_id: r.weigh_in_id || generateWeighInId(),
        weight_per_plant_oz: r.weight_per_plant_oz || +(r.total_weight_oz / r.planted_site_count).toFixed(3),
        imported: true,
        imported_at: new Date().toISOString()
      };
      weighInRecords.push(record);
      updateBenchmark(record);
      imported++;
    }
  }

  res.json({ success: true, imported, total: weighInRecords.length });
});

// ─── Load persisted data on startup ───────────────────────────────────────
try {
  const filePath = path.join(process.cwd(), 'data', 'crop-weight-records.json');
  if (fs.existsSync(filePath)) {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (Array.isArray(data)) {
      weighInRecords.push(...data);
      data.forEach(r => updateBenchmark(r));
      console.log(`[crop-weights] Loaded ${data.length} historical weigh-in records`);
    }
  }
} catch (e) {
  console.warn('[crop-weights] Could not load historical data:', e.message);
}

export default router;

/**
 * Look up the verified benchmark weight for a crop/recipe.
 * Returns { avg_weight_per_plant_oz, avg_weight_per_tray_oz, sample_count } or null.
 */
export function getCropBenchmark(cropKey) {
  if (!cropKey) return null;
  const key = cropKey.toLowerCase().trim();
  // Try exact match first, then case-insensitive scan
  const bm = cropWeightBenchmarks[cropKey] || cropWeightBenchmarks[key]
    || Object.values(cropWeightBenchmarks).find(b =>
      (b.recipe_id || '').toLowerCase() === key ||
      (b.crop_name || '').toLowerCase() === key
    );
  if (!bm || bm.samples.length === 0) return null;
  return {
    avg_weight_per_plant_oz: bm.avg_weight_per_plant_oz,
    avg_weight_per_tray_oz: bm.avg_weight_per_tray_oz,
    sample_count: bm.samples.length,
    verified: bm.samples.length >= 1
  };
}

/**
 * Check whether a crop has verified weight data from reconciliation.
 */
export function hasCropBenchmark(cropKey) {
  return getCropBenchmark(cropKey) !== null;
}

/**
 * Get all crop keys that have verified benchmarks.
 */
export function getVerifiedCrops() {
  return Object.keys(cropWeightBenchmarks).filter(k =>
    cropWeightBenchmarks[k].samples.length > 0
  );
}