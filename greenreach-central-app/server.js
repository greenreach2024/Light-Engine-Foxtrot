/**
 * GreenReach Central - Farm Monitoring & Provisioning Dashboard
 * Monitors all deployed Light Engine instances (cloud + edge)
 * Provides real-time status, analytics, and admin controls
 */

import 'dotenv/config';
import express from 'express';
import expressWs from 'express-ws';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
expressWs(app);

const PORT = process.env.PORT || 3100;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'dev-admin-token-change-in-production';

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/greenreach_central',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Test database connection
pool.query('SELECT NOW()').then(() => {
  console.log('[Database] Connected to PostgreSQL');
}).catch(err => {
  console.error('[Database] Connection failed:', err.message);
  console.error('[Database] Continuing without database (limited functionality)');
});

// Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "ws:", "wss:"],
    },
  },
}));
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(morgan('combined'));

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

// Admin auth middleware
function requireAdmin(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.query.token;
  
  if (!token || token !== ADMIN_TOKEN) {
    return res.status(401).json({
      ok: false,
      error: 'Unauthorized',
      message: 'Valid admin token required'
    });
  }
  
  next();
}

// Import provisioning routes
import provisioningRoutes from './routes/provisioning.js';

// Make pool available to routes
app.set('pool', pool);

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// API routes
app.use('/api/provisioning', requireAdmin, provisioningRoutes);

/**
 * Health check
 */
