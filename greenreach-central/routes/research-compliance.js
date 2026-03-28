/**
 * Research Compliance, DMP, Grant Budgeting & Identity Routes
 * Research Platform Phase 4 -- DMPs, Retention, Budgets, Researcher Profiles, Citations
 *
 * Endpoints:
 *   GET/POST   /research/studies/:id/dmp           -- Data management plans
 *   GET/POST   /research/studies/:id/retention      -- Retention policies
 *   GET/POST   /research/studies/:id/budgets        -- Grant budgets
 *   GET        /research/budgets/:id                -- Budget details with line items
 *   POST       /research/budgets/:id/line-items     -- Add budget line item
 *   PATCH      /research/budget-items/:id           -- Update line item
 *   GET/POST   /research/profiles                   -- Researcher profiles
 *   PATCH      /research/profiles/:id               -- Update profile
 *   GET/POST   /research/citations                  -- Citation records
 *   GET/POST   /research/studies/:id/closeout       -- Project closeout
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

// ─── Data Management Plans ────────────────────────────────────────────

router.get('/research/studies/:id/dmp', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await query('SELECT * FROM data_management_plans WHERE study_id = $1 ORDER BY updated_at DESC', [id]);
    res.json({ ok: true, plans: result.rows });
  } catch (err) {
    console.error('[ResearchCompliance] DMP list error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to list DMPs' });
  }
});

router.post('/research/studies/:id/dmp', async (req, res) => {
  try {
    const { id } = req.params;
    const { template_type, sections } = req.body;

    const result = await query(`
      INSERT INTO data_management_plans (study_id, template_type, sections)
      VALUES ($1, $2, $3)
      RETURNING *
    `, [id, template_type || 'custom', JSON.stringify(sections || {})]);

    res.status(201).json({ ok: true, plan: result.rows[0] });
  } catch (err) {
    console.error('[ResearchCompliance] DMP create error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to create DMP' });
  }
});

// ─── Retention Policies ───────────────────────────────────────────────

router.get('/research/studies/:id/retention', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await query('SELECT * FROM retention_policies WHERE study_id = $1', [id]);
    res.json({ ok: true, policies: result.rows });
  } catch (err) {
    console.error('[ResearchCompliance] Retention list error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to list retention policies' });
  }
});

router.post('/research/studies/:id/retention', async (req, res) => {
  try {
    const { id } = req.params;
    const { retention_period_years, archival_location, embargo_until, sharing_level, auto_delete_after } = req.body;

    const result = await query(`
      INSERT INTO retention_policies (study_id, retention_period_years, archival_location, embargo_until, sharing_level, auto_delete_after)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [id, retention_period_years || 10, archival_location || null,
        embargo_until || null, sharing_level || 'private', auto_delete_after || null]);

    res.status(201).json({ ok: true, policy: result.rows[0] });
  } catch (err) {
    console.error('[ResearchCompliance] Retention create error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to create retention policy' });
  }
});

// ─── Grant Budgets ────────────────────────────────────────────────────

router.get('/research/studies/:id/budgets', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await query(`
      SELECT gb.*,
        COALESCE(SUM(bli.planned_amount), 0) as total_planned,
        COALESCE(SUM(bli.actual_amount), 0) as total_actual
      FROM grant_budgets gb
      LEFT JOIN budget_line_items bli ON bli.budget_id = gb.id
      WHERE gb.study_id = $1
      GROUP BY gb.id
      ORDER BY gb.created_at DESC
    `, [id]);

    res.json({ ok: true, budgets: result.rows });
  } catch (err) {
    console.error('[ResearchCompliance] Budget list error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to list budgets' });
  }
});

router.post('/research/studies/:id/budgets', async (req, res) => {
  try {
    const { id } = req.params;
    const { budget_name, grant_application_id, award_period_start, award_period_end, total_amount, indirect_rate } = req.body;
    if (!budget_name) {
      return res.status(400).json({ ok: false, error: 'budget_name required' });
    }

    const result = await query(`
      INSERT INTO grant_budgets (study_id, budget_name, grant_application_id, award_period_start, award_period_end, total_amount, indirect_rate)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [id, budget_name, grant_application_id || null, award_period_start || null,
        award_period_end || null, total_amount || 0, indirect_rate || 0]);

    res.status(201).json({ ok: true, budget: result.rows[0] });
  } catch (err) {
    console.error('[ResearchCompliance] Budget create error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to create budget' });
  }
});

router.get('/research/budgets/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const budget = await query('SELECT * FROM grant_budgets WHERE id = $1', [id]);
    if (budget.rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Budget not found' });
    }

    const lineItems = await query(
      'SELECT * FROM budget_line_items WHERE budget_id = $1 ORDER BY category, description',
      [id]
    );

    // Compute variance by category
    const categories = {};
    for (const item of lineItems.rows) {
      if (!categories[item.category]) {
        categories[item.category] = { planned: 0, actual: 0 };
      }
      categories[item.category].planned += parseFloat(item.planned_amount || 0);
      categories[item.category].actual += parseFloat(item.actual_amount || 0);
    }

    res.json({
      ok: true,
      budget: budget.rows[0],
      line_items: lineItems.rows,
      variance_by_category: categories
    });
  } catch (err) {
    console.error('[ResearchCompliance] Budget detail error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to get budget' });
  }
});

router.post('/research/budgets/:id/line-items', async (req, res) => {
  try {
    const { id } = req.params;
    const { category, description, planned_amount, actual_amount, cost_centre, experiment_phase } = req.body;
    if (!category || !description) {
      return res.status(400).json({ ok: false, error: 'category and description required' });
    }

    const result = await query(`
      INSERT INTO budget_line_items (budget_id, category, description, planned_amount, actual_amount, cost_centre, experiment_phase)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [id, category, description, planned_amount || 0, actual_amount || 0,
        cost_centre || null, experiment_phase || null]);

    res.status(201).json({ ok: true, line_item: result.rows[0] });
  } catch (err) {
    console.error('[ResearchCompliance] Line item create error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to create line item' });
  }
});

router.patch('/research/budget-items/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const allowed = ['planned_amount', 'actual_amount', 'description', 'cost_centre', 'experiment_phase', 'invoiced'];
    const updates = [];
    const values = [];
    let idx = 1;

    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        updates.push(`${key} = $${idx}`);
        values.push(req.body[key]);
        idx++;
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({ ok: false, error: 'No fields to update' });
    }
    updates.push('updated_at = NOW()');
    values.push(id);

    const result = await query(`
      UPDATE budget_line_items SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *
    `, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Line item not found' });
    }
    res.json({ ok: true, line_item: result.rows[0] });
  } catch (err) {
    console.error('[ResearchCompliance] Line item update error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to update line item' });
  }
});

// ─── Researcher Profiles ──────────────────────────────────────────────

router.get('/research/profiles', async (req, res) => {
  try {
    const farmId = req.farmId || req.query.farm_id;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const result = await query(`
      SELECT rp.*, u.email
      FROM researcher_profiles rp
      LEFT JOIN farm_users u ON rp.user_id = u.id
      WHERE rp.farm_id = $1
      ORDER BY rp.role_title
    `, [farmId]);

    res.json({ ok: true, profiles: result.rows });
  } catch (err) {
    console.error('[ResearchCompliance] Profile list error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to list profiles' });
  }
});

router.post('/research/profiles', async (req, res) => {
  try {
    const farmId = req.farmId || req.body.farm_id;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const { user_id, orcid_id, institution, department, role_title, affiliation_type, bio } = req.body;

    const result = await query(`
      INSERT INTO researcher_profiles (user_id, farm_id, orcid_id, institution, department, role_title, affiliation_type, bio)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [user_id || null, farmId, orcid_id || null, institution || null,
        department || null, role_title || null, affiliation_type || null, bio || null]);

    res.status(201).json({ ok: true, profile: result.rows[0] });
  } catch (err) {
    console.error('[ResearchCompliance] Profile create error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to create profile' });
  }
});

router.patch('/research/profiles/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const allowed = ['orcid_id', 'institution', 'department', 'role_title', 'affiliation_type', 'bio'];
    const updates = [];
    const values = [];
    let idx = 1;

    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        updates.push(`${key} = $${idx}`);
        values.push(req.body[key]);
        idx++;
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({ ok: false, error: 'No fields to update' });
    }
    updates.push('updated_at = NOW()');
    values.push(id);

    const result = await query(`
      UPDATE researcher_profiles SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *
    `, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Profile not found' });
    }
    res.json({ ok: true, profile: result.rows[0] });
  } catch (err) {
    console.error('[ResearchCompliance] Profile update error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to update profile' });
  }
});

// ─── Citation Records ─────────────────────────────────────────────────

router.get('/research/citations', async (req, res) => {
  try {
    const farmId = req.farmId || req.query.farm_id;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const { study_id, citation_type } = req.query;
    const params = [farmId];
    let where = 'WHERE cr.farm_id = $1';
    if (study_id) { params.push(study_id); where += ` AND cr.study_id = $${params.length}`; }
    if (citation_type) { params.push(citation_type); where += ` AND cr.citation_type = $${params.length}`; }

    const result = await query(`
      SELECT cr.* FROM citation_records cr ${where}
      ORDER BY cr.created_at DESC
    `, params);

    res.json({ ok: true, citations: result.rows });
  } catch (err) {
    console.error('[ResearchCompliance] Citation list error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to list citations' });
  }
});

router.post('/research/citations', async (req, res) => {
  try {
    const farmId = req.farmId || req.body.farm_id;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const { study_id, dataset_id, citation_type, title, authors, doi, repository, version, metadata_schema } = req.body;
    if (!citation_type || !title) {
      return res.status(400).json({ ok: false, error: 'citation_type and title required' });
    }

    const result = await query(`
      INSERT INTO citation_records (farm_id, study_id, dataset_id, citation_type, title, authors, doi, repository, version, metadata_schema)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `, [farmId, study_id || null, dataset_id || null, citation_type, title,
        JSON.stringify(authors || []), doi || null, repository || null,
        version || null, metadata_schema || 'datacite']);

    res.status(201).json({ ok: true, citation: result.rows[0] });
  } catch (err) {
    console.error('[ResearchCompliance] Citation create error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to create citation' });
  }
});

// ─── Project Closeout ─────────────────────────────────────────────────

router.get('/research/studies/:id/closeout', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await query('SELECT * FROM project_closeouts WHERE study_id = $1', [id]);
    res.json({ ok: true, closeout: result.rows[0] || null });
  } catch (err) {
    console.error('[ResearchCompliance] Closeout get error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to get closeout' });
  }
});

router.post('/research/studies/:id/closeout', async (req, res) => {
  try {
    const { id } = req.params;
    const { checklist, status, completed_by } = req.body;

    const result = await query(`
      INSERT INTO project_closeouts (study_id, checklist, status, completed_by, completed_at)
      VALUES ($1, $2, $3, $4, CASE WHEN $3 = 'complete' THEN NOW() ELSE NULL END)
      ON CONFLICT DO NOTHING
      RETURNING *
    `, [id, JSON.stringify(checklist || {}), status || 'in_progress', completed_by || null]);

    if (result.rows.length === 0) {
      // Already exists, update it
      const updated = await query(`
        UPDATE project_closeouts SET checklist = $1, status = $2, completed_by = $3,
        completed_at = CASE WHEN $2 = 'complete' THEN NOW() ELSE completed_at END
        WHERE study_id = $4 RETURNING *
      `, [JSON.stringify(checklist || {}), status || 'in_progress', completed_by || null, id]);
      return res.json({ ok: true, closeout: updated.rows[0] });
    }

    res.status(201).json({ ok: true, closeout: result.rows[0] });
  } catch (err) {
    console.error('[ResearchCompliance] Closeout create error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to create closeout' });
  }
});

export default router;
