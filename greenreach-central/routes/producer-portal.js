/**
 * Producer Portal — Self-service registration, product management, and order visibility
 * Multi-vendor wholesale expansion Phase 1
 *
 * Public endpoints:
 *   POST /register          Submit application
 *   POST /login             Producer login
 *   GET  /application-status Check application status by email
 *
 * Authenticated (requireProducerAuth):
 *   GET    /me              Profile + farm info
 *   PUT    /me              Update farm profile
 *   POST   /change-password Change password
 *   POST   /logout          Blacklist token
 *   GET    /products        List own products
 *   POST   /products        Add product
 *   PUT    /products/:id    Update product
 *   DELETE /products/:id    Delist product
 *   GET    /orders          List farm sub-orders
 *   GET    /orders/:id      Order detail
 *   GET    /dashboard       Overview stats
 */

import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { randomUUID, createHash } from 'crypto';
import rateLimit from 'express-rate-limit';
import { isDatabaseAvailable, query } from '../config/database.js';
import { ValidationError } from '../middleware/errorHandler.js';

const router = express.Router();

// ── Rate Limiters ────────────────────────────────────────────────────

const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { status: 'error', message: 'Too many registration attempts. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { status: 'error', message: 'Too many login attempts. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

// ── Auth Helpers ─────────────────────────────────────────────────────

function getProducerJwtSecret() {
  const secret = process.env.PRODUCER_JWT_SECRET || process.env.WHOLESALE_JWT_SECRET || process.env.JWT_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV !== 'production') return 'dev-greenreach-producer-secret';
  return null;
}

function issueProducerToken(farmId, producerId) {
  const secret = getProducerJwtSecret();
  if (!secret) {
    const err = new Error('Producer auth is not configured (missing JWT secret)');
    err.code = 'AUTH_NOT_CONFIGURED';
    throw err;
  }
  return jwt.sign({ sub: producerId, farm_id: farmId, scope: 'producer' }, secret, { expiresIn: '7d' });
}

// Token blacklist (in-memory, same pattern as buyer auth)
const tokenBlacklist = new Set();

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

// Login lockout
const loginAttempts = new Map();
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 30 * 60 * 1000;

function isAccountLocked(email) {
  const record = loginAttempts.get(email);
  if (!record) return false;
  if (record.lockedUntil && Date.now() < record.lockedUntil) return true;
  if (record.lockedUntil && Date.now() >= record.lockedUntil) {
    loginAttempts.delete(email);
    return false;
  }
  return false;
}

function recordLoginAttempt(email, success) {
  if (success) {
    loginAttempts.delete(email);
    return;
  }
  const record = loginAttempts.get(email) || { count: 0, lockedUntil: null };
  record.count += 1;
  if (record.count >= MAX_LOGIN_ATTEMPTS) {
    record.lockedUntil = Date.now() + LOCKOUT_DURATION_MS;
  }
  loginAttempts.set(email, record);
}

// ── Producer Auth Middleware ─────────────────────────────────────────

async function requireProducerAuth(req, res, next) {
  if (!isDatabaseAvailable()) {
    return res.status(503).json({ status: 'error', message: 'Service temporarily unavailable' });
  }

  const authHeader = req.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) {
    return res.status(401).json({ status: 'error', message: 'Missing bearer token' });
  }

  if (tokenBlacklist.has(hashToken(token))) {
    return res.status(401).json({ status: 'error', message: 'Token has been revoked' });
  }

  const secret = getProducerJwtSecret();
  if (!secret) {
    return res.status(500).json({ status: 'error', message: 'Producer auth not configured' });
  }

  try {
    const payload = jwt.verify(token, secret);
    if (!payload?.sub || payload.scope !== 'producer') {
      return res.status(401).json({ status: 'error', message: 'Invalid token' });
    }

    // Verify account is still active
    const result = await query(
      'SELECT id, farm_id, email, display_name, role, status FROM producer_accounts WHERE id = $1',
      [parseInt(payload.sub, 10)]
    );
    if (!result.rows.length || result.rows[0].status !== 'active') {
      return res.status(401).json({ status: 'error', message: 'Account not found or inactive' });
    }

    req.producer = result.rows[0];
    req.producerFarmId = result.rows[0].farm_id;
    req.producerToken = token;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ status: 'error', message: 'Token expired' });
    }
    return res.status(401).json({ status: 'error', message: 'Invalid token' });
  }
}

