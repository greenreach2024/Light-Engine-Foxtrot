import express from 'express';
import { query } from '../config/database.js';
import logger from '../utils/logger.js';

const router = express.Router();

/**
 * GET /api/admin/farms
 * List all registered farms with latest status
 */
router.get('/farms', async (req, res, next) => {
  try {
    const { status, page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;

    // Build query
    let queryText = `
      SELECT 
        f.farm_id,
        f.name,
        f.status,
        f.email,
        f.phone,
        f.address_line1,
        f.city,
        f.state,
        f.postal_code,
        f.country,
        f.latitude,
        f.longitude,
        f.tier,
        f.created_at,
        f.last_heartbeat,
        COUNT(DISTINCT i.product_id) as product_count
      FROM farms f
      LEFT JOIN farm_inventory i ON f.id = i.farm_id
    `;

    const params = [];
    const conditions = [];

    if (status) {
      conditions.push(`f.status = $${params.length + 1}`);
      params.push(status);
    }

    if (conditions.length > 0) {
      queryText += ' WHERE ' + conditions.join(' AND ');
    }

    queryText += `
      GROUP BY f.farm_id, f.name, f.status, f.email, f.phone, 
               f.address_line1, f.city, f.state, f.postal_code, f.country,
               f.latitude, f.longitude, f.tier, f.created_at, f.last_heartbeat
      ORDER BY f.created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;

    params.push(limit, offset);

    const result = await query(queryText, params);

    // Get total count
    let countQuery = 'SELECT COUNT(*) FROM farms';
    if (conditions.length > 0) {
      countQuery += ' WHERE ' + conditions.join(' AND ');
    }
    const countResult = await query(countQuery, params.slice(0, -2));
    const total = parseInt(countResult.rows[0].count);

    res.json({
      farms: result.rows.map(farm => ({
        farmId: farm.farm_id,
        name: farm.name,
        status: farm.status,
        email: farm.email,
        phone: farm.phone,
        address: {
          line1: farm.address_line1,
          city: farm.city,
          state: farm.state,
          postalCode: farm.postal_code,
          country: farm.country
        },
        location: farm.latitude && farm.longitude ? {
          lat: parseFloat(farm.latitude),
          lng: parseFloat(farm.longitude)
        } : null,
        tier: farm.tier,
        productCount: parseInt(farm.product_count) || 0,
        lastHeartbeat: farm.last_heartbeat,
        createdAt: farm.created_at
      })),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    logger.error('Error fetching farms', { error: error.message });
    next(error);
  }
});

/**
 * GET /api/admin/farms/:id
 * Get detailed farm information
 */
router.get('/farms/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    const result = await query(`
      SELECT 
        f.*,
        COUNT(DISTINCT i.product_id) as product_count,
        COUNT(DISTINCT r.room_id) as room_count,
        SUM(i.quantity_available) as total_inventory_items
      FROM farms f
      LEFT JOIN farm_inventory i ON f.id = i.farm_id
      LEFT JOIN rooms r ON f.farm_id = r.farm_id
      WHERE f.farm_id = $1
      GROUP BY f.farm_id
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Not Found',
        message: `Farm ${id} not found`
      });
    }

    const farm = result.rows[0];

    res.json({
      farmId: farm.farm_id,
      name: farm.name,
      legalName: farm.legal_name,
      status: farm.status,
      email: farm.email,
      phone: farm.phone,
      address: {
        line1: farm.address_line1,
        line2: farm.address_line2,
        city: farm.city,
        state: farm.state,
        postalCode: farm.postal_code,
        country: farm.country
      },
      location: farm.latitude && farm.longitude ? {
        lat: parseFloat(farm.latitude),
        lng: parseFloat(farm.longitude)
      } : null,
      contactName: farm.contact_name,
      tier: farm.tier,
      registrationCode: farm.registration_code,
      apiKey: farm.api_key,
      stats: {
        productCount: parseInt(farm.product_count) || 0,
        roomCount: parseInt(farm.room_count) || 0,
        totalInventoryItems: parseInt(farm.total_inventory_items) || 0
      },
      lastHeartbeat: farm.last_heartbeat,
      createdAt: farm.created_at,
      updatedAt: farm.updated_at
    });

  } catch (error) {
    logger.error('Error fetching farm details', { farmId: req.params.id, error: error.message });
    next(error);
  }
});

/**
 * GET /api/admin/analytics/aggregate
 * Get aggregated analytics across all farms
 */
router.get('/analytics/aggregate', async (req, res, next) => {
  try {
    // Get farm count by status
    const farmStats = await query(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN status = 'active' THEN 1 END) as active,
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
        COUNT(CASE WHEN last_heartbeat > NOW() - INTERVAL '5 minutes' THEN 1 END) as online
      FROM farms
    `);

    // Get inventory stats
    const inventoryStats = await query(`
      SELECT 
        SUM(quantity_available) as total_items,
        COUNT(DISTINCT product_id) as total_products,
        COUNT(DISTINCT farm_id) as farms_with_inventory
      FROM farm_inventory
    `);

    res.json({
      farms: {
        total: parseInt(farmStats.rows[0].total),
        active: parseInt(farmStats.rows[0].active),
        pending: parseInt(farmStats.rows[0].pending),
        online: parseInt(farmStats.rows[0].online)
      },
      inventory: {
        totalItems: parseInt(inventoryStats.rows[0].total_items) || 0,
        totalProducts: parseInt(inventoryStats.rows[0].total_products) || 0,
        farmsWithInventory: parseInt(inventoryStats.rows[0].farms_with_inventory) || 0
      }
    });

  } catch (error) {
    logger.error('Error fetching aggregate analytics', { error: error.message });
    next(error);
  }
});

export default router;
