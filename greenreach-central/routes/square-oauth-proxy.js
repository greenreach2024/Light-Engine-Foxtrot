/**
 * Square OAuth Proxy Routes
 * Proxies Square OAuth flow between Central and farm edge devices.
 * Actual Square integration requires SQUARE_APP_ID and SQUARE_APP_SECRET
 * environment variables to be set.
 */
import express from 'express';

const router = express.Router();

const SQUARE_APP_ID = process.env.SQUARE_APP_ID || process.env.SQUARE_APPLICATION_ID || null;
const SQUARE_APP_SECRET = process.env.SQUARE_APP_SECRET || process.env.SQUARE_APPLICATION_SECRET || null;
const SQUARE_ENVIRONMENT = process.env.SQUARE_ENVIRONMENT || 'sandbox';
const SQUARE_BASE = SQUARE_ENVIRONMENT === 'production'
  ? 'https://connect.squareup.com'
  : 'https://connect.squareupsandbox.com';

/**
 * GET /api/square-proxy/
 * Returns Square integration configuration status.
 */
router.get('/', (_req, res) => {
  res.json({
    success: true,
    configured: !!(SQUARE_APP_ID && SQUARE_APP_SECRET),
    environment: SQUARE_ENVIRONMENT,
    message: SQUARE_APP_ID
      ? 'Square OAuth proxy ready'
      : 'Square not configured — set SQUARE_APP_ID and SQUARE_APP_SECRET env vars',
  });
});

/**
 * GET /api/square-proxy/authorize
 * Returns the Square OAuth authorization URL for the requesting farm.
 */
router.get('/authorize', (req, res) => {
  if (!SQUARE_APP_ID) {
    return res.status(503).json({ success: false, error: 'Square not configured' });
  }

  const farmId = req.farmId || req.query.farm_id;
  const redirectUri = `${req.protocol}://${req.get('host')}/api/square-proxy/callback`;
  const state = Buffer.from(JSON.stringify({ farm_id: farmId, ts: Date.now() })).toString('base64url');

  const authUrl = `${SQUARE_BASE}/oauth2/authorize?client_id=${SQUARE_APP_ID}&scope=ITEMS_READ+ITEMS_WRITE+ORDERS_READ+ORDERS_WRITE+PAYMENTS_READ+MERCHANT_PROFILE_READ&session=false&state=${state}&redirect_uri=${encodeURIComponent(redirectUri)}`;

  res.json({ success: true, authUrl, state });
});

/**
 * GET /api/square-proxy/callback
 * Handles the Square OAuth callback — exchanges code for token.
 */
router.get('/callback', async (req, res) => {
  if (!SQUARE_APP_ID || !SQUARE_APP_SECRET) {
    return res.status(503).json({ success: false, error: 'Square not configured' });
  }

  const { code, state } = req.query;
  if (!code) return res.status(400).json({ success: false, error: 'No authorization code' });

  try {
    const response = await fetch(`${SQUARE_BASE}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: SQUARE_APP_ID,
        client_secret: SQUARE_APP_SECRET,
        code,
        grant_type: 'authorization_code',
      }),
    });
    const data = await response.json();

    if (!response.ok) {
      return res.status(400).json({ success: false, error: 'Token exchange failed', details: data });
    }

    // Parse farm_id from state
    let farmId = null;
    try { farmId = JSON.parse(Buffer.from(state, 'base64url').toString()).farm_id; } catch {}

    // Store token via farmStore if available
    if (req.farmStore && farmId) {
      await req.farmStore.set(farmId, 'square_oauth', {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_at: data.expires_at,
        merchant_id: data.merchant_id,
        connected_at: new Date().toISOString(),
      });
    }

    res.json({ success: true, merchant_id: data.merchant_id, farm_id: farmId, message: 'Square connected' });
  } catch (err) {
    console.error('[SquareProxy] Callback error:', err.message);
    res.status(500).json({ success: false, error: 'OAuth callback failed' });
  }
});

/**
 * POST /api/square-proxy/disconnect
 * Revokes Square OAuth token for a farm.
 */
router.post('/disconnect', async (req, res) => {
  const farmId = req.farmId || req.body?.farm_id;
  if (req.farmStore && farmId) {
    await req.farmStore.remove(farmId, 'square_oauth');
  }
  res.json({ success: true, message: 'Square disconnected' });
});

export default router;
