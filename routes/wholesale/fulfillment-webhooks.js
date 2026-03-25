/**
 * GreenReach Wholesale - Fulfillment Webhooks
 * 
 * Receives status updates from Light Engine farms about order fulfillment
 * Updates persistent FarmSubOrder records with fulfillment progress
 * Sends notifications to buyers about order status changes
 */

import express from 'express';
import crypto from 'crypto';
import { getSubOrder, saveSubOrder, getOrder } from '../../lib/wholesale/order-store.js';

const router = express.Router();

// Idempotency set — prevents duplicate webhook processing (in-memory, cleared on restart)
const processedEventIds = new Set();
const MAX_PROCESSED = 10000;

/**
 * POST /api/wholesale/webhooks/fulfillment
 * 
 * Webhook receiver for farm fulfillment status updates
 * Called by Light Engine /api/wholesale/fulfillment/status endpoint
 * 
 * Body:
 * {
 *   event_type: 'fulfillment.status_updated',
 *   sub_order_id: 'sub_order_123',
 *   farm_id: 'farm_123',
 *   old_status: 'pending',
 *   new_status: 'picked',
 *   notes: 'All items harvested, quality checked',
 *   location: 'Pack House Station 3',
 *   tracking_number: 'USPS-1234567890',
 *   carrier: 'USPS',
 *   estimated_delivery: '2025-12-20',
 *   updated_by: 'john@farm.com',
 *   updated_at: '2025-12-15T10:00:00Z'
 * }
 */
router.post('/', async (req, res) => {
  try {
    const {
      event_type,
      event_id,
      sub_order_id,
      farm_id,
      old_status,
      new_status,
      notes,
      location,
      tracking_number,
      carrier,
      estimated_delivery,
      updated_by,
      updated_at
    } = req.body;
    
    // ── HMAC signature verification ──────────────────────────────────
    const signature = req.headers['x-farm-signature'];
    const timestamp = req.headers['x-farm-timestamp'];
    if (!verifyFarmSignature(req.body, signature, timestamp)) {
      return res.status(401).json({ status: 'error', message: 'Invalid or missing webhook signature' });
    }
    
    // ── Idempotency check ────────────────────────────────────────────
    const dedupKey = event_id || `${sub_order_id}_${new_status}_${updated_at}`;
    if (processedEventIds.has(dedupKey)) {
      console.log(`[Fulfillment] Duplicate event skipped: ${dedupKey}`);
      return res.json({ status: 'ok', message: 'Already processed (idempotent)', sub_order_id });
    }
    
    console.log(`[Fulfillment] Webhook received: ${event_type}`);
    console.log(`  Sub-Order: ${sub_order_id}`);
    console.log(`  Farm: ${farm_id}`);
    console.log(`  Status: ${old_status} → ${new_status}`);
    
    // ── Look up sub-order from persistent store ──────────────────────
    const subOrder = await getSubOrder(sub_order_id);
    if (!subOrder) {
      console.warn(`[Fulfillment] Sub-order not found: ${sub_order_id}`);
      return res.status(404).json({
        status: 'error',
        message: 'Sub-order not found'
      });
    }
    
    // ── Status transition validation ─────────────────────────────────
    const validTransitions = {
      'pending_verification': ['verified', 'declined'],
      'verified':             ['picked', 'cancelled'],
      'confirmed':            ['picked', 'cancelled'],
      'pending':              ['picked', 'cancelled'],
      'picked':               ['packed', 'cancelled'],
      'packed':               ['shipped', 'cancelled'],
      'shipped':              ['delivered'],
      'delivered':            [] // terminal
    };
    const currentStatus = subOrder.fulfillment_status || subOrder.status || 'pending';
    const allowed = validTransitions[currentStatus];
    if (allowed && allowed.length > 0 && !allowed.includes(new_status)) {
      console.warn(`[Fulfillment] Invalid transition: ${currentStatus} → ${new_status}`);
      return res.status(409).json({
        status: 'error',
        message: `Invalid status transition: ${currentStatus} → ${new_status}`,
        allowed_transitions: allowed
      });
    }
    
    // ── Update sub-order ─────────────────────────────────────────────
    subOrder.fulfillment_status = new_status;
    subOrder.fulfillment_updated_at = updated_at || new Date().toISOString();
    subOrder.fulfillment_location = location;
    
    if (tracking_number) subOrder.tracking_number = tracking_number;
    if (carrier) subOrder.carrier = carrier;
    if (estimated_delivery) subOrder.estimated_delivery = estimated_delivery;
    if (new_status === 'shipped') subOrder.shipped_at = updated_at;
    if (new_status === 'delivered') {
      subOrder.delivered_at = updated_at;
      subOrder.status = 'completed';
    }
    
    // Append fulfillment history
    if (!subOrder.fulfillment_history) subOrder.fulfillment_history = [];
    subOrder.fulfillment_history.push({
      status: new_status,
      timestamp: updated_at || new Date().toISOString(),
      notes,
      location,
      updated_by,
      tracking_number,
      carrier
    });
    
    // Persist to NeDB
    await saveSubOrder(subOrder);
    
    // Mark event as processed
    processedEventIds.add(dedupKey);
    if (processedEventIds.size > MAX_PROCESSED) {
      const first = processedEventIds.values().next().value;
      processedEventIds.delete(first);
    }
    
    // Check for SLA violations
    if (new_status === 'delivered' || new_status === 'shipped') {
      await checkSLAViolation(subOrder, updated_at);
    }
    
    // Send buyer notification
    await notifyBuyer(subOrder, new_status, notes);
    
    console.log(`[Fulfillment] Sub-order updated: ${sub_order_id}`);
    
    res.json({
      status: 'ok',
      data: {
        sub_order_id,
        updated_status: new_status,
        timestamp: updated_at
      },
      message: 'Fulfillment status updated successfully'
    });
    
  } catch (error) {
    console.error('[Fulfillment] Webhook error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to process fulfillment webhook',
      error: error.message
    });
  }
});

