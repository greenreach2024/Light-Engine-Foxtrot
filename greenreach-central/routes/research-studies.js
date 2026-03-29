/**
 * Research Studies & Protocol Management Routes
 * Research Platform Phase 1 -- Study Design, Protocols, Treatment Groups
 *
 * Endpoints:
 *   GET    /research/studies              -- List studies for farm
 *   POST   /research/studies              -- Create a new study
 *   GET    /research/studies/:id          -- Get study details
 *   PATCH  /research/studies/:id          -- Update study
 *   GET    /research/studies/:id/protocols   -- List protocol versions
 *   POST   /research/studies/:id/protocols   -- Create protocol version
 *   GET    /research/studies/:id/treatments  -- List treatment groups
 *   POST   /research/studies/:id/treatments  -- Create treatment group
 *   POST   /research/studies/:id/link        -- Link entity to study
 *   DELETE /research/studies/:id/link/:linkId -- Unlink entity
 *   GET    /research/studies/:id/timeline    -- Study milestones
 *   POST   /research/studies/:id/milestones  -- Create milestone
 *   PATCH  /research/milestones/:id          -- Update milestone
 *   GET    /research/studies/:id/deviations  -- List deviations
 *   POST   /research/studies/:id/deviations  -- Record deviation
 */
import { Router } from 'express';
import { query, isDatabaseAvailable } from '../config/database.js';
import { verifyMilestoneOwnership, verifyStudyOwnership } from '../middleware/research-tenant.js';

const router = Router();

// ─── Middleware: ensure DB available ───
const checkDb = async (req, res, next) => {
  if (!(await isDatabaseAvailable())) {
    return res.status(503).json({ ok: false, error: 'Database not available' });
  }
  next();
};

router.use(checkDb);

// ─── GET /research/studies ────────────────────────────────────────────
router.get('/research/studies', async (req, res) => {
  try {
    const farmId = req.farmId || req.query.farm_id;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const { status, limit = 50, offset = 0 } = req.query;
    const params = [farmId];
    let where = 'WHERE s.farm_id = $1';
    if (status) {
      params.push(status);
      where += ` AND s.status = $${params.length}`;
    }
    params.push(parseInt(limit, 10), parseInt(offset, 10));

    const result = await query(`
      SELECT s.*, 
        u.email as pi_email,
        (SELECT COUNT(*) FROM study_protocols sp WHERE sp.study_id = s.id) as protocol_count,
        (SELECT COUNT(*) FROM study_links sl WHERE sl.study_id = s.id) as linked_entities
      FROM studies s
      LEFT JOIN farm_users u ON s.pi_user_id = u.id
      ${where}
      ORDER BY s.updated_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);

    res.json({ ok: true, studies: result.rows, count: result.rows.length });
  } catch (err) {
    console.error('[ResearchStudies] List error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to list studies' });
  }
});

// ─── POST /research/studies ───────────────────────────────────────────
router.post('/research/studies', async (req, res) => {
  try {
    const farmId = req.farmId || req.body.farm_id;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const { title, objectives, hypotheses, irb_number, funding_source, pi_user_id, metadata } = req.body;
    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      return res.status(400).json({ ok: false, error: 'title required' });
    }

    const result = await query(`
      INSERT INTO studies (farm_id, title, pi_user_id, objectives, hypotheses, irb_number, funding_source, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [farmId, title.trim(), pi_user_id || null, objectives || null,
        hypotheses || null, irb_number || null, funding_source || null,
        JSON.stringify(metadata || {})]);

    res.status(201).json({ ok: true, study: result.rows[0] });
  } catch (err) {
    console.error('[ResearchStudies] Create error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to create study' });
  }
});

// ─── GET /research/studies/:id ────────────────────────────────────────
router.get('/research/studies/:id', verifyStudyOwnership, async (req, res) => {
  try {
    const { id } = req.params;
    const farmId = req.farmId || req.query.farm_id;

    const result = await query(`
      SELECT s.*, u.email as pi_email
      FROM studies s
      LEFT JOIN farm_users u ON s.pi_user_id = u.id
      WHERE s.id = $1 ${farmId ? 'AND s.farm_id = $2' : ''}
    `, farmId ? [id, farmId] : [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Study not found' });
    }

    // Fetch linked entities
    const links = await query('SELECT * FROM study_links WHERE study_id = $1 ORDER BY linked_at DESC', [id]);

    res.json({ ok: true, study: result.rows[0], links: links.rows });
  } catch (err) {
    console.error('[ResearchStudies] Get error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to get study' });
  }
});

