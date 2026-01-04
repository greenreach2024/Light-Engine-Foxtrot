import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { getJwtSecret } from '../server/utils/secrets-manager.js';
import { initDatabase, query as dbQuery } from '../lib/database.js';

const router = express.Router();

/**
 * Admin authentication middleware
 * Verifies JWT token has admin role
 */
async function requireAdmin(req, res, next) {
  const authHeader = req.headers.authorization;
  
  console.log('[REQUIRE ADMIN] ===== AUTH CHECK =====');
  console.log('[REQUIRE ADMIN] Has auth header:', !!authHeader);
  console.log('[REQUIRE ADMIN] Auth header preview:', authHeader ? authHeader.substring(0, 20) + '...' : 'none');
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.warn('[REQUIRE ADMIN] ❌ Missing or invalid Authorization header');
    return res.status(401).json({ error: 'Admin authentication required' });
  }
  
  try {
    const token = authHeader.split(' ')[1];
    console.log('[REQUIRE ADMIN] Token extracted, length:', token.length);
    console.log('[REQUIRE ADMIN] Token preview:', token.substring(0, 50) + '...');
    
    const jwtSecret = await getJwtSecret();
    console.log('[REQUIRE ADMIN] JWT Secret obtained, length:', jwtSecret.length);
    
    const decoded = jwt.verify(token, jwtSecret);
    console.log('[REQUIRE ADMIN] ✅ Token decoded successfully');
    console.log('[REQUIRE ADMIN] Email:', decoded.email, 'Role:', decoded.role);
    
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
      console.error('[AUTH LOGIN] ❌ Missing email or password');
      return res.status(400).json({ error: 'Email and password required' });
    }
    
    console.log('[AUTH LOGIN] ===== LOGIN ATTEMPT =====');
    console.log('[AUTH LOGIN] Email:', email);
    console.log('[AUTH LOGIN] Has password:', !!password);
    console.log('[AUTH LOGIN] Password length:', password.length);
    
    // Hard-coded fallback admin credentials (for NeDB/in-memory mode)
    const FALLBACK_ADMIN = {
      email: 'admin@greenreach.com',
      password: 'Admin2025!',
      name: 'System Administrator',
      id: 1,
      farm_id: 'greenreach-hq'
    };
    
    // Check fallback credentials first
    console.log('[AUTH LOGIN] Checking fallback credentials...');
    console.log('[AUTH LOGIN] Email match:', email === FALLBACK_ADMIN.email);
    console.log('[AUTH LOGIN] Password match:', password === FALLBACK_ADMIN.password);
    
    if (email === FALLBACK_ADMIN.email && password === FALLBACK_ADMIN.password) {
      console.log('[AUTH LOGIN] ✅ Using fallback admin credentials');
      
      const jwtSecret = await getJwtSecret();
      console.log('[AUTH LOGIN] JWT Secret obtained, length:', jwtSecret.length);
      const token = jwt.sign(
        { 
          admin_id: FALLBACK_ADMIN.id,
          user_id: FALLBACK_ADMIN.id,
          email: FALLBACK_ADMIN.email,
          role: 'admin',
          farm_id: FALLBACK_ADMIN.farm_id
        },
        jwtSecret,
        { expiresIn: '4h' }
      );
      
      console.log('[AUTH LOGIN] ✅ Token generated, length:', token.length);
      console.log('[AUTH LOGIN] Token preview:', token.substring(0, 50) + '...');
      
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
    const jwtSecret = await getJwtSecret();
    const token = jwt.sign(
      { 
        admin_id: user.id,
        user_id: user.id,
        email: user.email,
        role: 'admin',
        farm_id: user.farm_id
      },
      jwtSecret,
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
 * GET /api/admin/auth/health
 * Check if JWT secret is accessible
 */
router.get('/auth/health', async (req, res) => {
  try {
    console.log('[AUTH HEALTH] Checking JWT secret availability...');
    const jwtSecret = await getJwtSecret();
    console.log('[AUTH HEALTH] JWT secret obtained, length:', jwtSecret.length);
    console.log('[AUTH HEALTH] JWT secret preview:', jwtSecret.substring(0, 10) + '...');
    
    // Try to sign and verify a test token
    const testPayload = { test: true, timestamp: Date.now() };
    const testToken = jwt.sign(testPayload, jwtSecret, { expiresIn: '1m' });
    const testDecoded = jwt.verify(testToken, jwtSecret);
    
    console.log('[AUTH HEALTH] ✅ JWT signing and verification working');
    res.json({ 
      success: true, 
      message: 'JWT authentication system operational',
      jwtSecretLength: jwtSecret.length,
      testTokenLength: testToken.length,
      testVerified: !!testDecoded
    });
  } catch (error) {
    console.error('[AUTH HEALTH ERROR]:', error.message);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      stack: error.stack 
    });
  }
});