/**
 * Verify HMAC-SHA256 webhook signature from farm
 * Uses the same pattern as edge-wholesale-webhook.js
 * Secret: WEBHOOK_SECRET env var or farm API key
 */
function verifyFarmSignature(payload, signature, timestamp) {
  // Skip verification in development / when no signature provided
  if (process.env.NODE_ENV === 'development') {
    return true;
  }
  if (!process.env.WEBHOOK_SECRET) {
    console.warn('[SECURITY] WEBHOOK_SECRET not configured -- webhook signature verification disabled');
    return true;
  }

  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) {
    console.warn('[Fulfillment] No WEBHOOK_SECRET configured, skipping verification');
    return true;
  }

  if (!signature || !timestamp) {
    console.warn('[Fulfillment] Missing signature or timestamp header');
    return false;
  }

  try {
    // Verify timestamp is recent (within 5 minutes)
    const now = Math.floor(Date.now() / 1000);
    const requestTime = parseInt(timestamp);
    if (Math.abs(now - requestTime) > 300) {
      console.error('[Fulfillment] Webhook timestamp too old');
      return false;
    }

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
    console.error('[Fulfillment] Signature verification error:', error.message);
    return false;
  }
}

/**
 * Check for SLA violations based on delivery timing
 */
async function checkSLAViolation(subOrder, actualDeliveryTime) {
  try {
    // Get applicable SLA rules (would fetch from database in production)
    const slaRule = {
      rule_id: 'sla_two_day',
      name: 'Two Day Delivery',
      delivery_window_hours: 48,
      penalty_type: 'percentage',
      penalty_amount: 5
    };
    
    const promisedDelivery = new Date(subOrder.pickup_window_end);
    const actualDelivery = new Date(actualDeliveryTime);
    
    const delayMs = actualDelivery - promisedDelivery;
    const delayHours = delayMs / (1000 * 60 * 60);
    
    if (delayHours > 0) {
      console.log(` SLA violation detected: ${delayHours.toFixed(1)} hours late`);
      
      // Record violation via SLA API
      const violationResponse = await fetch('http://localhost:8091/api/wholesale/sla/violations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sub_order_id: subOrder.id,
          rule_id: slaRule.rule_id,
          promised_delivery: promisedDelivery.toISOString(),
          actual_delivery: actualDelivery.toISOString(),
          delay_hours: delayHours,
          reason: 'Late fulfillment',
          farm_id: subOrder.farm_id
        })
      });
      
      if (violationResponse.ok) {
        console.log(` SLA violation recorded for ${subOrder.id}`);
      }
    }
  } catch (error) {
    console.error('SLA check error:', error);
  }
}

