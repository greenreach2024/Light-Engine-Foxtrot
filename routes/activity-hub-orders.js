/**
 * Activity Hub Order Response Routes
 * Handles order verification, modification, and decline directly from Activity Hub
 */

import express from 'express';
import pool from '../config/database.js';
import notificationService from '../services/wholesale-notification-service.js';
import alternativeFarmService from '../services/alternative-farm-service.js';

const router = express.Router();

/**
 * Log order action to audit trail
 * @param {string} orderId - Sub-order ID
 * @param {string} farmId - Farm ID performing the action
 * @param {string} action - Action type (accept, modify, decline, pick, pack)
 * @param {object} details - Additional action details
 * @param {string} performedBy - Name of farm worker who performed action
 */
async function logOrderAction(orderId, farmId, action, details = {}, performedBy = null) {
  try {
    const query = `
      INSERT INTO wholesale_order_logs 
        (sub_order_id, farm_id, action, details, performed_by, created_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      RETURNING id
    `;
    
    const result = await pool.query(query, [
      orderId,
      farmId,
      action,
      JSON.stringify(details),
      performedBy
    ]);
    
    console.log(`[OrderLog] ${action.toUpperCase()} - Order ${orderId} by Farm ${farmId} (${performedBy || 'Unknown'})`);
    return result.rows[0].id;
  } catch (error) {
    console.error('[OrderLog] Failed to log action:', error.message);
    // Don't throw - logging failure shouldn't break the order workflow
  }
}

// Mock database - Replace with actual database queries
const orders = new Map();
const subOrders = new Map();

/**
 * GET /api/activity-hub/orders/pending
 * Get pending orders for a farm (already implemented in wholesale-orders.js but duplicated here for Activity Hub)
 */
