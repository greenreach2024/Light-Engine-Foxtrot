/**
 * Farm User Management Routes
 * Handles farm-scoped user CRUD (distinct from /api/admin/users which is platform admin)
 * 
 * Endpoints:
 *   POST /api/users/create          - Create farm user
 *   GET  /api/users/list             - List farm users
 *   POST /api/users/delete           - Delete farm user
 *   POST /api/user/change-password   - Change own password
 *   POST /api/auth/generate-device-token - Generate device auth token
 */
import { Router } from 'express';
import { query, isDatabaseAvailable } from '../config/database.js';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

const router = Router();
function getJwtSecret() {
  if (!process.env.JWT_SECRET && (process.env.NODE_ENV === 'production' || process.env.DEPLOYMENT_MODE === 'cloud')) {
    throw new Error('JWT_SECRET environment variable is required in production');
  }
  return process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
}
const JWT_SECRET = getJwtSecret();

// POST /create — Create a farm user
router.post('/create', async (req, res) => {
  try {
    const farmId = req.farmId || req.body.farm_id;
    const { email, name, first_name, last_name, role = 'operator', password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password required' });
    }

    const bcrypt = await import('bcryptjs');
    const hash = await bcrypt.default.hash(password, 10);
    const firstName = first_name || name?.split(' ')[0] || email.split('@')[0];
    const lastName = last_name || name?.split(' ').slice(1).join(' ') || '';

    if (await isDatabaseAvailable()) {
      await query(
        `INSERT INTO farm_users (id, farm_id, email, first_name, last_name, role, password_hash, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', NOW(), NOW())
         ON CONFLICT (farm_id, email) DO UPDATE SET
           first_name = EXCLUDED.first_name,
           last_name = EXCLUDED.last_name,
           role = EXCLUDED.role,
           password_hash = EXCLUDED.password_hash,
           updated_at = NOW()`,
        [crypto.randomUUID(), farmId, email.toLowerCase(), firstName, lastName, role, hash]
      );
      res.json({ success: true, message: 'User created' });
    } else {
      res.json({ success: true, message: 'User created (in-memory — no DB)', user: { email, role } });
    }
  } catch (error) {
    console.error('[FarmUsers] Create error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to create user', message: error.message });
  }
});

// GET /list — List users for a farm
router.get('/list', async (req, res) => {
  try {
    const farmId = req.farmId || req.query.farm_id;

    if (await isDatabaseAvailable() && farmId) {
      const { rows } = await query(
        `SELECT email, first_name, last_name, role, status, last_login, created_at
         FROM farm_users WHERE farm_id = $1 ORDER BY created_at DESC`,
        [farmId]
      );
      res.json({
        success: true,
        users: rows.map(r => ({
          email: r.email,
          name: [r.first_name, r.last_name].filter(Boolean).join(' ') || r.email,
          role: r.role,
          status: r.status,
          lastLogin: r.last_login,
          createdAt: r.created_at,
        }))
      });
    } else {
      // Return default admin user when no DB
      res.json({
        success: true,
        users: [{
          email: 'admin@farm.local',
          name: 'Farm Admin',
          role: 'admin',
          status: 'active',
          lastLogin: null,
          createdAt: new Date().toISOString()
        }]
      });
    }
  } catch (error) {
    console.error('[FarmUsers] List error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to list users' });
  }
});

// PATCH /update — Update a farm user's role or status
router.patch('/update', async (req, res) => {
  try {
    const farmId = req.farmId || req.body.farm_id;
    const { email, role, status } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, error: 'Email required' });
    }

    const updates = [];
    const params = [];
    let paramIdx = 1;

    if (role) { updates.push(`role = $${paramIdx++}`); params.push(role); }
    if (status) { updates.push(`status = $${paramIdx++}`); params.push(status); }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, error: 'No fields to update (role or status required)' });
    }

    updates.push(`updated_at = NOW()`);
    params.push(farmId, email.toLowerCase());

    if (await isDatabaseAvailable()) {
      const { rowCount } = await query(
        `UPDATE farm_users SET ${updates.join(', ')} WHERE farm_id = $${paramIdx++} AND email = $${paramIdx}`,
        params
      );
      if (rowCount === 0) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }
    }
    res.json({ success: true, message: 'User updated' });
  } catch (error) {
    console.error('[FarmUsers] Update error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to update user' });
  }
});

// POST /delete — Delete a farm user
router.post('/delete', async (req, res) => {
  try {
    const farmId = req.farmId || req.body.farm_id;
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, error: 'Email required' });
    }

    if (await isDatabaseAvailable()) {
      await query(
        'DELETE FROM farm_users WHERE farm_id = $1 AND email = $2',
        [farmId, email.toLowerCase()]
      );
    }
    res.json({ success: true, message: 'User deleted' });
  } catch (error) {
    console.error('[FarmUsers] Delete error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to delete user' });
  }
});

// Separate router for /api/user/* (singular)
export const userRouter = Router();

// POST /change-password
userRouter.post('/change-password', async (req, res) => {
  try {
    const farmId = req.farmId;
    const { email, currentPassword, newPassword } = req.body;

    if (!email || !newPassword) {
      return res.status(400).json({ success: false, error: 'Email and new password required' });
    }

    const bcrypt = await import('bcryptjs');
    const hash = await bcrypt.default.hash(newPassword, 10);

    if (await isDatabaseAvailable()) {
      const { rowCount } = await query(
        'UPDATE farm_users SET password_hash = $1, updated_at = NOW() WHERE farm_id = $2 AND email = $3',
        [hash, farmId, email.toLowerCase()]
      );
      if (rowCount === 0) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }
    }
    res.json({ success: true, message: 'Password changed' });
  } catch (error) {
    console.error('[FarmUsers] Change password error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to change password' });
  }
});

// Separate router for device token generation (/api/auth/generate-device-token)
export const deviceTokenRouter = Router();

deviceTokenRouter.post('/generate-device-token', (req, res) => {
  try {
    const farmId = req.farmId || req.body.farm_id || 'default';
    const { deviceName, deviceType = 'tablet' } = req.body;

    const token = jwt.sign(
      {
        farm_id: farmId,
        device_name: deviceName || `${deviceType}-${Date.now()}`,
        device_type: deviceType,
        role: 'device',
        type: 'device-token',
      },
      JWT_SECRET,
      { expiresIn: '365d', audience: 'greenreach-farms', issuer: 'greenreach-central' }
    );

    res.json({
      success: true,
      token,
      device: { name: deviceName, type: deviceType, farm_id: farmId },
      expiresIn: '365 days',
    });
  } catch (error) {
    console.error('[Auth] Generate device token error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to generate device token' });
  }
});

export default router;
