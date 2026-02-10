/**
 * GreenReach Procurement Portal – API Routes
 * 
 * Handles product catalog, cart management, order placement,
 * supplier integration (API/email), order tracking, returns,
 * and inventory integration for farm supply procurement.
 * 
 * Routes:
 *   GET    /catalog                 – Browse product catalog
 *   GET    /catalog/:sku            – Get single product details
 *   GET    /categories              – List product categories
 *   GET    /suppliers               – List suppliers (admin)
 *   POST   /orders                  – Place an order
 *   GET    /orders                  – List farm's orders
 *   GET    /orders/:orderId         – Get order details
 *   PATCH  /orders/:orderId/status  – Update order status (admin/webhook)
 *   POST   /orders/:orderId/receive – Mark order items as received
 *   POST   /orders/:orderId/return  – Request a return
 *   GET    /cart                    – Get saved cart
 *   PUT    /cart                    – Save/update cart
 *   GET    /inventory               – Get farm supply inventory
 *   GET    /commission-report       – Commission report (admin)
 */

import express from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../public/data');

const CATALOG_FILE   = path.join(DATA_DIR, 'procurement-catalog.json');
const SUPPLIERS_FILE = path.join(DATA_DIR, 'procurement-suppliers.json');
const ORDERS_FILE    = path.join(DATA_DIR, 'procurement-orders.json');
const UNITS_FILE     = path.join(DATA_DIR, 'procurement-units.json');
const FARM_FILE      = path.join(DATA_DIR, 'farm.json');

// ─── Helpers ───────────────────────────────────────────

function readJSON(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    return null;
  }
}

function writeJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function generateOrderId() {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `PO-${ts}-${rand}`;
}

function generateLineId() {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

function getFarmInfo() {
  const farm = readJSON(FARM_FILE);
  return farm || { farmId: 'unknown', name: 'Unknown Farm' };
}

// In-memory carts by farmId (persists only during server lifetime)
const farmCarts = new Map();

// ─── Email integration helper (for non-API suppliers) ──

async function sendSupplierOrderEmail(supplier, order, farmInfo) {
  // In production, this would use AWS SES or similar
  // For now, log the email content that would be sent
  const lineItemsText = order.items
    .filter(i => i.supplierId === supplier.id)
    .map(i => `  - ${i.name} (${i.sku}) × ${i.quantity} @ $${i.unitPrice.toFixed(2)} = $${i.lineTotal.toFixed(2)}`)
    .join('\n');

  const emailContent = {
    to: supplier.email,
    from: 'procurement@greenreach-farms.com',
    subject: `Purchase Order ${order.orderId} – ${farmInfo.name || farmInfo.farmName}`,
    body: [
      `PURCHASE ORDER: ${order.orderId}`,
      `Date: ${new Date(order.createdAt).toLocaleDateString()}`,
      ``,
      `FROM: ${farmInfo.name || farmInfo.farmName}`,
      `Address: ${farmInfo.address || ''}, ${farmInfo.city || ''}, ${farmInfo.state || ''}`,
      `Contact: ${farmInfo.email || ''}`,
      ``,
      `SHIP TO:`,
      `${order.shippingAddress?.street || farmInfo.address || ''}`,
      `${order.shippingAddress?.city || farmInfo.city || ''}, ${order.shippingAddress?.state || farmInfo.state || ''} ${order.shippingAddress?.zip || farmInfo.postalCode || ''}`,
      ``,
      `ITEMS:`,
      lineItemsText,
      ``,
      `SUBTOTAL: $${order.items.filter(i => i.supplierId === supplier.id).reduce((s, i) => s + i.lineTotal, 0).toFixed(2)}`,
      ``,
      `Please confirm receipt of this order and provide estimated shipping date.`,
      `Reference: ${order.orderId}`,
    ].join('\n')
  };

  console.log(`[Procurement] Email PO sent to ${supplier.name} (${supplier.email}) for order ${order.orderId}`);
  
  // Log to a file for traceability
  const logEntry = {
    timestamp: new Date().toISOString(),
    type: 'supplier_email_order',
    orderId: order.orderId,
    supplierId: supplier.id,
    supplierEmail: supplier.email,
    status: 'sent',
    content: emailContent
  };
  
  try {
    const logFile = path.join(DATA_DIR, 'procurement-email-log.json');
    let logs = readJSON(logFile) || { entries: [] };
    logs.entries.push(logEntry);
    // Keep last 500 entries
    if (logs.entries.length > 500) logs.entries = logs.entries.slice(-500);
    writeJSON(logFile, logs);
  } catch (e) { /* log silently */ }

  return { sent: true, method: 'email' };
}

// ─── API integration helper (for API-capable suppliers) ──

async function sendSupplierOrderAPI(supplier, order, farmInfo) {
  // In production, this would call the supplier's API endpoint
  // For now, simulate API call and log it
  const payload = {
    externalOrderId: order.orderId,
    farmName: farmInfo.name || farmInfo.farmName,
    shippingAddress: order.shippingAddress || {
      street: farmInfo.address,
      city: farmInfo.city,
      state: farmInfo.state,
      zip: farmInfo.postalCode
    },
    items: order.items
      .filter(i => i.supplierId === supplier.id)
      .map(i => ({
        sku: i.sku,
        name: i.name,
        quantity: i.quantity,
        unitPrice: i.unitPrice
      })),
    requestedDate: order.requestedDeliveryDate || null,
    notes: order.notes || ''
  };

  console.log(`[Procurement] API order sent to ${supplier.name} (${supplier.apiEndpoint}) for order ${order.orderId}`);
  
  // Simulate API response
  const supplierConfirmation = `${supplier.id}-CONF-${Date.now().toString(36).toUpperCase()}`;
  
  return { sent: true, method: 'api', supplierConfirmation };
}

// Route supplier order to appropriate channel
async function routeOrderToSupplier(supplier, order, farmInfo) {
  if (supplier.integrationMethod === 'api' && supplier.apiEndpoint) {
    return sendSupplierOrderAPI(supplier, order, farmInfo);
  } else {
    return sendSupplierOrderEmail(supplier, order, farmInfo);
  }
}


// ═══════════════════════════════════════════════════════
// CATALOG ROUTES
// ═══════════════════════════════════════════════════════

/**
 * GET /catalog
 * Browse product catalog with filtering, search, and pagination
 */
router.get('/catalog', (req, res) => {
  try {
    const catalog = readJSON(CATALOG_FILE);
    if (!catalog) return res.status(500).json({ ok: false, error: 'catalog_unavailable' });

    let products = catalog.products || [];
    const { category, search, supplier, tag, featured, inStock, sort, limit, offset } = req.query;

    // Filter by category
    if (category) {
      products = products.filter(p => p.category === category);
    }

    // Filter by supplier
    if (supplier) {
      products = products.filter(p => p.supplierId === supplier);
    }

    // Filter by tag
    if (tag) {
      products = products.filter(p => p.tags && p.tags.includes(tag));
    }

    // Filter by featured
    if (featured === 'true') {
      products = products.filter(p => p.featured);
    }

    // Filter by in-stock
    if (inStock === 'true') {
      products = products.filter(p => p.inStock !== false);
    }

    // Search by name/description/sku
    if (search) {
      const q = search.toLowerCase();
      products = products.filter(p =>
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        (p.tags && p.tags.some(t => t.includes(q)))
      );
    }

    // Sort
    if (sort === 'price_asc') products.sort((a, b) => a.price - b.price);
    else if (sort === 'price_desc') products.sort((a, b) => b.price - a.price);
    else if (sort === 'name') products.sort((a, b) => a.name.localeCompare(b.name));

    // Pagination
    const total = products.length;
    const off = parseInt(offset) || 0;
    const lim = parseInt(limit) || 50;
    products = products.slice(off, off + lim);

    res.json({
      ok: true,
      total,
      offset: off,
      limit: lim,
      categories: catalog.categories,
      products
    });
  } catch (error) {
    console.error('[Procurement] Catalog error:', error.message);
    res.status(500).json({ ok: false, error: 'catalog_error' });
  }
});

/**
 * GET /catalog/:sku
 * Get single product details with supplier info
 */
router.get('/catalog/:sku', (req, res) => {
  try {
    const catalog = readJSON(CATALOG_FILE);
    const suppliers = readJSON(SUPPLIERS_FILE);
    if (!catalog) return res.status(500).json({ ok: false, error: 'catalog_unavailable' });

    const product = (catalog.products || []).find(p => p.sku === req.params.sku);
    if (!product) return res.status(404).json({ ok: false, error: 'product_not_found' });

    const supplier = (suppliers?.suppliers || []).find(s => s.id === product.supplierId);

    res.json({
      ok: true,
      product,
      supplier: supplier ? {
        id: supplier.id,
        name: supplier.name,
        shippingEstimateDays: supplier.shippingEstimateDays,
        returnPolicyDays: supplier.returnPolicyDays
      } : null
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'product_error' });
  }
});

/**
 * GET /categories
 * List all product categories
 */
router.get('/categories', (req, res) => {
  try {
    const catalog = readJSON(CATALOG_FILE);
    if (!catalog) return res.status(500).json({ ok: false, error: 'catalog_unavailable' });
    res.json({ ok: true, categories: catalog.categories || [] });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'categories_error' });
  }
});