/**
 * GET /api/admin/auth/debug
 * Debug endpoint to check auth status and JWT configuration
 */
router.get('/auth/debug', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const jwtSecret = await getJwtSecret();
    
    const debug = {
      timestamp: new Date().toISOString(),
      hasAuthHeader: !!authHeader,
      authHeaderPreview: authHeader ? authHeader.substring(0, 30) + '...' : null,
      jwtSecretLength: jwtSecret.length,
      jwtSecretPreview: jwtSecret.substring(0, 10) + '...',
      fallbackAdmin: {
        email: 'admin@greenreach.com',
        exists: true
      }
    };
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      debug.tokenLength = token.length;
      debug.tokenPreview = token.substring(0, 50) + '...';
      
      try {
        const decoded = jwt.verify(token, jwtSecret);
        debug.tokenValid = true;
        debug.tokenPayload = decoded;
      } catch (verifyError) {
        debug.tokenValid = false;
        debug.tokenError = verifyError.message;
      }
    }
    
    res.json({ success: true, debug });
  } catch (error) {
    res.status(500).json({ error: error.message, stack: error.stack });
  }
});

/**
 * GET /api/admin/auth/verify
 * Verify current admin session is valid
 */
router.get('/auth/verify', async (req, res) => {
  const authHeader = req.headers.authorization;
  
  console.log('[AUTH VERIFY] ===== VERIFY REQUEST =====');
  console.log('[AUTH VERIFY] Has auth header:', !!authHeader);
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.warn('[AUTH VERIFY] ❌ Missing or invalid Authorization header');
    return res.status(401).json({ error: 'Admin authentication required' });
  }
  
  try {
    const token = authHeader.split(' ')[1];
    console.log('[AUTH VERIFY] Token extracted, length:', token.length);
    
    const jwtSecret = await getJwtSecret();
    console.log('[AUTH VERIFY] JWT Secret obtained, length:', jwtSecret.length);
    
    const decoded = jwt.verify(token, jwtSecret);
    console.log('[AUTH VERIFY] ✅ Token decoded successfully');
    console.log('[AUTH VERIFY] Email:', decoded.email, 'Role:', decoded.role);
    
    if (decoded.role !== 'admin') {
      console.warn('[AUTH VERIFY] ❌ User does not have admin role:', decoded.role);
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    console.log('[AUTH VERIFY] ✅ Verification successful!');
    res.json({ 
      success: true, 
      admin: {
        id: decoded.admin_id || decoded.user_id,
        email: decoded.email,
        role: decoded.role
      }
    });
  } catch (error) {
    console.error('[AUTH VERIFY ERROR]:', error.message);
    console.error('[AUTH VERIFY ERROR] Stack:', error.stack);
    res.status(401).json({ error: 'Invalid or expired admin token', details: error.message });
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
    
    // Check if database is available (PostgreSQL mode)
    if (!db || !db.pool || db.mode === 'nedb') {
      console.log('[Admin] Database not available, returning sample farm data');
      
      // Return sample/mock farms for NeDB mode
      const sampleFarms = [
        {
          farm_id: 'greenreach-hq',
          name: 'GreenReach HQ Demo Farm',
          email: 'admin@greenreach.com',
          status: 'active',
          tier: 'enterprise',
          created_at: new Date().toISOString(),
          last_login: new Date().toISOString(),
          user_count: 1
        }
      ];
      
      return res.json({ success: true, farms: sampleFarms, mode: 'demo' });
    }
    
    // PostgreSQL mode: Query actual database
    const result = await dbQuery(`
      SELECT 
        f.farm_id,
        f.name,
        f.email,
        f.status,
        f.plan_type as tier,
        f.created_at,
        f.updated_at as last_login,
        COUNT(DISTINCT u.id) as user_count
      FROM farms f
      LEFT JOIN users u ON f.farm_id = u.farm_id
      GROUP BY f.farm_id, f.name, f.email, f.status, f.plan_type, f.created_at, f.updated_at
      ORDER BY f.created_at DESC
    `);
    
    res.json({ success: true, farms: result.rows, mode: 'database' });
  } catch (error) {
    console.error('Error listing farms:', error);
    res.status(500).json({ error: 'Failed to list farms', details: error.message });
  }
});

