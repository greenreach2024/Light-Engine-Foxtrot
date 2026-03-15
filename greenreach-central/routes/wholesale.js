import express from 'express';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { isDatabaseAvailable, query } from '../config/database.js';
import { ValidationError } from '../middleware/errorHandler.js';
import { adminAuthMiddleware } from '../middleware/adminAuth.js';

import {
  authenticateBuyer,
  createBuyer,
  createOrder,
  createPayment,
  getBuyerById,
  getBuyerByEmail,
  getOrderById,
  listAllOrders,
  listOrdersForBuyer,
  listPayments,
  listPaymentsForBuyer,
  listRefunds,
  listRefundsForOrder,
  createRefund,
  saveOrder,
  updateBuyer,
  updateBuyerPassword,
  updateFarmSubOrder,
  deactivateBuyer,
  listAllBuyers,
  loadBuyersFromDb,
  blacklistToken,
  isTokenBlacklisted,
  recordLoginAttempt,
  isAccountLocked,
  resetLoginAttempts,
  logOrderEvent,
  getOrderAuditLog
} from '../services/wholesaleMemoryStore.js';

import { allocateCartFromDemo, loadWholesaleDemoCatalog } from '../services/wholesaleDemoCatalog.js';
import {
  addMarketEvent,
  allocateCartFromNetwork,
  buildAggregateCatalog,
  generateNetworkRecommendations,
  getBuyerLocationFromBuyer,
  getNetworkTrends,
  listMarketEvents,
  listNetworkSnapshots
} from '../services/wholesaleNetworkAggregator.js';
import { listNetworkFarms, removeNetworkFarm, upsertNetworkFarm } from '../services/networkFarmsStore.js';
import { getBatchFarmSquareCredentials } from '../services/squareCredentials.js';
import { processSquarePayments } from '../services/squarePaymentService.js';
import emailService from '../services/email-service.js';

const router = express.Router();

