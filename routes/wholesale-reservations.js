/**
 * Light Engine: Wholesale Reservation Management
 * Handles inventory holds from GreenReach during checkout
 * Prevents overselling across multiple farms
 */

import express from 'express';
import fs from 'fs';
import * as reservationStore from '../lib/wholesale/reservation-store.js';

const router = express.Router();

// In-memory reservation store (DEPRECATED: Dual-write to NeDB)
const reservations = new Map();

// Feature flags
const WHOLESALE_READ_FROM_DB = process.env.WHOLESALE_READ_FROM_DB === 'true';

function getCatalogAvailableQty(skuId) {
  try {
    const raw = fs.readFileSync('public/data/wholesale-products.json', 'utf8');
    const parsed = JSON.parse(raw);
    const products = Array.isArray(parsed?.products) ? parsed.products : [];
    const match = products.find((p) => p?.sku_id === skuId);
    return Number(match?.quantity_available || 0);
  } catch {
    return 0;
  }
}

/**
 * POST /api/wholesale/reserve
 * Create a reservation hold on inventory for checkout
 * 
 * Request body:
 * {
 *   lot_id: string,
 *   sku_id: string,
 *   qty: number,
 *   ttl_minutes: number (default 15),
 *   order_id: string,
 *   buyer_id: string
 * }
 * 
 * Response:
 * {
 *   ok: true,
 *   reservation_id: string,
 *   lot_id: string,
 *   qty_reserved: number,
 *   expires_at: ISO timestamp
 * }
 */
router.post('/reserve', async (req, res) => {
  try {
    const { lot_id, sku_id, qty, ttl_minutes = 15, order_id, buyer_id } = req.body;

    // Validate request
    if (!lot_id || !sku_id || !qty || !order_id) {
      return res.status(400).json({
        ok: false,
        error: 'Missing required fields: lot_id, sku_id, qty, order_id'
      });
    }

    if (qty <= 0) {
      return res.status(400).json({
        ok: false,
        error: 'Quantity must be greater than zero'
      });
    }

    // Real availability check: catalog qty - active reservations
    const available = getCatalogAvailableQty(sku_id);
    const currentReserved = WHOLESALE_READ_FROM_DB
      ? await reservationStore.getReservedQty(sku_id)
      : Array.from(reservations.values())
          .filter((r) => r.status === 'active' && r.sku_id === sku_id)
          .reduce((sum, r) => sum + Number(r.qty || 0), 0);

    if (qty > (available - currentReserved)) {
      return res.status(409).json({
        ok: false,
        error: 'Insufficient inventory',
        available: available - currentReserved,
        requested: qty
      });
    }

    // Create reservation
    // DUAL-WRITE: Create in NeDB (generates reservation_id)
    const reservation = await reservationStore.createReservation({
      lot_id,
      sku_id,
      qty,
      order_id,
      buyer_id,
      ttl_minutes
    });
    
    const { reservation_id, expires_at } = reservation;

    reservations.set(reservation_id, reservation);
    
    // NOTE: TTL cleanup now handled by periodic cleanup job (see reservation-store.js)
    // No more setTimeout() pattern that breaks on server restart

    console.log(`[Reservation] Created: ${reservation_id} for lot ${lot_id}, qty ${qty}, expires in ${ttl_minutes} min`);

    res.json({
      ok: true,
      reservation_id,
      lot_id,
      sku_id,
      qty_reserved: qty,
      expires_at
    });

  } catch (error) {
    console.error('[Reservation] Failed to create reservation:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to create reservation',
      message: error.message
    });
  }
});

/**
 * POST /api/wholesale/release
 * Release a reservation hold (checkout cancelled or failed)
 * 
 * Request body:
 * {
 *   reservation_id: string
 * }
 */
router.post('/release', async (req, res) => {
  try {
    const { reservation_id } = req.body;

    if (!reservation_id) {
      return res.status(400).json({
        ok: false,
        error: 'reservation_id is required'
      });
    }

    let reservation = reservations.get(reservation_id);
    
    // DUAL-READ: Fall back to NeDB if not in Map
    if (!reservation && WHOLESALE_READ_FROM_DB) {
      reservation = await reservationStore.getReservation(reservation_id);
    }
    
    if (!reservation) {
      return res.status(404).json({
        ok: false,
        error: 'Reservation not found or already released'
      });
    }

    if (reservation.status !== 'active') {
      return res.status(409).json({
        ok: false,
        error: `Reservation is ${reservation.status}, cannot release`
      });
    }

    // Release reservation
    reservation.status = 'released';
    reservation.released_at = new Date().toISOString();
    reservations.delete(reservation_id);

    // DUAL-WRITE: Update status in NeDB
    await reservationStore.releaseReservation(reservation_id);

    console.log(`[Reservation] Released: ${reservation_id} for lot ${reservation.lot_id}`);

    // TODO: Release inventory hold in database

    res.json({
      ok: true,
      reservation_id,
      status: 'released',
      released_at: reservation.released_at
    });

  } catch (error) {
    console.error('[Reservation] Failed to release reservation:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to release reservation',
      message: error.message
    });
  }
});

