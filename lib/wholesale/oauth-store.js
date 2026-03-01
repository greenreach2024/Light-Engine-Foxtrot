/**
 * GreenReach Wholesale - OAuth Persistent Store
 *
 * NeDB-backed store for Square OAuth states and access tokens.
 * Replaces volatile in-memory Map storage to survive server restarts.
 *
 * Collections:
 *   oauthStatesDB  – CSRF state tokens (TTL: 10 minutes)
 *   oauthTokensDB  – Encrypted farm access tokens (long-lived)
 */

import Datastore from 'nedb-promises';
import fs from 'node:fs';
import path from 'node:path';

const IS_TEST_ENV = process.env.NODE_ENV === 'test' || String(process.env.TEST_MODE).toLowerCase() === 'true' || String(process.env.TEST_MODE) === '1';
if (!IS_TEST_ENV) {
  try { fs.mkdirSync(path.resolve('data'), { recursive: true }); } catch {}
}

// ─── OAuth States (CSRF Tokens) ──────────────────────────────
const oauthStatesDB = Datastore.create({ 
  filename: 'data/oauth-states.db', 
  autoload: !IS_TEST_ENV,
  inMemoryOnly: IS_TEST_ENV
});
oauthStatesDB.ensureIndex({ fieldName: 'state_token', unique: true });
oauthStatesDB.ensureIndex({ fieldName: 'expires_at' });
oauthStatesDB.persistence.setAutocompactionInterval(600000); // 10 min

// ─── OAuth Access Tokens ─────────────────────────────────────
const oauthTokensDB = Datastore.create({ 
  filename: 'data/oauth-tokens.db', 
  autoload: !IS_TEST_ENV,
  inMemoryOnly: IS_TEST_ENV
});
oauthTokensDB.ensureIndex({ fieldName: 'farm_id', unique: true });
oauthTokensDB.ensureIndex({ fieldName: 'merchant_id' });
oauthTokensDB.ensureIndex({ fieldName: 'expires_at' });
oauthTokensDB.persistence.setAutocompactionInterval(600000); // 10 min

// ─── OAuth State Helpers ─────────────────────────────────────

/**
 * Save OAuth state token (CSRF protection)
 * @param {string} stateToken - Random state token
 * @param {object} data - { farm_id, created_at, expires_at }
 */
export async function saveOAuthState(stateToken, data) {
  const doc = {
    state_token: stateToken,
    farm_id: data.farm_id,
    farm_name: data.farm_name || null,
    created_at: data.created_at || new Date().toISOString(),
    expires_at: data.expires_at || new Date(Date.now() + 10 * 60 * 1000).toISOString() // 10 min default
  };
  return oauthStatesDB.insert(doc);
}

/**
 * Get OAuth state by token
 * @param {string} stateToken 
 * @returns {object|null} { farm_id, created_at, expires_at }
 */
export async function getOAuthState(stateToken) {
  return oauthStatesDB.findOne({ state_token: stateToken });
}

/**
 * Delete OAuth state (consume once)
 * @param {string} stateToken 
 */
export async function deleteOAuthState(stateToken) {
  return oauthStatesDB.remove({ state_token: stateToken });
}

/**
 * Cleanup expired OAuth states (run periodically)
 */
export async function cleanupExpiredOAuthStates() {
  const now = new Date().toISOString();
  const result = await oauthStatesDB.remove(
    { expires_at: { $lt: now } }, 
    { multi: true }
  );
  return result; // Returns count of removed docs
}

// ─── Access Token Helpers ────────────────────────────────────

/**
 * Save or update farm access token
 * @param {string} farmId 
 * @param {object} tokenData - { encrypted_token, merchant_id, location_id, expires_at, refresh_token }
 */
export async function saveFarmToken(farmId, tokenData) {
  const existing = await oauthTokensDB.findOne({ farm_id: farmId });
  const doc = {
    farm_id: farmId,
    encrypted_token: tokenData.encrypted_token,
    merchant_id: tokenData.merchant_id,
    location_id: tokenData.location_id,
    location_name: tokenData.location_name || null,
    expires_at: tokenData.expires_at,
    refresh_token: tokenData.refresh_token,
    status: tokenData.status || 'active',
    updated_at: new Date().toISOString()
  };

  if (existing) {
    await oauthTokensDB.update({ farm_id: farmId }, { $set: doc });
    return { ...existing, ...doc };
  }
  
  doc.created_at = new Date().toISOString();
  return oauthTokensDB.insert(doc);
}

/**
 * Get farm access token
 * @param {string} farmId 
 * @returns {object|null} { encrypted_token, merchant_id, location_id, expires_at, refresh_token }
 */
export async function getFarmToken(farmId) {
  return oauthTokensDB.findOne({ farm_id: farmId });
}

/**
 * Get all farm tokens (for token refresh jobs)
 * @returns {Array} All stored tokens
 */
export async function getAllFarmTokens() {
  return oauthTokensDB.find({});
}

/**
 * Delete farm token (revoke)
 * @param {string} farmId 
 */
export async function deleteFarmToken(farmId) {
  return oauthTokensDB.remove({ farm_id: farmId });
}

/**
 * Get farm token by merchant ID
 * @param {string} merchantId 
 * @returns {object|null}
 */
export async function getFarmTokenByMerchant(merchantId) {
  return oauthTokensDB.findOne({ merchant_id: merchantId });
}

// ─── Periodic Cleanup ────────────────────────────────────────

/**
 * Start TTL cleanup interval (call once on server boot)
 * Runs every 60 seconds to remove expired OAuth states
 */
export function startOAuthCleanup() {
  setInterval(async () => {
    try {
      const removed = await cleanupExpiredOAuthStates();
      if (removed > 0) {
        console.log(`[oauth-store] Cleaned up ${removed} expired OAuth states`);
      }
    } catch (err) {
      console.error('[oauth-store] OAuth state cleanup error:', err);
    }
  }, 60000); // 60 seconds
  
  console.log('[oauth-store] OAuth state TTL cleanup started (60s interval)');
}
