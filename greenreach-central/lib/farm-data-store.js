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
import crypto from 'crypto';
import { loadFarmApiKeys } from '../middleware/farmApiKeyAuth.js';

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
  farm_settings:     'farm-settings.json',
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
  farm_settings:     {},
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
 * Resolution: DB → in-memory → default (never flat-file on read)
 *
 * @param {string|null} farmId - Farm identifier (null = returns defaults)
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
  if (farmId && dbUp) {
    logger.debug(`[FarmStore] No DB data for ${farmId}/${dataType}, returning default`);
    return DEFAULTS[dataType] ?? null;
  }

  // 4. No farmId OR DB unavailable: return defaults. Never serve bundled
  //    flat-file demo data — it would leak image-baked state to unauthenticated
  //    callers and mask real persistence failures.
  if (!farmId) {
    logger.debug(`[FarmStore] No farmId for ${dataType}, returning default`);
  } else {
    logger.warn(`[FarmStore] DB unavailable for ${farmId}/${dataType}, returning default`);
  }
  return DEFAULTS[dataType] ?? null;
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

  // 3. In no-DB mode, also persist to flat files so data survives restarts/deploys.
  // Use `wrapped` (not `data`) so the on-disk payload carries the same mirrored
  // keys the DB and in-memory copies have. Otherwise a no-DB restart would load
  // an un-normalized flat file and defeat the schema guard for NORMALIZED_TYPES.
  if (!dbUp) {
    try {
      await writeFile(dataType, wrapped);
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

  // X-Farm-ID header -- ONLY trust if accompanied by valid API key
  // (mirrors hardening in middleware/farm-data.js -- commit 7ed5c76)
  const headerFarmId = req.headers['x-farm-id'];
  const headerApiKey = req.headers['x-api-key'];
  if (headerFarmId && headerApiKey) {
    const envKey = process.env.WHOLESALE_FARM_API_KEY;
    if (envKey && headerApiKey === envKey) {
      return headerFarmId;
    }
    const keys = loadFarmApiKeys();
    const farmEntry = keys[headerFarmId];
    if (farmEntry?.api_key && farmEntry?.status === 'active') {
      try {
        const keyBuf = Buffer.from(farmEntry.api_key, 'utf8');
        const inputBuf = Buffer.from(headerApiKey, 'utf8');
        if (keyBuf.length === inputBuf.length && crypto.timingSafeEqual(keyBuf, inputBuf)) {
          return headerFarmId;
        }
      } catch { /* length mismatch -- fall through */ }
    }
    logger.warn(`[FarmStore] Rejected X-Farm-ID without valid API key`);
  }

  // Query parameter
  if (req.query?.farm_id) return req.query.farm_id;

  // Fall back to FARM_ID env var or 'default' (single-tenant mode — ensures data
  // gets stored under the canonical farm ID even when no header is sent)
  return process.env.FARM_ID || 'default';
}

// ─────────────────────────────────────────────────────────────
// KEY CASE NORMALIZER (Gap #6)
// ─────────────────────────────────────────────────────────────
//
// farm_data is schemaless JSONB — different writers (wizard, farm-admin
// JS, edge sync, admin ops agent) have historically emitted the same
// logical field in both snake_case (`length_m`, `pickup_schedule`) and
// camelCase (`lengthM`, `pickupSchedule`). Readers compensate with long
// `?? ?? ??` chains (see views/grow-management-room-build-plan.js:92-100),
// but any reader that checks only one form silently misses the value,
// causing things like the 20m×15m default-room fallback the user has
// seen repeatedly. The normalizer below mirrors top-level string keys
// (and one level of nested objects) between the two cases on both the
// write path AND the read path, non-destructively: if both forms are
// already present, neither is overwritten. Data types known to carry
// drift are listed in NORMALIZED_TYPES; others pass through untouched
// so large, hot-path payloads (telemetry, inventory arrays) aren't
// walked every call.

const NORMALIZED_TYPES = new Set([
  'rooms', 'room_map', 'farm_settings', 'farm_profile', 'config',
]);

function _toCamel(key) {
  return key.replace(/_+([a-z0-9])/gi, (_, c) => c.toUpperCase());
}
function _toSnake(key) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2')
    .toLowerCase();
}

function _mirrorKeys(obj) {
  if (obj == null || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  const out = { ...obj };
  for (const [k, v] of Object.entries(obj)) {
    if (typeof k !== 'string') continue;
    // Only mirror simple identifier keys — skip quoted UUIDs, dotted
    // paths, numeric strings, or anything with non-identifier chars.
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(k)) continue;
    const camel = _toCamel(k);
    const snake = _toSnake(k);
    if (camel !== k && !(camel in out)) out[camel] = v;
    if (snake !== k && !(snake in out)) out[snake] = v;
  }
  return out;
}

function _normalizeDeep(value, depth) {
  if (depth <= 0) return value;
  if (Array.isArray(value)) {
    return value.map(v => _normalizeDeep(v, depth - 1));
  }
  if (value && typeof value === 'object') {
    const mirrored = _mirrorKeys(value);
    const out = {};
    for (const [k, v] of Object.entries(mirrored)) {
      out[k] = _normalizeDeep(v, depth - 1);
    }
    return out;
  }
  return value;
}

/**
 * Schema-guard / case normalizer for farm_data payloads. Applied symmetrically
 * on write (set) and read (unwrap) for types known to carry snake/camel drift.
 * Safe to call on any value — pass-through when dataType isn't registered.
 * Exported for unit tests; also used by normalizeFarmDataPayload.
 */
export function normalizeFarmDataPayload(dataType, data) {
  if (!NORMALIZED_TYPES.has(dataType)) return data;
  if (data == null) return data;
  // Cap depth so a pathological nested payload can't blow the stack.
  // depth=3 covers rooms[0].dimensions.lengthM and farm_settings.fulfillment.pickup_schedule.
  return _normalizeDeep(data, 3);
}

/**
 * Normalize data coming out of DB. Some data types store as {groups: [...]}
 * but callers expect just the array.
 */
function unwrap(dataType, data) {
  if (data == null) return DEFAULTS[dataType] ?? null;
  // Mirror snake/camel for drift-prone types before shape normalization.
  if (NORMALIZED_TYPES.has(dataType)) {
    data = normalizeFarmDataPayload(dataType, data);
  }

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
 * For drift-prone types (see NORMALIZED_TYPES), mirrors snake/camel keys
 * at write time so the row is readable under either convention even if a
 * caller bypasses the read-side normalizer (e.g. the sync connector, an
 * admin SQL query, or another service that reads farm_data directly).
 */
function wrap(dataType, data) {
  if (NORMALIZED_TYPES.has(dataType)) {
    return normalizeFarmDataPayload(dataType, data);
  }
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
