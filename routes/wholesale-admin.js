/**
 * Light Engine: Wholesale Admin Routes
 * Farm API key management and wholesale operations monitoring
 * 
 * Protected by admin authentication (Task #14, currently open for demo)
 */

import express from 'express';
import {
  generateApiKey,
  rotateApiKey,
  suspendFarm,
  reactivateFarm,
  listApiKeys
} from '../lib/wholesale-auth.js';

const router = express.Router();

/**
 * GET /api/wholesale/admin/keys
 * List all registered farm API keys
 * 
 * Response: {
 *   keys: [{
 *     farm_id: string,
 *     farm_name: string,
 *     status: "active"|"suspended",
 *     created_at: ISO timestamp,
 *     last_rotated: ISO timestamp,
 *     last_used: ISO timestamp
 *   }]
 * }
 */
router.get('/keys', (req, res) => {
  try {
    const keys = listApiKeys();
    
    res.json({
      ok: true,
      keys,
      total: keys.length,
      active: keys.filter(k => k.status === 'active').length
    });
  } catch (error) {
    console.error('[Wholesale Admin] Error listing keys:', error);
    res.status(500).json({
      ok: false,
      error: 'server_error',
      message: error.message
    });
  }
});

/**
 * POST /api/wholesale/admin/keys
 * Generate new API key for farm
 * 
 * Body: {
 *   farm_id: string,
 *   farm_name: string
 * }
 * 
 * Response: {
 *   farm_id: string,
 *   api_key: string (ONLY RETURNED ONCE)
 * }
 */
router.post('/keys', express.json(), (req, res) => {
  try {
    const { farm_id, farm_name } = req.body;
    
    if (!farm_id || !farm_name) {
      return res.status(400).json({
        ok: false,
        error: 'validation_error',
        message: 'farm_id and farm_name are required'
      });
    }
    
    const apiKey = generateApiKey(farm_id, farm_name);
    
    res.status(201).json({
      ok: true,
      farm_id,
      api_key: apiKey,
      notice: 'IMPORTANT: Save this API key securely. It will not be shown again.'
    });
  } catch (error) {
    console.error('[Wholesale Admin] Error generating key:', error);
    res.status(500).json({
      ok: false,
      error: 'server_error',
      message: error.message
    });
  }
});

/**
 * POST /api/wholesale/admin/keys/:farm_id/rotate
 * Rotate API key for farm (invalidates old key)
 * 
 * Response: {
 *   farm_id: string,
 *   api_key: string (new key)
 * }
 */
router.post('/keys/:farm_id/rotate', (req, res) => {
  try {
    const { farm_id } = req.params;
    
    const newApiKey = rotateApiKey(farm_id);
    
    res.json({
      ok: true,
      farm_id,
      api_key: newApiKey,
      rotated_at: new Date().toISOString(),
      notice: 'IMPORTANT: Save this new API key securely. The old key is now invalid.'
    });
  } catch (error) {
    console.error('[Wholesale Admin] Error rotating key:', error);
    res.status(404).json({
      ok: false,
      error: 'not_found',
      message: error.message
    });
  }
});

/**
 * POST /api/wholesale/admin/keys/:farm_id/suspend
 * Suspend farm API access
 */
router.post('/keys/:farm_id/suspend', (req, res) => {
  try {
    const { farm_id } = req.params;
    
    suspendFarm(farm_id);
    
    res.json({
      ok: true,
      farm_id,
      status: 'suspended',
      suspended_at: new Date().toISOString()
    });
  } catch (error) {
    console.error('[Wholesale Admin] Error suspending farm:', error);
    res.status(404).json({
      ok: false,
      error: 'not_found',
      message: error.message
    });
  }
});

/**
 * POST /api/wholesale/admin/keys/:farm_id/reactivate
 * Reactivate suspended farm
 */
router.post('/keys/:farm_id/reactivate', (req, res) => {
  try {
    const { farm_id } = req.params;
    
    reactivateFarm(farm_id);
    
    res.json({
      ok: true,
      farm_id,
      status: 'active',
      reactivated_at: new Date().toISOString()
    });
  } catch (error) {
    console.error('[Wholesale Admin] Error reactivating farm:', error);
    res.status(404).json({
      ok: false,
      error: 'not_found',
      message: error.message
    });
  }
});

export default router;
