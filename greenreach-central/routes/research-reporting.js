/**
 * Research Reporting Routes
 * Research Platform Phase 3 -- Unified dashboards, cross-entity health, automated report generation
 *
 * Endpoints:
 *   GET    /research/reports/dashboard                 -- Farm-wide research health dashboard
 *   GET    /research/reports/studies/:id/health         -- Single study health summary
 *   GET    /research/reports/grants/:id/health          -- Grant health with linked studies, HQP, budget
 *   POST   /research/reports/grant-annual               -- Generate annual grant report data
 *   POST   /research/reports/study-closeout              -- Generate study closeout report data
 *   POST   /research/reports/compliance-summary          -- Generate compliance summary across modules
 *   GET    /research/reports/kpi                        -- Research KPI metrics (output counts, timelines)
 *   GET    /research/reports/activity-feed               -- Cross-module activity feed (recent actions)
 *   GET    /research/quality-trends                     -- Data quality trends over time
 *   GET    /research/reports/budget-overview             -- Budget overview across all grants
 *   GET    /research/reports/hqp-outcomes                -- HQP training outcomes and completion rates
 *   GET    /research/reports/output-metrics              -- Research output metrics (datasets, pubs, exports)
 */
import { Router } from 'express';
import { query, isDatabaseAvailable } from '../config/database.js';

const router = Router();

const checkDb = (req, res, next) => {
  if (!isDatabaseAvailable()) return res.status(503).json({ ok: false, error: 'Database unavailable' });
  next();
};

router.use(checkDb);

// ── Farm-wide Research Dashboard ──

router.get('/research/reports/dashboard', async (req, res) => {
  try {
    const farmId = req.farmId || req.query.farm_id;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const [studies, grants, trainees, ethics, incidents, tasks, datasets] = await Promise.all([
      query('SELECT status, COUNT(*) as count FROM studies WHERE farm_id = $1 GROUP BY status', [farmId]),
      query('SELECT status, COUNT(*) as count, SUM(amount_awarded) as total_funding FROM grant_applications WHERE farm_id = $1 GROUP BY status', [farmId]),
      query('SELECT status, COUNT(*) as count FROM trainee_records WHERE farm_id = $1 GROUP BY status', [farmId]),
      query(`SELECT COUNT(*) as total, SUM(CASE WHEN expiry_date <= NOW() + INTERVAL '60 days' AND status = 'approved' THEN 1 ELSE 0 END) as expiring_soon FROM ethics_applications WHERE farm_id = $1`, [farmId]),
      query(`SELECT COUNT(*) as count FROM security_incidents WHERE farm_id = $1 AND status NOT IN ('closed', 'dismissed')`, [farmId]),
      query(`SELECT status, COUNT(*) as count FROM workspace_tasks WHERE study_id IN (SELECT id FROM studies WHERE farm_id = $1) GROUP BY status`, [farmId]),
      query('SELECT COUNT(*) as count FROM research_datasets WHERE study_id IN (SELECT id FROM studies WHERE farm_id = $1)', [farmId])
    ]);

    res.json({
      ok: true,
      dashboard: {
        studies: studies.rows,
        grants: grants.rows,
        trainees: trainees.rows,
        ethics: { total: parseInt(ethics.rows[0]?.total || 0), expiring_soon: parseInt(ethics.rows[0]?.expiring_soon || 0) },
        open_incidents: parseInt(incidents.rows[0]?.count || 0),
        tasks: tasks.rows,
        dataset_count: parseInt(datasets.rows[0]?.count || 0)
      }
    });
  } catch (err) {
    console.error('[ResearchReporting] Dashboard error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to load dashboard' });
  }
});

// ── Study Health Summary ──

