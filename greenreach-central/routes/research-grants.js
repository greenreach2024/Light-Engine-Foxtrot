/**
 * Research Grant Administration Routes
 * Research Platform Phase 2 -- NSERC/Tri-Council grant lifecycle, reporting, publications
 *
 * Endpoints:
 *   GET/POST   /research/grants                          -- List/create grant applications
 *   GET/PATCH  /research/grants/:id                      -- Get/update grant
 *   PATCH      /research/grants/:id/status               -- Advance grant status
 *   GET/POST   /research/grants/:id/reports              -- Progress/financial reports
 *   PATCH      /research/reports/:id                     -- Update report
 *   GET/POST   /research/grants/:id/publications         -- Publication tracking
 *   PATCH      /research/publications/:id                -- Update publication
 *   GET/POST   /research/grants/:id/milestones           -- Grant milestones
 *   PATCH      /research/grant-milestones/:id            -- Update grant milestone
 *   GET        /research/grants/:id/dashboard            -- Grant overview dashboard
 *   GET/POST   /research/grants/:id/extensions           -- NCE (no-cost extensions)
 *   GET/POST   /research/grants/:id/amendments           -- Budget amendments
 */
import { Router } from 'express';
import { query, isDatabaseAvailable } from '../config/database.js';
import { verifyStudyOwnership } from '../middleware/research-tenant.js';

const router = Router();

async function safeQueryRows(sql, params, label) {
  try {
    return await query(sql, params);
  } catch (err) {
    console.warn(`[ResearchGrants] ${label} unavailable:`, err.message);
    return { rows: [] };
  }
}

const checkDb = (req, res, next) => {
  if (!isDatabaseAvailable()) return res.status(503).json({ ok: false, error: 'Database unavailable' });
  next();
};

router.use(checkDb);

// ── Grant Applications ──

router.get('/research/grants', async (req, res) => {
  try {
    const farmId = req.farmId || req.user?.farmId || req.query.farm_id;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const { status, agency, study_id } = req.query;
    const params = [farmId];
    let where = 'WHERE g.farm_id = $1';
    if (status) { params.push(status); where += ` AND g.status = $${params.length}`; }
    if (agency) { params.push(agency); where += ` AND g.funding_agency = $${params.length}`; }
    if (study_id) { params.push(study_id); where += ` AND g.study_id = $${params.length}`; }

    const result = await safeQueryRows(`
      SELECT g.*, s.title as study_title
      FROM grant_applications g
      LEFT JOIN studies s ON g.study_id = s.id
      ${where} ORDER BY g.created_at DESC
    `, params, 'grant list');

    res.json({ ok: true, grants: result.rows, count: result.rows.length });
  } catch (err) {
    console.error('[ResearchGrants] List error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to list grants' });
  }
});

router.post('/research/grants', async (req, res) => {
  try {
    const farmId = req.farmId;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const { study_id, title, funding_agency, program, amount_requested, currency,
            start_date, end_date, pi_name, pi_institution, co_investigators } = req.body;
    if (!title || !funding_agency) return res.status(400).json({ ok: false, error: 'title and funding_agency required' });

    const validAgencies = ['NSERC', 'CIHR', 'SSHRC', 'CFI', 'MITACS', 'provincial', 'internal', 'other'];
    if (!validAgencies.includes(funding_agency)) {
      return res.status(400).json({ ok: false, error: `funding_agency must be one of: ${validAgencies.join(', ')}` });
    }

    const result = await query(`
      INSERT INTO grant_applications (farm_id, study_id, title, funding_agency, program,
        amount_requested, currency, start_date, end_date, pi_name, pi_institution,
        co_investigators, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'draft')
      RETURNING *
    `, [farmId, study_id || null, title, funding_agency, program || null,
        amount_requested || 0, currency || 'CAD', start_date || null, end_date || null,
        pi_name || null, pi_institution || null, JSON.stringify(co_investigators || [])]);

    res.status(201).json({ ok: true, grant: result.rows[0] });
  } catch (err) {
    console.error('[ResearchGrants] Create error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to create grant' });
  }
});

