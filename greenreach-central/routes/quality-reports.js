/**
 * Quality Reports Routes — Lab Report Metadata Management
 *
 * Stores lab report records (metadata only - not file uploads) via farmStore.
 * Growers record that a lab test was done, its type, result, and notes.
 * Actual PDF/paper reports are kept offline or uploaded to a future document store.
 *
 * Endpoints:
 *   GET  /api/quality/reports         - List lab reports for farm
 *   POST /api/quality/reports         - Record a new lab report
 *   DELETE /api/quality/reports/:id   - Delete a lab report
 *
 * Also proxies QA checkpoint data from Foxtrot edge server:
 *   GET  /api/quality/stats           - QA checkpoint statistics
 *   GET  /api/quality/checkpoints     - QA checkpoint list
 *   GET  /api/quality/dashboard       - QA dashboard (recent + alerts)
 */
import { Router } from 'express';
import { farmStore } from '../lib/farm-data-store.js';

const router = Router();

// ═══════════ Lab Report Metadata (farmStore) ═══════════

/**
 * GET /api/quality/reports
 * List all lab reports for the current farm
 */
router.get('/reports', async (req, res) => {
  try {
    const farmId = req.farmId || req.headers['x-farm-id'] || req.query.farmId;
    if (!farmId) {
      return res.status(400).json({ ok: false, error: 'Missing farm ID' });
    }

    const reports = await farmStore.get(farmId, 'lab_reports') || [];
    const list = Array.isArray(reports) ? reports : [];

    // Sort by date descending
    list.sort((a, b) => new Date(b.test_date || b.created_at) - new Date(a.test_date || a.created_at));

    res.json({ ok: true, reports: list, total: list.length });
  } catch (err) {
    console.error('[Quality Reports] GET error:', err.message);
    res.json({ ok: true, reports: [], total: 0 });
  }
});

/**
 * POST /api/quality/reports
 * Record a new lab report entry (metadata only)
 *
 * Body: { report_type, test_date, lab_name, result, lot_code, notes }
 *   report_type: 'microbial' | 'gap_audit' | 'nutrient' | 'pesticide' | 'water' | 'other'
 *   result: 'pass' | 'fail' | 'pending'
 */
