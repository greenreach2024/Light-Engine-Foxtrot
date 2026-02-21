/**
 * Device Discovery Proxy Routes
 * Proxies /discovery/devices requests to Edge farm devices
 */

import express from 'express';
import logger from '../utils/logger.js';
import { listNetworkFarms } from '../services/networkFarmsStore.js';

const router = express.Router();

function resolveFarmBaseUrl(farm) {
  return (farm?.api_url || farm?.endpoint || farm?.url || '').replace(/\/$/, '');
}

router.get('/', async (req, res, next) => {
  try {
    const { farmId } = req.query;
    const farms = await listNetworkFarms();

    let targetFarm = null;
    if (farmId) {
      targetFarm = farms.find(f => (f.farm_id || f.id) === farmId) || null;
      if (!targetFarm) {
        return res.status(404).json({
          error: 'Farm not found',
          message: `Farm ${farmId} not found in network`,
          timestamp: new Date().toISOString()
        });
      }
    } else {
      targetFarm = farms.find(f => !!resolveFarmBaseUrl(f)) || farms[0] || null;
    }

    const devFallbackUrl = (process.env.FARM_EDGE_URL || process.env.EDGE_FARM_URL || 'http://127.0.0.1:8091').replace(/\/$/, '');
    const baseUrl = resolveFarmBaseUrl(targetFarm) || devFallbackUrl;
    if (!baseUrl) {
      return res.status(503).json({
        error: 'No farm endpoint available',
        message: 'No eligible farm API URL found for discovery proxy',
        timestamp: new Date().toISOString()
      });
    }

    const url = `${baseUrl}/discovery/devices`;
    logger.info(`[Discovery Proxy] Fetching from ${url}`);

    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(12000)
    });

    if (!response.ok) {
      return res.status(502).json({
        error: 'Farm request failed',
        message: `Farm endpoint returned ${response.status}`,
        farmId: targetFarm?.farm_id || targetFarm?.id || null,
        timestamp: new Date().toISOString()
      });
    }

    const data = await response.json();
    data._proxy = {
      farmId: targetFarm?.farm_id || targetFarm?.id || null,
      farmName: targetFarm?.name || null,
      proxiedAt: new Date().toISOString(),
      source: baseUrl
    };

    return res.json(data);
  } catch (error) {
    if (error?.name === 'AbortError' || error?.name === 'TimeoutError' || error?.code === 'UND_ERR_CONNECT_TIMEOUT') {
      return res.status(504).json({
        error: 'Gateway timeout',
        message: 'Farm endpoint did not respond in time',
        timestamp: new Date().toISOString()
      });
    }

    logger.error('[Discovery Proxy] Error:', error);
    return res.status(502).json({
      error: 'Discovery proxy failure',
      message: error?.message || 'Failed to proxy discovery request',
      timestamp: new Date().toISOString()
    });
  }
});

export default router;
