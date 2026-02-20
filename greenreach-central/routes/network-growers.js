/**
 * Network & Grower Management Routes
 * Backend for GR-central-admin.html network management sections
 *
 * Endpoints:
 *   GET /api/network/dashboard            - Network overview dashboard
 *   GET /api/network/farms/list           - List network farms
 *   GET /api/network/farms/:farmId        - Single farm detail
 *   GET /api/network/comparative-analytics - Cross-farm analytics
 *   GET /api/network/trends               - Network trend data
 *   GET /api/network/alerts               - Network alerts
 *   GET /api/growers/dashboard            - Grower management dashboard
 *   GET /api/growers/list                 - List all growers
 *   GET /api/farms/list                   - Alias for farm listing
 *   GET /api/contracts/list               - Contract listing
 *   GET /api/leaderboard                  - Farm leaderboard
 *   GET /api/performance/:growerId        - Grower performance
 *   GET /api/invitations/list             - Pending invitations
 */
import { Router } from 'express';
import { query, isDatabaseAvailable } from '../config/database.js';

const router = Router();

// ─── Network Dashboard ────────────────────────────────────
router.get('/network/dashboard', async (req, res) => {
  try {
    let farmCount = 0, activeFarms = 0;
    if (await isDatabaseAvailable()) {
      const result = await query('SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status = \'active\') as active FROM farms');
      farmCount = parseInt(result.rows[0].total);
      activeFarms = parseInt(result.rows[0].active);
    }
    res.json({
      success: true,
      dashboard: {
        totalFarms: farmCount,
        activeFarms,
        offlineFarms: farmCount - activeFarms,
        networkHealth: activeFarms > 0 ? 'healthy' : 'no_farms',
        totalProductionCapacity: 0,
        alerts: [],
        recentActivity: [],
      }
    });
  } catch (error) {
    console.error('[Network] Dashboard error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── Network Farms List ────────────────────────────────────
router.get('/network/farms/list', async (req, res) => {
  try {
    let farms = [];
    if (await isDatabaseAvailable()) {
      const result = await query(
        `SELECT farm_id, name, status, email, api_url, last_heartbeat, metadata, created_at
         FROM farms ORDER BY name`
      );
      farms = result.rows.map(f => ({
        farmId: f.farm_id,
        name: f.name,
        status: f.status,
        email: f.email,
        apiUrl: f.api_url,
        lastHeartbeat: f.last_heartbeat,
        metadata: f.metadata || {},
        createdAt: f.created_at,
      }));
    }
    res.json({ success: true, farms, total: farms.length });
  } catch (error) {
    console.error('[Network] Farm list error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── Network Farm Detail ───────────────────────────────────
router.get('/network/farms/:farmId', async (req, res) => {
  try {
    const { farmId } = req.params;
    if (await isDatabaseAvailable()) {
      const result = await query(
        'SELECT farm_id, name, status, email, api_url, last_heartbeat, metadata, settings, created_at FROM farms WHERE farm_id = $1',
        [farmId]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Farm not found' });
      }
      const f = result.rows[0];
      // Also fetch farm_data summary
      const dataResult = await query(
        "SELECT data_type, octet_length(data::text) as size_bytes FROM farm_data WHERE farm_id = $1",
        [farmId]
      );
      return res.json({
        success: true,
        farm: {
          farmId: f.farm_id, name: f.name, status: f.status, email: f.email,
          apiUrl: f.api_url, lastHeartbeat: f.last_heartbeat,
          metadata: f.metadata, settings: f.settings, createdAt: f.created_at,
          dataSets: dataResult.rows.map(d => ({ type: d.data_type, sizeBytes: parseInt(d.size_bytes) })),
        }
      });
    }
    res.status(404).json({ success: false, error: 'Database not available' });
  } catch (error) {
    console.error('[Network] Farm detail error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── Comparative Analytics ─────────────────────────────────
router.get('/network/comparative-analytics', async (req, res) => {
  res.json({
    success: true,
    analytics: {
      farms: [],
      metrics: ['yield', 'energy', 'water', 'revenue'],
      period: req.query.period || '30d',
      data: [],
    }
  });
});

// ─── Network Trends ────────────────────────────────────────
router.get('/network/trends', async (req, res) => {
  res.json({
    success: true,
    trends: {
      period: req.query.period || '30d',
      networkGrowth: [],
      productionTrend: [],
      revenueTrend: [],
    }
  });
});

// ─── Network Alerts ────────────────────────────────────────
router.get('/network/alerts', async (req, res) => {
  res.json({ success: true, alerts: [], total: 0 });
});

// ─── Grower Dashboard ──────────────────────────────────────
router.get('/growers/dashboard', async (req, res) => {
  try {
    let growerCount = 0;
    if (await isDatabaseAvailable()) {
      const result = await query("SELECT COUNT(*) as cnt FROM farms WHERE status = 'active'");
      growerCount = parseInt(result.rows[0].cnt);
    }
    res.json({
      success: true,
      dashboard: {
        totalGrowers: growerCount,
        activeGrowers: growerCount,
        pendingApplications: 0,
        averageRating: 0,
        topPerformers: [],
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── Grower List ───────────────────────────────────────────
router.get('/growers/list', async (req, res) => {
  try {
    let growers = [];
    if (await isDatabaseAvailable()) {
      const result = await query(
        "SELECT farm_id, name, status, email, created_at FROM farms WHERE status = 'active' ORDER BY name"
      );
      growers = result.rows.map(f => ({
        id: f.farm_id, name: f.name, status: f.status,
        email: f.email, joinedAt: f.created_at, rating: 0, totalOrders: 0,
      }));
    }
    res.json({ success: true, growers, total: growers.length });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── Farms List (alias) ───────────────────────────────────
router.get('/farms/list', async (req, res) => {
  // Redirect to network farms list handler
  try {
    let farms = [];
    if (await isDatabaseAvailable()) {
      const result = await query('SELECT farm_id, name, status, email, api_url, created_at FROM farms ORDER BY name');
      farms = result.rows.map(f => ({
        farmId: f.farm_id, name: f.name, status: f.status,
        email: f.email, apiUrl: f.api_url, createdAt: f.created_at,
      }));
    }
    res.json({ success: true, farms, total: farms.length });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── Contracts ─────────────────────────────────────────────
router.get('/contracts/list', (req, res) => {
  res.json({ success: true, contracts: [], total: 0, message: 'Contract management not yet enabled' });
});

// ─── Leaderboard ───────────────────────────────────────────
router.get('/leaderboard', async (req, res) => {
  try {
    let entries = [];
    if (await isDatabaseAvailable()) {
      const result = await query(
        "SELECT farm_id, name FROM farms WHERE status = 'active' ORDER BY name LIMIT 20"
      );
      entries = result.rows.map((f, i) => ({
        rank: i + 1, farmId: f.farm_id, name: f.name, score: 0,
      }));
    }
    res.json({ success: true, leaderboard: entries });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── Performance ───────────────────────────────────────────
router.get('/performance/:growerId', (req, res) => {
  res.json({
    success: true,
    growerId: req.params.growerId,
    performance: {
      overallRating: 0,
      metrics: { yield: 0, quality: 0, reliability: 0, sustainability: 0 },
      recentOrders: [],
      trends: [],
    }
  });
});

// ─── Invitations ───────────────────────────────────────────
router.get('/invitations/list', (req, res) => {
  res.json({ success: true, invitations: [], total: 0 });
});

export default router;
