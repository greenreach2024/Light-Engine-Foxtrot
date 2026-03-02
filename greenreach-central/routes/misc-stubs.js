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
import { farmStore } from '../lib/farm-data-store.js';
import { query } from '../config/database.js';

const router = Router();

// ═══════════ Quality Tests — MOVED to routes/quality-reports.js ═══════════
// Legacy stubs removed. Quality endpoints now served by /api/quality/* router.

// ═══════════ Room Mapper (persisted via farmStore) ═══════════
router.post('/api/room-mapper/save', async (req, res) => {
  const { roomId, layout } = req.body;
  console.log(`[Room Mapper] Save request: room=${roomId}, elements=${Array.isArray(layout) ? layout.length : 'N/A'}`);
  try {
    const fid = farmStore.farmIdFromReq(req);
    const existing = await farmStore.get(fid, 'room_layouts') || {};
    existing[roomId] = { layout, updatedAt: new Date().toISOString() };
    await farmStore.set(fid, 'room_layouts', existing);
  } catch (e) { console.warn('[Room Mapper] Could not persist layout:', e.message); }
  res.json({ ok: true, roomId, saved: true });
});

// ═══════════ Harvest ═══════════
router.get('/api/harvest/predictions', async (req, res) => {
  // Read groups to compute basic predictions
  try {
    const fid = farmStore.farmIdFromReq(req);
    const groups = await farmStore.get(fid, 'groups') || [];

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

router.post('/api/harvest', async (req, res) => {
  const entry = { id: `H-${Date.now()}`, ...req.body, recordedAt: new Date().toISOString() };
  console.log(`[Harvest] Recorded: crop=${entry.crop}, qty=${entry.quantity}, date=${entry.date || entry.recordedAt}`);
  try {
    const fid = farmStore.farmIdFromReq(req);
    const existing = await farmStore.get(fid, 'harvest_records') || [];
    const list = Array.isArray(existing) ? existing : (existing.records || []);
    list.push(entry);
    if (list.length > 500) list.splice(0, list.length - 500); // Keep last 500
    await farmStore.set(fid, 'harvest_records', list);
  } catch (e) { console.warn('[Harvest] Could not persist record:', e.message); }
  res.json({ ok: true, ...entry });
});

// ═══════════ Dedicated Crops ═══════════
router.get('/api/dedicated-crops', async (req, res) => {
  try {
    const fid = farmStore.farmIdFromReq(req);
    const data = await farmStore.get(fid, 'dedicated_crops') || [];
    return res.json({ ok: true, crops: Array.isArray(data) ? data : (data.crops || []) });
  } catch {
    res.json({ ok: true, crops: [] });
  }
});

router.post('/api/dedicated-crops', async (req, res) => {
  try {
    const fid = farmStore.farmIdFromReq(req);
    const crops = req.body.crops || req.body;
    await farmStore.set(fid, 'dedicated_crops', { crops, updatedAt: new Date().toISOString() });
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
router.get('/api/farm/stripe/status', (req, res) => {
  res.json({
    ok: true,
    connected: false,
    status: 'not_connected',
    message: 'Stripe integration not configured on this instance',
  });
});

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

// ═══════════ AI Decision Recording (persisted — training signal per Rule 8.1) ═══════════
router.post('/api/ai/record-decision', async (req, res) => {
  const { decision, context, outcome } = req.body;
  const entry = { id: `AI-${Date.now()}`, decision, context, outcome, recordedAt: new Date().toISOString() };
  console.log(`[AI] Decision recorded: ${decision} context=${JSON.stringify(context || {}).slice(0, 100)}`);
  try {
    const fid = farmStore.farmIdFromReq(req);
    const existing = await farmStore.get(fid, 'ai_decisions') || [];
    const list = Array.isArray(existing) ? existing : (existing.decisions || []);
    list.push(entry);
    if (list.length > 1000) list.splice(0, list.length - 1000); // Keep last 1000
    await farmStore.set(fid, 'ai_decisions', list);
  } catch (e) { console.warn('[AI] Could not persist decision:', e.message); }
  res.json({ ok: true, ...entry });
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

router.get('/forwarder/devicedatas', async (req, res) => {
  try {
    const fid = farmStore.farmIdFromReq(req);
    let targetBase = process.env.FOXTROT_API_URL || '';

    if (fid) {
      try {
        const farmResult = await query('SELECT api_url FROM farms WHERE farm_id = $1 LIMIT 1', [fid]);
        const farmApiUrl = farmResult.rows?.[0]?.api_url;
        if (farmApiUrl && String(farmApiUrl).trim()) {
          targetBase = String(farmApiUrl).trim();
        }
      } catch (dbErr) {
        console.warn('[Compat] /forwarder/devicedatas farm endpoint lookup failed:', dbErr.message);
      }
    }

    if (!targetBase) {
      return res.status(503).json({ ok: false, error: 'No farm endpoint configured' });
    }

    const normalizedBase = targetBase.replace(/\/$/, '');
    const upstream = await fetch(`${normalizedBase}/forwarder/devicedatas`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10000)
    });

    const contentType = upstream.headers.get('content-type') || 'application/json';
    const body = await upstream.text();
    return res.status(upstream.status).set('content-type', contentType).send(body);
  } catch (error) {
    console.warn('[Compat] /forwarder/devicedatas failed:', error.message);
    return res.status(502).json({ ok: false, error: error.message });
  }
});

router.get('/api/devicedatas', async (req, res) => {
  try {
    const fid = farmStore.farmIdFromReq(req);
    let targetBase = process.env.FOXTROT_API_URL || '';

    if (fid) {
      try {
        const farmResult = await query('SELECT api_url FROM farms WHERE farm_id = $1 LIMIT 1', [fid]);
        const farmApiUrl = farmResult.rows?.[0]?.api_url;
        if (farmApiUrl && String(farmApiUrl).trim()) {
          targetBase = String(farmApiUrl).trim();
        }
      } catch (dbErr) {
        console.warn('[Compat] /api/devicedatas farm endpoint lookup failed:', dbErr.message);
      }
    }

    if (!targetBase) {
      return res.status(503).json({ ok: false, error: 'No farm endpoint configured' });
    }

    const normalizedBase = targetBase.replace(/\/$/, '');
    const upstream = await fetch(`${normalizedBase}/api/devicedatas`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10000)
    });

    const contentType = upstream.headers.get('content-type') || 'application/json';
    const body = await upstream.text();
    return res.status(upstream.status).set('content-type', contentType).send(body);
  } catch (error) {
    console.warn('[Compat] /api/devicedatas failed:', error.message);
    return res.status(502).json({ ok: false, error: error.message });
  }
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
