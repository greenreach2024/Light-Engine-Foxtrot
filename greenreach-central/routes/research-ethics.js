/**
 * Research Ethics & REB Routes
 * Research Platform Phase 2 -- Ethics review, REB submissions, animal/biosafety protocols
 *
 * Endpoints:
 *   GET/POST   /research/studies/:id/ethics              -- Ethics applications
 *   GET/PATCH  /research/ethics/:id                      -- Get/update ethics app
 *   PATCH      /research/ethics/:id/status               -- REB decision workflow
 *   GET/POST   /research/ethics/:id/amendments           -- Protocol amendments
 *   GET/POST   /research/ethics/:id/renewals             -- Annual renewals
 *   GET/POST   /research/studies/:id/biosafety           -- Biosafety protocols
 *   PATCH      /research/biosafety/:id                   -- Update biosafety
 *   GET        /research/ethics/dashboard                -- Ethics compliance dashboard
 */
import { Router } from 'express';
import { query, isDatabaseAvailable } from '../config/database.js';
import { verifyStudyOwnership } from '../middleware/research-tenant.js';

const router = Router();

const checkDb = (req, res, next) => {
  if (!isDatabaseAvailable()) return res.status(503).json({ ok: false, error: 'Database unavailable' });
  next();
};

router.use(checkDb);

// ── Ethics Applications ──

router.get('/research/studies/:id/ethics', verifyStudyOwnership, async (req, res) => {
  try {
    const result = await query(`
      SELECT * FROM ethics_applications WHERE study_id = $1 ORDER BY created_at DESC
    `, [req.params.id]);
    res.json({ ok: true, applications: result.rows, count: result.rows.length });
  } catch (err) {
    console.error('[ResearchEthics] List error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to list ethics applications' });
  }
});

router.post('/research/studies/:id/ethics', verifyStudyOwnership, async (req, res) => {
  try {
    const farmId = req.farmId || req.body.farm_id;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const { ethics_type, board_name, protocol_number, title, risk_level,
            involves_humans, involves_animals, involves_biohazards, description } = req.body;
    if (!ethics_type || !title) return res.status(400).json({ ok: false, error: 'ethics_type and title required' });

    const validTypes = ['human_ethics', 'animal_ethics', 'biosafety', 'environmental', 'dual_use'];
    if (!validTypes.includes(ethics_type)) {
      return res.status(400).json({ ok: false, error: `ethics_type must be one of: ${validTypes.join(', ')}` });
    }

    const result = await query(`
      INSERT INTO ethics_applications (study_id, farm_id, ethics_type, board_name,
        protocol_number, title, risk_level, involves_humans, involves_animals,
        involves_biohazards, description, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'draft')
      RETURNING *
    `, [req.params.id, farmId, ethics_type, board_name || null,
        protocol_number || null, title, risk_level || 'minimal',
        involves_humans || false, involves_animals || false,
        involves_biohazards || false, description || null]);

    res.status(201).json({ ok: true, application: result.rows[0] });
  } catch (err) {
    console.error('[ResearchEthics] Create error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to create ethics application' });
  }
});

router.get('/research/ethics/:id', async (req, res) => {
  try {
    const result = await query('SELECT * FROM ethics_applications WHERE id = $1', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ ok: false, error: 'Ethics application not found' });
    res.json({ ok: true, application: result.rows[0] });
  } catch (err) {
    console.error('[ResearchEthics] Get error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to get ethics application' });
  }
});

router.patch('/research/ethics/:id', async (req, res) => {
  try {
    const { board_name, protocol_number, title, risk_level, description,
            involves_humans, involves_animals, involves_biohazards } = req.body;
    const fields = [];
    const params = [];
    let idx = 1;
    if (board_name !== undefined) { fields.push(`board_name = $${idx}`); params.push(board_name); idx++; }
    if (protocol_number !== undefined) { fields.push(`protocol_number = $${idx}`); params.push(protocol_number); idx++; }
    if (title !== undefined) { fields.push(`title = $${idx}`); params.push(title); idx++; }
    if (risk_level !== undefined) { fields.push(`risk_level = $${idx}`); params.push(risk_level); idx++; }
    if (description !== undefined) { fields.push(`description = $${idx}`); params.push(description); idx++; }
    if (involves_humans !== undefined) { fields.push(`involves_humans = $${idx}`); params.push(involves_humans); idx++; }
    if (involves_animals !== undefined) { fields.push(`involves_animals = $${idx}`); params.push(involves_animals); idx++; }
    if (involves_biohazards !== undefined) { fields.push(`involves_biohazards = $${idx}`); params.push(involves_biohazards); idx++; }
    if (!fields.length) return res.status(400).json({ ok: false, error: 'No fields to update' });

    fields.push('updated_at = NOW()');
    params.push(req.params.id);
    const result = await query(`UPDATE ethics_applications SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`, params);
    if (!result.rows.length) return res.status(404).json({ ok: false, error: 'Application not found' });
    res.json({ ok: true, application: result.rows[0] });
  } catch (err) {
    console.error('[ResearchEthics] Update error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to update ethics application' });
  }
});

