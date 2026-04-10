/**
 * Farm Sales Routes
 * Stubs for the farm-sales subsystem used by:
 *   - farm-sales-landing.html, farm-sales-pos.html, farm-sales-store.html, farm-sales-shop.html
 *   - farm-admin.js (orders, QuickBooks, delivery settings)
 *   - farm-summary.html (inventory)
 *
 * Endpoints:
 *   GET  /api/config/app                       - App config (farm mode, features)
 *   GET  /api/farm-auth/demo-tokens            - Demo auth tokens for POS/store
 *   GET  /api/farm-sales/orders                - Farm direct-sales orders
 *   GET  /api/farm-sales/inventory             - Farm retail inventory
 *   GET  /api/farm-sales/inventory/export       - Inventory CSV export
 *   GET  /api/farm-sales/reports/sales-export   - Sales transaction CSV export
 *   GET  /api/farm-sales/reports/quickbooks-daily-summary - QuickBooks daily CSV
 *   GET  /api/farm-sales/subscriptions/plans   - Subscription plans
 *   GET  /api/farm-sales/quickbooks/status     - QuickBooks integration status
 *   POST /api/farm-sales/quickbooks/auth       - QuickBooks OAuth start
 *   POST /api/farm-sales/quickbooks/disconnect - Disconnect QuickBooks
 *   POST /api/farm-sales/quickbooks/sync-*     - QuickBooks sync operations
 *   GET  /api/farm-sales/ai-agent/status       - AI agent status
 *   POST /api/farm-sales/ai-agent/chat         - AI agent chat
 *   GET  /api/farm-sales/delivery/config       - Get delivery settings + windows
 *   PUT  /api/farm-sales/delivery/config       - Update delivery settings
 *   PUT  /api/farm-sales/delivery/windows      - Bulk upsert delivery windows
 *   GET  /api/demo/intro-cards                 - Demo intro card data
 */
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { randomBytes } from 'crypto';
import { query, isDatabaseAvailable } from '../config/database.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();
async function ensureDeliveryTables() {
  await query(`
    CREATE TABLE IF NOT EXISTS farm_delivery_settings (
      id SERIAL PRIMARY KEY,
      farm_id VARCHAR(255) NOT NULL,
      enabled BOOLEAN DEFAULT FALSE,
      base_fee NUMERIC(10,2) DEFAULT 0,
      min_order NUMERIC(10,2) DEFAULT 25,
      lead_time_hours INTEGER DEFAULT 24,
      max_deliveries_per_window INTEGER DEFAULT 20,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(farm_id)
    );

    CREATE INDEX IF NOT EXISTS idx_farm_delivery_settings_farm ON farm_delivery_settings(farm_id);

    CREATE TABLE IF NOT EXISTS farm_delivery_windows (
      id SERIAL PRIMARY KEY,
      farm_id VARCHAR(255) NOT NULL,
      window_id VARCHAR(50) NOT NULL,
      label VARCHAR(255),
      start_time VARCHAR(10),
      end_time VARCHAR(10),
      active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(farm_id, window_id)
    );

    CREATE INDEX IF NOT EXISTS idx_farm_delivery_windows_farm ON farm_delivery_windows(farm_id);
  `);
}

function getJwtSecret() {
  if (!process.env.JWT_SECRET && (process.env.NODE_ENV === 'production' || process.env.DEPLOYMENT_MODE === 'cloud')) {
    throw new Error('JWT_SECRET environment variable is required in production');
  }
  return process.env.JWT_SECRET || randomBytes(32).toString('hex');
}
const JWT_SECRET = getJwtSecret();

// ─── App Config ────────────────────────────────────────────
// GET /api/config/app — returns feature flags & farm mode
router.get('/config/app', (req, res) => {
  const farmId = req.farmId || 'default';
  res.json({
    success: true,
    config: {
      farmId,
      mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
      features: {
        wholesale: true,
        farmSales: true,
        pos: true,
        subscriptions: false,
        quickbooks: false,
        square: false,
        aiAgent: false,
      },
      currency: 'CAD',
      timezone: 'America/Toronto',
      version: '1.0.0',
    }
  });
});

// ─── Demo Tokens ───────────────────────────────────────────
// GET /api/farm-auth/demo-tokens -- demo/dev auth tokens for POS
// Gated to non-production to prevent unauthenticated token issuance.
router.get('/farm-auth/demo-tokens', (req, res) => {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEMO_TOKENS !== 'true') {
    return res.status(403).json({ success: false, error: 'Demo tokens disabled in production' });
  }
  const farmId = req.farmId || 'demo-farm';
  const token = jwt.sign(
    { farm_id: farmId, role: 'pos', type: 'demo-token', user_id: 'demo-user' },
    JWT_SECRET,
    { expiresIn: '24h', audience: 'greenreach-farms', issuer: 'greenreach-central' }
  );
  res.json({
    success: true,
    tokens: {
      pos: token,
      store: token,
      admin: token,
    },
    farm_id: farmId,
    expiresIn: '24h',
  });
});

