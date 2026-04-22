/**
 * Network Farms Store Service
 * Manages network farm registry
 * Auto-seeds from database on first access so catalog survives restarts
 * Self-heals missing auth credentials from farm-api-keys.json
 */
import { query, isDatabaseAvailable } from '../config/database.js';
import crypto from 'crypto';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const networkFarms = new Map();
let seeded = false;
let lastDbSyncAt = 0;
let bootstrapDone = false;
const DB_SYNC_INTERVAL_MS = 60 * 1000;

/**
 * Load farm API keys from the local keys file (same file GC uses for inbound auth).
 * Used to auto-populate auth credentials for farms missing them in the DB.
 */
function loadLocalFarmApiKeys() {
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const keysPath = resolve(__dirname, '..', 'public', 'data', 'farm-api-keys.json');
    console.log(`[NetworkFarmsStore] Loading farm API keys from ${keysPath}`);
    const keys = JSON.parse(readFileSync(keysPath, 'utf8'));
    console.log(`[NetworkFarmsStore] Loaded ${Object.keys(keys).length} farm keys: ${Object.keys(keys).join(', ')}`);
    return keys;
  } catch (err) {
    console.warn('[NetworkFarmsStore] Failed to load farm-api-keys.json:', err.message);
    return {};
  }
}

/**
 * Parse WHOLESALE_FARM_URL_OVERRIDES env var.
 * Format: "FARM_ID=http://url,FARM_ID_2=http://url2"
 * Used to fix stale private IPs in the DB with stable EB CNAME URLs.
 */
function parseFarmUrlOverrides() {
  const raw = process.env.WHOLESALE_FARM_URL_OVERRIDES || '';
  if (!raw) return {};
  const overrides = {};
  for (const pair of raw.split(',')) {
    const eqIdx = pair.indexOf('=');
    if (eqIdx > 0) {
      const farmId = pair.substring(0, eqIdx).trim();
      const url = pair.substring(eqIdx + 1).trim();
      if (farmId && url) overrides[farmId] = url;
    }
  }
  return overrides;
}

// Fallback lat/lng centroids for cities we know are covered by the wholesale
// network today. Applied when a farm's stored location has a city but no
// coordinates, so downstream consumers (Environmental Impact panel, catalog
// service-radius filter, farm distance chips) stay consistent instead of
// one panel enriching coords and another silently dropping the farm.
// Keep keys lowercased and stripped of punctuation.
const CITY_COORD_FALLBACKS = {
  kingston: { latitude: 44.2312, longitude: -76.4860 }
};

