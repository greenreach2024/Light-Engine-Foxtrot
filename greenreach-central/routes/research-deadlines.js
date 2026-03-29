/**
 * Research Deadline & Notification Routes
 * Research Platform Phase 3 -- Deadline forecasting, auto-task generation, conflict detection
 *
 * Endpoints:
 *   GET    /research/deadlines/upcoming                  -- All upcoming deadlines by urgency
 *   GET    /research/deadlines/calendar                  -- Calendar view of deadlines by month
 *   POST   /research/deadlines/auto-generate-tasks        -- Scan deadlines and create tasks for upcoming items
 *   GET    /research/deadlines/conflicts                  -- Detect scheduling conflicts across modules
 *   GET    /research/deadlines/alerts                     -- Proactive alerts (expiries, overdue, escalations)
 *   GET    /research/deadlines/overdue                    -- All overdue items across modules
 *   GET    /research/deadlines/summary                    -- Deadline summary counts by urgency tier
 *
 * Tables used (existing): grant_milestones, grant_reports, ethics_applications, ethics_renewals,
 *   trainee_milestones, data_sharing_agreements, workspace_tasks, trial_milestones,
 *   biosafety_protocols, security_audits, calibration_logs
 */
import { Router } from 'express';
import { query, isDatabaseAvailable } from '../config/database.js';

const router = Router();

const checkDb = (req, res, next) => {
  if (!isDatabaseAvailable()) return res.status(503).json({ ok: false, error: 'Database unavailable' });
  next();
};

router.use(checkDb);

// Urgency classification: critical (<=7d), high (<=14d), medium (<=30d), low (<=60d), upcoming (<=90d)
function classifyUrgency(daysRemaining) {
  if (daysRemaining <= 0) return 'overdue';
  if (daysRemaining <= 7) return 'critical';
  if (daysRemaining <= 14) return 'high';
  if (daysRemaining <= 30) return 'medium';
  if (daysRemaining <= 60) return 'low';
  return 'upcoming';
}

// ── Upcoming Deadlines (all modules) ──

