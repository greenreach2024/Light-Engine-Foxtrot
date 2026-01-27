/**
 * Inventory Routes
 * Receive and store inventory data from edge devices
 */
import express from 'express';
import { query } from '../config/database.js';

const router = express.Router();

/**
 * POST /api/inventory/:farmId/sync
 * Receive inventory sync from edge device
 */
router.post('/:farmId/sync', async (req, res) => {
  try {
    const { farmId } = req.params;
    const { products } = req.body;

    if (!products || !Array.isArray(products)) {
      return res.status(400).json({ error: 'Products array required' });
    }

    console.log(`[Inventory Sync] Received ${products.length} products from farm ${farmId}`);

    // Clear existing inventory for this farm
    await query('DELETE FROM farm_inventory WHERE farm_id = $1', [farmId]);

    // Insert new inventory
    for (const product of products) {
      await query(
        `INSERT INTO farm_inventory (
          farm_id, 
          sku_id, 
          sku_name, 
          quantity_available, 
          unit, 
          price_per_unit,
          updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [
          farmId,
          product.sku || product.product_id,
          product.product_name,
          product.quantity || 0,
          product.unit || 'unit',
          product.price || 0
        ]
      );
    }

    res.json({ 
      success: true, 
      farm_id: farmId,
      products_synced: products.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[Inventory Sync] Error:', error);
    res.status(500).json({ error: 'Failed to sync inventory' });
  }
});

/**
 * GET /api/inventory/:farmId
 * Get current inventory for a farm
 */
router.get('/:farmId', async (req, res) => {
  try {
    const { farmId } = req.params;

    const result = await query(
      'SELECT * FROM farm_inventory WHERE farm_id = $1 ORDER BY product_name',
      [farmId]
    );

    res.json({ 
      farm_id: farmId,
      products: result.rows,
      count: result.rows.length
    });
  } catch (error) {
    console.error('[Inventory] Error:', error);
    res.status(500).json({ error: 'Failed to fetch inventory' });
  }
});

export default router;

