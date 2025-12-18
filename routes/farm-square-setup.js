/**
 * Farm Square Payment Setup API
 * 
 * Handles individual farm Square account configuration for payment processing.
 * This is separate from GreenReach's Square account (used for Light Engine subscriptions).
 * 
 * Each farm connects their own Square account to process customer payments.
 */

import express from 'express';
import crypto from 'crypto';

const router = express.Router();

// In-memory storage (TODO: migrate to database)
const farmSquareAccounts = new Map(); // farm_id -> square config
const oauthStates = new Map(); // state_token -> { farm_id, timestamp }

// Square OAuth configuration (Sandbox for testing)
const SQUARE_ENVIRONMENT = process.env.SQUARE_ENVIRONMENT || 'sandbox';
const SQUARE_APPLICATION_ID = process.env.SQUARE_APPLICATION_ID;
const SQUARE_APPLICATION_SECRET = process.env.SQUARE_APPLICATION_SECRET;
const OAUTH_REDIRECT_URI = process.env.OAUTH_REDIRECT_URI || 'http://localhost:8091/api/farm/square/callback';

/**
 * GET /api/farm/square/status
 * 
 * Check if farm has Square connected
 */
router.get('/status', async (req, res) => {
  try {
    const farmId = req.headers['x-farm-id'] || 'FARM-001';
    
    const account = farmSquareAccounts.get(farmId);
    
    if (!account) {
      return res.json({
        ok: true,
        connected: false,
        message: 'No Square account connected'
      });
    }
    
    res.json({
      ok: true,
      connected: true,
      data: {
        merchantId: account.merchantId,
        locationId: account.locationId,
        locationName: account.locationName,
        connectedAt: account.connectedAt,
        status: account.status
      }
    });
  } catch (error) {
    console.error('[farm-square] Status check error:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to check Square status',
      message: error.message
    });
  }
});

/**
 * POST /api/farm/square/authorize
 * 
 * Generate Square OAuth URL for farm to connect their account
 * 
 * Body:
 * {
 *   farmId: string,
 *   farmName: string
 * }
 */
router.post('/authorize', async (req, res) => {
  try {
    const { farmId, farmName } = req.body;
    
    if (!farmId || !farmName) {
      return res.status(400).json({
        ok: false,
        error: 'farmId and farmName are required'
      });
    }
    
    // Generate state token for CSRF protection
    const stateToken = crypto.randomBytes(32).toString('hex');
    oauthStates.set(stateToken, {
      farm_id: farmId,
      farm_name: farmName,
      timestamp: Date.now()
    });
    
    // Clean up old state tokens (>10 minutes old)
    for (const [token, data] of oauthStates.entries()) {
      if (Date.now() - data.timestamp > 600000) {
        oauthStates.delete(token);
      }
    }
    
    // Build Square OAuth URL
    const baseUrl = SQUARE_ENVIRONMENT === 'production' 
      ? 'https://connect.squareup.com'
      : 'https://connect.squareupsandbox.com';
    
    const scopes = [
      'PAYMENTS_WRITE',
      'MERCHANT_PROFILE_READ',
      'ORDERS_WRITE',
      'ORDERS_READ'
    ];
    
    const authUrl = `${baseUrl}/oauth2/authorize?` + new URLSearchParams({
      client_id: SQUARE_APPLICATION_ID,
      scope: scopes.join(' '),
      session: 'false',
      state: stateToken
    });
    
    res.json({
      ok: true,
      data: {
        authorizationUrl: authUrl,
        state: stateToken,
        expiresIn: 600 // 10 minutes
      }
    });
  } catch (error) {
    console.error('[farm-square] Authorization error:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to generate authorization URL',
      message: error.message
    });
  }
});

/**
 * GET /api/farm/square/callback
 * 
 * OAuth callback from Square
 */
