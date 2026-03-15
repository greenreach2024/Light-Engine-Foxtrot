/**
 * Purchase Routes — Light Engine Cloud & Edge Subscription Purchase Pipeline
 * 
 * Endpoints:
 *   POST /api/farms/create-checkout-session   — Create Square payment link
 *   GET  /api/farms/verify-session/:sessionId — Verify payment & provision farm+user
 *   POST /api/farms/verify-id                 — Validate existing Farm ID
 *   POST /api/purchase/leads                  — CRM lead capture (pre-orders)
 * 
 * Flow:
 *   1. User fills purchase modal (farm name, contact, email)
 *   2. Frontend POSTs to create-checkout-session
 *   3. Backend creates Square Payment Link → returns redirect URL
 *   4. User completes payment on Square-hosted checkout
 *   5. Square redirects to /purchase-success.html?transactionId=...&orderId=...
 *   6. Success page GETs verify-session/:sessionId
 *   7. Backend verifies Square order is COMPLETED, provisions farm+user, issues JWT
 *   8. Frontend stores JWT, redirects to farm-admin.html
 */

import { Router } from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import bcryptjs from 'bcryptjs';
import { query, isDatabaseAvailable } from '../config/database.js';
import { sendWelcomeEmail } from '../services/email.js';
import { adminAuthMiddleware } from '../middleware/adminAuth.js';

const router = Router();

// ═══════════════════════════════════════════════════════════════
// Square Client (lazy init — only when env vars are present)
// ═══════════════════════════════════════════════════════════════
let _squareClient = null;

async function getSquareClient() {
  if (_squareClient) return _squareClient;

  const accessToken = process.env.SQUARE_ACCESS_TOKEN;
  if (!accessToken) return null;

  try {
    const { SquareClient, SquareEnvironment } = await import('square');
    const environment = process.env.SQUARE_ENVIRONMENT === 'production'
      ? SquareEnvironment.Production
      : SquareEnvironment.Sandbox;

    _squareClient = new SquareClient({ token: accessToken, environment });
    console.log(`[Purchase] Square client initialized (${process.env.SQUARE_ENVIRONMENT || 'sandbox'})`);
    return _squareClient;
  } catch (err) {
    console.error('[Purchase] Failed to init Square client:', err.message);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

/** Generate a unique farm ID: FARM-XXXXXXXX-YYYYYYYY */
function generateFarmId() {
  const seg1 = crypto.randomBytes(4).toString('hex').toUpperCase();
  const seg2 = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `FARM-${seg1}-${seg2}`;
}

/** Generate a temporary password for new users */
function generateTempPassword() {
  // 12 chars: mix of upper, lower, digits
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let pwd = '';
  for (let i = 0; i < 12; i++) {
    pwd += chars.charAt(crypto.randomInt(chars.length));
  }
  return pwd;
}

/** Generate farm secrets (JWT, API key, API secret) */
function generateFarmSecrets() {
  return {
    jwtSecret: crypto.randomBytes(32).toString('hex'),
    apiKey: crypto.randomBytes(32).toString('hex'),
    apiSecret: crypto.randomBytes(32).toString('hex'),
  };
}

/** Ensure checkout_sessions table exists */
async function ensureCheckoutTable() {
  if (!isDatabaseAvailable()) return;
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS checkout_sessions (
        id SERIAL PRIMARY KEY,
        session_id VARCHAR(255) UNIQUE NOT NULL,
        square_order_id VARCHAR(255),
        square_payment_link_id VARCHAR(255),
        square_payment_link_url TEXT,
        plan_type VARCHAR(50) NOT NULL,
        amount_cents INTEGER NOT NULL,
        currency VARCHAR(3) DEFAULT 'CAD',
        farm_name VARCHAR(255) NOT NULL,
        contact_name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL,
        existing_farm_id VARCHAR(255),
        provisioned_farm_id VARCHAR(255),
        status VARCHAR(50) DEFAULT 'pending',
        payment_id VARCHAR(255),
        error_message TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        completed_at TIMESTAMPTZ,
        metadata JSONB DEFAULT '{}'
      )
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_checkout_sessions_email ON checkout_sessions(email)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_checkout_sessions_status ON checkout_sessions(status)`);
  } catch (err) {
    console.error('[Purchase] Failed to create checkout_sessions table:', err.message);
  }
}

/** Ensure purchase_leads table exists */
async function ensureLeadsTable() {
  if (!isDatabaseAvailable()) return;
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS purchase_leads (
        id SERIAL PRIMARY KEY,
        farm_name VARCHAR(255),
        contact_name VARCHAR(255),
        email VARCHAR(255) NOT NULL,
        plan VARCHAR(50),
        farm_id VARCHAR(255),
        status VARCHAR(50) DEFAULT 'new',
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_purchase_leads_email ON purchase_leads(email)`);
  } catch (err) {
    console.error('[Purchase] Failed to create purchase_leads table:', err.message);
  }
}

