/**
 * Research Security Routes
 * Research Platform Phase 2 -- Data classification, access controls, security incidents
 *
 * Endpoints:
 *   GET/POST   /research/security/classifications         -- Data classification policies
 *   GET/PATCH  /research/security/classifications/:id      -- Get/update classification
 *   GET/POST   /research/security/access-policies          -- Access control policies
 *   PATCH      /research/security/access-policies/:id      -- Update access policy
 *   GET/POST   /research/security/incidents                -- Security incidents
 *   PATCH      /research/security/incidents/:id            -- Update incident
 *   PATCH      /research/security/incidents/:id/status     -- Incident workflow
 *   GET/POST   /research/security/audits                   -- Security audit records
 *   GET        /research/security/dashboard                -- Security overview
 */
import { Router } from 'express';
import { query, isDatabaseAvailable } from '../config/database.js';

const router = Router();

const checkDb = (req, res, next) => {
  if (!isDatabaseAvailable()) return res.status(503).json({ ok: false, error: 'Database unavailable' });
  next();
};

router.use(checkDb);

// ── Data Classification ──

router.get('/research/security/classifications', async (req, res) => {
  try {
    const farmId = req.farmId || req.query.farm_id;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const { level, resource_type } = req.query;
    const params = [farmId];
    let where = 'WHERE dc.farm_id = $1';
    if (level) { params.push(level); where += ` AND dc.classification_level = $${params.length}`; }
    if (resource_type) { params.push(resource_type); where += ` AND dc.resource_type = $${params.length}`; }

    const result = await query(`
      SELECT dc.* FROM data_classifications dc ${where} ORDER BY dc.created_at DESC
    `, params);

    res.json({ ok: true, classifications: result.rows, count: result.rows.length });
  } catch (err) {
    console.error('[ResearchSecurity] Classifications list error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to list classifications' });
  }
});

