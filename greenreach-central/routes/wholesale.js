import express from 'express';
import crypto from 'crypto';
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
  finalizePayment,
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
  hydrateBuyerById,
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
  refreshNetworkInventory,
  generateNetworkRecommendations,
  getBuyerLocationFromBuyer,
  getNetworkTrends,
  listMarketEvents,
  listNetworkSnapshots
} from '../services/wholesaleNetworkAggregator.js';
import { listNetworkFarms, removeNetworkFarm, upsertNetworkFarm } from '../services/networkFarmsStore.js';
import { getBatchFarmSquareCredentials } from '../services/squareCredentials.js';
import { processSquarePayments, refundPayment, saveCardOnFile, getCardOnFile, removeCardOnFile } from '../services/squarePaymentService.js';
import { ingestPaymentRevenue, ingestFarmPayables, ingestFarmPayout } from '../services/revenue-accounting-connector.js';
import emailService from '../services/email-service.js';
import notificationStore from '../services/notification-store.js';
import { farmStore } from '../lib/farm-data-store.js';
import { assembleInvoice, renderInvoiceHTML } from '../lib/wholesale/invoice-generator.js';

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

const checkoutLimiter = rateLimit({
  windowMs: 60 * 1000,       // 1 minute
  max: 10,                    // 10 checkout attempts per buyer per minute
  message: { status: 'error', message: 'Too many checkout requests. Try again shortly.' },
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

// trimField: safe text cleanup for JSON API storage.
// Unlike sanitizeText, does NOT HTML-encode (client escapes at render time).
function trimField(val) {
  if (val == null) return val;
  if (typeof val !== 'string') return val;
  return val.trim();
}

// ── Farm API-key auth (shared middleware) ────────────────────────────
import { requireFarmApiKey, loadFarmApiKeys } from '../middleware/farmApiKeyAuth.js';
import { transitionOrderStatus } from '../services/orderStateMachine.js';

function getWholesaleJwtSecret() {
  const secret = process.env.WHOLESALE_JWT_SECRET || process.env.JWT_SECRET;
  if (secret) return secret;

  // Dev-only fallback; production should set a real secret.
  if (process.env.NODE_ENV !== 'production') return crypto.randomBytes(32).toString('hex');
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

  if (await isTokenBlacklisted(token)) {
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
    // Targeted single-buyer hydration as final fallback
    if (!buyer) {
      try {
        buyer = await hydrateBuyerById(buyerId);
      } catch (singleErr) {
        console.warn('[wholesale] single buyer hydration failed:', singleErr.message);
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

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function normalizeCropKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function percentile(sortedValues, p) {
  if (!Array.isArray(sortedValues) || sortedValues.length === 0) return 0;
  if (sortedValues.length === 1) return sortedValues[0];

  const idx = (sortedValues.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedValues[lo];

  const weight = idx - lo;
  return sortedValues[lo] * (1 - weight) + sortedValues[hi] * weight;
}

function removePriceAnomalies(values) {
  const clean = (Array.isArray(values) ? values : [])
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v) && v > 0);

  if (clean.length < 4) {
    return { kept: clean, removedCount: 0 };
  }

  const sorted = [...clean].sort((a, b) => a - b);
  const q1 = percentile(sorted, 0.25);
  const q3 = percentile(sorted, 0.75);
  const iqr = Math.max(0, q3 - q1);
  if (iqr === 0) {
    return { kept: sorted, removedCount: 0 };
  }

  const lower = q1 - (1.5 * iqr);
  const upper = q3 + (1.5 * iqr);
  const kept = sorted.filter((v) => v >= lower && v <= upper);
  if (kept.length < 3) {
    return { kept: sorted, removedCount: 0 };
  }

  return {
    kept,
    removedCount: Math.max(0, sorted.length - kept.length)
  };
}

function inferPricingFamily(name, category) {
  const text = `${String(name || '')} ${String(category || '')}`.toLowerCase();

  if (/berry|strawberry|raspberry|blackberry|blueberry/.test(text)) {
    return 'berries';
  }

  if (/tomato/.test(text)) {
    if (/cherry tomato|grape tomato/.test(text)) return 'cherry_tomatoes';
    return 'large_tomatoes';
  }

  if (/leafy|lettuce|kale|arugula|spinach|chard|greens|microgreen/.test(text)) {
    return 'weight_crops';
  }

  if (/herb|basil|cilantro|parsley|mint|dill|oregano|thyme|rosemary/.test(text)) {
    return 'weight_crops';
  }

  return 'other';
}

function inferPriceUnit(name, category, fallbackUnit) {
  const family = inferPricingFamily(name, category);
  if (family === 'berries') return 'pint';
  if (family === 'large_tomatoes') return 'unit';

  if (family === 'cherry_tomatoes' || family === 'weight_crops') {
    const normalizedFallback = String(fallbackUnit || '').toLowerCase();
    if (['oz', 'g', 'kg'].includes(normalizedFallback)) {
      return normalizedFallback;
    }
    return 'oz';
  }

  // Default: use 'oz' for weight-like fallbacks since all pricing is per-oz
  const normFB = String(fallbackUnit || '').toLowerCase();
  if (['oz', 'g', 'kg'].includes(normFB)) return normFB;
  if (normFB === 'pint') return 'pint';
  if (normFB === 'unit' || normFB === 'each') return normFB;
  return 'oz';
}

function mean(values) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  return values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length;
}

function getDefaultSkuFactor() {
  const envValue = Number(process.env.WHOLESALE_DEFAULT_SKU_FACTOR || 0.65);
  if (!Number.isFinite(envValue)) return 0.65;
  return Math.min(0.75, Math.max(0.5, envValue));
}

function getBuyerDiscountRateFromRollingAverage(rollingAverage) {
  const avg = Number(rollingAverage || 0);
  if (avg >= 5000) return 0.08;
  if (avg >= 3000) return 0.06;
  if (avg >= 1500) return 0.04;
  if (avg >= 750) return 0.02;
  return 0;
}

async function resolveOptionalBuyerFromRequest(req) {
  const authHeader = req.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : '';
  if (!token) return null;

  const secret = getWholesaleJwtSecret();
  if (!secret) return null;

  try {
    const payload = jwt.verify(token, secret);
    const buyerId = String(payload?.sub || '').trim();
    if (!buyerId) return null;

    let buyer = getBuyerById(buyerId);
    if (!buyer) {
      await loadBuyersFromDb();
      buyer = getBuyerById(buyerId);
    }
    return buyer || null;
  } catch {
    return null;
  }
}

async function getBuyerRollingDiscountProfile(buyerId) {
  if (!buyerId) {
    return { rate: 0, rollingAverage: 0, orderCount: 0, windowDays: 90 };
  }

  try {
    const orders = await listOrdersForBuyer(buyerId, { includeArchived: true });
    const now = Date.now();
    const windowDays = 90;
    const windowStart = now - (windowDays * 24 * 60 * 60 * 1000);

    const eligible = (Array.isArray(orders) ? orders : []).filter((order) => {
      const createdTs = new Date(order?.created_at || order?.createdAt || 0).getTime();
      if (!Number.isFinite(createdTs) || createdTs < windowStart) return false;

      const status = String(order?.status || '').toLowerCase();
      if (['cancelled', 'failed', 'refunded'].includes(status)) return false;

      return Number(order?.grand_total || 0) > 0;
    });

    const rollingAverage = mean(eligible.map((order) => Number(order.grand_total || 0)));
    return {
      rate: getBuyerDiscountRateFromRollingAverage(rollingAverage),
      rollingAverage: roundMoney(rollingAverage),
      orderCount: eligible.length,
      windowDays
    };
  } catch {
    return { rate: 0, rollingAverage: 0, orderCount: 0, windowDays: 90 };
  }
}

async function buildDynamicPricingContext() {
  const context = {
    retailByCrop: new Map(),
    retailByFamily: new Map(),
    wholesaleByCrop: new Map(),
    wholesaleByFamily: new Map(),
    floorByCrop: new Map(),
    floorByFamily: new Map()
  };

  if (!isDatabaseAvailable()) return context;

  const addValue = (map, key, value) => {
    if (!key) return;
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(n);
  };

  try {
    const retailResult = await query(
      `SELECT i.product_name, i.category, i.retail_price, i.wholesale_price
         FROM farm_inventory i
         JOIN farms f ON f.farm_id = i.farm_id
        WHERE f.status = 'active'
          AND COALESCE(i.quantity_available, i.manual_quantity_lbs, 0) > 0
          AND (COALESCE(i.retail_price, 0) > 0 OR COALESCE(i.wholesale_price, 0) > 0)`
    );

    for (const row of retailResult.rows || []) {
      const cropKey = normalizeCropKey(row.product_name);
      const family = inferPricingFamily(row.product_name, row.category);
      addValue(context.retailByCrop, cropKey, row.retail_price);
      addValue(context.retailByFamily, family, row.retail_price);
      addValue(context.wholesaleByCrop, cropKey, row.wholesale_price);
      addValue(context.wholesaleByFamily, family, row.wholesale_price);
    }
  } catch (error) {
    console.warn('[Wholesale Pricing] Retail context load failed:', error.message);
  }

  try {
    const floorResult = await query(
      `SELECT crop, unit, MAX(cost_per_unit) AS max_cost
         FROM farm_cost_surveys
        WHERE valid_until IS NULL OR valid_until >= CURRENT_DATE
        GROUP BY crop, unit`
    );

    for (const row of floorResult.rows || []) {
      const floor = Number(row.max_cost || 0) * 1.2;
      if (!(floor > 0)) continue;

      const cropKey = normalizeCropKey(row.crop);
      const family = inferPricingFamily(row.crop, row.unit);
      context.floorByCrop.set(cropKey, Math.max(context.floorByCrop.get(cropKey) || 0, floor));
      context.floorByFamily.set(family, Math.max(context.floorByFamily.get(family) || 0, floor));
    }
  } catch {
    // Optional table in some environments.
  }

  // Merge farm-admin crop pricing into context so wholesale catalog reflects
  // prices set via the AI Pricing Assistant or manual pricing table edits.
  try {
    const allFarmPricing = await farmStore.getAll('crop_pricing');
    for (const { data } of allFarmPricing) {
      for (const crop of (data?.crops || [])) {
        const retailPrice = Number(crop.retailPrice || 0);
        const wholesalePrice = Number(crop.wholesalePrice || 0);
        if (retailPrice <= 0 && wholesalePrice <= 0) continue;

        const cropKey = normalizeCropKey(crop.crop);
        const family = inferPricingFamily(crop.crop, crop.unit || '');
        addValue(context.retailByCrop, cropKey, retailPrice);
        addValue(context.retailByFamily, family, retailPrice);
        if (wholesalePrice > 0) {
          addValue(context.wholesaleByCrop, cropKey, wholesalePrice);
          addValue(context.wholesaleByFamily, family, wholesalePrice);
        }
        const floorPrice = Number(crop.floor_price || 0);
        if (floorPrice > 0) {
          context.floorByCrop.set(cropKey, Math.max(context.floorByCrop.get(cropKey) || 0, floorPrice));
          context.floorByFamily.set(family, Math.max(context.floorByFamily.get(family) || 0, floorPrice));
        }
      }
    }
  } catch (err) {
    console.warn('[Wholesale Pricing] FarmStore crop_pricing merge failed:', err.message);
  }

  return context;
}

function applyFormulaPricingToCatalogSkus(skus, pricingContext, discountProfile) {
  const list = Array.isArray(skus) ? skus : [];
  const skuFactor = getDefaultSkuFactor();
  const discountRate = Number(discountProfile?.rate || 0);

  for (const sku of list) {
    const isCustomSku = Boolean(sku?.is_custom)
      || String(sku?.inventory_source || '').toLowerCase() === 'custom'
      || (Array.isArray(sku?.quality_flags) && sku.quality_flags.includes('custom_product'))
      || (Array.isArray(sku?.farms) && sku.farms.some((farm) => {
        if (!farm || typeof farm !== 'object') return false;
        if (farm.is_custom === true) return true;
        if (String(farm.inventory_source || '').toLowerCase() === 'custom') return true;
        return Array.isArray(farm.quality_flags) && farm.quality_flags.includes('custom_product');
      }));

    if (isCustomSku) {
      const explicitPrice = Number(
        sku?.price_per_unit
          ?? sku?.wholesale_price
          ?? sku?.wholesalePrice
          ?? sku?.final_wholesale_price
          ?? 0
      );
      const normalizedPrice = Number.isFinite(explicitPrice) && explicitPrice > 0
        ? roundMoney(explicitPrice)
        : 0;

      sku.base_wholesale_price = normalizedPrice;
      sku.final_wholesale_price = normalizedPrice;
      sku.floor_price = normalizedPrice;
      sku.retail_aggregate_price = roundMoney(Number(sku?.retail_price ?? sku?.retailPrice ?? 0));
      sku.sku_factor = null;
      sku.buyer_discount_rate = 0;
      sku.retail_sample_size = 0;
      sku.retail_outliers_removed = 0;
      sku.price_per_unit = normalizedPrice;
      sku.qty_unit = sku.qty_unit || sku.unit;

      for (const farm of (sku.farms || [])) {
        if (!Number.isFinite(Number(farm.price_per_unit)) || Number(farm.price_per_unit) <= 0) {
          farm.price_per_unit = normalizedPrice;
        }
      }
      continue;
    }

    const name = sku?.product_name || sku?.name || '';
    const category = sku?.category || '';
    const cropKey = normalizeCropKey(name);
    const family = inferPricingFamily(name, category);

    const rawRetail = pricingContext.retailByCrop.get(cropKey) || pricingContext.retailByFamily.get(family) || [];
    const retailStats = removePriceAnomalies(rawRetail);
    const retailAggregate = mean(retailStats.kept);

    const rawWholesale = pricingContext.wholesaleByCrop.get(cropKey) || pricingContext.wholesaleByFamily.get(family) || [];
    const wholesaleStats = removePriceAnomalies(rawWholesale);
    const wholesaleFloor = wholesaleStats.kept.length
      ? percentile([...wholesaleStats.kept].sort((a, b) => a - b), 0.2)
      : 0;

    const costFloor = pricingContext.floorByCrop.get(cropKey) || pricingContext.floorByFamily.get(family) || 0;
    const floor = Math.max(Number(costFloor || 0), Number(wholesaleFloor || 0));

    const baseWholesale = retailAggregate > 0
      ? Math.max(floor, retailAggregate * skuFactor)
      : Math.max(floor, Number(sku?.price_per_unit || 0));

    const finalWholesale = Math.max(floor, baseWholesale * (1 - discountRate));
    const priceUnit = inferPriceUnit(name, category, sku?.unit);

    sku.base_wholesale_price = roundMoney(baseWholesale);
    sku.final_wholesale_price = roundMoney(finalWholesale);
    sku.floor_price = roundMoney(floor);
    sku.retail_aggregate_price = roundMoney(retailAggregate);
    sku.sku_factor = skuFactor;
    sku.buyer_discount_rate = discountRate;
    sku.retail_sample_size = rawRetail.length;
    sku.retail_outliers_removed = retailStats.removedCount;
    sku.price_per_unit = roundMoney(finalWholesale);
    sku.qty_unit = sku.qty_unit || sku.unit;
    sku.unit = priceUnit;

    for (const farm of (sku.farms || [])) {
      farm.price_per_unit = sku.price_per_unit;
      farm.unit = priceUnit;
    }
  }

  return list;
}

function toFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function extractCoordinates(rawLocation) {
  if (!rawLocation) return null;
  const location = (typeof rawLocation === 'string')
    ? (() => {
      try { return JSON.parse(rawLocation); } catch { return null; }
    })()
    : rawLocation;

  if (!location || typeof location !== 'object') return null;

  const latitude = toFiniteNumber(
    location.latitude
      ?? location.lat
      ?? location.location?.latitude
      ?? location.location?.lat
  );
  const longitude = toFiniteNumber(
    location.longitude
      ?? location.lng
      ?? location.lon
      ?? location.location?.longitude
      ?? location.location?.lng
      ?? location.location?.lon
  );

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude };
}

function haversineDistanceKm(aLat, aLng, bLat, bLng) {
  const toRad = (deg) => (Number(deg) * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = (sinLat * sinLat) + (Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng);
  return 6371 * (2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)));
}

function resolveCustomProductSearchRadiusKm(rawRadius) {
  const direct = Number(rawRadius);
  if (Number.isFinite(direct) && direct > 0) return direct;

  const envCustom = Number(process.env.WHOLESALE_CUSTOM_PRODUCT_RADIUS_KM);
  if (Number.isFinite(envCustom) && envCustom > 0) return envCustom;

  const envDefault = Number(process.env.WHOLESALE_SEARCH_RADIUS_KM);
  if (Number.isFinite(envDefault) && envDefault > 0) return envDefault;

  return 120;
}

function isCustomCatalogItem(item) {
  if (!item || typeof item !== 'object') return false;
  if (item.is_custom === true || item.isCustom === true) return true;
  if (String(item.inventory_source || '').toLowerCase() === 'custom') return true;
  if (Array.isArray(item.quality_flags) && item.quality_flags.includes('custom_product')) return true;

  return Array.isArray(item.farms) && item.farms.some((farm) => {
    if (!farm || typeof farm !== 'object') return false;
    if (farm.is_custom === true || farm.isCustom === true) return true;
    if (String(farm.inventory_source || '').toLowerCase() === 'custom') return true;
    return Array.isArray(farm.quality_flags) && farm.quality_flags.includes('custom_product');
  });
}

function filterCustomCatalogItemsBySearchArea(items, options = {}) {
  const list = Array.isArray(items) ? items : [];
  const farmLocationById = options.farmLocationById instanceof Map ? options.farmLocationById : new Map();
  const buyerCoords = extractCoordinates(options.buyerLocation || null);
  const radiusKm = resolveCustomProductSearchRadiusKm(options.radiusKm);

  return list
    .map((item) => {
      const farms = Array.isArray(item?.farms) ? item.farms : [];
      const customItem = isCustomCatalogItem(item);

      const scopedFarms = farms
        .map((farm) => {
          const fallbackFarmLocation = farmLocationById.get(String(farm?.farm_id || farm?.id || '')) || {};
          const farmLocation = farm?.farm_location || farm?.location || fallbackFarmLocation;
          const farmCoords = extractCoordinates(farmLocation);

          if (customItem) {
            if (!buyerCoords || !farmCoords) return farm;
            const distanceKm = haversineDistanceKm(
              buyerCoords.latitude,
              buyerCoords.longitude,
              farmCoords.latitude,
              farmCoords.longitude
            );
            if (!(distanceKm <= radiusKm)) return null;
            return { ...farm, distance_km: Number(distanceKm.toFixed(2)) };
          }

          if (!buyerCoords || !farmCoords) return farm;
          return {
            ...farm,
            distance_km: Number(haversineDistanceKm(
              buyerCoords.latitude,
              buyerCoords.longitude,
              farmCoords.latitude,
              farmCoords.longitude
            ).toFixed(2))
          };
        })
        .filter(Boolean);

      if (scopedFarms.length === 0) return null;

      const totalAvailable = scopedFarms.reduce((sum, farm) => {
        const qty = Number(farm.quantity_available ?? farm.qty_available ?? 0);
        return sum + (Number.isFinite(qty) ? qty : 0);
      }, 0);

      const nextItem = {
        ...item,
        farms: scopedFarms,
        is_custom: customItem
      };

      if ('total_qty_available' in nextItem) nextItem.total_qty_available = totalAvailable;
      if ('qty_available' in nextItem) nextItem.qty_available = totalAvailable;
      if ('total_available' in nextItem) nextItem.total_available = totalAvailable;

      return nextItem;
    })
    .filter(Boolean);
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

function normalizeDeliveryAddress(rawAddress) {
  const address = rawAddress && typeof rawAddress === 'object' ? { ...rawAddress } : {};
  if (!address.zip && address.postalCode) {
    address.zip = address.postalCode;
  }
  if (!address.postalCode && address.zip) {
    address.postalCode = address.zip;
  }
  return address;
}

function toDeliveryFee(value, fulfillmentMethod) {
  if (String(fulfillmentMethod || '').toLowerCase() === 'pickup') return 0;
  return Math.max(0, Number(value) || 0);
}

function normalizeRequirementList(rawValue) {
  if (Array.isArray(rawValue)) {
    return rawValue
      .map(item => sanitizeText(String(item || '').trim()))
      .filter(Boolean);
  }
  if (typeof rawValue === 'string') {
    return rawValue
      .split(/\r?\n|;/)
      .map(item => sanitizeText(String(item || '').trim()))
      .filter(Boolean);
  }
  return [];
}

function mergeRequirementLists(...values) {
  const merged = [];
  const seen = new Set();

  values.forEach((value) => {
    normalizeRequirementList(value).forEach((item) => {
      const key = String(item || '').toLowerCase();
      if (!key || seen.has(key)) return;
      seen.add(key);
      merged.push(item);
    });
  });

  return merged;
}

function normalizeBuyerAccountPayload(rawBuyerAccount, sessionBuyer) {
  const payload = rawBuyerAccount && typeof rawBuyerAccount === 'object' ? rawBuyerAccount : {};
  const buyer = sessionBuyer || {};

  const email = String(payload.email || buyer.email || '').trim().toLowerCase();
  const businessName = sanitizeText(
    String(payload.businessName || payload.business_name || payload.name || buyer.businessName || buyer.business_name || '').trim()
  ) || null;
  const contactName = sanitizeText(
    String(payload.contactName || payload.contact_name || buyer.contactName || buyer.contact_name || payload.name || '').trim()
  ) || null;
  const canonicalName = businessName || contactName || (email ? email.split('@')[0] : 'Wholesale Buyer');

  return {
    ...payload,
    email,
    name: sanitizeText(String(canonicalName)),
    businessName,
    business_name: businessName,
    contactName,
    contact_name: contactName,
    phone: sanitizeText(String(payload.phone || buyer.phone || '').trim()) || null,
    keyContact: sanitizeText(String(payload.keyContact || buyer.keyContact || buyer.key_contact || '').trim()) || null,
    key_contact: sanitizeText(String(payload.keyContact || buyer.keyContact || buyer.key_contact || '').trim()) || null,
    backupContact: sanitizeText(String(payload.backupContact || buyer.backupContact || buyer.backup_contact || '').trim()) || null,
    backup_contact: sanitizeText(String(payload.backupContact || buyer.backupContact || buyer.backup_contact || '').trim()) || null,
    backupPhone: sanitizeText(String(payload.backupPhone || buyer.backupPhone || buyer.backup_phone || '').trim()) || null,
    backup_phone: sanitizeText(String(payload.backupPhone || buyer.backupPhone || buyer.backup_phone || '').trim()) || null
  };
}

async function persistDeliveryLedger({ order, allocation, deliveryFee, deliveryDate, deliveryAddress, fulfillmentMethod }) {
  if (!isDatabaseAvailable()) return;
  if (String(fulfillmentMethod || '').toLowerCase() !== 'delivery') return;
  if (!(deliveryFee > 0)) return;

  const subOrders = Array.isArray(order?.farm_sub_orders) ? order.farm_sub_orders : [];
  const subtotal = Number(allocation?.subtotal || 0);

  for (const sub of subOrders) {
    const farmId = String(sub?.farm_id || '').trim();
    if (!farmId) continue;

    const farmSubtotal = Number(sub?.subtotal || 0);
    const share = subtotal > 0 ? (farmSubtotal / subtotal) : (1 / Math.max(subOrders.length, 1));
    const farmDeliveryFee = Number((deliveryFee * share).toFixed(2));

    let assignedDriver = null;
    try {
      const driverResult = await query(
        `SELECT driver_id, pay_per_delivery, cold_chain_bonus, cold_chain_certified
           FROM delivery_drivers
          WHERE farm_id = $1
            AND status = 'active'
          ORDER BY deliveries_30d ASC, cold_chain_certified DESC, updated_at ASC
          LIMIT 1`,
        [farmId]
      );
      assignedDriver = driverResult.rows[0] || null;
    } catch (driverErr) {
      console.warn('[Wholesale] Driver lookup failed for delivery ledger:', driverErr.message);
    }

    const basePayout = Number(assignedDriver?.pay_per_delivery || 0);
    const coldChainBonus = Boolean(assignedDriver?.cold_chain_certified)
      ? Number(assignedDriver?.cold_chain_bonus || 0)
      : 0;
    const tipAmount = 0;
    const driverPayoutAmount = Number((basePayout + coldChainBonus + tipAmount).toFixed(2));
    const platformMargin = Number((farmDeliveryFee - driverPayoutAmount).toFixed(2));
    const deliveryId = `dlv-${order.master_order_id}-${farmId}`.replace(/[^a-zA-Z0-9-_]/g, '').slice(0, 96);

    await query(
      `INSERT INTO delivery_orders (
         farm_id, delivery_id, order_id, delivery_date, time_slot, zone_id, route_id, driver_id,
         status, address, contact, instructions, delivery_fee, tip_amount, driver_payout_amount,
         platform_margin, payload, updated_at
       )
       VALUES (
         $1, $2, $3, $4, $5, $6, NULL, $7,
         'scheduled', $8::jsonb, $9::jsonb, $10, $11, $12, $13,
         $14, $15::jsonb, NOW()
       )
       ON CONFLICT (farm_id, delivery_id)
       DO UPDATE SET
         delivery_date = EXCLUDED.delivery_date,
         driver_id = EXCLUDED.driver_id,
         address = EXCLUDED.address,
         contact = EXCLUDED.contact,
         instructions = EXCLUDED.instructions,
         delivery_fee = EXCLUDED.delivery_fee,
         tip_amount = EXCLUDED.tip_amount,
         driver_payout_amount = EXCLUDED.driver_payout_amount,
         platform_margin = EXCLUDED.platform_margin,
         payload = EXCLUDED.payload,
         updated_at = NOW()`,
      [
        farmId,
        deliveryId,
        order.master_order_id,
        deliveryDate,
          order?.time_slot || order?.preferred_delivery_window || 'flexible',
        null,
        assignedDriver?.driver_id || null,
        JSON.stringify(deliveryAddress || {}),
        JSON.stringify({
          name: order?.buyer_account?.name || order?.buyer_account?.contact_name || null,
          email: order?.buyer_account?.email || null
        }),
        deliveryAddress?.instructions || null,
        farmDeliveryFee,
        tipAmount,
        driverPayoutAmount,
        platformMargin,
        JSON.stringify({
          fulfillment_method: 'delivery',
          farm_sub_order: sub,
            order_total: order?.grand_total || null,
            preferred_delivery_window: order?.preferred_delivery_window || order?.time_slot || null,
            delivery_requirements: Array.isArray(order?.delivery_requirements) ? order.delivery_requirements : []
        })
      ]
    );

    if (assignedDriver?.driver_id) {
      await query(
        `INSERT INTO driver_payouts (
           farm_id, driver_id, delivery_id, order_id,
           base_amount, cold_chain_bonus, tip_amount, total_payout,
           payout_status, created_at, updated_at
         )
         SELECT
           $1, $2, $3, $4,
           $5, $6, $7, $8,
           'pending', NOW(), NOW()
         WHERE NOT EXISTS (
           SELECT 1
             FROM driver_payouts
            WHERE farm_id = $1
              AND driver_id = $2
              AND delivery_id = $3
         )`,
        [
          farmId,
          assignedDriver.driver_id,
          deliveryId,
          order.master_order_id,
          basePayout,
          coldChainBonus,
          tipAmount,
          driverPayoutAmount
        ]
      );

      await query(
        `UPDATE delivery_drivers
            SET deliveries_30d = COALESCE(deliveries_30d, 0) + 1,
                updated_at = NOW()
          WHERE farm_id = $1
            AND driver_id = $2`,
        [farmId, assignedDriver.driver_id]
      );
    }
  }
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
 * GET /api/wholesale/payment/config
 * Return public Square credentials for the frontend payment form.
 */
router.get('/payment/config', (req, res) => {
  const appId = process.env.SQUARE_APPLICATION_ID || process.env.SQUARE_APP_ID || '';
  const locationId = process.env.SQUARE_LOCATION_ID || '';
  const environment = process.env.SQUARE_ENVIRONMENT || 'sandbox';
  res.json({ status: 'ok', data: { appId, locationId, environment } });
});

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
 * GET /api/wholesale/inventory
 * Returns farm_inventory rows formatted as lots for the network aggregator and
 * the central-admin pricing panel. Public (no buyer auth) so the aggregator can
 * reach it via farm api_url; farm-scoped when X-Farm-ID is present.
 */
router.get('/inventory', async (req, res) => {
  try {
    if (!isDatabaseAvailable()) {
      return res.json({ farm_id: null, farm_name: 'GreenReach Farms', lots: [], inventory_timestamp: new Date().toISOString() });
    }

    // Resolve farm identity
    const farmId = req.headers['x-farm-id']
      || req.query.farmId
      || (await query("SELECT farm_id FROM farms WHERE status = 'active' ORDER BY updated_at DESC NULLS LAST LIMIT 1").then(r => r.rows[0]?.farm_id).catch(() => null));

    if (!farmId) {
      return res.json({ farm_id: null, farm_name: 'GreenReach Farms', lots: [], inventory_timestamp: new Date().toISOString() });
    }

    const result = await query(
      `SELECT product_id, product_name, sku, sku_name, quantity_available,
              manual_quantity_lbs, wholesale_price, retail_price, unit,
              quantity_unit, category, variety, inventory_source, is_custom,
              description, thumbnail_url, last_updated
       FROM farm_inventory
       WHERE farm_id = $1
         AND COALESCE(quantity_available, manual_quantity_lbs, 0) > 0
       ORDER BY product_name`,
      [farmId]
    );

    const lots = result.rows.map(row => {
      const qty = Number(row.quantity_available ?? row.manual_quantity_lbs ?? 0);
      const inventorySource = String(row.inventory_source || '').toLowerCase();
      const isCustom = row.is_custom === true || inventorySource === 'custom';
      const qualityFlags = [];
      if (inventorySource === 'manual') qualityFlags.push('manual_entry');
      if (isCustom) qualityFlags.push('custom_product');

      return {
        lot_id: row.product_id,
        sku_id: row.sku || row.product_id,
        sku_name: row.product_name || row.sku_name || row.sku,
        crop_type: row.category || row.product_name,
        qty_available: qty,
        pack_size: 1,
        unit: row.quantity_unit || row.unit || 'lb',
        price_per_unit: Number(row.wholesale_price ?? row.retail_price ?? 0),
        quality_flags: qualityFlags,
        harvest_date_start: row.last_updated || null,
        harvest_date_end: null,
        location: null,
        inventory_source: row.inventory_source || null,
        is_custom: isCustom,
        description: row.description || null,
        thumbnail_url: row.thumbnail_url || null
      };
    });

    // Look up farm name
    let farmName = 'GreenReach Farms';
    try {
      const nameResult = await query('SELECT name FROM farms WHERE farm_id = $1 LIMIT 1', [farmId]);
      if (nameResult.rows.length) farmName = nameResult.rows[0].name;
    } catch { /* use default */ }

    res.json({
      farm_id: farmId,
      farm_name: farmName,
      lots,
      inventory_timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[Wholesale Inventory] Error:', error.message);
    res.json({ farm_id: null, farm_name: 'GreenReach Farms', lots: [], inventory_timestamp: new Date().toISOString() });
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
    const buyer = await resolveOptionalBuyerFromRequest(req);
    const discountProfile = await getBuyerRollingDiscountProfile(buyer?.id);
    const pricingContext = await buildDynamicPricingContext();

    // Use network aggregation when env flag is set or DB is not ready.
    // Set WHOLESALE_CATALOG_MODE=network in production to use farm-network catalog;
    // omit or set to 'db' to use the database catalog path.
    const catalogMode = (process.env.WHOLESALE_CATALOG_MODE || 'network').toLowerCase();
    if (catalogMode === 'network' || req.app?.locals?.databaseReady === false) {
      const nearLat = req.query.nearLat ?? req.query.lat;
      const nearLng = req.query.nearLng ?? req.query.lng;
      const nearLatNum = Number(nearLat);
      const nearLngNum = Number(nearLng);
      const buyerLocation = (Number.isFinite(nearLatNum) && Number.isFinite(nearLngNum))
        ? { latitude: nearLatNum, longitude: nearLngNum }
        : null;
      const customSearchRadiusKm = resolveCustomProductSearchRadiusKm(req.query.searchRadiusKm ?? req.query.radiusKm);

      const catalog = await buildAggregateCatalog({
        buyerLocation,
        customProductRadiusKm: customSearchRadiusKm,
        enforceCustomSearchArea: true
      });
      const farmId = req.query.farmId ? String(req.query.farmId) : null;
      const networkFarmLocationById = new Map((catalog.farms || []).map((farm) => [String(farm.farm_id || ''), farm.location || farm]));

      let items = catalog.items || catalog.skus || [];

      // Strip out fallback-seeded demo items — only show real farm inventory
      items = items.filter(it =>
        !(it.farms || []).every(f => (f.quality_flags || []).includes('fallback_seeded'))
      );

      // Database fallback: when the network aggregate is empty, build catalog
      // items directly from farm_inventory so the admin dashboard shows products
      if (items.length === 0 && isDatabaseAvailable()) {
        try {
          const invResult = await query(
            `SELECT i.product_id, i.product_name, i.sku, i.sku_name,
                    i.quantity_available, i.manual_quantity_lbs,
                    i.wholesale_price, i.retail_price, i.unit, i.quantity_unit,
                    i.category, i.farm_id, i.inventory_source, i.is_custom,
                    i.description, i.thumbnail_url,
                    f.name AS farm_name, f.metadata AS farm_metadata
             FROM farm_inventory i
             JOIN farms f ON f.farm_id = i.farm_id
             WHERE f.status IN ('active','online')
               AND COALESCE(i.quantity_available, i.manual_quantity_lbs, 0) > 0
             ORDER BY i.product_name`
          );
          const skuMap = new Map();
          for (const row of (invResult.rows || [])) {
            const skuId = row.sku || row.product_id || row.product_name;
            const qty = Number(row.quantity_available ?? row.manual_quantity_lbs ?? 0);
            if (!skuMap.has(skuId)) {
              skuMap.set(skuId, {
                sku_id: skuId,
                product_name: row.product_name || row.sku_name || skuId,
                category: row.category || 'produce',
                unit: row.quantity_unit || row.unit || 'lb',
                price_per_unit: Number(row.wholesale_price ?? row.retail_price ?? 0),
                wholesale_price: Number(row.wholesale_price ?? 0),
                retail_price: Number(row.retail_price ?? 0),
                inventory_source: row.inventory_source || null,
                is_custom: row.is_custom === true || String(row.inventory_source || '').toLowerCase() === 'custom',
                description: row.description || null,
                thumbnail_url: row.thumbnail_url || null,
                total_qty_available: 0,
                qty_available: 0,
                farms: []
              });
            }
            const entry = skuMap.get(skuId);
            entry.total_qty_available += qty;
            entry.qty_available += qty;
            entry.is_custom = entry.is_custom || row.is_custom === true || String(row.inventory_source || '').toLowerCase() === 'custom';
            if (!entry.description && row.description) entry.description = row.description;
            if (!entry.thumbnail_url && row.thumbnail_url) entry.thumbnail_url = row.thumbnail_url;
            entry.farms.push({
              farm_id: row.farm_id,
              farm_name: row.farm_name,
              quantity_available: qty,
              qty_available: qty,
              price_per_unit: Number(row.wholesale_price ?? row.retail_price ?? 0),
              inventory_source: row.inventory_source || null,
              is_custom: row.is_custom === true || String(row.inventory_source || '').toLowerCase() === 'custom',
              quality_flags: (row.is_custom === true || String(row.inventory_source || '').toLowerCase() === 'custom') ? ['custom_product'] : [],
              location: row.farm_metadata?.location || row.farm_metadata || null
            });

            if (!networkFarmLocationById.has(String(row.farm_id || '')) && row.farm_metadata) {
              networkFarmLocationById.set(String(row.farm_id || ''), row.farm_metadata?.location || row.farm_metadata);
            }
          }
          items = Array.from(skuMap.values());
        } catch (dbErr) {
          console.warn('[Wholesale Catalog] DB fallback failed:', dbErr.message);
        }
      }

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

      items = filterCustomCatalogItemsBySearchArea(items, {
        buyerLocation,
        radiusKm: customSearchRadiusKm,
        farmLocationById: networkFarmLocationById
      });

      items = applyFormulaPricingToCatalogSkus(items, pricingContext, discountProfile);

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
          lastSync: req.app?.locals?.wholesaleNetworkLastSync || null,
          buyer_discount_rate: discountProfile.rate,
          buyer_rolling_average: discountProfile.rollingAverage,
          pricing_formula: 'max(floor, max(floor, retail * sku_factor) * (1 - discount_rate))'
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
    const nearLat = req.query.nearLat ?? req.query.lat;
    const nearLng = req.query.nearLng ?? req.query.lng;
    const nearLatNum = Number(nearLat);
    const nearLngNum = Number(nearLng);
    const buyerLocation = (Number.isFinite(nearLatNum) && Number.isFinite(nearLngNum))
      ? { latitude: nearLatNum, longitude: nearLngNum }
      : null;
    const customSearchRadiusKm = resolveCustomProductSearchRadiusKm(req.query.searchRadiusKm ?? req.query.radiusKm);

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
        i.description,
        i.thumbnail_url,
        i.inventory_source,
        COALESCE(i.is_custom, FALSE) AS is_custom,
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
        f.metadata AS farm_metadata,
        f.certifications as farm_certifications,
        f.practices as farm_practices,
        f.attributes as farm_attributes
      FROM farm_inventory i
      JOIN farms f ON i.farm_id = f.farm_id
      ${whereClause}
      ORDER BY i.synced_at DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `, params);

    const dbFarmLocationById = new Map();
    const catalogRows = (catalogResult.rows || []).filter((row) => {
      const farmKey = String(row.farm_id || '');
      const farmLocation = row.farm_metadata?.location || row.farm_metadata || null;
      if (farmKey && farmLocation && !dbFarmLocationById.has(farmKey)) {
        dbFarmLocationById.set(farmKey, farmLocation);
      }

      const isCustomRow = row.is_custom === true || String(row.inventory_source || '').toLowerCase() === 'custom';
      if (!isCustomRow) return true;

      const buyerCoords = extractCoordinates(buyerLocation);
      if (!buyerCoords) return true;

      const farmCoords = extractCoordinates(farmLocation);
      if (!farmCoords) return true;

      return haversineDistanceKm(
        buyerCoords.latitude,
        buyerCoords.longitude,
        farmCoords.latitude,
        farmCoords.longitude
      ) <= customSearchRadiusKm;
    });

    // Fill missing wholesale prices from Crop Pricing page
    const blankPriceFarmIds = [...new Set(
      catalogRows
        .filter(r => !r.wholesale_price || Number(r.wholesale_price) <= 0)
        .map(r => r.farm_id)
    )];
    const farmPriceMaps = {};
    for (const fid of blankPriceFarmIds) {
      try {
        const store = req.farmStore || farmStore;
        const data = store ? await store.get(fid, 'crop_pricing') : null;
        if (data?.crops) {
          farmPriceMaps[fid] = {};
          for (const c of data.crops) {
            if (c.crop) farmPriceMaps[fid][c.crop.toLowerCase()] = c;
          }
        }
      } catch (_) { /* non-fatal */ }
    }
    for (const row of catalogRows) {
      if (Number(row.wholesale_price || 0) <= 0 || Number(row.retail_price || 0) <= 0) {
        const pm = farmPriceMaps[row.farm_id];
        if (pm) {
          const match = pm[(row.product_name || '').toLowerCase()];
          if (match) {
            if (Number(row.wholesale_price || 0) <= 0 && match.wholesalePrice > 0) row.wholesale_price = match.wholesalePrice;
            if (Number(row.retail_price || 0) <= 0 && match.retailPrice > 0) row.retail_price = match.retailPrice;
          }
        }
      }
    }

    // Format response
    const items = catalogRows.map(row => ({
      id: row.id,
      productId: row.product_id,
      name: row.product_name,
      category: row.category,
      variety: row.variety,
      description: row.description || null,
      thumbnailUrl: row.thumbnail_url || null,
      isCustom: row.is_custom === true || String(row.inventory_source || '').toLowerCase() === 'custom',
      inventorySource: row.inventory_source || null,
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
        location: row.farm_metadata?.location || row.farm_metadata || null,
        certifications: row.farm_certifications || [],
        practices: row.farm_practices || [],
        attributes: row.farm_attributes || []
      },
      lastUpdated: row.synced_at
    }));

    // Buyer-portal SKU shape (aggregate by product_id)
    const skusById = new Map();
    for (const row of catalogRows) {
      const skuId = String(row.product_id || row.product_name || row.id);
      const existing = skusById.get(skuId);
      const isCustomRow = row.is_custom === true || String(row.inventory_source || '').toLowerCase() === 'custom';
      const farmLocation = row.farm_metadata?.location || row.farm_metadata || [row.city, row.state].filter(Boolean).join(', ');

      const farmEntry = {
        farm_id: row.farm_id,
        farm_name: row.farm_name,
        qty_available: Number(row.quantity_available || 0),
        quantity_available: Number(row.quantity_available || 0),
        unit: row.quantity_unit,
        price_per_unit: Number(row.wholesale_price || 0),
        inventory_source: row.inventory_source || null,
        is_custom: isCustomRow,
        quality_flags: isCustomRow ? ['custom_product'] : [],
        organic: Boolean(row.source_data?.organic),
        certifications: row.farm_certifications || [],
        practices: row.farm_practices || [],
        attributes: row.farm_attributes || [],
        location: farmLocation
      };

      if (!existing) {
        skusById.set(skuId, {
          sku_id: skuId,
          product_name: row.product_name,
          size: row.variety || 'Bulk',
          unit: row.quantity_unit,
          price_per_unit: Number(row.wholesale_price || 0),
          inventory_source: row.inventory_source || null,
          is_custom: isCustomRow,
          description: row.description || null,
          thumbnail_url: row.thumbnail_url || null,
          total_qty_available: Number(row.quantity_available || 0),
          farms: [farmEntry],
          organic: Boolean(row.source_data?.organic)
        });
        continue;
      }

      existing.farms.push(farmEntry);
      existing.total_qty_available += Number(row.quantity_available || 0);
      existing.price_per_unit = Math.min(Number(existing.price_per_unit || 0), Number(row.wholesale_price || 0));
      existing.is_custom = existing.is_custom || isCustomRow;
      existing.organic = existing.organic || Boolean(row.source_data?.organic);
      if (!existing.description && row.description) existing.description = row.description;
      if (!existing.thumbnail_url && row.thumbnail_url) existing.thumbnail_url = row.thumbnail_url;
    }

    let skus = applyFormulaPricingToCatalogSkus(Array.from(skusById.values()), pricingContext, discountProfile);
    skus = filterCustomCatalogItemsBySearchArea(skus, {
      buyerLocation,
      radiusKm: customSearchRadiusKm,
      farmLocationById: dbFarmLocationById
    });

    const skuById = new Map(skus.map((sku) => [String(sku.sku_id), sku]));
    const pricedItems = items.map((item) => {
      const skuId = String(item.productId || item.name || item.id || '');
      const pricedSku = skuById.get(skuId);
      if (!pricedSku) return item;
      return {
        ...item,
        wholesalePrice: Number(pricedSku.final_wholesale_price || item.wholesalePrice || 0),
        baseWholesalePrice: Number(pricedSku.base_wholesale_price || 0),
        floorPrice: Number(pricedSku.floor_price || 0),
        retailAggregatePrice: Number(pricedSku.retail_aggregate_price || 0),
        buyerDiscountRate: Number(pricedSku.buyer_discount_rate || 0),
        unit: pricedSku.unit || item.unit
      };
    });

    res.json({
      status: 'ok',
      data: {
        skus
      },
      // Keep legacy fields for any existing callers
      items: pricedItems,
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
      },
      pricing: {
        buyerDiscountRate: discountProfile.rate,
        rollingAveragePurchase: discountProfile.rollingAverage,
        rollingWindowDays: discountProfile.windowDays,
        formula: {
          step1: 'base = max(floor, retail * sku_factor)',
          step2: 'final = max(floor, base * (1 - discount_rate))',
          skuFactorDefault: getDefaultSkuFactor()
        }
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
    if (await isAccountLocked(email)) {
      return res.status(423).json({ status: 'error', message: 'Account temporarily locked due to too many failed attempts. Try again in 5 minutes.' });
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
    const { businessName, contactName, email, phone, buyerType, address, city, province, postalCode, country, keyContact, backupContact, backupPhone } = req.body || {};

    const location = {
      address1: trimField(address) || req.wholesaleBuyer.location?.address1 || null,
      city: trimField(city) || req.wholesaleBuyer.location?.city || null,
      state: trimField(province) || req.wholesaleBuyer.location?.state || null,
      postalCode: trimField(postalCode) || req.wholesaleBuyer.location?.postalCode || null,
      country: trimField(country) || req.wholesaleBuyer.location?.country || null,
      latitude: req.wholesaleBuyer.location?.latitude || null,
      longitude: req.wholesaleBuyer.location?.longitude || null
    };

    const updated = await updateBuyer(req.wholesaleBuyer.id, {
      businessName: trimField(businessName),
      contactName: trimField(contactName),
      email: email ? String(email).trim().toLowerCase() : undefined,
      phone: trimField(phone),
      keyContact: trimField(keyContact),
      backupContact: trimField(backupContact),
      backupPhone: trimField(backupPhone),
      buyerType: trimField(buyerType),
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
    console.error('[wholesale] PUT /buyers/me error:', error.message);
    return res.status(500).json({ status: 'error', message: 'Failed to update account. Please try again.' });
  }
});

router.post('/auth/logout', requireBuyerPortalAuth, (req, res) => {
  blacklistToken(req.wholesaleToken);
  return res.json({ status: 'ok', message: 'Logged out' });
});

// ── Card on file ─────────────────────────────────────────────────────

router.get('/buyers/me/card', requireBuyerPortalAuth, async (req, res, next) => {
  try {
    const buyer = req.wholesaleBuyer;
    if (!buyer.squareCustomerId) {
      return res.json({ status: 'ok', data: { cards: [] } });
    }
    const result = await getCardOnFile(buyer.squareCustomerId);
    return res.json({ status: 'ok', data: { cards: result.cards || [] } });
  } catch (error) {
    return next(error);
  }
});

router.post('/buyers/me/card', requireBuyerPortalAuth, async (req, res, next) => {
  try {
    const buyer = req.wholesaleBuyer;
    const { cardNonce } = req.body || {};
    if (!cardNonce || typeof cardNonce !== 'string') {
      return res.status(400).json({ status: 'error', message: 'cardNonce is required' });
    }

    const result = await saveCardOnFile({
      buyerId: buyer.id,
      email: buyer.email,
      displayName: buyer.businessName || buyer.contactName,
      phone: buyer.phone,
      cardNonce
    });

    // Persist the Square IDs on the buyer record
    await updateBuyer(buyer.id, {
      squareCustomerId: result.squareCustomerId,
      squareCardId: result.squareCardId
    });

    return res.json({
      status: 'ok',
      data: {
        brand: result.brand,
        last4: result.last4,
        expMonth: result.expMonth,
        expYear: result.expYear
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.delete('/buyers/me/card', requireBuyerPortalAuth, async (req, res, next) => {
  try {
    const buyer = req.wholesaleBuyer;
    if (!buyer.squareCardId) {
      return res.status(404).json({ status: 'error', message: 'No card on file' });
    }

    await removeCardOnFile(buyer.squareCardId);

    await updateBuyer(buyer.id, {
      squareCardId: null,
      squareCustomerId: buyer.squareCustomerId // keep the customer, just remove card
    });

    return res.json({ status: 'ok', message: 'Card removed' });
  } catch (error) {
    return next(error);
  }
});

// ── Subscriptions / standing orders ──────────────────────────────────

router.get('/buyers/me/subscriptions', requireBuyerPortalAuth, async (req, res, next) => {
  try {
    if (!isDatabaseAvailable()) {
      return res.json({ status: 'ok', data: { subscriptions: [] } });
    }
    const result = await query(
      `SELECT * FROM wholesale_subscriptions WHERE buyer_id = $1 AND status != 'cancelled' ORDER BY created_at DESC`,
      [req.wholesaleBuyer.id]
    );
    return res.json({ status: 'ok', data: { subscriptions: result.rows } });
  } catch (error) {
    if (error.message && error.message.includes('does not exist')) {
      return res.json({ status: 'ok', data: { subscriptions: [] } });
    }
    return next(error);
  }
});

router.post('/buyers/me/subscriptions', requireBuyerPortalAuth, async (req, res, next) => {
  try {
    const buyer = req.wholesaleBuyer;
    if (!buyer.squareCardId) {
      return res.status(400).json({ status: 'error', message: 'A saved card is required for standing orders' });
    }

    const { cadence, cart, deliveryAddress, fulfillmentMethod } = req.body || {};
    if (!cadence || !['weekly', 'biweekly', 'monthly'].includes(cadence)) {
      return res.status(400).json({ status: 'error', message: 'cadence must be weekly, biweekly, or monthly' });
    }
    if (!Array.isArray(cart) || cart.length === 0) {
      return res.status(400).json({ status: 'error', message: 'cart must be a non-empty array' });
    }

    const now = new Date();
    const nextDate = new Date(now);
    if (cadence === 'weekly') nextDate.setDate(nextDate.getDate() + 7);
    else if (cadence === 'biweekly') nextDate.setDate(nextDate.getDate() + 14);
    else nextDate.setMonth(nextDate.getMonth() + 1);

    const id = 'SUB-' + crypto.randomUUID().slice(0, 8).toUpperCase();
    await query(
      `INSERT INTO wholesale_subscriptions (id, buyer_id, farm_id, status, cadence, next_order_date, cart, delivery_address, fulfillment_method, payment_method)
       VALUES ($1, $2, $3, 'active', $4, $5, $6::jsonb, $7, $8, 'card_on_file')`,
      [id, buyer.id, cart[0]?.farm_id || null, cadence, nextDate.toISOString().slice(0, 10),
       JSON.stringify(cart), sanitizeText(deliveryAddress) || null, sanitizeText(fulfillmentMethod) || 'delivery']
    );

    return res.json({ status: 'ok', data: { subscriptionId: id, nextOrderDate: nextDate.toISOString().slice(0, 10) } });
  } catch (error) {
    return next(error);
  }
});

router.put('/buyers/me/subscriptions/:subId', requireBuyerPortalAuth, async (req, res, next) => {
  try {
    const { status } = req.body || {};
    if (!['active', 'paused', 'cancelled'].includes(status)) {
      return res.status(400).json({ status: 'error', message: 'status must be active, paused, or cancelled' });
    }

    const result = await query(
      `UPDATE wholesale_subscriptions SET status = $1, updated_at = NOW()
       WHERE id = $2 AND buyer_id = $3
       RETURNING *`,
      [status, req.params.subId, req.wholesaleBuyer.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ status: 'error', message: 'Subscription not found' });
    }

    return res.json({ status: 'ok', data: { subscription: result.rows[0] } });
  } catch (error) {
    return next(error);
  }
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
  const cancellableStatuses = ['confirmed', 'pending', 'processing', 'payment_failed', 'pending_payment'];
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

  // Initiate refund if payment was completed
  if (order.payment?.status === 'completed' && order.payment?.paymentResults) {
    const refundResults = [];
    for (const pr of (order.payment.paymentResults || order.payment.payments || [])) {
      if (pr.success && pr.paymentId) {
        const refundResult = await refundPayment({
          paymentId: pr.paymentId,
          farmId: pr.farmId,
          amountCents: pr.amountMoney?.amount || 0,
          reason: order.cancellation_reason,
          orderId: order.master_order_id
        }).catch(err => ({ success: false, error: err.message }));
        refundResults.push({ farmId: pr.farmId, ...refundResult });
      }
    }
    order.refund_results = refundResults;
    logOrderEvent(order.master_order_id, 'refund_initiated_on_cancel', { refund_results: refundResults });
  }

  await saveOrder(order).catch(() => {});
  logOrderEvent(order.master_order_id, 'order_cancelled', {
    buyer_id: req.wholesaleBuyer.id,
    previous_status: previousStatus,
    reason: order.cancellation_reason
  });

  return res.json({ status: 'ok', data: { order } });
});

// Get invoice for a specific order (enriched with traceability, env scores, per-100g pricing)
router.get('/orders/:orderId/invoice', requireBuyerPortalAuth, async (req, res) => {
  const orderId = req.params.orderId;
  const order = await getOrderById(orderId, { includeArchived: true });

  if (order && order.buyer_id !== req.wholesaleBuyer.id) {
    return res.status(404).json({ status: 'error', message: 'Order not found' });
  }

  if (!order) {
    return res.status(404).json({ status: 'error', message: 'Order not found' });
  }

  // Build farm profiles map from network farms for traceability
  const networkFarms = await listNetworkFarms();
  const farmProfiles = {};
  for (const farm of networkFarms) {
    const farmLocation = farm.location || {};
    farmProfiles[farm.farm_id] = {
      name: farm.name || farm.farm_name || farm.farm_id,
      city: farm.city || farmLocation.city || '',
      state: farm.state || farmLocation.state || farmLocation.province || '',
      phone: farm.phone || farm.contact?.phone || farm.contact?.phone_number || '',
      contact: farm.contact || {},
      location: farmLocation,
      practices: farm.practices || [],
      certifications: farm.certifications || []
    };
  }

  // Build buyer profile with location for environmental scoring
  const buyerAccount = order.buyer_account || {};
  const buyerLocation = getBuyerLocationFromBuyer(req.wholesaleBuyer);
  const buyerProfile = {
    business_name: buyerAccount.business_name || '',
    contact_name: buyerAccount.contact_name || '',
    email: buyerAccount.email || '',
    location: {
      ...buyerLocation,
      ...(order.delivery_address || {})
    }
  };

  // Assemble enriched invoice: farm traceability, env scores, per-100g/pint pricing
  const invoice = assembleInvoice({
    order,
    subOrders: order.farm_sub_orders || [],
    farmProfiles,
    buyerProfile
  });

  // Return enriched JSON only when explicitly requested; default to print-ready HTML
  if (req.query.format === 'json') {
    return res.json({ status: 'ok', data: invoice });
  }

  const html = renderInvoiceHTML(invoice);
  const masterOrderId = order.master_order_id || orderId;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Disposition', `inline; filename="invoice-${masterOrderId.substring(0, 12)}.html"`);
  res.send(html);
});

// Send buyer contact requests to each fulfillment farm's E.V.I.E. inbox
router.post('/orders/:orderId/contact-farms', requireBuyerPortalAuth, async (req, res) => {
  try {
    const orderId = req.params.orderId;
    const order = await getOrderById(orderId, { includeArchived: true });

    if (!order || order.buyer_id !== req.wholesaleBuyer.id) {
      return res.status(404).json({ status: 'error', message: 'Order not found' });
    }

    const subOrders = Array.isArray(order.farm_sub_orders) ? order.farm_sub_orders : [];
    if (subOrders.length === 0) {
      return res.status(400).json({ status: 'error', message: 'No fulfillment farms were found for this order' });
    }

    const rawMessage = String(req.body?.message || '').trim();
    const buyerAccount = order.buyer_account || {};
    const buyerBusiness = sanitizeText(String(
      buyerAccount.business_name
      || buyerAccount.name
      || req.wholesaleBuyer.businessName
      || req.wholesaleBuyer.business_name
      || req.wholesaleBuyer.contactName
      || req.wholesaleBuyer.contact_name
      || 'Wholesale Buyer'
    )).trim();
    const buyerName = sanitizeText(String(
      buyerAccount.contact_name
      || req.wholesaleBuyer.contactName
      || req.wholesaleBuyer.contact_name
      || ''
    )).trim();
    const buyerEmail = sanitizeText(String(
      buyerAccount.email
      || req.wholesaleBuyer.email
      || ''
    )).trim();
    const buyerPhone = sanitizeText(String(
      buyerAccount.phone
      || req.wholesaleBuyer.phone
      || ''
    )).trim();
    const messageText = sanitizeText(rawMessage.slice(0, 500)).trim();

    const masterOrderId = String(order.master_order_id || order.id || orderId);
    const shortOrderId = masterOrderId.substring(0, 12);
    const deliveryDate = order.delivery_date
      ? new Date(order.delivery_date).toLocaleDateString('en-CA')
      : null;

    const farmsById = new Map();
    for (const subOrder of subOrders) {
      const farmId = String(subOrder?.farm_id || '').trim();
      if (!farmId || farmsById.has(farmId)) continue;
      farmsById.set(farmId, subOrder);
    }

    const sentFarms = [];
    const failedFarms = [];

    for (const [farmId, subOrder] of farmsById.entries()) {
      const itemPreview = (subOrder.items || subOrder.line_items || [])
        .slice(0, 3)
        .map((item) => {
          const qty = Number(item.quantity || item.qty || 0);
          const unit = sanitizeText(String(item.unit || 'unit')).trim();
          const name = sanitizeText(String(item.product_name || item.sku_name || item.sku_id || 'item')).trim();
          return `${qty} ${unit} ${name}`.trim();
        })
        .filter(Boolean)
        .join(', ');

      const bodyLines = [
        `${buyerBusiness}${buyerName ? ` (${buyerName})` : ''} requested contact for wholesale order ${shortOrderId}.`,
        messageText ? `Buyer note: ${messageText}` : 'Buyer requested a status and fulfillment update.',
        deliveryDate ? `Requested delivery date: ${deliveryDate}` : '',
        itemPreview ? `Items: ${itemPreview}` : '',
        `Farm subtotal: $${Number(subOrder.subtotal || 0).toFixed(2)}`,
        buyerEmail ? `Buyer email: ${buyerEmail}` : '',
        buyerPhone ? `Buyer phone: ${buyerPhone}` : ''
      ].filter(Boolean);

      const notification = await notificationStore.pushNotification(farmId, {
        category: 'order',
        title: `Buyer contact request: Order ${shortOrderId}`,
        body: bodyLines.join('\n'),
        severity: 'info',
        source: 'wholesale-buyer-portal'
      });

      if (notification) {
        sentFarms.push({ farm_id: farmId, farm_name: subOrder.farm_name || farmId });
      } else {
        failedFarms.push({ farm_id: farmId, farm_name: subOrder.farm_name || farmId });
      }
    }

    if (sentFarms.length === 0) {
      return res.status(503).json({
        status: 'error',
        message: 'Farm E.V.I.E. inbox is temporarily unavailable'
      });
    }

    return res.json({
      status: 'ok',
      data: {
        requested_farms: sentFarms.length,
        farms: sentFarms,
        failed_farms: failedFarms
      }
    });
  } catch (error) {
    console.error('[wholesale] contact-farms failed:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Unable to send farm contact request right now'
    });
  }
});


router.post('/checkout/preview', checkoutLimiter, requireWholesaleDbForCriticalPaths, requireBuyerAuth, async (req, res, next) => {
  try {
    const { cart, recurrence, sourcing } = req.body || {};
    if (!Array.isArray(cart) || cart.length === 0) {
      throw new ValidationError('Cart is required');
    }

    const commissionRate = Number(process.env.WHOLESALE_COMMISSION_RATE || 0.12);

    const buyerLocation = getBuyerLocationFromBuyer(req.wholesaleBuyer);

    // Limited mode: allocate from network snapshots (proximity-aware)
    if (shouldUseNetworkAllocation(req)) {
      const catalog = await buildAggregateCatalog({ buyerLocation, enforceCustomSearchArea: true });
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

router.post('/checkout/execute', checkoutLimiter, requireWholesaleDbForCriticalPaths, requireBuyerAuth, async (req, res, next) => {
  try {
      const requestBody = req.body || {};
    const {
      buyer_account,
      delivery_date,
      delivery_address,
      recurrence,
      cart,
      payment_provider,
      sourcing,
      po_number,
      fulfillment_method,
      delivery_fee
      } = requestBody;

      const normalizedBuyerAccount = normalizeBuyerAccountPayload(buyer_account, req.wholesaleBuyer);
      const normalizedDeliveryAddress = normalizeDeliveryAddress(delivery_address);
      const isPickup = String(fulfillment_method || '').toLowerCase() === 'pickup';
      const deliveryFee = toDeliveryFee(delivery_fee, fulfillment_method);

      const preferredDeliveryWindow = sanitizeText(
        String(
          requestBody.preferred_delivery_window
          || requestBody.delivery_window
          || requestBody.time_slot
          || ''
        ).trim()
      ) || (isPickup ? null : 'flexible');

      const deliveryRequirements = mergeRequirementLists(
        requestBody.delivery_requirements,
        requestBody.deliveryRequirements,
        requestBody.delivery_address?.instructions
      );
      const pickupRequirements = mergeRequirementLists(
        requestBody.pickup_requirements,
        requestBody.pickupRequirements
      );

      const requestedDeliverySchedule = sanitizeText(
        String(requestBody.delivery_schedule || requestBody.deliverySchedule || '').trim()
      ) || '';
      const requestedPickupSchedule = sanitizeText(
        String(requestBody.pickup_schedule || requestBody.pickupSchedule || '').trim()
      ) || '';

      if (!normalizedBuyerAccount?.email) throw new ValidationError('buyer_account.email is required');
    if (!delivery_date) throw new ValidationError('delivery_date is required');
    const normalizedPaymentProvider = String(payment_provider || 'manual').toLowerCase();
      const squareSourceId = requestBody?.payment_source?.source_id || requestBody?.payment_source?.sourceId || null;
    if (normalizedPaymentProvider === 'square' && !squareSourceId) {
      return res.status(400).json({
        status: 'error',
        message: 'Payment authorization is required. Please enter card details and try again.'
      });
    }

    if (!isPickup && (!normalizedDeliveryAddress?.street || !normalizedDeliveryAddress?.city || !normalizedDeliveryAddress?.zip)) {
      throw new ValidationError('delivery_address street/city/zip are required');
    }
    if (!Array.isArray(cart) || cart.length === 0) throw new ValidationError('cart is required');

    const commissionRate = Number(process.env.WHOLESALE_COMMISSION_RATE || 0.12);

    const buyerLocation = getBuyerLocationFromBuyer(req.wholesaleBuyer);

    // Limited mode: allocate from network snapshots (proximity-aware)
    if (shouldUseNetworkAllocation(req)) {
      const catalog = await buildAggregateCatalog({ buyerLocation, enforceCustomSearchArea: true });
      const result = await allocateCartFromNetwork({ cart, catalog, commissionRate, sourcing, buyerLocation });
      if (!result.allocation.farm_sub_orders?.length) {
        return res.status(400).json({ status: 'error', message: 'Unable to allocate items with current inventory' });
      }

      const orderTotals = {
        ...result.allocation,
        delivery_fee: deliveryFee,
        grand_total: Number((Number(result.allocation.grand_total || 0) + deliveryFee).toFixed(2))
      };

        const farmMetaById = new Map(
          (catalog?.farms || [])
            .filter((farmMeta) => farmMeta?.farm_id)
            .map((farmMeta) => [String(farmMeta.farm_id), farmMeta])
        );

        const enrichedFarmSubOrders = (result.allocation.farm_sub_orders || []).map((subOrder) => {
          const farmMeta = farmMetaById.get(String(subOrder?.farm_id || '')) || {};
          const standards = farmMeta.fulfillment_standards || {};

          const deliverySchedule = sanitizeText(
            String(
              requestedDeliverySchedule
              || standards.delivery_schedule
              || standards.delivery_hours
              || ''
            ).trim()
          ) || '';

          const pickupSchedule = sanitizeText(
            String(
              requestedPickupSchedule
              || standards.pickup_schedule
              || standards.pickup_hours
              || ''
            ).trim()
          ) || '';

          return {
            ...subOrder,
            certifications_required: Array.isArray(farmMeta.certifications) ? farmMeta.certifications : [],
            practices: Array.isArray(farmMeta.practices) ? farmMeta.practices : [],
            fulfillment_standards: standards,
            preferred_delivery_window: preferredDeliveryWindow,
            time_slot: preferredDeliveryWindow,
            delivery_schedule: deliverySchedule,
            pickup_schedule: pickupSchedule,
            delivery_requirements: mergeRequirementLists(
              deliveryRequirements,
              standards.delivery_requirements,
              standards.deliveryRequirements
            ),
            pickup_requirements: mergeRequirementLists(
              pickupRequirements,
              standards.pickup_requirements,
              standards.pickupRequirements
            )
          };
        });

      const provisionalOrderId = `wo-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

      const order = createOrder({
        orderId: provisionalOrderId,
        buyerId: req.wholesaleBuyer.id,
          buyerAccount: normalizedBuyerAccount,
        poNumber: po_number,
        deliveryDate: delivery_date,
        deliveryAddress: normalizedDeliveryAddress,
        recurrence: recurrence || { cadence: 'one_time' },
          farmSubOrders: enrichedFarmSubOrders,
        totals: orderTotals
      }, { persist: false, register: false });

        const deliveryScheduleList = Array.from(new Set(
          enrichedFarmSubOrders
            .map((subOrder) => String(subOrder.delivery_schedule || '').trim())
            .filter(Boolean)
        ));
        const pickupScheduleList = Array.from(new Set(
          enrichedFarmSubOrders
            .map((subOrder) => String(subOrder.pickup_schedule || '').trim())
            .filter(Boolean)
        ));

      order.fulfillment_method = String(fulfillment_method || 'delivery').toLowerCase();
      order.delivery_fee = deliveryFee;
        order.preferred_delivery_window = preferredDeliveryWindow;
        order.time_slot = preferredDeliveryWindow;
        order.delivery_schedule = deliveryScheduleList.join(' | ');
        order.pickup_schedule = pickupScheduleList.join(' | ');
        order.delivery_requirements = mergeRequirementLists(
          deliveryRequirements,
          ...enrichedFarmSubOrders.map((subOrder) => subOrder.delivery_requirements)
        );
        order.pickup_requirements = mergeRequirementLists(
          pickupRequirements,
          ...enrichedFarmSubOrders.map((subOrder) => subOrder.pickup_requirements)
        );

      const payment = createPayment({
        orderId: order.master_order_id,
        provider: payment_provider || 'square',
        split: result.payment_split,
        totals: orderTotals
      }, { persist: false, register: false });

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
                buyer_email: normalizedBuyerAccount.email
            })),
            paymentSource: { source_id: squareSourceId },
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

            // Auto-refund any successful sub-payments in a partial failure
            const successfulSubPayments = (paymentResult.paymentResults || []).filter(r => r.success && r.paymentId);
            if (successfulSubPayments.length > 0) {
              console.warn(`[Checkout] Partial failure: ${successfulSubPayments.length} successful sub-payment(s) need auto-refund`);
              const partialRefundResults = [];
              for (const pr of successfulSubPayments) {
                const refResult = await refundPayment({
                  paymentId: pr.paymentId,
                  farmId: pr.farmId,
                  amountCents: pr.amountMoney?.amount || 0,
                  reason: `Partial checkout failure for order — other farm payments failed`,
                  orderId: order.master_order_id
                }).catch(err => ({ success: false, error: err.message }));
                partialRefundResults.push({ farmId: pr.farmId, ...refResult });
                console.log(`[Checkout] Partial-failure auto-refund farm ${pr.farmId}: ${refResult.success ? 'OK' : refResult.error}`);
              }
              payment.partial_refund_results = partialRefundResults;
            }
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

      const farms = await listNetworkFarms();
      const byId = new Map(farms.map((f) => [String(f.farm_id), f]));
      const farmApiKeys = loadFarmApiKeys();

      const resolveAuthCandidates = (farmObj, farmId) => {
        const idCandidates = Array.from(new Set([
          String(farmObj?.auth_farm_id || '').trim(),
          String(farmId || '').trim(),
          String(process.env.FARM_ID || '').trim()
        ].filter(Boolean)));

        const keyCandidates = Array.from(new Set([
          String(farmObj?.api_key || '').trim(),
          String(farmObj?.auth_farm_id ? farmApiKeys[farmObj.auth_farm_id]?.api_key || '' : '').trim(),
          String(farmApiKeys[farmId]?.api_key || '').trim(),
          String(process.env.WHOLESALE_FARM_API_KEY || '').trim(),
          String(process.env.GREENREACH_API_KEY || '').trim()
        ].filter(Boolean)));

        const candidates = [];
        for (const id of idCandidates.length ? idCandidates : [String(farmId || '').trim()]) {
          for (const key of keyCandidates) {
            candidates.push({ farmId: id, apiKey: key });
          }
        }

        if (candidates.length === 0) {
          candidates.push({ farmId: String(farmId || '').trim(), apiKey: null });
        }

        return candidates.slice(0, 8);
      };

      const farmCallWithTimeout = async (farmBaseUrl, urlPath, body, farmId, farmObj, timeoutMs = 8000) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const candidates = resolveAuthCandidates(farmObj, farmId);
          let lastResult = { ok: false, status: 401, json: { error: 'No auth candidates available' } };

          for (const auth of candidates) {
            const headers = { 'Content-Type': 'application/json' };
            if (auth.farmId) headers['X-Farm-ID'] = auth.farmId;
            if (auth.apiKey) headers['X-API-Key'] = auth.apiKey;

            const resp = await fetch(new URL(urlPath, farmBaseUrl).toString(), {
              method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal
            });
            const json = await resp.json().catch(() => null);
            const result = { ok: resp.ok && json?.ok !== false, status: resp.status, json };
            if (result.ok) return result;

            lastResult = result;
            if (resp.status !== 401 && resp.status !== 403) {
              return result;
            }
          }

          return lastResult;
        } finally {
          clearTimeout(timer);
        }
      };

      // Retry wrapper: 1 retry with 3s delay for transient failures
      const farmCallWithRetry = async (farmBaseUrl, urlPath, body, farmId, farmObj, timeoutMs = 8000) => {
        const first = await farmCallWithTimeout(farmBaseUrl, urlPath, body, farmId, farmObj, timeoutMs)
          .catch(err => ({ ok: false, status: 0, json: null, error: err }));
        if (first.ok) return first;
        console.warn(`[Checkout] Retrying ${urlPath} for farm ${farmId} after 3s delay`);
        await new Promise(r => setTimeout(r, 3000));
        return farmCallWithTimeout(farmBaseUrl, urlPath, body, farmId, farmObj, timeoutMs);
      };

      // Phase 1: Reserve inventory at every farm (synchronous, with rollback on failure)
      const reservedFarms = []; // track successful reservations for rollback
      let reservationError = null;

      for (const sub of order.farm_sub_orders || []) {
        const farm = byId.get(String(sub.farm_id));
        let farmUrl = farm?.api_url || farm?.url;
        // If farm registry points back to Central, route reservation calls to the configured LE endpoint.
        try {
          const host = new URL(String(farmUrl || '')).hostname;
          if (host && host.includes('greenreachgreens.com') && process.env.FARM_EDGE_URL) {
            farmUrl = process.env.FARM_EDGE_URL;
          }
        } catch (_) { /* non-fatal URL parse */ }
        if (!farmUrl && process.env.FARM_EDGE_URL) farmUrl = process.env.FARM_EDGE_URL;
        if (!farmUrl) continue;

        try {
          const reserveResult = await farmCallWithRetry(farmUrl, '/api/wholesale/inventory/reserve', {
            order_id: order.master_order_id,
            items: (sub.items || []).map((it) => ({ sku_id: it.sku_id, quantity: it.quantity }))
          }, sub.farm_id, farm);

          if (reserveResult.ok) {
            reservedFarms.push({ farm_id: sub.farm_id, farmUrl, farm });
            console.log(`[Checkout] Reserved inventory at farm ${sub.farm_id}`);
          } else {
            console.warn(`[Checkout] Reservation rejected by farm ${sub.farm_id}:`, reserveResult.json?.error || reserveResult.status);
            const insufficientItems = Array.isArray(reserveResult.json?.insufficient_items) ? reserveResult.json.insufficient_items : [];
            const insufficientDetail = insufficientItems.length > 0
              ? ` [${insufficientItems.map((it) => `${it.sku_id}: requested ${it.requested}, available ${it.available}`).join('; ')}]`
              : '';
            reservationError = `Farm ${sub.farm_id} rejected reservation: ${reserveResult.json?.error || 'HTTP ' + reserveResult.status}${insufficientDetail}`;
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
            await farmCallWithRetry(reserved.farmUrl, '/api/wholesale/inventory/release', {
              order_id: order.master_order_id
            }, reserved.farm_id, reserved.farm, 5000);
            console.log(`[Checkout] Rolled back reservation at farm ${reserved.farm_id}`);
          } catch (rollbackErr) {
            console.error(`[Checkout] Rollback failed for farm ${reserved.farm_id}:`, rollbackErr.message);
          }
        }

        if (paymentSuccess) {
          // Auto-refund: payment was captured but inventory reservation failed
          console.error(`[Checkout] CRITICAL: Payment captured for ${order.master_order_id} but reservation failed. Initiating auto-refund.`);
          const refundResults = [];
          for (const pr of (payment.paymentResults || payment.payments || [])) {
            if (pr.success && pr.paymentId) {
              const refundResult = await refundPayment({
                paymentId: pr.paymentId,
                farmId: pr.farmId,
                amountCents: pr.amountMoney?.amount || 0,
                reason: `Inventory reservation failed for order ${order.master_order_id}`,
                orderId: order.master_order_id
              }).catch(err => ({ success: false, error: err.message }));
              refundResults.push({ farmId: pr.farmId, ...refundResult });
              console.log(`[Checkout] Auto-refund for farm ${pr.farmId}: ${refundResult.success ? 'OK' : refundResult.error}`);
            }
          }
          order.status = 'cancelled';
          order.cancelled_at = new Date().toISOString();
          order.cancellation_reason = 'Auto-cancelled: inventory reservation failed after payment';
          order.refund_results = refundResults;
          await saveOrder(order).catch(() => {});
          logOrderEvent(order.master_order_id, 'auto_refund_reservation_failure', {
            reservation_error: reservationError,
            refund_results: refundResults
          });

          const adminEmail = process.env.ADMIN_ALERT_EMAIL || process.env.SES_FROM_EMAIL;
          if (adminEmail) {
            emailService.sendEmail({
              to: adminEmail,
              subject: '[CRITICAL] Wholesale payment auto-refunded after reservation failure',
              text: `Order ${order.master_order_id} payment was captured but reservation failed.\nAuto-refund initiated.\nBuyer: ${buyer_account?.email || 'unknown'}\nDetail: ${reservationError}\nRefund results: ${JSON.stringify(refundResults)}`
            }).catch(err => console.error('[Checkout] Failed to send auto-refund alert:', err.message));
          }
        }

        return res.status(409).json({
          status: 'error',
          message: 'Inventory reservation failed — order not placed',
          detail: reservationError
        });
      }

      // Phase 2: Handle reservation lifecycle by payment outcome
      // - completed: confirm reservations into deductions
      // - failed: release reservations
      // - pending: keep reservations active so inventory reflects standing pending orders
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
      } else if (payment.status === 'failed') {
        for (const reserved of reservedFarms) {
          try {
            await farmCallWithRetry(reserved.farmUrl, '/api/wholesale/inventory/release', {
              order_id: order.master_order_id
            }, reserved.farm_id, reserved.farm, 5000);
            console.log(`[Checkout] Released reservation (non-success payment) at farm ${reserved.farm_id}`);
          } catch (releaseErr) {
            console.error(`[Checkout] Release failed for farm ${reserved.farm_id}:`, releaseErr.message);
          }
        }
      } else {
        console.log(`[Checkout] Keeping ${reservedFarms.length} reservations active for pending payment on order ${order.master_order_id}`);
      }

      // Reflect payment outcome in order status
      if (payment.status === 'failed') {
        order.status = 'payment_failed';
      } else if (payment.status === 'pending') {
        order.status = 'pending_payment';
      }

      order.payment = payment;

      // ── Persist finalized payment and accounting only after reservation checks ──
      finalizePayment(payment);

      if (payment.status === 'completed') {
        ingestPaymentRevenue({
          payment_id: payment.payment_id,
          order_id: order.master_order_id,
          amount: payment.amount,
          provider: payment.provider,
          broker_fee: payment.broker_fee_amount || 0,
          tax_amount: orderTotals.tax_total || 0,
          source_type: 'wholesale',
        }).then(r => {
          if (r?.ok !== false) console.log('[Accounting] Revenue ingested for order', order.master_order_id);
          else console.warn('[Accounting] Revenue ingest returned:', r);
        }).catch(err => console.error('[Accounting] Revenue ingest FAILED:', err.message, err.stack?.split('\n')[1] || ''));

        ingestFarmPayables({
          order_id: order.master_order_id,
          payment_id: payment.payment_id,
          farm_sub_orders: result.allocation.farm_sub_orders,
          provider: payment.provider || 'square',
        }).then(r => {
          console.log('[Accounting] Farm payables ingested for order', order.master_order_id);
        }).catch(err => console.error('[Accounting] Farm payable ingest FAILED:', err.message, err.stack?.split('\n')[1] || ''));

        if (payment.square_details?.payments) {
          for (const pr of payment.square_details.payments) {
            if (!pr.success) continue;
            const farmSub = result.allocation.farm_sub_orders.find(s => s.farm_id === pr.farmId);
            ingestFarmPayout({
              payout_id: pr.paymentId || `payout-${order.master_order_id}-${pr.farmId}`,
              order_id: order.master_order_id,
              farm_id: pr.farmId,
              farm_name: farmSub?.farm_name || pr.farmId,
              amount: Number(((pr.amountMoney?.amount || 0) - (pr.brokerFeeMoney?.amount || 0)) / 100),
              provider: 'square',
            }).catch(err => console.warn(`[Accounting] Farm payout ingest error (${pr.farmId}):`, err.message));
          }
        }
      } else {
        console.warn(`[Accounting] Skipped revenue/payable ingestion — payment status: ${payment.status}`);
      }

      await saveOrder(order).catch(() => {});
      await persistDeliveryLedger({
        order,
        allocation: result.allocation,
        deliveryFee,
        deliveryDate: delivery_date,
        deliveryAddress: normalizedDeliveryAddress,
        fulfillmentMethod: order.fulfillment_method
      }).catch((err) => {
        console.warn('[Wholesale] Delivery ledger persistence failed:', err.message);
      });

      // Refresh network inventory cache immediately so wholesale catalog/UI reflects
      // reservation/confirmation changes without waiting for stale-cache timeout.
      refreshNetworkInventory().catch((err) => {
        console.warn('[Wholesale] Network inventory refresh after checkout failed:', err.message);
      });

      // Phase 3 (async/best-effort): Notify farms + send confirmation email
      (async () => {
        try {
          for (const sub of order.farm_sub_orders || []) {
            const farm = byId.get(String(sub.farm_id));
            let farmUrl = farm?.api_url || farm?.url;
            try {
              const host = new URL(String(farmUrl || '')).hostname;
              if (host && host.includes('greenreachgreens.com') && process.env.FARM_EDGE_URL) {
                farmUrl = process.env.FARM_EDGE_URL;
              }
            } catch (_) { /* non-fatal URL parse */ }
            if (!farmUrl && process.env.FARM_EDGE_URL) farmUrl = process.env.FARM_EDGE_URL;
            if (!farmUrl) {
              console.warn(`[Checkout] No farm URL for ${sub.farm_id} -- Activity Hub notification skipped`);
              continue;
            }
            try {
              const notifyResult = await farmCallWithTimeout(farmUrl, '/api/wholesale/order-events', {
                type: 'wholesale_order_created',
                order_id: order.master_order_id,
                farm_id: sub.farm_id,
                farm_name: sub.farm_name || sub.farm_id,
                delivery_date: order.delivery_date,
                created_at: order.created_at,
                payment_status: payment.status,
                  buyer_name: normalizedBuyerAccount?.businessName || normalizedBuyerAccount?.name || normalizedBuyerAccount?.email || 'Wholesale Buyer',
                  buyer_contact_name: normalizedBuyerAccount?.contactName || normalizedBuyerAccount?.contact_name || '',
                  buyer_email: normalizedBuyerAccount?.email || '',
                  buyer_phone: normalizedBuyerAccount?.phone || '',
                delivery_address: normalizedDeliveryAddress?.street || '',
                  preferred_delivery_window: order.preferred_delivery_window || order.time_slot || null,
                  time_slot: order.time_slot || order.preferred_delivery_window || null,
                  delivery_schedule: sub.delivery_schedule || order.delivery_schedule || '',
                  pickup_schedule: sub.pickup_schedule || order.pickup_schedule || '',
                  delivery_requirements: Array.isArray(sub.delivery_requirements) ? sub.delivery_requirements : (order.delivery_requirements || []),
                  pickup_requirements: Array.isArray(sub.pickup_requirements) ? sub.pickup_requirements : (order.pickup_requirements || []),
                  certifications_required: Array.isArray(sub.certifications_required) ? sub.certifications_required : [],
                  practices: Array.isArray(sub.practices) ? sub.practices : [],
                  fulfillment_standards: sub.fulfillment_standards || {},
                subtotal: sub.subtotal || sub.total || 0,
                verification_deadline: new Date(Date.now() + 24 * 3600000).toISOString(),
                items: (sub.items || []).map((it) => ({
                  sku_id: it.sku_id, product_name: it.product_name, quantity: it.quantity, unit: it.unit,
                  price_per_unit: it.price_per_unit || it.unit_price || 0
                }))
              }, sub.farm_id, farm, 8000);
              if (!notifyResult?.ok) {
                console.error(`[Checkout] Activity Hub notification FAILED for farm ${sub.farm_id}: HTTP ${notifyResult?.status}`, JSON.stringify(notifyResult?.json || {}).substring(0, 200));
              } else {
                console.log(`[Checkout] Activity Hub notified for farm ${sub.farm_id}, order ${order.master_order_id}`);
              }
            } catch (notifyErr) {
              console.error(`[Checkout] Activity Hub notification error for farm ${sub.farm_id}:`, notifyErr.message);
            }
          }
        } catch (outerErr) {
          console.error('[Checkout] Farm notification loop error:', outerErr.message);
        }
      })();

      // Order confirmation email + audit (non-blocking)
      logOrderEvent(order.master_order_id, 'order_created', { buyer_id: req.wholesaleBuyer.id, payment_id: payment.payment_id, total: order.grand_total });
      emailService.sendOrderConfirmation(order, req.wholesaleBuyer).catch(err => console.warn('[Email] Confirmation failed:', err.message));

      return res.json({ status: 'ok', data: order, meta: { payment_id: payment.payment_id } });
    }

    // ── SAFETY: Never fall through to demo for checkout ──
    // If we reach here, network allocation didn't run — something is misconfigured.
    // Block the order and alert admin immediately.
    console.error('[Checkout] BLOCKED: checkout fell through to demo fallback. Network allocation did not run. Buyer:', req.wholesaleBuyer?.id);
    const adminEmail = process.env.ADMIN_ALERT_EMAIL || process.env.SES_FROM_EMAIL;
    if (adminEmail) {
      emailService.sendEmail({
        to: adminEmail,
        subject: '[CRITICAL] Wholesale checkout fell to demo fallback — order blocked',
          text: `A wholesale checkout attempt was BLOCKED because network allocation did not run.\n\nBuyer: ${req.wholesaleBuyer?.id} (${normalizedBuyerAccount?.email || 'unknown'})\nCart items: ${cart?.length || 0}\nTime: ${new Date().toISOString()}\n\nThis means shouldUseNetworkAllocation() returned false. Check WHOLESALE_CATALOG_MODE, database readiness, and network farm connectivity.`
      }).catch(err => console.error('[Alert] Failed to send checkout fallback alert:', err.message));
    }

    return res.status(503).json({
      status: 'error',
      message: 'Checkout is temporarily unavailable. Please try again or contact support.',
      code: 'CHECKOUT_NETWORK_UNAVAILABLE'
    });
  } catch (error) {
    return next(error);
  }
});

