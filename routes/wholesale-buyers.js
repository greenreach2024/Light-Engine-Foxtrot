import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import pg from 'pg';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import { sendEmail } from '../lib/email-service.js';

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

// Authenticate wholesale buyer using JWT in Authorization header
async function requireBuyerAuth(req, res, next) {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ status: 'error', message: 'No token provided' });
    }

    const secret = getWholesaleJwtSecret();
    const decoded = jwt.verify(token, secret);
    req.buyerId = decoded.buyerId;
    return next();
  } catch (error) {
    console.error('Wholesale auth error:', error.message);
    return res.status(401).json({ status: 'error', message: 'Invalid or expired token' });
  }
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

    // Send welcome email
    try {
      await sendEmail({
        to: buyer.email,
        subject: 'Welcome to GreenReach Wholesale',
        text: `Welcome to GreenReach Wholesale, ${buyer.contact_name || buyer.business_name}!\n\nYour account has been successfully created.\n\nBusiness Name: ${buyer.business_name}\nEmail: ${buyer.email}\n\nYou can now browse our network of local farms and place wholesale orders.\n\nThank you for joining GreenReach!`,
        html: `
          <h2>Welcome to GreenReach Wholesale!</h2>
          <p>Hello ${buyer.contact_name || buyer.business_name},</p>
          <p>Your wholesale buyer account has been successfully created.</p>
          <h3>Account Details</h3>
          <ul>
            <li><strong>Business Name:</strong> ${buyer.business_name}</li>
            <li><strong>Email:</strong> ${buyer.email}</li>
            <li><strong>Buyer Type:</strong> ${buyer.buyer_type || 'Not specified'}</li>
          </ul>
          <p>You can now browse our network of certified local farms and place wholesale orders for fresh, sustainable produce.</p>
          <p>Thank you for choosing GreenReach!</p>
        `
      });
      console.log('[Wholesale Registration] Welcome email sent to:', buyer.email);
    } catch (emailError) {
      console.error('[Wholesale Registration] Failed to send welcome email:', emailError.message);
      // Continue with registration even if email fails
    }

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

// POST /api/wholesale/buyers/password-reset-request - Request password reset
router.post('/buyers/password-reset-request', authRateLimiter, async (req, res) => {
  try {
    const { email } = req.body || {};

    if (!email) {
      return res.status(400).json({ status: 'error', message: 'Email is required' });
    }

    // Check if buyer exists
    const result = await pool.query(
      'SELECT id, business_name, contact_name, email FROM wholesale_buyers WHERE email = $1',
      [email.toLowerCase()]
    );

    // Always return success to prevent email enumeration
    if (result.rows.length === 0) {
      console.log('[Password Reset] Email not found:', email);
      return res.json({
        status: 'ok',
        message: 'If an account exists with this email, a password reset link has been sent.'
      });
    }

    const buyer = result.rows[0];

    // Generate reset token (valid for 1 hour)
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
    const resetTokenExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    // Store reset token
    await pool.query(
      'UPDATE wholesale_buyers SET password_reset_token = $1, password_reset_expires = $2 WHERE id = $3',
      [resetTokenHash, resetTokenExpiry, buyer.id]
    );

    // Send password reset email
    const resetUrl = `${process.env.APP_URL || 'https://light-engine-foxtrot-prod.us-east-1.elasticbeanstalk.com'}/GR-wholesale.html?reset_token=${resetToken}`;

    try {
      await sendEmail({
        to: buyer.email,
        subject: 'Password Reset Request - GreenReach Wholesale',
        text: `Hello ${buyer.contact_name || buyer.business_name},\n\nYou requested a password reset for your GreenReach Wholesale account.\n\nClick the link below to reset your password (valid for 1 hour):\n${resetUrl}\n\nIf you did not request this reset, please ignore this email.\n\nGreenReach Support`,
        html: `
          <h2>Password Reset Request</h2>
          <p>Hello ${buyer.contact_name || buyer.business_name},</p>
          <p>You requested a password reset for your GreenReach Wholesale account.</p>
          <p><a href="${resetUrl}" style="display: inline-block; padding: 12px 24px; background-color: #10b981; color: white; text-decoration: none; border-radius: 4px;">Reset Password</a></p>
          <p>Or copy this link: <br/><code>${resetUrl}</code></p>
          <p><strong>This link expires in 1 hour.</strong></p>
          <p>If you did not request this reset, please ignore this email. Your password will remain unchanged.</p>
          <p>GreenReach Support</p>
        `
      });
      console.log('[Password Reset] Email sent to:', buyer.email);
    } catch (emailError) {
      console.error('[Password Reset] Failed to send email:', emailError.message);
      return res.status(500).json({ status: 'error', message: 'Failed to send password reset email' });
    }

    return res.json({
      status: 'ok',
      message: 'If an account exists with this email, a password reset link has been sent.'
    });
  } catch (error) {
    console.error('[Password Reset Request] Error:', error);
    return res.status(500).json({ status: 'error', message: 'Failed to process password reset request' });
  }
});

