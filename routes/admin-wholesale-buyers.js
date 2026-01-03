import express from 'express';
import bcrypt from 'bcryptjs';
import pg from 'pg';

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

// GET /api/admin/wholesale/buyers - List all wholesale buyers
router.get('/buyers', async (req, res) => {
  try {
    const { page = 1, limit = 50, status, buyerType, search } = req.query;
    
    const offset = (parseInt(page) - 1) * parseInt(limit);
    
    let query = 'SELECT id, business_name, contact_name, email, buyer_type, location, created_at FROM wholesale_buyers WHERE 1=1';
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
      'SELECT id, business_name, contact_name, email, buyer_type, location, created_at FROM wholesale_buyers WHERE id = $1',
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
      `UPDATE wholesale_buyers SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING id, business_name, contact_name, email, buyer_type, location, created_at`,
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

    // TODO: Send email with temporary password
    // await sendPasswordResetEmail(buyer.email, buyer.contact_name, password);

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

// GET /api/admin/wholesale/buyers/search - Search buyers by email, name, or business
router.get('/buyers/search', async (req, res) => {
  try {
    const { q } = req.query;

    if (!q || q.length < 2) {
      return res.status(400).json({ status: 'error', message: 'Search query must be at least 2 characters' });
    }

    const result = await pool.query(
      `SELECT id, business_name, contact_name, email, buyer_type, created_at 
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

export default router;
