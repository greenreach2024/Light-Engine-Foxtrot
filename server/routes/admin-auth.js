/**
 * Admin Authentication Routes
 * Handles login, verification, and logout for admin users
 */

import express from 'express';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { generateAdminToken, hashToken, verifyAdminToken, adminAuthMiddleware } from '../middleware/admin-auth.js';

const router = express.Router();
const SALT_ROUNDS = 12;
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MINUTES = 30;

/**
 * POST /api/admin/auth/login
 * Authenticate admin user
 */
router.post('/login', async (req, res) => {
  try {
    const { email, password, mfa_code } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Missing credentials',
        message: 'Email and password are required'
      });
    }

    const dbEnabled = String(process.env.DB_ENABLED || 'false').toLowerCase() === 'true';

    // Define fallback admin credentials for non-database mode
    const FALLBACK_ADMIN = {
      id: 1,
      email: 'admin@greenreach.com',
      password: 'Admin2025!', // Plain text for comparison
      name: 'GreenReach Admin',
      active: true,
      mfa_enabled: false
    };

    let user = null;

    if (dbEnabled && req.db) {
      // Database mode: Query admin_users table
      const userQuery = `
        SELECT 
          id,
          email,
          password_hash,
          name,
          active,
          mfa_enabled,
          mfa_secret,
          failed_attempts,
          locked_until
        FROM admin_users
        WHERE email = $1
      `;

      const { rows } = await req.db.query(userQuery, [email.toLowerCase()]);

      if (rows.length === 0) {
        // Don't reveal if user exists
        return res.status(401).json({
          success: false,
          error: 'Authentication failed',
          message: 'Invalid email or password'
        });
      }

      user = rows[0];

      // Check if account is locked
      if (user.locked_until && new Date(user.locked_until) > new Date()) {
        const minutesRemaining = Math.ceil((new Date(user.locked_until) - new Date()) / 60000);
        return res.status(423).json({
          success: false,
          error: 'Account locked',
          message: `Too many failed attempts. Try again in ${minutesRemaining} minutes.`
        });
      }

      // Check if account is active
      if (!user.active) {
        return res.status(403).json({
          success: false,
          error: 'Account disabled',
          message: 'Your account has been disabled. Contact support.'
        });
      }

      // Verify password
      const passwordMatch = await bcrypt.compare(password, user.password_hash);
      
      if (!passwordMatch) {
        // Increment failed attempts
        await incrementFailedAttempts(req.db, user.id, user.failed_attempts);
        
        return res.status(401).json({
          success: false,
          error: 'Authentication failed',
          message: 'Invalid email or password'
        });
      }

      // Check 2FA if enabled
      if (user.mfa_enabled) {
        if (!mfa_code) {
          return res.status(401).json({
            success: false,
            error: '2FA required',
            message: 'Two-factor authentication code is required',
            requires_2fa: true
          });
        }

        // Verify 2FA code (simplified - in production use speakeasy or similar)
        const valid2FA = verify2FACode(user.mfa_secret, mfa_code);
        if (!valid2FA) {
          await incrementFailedAttempts(req.db, user.id, user.failed_attempts);
          
          return res.status(401).json({
            success: false,
            error: 'Invalid 2FA code',
            message: 'The two-factor code is incorrect'
          });
        }
      }
    } else {
      // Fallback mode (no database): Use hardcoded credentials
      if (email.toLowerCase() !== FALLBACK_ADMIN.email.toLowerCase() || password !== FALLBACK_ADMIN.password) {
        return res.status(401).json({
          success: false,
          error: 'Authentication failed',
          message: 'Invalid email or password'
        });
      }

      // Use fallback admin user
      user = FALLBACK_ADMIN;
    }

    // Generate token
    const token = await generateAdminToken({
      id: user.id,
      email: user.email,
      name: user.name,
      permissions: user.permissions
    });

    if (dbEnabled && req.db) {
      // Create session in database
      const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000); // 12 hours
      const tokenHash = hashToken(token);

      await req.db.query(`
        INSERT INTO admin_sessions (
          admin_id,
          token_hash,
          ip_address,
          user_agent,
          expires_at
        ) VALUES ($1, $2, $3, $4, $5)
      `, [
        user.id,
        tokenHash,
        req.ip,
        req.headers['user-agent'],
        expiresAt
      ]);

      // Reset failed attempts and update last login
      await req.db.query(`
        UPDATE admin_users
        SET 
          failed_attempts = 0,
          locked_until = NULL,
          last_login = NOW()
        WHERE id = $1
      `, [user.id]);

      // Log successful login
      await req.db.query(`
        INSERT INTO admin_audit_log (
          admin_id,
          action,
          resource_type,
          details,
          ip_address,
          user_agent,
          success
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [
        user.id,
        'LOGIN_SUCCESS',
        'session',
        JSON.stringify({ email: user.email }),
        req.ip,
        req.headers['user-agent'],
        true
      ]);
    }

    return res.json({
      success: true,
      message: 'Login successful',
      token,
      admin: {
        email: user.email,
        name: user.name,
        role: 'admin'
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    console.error('Error stack:', error.stack);
    console.error('Error details:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Server error',
      message: process.env.NODE_ENV === 'production' ? 'An error occurred during login' : error.message
    });
  }
});

/**
 * GET /api/admin/auth/verify
 * Verify current session token
 */
router.get('/verify', adminAuthMiddleware, async (req, res) => {
  return res.json({
    success: true,
    admin: {
      email: req.admin.email,
      name: req.admin.name,
      role: req.admin.role
    }
  });
});

/**
 * POST /api/admin/auth/logout
 * Logout and revoke session
 */
router.post('/logout', adminAuthMiddleware, async (req, res) => {
  try {
    // Revoke session
    // Delete session
    await req.db.query(`
      DELETE FROM admin_sessions
      WHERE id = $1
    `, [req.admin.session_id]);

    // Log logout
    await req.db.query(`
      INSERT INTO admin_audit_log (
        admin_id,
        action,
        resource_type,
        details,
        ip_address,
        user_agent,
        success
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [
      req.admin.id,
      'LOGOUT',
      'session',
      JSON.stringify({ session_id: req.admin.session_id }),
      req.ip,
      req.headers['user-agent'],
      true
    ]);

    return res.json({
      success: true,
      message: 'Logged out successfully'
    });

  } catch (error) {
    console.error('Logout error:', error);
    return res.status(500).json({
      success: false,
      error: 'Server error',
      message: 'An error occurred during logout'
    });
  }
});

