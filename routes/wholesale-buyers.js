import express from 'express';
import jwt from 'jsonwebtoken';
import pool from '../lib/db.js';

const router = express.Router();

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
router.post('/buyers/register', async (req, res) => {
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

    // Create buyer (password should be hashed in production)
    const result = await pool.query(
      `INSERT INTO wholesale_buyers (business_name, contact_name, email, password_hash, buyer_type, location, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       RETURNING id, business_name, contact_name, email, buyer_type, location, created_at`,
      [businessName, contactName, email.toLowerCase(), password, buyerType, JSON.stringify(location || {})]
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
router.post('/buyers/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({ status: 'error', message: 'Email and password are required' });
    }

    const result = await pool.query(
      'SELECT id, business_name, contact_name, email, buyer_type, location, password_hash FROM wholesale_buyers WHERE email = $1',
      [email.toLowerCase()]
    );

    if (result.rows.length === 0 || result.rows[0].password_hash !== password) {
      return res.status(401).json({ status: 'error', message: 'Invalid credentials' });
    }

    const buyer = result.rows[0];
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

export default router;