router.get('/research/reports/studies/:id/health', async (req, res) => {
  try {
    const farmId = req.farmId || req.query.farm_id;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const studyId = req.params.id;
    const [study, datasets, milestones, ethicsApps, trainees, protocols, deviations, tasks, publications] = await Promise.all([
      query('SELECT * FROM studies WHERE id = $1 AND farm_id = $2', [studyId, farmId]),
      query('SELECT id, dataset_name, status, (SELECT COUNT(*) FROM research_observations WHERE dataset_id = rd.id) as obs_count FROM research_datasets rd WHERE study_id = $1', [studyId]),
      query('SELECT status, COUNT(*) as count FROM trial_milestones WHERE study_id = $1 GROUP BY status', [studyId]),
      query('SELECT id, protocol_title, status, expiry_date FROM ethics_applications WHERE study_id = $1 AND farm_id = $2', [studyId, farmId]),
      query('SELECT id, name, trainee_type, status FROM trainee_records WHERE study_id = $1 AND farm_id = $2', [studyId, farmId]),
      query('SELECT COUNT(*) as count FROM study_protocols WHERE study_id = $1', [studyId]),
      query('SELECT COUNT(*) as count FROM protocol_deviations WHERE study_id = $1', [studyId]),
      query(`SELECT status, COUNT(*) as count FROM workspace_tasks WHERE study_id = $1 GROUP BY status`, [studyId]),
      query('SELECT id, title, status FROM publications WHERE grant_id IN (SELECT id FROM grant_applications WHERE study_id = $1 AND farm_id = $2)', [studyId, farmId])
    ]);

    if (!study.rows.length) return res.status(404).json({ ok: false, error: 'Study not found' });

    const ethicsExpiring = ethicsApps.rows.filter(e => e.expiry_date && new Date(e.expiry_date) <= new Date(Date.now() + 60 * 86400000));

    res.json({
      ok: true,
      study: study.rows[0],
      health: {
        datasets: { items: datasets.rows, count: datasets.rows.length },
        milestones: milestones.rows,
        ethics: { items: ethicsApps.rows, expiring_soon: ethicsExpiring.length },
        trainees: { items: trainees.rows, active: trainees.rows.filter(t => t.status === 'active').length },
        protocols: parseInt(protocols.rows[0]?.count || 0),
        deviations: parseInt(deviations.rows[0]?.count || 0),
        tasks: tasks.rows,
        publications: publications.rows
      }
    });
  } catch (err) {
    console.error('[ResearchReporting] Study health error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to load study health' });
  }
});

// ── Grant Health Summary ──

router.get('/research/reports/grants/:id/health', async (req, res) => {
  try {
    const farmId = req.farmId || req.query.farm_id;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const grantId = req.params.id;
    const [grant, milestones, reports, publications, trainees, amendments, studies] = await Promise.all([
      query('SELECT * FROM grant_applications WHERE id = $1 AND farm_id = $2', [grantId, farmId]),
      query('SELECT status, COUNT(*) as count FROM grant_milestones WHERE grant_id = $1 GROUP BY status', [grantId]),
      query('SELECT id, report_type, status, due_date FROM grant_reports WHERE grant_id = $1 ORDER BY due_date DESC', [grantId]),
      query('SELECT id, title, status, doi FROM publications WHERE grant_id = $1', [grantId]),
      query('SELECT id, name, trainee_type, status FROM trainee_records WHERE grant_id = $1 AND farm_id = $2', [grantId, farmId]),
      query('SELECT id, amendment_type, status FROM grant_amendments WHERE grant_id = $1', [grantId]),
      query('SELECT id, title, status FROM studies WHERE id = (SELECT study_id FROM grant_applications WHERE id = $1)', [grantId])
    ]);

    if (!grant.rows.length) return res.status(404).json({ ok: false, error: 'Grant not found' });

    const pendingReports = reports.rows.filter(r => r.status === 'pending' || r.status === 'draft');
    const overdueReports = reports.rows.filter(r => r.status === 'pending' && r.due_date && new Date(r.due_date) < new Date());

    res.json({
      ok: true,
      grant: grant.rows[0],
      health: {
        milestones: milestones.rows,
        reports: { items: reports.rows, pending: pendingReports.length, overdue: overdueReports.length },
        publications: { items: publications.rows, count: publications.rows.length },
        trainees: { items: trainees.rows, active: trainees.rows.filter(t => t.status === 'active').length },
        amendments: amendments.rows,
        linked_studies: studies.rows
      }
    });
  } catch (err) {
    console.error('[ResearchReporting] Grant health error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to load grant health' });
  }
});