router.get('/research/deadlines/upcoming', async (req, res) => {
  try {
    const farmId = req.farmId || req.query.farm_id;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const daysAhead = Math.min(parseInt(req.query.days_ahead, 10) || 90, 365);

    const [grantMilestones, grantReports, ethics, trainMilestones, agreements, tasks, trialMilestones, biosafety, audits] = await Promise.all([
      query(`SELECT gm.id, 'grant_milestone' as type, gm.title as description, gm.due_date, gm.status,
        ga.title as parent_title, ga.id as parent_id
        FROM grant_milestones gm JOIN grant_applications ga ON gm.grant_id = ga.id
        WHERE ga.farm_id = $1 AND gm.status != 'completed' AND gm.due_date <= NOW() + make_interval(days => $2)
        ORDER BY gm.due_date ASC`, [farmId, daysAhead]),
      query(`SELECT gr.id, 'grant_report' as type, gr.report_type as description, gr.due_date, gr.status,
        ga.title as parent_title, ga.id as parent_id
        FROM grant_reports gr JOIN grant_applications ga ON gr.grant_id = ga.id
        WHERE ga.farm_id = $1 AND gr.status IN ('pending', 'draft') AND gr.due_date <= NOW() + make_interval(days => $2)
        ORDER BY gr.due_date ASC`, [farmId, daysAhead]),
      query(`SELECT ea.id, 'ethics_expiry' as type, ea.protocol_title as description, ea.expiry_date as due_date, ea.status,
        ea.protocol_title as parent_title, ea.id as parent_id
        FROM ethics_applications ea
        WHERE ea.farm_id = $1 AND ea.status = 'approved' AND ea.expiry_date <= NOW() + make_interval(days => $2)
        ORDER BY ea.expiry_date ASC`, [farmId, daysAhead]),
      query(`SELECT tm.id, 'trainee_milestone' as type, tm.title as description, tm.due_date, tm.status,
        tr.name as parent_title, tr.id as parent_id
        FROM trainee_milestones tm JOIN trainee_records tr ON tm.trainee_id = tr.id
        WHERE tr.farm_id = $1 AND tm.status != 'completed' AND tm.due_date <= NOW() + make_interval(days => $2)
        ORDER BY tm.due_date ASC`, [farmId, daysAhead]),
      query(`SELECT dsa.id, 'agreement_expiry' as type, dsa.title as description, dsa.end_date as due_date, dsa.status,
        pi.name as parent_title, pi.id as parent_id
        FROM data_sharing_agreements dsa JOIN partner_institutions pi ON dsa.partner_id = pi.id
        WHERE pi.farm_id = $1 AND dsa.status = 'active' AND dsa.end_date <= NOW() + make_interval(days => $2)
        ORDER BY dsa.end_date ASC`, [farmId, daysAhead]),
      query(`SELECT wt.id, 'task' as type, wt.title as description, wt.due_date, wt.status,
        s.title as parent_title, s.id as parent_id
        FROM workspace_tasks wt JOIN studies s ON wt.study_id = s.id
        WHERE s.farm_id = $1 AND wt.status NOT IN ('completed', 'cancelled') AND wt.due_date <= NOW() + make_interval(days => $2)
        ORDER BY wt.due_date ASC`, [farmId, daysAhead]),
      query(`SELECT tm.id, 'trial_milestone' as type, tm.title as description, tm.planned_date as due_date, tm.status,
        s.title as parent_title, s.id as parent_id
        FROM trial_milestones tm JOIN studies s ON tm.study_id = s.id
        WHERE s.farm_id = $1 AND tm.status != 'completed' AND tm.planned_date <= NOW() + make_interval(days => $2)
        ORDER BY tm.planned_date ASC`, [farmId, daysAhead]),
      query(`SELECT bp.id, 'biosafety_expiry' as type, bp.protocol_title as description, bp.expiry_date as due_date, bp.status,
        bp.protocol_title as parent_title, bp.id as parent_id
        FROM biosafety_protocols bp
        WHERE bp.farm_id = $1 AND bp.status = 'active' AND bp.expiry_date <= NOW() + make_interval(days => $2)
        ORDER BY bp.expiry_date ASC`, [farmId, daysAhead]),
      query(`SELECT sa.id, 'audit_due' as type, 'Security audit' as description, sa.next_audit_date as due_date, 'pending' as status,
        sa.audit_type as parent_title, sa.id as parent_id
        FROM security_audits sa
        WHERE sa.farm_id = $1 AND sa.next_audit_date <= NOW() + make_interval(days => $2)
        ORDER BY sa.next_audit_date ASC`, [farmId, daysAhead])
    ]);

    const allDeadlines = [
      ...grantMilestones.rows, ...grantReports.rows, ...ethics.rows,
      ...trainMilestones.rows, ...agreements.rows, ...tasks.rows,
      ...trialMilestones.rows, ...biosafety.rows, ...audits.rows
    ].map(d => {
      const dueDate = new Date(d.due_date);
      const daysRemaining = Math.ceil((dueDate - new Date()) / 86400000);
      return { ...d, days_remaining: daysRemaining, urgency: classifyUrgency(daysRemaining) };
    }).sort((a, b) => a.days_remaining - b.days_remaining);

    res.json({ ok: true, deadlines: allDeadlines, count: allDeadlines.length, days_ahead: daysAhead });
  } catch (err) {
    console.error('[ResearchDeadlines] Upcoming error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to load upcoming deadlines' });
  }
});

// ── Calendar View ──

