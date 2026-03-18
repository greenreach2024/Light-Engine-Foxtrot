/**
 * Authentication Routes - Farm Login & Token Management
 * Provides endpoints for farm user authentication and JWT token validation
 */

import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomBytes } from 'crypto';

const router = express.Router();

// JWT Configuration
const isProductionRuntime =
  process.env.NODE_ENV === 'production' ||
  String(process.env.DEPLOYMENT_MODE || '').toLowerCase() === 'cloud';

const JWT_SECRET = (() => {
  const configured = process.env.JWT_SECRET;
  if (configured) {
    return configured;
  }

  if (isProductionRuntime) {
    throw new Error('JWT_SECRET environment variable is required in production');
  }

  // Generate a random secret for dev so tokens are ephemeral per restart
  const devSecret = randomBytes(32).toString('hex');
  console.warn('[Auth] JWT_SECRET not set; generated random dev-only secret (tokens will not survive restarts)');
  return devSecret;
})();
const JWT_EXPIRES_IN = '24h';

// Farm roles
const FARM_ROLES = {
  ADMIN: 'admin',
  MANAGER: 'manager',
  OPERATOR: 'operator',
  VIEWER: 'viewer'
};

/**
 * Generate JWT token for farm user
 */
const generateFarmToken = (payload) => {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
    issuer: 'greenreach-central',
    audience: 'greenreach-farms'
  });
};

/**
 * POST /api/auth/login
 * Authenticate farm user with email and password
 * 
 * Body: { farm_id, email, password }
 * Returns: { success: true, token, role, farm_id, email }
 */
