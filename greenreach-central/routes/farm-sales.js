/**
 * Farm Sales Routes
 * Stubs for the farm-sales subsystem used by:
 *   - farm-sales-landing.html, farm-sales-pos.html, farm-sales-store.html, farm-sales-shop.html
 *   - farm-admin.js (orders, QuickBooks)
 *   - farm-summary.html (inventory)
 *
 * Endpoints:
 *   GET  /api/config/app                   - App config (farm mode, features)
 *   GET  /api/farm-auth/demo-tokens        - Demo auth tokens for POS/store
 *   GET  /api/farm-sales/orders            - Farm direct-sales orders
 *   GET  /api/farm-sales/inventory         - Farm retail inventory
 *   GET  /api/farm-sales/subscriptions/plans - Subscription plans
 *   GET  /api/farm-sales/quickbooks/status - QuickBooks integration status
 *   POST /api/farm-sales/quickbooks/auth   - QuickBooks OAuth start
 *   POST /api/farm-sales/quickbooks/disconnect - Disconnect QuickBooks
 *   POST /api/farm-sales/quickbooks/sync-* - QuickBooks sync operations
 *   GET  /api/farm-sales/ai-agent/status   - AI agent status
 *   POST /api/farm-sales/ai-agent/chat     - AI agent chat
 *   GET  /api/demo/intro-cards             - Demo intro card data
 */
import { Router } from 'express';
import jwt from 'jsonwebtoken';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'greenreach-jwt-secret-2025';

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
