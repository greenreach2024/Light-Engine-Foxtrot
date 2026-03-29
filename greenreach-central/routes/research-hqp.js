/**
 * Research HQP & EDI Routes
 * Research Platform Phase 2 -- Trainee records, supervision, EDI reporting
 *
 * Endpoints:
 *   GET/POST   /research/trainees                        -- List/create trainee records
 *   GET/PATCH  /research/trainees/:id                    -- Get/update trainee
 *   GET/POST   /research/trainees/:id/supervision        -- Supervision meetings
 *   GET/POST   /research/trainees/:id/milestones         -- Trainee milestones (thesis, quals)
 *   PATCH      /research/trainee-milestones/:id          -- Update trainee milestone
 *   GET/POST   /research/trainees/:id/professional-dev   -- Professional development activities
 *   GET        /research/grants/:id/hqp                  -- HQP summary for grant
 *   GET        /research/edi/summary                     -- EDI aggregate summary
 *   POST       /research/edi/self-identification         -- EDI self-ID (voluntary)
 */
import { Router } from 'express';
import { query, isDatabaseAvailable } from '../config/database.js';

const router = Router();

const checkDb = (req, res, next) => {
  if (!isDatabaseAvailable()) return res.status(503).json({ ok: false, error: 'Database unavailable' });
  next();
};

router.use(checkDb);

// ── Trainee Records ──

router.get('/research/trainees', async (req, res) => {
  try {
    const farmId = req.farmId || req.query.farm_id;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const { status, trainee_type, grant_id } = req.query;
    const params = [farmId];
    let where = 'WHERE t.farm_id = $1';
    if (status) { params.push(status); where += ` AND t.status = $${params.length}`; }
    if (trainee_type) { params.push(trainee_type); where += ` AND t.trainee_type = $${params.length}`; }
    if (grant_id) { params.push(grant_id); where += ` AND t.grant_id = $${params.length}`; }

    const result = await query(`
      SELECT t.*, s.title as study_title
      FROM trainee_records t
      LEFT JOIN studies s ON t.study_id = s.id
      ${where} ORDER BY t.created_at DESC
    `, params);

    res.json({ ok: true, trainees: result.rows, count: result.rows.length });
  } catch (err) {
    console.error('[ResearchHQP] List error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to list trainees' });
  }
});

router.post('/research/trainees', async (req, res) => {
  try {
    const farmId = req.farmId;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const { study_id, grant_id, name, email, institution, department, trainee_type,
            program, supervisor_name, start_date, expected_end_date } = req.body;
    if (!name || !trainee_type) return res.status(400).json({ ok: false, error: 'name and trainee_type required' });

    const validTypes = ['undergraduate', 'masters', 'phd', 'postdoc', 'research_associate',
                        'technician', 'visiting_scholar', 'co_op', 'intern'];
    if (!validTypes.includes(trainee_type)) {
      return res.status(400).json({ ok: false, error: `trainee_type must be one of: ${validTypes.join(', ')}` });
    }

    const result = await query(`
      INSERT INTO trainee_records (farm_id, study_id, grant_id, name, email, institution,
        department, trainee_type, program, supervisor_name, start_date, expected_end_date, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'active')
      RETURNING *
    `, [farmId, study_id || null, grant_id || null, name, email || null,
        institution || null, department || null, trainee_type, program || null,
        supervisor_name || null, start_date || null, expected_end_date || null]);

    res.status(201).json({ ok: true, trainee: result.rows[0] });
  } catch (err) {
    console.error('[ResearchHQP] Create error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to create trainee record' });
  }
});

router.get('/research/trainees/:id', async (req, res) => {
  try {
    const result = await query(`
      SELECT t.*, s.title as study_title
      FROM trainee_records t
      LEFT JOIN studies s ON t.study_id = s.id
      WHERE t.id = $1
    `, [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ ok: false, error: 'Trainee not found' });
    res.json({ ok: true, trainee: result.rows[0] });
  } catch (err) {
    console.error('[ResearchHQP] Get error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to get trainee' });
  }
});

