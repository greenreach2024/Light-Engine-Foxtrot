/**
 * Setup Activation API Routes
 * Handles edge device activation, license provisioning, and initial configuration
 */

import express from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { promisify } from 'util';
import { exec } from 'child_process';

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = express.Router();

// Use local config directory for AWS compatibility
const CONFIG_DIR = path.join(__dirname, '..', 'config');
const LICENSE_DIR = path.join(CONFIG_DIR, 'licenses');

// In-memory store of activation codes (in production, this would be a database)
// Format: { code: { farmId, tier, expiresAt, used: false } }
const activationCodes = new Map();

// Initialize test activation code
activationCodes.set('TEST1234', {
  farmId: 'FARM-TEST-001',
  farmName: 'Test Farm',
  tier: 'pro',
  expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(), // 1 year
  used: false,
  createdAt: new Date().toISOString()
});

console.log('[Setup] Test activation code initialized: TEST1234');

/**
 * Generate hardware fingerprint for the device
 */
async function generateFingerprint() {
  try {
    const networkInterfaces = os.networkInterfaces();
    let mac = '';
    
    // Get first non-internal MAC address
    for (const [name, interfaces] of Object.entries(networkInterfaces)) {
      for (const iface of interfaces) {
        if (!iface.internal && iface.mac && iface.mac !== '00:00:00:00:00:00') {
          mac = iface.mac;
          break;
        }
      }
      if (mac) break;
    }
    
    // Get CPU info
    const cpus = os.cpus();
    const cpuModel = cpus[0]?.model || '';
    
    // Get disk UUID (Linux only)
    let diskUuid = '';
    try {
      const { stdout } = await execAsync('lsblk -no UUID / | head -1');
      diskUuid = stdout.trim();
    } catch (error) {
      console.warn('[Setup] Could not get disk UUID:', error.message);
    }
    
    // Create fingerprint hash
    const fingerprintData = `${mac}|${cpuModel}|${diskUuid}`;
    const hash = crypto.createHash('sha256').update(fingerprintData).digest('hex');
    
    return hash;
  } catch (error) {
    console.error('[Setup] Error generating fingerprint:', error);
    throw new Error('Failed to generate hardware fingerprint');
  }
}

/**
 * Sign license data with private key
 */
function signLicense(licenseData, privateKeyPath) {
  try {
    const privateKey = fs.readFileSync(privateKeyPath, 'utf-8');
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(JSON.stringify(licenseData));
    const signature = sign.sign(privateKey, 'base64');
    return signature;
  } catch (error) {
    console.error('[Setup] Error signing license:', error);
    throw new Error('Failed to sign license');
  }
}

/**
 * POST /api/setup/activate
 * Activate edge device with activation code
 */
