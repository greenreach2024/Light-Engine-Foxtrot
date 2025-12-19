import express from 'express';
import { query } from '../config/database.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

// GET /api/alerts - Get all alerts with filters
router.get('/', authMiddleware, async (req, res, next) => {
  try {
    const { farm_id, status, severity, alert_type, limit = 50 } = req.query;

    let queryText = `
      SELECT a.*, f.name as farm_name
      FROM farm_alerts a
      JOIN farms f ON a.farm_id = f.farm_id
      WHERE 1=1
    `;
    const queryParams = [];
    let paramCount = 0;

    if (farm_id) {
      paramCount++;
      queryText += ` AND a.farm_id = $${paramCount}`;
      queryParams.push(farm_id);
    }

    if (status) {
      paramCount++;
      queryText += ` AND a.status = $${paramCount}`;
      queryParams.push(status);
    }

    if (severity) {
      paramCount++;
      queryText += ` AND a.severity = $${paramCount}`;
      queryParams.push(severity);
    }

    if (alert_type) {
      paramCount++;
      queryText += ` AND a.alert_type = $${paramCount}`;
      queryParams.push(alert_type);
    }

    queryText += ` ORDER BY a.created_at DESC LIMIT $${paramCount + 1}`;
    queryParams.push(limit);

    const result = await query(queryText, queryParams);

    res.json({
      success: true,
      alerts: result.rows,
      count: result.rows.length
    });

  } catch (error) {
    next(error);
  }
});

// POST /api/alerts/:id/acknowledge - Acknowledge an alert
router.post('/:id/acknowledge', authMiddleware, async (req, res, next) => {
  try {
    const { id } = req.params;

    const result = await query(`
      UPDATE farm_alerts
      SET 
        status = 'acknowledged',
        acknowledged_at = NOW(),
        acknowledged_by = $1
      WHERE alert_id = $2
      RETURNING *
    `, [req.user.email, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Alert not found'
      });
    }

    res.json({
      success: true,
      alert: result.rows[0]
    });

  } catch (error) {
    next(error);
  }
});

// POST /api/alerts/:id/resolve - Resolve an alert
router.post('/:id/resolve', authMiddleware, async (req, res, next) => {
  try {
    const { id } = req.params;

    const result = await query(`
      UPDATE farm_alerts
      SET 
        status = 'resolved',
        resolved_at = NOW(),
        resolved_by = $1
      WHERE alert_id = $2
      RETURNING *
    `, [req.user.email, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Alert not found'
      });
    }

    res.json({
      success: true,
      alert: result.rows[0]
    });

  } catch (error) {
    next(error);
  }
});

export default router;
