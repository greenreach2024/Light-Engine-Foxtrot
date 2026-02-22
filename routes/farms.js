/**
 * GreenReach Central - Farm Registration & Provisioning
 * 
 * This is the central registration server operated by GreenReach (SaaS provider).
 * Farms purchase Light Engine hardware, receive a registration code, and call
 * this endpoint during first-time setup to receive their credentials.
 * 
 * Architecture:
 * - GreenReach generates registration codes (admin tool)
 * - Farm enters code during setup wizard
 * - This endpoint validates code and provisions farm
 * - Returns farm_id, API keys, and connection credentials
 * - Farm stores credentials and connects to GreenReach services
 */

import express from 'express';
import crypto from 'crypto';
import { generateFarmToken, FARM_ROLES } from '../lib/farm-auth.js';

const router = express.Router();

// In-memory storage (would be database in production)
// This would be managed by GreenReach admin dashboard
const registrationCodes = new Map();
const registeredFarms = new Map();

/**
 * Generate a unique Farm ID
 * Format: GR-{timestamp}{counter}
 */
function generateFarmId() {
  const timestamp = Date.now().toString().slice(-10);
  const counter = String(registeredFarms.size + 1).padStart(4, '0');
  return `GR-${timestamp}${counter}`;
}

/**
 * Generate API key with prefix
 * wsk_ = wholesale key
 * posk_ = POS key  
 * devk_ = device key
 */
function generateApiKey(prefix) {
  const random = crypto.randomBytes(32).toString('hex');
  return `${prefix}_${random}`;
}

/**
 * POST /api/farms/register
 * 
 * Farm server calls this during first-time setup wizard.
 * Validates registration code and provisions the farm with credentials.
 * 
 * Body: {
 *   registration_code: string (8-char code from GreenReach)
 *   device_info: { model, serial, version }
 *   farm_name: string (optional)
 *   contact_email: string (optional)
 * }
 * 
 * Returns: {
 *   farm_id: string
 *   farm_name: string
 *   credentials: {
 *     wholesale_api_key: string (for GreenReach marketplace sync)
 *     pos_api_key: string (for payment processing)
 *     device_api_key: string (for Activity Hub tablets)
 *     jwt_secret: string (for generating farm tokens)
 *   }
 *   endpoints: {
 *     wholesale_api: string (GreenReach marketplace)
 *     monitoring_api: string (GreenReach farm health)
 *     update_api: string (software updates)
 *   }
 *   status: "active"
 * }
 */
router.post('/register', async (req, res) => {
  try {
    const { registration_code, device_info, farm_name, contact_email } = req.body;

    // Validate required fields
    if (!registration_code) {
      return res.status(400).json({ 
        error: 'Registration code is required',
        message: 'Please enter the 8-character code provided by GreenReach'
      });
    }

    // Check if code exists and is unused
    const codeData = registrationCodes.get(registration_code);
    
    if (!codeData) {
      return res.status(404).json({ 
        error: 'Invalid registration code',
        message: 'This registration code does not exist. Please check the code and try again.'
      });
    }

    if (codeData.used) {
      return res.status(409).json({ 
        error: 'Registration code already used',
        message: 'This registration code has already been activated. Contact GreenReach support if you need assistance.',
        used_by: codeData.farm_id,
        used_at: codeData.used_at
      });
    }

    // Generate unique farm ID
    const farmId = generateFarmId();
    const finalFarmName = farm_name || codeData.farm_name || `Farm ${farmId}`;

    // Generate API keys for different platforms
    const wholesaleApiKey = generateApiKey('wsk');  // Wholesale marketplace
    const posApiKey = generateApiKey('posk');        // POS/payment
    const deviceApiKey = generateApiKey('devk');     // Device/tablet pairing

    // Generate JWT secret for this farm (used for Activity Hub tokens)
    const jwtSecret = crypto.randomBytes(64).toString('hex');

    // Create farm record
    const farmRecord = {
      farm_id: farmId,
      farm_name: finalFarmName,
      registration_code,
      contact_email: contact_email || codeData.contact_email,
      device_info,
      credentials: {
        wholesale_api_key: wholesaleApiKey,
        pos_api_key: posApiKey,
        device_api_key: deviceApiKey,
        jwt_secret: jwtSecret
      },
      endpoints: {
        wholesale_api: process.env.WHOLESALE_API_URL || 'https://wholesale.greenreach.io',
        monitoring_api: process.env.MONITORING_API_URL || 'https://monitor.greenreach.io',
        update_api: process.env.UPDATE_API_URL || 'https://updates.greenreach.io',
        cloud_api: process.env.CLOUD_API_URL || window?.location?.origin || 'https://api.greenreach.io'
      },
      status: 'active',
      registered_at: new Date().toISOString(),
      plan: codeData.plan || 'starter'
    };

    // Save farm record
    registeredFarms.set(farmId, farmRecord);

    // Mark registration code as used
    registrationCodes.set(registration_code, {
      ...codeData,
      used: true,
      farm_id: farmId,
      used_at: new Date().toISOString()
    });

    // Log successful registration
    console.log(`✅ Farm registered: ${farmId} (${finalFarmName})`);
    console.log(`   Registration code: ${registration_code}`);
    console.log(`   Contact: ${contact_email || 'not provided'}`);

    // Return credentials to farm server
    res.json({
      success: true,
      farm_id: farmId,
      farm_name: finalFarmName,
      credentials: farmRecord.credentials,
      endpoints: farmRecord.endpoints,
      status: farmRecord.status,
      plan: farmRecord.plan,
      message: 'Farm successfully registered with GreenReach'
    });

  } catch (error) {
    console.error('Farm registration error:', error);
    res.status(500).json({ 
      error: 'Registration failed',
      message: 'An error occurred during registration. Please try again or contact GreenReach support.'
    });
  }
});