/**
 * Helper: Increment failed login attempts and lock if needed
 */
async function incrementFailedAttempts(db, adminUserId, currentAttempts) {
  const newAttempts = currentAttempts + 1;
  const lockUntil = newAttempts >= MAX_LOGIN_ATTEMPTS
    ? new Date(Date.now() + LOCKOUT_DURATION_MINUTES * 60 * 1000)
    : null;

  await db.query(`
    UPDATE admin_users
    SET 
      failed_attempts = $1,
      locked_until = $2
    WHERE id = $3
  `, [newAttempts, lockUntil, adminUserId]);

  // Log failed attempt
  await db.query(`
    INSERT INTO admin_audit_log (
      admin_id,
      action,
      resource_type,
      details,
      success
    ) VALUES ($1, $2, $3, $4, $5)
  `, [
    adminUserId,
    'LOGIN_FAILED',
    'session',
    JSON.stringify({ attempts: newAttempts, locked: !!lockUntil }),
    false
  ]);
}

/**
 * Helper: Verify 2FA code
 * In production, use speakeasy or similar TOTP library
 */
function verify2FACode(secret, code) {
  // Simplified verification - in production use proper TOTP
  // For now, accept any 6-digit code if 2FA is enabled but no secret set
  if (!secret) return true;
  
  // TODO: Implement proper TOTP verification using speakeasy
  // import speakeasy from 'speakeasy';
  // return speakeasy.totp.verify({ secret, encoding: 'base32', token: code });
  
  return /^\d{6}$/.test(code);
}

export default router;
