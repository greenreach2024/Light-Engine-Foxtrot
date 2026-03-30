/**
 * Research Data Model & Provenance Routes
 * Research Platform Phase 2 -- Datasets, Observations, Provenance, Calibration
 *
 * Endpoints:
 *   GET    /research/datasets                   -- List datasets for farm/study
 *   POST   /research/datasets                   -- Create dataset
 *   GET    /research/datasets/:id               -- Get dataset with variable defs
 *   PATCH  /research/datasets/:id               -- Update dataset (lock, publish)
 *   POST   /research/datasets/:id/observations  -- Ingest observations
 *   GET    /research/datasets/:id/observations  -- Query observations
 *   GET    /research/datasets/:id/provenance    -- Provenance chain
 *   POST   /research/transformations             -- Record a data transformation
 *   GET    /research/calibrations                -- List calibration logs
 *   POST   /research/calibrations                -- Record calibration
 *   GET    /research/maintenance                 -- List device maintenance
 *   POST   /research/maintenance                 -- Record maintenance event
 */
import { Router } from 'express';
import { query, isDatabaseAvailable } from '../config/database.js';
import { verifyDatasetOwnership, verifyStudyOwnership } from '../middleware/research-tenant.js';

const router = Router();

const checkDb = async (req, res, next) => {
  if (!(await isDatabaseAvailable())) {
    return res.status(503).json({ ok: false, error: 'Database not available' });
  }
  next();
};

router.use(checkDb);

// ─── GET /research/datasets ───────────────────────────────────────────
router.get('/research/datasets', async (req, res) => {
  try {
    const farmId = req.farmId || req.query.farm_id;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const { study_id, status, limit = 20, offset = 0 } = req.query;
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);
    const params = [farmId];
    let where = 'WHERE rd.farm_id = $1';
    if (study_id) { params.push(study_id); where += ` AND rd.study_id = $${params.length}`; }
    if (status) { params.push(status); where += ` AND rd.status = $${params.length}`; }
    params.push(safeLimit, safeOffset);

    const result = await query(`
      SELECT rd.*,
        s.title as study_title,
        COUNT(ro.id)::int as observation_count
      FROM research_datasets rd
      LEFT JOIN studies s ON rd.study_id = s.id
      LEFT JOIN research_observations ro ON ro.dataset_id = rd.id
      ${where}
      GROUP BY rd.id, s.title
      ORDER BY rd.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);

    res.json({ ok: true, datasets: result.rows, count: result.rows.length });
  } catch (err) {
    console.error('[ResearchData] Dataset list error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to list datasets' });
  }
});

// ─── POST /research/datasets ──────────────────────────────────────────
router.post('/research/datasets', async (req, res) => {
  try {
    const farmId = req.farmId;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const { name, study_id, description, variable_definitions, unit_normalization, timezone, created_by } = req.body;
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ ok: false, error: 'name required' });
    }

    const result = await query(`
      INSERT INTO research_datasets (farm_id, study_id, name, description, variable_definitions, unit_normalization, timezone, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [farmId, study_id || null, name.trim(), description || null,
        JSON.stringify(variable_definitions || []),
        JSON.stringify(unit_normalization || {}),
        timezone || 'UTC', created_by || null]);

    res.status(201).json({ ok: true, dataset: result.rows[0] });
  } catch (err) {
    console.error('[ResearchData] Dataset create error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to create dataset' });
  }
});

