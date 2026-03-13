/**
 * Farm Data Store — Unified tenant-scoped data access layer
 *
 * Phase 3 of Cloud SaaS migration. Replaces direct fs.readFileSync / writeFileSync
 * calls throughout Central with a single API that resolves data in priority order:
 *
 *   1. PostgreSQL farm_data table (farm_id + data_type → JSONB)
 *   2. In-memory cache (sync.js Maps, hydrated on startup)
 *   3. Flat file fallback (for dev/edge mode or missing farm context)
 *
 * Usage:
 *   import { farmStore } from '../lib/farm-data-store.js';
 *
 *   const groups = await farmStore.get(farmId, 'groups');
 *   await farmStore.set(farmId, 'groups', groupsArray);
 *
 * Design principles:
 * - farmId=null → falls through to flat files (backward compat)
 * - All writes go to DB + in-memory (dual-write)
 * - Read: DB → memory → file → default
 * - Global data (crop-registry, lighting-recipes) uses file directly (not tenant-scoped)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import { randomBytes } from 'crypto';
import { query, isDatabaseAvailable } from '../config/database.js';
import logger from '../utils/logger.js';

// JWT secret for token parsing (same logic as middleware/farm-data.js)
const _JWT_SECRET = process.env.JWT_SECRET || randomBytes(32).toString('hex');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Data directories
const CENTRAL_DATA_DIR = path.join(__dirname, '..', 'public', 'data');
const LEGACY_DATA_DIR = path.join(__dirname, '..', '..', 'public', 'data');
const DATA_DIRS = [CENTRAL_DATA_DIR, LEGACY_DATA_DIR];

// In-memory store reference — set during init from sync.js getInMemoryStore()
let _memoryStore = null;

// Map of logical data types to JSON file names (for file fallback)
const TYPE_TO_FILE = {
  groups:        'groups.json',
  rooms:         'rooms.json',
  schedules:     'schedules.json',
  telemetry:     'env.json',
  devices:       'iot-devices.json',
  farm_profile:  'farm.json',
  plans:         'plans.json',
  config:        'configuration.json',
  tray_formats:  'tray-formats.json',
  trays:         'trays.json',
  crop_pricing:  'crop-pricing.json',
  dedicated_crops: 'dedicated-crops.json',
  room_map:      'room-map.json',
  inventory:     'inventory.json',
  procurement_catalog:   'procurement-catalog.json',
  procurement_suppliers: 'procurement-suppliers.json',
  procurement_orders:    'procurement-orders.json',
  nutrient_dashboard:    'nutrient-dashboard.json',
};

// Default empty values per type (prevent frontend errors)
const DEFAULTS = {
  groups:        [],
  rooms:         [],
  schedules:     [],
  telemetry:     { zones: [] },
  devices:       [],
  farm_profile:  null,
  plans:         [],
  config:        {},
  tray_formats:  [],
  trays:         [],
  crop_pricing:  { crops: [] },
  dedicated_crops: [],
  room_map:      {},
  inventory:     [],
  procurement_catalog:   { products: [] },
  procurement_suppliers: { suppliers: [] },
  procurement_orders:    { orders: [] },
  nutrient_dashboard:    {},
};

/**
 * Initialize the store with the in-memory store from sync.js
 */
export function initFarmStore(memoryStore) {
  _memoryStore = memoryStore;
  logger.info('[FarmStore] Initialized with in-memory store');
}

// ─────────────────────────────────────────────────────────────
// CORE READ
// ─────────────────────────────────────────────────────────────

/**
 * Get farm-scoped data by type.
 *
 * Resolution: DB → in-memory → flat file (no-DB) → default
 *
 * @param {string|null} farmId - Farm identifier (null = file fallback only)
 * @param {string} dataType - Logical data type (e.g., 'groups', 'rooms')
 * @returns {Promise<any>} Data payload
 */
