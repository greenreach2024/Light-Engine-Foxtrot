/**
 * Farm Provisioning API Routes
 * Handles new farm registration, activation, and lifecycle management
 */

import express from 'express';
import crypto from 'crypto';
import {
  generateActivationCode,
  isValidActivationCode,
  generateSubdomain,
  isValidSubdomain,
  generateLicense,
  verifyLicense,
  calculateExpirationDate,
  calculateGracePeriodEnd,
  provisionTenantDatabase,
  deprovisionFarm,
  transferFarm,
  getDefaultFeatures,
  validateProvisioningRequest,
  generateApiKey,
  hashApiKey
} from '../lib/provisioning.js';

const router = express.Router();

/**
 * POST /api/provisioning/register
 * Register a new farm and generate activation code
 */
router.post('/register', async (req, res) => {
  try {
    const {
      farmName,
      contactEmail,
      tier = 'inventory-only',
      deploymentMode = 'cloud',
      licenseDuration = 365, // days
      hardwareFingerprint = null, // Optional for cloud deployments
      metadata = {}
    } = req.body;
    
    // Validate request
    const validationErrors = validateProvisioningRequest(req.body);
    if (validationErrors.length > 0) {
      return res.status(400).json({
        ok: false,
        error: 'Validation failed',
        errors: validationErrors
      });
    }
    
    const pool = req.app.get('pool');
    
    // Check for duplicate email
    const existingFarm = await pool.query(
      'SELECT id, subdomain FROM farms WHERE contact_email = $1 AND active = true',
      [contactEmail]
    );
    
    if (existingFarm.rows.length > 0) {
      return res.status(409).json({
        ok: false,
        error: 'Farm already registered',
        existingFarm: {
          id: existingFarm.rows[0].id,
          subdomain: existingFarm.rows[0].subdomain
        }
      });
    }
    
    // Get existing subdomains for uniqueness check
    const subdomainResult = await pool.query('SELECT subdomain FROM farms');
    const existingSubdomains = subdomainResult.rows.map(row => row.subdomain);
    
    // Generate subdomain
    const subdomain = generateSubdomain(farmName, existingSubdomains);
    
    if (!isValidSubdomain(subdomain)) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid subdomain generated from farm name',
        subdomain
      });
    }
    
    // Generate activation code
    const activationCode = generateActivationCode();
    
    // Calculate expiration dates
    const expiresAt = calculateExpirationDate(licenseDuration);
    const gracePeriodEndsAt = calculateGracePeriodEnd(expiresAt);
    
    // Create farm record
    const farmResult = await pool.query(`
      INSERT INTO farms (
        subdomain,
        name,
        contact_email,
        tier,
        deployment_mode,
        active,
        metadata
      )
      VALUES ($1, $2, $3, $4, $5, true, $6)
      RETURNING *
    `, [subdomain, farmName, contactEmail, tier, deploymentMode, metadata]);
    
    const farm = farmResult.rows[0];
    
    // Generate license
    const license = await generateLicense({
      farmId: farm.id,
      farmName: farm.name,
      subdomain: farm.subdomain,
      tier: farm.tier,
      hardwareFingerprint,
      expiresAt,
      features: getDefaultFeatures(tier)
    });
    
    // Store license
    await pool.query(`
      INSERT INTO licenses (
        farm_id,
        hardware_fingerprint,
        expires_at,
        grace_period_ends_at,
        status,
        features
      )
      VALUES ($1, $2, $3, $4, 'active', $5)
    `, [
      farm.id,
      hardwareFingerprint,
      expiresAt,
      gracePeriodEndsAt,
      JSON.stringify(license.features)
    ]);
    
    // Store activation code (encrypted)
    const activationCodeHash = crypto
      .createHash('sha256')
      .update(activationCode)
      .digest('hex');
    
    await pool.query(`
      INSERT INTO activation_codes (
        farm_id,
        code_hash,
        expires_at,
        used
      )
      VALUES ($1, $2, NOW() + INTERVAL '7 days', false)
    `, [farm.id, activationCodeHash]);
    
    // Provision tenant database
    await provisionTenantDatabase(pool, farm.id, farm.subdomain);
    
    // Log activity
    await pool.query(`
      INSERT INTO farm_activity (farm_id, event_type, details)
      VALUES ($1, 'registered', $2)
    `, [farm.id, {
      tier,
      deploymentMode,
      licenseDuration,
      contactEmail
    }]);
    
    console.log(`[Provisioning] New farm registered: ${subdomain} (${farm.id})`);
    
    res.status(201).json({
      ok: true,
      farm: {
        id: farm.id,
        subdomain: farm.subdomain,
        name: farm.name,
        tier: farm.tier,
        deploymentMode: farm.deployment_mode
      },
      license: {
        ...license,
        signature: license.signature.substring(0, 20) + '...' // Truncate for response
      },
      activation: {
        code: activationCode,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        instructions: `Use this code at https://${subdomain}.greenreach.io/activate or during edge device setup`
      },
      urls: {
        cloud: `https://${subdomain}.greenreach.io`,
        activation: `https://${subdomain}.greenreach.io/activate?code=${activationCode}`,
        edgeInstall: `curl -fsSL https://install.greenreach.io/install.sh | bash -s -- ${activationCode}`
      }
    });
    
  } catch (error) {
    console.error('[Provisioning] Registration failed:', error.message);
    res.status(500).json({
      ok: false,
      error: 'Registration failed',
      message: error.message
    });
  }
});

