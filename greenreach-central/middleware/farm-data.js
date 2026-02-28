/**
 * Farm-Scoped Data Middleware
 * 
 * Intercepts /data/*.json requests and serves farm-specific data from the
 * farm_data PostgreSQL table instead of flat files on disk.
 *
 * Resolution order:
 *   1. JWT token → extract farmId → query farm_data table
 *   2. In-memory sync cache (inMemoryStore from sync.js)
 *   3. Fall through to static file serving (legacy single-farm mode)
 *
 * This is the core enabler for multi-tenant SaaS: each farm sees its own
 * groups.json, rooms.json, env.json, etc., all served from the same Central
 * server URL.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { randomBytes } from 'crypto';
import jwt from 'jsonwebtoken';
import logger from '../utils/logger.js';
import { query, isDatabaseAvailable } from '../config/database.js';

// Lazy-loaded farm API key cache for X-Farm-ID validation
let _farmApiKeys = null;
function loadFarmApiKeys() {
  if (_farmApiKeys !== null) return _farmApiKeys;
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const keysPath = resolve(__dirname, '..', 'public', 'data', 'farm-api-keys.json');
    _farmApiKeys = JSON.parse(readFileSync(keysPath, 'utf8'));
  } catch {
    _farmApiKeys = {};
  }
  return _farmApiKeys;
}

function getJwtSecret() {
  if (!process.env.JWT_SECRET && (process.env.NODE_ENV === 'production' || process.env.DEPLOYMENT_MODE === 'cloud')) {
    throw new Error('JWT_SECRET environment variable is required in production');
  }
  return process.env.JWT_SECRET || randomBytes(32).toString('hex');
}
const JWT_SECRET = getJwtSecret();

// Map data file names to farm_data.data_type values
const FILE_TO_DATA_TYPE = {
  'groups.json': 'groups',
  'rooms.json': 'rooms',
  'env.json': 'telemetry',
  'schedules.json': 'schedules',
  'iot-devices.json': 'devices',
  'farm.json': 'farm_profile',
  'plans.json': 'plans',
  'light-setups.json': 'light_setups',
  'room-map.json': 'room_map',
};

// Default empty responses for each data type (prevent frontend errors)
// When a farm is authenticated but has no data yet, return these instead of
// falling through to static files (which contain a different farm's data).
const EMPTY_DEFAULTS = {
  'groups.json': { groups: [] },
  'rooms.json': { rooms: [] },
  'env.json': { zones: [] },
  'schedules.json': { schedules: [] },
  'iot-devices.json': { devices: [] },
  'farm.json': { farmId: 'pending', name: 'New Farm', status: 'setup' },
  'plans.json': { plans: [] },
  'light-setups.json': { lightSetups: [] },
  'room-map.json': { zones: [], devices: [] },
};

/**
 * Extract farmId from JWT token in Authorization header or cookie.
 * Returns null if no valid token found (allows fallback to file serving).
 */
function extractFarmId(req) {
  // 0. req.farmId already resolved by upstream middleware (subdomain, JWT, API key)
  if (req.farmId) {
    return req.farmId;
  }

  // 1. Authorization: Bearer <token>
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const token = authHeader.substring(7);
      const payload = jwt.verify(token, JWT_SECRET, {
        issuer: 'greenreach-central',
        audience: 'greenreach-farms'
      });
      return payload.farm_id || null;
    } catch (_) {
      // Token invalid/expired — fall through
    }
  }

  // 2. X-Farm-ID header — ONLY trust if accompanied by a valid API key
  const headerFarmId = req.headers['x-farm-id'];
  const headerApiKey = req.headers['x-api-key'];
  if (headerFarmId && headerApiKey) {
    // Validate against env-based key first
    const envKey = process.env.WHOLESALE_FARM_API_KEY;
    if (envKey && headerApiKey === envKey) {
      return headerFarmId;
    }
    // Check farm-api-keys.json
    const keys = loadFarmApiKeys();
    const farmEntry = keys[headerFarmId];
    if (farmEntry?.api_key === headerApiKey && farmEntry?.status === 'active') {
      return headerFarmId;
    }
    // Invalid API key — do NOT trust the X-Farm-ID
    logger.warn(`[FarmData] Rejected X-Farm-ID '${headerFarmId}' — invalid API key`);
  }

  // 3. Session/cookie-based farmId (future)
  if (req.session?.farmId) {
    return req.session.farmId;
  }

  return null;
}

/**
 * Try to load farm-scoped data from the farm_data table.
 * Returns the data object, or null if not found.
 */
async function loadFromDatabase(farmId, dataType) {
  if (!isDatabaseAvailable()) return null;

  try {
    const result = await query(
      `SELECT data FROM farm_data
       WHERE farm_id = $1 AND data_type = $2`,
      [farmId, dataType]
    );

    if (result.rows.length > 0 && result.rows[0].data != null) {
      return result.rows[0].data;
    }
  } catch (err) {
    logger.warn(`[FarmData] DB read failed for ${farmId}/${dataType}:`, err.message);
  }

  return null;
}

/**
 * Middleware: intercept GET /data/<file>.json requests.
 *
 * If a farmId can be resolved from the request, serve that farm's data
 * from the database. Otherwise, fall through to static file serving.
 */
