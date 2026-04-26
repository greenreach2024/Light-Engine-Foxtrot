/**
 * Setup Activation API Routes
 * Handles farm server activation, license provisioning, and initial configuration
 */

import express from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';
import jwt from 'jsonwebtoken';
import { fileURLToPath } from 'url';
import { promisify } from 'util';
import { exec } from 'child_process';
import { validateRooms, validateWithErrors } from '../lib/schema-validator.js';

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = express.Router();

// Use local config directory for AWS compatibility
const CONFIG_DIR = path.join(__dirname, '..', 'config');
const LICENSE_DIR = path.join(CONFIG_DIR, 'licenses');
const ROOMS_PATH = path.join(__dirname, '..', 'public', 'data', 'rooms.json');

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

function getAuthContext(req) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return null;

  if (global.farmAdminSessions && global.farmAdminSessions.has(token)) {
    const session = global.farmAdminSessions.get(token);
    return {
      farmId: session.farmId,
      userId: session.userId || 'edge-admin',
      userEmail: session.email,
      userRole: session.role || 'admin',
      edgeMode: true
    };
  }

  if (token === 'local-access') {
    return {
      farmId: 'LOCAL-FARM',
      userId: 'local-user',
      userEmail: 'admin@local-farm.com',
      userRole: 'admin'
    };
  }

  try {
    const jwtSecret = process.env.JWT_SECRET || 'fallback-secret-change-in-production';
    const decoded = jwt.verify(token, jwtSecret);
    return {
      farmId: decoded.farmId,
      userId: decoded.userId,
      userEmail: decoded.email,
      userRole: decoded.role || 'admin'
    };
  } catch (error) {
    return { error: 'Invalid or expired token' };
  }
}

function buildRoomsPayload(rooms, schemaVersion) {
  const payload = { rooms };
  if (schemaVersion) payload.schemaVersion = schemaVersion;
  return payload;
}

function isMissingRelation(error, tableName) {
  if (!error) return false;
  if (error.code === '42P01') return true;
  return typeof error.message === 'string' && error.message.includes(`relation "${tableName}" does not exist`);
}

function buildRoomDefaults(config = {}) {
  return {
    layout: config.layout || { type: '', rows: 0, racks: 0, levels: 0 },
    zones: Array.isArray(config.zones) ? config.zones : [],
    fixtures: Array.isArray(config.fixtures) ? config.fixtures : [],
    controlMethod: config.controlMethod ?? null,
    devices: Array.isArray(config.devices) ? config.devices : [],
    sensors: config.sensors || { categories: [], placements: {} },
    energy: config.energy || '',
    energyHours: Number.isFinite(config.energyHours) ? config.energyHours : 0,
    targetPpfd: Number.isFinite(config.targetPpfd) ? config.targetPpfd : 0,
    photoperiod: Number.isFinite(config.photoperiod) ? config.photoperiod : 0,
    connectivity: config.connectivity || { hasHub: null, hubType: '', hubIp: '', cloudTenant: 'Azure' },
    roles: config.roles || { admin: [], operator: [], viewer: [] },
    grouping: config.grouping || { groups: [], planId: '', scheduleId: '' },
    category: config.category || {}
  };
}

async function loadZonesByRoomId(pool, farmId) {
  try {
    const result = await pool.query(
      'SELECT room_id, name FROM zones WHERE farm_id = $1 ORDER BY created_at ASC',
      [farmId]
    );
    return result.rows.reduce((acc, row) => {
      const key = String(row.room_id);
      if (!acc[key]) acc[key] = [];
      acc[key].push(row.name);
      return acc;
    }, {});
  } catch (error) {
    if (isMissingRelation(error, 'zones')) {
      return {};
    }
    throw error;
  }
}

