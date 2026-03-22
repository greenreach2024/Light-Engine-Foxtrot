/**
 * Lot System Routes
 * Handles lot generation, harvest events, traceability, and label printing.
 * Covers: lot numbering, harvest-to-lot creation, lot-to-inventory linkage,
 * quality grading, best-by dates, label generation, and SFCR export.
 */
import express from 'express';
import fs from 'fs';
import path from 'path';
import { query, isDatabaseAvailable } from '../config/database.js';
import logger from '../utils/logger.js';

const router = express.Router();

// Load crop registry for shelf-life and yield data
let cropRegistryCache = null;
function getCropRegistry() {
  if (cropRegistryCache) return cropRegistryCache;
  try {
    const crPath = path.join(process.cwd(), 'public', 'data', 'crop-registry.json');
    if (fs.existsSync(crPath)) {
      cropRegistryCache = JSON.parse(fs.readFileSync(crPath, 'utf8')).crops || {};
    }
  } catch (_) { /* optional */ }
  return cropRegistryCache || {};
}

// ─── Lot Number Generation ───────────────────────────────────────────
// Format: <FARM_PREFIX>-<YYYYMMDD>-<SEQ>
// Example: GR-20260322-001
// Guaranteed unique via DB UNIQUE constraint on lot_number.

async function generateLotNumber(farmId, harvestDate) {
  const dateStr = harvestDate.toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = farmId.length > 4 ? farmId.slice(0, 4).toUpperCase() : farmId.toUpperCase();
  const pattern = `${prefix}-${dateStr}-%`;

  const result = await query(
    'SELECT COUNT(*)::int AS count FROM lot_records WHERE lot_number LIKE $1',
    [pattern]
  );
  const seq = (result.rows[0]?.count || 0) + 1;
  return `${prefix}-${dateStr}-${String(seq).padStart(3, '0')}`;
}

// ─── Shelf Life / Best-By Calculation ────────────────────────────────
// Default shelf life per category (days from harvest)
const SHELF_LIFE_DAYS = {
  lettuce: 10,
  herb: 14,
  microgreens: 7,
  tomato: 14,
  berry: 5,
  default: 10
};

function calculateBestByDate(harvestDate, cropName) {
  const registry = getCropRegistry();
  const entry = registry[cropName];
  const category = entry?.category || 'default';
  const shelfDays = SHELF_LIFE_DAYS[category] || SHELF_LIFE_DAYS.default;
  const bestBy = new Date(harvestDate);
  bestBy.setDate(bestBy.getDate() + shelfDays);
  return bestBy;
}