// ── Input Sanitization ──────────────────────────────────────────────

function sanitizeText(val) {
  if (typeof val !== 'string') return '';
  return val.trim().slice(0, 500);
}

function sanitizeArray(val, allowed) {
  if (!Array.isArray(val)) return [];
  return val
    .filter(v => typeof v === 'string')
    .map(v => v.trim().toLowerCase())
    .filter(v => !allowed || allowed.includes(v))
    .slice(0, 20);
}

const ALLOWED_CERTIFICATIONS = ['organic', 'gap', 'food_safety', 'greenhouse', 'usda_organic', 'non_gmo'];
const ALLOWED_PRACTICES = ['pesticide_free', 'non_gmo', 'hydroponic', 'local', 'year_round', 'regenerative', 'pasture_raised', 'free_range'];
const ALLOWED_PRODUCT_TYPES = ['vegetables', 'fruits', 'herbs', 'microgreens', 'mushrooms', 'eggs', 'dairy', 'honey', 'baked_goods', 'preserves', 'meat', 'flowers', 'other'];

// ── SKU Generation ──────────────────────────────────────────────────

function generateSku(farmId, productName) {
  const prefix = (farmId || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).toUpperCase();
  const prod = (productName || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 6).toUpperCase();
  const rand = randomUUID().slice(0, 6).toUpperCase();
  return `${prefix}-${prod}-${rand}`;
}

// ══════════════════════════════════════════════════════════════════════
// PUBLIC ENDPOINTS
// ══════════════════════════════════════════════════════════════════════

// ── POST /register — Submit producer application ─────────────────────

router.post('/register', registerLimiter, async (req, res, next) => {
  try {
    if (!isDatabaseAvailable()) {
      return res.status(503).json({ status: 'error', message: 'Service temporarily unavailable' });
    }

    const {
      businessName, contactName, email, password, phone, website,
      location, certifications, practices, productTypes, description
    } = req.body || {};

    // Validate required fields
    if (!businessName || !contactName || !email || !password) {
      throw new ValidationError('Business name, contact name, email, and password are required');
    }
    if (typeof password !== 'string' || password.length < 8) {
      throw new ValidationError('Password must be at least 8 characters');
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    // Check for duplicate email in applications or accounts
    const existing = await query(
      `SELECT id FROM producer_applications WHERE email = $1
       UNION ALL
       SELECT id FROM producer_accounts WHERE email = $1
       LIMIT 1`,
      [normalizedEmail]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ status: 'error', message: 'An application with this email already exists' });
    }

    const passwordHash = await bcrypt.hash(String(password), 10);

    const sanitizedLocation = location && typeof location === 'object' ? {
      address: sanitizeText(location.address),
      city: sanitizeText(location.city),
      state: sanitizeText(location.state),
      zip: sanitizeText(location.zip),
      region: sanitizeText(location.region)
    } : {};

    const result = await query(
      `INSERT INTO producer_applications
        (business_name, contact_name, email, phone, website, location,
         certifications, practices, product_types, description, password_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id, business_name, email, status, created_at`,
      [
        sanitizeText(businessName),
        sanitizeText(contactName),
        normalizedEmail,
        sanitizeText(phone),
        sanitizeText(website),
        JSON.stringify(sanitizedLocation),
        sanitizeArray(certifications, ALLOWED_CERTIFICATIONS),
        sanitizeArray(practices, ALLOWED_PRACTICES),
        sanitizeArray(productTypes, ALLOWED_PRODUCT_TYPES),
        sanitizeText(description),
        passwordHash
      ]
    );

    const app = result.rows[0];

    console.log(`[Producer] New application submitted: ${app.business_name} (${normalizedEmail})`);

    return res.status(201).json({
      status: 'ok',
      message: 'Application submitted. You will be notified when it is reviewed.',
      data: {
        application_id: app.id,
        business_name: app.business_name,
        email: app.email,
        status: app.status,
        created_at: app.created_at
      }
    });
  } catch (error) {
    return next(error);
  }
});