// ─── GET /research/datasets/:id ───────────────────────────────────────
router.get('/research/datasets/:id', verifyDatasetOwnership, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await query(`
      SELECT rd.*, s.title as study_title, u.email as created_by_email
      FROM research_datasets rd
      LEFT JOIN studies s ON rd.study_id = s.id
      LEFT JOIN farm_users u ON rd.created_by = u.id
      WHERE rd.id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Dataset not found' });
    }

    res.json({ ok: true, dataset: result.rows[0] });
  } catch (err) {
    console.error('[ResearchData] Dataset get error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to get dataset' });
  }
});

// ─── PATCH /research/datasets/:id ─────────────────────────────────────
router.patch('/research/datasets/:id', verifyDatasetOwnership, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, name, description, variable_definitions, unit_normalization } = req.body;

    // Prevent modifying locked datasets (except unlocking by admin)
    const current = await query('SELECT status FROM research_datasets WHERE id = $1', [id]);
    if (current.rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Dataset not found' });
    }
    if (current.rows[0].status === 'locked' && status !== 'collecting') {
      return res.status(409).json({ ok: false, error: 'Dataset is locked. Only status change to collecting is permitted.' });
    }

    const updates = [];
    const values = [];
    let idx = 1;

    if (name !== undefined) { updates.push(`name = $${idx}`); values.push(name); idx++; }
    if (description !== undefined) { updates.push(`description = $${idx}`); values.push(description); idx++; }
    if (variable_definitions !== undefined) { updates.push(`variable_definitions = $${idx}`); values.push(JSON.stringify(variable_definitions)); idx++; }
    if (unit_normalization !== undefined) { updates.push(`unit_normalization = $${idx}`); values.push(JSON.stringify(unit_normalization)); idx++; }
    if (status) {
      updates.push(`status = $${idx}`); values.push(status); idx++;
      if (status === 'locked') { updates.push('locked_at = NOW()'); }
    }

    if (updates.length === 0) {
      return res.status(400).json({ ok: false, error: 'No fields to update' });
    }

    values.push(id);
    const result = await query(`
      UPDATE research_datasets SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *
    `, values);

    res.json({ ok: true, dataset: result.rows[0] });
  } catch (err) {
    console.error('[ResearchData] Dataset update error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to update dataset' });
  }
});

router.delete('/research/datasets/:id', verifyDatasetOwnership, async (req, res) => {
  try {
    const result = await query('DELETE FROM research_datasets WHERE id = $1 RETURNING id', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ ok: false, error: 'Dataset not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[ResearchData] Delete error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to delete dataset' });
  }
});

// ─── POST /research/datasets/:id/observations ────────────────────────
router.post('/research/datasets/:id/observations', verifyDatasetOwnership, async (req, res) => {
  try {
    const { id } = req.params;
    const { observations } = req.body;
    if (!Array.isArray(observations) || observations.length === 0) {
      return res.status(400).json({ ok: false, error: 'observations array required' });
    }

    // Verify dataset is not locked
    const ds = await query('SELECT status FROM research_datasets WHERE id = $1', [id]);
    if (ds.rows.length === 0) return res.status(404).json({ ok: false, error: 'Dataset not found' });
    if (ds.rows[0].status === 'locked' || ds.rows[0].status === 'published') {
      return res.status(409).json({ ok: false, error: 'Cannot add observations to a locked/published dataset' });
    }

    let ingested = 0;
    const insertedIds = [];
    for (const obs of observations) {
      if (!obs.variable_name || !obs.observed_at) continue;
      const insertResult = await query(`
        INSERT INTO research_observations
          (dataset_id, observation_type, device_id, sensor_id, sample_id, variable_name, raw_value, cleaned_value, unit, observed_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING id
      `, [id, obs.observation_type || 'manual', obs.device_id || null,
          obs.sensor_id || null, obs.sample_id || null, obs.variable_name,
          obs.raw_value ?? null, obs.cleaned_value ?? null, obs.unit || null, obs.observed_at]);
      if (obs.observation_type === 'sensor' && obs.device_id && insertResult.rows[0]) {
        insertedIds.push({ obsId: insertResult.rows[0].id, obs });
      }
      ingested++;
    }

    // Record provenance for sensor observations using the actual returned IDs
    for (const { obsId, obs } of insertedIds) {
      await query(`
        INSERT INTO provenance_records (entity_type, entity_id, source_type, source_id, source_metadata)
        VALUES ('observation', $1::text, 'sensor', $2, $3)
      `, [obsId, obs.device_id, JSON.stringify({ sensor_id: obs.sensor_id, device_id: obs.device_id })]);
    }

    res.status(201).json({ ok: true, ingested });
  } catch (err) {
    console.error('[ResearchData] Observation ingest error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to ingest observations' });
  }
});

// ─── GET /research/datasets/:id/observations ─────────────────────────
router.get('/research/datasets/:id/observations', verifyDatasetOwnership, async (req, res) => {
  try {
    const { id } = req.params;
    const { variable_name, observation_type, device_id, from, to, limit = 20, offset = 0 } = req.query;
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);
    const params = [id];
    let where = 'WHERE ro.dataset_id = $1';
    if (variable_name) { params.push(variable_name); where += ` AND ro.variable_name = $${params.length}`; }
    if (observation_type) { params.push(observation_type); where += ` AND ro.observation_type = $${params.length}`; }
    if (device_id) { params.push(device_id); where += ` AND ro.device_id = $${params.length}`; }
    if (from) { params.push(from); where += ` AND ro.observed_at >= $${params.length}`; }
    if (to) { params.push(to); where += ` AND ro.observed_at <= $${params.length}`; }
    params.push(safeLimit, safeOffset);

    const result = await query(`
      SELECT ro.* FROM research_observations ro
      ${where}
      ORDER BY ro.observed_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);

    res.json({ ok: true, observations: result.rows, count: result.rows.length });
  } catch (err) {
    console.error('[ResearchData] Observation query error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to query observations' });
  }
});