// ─── POST /api/lots/harvest ──────────────────────────────────────────
// Record a harvest event and create a lot in one operation.
// Body: { farmId, groupId, cropId, cropName, plantsHarvested,
//         grossWeightOz, netWeightOz, qualityScore, qualityNotes,
//         harvestedBy, seedSource, seedLot }
router.post('/harvest', async (req, res) => {
  try {
    if (!isDatabaseAvailable()) {
      return res.status(503).json({ error: 'Database unavailable' });
    }

    const {
      farmId, groupId, cropId, cropName,
      plantsHarvested, grossWeightOz, netWeightOz,
      qualityScore, qualityNotes, harvestedBy,
      seedSource, seedLot
    } = req.body;

    if (!farmId || !groupId || !cropId) {
      return res.status(400).json({ error: 'farmId, groupId, and cropId are required' });
    }

    const harvestDate = new Date();
    const quality = Math.min(1, Math.max(0, Number(qualityScore) || 0.70));

    // 1. Create harvest event
    const heResult = await query(
      `INSERT INTO harvest_events
        (farm_id, group_id, crop_id, crop_name, harvest_date,
         plants_harvested, gross_weight_oz, net_weight_oz,
         quality_score, quality_notes, harvested_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING id`,
      [
        farmId, groupId, cropId, cropName || cropId,
        harvestDate,
        plantsHarvested || null,
        grossWeightOz || null,
        netWeightOz || null,
        quality,
        qualityNotes || null,
        harvestedBy || null
      ]
    );
    const harvestEventId = heResult.rows[0].id;

    // 2. Look up seed date from planting_assignments
    let seedDate = null;
    const paResult = await query(
      'SELECT seed_date FROM planting_assignments WHERE farm_id = $1 AND group_id = $2',
      [farmId, groupId]
    );
    if (paResult.rows.length > 0) {
      seedDate = paResult.rows[0].seed_date;
    }

    // 3. Generate lot number
    const lotNumber = await generateLotNumber(farmId, harvestDate);

    // 4. Calculate best-by date
    const bestByDate = calculateBestByDate(harvestDate, cropName || cropId);

    // 5. Create lot record
    const weightOz = Number(netWeightOz) || Number(grossWeightOz) || null;
    await query(
      `INSERT INTO lot_records
        (lot_number, farm_id, harvest_event_id, group_id, crop_id, crop_name,
         seed_date, harvest_date, seed_source, seed_lot,
         weight_oz, quality_score, best_by_date, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'active')`,
      [
        lotNumber, farmId, harvestEventId, groupId, cropId,
        cropName || cropId, seedDate, harvestDate,
        seedSource || null, seedLot || null,
        weightOz, quality, bestByDate
      ]
    );

    // 6. Link lot to inventory: update farm_inventory with lot_number
    const productId = (cropName || cropId).toLowerCase().replace(/\s+/g, '-');
    if (weightOz) {
      const weightLbs = Math.round((weightOz / 16) * 100) / 100;
      await query(
        `UPDATE farm_inventory
            SET lot_number = $3,
                quality_score = $4,
                best_by_date = $5,
                harvest_event_id = $6,
                auto_quantity_lbs = COALESCE(auto_quantity_lbs, 0) + $7,
                quantity_available = COALESCE(auto_quantity_lbs, 0) + $7 + COALESCE(manual_quantity_lbs, 0),
                last_updated = NOW()
          WHERE farm_id = $1 AND product_id = $2`,
        [farmId, productId, lotNumber, quality, bestByDate, harvestEventId, weightLbs]
      );
    }

    logger.info(`[LotSystem] Harvest recorded: event=${harvestEventId}, lot=${lotNumber}, farm=${farmId}`);

    res.json({
      success: true,
      harvest_event_id: harvestEventId,
      lot_number: lotNumber,
      best_by_date: bestByDate.toISOString().slice(0, 10),
      quality_score: quality,
      weight_oz: weightOz
    });
  } catch (error) {
    logger.error('[LotSystem] Harvest recording error:', error);
    res.status(500).json({ error: 'Failed to record harvest' });
  }
});

// ─── GET /api/lots/:farmId ───────────────────────────────────────────
// List all lots for a farm, optionally filtered by status or crop.
router.get('/:farmId', async (req, res) => {
  try {
    if (!isDatabaseAvailable()) {
      return res.status(503).json({ error: 'Database unavailable' });
    }

    const { farmId } = req.params;
    const { status, crop, limit } = req.query;
    const maxRows = Math.min(Number(limit) || 100, 500);

    let sql = `SELECT l.*, h.plants_harvested, h.gross_weight_oz, h.net_weight_oz,
                      h.harvested_by, h.quality_notes
                 FROM lot_records l
                 LEFT JOIN harvest_events h ON l.harvest_event_id = h.id
                WHERE l.farm_id = $1`;
    const params = [farmId];
    let paramIdx = 2;

    if (status) {
      sql += ` AND l.status = $${paramIdx++}`;
      params.push(status);
    }
    if (crop) {
      sql += ` AND l.crop_name ILIKE $${paramIdx++}`;
      params.push(`%${crop}%`);
    }
    sql += ` ORDER BY l.harvest_date DESC LIMIT $${paramIdx}`;
    params.push(maxRows);

    const result = await query(sql, params);
    res.json({ success: true, lots: result.rows, count: result.rows.length });
  } catch (error) {
    logger.error('[LotSystem] List lots error:', error);
    res.status(500).json({ error: 'Failed to list lots' });
  }
});