// ── POST /login — Producer login ─────────────────────────────────────

router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    if (!isDatabaseAvailable()) {
      return res.status(503).json({ status: 'error', message: 'Service temporarily unavailable' });
    }

    const { email, password } = req.body || {};
    if (!email || !password) {
      throw new ValidationError('Email and password are required');
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    if (isAccountLocked(normalizedEmail)) {
      return res.status(423).json({
        status: 'error',
        message: 'Account temporarily locked due to too many failed attempts. Try again in 30 minutes.'
      });
    }

    const result = await query(
      'SELECT id, farm_id, email, password_hash, display_name, role, status FROM producer_accounts WHERE email = $1',
      [normalizedEmail]
    );

    if (!result.rows.length) {
      recordLoginAttempt(normalizedEmail, false);
      return res.status(401).json({ status: 'error', message: 'Invalid email or password' });
    }

    const account = result.rows[0];

    if (account.status !== 'active') {
      return res.status(403).json({ status: 'error', message: 'Account is not active' });
    }

    const valid = await bcrypt.compare(String(password), account.password_hash);
    if (!valid) {
      recordLoginAttempt(normalizedEmail, false);
      return res.status(401).json({ status: 'error', message: 'Invalid email or password' });
    }

    recordLoginAttempt(normalizedEmail, true);

    // Update last login
    query('UPDATE producer_accounts SET last_login = NOW() WHERE id = $1', [account.id])
      .catch(err => console.warn('[Producer] last_login update failed:', err.message));

    const token = issueProducerToken(account.farm_id, account.id);

    return res.json({
      status: 'ok',
      data: {
        token,
        producer: {
          id: account.id,
          farm_id: account.farm_id,
          email: account.email,
          display_name: account.display_name,
          role: account.role
        }
      }
    });
  } catch (error) {
    return next(error);
  }
});

// ── GET /application-status — Check application status ───────────────

router.get('/application-status', async (req, res, next) => {
  try {
    if (!isDatabaseAvailable()) {
      return res.status(503).json({ status: 'error', message: 'Service temporarily unavailable' });
    }

    const email = String(req.query.email || '').trim().toLowerCase();
    if (!email) {
      throw new ValidationError('Email query parameter is required');
    }

    const result = await query(
      'SELECT id, business_name, status, review_notes, created_at, reviewed_at FROM producer_applications WHERE email = $1',
      [email]
    );

    if (!result.rows.length) {
      return res.status(404).json({ status: 'error', message: 'No application found for this email' });
    }

    const app = result.rows[0];
    return res.json({
      status: 'ok',
      data: {
        application_id: app.id,
        business_name: app.business_name,
        status: app.status,
        review_notes: app.status === 'rejected' ? app.review_notes : undefined,
        submitted_at: app.created_at,
        reviewed_at: app.reviewed_at
      }
    });
  } catch (error) {
    return next(error);
  }
});

// ══════════════════════════════════════════════════════════════════════
// AUTHENTICATED ENDPOINTS
// ══════════════════════════════════════════════════════════════════════

// ── GET /me — Producer profile ───────────────────────────────────────

