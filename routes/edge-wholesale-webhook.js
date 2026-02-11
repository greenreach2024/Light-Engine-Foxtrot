/**
 * Farm Wholesale Order Webhook Receiver
 * 
 * Receives wholesale orders from GreenReach Central and processes them locally.
 * Orders are routed to specific farms based on inventory allocation.
 * 
 * Webhook Flow:
 * 1. GreenReach checkout creates order (multi-farm aggregation)
 * 2. GreenReach sends webhook to each farm server
 * 3. Farm server validates inventory, creates local order record
 * 4. Farm fulfills order, sends status updates back to Central
 * 5. Central tracks overall order progress across farms
 */

import express from 'express';
import edgeConfig from '../lib/edge-config.js';
import crypto from 'crypto';

const router = express.Router();

// In-memory order storage (TODO: migrate to database)
const orders = new Map();

/**
 * POST /api/edge/wholesale/webhook
 * 
 * Receive wholesale order from GreenReach Central
 * 
 * Headers:
 * - X-GreenReach-Signature: HMAC signature for webhook verification
 * - X-GreenReach-Timestamp: Unix timestamp
 * 
 * Body:
 * {
 *   order_id: 'ORD-12345',
 *   sub_order_id: 'SUB-ABC123', // Farm-specific sub-order ID
 *   farm_id: 'FARM-001',
 *   buyer_id: 'BUYER-456',
 *   buyer_name: 'Whole Foods Market',
 *   buyer_email: 'purchasing@wholefoods.com',
 *   buyer_phone: '+1-555-123-4567',
 *   order_date: '2025-12-18T10:30:00Z',
 *   requested_delivery_date: '2025-12-20',
 *   delivery_method: 'farm_pickup' | 'farm_delivery' | 'buyer_pickup',
 *   delivery_address: {
 *     street: '123 Main St',
 *     city: 'Seattle',
 *     state: 'WA',
 *     zip: '98101',
 *     country: 'USA'
 *   },
 *   line_items: [{
 *     lot_id: 'LOT-ROOM-A-Z1-G01',
 *     sku_id: 'SKU-BUTTERHEAD-5LB',
 *     sku_name: 'Butterhead Lettuce, 5lb case',
 *     qty: 5,
 *     unit_price: 12.50,
 *     total_price: 62.50
 *   }],
 *   totals: {
 *     subtotal: 62.50,
 *     tax: 0.00,
 *     delivery_fee: 0.00,
 *     total: 62.50
 *   },
 *   payment_status: 'paid',
 *   notes: 'Please include harvest date on label'
 * }
 */
router.post('/webhook', async (req, res) => {
  try {
    console.log('[Edge Webhook] Received wholesale order webhook');

    // Verify webhook signature
    const signature = req.headers['x-greenreach-signature'];
    const timestamp = req.headers['x-greenreach-timestamp'];
    
    if (!verifyWebhookSignature(req.body, signature, timestamp)) {
      console.error('[Edge Webhook] Invalid webhook signature');
      return res.status(401).json({
        ok: false,
        error: 'Invalid webhook signature'
      });
    }

    const order = req.body;

    // Validate order structure
    const validation = validateOrder(order);
    if (!validation.valid) {
      console.error('[Edge Webhook] Invalid order:', validation.errors);
      return res.status(400).json({
        ok: false,
        error: 'Invalid order format',
        details: validation.errors
      });
    }

    // Verify farm ID matches this device
    if (order.farm_id !== edgeConfig.getFarmId()) {
      console.error('[Edge Webhook] Order farm ID mismatch');
      return res.status(400).json({
        ok: false,
        error: 'Order farm_id does not match this device'
      });
    }

    // Check inventory availability
    const inventoryCheck = await checkInventoryAvailability(order.line_items);
    if (!inventoryCheck.available) {
      console.error('[Edge Webhook] Insufficient inventory');
      
      // Send unavailable notification to Central
      await notifyCentralOrderStatus(order.sub_order_id, 'rejected', {
        reason: 'insufficient_inventory',
        details: inventoryCheck.details
      });

      return res.status(409).json({
        ok: false,
        error: 'Insufficient inventory',
        details: inventoryCheck.details
      });
    }

    // Reserve inventory
    await reserveInventory(order.sub_order_id, order.line_items);

    // Create local order record
    const localOrder = {
      ...order,
      status: 'pending',
      fulfillment_status: 'pending',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      history: [{
        status: 'pending',
        timestamp: new Date().toISOString(),
        note: 'Order received from GreenReach Central'
      }]
    };

    orders.set(order.sub_order_id, localOrder);

    console.log(`[Edge Webhook] ✓ Order ${order.sub_order_id} accepted`);
    console.log(`[Edge Webhook] Items: ${order.line_items.length}, Total: $${order.totals.total}`);

    // Notify Central that order was accepted
    await notifyCentralOrderStatus(order.sub_order_id, 'accepted', {
      message: 'Order received and inventory reserved'
    });

    res.status(200).json({
      ok: true,
      sub_order_id: order.sub_order_id,
      status: 'accepted',
      message: 'Order received and accepted',
      estimated_fulfillment: calculateEstimatedFulfillment(order)
    });

  } catch (error) {
    console.error('[Edge Webhook] Error processing webhook:', error.message);
    
    // Try to notify Central of processing error
    if (req.body?.sub_order_id) {
      await notifyCentralOrderStatus(req.body.sub_order_id, 'error', {
        error: error.message
      }).catch(() => {});
    }

    res.status(500).json({
      ok: false,
      error: 'Internal server error processing order'
    });
  }
});

