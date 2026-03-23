/**
 * Farm Sales - Inventory Management
 * Real-time inventory tracking for farm products (MULTI-TENANT)
 */

import express from 'express';
import { farmAuthMiddleware } from '../../lib/farm-auth.js';
import { farmStores } from '../../lib/farm-store.js';
import { convertToWholesaleLots } from '../../lib/wholesale-integration.js';

const router = express.Router();

// Apply authentication to all routes
router.use(farmAuthMiddleware);

/**
 * GET /api/farm-sales/inventory
 * Get current inventory with availability (farm-scoped)
 * 
 * Query params:
 * - category: Filter by category
 * - available_only: Only show items with quantity > 0
 * - search: Search by name
 */
router.get('/', async (req, res) => {
  try {
    const { category, available_only, search } = req.query;
    const farmId = req.farm_id; // From auth middleware
    
    let products = farmStores.inventory.getAllForFarm(farmId);

    // Merge manual inventory from PostgreSQL farm_inventory table
    const db = req.app.locals.db;
    if (db) {
      try {
        const pgResult = await db.query(
          'SELECT * FROM farm_inventory WHERE farm_id = $1 ORDER BY product_name',
          [farmId]
        );
        const existingSkus = new Set(products.map(p => p.sku_id));
        for (const row of pgResult.rows) {
          const skuKey = row.sku_id || row.product_id;
          if (!existingSkus.has(skuKey)) {
            products.push({
              sku_id: skuKey,
              product_id: row.product_id,
              name: row.product_name,
              product_name: row.product_name,
              sku_name: row.sku_name || row.product_name,
              sku: row.sku || skuKey,
              category: row.category || 'produce',
              unit: row.unit || 'lb',
              quantity: Number(row.quantity_available || row.quantity || 0),
              available: Number(row.quantity_available || row.quantity || 0),
              quantity_available: Number(row.quantity_available || row.quantity || 0),
              reserved: 0,
              unit_price: Number(row.retail_price || row.price || 0),
              retail_price: Number(row.retail_price || row.price || 0),
              wholesale_price: Number(row.wholesale_price || row.price || 0),
              price: Number(row.retail_price || row.price || 0),
              inventory_source: row.inventory_source || 'manual',
              last_updated: row.last_updated,
              updated_at: row.last_updated
            });
            existingSkus.add(skuKey);
          }
        }
        if (pgResult.rows.length > 0) {
          console.log(`[farm-sales] Merged ${pgResult.rows.length} PostgreSQL inventory rows for farm ${farmId}`);
        }
      } catch (pgErr) {
        console.warn('[farm-sales] PostgreSQL inventory query failed, using NeDB only:', pgErr.message);
      }
    }

    // Apply filters
    if (category) {
      products = products.filter(p => p.category === category);
    }
    if (available_only === 'true') {
      products = products.filter(p => p.available > 0);
    }
    if (search) {
      const term = search.toLowerCase();
      products = products.filter(p => 
        p.name.toLowerCase().includes(term) ||
        p.sku_id.toLowerCase().includes(term)
      );
    }

    // Calculate totals
    const totals = {
      total_skus: products.length,
      total_quantity: products.reduce((sum, p) => sum + p.quantity, 0),
      total_available: products.reduce((sum, p) => sum + p.available, 0),
      total_reserved: products.reduce((sum, p) => sum + p.reserved, 0),
      total_value: products.reduce((sum, p) => sum + (p.quantity * p.unit_price), 0)
    };

    res.json({
      ok: true,
      farm_id: farmId,
      inventory: products,
      totals,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('[farm-sales] Inventory list failed:', error);
    res.status(500).json({
      ok: false,
      error: 'inventory_list_failed',
      message: error.message
    });
  }
});

/**
 * GET /api/farm-sales/inventory/wholesale
 * Export farm inventory in wholesale catalog format
 * Used by GreenReach to aggregate multi-farm inventory
 * 
 * Returns:
 * {
 *   farm_id: string,
 *   farm_name: string,
 *   inventory_timestamp: ISO timestamp,
 *   lots: [{
 *     lot_id, sku_id, sku_name, qty_available, price_per_unit,
 *     harvest_date_start, harvest_date_end, quality_flags, location
 *   }]
 * }
 */
router.get('/wholesale', async (req, res) => {
  try {
    const farmId = req.farm_id;
    let products = farmStores.inventory.getAllForFarm(farmId);

    // Merge manual inventory from PostgreSQL
    const db = req.app.locals.db;
    if (db) {
      try {
        const pgResult = await db.query(
          "SELECT * FROM farm_inventory WHERE farm_id = $1 AND available_for_wholesale = true ORDER BY product_name",
          [farmId]
        );
        const existingSkus = new Set(products.map(p => p.sku_id));
        for (const row of pgResult.rows) {
          const skuKey = row.sku_id || row.product_id;
          if (!existingSkus.has(skuKey)) {
            products.push({
              sku_id: skuKey,
              product_id: row.product_id,
              name: row.product_name,
              product_name: row.product_name,
              sku_name: row.sku_name || row.product_name,
              sku: row.sku || skuKey,
              category: row.category || 'produce',
              unit: row.unit || 'lb',
              quantity: Number(row.quantity_available || row.quantity || 0),
              available: Number(row.quantity_available || row.quantity || 0),
              reserved: 0,
              unit_price: Number(row.wholesale_price || row.retail_price || row.price || 0),
              retail_price: Number(row.retail_price || row.price || 0),
              wholesale_price: Number(row.wholesale_price || row.price || 0),
              inventory_source: row.inventory_source || 'manual',
              last_updated: row.last_updated
            });
            existingSkus.add(skuKey);
          }
        }
      } catch (pgErr) {
        console.warn('[farm-sales] PostgreSQL wholesale query failed:', pgErr.message);
      }
    }
    
    // Convert farm inventory to wholesale lot format
    const wholesaleInventory = convertToWholesaleLots(farmId, products);
    
    console.log(`[farm-sales] Wholesale inventory sync for ${farmId}`);
    console.log(`  Total lots: ${wholesaleInventory.lots.length}`);
    console.log(`  Available SKUs: ${wholesaleInventory.lots.length}`);
    
    res.json({
      ok: true,
      ...wholesaleInventory
    });
    
  } catch (error) {
    console.error('[farm-sales] Wholesale inventory sync failed:', error);
    res.status(500).json({
      ok: false,
      error: 'wholesale_sync_failed',
      message: error.message
    });
  }
});

/**
 * GET /api/farm-sales/inventory/:skuId
 * Get single product inventory (farm-scoped)
 */
router.get('/:skuId', (req, res) => {
  const { skuId } = req.params;
  const farmId = req.farm_id;
  const product = farmStores.inventory.get(farmId, skuId);

  if (!product) {
    return res.status(404).json({
      ok: false,
      error: 'product_not_found',
      sku_id: skuId
    });
  }

  res.json({
    ok: true,
    product
  });
});

/**
 * POST /api/farm-sales/inventory/reserve
 * Reserve inventory for pending order (TTL hold)
 * 
 * Body:
 * {
 *   items: [{ sku_id, quantity }],
 *   order_id: string,
 *   ttl_seconds?: number (default 900 = 15min)
 * }
 */
router.post('/reserve', (req, res) => {
  try {
    const { items, order_id, ttl_seconds = 900 } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        ok: false,
        error: 'items_required'
      });
    }

    const reservations = [];
    const failures = [];

    // Check availability for all items first
    const farmId = req.farm_id;
    for (const item of items) {
      const product = farmStores.inventory.get(farmId, item.sku_id);
      
      if (!product) {
        failures.push({
          sku_id: item.sku_id,
          reason: 'product_not_found'
        });
        continue;
      }

      if (product.available < item.quantity) {
        failures.push({
          sku_id: item.sku_id,
          requested: item.quantity,
          available: product.available,
          reason: 'insufficient_quantity'
        });
        continue;
      }
    }

    // If any failures, abort entire reservation
    if (failures.length > 0) {
      return res.status(400).json({
        ok: false,
        error: 'reservation_failed',
        failures
      });
    }

    // All items available - reserve them
    const timestamp = new Date().toISOString();
    const expires_at = new Date(Date.now() + ttl_seconds * 1000).toISOString();

    for (const item of items) {
      const product = farmStores.inventory.get(farmId, item.sku_id);
      product.reserved += item.quantity;
      product.available = product.quantity - product.reserved;
      product.updated_at = timestamp;
      farmStores.inventory.set(farmId, item.sku_id, product);

      reservations.push({
        sku_id: item.sku_id,
        name: product.name,
        quantity: item.quantity,
        reserved_at: timestamp,
        expires_at
      });
    }

    // TODO: Set TTL auto-release timer

    res.status(201).json({
      ok: true,
      order_id,
      reservations,
      expires_at
    });

  } catch (error) {
    console.error('[farm-sales] Reservation failed:', error);
    res.status(500).json({
      ok: false,
      error: 'reservation_failed',
      message: error.message
    });
  }
});