router.get('/research/grants/:id', async (req, res) => {
  try {
    const result = await query(`
      SELECT g.*, s.title as study_title
      FROM grant_applications g
      LEFT JOIN studies s ON g.study_id = s.id
      WHERE g.id = $1
    `, [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ ok: false, error: 'Grant not found' });
    res.json({ ok: true, grant: result.rows[0] });
  } catch (err) {
    console.error('[ResearchGrants] Get error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to get grant' });
  }
});

router.patch('/research/grants/:id', async (req, res) => {
  try {
    const { title, program, amount_requested, amount_awarded, currency,
            start_date, end_date, pi_name, pi_institution, co_investigators, grant_number } = req.body;
    const fields = [];
    const params = [];
    let idx = 1;
    if (title !== undefined) { fields.push(`title = $${idx}`); params.push(title); idx++; }
    if (program !== undefined) { fields.push(`program = $${idx}`); params.push(program); idx++; }
    if (amount_requested !== undefined) { fields.push(`amount_requested = $${idx}`); params.push(amount_requested); idx++; }
    if (amount_awarded !== undefined) { fields.push(`amount_awarded = $${idx}`); params.push(amount_awarded); idx++; }
    if (currency !== undefined) { fields.push(`currency = $${idx}`); params.push(currency); idx++; }
    if (start_date !== undefined) { fields.push(`start_date = $${idx}`); params.push(start_date); idx++; }
    if (end_date !== undefined) { fields.push(`end_date = $${idx}`); params.push(end_date); idx++; }
    if (pi_name !== undefined) { fields.push(`pi_name = $${idx}`); params.push(pi_name); idx++; }
    if (pi_institution !== undefined) { fields.push(`pi_institution = $${idx}`); params.push(pi_institution); idx++; }
    if (co_investigators !== undefined) { fields.push(`co_investigators = $${idx}`); params.push(JSON.stringify(co_investigators)); idx++; }
    if (grant_number !== undefined) { fields.push(`grant_number = $${idx}`); params.push(grant_number); idx++; }
    if (!fields.length) return res.status(400).json({ ok: false, error: 'No fields to update' });

    fields.push('updated_at = NOW()');
    params.push(req.params.id);
    const result = await query(`UPDATE grant_applications SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`, params);
    if (!result.rows.length) return res.status(404).json({ ok: false, error: 'Grant not found' });
    res.json({ ok: true, grant: result.rows[0] });
  } catch (err) {
    console.error('[ResearchGrants] Update error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to update grant' });
  }
});

router.patch('/research/grants/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    const validTransitions = {
      'draft': ['submitted'],
      'submitted': ['under_review', 'withdrawn'],
      'under_review': ['awarded', 'declined', 'revision_requested'],
      'revision_requested': ['submitted'],
      'awarded': ['active'],
      'active': ['completed', 'suspended'],
      'suspended': ['active', 'terminated'],
      'declined': [],
      'withdrawn': [],
      'completed': [],
      'terminated': []
    };

    const current = await query('SELECT status FROM grant_applications WHERE id = $1', [req.params.id]);
    if (!current.rows.length) return res.status(404).json({ ok: false, error: 'Grant not found' });

    const allowed = validTransitions[current.rows[0].status] || [];
    if (!allowed.includes(status)) {
      return res.status(400).json({ ok: false, error: `Cannot transition from ${current.rows[0].status} to ${status}. Allowed: ${allowed.join(', ')}` });
    }

    const result = await query(`
      UPDATE grant_applications SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *
    `, [status, req.params.id]);
    res.json({ ok: true, grant: result.rows[0] });
  } catch (err) {
    console.error('[ResearchGrants] Status update error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to update grant status' });
  }
});

// ── Progress/Financial Reports ──