router.patch('/research/trainees/:id', async (req, res) => {
  try {
    const { name, email, institution, department, program, supervisor_name,
            start_date, expected_end_date, actual_end_date, status, outcome } = req.body;
    const fields = [];
    const params = [];
    let idx = 1;
    if (name !== undefined) { fields.push(`name = $${idx}`); params.push(name); idx++; }
    if (email !== undefined) { fields.push(`email = $${idx}`); params.push(email); idx++; }
    if (institution !== undefined) { fields.push(`institution = $${idx}`); params.push(institution); idx++; }
    if (department !== undefined) { fields.push(`department = $${idx}`); params.push(department); idx++; }
    if (program !== undefined) { fields.push(`program = $${idx}`); params.push(program); idx++; }
    if (supervisor_name !== undefined) { fields.push(`supervisor_name = $${idx}`); params.push(supervisor_name); idx++; }
    if (start_date !== undefined) { fields.push(`start_date = $${idx}`); params.push(start_date); idx++; }
    if (expected_end_date !== undefined) { fields.push(`expected_end_date = $${idx}`); params.push(expected_end_date); idx++; }
    if (actual_end_date !== undefined) { fields.push(`actual_end_date = $${idx}`); params.push(actual_end_date); idx++; }
    if (status !== undefined) { fields.push(`status = $${idx}`); params.push(status); idx++; }
    if (outcome !== undefined) { fields.push(`outcome = $${idx}`); params.push(outcome); idx++; }
    if (!fields.length) return res.status(400).json({ ok: false, error: 'No fields to update' });

    fields.push('updated_at = NOW()');
    params.push(req.params.id);
    const result = await query(`UPDATE trainee_records SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`, params);
    if (!result.rows.length) return res.status(404).json({ ok: false, error: 'Trainee not found' });
    res.json({ ok: true, trainee: result.rows[0] });
  } catch (err) {
    console.error('[ResearchHQP] Update error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to update trainee' });
  }
});

// ── Supervision Meetings ──

router.get('/research/trainees/:id/supervision', async (req, res) => {
  try {
    const result = await query(`
      SELECT * FROM supervision_meetings WHERE trainee_id = $1 ORDER BY meeting_date DESC
    `, [req.params.id]);
    res.json({ ok: true, meetings: result.rows, count: result.rows.length });
  } catch (err) {
    console.error('[ResearchHQP] Supervision list error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to list supervision meetings' });
  }
});