/**
 * GET /api/farms/:farmId
 * 
 * Get farm information (requires authentication)
 */
router.get('/:farmId', (req, res) => {
  const { farmId } = req.params;
  const farm = registeredFarms.get(farmId);

  if (!farm) {
    return res.status(404).json({ error: 'Farm not found' });
  }

  // Don't expose credentials in GET requests
  const { credentials, ...farmInfo } = farm;

  res.json({
    success: true,
    farm: {
      ...farmInfo,
      has_credentials: true
    }
  });
});

/**
 * POST /api/farms/verify-id
 * Verify if a Farm ID is valid and active
 * Used by purchase flow to determine if payment should be enabled
 * 
 * Body: { farm_id: string }
 * Returns: { valid: boolean, farm_name?: string, status?: string }
 */
router.post('/verify-id', (req, res) => {
  try {
    const { farm_id } = req.body;

    if (!farm_id) {
      return res.status(400).json({
        valid: false,
        error: 'farm_id is required'
      });
    }

    // Validate format
    if (!farm_id.match(/^GR-[A-Z0-9]{10,}$/i)) {
      return res.json({
        valid: false,
        message: 'Invalid Farm ID format'
      });
    }

    // Check if farm exists
    const farm = registeredFarms.get(farm_id);

    if (!farm) {
      return res.json({
        valid: false,
        message: 'Farm ID not found in our system'
      });
    }

    // Farm exists and is valid
    return res.json({
      valid: true,
      farm_id: farm.farm_id,
      farm_name: farm.farm_name,
      status: farm.status,
      message: 'Farm ID verified successfully'
    });

  } catch (error) {
    console.error('[Farm Verification] Error:', error);
    return res.status(500).json({
      valid: false,
      error: 'verification_failed'
    });
  }
});

/**
 * POST /api/farms/generate-code
 * 
 * GreenReach admin endpoint to generate registration codes
 * (This would be in GreenReach admin dashboard)
 * 
 * Body: {
 *   farm_name: string (optional)
 *   contact_email: string (optional)
 *   plan: string (starter/professional/enterprise)
 * }
 */
router.post('/generate-code', (req, res) => {
  try {
    const { farm_name, contact_email, plan } = req.body;

    // Generate 8-character alphanumeric code
    const code = crypto.randomBytes(4).toString('hex').toUpperCase();

    // Store code data
    registrationCodes.set(code, {
      code,
      farm_name: farm_name || null,
      contact_email: contact_email || null,
      plan: plan || 'starter',
      generated_at: new Date().toISOString(),
      used: false,
      farm_id: null,
      used_at: null
    });

    console.log(`✅ Registration code generated: ${code}`);
    console.log(`   Farm: ${farm_name || 'not specified'}`);
    console.log(`   Plan: ${plan || 'starter'}`);

    res.json({
      success: true,
      registration_code: code,
      farm_name: farm_name || null,
      plan: plan || 'starter',
      expires_at: null, // Codes don't expire by default
      message: 'Registration code generated successfully'
    });

  } catch (error) {
    console.error('Code generation error:', error);
    res.status(500).json({ error: 'Failed to generate registration code' });
  }
});