// Initialize tables on import (best-effort) and track if done
let _tablesReady = false;
async function ensureTables() {
  if (_tablesReady) return;
  await ensureCheckoutTable();
  await ensureLeadsTable();
  
  // Ensure farm_users + farms columns from migration 023 exist
  try {
    await query(`ALTER TABLE farm_users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT false`);
    await query(`ALTER TABLE farms ADD COLUMN IF NOT EXISTS setup_completed BOOLEAN DEFAULT false`);
    await query(`ALTER TABLE farms ADD COLUMN IF NOT EXISTS setup_completed_at TIMESTAMPTZ`);
    console.log('[Purchase] Migration 023 columns verified');
  } catch (e) {
    console.warn('[Purchase] Migration 023 column check:', e.message);
  }
  
  _tablesReady = true;
}
ensureCheckoutTable().catch(() => {});
ensureLeadsTable().catch(() => {});

// ═══════════════════════════════════════════════════════════════
// Plan definitions (internal — not exposed publicly)
// ═══════════════════════════════════════════════════════════════
const PLANS = {
  cloud: {
    name: 'Light Engine Base',
    type: 'cloud',
    amount_cents: 2900, // $29.00 CAD/mo — base plan
    currency: 'CAD',
    description: 'Light Engine Base — Monitoring, Inventory, POS, AI',
    line_item_name: 'Light Engine Base Subscription',
  },
  edge: {
    name: 'Light Engine Farm Server',
    type: 'edge',
    amount_cents: 2900, // $29.00 CAD/mo — base plan (same; hardware priced separately)
    currency: 'CAD',
    description: 'Light Engine Farm Server — On-Premises Automation',
    line_item_name: 'Light Engine Farm Server Subscription',
  },
};