/**
 * GET /suppliers
 * List suppliers (admin view — hides sensitive fields from non-admin)
 */
router.get('/suppliers', (req, res) => {
  try {
    const data = readJSON(SUPPLIERS_FILE);
    if (!data) return res.status(500).json({ ok: false, error: 'suppliers_unavailable' });

    const suppliers = (data.suppliers || []).map(s => ({
      id: s.id,
      name: s.name,
      categories: s.categories,
      shippingEstimateDays: s.shippingEstimateDays,
      returnPolicyDays: s.returnPolicyDays,
      status: s.status,
      integrationMethod: s.integrationMethod
    }));

    res.json({ ok: true, suppliers });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'suppliers_error' });
  }
});

/**
 * GET /units
 * Get the unit standardization table
 */
router.get('/units', (req, res) => {
  try {
    const units = readJSON(UNITS_FILE);
    if (!units) return res.status(500).json({ ok: false, error: 'units_unavailable' });
    res.json({ ok: true, ...units });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'units_error' });
  }
});


// ═══════════════════════════════════════════════════════
// CART ROUTES
// ═══════════════════════════════════════════════════════

/**
 * GET /cart
 * Retrieve saved cart for the farm
 */
router.get('/cart', (req, res) => {
  const farmInfo = getFarmInfo();
  const cart = farmCarts.get(farmInfo.farmId) || { items: [], updatedAt: null };
  res.json({ ok: true, cart });
});

/**
 * PUT /cart
 * Save/update cart contents
 * Body: { items: [{ sku, quantity }] }
 */
router.put('/cart', (req, res) => {
  try {
    const farmInfo = getFarmInfo();
    const { items } = req.body;
    if (!Array.isArray(items)) {
      return res.status(400).json({ ok: false, error: 'items_must_be_array' });
    }

    const catalog = readJSON(CATALOG_FILE);
    if (!catalog) return res.status(500).json({ ok: false, error: 'catalog_unavailable' });

    // Validate and enrich cart items
    const enrichedItems = [];
    for (const item of items) {
      if (!item.sku || !item.quantity || item.quantity < 1) continue;
      const product = (catalog.products || []).find(p => p.sku === item.sku);
      if (!product) continue;

      enrichedItems.push({
        sku: product.sku,
        name: product.name,
        category: product.category,
        supplierId: product.supplierId,
        quantity: parseInt(item.quantity),
        unitPrice: product.price,
        saleUnit: product.saleUnit,
        lineTotal: product.price * parseInt(item.quantity),
        inStock: product.inStock
      });
    }

    const cart = {
      items: enrichedItems,
      subtotal: enrichedItems.reduce((s, i) => s + i.lineTotal, 0),
      itemCount: enrichedItems.reduce((s, i) => s + i.quantity, 0),
      supplierCount: new Set(enrichedItems.map(i => i.supplierId)).size,
      updatedAt: new Date().toISOString()
    };

    farmCarts.set(farmInfo.farmId, cart);
    res.json({ ok: true, cart });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'cart_error' });
  }
});


