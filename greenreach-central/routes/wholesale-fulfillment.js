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
import emailService from '../services/email-service.js';

const router = Router();

// Overlay stores used by farm-admin UI for status/tracking persistence.
// They keep behavior stable even when DB rows do not map 1:1 to sub-order IDs.
const uiOrderStatuses = new Map();
const uiTrackingNumbers = new Map();

function normalizeStatusUpdates(body = {}) {
  if (Array.isArray(body?.updates)) {
    return body.updates
      .filter(u => u && u.order_id && typeof u.status === 'string')
      .map(u => ({ order_id: String(u.order_id), status: String(u.status) }));
  }

  if (body && typeof body === 'object' && !Array.isArray(body)) {
    return Object.entries(body)
      .filter(([order_id, status]) => order_id && typeof status === 'string')
      .map(([order_id, status]) => ({ order_id: String(order_id), status: String(status) }));
  }

  return [];
}

function normalizeTrackingUpdates(body = {}) {
  if (Array.isArray(body?.updates)) {
    return body.updates
      .filter(u => u && u.order_id && (u.tracking_number || typeof u.tracking_number === 'string'))
      .map(u => ({
        order_id: String(u.order_id),
        tracking_number: String(u.tracking_number || '').trim(),
        carrier: String(u.carrier || 'unknown')
      }))
      .filter(u => u.tracking_number);
  }

  if (body && typeof body === 'object' && !Array.isArray(body)) {
    return Object.entries(body)
      .map(([order_id, value]) => {
        if (!order_id) return null;
        if (typeof value === 'string') {
          return { order_id: String(order_id), tracking_number: value.trim(), carrier: 'unknown' };
        }
        if (value && typeof value === 'object') {
          return {
            order_id: String(order_id),
            tracking_number: String(value.tracking_number || '').trim(),
            carrier: String(value.carrier || 'unknown')
          };
        }
        return null;
      })
      .filter(u => u && u.tracking_number);
  }

  return [];
}

