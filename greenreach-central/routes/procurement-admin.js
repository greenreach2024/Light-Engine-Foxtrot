import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const router = express.Router();

/**
 * GreenReach Central Procurement Admin Routes
 * Manages the master catalog, suppliers, and procurement revenue
 * Data syncs to farm instances via the wholesale network
 */

// Data files live in the Foxtrot public/data directory (shared data layer)
const DATA_DIR = path.join(__dirname, '..', '..', 'public', 'data');

function readJSON(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function writeJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

const CATALOG_FILE = path.join(DATA_DIR, 'procurement-catalog.json');
const SUPPLIERS_FILE = path.join(DATA_DIR, 'procurement-suppliers.json');
const ORDERS_FILE = path.join(DATA_DIR, 'procurement-orders.json');

// ═══════════════════════════════════════════════════════
// CATALOG MANAGEMENT
// ═══════════════════════════════════════════════════════

/**
 * GET /catalog
 * Get the full product catalog with stats
 */
router.get('/catalog', (req, res) => {
  try {
    const data = readJSON(CATALOG_FILE);
    if (!data) return res.json({ ok: true, products: [], categories: [] });

    const products = data.products || [];
    const categories = [...new Set(products.map(p => p.category))].sort();
    const inStockCount = products.filter(p => p.inStock).length;

    res.json({
      ok: true,
      total: products.length,
      inStock: inStockCount,
      outOfStock: products.length - inStockCount,
      categories,
      products
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'catalog_read_error' });
  }
});

/**
 * PUT /catalog/product
 * Add or update a product in the catalog
 */
router.put('/catalog/product', (req, res) => {
  try {
    const { product } = req.body;
    if (!product || !product.sku) {
      return res.status(400).json({ ok: false, error: 'product_with_sku_required' });
    }

    const data = readJSON(CATALOG_FILE) || { version: '1.0', products: [] };
    const idx = data.products.findIndex(p => p.sku === product.sku);

    if (idx >= 0) {
      data.products[idx] = { ...data.products[idx], ...product, updatedAt: new Date().toISOString() };
    } else {
      data.products.push({ ...product, createdAt: new Date().toISOString() });
    }

    data.lastUpdated = new Date().toISOString();
    writeJSON(CATALOG_FILE, data);

    res.json({ ok: true, action: idx >= 0 ? 'updated' : 'created', product: data.products[idx >= 0 ? idx : data.products.length - 1] });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'catalog_write_error' });
  }
});

/**
 * DELETE /catalog/product/:sku
 * Remove a product from the catalog
 */
router.delete('/catalog/product/:sku', (req, res) => {
  try {
    const data = readJSON(CATALOG_FILE);
    if (!data) return res.status(404).json({ ok: false, error: 'catalog_not_found' });

    const initialLen = data.products.length;
    data.products = data.products.filter(p => p.sku !== req.params.sku);

    if (data.products.length === initialLen) {
      return res.status(404).json({ ok: false, error: 'product_not_found' });
    }

    data.lastUpdated = new Date().toISOString();
    writeJSON(CATALOG_FILE, data);

    res.json({ ok: true, deleted: req.params.sku });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'catalog_delete_error' });
  }
});

// ═══════════════════════════════════════════════════════
// SUPPLIER MANAGEMENT
// ═══════════════════════════════════════════════════════

/**
 * GET /suppliers
 * Get all suppliers with product counts
 */
router.get('/suppliers', (req, res) => {
  try {
    const suppData = readJSON(SUPPLIERS_FILE);
    const catData = readJSON(CATALOG_FILE);

    const suppliers = (suppData?.suppliers || []).map(s => {
      const productCount = (catData?.products || []).filter(p => p.supplierId === s.id).length;
      return { ...s, productCount };
    });

    res.json({ ok: true, total: suppliers.length, suppliers });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'suppliers_read_error' });
  }
});

/**
 * PUT /suppliers/:supplierId
 * Update a supplier
 */
