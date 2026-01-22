/**
 * Network Farms Store Service
 * Manages network farm registry
 */

const networkFarms = new Map();

export async function listNetworkFarms() {
  return Array.from(networkFarms.values());
}

export async function upsertNetworkFarm(farmId, farmData) {
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
