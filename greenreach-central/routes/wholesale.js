import express from 'express';
import jwt from 'jsonwebtoken';
import { query } from '../config/database.js';
import { ValidationError } from '../middleware/errorHandler.js';

import {
  authenticateBuyer,
  createBuyer,
  createOrder,
  createPayment,
  getBuyerById,
  listAllOrders,
  listOrdersForBuyer,
  listPayments,
  listRefunds,
  updateFarmSubOrder
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

const router = express.Router();

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

function requireBuyerAuth(req, res, next) {
  const authHeader = req.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : '';
  if (!token) {
    return res.status(401).json({ status: 'error', message: 'Missing bearer token' });
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

    const buyer = getBuyerById(String(payload.sub));
    if (!buyer) {
      return res.status(401).json({ status: 'error', message: 'Buyer not found (server restart?)' });
    }

    req.wholesaleBuyer = buyer;
    return next();
  } catch (error) {
    return res.status(401).json({ status: 'error', message: 'Invalid or expired token' });
  }
}

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
    // HOTFIX: Always use in-memory catalog until farm_inventory schema is properly deployed
    // farm_inventory table exists but with wrong schema - missing columns like product_name, category, etc.
    // Use in-memory network catalog (pulled from farms) which is the proven working approach
    if (true || req.app?.locals?.databaseReady === false) {
      const nearLat = req.query.nearLat ?? req.query.lat;
      const nearLng = req.query.nearLng ?? req.query.lng;
      const buyerLocation = (nearLat && nearLng)
        ? { latitude: Number(nearLat), longitude: Number(nearLng) }
        : null;

      const catalog = buildAggregateCatalog({ buyerLocation });
      const farmId = req.query.farmId ? String(req.query.farmId) : null;

      let items = catalog.items;
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
          skus: items
        },
        // Keep legacy fields for any existing callers
        items,
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

router.post('/buyers/register', async (req, res, next) => {
  try {
    const { businessName, contactName, email, password, buyerType, location } = req.body || {};

    if (!email || !password) {
      throw new ValidationError('Email and password are required');
    }

    const buyer = await createBuyer({ businessName, contactName, email, password, buyerType, location });
    const token = issueBuyerToken(buyer.id);

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

router.post('/buyers/login', async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      throw new ValidationError('Email and password are required');
    }

    const buyer = await authenticateBuyer({ email, password });
    if (!buyer) {
      return res.status(401).json({ status: 'error', message: 'Invalid email or password' });
    }

    const token = issueBuyerToken(buyer.id);
    return res.json({ status: 'ok', data: { buyer, token } });
  } catch (error) {
    return next(error);
  }
});

router.get('/orders', requireBuyerAuth, async (req, res) => {
  return res.json({
    status: 'ok',
    data: {
      orders: listOrdersForBuyer(req.wholesaleBuyer.id)
    }
  });
});

// Get invoice for a specific order
router.get('/orders/:orderId/invoice', requireBuyerAuth, async (req, res) => {
  const orderId = req.params.orderId;
  const orders = listOrdersForBuyer(req.wholesaleBuyer.id);
  const order = orders.find((o) => o.master_order_id === orderId);

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

router.post('/checkout/preview', requireBuyerAuth, async (req, res, next) => {
  try {
    const { cart, recurrence, sourcing } = req.body || {};
    if (!Array.isArray(cart) || cart.length === 0) {
      throw new ValidationError('Cart is required');
    }

    const commissionRate = Number(process.env.WHOLESALE_COMMISSION_RATE || 0.12);

    const buyerLocation = getBuyerLocationFromBuyer(req.wholesaleBuyer);

    // Limited mode: allocate from network snapshots (proximity-aware)
    if (req.app?.locals?.databaseReady === false) {
      const catalog = buildAggregateCatalog({ buyerLocation });
      const result = allocateCartFromNetwork({ cart, catalog, commissionRate, sourcing, buyerLocation });
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

    const demoCatalog = await loadWholesaleDemoCatalog();
    const result = allocateCartFromDemo({ cart, demoCatalog, commissionRate });

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

router.post('/checkout/execute', requireBuyerAuth, async (req, res, next) => {
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
    if (req.app?.locals?.databaseReady === false) {
      const catalog = buildAggregateCatalog({ buyerLocation });
      const result = allocateCartFromNetwork({ cart, catalog, commissionRate, sourcing, buyerLocation });
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

      // Best-effort: notify each farm (Light Engine) about its sub-order.
      // Additive only; failure does not block checkout.
      (async () => {
        try {
          const farms = await listNetworkFarms();
          const byId = new Map(farms.map((f) => [String(f.farm_id), f]));

          const notify = async (farmBaseUrl, body) => {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 3000);
            try {
              await fetch(new URL('/api/wholesale/order-events', farmBaseUrl).toString(), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                signal: controller.signal
              });
            } catch {
              // ignore
            } finally {
              clearTimeout(timer);
            }
          };

          const reserve = async (farmBaseUrl, body) => {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 3000);
            try {
              const res = await fetch(new URL('/api/wholesale/inventory/reserve', farmBaseUrl).toString(), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                signal: controller.signal
              });
              const json = await res.json().catch(() => null);
              if (!res.ok || !json?.ok) {
                console.warn(`[Wholesale] Reservation failed for farm ${body.order_id}:`, json?.error || res.status);
              }
            } catch (err) {
              console.warn(`[Wholesale] Failed to reserve inventory at farm:`, err.message);
            } finally {
              clearTimeout(timer);
            }
          };

          const confirm = async (farmBaseUrl, body) => {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 3000);
            try {
              const res = await fetch(new URL('/api/wholesale/inventory/confirm', farmBaseUrl).toString(), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                signal: controller.signal
              });
              const json = await res.json().catch(() => null);
              if (!res.ok || !json?.ok) {
                console.warn(`[Wholesale] Inventory confirmation failed for order ${body.order_id}:`, json?.error || res.status);
              } else {
                console.log(`[Wholesale] Inventory confirmed and deducted for order ${body.order_id}`);
              }
            } catch (err) {
              console.warn(`[Wholesale] Failed to confirm inventory at farm:`, err.message);
            } finally {
              clearTimeout(timer);
            }
          };

          for (const sub of order.farm_sub_orders || []) {
            const farm = byId.get(String(sub.farm_id));
            if (!farm?.base_url) continue;

            // Send order notification
            await notify(farm.base_url, {
              type: 'wholesale_order_created',
              order_id: order.master_order_id,
              farm_id: sub.farm_id,
              delivery_date: order.delivery_date,
              created_at: order.created_at,
              items: (sub.items || []).map((it) => ({
                sku_id: it.sku_id,
                product_name: it.product_name,
                quantity: it.quantity,
                unit: it.unit
              }))
            });

            // Reserve inventory (temporary hold)
            await reserve(farm.base_url, {
              order_id: order.master_order_id,
              items: (sub.items || []).map((it) => ({
                sku_id: it.sku_id,
                quantity: it.quantity
              }))
            });

            // CRITICAL: Confirm inventory deduction if payment succeeded
            if (paymentSuccess) {
              await confirm(farm.base_url, {
                order_id: order.master_order_id,
                payment_id: payment.payment_id
              });
            }
          }
        } catch {
          // ignore
        }
      })();

      return res.json({ status: 'ok', data: order, meta: { payment_id: payment.payment_id } });
    }

    const demoCatalog = await loadWholesaleDemoCatalog();
    const result = allocateCartFromDemo({ cart, demoCatalog, commissionRate });

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

    return res.json({ status: 'ok', data: order, meta: { payment_id: payment.payment_id } });
  } catch (error) {
    return next(error);
  }
});

