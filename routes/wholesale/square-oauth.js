/**
 * GreenReach Wholesale - Square OAuth Onboarding
 * 
 * Handles OAuth flow for farms to connect their Square accounts:
 * 1. Generate OAuth URL with required permissions
 * 2. Handle OAuth callback with authorization code
 * 3. Exchange code for access/refresh tokens
 * 4. Store encrypted tokens with merchant/location IDs
 * 5. Auto-refresh tokens before expiry
 * 
 * Required Square OAuth Scope:
 * - PAYMENTS_WRITE_ADDITIONAL_RECIPIENTS (enables app_fee_money broker fees)
 * 
 * Farm Status States:
 * - inactive: Farm created but not onboarded
 * - onboarding: OAuth initiated, awaiting completion
 * - active: OAuth complete, tokens stored, can accept orders
 * - suspended: Temporarily disabled (payment issues, violations)
 * 
 * Security:
 * - Tokens encrypted at rest using AES-256-GCM
 * - State parameter prevents CSRF attacks
 * - Token refresh 24h before expiry
 */

import express from 'express';
import crypto from 'crypto';
import { Client as SquareClient } from 'square';
import * as oauthStore from '../../lib/wholesale/oauth-store.js';

const router = express.Router();

const farmOAuthStates = new Map();
const farmTokens = new Map();

const WHOLESALE_READ_FROM_DB = process.env.WHOLESALE_READ_FROM_DB === 'true';

const SQUARE_ENVIRONMENT = process.env.SQUARE_ENVIRONMENT || 'sandbox';
const SQUARE_APPLICATION_ID = process.env.SQUARE_APPLICATION_ID;
const SQUARE_APPLICATION_SECRET = process.env.SQUARE_APPLICATION_SECRET;
const OAUTH_REDIRECT_URI = process.env.OAUTH_REDIRECT_URI || 'http://localhost:8091/api/wholesale/oauth/square/callback';
const OAUTH_SCOPES = ['PAYMENTS_WRITE', 'PAYMENTS_WRITE_ADDITIONAL_RECIPIENTS', 'MERCHANT_PROFILE_READ'];

const IS_PROD_LIKE = process.env.NODE_ENV === 'production' || process.env.DEPLOYMENT_MODE === 'edge' || process.env.DEPLOYMENT_MODE === 'cloud';
if (IS_PROD_LIKE && !process.env.TOKEN_ENCRYPTION_KEY) {
  throw new Error('TOKEN_ENCRYPTION_KEY environment variable is required in production-like environments');
}
const ENCRYPTION_KEY = process.env.TOKEN_ENCRYPTION_KEY || crypto.randomBytes(32);
const ENCRYPTION_ALGORITHM = 'aes-256-gcm';

function encryptToken(token) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, ENCRYPTION_KEY, iv);

  let encrypted = cipher.update(token, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  return {
    encrypted,
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex')
  };
}

