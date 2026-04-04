/**
 * Farm Sales - QuickBooks Integration
 * Sync invoices and payments with QuickBooks Online
 * 
 * SETUP REQUIRED:
 * 1. Create QuickBooks developer account at developer.intuit.com
 * 2. Create app and obtain Client ID and Client Secret
 * 3. Set environment variables:
 *    - QUICKBOOKS_CLIENT_ID: QuickBooks app client ID
 *    - QUICKBOOKS_CLIENT_SECRET: QuickBooks app client secret
 *    - QUICKBOOKS_REDIRECT_URI: OAuth callback URL (e.g., http://localhost:8091/api/farm-sales/quickbooks/callback)
 *    - QUICKBOOKS_ENVIRONMENT: 'sandbox' or 'production'
 * 
 * MULTI-TENANT ARCHITECTURE:
 * - Each farm has separate QuickBooks connection
 * - OAuth tokens stored per farm_id
 * - Realm ID (company ID) stored in farm config
 */

import express from 'express';
import { farmAuthMiddleware } from '../../lib/farm-auth.js';
import { farmStores } from '../../lib/farm-store.js';
import { query as dbQuery } from '../../lib/database.js';
import { 
  generateAuthUrl, 
  exchangeCodeForToken, 
  refreshAccessToken,
  revokeToken,
  getUserInfo,
  isTokenExpired
} from '../../services/quickbooks-oauth.js';
import {
  syncCustomer,
  syncProduct,
  syncInvoice,
  syncPayment,
  batchSyncOrders
} from '../../services/quickbooks-sync.js';

const router = express.Router();

