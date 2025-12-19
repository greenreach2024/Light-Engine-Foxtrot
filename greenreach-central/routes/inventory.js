import express from 'express';
import { query } from '../config/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { ValidationError } from '../middleware/errorHandler.js';

const router = express.Router();

// POST /api/inventory/sync - Sync inventory from edge device
router.post('/sync', async (req, res, next) => {
  try {
    const farmId = req.headers['x-farm-id'];
    const apiKey = req.headers['x-api-key'];
    
    if (!farmId || !apiKey) {
      throw new ValidationError('Farm ID and API key required');
    }

    const { products } = req.body;
    
    if (!Array.isArray(products)) {
      throw new ValidationError('Products must be an array');
    }

    // Verify farm exists and API key is valid
    const farmCheck = await query(
      'SELECT farm_id FROM farms WHERE farm_id = $1 AND api_key = $2',
      [farmId, apiKey]
    );

    if (farmCheck.rows.length === 0) {
      throw new ValidationError('Invalid farm ID or API key');
    }

    // Begin transaction
    const client = await query.getClient();
    
    try {
      await client.query('BEGIN');

      // Delete existing inventory for this farm
      await client.query('DELETE FROM farm_inventory WHERE farm_id = $1', [farmId]);

      // Insert new inventory
      for (const product of products) {
        await client.query(`
          INSERT INTO farm_inventory (
            farm_id, product_id, product_name, category, variety,
            quantity_available, quantity_reserved, quantity_unit,
            wholesale_price, retail_price, status,
            synced_at, source_data
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), $12)
        `, [
          farmId,
          product.product_id,
          product.product_name,
          product.category,
          product.variety,
          product.quantity_available,
          product.quantity_reserved || 0,
          product.quantity_unit,
          product.wholesale_price,
          product.retail_price,
          product.status || 'available',
          JSON.stringify(product.metadata || {})
        ]);
      }

      // Update farm last_sync timestamp
      await client.query(
        'UPDATE farms SET last_sync = NOW() WHERE farm_id = $1',
        [farmId]
      );

      await client.query('COMMIT');

      res.json({
        success: true,
        message: 'Inventory synced successfully',
        productsCount: products.length
      });

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

  } catch (error) {
    next(error);
  }
});

// GET /api/inventory/farms/:id - Get farm inventory
router.get('/farms/:id', authMiddleware, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { category, status } = req.query;

    let queryText = 'SELECT * FROM farm_inventory WHERE farm_id = $1';
    const queryParams = [id];
    let paramCount = 1;

    if (category) {
      paramCount++;
      queryText += ` AND category = $${paramCount}`;
      queryParams.push(category);
    }

    if (status) {
      paramCount++;
      queryText += ` AND status = $${paramCount}`;
      queryParams.push(status);
    }

    queryText += ' ORDER BY product_name';

    const result = await query(queryText, queryParams);

    res.json({
      success: true,
      products: result.rows,
      count: result.rows.length
    });

  } catch (error) {
    next(error);
  }
});

// GET /api/inventory/available - Get all available inventory across farms
router.get('/available', authMiddleware, async (req, res, next) => {
  try {
    const { category, min_quantity } = req.query;

    let queryText = `
      SELECT 
        i.*, 
        f.name as farm_name,
        f.city, f.state
      FROM farm_inventory i
      JOIN farms f ON i.farm_id = f.farm_id
      WHERE i.status = 'available' 
        AND f.status = 'active'
        AND f.wholesale_enabled = true
    `;
    
    const queryParams = [];
    let paramCount = 0;

    if (category) {
      paramCount++;
      queryText += ` AND i.category = $${paramCount}`;
      queryParams.push(category);
    }

    if (min_quantity) {
      paramCount++;
      queryText += ` AND i.quantity_available >= $${paramCount}`;
      queryParams.push(min_quantity);
    }

    queryText += ' ORDER BY i.product_name, f.name';

    const result = await query(queryText, queryParams);

    res.json({
      success: true,
      products: result.rows,
      count: result.rows.length
    });

  } catch (error) {
    next(error);
  }
});

export default router;