// ─── POS Checkout ──────────────────────────────────────────
// POST /api/farm-sales/pos/checkout — process a point-of-sale transaction
router.post('/farm-sales/pos/checkout', authMiddleware, async (req, res) => {
  try {
    const farmId = req.farmId;
    if (!farmId) {
      return res.status(400).json({ success: false, error: 'Farm ID not resolved' });
    }

    const { items, payment, customer, cashier } = req.body || {};

    // ── Validate input ──────────────────────────────────────
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: 'Cart is empty' });
    }
    if (!payment || !payment.method) {
      return res.status(400).json({ success: false, error: 'Payment method is required' });
    }
    const validMethods = ['cash', 'card', 'gift_card'];
    if (!validMethods.includes(payment.method)) {
      return res.status(400).json({ success: false, error: 'Invalid payment method' });
    }

    // ── Resolve inventory & compute totals ──────────────────
    let inventory = [];
    if (isDatabaseAvailable()) {
      try {
        const result = await query('SELECT * FROM farm_inventory WHERE farm_id = $1', [farmId]);
        if (result.rows.length) inventory = result.rows;
      } catch { /* table may not exist */ }
    }
    if (!inventory.length && req.farmStore) {
      const stored = await req.farmStore.get(farmId, 'inventory');
      if (Array.isArray(stored)) inventory = stored;
    }

    const lineItems = [];
    let subtotal = 0;
    let taxableSubtotal = 0;

    // Build crop pricing lookup for fallback when farm_inventory prices are $0
    let cropPriceMap = null;
    async function getCropPriceMap() {
      if (cropPriceMap) return cropPriceMap;
      cropPriceMap = {};
      try {
        const pricingData = req.farmStore ? await req.farmStore.get(farmId, 'crop_pricing') : null;
        if (pricingData?.crops?.length) {
          for (const c of pricingData.crops) {
            if (c.crop && c.retailPrice) cropPriceMap[c.crop.toLowerCase()] = Number(c.retailPrice);
          }
        }
      } catch { /* crop_pricing unavailable */ }
      return cropPriceMap;
    }

    for (const cartItem of items) {
      const product = inventory.find(
        p => (p.sku_id || p.sku || p.product_id) === cartItem.sku_id
      );
      if (!product) {
        return res.status(400).json({ success: false, error: `Product not found: ${cartItem.sku_id}` });
      }
      const qty = Math.max(1, parseInt(cartItem.quantity) || 1);
      let unitPrice = Number(product.retail_price || product.price || product.unit_price || 0);

      // Fallback: if inventory has no price, check the Crop Pricing page
      if (unitPrice === 0) {
        const cpm = await getCropPriceMap();
        const pName = (product.product_name || product.name || '').toLowerCase();
        if (cpm[pName]) unitPrice = cpm[pName];
      }

      const lineTotal = unitPrice * qty;
      subtotal += lineTotal;
      if (product.is_taxable) taxableSubtotal += lineTotal;

      lineItems.push({
        sku_id: cartItem.sku_id,
        name: product.name || product.product_name || cartItem.sku_id,
        quantity: qty,
        unit_price: unitPrice,
        line_total: lineTotal,
        is_taxable: !!product.is_taxable,
        lot_code: product.lot_code || null,
      });
    }

    const taxRate = 0.08;
    const tax = Math.round(taxableSubtotal * taxRate * 100) / 100;
    const total = Math.round((subtotal + tax) * 100) / 100;

    // ── Generate order ID ───────────────────────────────────
    const orderId = `POS-${farmId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    // ── Process payment ─────────────────────────────────────
    let paymentRecord = {
      method: payment.method,
      status: 'completed',
      amount: total,
      currency: 'CAD',
    };

    if (payment.method === 'cash') {
      const tendered = Number(payment.tendered) || 0;
      if (tendered < total) {
        return res.status(400).json({ success: false, error: 'Insufficient cash tendered' });
      }
      paymentRecord.tendered = tendered;
      paymentRecord.change = Math.round((tendered - total) * 100) / 100;
    }

    if (payment.method === 'card') {
      if (!payment.card_token) {
        return res.status(400).json({ success: false, error: 'Card token is required' });
      }

      // Resolve per-farm Square credentials (each subscriber provides their own)
      let sqAccessToken = null;
      let sqLocationId = null;
      let sqEnvironment = 'production';

      if (req.farmStore) {
        try {
          const oauthData = await req.farmStore.get(farmId, 'square_oauth');
          if (oauthData && oauthData.access_token) {
            sqAccessToken = oauthData.access_token;
            sqLocationId = oauthData.location_id || null;
            sqEnvironment = oauthData.environment || 'production';
          }
        } catch (err) {
          console.warn(`[POS] farmStore Square lookup failed for ${farmId}:`, err.message);
        }
      }

      // Fallback to global env vars (platform-level, for GreenReach-managed farms)
      if (!sqAccessToken) {
        sqAccessToken = process.env.SQUARE_ACCESS_TOKEN || null;
        sqLocationId = process.env.SQUARE_LOCATION_ID || null;
        sqEnvironment = process.env.SQUARE_ENVIRONMENT || 'production';
      }

      if (sqAccessToken && sqLocationId) {
        try {
          const { default: SquareSdk } = await import('square');
          const client = new SquareSdk.Client({
            accessToken: sqAccessToken,
            environment: sqEnvironment === 'sandbox'
              ? SquareSdk.Environment.Sandbox
              : SquareSdk.Environment.Production,
          });
          const idempotencyKey = `${orderId}-${Date.now()}`;
          const result = await client.paymentsApi.createPayment({
            sourceId: payment.card_token,
            idempotencyKey,
            amountMoney: {
              amount: BigInt(Math.round(total * 100)),
              currency: 'CAD',
            },
            locationId: sqLocationId,
            referenceId: orderId,
            note: `POS sale at ${farmId}`,
          });
          const sqPayment = result.result?.payment;
          if (!sqPayment || sqPayment.status === 'FAILED') {
            paymentRecord.status = 'failed';
            return res.status(402).json({
              success: false,
              error: 'Card payment declined',
              details: sqPayment?.status,
            });
          }
          paymentRecord.provider = 'square';
          paymentRecord.provider_payment_id = sqPayment.id;
          paymentRecord.receipt_url = sqPayment.receiptUrl || null;
        } catch (sqErr) {
          console.error('[POS] Square payment error:', sqErr.message);
          return res.status(502).json({ success: false, error: 'Payment processing failed' });
        }
      } else {
        // Farm has not connected Square -- reject card payments
        return res.status(422).json({
          success: false,
          error: 'Square payment processing not configured. Connect your Square account in Settings.',
        });
      }
    }

    // ── Persist order ───────────────────────────────────────
    const orderRecord = {
      order_id: orderId,
      farm_id: farmId,
      channel: 'pos',
      status: paymentRecord.status === 'completed' ? 'completed' : 'pending_payment',
      items: lineItems,
      subtotal,
      tax,
      total,
      tax_rate: taxRate,
      payment: paymentRecord,
      customer: customer || null,
      cashier: cashier || null,
      created_at: new Date().toISOString(),
    };

    if (isDatabaseAvailable()) {
      try {
        // Persist to payment_records
        await query(
          `INSERT INTO payment_records (payment_id, order_id, amount, currency, provider, status, metadata, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
          [
            paymentRecord.provider_payment_id || orderId,
            orderId,
            total,
            'CAD',
            paymentRecord.provider || payment.method,
            paymentRecord.status,
            JSON.stringify({ channel: 'pos', farm_id: farmId, cashier: cashier?.name }),
          ]
        );

        // Deduct inventory for completed sales via sold_quantity_lbs
        if (paymentRecord.status === 'completed') {
          for (const item of lineItems) {
            await query(
              `UPDATE farm_inventory SET
                sold_quantity_lbs = COALESCE(sold_quantity_lbs, 0) + $1,
                quantity_available = COALESCE(auto_quantity_lbs, 0)
                  + COALESCE(manual_quantity_lbs, 0)
                  - (COALESCE(sold_quantity_lbs, 0) + $1),
                last_updated = NOW()
               WHERE farm_id = $2 AND (sku = $3 OR product_id = $3)`,
              [item.quantity, farmId, item.sku_id]
            ).catch(() => {});
          }
        }
      } catch (dbErr) {
        console.warn('[POS] DB persistence warning:', dbErr.message);
        // Non-fatal: sale still completes, logged in response
      }
    }

    console.log(`[POS] Sale ${orderId}: $${total} via ${payment.method} (${paymentRecord.status})`);

    // ── Respond with receipt ────────────────────────────────
    return res.json({
      success: true,
      receipt: {
        order_id: orderId,
        farm_id: farmId,
        items: lineItems,
        subtotal,
        tax,
        total,
        payment: paymentRecord,
        customer: customer || null,
        cashier: cashier || null,
        created_at: orderRecord.created_at,
      },
    });
  } catch (err) {
    console.error('[POS] Checkout error:', err);
    res.status(500).json({ success: false, error: 'Checkout failed' });
  }
});