router.post('/activate', async (req, res) => {
  try {
    const { activationCode, farmName, timezone, networkConfig } = req.body;
    
    if (!activationCode) {
      return res.status(400).json({ error: 'Activation code required' });
    }
    
    // Verify activation code
    const activation = activationCodes.get(activationCode.toUpperCase());
    if (!activation) {
      return res.status(404).json({ error: 'Invalid activation code' });
    }
    
    if (activation.used) {
      return res.status(400).json({ error: 'Activation code already used' });
    }
    
    if (new Date() > new Date(activation.expiresAt)) {
      return res.status(400).json({ error: 'Activation code expired' });
    }
    
    // Generate hardware fingerprint
    const fingerprint = await generateFingerprint();
    
    // Create license
    const licenseId = `LIC-${Date.now()}`;
    const licenseData = {
      licenseId,
      farmId: activation.farmId,
      farmName: farmName || activation.farmName,
      tier: activation.tier,
      features: getFeaturesByTier(activation.tier),
      hardwareFingerprint: fingerprint,
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(), // 1 year
      activatedWith: activationCode
    };
    
    // Sign license
    const privateKeyPath = path.join(__dirname, '../config/greenreach-private.pem');
    if (!fs.existsSync(privateKeyPath)) {
      return res.status(500).json({ 
        error: 'Server configuration error',
        message: 'Private key not found. Cannot sign license.'
      });
    }
    
    const signature = signLicense(licenseData, privateKeyPath);
    const signedLicense = { ...licenseData, signature };
    
    // Save license to local config directory
    const licensePath = path.join(LICENSE_DIR, 'license.json');
    
    // Create directory if it doesn't exist
    if (!fs.existsSync(LICENSE_DIR)) {
      try {
        fs.mkdirSync(LICENSE_DIR, { recursive: true, mode: 0o755 });
      } catch (error) {
        console.error('[Setup] Failed to create license directory:', error);
        return res.status(500).json({
          error: 'Failed to create license directory',
          message: error.message
        });
      }
    }
    
    // Write license file
    try {
      fs.writeFileSync(licensePath, JSON.stringify(signedLicense, null, 2), { mode: 0o644 });
      console.log('[Setup] License saved to:', licensePath);
    } catch (error) {
      console.error('[Setup] Failed to write license file:', error);
      return res.status(500).json({
        error: 'Failed to write license file',
        message: error.message
      });
    }
    
    // Mark activation code as used
    activation.used = true;
    activation.usedAt = new Date().toISOString();
    activation.deviceFingerprint = fingerprint;
    
    // Save network config if provided
    if (networkConfig) {
      const configPath = '/opt/lightengine/config/network.json';
      try {
        fs.writeFileSync(configPath, JSON.stringify(networkConfig, null, 2));
      } catch (error) {
        console.warn('[Setup] Failed to save network config:', error);
      }
    }
    
    console.log(`[Setup] Device activated successfully`);
    console.log(`  License ID: ${licenseId}`);
    console.log(`  Farm: ${licenseData.farmName} (${licenseData.farmId})`);
    console.log(`  Tier: ${licenseData.tier}`);
    console.log(`  Fingerprint: ${fingerprint.substring(0, 16)}...`);
    
    res.json({
      ok: true,
      message: 'Device activated successfully',
      license: {
        licenseId,
        farmId: licenseData.farmId,
        farmName: licenseData.farmName,
        tier: licenseData.tier,
        features: licenseData.features,
        expiresAt: licenseData.expiresAt
      },
      accessUrl: `http://${getDeviceIP()}:8091`,
      qrCode: generateQRCodeUrl(licenseData.farmId)
    });
    
  } catch (error) {
    console.error('[Setup] Activation error:', error);
    res.status(500).json({
      error: 'Activation failed',
      message: error.message
    });
  }
});

/**
 * GET /api/setup/hardware
 * Get hardware information for display
 */
router.get('/hardware', async (req, res) => {
  try {
    const fingerprint = await generateFingerprint();
    const networkInterfaces = os.networkInterfaces();
    
    // Get primary interface info
    let primaryInterface = null;
    let ipAddress = null;
    
    for (const [name, interfaces] of Object.entries(networkInterfaces)) {
      for (const iface of interfaces) {
        if (!iface.internal && iface.family === 'IPv4') {
          primaryInterface = name;
          ipAddress = iface.address;
          break;
        }
      }
      if (primaryInterface) break;
    }
    
    res.json({
      ok: true,
      hardware: {
        fingerprint: fingerprint.substring(0, 16) + '...',
        fullFingerprint: fingerprint,
        hostname: os.hostname(),
        platform: os.platform(),
        arch: os.arch(),
        cpus: os.cpus().length,
        memory: (os.totalmem() / 1024 / 1024 / 1024).toFixed(2) + ' GB',
        primaryInterface,
        ipAddress
      }
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get hardware info',
      message: error.message
    });
  }
});

/**
 * POST /api/setup/generate-code
 * Generate activation code (admin only - for testing)
 */
