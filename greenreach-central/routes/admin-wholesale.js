import express from 'express';
import bcrypt from 'bcryptjs';
import { query, isDatabaseAvailable } from '../config/database.js';
import {
  listAllOrders,
  listOrdersForBuyer,
  getOrderById,
  saveOrder,
  listAllBuyers,
  getBuyerById,
  resetBuyerPassword,
  deactivateBuyer,
  reactivateBuyer,
  getOrderAuditLog,
  logOrderEvent,
  createRefund,
  listRefundsForOrder,
  listPaymentsForBuyer
} from '../services/wholesaleMemoryStore.js';
import {
  transitionOrderStatus,
  transitionFulfillmentStatus,
  ORDER_STATUSES,
  FULFILLMENT_STATUSES
} from '../services/orderStateMachine.js';

const router = express.Router();

/**
 * GET /api/admin/wholesale/buyers
 * Get list of all wholesale buyers — uses in-memory store with DB fallback
 */
router.get('/buyers', async (req, res) => {
    const { page = 1, limit = 50, buyerType, search } = req.query;
    try {
        // Use in-memory buyer list first (always fresh)
        let buyers = listAllBuyers();

        if (buyerType) {
          buyers = buyers.filter(b => b.buyerType === buyerType);
        }
        if (search) {
          const s = search.toLowerCase();
          buyers = buyers.filter(b =>
            (b.businessName || '').toLowerCase().includes(s) ||
            (b.contactName || '').toLowerCase().includes(s) ||
            (b.email || '').toLowerCase().includes(s)
          );
        }

        const total = buyers.length;
        const offset = (parseInt(page) - 1) * parseInt(limit);
        const paged = buyers.slice(offset, offset + parseInt(limit));

        // If in-memory is empty, try DB
        if (buyers.length === 0 && isDatabaseAvailable()) {
          try {
            let sqlQuery = `
              SELECT id, business_name, contact_name, email, buyer_type,
                     location, status, phone, created_at
              FROM wholesale_buyers WHERE 1=1
            `;
            const params = [];
            let paramCount = 0;

            if (buyerType) {
              paramCount++;
              sqlQuery += ` AND buyer_type = $${paramCount}`;
              params.push(buyerType);
            }
            if (search) {
              paramCount++;
              sqlQuery += ` AND (business_name ILIKE $${paramCount} OR contact_name ILIKE $${paramCount} OR email ILIKE $${paramCount})`;
              params.push(`%${search}%`);
            }

            const countResult = await query(`SELECT COUNT(*) as total FROM (${sqlQuery}) as filtered`, params);
            const dbTotal = parseInt(countResult.rows[0]?.total || 0);

            sqlQuery += ` ORDER BY created_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
            params.push(parseInt(limit));
            params.push((parseInt(page) - 1) * parseInt(limit));

            const result = await query(sqlQuery, params);

            // Map DB snake_case columns to camelCase for frontend
            const mapped = result.rows.map(row => ({
              id: row.id,
              businessName: row.business_name,
              contactName: row.contact_name,
              email: row.email,
              buyerType: row.buyer_type,
              location: row.location || null,
              status: row.status || 'active',
              phone: row.phone || null,
              createdAt: row.created_at ? new Date(row.created_at).toISOString() : null
            }));

            return res.json({
              status: 'ok',
              data: {
                buyers: mapped,
                pagination: { page: parseInt(page), limit: parseInt(limit), total: dbTotal, pages: Math.ceil(dbTotal / parseInt(limit)) }
              }
            });
          } catch (dbErr) {
            // DB table may not exist — fall through
          }
        }

        return res.json({
            status: 'ok',
            data: {
                buyers: paged,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    pages: Math.ceil(total / parseInt(limit))
                }
            }
        });
    } catch (error) {
        console.error('[Admin Wholesale] Error fetching buyers:', error);
        res.status(500).json({ status: 'error', error: 'Failed to fetch buyers', message: error.message });
    }
});

/**
 * POST /api/admin/wholesale/buyers/reset-password
 * Reset buyer password (admin function)
 */
router.post('/buyers/reset-password', async (req, res) => {
    try {
        if (!isDatabaseAvailable()) {
            return res.status(503).json({
                status: 'error',
                error: 'Wholesale buyers not initialized',
                message: 'Database not available'
            });
        }
        const { email, newPassword } = req.body;
        
        if (!email || !newPassword) {
            return res.status(400).json({
                status: 'error',
                message: 'Email and new password are required'
            });
        }
        
        if (newPassword.length < 8) {
            return res.status(400).json({
                status: 'error',
                message: 'Password must be at least 8 characters'
            });
        }
        
        // Hash the new password
        const passwordHash = await bcrypt.hash(newPassword, 10);
        
        // Update buyer password in memory store + DB
        const updated = await resetBuyerPassword(email, passwordHash);
        
        if (!updated) {
            return res.status(404).json({
                status: 'error',
                message: 'Buyer not found'
            });
        }
        
        res.json({
            status: 'ok',
            message: 'Password reset successfully'
        });
    } catch (error) {
        const message = error?.message || '';
        if (message.includes('relation') && message.includes('wholesale_buyers')) {
            return res.status(503).json({
                status: 'error',
                error: 'Wholesale buyers not initialized',
                message: 'Wholesale buyers table is missing'
            });
        }
        console.error('[Admin Wholesale] Error resetting password:', error);
        res.status(500).json({
            status: 'error',
            error: 'Failed to reset password',
            message: error.message
        });
    }
});

/**
 * GET /api/admin/wholesale/orders
 * Get list of all wholesale orders with pagination.
 */
router.get('/orders', async (req, res) => {
    try {
        const { page = 1, limit = 50, includeArchived } = req.query;
        const orders = await listAllOrders({ includeArchived: String(includeArchived || '').toLowerCase() === 'true' });
        const total = orders.length;
        const offset = (parseInt(page) - 1) * parseInt(limit);
        const paged = orders.slice(offset, offset + parseInt(limit));
        res.json({
            status: 'ok',
            data: {
                orders: paged,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    pages: Math.ceil(total / parseInt(limit))
                }
            }
        });
    } catch (error) {
        console.error('[Admin Wholesale] Error fetching orders:', error);
        res.status(500).json({
            status: 'error',
            error: 'Failed to fetch orders',
            message: error.message
        });
    }
});

/**
 * GET /api/admin/wholesale/dashboard
 * Get wholesale dashboard summary (buyers, orders, revenue, farms).
 */
router.get('/dashboard', async (req, res) => {
    try {
        let buyersCount = 0;
        if (isDatabaseAvailable()) {
            const buyersResult = await query('SELECT COUNT(*) as count FROM wholesale_buyers');
            buyersCount = parseInt(buyersResult.rows[0]?.count || 0);
        }

        const orders = await listAllOrders();
        const totalOrders = orders.length;
        const totalRevenue = orders.reduce((sum, order) => sum + Number(order.grand_total || 0), 0);
        const activeFarms = new Set(
            orders.flatMap((order) => (order.farm_sub_orders || []).map((sub) => sub.farm_id))
        ).size;
        
        res.json({
            status: 'ok',
            data: {
                totalBuyers: buyersCount,
                totalOrders,
                totalRevenue,
                activeFarms
            }
        });
    } catch (error) {
        console.error('[Admin Wholesale] Error fetching dashboard:', error);
        res.status(500).json({
            status: 'error',
            error: 'Failed to fetch dashboard data',
            message: error.message
        });
    }
});

/**
 * GET /api/admin/wholesale/buyers/:buyerId
 * Get detailed buyer profile with order history
 */
router.get('/buyers/:buyerId', async (req, res) => {
    try {
        let buyer = getBuyerById(req.params.buyerId);

        // DB fallback when in-memory store is empty (e.g. after server restart)
        if (!buyer && isDatabaseAvailable()) {
            try {
                const result = await query(
                    'SELECT * FROM wholesale_buyers WHERE id = $1 LIMIT 1',
                    [req.params.buyerId]
                );
                if (result.rows.length > 0) {
                    const row = result.rows[0];
                    buyer = {
                        id: row.id,
                        businessName: row.business_name,
                        contactName: row.contact_name,
                        email: row.email,
                        buyerType: row.buyer_type,
                        location: row.location || null,
                        status: row.status || 'active',
                        phone: row.phone || null,
                        createdAt: row.created_at ? new Date(row.created_at).toISOString() : null
                    };
                }
            } catch (dbErr) {
                // DB table may not exist — fall through
            }
        }

        if (!buyer) {
            return res.status(404).json({ status: 'error', message: 'Buyer not found' });
        }

        const orders = await listOrdersForBuyer(buyer.id, { includeArchived: true });
        const payments = listPaymentsForBuyer(buyer.id);

        const totalSpent = orders.reduce((sum, o) => sum + Number(o.grand_total || 0), 0);
        const orderCount = orders.length;

        return res.json({
            status: 'ok',
            data: {
                buyer,
                orders,
                payments,
                summary: {
                    total_spent: totalSpent,
                    order_count: orderCount,
                    first_order: orders.length > 0 ? orders[orders.length - 1].created_at : null,
                    last_order: orders.length > 0 ? orders[0].created_at : null
                }
            }
        });
    } catch (error) {
        console.error('[Admin Wholesale] Error fetching buyer detail:', error);
        res.status(500).json({ status: 'error', message: error.message });
    }
});

/**
 * POST /api/admin/wholesale/buyers/:buyerId/deactivate
 * Deactivate a buyer account
 */
router.post('/buyers/:buyerId/deactivate', async (req, res) => {
    try {
        const buyer = deactivateBuyer(req.params.buyerId);
        if (!buyer) {
            return res.status(404).json({ status: 'error', message: 'Buyer not found' });
        }
        logOrderEvent('system', 'buyer_deactivated', { buyer_id: req.params.buyerId });
        return res.json({ status: 'ok', data: { buyer } });
    } catch (error) {
        console.error('[Admin Wholesale] Error deactivating buyer:', error);
        res.status(500).json({ status: 'error', message: error.message });
    }
});

/**
 * POST /api/admin/wholesale/buyers/:buyerId/reactivate
 * Reactivate a deactivated buyer account
 */
router.post('/buyers/:buyerId/reactivate', async (req, res) => {
    try {
        const buyer = reactivateBuyer(req.params.buyerId);
        if (!buyer) {
            return res.status(404).json({ status: 'error', message: 'Buyer not found' });
        }
        logOrderEvent('system', 'buyer_reactivated', { buyer_id: req.params.buyerId });
        return res.json({ status: 'ok', data: { buyer } });
    } catch (error) {
        console.error('[Admin Wholesale] Error reactivating buyer:', error);
        res.status(500).json({ status: 'error', message: error.message });
    }
});

/**
 * GET /api/admin/wholesale/audit-log
 * Get order audit log (optionally filtered by orderId)
 */
router.get('/audit-log', async (req, res) => {
    try {
        const { orderId, page = 1, limit = 100 } = req.query;
        let events = getOrderAuditLog(orderId || undefined);

        const total = events.length;
        const offset = (parseInt(page) - 1) * parseInt(limit);
        const paged = events.slice(offset, offset + parseInt(limit));

        return res.json({
            status: 'ok',
            data: {
                events: paged,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    pages: Math.ceil(total / parseInt(limit))
                }
            }
        });
    } catch (error) {
        console.error('[Admin Wholesale] Error fetching audit log:', error);
        res.status(500).json({ status: 'error', message: error.message });
    }
});

/**
 * POST /api/admin/wholesale/refunds
 * Process a refund for an order
 */
router.post('/refunds', async (req, res) => {
    try {
        const { orderId, amount, reason } = req.body || {};

        if (!orderId || !amount) {
            return res.status(400).json({ status: 'error', message: 'orderId and amount are required' });
        }

        const order = await getOrderById(orderId, { includeArchived: true });
        if (!order) {
            return res.status(404).json({ status: 'error', message: 'Order not found' });
        }

        if (Number(amount) > Number(order.grand_total || 0)) {
            return res.status(400).json({ status: 'error', message: 'Refund amount exceeds order total' });
        }

        const refund = createRefund({
            orderId,
            amount: Number(amount),
            reason: reason || 'Admin refund',
            adminId: req.adminUser?.id || 'admin'
        });

        // Update order with refund info
        order.refund_status = 'refunded';
        order.refund_amount = (order.refund_amount || 0) + refund.amount;
        await saveOrder(order).catch(() => {});

        logOrderEvent(orderId, 'refund_processed', {
            refund_id: refund.id,
            amount: refund.amount,
            reason: refund.reason
        });

        return res.json({ status: 'ok', data: { refund, order } });
    } catch (error) {
        console.error('[Admin Wholesale] Error processing refund:', error);
        res.status(500).json({ status: 'error', message: error.message });
    }
});

/**
 * GET /api/admin/wholesale/orders/:orderId
 * Get detailed order view for admin
 */
router.get('/orders/:orderId', async (req, res) => {
    try {
        const order = await getOrderById(req.params.orderId, { includeArchived: true });
        if (!order) {
            return res.status(404).json({ status: 'error', message: 'Order not found' });
        }

        const refunds = listRefundsForOrder(order.master_order_id);
        const auditLog = getOrderAuditLog(order.master_order_id);

        return res.json({
            status: 'ok',
            data: {
                order,
                refunds,
                audit_log: auditLog
            }
        });
    } catch (error) {
        console.error('[Admin Wholesale] Error fetching order detail:', error);
        res.status(500).json({ status: 'error', message: error.message });
    }
});

/**
 * PATCH /api/admin/wholesale/orders/:orderId
 * Admin update order (status, notes, delivery date)
 */
router.patch('/orders/:orderId', async (req, res) => {
    try {
        const order = await getOrderById(req.params.orderId, { includeArchived: false });
        if (!order) {
            return res.status(404).json({ status: 'error', message: 'Order not found' });
        }

        const updates = {};

        // Validate status transitions through the state machine
        if (req.body.status !== undefined) {
            try {
                transitionOrderStatus(order, req.body.status);
                updates.status = req.body.status;
            } catch (err) {
                return res.status(409).json({ status: 'error', message: err.message });
            }
        }
        if (req.body.fulfillment_status !== undefined) {
            try {
                transitionFulfillmentStatus(order, req.body.fulfillment_status);
                updates.fulfillment_status = req.body.fulfillment_status;
            } catch (err) {
                return res.status(409).json({ status: 'error', message: err.message });
            }
        }

        // Non-status fields are safe to assign directly
        for (const field of ['delivery_date', 'admin_notes']) {
            if (req.body[field] !== undefined) {
                order[field] = req.body[field];
                updates[field] = req.body[field];
            }
        }

        await saveOrder(order).catch(() => {});
        logOrderEvent(order.master_order_id, 'admin_order_update', {
            ...updates,
            actor: req.adminUser?.id || 'admin'
        });

        return res.json({ status: 'ok', data: { order } });
    } catch (error) {
        console.error('[Admin Wholesale] Error updating order:', error);
        res.status(500).json({ status: 'error', message: error.message });
    }
});

export default router;