// ─── GET /research/datasets/:id/provenance ────────────────────────────
router.get('/research/datasets/:id/provenance', verifyDatasetOwnership, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await query(`
      SELECT pr.* FROM provenance_records pr
      WHERE (pr.entity_type = 'dataset' AND pr.entity_id = $1)
         OR (pr.entity_type = 'observation' AND pr.entity_id IN (
              SELECT ro.id FROM research_observations ro WHERE ro.dataset_id = $1
            ))
      ORDER BY pr.recorded_at DESC
      LIMIT 500
    `, [id]);

    res.json({ ok: true, provenance: result.rows });
  } catch (err) {
    console.error('[ResearchData] Provenance error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to get provenance' });
  }
});

// ─── POST /research/transformations ───────────────────────────────────
router.post('/research/transformations', async (req, res) => {
  try {
    const { dataset_id, input_observation_ids, output_observation_ids, transformation_type, parameters, applied_by } = req.body;
    if (!dataset_id || !transformation_type) {
      return res.status(400).json({ ok: false, error: 'dataset_id and transformation_type required' });
    }

    const result = await query(`
      INSERT INTO data_transformations (dataset_id, input_observation_ids, output_observation_ids, transformation_type, parameters, applied_by)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [dataset_id, input_observation_ids || '{}', output_observation_ids || '{}',
        transformation_type, JSON.stringify(parameters || {}), applied_by || null]);

    // Record provenance
    await query(`
      INSERT INTO provenance_records (entity_type, entity_id, source_type, source_id, source_metadata)
      VALUES ('transformation', $1, 'transformation', $2, $3)
    `, [result.rows[0].id, dataset_id, JSON.stringify({ type: transformation_type })]);

    res.status(201).json({ ok: true, transformation: result.rows[0] });
  } catch (err) {
    console.error('[ResearchData] Transformation error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to record transformation' });
  }
});

// ─── GET /research/calibrations ───────────────────────────────────────
router.get('/research/calibrations', async (req, res) => {
  try {
    const farmId = req.farmId || req.query.farm_id;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const { device_id, status } = req.query;
    const params = [farmId];
    let where = 'WHERE cl.farm_id = $1';
    if (device_id) { params.push(device_id); where += ` AND cl.device_id = $${params.length}`; }
    if (status) { params.push(status); where += ` AND cl.status = $${params.length}`; }

    const result = await query(`
      SELECT cl.*, u.email as calibrated_by_email
      FROM calibration_logs cl
      LEFT JOIN farm_users u ON cl.calibrated_by = u.id
      ${where}
      ORDER BY cl.calibrated_at DESC
    `, params);

    res.json({ ok: true, calibrations: result.rows });
  } catch (err) {
    console.error('[ResearchData] Calibration list error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to list calibrations' });
  }
});

// ─── POST /research/calibrations ──────────────────────────────────────
router.post('/research/calibrations', async (req, res) => {
  try {
    const farmId = req.farmId;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const { device_id, sensor_id, calibration_type, reference_value, measured_value, offset_value, calibrated_by, next_due } = req.body;
    if (!device_id) {
      return res.status(400).json({ ok: false, error: 'device_id required' });
    }

    // Supersede previous current calibration for same device/sensor
    await query(
      "UPDATE calibration_logs SET status = 'superseded' WHERE farm_id = $1 AND device_id = $2 AND sensor_id = $3 AND status = 'current'",
      [farmId, device_id, sensor_id || null]
    );

    const result = await query(`
      INSERT INTO calibration_logs (farm_id, device_id, sensor_id, calibration_type, reference_value, measured_value, offset_value, calibrated_by, next_due)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `, [farmId, device_id, sensor_id || null, calibration_type || null,
        reference_value ?? null, measured_value ?? null, offset_value ?? null,
        calibrated_by || null, next_due || null]);

    res.status(201).json({ ok: true, calibration: result.rows[0] });
  } catch (err) {
    console.error('[ResearchData] Calibration record error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to record calibration' });
  }
});

// ─── GET /research/maintenance ────────────────────────────────────────
router.get('/research/maintenance', async (req, res) => {
  try {
    const farmId = req.farmId || req.query.farm_id;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const { device_id } = req.query;
    const params = [farmId];
    let where = 'WHERE dm.farm_id = $1';
    if (device_id) { params.push(device_id); where += ` AND dm.device_id = $${params.length}`; }

    const result = await query(`
      SELECT dm.*, u.email as performed_by_email
      FROM device_maintenance dm
      LEFT JOIN farm_users u ON dm.performed_by = u.id
      ${where}
      ORDER BY dm.performed_at DESC
    `, params);

    res.json({ ok: true, maintenance: result.rows });
  } catch (err) {
    console.error('[ResearchData] Maintenance list error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to list maintenance' });
  }
});

// ─── POST /research/maintenance ───────────────────────────────────────
router.post('/research/maintenance', async (req, res) => {
  try {
    const farmId = req.farmId;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const { device_id, maintenance_type, description, performed_by, next_scheduled } = req.body;
    if (!device_id || !maintenance_type) {
      return res.status(400).json({ ok: false, error: 'device_id and maintenance_type required' });
    }

    const result = await query(`
      INSERT INTO device_maintenance (farm_id, device_id, maintenance_type, description, performed_by, next_scheduled)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [farmId, device_id, maintenance_type, description || null,
        performed_by || null, next_scheduled || null]);

    res.status(201).json({ ok: true, maintenance: result.rows[0] });
  } catch (err) {
    console.error('[ResearchData] Maintenance record error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to record maintenance' });
  }
});

