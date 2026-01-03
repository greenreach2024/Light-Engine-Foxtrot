import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import pg from 'pg';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';

const router = express.Router();

// Rate limiter for authentication endpoints (5 attempts per 15 minutes)
const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 requests per window
  message: 'Too many authentication attempts, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Create database pool
const pool = new pg.Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  user: process.env.DB_USER || 'lightengine',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'lightengine',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

function getWholesaleJwtSecret() {
  const secret = process.env.WHOLESALE_JWT_SECRET || process.env.JWT_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV !== 'production') return 'dev-greenreach-wholesale-secret';
  return null;
}

function issueBuyerToken(buyerId) {
  const secret = getWholesaleJwtSecret();
  if (!secret) {
    const err = new Error('Wholesale auth is not configured (missing WHOLESALE_JWT_SECRET)');
    err.code = 'AUTH_NOT_CONFIGURED';
    throw err;
  }
  return jwt.sign({ buyerId, type: 'wholesale' }, secret, { expiresIn: '30d' });
}

// POST /api/wholesale/buyers/register - Register new wholesale buyer
router.post('/buyers/register', authRateLimiter, async (req, res) => {
  try {
    const { businessName, contactName, email, password, buyerType, location } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({ status: 'error', message: 'Email and password are required' });
    }

    // Check if email already exists
    const existingBuyer = await pool.query(
      'SELECT id FROM wholesale_buyers WHERE email = $1',
      [email.toLowerCase()]
    );

    if (existingBuyer.rows.length > 0) {
      return res.status(409).json({ status: 'error', message: 'Email already registered' });
    }

    // Hash password with bcrypt (10 rounds - industry standard)
    const passwordHash = await bcrypt.hash(password, 10);

    // Create buyer with hashed password
    const result = await pool.query(
      `INSERT INTO wholesale_buyers (business_name, contact_name, email, password_hash, buyer_type, location, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       RETURNING id, business_name, contact_name, email, buyer_type, location, created_at`,
      [businessName, contactName, email.toLowerCase(), passwordHash, buyerType, JSON.stringify(location || {})]
    );

    const buyer = result.rows[0];
    const token = issueBuyerToken(buyer.id);

    return res.json({
      status: 'ok',
      data: { buyer, token }
    });
  } catch (error) {
    console.error('Register error:', error);
    return res.status(500).json({ status: 'error', message: 'Registration failed' });
  }
});

// POST /api/wholesale/buyers/login - Authenticate buyer
router.post('/buyers/login', authRateLimiter, async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({ status: 'error', message: 'Email and password are required' });
    }

    const result = await pool.query(
      'SELECT id, business_name, contact_name, email, buyer_type, location, password_hash FROM wholesale_buyers WHERE email = $1',
      [email.toLowerCase()]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ status: 'error', message: 'Invalid credentials' });
    }

    const buyer = result.rows[0];

    // Compare password with bcrypt
    const isValid = await bcrypt.compare(password, buyer.password_hash);
    if (!isValid) {
      return res.status(401).json({ status: 'error', message: 'Invalid credentials' });
    }

    delete buyer.password_hash;
    
    const token = issueBuyerToken(buyer.id);

    return res.json({
      status: 'ok',
      data: { buyer, token }
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ status: 'error', message: 'Login failed' });
  }
});

// GET /api/wholesale/buyers/me - Get current buyer profile
router.get('/buyers/me', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ status: 'error', message: 'No token provided' });
    }

    const secret = getWholesaleJwtSecret();
    const decoded = jwt.verify(token, secret);

    const result = await pool.query(
      'SELECT id, business_name, contact_name, email, buyer_type, location, created_at FROM wholesale_buyers WHERE id = $1',
      [decoded.buyerId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Buyer not found' });
    }

    return res.json({
      status: 'ok',
      data: { buyer: result.rows[0] }
    });
  } catch (error) {
    console.error('Get buyer error:', error);
    return res.status(401).json({ status: 'error', message: 'Invalid token' });
  }
});

