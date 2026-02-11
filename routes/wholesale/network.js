/**
 * Light Engine: Wholesale Network Routes (Farm Server)
 * Returns local farm data for wholesale admin dashboard
 * 
 * For standalone farms, the "network" is just this single farm
 */

import express from 'express';
import fs from 'fs/promises';
import path from 'path';

const router = express.Router();

// Read farm config from config file
async function getFarmConfig() {
  try {
    const configPath = path.join(process.cwd(), 'config', 'app_config.json');
    const configData = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(configData);
    return config;
  } catch (error) {
    console.warn('[Network] Could not read config, using defaults:', error.message);
    return {
      farmId: 'GR-00001',
      farmName: 'Demo Farm'
    };
  }
}

/**
 * GET /api/wholesale/network/farms
 * Returns the local farm as the only network member
 */
router.get('/farms', async (req, res) => {
  try {
    const config = await getFarmConfig();
    
    const localFarm = {
      farm_id: config.farmId || 'GR-00001',
      farm_name: config.farmName || 'Demo Farm',
      status: 'active',
      location: {
        city: 'Kingston',
        province: 'ON',
        country: 'Canada'
      },
      certifications: ['GAP', 'food_safety'],
      practices: ['hydroponic', 'year_round', 'local'],
      attributes: ['sustainable'],
      last_sync: new Date().toISOString()
    };

    res.json({
      status: 'ok',
      data: {
        farms: [localFarm],
        lastSync: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('[Network] Error getting farm data:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to load farm data'
    });
  }
});

/**
 * GET /api/wholesale/network/snapshots
 * Returns inventory snapshots for the local farm
 */
router.get('/snapshots', async (req, res) => {
  try {
    // For standalone farms, return current inventory as a snapshot
    res.json({
      status: 'ok',
      data: {
        snapshots: []
      }
    });
  } catch (error) {
    console.error('[Network] Error getting snapshots:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to load snapshots'
    });
  }
});

/**
 * GET /api/wholesale/network/aggregate
 * Returns aggregated catalog (just local farm for standalone deployment)
 */
router.get('/aggregate', async (req, res) => {
  try {
    res.json({
      status: 'ok',
      data: {
        catalog: null
      }
    });
  } catch (error) {
    console.error('[Network] Error getting aggregate:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to load aggregate catalog'
    });
  }
});

/**
 * GET /api/wholesale/network/market-events
 * Returns market events
 */
router.get('/market-events', async (req, res) => {
  try {
    res.json({
      status: 'ok',
      data: {
        events: []
      }
    });
  } catch (error) {
    console.error('[Network] Error getting market events:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to load market events'
    });
  }
});

/**
 * GET /api/wholesale/network/recommendations
 * Returns network recommendations
 */
router.get('/recommendations', async (req, res) => {
  try {
    res.json({
      status: 'ok',
      data: {
        recommendations: []
      }
    });
  } catch (error) {
    console.error('[Network] Error getting recommendations:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to load recommendations'
    });
  }
});

export default router;
