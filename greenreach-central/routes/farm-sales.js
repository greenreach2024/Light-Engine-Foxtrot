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
 *   GET  /api/farm-sales/inventory/export       - Inventory CSV export
 *   GET  /api/farm-sales/reports/sales-export   - Sales transaction CSV export
 *   GET  /api/farm-sales/reports/quickbooks-daily-summary - QuickBooks daily CSV
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
router.get('/farm-sales/orders', async (req, res) => {
  try {
    const farmId = req.farmId;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);

    // Try DB first for direct-sale orders
    if (isDatabaseAvailable()) {
      try {
        const farmRow = farmId ? await query('SELECT id FROM farms WHERE farm_id = $1', [farmId]) : { rows: [] };
        const farmDbId = farmRow.rows[0]?.id;
        if (farmDbId) {
          const result = await query(
            `SELECT * FROM wholesale_orders WHERE order_data->>'farm_id' = $1
             OR order_data->'farmSubOrders' @> $2::jsonb
             ORDER BY created_at DESC LIMIT $3 OFFSET $4`,
            [farmId, JSON.stringify([{ farm_id: farmId }]), limit, (page - 1) * limit]
          );
          const orders = result.rows.map(r => ({ ...r.order_data, id: r.master_order_id || r.id, created_at: r.created_at }));
          const countRes = await query(
            `SELECT COUNT(*) FROM wholesale_orders WHERE order_data->>'farm_id' = $1
             OR order_data->'farmSubOrders' @> $2::jsonb`,
            [farmId, JSON.stringify([{ farm_id: farmId }])]
          );
          const total = parseInt(countRes.rows[0]?.count || 0);
          return res.json({
            success: true, orders,
            pagination: { page, pageSize: limit, totalItems: total, totalPages: Math.ceil(total / limit) },
            summary: { total, pending: orders.filter(o => (o.status || '').includes('pending')).length, completed: orders.filter(o => o.status === 'delivered' || o.status === 'completed').length, revenue: orders.reduce((s, o) => s + (o.totals?.total || 0), 0) },
          });
        }
      } catch { /* fall through to empty */ }
    }

    // Fallback: farmStore-based lookup or empty
    const storeOrders = req.farmStore ? (await req.farmStore.get(farmId, 'orders') || []) : [];
    const arr = Array.isArray(storeOrders) ? storeOrders : [];
    res.json({
      success: true, orders: arr.slice((page - 1) * limit, page * limit),
      pagination: { page, pageSize: limit, totalItems: arr.length, totalPages: Math.ceil(arr.length / limit) },
      summary: { total: arr.length, pending: arr.filter(o => (o.status || '').includes('pending')).length, completed: arr.filter(o => o.status === 'completed').length, revenue: arr.reduce((s, o) => s + (o.total || 0), 0) },
    });
  } catch (err) {
    console.error('[FarmSales] Orders error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load orders' });
  }
});

