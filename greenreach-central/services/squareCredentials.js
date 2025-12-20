/**
 * GreenReach Central - Square Credentials Helper
 * 
 * Fetches farm Square credentials from their Light Engine servers.
 * Credentials are stored on farm servers, not in Central.
 */

import { listNetworkFarms } from './networkFarmsStore.js';

/**
 * Get Square credentials for a specific farm
 * @param {string} farmId - Farm ID
 * @returns {Promise<{merchant_id: string, location_id: string, access_token: string}>}
 */
export async function getFarmSquareCredentials(farmId) {
  try {
    // Get farm's base URL
    const farms = await listNetworkFarms();
    const farm = farms.find(f => String(f.farm_id) === String(farmId));
    
    if (!farm || !farm.base_url) {
      throw new Error(`Farm ${farmId} not found in network registry`);
    }
    
    // Check if farm has Square connected
    const statusResponse = await fetch(
      new URL('/api/wholesale/oauth/square/status', farm.base_url).toString(),
      { signal: AbortSignal.timeout(3000) }
    );
    
    if (!statusResponse.ok) {
      throw new Error(`Farm ${farmId} Square status check failed: ${statusResponse.status}`);
    }
    
    const statusData = await statusResponse.json();
    
    if (statusData.status !== 'ok' || !statusData.data) {
      throw new Error(`Farm ${farmId} does not have Square connected`);
    }
    
    // Get Square IDs
    const idsResponse = await fetch(
      new URL(`/api/wholesale/oauth/square/ids/${farmId}`, farm.base_url).toString(),
      { signal: AbortSignal.timeout(3000) }
    );
    
    if (!idsResponse.ok) {
      throw new Error(`Failed to get Square IDs for farm ${farmId}`);
    }
    
    const idsData = await idsResponse.json();
    
    if (idsData.status !== 'ok' || !idsData.data) {
      throw new Error(`Farm ${farmId} Square IDs not available`);
    }
    
    // Get access token
    const tokenResponse = await fetch(
      new URL(`/api/wholesale/oauth/square/token/${farmId}`, farm.base_url).toString(),
      { signal: AbortSignal.timeout(3000) }
    );
    
    if (!tokenResponse.ok) {
      throw new Error(`Failed to get Square token for farm ${farmId}`);
    }
    
    const tokenData = await tokenResponse.json();
    
    if (tokenData.status !== 'ok' || !tokenData.data?.access_token) {
      throw new Error(`Farm ${farmId} Square token not available`);
    }
    
    return {
      merchant_id: idsData.data.merchant_id,
      location_id: idsData.data.location_id,
      access_token: tokenData.data.access_token,
      farm_base_url: farm.base_url
    };
    
  } catch (error) {
    console.error(`[Square Credentials] Error for farm ${farmId}:`, error);
    throw error;
  }
}

/**
 * Check if farm has Square connected
 * @param {string} farmId - Farm ID
 * @returns {Promise<boolean>}
 */
export async function farmHasSquareConnected(farmId) {
  try {
    await getFarmSquareCredentials(farmId);
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Get Square credentials for multiple farms (batch operation)
 * @param {string[]} farmIds - Array of farm IDs
 * @returns {Promise<Map<string, object>>} Map of farmId -> credentials
 */
export async function getBatchFarmSquareCredentials(farmIds) {
  const results = new Map();
  
  await Promise.allSettled(
    farmIds.map(async (farmId) => {
      try {
        const credentials = await getFarmSquareCredentials(farmId);
        results.set(farmId, { success: true, credentials });
      } catch (error) {
        results.set(farmId, { success: false, error: error.message });
      }
    })
  );
  
  return results;
}
