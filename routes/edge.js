/**
 * Farm Configuration Routes
 * 
 * API endpoints for managing farm server configuration and status
 */

import express from 'express';
import edgeConfig from '../lib/edge-config.js';
import syncQueue from '../lib/sync-queue.js';

const router = express.Router();

/**
 * GET /api/edge/status
 * Get current farm server mode status
 */
router.get('/status', (req, res) => {
  try {
    const config = edgeConfig.getAll();
    const queueStats = syncQueue.getStats();
    
    // Don't expose API key in response
    const safeConfig = { ...config };
    if (safeConfig.apiKey) {
      safeConfig.apiKey = '***' + safeConfig.apiKey.slice(-8);
    }

    res.json({
      mode: edgeConfig.isEdgeMode() ? 'edge' : 'cloud',
      registered: edgeConfig.isRegistered(),
      farmId: edgeConfig.getFarmId(),
      farmName: edgeConfig.getFarmName(),
      centralApiUrl: edgeConfig.getCentralApiUrl(),
      syncEnabled: edgeConfig.isSyncEnabled(),
      offlineMode: edgeConfig.isOfflineMode(),
      hardware: edgeConfig.getHardwareInfo(),
      queue: queueStats,
      config: safeConfig
    });
  } catch (error) {
    console.error('Error getting farm status:', error);
    res.status(500).json({ error: 'Failed to get farm status' });
  }
});

/**
 * GET /api/edge/config
 * Get farm configuration
 */
router.get('/config', (req, res) => {
  try {
    const config = edgeConfig.getAll();
    
    // Don't expose sensitive data
    const safeConfig = { ...config };
    if (safeConfig.apiKey) {
      safeConfig.apiKey = '***' + safeConfig.apiKey.slice(-8);
    }

    res.json({ config: safeConfig });
  } catch (error) {
    console.error('Error getting farm config:', error);
    res.status(500).json({ error: 'Failed to get farm config' });
  }
});

/**
 * PUT /api/edge/config
 * Update farm configuration
 */
router.put('/config', (req, res) => {
  try {
    const {
      farmName,
      centralApiUrl,
      syncInterval,
      heartbeatInterval,
      syncEnabled
    } = req.body;

    const updates = {};
    
    if (farmName) updates.farmName = farmName;
    if (centralApiUrl) updates.centralApiUrl = centralApiUrl;
    if (typeof syncInterval === 'number') updates.syncInterval = syncInterval;
    if (typeof heartbeatInterval === 'number') updates.heartbeatInterval = heartbeatInterval;
    if (typeof syncEnabled === 'boolean') updates.syncEnabled = syncEnabled;

    edgeConfig.updateFarm(updates);

    res.json({
      message: 'Configuration updated',
      config: edgeConfig.getAll()
    });
  } catch (error) {
    console.error('Error updating farm config:', error);
    res.status(500).json({ error: 'Failed to update farm config' });
  }
});

/**
 * POST /api/edge/register
 * Register farm with central server
 */
router.post('/register', async (req, res) => {
  try {
    const axios = await import('axios').then(m => m.default || m);
    const { farmName, email, centralApiUrl } = req.body;

    if (!farmName || !email) {
      return res.status(400).json({ error: 'Farm name and email required' });
    }

    const apiUrl = centralApiUrl || edgeConfig.getCentralApiUrl();
    const hardware = edgeConfig.getHardwareInfo();

    // Register with central server
    const response = await axios.post(
      `${apiUrl}/api/farms/register`,
      {
        name: farmName,
        email,
        hardware_model: hardware.model,
        version: hardware.version
      },
      {
        timeout: 30000
      }
    );

    const { farm_id, api_key } = response.data.farm;

    // Save registration locally
    edgeConfig.registerFarm(farm_id, farmName, api_key);

    res.json({
      message: 'Farm registered successfully',
      farmId: farm_id,
      farmName,
      registered: true
    });
  } catch (error) {
    console.error('Error registering farm:', error);
    res.status(500).json({ 
      error: 'Failed to register farm',
      details: error.response?.data || error.message
    });
  }
});

/**
 * POST /api/edge/mode
 * Switch between farm server and hosted mode
 */
router.post('/mode', (req, res) => {
  try {
    const { mode } = req.body;

    if (mode !== 'edge' && mode !== 'cloud') {
      return res.status(400).json({ error: 'Mode must be "edge" or "cloud"' });
    }

    edgeConfig.setEdgeMode(mode === 'edge');

    res.json({
      message: `Switched to ${mode} mode`,
      mode,
      restartRequired: true
    });
  } catch (error) {
    console.error('Error switching mode:', error);
    res.status(500).json({ error: 'Failed to switch mode' });
  }
});

/**
 * GET /api/edge/queue
 * Get sync queue details
 */
router.get('/queue', (req, res) => {
  try {
    const stats = syncQueue.getStats();
    res.json({ queue: stats });
  } catch (error) {
    console.error('Error getting queue:', error);
    res.status(500).json({ error: 'Failed to get queue' });
  }
});

/**
 * POST /api/edge/queue/clear
 * Clear sync queue
 */
router.post('/queue/clear', (req, res) => {
  try {
    syncQueue.clear();
    res.json({ message: 'Queue cleared' });
  } catch (error) {
    console.error('Error clearing queue:', error);
    res.status(500).json({ error: 'Failed to clear queue' });
  }
});

/**
 * POST /api/edge/sync/manual
 * Trigger manual sync
 */
router.post('/sync/manual', async (req, res) => {
  try {
    // Get sync service from global (set in server-charlie.js)
    const syncService = global.syncService;
    
    if (!syncService) {
      return res.status(503).json({ error: 'Sync service not available' });
    }

    if (!edgeConfig.isRegistered()) {
      return res.status(400).json({ error: 'Farm not registered' });
    }

    await syncService.manualSync();

    res.json({
      message: 'Manual sync triggered',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error triggering manual sync:', error);
    res.status(500).json({ error: 'Failed to trigger sync' });
  }
});

export default router;
