import express from 'express';
import { query } from '../config/database.js';

const router = express.Router();

/**
 * GET /api/admin/wholesale/buyers
 * Get list of all wholesale buyers
 */
router.get('/buyers', async (req, res) => {
    try {
        const { page = 1, limit = 50, buyerType, search } = req.query;
        
        // Build query
        let sqlQuery = `
            SELECT id, business_name, contact_name, email, buyer_type, 
                   location, created_at 
            FROM wholesale_buyers 
            WHERE 1=1
        `;
        const params = [];
        let paramCount = 0;
        
        // Add filters
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
        
        // Get total count
        const countQuery = `SELECT COUNT(*) as total FROM (${sqlQuery}) as filtered`;
        const countResult = await query(countQuery, params);
        const total = parseInt(countResult.rows[0]?.total || 0);
        
        // Add pagination
        sqlQuery += ` ORDER BY created_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
        params.push(parseInt(limit));
        params.push((parseInt(page) - 1) * parseInt(limit));
        
        // Get buyers
        const result = await query(sqlQuery, params);
        
        res.json({
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
        console.error('[Admin Wholesale] Error fetching buyers:', error);
        res.status(500).json({
            status: 'error',
            error: 'Failed to fetch buyers',
            message: error.message
        });
    }
});

/**
 * POST /api/admin/wholesale/buyers/reset-password
 * Reset buyer password (admin function)
 */
router.post('/buyers/reset-password', async (req, res) => {
    try {
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
        const bcrypt = await import('bcryptjs');
        const passwordHash = await bcrypt.hash(newPassword, 10);
        
        // Update buyer password
        const result = await query(
            'UPDATE wholesale_buyers SET password_hash = $1, updated_at = NOW() WHERE email = $2 RETURNING id',
            [passwordHash, email]
        );
        
        if (result.rows.length === 0) {
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
 * Get list of all wholesale orders (stub for now)
 */
router.get('/orders', async (req, res) => {
    try {
        // Return empty array for now - orders functionality to be implemented
        res.json({
            status: 'ok',
            data: {
                orders: [],
                pagination: {
                    page: 1,
                    limit: 50,
                    total: 0,
                    pages: 0
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
 * Get wholesale dashboard summary (stub for now)
 */
router.get('/dashboard', async (req, res) => {
    try {
        // Return basic stats for now
        const buyersResult = await query('SELECT COUNT(*) as count FROM wholesale_buyers');
        const buyersCount = parseInt(buyersResult.rows[0]?.count || 0);
        
        res.json({
            status: 'ok',
            data: {
                totalBuyers: buyersCount,
                totalOrders: 0,
                totalRevenue: 0,
                activeFarms: 0
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

export default router;
