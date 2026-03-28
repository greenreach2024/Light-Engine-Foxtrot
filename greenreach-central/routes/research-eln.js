/**
 * Electronic Lab Notebook (ELN) Routes
 * Research Platform Phase 5 -- Notebooks, Entries, Attachments, Signatures, Templates
 *
 * Endpoints:
 *   GET/POST          /research/notebooks                      -- List/create notebooks
 *   GET/PATCH         /research/notebooks/:id                  -- Get/update notebook
 *   GET/POST          /research/notebooks/:id/entries          -- List/create entries
 *   PATCH             /research/entries/:id                    -- Update entry
 *   POST              /research/entries/:id/lock               -- Lock entry
 *   POST              /research/entries/:id/sign               -- Sign entry
 *   GET               /research/entries/:id/signatures         -- Get signatures
 *   POST              /research/entries/:id/attachments        -- Add attachment ref
 *   GET               /research/entries/:id/attachments        -- List attachments
 *   POST              /research/entries/:id/link               -- Link entry to entity
 *   GET               /research/entries/:id/links              -- Get entry links
 *   POST              /research/entries/:id/snapshot           -- Take entry snapshot
 *   GET               /research/entries/:id/snapshots          -- List entry snapshots
 *   GET/POST          /research/templates                      -- List/create ELN templates
 */
import { Router } from 'express';
import { query, isDatabaseAvailable } from '../config/database.js';
import crypto from 'crypto';
import { verifyEntryOwnership, verifyNotebookOwnership } from '../middleware/research-tenant.js';

const router = Router();

const checkDb = async (req, res, next) => {
  if (!(await isDatabaseAvailable())) {
    return res.status(503).json({ ok: false, error: 'Database not available' });
  }
  next();
};

router.use(checkDb);

// ─── Notebooks ────────────────────────────────────────────────────────

router.get('/research/notebooks', async (req, res) => {
  try {
    const farmId = req.farmId || req.query.farm_id;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const { study_id, status } = req.query;
    const params = [farmId];
    let where = 'WHERE n.farm_id = $1';
    if (study_id) { params.push(study_id); where += ` AND n.study_id = $${params.length}`; }
    if (status) { params.push(status); where += ` AND n.status = $${params.length}`; }

    const result = await query(`
      SELECT n.*, s.title as study_title, u.email as owner_email,
        (SELECT COUNT(*) FROM eln_entries e WHERE e.notebook_id = n.id) as entry_count
      FROM eln_notebooks n
      LEFT JOIN studies s ON n.study_id = s.id
      LEFT JOIN farm_users u ON n.owner_id = u.id
      ${where}
      ORDER BY n.created_at DESC
    `, params);

    res.json({ ok: true, notebooks: result.rows });
  } catch (err) {
    console.error('[ResearchELN] Notebook list error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to list notebooks' });
  }
});

router.post('/research/notebooks', async (req, res) => {
  try {
    const farmId = req.farmId || req.body.farm_id;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const { title, study_id, owner_id } = req.body;
    if (!title) return res.status(400).json({ ok: false, error: 'title required' });

    const result = await query(`
      INSERT INTO eln_notebooks (farm_id, study_id, title, owner_id)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [farmId, study_id || null, title.trim(), owner_id || null]);

    res.status(201).json({ ok: true, notebook: result.rows[0] });
  } catch (err) {
    console.error('[ResearchELN] Notebook create error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to create notebook' });
  }
});

router.get('/research/notebooks/:id', verifyNotebookOwnership, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await query(`
      SELECT n.*, s.title as study_title, u.email as owner_email
      FROM eln_notebooks n
      LEFT JOIN studies s ON n.study_id = s.id
      LEFT JOIN farm_users u ON n.owner_id = u.id
      WHERE n.id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Notebook not found' });
    }
    res.json({ ok: true, notebook: result.rows[0] });
  } catch (err) {
    console.error('[ResearchELN] Notebook get error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to get notebook' });
  }
});