// ── Annual Grant Report Generator ──

router.post('/research/reports/grant-annual', async (req, res) => {
  try {
    const farmId = req.farmId;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const { grant_id, year } = req.body;
    if (!grant_id || !year) return res.status(400).json({ ok: false, error: 'grant_id and year required' });

    const reportYear = parseInt(year, 10);
    const yearStart = `${reportYear}-01-01`;
    const yearEnd = `${reportYear}-12-31`;

    const [grant, hqp, publications, milestones, reports] = await Promise.all([
      query('SELECT * FROM grant_applications WHERE id = $1 AND farm_id = $2', [grant_id, farmId]),
      query('SELECT name, trainee_type, institution, status, start_date, expected_end_date, outcome FROM trainee_records WHERE grant_id = $1 AND farm_id = $2', [grant_id, farmId]),
      query('SELECT title, journal, status, doi, published_date FROM publications WHERE grant_id = $1 AND (published_date BETWEEN $2 AND $3 OR status != $4)', [grant_id, yearStart, yearEnd, 'published']),
      query('SELECT title, status, due_date, completed_date FROM grant_milestones WHERE grant_id = $1', [grant_id]),
      query('SELECT report_type, status, due_date, submitted_date FROM grant_reports WHERE grant_id = $1 AND (due_date BETWEEN $2 AND $3)', [grant_id, yearStart, yearEnd])
    ]);

    if (!grant.rows.length) return res.status(404).json({ ok: false, error: 'Grant not found' });

    const completedMilestones = milestones.rows.filter(m => m.status === 'completed');
    const activeTrainees = hqp.rows.filter(t => t.status === 'active');

    res.json({
      ok: true,
      report: {
        grant: grant.rows[0],
        year: reportYear,
        hqp_summary: { total: hqp.rows.length, active: activeTrainees.length, trainees: hqp.rows },
        publications: { count: publications.rows.length, items: publications.rows },
        milestones: { total: milestones.rows.length, completed: completedMilestones.length, items: milestones.rows },
        reports: { items: reports.rows },
        generated_at: new Date().toISOString()
      }
    });
  } catch (err) {
    console.error('[ResearchReporting] Grant annual report error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to generate grant annual report' });
  }
});

// ── Study Closeout Report ──

router.post('/research/reports/study-closeout', async (req, res) => {
  try {
    const farmId = req.farmId;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const { study_id } = req.body;
    if (!study_id) return res.status(400).json({ ok: false, error: 'study_id required' });

    const [study, datasets, milestones, deviations, trainees, publications, exports] = await Promise.all([
      query('SELECT * FROM studies WHERE id = $1 AND farm_id = $2', [study_id, farmId]),
      query(`SELECT rd.id, rd.dataset_name, rd.status,
        (SELECT COUNT(*) FROM research_observations WHERE dataset_id = rd.id) as obs_count
        FROM research_datasets rd WHERE rd.study_id = $1`, [study_id]),
      query('SELECT title, status, planned_date, actual_date FROM trial_milestones WHERE study_id = $1 ORDER BY COALESCE(actual_date, planned_date)', [study_id]),
      query('SELECT deviation_type, description, severity, recorded_at FROM protocol_deviations WHERE study_id = $1', [study_id]),
      query('SELECT name, trainee_type, status, outcome FROM trainee_records WHERE study_id = $1 AND farm_id = $2', [study_id, farmId]),
      query('SELECT title, status, doi FROM publications WHERE grant_id IN (SELECT id FROM grant_applications WHERE study_id = $1)', [study_id]),
      query('SELECT id, export_format, status, created_at FROM export_packages WHERE study_id = $1', [study_id])
    ]);

    if (!study.rows.length) return res.status(404).json({ ok: false, error: 'Study not found' });

    const totalObs = datasets.rows.reduce((sum, d) => sum + parseInt(d.obs_count || 0, 10), 0);

    res.json({
      ok: true,
      closeout: {
        study: study.rows[0],
        datasets: { count: datasets.rows.length, total_observations: totalObs, items: datasets.rows },
        milestones: { total: milestones.rows.length, completed: milestones.rows.filter(m => m.status === 'completed').length, items: milestones.rows },
        deviations: { count: deviations.rows.length, items: deviations.rows },
        hqp: { count: trainees.rows.length, items: trainees.rows },
        publications: { count: publications.rows.length, items: publications.rows },
        exports: { count: exports.rows.length, items: exports.rows },
        generated_at: new Date().toISOString()
      }
    });
  } catch (err) {
    console.error('[ResearchReporting] Study closeout error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to generate study closeout report' });
  }
});