// ═══════════════════════════════════════════════════════
// ORDER ROUTES
// ═══════════════════════════════════════════════════════

/**
 * POST /orders
 * Place a new procurement order
 * Body: {
 *   items: [{ sku, quantity }],
 *   shippingAddress: { street, city, state, zip },
 *   paymentMethod: "square" | "stripe" | "invoice",
 *   notes: "",
 *   requestedDeliveryDate: ""
 * }
 */
router.post('/orders', async (req, res) => {
  try {
    const farmInfo = getFarmInfo();
    const catalog = readJSON(CATALOG_FILE);
    const suppliersData = readJSON(SUPPLIERS_FILE);
    const ordersData = readJSON(ORDERS_FILE) || { orders: [] };

    if (!catalog || !suppliersData) {
      return res.status(500).json({ ok: false, error: 'system_unavailable' });
    }

    const { items, shippingAddress, paymentMethod, notes, requestedDeliveryDate } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ ok: false, error: 'items_required' });
    }

    // Build order line items
    const orderItems = [];
    for (const item of items) {
      const product = (catalog.products || []).find(p => p.sku === item.sku);
      if (!product) {
        return res.status(400).json({ ok: false, error: `product_not_found: ${item.sku}` });
      }
      orderItems.push({
        lineId: generateLineId(),
        sku: product.sku,
        name: product.name,
        category: product.category,
        supplierId: product.supplierId,
        quantity: parseInt(item.quantity) || 1,
        unitPrice: product.price,
        saleUnit: product.saleUnit,
        standardUnit: product.standardUnit,
        standardQty: product.standardQty,
        lineTotal: product.price * (parseInt(item.quantity) || 1),
        status: 'pending',
        trackingNumber: null,
        carrier: null,
        shippedAt: null,
        deliveredAt: null,
        receivedAt: null
      });
    }

    // Create order
    const orderId = generateOrderId();
    const order = {
      orderId,
      farmId: farmInfo.farmId,
      farmName: farmInfo.name || farmInfo.farmName,
      items: orderItems,
      shippingAddress: shippingAddress || {
        street: farmInfo.address || '',
        city: farmInfo.city || '',
        state: farmInfo.state || '',
        zip: farmInfo.postalCode || ''
      },
      subtotal: orderItems.reduce((s, i) => s + i.lineTotal, 0),
      paymentMethod: paymentMethod || 'invoice',
      paymentStatus: 'pending',
      notes: notes || '',
      requestedDeliveryDate: requestedDeliveryDate || null,
      status: 'confirmed',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      supplierOrders: [],
      commissionTotal: 0
    };

    // Group items by supplier and route orders
    const supplierGroups = {};
    for (const item of orderItems) {
      if (!supplierGroups[item.supplierId]) supplierGroups[item.supplierId] = [];
      supplierGroups[item.supplierId].push(item);
    }

    for (const [supplierId, supplierItems] of Object.entries(supplierGroups)) {
      const supplier = (suppliersData.suppliers || []).find(s => s.id === supplierId);
      if (!supplier) continue;

      const supplierSubtotal = supplierItems.reduce((s, i) => s + i.lineTotal, 0);
      const commission = supplierSubtotal * (supplier.commissionRate || 0);

      const routeResult = await routeOrderToSupplier(supplier, order, farmInfo);

      order.supplierOrders.push({
        supplierId: supplier.id,
        supplierName: supplier.name,
        integrationMethod: supplier.integrationMethod,
        subtotal: supplierSubtotal,
        commission,
        transmissionStatus: routeResult.sent ? 'sent' : 'failed',
        transmissionMethod: routeResult.method,
        supplierConfirmation: routeResult.supplierConfirmation || null,
        sentAt: new Date().toISOString()
      });

      order.commissionTotal += commission;
    }

    // Save order
    ordersData.orders.push(order);
    writeJSON(ORDERS_FILE, ordersData);

    // Clear cart after successful order
    farmCarts.delete(farmInfo.farmId);

    console.log(`[Procurement] Order ${orderId} placed – ${orderItems.length} items, $${order.subtotal.toFixed(2)}, ${Object.keys(supplierGroups).length} supplier(s)`);

    res.status(201).json({
      ok: true,
      order: {
        orderId: order.orderId,
        status: order.status,
        items: order.items.length,
        subtotal: order.subtotal,
        supplierOrders: order.supplierOrders.length,
        createdAt: order.createdAt
      }
    });
  } catch (error) {
    console.error('[Procurement] Order error:', error.message);
    res.status(500).json({ ok: false, error: 'order_failed' });
  }
});

/**
 * GET /orders
 * List all orders for this farm
 */
router.get('/orders', (req, res) => {
  try {
    const farmInfo = getFarmInfo();
    const ordersData = readJSON(ORDERS_FILE) || { orders: [] };
    const { status, limit, offset } = req.query;

    let orders = ordersData.orders.filter(o => o.farmId === farmInfo.farmId);

    if (status) {
      orders = orders.filter(o => o.status === status);
    }

    // Sort newest first
    orders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const total = orders.length;
    const off = parseInt(offset) || 0;
    const lim = parseInt(limit) || 20;
    orders = orders.slice(off, off + lim);

    // Return summary view
    const orderSummaries = orders.map(o => ({
      orderId: o.orderId,
      status: o.status,
      itemCount: o.items.length,
      subtotal: o.subtotal,
      paymentStatus: o.paymentStatus,
      supplierCount: o.supplierOrders?.length || 0,
      createdAt: o.createdAt,
      updatedAt: o.updatedAt
    }));

    res.json({ ok: true, total, offset: off, limit: lim, orders: orderSummaries });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'orders_error' });
  }
});