// POST /api/wholesale/buyers/password-reset - Complete password reset
router.post('/buyers/password-reset', authRateLimiter, async (req, res) => {
  try {
    const { token, newPassword } = req.body || {};

    if (!token || !newPassword) {
      return res.status(400).json({ status: 'error', message: 'Token and new password are required' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ status: 'error', message: 'Password must be at least 8 characters' });
    }

    // Hash the token to compare with stored hash
    const resetTokenHash = crypto.createHash('sha256').update(token).digest('hex');

    // Find buyer with valid reset token
    const result = await pool.query(
      'SELECT id, email, contact_name, business_name FROM wholesale_buyers WHERE password_reset_token = $1 AND password_reset_expires > NOW()',
      [resetTokenHash]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ status: 'error', message: 'Invalid or expired reset token' });
    }

    const buyer = result.rows[0];

    // Hash new password
    const passwordHash = await bcrypt.hash(newPassword, 10);

    // Update password and clear reset token
    await pool.query(
      'UPDATE wholesale_buyers SET password_hash = $1, password_reset_token = NULL, password_reset_expires = NULL WHERE id = $2',
      [passwordHash, buyer.id]
    );

    // Send confirmation email
    try {
      await sendEmail({
        to: buyer.email,
        subject: 'Password Reset Successful - GreenReach Wholesale',
        text: `Hello ${buyer.contact_name || buyer.business_name},\n\nYour password has been successfully reset.\n\nIf you did not make this change, please contact support immediately.\n\nGreenReach Support`,
        html: `
          <h2>Password Reset Successful</h2>
          <p>Hello ${buyer.contact_name || buyer.business_name},</p>
          <p>Your password has been successfully reset.</p>
          <p>You can now log in with your new password.</p>
          <p><strong>If you did not make this change, please contact support immediately.</strong></p>
          <p>GreenReach Support</p>
        `
      });
    } catch (emailError) {
      console.error('[Password Reset] Failed to send confirmation email:', emailError.message);
    }

    return res.json({
      status: 'ok',
      message: 'Password reset successful. You can now log in with your new password.'
    });
  } catch (error) {
    console.error('[Password Reset] Error:', error);
    return res.status(500).json({ status: 'error', message: 'Failed to reset password' });
  }
});

// GET /api/wholesale/buyers/me - Get current buyer profile
router.get('/buyers/me', requireBuyerAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, business_name, contact_name, email, buyer_type, location, created_at FROM wholesale_buyers WHERE id = $1',
      [req.buyerId]
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
    return res.status(500).json({ status: 'error', message: 'Failed to fetch buyer profile' });
  }
});

