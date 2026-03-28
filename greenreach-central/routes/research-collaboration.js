/**
 * Research Collaboration & Access Control Routes
 * Research Platform Phase 6 -- Collaborators, Reviews, Sharing, Onboarding
 *
 * Endpoints:
 *   GET/POST   /research/studies/:id/collaborators        -- Study collaborators
 *   PATCH      /research/collaborators/:id                -- Update collaborator
 *   DELETE     /research/collaborators/:id                -- Remove collaborator
 *   GET/POST   /research/studies/:id/comments             -- Review comments
 *   PATCH      /research/comments/:id                     -- Resolve comment
 *   POST       /research/studies/:id/share                -- Create share link
 *   GET        /research/share/:token                     -- Validate share link
 *   GET/POST   /research/onboarding                       -- Onboarding checklists
 *   PATCH      /research/onboarding/:id                   -- Update checklist progress
 */
import { Router } from 'express';
import { query, isDatabaseAvailable } from '../config/database.js';
import crypto from 'crypto';
import { verifyCollaboratorOwnership, verifyCommentOwnership, verifyOnboardingOwnership, verifyStudyOwnership } from '../middleware/research-tenant.js';

const router = Router();

const checkDb = async (req, res, next) => {
  if (!(await isDatabaseAvailable())) {
    return res.status(503).json({ ok: false, error: 'Database not available' });
  }
  next();
};

router.use(checkDb);

// ─── Collaborators ────────────────────────────────────────────────────

router.get('/research/studies/:id/collaborators', verifyStudyOwnership, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await query(`
      SELECT sc.*, u.email, rp.institution, rp.orcid_id
      FROM study_collaborators sc
      LEFT JOIN farm_users u ON sc.user_id = u.id
      LEFT JOIN researcher_profiles rp ON rp.user_id = sc.user_id
      WHERE sc.study_id = $1
      ORDER BY sc.created_at
    `, [id]);

    res.json({ ok: true, collaborators: result.rows });
  } catch (err) {
    console.error('[ResearchCollab] Collaborator list error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to list collaborators' });
  }
});

router.post('/research/studies/:id/collaborators', verifyStudyOwnership, async (req, res) => {
  try {
    const { id } = req.params;
    const { user_id, email, role, permissions, invited_by, expires_at } = req.body;
    if (!role) return res.status(400).json({ ok: false, error: 'role required' });
    if (!user_id && !email) return res.status(400).json({ ok: false, error: 'user_id or email required' });

    const result = await query(`
      INSERT INTO study_collaborators (study_id, user_id, email, role, permissions, invited_by, expires_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [id, user_id || null, email || null, role,
        JSON.stringify(permissions || { read: true, write: false, export: false, approve: false }),
        invited_by || null, expires_at || null]);

    res.status(201).json({ ok: true, collaborator: result.rows[0] });
  } catch (err) {
    console.error('[ResearchCollab] Collaborator add error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to add collaborator' });
  }
});

router.patch('/research/collaborators/:id', verifyCollaboratorOwnership, async (req, res) => {
  try {
    const { id } = req.params;
    const { role, permissions, accepted_at, expires_at } = req.body;
    const updates = [];
    const values = [];
    let idx = 1;

    if (role) { updates.push(`role = $${idx}`); values.push(role); idx++; }
    if (permissions) { updates.push(`permissions = $${idx}`); values.push(JSON.stringify(permissions)); idx++; }
    if (accepted_at) { updates.push(`accepted_at = $${idx}`); values.push(accepted_at); idx++; }
    if (expires_at) { updates.push(`expires_at = $${idx}`); values.push(expires_at); idx++; }

    if (updates.length === 0) {
      return res.status(400).json({ ok: false, error: 'No fields to update' });
    }
    values.push(id);

    const result = await query(`
      UPDATE study_collaborators SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *
    `, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Collaborator not found' });
    }
    res.json({ ok: true, collaborator: result.rows[0] });
  } catch (err) {
    console.error('[ResearchCollab] Collaborator update error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to update collaborator' });
  }
});

router.delete('/research/collaborators/:id', verifyCollaboratorOwnership, async (req, res) => {
  try {
    const { id } = req.params;
    await query('DELETE FROM study_collaborators WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[ResearchCollab] Collaborator remove error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to remove collaborator' });
  }
});

// ─── Review Comments ──────────────────────────────────────────────────

router.get('/research/studies/:id/comments', verifyStudyOwnership, async (req, res) => {
  try {
    const { id } = req.params;
    const { entity_type, entity_id, status } = req.query;
    const params = [id];
    let where = 'WHERE rc.study_id = $1';
    if (entity_type) { params.push(entity_type); where += ` AND rc.entity_type = $${params.length}`; }
    if (entity_id) { params.push(entity_id); where += ` AND rc.entity_id = $${params.length}`; }
    if (status) { params.push(status); where += ` AND rc.status = $${params.length}`; }

    const result = await query(`
      SELECT rc.*, u.email as commenter_email
      FROM review_comments rc
      LEFT JOIN farm_users u ON rc.commenter_id = u.id
      ${where}
      ORDER BY rc.created_at DESC
    `, params);

    res.json({ ok: true, comments: result.rows });
  } catch (err) {
    console.error('[ResearchCollab] Comment list error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to list comments' });
  }
});

router.post('/research/studies/:id/comments', verifyStudyOwnership, async (req, res) => {
  try {
    const { id } = req.params;
    const { entity_type, entity_id, comment_text, commenter_id } = req.body;
    if (!entity_type || !entity_id || !comment_text) {
      return res.status(400).json({ ok: false, error: 'entity_type, entity_id, and comment_text required' });
    }

    const result = await query(`
      INSERT INTO review_comments (study_id, entity_type, entity_id, comment_text, commenter_id)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [id, entity_type, entity_id, comment_text, commenter_id || null]);

    res.status(201).json({ ok: true, comment: result.rows[0] });
  } catch (err) {
    console.error('[ResearchCollab] Comment create error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to create comment' });
  }
});