router.get('/research/grants/:id/reports', async (req, res) => {
  try {
    const { report_type } = req.query;
    const params = [req.params.id];
    let where = 'WHERE gr.grant_id = $1';
    if (report_type) { params.push(report_type); where += ` AND gr.report_type = $${params.length}`; }

    const result = await query(`SELECT gr.* FROM grant_reports gr ${where} ORDER BY gr.reporting_period_end DESC`, params);
    res.json({ ok: true, reports: result.rows, count: result.rows.length });
  } catch (err) {
    console.error('[ResearchGrants] Reports list error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to list reports' });
  }
});

router.post('/research/grants/:id/reports', async (req, res) => {
  try {
    const farmId = req.farmId;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const { report_type, title, reporting_period_start, reporting_period_end, content, financials } = req.body;
    if (!report_type || !title) return res.status(400).json({ ok: false, error: 'report_type and title required' });

    const validTypes = ['progress', 'financial', 'annual', 'final', 'interim'];
    if (!validTypes.includes(report_type)) {
      return res.status(400).json({ ok: false, error: `report_type must be one of: ${validTypes.join(', ')}` });
    }

    const result = await query(`
      INSERT INTO grant_reports (grant_id, farm_id, report_type, title,
        reporting_period_start, reporting_period_end, content, financials, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'draft')
      RETURNING *
    `, [req.params.id, farmId, report_type, title,
        reporting_period_start || null, reporting_period_end || null,
        JSON.stringify(content || {}), JSON.stringify(financials || {})]);

    res.status(201).json({ ok: true, report: result.rows[0] });
  } catch (err) {
    console.error('[ResearchGrants] Report create error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to create report' });
  }
});

router.patch('/research/reports/:id', async (req, res) => {
  try {
    const { title, content, financials, status } = req.body;
    const fields = [];
    const params = [];
    let idx = 1;
    if (title !== undefined) { fields.push(`title = $${idx}`); params.push(title); idx++; }
    if (content !== undefined) { fields.push(`content = $${idx}`); params.push(JSON.stringify(content)); idx++; }
    if (financials !== undefined) { fields.push(`financials = $${idx}`); params.push(JSON.stringify(financials)); idx++; }
    if (status !== undefined) { fields.push(`status = $${idx}`); params.push(status); idx++; }
    if (!fields.length) return res.status(400).json({ ok: false, error: 'No fields to update' });

    fields.push('updated_at = NOW()');
    params.push(req.params.id);
    const result = await query(`UPDATE grant_reports SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`, params);
    if (!result.rows.length) return res.status(404).json({ ok: false, error: 'Report not found' });
    res.json({ ok: true, report: result.rows[0] });
  } catch (err) {
    console.error('[ResearchGrants] Report update error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to update report' });
  }
});

// ── Publications ──

router.get('/research/grants/:id/publications', async (req, res) => {
  try {
    const result = await query(`
      SELECT * FROM grant_publications WHERE grant_id = $1 ORDER BY published_date DESC NULLS LAST
    `, [req.params.id]);
    res.json({ ok: true, publications: result.rows, count: result.rows.length });
  } catch (err) {
    console.error('[ResearchGrants] Publications list error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to list publications' });
  }
});

router.post('/research/grants/:id/publications', async (req, res) => {
  try {
    const farmId = req.farmId;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const { title, authors, journal, doi, publication_type, published_date, status, open_access } = req.body;
    if (!title) return res.status(400).json({ ok: false, error: 'title required' });

    const validTypes = ['journal_article', 'conference_paper', 'thesis', 'technical_report', 'book_chapter', 'preprint', 'dataset'];
    if (publication_type && !validTypes.includes(publication_type)) {
      return res.status(400).json({ ok: false, error: `publication_type must be one of: ${validTypes.join(', ')}` });
    }

    const result = await query(`
      INSERT INTO grant_publications (grant_id, farm_id, title, authors, journal, doi,
        publication_type, published_date, status, open_access)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `, [req.params.id, farmId, title, JSON.stringify(authors || []), journal || null,
        doi || null, publication_type || 'journal_article', published_date || null,
        status || 'in_preparation', open_access || false]);

    res.status(201).json({ ok: true, publication: result.rows[0] });
  } catch (err) {
    console.error('[ResearchGrants] Publication create error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to create publication' });
  }
});