// ═══════════════════════════════════════════════════════════════
// POST /api/farms/create-checkout-session
// Creates a Square Payment Link and returns the checkout URL
// ═══════════════════════════════════════════════════════════════
router.post('/api/farms/create-checkout-session', async (req, res) => {
  try {
    await ensureTables();
    const { plan, farm_name, contact_name, email, farm_id } = req.body;

    // Validate required fields
    if (!farm_name || !contact_name || !email) {
      return res.status(400).json({ ok: false, error: 'Farm name, contact name, and email are required' });
    }

    const planConfig = PLANS[plan] || PLANS.cloud;
    const locationId = process.env.SQUARE_LOCATION_ID;
    const client = await getSquareClient();

    if (!client || !locationId) {
      console.warn('[Purchase] Square not configured — using demo mode');
      // Demo/fallback mode: create a local session and redirect to success page
      const sessionId = `demo_${crypto.randomBytes(16).toString('hex')}`;

      if (isDatabaseAvailable()) {
        await query(
          `INSERT INTO checkout_sessions (session_id, plan_type, amount_cents, currency, farm_name, contact_name, email, existing_farm_id, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'demo')`,
          [sessionId, planConfig.type, planConfig.amount_cents, planConfig.currency, farm_name, contact_name, email, farm_id || null]
        );
      }

      return res.json({
        ok: true,
        sessionId,
        url: `/purchase-success.html?session_id=${sessionId}`,
        demo: true,
        note: 'Square not configured — demo checkout session created',
      });
    }

    // Check for duplicate email
    if (isDatabaseAvailable()) {
      const existing = await query('SELECT farm_id FROM farms WHERE email = $1', [email.toLowerCase()]);
      if (existing.rows.length > 0) {
        return res.status(409).json({
          ok: false,
          error: 'This email is already registered. Please sign in or use a different email.',
          existing_farm: existing.rows[0].farm_id,
        });
      }
    }

    // Create a unique idempotency key
    const idempotencyKey = crypto.randomUUID();
    const sessionId = `sq_${crypto.randomBytes(16).toString('hex')}`;

    // Build the Square Payment Link
    const baseUrl = process.env.BASE_URL || 'https://greenreachgreens.com';
    const redirectUrl = `${baseUrl}/purchase-success.html?session_id=${sessionId}`;

    console.log(`[Purchase] Creating Square payment link: ${planConfig.name}, $${(planConfig.amount_cents / 100).toFixed(2)} ${planConfig.currency}`);

    const response = await client.checkout.paymentLinks.create({
      idempotencyKey,
      paymentLink: {
        name: planConfig.line_item_name,
        description: `${planConfig.description} — ${farm_name}`,
        checkoutOptions: {
          redirectUrl,
          askForShippingAddress: false,
        },
      },
      quickPay: {
        name: planConfig.line_item_name,
        locationId,
        priceMoney: {
          amount: BigInt(planConfig.amount_cents),
          currency: planConfig.currency,
        },
      },
    });

    const paymentLink = response.paymentLink;
    const squareOrderId = paymentLink?.orderId || null;
    const squareUrl = paymentLink?.url || paymentLink?.longUrl;
    const squareLinkId = paymentLink?.id || null;

    console.log(`[Purchase] Payment link created: ${squareLinkId}, URL: ${squareUrl}, Order: ${squareOrderId}`);

    // Record the checkout session in DB
    if (isDatabaseAvailable()) {
      await query(
        `INSERT INTO checkout_sessions 
         (session_id, square_order_id, square_payment_link_id, square_payment_link_url, plan_type, amount_cents, currency, farm_name, contact_name, email, existing_farm_id, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending')`,
        [sessionId, squareOrderId, squareLinkId, squareUrl, planConfig.type, planConfig.amount_cents, planConfig.currency, farm_name, contact_name, email.toLowerCase(), farm_id || null]
      );
    }

    res.json({
      ok: true,
      sessionId,
      url: squareUrl,
      orderId: squareOrderId,
    });
  } catch (error) {
    console.error('[Purchase] create-checkout-session error:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to create checkout session. Please try again or contact support.',
      details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/farms/verify-session/:sessionId
// Verifies payment & provisions farm + user account
// ═══════════════════════════════════════════════════════════════
router.get('/api/farms/verify-session/:sessionId', async (req, res) => {
  try {
    await ensureTables();
    const { sessionId } = req.params;
    if (!sessionId) {
      return res.status(400).json({ success: false, error: 'Session ID is required' });
    }

    // Look up checkout session
    if (!isDatabaseAvailable()) {
      return res.status(503).json({ success: false, error: 'Database unavailable' });
    }

    const sessionResult = await query('SELECT * FROM checkout_sessions WHERE session_id = $1', [sessionId]);
    if (sessionResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Checkout session not found' });
    }

    const session = sessionResult.rows[0];

    // If already completed, return the existing farm info
    if (session.status === 'completed' && session.provisioned_farm_id) {
      const farmResult = await query('SELECT * FROM farms WHERE farm_id = $1', [session.provisioned_farm_id]);
      const farm = farmResult.rows[0];
      const token = generateFarmJwt(session.provisioned_farm_id, session.email, farm?.jwt_secret);

      return res.json({
        success: true,
        already_completed: true,
        token,
        farm_id: session.provisioned_farm_id,
        email: session.email,
        plan_type: session.plan_type,
        farm_name: session.farm_name,
      });
    }

    // Demo mode — skip Square verification, provision immediately
    if (session.status === 'demo') {
      console.log(`[Purchase] Demo session ${sessionId} — provisioning without payment verification`);
      const result = await provisionFarmAndUser(session);
      if (!result.success) {
        return res.status(500).json({ success: false, error: result.error });
      }

      // Send welcome email for new demo accounts too
      if (!result.existing_account && result.temp_password) {
        try {
          const emailResult = await sendWelcomeEmail({
            email: result.email,
            farmId: result.farm_id,
            farmName: result.farm_name,
            contactName: session.contact_name,
            tempPassword: result.temp_password,
            planType: result.plan_type,
          });
          result.email_sent = emailResult.sent;
          if (!emailResult.sent) {
            console.warn(`[Purchase] Welcome email failed for ${result.email}: ${emailResult.error}`);
          }
        } catch (emailErr) {
          console.error(`[Purchase] Welcome email error:`, emailErr.message);
          result.email_sent = false;
        }
      } else {
        result.email_sent = false;
      }

      return res.json(result);
    }

    // Verify payment with Square
    const client = await getSquareClient();
    if (!client) {
      return res.status(503).json({ success: false, error: 'Payment system unavailable' });
    }

    // Check the Square order status
    let orderPaid = false;
    let paymentId = null;

    if (session.square_order_id) {
      try {
        const orderResponse = await client.orders.get({
          orderId: session.square_order_id,
        });
        const order = orderResponse.order;
        console.log(`[Purchase] Square order ${session.square_order_id} state: ${order?.state}`);

        if (order?.state === 'COMPLETED') {
          orderPaid = true;
          // Extract payment ID from tenders
          if (order.tenders && order.tenders.length > 0) {
            paymentId = order.tenders[0].paymentId || order.tenders[0].id;
          }
        } else if (order?.state === 'OPEN') {
          // Order exists but payment not yet completed — check for payment in net amounts
          if (order.netAmountDueMoney?.amount === 0n || order.netAmountDueMoney?.amount === BigInt(0)) {
            orderPaid = true;
          }
        }
      } catch (sqErr) {
        console.error(`[Purchase] Square order check failed:`, sqErr.message);
      }
    }

    if (!orderPaid) {
      return res.status(402).json({
        success: false,
        error: 'Payment not yet completed. Please complete payment or try again.',
        status: 'payment_pending',
      });
    }

    // Payment verified — provision farm and user
    console.log(`[Purchase] Payment verified for session ${sessionId} — provisioning farm`);

    // Update session with payment info
    await query(
      `UPDATE checkout_sessions SET payment_id = $1, status = 'paid' WHERE session_id = $2`,
      [paymentId, sessionId]
    );

    const result = await provisionFarmAndUser(session);
    if (!result.success) {
      return res.status(500).json({ success: false, error: result.error });
    }

    // Send welcome email for new accounts (non-blocking)
    if (!result.existing_account && result.temp_password) {
      try {
        const emailResult = await sendWelcomeEmail({
          email: result.email,
          farmId: result.farm_id,
          farmName: result.farm_name,
          contactName: session.contact_name,
          tempPassword: result.temp_password,
          planType: result.plan_type,
        });
        result.email_sent = emailResult.sent;
        if (!emailResult.sent) {
          console.warn(`[Purchase] Welcome email failed for ${result.email}: ${emailResult.error}`);
        }
      } catch (emailErr) {
        console.error(`[Purchase] Welcome email error:`, emailErr.message);
        result.email_sent = false;
      }
    } else {
      result.email_sent = false;
    }

    res.json(result);
  } catch (error) {
    console.error('[Purchase] verify-session error:', error);
    res.status(500).json({ success: false, error: 'Verification failed. Please contact support.' });
  }
});

// ═══════════════════════════════════════════════════════════════
// Farm + User Provisioning
// ═══════════════════════════════════════════════════════════════
async function provisionFarmAndUser(session) {
  const { session_id, email, farm_name, contact_name, plan_type, existing_farm_id } = session;

  try {
    // 1. Check for duplicate email in farms
    const existingFarm = await query('SELECT farm_id FROM farms WHERE email = $1', [email.toLowerCase()]);
    if (existingFarm.rows.length > 0) {
      // Already has a farm — return login info instead of creating duplicate
      const farmId = existingFarm.rows[0].farm_id;
      const farm = (await query('SELECT * FROM farms WHERE farm_id = $1', [farmId])).rows[0];
      const token = generateFarmJwt(farmId, email, farm?.jwt_secret);

      await query(
        `UPDATE checkout_sessions SET status = 'completed', provisioned_farm_id = $1, completed_at = NOW() WHERE session_id = $2`,
        [farmId, session_id]
      );

      return {
        success: true,
        existing_account: true,
        token,
        farm_id: farmId,
        email: email.toLowerCase(),
        plan_type: farm?.plan_type || plan_type,
        farm_name: farm?.name || farm_name,
        message: 'Account already exists — logged in to existing farm.',
      };
    }

    // 2. Generate farm ID and secrets
    const farmId = existing_farm_id || generateFarmId();
    const secrets = generateFarmSecrets();
    const tempPassword = generateTempPassword();

    // 3. Hash password
    const passwordHash = await bcryptjs.hash(tempPassword, 10);

    // 4. Create farm record
    const slug = farm_name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').substring(0, 50);
    const uniqueSlug = `${slug}-${crypto.randomBytes(2).toString('hex')}`;

    await query(
      `INSERT INTO farms (farm_id, name, email, contact_name, status, plan_type, slug, jwt_secret, api_key, api_secret, metadata, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'active', $5, $6, $7, $8, $9, $10, NOW(), NOW())
       ON CONFLICT (farm_id) DO UPDATE SET
         name = EXCLUDED.name,
         email = EXCLUDED.email,
         contact_name = EXCLUDED.contact_name,
         plan_type = EXCLUDED.plan_type,
         slug = EXCLUDED.slug,
         updated_at = NOW()`,
      [farmId, farm_name, email.toLowerCase(), contact_name, plan_type, uniqueSlug, secrets.jwtSecret, secrets.apiKey, secrets.apiSecret,
       JSON.stringify({ provisioned_by: 'purchase', session_id, provisioned_at: new Date().toISOString() })]
    );

    // 5. Create farm user (admin)
    const nameParts = contact_name.trim().split(/\s+/);
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || '';

    await query(
      `INSERT INTO farm_users (id, farm_id, email, first_name, last_name, role, password_hash, status, must_change_password, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'admin', $6, 'active', true, NOW(), NOW())
       ON CONFLICT (farm_id, email) DO UPDATE SET
         first_name = EXCLUDED.first_name,
         last_name = EXCLUDED.last_name,
         role = 'admin',
         password_hash = EXCLUDED.password_hash,
         must_change_password = true,
         updated_at = NOW()`,
      [crypto.randomUUID(), farmId, email.toLowerCase(), firstName, lastName, passwordHash]
    );

    // 6. Record payment in payment_records
    const paymentRecordId = `purchase_${crypto.randomBytes(8).toString('hex')}`;
    try {
      await query(
        `INSERT INTO payment_records (payment_id, order_id, amount, currency, provider, status, metadata, created_at)
         VALUES ($1, $2, $3, $4, 'square', 'completed', $5, NOW())`,
        [paymentRecordId, session.session_id, (session.amount_cents / 100).toFixed(2), session.currency || 'CAD',
         JSON.stringify({ session_id: session.session_id, plan_type, farm_id: farmId, square_order_id: session.square_order_id })]
      );
    } catch (prErr) {
      console.warn('[Purchase] payment_records insert failed (non-critical):', prErr.message);
    }

    // 7. Update checkout session to completed
    await query(
      `UPDATE checkout_sessions SET status = 'completed', provisioned_farm_id = $1, completed_at = NOW() WHERE session_id = $2`,
      [farmId, session.session_id]
    );

    // 8. Generate JWT for auto-login
    const token = generateFarmJwt(farmId, email, secrets.jwtSecret);

    console.log(`[Purchase] Farm provisioned: ${farmId} (${farm_name}) for ${email}, plan: ${plan_type}`);
    console.log(`[Purchase] Temp password for ${email}: ${tempPassword}`);

    return {
      success: true,
      token,
      farm_id: farmId,
      email: email.toLowerCase(),
      plan_type,
      farm_name,
      temp_password: tempPassword,
      message: 'Your farm account has been created successfully.',
    };
  } catch (error) {
    console.error('[Purchase] Provisioning error:', error);

    // Record error in session
    try {
      await query(
        `UPDATE checkout_sessions SET status = 'error', error_message = $1 WHERE session_id = $2`,
        [error.message, session_id]
      );
    } catch { /* ignore */ }

    return {
      success: false,
      error: 'Failed to create your farm account. Please contact support at info@greenreachfarms.com',
    };
  }
}

/** Generate a JWT for farm auto-login */
function generateFarmJwt(farmId, email, farmJwtSecret) {
  try {
    const secret = farmJwtSecret || process.env.JWT_SECRET || 'fallback-secret';
    return jwt.sign(
      {
        farm_id: farmId,
        email: email.toLowerCase(),
        role: 'admin',
        type: 'farm-user',
        user_id: email.toLowerCase(),
      },
      secret,
      {
        expiresIn: '7d',
        audience: 'greenreach-farms',
        issuer: 'greenreach-central',
      }
    );
  } catch (err) {
    console.error('[Purchase] JWT generation failed:', err.message);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// POST /api/farms/verify-id — Validate an existing Farm ID
// ═══════════════════════════════════════════════════════════════
router.post('/api/farms/verify-id', async (req, res) => {
  try {
    const { farm_id } = req.body;
    if (!farm_id) {
      return res.status(400).json({ valid: false, message: 'Farm ID is required' });
    }

    if (!isDatabaseAvailable()) {
      return res.json({ valid: false, message: 'Unable to verify Farm ID at this time' });
    }

    const result = await query('SELECT farm_id, name, plan_type FROM farms WHERE farm_id = $1', [farm_id]);
    if (result.rows.length > 0) {
      return res.json({
        valid: true,
        farm_name: result.rows[0].name,
        plan_type: result.rows[0].plan_type,
        message: 'Farm ID verified successfully',
      });
    }

    res.json({ valid: false, message: 'Farm ID not found. Please check your Farm ID or leave blank for new registration.' });
  } catch (error) {
    console.error('[Purchase] verify-id error:', error);
    res.status(500).json({ valid: false, message: 'Unable to verify Farm ID at this time' });
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /api/purchase/leads — CRM lead capture for pre-orders
// ═══════════════════════════════════════════════════════════════
router.post('/api/purchase/leads', async (req, res) => {
  try {
    await ensureTables();
    const { farmName, contactName, email, plan, farmId } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, error: 'Email is required' });
    }

    console.log(`[Purchase] Lead captured: ${email} (${contactName}) — ${plan || 'unknown'} plan`);

    if (isDatabaseAvailable()) {
      await query(
        `INSERT INTO purchase_leads (farm_name, contact_name, email, plan, farm_id, status, created_at)
         VALUES ($1, $2, $3, $4, $5, 'new', NOW())
         ON CONFLICT DO NOTHING`,
        [farmName || null, contactName || null, email.toLowerCase(), plan || 'cloud', farmId || null]
      );
    }

    res.json({
      success: true,
      message: 'Your request has been received. Our team will contact you within 1-2 business days.',
    });
  } catch (error) {
    console.error('[Purchase] leads error:', error);
    res.status(500).json({ success: false, error: 'Failed to submit your request. Please try again.' });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/purchase/status — Check Square configuration status
// (admin diagnostic endpoint)
// ═══════════════════════════════════════════════════════════════
router.get('/api/purchase/status', async (req, res) => {
  const client = await getSquareClient();
  const locationId = process.env.SQUARE_LOCATION_ID;
  
  const status = {
    square_configured: !!client && !!locationId,
    square_environment: process.env.SQUARE_ENVIRONMENT || 'sandbox',
    has_access_token: !!process.env.SQUARE_ACCESS_TOKEN,
    has_location_id: !!locationId,
    database_available: isDatabaseAvailable(),
    plans: Object.keys(PLANS).map(k => ({ 
      key: k, 
      name: PLANS[k].name, 
      amount: `$${(PLANS[k].amount_cents / 100).toFixed(2)} ${PLANS[k].currency}` 
    })),
  };

  // If Square is configured, verify the location
  if (client && locationId) {
    try {
      const locResponse = await client.locations.get({ locationId });
      status.location = {
        name: locResponse.location?.name,
        status: locResponse.location?.status,
        country: locResponse.location?.country,
        currency: locResponse.location?.currency,
      };
    } catch (err) {
      status.location_error = err.message;
    }
  }

  // Count checkout sessions
  if (isDatabaseAvailable()) {
    try {
      const counts = await query(`
        SELECT status, COUNT(*) as count 
        FROM checkout_sessions 
        GROUP BY status
      `);
      status.sessions = counts.rows.reduce((acc, r) => { acc[r.status] = parseInt(r.count); return acc; }, {});
    } catch { 
      status.sessions = 'table not yet created';
    }
  }

  res.json(status);
});

// ═══════════════════════════════════════════════════════════════
// DELETE /api/purchase/farm/:farmId — Delete a test farm and its user
// (admin diagnostic endpoint — requires admin Bearer token)
// ═══════════════════════════════════════════════════════════════
router.delete('/api/purchase/farm/:farmId', adminAuthMiddleware, async (req, res) => {
  const { farmId } = req.params;

  if (!farmId || !farmId.startsWith('FARM-')) {
    return res.status(400).json({ success: false, error: 'Invalid farm ID format' });
  }

  if (!isDatabaseAvailable()) {
    return res.status(503).json({ success: false, error: 'Database not available' });
  }

  try {
    // Delete in order: farm_users → checkout_sessions → payment_records → farms
    const results = {};

    try {
      const r = await query('DELETE FROM farm_users WHERE farm_id = $1', [farmId]);
      results.farm_users_deleted = r.rowCount;
    } catch (e) { results.farm_users_error = e.message; }

    try {
      const r = await query('DELETE FROM checkout_sessions WHERE provisioned_farm_id = $1', [farmId]);
      results.checkout_sessions_deleted = r.rowCount;
    } catch (e) { results.checkout_sessions_error = e.message; }

    try {
      const r = await query('DELETE FROM payment_records WHERE metadata::text LIKE $1', [`%${farmId}%`]);
      results.payment_records_deleted = r.rowCount;
    } catch (e) { results.payment_records_error = e.message; }

    try {
      const r = await query('DELETE FROM farms WHERE farm_id = $1', [farmId]);
      results.farms_deleted = r.rowCount;
    } catch (e) { results.farms_error = e.message; }

    console.log(`[Purchase] Farm deleted: ${farmId}`, results);
    res.json({ success: true, farmId, results });
  } catch (error) {
    console.error('[Purchase] Farm delete error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/purchase/sessions — List checkout sessions (admin diagnostic)
// ═══════════════════════════════════════════════════════════════
router.get('/api/purchase/sessions', adminAuthMiddleware, async (req, res) => {
  if (!isDatabaseAvailable()) {
    return res.status(503).json({ success: false, error: 'Database not available' });
  }
  try {
    const result = await query(
      `SELECT session_id, square_order_id, square_payment_link_id, plan_type, amount_cents, currency, 
              farm_name, contact_name, email, status, provisioned_farm_id, payment_id, error_message, created_at, completed_at
       FROM checkout_sessions ORDER BY created_at DESC`
    );
    res.json({ success: true, sessions: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /api/purchase/manual-verify/:sessionId — Admin: force-verify a session
// ═══════════════════════════════════════════════════════════════
router.post('/api/purchase/manual-verify/:sessionId', adminAuthMiddleware, async (req, res) => {

  try {
    await ensureTables();
    const { sessionId } = req.params;

    if (!isDatabaseAvailable()) {
      return res.status(503).json({ success: false, error: 'Database unavailable' });
    }

    const sessionResult = await query('SELECT * FROM checkout_sessions WHERE session_id = $1', [sessionId]);
    if (sessionResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Checkout session not found' });
    }

    const session = sessionResult.rows[0];

    // If already completed, return existing info
    if (session.status === 'completed' && session.provisioned_farm_id) {
      return res.json({ success: true, already_completed: true, farm_id: session.provisioned_farm_id });
    }

    // Check Square order status
    const client = await getSquareClient();
    let orderPaid = false;
    let paymentId = null;

    if (client && session.square_order_id) {
      try {
        const orderResponse = await client.orders.get({ orderId: session.square_order_id });
        const order = orderResponse.order;
        console.log(`[Purchase] Manual verify — Square order ${session.square_order_id} state: ${order?.state}`);

        if (order?.state === 'COMPLETED') {
          orderPaid = true;
          if (order.tenders && order.tenders.length > 0) {
            paymentId = order.tenders[0].paymentId || order.tenders[0].id;
          }
        } else if (order?.state === 'OPEN') {
          if (order.netAmountDueMoney?.amount === 0n || order.netAmountDueMoney?.amount === BigInt(0)) {
            orderPaid = true;
          }
        }
      } catch (sqErr) {
        console.error(`[Purchase] Manual verify — Square order check failed:`, sqErr.message);
      }
    }

    if (!orderPaid) {
      // Admin force override if ?force=true
      if (req.query.force === 'true') {
        console.log(`[Purchase] Manual verify — FORCE provisioning session ${sessionId} (payment not confirmed)`);
      } else {
        return res.status(402).json({
          success: false,
          error: 'Payment not confirmed by Square. Add ?force=true to override.',
          square_order_id: session.square_order_id,
        });
      }
    }

    // Update payment info
    if (paymentId) {
      await query(`UPDATE checkout_sessions SET payment_id = $1, status = 'paid' WHERE session_id = $2`, [paymentId, sessionId]);
    }

    // Provision the farm
    const result = await provisionFarmAndUser(session);
    if (!result.success) {
      return res.status(500).json({ success: false, error: result.error });
    }

    // Send welcome email
    if (!result.existing_account && result.temp_password) {
      try {
        const emailResult = await sendWelcomeEmail({
          email: result.email,
          farmId: result.farm_id,
          farmName: result.farm_name,
          contactName: session.contact_name,
          tempPassword: result.temp_password,
          planType: result.plan_type,
        });
        result.email_sent = emailResult.sent;
      } catch (emailErr) {
        console.error(`[Purchase] Manual verify — email error:`, emailErr.message);
        result.email_sent = false;
      }
    }

    console.log(`[Purchase] Manual verify — farm provisioned: ${result.farm_id} (${result.farm_name})`);
    res.json(result);
  } catch (error) {
    console.error('[Purchase] manual-verify error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /api/purchase/recover — User-facing: recover a payment session by email
// (For when Square redirect fails — user can re-trigger verification)
// ═══════════════════════════════════════════════════════════════
router.post('/api/purchase/recover', async (req, res) => {
  try {
    await ensureTables();
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, error: 'Email is required' });
    }

    if (!isDatabaseAvailable()) {
      return res.status(503).json({ success: false, error: 'Database unavailable' });
    }

    // Find the most recent pending/paid session for this email
    const sessionResult = await query(
      `SELECT * FROM checkout_sessions 
       WHERE email = $1 AND status IN ('pending', 'paid')
       ORDER BY created_at DESC LIMIT 1`,
      [email.toLowerCase()]
    );

    if (sessionResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No pending payment found for this email. Please contact support if you believe this is an error.',
      });
    }

    const session = sessionResult.rows[0];

    // Check if already provisioned under a different session
    const existingFarm = await query('SELECT farm_id, name FROM farms WHERE email = $1', [email.toLowerCase()]);
    if (existingFarm.rows.length > 0) {
      return res.json({
        success: true,
        already_provisioned: true,
        farm_id: existingFarm.rows[0].farm_id,
        farm_name: existingFarm.rows[0].name,
        message: 'Your farm account already exists. Please log in with your Farm ID.',
      });
    }

    // Try to verify with Square
    const client = await getSquareClient();
    let orderPaid = false;
    let paymentId = null;

    if (client && session.square_order_id) {
      try {
        const orderResponse = await client.orders.get({ orderId: session.square_order_id });
        const order = orderResponse.order;
        console.log(`[Purchase] Recovery — Square order ${session.square_order_id} state: ${order?.state}`);

        if (order?.state === 'COMPLETED') {
          orderPaid = true;
          if (order.tenders && order.tenders.length > 0) {
            paymentId = order.tenders[0].paymentId || order.tenders[0].id;
          }
        } else if (order?.state === 'OPEN') {
          if (order.netAmountDueMoney?.amount === 0n || order.netAmountDueMoney?.amount === BigInt(0)) {
            orderPaid = true;
          }
        }
      } catch (sqErr) {
        console.error(`[Purchase] Recovery — Square check failed:`, sqErr.message);
      }
    }

    if (!orderPaid) {
      return res.status(402).json({
        success: false,
        error: 'Payment not yet confirmed. If you completed payment, please wait a few minutes and try again.',
        status: 'payment_pending',
      });
    }

    // Payment is confirmed — provision
    console.log(`[Purchase] Recovery — payment confirmed, provisioning farm for ${email}`);

    if (paymentId) {
      await query(`UPDATE checkout_sessions SET payment_id = $1, status = 'paid' WHERE session_id = $2`, [paymentId, session.session_id]);
    }

    const result = await provisionFarmAndUser(session);
    if (!result.success) {
      return res.status(500).json({ success: false, error: result.error });
    }

    // Send welcome email
    if (!result.existing_account && result.temp_password) {
      try {
        const emailResult = await sendWelcomeEmail({
          email: result.email,
          farmId: result.farm_id,
          farmName: result.farm_name,
          contactName: session.contact_name,
          tempPassword: result.temp_password,
          planType: result.plan_type,
        });
        result.email_sent = emailResult.sent;
      } catch (emailErr) {
        console.error(`[Purchase] Recovery email error:`, emailErr.message);
        result.email_sent = false;
      }
    }

    res.json(result);
  } catch (error) {
    console.error('[Purchase] recover error:', error);
    res.status(500).json({ success: false, error: 'Recovery failed. Please contact support.' });
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /api/purchase/webhook — Square webhook for payment.completed events
// (Reliable server-side fallback when browser redirect fails)
// ═══════════════════════════════════════════════════════════════
router.post('/api/purchase/webhook', async (req, res) => {
  try {
    const event = req.body;
    const eventType = event?.type;

    console.log(`[Webhook] Received Square event: ${eventType}`);

    // Acknowledge receipt immediately (Square expects 200 within 10s)
    res.status(200).json({ received: true });

    // Only process payment.completed and order.updated events
    if (eventType !== 'payment.completed' && eventType !== 'order.updated') {
      return;
    }

    if (!isDatabaseAvailable()) {
      console.error('[Webhook] Database unavailable — cannot process event');
      return;
    }

    await ensureTables();

    let orderId = null;
    let paymentId = null;

    if (eventType === 'payment.completed') {
      const payment = event?.data?.object?.payment;
      orderId = payment?.orderId || payment?.order_id;
      paymentId = payment?.id;
      console.log(`[Webhook] Payment completed: ${paymentId}, Order: ${orderId}`);
    } else if (eventType === 'order.updated') {
      const order = event?.data?.object?.order;
      orderId = order?.id;
      if (order?.state !== 'COMPLETED') {
        console.log(`[Webhook] Order ${orderId} state: ${order?.state} — skipping`);
        return;
      }
      console.log(`[Webhook] Order completed: ${orderId}`);
    }

    if (!orderId) {
      console.log('[Webhook] No order ID in event — skipping');
      return;
    }

    // Find the checkout session by Square order ID
    const sessionResult = await query(
      `SELECT * FROM checkout_sessions WHERE square_order_id = $1 AND status IN ('pending', 'paid')`,
      [orderId]
    );

    if (sessionResult.rows.length === 0) {
      console.log(`[Webhook] No pending session found for order ${orderId}`);
      return;
    }

    const session = sessionResult.rows[0];

    // Check if farm already provisioned
    if (session.provisioned_farm_id) {
      console.log(`[Webhook] Session ${session.session_id} already provisioned: ${session.provisioned_farm_id}`);
      return;
    }

    console.log(`[Webhook] Provisioning farm for session ${session.session_id} (${session.farm_name})`);

    // Update payment info
    if (paymentId) {
      await query(`UPDATE checkout_sessions SET payment_id = $1, status = 'paid' WHERE session_id = $2`, [paymentId, session.session_id]);
    }

    // Provision the farm
    const result = await provisionFarmAndUser(session);
    if (!result.success) {
      console.error(`[Webhook] Provisioning failed for ${session.session_id}:`, result.error);
      return;
    }

    // Send welcome email
    if (!result.existing_account && result.temp_password) {
      try {
        const emailResult = await sendWelcomeEmail({
          email: result.email,
          farmId: result.farm_id,
          farmName: result.farm_name,
          contactName: session.contact_name,
          tempPassword: result.temp_password,
          planType: result.plan_type,
        });
        console.log(`[Webhook] Welcome email sent: ${emailResult.sent}`);
      } catch (emailErr) {
        console.error(`[Webhook] Email error:`, emailErr.message);
      }
    }

    console.log(`[Webhook] Farm provisioned via webhook: ${result.farm_id} (${result.farm_name})`);
  } catch (error) {
    console.error('[Webhook] Processing error:', error);
    // Don't return error — we already sent 200
  }
});

// ═══════════════════════════════════════════════════════════════
// PATCH /api/purchase/farm/:farmId — Update farm details (admin)
// ═══════════════════════════════════════════════════════════════
router.patch('/api/purchase/farm/:farmId', adminAuthMiddleware, async (req, res) => {
  const { farmId } = req.params;
  const { name, contact_name, email } = req.body;

  if (!isDatabaseAvailable()) {
    return res.status(503).json({ success: false, error: 'Database not available' });
  }
  try {
    const updates = [];
    const values = [];
    let idx = 1;

    if (name) { updates.push(`name = $${idx++}`); values.push(name); }
    if (contact_name) { updates.push(`contact_name = $${idx++}`); values.push(contact_name); }
    if (email) { updates.push(`email = $${idx++}`); values.push(email.toLowerCase()); }
    updates.push(`updated_at = NOW()`);

    if (updates.length <= 1) {
      return res.status(400).json({ success: false, error: 'No fields to update' });
    }

    values.push(farmId);
    const result = await query(
      `UPDATE farms SET ${updates.join(', ')} WHERE farm_id = $${idx}`,
      values
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Farm not found' });
    }

    console.log(`[Purchase] Farm ${farmId} updated:`, { name, contact_name, email });
    res.json({ success: true, farmId, updated: { name, contact_name, email } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/purchase/farms — List all provisioned farms (admin diagnostic)
// ═══════════════════════════════════════════════════════════════
router.get('/api/purchase/farms', adminAuthMiddleware, async (req, res) => {
  if (!isDatabaseAvailable()) {
    return res.status(503).json({ success: false, error: 'Database not available' });
  }
  try {
    const result = await query('SELECT farm_id, name, email, contact_name, plan_type, status, setup_completed, created_at FROM farms ORDER BY created_at DESC');
    res.json({ success: true, farms: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /api/purchase/fix-admin-role — Fix admin_users role (one-time diagnostic)
// ═══════════════════════════════════════════════════════════════
router.post('/api/purchase/fix-admin-role', adminAuthMiddleware, async (req, res) => {
  if (!isDatabaseAvailable()) {
    return res.status(503).json({ success: false, error: 'Database not available' });
  }
  try {
    const { email, role } = req.body;
    if (!email || !role) {
      return res.status(400).json({ success: false, error: 'email and role are required' });
    }
    const validRoles = ['admin', 'operations', 'support', 'viewer'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ success: false, error: `Invalid role. Must be one of: ${validRoles.join(', ')}` });
    }

    // Check current role
    const current = await query('SELECT id, email, name, role FROM admin_users WHERE email = $1', [email.toLowerCase()]);
    if (current.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Admin user not found' });
    }

    const oldRole = current.rows[0].role;
    await query('UPDATE admin_users SET role = $1 WHERE email = $2', [role, email.toLowerCase()]);
    
    // Also clear any existing sessions so user gets a fresh token with the new role
    try {
      await query('DELETE FROM admin_sessions WHERE admin_id = $1', [current.rows[0].id]);
    } catch (e) { /* non-critical */ }

    console.log(`[Purchase] Admin role fix: ${email} changed from '${oldRole}' to '${role}'`);
    res.json({ success: true, email, oldRole, newRole: role, message: 'Role updated. Please log out and log back in.' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