/**
 * GET /api/edge/wholesale/orders
 * 
 * List all wholesale orders on this edge device
 */
router.get('/orders', (req, res) => {
  const { status, limit = 50 } = req.query;

  let orderList = Array.from(orders.values());

  // Filter by status if provided
  if (status) {
    orderList = orderList.filter(o => o.fulfillment_status === status);
  }

  // Sort by date descending
  orderList.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  // Limit results
  orderList = orderList.slice(0, parseInt(limit));

  res.json({
    ok: true,
    count: orderList.length,
    orders: orderList
  });
});

/**
 * GET /api/edge/wholesale/orders/:sub_order_id
 * 
 * Get details of a specific order
 */
router.get('/orders/:sub_order_id', (req, res) => {
  const { sub_order_id } = req.params;
  
  const order = orders.get(sub_order_id);
  
  if (!order) {
    return res.status(404).json({
      ok: false,
      error: 'Order not found'
    });
  }

  res.json({
    ok: true,
    order
  });
});

/**
 * POST /api/edge/wholesale/orders/:sub_order_id/status
 * 
 * Update order fulfillment status
 * 
 * Body:
 * {
 *   status: 'picked' | 'packed' | 'shipped' | 'delivered',
 *   notes: string,
 *   tracking_number: string (for shipped),
 *   carrier: string (for shipped)
 * }
 */
router.post('/orders/:sub_order_id/status', async (req, res) => {
  try {
    const { sub_order_id } = req.params;
    const { status, notes, tracking_number, carrier } = req.body;

    const order = orders.get(sub_order_id);
    
    if (!order) {
      return res.status(404).json({
        ok: false,
        error: 'Order not found'
      });
    }

    // Validate status transition
    const validStatuses = ['pending', 'picked', 'packed', 'shipped', 'delivered', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid status'
      });
    }

    // Update order
    const oldStatus = order.fulfillment_status;
    order.fulfillment_status = status;
    order.updated_at = new Date().toISOString();
    
    if (tracking_number) {
      order.tracking_number = tracking_number;
    }
    
    if (carrier) {
      order.carrier = carrier;
    }

    // Add to history
    order.history.push({
      status,
      timestamp: new Date().toISOString(),
      note: notes || `Status changed from ${oldStatus} to ${status}`,
      tracking_number,
      carrier
    });

    orders.set(sub_order_id, order);

    console.log(`[Edge Webhook] Order ${sub_order_id} status: ${oldStatus} → ${status}`);

    // Notify Central of status change
    await notifyCentralOrderStatus(sub_order_id, status, {
      notes,
      tracking_number,
      carrier
    });

    res.json({
      ok: true,
      sub_order_id,
      old_status: oldStatus,
      new_status: status,
      updated_at: order.updated_at
    });

  } catch (error) {
    console.error('[Edge Webhook] Error updating order status:', error.message);
    res.status(500).json({
      ok: false,
      error: 'Failed to update order status'
    });
  }
});