// ─── GET /api/lots/:farmId/lot/:lotNumber ────────────────────────────
// Full traceability view for a single lot.
router.get('/:farmId/lot/:lotNumber', async (req, res) => {
  try {
    if (!isDatabaseAvailable()) {
      return res.status(503).json({ error: 'Database unavailable' });
    }

    const { farmId, lotNumber } = req.params;

    const lotResult = await query(
      `SELECT l.*, h.plants_harvested, h.gross_weight_oz, h.net_weight_oz,
              h.harvested_by, h.quality_notes
         FROM lot_records l
         LEFT JOIN harvest_events h ON l.harvest_event_id = h.id
        WHERE l.farm_id = $1 AND l.lot_number = $2`,
      [farmId, lotNumber]
    );

    if (lotResult.rows.length === 0) {
      return res.status(404).json({ error: 'Lot not found' });
    }

    const lot = lotResult.rows[0];

    // Find any orders referencing this lot (via inventory product_id)
    const productId = (lot.crop_name || lot.crop_id).toLowerCase().replace(/\s+/g, '-');
    const invResult = await query(
      'SELECT product_id, quantity_available, lot_number FROM farm_inventory WHERE farm_id = $1 AND product_id = $2',
      [farmId, productId]
    );

    res.json({
      success: true,
      lot,
      inventory: invResult.rows[0] || null,
      traceability: {
        seed_source: lot.seed_source,
        seed_lot: lot.seed_lot,
        seed_date: lot.seed_date,
        harvest_date: lot.harvest_date,
        lot_number: lot.lot_number,
        quality_score: lot.quality_score,
        best_by_date: lot.best_by_date,
        weight_oz: lot.weight_oz,
        farm_id: lot.farm_id,
        group_id: lot.group_id
      }
    });
  } catch (error) {
    logger.error('[LotSystem] Lot lookup error:', error);
    res.status(500).json({ error: 'Failed to look up lot' });
  }
});

// ─── GET /api/lots/:farmId/harvest-events ────────────────────────────
// List harvest events for a farm.
router.get('/:farmId/harvest-events', async (req, res) => {
  try {
    if (!isDatabaseAvailable()) {
      return res.status(503).json({ error: 'Database unavailable' });
    }

    const { farmId } = req.params;
    const { limit } = req.query;
    const maxRows = Math.min(Number(limit) || 50, 200);

    const result = await query(
      `SELECT * FROM harvest_events WHERE farm_id = $1 ORDER BY harvest_date DESC LIMIT $2`,
      [farmId, maxRows]
    );

    res.json({ success: true, events: result.rows, count: result.rows.length });
  } catch (error) {
    logger.error('[LotSystem] List harvest events error:', error);
    res.status(500).json({ error: 'Failed to list harvest events' });
  }
});

// ─── POST /api/lots/label ────────────────────────────────────────────
// Generate a printable label for a lot.
// Returns structured label data (JSON) or HTML for printing.
router.post('/label', async (req, res) => {
  try {
    if (!isDatabaseAvailable()) {
      return res.status(503).json({ error: 'Database unavailable' });
    }

    const { farmId, lotNumber, format } = req.body;
    if (!farmId || !lotNumber) {
      return res.status(400).json({ error: 'farmId and lotNumber are required' });
    }

    const lotResult = await query(
      'SELECT * FROM lot_records WHERE farm_id = $1 AND lot_number = $2',
      [farmId, lotNumber]
    );
    if (lotResult.rows.length === 0) {
      return res.status(404).json({ error: 'Lot not found' });
    }

    const lot = lotResult.rows[0];
    const weightOz = Number(lot.weight_oz) || 0;
    const weightLbs = Math.round((weightOz / 16) * 100) / 100;

    const labelData = {
      lot_number: lot.lot_number,
      product_name: lot.crop_name,
      farm_id: lot.farm_id,
      harvest_date: lot.harvest_date,
      best_by_date: lot.best_by_date,
      weight_oz: weightOz,
      weight_lbs: weightLbs,
      quality_grade: gradeFromScore(lot.quality_score),
      seed_source: lot.seed_source || 'N/A',
      qr_data: JSON.stringify({
        lot: lot.lot_number,
        crop: lot.crop_name,
        farm: lot.farm_id,
        harvested: lot.harvest_date,
        bestBy: lot.best_by_date
      })
    };

    if (format === 'html') {
      const html = renderLabelHTML(labelData);
      res.setHeader('Content-Type', 'text/html');
      return res.send(html);
    }

    res.json({ success: true, label: labelData });
  } catch (error) {
    logger.error('[LotSystem] Label generation error:', error);
    res.status(500).json({ error: 'Failed to generate label' });
  }
});