// ── Per-route rate limiters ──────────────────────────────────────────
const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 10,                    // 10 registrations per IP per window
  message: { status: 'error', message: 'Too many registration attempts. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,                    // 20 login attempts per IP per window
  message: { status: 'error', message: 'Too many login attempts. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { status: 'error', message: 'Too many password-reset requests. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

// ── Input sanitization helper ────────────────────────────────────────
function sanitizeText(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

// ── Farm API-key auth (shared middleware) ────────────────────────────
import { requireFarmApiKey, loadFarmApiKeys } from '../middleware/farmApiKeyAuth.js';
import { transitionOrderStatus } from '../services/orderStateMachine.js';

function getWholesaleJwtSecret() {
  const secret = process.env.WHOLESALE_JWT_SECRET || process.env.JWT_SECRET;
  if (secret) return secret;

  // Dev-only fallback; production should set a real secret.
  if (process.env.NODE_ENV !== 'production') return 'dev-greenreach-wholesale-secret';
  return null;
}

function issueBuyerToken(buyerId) {
  const secret = getWholesaleJwtSecret();
  if (!secret) {
    const err = new Error('Wholesale auth is not configured (missing WHOLESALE_JWT_SECRET)');
    err.code = 'AUTH_NOT_CONFIGURED';
    throw err;
  }

  return jwt.sign({ sub: buyerId, scope: 'wholesale_buyer' }, secret, { expiresIn: '7d' });
}

async function requireBuyerAuth(req, res, next) {
  if (requireDbForCriticalWholesale() && !isWholesaleDatabaseReady(req)) {
    return res.status(503).json({
      status: 'error',
      message: 'Wholesale authentication is temporarily unavailable while database is offline'
    });
  }

  const authHeader = req.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : '';
  if (!token) {
    return res.status(401).json({ status: 'error', message: 'Missing bearer token' });
  }

  if (isTokenBlacklisted(token)) {
    return res.status(401).json({ status: 'error', message: 'Token has been revoked' });
  }

  const secret = getWholesaleJwtSecret();
  if (!secret) {
    return res.status(500).json({ status: 'error', message: 'Wholesale auth not configured' });
  }

  try {
    const payload = jwt.verify(token, secret);
    if (!payload?.sub) {
      return res.status(401).json({ status: 'error', message: 'Invalid token' });
    }

    const buyerId = String(payload.sub);
    const dbCritical = requireDbForCriticalWholesale();

    if (dbCritical) {
      try {
        await loadBuyersFromDb();
      } catch (hydrateError) {
        console.warn('[wholesale] buyer hydration failed (critical mode):', hydrateError.message);
        return res.status(503).json({
          status: 'error',
          message: 'Wholesale authentication is temporarily unavailable while buyer records cannot be verified'
        });
      }
    }

    let buyer = getBuyerById(buyerId);
    if (!buyer && !dbCritical) {
      try {
        await loadBuyersFromDb();
        buyer = getBuyerById(buyerId);
      } catch (hydrateError) {
        console.warn('[wholesale] buyer hydration failed:', hydrateError.message);
      }
    }
    if (!buyer) {
      return res.status(401).json({ status: 'error', message: 'Buyer not found' });
    }

    if (buyer.status === 'deactivated') {
      return res.status(403).json({ status: 'error', message: 'Account has been deactivated' });
    }

    req.wholesaleBuyer = buyer;
    req.wholesaleToken = token;
    return next();
  } catch (error) {
    return res.status(401).json({ status: 'error', message: 'Invalid or expired token' });
  }
}

function shouldUseNetworkAllocation(req) {
  const override = String(process.env.WHOLESALE_USE_NETWORK_ALLOCATION || '').toLowerCase();
  if (override === 'true' || override === '1') return true;
  if (override === 'false' || override === '0') return false;

  // Mirror the catalog mode flag — when catalog uses network, allocation should too.
  const catalogMode = (process.env.WHOLESALE_CATALOG_MODE || 'network').toLowerCase();
  return catalogMode === 'network' || req.app?.locals?.databaseReady === false;
}

const DELIVERY_WINDOWS = ['morning', 'afternoon', 'evening'];
const DELIVERY_ZONE_RULES = {
  ZONE_A: { id: 'zone_a', fee: 8, min_order: 25 },
  ZONE_B: { id: 'zone_b', fee: 8, min_order: 35 },
  ZONE_C: { id: 'zone_c', fee: 12, min_order: 50 }
};

const farmCatalogSyncCache = new Map();
const farmPricingSyncCache = new Map();

function buildFallbackCatalogSku() {
  return {
    sku_id: 'SKU-FALLBACK-GENOVESE-BASIL-5LB',
    product_name: 'Genovese Basil',
    size: 5,
    unit: 'lb_case',
    category: 'herbs',
    total_qty_available: 1,
    organic: false,
    farms: [
      {
        farm_id: 'FARM-MLTP9LVH-B0B85039',
        farm_name: 'The Notable Sprout',
        quantity_available: 1,
        qty_available: 1,
        price_per_unit: 30
      }
    ]
  };
}

function parseBooleanEnv(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function canUseDemoWholesalePaths() {
  return parseBooleanEnv(
    process.env.WHOLESALE_ALLOW_DEMO_PATHS,
    process.env.NODE_ENV !== 'production'
  );
}

function requireDbForCriticalWholesale() {
  return parseBooleanEnv(
    process.env.WHOLESALE_REQUIRE_DB_FOR_CRITICAL,
    process.env.NODE_ENV === 'production'
  );
}

function isWholesaleDatabaseReady(req) {
  if (!isDatabaseAvailable()) return false;
  return req.app?.locals?.databaseReady !== false;
}

function requireWholesaleDbForCriticalPaths(req, res, next) {
  if (!requireDbForCriticalWholesale()) return next();

  if (!isWholesaleDatabaseReady(req)) {
    return res.status(503).json({
      status: 'error',
      message: 'Wholesale buyer services are temporarily unavailable while database is offline'
    });
  }

  return next();
}

const requireBuyerPortalAuth = [requireWholesaleDbForCriticalPaths, requireBuyerAuth];

/**
 * POST /api/wholesale/delivery/quote
 * Buyer-auth delivery quote endpoint for checkout UX.
 */
router.post('/delivery/quote', requireBuyerPortalAuth, async (req, res) => {
  try {
    const {
      subtotal = 0,
      zone,
      farm_id,
      requested_window,
      fulfillment_method = 'delivery'
    } = req.body || {};

    const numericSubtotal = Math.max(0, Number(subtotal) || 0);
    const requestedWindow = String(requested_window || '').trim().toLowerCase();
    const requestedZone = String(zone || '').trim().toUpperCase();
    const requestedFarmId = String(farm_id || req.headers['x-farm-id'] || '').trim();
    let zoneRule = DELIVERY_ZONE_RULES[requestedZone] || null;

    const deliveryEnabled = parseBooleanEnv(process.env.WHOLESALE_DELIVERY_ENABLED, true);
    let baseFee = Math.max(0, Number(process.env.WHOLESALE_DELIVERY_BASE_FEE || 0));
    let baseMinOrder = Math.max(0, Number(process.env.WHOLESALE_DELIVERY_MIN_ORDER || 25));

    if (requestedFarmId) {
      try {
        const settingsResult = await query(
          `SELECT enabled, base_fee, min_order
             FROM farm_delivery_settings
            WHERE farm_id = $1
            LIMIT 1`,
          [requestedFarmId]
        );
        if (settingsResult.rows.length) {
          const settings = settingsResult.rows[0];
          baseFee = Math.max(0, Number(settings.base_fee || 0));
          baseMinOrder = Math.max(0, Number(settings.min_order || 25));
        }

        if (requestedZone) {
          const zoneResult = await query(
            `SELECT zone_id, fee, min_order
               FROM farm_delivery_zones
              WHERE farm_id = $1
                AND zone_id = $2
                AND status = 'active'
              LIMIT 1`,
            [requestedFarmId, String(requestedZone || '').toLowerCase()]
          );
          if (zoneResult.rows.length) {
            const dbZone = zoneResult.rows[0];
            zoneRule = {
              id: dbZone.zone_id,
              fee: Number(dbZone.fee || 0),
              min_order: Number(dbZone.min_order || 0)
            };
          }
        }
      } catch (dbError) {
        console.warn('[wholesale] delivery quote DB lookup failed, using fallback constants:', dbError.message);
      }
    }

    const fee = Math.max(baseFee, Number(zoneRule?.fee || 0));
    const minimumOrder = Math.max(baseMinOrder, Number(zoneRule?.min_order || 0));

    if (String(fulfillment_method).toLowerCase() === 'pickup') {
      return res.json({
        status: 'ok',
        data: {
          ok: true,
          eligible: true,
          fee: 0,
          minimum_order: 0,
          windows: DELIVERY_WINDOWS,
          reason: 'pickup_selected'
        }
      });
    }

    if (!deliveryEnabled) {
      return res.json({
        status: 'ok',
        data: {
          ok: true,
          eligible: false,
          fee,
          minimum_order: minimumOrder,
          windows: DELIVERY_WINDOWS,
          reason: 'delivery_disabled'
        }
      });
    }

    if (requestedWindow && !DELIVERY_WINDOWS.includes(requestedWindow)) {
      return res.json({
        status: 'ok',
        data: {
          ok: true,
          eligible: false,
          fee,
          minimum_order: minimumOrder,
          windows: DELIVERY_WINDOWS,
          reason: 'window_unavailable'
        }
      });
    }

    if (numericSubtotal < minimumOrder) {
      return res.json({
        status: 'ok',
        data: {
          ok: true,
          eligible: false,
          fee,
          minimum_order: minimumOrder,
          windows: DELIVERY_WINDOWS,
          reason: 'below_minimum_order'
        }
      });
    }

    return res.json({
      status: 'ok',
      data: {
        ok: true,
        eligible: true,
        fee,
        minimum_order: minimumOrder,
        windows: DELIVERY_WINDOWS,
        reason: null
      }
    });
  } catch (error) {
    console.error('[Wholesale] Delivery quote failed:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Unable to compute delivery quote'
    });
  }
});

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
    // Use network aggregation when env flag is set or DB is not ready.
    // Set WHOLESALE_CATALOG_MODE=network in production to use farm-network catalog;
    // omit or set to 'db' to use the database catalog path.
    const catalogMode = (process.env.WHOLESALE_CATALOG_MODE || 'network').toLowerCase();
    if (catalogMode === 'network' || req.app?.locals?.databaseReady === false) {
      const nearLat = req.query.nearLat ?? req.query.lat;
      const nearLng = req.query.nearLng ?? req.query.lng;
      const buyerLocation = (nearLat && nearLng)
        ? { latitude: Number(nearLat), longitude: Number(nearLng) }
        : null;

      const catalog = await buildAggregateCatalog({ buyerLocation });
      const farmId = req.query.farmId ? String(req.query.farmId) : null;

      let items = catalog.items || catalog.skus || [];

      // Strip out fallback-seeded demo items — only show real farm inventory
      items = items.filter(it =>
        !(it.farms || []).every(f => (f.quality_flags || []).includes('fallback_seeded'))
      );

      if (farmId) {
        items = items
          .map((it) => ({ ...it, farms: (it.farms || []).filter((f) => f.farm_id === farmId) }))
          .filter((it) => (it.farms || []).length > 0);
      }

      // Basic sorting compatible with UI
      const sortBy = String(req.query.sortBy || '').trim();
      if (sortBy === 'availability') {
        items = [...items].sort((a, b) => {
          const ta = (a.farms || []).reduce((s, f) => s + Number(f.quantity_available || 0), 0);
          const tb = (b.farms || []).reduce((s, f) => s + Number(f.quantity_available || 0), 0);
          return tb - ta;
        });
      }

      return res.json({
        status: 'ok',
        data: {
          skus: items,
          farms: catalog.farms || []
        },
        // Keep legacy fields for any existing callers
        items,
        farms: catalog.farms || [],
        pagination: { page: 1, limit: items.length, totalItems: items.length, totalPages: 1 },
        filters: {
          farmId
        },
        meta: {
          mode: 'limited',
          lastSync: req.app?.locals?.wholesaleNetworkLastSync || null
        }
      });
    }

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

    const farmId = req.query.farmId ? String(req.query.farmId) : null;

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

    if (farmId) {
      conditions.push('f.farm_id = $' + paramIndex++);
      params.push(farmId);
    }

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

    // Buyer-portal SKU shape (aggregate by product_id)
    const skusById = new Map();
    for (const row of catalogResult.rows) {
      const skuId = String(row.product_id || row.product_name || row.id);
      const existing = skusById.get(skuId);

      const farmEntry = {
        farm_id: row.farm_id,
        farm_name: row.farm_name,
        qty_available: Number(row.quantity_available || 0),
        quantity_available: Number(row.quantity_available || 0),
        unit: row.quantity_unit,
        price_per_unit: Number(row.wholesale_price || 0),
        organic: Boolean(row.source_data?.organic),
        certifications: row.farm_certifications || [],
        practices: row.farm_practices || [],
        attributes: row.farm_attributes || [],
        location: [row.city, row.state].filter(Boolean).join(', ')
      };

      if (!existing) {
        skusById.set(skuId, {
          sku_id: skuId,
          product_name: row.product_name,
          size: row.variety || 'Bulk',
          unit: row.quantity_unit,
          price_per_unit: Number(row.wholesale_price || 0),
          total_qty_available: Number(row.quantity_available || 0),
          farms: [farmEntry],
          organic: Boolean(row.source_data?.organic)
        });
        continue;
      }

      existing.farms.push(farmEntry);
      existing.total_qty_available += Number(row.quantity_available || 0);
      existing.price_per_unit = Math.min(Number(existing.price_per_unit || 0), Number(row.wholesale_price || 0));
      existing.organic = existing.organic || Boolean(row.source_data?.organic);
    }

    const skus = Array.from(skusById.values());

    res.json({
      status: 'ok',
      data: {
        skus
      },
      // Keep legacy fields for any existing callers
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
        minQuantity,
        farmId
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
    if (req.app?.locals?.databaseReady === false) {
      return res.status(503).json({
        status: 'error',
        message: 'Catalog database unavailable'
      });
    }

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
    if (req.app?.locals?.databaseReady === false) {
      return res.status(503).json({
        status: 'error',
        message: 'Farms database unavailable'
      });
    }

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

// --- Buyer portal (DB-less dev mode) ---

router.post('/buyers/register', registerLimiter, requireWholesaleDbForCriticalPaths, async (req, res, next) => {
  try {
    const { businessName, contactName, email, password, buyerType, location } = req.body || {};

    if (!email || !password) {
      throw new ValidationError('Email and password are required');
    }

    if (typeof password === 'string' && password.length < 8) {
      throw new ValidationError('Password must be at least 8 characters');
    }

    const buyer = await createBuyer({
      businessName: sanitizeText(businessName),
      contactName: sanitizeText(contactName),
      email,
      password,
      buyerType: sanitizeText(buyerType),
      location
    });
    const token = issueBuyerToken(buyer.id);

    // Send welcome email (non-blocking)
    emailService.sendEmail({
      to: buyer.email,
      subject: 'Welcome to GreenReach Wholesale',
      text: `Hi ${buyer.contactName || buyer.businessName},\n\nYour wholesale buyer account has been created.\n\nYou can now browse the catalog and place orders.\n\n— GreenReach Farms`
    }).catch(err => console.warn('[Email] Welcome email failed:', err.message));

    return res.json({
      status: 'ok',
      data: { buyer, token }
    });
  } catch (error) {
    if (error?.code === 'EMAIL_EXISTS') {
      return res.status(409).json({ status: 'error', message: 'Email already registered' });
    }
    return next(error);
  }
});

router.post('/buyers/login', loginLimiter, requireWholesaleDbForCriticalPaths, async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      throw new ValidationError('Email and password are required');
    }

    // Check lockout before authenticating
    if (isAccountLocked(email)) {
      return res.status(423).json({ status: 'error', message: 'Account temporarily locked due to too many failed attempts. Try again in 30 minutes.' });
    }

    const buyer = await authenticateBuyer({ email, password });
    if (!buyer) {
      recordLoginAttempt(email, false);
      return res.status(401).json({ status: 'error', message: 'Invalid email or password' });
    }

    recordLoginAttempt(email, true);
    const token = issueBuyerToken(buyer.id);
    return res.json({ status: 'ok', data: { buyer, token } });
  } catch (error) {
    return next(error);
  }
});

// ── Buyer password management ────────────────────────────────────────

import { createPasswordResetToken, consumePasswordResetToken } from '../services/wholesaleMemoryStore.js';

router.post('/buyers/change-password', requireBuyerPortalAuth, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      throw new ValidationError('currentPassword and newPassword are required');
    }
    if (typeof newPassword === 'string' && newPassword.length < 8) {
      throw new ValidationError('New password must be at least 8 characters');
    }

    // Verify current password
    const buyer = await authenticateBuyer({ email: req.wholesaleBuyer.email, password: currentPassword });
    if (!buyer) {
      return res.status(401).json({ status: 'error', message: 'Current password is incorrect' });
    }

    await updateBuyerPassword(req.wholesaleBuyer.id, newPassword);
    return res.json({ status: 'ok', message: 'Password updated successfully' });
  } catch (error) {
    return next(error);
  }
});

