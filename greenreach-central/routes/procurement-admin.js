import express from 'express';
import { farmStore } from '../lib/farm-data-store.js';

const router = express.Router();
const commissionRate = parseFloat(process.env.PROCUREMENT_COMMISSION_RATE) || 0.05;

function normalizeMoney(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

/**
 * GreenReach Central Procurement Admin Routes
 * Manages the master catalog, suppliers, and procurement revenue
 * Phase 3: All data read/write through farmStore (tenant-scoped)
 */

// ═══════════════════════════════════════════════════════
// CATALOG MANAGEMENT
// ═══════════════════════════════════════════════════════

/**
 * GET /catalog
 * Get the full product catalog with stats
 */
router.get('/catalog', async (req, res) => {
  try {
    const fid = farmStore.farmIdFromReq(req);
    const data = await farmStore.get(fid, 'procurement_catalog');
    if (!data || !data.products) return res.json({ ok: true, products: [], categories: [] });

    const products = data.products || [];
    const CATEGORY_META = {
      seeds: { icon: '🌱', name: 'Seeds', sortOrder: 1 },
      nutrients: { icon: '🧪', name: 'Nutrients', sortOrder: 2 },
      packaging: { icon: '📦', name: 'Packaging', sortOrder: 3 },
      equipment: { icon: '⚙️', name: 'Equipment', sortOrder: 4 },
      media: { icon: '🪨', name: 'Grow Media', sortOrder: 5 },
      lab: { icon: '🔬', name: 'Lab Supplies', sortOrder: 6 },
    };
    const catIds = [...new Set(products.map(p => p.category))].sort();
    const categories = catIds.map(id => ({
      id,
      ...(CATEGORY_META[id] || { icon: '📋', name: id.charAt(0).toUpperCase() + id.slice(1), sortOrder: 99 })
    }));
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
router.put('/catalog/product', async (req, res) => {
  try {
    const { product } = req.body;
    if (!product || !product.sku) {
      return res.status(400).json({ ok: false, error: 'product_with_sku_required' });
    }

    const fid = farmStore.farmIdFromReq(req);
    const data = await farmStore.get(fid, 'procurement_catalog') || { version: '1.0', products: [] };
    if (!data.products) data.products = [];
    const idx = data.products.findIndex(p => p.sku === product.sku);

    if (idx >= 0) {
      data.products[idx] = { ...data.products[idx], ...product, updatedAt: new Date().toISOString() };
    } else {
      data.products.push({ ...product, createdAt: new Date().toISOString() });
    }

    data.lastUpdated = new Date().toISOString();
    await farmStore.set(fid, 'procurement_catalog', data);

    res.json({ ok: true, action: idx >= 0 ? 'updated' : 'created', product: data.products[idx >= 0 ? idx : data.products.length - 1] });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'catalog_write_error' });
  }
});

/**
 * DELETE /catalog/product/:sku
 * Remove a product from the catalog
 */
router.delete('/catalog/product/:sku', async (req, res) => {
  try {
    const fid = farmStore.farmIdFromReq(req);
    const data = await farmStore.get(fid, 'procurement_catalog');
    if (!data) return res.status(404).json({ ok: false, error: 'catalog_not_found' });

    const initialLen = (data.products || []).length;
    data.products = (data.products || []).filter(p => p.sku !== req.params.sku);

    if (data.products.length === initialLen) {
      return res.status(404).json({ ok: false, error: 'product_not_found' });
    }

    data.lastUpdated = new Date().toISOString();
    await farmStore.set(fid, 'procurement_catalog', data);

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
router.get('/suppliers', async (req, res) => {
  try {
    const fid = farmStore.farmIdFromReq(req);
    const suppData = await farmStore.get(fid, 'procurement_suppliers') || { suppliers: [] };
    const catData = await farmStore.get(fid, 'procurement_catalog') || { products: [] };

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
router.put('/suppliers/:supplierId', async (req, res) => {
  try {
    const fid = farmStore.farmIdFromReq(req);
    const data = await farmStore.get(fid, 'procurement_suppliers') || { suppliers: [] };
    if (!data.suppliers) return res.status(500).json({ ok: false, error: 'suppliers_unavailable' });

    const idx = (data.suppliers || []).findIndex(s => s.id === req.params.supplierId);
    if (idx === -1) return res.status(404).json({ ok: false, error: 'supplier_not_found' });

    const updates = req.body;
    delete updates.id;
    data.suppliers[idx] = { ...data.suppliers[idx], ...updates, updatedAt: new Date().toISOString() };
    data.lastUpdated = new Date().toISOString();
    await farmStore.set(fid, 'procurement_suppliers', data);

    res.json({ ok: true, supplier: data.suppliers[idx] });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'supplier_update_error' });
  }
});

/**
 * POST /suppliers
 * Add a new supplier
 */
router.post('/suppliers', async (req, res) => {
  try {
    const fid = farmStore.farmIdFromReq(req);
    const data = await farmStore.get(fid, 'procurement_suppliers') || { version: '1.0', suppliers: [] };
    if (!data.suppliers) data.suppliers = [];
    const supplier = {
      id: `SUP-${Date.now()}`,
      ...req.body,
      createdAt: new Date().toISOString(),
      status: req.body.status || 'active'
    };

    data.suppliers.push(supplier);
    data.lastUpdated = new Date().toISOString();
    await farmStore.set(fid, 'procurement_suppliers', data);

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
router.get('/orders', async (req, res) => {
  try {
    const fid = farmStore.farmIdFromReq(req);
    const ordersData = await farmStore.get(fid, 'procurement_orders') || { orders: [] };
    let orders = ordersData.orders || [];
    const { status, farm_id } = req.query;
    if (status) orders = orders.filter(o => o.status === status);
    if (farm_id) orders = orders.filter(o => o.farmId === farm_id);
    const enriched = orders.map(o => ({
      ...o,
      orderId: o.orderId || o.id,
      itemCount: o.itemCount || (o.items || []).reduce((s, i) => s + (i.quantity || 1), 0),
      subtotal: normalizeMoney(o.subtotal || (o.items || []).reduce((s, i) => s + (normalizeMoney(i.total) || normalizeMoney(i.price) * (i.quantity || 1) || 0), 0)),
      paymentStatus: o.paymentStatus || 'pending',
    }));
    res.json({ ok: true, orders: enriched, total: enriched.length });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'orders_list_error' });
  }
});

/**
 * GET /orders/:orderId — Get single order
 */
router.get('/orders/:orderId', async (req, res) => {
  try {
    const fid = farmStore.farmIdFromReq(req);
    const ordersData = await farmStore.get(fid, 'procurement_orders') || { orders: [] };
    const order = (ordersData.orders || []).find(o => o.id === req.params.orderId || o.orderId === req.params.orderId);
    if (!order) return res.status(404).json({ ok: false, error: 'order_not_found' });
    // Enrich order items for frontend contract
    const suppData = await farmStore.get(fid, 'procurement_suppliers') || { suppliers: [] };
    const enrichedItems = (order.items || []).map(item => ({
      ...item,
      unitPrice: normalizeMoney(item.unitPrice || item.price || 0),
      lineTotal: normalizeMoney(item.lineTotal || item.total || normalizeMoney(item.price) * (item.quantity || 1)),
      saleUnit: item.saleUnit || item.unit || 'each',
      status: item.status || order.status || 'pending',
      supplierName: item.supplierName || (suppData.suppliers || []).find(s => s.id === item.supplierId)?.name || item.supplierId || '',
      trackingNumber: item.trackingNumber || null,
      carrier: item.carrier || null,
    }));
    const enrichedOrder = {
      ...order,
      orderId: order.orderId || order.id,
      paymentMethod: order.paymentMethod || 'invoice',
      paymentStatus: order.paymentStatus || 'pending',
      shippingAddress: order.shippingAddress || null,
      subtotal: normalizeMoney(order.subtotal),
      items: enrichedItems,
    };
    res.json({ ok: true, order: enrichedOrder });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'order_get_error' });
  }
});

/**
 * POST /orders — Create a new procurement order
 */
router.post('/orders', async (req, res) => {
  try {
    const fid = farmStore.farmIdFromReq(req);
    const ordersData = await farmStore.get(fid, 'procurement_orders') || { orders: [] };
    const { items, supplierId, notes, farmId, shippingAddress, paymentMethod } = req.body;
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ ok: false, error: 'items required' });
    }
    const catalog = await farmStore.get(fid, 'procurement_catalog') || { products: [] };
    const products = catalog.products || [];

    // Build supplier orders
    const supplierOrders = [];
    let subtotal = 0;
    const orderItems = items.map(item => {
      const product = products.find(p => p.sku === item.sku);
      const price = product ? normalizeMoney(product.price || 0) : normalizeMoney(item.price || 0);
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
        commission: Math.round(subtotal * commissionRate * 100) / 100,
      });
    }

    const orderId = `PO-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const order = {
      id: orderId,
      orderId,
      farmId: farmId || fid || 'unknown',
      items: orderItems,
      supplierOrders,
      subtotal: Math.round(subtotal * 100) / 100,
      itemCount: orderItems.reduce((s, i) => s + (i.quantity || 1), 0),
      status: 'pending',
      paymentMethod: paymentMethod || 'invoice',
      paymentStatus: 'pending',
      shippingAddress: shippingAddress || null,
      notes: notes || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    ordersData.orders = ordersData.orders || [];
    ordersData.orders.push(order);
    await farmStore.set(fid, 'procurement_orders', ordersData);

    res.json({ ok: true, order });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'order_create_error' });
  }
});

/**
 * POST /orders/:orderId/receive — Mark order as received
 */
router.post('/orders/:orderId/receive', async (req, res) => {
  try {
    const fid = farmStore.farmIdFromReq(req);
    const ordersData = await farmStore.get(fid, 'procurement_orders') || { orders: [] };
    const idx = (ordersData.orders || []).findIndex(o => o.id === req.params.orderId);
    if (idx === -1) return res.status(404).json({ ok: false, error: 'order_not_found' });

    ordersData.orders[idx].status = 'received';
    ordersData.orders[idx].receivedAt = new Date().toISOString();
    ordersData.orders[idx].updatedAt = new Date().toISOString();
    await farmStore.set(fid, 'procurement_orders', ordersData);

    const receivedCount = (ordersData.orders[idx].items || []).reduce((s, i) => s + (i.quantity || 1), 0);
    res.json({ ok: true, order: ordersData.orders[idx], received: receivedCount });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'order_receive_error' });
  }
});

/**
 * GET /inventory — Procurement supply inventory (aggregated from received orders)
 */
router.get('/inventory', async (req, res) => {
  try {
    const fid = farmStore.farmIdFromReq(req);
    const ordersData = await farmStore.get(fid, 'procurement_orders') || { orders: [] };
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

    const supplies = Object.values(inventory).map(item => ({
      ...item,
      category: item.category || 'uncategorized',
      qtyOnHand: item.quantity || 0,
      standardUnit: item.standardUnit || item.unit || 'each',
      minStockLevel: item.minStockLevel || 0,
      lastRestockedAt: item.lastReceived || null,
    }));
    res.json({ ok: true, supplies, inventory: supplies, total: supplies.length });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'inventory_error' });
  }
});

/**
 * GET /commission-report — Commission summary for reporting dashboard
 */
router.get('/commission-report', async (req, res) => {
  try {
    const fid = farmStore.farmIdFromReq(req);
    const ordersData = await farmStore.get(fid, 'procurement_orders') || { orders: [] };
    const orders = ordersData.orders || [];

    let totalCommission = 0;
    let totalRevenue = 0;
    for (const order of orders) {
      for (const so of (order.supplierOrders || [])) {
        totalRevenue += so.subtotal || 0;
        totalCommission += so.commission || 0;
      }
    }

    // Per-supplier breakdown
    const bySupplier = {};
    const suppData = await farmStore.get(fid, 'procurement_suppliers') || { suppliers: [] };
    for (const order of orders) {
      for (const so of (order.supplierOrders || [])) {
        const sid = so.supplierId || 'unknown';
        if (!bySupplier[sid]) {
          const sup = (suppData.suppliers || []).find(s => s.id === sid);
          bySupplier[sid] = { supplierName: sup?.name || so.supplierName || sid, orderCount: 0, totalSales: 0, totalCommission: 0 };
        }
        bySupplier[sid].orderCount++;
        bySupplier[sid].totalSales += so.subtotal || 0;
        bySupplier[sid].totalCommission += so.commission || 0;
      }
    }
    const suppliersArr = Object.values(bySupplier).map(s => ({
      ...s,
      totalSales: Math.round(s.totalSales * 100) / 100,
      totalCommission: Math.round(s.totalCommission * 100) / 100,
    }));

    res.json({
      ok: true,
      totalOrders: orders.length,
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      totalCommission: Math.round(totalCommission * 100) / 100,
      avgCommissionRate: totalRevenue > 0 ? Math.round((totalCommission / totalRevenue) * 10000) / 100 : 0,
      grandTotal: Math.round(totalRevenue * 100) / 100,
      grandCommission: Math.round(totalCommission * 100) / 100,
      orderCount: orders.length,
      suppliers: suppliersArr,
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
router.get('/revenue', async (req, res) => {
  try {
    const fid = farmStore.farmIdFromReq(req);
    const ordersData = await farmStore.get(fid, 'procurement_orders') || { orders: [] };
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
