/**
 * Farm Sales - Order Management
 * Unified order system for POS, D2C, B2B, and donation channels (MULTI-TENANT)
 */

import express from 'express';
import { farmAuthMiddleware } from '../../lib/farm-auth.js';
import { farmStores } from '../../lib/farm-store.js';
import { getSubOrders } from '../../lib/wholesale-integration.js';

const router = express.Router();

// Apply authentication to all routes
router.use(farmAuthMiddleware);

/**
 * Order channels and their routing logic
 */
const ORDER_CHANNELS = {
  POS: 'pos',           // Walk-up farm stand sales
  D2C: 'd2c',           // Direct-to-consumer online orders
  B2B: 'b2b',           // Business orders (routes to GreenReach)
  DONATION: 'donation', // Social/food security programs
  DELIVERY: 'delivery'  // Home delivery service
};

/**
 * POST /api/farm-sales/orders
 * Create new order across any channel
 * 
 * Body:
 * {
 *   channel: 'pos'|'d2c'|'b2b'|'donation'|'delivery',
 *   customer: { name, email, phone, address? },
 *   items: [{ sku_id, name, quantity, unit_price, category }],
 *   payment: { method: 'cash'|'card'|'invoice'|'grant', amount?, reference? },
 *   delivery?: { date, time_slot, instructions },
 *   program?: { name, grant_id, subsidy_percent } // For donation orders
 * }
 */
router.post('/', async (req, res) => {
  try {
    const { channel, customer, items, payment, delivery, pricing, program, notes } = req.body;
    const farmId = req.farm_id; // From auth middleware

    // Validate channel
    if (!Object.values(ORDER_CHANNELS).includes(channel)) {
      return res.status(400).json({
        ok: false,
        error: 'invalid_channel',
        message: `Channel must be one of: ${Object.values(ORDER_CHANNELS).join(', ')}`
      });
    }

    // Validate items
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        ok: false,
        error: 'items_required',
        message: 'Order must contain at least one item'
      });
    }

    // Generate farm-scoped order ID
    const orderId = farmStores.orders.generateId(farmId, 'FS', 6);
    const timestamp = new Date().toISOString();

    // Calculate totals
    const subtotal = items.reduce((sum, item) => {
      return sum + (item.quantity * item.unit_price);
    }, 0);

    // Apply program subsidy if donation order
    let subsidy = 0;
    let finalTotal = subtotal;
    if (channel === ORDER_CHANNELS.DONATION && program?.subsidy_percent) {
      subsidy = subtotal * (program.subsidy_percent / 100);
      finalTotal = subtotal - subsidy;
    }

    const tax = finalTotal * 0.08; // 8% sales tax (configurable by jurisdiction)
    const requestedDeliveryFee = Math.max(
      0,
      Number(
        pricing?.delivery_fee ??
        delivery?.delivery_fee ??
        0
      ) || 0
    );
    const requestedTip = Math.max(
      0,
      Number(
        pricing?.tip ??
        pricing?.tip_amount ??
        delivery?.tip_amount ??
        0
      ) || 0
    );
    const isDeliveryOrder = String(delivery?.method || '').toLowerCase() === 'delivery' || channel === ORDER_CHANNELS.DELIVERY;
    const deliveryFee = isDeliveryOrder ? requestedDeliveryFee : 0;
    const tipAmount = requestedTip;
    const total = finalTotal + tax + deliveryFee + tipAmount;

    // Create order object
    const order = {
      order_id: orderId,
      channel,
      status: 'pending',
      customer,
      items,
      lot_codes: [], // Track lot codes for recall capability
      payment: {
        ...payment,
        status: 'pending',
        amount: total
      },
      delivery,
      program,
      notes,
      pricing: {
        subtotal,
        subsidy,
        tax,
        delivery_fee: deliveryFee,
        tip: tipAmount,
        total
      },
      timestamps: {
        created_at: timestamp,
        updated_at: timestamp
      },
      fulfillment: {
        status: 'pending',
        picked_at: null,
        packed_at: null,
        ready_at: null,
        completed_at: null
      }
    };

    // For B2B orders, route through GreenReach wholesale
    if (channel === ORDER_CHANNELS.B2B) {
      order.greenreach = {
        routed: true,
        marketplace_order_id: null, // Set after GreenReach creates order
        routed_at: timestamp
      };
      // TODO: Call /api/wholesale/checkout/execute to create marketplace order
    }

    // Store order in farm-scoped store
    farmStores.orders.set(farmId, orderId, order);

    // For POS orders, mark payment as completed immediately if cash
    if (channel === ORDER_CHANNELS.POS && payment.method === 'cash') {
      order.payment.status = 'completed';
      order.payment.completed_at = timestamp;
      order.status = 'confirmed';
    }

    res.status(201).json({
      ok: true,
      order_id: orderId,
      order,
      next_steps: getNextSteps(order)
    });

  } catch (error) {
    console.error('[farm-sales] Order creation failed:', error);
    res.status(500).json({
      ok: false,
      error: 'order_creation_failed',
      message: error.message
    });
  }
});