/**
 * POST /api/farm-sales/inventory/release
 * Release reserved inventory (order cancelled)
 * 
 * Body:
 * {
 *   items: [{ sku_id, quantity }],
 *   order_id: string
 * }
 */
router.post('/release', (req, res) => {
  try {
    const { items, order_id } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        ok: false,
        error: 'items_required'
      });
    }

    const released = [];
    const timestamp = new Date().toISOString();

    const farmId = req.farm_id;
    for (const item of items) {
      const product = farmStores.inventory.get(farmId, item.sku_id);
      
      if (!product) {
        continue; // Skip if product doesn't exist
      }

      // Release reservation
      product.reserved = Math.max(0, product.reserved - item.quantity);
      product.available = product.quantity - product.reserved;
      product.updated_at = timestamp;
      farmStores.inventory.set(farmId, item.sku_id, product);

      released.push({
        sku_id: item.sku_id,
        quantity: item.quantity,
        released_at: timestamp
      });
    }

    res.json({
      ok: true,
      order_id,
      released
    });

  } catch (error) {
    console.error('[farm-sales] Release failed:', error);
    res.status(500).json({
      ok: false,
      error: 'release_failed',
      message: error.message
    });
  }
});

/**
 * POST /api/farm-sales/inventory/confirm
 * Confirm reservation and decrement inventory (order completed)
 * 
 * Body:
 * {
 *   items: [{ sku_id, quantity }],
 *   order_id: string
 * }
 */