// ─── POST /api/lots/packing-slip ─────────────────────────────────────
// Generate a packing slip for an order with lot traceability.
router.post('/packing-slip', async (req, res) => {
  try {
    if (!isDatabaseAvailable()) {
      return res.status(503).json({ error: 'Database unavailable' });
    }

    const { farmId, orderId, items, format } = req.body;
    if (!farmId || !orderId) {
      return res.status(400).json({ error: 'farmId and orderId are required' });
    }

    // For each item, look up the most recent active lot
    const slipItems = [];
    const lineItems = items || [];
    for (const item of lineItems) {
      const cropName = item.sku_name || item.product_name || '';
      const cropId = cropName.toLowerCase().replace(/\s+/g, '-');

      const lotResult = await query(
        `SELECT lot_number, best_by_date, quality_score, harvest_date
           FROM lot_records
          WHERE farm_id = $1 AND crop_id = $2 AND status = 'active'
          ORDER BY harvest_date DESC LIMIT 1`,
        [farmId, cropId]
      );

      const lot = lotResult.rows[0] || null;
      slipItems.push({
        product: cropName,
        quantity: item.qty || item.quantity,
        unit: item.unit || 'lb',
        lot_number: lot?.lot_number || 'N/A',
        harvest_date: lot?.harvest_date || 'N/A',
        best_by_date: lot?.best_by_date || 'N/A',
        quality_grade: lot ? gradeFromScore(lot.quality_score) : 'N/A'
      });
    }

    const slipData = {
      order_id: orderId,
      farm_id: farmId,
      generated_at: new Date().toISOString(),
      items: slipItems
    };

    if (format === 'html') {
      const html = renderPackingSlipHTML(slipData);
      res.setHeader('Content-Type', 'text/html');
      return res.send(html);
    }

    res.json({ success: true, packing_slip: slipData });
  } catch (error) {
    logger.error('[LotSystem] Packing slip error:', error);
    res.status(500).json({ error: 'Failed to generate packing slip' });
  }
});

// ─── GET /api/lots/:farmId/sfcr-export ───────────────────────────────
// SFCR (Safe Food for Canadians Regulations) traceability export.
// Returns all active lots with full chain: seed -> harvest -> lot -> inventory.
router.get('/:farmId/sfcr-export', async (req, res) => {
  try {
    if (!isDatabaseAvailable()) {
      return res.status(503).json({ error: 'Database unavailable' });
    }

    const { farmId } = req.params;
    const { from, to } = req.query;

    let dateSql = '';
    const params = [farmId];
    let paramIdx = 2;
    if (from) {
      dateSql += ` AND l.harvest_date >= $${paramIdx++}`;
      params.push(from);
    }
    if (to) {
      dateSql += ` AND l.harvest_date <= $${paramIdx++}`;
      params.push(to);
    }

    const result = await query(
      `SELECT l.lot_number, l.crop_name, l.seed_source, l.seed_lot,
              l.seed_date, l.harvest_date, l.best_by_date,
              l.weight_oz, l.quality_score, l.status,
              h.plants_harvested, h.gross_weight_oz, h.net_weight_oz,
              h.harvested_by, h.quality_notes,
              pa.notes AS planting_notes
         FROM lot_records l
         LEFT JOIN harvest_events h ON l.harvest_event_id = h.id
         LEFT JOIN planting_assignments pa ON pa.farm_id = l.farm_id AND pa.group_id = l.group_id
        WHERE l.farm_id = $1 ${dateSql}
        ORDER BY l.harvest_date DESC`,
      params
    );

    const records = result.rows.map(row => ({
      lot_number: row.lot_number,
      product: row.crop_name,
      seed_source: row.seed_source || 'Unknown',
      seed_lot: row.seed_lot || 'Unknown',
      seed_date: row.seed_date,
      harvest_date: row.harvest_date,
      best_by_date: row.best_by_date,
      net_weight_oz: row.net_weight_oz || row.weight_oz,
      gross_weight_oz: row.gross_weight_oz,
      quality_score: row.quality_score,
      quality_grade: gradeFromScore(row.quality_score),
      plants_harvested: row.plants_harvested,
      harvested_by: row.harvested_by || 'Unknown',
      quality_notes: row.quality_notes,
      planting_notes: row.planting_notes,
      status: row.status
    }));

    res.json({
      success: true,
      export_type: 'SFCR',
      farm_id: farmId,
      generated_at: new Date().toISOString(),
      date_range: { from: from || 'all', to: to || 'all' },
      record_count: records.length,
      records
    });
  } catch (error) {
    logger.error('[LotSystem] SFCR export error:', error);
    res.status(500).json({ error: 'Failed to generate SFCR export' });
  }
});