/**
 * GET /api/farm-sales/orders
 * List orders with filtering
 * 
 * Query params:
 * - channel: Filter by channel
 * - status: Filter by status
 * - date_from: ISO date
 * - date_to: ISO date
 * - limit: Max results (default 50)
 */
router.get('/', (req, res) => {
  try {
    const { channel, status, date_from, date_to, limit = 50 } = req.query;
    const farmId = req.farm_id;
    
    let filtered = farmStores.orders.getAllForFarm(farmId);

    // Apply filters
    if (channel) {
      filtered = filtered.filter(o => o.channel === channel);
    }
    if (status) {
      filtered = filtered.filter(o => o.status === status);
    }
    if (date_from) {
      const fromDate = new Date(date_from);
      filtered = filtered.filter(o => new Date(o.timestamps.created_at) >= fromDate);
    }
    if (date_to) {
      const toDate = new Date(date_to);
      filtered = filtered.filter(o => new Date(o.timestamps.created_at) <= toDate);
    }

    // Sort by created_at descending
    filtered.sort((a, b) => 
      new Date(b.timestamps.created_at) - new Date(a.timestamps.created_at)
    );

    // Apply limit
    const results = filtered.slice(0, parseInt(limit));

    res.json({
      ok: true,
      total: filtered.length,
      returned: results.length,
      orders: results
    });

  } catch (error) {
    console.error('[farm-sales] Order list failed:', error);
    res.status(500).json({
      ok: false,
      error: 'list_failed',
      message: error.message
    });
  }
});

/**
 * GET /api/farm-sales/orders/:orderId
 * Get single order details
 */
router.get('/:orderId', (req, res) => {
  const { orderId } = req.params;
  const farmId = req.farm_id;
  const order = farmStores.orders.get(farmId, orderId);

  if (!order) {
    return res.status(404).json({
      ok: false,
      error: 'order_not_found',
      order_id: orderId
    });
  }

  res.json({
    ok: true,
    order
  });
});

/**
 * PATCH /api/farm-sales/orders/:orderId
 * Update order status or fulfillment
 * 
 * Body:
 * {
 *   status?: 'pending'|'confirmed'|'fulfilled'|'cancelled',
 *   fulfillment?: { status, picked_at?, packed_at?, ready_at?, completed_at? },
 *   payment?: { status, completed_at?, reference? }
 * }
 */
router.patch('/:orderId', (req, res) => {
  try {
    const { orderId } = req.params;
    const updates = req.body;
    const farmId = req.farm_id;
    const order = farmStores.orders.get(farmId, orderId);

    if (!order) {
      return res.status(404).json({
        ok: false,
        error: 'order_not_found',
        order_id: orderId
      });
    }

    const timestamp = new Date().toISOString();

    // Update status
    if (updates.status) {
      order.status = updates.status;
    }

    // Update fulfillment
    if (updates.fulfillment) {
      order.fulfillment = {
        ...order.fulfillment,
        ...updates.fulfillment
      };
    }

    // Update payment
    if (updates.payment) {
      order.payment = {
        ...order.payment,
        ...updates.payment
      };
    }

    order.timestamps.updated_at = timestamp;
    farmStores.orders.set(farmId, orderId, order);

    res.json({
      ok: true,
      order_id: orderId,
      order,
      next_steps: getNextSteps(order)
    });

  } catch (error) {
    console.error('[farm-sales] Order update failed:', error);
    res.status(500).json({
      ok: false,
      error: 'update_failed',
      message: error.message
    });
  }
});

/**
 * GET /api/farm-sales/orders/stats/summary
 * Get order statistics by channel and status
 */