export function farmDataMiddleware(inMemoryStore) {
  return async (req, res, next) => {
    // Only intercept GET requests to /data/*.json
    if (req.method !== 'GET') return next();

    const match = req.path.match(/^\/data\/([a-z0-9_-]+\.json)$/i);
    if (!match) return next();

    const fileName = match[1];
    const dataType = FILE_TO_DATA_TYPE[fileName];

    // If we don't map this file, fall through to static serving
    if (!dataType) return next();

    const farmId = extractFarmId(req);

    // No farm context → return empty defaults for mapped data files.
    // NEVER fall through to express.static for data files — those flat files
    // may contain another farm's data, causing cross-farm data leaks.
    if (!farmId) {
      const emptyDefault = EMPTY_DEFAULTS[fileName];
      if (emptyDefault != null) {
        logger.debug(`[FarmData] No farm context for ${fileName}, returning empty default`);
        return res.json(typeof emptyDefault === 'object' && !Array.isArray(emptyDefault)
          ? { ...emptyDefault }
          : emptyDefault);
      }
      return next();
    }

    // 1. Try database
    const dbData = await loadFromDatabase(farmId, dataType);
    if (dbData != null) {
      // Telemetry is stored as { zones, sensors, timestamp } but the
      // frontend /data/env.json expects the raw env shape
      if (fileName === 'env.json' && dbData.zones) {
        return res.json(dbData);
      }

      // groups.json: frontend expects a flat array or { groups: [...] }
      if (fileName === 'groups.json') {
        const arr = Array.isArray(dbData) ? dbData : (dbData.groups || []);
        return res.json({ groups: arr });
      }

      // rooms.json: frontend expects { rooms: [...] } or flat array
      if (fileName === 'rooms.json') {
        const arr = Array.isArray(dbData) ? dbData : (dbData.rooms || []);
        return res.json({ rooms: arr });
      }

      return res.json(dbData);
    }

    // 2. Try in-memory store
    if (inMemoryStore) {
      const storeKey = dataType === 'telemetry' ? 'telemetry' : dataType;
      const memData = inMemoryStore[storeKey]?.get?.(farmId);
      if (memData) {
        if (fileName === 'groups.json') {
          const arr = Array.isArray(memData) ? memData : (memData.groups || []);
          return res.json({ groups: arr });
        }
        if (fileName === 'rooms.json') {
          const arr = Array.isArray(memData) ? memData : (memData.rooms || []);
          return res.json({ rooms: arr });
        }
        return res.json(memData);
      }
    }

    // 3. Farm context is present but no data found in DB or memory.
    //    Return empty defaults so the authenticated farm gets a clean slate
    //    instead of stale data from the static file (which belongs to a
    //    different farm). This applies in both DB and no-DB modes.
    const emptyDefault = EMPTY_DEFAULTS[fileName];
    if (emptyDefault != null) {
      logger.debug(`[FarmData] No data for ${farmId}/${dataType}, returning empty default`);
      return res.json(typeof emptyDefault === 'object' && !Array.isArray(emptyDefault)
        ? { ...emptyDefault }
        : Array.isArray(emptyDefault) ? { [dataType]: [] } : emptyDefault);
    }

    // Unmapped or null default — fall through to static file
    next();
  };
}

/**
 * Middleware: intercept PUT /data/<file>.json requests.
 *
 * Writes farm-scoped data to the farm_data table instead of (or in addition to)
 * writing a flat file to disk. This enables multi-tenant data persistence.
 */
export function farmDataWriteMiddleware(inMemoryStore) {
  return async (req, res, next) => {
    if (req.method !== 'PUT' && req.method !== 'POST') return next();

    const match = req.path.match(/^\/data\/([a-z0-9_-]+\.json)$/i);
    if (!match) return next();

    const fileName = match[1];
    const dataType = FILE_TO_DATA_TYPE[fileName];
    if (!dataType) return next();

    const farmId = extractFarmId(req);
    if (!farmId) return next(); // No farm context → legacy file write

    const payload = req.body;

    // Normalize data before storing
    let dataToStore = payload;
    if (fileName === 'groups.json') {
      dataToStore = Array.isArray(payload) ? payload : (payload.groups || payload);
    }
    if (fileName === 'rooms.json') {
      dataToStore = Array.isArray(payload) ? payload : (payload.rooms || payload);
    }

    // Write to database if available
    if (isDatabaseAvailable()) {
      try {
        await query(
          `INSERT INTO farm_data (farm_id, data_type, data, updated_at)
           VALUES ($1, $2, $3, NOW())
           ON CONFLICT (farm_id, data_type)
           DO UPDATE SET data = $3, updated_at = NOW()`,
          [farmId, dataType, JSON.stringify(dataToStore)]
        );

        // Also update in-memory cache
        if (inMemoryStore) {
          if (!inMemoryStore[dataType]) inMemoryStore[dataType] = new Map();
          inMemoryStore[dataType].set(farmId, dataToStore);
        }

        logger.info(`[FarmData] Saved ${fileName} for farm ${farmId} to DB`);
        return res.json({ success: true, source: 'database', farmId });
      } catch (err) {
        logger.error(`[FarmData] DB write failed for ${farmId}/${dataType}:`, err.message);
        // Fall through to in-memory + file write
      }
    }

    // No DB available — store in-memory (keyed by farmId) so GET reads it back
    if (inMemoryStore) {
      if (!inMemoryStore[dataType]) inMemoryStore[dataType] = new Map();
      inMemoryStore[dataType].set(farmId, dataToStore);
    }

    // DO NOT write to flat file as fallback — the flat file is shared across
    // all farms and writing one farm's data there causes cross-farm data leaks
    // when unauthenticated requests fall through to express.static.
    // In-memory cache keyed by farmId is the safe fallback.
    logger.info(`[FarmData] Saved ${fileName} for farm ${farmId} to memory (no DB)`);

    return res.json({ success: true, source: 'memory', farmId });
  };
}

export default { farmDataMiddleware, farmDataWriteMiddleware };