/**
 * GET /orders/:orderId
 * Get full order details
 */
router.get('/orders/:orderId', (req, res) => {
  try {
    const ordersData = readJSON(ORDERS_FILE) || { orders: [] };
    const order = ordersData.orders.find(o => o.orderId === req.params.orderId);
    if (!order) return res.status(404).json({ ok: false, error: 'order_not_found' });

    // Enrich with supplier names
    const suppliersData = readJSON(SUPPLIERS_FILE);
    if (suppliersData) {
      for (const item of order.items) {
        const sup = (suppliersData.suppliers || []).find(s => s.id === item.supplierId);
        item.supplierName = sup?.name || item.supplierId;
      }
    }

    res.json({ ok: true, order });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'order_error' });
  }
});

/**
 * PATCH /orders/:orderId/status
 * Update order or line item status (admin/webhook)
 * Body: { status, lineId?, trackingNumber?, carrier?, notes? }
 */
router.patch('/orders/:orderId/status', (req, res) => {
  try {
    const ordersData = readJSON(ORDERS_FILE) || { orders: [] };
    const orderIdx = ordersData.orders.findIndex(o => o.orderId === req.params.orderId);
    if (orderIdx === -1) return res.status(404).json({ ok: false, error: 'order_not_found' });

    const order = ordersData.orders[orderIdx];
    const { status, lineId, trackingNumber, carrier, notes } = req.body;

    if (lineId) {
      // Update specific line item
      const item = order.items.find(i => i.lineId === lineId);
      if (!item) return res.status(404).json({ ok: false, error: 'line_item_not_found' });

      if (status) item.status = status;
      if (trackingNumber) item.trackingNumber = trackingNumber;
      if (carrier) item.carrier = carrier;
      if (status === 'shipped') item.shippedAt = new Date().toISOString();
      if (status === 'delivered') item.deliveredAt = new Date().toISOString();
    } else {
      // Update overall order status
      if (status) order.status = status;
    }

    if (notes) {
      if (!order.statusHistory) order.statusHistory = [];
      order.statusHistory.push({
        status,
        notes,
        timestamp: new Date().toISOString()
      });
    }

    order.updatedAt = new Date().toISOString();
    ordersData.orders[orderIdx] = order;
    writeJSON(ORDERS_FILE, ordersData);

    res.json({ ok: true, order });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'status_update_error' });
  }
});

/**
 * POST /orders/:orderId/receive
 * Mark items as received and update farm inventory
 * Body: { items: [{ lineId, quantityReceived? }] }
 */
router.post('/orders/:orderId/receive', (req, res) => {
  try {
    const ordersData = readJSON(ORDERS_FILE) || { orders: [] };
    const orderIdx = ordersData.orders.findIndex(o => o.orderId === req.params.orderId);
    if (orderIdx === -1) return res.status(404).json({ ok: false, error: 'order_not_found' });

    const order = ordersData.orders[orderIdx];
    const { items: receiveItems } = req.body;

    const inventoryUpdates = [];

    if (receiveItems && Array.isArray(receiveItems)) {
      for (const ri of receiveItems) {
        const item = order.items.find(i => i.lineId === ri.lineId);
        if (!item) continue;
        const qtyReceived = ri.quantityReceived || item.quantity;
        item.status = 'received';
        item.receivedAt = new Date().toISOString();
        item.quantityReceived = qtyReceived;

        // Build inventory update
        inventoryUpdates.push({
          sku: item.sku,
          name: item.name,
          category: item.category,
          quantity: qtyReceived,
          unit: item.saleUnit,
          standardUnit: item.standardUnit,
          standardQty: (item.standardQty || 1) * qtyReceived,
          orderId: order.orderId,
          receivedAt: item.receivedAt
        });
      }
    } else {
      // Receive all items
      for (const item of order.items) {
        if (item.status !== 'received') {
          item.status = 'received';
          item.receivedAt = new Date().toISOString();
          item.quantityReceived = item.quantity;

          inventoryUpdates.push({
            sku: item.sku,
            name: item.name,
            category: item.category,
            quantity: item.quantity,
            unit: item.saleUnit,
            standardUnit: item.standardUnit,
            standardQty: (item.standardQty || 1) * item.quantity,
            orderId: order.orderId,
            receivedAt: item.receivedAt
          });
        }
      }
    }

    // Update order status if all items received
    const allReceived = order.items.every(i => i.status === 'received');
    if (allReceived) order.status = 'delivered';

    order.updatedAt = new Date().toISOString();
    ordersData.orders[orderIdx] = order;
    writeJSON(ORDERS_FILE, ordersData);

    // Update farm supply inventory
    updateFarmSupplyInventory(inventoryUpdates);

    console.log(`[Procurement] Order ${order.orderId} – ${inventoryUpdates.length} item(s) received, inventory updated`);

    res.json({
      ok: true,
      received: inventoryUpdates.length,
      allReceived,
      inventoryUpdates
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'receive_error' });
  }
});

/**
 * POST /orders/:orderId/return
 * Request a return for one or more items
 * Body: { items: [{ lineId, quantity?, reason }] }
 */