async function loadRoomsFromRoomsTable(pool, farmId) {
  let roomRows;
  try {
    const result = await pool.query(
      `SELECT room_id, name, type, capacity, description, configuration
       FROM rooms
       WHERE farm_id = $1
       ORDER BY created_at ASC`,
      [farmId]
    );
    roomRows = result.rows;
  } catch (error) {
    if (isMissingRelation(error, 'rooms')) {
      return { rooms: [], missingRoomsTable: true };
    }
    throw error;
  }

  if (!roomRows.length) {
    return { rooms: [], missingRoomsTable: false };
  }

  const zonesByRoomId = await loadZonesByRoomId(pool, farmId);
  const rooms = roomRows.map((row) => {
    const config = row.configuration && typeof row.configuration === 'object' ? row.configuration : {};
    const zoneList = Array.isArray(config.zones)
      ? config.zones
      : (zonesByRoomId[String(row.room_id)] || []);
    const defaults = buildRoomDefaults({ ...config, zones: zoneList });
    return {
      id: String(row.room_id),
      name: row.name || '',
      type: row.type || '',
      capacity: row.capacity ?? null,
      description: row.description || '',
      ...defaults
    };
  });

  return { rooms, missingRoomsTable: false };
}

async function loadRoomsPayloadFromDb(pool, farmId) {
  let farmRoomsMissing = false;
  try {
    const result = await pool.query(
      `SELECT rooms_json
       FROM farm_room_configs
       WHERE farm_id = $1
       ORDER BY updated_at DESC
       LIMIT 1`,
      [farmId]
    );

    if (result.rows.length) {
      const roomsPayload = result.rows[0].rooms_json || { rooms: [] };
      return {
        rooms: roomsPayload.rooms || [],
        schemaVersion: roomsPayload.schemaVersion || null,
        source: 'db'
      };
    }
  } catch (error) {
    if (isMissingRelation(error, 'farm_room_configs')) {
      farmRoomsMissing = true;
    } else {
      throw error;
    }
  }

  const roomsFallback = await loadRoomsFromRoomsTable(pool, farmId);
  if (roomsFallback.missingRoomsTable && farmRoomsMissing) {
    return { rooms: [], schemaVersion: null, source: 'missing_tables', missingTables: true };
  }

  return {
    rooms: roomsFallback.rooms,
    schemaVersion: null,
    source: 'rooms_table'
  };
}

function writeRoomsFile(payload) {
  const dir = path.dirname(ROOMS_PATH);
  fs.mkdirSync(dir, { recursive: true });

  const backupPath = `${ROOMS_PATH}.bak`;
  if (fs.existsSync(ROOMS_PATH)) {
    fs.copyFileSync(ROOMS_PATH, backupPath);
  }

  const tempPath = `${ROOMS_PATH}.tmp-${Date.now()}`;
  try {
    fs.writeFileSync(tempPath, JSON.stringify(payload, null, 2));
    fs.renameSync(tempPath, ROOMS_PATH);
  } catch (error) {
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
    if (fs.existsSync(backupPath)) {
      fs.copyFileSync(backupPath, ROOMS_PATH);
    }
    throw error;
  }
}

