/**
 * Farm Square Payment Setup API (Production)
 *
 * Handles individual farm Square account configuration for payment processing.
 * This is separate from GreenReach's Square account (used for Light Engine subscriptions)
 * and from the wholesale Square OAuth flow (wholesale/square-oauth.js).
 *
 * Each farm connects their own Square account to process customer payments
 * (POS retail, online store, subscriptions).
 *
 * Security:
 * - Tokens encrypted at rest using AES-256-GCM
 * - State parameter prevents CSRF attacks
 * - XSS protection via escapeHtml in callback HTML
 * - Token refresh before expiry
 */

import express from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Client as SquareClient } from 'square';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const router = express.Router();

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const SQUARE_ENVIRONMENT = process.env.SQUARE_ENVIRONMENT || 'production';
const SQUARE_APPLICATION_ID = process.env.SQUARE_APPLICATION_ID;
const SQUARE_APPLICATION_SECRET = process.env.SQUARE_APPLICATION_SECRET;
const OAUTH_REDIRECT_URI = process.env.FARM_SQUARE_REDIRECT_URI
  || process.env.OAUTH_REDIRECT_URI
  || null; // Must be set via env var in production

const OAUTH_SCOPES = [
  'PAYMENTS_WRITE',
  'MERCHANT_PROFILE_READ',
  'ORDERS_WRITE',
  'ORDERS_READ'
];

// ---------------------------------------------------------------------------
// Encryption (AES-256-GCM) -- mirrors wholesale/square-oauth.js pattern
// ---------------------------------------------------------------------------
const IS_PROD_LIKE = process.env.NODE_ENV === 'production'
  || process.env.DEPLOYMENT_MODE === 'edge'
  || process.env.DEPLOYMENT_MODE === 'cloud';

if (IS_PROD_LIKE && !process.env.TOKEN_ENCRYPTION_KEY) {
  console.error('[farm-square] TOKEN_ENCRYPTION_KEY is required in production');
}
const RAW_ENCRYPTION_KEY = process.env.TOKEN_ENCRYPTION_KEY || null;
const ENCRYPTION_KEY = RAW_ENCRYPTION_KEY
  ? (RAW_ENCRYPTION_KEY.length === 64 ? Buffer.from(RAW_ENCRYPTION_KEY, 'hex') : Buffer.from(RAW_ENCRYPTION_KEY).subarray(0, 32))
  : crypto.randomBytes(32);
const ENCRYPTION_ALGORITHM = 'aes-256-gcm';

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function encryptToken(token) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(token, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();
  return { encrypted, iv: iv.toString('hex'), authTag: authTag.toString('hex') };
}

