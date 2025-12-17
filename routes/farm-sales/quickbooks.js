/**
 * Farm Sales - QuickBooks Integration
 * Sync invoices and payments with QuickBooks Online (PLACEHOLDER)
 * 
 * SETUP REQUIRED:
 * 1. Create QuickBooks developer account at developer.intuit.com
 * 2. Create app and obtain Client ID and Client Secret
 * 3. Set environment variables:
 *    - QB_CLIENT_ID: QuickBooks app client ID
 *    - QB_CLIENT_SECRET: QuickBooks app client secret
 *    - QB_REDIRECT_URI: OAuth callback URL (e.g., http://localhost:8091/api/farm-sales/quickbooks/callback)
 * 4. Install QuickBooks SDK: npm install node-quickbooks
 * 5. Configure scopes: com.intuit.quickbooks.accounting
 * 
 * MULTI-TENANT ARCHITECTURE:
 * - Each farm has separate QuickBooks connection
 * - OAuth tokens stored per farm_id
 * - Realm ID (company ID) stored in farm config
 */

import express from 'express';
import { farmAuthMiddleware } from '../../lib/farm-auth.js';
import { farmStores } from '../../lib/farm-store.js';

const router = express.Router();

// Initialize QuickBooks token store (multi-tenant)
if (!farmStores.qbTokens) {
  farmStores.qbTokens = {
    getAllForFarm: (farmId) => {
      const tokens = farmStores.qbTokens._store || {};
      return tokens[farmId] || null;
    },
    setForFarm: (farmId, data) => {
      if (!farmStores.qbTokens._store) {
        farmStores.qbTokens._store = {};
      }
      farmStores.qbTokens._store[farmId] = data;
      return data;
    },
    deleteForFarm: (farmId) => {
      if (farmStores.qbTokens._store) {
        delete farmStores.qbTokens._store[farmId];
      }
    }
  };
}

// Apply authentication to all routes
router.use(farmAuthMiddleware);

/**
 * GET /api/farm-sales/quickbooks/auth
 * Initiate OAuth 2.0 flow with QuickBooks
 * Redirects user to QuickBooks authorization page
 */
router.get('/auth', (req, res) => {
  const farmId = req.farm_id;

  // Check if QuickBooks credentials are configured
  if (!process.env.QB_CLIENT_ID || !process.env.QB_CLIENT_SECRET) {
    return res.status(501).json({
      ok: false,
      error: 'quickbooks_not_configured',
      message: 'QuickBooks integration requires QB_CLIENT_ID and QB_CLIENT_SECRET environment variables',
      setup_guide: 'See routes/farm-sales/quickbooks.js header for setup instructions'
    });
  }

  // TODO: Generate state parameter with farm_id for security
  const state = Buffer.from(JSON.stringify({ farm_id: farmId, timestamp: Date.now() })).toString('base64');

  // TODO: Build QuickBooks authorization URL
  const authUrl = `https://appcenter.intuit.com/connect/oauth2?` +
    `client_id=${process.env.QB_CLIENT_ID}&` +
    `redirect_uri=${encodeURIComponent(process.env.QB_REDIRECT_URI || 'http://localhost:8091/api/farm-sales/quickbooks/callback')}&` +
    `response_type=code&` +
    `scope=com.intuit.quickbooks.accounting&` +
    `state=${state}`;

  res.json({
    ok: true,
    message: 'QuickBooks OAuth placeholder - implementation pending',
    auth_url: authUrl,
    instructions: 'Redirect user to auth_url to begin OAuth flow'
  });
});

/**
 * GET /api/farm-sales/quickbooks/callback
 * OAuth 2.0 callback handler
 * Exchanges authorization code for access token
 */
router.get('/callback', async (req, res) => {
  const { code, state, realmId } = req.query;

  if (!code) {
    return res.status(400).json({
      ok: false,
      error: 'missing_code',
      message: 'Authorization code not provided'
    });
  }

  try {
    // Decode state to get farm_id
    const stateData = JSON.parse(Buffer.from(state, 'base64').toString('utf-8'));
    const farmId = stateData.farm_id;

    // TODO: Exchange code for tokens
    // const tokenResponse = await exchangeCodeForTokens(code);
    
    // PLACEHOLDER: Store tokens (in production, encrypt sensitive data)
    farmStores.qbTokens.setForFarm(farmId, {
      access_token: 'PLACEHOLDER_ACCESS_TOKEN',
      refresh_token: 'PLACEHOLDER_REFRESH_TOKEN',
      realm_id: realmId, // QuickBooks company ID
      expires_at: Date.now() + 3600 * 1000, // 1 hour
      created_at: new Date().toISOString()
    });

    res.json({
      ok: true,
      message: 'QuickBooks connected successfully (placeholder)',
      farm_id: farmId,
      realm_id: realmId
    });

  } catch (error) {
    console.error('[quickbooks] OAuth callback failed:', error);
    res.status(500).json({
      ok: false,
      error: 'oauth_failed',
      message: error.message
    });
  }
});

/**
 * GET /api/farm-sales/quickbooks/status
 * Check QuickBooks connection status for this farm
 */
router.get('/status', (req, res) => {
  const farmId = req.farm_id;
  const tokens = farmStores.qbTokens.getAllForFarm(farmId);

  if (!tokens) {
    return res.json({
      ok: true,
      connected: false,
      message: 'QuickBooks not connected'
    });
  }

  const isExpired = tokens.expires_at < Date.now();

  res.json({
    ok: true,
    connected: !isExpired,
    realm_id: tokens.realm_id,
    connected_at: tokens.created_at,
    expires_at: new Date(tokens.expires_at).toISOString(),
    needs_refresh: isExpired
  });
});

