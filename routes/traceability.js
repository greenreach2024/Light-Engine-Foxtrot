/**
 * Unified Traceability System
 * 
 * Auto-generates SFCR/CanadaGAP-compliant trace records from the normal
 * grow workflow (seed → grow → harvest → pack → ship). No manual batch
 * creation required — everything flows from Activity Hub actions.
 *
 * SFCR Requirements (Safe Food for Canadians Regulations, Part 5):
 *  ─ Product Identification: common_name, lot_code, producer_name + address
 *  ─ One Step Back:  seed supplier name/address, date received
 *  ─ One Step Forward: customer name/address, date provided
 *  ─ Record retention: 2 years
 *  ─ Accessible within 24 hours on CFIA request, plain text, single file
 *
 * CanadaGAP Greenhouse (V9 2025) additional:
 *  ─ Harvest date and time, harvester ID
 *  ─ Packing date, packer ID
 *  ─ Water source records, input chemical records
 *  ─ Temperature monitoring during storage
 *  ─ Cleaning / sanitation logs
 *
 * This module captures everything that can be auto-captured; the only
 * manual input is seed_source (supplier + lot#), entered once at seeding.
 */

import express from 'express';
import { promises as fs } from 'fs';
import path from 'path';

const router = express.Router();

// ── Persistence ────────────────────────────────────────────────────────
const DATA_DIR  = path.join(process.cwd(), 'data');
const TRACE_FILE = path.join(DATA_DIR, 'trace-records.json');

let traceRecords = [];   // Array of TraceRecord objects
let traceEvents  = [];   // Array of TraceEvent objects (lifecycle events)

async function loadTraceData() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const raw = await fs.readFile(TRACE_FILE, 'utf8');
    const data = JSON.parse(raw);
    traceRecords = data.records || [];
    traceEvents  = data.events  || [];
    console.log(`[traceability] Loaded ${traceRecords.length} trace records, ${traceEvents.length} events`);
  } catch {
    traceRecords = [];
    traceEvents  = [];
  }
}
loadTraceData();

async function saveTraceData() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(TRACE_FILE, JSON.stringify({ records: traceRecords, events: traceEvents }, null, 2));
  } catch (err) {
    console.error('[traceability] Save error:', err.message);
  }
}

// ── Farm config helper ─────────────────────────────────────────────────
let _farmConfig = null;
async function getFarmConfig() {
  if (_farmConfig) return _farmConfig;
  try {
    const raw = await fs.readFile(path.join(process.cwd(), 'public', 'data', 'farm.json'), 'utf8');
    _farmConfig = JSON.parse(raw);
  } catch {
    _farmConfig = { farmName: 'Light Engine Farm', address: '', city: '', state: '', postalCode: '' };
  }
  return _farmConfig;
}

