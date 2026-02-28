/**
 * Alerts Routes
 * Returns farm environmental alerts from the alert-manager service.
 */
import express from 'express';
import { query, isDatabaseAvailable } from '../config/database.js';

const router = express.Router();

/**
 * GET /api/alerts/
 * Returns active and recent alerts for the authenticated farm.
 * Query params: ?status=active|resolved|all  &limit=50
 */
router.get('/', async (req, res) => {
  try {
    const farmId = req.farmId;
    const status = req.query.status || 'active';
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));

    if (!isDatabaseAvailable()) {
      return res.json({
        success: true,
        alerts: [],
        total: 0,
        message: 'Database not available — alert history unavailable',
      });
    }

    // Resolve farm DB id
    const farmRow = farmId
      ? await query('SELECT id FROM farms WHERE farm_id = $1', [farmId])
      : { rows: [] };
    const farmDbId = farmRow.rows[0]?.id;

    let sql, params;
    if (farmDbId) {
      const resolvedClause = status === 'all' ? '' : status === 'resolved' ? 'AND resolved = true' : 'AND resolved = false';
      sql = `SELECT id, alert_type, severity, message, resolved, created_at
             FROM farm_alerts WHERE farm_id = $1 ${resolvedClause}
             ORDER BY created_at DESC LIMIT $2`;
      params = [farmDbId, limit];
    } else {
      // No specific farm — return across all farms (admin view)
      const resolvedClause = status === 'all' ? '' : status === 'resolved' ? 'AND a.resolved = true' : 'AND a.resolved = false';
      sql = `SELECT a.id, a.alert_type, a.severity, a.message,
                    a.resolved, a.created_at, f.farm_id
             FROM farm_alerts a LEFT JOIN farms f ON f.id = a.farm_id
             WHERE 1=1 ${resolvedClause}
             ORDER BY a.created_at DESC LIMIT $1`;
      params = [limit];
    }

    const result = await query(sql, params);

    res.json({
      success: true,
      alerts: result.rows,
      total: result.rows.length,
      filter: status,
    });
  } catch (err) {
    // Table may not exist yet or column mismatch — degrade gracefully
    if (err.message?.includes('does not exist') || err.message?.includes('farm_alerts')) {
      return res.json({ success: true, alerts: [], total: 0, message: 'Alert table not initialized — no alerts recorded yet' });
    }
    console.error('[Alerts] Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load alerts' });
  }
});

/**
 * POST /api/alerts/:alertId/resolve
 * Mark an alert as resolved.
 */
router.post('/:alertId/resolve', async (req, res) => {
  try {
    if (!isDatabaseAvailable()) {
      return res.status(503).json({ success: false, error: 'Database not available' });
    }
    await query(
      'UPDATE farm_alerts SET resolved = true, resolved_at = NOW() WHERE id = $1',
      [req.params.alertId]
    );
    res.json({ success: true, message: 'Alert resolved' });
  } catch (err) {
    console.error('[Alerts] Resolve error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to resolve alert' });
  }
});

export default router;
