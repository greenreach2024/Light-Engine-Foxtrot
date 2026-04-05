import express from 'express';
import { farmStore } from '../lib/farm-data-store.js';
import { query, isDatabaseAvailable } from '../config/database.js';

const router = express.Router();

/**
 * GreenReach Central — Advanced Inventory Management Routes
 * Manages farm supplies: seeds, nutrients, packaging, equipment, lab supplies
 * All data stored via farmStore (tenant-scoped JSON in farm_data table)
 *
 * farmStore keys used:
 *   inventory_seeds, inventory_nutrients, inventory_packaging,
 *   inventory_equipment, inventory_supplies, inventory_usage_log
 */

// Helper: generate unique ID for an item
function generateId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

// Helper: get farm ID from request
function getFid(req) {
  return farmStore.farmIdFromReq(req);
}

// ═══════════════════════════════════════════════════════
// DASHBOARD & AGGREGATION
// ═══════════════════════════════════════════════════════

/**
 * GET /dashboard — Aggregated inventory overview
 */
router.get('/dashboard', async (req, res) => {
  try {
    const fid = getFid(req);
    const [seeds, nutrients, packaging, equipment, supplies] = await Promise.all([
      farmStore.get(fid, 'inventory_seeds').then(d => d?.items || []).catch(() => []),
      farmStore.get(fid, 'inventory_nutrients').then(d => d?.items || []).catch(() => []),
      farmStore.get(fid, 'inventory_packaging').then(d => d?.items || []).catch(() => []),
      farmStore.get(fid, 'inventory_equipment').then(d => d?.items || []).catch(() => []),
      farmStore.get(fid, 'inventory_supplies').then(d => d?.items || []).catch(() => []),
    ]);

    const allItems = [
      ...seeds.map(i => ({ ...i, _cat: 'seeds' })),
      ...nutrients.map(i => ({ ...i, _cat: 'nutrients' })),
      ...packaging.map(i => ({ ...i, _cat: 'packaging' })),
      ...equipment.map(i => ({ ...i, _cat: 'equipment' })),
      ...supplies.map(i => ({ ...i, _cat: 'supplies' })),
    ];

    const suppliesTotalValue = allItems.reduce((s, i) => {
      const qty = i.quantity || i.qtyOnHand || i.volume_remaining_ml || 0;
      const cost = i.costPerUnit || i.cost_per_unit || i.price || 0;
      return s + qty * cost;
    }, 0);

    // Include crop inventory value from farm_inventory table (manual + auto entries)
    let cropInventoryValue = 0;
    let cropInventoryCount = 0;
    if (await isDatabaseAvailable()) {
      try {
        const cropResult = await query(
          `SELECT
            COUNT(*) FILTER (WHERE COALESCE(quantity_available, 0) > 0) AS crop_count,
            COALESCE(SUM(
              COALESCE(quantity_available, 0) * COALESCE(retail_price, wholesale_price, price, 0)
            ), 0) AS crop_value
           FROM farm_inventory
           WHERE farm_id = $1
             AND COALESCE(status, 'active') != 'inactive'
             AND COALESCE(quantity_available, 0) > 0`,
          [fid]
        );
        cropInventoryValue = Number(cropResult.rows[0]?.crop_value) || 0;
        cropInventoryCount = Number(cropResult.rows[0]?.crop_count) || 0;
      } catch (err) {
        console.warn('[inventory-mgmt] crop inventory query failed:', err.message);
      }
    }

    const totalValue = suppliesTotalValue + cropInventoryValue;

    // Build reorder alerts per category
    const alertsByCategory = { seeds: [], nutrients: [], packaging: [], equipment: [], supplies: [] };
    for (const item of allItems) {
      const qty = item.quantity || item.qtyOnHand || item.stock_level || item.volume_remaining_ml || 0;
      const min = item.reorderPoint || item.minStockLevel || item.min_stock || 0;
      if (min > 0 && qty <= min) {
        alertsByCategory[item._cat].push({
          id: item.id,
          name: item.name || item.type || item.sku,
          current: qty,
          minimum: min,
          category: item._cat,
        });
      }
    }

    res.json({
      ok: true,
      total_value: Math.round(totalValue * 100) / 100,
      supplies_value: Math.round(suppliesTotalValue * 100) / 100,
      crop_inventory_value: Math.round(cropInventoryValue * 100) / 100,
      crop_inventory_count: cropInventoryCount,
      category_counts: {
        seeds: seeds.length,
        nutrients: nutrients.length,
        packaging: packaging.length,
        equipment: equipment.length,
        supplies: supplies.length,
      },
      alerts_by_category: alertsByCategory,
    });
  } catch (error) {
    console.error('Inventory dashboard error:', error);
    res.status(500).json({ ok: false, error: 'dashboard_error' });
  }
});

