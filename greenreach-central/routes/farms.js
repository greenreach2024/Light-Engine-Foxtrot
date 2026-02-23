/**
 * Farm Management Routes
 * Handles farm registration, heartbeats, and status tracking.
 * All farm data flows to GreenReach Central.
 */

import express from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';
import { query, isDatabaseAvailable } from '../config/database.js';
import { getInMemoryGroups } from './sync.js';
import { upsertNetworkFarm } from '../services/networkFarmsStore.js';

const JWT_SECRET = process.env.JWT_SECRET || 'greenreach-jwt-secret-2025';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const MAX_IN_MEMORY_FARMS = 500;

const router = express.Router();

// In-memory storage (no database required)
const inMemoryFarms = new Map();

// Demo/test farm definitions (disabled in production)
// Live farms (FARM-TEST-WIZARD-001) authenticate via database — see scripts/seed-live-farm.js
const DEMO_FARMS = IS_PRODUCTION ? {} : {
  'FARM-MKLOMAT3-A9D8': {
    password: 'ReTerminal2026!',
    farmName: 'GreenReach Demo Farm',
    role: 'admin',
    subscription: 'light-engine',
    controllerAccess: false
  }
};

/** Generate crypto secrets for a new farm registration */
function generateFarmSecrets() {
  return {
    jwtSecret: crypto.randomBytes(32).toString('hex'),
    apiKey: crypto.randomBytes(32).toString('hex'),
    apiSecret: crypto.randomBytes(32).toString('hex')
  };
}

/** Escape SQL LIKE pattern special characters */
function escapeLikePattern(str) {
  return str.replace(/[%_\\]/g, '\\$&');
}

/**
 * GET /api/farms
 * List all farms
 */
router.get('/', async (req, res, next) => {
  try {
    // Query database for all farms
    const result = await query(
      `SELECT farm_id, name, status, last_heartbeat, metadata 
       FROM farms 
       ORDER BY created_at DESC`
    );
    
    const farms = result.rows.map(farm => {
      let parsedMeta = farm.metadata || {};
      if (typeof parsedMeta === 'string') {
        try { parsedMeta = JSON.parse(parsedMeta); } catch (e) { parsedMeta = {}; }
      }
      return {
        farmId: farm.farm_id,
        name: farm.name,
        status: farm.status,
        lastHeartbeat: farm.last_heartbeat,
        email: farm.email || parsedMeta.contact?.email || null,
        contactName: farm.contact_name || parsedMeta.contactName || parsedMeta.contact?.name || null,
        metadata: parsedMeta
      };
    });
    
    res.json({ success: true, farms });
  } catch (error) {
    logger.error('Error listing farms:', error);
    res.status(500).json({ success: false, error: 'Failed to list farms', message: error.message });
  }
});

/**
 * POST /api/farms/:farmId/heartbeat
 * Receive heartbeat from farm server
 */