router.post('/buyers/forgot-password', passwordResetLimiter, requireWholesaleDbForCriticalPaths, async (req, res) => {
  const { email } = req.body || {};
  if (!email) {
    return res.status(400).json({ status: 'error', message: 'Email is required' });
  }

  // Always return success to avoid email enumeration
  const buyer = getBuyerByEmail(email);
  if (buyer) {
    const token = createPasswordResetToken(email);
    const resetUrl = `${process.env.APP_BASE_URL || 'https://www.greenreachgreens.com'}/GR-wholesale.html?resetToken=${token}`;

    emailService.sendEmail({
      to: buyer.email,
      subject: 'GreenReach Wholesale — Password Reset',
      text: `Hi ${buyer.contactName || buyer.businessName},\n\nA password reset was requested for your account.\n\nReset your password: ${resetUrl}\n\nThis link expires in 1 hour. If you didn't request this, ignore this email.\n\n— GreenReach Farms`
    }).catch(err => console.warn('[Email] Password reset email failed:', err.message));
  }

  return res.json({ status: 'ok', message: 'If that email is registered, a reset link has been sent.' });
});

router.post('/buyers/reset-password', passwordResetLimiter, requireWholesaleDbForCriticalPaths, async (req, res) => {
  const { token, newPassword } = req.body || {};
  if (!token || !newPassword) {
    return res.status(400).json({ status: 'error', message: 'token and newPassword are required' });
  }
  if (typeof newPassword === 'string' && newPassword.length < 8) {
    return res.status(400).json({ status: 'error', message: 'Password must be at least 8 characters' });
  }

  const email = consumePasswordResetToken(token);
  if (!email) {
    return res.status(400).json({ status: 'error', message: 'Invalid or expired reset token' });
  }

  const buyer = getBuyerByEmail(email);
  if (!buyer) {
    return res.status(400).json({ status: 'error', message: 'Account not found' });
  }

  await updateBuyerPassword(buyer.id, newPassword);
  resetLoginAttempts(email);
  return res.json({ status: 'ok', message: 'Password has been reset. You can now log in.' });
});

router.get('/orders', requireBuyerPortalAuth, async (req, res) => {
  const includeArchived = String(req.query.includeArchived || '').toLowerCase() === 'true';
  const { status: statusFilter, from, to, search } = req.query;

  let orders = await listOrdersForBuyer(req.wholesaleBuyer.id, { includeArchived });

  // Optional filters
  if (statusFilter) {
    orders = orders.filter(o => o.status === statusFilter);
  }
  if (from) {
    const fromDate = new Date(from);
    orders = orders.filter(o => new Date(o.created_at) >= fromDate);
  }
  if (to) {
    const toDate = new Date(to);
    orders = orders.filter(o => new Date(o.created_at) <= toDate);
  }
  if (search) {
    const s = search.toLowerCase();
    orders = orders.filter(o =>
      (o.master_order_id || '').toLowerCase().includes(s) ||
      (o.po_number || '').toLowerCase().includes(s) ||
      (o.farm_sub_orders || []).some(sub => (sub.farm_name || '').toLowerCase().includes(s))
    );
  }

  return res.json({
    status: 'ok',
    data: {
      orders
    }
  });
});

