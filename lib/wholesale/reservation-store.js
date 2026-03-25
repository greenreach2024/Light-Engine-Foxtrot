/**
 * GreenReach Wholesale - Inventory Reservation Store
 *
 * NeDB-backed store for inventory reservation holds during checkout.
 * Replaces volatile in-memory Map + setTimeout TTL pattern.
 *
 * Collections:
 *   reservationsDB – Active inventory holds (TTL-based auto-release)
 */

import Datastore from 'nedb-promises';
import fs from 'node:fs';
import path from 'node:path';

const IS_TEST_ENV = process.env.NODE_ENV === 'test' || String(process.env.TEST_MODE).toLowerCase() === 'true' || String(process.env.TEST_MODE) === '1';
if (!IS_TEST_ENV) {
  try { fs.mkdirSync(path.resolve('data'), { recursive: true }); } catch {}
}

// ─── Reservations ────────────────────────────────────────────
const reservationsDB = Datastore.create({ 
  filename: 'data/inventory-reservations.db', 
  autoload: !IS_TEST_ENV,
  inMemoryOnly: IS_TEST_ENV
});
reservationsDB.ensureIndex({ fieldName: 'reservation_id', unique: true });
reservationsDB.ensureIndex({ fieldName: 'order_id' });
reservationsDB.ensureIndex({ fieldName: 'lot_id' });
reservationsDB.ensureIndex({ fieldName: 'sku_id' });
reservationsDB.ensureIndex({ fieldName: 'status' });
reservationsDB.ensureIndex({ fieldName: 'expires_at' });
reservationsDB.persistence.setAutocompactionInterval(600000); // 10 min

// ─── Reservation Helpers ─────────────────────────────────────

/**
 * Create a new inventory reservation
 * @param {object} reservationData - { lot_id, sku_id, qty, order_id, buyer_id, ttl_minutes }
 * @returns {object} Created reservation with reservation_id
 */