router.put('/suppliers/:supplierId', (req, res) => {
  try {
    const data = readJSON(SUPPLIERS_FILE);
    if (!data) return res.status(500).json({ ok: false, error: 'suppliers_unavailable' });

    const idx = (data.suppliers || []).findIndex(s => s.id === req.params.supplierId);
    if (idx === -1) return res.status(404).json({ ok: false, error: 'supplier_not_found' });

    const updates = req.body;
    delete updates.id;
    data.suppliers[idx] = { ...data.suppliers[idx], ...updates, updatedAt: new Date().toISOString() };
    data.lastUpdated = new Date().toISOString();
    writeJSON(SUPPLIERS_FILE, data);

    res.json({ ok: true, supplier: data.suppliers[idx] });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'supplier_update_error' });
  }
});

/**
 * POST /suppliers
 * Add a new supplier
 */
router.post('/suppliers', (req, res) => {
  try {
    const data = readJSON(SUPPLIERS_FILE) || { version: '1.0', suppliers: [] };
    const supplier = {
      id: `SUP-${Date.now()}`,
      ...req.body,
      createdAt: new Date().toISOString(),
      status: req.body.status || 'active'
    };

    data.suppliers.push(supplier);
    data.lastUpdated = new Date().toISOString();
    writeJSON(SUPPLIERS_FILE, data);

    res.json({ ok: true, supplier });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'supplier_create_error' });
  }
});

// ═══════════════════════════════════════════════════════
// ORDER MANAGEMENT (farm-facing)
// ═══════════════════════════════════════════════════════

/**
 * GET /orders — List procurement orders
 */
router.get('/orders', (req, res) => {
  try {
    const ordersData = readJSON(ORDERS_FILE) || { orders: [] };
    let orders = ordersData.orders || [];
    const { status, farm_id } = req.query;
    if (status) orders = orders.filter(o => o.status === status);
    if (farm_id) orders = orders.filter(o => o.farmId === farm_id);
    res.json({ ok: true, orders, total: orders.length });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'orders_list_error' });
  }
});

/**
 * GET /orders/:orderId — Get single order
 */
router.get('/orders/:orderId', (req, res) => {
  try {
    const ordersData = readJSON(ORDERS_FILE) || { orders: [] };
    const order = (ordersData.orders || []).find(o => o.id === req.params.orderId);
    if (!order) return res.status(404).json({ ok: false, error: 'order_not_found' });
    res.json({ ok: true, order });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'order_get_error' });
  }
});

/**
 * POST /orders — Create a new procurement order
 */