router.get('/research/deadlines/calendar', async (req, res) => {
  try {
    const farmId = req.farmId || req.query.farm_id;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const year = parseInt(req.query.year, 10) || new Date().getFullYear();
    const month = req.query.month ? parseInt(req.query.month, 10) : null;

    let dateFilter;
    const params = [farmId];
    if (month) {
      const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
      const endDate = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;
      params.push(startDate, endDate);
      dateFilter = `BETWEEN $2 AND $3`;
    } else {
      params.push(`${year}-01-01`, `${year}-12-31`);
      dateFilter = `BETWEEN $2 AND $3`;
    }

    const result = await query(`
      SELECT * FROM (
        SELECT gm.due_date, 'grant_milestone' as type, gm.title as description, gm.status FROM grant_milestones gm JOIN grant_applications ga ON gm.grant_id = ga.id WHERE ga.farm_id = $1 AND gm.due_date ${dateFilter}
        UNION ALL
        SELECT ea.expiry_date as due_date, 'ethics_expiry' as type, ea.protocol_title as description, ea.status FROM ethics_applications ea WHERE ea.farm_id = $1 AND ea.expiry_date ${dateFilter}
        UNION ALL
        SELECT tm.due_date, 'trainee_milestone' as type, tm.title as description, tm.status FROM trainee_milestones tm JOIN trainee_records tr ON tm.trainee_id = tr.id WHERE tr.farm_id = $1 AND tm.due_date ${dateFilter}
        UNION ALL
        SELECT wt.due_date, 'task' as type, wt.title as description, wt.status FROM workspace_tasks wt JOIN studies s ON wt.study_id = s.id WHERE s.farm_id = $1 AND wt.due_date ${dateFilter}
      ) combined ORDER BY due_date ASC
    `, params);

    res.json({ ok: true, calendar: result.rows, count: result.rows.length, year, month: month || 'all' });
  } catch (err) {
    console.error('[ResearchDeadlines] Calendar error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to load deadline calendar' });
  }
});

// ── Auto-generate Tasks from Deadlines ──

router.post('/research/deadlines/auto-generate-tasks', async (req, res) => {
  try {
    const farmId = req.farmId || req.body.farm_id;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const lookAheadDays = parseInt(req.body.look_ahead_days, 10) || 30;
    const leadTimeDays = parseInt(req.body.lead_time_days, 10) || 14;
    let created = 0;

    // Ethics renewals needed
    const expiringEthics = await query(`
      SELECT ea.id, ea.protocol_title, ea.expiry_date, ea.study_id
      FROM ethics_applications ea
      WHERE ea.farm_id = $1 AND ea.status = 'approved'
        AND ea.expiry_date <= NOW() + make_interval(days => $2)
        AND ea.id NOT IN (
          SELECT DISTINCT CAST(wt.metadata->>'source_id' AS INTEGER) FROM workspace_tasks wt
          WHERE wt.study_id = ea.study_id AND wt.metadata->>'source_type' = 'ethics_renewal'
            AND wt.status != 'cancelled'
        )
    `, [farmId, lookAheadDays]);

    for (const ethics of expiringEthics.rows) {
      if (!ethics.study_id) continue;
      const dueDate = new Date(new Date(ethics.expiry_date).getTime() - leadTimeDays * 86400000);
      await query(`
        INSERT INTO workspace_tasks (study_id, title, description, status, priority, due_date, metadata, created_at, updated_at)
        VALUES ($1, $2, $3, 'open', 2, $4, $5, NOW(), NOW())
      `, [ethics.study_id, `Submit ethics renewal: ${ethics.protocol_title}`,
          `Ethics approval expires ${new Date(ethics.expiry_date).toISOString().split('T')[0]}. Submit renewal before deadline.`,
          dueDate.toISOString().split('T')[0],
          JSON.stringify({ source_type: 'ethics_renewal', source_id: ethics.id, auto_generated: true })]);
      created++;
    }

    // Grant milestones approaching
    const upcomingGM = await query(`
      SELECT gm.id, gm.title, gm.due_date, ga.study_id
      FROM grant_milestones gm JOIN grant_applications ga ON gm.grant_id = ga.id
      WHERE ga.farm_id = $1 AND gm.status = 'pending'
        AND gm.due_date <= NOW() + make_interval(days => $2)
        AND ga.study_id IS NOT NULL
        AND gm.id NOT IN (
          SELECT DISTINCT CAST(wt.metadata->>'source_id' AS INTEGER) FROM workspace_tasks wt
          WHERE wt.metadata->>'source_type' = 'grant_milestone' AND wt.status != 'cancelled'
        )
    `, [farmId, lookAheadDays]);

    for (const gm of upcomingGM.rows) {
      const dueDate = new Date(new Date(gm.due_date).getTime() - leadTimeDays * 86400000);
      await query(`
        INSERT INTO workspace_tasks (study_id, title, description, status, priority, due_date, metadata, created_at, updated_at)
        VALUES ($1, $2, $3, 'open', 2, $4, $5, NOW(), NOW())
      `, [gm.study_id, `Grant milestone: ${gm.title}`,
          `Grant milestone due ${new Date(gm.due_date).toISOString().split('T')[0]}.`,
          dueDate.toISOString().split('T')[0],
          JSON.stringify({ source_type: 'grant_milestone', source_id: gm.id, auto_generated: true })]);
      created++;
    }

    // Grant reports due
    const upcomingReports = await query(`
      SELECT gr.id, gr.report_type, gr.due_date, ga.study_id
      FROM grant_reports gr JOIN grant_applications ga ON gr.grant_id = ga.id
      WHERE ga.farm_id = $1 AND gr.status = 'pending'
        AND gr.due_date <= NOW() + make_interval(days => $2)
        AND ga.study_id IS NOT NULL
        AND gr.id NOT IN (
          SELECT DISTINCT CAST(wt.metadata->>'source_id' AS INTEGER) FROM workspace_tasks wt
          WHERE wt.metadata->>'source_type' = 'grant_report' AND wt.status != 'cancelled'
        )
    `, [farmId, lookAheadDays]);

    for (const gr of upcomingReports.rows) {
      const dueDate = new Date(new Date(gr.due_date).getTime() - leadTimeDays * 86400000);
      await query(`
        INSERT INTO workspace_tasks (study_id, title, description, status, priority, due_date, metadata, created_at, updated_at)
        VALUES ($1, $2, $3, 'open', 1, $4, $5, NOW(), NOW())
      `, [gr.study_id, `Submit ${gr.report_type} report`,
          `Grant report due ${new Date(gr.due_date).toISOString().split('T')[0]}.`,
          dueDate.toISOString().split('T')[0],
          JSON.stringify({ source_type: 'grant_report', source_id: gr.id, auto_generated: true })]);
      created++;
    }

    res.json({ ok: true, tasks_created: created, look_ahead_days: lookAheadDays, lead_time_days: leadTimeDays });
  } catch (err) {
    console.error('[ResearchDeadlines] Auto-generate error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to auto-generate tasks' });
  }
});