/**
 * GET /reorder-alerts — All items below minimum stock
 */
router.get('/reorder-alerts', async (req, res) => {
  try {
    const fid = getFid(req);
    const categories = ['seeds', 'nutrients', 'packaging', 'equipment', 'supplies'];
    const alerts = [];

    for (const cat of categories) {
      const data = await farmStore.get(fid, `inventory_${cat}`).catch(() => null);
      for (const item of (data?.items || [])) {
        const qty = item.quantity || item.qtyOnHand || item.stock_level || item.volume_remaining_ml || 0;
        const min = item.reorderPoint || item.minStockLevel || item.min_stock || 0;
        if (min > 0 && qty <= min) {
          alerts.push({
            id: item.id,
            name: item.name || item.type || item.sku,
            category: cat,
            current: qty,
            minimum: min,
            unit: item.unit || item.standardUnit || 'each',
          });
        }
      }
    }

    res.json({ ok: true, alerts });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'reorder_alerts_error' });
  }
});

/**
 * GET /usage/weekly-summary — Aggregated usage for the past week
 */
router.get('/usage/weekly-summary', async (req, res) => {
  try {
    const fid = getFid(req);
    const logData = await farmStore.get(fid, 'inventory_usage_log').catch(() => null);
    const logs = logData?.entries || [];
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const recent = logs.filter(l => l.timestamp >= oneWeekAgo);

    const seedsUsed = {};
    let nutrientsUsedMl = {};
    let growMediaKg = 0;

    for (const entry of recent) {
      if (entry.category === 'seeds') {
        seedsUsed[entry.itemName || entry.itemId] = (seedsUsed[entry.itemName || entry.itemId] || 0) + (entry.quantity || 0);
      } else if (entry.category === 'nutrients') {
        nutrientsUsedMl[entry.itemName || entry.itemId] = (nutrientsUsedMl[entry.itemName || entry.itemId] || 0) + (entry.quantity || 0);
      } else if (entry.category === 'supplies' && entry.subtype === 'grow_media') {
        growMediaKg += entry.quantity || 0;
      }
    }

    res.json({
      ok: true,
      summary: {
        seeds_used: seedsUsed,
        nutrients_used_ml: nutrientsUsedMl,
        grow_media_kg: Math.round(growMediaKg * 100) / 100,
      },
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'usage_summary_error' });
  }
});

// ═══════════════════════════════════════════════════════
// GENERIC CRUD FACTORY for each supply category
// ═══════════════════════════════════════════════════════