/**
 * Helper: Verify webhook signature
 */
function verifyWebhookSignature(payload, signature, timestamp) {
  // Skip verification in development mode
  if (process.env.NODE_ENV === 'development' || !signature) {
    return true;
  }

  try {
    const secret = edgeConfig.getApiKey() || process.env.WEBHOOK_SECRET;
    if (!secret) {
      console.warn('[Edge Webhook] No webhook secret configured, skipping verification');
      return true;
    }

    // Verify timestamp is recent (within 5 minutes)
    const now = Math.floor(Date.now() / 1000);
    const requestTime = parseInt(timestamp);
    if (Math.abs(now - requestTime) > 300) {
      console.error('[Edge Webhook] Timestamp too old');
      return false;
    }

    // Compute HMAC signature
    const payloadString = JSON.stringify(payload);
    const computedSignature = crypto
      .createHmac('sha256', secret)
      .update(`${timestamp}.${payloadString}`)
      .digest('hex');

    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(computedSignature)
    );

  } catch (error) {
    console.error('[Edge Webhook] Signature verification error:', error.message);
    return false;
  }
}

/**
 * Helper: Validate order structure
 */
function validateOrder(order) {
  const errors = [];

  if (!order.order_id) errors.push('Missing order_id');
  if (!order.sub_order_id) errors.push('Missing sub_order_id');
  if (!order.farm_id) errors.push('Missing farm_id');
  if (!order.buyer_id) errors.push('Missing buyer_id');
  if (!order.line_items || !Array.isArray(order.line_items)) {
    errors.push('Missing or invalid line_items');
  }

  if (order.line_items) {
    order.line_items.forEach((item, index) => {
      if (!item.lot_id) errors.push(`Item ${index}: missing lot_id`);
      if (!item.sku_id) errors.push(`Item ${index}: missing sku_id`);
      if (!item.qty || item.qty <= 0) errors.push(`Item ${index}: invalid qty`);
    });
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Helper: Check inventory availability
 */
async function checkInventoryAvailability(lineItems) {
  // TODO: Query actual farm inventory database
  // For now, simulate availability check
  
  const unavailable = [];

  for (const item of lineItems) {
    // Mock availability check
    const available = Math.floor(Math.random() * 100);
    if (available < item.qty) {
      unavailable.push({
        lot_id: item.lot_id,
        sku_id: item.sku_id,
        requested: item.qty,
        available: available
      });
    }
  }

  return {
    available: unavailable.length === 0,
    details: unavailable
  };
}

/**
 * Helper: Reserve inventory for order
 */
async function reserveInventory(subOrderId, lineItems) {
  // TODO: Create reservation records in database
  console.log(`[Edge Webhook] Reserved inventory for order ${subOrderId}`);
  return true;
}

/**
 * Helper: Calculate estimated fulfillment time
 */
function calculateEstimatedFulfillment(order) {
  const now = new Date();
  const requestedDate = new Date(order.requested_delivery_date);
  
  // If requested date is in future, use that
  if (requestedDate > now) {
    return requestedDate.toISOString().split('T')[0];
  }

  // Otherwise, estimate 2 days from now
  const estimate = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);
  return estimate.toISOString().split('T')[0];
}

/**
 * Helper: Notify Central API of order status change
 */
async function notifyCentralOrderStatus(subOrderId, status, details = {}) {
  try {
    const centralUrl = edgeConfig.getCentralApiUrl();
    const apiKey = edgeConfig.getApiKey();

    if (!centralUrl || !apiKey) {
      console.warn('[Edge Webhook] Central API not configured, cannot send notification');
      return;
    }

    const axios = await import('axios').then(m => m.default || m);

    await axios.post(
      `${centralUrl}/api/wholesale/orders/${subOrderId}/status`,
      {
        farm_id: edgeConfig.getFarmId(),
        status,
        timestamp: new Date().toISOString(),
        ...details
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      }
    );

    console.log(`[Edge Webhook] ✓ Notified Central: ${subOrderId} → ${status}`);

  } catch (error) {
    console.error('[Edge Webhook] ✗ Failed to notify Central:', error.message);
    // Don't throw - notification failure shouldn't break local processing
  }
}

export default router;