function decryptToken(encryptedData) {
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

function toMapToken(dbToken) {
  if (!dbToken) return null;
  return {
    merchant_id: dbToken.merchant_id,
    location_id: dbToken.location_id,
    location_name: dbToken.location_name,
    access_token: dbToken.encrypted_token,
    refresh_token: dbToken.refresh_token,
    expires_at: dbToken.expires_at,
    status: dbToken.status || 'active',
    onboarded_at: dbToken.created_at,
    last_refresh_at: dbToken.updated_at
  };
}

async function getState(state) {
  const inMemory = farmOAuthStates.get(state);
  if (inMemory) return inMemory;

  if (!WHOLESALE_READ_FROM_DB) return null;

  const dbState = await oauthStore.getOAuthState(state);
  if (!dbState) return null;

  return {
    farm_id: dbState.farm_id,
    farm_name: dbState.farm_name,
    created_at: new Date(dbState.created_at).getTime()
  };
}

async function getFarmToken(farmId) {
  const inMemory = farmTokens.get(farmId);
  if (inMemory) return inMemory;

  if (!WHOLESALE_READ_FROM_DB) return null;

  const dbToken = await oauthStore.getFarmToken(farmId);
  return toMapToken(dbToken);
}

async function saveFarmTokenDualWrite(farmId, tokenData) {
  farmTokens.set(farmId, tokenData);
  await oauthStore.saveFarmToken(farmId, {
    merchant_id: tokenData.merchant_id,
    location_id: tokenData.location_id,
    location_name: tokenData.location_name,
    encrypted_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token,
    expires_at: tokenData.expires_at,
    status: tokenData.status
  });
}

/**
 * GET /api/wholesale/oauth/square/authorize
 * 
 * Generate Square OAuth URL for farm to initiate onboarding
 * 
 * Query Params:
 * - farm_id: Farm identifier
 * - farm_name: Farm name (for display in Square OAuth flow)
 * 
 * Response:
 * {
 *   status: 'ok',
 *   data: {
 *     authorization_url: 'https://connect.squareup[sandbox].com/oauth2/authorize?...',
 *     state: 'random_state_token',
 *     expires_in: 600
 *   }
 * }
 */
router.get('/authorize', async (req, res) => {
  try {
    const { farm_id, farm_name } = req.query;
    
    if (!farm_id || !farm_name) {
      return res.status(400).json({
        status: 'error',
        message: 'farm_id and farm_name are required'
      });
    }
    
    if (!SQUARE_APPLICATION_ID) {
      return res.status(500).json({
        status: 'error',
        message: 'Square OAuth not configured (missing SQUARE_APPLICATION_ID)'
      });
    }
    
    // Generate cryptographically secure state token
    const state = crypto.randomBytes(32).toString('hex');
    
    // Store state for validation in callback (expires in 10 minutes)
    farmOAuthStates.set(state, {
      farm_id,
      farm_name,
      created_at: Date.now()
    });
    
    // Cleanup expired states (older than 10 minutes)
    const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
    for (const [key, value] of farmOAuthStates.entries()) {
      if (value.created_at < tenMinutesAgo) {
        farmOAuthStates.delete(key);
      }
    }
    
    await oauthStore.saveOAuthState(state, {
      farm_id,
      farm_name,
      created_at: new Date().toISOString()
    });

    // Build Square OAuth URL
    const baseUrl = SQUARE_ENVIRONMENT === 'production' 
      ? 'https://connect.squareup.com'
      : 'https://connect.squareupsandbox.com';
    
    const params = new URLSearchParams({
      client_id: SQUARE_APPLICATION_ID,
      scope: OAUTH_SCOPES.join(' '),
      session: 'false', // Don't show login screen if already logged in
      state: state
    });
    
    const authorizationUrl = `${baseUrl}/oauth2/authorize?${params.toString()}`;
    
    res.json({
      status: 'ok',
      data: {
        authorization_url: authorizationUrl,
        state: state,
        expires_in: 600 // 10 minutes
      },
      message: `Redirect farm to authorization_url to complete Square onboarding`
    });
    
  } catch (error) {
    console.error('OAuth authorize error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to generate OAuth URL',
      error: error.message
    });
  }
});

/**
 * GET /api/wholesale/oauth/square/callback
 * 
 * Square OAuth callback handler
 * Exchanges authorization code for access/refresh tokens
 * 
 * Query Params (from Square):
 * - code: Authorization code (one-time use)
 * - state: State token (for CSRF protection)
 * - response_type: 'code' (always)
 * 
 * Response: Redirects to success/error page
 */