router.get('/me', requireProducerAuth, async (req, res, next) => {
  try {
    // Get farm info
    const farmResult = await query(
      `SELECT farm_id, farm_name, metadata, status, created_at
       FROM farms WHERE farm_id = $1`,
      [req.producerFarmId]
    );

    const farm = farmResult.rows[0] || null;
    const meta = farm?.metadata || {};

    return res.json({
      status: 'ok',
      data: {
        producer: {
          id: req.producer.id,
          email: req.producer.email,
          display_name: req.producer.display_name,
          role: req.producer.role
        },
        farm: farm ? {
          farm_id: farm.farm_id,
          farm_name: farm.farm_name,
          status: farm.status,
          contact: meta.contact || {},
          location: meta.location || {},
          certifications: meta.certifications || [],
          practices: meta.practices || [],
          attributes: meta.attributes || [],
          created_at: farm.created_at
        } : null
      }
    });
  } catch (error) {
    return next(error);
  }
});

// ── PUT /me — Update farm profile ────────────────────────────────────

router.put('/me', requireProducerAuth, async (req, res, next) => {
  try {
    const { farmName, contact, location, certifications, practices, attributes } = req.body || {};

    // Build metadata patch — merge with existing
    const existing = await query('SELECT metadata FROM farms WHERE farm_id = $1', [req.producerFarmId]);
    const meta = existing.rows[0]?.metadata || {};

    if (contact && typeof contact === 'object') {
      meta.contact = {
        name: sanitizeText(contact.name) || meta.contact?.name,
        email: sanitizeText(contact.email) || meta.contact?.email,
        phone: sanitizeText(contact.phone) || meta.contact?.phone,
        website: sanitizeText(contact.website) || meta.contact?.website
      };
    }

    if (location && typeof location === 'object') {
      meta.location = {
        address: sanitizeText(location.address) || meta.location?.address,
        city: sanitizeText(location.city) || meta.location?.city,
        state: sanitizeText(location.state) || meta.location?.state,
        zip: sanitizeText(location.zip) || meta.location?.zip,
        region: sanitizeText(location.region) || meta.location?.region
      };
    }

    if (certifications) meta.certifications = sanitizeArray(certifications, ALLOWED_CERTIFICATIONS);
    if (practices) meta.practices = sanitizeArray(practices, ALLOWED_PRACTICES);
    if (attributes) meta.attributes = sanitizeArray(attributes);

    const nameUpdate = farmName ? sanitizeText(farmName) : null;

    await query(
      `UPDATE farms SET metadata = $1, farm_name = COALESCE($2, farm_name), updated_at = NOW()
       WHERE farm_id = $3`,
      [JSON.stringify(meta), nameUpdate, req.producerFarmId]
    );

    return res.json({ status: 'ok', message: 'Profile updated' });
  } catch (error) {
    return next(error);
  }
});

// ── POST /change-password ────────────────────────────────────────────

router.post('/change-password', requireProducerAuth, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      throw new ValidationError('Current password and new password are required');
    }
    if (typeof newPassword !== 'string' || newPassword.length < 8) {
      throw new ValidationError('New password must be at least 8 characters');
    }

    const result = await query('SELECT password_hash FROM producer_accounts WHERE id = $1', [req.producer.id]);
    if (!result.rows.length) {
      return res.status(404).json({ status: 'error', message: 'Account not found' });
    }

    const valid = await bcrypt.compare(String(currentPassword), result.rows[0].password_hash);
    if (!valid) {
      return res.status(401).json({ status: 'error', message: 'Current password is incorrect' });
    }

    const newHash = await bcrypt.hash(String(newPassword), 10);
    await query('UPDATE producer_accounts SET password_hash = $1, updated_at = NOW() WHERE id = $2', [newHash, req.producer.id]);

    return res.json({ status: 'ok', message: 'Password updated' });
  } catch (error) {
    return next(error);
  }
});

// ── POST /logout ─────────────────────────────────────────────────────

router.post('/logout', requireProducerAuth, (req, res) => {
  tokenBlacklist.add(hashToken(req.producerToken));
  return res.json({ status: 'ok', message: 'Logged out' });
});