router.patch('/research/notebooks/:id', verifyNotebookOwnership, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, status } = req.body;
    const updates = [];
    const values = [];
    let idx = 1;

    if (title) { updates.push(`title = $${idx}`); values.push(title); idx++; }
    if (status) { updates.push(`status = $${idx}`); values.push(status); idx++; }

    if (updates.length === 0) {
      return res.status(400).json({ ok: false, error: 'No fields to update' });
    }
    values.push(id);

    const result = await query(`
      UPDATE eln_notebooks SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *
    `, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Notebook not found' });
    }
    res.json({ ok: true, notebook: result.rows[0] });
  } catch (err) {
    console.error('[ResearchELN] Notebook update error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to update notebook' });
  }
});

// ─── Entries ──────────────────────────────────────────────────────────

router.get('/research/notebooks/:id/entries', verifyNotebookOwnership, async (req, res) => {
  try {
    const { id } = req.params;
    const { entry_type, limit = 100, offset = 0 } = req.query;
    const params = [id];
    let where = 'WHERE e.notebook_id = $1';
    if (entry_type) { params.push(entry_type); where += ` AND e.entry_type = $${params.length}`; }
    params.push(parseInt(limit, 10), parseInt(offset, 10));

    const result = await query(`
      SELECT e.*, u.email as created_by_email,
        (SELECT COUNT(*) FROM eln_signatures es WHERE es.entry_id = e.id) as signature_count,
        (SELECT COUNT(*) FROM eln_attachments ea WHERE ea.entry_id = e.id) as attachment_count
      FROM eln_entries e
      LEFT JOIN farm_users u ON e.created_by = u.id
      ${where}
      ORDER BY e.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);

    res.json({ ok: true, entries: result.rows, count: result.rows.length });
  } catch (err) {
    console.error('[ResearchELN] Entry list error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to list entries' });
  }
});

router.post('/research/notebooks/:id/entries', verifyNotebookOwnership, async (req, res) => {
  try {
    const { id } = req.params;
    const { entry_type, content, template_id, created_by } = req.body;

    // Check notebook is not locked
    const nb = await query('SELECT status FROM eln_notebooks WHERE id = $1', [id]);
    if (nb.rows.length === 0) return res.status(404).json({ ok: false, error: 'Notebook not found' });
    if (nb.rows[0].status === 'locked') {
      return res.status(409).json({ ok: false, error: 'Notebook is locked' });
    }

    const result = await query(`
      INSERT INTO eln_entries (notebook_id, entry_type, content, template_id, created_by)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [id, entry_type || 'note', JSON.stringify(content || {}), template_id || null, created_by || null]);

    res.status(201).json({ ok: true, entry: result.rows[0] });
  } catch (err) {
    console.error('[ResearchELN] Entry create error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to create entry' });
  }
});

router.patch('/research/entries/:id', verifyEntryOwnership, async (req, res) => {
  try {
    const { id } = req.params;

    // Check not locked
    const entry = await query('SELECT locked_at FROM eln_entries WHERE id = $1', [id]);
    if (entry.rows.length === 0) return res.status(404).json({ ok: false, error: 'Entry not found' });
    if (entry.rows[0].locked_at) {
      return res.status(409).json({ ok: false, error: 'Entry is locked and cannot be modified' });
    }

    const { content, entry_type } = req.body;
    const updates = [];
    const values = [];
    let idx = 1;

    if (content !== undefined) { updates.push(`content = $${idx}`); values.push(JSON.stringify(content)); idx++; }
    if (entry_type) { updates.push(`entry_type = $${idx}`); values.push(entry_type); idx++; }

    if (updates.length === 0) {
      return res.status(400).json({ ok: false, error: 'No fields to update' });
    }
    updates.push('updated_at = NOW()');
    values.push(id);

    const result = await query(`
      UPDATE eln_entries SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *
    `, values);

    res.json({ ok: true, entry: result.rows[0] });
  } catch (err) {
    console.error('[ResearchELN] Entry update error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to update entry' });
  }
});