router.get('/pending', async (req, res) => {
  try {
    const farmId = req.headers['x-farm-id'] || req.query.farm_id;
    
    if (!farmId) {
      return res.status(400).json({ error: 'farm_id required' });
    }
    
    // TODO: Replace with actual database query
    const pendingOrders = Array.from(subOrders.values()).filter(subOrder => 
      subOrder.farm_id === farmId && 
      subOrder.status === 'pending_verification'
    );
    
    // Sort by urgency
    pendingOrders.sort((a, b) => {
      const deadlineA = new Date(a.verification_deadline);
      const deadlineB = new Date(b.verification_deadline);
      return deadlineA - deadlineB;
    });
    
    res.json({
      ok: true,
      orders: pendingOrders,
      count: pendingOrders.length
    });
    
  } catch (error) {
    console.error('[Activity Hub] Error fetching pending orders:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/activity-hub/orders/:orderId
 * Get full order details
 */
router.get('/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    const farmId = req.headers['x-farm-id'] || req.query.farm_id;
    
    // TODO: Replace with actual database query
    const subOrder = subOrders.get(orderId);
    
    if (!subOrder) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    if (farmId && subOrder.farm_id !== farmId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    
    // Get parent order details
    const mainOrder = orders.get(subOrder.wholesale_order_id);
    
    res.json({
      ok: true,
      subOrder,
      mainOrder,
      hoursRemaining: Math.max(0, (new Date(subOrder.verification_deadline) - new Date()) / (1000 * 60 * 60))
    });
    
  } catch (error) {
    console.error('[Activity Hub] Error fetching order:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/activity-hub/orders/:orderId/accept
 * Accept order as-is
 */
router.post('/:orderId/accept', async (req, res) => {
  try {
    const { orderId } = req.params;
    const farmId = req.headers['x-farm-id'] || req.body.farm_id;
    
    if (!farmId) {
      return res.status(400).json({ error: 'farm_id required' });
    }
    
    // TODO: Replace with actual database query
    const subOrder = subOrders.get(orderId);
    
    if (!subOrder) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    if (subOrder.farm_id !== farmId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    
    // Check deadline
    const deadline = new Date(subOrder.verification_deadline);
    if (new Date() > deadline) {
      return res.status(400).json({ 
        error: 'Verification deadline expired',
        deadline: deadline.toISOString()
      });
    }
    
    // Update status
    subOrder.status = 'farm_accepted';
    subOrder.verified_at = new Date().toISOString();
    subOrder.response_action = 'accept';
    
    // Log action to audit trail
    await logOrderAction(
      orderId,
      farmId,
      'accept',
      {
        total_amount: subOrder.sub_total,
        item_count: subOrder.items.length,
        deadline: subOrder.verification_deadline
      },
      req.body.performedBy || req.body.farmName || 'Activity Hub User'
    );
    
    // Check if all sub-orders for this order are now verified
    const mainOrder = orders.get(subOrder.wholesale_order_id);
    const allSubOrders = Array.from(subOrders.values()).filter(
      so => so.wholesale_order_id === subOrder.wholesale_order_id
    );
    
    const allVerified = allSubOrders.every(so => 
      so.status === 'farm_accepted' || so.status === 'farm_modified'
    );
    
    if (allVerified && mainOrder) {
      mainOrder.status = 'farms_verified';
      mainOrder.all_verified_at = new Date().toISOString();
      
      // TODO: Notify buyer that order is confirmed
      console.log(`[Activity Hub] All farms verified order ${mainOrder.id}`);
    }
    
    console.log(`[Activity Hub] Farm ${farmId} accepted order ${orderId}`);
    
    res.json({
      ok: true,
      message: 'Order accepted successfully',
      subOrder,
      allVerified,
      nextAction: 'start_picking'
    });
    
  } catch (error) {
    console.error('[Activity Hub] Error accepting order:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/activity-hub/orders/:orderId/modify
 * Modify order quantities or items
 */
router.post('/:orderId/modify', async (req, res) => {
  try {
    const { orderId } = req.params;
    const { farmId, modifications, reason } = req.body;
    
    if (!farmId) {
      return res.status(400).json({ error: 'farm_id required' });
    }
    
    if (!modifications || !modifications.items) {
      return res.status(400).json({ error: 'modifications.items required' });
    }
    
    // TODO: Replace with actual database query
    const subOrder = subOrders.get(orderId);
    
    if (!subOrder) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    if (subOrder.farm_id !== farmId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    
    // Check deadline
    const deadline = new Date(subOrder.verification_deadline);
    if (new Date() > deadline) {
      return res.status(400).json({ 
        error: 'Verification deadline expired',
        deadline: deadline.toISOString()
      });
    }
    
    // Apply modifications
    subOrder.status = 'farm_modified';
    subOrder.verified_at = new Date().toISOString();
    subOrder.response_action = 'modify';
    subOrder.modification_reason = reason || 'Quantity adjustment';
    subOrder.original_items = [...subOrder.items]; // Preserve original
    
    // Update items with modifications
    for (const mod of modifications.items) {
      const item = subOrder.items.find(i => i.sku_id === mod.sku_id);
      if (item) {
        item.original_quantity = item.quantity;
        item.quantity = mod.quantity;
        item.line_total = item.price_per_unit * mod.quantity;
        item.modified = true;
      }
    }
    
    // Recalculate sub_total
    subOrder.sub_total = subOrder.items.reduce((sum, item) => sum + item.line_total, 0);
    
    // Log modification to audit trail
    await logOrderAction(
      orderId,
      farmId,
      'modify',
      {
        original_total: subOrder.original_items.reduce((sum, i) => sum + (i.price_per_unit * i.quantity), 0),
        new_total: subOrder.sub_total,
        modifications: modifications.items,
        reason: reason || 'Quantity adjustment'
      },
      req.body.performedBy || req.body.farmName || 'Activity Hub User'
    );
    
    // Get parent order for notifications
    const mainOrder = orders.get(subOrder.wholesale_order_id);
    
    // Update main order status
    if (mainOrder) {
      mainOrder.status = 'pending_buyer_review';
      
      // Notify buyer about modifications
      const orderForNotification = {
        id: mainOrder.id,
        buyer_email: mainOrder.buyer_email
      };
      
      await notificationService.notifyBuyerModifications(orderForNotification, [subOrder]);
    }
    
    console.log(`[Activity Hub] Farm ${farmId} modified order ${orderId}`);
    
    res.json({
      ok: true,
      message: 'Modifications submitted - awaiting buyer approval',
      subOrder,
      requiresBuyerApproval: true,
      nextAction: 'wait_for_buyer'
    });
    
  } catch (error) {
    console.error('[Activity Hub] Error modifying order:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/activity-hub/orders/:orderId/decline
 * Decline order - system will search for alternatives
 */
router.post('/:orderId/decline', async (req, res) => {
  try {
    const { orderId } = req.params;
    const { farmId, reason } = req.body;
    
    if (!farmId) {
      return res.status(400).json({ error: 'farm_id required' });
    }
    
    if (!reason) {
      return res.status(400).json({ error: 'reason required' });
    }
    
    // TODO: Replace with actual database query
    const subOrder = subOrders.get(orderId);
    
    if (!subOrder) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    if (subOrder.farm_id !== farmId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    
    // Check deadline
    const deadline = new Date(subOrder.verification_deadline);
    if (new Date() > deadline) {
      return res.status(400).json({ 
        error: 'Verification deadline expired',
        deadline: deadline.toISOString()
      });
    }
    
    // Update status
    subOrder.status = 'farm_declined';
    subOrder.declined_at = new Date().toISOString();
    subOrder.decline_reason = reason;
    subOrder.response_action = 'decline';
    
    // Log decline to audit trail
    await logOrderAction(
      orderId,
      farmId,
      'decline',
      {
        reason,
        total_amount: subOrder.sub_total,
        item_count: subOrder.items.length
      },
      req.body.performedBy || req.body.farmName || 'Activity Hub User'
    );
    
    // Get parent order
    const mainOrder = orders.get(subOrder.wholesale_order_id);
    
    if (mainOrder) {
      mainOrder.status = 'seeking_alternatives';
      
      // Trigger alternative farm search (async)
      console.log(`[Activity Hub] Searching for alternatives for declined order ${orderId}`);
      
      alternativeFarmService.findAlternatives(subOrder, mainOrder)
        .then(result => {
          if (result.success) {
            console.log(`[Activity Hub] Notified ${result.alternatives_notified} alternative farms`);
          } else if (result.refund_required) {
            console.log(`[Activity Hub] No alternatives found - processing refund`);
            alternativeFarmService.processPartialRefund(mainOrder, subOrder);
          }
        })
        .catch(err => console.error('[Activity Hub] Alternative search failed:', err));
    }
    
    console.log(`[Activity Hub] Farm ${farmId} declined order ${orderId}: ${reason}`);
    
    res.json({
      ok: true,
      message: 'Order declined - searching for alternative farms',
      subOrder,
      searchingAlternatives: true
    });
    
  } catch (error) {
    console.error('[Activity Hub] Error declining order:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/activity-hub/orders/:orderId/pick
 * Start picking workflow - generates lot code and records pick start time
 */
router.post('/:orderId/pick', async (req, res) => {
  try {
    const { orderId } = req.params;
    const { farmId, pickedBy } = req.body;
    
    if (!farmId) {
      return res.status(400).json({ error: 'farm_id required' });
    }
    
    // TODO: Replace with actual database query
    const subOrder = subOrders.get(orderId);
    
    if (!subOrder) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    if (subOrder.farm_id !== farmId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    
    // Must be accepted first
    if (subOrder.status !== 'farm_accepted') {
      return res.status(400).json({ 
        error: 'Order must be accepted before picking',
        currentStatus: subOrder.status
      });
    }
    
    // Generate lot codes for each item (format: ZONE-CROP-YYMMDD-ORDER#)
    const now = new Date();
    const dateStr = now.toISOString().slice(2, 10).replace(/-/g, ''); // YYMMDD
    const orderSuffix = orderId.slice(-4); // Last 4 chars of order ID
    
    for (const item of subOrder.items) {
      const cropName = item.product_name.toUpperCase().replace(/\s+/g, '');
      item.lot_code = `A1-${cropName}-${dateStr}-${orderSuffix}`;
      item.harvest_date = now.toISOString().split('T')[0]; // YYYY-MM-DD
    }
    
    // Update status
    subOrder.status = 'picking';
    subOrder.pick_started_at = now.toISOString();
    subOrder.picked_by = pickedBy || 'Farm Worker';
    
    // Log picking action to audit trail
    await logOrderAction(
      orderId,
      farmId,
      'pick',
      {
        lot_codes: subOrder.items.map(i => ({ sku: i.sku_id, lot_code: i.lot_code })),
        item_count: subOrder.items.length,
        picked_by: pickedBy || 'Farm Worker'
      },
      pickedBy || 'Activity Hub User'
    );
    
    console.log(`[Activity Hub] Started picking order ${orderId}`, {
      farm: farmId,
      items: subOrder.items.length,
      lotCodes: subOrder.items.map(i => i.lot_code)
    });
    
    res.json({
      ok: true,
      message: 'Picking started - lot codes generated',
      subOrder,
      lotCodes: subOrder.items.map(item => ({
        sku_id: item.sku_id,
        product_name: item.product_name,
        lot_code: item.lot_code,
        harvest_date: item.harvest_date
      })),
      nextAction: 'mark_as_packed'
    });
    
  } catch (error) {
    console.error('[Activity Hub] Error starting pick:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/activity-hub/orders/:orderId/pack
 * Mark as packed - generates packing label
 */
router.post('/:orderId/pack', async (req, res) => {
  try {
    const { orderId } = req.params;
    const { farmId, packedBy } = req.body;
    
    if (!farmId) {
      return res.status(400).json({ error: 'farm_id required' });
    }
    
    // TODO: Replace with actual database query
    const subOrder = subOrders.get(orderId);
    
    if (!subOrder) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    if (subOrder.farm_id !== farmId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    
    // Must be picking first
    if (subOrder.status !== 'picking') {
      return res.status(400).json({ 
        error: 'Order must be in picking status',
        currentStatus: subOrder.status
      });
    }
    
    // Update status
    subOrder.status = 'packed';
    subOrder.packed_at = new Date().toISOString();
    subOrder.packed_by = packedBy || subOrder.picked_by || 'Farm Worker';
    
    // Log packing action to audit trail
    await logOrderAction(
      orderId,
      farmId,
      'pack',
      {
        lot_codes: subOrder.items.map(i => i.lot_code),
        item_count: subOrder.items.length,
        packed_by: packedBy || subOrder.picked_by || 'Farm Worker'
      },
      packedBy || 'Activity Hub User'
    );
    
    // Get parent order for label generation
    const mainOrder = orders.get(subOrder.wholesale_order_id);
    
    // Generate packing label URL
    const labelUrl = `/api/labels/packing?` + new URLSearchParams({
      order_id: subOrder.id,
      buyer_name: mainOrder?.buyer_name || 'Buyer',
      buyer_address: mainOrder?.delivery_address || '',
      farm_name: subOrder.farm_name,
      farm_id: farmId,
      lot_codes: subOrder.items.map(i => i.lot_code).join(','),
      items: JSON.stringify(subOrder.items.map(i => ({
        name: i.product_name,
        quantity: i.quantity,
        unit: i.unit
      })))
    });
    
    console.log(`[Activity Hub] Packed order ${orderId}`, {
      farm: farmId,
      labelUrl
    });
    
    res.json({
      ok: true,
      message: 'Order packed - label ready to print',
      subOrder,
      labelUrl,
      printerConfigured: req.body.hasPrinter || false, // Client indicates if thermal printer is available
      nextAction: 'mark_as_shipped'
    });
    
  } catch (error) {
    console.error('[Activity Hub] Error packing order:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
