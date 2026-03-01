/**
 * GreenReach Wholesale - Persistent Order Store
 *
 * Shared NeDB-backed store for wholesale orders + sub-orders.
 * Used by checkout.js, wholesale-orders.js, deadline-monitor.js,
 * and alternative-farm-service.js.
 *
 * Collections:
 *   ordersDB       – master orders (keyed by master_order_id)
 *   subOrdersDB    – farm sub-orders (keyed by sub_order_id, indexed by master_order_id & farm_id)
 *   perfEventsDB   – farm performance events (append-only metrics for analytics)
 */

import Datastore from 'nedb-promises';
import fs from 'node:fs';
import path from 'node:path';

const IS_TEST_ENV = process.env.NODE_ENV === 'test' || String(process.env.TEST_MODE).toLowerCase() === 'true' || String(process.env.TEST_MODE) === '1';
if (!IS_TEST_ENV) {
  try { fs.mkdirSync(path.resolve('data'), { recursive: true }); } catch {}
}

function createStore(filename) {
  return Datastore.create({
    filename,
    autoload: !IS_TEST_ENV,
    inMemoryOnly: IS_TEST_ENV,
  });
}

// ─── Master Orders ────────────────────────────────────────────
const ordersDB = createStore('data/wholesale-orders.db');
ordersDB.ensureIndex({ fieldName: 'master_order_id', unique: true });
ordersDB.ensureIndex({ fieldName: 'buyer_id' });
ordersDB.ensureIndex({ fieldName: 'status' });
ordersDB.ensureIndex({ fieldName: 'created_at' });
ordersDB.persistence.setAutocompactionInterval(600000);

// ─── Sub-Orders ───────────────────────────────────────────────
const subOrdersDB = createStore('data/wholesale-sub-orders.db');
subOrdersDB.ensureIndex({ fieldName: 'sub_order_id', unique: true });
subOrdersDB.ensureIndex({ fieldName: 'master_order_id' });
subOrdersDB.ensureIndex({ fieldName: 'farm_id' });
subOrdersDB.ensureIndex({ fieldName: 'status' });
subOrdersDB.ensureIndex({ fieldName: 'verification_deadline' });
subOrdersDB.persistence.setAutocompactionInterval(600000);

// ─── Farm Performance Events ─────────────────────────────────
const perfEventsDB = createStore('data/farm-perf-events.db');
perfEventsDB.ensureIndex({ fieldName: 'farm_id' });
perfEventsDB.ensureIndex({ fieldName: 'event_type' });
perfEventsDB.persistence.setAutocompactionInterval(600000);

// ─── Helpers ──────────────────────────────────────────────────

/** Save or upsert a master order */
export async function saveOrder(order) {
  const existing = await ordersDB.findOne({ master_order_id: order.master_order_id || order.id });
  if (existing) {
    await ordersDB.update({ _id: existing._id }, { $set: { ...order, updated_at: new Date().toISOString() } });
    return { ...existing, ...order };
  }
  const doc = {
    ...order,
    master_order_id: order.master_order_id || order.id,
    created_at: order.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  return ordersDB.insert(doc);
}

/** Get a master order by its ID */
export async function getOrder(masterOrderId) {
  return ordersDB.findOne({ master_order_id: masterOrderId });
}

/** List orders for a buyer */
export async function listBuyerOrders(buyerId, limit = 50) {
  return ordersDB.find({ buyer_id: buyerId }).sort({ created_at: -1 }).limit(limit);
}

/** List recent master orders without buyer filter */
export async function listOrders(limit = 200) {
  return ordersDB.find({}).sort({ created_at: -1 }).limit(limit);
}

/** Update order status */
export async function updateOrderStatus(masterOrderId, status) {
  return ordersDB.update(
    { master_order_id: masterOrderId },
    { $set: { status, updated_at: new Date().toISOString() } }
  );
}

/** Save or upsert a sub-order */
export async function saveSubOrder(subOrder) {
  const existing = await subOrdersDB.findOne({ sub_order_id: subOrder.sub_order_id });
  if (existing) {
    await subOrdersDB.update({ _id: existing._id }, { $set: { ...subOrder, updated_at: new Date().toISOString() } });
    return { ...existing, ...subOrder };
  }
  const doc = {
    ...subOrder,
    created_at: subOrder.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  return subOrdersDB.insert(doc);
}

/** Get a sub-order by its ID */
export async function getSubOrder(subOrderId) {
  return subOrdersDB.findOne({ sub_order_id: subOrderId });
}

/** List sub-orders for a master order */
export async function listSubOrders(masterOrderId) {
  return subOrdersDB.find({ master_order_id: masterOrderId }).sort({ created_at: 1 });
}

/** List sub-orders for a farm by status */
export async function listFarmSubOrders(farmId, status = null) {
  const q = { farm_id: farmId };
  if (status) q.status = status;
  return subOrdersDB.find(q).sort({ created_at: -1 });
}

/** Update sub-order status */
export async function updateSubOrderStatus(subOrderId, status, extra = {}) {
  return subOrdersDB.update(
    { sub_order_id: subOrderId },
    { $set: { status, ...extra, updated_at: new Date().toISOString() } }
  );
}

/** Get expired sub-orders (deadline passed, still pending) */
export async function getExpiredSubOrders() {
  const now = new Date().toISOString();
  return subOrdersDB.find({
    status: 'pending_verification',
    verification_deadline: { $lt: now },
    is_expired: { $ne: true }
  });
}

/** Get upcoming deadline sub-orders (within next N hours) */
export async function getUpcomingDeadlineSubOrders(hoursAhead = 7) {
  const now = new Date();
  const windowStart = new Date(now.getTime() + (hoursAhead - 1) * 3600000).toISOString();
  const windowEnd = new Date(now.getTime() + hoursAhead * 3600000).toISOString();
  return subOrdersDB.find({
    status: 'pending_verification',
    verification_deadline: { $gte: windowStart, $lte: windowEnd },
    reminder_sent: { $ne: true }
  });
}

/** Record a farm performance event */
export async function recordPerfEvent(event) {
  return perfEventsDB.insert({
    ...event,
    created_at: new Date().toISOString()
  });
}

/** Get performance events for a farm */
export async function getFarmPerfEvents(farmId, limit = 100) {
  return perfEventsDB.find({ farm_id: farmId }).sort({ created_at: -1 }).limit(limit);
}

/** Check if all sub-orders for a master order have a given status */
export async function allSubOrdersInStatus(masterOrderId, status) {
  const subs = await subOrdersDB.find({ master_order_id: masterOrderId });
  if (subs.length === 0) return false;
  return subs.every(s => s.status === status);
}

export default {
  ordersDB,
  subOrdersDB,
  perfEventsDB,
  saveOrder,
  getOrder,
  listBuyerOrders,
  listOrders,
  updateOrderStatus,
  saveSubOrder,
  getSubOrder,
  listSubOrders,
  listFarmSubOrders,
  updateSubOrderStatus,
  getExpiredSubOrders,
  getUpcomingDeadlineSubOrders,
  recordPerfEvent,
  getFarmPerfEvents,
  allSubOrdersInStatus
};
