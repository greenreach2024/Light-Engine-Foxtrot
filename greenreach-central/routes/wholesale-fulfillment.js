/**
 * Wholesale Farm-Side Fulfillment Routes
 * Consolidated fulfillment surface — all farm-side order operations.
 * Used by farm-admin.js wholesale operations section.
 *
 * Endpoints mounted at /api/wholesale/:
 *   POST /order-statuses         - Bulk update order statuses (webhook auth)
 *   POST /tracking-numbers       - Add tracking numbers to orders (webhook auth)
 *   POST /order-tracking         - Add tracking event (webhook auth)
 *   GET  /order-events           - List order events for this farm
 *   GET  /farm-performance/alerts - Farm performance alerts
 *   GET  /orders/pending-verification/:farmId - Orders needing verification
 *   POST /orders/farm-verify     - Farm verifies an order (webhook auth)
 *   POST /orders/:orderId/verify - Verify specific order (webhook auth)
 *   GET  /orders/pending         - Pending orders for farm
 *   POST /orders/:orderId/fulfill      - Farm fulfill callback (API key auth)
 *   POST /orders/:orderId/cancel-by-farm - Farm cancel callback (API key auth)
 *   POST /order-status           - Farm status callback (API key auth)
 */
import { Router } from 'express';
import express from 'express';
import { query, isDatabaseAvailable } from '../config/database.js';
import { verifyWebhookSignature } from '../middleware/webhook-signature.js';
import { requireFarmApiKey } from '../middleware/farmApiKeyAuth.js';
import {
  getOrderById,
  saveOrder,
  logOrderEvent
} from '../services/wholesaleMemoryStore.js';
import {
  isValidOrderTransition,
  transitionFulfillmentStatus,
  promoteOrderStatus
} from '../services/orderStateMachine.js';

const router = Router();