router.patch('/research/comments/:id', verifyCommentOwnership, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const result = await query(`
      UPDATE review_comments SET status = $1, resolved_at = CASE WHEN $1 = 'resolved' THEN NOW() ELSE NULL END
      WHERE id = $2 RETURNING *
    `, [status || 'resolved', id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Comment not found' });
    }
    res.json({ ok: true, comment: result.rows[0] });
  } catch (err) {
    console.error('[ResearchCollab] Comment resolve error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to resolve comment' });
  }
});

// ─── Share Links ──────────────────────────────────────────────────────

router.post('/research/studies/:id/share', verifyStudyOwnership, async (req, res) => {
  try {
    const { id } = req.params;
    const { scope, entity_id, access_level, expires_at, max_downloads, created_by } = req.body;
    if (!scope || !entity_id) {
      return res.status(400).json({ ok: false, error: 'scope and entity_id required' });
    }

    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const result = await query(`
      INSERT INTO share_links (study_id, created_by, scope, entity_id, access_level, token_hash, expires_at, max_downloads)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [id, created_by || null, scope, entity_id, access_level || 'read_only',
        tokenHash, expires_at || null, max_downloads || null]);

    // Return the raw token ONCE -- caller must store it; only hash is persisted
    res.status(201).json({ ok: true, share_link: result.rows[0], token });
  } catch (err) {
    console.error('[ResearchCollab] Share create error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to create share link' });
  }
});

router.get('/research/share/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const result = await query('SELECT * FROM share_links WHERE token_hash = $1', [tokenHash]);
    if (result.rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Share link not found or expired' });
    }

    const link = result.rows[0];

    // Check expiry
    if (link.expires_at && new Date(link.expires_at) < new Date()) {
      return res.status(410).json({ ok: false, error: 'Share link has expired' });
    }

    // Check download limit
    if (link.max_downloads && link.download_count >= link.max_downloads) {
      return res.status(410).json({ ok: false, error: 'Share link download limit reached' });
    }

    // Increment download count
    await query('UPDATE share_links SET download_count = download_count + 1 WHERE id = $1', [link.id]);

    res.json({ ok: true, share_link: link });
  } catch (err) {
    console.error('[ResearchCollab] Share validate error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to validate share link' });
  }
});

// ─── Onboarding Checklists ────────────────────────────────────────────

router.get('/research/onboarding', async (req, res) => {
  try {
    const farmId = req.farmId || req.query.farm_id;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const { user_id, study_id } = req.query;
    const params = [farmId];
    let where = 'WHERE oc.farm_id = $1';
    if (user_id) { params.push(user_id); where += ` AND oc.user_id = $${params.length}`; }
    if (study_id) { params.push(study_id); where += ` AND oc.study_id = $${params.length}`; }

    const result = await query(`
      SELECT oc.*, u.email, s.title as study_title
      FROM onboarding_checklists oc
      LEFT JOIN farm_users u ON oc.user_id = u.id
      LEFT JOIN studies s ON oc.study_id = s.id
      ${where}
      ORDER BY oc.created_at DESC
    `, params);

    res.json({ ok: true, checklists: result.rows });
  } catch (err) {
    console.error('[ResearchCollab] Onboarding list error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to list checklists' });
  }
});

router.post('/research/onboarding', async (req, res) => {
  try {
    const farmId = req.farmId || req.body.farm_id;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const { user_id, study_id, role, checklist } = req.body;
    if (!role) return res.status(400).json({ ok: false, error: 'role required' });

    const result = await query(`
      INSERT INTO onboarding_checklists (user_id, study_id, farm_id, role, checklist)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [user_id || null, study_id || null, farmId, role, JSON.stringify(checklist || [])]);

    res.status(201).json({ ok: true, checklist: result.rows[0] });
  } catch (err) {
    console.error('[ResearchCollab] Onboarding create error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to create checklist' });
  }
});

router.patch('/research/onboarding/:id', verifyOnboardingOwnership, async (req, res) => {
  try {
    const { id } = req.params;
    const { checklist, progress_pct } = req.body;

    const updates = [];
    const values = [];
    let idx = 1;

    if (checklist !== undefined) { updates.push(`checklist = $${idx}`); values.push(JSON.stringify(checklist)); idx++; }
    if (progress_pct !== undefined) {
      updates.push(`progress_pct = $${idx}`); values.push(progress_pct); idx++;
      if (progress_pct >= 100) {
        updates.push('completed_at = NOW()');
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({ ok: false, error: 'No fields to update' });
    }
    values.push(id);

    const result = await query(`
      UPDATE onboarding_checklists SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *
    `, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Checklist not found' });
    }
    res.json({ ok: true, checklist: result.rows[0] });
  } catch (err) {
    console.error('[ResearchCollab] Onboarding update error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to update checklist' });
  }
});

export default router;
