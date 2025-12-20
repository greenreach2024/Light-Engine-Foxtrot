/**
 * Light Engine: Wholesale API Authentication
 * Validates Farm API keys for GreenReach integration
 * Prevents unauthorized inventory access and reservation abuse
 * 
 * Security Model:
 * - API keys generated during farm registration with GreenReach Central
 * - Keys stored locally in farm-api-keys.json (encrypted in production)
 * - X-Farm-ID and X-API-Key headers required for all write operations
 * - Read-only catalog endpoints remain public for buyer browsing
 * 
 * Protected Endpoints:
 * - POST /api/wholesale/inventory/reserve
 * - POST /api/wholesale/inventory/confirm
 * - POST /api/wholesale/inventory/release
 * - POST /api/wholesale/inventory/rollback
 * - POST /api/wholesale/order/*
 * 
 * Public Endpoints (no auth):
 * - GET /api/wholesale/inventory (catalog browsing)
 * - GET /api/wholesale/schedule (pickup windows)
 * - GET /api/wholesale/pricing (pricing info)
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// API keys storage file
const API_KEYS_FILE = path.join(__dirname, '..', 'public', 'data', 'farm-api-keys.json');

/**
 * API Key Store Structure:
 * {
 *   "farm_id": {
 *     "api_key": "hex string",
 *     "farm_name": "string",
 *     "status": "active|suspended",
 *     "created_at": "ISO timestamp",
 *     "last_rotated": "ISO timestamp",
 *     "last_used": "ISO timestamp"
 *   }
 * }
 */

/**
 * Load API keys from storage
 * Creates empty store if file doesn't exist
 */