router.post('/generate-code', (req, res) => {
  const { farmId, farmName, tier, expiresInDays } = req.body;
  
  if (!farmId || !tier) {
    return res.status(400).json({ error: 'farmId and tier required' });
  }
  
  // Generate unique code
  const code = `GR-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const expiresAt = new Date(Date.now() + (expiresInDays || 30) * 24 * 60 * 60 * 1000);
  
  activationCodes.set(code, {
    farmId,
    farmName: farmName || farmId,
    tier,
    expiresAt: expiresAt.toISOString(),
    used: false,
    createdAt: new Date().toISOString()
  });
  
  res.json({
    ok: true,
    activationCode: code,
    farmId,
    tier,
    expiresAt: expiresAt.toISOString()
  });
});

/**
 * GET /api/setup/status
 * Check if device is already activated
 */
router.get('/status', (req, res) => {
  const licensePath = path.join(LICENSE_DIR, 'license.json');
  const isActivated = fs.existsSync(licensePath);
  
  if (isActivated) {
    try {
      const license = JSON.parse(fs.readFileSync(licensePath, 'utf-8'));
      res.json({
        ok: true,
        activated: true,
        license: {
          farmId: license.farmId,
          farmName: license.farmName,
          tier: license.tier,
          expiresAt: license.expiresAt
        }
      });
    } catch (error) {
      res.json({
        ok: true,
        activated: true,
        error: 'Cannot read license file'
      });
    }
  } else {
    res.json({
      ok: true,
      activated: false
    });
  }
});

// Helper functions
function getFeaturesByTier(tier) {
  const features = {
    'inventory-only': ['inventory', 'scheduling', 'wholesale', 'reporting'],
    'full': ['inventory', 'scheduling', 'wholesale', 'reporting', 'automation', 'climate_control', 'sensors'],
    'enterprise': ['*'] // All features
  };
  return features[tier] || [];
}

function getDeviceIP() {
  const networkInterfaces = os.networkInterfaces();
  for (const interfaces of Object.values(networkInterfaces)) {
    for (const iface of interfaces) {
      if (!iface.internal && iface.family === 'IPv4') {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

function generateQRCodeUrl(farmId) {
  const deviceIP = getDeviceIP();
  const url = `http://${deviceIP}:8091`;
  return `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(url)}`;
}

/**
 * POST /api/setup/complete
 * Completes edge device setup by saving credentials to /config/farm-credentials.json
 * Called by setup wizard after successful registration with GreenReach Central
 */
router.post('/complete', async (req, res) => {
    try {
        const { saveCredentials, isRegistered, getFarmId } = await import('../lib/farm-credentials.js');
        
        const { 
            farmId, 
            farmName, 
            credentials, 
            endpoints, 
            certifications,
            registrationCode,
            save_credentials 
        } = req.body;
        
        // Validate required fields
        if (!farmId || !credentials) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: farmId, credentials'
            });
        }
        
        // Validate credential structure
        const requiredKeys = ['wholesale_api_key', 'pos_api_key', 'device_api_key', 'jwt_secret'];
        const missingKeys = requiredKeys.filter(key => !credentials[key]);
        
        if (missingKeys.length > 0) {
            return res.status(400).json({
                success: false,
                message: `Missing required credentials: ${missingKeys.join(', ')}`
            });
        }
        
        // Check if already registered
        if (isRegistered()) {
            const existingFarmId = getFarmId();
            return res.status(409).json({
                success: false,
                message: 'Edge device already registered',
                farm_id: existingFarmId
            });
        }
        
        // Save credentials to /config/farm-credentials.json
        await saveCredentials({
            farm_id: farmId,
            farm_name: farmName || 'Light Engine Farm',
            credentials: {
                wholesale_api_key: credentials.wholesale_api_key,
                pos_api_key: credentials.pos_api_key,
                device_api_key: credentials.device_api_key,
                jwt_secret: credentials.jwt_secret
            },
            endpoints: endpoints || {
                wholesale_api: 'https://wholesale.greenreach.io',
                monitoring_api: 'https://monitor.greenreach.io',
                update_api: 'https://updates.greenreach.io',
                cloud_api: 'https://api.greenreach.io'
            },
            registered_at: new Date().toISOString(),
            registration_code: registrationCode,
            certifications: certifications || {},
            status: 'active'
        });
        
        console.log(`✅ Setup complete - Farm registered: ${farmId}`);
        
        res.json({
            success: true,
            message: 'Setup complete - credentials saved',
            farm_id: farmId,
            farm_name: farmName,
            next_url: '/LE-farm-admin.html'
        });
        
    } catch (error) {
        console.error('Setup completion error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to save credentials',
            error: error.message
        });
    }
});

/**
 * GET /api/setup/status
 * Check if edge device has been registered with GreenReach Central
 */
router.get('/status', async (req, res) => {
    try {
        const { isRegistered, getFarmId, getFarmName } = await import('../lib/farm-credentials.js');
        
        if (isRegistered()) {
            const farmId = getFarmId();
            const farmName = getFarmName();
            res.json({
                registered: true,
                farm_id: farmId,
                farm_name: farmName,
                message: 'Edge device registered'
            });
        } else {
            res.json({
                registered: false,
                message: 'Edge device not registered - run setup wizard',
                setup_url: '/LE-farm-admin.html#settings'
            });
        }
        
    } catch (error) {
        console.error('Setup status check error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to check registration status',
            error: error.message
        });
    }
});

export default router;