// ─── Farm Sales Inventory ──────────────────────────────────
router.get('/farm-sales/inventory', async (req, res) => {
  try {
    const farmId = req.farmId;
    let inventory = [];

    // Try DB
    if (isDatabaseAvailable() && farmId) {
      try {
        const result = await query(
          'SELECT * FROM farm_inventory WHERE farm_id = $1 ORDER BY sku',
          [farmId]
        );
        if (result.rows.length) inventory = result.rows;
      } catch { /* table may not exist — fall through */ }
    }

    // Fallback to farmStore
    if (!inventory.length && req.farmStore && farmId) {
      const stored = await req.farmStore.get(farmId, 'inventory');
      if (Array.isArray(stored)) inventory = stored;
    }

    const inStock = inventory.filter(i => (i.quantity || i.qty_available || 0) > 0).length;
    const lowStock = inventory.filter(i => {
      const q = i.quantity || i.qty_available || 0;
      return q > 0 && q <= (i.low_stock_threshold || 5);
    }).length;
    const outOfStock = inventory.filter(i => (i.quantity || i.qty_available || 0) <= 0).length;

    res.json({
      success: true,
      inventory,
      summary: { totalProducts: inventory.length, inStock, lowStock, outOfStock },
    });
  } catch (err) {
    console.error('[FarmSales] Inventory error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load inventory' });
  }
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

// ─── CSV Export Helpers ─────────────────────────────────────
function csvEscape(value) {
  const str = String(value ?? '');
  if (str.includes('"') || str.includes(',') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// ─── Inventory CSV Export ───────────────────────────────────
// GET /api/farm-sales/inventory/export — CSV of current inventory
router.get('/farm-sales/inventory/export', async (req, res) => {
  try {
    const farmId = req.farmId;
    const { category, available_only, include_valuation } = req.query;
    let inventory = [];

    if (isDatabaseAvailable() && farmId) {
      try {
        let sql = 'SELECT * FROM farm_inventory WHERE farm_id = $1';
        const params = [farmId];
        if (category) {
          params.push(category);
          sql += ` AND category = $${params.length}`;
        }
        sql += ' ORDER BY sku';
        const result = await query(sql, params);
        if (result.rows.length) inventory = result.rows;
      } catch { /* table may not exist — fall through */ }
    }

    // Fallback to farmStore
    if (!inventory.length && req.farmStore && farmId) {
      const stored = await req.farmStore.get(farmId, 'inventory');
      if (Array.isArray(stored)) {
        inventory = stored;
        if (category) inventory = inventory.filter(i => (i.category || '') === category);
      }
    }

    if (available_only === 'true') {
      inventory = inventory.filter(i => (i.quantity || i.qty_available || 0) > 0);
    }

    const showVal = include_valuation !== 'false';
    const headerCols = ['SKU', 'Name', 'Category', 'Quantity', 'Unit', 'Low Stock Threshold'];
    if (showVal) headerCols.push('Unit Price', 'Total Value');

    const rows = inventory.map(item => {
      const qty = item.quantity || item.qty_available || 0;
      const price = item.unit_price || item.price || 0;
      const cols = [
        csvEscape(item.sku || item.sku_id || ''),
        csvEscape(item.name || item.product_name || ''),
        csvEscape(item.category || ''),
        qty,
        csvEscape(item.unit || 'each'),
        item.low_stock_threshold || 5,
      ];
      if (showVal) {
        cols.push(Number(price).toFixed(2), (qty * price).toFixed(2));
      }
      return cols.join(',');
    });

    const csv = [headerCols.join(','), ...rows].join('\n');
    const filename = `inventory-export-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) {
    console.error('[FarmSales] Inventory export error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to export inventory' });
  }
});

// ─── Sales Transaction CSV Export ───────────────────────────
// GET /api/farm-sales/reports/sales-export — CSV of wholesale orders + POS txns
router.get('/farm-sales/reports/sales-export', async (req, res) => {
  try {
    const farmId = req.farmId;
    const { start_date, end_date, channel, level } = req.query;
    let orders = [];

    if (isDatabaseAvailable() && farmId) {
      try {
        let sql = `SELECT master_order_id, buyer_id, buyer_email, status, order_data, created_at
                    FROM wholesale_orders
                    WHERE (order_data->>'farm_id' = $1
                       OR order_data->'farmSubOrders' @> $2::jsonb)`;
        const params = [farmId, JSON.stringify([{ farm_id: farmId }])];
        if (start_date) { params.push(start_date); sql += ` AND created_at >= $${params.length}::date`; }
        if (end_date)   { params.push(end_date + 'T23:59:59Z'); sql += ` AND created_at <= $${params.length}::timestamp`; }
        sql += ' ORDER BY created_at DESC';
        const result = await query(sql, params);
        orders = result.rows.map(r => ({
          ...r.order_data,
          master_order_id: r.master_order_id,
          buyer_email: r.buyer_email,
          db_status: r.status,
          created_at: r.created_at,
        }));
      } catch { /* fall through */ }
    }

    // Fallback to farmStore
    if (!orders.length && req.farmStore && farmId) {
      const stored = await req.farmStore.get(farmId, 'orders');
      if (Array.isArray(stored)) orders = stored;
    }

    // Channel filter
    if (channel && channel !== 'all') {
      orders = orders.filter(o => (o.channel || 'wholesale').toLowerCase().includes(channel));
    }

    // Build CSV
    const isDetail = level === 'detail';
    if (isDetail) {
      const header = ['Order ID', 'Date', 'Buyer', 'Channel', 'SKU', 'Product', 'Qty', 'Unit Price', 'Line Total', 'Status'].join(',');
      const rows = [];
      for (const o of orders) {
        const items = o.items || o.farmSubOrders?.flatMap(s => s.items || []) || [];
        const dateStr = o.created_at ? new Date(o.created_at).toISOString().slice(0, 10) : '';
        for (const item of items) {
          rows.push([
            csvEscape(o.master_order_id || o.id || ''),
            dateStr,
            csvEscape(o.buyer_email || o.buyerName || ''),
            csvEscape(o.channel || 'wholesale'),
            csvEscape(item.sku_id || item.sku || ''),
            csvEscape(item.name || item.product_name || ''),
            item.quantity || 0,
            Number(item.unit_price || item.price || 0).toFixed(2),
            Number((item.quantity || 0) * (item.unit_price || item.price || 0)).toFixed(2),
            csvEscape(o.db_status || o.status || ''),
          ].join(','));
        }
        // If no items, still emit order-level row
        if (!items.length) {
          rows.push([
            csvEscape(o.master_order_id || o.id || ''),
            dateStr,
            csvEscape(o.buyer_email || o.buyerName || ''),
            csvEscape(o.channel || 'wholesale'),
            '', '', 0, '0.00',
            Number(o.totals?.total || o.total || 0).toFixed(2),
            csvEscape(o.db_status || o.status || ''),
          ].join(','));
        }
      }
      const csv = [header, ...rows].join('\n');
      const filename = `sales-detail-${start_date || 'all'}-to-${end_date || 'now'}.csv`;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(csv);
    }

    // Summary level — one row per order
    const header = ['Order ID', 'Date', 'Buyer', 'Channel', 'Items', 'Subtotal', 'Tax', 'Total', 'Status'].join(',');
    const rows = orders.map(o => {
      const items = o.items || o.farmSubOrders?.flatMap(s => s.items || []) || [];
      return [
        csvEscape(o.master_order_id || o.id || ''),
        o.created_at ? new Date(o.created_at).toISOString().slice(0, 10) : '',
        csvEscape(o.buyer_email || o.buyerName || ''),
        csvEscape(o.channel || 'wholesale'),
        items.length,
        Number(o.totals?.subtotal || o.subtotal || 0).toFixed(2),
        Number(o.totals?.tax || o.tax || 0).toFixed(2),
        Number(o.totals?.total || o.total || 0).toFixed(2),
        csvEscape(o.db_status || o.status || ''),
      ].join(',');
    });
    const csv = [header, ...rows].join('\n');
    const filename = `sales-summary-${start_date || 'all'}-to-${end_date || 'now'}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) {
    console.error('[FarmSales] Sales export error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to export sales data' });
  }
});

// ─── QuickBooks Daily Summary CSV ───────────────────────────
// GET /api/farm-sales/reports/quickbooks-daily-summary — aggregated daily summary
router.get('/farm-sales/reports/quickbooks-daily-summary', async (req, res) => {
  try {
    const farmId = req.farmId;
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const nextDay = new Date(new Date(date).getTime() + 86400000).toISOString().slice(0, 10);

    let orders = [];
    if (isDatabaseAvailable() && farmId) {
      try {
        const result = await query(
          `SELECT order_data, created_at FROM wholesale_orders
           WHERE (order_data->>'farm_id' = $1
              OR order_data->'farmSubOrders' @> $2::jsonb)
             AND created_at >= $3::date AND created_at < $4::date
           ORDER BY created_at`,
          [farmId, JSON.stringify([{ farm_id: farmId }]), date, nextDay]
        );
        orders = result.rows.map(r => ({ ...r.order_data, created_at: r.created_at }));
      } catch { /* fall through */ }
    }

    // Aggregate by channel
    const channels = { wholesale: 0, pos: 0, online: 0 };
    let totalTax = 0, totalTips = 0, totalCash = 0, totalCard = 0, totalRevenue = 0;

    for (const o of orders) {
      const ch = (o.channel || 'wholesale').toLowerCase();
      const total = o.totals?.total || o.total || 0;
      const tax = o.totals?.tax || o.tax || 0;
      const tip = o.tip || 0;
      totalRevenue += total;
      totalTax += tax;
      totalTips += tip;
      if (ch.includes('pos')) { channels.pos += total; totalCash += total; }
      else if (ch.includes('online')) { channels.online += total; totalCard += total; }
      else { channels.wholesale += total; totalCard += total; }
    }

    const processingFee = totalCard * 0.029 + orders.length * 0.30;
    const brokerFee = channels.wholesale * 0.15;

    // QuickBooks IIF-style daily summary CSV
    const header = ['Account', 'Description', 'Debit', 'Credit'].join(',');
    const rows = [
      ['Revenue - Wholesale', `Wholesale sales ${date}`, '', channels.wholesale.toFixed(2)],
      ['Revenue - POS', `Point of sale ${date}`, '', channels.pos.toFixed(2)],
      ['Revenue - Online', `Online orders ${date}`, '', channels.online.toFixed(2)],
      ['Sales Tax Payable', `Tax collected ${date}`, '', totalTax.toFixed(2)],
      ['Tips Income', `Tips received ${date}`, '', totalTips.toFixed(2)],
      ['Cash on Hand', `Cash payments ${date}`, totalCash.toFixed(2), ''],
      ['Accounts Receivable', `Card payments ${date}`, totalCard.toFixed(2), ''],
      ['Merchant Processing Fees', `Card processing (2.9% + $0.30) ${date}`, processingFee.toFixed(2), ''],
      ['Broker Fees', `GreenReach commission (15%) ${date}`, brokerFee.toFixed(2), ''],
    ].map(cols => cols.map(csvEscape).join(','));

    const csv = [header, ...rows].join('\n');
    const filename = `quickbooks-daily-${date}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) {
    console.error('[FarmSales] QuickBooks export error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to export QuickBooks summary' });
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