// ─── Lock Entry ───────────────────────────────────────────────────────
router.post('/research/entries/:id/lock', verifyEntryOwnership, async (req, res) => {
  try {
    const { id } = req.params;
    const { locked_by } = req.body;

    const result = await query(`
      UPDATE eln_entries SET locked_at = NOW(), locked_by = $1
      WHERE id = $2 AND locked_at IS NULL
      RETURNING *
    `, [locked_by || null, id]);

    if (result.rows.length === 0) {
      return res.status(409).json({ ok: false, error: 'Entry not found or already locked' });
    }
    res.json({ ok: true, entry: result.rows[0] });
  } catch (err) {
    console.error('[ResearchELN] Entry lock error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to lock entry' });
  }
});

// ─── Signatures ───────────────────────────────────────────────────────
router.post('/research/entries/:id/sign', verifyEntryOwnership, async (req, res) => {
  try {
    const { id } = req.params;
    const { signature_type } = req.body;
    // Derive signer from authenticated user — never trust client-supplied signer_id
    const signer_id = req.user?.userId;
    if (!signer_id || signer_id === 'jwt-user') {
      return res.status(403).json({ ok: false, error: 'Authenticated user identity required for signatures' });
    }
    if (!signature_type) {
      return res.status(400).json({ ok: false, error: 'signature_type required' });
    }

    // Generate signature hash from entry content + signer + timestamp
    const entry = await query('SELECT content FROM eln_entries WHERE id = $1', [id]);
    if (entry.rows.length === 0) return res.status(404).json({ ok: false, error: 'Entry not found' });

    const signatureHash = crypto.createHash('sha256')
      .update(JSON.stringify(entry.rows[0].content) + ':' + id + ':' + signer_id + ':' + signature_type + ':' + new Date().toISOString())
      .digest('hex');

    const result = await query(`
      INSERT INTO eln_signatures (entry_id, signer_id, signature_type, signature_hash)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [id, signer_id, signature_type, signatureHash]);

    // Auto-lock entry on PI approval
    if (signature_type === 'pi_approval') {
      await query('UPDATE eln_entries SET locked_at = NOW(), locked_by = $1 WHERE id = $2 AND locked_at IS NULL', [signer_id, id]);
    }

    res.status(201).json({ ok: true, signature: result.rows[0] });
  } catch (err) {
    console.error('[ResearchELN] Sign error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to sign entry' });
  }
});

router.get('/research/entries/:id/signatures', verifyEntryOwnership, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await query(`
      SELECT es.*, u.email as signer_email
      FROM eln_signatures es
      LEFT JOIN farm_users u ON es.signer_id = u.id
      WHERE es.entry_id = $1
      ORDER BY es.signed_at
    `, [id]);

    res.json({ ok: true, signatures: result.rows });
  } catch (err) {
    console.error('[ResearchELN] Signatures list error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to list signatures' });
  }
});

// ─── Attachments ──────────────────────────────────────────────────────
router.post('/research/entries/:id/attachments', verifyEntryOwnership, async (req, res) => {
  try {
    const { id } = req.params;
    const { file_name, file_type, s3_key, file_size, checksum, uploaded_by } = req.body;
    if (!file_name) return res.status(400).json({ ok: false, error: 'file_name required' });

    const result = await query(`
      INSERT INTO eln_attachments (entry_id, file_name, file_type, s3_key, file_size, checksum, uploaded_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [id, file_name, file_type || 'other', s3_key || null, file_size || null, checksum || null, uploaded_by || null]);

    res.status(201).json({ ok: true, attachment: result.rows[0] });
  } catch (err) {
    console.error('[ResearchELN] Attachment create error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to create attachment' });
  }
});