function normalizeCityKey(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Pure helper: given a location object, return a new object with
// lat/lng filled in from CITY_COORD_FALLBACKS when they are missing
// and the city is recognized. Never overrides existing coordinates.
export function enrichLocationCoords(rawLocation) {
  const location = rawLocation && typeof rawLocation === 'object' ? { ...rawLocation } : {};
  const latNum = Number(location.latitude ?? location.lat);
  const lngNum = Number(location.longitude ?? location.lng ?? location.lon);
  if (Number.isFinite(latNum) && Number.isFinite(lngNum)) {
    location.latitude = latNum;
    location.longitude = lngNum;
    return location;
  }

  const cityKey = normalizeCityKey(location.city || location.town || location.municipality);
  if (!cityKey) return location;

  for (const [prefix, coords] of Object.entries(CITY_COORD_FALLBACKS)) {
    if (cityKey === prefix || cityKey.startsWith(`${prefix} `)) {
      location.latitude = coords.latitude;
      location.longitude = coords.longitude;
      return location;
    }
  }
  return location;
}

function normalizeNetworkFarm(farmId, farmData = {}) {
  const name = farmData.farm_name || farmData.name || farmId;
  const apiUrl = farmData.base_url || farmData.api_url || farmData.url || null;
  const status = farmData.status || 'active';
  const updatedAt = farmData.updated_at || farmData.last_sync || new Date().toISOString();
  const fulfillmentStandards = farmData.fulfillment_standards || farmData.fulfillmentStandards || {};

  return {
    farm_id: farmId,
    farm_name: name,
    name,
    base_url: apiUrl,
    api_url: apiUrl,
    url: apiUrl,
    status,
    auth_farm_id: farmData.auth_farm_id || null,
    api_key: farmData.api_key || null,
    contact: farmData.contact || {},
    location: enrichLocationCoords(farmData.location || {}),
    certifications: farmData.certifications || [],
    practices: farmData.practices || [],
    fulfillment_standards: fulfillmentStandards,
    last_sync: farmData.last_sync || updatedAt,
    updated_at: updatedAt,
    created_at: farmData.created_at || null
  };
}

/**
 * Auto-seed the in-memory store from the farms DB table on first access.
 * This ensures the wholesale catalog and network farms list survive server restarts.
 */
async function seedFromDatabase() {
  const now = Date.now();
  if (seeded && (now - lastDbSyncAt) < DB_SYNC_INTERVAL_MS) return;
  seeded = true;
  try {
    if (!(await isDatabaseAvailable())) return;
    const result = await query(
      `SELECT farm_id, name, api_url, metadata, status, created_at, updated_at, last_sync
       FROM farms
       WHERE status IN ('active', 'online', 'pending')
       ORDER BY COALESCE(last_heartbeat, updated_at, created_at) DESC NULLS LAST`
    );
    for (const row of result.rows) {
      const meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata || {});
      // Self-heal: if name column was overwritten with farm_id, recover from metadata
      let farmName = row.name || row.farm_id;
      if (farmName === row.farm_id && meta.name && meta.name !== row.farm_id) {
        farmName = meta.name;
        query('UPDATE farms SET name = $1 WHERE farm_id = $2 AND name = $2', [farmName, row.farm_id]).catch(() => {});
        console.log(`[NetworkFarmsStore] Self-healed farm name for ${row.farm_id}: ${farmName}`);
      }
      // Prefer the dedicated api_url column, then fall back to metadata
      const apiUrl = row.api_url || meta.api_url || meta.url || meta.edge_url || null;
      networkFarms.set(row.farm_id, normalizeNetworkFarm(row.farm_id, {
        farm_name: farmName,
        base_url: apiUrl,
        status: row.status,
        auth_farm_id: meta.auth_farm_id || null,
        api_key: meta.api_key || null,
        contact: meta.contact || {},
        location: meta.location || {},
        certifications: Array.isArray(meta.certifications) ? meta.certifications : [],
        practices: Array.isArray(meta.practices) ? meta.practices : [],
          fulfillment_standards: meta.fulfillment_standards || {},
        created_at: row.created_at,
        updated_at: row.updated_at,
        last_sync: row.last_sync
      }));
    }
    lastDbSyncAt = now;
    if (result.rows.length > 0) {
      console.log(`[NetworkFarmsStore] Seeded ${result.rows.length} farms from database`);
    }
  } catch (err) {
    console.warn('[NetworkFarmsStore] DB seed failed (non-fatal):', err.message);
  }

  // ── Self-healing bootstrap: fill missing auth + fix stale URLs ──
  if (!bootstrapDone) {
    bootstrapDone = true;
    try {
      const localKeys = loadLocalFarmApiKeys();
      const urlOverrides = parseFarmUrlOverrides();
      let patched = 0;

      for (const [farmId, farm] of networkFarms.entries()) {
        let needsUpdate = false;
        const updates = {};

        // Fill missing auth from local farm-api-keys.json
        if (!farm.api_key && localKeys[farmId]?.api_key) {
          updates.auth_farm_id = farmId;
          updates.api_key = localKeys[farmId].api_key;
          needsUpdate = true;
          console.log(`[NetworkFarmsStore] Bootstrap: filling auth for farm ${farmId} from farm-api-keys.json`);
        }

        // Apply URL overrides (replaces stale private IPs)
        if (urlOverrides[farmId] && urlOverrides[farmId] !== farm.api_url) {
          updates.api_url = urlOverrides[farmId];
          updates.url = urlOverrides[farmId];
          updates.base_url = urlOverrides[farmId];
          needsUpdate = true;
          console.log(`[NetworkFarmsStore] Bootstrap: overriding URL for farm ${farmId} → ${urlOverrides[farmId]}`);
        }

        if (needsUpdate) {
          // Update in-memory immediately
          const updated = normalizeNetworkFarm(farmId, { ...farm, ...updates });
          networkFarms.set(farmId, updated);

          // Persist to DB (best-effort)
          try {
            if (await isDatabaseAvailable()) {
              const metadata = {
                auth_farm_id: updated.auth_farm_id,
                api_key: updated.api_key,
                api_url: updated.api_url,
                url: updated.api_url,
                contact: updated.contact || {},
                location: updated.location || {},
                certifications: updated.certifications || [],
                  practices: updated.practices || [],
                  fulfillment_standards: updated.fulfillment_standards || {}
              };
              await query(
                `UPDATE farms SET
                   api_url = COALESCE(NULLIF($2, ''), farms.api_url),
                   metadata = COALESCE(farms.metadata, '{}'::jsonb) || $3::jsonb,
                   updated_at = NOW()
                 WHERE farm_id = $1`,
                [farmId, updated.api_url, JSON.stringify(metadata)]
              );
              patched++;
            }
          } catch (dbErr) {
            console.warn(`[NetworkFarmsStore] Bootstrap DB update failed for ${farmId}:`, dbErr.message);
          }
        }
      }

      if (patched > 0) {
        console.log(`[NetworkFarmsStore] Bootstrap: patched ${patched} farms in DB`);
      }
    } catch (bootstrapErr) {
      console.warn('[NetworkFarmsStore] Bootstrap failed (non-fatal):', bootstrapErr.message);
    }
  }
}