/**
 * Send buyer notification about status change
 * Resolves buyer_id from the master order via order-store
 */
async function notifyBuyer(subOrder, newStatus, notes) {
  try {
    const statusMessages = {
      'pending': 'Your order has been received by the farm',
      'verified': 'Your order has been verified by the farm',
      'picked': 'Your order has been harvested and is being prepared',
      'packed': 'Your order has been packed and is ready for shipment',
      'shipped': 'Your order is on its way',
      'delivered': 'Your order has been delivered'
    };
    
    const message = statusMessages[newStatus] || `Order status: ${newStatus}`;
    
    // Resolve buyer from master order
    let buyerId = subOrder.buyer_id || null;
    if (!buyerId && subOrder.master_order_id) {
      try {
        const masterOrder = await getOrder(subOrder.master_order_id);
        buyerId = masterOrder?.buyer_id || masterOrder?.buyer_account?.email || null;
      } catch (err) {
        console.warn('[Fulfillment] Could not resolve buyer from master order:', err.message);
      }
    }
    
    console.log(`[Fulfillment] Buyer notification: ${message}`);
    console.log(`  Sub-Order: ${subOrder.sub_order_id || subOrder.id}`);
    console.log(`  Buyer: ${buyerId || 'unknown'}`);
    console.log(`  Notes: ${notes || 'N/A'}`);
    
    if (subOrder.tracking_number) {
      console.log(`  Tracking: ${subOrder.tracking_number}`);
    }
    
    // Store notification for retrieval via GET /notifications
    if (!global.buyerNotifications) {
      global.buyerNotifications = [];
    }
    
    global.buyerNotifications.push({
      notification_id: `notif_${Date.now()}`,
      sub_order_id: subOrder.sub_order_id || subOrder.id,
      buyer_id: buyerId,
      type: 'fulfillment_update',
      message,
      status: newStatus,
      notes,
      tracking_number: subOrder.tracking_number,
      sent_at: new Date().toISOString()
    });

    // Send email if SMTP is configured and buyer has an email address
    if (process.env.SMTP_USER && buyerId && buyerId.includes('@')) {
      try {
        const { default: nodemailer } = await import('nodemailer');
        const transporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST || 'smtp.gmail.com',
          port: parseInt(process.env.SMTP_PORT || '587'),
          secure: false,
          auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        });
        await transporter.sendMail({
          from: process.env.NOTIFICATIONS_FROM_EMAIL || 'orders@greenreach.ca',
          to: buyerId,
          subject: `GreenReach Order Update -- ${newStatus}`,
          text: `${message}${notes ? '\n\nNotes: ' + notes : ''}${subOrder.tracking_number ? '\nTracking: ' + subOrder.tracking_number : ''}`
        });
        console.log(`[Fulfillment] Email sent to ${buyerId}`);
      } catch (emailErr) {
        console.warn('[Fulfillment] Email notification failed:', emailErr.message);
      }
    }
    
  } catch (error) {
    console.error('[Fulfillment] Buyer notification error:', error);
  }
}

/**
 * GET /api/wholesale/webhooks/fulfillment/notifications
 * 
 * List buyer notifications (for testing)
 */
router.get('/notifications', (req, res) => {
  try {
    const { buyer_id, sub_order_id } = req.query;
    
    let notifications = global.buyerNotifications || [];
    
    if (buyer_id) {
      notifications = notifications.filter(n => n.buyer_id === buyer_id);
    }
    if (sub_order_id) {
      notifications = notifications.filter(n => n.sub_order_id === sub_order_id);
    }
    
    res.json({
      status: 'ok',
      data: {
        notifications,
        total: notifications.length
      }
    });
    
  } catch (error) {
    console.error('List notifications error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to list notifications',
      error: error.message
    });
  }
});

export default router;