router.get('/callback', async (req, res) => {
  try {
    const { code, state, error } = req.query;
    
    if (error) {
      return res.status(400).send(`
        <html>
          <head>
            <title>Square Connection Failed</title>
            <style>
              body { font-family: sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
              .error { background: #fee; border: 1px solid #fcc; padding: 15px; border-radius: 8px; }
            </style>
          </head>
          <body>
            <h1>Square Connection Failed</h1>
            <div class="error">
              <strong>Error:</strong> ${error}
            </div>
            <p><a href="/">Return to Dashboard</a></p>
          </body>
        </html>
      `);
    }
    
    // Validate state token
    const stateData = oauthStates.get(state);
    if (!stateData) {
      return res.status(400).send(`
        <html>
          <head><title>Invalid Request</title></head>
          <body>
            <h1>Invalid Request</h1>
            <p>Invalid or expired state token. Please try again.</p>
            <a href="/">Return to Dashboard</a>
          </body>
        </html>
      `);
    }
    
    const { farm_id, farm_name } = stateData;
    oauthStates.delete(state); // One-time use
    
    // In production, exchange code for tokens here
    // For now, simulate successful connection
    const mockAccount = {
      merchantId: 'MERCHANT_' + Date.now(),
      locationId: 'LOCATION_' + Date.now(),
      locationName: farm_name + ' - Main Location',
      accessToken: '[encrypted]',
      refreshToken: '[encrypted]',
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days
      connectedAt: new Date().toISOString(),
      status: 'active'
    };
    
    farmSquareAccounts.set(farm_id, mockAccount);
    
    res.send(`
      <html>
        <head>
          <title>Square Connected</title>
          <style>
            body { font-family: sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
            .success { background: #d1fae5; border: 1px solid #6ee7b7; padding: 15px; border-radius: 8px; }
            a { display: inline-block; background: #2e7d32; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; margin-top: 20px; }
          </style>
        </head>
        <body>
          <h1>Square Account Connected!</h1>
          <div class="success">
            <strong>Success!</strong> ${farm_name} is now connected to Square.
            <p>Merchant ID: ${mockAccount.merchantId}</p>
            <p>Location: ${mockAccount.locationName}</p>
          </div>
          <a href="/">Return to Dashboard</a>
          <script>
            // Close window and notify parent if opened in popup
            if (window.opener) {
              window.opener.postMessage({ type: 'square-connected', farmId: '${farm_id}' }, '*');
              setTimeout(() => window.close(), 2000);
            }
          </script>
        </body>
      </html>
    `);
  } catch (error) {
    console.error('[farm-square] Callback error:', error);
    res.status(500).send(`
      <html>
        <head><title>Error</title></head>
        <body>
          <h1>Connection Error</h1>
          <p>An error occurred while connecting to Square.</p>
          <p>${error.message}</p>
          <a href="/">Return to Dashboard</a>
        </body>
      </html>
    `);
  }
});

/**
 * POST /api/farm/square/settings
 * 
 * Save payment processing settings
 */
router.post('/settings', async (req, res) => {
  try {
    const farmId = req.headers['x-farm-id'] || req.body.farmId || 'FARM-001';
    const settings = req.body;
    
    const account = farmSquareAccounts.get(farmId);
    if (!account) {
      return res.status(404).json({
        ok: false,
        error: 'Square account not connected. Please connect Square first.'
      });
    }
    
    // Update account with settings
    account.settings = {
      paymentMethods: settings.paymentMethods || { cards: true, ach: false, cash: false, giftCards: false },
      taxRate: settings.taxRate || 0,
      receiptFromName: settings.receiptFromName || '',
      autoReceipt: settings.autoReceipt !== false,
      updatedAt: new Date().toISOString()
    };
    
    farmSquareAccounts.set(farmId, account);
    
    res.json({
      ok: true,
      message: 'Settings saved successfully',
      data: account.settings
    });
  } catch (error) {
    console.error('[farm-square] Settings save error:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to save settings',
      message: error.message
    });
  }
});

/**
 * POST /api/farm/square/disconnect
 * 
 * Disconnect Square account
 */
router.post('/disconnect', async (req, res) => {
  try {
    const farmId = req.headers['x-farm-id'] || req.body.farmId || 'FARM-001';
    
    if (!farmSquareAccounts.has(farmId)) {
      return res.status(404).json({
        ok: false,
        error: 'No Square account connected'
      });
    }
    
    // In production, revoke tokens here
    farmSquareAccounts.delete(farmId);
    
    res.json({
      ok: true,
      message: 'Square account disconnected successfully'
    });
  } catch (error) {
    console.error('[farm-square] Disconnect error:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to disconnect Square',
      message: error.message
    });
  }
});

/**
 * POST /api/farm/square/test-payment
 * 
 * Test payment processing (sandbox only)
 */
router.post('/test-payment', async (req, res) => {
  try {
    const farmId = req.headers['x-farm-id'] || req.body.farmId || 'FARM-001';
    const { amount } = req.body;
    
    const account = farmSquareAccounts.get(farmId);
    if (!account) {
      return res.status(404).json({
        ok: false,
        error: 'Square account not connected'
      });
    }
    
    // Simulate test payment
    const testResult = {
      transactionId: 'TEST_' + Date.now(),
      amount: amount || 10.00,
      status: 'COMPLETED',
      timestamp: new Date().toISOString(),
      environment: 'sandbox'
    };
    
    res.json({
      ok: true,
      message: 'Test payment successful',
      data: testResult
    });
  } catch (error) {
    console.error('[farm-square] Test payment error:', error);
    res.status(500).json({
      ok: false,
      error: 'Test payment failed',
      message: error.message
    });
  }
});

export default router;
