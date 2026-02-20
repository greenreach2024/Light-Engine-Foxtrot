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

import jwt from 'jsonwebtoken';
import logger from '../utils/logger.js';
import { query, isDatabaseAvailable } from '../config/database.js';

const JWT_SECRET = process.env.JWT_SECRET || 'greenreach-jwt-secret-2025';

// Map data file names to farm_data.data_type values
const FILE_TO_DATA_TYPE = {
  'groups.json': 'groups',
  'rooms.json': 'rooms',
  'env.json': 'telemetry',
  'schedules.json': 'schedules',
  'iot-devices.json': 'devices',
  'farm.json': 'farm_profile',
  'plans.json': 'plans',
};

// Default empty responses for each data type (prevent frontend errors)
const EMPTY_DEFAULTS = {
  'groups.json': [],
  'rooms.json': { rooms: [] },
  'env.json': { zones: [] },
  'schedules.json': { schedules: [] },
  'iot-devices.json': { devices: [] },
  'farm.json': null, // fall through to file
  'plans.json': { plans: [] },
};

/**
 * Extract farmId from JWT token in Authorization header or cookie.
 * Returns null if no valid token found (allows fallback to file serving).
 */
function extractFarmId(req) {
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

  // 2. X-Farm-ID header (edge device / API key auth)
  if (req.headers['x-farm-id']) {
    return req.headers['x-farm-id'];
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

    // No farm context → fall through to flat file (legacy single-farm mode)
    if (!farmId) return next();

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

    // 3. Fall through to static file serving (single-farm / no data yet)
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

    // Write to database
    if (isDatabaseAvailable()) {
      try {
        let dataToStore = payload;

        // Normalize: groups.json body might be { groups: [...] } or flat array
        if (fileName === 'groups.json') {
          dataToStore = Array.isArray(payload) ? payload : (payload.groups || payload);
        }
        if (fileName === 'rooms.json') {
          dataToStore = Array.isArray(payload) ? payload : (payload.rooms || payload);
        }

        await query(
          `INSERT INTO farm_data (farm_id, data_type, data, updated_at)
           VALUES ($1, $2, $3, NOW())
           ON CONFLICT (farm_id, data_type)
           DO UPDATE SET data = $3, updated_at = NOW()`,
          [farmId, dataType, JSON.stringify(dataToStore)]
        );

        // Also update in-memory cache
        if (inMemoryStore && inMemoryStore[dataType]?.set) {
          inMemoryStore[dataType].set(farmId, dataToStore);
        }

        logger.info(`[FarmData] Saved ${fileName} for farm ${farmId} to DB`);
        return res.json({ success: true, source: 'database', farmId });
      } catch (err) {
        logger.error(`[FarmData] DB write failed for ${farmId}/${dataType}:`, err.message);
        // Fall through to file write
      }
    }

    // Fall through to legacy file write handler
    next();
  };
}

export default { farmDataMiddleware, farmDataWriteMiddleware };