/**
 * GET /api/admin/farms/:farmId
 * Get detailed information about a specific farm
 */
router.get('/farms/:farmId', requireAdmin, async (req, res) => {
  try {
    const { farmId } = req.params;
    const db = await initDatabase();
    
    // Check if database is available (PostgreSQL mode)
    if (!db || !db.pool || db.mode === 'nedb') {
      console.log('[Admin] Database not available, returning sample farm detail');
      
      // Return sample farm detail for NeDB mode
      const sampleFarm = {
        farm_id: farmId,
        name: farmId === 'greenreach-hq' ? 'GreenReach HQ Demo Farm' : 'Demo Farm',
        email: 'admin@greenreach.com',
        status: 'active',
        tier: 'enterprise',
        created_at: new Date().toISOString(),
        last_heartbeat: new Date().toISOString(),
        address: '123 Farm Lane',
        city: 'Portland',
        state: 'OR',
        country: 'USA',
        phone: '+1-555-0100',
        total_rooms: 1,
        total_devices: 0,
        user_count: 1
      };
      
      return res.json(sampleFarm);
    }
    
    // PostgreSQL mode: Query actual database
    const result = await dbQuery(`
      SELECT 
        f.*,
        COUNT(DISTINCT u.id) as user_count
      FROM farms f
      LEFT JOIN users u ON f.farm_id = u.farm_id
      WHERE f.farm_id = $1
      GROUP BY f.farm_id, f.name, f.email, f.phone, f.contact_name, f.plan_type, f.status, f.created_at, f.updated_at, f.farm_slug, f.api_key, f.api_secret, f.jwt_secret, f.square_payment_id, f.square_amount
    `, [farmId]);
    
    if (!result.rows || result.rows.length === 0) {
      return res.status(404).json({ error: 'Farm not found' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error getting farm details:', error);
    res.status(500).json({ error: 'Failed to get farm details', details: error.message });
  }
});

/**
 * GET /api/admin/users
 * List all users across all farms
 */
router.get('/users', requireAdmin, async (req, res) => {
  try {
    const db = await initDatabase();
    
    // Check if database is available (PostgreSQL mode)
    if (!db || !db.pool || db.mode === 'nedb') {
      console.log('[Admin] Database not available, returning sample user data');
      
      // Return sample/mock users for NeDB mode
      const sampleUsers = [
        {
          user_id: 1,
          email: 'admin@greenreach.com',
          first_name: 'System',
          last_name: 'Administrator',
          role: 'admin',
          status: 'active',
          last_login: new Date().toISOString(),
          created_at: new Date().toISOString(),
          farm_id: 'greenreach-hq',
          farm_name: 'GreenReach HQ Demo Farm'
        }
      ];
      
      return res.json({ success: true, users: sampleUsers, mode: 'demo' });
    }
    
    // PostgreSQL mode: Query actual database
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
    
    res.json({ success: true, users, mode: 'database' });
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
 * POST /api/admin/farms/lookup-by-email
 * Look up farm by email address (for password recovery/resend credentials)
 */
router.post('/farms/lookup-by-email', requireAdmin, async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }
    
    const db = await initDatabase();
    
    // Check if database is available (PostgreSQL mode)
    if (!db || !db.pool || db.mode === 'nedb') {
      console.log('[Admin] Database not available for email lookup');
      return res.status(503).json({ 
        error: 'Database not available',
        message: 'PostgreSQL database required for this operation'
      });
    }
    
    // Look up user by email
    const userResult = await db.query(
      `SELECT u.*, f.name as farm_name, f.farm_id, f.api_key, f.status as farm_status
       FROM users u
       JOIN farms f ON u.farm_id = f.farm_id
       WHERE u.email = $1`,
      [email.toLowerCase()]
    );
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ 
        error: 'Not found',
        message: 'No account found with this email address'
      });
    }
    
    const user = userResult.rows[0];
    
    res.json({
      success: true,
      found: true,
      farm_id: user.farm_id,
      farm_name: user.farm_name,
      farm_status: user.farm_status,
      user_name: user.name,
      user_role: user.role,
      user_status: user.is_active ? 'active' : 'inactive',
      created_at: user.created_at
    });
    
  } catch (error) {
    console.error('Error looking up farm by email:', error);
    res.status(500).json({ error: 'Failed to look up farm' });
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
