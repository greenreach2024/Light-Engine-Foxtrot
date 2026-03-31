import express from 'express';
import bcrypt from 'bcryptjs';
import pg from 'pg';
import { sendEmail } from '../lib/email-service.js';
import { adminAuthMiddleware } from '../server/middleware/admin-auth.js';

const router = express.Router();

// Create database pool
const pool = new pg.Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  user: process.env.DB_USER || 'lightengine',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'lightengine',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Apply admin auth to all admin wholesale routes

// Apply admin auth to all admin wholesale routes
router.use(adminAuthMiddleware);

// GET /api/admin/wholesale/buyers - List all wholesale buyers
router.get('/buyers', async (req, res) => {
  try {
    const { page = 1, limit = 50, status, buyerType, search } = req.query;
    
    const offset = (parseInt(page) - 1) * parseInt(limit);
    
    let query = 'SELECT id, business_name, contact_name, email, buyer_type, location, status, phone, created_at FROM wholesale_buyers WHERE 1=1';
    const params = [];
    let paramIndex = 1;

    if (buyerType) {
      query += ` AND buyer_type = $${paramIndex++}`;
      params.push(buyerType);
    }

    if (search) {
      query += ` AND (business_name ILIKE $${paramIndex} OR contact_name ILIKE $${paramIndex} OR email ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    if (status) {
      query += ` AND status = $${paramIndex++}`;
      params.push(status);
    }

    // Count total
    const countResult = await pool.query(`SELECT COUNT(*) as total FROM (${query}) as filtered`, params);
    const total = parseInt(countResult.rows[0].total);

    // Get paginated results
    query += ` ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(parseInt(limit), offset);

    const result = await pool.query(query, params);

    return res.json({
      status: 'ok',
      data: {
        buyers: result.rows,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit))
        }
      }
    });
  } catch (error) {
    console.error('Admin list buyers error:', error);
    return res.status(500).json({ status: 'error', message: 'Failed to list buyers' });
  }
});

// GET /api/admin/wholesale/buyers/:id - Get single buyer details
router.get('/buyers/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'SELECT id, business_name, contact_name, email, buyer_type, location, status, phone, created_at FROM wholesale_buyers WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Buyer not found' });
    }

    // Get order count for this buyer (when orders table exists)
    // const orderCount = await pool.query('SELECT COUNT(*) as count FROM wholesale_orders WHERE buyer_id = $1', [id]);

    return res.json({
      status: 'ok',
      data: {
        buyer: result.rows[0],
        // orderCount: parseInt(orderCount.rows[0]?.count || 0)
      }
    });
  } catch (error) {
    console.error('Admin get buyer error:', error);
    return res.status(500).json({ status: 'error', message: 'Failed to get buyer' });
  }
});

// PUT /api/admin/wholesale/buyers/:id - Update buyer details
router.put('/buyers/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { businessName, contactName, buyerType, location } = req.body || {};

    const updates = [];
    const params = [];
    let paramIndex = 1;

    if (businessName !== undefined) {
      updates.push(`business_name = $${paramIndex++}`);
      params.push(businessName);
    }

    if (contactName !== undefined) {
      updates.push(`contact_name = $${paramIndex++}`);
      params.push(contactName);
    }

    if (buyerType !== undefined) {
      updates.push(`buyer_type = $${paramIndex++}`);
      params.push(buyerType);
    }

    if (location !== undefined) {
      updates.push(`location = $${paramIndex++}`);
      params.push(JSON.stringify(location));
    }

    if (updates.length === 0) {
      return res.status(400).json({ status: 'error', message: 'No fields to update' });
    }

    params.push(id);

    const result = await pool.query(
      `UPDATE wholesale_buyers SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING id, business_name, contact_name, email, buyer_type, location, status, phone, created_at`,
      params
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Buyer not found' });
    }

    console.log(`[Admin] Updated buyer ID ${id}`);

    return res.json({
      status: 'ok',
      data: { buyer: result.rows[0] }
    });
  } catch (error) {
    console.error('Admin update buyer error:', error);
    return res.status(500).json({ status: 'error', message: 'Failed to update buyer' });
  }
});