app.get('/health', (req, res) => {
  res.json({
    ok: true,
    service: 'GreenReach Central',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

/**
 * GET /api/farms/status
 * Real-time status of all farms
 */
app.get('/api/farms/status', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        f.id,
        f.subdomain,
        f.name,
        f.contact_email,
        f.tier,
        f.deployment_mode,
        f.active,
        f.created_at,
        f.last_seen_at,
        l.id as license_id,
        l.hardware_fingerprint,
        l.expires_at as license_expires_at,
        l.grace_period_ends_at,
        l.status as license_status,
        l.update_channel,
        l.current_version,
        l.last_update_check_at,
        (SELECT COUNT(*) FROM inventory WHERE tenant_id = f.id AND available_quantity > 0) as inventory_count,
        (SELECT COUNT(*) FROM wholesale_orders WHERE farm_id = f.id AND status IN ('pending', 'accepted')) as pending_orders,
        (SELECT SUM(total_amount) FROM wholesale_orders WHERE farm_id = f.id AND status = 'completed' AND created_at > NOW() - INTERVAL '30 days') as revenue_30d
      FROM farms f
      LEFT JOIN licenses l ON l.farm_id = f.id
      ORDER BY f.last_seen_at DESC NULLS LAST, f.created_at DESC
    `);
    
    const farms = result.rows.map(row => ({
      id: row.id,
      subdomain: row.subdomain,
      name: row.name,
      email: row.contact_email,
      tier: row.tier,
      deploymentMode: row.deployment_mode,
      active: row.active,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
      status: getStatus(row.last_seen_at),
      license: row.license_id ? {
        id: row.license_id,
        fingerprint: row.hardware_fingerprint,
        expiresAt: row.license_expires_at,
        gracePeriodEndsAt: row.grace_period_ends_at,
        status: row.license_status,
        updateChannel: row.update_channel,
        currentVersion: row.current_version,
        lastUpdateCheckAt: row.last_update_check_at,
      } : null,
      metrics: {
        inventoryCount: parseInt(row.inventory_count) || 0,
        pendingOrders: parseInt(row.pending_orders) || 0,
        revenue30d: parseFloat(row.revenue_30d) || 0,
      }
    }));
    
    const summary = {
      total: farms.length,
      online: farms.filter(f => f.status === 'online').length,
      offline: farms.filter(f => f.status === 'offline').length,
      degraded: farms.filter(f => f.status === 'degraded').length,
      byTier: {
        'inventory-only': farms.filter(f => f.tier === 'inventory-only').length,
        'full': farms.filter(f => f.tier === 'full').length,
        'enterprise': farms.filter(f => f.tier === 'enterprise').length,
      },
      byDeployment: {
        'cloud': farms.filter(f => f.deploymentMode === 'cloud').length,
        'edge': farms.filter(f => f.deploymentMode === 'edge').length,
        'desktop': farms.filter(f => f.deploymentMode === 'desktop').length,
      }
    };
    
    res.json({
      ok: true,
      farms,
      summary,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('[Farms] Status query failed:', error.message);
    res.status(500).json({
      ok: false,
      error: 'Database query failed',
      message: error.message
    });
  }
});

/**
 * GET /api/farms/:farmId/details
 * Detailed farm information
 */
app.get('/api/farms/:farmId/details', requireAdmin, async (req, res) => {
  try {
    const { farmId } = req.params;
    
    const farmResult = await pool.query(`
      SELECT
        f.*,
        l.id as license_id,
        l.hardware_fingerprint,
        l.expires_at as license_expires_at,
        l.grace_period_ends_at,
        l.status as license_status,
        l.update_channel,
        l.current_version,
        l.last_update_check_at,
        l.features
      FROM farms f
      LEFT JOIN licenses l ON l.farm_id = f.id
      WHERE f.id = $1 OR f.subdomain = $1
    `, [farmId]);
    
    if (farmResult.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        error: 'Farm not found'
      });
    }
    
    const farm = farmResult.rows[0];
    
    // Get recent activity
    const activityResult = await pool.query(`
      SELECT
        event_type,
        details,
        created_at
      FROM farm_activity
      WHERE farm_id = $1
      ORDER BY created_at DESC
      LIMIT 50
    `, [farm.id]);
    
    // Get inventory snapshot
    const inventoryResult = await pool.query(`
      SELECT
        COUNT(*) as total_items,
        SUM(available_quantity) as total_quantity,
        SUM(available_quantity * wholesale_price) as total_value
      FROM inventory
      WHERE tenant_id = $1 AND available_quantity > 0
    `, [farm.id]);
    
    // Get order stats
    const ordersResult = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending') as pending,
        COUNT(*) FILTER (WHERE status = 'accepted') as accepted,
        COUNT(*) FILTER (WHERE status = 'completed') as completed,
        SUM(total_amount) FILTER (WHERE status = 'completed' AND created_at > NOW() - INTERVAL '30 days') as revenue_30d,
        SUM(total_amount) FILTER (WHERE status = 'completed' AND created_at > NOW() - INTERVAL '7 days') as revenue_7d
      FROM wholesale_orders
      WHERE farm_id = $1
    `, [farm.id]);
    
    res.json({
      ok: true,
      farm: {
        ...farm,
        license: farm.license_id ? {
          id: farm.license_id,
          fingerprint: farm.hardware_fingerprint,
          expiresAt: farm.license_expires_at,
          gracePeriodEndsAt: farm.grace_period_ends_at,
          status: farm.license_status,
          updateChannel: farm.update_channel,
          currentVersion: farm.current_version,
          lastUpdateCheckAt: farm.last_update_check_at,
          features: farm.features,
        } : null,
      },
      activity: activityResult.rows,
      inventory: inventoryResult.rows[0] || { total_items: 0, total_quantity: 0, total_value: 0 },
      orders: ordersResult.rows[0] || { pending: 0, accepted: 0, completed: 0, revenue_30d: 0, revenue_7d: 0 },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('[Farms] Details query failed:', error.message);
    res.status(500).json({
      ok: false,
      error: 'Database query failed',
      message: error.message
    });
  }
});

/**
 * GET /api/farms/:farmId/logs
 * Recent error logs
 */
app.get('/api/farms/:farmId/logs', requireAdmin, async (req, res) => {
  try {
    const { farmId } = req.params;
    const limit = parseInt(req.query.limit) || 100;
    const level = req.query.level; // 'error', 'warn', 'info'
    
    let query = `
      SELECT
        level,
        message,
        details,
        created_at
      FROM farm_logs
      WHERE farm_id = $1
    `;
    
    const params = [farmId];
    
    if (level) {
      query += ` AND level = $2`;
      params.push(level);
    }
    
    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);
    
    const result = await pool.query(query, params);
    
    res.json({
      ok: true,
      logs: result.rows,
      count: result.rows.length,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('[Farms] Logs query failed:', error.message);
    res.status(500).json({
      ok: false,
      error: 'Database query failed',
      message: error.message
    });
  }
});

/**
 * POST /api/farms/:farmId/activate
 * Activate/deactivate farm
 */
app.post('/api/farms/:farmId/activate', requireAdmin, async (req, res) => {
  try {
    const { farmId } = req.params;
    const { active } = req.body;
    
    const result = await pool.query(`
      UPDATE farms
      SET active = $1, updated_at = NOW()
      WHERE id = $2 OR subdomain = $2
      RETURNING *
    `, [active, farmId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        error: 'Farm not found'
      });
    }
    
    // Log activity
    await pool.query(`
      INSERT INTO farm_activity (farm_id, event_type, details)
      VALUES ($1, $2, $3)
    `, [result.rows[0].id, active ? 'activated' : 'deactivated', { admin: true }]);
    
    res.json({
      ok: true,
      farm: result.rows[0],
      message: `Farm ${active ? 'activated' : 'deactivated'} successfully`
    });
    
  } catch (error) {
    console.error('[Farms] Activate failed:', error.message);
    res.status(500).json({
      ok: false,
      error: 'Activation failed',
      message: error.message
    });
  }
});

/**
 * POST /api/farms/:farmId/tier
 * Update farm tier
 */
app.post('/api/farms/:farmId/tier', requireAdmin, async (req, res) => {
  try {
    const { farmId } = req.params;
    const { tier } = req.body;
    
    if (!['inventory-only', 'full', 'enterprise'].includes(tier)) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid tier',
        validTiers: ['inventory-only', 'full', 'enterprise']
      });
    }
    
    const result = await pool.query(`
      UPDATE farms
      SET tier = $1, updated_at = NOW()
      WHERE id = $2 OR subdomain = $2
      RETURNING *
    `, [tier, farmId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        error: 'Farm not found'
      });
    }
    
    // Log activity
    await pool.query(`
      INSERT INTO farm_activity (farm_id, event_type, details)
      VALUES ($1, 'tier_changed', $2)
    `, [result.rows[0].id, { newTier: tier, admin: true }]);
    
    res.json({
      ok: true,
      farm: result.rows[0],
      message: `Farm tier updated to ${tier}`
    });
    
  } catch (error) {
    console.error('[Farms] Tier update failed:', error.message);
    res.status(500).json({
      ok: false,
      error: 'Tier update failed',
      message: error.message
    });
  }
});