router.get('/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    
    if (!code || !state) {
      return res.status(400).send(`
        <html>
          <head><title>OAuth Error</title></head>
          <body>
            <h1>OAuth Error</h1>
            <p>Missing authorization code or state parameter.</p>
            <a href="/">Return to Dashboard</a>
          </body>
        </html>
      `);
    }
    
    // Validate state token (CSRF protection)
    const stateData = await getState(state);
    
    if (!stateData) {
      return res.status(400).send(`
        <html>
          <head><title>OAuth Error</title></head>
          <body>
            <h1>OAuth Error</h1>
            <p>Invalid or expired state token. Please try again.</p>
            <a href="/">Return to Dashboard</a>
          </body>
        </html>
      `);
    }
    
    const { farm_id, farm_name } = stateData;
    
    // Delete state token (one-time use)
    farmOAuthStates.delete(state);
    await oauthStore.deleteOAuthState(state);
    
    // Initialize Square OAuth client
    const squareClient = new SquareClient({
      environment: SQUARE_ENVIRONMENT,
      accessToken: '' // Not needed for OAuth token exchange
    });
    
    // Exchange authorization code for tokens
    const tokenResponse = await squareClient.oAuthApi.obtainToken({
      clientId: SQUARE_APPLICATION_ID,
      clientSecret: SQUARE_APPLICATION_SECRET,
      code: code,
      grantType: 'authorization_code'
    });
    
    const tokenResult = tokenResponse.result;
    
    // Extract token data
    const accessToken = tokenResult.accessToken;
    const refreshToken = tokenResult.refreshToken;
    const expiresAt = tokenResult.expiresAt; // ISO 8601 timestamp
    const merchantId = tokenResult.merchantId;
    
    // Get default location ID
    const locationsResponse = await squareClient.locationsApi.listLocations();
    const locations = locationsResponse.result.locations || [];
    const defaultLocation = locations.find(loc => loc.status === 'ACTIVE') || locations[0];
    
    if (!defaultLocation) {
      throw new Error('No active locations found for merchant');
    }
    
    const locationId = defaultLocation.id;
    const locationName = defaultLocation.name;
    
    // Encrypt access and refresh tokens
    const encryptedAccessToken = encryptToken(accessToken);
    const encryptedRefreshToken = encryptToken(refreshToken);
    
    await saveFarmTokenDualWrite(farm_id, {
      merchant_id: merchantId,
      location_id: locationId,
      location_name: locationName,
      access_token: encryptedAccessToken,
      refresh_token: encryptedRefreshToken,
      expires_at: expiresAt,
      status: 'active',
      onboarded_at: new Date().toISOString(),
      last_refresh_at: null
    });
    
    console.log(` Farm ${farm_name} (${farm_id}) onboarded successfully`);
    console.log(`  Merchant ID: ${merchantId}`);
    console.log(`  Location: ${locationName} (${locationId})`);
    console.log(`  Token expires: ${expiresAt}`);
    
    // Redirect to success page
    res.send(`
      <html>
        <head>
          <title>Square Onboarding Complete</title>
          <style>
            body { font-family: -apple-system, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
            h1 { color: #2d5016; }
            .success { background: #d1fae5; padding: 15px; border-radius: 8px; margin: 20px 0; }
            .info { background: #f5f7f3; padding: 15px; border-radius: 8px; margin: 20px 0; }
            .info dt { font-weight: 600; margin-top: 10px; }
            .info dd { margin-left: 20px; color: #5a5a5a; }
            a { display: inline-block; background: #2d5016; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; margin-top: 20px; }
            a:hover { background: #3d6821; }
          </style>
        </head>
        <body>
          <h1>GreenReach Wholesale Onboarding Complete</h1>
          <div class="success">
            <strong>Success!</strong> ${farm_name} is now connected to Square.
          </div>
          <div class="info">
            <dl>
              <dt>Farm:</dt>
              <dd>${farm_name}</dd>
              <dt>Square Merchant ID:</dt>
              <dd>${merchantId}</dd>
              <dt>Default Location:</dt>
              <dd>${locationName}</dd>
              <dt>Status:</dt>
              <dd>Active - Ready to receive wholesale orders</dd>
            </dl>
          </div>
          <p>Your farm can now accept wholesale orders through GreenReach. Payments will be processed through your Square account, with a 10% broker fee automatically collected by GreenReach.</p>
          <a href="/">Return to Dashboard</a>
        </body>
      </html>
    `);
    
  } catch (error) {
    console.error('OAuth callback error:', error);
    
    res.status(500).send(`
      <html>
        <head><title>OAuth Error</title></head>
        <body>
          <h1>OAuth Error</h1>
          <p>${error.message}</p>
          <p>Please contact support if this issue persists.</p>
          <a href="/">Return to Dashboard</a>
        </body>
      </html>
    `);
  }
});