router.post('/orders', (req, res) => {
  try {
    const ordersData = readJSON(ORDERS_FILE) || { orders: [] };
    const { items, supplierId, notes, farmId } = req.body;
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ ok: false, error: 'items required' });
    }
    const catalog = readJSON(CATALOG_FILE) || { products: [] };
    const products = catalog.products || [];

    // Build supplier orders
    const supplierOrders = [];
    let subtotal = 0;
    const orderItems = items.map(item => {
      const product = products.find(p => p.sku === item.sku);
      const price = product ? (product.price || 0) : (item.price || 0);
      const lineTotal = price * (item.quantity || 1);
      subtotal += lineTotal;
      return {
        sku: item.sku,
        name: product ? product.name : item.name || item.sku,
        quantity: item.quantity || 1,
        price,
        total: Math.round(lineTotal * 100) / 100,
      };
    });

    if (supplierId) {
      supplierOrders.push({
        supplierId,
        items: orderItems,
        subtotal: Math.round(subtotal * 100) / 100,
        commission: Math.round(subtotal * 0.05 * 100) / 100, // 5% default commission
      });
    }

    const order = {
      id: `PO-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      farmId: farmId || 'unknown',
      items: orderItems,
      supplierOrders,
      subtotal: Math.round(subtotal * 100) / 100,
      status: 'pending',
      notes: notes || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    ordersData.orders = ordersData.orders || [];
    ordersData.orders.push(order);
    writeJSON(ORDERS_FILE, ordersData);

    res.json({ ok: true, order });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'order_create_error' });
  }
});

/**
 * POST /orders/:orderId/receive — Mark order as received
 */
router.post('/orders/:orderId/receive', (req, res) => {
  try {
    const ordersData = readJSON(ORDERS_FILE) || { orders: [] };
    const idx = (ordersData.orders || []).findIndex(o => o.id === req.params.orderId);
    if (idx === -1) return res.status(404).json({ ok: false, error: 'order_not_found' });

    ordersData.orders[idx].status = 'received';
    ordersData.orders[idx].receivedAt = new Date().toISOString();
    ordersData.orders[idx].updatedAt = new Date().toISOString();
    writeJSON(ORDERS_FILE, ordersData);

    res.json({ ok: true, order: ordersData.orders[idx] });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'order_receive_error' });
  }
});

/**
 * GET /inventory — Procurement supply inventory (aggregated from received orders)
 */
router.get('/inventory', (req, res) => {
  try {
    const ordersData = readJSON(ORDERS_FILE) || { orders: [] };
    const received = (ordersData.orders || []).filter(o => o.status === 'received');

    // Aggregate received items as current inventory
    const inventory = {};
    for (const order of received) {
      for (const item of (order.items || [])) {
        if (!inventory[item.sku]) {
          inventory[item.sku] = { sku: item.sku, name: item.name, quantity: 0, lastReceived: null };
        }
        inventory[item.sku].quantity += item.quantity || 0;
        inventory[item.sku].lastReceived = order.receivedAt || order.createdAt;
      }
    }

    res.json({ ok: true, inventory: Object.values(inventory), total: Object.keys(inventory).length });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'inventory_error' });
  }
});

/**
 * GET /commission-report — Commission summary for reporting dashboard
 */
router.get('/commission-report', (req, res) => {
  try {
    const ordersData = readJSON(ORDERS_FILE) || { orders: [] };
    const orders = ordersData.orders || [];

    let totalCommission = 0;
    let totalRevenue = 0;
    for (const order of orders) {
      for (const so of (order.supplierOrders || [])) {
        totalRevenue += so.subtotal || 0;
        totalCommission += so.commission || 0;
      }
    }

    res.json({
      ok: true,
      totalOrders: orders.length,
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      totalCommission: Math.round(totalCommission * 100) / 100,
      avgCommissionRate: totalRevenue > 0 ? Math.round((totalCommission / totalRevenue) * 10000) / 100 : 0,
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'commission_report_error' });
  }
});

// ═══════════════════════════════════════════════════════
// PROCUREMENT REVENUE/COMMISSION REPORTING
// ═══════════════════════════════════════════════════════

/**
 * GET /revenue
 * Get procurement revenue summary (commissions from all farm orders)
 */
router.get('/revenue', (req, res) => {
  try {
    const ordersData = readJSON(ORDERS_FILE) || { orders: [] };
    const { from, to } = req.query;

    let orders = ordersData.orders || [];
    if (from) orders = orders.filter(o => new Date(o.createdAt) >= new Date(from));
    if (to) orders = orders.filter(o => new Date(o.createdAt) <= new Date(to));

    // Aggregate revenue data
    let totalRevenue = 0;
    let totalCommission = 0;
    let totalOrders = orders.length;
    const bySupplier = {};
    const byMonth = {};

    for (const order of orders) {
      for (const so of (order.supplierOrders || [])) {
        totalRevenue += so.subtotal || 0;
        totalCommission += so.commission || 0;

        // By supplier
        if (!bySupplier[so.supplierId]) {
          bySupplier[so.supplierId] = { name: so.supplierName, revenue: 0, commission: 0, orderCount: 0 };
        }
        bySupplier[so.supplierId].revenue += so.subtotal || 0;
        bySupplier[so.supplierId].commission += so.commission || 0;
        bySupplier[so.supplierId].orderCount++;

        // By month
        const month = (order.createdAt || '').substring(0, 7);
        if (month) {
          if (!byMonth[month]) byMonth[month] = { revenue: 0, commission: 0, orderCount: 0 };
          byMonth[month].revenue += so.subtotal || 0;
          byMonth[month].commission += so.commission || 0;
          byMonth[month].orderCount++;
        }
      }
    }

    res.json({
      ok: true,
      period: { from: from || 'all', to: to || 'all' },
      summary: {
        totalOrders,
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        totalCommission: Math.round(totalCommission * 100) / 100,
        avgOrderValue: totalOrders > 0 ? Math.round((totalRevenue / totalOrders) * 100) / 100 : 0
      },
      bySupplier: Object.entries(bySupplier).map(([id, data]) => ({ supplierId: id, ...data })),
      byMonth: Object.entries(byMonth).map(([month, data]) => ({ month, ...data })).sort((a, b) => a.month.localeCompare(b.month))
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'revenue_report_error' });
  }
});

export default router;
