/**
 * Network Farms Store Service
 * Manages network farm registry
 * Auto-seeds from database on first access so catalog survives restarts
 */
import { query, isDatabaseAvailable } from '../config/database.js';

const networkFarms = new Map();
let seeded = false;

/**
 * Auto-seed the in-memory store from the farms DB table on first access.
 * This ensures the wholesale catalog and network farms list survive server restarts.
 */
async function seedFromDatabase() {
  if (seeded) return;
  seeded = true;
  try {
    if (!(await isDatabaseAvailable())) return;
    const result = await query(
      `SELECT farm_id, name, api_url, metadata, status FROM farms WHERE status IN ('active') ORDER BY last_heartbeat DESC NULLS LAST`
    );
    for (const row of result.rows) {
      const meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata || {});
      // Prefer the dedicated api_url column, then fall back to metadata
      const apiUrl = row.api_url || meta.api_url || meta.url || meta.edge_url || null;
      networkFarms.set(row.farm_id, {
        farm_id: row.farm_id,
        name: row.name || row.farm_id,
        api_url: apiUrl,
        url: apiUrl,
        status: row.status,
        contact: meta.contact || {},
        location: meta.location || {},
        updated_at: new Date().toISOString()
      });
    }
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
  networkFarms.set(farmId, {
    farm_id: farmId,
    ...farmData,
    updated_at: new Date().toISOString()
  });
  return networkFarms.get(farmId);
}

export async function removeNetworkFarm(farmId) {
  const existed = networkFarms.has(farmId);
  networkFarms.delete(farmId);
  return { success: existed };
}