router.post('/research/trainees/:id/supervision', async (req, res) => {
  try {
    const farmId = req.farmId;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const { meeting_date, attendees, agenda, notes, action_items, next_meeting_date } = req.body;
    if (!meeting_date) return res.status(400).json({ ok: false, error: 'meeting_date required' });

    const result = await query(`
      INSERT INTO supervision_meetings (trainee_id, farm_id, meeting_date, attendees,
        agenda, notes, action_items, next_meeting_date)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [req.params.id, farmId, meeting_date, JSON.stringify(attendees || []),
        agenda || null, notes || null, JSON.stringify(action_items || []), next_meeting_date || null]);

    res.status(201).json({ ok: true, meeting: result.rows[0] });
  } catch (err) {
    console.error('[ResearchHQP] Supervision create error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to create supervision meeting' });
  }
});

// ── Trainee Milestones ──

router.get('/research/trainees/:id/milestones', async (req, res) => {
  try {
    const result = await query('SELECT * FROM trainee_milestones WHERE trainee_id = $1 ORDER BY due_date ASC NULLS LAST', [req.params.id]);
    res.json({ ok: true, milestones: result.rows, count: result.rows.length });
  } catch (err) {
    console.error('[ResearchHQP] Milestones list error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to list milestones' });
  }
});

router.post('/research/trainees/:id/milestones', async (req, res) => {
  try {
    const farmId = req.farmId;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const { milestone_type, title, description, due_date } = req.body;
    if (!milestone_type || !title) return res.status(400).json({ ok: false, error: 'milestone_type and title required' });

    const validTypes = ['comprehensive_exam', 'thesis_proposal', 'thesis_defense',
                        'publication', 'conference_presentation', 'progress_report',
                        'coursework_complete', 'ethics_training', 'safety_training'];
    if (!validTypes.includes(milestone_type)) {
      return res.status(400).json({ ok: false, error: `milestone_type must be one of: ${validTypes.join(', ')}` });
    }

    const result = await query(`
      INSERT INTO trainee_milestones (trainee_id, farm_id, milestone_type, title, description, due_date, status)
      VALUES ($1, $2, $3, $4, $5, $6, 'pending')
      RETURNING *
    `, [req.params.id, farmId, milestone_type, title, description || null, due_date || null]);

    res.status(201).json({ ok: true, milestone: result.rows[0] });
  } catch (err) {
    console.error('[ResearchHQP] Milestone create error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to create milestone' });
  }
});

router.patch('/research/trainee-milestones/:id', async (req, res) => {
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
    const result = await query(`UPDATE trainee_milestones SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`, params);
    if (!result.rows.length) return res.status(404).json({ ok: false, error: 'Milestone not found' });
    res.json({ ok: true, milestone: result.rows[0] });
  } catch (err) {
    console.error('[ResearchHQP] Milestone update error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to update milestone' });
  }
});

// ── Professional Development ──

router.get('/research/trainees/:id/professional-dev', async (req, res) => {
  try {
    const result = await query('SELECT * FROM professional_development WHERE trainee_id = $1 ORDER BY activity_date DESC', [req.params.id]);
    res.json({ ok: true, activities: result.rows, count: result.rows.length });
  } catch (err) {
    console.error('[ResearchHQP] ProfDev list error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to list professional development' });
  }
});

router.post('/research/trainees/:id/professional-dev', async (req, res) => {
  try {
    const farmId = req.farmId;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const { activity_type, title, description, activity_date, hours, provider, certificate_url } = req.body;
    if (!activity_type || !title) return res.status(400).json({ ok: false, error: 'activity_type and title required' });

    const result = await query(`
      INSERT INTO professional_development (trainee_id, farm_id, activity_type, title,
        description, activity_date, hours, provider, certificate_url)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `, [req.params.id, farmId, activity_type, title, description || null,
        activity_date || null, hours || null, provider || null, certificate_url || null]);

    res.status(201).json({ ok: true, activity: result.rows[0] });
  } catch (err) {
    console.error('[ResearchHQP] ProfDev create error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to create professional development activity' });
  }
});

// ── HQP Summary for Grant Reporting ──

router.get('/research/grants/:id/hqp', async (req, res) => {
  try {
    const trainees = await query(`
      SELECT t.trainee_type, t.status, t.institution, COUNT(*) as count
      FROM trainee_records t WHERE t.grant_id = $1
      GROUP BY t.trainee_type, t.status, t.institution
      ORDER BY t.trainee_type
    `, [req.params.id]);

    const details = await query(`
      SELECT t.id, t.name, t.trainee_type, t.institution, t.program, t.status,
        t.start_date, t.expected_end_date, t.actual_end_date, t.outcome,
        (SELECT COUNT(*) FROM trainee_milestones tm WHERE tm.trainee_id = t.id AND tm.status = 'completed') as completed_milestones,
        (SELECT COUNT(*) FROM professional_development pd WHERE pd.trainee_id = t.id) as prof_dev_count
      FROM trainee_records t WHERE t.grant_id = $1
      ORDER BY t.trainee_type, t.name
    `, [req.params.id]);

    res.json({
      ok: true,
      summary: trainees.rows,
      trainees: details.rows,
      total: details.rows.length
    });
  } catch (err) {
    console.error('[ResearchHQP] HQP summary error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to get HQP summary' });
  }
});

// ── EDI Summary (aggregated, no individual identification) ──

router.get('/research/edi/summary', async (req, res) => {
  try {
    const farmId = req.farmId || req.query.farm_id;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const [byType, byInstitution, ediCounts] = await Promise.all([
      query(`SELECT trainee_type, COUNT(*) as count FROM trainee_records WHERE farm_id = $1 GROUP BY trainee_type ORDER BY count DESC`, [farmId]),
      query(`SELECT institution, COUNT(*) as count FROM trainee_records WHERE farm_id = $1 AND institution IS NOT NULL GROUP BY institution ORDER BY count DESC`, [farmId]),
      query(`SELECT category, response, COUNT(*) as count FROM edi_self_identification WHERE farm_id = $1 GROUP BY category, response ORDER BY category, count DESC`, [farmId]).catch(() => ({ rows: [] }))
    ]);

    res.json({
      ok: true,
      by_type: byType.rows,
      by_institution: byInstitution.rows,
      edi_responses: ediCounts.rows,
      note: 'EDI data is aggregated. Individual responses are not identifiable.'
    });
  } catch (err) {
    console.error('[ResearchHQP] EDI summary error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to get EDI summary' });
  }
});

// ── EDI Self-Identification (voluntary, anonymized storage) ──

router.post('/research/edi/self-identification', async (req, res) => {
  try {
    const farmId = req.farmId;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const { category, response } = req.body;
    if (!category || !response) return res.status(400).json({ ok: false, error: 'category and response required' });

    const validCategories = ['gender', 'indigenous', 'visible_minority', 'disability', 'prefer_not_to_say'];
    if (!validCategories.includes(category)) {
      return res.status(400).json({ ok: false, error: `category must be one of: ${validCategories.join(', ')}` });
    }

    // Store without user_id to maintain anonymity
    const result = await query(`
      INSERT INTO edi_self_identification (farm_id, category, response)
      VALUES ($1, $2, $3)
      RETURNING id, category, created_at
    `, [farmId, category, response]);

    res.status(201).json({ ok: true, recorded: true, id: result.rows[0].id });
  } catch (err) {
    console.error('[ResearchHQP] EDI self-ID error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to record EDI self-identification' });
  }
});

export default router;