// POST /api/admin/wholesale/buyers/:id/reset-password - Admin reset buyer password
router.post('/buyers/:id/reset-password', async (req, res) => {
  try {
    const { id } = req.params;
    const { tempPassword } = req.body || {};

    // Generate temporary password if not provided
    const password = tempPassword || `GR${Math.random().toString(36).slice(2, 10)}!${Date.now().toString(36)}`;

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Update buyer password
    const result = await pool.query(
      'UPDATE wholesale_buyers SET password_hash = $1 WHERE id = $2 RETURNING email, business_name, contact_name',
      [passwordHash, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Buyer not found' });
    }

    const buyer = result.rows[0];

    console.log(`[Admin] Reset password for buyer ID ${id} (${buyer.email})`);

    // Send email with temporary password
    try {
      await sendEmail({
        to: buyer.email,
        subject: 'Your GreenReach Password Has Been Reset',
        text: `Hi ${buyer.contact_name},\n\nYour GreenReach wholesale buyer account password has been reset by an administrator.\n\nYour temporary password is: ${password}\n\nPlease log in and change your password immediately.\n\nLogin at: ${process.env.WHOLESALE_FRONTEND_URL || 'https://greenreachgreens.com'}/wholesale\n\nBest regards,\nThe GreenReach Team`,
        html: `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #2e7d32; color: white; padding: 20px; text-align: center; }
    .content { padding: 20px; background: #f9f9f9; }
    .password-box { background: white; padding: 15px; margin: 20px 0; border-left: 4px solid #2e7d32; font-family: monospace; font-size: 18px; }
    .warning { background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; }
    .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Password Reset</h1>
    </div>
    <div class="content">
      <p>Hi ${buyer.contact_name},</p>
      <p>Your GreenReach wholesale buyer account password has been reset by an administrator.</p>
      
      <div class="password-box">
        <strong>Temporary Password:</strong><br>
        ${password}
      </div>
      
      <div class="warning">
        <strong>⚠️ Important:</strong> Please log in and change your password immediately for security.
      </div>
      
      <p>Login at: <a href="${process.env.WHOLESALE_FRONTEND_URL || 'https://greenreachgreens.com'}/wholesale">${process.env.WHOLESALE_FRONTEND_URL || 'https://greenreachgreens.com'}/wholesale</a></p>
      
      <p>If you didn't request this password reset, please contact support immediately.</p>
      
      <p>Best regards,<br>The GreenReach Team</p>
    </div>
    <div class="footer">
      <p>GreenReach Wholesale Platform</p>
    </div>
  </div>
</body>
</html>
        `
      });

      console.log(`[Admin] Password reset email sent to ${buyer.email}`);
    } catch (emailError) {
      console.error(`[Admin] Failed to send email to ${buyer.email}:`, emailError);
      // Continue - admin still gets the password
    }

    return res.json({
      status: 'ok',
      message: 'Password has been reset',
      data: {
        email: buyer.email,
        // Return temp password only for admin (not to buyer)
        tempPassword: password
      }
    });
  } catch (error) {
    console.error('Admin reset password error:', error);
    return res.status(500).json({ status: 'error', message: 'Failed to reset password' });
  }
});

// DELETE /api/admin/wholesale/buyers/:id - Delete buyer account
router.delete('/buyers/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Check if buyer exists
    const checkResult = await pool.query(
      'SELECT email FROM wholesale_buyers WHERE id = $1',
      [id]
    );

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Buyer not found' });
    }

    // Delete buyer (cascade will delete password reset tokens)
    await pool.query('DELETE FROM wholesale_buyers WHERE id = $1', [id]);

    console.log(`[Admin] Deleted buyer ID ${id} (${checkResult.rows[0].email})`);

    return res.json({
      status: 'ok',
      message: 'Buyer account has been deleted'
    });
  } catch (error) {
    console.error('Admin delete buyer error:', error);
    return res.status(500).json({ status: 'error', message: 'Failed to delete buyer' });
  }
});

// POST /api/admin/wholesale/buyers/:id/deactivate - Deactivate buyer account
router.post('/buyers/:id/deactivate', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      "UPDATE wholesale_buyers SET status = 'deactivated', updated_at = NOW() WHERE id = $1 RETURNING id, email, business_name, status",
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Buyer not found' });
    }

    console.log(`[Admin] Deactivated buyer ID ${id} (${result.rows[0].email})`);

    return res.json({
      status: 'ok',
      message: 'Buyer account deactivated',
      data: { buyer: result.rows[0] }
    });
  } catch (error) {
    console.error('Admin deactivate buyer error:', error);
    return res.status(500).json({ status: 'error', message: 'Failed to deactivate buyer' });
  }
});

// POST /api/admin/wholesale/buyers/:id/reactivate - Reactivate buyer account
router.post('/buyers/:id/reactivate', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      "UPDATE wholesale_buyers SET status = 'active', updated_at = NOW() WHERE id = $1 RETURNING id, email, business_name, status",
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Buyer not found' });
    }

    console.log(`[Admin] Reactivated buyer ID ${id} (${result.rows[0].email})`);

    return res.json({
      status: 'ok',
      message: 'Buyer account reactivated',
      data: { buyer: result.rows[0] }
    });
  } catch (error) {
    console.error('Admin reactivate buyer error:', error);
    return res.status(500).json({ status: 'error', message: 'Failed to reactivate buyer' });
  }
});