// ── Conflict Detection ──

router.get('/research/deadlines/conflicts', async (req, res) => {
  try {
    const farmId = req.farmId || req.query.farm_id;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const conflicts = [];

    // Studies ending after their grant
    const studyGrantConflicts = await query(`
      SELECT s.id as study_id, s.title as study_title, s.end_date as study_end,
        ga.id as grant_id, ga.title as grant_title, ga.end_date as grant_end
      FROM studies s
      JOIN grant_applications ga ON ga.study_id = s.id
      WHERE s.farm_id = $1 AND s.end_date IS NOT NULL AND ga.end_date IS NOT NULL
        AND s.end_date > ga.end_date AND ga.status IN ('active', 'awarded')
    `, [farmId]);

    for (const c of studyGrantConflicts.rows) {
      conflicts.push({
        type: 'study_outlasts_grant',
        severity: 'high',
        description: `Study "${c.study_title}" ends after its grant "${c.grant_title}"`,
        study_end: c.study_end,
        grant_end: c.grant_end,
        study_id: c.study_id,
        grant_id: c.grant_id
      });
    }

    // Expired ethics on active studies
    const expiredEthics = await query(`
      SELECT ea.protocol_title, ea.expiry_date, s.id as study_id, s.title as study_title
      FROM ethics_applications ea JOIN studies s ON ea.study_id = s.id
      WHERE s.farm_id = $1 AND s.status = 'active' AND ea.status = 'approved'
        AND ea.expiry_date < NOW()
    `, [farmId]);

    for (const e of expiredEthics.rows) {
      conflicts.push({
        type: 'expired_ethics_active_study',
        severity: 'critical',
        description: `Ethics "${e.protocol_title}" expired on study "${e.study_title}"`,
        expiry_date: e.expiry_date,
        study_id: e.study_id
      });
    }

    // Expired agreements with active partners
    const expiredAgreements = await query(`
      SELECT dsa.title, dsa.end_date, pi.name as partner_name, pi.id as partner_id
      FROM data_sharing_agreements dsa JOIN partner_institutions pi ON dsa.partner_id = pi.id
      WHERE pi.farm_id = $1 AND dsa.status = 'active' AND dsa.end_date < NOW()
    `, [farmId]);

    for (const a of expiredAgreements.rows) {
      conflicts.push({
        type: 'expired_agreement',
        severity: 'medium',
        description: `Agreement "${a.title}" with "${a.partner_name}" expired`,
        end_date: a.end_date,
        partner_id: a.partner_id
      });
    }

    conflicts.sort((a, b) => {
      const order = { critical: 0, high: 1, medium: 2, low: 3 };
      return (order[a.severity] || 4) - (order[b.severity] || 4);
    });

    res.json({ ok: true, conflicts, count: conflicts.length });
  } catch (err) {
    console.error('[ResearchDeadlines] Conflicts error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to detect conflicts' });
  }
});

