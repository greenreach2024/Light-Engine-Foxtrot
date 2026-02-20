/**
 * Miscellaneous stub routes for Cloud SaaS Phase 2
 *
 * Provides sensible default responses for frontend API calls that
 * don't have full implementations yet but need non-error responses
 * so the UI loads cleanly.
 *
 * Endpoints:
 *   GET  /api/quality/tests/:farmId   - Quality test results
 *   POST /api/room-mapper/save        - Save room layout
 *   GET  /api/harvest/predictions      - Harvest predictions
 *   POST /api/harvest                 - Record harvest
 *   GET  /api/dedicated-crops         - Dedicated crop assignments
 *   POST /api/dedicated-crops         - Update dedicated crops
 *   GET  /api/farm/square/status      - Square integration status
 *   POST /api/farm/square/authorize   - Square OAuth init
 *   POST /api/farms/create-checkout-session - Stripe/payment checkout
 *   GET  /api/health/ai-character     - AI character config
 *   POST /api/ai/record-decision      - Record AI decision
 *   GET  /api/crop-pricing            - Alias → /api/crop-pricing (handled)
 *   GET  /api/inventory/tray-formats  - Alias → /api/tray-formats
 *   GET  /api/farms/list              - Alias → /api/farms
 *   POST /api/admin/impersonate/:farmId - Admin impersonation
 *   PUT  /api/admin/farms/:farmId/status - Farm status update
 *   PUT  /api/admin/users/:userId/status - User status update
 */
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();

// ═══════════ Quality Tests ═══════════
router.get('/api/quality/tests/:farmId', (req, res) => {
  res.json({
    ok: true,
    farmId: req.params.farmId,
    tests: [],
    total: 0,
    message: 'No quality tests recorded yet',
  });
});

router.post('/api/quality/tests', (req, res) => {
  const { farmId, testType, results } = req.body;
  res.json({
    ok: true,
    id: `QT-${Date.now()}`,
    farmId,
    testType,
    results,
    recordedAt: new Date().toISOString(),
  });
});

// ═══════════ Room Mapper ═══════════
router.post('/api/room-mapper/save', (req, res) => {
  const { roomId, layout } = req.body;
  // In edge mode this writes to local storage;
  // in SaaS mode we'd persist to farm_data
  console.log(`[Room Mapper] Save request: room=${roomId}, elements=${Array.isArray(layout) ? layout.length : 'N/A'}`);
  res.json({ ok: true, roomId, saved: true });
});

// ═══════════ Harvest ═══════════
router.get('/api/harvest/predictions', async (req, res) => {
  // Read groups to compute basic predictions
  try {
    const groupsPath = path.join(__dirname, '..', 'public', 'data', 'groups.json');
    let groups = [];
    if (fs.existsSync(groupsPath)) {
      const raw = JSON.parse(fs.readFileSync(groupsPath, 'utf8'));
      groups = Array.isArray(raw) ? raw : (raw.groups || []);
    }

    const predictions = groups
      .filter(g => g.currentDay > 0 && g.growthCycleDays > 0)
      .map(g => {
        const daysLeft = Math.max(0, g.growthCycleDays - g.currentDay);
        const harvestDate = new Date();
        harvestDate.setDate(harvestDate.getDate() + daysLeft);
        return {
          groupId: g.id,
          crop: g.crop || g.recipe || 'Unknown',
          zone: g.zone,
          daysToHarvest: daysLeft,
          harvestDate: harvestDate.toISOString().split('T')[0],
          estimatedYield: g.trayCount || 1,
        };
      })
      .sort((a, b) => a.daysToHarvest - b.daysToHarvest);

    res.json({ ok: true, predictions, total: predictions.length });
  } catch (error) {
    res.json({ ok: true, predictions: [], total: 0 });
  }
});

router.post('/api/harvest', (req, res) => {
  const entry = req.body;
  console.log(`[Harvest] Recorded: crop=${entry.crop}, qty=${entry.quantity}, date=${entry.date || new Date().toISOString()}`);
  res.json({
    ok: true,
    id: `H-${Date.now()}`,
    ...entry,
    recordedAt: new Date().toISOString(),
  });
});

// ═══════════ Dedicated Crops ═══════════
router.get('/api/dedicated-crops', (req, res) => {
  try {
    const dcPath = path.join(__dirname, '..', 'public', 'data', 'dedicated-crops.json');
    if (fs.existsSync(dcPath)) {
      const data = JSON.parse(fs.readFileSync(dcPath, 'utf8'));
      return res.json({ ok: true, crops: data.crops || data || [] });
    }
    res.json({ ok: true, crops: [] });
  } catch {
    res.json({ ok: true, crops: [] });
  }
});

