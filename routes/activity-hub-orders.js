/**
 * Activity Hub Order Response Routes
 * Handles order verification, modification, and decline directly from Activity Hub
 *
 * FIXED: Replaced in-memory Maps with persistent NeDB order store
 * so orders survive server restarts and farms can actually see them.
 */

import express from 'express';
import pool from '../config/database.js';
import orderStore from '../lib/wholesale/order-store.js';
import notificationService from '../services/wholesale-notification-service.js';
import alternativeFarmService from '../services/alternative-farm-service.js';
import { linkCustomerToTrace, updateTraceStatus } from './traceability.js';

const router = express.Router();

/**
 * Get Central API URL for cross-service calls
 */
function getCentralUrl() {
  return process.env.GREENREACH_CENTRAL_URL || process.env.CENTRAL_URL || 'https://greenreachgreens.com';
}

/**
 * Deduct inventory at Central after order acceptance
 * Calls POST /api/inventory/deduct on Central to update sold_quantity_lbs
 */
async function deductInventoryAtCentral(farmId, items, orderId) {
  const centralUrl = getCentralUrl();
  const deductionItems = items.map(item => ({
    product_id: item.sku_id || item.product_id || item.product_name,
    quantity_lbs: Number(item.quantity) || 0,
    reason: 'wholesale_order_accepted',
    order_id: orderId
  })).filter(it => it.quantity_lbs > 0);

  if (deductionItems.length === 0) return { success: true, deductions: [] };

  try {
    const resp = await fetch(`${centralUrl}/api/inventory/deduct`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Farm-ID': farmId,
        'X-API-Key': process.env.GREENREACH_API_KEY || process.env.WHOLESALE_FARM_API_KEY || ''
      },
      body: JSON.stringify({ farmId, items: deductionItems }),
      signal: AbortSignal.timeout(8000)
    });
    const data = await resp.json().catch(() => ({}));
    if (resp.ok && data.success !== false) {
      console.log(`[Activity Hub] Inventory deducted at Central for ${deductionItems.length} items, order ${orderId}`);
      return data;
    }
    console.warn(`[Activity Hub] Inventory deduction response: ${resp.status}`, data.error || '');
    return { success: false, error: data.error || `HTTP ${resp.status}` };
  } catch (err) {
    console.error(`[Activity Hub] Inventory deduction failed (non-fatal):`, err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Log order action to audit trail
 */
async function logOrderAction(orderId, farmId, action, details = {}, performedBy = null) {
  try {
    await pool.query(
      `INSERT INTO wholesale_order_logs
        (sub_order_id, farm_id, action, details, performed_by, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       RETURNING id`,
      [orderId, farmId, action, JSON.stringify(details), performedBy]
    );
    console.log(`[OrderLog] ${action.toUpperCase()} - Order ${orderId} by Farm ${farmId} (${performedBy || 'Unknown'})`);
  } catch (error) {
    console.error('[OrderLog] Failed to log action:', error.message);
  }
}

/**
 * Helper: find a sub-order by its ID (checks sub_order_id, _id, and id fields)
 */
async function findSubOrder(orderId) {
  let sub = await orderStore.getSubOrder(orderId);
  if (sub) return sub;

  const allSubs = await orderStore.subOrdersDB.find({});
  return allSubs.find(s =>
    String(s.id) === String(orderId) ||
    String(s._id) === String(orderId) ||
    String(s.sub_order_id) === String(orderId)
  ) || null;
}


/**
 * GET /api/activity-hub/orders/all
 * Get all orders for a farm with optional status filter
 */
router.get('/all', async (req, res) => {
  try {
    const farmId = req.headers['x-farm-id'] || req.query.farm_id;
    if (!farmId) {
      return res.status(400).json({ error: 'farm_id required' });
    }
    const statusFilter = req.query.status || null;
    let orders = await orderStore.listFarmSubOrders(farmId, statusFilter);

    // PostgreSQL fallback: if NeDB is empty, hydrate from Central's wholesale_orders table
    if (orders.length === 0) {
      try {
        let sql = `SELECT master_order_id, status, order_data, created_at
                    FROM wholesale_orders ORDER BY created_at DESC LIMIT 200`;
        const pgResult = await pool.query(sql);
        const hydratedSubs = [];
        for (const row of (pgResult.rows || [])) {
          const od = row.order_data || {};
          for (const sub of (od.farm_sub_orders || [])) {
            if (String(sub.farm_id) !== String(farmId)) continue;
            if (statusFilter && sub.status !== statusFilter) continue;
            const subOrderId = `SO-${row.master_order_id}-${sub.farm_id}`;
            const items = (sub.items || []).map(it => ({
              sku_id: it.sku_id || '',
              product_name: it.product_name || it.sku_id || 'Unknown',
              quantity: Number(it.quantity) || 0,
              unit: it.unit || 'lb',
              price_per_unit: Number(it.price_per_unit || it.unit_price) || 0,
              line_total: (Number(it.price_per_unit || it.unit_price) || 0) * (Number(it.quantity) || 0)
            }));
            const subtotal = items.reduce((sum, it) => sum + it.line_total, 0);
            const subOrder = {
              sub_order_id: subOrderId,
              master_order_id: row.master_order_id,
              farm_id: sub.farm_id,
              farm_name: sub.farm_name || sub.farm_id,
              status: sub.status || od.status || row.status || 'pending_verification',
              items,
              sub_total: sub.subtotal || subtotal,
              verification_deadline: sub.verification_deadline || new Date(new Date(row.created_at).getTime() + 24 * 3600000).toISOString(),
              payment_status: od.payment?.status || row.status || 'pending',
              buyer_name: od.buyer_account?.businessName || od.buyer_account?.name || 'Wholesale Buyer',
              buyer_email: od.buyer_account?.email || '',
              delivery_date: od.delivery_date || null,
              created_at: row.created_at,
              updated_at: row.created_at
            };
            hydratedSubs.push(subOrder);
            // Backfill NeDB so future reads are fast
            orderStore.saveSubOrder(subOrder).catch(err =>
              console.warn(`[Activity Hub] NeDB backfill failed for ${subOrderId}:`, err.message)
            );
          }
        }
        if (hydratedSubs.length > 0) {
          console.log(`[Activity Hub] Hydrated ${hydratedSubs.length} sub-orders from PostgreSQL for farm ${farmId}`);
          orders = hydratedSubs;
        }
      } catch (pgErr) {
        console.warn('[Activity Hub] PostgreSQL fallback failed (non-fatal):', pgErr.message);
      }
    }

    orders.sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at));
    res.json({ ok: true, orders });
  } catch (error) {
    console.error('[Activity Hub] Error loading all orders:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * PATCH /api/activity-hub/orders/:orderId/notes
 * Save farm notes on a sub-order (shown on packing slip / invoice)
 */
router.patch('/:orderId/notes', async (req, res) => {
  try {
    const { orderId } = req.params;
    const farmId = req.headers['x-farm-id'] || req.body.farm_id;
    const notes = (req.body.notes || '').slice(0, 2000);
    if (!farmId) {
      return res.status(400).json({ error: 'farm_id required' });
    }
    const sub = await orderStore.getSubOrder(orderId);
    if (!sub) return res.status(404).json({ error: 'Sub-order not found' });
    if (sub.farm_id !== farmId) return res.status(403).json({ error: 'Not your order' });
    await orderStore.updateSubOrderStatus(orderId, sub.status, {
      farm_notes: notes,
      notes_updated_at: new Date().toISOString()
    });
    console.log(`[Activity Hub] Notes saved for sub-order ${orderId}`);
    res.json({ ok: true });
  } catch (error) {
    console.error('[Activity Hub] Error saving notes:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/activity-hub/orders/pending
 * Get pending orders for a farm
 */
router.get('/pending', async (req, res) => {
  try {
    const farmId = req.headers['x-farm-id'] || req.query.farm_id;

    if (!farmId) {
      return res.status(400).json({ error: 'farm_id required' });
    }

    let pendingOrders = await orderStore.listFarmSubOrders(farmId, 'pending_verification');

    // PostgreSQL fallback for pending orders
    if (pendingOrders.length === 0) {
      try {
        const pgResult = await pool.query(
          `SELECT master_order_id, status, order_data, created_at
           FROM wholesale_orders
           WHERE status IN ('pending_payment', 'confirmed', 'pending_verification')
           ORDER BY created_at DESC LIMIT 100`
        );
        for (const row of (pgResult.rows || [])) {
          const od = row.order_data || {};
          for (const sub of (od.farm_sub_orders || [])) {
            if (String(sub.farm_id) !== String(farmId)) continue;
            const subOrderId = `SO-${row.master_order_id}-${sub.farm_id}`;
            const existing = await orderStore.getSubOrder(subOrderId);
            if (existing) continue;
            const items = (sub.items || []).map(it => ({
              sku_id: it.sku_id || '', product_name: it.product_name || it.sku_id || 'Unknown',
              quantity: Number(it.quantity) || 0, unit: it.unit || 'lb',
              price_per_unit: Number(it.price_per_unit || it.unit_price) || 0,
              line_total: (Number(it.price_per_unit || it.unit_price) || 0) * (Number(it.quantity) || 0)
            }));
            const subOrder = {
              sub_order_id: subOrderId, master_order_id: row.master_order_id,
              farm_id: sub.farm_id, farm_name: sub.farm_name || sub.farm_id,
              status: 'pending_verification', items,
              sub_total: sub.subtotal || items.reduce((s, i) => s + i.line_total, 0),
              verification_deadline: new Date(new Date(row.created_at).getTime() + 24 * 3600000).toISOString(),
              payment_status: od.payment?.status || 'pending',
              buyer_name: od.buyer_account?.businessName || 'Wholesale Buyer',
              delivery_date: od.delivery_date || null,
              created_at: row.created_at, updated_at: row.created_at
            };
            pendingOrders.push(subOrder);
            orderStore.saveSubOrder(subOrder).catch(() => {});
          }
        }
        if (pendingOrders.length > 0) {
          console.log(`[Activity Hub] Hydrated ${pendingOrders.length} pending orders from PostgreSQL for farm ${farmId}`);
        }
      } catch (pgErr) {
        console.warn('[Activity Hub] Pending PG fallback failed:', pgErr.message);
      }
    }

    pendingOrders.sort((a, b) => {
      const deadlineA = new Date(a.verification_deadline || 0);
      const deadlineB = new Date(b.verification_deadline || 0);
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

    const subOrder = await findSubOrder(orderId);

    if (!subOrder) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (farmId && subOrder.farm_id !== farmId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const masterOrderId = subOrder.wholesale_order_id || subOrder.master_order_id;
    const mainOrder = masterOrderId ? await orderStore.getOrder(String(masterOrderId)) : null;

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

    const subOrder = await findSubOrder(orderId);

    if (!subOrder) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (subOrder.farm_id !== farmId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const deadline = new Date(subOrder.verification_deadline);
    if (new Date() > deadline) {
      return res.status(400).json({
        error: 'Verification deadline expired',
        deadline: deadline.toISOString()
      });
    }

    const subOrderKey = subOrder.sub_order_id || String(subOrder.id);
    await orderStore.updateSubOrderStatus(subOrderKey, 'farm_accepted', {
      verified_at: new Date().toISOString(),
      response_action: 'accept'
    });

    const updatedSubOrder = await findSubOrder(orderId);

    await logOrderAction(
      orderId, farmId, 'accept',
      {
        total_amount: subOrder.sub_total,
        item_count: (subOrder.items || []).length,
        deadline: subOrder.verification_deadline
      },
      req.body.performedBy || req.body.farmName || 'Activity Hub User'
    );

    const masterOrderId = subOrder.wholesale_order_id || subOrder.master_order_id;
    let allVerified = false;
    if (masterOrderId) {
      const allSubs = await orderStore.listSubOrders(String(masterOrderId));
      allVerified = allSubs.length > 0 && allSubs.every(so =>
        so.status === 'farm_accepted' || so.status === 'farm_modified'
      );
      if (allVerified) {
        await orderStore.updateOrderStatus(String(masterOrderId), 'farms_verified');
        console.log(`[Activity Hub] All farms verified order ${masterOrderId}`);
      }
    }

    console.log(`[Activity Hub] Farm ${farmId} accepted order ${orderId}`);

    res.json({
      ok: true,
      message: 'Order accepted successfully',
      subOrder: updatedSubOrder || subOrder,
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

    const subOrder = await findSubOrder(orderId);

    if (!subOrder) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (subOrder.farm_id !== farmId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const deadline = new Date(subOrder.verification_deadline);
    if (new Date() > deadline) {
      return res.status(400).json({
        error: 'Verification deadline expired',
        deadline: deadline.toISOString()
      });
    }

    const originalItems = JSON.parse(JSON.stringify(subOrder.items || []));
    const updatedItems = [...(subOrder.items || [])];

    for (const mod of modifications.items) {
      const item = updatedItems.find(i => i.sku_id === mod.sku_id);
      if (item) {
        item.original_quantity = item.quantity;
        item.quantity = mod.quantity;
        item.line_total = item.price_per_unit * mod.quantity;
        item.modified = true;
      }
    }

    const newSubTotal = updatedItems.reduce((sum, item) => sum + (item.line_total || 0), 0);

    const subOrderKey = subOrder.sub_order_id || String(subOrder.id);
    await orderStore.updateSubOrderStatus(subOrderKey, 'farm_modified', {
      verified_at: new Date().toISOString(),
      response_action: 'modify',
      modification_reason: reason || 'Quantity adjustment',
      original_items: originalItems,
      items: updatedItems,
      sub_total: newSubTotal
    });

    await logOrderAction(
      orderId, farmId, 'modify',
      {
        original_total: originalItems.reduce((sum, i) => sum + (i.price_per_unit * i.quantity), 0),
        new_total: newSubTotal,
        modifications: modifications.items,
        reason: reason || 'Quantity adjustment'
      },
      req.body.performedBy || req.body.farmName || 'Activity Hub User'
    );

    const masterOrderId = subOrder.wholesale_order_id || subOrder.master_order_id;
    if (masterOrderId) {
      await orderStore.updateOrderStatus(String(masterOrderId), 'pending_buyer_review');
      const mainOrder = await orderStore.getOrder(String(masterOrderId));
      if (mainOrder) {
        const orderForNotification = {
          id: mainOrder.id || mainOrder.master_order_id,
          buyer_email: mainOrder.buyer_email
        };
        await notificationService.notifyBuyerModifications(orderForNotification, [{ ...subOrder, items: updatedItems, sub_total: newSubTotal }]);
      }
    }

    console.log(`[Activity Hub] Farm ${farmId} modified order ${orderId}`);
    const updatedSubOrder = await findSubOrder(orderId);

    res.json({
      ok: true,
      message: 'Modifications submitted - awaiting buyer approval',
      subOrder: updatedSubOrder || subOrder,
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

    const subOrder = await findSubOrder(orderId);

    if (!subOrder) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (subOrder.farm_id !== farmId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const deadline = new Date(subOrder.verification_deadline);
    if (new Date() > deadline) {
      return res.status(400).json({
        error: 'Verification deadline expired',
        deadline: deadline.toISOString()
      });
    }

    const subOrderKey = subOrder.sub_order_id || String(subOrder.id);
    await orderStore.updateSubOrderStatus(subOrderKey, 'farm_declined', {
      declined_at: new Date().toISOString(),
      decline_reason: reason,
      response_action: 'decline'
    });

    await logOrderAction(
      orderId, farmId, 'decline',
      {
        reason,
        total_amount: subOrder.sub_total,
        item_count: (subOrder.items || []).length
      },
      req.body.performedBy || req.body.farmName || 'Activity Hub User'
    );

    const masterOrderId = subOrder.wholesale_order_id || subOrder.master_order_id;
    if (masterOrderId) {
      await orderStore.updateOrderStatus(String(masterOrderId), 'seeking_alternatives');
      const mainOrder = await orderStore.getOrder(String(masterOrderId));
      if (mainOrder) {
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
    }

    console.log(`[Activity Hub] Farm ${farmId} declined order ${orderId}: ${reason}`);
    const updatedSubOrder = await findSubOrder(orderId);

    res.json({
      ok: true,
      message: 'Order declined - searching for alternative farms',
      subOrder: updatedSubOrder || subOrder,
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

    const subOrder = await findSubOrder(orderId);

    if (!subOrder) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (subOrder.farm_id !== farmId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    if (subOrder.status !== 'farm_accepted') {
      return res.status(400).json({
        error: 'Order must be accepted before picking',
        currentStatus: subOrder.status
      });
    }

    const now = new Date();
    const dateStr = now.toISOString().slice(2, 10).replace(/-/g, '');
    const orderSuffix = String(orderId).slice(-4);

    let groupsList = [];
    try {
      const groupsPath = new URL('../public/data/groups.json', import.meta.url).pathname;
      const fs = await import('fs');
      if (fs.existsSync(groupsPath)) {
        const gd = JSON.parse(fs.readFileSync(groupsPath, 'utf-8'));
        groupsList = gd.groups || [];
      }
    } catch (e) {
      // Groups not available -- non-fatal
    }

    const items = [...(subOrder.items || [])];
    for (const item of items) {
      const cropName = item.product_name.toUpperCase().replace(/\s+/g, '');
      item.lot_code = `A1-${cropName}-${dateStr}-${orderSuffix}`;
      item.harvest_date = now.toISOString().split('T')[0];

      const matchedGroup = groupsList.find(g => {
        const hc = g.planConfig?.harvestCycle;
        return hc && hc.strategy === 'cut_and_come_again' &&
               (g.plan || '').toLowerCase().includes(item.product_name.toLowerCase().split(' ')[0]);
      });
      if (matchedGroup) {
        const hc = matchedGroup.planConfig.harvestCycle;
        item.harvest_cut = hc.currentHarvest || 1;
        item.harvest_strategy = 'cut_and_come_again';
        item.max_harvests = hc.maxHarvests || 4;
        item.regrowth_yield_factor = Math.pow(hc.regrowthYieldFactor || 0.85, (hc.currentHarvest || 1) - 1);
        item.lot_code += `-C${hc.currentHarvest || 1}`;
      }
    }

    const subOrderKey = subOrder.sub_order_id || String(subOrder.id);
    await orderStore.updateSubOrderStatus(subOrderKey, 'picking', {
      pick_started_at: now.toISOString(),
      picked_by: pickedBy || 'Farm Worker',
      items
    });

    await logOrderAction(
      orderId, farmId, 'pick',
      {
        lot_codes: items.map(i => ({ sku: i.sku_id, lot_code: i.lot_code })),
        item_count: items.length,
        picked_by: pickedBy || 'Farm Worker'
      },
      pickedBy || 'Activity Hub User'
    );

    console.log(`[Activity Hub] Started picking order ${orderId}`, {
      farm: farmId,
      items: items.length,
      lotCodes: items.map(i => i.lot_code)
    });

    const updatedSubOrder = await findSubOrder(orderId);

    res.json({
      ok: true,
      message: 'Picking started - lot codes generated',
      subOrder: updatedSubOrder || subOrder,
      lotCodes: items.map(item => ({
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

    const subOrder = await findSubOrder(orderId);

    if (!subOrder) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (subOrder.farm_id !== farmId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    if (subOrder.status !== 'picking') {
      return res.status(400).json({
        error: 'Order must be in picking status',
        currentStatus: subOrder.status
      });
    }

    const packedByName = packedBy || subOrder.picked_by || 'Farm Worker';

    const subOrderKey = subOrder.sub_order_id || String(subOrder.id);
    await orderStore.updateSubOrderStatus(subOrderKey, 'packed', {
      packed_at: new Date().toISOString(),
      packed_by: packedByName
    });

    await logOrderAction(
      orderId, farmId, 'pack',
      {
        lot_codes: (subOrder.items || []).map(i => i.lot_code),
        item_count: (subOrder.items || []).length,
        packed_by: packedByName
      },
      packedByName
    );

    const masterOrderId = subOrder.wholesale_order_id || subOrder.master_order_id;
    const mainOrder = masterOrderId ? await orderStore.getOrder(String(masterOrderId)) : null;

    try {
      const buyerName = mainOrder?.buyer_name || 'Unknown Buyer';
      const buyerAddr = mainOrder?.delivery_address || '';
      for (const item of (subOrder.items || [])) {
        if (item.lot_code) {
          await linkCustomerToTrace(item.lot_code, {
            name: buyerName,
            address: buyerAddr,
            order_id: masterOrderId || orderId,
            quantity: item.quantity,
            unit: item.unit,
            date: new Date().toISOString()
          });
          await updateTraceStatus(item.lot_code, 'packed', packedByName, `Packed for order ${orderId}`);
        }
      }
    } catch (traceErr) {
      console.warn('[Activity Hub] Non-blocking trace linkage error:', traceErr.message);
    }

    const labelParams = new URLSearchParams({
      order_id: String(subOrder.id || orderId),
      buyer_name: mainOrder?.buyer_name || 'Buyer',
      buyer_address: mainOrder?.delivery_address || '',
      farm_name: subOrder.farm_name || '',
      farm_id: farmId,
      lot_codes: (subOrder.items || []).map(i => i.lot_code).join(','),
      items: JSON.stringify((subOrder.items || []).map(i => ({
        name: i.product_name,
        quantity: i.quantity,
        unit: i.unit
      })))
    });
    const labelUrl = `/api/labels/packing?` + labelParams.toString();

    console.log(`[Activity Hub] Packed order ${orderId}`, { farm: farmId, labelUrl });

    const updatedSubOrder = await findSubOrder(orderId);

    res.json({
      ok: true,
      message: 'Order packed - label ready to print',
      subOrder: updatedSubOrder || subOrder,
      labelUrl,
      printerConfigured: req.body.hasPrinter || false,
      nextAction: 'mark_as_shipped'
    });

  } catch (error) {
    console.error('[Activity Hub] Error packing order:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/activity-hub/orders/sync
 * Force-sync orders from Central's PostgreSQL into NeDB.
 * Called by admin or on startup to backfill Activity Hub.
 */
router.post('/sync', async (req, res) => {
  try {
    const farmId = req.headers['x-farm-id'] || req.body.farm_id;
    if (!farmId) {
      return res.status(400).json({ error: 'farm_id required' });
    }
    const pgResult = await pool.query(
      `SELECT master_order_id, status, order_data, created_at
       FROM wholesale_orders ORDER BY created_at DESC LIMIT 500`
    );
    let synced = 0;
    let skipped = 0;
    for (const row of (pgResult.rows || [])) {
      const od = row.order_data || {};
      for (const sub of (od.farm_sub_orders || [])) {
        if (String(sub.farm_id) !== String(farmId)) continue;
        const subOrderId = `SO-${row.master_order_id}-${sub.farm_id}`;
        const existing = await orderStore.getSubOrder(subOrderId);
        if (existing) { skipped++; continue; }
        const items = (sub.items || []).map(it => ({
          sku_id: it.sku_id || '', product_name: it.product_name || it.sku_id || 'Unknown',
          quantity: Number(it.quantity) || 0, unit: it.unit || 'lb',
          price_per_unit: Number(it.price_per_unit || it.unit_price) || 0,
          line_total: (Number(it.price_per_unit || it.unit_price) || 0) * (Number(it.quantity) || 0)
        }));
        await orderStore.saveSubOrder({
          sub_order_id: subOrderId, master_order_id: row.master_order_id,
          farm_id: sub.farm_id, farm_name: sub.farm_name || sub.farm_id,
          status: sub.status || od.status || row.status || 'pending_verification', items,
          sub_total: sub.subtotal || items.reduce((s, i) => s + i.line_total, 0),
          verification_deadline: sub.verification_deadline || new Date(new Date(row.created_at).getTime() + 24 * 3600000).toISOString(),
          payment_status: od.payment?.status || 'pending',
          buyer_name: od.buyer_account?.businessName || 'Wholesale Buyer',
          delivery_date: od.delivery_date || null,
          created_at: row.created_at, updated_at: row.created_at
        });
        synced++;
      }
      // Also save master order
      const existing = await orderStore.getOrder(row.master_order_id);
      if (!existing) {
        await orderStore.saveOrder({
          master_order_id: row.master_order_id,
          buyer_name: od.buyer_account?.businessName || 'Wholesale Buyer',
          buyer_email: od.buyer_account?.email || '',
          delivery_date: od.delivery_date || null,
          status: od.status || row.status || 'pending',
          created_at: row.created_at
        });
      }
    }
    console.log(`[Activity Hub] Sync complete: ${synced} new sub-orders, ${skipped} already existed`);
    res.json({ ok: true, synced, skipped, total_pg_orders: pgResult.rows.length });
  } catch (error) {
    console.error('[Activity Hub] Sync error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
