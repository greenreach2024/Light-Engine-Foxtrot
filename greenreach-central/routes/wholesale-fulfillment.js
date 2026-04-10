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
import { query as dbQuery } from '../config/database.js';
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

// Skip webhook HMAC check if the request was already JWT-authenticated by
// authMiddleware (browser calls from LE-farm-admin.html).  Server-to-server
// calls that lack a Bearer token still go through verifyWebhookSignature.
const jwtOrWebhookAuth = (req, res, next) =>
  req.user ? next() : verifyWebhookSignature(req, res, next);

// Overlay stores used by farm-admin UI for status/tracking persistence.
// They keep behavior stable even when DB rows do not map 1:1 to sub-order IDs.
const uiOrderStatuses = new Map();
const uiTrackingNumbers = new Map();

function normalizeStatusUpdates(body = {}) {
  if (Array.isArray(body?.updates)) {
    return body.updates
      .filter(u => u && u.order_id && typeof u.status === 'string')
      .map(u => ({
        order_id: String(u.order_id),
        sub_order_id: u.sub_order_id ? String(u.sub_order_id) : null,
        status: String(u.status),
        farm_id: u.farm_id ? String(u.farm_id) : null,
        timestamp: u.timestamp ? String(u.timestamp) : null,
        notify_buyer: u.notify_buyer !== false
      }));
  }

  if (body && typeof body === 'object' && !Array.isArray(body)) {
    return Object.entries(body)
      .map(([order_id, value]) => {
        if (!order_id) return null;
        if (typeof value === 'string') {
          return {
            order_id: String(order_id),
            status: String(value),
            farm_id: null,
            timestamp: null,
            notify_buyer: true
          };
        }
        if (value && typeof value === 'object' && typeof value.status === 'string') {
          return {
            order_id: String(order_id),
            status: String(value.status),
            farm_id: value.farm_id ? String(value.farm_id) : null,
            timestamp: value.timestamp ? String(value.timestamp) : null,
            notify_buyer: value.notify_buyer !== false
          };
        }
        return null;
      })
      .filter(Boolean);
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

function normalizeQueueStatus(rawStatus) {
  const status = String(rawStatus || '').trim().toLowerCase();
  if (!status) return 'pending_verification';

  if ([
    'pending',
    'pending_verification',
    'pending_farm_verification',
    'pending_payment',
    'payment_authorized',
    'created',
    'new',
    'awaiting_farm_verification',
    'awaiting_acceptance',
    'awaiting_verification'
  ].includes(status)) {
    return 'pending_verification';
  }

  if (['confirmed', 'processing', 'farm_accepted', 'accepted', 'farms_verified'].includes(status)) {
    return 'confirmed';
  }

  if (['packed', 'ready_for_pickup'].includes(status)) {
    return 'packed';
  }

  if (['shipped', 'fulfilled'].includes(status)) {
    return 'shipped';
  }

  if (['delivered', 'completed', 'picked_up'].includes(status)) {
    return 'delivered';
  }

  if (['cancelled', 'canceled', 'rejected', 'declined', 'farm_declined', 'payment_failed', 'expired'].includes(status)) {
    return 'expired';
  }

  // Fuzzy fallback for status variants coming from mixed parent/sub-order flows.
  if (status.includes('pending') || status.includes('awaiting')) return 'pending_verification';
  if (status.includes('accept') || status.includes('confirm')) return 'confirmed';
  if (status.includes('pack')) return 'packed';
  if (status.includes('ship') || status.includes('fulfill')) return 'shipped';
  if (status.includes('deliver') || status.includes('pickup')) return 'delivered';
  if (status.includes('cancel') || status.includes('reject') || status.includes('decline')) return 'expired';

  return status;
}

function findMatchingSubOrder(orderData = {}, orderId) {
  const target = String(orderId || '').trim();
  if (!target) return null;
  const subOrders = Array.isArray(orderData.farm_sub_orders) ? orderData.farm_sub_orders : [];
  return subOrders.find(sub => {
    if (!sub) return false;
    return [sub.sub_order_id, sub.id, sub.order_id]
      .filter(Boolean)
      .map(value => String(value))
      .includes(target);
  }) || null;
}

function formatAddressLine(address = {}) {
  const street = address.street || address.address1 || '';
  const city = address.city || '';
  const state = address.state || address.province || '';
  const zip = address.zip || address.postalCode || address.postal_code || '';
  const cityLine = [city, state, zip].filter(Boolean).join(' ');
  return [street, cityLine].filter(Boolean).join(', ');
}

function resolveBuyerName(orderData = {}, buyerEmail = '') {
  const buyer = orderData.buyer_account || {};
  const preferred = [
    buyer.businessName,
    buyer.business_name,
    buyer.name,
    buyer.contactName,
    buyer.contact_name,
    orderData.buyer_name,
    orderData.buyer_business_name,
    orderData.customer_name
  ].find(value => typeof value === 'string' && value.trim());
  if (preferred) return preferred.trim();
  return buyerEmail ? String(buyerEmail).split('@')[0] : 'Valued Customer';
}

function resolveStatusLabel(status, fulfillmentMethod = 'delivery') {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'confirmed') return 'Confirmed';
  if (normalized === 'packed') {
    return String(fulfillmentMethod || '').toLowerCase() === 'pickup'
      ? 'Ready for Pickup'
      : 'Packed and Ready';
  }
  if (normalized === 'ready_for_pickup') return 'Ready for Pickup';
  if (normalized === 'shipped') return 'Shipped';
  if (normalized === 'delivered') return 'Delivered';
  return normalized || 'Updated';
}

function shouldNotifyBuyerForStatus(status) {
  const normalized = String(status || '').toLowerCase();
  return ['confirmed', 'packed', 'ready_for_pickup', 'shipped', 'delivered'].includes(normalized);
}

function appendOrderNotification(orderData, notification) {
  if (!notification || !orderData || typeof orderData !== 'object') return;
  if (!Array.isArray(orderData.notifications)) orderData.notifications = [];
  orderData.notifications.push(notification);
  if (orderData.notifications.length > 40) {
    orderData.notifications = orderData.notifications.slice(-40);
  }
}

async function sendBuyerStatusNotification({ orderRecord, status, farmId, orderId }) {
  const normalizedStatus = String(status || '').toLowerCase();
  if (!shouldNotifyBuyerForStatus(normalizedStatus)) return null;

  const data = orderRecord?.order_data || orderRecord || {};
  const buyer = data.buyer_account || {};
  const buyerEmail = orderRecord?.buyer_email || buyer.email || '';
  if (!buyerEmail) return null;

  const fulfillment = String(data.fulfillment_method || orderRecord?.fulfillment_method || 'delivery').toLowerCase();
  const buyerName = resolveBuyerName(data, buyerEmail);
  const statusLabel = resolveStatusLabel(normalizedStatus, fulfillment);
  const deliveryDate = orderRecord?.delivery_date || data.delivery_date || '';
  const preferredWindow = data.preferred_delivery_window || data.time_slot || '';
  const pickupSchedule = data.pickup_schedule || '';
  const deliverySchedule = data.delivery_schedule || '';
  const addressLine = formatAddressLine(data.delivery_address || {});
  const poNum = data.po_number || '';
  const subjectOrderId = orderRecord?.master_order_id || data.master_order_id || orderId;
  const subject = `Order ${subjectOrderId} - ${statusLabel}`;

  const textLines = [
    `Hello ${buyerName},`,
    '',
    `Your order ${subjectOrderId} has been updated to: ${statusLabel}.`
  ];
  if (poNum) textLines.push(`PO Number: ${poNum}`);
  if (deliveryDate) textLines.push(`Scheduled ${fulfillment === 'pickup' ? 'Pickup' : 'Delivery'} Date: ${new Date(deliveryDate).toLocaleDateString()}`);
  if (preferredWindow) textLines.push(`Preferred ${fulfillment === 'pickup' ? 'Pickup' : 'Delivery'} Window: ${preferredWindow}`);
  if (pickupSchedule && fulfillment === 'pickup') textLines.push(`Pickup Schedule: ${pickupSchedule}`);
  if (deliverySchedule && fulfillment !== 'pickup') textLines.push(`Delivery Schedule: ${deliverySchedule}`);
  if (addressLine && fulfillment !== 'pickup') textLines.push(`Delivery Address: ${addressLine}`);
  textLines.push('');
  if (normalizedStatus === 'packed' || normalizedStatus === 'ready_for_pickup') {
    textLines.push(
      fulfillment === 'pickup'
        ? 'Your order is packed and ready for pickup.'
        : 'Your order has been packed and is ready for shipment.'
    );
  }
  if (normalizedStatus === 'shipped') textLines.push('Your order is on its way.');
  if (normalizedStatus === 'delivered') textLines.push('Your order has been delivered. Thank you for your business.');
  textLines.push('', 'If you have questions, reply to this email or contact us directly.', '', '-- GreenReach Wholesale');

  const htmlBody = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #2d5016;">Order Update: ${statusLabel}</h2>
      <p>Hello ${buyerName},</p>
      <p>Your order <strong>${subjectOrderId}</strong> has been updated to: <strong>${statusLabel}</strong>.</p>
      ${poNum ? `<p><strong>PO Number:</strong> ${poNum}</p>` : ''}
      ${deliveryDate ? `<p><strong>Scheduled ${fulfillment === 'pickup' ? 'Pickup' : 'Delivery'}:</strong> ${new Date(deliveryDate).toLocaleDateString()}</p>` : ''}
      ${preferredWindow ? `<p><strong>Preferred ${fulfillment === 'pickup' ? 'Pickup' : 'Delivery'} Window:</strong> ${preferredWindow}</p>` : ''}
      ${pickupSchedule && fulfillment === 'pickup' ? `<p><strong>Pickup Schedule:</strong> ${pickupSchedule}</p>` : ''}
      ${deliverySchedule && fulfillment !== 'pickup' ? `<p><strong>Delivery Schedule:</strong> ${deliverySchedule}</p>` : ''}
      ${addressLine && fulfillment !== 'pickup' ? `<p><strong>Delivery Address:</strong> ${addressLine}</p>` : ''}
      ${(normalizedStatus === 'packed' || normalizedStatus === 'ready_for_pickup')
        ? `<p>${fulfillment === 'pickup' ? 'Your order is packed and ready for pickup.' : 'Your order has been packed and is ready for shipment.'}</p>`
        : ''}
      ${normalizedStatus === 'shipped' ? '<p>Your order is on its way.</p>' : ''}
      ${normalizedStatus === 'delivered' ? '<p>Your order has been delivered. Thank you for your business.</p>' : ''}
      <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;" />
      <p style="color: #666; font-size: 0.9em;">If you have questions, reply to this email or contact us directly.</p>
      <p style="color: #666; font-size: 0.9em;">-- GreenReach Wholesale</p>
    </div>`;

  try {
    await emailService.sendEmail({
      to: buyerEmail,
      subject,
      text: textLines.join('\n'),
      html: htmlBody,
      farmId: farmId || orderRecord?.farm_id || null
    });

    return {
      sent_to: buyerEmail,
      sent_at: new Date().toISOString(),
      status_notified: normalizedStatus,
      subject
    };
  } catch (emailErr) {
    console.error(`[Buyer Notify] Failed to send email to ${buyerEmail}:`, emailErr.message);
    return {
      sent_to: buyerEmail,
      sent_at: new Date().toISOString(),
      status_notified: normalizedStatus,
      subject,
      error: emailErr.message
    };
  }
}

async function findWholesaleOrderRecord(orderId) {
  const direct = await query(
    `SELECT id, master_order_id, farm_id, status, buyer_email, delivery_date, order_data, created_at, updated_at
     FROM wholesale_orders
     WHERE id::text = $1 OR master_order_id = $1
     ORDER BY updated_at DESC
     LIMIT 1`,
    [orderId]
  );
  if (direct.rows[0]) return direct.rows[0];

  const fuzzy = await query(
    `SELECT id, master_order_id, farm_id, status, buyer_email, delivery_date, order_data, created_at, updated_at
     FROM wholesale_orders
     WHERE order_data::text ILIKE $1
     ORDER BY updated_at DESC
     LIMIT 1`,
    [`%${orderId}%`]
  );
  return fuzzy.rows[0] || null;
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
      for (const update of updates) {
        const orderId = String(update.order_id);
        const nextStatus = normalizeQueueStatus(update.status);

        try {
          const dbOrder = await findWholesaleOrderRecord(orderId);

          if (!dbOrder) {
            await query(
              `UPDATE wholesale_orders SET status = $1, updated_at = NOW() WHERE id::text = $2 OR master_order_id = $2`,
              [nextStatus, orderId]
            ).catch(() => {});
            uiOrderStatuses.set(orderId, nextStatus);
            results.push({ order_id: orderId, status: nextStatus, updated: true, reason: 'overlay_only' });
            continue;
          }

          const orderData = dbOrder.order_data || {};
          let subOrder = findMatchingSubOrder(orderData, orderId);
          // If no sub-order matched by order_id (e.g. order_id is the master),
          // try matching by sub_order_id or farm_id from the update payload.
          if (!subOrder && Array.isArray(orderData.farm_sub_orders)) {
            if (update.sub_order_id) {
              subOrder = findMatchingSubOrder(orderData, String(update.sub_order_id));
            }
            if (!subOrder && update.farm_id) {
              subOrder = orderData.farm_sub_orders.find(s => s && String(s.farm_id) === String(update.farm_id)) || null;
            }
          }
          const currentStatus = normalizeQueueStatus(subOrder?.status || dbOrder.status || orderData.status || '');

          if (currentStatus && currentStatus !== nextStatus && !isValidOrderTransition(currentStatus, nextStatus)) {
            uiOrderStatuses.set(orderId, nextStatus);
            results.push({
              order_id: orderId,
              status: nextStatus,
              updated: false,
              reason: `invalid transition: ${currentStatus} -> ${nextStatus}`
            });
            continue;
          }

          if (subOrder) {
            subOrder.status = nextStatus;
            if (update.timestamp) {
              subOrder.status_updated_at = update.timestamp;
            }
          }
          orderData.status = nextStatus;
          orderData.status_updated_at = update.timestamp || new Date().toISOString();

          let notification = null;
          const shouldNotify = update.notify_buyer !== false
            && shouldNotifyBuyerForStatus(nextStatus)
            && currentStatus !== nextStatus;
          if (shouldNotify) {
            notification = await sendBuyerStatusNotification({
              orderRecord: { ...dbOrder, order_data: orderData },
              status: nextStatus,
              farmId: update.farm_id || dbOrder.farm_id,
              orderId
            });
            appendOrderNotification(orderData, notification);
          }

          await query(
            `UPDATE wholesale_orders
                SET status = $1,
                    order_data = $2::jsonb,
                    updated_at = NOW()
              WHERE id = $3`,
            [nextStatus, JSON.stringify(orderData), dbOrder.id]
          );

          const memOrderKey = dbOrder.master_order_id || orderId;
          const memOrder = await getOrderById(memOrderKey, { includeArchived: true });
          if (memOrder) {
            memOrder.status = nextStatus;
            memOrder.status_updated_at = orderData.status_updated_at;

            if (subOrder && Array.isArray(memOrder.farm_sub_orders)) {
              const memSub = findMatchingSubOrder(memOrder, orderId);
              if (memSub) {
                memSub.status = nextStatus;
                if (update.timestamp) memSub.status_updated_at = update.timestamp;
              }
            }

            if (Array.isArray(orderData.notifications)) {
              memOrder.notifications = orderData.notifications;
            }
            await saveOrder(memOrder).catch(() => {});
          }

          uiOrderStatuses.set(orderId, nextStatus);
          if (dbOrder.master_order_id) uiOrderStatuses.set(String(dbOrder.master_order_id), nextStatus);
          if (subOrder?.sub_order_id) uiOrderStatuses.set(String(subOrder.sub_order_id), nextStatus);
          if (subOrder?.id) uiOrderStatuses.set(String(subOrder.id), nextStatus);

          results.push({
            order_id: orderId,
            status: nextStatus,
            updated: true,
            notification
          });
        } catch (err) {
          uiOrderStatuses.set(orderId, nextStatus);
          results.push({ order_id: orderId, status: nextStatus, updated: false, reason: err.message });
        }
      }
    } else {
      updates.forEach(u => {
        const normalized = normalizeQueueStatus(u.status);
        uiOrderStatuses.set(u.order_id, normalized);
        results.push({ ...u, status: normalized, updated: true, note: 'in-memory' });
      });
    }

    res.json({
      success: true,
      results,
      updated: results.filter(r => r.updated).length,
      notifications_sent: results.filter(r => r.notification && !r.notification.error).length
    });
  } catch (error) {
    console.error('[Wholesale] Order statuses error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /order-statuses — Farm admin status overlay
router.get('/order-statuses', async (req, res) => {
  try {
    const farmId = req.farmId || req.query.farm_id;
    const statuses = Object.fromEntries(
      Array.from(uiOrderStatuses.entries()).map(([orderId, status]) => [orderId, normalizeQueueStatus(status)])
    );

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
            const key = sub.sub_order_id || sub.id || row.master_order_id || String(row.id);
            if (!key) return;
            statuses[String(key)] = normalizeQueueStatus(
              sub.status || row.status || statuses[String(key)] || 'pending_verification'
            );
            matchedSubOrder = true;
          });

          if (!matchedSubOrder && (!farmId || String(row.farm_id) === String(farmId))) {
            const key = row.master_order_id || String(row.id);
            if (key && !statuses[String(key)]) {
              statuses[String(key)] = normalizeQueueStatus(row.status || 'pending_verification');
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
            const key = sub.sub_order_id || sub.id || row.master_order_id || String(row.id);
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
          const subOrder = farmId
            ? (subOrders.find(s => String(s?.farm_id) === String(farmId)) || null)
            : (subOrders[0] || null);

          if (farmId && !subOrder && String(o.farm_id || '') !== String(farmId)) {
            return null;
          }

          const effectiveStatus = normalizeQueueStatus(subOrder?.status || o.status || 'pending_verification');
          const subOrderId = subOrder?.sub_order_id || subOrder?.id || o.master_order_id || String(o.id);
          const buyer = data.buyer_account || {};
          const addr = data.delivery_address || {};
          const fm = String(data.fulfillment_method || 'delivery').toLowerCase();

          return {
            order_id: subOrderId,
            master_order_id: o.master_order_id || String(o.id),
            farm_id: subOrder?.farm_id || o.farm_id,
            farm_name: subOrder?.farm_name || '',
            event: effectiveStatus,
            status: effectiveStatus,
              buyer_name: buyer.businessName || buyer.business_name || buyer.name || buyer.contactName || buyer.contact_name || '',
              buyer_business_name: buyer.businessName || buyer.business_name || buyer.name || '',
              buyer_contact_name: buyer.contactName || buyer.contact_name || '',
            buyer_email: o.buyer_email || buyer.email || '',
            buyer_phone: buyer.phone || buyer.contactPhone || '',
              buyer_key_contact: buyer.keyContact || buyer.key_contact || '',
              buyer_backup_contact: buyer.backupContact || buyer.backup_contact || '',
              buyer_backup_phone: buyer.backupPhone || buyer.backup_phone || '',
            buyer_city: addr.city || buyer.city || '',
            buyer_state: addr.state || addr.province || buyer.state || '',
            delivery_date: o.delivery_date || data.delivery_date || null,
            delivery_address: addr.street
              ? `${addr.street}, ${addr.city || ''} ${addr.state || addr.province || ''} ${addr.zip || addr.postal_code || ''}`.trim()
              : '',
            fulfillment_method: fm,
              preferred_delivery_window: data.preferred_delivery_window || data.time_slot || subOrder?.preferred_delivery_window || '',
              time_slot: data.time_slot || subOrder?.time_slot || '',
              delivery_schedule: data.delivery_schedule || subOrder?.delivery_schedule || '',
              pickup_schedule: data.pickup_schedule || subOrder?.pickup_schedule || '',
              delivery_requirements: data.delivery_requirements || [],
              pickup_requirements: data.pickup_requirements || [],
            po_number: data.po_number || '',
            amount: subOrder?.sub_total || subOrder?.total_amount || o.total_amount,
            total_amount: subOrder?.sub_total || subOrder?.total_amount || o.total_amount,
            items: subOrder?.items || data.farm_sub_orders?.[0]?.items || [],
            timestamp: o.updated_at || o.created_at,
            created_at: o.created_at,
            certifications_required: buyer.certifications_required || data.certifications_required || [],
            gap_certified: buyer.gap_certified || data.gap_certified || false,
            notes: data.notes || buyer.notes || '',
            notifications: data.notifications || [],
            tracking_number: subOrder?.tracking_number || null,
            verification_deadline: subOrder?.verification_deadline || data.verification_deadline || null
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
          `SELECT id, master_order_id, status, buyer_email, delivery_date, total_amount,
                  order_data, created_at
           FROM wholesale_orders WHERE farm_id = $1 AND status IN ('pending', 'pending_verification', 'confirmed')
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
// Accepts both webhook format {order_id, verified, notes} and
// browser format {farm_id, sub_order_id, action, reason}.
router.post('/orders/farm-verify', jwtOrWebhookAuth, async (req, res) => {
  try {
    const { order_id, sub_order_id, verified, notes, action, farm_id, reason } = req.body;
    const orderId = order_id || sub_order_id;

    if (!orderId) {
      return res.status(400).json({ success: false, error: 'order_id or sub_order_id required' });
    }

    // Determine target status from either format
    let targetStatus;
    if (action) {
      targetStatus = action === 'accept' ? 'confirmed' : action === 'decline' ? 'rejected' : 'rejected';
    } else {
      targetStatus = verified ? 'confirmed' : 'rejected';
    }

    let updated = false;

    if (await isDatabaseAvailable()) {
      try {
        const dbOrder = await findWholesaleOrderRecord(orderId);
        if (dbOrder) {
          const orderData = dbOrder.order_data || {};
          let subOrder = findMatchingSubOrder(orderData, orderId);
          if (!subOrder && sub_order_id) {
            subOrder = findMatchingSubOrder(orderData, String(sub_order_id));
          }
          if (!subOrder && farm_id && Array.isArray(orderData.farm_sub_orders)) {
            subOrder = orderData.farm_sub_orders.find(s => s && String(s.farm_id) === String(farm_id)) || null;
          }

          const currentStatus = normalizeQueueStatus(subOrder?.status || dbOrder.status || orderData.status || '');
          if (currentStatus && currentStatus !== targetStatus && !isValidOrderTransition(currentStatus, targetStatus)) {
            return res.status(409).json({ success: false, error: `Invalid transition: ${currentStatus} -> ${targetStatus}` });
          }

          // Update sub-order status inside order_data
          if (subOrder) {
            subOrder.status = targetStatus;
            subOrder.status_updated_at = new Date().toISOString();
            if (reason) subOrder.verification_notes = reason;
          }
          orderData.status = targetStatus;
          orderData.status_updated_at = new Date().toISOString();

          await query(
            `UPDATE wholesale_orders
                SET status = $1,
                    order_data = $2::jsonb,
                    updated_at = NOW()
              WHERE id = $3`,
            [targetStatus, JSON.stringify(orderData), dbOrder.id]
          );
          updated = true;

          // Sync in-memory store
          const memOrderKey = dbOrder.master_order_id || orderId;
          const memOrder = await getOrderById(memOrderKey, { includeArchived: true });
          if (memOrder) {
            memOrder.status = targetStatus;
            memOrder.status_updated_at = orderData.status_updated_at;
            if (subOrder && Array.isArray(memOrder.farm_sub_orders)) {
              const memSub = findMatchingSubOrder(memOrder, orderId);
              if (memSub) {
                memSub.status = targetStatus;
                memSub.status_updated_at = orderData.status_updated_at;
                if (reason) memSub.verification_notes = reason;
              }
            }
            await saveOrder(memOrder).catch(() => {});
          }

          // Set UI overlay
          uiOrderStatuses.set(orderId, targetStatus);
          if (dbOrder.master_order_id) uiOrderStatuses.set(String(dbOrder.master_order_id), targetStatus);
          if (subOrder?.sub_order_id) uiOrderStatuses.set(String(subOrder.sub_order_id), targetStatus);

          logOrderEvent(dbOrder.master_order_id || orderId, targetStatus === 'confirmed' ? 'farm_accepted' : 'farm_rejected', {
            farm_id, sub_order_id: orderId, reason: reason || notes
          });
        }
      } catch (dbErr) {
        console.error('[farm-verify] DB error:', dbErr.message);
      }
    }

    // Fallback: update in-memory store even if DB lookup missed
    if (!updated) {
      const memOrder = await getOrderById(orderId, { includeArchived: true });
      if (memOrder) {
        memOrder.status = targetStatus;
        memOrder.status_updated_at = new Date().toISOString();
        const subOrder = findMatchingSubOrder(memOrder, orderId)
          || (farm_id && Array.isArray(memOrder.farm_sub_orders)
            ? memOrder.farm_sub_orders.find(s => s && String(s.farm_id) === String(farm_id))
            : null);
        if (subOrder) {
          subOrder.status = targetStatus;
          subOrder.status_updated_at = memOrder.status_updated_at;
          if (reason) subOrder.verification_notes = reason;
        }
        await saveOrder(memOrder).catch(() => {});
        updated = true;
      }
      uiOrderStatuses.set(orderId, targetStatus);
    }

    if (!updated) {
      // No order found at all — still set overlay for UI consistency
      uiOrderStatuses.set(orderId, targetStatus);
      console.warn(`[farm-verify] No order found for id=${orderId}, overlay set only`);
    }

    res.json({ success: true, order_id: orderId, verified: targetStatus === 'confirmed', updated, notes: notes || reason });
  } catch (error) {
    console.error('[farm-verify] Error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /orders/:orderId/verify — Verify specific order
router.post('/orders/:orderId/verify', jwtOrWebhookAuth, async (req, res) => {
  try {
    const { orderId } = req.params;
    const { verified = true, notes } = req.body;
    const targetStatus = verified ? 'confirmed' : 'rejected';
    let updated = false;

    if (await isDatabaseAvailable()) {
      try {
        const dbOrder = await findWholesaleOrderRecord(orderId);
        if (dbOrder) {
          const currentStatus = normalizeQueueStatus(dbOrder.status || '');
          if (currentStatus && currentStatus !== targetStatus && !isValidOrderTransition(currentStatus, targetStatus)) {
            return res.status(409).json({ success: false, error: `Invalid transition: ${currentStatus} -> ${targetStatus}` });
          }
          const orderData = dbOrder.order_data || {};
          orderData.status = targetStatus;
          orderData.status_updated_at = new Date().toISOString();
          await query(
            `UPDATE wholesale_orders SET status = $1, order_data = $2::jsonb, updated_at = NOW() WHERE id = $3`,
            [targetStatus, JSON.stringify(orderData), dbOrder.id]
          );
          updated = true;

          const memOrder = await getOrderById(dbOrder.master_order_id || orderId, { includeArchived: true });
          if (memOrder) {
            memOrder.status = targetStatus;
            memOrder.status_updated_at = orderData.status_updated_at;
            await saveOrder(memOrder).catch(() => {});
          }
          uiOrderStatuses.set(orderId, targetStatus);
          if (dbOrder.master_order_id) uiOrderStatuses.set(String(dbOrder.master_order_id), targetStatus);
        }
      } catch (dbErr) {
        console.error('[verify] DB error:', dbErr.message);
      }
    }

    if (!updated) {
      const memOrder = await getOrderById(orderId, { includeArchived: true });
      if (memOrder) {
        memOrder.status = targetStatus;
        memOrder.status_updated_at = new Date().toISOString();
        await saveOrder(memOrder).catch(() => {});
        updated = true;
      }
      uiOrderStatuses.set(orderId, targetStatus);
    }

    res.json({ success: true, orderId, verified, updated, notes });
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

    // Deduct inventory for fulfilled wholesale items (guard against double-deduction)
    if (farmId && isDatabaseAvailable() && !order.inventory_deducted_at) {
      try {
        // Find this farm's sub-order items
        const subOrders = order.farm_sub_orders || order.order_data?.farm_sub_orders || [];
        const farmSub = subOrders.find(s => String(s.farm_id) === String(farmId));
        const items = farmSub?.items || farmSub?.line_items || [];

        for (const item of items) {
          const qty = Number(item.quantity || item.qty || 0);
          const skuId = item.sku_id || item.product_id || item.sku;
          if (qty > 0 && skuId) {
            await dbQuery(
              `UPDATE farm_inventory SET
                sold_quantity_lbs = COALESCE(sold_quantity_lbs, 0) + $1,
                quantity_available = COALESCE(auto_quantity_lbs, 0)
                  + COALESCE(manual_quantity_lbs, 0)
                  - (COALESCE(sold_quantity_lbs, 0) + $1),
                last_updated = NOW()
               WHERE farm_id = $2 AND (sku = $3 OR product_id = $3)`,
              [qty, farmId, skuId]
            ).catch(e => console.warn(`[wholesale] Inventory deduct failed for ${skuId}:`, e.message));
          }
        }

        // Mark order as deducted to prevent double-deduction on re-fulfill
        order.inventory_deducted_at = new Date().toISOString();
        await saveOrder(order).catch(() => {});
        console.log(`[wholesale] Deducted inventory for ${items.length} item(s) on order ${orderId}`);
      } catch (invErr) {
        console.warn(`[wholesale] Inventory deduction error for order ${orderId}:`, invErr.message);
      }
    }

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

      // Send buyer email notification on meaningful status transitions.
      const notification = await sendBuyerStatusNotification({
        orderRecord: { ...order, order_data: order.order_data || order },
        status,
        farmId: farm_id || order.farm_id,
        orderId: order_id
      });

      // Persist notification record on the order
      if (notification) {
        appendOrderNotification(order, notification);
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
