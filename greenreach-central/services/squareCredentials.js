/**
 * Square Credentials Service
 * Manages Square payment credentials for farms
 */

import { listNetworkFarms } from './networkFarmsStore.js';

function withTimeout(url, options = {}, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

function resolveFarmConnection(farmId, farmRecord) {
  const apiUrl = farmRecord?.api_url || farmRecord?.url || null;
  const authFarmId = farmRecord?.auth_farm_id || farmId;
  const apiKey = farmRecord?.api_key || null;
  return {
    farmId,
    authFarmId,
    apiUrl,
    apiKey,
  };
}

function buildHeaders(conn) {
  const headers = { Accept: 'application/json' };
  if (conn.authFarmId) headers['X-Farm-ID'] = conn.authFarmId;
  if (conn.apiKey) headers['X-API-Key'] = conn.apiKey;
  return headers;
}

export async function getFarmSquareCredentials(farmId, opts = {}) {
  const includeToken = opts.includeToken !== false;
  const farms = await listNetworkFarms();
  const farmRecord = (farms || []).find((farm) => String(farm.farm_id) === String(farmId));
  const conn = resolveFarmConnection(farmId, farmRecord);

  if (!conn.apiUrl) {
    return {
      success: false,
      connected: false,
      farm_id: farmId,
      error: 'missing_api_url',
    };
  }

  const headers = buildHeaders(conn);
  const encodedFarm = encodeURIComponent(String(conn.authFarmId));
  const statusUrl = `${String(conn.apiUrl).replace(/\/$/, '')}/api/wholesale/oauth/square/status/${encodedFarm}`;

  try {
    const statusRes = await withTimeout(statusUrl, { method: 'GET', headers }, 7000);
    const statusJson = await statusRes.json().catch(() => null);

    if (!statusRes.ok || !statusJson) {
      return {
        success: false,
        connected: false,
        farm_id: farmId,
        status_code: statusRes.status,
        error: statusJson?.message || `status_http_${statusRes.status}`,
      };
    }

    const statusData = statusJson.data || {};
    const connected = String(statusData.oauth_status || '').toLowerCase() === 'active';

    if (!connected) {
      return {
        success: false,
        connected: false,
        farm_id: farmId,
        merchant_id: statusData.merchant_id || null,
        location_id: statusData.location_id || null,
        error: 'square_not_connected',
      };
    }

    const base = {
      success: true,
      connected: true,
      farm_id: farmId,
      merchant_id: statusData.merchant_id || null,
      location_id: statusData.location_id || null,
      location_name: statusData.location_name || null,
      expires_at: statusData.expires_at || null,
      source_url: conn.apiUrl,
    };

    if (!includeToken) return base;

    const tokenUrl = `${String(conn.apiUrl).replace(/\/$/, '')}/api/wholesale/oauth/square/token/${encodedFarm}`;
    const tokenRes = await withTimeout(tokenUrl, { method: 'GET', headers }, 7000);
    const tokenJson = await tokenRes.json().catch(() => null);

    if (!tokenRes.ok || !tokenJson?.data?.access_token) {
      return {
        ...base,
        success: false,
        connected: false,
        error: tokenJson?.message || `token_http_${tokenRes.status}`,
      };
    }

    return {
      ...base,
      access_token: tokenJson.data.access_token,
    };
  } catch (error) {
    return {
      success: false,
      connected: false,
      farm_id: farmId,
      error: error?.name === 'AbortError' ? 'request_timeout' : (error.message || 'request_failed'),
    };
  }
}

export async function getBatchFarmSquareCredentials(farmIds) {
  const ids = Array.isArray(farmIds) ? farmIds : [];
  const results = await Promise.all(ids.map((farmId) => getFarmSquareCredentials(farmId, { includeToken: true })));
  const mapped = new Map();
  results.forEach((result, index) => {
    mapped.set(String(ids[index]), result);
  });
  return mapped;
}
