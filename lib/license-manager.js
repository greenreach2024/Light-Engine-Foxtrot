/**
 * License Manager for Light Engine Edge Devices
 * 
 * Features:
 * - RSA signature validation (GreenReach private key signs, public key validates)
 * - Hardware fingerprinting (MAC + CPU + disk UUID)
 * - 7-day offline grace period
 * - License file: config/licenses/license.json (local storage for AWS)
 * - Phone home validation with GreenReach licensing server
 */

import crypto from 'crypto';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const LICENSE_PATH = process.env.LICENSE_PATH || path.join(__dirname, '..', 'config', 'licenses', 'license.json');
const PUBLIC_KEY_PATH = process.env.PUBLIC_KEY_PATH || path.join(__dirname, '..', 'config', 'greenreach-public.pem');
const GRACE_PERIOD_DAYS = 7;
const PHONE_HOME_URL = process.env.LICENSE_SERVER_URL || 'https://license.greenreach.io/api/validate';

/**
 * Generate hardware fingerprint from system information
 * @returns {Promise<string>} SHA-256 hash of hardware info
 */
export async function generateFingerprint() {
  const platform = os.platform();
  const info = {
    platform,
    hostname: os.hostname(),
    cpus: os.cpus()[0]?.model || 'unknown',
  };

  // Get MAC address (first non-internal interface)
  const networkInterfaces = os.networkInterfaces();
  for (const [name, interfaces] of Object.entries(networkInterfaces)) {
    for (const iface of interfaces) {
      if (!iface.internal && iface.mac && iface.mac !== '00:00:00:00:00:00') {
        info.mac = iface.mac;
        break;
      }
    }
    if (info.mac) break;
  }

  // Try to get disk UUID (Linux-specific)
  if (platform === 'linux') {
    try {
      const { stdout } = await execAsync('lsblk -no UUID /dev/sda1 2>/dev/null || echo "unknown"');
      info.diskUuid = stdout.trim();
    } catch (err) {
      info.diskUuid = 'unknown';
    }
  }

  // Try to get CPU serial (Linux-specific)
  if (platform === 'linux') {
    try {
      const { stdout } = await execAsync('cat /proc/cpuinfo | grep Serial | head -1 | awk \'{print $3}\'');
      info.cpuSerial = stdout.trim() || 'unknown';
    } catch (err) {
      info.cpuSerial = 'unknown';
    }
  }

  // Create deterministic hash
  const fingerprintData = JSON.stringify(info, Object.keys(info).sort());
  return crypto.createHash('sha256').update(fingerprintData).digest('hex');
}

/**
 * Load license file from disk
 * @returns {Promise<object|null>} License object or null if not found
 */
async function loadLicense() {
  try {
    if (!existsSync(LICENSE_PATH)) {
      console.warn(`[License] No license file found at ${LICENSE_PATH}`);
      return null;
    }

    const licenseData = await fs.readFile(LICENSE_PATH, 'utf-8');
    return JSON.parse(licenseData);
  } catch (err) {
    console.error('[License] Failed to load license:', err.message);
    return null;
  }
}

/**
 * Verify RSA signature on license
 * @param {object} license - License object with data and signature
 * @returns {Promise<boolean>} True if signature is valid
 */
async function verifySignature(license) {
  try {
    if (!license.data || !license.signature) {
      console.error('[License] Missing data or signature');
      return false;
    }

    if (!existsSync(PUBLIC_KEY_PATH)) {
      console.error(`[License] Public key not found at ${PUBLIC_KEY_PATH}`);
      return false;
    }

    const publicKey = await fs.readFile(PUBLIC_KEY_PATH, 'utf-8');
    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(JSON.stringify(license.data));
    
    const isValid = verifier.verify(publicKey, license.signature, 'base64');
    
    if (!isValid) {
      console.error('[License] Invalid signature - license may be tampered');
    }

    return isValid;
  } catch (err) {
    console.error('[License] Signature verification failed:', err.message);
    return false;
  }
}

/**
 * Check if license is expired
 * @param {object} licenseData - License data object
 * @returns {boolean} True if expired
 */
function isExpired(licenseData) {
  if (!licenseData.expiresAt) {
    return false; // No expiration
  }

  const expiryDate = new Date(licenseData.expiresAt);
  return expiryDate < new Date();
}

/**
 * Check if within grace period for offline validation
 * @param {object} license - License object
 * @returns {boolean} True if within grace period
 */
function isWithinGracePeriod(license) {
  if (!license.lastValidated) {
    return true; // First run
  }

  const lastValidated = new Date(license.lastValidated);
  const gracePeriodEnd = new Date(lastValidated.getTime() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);
  
  return new Date() < gracePeriodEnd;
}

/**
 * Phone home to GreenReach licensing server for online validation
 * @param {object} licenseData - License data object
 * @returns {Promise<object>} Validation response
 */