// ─── PATCH /research/studies/:id ──────────────────────────────────────
router.patch('/research/studies/:id', verifyStudyOwnership, async (req, res) => {
  try {
    const { id } = req.params;
    const farmId = req.farmId || req.body.farm_id;
    const allowed = ['title', 'status', 'objectives', 'hypotheses', 'irb_number', 'funding_source', 'pi_user_id', 'metadata'];
    const updates = [];
    const values = [];
    let idx = 1;

    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        updates.push(`${key} = $${idx}`);
        values.push(key === 'metadata' ? JSON.stringify(req.body[key]) : req.body[key]);
        idx++;
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({ ok: false, error: 'No valid fields to update' });
    }

    updates.push(`updated_at = NOW()`);
    values.push(id);
    if (farmId) values.push(farmId);

    const result = await query(`
      UPDATE studies SET ${updates.join(', ')}
      WHERE id = $${idx} ${farmId ? `AND farm_id = $${idx + 1}` : ''}
      RETURNING *
    `, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Study not found' });
    }

    res.json({ ok: true, study: result.rows[0] });
  } catch (err) {
    console.error('[ResearchStudies] Update error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to update study' });
  }
});

// ─── GET /research/studies/:id/protocols ──────────────────────────────
router.get('/research/studies/:id/protocols', verifyStudyOwnership, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await query(`
      SELECT sp.*, u.email as approved_by_email
      FROM study_protocols sp
      LEFT JOIN farm_users u ON sp.approved_by = u.id
      WHERE sp.study_id = $1
      ORDER BY sp.version DESC
    `, [id]);

    res.json({ ok: true, protocols: result.rows });
  } catch (err) {
    console.error('[ResearchStudies] Protocol list error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to list protocols' });
  }
});

// ─── POST /research/studies/:id/protocols ─────────────────────────────
router.post('/research/studies/:id/protocols', verifyStudyOwnership, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content, treatment_factors } = req.body;

    // Auto-increment version
    const versionResult = await query(
      'SELECT COALESCE(MAX(version), 0) + 1 as next_version FROM study_protocols WHERE study_id = $1',
      [id]
    );
    const nextVersion = versionResult.rows[0].next_version;

    // Supersede previous active protocol
    await query(
      "UPDATE study_protocols SET status = 'superseded' WHERE study_id = $1 AND status = 'active'",
      [id]
    );

    const result = await query(`
      INSERT INTO study_protocols (study_id, version, title, content, treatment_factors, status)
      VALUES ($1, $2, $3, $4, $5, 'active')
      RETURNING *
    `, [id, nextVersion, title || null, JSON.stringify(content || {}),
        JSON.stringify(treatment_factors || {})]);

    res.status(201).json({ ok: true, protocol: result.rows[0] });
  } catch (err) {
    console.error('[ResearchStudies] Protocol create error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to create protocol' });
  }
});

// ─── GET /research/studies/:id/treatments ─────────────────────────────
router.get('/research/studies/:id/treatments', verifyStudyOwnership, async (req, res) => {
  try {
    const { id } = req.params;
    const { protocol_id } = req.query;

    let sql = `
      SELECT tg.* FROM treatment_groups tg
      JOIN study_protocols sp ON tg.protocol_id = sp.id
      WHERE sp.study_id = $1
    `;
    const params = [id];

    if (protocol_id) {
      params.push(protocol_id);
      sql += ` AND tg.protocol_id = $${params.length}`;
    }
    sql += ' ORDER BY tg.group_name';

    const result = await query(sql, params);
    res.json({ ok: true, treatment_groups: result.rows });
  } catch (err) {
    console.error('[ResearchStudies] Treatment list error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to list treatment groups' });
  }
});