// GET /api/admin/wholesale/buyers/search - Search buyers by email, name, or business
router.get('/buyers/search', async (req, res) => {
  try {
    const { q } = req.query;

    if (!q || q.length < 2) {
      return res.status(400).json({ status: 'error', message: 'Search query must be at least 2 characters' });
    }

    const result = await pool.query(
      `SELECT id, business_name, contact_name, email, buyer_type, status, phone, created_at 
       FROM wholesale_buyers 
       WHERE business_name ILIKE $1 OR contact_name ILIKE $1 OR email ILIKE $1
       ORDER BY created_at DESC
       LIMIT 20`,
      [`%${q}%`]
    );

    return res.json({
      status: 'ok',
      data: { buyers: result.rows }
    });
  } catch (error) {
    console.error('Admin search buyers error:', error);
    return res.status(500).json({ status: 'error', message: 'Failed to search buyers' });
  }
});

// POST /api/admin/wholesale/buyers/reset-password - Reset password by email
router.post('/buyers/reset-password', async (req, res) => {
  try {
    const { email, newPassword } = req.body;

    if (!email || !newPassword) {
      return res.status(400).json({ status: 'error', message: 'Email and newPassword required' });
    }

    // Hash the new password
    const passwordHash = await bcrypt.hash(newPassword, 10);

    // Update buyer password by email
    const result = await pool.query(
      'UPDATE wholesale_buyers SET password_hash = $1 WHERE email = $2 RETURNING email, business_name, contact_name',
      [passwordHash, email]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Buyer not found' });
    }

    const buyer = result.rows[0];
    console.log(`[Admin] Reset password for buyer ${buyer.email}`);

    // Send confirmation email
    try {
      await sendEmail({
        to: buyer.email,
        subject: 'Your GreenReach Password Has Been Reset',
        text: `Hi ${buyer.contact_name},\n\nYour GreenReach wholesale buyer account password has been reset by an administrator.\n\nPlease log in with your new password.\n\nLogin at: ${process.env.WHOLESALE_FRONTEND_URL || 'https://greenreachgreens.com'}/GR-wholesale.html\n\nBest regards,\nThe GreenReach Team`
      });
    } catch (emailError) {
      console.error('Failed to send reset confirmation email:', emailError);
    }

    return res.json({
      status: 'ok',
      message: 'Password reset successfully'
    });
  } catch (error) {
    console.error('Admin reset password error:', error);
    return res.status(500).json({ status: 'error', message: 'Failed to reset password' });
  }
});

// GET /api/admin/wholesale/orders - List all wholesale orders (from PostgreSQL)
router.get('/orders', async (req, res) => {
  try {
    const { page = 1, limit = 50, includeArchived } = req.query;
    const result = await pool.query(
      'SELECT order_data FROM wholesale_orders ORDER BY created_at DESC'
    );
    const orders = result.rows
      .map(row => row.order_data)
      .filter(Boolean);

    const total = orders.length;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const paged = orders.slice(offset, offset + parseInt(limit));

    return res.json({
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
    console.error('[Admin Wholesale] Error fetching orders:', error.message);
    return res.status(500).json({
      status: 'error',
      error: 'Failed to fetch orders',
      message: error.message
    });
  }
});

// GET /api/admin/wholesale/dashboard - Wholesale dashboard summary
router.get('/dashboard', async (req, res) => {
  try {
    let buyersCount = 0;
    try {
      const buyersResult = await pool.query('SELECT COUNT(*) as count FROM wholesale_buyers');
      buyersCount = parseInt(buyersResult.rows[0]?.count || 0);
    } catch (_) {}

    const ordersResult = await pool.query('SELECT order_data FROM wholesale_orders ORDER BY created_at DESC');
    const orders = ordersResult.rows.map(row => row.order_data).filter(Boolean);
    const totalOrders = orders.length;
    const totalRevenue = orders.reduce((sum, order) => sum + Number(order.grand_total || 0), 0);
    const activeFarms = new Set(
      orders.flatMap((order) => (order.farm_sub_orders || []).map((sub) => sub.farm_id))
    ).size;

    return res.json({
      status: 'ok',
      data: {
        totalBuyers: buyersCount,
        totalOrders,
        totalRevenue,
        activeFarms
      }
    });
  } catch (error) {
    console.error('[Admin Wholesale] Error fetching dashboard:', error.message);
    return res.status(500).json({
      status: 'error',
      error: 'Failed to fetch dashboard data',
      message: error.message
    });
  }
});

// GET /api/admin/wholesale/audit-log - Wholesale audit log
router.get('/audit-log', async (req, res) => {
  try {
    const { orderId } = req.query;
    if (!orderId) {
      return res.status(400).json({ status: 'error', message: 'orderId query param required' });
    }
    // Attempt to read audit log from PostgreSQL
    try {
      const result = await pool.query(
        'SELECT * FROM wholesale_audit_log WHERE order_id = $1 ORDER BY created_at DESC',
        [orderId]
      );
      return res.json({ status: 'ok', data: { events: result.rows } });
    } catch (_) {
      return res.json({ status: 'ok', data: { events: [] } });
    }
  } catch (error) {
    console.error('[Admin Wholesale] Error fetching audit log:', error.message);
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

export default router;