// ══════════════════════════════════════════════════════════════════════
// PRODUCT MANAGEMENT
// ══════════════════════════════════════════════════════════════════════

// ── GET /products — List own products ────────────────────────────────

router.get('/products', requireProducerAuth, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT id, product_id, product_name, sku, category, variety,
              quantity, unit, price, wholesale_price,
              available_for_wholesale, status, last_updated
       FROM farm_inventory
       WHERE farm_id = $1
       ORDER BY product_name ASC`,
      [req.producerFarmId]
    );

    return res.json({
      status: 'ok',
      data: {
        products: result.rows,
        count: result.rows.length
      }
    });
  } catch (error) {
    return next(error);
  }
});

// ── POST /products — Add product ─────────────────────────────────────

router.post('/products', requireProducerAuth, async (req, res, next) => {
  try {
    const {
      productName, category, variety, quantity, unit,
      wholesalePrice, retailPrice, description
    } = req.body || {};

    if (!productName || !unit || wholesalePrice == null) {
      throw new ValidationError('Product name, unit, and wholesale price are required');
    }

    const price = parseFloat(wholesalePrice);
    if (!Number.isFinite(price) || price <= 0) {
      throw new ValidationError('Wholesale price must be a positive number');
    }

    const qty = parseInt(quantity, 10);
    if (quantity != null && (!Number.isFinite(qty) || qty < 0)) {
      throw new ValidationError('Quantity must be a non-negative integer');
    }

    const productId = `prod-${randomUUID().slice(0, 12)}`;
    const sku = generateSku(req.producerFarmId, productName);

    const result = await query(
      `INSERT INTO farm_inventory
        (farm_id, product_id, product_name, sku, category, variety,
         quantity, unit, price, wholesale_price, retail_price,
         available_for_wholesale, status, source_data, last_updated)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, $10, TRUE, 'active',
               $11::jsonb, NOW())
       RETURNING id, product_id, product_name, sku, category, variety,
                 quantity, unit, wholesale_price, available_for_wholesale, status`,
      [
        req.producerFarmId,
        productId,
        sanitizeText(productName),
        sku,
        sanitizeText(category),
        sanitizeText(variety),
        qty || 0,
        sanitizeText(unit),
        price,
        retailPrice ? parseFloat(retailPrice) : null,
        JSON.stringify({ added_by: 'producer_portal', description: sanitizeText(description) })
      ]
    );

    console.log(`[Producer] Product added: ${sku} by farm ${req.producerFarmId}`);

    return res.status(201).json({
      status: 'ok',
      data: result.rows[0]
    });
  } catch (error) {
    if (error?.constraint === 'farm_inventory_farm_id_product_id_key') {
      return res.status(409).json({ status: 'error', message: 'A product with this ID already exists' });
    }
    return next(error);
  }
});

// ── PUT /products/:id — Update product ───────────────────────────────

router.put('/products/:id', requireProducerAuth, async (req, res, next) => {
  try {
    const productId = parseInt(req.params.id, 10);
    if (!Number.isFinite(productId)) {
      throw new ValidationError('Invalid product ID');
    }

    // Verify ownership
    const existing = await query(
      'SELECT id, farm_id FROM farm_inventory WHERE id = $1',
      [productId]
    );
    if (!existing.rows.length) {
      return res.status(404).json({ status: 'error', message: 'Product not found' });
    }
    if (existing.rows[0].farm_id !== req.producerFarmId) {
      return res.status(403).json({ status: 'error', message: 'Access denied' });
    }

    const {
      productName, category, variety, quantity, unit,
      wholesalePrice, retailPrice, availableForWholesale, status
    } = req.body || {};

    // Build dynamic update
    const updates = [];
    const values = [];
    let paramIdx = 1;

    if (productName != null) { updates.push(`product_name = $${paramIdx++}`); values.push(sanitizeText(productName)); }
    if (category != null) { updates.push(`category = $${paramIdx++}`); values.push(sanitizeText(category)); }
    if (variety != null) { updates.push(`variety = $${paramIdx++}`); values.push(sanitizeText(variety)); }
    if (quantity != null) {
      const qty = parseInt(quantity, 10);
      if (!Number.isFinite(qty) || qty < 0) throw new ValidationError('Quantity must be a non-negative integer');
      updates.push(`quantity = $${paramIdx++}`); values.push(qty);
    }
    if (unit != null) { updates.push(`unit = $${paramIdx++}`); values.push(sanitizeText(unit)); }
    if (wholesalePrice != null) {
      const price = parseFloat(wholesalePrice);
      if (!Number.isFinite(price) || price <= 0) throw new ValidationError('Wholesale price must be a positive number');
      updates.push(`wholesale_price = $${paramIdx++}`); values.push(price);
      updates.push(`price = $${paramIdx++}`); values.push(price);
    }
    if (retailPrice != null) { updates.push(`retail_price = $${paramIdx++}`); values.push(parseFloat(retailPrice) || null); }
    if (availableForWholesale != null) { updates.push(`available_for_wholesale = $${paramIdx++}`); values.push(Boolean(availableForWholesale)); }
    if (status != null && ['active', 'inactive', 'out_of_stock'].includes(status)) {
      updates.push(`status = $${paramIdx++}`); values.push(status);
    }

    if (!updates.length) {
      throw new ValidationError('No fields to update');
    }

    updates.push(`last_updated = NOW()`);
    values.push(productId);

    const result = await query(
      `UPDATE farm_inventory SET ${updates.join(', ')} WHERE id = $${paramIdx}
       RETURNING id, product_id, product_name, sku, category, variety,
                 quantity, unit, wholesale_price, available_for_wholesale, status`,
      values
    );

    return res.json({ status: 'ok', data: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

// ── DELETE /products/:id — Delist product (soft delete) ──────────────

router.delete('/products/:id', requireProducerAuth, async (req, res, next) => {
  try {
    const productId = parseInt(req.params.id, 10);
    if (!Number.isFinite(productId)) {
      throw new ValidationError('Invalid product ID');
    }

    // Verify ownership
    const existing = await query(
      'SELECT id, farm_id FROM farm_inventory WHERE id = $1',
      [productId]
    );
    if (!existing.rows.length) {
      return res.status(404).json({ status: 'error', message: 'Product not found' });
    }
    if (existing.rows[0].farm_id !== req.producerFarmId) {
      return res.status(403).json({ status: 'error', message: 'Access denied' });
    }

    await query(
      `UPDATE farm_inventory
       SET available_for_wholesale = FALSE, status = 'inactive', last_updated = NOW()
       WHERE id = $1`,
      [productId]
    );

    return res.json({ status: 'ok', message: 'Product delisted from wholesale catalog' });
  } catch (error) {
    return next(error);
  }
});

// ══════════════════════════════════════════════════════════════════════
// ORDERS
// ══════════════════════════════════════════════════════════════════════

// ── GET /orders — Farm sub-orders for this producer ──────────────────

router.get('/orders', requireProducerAuth, async (req, res, next) => {
  try {
    const { status: statusFilter, limit = '50', offset = '0' } = req.query;
    const lim = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
    const off = Math.max(parseInt(offset, 10) || 0, 0);

    // wholesale_orders stores farm_sub_orders as JSONB array
    // We need to extract sub-orders belonging to this farm
    let filterClause = '';
    const params = [req.producerFarmId, lim, off];

    if (statusFilter) {
      filterClause = `AND sub_order->>'status' = $4`;
      params.push(statusFilter);
    }

    const result = await query(
      `SELECT
         wo.id AS order_id,
         wo.master_order_id,
         wo.buyer_id,
         wo.status AS order_status,
         wo.created_at AS order_date,
         sub_order
       FROM wholesale_orders wo,
            jsonb_array_elements(wo.farm_sub_orders) AS sub_order
       WHERE sub_order->>'farm_id' = $1
         ${filterClause}
       ORDER BY wo.created_at DESC
       LIMIT $2 OFFSET $3`,
      params
    );

    const orders = result.rows.map(r => ({
      order_id: r.order_id,
      master_order_id: r.master_order_id,
      buyer_id: r.buyer_id,
      order_status: r.order_status,
      order_date: r.order_date,
      sub_order: r.sub_order
    }));

    return res.json({
      status: 'ok',
      data: { orders, count: orders.length }
    });
  } catch (error) {
    return next(error);
  }
});

// ── GET /orders/:orderId — Order detail ──────────────────────────────

router.get('/orders/:orderId', requireProducerAuth, async (req, res, next) => {
  try {
    const orderId = req.params.orderId;

    const result = await query(
      `SELECT
         wo.id, wo.master_order_id, wo.buyer_id, wo.status,
         wo.farm_sub_orders, wo.created_at, wo.updated_at,
         wo.metadata
       FROM wholesale_orders wo
       WHERE wo.master_order_id = $1 OR wo.id::text = $1
       LIMIT 1`,
      [orderId]
    );

    if (!result.rows.length) {
      return res.status(404).json({ status: 'error', message: 'Order not found' });
    }

    const order = result.rows[0];
    const subOrders = order.farm_sub_orders || [];
    const mySubOrder = subOrders.find(s => s.farm_id === req.producerFarmId);

    if (!mySubOrder) {
      return res.status(404).json({ status: 'error', message: 'No items for your farm in this order' });
    }

    return res.json({
      status: 'ok',
      data: {
        order_id: order.master_order_id || order.id,
        order_status: order.status,
        order_date: order.created_at,
        your_sub_order: mySubOrder
      }
    });
  } catch (error) {
    return next(error);
  }
});

// ══════════════════════════════════════════════════════════════════════
// DASHBOARD
// ══════════════════════════════════════════════════════════════════════

router.get('/dashboard', requireProducerAuth, async (req, res, next) => {
  try {
    const farmId = req.producerFarmId;

    // Parallel queries for dashboard data
    const [productsResult, ordersResult, revenueResult] = await Promise.all([
      // Product counts
      query(
        `SELECT
           COUNT(*) FILTER (WHERE available_for_wholesale = TRUE AND status = 'active') AS active_products,
           COUNT(*) FILTER (WHERE status = 'inactive') AS inactive_products,
           COUNT(*) AS total_products
         FROM farm_inventory WHERE farm_id = $1`,
        [farmId]
      ),

      // Recent order count (last 30 days)
      query(
        `SELECT COUNT(*) AS order_count
         FROM wholesale_orders wo,
              jsonb_array_elements(wo.farm_sub_orders) AS sub_order
         WHERE sub_order->>'farm_id' = $1
           AND wo.created_at > NOW() - INTERVAL '30 days'`,
        [farmId]
      ),

      // Revenue (last 30 days) from payment_records
      query(
        `SELECT COALESCE(SUM((metadata->>'net_to_farm')::numeric), 0) AS net_revenue_30d
         FROM payment_records
         WHERE metadata->>'farm_id' = $1
           AND status = 'completed'
           AND created_at > NOW() - INTERVAL '30 days'`,
        [farmId]
      )
    ]);

    return res.json({
      status: 'ok',
      data: {
        products: {
          active: parseInt(productsResult.rows[0]?.active_products || 0),
          inactive: parseInt(productsResult.rows[0]?.inactive_products || 0),
          total: parseInt(productsResult.rows[0]?.total_products || 0)
        },
        orders_last_30d: parseInt(ordersResult.rows[0]?.order_count || 0),
        net_revenue_last_30d: parseFloat(revenueResult.rows[0]?.net_revenue_30d || 0),
        farm_id: farmId
      }
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