router.post('/orders/:orderId/return', (req, res) => {
  try {
    const ordersData = readJSON(ORDERS_FILE) || { orders: [] };
    const orderIdx = ordersData.orders.findIndex(o => o.orderId === req.params.orderId);
    if (orderIdx === -1) return res.status(404).json({ ok: false, error: 'order_not_found' });

    const order = ordersData.orders[orderIdx];
    const { items: returnItems } = req.body;

    if (!returnItems || !Array.isArray(returnItems) || returnItems.length === 0) {
      return res.status(400).json({ ok: false, error: 'return_items_required' });
    }

    const rmaId = `RMA-${Date.now().toString(36).toUpperCase()}`;
    const returnRequest = {
      rmaId,
      orderId: order.orderId,
      items: [],
      status: 'requested',
      createdAt: new Date().toISOString(),
      resolvedAt: null
    };

    for (const ri of returnItems) {
      const item = order.items.find(i => i.lineId === ri.lineId);
      if (!item) continue;

      returnRequest.items.push({
        lineId: item.lineId,
        sku: item.sku,
        name: item.name,
        quantity: ri.quantity || item.quantity,
        reason: ri.reason || 'not_specified',
        refundAmount: item.unitPrice * (ri.quantity || item.quantity)
      });

      item.status = 'return_requested';
    }

    if (!order.returns) order.returns = [];
    order.returns.push(returnRequest);
    order.updatedAt = new Date().toISOString();
    ordersData.orders[orderIdx] = order;
    writeJSON(ORDERS_FILE, ordersData);

    console.log(`[Procurement] Return ${rmaId} requested for order ${order.orderId} – ${returnRequest.items.length} item(s)`);

    res.json({ ok: true, rma: returnRequest });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'return_error' });
  }
});


// ═══════════════════════════════════════════════════════
// FARM SUPPLY INVENTORY
// ═══════════════════════════════════════════════════════

const SUPPLY_INVENTORY_FILE = path.join(DATA_DIR, 'procurement-supply-inventory.json');

function updateFarmSupplyInventory(updates) {
  let inventory = readJSON(SUPPLY_INVENTORY_FILE) || { lastUpdated: null, supplies: [] };

  for (const update of updates) {
    const existing = inventory.supplies.find(s => s.sku === update.sku);
    if (existing) {
      existing.qtyOnHand += update.standardQty;
      existing.lastRestockedAt = update.receivedAt;
      existing.lastOrderId = update.orderId;

      if (!existing.history) existing.history = [];
      existing.history.push({
        type: 'received',
        qty: update.standardQty,
        orderId: update.orderId,
        at: update.receivedAt
      });
      // Keep last 50 history entries
      if (existing.history.length > 50) existing.history = existing.history.slice(-50);
    } else {
      inventory.supplies.push({
        sku: update.sku,
        name: update.name,
        category: update.category,
        standardUnit: update.standardUnit,
        qtyOnHand: update.standardQty,
        minStockLevel: 0,
        lastRestockedAt: update.receivedAt,
        lastOrderId: update.orderId,
        history: [{
          type: 'received',
          qty: update.standardQty,
          orderId: update.orderId,
          at: update.receivedAt
        }]
      });
    }
  }

  inventory.lastUpdated = new Date().toISOString();
  writeJSON(SUPPLY_INVENTORY_FILE, inventory);
}

/**
 * GET /inventory
 * Get farm's supply inventory levels
 */
router.get('/inventory', (req, res) => {
  try {
    const inventory = readJSON(SUPPLY_INVENTORY_FILE) || { lastUpdated: null, supplies: [] };
    const { category, lowStock } = req.query;

    let supplies = inventory.supplies;

    if (category) {
      supplies = supplies.filter(s => s.category === category);
    }

    if (lowStock === 'true') {
      supplies = supplies.filter(s => s.minStockLevel > 0 && s.qtyOnHand <= s.minStockLevel);
    }

    res.json({
      ok: true,
      lastUpdated: inventory.lastUpdated,
      total: supplies.length,
      supplies
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'inventory_error' });
  }
});


// ═══════════════════════════════════════════════════════
// ADMIN / COMMISSION REPORTS
// ═══════════════════════════════════════════════════════

/**
 * GET /commission-report
 * Admin: Generate commission report
 */
router.get('/commission-report', (req, res) => {
  try {
    const ordersData = readJSON(ORDERS_FILE) || { orders: [] };
    const { from, to } = req.query;

    let orders = ordersData.orders;

    if (from) orders = orders.filter(o => new Date(o.createdAt) >= new Date(from));
    if (to) orders = orders.filter(o => new Date(o.createdAt) <= new Date(to));

    // Aggregate by supplier
    const supplierTotals = {};
    let grandTotal = 0;
    let grandCommission = 0;

    for (const order of orders) {
      for (const so of (order.supplierOrders || [])) {
        if (!supplierTotals[so.supplierId]) {
          supplierTotals[so.supplierId] = {
            supplierId: so.supplierId,
            supplierName: so.supplierName,
            orderCount: 0,
            totalSales: 0,
            totalCommission: 0
          };
        }
        supplierTotals[so.supplierId].orderCount++;
        supplierTotals[so.supplierId].totalSales += so.subtotal;
        supplierTotals[so.supplierId].totalCommission += so.commission;
        grandTotal += so.subtotal;
        grandCommission += so.commission;
      }
    }

    res.json({
      ok: true,
      period: { from: from || 'all', to: to || 'all' },
      orderCount: orders.length,
      grandTotal,
      grandCommission,
      suppliers: Object.values(supplierTotals)
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'report_error' });
  }
});

/**
 * PUT /catalog/product
 * Admin: Add or update a product in the catalog
 * Body: { product: { sku, name, description, ... } }
 */
router.put('/catalog/product', (req, res) => {
  try {
    const { product } = req.body;
    if (!product || !product.sku || !product.name) {
      return res.status(400).json({ ok: false, error: 'product_sku_and_name_required' });
    }

    const catalog = readJSON(CATALOG_FILE);
    if (!catalog) return res.status(500).json({ ok: false, error: 'catalog_unavailable' });

    const existingIdx = (catalog.products || []).findIndex(p => p.sku === product.sku);
    if (existingIdx >= 0) {
      // Update existing
      catalog.products[existingIdx] = { ...catalog.products[existingIdx], ...product };
    } else {
      // Add new
      if (!catalog.products) catalog.products = [];
      catalog.products.push(product);
    }

    catalog.lastUpdated = new Date().toISOString();
    writeJSON(CATALOG_FILE, catalog);

    res.json({ ok: true, message: existingIdx >= 0 ? 'product_updated' : 'product_added', sku: product.sku });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'catalog_update_error' });
  }
});