// POST /order-statuses — Bulk status update
router.post('/order-statuses', verifyWebhookSignature, async (req, res) => {
  try {
    const { updates } = req.body; // [{order_id, status}]
    if (!Array.isArray(updates)) {
      return res.status(400).json({ success: false, error: 'updates array required' });
    }

    const results = [];
    if (await isDatabaseAvailable()) {
      for (const { order_id, status } of updates) {
        try {
          // Validate transition if current status is known
          const current = await query(`SELECT status FROM wholesale_orders WHERE id = $1`, [order_id]);
          if (current.rows.length && !isValidOrderTransition(current.rows[0].status, status)) {
            results.push({ order_id, status, updated: false, reason: `invalid transition: ${current.rows[0].status} -> ${status}` });
            continue;
          }
          await query(
            `UPDATE wholesale_orders SET status = $1, updated_at = NOW() WHERE id = $2`,
            [status, order_id]
          );
          // Keep in-memory order object in sync with DB column
          const memOrder = await getOrderById(order_id, { includeArchived: true });
          if (memOrder) {
            memOrder.status = status;
            memOrder.status_updated_at = new Date().toISOString();
            await saveOrder(memOrder).catch(() => {});
          }
          results.push({ order_id, status, updated: true });
        } catch {
          results.push({ order_id, status, updated: false });
        }
      }
    } else {
      updates.forEach(u => results.push({ ...u, updated: true, note: 'in-memory' }));
    }

    res.json({ success: true, results, updated: results.filter(r => r.updated).length });
  } catch (error) {
    console.error('[Wholesale] Order statuses error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /tracking-numbers — Add tracking info
router.post('/tracking-numbers', verifyWebhookSignature, async (req, res) => {
  try {
    const { updates } = req.body; // [{order_id, tracking_number, carrier}]
    if (!Array.isArray(updates)) {
      return res.status(400).json({ success: false, error: 'updates array required' });
    }

    if (await isDatabaseAvailable()) {
      for (const { order_id, tracking_number, carrier } of updates) {
        try {
          // Validate shipped transition
          const current = await query(`SELECT status FROM wholesale_orders WHERE id = $1`, [order_id]);
          if (current.rows.length && !isValidOrderTransition(current.rows[0].status, 'shipped')) {
            console.warn(`[Wholesale] Skipping shipped transition for ${order_id}: current status ${current.rows[0].status}`);
            continue;
          }
          await query(
            `UPDATE wholesale_orders SET 
               tracking_number = $1, carrier = $2, status = 'shipped', updated_at = NOW()
             WHERE id = $3`,
            [tracking_number, carrier || 'unknown', order_id]
          );
          // Keep in-memory order object in sync with DB column
          const memOrder = await getOrderById(order_id, { includeArchived: true });
          if (memOrder) {
            memOrder.status = 'shipped';
            memOrder.tracking_number = tracking_number;
            memOrder.tracking_carrier = carrier || 'unknown';
            memOrder.status_updated_at = new Date().toISOString();
            await saveOrder(memOrder).catch(() => {});
          }
        } catch (e) {
          console.warn(`[Wholesale] Tracking update failed for ${order_id}:`, e.message);
        }
      }
    }
    res.json({ success: true, updated: updates.length });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /order-tracking — Add a tracking event
router.post('/order-tracking', verifyWebhookSignature, async (req, res) => {
  try {
    const { order_id, event, location, timestamp, notes } = req.body;
    const recordedAt = timestamp || new Date().toISOString();

    if (await isDatabaseAvailable()) {
      await query(
        `INSERT INTO tracking_events (order_id, event, location, notes, recorded_at) VALUES ($1, $2, $3, $4, $5)`,
        [order_id, event, location || null, notes || null, recordedAt]
      );
    }

    console.log(`[Wholesale] Tracking event: order=${order_id} event=${event} location=${location}`);
    res.json({
      success: true,
      event: {
        order_id, event, location,
        timestamp: recordedAt,
        recorded: true,
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /order-events — Farm order event log
router.get('/order-events', async (req, res) => {
  try {
    const farmId = req.farmId || req.query.farm_id;
    let events = [];

    if (await isDatabaseAvailable()) {
      try {
        const result = await query(
          `SELECT id, master_order_id, farm_id, status, buyer_email, delivery_date, total_amount, order_data, created_at, updated_at
           FROM wholesale_orders
           WHERE ($1::text IS NULL OR farm_id = $1)
           ORDER BY updated_at DESC LIMIT 50`,
          [farmId]
        );
        events = result.rows.map(o => {
          const data = o.order_data || {};
          const subOrder = (data.farm_sub_orders || []).find(s => s.farm_id === farmId) || {};
          return {
            order_id: o.master_order_id || String(o.id),
            farm_id: o.farm_id,
            event: o.status,
            buyer: o.buyer_email || data.buyer_account?.businessName || '',
            deliveryDate: o.delivery_date || data.delivery_date,
            amount: o.total_amount,
            total_amount: o.total_amount,
            items: subOrder.items || data.farm_sub_orders?.[0]?.items || [],
            timestamp: o.updated_at || o.created_at,
          };
        });
      } catch {
        // wholesale_orders table may not exist
      }
    }

    res.json({ success: true, events, total: events.length });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /farm-performance/alerts — Performance alerts for farm
router.get('/farm-performance/alerts', async (req, res) => {
  res.json({
    success: true,
    alerts: [],
    total: 0,
    message: 'No performance alerts',
  });
});

// GET /orders/pending-verification/:farmId
router.get('/orders/pending-verification/:farmId', async (req, res) => {
  try {
    const { farmId } = req.params;
    let orders = [];
    if (await isDatabaseAvailable()) {
      try {
        const result = await query(
          `SELECT id, status, buyer_email, delivery_date, total_amount, created_at
           FROM wholesale_orders WHERE farm_id = $1 AND status = 'pending'
           ORDER BY created_at DESC`,
          [farmId]
        );
        orders = result.rows;
      } catch { /* table may not exist */ }
    }
    res.json({ success: true, orders, total: orders.length });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /orders/farm-verify — Verify an order (farm side)
router.post('/orders/farm-verify', verifyWebhookSignature, async (req, res) => {
  try {
    const { order_id, verified, notes } = req.body;
    const targetStatus = verified ? 'confirmed' : 'rejected';
    if (await isDatabaseAvailable()) {
      try {
        const current = await query(`SELECT status FROM wholesale_orders WHERE id = $1`, [order_id]);
        if (current.rows.length && !isValidOrderTransition(current.rows[0].status, targetStatus)) {
          return res.status(409).json({ success: false, error: `Invalid transition: ${current.rows[0].status} → ${targetStatus}` });
        }
        await query(
          `UPDATE wholesale_orders SET status = $1, updated_at = NOW() WHERE id = $2`,
          [targetStatus, order_id]
        );
      } catch { /* table may not exist */ }
    }
    res.json({ success: true, order_id, verified, notes });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /orders/:orderId/verify — Verify specific order
router.post('/orders/:orderId/verify', verifyWebhookSignature, async (req, res) => {
  try {
    const { orderId } = req.params;
    const { verified = true, notes } = req.body;
    const targetStatus = verified ? 'confirmed' : 'rejected';
    if (await isDatabaseAvailable()) {
      try {
        const current = await query(`SELECT status FROM wholesale_orders WHERE id = $1`, [orderId]);
        if (current.rows.length && !isValidOrderTransition(current.rows[0].status, targetStatus)) {
          return res.status(409).json({ success: false, error: `Invalid transition: ${current.rows[0].status} → ${targetStatus}` });
        }
        await query(
          `UPDATE wholesale_orders SET status = $1, updated_at = NOW() WHERE id = $2`,
          [targetStatus, orderId]
        );
      } catch { /* table may not exist */ }
    }
    res.json({ success: true, orderId, verified, notes });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /orders/pending — Pending orders for farm
router.get('/orders/pending', async (req, res) => {
  try {
    const farmId = req.farmId || req.query.farm_id;
    let orders = [];
    if (await isDatabaseAvailable()) {
      try {
        const result = await query(
          `SELECT id, status, buyer_email, delivery_date, total_amount, created_at
           FROM wholesale_orders WHERE ($1::text IS NULL OR farm_id = $1) AND status IN ('pending', 'new')
           ORDER BY created_at DESC`,
          [farmId]
        );
        orders = result.rows;
      } catch { /* table may not exist */ }
    }
    res.json({ success: true, orders, total: orders.length });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ── Farm callback endpoints (moved from wholesale.js for consolidation) ──

/**
 * POST /api/wholesale/orders/:orderId/fulfill
 * Farm callback endpoint to mark order fulfilled.
 */
router.post('/orders/:orderId/fulfill', requireFarmApiKey, express.json(), async (req, res) => {
  try {
    const { orderId } = req.params;
    const farmId = req.farmAuth?.farm_id || req.body?.farmId || req.body?.farm_id;
    const order = await getOrderById(orderId, { includeArchived: true });

    if (!order) {
      return res.status(404).json({ status: 'error', message: 'Order not found' });
    }

    const previousStatus = order.fulfillment_status || 'pending';
    try {
      transitionFulfillmentStatus(order, 'fulfilled');
    } catch (err) {
      return res.status(409).json({ status: 'error', message: err.message });
    }

    // Auto-promote buyer-facing order status to stay in sync
    promoteOrderStatus(order);

    order.fulfilled_at = req.body?.fulfilledAt || new Date().toISOString();
    order.tracking_number = req.body?.trackingNumber || order.tracking_number || null;
    order.tracking_carrier = req.body?.carrier || order.tracking_carrier || null;

    await saveOrder(order).catch(() => {});
    logOrderEvent(orderId, 'status_changed', {
      from: previousStatus,
      to: 'fulfilled',
      farm_id: farmId,
      tracking_number: order.tracking_number,
      tracking_carrier: order.tracking_carrier
    });

    return res.json({ status: 'ok', order_id: orderId, new_status: 'fulfilled' });
  } catch (error) {
    console.error('[wholesale] fulfill callback failed:', error);
    return res.status(500).json({ status: 'error', message: 'Failed to process fulfillment callback' });
  }
});

/**
 * POST /api/wholesale/orders/:orderId/cancel-by-farm
 * Farm callback endpoint to mark order canceled.
 */
router.post('/orders/:orderId/cancel-by-farm', requireFarmApiKey, express.json(), async (req, res) => {
  try {
    const { orderId } = req.params;
    const farmId = req.farmAuth?.farm_id || req.body?.farmId || req.body?.farm_id;
    const reason = req.body?.reason || 'farm_canceled';
    const order = await getOrderById(orderId, { includeArchived: true });

    if (!order) {
      return res.status(404).json({ status: 'error', message: 'Order not found' });
    }

    const previousStatus = order.fulfillment_status || 'pending';
    try {
      transitionFulfillmentStatus(order, 'cancelled');
    } catch (err) {
      return res.status(409).json({ status: 'error', message: err.message });
    }

    // Auto-promote buyer-facing order status to stay in sync
    promoteOrderStatus(order);

    order.canceled_at = req.body?.canceledAt || new Date().toISOString();
    order.cancel_reason = reason;

    await saveOrder(order).catch(() => {});
    logOrderEvent(orderId, 'status_changed', {
      from: previousStatus,
      to: 'cancelled',
      farm_id: farmId,
      reason
    });

    return res.json({ status: 'ok', order_id: orderId, new_status: 'cancelled' });
  } catch (error) {
    console.error('[wholesale] cancel-by-farm callback failed:', error);
    return res.status(500).json({ status: 'error', message: 'Failed to process cancellation callback' });
  }
});

/**
 * POST /api/wholesale/order-status
 * Receive order status updates from farms (callback endpoint)
 */
router.post('/order-status', requireFarmApiKey, async (req, res) => {
  try {
    const { order_id, status, farm_id, timestamp } = req.body;

    if (!order_id || !status) {
      return res.status(400).json({
        status: 'error',
        message: 'Missing required fields: order_id, status'
      });
    }

    console.log(`[Status Callback] Received from farm ${farm_id}: Order ${order_id} → ${status}`);

    const order = await getOrderById(order_id, { includeArchived: true });

    if (order) {
      const previousStatus = order.fulfillment_status || 'unknown';

      try {
        transitionFulfillmentStatus(order, status);
      } catch (err) {
        return res.status(409).json({
          status: 'error',
          message: err.message,
          order_id,
          current_status: previousStatus,
          requested_status: status
        });
      }

      // Auto-promote buyer-facing order status to stay in sync
      promoteOrderStatus(order);

      order.status_updated_at = timestamp || new Date().toISOString();

      await saveOrder(order).catch(() => {});
      logOrderEvent(order_id, 'status_changed', { from: previousStatus, to: status, farm_id });

      console.log(`Updated order ${order_id} status to ${status}`);

      return res.json({
        status: 'ok',
        message: 'Order status updated',
        order_id: order.master_order_id,
        new_status: order.fulfillment_status
      });
    } else {
      console.warn(`Order ${order_id} not found in Central registry`);
      return res.status(404).json({
        status: 'error',
        message: 'Order not found'
      });
    }
  } catch (error) {
    console.error('[Status Callback] Error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Failed to process status update'
    });
  }
});

export default router;