router.post('/confirm', (req, res) => {
  try {
    const { items, order_id } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        ok: false,
        error: 'items_required'
      });
    }

    const confirmed = [];
    const timestamp = new Date().toISOString();

    const farmId = req.farm_id;
    for (const item of items) {
      const product = farmStores.inventory.get(farmId, item.sku_id);
      
      if (!product) {
        continue; // Skip if product doesn't exist
      }

      // Decrement total quantity and release reservation
      product.quantity = Math.max(0, product.quantity - item.quantity);
      product.reserved = Math.max(0, product.reserved - item.quantity);
      product.available = product.quantity - product.reserved;
      product.updated_at = timestamp;
      farmStores.inventory.set(farmId, item.sku_id, product);

      confirmed.push({
        sku_id: item.sku_id,
        quantity: item.quantity,
        new_quantity: product.quantity,
        new_available: product.available,
        confirmed_at: timestamp
      });
    }

    res.json({
      ok: true,
      order_id,
      confirmed
    });

  } catch (error) {
    console.error('[farm-sales] Confirmation failed:', error);
    res.status(500).json({
      ok: false,
      error: 'confirmation_failed',
      message: error.message
    });
  }
});

/**
 * PATCH /api/farm-sales/inventory/:skuId
 * Update product inventory (restock, adjust pricing)
 * 
 * Body:
 * {
 *   quantity?: number,
 *   unit_price?: number,
 *   retail_price?: number
 * }
 */
router.patch('/:skuId', (req, res) => {
  try {
    const { skuId } = req.params;
    const updates = req.body;
    const farmId = req.farm_id;
    const product = farmStores.inventory.get(farmId, skuId);

    if (!product) {
      return res.status(404).json({
        ok: false,
        error: 'product_not_found',
        sku_id: skuId
      });
    }

    const timestamp = new Date().toISOString();

    // Update fields
    if (typeof updates.quantity === 'number') {
      product.quantity = Math.max(0, updates.quantity);
      product.available = product.quantity - product.reserved;
    }
    if (typeof updates.unit_price === 'number') {
      product.unit_price = Math.max(0, updates.unit_price);
    }
    if (typeof updates.retail_price === 'number') {
      product.retail_price = Math.max(0, updates.retail_price);
    }
    if (updates.lot_code !== undefined) {
      product.lot_code = updates.lot_code; // Link to lot tracking system
    }

    product.updated_at = timestamp;
    farmStores.inventory.set(farmId, skuId, product);

    res.json({
      ok: true,
      product
    });

  } catch (error) {
    console.error('[farm-sales] Inventory update failed:', error);
    res.status(500).json({
      ok: false,
      error: 'update_failed',
      message: error.message
    });
  }
});

/**
 * GET /api/farm-sales/inventory/categories/list
 * Get list of product categories
 */
