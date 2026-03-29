// Route: /api/admin/research-invitations
// Admin-only: Create, list, and validate research access codes

const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const { sendResearchInviteEmail } = require('../services/email-service');
const { requireAdmin } = require('../middleware/auth');
const crypto = require('crypto');

// Generate a unique access code
function generateCode() {
  return crypto.randomBytes(8).toString('hex').toUpperCase();
}

// POST /api/admin/research-invitations
// Admin: create and send invite
router.post('/', requireAdmin, async (req, res) => {
  const { name, email } = req.body;
  if (!name || !email) return res.status(400).json({ error: 'Name and email required' });
  const code = generateCode();
  try {
    const result = await db.query(
      'INSERT INTO research_invitations (name, email, code, invited_by) VALUES ($1, $2, $3, $4) RETURNING *',
      [name, email, code, req.user.id]
    );
    await sendResearchInviteEmail({ name, email, code });
    res.json({ success: true, invitation: result.rows[0] });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Email already invited' });
    res.status(500).json({ error: 'Failed to create invitation' });
  }
});

// GET /api/admin/research-invitations
// List all invitations
router.get('/', requireAdmin, async (req, res) => {
  const result = await db.query('SELECT * FROM research_invitations ORDER BY created_at DESC');
  res.json({ invitations: result.rows });
});

// POST /api/research-invitations/validate
// Validate a code (public)
router.post('/validate', async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'Code required' });
  const result = await db.query('SELECT * FROM research_invitations WHERE code = $1', [code]);
  if (!result.rows.length) return res.status(404).json({ error: 'Invalid code' });
  res.json({ valid: true, invitation: result.rows[0] });
});

module.exports = router;