router.get('/stats/summary', (req, res) => {
  try {
    const farmId = req.farm_id;
    const allOrders = farmStores.orders.getAllForFarm(farmId);
    
    const summary = {
      total_orders: allOrders.length,
      by_channel: {},
      by_status: {},
      revenue: {
        total: 0,
        by_channel: {}
      }
    };

    // Calculate stats
    allOrders.forEach(order => {
      // Count by channel
      if (!summary.by_channel[order.channel]) {
        summary.by_channel[order.channel] = 0;
        summary.revenue.by_channel[order.channel] = 0;
      }
      summary.by_channel[order.channel]++;
      
      // Count by status
      if (!summary.by_status[order.status]) {
        summary.by_status[order.status] = 0;
      }
      summary.by_status[order.status]++;

      // Calculate revenue (only confirmed/fulfilled orders)
      if (['confirmed', 'fulfilled'].includes(order.status)) {
        const revenue = order.pricing.total || 0;
        summary.revenue.total += revenue;
        summary.revenue.by_channel[order.channel] += revenue;
      }
    });

    res.json({
      ok: true,
      summary,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('[farm-sales] Stats failed:', error);
    res.status(500).json({
      ok: false,
      error: 'stats_failed',
      message: error.message
    });
  }
});

/**
 * Helper: Determine next steps for order workflow
 */
function getNextSteps(order) {
  const steps = [];

  if (order.payment.status === 'pending') {
    steps.push({
      action: 'complete_payment',
      description: 'Process payment to confirm order',
      endpoint: `PATCH /api/farm-sales/orders/${order.order_id}`,
      payload: { payment: { status: 'completed', completed_at: new Date().toISOString() } }
    });
  }

  if (order.status === 'confirmed' && order.fulfillment.status === 'pending') {
    steps.push({
      action: 'start_fulfillment',
      description: 'Begin picking and packing order',
      endpoint: `PATCH /api/farm-sales/orders/${order.order_id}`,
      payload: { fulfillment: { status: 'picking', picked_at: new Date().toISOString() } }
    });
  }

  if (order.fulfillment.status === 'ready') {
    if (order.delivery) {
      steps.push({
        action: 'schedule_delivery',
        description: 'Assign to delivery route',
        endpoint: `POST /api/farm-sales/deliveries`,
        payload: { order_id: order.order_id, delivery_date: order.delivery.date }
      });
    } else {
      steps.push({
        action: 'notify_pickup',
        description: 'Notify customer order is ready for pickup',
        endpoint: `POST /api/farm-sales/notifications`,
        payload: { order_id: order.order_id, type: 'ready_for_pickup' }
      });
    }
  }

  return steps;
}

/**
 * GET /api/farm-sales/orders/:orderId/sub-orders
 * Get sub-order tracking for B2B orders routed to wholesale
 * Returns fulfillment status from GreenReach marketplace
 * 
 * Response:
 * {
 *   ok: true,
 *   master_order_id: string,
 *   sub_orders: [{
 *     sub_order_id, farm_id, farm_name, status,
 *     line_items, subtotal, broker_fee, total, payment_id
 *   }]
 * }
 */
router.get('/:orderId/sub-orders', async (req, res) => {
  try {
    const { orderId } = req.params;
    const farmId = req.farm_id;
    const authToken = req.headers.authorization;

    // Get order from farm store
    const order = farmStores.orders.get(farmId, orderId);

    if (!order) {
      return res.status(404).json({
        ok: false,
        error: 'order_not_found',
        order_id: orderId
      });
    }

    // Check if order has wholesale routing metadata
    if (!order.wholesale_order_id) {
      return res.status(400).json({
        ok: false,
        error: 'not_wholesale_order',
        message: 'This order was not routed to wholesale marketplace',
        order_id: orderId,
        channel: order.channel
      });
    }

    console.log(`[farm-sales] Fetching sub-orders for wholesale order ${order.wholesale_order_id}`);

    // Fetch sub-order details from GreenReach
    const subOrders = await getSubOrders(order.wholesale_order_id, authToken);

    res.json({
      ok: true,
      master_order_id: order.wholesale_order_id,
      local_order_id: orderId,
      channel: order.channel,
      sub_orders: subOrders,
      total_sub_orders: subOrders.length,
      farms_involved: [...new Set(subOrders.map(so => so.farm_name))]
    });

  } catch (error) {
    console.error('[farm-sales] Sub-order fetch failed:', error);
    res.status(500).json({
      ok: false,
      error: 'sub_order_fetch_failed',
      message: error.message
    });
  }
});

/**
 * POST /api/farm-sales/orders/:orderId/lot-codes
 * Link lot codes to order for traceability
 * 
 * Body:
 * {
 *   lot_codes: ['A1-LETTUCE-251216-001', 'B2-BASIL-251216-001']
 * }
 */
router.post('/:orderId/lot-codes', (req, res) => {
  try {
    const { orderId } = req.params;
    const { lot_codes } = req.body;
    const farmId = req.farm_id;
    
    if (!Array.isArray(lot_codes) || lot_codes.length === 0) {
      return res.status(400).json({
        ok: false,
        error: 'lot_codes_required'
      });
    }
    
    const order = farmStores.orders.get(farmId, orderId);
    
    if (!order) {
      return res.status(404).json({
        ok: false,
        error: 'order_not_found'
      });
    }
    
    // Add lot codes to order (avoid duplicates)
    if (!order.lot_codes) {
      order.lot_codes = [];
    }
    
    lot_codes.forEach(lotCode => {
      if (!order.lot_codes.includes(lotCode)) {
        order.lot_codes.push(lotCode);
      }
    });
    
    order.timestamps.updated_at = new Date().toISOString();
    farmStores.orders.set(farmId, orderId, order);
    
    // Also update lot tracking records to link customer
    lot_codes.forEach(lotCode => {
      const lot = farmStores.lotTracking.get(farmId, lotCode);
      if (lot) {
        const customerId = order.customer.customer_id || order.customer.email;
        if (!lot.customers.includes(customerId)) {
          lot.customers.push(customerId);
        }
        if (!lot.orders.includes(orderId)) {
          lot.orders.push(orderId);
        }
        farmStores.lotTracking.set(farmId, lotCode, lot);
      }
    });
    
    res.json({
      ok: true,
      order_id: orderId,
      lot_codes: order.lot_codes
    });
    
  } catch (error) {
    console.error('[farm-sales] Lot code linking failed:', error);
    res.status(500).json({
      ok: false,
      error: 'lot_code_link_failed',
      message: error.message
    });
  }
});

export default router;
