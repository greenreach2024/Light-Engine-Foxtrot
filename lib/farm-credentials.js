/**
 * Farm Credentials Manager
 * 
 * Securely stores credentials issued by GreenReach Central during registration.
 * All platforms (Activity Hub, Wholesale sync, POS, etc.) read from this file.
 * 
 * File location: /config/farm-credentials.json
 * 
 * Structure:
 * {
 *   farm_id: "GR-17350001004",
 *   farm_name: "Sunrise Organic Farm",
 *   credentials: {
 *     wholesale_api_key: "wsk_abc123...",
 *     pos_api_key: "posk_def456...",
 *     device_api_key: "devk_ghi789...",
 *     jwt_secret: "secret..."
 *   },
 *   endpoints: {
 *     wholesale_api: "https://wholesale.greenreach.io",
 *     monitoring_api: "https://monitor.greenreach.io",
 *     update_api: "https://updates.greenreach.io",
 *     cloud_api: "https://api.greenreach.io"
 *   },
 *   registered_at: "2025-12-28T...",
 *   status: "active"
 * }
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const CREDENTIALS_DIR = path.join(process.cwd(), 'config');
const CREDENTIALS_FILE = path.join(CREDENTIALS_DIR, 'farm-credentials.json');
const ENCRYPTION_KEY = process.env.CREDENTIALS_KEY || 'default-key-change-in-production';

/**
 * Ensure config directory exists
 */
function ensureConfigDir() {
  if (!fs.existsSync(CREDENTIALS_DIR)) {
    fs.mkdirSync(CREDENTIALS_DIR, { recursive: true });
  }
}

/**
 * Simple encryption (in production, use proper key management)
 */
function encrypt(text) {
  const cipher = crypto.createCipher('aes-256-cbc', ENCRYPTION_KEY);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return encrypted;
}

function decrypt(encrypted) {
  const decipher = crypto.createDecipher('aes-256-cbc', ENCRYPTION_KEY);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/**
 * Save farm credentials after registration
 * 
 * @param {Object} credentials - Full response from GreenReach registration
 */
export function saveCredentials(credentials) {
  try {
    ensureConfigDir();

    // Add metadata
    const credentialsData = {
      ...credentials,
      saved_at: new Date().toISOString(),
      version: '1.0'
    };

    // Encrypt sensitive data (optional - for production use)
    const credentialsJson = JSON.stringify(credentialsData, null, 2);
    
    // Save to file
    fs.writeFileSync(CREDENTIALS_FILE, credentialsJson, 'utf8');

    console.log(`✅ Farm credentials saved: ${credentials.farm_id}`);
    console.log(`   Location: ${CREDENTIALS_FILE}`);

    return true;
  } catch (error) {
    console.error('Error saving credentials:', error);
    throw new Error('Failed to save farm credentials');
  }
}

/**
 * Load farm credentials
 * 
 * @returns {Object|null} Farm credentials or null if not registered
 */
export function loadCredentials() {
  try {
    if (!fs.existsSync(CREDENTIALS_FILE)) {
      return null;
    }

    const credentialsJson = fs.readFileSync(CREDENTIALS_FILE, 'utf8');
    const credentials = JSON.parse(credentialsJson);

    return credentials;
  } catch (error) {
    console.error('Error loading credentials:', error);
    return null;
  }
}

/**
 * Check if farm is registered
 * 
 * @returns {boolean}
 */
export function isRegistered() {
  return fs.existsSync(CREDENTIALS_FILE);
}

/**
 * Get farm ID
 * 
 * @returns {string|null}
 */
export function getFarmId() {
  const credentials = loadCredentials();
  return credentials?.farm_id || null;
}

/**
 * Get farm name
 * 
 * @returns {string|null}
 */
export function getFarmName() {
  const credentials = loadCredentials();
  return credentials?.farm_name || null;
}

/**
 * Get API key for specific platform
 * 
 * @param {string} platform - 'wholesale', 'pos', or 'device'
 * @returns {string|null}
 */
export function getApiKey(platform) {
  const credentials = loadCredentials();
  if (!credentials) return null;

  const keyMap = {
    wholesale: 'wholesale_api_key',
    pos: 'pos_api_key',
    device: 'device_api_key'
  };

  const keyName = keyMap[platform];
  return credentials.credentials?.[keyName] || null;
}

/**
 * Get JWT secret for generating farm tokens
 * 
 * @returns {string|null}
 */
export function getJwtSecret() {
  const credentials = loadCredentials();
  return credentials?.credentials?.jwt_secret || null;
}

/**
 * Get endpoint URL for specific service
 * 
 * @param {string} service - 'wholesale', 'monitoring', 'update', or 'cloud'
 * @returns {string|null}
 */
export function getEndpoint(service) {
  const credentials = loadCredentials();
  if (!credentials) return null;

  const endpointMap = {
    wholesale: 'wholesale_api',
    monitoring: 'monitoring_api',
    update: 'update_api',
    cloud: 'cloud_api'
  };

  const endpointName = endpointMap[service];
  return credentials.endpoints?.[endpointName] || null;
}

/**
 * Delete credentials (for factory reset or deregistration)
 */
export function deleteCredentials() {
  try {
    if (fs.existsSync(CREDENTIALS_FILE)) {
      fs.unlinkSync(CREDENTIALS_FILE);
      console.log('✅ Farm credentials deleted');
      return true;
    }
    return false;
  } catch (error) {
    console.error('Error deleting credentials:', error);
    throw new Error('Failed to delete farm credentials');
  }
}

/**
 * Get all credentials (for debugging - use carefully!)
 * 
 * @returns {Object|null}
 */
export function getAllCredentials() {
  return loadCredentials();
}

// Log status on module load
if (isRegistered()) {
  console.log(`🔐 Farm credentials loaded: ${getFarmId()}`);
} else {
  console.log('⚠️  Farm not registered - run setup wizard');
}