// ─── Farm Sales Orders ─────────────────────────────────────
router.get('/farm-sales/orders', authMiddleware, async (req, res) => {
  try {
    const farmId = req.farmId;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);

    // Try DB first for direct-sale orders
    if (isDatabaseAvailable()) {
      try {
        const farmRow = farmId ? await query('SELECT id FROM farms WHERE farm_id = $1', [farmId]) : { rows: [] };
        const farmDbId = farmRow.rows[0]?.id;
        if (farmDbId) {
          const result = await query(
            `SELECT * FROM wholesale_orders WHERE order_data->>'farm_id' = $1
             OR order_data->'farmSubOrders' @> $2::jsonb
             ORDER BY created_at DESC LIMIT $3 OFFSET $4`,
            [farmId, JSON.stringify([{ farm_id: farmId }]), limit, (page - 1) * limit]
          );
          const orders = result.rows.map(r => ({ ...r.order_data, id: r.master_order_id || r.id, created_at: r.created_at }));
          const countRes = await query(
            `SELECT COUNT(*) FROM wholesale_orders WHERE order_data->>'farm_id' = $1
             OR order_data->'farmSubOrders' @> $2::jsonb`,
            [farmId, JSON.stringify([{ farm_id: farmId }])]
          );
          const total = parseInt(countRes.rows[0]?.count || 0);
          return res.json({
            success: true, orders,
            pagination: { page, pageSize: limit, totalItems: total, totalPages: Math.ceil(total / limit) },
            summary: { total, pending: orders.filter(o => (o.status || '').includes('pending')).length, completed: orders.filter(o => o.status === 'delivered' || o.status === 'completed').length, revenue: orders.reduce((s, o) => s + (o.totals?.total || 0), 0) },
          });
        }
      } catch { /* fall through to empty */ }
    }

    // Fallback: farmStore-based lookup or empty
    const storeOrders = req.farmStore ? (await req.farmStore.get(farmId, 'orders') || []) : [];
    const arr = Array.isArray(storeOrders) ? storeOrders : [];
    res.json({
      success: true, orders: arr.slice((page - 1) * limit, page * limit),
      pagination: { page, pageSize: limit, totalItems: arr.length, totalPages: Math.ceil(arr.length / limit) },
      summary: { total: arr.length, pending: arr.filter(o => (o.status || '').includes('pending')).length, completed: arr.filter(o => o.status === 'completed').length, revenue: arr.reduce((s, o) => s + (o.total || 0), 0) },
    });
  } catch (err) {
    console.error('[FarmSales] Orders error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load orders' });
  }
});

// ─── Farm Sales Inventory ──────────────────────────────────
router.get('/farm-sales/inventory', authMiddleware, async (req, res) => {
  try {
    const farmId = req.farmId;
    let inventory = [];

    // Try DB
    if (isDatabaseAvailable() && farmId) {
      try {
        const result = await query(
          `SELECT
            COALESCE(sku, product_id) AS sku_id,
            product_name AS name,
            COALESCE(retail_price, wholesale_price, price, 0) AS retail_price,
            COALESCE(quantity_available, 0) AS quantity_available,
            0 AS reserved,
            COALESCE(unit, 'unit') AS unit,
            COALESCE(category, 'Uncategorized') AS category,
            COALESCE(is_taxable, true) AS is_taxable,
            lot_code,
            description,
            thumbnail_url,
            inventory_source,
            auto_quantity_lbs,
            manual_quantity_lbs,
            wholesale_price,
            sold_quantity_lbs,
            is_custom
          FROM farm_inventory
          WHERE farm_id = $1
            AND COALESCE(status, 'active') != 'inactive'
            AND COALESCE(quantity_available, 0) > 0
          ORDER BY category, product_name`,
          [farmId]
        );
        if (result.rows.length) inventory = result.rows;
      } catch { /* table may not exist — fall through */ }
    }

    // Fallback to farmStore
    if (!inventory.length && req.farmStore && farmId) {
      const stored = await req.farmStore.get(farmId, 'inventory');
      if (Array.isArray(stored)) inventory = stored;
    }

    const inStock = inventory.filter(i => (Number(i.quantity_available ?? i.qty_available ?? i.quantity ?? 0)) > 0).length;
    const lowStock = inventory.filter(i => {
      const q = Number(i.quantity_available ?? i.qty_available ?? i.quantity ?? 0);
      return q > 0 && q <= (i.low_stock_threshold || 5);
    }).length;
    const outOfStock = inventory.filter(i => (Number(i.quantity_available ?? i.qty_available ?? i.quantity ?? 0)) <= 0).length;

    res.json({
      success: true,
      inventory,
      summary: { totalProducts: inventory.length, inStock, lowStock, outOfStock },
    });
  } catch (err) {
    console.error('[FarmSales] Inventory error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load inventory' });
  }
});

// ─── Subscription Plans ────────────────────────────────────
router.get('/farm-sales/subscriptions/plans', authMiddleware, (req, res) => {
  res.status(501).json({
    success: false,
    plans: [],
    message: 'Subscription plans not yet implemented',
  });
});

// ─── Donations & Programs ──────────────────────────────────
router.get('/farm-sales/donations/programs', authMiddleware, (req, res) => {
  res.json({
    ok: true,
    programs: [],
    stats: { total_programs: 0, total_budget: 0, total_spent: 0, by_type: {} },
  });
});

// ─── QuickBooks Integration ────────────────────────────────

/**
 * GET /api/farm-sales/quickbooks/status
 * Check QuickBooks connection status for this farm
 */
