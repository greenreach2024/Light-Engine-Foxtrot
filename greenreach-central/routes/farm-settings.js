/**
 * Farm Settings Sync Routes
 * Handles configuration sync between cloud and edge devices
 * 
 * Security: Uses farm API keys for authentication
 * Updates: Edge devices poll for changes every 30 seconds
 */

import express from 'express';
import crypto from 'crypto';
import logger from '../utils/logger.js';
import { query, isDatabaseAvailable } from '../config/database.js';

const router = express.Router();

// In-memory storage for farm settings (pending changes)
// In production, this would use a database
const farmSettingsStore = new Map();
const changeLog = [];

/**
 * Middleware: Authenticate farm device
 */
async function authenticateFarm(req, res, next) {
  try {
    const apiKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');
    const farmId = req.headers['x-farm-id'] || req.params.farmId;

    if (!apiKey) {
      return res.status(401).json({ error: 'API key required' });
    }

    if (!farmId) {
      return res.status(400).json({ error: 'Farm ID required' });
    }

    let isValid = false;

    if (await isDatabaseAvailable()) {
      const dbResult = await query(
        `SELECT farm_id FROM farms WHERE farm_id = $1 AND api_key = $2 LIMIT 1`,
        [farmId, apiKey]
      );
      isValid = dbResult.rows.length > 0;
    }

    if (!isValid) {
      const expected = process.env.GREENREACH_API_KEY;
      if (expected) {
        try {
          const providedBuf = Buffer.from(String(apiKey), 'utf8');
          const expectedBuf = Buffer.from(String(expected), 'utf8');
          if (providedBuf.length === expectedBuf.length && crypto.timingSafeEqual(providedBuf, expectedBuf)) {
            isValid = true;
          }
        } catch {
          isValid = false;
        }
      }
    }

    if (!isValid) {
      return res.status(401).json({ error: 'Invalid API key' });
    }

    req.farmId = farmId;
    req.authenticated = true;
    return next();
  } catch (error) {
    logger.error('[Farm Settings] Authentication failed:', error.message);
    return res.status(500).json({ error: 'Authentication failure' });
  }
}

/**
 * POST /api/farm-settings/:farmId/certifications
 * Update farm certifications from cloud (user portal)
 */
router.post('/:farmId/certifications', async (req, res, next) => {
  try {
    const { farmId } = req.params;
    const { certifications, practices } = req.body;
    const userId = req.user?.userId || req.headers['x-user-id'] || 'anonymous';
    
    logger.info(`[Farm Settings] User ${userId} updating certifications for farm ${farmId}`);
    
    // Store pending changes
    const farmSettings = farmSettingsStore.get(farmId) || {
      farmId,
      pendingChanges: {},
      lastUpdated: null,
      lastSynced: null
    };
    
    farmSettings.pendingChanges.certifications = {
      certifications: certifications || [],
      practices: practices || [],
      updatedAt: new Date().toISOString(),
      updatedBy: userId,
      synced: false
    };
    
    farmSettings.lastUpdated = new Date().toISOString();
    farmSettingsStore.set(farmId, farmSettings);
    
    // Log change for audit
    changeLog.push({
      farmId,
      changeType: 'certifications',
      userId,
      timestamp: new Date().toISOString(),
      data: { certifications, practices }
    });
    
    // Keep only last 1000 changes
    if (changeLog.length > 1000) {
      changeLog.shift();
    }
    
    res.json({
      success: true,
      message: 'Certifications queued for sync to edge device',
      farmId,
      pendingSync: true,
      estimatedSyncTime: '30 seconds'
    });
    
  } catch (error) {
    logger.error('[Farm Settings] Error updating certifications:', error);
    next(error);
  }
});

/**
 * GET /api/farm-settings/:farmId/pending
 * Get pending changes for edge device (pull model)
 * Called by edge device every 30 seconds
 */
router.get('/:farmId/pending', authenticateFarm, async (req, res, next) => {
  try {
    const { farmId } = req.params;
    const lastSynced = req.query.lastSynced;
    
    const farmSettings = farmSettingsStore.get(farmId);
    
    if (!farmSettings || !farmSettings.pendingChanges || Object.keys(farmSettings.pendingChanges).length === 0) {
      return res.json({
        hasPendingChanges: false,
        changes: {}
      });
    }
    
    // Return unsynced changes
    const unsyncedChanges = {};
    let hasChanges = false;
    
    for (const [key, value] of Object.entries(farmSettings.pendingChanges)) {
      if (!value.synced) {
        unsyncedChanges[key] = value;
        hasChanges = true;
      }
    }
    
    res.json({
      hasPendingChanges: hasChanges,
      changes: unsyncedChanges,
      lastUpdated: farmSettings.lastUpdated
    });
    
  } catch (error) {
    logger.error('[Farm Settings] Error fetching pending changes:', error);
    next(error);
  }
});

