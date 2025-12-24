/**
 * Farm Provisioning Utilities
 * Handles new farm registration, activation codes, and license generation
 */

import crypto from 'crypto';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// RSA key paths (should match license-validator.js)
const PRIVATE_KEY_PATH = process.env.LICENSE_PRIVATE_KEY_PATH || 
  path.join(__dirname, '../../keys/license-private.pem');
const PUBLIC_KEY_PATH = process.env.LICENSE_PUBLIC_KEY_PATH || 
  path.join(__dirname, '../../keys/license-public.pem');

/**
 * Generate secure activation code
 * Format: XXXX-XXXX-XXXX-XXXX (16 alphanumeric characters)
 */
export function generateActivationCode() {
  const charset = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No confusing chars: 0,O,1,I
  const segments = 4;
  const segmentLength = 4;
  
  const code = [];
  for (let i = 0; i < segments; i++) {
    let segment = '';
    for (let j = 0; j < segmentLength; j++) {
      const randomIndex = crypto.randomInt(0, charset.length);
      segment += charset[randomIndex];
    }
    code.push(segment);
  }
  
  return code.join('-');
}

/**
 * Validate activation code format
 */
export function isValidActivationCode(code) {
  return /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code);
}

/**
 * Generate subdomain from farm name
 * Converts to lowercase, removes special chars, ensures uniqueness
 */
export function generateSubdomain(farmName, existingSubdomains = []) {
  // Convert to lowercase, replace spaces/special with hyphens
  let subdomain = farmName
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50);
  
  // Ensure uniqueness
  let finalSubdomain = subdomain;
  let counter = 1;
  
  while (existingSubdomains.includes(finalSubdomain)) {
    finalSubdomain = `${subdomain}-${counter}`;
    counter++;
  }
  
  return finalSubdomain;
}

/**
 * Validate subdomain format
 */
export function isValidSubdomain(subdomain) {
  // Must be 1-63 chars, lowercase alphanumeric + hyphens, not start/end with hyphen
  return /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(subdomain);
}

/**
 * Generate license file content
 * RSA-signed JSON license
 */
export async function generateLicense(farmData) {
  const {
    farmId,
    farmName,
    subdomain,
    tier,
    hardwareFingerprint,
    expiresAt,
    features = []
  } = farmData;
  
  // License data
  const licenseData = {
    id: crypto.randomUUID(),
    farmId,
    farmName,
    subdomain,
    tier,
    hardwareFingerprint: hardwareFingerprint || null,
    features,
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(expiresAt).toISOString(),
    issuer: 'GreenReach Inc.',
    version: '1.0'
  };
  
  // Read private key
  let privateKey;
  try {
    privateKey = await fs.readFile(PRIVATE_KEY_PATH, 'utf8');
  } catch (error) {
    console.error('[License] Private key not found, generating unsigned license');
    return {
      ...licenseData,
      signature: 'unsigned-development-only',
      warning: 'License is unsigned - private key not available'
    };
  }
  
  // Create signature
  const dataToSign = JSON.stringify(licenseData, null, 2);
  const sign = crypto.createSign('SHA256');
  sign.update(dataToSign);
  sign.end();
  
  const signature = sign.sign(privateKey, 'base64');
  
  return {
    ...licenseData,
    signature
  };
}

/**
 * Verify license signature
 */
export async function verifyLicense(license) {
  try {
    const publicKey = await fs.readFile(PUBLIC_KEY_PATH, 'utf8');
    
    // Extract signature
    const { signature, ...licenseData } = license;
    
    if (signature === 'unsigned-development-only') {
      console.warn('[License] Unsigned license detected (development mode)');
      return true;
    }
    
    // Verify signature
    const dataToVerify = JSON.stringify(licenseData, null, 2);
    const verify = crypto.createVerify('SHA256');
    verify.update(dataToVerify);
    verify.end();
    
    return verify.verify(publicKey, signature, 'base64');
  } catch (error) {
    console.error('[License] Verification failed:', error.message);
    return false;
  }
}

/**
 * Calculate license expiration date
 */
export function calculateExpirationDate(durationDays = 365) {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + durationDays);
  return expiresAt;
}

/**
 * Calculate grace period end date (30 days after expiration)
 */
export function calculateGracePeriodEnd(expiresAt) {
  const gracePeriodEnd = new Date(expiresAt);
  gracePeriodEnd.setDate(gracePeriodEnd.getDate() + 30);
  return gracePeriodEnd;
}

/**
 * Provision tenant database
 * Creates tenant-specific schemas/tables if needed
 */