/**
 * GET /api/farms/codes/list
 * 
 * List all registration codes (admin only)
 */
router.get('/codes/list', (req, res) => {
  const codes = Array.from(registrationCodes.values());
  res.json({
    success: true,
    codes,
    total: codes.length,
    used: codes.filter(c => c.used).length,
    available: codes.filter(c => !c.used).length
  });
});

/**
 * GET /api/farms/list
 * 
 * List all registered farms (admin only)
 */
router.get('/list', (req, res) => {
  const farms = Array.from(registeredFarms.values()).map(farm => {
    const { credentials, ...farmInfo } = farm;
    return {
      ...farmInfo,
      has_credentials: true
    };
  });

  res.json({
    success: true,
    farms,
    total: farms.length
  });
});

/**
 * GET /api/farms/available
 * 
 * List available farms for farm selector UI.
 * Returns farms from database (cloud mode) or in-memory (edge mode).
 * Used by farm-sales pages when no farm context is present.
 */
router.get('/available', async (req, res) => {
  try {
    const dbPool = req.app.locals.db;
    
    // Try database first (cloud mode)
    if (dbPool) {
      const result = await dbPool.query(
        'SELECT farm_id, name, farm_slug FROM farms WHERE status = $1 OR status IS NULL ORDER BY name',
        ['active']
      );
      
      if (result.rows && result.rows.length > 0) {
        return res.json({
          ok: true,
          source: 'database',
          farms: result.rows.map(f => ({
            farm_id: f.farm_id,
            name: f.name,
            slug: f.farm_slug || f.farm_id
          }))
        });
      }
    }
    
    // Fallback to in-memory registered farms
    if (registeredFarms.size > 0) {
      const farms = Array.from(registeredFarms.values()).map(farm => ({
        farm_id: farm.farm_id,
        name: farm.farm_name || farm.farm_id,
        slug: farm.farm_slug || farm.farm_id
      }));
      
      return res.json({
        ok: true,
        source: 'memory',
        farms
      });
    }
    
    // No farms available
    return res.json({
      ok: true,
      source: 'none',
      farms: [],
      message: 'No farms registered. Use demo tokens for testing.'
    });
    
  } catch (error) {
    console.error('[farms/available] Error:', error);
    res.status(500).json({ 
      ok: false, 
      error: 'Failed to list farms',
      message: error.message
    });
  }
});

/**
 * GET /api/farms/by-slug/:slug
 * 
 * Look up a farm by its slug. Used for resolving
 * ?farm=notable-sprout URLs to farm_id.
 */
router.get('/by-slug/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const dbPool = req.app.locals.db;
    
    if (!slug) {
      return res.status(400).json({ ok: false, error: 'Slug is required' });
    }
    
    // Try database first
    if (dbPool) {
      const result = await dbPool.query(
        'SELECT farm_id, name, farm_slug FROM farms WHERE farm_slug = $1 OR farm_id = $1',
        [slug]
      );
      
      if (result.rows && result.rows.length > 0) {
        const farm = result.rows[0];
        return res.json({
          ok: true,
          source: 'database',
          farm: {
            farm_id: farm.farm_id,
            name: farm.name,
            slug: farm.farm_slug || farm.farm_id
          }
        });
      }
    }
    
    // Try in-memory farms
    for (const [id, farm] of registeredFarms) {
      if (farm.farm_slug === slug || id === slug) {
        return res.json({
          ok: true,
          source: 'memory',
          farm: {
            farm_id: id,
            name: farm.farm_name || id,
            slug: farm.farm_slug || id
          }
        });
      }
    }
    
    // Not found
    return res.status(404).json({
      ok: false,
      error: 'Farm not found',
      slug
    });
    
  } catch (error) {
    console.error('[farms/by-slug] Error:', error);
    res.status(500).json({ 
      ok: false, 
      error: 'Failed to look up farm',
      message: error.message
    });
  }
});

// Initialize with a test registration code for development
registrationCodes.set('TEST1234', {
  code: 'TEST1234',
  farm_name: 'Demo Farm',
  contact_email: 'demo@example.com',
  plan: 'professional',
  generated_at: new Date().toISOString(),
  used: false,
  farm_id: null,
  used_at: null
});

console.log('🔐 GreenReach Central Registration Service initialized');
console.log('   Test code available: TEST1234');

export default router;
