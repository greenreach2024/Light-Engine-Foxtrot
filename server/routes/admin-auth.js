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

    // Get admin user
    const userQuery = `
      SELECT 
        admin_user_id,
        email,
        password_hash,
        full_name,
        role,
        is_active,
        two_factor_enabled,
        two_factor_secret,
        failed_login_attempts,
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

    const user = rows[0];

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
    if (!user.is_active) {
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
      await incrementFailedAttempts(req.db, user.admin_user_id, user.failed_login_attempts);
      
      return res.status(401).json({
        success: false,
        error: 'Authentication failed',
        message: 'Invalid email or password'
      });
    }

    // Check 2FA if enabled
    if (user.two_factor_enabled) {
      if (!mfa_code) {
        return res.status(401).json({
          success: false,
          error: '2FA required',
          message: 'Two-factor authentication code is required',
          requires_2fa: true
        });
      }

      // Verify 2FA code (simplified - in production use speakeasy or similar)
      const valid2FA = verify2FACode(user.two_factor_secret, mfa_code);
      if (!valid2FA) {
        await incrementFailedAttempts(req.db, user.admin_user_id, user.failed_login_attempts);
        
        return res.status(401).json({
          success: false,
          error: 'Invalid 2FA code',
          message: 'The two-factor code is incorrect'
        });
      }
    }

    // Generate token
    const token = generateAdminToken({
      admin_user_id: user.admin_user_id,
      email: user.email,
      full_name: user.full_name,
      role: user.role
    });

    // Create session
    const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000); // 12 hours
    const tokenHash = hashToken(token);

    await req.db.query(`
      INSERT INTO admin_sessions (
        admin_user_id,
        token_hash,
        ip_address,
        user_agent,
        expires_at
      ) VALUES ($1, $2, $3, $4, $5)
    `, [
      user.admin_user_id,
      tokenHash,
      req.ip,
      req.headers['user-agent'],
      expiresAt
    ]);

    // Reset failed attempts and update last login
    await req.db.query(`
      UPDATE admin_users
      SET 
        failed_login_attempts = 0,
        locked_until = NULL,
        last_login_at = NOW()
      WHERE admin_user_id = $1
    `, [user.admin_user_id]);

    // Log successful login
    await req.db.query(`
      INSERT INTO admin_audit_log (
        admin_user_id,
        action,
        resource_type,
        details,
        ip_address,
        user_agent,
        status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [
      user.admin_user_id,
      'login',
      'session',
      JSON.stringify({ email: user.email }),
      req.ip,
      req.headers['user-agent'],
      'success'
    ]);

    return res.json({
      success: true,
      message: 'Login successful',
      token,
      admin: {
        email: user.email,
        name: user.full_name,
        role: user.role
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({
      success: false,
      error: 'Server error',
      message: 'An error occurred during login'
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
    await req.db.query(`
      UPDATE admin_sessions
      SET revoked_at = NOW()
      WHERE session_id = $1
    `, [req.admin.session_id]);

    // Log logout
    await req.db.query(`
      INSERT INTO admin_audit_log (
        admin_user_id,
        action,
        resource_type,
        details,
        ip_address,
        user_agent,
        status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [
      req.admin.admin_user_id,
      'logout',
      'session',
      JSON.stringify({ session_id: req.admin.session_id }),
      req.ip,
      req.headers['user-agent'],
      'success'
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
      failed_login_attempts = $1,
      locked_until = $2
    WHERE admin_user_id = $3
  `, [newAttempts, lockUntil, adminUserId]);

  // Log failed attempt
  await db.query(`
    INSERT INTO admin_audit_log (
      admin_user_id,
      action,
      resource_type,
      details,
      status
    ) VALUES ($1, $2, $3, $4, $5)
  `, [
    adminUserId,
    'login_failed',
    'session',
    JSON.stringify({ attempts: newAttempts, locked: !!lockUntil }),
    'failure'
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