// ── Compliance Summary ──

router.post('/research/reports/compliance-summary', async (req, res) => {
  try {
    const farmId = req.farmId;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const [ethics, dmps, classifications, incidents, audits, coi] = await Promise.all([
      query(`SELECT status, COUNT(*) as count, SUM(CASE WHEN expiry_date <= NOW() + INTERVAL '90 days' AND status = 'approved' THEN 1 ELSE 0 END) as expiring_90d FROM ethics_applications WHERE farm_id = $1 GROUP BY status`, [farmId]),
      query('SELECT status, COUNT(*) as count FROM data_management_plans WHERE farm_id = $1 GROUP BY status', [farmId]),
      query('SELECT classification_level, COUNT(*) as count FROM data_classifications WHERE farm_id = $1 GROUP BY classification_level', [farmId]),
      query(`SELECT severity, status, COUNT(*) as count FROM security_incidents WHERE farm_id = $1 GROUP BY severity, status`, [farmId]),
      query('SELECT COUNT(*) as count, MAX(audit_date) as last_audit FROM security_audits WHERE farm_id = $1', [farmId]),
      query(`SELECT status, COUNT(*) as count FROM coi_declarations WHERE study_id IN (SELECT id FROM studies WHERE farm_id = $1) GROUP BY status`, [farmId])
    ]);

    res.json({
      ok: true,
      compliance: {
        ethics: ethics.rows,
        data_management_plans: dmps.rows,
        data_classifications: classifications.rows,
        security_incidents: incidents.rows,
        security_audits: { total: parseInt(audits.rows[0]?.count || 0), last_audit: audits.rows[0]?.last_audit },
        coi_declarations: coi.rows,
        generated_at: new Date().toISOString()
      }
    });
  } catch (err) {
    console.error('[ResearchReporting] Compliance summary error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to generate compliance summary' });
  }
});

// ── Research KPI Metrics ──

router.get('/research/reports/kpi', async (req, res) => {
  try {
    const farmId = req.farmId || req.query.farm_id;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const [studies, datasets, observations, publications, trainees, grants] = await Promise.all([
      query(`SELECT COUNT(*) as total, SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active, SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed FROM studies WHERE farm_id = $1`, [farmId]),
      query('SELECT COUNT(*) as total FROM research_datasets WHERE study_id IN (SELECT id FROM studies WHERE farm_id = $1)', [farmId]),
      query(`SELECT COUNT(*) as total, COUNT(CASE WHEN observed_at >= NOW() - INTERVAL '30 days' THEN 1 END) as last_30d FROM research_observations WHERE dataset_id IN (SELECT id FROM research_datasets WHERE study_id IN (SELECT id FROM studies WHERE farm_id = $1))`, [farmId]),
      query(`SELECT COUNT(*) as total, SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) as published FROM publications WHERE grant_id IN (SELECT id FROM grant_applications WHERE farm_id = $1)`, [farmId]),
      query(`SELECT COUNT(*) as total, SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed FROM trainee_records WHERE farm_id = $1`, [farmId]),
      query(`SELECT COUNT(*) as total, COALESCE(SUM(amount_awarded), 0) as total_funding FROM grant_applications WHERE farm_id = $1 AND status IN ('active', 'awarded')`, [farmId])
    ]);

    res.json({
      ok: true,
      kpi: {
        studies: studies.rows[0],
        datasets: parseInt(datasets.rows[0]?.total || 0),
        observations: observations.rows[0],
        publications: publications.rows[0],
        trainees: trainees.rows[0],
        active_grants: { count: parseInt(grants.rows[0]?.total || 0), total_funding: parseFloat(grants.rows[0]?.total_funding || 0) }
      }
    });
  } catch (err) {
    console.error('[ResearchReporting] KPI error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to load KPI metrics' });
  }
});