/**
 * DELETE /catalog/product/:sku
 * Admin: Remove a product from the catalog
 */
router.delete('/catalog/product/:sku', (req, res) => {
  try {
    const catalog = readJSON(CATALOG_FILE);
    if (!catalog) return res.status(500).json({ ok: false, error: 'catalog_unavailable' });

    const before = (catalog.products || []).length;
    catalog.products = (catalog.products || []).filter(p => p.sku !== req.params.sku);

    if (catalog.products.length === before) {
      return res.status(404).json({ ok: false, error: 'product_not_found' });
    }

    catalog.lastUpdated = new Date().toISOString();
    writeJSON(CATALOG_FILE, catalog);
    res.json({ ok: true, message: 'product_removed', sku: req.params.sku });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'catalog_delete_error' });
  }
});

/**
 * PUT /suppliers/:supplierId
 * Admin: Update supplier details
 */
router.put('/suppliers/:supplierId', (req, res) => {
  try {
    const data = readJSON(SUPPLIERS_FILE);
    if (!data) return res.status(500).json({ ok: false, error: 'suppliers_unavailable' });

    const idx = (data.suppliers || []).findIndex(s => s.id === req.params.supplierId);
    if (idx === -1) return res.status(404).json({ ok: false, error: 'supplier_not_found' });

    const updates = req.body;
    // Don't allow changing the ID
    delete updates.id;
    data.suppliers[idx] = { ...data.suppliers[idx], ...updates };
    data.lastUpdated = new Date().toISOString();
    writeJSON(SUPPLIERS_FILE, data);

    res.json({ ok: true, message: 'supplier_updated', supplier: data.suppliers[idx] });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'supplier_update_error' });
  }
});


// ═══════════════════════════════════════════════════════
// SUPPLY USAGE TRACKING (AUTO-DEPLETION)
// ═══════════════════════════════════════════════════════

/**
 * Supply category → procurement catalog mapping
 * Maps farm activities to the supplies they consume
 */
const SUPPLY_LINKAGE = {
  seeding: {
    depletionCategories: ['seeds', 'growing-media'],
    description: 'Seeding a tray depletes seeds and grow media'
  },
  nutrient_dosing: {
    depletionCategories: ['nutrients', 'ph-calibration'],
    description: 'Nutrient dosing depletes nutrient solutions and pH adjusters'
  },
  packaging: {
    depletionCategories: ['packaging'],
    description: 'Harvest packaging depletes clamshells, bags, labels'
  },
  labeling: {
    depletionCategories: ['packaging'],
    description: 'Labeling depletes label stock'
  },
  testing: {
    depletionCategories: ['testing'],
    description: 'Quality testing depletes test kits and reagents'
  },
  maintenance: {
    depletionCategories: ['safety'],
    description: 'Equipment maintenance depletes safety and cleaning supplies'
  }
};

/**
 * POST /inventory/deplete
 * Auto-deplete supplies when farm activities occur
 * Body: {
 *   activity: 'seeding' | 'nutrient_dosing' | 'packaging' | 'labeling' | 'testing' | 'maintenance',
 *   items: [{ sku, quantity, reason? }],
 *   source: { type: 'tray_seeding' | 'doser' | 'harvest' | 'manual', refId? }
 * }
 */
router.post('/inventory/deplete', (req, res) => {
  try {
    const { activity, items, source } = req.body;
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ ok: false, error: 'items_required' });
    }

    const inventory = readJSON(SUPPLY_INVENTORY_FILE) || { lastUpdated: null, supplies: [] };
    const depletionLog = [];
    const alerts = [];

    for (const item of items) {
      const supply = inventory.supplies.find(s => s.sku === item.sku);
      if (!supply) {
        depletionLog.push({
          sku: item.sku,
          status: 'not_found',
          message: 'Supply not in inventory'
        });
        continue;
      }

      const depletionQty = item.quantity || 1;
      const prevQty = supply.qtyOnHand;
      supply.qtyOnHand = Math.max(0, supply.qtyOnHand - depletionQty);

      if (!supply.history) supply.history = [];
      supply.history.push({
        type: 'depleted',
        qty: -depletionQty,
        activity: activity || 'manual',
        source: source || { type: 'manual' },
        reason: item.reason || activity,
        at: new Date().toISOString()
      });
      if (supply.history.length > 50) supply.history = supply.history.slice(-50);

      // Track total usage
      if (!supply.totalUsed) supply.totalUsed = 0;
      supply.totalUsed += depletionQty;

      depletionLog.push({
        sku: item.sku,
        name: supply.name,
        status: 'depleted',
        previousQty: prevQty,
        newQty: supply.qtyOnHand,
        depleted: depletionQty
      });

      // Generate low-stock alert
      if (supply.minStockLevel > 0 && supply.qtyOnHand <= supply.minStockLevel) {
        alerts.push({
          type: 'low_stock',
          sku: supply.sku,
          name: supply.name,
          qtyOnHand: supply.qtyOnHand,
          minStockLevel: supply.minStockLevel,
          category: supply.category,
          message: `${supply.name} is below minimum stock level (${supply.qtyOnHand} / ${supply.minStockLevel} ${supply.standardUnit})`
        });
      }

      // Generate out-of-stock alert
      if (supply.qtyOnHand === 0) {
        alerts.push({
          type: 'out_of_stock',
          sku: supply.sku,
          name: supply.name,
          category: supply.category,
          message: `${supply.name} is out of stock`
        });
      }
    }

    inventory.lastUpdated = new Date().toISOString();
    writeJSON(SUPPLY_INVENTORY_FILE, inventory);

    console.log(`[Procurement] Supply depletion: activity=${activity || 'manual'}, items=${depletionLog.length}, alerts=${alerts.length}`);

    res.json({
      ok: true,
      activity: activity || 'manual',
      depleted: depletionLog,
      alerts,
      timestamp: inventory.lastUpdated
    });
  } catch (error) {
    console.error('[Procurement] Depletion error:', error);
    res.status(500).json({ ok: false, error: 'depletion_error' });
  }
});

