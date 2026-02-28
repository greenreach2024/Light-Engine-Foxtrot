/**
 * Farm Sales Routes
 * Stubs for the farm-sales subsystem used by:
 *   - farm-sales-landing.html, farm-sales-pos.html, farm-sales-store.html, farm-sales-shop.html
 *   - farm-admin.js (orders, QuickBooks, delivery settings)
 *   - farm-summary.html (inventory)
 *
 * Endpoints:
 *   GET  /api/config/app                       - App config (farm mode, features)
 *   GET  /api/farm-auth/demo-tokens            - Demo auth tokens for POS/store
 *   GET  /api/farm-sales/orders                - Farm direct-sales orders
 *   GET  /api/farm-sales/inventory             - Farm retail inventory
 *   GET  /api/farm-sales/subscriptions/plans   - Subscription plans
 *   GET  /api/farm-sales/quickbooks/status     - QuickBooks integration status
 *   POST /api/farm-sales/quickbooks/auth       - QuickBooks OAuth start
 *   POST /api/farm-sales/quickbooks/disconnect - Disconnect QuickBooks
 *   POST /api/farm-sales/quickbooks/sync-*     - QuickBooks sync operations
 *   GET  /api/farm-sales/ai-agent/status       - AI agent status
 *   POST /api/farm-sales/ai-agent/chat         - AI agent chat
 *   GET  /api/farm-sales/delivery/config       - Get delivery settings + windows
 *   PUT  /api/farm-sales/delivery/config       - Update delivery settings
 *   PUT  /api/farm-sales/delivery/windows      - Bulk upsert delivery windows
 *   GET  /api/demo/intro-cards                 - Demo intro card data
 */
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { randomBytes } from 'crypto';
import { query, isDatabaseAvailable } from '../config/database.js';

const router = Router();
async function ensureDeliveryTables() {
  await query(`
    CREATE TABLE IF NOT EXISTS farm_delivery_settings (
      id SERIAL PRIMARY KEY,
      farm_id VARCHAR(255) NOT NULL,
      enabled BOOLEAN DEFAULT FALSE,
      base_fee NUMERIC(10,2) DEFAULT 0,
      min_order NUMERIC(10,2) DEFAULT 25,
      lead_time_hours INTEGER DEFAULT 24,
      max_deliveries_per_window INTEGER DEFAULT 20,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(farm_id)
    );

    CREATE INDEX IF NOT EXISTS idx_farm_delivery_settings_farm ON farm_delivery_settings(farm_id);

    CREATE TABLE IF NOT EXISTS farm_delivery_windows (
      id SERIAL PRIMARY KEY,
      farm_id VARCHAR(255) NOT NULL,
      window_id VARCHAR(50) NOT NULL,
      label VARCHAR(255),
      start_time VARCHAR(10),
      end_time VARCHAR(10),
      active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(farm_id, window_id)
    );

    CREATE INDEX IF NOT EXISTS idx_farm_delivery_windows_farm ON farm_delivery_windows(farm_id);
  `);
}

function getJwtSecret() {
  if (!process.env.JWT_SECRET && (process.env.NODE_ENV === 'production' || process.env.DEPLOYMENT_MODE === 'cloud')) {
    throw new Error('JWT_SECRET environment variable is required in production');
  }
  return process.env.JWT_SECRET || randomBytes(32).toString('hex');
}
const JWT_SECRET = getJwtSecret();

// ─── App Config ────────────────────────────────────────────
// GET /api/config/app — returns feature flags & farm mode
router.get('/config/app', (req, res) => {
  const farmId = req.farmId || 'default';
  res.json({
    success: true,
    config: {
      farmId,
      mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
      features: {
        wholesale: true,
        farmSales: true,
        pos: true,
        subscriptions: false,
        quickbooks: false,
        square: false,
        aiAgent: false,
      },
      currency: 'CAD',
      timezone: 'America/Toronto',
      version: '1.0.0',
    }
  });
});

// ─── Demo Tokens ───────────────────────────────────────────
// GET /api/farm-auth/demo-tokens — demo/dev auth tokens for POS
router.get('/farm-auth/demo-tokens', (req, res) => {
  const farmId = req.farmId || 'demo-farm';
  const token = jwt.sign(
    { farm_id: farmId, role: 'pos', type: 'demo-token', user_id: 'demo-user' },
    JWT_SECRET,
    { expiresIn: '24h', audience: 'greenreach-farms', issuer: 'greenreach-central' }
  );
  res.json({
    success: true,
    tokens: {
      pos: token,
      store: token,
      admin: token,
    },
    farm_id: farmId,
    expiresIn: '24h',
  });
});

