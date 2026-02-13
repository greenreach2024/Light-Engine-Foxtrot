/**
 * Authentication Routes - Farm Login & Token Management
 * Provides endpoints for farm user authentication and JWT token validation
 */

import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const router = express.Router();

// JWT Configuration
const JWT_SECRET = process.env.JWT_SECRET || 'greenreach-jwt-secret-2025';
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
    const { farm_id, email, password } = req.body;

    if (!password) {
      return res.status(400).json({ 
        success: false,
        error: 'Missing credentials',
        message: 'Farm ID and password are required' 
      });
    }

    // Fallback credentials for non-database mode
    const FALLBACK_FARM = {
      farm_id: farm_id || 'FARM-TEST-WIZARD-001',
      email: email || 'shelbygilbert@rogers.com',
      password: 'Grow123',
      name: 'Peter Gilbert',
      role: FARM_ROLES.ADMIN
    };

    let user = null;
    let useDatabase = false;

    // Check if database mode is enabled AND tables exist
    if (req.db) {
      try {
        // Try to query farm_users table
        const testQuery = `SELECT 1 FROM farm_users LIMIT 1`;
        await req.db.query(testQuery);
        useDatabase = true;
      } catch (error) {
        // Table doesn't exist, use fallback mode
        console.log('[Auth] Database not ready, using fallback mode');
        useDatabase = false;
      }
    }

    if (useDatabase) {
      // Database mode: Query farm_users table
      const userQuery = `
        SELECT 
          fu.id,
          fu.farm_id,
          fu.email,
          fu.password_hash,
          fu.name,
          fu.role,
          fu.active,
          f.name as farm_name,
          f.status as farm_status
        FROM farm_users fu
        JOIN farms f ON fu.farm_id = f.farm_id
        WHERE fu.email = $1
        ${farm_id ? 'AND fu.farm_id = $2' : ''}
        AND fu.active = true
      `;

      const params = farm_id ? [email.toLowerCase(), farm_id] : [email.toLowerCase()];
      const { rows } = await req.db.query(userQuery, params);

      if (rows.length === 0) {
        return res.status(401).json({
          success: false,
          error: 'Authentication failed',
          message: 'Invalid email or password'
        });
      }

      user = rows[0];

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
      // Fallback mode: Check against fallback credentials
      // Email is optional — if provided it must match, password always required
      const emailStr = (email || '').toLowerCase();
      const fallbackEmail = FALLBACK_FARM.email.toLowerCase();
      if ((emailStr && emailStr !== fallbackEmail) || password !== FALLBACK_FARM.password) {
        return res.status(401).json({
          success: false,
          error: 'Authentication failed',
          message: 'Invalid email or password'
        });
      }

      user = FALLBACK_FARM;
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
      email: user.email,
      name: user.name,
      role: user.role || FARM_ROLES.ADMIN,
      planType: 'cloud',
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