router.post('/reports', async (req, res) => {
  try {
    const farmId = req.farmId || req.headers['x-farm-id'];
    if (!farmId) {
      return res.status(400).json({ ok: false, error: 'Missing farm ID' });
    }

    const { report_type, test_date, lab_name, result, lot_code, notes } = req.body;

    if (!report_type) {
      return res.status(400).json({ ok: false, error: 'report_type is required' });
    }

    const entry = {
      id: `LR-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      report_type: report_type || 'other',
      test_date: test_date || new Date().toISOString().split('T')[0],
      lab_name: lab_name || '',
      result: result || 'pending',
      lot_code: lot_code || '',
      notes: notes || '',
      created_at: new Date().toISOString(),
      created_by: req.user?.name || req.headers['x-user-name'] || 'Unknown'
    };

    const existing = await farmStore.get(farmId, 'lab_reports') || [];
    const list = Array.isArray(existing) ? existing : [];
    list.push(entry);
    await farmStore.set(farmId, 'lab_reports', list);

    res.json({ ok: true, report: entry });
  } catch (err) {
    console.error('[Quality Reports] POST error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to save lab report' });
  }
});

/**
 * DELETE /api/quality/reports/:id
 * Remove a lab report entry
 */
router.delete('/reports/:id', async (req, res) => {
  try {
    const farmId = req.farmId || req.headers['x-farm-id'];
    if (!farmId) {
      return res.status(400).json({ ok: false, error: 'Missing farm ID' });
    }

    const existing = await farmStore.get(farmId, 'lab_reports') || [];
    const list = Array.isArray(existing) ? existing : [];
    const filtered = list.filter(r => r.id !== req.params.id);

    if (filtered.length === list.length) {
      return res.status(404).json({ ok: false, error: 'Report not found' });
    }

    await farmStore.set(farmId, 'lab_reports', filtered);
    res.json({ ok: true, deleted: req.params.id });
  } catch (err) {
    console.error('[Quality Reports] DELETE error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to delete lab report' });
  }
});

// ═══════════ QA Checkpoint Proxies (forward to Foxtrot) ═══════════
// These routes proxy to the Foxtrot edge server's /api/qa/* endpoints.
// When running cloud-only (no Foxtrot), they return empty defaults.

/**
 * GET /api/quality/stats
 * Proxy to Foxtrot /api/qa/stats
 */
router.get('/stats', async (req, res) => {
  try {
    const farmId = req.farmId || req.headers['x-farm-id'];
    // Try to proxy to Foxtrot
    const foxtrotUrl = req.headers['x-foxtrot-url'] || process.env.FOXTROT_URL;
    if (foxtrotUrl) {
      const resp = await fetch(`${foxtrotUrl}/api/qa/stats?farm_id=${farmId || ''}&days=${req.query.days || 30}`);
      if (resp.ok) {
        const data = await resp.json();
        return res.json(data);
      }
    }

    // Fallback: compute from farmStore quality_tests (legacy data)
    const tests = await farmStore.get(farmId, 'quality_tests') || [];
    const list = Array.isArray(tests) ? tests : [];
    const passCount = list.filter(t => t.result === 'pass').length;
    const failCount = list.filter(t => t.result === 'fail').length;
    const pendingCount = list.filter(t => t.result === 'pending').length;
    const total = list.length;

    res.json({
      success: true,
      stats: {
        total_checkpoints: total,
        pass_count: passCount,
        fail_count: failCount,
        pending_count: pendingCount,
        pass_rate: total > 0 ? ((passCount / total) * 100).toFixed(1) : '0',
        by_type: {}
      }
    });
  } catch (err) {
    console.error('[Quality Stats] Error:', err.message);
    res.json({
      success: true,
      stats: { total_checkpoints: 0, pass_count: 0, fail_count: 0, pending_count: 0, pass_rate: '0', by_type: {} }
    });
  }
});

/**
 * GET /api/quality/checkpoints
 * Proxy to Foxtrot /api/qa/checkpoints/list
 */
router.get('/checkpoints', async (req, res) => {
  try {
    const farmId = req.farmId || req.headers['x-farm-id'];
    const foxtrotUrl = req.headers['x-foxtrot-url'] || process.env.FOXTROT_URL;
    if (foxtrotUrl) {
      const qs = new URLSearchParams({
        farm_id: farmId || '',
        limit: req.query.limit || '50',
        offset: req.query.offset || '0',
        ...(req.query.checkpoint_type ? { checkpoint_type: req.query.checkpoint_type } : {}),
        ...(req.query.result ? { result: req.query.result } : {})
      });
      const resp = await fetch(`${foxtrotUrl}/api/qa/checkpoints/list?${qs}`);
      if (resp.ok) {
        const data = await resp.json();
        return res.json(data);
      }
    }

    // Fallback: return legacy quality_tests from farmStore
    const tests = await farmStore.get(farmId, 'quality_tests') || [];
    const list = Array.isArray(tests) ? tests : [];
    res.json({
      success: true,
      data: {
        checkpoints: list.map(t => ({
          id: t.id,
          batch_id: t.batchId || t.batch_id || '',
          checkpoint_type: t.category || t.testType || 'visual',
          inspector: t.tester || t.inspector || 'Unknown',
          result: t.result || 'pending',
          notes: t.notes || '',
          has_photo: false,
          created_at: t.date || t.recordedAt || t.created_at || new Date().toISOString()
        })),
        count: list.length,
        limit: 50,
        offset: 0
      }
    });
  } catch (err) {
    console.error('[Quality Checkpoints] Error:', err.message);
    res.json({ success: true, data: { checkpoints: [], count: 0, limit: 50, offset: 0 } });
  }
});

/**
 * GET /api/quality/dashboard
 * Proxy to Foxtrot /api/qa/dashboard
 */
router.get('/dashboard', async (req, res) => {
  try {
    const farmId = req.farmId || req.headers['x-farm-id'];
    const foxtrotUrl = req.headers['x-foxtrot-url'] || process.env.FOXTROT_URL;
    if (foxtrotUrl) {
      const resp = await fetch(`${foxtrotUrl}/api/qa/dashboard?farm_id=${farmId || ''}`);
      if (resp.ok) {
        const data = await resp.json();
        return res.json(data);
      }
    }

    // Fallback: empty dashboard
    res.json({
      success: true,
      data: { recent_checkpoints: [], failed_checkpoints: [], alerts: [] }
    });
  } catch (err) {
    console.error('[Quality Dashboard] Error:', err.message);
    res.json({ success: true, data: { recent_checkpoints: [], failed_checkpoints: [], alerts: [] } });
  }
});

export default router;