// POST /api/wholesale/buyers/forgot-password - Initiate password reset
router.post('/buyers/forgot-password', authRateLimiter, async (req, res) => {
  try {
    const { email } = req.body || {};

    if (!email) {
      return res.status(400).json({ status: 'error', message: 'Email is required' });
    }

    // Find buyer by email
    const result = await pool.query(
      'SELECT id, business_name, contact_name, email FROM wholesale_buyers WHERE email = $1',
      [email.toLowerCase()]
    );

    // Always return success to prevent email enumeration
    if (result.rows.length === 0) {
      return res.json({ 
        status: 'ok', 
        message: 'If that email exists, a password reset link has been sent.' 
      });
    }

    const buyer = result.rows[0];

    // Generate secure random token
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now

    // Store token in database
    await pool.query(
      'INSERT INTO password_reset_tokens (buyer_id, token, expires_at) VALUES ($1, $2, $3)',
      [buyer.id, token, expiresAt]
    );

    // TODO: Send email with reset link
    // For now, log the token (in production, this should be emailed)
    const resetLink = `${process.env.WHOLESALE_FRONTEND_URL || 'https://greenreachgreens.com'}/reset-password?token=${token}`;
    console.log(`[Password Reset] Token for ${buyer.email}: ${resetLink}`);
    
    // In production, integrate with AWS SES, SendGrid, or Mailgun:
    // await sendPasswordResetEmail(buyer.email, buyer.contact_name, resetLink);

    return res.json({ 
      status: 'ok', 
      message: 'If that email exists, a password reset link has been sent.',
      // Remove this in production - only for development:
      ...(process.env.NODE_ENV !== 'production' && { resetLink })
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    return res.status(500).json({ status: 'error', message: 'Failed to process request' });
  }
});

// GET /api/wholesale/buyers/reset-password/:token - Validate reset token
router.get('/buyers/reset-password/:token', async (req, res) => {
  try {
    const { token } = req.params;

    // Check if token exists and is valid
    const result = await pool.query(
      `SELECT rt.id, rt.buyer_id, rt.expires_at, rt.used, 
              b.email, b.business_name, b.contact_name
       FROM password_reset_tokens rt
       JOIN wholesale_buyers b ON rt.buyer_id = b.id
       WHERE rt.token = $1`,
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Invalid reset token' });
    }

    const resetToken = result.rows[0];

    // Check if token is expired
    if (new Date() > new Date(resetToken.expires_at)) {
      return res.status(400).json({ status: 'error', message: 'Reset token has expired' });
    }

    // Check if token has been used
    if (resetToken.used) {
      return res.status(400).json({ status: 'error', message: 'Reset token has already been used' });
    }

    return res.json({
      status: 'ok',
      data: {
        email: resetToken.email,
        businessName: resetToken.business_name,
        contactName: resetToken.contact_name
      }
    });
  } catch (error) {
    console.error('Validate reset token error:', error);
    return res.status(500).json({ status: 'error', message: 'Failed to validate token' });
  }
});

// POST /api/wholesale/buyers/reset-password - Complete password reset
router.post('/buyers/reset-password', authRateLimiter, async (req, res) => {
  try {
    const { token, newPassword } = req.body || {};

    if (!token || !newPassword) {
      return res.status(400).json({ status: 'error', message: 'Token and new password are required' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ status: 'error', message: 'Password must be at least 8 characters' });
    }

    // Verify token is valid and not used
    const tokenResult = await pool.query(
      `SELECT rt.id, rt.buyer_id, rt.expires_at, rt.used
       FROM password_reset_tokens rt
       WHERE rt.token = $1`,
      [token]
    );

    if (tokenResult.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Invalid reset token' });
    }

    const resetToken = tokenResult.rows[0];

    if (new Date() > new Date(resetToken.expires_at)) {
      return res.status(400).json({ status: 'error', message: 'Reset token has expired' });
    }

    if (resetToken.used) {
      return res.status(400).json({ status: 'error', message: 'Reset token has already been used' });
    }

    // Hash new password
    const passwordHash = await bcrypt.hash(newPassword, 10);

    // Update password
    await pool.query(
      'UPDATE wholesale_buyers SET password_hash = $1 WHERE id = $2',
      [passwordHash, resetToken.buyer_id]
    );

    // Mark token as used
    await pool.query(
      'UPDATE password_reset_tokens SET used = TRUE, used_at = NOW() WHERE id = $1',
      [resetToken.id]
    );

    console.log(`[Password Reset] Password successfully reset for buyer ID ${resetToken.buyer_id}`);

    return res.json({
      status: 'ok',
      message: 'Password has been reset successfully. You can now log in with your new password.'
    });
  } catch (error) {
    console.error('Reset password error:', error);
    return res.status(500).json({ status: 'error', message: 'Failed to reset password' });
  }
});

export default router;
