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
    
      // Shape data to match frontend expectations
      const dashboard = {
        network_health: {
          total_farms: totalFarms,
          online: activeFarms,
          warning: 0,
          offline: Math.max(totalFarms - activeFarms, 0)
        },
        total_production_7_days: 0,
        daily_avg_production: 0,
        top_producers_7_days: [
          { farm_id: 'demo', farm_name: 'Network', total_production: 0 }
        ],
        top_performers_qa: [
          { farm_id: 'demo', farm_name: 'Network', avg_qa_score: 95 }
        ],
        total_capacity: {
          utilization_percentage: 0,
          cells_occupied: 0,
          total_capacity: 0,
          active_batches: 0
        }
      };

      res.json({
        ok: true,
        dashboard
      });
  } catch (error) {
    console.error('[Network Dashboard] Error:', error);
    res.status(500).json({
        ok: false,
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
          name,
          status,
          plan_type,
          contact_name,
          email,
          phone,
          created_at,
          updated_at
        FROM farms
        ORDER BY created_at DESC
      `);
    
      const normalized = (farms || []).map(farm => ({
        farm_id: farm.farm_id,
        farm_name: farm.name,
        location: 'Unknown',
        farm_type: farm.plan_type || 'Indoor',
        status: (farm.status || 'active').toUpperCase() === 'ACTIVE' ? 'ONLINE' : 'OFFLINE',
        metrics_7_days: {
          total_production: 0,
          avg_qa_score: 95,
          avg_capacity_utilization: 70,
          total_active_batches: 0
        }
      }));

      res.json({
        ok: true,
        farms: normalized,
        count: normalized.length,
        lastSync: new Date().toISOString()
      });
  } catch (error) {
    console.error('[Network Farms List] Error:', error);
    res.status(500).json({
        ok: false,
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
          ok: false,
          message: 'Farm ID is required'
        });
    }
    
    const db = await initDatabase();
    
      const farm = await db.get(`
        SELECT 
          farm_id,
          name,
          status,
          plan_type,
          contact_name,
          email,
          phone,
          created_at,
          updated_at
        FROM farms
        WHERE farm_id = ?
      `, [farmId]);
    
      if (!farm) {
        return res.status(404).json({
          ok: false,
          message: `Farm not found: ${farmId}`
        });
    }
    
    // Format the response with defaults
      const farmData = {
        farm_id: farm.farm_id,
        farm_name: farm.name || 'Unnamed Farm',
        location: 'Unknown',
        farm_type: farm.plan_type || 'Indoor',
        status: (farm.status || 'active').toUpperCase() === 'ACTIVE' ? 'ONLINE' : 'OFFLINE',
        operator_name: farm.contact_name || 'Operator',
        contact: {
          email: farm.email || '',
          phone: farm.phone || ''
        },
        capacity: 0,
        created_at: farm.created_at,
        updated_at: farm.updated_at
      };

      const summary = {
        total_production: 0,
        total_revenue: 0,
        avg_qa_score: 95,
        active_batches: 0,
        orders_fulfilled: 0
      };

      res.json({
        ok: true,
        farm: farmData,
        summary,
        data: farmData
      });
  } catch (error) {
    console.error('[Network Farm Details] Error for farm', req.params.farmId, ':', error);
      res.status(500).json({
        ok: false,
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
        ok: true,
        comparison: [],
        metric,
        days: parseInt(days)
      });
  } catch (error) {
    console.error('[Network Analytics] Error:', error);
      res.status(500).json({
        ok: false,
        message: 'Failed to load analytics',
        error: error.message
      });
  }
});

/**
 * GET /api/network/trends
 * Returns network-wide trends — proxied from GreenReach Central
 * Phase 2 Task 2.11: Populate network trends endpoint
 */
router.get('/trends', async (req, res) => {
  try {
    const { days = 30, period } = req.query;
    const centralUrl = process.env.GREENREACH_CENTRAL_URL
      || process.env.CENTRAL_URL
      || (process.env.NODE_ENV === 'production' ? null : 'http://127.0.0.1:3100');

    if (!centralUrl) {
      return res.json({ ok: true, trends: [], period_days: parseInt(days), source: 'none' });
    }

    const qs = period ? `?period=${period}` : `?period=${days}d`;
    const upstream = await fetch(`${centralUrl}/api/network/trends${qs}`, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(8000)
    });

    if (!upstream.ok) {
      console.warn(`[Network Trends] Central returned ${upstream.status}`);
      return res.json({ ok: true, trends: [], period_days: parseInt(days), source: 'central_error' });
    }

    const data = await upstream.json();
    res.json({ ok: true, ...data, source: 'central' });
  } catch (error) {
    console.error('[Network Trends] Error proxying from Central:', error.message);
    res.json({
      ok: true,
      trends: [],
      period_days: parseInt(req.query.days || 30),
      source: 'proxy_error'
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
        ok: true,
        alerts: [],
        count: 0
      });
  } catch (error) {
    console.error('[Network Alerts] Error:', error);
      res.status(500).json({
        ok: false,
        message: 'Failed to load alerts',
        error: error.message
      });
  }
});

export default router;