// PUT /api/wholesale/buyers/me - Update buyer profile
router.put('/buyers/me', requireBuyerAuth, async (req, res) => {
  try {
    const { businessName, contactName, email, buyerType, phone, address, city, province, postalCode, country } = req.body || {};

    if (!businessName || !contactName || !email) {
      return res.status(400).json({ status: 'error', message: 'Business name, contact name, and email are required' });
    }

    // Ensure email uniqueness
    const existing = await pool.query(
      'SELECT id FROM wholesale_buyers WHERE email = $1 AND id <> $2',
      [email.toLowerCase(), req.buyerId]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({ status: 'error', message: 'Email already in use by another account' });
    }

    // Fetch current location to merge optional fields
    const current = await pool.query(
      'SELECT location FROM wholesale_buyers WHERE id = $1',
      [req.buyerId]
    );
    const currentLocation = current.rows[0]?.location || {};

    const location = {
      ...currentLocation,
      street: address ?? currentLocation.street,
      city: city ?? currentLocation.city,
      province: province ?? currentLocation.province,
      postalCode: postalCode ?? currentLocation.postalCode,
      country: country ?? currentLocation.country,
      phone: phone ?? currentLocation.phone
    };

    const update = await pool.query(
      `UPDATE wholesale_buyers
         SET business_name = $1,
             contact_name = $2,
             email = $3,
             buyer_type = $4,
             location = $5
       WHERE id = $6
       RETURNING id, business_name, contact_name, email, buyer_type, location, created_at`,
      [businessName, contactName, email.toLowerCase(), buyerType || 'restaurant', JSON.stringify(location), req.buyerId]
    );

    const buyer = update.rows[0];

    return res.json({
      status: 'ok',
      data: { buyer }
    });
  } catch (error) {
    console.error('Update buyer error:', error);
    return res.status(500).json({ status: 'error', message: 'Failed to update profile' });
  }
});

// POST /api/wholesale/buyers/change-password - Change buyer password
router.post('/buyers/change-password', requireBuyerAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ status: 'error', message: 'Current and new passwords are required' });
    }

    const result = await pool.query(
      'SELECT password_hash FROM wholesale_buyers WHERE id = $1',
      [req.buyerId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Buyer not found' });
    }

    const matches = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
    if (!matches) {
      return res.status(401).json({ status: 'error', message: 'Current password is incorrect' });
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await pool.query(
      'UPDATE wholesale_buyers SET password_hash = $1 WHERE id = $2',
      [newHash, req.buyerId]
    );

    return res.json({ status: 'ok', message: 'Password updated successfully' });
  } catch (error) {
    console.error('Change password error:', error);
    return res.status(500).json({ status: 'error', message: 'Failed to change password' });
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

    // Send password reset email
    const resetLink = `${process.env.WHOLESALE_FRONTEND_URL || 'https://greenreachgreens.com'}/reset-password?token=${token}`;
    
    try {
      await sendEmail({
        to: buyer.email,
        subject: 'Reset Your GreenReach Password',
        text: `Hi ${buyer.contact_name},\n\nYou requested to reset your password for your GreenReach wholesale buyer account.\n\nClick the link below to reset your password:\n${resetLink}\n\nThis link will expire in 1 hour.\n\nIf you didn't request this, please ignore this email.\n\nBest regards,\nThe GreenReach Team`,
        html: `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #2e7d32; color: white; padding: 20px; text-align: center; }
    .content { padding: 20px; background: #f9f9f9; }
    .button { display: inline-block; padding: 12px 24px; background: #2e7d32; color: white; text-decoration: none; border-radius: 4px; margin: 20px 0; }
    .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Reset Your Password</h1>
    </div>
    <div class="content">
      <p>Hi ${buyer.contact_name},</p>
      <p>You requested to reset your password for your GreenReach wholesale buyer account.</p>
      <p>Click the button below to reset your password:</p>
      <p style="text-align: center;">
        <a href="${resetLink}" class="button">Reset Password</a>
      </p>
      <p>Or copy and paste this link into your browser:</p>
      <p style="word-break: break-all; color: #666;">${resetLink}</p>
      <p><strong>This link will expire in 1 hour.</strong></p>
      <p>If you didn't request this password reset, please ignore this email. Your password will remain unchanged.</p>
      <p>Best regards,<br>The GreenReach Team</p>
    </div>
    <div class="footer">
      <p>GreenReach Wholesale Platform</p>
    </div>
  </div>
</body>
</html>
        `
      });

      console.log(`[Password Reset] Email sent to ${buyer.email}`);
    } catch (emailError) {
      console.error(`[Password Reset] Failed to send email to ${buyer.email}:`, emailError);
      // Continue anyway - token is stored in database
    }

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