async function phoneHome(licenseData) {
  try {
    const response = await fetch(PHONE_HOME_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        licenseId: licenseData.licenseId,
        farmId: licenseData.farmId,
        fingerprint: await generateFingerprint(),
        version: licenseData.version,
      }),
      signal: AbortSignal.timeout(5000), // 5 second timeout
    });

    if (!response.ok) {
      throw new Error(`License server returned ${response.status}`);
    }

    return await response.json();
  } catch (err) {
    console.warn('[License] Phone home failed:', err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Update last validated timestamp in license file
 * @param {object} license - License object
 */
async function updateLastValidated(license) {
  try {
    license.lastValidated = new Date().toISOString();
    await fs.writeFile(LICENSE_PATH, JSON.stringify(license, null, 2), 'utf-8');
  } catch (err) {
    console.error('[License] Failed to update last validated:', err.message);
  }
}

/**
 * Validate license on application startup
 * @returns {Promise<object>} Validation result { valid: boolean, reason?: string, license?: object }
 */
export async function validateLicense() {
  // Development mode - skip validation
  if (process.env.NODE_ENV === 'development' || process.env.DEMO_MODE === 'true') {
    console.log('[License] Development mode - skipping validation');
    return { valid: true, reason: 'development_mode' };
  }

  // Load license
  const license = await loadLicense();
  if (!license) {
    return { valid: false, reason: 'license_not_found' };
  }

  // Verify signature
  const signatureValid = await verifySignature(license);
  if (!signatureValid) {
    return { valid: false, reason: 'invalid_signature' };
  }

  const { data: licenseData } = license;

  // Check expiration
  if (isExpired(licenseData)) {
    return { valid: false, reason: 'license_expired', license: licenseData };
  }

  // Verify hardware fingerprint
  const currentFingerprint = await generateFingerprint();
  if (licenseData.fingerprint && licenseData.fingerprint !== currentFingerprint) {
    console.warn('[License] Hardware fingerprint mismatch');
    console.warn(`Expected: ${licenseData.fingerprint}`);
    console.warn(`Current: ${currentFingerprint}`);
    return { valid: false, reason: 'fingerprint_mismatch', license: licenseData };
  }

  // Try online validation
  const phoneHomeResult = await phoneHome(licenseData);
  if (phoneHomeResult.ok) {
    await updateLastValidated(license);
    console.log('[License] Online validation successful');
    return { valid: true, reason: 'online_validation', license: licenseData };
  }

  // Online validation failed - check grace period
  if (isWithinGracePeriod(license)) {
    console.log(`[License] Offline mode - ${GRACE_PERIOD_DAYS} day grace period active`);
    return { valid: true, reason: 'grace_period', license: licenseData };
  }

  // Grace period expired
  return { valid: false, reason: 'grace_period_expired', license: licenseData };
}

/**
 * Get license information (safe for display)
 * @returns {Promise<object|null>} License info or null
 */
export async function getLicenseInfo() {
  const license = await loadLicense();
  if (!license || !license.data) {
    return null;
  }

  const { data } = license;
  return {
    farmId: data.farmId,
    farmName: data.farmName,
    licenseId: data.licenseId,
    tier: data.tier,
    features: data.features,
    expiresAt: data.expiresAt,
    lastValidated: license.lastValidated,
    issuedAt: data.issuedAt,
  };
}

/**
 * Check if a feature is enabled in the license
 * @param {string} feature - Feature name
 * @returns {Promise<boolean>} True if feature is enabled
 */
export async function hasFeature(feature) {
  // Edge devices get all features (ml, analytics, automation, etc.)
  if (process.env.EDGE_MODE === 'true' || process.env.EDGE_MODE === true) {
    return true; // All features enabled on edge devices
  }
  
  // Check license file
  const info = await getLicenseInfo();
  if (!info || !info.features) {
    return false;
  }

  return info.features.includes(feature) || info.features.includes('*');
}

/**
 * Get license tier
 * @returns {Promise<string>} License tier ('inventory-only', 'full', 'edge', 'enterprise')
 */
export async function getLicenseTier() {
  // Edge devices get 'edge' tier by default (includes ML/AI)
  if (process.env.EDGE_MODE === 'true' || process.env.EDGE_MODE === true) {
    console.log('[License] Edge device detected - using edge tier (includes ML/AI)');
    return 'edge';
  }
  
  // Check environment variable override
  if (process.env.DEPLOYMENT_MODE) {
    return process.env.DEPLOYMENT_MODE;
  }
  
  // Check license file
  const info = await getLicenseInfo();
  return info?.tier || 'inventory-only';
}

export default {
  validateLicense,
  getLicenseInfo,
  hasFeature,
  getLicenseTier,
  generateFingerprint,
};