/**
 * GET /api/analytics/summary
 * Overall analytics summary
 */
app.get('/api/analytics/summary', requireAdmin, async (req, res) => {
  try {
    const timeframe = req.query.timeframe || '30d'; // 7d, 30d, 90d, 365d
    const days = parseInt(timeframe.replace('d', ''));
    
    const result = await pool.query(`
      SELECT
        COUNT(DISTINCT f.id) as total_farms,
        COUNT(DISTINCT f.id) FILTER (WHERE f.active = true) as active_farms,
        COUNT(DISTINCT wo.id) as total_orders,
        SUM(wo.total_amount) as total_revenue,
        COUNT(DISTINCT wo.id) FILTER (WHERE wo.created_at > NOW() - INTERVAL '${days} days') as orders_period,
        SUM(wo.total_amount) FILTER (WHERE wo.created_at > NOW() - INTERVAL '${days} days') as revenue_period,
        COUNT(DISTINCT i.id) as total_inventory_items,
        SUM(i.available_quantity) as total_available_quantity
      FROM farms f
      LEFT JOIN wholesale_orders wo ON wo.farm_id = f.id AND wo.status = 'completed'
      LEFT JOIN inventory i ON i.tenant_id = f.id AND i.available_quantity > 0
    `);
    
    const licenseResult = await pool.query(`
      SELECT
        COUNT(*) as total_licenses,
        COUNT(*) FILTER (WHERE status = 'active') as active_licenses,
        COUNT(*) FILTER (WHERE status = 'expired') as expired_licenses,
        COUNT(*) FILTER (WHERE expires_at < NOW() + INTERVAL '30 days') as expiring_soon
      FROM licenses
    `);
    
    res.json({
      ok: true,
      summary: {
        ...result.rows[0],
        licenses: licenseResult.rows[0]
      },
      timeframe,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('[Analytics] Summary query failed:', error.message);
    res.status(500).json({
      ok: false,
      error: 'Analytics query failed',
      message: error.message
    });
  }
});

/**
 * WebSocket: Real-time farm updates
 */
app.ws('/ws/farms', (ws, req) => {
  console.log('[WebSocket] Client connected');
  
  // Send initial status
  pool.query(`
    SELECT id, subdomain, name, last_seen_at, tier
    FROM farms
    ORDER BY last_seen_at DESC NULLS LAST
    LIMIT 20
  `).then(result => {
    ws.send(JSON.stringify({
      type: 'initial',
      farms: result.rows
    }));
  }).catch(err => {
    console.error('[WebSocket] Initial query failed:', err.message);
  });
  
  // Poll for updates every 10 seconds
  const interval = setInterval(async () => {
    try {
      const result = await pool.query(`
        SELECT id, subdomain, name, last_seen_at, tier
        FROM farms
        WHERE last_seen_at > NOW() - INTERVAL '1 minute'
        ORDER BY last_seen_at DESC
      `);
      
      if (result.rows.length > 0) {
        ws.send(JSON.stringify({
          type: 'update',
          farms: result.rows
        }));
      }
    } catch (err) {
      console.error('[WebSocket] Update query failed:', err.message);
    }
  }, 10000);
  
  ws.on('close', () => {
    clearInterval(interval);
    console.log('[WebSocket] Client disconnected');
  });
});

// Helpers

function getStatus(lastSeenAt) {
  if (!lastSeenAt) return 'offline';
  
  const now = new Date();
  const lastSeen = new Date(lastSeenAt);
  const minutesAgo = (now - lastSeen) / 1000 / 60;
  
  if (minutesAgo < 5) return 'online';
  if (minutesAgo < 30) return 'degraded';
  return 'offline';
}

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    ok: false,
    error: 'Not found',
    path: req.path
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('[Error]', err);
  res.status(500).json({
    ok: false,
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'An error occurred'
  });
});

// Start server
const server = app.listen(PORT, () => {
  console.log('======================================');
  console.log('GreenReach Central Dashboard');
  console.log('======================================');
  console.log(`Listening on port ${PORT}`);
  console.log(`Admin token: ${ADMIN_TOKEN.slice(0, 8)}...`);
  console.log('');
  console.log('Endpoints:');
  console.log(`  GET  /api/farms/status          - All farms status`);
  console.log(`  GET  /api/farms/:id/details     - Farm details`);
  console.log(`  GET  /api/farms/:id/logs        - Farm logs`);
  console.log(`  POST /api/farms/:id/activate    - Activate/deactivate`);
  console.log(`  POST /api/farms/:id/tier        - Update tier`);
  console.log(`  GET  /api/analytics/summary     - Analytics summary`);
  console.log(`  WS   /ws/farms                  - Real-time updates`);
  console.log('======================================');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[Server] SIGTERM received, shutting down gracefully');
  server.close(() => {
    pool.end(() => {
      process.exit(0);
    });
  });
});
