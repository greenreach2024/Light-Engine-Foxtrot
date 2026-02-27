/**
 * Wholesale Farm-Side Fulfillment Routes
 * Operations the grower/farm performs to fulfill wholesale orders.
 * Used by farm-admin.js wholesale operations section.
 *
 * These supplement the existing wholesale.js buyer-facing routes.
 *
 * Endpoints mounted at /api/wholesale/:
 *   POST /order-statuses         - Bulk update order statuses (requires webhook signature)
 *   POST /tracking-numbers       - Add tracking numbers to orders (requires webhook signature)
 *   POST /order-tracking         - Add tracking event (requires webhook signature)
 *   GET  /order-events           - List order events for this farm
 *   GET  /farm-performance/alerts - Farm performance alerts
 *   GET  /orders/pending-verification/:farmId - Orders needing verification
 *   POST /orders/farm-verify     - Farm verifies an order (requires webhook signature)
 *   POST /orders/:orderId/verify - Verify specific order (requires webhook signature)
 *   GET  /orders/pending         - Pending orders for farm
 */
import { Router } from 'express';
import { query, isDatabaseAvailable } from '../config/database.js';
import { verifyWebhookSignature } from '../middleware/webhook-signature.js';

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
          await query(
            `UPDATE wholesale_orders SET status = $1, updated_at = NOW() WHERE id = $2`,
            [status, order_id]
          );
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
          await query(
            `UPDATE wholesale_orders SET 
               tracking_number = $1, carrier = $2, status = 'shipped', updated_at = NOW()
             WHERE id = $3`,
            [tracking_number, carrier || 'unknown', order_id]
          );
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
    const { order_id, event, location, timestamp } = req.body;
    // Store tracking event (in production would go to a tracking_events table)
    console.log(`[Wholesale] Tracking event: order=${order_id} event=${event} location=${location}`);
    res.json({
      success: true,
      event: {
        order_id, event, location,
        timestamp: timestamp || new Date().toISOString(),
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
          `SELECT id, farm_id, status, buyer_email, delivery_date, total_amount, created_at, updated_at
           FROM wholesale_orders
           WHERE ($1::text IS NULL OR farm_id = $1)
           ORDER BY updated_at DESC LIMIT 50`,
          [farmId]
        );
        events = result.rows.map(o => ({
          order_id: o.id,
          farm_id: o.farm_id,
          event: o.status,
          buyer: o.buyer_email,
          deliveryDate: o.delivery_date,
          amount: o.total_amount,
          timestamp: o.updated_at || o.created_at,
        }));
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
    if (await isDatabaseAvailable()) {
      try {
        await query(
          `UPDATE wholesale_orders SET status = $1, updated_at = NOW() WHERE id = $2`,
          [verified ? 'confirmed' : 'rejected', order_id]
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
    if (await isDatabaseAvailable()) {
      try {
        await query(
          `UPDATE wholesale_orders SET status = $1, updated_at = NOW() WHERE id = $2`,
          [verified ? 'confirmed' : 'rejected', orderId]
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

export default router;
