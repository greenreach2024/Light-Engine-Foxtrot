import { Router } from 'express';
import { query, isDatabaseAvailable } from '../config/database.js';
import { verifyStudyOwnership } from '../middleware/research-tenant.js';

const router = Router();

const MAX_TEXT_LENGTH = 5000;
const MAX_TITLE_LENGTH = 255;

const checkDb = async (req, res, next) => {
  if (!(await isDatabaseAvailable())) {
    return res.status(503).json({ ok: false, error: 'Database not available' });
  }
  next();
};

router.use(checkDb);

// ── Enhanced Project Workspace Operations ──
// workspace_notes: id, farm_id, study_id, user_id, note_type (decision|meeting|general|action),
//   title, content, action_items (JSONB), pinned, created_at, updated_at
// workspace_tasks: id, farm_id, study_id, assigned_to, assigned_by, title, description,
//   status (open|in_progress|blocked|done), priority (low|medium|high|critical),
//   institution, due_date, completed_at, created_at
// change_requests: id, farm_id, study_id, request_type (scope|budget|personnel|timeline),
//   title, description, justification, current_state (JSONB), proposed_state (JSONB),
//   status (draft|submitted|approved|rejected), submitted_by, reviewed_by, reviewed_at, created_at
// milestone_evidence: id, farm_id, study_id, milestone_id, evidence_type (document|data|image|report),
//   title, file_key, file_checksum, uploaded_by, created_at

// ── Workspace Notes (decisions log, meeting notes, shared notes) ──
router.get('/research/studies/:id/notes', verifyStudyOwnership, async (req, res) => {
  try {
    const { note_type, pinned, limit = 20, offset = 0 } = req.query;
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);
    const params = [req.params.id];
    let where = 'WHERE wn.study_id = $1';
    if (note_type) { params.push(note_type); where += ` AND wn.note_type = $${params.length}`; }
    if (pinned === 'true') { where += ' AND wn.pinned = true'; }
    params.push(safeLimit, safeOffset);

    const result = await query(`
      SELECT wn.*, u.email as author_email
      FROM workspace_notes wn
      LEFT JOIN farm_users u ON wn.user_id = u.id
      ${where}
      ORDER BY wn.pinned DESC, wn.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);

    res.json({ ok: true, notes: result.rows, count: result.rows.length });
  } catch (err) {
    console.error('[WorkspaceOps] Notes list error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to list notes' });
  }
});

router.post('/research/studies/:id/notes', verifyStudyOwnership, async (req, res) => {
  try {
    const farmId = req.farmId;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const { note_type, title, content, action_items, pinned } = req.body;
    if (!title || !content) return res.status(400).json({ ok: false, error: "title and content required" });
    if (title.length > MAX_TITLE_LENGTH) return res.status(400).json({ ok: false, error: "title must be 255 characters or fewer" });
    if (content.length > MAX_TEXT_LENGTH) return res.status(400).json({ ok: false, error: "content must be 5000 characters or fewer" });
    if (note_type && !['decision', 'meeting', 'general', 'action'].includes(note_type)) {
      return res.status(400).json({ ok: false, error: 'Invalid note_type' });
    }

    const result = await query(`
      INSERT INTO workspace_notes (farm_id, study_id, user_id, note_type, title, content, action_items, pinned)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [farmId, req.params.id, req.userId || null, note_type || 'general', title, content, JSON.stringify(action_items || []), pinned || false]);

    res.status(201).json({ ok: true, note: result.rows[0] });
  } catch (err) {
    console.error('[WorkspaceOps] Note create error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to create note' });
  }
});

router.patch('/research/notes/:id', async (req, res) => {
  try {
    const { title, content, action_items, pinned } = req.body;
    if (title !== undefined && title.length > MAX_TITLE_LENGTH) {
      return res.status(400).json({ ok: false, error: "title must be 255 characters or fewer" });
    }
    if (content !== undefined && content.length > MAX_TEXT_LENGTH) {
      return res.status(400).json({ ok: false, error: "content must be 5000 characters or fewer" });
    }
    const fields = [];
    const params = [];
    let idx = 1;
    if (title !== undefined) { fields.push(`title = $${idx}`); params.push(title); idx++; }
    if (content !== undefined) { fields.push(`content = $${idx}`); params.push(content); idx++; }
    if (action_items !== undefined) { fields.push(`action_items = $${idx}`); params.push(JSON.stringify(action_items)); idx++; }
    if (pinned !== undefined) { fields.push(`pinned = $${idx}`); params.push(pinned); idx++; }
    if (!fields.length) return res.status(400).json({ ok: false, error: 'No fields to update' });

    fields.push('updated_at = NOW()');
    params.push(req.params.id);
    const result = await query(`UPDATE workspace_notes SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`, params);
    if (!result.rows.length) return res.status(404).json({ ok: false, error: 'Note not found' });
    res.json({ ok: true, note: result.rows[0] });
  } catch (err) {
    console.error('[WorkspaceOps] Note update error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to update note' });
  }
});