async function get(farmId, dataType) {
  const dbUp = await isDatabaseAvailable();

  // 1. Try DB if farmId provided and DB is up
  if (farmId && dbUp) {
    try {
      const result = await query(
        'SELECT data FROM farm_data WHERE farm_id = $1 AND data_type = $2 LIMIT 1',
        [farmId, dataType]
      );
      if (result.rows.length > 0 && result.rows[0].data != null) {
        return unwrap(dataType, result.rows[0].data);
      }
    } catch (err) {
      logger.warn(`[FarmStore] DB read failed (${dataType}/${farmId}):`, err.message);
    }
  }

  // 2. Try in-memory store
  if (farmId && _memoryStore) {
    const map = _memoryStore[dataType];
    if (map instanceof Map && map.has(farmId)) {
      return unwrap(dataType, map.get(farmId));
    }
  }

  // 3. Multi-tenant (DB available): return defaults to prevent cross-farm leakage.
  //    Single-tenant (no DB): fall through to flat files — they ARE this farm's data
  //    and are the only persistence layer that survives restarts.
  if (farmId && dbUp) {
    logger.debug(`[FarmStore] No DB data for ${farmId}/${dataType}, returning default`);
    return DEFAULTS[dataType] ?? null;
  }

  // 4. Flat file fallback (edge/dev mode OR single-tenant no-DB cloud)
  return readFile(dataType);
}

/**
 * Get data for ALL farms of a given type (admin/network views).
 *
 * @param {string} dataType
 * @returns {Promise<Array<{farm_id: string, data: any}>>}
 */
async function getAll(dataType) {
  if (await isDatabaseAvailable()) {
    try {
      const result = await query(
        'SELECT farm_id, data FROM farm_data WHERE data_type = $1',
        [dataType]
      );
      return result.rows.map(r => ({
        farm_id: r.farm_id,
        data: unwrap(dataType, r.data),
      }));
    } catch (err) {
      logger.warn(`[FarmStore] DB getAll failed (${dataType}):`, err.message);
    }
  }

  // Fallback: collect from in-memory store
  if (_memoryStore && _memoryStore[dataType] instanceof Map) {
    return [..._memoryStore[dataType].entries()].map(([farm_id, data]) => ({
      farm_id,
      data: unwrap(dataType, data),
    }));
  }

  return [];
}

// ─────────────────────────────────────────────────────────────
// CORE WRITE
// ─────────────────────────────────────────────────────────────

/**
 * Set farm-scoped data. Dual-writes to DB + in-memory store.
 *
 * @param {string} farmId - Farm identifier
 * @param {string} dataType - Logical data type
 * @param {any} data - Payload to store
 */
async function set(farmId, dataType, data) {
  if (!farmId) {
    // No farm context — write to flat file only (legacy mode)
    return writeFile(dataType, data);
  }

  const wrapped = wrap(dataType, data);
  const dbUp = await isDatabaseAvailable();

  // 1. Write to DB
  if (dbUp) {
    try {
      await query(
        `INSERT INTO farm_data (farm_id, data_type, data, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (farm_id, data_type) DO UPDATE SET data = $3, updated_at = NOW()`,
        [farmId, dataType, JSON.stringify(wrapped)]
      );
    } catch (err) {
      logger.warn(`[FarmStore] DB write failed (${dataType}/${farmId}):`, err.message);
    }
  }

  // 2. Update in-memory store
  if (_memoryStore) {
    if (!_memoryStore[dataType]) {
      _memoryStore[dataType] = new Map();
    }
    _memoryStore[dataType].set(farmId, wrapped);
  }

  // 3. In no-DB mode, also persist to flat files so data survives restarts/deploys
  if (!dbUp) {
    try {
      await writeFile(dataType, data);
    } catch (err) {
      logger.warn(`[FarmStore] Flat-file write failed (${dataType}/${farmId}):`, err.message);
    }
  }
}

/**
 * Delete farm-scoped data.
 */
async function remove(farmId, dataType) {
  if (!farmId) return;

  if (await isDatabaseAvailable()) {
    try {
      await query(
        'DELETE FROM farm_data WHERE farm_id = $1 AND data_type = $2',
        [farmId, dataType]
      );
    } catch (err) {
      logger.warn(`[FarmStore] DB delete failed (${dataType}/${farmId}):`, err.message);
    }
  }

  if (_memoryStore && _memoryStore[dataType] instanceof Map) {
    _memoryStore[dataType].delete(farmId);
  }
}

// ─────────────────────────────────────────────────────────────
// GLOBAL DATA (not tenant-scoped — read from files)
// ─────────────────────────────────────────────────────────────

/**
 * Read global (shared) data that is NOT farm-scoped.
 * These are reference datasets that all farms share.
 */