// Initialize QuickBooks token store (multi-tenant, DB-backed with in-memory cache)
if (!farmStores.qbTokens) {
  farmStores.qbTokens = {
    _cache: {},
    getAllForFarm: async (farmId) => {
      // Check cache first
      if (farmStores.qbTokens._cache[farmId]) {
        return farmStores.qbTokens._cache[farmId];
      }
      // Try database
      try {
        const result = await dbQuery(
          `SELECT data FROM farm_data WHERE farm_id = $1 AND data_type = 'quickbooks_oauth'`,
          [farmId]
        );
        if (result.rows.length && result.rows[0].data) {
          const data = typeof result.rows[0].data === 'string'
            ? JSON.parse(result.rows[0].data) : result.rows[0].data;
          farmStores.qbTokens._cache[farmId] = data;
          return data;
        }
      } catch (e) {
        console.warn('[QB] DB token lookup failed, using cache:', e.message);
      }
      return null;
    },
    setForFarm: async (farmId, data) => {
      farmStores.qbTokens._cache[farmId] = data;
      // Persist to database
      try {
        await dbQuery(
          `INSERT INTO farm_data (farm_id, data_type, data, updated_at)
           VALUES ($1, 'quickbooks_oauth', $2, NOW())
           ON CONFLICT (farm_id, data_type)
           DO UPDATE SET data = $2, updated_at = NOW()`,
          [farmId, JSON.stringify(data)]
        );
      } catch (e) {
        console.warn('[QB] DB token persist failed:', e.message);
      }
      return data;
    },
    deleteForFarm: async (farmId) => {
      delete farmStores.qbTokens._cache[farmId];
      try {
        await dbQuery(
          `DELETE FROM farm_data WHERE farm_id = $1 AND data_type = 'quickbooks_oauth'`,
          [farmId]
        );
      } catch (e) {
        console.warn('[QB] DB token delete failed:', e.message);
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

  try {
    // Check if QuickBooks credentials are configured
    if (!process.env.QUICKBOOKS_CLIENT_ID || !process.env.QUICKBOOKS_CLIENT_SECRET) {
      return res.status(501).json({
        ok: false,
        error: 'quickbooks_not_configured',
        message: 'QuickBooks integration requires QUICKBOOKS_CLIENT_ID and QUICKBOOKS_CLIENT_SECRET environment variables',
        setup_guide: 'See routes/farm-sales/quickbooks.js header for setup instructions'
      });
    }

    // Generate authorization URL with state
    const { authUrl, state } = generateAuthUrl(farmId);
    
    // Store state for CSRF validation
    if (!farmStores.qbStates) {
      farmStores.qbStates = {};
    }
    farmStores.qbStates[farmId] = state;

    res.json({
      ok: true,
      auth_url: authUrl,
      instructions: 'Redirect user to auth_url to begin OAuth flow'
    });
    
  } catch (error) {
    console.error('[QuickBooks] Auth URL generation failed:', error);
    res.status(500).json({
      ok: false,
      error: 'auth_failed',
      message: error.message
    });
  }
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
    // Validate state and extract farm_id
    const [farmId, expectedState] = state.split(':');
    const storedState = farmStores.qbStates?.[farmId];
    
    if (storedState !== expectedState) {
      return res.status(400).json({
        ok: false,
        error: 'invalid_state',
        message: 'State parameter validation failed (CSRF protection)'
      });
    }
    
    // Clean up state
    delete farmStores.qbStates[farmId];
    
    // Exchange code for tokens
    const tokenData = await exchangeCodeForToken(code);
    tokenData.realm_id = realmId;
    
    // Store tokens for this farm
    await farmStores.qbTokens.setForFarm(farmId, tokenData);
    
    // Get user info for confirmation
    const userInfo = await getUserInfo(tokenData.access_token);
    
    res.json({
      ok: true,
      message: 'QuickBooks connected successfully',
      company_id: realmId,
      user_email: userInfo.email,
      connected_at: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('[QuickBooks] OAuth callback failed:', error);
    res.status(500).json({
      ok: false,
      error: 'callback_failed',
      message: error.message
    });
  }
});

/**
 * GET /api/farm-sales/quickbooks/status
 * Check QuickBooks connection status for this farm
 */
router.get('/status', async (req, res) => {
  const farmId = req.farm_id;
  
  try {
    const tokenData = await farmStores.qbTokens.getAllForFarm(farmId);
    
    if (!tokenData) {
      return res.json({
        ok: true,
        connected: false,
        message: 'QuickBooks not connected'
      });
    }
    
    // Check if token is expired
    const expired = isTokenExpired(tokenData);
    
    if (expired) {
      // Attempt to refresh
      try {
        const newTokenData = await refreshAccessToken(tokenData.refresh_token);
        newTokenData.realm_id = tokenData.realm_id;
        await farmStores.qbTokens.setForFarm(farmId, newTokenData);
        
        return res.json({
          ok: true,
          connected: true,
          company_id: tokenData.realm_id,
          token_refreshed: true
        });
        
      } catch (refreshError) {
        return res.json({
          ok: true,
          connected: false,
          expired: true,
          message: 'Token expired and refresh failed - reconnection required'
        });
      }
    }
    
    res.json({
      ok: true,
      connected: true,
      company_id: tokenData.realm_id,
      connected_at: tokenData.created_at
    });
    
  } catch (error) {
    console.error('[QuickBooks] Status check failed:', error);
    res.status(500).json({
      ok: false,
      error: 'status_check_failed',
      message: error.message
    });
  }
});

/**
 * POST /api/farm-sales/quickbooks/disconnect
 * Disconnect QuickBooks integration (revoke tokens)
 */
router.post('/disconnect', async (req, res) => {
  const farmId = req.farm_id;
  
  try {
    const tokenData = await farmStores.qbTokens.getAllForFarm(farmId);
    
    if (tokenData?.access_token) {
      await revokeToken(tokenData.access_token);
    }
    
    await farmStores.qbTokens.deleteForFarm(farmId);
    
    res.json({
      ok: true,
      message: 'QuickBooks disconnected successfully'
    });
    
  } catch (error) {
    console.error('[QuickBooks] Disconnect failed:', error);
    res.status(500).json({
      ok: false,
      error: 'disconnect_failed',
      message: error.message
    });
  }
});

/**
 * POST /api/farm-sales/quickbooks/sync/customer
 * Sync a customer to QuickBooks
 */
router.post('/sync/customer', async (req, res) => {
  const farmId = req.farm_id;
  const { customer_id } = req.body;
  
  try {
    const tokenData = await farmStores.qbTokens.getAllForFarm(farmId);
    
    if (!tokenData) {
      return res.status(400).json({
        ok: false,
        error: 'not_connected',
        message: 'QuickBooks not connected'
      });
    }
    
    // Get customer data
    const customer = farmStores.customers.getAllForFarm(farmId)
      .find(c => c.id === customer_id);
    
    if (!customer) {
      return res.status(404).json({
        ok: false,
        error: 'customer_not_found'
      });
    }
    
    const result = await syncCustomer(customer, tokenData);
    
    if (result.success) {
      res.json({
        ok: true,
        ...result
      });
    } else {
      res.status(500).json({
        ok: false,
        ...result
      });
    }
    
  } catch (error) {
    console.error('[QuickBooks] Customer sync failed:', error);
    res.status(500).json({
      ok: false,
      error: 'sync_failed',
      message: error.message
    });
  }
});

/**
 * POST /api/farm-sales/quickbooks/sync/orders
 * Batch sync orders to QuickBooks
 */
router.post('/sync/orders', async (req, res) => {
  const farmId = req.farm_id;
  const { start_date, end_date } = req.body;
  
  try {
    const tokenData = await farmStores.qbTokens.getAllForFarm(farmId);
    
    if (!tokenData) {
      return res.status(400).json({
        ok: false,
        error: 'not_connected',
        message: 'QuickBooks not connected'
      });
    }
    
    // Get orders in date range
    const startDate = new Date(start_date);
    const endDate = new Date(end_date);
    
    const orders = farmStores.orders.getAllForFarm(farmId)
      .filter(o => {
        const orderDate = new Date(o.timestamps.created_at);
        return orderDate >= startDate && orderDate <= endDate;
      });
    
    if (orders.length === 0) {
      return res.json({
        ok: true,
        message: 'No orders to sync',
        total: 0
      });
    }
    
    const result = await batchSyncOrders(orders, tokenData);
    
    res.json({
      ok: true,
      ...result
    });
    
  } catch (error) {
    console.error('[QuickBooks] Orders sync failed:', error);
    res.status(500).json({
      ok: false,
      error: 'sync_failed',
      message: error.message
    });
  }
});

/**
 * GET /api/farm-sales/quickbooks/status
 * Check QuickBooks connection status for this farm
 */
router.get('/status', async (req, res) => {
  const farmId = req.farm_id;
  const tokens = await farmStores.qbTokens.getAllForFarm(farmId);

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
  
  await farmStores.qbTokens.deleteForFarm(farmId);

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
    const tokens = await farmStores.qbTokens.getAllForFarm(farmId);
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
    const tokens = await farmStores.qbTokens.getAllForFarm(farmId);
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
