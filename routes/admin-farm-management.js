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
  
  console.log('[REQUIRE ADMIN] Checking auth header:', authHeader ? 'Present' : 'Missing');
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.warn('[REQUIRE ADMIN] Missing or invalid Authorization header');
    return res.status(401).json({ error: 'Admin authentication required' });
  }
  
  try {
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, getJwtSecret());
    
    console.log('[REQUIRE ADMIN] Token decoded for:', decoded.email, 'role:', decoded.role);
    
    if (decoded.role !== 'admin') {
      console.warn('[REQUIRE ADMIN] User does not have admin role:', decoded.role);
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    req.admin = decoded;
    next();
  } catch (error) {
    console.error('[REQUIRE ADMIN ERROR] Token verification failed:', error.message);
    return res.status(401).json({ error: 'Invalid or expired admin token' });
  }
}

/**
 * POST /api/admin/auth/login
 * Admin login with email and password
 * Fallback: Hard-coded admin credentials when database is not available
 */
router.post('/auth/login', async (req, res) => {
  try {
    const { email, password, mfa_code } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }
    
    console.log('[AUTH LOGIN] Login attempt for:', email);
    
    // Hard-coded fallback admin credentials (for NeDB/in-memory mode)
    const FALLBACK_ADMIN = {
      email: 'admin@greenreach.com',
      password: 'Admin2025!',
      name: 'System Administrator',
      id: 1,
      farm_id: 'greenreach-hq'
    };
    
    // Check fallback credentials first
    if (email === FALLBACK_ADMIN.email && password === FALLBACK_ADMIN.password) {
      console.log('[AUTH LOGIN] Using fallback admin credentials');
      
      const token = jwt.sign(
        { 
          admin_id: FALLBACK_ADMIN.id,
          user_id: FALLBACK_ADMIN.id,
          email: FALLBACK_ADMIN.email,
          role: 'admin',
          farm_id: FALLBACK_ADMIN.farm_id
        },
        getJwtSecret(),
        { expiresIn: '4h' }
      );
      
      return res.json({ 
        success: true, 
        token,
        admin: {
          id: FALLBACK_ADMIN.id,
          email: FALLBACK_ADMIN.email,
          name: FALLBACK_ADMIN.name,
          farm_id: FALLBACK_ADMIN.farm_id
        }
      });
    }
    
    // Try database authentication
    const db = await initDatabase();
    
    // Check if database is actually available (not NeDB mode)
    if (!db || !db.mode || db.mode === 'nedb') {
      console.warn('[AUTH LOGIN] Database not available, only fallback auth supported');
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // For demo: Allow any user with role='admin' to login to GreenReach Central
    const user = await db.get(
      'SELECT * FROM users WHERE email = ? AND role = "admin" LIMIT 1',
      [email]
    );
    
    if (!user) {
      console.warn('[AUTH LOGIN] User not found:', email);
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // Verify password
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      console.warn('[AUTH LOGIN] Invalid password for:', email);
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // Check if user is disabled
    if (user.status === 'disabled') {
      console.warn('[AUTH LOGIN] Account disabled:', email);
      return res.status(403).json({ error: 'Account disabled' });
    }
    
    console.log('[AUTH LOGIN] Database authentication successful for:', email);
    
    // Generate admin JWT token (4 hour expiry)
    const token = jwt.sign(
      { 
        admin_id: user.id,
        user_id: user.id,
        email: user.email,
        role: 'admin',
        farm_id: user.farm_id
      },
      getJwtSecret(),
      { expiresIn: '4h' }
    );
    
    // Update last login
    try {
      await db.run(
        'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?',
        [user.id]
      );
    } catch (updateError) {
      console.warn('[AUTH LOGIN] Could not update last_login:', updateError.message);
    }
    
    // Log successful login (if audit table exists)
    try {
      await db.run(
        `INSERT INTO admin_audit_log (admin_id, action, resource_type, resource_id, metadata, ip_address)
         VALUES (?, 'LOGIN_SUCCESS', 'admin', ?, ?, ?)`,
        [user.id, user.id, JSON.stringify({ email }), req.ip]
      );
    } catch (auditError) {
      console.warn('[AUTH LOGIN] Audit log not available:', auditError.message);
    }
    
    res.json({ 
      success: true, 
      token,
      admin: {
        id: user.id,
        email: user.email,
        name: user.first_name ? `${user.first_name} ${user.last_name || ''}`.trim() : user.email,
        farm_id: user.farm_id
      }
    });
  } catch (error) {
    console.error('[AUTH LOGIN ERROR]:', error);
    res.status(500).json({ error: 'Login failed', message: error.message });
  }
});

/**
 * GET /api/admin/auth/verify
 * Verify current admin session is valid
 */
router.get('/auth/verify', requireAdmin, async (req, res) => {
  try {
    console.log('[AUTH VERIFY] Token verified successfully for:', req.admin.email);
    res.json({ 
      success: true, 
      admin: {
        id: req.admin.admin_id || req.admin.user_id,
        email: req.admin.email,
        role: req.admin.role
      }
    });
  } catch (error) {
    console.error('[AUTH VERIFY ERROR]:', error);
    res.status(500).json({ error: 'Verification failed' });
  }
});

/**
 * POST /api/admin/auth/logout
 * Logout admin session
 */
router.post('/auth/logout', requireAdmin, async (req, res) => {
  try {
    const db = await initDatabase();
    
    // Log logout (if audit table exists)
    try {
      await db.run(
        `INSERT INTO admin_audit_log (admin_id, action, resource_type, resource_id, metadata, ip_address)
         VALUES (?, 'LOGOUT', 'admin', ?, ?, ?)`,
        [req.admin.admin_id || req.admin.user_id, req.admin.admin_id || req.admin.user_id, JSON.stringify({ email: req.admin.email }), req.ip]
      );
    } catch (auditError) {
      console.warn('Audit log not available:', auditError.message);
    }
    
    res.json({ success: true, message: 'Logged out successfully' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Logout failed' });
  }
});

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