router.get('/farm-sales/quickbooks/status', authMiddleware, async (req, res) => {
  try {
    const farmId = req.farmId;
    if (!isDatabaseAvailable() || !farmId) {
      return res.json({ success: true, connected: false, status: 'not_configured', message: 'Database or farm not available' });
    }

    // Check for stored OAuth tokens
    try {
      await query(`
        CREATE TABLE IF NOT EXISTS farm_quickbooks_connections (
          id SERIAL PRIMARY KEY,
          farm_id VARCHAR(255) UNIQUE NOT NULL,
          realm_id VARCHAR(255),
          access_token TEXT,
          refresh_token TEXT,
          token_expires_at TIMESTAMPTZ,
          company_name VARCHAR(255),
          status VARCHAR(50) DEFAULT 'connected',
          last_sync_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
    } catch { /* table may already exist */ }

    const result = await query('SELECT realm_id, company_name, status, last_sync_at, token_expires_at FROM farm_quickbooks_connections WHERE farm_id = $1', [farmId]);
    if (result.rows.length === 0) {
      return res.json({ success: true, connected: false, status: 'not_connected', message: 'QuickBooks not connected. Use POST /auth to begin OAuth.' });
    }

    const conn = result.rows[0];
    const expired = conn.token_expires_at && new Date(conn.token_expires_at) < new Date();

    return res.json({
      success: true,
      connected: conn.status === 'connected' && !expired,
      status: expired ? 'token_expired' : conn.status,
      company_name: conn.company_name,
      realm_id: conn.realm_id,
      last_sync_at: conn.last_sync_at,
      token_expired: expired,
    });
  } catch (err) {
    console.error('[QuickBooks] Status error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to check QuickBooks status' });
  }
});

/**
 * POST /api/farm-sales/quickbooks/auth
 * Start QuickBooks OAuth flow — returns the authorization URL
 */
router.post('/farm-sales/quickbooks/auth', authMiddleware, async (req, res) => {
  try {
    const farmId = req.farmId;
    const clientId = process.env.QUICKBOOKS_CLIENT_ID;
    const redirectUri = process.env.QUICKBOOKS_REDIRECT_URI || `${process.env.BASE_URL || 'https://greenreachgreens.com'}/api/farm-sales/quickbooks/callback`;

    if (!clientId) {
      return res.status(503).json({ success: false, error: 'QuickBooks integration not configured. Set QUICKBOOKS_CLIENT_ID env var.' });
    }

    const state = Buffer.from(JSON.stringify({ farm_id: farmId, ts: Date.now() })).toString('base64url');
    const scope = 'com.intuit.quickbooks.accounting';
    const environment = process.env.QUICKBOOKS_ENVIRONMENT === 'production' ? 'production' : 'sandbox';
    const baseUrl = environment === 'production'
      ? 'https://appcenter.intuit.com/connect/oauth2'
      : 'https://appcenter.intuit.com/connect/oauth2';

    const authUrl = `${baseUrl}?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scope)}&state=${encodeURIComponent(state)}`;

    return res.json({ success: true, auth_url: authUrl, state });
  } catch (err) {
    console.error('[QuickBooks] Auth start error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to start QuickBooks auth' });
  }
});

/**
 * GET /api/farm-sales/quickbooks/callback
 * OAuth callback from QuickBooks — exchanges code for tokens
 */
router.get('/farm-sales/quickbooks/callback', async (req, res) => {
  try {
    const { code, state, realmId } = req.query;
    if (!code || !state || !realmId) {
      return res.status(400).send('Invalid OAuth callback parameters');
    }

    let stateData;
    try {
      stateData = JSON.parse(Buffer.from(state, 'base64url').toString());
    } catch {
      return res.status(400).send('Invalid state parameter');
    }

    const farmId = stateData.farm_id;
    const clientId = process.env.QUICKBOOKS_CLIENT_ID;
    const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET;
    const redirectUri = process.env.QUICKBOOKS_REDIRECT_URI || `${process.env.BASE_URL || 'https://greenreachgreens.com'}/api/farm-sales/quickbooks/callback`;

    if (!clientId || !clientSecret) {
      return res.status(503).send('QuickBooks not configured');
    }

    // Exchange code for tokens
    const tokenUrl = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    const tokenResponse = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: `grant_type=authorization_code&code=${encodeURIComponent(code)}&redirect_uri=${encodeURIComponent(redirectUri)}`,
    });

    if (!tokenResponse.ok) {
      const errText = await tokenResponse.text();
      console.error('[QuickBooks] Token exchange failed:', errText);
      return res.status(502).send('Failed to exchange authorization code');
    }

    const tokens = await tokenResponse.json();
    const expiresAt = new Date(Date.now() + (tokens.expires_in || 3600) * 1000);

    // Get company info
    const environment = process.env.QUICKBOOKS_ENVIRONMENT === 'production' ? 'production' : 'sandbox';
    const apiBase = environment === 'production'
      ? 'https://quickbooks.api.intuit.com'
      : 'https://sandbox-quickbooks.api.intuit.com';

    let companyName = 'Unknown';
    try {
      const companyResp = await fetch(`${apiBase}/v3/company/${realmId}/companyinfo/${realmId}?minorversion=65`, {
        headers: { 'Authorization': `Bearer ${tokens.access_token}`, 'Accept': 'application/json' },
      });
      if (companyResp.ok) {
        const companyData = await companyResp.json();
        companyName = companyData.CompanyInfo?.CompanyName || 'Unknown';
      }
    } catch { /* non-critical */ }

    // Store connection
    if (isDatabaseAvailable()) {
      await query(
        `INSERT INTO farm_quickbooks_connections (farm_id, realm_id, access_token, refresh_token, token_expires_at, company_name, status, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'connected', NOW())
         ON CONFLICT (farm_id) DO UPDATE SET
           realm_id = EXCLUDED.realm_id,
           access_token = EXCLUDED.access_token,
           refresh_token = EXCLUDED.refresh_token,
           token_expires_at = EXCLUDED.token_expires_at,
           company_name = EXCLUDED.company_name,
           status = 'connected',
           updated_at = NOW()`,
        [farmId, realmId, tokens.access_token, tokens.refresh_token, expiresAt.toISOString(), companyName]
      );
    }

    console.log(`[QuickBooks] Connected farm ${farmId} to company "${companyName}" (realm: ${realmId})`);

    // Redirect back to farm admin
    return res.redirect('/farm-admin.html?quickbooks=connected');
  } catch (err) {
    console.error('[QuickBooks] Callback error:', err.message);
    return res.status(500).send('QuickBooks connection failed');
  }
});

/**
 * POST /api/farm-sales/quickbooks/disconnect
 * Disconnect QuickBooks from this farm
 */
router.post('/farm-sales/quickbooks/disconnect', authMiddleware, async (req, res) => {
  try {
    const farmId = req.farmId;
    if (isDatabaseAvailable()) {
      await query(
        `UPDATE farm_quickbooks_connections SET status = 'disconnected', access_token = NULL, refresh_token = NULL, updated_at = NOW() WHERE farm_id = $1`,
        [farmId]
      );
    }
    return res.json({ success: true, message: 'QuickBooks disconnected' });
  } catch (err) {
    console.error('[QuickBooks] Disconnect error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to disconnect' });
  }
});

/**
 * Helper: Get a valid QuickBooks access token, refreshing if expired
 */
async function getQbAccessToken(farmId) {
  const result = await query('SELECT * FROM farm_quickbooks_connections WHERE farm_id = $1 AND status = $2', [farmId, 'connected']);
  if (result.rows.length === 0) return null;

  const conn = result.rows[0];
  const now = new Date();

  if (conn.token_expires_at && new Date(conn.token_expires_at) > now) {
    return { access_token: conn.access_token, realm_id: conn.realm_id };
  }

  // Refresh the token
  const clientId = process.env.QUICKBOOKS_CLIENT_ID;
  const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET;
  if (!clientId || !clientSecret || !conn.refresh_token) return null;

  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const tokenResponse = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
    method: 'POST',
    headers: { 'Authorization': `Basic ${basicAuth}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(conn.refresh_token)}`,
  });

  if (!tokenResponse.ok) {
    await query(`UPDATE farm_quickbooks_connections SET status = 'token_expired', updated_at = NOW() WHERE farm_id = $1`, [farmId]);
    return null;
  }

  const tokens = await tokenResponse.json();
  const expiresAt = new Date(Date.now() + (tokens.expires_in || 3600) * 1000);

  await query(
    `UPDATE farm_quickbooks_connections SET access_token = $1, refresh_token = $2, token_expires_at = $3, updated_at = NOW() WHERE farm_id = $4`,
    [tokens.access_token, tokens.refresh_token || conn.refresh_token, expiresAt.toISOString(), farmId]
  );

  return { access_token: tokens.access_token, realm_id: conn.realm_id };
}

/**
 * Helper: Get QBO API base URL
 */
function getQbApiBase() {
  return process.env.QUICKBOOKS_ENVIRONMENT === 'production'
    ? 'https://quickbooks.api.intuit.com'
    : 'https://sandbox-quickbooks.api.intuit.com';
}

/**
 * POST /api/farm-sales/quickbooks/sync-invoices
 * Sync recent orders as invoices to QuickBooks
 */
router.post('/farm-sales/quickbooks/sync-invoices', authMiddleware, async (req, res) => {
  try {
    const farmId = req.farmId;
    const qb = await getQbAccessToken(farmId);
    if (!qb) return res.status(401).json({ success: false, error: 'QuickBooks not connected or token expired' });

    // Fetch recent orders for this farm
    const ordersResult = await query(
      `SELECT master_order_id, buyer_email, order_data, created_at FROM wholesale_orders
       WHERE (order_data->>'farm_id' = $1 OR order_data->'farmSubOrders' @> $2::jsonb)
         AND created_at >= NOW() - INTERVAL '30 days'
       ORDER BY created_at DESC LIMIT 50`,
      [farmId, JSON.stringify([{ farm_id: farmId }])]
    );

    let synced = 0;
    const apiBase = getQbApiBase();

    for (const row of ordersResult.rows) {
      const order = row.order_data || {};
      const total = order.totals?.total || order.grand_total || 0;
      if (total <= 0) continue;

      // Create a simple QBO invoice
      const invoice = {
        Line: [{
          DetailType: 'SalesItemLineDetail',
          Amount: Number(total),
          Description: `Wholesale Order ${row.master_order_id}`,
          SalesItemLineDetail: { Qty: 1, UnitPrice: Number(total) },
        }],
        CustomerRef: { value: '1', name: row.buyer_email || 'Wholesale Customer' },
        TxnDate: row.created_at ? new Date(row.created_at).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
        DocNumber: row.master_order_id,
        PrivateNote: `Synced from GreenReach — Farm ${farmId}`,
      };

      try {
        const resp = await fetch(`${apiBase}/v3/company/${qb.realm_id}/invoice?minorversion=65`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${qb.access_token}`, 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify(invoice),
        });
        if (resp.ok) synced++;
      } catch { /* individual invoice sync failure — continue */ }
    }

    await query(`UPDATE farm_quickbooks_connections SET last_sync_at = NOW() WHERE farm_id = $1`, [farmId]);

    return res.json({ success: true, synced, total_orders: ordersResult.rows.length });
  } catch (err) {
    console.error('[QuickBooks] Sync invoices error:', err.message);
    res.status(500).json({ success: false, synced: 0, error: 'Sync failed' });
  }
});