function readRoomsFile() {
  if (!fs.existsSync(ROOMS_PATH)) return null;
  const raw = fs.readFileSync(ROOMS_PATH, 'utf8');
  return JSON.parse(raw);
}

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
 * Activate farm server with activation code
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
 * Completes farm server setup by saving credentials to /config/farm-credentials.json
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
                message: 'Farm server already registered',
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
 * Check if farm server has been registered with GreenReach Central
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
                message: 'Farm server registered'
            });
        } else {
            res.json({
                registered: false,
                message: 'Farm server not registered - run setup wizard',
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

/**
 * GET /api/setup/onboarding-status
 * Forward onboarding checklist lookup to Central so LE admin UI can use the
 * hosted setup checklist endpoint consistently.
 */
router.get('/onboarding-status', async (req, res) => {
  try {
    const centralBase = process.env.GREENREACH_CENTRAL_URL || process.env.CENTRAL_URL;
    if (!centralBase) {
      return res.status(503).json({ success: false, error: 'Central URL not configured' });
    }

    const targetUrl = new URL('/api/setup/onboarding-status', centralBase).toString();
    const headers = {
      Accept: 'application/json'
    };

    if (req.headers.authorization) {
      headers.Authorization = req.headers.authorization;
    }
    if (req.headers['x-farm-id']) {
      headers['X-Farm-Id'] = req.headers['x-farm-id'];
    }

    const upstream = await fetch(targetUrl, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(10000)
    });

    const bodyText = await upstream.text();
    res.status(upstream.status);
    const contentType = upstream.headers.get('content-type') || 'application/json';
    res.set('content-type', contentType);
    return res.send(bodyText);
  } catch (error) {
    console.error('[api/setup/onboarding-status] Proxy error:', error?.message || error);
    return res.status(502).json({ success: false, error: 'Failed to reach Central onboarding status endpoint' });
  }
});

/**
 * GET /api/setup/data
 * Get real user setup data (replaces demo data)
 * Returns the user's actual configuration saved during setup wizard
 */
router.get('/data', async (req, res) => {
  try {
    // Check if using NeDB (farm server)
    const pool = req.app.locals?.db;
    
    if (!pool) {
      // Farm server - read from NeDB
      const wizardStatesDB = req.app.locals?.wizardStatesDB;
      
      if (!wizardStatesDB) {
        return res.status(500).json({
          success: false,
          error: 'Wizard database not initialized'
        });
      }
      
      const setupConfig = await wizardStatesDB.findOne({ key: 'setup_config' });
      
      if (!setupConfig) {
        return res.status(404).json({
          success: false,
          error: 'No setup configuration found'
        });
      }
      
      // Return user's actual setup data
      return res.json({
        success: true,
        setupCompleted: setupConfig.completed || false,
        config: {
          farmName: setupConfig.farmName,
          ownerName: setupConfig.ownerName,
          contactEmail: setupConfig.contactEmail,
          contactPhone: setupConfig.contactPhone,
          rooms: setupConfig.rooms || [],
          setupCompletedAt: setupConfig.completedAt
        }
      });
    }
    
    const auth = getAuthContext(req);
    if (auth?.error) {
      return res.status(403).json({ success: false, error: auth.error });
    }

    if (!auth?.farmId) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const farmResult = await pool.query(
      `SELECT farm_id, name, email, contact_name, phone
       FROM farms
       WHERE farm_id = $1
       LIMIT 1`,
      [auth.farmId]
    );

    if (!farmResult.rows.length) {
      return res.status(404).json({ success: false, error: 'Farm not found' });
    }

    const roomsPayload = await loadRoomsPayloadFromDb(pool, auth.farmId);
    if (roomsPayload.missingTables) {
      return res.status(500).json({
        success: false,
        error: 'Rooms tables are missing. Run migrations to create rooms data sources.'
      });
    }

    const farmRow = farmResult.rows[0];
    return res.json({
      success: true,
      setupCompleted: true,
      config: {
        farmName: farmRow.name || '',
        ownerName: farmRow.contact_name || '',
        contactEmail: farmRow.email || '',
        contactPhone: farmRow.phone || '',
        rooms: roomsPayload.rooms || []
      }
    });
    
  } catch (error) {
    console.error('[api/setup/data] Error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to load setup data'
    });
  }
});

/**
 * GET /api/setup/rooms
 * Returns persisted rooms data (DB in hosted mode, rooms.json/NeDB on farm server)
 */
router.get('/rooms', async (req, res) => {
  try {
    const pool = req.app.locals?.db;
    const auth = getAuthContext(req);

    if (auth?.error) {
      return res.status(403).json({ success: false, error: auth.error });
    }

    if (pool) {
      if (!auth?.farmId) {
        return res.status(401).json({ success: false, error: 'Authentication required' });
      }

      const roomsPayload = await loadRoomsPayloadFromDb(pool, auth.farmId);
      if (roomsPayload.missingTables) {
        return res.status(500).json({
          success: false,
          error: 'Rooms tables are missing. Run migrations to create rooms data sources.'
        });
      }

      if (!roomsPayload.rooms.length) {
        return res.status(404).json({ success: false, error: 'No rooms configuration found' });
      }

      return res.json({
        success: true,
        rooms: roomsPayload.rooms,
        schemaVersion: roomsPayload.schemaVersion || null,
        source: roomsPayload.source || 'db'
      });
    }

    const filePayload = readRoomsFile();
    if (filePayload && Array.isArray(filePayload.rooms)) {
      return res.json({
        success: true,
        rooms: filePayload.rooms,
        schemaVersion: filePayload.schemaVersion || null,
        source: 'file'
      });
    }

    const wizardStatesDB = req.app.locals?.wizardStatesDB;
    if (wizardStatesDB) {
      const setupConfig = await wizardStatesDB.findOne({ key: 'setup_config' });
      if (setupConfig?.rooms) {
        return res.json({
          success: true,
          rooms: setupConfig.rooms,
          schemaVersion: setupConfig.schemaVersion || null,
          source: 'nedb'
        });
      }
    }

    return res.status(404).json({ success: false, error: 'No rooms configuration found' });
  } catch (error) {
    console.error('[api/setup/rooms] Error:', error);
    return res.status(500).json({ success: false, error: 'Failed to load rooms' });
  }
});

/**
 * POST /api/setup/save-rooms
 * Save rooms data to farm server setup configuration
 */
router.post('/save-rooms', async (req, res) => {
  try {
    const { rooms, schemaVersion } = req.body;
    
    if (!Array.isArray(rooms)) {
      return res.status(400).json({
        success: false,
        message: 'Rooms must be an array'
      });
    }
    
    const auth = getAuthContext(req);
    if (auth?.error) {
      return res.status(403).json({ success: false, message: auth.error });
    }

    const roomsPayload = buildRoomsPayload(rooms, schemaVersion);
    const validation = validateWithErrors(validateRooms, roomsPayload, 'rooms');
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        message: validation.summary,
        errors: validation.errors
      });
    }

    const pool = req.app.locals?.db;
    const savedTo = [];

    if (pool) {
      if (!auth?.farmId) {
        return res.status(401).json({ success: false, message: 'Authentication required' });
      }
      await pool.query(
        `INSERT INTO farm_room_configs (farm_id, rooms_json, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (farm_id)
         DO UPDATE SET rooms_json = EXCLUDED.rooms_json, updated_at = NOW()`,
        [auth.farmId, roomsPayload]
      );
      savedTo.push('db');
    }

    const wizardStatesDB = req.app.locals?.wizardStatesDB;
    if (wizardStatesDB) {
      const setupConfig = await wizardStatesDB.findOne({ key: 'setup_config' }) || { key: 'setup_config' };
      setupConfig.rooms = rooms;
      if (schemaVersion) setupConfig.schemaVersion = schemaVersion;
      setupConfig.updatedAt = new Date().toISOString();
      await wizardStatesDB.update(
        { key: 'setup_config' },
        setupConfig,
        { upsert: true }
      );
      savedTo.push('nedb');
    } else if (!pool) {
      return res.status(500).json({
        success: false,
        message: 'Wizard database not initialized'
      });
    }

    if (!pool) {
      try {
        writeRoomsFile(roomsPayload);
        savedTo.push('rooms.json');
      } catch (fileError) {
        console.error('[api/setup/save-rooms] File write error:', fileError);
        return res.status(500).json({
          success: false,
          message: 'Failed to save rooms.json',
          error: fileError.message
        });
      }
    }

    return res.json({
      success: true,
      message: `${rooms.length} room(s) saved successfully`,
      savedTo
    });
    
  } catch (error) {
    console.error('[api/setup/save-rooms] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to save rooms',
      error: error.message
    });
  }
});

export default router;