export async function provisionTenantDatabase(pool, farmId, subdomain) {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // In a multi-tenant setup, we use tenant_id to scope all queries
    // The actual tables already exist, we just need to ensure tenant isolation
    
    // Create sample inventory for new tenant
    await client.query(`
      INSERT INTO inventory (tenant_id, name, category, available_quantity, wholesale_price, wholesale_enabled)
      VALUES
        ($1, 'Sample Product 1', 'Leafy Greens', 0, 5.99, true),
        ($1, 'Sample Product 2', 'Herbs', 0, 3.99, true)
      ON CONFLICT DO NOTHING
    `, [farmId]);
    
    // Create welcome notification
    await client.query(`
      INSERT INTO notifications (tenant_id, type, message, read)
      VALUES ($1, 'info', 'Welcome to Light Engine! Your farm has been successfully provisioned.', false)
      ON CONFLICT DO NOTHING
    `, [farmId]);
    
    await client.query('COMMIT');
    
    console.log(`[Provisioning] Tenant database provisioned for ${subdomain} (${farmId})`);
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[Provisioning] Database provisioning failed:', error.message);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Deprovision tenant (soft delete - mark inactive)
 */
export async function deprovisionFarm(pool, farmId, reason = 'user_requested') {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Mark farm as inactive
    await client.query(`
      UPDATE farms
      SET active = false, updated_at = NOW()
      WHERE id = $1
    `, [farmId]);
    
    // Mark licenses as revoked
    await client.query(`
      UPDATE licenses
      SET status = 'revoked', updated_at = NOW()
      WHERE farm_id = $1
    `, [farmId]);
    
    // Log activity
    await client.query(`
      INSERT INTO farm_activity (farm_id, event_type, details)
      VALUES ($1, 'deprovisioned', $2)
    `, [farmId, { reason, timestamp: new Date().toISOString() }]);
    
    await client.query('COMMIT');
    
    console.log(`[Provisioning] Farm ${farmId} deprovisioned: ${reason}`);
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[Provisioning] Deprovisioning failed:', error.message);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Transfer farm to new owner
 */
export async function transferFarm(pool, farmId, newEmail, newFingerprint = null) {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Update farm contact
    await client.query(`
      UPDATE farms
      SET contact_email = $1, updated_at = NOW()
      WHERE id = $2
    `, [newEmail, farmId]);
    
    // If new hardware, update license fingerprint
    if (newFingerprint) {
      await client.query(`
        UPDATE licenses
        SET hardware_fingerprint = $1, updated_at = NOW()
        WHERE farm_id = $2
      `, [newFingerprint, farmId]);
    }
    
    // Log activity
    await client.query(`
      INSERT INTO farm_activity (farm_id, event_type, details)
      VALUES ($1, 'transferred', $2)
    `, [farmId, { newEmail, newFingerprint, timestamp: new Date().toISOString() }]);
    
    await client.query('COMMIT');
    
    console.log(`[Provisioning] Farm ${farmId} transferred to ${newEmail}`);
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[Provisioning] Transfer failed:', error.message);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Get default features for tier
 */
export function getDefaultFeatures(tier) {
  const featureSets = {
    'inventory-only': [
      'inventory',
      'wholesale',
      'reports'
    ],
    'full': [
      'inventory',
      'wholesale',
      'reports',
      'automation',
      'scheduling',
      'sensors',
      'notifications'
    ],
    'enterprise': [
      'inventory',
      'wholesale',
      'reports',
      'automation',
      'scheduling',
      'sensors',
      'notifications',
      'multi-user',
      'api-access',
      'custom-branding',
      'priority-support'
    ]
  };
  
  return featureSets[tier] || featureSets['inventory-only'];
}

/**
 * Validate provisioning request
 */
export function validateProvisioningRequest(data) {
  const errors = [];
  
  if (!data.farmName || data.farmName.trim().length < 2) {
    errors.push('Farm name must be at least 2 characters');
  }
  
  if (data.farmName && data.farmName.length > 255) {
    errors.push('Farm name must be less than 255 characters');
  }
  
  if (!data.contactEmail || !isValidEmail(data.contactEmail)) {
    errors.push('Valid contact email is required');
  }
  
  if (data.tier && !['inventory-only', 'full', 'enterprise'].includes(data.tier)) {
    errors.push('Tier must be inventory-only, full, or enterprise');
  }
  
  if (data.deploymentMode && !['cloud', 'edge', 'desktop'].includes(data.deploymentMode)) {
    errors.push('Deployment mode must be cloud, edge, or desktop');
  }
  
  if (data.licenseDuration && (data.licenseDuration < 1 || data.licenseDuration > 3650)) {
    errors.push('License duration must be between 1 and 3650 days');
  }
  
  return errors;
}

/**
 * Simple email validation
 */
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Generate farm API key for programmatic access (enterprise only)
 */
export function generateApiKey() {
  const prefix = 'grc_'; // GreenReach Central
  const key = crypto.randomBytes(32).toString('hex');
  return prefix + key;
}

/**
 * Hash API key for storage
 */
export function hashApiKey(apiKey) {
  return crypto.createHash('sha256').update(apiKey).digest('hex');
}