router.post('/login', async (req, res) => {
  try {
    const { farm_id: raw_farm_id, email, password } = req.body;
    // Sanitize farm_id: strip trailing commas, semicolons, periods, and whitespace
    const farm_id = typeof raw_farm_id === 'string' ? raw_farm_id.replace(/[,;.\s]+$/, '').trim() : raw_farm_id;
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

    if (!password) {
      return res.status(400).json({ 
        success: false,
        error: 'Missing credentials',
        message: 'Farm ID and password are required' 
      });
    }

    let user = null;
    let useDatabase = false;

    // Check if database mode is enabled AND tables exist with data
    if (req.db) {
      try {
        // Try to query farm_users table — only use DB mode if there are actual users
        const testQuery = `SELECT COUNT(*) as cnt FROM farm_users`;
        const testResult = await req.db.query(testQuery);
        const userCount = parseInt(testResult.rows[0]?.cnt || '0', 10);
        useDatabase = userCount > 0;
        if (!useDatabase) {
          console.log(`[Auth] farm_users table has ${userCount} rows, using fallback mode`);
        }
      } catch (error) {
        // Table doesn't exist, use fallback mode
        console.log('[Auth] Database not ready, using fallback mode');
        useDatabase = false;
      }
    }

    if (useDatabase) {
      // Database mode: Query farm_users table
      // Support login by email OR by farm_id alone (find first admin)
      let userQuery, params;

      if (normalizedEmail) {
        // Email provided — look up by email (optionally scoped to farm)
        userQuery = `
          SELECT 
            fu.id,
            fu.farm_id,
            fu.email,
            fu.password_hash,
            COALESCE(fu.first_name || ' ' || fu.last_name, fu.first_name, fu.email) as name,
            fu.role,
            COALESCE(fu.must_change_password, false) as must_change_password,
            CASE WHEN fu.status = 'active' THEN true ELSE false END as active,
            f.name as farm_name,
            f.status as farm_status,
            COALESCE(f.setup_completed, false) as setup_completed
          FROM farm_users fu
          JOIN farms f ON fu.farm_id = f.farm_id
          WHERE fu.email = $1
          ${farm_id ? 'AND fu.farm_id = $2' : ''}
          AND fu.status = 'active'
        `;
        params = farm_id ? [normalizedEmail, farm_id] : [normalizedEmail];
      } else if (farm_id) {
        // No email — find first admin user for this farm (matches local Foxtrot behavior)
        userQuery = `
          SELECT 
            fu.id,
            fu.farm_id,
            fu.email,
            fu.password_hash,
            COALESCE(fu.first_name || ' ' || fu.last_name, fu.first_name, fu.email) as name,
            fu.role,
            COALESCE(fu.must_change_password, false) as must_change_password,
            CASE WHEN fu.status = 'active' THEN true ELSE false END as active,
            f.name as farm_name,
            f.status as farm_status,
            COALESCE(f.setup_completed, false) as setup_completed
          FROM farm_users fu
          JOIN farms f ON fu.farm_id = f.farm_id
          WHERE fu.farm_id = $1
          AND fu.role = 'admin'
          AND fu.status = 'active'
          ORDER BY fu.created_at ASC
          LIMIT 1
        `;
        params = [farm_id];
      } else {
        return res.status(400).json({
          success: false,
          error: 'Missing credentials',
          message: 'Farm ID and password are required'
        });
      }

      const { rows } = await req.db.query(userQuery, params);

      if (rows.length === 0) {
        // No user found in DB for this farm — fall through to fallback credentials.
        // This handles farms that exist in the `farms` table but haven't registered
        // user accounts in `farm_users` yet (e.g. farms synced from edge devices).
        console.log(`[Auth] No farm_users entry for ${farm_id || normalizedEmail}, falling through to fallback`);
        useDatabase = false;
      } else {
        user = rows[0];
      }
    }

    if (useDatabase && user) {
      // Check if farm is active
      if (user.farm_status !== 'active') {
        return res.status(403).json({
          success: false,
          error: 'Farm inactive',
          message: 'This farm account is not active. Contact support.'
        });
      }

      // Verify password
      const passwordMatch = await bcrypt.compare(password, user.password_hash);
      
      if (!passwordMatch) {
        return res.status(401).json({
          success: false,
          error: 'Authentication failed',
          message: 'Invalid email or password'
        });
      }

    } else {
      // Fallback mode — farm_id + password authentication (no database)
      // Matches server-foxtrot.js edge auth pattern: email is optional
      console.log(`[Auth] Fallback credentials mode for ${farm_id || 'default'}`);

      // Build fallback credentials.
      // In production/cloud runtime, ADMIN_PASSWORD is required.
      // In local development only (loopback requests), allow password passthrough
      // so local credentials can be exercised without cloud secrets.
      const adminPassword = process.env.ADMIN_PASSWORD;
      const host = String(req.hostname || '').toLowerCase();
      const isLoopbackHost = host === 'localhost' || host === '127.0.0.1' || host === '::1';
      const remoteAddress = String(req.ip || req.socket?.remoteAddress || '').toLowerCase();
      const isLoopbackIp = remoteAddress.includes('127.0.0.1') || remoteAddress.includes('::1');
      const allowLocalDevFallback = !isProductionRuntime && (isLoopbackHost || isLoopbackIp);

      if (!adminPassword && !allowLocalDevFallback) {
        return res.status(503).json({
          success: false,
          error: 'Authentication not configured',
          message: 'ADMIN_PASSWORD is required when fallback credentials mode is active'
        });
      }
      const FALLBACK_FARM = {
        farm_id: farm_id || process.env.FARM_ID || 'FARM-MLTP9LVH-B0B85039',
        email: email || process.env.ADMIN_EMAIL || `admin@${farm_id || 'farm'}.local`,
        password: adminPassword || password,
        name: process.env.ADMIN_NAME || 'Farm Admin',
        role: FARM_ROLES.ADMIN
      };

      // Only password must match; email is optional
      if (password !== FALLBACK_FARM.password) {
        return res.status(401).json({
          success: false,
          error: 'Authentication failed',
          message: 'Invalid farm ID or password'
        });
      }

      user = { ...FALLBACK_FARM };

      // If a specific farm_id was requested and it exists in the farms table,
      // use that farm's name and setup_completed so the JWT and response are accurate.
      if (farm_id && req.db) {
        try {
          const farmRow = await req.db.query(
            'SELECT farm_id, name, status, COALESCE(setup_completed, false) as setup_completed FROM farms WHERE farm_id = $1',
            [farm_id]
          );
          if (farmRow.rows.length > 0) {
            user.farm_id = farmRow.rows[0].farm_id;
            user.farm_name = farmRow.rows[0].name;
            user.setup_completed = farmRow.rows[0].setup_completed;
          }
        } catch (_) { /* best-effort */ }
      }
    }

    // Generate JWT token
    const token = generateFarmToken({
      farm_id: user.farm_id,
      user_id: user.id || 'local-user',
      role: user.role || FARM_ROLES.ADMIN,
      name: user.name,
      email: user.email
    });

    console.log(`[Auth] Successful login: ${email} (Farm: ${user.farm_id})`);

    res.json({
      success: true,
      token,
      farm_id: user.farm_id,
      farm_name: user.farm_name || user.farm_id,
      email: user.email,
      name: user.name,
      role: user.role || FARM_ROLES.ADMIN,
      planType: 'cloud',
      must_change_password: user.must_change_password || false,
      setup_completed: user.setup_completed || false,
      expires_in: JWT_EXPIRES_IN
    });

  } catch (error) {
    console.error('[Auth] Login error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Login failed',
      message: 'An error occurred during login. Please try again.'
    });
  }
});

/**
 * POST /api/auth/validate-token
 * Validate JWT token
 * 
 * Headers: Authorization: Bearer <token>
 * Returns: { valid: true, payload }
 */