router.post('/research/security/classifications', async (req, res) => {
  try {
    const farmId = req.farmId;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const { resource_type, resource_id, classification_level, justification,
            handling_instructions, retention_period_days } = req.body;
    if (!resource_type || !classification_level) {
      return res.status(400).json({ ok: false, error: 'resource_type and classification_level required' });
    }

    const validLevels = ['public', 'internal', 'confidential', 'restricted'];
    if (!validLevels.includes(classification_level)) {
      return res.status(400).json({ ok: false, error: `classification_level must be one of: ${validLevels.join(', ')}` });
    }

    const result = await query(`
      INSERT INTO data_classifications (farm_id, resource_type, resource_id, classification_level,
        justification, handling_instructions, retention_period_days)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [farmId, resource_type, resource_id || null, classification_level,
        justification || null, handling_instructions || null, retention_period_days || null]);

    res.status(201).json({ ok: true, classification: result.rows[0] });
  } catch (err) {
    console.error('[ResearchSecurity] Classification create error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to create classification' });
  }
});

router.get('/research/security/classifications/:id', async (req, res) => {
  try {
    const result = await query('SELECT * FROM data_classifications WHERE id = $1', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ ok: false, error: 'Classification not found' });
    res.json({ ok: true, classification: result.rows[0] });
  } catch (err) {
    console.error('[ResearchSecurity] Classification get error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to get classification' });
  }
});

router.patch('/research/security/classifications/:id', async (req, res) => {
  try {
    const { classification_level, justification, handling_instructions, retention_period_days } = req.body;
    const fields = [];
    const params = [];
    let idx = 1;
    if (classification_level !== undefined) { fields.push(`classification_level = $${idx}`); params.push(classification_level); idx++; }
    if (justification !== undefined) { fields.push(`justification = $${idx}`); params.push(justification); idx++; }
    if (handling_instructions !== undefined) { fields.push(`handling_instructions = $${idx}`); params.push(handling_instructions); idx++; }
    if (retention_period_days !== undefined) { fields.push(`retention_period_days = $${idx}`); params.push(retention_period_days); idx++; }
    if (!fields.length) return res.status(400).json({ ok: false, error: 'No fields to update' });

    fields.push('updated_at = NOW()');
    params.push(req.params.id);
    const result = await query(`UPDATE data_classifications SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`, params);
    if (!result.rows.length) return res.status(404).json({ ok: false, error: 'Classification not found' });
    res.json({ ok: true, classification: result.rows[0] });
  } catch (err) {
    console.error('[ResearchSecurity] Classification update error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to update classification' });
  }
});

// ── Access Control Policies ──

router.get('/research/security/access-policies', async (req, res) => {
  try {
    const farmId = req.farmId || req.query.farm_id;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const result = await query('SELECT * FROM access_control_policies WHERE farm_id = $1 ORDER BY created_at DESC', [farmId]);
    res.json({ ok: true, policies: result.rows, count: result.rows.length });
  } catch (err) {
    console.error('[ResearchSecurity] Policies list error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to list access policies' });
  }
});

router.post('/research/security/access-policies', async (req, res) => {
  try {
    const farmId = req.farmId;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const { name, description, classification_level, allowed_roles, requires_mfa,
            requires_vpn, max_export_rows, ip_restrictions } = req.body;
    if (!name || !classification_level) {
      return res.status(400).json({ ok: false, error: 'name and classification_level required' });
    }

    const result = await query(`
      INSERT INTO access_control_policies (farm_id, name, description, classification_level,
        allowed_roles, requires_mfa, requires_vpn, max_export_rows, ip_restrictions)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `, [farmId, name, description || null, classification_level,
        JSON.stringify(allowed_roles || []), requires_mfa || false, requires_vpn || false,
        max_export_rows || null, JSON.stringify(ip_restrictions || [])]);

    res.status(201).json({ ok: true, policy: result.rows[0] });
  } catch (err) {
    console.error('[ResearchSecurity] Policy create error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to create access policy' });
  }
});

router.patch('/research/security/access-policies/:id', async (req, res) => {
  try {
    const { name, description, allowed_roles, requires_mfa, requires_vpn,
            max_export_rows, ip_restrictions } = req.body;
    const fields = [];
    const params = [];
    let idx = 1;
    if (name !== undefined) { fields.push(`name = $${idx}`); params.push(name); idx++; }
    if (description !== undefined) { fields.push(`description = $${idx}`); params.push(description); idx++; }
    if (allowed_roles !== undefined) { fields.push(`allowed_roles = $${idx}`); params.push(JSON.stringify(allowed_roles)); idx++; }
    if (requires_mfa !== undefined) { fields.push(`requires_mfa = $${idx}`); params.push(requires_mfa); idx++; }
    if (requires_vpn !== undefined) { fields.push(`requires_vpn = $${idx}`); params.push(requires_vpn); idx++; }
    if (max_export_rows !== undefined) { fields.push(`max_export_rows = $${idx}`); params.push(max_export_rows); idx++; }
    if (ip_restrictions !== undefined) { fields.push(`ip_restrictions = $${idx}`); params.push(JSON.stringify(ip_restrictions)); idx++; }
    if (!fields.length) return res.status(400).json({ ok: false, error: 'No fields to update' });

    fields.push('updated_at = NOW()');
    params.push(req.params.id);
    const result = await query(`UPDATE access_control_policies SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`, params);
    if (!result.rows.length) return res.status(404).json({ ok: false, error: 'Policy not found' });
    res.json({ ok: true, policy: result.rows[0] });
  } catch (err) {
    console.error('[ResearchSecurity] Policy update error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to update access policy' });
  }
});

// ── Security Incidents ──

router.get('/research/security/incidents', async (req, res) => {
  try {
    const farmId = req.farmId || req.query.farm_id;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const { severity, status } = req.query;
    const params = [farmId];
    let where = 'WHERE si.farm_id = $1';
    if (severity) { params.push(severity); where += ` AND si.severity = $${params.length}`; }
    if (status) { params.push(status); where += ` AND si.status = $${params.length}`; }

    const result = await query(`SELECT si.* FROM security_incidents si ${where} ORDER BY si.reported_at DESC`, params);
    res.json({ ok: true, incidents: result.rows, count: result.rows.length });
  } catch (err) {
    console.error('[ResearchSecurity] Incidents list error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to list incidents' });
  }
});

router.post('/research/security/incidents', async (req, res) => {
  try {
    const farmId = req.farmId;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const { incident_type, severity, title, description, affected_resources,
            reported_by, containment_actions } = req.body;
    if (!incident_type || !severity || !title) {
      return res.status(400).json({ ok: false, error: 'incident_type, severity, and title required' });
    }

    const validSeverities = ['low', 'medium', 'high', 'critical'];
    if (!validSeverities.includes(severity)) {
      return res.status(400).json({ ok: false, error: `severity must be one of: ${validSeverities.join(', ')}` });
    }

    const result = await query(`
      INSERT INTO security_incidents (farm_id, incident_type, severity, title, description,
        affected_resources, reported_by, containment_actions, status, reported_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'reported', NOW())
      RETURNING *
    `, [farmId, incident_type, severity, title, description || null,
        JSON.stringify(affected_resources || []), reported_by || null,
        JSON.stringify(containment_actions || [])]);

    res.status(201).json({ ok: true, incident: result.rows[0] });
  } catch (err) {
    console.error('[ResearchSecurity] Incident create error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to create incident' });
  }
});

router.patch('/research/security/incidents/:id', async (req, res) => {
  try {
    const { title, description, affected_resources, containment_actions,
            root_cause, remediation_steps, lessons_learned } = req.body;
    const fields = [];
    const params = [];
    let idx = 1;
    if (title !== undefined) { fields.push(`title = $${idx}`); params.push(title); idx++; }
    if (description !== undefined) { fields.push(`description = $${idx}`); params.push(description); idx++; }
    if (affected_resources !== undefined) { fields.push(`affected_resources = $${idx}`); params.push(JSON.stringify(affected_resources)); idx++; }
    if (containment_actions !== undefined) { fields.push(`containment_actions = $${idx}`); params.push(JSON.stringify(containment_actions)); idx++; }
    if (root_cause !== undefined) { fields.push(`root_cause = $${idx}`); params.push(root_cause); idx++; }
    if (remediation_steps !== undefined) { fields.push(`remediation_steps = $${idx}`); params.push(JSON.stringify(remediation_steps)); idx++; }
    if (lessons_learned !== undefined) { fields.push(`lessons_learned = $${idx}`); params.push(lessons_learned); idx++; }
    if (!fields.length) return res.status(400).json({ ok: false, error: 'No fields to update' });

    fields.push('updated_at = NOW()');
    params.push(req.params.id);
    const result = await query(`UPDATE security_incidents SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`, params);
    if (!result.rows.length) return res.status(404).json({ ok: false, error: 'Incident not found' });
    res.json({ ok: true, incident: result.rows[0] });
  } catch (err) {
    console.error('[ResearchSecurity] Incident update error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to update incident' });
  }
});

router.patch('/research/security/incidents/:id/status', async (req, res) => {
  try {
    const { status, resolved_at } = req.body;
    if (!status) return res.status(400).json({ ok: false, error: 'status required' });

    const validTransitions = {
      reported: ['investigating', 'dismissed'],
      investigating: ['contained', 'escalated'],
      contained: ['remediating'],
      escalated: ['contained', 'remediating'],
      remediating: ['resolved'],
      resolved: ['closed'],
      dismissed: ['closed']
    };

    const current = await query('SELECT status FROM security_incidents WHERE id = $1', [req.params.id]);
    if (!current.rows.length) return res.status(404).json({ ok: false, error: 'Incident not found' });

    const allowed = validTransitions[current.rows[0].status] || [];
    if (!allowed.includes(status)) {
      return res.status(400).json({ ok: false, error: `Cannot transition from ${current.rows[0].status} to ${status}` });
    }

    const fields = ['status = $1', 'updated_at = NOW()'];
    const params = [status];
    let idx = 2;

    if (status === 'resolved' || resolved_at) {
      fields.push(`resolved_at = $${idx}`); params.push(resolved_at || new Date().toISOString()); idx++;
    }

    params.push(req.params.id);
    const result = await query(`UPDATE security_incidents SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`, params);
    res.json({ ok: true, incident: result.rows[0] });
  } catch (err) {
    console.error('[ResearchSecurity] Incident status error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to update incident status' });
  }
});

// ── Security Audits ──

router.get('/research/security/audits', async (req, res) => {
  try {
    const farmId = req.farmId || req.query.farm_id;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const result = await query('SELECT * FROM security_audits WHERE farm_id = $1 ORDER BY audit_date DESC', [farmId]);
    res.json({ ok: true, audits: result.rows, count: result.rows.length });
  } catch (err) {
    console.error('[ResearchSecurity] Audits list error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to list audits' });
  }
});

router.post('/research/security/audits', async (req, res) => {
  try {
    const farmId = req.farmId;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const { audit_type, scope, findings, recommendations, auditor, audit_date, next_audit_date } = req.body;
    if (!audit_type || !scope) return res.status(400).json({ ok: false, error: 'audit_type and scope required' });

    const result = await query(`
      INSERT INTO security_audits (farm_id, audit_type, scope, findings, recommendations,
        auditor, audit_date, next_audit_date)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [farmId, audit_type, scope, JSON.stringify(findings || []),
        JSON.stringify(recommendations || []), auditor || null,
        audit_date || new Date().toISOString(), next_audit_date || null]);

    res.status(201).json({ ok: true, audit: result.rows[0] });
  } catch (err) {
    console.error('[ResearchSecurity] Audit create error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to create audit' });
  }
});

