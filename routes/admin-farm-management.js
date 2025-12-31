import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { getJwtSecret } from '../server/utils/secrets-manager.js';
import { initDatabase } from '../lib/database.js';

const router = express.Router();

/**
 * Admin authentication middleware
 * Verifies JWT token has admin role
 */
function requireAdmin(req, res, next) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Admin authentication required' });
  }
  
  try {
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, getJwtSecret());
    
    if (decoded.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    req.admin = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired admin token' });
  }
}

/**
 * GET /api/admin/farms
 * List all registered farms
 */
router.get('/farms', requireAdmin, async (req, res) => {
  try {
    const db = await initDatabase();
    
    const farms = await db.all(`
      SELECT 
        f.farm_id,
        f.name,
        f.email,
        f.status,
        f.tier,
        f.created_at,
        f.last_heartbeat as last_login,
        COUNT(DISTINCT u.id) as user_count
      FROM farms f
      LEFT JOIN users u ON f.farm_id = u.farm_id
      GROUP BY f.farm_id
      ORDER BY f.created_at DESC
    `);
    
    res.json({ success: true, farms });
  } catch (error) {
    console.error('Error listing farms:', error);
    res.status(500).json({ error: 'Failed to list farms' });
  }
});

/**
 * GET /api/admin/users
 * List all users across all farms
 */
router.get('/users', requireAdmin, async (req, res) => {
  try {
    const db = await initDatabase();
    
    const users = await db.all(`
      SELECT 
        u.id as user_id,
        u.email,
        u.first_name,
        u.last_name,
        u.role,
        u.status,
        u.last_login,
        u.created_at,
        u.farm_id,
        f.name as farm_name
      FROM users u
      LEFT JOIN farms f ON u.farm_id = f.farm_id
      ORDER BY u.created_at DESC
    `);
    
    res.json({ success: true, users });
  } catch (error) {
    console.error('Error listing users:', error);
    res.status(500).json({ error: 'Failed to list users' });
  }
});

/**
 * POST /api/admin/farms/:farmId/reset-credentials
 * Reset farm credentials (password, API keys)
 */
router.post('/farms/:farmId/reset-credentials', requireAdmin, async (req, res) => {
  try {
    const { farmId } = req.params;
    const db = await initDatabase();
    
    // Get farm
    const farm = await db.get('SELECT * FROM farms WHERE farm_id = ?', [farmId]);
    if (!farm) {
      return res.status(404).json({ error: 'Farm not found' });
    }
    
    // Generate temporary password
    const tempPassword = crypto.randomBytes(8).toString('hex');
    const passwordHash = await bcrypt.hash(tempPassword, 10);
    
    // Update admin user password
    await db.run(
      `UPDATE users SET password_hash = ?, must_change_password = 1 
       WHERE farm_id = ? AND role = 'admin' LIMIT 1`,
      [passwordHash, farmId]
    );
    
    // Regenerate API keys
    const newApiKey = 'lef_' + crypto.randomBytes(32).toString('hex');
    await db.run(
      'UPDATE farms SET api_key = ? WHERE farm_id = ?',
      [newApiKey, farmId]
    );
    
    // Log action
    await db.run(
      `INSERT INTO admin_audit_log (admin_id, action, resource_type, resource_id, metadata, ip_address)
       VALUES (?, 'RESET_CREDENTIALS', 'farm', ?, ?, ?)`,
      [req.admin.admin_id, farmId, JSON.stringify({ farm_id: farmId }), req.ip]
    );
    
    res.json({ 
      success: true, 
      email: farm.email,
      temp_password: tempPassword,
      message: 'Credentials reset successfully'
    });
  } catch (error) {
    console.error('Error resetting farm credentials:', error);
    res.status(500).json({ error: 'Failed to reset credentials' });
  }
});

/**
 * POST /api/admin/users/:userId/reset-password
 * Reset user password
 */