router.post('/validate-token', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        valid: false,
        error: 'No token provided' 
      });
    }

    const token = authHeader.substring(7);
    
    const payload = jwt.verify(token, JWT_SECRET, {
      issuer: 'greenreach-central',
      audience: 'greenreach-farms'
    });

    res.json({
      valid: true,
      payload: {
        farm_id: payload.farm_id,
        user_id: payload.user_id,
        role: payload.role,
        email: payload.email,
        name: payload.name
      }
    });

  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        valid: false,
        error: 'Token expired',
        expired: true
      });
    }
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ 
        valid: false,
        error: 'Invalid token' 
      });
    }

    res.status(500).json({ 
      valid: false,
      error: 'Token validation failed' 
    });
  }
});

/**
 * POST /api/auth/validate-device-token
 * Validate device pairing token (used by tablets/edge devices)
 * 
 * Body: { token, farm_id }
 * Returns: { valid: true, farm_id }
 */
router.post('/validate-device-token', async (req, res) => {
  try {
    const { token, farm_id } = req.body;
    
    if (!token) {
      return res.status(400).json({ 
        valid: false,
        error: 'No token provided' 
      });
    }

    // Verify JWT token
    const payload = jwt.verify(token, JWT_SECRET, {
      issuer: 'greenreach-central',
      audience: 'greenreach-farms'
    });

    // Validate farm_id matches if provided
    if (farm_id && payload.farm_id !== farm_id) {
      return res.status(401).json({
        valid: false,
        error: 'Token farm_id mismatch'
      });
    }

    res.json({
      valid: true,
      farm_id: payload.farm_id,
      farm_name: payload.farm_name || payload.name,
      role: payload.role
    });

  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        valid: false,
        error: 'Token expired',
        expired: true
      });
    }
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ 
        valid: false,
        error: 'Invalid token' 
      });
    }

    res.status(500).json({ 
      valid: false,
      error: 'Token validation failed' 
    });
  }
});

/**
 * POST /api/auth/logout
 * Logout (client-side token removal)
 * 
 * Returns: { success: true }
 */
router.post('/logout', (req, res) => {
  // JWT tokens are stateless, so logout is handled client-side
  // This endpoint exists for consistency and future session management
  res.json({ success: true, message: 'Logged out successfully' });
});

/**
 * GET /api/auth/me
 * Get current user info from JWT token
 * 
 * Headers: Authorization: Bearer <token>
 * Returns: { farm_id, email, role, name }
 */
/**
 * POST /api/auth/change-password
 * Authenticated password change (requires current password verification)
 * Body: { currentPassword: string, newPassword: string }
 */
router.post('/change-password', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ status: 'error', message: 'No token provided' });
    }

    const token = authHeader.substring(7);
    let payload;
    try {
      payload = jwt.verify(token, JWT_SECRET, {
        issuer: 'greenreach-central',
        audience: 'greenreach-farms'
      });
    } catch (err) {
      return res.status(401).json({ status: 'error', message: 'Invalid or expired token' });
    }

    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ status: 'error', message: 'Current and new passwords are required' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ status: 'error', message: 'New password must be at least 8 characters' });
    }

    const pool = req.db;
    if (!pool) {
      return res.status(500).json({ status: 'error', message: 'Database not configured' });
    }

    // Look up user in farm_users
    const farmId = payload.farm_id;
    const email = payload.email;
    const userId = payload.user_id;

    let userRow;
    if (farmId && email) {
      const result = await pool.query(
        'SELECT id, password_hash FROM farm_users WHERE farm_id = $1 AND email = $2',
        [farmId, email]
      );
      userRow = result.rows[0];
    }
    if (!userRow && userId) {
      const result = await pool.query(
        'SELECT id, password_hash FROM farm_users WHERE id = $1',
        [userId]
      );
      userRow = result.rows[0];
    }

    if (!userRow) {
      return res.status(404).json({ status: 'error', message: 'User not found' });
    }

    // Verify current password
    const validPassword = await bcrypt.compare(currentPassword, userRow.password_hash);
    if (!validPassword) {
      return res.status(401).json({ status: 'error', message: 'Current password is incorrect' });
    }

    // Hash and update
    const newHash = await bcrypt.hash(newPassword, 10);
    await pool.query(
      'UPDATE farm_users SET password_hash = $1, must_change_password = false, updated_at = NOW() WHERE id = $2',
      [newHash, userRow.id]
    );

    console.log('[Auth] Password changed for user:', userRow.id, 'farm:', farmId);
    res.json({ status: 'success', message: 'Password changed successfully' });

  } catch (error) {
    console.error('[Auth] Change password error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to change password' });
  }
});

router.get('/me', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.substring(7);
    
    const payload = jwt.verify(token, JWT_SECRET, {
      issuer: 'greenreach-central',
      audience: 'greenreach-farms'
    });

    res.json({
      farm_id: payload.farm_id,
      user_id: payload.user_id,
      email: payload.email,
      name: payload.name,
      role: payload.role
    });

  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    
    res.status(401).json({ error: 'Invalid token' });
  }
});

export default router;