function registerCategoryRoutes(categoryPath, storeKey, listField) {
  /**
   * GET /:category/list — List all items in category
   */
  router.get(`/${categoryPath}/list`, async (req, res) => {
    try {
      const fid = getFid(req);
      const data = await farmStore.get(fid, storeKey).catch(() => null);
      res.json({ ok: true, [listField]: data?.items || [] });
    } catch (error) {
      res.status(500).json({ ok: false, error: `${categoryPath}_list_error` });
    }
  });

  /**
   * GET /:category/:id — Get single item
   */
  router.get(`/${categoryPath}/:id`, async (req, res) => {
    try {
      const fid = getFid(req);
      const data = await farmStore.get(fid, storeKey).catch(() => null);
      const item = (data?.items || []).find(i => i.id === req.params.id);
      if (!item) return res.status(404).json({ ok: false, error: 'not_found' });
      res.json({ ok: true, item });
    } catch (error) {
      res.status(500).json({ ok: false, error: `${categoryPath}_get_error` });
    }
  });

  /**
   * POST /:category — Create new item
   */
  router.post(`/${categoryPath}`, async (req, res) => {
    try {
      const fid = getFid(req);
      const data = await farmStore.get(fid, storeKey) || { items: [] };
      if (!data.items) data.items = [];

      const item = {
        id: generateId(categoryPath.toUpperCase()),
        ...req.body,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      data.items.push(item);
      data.lastUpdated = new Date().toISOString();
      await farmStore.set(fid, storeKey, data);

      res.json({ ok: true, item });
    } catch (error) {
      res.status(500).json({ ok: false, error: `${categoryPath}_create_error` });
    }
  });

  /**
   * PUT /:category/:id — Update item
   */
  router.put(`/${categoryPath}/:id`, async (req, res) => {
    try {
      const fid = getFid(req);
      const data = await farmStore.get(fid, storeKey);
      if (!data?.items) return res.status(404).json({ ok: false, error: 'not_found' });

      const idx = data.items.findIndex(i => i.id === req.params.id);
      if (idx === -1) return res.status(404).json({ ok: false, error: 'not_found' });

      const updates = { ...req.body };
      delete updates.id;
      delete updates.createdAt;
      data.items[idx] = { ...data.items[idx], ...updates, updatedAt: new Date().toISOString() };
      data.lastUpdated = new Date().toISOString();
      await farmStore.set(fid, storeKey, data);

      res.json({ ok: true, item: data.items[idx] });
    } catch (error) {
      res.status(500).json({ ok: false, error: `${categoryPath}_update_error` });
    }
  });

  /**
   * DELETE /:category/:id — Remove item
   */
  router.delete(`/${categoryPath}/:id`, async (req, res) => {
    try {
      const fid = getFid(req);
      const data = await farmStore.get(fid, storeKey);
      if (!data?.items) return res.status(404).json({ ok: false, error: 'not_found' });

      const initialLen = data.items.length;
      data.items = data.items.filter(i => i.id !== req.params.id);
      if (data.items.length === initialLen) return res.status(404).json({ ok: false, error: 'not_found' });

      data.lastUpdated = new Date().toISOString();
      await farmStore.set(fid, storeKey, data);

      res.json({ ok: true, deleted: req.params.id });
    } catch (error) {
      res.status(500).json({ ok: false, error: `${categoryPath}_delete_error` });
    }
  });

  /**
   * POST /:category/:id/restock — Record a restock event
   */
  router.post(`/${categoryPath}/:id/restock`, async (req, res) => {
    try {
      const fid = getFid(req);
      const data = await farmStore.get(fid, storeKey);
      if (!data?.items) return res.status(404).json({ ok: false, error: 'not_found' });

      const idx = data.items.findIndex(i => i.id === req.params.id);
      if (idx === -1) return res.status(404).json({ ok: false, error: 'not_found' });

      const addQty = req.body.quantity || 0;
      const currentQty = data.items[idx].quantity || data.items[idx].qtyOnHand || data.items[idx].stock_level || 0;
      data.items[idx].quantity = currentQty + addQty;
      data.items[idx].qtyOnHand = currentQty + addQty;
      data.items[idx].stock_level = currentQty + addQty;
      data.items[idx].lastRestocked = new Date().toISOString();
      data.items[idx].updatedAt = new Date().toISOString();
      data.lastUpdated = new Date().toISOString();
      await farmStore.set(fid, storeKey, data);

      res.json({ ok: true, item: data.items[idx], newQuantity: currentQty + addQty });
    } catch (error) {
      res.status(500).json({ ok: false, error: `${categoryPath}_restock_error` });
    }
  });

  /**
   * POST /:category/:id/usage — Record usage/consumption
   * POST /:category/usage — Record usage with itemId in body
   */
  router.post(`/${categoryPath}/:id/usage`, async (req, res) => {
    await recordUsage(req, res, categoryPath, storeKey, req.params.id);
  });
  router.post(`/${categoryPath}/usage`, async (req, res) => {
    const itemId = req.body.itemId || req.body.id;
    if (!itemId) return res.status(400).json({ ok: false, error: 'itemId required' });
    await recordUsage(req, res, categoryPath, storeKey, itemId);
  });

  /**
   * POST /:category/:id/maintenance — Log maintenance event (equipment)
   * POST /:category/maintenance — Log maintenance with itemId in body
   */
  router.post(`/${categoryPath}/:id/maintenance`, async (req, res) => {
    await recordMaintenance(req, res, categoryPath, storeKey, req.params.id);
  });
  router.post(`/${categoryPath}/maintenance`, async (req, res) => {
    const itemId = req.body.itemId || req.body.id;
    if (!itemId) return res.status(400).json({ ok: false, error: 'itemId required' });
    await recordMaintenance(req, res, categoryPath, storeKey, itemId);
  });
}

// Shared usage recording logic
async function recordUsage(req, res, categoryPath, storeKey, itemId) {
  try {
    const fid = getFid(req);
    const data = await farmStore.get(fid, storeKey);
    if (!data?.items) return res.status(404).json({ ok: false, error: 'not_found' });

    const idx = data.items.findIndex(i => i.id === itemId);
    if (idx === -1) return res.status(404).json({ ok: false, error: 'item_not_found' });

    const usedQty = req.body.quantity || 0;
    const currentQty = data.items[idx].quantity || data.items[idx].qtyOnHand || data.items[idx].volume_remaining_ml || 0;
    const newQty = Math.max(0, currentQty - usedQty);

    // Update item quantity
    if ('volume_remaining_ml' in data.items[idx]) {
      data.items[idx].volume_remaining_ml = newQty;
    } else {
      data.items[idx].quantity = newQty;
      data.items[idx].qtyOnHand = newQty;
    }
    data.items[idx].lastUsed = new Date().toISOString();
    data.items[idx].updatedAt = new Date().toISOString();
    data.lastUpdated = new Date().toISOString();
    await farmStore.set(fid, storeKey, data);

    // Log usage
    const logData = await farmStore.get(fid, 'inventory_usage_log') || { entries: [] };
    if (!logData.entries) logData.entries = [];
    logData.entries.push({
      id: generateId('USAGE'),
      category: categoryPath,
      itemId,
      itemName: data.items[idx].name || data.items[idx].type || itemId,
      quantity: usedQty,
      remaining: newQty,
      notes: req.body.notes || '',
      recordedBy: req.body.recordedBy || req.user?.name || 'system',
      timestamp: new Date().toISOString(),
    });
    await farmStore.set(fid, 'inventory_usage_log', logData);

    res.json({ ok: true, item: data.items[idx], used: usedQty, remaining: newQty });
  } catch (error) {
    res.status(500).json({ ok: false, error: `${categoryPath}_usage_error` });
  }
}

// Shared maintenance recording logic
async function recordMaintenance(req, res, categoryPath, storeKey, itemId) {
  try {
    const fid = getFid(req);
    const data = await farmStore.get(fid, storeKey);
    if (!data?.items) return res.status(404).json({ ok: false, error: 'not_found' });

    const idx = data.items.findIndex(i => i.id === itemId);
    if (idx === -1) return res.status(404).json({ ok: false, error: 'item_not_found' });

    const maintenanceEntry = {
      id: generateId('MAINT'),
      type: req.body.type || 'general',
      description: req.body.description || '',
      cost: req.body.cost || 0,
      performedBy: req.body.performedBy || req.user?.name || 'system',
      date: req.body.date || new Date().toISOString(),
      nextDue: req.body.nextDue || null,
    };

    if (!data.items[idx].maintenanceLog) data.items[idx].maintenanceLog = [];
    data.items[idx].maintenanceLog.push(maintenanceEntry);
    data.items[idx].lastMaintenance = maintenanceEntry.date;
    data.items[idx].nextMaintenanceDue = maintenanceEntry.nextDue;
    data.items[idx].updatedAt = new Date().toISOString();
    data.lastUpdated = new Date().toISOString();
    await farmStore.set(fid, storeKey, data);

    // Also log to usage log
    const logData = await farmStore.get(fid, 'inventory_usage_log') || { entries: [] };
    if (!logData.entries) logData.entries = [];
    logData.entries.push({
      id: generateId('MAINT-LOG'),
      category: categoryPath,
      itemId,
      itemName: data.items[idx].name || itemId,
      type: 'maintenance',
      subtype: maintenanceEntry.type,
      description: maintenanceEntry.description,
      cost: maintenanceEntry.cost,
      recordedBy: maintenanceEntry.performedBy,
      timestamp: new Date().toISOString(),
    });
    await farmStore.set(fid, 'inventory_usage_log', logData);

    res.json({ ok: true, item: data.items[idx], maintenance: maintenanceEntry });
  } catch (error) {
    res.status(500).json({ ok: false, error: `${categoryPath}_maintenance_error` });
  }
}

// ═══════════════════════════════════════════════════════
// Register routes for each supply category
// ═══════════════════════════════════════════════════════

registerCategoryRoutes('seeds',     'inventory_seeds',     'seeds');
registerCategoryRoutes('nutrients', 'inventory_nutrients', 'nutrients');
registerCategoryRoutes('packaging', 'inventory_packaging', 'packaging');
registerCategoryRoutes('equipment', 'inventory_equipment', 'equipment');
registerCategoryRoutes('supplies',  'inventory_supplies',  'supplies');

export default router;