router.patch('/research/publications/:id', async (req, res) => {
  try {
    const { title, authors, journal, doi, published_date, status, open_access } = req.body;
    const fields = [];
    const params = [];
    let idx = 1;
    if (title !== undefined) { fields.push(`title = $${idx}`); params.push(title); idx++; }
    if (authors !== undefined) { fields.push(`authors = $${idx}`); params.push(JSON.stringify(authors)); idx++; }
    if (journal !== undefined) { fields.push(`journal = $${idx}`); params.push(journal); idx++; }
    if (doi !== undefined) { fields.push(`doi = $${idx}`); params.push(doi); idx++; }
    if (published_date !== undefined) { fields.push(`published_date = $${idx}`); params.push(published_date); idx++; }
    if (status !== undefined) { fields.push(`status = $${idx}`); params.push(status); idx++; }
    if (open_access !== undefined) { fields.push(`open_access = $${idx}`); params.push(open_access); idx++; }
    if (!fields.length) return res.status(400).json({ ok: false, error: 'No fields to update' });

    fields.push('updated_at = NOW()');
    params.push(req.params.id);
    const result = await query(`UPDATE grant_publications SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`, params);
    if (!result.rows.length) return res.status(404).json({ ok: false, error: 'Publication not found' });
    res.json({ ok: true, publication: result.rows[0] });
  } catch (err) {
    console.error('[ResearchGrants] Publication update error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to update publication' });
  }
});

// ── Grant Milestones ──

router.get('/research/grants/:id/milestones', async (req, res) => {
  try {
    const result = await query(`
      SELECT * FROM grant_milestones WHERE grant_id = $1 ORDER BY due_date ASC NULLS LAST
    `, [req.params.id]);
    res.json({ ok: true, milestones: result.rows, count: result.rows.length });
  } catch (err) {
    console.error('[ResearchGrants] Milestones list error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to list milestones' });
  }
});

router.post('/research/grants/:id/milestones', async (req, res) => {
  try {
    const farmId = req.farmId;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const { title, description, due_date, deliverable_type } = req.body;
    if (!title) return res.status(400).json({ ok: false, error: 'title required' });

    const result = await query(`
      INSERT INTO grant_milestones (grant_id, farm_id, title, description, due_date, deliverable_type, status)
      VALUES ($1, $2, $3, $4, $5, $6, 'pending')
      RETURNING *
    `, [req.params.id, farmId, title, description || null, due_date || null, deliverable_type || 'report']);

    res.status(201).json({ ok: true, milestone: result.rows[0] });
  } catch (err) {
    console.error('[ResearchGrants] Milestone create error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to create milestone' });
  }
});

router.patch('/research/grant-milestones/:id', async (req, res) => {
  try {
    const { title, description, due_date, completed_date, status } = req.body;
    const fields = [];
    const params = [];
    let idx = 1;
    if (title !== undefined) { fields.push(`title = $${idx}`); params.push(title); idx++; }
    if (description !== undefined) { fields.push(`description = $${idx}`); params.push(description); idx++; }
    if (due_date !== undefined) { fields.push(`due_date = $${idx}`); params.push(due_date); idx++; }
    if (completed_date !== undefined) { fields.push(`completed_date = $${idx}`); params.push(completed_date); idx++; }
    if (status !== undefined) { fields.push(`status = $${idx}`); params.push(status); idx++; }
    if (!fields.length) return res.status(400).json({ ok: false, error: 'No fields to update' });

    fields.push('updated_at = NOW()');
    params.push(req.params.id);
    const result = await query(`UPDATE grant_milestones SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`, params);
    if (!result.rows.length) return res.status(404).json({ ok: false, error: 'Milestone not found' });
    res.json({ ok: true, milestone: result.rows[0] });
  } catch (err) {
    console.error('[ResearchGrants] Milestone update error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to update milestone' });
  }
});