async function getGlobal(fileName) {
  for (const dir of DATA_DIRS) {
    const filePath = path.join(dir, fileName);
    if (fs.existsSync(filePath)) {
      try {
        return JSON.parse(await fs.promises.readFile(filePath, 'utf8'));
      } catch (err) {
        logger.warn(`[FarmStore] Failed to read global file ${fileName}:`, err.message);
      }
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

/**
 * Extract the farm ID from a request — checks JWT, header, query param.
 */
function farmIdFromReq(req) {
  // Already extracted by auth middleware
  if (req.farmId) return req.farmId;

  // Authorization: Bearer <token> — parse JWT for farm_id
  // (This handler may run before the farmId-resolution middleware,
  //  so we must parse the token ourselves to get the correct farm ID.)
  const authHeader = req.headers?.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const payload = jwt.verify(authHeader.substring(7), _JWT_SECRET, {
        issuer: 'greenreach-central',
        audience: 'greenreach-farms'
      });
      if (payload.farm_id) return payload.farm_id;
    } catch (_) { /* token invalid/expired — fall through */ }
  }

  // X-Farm-ID header
  if (req.headers['x-farm-id']) return req.headers['x-farm-id'];

  // Query parameter
  if (req.query?.farm_id) return req.query.farm_id;

  // Fall back to FARM_ID env var or 'default' (single-tenant mode — ensures data
  // gets stored under the canonical farm ID even when no header is sent)
  return process.env.FARM_ID || 'default';
}

/**
 * Normalize data coming out of DB. Some data types store as {groups: [...]}
 * but callers expect just the array.
 */
function unwrap(dataType, data) {
  if (data == null) return DEFAULTS[dataType] ?? null;

  switch (dataType) {
    case 'groups':
      return Array.isArray(data) ? data : (data.groups || []);
    case 'rooms':
      if (Array.isArray(data)) return data;
      if (data.rooms && Array.isArray(data.rooms)) return data.rooms;
      return [data]; // single room object
    case 'schedules':
      return Array.isArray(data) ? data : (data.schedules || []);
    case 'devices':
      return Array.isArray(data) ? data : (data.devices || []);
    case 'plans':
      return Array.isArray(data) ? data : (data.plans || []);
    case 'tray_formats':
      return Array.isArray(data) ? data : (data.formats || data.tray_formats || []);
    case 'trays':
      return Array.isArray(data) ? data : (data.trays || []);
    case 'dedicated_crops':
      return Array.isArray(data) ? data : (data.crops || []);
    case 'crop_pricing':
      if (data.crops) return data;
      return { crops: Array.isArray(data) ? data : [] };
    case 'procurement_catalog':
      return data.products ? data : { products: [] };
    case 'procurement_suppliers':
      return data.suppliers ? data : { suppliers: [] };
    case 'procurement_orders':
      return data.orders ? data : { orders: [] };
    default:
      return data;
  }
}

/**
 * Prepare data for DB storage — wrap arrays in objects for consistency.
 */
function wrap(dataType, data) {
  // Store the data as-is — the unwrap function handles normalization on read
  return data;
}

/**
 * Read from flat file (search both data directories).
 */
async function readFile(dataType) {
  const fileName = TYPE_TO_FILE[dataType];
  if (!fileName) return DEFAULTS[dataType] ?? null;

  for (const dir of DATA_DIRS) {
    const filePath = path.join(dir, fileName);
    if (fs.existsSync(filePath)) {
      try {
        const raw = await fs.promises.readFile(filePath, 'utf8');
        return unwrap(dataType, JSON.parse(raw));
      } catch (err) {
        logger.warn(`[FarmStore] File read failed ${fileName}:`, err.message);
      }
    }
  }
  return DEFAULTS[dataType] ?? null;
}

/**
 * Write to flat file (legacy mode, no farm context).
 */
async function writeFile(dataType, data) {
  const fileName = TYPE_TO_FILE[dataType];
  if (!fileName) return;

  const filePath = path.join(CENTRAL_DATA_DIR, fileName);
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * Read a flat file synchronously with a fallback value.
 * Searches both data directories. Compatible with existing readDataJsonWithFallback.
 */
function readFileSync(dataType, fallback) {
  const fileName = TYPE_TO_FILE[dataType];
  if (!fileName) return fallback;

  for (const dir of DATA_DIRS) {
    const filePath = path.join(dir, fileName);
    if (fs.existsSync(filePath)) {
      try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
      } catch {
        // continue to next dir
      }
    }
  }
  return fallback;
}

// ─────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────

export const farmStore = {
  get,
  getAll,
  set,
  remove,
  getGlobal,
  farmIdFromReq,
  readFileSync,
};

export default farmStore;
