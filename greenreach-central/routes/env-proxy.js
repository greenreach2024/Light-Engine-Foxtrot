/**
 * Environmental Data Proxy Routes
 * Proxies /env requests to farm endpoints while enforcing tenant boundaries.
 */

import express from 'express';
import logger from '../utils/logger.js';
import { listNetworkFarms } from '../services/networkFarmsStore.js';

const router = express.Router();

function cleanString(value) {
  if (value == null) return '';
  return String(value).trim();
}

function parseHours(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 24;
  return Math.max(1, Math.min(168, Math.round(parsed)));
}

function isPrivilegedRequest(req) {
  return Boolean(
    req.admin
    || req.user?.authMethod === 'admin-jwt'
    || req.user?.role === 'superadmin'
    || req.user?.farmId === 'ADMIN'
  );
}

function findFarmById(farms, farmId) {
  return farms.find((farm) => {
    const id = cleanString(farm.farm_id || farm.id);
    return id && id === farmId;
  }) || null;
}

function getFarmEndpoint(farm) {
  return cleanString(farm?.api_url || farm?.base_url || farm?.url || farm?.endpoint);
}

function resolveActor(req) {
  return cleanString(
    req.user?.userId
    || req.user?.email
    || req.admin?.email
    || req.user?.farmId
    || 'unknown'
  );
}

function resolveCallerFarmId(req) {
  return cleanString(req.user?.farmId);
}

function resolveTargetFarmIdForDefaultRoute(req) {
  const callerFarmId = resolveCallerFarmId(req);
  const requestedFarmId = cleanString(req.query.farmId || req.query.farm_id);
  const privileged = isPrivilegedRequest(req);

  if (!callerFarmId) {
    const err = new Error('Authentication required');
    err.status = 401;
    throw err;
  }

  if (!privileged) {
    if (requestedFarmId && requestedFarmId !== callerFarmId) {
      const err = new Error('Cross-farm telemetry access requires admin endpoint /api/env/network');
      err.status = 403;
      throw err;
    }
    return callerFarmId;
  }

  if (requestedFarmId) return requestedFarmId;
  if (callerFarmId && callerFarmId !== 'ADMIN') return callerFarmId;

  const err = new Error('farmId is required for admin telemetry access');
  err.status = 400;
  throw err;
}

async function fetchEnvSnapshot({ req, res, next, farmId, hours, accessPolicy, purpose = null }) {
  try {
    const farms = await listNetworkFarms();
    if (!Array.isArray(farms) || farms.length === 0) {
      return res.status(503).json({
        error: 'No farms available',
        message: 'No farm endpoints are registered in the network',
        timestamp: new Date().toISOString(),
      });
    }

    const targetFarm = findFarmById(farms, farmId);
    if (!targetFarm) {
      return res.status(404).json({
        error: 'Farm not found',
        message: `Farm ${farmId} not found in network`,
        timestamp: new Date().toISOString(),
      });
    }

    const farmEndpoint = getFarmEndpoint(targetFarm);
    if (!farmEndpoint) {
      return res.status(500).json({
        error: 'Farm endpoint not configured',
        message: `Farm ${farmId} does not have an endpoint URL`,
        timestamp: new Date().toISOString(),
      });
    }

    const farmUrl = `${farmEndpoint}/env?hours=${hours}`;
    logger.info(`[ENV Proxy] ${accessPolicy} fetch farm=${farmId} url=${farmUrl}`);

    const proxyHeaders = {
      Accept: 'application/json',
      'X-Farm-ID': farmId,
    };
    const apiKey = cleanString(process.env.GREENREACH_API_KEY);
    if (apiKey) proxyHeaders['X-API-Key'] = apiKey;

    const response = await fetch(farmUrl, {
      method: 'GET',
      headers: proxyHeaders,
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      logger.error(`[ENV Proxy] Farm ${farmId} returned ${response.status}`);
      return res.status(502).json({
        error: 'Farm request failed',
        message: `Farm endpoint returned ${response.status}`,
        farmId,
        timestamp: new Date().toISOString(),
      });
    }

    const data = await response.json();
    data._proxy = {
      farmId,
      farmName: cleanString(targetFarm.name),
      accessPolicy,
      purpose: purpose || null,
      proxiedBy: resolveActor(req),
      proxiedAt: new Date().toISOString(),
    };

    return res.json(data);
  } catch (error) {
    if (error.name === 'AbortError') {
      logger.error('[ENV Proxy] Request timeout');
      return res.status(504).json({
        error: 'Gateway timeout',
        message: 'Farm endpoint did not respond in time',
        timestamp: new Date().toISOString(),
      });
    }

    logger.error('[ENV Proxy] Error:', error);
    return next(error);
  }
}

/**
 * GET /
 * Default endpoint: only returns telemetry for the caller's own farm
 * unless requester is privileged and explicitly provides farmId.
 * Query params:
 *   - farmId: optional (ignored for non-admin callers unless matches own farm)
 *   - hours: hours of history to include (default 24)
 */
router.get('/', async (req, res, next) => {
  try {
    const farmId = resolveTargetFarmIdForDefaultRoute(req);
    const hours = parseHours(req.query.hours);
    return fetchEnvSnapshot({ req, res, next, farmId, hours, accessPolicy: 'own-farm' });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message });
  }
});

/**
 * GET /network
 * Admin-only cross-farm telemetry endpoint.
 * Query params:
 *   - farmId: required target farm ID
 *   - hours: optional history window (default 24, max 168)
 *   - purpose: required audit reason for cross-farm access
 */
router.get('/network', async (req, res, next) => {
  if (!isPrivilegedRequest(req)) {
    return res.status(403).json({ error: 'Admin privileges required for network telemetry access' });
  }

  const farmId = cleanString(req.query.farmId || req.query.farm_id);
  if (!farmId) {
    return res.status(400).json({ error: 'farmId is required' });
  }

  const purpose = cleanString(req.query.purpose || req.query.reason);
  if (!purpose) {
    return res.status(400).json({ error: 'purpose is required for cross-farm telemetry access' });
  }

  logger.info('[ENV Proxy Audit] Cross-farm telemetry access', {
    actor: resolveActor(req),
    targetFarmId: farmId,
    purpose,
    sourceIp: req.ip,
    userAgent: req.get('user-agent') || 'unknown',
  });

  const hours = parseHours(req.query.hours);
  return fetchEnvSnapshot({ req, res, next, farmId, hours, accessPolicy: 'network-admin', purpose });
});

export default router;
