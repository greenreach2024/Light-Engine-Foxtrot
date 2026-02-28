/**
 * Network Farms Store Service
 * Manages network farm registry
 * Auto-seeds from database on first access so catalog survives restarts
 */
import { query, isDatabaseAvailable } from '../config/database.js';

const networkFarms = new Map();
let seeded = false;
let lastDbSyncAt = 0;
const DB_SYNC_INTERVAL_MS = 60 * 1000;

function normalizeNetworkFarm(farmId, farmData = {}) {
  const name = farmData.farm_name || farmData.name || farmId;
  const apiUrl = farmData.base_url || farmData.api_url || farmData.url || null;
  const status = farmData.status || 'active';
  const updatedAt = farmData.updated_at || farmData.last_sync || new Date().toISOString();

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
    location: farmData.location || {},
    certifications: farmData.certifications || [],
    practices: farmData.practices || [],
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
      // Prefer the dedicated api_url column, then fall back to metadata
      const apiUrl = row.api_url || meta.api_url || meta.url || meta.edge_url || null;
      networkFarms.set(row.farm_id, normalizeNetworkFarm(row.farm_id, {
        farm_name: row.name || row.farm_id,
        base_url: apiUrl,
        status: row.status,
        auth_farm_id: meta.auth_farm_id || null,
        api_key: meta.api_key || null,
        contact: meta.contact || {},
        location: meta.location || {},
        certifications: Array.isArray(meta.certifications) ? meta.certifications : [],
        practices: Array.isArray(meta.practices) ? meta.practices : [],
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
}

export async function listNetworkFarms() {
  await seedFromDatabase();
  return Array.from(networkFarms.values());
}

export async function upsertNetworkFarm(farmId, farmData) {
  await seedFromDatabase();
  const normalizedFarm = normalizeNetworkFarm(farmId, {
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
        contact: normalizedFarm.contact || {},
        location: normalizedFarm.location || {},
        certifications: Array.isArray(normalizedFarm.certifications) ? normalizedFarm.certifications : [],
        practices: Array.isArray(normalizedFarm.practices) ? normalizedFarm.practices : []
      };

      await query(
        `INSERT INTO farms (farm_id, name, api_url, status, metadata, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, NOW(), NOW())
         ON CONFLICT (farm_id) DO UPDATE SET
           name = COALESCE(NULLIF($2, ''), farms.name),
           api_url = COALESCE(NULLIF($3, ''), farms.api_url),
           status = COALESCE(NULLIF($4, ''), farms.status),
           metadata = COALESCE(farms.metadata, '{}'::jsonb) || $5::jsonb,
           updated_at = NOW()`,
        [
          normalizedFarm.farm_id,
          normalizedFarm.farm_name || normalizedFarm.farm_id,
          normalizedFarm.api_url,
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
