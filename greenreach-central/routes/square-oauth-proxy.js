/**
 * GreenReach Central - Square OAuth Proxy
 * 
 * Proxies Square OAuth requests to Light Engine farms.
 * Central doesn't store farm tokens - it calls Light Engine APIs to retrieve them.
 * This maintains the existing security model where tokens live on farm servers.
 */

import express from 'express';
import { listNetworkFarms } from '../services/networkFarmsStore.js';

const router = express.Router();

/**
 * POST /api/square-proxy/authorize
 * 
 * Generate Square OAuth URL for a farm
 * Proxies request to farm's Light Engine server
 */
router.post('/authorize', async (req, res) => {
  try {
    const { farm_id, farm_name } = req.body;
    
    if (!farm_id || !farm_name) {
      return res.status(400).json({
        status: 'error',
        message: 'farm_id and farm_name are required'
      });
    }
    
    // Get farm's base URL from network registry
    const farms = await listNetworkFarms();
    const farm = farms.find(f => String(f.farm_id) === String(farm_id));
    
    if (!farm || !farm.base_url) {
      return res.status(404).json({
        status: 'error',
        message: `Farm ${farm_id} not found in network registry`
      });
    }
    
    // Proxy request to farm's Light Engine
    const farmResponse = await fetch(
      new URL('/api/wholesale/oauth/square/authorize', farm.base_url).toString(),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ farm_id, farm_name })
      }
    );
    
    const result = await farmResponse.json();
    
    if (!farmResponse.ok) {
      return res.status(farmResponse.status).json(result);
    }
    
    return res.json(result);
    
  } catch (error) {
    console.error('[Square Proxy] Authorize error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Failed to generate OAuth URL',
      error: error.message
    });
  }
});

/**
 * GET /api/square-proxy/status/:farmId
 * 
 * Check if farm has Square connected
 * Proxies request to farm's Light Engine server
 */
router.get('/status/:farmId', async (req, res) => {
  try {
    const { farmId } = req.params;
    
    // Get farm's base URL
    const farms = await listNetworkFarms();
    const farm = farms.find(f => String(f.farm_id) === String(farmId));
    
    if (!farm || !farm.base_url) {
      return res.status(404).json({
        status: 'error',
        message: `Farm ${farmId} not found in network registry`
      });
    }
    
    // Proxy request to farm's Light Engine
    const farmResponse = await fetch(
      new URL('/api/wholesale/oauth/square/status', farm.base_url).toString()
    );
    
    const result = await farmResponse.json();
    
    return res.json(result);
    
  } catch (error) {
    console.error('[Square Proxy] Status error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Failed to check Square status',
      error: error.message
    });
  }
});

/**
 * POST /api/square-proxy/disconnect/:farmId
 * 
 * Disconnect farm's Square account
 * Proxies request to farm's Light Engine server
 */
router.post('/disconnect/:farmId', async (req, res) => {
  try {
    const { farmId } = req.params;
    
    // Get farm's base URL
    const farms = await listNetworkFarms();
    const farm = farms.find(f => String(f.farm_id) === String(farmId));
    
    if (!farm || !farm.base_url) {
      return res.status(404).json({
        status: 'error',
        message: `Farm ${farmId} not found in network registry`
      });
    }
    
    // Proxy request to farm's Light Engine
    const farmResponse = await fetch(
      new URL(`/api/wholesale/oauth/square/disconnect/${farmId}`, farm.base_url).toString(),
      {
        method: 'DELETE'
      }
    );
    
    const result = await farmResponse.json();
    
    return res.json(result);
    
  } catch (error) {
    console.error('[Square Proxy] Disconnect error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Failed to disconnect Square account',
      error: error.message
    });
  }
});

export default router;