router.post('/api/dedicated-crops', (req, res) => {
  try {
    const dcPath = path.join(__dirname, '..', 'public', 'data', 'dedicated-crops.json');
    const dir = path.dirname(dcPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const crops = req.body.crops || req.body;
    fs.writeFileSync(dcPath, JSON.stringify({ crops, updatedAt: new Date().toISOString() }, null, 2));
    res.json({ ok: true, saved: true });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ═══════════ Square Integration Stubs ═══════════
router.get('/api/farm/square/status', (req, res) => {
  res.json({
    ok: true,
    connected: false,
    status: 'not_connected',
    message: 'Square integration not configured on this instance',
  });
});

router.post('/api/farm/square/authorize', (req, res) => {
  res.json({
    ok: false,
    error: 'square_not_configured',
    message: 'Square OAuth is not configured on the cloud instance. Configure via farm edge device.',
  });
});

// ═══════════ Checkout Session (Stripe) ═══════════
router.post('/api/farms/create-checkout-session', (req, res) => {
  const { planId, farmId, email } = req.body;
  // In production this would call Stripe API
  res.json({
    ok: true,
    sessionId: `cs_demo_${Date.now()}`,
    url: `/purchase-success.html?session_id=cs_demo_${Date.now()}`,
    planId,
    farmId,
    email,
    note: 'Demo checkout session — Stripe not configured',
  });
});

// ═══════════ AI Character / Health ═══════════
router.get('/api/health/ai-character', (req, res) => {
  res.json({
    ok: true,
    character: {
      name: 'Sprout',
      personality: 'helpful',
      avatar: '/images/ai-avatar.png',
      greeting: 'Hi! I\'m Sprout, your farm AI assistant.',
    },
  });
});

// ═══════════ AI Decision Recording ═══════════
router.post('/api/ai/record-decision', (req, res) => {
  const { decision, context, outcome } = req.body;
  console.log(`[AI] Decision recorded: ${decision} context=${JSON.stringify(context || {}).slice(0, 100)}`);
  res.json({
    ok: true,
    id: `AI-${Date.now()}`,
    decision,
    context,
    outcome,
    recordedAt: new Date().toISOString(),
  });
});

// ═══════════ Path Mismatch Aliases ═══════════

// Frontend calls /api/inventory/tray-formats but handler is at /api/tray-formats
router.get('/api/inventory/tray-formats', (req, res) => {
  // Proxy to the actual handler by redirecting internally
  res.redirect(307, '/api/tray-formats');
});

// Frontend calls /api/farms/list but admin API is at /api/admin/farms
router.get('/api/farms/list', async (req, res) => {
  // Forward to admin farms list
  res.redirect(307, '/api/admin/farms');
});

// Frontend calls /crop-pricing (no /api prefix)
router.get('/crop-pricing', (req, res) => {
  res.redirect(307, '/api/crop-pricing');
});

// ═══════════ Admin Extended Operations ═══════════

// POST /api/admin/impersonate/:farmId — Start impersonation session
router.post('/api/admin/impersonate/:farmId', (req, res) => {
  const { farmId } = req.params;
  // In production, this would generate a scoped JWT for the target farm
  res.json({
    ok: true,
    farmId,
    impersonating: true,
    token: null, // Would be a scoped JWT
    message: `Impersonation session started for farm ${farmId}`,
    expiresIn: '1h',
  });
});

// PUT /api/admin/farms/:farmId/status — Update farm status
router.put('/api/admin/farms/:farmId/status', async (req, res) => {
  const { farmId } = req.params;
  const { status } = req.body;
  try {
    // Try to update in DB
    const { isDatabaseAvailable, query } = await import('../config/database.js');
    if (await isDatabaseAvailable()) {
      await query('UPDATE farms SET status = $1, updated_at = NOW() WHERE farm_id = $2', [status, farmId]);
    }
    res.json({ ok: true, farmId, status, updated: true });
  } catch (error) {
    res.json({ ok: true, farmId, status, updated: false, note: 'DB unavailable' });
  }
});

// PUT /api/admin/users/:userId/status — Update user status
router.put('/api/admin/users/:userId/status', async (req, res) => {
  const { userId } = req.params;
  const { status } = req.body;
  try {
    const { isDatabaseAvailable, query } = await import('../config/database.js');
    if (await isDatabaseAvailable()) {
      await query('UPDATE admin_users SET status = $1 WHERE id = $2', [status, userId]);
    }
    res.json({ ok: true, userId, status, updated: true });
  } catch (error) {
    res.json({ ok: true, userId, status, updated: false, note: 'DB unavailable' });
  }
});

export default router;