// ── Cross-module Activity Feed ──

router.get('/research/reports/activity-feed', async (req, res) => {
  try {
    const farmId = req.farmId || req.query.farm_id;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);

    const result = await query(`
      SELECT * FROM (
        SELECT 'study' as entity_type, id as entity_id, title as description, status, created_at FROM studies WHERE farm_id = $1
        UNION ALL
        SELECT 'grant' as entity_type, id as entity_id, title as description, status, created_at FROM grant_applications WHERE farm_id = $1
        UNION ALL
        SELECT 'ethics' as entity_type, id as entity_id, protocol_title as description, status, created_at FROM ethics_applications WHERE farm_id = $1
        UNION ALL
        SELECT 'trainee' as entity_type, id as entity_id, name as description, status, created_at FROM trainee_records WHERE farm_id = $1
        UNION ALL
        SELECT 'incident' as entity_type, id as entity_id, title as description, status, created_at FROM security_incidents WHERE farm_id = $1
      ) combined ORDER BY created_at DESC LIMIT $2
    `, [farmId, limit]);

    res.json({ ok: true, feed: result.rows, count: result.rows.length });
  } catch (err) {
    console.error('[ResearchReporting] Activity feed error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to load activity feed' });
  }
});

// ── Data Quality Trends ──

router.get('/research/quality-trends', async (req, res) => {
  try {
    const farmId = req.farmId || req.query.farm_id;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const days = Math.min(parseInt(req.query.days, 10) || 90, 365);

    const [flagTrends, alertTrends, calibrationTrends] = await Promise.all([
      query(`
        SELECT DATE(dqf.flagged_at) as date, dqf.flag_type, COUNT(*) as count
        FROM data_quality_flags dqf
        JOIN research_observations ro ON dqf.observation_id = ro.id
        JOIN research_datasets rd ON ro.dataset_id = rd.id
        JOIN studies s ON rd.study_id = s.id
        WHERE s.farm_id = $1 AND dqf.flagged_at >= NOW() - make_interval(days => $2)
        GROUP BY DATE(dqf.flagged_at), dqf.flag_type ORDER BY date DESC
      `, [farmId, days]),
      query(`
        SELECT DATE(created_at) as date, alert_type, severity, COUNT(*) as count
        FROM data_quality_alerts
        WHERE dataset_id IN (SELECT id FROM research_datasets WHERE study_id IN (SELECT id FROM studies WHERE farm_id = $1))
          AND created_at >= NOW() - make_interval(days => $2)
        GROUP BY DATE(created_at), alert_type, severity ORDER BY date DESC
      `, [farmId, days]),
      query(`
        SELECT DATE(calibrated_at) as date, COUNT(*) as count
        FROM calibration_logs WHERE farm_id = $1 AND calibrated_at >= NOW() - make_interval(days => $2)
        GROUP BY DATE(calibrated_at) ORDER BY date DESC
      `, [farmId, days])
    ]);

    res.json({
      ok: true,
      trends: {
        quality_flags: flagTrends.rows,
        quality_alerts: alertTrends.rows,
        calibrations: calibrationTrends.rows,
        period_days: days
      }
    });
  } catch (err) {
    console.error('[ResearchReporting] Quality trends error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to load quality trends' });
  }
});

// ── Budget Overview (all grants) ──

