import express from 'express';
import { query } from '../config/database.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

// GET /api/orders - Get all orders
router.get('/', authMiddleware, async (req, res, next) => {
  try {
    const { status, farm_id, limit = 50 } = req.query;

    let queryText = 'SELECT * FROM wholesale_orders WHERE 1=1';
    const queryParams = [];
    let paramCount = 0;

    if (status) {
      paramCount++;
      queryText += ` AND status = $${paramCount}`;
      queryParams.push(status);
    }

    if (farm_id) {
      paramCount++;
      queryText += ` AND assigned_farms @> $${paramCount}::jsonb`;
      queryParams.push(JSON.stringify([farm_id]));
    }

    queryText += ` ORDER BY created_at DESC LIMIT $${paramCount + 1}`;
    queryParams.push(limit);

    const result = await query(queryText, queryParams);

    res.json({
      success: true,
      orders: result.rows,
      count: result.rows.length
    });

  } catch (error) {
    next(error);
  }
});

// GET /api/orders/:id - Get order details
router.get('/:id', authMiddleware, async (req, res, next) => {
  try {
    const { id } = req.params;

    // Get order
    const orderResult = await query(
      'SELECT * FROM wholesale_orders WHERE order_id = $1',
      [id]
    );

    if (orderResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Get fulfillments
    const fulfillmentsResult = await query(`
      SELECT f.*, fm.name as farm_name
      FROM order_fulfillments f
      JOIN farms fm ON f.farm_id = fm.farm_id
      WHERE f.order_id = $1
    `, [id]);

    res.json({
      success: true,
      order: orderResult.rows[0],
      fulfillments: fulfillmentsResult.rows
    });

  } catch (error) {
    next(error);
  }
});

export default router;