// ── Cross-Institution Task Management ──
router.get('/research/studies/:id/tasks', verifyStudyOwnership, async (req, res) => {
  try {
    const { status, assigned_to, institution, priority, limit = 20, offset = 0 } = req.query;
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);
    const params = [req.params.id];
    let where = 'WHERE wt.study_id = $1';
    if (status) { params.push(status); where += ` AND wt.status = $${params.length}`; }
    if (assigned_to) { params.push(assigned_to); where += ` AND wt.assigned_to = $${params.length}`; }
    if (institution) { params.push(institution); where += ` AND wt.institution = $${params.length}`; }
    if (priority) { params.push(priority); where += ` AND wt.priority = $${params.length}`; }
    params.push(safeLimit, safeOffset);

    const result = await query(`
      SELECT wt.*, a.email as assigned_email, b.email as assigner_email
      FROM workspace_tasks wt
      LEFT JOIN farm_users a ON wt.assigned_to = a.id
      LEFT JOIN farm_users b ON wt.assigned_by = b.id
      ${where}
      ORDER BY CASE wt.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, wt.due_date ASC NULLS LAST
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);

    res.json({ ok: true, tasks: result.rows, count: result.rows.length });
  } catch (err) {
    console.error('[WorkspaceOps] Tasks list error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to list tasks' });
  }
});

router.post('/research/studies/:id/tasks', verifyStudyOwnership, async (req, res) => {
  try {
    const farmId = req.farmId;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const { assigned_to, title, description, priority, institution, due_date } = req.body;
    if (!title) return res.status(400).json({ ok: false, error: "title required" });
    if (title.length > MAX_TITLE_LENGTH) return res.status(400).json({ ok: false, error: "title must be 255 characters or fewer" });
    if (description && description.length > MAX_TEXT_LENGTH) return res.status(400).json({ ok: false, error: "description must be 5000 characters or fewer" });

    const result = await query(`
      INSERT INTO workspace_tasks (farm_id, study_id, assigned_to, assigned_by, title, description, priority, institution, due_date)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `, [farmId, req.params.id, assigned_to || null, req.userId || null, title, description || null, priority || 'medium', institution || null, due_date || null]);

    res.status(201).json({ ok: true, task: result.rows[0] });
  } catch (err) {
    console.error('[WorkspaceOps] Task create error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to create task' });
  }
});

router.patch('/research/tasks/:id', async (req, res) => {
  try {
    const { status, priority, assigned_to, title, description, due_date } = req.body;
    if (title !== undefined && title.length > MAX_TITLE_LENGTH) {
      return res.status(400).json({ ok: false, error: "title must be 255 characters or fewer" });
    }
    if (description !== undefined && description.length > MAX_TEXT_LENGTH) {
      return res.status(400).json({ ok: false, error: "description must be 5000 characters or fewer" });
    }
    const fields = [];
    const params = [];
    let idx = 1;
    if (status !== undefined) {
      if (!['open', 'in_progress', 'blocked', 'done'].includes(status)) {
        return res.status(400).json({ ok: false, error: 'Invalid status' });
      }
      fields.push(`status = $${idx}`); params.push(status); idx++;
      if (status === 'done') fields.push('completed_at = NOW()');
    }
    if (priority !== undefined) { fields.push(`priority = $${idx}`); params.push(priority); idx++; }
    if (assigned_to !== undefined) { fields.push(`assigned_to = $${idx}`); params.push(assigned_to); idx++; }
    if (title !== undefined) { fields.push(`title = $${idx}`); params.push(title); idx++; }
    if (description !== undefined) { fields.push(`description = $${idx}`); params.push(description); idx++; }
    if (due_date !== undefined) { fields.push(`due_date = $${idx}`); params.push(due_date); idx++; }
    if (!fields.length) return res.status(400).json({ ok: false, error: 'No fields to update' });

    params.push(req.params.id);
    const result = await query(`UPDATE workspace_tasks SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`, params);
    if (!result.rows.length) return res.status(404).json({ ok: false, error: 'Task not found' });
    res.json({ ok: true, task: result.rows[0] });
  } catch (err) {
    console.error('[WorkspaceOps] Task update error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to update task' });
  }
});

router.delete('/research/tasks/:id', async (req, res) => {
  try {
    const farmId = req.farmId;
    const result = await query('DELETE FROM workspace_tasks WHERE id = $1 AND farm_id = $2 RETURNING id', [req.params.id, farmId]);
    if (!result.rows.length) return res.status(404).json({ ok: false, error: 'Task not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[WorkspaceOps] Task delete error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to delete task' });
  }
});

// ── Change Requests (scope, budget, personnel, timeline) ──
router.get('/research/studies/:id/change-requests', verifyStudyOwnership, async (req, res) => {
  try {
    const { request_type, status } = req.query;
    const params = [req.params.id];
    let where = 'WHERE cr.study_id = $1';
    if (request_type) { params.push(request_type); where += ` AND cr.request_type = $${params.length}`; }
    if (status) { params.push(status); where += ` AND cr.status = $${params.length}`; }

    const result = await query(`
      SELECT cr.*, s.email as submitter_email, r.email as reviewer_email
      FROM change_requests cr
      LEFT JOIN farm_users s ON cr.submitted_by = s.id
      LEFT JOIN farm_users r ON cr.reviewed_by = r.id
      ${where}
      ORDER BY cr.created_at DESC
    `, params);

    res.json({ ok: true, change_requests: result.rows, count: result.rows.length });
  } catch (err) {
    console.error('[WorkspaceOps] Change requests list error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to list change requests' });
  }
});

router.post('/research/studies/:id/change-requests', verifyStudyOwnership, async (req, res) => {
  try {
    const farmId = req.farmId;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const { request_type, title, description, justification, current_state, proposed_state } = req.body;
    if (!request_type || !title || !justification) {
      return res.status(400).json({ ok: false, error: 'request_type, title, and justification required' });
    }
    if (!['scope', 'budget', 'personnel', 'timeline'].includes(request_type)) {
      return res.status(400).json({ ok: false, error: 'Invalid request_type' });
    }
    if (title.length > MAX_TITLE_LENGTH) {
      return res.status(400).json({ ok: false, error: 'title must be 255 characters or fewer' });
    }
    if (description && description.length > MAX_TEXT_LENGTH) {
      return res.status(400).json({ ok: false, error: 'description must be 5000 characters or fewer' });
    }
    if (justification.length > MAX_TEXT_LENGTH) {
      return res.status(400).json({ ok: false, error: 'justification must be 5000 characters or fewer' });
    }

    const result = await query(`
      INSERT INTO change_requests (farm_id, study_id, request_type, title, description, justification, current_state, proposed_state, submitted_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `, [farmId, req.params.id, request_type, title, description || null, justification, JSON.stringify(current_state || {}), JSON.stringify(proposed_state || {}), req.userId || null]);

    res.status(201).json({ ok: true, change_request: result.rows[0] });
  } catch (err) {
    console.error('[WorkspaceOps] Change request create error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to create change request' });
  }
});

router.patch('/research/change-requests/:id/review', async (req, res) => {
  try {
    const { status, comments } = req.body;
    if (!status || !['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ ok: false, error: 'Valid status required (approved|rejected)' });
    }
    if (comments && comments.length > MAX_TEXT_LENGTH) {
      return res.status(400).json({ ok: false, error: 'comments must be 5000 characters or fewer' });
    }

    const result = await query(`
      UPDATE change_requests SET status = $1, reviewed_by = $2, reviewed_at = NOW()
      WHERE id = $3 AND status = 'submitted'
      RETURNING *
    `, [status, req.userId || null, req.params.id]);

    if (!result.rows.length) return res.status(404).json({ ok: false, error: 'Submitted change request not found' });
    res.json({ ok: true, change_request: result.rows[0] });
  } catch (err) {
    console.error('[WorkspaceOps] Change request review error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to review change request' });
  }
});

// ── Milestone Evidence Locker ──
router.get('/research/milestones/:id/evidence', async (req, res) => {
  try {
    const result = await query(`
      SELECT me.*, u.email as uploader_email
      FROM milestone_evidence me
      LEFT JOIN farm_users u ON me.uploaded_by = u.id
      WHERE me.milestone_id = $1
      ORDER BY me.created_at DESC
    `, [req.params.id]);

    res.json({ ok: true, evidence: result.rows, count: result.rows.length });
  } catch (err) {
    console.error('[WorkspaceOps] Evidence list error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to list milestone evidence' });
  }
});

router.post('/research/milestones/:id/evidence', async (req, res) => {
  try {
    const farmId = req.farmId;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const { study_id, evidence_type, title, file_key, file_checksum } = req.body;
    if (!title || !evidence_type) return res.status(400).json({ ok: false, error: 'title and evidence_type required' });
    if (!['document', 'data', 'image', 'report'].includes(evidence_type)) {
      return res.status(400).json({ ok: false, error: 'Invalid evidence_type' });
    }

    const result = await query(`
      INSERT INTO milestone_evidence (farm_id, study_id, milestone_id, evidence_type, title, file_key, file_checksum, uploaded_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [farmId, study_id || null, req.params.id, evidence_type, title, file_key || null, file_checksum || null, req.userId || null]);

    res.status(201).json({ ok: true, evidence: result.rows[0] });
  } catch (err) {
    console.error('[WorkspaceOps] Evidence create error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to add milestone evidence' });
  }
});

export default router;