// ─── POST /research/studies/:id/treatments ────────────────────────────
router.post('/research/studies/:id/treatments', verifyStudyOwnership, async (req, res) => {
  try {
    const { protocol_id, group_name, factor_definitions, control_group, replicate_count } = req.body;
    if (!protocol_id || !group_name) {
      return res.status(400).json({ ok: false, error: 'protocol_id and group_name required' });
    }

    const result = await query(`
      INSERT INTO treatment_groups (protocol_id, group_name, factor_definitions, control_group, replicate_count)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [protocol_id, group_name, JSON.stringify(factor_definitions || {}),
        control_group || false, replicate_count || 1]);

    res.status(201).json({ ok: true, treatment_group: result.rows[0] });
  } catch (err) {
    console.error('[ResearchStudies] Treatment create error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to create treatment group' });
  }
});

// ─── POST /research/studies/:id/link ──────────────────────────────────
router.post('/research/studies/:id/link', verifyStudyOwnership, async (req, res) => {
  try {
    const { id } = req.params;
    const { entity_type, entity_id, linked_by } = req.body;
    if (!entity_type || !entity_id) {
      return res.status(400).json({ ok: false, error: 'entity_type and entity_id required' });
    }

    const result = await query(`
      INSERT INTO study_links (study_id, entity_type, entity_id, linked_by)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (study_id, entity_type, entity_id) DO NOTHING
      RETURNING *
    `, [id, entity_type, entity_id, linked_by || null]);

    res.status(201).json({ ok: true, link: result.rows[0] || null });
  } catch (err) {
    console.error('[ResearchStudies] Link error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to link entity' });
  }
});

// ─── DELETE /research/studies/:id/link/:linkId ────────────────────────
router.delete('/research/studies/:id/link/:linkId', verifyStudyOwnership, async (req, res) => {
  try {
    const { id, linkId } = req.params;
    await query('DELETE FROM study_links WHERE id = $1 AND study_id = $2', [linkId, id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[ResearchStudies] Unlink error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to unlink entity' });
  }
});

// ─── GET /research/studies/:id/timeline ───────────────────────────────
router.get('/research/studies/:id/timeline', verifyStudyOwnership, async (req, res) => {
  try {
    const { id } = req.params;
    const milestones = await query(`
      SELECT * FROM trial_milestones
      WHERE study_id = $1
      ORDER BY COALESCE(actual_date, planned_date) ASC
    `, [id]);

    res.json({ ok: true, milestones: milestones.rows });
  } catch (err) {
    console.error('[ResearchStudies] Timeline error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to get timeline' });
  }
});

// ─── POST /research/studies/:id/milestones ────────────────────────────
router.post('/research/studies/:id/milestones', verifyStudyOwnership, async (req, res) => {
  try {
    const { id } = req.params;
    const { milestone_type, planned_date, notes } = req.body;
    if (!milestone_type) {
      return res.status(400).json({ ok: false, error: 'milestone_type required' });
    }

    const result = await query(`
      INSERT INTO trial_milestones (study_id, milestone_type, planned_date, notes)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [id, milestone_type, planned_date || null, notes || null]);

    res.status(201).json({ ok: true, milestone: result.rows[0] });
  } catch (err) {
    console.error('[ResearchStudies] Milestone create error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to create milestone' });
  }
});

// ─── PATCH /research/milestones/:id ───────────────────────────────────
router.patch('/research/milestones/:id', verifyMilestoneOwnership, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, actual_date, notes } = req.body;
    const updates = [];
    const values = [];
    let idx = 1;

    if (status) { updates.push(`status = $${idx}`); values.push(status); idx++; }
    if (actual_date) { updates.push(`actual_date = $${idx}`); values.push(actual_date); idx++; }
    if (notes !== undefined) { updates.push(`notes = $${idx}`); values.push(notes); idx++; }

    if (updates.length === 0) {
      return res.status(400).json({ ok: false, error: 'No fields to update' });
    }
    updates.push('updated_at = NOW()');
    values.push(id);

    const result = await query(`
      UPDATE trial_milestones SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *
    `, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Milestone not found' });
    }
    res.json({ ok: true, milestone: result.rows[0] });
  } catch (err) {
    console.error('[ResearchStudies] Milestone update error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to update milestone' });
  }
});

// ─── GET /research/studies/:id/deviations ─────────────────────────────
router.get('/research/studies/:id/deviations', verifyStudyOwnership, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await query(`
      SELECT pd.*, u.email as recorded_by_email, r.email as reviewed_by_email
      FROM protocol_deviations pd
      LEFT JOIN farm_users u ON pd.recorded_by = u.id
      LEFT JOIN farm_users r ON pd.reviewed_by = r.id
      WHERE pd.study_id = $1
      ORDER BY pd.recorded_at DESC
    `, [id]);

    res.json({ ok: true, deviations: result.rows });
  } catch (err) {
    console.error('[ResearchStudies] Deviations list error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to list deviations' });
  }
});

