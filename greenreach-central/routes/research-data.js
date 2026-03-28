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

    const { study_id, status, limit = 50, offset = 0 } = req.query;
    const params = [farmId];
    let where = 'WHERE rd.farm_id = $1';
    if (study_id) { params.push(study_id); where += ` AND rd.study_id = $${params.length}`; }
    if (status) { params.push(status); where += ` AND rd.status = $${params.length}`; }
    params.push(parseInt(limit, 10), parseInt(offset, 10));

    const result = await query(`
      SELECT rd.*,
        s.title as study_title,
        (SELECT COUNT(*) FROM research_observations ro WHERE ro.dataset_id = rd.id) as observation_count
      FROM research_datasets rd
      LEFT JOIN studies s ON rd.study_id = s.id
      ${where}
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
    const farmId = req.farmId || req.body.farm_id;
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
router.get('/research/datasets/:id', async (req, res) => {
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
router.patch('/research/datasets/:id', async (req, res) => {
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

// ─── POST /research/datasets/:id/observations ────────────────────────
router.post('/research/datasets/:id/observations', async (req, res) => {
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
    for (const obs of observations) {
      if (!obs.variable_name || !obs.observed_at) continue;
      await query(`
        INSERT INTO research_observations
          (dataset_id, observation_type, device_id, sensor_id, sample_id, variable_name, raw_value, cleaned_value, unit, observed_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `, [id, obs.observation_type || 'manual', obs.device_id || null,
          obs.sensor_id || null, obs.sample_id || null, obs.variable_name,
          obs.raw_value ?? null, obs.cleaned_value ?? null, obs.unit || null, obs.observed_at]);
      ingested++;
    }

    // Record provenance for sensor observations
    const sensorObs = observations.filter(o => o.observation_type === 'sensor' && o.device_id);
    for (const obs of sensorObs) {
      await query(`
        INSERT INTO provenance_records (entity_type, entity_id, source_type, source_id, source_metadata)
        VALUES ('observation', currval('research_observations_id_seq'), 'sensor', $1, $2)
      `, [obs.device_id, JSON.stringify({ sensor_id: obs.sensor_id, device_id: obs.device_id })]);
    }

    res.status(201).json({ ok: true, ingested });
  } catch (err) {
    console.error('[ResearchData] Observation ingest error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to ingest observations' });
  }
});

// ─── GET /research/datasets/:id/observations ─────────────────────────
router.get('/research/datasets/:id/observations', async (req, res) => {
  try {
    const { id } = req.params;
    const { variable_name, observation_type, device_id, from, to, limit = 1000, offset = 0 } = req.query;
    const params = [id];
    let where = 'WHERE ro.dataset_id = $1';
    if (variable_name) { params.push(variable_name); where += ` AND ro.variable_name = $${params.length}`; }
    if (observation_type) { params.push(observation_type); where += ` AND ro.observation_type = $${params.length}`; }
    if (device_id) { params.push(device_id); where += ` AND ro.device_id = $${params.length}`; }
    if (from) { params.push(from); where += ` AND ro.observed_at >= $${params.length}`; }
    if (to) { params.push(to); where += ` AND ro.observed_at <= $${params.length}`; }
    params.push(parseInt(limit, 10), parseInt(offset, 10));

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
router.get('/research/datasets/:id/provenance', async (req, res) => {
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
    const farmId = req.farmId || req.body.farm_id;
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
    const farmId = req.farmId || req.body.farm_id;
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

export default router;