// ─── Farm Sales Orders ─────────────────────────────────────
router.get('/farm-sales/orders', (req, res) => {
  res.json({
    success: true,
    orders: [],
    pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 },
    summary: { total: 0, pending: 0, completed: 0, revenue: 0 },
  });
});

// ─── Farm Sales Inventory ──────────────────────────────────
router.get('/farm-sales/inventory', (req, res) => {
  res.json({
    success: true,
    inventory: [],
    summary: { totalProducts: 0, inStock: 0, lowStock: 0, outOfStock: 0 },
  });
});

// ─── Subscription Plans ────────────────────────────────────
router.get('/farm-sales/subscriptions/plans', (req, res) => {
  res.json({
    success: true,
    plans: [],
    message: 'Subscription plans not yet configured',
  });
});

// ─── QuickBooks Integration ────────────────────────────────
router.get('/farm-sales/quickbooks/status', (req, res) => {
  res.json({
    success: true,
    connected: false,
    status: 'not_configured',
    message: 'QuickBooks integration not configured',
  });
});

router.post('/farm-sales/quickbooks/auth', (req, res) => {
  res.json({ success: false, error: 'QuickBooks integration not configured' });
});

router.post('/farm-sales/quickbooks/disconnect', (req, res) => {
  res.json({ success: true, message: 'QuickBooks not connected' });
});

router.post('/farm-sales/quickbooks/sync-invoices', (req, res) => {
  res.json({ success: true, synced: 0, message: 'QuickBooks not connected' });
});

router.post('/farm-sales/quickbooks/sync-payments', (req, res) => {
  res.json({ success: true, synced: 0, message: 'QuickBooks not connected' });
});

router.post('/farm-sales/quickbooks/sync/customer', (req, res) => {
  res.json({ success: true, synced: 0, message: 'QuickBooks not connected' });
});

// ─── AI Agent ──────────────────────────────────────────────
router.get('/farm-sales/ai-agent/status', (req, res) => {
  res.json({
    success: true,
    enabled: false,
    status: 'inactive',
    model: 'gpt-4',
    message: 'AI agent not configured',
  });
});

router.post('/farm-sales/ai-agent/chat', (req, res) => {
  res.json({
    success: true,
    response: 'AI agent is not currently enabled. Please configure it in farm settings.',
    sessionId: null,
  });
});