// ── Phase 1 Enhancements ──
// event_markers: id, farm_id, study_id, dataset_id, marker_type (anomaly|phase_change|intervention|note),
//   timestamp, title, description, created_by, created_at
// batch_traceability: id, farm_id, study_id, batch_id, event_type (seeded|transplanted|harvested|tested|shipped),
//   timestamp, location, details (JSONB), previous_batch_id, created_at
// data_quality_alerts: id, farm_id, dataset_id, variable_name, alert_type (missing|outlier|drift|gap),
//   severity (low|medium|high), message, detected_at, resolved, resolved_at

// ── Event Markers ──
router.get('/research/datasets/:id/markers', verifyDatasetOwnership, async (req, res) => {
  try {
    const { marker_type, since } = req.query;
    const params = [req.params.id];
    let where = 'WHERE em.dataset_id = $1';
    if (marker_type) { params.push(marker_type); where += ` AND em.marker_type = $${params.length}`; }
    if (since) { params.push(since); where += ` AND em.timestamp >= $${params.length}`; }

    const result = await query(`SELECT em.* FROM event_markers em ${where} ORDER BY em.timestamp DESC LIMIT 500`, params);
    res.json({ ok: true, markers: result.rows, count: result.rows.length });
  } catch (err) {
    console.error('[ResearchData] Event markers list error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to list event markers' });
  }
});

router.post('/research/datasets/:id/markers', verifyDatasetOwnership, async (req, res) => {
  try {
    const farmId = req.farmId;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const { marker_type, timestamp, title, description, study_id } = req.body;
    if (!marker_type || !title) return res.status(400).json({ ok: false, error: 'marker_type and title required' });

    const validTypes = ['anomaly', 'phase_change', 'intervention', 'note'];
    if (!validTypes.includes(marker_type)) {
      return res.status(400).json({ ok: false, error: `marker_type must be one of: ${validTypes.join(', ')}` });
    }

    const result = await query(`
      INSERT INTO event_markers (farm_id, study_id, dataset_id, marker_type, timestamp, title, description, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [farmId, study_id || null, req.params.id, marker_type, timestamp || new Date().toISOString(), title, description || null, req.userId || null]);

    res.status(201).json({ ok: true, marker: result.rows[0] });
  } catch (err) {
    console.error('[ResearchData] Event marker create error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to create event marker' });
  }
});

// ── Batch Traceability ──
router.get('/research/studies/:id/batches', verifyStudyOwnership, async (req, res) => {
  try {
    const { batch_id, event_type } = req.query;
    const params = [req.params.id];
    let where = 'WHERE bt.study_id = $1';
    if (batch_id) { params.push(batch_id); where += ` AND bt.batch_id = $${params.length}`; }
    if (event_type) { params.push(event_type); where += ` AND bt.event_type = $${params.length}`; }

    const result = await query(`SELECT bt.* FROM batch_traceability bt ${where} ORDER BY bt.timestamp DESC LIMIT 500`, params);
    res.json({ ok: true, batches: result.rows, count: result.rows.length });
  } catch (err) {
    console.error('[ResearchData] Batch trace list error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to list batch traceability' });
  }
});

router.post('/research/studies/:id/batches', verifyStudyOwnership, async (req, res) => {
  try {
    const farmId = req.farmId;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const { batch_id, event_type, timestamp, location, details, previous_batch_id } = req.body;
    if (!batch_id || !event_type) return res.status(400).json({ ok: false, error: 'batch_id and event_type required' });

    const validEvents = ['seeded', 'transplanted', 'harvested', 'tested', 'shipped'];
    if (!validEvents.includes(event_type)) {
      return res.status(400).json({ ok: false, error: `event_type must be one of: ${validEvents.join(', ')}` });
    }

    const result = await query(`
      INSERT INTO batch_traceability (farm_id, study_id, batch_id, event_type, timestamp, location, details, previous_batch_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [farmId, req.params.id, batch_id, event_type, timestamp || new Date().toISOString(), location || null, JSON.stringify(details || {}), previous_batch_id || null]);

    res.status(201).json({ ok: true, batch: result.rows[0] });
  } catch (err) {
    console.error('[ResearchData] Batch trace create error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to create batch event' });
  }
});

