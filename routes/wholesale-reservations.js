/**
 * Light Engine: Wholesale Reservation Management
 * Handles inventory holds from GreenReach during checkout
 * Prevents overselling across multiple farms
 */

import express from 'express';
const router = express.Router();

// In-memory reservation store (in production, use database with TTL)
const reservations = new Map();

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

    // TODO: Check actual farm inventory availability
    // For now, simulate availability check
    const available = 100; // Mock available quantity
    const currentReserved = 0; // Mock current reservations

    if (qty > (available - currentReserved)) {
      return res.status(409).json({
        ok: false,
        error: 'Insufficient inventory',
        available: available - currentReserved,
        requested: qty
      });
    }

    // Create reservation
    const reservation_id = `RES-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const expires_at = new Date(Date.now() + ttl_minutes * 60 * 1000);

    const reservation = {
      reservation_id,
      lot_id,
      sku_id,
      qty,
      order_id,
      buyer_id,
      status: 'active',
      created_at: new Date().toISOString(),
      expires_at: expires_at.toISOString()
    };

    reservations.set(reservation_id, reservation);

    // Set TTL cleanup
    setTimeout(() => {
      const res = reservations.get(reservation_id);
      if (res && res.status === 'active') {
        console.log(`[Reservation] Auto-releasing expired reservation ${reservation_id}`);
        res.status = 'expired';
        reservations.delete(reservation_id);
        // TODO: Release inventory hold in database
      }
    }, ttl_minutes * 60 * 1000);

    console.log(`[Reservation] Created: ${reservation_id} for lot ${lot_id}, qty ${qty}, expires in ${ttl_minutes} min`);

    res.json({
      ok: true,
      reservation_id,
      lot_id,
      sku_id,
      qty_reserved: qty,
      expires_at: reservation.expires_at
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

    const reservation = reservations.get(reservation_id);
    
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

    const reservation = reservations.get(reservation_id);
    
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
    reservation.status = 'confirmed';
    reservation.confirmed_at = new Date().toISOString();
    reservation.sub_order_id = sub_order_id;

    console.log(`[Reservation] Confirmed: ${reservation_id} for sub-order ${sub_order_id}`);
    console.log(`  Lot: ${reservation.lot_id}, Qty: ${reservation.qty}`);

    // TODO: Permanently decrement inventory in database
    // TODO: Create audit trail entry

    // Keep reservation record for audit trail (don't delete)
    reservations.set(reservation_id, reservation);

    res.json({
      ok: true,
      reservation_id,
      sub_order_id,
      status: 'confirmed',
      lot_id: reservation.lot_id,
      qty_confirmed: reservation.qty,
      confirmed_at: reservation.confirmed_at
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
    const activeReservations = Array.from(reservations.values())
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

export default router;