/**
 * POST /api/farm-settings/:farmId/ack
 * Acknowledge sync completion from edge device
 */
router.post('/:farmId/ack', authenticateFarm, async (req, res, next) => {
  try {
    const { farmId } = req.params;
    const { changeType, success, error } = req.body;
    
    const farmSettings = farmSettingsStore.get(farmId);
    
    if (!farmSettings) {
      return res.status(404).json({ error: 'No pending changes for farm' });
    }
    
    if (success && farmSettings.pendingChanges[changeType]) {
      // Mark as synced
      farmSettings.pendingChanges[changeType].synced = true;
      farmSettings.pendingChanges[changeType].syncedAt = new Date().toISOString();
      farmSettings.lastSynced = new Date().toISOString();
      
      logger.info(`[Farm Settings] ${changeType} synced successfully for farm ${farmId}`);
    } else if (error) {
      logger.error(`[Farm Settings] Sync failed for farm ${farmId}, ${changeType}:`, error);
    }
    
    farmSettingsStore.set(farmId, farmSettings);
    
    res.json({
      success: true,
      message: 'Sync acknowledgment received'
    });
    
  } catch (error) {
    logger.error('[Farm Settings] Error acknowledging sync:', error);
    next(error);
  }
});

/**
 * GET /api/farm-settings/:farmId/history
 * Get change history for a farm
 */
router.get('/:farmId/history', async (req, res, next) => {
  try {
    const { farmId } = req.params;
    const limit = parseInt(req.query.limit) || 50;
    
    const history = changeLog
      .filter(entry => entry.farmId === farmId)
      .slice(-limit)
      .reverse();
    
    res.json({
      farmId,
      changes: history,
      count: history.length
    });
    
  } catch (error) {
    logger.error('[Farm Settings] Error fetching history:', error);
    next(error);
  }
});

/**
 * POST /api/farm-settings/:farmId/notify-preferences
 * Update notification preferences from cloud
 */
router.post('/:farmId/notify-preferences', async (req, res, next) => {
  try {
    const { farmId } = req.params;
    const preferences = req.body;
    const userId = req.user?.userId || req.headers['x-user-id'] || 'anonymous';
    
    const farmSettings = farmSettingsStore.get(farmId) || {
      farmId,
      pendingChanges: {},
      lastUpdated: null,
      lastSynced: null
    };
    
    farmSettings.pendingChanges.notificationPreferences = {
      ...preferences,
      updatedAt: new Date().toISOString(),
      updatedBy: userId,
      synced: false
    };
    
    farmSettings.lastUpdated = new Date().toISOString();
    farmSettingsStore.set(farmId, farmSettings);
    
    changeLog.push({
      farmId,
      changeType: 'notification_preferences',
      userId,
      timestamp: new Date().toISOString(),
      data: preferences
    });
    
    res.json({
      success: true,
      message: 'Notification preferences queued for sync',
      pendingSync: true
    });
    
  } catch (error) {
    logger.error('[Farm Settings] Error updating notification preferences:', error);
    next(error);
  }
});

/**
 * POST /api/farm-settings/:farmId/display-preferences
 * Update display preferences from cloud
 */
router.post('/:farmId/display-preferences', async (req, res, next) => {
  try {
    const { farmId } = req.params;
    const preferences = req.body;
    const userId = req.user?.userId || req.headers['x-user-id'] || 'anonymous';
    
    const farmSettings = farmSettingsStore.get(farmId) || {
      farmId,
      pendingChanges: {},
      lastUpdated: null,
      lastSynced: null
    };
    
    farmSettings.pendingChanges.displayPreferences = {
      ...preferences,
      updatedAt: new Date().toISOString(),
      updatedBy: userId,
      synced: false
    };
    
    farmSettings.lastUpdated = new Date().toISOString();
    farmSettingsStore.set(farmId, farmSettings);
    
    changeLog.push({
      farmId,
      changeType: 'display_preferences',
      userId,
      timestamp: new Date().toISOString(),
      data: preferences
    });
    
    res.json({
      success: true,
      message: 'Display preferences queued for sync',
      pendingSync: true
    });
    
  } catch (error) {
    logger.error('[Farm Settings] Error updating display preferences:', error);
    next(error);
  }
});

export default router;