function loadApiKeys() {
  try {
    if (!fs.existsSync(API_KEYS_FILE)) {
      // Initialize with empty store
      const emptyStore = {};
      fs.writeFileSync(API_KEYS_FILE, JSON.stringify(emptyStore, null, 2));
      return emptyStore;
    }
    const data = fs.readFileSync(API_KEYS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('[Wholesale Auth] Error loading API keys:', error);
    return {};
  }
}

/**
 * Save API keys to storage
 */
function saveApiKeys(keys) {
  try {
    fs.writeFileSync(API_KEYS_FILE, JSON.stringify(keys, null, 2));
  } catch (error) {
    console.error('[Wholesale Auth] Error saving API keys:', error);
    throw error;
  }
}

/**
 * Generate new API key for farm
 * Called during farm registration or key rotation
 * 
 * @param {string} farmId - Farm identifier (e.g., "GR-00001")
 * @param {string} farmName - Farm display name
 * @returns {string} API key (64-char hex)
 */
export function generateApiKey(farmId, farmName) {
  const apiKey = crypto.randomBytes(32).toString('hex');
  const keys = loadApiKeys();
  
  keys[farmId] = {
    api_key: apiKey,
    farm_name: farmName,
    status: 'active',
    created_at: new Date().toISOString(),
    last_rotated: new Date().toISOString(),
    last_used: null
  };
  
  saveApiKeys(keys);
  
  console.log(`[Wholesale Auth] Generated API key for farm: ${farmId} (${farmName})`);
  
  return apiKey;
}

/**
 * Rotate API key for farm
 * Invalidates old key and generates new one
 * 
 * @param {string} farmId - Farm identifier
 * @returns {string} New API key
 */
export function rotateApiKey(farmId) {
  const keys = loadApiKeys();
  
  if (!keys[farmId]) {
    throw new Error(`Farm ${farmId} not found`);
  }
  
  const farmName = keys[farmId].farm_name;
  const newApiKey = crypto.randomBytes(32).toString('hex');
  
  keys[farmId] = {
    ...keys[farmId],
    api_key: newApiKey,
    last_rotated: new Date().toISOString()
  };
  
  saveApiKeys(keys);
  
  console.log(`[Wholesale Auth] Rotated API key for farm: ${farmId}`);
  
  return newApiKey;
}

/**
 * Verify API key for farm
 * Updates last_used timestamp on success
 * 
 * @param {string} farmId - Farm identifier
 * @param {string} apiKey - API key to verify
 * @returns {boolean} True if valid
 */
export function verifyApiKey(farmId, apiKey) {
  const keys = loadApiKeys();
  
  if (!keys[farmId]) {
    console.warn(`[Wholesale Auth] Farm not found: ${farmId}`);
    return false;
  }
  
  const farmData = keys[farmId];
  
  // Check if farm is suspended
  if (farmData.status !== 'active') {
    console.warn(`[Wholesale Auth] Farm suspended: ${farmId}`);
    return false;
  }
  
  // Verify API key matches
  if (farmData.api_key !== apiKey) {
    console.warn(`[Wholesale Auth] Invalid API key for farm: ${farmId}`);
    return false;
  }
  
  // Update last used timestamp
  farmData.last_used = new Date().toISOString();
  saveApiKeys(keys);
  
  return true;
}

/**
 * Suspend farm API access
 * Prevents all API operations without deleting key
 * 
 * @param {string} farmId - Farm identifier
 */
export function suspendFarm(farmId) {
  const keys = loadApiKeys();
  
  if (!keys[farmId]) {
    throw new Error(`Farm ${farmId} not found`);
  }
  
  keys[farmId].status = 'suspended';
  saveApiKeys(keys);
  
  console.log(`[Wholesale Auth] Suspended farm: ${farmId}`);
}

/**
 * Reactivate suspended farm
 * 
 * @param {string} farmId - Farm identifier
 */
export function reactivateFarm(farmId) {
  const keys = loadApiKeys();
  
  if (!keys[farmId]) {
    throw new Error(`Farm ${farmId} not found`);
  }
  
  keys[farmId].status = 'active';
  saveApiKeys(keys);
  
  console.log(`[Wholesale Auth] Reactivated farm: ${farmId}`);
}

/**
 * List all registered farms with API key status
 * For admin monitoring
 */
export function listApiKeys() {
  const keys = loadApiKeys();
  
  return Object.entries(keys).map(([farmId, data]) => ({
    farm_id: farmId,
    farm_name: data.farm_name,
    status: data.status,
    created_at: data.created_at,
    last_rotated: data.last_rotated,
    last_used: data.last_used
  }));
}

/**
 * Express middleware: Verify Farm API Key
 * Protects wholesale endpoints from unauthorized access
 * 
 * Headers required:
 * - X-Farm-ID: Farm identifier (e.g., "GR-00001")
 * - X-API-Key: API key (64-char hex)
 * 
 * Usage:
 *   router.post('/inventory/reserve', wholesaleAuthMiddleware, (req, res) => {
 *     const farmId = req.farm_id;
 *     // ... farm is authenticated
 *   });
 */
export function wholesaleAuthMiddleware(req, res, next) {
  try {
    // Extract authentication headers
    const farmId = req.headers['x-farm-id'];
    const apiKey = req.headers['x-api-key'];
    
    if (!farmId || !apiKey) {
      return res.status(401).json({
        ok: false,
        error: 'unauthorized',
        message: 'X-Farm-ID and X-API-Key headers required'
      });
    }
    
    // Verify API key
    if (!verifyApiKey(farmId, apiKey)) {
      return res.status(403).json({
        ok: false,
        error: 'forbidden',
        message: 'Invalid farm ID or API key'
      });
    }
    
    // Attach farm ID to request for downstream handlers
    req.farm_id = farmId;
    req.authenticated = true;
    
    console.log(`[Wholesale Auth] ✓ Authenticated farm: ${farmId}`);
    
    next();
  } catch (error) {
    console.error('[Wholesale Auth] Middleware error:', error);
    return res.status(500).json({
      ok: false,
      error: 'server_error',
      message: 'Authentication error'
    });
  }
}

/**
 * Optional middleware: Rate limit per farm
 * Prevents individual farms from overwhelming system
 * 
 * Limits:
 * - 100 requests per 15 minutes per farm
 * - Tracks by farm_id (after authentication)
 */
const farmRateLimits = new Map(); // farmId -> { count, resetAt }

export function farmRateLimitMiddleware(limit = 100, windowMs = 15 * 60 * 1000) {
  return (req, res, next) => {
    const farmId = req.farm_id;
    
    if (!farmId) {
      // No farm ID means auth middleware hasn't run
      return next();
    }
    
    const now = Date.now();
    const farmLimit = farmRateLimits.get(farmId);
    
    if (!farmLimit || now > farmLimit.resetAt) {
      // Create new window
      farmRateLimits.set(farmId, {
        count: 1,
        resetAt: now + windowMs
      });
      return next();
    }
    
    if (farmLimit.count >= limit) {
      return res.status(429).json({
        ok: false,
        error: 'rate_limit_exceeded',
        message: `Rate limit exceeded. Try again in ${Math.ceil((farmLimit.resetAt - now) / 1000)} seconds`,
        retry_after: Math.ceil((farmLimit.resetAt - now) / 1000)
      });
    }
    
    farmLimit.count++;
    next();
  };
}

export default {
  generateApiKey,
  rotateApiKey,
  verifyApiKey,
  suspendFarm,
  reactivateFarm,
  listApiKeys,
  wholesaleAuthMiddleware,
  farmRateLimitMiddleware
};