router.patch('/research/ethics/:id/status', async (req, res) => {
  try {
    const { status, decision_date, conditions, expiry_date } = req.body;
    const validTransitions = {
      'draft': ['submitted'],
      'submitted': ['under_review', 'withdrawn'],
      'under_review': ['approved', 'approved_with_conditions', 'revisions_required', 'declined'],
      'revisions_required': ['submitted'],
      'approved': ['expired', 'suspended'],
      'approved_with_conditions': ['expired', 'suspended'],
      'expired': [],
      'suspended': ['under_review'],
      'declined': [],
      'withdrawn': []
    };

    const current = await query('SELECT status FROM ethics_applications WHERE id = $1', [req.params.id]);
    if (!current.rows.length) return res.status(404).json({ ok: false, error: 'Application not found' });

    const allowed = validTransitions[current.rows[0].status] || [];
    if (!allowed.includes(status)) {
      return res.status(400).json({ ok: false, error: `Cannot transition from ${current.rows[0].status} to ${status}. Allowed: ${allowed.join(', ')}` });
    }

    const fields = ['status = $1', 'updated_at = NOW()'];
    const params = [status];
    let idx = 2;
    if (decision_date) { fields.push(`decision_date = $${idx}`); params.push(decision_date); idx++; }
    if (conditions) { fields.push(`conditions = $${idx}`); params.push(JSON.stringify(conditions)); idx++; }
    if (expiry_date) { fields.push(`expiry_date = $${idx}`); params.push(expiry_date); idx++; }

    params.push(req.params.id);
    const result = await query(`UPDATE ethics_applications SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`, params);
    res.json({ ok: true, application: result.rows[0] });
  } catch (err) {
    console.error('[ResearchEthics] Status update error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to update ethics status' });
  }
});

// ── Ethics Amendments ──

router.get('/research/ethics/:id/amendments', async (req, res) => {
  try {
    const result = await query('SELECT * FROM ethics_amendments WHERE ethics_id = $1 ORDER BY created_at DESC', [req.params.id]);
    res.json({ ok: true, amendments: result.rows, count: result.rows.length });
  } catch (err) {
    console.error('[ResearchEthics] Amendments list error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to list amendments' });
  }
});

router.post('/research/ethics/:id/amendments', async (req, res) => {
  try {
    const farmId = req.farmId || req.body.farm_id;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const { amendment_type, description, changes_summary } = req.body;
    if (!amendment_type || !description) return res.status(400).json({ ok: false, error: 'amendment_type and description required' });

    const result = await query(`
      INSERT INTO ethics_amendments (ethics_id, farm_id, amendment_type, description, changes_summary, status)
      VALUES ($1, $2, $3, $4, $5, 'pending')
      RETURNING *
    `, [req.params.id, farmId, amendment_type, description, changes_summary || null]);

    res.status(201).json({ ok: true, amendment: result.rows[0] });
  } catch (err) {
    console.error('[ResearchEthics] Amendment create error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to create amendment' });
  }
});

// ── Ethics Renewals ──

router.get('/research/ethics/:id/renewals', async (req, res) => {
  try {
    const result = await query('SELECT * FROM ethics_renewals WHERE ethics_id = $1 ORDER BY renewal_date DESC', [req.params.id]);
    res.json({ ok: true, renewals: result.rows, count: result.rows.length });
  } catch (err) {
    console.error('[ResearchEthics] Renewals list error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to list renewals' });
  }
});

router.post('/research/ethics/:id/renewals', async (req, res) => {
  try {
    const farmId = req.farmId || req.body.farm_id;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const { renewal_date, new_expiry_date, annual_report } = req.body;
    if (!renewal_date) return res.status(400).json({ ok: false, error: 'renewal_date required' });

    const result = await query(`
      INSERT INTO ethics_renewals (ethics_id, farm_id, renewal_date, new_expiry_date, annual_report, status)
      VALUES ($1, $2, $3, $4, $5, 'submitted')
      RETURNING *
    `, [req.params.id, farmId, renewal_date, new_expiry_date || null, JSON.stringify(annual_report || {})]);

    res.status(201).json({ ok: true, renewal: result.rows[0] });
  } catch (err) {
    console.error('[ResearchEthics] Renewal create error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to create renewal' });
  }
});