/**
 * POST /api/farm-sales/quickbooks/disconnect
 * Disconnect QuickBooks integration
 */
router.post('/disconnect', (req, res) => {
  const farmId = req.farm_id;
  
  farmStores.qbTokens.deleteForFarm(farmId);

  res.json({
    ok: true,
    message: 'QuickBooks disconnected'
  });
});

/**
 * POST /api/farm-sales/quickbooks/sync-invoices
 * Sync orders to QuickBooks as invoices
 * 
 * Body:
 * - order_ids: Array of order IDs to sync (optional, defaults to unsynced orders)
 */
router.post('/sync-invoices', async (req, res) => {
  try {
    const farmId = req.farm_id;
    const { order_ids } = req.body;

    // Check connection
    const tokens = farmStores.qbTokens.getAllForFarm(farmId);
    if (!tokens) {
      return res.status(400).json({
        ok: false,
        error: 'not_connected',
        message: 'QuickBooks not connected. Call /auth first.'
      });
    }

    // Get orders to sync
    let orders = farmStores.orders.getAllForFarm(farmId);
    
    if (order_ids && order_ids.length > 0) {
      orders = orders.filter(o => order_ids.includes(o.order_id));
    } else {
      // Only sync orders not yet synced
      orders = orders.filter(o => !o.quickbooks_synced);
    }

    // TODO: Sync each order to QuickBooks
    const syncResults = [];
    for (const order of orders) {
      // PLACEHOLDER: Create invoice in QuickBooks
      const invoiceData = {
        CustomerRef: { value: order.customer?.customer_id || 'UNKNOWN' },
        Line: order.items.map(item => ({
          Amount: item.line_total || item.quantity * item.unit_price,
          DetailType: 'SalesItemLineDetail',
          SalesItemLineDetail: {
            ItemRef: { value: item.sku_id },
            Qty: item.quantity,
            UnitPrice: item.unit_price
          }
        })),
        TxnDate: order.timestamps.created_at.split('T')[0],
        DocNumber: order.order_id
      };

      syncResults.push({
        order_id: order.order_id,
        status: 'pending',
        message: 'Placeholder - QuickBooks SDK not installed',
        invoice_data: invoiceData
      });

      // Mark as synced (in production, only after successful API call)
      order.quickbooks_synced = true;
      order.quickbooks_invoice_id = `INV-${order.order_id}`;
    }

    res.json({
      ok: true,
      farm_id: farmId,
      synced_count: syncResults.length,
      results: syncResults
    });

  } catch (error) {
    console.error('[quickbooks] Invoice sync failed:', error);
    res.status(500).json({
      ok: false,
      error: 'sync_failed',
      message: error.message
    });
  }
});

/**
 * POST /api/farm-sales/quickbooks/sync-payments
 * Sync payments to QuickBooks
 * 
 * Body:
 * - payment_ids: Array of payment IDs to sync (optional)
 */
router.post('/sync-payments', async (req, res) => {
  try {
    const farmId = req.farm_id;
    const { payment_ids } = req.body;

    // Check connection
    const tokens = farmStores.qbTokens.getAllForFarm(farmId);
    if (!tokens) {
      return res.status(400).json({
        ok: false,
        error: 'not_connected',
        message: 'QuickBooks not connected'
      });
    }

    // Get payments to sync
    let payments = farmStores.payments.getAllForFarm(farmId);
    
    if (payment_ids && payment_ids.length > 0) {
      payments = payments.filter(p => payment_ids.includes(p.payment_id));
    } else {
      payments = payments.filter(p => !p.quickbooks_synced);
    }

    const syncResults = [];
    for (const payment of payments) {
      // PLACEHOLDER: Create payment in QuickBooks
      const paymentData = {
        CustomerRef: { value: payment.customer_id || 'UNKNOWN' },
        TotalAmt: payment.amount,
        PaymentMethodRef: { value: payment.method === 'card' ? 'CreditCard' : 'Cash' },
        TxnDate: payment.timestamps.created_at.split('T')[0]
      };

      syncResults.push({
        payment_id: payment.payment_id,
        status: 'pending',
        message: 'Placeholder - QuickBooks SDK not installed',
        payment_data: paymentData
      });

      payment.quickbooks_synced = true;
    }

    res.json({
      ok: true,
      farm_id: farmId,
      synced_count: syncResults.length,
      results: syncResults
    });

  } catch (error) {
    console.error('[quickbooks] Payment sync failed:', error);
    res.status(500).json({
      ok: false,
      error: 'sync_failed',
      message: error.message
    });
  }
});

/**
 * POST /api/farm-sales/quickbooks/webhook
 * Handle webhooks from QuickBooks (payment status updates, etc.)
 */
router.post('/webhook', (req, res) => {
  try {
    const { eventNotifications } = req.body;

    console.log('[quickbooks] Webhook received:', eventNotifications);

    // TODO: Process webhook events
    // - Payment received
    // - Invoice status changed
    // - Customer updated

    res.json({
      ok: true,
      message: 'Webhook received (placeholder)'
    });

  } catch (error) {
    console.error('[quickbooks] Webhook processing failed:', error);
    res.status(500).json({
      ok: false,
      error: 'webhook_failed',
      message: error.message
    });
  }
});

export default router;