/**
 * POST /api/wholesale/confirm
 * Confirm reservation and decrement inventory permanently (payment succeeded)
 * 
 * Request body:
 * {
 *   reservation_id: string,
 *   sub_order_id: string (for traceability)
 * }
 */
router.post('/confirm', async (req, res) => {
  try {
    const { reservation_id, sub_order_id } = req.body;

    if (!reservation_id || !sub_order_id) {
      return res.status(400).json({
        ok: false,
        error: 'reservation_id and sub_order_id are required'
      });
    }

    let reservation = reservations.get(reservation_id);
    
    // DUAL-READ: Fall back to NeDB if not in Map
    if (!reservation && WHOLESALE_READ_FROM_DB) {
      reservation = await reservationStore.getReservation(reservation_id);
    }
    
    if (!reservation) {
      return res.status(404).json({
        ok: false,
        error: 'Reservation not found'
      });
    }

    if (reservation.status !== 'active') {
      return res.status(409).json({
        ok: false,
        error: `Reservation is ${reservation.status}, cannot confirm`
      });
    }

    // Confirm reservation and decrement inventory
    const confirmed_at = new Date().toISOString();
    
    // Update in Map
    reservation.status = 'confirmed';
    reservation.confirmed_at = confirmed_at;
    reservation.sub_order_id = sub_order_id;
    reservations.set(reservation_id, reservation);
    
    // DUAL-WRITE: Update in NeDB
    await reservationStore.confirmReservation(reservation_id);

    console.log(`[Reservation] Confirmed: ${reservation_id} for sub-order ${sub_order_id}`);
    console.log(`  Lot: ${reservation.lot_id}, Qty: ${reservation.qty}`);

    res.json({
      ok: true,
      reservation_id,
      sub_order_id,
      status: 'confirmed',
      lot_id: reservation.lot_id,
      qty_confirmed: reservation.qty,
      confirmed_at
    });

  } catch (error) {
    console.error('[Reservation] Failed to confirm reservation:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to confirm reservation',
      message: error.message
    });
  }
});

/**
 * GET /api/wholesale/reservations
 * List active reservations (for farm visibility)
 */
router.get('/reservations', async (req, res) => {
  try {
    let activeReservations = [];

    if (WHOLESALE_READ_FROM_DB) {
      const dbReservations = await reservationStore.getActiveReservations();
      activeReservations = dbReservations.map((r) => ({
        reservation_id: r.reservation_id,
        lot_id: r.lot_id,
        sku_id: r.sku_id,
        qty: r.qty,
        order_id: r.order_id,
        expires_at: r.expires_at,
        time_remaining_minutes: Math.max(0, Math.floor((new Date(r.expires_at) - new Date()) / 60000))
      }));
    } else {
      activeReservations = Array.from(reservations.values())
        .filter(r => r.status === 'active')
        .map(r => ({
          reservation_id: r.reservation_id,
          lot_id: r.lot_id,
          sku_id: r.sku_id,
          qty: r.qty,
          order_id: r.order_id,
          expires_at: r.expires_at,
          time_remaining_minutes: Math.max(0, Math.floor((new Date(r.expires_at) - new Date()) / 60000))
        }));
    }

    res.json({
      ok: true,
      active_reservations: activeReservations.length,
      reservations: activeReservations
    });

  } catch (error) {
    console.error('[Reservation] Failed to list reservations:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to list reservations',
      message: error.message
    });
  }
});

/**
 * Cleanup expired reservations
 * Called by periodic job in server-foxtrot.js
 */
export async function cleanupExpiredReservations() {
  // Cleanup NeDB (primary source of truth)
  const dbCleaned = await reservationStore.cleanupExpiredReservations();
  
  // Also cleanup Map (for backward compatibility during dual-write phase)
  const now = new Date();
  let cleaned = 0;
  
  for (const [id, reservation] of reservations.entries()) {
    if (reservation.status === 'active' && new Date(reservation.expires_at) < now) {
      console.log(`🧹 [Cleanup] Releasing expired reservation ${id}`);
      reservation.status = 'expired';
      reservations.delete(id);
      cleaned++;
    }
  }
  
  if (cleaned > 0) {
    console.log(`✓ [Cleanup] Released ${cleaned} expired reservation(s) from Map`);
  }
  
  return { 
    cleaned: cleaned + dbCleaned, 
    active: Array.from(reservations.values()).filter(r => r.status === 'active').length 
  };
}

export default router;