// --- Wholesale admin stubs (avoid 404s for the dashboard in dev) ---

router.get('/oauth/square/farms', (req, res) => {
  return res.json({ status: 'ok', data: { farms: [] } });
});

router.get('/webhooks/payments', (req, res) => {
  return res.json({ status: 'ok', data: { payments: listPayments() } });
});

router.get('/refunds', (req, res) => {
  return res.json({ status: 'ok', data: { refunds: listRefunds() } });
});

router.post('/webhooks/reconcile', (req, res) => {
  return res.json({ status: 'ok', data: { reconciled: true } });
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

router.get('/admin/orders', (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ status: 'error', message: 'Not Found' });
  }
  return res.json({ status: 'ok', data: { orders: listAllOrders() } });
});

// --- Network admin (DB optional) ---

router.get('/network/farms', async (req, res, next) => {
  try {
    const farms = await listNetworkFarms();
    return res.json({ status: 'ok', data: { farms, lastSync: req.app?.locals?.wholesaleNetworkLastSync || null } });
  } catch (error) {
    return next(error);
  }
});

router.post('/network/farms', async (req, res, next) => {
  try {
    const farm = await upsertNetworkFarm(req.body || {});
    return res.json({ status: 'ok', data: { farm } });
  } catch (error) {
    return next(error);
  }
});

