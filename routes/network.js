/**
 * GreenReach Central - Network API Routes
 * 
 * Provides farm network data for the GreenReach Central Admin dashboard.
 * These endpoints query the farms database to provide network-wide insights.
 */

import express from 'express';
import { initDatabase } from '../lib/database.js';

const router = express.Router();

/**
 * GET /api/network/dashboard
 * Returns network-wide dashboard statistics
 */
router.get('/dashboard', async (req, res) => {
  try {
    const db = await initDatabase();
    
    // Get total farms count
    const farmsResult = await db.get('SELECT COUNT(*) as total FROM farms');
    const totalFarms = farmsResult?.total || 0;
    
    // Get active farms (those with recent activity)
    const activeFarmsResult = await db.get(
      `SELECT COUNT(*) as active FROM farms 
       WHERE status = 'active' OR status IS NULL`
    );
    const activeFarms = activeFarmsResult?.active || 0;
    
    // Get pending farms
    const pendingFarmsResult = await db.get(
      `SELECT COUNT(*) as pending FROM farms 
       WHERE status = 'pending'`
    );
    const pendingFarms = pendingFarmsResult?.pending || 0;
    
    res.json({
      status: 'ok',
      data: {
        totalFarms,
        activeFarms,
        pendingFarms,
        networkHealth: activeFarms > 0 ? 'healthy' : 'warning',
        lastUpdated: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('[Network Dashboard] Error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to load network dashboard',
      error: error.message
    });
  }
});

/**
 * GET /api/network/farms/list
 * Returns list of all farms in the network
 */
router.get('/farms/list', async (req, res) => {
  try {
    const db = await initDatabase();
    
    const farms = await db.all(`
      SELECT 
        farm_id,
        farm_name,
        location_city,
        location_state,
        status,
        square_payment_id,
        api_key,
        created_at,
        updated_at
      FROM farms
      ORDER BY created_at DESC
    `);
    
    res.json({
      status: 'ok',
      data: {
        farms: farms || [],
        count: farms?.length || 0,
        lastSync: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('[Network Farms List] Error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to load farms list',
      error: error.message
    });
  }
});

/**
 * GET /api/network/farms/:farmId
 * Returns detailed information about a specific farm
 */
router.get('/farms/:farmId', async (req, res) => {
  try {
    const { farmId } = req.params;
    
    if (!farmId) {
      return res.status(400).json({
        status: 'error',
        message: 'Farm ID is required'
      });
    }
    
    const db = await initDatabase();
    
    const farm = await db.get(`
      SELECT 
        farm_id,
        farm_name,
        location_city,
        location_state,
        location_country,
        contact_email,
        contact_phone,
        status,
        square_payment_id,
        square_location_id,
        api_key,
        api_url,
        created_at,
        updated_at
      FROM farms
      WHERE farm_id = ?
    `, [farmId]);
    
    if (!farm) {
      return res.status(404).json({
        status: 'error',
        message: `Farm not found: ${farmId}`
      });
    }
    
    // Format the response with defaults
    const response = {
      farm_id: farm.farm_id,
      farm_name: farm.farm_name || 'Unnamed Farm',
      location: {
        city: farm.location_city || 'Unknown',
        state: farm.location_state || '',
        country: farm.location_country || 'Unknown'
      },
      contact: {
        email: farm.contact_email || '',
        phone: farm.contact_phone || ''
      },
      status: farm.status || 'active',
      capacity: {
        trays: 0,
        plants: 0
      },
      certifications: [],
      performance: {
        revenue: 0,
        qa_score: 0,
        active_batches: 0
      },
      api_url: farm.api_url || null,
      created_at: farm.created_at,
      updated_at: farm.updated_at
    };
    
    res.json({
      status: 'ok',
      data: response
    });
  } catch (error) {
    console.error('[Network Farm Details] Error for farm', req.params.farmId, ':', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to load farm details',
      error: error.message
    });
  }
});

/**
 * GET /api/network/comparative-analytics
 * Returns comparative analytics across farms
 */
router.get('/comparative-analytics', async (req, res) => {
  try {
    const { metric = 'revenue', days = 30 } = req.query;
    
    // Return mock data for now - would query actual analytics in production
    res.json({
      status: 'ok',
      data: {
        metric,
        days: parseInt(days),
        farms: [],
        message: 'Analytics data not yet available'
      }
    });
  } catch (error) {
    console.error('[Network Analytics] Error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to load analytics',
      error: error.message
    });
  }
});

/**
 * GET /api/network/trends
 * Returns network-wide trends
 */
router.get('/trends', async (req, res) => {
  try {
    const { days = 30 } = req.query;
    
    // Return mock data for now
    res.json({
      status: 'ok',
      data: {
        trends: [],
        period_days: parseInt(days),
        message: 'Trends data not yet available'
      }
    });
  } catch (error) {
    console.error('[Network Trends] Error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to load trends',
      error: error.message
    });
  }
});

/**
 * GET /api/network/alerts
 * Returns network-wide alerts and notifications
 */
router.get('/alerts', async (req, res) => {
  try {
    // Return empty alerts for now
    res.json({
      status: 'ok',
      data: {
        alerts: [],
        count: 0
      }
    });
  } catch (error) {
    console.error('[Network Alerts] Error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to load alerts',
      error: error.message
    });
  }
});

export default router;