// ── Grant Dashboard ──

router.get('/research/grants/:id/dashboard', async (req, res) => {
  try {
    const grant = await query('SELECT * FROM grant_applications WHERE id = $1', [req.params.id]);
    if (!grant.rows.length) return res.status(404).json({ ok: false, error: 'Grant not found' });

    const [milestones, reports, publications, hqp, extensions] = await Promise.all([
      query('SELECT status, COUNT(*) as count FROM grant_milestones WHERE grant_id = $1 GROUP BY status', [req.params.id]),
      query('SELECT report_type, status, COUNT(*) as count FROM grant_reports WHERE grant_id = $1 GROUP BY report_type, status', [req.params.id]),
      query('SELECT status, COUNT(*) as count FROM grant_publications WHERE grant_id = $1 GROUP BY status', [req.params.id]),
      query('SELECT COUNT(*) as count FROM trainee_records WHERE grant_id = $1', [req.params.id]).catch(() => ({ rows: [{ count: 0 }] })),
      query('SELECT * FROM grant_extensions WHERE grant_id = $1 ORDER BY created_at DESC', [req.params.id]).catch(() => ({ rows: [] }))
    ]);

    res.json({
      ok: true,
      grant: grant.rows[0],
      milestones: milestones.rows,
      reports: reports.rows,
      publications: publications.rows,
      hqp_count: parseInt(hqp.rows[0]?.count || 0, 10),
      extensions: extensions.rows
    });
  } catch (err) {
    console.error('[ResearchGrants] Dashboard error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to get grant dashboard' });
  }
});

// ── No-Cost Extensions (NCE) ──

router.get('/research/grants/:id/extensions', async (req, res) => {
  try {
    const result = await query('SELECT * FROM grant_extensions WHERE grant_id = $1 ORDER BY created_at DESC', [req.params.id]);
    res.json({ ok: true, extensions: result.rows, count: result.rows.length });
  } catch (err) {
    console.error('[ResearchGrants] Extensions list error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to list extensions' });
  }
});

router.post('/research/grants/:id/extensions', async (req, res) => {
  try {
    const farmId = req.farmId;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const { extension_type, new_end_date, justification } = req.body;
    if (!new_end_date || !justification) return res.status(400).json({ ok: false, error: 'new_end_date and justification required' });

    const result = await query(`
      INSERT INTO grant_extensions (grant_id, farm_id, extension_type, new_end_date, justification, status)
      VALUES ($1, $2, $3, $4, $5, 'pending')
      RETURNING *
    `, [req.params.id, farmId, extension_type || 'no_cost', new_end_date, justification]);

    res.status(201).json({ ok: true, extension: result.rows[0] });
  } catch (err) {
    console.error('[ResearchGrants] Extension create error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to create extension' });
  }
});

// ── Budget Amendments ──

router.get('/research/grants/:id/amendments', async (req, res) => {
  try {
    const result = await query('SELECT * FROM grant_amendments WHERE grant_id = $1 ORDER BY created_at DESC', [req.params.id]);
    res.json({ ok: true, amendments: result.rows, count: result.rows.length });
  } catch (err) {
    console.error('[ResearchGrants] Amendments list error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to list amendments' });
  }
});

router.post('/research/grants/:id/amendments', async (req, res) => {
  try {
    const farmId = req.farmId;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const { amendment_type, from_category, to_category, amount, justification } = req.body;
    if (!amendment_type || !justification) return res.status(400).json({ ok: false, error: 'amendment_type and justification required' });

    const result = await query(`
      INSERT INTO grant_amendments (grant_id, farm_id, amendment_type, from_category,
        to_category, amount, justification, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
      RETURNING *
    `, [req.params.id, farmId, amendment_type, from_category || null,
        to_category || null, amount || 0, justification]);

    res.status(201).json({ ok: true, amendment: result.rows[0] });
  } catch (err) {
    console.error('[ResearchGrants] Amendment create error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to create amendment' });
  }
});

export default router;