router.delete('/network/farms/:farmId', async (req, res, next) => {
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

router.get('/network/aggregate', (req, res) => {
  const agg = buildAggregateCatalog();
  return res.json({ status: 'ok', data: { catalog: agg } });
});

router.get('/network/trends', (req, res) => {
  return res.json({ status: 'ok', data: getNetworkTrends() });
});

router.get('/network/market-events', (req, res) => {
  return res.json({ status: 'ok', data: { events: listMarketEvents() } });
});

router.post('/network/market-events', (req, res) => {
  const { date, title, notes, impact } = req.body || {};
  if (!title) {
    return res.status(400).json({ status: 'error', message: 'title is required' });
  }
  const evt = addMarketEvent({ date, title, notes, impact });
  return res.json({ status: 'ok', data: { event: evt } });
});

router.get('/network/recommendations', (req, res) => {
  const recentOrders = listAllOrders().slice(0, 200);
  return res.json({ status: 'ok', data: generateNetworkRecommendations({ recentOrders }) });
});

// ============================================================================
// ADMIN ENDPOINTS - Payment Management
// ============================================================================

router.get('/admin/orders', (req, res) => {
  try {
    const orders = listAllOrders();
    return res.json({ status: 'ok', orders });
  } catch (error) {
    console.error('Admin list orders error:', error);
    return res.status(500).json({ status: 'error', message: 'Failed to load orders' });
  }
});

router.post('/admin/orders/:orderId/payment', express.json(), (req, res) => {
  try {
    const { orderId } = req.params;
    const { status, payment_reference, payment_method, marked_at } = req.body;

    if (!orderId || !status || !payment_reference) {
      return res.status(400).json({ status: 'error', message: 'orderId, status, and payment_reference are required' });
    }

    // In limited mode, orders are in memory - update the order directly
    const orders = listAllOrders();
    const order = orders.find(o => o.master_order_id === orderId);

    if (!order) {
      return res.status(404).json({ status: 'error', message: 'Order not found' });
    }

    // Update payment status
    order.payment = order.payment || {};
    order.payment.status = status;
    order.payment.reference = payment_reference;
    order.payment.method = payment_method || 'manual';
    order.payment.marked_at = marked_at || new Date().toISOString();

    return res.json({ status: 'ok', data: { order } });
  } catch (error) {
    console.error('Admin update payment error:', error);
    return res.status(500).json({ status: 'error', message: 'Failed to update payment' });
  }
});

// Update farm sub-order tracking (for farm fulfillment UI)
router.patch('/admin/orders/:orderId/farms/:farmId/tracking', express.json(), (req, res) => {
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

    const subOrder = updateFarmSubOrder({ orderId, farmId, updates });

    if (!subOrder) {
      return res.status(404).json({ status: 'error', message: 'Order or farm sub-order not found' });
    }

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
    const farms = listNetworkFarms();
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

/** * POST /api/wholesale/order-status
 * Receive order status updates from farms (callback endpoint)
 */
router.post('/order-status', async (req, res) => {
  try {
    const { order_id, status, farm_id, timestamp } = req.body;
    
    if (!order_id || !status) {
      return res.status(400).json({
        status: 'error',
        message: 'Missing required fields: order_id, status'
      });
    }
    
    console.log(`📞 [Status Callback] Received from farm ${farm_id}: Order ${order_id} → ${status}`);
    
    // Update order status in memory store
    const orders = listAllOrders();
    const order = orders.find(o => o.master_order_id === order_id);
    
    if (order) {
      order.fulfillment_status = status;
      order.status_updated_at = timestamp || new Date().toISOString();
      
      console.log(`✅ Updated order ${order_id} status to ${status}`);
      
      // TODO: Future enhancements:
      // - Send email notification to buyer when status changes to 'shipped'
      // - Log to audit trail
      // - Trigger analytics events
      
      return res.json({
        status: 'ok',
        message: 'Order status updated',
        order_id: order.master_order_id,
        new_status: order.fulfillment_status
      });
    } else {
      console.warn(`⚠️ Order ${order_id} not found in Central registry`);
      return res.status(404).json({
        status: 'error',
        message: 'Order not found'
      });
    }
  } catch (error) {
    console.error('[Status Callback] Error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Failed to process status update'
    });
  }
});

/**
 * GET /api/wholesale/check-overselling
 * Check inventory for overselling issues
 * Returns analysis of inventory levels vs. orders
 */
router.get('/check-overselling', async (req, res) => {
  try {
    // Check if database is available
    if (req.app?.locals?.databaseReady === false) {
      return res.status(503).json({
        status: 'error',
        message: 'Database unavailable'
      });
    }

    // Query farms and their inventory
    const result = await query(`
      SELECT 
        f.farm_id,
        f.name,
        f.status,
        COUNT(DISTINCT i.id) as product_count
      FROM farms f
      LEFT JOIN farm_inventory i ON f.farm_id = i.farm_id AND i.quantity_available > 0
      WHERE f.status = 'active'
      GROUP BY f.farm_id, f.name, f.status
    `);

    const farms = result.rows.map(row => ({
      farm_id: row.farm_id,
      name: row.name,
      status: row.status,
      product_count: parseInt(row.product_count || 0),
      overselling_detected: false, // Placeholder for future logic
      available_inventory: row.product_count > 0
    }));

    res.json({
      status: 'ok',
      data: {
        farms,
        total_farms: farms.length,
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

export default router;