/**
 * POST /api/provisioning/activate
 * Activate a farm using activation code
 */
router.post('/activate', async (req, res) => {
  try {
    const { activationCode, hardwareFingerprint } = req.body;
    
    if (!activationCode || !isValidActivationCode(activationCode)) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid activation code format'
      });
    }
    
    const pool = req.app.get('pool');
    
    // Hash activation code
    const codeHash = crypto
      .createHash('sha256')
      .update(activationCode)
      .digest('hex');
    
    // Find activation code
    const codeResult = await pool.query(`
      SELECT ac.*, f.id as farm_id, f.subdomain, f.name, f.tier
      FROM activation_codes ac
      JOIN farms f ON f.id = ac.farm_id
      WHERE ac.code_hash = $1
        AND ac.used = false
        AND ac.expires_at > NOW()
    `, [codeHash]);
    
    if (codeResult.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        error: 'Invalid or expired activation code'
      });
    }
    
    const activation = codeResult.rows[0];
    
    // Mark code as used
    await pool.query(`
      UPDATE activation_codes
      SET used = true, used_at = NOW()
      WHERE id = $1
    `, [activation.id]);
    
    // Update license with hardware fingerprint if provided
    if (hardwareFingerprint) {
      await pool.query(`
        UPDATE licenses
        SET hardware_fingerprint = $1, updated_at = NOW()
        WHERE farm_id = $2
      `, [hardwareFingerprint, activation.farm_id]);
    }
    
    // Update farm last_seen
    await pool.query(`
      UPDATE farms
      SET last_seen_at = NOW()
      WHERE id = $1
    `, [activation.farm_id]);
    
    // Get updated license
    const licenseResult = await pool.query(`
      SELECT * FROM licenses WHERE farm_id = $1
    `, [activation.farm_id]);
    
    const license = licenseResult.rows[0];
    
    // Log activity
    await pool.query(`
      INSERT INTO farm_activity (farm_id, event_type, details)
      VALUES ($1, 'activated', $2)
    `, [activation.farm_id, { hardwareFingerprint }]);
    
    console.log(`[Provisioning] Farm activated: ${activation.subdomain} (${activation.farm_id})`);
    
    res.json({
      ok: true,
      farm: {
        id: activation.farm_id,
        subdomain: activation.subdomain,
        name: activation.name,
        tier: activation.tier
      },
      license: {
        id: license.id,
        expiresAt: license.expires_at,
        gracePeriodEndsAt: license.grace_period_ends_at,
        features: license.features
      },
      urls: {
        cloud: `https://${activation.subdomain}.greenreach.io`,
        api: `https://${activation.subdomain}.greenreach.io/api`
      }
    });
    
  } catch (error) {
    console.error('[Provisioning] Activation failed:', error.message);
    res.status(500).json({
      ok: false,
      error: 'Activation failed',
      message: error.message
    });
  }
});

/**
 * POST /api/provisioning/deactivate
 * Deactivate a farm (admin only)
 */
router.post('/deactivate', async (req, res) => {
  try {
    const { farmId, reason = 'admin_action' } = req.body;
    
    if (!farmId) {
      return res.status(400).json({
        ok: false,
        error: 'Farm ID required'
      });
    }
    
    const pool = req.app.get('pool');
    
    await deprovisionFarm(pool, farmId, reason);
    
    res.json({
      ok: true,
      message: 'Farm deactivated successfully',
      farmId
    });
    
  } catch (error) {
    console.error('[Provisioning] Deactivation failed:', error.message);
    res.status(500).json({
      ok: false,
      error: 'Deactivation failed',
      message: error.message
    });
  }
});

/**
 * POST /api/provisioning/transfer
 * Transfer farm to new owner (admin only)
 */
router.post('/transfer', async (req, res) => {
  try {
    const { farmId, newEmail, newFingerprint } = req.body;
    
    if (!farmId || !newEmail) {
      return res.status(400).json({
        ok: false,
        error: 'Farm ID and new email required'
      });
    }
    
    const pool = req.app.get('pool');
    
    await transferFarm(pool, farmId, newEmail, newFingerprint);
    
    res.json({
      ok: true,
      message: 'Farm transferred successfully',
      farmId,
      newEmail
    });
    
  } catch (error) {
    console.error('[Provisioning] Transfer failed:', error.message);
    res.status(500).json({
      ok: false,
      error: 'Transfer failed',
      message: error.message
    });
  }
});