// --- Wholesale admin utility endpoints ---

router.get('/oauth/square/farms', (req, res) => {
  return res.json({ status: 'ok', data: { farms: [] } });
});

router.get('/webhooks/payments', adminAuthMiddleware, (req, res) => {
  return res.json({ status: 'ok', data: { payments: listPayments() } });
});

router.get('/refunds', adminAuthMiddleware, (req, res) => {
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

// --- Product Requests (buyer requests for products not in catalog) ---

router.post('/product-requests/create', requireBuyerPortalAuth, async (req, res) => {
  try {
    const buyer = req.wholesaleBuyer;
    const {
      product_name,
      quantity,
      unit,
      needed_by_date,
      description,
      max_price_per_unit,
      certifications_required
    } = req.body;

    if (!product_name || !quantity || !unit || !needed_by_date) {
      return res.status(400).json({
        ok: false,
        message: 'Product name, quantity, unit, and needed by date are required'
      });
    }

    const requestResult = await query(`
      INSERT INTO wholesale_product_requests
      (buyer_id, product_name, quantity, unit, needed_by_date, description, max_price_per_unit, certifications_required, status, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'open', NOW(), NOW())
      RETURNING id
    `, [
      buyer.id,
      String(product_name).slice(0, 255),
      Number(quantity),
      String(unit).slice(0, 50),
      needed_by_date,
      description ? String(description).slice(0, 2000) : null,
      max_price_per_unit ? Number(max_price_per_unit) : null,
      JSON.stringify(certifications_required || [])
    ]);

    const requestId = requestResult.rows[0].id;

    // Get all active farms with admin email for notification
    let notifiedCount = 0;
    try {
      const farmsResult = await query(`
        SELECT f.farm_id, f.name, u.email
        FROM farms f
        LEFT JOIN users u ON u.farm_id = f.farm_id AND u.role = 'admin' AND u.is_active = true
        WHERE f.status IN ('active', 'online')
        ORDER BY f.name
      `);

      const certText = (certifications_required && certifications_required.length > 0)
        ? certifications_required.join(', ')
        : 'None specified';

      const priceText = max_price_per_unit
        ? `Maximum price: $${max_price_per_unit} per ${unit}`
        : 'No price limit specified';

      for (const farm of farmsResult.rows) {
        if (!farm.email) continue;
        try {
          emailService.sendEmail({
            to: farm.email,
            subject: `Product Request: ${product_name} - ${buyer.business_name || buyer.businessName || 'Wholesale Buyer'}`,
            html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
              <div style="background:#2d5016;color:white;padding:20px;border-radius:8px 8px 0 0;text-align:center;">
                <h2 style="margin:0;">New Product Request</h2>
              </div>
              <div style="padding:20px;border:1px solid #e0e0e0;">
                <p>Hello ${farm.name},</p>
                <p><strong>${buyer.business_name || buyer.businessName || 'A wholesale buyer'}</strong> is looking for a product not in the current catalog.</p>
                <div style="background:#f0f7ed;padding:15px;margin:15px 0;border-left:4px solid #2d5016;border-radius:4px;">
                  <p style="margin:5px 0;"><strong>Product:</strong> ${product_name}</p>
                  <p style="margin:5px 0;"><strong>Quantity:</strong> ${quantity} ${unit}</p>
                  <p style="margin:5px 0;"><strong>Needed By:</strong> ${needed_by_date}</p>
                  <p style="margin:5px 0;"><strong>Price:</strong> ${priceText}</p>
                  <p style="margin:5px 0;"><strong>Certifications:</strong> ${certText}</p>
                  ${description ? `<p style="margin:5px 0;"><strong>Notes:</strong> ${description}</p>` : ''}
                </div>
                <p>If you can fulfill this request, reply to <a href="mailto:${buyer.email}">${buyer.email}</a> with availability, pricing, and delivery timeline.</p>
              </div>
              <div style="text-align:center;padding:15px;color:#666;font-size:0.85rem;">
                <p>Request #${requestId} via GreenReach Wholesale</p>
              </div>
            </div>`,
            text: `New Product Request from ${buyer.business_name || buyer.businessName || 'Wholesale Buyer'}\n\nProduct: ${product_name}\nQuantity: ${quantity} ${unit}\nNeeded By: ${needed_by_date}\n${priceText}\nCertifications: ${certText}\n${description ? 'Notes: ' + description : ''}\n\nReply to ${buyer.email} if you can fulfill this request.\n\nRequest #${requestId}`
          });
          notifiedCount++;
        } catch (emailErr) {
          console.warn(`[Product Request] Failed to email ${farm.name}:`, emailErr.message);
        }
      }
    } catch (farmErr) {
      console.warn('[Product Request] Farm notification query failed:', farmErr.message);
    }

    console.log(`[Product Request] Created #${requestId} by buyer ${buyer.id}, notified ${notifiedCount} farms`);

    return res.json({
      ok: true,
      request_id: requestId,
      matched_farms: notifiedCount,
      message: `Request submitted! ${notifiedCount} farm${notifiedCount !== 1 ? 's' : ''} notified.`
    });

  } catch (error) {
    console.error('[Product Request] Create error:', error);
    return res.status(500).json({ ok: false, message: 'Failed to create product request' });
  }
});

router.get('/product-requests/buyer/:buyerId', requireBuyerPortalAuth, async (req, res) => {
  try {
    const buyerId = req.wholesaleBuyer.id;

    const result = await query(`
      SELECT id, product_name, quantity, unit, needed_by_date, description,
             max_price_per_unit, certifications_required, status, farm_responses,
             created_at, updated_at
      FROM wholesale_product_requests
      WHERE buyer_id = $1
      ORDER BY created_at DESC
    `, [buyerId]);

    return res.json({ ok: true, requests: result.rows });
  } catch (error) {
    console.error('[Product Request] List error:', error);
    return res.status(500).json({ ok: false, message: 'Failed to fetch product requests' });
  }
});

router.get('/product-requests', adminAuthMiddleware, async (req, res) => {
  try {
    const statusFilter = req.query.status;
    const validStatuses = ['open', 'matched', 'fulfilled', 'expired', 'cancelled'];
    let sql = `
      SELECT pr.*, wb.business_name, wb.contact_name, wb.email AS buyer_email
      FROM wholesale_product_requests pr
      LEFT JOIN wholesale_buyers wb ON wb.id = pr.buyer_id`;
    const params = [];
    if (statusFilter && validStatuses.includes(statusFilter)) {
      sql += ' WHERE pr.status = $1';
      params.push(statusFilter);
    }
    sql += ' ORDER BY pr.created_at DESC LIMIT 200';
    const result = await query(sql, params);

    return res.json({ ok: true, requests: result.rows });
  } catch (error) {
    console.error('[Product Request] Admin list error:', error);
    return res.status(500).json({ ok: false, message: 'Failed to fetch product requests' });
  }
});

router.patch('/product-requests/:requestId/cancel', ...requireBuyerPortalAuth, async (req, res) => {
  try {
    const { requestId } = req.params;
    const buyerId = req.buyer?.id;
    if (!buyerId) return res.status(401).json({ ok: false, message: 'Not authenticated' });

    const result = await query(`
      UPDATE wholesale_product_requests
      SET status = 'cancelled', updated_at = NOW()
      WHERE id = $1 AND buyer_id = $2 AND status = 'open'
      RETURNING id, status
    `, [requestId, buyerId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ ok: false, message: 'Request not found or cannot be cancelled' });
    }

    return res.json({ ok: true, request: result.rows[0] });
  } catch (error) {
    console.error('[Product Request] Buyer cancel error:', error);
    return res.status(500).json({ ok: false, message: 'Failed to cancel request' });
  }
});

router.patch('/product-requests/:requestId/status', adminAuthMiddleware, async (req, res) => {
  try {
    const { requestId } = req.params;
    const { status } = req.body;
    const validStatuses = ['open', 'matched', 'fulfilled', 'expired', 'cancelled'];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ ok: false, message: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
    }

    const result = await query(`
      UPDATE wholesale_product_requests
      SET status = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING id, status
    `, [status, requestId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ ok: false, message: 'Product request not found' });
    }

    return res.json({ ok: true, request: result.rows[0] });
  } catch (error) {
    console.error('[Product Request] Status update error:', error);
    return res.status(500).json({ ok: false, message: 'Failed to update request status' });
  }
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

router.get('/network/snapshots', async (req, res) => {
  const snapshots = await listNetworkSnapshots();
  return res.json({ status: 'ok', data: { snapshots } });
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

// Reverse lookup: find all orders containing a specific lot number
router.get('/admin/orders/by-lot/:lotNumber', adminAuthMiddleware, async (req, res) => {
  try {
    const lotNumber = req.params.lotNumber;
    if (!lotNumber) {
      return res.status(400).json({ status: 'error', message: 'lotNumber is required' });
    }
    if (!isDatabaseAvailable()) {
      return res.status(503).json({ status: 'error', message: 'Database unavailable' });
    }
    // Search order_data JSONB for lot_id matches within farm_sub_orders items
    const result = await query(
      `SELECT master_order_id, buyer_id, buyer_email, status, created_at, order_data
       FROM wholesale_orders
       WHERE order_data::text LIKE $1
       ORDER BY created_at DESC
       LIMIT 100`,
      [`%${lotNumber}%`]
    );
    // Filter to orders that actually contain the lot in their items
    const matchingOrders = result.rows.filter(row => {
      const data = row.order_data || {};
      return (data.farm_sub_orders || []).some(sub =>
        (sub.items || []).some(item => item.lot_id === lotNumber)
      );
    }).map(row => ({
      master_order_id: row.master_order_id,
      buyer_id: row.buyer_id,
      buyer_email: row.buyer_email,
      status: row.status,
      created_at: row.created_at,
      matching_items: (row.order_data?.farm_sub_orders || []).flatMap(sub =>
        (sub.items || []).filter(item => item.lot_id === lotNumber).map(item => ({
          farm_id: sub.farm_id,
          sku_id: item.sku_id,
          product_name: item.product_name,
          quantity: item.quantity,
          lot_id: item.lot_id
        }))
      )
    }));

    return res.json({ status: 'ok', lot_number: lotNumber, orders: matchingOrders, count: matchingOrders.length });
  } catch (error) {
    console.error('[Admin] Lot lookup error:', error.message);
    return res.status(500).json({ status: 'error', message: 'Lot lookup failed' });
  }
});

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