router.post('/:farmId/heartbeat', async (req, res, next) => {
  try {
    const { farmId } = req.params;
    const { cpu_usage, memory_usage, disk_usage, metadata } = req.body;

    // Basic input validation
    if (typeof cpu_usage !== 'undefined' && (typeof cpu_usage !== 'number' || cpu_usage < 0 || cpu_usage > 100)) {
      return res.status(400).json({ success: false, error: 'cpu_usage must be a number 0-100' });
    }
    if (typeof memory_usage !== 'undefined' && (typeof memory_usage !== 'number' || memory_usage < 0 || memory_usage > 100)) {
      return res.status(400).json({ success: false, error: 'memory_usage must be a number 0-100' });
    }
    if (metadata && typeof metadata !== 'object') {
      return res.status(400).json({ success: false, error: 'metadata must be an object' });
    }
    // Reject oversized metadata payloads (>50KB serialized)
    if (metadata && JSON.stringify(metadata).length > 50000) {
      return res.status(400).json({ success: false, error: 'metadata payload too large (max 50KB)' });
    }

    const now = new Date().toISOString();
    const contactName = metadata?.contact?.name
      || metadata?.contactName
      || metadata?.contact_name
      || metadata?.name
      || metadata?.farm_name
      || farmId;
    
    const planType = metadata?.plan_type || metadata?.planType || 'light-engine';
    
    // Extract api_url if present in metadata
    const heartbeatApiUrl = metadata?.api_url || metadata?.url || metadata?.edge_url || null;
    
    // Check database availability
    const dbAvailable = await isDatabaseAvailable();
    logger.debug(`[Heartbeat] farmId=${farmId}, dbAvailable=${dbAvailable}`);
    
    if (dbAvailable) {
      // Generate secrets only for DB upsert (COALESCE keeps existing values)
      const { jwtSecret, apiKey, apiSecret } = generateFarmSecrets();

      // Persist to database (required for farm_data FK)
      // Upsert farm (include api_url if provided)
      await query(
        `INSERT INTO farms (farm_id, name, contact_name, status, last_heartbeat, jwt_secret, api_key, api_secret, plan_type, api_url, metadata, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
         ON CONFLICT (farm_id) 
         DO UPDATE SET 
           status = $4,
           last_heartbeat = $5,
           jwt_secret = COALESCE(farms.jwt_secret, EXCLUDED.jwt_secret),
           api_key = COALESCE(farms.api_key, EXCLUDED.api_key),
           api_secret = COALESCE(farms.api_secret, EXCLUDED.api_secret),
           plan_type = COALESCE(EXCLUDED.plan_type, farms.plan_type, 'light-engine'),
           api_url = COALESCE(EXCLUDED.api_url, farms.api_url),
           metadata = EXCLUDED.metadata,
           name = COALESCE(EXCLUDED.name, farms.name),
           contact_name = COALESCE(EXCLUDED.contact_name, farms.contact_name),
           updated_at = NOW()`,
        [farmId, metadata?.name || farmId, contactName, 'active', now, jwtSecret, apiKey, apiSecret, planType, heartbeatApiUrl, JSON.stringify(metadata || {})]
      );
      
      // Store heartbeat
      await query(
        `INSERT INTO farm_heartbeats (farm_id, cpu_usage, memory_usage, disk_usage, metadata, timestamp)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [farmId, cpu_usage, memory_usage, disk_usage, JSON.stringify(metadata || {}), now]
      );
    } else {
      logger.warn(`[Heartbeat] Database unavailable, storing in-memory only for farm ${farmId}`);
    }
    
    // Always keep in-memory for fast access (even when DB unavailable)
    // Evict oldest entry if at capacity
    if (inMemoryFarms.size >= MAX_IN_MEMORY_FARMS && !inMemoryFarms.has(farmId)) {
      const oldest = inMemoryFarms.keys().next().value;
      inMemoryFarms.delete(oldest);
    }
    inMemoryFarms.set(farmId, {
      farm_id: farmId,
      name: metadata?.name || farmId,
      status: 'online',
      last_heartbeat: now,
      metadata: metadata || {},
      updated_at: now
    });
    
    // Auto-register this farm in the wholesale network store
    // so the aggregator can fetch its inventory
    try {
      // Try to get api_url from: metadata (explicitly sent), or DB column
      let apiUrl = metadata?.api_url || metadata?.url || metadata?.edge_url || null;
      if (!apiUrl && await isDatabaseAvailable()) {
        // Check DB for stored api_url (set during farm-registration or FARM_EDGE_URL sync)
        const farmRow = await query('SELECT api_url FROM farms WHERE farm_id = $1', [farmId]);
        if (farmRow.rows[0]?.api_url) {
          apiUrl = farmRow.rows[0].api_url;
        }
      }
      // NOTE: Do NOT fall back to req.ip — behind NAT/load balancers it gives
      // unreachable IPs. Only use explicitly-provided or DB-stored URLs.
      
      if (apiUrl) {
        await upsertNetworkFarm(farmId, {
          name: metadata?.name || farmId,
          api_url: apiUrl,
          url: apiUrl,
          status: 'active',
          contact: metadata?.contact || {},
          location: metadata?.location || {}
        });
        logger.info(`[Heartbeat] Farm ${farmId} registered in wholesale network (${apiUrl})`);
      }
    } catch (networkErr) {
      // Non-fatal — don't break heartbeat flow
      logger.warn(`[Heartbeat] Failed to register farm ${farmId} in network store:`, networkErr.message);
    }
    
    logger.info(`Heartbeat received from ${farmId}: CPU=${cpu_usage}%, MEM=${memory_usage}%, DISK=${disk_usage}%`);
    
    res.json({
      success: true,
      farm: inMemoryFarms.get(farmId)
    });
  } catch (error) {
    logger.error('Error processing heartbeat:', error);
    res.status(500).json({ success: false, error: 'Failed to process heartbeat', message: error.message });
  }
});

/**
 * POST /api/farms/register
 * Register a new farm
 */
router.post('/register', async (req, res, next) => {
  try {
    const {
      farmId,
      name,
      location,
      contact,
      registration_code,
      farm_name,
      contact_email,
      api_url
    } = req.body;

    const now = new Date().toISOString();

    const resolvedFarmId = farmId || registration_code;
    if (!resolvedFarmId) {
      return res.status(400).json({
        success: false,
        error: 'Missing farmId or registration_code'
      });
    }

    const resolvedName = name || farm_name || resolvedFarmId;

    const metadata = {
      location: location || {},
      contact: {
        ...(typeof contact === 'object' && contact ? contact : {}),
        ...(contact_email ? { email: contact_email } : {}),
        ...(farm_name ? { name: farm_name } : {})
      }
    };

    // Generate required security fields for new farms
    const { jwtSecret, apiKey, apiSecret } = generateFarmSecrets();

    // Persist to database
    await query(
      `INSERT INTO farms (farm_id, name, status, last_heartbeat, jwt_secret, api_key, api_secret, plan_type, metadata, api_url, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
       ON CONFLICT (farm_id) DO UPDATE SET
         name = EXCLUDED.name,
         metadata = EXCLUDED.metadata,
         jwt_secret = COALESCE(farms.jwt_secret, EXCLUDED.jwt_secret),
         api_key = COALESCE(farms.api_key, EXCLUDED.api_key),
         api_secret = COALESCE(farms.api_secret, EXCLUDED.api_secret),
         api_url = COALESCE(EXCLUDED.api_url, farms.api_url),
         updated_at = NOW()`,
      [resolvedFarmId, resolvedName, 'active', now, jwtSecret, apiKey, apiSecret, 'light-engine', JSON.stringify(metadata), api_url || null]
    );

    // Also keep in-memory
    inMemoryFarms.set(resolvedFarmId, {
      farm_id: resolvedFarmId,
      name: resolvedName,
      status: 'online',
      last_heartbeat: now,
      metadata,
      created_at: now,
      updated_at: now
    });

    logger.info(`Farm registered: ${resolvedFarmId}`);

    // Phase 2 Task 2.9: Push network benchmarks to new farms on registration
    let networkBenchmarks = null;
    try {
      const { getCropBenchmarksForPush } = await import('../routes/experiment-records.js');
      const benchmarks = await getCropBenchmarksForPush();
      if (Object.keys(benchmarks).length > 0) {
        networkBenchmarks = {
          crop_benchmarks: benchmarks,
          benchmark_count: Object.keys(benchmarks).length,
          generated_at: now,
          message: 'Network-wide crop benchmarks from all participating farms'
        };
        logger.info(`Included ${Object.keys(benchmarks).length} crop benchmarks for new farm ${resolvedFarmId}`);
      }
    } catch (benchErr) {
      logger.warn(`Could not load benchmarks for new farm ${resolvedFarmId}: ${benchErr.message}`);
    }

    res.status(201).json({
      success: true,
      farmId: resolvedFarmId,
      message: 'Farm registered successfully',
      network_benchmarks: networkBenchmarks
    });

    // Phase 2 Task 2.9: Immediate push of benchmarks + demand signals to new farm
    // Fire-and-forget — don't block the registration response
    const farmApiUrl = api_url || metadata?.api_url || metadata?.url || null;
    if (farmApiUrl && networkBenchmarks) {
      setImmediate(async () => {
        try {
          let demandSignals = {};
          try {
            const { analyzeDemandPatterns } = await import('../services/wholesaleMemoryStore.js');
            demandSignals = await analyzeDemandPatterns();
          } catch (_) {}

          const payload = {
            farm_id: resolvedFarmId,
            generated_at: now,
            recommendations: [],
            network_intelligence: {
              crop_benchmarks: networkBenchmarks.crop_benchmarks,
              demand_signals: demandSignals,
              risk_alerts: [],
              recipe_modifiers: await (async () => {
                try {
                  const { getNetworkModifiers } = await import('../jobs/yield-regression.js');
                  return await getNetworkModifiers();
                } catch { return null; }
              })(),
              generated_at: now,
              source: 'onboarding_push'
            }
          };

          const pushRes = await fetch(`${farmApiUrl}/api/health/ai-recommendations`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(10000)
          });
          logger.info(`[Onboarding] Benchmark push to ${resolvedFarmId}: ${pushRes.status}`);
        } catch (pushErr) {
          logger.warn(`[Onboarding] Benchmark push to ${resolvedFarmId} failed (non-fatal): ${pushErr.message}`);
        }
      });
    }
  } catch (error) {
    logger.error('Error registering farm:', error);
    res.status(500).json({ success: false, error: 'Failed to register farm', message: error.message });
  }
});

/**
 * GET /api/farm/profile
 * Get authenticated user's farm profile
 * Requires JWT token with farm_id
 */
router.get('/profile', async (req, res, next) => {
  // Helper: return profile from local farm.json
  async function fallbackProfile(farmIdHint) {
    const farmPath = path.join(__dirname, '..', 'public', 'data', 'farm.json');
    const raw = await fs.readFile(farmPath, 'utf8');
    const farm = JSON.parse(raw);
    const fid = farmIdHint || farm.farmId || farm.farm_id || 'UNKNOWN';
    return {
      status: 'success',
      farm: {
        farmId: fid,
        name: farm.name || farm.farmName || 'This is Your Farm',
        status: farm.status || 'active',
        metadata: farm,
        rooms: [],
        groups: [],
        createdAt: farm.createdAt || new Date().toISOString()
      }
    };
  }

  try {
    // Extract farm_id from JWT token
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      try {
        return res.json(await fallbackProfile());
      } catch {
        return res.status(401).json({ error: 'No authorization token provided' });
      }
    }

    const token = authHeader.substring(7);
    
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (error) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const farmId = decoded.farm_id;
    if (!farmId) {
      return res.status(400).json({ error: 'No farm_id in token' });
    }

    // Check if DB is available before querying
    if (!isDatabaseAvailable()) {
      logger.info('[Profile] Database unavailable, using local farm.json fallback');
      return res.json(await fallbackProfile(farmId));
    }

    // Query database for farm data
    const result = await query(
      `SELECT farm_id, name, status, metadata, created_at
       FROM farms 
       WHERE farm_id = $1`,
      [farmId]
    );

    if (result.rows.length === 0) {
      // Farm not in DB yet — fallback to local data
      return res.json(await fallbackProfile(farmId));
    }

    const farm = result.rows[0];

    // Use DB name as authoritative; fall back to farmId
    const displayName = farm.name || farmId;

    // Return farm profile in format expected by frontend
    res.json({
      status: 'success',
      farm: {
        farmId: farm.farm_id,
        name: displayName,
        status: farm.status,
        metadata: farm.metadata || {},
        rooms: farm.metadata?.rooms || [],
        groups: farm.metadata?.groups || [],
        createdAt: farm.created_at
      }
    });
  } catch (error) {
    logger.error('Error fetching farm profile:', error.message);
    // Last resort fallback
    try {
      return res.json(await fallbackProfile());
    } catch (fallbackErr) {
      logger.error('[Profile] Fallback also failed:', fallbackErr.message);
      next(error);
    }
  }
});

/**
 * GET /api/farm/activity/:farmId
 * Return recent activity for a farm (cloud)
 */
router.get('/activity/:farmId', async (req, res) => {
  try {
    const { farmId } = req.params;

    if (!farmId) {
      return res.status(400).json({
        success: false,
        error: 'Farm ID required'
      });
    }

    let activity = [];
    let dataAvailable = false;

    if (await isDatabaseAvailable()) {
      try {
        const result = await query(
          `SELECT action, resource_type, metadata, created_at
           FROM admin_audit_log
           WHERE resource_id = $1 OR metadata::text LIKE $2
           ORDER BY created_at DESC
           LIMIT 20`,
          [farmId, `%${escapeLikePattern(farmId)}%`]
        );

        activity = result.rows.map(row => ({
          timestamp: row.created_at,
          description: row.action || 'Activity event',
          user: row.metadata?.user || row.metadata?.email || 'System',
          status: 'active'
        }));

        dataAvailable = activity.length > 0;
      } catch (error) {
        logger.warn(`[Farm Activity] admin_audit_log unavailable: ${error.message}`);
      }
    }

    res.json({
      success: true,
      dataAvailable,
      activity
    });
  } catch (error) {
    logger.error('Error fetching farm activity:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch activity',
      message: error.message
    });
  }
});

/**
 * GET /api/farms/:farmId/groups
 * Compatibility route (public read access)
 */
router.get('/:farmId/groups', async (req, res) => {
  try {
    const { farmId } = req.params;

    logger.info(`[Farms] Restoring groups for farm ${farmId}`);

    let groups = [];

    if (await isDatabaseAvailable()) {
      const result = await query(
        `SELECT data FROM farm_data 
         WHERE farm_id = $1 AND data_type = $2`,
        [farmId, 'groups']
      );

      if (result.rows.length > 0) {
        const raw = result.rows[0].data;
        // Handle both flat array and {groups:[...]} wrapper formats
        groups = Array.isArray(raw) ? raw : (raw?.groups || []);
      }

      logger.info(`[Farms] Retrieved ${groups.length} groups from database for farm ${farmId}`);
    } else {
      const inMemoryGroups = getInMemoryGroups();
      groups = inMemoryGroups.get(farmId) || [];
      logger.info(`[Farms] Retrieved ${groups.length} groups from memory for farm ${farmId}`);
    }

    res.json({
      success: true,
      groups,
      count: groups.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('[Farms] Error restoring groups:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to restore groups',
      message: error.message
    });
  }
});

/**
 * GET /api/farms/:farmId
 * Get farm details
 */
router.get('/:farmId', async (req, res, next) => {
  try {
    const { farmId } = req.params;

    // Query database for farm
    const result = await query(
      `SELECT farm_id, name, status, last_heartbeat, metadata 
       FROM farms 
       WHERE farm_id = $1`,
      [farmId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Farm not found' });
    }

    const farm = result.rows[0];
    
    // Parse metadata safely
    let parsedMeta = farm.metadata || {};
    if (typeof parsedMeta === 'string') {
      try { parsedMeta = JSON.parse(parsedMeta); } catch (e) { parsedMeta = {}; }
    }
    
    res.json({
      farmId: farm.farm_id,
      name: farm.name,
      status: farm.status,
      lastHeartbeat: farm.last_heartbeat,
      email: farm.email || parsedMeta.contact?.email || null,
      contactName: farm.contact_name || parsedMeta.contactName || parsedMeta.contact?.name || null,
      phone: parsedMeta.phone || parsedMeta.contact?.phone || null,
      website: parsedMeta.website || parsedMeta.contact?.website || null,
      apiUrl: farm.api_url || null,
      metadata: parsedMeta
    });
  } catch (error) {
    logger.error('Error fetching farm:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch farm', message: error.message });
  }
});

/**
 * POST /api/farm/auth/login
 * Farm login with Farm ID + Password (no email required)
 * Used by farm-admin.js login flow
 */
router.post('/auth/login', async (req, res) => {
  try {
    const { farmId, password } = req.body;

    if (!farmId || !password) {
      return res.status(400).json({
        success: false,
        error: 'Farm ID and password are required'
      });
    }

    let user = null;

    // Try database first
    if (req.db) {
      try {
        const { rows } = await req.db.query(
            `SELECT fu.id, fu.farm_id, fu.email, fu.password_hash, fu.name, fu.role,
              f.name as farm_name, f.plan_type, f.metadata as farm_metadata, f.api_url
           FROM farm_users fu
           JOIN farms f ON fu.farm_id = f.farm_id
           WHERE fu.farm_id = $1 AND fu.active = true
           LIMIT 1`,
          [farmId]
        );

        if (rows.length > 0) {
          const dbUser = rows[0];
          const passwordMatch = await bcrypt.compare(password, dbUser.password_hash);
          if (passwordMatch) {
            user = {
              id: dbUser.id,
              farmId: dbUser.farm_id,
              farmName: dbUser.farm_name,
              email: dbUser.email,
              name: dbUser.name,
              role: dbUser.role,
              subscription: 'light-engine',
              planType: dbUser.plan_type || 'light-engine',
              controllerAccess: Boolean(dbUser.api_url || dbUser.farm_metadata?.controller_access)
            };
          }
        }
      } catch (dbErr) {
        logger.warn('[Farm Auth] DB lookup failed, trying fallback:', dbErr.message);
      }
    }

    // Fallback to demo farms
    if (!user && DEMO_FARMS[farmId]) {
      const demo = DEMO_FARMS[farmId];
      if (password === demo.password) {
        user = {
          id: 'demo-user',
          farmId: farmId,
          farmName: demo.farmName,
          email: '',
          name: demo.farmName,
          role: demo.role,
          subscription: demo.subscription,
          planType: 'light-engine',
          controllerAccess: demo.controllerAccess
        };
      }
    }

    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Invalid Farm ID or password'
      });
    }

    // Generate JWT
    const token = jwt.sign(
      {
        farm_id: user.farmId,
        user_id: user.id,
        role: user.role,
        name: user.name
      },
      JWT_SECRET,
      { expiresIn: '24h', issuer: 'greenreach-central', audience: 'greenreach-farms' }
    );

    logger.info(`[Farm Auth] Login success: ${user.farmId}`);

    res.json({
      status: 'success',
      success: true,
      token,
      farmId: user.farmId,
      farmName: user.farmName,
      email: user.email || '',
      role: user.role,
      subscription: user.subscription || 'light-engine',
      planType: user.planType || 'light-engine',
      controllerAccess: Boolean(user.controllerAccess)
    });

  } catch (error) {
    logger.error('[Farm Auth] Login error:', error);
    res.status(500).json({
      success: false,
      error: 'Authentication service error',
      message: error.message
    });
  }
});

export default router;