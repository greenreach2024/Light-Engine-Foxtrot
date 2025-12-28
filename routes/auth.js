/**
 * Authentication Routes - Device Pairing & Token Management
 * Provides endpoints for Activity Hub tablet pairing and JWT token validation
 */

import express from 'express';
import { generateFarmToken, verifyFarmToken, FARM_ROLES } from '../lib/farm-auth.js';

const router = express.Router();

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
 * GET /api/ping
 * Health check endpoint for edge device availability
 * Returns 200 OK if service is running
 */
router.get('/ping', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

export default router;