// ── Batch Chain (full provenance lineage for a batch) ──
router.get('/research/batches/:batchId/chain', async (req, res) => {
  try {
    const farmId = req.farmId || req.query.farm_id;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const result = await query(`
      WITH RECURSIVE chain AS (
        SELECT * FROM batch_traceability WHERE batch_id = $1 AND farm_id = $2
        UNION ALL
        SELECT bt.* FROM batch_traceability bt
        INNER JOIN chain c ON bt.batch_id = c.previous_batch_id AND bt.farm_id = c.farm_id
      )
      SELECT * FROM chain ORDER BY timestamp
    `, [req.params.batchId, farmId]);

    res.json({ ok: true, chain: result.rows, count: result.rows.length });
  } catch (err) {
    console.error('[ResearchData] Batch chain error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to trace batch chain' });
  }
});

// ── Data Quality Alerts ──
router.get('/research/datasets/:id/alerts', verifyDatasetOwnership, async (req, res) => {
  try {
    const { alert_type, severity, resolved } = req.query;
    const params = [req.params.id];
    let where = 'WHERE dqa.dataset_id = $1';
    if (alert_type) { params.push(alert_type); where += ` AND dqa.alert_type = $${params.length}`; }
    if (severity) { params.push(severity); where += ` AND dqa.severity = $${params.length}`; }
    if (resolved !== undefined) { params.push(resolved === 'true'); where += ` AND dqa.resolved = $${params.length}`; }

    const result = await query(`SELECT dqa.* FROM data_quality_alerts dqa ${where} ORDER BY dqa.detected_at DESC LIMIT 200`, params);
    res.json({ ok: true, alerts: result.rows, count: result.rows.length });
  } catch (err) {
    console.error('[ResearchData] Quality alerts list error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to list quality alerts' });
  }
});

router.post('/research/datasets/:id/alerts', verifyDatasetOwnership, async (req, res) => {
  try {
    const farmId = req.farmId;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const { variable_name, alert_type, severity, message } = req.body;
    if (!alert_type || !message) return res.status(400).json({ ok: false, error: 'alert_type and message required' });

    const validTypes = ['missing', 'outlier', 'drift', 'gap'];
    if (!validTypes.includes(alert_type)) {
      return res.status(400).json({ ok: false, error: `alert_type must be one of: ${validTypes.join(', ')}` });
    }

    const result = await query(`
      INSERT INTO data_quality_alerts (farm_id, dataset_id, variable_name, alert_type, severity, message)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [farmId, req.params.id, variable_name || null, alert_type, severity || 'medium', message]);

    res.status(201).json({ ok: true, alert: result.rows[0] });
  } catch (err) {
    console.error('[ResearchData] Quality alert create error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to create quality alert' });
  }
});

router.patch('/research/alerts/:id/resolve', async (req, res) => {
  try {
    const result = await query(`
      UPDATE data_quality_alerts SET resolved = true, resolved_at = NOW()
      WHERE id = $1 RETURNING *
    `, [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ ok: false, error: 'Alert not found' });
    res.json({ ok: true, alert: result.rows[0] });
  } catch (err) {
    console.error('[ResearchData] Alert resolve error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to resolve alert' });
  }
});

export default router;
