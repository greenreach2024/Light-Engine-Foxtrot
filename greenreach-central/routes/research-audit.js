import { Router } from 'express';
import { query, isDatabaseAvailable } from '../config/database.js';
import { verifyStudyOwnership } from '../middleware/research-tenant.js';

const router = Router();

const checkDb = async (req, res, next) => {
  if (!(await isDatabaseAvailable())) {
    return res.status(503).json({ ok: false, error: 'Database not available' });
  }
  next();
};

router.use(checkDb);

// ── Audit Trail, Responsible Conduct, Permissions ──
// audit_log: id, farm_id, study_id, user_id, action, entity_type, entity_id,
//   details (JSONB), ip_address, created_at (immutable -- no UPDATE/DELETE)
// coi_declarations: id, farm_id, study_id, user_id, declaration_type, related_entity,
//   description, disclosed_at, status (pending|reviewed|cleared|flagged), reviewed_by, reviewed_at
// role_signoffs: id, farm_id, study_id, user_id, role_title, responsibilities (JSONB),
//   signed_at, witnessed_by, witnessed_at
// approval_chains: id, farm_id, study_id, entity_type (protocol|budget|recipe|amendment),
//   entity_id, step_order, approver_user_id, status (pending|approved|rejected|skipped),
//   decision_at, comments
// authorship_contributions: id, farm_id, study_id, user_id, contributor_name, role,
//   contribution_description, credit_order, orcid, institution, confirmed_at

// ── Immutable audit log ──
async function logAudit(farmId, studyId, userId, action, entityType, entityId, details, ipAddress) {
  try {
    await query(`
      INSERT INTO audit_log (farm_id, study_id, user_id, action, entity_type, entity_id, details, ip_address)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [farmId, studyId, userId, action, entityType, entityId, JSON.stringify(details || {}), ipAddress || null]);
  } catch (err) {
    console.error('[ResearchAudit] Log write error:', err.message);
  }
}

// ── Query audit log ──
router.get('/research/audit', async (req, res) => {
  try {
    const farmId = req.farmId || req.query.farm_id;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const { study_id, entity_type, action, user_id, limit = 100, offset = 0 } = req.query;
    const params = [farmId];
    let where = 'WHERE a.farm_id = $1';
    if (study_id) { params.push(study_id); where += ` AND a.study_id = $${params.length}`; }
    if (entity_type) { params.push(entity_type); where += ` AND a.entity_type = $${params.length}`; }
    if (action) { params.push(action); where += ` AND a.action = $${params.length}`; }
    if (user_id) { params.push(user_id); where += ` AND a.user_id = $${params.length}`; }
    params.push(parseInt(limit, 10), parseInt(offset, 10));

    const result = await query(`
      SELECT a.*, u.email as user_email
      FROM audit_log a
      LEFT JOIN farm_users u ON a.user_id = u.id
      ${where}
      ORDER BY a.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);

    res.json({ ok: true, entries: result.rows, count: result.rows.length });
  } catch (err) {
    console.error('[ResearchAudit] Query error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to query audit log' });
  }
});

// ── COI Declarations ──
router.get('/research/studies/:id/coi', verifyStudyOwnership, async (req, res) => {
  try {
    const result = await query(`
      SELECT c.*, u.email as user_email, r.email as reviewer_email
      FROM coi_declarations c
      LEFT JOIN farm_users u ON c.user_id = u.id
      LEFT JOIN farm_users r ON c.reviewed_by = r.id
      WHERE c.study_id = $1
      ORDER BY c.disclosed_at DESC
    `, [req.params.id]);

    res.json({ ok: true, declarations: result.rows, count: result.rows.length });
  } catch (err) {
    console.error('[ResearchAudit] COI list error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to list COI declarations' });
  }
});