/**
 * POST /api/farm-sales/quickbooks/sync-payments
 * Sync payment records to QuickBooks as payments
 */
router.post('/farm-sales/quickbooks/sync-payments', authMiddleware, async (req, res) => {
  try {
    const farmId = req.farmId;
    const qb = await getQbAccessToken(farmId);
    if (!qb) return res.status(401).json({ success: false, error: 'QuickBooks not connected or token expired' });

    const paymentsResult = await query(
      `SELECT payment_id, order_id, amount, currency, provider, status, created_at
       FROM payment_records
       WHERE metadata::text LIKE $1 AND created_at >= NOW() - INTERVAL '30 days'
       ORDER BY created_at DESC LIMIT 50`,
      [`%${farmId}%`]
    );

    let synced = 0;
    const apiBase = getQbApiBase();

    for (const row of paymentsResult.rows) {
      if (row.status !== 'completed' && row.status !== 'created') continue;

      const payment = {
        TotalAmt: Number(row.amount),
        CustomerRef: { value: '1' },
        TxnDate: row.created_at ? new Date(row.created_at).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
        PrivateNote: `Payment ${row.payment_id} via ${row.provider} — GreenReach sync`,
      };

      try {
        const resp = await fetch(`${apiBase}/v3/company/${qb.realm_id}/payment?minorversion=65`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${qb.access_token}`, 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify(payment),
        });
        if (resp.ok) synced++;
      } catch { /* continue */ }
    }

    await query(`UPDATE farm_quickbooks_connections SET last_sync_at = NOW() WHERE farm_id = $1`, [farmId]);

    return res.json({ success: true, synced, total_payments: paymentsResult.rows.length });
  } catch (err) {
    console.error('[QuickBooks] Sync payments error:', err.message);
    res.status(500).json({ success: false, synced: 0, error: 'Sync failed' });
  }
});

/**
 * POST /api/farm-sales/quickbooks/sync/customer
 * Sync wholesale buyers as QuickBooks customers
 */
router.post('/farm-sales/quickbooks/sync/customer', authMiddleware, async (req, res) => {
  try {
    const farmId = req.farmId;
    const qb = await getQbAccessToken(farmId);
    if (!qb) return res.status(401).json({ success: false, error: 'QuickBooks not connected or token expired' });

    // Get buyers who have placed orders with this farm
    const buyersResult = await query(
      `SELECT DISTINCT wo.buyer_email, wb.business_name, wb.contact_name, wb.phone
       FROM wholesale_orders wo
       LEFT JOIN wholesale_buyers wb ON wb.email = wo.buyer_email
       WHERE (wo.order_data->>'farm_id' = $1 OR wo.order_data->'farmSubOrders' @> $2::jsonb)
       LIMIT 100`,
      [farmId, JSON.stringify([{ farm_id: farmId }])]
    );

    let synced = 0;
    const apiBase = getQbApiBase();

    for (const buyer of buyersResult.rows) {
      if (!buyer.buyer_email) continue;

      const customer = {
        DisplayName: buyer.business_name || buyer.contact_name || buyer.buyer_email,
        PrimaryEmailAddr: { Address: buyer.buyer_email },
        CompanyName: buyer.business_name || null,
        GivenName: (buyer.contact_name || '').split(' ')[0] || null,
        FamilyName: (buyer.contact_name || '').split(' ').slice(1).join(' ') || null,
        PrimaryPhone: buyer.phone ? { FreeFormNumber: buyer.phone } : null,
      };

      try {
        const resp = await fetch(`${apiBase}/v3/company/${qb.realm_id}/customer?minorversion=65`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${qb.access_token}`, 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify(customer),
        });
        if (resp.ok) synced++;
      } catch { /* continue */ }
    }

    return res.json({ success: true, synced, total_buyers: buyersResult.rows.length });
  } catch (err) {
    console.error('[QuickBooks] Sync customers error:', err.message);
    res.status(500).json({ success: false, synced: 0, error: 'Sync failed' });
  }
});