router.post('/users/:userId/reset-password', requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const db = await initDatabase();
    
    // Get user
    const user = await db.get('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Generate temporary password
    const tempPassword = crypto.randomBytes(8).toString('hex');
    const passwordHash = await bcrypt.hash(tempPassword, 10);
    
    // Update password
    await db.run(
      'UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?',
      [passwordHash, userId]
    );
    
    // Log action
    await db.run(
      `INSERT INTO admin_audit_log (admin_id, action, resource_type, resource_id, metadata, ip_address)
       VALUES (?, 'RESET_PASSWORD', 'user', ?, ?, ?)`,
      [req.admin.admin_id, userId, JSON.stringify({ user_id: userId, email: user.email }), req.ip]
    );
    
    res.json({ 
      success: true, 
      temp_password: tempPassword,
      message: 'Password reset successfully'
    });
  } catch (error) {
    console.error('Error resetting password:', error);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

/**
 * PATCH /api/admin/farms/:farmId/status
 * Toggle farm status (active/suspended)
 */
router.patch('/farms/:farmId/status', requireAdmin, async (req, res) => {
  try {
    const { farmId } = req.params;
    const { status } = req.body;
    const db = await initDatabase();
    
    if (!['active', 'suspended', 'pending', 'inactive'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    
    await db.run('UPDATE farms SET status = ? WHERE farm_id = ?', [status, farmId]);
    
    // Log action
    await db.run(
      `INSERT INTO admin_audit_log (admin_id, action, resource_type, resource_id, metadata, ip_address)
       VALUES (?, 'UPDATE_STATUS', 'farm', ?, ?, ?)`,
      [req.admin.admin_id, farmId, JSON.stringify({ farm_id: farmId, new_status: status }), req.ip]
    );
    
    res.json({ success: true, message: 'Farm status updated' });
  } catch (error) {
    console.error('Error updating farm status:', error);
    res.status(500).json({ error: 'Failed to update farm status' });
  }
});

/**
 * PATCH /api/admin/users/:userId/status
 * Toggle user status (active/disabled)
 */
router.patch('/users/:userId/status', requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const { status } = req.body;
    const db = await initDatabase();
    
    if (!['active', 'disabled'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    
    await db.run('UPDATE users SET status = ? WHERE id = ?', [status, userId]);
    
    // Log action
    await db.run(
      `INSERT INTO admin_audit_log (admin_id, action, resource_type, resource_id, metadata, ip_address)
       VALUES (?, 'UPDATE_STATUS', 'user', ?, ?, ?)`,
      [req.admin.admin_id, userId, JSON.stringify({ user_id: userId, new_status: status }), req.ip]
    );
    
    res.json({ success: true, message: 'User status updated' });
  } catch (error) {
    console.error('Error updating user status:', error);
    res.status(500).json({ error: 'Failed to update user status' });
  }
});

/**
 * PATCH /api/admin/users/:userId/role
 * Change user role
 */
router.patch('/users/:userId/role', requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const { role } = req.body;
    const db = await initDatabase();
    
    const validRoles = ['admin', 'manager', 'user', 'viewer'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }
    
    await db.run('UPDATE users SET role = ? WHERE id = ?', [role, userId]);
    
    // Log action
    await db.run(
      `INSERT INTO admin_audit_log (admin_id, action, resource_type, resource_id, metadata, ip_address)
       VALUES (?, 'UPDATE_ROLE', 'user', ?, ?, ?)`,
      [req.admin.admin_id, userId, JSON.stringify({ user_id: userId, new_role: role }), req.ip]
    );
    
    res.json({ success: true, message: 'User role updated' });
  } catch (error) {
    console.error('Error updating user role:', error);
    res.status(500).json({ error: 'Failed to update user role' });
  }
});

/**
 * POST /api/admin/impersonate/:farmId
 * Generate impersonation token for support
 */
router.post('/impersonate/:farmId', requireAdmin, async (req, res) => {
  try {
    const { farmId } = req.params;
    const db = await initDatabase();
    
    // Get farm
    const farm = await db.get('SELECT * FROM farms WHERE farm_id = ?', [farmId]);
    if (!farm) {
      return res.status(404).json({ error: 'Farm not found' });
    }
    
    // Get farm admin user
    const adminUser = await db.get(
      'SELECT * FROM users WHERE farm_id = ? AND role = "admin" LIMIT 1',
      [farmId]
    );
    
    if (!adminUser) {
      return res.status(404).json({ error: 'Farm admin user not found' });
    }
    
    // Generate impersonation token (1 hour expiry)
    const token = jwt.sign(
      { 
        user_id: adminUser.id,
        farm_id: farmId,
        email: adminUser.email,
        role: 'admin',
        impersonated_by: req.admin.admin_id,
        impersonation: true
      },
      getJwtSecret(),
      { expiresIn: '1h' }
    );
    
    // Log action
    await db.run(
      `INSERT INTO admin_audit_log (admin_id, action, resource_type, resource_id, metadata, ip_address)
       VALUES (?, 'IMPERSONATE', 'farm', ?, ?, ?)`,
      [req.admin.admin_id, farmId, JSON.stringify({ farm_id: farmId, target_user: adminUser.email }), req.ip]
    );
    
    res.json({ 
      success: true, 
      token,
      expires_in: '1h',
      message: 'Impersonation token generated'
    });
  } catch (error) {
    console.error('Error generating impersonation token:', error);
    res.status(500).json({ error: 'Failed to generate impersonation token' });
  }
});

export default router;
