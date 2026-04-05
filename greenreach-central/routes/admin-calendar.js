/**
 * Admin Calendar & Tasks Routes -- GreenReach Central
 * CRUD for calendar events, tasks, and reminders.
 * Consumed by GR-central-admin UI and F.A.Y.E. tool catalog.
 */

import express from 'express';
import { query, isDatabaseAvailable } from '../config/database.js';

const router = express.Router();

// ── Schema bootstrap ─────────────────────────────────────────────

let tablesReady = false;

async function ensureTables() {
  if (tablesReady) return true;
  if (!isDatabaseAvailable()) return false;
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS admin_calendar_events (
        id SERIAL PRIMARY KEY, title VARCHAR(500) NOT NULL, description TEXT,
        event_date DATE NOT NULL, start_time TIME, end_time TIME, all_day BOOLEAN NOT NULL DEFAULT FALSE,
        location VARCHAR(500), category VARCHAR(100) DEFAULT 'general',
        recurrence VARCHAR(50), recurrence_end DATE,
        assigned_to TEXT[], created_by VARCHAR(255),
        status VARCHAR(50) NOT NULL DEFAULT 'scheduled', metadata JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await query(`
      CREATE TABLE IF NOT EXISTS admin_tasks (
        id SERIAL PRIMARY KEY, title VARCHAR(500) NOT NULL, description TEXT,
        status VARCHAR(50) NOT NULL DEFAULT 'pending', priority VARCHAR(50) NOT NULL DEFAULT 'medium',
        due_date DATE, due_time TIME, assigned_to VARCHAR(255),
        category VARCHAR(100) DEFAULT 'general', tags TEXT[],
        completed_at TIMESTAMPTZ, completed_by VARCHAR(255), created_by VARCHAR(255),
        parent_task_id INTEGER REFERENCES admin_tasks(id) ON DELETE SET NULL,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await query(`
      CREATE TABLE IF NOT EXISTS admin_task_reminders (
        id SERIAL PRIMARY KEY,
        task_id INTEGER REFERENCES admin_tasks(id) ON DELETE CASCADE,
        event_id INTEGER REFERENCES admin_calendar_events(id) ON DELETE CASCADE,
        remind_at TIMESTAMPTZ NOT NULL, method VARCHAR(50) NOT NULL DEFAULT 'in_app',
        recipient VARCHAR(255), sent BOOLEAN NOT NULL DEFAULT FALSE, sent_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT reminder_has_target CHECK (task_id IS NOT NULL OR event_id IS NOT NULL)
      )
    `);
    tablesReady = true;
    return true;
  } catch (err) {
    console.error('[Calendar] Table bootstrap failed:', err.message);
    return false;
  }
}

// ── Validation helpers ───────────────────────────────────────────

const VALID_EVENT_STATUSES = ['scheduled', 'cancelled', 'completed'];
const VALID_TASK_STATUSES = ['pending', 'in_progress', 'completed', 'cancelled'];
const VALID_PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const VALID_REMINDER_METHODS = ['in_app', 'email', 'sms'];
const VALID_CATEGORIES = ['general', 'delivery', 'harvest', 'maintenance', 'meeting', 'wholesale', 'admin', 'marketing'];

function sanitize(str, maxLen = 500) {
  return str ? String(str).trim().slice(0, maxLen) : null;
}

// ════════════════════════════════════════════════════════════════
// CALENDAR EVENTS
// ════════════════════════════════════════════════════════════════

/**
 * GET /api/admin/calendar/events
 * List calendar events with optional date range and category filter
 */
router.get('/events', async (req, res) => {
  try {
    if (!await ensureTables()) return res.status(503).json({ error: 'Database unavailable' });
    const { start_date, end_date, category, status, limit } = req.query;
    let sql = 'SELECT * FROM admin_calendar_events WHERE 1=1';
    const values = [];
    let idx = 1;
    if (start_date) { sql += ` AND event_date >= $${idx++}`; values.push(start_date); }
    if (end_date) { sql += ` AND event_date <= $${idx++}`; values.push(end_date); }
    if (category) { sql += ` AND category = $${idx++}`; values.push(category); }
    if (status) { sql += ` AND status = $${idx++}`; values.push(status); }
    sql += ' ORDER BY event_date ASC, start_time ASC NULLS LAST';
    if (limit) sql += ` LIMIT ${Math.min(parseInt(limit, 10) || 100, 500)}`;
    else sql += ' LIMIT 200';
    const result = await query(sql, values);
    res.json({ ok: true, events: result.rows, count: result.rows.length });
  } catch (err) {
    console.error('[Calendar] List events error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/admin/calendar/events/:id
 */
router.get('/events/:id', async (req, res) => {
  try {
    if (!await ensureTables()) return res.status(503).json({ error: 'Database unavailable' });
    const result = await query('SELECT * FROM admin_calendar_events WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Event not found' });
    res.json({ ok: true, event: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/admin/calendar/events
 */
router.post('/events', async (req, res) => {
  try {
    if (!await ensureTables()) return res.status(503).json({ error: 'Database unavailable' });
    const { title, description, event_date, start_time, end_time, all_day, location, category, recurrence, recurrence_end, assigned_to } = req.body;
    if (!title || !event_date) return res.status(400).json({ error: 'title and event_date are required' });
    const cat = VALID_CATEGORIES.includes(category) ? category : 'general';
    const createdBy = req.adminUser?.email || req.adminUser?.name || 'system';
    const result = await query(
      `INSERT INTO admin_calendar_events (title, description, event_date, start_time, end_time, all_day, location, category, recurrence, recurrence_end, assigned_to, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [sanitize(title), sanitize(description, 5000), event_date, start_time || null, end_time || null,
       !!all_day, sanitize(location), cat, recurrence || null, recurrence_end || null,
       Array.isArray(assigned_to) ? assigned_to : null, createdBy]
    );
    console.log(`[Calendar] Event created: ${result.rows[0].id} "${title}" on ${event_date}`);
    res.status(201).json({ ok: true, event: result.rows[0] });
  } catch (err) {
    console.error('[Calendar] Create event error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/admin/calendar/events/:id
 */
router.put('/events/:id', async (req, res) => {
  try {
    if (!await ensureTables()) return res.status(503).json({ error: 'Database unavailable' });
    const { title, description, event_date, start_time, end_time, all_day, location, category, recurrence, recurrence_end, assigned_to, status } = req.body;
    const cat = VALID_CATEGORIES.includes(category) ? category : undefined;
    const st = VALID_EVENT_STATUSES.includes(status) ? status : undefined;
    const result = await query(
      `UPDATE admin_calendar_events SET
        title = COALESCE($1, title), description = COALESCE($2, description),
        event_date = COALESCE($3, event_date), start_time = COALESCE($4, start_time),
        end_time = COALESCE($5, end_time), all_day = COALESCE($6, all_day),
        location = COALESCE($7, location), category = COALESCE($8, category),
        recurrence = COALESCE($9, recurrence), recurrence_end = COALESCE($10, recurrence_end),
        assigned_to = COALESCE($11, assigned_to), status = COALESCE($12, status),
        updated_at = NOW()
       WHERE id = $13 RETURNING *`,
      [sanitize(title), sanitize(description, 5000), event_date || null, start_time || null,
       end_time || null, all_day != null ? !!all_day : null, sanitize(location),
       cat || null, recurrence || null, recurrence_end || null,
       Array.isArray(assigned_to) ? assigned_to : null, st || null, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Event not found' });
    res.json({ ok: true, event: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/admin/calendar/events/:id
 */
router.delete('/events/:id', async (req, res) => {
  try {
    if (!await ensureTables()) return res.status(503).json({ error: 'Database unavailable' });
    const result = await query('DELETE FROM admin_calendar_events WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Event not found' });
    res.json({ ok: true, deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════
// TASKS
// ════════════════════════════════════════════════════════════════

/**
 * GET /api/admin/calendar/tasks
 * List tasks with optional filters
 */
router.get('/tasks', async (req, res) => {
  try {
    if (!await ensureTables()) return res.status(503).json({ error: 'Database unavailable' });
    const { status, priority, assigned_to, category, due_before, due_after, limit } = req.query;
    let sql = 'SELECT * FROM admin_tasks WHERE 1=1';
    const values = [];
    let idx = 1;
    if (status) { sql += ` AND status = $${idx++}`; values.push(status); }
    if (priority) { sql += ` AND priority = $${idx++}`; values.push(priority); }
    if (assigned_to) { sql += ` AND assigned_to = $${idx++}`; values.push(assigned_to); }
    if (category) { sql += ` AND category = $${idx++}`; values.push(category); }
    if (due_before) { sql += ` AND due_date <= $${idx++}`; values.push(due_before); }
    if (due_after) { sql += ` AND due_date >= $${idx++}`; values.push(due_after); }
    sql += ' ORDER BY CASE priority WHEN \'urgent\' THEN 0 WHEN \'high\' THEN 1 WHEN \'medium\' THEN 2 ELSE 3 END, due_date ASC NULLS LAST, created_at DESC';
    if (limit) sql += ` LIMIT ${Math.min(parseInt(limit, 10) || 100, 500)}`;
    else sql += ' LIMIT 200';
    const result = await query(sql, values);
    res.json({ ok: true, tasks: result.rows, count: result.rows.length });
  } catch (err) {
    console.error('[Calendar] List tasks error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/admin/calendar/tasks/:id
 */
router.get('/tasks/:id', async (req, res) => {
  try {
    if (!await ensureTables()) return res.status(503).json({ error: 'Database unavailable' });
    const result = await query('SELECT * FROM admin_tasks WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Task not found' });
    // Include subtasks
    const subtasks = await query('SELECT * FROM admin_tasks WHERE parent_task_id = $1 ORDER BY created_at', [req.params.id]);
    res.json({ ok: true, task: result.rows[0], subtasks: subtasks.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/admin/calendar/tasks
 */
router.post('/tasks', async (req, res) => {
  try {
    if (!await ensureTables()) return res.status(503).json({ error: 'Database unavailable' });
    const { title, description, priority, due_date, due_time, assigned_to, category, tags, parent_task_id } = req.body;
    if (!title) return res.status(400).json({ error: 'title is required' });
    const pri = VALID_PRIORITIES.includes(priority) ? priority : 'medium';
    const cat = VALID_CATEGORIES.includes(category) ? category : 'general';
    const createdBy = req.adminUser?.email || req.adminUser?.name || 'system';
    const result = await query(
      `INSERT INTO admin_tasks (title, description, priority, due_date, due_time, assigned_to, category, tags, parent_task_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [sanitize(title), sanitize(description, 5000), pri, due_date || null, due_time || null,
       sanitize(assigned_to, 255), cat, Array.isArray(tags) ? tags : null,
       parent_task_id ? parseInt(parent_task_id, 10) : null, createdBy]
    );
    console.log(`[Tasks] Task created: ${result.rows[0].id} "${title}" [${pri}]`);
    res.status(201).json({ ok: true, task: result.rows[0] });
  } catch (err) {
    console.error('[Tasks] Create task error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/admin/calendar/tasks/:id
 */
router.put('/tasks/:id', async (req, res) => {
  try {
    if (!await ensureTables()) return res.status(503).json({ error: 'Database unavailable' });
    const { title, description, status, priority, due_date, due_time, assigned_to, category, tags } = req.body;
    const st = VALID_TASK_STATUSES.includes(status) ? status : undefined;
    const pri = VALID_PRIORITIES.includes(priority) ? priority : undefined;
    const cat = VALID_CATEGORIES.includes(category) ? category : undefined;
    // If being completed, set completed_at/by
    let completedAt = null;
    let completedBy = null;
    if (st === 'completed') {
      completedAt = new Date().toISOString();
      completedBy = req.adminUser?.email || req.adminUser?.name || 'system';
    }
    const result = await query(
      `UPDATE admin_tasks SET
        title = COALESCE($1, title), description = COALESCE($2, description),
        status = COALESCE($3, status), priority = COALESCE($4, priority),
        due_date = COALESCE($5, due_date), due_time = COALESCE($6, due_time),
        assigned_to = COALESCE($7, assigned_to), category = COALESCE($8, category),
        tags = COALESCE($9, tags),
        completed_at = COALESCE($10, completed_at), completed_by = COALESCE($11, completed_by),
        updated_at = NOW()
       WHERE id = $12 RETURNING *`,
      [sanitize(title), sanitize(description, 5000), st || null, pri || null,
       due_date || null, due_time || null, sanitize(assigned_to, 255),
       cat || null, Array.isArray(tags) ? tags : null,
       completedAt, completedBy, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Task not found' });
    res.json({ ok: true, task: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/admin/calendar/tasks/:id
 */
router.delete('/tasks/:id', async (req, res) => {
  try {
    if (!await ensureTables()) return res.status(503).json({ error: 'Database unavailable' });
    const result = await query('DELETE FROM admin_tasks WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Task not found' });
    res.json({ ok: true, deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PATCH /api/admin/calendar/tasks/:id/complete
 * Quick-complete a task
 */
router.patch('/tasks/:id/complete', async (req, res) => {
  try {
    if (!await ensureTables()) return res.status(503).json({ error: 'Database unavailable' });
    const completedBy = req.adminUser?.email || req.adminUser?.name || 'system';
    const result = await query(
      `UPDATE admin_tasks SET status = 'completed', completed_at = NOW(), completed_by = $1, updated_at = NOW()
       WHERE id = $2 AND status != 'completed' RETURNING *`,
      [completedBy, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Task not found or already completed' });
    res.json({ ok: true, task: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════
// REMINDERS
// ════════════════════════════════════════════════════════════════

/**
 * GET /api/admin/calendar/reminders
 * List pending reminders
 */
router.get('/reminders', async (req, res) => {
  try {
    if (!await ensureTables()) return res.status(503).json({ error: 'Database unavailable' });
    const { pending_only } = req.query;
    let sql = `SELECT r.*, t.title AS task_title, e.title AS event_title
               FROM admin_task_reminders r
               LEFT JOIN admin_tasks t ON r.task_id = t.id
               LEFT JOIN admin_calendar_events e ON r.event_id = e.id`;
    if (pending_only !== 'false') sql += ' WHERE r.sent = FALSE';
    sql += ' ORDER BY r.remind_at ASC LIMIT 200';
    const result = await query(sql);
    res.json({ ok: true, reminders: result.rows, count: result.rows.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/admin/calendar/reminders
 */
router.post('/reminders', async (req, res) => {
  try {
    if (!await ensureTables()) return res.status(503).json({ error: 'Database unavailable' });
    const { task_id, event_id, remind_at, method, recipient } = req.body;
    if (!task_id && !event_id) return res.status(400).json({ error: 'task_id or event_id is required' });
    if (!remind_at) return res.status(400).json({ error: 'remind_at is required' });
    const meth = VALID_REMINDER_METHODS.includes(method) ? method : 'in_app';
    const result = await query(
      `INSERT INTO admin_task_reminders (task_id, event_id, remind_at, method, recipient)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [task_id ? parseInt(task_id, 10) : null, event_id ? parseInt(event_id, 10) : null,
       remind_at, meth, sanitize(recipient, 255)]
    );
    res.status(201).json({ ok: true, reminder: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/admin/calendar/reminders/:id
 */
router.delete('/reminders/:id', async (req, res) => {
  try {
    if (!await ensureTables()) return res.status(503).json({ error: 'Database unavailable' });
    const result = await query('DELETE FROM admin_task_reminders WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Reminder not found' });
    res.json({ ok: true, deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════
// DASHBOARD / SUMMARY
// ════════════════════════════════════════════════════════════════

/**
 * GET /api/admin/calendar/dashboard
 * Summary of upcoming events, pending tasks, and due reminders
 */
router.get('/dashboard', async (req, res) => {
  try {
    if (!await ensureTables()) return res.status(503).json({ error: 'Database unavailable' });
    const today = new Date().toISOString().split('T')[0];
    const weekFromNow = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];

    const [upcomingEvents, pendingTasks, overdueTasks, dueReminders, taskStats] = await Promise.all([
      query(`SELECT * FROM admin_calendar_events WHERE event_date BETWEEN $1 AND $2 AND status = 'scheduled' ORDER BY event_date, start_time LIMIT 20`, [today, weekFromNow]),
      query(`SELECT * FROM admin_tasks WHERE status IN ('pending', 'in_progress') ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, due_date ASC NULLS LAST LIMIT 20`),
      query(`SELECT * FROM admin_tasks WHERE status IN ('pending', 'in_progress') AND due_date < $1 ORDER BY due_date LIMIT 20`, [today]),
      query(`SELECT r.*, t.title AS task_title, e.title AS event_title FROM admin_task_reminders r LEFT JOIN admin_tasks t ON r.task_id = t.id LEFT JOIN admin_calendar_events e ON r.event_id = e.id WHERE r.sent = FALSE AND r.remind_at <= NOW() + INTERVAL '1 hour' ORDER BY r.remind_at LIMIT 20`),
      query(`SELECT status, COUNT(*) AS count FROM admin_tasks GROUP BY status`)
    ]);

    const statsMap = {};
    for (const row of taskStats.rows) statsMap[row.status] = parseInt(row.count, 10);

    res.json({
      ok: true,
      upcoming_events: upcomingEvents.rows,
      pending_tasks: pendingTasks.rows,
      overdue_tasks: overdueTasks.rows,
      due_reminders: dueReminders.rows,
      task_stats: statsMap
    });
  } catch (err) {
    console.error('[Calendar] Dashboard error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Reminder Processor ──
// Called periodically (e.g. every 5 min) to send due reminders via email or SMS
async function processReminders() {
  try {
    await ensureTables();
    const { rows: due } = await query(
      `SELECT r.*, t.title as task_title, e.title as event_title
       FROM admin_task_reminders r
       LEFT JOIN admin_tasks t ON r.task_id = t.id
       LEFT JOIN admin_calendar_events e ON r.event_id = e.id
       WHERE r.sent = false AND r.remind_at <= NOW()
       LIMIT 10`
    );
    if (!due.length) return;

    for (const rem of due) {
      const label = rem.task_title || rem.event_title || 'Reminder';
      const body = rem.task_title
        ? `Task reminder: "${rem.task_title}" is due.`
        : `Event reminder: "${rem.event_title}" is coming up.`;

      try {
        if (rem.method === 'sms') {
          const smsService = (await import('../services/sms-service.js')).default;
          await smsService.sendSms({ to: rem.recipient, message: `[GreenReach] ${body}` });
        } else {
          const emailService = (await import('../services/email-service.js')).default;
          await emailService.sendEmail({
            to: rem.recipient,
            subject: `[GreenReach] ${label}`,
            text: body,
            html: `<h3>${label}</h3><p>${body}</p>`
          });
        }
        await query('UPDATE admin_task_reminders SET sent = true, sent_at = NOW() WHERE id = $1', [rem.id]);
        console.log(`[Calendar] Reminder ${rem.id} sent via ${rem.method} to ${rem.recipient}`);
      } catch (sendErr) {
        console.error(`[Calendar] Failed to send reminder ${rem.id}:`, sendErr.message);
      }
    }
  } catch (err) { console.error('[Calendar] Reminder processor error:', err.message); }
}

// Start reminder check interval (every 5 minutes)
setInterval(processReminders, 5 * 60 * 1000);
// Run once on startup after a short delay
setTimeout(processReminders, 30_000);

export default router;