// ── Proactive Alerts ──

router.get('/research/deadlines/alerts', async (req, res) => {
  try {
    const farmId = req.farmId || req.query.farm_id;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const alerts = [];

    // Ethics expiring within 60 days
    const expiringEthics = await query(`
      SELECT ea.id, ea.protocol_title, ea.expiry_date
      FROM ethics_applications ea
      WHERE ea.farm_id = $1 AND ea.status = 'approved' AND ea.expiry_date <= NOW() + INTERVAL '60 days'
      ORDER BY ea.expiry_date ASC
    `, [farmId]);

    for (const e of expiringEthics.rows) {
      const daysLeft = Math.ceil((new Date(e.expiry_date) - new Date()) / 86400000);
      alerts.push({
        type: 'ethics_expiry',
        urgency: classifyUrgency(daysLeft),
        message: `Ethics "${e.protocol_title}" expires in ${daysLeft} days`,
        entity_id: e.id,
        days_remaining: daysLeft
      });
    }

    // Biosafety expiring within 60 days
    const expiringBiosafety = await query(`
      SELECT bp.id, bp.protocol_title, bp.expiry_date
      FROM biosafety_protocols bp
      WHERE bp.farm_id = $1 AND bp.status = 'active' AND bp.expiry_date <= NOW() + INTERVAL '60 days'
      ORDER BY bp.expiry_date ASC
    `, [farmId]);

    for (const b of expiringBiosafety.rows) {
      const daysLeft = Math.ceil((new Date(b.expiry_date) - new Date()) / 86400000);
      alerts.push({
        type: 'biosafety_expiry',
        urgency: classifyUrgency(daysLeft),
        message: `Biosafety protocol "${b.protocol_title}" expires in ${daysLeft} days`,
        entity_id: b.id,
        days_remaining: daysLeft
      });
    }

    // Overdue grant reports
    const overdueReports = await query(`
      SELECT gr.id, gr.report_type, gr.due_date, ga.title as grant_title
      FROM grant_reports gr JOIN grant_applications ga ON gr.grant_id = ga.id
      WHERE ga.farm_id = $1 AND gr.status = 'pending' AND gr.due_date < NOW()
    `, [farmId]);

    for (const r of overdueReports.rows) {
      const daysOverdue = Math.ceil((new Date() - new Date(r.due_date)) / 86400000);
      alerts.push({
        type: 'overdue_report',
        urgency: 'critical',
        message: `${r.report_type} report for "${r.grant_title}" is ${daysOverdue} days overdue`,
        entity_id: r.id,
        days_remaining: -daysOverdue
      });
    }

    // Overdue trainee milestones
    const overdueTrainee = await query(`
      SELECT tm.id, tm.title, tm.due_date, tr.name as trainee_name
      FROM trainee_milestones tm JOIN trainee_records tr ON tm.trainee_id = tr.id
      WHERE tr.farm_id = $1 AND tm.status NOT IN ('completed') AND tm.due_date < NOW()
    `, [farmId]);

    for (const t of overdueTrainee.rows) {
      const daysOverdue = Math.ceil((new Date() - new Date(t.due_date)) / 86400000);
      alerts.push({
        type: 'overdue_trainee_milestone',
        urgency: daysOverdue > 30 ? 'critical' : 'high',
        message: `Trainee milestone "${t.title}" for ${t.trainee_name} is ${daysOverdue} days overdue`,
        entity_id: t.id,
        days_remaining: -daysOverdue
      });
    }

    alerts.sort((a, b) => a.days_remaining - b.days_remaining);

    res.json({ ok: true, alerts, count: alerts.length });
  } catch (err) {
    console.error('[ResearchDeadlines] Alerts error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to load deadline alerts' });
  }
});