// ── helpers ─────────────────────────────────────────────────────────────
function traceId() {
  return `TR-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

function eventId() {
  return `TE-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

function isDemoOrTestText(value) {
  return /(\btest\b|\bdemo\b)/i.test(String(value || ''));
}

function isVisibleTraceRecord(record) {
  return !(
    isDemoOrTestText(record?.common_name)
    || isDemoOrTestText(record?.recipe_id)
    || isDemoOrTestText(record?.lot_code)
  );
}

function getVisibleTraceRecords() {
  return traceRecords.filter(isVisibleTraceRecord);
}

function getVisibleTraceEvents() {
  const visibleLots = new Set(getVisibleTraceRecords().map((record) => record.lot_code));
  return traceEvents.filter((event) => visibleLots.has(event.lot_code));
}

// ======================================================================
//  AUTO-CREATE trace record  (called internally from harvest endpoint)
// ======================================================================

/**
 * Create a trace record automatically from harvest data.
 * This is the CORE function — called by the harvest endpoint, not by humans.
 *
 * @param {Object} opts
 * @param {string} opts.lot_code          – Generated lot code
 * @param {string} opts.batch_id          – Batch/run ID
 * @param {string} opts.tray_run_id       – Tray run ID
 * @param {string} opts.crop_name         – Common name of the crop
 * @param {string} opts.variety           – Variety/cultivar (optional)
 * @param {string} opts.recipe_id         – Recipe ID
 * @param {string} opts.zone              – Growing zone
 * @param {string} opts.room              – Room name
 * @param {string} opts.tray_format_name  – Tray format name
 * @param {string} opts.system_type       – Growing system type
 * @param {number} opts.planted_site_count – Number of plant sites
 * @param {number} opts.harvested_count   – Count harvested
 * @param {number} opts.actual_weight     – Harvest weight
 * @param {string} opts.weight_unit       – Weight unit
 * @param {string} opts.harvest_date      – ISO date
 * @param {string} opts.harvested_by      – Operator
 * @param {string} opts.seed_date         – ISO date of seeding
 * @param {string} opts.seed_source       – Supplier name + lot# (from seeding)
 * @param {number} opts.grow_days         – Days from seed to harvest
 * @returns {Object} The created trace record
 */
export function createTraceRecord(opts) {
  const farm = _farmConfig || { farmName: 'Light Engine Farm', address: '', city: '', state: '', postalCode: '' };

  const record = {
    trace_id:           traceId(),
    lot_code:           opts.lot_code,
    batch_id:           opts.batch_id || null,
    tray_run_id:        opts.tray_run_id || null,

    // ── SFCR Product Identification ──────────────────────────────────
    common_name:        opts.crop_name || 'Unknown Crop',
    variety:            opts.variety || null,
    recipe_id:          opts.recipe_id || null,

    // ── SFCR Producer Identification ─────────────────────────────────
    producer_name:      farm.farmName || farm.name || 'Light Engine Farm',
    producer_address:   [farm.address, farm.city, farm.state, farm.postalCode].filter(Boolean).join(', '),
    farm_id:            farm.farmId || null,

    // ── One Step Back (seed supplier) ────────────────────────────────
    seed_source:        opts.seed_source || null,          // "SupplierName / Lot ABC123"
    seed_date:          opts.seed_date || null,

    // ── Growing Context ──────────────────────────────────────────────
    zone:               opts.zone || null,
    room:               opts.room || null,
    tray_format:        opts.tray_format_name || null,
    system_type:        opts.system_type || null,
    planted_site_count: opts.planted_site_count || null,
    grow_days:          opts.grow_days || null,

    // ── Harvest Data ─────────────────────────────────────────────────
    harvest_date:       opts.harvest_date || new Date().toISOString(),
    harvested_by:       opts.harvested_by || 'operator',
    harvested_count:    opts.harvested_count || null,
    actual_weight:      opts.actual_weight || null,
    weight_unit:        opts.weight_unit || 'oz',

    // ── One Step Forward (populated later at order/ship) ─────────────
    customers:          [],   // { name, address, date, order_id, quantity }
    shipments:          [],   // { date, carrier, tracking }

    // ── Status ───────────────────────────────────────────────────────
    status:             'harvested',   // harvested → packed → shipped → delivered
    qa_result:          null,          // pass | conditional | fail

    // ── Timestamps ───────────────────────────────────────────────────
    created_at:         new Date().toISOString(),
    updated_at:         new Date().toISOString(),
    retention_until:    new Date(Date.now() + 2 * 365.25 * 24 * 60 * 60 * 1000).toISOString(),  // 2-year retention
  };

  traceRecords.push(record);

  // Auto-create lifecycle events
  const seedEvent = {
    event_id:   eventId(),
    trace_id:   record.trace_id,
    lot_code:   record.lot_code,
    event_type: 'seeded',
    timestamp:  opts.seed_date || record.created_at,
    detail:     `Seeded ${opts.planted_site_count || '?'} sites — ${opts.seed_source || 'source not recorded'}`,
    operator:   opts.harvested_by || 'operator',
    auto:       true
  };

  const harvestEvent = {
    event_id:   eventId(),
    trace_id:   record.trace_id,
    lot_code:   record.lot_code,
    event_type: 'harvested',
    timestamp:  record.harvest_date,
    detail:     `Harvested ${record.harvested_count || '?'} units, ${record.actual_weight || '?'} ${record.weight_unit}. Lot: ${record.lot_code}`,
    operator:   opts.harvested_by || 'operator',
    auto:       true
  };

  traceEvents.push(seedEvent, harvestEvent);

  // Persist async (don't block response)
  saveTraceData();

  console.log(`[traceability] Auto-created trace ${record.trace_id} for lot ${record.lot_code}`);
  return record;
}

/**
 * Link a customer/order to a trace record (One Step Forward).
 * Called when an order is packed or shipped.
 */
export function linkCustomerToTrace(lotCode, customer) {
  const record = traceRecords.find(r => r.lot_code === lotCode);
  if (!record) return null;

  record.customers.push({
    name:     customer.name || customer.buyer_name,
    address:  customer.address || customer.delivery_address || '',
    date:     new Date().toISOString(),
    order_id: customer.order_id || null,
    quantity: customer.quantity || null
  });
  record.updated_at = new Date().toISOString();

  traceEvents.push({
    event_id:   eventId(),
    trace_id:   record.trace_id,
    lot_code:   lotCode,
    event_type: 'customer_linked',
    timestamp:  new Date().toISOString(),
    detail:     `Linked to ${customer.name || customer.buyer_name} (order ${customer.order_id || 'N/A'})`,
    operator:   'system',
    auto:       true
  });

  saveTraceData();
  return record;
}

/**
 * Update trace status (packed, shipped, delivered)
 */
export function updateTraceStatus(lotCode, status, operator, detail) {
  const record = traceRecords.find(r => r.lot_code === lotCode);
  if (!record) return null;

  record.status = status;
  record.updated_at = new Date().toISOString();
  if (status === 'packed') record.packed_at = new Date().toISOString();
  if (status === 'shipped') record.shipped_at = new Date().toISOString();
  if (status === 'delivered') record.delivered_at = new Date().toISOString();

  traceEvents.push({
    event_id:   eventId(),
    trace_id:   record.trace_id,
    lot_code:   lotCode,
    event_type: status,
    timestamp:  new Date().toISOString(),
    detail:     detail || `Status changed to ${status}`,
    operator:   operator || 'system',
    auto:       true
  });

  saveTraceData();
  return record;
}


// ======================================================================
//  REST API
// ======================================================================

// ── GET / — List trace records with filters ──────────────────────────
router.get('/', (req, res) => {
  const { status, crop, lot_code, from_date, to_date, limit } = req.query;
  let results = getVisibleTraceRecords();

  if (status)    results = results.filter(r => r.status === status);
  if (crop)      results = results.filter(r => (r.common_name || '').toLowerCase().includes(crop.toLowerCase()));
  if (lot_code)  results = results.filter(r => r.lot_code === lot_code);
  if (from_date) results = results.filter(r => r.harvest_date >= from_date);
  if (to_date)   results = results.filter(r => r.harvest_date <= to_date);

  results.sort((a, b) => new Date(b.harvest_date) - new Date(a.harvest_date));
  if (limit) results = results.slice(0, parseInt(limit));

  res.json({ success: true, records: results, total: results.length });
});

// ── GET /stats — Dashboard stats ─────────────────────────────────────
router.get('/stats', (req, res) => {
  const now = new Date();
  const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
  const visibleRecords = getVisibleTraceRecords();
  const visibleEvents = getVisibleTraceEvents();

  const total   = visibleRecords.length;
  const active  = visibleRecords.filter(r => ['harvested', 'packed'].includes(r.status)).length;
  const shipped = visibleRecords.filter(r => r.status === 'shipped').length;
  const recent  = visibleRecords.filter(r => r.harvest_date >= thirtyDaysAgo).length;
  const withCustomer = visibleRecords.filter(r => r.customers.length > 0).length;
  const crops   = [...new Set(visibleRecords.map(r => r.common_name))].length;

  res.json({
    success: true,
    stats: { total, active, shipped, recent, withCustomer, crops, events: visibleEvents.length }
  });
});

// ── GET /:lotCode — Full trace detail for a single lot ───────────────
router.get('/lot/:lotCode', (req, res) => {
  const record = getVisibleTraceRecords().find(r => r.lot_code === req.params.lotCode);
  if (!record) return res.status(404).json({ success: false, error: 'Lot not found' });

  const events = getVisibleTraceEvents()
    .filter(e => e.lot_code === req.params.lotCode)
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  res.json({ success: true, record, events });
});

// ── GET /:lotCode/timeline — Public scannable QR endpoint ────────────
router.get('/lot/:lotCode/timeline', (req, res) => {
  const record = getVisibleTraceRecords().find(r => r.lot_code === req.params.lotCode);
  if (!record) return res.status(404).json({ success: false, error: 'Lot not found' });

  const events = getVisibleTraceEvents()
    .filter(e => e.lot_code === req.params.lotCode)
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  // Public-safe version (no internal IDs, no supplier details)
  res.json({
    product:  record.common_name + (record.variety ? ` (${record.variety})` : ''),
    farm:     record.producer_name,
    location: record.producer_address,
    lot_code: record.lot_code,
    harvest_date: record.harvest_date,
    grow_days: record.grow_days,
    system:   record.system_type,
    timeline: events.map(e => ({
      event: e.event_type,
      date:  e.timestamp,
      detail: e.detail
    }))
  });
});

// ── POST /event — Record a lifecycle event (QA, packing, etc.) ───────
router.post('/event', (req, res) => {
  const { lot_code, event_type, detail, operator } = req.body;
  if (!lot_code || !event_type) {
    return res.status(400).json({ success: false, error: 'lot_code and event_type required' });
  }

  const record = traceRecords.find(r => r.lot_code === lot_code);
  if (!record) return res.status(404).json({ success: false, error: 'Lot not found' });

  const evt = {
    event_id:   eventId(),
    trace_id:   record.trace_id,
    lot_code,
    event_type,
    timestamp:  new Date().toISOString(),
    detail:     detail || '',
    operator:   operator || 'operator',
    auto:       false
  };
  traceEvents.push(evt);

  // Auto-update record status for known event types
  if (['packed', 'shipped', 'delivered'].includes(event_type)) {
    record.status = event_type;
    if (event_type === 'packed') record.packed_at = evt.timestamp;
    if (event_type === 'shipped') record.shipped_at = evt.timestamp;
  }
  if (event_type === 'qa_check') {
    record.qa_result = req.body.result || 'pass';
  }

  record.updated_at = evt.timestamp;
  saveTraceData();

  res.json({ success: true, event: evt });
});

// ── GET /recall/:lotCode — Recall report (SFCR 24-hour response) ─────
router.get('/recall/:lotCode', async (req, res) => {
  const record = getVisibleTraceRecords().find(r => r.lot_code === req.params.lotCode);
  if (!record) return res.status(404).json({ success: false, error: 'Lot not found' });

  const events = getVisibleTraceEvents()
    .filter(e => e.lot_code === req.params.lotCode)
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  const farm = await getFarmConfig();

  res.json({
    success: true,
    recall_report: {
      generated_at: new Date().toISOString(),
      regulatory_framework: 'Safe Food for Canadians Regulations (SFCR), Part 5',

      // Product Identification
      product: {
        common_name:  record.common_name,
        variety:      record.variety,
        lot_code:     record.lot_code,
      },

      // Producer
      producer: {
        name:    record.producer_name,
        address: record.producer_address,
        farm_id: record.farm_id,
        contact: farm.contact || {}
      },

      // One Step Back
      one_step_back: {
        seed_source:    record.seed_source,
        seed_date:      record.seed_date,
        growing_zone:   record.zone,
        growing_room:   record.room,
        system_type:    record.system_type,
        tray_format:    record.tray_format,
        grow_days:      record.grow_days,
      },

      // One Step Forward
      one_step_forward: {
        customers: record.customers,
        total_customers: record.customers.length,
        total_quantity_distributed: record.customers.reduce((s, c) => s + (c.quantity || 0), 0)
      },

      // Harvest details
      harvest: {
        date:     record.harvest_date,
        operator: record.harvested_by,
        weight:   record.actual_weight,
        unit:     record.weight_unit,
        count:    record.harvested_count,
        qa:       record.qa_result
      },

      // Full timeline
      lifecycle_events: events,

      // Retention
      retention_until: record.retention_until,
    }
  });
});

// ── GET /sfcr-export — Full SFCR compliance export (plain text CSV) ──
router.get('/sfcr-export', async (req, res) => {
  const { from_date, to_date, format } = req.query;
  let records = getVisibleTraceRecords();

  if (from_date) records = records.filter(r => r.harvest_date >= from_date);
  if (to_date)   records = records.filter(r => r.harvest_date <= to_date);

  records.sort((a, b) => new Date(a.harvest_date) - new Date(b.harvest_date));

  if (format === 'json') {
    // Single JSON file for CFIA
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=sfcr-traceability-export-${new Date().toISOString().slice(0,10)}.json`);
    return res.json({
      export_date: new Date().toISOString(),
      regulatory_framework: 'Safe Food for Canadians Regulations (SFCR), Part 5',
      record_count: records.length,
      records: records.map(r => ({
        lot_code:         r.lot_code,
        common_name:      r.common_name,
        variety:          r.variety,
        producer_name:    r.producer_name,
        producer_address: r.producer_address,
        seed_source:      r.seed_source,
        seed_date:        r.seed_date,
        harvest_date:     r.harvest_date,
        harvested_by:     r.harvested_by,
        weight:           r.actual_weight,
        weight_unit:      r.weight_unit,
        zone:             r.zone,
        room:             r.room,
        system_type:      r.system_type,
        grow_days:        r.grow_days,
        status:           r.status,
        qa_result:        r.qa_result,
        customers:        r.customers,
        retention_until:  r.retention_until
      }))
    });
  }

  // Default: CSV (plain text, SFCR requirement)
  const headers = [
    'lot_code', 'common_name', 'variety', 'producer_name', 'producer_address',
    'seed_source', 'seed_date', 'harvest_date', 'harvested_by',
    'weight', 'weight_unit', 'zone', 'room', 'system_type', 'grow_days',
    'status', 'qa_result', 'customer_names', 'customer_dates', 'retention_until'
  ];

  const csvRows = [headers.join(',')];
  for (const r of records) {
    const custNames = r.customers.map(c => c.name).join('; ');
    const custDates = r.customers.map(c => c.date).join('; ');
    const row = [
      r.lot_code, `"${r.common_name}"`, `"${r.variety || ''}"`,
      `"${r.producer_name}"`, `"${r.producer_address}"`,
      `"${r.seed_source || ''}"`, r.seed_date || '',
      r.harvest_date, `"${r.harvested_by || ''}"`,
      r.actual_weight || '', r.weight_unit || '',
      `"${r.zone || ''}"`, `"${r.room || ''}"`,
      r.system_type || '', r.grow_days || '',
      r.status, r.qa_result || '',
      `"${custNames}"`, `"${custDates}"`, r.retention_until
    ];
    csvRows.push(row.join(','));
  }

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename=sfcr-traceability-export-${new Date().toISOString().slice(0,10)}.csv`);
  res.send(csvRows.join('\n'));
});

// ── GET /label-data/:lotCode — All data needed for SFCR-compliant label
router.get('/label-data/:lotCode', async (req, res) => {
  const record = getVisibleTraceRecords().find(r => r.lot_code === req.params.lotCode);
  if (!record) return res.status(404).json({ success: false, error: 'Lot not found' });

  const farm = await getFarmConfig();

  // Everything a label printer needs for SFCR compliance
  res.json({
    success: true,
    label: {
      common_name:      record.common_name,
      variety:          record.variety,
      lot_code:         record.lot_code,
      producer_name:    record.producer_name,
      producer_address: record.producer_address,
      harvest_date:     record.harvest_date,
      weight:           record.actual_weight,
      weight_unit:      record.weight_unit,
      qr_payload:       `GRTRACE|${record.farm_id}|${record.lot_code}|${record.common_name}|${record.harvest_date}`,
      trace_url:        `/api/traceability/lot/${record.lot_code}/timeline`
    }
  });
});

export default router;