// ─── POST /research/studies/:id/deviations ────────────────────────────
router.post('/research/studies/:id/deviations', verifyStudyOwnership, async (req, res) => {
  try {
    const { id } = req.params;
    const { description, deviation_type, impact_assessment, protocol_version_id, recorded_by } = req.body;
    if (!description) {
      return res.status(400).json({ ok: false, error: 'description required' });
    }

    const result = await query(`
      INSERT INTO protocol_deviations (study_id, protocol_version_id, deviation_type, description, impact_assessment, recorded_by)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [id, protocol_version_id || null, deviation_type || null,
        description, impact_assessment || null, recorded_by || null]);

    res.status(201).json({ ok: true, deviation: result.rows[0] });
  } catch (err) {
    console.error('[ResearchStudies] Deviation record error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to record deviation' });
  }
});

// ── Phase 1 Enhancements: Protocol Builder ──
// protocol_design_elements: id, protocol_id, study_id, element_type
//   (randomization|inclusion_exclusion|success_metric|stopping_rule|replication_plan),
//   title, definition (JSONB), created_at

// ── Protocol design elements (randomization, inclusion/exclusion, etc.) ──
router.get('/research/protocols/:id/design', async (req, res) => {
  try {
    const { element_type } = req.query;
    const params = [req.params.id];
    let where = 'WHERE pde.protocol_id = $1';
    if (element_type) { params.push(element_type); where += ` AND pde.element_type = $${params.length}`; }

    const result = await query(`
      SELECT pde.* FROM protocol_design_elements pde
      ${where}
      ORDER BY pde.element_type, pde.created_at
    `, params);

    res.json({ ok: true, elements: result.rows, count: result.rows.length });
  } catch (err) {
    console.error('[ResearchStudies] Design elements list error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to list protocol design elements' });
  }
});

router.post('/research/protocols/:id/design', async (req, res) => {
  try {
    const { element_type, title, definition, study_id } = req.body;
    if (!element_type || !title) {
      return res.status(400).json({ ok: false, error: 'element_type and title required' });
    }
    const validTypes = ['randomization', 'inclusion_exclusion', 'success_metric', 'stopping_rule', 'replication_plan'];
    if (!validTypes.includes(element_type)) {
      return res.status(400).json({ ok: false, error: `Invalid element_type. Valid: ${validTypes.join(', ')}` });
    }

    const result = await query(`
      INSERT INTO protocol_design_elements (protocol_id, study_id, element_type, title, definition)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [req.params.id, study_id || null, element_type, title, JSON.stringify(definition || {})]);

    res.status(201).json({ ok: true, element: result.rows[0] });
  } catch (err) {
    console.error('[ResearchStudies] Design element create error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to create protocol design element' });
  }
});

router.patch('/research/design-elements/:id', async (req, res) => {
  try {
    const { title, definition } = req.body;
    const fields = [];
    const params = [];
    let idx = 1;
    if (title !== undefined) { fields.push(`title = $${idx}`); params.push(title); idx++; }
    if (definition !== undefined) { fields.push(`definition = $${idx}`); params.push(JSON.stringify(definition)); idx++; }
    if (!fields.length) return res.status(400).json({ ok: false, error: 'No fields to update' });

    params.push(req.params.id);
    const result = await query(`UPDATE protocol_design_elements SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`, params);
    if (!result.rows.length) return res.status(404).json({ ok: false, error: 'Design element not found' });
    res.json({ ok: true, element: result.rows[0] });
  } catch (err) {
    console.error('[ResearchStudies] Design element update error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to update design element' });
  }
});

router.delete('/research/design-elements/:id', async (req, res) => {
  try {
    const result = await query('DELETE FROM protocol_design_elements WHERE id = $1 RETURNING id', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ ok: false, error: 'Design element not found' });
    res.json({ ok: true, deleted: true });
  } catch (err) {
    console.error('[ResearchStudies] Design element delete error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to delete design element' });
  }
});

export default router;