// ── Security Dashboard ──

router.get('/research/security/dashboard', async (req, res) => {
  try {
    const farmId = req.farmId || req.query.farm_id;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const [classificationSummary, openIncidents, policyCount, recentAudits] = await Promise.all([
      query(`SELECT classification_level, COUNT(*) as count FROM data_classifications WHERE farm_id = $1 GROUP BY classification_level ORDER BY CASE classification_level WHEN 'restricted' THEN 1 WHEN 'confidential' THEN 2 WHEN 'internal' THEN 3 WHEN 'public' THEN 4 END`, [farmId]),
      query(`SELECT severity, status, COUNT(*) as count FROM security_incidents WHERE farm_id = $1 AND status NOT IN ('closed', 'dismissed') GROUP BY severity, status ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 END`, [farmId]),
      query(`SELECT COUNT(*) as total FROM access_control_policies WHERE farm_id = $1`, [farmId]),
      query(`SELECT audit_type, audit_date, next_audit_date, auditor FROM security_audits WHERE farm_id = $1 ORDER BY audit_date DESC LIMIT 5`, [farmId])
    ]);

    res.json({
      ok: true,
      classification_summary: classificationSummary.rows,
      open_incidents: openIncidents.rows,
      policy_count: parseInt(policyCount.rows[0]?.total || '0'),
      recent_audits: recentAudits.rows
    });
  } catch (err) {
    console.error('[ResearchSecurity] Dashboard error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to get security dashboard' });
  }
});

export default router;
