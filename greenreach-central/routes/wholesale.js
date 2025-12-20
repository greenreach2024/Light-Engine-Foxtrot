import express from 'express';
import { query } from '../config/database.js';
import { ValidationError } from '../middleware/errorHandler.js';

const router = express.Router();

/**
 * GET /api/wholesale/catalog
 * Get wholesale catalog with optional filtering by farm certifications
 * 
 * Query parameters:
 * - certifications: Array of certification types (GAP, organic, food_safety, greenhouse)
 * - practices: Array of practices (pesticide_free, non_gmo, hydroponic, local, year_round)
 * - attributes: Array of attributes (woman_owned, veteran_owned, minority_owned, family_farm, sustainable)
 * - category: Product category filter
 * - organic: Boolean filter for organic products
 * - minQuantity: Minimum available quantity
 * - page: Page number (default: 1)
 * - limit: Items per page (default: 50, max: 200)
 */
router.get('/catalog', async (req, res, next) => {
  try {
    const {
      certifications,
      practices,
      attributes,
      category,
      organic,
      minQuantity = 0,
      page = 1,
      limit = 50
    } = req.query;

    // Parse array parameters
    const certFilter = certifications ? (Array.isArray(certifications) ? certifications : [certifications]) : [];
    const practicesFilter = practices ? (Array.isArray(practices) ? practices : [practices]) : [];
    const attributesFilter = attributes ? (Array.isArray(attributes) ? attributes : [attributes]) : [];
    
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(200, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    // Build WHERE conditions
    const conditions = [];
    const params = [];
    let paramIndex = 1;

    // Base condition: only active farms with available inventory
    conditions.push('f.status = $' + paramIndex++);
    params.push('active');
    
    conditions.push('i.quantity_available > $' + paramIndex++);
    params.push(minQuantity);

    // Certification filters
    if (certFilter.length > 0) {
      conditions.push(`f.certifications @> $${paramIndex}::jsonb`);
      params.push(JSON.stringify(certFilter));
      paramIndex++;
    }

    // Practices filters
    if (practicesFilter.length > 0) {
      conditions.push(`f.practices @> $${paramIndex}::jsonb`);
      params.push(JSON.stringify(practicesFilter));
      paramIndex++;
    }

    // Attributes filters
    if (attributesFilter.length > 0) {
      conditions.push(`f.attributes @> $${paramIndex}::jsonb`);
      params.push(JSON.stringify(attributesFilter));
      paramIndex++;
    }

    // Product category filter
    if (category) {
      conditions.push('i.category = $' + paramIndex++);
      params.push(category);
    }

    // Organic filter
    if (organic !== undefined) {
      conditions.push('i.source_data->>\'organic\' = $' + paramIndex++);
      params.push(organic === 'true' || organic === true ? 'true' : 'false');
    }

    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    // Get total count
    const countResult = await query(`
      SELECT COUNT(DISTINCT i.id) as total
      FROM farm_inventory i
      JOIN farms f ON i.farm_id = f.farm_id
      ${whereClause}
    `, params);

    const totalItems = parseInt(countResult.rows[0]?.total || 0);
    const totalPages = Math.ceil(totalItems / limitNum);

    // Get paginated catalog items
    params.push(limitNum);
    params.push(offset);

    const catalogResult = await query(`
      SELECT 
        i.id,
        i.product_id,
        i.product_name,
        i.category,
        i.variety,
        i.quantity_available,
        i.quantity_unit,
        i.wholesale_price,
        i.retail_price,
        i.status,
        i.synced_at,
        i.source_data,
        f.farm_id,
        f.name as farm_name,
        f.city,
        f.state,
        f.certifications as farm_certifications,
        f.practices as farm_practices,
        f.attributes as farm_attributes
      FROM farm_inventory i
      JOIN farms f ON i.farm_id = f.farm_id
      ${whereClause}
      ORDER BY i.synced_at DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `, params);

    // Format response
    const items = catalogResult.rows.map(row => ({
      id: row.id,
      productId: row.product_id,
      name: row.product_name,
      category: row.category,
      variety: row.variety,
      quantity: row.quantity_available,
      unit: row.quantity_unit,
      wholesalePrice: parseFloat(row.wholesale_price),
      retailPrice: parseFloat(row.retail_price),
      status: row.status,
      organic: row.source_data?.organic || false,
      harvestDate: row.source_data?.harvestDate,
      shelfLife: row.source_data?.shelfLife,
      images: row.source_data?.images || [],
      certifications: row.source_data?.certifications || [],
      farm: {
        id: row.farm_id,
        name: row.farm_name,
        city: row.city,
        state: row.state,
        certifications: row.farm_certifications || [],
        practices: row.farm_practices || [],
        attributes: row.farm_attributes || []
      },
      lastUpdated: row.synced_at
    }));

    res.json({
      items,
      pagination: {
        page: pageNum,
        limit: limitNum,
        totalItems,
        totalPages
      },
      filters: {
        certifications: certFilter,
        practices: practicesFilter,
        attributes: attributesFilter,
        category,
        organic,
        minQuantity
      }
    });

  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/wholesale/catalog/filters
 * Get available filter options based on current catalog
 */
router.get('/catalog/filters', async (req, res, next) => {
  try {
    // Get all unique certifications, practices, and attributes from active farms
    const result = await query(`
      SELECT 
        COALESCE(jsonb_agg(DISTINCT cert), '[]'::jsonb) as certifications,
        COALESCE(jsonb_agg(DISTINCT practice), '[]'::jsonb) as practices,
        COALESCE(jsonb_agg(DISTINCT attr), '[]'::jsonb) as attributes,
        array_agg(DISTINCT i.category) as categories
      FROM farms f
      LEFT JOIN farm_inventory i ON f.farm_id = i.farm_id
      LEFT JOIN LATERAL jsonb_array_elements_text(f.certifications) cert ON true
      LEFT JOIN LATERAL jsonb_array_elements_text(f.practices) practice ON true
      LEFT JOIN LATERAL jsonb_array_elements_text(f.attributes) attr ON true
      WHERE f.status = 'active'
    `);

    const row = result.rows[0];

    res.json({
      certifications: row.certifications || [],
      practices: row.practices || [],
      attributes: row.attributes || [],
      categories: (row.categories || []).filter(Boolean)
    });

  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/wholesale/farms
 * Get list of farms in wholesale network with their certifications
 */
router.get('/farms', async (req, res, next) => {
  try {
    const { certifications, practices, attributes } = req.query;

    // Parse filters
    const certFilter = certifications ? (Array.isArray(certifications) ? certifications : [certifications]) : [];
    const practicesFilter = practices ? (Array.isArray(practices) ? practices : [practices]) : [];
    const attributesFilter = attributes ? (Array.isArray(attributes) ? attributes : [attributes]) : [];

    // Build WHERE conditions
    const conditions = ['status = $1'];
    const params = ['active'];
    let paramIndex = 2;

    if (certFilter.length > 0) {
      conditions.push(`certifications @> $${paramIndex}::jsonb`);
      params.push(JSON.stringify(certFilter));
      paramIndex++;
    }

    if (practicesFilter.length > 0) {
      conditions.push(`practices @> $${paramIndex}::jsonb`);
      params.push(JSON.stringify(practicesFilter));
      paramIndex++;
    }

    if (attributesFilter.length > 0) {
      conditions.push(`attributes @> $${paramIndex}::jsonb`);
      params.push(JSON.stringify(attributesFilter));
      paramIndex++;
    }

    const whereClause = 'WHERE ' + conditions.join(' AND ');

    const result = await query(`
      SELECT 
        farm_id,
        name,
        city,
        state,
        certifications,
        practices,
        attributes,
        tier,
        last_sync,
        (SELECT COUNT(*) FROM farm_inventory WHERE farm_id = farms.farm_id AND quantity_available > 0) as product_count
      FROM farms
      ${whereClause}
      ORDER BY name
    `, params);

    const farms = result.rows.map(row => ({
      id: row.farm_id,
      name: row.name,
      city: row.city,
      state: row.state,
      certifications: row.certifications || [],
      practices: row.practices || [],
      attributes: row.attributes || [],
      tier: row.tier,
      lastSync: row.last_sync,
      productCount: parseInt(row.product_count) || 0
    }));

    res.json({ farms });

  } catch (error) {
    next(error);
  }
});

export default router;