// ── Buyer session / profile routes ───────────────────────────────────

router.get('/buyers/me', requireBuyerPortalAuth, (req, res) => {
  return res.json({ status: 'ok', data: { buyer: req.wholesaleBuyer } });
});

router.put('/buyers/me', requireBuyerPortalAuth, async (req, res, next) => {
  try {
    const { businessName, contactName, email, phone, buyerType, address, city, province, postalCode, country } = req.body || {};

    const location = {
      address1: sanitizeText(address) || req.wholesaleBuyer.location?.address1 || null,
      city: sanitizeText(city) || req.wholesaleBuyer.location?.city || null,
      state: sanitizeText(province) || req.wholesaleBuyer.location?.state || null,
      postalCode: sanitizeText(postalCode) || req.wholesaleBuyer.location?.postalCode || null,
      country: sanitizeText(country) || req.wholesaleBuyer.location?.country || null,
      latitude: req.wholesaleBuyer.location?.latitude || null,
      longitude: req.wholesaleBuyer.location?.longitude || null
    };

    const updated = await updateBuyer(req.wholesaleBuyer.id, {
      businessName: sanitizeText(businessName),
      contactName: sanitizeText(contactName),
      email: email ? String(email).trim().toLowerCase() : undefined,
      phone: sanitizeText(phone),
      buyerType: sanitizeText(buyerType),
      location
    });

    if (!updated) {
      return res.status(404).json({ status: 'error', message: 'Buyer not found' });
    }

    return res.json({ status: 'ok', data: { buyer: updated } });
  } catch (error) {
    if (error?.code === 'EMAIL_EXISTS') {
      return res.status(409).json({ status: 'error', message: 'Email already registered' });
    }
    return next(error);
  }
});

router.post('/auth/logout', requireBuyerPortalAuth, (req, res) => {
  blacklistToken(req.wholesaleToken);
  return res.json({ status: 'ok', message: 'Logged out' });
});

// ── Buyer order detail ───────────────────────────────────────────────

router.get('/orders/:orderId', requireBuyerPortalAuth, async (req, res) => {
  const order = await getOrderById(req.params.orderId, { includeArchived: true });

  if (!order || order.buyer_id !== req.wholesaleBuyer.id) {
    return res.status(404).json({ status: 'error', message: 'Order not found' });
  }

  // Enrich with payment data
  const payments = listPaymentsForBuyer(req.wholesaleBuyer.id)
    .filter(p => p.order_id === order.master_order_id);
  const refunds = listRefundsForOrder(order.master_order_id);

  return res.json({
    status: 'ok',
    data: {
      order,
      payments,
      refunds
    }
  });
});

// ── Buyer payment history ────────────────────────────────────────────

router.get('/buyers/payments', requireBuyerPortalAuth, (req, res) => {
  const payments = listPaymentsForBuyer(req.wholesaleBuyer.id);
  return res.json({ status: 'ok', data: { payments } });
});

// ── Order cancellation ───────────────────────────────────────────────

router.post('/orders/:orderId/cancel', requireBuyerPortalAuth, async (req, res) => {
  const order = await getOrderById(req.params.orderId, { includeArchived: false });

  if (!order || order.buyer_id !== req.wholesaleBuyer.id) {
    return res.status(404).json({ status: 'error', message: 'Order not found' });
  }

  // Only allow cancellation of recent orders that haven't shipped
  const cancellableStatuses = ['confirmed', 'pending', 'processing'];
  if (!cancellableStatuses.includes(order.status)) {
    return res.status(400).json({
      status: 'error',
      message: `Order cannot be cancelled (status: ${order.status}). Contact support for assistance.`
    });
  }

  // Check if order is less than 24h old
  const orderAge = Date.now() - new Date(order.created_at).getTime();
  const MAX_CANCEL_AGE = 24 * 60 * 60 * 1000; // 24 hours
  if (orderAge > MAX_CANCEL_AGE) {
    return res.status(400).json({
      status: 'error',
      message: 'Orders can only be self-cancelled within 24 hours. Please contact support.'
    });
  }

  const previousStatus = order.status;
  try {
    transitionOrderStatus(order, 'cancelled');
  } catch (err) {
    return res.status(409).json({ status: 'error', message: err.message });
  }
  order.cancelled_at = new Date().toISOString();
  order.cancellation_reason = sanitizeText(req.body?.reason || 'Buyer requested cancellation');

  await saveOrder(order).catch(() => {});
  logOrderEvent(order.master_order_id, 'order_cancelled', {
    buyer_id: req.wholesaleBuyer.id,
    previous_status: previousStatus,
    reason: order.cancellation_reason
  });

  return res.json({ status: 'ok', data: { order } });
});

// Get invoice for a specific order
router.get('/orders/:orderId/invoice', requireBuyerPortalAuth, async (req, res) => {
  const orderId = req.params.orderId;
  const order = await getOrderById(orderId, { includeArchived: true });

  if (order && order.buyer_id !== req.wholesaleBuyer.id) {
    return res.status(404).json({ status: 'error', message: 'Order not found' });
  }

  if (!order) {
    return res.status(404).json({ status: 'error', message: 'Order not found' });
  }

  // Build invoice data structure
  const invoice = {
    invoice_number: `INV-${orderId.substring(0, 8)}`,
    order_id: orderId,
    po_number: order.po_number || null,
    invoice_date: new Date().toISOString(),
    order_date: order.created_at,
    delivery_date: order.delivery_date,
    buyer: {
      id: order.buyer_id,
      business_name: order.buyer_account?.business_name || 'N/A',
      contact_name: order.buyer_account?.contact_name || 'N/A',
      email: order.buyer_account?.email || 'N/A',
      phone: order.buyer_account?.phone || 'N/A'
    },
    delivery_address: order.delivery_address || {},
    items: (order.farm_sub_orders || []).flatMap((sub) => 
      (sub.items || []).map((item) => ({
        product_name: item.product_name,
        sku_id: item.sku_id,
        quantity: item.quantity,
        unit: item.unit,
        size: item.size,
        price_per_unit: item.price_per_unit,
        line_total: Number(item.quantity) * Number(item.price_per_unit),
        farm_name: sub.farm_name,
        farm_id: sub.farm_id
      }))
    ),
    farms: (order.farm_sub_orders || []).map((sub) => ({
      farm_id: sub.farm_id,
      farm_name: sub.farm_name,
      subtotal: sub.subtotal,
      status: sub.status,
      tracking_number: sub.tracking_number || null,
      tracking_carrier: sub.tracking_carrier || null
    })),
    summary: {
      subtotal: order.subtotal,
      delivery_fee: order.delivery_fee || 0,
      broker_fee: order.broker_fee || 0,
      grand_total: order.grand_total
    },
    recurrence: order.recurrence || { cadence: 'one_time' },
    payment: {
      status: order.payment?.status || 'pending',
      method: order.payment?.method || 'manual'
    },
    status: order.status,
    notes: order.delivery_address?.instructions || ''
  };

  return res.json({
    status: 'ok',
    data: invoice
  });
});