export async function createReservation(reservationData) {
  const reservation_id = `RES-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const ttl_minutes = reservationData.ttl_minutes || 15;
  const expires_at = new Date(Date.now() + ttl_minutes * 60 * 1000);

  const doc = {
    reservation_id,
    lot_id: reservationData.lot_id,
    sku_id: reservationData.sku_id,
    qty: reservationData.qty,
    order_id: reservationData.order_id,
    buyer_id: reservationData.buyer_id,
    status: 'active',
    created_at: new Date().toISOString(),
    expires_at: expires_at.toISOString()
  };

  await reservationsDB.insert(doc);
  return doc;
}

/**
 * Get reservation by ID
 * @param {string} reservationId 
 * @returns {object|null}
 */
export async function getReservation(reservationId) {
  return reservationsDB.findOne({ reservation_id: reservationId });
}

/**
 * Get all active reservations for an order
 * @param {string} orderId 
 * @returns {Array}
 */
export async function getOrderReservations(orderId) {
  return reservationsDB.find({ order_id: orderId, status: 'active' });
}

/**
 * Get all active reservations
 * @returns {Array}
 */
export async function getActiveReservations() {
  return reservationsDB.find({ status: 'active' });
}

/**
 * Get total reserved quantity for a SKU
 * @param {string} skuId 
 * @returns {number} Total qty reserved
 */
export async function getReservedQty(skuId) {
  const now = new Date().toISOString();
  const activeReservations = await reservationsDB.find({ 
    sku_id: skuId, 
    status: 'active',
    expires_at: { $gt: now }
  });
  return activeReservations.reduce((sum, res) => sum + res.qty, 0);
}

/**
 * Get total reserved quantity for a lot
 * @param {string} lotId 
 * @returns {number} Total qty reserved
 */
export async function getReservedQtyByLot(lotId) {
  const activeReservations = await reservationsDB.find({ 
    lot_id: lotId, 
    status: 'active' 
  });
  return activeReservations.reduce((sum, res) => sum + res.qty, 0);
}

/**
 * Update reservation status
 * @param {string} reservationId 
 * @param {string} status - 'active' | 'confirmed' | 'released' | 'expired'
 * @returns {number} Number of updated docs
 */
export async function updateReservationStatus(reservationId, status) {
  return reservationsDB.update(
    { reservation_id: reservationId },
    { $set: { status, updated_at: new Date().toISOString() } }
  );
}

/**
 * Release (cancel) a reservation
 * @param {string} reservationId 
 * @returns {number} Number of updated docs
 */
export async function releaseReservation(reservationId) {
  return updateReservationStatus(reservationId, 'released');
}

/**
 * Confirm a reservation (order completed)
 * @param {string} reservationId 
 * @returns {number} Number of updated docs
 */
export async function confirmReservation(reservationId) {
  return updateReservationStatus(reservationId, 'confirmed');
}

/**
 * Confirm all reservations for an order
 * @param {string} orderId 
 * @returns {number} Number of updated docs
 */
export async function confirmOrderReservations(orderId) {
  return reservationsDB.update(
    { order_id: orderId, status: 'active' },
    { $set: { status: 'confirmed', updated_at: new Date().toISOString() } },
    { multi: true }
  );
}

/**
 * Release all reservations for an order
 * @param {string} orderId 
 * @returns {number} Number of updated docs
 */
export async function releaseOrderReservations(orderId) {
  return reservationsDB.update(
    { order_id: orderId, status: 'active' },
    { $set: { status: 'released', updated_at: new Date().toISOString() } },
    { multi: true }
  );
}

/**
 * Cleanup expired reservations (run periodically)
 * Marks expired active reservations as 'expired' and releases inventory
 */
export async function cleanupExpiredReservations() {
  const now = new Date().toISOString();
  const expiredReservations = await reservationsDB.find({
    status: 'active',
    expires_at: { $lt: now }
  });

  if (expiredReservations.length > 0) {
    console.log(`[reservation-store] Found ${expiredReservations.length} expired reservations`);
    
    // Mark as expired
    const result = await reservationsDB.update(
      { status: 'active', expires_at: { $lt: now } },
      { $set: { status: 'expired', updated_at: new Date().toISOString() } },
      { multi: true }
    );

    // TODO: Trigger inventory hold release in farm inventory system
    for (const res of expiredReservations) {
      console.log(`[reservation-store] Auto-released expired reservation ${res.reservation_id} (lot: ${res.lot_id}, qty: ${res.qty})`);
    }

    return result;
  }
  
  return 0;
}

/**
 * Delete old expired/confirmed/released reservations (cleanup job)
 * @param {number} olderThanDays - Delete reservations older than X days (default 7)
 * @returns {number} Number of deleted docs
 */
export async function deleteOldReservations(olderThanDays = 7) {
  const cutoffDate = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
  const result = await reservationsDB.remove(
    { 
      status: { $in: ['expired', 'confirmed', 'released'] },
      created_at: { $lt: cutoffDate.toISOString() }
    },
    { multi: true }
  );
  
  if (result > 0) {
    console.log(`[reservation-store] Deleted ${result} old reservations (>${olderThanDays} days)`);
  }
  
  return result;
}

// ─── Periodic Cleanup ────────────────────────────────────────

/**
 * Start TTL cleanup interval (call once on server boot)
 * Runs every 60 seconds to expire old reservations
 */
export function startReservationCleanup() {
  // Expire old active reservations
  setInterval(async () => {
    try {
      await cleanupExpiredReservations();
    } catch (err) {
      console.error('[reservation-store] Reservation cleanup error:', err);
    }
  }, 60000); // 60 seconds

  // Delete very old non-active reservations (daily)
  setInterval(async () => {
    try {
      await deleteOldReservations(7);
    } catch (err) {
      console.error('[reservation-store] Old reservation deletion error:', err);
    }
  }, 24 * 60 * 60 * 1000); // 24 hours
  
  console.log('[reservation-store] Reservation cleanup started (60s expiry check, 24h old deletion)');
}
