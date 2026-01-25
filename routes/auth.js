/**
 * Authentication Routes - Device Pairing & Token Management
 * Provides endpoints for Activity Hub tablet pairing and JWT token validation
 */

import express from 'express';
import bcrypt from 'bcrypt';
import pg from 'pg';
import { generateFarmToken, verifyFarmToken, FARM_ROLES } from '../lib/farm-auth.js';

const router = express.Router();
const { Client } = pg;

// PostgreSQL connection configuration
const createDbClient = () => new Client({
  host: process.env.RDS_HOSTNAME || 'light-engine-db.c8rq44ew6swb.us-east-1.rds.amazonaws.com',
  port: parseInt(process.env.RDS_PORT || '5432'),
  database: process.env.RDS_DB_NAME || 'lightengine',
  user: process.env.RDS_USERNAME || 'lightengine',
  password: process.env.RDS_PASSWORD || 'LePphcacxDs35ciLLhnkhaXr7',
  ssl: { rejectUnauthorized: false }
});

/**
 * POST /api/auth/generate-device-token
 * Generate a JWT token for device pairing
 * 
 * Body: { farm_id, farm_name, role }
 * Returns: { token, expires_in }
 */
router.post('/generate-device-token', async (req, res) => {
  try {
    const { farm_id, farm_name, role } = req.body;

    if (!farm_id) {
      return res.status(400).json({ error: 'farm_id is required' });
    }

    // Generate device token with 24h expiry
    const token = generateFarmToken({
      farm_id,
      user_id: 'DEVICE',  // Special user_id for device tokens
      role: role || FARM_ROLES.MANAGER,
      name: `${farm_name || farm_id} Device`,
      email: `device@${farm_id}.local`
    });

    res.json({
      success: true,
      token,
      farm_id,
      farm_name: farm_name || farm_id,
      expires_in: '24h'
    });

  } catch (error) {
    console.error('Error generating device token:', error);
    res.status(500).json({ error: 'Failed to generate device token' });
  }
});

/**
 * POST /api/auth/validate-device-token
 * Validate a device token from QR code scan
 * 
 * Body: { token, farm_id }
 * Returns: { valid: true, farm_id, farm_name }
 */
router.post('/validate-device-token', async (req, res) => {
  try {
    const { token, farm_id } = req.body;

    if (!token) {
      return res.status(400).json({ error: 'Token is required' });
    }

    // Verify JWT token
    const decoded = verifyFarmToken(token);

    // Validate farm_id matches
    if (decoded.farm_id !== farm_id) {
      return res.status(403).json({ error: 'Token farm_id mismatch' });
    }

    // Token is valid
    res.json({
      success: true,
      valid: true,
      farm_id: decoded.farm_id,
      farm_name: decoded.name || decoded.farm_id,
      role: decoded.role
    });

  } catch (error) {
    console.error('Error validating token:', error);
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token has expired' });
    }
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid token' });
    }

    res.status(500).json({ error: 'Token validation failed' });
  }
});

/**
 * POST /api/auth/login
 * Authenticate user with farm ID, email, and password
 * 
 * Body: { farm_id, email, password }
 * Returns: { success: true, token, role, farm_id, email }
 */
router.post('/login', async (req, res) => {
  const client = createDbClient();
  
  try {
    const { farm_id, email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }

    // Edge device / Demo mode: Accept any login if farm_id not provided
    const isEdgeDevice = process.env.EDGE_MODE === 'true';
    const isDemoMode = process.env.DEMO_MODE === 'true';
    
    if ((isEdgeDevice || isDemoMode) && !farm_id) {
      console.log(`[Auth] Edge/Demo login for ${email}`);
      // Generate JWT token for edge device login
      const token = generateFarmToken({
        farm_id: process.env.FARM_ID || 'edge-device',
        user_id: 'local-user',
        role: FARM_ROLES.ADMIN,
        name: email.split('@')[0],
        email
      });

      return res.json({
        success: true,
        token,
        farm_id: process.env.FARM_ID || 'edge-device',
        email,
        role: FARM_ROLES.ADMIN,
        planType: 'edge',
        expires_in: '24h'
      });
    }

    if (!farm_id) {
      return res.status(400).json({ error: 'farm_id is required for cloud authentication' });
    }

    // Demo credentials for testing
    const isDemoLogin = farm_id === 'demo-farm-001' && 
                       email === 'admin@demo.farm' && 
                       password === 'demo123';

    if (isDemoLogin) {
      // Generate JWT token for demo login
      const token = generateFarmToken({
        farm_id,
        user_id: 'demo-user-001',
        role: FARM_ROLES.ADMIN,
        name: 'Demo Admin',
        email
      });

      return res.json({
        success: true,
        token,
        farm_id,
        email,
        role: FARM_ROLES.ADMIN,
        expires_in: '24h'
      });
    }

    // Real database authentication
    console.log(`[Auth] Login attempt for ${email} at farm ${farm_id}`);
    
    await client.connect();
    
    // Query user from database
    const result = await client.query(
      `SELECT user_id, email, name, password_hash, role, is_active 
       FROM users 
       WHERE email = $1 AND farm_id = $2`,
      [email, farm_id]
    );


    if (result.rows.length === 0) {
      console.log(`[Auth] ❌ User not found: ${email}`);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];

    // Check if account is active
    if (!user.is_active) {
      console.log(`[Auth] ❌ Account not active: ${email}`);
      return res.status(401).json({ error: 'Account is not active' });
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    
    if (!isValidPassword) {
      console.log(`[Auth] ❌ Invalid password for: ${email}`);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    console.log(`[Auth] ✅ Login successful: ${email} (${user.role})`);

    // Query farm details for response
    const farmResult = await client.query(
      `SELECT farm_id, name, plan_type FROM farms WHERE farm_id = $1`,
      [farm_id]
    );

    const farm = farmResult.rows[0] || {};
    const farmName = farm.name || user.name || 'Unknown Farm';
    const planType = farm.plan_type || 'edge';

    // Generate JWT token for successful login
    const token = generateFarmToken({
      farm_id,
      user_id: user.user_id,
      role: user.role || FARM_ROLES.ADMIN,
      name: user.name,
      email: user.email
    });

    res.json({
      status: 'success',
      success: true,
      token,
      farmId: farm_id,
      farm_id,
      farmName,
      email: user.email,
      name: user.name,
      role: user.role || FARM_ROLES.ADMIN,
      planType,
      expires_in: '24h'
    });

  } catch (error) {
    console.error('[Auth] Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  } finally {
    try {
      await client.end();
    } catch (err) {
      console.error('[Auth] Error closing database connection:', err);
    }
  }
});

/**
 * GET /api/ping
 * Health check endpoint for edge device availability
 * Returns 200 OK if service is running
 */
router.get('/ping', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

export default router;