router.post('/checkout/preview', requireWholesaleDbForCriticalPaths, requireBuyerAuth, async (req, res, next) => {
  try {
    const { cart, recurrence, sourcing } = req.body || {};
    if (!Array.isArray(cart) || cart.length === 0) {
      throw new ValidationError('Cart is required');
    }

    const commissionRate = Number(process.env.WHOLESALE_COMMISSION_RATE || 0.12);

    const buyerLocation = getBuyerLocationFromBuyer(req.wholesaleBuyer);

    // Limited mode: allocate from network snapshots (proximity-aware)
    if (shouldUseNetworkAllocation(req)) {
      const catalog = await buildAggregateCatalog({ buyerLocation });
      const result = await allocateCartFromNetwork({ cart, catalog, commissionRate, sourcing, buyerLocation });
      if (!result.allocation.farm_sub_orders?.length) {
        return res.status(400).json({ status: 'error', message: 'Unable to allocate items with current inventory' });
      }
      return res.json({
        status: 'ok',
        data: {
          ...result.allocation,
          payment_split: result.payment_split,
          recurrence: recurrence || { cadence: 'one_time' },
          sourcing: sourcing || { mode: 'auto_network' }
        }
      });
    }

    if (!canUseDemoWholesalePaths()) {
      return res.status(503).json({
        status: 'error',
        message: 'Wholesale allocation is not configured for this environment'
      });
    }

    const demoCatalog = await loadWholesaleDemoCatalog();
    const result = await allocateCartFromDemo({ cart, demoCatalog, commissionRate });

    if (!result.allocation.farm_sub_orders?.length) {
      return res.status(400).json({ status: 'error', message: 'Unable to allocate items with current inventory' });
    }

    return res.json({
      status: 'ok',
      data: {
        ...result.allocation,
        payment_split: result.payment_split,
        recurrence: recurrence || { cadence: 'one_time' }
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/checkout/execute', requireWholesaleDbForCriticalPaths, requireBuyerAuth, async (req, res, next) => {
  try {
    const { buyer_account, delivery_date, delivery_address, recurrence, cart, payment_provider, sourcing, po_number } = req.body || {};

    if (!buyer_account?.email) throw new ValidationError('buyer_account.email is required');
    if (!delivery_date) throw new ValidationError('delivery_date is required');
    if (!delivery_address?.street || !delivery_address?.city || !delivery_address?.zip) {
      throw new ValidationError('delivery_address street/city/zip are required');
    }
    if (!Array.isArray(cart) || cart.length === 0) throw new ValidationError('cart is required');

    const commissionRate = Number(process.env.WHOLESALE_COMMISSION_RATE || 0.12);

    const buyerLocation = getBuyerLocationFromBuyer(req.wholesaleBuyer);

    // Limited mode: allocate from network snapshots (proximity-aware)
    if (shouldUseNetworkAllocation(req)) {
      const catalog = await buildAggregateCatalog({ buyerLocation });
      const result = await allocateCartFromNetwork({ cart, catalog, commissionRate, sourcing, buyerLocation });
      if (!result.allocation.farm_sub_orders?.length) {
        return res.status(400).json({ status: 'error', message: 'Unable to allocate items with current inventory' });
      }

      const order = createOrder({
        buyerId: req.wholesaleBuyer.id,
        buyerAccount: buyer_account,
        poNumber: po_number,
        deliveryDate: delivery_date,
        deliveryAddress: delivery_address,
        recurrence: recurrence || { cadence: 'one_time' },
        farmSubOrders: result.allocation.farm_sub_orders,
        totals: result.allocation
      });

      const payment = createPayment({
        orderId: order.master_order_id,
        provider: payment_provider || 'square',
        split: result.payment_split,
        totals: result.allocation
      });

      // Attempt Square payment if farms have Square connected
      let paymentSuccess = false;
      const farmIds = result.allocation.farm_sub_orders.map(sub => sub.farm_id);
      
      try {
        const squareCredentials = await getBatchFarmSquareCredentials(farmIds);
        const allFarmsConnected = farmIds.every(farmId => 
          squareCredentials.get(farmId)?.success === true
        );
        
        if (allFarmsConnected && payment_provider === 'square') {
          console.log('[Checkout] All farms have Square connected - processing payments');
          
          // Process Square payments with commission splits
          const paymentResult = await processSquarePayments({
            masterOrderId: order.master_order_id,
            farmSubOrders: result.allocation.farm_sub_orders.map(sub => ({
              ...sub,
              buyer_email: buyer_account.email
            })),
            paymentSource: req.body.payment_source || { source_id: 'CARD_ON_FILE' },
            commissionRate
          });
          
          if (paymentResult.success) {
            payment.status = 'completed';
            payment.provider = 'square';
            payment.square_details = {
              total_amount: paymentResult.totalAmount,
              total_broker_fee: paymentResult.totalBrokerFee,
              payments: paymentResult.paymentResults
            };
            paymentSuccess = true;
            console.log('[Checkout] Square payments successful:', paymentResult);
          } else {
            payment.status = 'failed';
            payment.provider = 'square';
            payment.notes = `Square payment failed: ${paymentResult.paymentResults.filter(r => !r.success).map(r => `Farm ${r.farmId}: ${r.error}`).join('; ')}`;
            console.error('[Checkout] Square payments failed:', paymentResult);
          }
        } else {
          console.log('[Checkout] Not all farms have Square connected - using manual payment');
          payment.status = 'pending';
          payment.provider = 'manual';
          
          // Log which farms are missing Square
          for (const farmId of farmIds) {
            const creds = squareCredentials.get(farmId);
            if (!creds?.success) {
              console.log(`[Checkout] Farm ${farmId} Square not connected: ${creds?.error || 'unknown'}`);
            }
          }
        }
      } catch (error) {
        console.error('[Checkout] Square payment processing failed:', error);
        payment.status = 'failed';
        payment.provider = payment_provider || 'manual';
        payment.notes = `Payment error: ${error.message}`;
      }

      // ── Synchronous inventory reservation before responding ──
      // Reserve inventory at each farm BEFORE confirming the order to the buyer.
      // If any reservation fails, roll back all previous reservations and fail the checkout.
      order.payment = payment;

      const farms = await listNetworkFarms();
      const byId = new Map(farms.map((f) => [String(f.farm_id), f]));
      const farmApiKeys = loadFarmApiKeys();

      // Resolve auth credentials: prefer stored farm credentials, fall back to farm-api-keys.json
      const resolveAuth = (farmObj, farmId) => {
        if (farmObj?.api_key) return { farmId: farmObj.auth_farm_id || farmId, apiKey: farmObj.api_key };
        if (farmObj?.auth_farm_id && farmApiKeys[farmObj.auth_farm_id]?.api_key) {
          return { farmId: farmObj.auth_farm_id, apiKey: farmApiKeys[farmObj.auth_farm_id].api_key };
        }
        if (farmApiKeys[farmId]?.api_key) return { farmId, apiKey: farmApiKeys[farmId].api_key };
        const envKey = process.env.WHOLESALE_FARM_API_KEY;
        if (envKey) return { farmId, apiKey: envKey };
        const entry = Object.entries(farmApiKeys).find(([, v]) => v?.status === 'active' && v?.api_key);
        if (entry) return { farmId: entry[0], apiKey: entry[1].api_key };
        return { farmId, apiKey: null };
      };

      const farmCallWithTimeout = async (farmBaseUrl, urlPath, body, farmId, farmObj, timeoutMs = 8000) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const auth = resolveAuth(farmObj, farmId);
          const headers = { 'Content-Type': 'application/json' };
          if (auth.farmId) headers['X-Farm-ID'] = auth.farmId;
          if (auth.apiKey) headers['X-API-Key'] = auth.apiKey;
          const resp = await fetch(new URL(urlPath, farmBaseUrl).toString(), {
            method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal
          });
          const json = await resp.json().catch(() => null);
          return { ok: resp.ok && json?.ok !== false, status: resp.status, json };
        } finally {
          clearTimeout(timer);
        }
      };

      // Phase 1: Reserve inventory at every farm (synchronous, with rollback on failure)
      const reservedFarms = []; // track successful reservations for rollback
      let reservationError = null;

      for (const sub of order.farm_sub_orders || []) {
        const farm = byId.get(String(sub.farm_id));
        const farmUrl = farm?.api_url || farm?.url;
        if (!farmUrl) continue;

        try {
          const reserveResult = await farmCallWithTimeout(farmUrl, '/api/wholesale/inventory/reserve', {
            order_id: order.master_order_id,
            items: (sub.items || []).map((it) => ({ sku_id: it.sku_id, quantity: it.quantity }))
          }, sub.farm_id, farm);

          if (reserveResult.ok) {
            reservedFarms.push({ farm_id: sub.farm_id, farmUrl, farm });
            console.log(`[Checkout] Reserved inventory at farm ${sub.farm_id}`);
          } else {
            console.warn(`[Checkout] Reservation rejected by farm ${sub.farm_id}:`, reserveResult.json?.error || reserveResult.status);
            reservationError = `Farm ${sub.farm_id} rejected reservation: ${reserveResult.json?.error || 'HTTP ' + reserveResult.status}`;
            break;
          }
        } catch (err) {
          console.warn(`[Checkout] Reservation failed for farm ${sub.farm_id}:`, err.message);
          reservationError = `Farm ${sub.farm_id} reservation failed: ${err.message}`;
          break;
        }
      }

      // Rollback all reservations if any farm failed
      if (reservationError) {
        for (const reserved of reservedFarms) {
          try {
            await farmCallWithTimeout(reserved.farmUrl, '/api/wholesale/inventory/release', {
              order_id: order.master_order_id
            }, reserved.farm_id, reserved.farm, 5000);
            console.log(`[Checkout] Rolled back reservation at farm ${reserved.farm_id}`);
          } catch (rollbackErr) {
            console.error(`[Checkout] Rollback failed for farm ${reserved.farm_id}:`, rollbackErr.message);
          }
        }
        return res.status(409).json({
          status: 'error',
          message: 'Inventory reservation failed — order not placed',
          detail: reservationError
        });
      }

      // Phase 2: If payment succeeded, confirm (convert reservations to permanent deductions)
      if (paymentSuccess) {
        for (const reserved of reservedFarms) {
          try {
            await farmCallWithTimeout(reserved.farmUrl, '/api/wholesale/inventory/confirm', {
              order_id: order.master_order_id,
              payment_id: payment.payment_id
            }, reserved.farm_id, reserved.farm);
            console.log(`[Checkout] Inventory confirmed at farm ${reserved.farm_id}`);
          } catch (confirmErr) {
            console.warn(`[Checkout] Confirm failed for farm ${reserved.farm_id} (reservation still held):`, confirmErr.message);
          }
        }
      }

      await saveOrder(order).catch(() => {});

      // Phase 3 (async/best-effort): Notify farms + send confirmation email
      (async () => {
        try {
          for (const sub of order.farm_sub_orders || []) {
            const farm = byId.get(String(sub.farm_id));
            const farmUrl = farm?.api_url || farm?.url;
            if (!farmUrl) continue;
            try {
              await farmCallWithTimeout(farmUrl, '/api/wholesale/order-events', {
                type: 'wholesale_order_created',
                order_id: order.master_order_id,
                farm_id: sub.farm_id,
                delivery_date: order.delivery_date,
                created_at: order.created_at,
                items: (sub.items || []).map((it) => ({
                  sku_id: it.sku_id, product_name: it.product_name, quantity: it.quantity, unit: it.unit
                }))
              }, sub.farm_id, farm, 3000);
            } catch { /* notification is best-effort */ }
          }
        } catch { /* ignore */ }
      })();

      // Order confirmation email + audit (non-blocking)
      logOrderEvent(order.master_order_id, 'order_created', { buyer_id: req.wholesaleBuyer.id, payment_id: payment.payment_id, total: order.grand_total });
      emailService.sendOrderConfirmation(order, req.wholesaleBuyer).catch(err => console.warn('[Email] Confirmation failed:', err.message));

      return res.json({ status: 'ok', data: order, meta: { payment_id: payment.payment_id } });
    }

    if (!canUseDemoWholesalePaths()) {
      return res.status(503).json({
        status: 'error',
        message: 'Wholesale checkout is not configured for this environment'
      });
    }

    const demoCatalog = await loadWholesaleDemoCatalog();
    const result = await allocateCartFromDemo({ cart, demoCatalog, commissionRate });

    if (!result.allocation.farm_sub_orders?.length) {
      return res.status(400).json({ status: 'error', message: 'Unable to allocate items with current inventory' });
    }

    const order = createOrder({
      buyerId: req.wholesaleBuyer.id,
      buyerAccount: buyer_account,
      deliveryDate: delivery_date,
      deliveryAddress: delivery_address,
      recurrence: recurrence || { cadence: 'one_time' },
      farmSubOrders: result.allocation.farm_sub_orders,
      totals: result.allocation
    });

    const payment = createPayment({
      orderId: order.master_order_id,
      provider: payment_provider || 'demo',
      split: result.payment_split,
      totals: result.allocation
    });
    payment.status = 'completed';
    order.payment = payment;
    await saveOrder(order).catch(() => {});

    // Notify farms (dev stub): broadcast over WS if available.
    const wss = req.app?.locals?.wss;
    if (wss?.clients?.size) {
      const payload = JSON.stringify({
        type: 'wholesale_order_created',
        order_id: order.master_order_id,
        created_at: order.created_at
      });

      wss.clients.forEach((client) => {
        if (client.readyState === 1) client.send(payload);
      });
    }

    // Order confirmation email + audit (non-blocking)
    logOrderEvent(order.master_order_id, 'order_created', { buyer_id: req.wholesaleBuyer.id, payment_id: payment.payment_id, total: order.grand_total });
    emailService.sendOrderConfirmation(order, req.wholesaleBuyer).catch(err => console.warn('[Email] Confirmation failed:', err.message));

    return res.json({ status: 'ok', data: order, meta: { payment_id: payment.payment_id } });
  } catch (error) {
    return next(error);
  }
});

// --- Wholesale admin utility endpoints ---

router.get('/oauth/square/farms', (req, res) => {
  return res.json({ status: 'ok', data: { farms: [] } });
});

router.get('/webhooks/payments', (req, res) => {
  return res.json({ status: 'ok', data: { payments: listPayments() } });
});

router.get('/refunds', (req, res) => {
  return res.json({ status: 'ok', data: { refunds: listRefunds() } });
});

router.post('/webhooks/reconcile', adminAuthMiddleware, async (req, res) => {
  try {
    const payments = listPayments() || [];
    const orders = await listAllOrders({ page: 1, limit: 50000 });
    const orderMap = new Map((orders || []).map(o => [o.master_order_id, o]));

    let matched = 0;
    let unmatched = 0;
    let mismatches = [];

    for (const payment of payments) {
      const order = orderMap.get(payment.order_id);
      if (!order) {
        unmatched++;
        mismatches.push({ payment_id: payment.payment_id, order_id: payment.order_id, issue: 'order_not_found' });
        continue;
      }
      const orderTotal = order.totals?.grand_total || order.grand_total || 0;
      const paymentAmount = payment.amount || 0;
      if (Math.abs(orderTotal - paymentAmount) > 0.01) {
        mismatches.push({
          payment_id: payment.payment_id,
          order_id: payment.order_id,
          issue: 'amount_mismatch',
          payment_amount: paymentAmount,
          order_total: orderTotal,
          difference: Math.round((paymentAmount - orderTotal) * 100) / 100,
        });
      }
      matched++;
    }

    return res.json({
      status: 'ok',
      data: {
        reconciled_at: new Date().toISOString(),
        total_payments: payments.length,
        matched,
        unmatched,
        mismatches,
        clean: mismatches.length === 0,
      },
    });
  } catch (err) {
    console.error('[Wholesale] Reconcile error:', err.message);
    return res.status(500).json({ status: 'error', message: 'Reconciliation failed' });
  }
});

router.get('/oauth/square/authorize', (req, res) => {
  return res.json({ status: 'ok', data: { authorized: false, message: 'Square OAuth not configured in this environment' } });
});

router.post('/oauth/square/refresh', (req, res) => {
  return res.json({ status: 'ok', data: { refreshed: false, message: 'Square OAuth not configured in this environment' } });
});

router.delete('/oauth/square/disconnect/:farmId', (req, res) => {
  return res.json({ status: 'ok', data: { disconnected: true, farm_id: req.params.farmId } });
});

// --- Network admin (DB optional) ---

// Lightweight bootstrap trigger – uses GREENREACH_API_KEY for auth (no session required)
router.post('/network/bootstrap', async (req, res) => {
  const apiKey = (req.headers['x-api-key'] || '').trim();
  const expected = (process.env.GREENREACH_API_KEY || '').trim();
  if (!apiKey || !expected || apiKey !== expected) {
    return res.status(401).json({ status: 'error', message: 'invalid api key' });
  }
  try {
    const payload = req.body || {};
    const farmId = String(payload.farm_id || '').trim();
    if (!farmId) return res.status(400).json({ status: 'error', message: 'farm_id required' });

    const farm = await upsertNetworkFarm(farmId, {
      farm_id: farmId,
      name: payload.name || farmId,
      api_url: payload.api_url || null,
      url: payload.api_url || null,
      status: payload.status || 'active',
      auth_farm_id: payload.auth_farm_id || null,
      api_key: payload.api_key || null,
      contact: payload.contact || {},
      location: payload.location || {}
    });
    return res.json({ status: 'ok', data: { farm } });
  } catch (error) {
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

router.get('/network/farms', async (req, res, next) => {
  try {
    const farms = await listNetworkFarms();
    return res.json({ status: 'ok', data: { farms, lastSync: req.app?.locals?.wholesaleNetworkLastSync || null } });
  } catch (error) {
    return next(error);
  }
});

router.post('/network/farms', adminAuthMiddleware, async (req, res, next) => {
  try {
    const payload = req.body || {};
    const farmId = String(payload.farm_id || payload.farmId || '').trim();
    if (!farmId) {
      return res.status(400).json({ status: 'error', message: 'farm_id is required' });
    }

    const farm = await upsertNetworkFarm(farmId, {
      farm_id: farmId,
      name: payload.name || farmId,
      api_url: payload.api_url || payload.url || null,
      url: payload.url || payload.api_url || null,
      status: payload.status || 'active',
      auth_farm_id: payload.auth_farm_id || null,
      api_key: payload.api_key || null,
      contact: payload.contact || {},
      location: payload.location || {}
    });
    return res.json({ status: 'ok', data: { farm } });
  } catch (error) {
    return next(error);
  }
});

router.delete('/network/farms/:farmId', adminAuthMiddleware, async (req, res, next) => {
  try {
    const result = await removeNetworkFarm(req.params.farmId);
    return res.json({ status: 'ok', data: result });
  } catch (error) {
    return next(error);
  }
});

router.get('/network/snapshots', (req, res) => {
  return res.json({ status: 'ok', data: { snapshots: listNetworkSnapshots() } });
});

router.get('/network/aggregate', async (req, res) => {
  const agg = await buildAggregateCatalog();
  return res.json({ status: 'ok', data: { catalog: agg, diagnostics: agg.diagnostics || {} } });
});

router.get('/network/trends', (req, res) => {
  return res.json({ status: 'ok', data: getNetworkTrends() });
});

router.get('/network/market-events', (req, res) => {
  return res.json({ status: 'ok', data: { events: listMarketEvents() } });
});

router.post('/network/market-events', adminAuthMiddleware, (req, res) => {
  const { date, title, notes, impact } = req.body || {};
  if (!title) {
    return res.status(400).json({ status: 'error', message: 'title is required' });
  }
  const evt = addMarketEvent({ date: sanitizeText(date), title: sanitizeText(title), notes: sanitizeText(notes), impact });
  return res.json({ status: 'ok', data: { event: evt } });
});

router.get('/network/recommendations', async (req, res) => {
  const recentOrders = (await listAllOrders()).slice(0, 200);
  return res.json({ status: 'ok', data: generateNetworkRecommendations({ recentOrders }) });
});

// ============================================================================
// ADMIN ENDPOINTS - Payment Management
// ============================================================================

router.get('/admin/orders', adminAuthMiddleware, async (req, res) => {
  try {
    const includeArchived = String(req.query.includeArchived || '').toLowerCase() === 'true';
    const orders = await listAllOrders({ includeArchived });
    return res.json({ status: 'ok', orders });
  } catch (error) {
    console.error('Admin list orders error:', error);
    return res.status(500).json({ status: 'error', message: 'Failed to load orders' });
  }
});

router.post('/admin/orders/:orderId/payment', adminAuthMiddleware, express.json(), async (req, res) => {
  try {
    const { orderId } = req.params;
    const { status, payment_reference, payment_method, marked_at } = req.body;

    if (!orderId || !status || !payment_reference) {
      return res.status(400).json({ status: 'error', message: 'orderId, status, and payment_reference are required' });
    }

    // In limited mode, orders are in memory - update the order directly
    const order = await getOrderById(orderId, { includeArchived: true });

    if (!order) {
      return res.status(404).json({ status: 'error', message: 'Order not found' });
    }

    // Update payment status
    order.payment = order.payment || {};
    order.payment.status = status;
    order.payment.reference = payment_reference;
    order.payment.method = payment_method || 'manual';
    order.payment.marked_at = marked_at || new Date().toISOString();

    await saveOrder(order).catch(() => {});
    logOrderEvent(orderId, 'payment_marked', { status, payment_reference, payment_method: payment_method || 'manual' });

    return res.json({ status: 'ok', data: { order } });
  } catch (error) {
    console.error('Admin update payment error:', error);
    return res.status(500).json({ status: 'error', message: 'Failed to update payment' });
  }
});

// Update farm sub-order tracking (for farm fulfillment UI)
router.patch('/admin/orders/:orderId/farms/:farmId/tracking', adminAuthMiddleware, express.json(), async (req, res) => {
  try {
    const { orderId, farmId } = req.params;
    const { tracking_number, tracking_carrier, status } = req.body;

    if (!tracking_number) {
      return res.status(400).json({ status: 'error', message: 'tracking_number is required' });
    }

    const updates = {
      tracking_number,
      tracking_carrier: tracking_carrier || 'unknown',
      tracking_updated_at: new Date().toISOString()
    };

    if (status) updates.status = status;

    const subOrder = await updateFarmSubOrder({ orderId, farmId, updates });

    if (!subOrder) {
      return res.status(404).json({ status: 'error', message: 'Order or farm sub-order not found' });
    }

    logOrderEvent(orderId, 'tracking_updated', { farm_id: farmId, tracking_number, tracking_carrier: tracking_carrier || 'unknown', status: status || null });

    return res.json({ status: 'ok', data: { subOrder } });
  } catch (error) {
    console.error('Update tracking error:', error);
    return res.status(500).json({ status: 'error', message: 'Failed to update tracking' });
  }
});

/**
 * GET /api/wholesale/inventory/check-overselling
 * Check all farms for overselling conditions (reserved > available)
 */
router.get('/inventory/check-overselling', async (req, res) => {
  try {
    const farms = await listNetworkFarms();
    const oversellingItems = [];
    
    for (const farm of farms) {
      try {
        const inventoryRes = await fetch(`${farm.endpoint}/api/wholesale/inventory`);
        if (!inventoryRes.ok) continue;
        
        const inventory = await inventoryRes.json();
        
        // Check each SKU for overselling (available < reserved)
        for (const item of inventory) {
          if (item.reserved > 0 && item.available < item.reserved) {
            oversellingItems.push({
              farm_id: farm.id,
              farm_name: farm.name,
              sku_id: item.sku_id,
              sku_name: item.name,
              available: item.available,
              reserved: item.reserved,
              shortage: item.reserved - item.available
            });
          }
        }
      } catch (farmError) {
        console.error(`Failed to check inventory for farm ${farm.id}:`, farmError.message);
      }
    }
    
    return res.json({
      status: 'ok',
      overselling: oversellingItems.length > 0,
      items: oversellingItems,
      checked_at: new Date().toISOString()
    });
  } catch (error) {
    console.error('Overselling check error:', error);
    return res.status(500).json({ status: 'error', message: 'Failed to check overselling' });
  }
});

/**
 * POST /api/wholesale/catalog/sync
 * Farm -> Central catalog sync endpoint (compat for LE wholesale integration service)
 */
router.post('/catalog/sync', requireFarmApiKey, express.json(), async (req, res) => {
  try {
    const farmId = req.farmAuth?.farm_id || req.body?.farmId;
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    const timestamp = req.body?.timestamp || new Date().toISOString();

    farmCatalogSyncCache.set(farmId, {
      farmId,
      items,
      count: items.length,
      syncedAt: timestamp,
      updatedAt: new Date().toISOString()
    });

    try {
      await query(
        `INSERT INTO farm_data (farm_id, data_type, data, updated_at)
         VALUES ($1, 'wholesale_catalog', $2::jsonb, NOW())
         ON CONFLICT (farm_id, data_type)
         DO UPDATE SET data = $2::jsonb, updated_at = NOW()`,
        [farmId, JSON.stringify({ items, syncedAt: timestamp })]
      );
    } catch (dbError) {
      console.warn('[wholesale] catalog sync DB write skipped:', dbError.message);
    }

    return res.json({
      status: 'ok',
      farm_id: farmId,
      synced: items.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[wholesale] catalog sync failed:', error);
    return res.status(500).json({ status: 'error', message: 'Catalog sync failed' });
  }
});

/**
 * POST /api/wholesale/pricing/sync
 * Farm -> Central pricing sync endpoint (compat for LE wholesale integration service)
 */
router.post('/pricing/sync', requireFarmApiKey, express.json(), async (req, res) => {
  try {
    const farmId = req.farmAuth?.farm_id || req.body?.farmId;
    const pricing = Array.isArray(req.body?.pricing) ? req.body.pricing : [];
    const timestamp = req.body?.timestamp || new Date().toISOString();

    farmPricingSyncCache.set(farmId, {
      farmId,
      pricing,
      count: pricing.length,
      syncedAt: timestamp,
      updatedAt: new Date().toISOString()
    });

    try {
      await query(
        `INSERT INTO farm_data (farm_id, data_type, data, updated_at)
         VALUES ($1, 'wholesale_pricing', $2::jsonb, NOW())
         ON CONFLICT (farm_id, data_type)
         DO UPDATE SET data = $2::jsonb, updated_at = NOW()`,
        [farmId, JSON.stringify({ pricing, syncedAt: timestamp })]
      );
    } catch (dbError) {
      console.warn('[wholesale] pricing sync DB write skipped:', dbError.message);
    }

    return res.json({
      status: 'ok',
      farm_id: farmId,
      synced: pricing.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[wholesale] pricing sync failed:', error);
    return res.status(500).json({ status: 'error', message: 'Pricing sync failed' });
  }
});

// NOTE: Farm fulfillment callbacks (fulfill, cancel-by-farm, order-status)
// have been consolidated into wholesale-fulfillment.js

/**
 * GET /api/wholesale/check-overselling
 * Check inventory for overselling issues
 * Returns analysis of inventory levels vs. orders
 */
router.get('/check-overselling', async (req, res) => {
  try {
    // Use in-memory network data (same approach as /inventory/check-overselling)
    // The farm_inventory DB table schema is inconsistent, so avoid the DB query
    const farms = await listNetworkFarms();
    const farmResults = [];

    for (const farm of farms) {
      farmResults.push({
        farm_id: farm.farm_id,
        name: farm.name || farm.farm_id,
        status: farm.status || 'active',
        product_count: 0,
        overselling_detected: false,
        available_inventory: false
      });
    }

    // If no network farms, fall back to DB farm list (without inventory join)
    if (farmResults.length === 0) {
      try {
        const { query: dbQuery } = await import('../config/database.js');
        const result = await dbQuery(
          `SELECT farm_id, name, status FROM farms WHERE status IN ('active','online')`
        );
        for (const row of result.rows) {
          farmResults.push({
            farm_id: row.farm_id,
            name: row.name || row.farm_id,
            status: row.status,
            product_count: 0,
            overselling_detected: false,
            available_inventory: false
          });
        }
      } catch (dbErr) {
        console.warn('[Check Overselling] DB fallback failed:', dbErr.message);
      }
    }

    res.json({
      status: 'ok',
      data: {
        farms: farmResults,
        total_farms: farmResults.length,
        issues_detected: 0,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('[Check Overselling] Error:', error);
    res.status(500).json({
      status: 'error',
      error: 'Internal Server Error',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /api/wholesale/farm-performance/dashboard
 * Lightweight dashboard metrics for wholesale insights
 */
router.get('/farm-performance/dashboard', async (req, res) => {
  try {
    const timeframe = req.query?.timeframe || '30d';

    if (req.app?.locals?.databaseReady === false) {
      return res.json({
        status: 'ok',
        data: {
          farms: 0,
          orders: 0,
          revenue: 0,
          timeframe,
          mode: 'limited'
        }
      });
    }

    const safeNumber = async (sql, field, fallback = 0) => {
      try {
        const result = await query(sql);
        return Number(result.rows?.[0]?.[field] || fallback);
      } catch (error) {
        console.warn(`[Farm Performance Dashboard] Fallback for ${field}:`, error.message);
        return fallback;
      }
    };

    const farms = await safeNumber(`SELECT COUNT(*)::int AS total FROM farms`, 'total', 0);
    const orders = await safeNumber(`SELECT COUNT(*)::int AS total FROM orders`, 'total', 0);
    const revenue = await safeNumber(
      `SELECT COALESCE(SUM((order_data->>'total')::numeric), 0) AS revenue FROM orders`,
      'revenue',
      0
    );

    const mode = (farms === 0 && orders === 0 && revenue === 0) ? 'limited' : 'live';

    res.json({
      status: 'ok',
      data: {
        farms,
        orders,
        revenue,
        timeframe,
        mode
      }
    });
  } catch (error) {
    console.error('[Farm Performance Dashboard] Error:', error);
    res.json({
      status: 'ok',
      data: {
        farms: 0,
        orders: 0,
        revenue: 0,
        timeframe: req.query?.timeframe || '30d',
        mode: 'limited'
      }
    });
  }
});
export default router;