router.get('/categories/list', (req, res) => {
  const farmId = req.farm_id;
  const products = farmStores.inventory.getAllForFarm(farmId);
  const categories = {};

  products.forEach(product => {
    if (!categories[product.category]) {
      categories[product.category] = {
        category: product.category,
        count: 0,
        total_quantity: 0,
        total_available: 0
      };
    }
    categories[product.category].count++;
    categories[product.category].total_quantity += product.quantity;
    categories[product.category].total_available += product.available;
  });

  res.json({
    ok: true,
    categories: Object.values(categories)
  });
});

/**
 * GET /api/farm-sales/inventory/export
 * Export inventory as CSV for accounting reconciliation
 * 
 * Query params:
 * - category: Filter by category
 * - available_only: Only show items with quantity > 0
 * - include_valuation: Include retail/wholesale values (default: true)
 */
router.get('/export', (req, res) => {
  try {
    const { category, available_only, include_valuation = 'true' } = req.query;
    const farmId = req.farm_id;
    
    let products = farmStores.inventory.getAllForFarm(farmId);

    // Apply filters
    if (category) {
      products = products.filter(p => p.category === category);
    }
    if (available_only === 'true') {
      products = products.filter(p => p.available > 0);
    }

    // Sort by category then name
    products.sort((a, b) => {
      if (a.category !== b.category) {
        return a.category.localeCompare(b.category);
      }
      return a.name.localeCompare(b.name);
    });

    // Generate CSV
    const headers = include_valuation === 'true'
      ? ['SKU ID', 'Product Name', 'Category', 'Unit', 'Available Qty', 'Reserved Qty', 'Total Qty', 'Retail Price', 'Wholesale Price', 'Total Retail Value', 'Total Wholesale Value', 'Last Updated']
      : ['SKU ID', 'Product Name', 'Category', 'Unit', 'Available Qty', 'Reserved Qty', 'Total Qty', 'Last Updated'];

    const rows = products.map(item => {
      const baseRow = [
        item.sku_id,
        item.name,
        item.category,
        item.unit,
        item.available,
        item.reserved || 0,
        item.quantity
      ];

      if (include_valuation === 'true') {
        const retailPrice = item.retail_price || item.unit_price || 0;
        const wholesalePrice = item.wholesale_price || item.unit_price || 0;
        return [
          ...baseRow,
          `$${retailPrice.toFixed(2)}`,
          `$${wholesalePrice.toFixed(2)}`,
          `$${(item.available * retailPrice).toFixed(2)}`,
          `$${(item.available * wholesalePrice).toFixed(2)}`,
          new Date(item.last_updated || item.updated_at || Date.now()).toLocaleString()
        ];
      } else {
        return [
          ...baseRow,
          new Date(item.last_updated || item.updated_at || Date.now()).toLocaleString()
        ];
      }
    });

    // Calculate totals
    const totalUnits = products.reduce((sum, i) => sum + i.available, 0);
    const totalReserved = products.reduce((sum, i) => sum + (i.reserved || 0), 0);
    const totalQuantity = products.reduce((sum, i) => sum + i.quantity, 0);

    if (include_valuation === 'true') {
      const totalRetailValue = products.reduce((sum, i) => 
        sum + (i.available * (i.retail_price || i.unit_price || 0)), 0
      );
      const totalWholesaleValue = products.reduce((sum, i) => 
        sum + (i.available * (i.wholesale_price || i.unit_price || 0)), 0
      );

      rows.push([
        'TOTALS', '', '', '', totalUnits, totalReserved, totalQuantity, '', '', 
        `$${totalRetailValue.toFixed(2)}`, 
        `$${totalWholesaleValue.toFixed(2)}`, 
        ''
      ]);
    } else {
      rows.push([
        'TOTALS', '', '', '', totalUnits, totalReserved, totalQuantity, ''
      ]);
    }

    // Convert to CSV format (properly escape quotes)
    const csv = [
      headers.map(h => `"${h}"`).join(','),
      ...rows.map(row => 
        row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')
      )
    ].join('\n');

    // Set headers for CSV download
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `inventory-${farmId}-${timestamp}.csv`;
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);

    console.log(`[farm-sales] Inventory CSV exported: ${farmId}, ${products.length} items`);

  } catch (error) {
    console.error('[farm-sales] Inventory export failed:', error);
    res.status(500).json({
      ok: false,
      error: 'export_failed',
      message: error.message
    });
  }
});

export default router;