// POST /order-statuses — Bulk status update
router.post('/order-statuses', async (req, res) => {
  try {
    const updates = normalizeStatusUpdates(req.body); // [{order_id, status}] or {order_id: status}
    if (!updates.length) {
      return res.status(400).json({ success: false, error: 'updates array required' });
    }

    const results = [];
    if (await isDatabaseAvailable()) {
      for (const { order_id, status } of updates) {
        try {
          // Validate transition if current status is known.
          // Accept both DB id and master_order_id for compatibility.
          const current = await query(
            `SELECT status FROM wholesale_orders WHERE id::text = $1 OR master_order_id = $1 LIMIT 1`,
            [order_id]
          );
          if (current.rows.length && !isValidOrderTransition(current.rows[0].status, status)) {
            results.push({ order_id, status, updated: false, reason: `invalid transition: ${current.rows[0].status} -> ${status}` });
            uiOrderStatuses.set(order_id, status);
            continue;
          }
          await query(
            `UPDATE wholesale_orders SET status = $1, updated_at = NOW() WHERE id::text = $2 OR master_order_id = $2`,
            [status, order_id]
          );
          // Keep in-memory order object in sync with DB column
          const memOrder = await getOrderById(order_id, { includeArchived: true });
          if (memOrder) {
            memOrder.status = status;
            memOrder.status_updated_at = new Date().toISOString();
            await saveOrder(memOrder).catch(() => {});
          }
          uiOrderStatuses.set(order_id, status);
          results.push({ order_id, status, updated: true });
        } catch {
          uiOrderStatuses.set(order_id, status);
          results.push({ order_id, status, updated: false });
        }
      }
    } else {
      updates.forEach(u => {
        uiOrderStatuses.set(u.order_id, u.status);
        results.push({ ...u, updated: true, note: 'in-memory' });
      });
    }

    res.json({ success: true, results, updated: results.filter(r => r.updated).length });
  } catch (error) {
    console.error('[Wholesale] Order statuses error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /order-statuses — Farm admin status overlay
router.get('/order-statuses', async (req, res) => {
  try {
    const farmId = req.farmId || req.query.farm_id;
    const statuses = Object.fromEntries(uiOrderStatuses.entries());

    if (await isDatabaseAvailable()) {
      try {
        const result = await query(
          `SELECT id, master_order_id, farm_id, status, order_data
           FROM wholesale_orders
           ORDER BY updated_at DESC LIMIT 250`
        );

        result.rows.forEach(row => {
          const data = row.order_data || {};
          const subOrders = Array.isArray(data.farm_sub_orders) ? data.farm_sub_orders : [];
          let matchedSubOrder = false;

          subOrders.forEach(sub => {
            if (!sub) return;
            if (farmId && sub.farm_id && String(sub.farm_id) !== String(farmId)) return;
            const key = sub.sub_order_id || sub.id;
            if (!key) return;
            statuses[String(key)] = sub.status || row.status || statuses[String(key)] || 'pending_verification';
            matchedSubOrder = true;
          });

          if (!matchedSubOrder && (!farmId || String(row.farm_id) === String(farmId))) {
            const key = row.master_order_id || String(row.id);
            if (key && !statuses[String(key)]) {
              statuses[String(key)] = row.status || 'pending';
            }
          }
        });
      } catch {
        // Table may not exist in some environments.
      }
    }

    res.json({ success: true, statuses });
  } catch (error) {
    console.error('[Wholesale] Order statuses fetch error:', error.message);
    res.status(500).json({ success: false, error: error.message, statuses: {} });
  }
});

// POST /tracking-numbers — Add tracking info
router.post('/tracking-numbers', async (req, res) => {
  try {
    const updates = normalizeTrackingUpdates(req.body); // [{order_id, tracking_number, carrier}] or {order_id: tracking_number}
    if (!updates.length) {
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
             WHERE id::text = $3 OR master_order_id = $3`,
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
          uiTrackingNumbers.set(order_id, tracking_number);
        } catch (e) {
          console.warn(`[Wholesale] Tracking update failed for ${order_id}:`, e.message);
          uiTrackingNumbers.set(order_id, tracking_number);
        }
      }
    } else {
      updates.forEach(({ order_id, tracking_number }) => {
        uiTrackingNumbers.set(order_id, tracking_number);
      });
    }
    res.json({ success: true, updated: updates.length });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /tracking-numbers — Farm admin tracking overlay
router.get('/tracking-numbers', async (req, res) => {
  try {
    const farmId = req.farmId || req.query.farm_id;
    const tracking = Object.fromEntries(uiTrackingNumbers.entries());

    if (await isDatabaseAvailable()) {
      try {
        const result = await query(
          `SELECT id, master_order_id, farm_id, order_data
           FROM wholesale_orders
           ORDER BY updated_at DESC LIMIT 250`
        );

        result.rows.forEach(row => {
          const data = row.order_data || {};
          const subOrders = Array.isArray(data.farm_sub_orders) ? data.farm_sub_orders : [];
          let matchedSubOrder = false;

          subOrders.forEach(sub => {
            if (!sub) return;
            if (farmId && sub.farm_id && String(sub.farm_id) !== String(farmId)) return;
            const key = sub.sub_order_id || sub.id;
            if (!key) return;
            if (sub.tracking_number) {
              tracking[String(key)] = String(sub.tracking_number);
            }
            matchedSubOrder = true;
          });

          if (!matchedSubOrder && (!farmId || String(row.farm_id) === String(farmId))) {
            const key = row.master_order_id || String(row.id);
            if (key && data.tracking_number && !tracking[String(key)]) {
              tracking[String(key)] = String(data.tracking_number);
            }
          }
        });
      } catch {
        // Table may not exist in some environments.
      }
    }

    res.json({ success: true, tracking });
  } catch (error) {
    console.error('[Wholesale] Tracking fetch error:', error.message);
    res.status(500).json({ success: false, error: error.message, tracking: {} });
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
           ORDER BY updated_at DESC LIMIT 200`
        );
        events = result.rows.map(o => {
          const data = o.order_data || {};
          const subOrders = Array.isArray(data.farm_sub_orders) ? data.farm_sub_orders : [];
          const subOrder = subOrders.find(s => farmId ? String(s?.farm_id) === String(farmId) : true) || subOrders[0] || {};
          if (farmId && !subOrder?.farm_id && String(o.farm_id || '') !== String(farmId)) {
            return null;
          }

          const effectiveStatus = subOrder.status || o.status || 'pending_verification';
          const subOrderId = subOrder.sub_order_id || subOrder.id || o.master_order_id || String(o.id);
          const buyer = data.buyer_account || {};
          const addr = data.delivery_address || {};
          const fm = String(data.fulfillment_method || 'delivery').toLowerCase();

          return {
            order_id: subOrderId,
            master_order_id: o.master_order_id || String(o.id),
            farm_id: subOrder.farm_id || o.farm_id,
            farm_name: subOrder.farm_name || '',
            event: effectiveStatus,
            status: effectiveStatus,
            buyer_name: buyer.businessName || buyer.business_name || buyer.contactName || buyer.contact_name || '',
            buyer_email: o.buyer_email || buyer.email || '',
            buyer_phone: buyer.phone || buyer.contactPhone || '',
            buyer_city: addr.city || buyer.city || '',
            buyer_state: addr.state || addr.province || buyer.state || '',
            delivery_date: o.delivery_date || data.delivery_date || null,
            delivery_address: addr.street
              ? `${addr.street}, ${addr.city || ''} ${addr.state || addr.province || ''} ${addr.zip || addr.postal_code || ''}`.trim()
              : '',
            fulfillment_method: fm,
            po_number: data.po_number || '',
            amount: subOrder.sub_total || subOrder.total_amount || o.total_amount,
            total_amount: subOrder.sub_total || subOrder.total_amount || o.total_amount,
            items: subOrder.items || data.farm_sub_orders?.[0]?.items || [],
            timestamp: o.updated_at || o.created_at,
            created_at: o.created_at,
            certifications_required: buyer.certifications_required || data.certifications_required || [],
            gap_certified: buyer.gap_certified || data.gap_certified || false,
            notes: data.notes || buyer.notes || '',
            notifications: data.notifications || [],
            tracking_number: subOrder.tracking_number || null,
            verification_deadline: subOrder.verification_deadline || data.verification_deadline || null
          };
        }).filter(Boolean);
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

      // Send buyer email notification on meaningful status transitions
      let notification = null;
      const notifyStatuses = ['confirmed', 'packed', 'shipped', 'delivered'];
      const buyerEmail = order.buyer_email || order.order_data?.buyer_account?.email || '';
      if (buyerEmail && notifyStatuses.includes(status)) {
        try {
          const buyerName = order.order_data?.buyer_account?.contactName
                         || order.order_data?.buyer_account?.businessName
                         || 'Valued Customer';
          const statusLabels = {
            confirmed: 'Confirmed',
            packed: 'Packed and Ready',
            shipped: 'Shipped',
            delivered: 'Delivered'
          };
          const deliveryDate = order.delivery_date || order.order_data?.delivery_date || '';
          const fulfillment = String(order.order_data?.fulfillment_method || 'delivery').toLowerCase();
          const addr = order.order_data?.delivery_address || {};
          const addrLine = addr.street
            ? `${addr.street}, ${addr.city || ''} ${addr.state || ''} ${addr.zip || ''}`
            : '';
          const poNum = order.order_data?.po_number || '';

          const subject = `Order ${order.master_order_id || order_id} - ${statusLabels[status] || status}`;
          const textLines = [
            `Hello ${buyerName},`,
            '',
            `Your order ${order.master_order_id || order_id} has been updated to: ${statusLabels[status] || status}.`,
          ];
          if (poNum) textLines.push(`PO Number: ${poNum}`);
          if (deliveryDate) textLines.push(`Scheduled ${fulfillment === 'pickup' ? 'Pickup' : 'Delivery'} Date: ${new Date(deliveryDate).toLocaleDateString()}`);
          if (addrLine && fulfillment !== 'pickup') textLines.push(`Delivery Address: ${addrLine}`);
          textLines.push('');
          if (status === 'packed') textLines.push('Your order has been packed and is ready for ' + (fulfillment === 'pickup' ? 'pickup.' : 'shipment.'));
          if (status === 'shipped') textLines.push('Your order is on its way!');
          if (status === 'delivered') textLines.push('Your order has been delivered. Thank you for your business!');
          textLines.push('', 'If you have questions, reply to this email or contact us directly.', '', '-- GreenReach Wholesale');

          const htmlBody = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #2d5016;">Order Update: ${statusLabels[status] || status}</h2>
              <p>Hello ${buyerName},</p>
              <p>Your order <strong>${order.master_order_id || order_id}</strong> has been updated to: <strong>${statusLabels[status] || status}</strong>.</p>
              ${poNum ? `<p><strong>PO Number:</strong> ${poNum}</p>` : ''}
              ${deliveryDate ? `<p><strong>Scheduled ${fulfillment === 'pickup' ? 'Pickup' : 'Delivery'}:</strong> ${new Date(deliveryDate).toLocaleDateString()}</p>` : ''}
              ${addrLine && fulfillment !== 'pickup' ? `<p><strong>Delivery Address:</strong> ${addrLine}</p>` : ''}
              ${status === 'packed' ? `<p>Your order has been packed and is ready for ${fulfillment === 'pickup' ? 'pickup' : 'shipment'}.</p>` : ''}
              ${status === 'shipped' ? '<p>Your order is on its way!</p>' : ''}
              ${status === 'delivered' ? '<p>Your order has been delivered. Thank you for your business!</p>' : ''}
              <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;" />
              <p style="color: #666; font-size: 0.9em;">If you have questions, reply to this email or contact us directly.</p>
              <p style="color: #666; font-size: 0.9em;">-- GreenReach Wholesale</p>
            </div>`;

          await emailService.sendEmail({
            to: buyerEmail,
            subject,
            text: textLines.join('\n'),
            html: htmlBody,
            farmId: farm_id || order.farm_id
          });

          notification = {
            sent_to: buyerEmail,
            sent_at: new Date().toISOString(),
            status_notified: status,
            subject
          };
          console.log(`[Buyer Notify] Email sent to ${buyerEmail} for order ${order_id} -> ${status}`);
        } catch (emailErr) {
          console.error(`[Buyer Notify] Failed to send email to ${buyerEmail}:`, emailErr.message);
          notification = { sent_to: buyerEmail, error: emailErr.message, sent_at: new Date().toISOString() };
        }
      }

      // Persist notification record on the order
      if (notification) {
        if (!order.notifications) order.notifications = [];
        order.notifications.push(notification);
        await saveOrder(order).catch(() => {});
      }

      return res.json({
        status: 'ok',
        message: 'Order status updated',
        order_id: order.master_order_id,
        new_status: order.fulfillment_status,
        notification
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