/**
 * POST /api/wholesale/oauth/square/refresh
 * 
 * Refresh Square access token using refresh token
 * Should be called automatically 24h before token expiry
 * 
 * Body:
 * {
 *   farm_id: 'farm_123'
 * }
 * 
 * Response:
 * {
 *   status: 'ok',
 *   data: {
 *     expires_at: '2025-01-15T12:00:00Z',
 *     refreshed_at: '2024-12-15T12:00:00Z'
 *   }
 * }
 */
router.post('/refresh', async (req, res) => {
  try {
    const { farm_id } = req.body;
    
    if (!farm_id) {
      return res.status(400).json({
        status: 'error',
        message: 'farm_id is required'
      });
    }
    
    const farmTokenData = await getFarmToken(farm_id);
    
    if (!farmTokenData) {
      return res.status(404).json({
        status: 'error',
        message: 'Farm not found or not onboarded'
      });
    }
    
    // Decrypt refresh token
    const refreshToken = decryptToken(farmTokenData.refresh_token);
    
    // Initialize Square OAuth client
    const squareClient = new SquareClient({
      environment: SQUARE_ENVIRONMENT,
      accessToken: '' // Not needed for token refresh
    });
    
    // Refresh access token
    const tokenResponse = await squareClient.oAuthApi.obtainToken({
      clientId: SQUARE_APPLICATION_ID,
      clientSecret: SQUARE_APPLICATION_SECRET,
      grantType: 'refresh_token',
      refreshToken: refreshToken
    });
    
    const tokenResult = tokenResponse.result;
    
    // Update stored tokens
    const newAccessToken = tokenResult.accessToken;
    const newRefreshToken = tokenResult.refreshToken || refreshToken; // Some providers don't return new refresh token
    const newExpiresAt = tokenResult.expiresAt;
    
    farmTokenData.access_token = encryptToken(newAccessToken);
    farmTokenData.refresh_token = encryptToken(newRefreshToken);
    farmTokenData.expires_at = newExpiresAt;
    farmTokenData.last_refresh_at = new Date().toISOString();
    
    await saveFarmTokenDualWrite(farm_id, farmTokenData);
    
    console.log(` Refreshed token for farm ${farm_id}, expires ${newExpiresAt}`);
    
    res.json({
      status: 'ok',
      data: {
        expires_at: newExpiresAt,
        refreshed_at: farmTokenData.last_refresh_at
      },
      message: 'Token refreshed successfully'
    });
    
  } catch (error) {
    console.error('Token refresh error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to refresh token',
      error: error.message
    });
  }
});

/**
 * GET /api/wholesale/oauth/square/status/:farm_id
 * 
 * Get Square OAuth status for a farm
 * 
 * Response:
 * {
 *   status: 'ok',
 *   data: {
 *     farm_id: 'farm_123',
 *     oauth_status: 'active',
 *     merchant_id: 'MERCHANT_ID',
 *     location_id: 'LOCATION_ID',
 *     location_name: 'Main Location',
 *     expires_at: '2025-01-15T12:00:00Z',
 *     onboarded_at: '2024-12-15T10:00:00Z',
 *     last_refresh_at: '2024-12-15T11:00:00Z',
 *     needs_refresh: false
 *   }
 * }
 */