/**
 * POST /inventory/record-dosing
 * Record nutrient dosing event from the doser system
 * Auto-depletes nutrient and pH adjuster supplies
 * Body: {
 *   nutrientType: 'flora_grow' | 'flora_micro' | 'flora_bloom' | 'masterblend' | 'ph_down' | 'ph_up',
 *   volumeMl: number,
 *   roomId?: string,
 *   doserId?: string
 * }
 */
router.post('/inventory/record-dosing', (req, res) => {
  try {
    const { nutrientType, volumeMl, roomId, doserId } = req.body;
    if (!nutrientType || !volumeMl) {
      return res.status(400).json({ ok: false, error: 'nutrientType_and_volumeMl_required' });
    }

    // Map nutrient types to catalog SKUs
    const NUTRIENT_SKU_MAP = {
      'flora_grow': 'PROC-NUT-FLORA-GROW',
      'flora_micro': 'PROC-NUT-FLORA-MICRO',
      'flora_bloom': 'PROC-NUT-FLORA-BLOOM',
      'masterblend': 'PROC-NUT-MASTERBLEND',
      'ph_down': 'PROC-NUT-PH-DOWN',
      'ph_up': 'PROC-NUT-PH-UP',
      'calmag': 'PROC-NUT-CALMAG'
    };

    const sku = NUTRIENT_SKU_MAP[nutrientType];
    if (!sku) {
      return res.status(400).json({ ok: false, error: 'unknown_nutrient_type', validTypes: Object.keys(NUTRIENT_SKU_MAP) });
    }

    const inventory = readJSON(SUPPLY_INVENTORY_FILE) || { lastUpdated: null, supplies: [] };
    const supply = inventory.supplies.find(s => s.sku === sku);

    const depletionResult = {
      nutrientType,
      sku,
      volumeMl,
      roomId: roomId || 'unknown',
      doserId: doserId || 'unknown',
      timestamp: new Date().toISOString()
    };

    if (supply) {
      const prevQty = supply.qtyOnHand;
      supply.qtyOnHand = Math.max(0, supply.qtyOnHand - volumeMl);
      if (!supply.totalUsed) supply.totalUsed = 0;
      supply.totalUsed += volumeMl;

      if (!supply.history) supply.history = [];
      supply.history.push({
        type: 'dosing',
        qty: -volumeMl,
        activity: 'nutrient_dosing',
        source: { type: 'doser', doserId, roomId },
        at: depletionResult.timestamp
      });
      if (supply.history.length > 50) supply.history = supply.history.slice(-50);

      depletionResult.previousQty = prevQty;
      depletionResult.newQty = supply.qtyOnHand;
      depletionResult.status = 'recorded';
    } else {
      depletionResult.status = 'not_in_inventory';
      depletionResult.message = 'Nutrient not yet in supply inventory. Order via procurement.';
    }

    inventory.lastUpdated = new Date().toISOString();
    writeJSON(SUPPLY_INVENTORY_FILE, inventory);

    console.log(`[Procurement] Dosing recorded: ${nutrientType} ${volumeMl}mL room=${roomId}`);
    res.json({ ok: true, dosing: depletionResult });
  } catch (error) {
    console.error('[Procurement] Dosing record error:', error);
    res.status(500).json({ ok: false, error: 'dosing_record_error' });
  }
});

/**
 * POST /inventory/record-seeding
 * Record seeding event that depletes seeds and grow media
 * Body: {
 *   cropName: string,
 *   seedSku?: string,
 *   mediaSku?: string,
 *   trayCount: number,
 *   seedsPerTray?: number,
 *   mediaVolumePerTray?: number (liters),
 *   roomId?: string,
 *   groupId?: string,
 *   trayIds?: string[]
 * }
 */
router.post('/inventory/record-seeding', (req, res) => {
  try {
    const { cropName, seedSku, mediaSku, trayCount = 1, seedsPerTray, mediaVolumePerTray, roomId, groupId, trayIds } = req.body;
    if (!cropName) {
      return res.status(400).json({ ok: false, error: 'cropName_required' });
    }

    const inventory = readJSON(SUPPLY_INVENTORY_FILE) || { lastUpdated: null, supplies: [] };
    const results = [];
    const timestamp = new Date().toISOString();

    // Deplete seeds
    if (seedSku) {
      const seedSupply = inventory.supplies.find(s => s.sku === seedSku);
      if (seedSupply) {
        const totalSeeds = (seedsPerTray || 1) * trayCount;
        const prev = seedSupply.qtyOnHand;
        seedSupply.qtyOnHand = Math.max(0, seedSupply.qtyOnHand - totalSeeds);
        if (!seedSupply.totalUsed) seedSupply.totalUsed = 0;
        seedSupply.totalUsed += totalSeeds;
        if (!seedSupply.history) seedSupply.history = [];
        seedSupply.history.push({
          type: 'seeding',
          qty: -totalSeeds,
          activity: 'seeding',
          crop: cropName,
          trayCount,
          source: { type: 'tray_seeding', roomId, groupId },
          at: timestamp
        });
        if (seedSupply.history.length > 50) seedSupply.history = seedSupply.history.slice(-50);
        results.push({ type: 'seeds', sku: seedSku, depleted: totalSeeds, previousQty: prev, newQty: seedSupply.qtyOnHand });
      }
    }

    // Deplete grow media
    if (mediaSku) {
      const mediaSupply = inventory.supplies.find(s => s.sku === mediaSku);
      if (mediaSupply) {
        const totalMedia = (mediaVolumePerTray || 1) * trayCount;
        const prev = mediaSupply.qtyOnHand;
        mediaSupply.qtyOnHand = Math.max(0, mediaSupply.qtyOnHand - totalMedia);
        if (!mediaSupply.totalUsed) mediaSupply.totalUsed = 0;
        mediaSupply.totalUsed += totalMedia;
        if (!mediaSupply.history) mediaSupply.history = [];
        mediaSupply.history.push({
          type: 'seeding',
          qty: -totalMedia,
          activity: 'seeding',
          crop: cropName,
          trayCount,
          source: { type: 'tray_seeding', roomId, groupId },
          at: timestamp
        });
        if (mediaSupply.history.length > 50) mediaSupply.history = mediaSupply.history.slice(-50);
        results.push({ type: 'grow_media', sku: mediaSku, depleted: totalMedia, previousQty: prev, newQty: mediaSupply.qtyOnHand });
      }
    }

    inventory.lastUpdated = timestamp;
    writeJSON(SUPPLY_INVENTORY_FILE, inventory);

    console.log(`[Procurement] Seeding recorded: ${cropName} x${trayCount} trays, ${results.length} supplies depleted`);
    res.json({ ok: true, crop: cropName, trayCount, depletions: results });
  } catch (error) {
    console.error('[Procurement] Seeding record error:', error);
    res.status(500).json({ ok: false, error: 'seeding_record_error' });
  }
});

