/**
 * Light Engine: Wholesale Inventory Sync Routes
 * Exposes farm inventory lots and harvest windows to GreenReach
 * Called by GreenReach for catalog aggregation and ATP (available-to-promise)
 */

import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { wholesaleAuthMiddleware } from '../lib/wholesale-auth.js';
import {
  validateReservation,
  validateConfirmation,
  validateRelease,
  validateRollback,
  validateOrderEvent,
  handleValidationErrors
} from '../lib/input-validation.js';
import * as reservationStore from '../lib/wholesale/reservation-store.js';
import { query as dbQuery } from '../lib/database.js';
import orderStore from '../lib/wholesale/order-store.js';

let reservationCleanupStarted = false;
if (!reservationCleanupStarted) {
  reservationStore.startReservationCleanup();
  reservationCleanupStarted = true;
}

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to real farm data
const PUBLIC_DIR = path.resolve(__dirname, '../public');
const GROUPS_FILE = path.join(PUBLIC_DIR, 'data', 'groups.json');
const RECIPES_FILE = path.join(PUBLIC_DIR, 'data', 'lighting-recipes.json');
const WHOLESALE_STATUS_FILE = path.join(PUBLIC_DIR, 'data', 'wholesale-status.json');

function readFarmInfo() {
  const farmPath = path.join(PUBLIC_DIR, 'data', 'farm.json');
  let farmInfo = { farmId: 'light-engine-demo', name: 'GreenReach Demo Farm' };
  try {
    const farmData = JSON.parse(fs.readFileSync(farmPath, 'utf8'));
    if (farmData.farmId) farmInfo.farmId = farmData.farmId;
    if (farmData.name) farmInfo.name = farmData.name;
  } catch {
    // ignore
  }
  return farmInfo;
}