router.get('/status/:farm_id', async (req, res) => {
  try {
    const { farm_id } = req.params;
    
    let farmTokenData = farmTokens.get(farm_id);
    
    // DUAL-READ: Fall back to NeDB if not in Map
    if (!farmTokenData && WHOLESALE_READ_FROM_DB) {
      const dbToken = await oauthStore.getFarmToken(farm_id);
      if (dbToken) {
        farmTokenData = {
          merchant_id: dbToken.merchant_id,
          location_id: dbToken.location_id,
          access_token: dbToken.encrypted_token,
          refresh_token: dbToken.refresh_token,
          expires_at: dbToken.expires_at,
          status: 'active'
        };
      }
    }
    
    if (!farmTokenData) {
      return res.status(404).json({
        status: 'error',
        message: 'Farm not found or not onboarded'
      });
    }
    
    // Check if token needs refresh (expires in less than 24 hours)
    const expiresAt = new Date(farmTokenData.expires_at);
    const now = new Date();
    const hoursUntilExpiry = (expiresAt - now) / (1000 * 60 * 60);
    const needsRefresh = hoursUntilExpiry < 24;
    
    res.json({
      status: 'ok',
      data: {
        farm_id,
        oauth_status: farmTokenData.status,
        merchant_id: farmTokenData.merchant_id,
        location_id: farmTokenData.location_id,
        location_name: farmTokenData.location_name,
        expires_at: farmTokenData.expires_at,
        onboarded_at: farmTokenData.onboarded_at,
        last_refresh_at: farmTokenData.last_refresh_at,
        needs_refresh: needsRefresh,
        hours_until_expiry: Math.round(hoursUntilExpiry)
      }
    });
    
  } catch (error) {
    console.error('OAuth status error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get OAuth status',
      error: error.message
    });
  }
});

/**
 * GET /api/wholesale/oauth/square/farms
 * 
 * List all onboarded farms with OAuth status
 * 
 * Response:
 * {
 *   status: 'ok',
 *   data: {
 *     farms: [
 *       {
 *         farm_id: 'farm_123',
 *         merchant_id: 'MERCHANT_ID',
 *         location_name: 'Main Location',
 *         status: 'active',
 *         expires_at: '2025-01-15T12:00:00Z',
 *         needs_refresh: false
 *       }
 *     ],
 *     total_farms: 1,
 *     active_farms: 1
 *   }
 * }
 */
router.get('/farms', async (req, res) => {
  try {
    const farms = [];
    
    // DUAL-READ: Get from Map or NeDB based on feature flag
    let farmTokenEntries = [];
    if (WHOLESALE_READ_FROM_DB) {
      const dbTokens = await oauthStore.getAllFarmTokens();
      farmTokenEntries = dbTokens.map(t => [t.farm_id, {
        merchant_id: t.merchant_id,
        location_id: t.location_id,
        access_token: t.encrypted_token,
        refresh_token: t.refresh_token,
        expires_at: t.expires_at,
        status: 'active',
        onboarded_at: t.created_at,
        last_refresh_at: t.updated_at
      }]);
    } else {
      farmTokenEntries = Array.from(farmTokens.entries());
    }
    
    for (const [farm_id, tokenData] of farmTokenEntries) {
      const expiresAt = new Date(tokenData.expires_at);
      const now = new Date();
      const hoursUntilExpiry = (expiresAt - now) / (1000 * 60 * 60);
      
      farms.push({
        farm_id,
        merchant_id: tokenData.merchant_id,
        location_id: tokenData.location_id,
        location_name: tokenData.location_name,
        status: tokenData.status,
        expires_at: tokenData.expires_at,
        onboarded_at: tokenData.onboarded_at,
        last_refresh_at: tokenData.last_refresh_at,
        needs_refresh: hoursUntilExpiry < 24,
        hours_until_expiry: Math.round(hoursUntilExpiry)
      });
    }
    
    const activeFarms = farms.filter(f => f.status === 'active').length;
    
    res.json({
      status: 'ok',
      data: {
        farms,
        total_farms: farms.length,
        active_farms: activeFarms
      }
    });
    
  } catch (error) {
    console.error('List farms error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to list farms',
      error: error.message
    });
  }
});