// ─── Farm Delivery Settings (farm-admin.js) ────────────────
// GET /api/farm-sales/delivery/config — delivery settings + windows for this farm
router.get('/farm-sales/delivery/config', async (req, res) => {
  try {
    const farmId = req.farmId;
    if (!farmId) {
      return res.status(400).json({ success: false, error: 'Farm ID not resolved' });
    }

    let settings = { enabled: false, base_fee: 0, min_order: 25, lead_time_hours: 24, max_deliveries_per_window: 20 };
    let windows = [];

    if (isDatabaseAvailable()) {
      await ensureDeliveryTables();
      const settingsResult = await query(
        'SELECT * FROM farm_delivery_settings WHERE farm_id = $1', [farmId]
      );
      if (settingsResult.rows.length > 0) {
        const r = settingsResult.rows[0];
        settings = {
          enabled: r.enabled,
          base_fee: Number(r.base_fee),
          min_order: Number(r.min_order),
          lead_time_hours: Number(r.lead_time_hours || 24),
          max_deliveries_per_window: Number(r.max_deliveries_per_window || 20)
        };
      }

      const windowsResult = await query(
        'SELECT * FROM farm_delivery_windows WHERE farm_id = $1 ORDER BY window_id', [farmId]
      );
      windows = windowsResult.rows.map(r => ({
        window_id: r.window_id,
        label: r.label,
        start_time: r.start_time,
        end_time: r.end_time,
        active: r.active
      }));
    }

    // Provide defaults if no windows configured yet
    if (windows.length === 0) {
      windows = [
        { window_id: 'morning',   label: 'Morning',   start_time: '06:00', end_time: '10:00', active: true },
        { window_id: 'afternoon', label: 'Afternoon', start_time: '11:00', end_time: '15:00', active: true },
        { window_id: 'evening',   label: 'Evening',   start_time: '16:00', end_time: '20:00', active: false }
      ];
    }

    res.json({ success: true, config: { ...settings, windows } });
  } catch (error) {
    console.error('[Farm Delivery] Config get failed:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/farm-sales/delivery/config — update delivery settings
router.put('/farm-sales/delivery/config', async (req, res) => {
  try {
    const farmId = req.farmId;
    if (!farmId) {
      return res.status(400).json({ success: false, error: 'Farm ID not resolved' });
    }

    const { enabled, base_fee, min_order, lead_time_hours, max_deliveries_per_window } = req.body;

    if (isDatabaseAvailable()) {
      await ensureDeliveryTables();
      await query(
        `INSERT INTO farm_delivery_settings (farm_id, enabled, base_fee, min_order, lead_time_hours, max_deliveries_per_window, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (farm_id) DO UPDATE SET
           enabled = COALESCE($2, farm_delivery_settings.enabled),
           base_fee = COALESCE($3, farm_delivery_settings.base_fee),
           min_order = COALESCE($4, farm_delivery_settings.min_order),
           lead_time_hours = COALESCE($5, farm_delivery_settings.lead_time_hours),
           max_deliveries_per_window = COALESCE($6, farm_delivery_settings.max_deliveries_per_window),
           updated_at = NOW()`,
        [
          farmId,
          enabled ?? null,
          base_fee != null ? parseFloat(base_fee) : null,
          min_order != null ? parseFloat(min_order) : null,
          lead_time_hours != null ? parseInt(lead_time_hours) : null,
          max_deliveries_per_window != null ? parseInt(max_deliveries_per_window) : null
        ]
      );

      const result = await query('SELECT * FROM farm_delivery_settings WHERE farm_id = $1', [farmId]);
      const r = result.rows[0];
      console.log('[Farm Delivery] Config updated for farm:', farmId);
      return res.json({
        success: true,
        config: {
          enabled: r.enabled,
          base_fee: Number(r.base_fee),
          min_order: Number(r.min_order),
          lead_time_hours: Number(r.lead_time_hours),
          max_deliveries_per_window: Number(r.max_deliveries_per_window)
        }
      });
    }

    res.status(503).json({ success: false, error: 'Database unavailable' });
  } catch (error) {
    console.error('[Farm Delivery] Config update failed:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/farm-sales/delivery/windows — bulk upsert delivery windows
router.put('/farm-sales/delivery/windows', async (req, res) => {
  try {
    const farmId = req.farmId;
    if (!farmId) {
      return res.status(400).json({ success: false, error: 'Farm ID not resolved' });
    }

    const { windows } = req.body;
    if (!Array.isArray(windows)) {
      return res.status(400).json({ success: false, error: 'windows array is required' });
    }

    if (isDatabaseAvailable()) {
      await ensureDeliveryTables();
      for (const w of windows) {
        if (!w.window_id) continue;
        await query(
          `INSERT INTO farm_delivery_windows (farm_id, window_id, label, start_time, end_time, active, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW())
           ON CONFLICT (farm_id, window_id) DO UPDATE SET
             label = COALESCE($3, farm_delivery_windows.label),
             start_time = COALESCE($4, farm_delivery_windows.start_time),
             end_time = COALESCE($5, farm_delivery_windows.end_time),
             active = COALESCE($6, farm_delivery_windows.active),
             updated_at = NOW()`,
          [farmId, w.window_id, w.label || w.window_id, w.start_time || '06:00', w.end_time || '10:00', w.active ?? true]
        );
      }

      const result = await query(
        'SELECT * FROM farm_delivery_windows WHERE farm_id = $1 ORDER BY window_id', [farmId]
      );
      const saved = result.rows.map(r => ({
        window_id: r.window_id, label: r.label,
        start_time: r.start_time, end_time: r.end_time, active: r.active
      }));
      console.log('[Farm Delivery] Windows updated for farm:', farmId, '—', saved.length, 'windows');
      return res.json({ success: true, windows: saved });
    }

    res.status(503).json({ success: false, error: 'Database unavailable' });
  } catch (error) {
    console.error('[Farm Delivery] Windows update failed:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── Demo Intro Cards ──────────────────────────────────────
router.get('/demo/intro-cards', (req, res) => {
  res.json({
    success: true,
    cards: [
      { id: 'welcome', title: 'Welcome to GreenReach', description: 'Your smart farming platform', icon: '🌱' },
      { id: 'setup', title: 'Set Up Your Farm', description: 'Configure rooms, zones, and groups', icon: '🏭' },
      { id: 'monitor', title: 'Monitor & Control', description: 'Track environment and automate', icon: '📊' },
      { id: 'grow', title: 'Grow & Sell', description: 'Plan plantings and manage orders', icon: '🌿' },
    ],
  });
});

export default router;
