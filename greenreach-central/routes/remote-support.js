/**
 * Remote Support Routes
 * Enables Central to remotely manage and diagnose Light Engine edge devices
 * 
 * Capabilities:
 *   - Health/diagnostics proxy
 *   - Log streaming (last N lines)
 *   - Remote restart commands
 *   - Device info (uptime, disk, memory)
 *   - Connectivity test
 */

import express from 'express';
import logger from '../utils/logger.js';
import { listNetworkFarms } from '../services/networkFarmsStore.js';

const router = express.Router();

/**
 * Resolve a farm by ID or return the only registered farm
 */
async function resolveFarm(farmId) {
  const farms = await listNetworkFarms();
  if (!farms || farms.length === 0) return { error: 'No farms registered in network', status: 503 };

  let target;
  if (farmId) {
    target = farms.find(f => (f.farm_id || f.id) === farmId);
    if (!target) return { error: `Farm ${farmId} not found`, status: 404 };
  } else if (farms.length === 1) {
    target = farms[0];
  } else {
    return {
      error: 'Multiple farms — specify farmId',
      farms: farms.map(f => ({ id: f.farm_id || f.id, name: f.name })),
      status: 400
    };
  }

  const baseUrl = target.api_url || target.endpoint || target.url;
  if (!baseUrl) return { error: `Farm ${target.farm_id} has no endpoint URL`, status: 500 };

  return { farm: target, baseUrl };
}

/**
 * Proxy a GET request to a farm edge device
 */
async function farmProxy(baseUrl, path, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(`${baseUrl}${path}`, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' }
    });
    clearTimeout(timeout);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return { ok: true, data: await resp.json() };
  } catch (err) {
    clearTimeout(timeout);
    return { ok: false, error: err.message };
  }
}

// ── GET /api/remote/farms ────────────────────────────
// List all registered farms with connectivity status
router.get('/farms', async (req, res) => {
  try {
    const farms = await listNetworkFarms();
    const results = await Promise.allSettled(
      farms.map(async (f) => {
        const url = f.api_url || f.endpoint || f.url;
        if (!url) return { ...f, reachable: false, reason: 'no_url' };
        const health = await farmProxy(url, '/health', 5000);
        return {
          farm_id: f.farm_id || f.id,
          name: f.name,
          url,
          reachable: health.ok,
          health: health.ok ? health.data : null,
          error: health.ok ? undefined : health.error
        };
      })
    );

    res.json({
      ok: true,
      farms: results.map(r => r.status === 'fulfilled' ? r.value : { reachable: false }),
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /api/remote/:farmId/health ───────────────────
// Full health + diagnostics from edge device
router.get('/:farmId/health', async (req, res) => {
  const resolved = await resolveFarm(req.params.farmId);
  if (resolved.error) return res.status(resolved.status).json({ ok: false, ...resolved });

  const result = await farmProxy(resolved.baseUrl, '/health');
  if (!result.ok) return res.status(502).json({ ok: false, error: result.error, farm_id: req.params.farmId });

  res.json({ ok: true, farm_id: req.params.farmId, ...result.data });
});

// ── GET /api/remote/:farmId/diagnostics ──────────────
// System diagnostics: uptime, memory, disk, node version
router.get('/:farmId/diagnostics', async (req, res) => {
  const resolved = await resolveFarm(req.params.farmId);
  if (resolved.error) return res.status(resolved.status).json({ ok: false, ...resolved });

  // Try the diagnostics endpoint first, fall back to health
  let result = await farmProxy(resolved.baseUrl, '/api/diagnostics');
  if (!result.ok) {
    result = await farmProxy(resolved.baseUrl, '/health');
  }
  if (!result.ok) return res.status(502).json({ ok: false, error: result.error });

  res.json({ ok: true, farm_id: req.params.farmId, diagnostics: result.data });
});

// ── GET /api/remote/:farmId/logs ─────────────────────
// Stream recent logs from the edge device (if edge exposes /api/logs)
router.get('/:farmId/logs', async (req, res) => {
  const resolved = await resolveFarm(req.params.farmId);
  if (resolved.error) return res.status(resolved.status).json({ ok: false, ...resolved });

  const lines = parseInt(req.query.lines) || 100;
  const result = await farmProxy(resolved.baseUrl, `/api/logs?lines=${lines}`, 20000);
  if (!result.ok) {
    return res.status(502).json({
      ok: false,
      error: result.error,
      hint: 'Edge device may not expose /api/logs — ensure server-foxtrot.js has the logs endpoint'
    });
  }

  res.json({ ok: true, farm_id: req.params.farmId, ...result.data });
});

// ── GET /api/remote/:farmId/sync-status ──────────────
// Get sync status from the edge device
router.get('/:farmId/sync-status', async (req, res) => {
  const resolved = await resolveFarm(req.params.farmId);
  if (resolved.error) return res.status(resolved.status).json({ ok: false, ...resolved });

  const result = await farmProxy(resolved.baseUrl, '/api/sync/status');
  if (!result.ok) {
    return res.status(502).json({ ok: false, error: result.error });
  }

  res.json({ ok: true, farm_id: req.params.farmId, ...result.data });
});

// ── POST /api/remote/:farmId/restart ─────────────────
// Send restart command to edge device (requires edge to support POST /api/admin/restart)
router.post('/:farmId/restart', async (req, res) => {
  const resolved = await resolveFarm(req.params.farmId);
  if (resolved.error) return res.status(resolved.status).json({ ok: false, ...resolved });

  logger.warn(`[RemoteSupport] Restart requested for farm ${req.params.farmId}`);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const resp = await fetch(`${resolved.baseUrl}/api/admin/restart`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' }
    });
    clearTimeout(timeout);

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    res.json({ ok: true, farm_id: req.params.farmId, ...data });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

// ── GET /api/remote/:farmId/data/:file ───────────────
// Inspect any data file on the edge device
router.get('/:farmId/data/:file', async (req, res) => {
  const resolved = await resolveFarm(req.params.farmId);
  if (resolved.error) return res.status(resolved.status).json({ ok: false, ...resolved });

  const file = req.params.file;
  // Whitelist safe filenames
  const allowed = ['groups.json', 'rooms.json', 'farm.json', 'iot-devices.json', 'room-map.json', 'schedules.json'];
  if (!allowed.includes(file)) {
    return res.status(400).json({ ok: false, error: `File ${file} not in allowed list: ${allowed.join(', ')}` });
  }

  const result = await farmProxy(resolved.baseUrl, `/data/${file}`);
  if (!result.ok) return res.status(502).json({ ok: false, error: result.error });

  res.json({ ok: true, farm_id: req.params.farmId, file, data: result.data });
});

// ── POST /api/remote/:farmId/sync-now ────────────────
// Trigger an on-demand sync push from Central to edge (or edge to Central)
router.post('/:farmId/sync-now', async (req, res) => {
  const resolved = await resolveFarm(req.params.farmId);
  if (resolved.error) return res.status(resolved.status).json({ ok: false, ...resolved });

  logger.info(`[RemoteSupport] On-demand sync triggered for farm ${req.params.farmId}`);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    const resp = await fetch(`${resolved.baseUrl}/api/sync/push`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' }
    });
    clearTimeout(timeout);

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    res.json({ ok: true, farm_id: req.params.farmId, ...data });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message, hint: 'Edge may not support POST /api/sync/push' });
  }
});

export default router;
