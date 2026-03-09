/**
 * Environmental Data Proxy Routes
 * Proxies /env requests to Edge farm devices
 */

import express from 'express';
import logger from '../utils/logger.js';
import { listNetworkFarms } from '../services/networkFarmsStore.js';

const router = express.Router();

/**
 * GET /env
 * Proxy environmental data from Edge device
 * Query params:
 *   - farmId: specific farm to query (defaults to first farm if only one exists)
 *   - hours: hours of history to include (default 24)
 */
router.get('/', async (req, res, next) => {
  try {
    const { farmId, hours = 24 } = req.query;
    
    // Get network farms
    const farms = await listNetworkFarms();
    
    if (farms.length === 0) {
      return res.status(503).json({
        error: 'No farms available',
        message: 'No Edge devices registered in network',
        timestamp: new Date().toISOString()
      });
    }
    
    // Select target farm
    let targetFarm = null;
    if (farmId) {
      targetFarm = farms.find(f => f.farm_id === farmId || f.id === farmId);
      if (!targetFarm) {
        return res.status(404).json({
          error: 'Farm not found',
          message: `Farm ${farmId} not found in network`,
          timestamp: new Date().toISOString()
        });
      }
    } else {
      // Default to first farm if only one exists
      if (farms.length === 1) {
        targetFarm = farms[0];
      } else {
        return res.status(400).json({
          error: 'Multiple farms available',
          message: 'Please specify farmId query parameter',
          availableFarms: farms.map(f => ({ id: f.farm_id || f.id, name: f.name })),
          timestamp: new Date().toISOString()
        });
      }
    }
    
    // Validate farm has endpoint (check api_url, base_url, url, or endpoint)
    const farmEndpoint = targetFarm.api_url || targetFarm.base_url || targetFarm.url || targetFarm.endpoint;
    if (!farmEndpoint) {
      return res.status(500).json({
        error: 'Farm endpoint not configured',
        message: `Farm ${targetFarm.farm_id || targetFarm.id} does not have an endpoint URL`,
        timestamp: new Date().toISOString()
      });
    }
    
    // Proxy request to farm endpoint
    const farmUrl = `${farmEndpoint}/env?hours=${hours}`;
    logger.info(`[ENV Proxy] Fetching from ${farmUrl}`);
    
    const response = await fetch(farmUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      },
      signal: AbortSignal.timeout(10000) // 10 second timeout
    });
    
    if (!response.ok) {
      logger.error(`[ENV Proxy] Farm ${targetFarm.farm_id || targetFarm.id} returned ${response.status}`);
      return res.status(502).json({
        error: 'Farm request failed',
        message: `Farm endpoint returned ${response.status}`,
        farmId: targetFarm.farm_id || targetFarm.id,
        timestamp: new Date().toISOString()
      });
    }
    
    const data = await response.json();
    
    // Add metadata about proxy
    data._proxy = {
      farmId: targetFarm.farm_id || targetFarm.id,
      farmName: targetFarm.name,
      proxiedAt: new Date().toISOString()
    };
    
    res.json(data);
    
  } catch (error) {
    if (error.name === 'AbortError') {
      logger.error('[ENV Proxy] Request timeout');
      return res.status(504).json({
        error: 'Gateway timeout',
        message: 'Farm endpoint did not respond in time',
        timestamp: new Date().toISOString()
      });
    }
    
    logger.error('[ENV Proxy] Error:', error);
    next(error);
  }
});

export default router;