router.get('/research/entries/:id/attachments', verifyEntryOwnership, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await query('SELECT * FROM eln_attachments WHERE entry_id = $1 ORDER BY uploaded_at', [id]);
    res.json({ ok: true, attachments: result.rows });
  } catch (err) {
    console.error('[ResearchELN] Attachment list error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to list attachments' });
  }
});

// ─── Entry Links ──────────────────────────────────────────────────────
router.post('/research/entries/:id/link', verifyEntryOwnership, async (req, res) => {
  try {
    const { id } = req.params;
    const { linked_entity_type, linked_entity_id } = req.body;
    if (!linked_entity_type || !linked_entity_id) {
      return res.status(400).json({ ok: false, error: 'linked_entity_type and linked_entity_id required' });
    }

    const result = await query(`
      INSERT INTO eln_links (entry_id, linked_entity_type, linked_entity_id)
      VALUES ($1, $2, $3)
      RETURNING *
    `, [id, linked_entity_type, linked_entity_id]);

    res.status(201).json({ ok: true, link: result.rows[0] });
  } catch (err) {
    console.error('[ResearchELN] Link create error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to link entry' });
  }
});

router.get('/research/entries/:id/links', verifyEntryOwnership, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await query('SELECT * FROM eln_links WHERE entry_id = $1 ORDER BY created_at', [id]);
    res.json({ ok: true, links: result.rows });
  } catch (err) {
    console.error('[ResearchELN] Link list error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to list links' });
  }
});

// ─── Snapshots ────────────────────────────────────────────────────────
router.post('/research/entries/:id/snapshot', verifyEntryOwnership, async (req, res) => {
  try {
    const { id } = req.params;
    const { milestone_id } = req.body;

    const entry = await query('SELECT content FROM eln_entries WHERE id = $1', [id]);
    if (entry.rows.length === 0) return res.status(404).json({ ok: false, error: 'Entry not found' });

    const snapshotContent = entry.rows[0].content;
    const snapshotHash = crypto.createHash('sha256')
      .update(JSON.stringify(snapshotContent))
      .digest('hex');

    const result = await query(`
      INSERT INTO eln_snapshots (entry_id, snapshot_content, snapshot_hash, milestone_id)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [id, JSON.stringify(snapshotContent), snapshotHash, milestone_id || null]);

    res.status(201).json({ ok: true, snapshot: result.rows[0] });
  } catch (err) {
    console.error('[ResearchELN] Snapshot create error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to create snapshot' });
  }
});

router.get('/research/entries/:id/snapshots', verifyEntryOwnership, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await query('SELECT * FROM eln_snapshots WHERE entry_id = $1 ORDER BY created_at', [id]);
    res.json({ ok: true, snapshots: result.rows });
  } catch (err) {
    console.error('[ResearchELN] Snapshot list error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to list snapshots' });
  }
});

// ─── Templates ────────────────────────────────────────────────────────
router.get('/research/templates', async (req, res) => {
  try {
    const farmId = req.farmId || req.query.farm_id;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const result = await query('SELECT * FROM eln_templates WHERE farm_id = $1 ORDER BY name', [farmId]);
    res.json({ ok: true, templates: result.rows });
  } catch (err) {
    console.error('[ResearchELN] Template list error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to list templates' });
  }
});

router.post('/research/templates', async (req, res) => {
  try {
    const farmId = req.farmId || req.body.farm_id;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const { name, description, fields, created_by } = req.body;
    if (!name) return res.status(400).json({ ok: false, error: 'name required' });

    const result = await query(`
      INSERT INTO eln_templates (farm_id, name, description, fields, created_by)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [farmId, name.trim(), description || null, JSON.stringify(fields || []), created_by || null]);

    res.status(201).json({ ok: true, template: result.rows[0] });
  } catch (err) {
    console.error('[ResearchELN] Template create error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to create template' });
  }
});

export default router;