export async function listNetworkFarms() {
  await seedFromDatabase();
  return Array.from(networkFarms.values());
}

export async function upsertNetworkFarm(farmId, farmData) {
  await seedFromDatabase();

  // Apply URL overrides so heartbeats can't overwrite with stale private IPs
  const urlOverrides = parseFarmUrlOverrides();
  if (urlOverrides[farmId]) {
    farmData = { ...farmData, api_url: urlOverrides[farmId], url: urlOverrides[farmId], base_url: urlOverrides[farmId] };
  }

  // Fill missing auth from local farm-api-keys.json
  if (!farmData.api_key) {
    const localKeys = loadLocalFarmApiKeys();
    if (localKeys[farmId]?.api_key) {
      farmData = { ...farmData, auth_farm_id: farmId, api_key: localKeys[farmId].api_key };
    }
  }

  const existingFarm = networkFarms.get(farmId) || {};

  // Preserve existing real name when incoming name is just the farm_id
  const existingRealName = existingFarm.farm_name || existingFarm.name;
  if (existingRealName && existingRealName !== farmId) {
    if (!farmData.name || farmData.name === farmId) farmData = { ...farmData, name: existingRealName };
    if (!farmData.farm_name || farmData.farm_name === farmId) farmData = { ...farmData, farm_name: existingRealName };
  }

  const normalizedFarm = normalizeNetworkFarm(farmId, {
    ...existingFarm,
    ...farmData,
    updated_at: new Date().toISOString()
  });
  networkFarms.set(farmId, normalizedFarm);

  try {
    if (await isDatabaseAvailable()) {
      const metadata = {
        api_url: normalizedFarm.api_url,
        url: normalizedFarm.url,
        auth_farm_id: normalizedFarm.auth_farm_id,
        api_key: normalizedFarm.api_key || null,
        contact: normalizedFarm.contact || {},
        location: normalizedFarm.location || {},
        certifications: Array.isArray(normalizedFarm.certifications) ? normalizedFarm.certifications : [],
          practices: Array.isArray(normalizedFarm.practices) ? normalizedFarm.practices : [],
          fulfillment_standards: normalizedFarm.fulfillment_standards || {}
      };

      await query(
        `INSERT INTO farms (farm_id, name, contact_name, api_url, api_key, api_secret, jwt_secret, status, plan_type, metadata, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'cloud', $9::jsonb, NOW(), NOW())
         ON CONFLICT (farm_id) DO UPDATE SET
           name = COALESCE(NULLIF(NULLIF($2, ''), $1), farms.name),
           api_url = COALESCE(NULLIF($4, ''), farms.api_url),
           api_key = COALESCE(NULLIF($5, ''), farms.api_key),
           api_secret = COALESCE(farms.api_secret, EXCLUDED.api_secret),
           jwt_secret = COALESCE(farms.jwt_secret, EXCLUDED.jwt_secret),
           status = COALESCE(NULLIF($8, ''), farms.status),
           metadata = COALESCE(farms.metadata, '{}'::jsonb) || $9::jsonb,
           updated_at = NOW()`,
        [
          normalizedFarm.farm_id,
          normalizedFarm.farm_name || normalizedFarm.farm_id,
          normalizedFarm.contact?.name || normalizedFarm.contact?.contactName || 'Farm Admin',
          normalizedFarm.api_url,
          normalizedFarm.api_key || 'pending',
          crypto.randomBytes(32).toString('hex'),
          crypto.randomBytes(32).toString('hex'),
          normalizedFarm.status || 'active',
          JSON.stringify(metadata)
        ]
      );
    }
  } catch (err) {
    console.warn(`[NetworkFarmsStore] Failed to persist farm ${farmId} to DB:`, err.message);
  }

  return normalizedFarm;
}

export async function removeNetworkFarm(farmId) {
  const existed = networkFarms.has(farmId);
  networkFarms.delete(farmId);
  return { success: existed };
}