function loadWholesaleStatus() {
  const defaults = {
    enabled: true,
    lastCatalogSync: null,
    lastPriceSync: null,
    pendingOrders: 0,
    reservedItems: 0,
    catalogSyncInterval: 5 * 60 * 1000,
    priceSyncInterval: 15 * 60 * 1000
  };

  try {
    const raw = fs.readFileSync(WHOLESALE_STATUS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return { ...defaults, ...parsed };
  } catch {
    return { ...defaults };
  }
}

function saveWholesaleStatus(status) {
  const payload = {
    ...status,
    updated_at: new Date().toISOString()
  };
  fs.writeFileSync(WHOLESALE_STATUS_FILE, JSON.stringify(payload, null, 2), 'utf8');
}

async function getActiveReservationsLive() {
  try {
    return await reservationStore.getActiveReservations();
  } catch {
    return [];
  }
}

async function getTotalReservedBySkuLive() {
  const activeReservations = await getActiveReservationsLive();
  const bySku = new Map();
  for (const reservation of activeReservations) {
    const current = bySku.get(reservation.sku_id) || 0;
    bySku.set(reservation.sku_id, current + Number(reservation.qty || reservation.quantity || 0));
  }
  return bySku;
}

function buildLotsFromFarmData(groups, farmInfo, today, reservedBySku, deductedBySku) {
  let recipes = {};
  try {
    const recipesData = JSON.parse(fs.readFileSync(RECIPES_FILE, 'utf8'));
    recipes = recipesData.recipes || {};
  } catch {
    recipes = {};
  }

  const lots = [];

  groups.forEach((group) => {
    const cropName = (group.crop || group.recipe || '').trim();
    if (!cropName) return;

    const recipe = recipes[cropName];
    let growDays = 35;
    if (recipe && recipe.day_by_day && Array.isArray(recipe.day_by_day)) {
      growDays = recipe.day_by_day.length;
    }

    let daysOld = 0;
    if (group.planConfig?.anchor?.seedDate) {
      const seedDate = new Date(group.planConfig.anchor.seedDate);
      daysOld = Math.floor((today - seedDate) / (1000 * 60 * 60 * 24));
    }

    const daysUntilHarvest = Math.max(0, growDays - daysOld);
    const harvestStart = new Date(today.getTime() + daysUntilHarvest * 24 * 60 * 60 * 1000);
    const harvestEnd = new Date(harvestStart.getTime() + 2 * 24 * 60 * 60 * 1000);

    const trayCount = group.trays || 4;
    const plantsPerTray = (group.plants || 48) / trayCount;
    const lbsPerPlant = 0.125;
    const totalLbs = Math.round(trayCount * plantsPerTray * lbsPerPlant);
    const qtyAvailableBase = Math.ceil(totalLbs / 5);

    const farmIdForQr = farmInfo.farmId || 'light-engine-demo';
    const skuId = `SKU-${cropName.toUpperCase().replace(/\s+/g, '-')}-5LB`;
    const reservedQty = reservedBySku.get(skuId) || 0;
    const deductedQty = deductedBySku.get(skuId) || 0;
    const actualAvailable = Math.max(0, qtyAvailableBase - reservedQty - deductedQty);

    lots.push({
      lot_id: `LOT-${group.id}`,
      qr_payload: `GRTRACE|${farmIdForQr}|LOT-${group.id}|${skuId}|${harvestStart.toISOString()}`,
      label_text: `${cropName} LOT-${group.id}`,
      sku_id: skuId,
      sku_name: `${cropName}, 5lb case`,
      qty_available: actualAvailable,
      qty_reserved: reservedQty,
      qty_deducted: deductedQty,
      unit: 'case',
      pack_size: 5,
      price_per_unit: 12.50,
      harvest_date_start: harvestStart.toISOString(),
      harvest_date_end: harvestEnd.toISOString(),
      quality_flags: ['local', 'vertical_farm', 'pesticide_free'],
      location: group.zone || group.roomId || 'Unknown',
      crop_type: cropName,
      days_to_harvest: daysUntilHarvest
    });
  });

  const allowDeterministicFallbackLot = process.env.ENABLE_DETERMINISTIC_WHOLESALE_LOT === 'true' || process.env.NODE_ENV !== 'production';
  if (lots.length === 0 && allowDeterministicFallbackLot) {
    const harvestStart = new Date(today.getTime() + 24 * 60 * 60 * 1000);
    const harvestEnd = new Date(harvestStart.getTime() + 2 * 24 * 60 * 60 * 1000);
    const fallbackSkuId = 'SKU-AUDIT-GENOVESE-BASIL-5LB';
    const reservedQty = reservedBySku.get(fallbackSkuId) || 0;
    const deductedQty = deductedBySku.get(fallbackSkuId) || 0;
    const baseQty = 4;
    const actualAvailable = Math.max(0, baseQty - reservedQty - deductedQty);

    lots.push({
      lot_id: 'LOT-AUDIT-FALLBACK-001',
      qr_payload: `GRTRACE|${farmInfo.farmId}|LOT-AUDIT-FALLBACK-001|${fallbackSkuId}|${harvestStart.toISOString()}`,
      label_text: 'Genovese Basil LOT-AUDIT-FALLBACK-001',
      sku_id: fallbackSkuId,
      sku_name: 'Genovese Basil, 5lb case (fallback)',
      qty_available: actualAvailable,
      qty_reserved: reservedQty,
      qty_deducted: deductedQty,
      unit: 'case',
      pack_size: 5,
      price_per_unit: 12.5,
      harvest_date_start: harvestStart.toISOString(),
      harvest_date_end: harvestEnd.toISOString(),
      quality_flags: ['local', 'vertical_farm', 'fallback_seeded'],
      location: 'Fallback-Zone',
      crop_type: 'genovese-basil',
      days_to_harvest: 1
    });
  }

  return lots;
}

/**
 * GET /api/wholesale/status
 * Return wholesale integration status and sync metadata
 */
router.get('/status', async (_req, res) => {
  try {
    const farmInfo = readFarmInfo();
    const status = loadWholesaleStatus();
    const reservedBySku = await getTotalReservedBySkuLive();
    const reservedItems = Array.from(reservedBySku.values()).reduce((sum, qty) => sum + Number(qty || 0), 0);

    return res.json({
      enabled: status.enabled,
      lastCatalogSync: status.lastCatalogSync,
      lastPriceSync: status.lastPriceSync,
      pendingOrders: status.pendingOrders || 0,
      reservedItems,
      catalogSyncInterval: status.catalogSyncInterval,
      priceSyncInterval: status.priceSyncInterval,
      farmId: farmInfo.farmId
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to load wholesale status', details: error.message });
  }
});

/**
 * POST /api/wholesale/enable
 */
router.post('/enable', async (_req, res) => {
  const status = loadWholesaleStatus();
  status.enabled = true;
  saveWholesaleStatus(status);
  return res.json({ success: true, enabled: true });
});

/**
 * POST /api/wholesale/disable
 */
router.post('/disable', async (_req, res) => {
  const status = loadWholesaleStatus();
  status.enabled = false;
  saveWholesaleStatus(status);
  return res.json({ success: true, enabled: false });
});

/**
 * POST /api/wholesale/sync/catalog
 */
router.post('/sync/catalog', async (_req, res) => {
  try {
    const groupsData = JSON.parse(fs.readFileSync(GROUPS_FILE, 'utf8'));
    const itemsSynced = Array.isArray(groupsData.groups) ? groupsData.groups.length : 0;
    const status = loadWholesaleStatus();
    status.lastCatalogSync = new Date().toISOString();
    saveWholesaleStatus(status);

    return res.json({
      success: true,
      result: {
        itemsSynced,
        timestamp: status.lastCatalogSync
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Failed to sync catalog', details: error.message });
  }
});

/**
 * POST /api/wholesale/sync/pricing
 */
router.post('/sync/pricing', async (_req, res) => {
  try {
    const status = loadWholesaleStatus();
    status.lastPriceSync = new Date().toISOString();
    saveWholesaleStatus(status);

    return res.json({
      success: true,
      result: {
        itemsUpdated: 0,
        timestamp: status.lastPriceSync
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Failed to sync pricing', details: error.message });
  }
});

/**
 * GET /api/wholesale/inventory
 * Return farm inventory lots with availability for wholesale orders
 * 
 * Response format:
 * {
 *   farm_id: string,
 *   farm_name: string,
 *   inventory_timestamp: ISO timestamp,
 *   lots: [{
 *     lot_id: string,
 *     qr_payload: string,
 *     label_text: string,
 *     sku_id: string,
 *     sku_name: string,
 *     qty_available: number,
 *     qty_reserved: number,
 *     unit: string,
 *     pack_size: number,
 *     price_per_unit: number,
 *     harvest_date_start: ISO date,
 *     harvest_date_end: ISO date,
 *     quality_flags: string[],
 *     location: string (zone/shelf identifier)
 *   }]
 * }
 */
router.get('/inventory', async (req, res) => {
  try {
    console.log('[Wholesale Sync] GreenReach requesting farm inventory');

    // Load real farm data from groups.json
    const groupsData = JSON.parse(fs.readFileSync(GROUPS_FILE, 'utf8'));
    const groups = groupsData.groups || [];

    // Load farm identity from farm.json for consistent naming (and traceability labels)
    const farmPath = path.join(PUBLIC_DIR, 'data', 'farm.json');
    let farmInfo = { farmId: 'light-engine-demo', name: 'GreenReach Demo Farm' };
    try {
      const farmData = JSON.parse(fs.readFileSync(farmPath, 'utf8'));
      if (farmData.farmId) farmInfo.farmId = farmData.farmId;
      if (farmData.name) farmInfo.name = farmData.name;
    } catch (err) {
      console.log('[Wholesale Sync] Using default farm identity');
    }

    // Build lots from real groups using shared derivation helper
    const today = new Date();

    // Load active reservations to subtract from available quantities
    const reservedBySku = await getTotalReservedBySkuLive();
    const deductedBySku = getTotalDeductedBySku();
    const lots = buildLotsFromFarmData(groups, farmInfo, today, reservedBySku, deductedBySku);

    // Include manual inventory entries from farm_inventory DB
    const db = req.app.locals.db;
    if (db) {
      try {
        const dbResult = await db.query(
          `SELECT product_id, product_name, quantity_available, manual_quantity_lbs,
                  quantity_unit, wholesale_price, retail_price, category,
                  inventory_source, is_custom, description, thumbnail_url
           FROM farm_inventory
           WHERE farm_id = $1
             AND COALESCE(quantity_available, manual_quantity_lbs, 0) > 0
           ORDER BY product_name`,
          [farmInfo.farmId]
        );
        for (const row of dbResult.rows) {
          const cropName = row.product_name || 'Unknown';
          const qtyLbs = Number(row.quantity_available ?? row.manual_quantity_lbs ?? 0);
          const skuId = String(row.product_id || cropName).trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
          const reservedQty = Number(reservedBySku.get(skuId) || 0);
          const deductedQty = Number(deductedBySku.get(skuId) || 0);
          const actualAvailable = Math.max(0, qtyLbs - reservedQty - deductedQty);
          const pricePerUnit = Number(row.wholesale_price || row.retail_price || 0);
          const inventorySource = String(row.inventory_source || '').toLowerCase();
          const isCustom = inventorySource === 'custom' || row.is_custom === true;
          const qualityFlags = ['local', 'vertical_farm'];
          if (inventorySource === 'manual') {
            qualityFlags.push('manual_entry');
          }
          if (isCustom) {
            qualityFlags.push('custom_product');
          }

          lots.push({
            lot_id: `LOT-MANUAL-${row.product_id}`,
            qr_payload: `GRTRACE|${farmInfo.farmId}|LOT-MANUAL-${row.product_id}|${skuId}|${today.toISOString()}`,
            label_text: isCustom ? `${cropName} (custom product)` : `${cropName} (manual entry)`,
            sku_id: skuId,
            sku_name: `${cropName}, ${qtyLbs} lb`,
            qty_available: actualAvailable,
            qty_reserved: reservedQty,
            qty_deducted: deductedQty,
            unit: 'lb',
            pack_size: 1,
            price_per_unit: pricePerUnit,
            harvest_date_start: today.toISOString(),
            harvest_date_end: today.toISOString(),
            quality_flags: qualityFlags,
            location: row.category || 'Manual',
            crop_type: cropName,
            days_to_harvest: 0,
            inventory_source: row.inventory_source || null,
            is_custom: isCustom,
            description: row.description || null,
            thumbnail_url: row.thumbnail_url || null
          });
        }
        if (dbResult.rows.length > 0) {
          console.log(`[Wholesale Sync] Added ${dbResult.rows.length} manual inventory lots from DB`);
        }
      } catch (dbErr) {
        console.warn('[Wholesale Sync] Could not query farm_inventory:', dbErr.message);
      }
    }

    const farmInventory = {
      farm_id: farmInfo.farmId,
      farm_name: farmInfo.name,
      inventory_timestamp: new Date().toISOString(),
      lots: lots
    };

    res.json({
      ok: true,
      ...farmInventory
    });

  } catch (error) {
    console.error('[Wholesale Sync] Failed to fetch inventory:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to retrieve farm inventory',
      message: error.message
    });
  }
});

/**
 * POST /api/wholesale/order-events
 * Receive order notifications from GreenReach Central.
 * This is additive and does not impact grow automation.
 */
router.post('/order-events', wholesaleAuthMiddleware, express.json({ limit: '256kb' }), validateOrderEvent, handleValidationErrors, async (req, res) => {
  try {
    const payload = req.body || {};
    const event = {
      received_at: new Date().toISOString(),
      type: String(payload.type || 'unknown'),
      order_id: payload.order_id || null,
      farm_id: payload.farm_id || null,
      delivery_date: payload.delivery_date || null,
      items: Array.isArray(payload.items) ? payload.items : null
    };

    const eventsFile = path.join(PUBLIC_DIR, 'data', 'wholesale-order-events.json');
    let existing = { events: [] };
    try {
      existing = JSON.parse(fs.readFileSync(eventsFile, 'utf8'));
    } catch {
      // ignore
    }

    const events = Array.isArray(existing.events) ? existing.events : [];
    events.unshift(event);
    while (events.length > 200) events.pop();

    fs.writeFileSync(eventsFile, JSON.stringify({ events, updated_at: new Date().toISOString() }, null, 2), 'utf8');

    // Bridge: create NeDB sub-orders so Activity Hub and LE-wholesale-orders can display them
    if (payload.type === 'wholesale_order_created' && payload.order_id && payload.farm_id) {
      try {
        // Save master order if not already in NeDB
        const existingOrder = await orderStore.getOrder(String(payload.order_id));
        if (!existingOrder) {
          await orderStore.saveOrder({
            master_order_id: String(payload.order_id),
            buyer_name: payload.buyer_name || 'Wholesale Buyer',
            buyer_email: payload.buyer_email || '',
            delivery_date: payload.delivery_date || null,
            delivery_address: payload.delivery_address || '',
            status: payload.payment_status === 'completed' ? 'confirmed' : 'pending_payment',
            created_at: payload.created_at || new Date().toISOString()
          });
        }

        // Create sub-order for this farm
        const subOrderId = `SO-${payload.order_id}-${payload.farm_id}`;
        const existingSub = await orderStore.getSubOrder(subOrderId);
        if (!existingSub) {
          const items = (payload.items || []).map(it => ({
            sku_id: it.sku_id || '',
            product_name: it.product_name || it.sku_id || 'Unknown',
            quantity: Number(it.quantity) || 0,
            unit: it.unit || 'lb',
            price_per_unit: Number(it.price_per_unit) || 0,
            line_total: (Number(it.price_per_unit) || 0) * (Number(it.quantity) || 0)
          }));
          const subtotal = items.reduce((sum, it) => sum + it.line_total, 0);

          await orderStore.saveSubOrder({
            sub_order_id: subOrderId,
            master_order_id: String(payload.order_id),
            farm_id: payload.farm_id,
            farm_name: payload.farm_name || payload.farm_id,
            status: 'pending_verification',
            items,
            sub_total: payload.subtotal || subtotal,
            verification_deadline: payload.verification_deadline || new Date(Date.now() + 24 * 3600000).toISOString(),
            payment_status: payload.payment_status || 'pending',
            buyer_name: payload.buyer_name || 'Wholesale Buyer',
            delivery_date: payload.delivery_date || null
          });
          console.log(`[Wholesale Sync] Created NeDB sub-order ${subOrderId} for Activity Hub`);
        }
      } catch (bridgeErr) {
        console.error('[Wholesale Sync] NeDB bridge error (non-fatal):', bridgeErr.message);
      }
    }

    console.log('[Wholesale Sync] Received order event:', event.type, event.order_id);
    return res.json({ ok: true, stored: true });
  } catch (error) {
    console.error('[Wholesale Sync] Failed to store order event:', error);
    return res.status(500).json({ ok: false, error: 'Failed to store order event' });
  }
});

/**
 * GET /api/wholesale/order-events
 * Read orders from PostgreSQL (primary) and the rolling event log file (fallback).
 */
router.get('/order-events', async (_req, res) => {
  const eventMap = new Map();

  // 1. Try the legacy JSON file
  try {
    const eventsFile = path.join(PUBLIC_DIR, 'data', 'wholesale-order-events.json');
    const raw = fs.readFileSync(eventsFile, 'utf8');
    const parsed = JSON.parse(raw);
    for (const ev of (parsed.events || [])) {
      if (ev.order_id) eventMap.set(ev.order_id, ev);
    }
  } catch {
    // file may not exist — fine
  }

  // 2. Query PostgreSQL wholesale_orders
  try {
    const result = await dbQuery(
      'SELECT master_order_id, status, order_data, created_at FROM wholesale_orders ORDER BY created_at DESC LIMIT 200'
    );
    for (const row of (result.rows || [])) {
      const od = row.order_data || {};
      const orderId = row.master_order_id || od.master_order_id;
      if (!orderId) continue;

      // Flatten items from all farm sub-orders
      const items = [];
      for (const sub of (od.farm_sub_orders || [])) {
        for (const item of (sub.items || [])) {
          items.push({
            product_name: item.product_name || item.sku_id || 'Unknown',
            sku_id: item.sku_id || '',
            quantity: item.quantity || 0,
            price_per_unit: item.price_per_unit || item.unit_price || 0
          });
        }
      }

      const event = {
        order_id: orderId,
        timestamp: od.created_at || row.created_at,
        status: od.status || row.status || 'pending_payment',
        total_amount: od.grand_total || 0,
        items,
        buyer_email: od.buyer_account?.email || null,
        delivery_date: od.delivery_date || null,
        type: 'order_placed'
      };

      // PG is authoritative — overwrite file-based events
      eventMap.set(orderId, event);
    }
  } catch (err) {
    console.error('[Wholesale Sync] PG order-events query failed:', err.message);
  }

  return res.json({ ok: true, events: Array.from(eventMap.values()) });
});

/**
 * Reservation Management Helpers
 */
const RESERVATIONS_FILE = path.join(PUBLIC_DIR, 'data', 'wholesale-reservations.json');
const DEDUCTIONS_FILE = path.join(PUBLIC_DIR, 'data', 'wholesale-deductions.json');

function loadReservations() {
  try {
    const raw = fs.readFileSync(RESERVATIONS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.reservations) ? parsed.reservations : [];
  } catch {
    return [];
  }
}

function saveReservations(reservations) {
  const payload = {
    reservations: reservations || [],
    updated_at: new Date().toISOString()
  };
  fs.writeFileSync(RESERVATIONS_FILE, JSON.stringify(payload, null, 2), 'utf8');
}

function cleanupExpiredReservations(reservations) {
  const now = Date.now();
  const ttlMs = 24 * 60 * 60 * 1000; // 24 hours
  return reservations.filter((r) => {
    const reservedAt = new Date(r.reserved_at).getTime();
    return (now - reservedAt) < ttlMs;
  });
}

function getTotalReservedBySku() {
  const reservations = loadReservations();
  const active = cleanupExpiredReservations(reservations);
  const bySku = new Map();
  for (const r of active) {
    const current = bySku.get(r.sku_id) || 0;
    bySku.set(r.sku_id, current + Number(r.quantity || 0));
  }
  return bySku;
}

/**
 * Inventory Deduction Management
 * Tracks actual inventory deductions when orders are confirmed/paid
 */
function loadDeductions() {
  try {
    const raw = fs.readFileSync(DEDUCTIONS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.deductions) ? parsed.deductions : [];
  } catch {
    return [];
  }
}

function saveDeductions(deductions) {
  const payload = {
    deductions: deductions || [],
    updated_at: new Date().toISOString()
  };
  fs.writeFileSync(DEDUCTIONS_FILE, JSON.stringify(payload, null, 2), 'utf8');
}

function getTotalDeductedBySku() {
  const deductions = loadDeductions();
  const bySku = new Map();
  for (const d of deductions) {
    // Only count confirmed deductions, skip rolled back ones
    if (d.status === 'rolled_back') continue;
    
    const current = bySku.get(d.sku_id) || 0;
    bySku.set(d.sku_id, current + Number(d.quantity || 0));
  }
  return bySku;
}

/**
 * POST /api/wholesale/inventory/reserve
 * Reserve inventory for a wholesale order (called by GreenReach Central after checkout)
 * This creates a temporary hold but does NOT deduct inventory yet.
 * 
 * REQUIRES AUTHENTICATION: X-Farm-ID and X-API-Key headers
 * 
 * Body: {
 *   order_id: string,
 *   items: [{sku_id: string, quantity: number}]
 * }
 */
router.post('/inventory/reserve', wholesaleAuthMiddleware, express.json({ limit: '128kb' }), validateReservation, handleValidationErrors, async (req, res) => {
  try {
    const { order_id, items, buyer_id } = req.body || {};
    if (!order_id) {
      return res.status(400).json({ ok: false, error: 'order_id is required' });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ ok: false, error: 'items array is required' });
    }

    const existing = await reservationStore.getOrderReservations(order_id);
    if (existing.length > 0) {
      return res.json({ ok: true, message: 'Order already reserved', order_id });
    }

    // Validate inventory availability before reserving using the same source as /inventory
    const reservedBySku = await getTotalReservedBySkuLive();
    const deductedBySku = getTotalDeductedBySku();
    const groupsData = JSON.parse(fs.readFileSync(GROUPS_FILE, 'utf8'));
    const groups = groupsData.groups || [];
    const farmInfo = readFarmInfo();
    const inventoryLots = buildLotsFromFarmData(groups, farmInfo, new Date(), reservedBySku, deductedBySku);

    // Include manual inventory entries from farm_inventory DB in reservation checks
    const db = req.app.locals.db;
    if (db) {
      try {
        const dbResult = await db.query(
          `SELECT product_id, product_name, quantity_available, manual_quantity_lbs,
                  wholesale_price, retail_price, category
           FROM farm_inventory
           WHERE farm_id = $1
             AND COALESCE(quantity_available, manual_quantity_lbs, 0) > 0
           ORDER BY product_name`,
          [farmInfo.farmId]
        );

        for (const row of dbResult.rows) {
          const cropName = row.product_name || 'Unknown';
          const qtyLbs = Number(row.quantity_available ?? row.manual_quantity_lbs ?? 0);
          const skuId = String(row.product_id || cropName).trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
          const reservedQty = Number(reservedBySku.get(skuId) || 0);
          const deductedQty = Number(deductedBySku.get(skuId) || 0);
          const actualAvailable = Math.max(0, qtyLbs - reservedQty - deductedQty);
          const pricePerUnit = Number(row.wholesale_price || row.retail_price || 0);

          inventoryLots.push({
            lot_id: `LOT-MANUAL-${row.product_id}`,
            qr_payload: `GRTRACE|${farmInfo.farmId}|LOT-MANUAL-${row.product_id}|${skuId}|${new Date().toISOString()}`,
            label_text: `${cropName} (manual entry)`,
            sku_id: skuId,
            sku_name: `${cropName}, ${qtyLbs} lb`,
            qty_available: actualAvailable,
            qty_reserved: reservedQty,
            qty_deducted: deductedQty,
            unit: 'lb',
            pack_size: 1,
            price_per_unit: pricePerUnit,
            harvest_date_start: new Date().toISOString(),
            harvest_date_end: new Date().toISOString(),
            quality_flags: ['local', 'vertical_farm', 'manual_entry'],
            location: row.category || 'Manual',
            crop_type: cropName,
            days_to_harvest: 0
          });
        }
      } catch (dbErr) {
        console.warn('[Wholesale Sync] Could not query farm_inventory for reservation validation:', dbErr.message);
      }
    }

    const normalizeSkuKey = (value) => String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    const aliasesForLot = (lot) => {
      const aliases = new Set();
      const rawSku = String(lot?.sku_id || '').trim();
      const cropType = String(lot?.crop_type || '').trim();

      if (rawSku) aliases.add(rawSku);
      if (cropType) aliases.add(cropType);

      const legacy = rawSku.match(/^SKU-(.+)-5LB$/i);
      if (legacy?.[1]) {
        aliases.add(legacy[1].replace(/_/g, '-'));
      }

      return Array.from(aliases).map(normalizeSkuKey).filter(Boolean);
    };

    const inventoryBySku = new Map();
    for (const lot of inventoryLots) {
      const qty = Number(lot.qty_available || 0);
      for (const alias of aliasesForLot(lot)) {
        const current = inventoryBySku.get(alias) || 0;
        inventoryBySku.set(alias, current + qty);
      }
    }

    const requestedBySku = new Map();
    for (const item of items) {
      if (!item.sku_id || !item.quantity) continue;
      const key = normalizeSkuKey(item.sku_id);
      const current = requestedBySku.get(key) || 0;
      requestedBySku.set(key, current + Number(item.quantity || 0));
    }

    const insufficientItems = [];
    for (const [skuId, requestedQty] of requestedBySku.entries()) {
      const hasLocalSku = inventoryBySku.has(skuId);
      const availableNow = inventoryBySku.get(skuId) || 0;
      const alreadyReserved = reservedBySku.get(skuId) || 0;
      const alreadyDeducted = deductedBySku.get(skuId) || 0;
      const totalInventory = availableNow + alreadyReserved + alreadyDeducted;

      if (requestedQty > availableNow) {
        if (!hasLocalSku && availableNow === 0) {
          console.warn(`[Wholesale Sync] SKU ${skuId} missing from local inventory map; allowing reservation pass-through for order ${order_id}`);
          continue;
        }
        insufficientItems.push({
          sku_id: skuId,
          requested: requestedQty,
          available: availableNow,
          total_inventory: totalInventory,
          already_reserved: alreadyReserved,
          already_deducted: alreadyDeducted
        });
      }
    }

    // Reject if insufficient inventory
    if (insufficientItems.length > 0) {
      console.error(`[Wholesale Sync] Insufficient inventory for order ${order_id}:`, insufficientItems);
      return res.status(409).json({
        ok: false,
        error: 'Insufficient inventory',
        insufficient_items: insufficientItems
      });
    }

    // Persist reservations in NeDB (active path)
    for (const item of items) {
      if (!item.sku_id || !item.quantity) continue;
      const lot = inventoryLots.find((l) => l.sku_id === item.sku_id);
      await reservationStore.createReservation({
        lot_id: lot?.lot_id || `LOT-${item.sku_id}`,
        sku_id: String(item.sku_id),
        qty: Number(item.quantity),
        order_id,
        buyer_id: buyer_id || req.headers['x-farm-id'] || 'unknown',
        ttl_minutes: 15
      });
    }

    console.log(`[Wholesale Sync] Reserved inventory for order ${order_id}:`, items);
    return res.json({ ok: true, order_id, reserved: items.length });
  } catch (error) {
    console.error('[Wholesale Sync] Failed to reserve inventory:', error);
    return res.status(500).json({ ok: false, error: 'Failed to reserve inventory' });
  }
});

/**
 * POST /api/wholesale/inventory/confirm
 * Confirm order and PERMANENTLY DEDUCT inventory after successful payment
 * Moves reservation to deduction (actual inventory reduction)
 * 
 * Body: {
 *   order_id: string,
 *   payment_id: string (optional, for audit trail)
 * }
 */
router.post('/inventory/confirm', wholesaleAuthMiddleware, express.json({ limit: '128kb' }), validateConfirmation, handleValidationErrors, async (req, res) => {
  try {
    const { order_id, payment_id } = req.body || {};
    if (!order_id) {
      return res.status(400).json({ ok: false, error: 'order_id is required' });
    }

    const orderReservations = await reservationStore.getOrderReservations(order_id);
    if (orderReservations.length === 0) {
      return res.status(404).json({
        ok: false,
        error: 'No reservations found for this order',
        order_id
      });
    }

    // Load existing deductions
    const deductions = loadDeductions();
    const confirmed_at = new Date().toISOString();

    // Move reservations to deductions (permanent inventory reduction/audit)
    for (const reservation of orderReservations) {
      deductions.push({
        order_id,
        sku_id: reservation.sku_id,
        quantity: Number(reservation.qty || reservation.quantity || 0),
        reserved_at: reservation.created_at || new Date().toISOString(),
        confirmed_at,
        payment_id: payment_id || null,
        status: 'confirmed'
      });
    }
    
    saveDeductions(deductions);
    await reservationStore.confirmOrderReservations(order_id);
    
    console.log(`[Wholesale Sync] Confirmed and deducted inventory for order ${order_id}:`, orderReservations.length, 'items');
    return res.json({
      ok: true,
      order_id,
      deducted: orderReservations.length,
      items: orderReservations.map(r => ({ sku_id: r.sku_id, quantity: Number(r.qty || r.quantity || 0) }))
    });
  } catch (error) {
    console.error('[Wholesale Sync] Failed to confirm inventory:', error);
    return res.status(500).json({ ok: false, error: 'Failed to confirm inventory' });
  }
});

/**
 * POST /api/wholesale/inventory/release
 * Release reserved inventory (e.g., payment failed, order cancelled before payment)
 * Only releases reservations, does NOT rollback confirmed deductions
 * 
 * Body: {
 *   order_id: string,
 *   reason: string (optional, for audit trail)
 * }
 */
router.post('/inventory/release', wholesaleAuthMiddleware, express.json({ limit: '128kb' }), validateRelease, handleValidationErrors, async (req, res) => {
  try {
    const { order_id, reason } = req.body || {};
    if (!order_id) {
      return res.status(400).json({ ok: false, error: 'order_id is required' });
    }

    const orderReservations = await reservationStore.getOrderReservations(order_id);
    const releasedCount = orderReservations.length;

    await reservationStore.releaseOrderReservations(order_id);
    console.log(`[Wholesale Sync] Released ${releasedCount} reservations for order ${order_id}`, reason ? `(${reason})` : '');
    return res.json({
      ok: true,
      order_id,
      released: releasedCount,
      reason: reason || null
    });
  } catch (error) {
    console.error('[Wholesale Sync] Failed to release inventory:', error);
    return res.status(500).json({ ok: false, error: 'Failed to release inventory' });
  }
});

/**
 * POST /api/wholesale/inventory/rollback
 * ROLLBACK a confirmed order (refund scenario)
 * Removes deduction and restores inventory availability
 * WARNING: Only use for refunds/cancellations after payment
 * 
 * Body: {
 *   order_id: string,
 *   reason: string (required for audit)
 * }
 */
router.post('/inventory/rollback', wholesaleAuthMiddleware, express.json({ limit: '128kb' }), validateRollback, handleValidationErrors, async (req, res) => {
  try {
    const { order_id, reason } = req.body || {};
    if (!order_id) {
      return res.status(400).json({ ok: false, error: 'order_id is required' });
    }
    if (!reason) {
      return res.status(400).json({ ok: false, error: 'reason is required for rollback audit trail' });
    }

    const deductions = loadDeductions();
    const orderDeductions = deductions.filter((d) => d.order_id === order_id);
    
    if (orderDeductions.length === 0) {
      return res.status(404).json({
        ok: false,
        error: 'No confirmed deductions found for this order',
        order_id
      });
    }

    // Mark deductions as rolled back (keep for audit trail)
    const rolledBackAt = new Date().toISOString();
    for (const deduction of orderDeductions) {
      deduction.status = 'rolled_back';
      deduction.rolled_back_at = rolledBackAt;
      deduction.rollback_reason = reason;
    }

    saveDeductions(deductions);
    
    console.log(`[Wholesale Sync] ROLLBACK: Restored inventory for order ${order_id}:`, orderDeductions.length, 'items -', reason);
    return res.json({
      ok: true,
      order_id,
      rolled_back: orderDeductions.length,
      reason,
      items: orderDeductions.map(d => ({ sku_id: d.sku_id, quantity: d.quantity }))
    });
  } catch (error) {
    console.error('[Wholesale Sync] Failed to rollback inventory:', error);
    return res.status(500).json({ ok: false, error: 'Failed to rollback inventory' });
  }
});

/**
 * GET /api/wholesale/inventory/reservations
 * View current reservations (for debugging/admin)
 */
router.get('/inventory/reservations', async (_req, res) => {
  try {
    const active = await reservationStore.getActiveReservations();
    return res.json({ ok: true, reservations: active });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * GET /api/wholesale/schedule
 * Return farm pickup windows and delivery logistics
 * 
 * Response format:
 * {
 *   farm_id: string,
 *   pickup_windows: [{
 *     day: string (Monday, Tuesday, etc.),
 *     time_start: string (HH:MM),
 *     time_end: string (HH:MM),
 *     capacity: number (max orders per window),
 *     current_bookings: number
 *   }],
 *   lead_time_hours: number,
 *   delivery_notes: string
 * }
 */
router.get('/schedule', async (req, res) => {
  try {
    console.log('[Wholesale Sync] GreenReach requesting pickup schedule');

    const farmInfo = readFarmInfo();
    const farmSchedule = {
      farm_id: farmInfo.farmId,
      farm_name: farmInfo.name,
      pickup_windows: [
        {
          day: 'Monday',
          time_start: '06:00',
          time_end: '10:00',
          capacity: 20,
          current_bookings: 5
        },
        {
          day: 'Tuesday',
          time_start: '06:00',
          time_end: '10:00',
          capacity: 20,
          current_bookings: 8
        },
        {
          day: 'Thursday',
          time_start: '06:00',
          time_end: '10:00',
          capacity: 20,
          current_bookings: 3
        },
        {
          day: 'Friday',
          time_start: '06:00',
          time_end: '10:00',
          capacity: 20,
          current_bookings: 12
        }
      ],
      lead_time_hours: 48, // Minimum 48 hours notice required
      delivery_notes: 'Loading dock access. Palletized orders only for quantities over 500 lbs.'
    };

    res.json({
      ok: true,
      ...farmSchedule
    });

  } catch (error) {
    console.error('[Wholesale Sync] Failed to fetch schedule:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to retrieve pickup schedule',
      message: error.message
    });
  }
});

/**
 * GET /api/wholesale/pricing
 * Return wholesale pricing matrix by SKU and quantity tiers
 * 
 * Response format:
 * {
 *   farm_id: string,
 *   pricing: [{
 *     sku_id: string,
 *     sku_name: string,
 *     base_price: number,
 *     volume_tiers: [{
 *       min_qty: number,
 *       max_qty: number,
 *       price_per_unit: number
 *     }],
 *     min_order_qty: number
 *   }]
 * }
 */
router.get('/pricing', async (req, res) => {
  try {
    console.log('[Wholesale Sync] GreenReach requesting pricing data');

    const farmInfo = readFarmInfo();
    const pricingData = {
      farm_id: farmInfo.farmId,
      pricing: [
        {
          sku_id: 'SKU-ROMAINE-5LB',
          sku_name: 'Romaine Lettuce, 5lb case',
          base_price: 12.50,
          volume_tiers: [
            { min_qty: 1, max_qty: 19, price_per_unit: 12.50 },
            { min_qty: 20, max_qty: 49, price_per_unit: 11.50 },
            { min_qty: 50, max_qty: null, price_per_unit: 10.50 }
          ],
          min_order_qty: 5
        },
        {
          sku_id: 'SKU-BASIL-1LB',
          sku_name: 'Sweet Basil, 1lb bunch',
          base_price: 8.00,
          volume_tiers: [
            { min_qty: 1, max_qty: 49, price_per_unit: 8.00 },
            { min_qty: 50, max_qty: 99, price_per_unit: 7.50 },
            { min_qty: 100, max_qty: null, price_per_unit: 7.00 }
          ],
          min_order_qty: 10
        }
      ]
    };

    res.json({
      ok: true,
      ...pricingData
    });

  } catch (error) {
    console.error('[Wholesale Sync] Failed to fetch pricing:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to retrieve pricing data',
      message: error.message
    });
  }
});

/**
 * GET /api/wholesale/order-statuses
 * Return order statuses from storage
 */
router.get('/order-statuses', async (req, res) => {
  try {
    const statusFile = path.join(PUBLIC_DIR, 'data', 'wholesale-orders-status.json');
    
    if (fs.existsSync(statusFile)) {
      const data = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
      res.json({ ok: true, statuses: data });
    } else {
      res.json({ ok: true, statuses: {} });
    }
  } catch (error) {
    console.error('[Wholesale Sync] Failed to load order statuses:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * POST /api/wholesale/order-statuses
 * Save order statuses to storage
 */
router.post('/order-statuses', wholesaleAuthMiddleware, async (req, res) => {
  try {
    const statusFile = path.join(PUBLIC_DIR, 'data', 'wholesale-orders-status.json');
    const statusDir = path.dirname(statusFile);
    
    // Ensure directory exists
    if (!fs.existsSync(statusDir)) {
      fs.mkdirSync(statusDir, { recursive: true });
    }
    
    // Write status data
    fs.writeFileSync(statusFile, JSON.stringify(req.body, null, 2), 'utf8');
    
    console.log('[Wholesale Sync] Order statuses saved');
    res.json({ ok: true, message: 'Order statuses saved' });
    
  } catch (error) {
    console.error('[Wholesale Sync] Failed to save order statuses:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});



export default router;