/**
 * POST /api/provisioning/renew
 * Renew license for existing farm
 */
router.post('/renew', async (req, res) => {
  try {
    const { farmId, duration = 365 } = req.body;
    
    if (!farmId) {
      return res.status(400).json({
        ok: false,
        error: 'Farm ID required'
      });
    }
    
    const pool = req.app.get('pool');
    
    // Calculate new expiration (from now, not from old expiration)
    const expiresAt = calculateExpirationDate(duration);
    const gracePeriodEndsAt = calculateGracePeriodEnd(expiresAt);
    
    // Update license
    await pool.query(`
      UPDATE licenses
      SET
        expires_at = $1,
        grace_period_ends_at = $2,
        status = 'active',
        updated_at = NOW()
      WHERE farm_id = $3
    `, [expiresAt, gracePeriodEndsAt, farmId]);
    
    // Log activity
    await pool.query(`
      INSERT INTO farm_activity (farm_id, event_type, details)
      VALUES ($1, 'renewed', $2)
    `, [farmId, { duration, newExpiresAt: expiresAt }]);
    
    console.log(`[Provisioning] License renewed for farm ${farmId}`);
    
    res.json({
      ok: true,
      message: 'License renewed successfully',
      license: {
        expiresAt,
        gracePeriodEndsAt,
        duration
      }
    });
    
  } catch (error) {
    console.error('[Provisioning] Renewal failed:', error.message);
    res.status(500).json({
      ok: false,
      error: 'Renewal failed',
      message: error.message
    });
  }
});

/**
 * POST /api/provisioning/upgrade
 * Upgrade farm tier
 */
router.post('/upgrade', async (req, res) => {
  try {
    const { farmId, newTier } = req.body;
    
    if (!farmId || !newTier) {
      return res.status(400).json({
        ok: false,
        error: 'Farm ID and new tier required'
      });
    }
    
    if (!['inventory-only', 'full', 'enterprise'].includes(newTier)) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid tier',
        validTiers: ['inventory-only', 'full', 'enterprise']
      });
    }
    
    const pool = req.app.get('pool');
    
    // Update farm tier
    await pool.query(`
      UPDATE farms
      SET tier = $1, updated_at = NOW()
      WHERE id = $2
    `, [newTier, farmId]);
    
    // Update license features
    const newFeatures = getDefaultFeatures(newTier);
    await pool.query(`
      UPDATE licenses
      SET features = $1, updated_at = NOW()
      WHERE farm_id = $2
    `, [JSON.stringify(newFeatures), farmId]);
    
    // Log activity
    await pool.query(`
      INSERT INTO farm_activity (farm_id, event_type, details)
      VALUES ($1, 'tier_upgraded', $2)
    `, [farmId, { newTier, newFeatures }]);
    
    console.log(`[Provisioning] Farm ${farmId} upgraded to ${newTier}`);
    
    res.json({
      ok: true,
      message: 'Farm tier upgraded successfully',
      tier: newTier,
      features: newFeatures
    });
    
  } catch (error) {
    console.error('[Provisioning] Upgrade failed:', error.message);
    res.status(500).json({
      ok: false,
      error: 'Upgrade failed',
      message: error.message
    });
  }
});

/**
 * GET /api/provisioning/status/:farmId
 * Get provisioning status for a farm
 */
router.get('/status/:farmId', async (req, res) => {
  try {
    const { farmId } = req.params;
    
    const pool = req.app.get('pool');
    
    const result = await pool.query(`
      SELECT
        f.*,
        l.id as license_id,
        l.expires_at,
        l.grace_period_ends_at,
        l.status as license_status,
        l.features,
        (SELECT COUNT(*) FROM activation_codes WHERE farm_id = f.id AND used = false) as unused_codes
      FROM farms f
      LEFT JOIN licenses l ON l.farm_id = f.id
      WHERE f.id = $1 OR f.subdomain = $1
    `, [farmId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        error: 'Farm not found'
      });
    }
    
    const farm = result.rows[0];
    
    res.json({
      ok: true,
      farm: {
        id: farm.id,
        subdomain: farm.subdomain,
        name: farm.name,
        tier: farm.tier,
        active: farm.active,
        deploymentMode: farm.deployment_mode,
        createdAt: farm.created_at,
        lastSeenAt: farm.last_seen_at
      },
      license: {
        id: farm.license_id,
        status: farm.license_status,
        expiresAt: farm.expires_at,
        gracePeriodEndsAt: farm.grace_period_ends_at,
        features: farm.features
      },
      provisioning: {
        unusedActivationCodes: farm.unused_codes
      }
    });
    
  } catch (error) {
    console.error('[Provisioning] Status check failed:', error.message);
    res.status(500).json({
      ok: false,
      error: 'Status check failed',
      message: error.message
    });
  }
});

export default router;