// ── Biosafety Protocols ──

router.get('/research/studies/:id/biosafety', verifyStudyOwnership, async (req, res) => {
  try {
    const result = await query('SELECT * FROM biosafety_protocols WHERE study_id = $1 ORDER BY created_at DESC', [req.params.id]);
    res.json({ ok: true, protocols: result.rows, count: result.rows.length });
  } catch (err) {
    console.error('[ResearchEthics] Biosafety list error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to list biosafety protocols' });
  }
});

router.post('/research/studies/:id/biosafety', verifyStudyOwnership, async (req, res) => {
  try {
    const farmId = req.farmId || req.body.farm_id;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const { containment_level, agents, risk_assessment, ppe_requirements, waste_procedures } = req.body;
    if (!containment_level) return res.status(400).json({ ok: false, error: 'containment_level required' });

    const result = await query(`
      INSERT INTO biosafety_protocols (study_id, farm_id, containment_level, agents,
        risk_assessment, ppe_requirements, waste_procedures, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'draft')
      RETURNING *
    `, [req.params.id, farmId, containment_level, JSON.stringify(agents || []),
        JSON.stringify(risk_assessment || {}), JSON.stringify(ppe_requirements || []),
        JSON.stringify(waste_procedures || {})]);

    res.status(201).json({ ok: true, protocol: result.rows[0] });
  } catch (err) {
    console.error('[ResearchEthics] Biosafety create error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to create biosafety protocol' });
  }
});

router.patch('/research/biosafety/:id', async (req, res) => {
  try {
    const { containment_level, agents, risk_assessment, ppe_requirements, waste_procedures, status } = req.body;
    const fields = [];
    const params = [];
    let idx = 1;
    if (containment_level !== undefined) { fields.push(`containment_level = $${idx}`); params.push(containment_level); idx++; }
    if (agents !== undefined) { fields.push(`agents = $${idx}`); params.push(JSON.stringify(agents)); idx++; }
    if (risk_assessment !== undefined) { fields.push(`risk_assessment = $${idx}`); params.push(JSON.stringify(risk_assessment)); idx++; }
    if (ppe_requirements !== undefined) { fields.push(`ppe_requirements = $${idx}`); params.push(JSON.stringify(ppe_requirements)); idx++; }
    if (waste_procedures !== undefined) { fields.push(`waste_procedures = $${idx}`); params.push(JSON.stringify(waste_procedures)); idx++; }
    if (status !== undefined) { fields.push(`status = $${idx}`); params.push(status); idx++; }
    if (!fields.length) return res.status(400).json({ ok: false, error: 'No fields to update' });

    fields.push('updated_at = NOW()');
    params.push(req.params.id);
    const result = await query(`UPDATE biosafety_protocols SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`, params);
    if (!result.rows.length) return res.status(404).json({ ok: false, error: 'Protocol not found' });
    res.json({ ok: true, protocol: result.rows[0] });
  } catch (err) {
    console.error('[ResearchEthics] Biosafety update error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to update biosafety protocol' });
  }
});

// ── Ethics Compliance Dashboard ──

router.get('/research/ethics/dashboard', async (req, res) => {
  try {
    const farmId = req.farmId || req.query.farm_id;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const [active, expiring, pending, biosafety] = await Promise.all([
      query(`SELECT COUNT(*) as count FROM ethics_applications WHERE farm_id = $1 AND status IN ('approved', 'approved_with_conditions')`, [farmId]),
      query(`SELECT * FROM ethics_applications WHERE farm_id = $1 AND expiry_date IS NOT NULL AND expiry_date < NOW() + INTERVAL '60 days' AND status IN ('approved', 'approved_with_conditions') ORDER BY expiry_date`, [farmId]),
      query(`SELECT COUNT(*) as count FROM ethics_applications WHERE farm_id = $1 AND status IN ('draft', 'submitted', 'under_review', 'revisions_required')`, [farmId]),
      query(`SELECT status, COUNT(*) as count FROM biosafety_protocols WHERE farm_id = $1 GROUP BY status`, [farmId])
    ]);

    res.json({
      ok: true,
      active_approvals: parseInt(active.rows[0]?.count || 0, 10),
      expiring_soon: expiring.rows,
      pending_reviews: parseInt(pending.rows[0]?.count || 0, 10),
      biosafety_summary: biosafety.rows
    });
  } catch (err) {
    console.error('[ResearchEthics] Dashboard error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to get ethics dashboard' });
  }
});

export default router;