/**
 * DELETE /api/wholesale/oauth/square/disconnect/:farm_id
 * 
 * Disconnect farm from Square (revoke tokens)
 * 
 * Response:
 * {
 *   status: 'ok',
 *   message: 'Farm disconnected successfully'
 * }
 */
router.delete('/disconnect/:farm_id', async (req, res) => {
  try {
    const { farm_id } = req.params;
    
    const farmTokenData = await getFarmToken(farm_id);
    if (!farmTokenData) {
      return res.status(404).json({
        status: 'error',
        message: 'Farm not found or not onboarded'
      });
    }
    
    // Decrypt access token
    const accessToken = decryptToken(farmTokenData.access_token);
    
    // Initialize Square OAuth client
    const squareClient = new SquareClient({
      environment: SQUARE_ENVIRONMENT,
      accessToken: accessToken
    });
    
    // Revoke token with Square
    try {
      await squareClient.oAuthApi.revokeToken({
        clientId: SQUARE_APPLICATION_ID,
        accessToken: accessToken
      });
      console.log(` Revoked Square token for farm ${farm_id}`);
    } catch (revokeError) {
      console.warn(`Warning: Failed to revoke token with Square:`, revokeError.message);
      // Continue with local deletion even if Square revocation fails
    }
    
    // Delete local token data
    farmTokens.delete(farm_id);
    await oauthStore.deleteFarmToken(farm_id);
    
    res.json({
      status: 'ok',
      message: 'Farm disconnected successfully'
    });
    
  } catch (error) {
    console.error('Disconnect error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to disconnect farm',
      error: error.message
    });
  }
});

/**
 * Helper: Get decrypted access token for farm
 * Used by other wholesale modules (checkout, webhooks)
 */
export function getFarmAccessToken(farm_id) {
  throw new Error('getFarmAccessToken is async; use await getFarmAccessTokenAsync');
}

export async function getFarmAccessTokenAsync(farm_id) {
  const farmTokenData = await getFarmToken(farm_id);

  if (!farmTokenData) {
    throw new Error(`Farm ${farm_id} not onboarded`);
  }

  if (farmTokenData.status !== 'active') {
    throw new Error(`Farm ${farm_id} OAuth status: ${farmTokenData.status}`);
  }

  const expiresAt = new Date(farmTokenData.expires_at);
  const now = new Date();
  if (expiresAt <= now) {
    throw new Error(`Farm ${farm_id} token expired at ${expiresAt.toISOString()}`);
  }

  return decryptToken(farmTokenData.access_token);
}

/**
 * Helper: Get farm merchant and location IDs
 */
export function getFarmSquareIds(farm_id) {
  throw new Error('getFarmSquareIds is async; use await getFarmSquareIdsAsync');
}

export async function getFarmSquareIdsAsync(farm_id) {
  const farmTokenData = await getFarmToken(farm_id);

  if (!farmTokenData) {
    throw new Error(`Farm ${farm_id} not onboarded`);
  }

  return {
    merchant_id: farmTokenData.merchant_id,
    location_id: farmTokenData.location_id,
    location_name: farmTokenData.location_name
  };
}

/**
 * GET /api/wholesale/oauth/square/ids/:farmId
 * 
 * Get Square merchant and location IDs for a farm
 * Used by Central to fetch payment credentials
 */
router.get('/ids/:farmId', async (req, res) => {
  try {
    const { farmId } = req.params;
    const ids = await getFarmSquareIdsAsync(farmId);
    
    return res.json({
      status: 'ok',
      data: ids
    });
  } catch (error) {
    console.error('Get Square IDs error:', error);
    return res.status(404).json({
      status: 'error',
      message: error.message
    });
  }
});

/**
 * GET /api/wholesale/oauth/square/token/:farmId
 * 
 * Get decrypted access token for a farm
 * IMPORTANT: Only expose this to trusted Central server
 * In production, use mutual TLS or other secure authentication
 */