// ── Overdue Items ──

router.get('/research/deadlines/overdue', async (req, res) => {
  try {
    const farmId = req.farmId || req.query.farm_id;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const result = await query(`
      SELECT * FROM (
        SELECT 'grant_milestone' as type, gm.title as description, gm.due_date, gm.status
        FROM grant_milestones gm JOIN grant_applications ga ON gm.grant_id = ga.id
        WHERE ga.farm_id = $1 AND gm.status != 'completed' AND gm.due_date < NOW()
        UNION ALL
        SELECT 'grant_report' as type, gr.report_type as description, gr.due_date, gr.status
        FROM grant_reports gr JOIN grant_applications ga ON gr.grant_id = ga.id
        WHERE ga.farm_id = $1 AND gr.status IN ('pending', 'draft') AND gr.due_date < NOW()
        UNION ALL
        SELECT 'trainee_milestone' as type, tm.title as description, tm.due_date, tm.status
        FROM trainee_milestones tm JOIN trainee_records tr ON tm.trainee_id = tr.id
        WHERE tr.farm_id = $1 AND tm.status NOT IN ('completed') AND tm.due_date < NOW()
        UNION ALL
        SELECT 'task' as type, wt.title as description, wt.due_date, wt.status
        FROM workspace_tasks wt JOIN studies s ON wt.study_id = s.id
        WHERE s.farm_id = $1 AND wt.status NOT IN ('completed', 'cancelled') AND wt.due_date < NOW()
      ) combined ORDER BY due_date ASC
    `, [farmId]);

    const overdue = result.rows.map(r => ({
      ...r,
      days_overdue: Math.ceil((new Date() - new Date(r.due_date)) / 86400000)
    }));

    res.json({ ok: true, overdue, count: overdue.length });
  } catch (err) {
    console.error('[ResearchDeadlines] Overdue error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to load overdue items' });
  }
});

// ── Deadline Summary ──

router.get('/research/deadlines/summary', async (req, res) => {
  try {
    const farmId = req.farmId || req.query.farm_id;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const result = await query(`
      SELECT * FROM (
        SELECT gm.due_date FROM grant_milestones gm JOIN grant_applications ga ON gm.grant_id = ga.id WHERE ga.farm_id = $1 AND gm.status != 'completed' AND gm.due_date IS NOT NULL
        UNION ALL
        SELECT gr.due_date FROM grant_reports gr JOIN grant_applications ga ON gr.grant_id = ga.id WHERE ga.farm_id = $1 AND gr.status IN ('pending', 'draft') AND gr.due_date IS NOT NULL
        UNION ALL
        SELECT ea.expiry_date as due_date FROM ethics_applications ea WHERE ea.farm_id = $1 AND ea.status = 'approved' AND ea.expiry_date IS NOT NULL
        UNION ALL
        SELECT tm.due_date FROM trainee_milestones tm JOIN trainee_records tr ON tm.trainee_id = tr.id WHERE tr.farm_id = $1 AND tm.status != 'completed' AND tm.due_date IS NOT NULL
        UNION ALL
        SELECT wt.due_date FROM workspace_tasks wt JOIN studies s ON wt.study_id = s.id WHERE s.farm_id = $1 AND wt.status NOT IN ('completed', 'cancelled') AND wt.due_date IS NOT NULL
      ) combined
    `, [farmId]);

    const summary = { overdue: 0, critical: 0, high: 0, medium: 0, low: 0, upcoming: 0 };
    for (const row of result.rows) {
      const daysRemaining = Math.ceil((new Date(row.due_date) - new Date()) / 86400000);
      const urgency = classifyUrgency(daysRemaining);
      summary[urgency] = (summary[urgency] || 0) + 1;
    }

    res.json({ ok: true, summary, total: result.rows.length });
  } catch (err) {
    console.error('[ResearchDeadlines] Summary error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to load deadline summary' });
  }
});

export default router;