// ─── Helpers ─────────────────────────────────────────────────────────

function gradeFromScore(score) {
  const s = Number(score) || 0;
  if (s >= 0.9) return 'A';
  if (s >= 0.75) return 'B';
  if (s >= 0.6) return 'C';
  return 'D';
}

function renderLabelHTML(label) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<title>Lot Label - ${label.lot_number}</title>
<style>
  body { font-family: Arial, sans-serif; margin: 0; padding: 10px; }
  .label { border: 2px solid #333; padding: 12px; width: 4in; }
  .label h2 { margin: 0 0 8px; font-size: 16px; }
  .label .lot { font-size: 20px; font-weight: bold; letter-spacing: 1px; }
  .label table { width: 100%; font-size: 12px; border-collapse: collapse; margin-top: 8px; }
  .label td { padding: 3px 6px; border-bottom: 1px solid #ddd; }
  .label td:first-child { font-weight: bold; width: 40%; }
  @media print { body { margin: 0; } .label { border: none; } }
</style></head>
<body>
<div class="label">
  <h2>${label.product_name}</h2>
  <div class="lot">LOT: ${label.lot_number}</div>
  <table>
    <tr><td>Farm</td><td>${label.farm_id}</td></tr>
    <tr><td>Harvest Date</td><td>${label.harvest_date}</td></tr>
    <tr><td>Best By</td><td>${label.best_by_date}</td></tr>
    <tr><td>Weight</td><td>${label.weight_oz} oz (${label.weight_lbs} lb)</td></tr>
    <tr><td>Grade</td><td>${label.quality_grade}</td></tr>
    <tr><td>Seed Source</td><td>${label.seed_source}</td></tr>
  </table>
</div>
</body></html>`;
}

function renderPackingSlipHTML(slip) {
  const rows = slip.items.map(item => `
    <tr>
      <td>${item.product}</td>
      <td>${item.quantity} ${item.unit}</td>
      <td>${item.lot_number}</td>
      <td>${item.harvest_date}</td>
      <td>${item.best_by_date}</td>
      <td>${item.quality_grade}</td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<title>Packing Slip - ${slip.order_id}</title>
<style>
  body { font-family: Arial, sans-serif; margin: 20px; }
  h1 { font-size: 18px; margin-bottom: 4px; }
  .meta { font-size: 12px; color: #666; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { padding: 6px 10px; border: 1px solid #ccc; text-align: left; }
  th { background: #f5f5f5; font-weight: bold; }
  @media print { body { margin: 10px; } }
</style></head>
<body>
<h1>Packing Slip</h1>
<div class="meta">Order: ${slip.order_id} | Farm: ${slip.farm_id} | Generated: ${slip.generated_at}</div>
<table>
  <thead><tr><th>Product</th><th>Qty</th><th>Lot #</th><th>Harvested</th><th>Best By</th><th>Grade</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
</body></html>`;
}

export default router;
export { generateLotNumber, calculateBestByDate, gradeFromScore };