// ─── AI Agent ──────────────────────────────────────────────
router.get('/farm-sales/ai-agent/status', authMiddleware, (req, res) => {
  res.status(501).json({
    success: false,
    enabled: false,
    status: 'not_implemented',
    model: null,
    message: 'AI agent not yet implemented',
  });
});

router.post('/farm-sales/ai-agent/chat', authMiddleware, (req, res) => {
  res.status(501).json({
    success: false,
    message: 'AI agent not yet implemented',
    sessionId: null,
  });
});

// ─── Farm Delivery Settings (farm-admin.js) ────────────────
// GET /api/farm-sales/delivery/config — delivery settings + windows for this farm
router.get('/farm-sales/delivery/config', authMiddleware, async (req, res) => {
  try {
    const farmId = req.farmId;
    if (!farmId) {
      return res.status(400).json({ success: false, error: 'Farm ID not resolved' });
    }

    let settings = { enabled: false, base_fee: 0, min_order: 25, lead_time_hours: 24, max_deliveries_per_window: 20 };
    let windows = [];

    if (isDatabaseAvailable()) {
      await ensureDeliveryTables();
      const settingsResult = await query(
        'SELECT * FROM farm_delivery_settings WHERE farm_id = $1', [farmId]
      );
      if (settingsResult.rows.length > 0) {
        const r = settingsResult.rows[0];
        settings = {
          enabled: r.enabled,
          base_fee: Number(r.base_fee),
          min_order: Number(r.min_order),
          lead_time_hours: Number(r.lead_time_hours || 24),
          max_deliveries_per_window: Number(r.max_deliveries_per_window || 20)
        };
      }

      const windowsResult = await query(
        'SELECT * FROM farm_delivery_windows WHERE farm_id = $1 ORDER BY window_id', [farmId]
      );
      windows = windowsResult.rows.map(r => ({
        window_id: r.window_id,
        label: r.label,
        start_time: r.start_time,
        end_time: r.end_time,
        active: r.active
      }));
    }

    // Provide defaults if no windows configured yet
    if (windows.length === 0) {
      windows = [
        { window_id: 'morning',   label: 'Morning',   start_time: '06:00', end_time: '10:00', active: true },
        { window_id: 'afternoon', label: 'Afternoon', start_time: '11:00', end_time: '15:00', active: true },
        { window_id: 'evening',   label: 'Evening',   start_time: '16:00', end_time: '20:00', active: false }
      ];
    }

    res.json({ success: true, config: { ...settings, windows } });
  } catch (error) {
    console.error('[Farm Delivery] Config get failed:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/farm-sales/delivery/config — update delivery settings
router.put('/farm-sales/delivery/config', authMiddleware, async (req, res) => {
  try {
    const farmId = req.farmId;
    if (!farmId) {
      return res.status(400).json({ success: false, error: 'Farm ID not resolved' });
    }

    const { enabled, base_fee, min_order, lead_time_hours, max_deliveries_per_window } = req.body;

    if (isDatabaseAvailable()) {
      await ensureDeliveryTables();
      await query(
        `INSERT INTO farm_delivery_settings (farm_id, enabled, base_fee, min_order, lead_time_hours, max_deliveries_per_window, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (farm_id) DO UPDATE SET
           enabled = COALESCE($2, farm_delivery_settings.enabled),
           base_fee = COALESCE($3, farm_delivery_settings.base_fee),
           min_order = COALESCE($4, farm_delivery_settings.min_order),
           lead_time_hours = COALESCE($5, farm_delivery_settings.lead_time_hours),
           max_deliveries_per_window = COALESCE($6, farm_delivery_settings.max_deliveries_per_window),
           updated_at = NOW()`,
        [
          farmId,
          enabled ?? null,
          base_fee != null ? parseFloat(base_fee) : null,
          min_order != null ? parseFloat(min_order) : null,
          lead_time_hours != null ? parseInt(lead_time_hours) : null,
          max_deliveries_per_window != null ? parseInt(max_deliveries_per_window) : null
        ]
      );

      const result = await query('SELECT * FROM farm_delivery_settings WHERE farm_id = $1', [farmId]);
      const r = result.rows[0];
      console.log('[Farm Delivery] Config updated for farm:', farmId);
      return res.json({
        success: true,
        config: {
          enabled: r.enabled,
          base_fee: Number(r.base_fee),
          min_order: Number(r.min_order),
          lead_time_hours: Number(r.lead_time_hours),
          max_deliveries_per_window: Number(r.max_deliveries_per_window)
        }
      });
    }

    res.status(503).json({ success: false, error: 'Database unavailable' });
  } catch (error) {
    console.error('[Farm Delivery] Config update failed:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/farm-sales/delivery/windows — bulk upsert delivery windows
router.put('/farm-sales/delivery/windows', authMiddleware, async (req, res) => {
  try {
    const farmId = req.farmId;
    if (!farmId) {
      return res.status(400).json({ success: false, error: 'Farm ID not resolved' });
    }

    const { windows } = req.body;
    if (!Array.isArray(windows)) {
      return res.status(400).json({ success: false, error: 'windows array is required' });
    }

    if (isDatabaseAvailable()) {
      await ensureDeliveryTables();
      for (const w of windows) {
        if (!w.window_id) continue;
        await query(
          `INSERT INTO farm_delivery_windows (farm_id, window_id, label, start_time, end_time, active, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW())
           ON CONFLICT (farm_id, window_id) DO UPDATE SET
             label = COALESCE($3, farm_delivery_windows.label),
             start_time = COALESCE($4, farm_delivery_windows.start_time),
             end_time = COALESCE($5, farm_delivery_windows.end_time),
             active = COALESCE($6, farm_delivery_windows.active),
             updated_at = NOW()`,
          [farmId, w.window_id, w.label || w.window_id, w.start_time || '06:00', w.end_time || '10:00', w.active ?? true]
        );
      }

      const result = await query(
        'SELECT * FROM farm_delivery_windows WHERE farm_id = $1 ORDER BY window_id', [farmId]
      );
      const saved = result.rows.map(r => ({
        window_id: r.window_id, label: r.label,
        start_time: r.start_time, end_time: r.end_time, active: r.active
      }));
      console.log('[Farm Delivery] Windows updated for farm:', farmId, '—', saved.length, 'windows');
      return res.json({ success: true, windows: saved });
    }

    res.status(503).json({ success: false, error: 'Database unavailable' });
  } catch (error) {
    console.error('[Farm Delivery] Windows update failed:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── CSV Export Helpers ─────────────────────────────────────
function csvEscape(value) {
  const str = String(value ?? '');
  if (str.includes('"') || str.includes(',') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// ─── Inventory CSV Export ───────────────────────────────────
// GET /api/farm-sales/inventory/export — CSV of current inventory
router.get('/farm-sales/inventory/export', authMiddleware, async (req, res) => {
  try {
    const farmId = req.farmId;
    const { category, available_only, include_valuation } = req.query;
    let inventory = [];

    if (isDatabaseAvailable() && farmId) {
      try {
        let sql = 'SELECT * FROM farm_inventory WHERE farm_id = $1';
        const params = [farmId];
        if (category) {
          params.push(category);
          sql += ` AND category = $${params.length}`;
        }
        sql += ' ORDER BY sku';
        const result = await query(sql, params);
        if (result.rows.length) inventory = result.rows;
      } catch { /* table may not exist — fall through */ }
    }

    // Fallback to farmStore
    if (!inventory.length && req.farmStore && farmId) {
      const stored = await req.farmStore.get(farmId, 'inventory');
      if (Array.isArray(stored)) {
        inventory = stored;
        if (category) inventory = inventory.filter(i => (i.category || '') === category);
      }
    }

    if (available_only === 'true') {
      inventory = inventory.filter(i => (Number(i.quantity_available ?? i.qty_available ?? i.quantity ?? 0)) > 0);
    }

    const showVal = include_valuation !== 'false';
    const headerCols = ['SKU', 'Name', 'Category', 'Quantity', 'Unit', 'Low Stock Threshold'];
    if (showVal) headerCols.push('Unit Price', 'Total Value');

    const rows = inventory.map(item => {
      const qty = Number(item.quantity_available ?? item.qty_available ?? item.quantity ?? 0);
      const price = item.unit_price || item.price || 0;
      const cols = [
        csvEscape(item.sku || item.sku_id || ''),
        csvEscape(item.name || item.product_name || ''),
        csvEscape(item.category || ''),
        qty,
        csvEscape(item.unit || 'each'),
        item.low_stock_threshold || 5,
      ];
      if (showVal) {
        cols.push(Number(price).toFixed(2), (qty * price).toFixed(2));
      }
      return cols.join(',');
    });

    const csv = [headerCols.join(','), ...rows].join('\n');
    const filename = `inventory-export-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) {
    console.error('[FarmSales] Inventory export error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to export inventory' });
  }
});

// ─── Sales Transaction CSV Export ───────────────────────────
// GET /api/farm-sales/reports/sales-export — CSV of wholesale orders + POS txns
router.get('/farm-sales/reports/sales-export', authMiddleware, async (req, res) => {
  try {
    const farmId = req.farmId;
    const { start_date, end_date, channel, level } = req.query;
    let orders = [];

    if (isDatabaseAvailable() && farmId) {
      try {
        let sql = `SELECT master_order_id, buyer_id, buyer_email, status, order_data, created_at
                    FROM wholesale_orders
                    WHERE (order_data->>'farm_id' = $1
                       OR order_data->'farmSubOrders' @> $2::jsonb)`;
        const params = [farmId, JSON.stringify([{ farm_id: farmId }])];
        if (start_date) { params.push(start_date); sql += ` AND created_at >= $${params.length}::date`; }
        if (end_date)   { params.push(end_date + 'T23:59:59Z'); sql += ` AND created_at <= $${params.length}::timestamp`; }
        sql += ' ORDER BY created_at DESC';
        const result = await query(sql, params);
        orders = result.rows.map(r => ({
          ...r.order_data,
          master_order_id: r.master_order_id,
          buyer_email: r.buyer_email,
          db_status: r.status,
          created_at: r.created_at,
        }));
      } catch { /* fall through */ }
    }

    // Fallback to farmStore
    if (!orders.length && req.farmStore && farmId) {
      const stored = await req.farmStore.get(farmId, 'orders');
      if (Array.isArray(stored)) orders = stored;
    }

    // Channel filter
    if (channel && channel !== 'all') {
      orders = orders.filter(o => (o.channel || 'wholesale').toLowerCase().includes(channel));
    }

    // Build CSV
    const isDetail = level === 'detail';
    if (isDetail) {
      const header = ['Order ID', 'Date', 'Buyer', 'Channel', 'SKU', 'Product', 'Qty', 'Unit Price', 'Line Total', 'Status'].join(',');
      const rows = [];
      for (const o of orders) {
        const items = o.items || o.farmSubOrders?.flatMap(s => s.items || []) || [];
        const dateStr = o.created_at ? new Date(o.created_at).toISOString().slice(0, 10) : '';
        for (const item of items) {
          rows.push([
            csvEscape(o.master_order_id || o.id || ''),
            dateStr,
            csvEscape(o.buyer_email || o.buyerName || ''),
            csvEscape(o.channel || 'wholesale'),
            csvEscape(item.sku_id || item.sku || ''),
            csvEscape(item.name || item.product_name || ''),
            item.quantity || 0,
            Number(item.unit_price || item.price || 0).toFixed(2),
            Number((item.quantity || 0) * (item.unit_price || item.price || 0)).toFixed(2),
            csvEscape(o.db_status || o.status || ''),
          ].join(','));
        }
        // If no items, still emit order-level row
        if (!items.length) {
          rows.push([
            csvEscape(o.master_order_id || o.id || ''),
            dateStr,
            csvEscape(o.buyer_email || o.buyerName || ''),
            csvEscape(o.channel || 'wholesale'),
            '', '', 0, '0.00',
            Number(o.totals?.total || o.total || 0).toFixed(2),
            csvEscape(o.db_status || o.status || ''),
          ].join(','));
        }
      }
      const csv = [header, ...rows].join('\n');
      const filename = `sales-detail-${start_date || 'all'}-to-${end_date || 'now'}.csv`;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(csv);
    }

    // Summary level — one row per order
    const header = ['Order ID', 'Date', 'Buyer', 'Channel', 'Items', 'Subtotal', 'Tax', 'Total', 'Status'].join(',');
    const rows = orders.map(o => {
      const items = o.items || o.farmSubOrders?.flatMap(s => s.items || []) || [];
      return [
        csvEscape(o.master_order_id || o.id || ''),
        o.created_at ? new Date(o.created_at).toISOString().slice(0, 10) : '',
        csvEscape(o.buyer_email || o.buyerName || ''),
        csvEscape(o.channel || 'wholesale'),
        items.length,
        Number(o.totals?.subtotal || o.subtotal || 0).toFixed(2),
        Number(o.totals?.tax || o.tax || 0).toFixed(2),
        Number(o.totals?.total || o.total || 0).toFixed(2),
        csvEscape(o.db_status || o.status || ''),
      ].join(',');
    });
    const csv = [header, ...rows].join('\n');
    const filename = `sales-summary-${start_date || 'all'}-to-${end_date || 'now'}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) {
    console.error('[FarmSales] Sales export error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to export sales data' });
  }
});

// ─── QuickBooks Daily Summary CSV ───────────────────────────
// GET /api/farm-sales/reports/quickbooks-daily-summary — aggregated daily summary
router.get('/farm-sales/reports/quickbooks-daily-summary', authMiddleware, async (req, res) => {
  try {
    const farmId = req.farmId;
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const nextDay = new Date(new Date(date).getTime() + 86400000).toISOString().slice(0, 10);

    let orders = [];
    if (isDatabaseAvailable() && farmId) {
      try {
        const result = await query(
          `SELECT order_data, created_at FROM wholesale_orders
           WHERE (order_data->>'farm_id' = $1
              OR order_data->'farmSubOrders' @> $2::jsonb)
             AND created_at >= $3::date AND created_at < $4::date
           ORDER BY created_at`,
          [farmId, JSON.stringify([{ farm_id: farmId }]), date, nextDay]
        );
        orders = result.rows.map(r => ({ ...r.order_data, created_at: r.created_at }));
      } catch { /* fall through */ }
    }

    // Aggregate by channel
    const channels = { wholesale: 0, pos: 0, online: 0 };
    let totalTax = 0, totalTips = 0, totalCash = 0, totalCard = 0, totalRevenue = 0;

    for (const o of orders) {
      const ch = (o.channel || 'wholesale').toLowerCase();
      const total = o.totals?.total || o.total || 0;
      const tax = o.totals?.tax || o.tax || 0;
      const tip = o.tip || 0;
      totalRevenue += total;
      totalTax += tax;
      totalTips += tip;
      if (ch.includes('pos')) { channels.pos += total; totalCash += total; }
      else if (ch.includes('online')) { channels.online += total; totalCard += total; }
      else { channels.wholesale += total; totalCard += total; }
    }

    const processingFee = totalCard * 0.029 + orders.length * 0.30;
    const wholesaleCommissionRate = Number(process.env.WHOLESALE_COMMISSION_RATE || 0);
    const brokerFee = channels.wholesale * wholesaleCommissionRate;

    // QuickBooks IIF-style daily summary CSV
    const header = ['Account', 'Description', 'Debit', 'Credit'].join(',');
    const rows = [
      ['Revenue - Wholesale', `Wholesale sales ${date}`, '', channels.wholesale.toFixed(2)],
      ['Revenue - POS', `Point of sale ${date}`, '', channels.pos.toFixed(2)],
      ['Revenue - Online', `Online orders ${date}`, '', channels.online.toFixed(2)],
      ['Sales Tax Payable', `Tax collected ${date}`, '', totalTax.toFixed(2)],
      ['Tips Income', `Tips received ${date}`, '', totalTips.toFixed(2)],
      ['Cash on Hand', `Cash payments ${date}`, totalCash.toFixed(2), ''],
      ['Accounts Receivable', `Card payments ${date}`, totalCard.toFixed(2), ''],
      ['Merchant Processing Fees', `Card processing (2.9% + $0.30) ${date}`, processingFee.toFixed(2), ''],
      ['Broker Fees', `GreenReach commission (${(wholesaleCommissionRate * 100).toFixed(0)}%) ${date}`, brokerFee.toFixed(2), ''],
    ].map(cols => cols.map(csvEscape).join(','));

    const csv = [header, ...rows].join('\n');
    const filename = `quickbooks-daily-${date}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) {
    console.error('[FarmSales] QuickBooks export error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to export QuickBooks summary' });
  }
});

// ─── Demo Intro Cards ──────────────────────────────────────
router.get('/demo/intro-cards', (req, res) => {
  res.json({
    success: true,
    cards: [
      { id: 'welcome', title: 'Welcome to GreenReach', description: 'Your smart farming platform', icon: '🌱' },
      { id: 'setup', title: 'Set Up Your Farm', description: 'Configure rooms, zones, and groups', icon: '🏭' },
      { id: 'monitor', title: 'Monitor & Control', description: 'Track environment and automate', icon: '📊' },
      { id: 'grow', title: 'Grow & Sell', description: 'Plan plantings and manage orders', icon: '🌿' },
    ],
  });
});

export default router;
