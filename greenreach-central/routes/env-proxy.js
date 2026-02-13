/**
 * Environmental Data Proxy Routes
 * Proxies /env requests to Edge farm devices
 */

import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';
import { listNetworkFarms } from '../services/networkFarmsStore.js';

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveDefaultFarmId() {
  try {
    const farmPath = path.join(__dirname, '..', 'public', 'data', 'farm.json');
    if (!fs.existsSync(farmPath)) return null;
    const raw = fs.readFileSync(farmPath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed?.farmId || parsed?.farm_id || null;
  } catch {
    return null;
  }
}

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
      // Auto-select default farm to support legacy dashboard requests without farmId
      if (farms.length === 1) {
        targetFarm = farms[0];
      } else {
        const defaultFarmId = resolveDefaultFarmId() || process.env.DEFAULT_FARM_ID || 'FARM-TEST-WIZARD-001';
        targetFarm = farms.find(f => (f.farm_id || f.id) === defaultFarmId) || farms[0];
      }
    }
    
    // Validate farm has endpoint
    if (!targetFarm.endpoint) {
      return res.status(500).json({
        error: 'Farm endpoint not configured',
        message: `Farm ${targetFarm.farm_id || targetFarm.id} does not have an endpoint URL`,
        timestamp: new Date().toISOString()
      });
    }
    
    // Proxy request to farm endpoint
    const farmUrl = `${targetFarm.endpoint}/env?hours=${hours}`;
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