router.get('/research/reports/budget-overview', async (req, res) => {
  try {
    const farmId = req.farmId || req.query.farm_id;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const result = await query(`
      SELECT ga.id as grant_id, ga.title, ga.funding_agency, ga.amount_awarded, ga.status,
        COALESCE(SUM(bli.planned_amount), 0) as total_planned,
        COALESCE(SUM(bli.actual_amount), 0) as total_spent,
        COALESCE(ga.amount_awarded, 0) - COALESCE(SUM(bli.actual_amount), 0) as remaining
      FROM grant_applications ga
      LEFT JOIN grant_budgets gb ON gb.grant_id = ga.id
      LEFT JOIN budget_line_items bli ON bli.budget_id = gb.id
      WHERE ga.farm_id = $1
      GROUP BY ga.id ORDER BY ga.end_date ASC NULLS LAST
    `, [farmId]);

    const totalAwarded = result.rows.reduce((s, r) => s + parseFloat(r.amount_awarded || 0), 0);
    const totalSpent = result.rows.reduce((s, r) => s + parseFloat(r.total_spent || 0), 0);

    res.json({
      ok: true,
      budget_overview: {
        grants: result.rows,
        totals: { awarded: totalAwarded, spent: totalSpent, remaining: totalAwarded - totalSpent }
      }
    });
  } catch (err) {
    console.error('[ResearchReporting] Budget overview error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to load budget overview' });
  }
});

// ── HQP Outcomes ──

router.get('/research/reports/hqp-outcomes', async (req, res) => {
  try {
    const farmId = req.farmId || req.query.farm_id;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const [byType, milestones, profDev] = await Promise.all([
      query(`SELECT trainee_type, status, COUNT(*) as count, STRING_AGG(DISTINCT outcome, ', ') as outcomes
        FROM trainee_records WHERE farm_id = $1 GROUP BY trainee_type, status ORDER BY count DESC`, [farmId]),
      query(`SELECT milestone_type, status, COUNT(*) as count FROM trainee_milestones WHERE farm_id = $1 GROUP BY milestone_type, status ORDER BY count DESC`, [farmId]),
      query(`SELECT activity_type, COUNT(*) as count, SUM(hours) as total_hours FROM professional_development WHERE farm_id = $1 GROUP BY activity_type ORDER BY count DESC`, [farmId])
    ]);

    res.json({
      ok: true,
      hqp_outcomes: {
        by_type: byType.rows,
        milestones: milestones.rows,
        professional_development: profDev.rows
      }
    });
  } catch (err) {
    console.error('[ResearchReporting] HQP outcomes error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to load HQP outcomes' });
  }
});

// ── Research Output Metrics ──

router.get('/research/reports/output-metrics', async (req, res) => {
  try {
    const farmId = req.farmId || req.query.farm_id;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const [datasets, observations, exports, publications, notebooks] = await Promise.all([
      query('SELECT COUNT(*) as count FROM research_datasets WHERE study_id IN (SELECT id FROM studies WHERE farm_id = $1)', [farmId]),
      query('SELECT COUNT(*) as count FROM research_observations WHERE dataset_id IN (SELECT id FROM research_datasets WHERE study_id IN (SELECT id FROM studies WHERE farm_id = $1))', [farmId]),
      query('SELECT COUNT(*) as count, COUNT(CASE WHEN status = $2 THEN 1 END) as completed FROM export_packages WHERE study_id IN (SELECT id FROM studies WHERE farm_id = $1)', [farmId, 'completed']),
      query(`SELECT status, COUNT(*) as count FROM publications WHERE grant_id IN (SELECT id FROM grant_applications WHERE farm_id = $1) GROUP BY status`, [farmId]),
      query('SELECT COUNT(*) as count FROM eln_notebooks WHERE study_id IN (SELECT id FROM studies WHERE farm_id = $1)', [farmId])
    ]);

    res.json({
      ok: true,
      output_metrics: {
        datasets: parseInt(datasets.rows[0]?.count || 0),
        observations: parseInt(observations.rows[0]?.count || 0),
        exports: exports.rows[0],
        publications: publications.rows,
        notebooks: parseInt(notebooks.rows[0]?.count || 0)
      }
    });
  } catch (err) {
    console.error('[ResearchReporting] Output metrics error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to load output metrics' });
  }
});

export default router;
