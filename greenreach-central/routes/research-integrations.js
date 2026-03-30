// [safe-patch] 2026-03-29 -- Research integration layer: ORCID, DataCite, OSF, protocols.io,
// Globus, instrument abstraction, workflow engine, CFD pipeline, governance
import { Router } from 'express';
import crypto from 'crypto';
import { query, isDatabaseAvailable } from '../config/database.js';

const router = Router();

// ========================================================================
// ORCID INTEGRATION
// ========================================================================

// GET /research/integrations/orcid/profiles — list linked ORCID profiles
router.get('/research/integrations/orcid/profiles', async (req, res) => {
  try {
    const farmId = req.farmId || req.headers['x-farm-id'];
    const result = await query(
      'SELECT * FROM researcher_orcid_profiles WHERE farm_id = $1 ORDER BY created_at DESC',
      [farmId]
    );
    res.json({ profiles: result.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /research/integrations/orcid/link — link ORCID iD to farm
router.post('/research/integrations/orcid/link', async (req, res) => {
  try {
    const farmId = req.farmId || req.headers['x-farm-id'];
    const { orcid_id, display_name, affiliation } = req.body;
    if (!orcid_id || !/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/.test(orcid_id)) {
      return res.status(400).json({ error: 'Valid ORCID iD required (format: 0000-0000-0000-0000)' });
    }
    const result = await query(
      `INSERT INTO researcher_orcid_profiles (farm_id, user_id, orcid_id, display_name, affiliation, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (farm_id, orcid_id) DO UPDATE SET display_name = $4, affiliation = $5, updated_at = NOW()
       RETURNING *`,
      [farmId, req.userId, orcid_id, display_name || null, affiliation || null]
    );
    res.json({ profile: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /research/integrations/orcid/lookup/:orcidId — public ORCID API lookup
router.get('/research/integrations/orcid/lookup/:orcidId', async (req, res) => {
  try {
    const orcidId = req.params.orcidId;
    if (!/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/.test(orcidId)) {
      return res.status(400).json({ error: 'Invalid ORCID iD format' });
    }
    const response = await fetch(`https://pub.orcid.org/v3.0/${orcidId}/person`, {
      headers: { 'Accept': 'application/json' }
    });
    if (!response.ok) return res.status(404).json({ error: 'ORCID profile not found' });
    const data = await response.json();
    const name = data.name || {};
    res.json({
      orcid_id: orcidId,
      given_name: name['given-names']?.value || '',
      family_name: name['family-name']?.value || '',
      display_name: [name['given-names']?.value, name['family-name']?.value].filter(Boolean).join(' '),
      biography: data.biography?.content || '',
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ========================================================================
// DATACITE DOI MANAGEMENT
// ========================================================================

// GET /research/integrations/dois — list DOI records
router.get('/research/integrations/dois', async (req, res) => {
  try {
    const farmId = req.farmId || req.headers['x-farm-id'];
    const result = await query(
      'SELECT * FROM dataset_dois WHERE farm_id = $1 ORDER BY created_at DESC',
      [farmId]
    );
    res.json({ dois: result.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /research/integrations/dois — prepare DOI metadata
router.post('/research/integrations/dois', async (req, res) => {
  try {
    const farmId = req.farmId || req.headers['x-farm-id'];
    const { entity_type, entity_id, datacite_metadata } = req.body;
    if (!entity_type || !entity_id) {
      return res.status(400).json({ error: 'entity_type and entity_id required' });
    }
    const result = await query(
      `INSERT INTO dataset_dois (farm_id, entity_type, entity_id, datacite_metadata, created_at)
       VALUES ($1, $2, $3, $4, NOW()) RETURNING *`,
      [farmId, entity_type, entity_id, JSON.stringify(datacite_metadata || {})]
    );
    res.json({ doi_record: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ========================================================================
// OSF PROJECT MANAGEMENT
// ========================================================================

// GET /research/integrations/osf/projects — list linked OSF projects
router.get('/research/integrations/osf/projects', async (req, res) => {
  try {
    const farmId = req.farmId || req.headers['x-farm-id'];
    const result = await query(
      'SELECT * FROM osf_projects WHERE farm_id = $1 ORDER BY created_at DESC',
      [farmId]
    );
    res.json({ projects: result.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /research/integrations/osf/projects — create/link OSF project
router.post('/research/integrations/osf/projects', async (req, res) => {
  try {
    const farmId = req.farmId || req.headers['x-farm-id'];
    const { osf_project_id, study_id, title } = req.body;
    if (!title) return res.status(400).json({ error: 'Project title required' });
    const osfUrl = osf_project_id ? `https://osf.io/${osf_project_id}/` : null;
    const result = await query(
      `INSERT INTO osf_projects (farm_id, osf_project_id, study_id, title, osf_url, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING *`,
      [farmId, osf_project_id || null, study_id || null, title, osfUrl]
    );
    res.json({ project: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ========================================================================
// PROTOCOLS.IO INTEGRATION
// ========================================================================

// GET /research/integrations/protocols — list protocol versions
router.get('/research/integrations/protocols', async (req, res) => {
  try {
    const farmId = req.farmId || req.headers['x-farm-id'];
    let sql = 'SELECT * FROM research_protocol_versions WHERE farm_id = $1';
    const p = [farmId];
    if (req.query.study_id) { p.push(req.query.study_id); sql += ` AND study_id = $${p.length}`; }
    if (req.query.status) { p.push(req.query.status); sql += ` AND status = $${p.length}`; }
    sql += ' ORDER BY protocol_name, version_number DESC';
    const result = await query(sql, p);
    res.json({ protocols: result.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /research/integrations/protocols — create protocol version
router.post('/research/integrations/protocols', async (req, res) => {
  try {
    const farmId = req.farmId || req.headers['x-farm-id'];
    const { protocol_name, study_id, content, protocols_io_id } = req.body;
    if (!protocol_name) return res.status(400).json({ error: 'Protocol name required' });
    // Auto-increment version
    const existing = await query(
      'SELECT MAX(version_number) as max_v FROM research_protocol_versions WHERE farm_id = $1 AND protocol_name = $2',
      [farmId, protocol_name]
    );
    const nextVersion = (existing.rows[0]?.max_v || 0) + 1;
    const result = await query(
      `INSERT INTO research_protocol_versions (farm_id, study_id, protocol_name, version_number, protocols_io_id, content, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW()) RETURNING *`,
      [farmId, study_id || null, protocol_name, nextVersion, protocols_io_id || null, JSON.stringify(content || {}), req.userId]
    );
    res.json({ protocol: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /research/integrations/protocols/:id/approve — approve protocol
router.patch('/research/integrations/protocols/:id/approve', async (req, res) => {
  try {
    const farmId = req.farmId || req.headers['x-farm-id'];
    const result = await query(
      `UPDATE research_protocol_versions SET status = 'approved', approved_by = $1, approved_at = NOW(), updated_at = NOW()
       WHERE id = $2 AND farm_id = $3 RETURNING *`,
      [req.userId, req.params.id, farmId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Protocol not found' });
    res.json({ protocol: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ========================================================================
// INSTRUMENT REGISTRY (SiLA 2, OPC UA, SCPI abstraction)
// ========================================================================

// GET /research/integrations/instruments — list instruments
router.get('/research/integrations/instruments', async (req, res) => {
  try {
    const farmId = req.farmId || req.headers['x-farm-id'];
    let sql = 'SELECT * FROM instrument_registry WHERE farm_id = $1';
    const p = [farmId];
    if (req.query.status) { p.push(req.query.status); sql += ` AND status = $${p.length}`; }
    if (req.query.type) { p.push(req.query.type); sql += ` AND instrument_type = $${p.length}`; }
    sql += ' ORDER BY instrument_name';
    const result = await query(sql, p);
    res.json({ instruments: result.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /research/integrations/instruments — register instrument
router.post('/research/integrations/instruments', async (req, res) => {
  try {
    const farmId = req.farmId || req.headers['x-farm-id'];
    const { instrument_name, instrument_type, manufacturer, model, serial_number,
            connection_protocol, connection_config, capabilities, location } = req.body;
    if (!instrument_name) return res.status(400).json({ error: 'Instrument name required' });
    const validProtocols = ['sila2', 'opcua', 'scpi', 'mqtt', 'rest', 'vendor_sdk', 'manual'];
    if (connection_protocol && !validProtocols.includes(connection_protocol)) {
      return res.status(400).json({ error: 'Invalid connection_protocol. Supported: ' + validProtocols.join(', ') });
    }
    const result = await query(
      `INSERT INTO instrument_registry (farm_id, instrument_name, instrument_type, manufacturer, model,
       serial_number, connection_protocol, connection_config, capabilities, location, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW()) RETURNING *`,
      [farmId, instrument_name, instrument_type || null, manufacturer || null, model || null,
       serial_number || null, connection_protocol || 'manual',
       JSON.stringify(connection_config || {}), JSON.stringify(capabilities || []), location || null]
    );
    res.json({ instrument: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /research/integrations/instruments/:id/session — create instrument session
router.post('/research/integrations/instruments/:id/session', async (req, res) => {
  try {
    const farmId = req.farmId || req.headers['x-farm-id'];
    const inst = await query('SELECT id FROM instrument_registry WHERE id = $1 AND farm_id = $2', [req.params.id, farmId]);
    if (!inst.rows.length) return res.status(404).json({ error: 'Instrument not found' });
    const { study_id, session_type, parameters } = req.body;
    const result = await query(
      `INSERT INTO instrument_sessions (farm_id, instrument_id, study_id, session_type, parameters, started_by, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,NOW()) RETURNING *`,
      [farmId, req.params.id, study_id || null, session_type || 'data_collection',
       JSON.stringify(parameters || {}), req.userId]
    );
    res.json({ session: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /research/integrations/instruments/:id/telemetry — get instrument telemetry
router.get('/research/integrations/instruments/:id/telemetry', async (req, res) => {
  try {
    const farmId = req.farmId || req.headers['x-farm-id'];
    const hours = parseInt(req.query.hours) || 24;
    const result = await query(
      `SELECT * FROM instrument_telemetry WHERE farm_id = $1 AND instrument_id = $2
       AND recorded_at > NOW() - INTERVAL '1 hour' * $3 ORDER BY recorded_at DESC LIMIT 500`,
      [farmId, req.params.id, hours]
    );
    res.json({ telemetry: result.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ========================================================================
// WORKFLOW ENGINE (Nextflow-compatible)
// ========================================================================

// GET /research/integrations/workflows — list workflow definitions
router.get('/research/integrations/workflows', async (req, res) => {
  try {
    const farmId = req.farmId || req.headers['x-farm-id'];
    let sql = 'SELECT * FROM workflow_definitions WHERE farm_id = $1';
    const p = [farmId];
    if (req.query.type) { p.push(req.query.type); sql += ` AND workflow_type = $${p.length}`; }
    if (req.query.status) { p.push(req.query.status); sql += ` AND status = $${p.length}`; }
    sql += ' ORDER BY workflow_name';
    const result = await query(sql, p);
    res.json({ workflows: result.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /research/integrations/workflows — create workflow definition
router.post('/research/integrations/workflows', async (req, res) => {
  try {
    const farmId = req.farmId || req.headers['x-farm-id'];
    const { workflow_name, workflow_type, engine, template_id, definition } = req.body;
    if (!workflow_name) return res.status(400).json({ error: 'Workflow name required' });
    const result = await query(
      `INSERT INTO workflow_definitions (farm_id, workflow_name, workflow_type, engine, template_id, definition, created_by, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NOW()) RETURNING *`,
      [farmId, workflow_name, workflow_type || 'analysis', engine || 'nextflow',
       template_id || null, JSON.stringify(definition || {}), req.userId]
    );
    res.json({ workflow: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /research/integrations/workflows/:id/run — submit workflow run
router.post('/research/integrations/workflows/:id/run', async (req, res) => {
  try {
    const farmId = req.farmId || req.headers['x-farm-id'];
    const wf = await query('SELECT id FROM workflow_definitions WHERE id = $1 AND farm_id = $2', [req.params.id, farmId]);
    if (!wf.rows.length) return res.status(404).json({ error: 'Workflow not found' });
    const { study_id, parameters, inputs, execution_target } = req.body;
    const result = await query(
      `INSERT INTO workflow_runs (farm_id, workflow_id, study_id, parameters, inputs, execution_target, submitted_by, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NOW()) RETURNING *`,
      [farmId, req.params.id, study_id || null, JSON.stringify(parameters || {}),
       JSON.stringify(inputs || {}), execution_target || 'local', req.userId]
    );
    res.json({ run: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /research/integrations/workflow-runs — list workflow runs
router.get('/research/integrations/workflow-runs', async (req, res) => {
  try {
    const farmId = req.farmId || req.headers['x-farm-id'];
    let sql = `SELECT wr.*, wd.workflow_name FROM workflow_runs wr
               LEFT JOIN workflow_definitions wd ON wr.workflow_id = wd.id
               WHERE wr.farm_id = $1`;
    const p = [farmId];
    if (req.query.status) { p.push(req.query.status); sql += ` AND wr.run_status = $${p.length}`; }
    sql += ' ORDER BY wr.created_at DESC LIMIT 50';
    const result = await query(sql, p);
    res.json({ runs: result.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ========================================================================
// GLOBUS DATA TRANSFER
// ========================================================================

// GET /research/integrations/globus/transfers — list transfers
router.get('/research/integrations/globus/transfers', async (req, res) => {
  try {
    const farmId = req.farmId || req.headers['x-farm-id'];
    const result = await query(
      'SELECT * FROM globus_transfers WHERE farm_id = $1 ORDER BY created_at DESC LIMIT 50',
      [farmId]
    );
    res.json({ transfers: result.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /research/integrations/globus/transfers — initiate transfer
router.post('/research/integrations/globus/transfers', async (req, res) => {
  try {
    const farmId = req.farmId || req.headers['x-farm-id'];
    const { direction, source_endpoint, destination_endpoint, files, partner_institution } = req.body;
    if (!direction || !source_endpoint || !destination_endpoint) {
      return res.status(400).json({ error: 'direction, source_endpoint, and destination_endpoint required' });
    }
    const result = await query(
      `INSERT INTO globus_transfers (farm_id, direction, source_endpoint, destination_endpoint, files, partner_institution, initiated_by, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NOW()) RETURNING *`,
      [farmId, direction, source_endpoint, destination_endpoint,
       JSON.stringify(files || []), partner_institution || null, req.userId]
    );
    res.json({ transfer: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ========================================================================
// GOVERNANCE (Roles, Approvals, Immutable Records)
// ========================================================================

// GET /research/integrations/roles — list research roles
router.get('/research/integrations/roles', async (req, res) => {
  try {
    const farmId = req.farmId || req.headers['x-farm-id'];
    let sql = 'SELECT * FROM research_roles WHERE farm_id = $1';
    const p = [farmId];
    if (req.query.study_id) { p.push(req.query.study_id); sql += ` AND (study_id = $${p.length} OR study_id IS NULL)`; }
    sql += ' ORDER BY role_name';
    const result = await query(sql, p);
    res.json({ roles: result.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /research/integrations/roles — assign role
router.post('/research/integrations/roles', async (req, res) => {
  try {
    const farmId = req.farmId || req.headers['x-farm-id'];
    const { user_id, orcid_id, researcher_name, role_name, study_id, permissions } = req.body;
    if (!role_name) return res.status(400).json({ error: 'role_name required' });
    const validRoles = ['pi', 'co_pi', 'postdoc', 'grad_student', 'technician', 'collaborator', 'viewer'];
    if (!validRoles.includes(role_name)) {
      return res.status(400).json({ error: 'Invalid role. Supported: ' + validRoles.join(', ') });
    }
    const result = await query(
      `INSERT INTO research_roles (farm_id, user_id, orcid_id, researcher_name, role_name, study_id, permissions, granted_by, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW()) RETURNING *`,
      [farmId, user_id || null, orcid_id || null, researcher_name || null,
       role_name, study_id || null, JSON.stringify(permissions || {}), req.userId]
    );
    res.json({ role: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /research/integrations/approvals — list approval gates
router.get('/research/integrations/approvals', async (req, res) => {
  try {
    const farmId = req.farmId || req.headers['x-farm-id'];
    let sql = 'SELECT * FROM approval_gates WHERE farm_id = $1';
    const p = [farmId];
    if (req.query.status) { p.push(req.query.status); sql += ` AND status = $${p.length}`; }
    sql += ' ORDER BY requested_at DESC LIMIT 50';
    const result = await query(sql, p);
    res.json({ approvals: result.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /research/integrations/approvals — request approval
router.post('/research/integrations/approvals', async (req, res) => {
  try {
    const farmId = req.farmId || req.headers['x-farm-id'];
    const { gate_type, entity_type, entity_id, justification } = req.body;
    if (!gate_type) return res.status(400).json({ error: 'gate_type required' });
    const result = await query(
      `INSERT INTO approval_gates (farm_id, gate_type, entity_type, entity_id, requested_by, justification, requested_at)
       VALUES ($1,$2,$3,$4,$5,$6,NOW()) RETURNING *`,
      [farmId, gate_type, entity_type || null, entity_id || null, req.userId, justification || null]
    );
    res.json({ approval: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /research/integrations/approvals/:id — resolve approval
router.patch('/research/integrations/approvals/:id', async (req, res) => {
  try {
    const farmId = req.farmId || req.headers['x-farm-id'];
    const { status, review_notes } = req.body;
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'status must be approved or rejected' });
    }
    const result = await query(
      `UPDATE approval_gates SET status = $1, approved_by = $2, review_notes = $3, resolved_at = NOW()
       WHERE id = $4 AND farm_id = $5 AND status = 'pending' RETURNING *`,
      [status, req.userId, review_notes || null, req.params.id, farmId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Approval not found or already resolved' });
    res.json({ approval: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /research/integrations/immutable-records — list sealed records
router.get('/research/integrations/immutable-records', async (req, res) => {
  try {
    const farmId = req.farmId || req.headers['x-farm-id'];
    let sql = 'SELECT id, farm_id, record_type, source_table, source_id, record_hash, sealed_by, sealed_at, verification_status FROM immutable_run_records WHERE farm_id = $1';
    const p = [farmId];
    if (req.query.type) { p.push(req.query.type); sql += ` AND record_type = $${p.length}`; }
    sql += ' ORDER BY sealed_at DESC LIMIT 50';
    const result = await query(sql, p);
    res.json({ records: result.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /research/integrations/immutable-records — seal a run record
router.post('/research/integrations/immutable-records', async (req, res) => {
  try {
    const farmId = req.farmId || req.headers['x-farm-id'];
    const { record_type, source_table, source_id, snapshot } = req.body;
    if (!record_type || !snapshot) {
      return res.status(400).json({ error: 'record_type and snapshot required' });
    }
    const hash = crypto.createHash('sha512').update(JSON.stringify(snapshot)).digest('hex');
    const result = await query(
      `INSERT INTO immutable_run_records (farm_id, record_type, source_table, source_id, record_hash, snapshot, sealed_by, sealed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NOW()) RETURNING *`,
      [farmId, record_type, source_table || null, source_id || null, hash, JSON.stringify(snapshot), req.userId]
    );
    res.json({ record: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /research/integrations/immutable-records/:id/verify — verify integrity
router.get('/research/integrations/immutable-records/:id/verify', async (req, res) => {
  try {
    const farmId = req.farmId || req.headers['x-farm-id'];
    const result = await query(
      'SELECT * FROM immutable_run_records WHERE id = $1 AND farm_id = $2',
      [req.params.id, farmId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Record not found' });
    const record = result.rows[0];
    const computedHash = crypto.createHash('sha512').update(JSON.stringify(record.snapshot)).digest('hex');
    const valid = computedHash === record.record_hash;
    if (!valid) {
      await query('UPDATE immutable_run_records SET verification_status = $1 WHERE id = $2', ['tampered', record.id]);
    }
    res.json({ record_id: record.id, valid, stored_hash: record.record_hash, computed_hash: computedHash });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ========================================================================
// CFD PIPELINE (FreeCAD -> Gmsh -> OpenFOAM -> ParaView)
// ========================================================================

// GET /research/integrations/cfd/jobs — list CFD pipeline jobs
router.get('/research/integrations/cfd/jobs', async (req, res) => {
  try {
    const farmId = req.farmId || req.headers['x-farm-id'];
    let sql = 'SELECT * FROM cfd_pipeline_jobs WHERE farm_id = $1';
    const p = [farmId];
    if (req.query.template_type) { p.push(req.query.template_type); sql += ` AND template_type = $${p.length}`; }
    if (req.query.status) { p.push(req.query.status); sql += ` AND status = $${p.length}`; }
    sql += ' ORDER BY created_at DESC LIMIT 50';
    const result = await query(sql, p);
    res.json({ jobs: result.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /research/integrations/cfd/jobs — create CFD job
router.post('/research/integrations/cfd/jobs', async (req, res) => {
  try {
    const farmId = req.farmId || req.headers['x-farm-id'];
    const { job_name, template_type, study_id, geometry_config, mesh_config, solver_config, execution_target } = req.body;
    if (!job_name) return res.status(400).json({ error: 'Job name required' });
    const validTemplates = ['microfluidic_channel', 'airflow_enclosure', 'mixing_vessel', 'heat_flow_chamber', 'nft_channel', 'bioreactor', 'custom'];
    if (template_type && !validTemplates.includes(template_type)) {
      return res.status(400).json({ error: 'Invalid template. Supported: ' + validTemplates.join(', ') });
    }
    const result = await query(
      `INSERT INTO cfd_pipeline_jobs (farm_id, study_id, job_name, template_type, geometry_config, mesh_config, solver_config, execution_target, submitted_by, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW()) RETURNING *`,
      [farmId, study_id || null, job_name, template_type || 'custom',
       JSON.stringify(geometry_config || {}), JSON.stringify(mesh_config || {}),
       JSON.stringify(solver_config || {}), execution_target || 'local', req.userId]
    );
    res.json({ job: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /research/integrations/cfd/jobs/:id/stage — advance pipeline stage
router.patch('/research/integrations/cfd/jobs/:id/stage', async (req, res) => {
  try {
    const farmId = req.farmId || req.headers['x-farm-id'];
    const { stage, config, results } = req.body;
    const validStages = ['geometry', 'meshing', 'solving', 'post_processing', 'complete'];
    if (!validStages.includes(stage)) {
      return res.status(400).json({ error: 'Invalid stage. Order: ' + validStages.join(' -> ') });
    }
    const configField = { geometry: 'geometry_config', meshing: 'mesh_config', solving: 'solver_config', post_processing: 'visualization_config' }[stage];
    let sql = 'UPDATE cfd_pipeline_jobs SET pipeline_stage = $1';
    const p = [stage];
    if (configField && config) { p.push(JSON.stringify(config)); sql += `, ${configField} = $${p.length}`; }
    if (results) { p.push(JSON.stringify(results)); sql += `, results = $${p.length}`; }
    if (stage === 'complete') { sql += ', status = \'completed\', completed_at = NOW()'; }
    else { sql += ', status = \'running\''; }
    p.push(req.params.id); sql += ` WHERE id = $${p.length}`;
    p.push(farmId); sql += ` AND farm_id = $${p.length} RETURNING *`;
    const result = await query(sql, p);
    if (!result.rows.length) return res.status(404).json({ error: 'CFD job not found' });
    res.json({ job: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ========================================================================
// MLFLOW EXPERIMENT TRACKING
// ========================================================================

// GET /research/integrations/mlflow/experiments — list experiments
router.get('/research/integrations/mlflow/experiments', async (req, res) => {
  try {
    const farmId = req.farmId || req.headers['x-farm-id'];
    const result = await query(
      'SELECT * FROM mlflow_experiments WHERE farm_id = $1 ORDER BY created_at DESC',
      [farmId]
    );
    res.json({ experiments: result.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /research/integrations/mlflow/experiments — create experiment
router.post('/research/integrations/mlflow/experiments', async (req, res) => {
  try {
    const farmId = req.farmId || req.headers['x-farm-id'];
    const { experiment_name, study_id, mlflow_tracking_uri, description, tags } = req.body;
    if (!experiment_name) return res.status(400).json({ error: 'Experiment name required' });
    const result = await query(
      `INSERT INTO mlflow_experiments (farm_id, study_id, experiment_name, mlflow_tracking_uri, description, tags, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,NOW()) RETURNING *`,
      [farmId, study_id || null, experiment_name, mlflow_tracking_uri || null, description || null, JSON.stringify(tags || {})]
    );
    res.json({ experiment: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /research/integrations/mlflow/runs — log a run
router.post('/research/integrations/mlflow/runs', async (req, res) => {
  try {
    const farmId = req.farmId || req.headers['x-farm-id'];
    const { experiment_id, run_name, parameters, metrics, artifacts, code_version } = req.body;
    if (!experiment_id) return res.status(400).json({ error: 'experiment_id required' });
    const result = await query(
      `INSERT INTO mlflow_runs (farm_id, experiment_id, run_name, parameters, metrics, artifacts, code_version, started_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW()) RETURNING *`,
      [farmId, experiment_id, run_name || null, JSON.stringify(parameters || {}),
       JSON.stringify(metrics || {}), JSON.stringify(artifacts || []), code_version || null]
    );
    res.json({ run: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ========================================================================
// JUPYTER SESSION TRACKING
// ========================================================================

// GET /research/integrations/jupyter/sessions — list sessions
router.get('/research/integrations/jupyter/sessions', async (req, res) => {
  try {
    const farmId = req.farmId || req.headers['x-farm-id'];
    const result = await query(
      'SELECT * FROM jupyter_sessions WHERE farm_id = $1 ORDER BY last_activity_at DESC NULLS LAST',
      [farmId]
    );
    res.json({ sessions: result.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /research/integrations/jupyter/sessions — register session
router.post('/research/integrations/jupyter/sessions', async (req, res) => {
  try {
    const farmId = req.farmId || req.headers['x-farm-id'];
    const { study_id, jupyter_server_url, notebook_path, kernel_name } = req.body;
    const result = await query(
      `INSERT INTO jupyter_sessions (farm_id, user_id, study_id, jupyter_server_url, notebook_path, kernel_name, created_at, last_activity_at)
       VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW()) RETURNING *`,
      [farmId, req.userId, study_id || null, jupyter_server_url || null, notebook_path || null, kernel_name || 'python3']
    );
    res.json({ session: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

export default router;