router.post('/research/studies/:id/coi', verifyStudyOwnership, async (req, res) => {
  try {
    const farmId = req.farmId || req.body.farm_id;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const { declaration_type, related_entity, description } = req.body;
    if (!declaration_type || !description) {
      return res.status(400).json({ ok: false, error: 'declaration_type and description required' });
    }

    const result = await query(`
      INSERT INTO coi_declarations (farm_id, study_id, user_id, declaration_type, related_entity, description)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [farmId, req.params.id, req.userId || null, declaration_type, related_entity || null, description]);

    await logAudit(farmId, req.params.id, req.userId, 'coi_declared', 'coi_declaration', result.rows[0].id, { declaration_type }, req.ip);
    res.status(201).json({ ok: true, declaration: result.rows[0] });
  } catch (err) {
    console.error('[ResearchAudit] COI create error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to create COI declaration' });
  }
});

router.patch('/research/coi/:id/review', async (req, res) => {
  try {
    const { status, comments } = req.body;
    if (!status || !['reviewed', 'cleared', 'flagged'].includes(status)) {
      return res.status(400).json({ ok: false, error: 'Valid status required (reviewed|cleared|flagged)' });
    }

    const result = await query(`
      UPDATE coi_declarations SET status = $1, reviewed_by = $2, reviewed_at = NOW()
      WHERE id = $3 RETURNING *
    `, [status, req.userId || null, req.params.id]);

    if (!result.rows.length) return res.status(404).json({ ok: false, error: 'Declaration not found' });

    await logAudit(result.rows[0].farm_id, result.rows[0].study_id, req.userId, 'coi_reviewed', 'coi_declaration', req.params.id, { status, comments }, req.ip);
    res.json({ ok: true, declaration: result.rows[0] });
  } catch (err) {
    console.error('[ResearchAudit] COI review error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to review COI declaration' });
  }
});

// ── Role Sign-offs ──
router.get('/research/studies/:id/signoffs', verifyStudyOwnership, async (req, res) => {
  try {
    const result = await query(`
      SELECT rs.*, u.email as user_email, w.email as witness_email
      FROM role_signoffs rs
      LEFT JOIN farm_users u ON rs.user_id = u.id
      LEFT JOIN farm_users w ON rs.witnessed_by = w.id
      WHERE rs.study_id = $1
      ORDER BY rs.signed_at DESC
    `, [req.params.id]);

    res.json({ ok: true, signoffs: result.rows, count: result.rows.length });
  } catch (err) {
    console.error('[ResearchAudit] Signoffs list error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to list signoffs' });
  }
});

router.post('/research/studies/:id/signoffs', verifyStudyOwnership, async (req, res) => {
  try {
    const farmId = req.farmId || req.body.farm_id;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const { role_title, responsibilities } = req.body;
    if (!role_title) return res.status(400).json({ ok: false, error: 'role_title required' });

    const result = await query(`
      INSERT INTO role_signoffs (farm_id, study_id, user_id, role_title, responsibilities, signed_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      RETURNING *
    `, [farmId, req.params.id, req.userId || null, role_title, JSON.stringify(responsibilities || {})]);

    await logAudit(farmId, req.params.id, req.userId, 'role_signoff', 'role_signoff', result.rows[0].id, { role_title }, req.ip);
    res.status(201).json({ ok: true, signoff: result.rows[0] });
  } catch (err) {
    console.error('[ResearchAudit] Signoff create error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to create signoff' });
  }
});

// ── Approval Chains ──
router.get('/research/studies/:id/approvals', verifyStudyOwnership, async (req, res) => {
  try {
    const { entity_type, entity_id } = req.query;
    const params = [req.params.id];
    let where = 'WHERE ac.study_id = $1';
    if (entity_type) { params.push(entity_type); where += ` AND ac.entity_type = $${params.length}`; }
    if (entity_id) { params.push(entity_id); where += ` AND ac.entity_id = $${params.length}`; }

    const result = await query(`
      SELECT ac.*, u.email as approver_email
      FROM approval_chains ac
      LEFT JOIN farm_users u ON ac.approver_user_id = u.id
      ${where}
      ORDER BY ac.entity_type, ac.entity_id, ac.step_order
    `, params);

    res.json({ ok: true, approvals: result.rows, count: result.rows.length });
  } catch (err) {
    console.error('[ResearchAudit] Approvals list error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to list approvals' });
  }
});

router.post('/research/studies/:id/approvals', verifyStudyOwnership, async (req, res) => {
  try {
    const farmId = req.farmId || req.body.farm_id;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const { entity_type, entity_id, steps } = req.body;
    if (!entity_type || !entity_id || !Array.isArray(steps) || !steps.length) {
      return res.status(400).json({ ok: false, error: 'entity_type, entity_id, and steps[] required' });
    }
    if (!['protocol', 'budget', 'recipe', 'amendment'].includes(entity_type)) {
      return res.status(400).json({ ok: false, error: 'Invalid entity_type' });
    }

    const results = [];
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const r = await query(`
        INSERT INTO approval_chains (farm_id, study_id, entity_type, entity_id, step_order, approver_user_id)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `, [farmId, req.params.id, entity_type, entity_id, i + 1, step.approver_user_id]);
      results.push(r.rows[0]);
    }

    await logAudit(farmId, req.params.id, req.userId, 'approval_chain_created', entity_type, entity_id, { step_count: steps.length }, req.ip);
    res.status(201).json({ ok: true, approvals: results });
  } catch (err) {
    console.error('[ResearchAudit] Approval create error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to create approval chain' });
  }
});

router.patch('/research/approvals/:id/decide', async (req, res) => {
  try {
    const { status, comments } = req.body;
    if (!status || !['approved', 'rejected', 'skipped'].includes(status)) {
      return res.status(400).json({ ok: false, error: 'Valid status required (approved|rejected|skipped)' });
    }

    const result = await query(`
      UPDATE approval_chains SET status = $1, decision_at = NOW(), comments = $2
      WHERE id = $3 AND approver_user_id = $4
      RETURNING *
    `, [status, comments || null, req.params.id, req.userId || null]);

    if (!result.rows.length) return res.status(404).json({ ok: false, error: 'Approval step not found or not assigned to you' });

    await logAudit(result.rows[0].farm_id, result.rows[0].study_id, req.userId, 'approval_decision', 'approval_chain', req.params.id, { status, comments }, req.ip);
    res.json({ ok: true, approval: result.rows[0] });
  } catch (err) {
    console.error('[ResearchAudit] Approval decide error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to submit approval decision' });
  }
});

// ── Authorship/Contribution Tracker ──
router.get('/research/studies/:id/contributions', verifyStudyOwnership, async (req, res) => {
  try {
    const result = await query(`
      SELECT ac.*, u.email as user_email
      FROM authorship_contributions ac
      LEFT JOIN farm_users u ON ac.user_id = u.id
      WHERE ac.study_id = $1
      ORDER BY ac.credit_order ASC NULLS LAST
    `, [req.params.id]);

    res.json({ ok: true, contributions: result.rows, count: result.rows.length });
  } catch (err) {
    console.error('[ResearchAudit] Contributions list error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to list contributions' });
  }
});

router.post('/research/studies/:id/contributions', verifyStudyOwnership, async (req, res) => {
  try {
    const farmId = req.farmId || req.body.farm_id;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const { contributor_name, role, contribution_description, credit_order, orcid, institution, user_id } = req.body;
    if (!contributor_name || !role) {
      return res.status(400).json({ ok: false, error: 'contributor_name and role required' });
    }

    const result = await query(`
      INSERT INTO authorship_contributions (farm_id, study_id, user_id, contributor_name, role, contribution_description, credit_order, orcid, institution)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `, [farmId, req.params.id, user_id || null, contributor_name, role, contribution_description || null, credit_order || null, orcid || null, institution || null]);

    await logAudit(farmId, req.params.id, req.userId, 'contribution_added', 'authorship', result.rows[0].id, { contributor_name, role }, req.ip);
    res.status(201).json({ ok: true, contribution: result.rows[0] });
  } catch (err) {
    console.error('[ResearchAudit] Contribution create error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to add contribution' });
  }
});

router.patch('/research/contributions/:id', async (req, res) => {
  try {
    const { credit_order, role, contribution_description, confirmed_at } = req.body;
    const fields = [];
    const params = [];
    let idx = 1;
    if (credit_order !== undefined) { fields.push(`credit_order = $${idx}`); params.push(credit_order); idx++; }
    if (role !== undefined) { fields.push(`role = $${idx}`); params.push(role); idx++; }
    if (contribution_description !== undefined) { fields.push(`contribution_description = $${idx}`); params.push(contribution_description); idx++; }
    if (confirmed_at) { fields.push(`confirmed_at = NOW()`); }
    if (!fields.length) return res.status(400).json({ ok: false, error: 'No fields to update' });

    params.push(req.params.id);
    const result = await query(`UPDATE authorship_contributions SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`, params);
    if (!result.rows.length) return res.status(404).json({ ok: false, error: 'Contribution not found' });
    res.json({ ok: true, contribution: result.rows[0] });
  } catch (err) {
    console.error('[ResearchAudit] Contribution update error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to update contribution' });
  }
});

// Export the logAudit function for use by other research route files
export { logAudit };
export default router;
