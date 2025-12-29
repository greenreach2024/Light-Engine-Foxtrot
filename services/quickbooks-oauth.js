/**
 * QuickBooks OAuth 2.0 Service
 * 
 * Handles OAuth authentication flow for QuickBooks Online API
 * Uses axios for direct API calls (no deprecated packages)
 */

import crypto from 'crypto';
import axios from 'axios';

// QuickBooks OAuth endpoints
const QB_AUTH_URL = 'https://appcenter.intuit.com/connect/oauth2';
const QB_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const QB_REVOKE_URL = 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke';
const QB_USER_INFO_URL = 'https://accounts.platform.intuit.com/v1/openid_connect/userinfo';

// Environment-based configuration
const getConfig = () => ({
  clientId: process.env.QUICKBOOKS_CLIENT_ID,
  clientSecret: process.env.QUICKBOOKS_CLIENT_SECRET,
  redirectUri: process.env.QUICKBOOKS_REDIRECT_URI || 'http://localhost:8091/api/farm-sales/quickbooks/callback',
  environment: process.env.QUICKBOOKS_ENVIRONMENT || 'sandbox',
  scopes: [
    'com.intuit.quickbooks.accounting',
    'com.intuit.quickbooks.payment'
  ]
});

/**
 * Generate OAuth authorization URL
 * @param {string} farmId - Farm ID for state parameter
 * @returns {object} Authorization URL and state
 */
export function generateAuthUrl(farmId) {
  const config = getConfig();
  
  if (!config.clientId) {
    throw new Error('QuickBooks Client ID not configured');
  }
  
  // Generate state parameter for CSRF protection
  const state = crypto.randomBytes(32).toString('hex');
  
  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: 'code',
    scope: config.scopes.join(' '),
    redirect_uri: config.redirectUri,
    state: `${farmId}:${state}`
  });
  
  return {
    authUrl: `${QB_AUTH_URL}?${params.toString()}`,
    state: state
  };
}

/**
 * Exchange authorization code for access token
 * @param {string} code - Authorization code from callback
 * @returns {Promise<object>} Token response
 */
export async function exchangeCodeForToken(code) {
  const config = getConfig();
  
  if (!config.clientId || !config.clientSecret) {
    throw new Error('QuickBooks credentials not configured');
  }
  
  const auth = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');
  
  try {
    const response = await axios.post(
      QB_TOKEN_URL,
      new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: config.redirectUri
      }).toString(),
      {
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json'
        }
      }
    );
    
    return {
      access_token: response.data.access_token,
      refresh_token: response.data.refresh_token,
      expires_in: response.data.expires_in,
      token_type: response.data.token_type,
      realm_id: response.data.realmId || null,
      created_at: Date.now()
    };
    
  } catch (error) {
    console.error('[QuickBooks OAuth] Token exchange failed:', error.response?.data || error.message);
    throw new Error(`Failed to exchange code for token: ${error.response?.data?.error || error.message}`);
  }
}

/**
 * Refresh access token using refresh token
 * @param {string} refreshToken - Refresh token
 * @returns {Promise<object>} New token response
 */
export async function refreshAccessToken(refreshToken) {
  const config = getConfig();
  
  if (!config.clientId || !config.clientSecret) {
    throw new Error('QuickBooks credentials not configured');
  }
  
  const auth = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');
  
  try {
    const response = await axios.post(
      QB_TOKEN_URL,
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken
      }).toString(),
      {
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json'
        }
      }
    );
    
    return {
      access_token: response.data.access_token,
      refresh_token: response.data.refresh_token,
      expires_in: response.data.expires_in,
      token_type: response.data.token_type,
      created_at: Date.now()
    };
    
  } catch (error) {
    console.error('[QuickBooks OAuth] Token refresh failed:', error.response?.data || error.message);
    throw new Error(`Failed to refresh token: ${error.response?.data?.error || error.message}`);
  }
}

/**
 * Revoke access token
 * @param {string} accessToken - Access token to revoke
 * @returns {Promise<void>}
 */
export async function revokeToken(accessToken) {
  const config = getConfig();
  
  if (!config.clientId || !config.clientSecret) {
    throw new Error('QuickBooks credentials not configured');
  }
  
  const auth = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');
  
  try {
    await axios.post(
      QB_REVOKE_URL,
      new URLSearchParams({
        token: accessToken
      }).toString(),
      {
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json'
        }
      }
    );
    
  } catch (error) {
    console.error('[QuickBooks OAuth] Token revocation failed:', error.response?.data || error.message);
    throw new Error(`Failed to revoke token: ${error.response?.data?.error || error.message}`);
  }
}

/**
 * Get user info (for testing connection)
 * @param {string} accessToken - Access token
 * @returns {Promise<object>} User info
 */
export async function getUserInfo(accessToken) {
  try {
    const response = await axios.get(QB_USER_INFO_URL, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json'
      }
    });
    
    return response.data;
    
  } catch (error) {
    console.error('[QuickBooks OAuth] Get user info failed:', error.response?.data || error.message);
    throw new Error(`Failed to get user info: ${error.response?.data?.error || error.message}`);
  }
}

/**
 * Check if token is expired
 * @param {object} tokenData - Token data with created_at and expires_in
 * @returns {boolean} True if expired
 */
export function isTokenExpired(tokenData) {
  if (!tokenData || !tokenData.created_at || !tokenData.expires_in) {
    return true;
  }
  
  const expiresAt = tokenData.created_at + (tokenData.expires_in * 1000);
  const bufferTime = 5 * 60 * 1000; // 5 minutes buffer
  
  return Date.now() >= (expiresAt - bufferTime);
}

export default {
  generateAuthUrl,
  exchangeCodeForToken,
  refreshAccessToken,
  revokeToken,
  getUserInfo,
  isTokenExpired
};