router.get('/token/:farmId', async (req, res) => {
  try {
    const { farmId } = req.params;
    
    // TODO: Add authentication check to ensure this is Central server calling
    // For now, relying on internal network security
    
    const accessToken = await getFarmAccessTokenAsync(farmId);
    
    return res.json({
      status: 'ok',
      data: {
        access_token: accessToken
      }
    });
  } catch (error) {
    console.error('Get Square token error:', error);
    return res.status(404).json({
      status: 'error',
      message: error.message
    });
  }
});

/**
 * GET /api/wholesale/oauth/square/status
 * 
 * Check if this farm has Square connected
 */
router.get('/status', async (req, res) => {
  try {
    // For now, check if any farm has tokens
    // In multi-tenant setup, would check specific farm
    let hasFarms = farmTokens.size > 0;
    
    // DUAL-READ: Check NeDB if Map is empty
    if (!hasFarms && WHOLESALE_READ_FROM_DB) {
      const dbTokens = await oauthStore.getAllFarmTokens();
      hasFarms = dbTokens.length > 0;
    }
    
    if (!hasFarms) {
      return res.json({
        status: 'ok',
        connected: false,
        message: 'No Square account connected'
      });
    }
    
    // Get first farm's data (single-tenant mode)
    let farmId, tokenData;
    
    if (WHOLESALE_READ_FROM_DB) {
      const dbTokens = await oauthStore.getAllFarmTokens();
      if (dbTokens.length > 0) {
        const firstToken = dbTokens[0];
        farmId = firstToken.farm_id;
        tokenData = {
          merchant_id: firstToken.merchant_id,
          location_id: firstToken.location_id,
          expires_at: firstToken.expires_at,
          status: 'active',
          onboarded_at: firstToken.created_at
        };
      }
    } else {
      [farmId, tokenData] = Array.from(farmTokens.entries())[0];
    }
    
    return res.json({
      status: 'ok',
      connected: true,
      data: {
        farm_id: farmId,
        merchant_id: tokenData.merchant_id,
        location_id: tokenData.location_id,
        location_name: tokenData.location_name,
        expires_at: tokenData.expires_at
      }
    });
  } catch (error) {
    console.error('Square status error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Failed to check Square status'
    });
  }
});

// Auto-refresh tokens every hour
setInterval(async () => {
  const now = new Date();
  const oneDayFromNow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  
  // DUAL-READ: Get all farm tokens from Map or NeDB
  let farmTokenEntries = [];
  if (WHOLESALE_READ_FROM_DB) {
    const dbTokens = await oauthStore.getAllFarmTokens();
    farmTokenEntries = dbTokens.map(t => [t.farm_id, {
      merchant_id: t.merchant_id,
      location_id: t.location_id,
      access_token: t.encrypted_token,
      refresh_token: t.refresh_token,
      expires_at: t.expires_at
    }]);
  } else {
    farmTokenEntries = Array.from(farmTokens.entries());
  }
  
  for (const [farm_id, tokenData] of farmTokenEntries) {
    const expiresAt = new Date(tokenData.expires_at);
    
    // Refresh if expires in less than 24 hours and hasn't been refreshed in last hour
    const lastRefresh = tokenData.last_refresh_at ? new Date(tokenData.last_refresh_at) : new Date(0);
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    
    if (expiresAt < oneDayFromNow && lastRefresh < oneHourAgo) {
      console.log(`Auto-refreshing token for farm ${farm_id} (expires ${expiresAt.toISOString()})`);
      
      // Trigger refresh via internal API call
      fetch(`http://localhost:${process.env.PORT || 8091}/api/wholesale/oauth/square/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ farm_id })
      })
        .then(response => response.json())
        .then(data => {
          if (data.status === 'ok') {
            console.log(` Auto-refreshed token for farm ${farm_id}`);
          } else {
            console.error(`✗ Failed to auto-refresh token for farm ${farm_id}:`, data.message);
          }
        })
        .catch(error => {
          console.error(`✗ Auto-refresh error for farm ${farm_id}:`, error.message);
        });
    }
  }
}, 60 * 60 * 1000); // Check every hour

export default router;
