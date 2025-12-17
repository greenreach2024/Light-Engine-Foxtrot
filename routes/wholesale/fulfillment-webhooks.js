/**
 * GreenReach Wholesale - Fulfillment Webhooks
 * 
 * Receives status updates from Light Engine farms about order fulfillment
 * Updates centralized FarmSubOrder records with fulfillment progress
 * Sends notifications to buyers about order status changes
 */

import express from 'express';

const router = express.Router();

// In-memory storage (TODO: migrate to database)
if (!global.farmSubOrders) {
  global.farmSubOrders = new Map();
}

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
    
    // Validate webhook signature (TODO: implement HMAC verification)
    // const signature = req.headers['x-farm-signature'];
    // if (!verifyFarmSignature(signature, req.body)) {
    //   return res.status(401).json({ status: 'error', message: 'Invalid signature' });
    // }
    
    console.log(` Fulfillment webhook received: ${event_type}`);
    console.log(`  Sub-Order: ${sub_order_id}`);
    console.log(`  Farm: ${farm_id}`);
    console.log(`  Status: ${old_status} → ${new_status}`);
    
    // Get sub-order record
    const subOrder = global.farmSubOrders.get(sub_order_id);
    if (!subOrder) {
      console.warn(`Sub-order not found: ${sub_order_id}`);
      return res.status(404).json({
        status: 'error',
        message: 'Sub-order not found'
      });
    }
    
    // Update sub-order
    subOrder.fulfillment_status = new_status;
    subOrder.fulfillment_updated_at = updated_at;
    subOrder.fulfillment_location = location;
    
    if (tracking_number) {
      subOrder.tracking_number = tracking_number;
    }
    if (carrier) {
      subOrder.carrier = carrier;
    }
    if (estimated_delivery) {
      subOrder.estimated_delivery = estimated_delivery;
    }
    if (new_status === 'shipped') {
      subOrder.shipped_at = updated_at;
    }
    if (new_status === 'delivered') {
      subOrder.delivered_at = updated_at;
      subOrder.status = 'completed'; // Update SubOrderStatus
    }
    
    // Store fulfillment history
    if (!subOrder.fulfillment_history) {
      subOrder.fulfillment_history = [];
    }
    subOrder.fulfillment_history.push({
      status: new_status,
      timestamp: updated_at,
      notes,
      location,
      updated_by,
      tracking_number,
      carrier
    });
    
    global.farmSubOrders.set(sub_order_id, subOrder);
    
    // Check for SLA violations
    if (new_status === 'delivered' || new_status === 'shipped') {
      await checkSLAViolation(subOrder, updated_at);
    }
    
    // Send buyer notification
    await notifyBuyer(subOrder, new_status, notes);
    
    console.log(`[OK] Sub-order updated: ${sub_order_id}`);
    
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
    console.error('Fulfillment webhook error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to process fulfillment webhook',
      error: error.message
    });
  }
});

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
      console.log(`[WARNING] SLA violation detected: ${delayHours.toFixed(1)} hours late`);
      
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
        console.log(`[OK] SLA violation recorded for ${subOrder.id}`);
      }
    }
  } catch (error) {
    console.error('SLA check error:', error);
  }
}

/**
 * Send buyer notification about status change
 */
async function notifyBuyer(subOrder, newStatus, notes) {
  try {
    // In production, would:
    // 1. Fetch buyer contact details from database
    // 2. Send email/SMS notification
    // 3. Log notification in audit system
    
    const statusMessages = {
      'pending': 'Your order has been received by the farm',
      'picked': 'Your order has been harvested and is being prepared',
      'packed': 'Your order has been packed and is ready for shipment',
      'shipped': 'Your order is on its way',
      'delivered': 'Your order has been delivered'
    };
    
    const message = statusMessages[newStatus] || `Order status: ${newStatus}`;
    
    console.log(`📧 Buyer notification: ${message}`);
    console.log(`  Sub-Order: ${subOrder.id}`);
    console.log(`  Notes: ${notes || 'N/A'}`);
    
    if (subOrder.tracking_number) {
      console.log(`  Tracking: ${subOrder.tracking_number}`);
    }
    
    // Store notification (in-memory for now)
    if (!global.buyerNotifications) {
      global.buyerNotifications = [];
    }
    
    global.buyerNotifications.push({
      notification_id: `notif_${Date.now()}`,
      sub_order_id: subOrder.id,
      buyer_id: 'buyer_placeholder', // Would fetch from master order
      type: 'fulfillment_update',
      message,
      status: newStatus,
      notes,
      tracking_number: subOrder.tracking_number,
      sent_at: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Buyer notification error:', error);
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