/**
 * POST /inventory/record-packaging
 * Record packaging event that depletes clamshells, bags, labels
 * Body: {
 *   items: [{ sku, quantity, reason? }],
 *   harvestId?: string,
 *   cropName?: string
 * }
 */
router.post('/inventory/record-packaging', (req, res) => {
  try {
    const { items, harvestId, cropName } = req.body;
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ ok: false, error: 'items_required' });
    }

    const inventory = readJSON(SUPPLY_INVENTORY_FILE) || { lastUpdated: null, supplies: [] };
    const results = [];
    const timestamp = new Date().toISOString();

    for (const item of items) {
      const supply = inventory.supplies.find(s => s.sku === item.sku);
      if (!supply) {
        results.push({ sku: item.sku, status: 'not_found' });
        continue;
      }

      const qty = item.quantity || 1;
      const prev = supply.qtyOnHand;
      supply.qtyOnHand = Math.max(0, supply.qtyOnHand - qty);
      if (!supply.totalUsed) supply.totalUsed = 0;
      supply.totalUsed += qty;

      if (!supply.history) supply.history = [];
      supply.history.push({
        type: 'packaging',
        qty: -qty,
        activity: 'packaging',
        crop: cropName,
        harvestId,
        source: { type: 'harvest', harvestId },
        at: timestamp
      });
      if (supply.history.length > 50) supply.history = supply.history.slice(-50);

      results.push({ sku: item.sku, name: supply.name, depleted: qty, previousQty: prev, newQty: supply.qtyOnHand });
    }

    inventory.lastUpdated = timestamp;
    writeJSON(SUPPLY_INVENTORY_FILE, inventory);

    console.log(`[Procurement] Packaging recorded: ${cropName || 'unknown'} harvest, ${results.length} supplies depleted`);
    res.json({ ok: true, crop: cropName, harvestId, depletions: results });
  } catch (error) {
    console.error('[Procurement] Packaging record error:', error);
    res.status(500).json({ ok: false, error: 'packaging_record_error' });
  }
});

/**
 * GET /inventory/usage-summary
 * Get supply usage summary (consumption rates, projection)
 * Query: ?period=7d|30d|90d
 */
router.get('/inventory/usage-summary', (req, res) => {
  try {
    const inventory = readJSON(SUPPLY_INVENTORY_FILE) || { lastUpdated: null, supplies: [] };
    const period = req.query.period || '30d';
    const daysBack = parseInt(period) || 30;
    const cutoff = new Date(Date.now() - daysBack * 86400000).toISOString();

    const summary = inventory.supplies.map(supply => {
      const recentHistory = (supply.history || []).filter(h => h.at >= cutoff && h.qty < 0);
      const totalUsed = recentHistory.reduce((sum, h) => sum + Math.abs(h.qty), 0);
      const dailyRate = totalUsed / daysBack;
      const daysRemaining = dailyRate > 0 ? Math.round(supply.qtyOnHand / dailyRate) : null;

      return {
        sku: supply.sku,
        name: supply.name,
        category: supply.category,
        qtyOnHand: supply.qtyOnHand,
        standardUnit: supply.standardUnit,
        totalUsedInPeriod: totalUsed,
        dailyUsageRate: Math.round(dailyRate * 100) / 100,
        daysRemaining,
        minStockLevel: supply.minStockLevel,
        needsReorder: supply.minStockLevel > 0 && supply.qtyOnHand <= supply.minStockLevel,
        isOutOfStock: supply.qtyOnHand === 0
      };
    });

    res.json({
      ok: true,
      period: `${daysBack}d`,
      total: summary.length,
      needsReorder: summary.filter(s => s.needsReorder).length,
      outOfStock: summary.filter(s => s.isOutOfStock).length,
      supplies: summary
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'usage_summary_error' });
  }
});

/**
 * PUT /inventory/:sku/min-stock
 * Set minimum stock level for auto-reorder alerts
 * Body: { minStockLevel: number }
 */
router.put('/inventory/:sku/min-stock', (req, res) => {
  try {
    const inventory = readJSON(SUPPLY_INVENTORY_FILE) || { lastUpdated: null, supplies: [] };
    const supply = inventory.supplies.find(s => s.sku === req.params.sku);
    if (!supply) return res.status(404).json({ ok: false, error: 'supply_not_found' });

    supply.minStockLevel = req.body.minStockLevel || 0;
    inventory.lastUpdated = new Date().toISOString();
    writeJSON(SUPPLY_INVENTORY_FILE, inventory);

    res.json({ ok: true, sku: supply.sku, name: supply.name, minStockLevel: supply.minStockLevel });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'min_stock_error' });
  }
});

/**
 * GET /inventory/linkage-map
 * Returns the supply linkage map showing which activities deplete which supply categories
 * Used by other systems to know which supplies to auto-deplete
 */
router.get('/inventory/linkage-map', (req, res) => {
  res.json({ ok: true, linkages: SUPPLY_LINKAGE });
});


export default router;