function decryptToken(encryptedData) {
  if (!encryptedData || !encryptedData.iv) return null;
  const decipher = crypto.createDecipheriv(
    ENCRYPTION_ALGORITHM,
    ENCRYPTION_KEY,
    Buffer.from(encryptedData.iv, 'hex')
  );
  decipher.setAuthTag(Buffer.from(encryptedData.authTag, 'hex'));
  let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

function getStateSigningKey() {
  const candidate = process.env.SQUARE_APPLICATION_SECRET
    || process.env.TOKEN_ENCRYPTION_KEY
    || 'farm-square-state-dev-key';
  return String(candidate);
}

function createSignedState(stateData) {
  const payload = Buffer.from(JSON.stringify(stateData), 'utf8').toString('base64url');
  const signature = crypto
    .createHmac('sha256', getStateSigningKey())
    .update(payload)
    .digest('base64url');
  return payload + '.' + signature;
}

function verifySignedState(stateToken) {
  if (!stateToken || typeof stateToken !== 'string' || !stateToken.includes('.')) {
    return null;
  }

  const [payload, signature] = stateToken.split('.');
  if (!payload || !signature) return null;

  const expected = crypto
    .createHmac('sha256', getStateSigningKey())
    .update(payload)
    .digest('base64url');

  if (signature !== expected) return null;

  const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  if (!parsed || typeof parsed !== 'object') return null;
  if (!parsed.farm_id || !parsed.redirect_uri || !parsed.timestamp) return null;
  if ((Date.now() - Number(parsed.timestamp)) > 600000) return null;
  return parsed;
}

// ---------------------------------------------------------------------------
// Persistent storage (flat-file in data/ -- encrypted tokens)
// ---------------------------------------------------------------------------
const DATA_DIR = path.join(__dirname, '..', 'data');
const TOKENS_FILE = path.join(DATA_DIR, 'farm-square-tokens.json');
const OAUTH_STATES_FILE = path.join(DATA_DIR, 'farm-square-oauth-states.json');

const farmSquareAccounts = new Map();
const oauthStates = new Map();

function loadTokensFromDisk() {
  try {
    if (fs.existsSync(TOKENS_FILE)) {
      const raw = JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8'));
      if (raw && typeof raw === 'object') {
        for (const [farmId, account] of Object.entries(raw)) {
          farmSquareAccounts.set(farmId, account);
        }
        console.log('[farm-square] Loaded ' + farmSquareAccounts.size + ' account(s) from disk');
      }
    }
  } catch (err) {
    console.warn('[farm-square] Failed to load tokens from disk:', err.message);
  }
}

function saveTokensToDisk() {
  try {
    const obj = {};
    for (const [farmId, account] of farmSquareAccounts.entries()) {
      obj[farmId] = account;
    }
    fs.mkdirSync(path.dirname(TOKENS_FILE), { recursive: true });
    fs.writeFileSync(TOKENS_FILE, JSON.stringify(obj, null, 2), 'utf8');
  } catch (err) {
    console.warn('[farm-square] Failed to save tokens to disk:', err.message);
  }
}

function cleanupExpiredOauthStates() {
  const tenMinutesAgo = Date.now() - 600000;
  let removed = 0;
  for (const [token, data] of oauthStates.entries()) {
    if (!data || data.timestamp < tenMinutesAgo) {
      oauthStates.delete(token);
      removed += 1;
    }
  }
  if (removed > 0) {
    saveOauthStatesToDisk();
  }
  return removed;
}

function loadOauthStatesFromDisk() {
  try {
    if (!fs.existsSync(OAUTH_STATES_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(OAUTH_STATES_FILE, 'utf8'));
    if (!raw || typeof raw !== 'object') return;

    for (const [stateToken, stateData] of Object.entries(raw)) {
      if (!stateData || typeof stateData !== 'object') continue;
      oauthStates.set(stateToken, stateData);
    }

    const removed = cleanupExpiredOauthStates();
    console.log('[farm-square] Loaded ' + oauthStates.size + ' oauth state token(s) from disk (expired removed: ' + removed + ')');
  } catch (err) {
    console.warn('[farm-square] Failed to load oauth states from disk:', err.message);
  }
}

function saveOauthStatesToDisk() {
  try {
    const obj = {};
    for (const [stateToken, stateData] of oauthStates.entries()) {
      obj[stateToken] = stateData;
    }
    fs.mkdirSync(path.dirname(OAUTH_STATES_FILE), { recursive: true });
    fs.writeFileSync(OAUTH_STATES_FILE, JSON.stringify(obj, null, 2), 'utf8');
  } catch (err) {
    console.warn('[farm-square] Failed to save oauth states to disk:', err.message);
  }
}

loadTokensFromDisk();
loadOauthStatesFromDisk();

// ---------------------------------------------------------------------------
// Helper: extract farm ID from request
// ---------------------------------------------------------------------------
function farmIdFromReq(req) {
  return req.headers['x-farm-id']
    || req.body?.farmId
    || req.query?.farmId
    || null;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * GET /api/farm/square/status
 * Check if farm has Square connected
 */
router.get('/status', async (req, res) => {
  try {
    const farmId = farmIdFromReq(req);
    if (!farmId) {
      return res.status(400).json({ ok: false, error: 'x-farm-id header or farmId param required' });
    }

    const account = farmSquareAccounts.get(farmId);

    if (!account) {
      return res.json({ ok: true, connected: false, message: 'No Square account connected' });
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
    res.status(500).json({ ok: false, error: 'Failed to check Square status' });
  }
});

/**
 * POST /api/farm/square/authorize
 * Generate Square OAuth URL for farm to connect their account
 */
router.post('/authorize', async (req, res) => {
  try {
    const { farmId, farmName } = req.body;

    if (!farmId || !farmName) {
      return res.status(400).json({ ok: false, error: 'farmId and farmName are required' });
    }

    if (!SQUARE_APPLICATION_ID) {
      return res.status(503).json({ ok: false, error: 'Square not configured (missing SQUARE_APPLICATION_ID)' });
    }

    // Determine callback URI -- prefer explicit env var, fall back to request origin
    const redirectUri = OAUTH_REDIRECT_URI
      || req.protocol + '://' + req.get('host') + '/api/farm/square/callback';

    // Generate cryptographically secure state token (CSRF protection)
    const statePayload = {
      farm_id: farmId,
      farm_name: farmName,
      redirect_uri: redirectUri,
      timestamp: Date.now(),
      nonce: crypto.randomBytes(16).toString('hex')
    };
    const stateToken = createSignedState(statePayload);

    // Keep legacy map-based state as fallback for old flow compatibility.
    oauthStates.set(stateToken, statePayload);
    saveOauthStatesToDisk();

    // Clean up expired state tokens (> 10 minutes)
    cleanupExpiredOauthStates();

    // Build Square OAuth URL
    const baseUrl = SQUARE_ENVIRONMENT === 'production'
      ? 'https://connect.squareup.com'
      : 'https://connect.squareupsandbox.com';

    const authUrl = baseUrl + '/oauth2/authorize?' + new URLSearchParams({
      client_id: SQUARE_APPLICATION_ID,
      scope: OAUTH_SCOPES.join(' '),
      session: 'false',
      state: stateToken,
      redirect_uri: redirectUri
    });

    res.json({
      ok: true,
      data: {
        authorizationUrl: authUrl,
        state: stateToken,
        expiresIn: 600
      }
    });
  } catch (error) {
    console.error('[farm-square] Authorization error:', error);
    res.status(500).json({ ok: false, error: 'Failed to generate authorization URL' });
  }
});

/**
 * GET /api/farm/square/callback
 * OAuth callback from Square -- exchanges code for real tokens
 */
router.get('/callback', async (req, res) => {
  try {
    console.log('[farm-square] Callback hit. Query params:', JSON.stringify(req.query));
    console.log('[farm-square] Callback raw URL:', req.originalUrl);
    const { code, state, error: sqError } = req.query;

    if (sqError) {
      return res.status(400).send(callbackHtml(
        'Square Connection Failed',
        '<div class="error"><strong>Error:</strong> ' + escapeHtml(sqError) + '</div>',
        false
      ));
    }

    if (!code || !state) {
      return res.status(400).send(callbackHtml(
        'Invalid Request',
        '<p>Missing authorization code or state parameter.</p>',
        false
      ));
    }

    // Validate state token (CSRF protection)
    let stateData = verifySignedState(state);
    if (!stateData) {
      stateData = oauthStates.get(state) || null;
    }

    if (!stateData) {
      console.warn('[farm-square] Callback rejected: invalid/expired state token. State prefix=' + String(state).slice(0, 12));
      return res.status(400).send(callbackHtml(
        'Invalid Request',
        '<p>Invalid or expired state token. Please try again.</p>',
        false
      ));
    }

    const { farm_id, farm_name, redirect_uri } = stateData;
    oauthStates.delete(state); // One-time use for legacy fallback map
    saveOauthStatesToDisk();

    // Exchange authorization code for tokens via direct HTTP (bypasses SDK v37 issues)
    const tokenBaseUrl = SQUARE_ENVIRONMENT === 'production'
      ? 'https://connect.squareup.com'
      : 'https://connect.squareupsandbox.com';

    const tokenBody = {
      client_id: SQUARE_APPLICATION_ID,
      client_secret: SQUARE_APPLICATION_SECRET,
      code: code,
      grant_type: 'authorization_code',
      redirect_uri: redirect_uri
    };

    console.log('[farm-square] Token exchange request:', JSON.stringify({
      url: tokenBaseUrl + '/oauth2/token',
      client_id: SQUARE_APPLICATION_ID,
      code_prefix: String(code).slice(0, 8) + '...',
      code_length: String(code).length,
      grant_type: 'authorization_code',
      redirect_uri: redirect_uri,
      has_secret: !!SQUARE_APPLICATION_SECRET,
      secret_prefix: String(SQUARE_APPLICATION_SECRET).slice(0, 8) + '...'
    }));

    const tokenFetchRes = await fetch(tokenBaseUrl + '/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Square-Version': '2025-01-23' },
      body: JSON.stringify(tokenBody)
    });

    const tokenJson = await tokenFetchRes.json();
    console.log('[farm-square] Token exchange response: status=' + tokenFetchRes.status + ' body=' + JSON.stringify(tokenJson));

    if (!tokenFetchRes.ok || tokenJson.errors) {
      const errDetail = (tokenJson.errors && tokenJson.errors[0] && tokenJson.errors[0].detail) || 'Token exchange failed';
      throw new Error('Square token exchange ' + tokenFetchRes.status + ': ' + errDetail);
    }

    const accessToken = tokenJson.access_token;
    const refreshToken = tokenJson.refresh_token;
    const expiresAt = tokenJson.expires_at;
    const merchantId = tokenJson.merchant_id;

    // Fetch default location
    const authClient = new SquareClient({
      environment: SQUARE_ENVIRONMENT,
      accessToken: accessToken
    });
    const locationsResponse = await authClient.locationsApi.listLocations();
    const locations = locationsResponse.result.locations || [];
    const defaultLocation = locations.find(loc => loc.status === 'ACTIVE') || locations[0];

    if (!defaultLocation) {
      throw new Error('No active locations found for merchant');
    }

    // Encrypt tokens before storage
    const encryptedAccess = encryptToken(accessToken);
    const encryptedRefresh = encryptToken(refreshToken);

    const account = {
      merchantId: merchantId,
      locationId: defaultLocation.id,
      locationName: defaultLocation.name,
      accessToken: encryptedAccess,
      refreshToken: encryptedRefresh,
      expiresAt: expiresAt,
      connectedAt: new Date().toISOString(),
      status: 'active'
    };

    farmSquareAccounts.set(farm_id, account);
    saveTokensToDisk();

    console.log('[farm-square] ' + farm_name + ' (' + farm_id + ') connected -- merchant: ' + merchantId + ', location: ' + defaultLocation.name);

    res.send(callbackHtml(
      'Square Account Connected',
      '<div class="success"><strong>Success!</strong> ' + escapeHtml(farm_name) + ' is now connected to Square.'
        + '<p>Merchant ID: ' + escapeHtml(merchantId) + '</p>'
        + '<p>Location: ' + escapeHtml(defaultLocation.name) + '</p></div>',
      true,
      farm_id,
      { merchantId: merchantId, merchantName: farm_name, locationId: defaultLocation.id, locationName: defaultLocation.name }
    ));
  } catch (error) {
    console.error('[farm-square] Callback error:', error);
    res.status(500).send(callbackHtml(
      'Connection Error',
      '<p>An error occurred while connecting to Square: ' + escapeHtml(error.message) + '</p>',
      false
    ));
  }
});

/**
 * POST /api/farm/square/refresh
 * Refresh Square access token using refresh token
 */
router.post('/refresh', async (req, res) => {
  try {
    const farmId = farmIdFromReq(req) || req.body?.farmId;
    if (!farmId) {
      return res.status(400).json({ ok: false, error: 'farmId is required' });
    }

    const account = farmSquareAccounts.get(farmId);
    if (!account) {
      return res.status(404).json({ ok: false, error: 'Farm not found or not connected' });
    }

    const refreshToken = decryptToken(account.refreshToken);
    if (!refreshToken) {
      return res.status(500).json({ ok: false, error: 'Unable to decrypt refresh token' });
    }

    const squareClient = new SquareClient({
      environment: SQUARE_ENVIRONMENT,
      accessToken: ''
    });

    const tokenResponse = await squareClient.oAuthApi.obtainToken({
      clientId: SQUARE_APPLICATION_ID,
      clientSecret: SQUARE_APPLICATION_SECRET,
      grantType: 'refresh_token',
      refreshToken: refreshToken
    });

    const tokenResult = tokenResponse.result;
    const newAccessToken = tokenResult.accessToken;
    const newRefreshToken = tokenResult.refreshToken || refreshToken;
    const newExpiresAt = tokenResult.expiresAt;

    account.accessToken = encryptToken(newAccessToken);
    account.refreshToken = encryptToken(newRefreshToken);
    account.expiresAt = newExpiresAt;
    account.lastRefreshAt = new Date().toISOString();

    farmSquareAccounts.set(farmId, account);
    saveTokensToDisk();

    console.log('[farm-square] Refreshed token for ' + farmId + ', expires ' + newExpiresAt);

    res.json({
      ok: true,
      data: { expiresAt: newExpiresAt, refreshedAt: account.lastRefreshAt }
    });
  } catch (error) {
    console.error('[farm-square] Token refresh error:', error);
    res.status(500).json({ ok: false, error: 'Failed to refresh token' });
  }
});

/**
 * POST /api/farm/square/settings
 * Save payment processing settings
 */
router.post('/settings', async (req, res) => {
  try {
    const farmId = farmIdFromReq(req) || req.body?.farmId;
    if (!farmId) {
      return res.status(400).json({ ok: false, error: 'farmId is required' });
    }

    const account = farmSquareAccounts.get(farmId);
    if (!account) {
      return res.status(404).json({ ok: false, error: 'Square account not connected' });
    }

    const settings = req.body;
    account.settings = {
      paymentMethods: settings.paymentMethods || { cards: true, ach: false, cash: false, giftCards: false },
      taxRate: settings.taxRate || 0,
      receiptFromName: settings.receiptFromName || '',
      autoReceipt: settings.autoReceipt !== false,
      updatedAt: new Date().toISOString()
    };

    farmSquareAccounts.set(farmId, account);
    saveTokensToDisk();

    res.json({ ok: true, message: 'Settings saved successfully', data: account.settings });
  } catch (error) {
    console.error('[farm-square] Settings save error:', error);
    res.status(500).json({ ok: false, error: 'Failed to save settings' });
  }
});

/**
 * POST /api/farm/square/disconnect
 * Disconnect Square account -- revokes token with Square then removes local data
 */
router.post('/disconnect', async (req, res) => {
  try {
    const farmId = farmIdFromReq(req) || req.body?.farmId;
    if (!farmId) {
      return res.status(400).json({ ok: false, error: 'farmId is required' });
    }

    const account = farmSquareAccounts.get(farmId);
    if (!account) {
      return res.status(404).json({ ok: false, error: 'No Square account connected' });
    }

    // Attempt to revoke the token with Square
    try {
      const accessToken = decryptToken(account.accessToken);
      if (accessToken) {
        const squareClient = new SquareClient({
          environment: SQUARE_ENVIRONMENT,
          accessToken: accessToken
        });
        await squareClient.oAuthApi.revokeToken({
          clientId: SQUARE_APPLICATION_ID,
          accessToken: accessToken
        });
        console.log('[farm-square] Revoked Square token for ' + farmId);
      }
    } catch (revokeError) {
      // Continue with local deletion even if Square revocation fails
      console.warn('[farm-square] Token revocation failed (non-fatal): ' + revokeError.message);
    }

    farmSquareAccounts.delete(farmId);
    saveTokensToDisk();

    res.json({ ok: true, message: 'Square account disconnected successfully' });
  } catch (error) {
    console.error('[farm-square] Disconnect error:', error);
    res.status(500).json({ ok: false, error: 'Failed to disconnect Square' });
  }
});

/**
 * POST /api/farm/square/test-payment
 * Verify Square connectivity by listing locations (non-destructive)
 */
router.post('/test-payment', async (req, res) => {
  try {
    const farmId = farmIdFromReq(req) || req.body?.farmId;
    if (!farmId) {
      return res.status(400).json({ ok: false, error: 'farmId is required' });
    }

    const account = farmSquareAccounts.get(farmId);
    if (!account) {
      return res.status(404).json({ ok: false, error: 'Square account not connected' });
    }

    const accessToken = decryptToken(account.accessToken);
    if (!accessToken) {
      return res.status(500).json({ ok: false, error: 'Unable to decrypt access token' });
    }

    const squareClient = new SquareClient({
      environment: SQUARE_ENVIRONMENT,
      accessToken: accessToken
    });

    const locResp = await squareClient.locationsApi.listLocations();
    const locations = locResp.result.locations || [];
    const activeCount = locations.filter(l => l.status === 'ACTIVE').length;

    res.json({
      ok: true,
      message: 'Square connection verified',
      data: {
        merchantId: account.merchantId,
        locationId: account.locationId,
        activeLocations: activeCount,
        environment: SQUARE_ENVIRONMENT,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('[farm-square] Test payment error:', error);
    res.status(500).json({ ok: false, error: 'Square connection test failed', message: error.message });
  }
});

// ---------------------------------------------------------------------------
// HTML template helper (XSS-safe)
// ---------------------------------------------------------------------------
function callbackHtml(title, bodyContent, success, farmId, merchantData) {
  const md = merchantData || {};
  return '<!DOCTYPE html>'
    + '<html><head>'
    + '<title>' + escapeHtml(title) + '</title>'
    + '<style>'
    + 'body { font-family: -apple-system, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }'
    + 'h1 { color: ' + (success ? '#2d5016' : '#991b1b') + '; }'
    + '.success { background: #d1fae5; border: 1px solid #6ee7b7; padding: 15px; border-radius: 8px; }'
    + '.error { background: #fee2e2; border: 1px solid #fecaca; padding: 15px; border-radius: 8px; }'
    + 'a { display: inline-block; background: #2e7d32; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; margin-top: 20px; }'
    + '</style></head><body>'
    + '<h1>' + escapeHtml(title) + '</h1>'
    + bodyContent
    + '<a href="/LE-dashboard.html' + (farmId ? '?farmId=' + encodeURIComponent(farmId) : '') + '">Return to Dashboard</a>'
    + (success && farmId
      ? '<script>'
        + 'var signalData={type:"square-connected"'
        + ',farmId:' + JSON.stringify(farmId)
        + ',merchantId:' + JSON.stringify(md.merchantId || '')
        + ',merchantName:' + JSON.stringify(md.merchantName || '')
        + ',locationId:' + JSON.stringify(md.locationId || '')
        + ',locationName:' + JSON.stringify(md.locationName || '')
        + ',ts:Date.now()};'
        + 'try{localStorage.setItem("square_connected_signal",JSON.stringify(signalData));'
        + 'console.log("[SquareCallback] localStorage signal written")}catch(e){console.log("[SquareCallback] localStorage error:",e)}'
        + 'try{if(window.opener){window.opener.postMessage(signalData,"*");'
        + 'console.log("[SquareCallback] postMessage sent to opener")}}catch(e){console.log("[SquareCallback] postMessage skipped:",e)}'
        + 'setTimeout(function(){window.close()},3000)'
        + '</script>'
      : '')
    + '</body></html>';
}

export default router;
