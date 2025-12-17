/**
 * GreenReach: Reservation Manager
 * Coordinates TTL holds across multiple farms during checkout
 */

/**
 * Create reservations for all line items in sub-orders
 * @param {Array} subOrders - Array of FarmSubOrder objects from allocator
 * @param {string} masterOrderId - Master order ID for traceability
 * @param {Object} options - Reservation options
 * @param {number} options.ttl_minutes - TTL in minutes (default: 15)
 * @returns {Promise<Object>} Reservation result
 */
export async function createReservations(subOrders, masterOrderId, options = {}) {
  const { ttl_minutes = 15 } = options;

  console.log('[Reservation Manager] Creating reservations for master order', masterOrderId);
  console.log(`  Sub-orders: ${subOrders.length}`);
  console.log(`  TTL: ${ttl_minutes} minutes`);

  const reservationResults = [];
  const failedReservations = [];

  // Get farm URLs from registered farms
  // TODO: Query from database in production
  const FARM_URLS = {
    'demo-farm-1': 'http://light-engine-demo-env.eba-smmuh8fc.us-east-1.elasticbeanstalk.com'
  };

  for (const subOrder of subOrders) {
    const farmUrl = FARM_URLS[subOrder.farm_id];
    
    if (!farmUrl) {
      console.error(`[Reservation Manager] No URL configured for farm ${subOrder.farm_id}`);
      failedReservations.push({
        farm_id: subOrder.farm_id,
        error: 'Farm URL not configured'
      });
      continue;
    }

    // Create reservations for each line item
    for (const lineItem of subOrder.line_items) {
      try {
        const reservationRequest = {
          lot_id: lineItem.lot_id,
          sku_id: lineItem.sku_id,
          qty: lineItem.qty,
          ttl_minutes,
          order_id: masterOrderId,
          buyer_id: 'buyer-placeholder' // TODO: Use actual buyer ID
        };

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000); // 10 second timeout

        const response = await fetch(`${farmUrl}/api/wholesale/reserve`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(reservationRequest),
          signal: controller.signal
        });

        clearTimeout(timeout);

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
          throw new Error(errorData.error || `HTTP ${response.status}`);
        }

        const reservation = await response.json();

        reservationResults.push({
          farm_id: subOrder.farm_id,
          farm_name: subOrder.farm_name,
          lot_id: lineItem.lot_id,
          sku_id: lineItem.sku_id,
          qty: lineItem.qty,
          reservation_id: reservation.reservation_id,
          expires_at: reservation.expires_at,
          success: true
        });

        // Store reservation ID on line item for later confirmation
        lineItem.reservation_id = reservation.reservation_id;

        console.log(`  Reserved: ${lineItem.qty} x ${lineItem.sku_id} from ${subOrder.farm_name} (${reservation.reservation_id})`);

      } catch (error) {
        console.error(`[Reservation Manager] Failed to reserve ${lineItem.sku_id} from ${subOrder.farm_name}:`, error.message);
        
        failedReservations.push({
          farm_id: subOrder.farm_id,
          farm_name: subOrder.farm_name,
          lot_id: lineItem.lot_id,
          sku_id: lineItem.sku_id,
          qty: lineItem.qty,
          error: error.message,
          success: false
        });
      }
    }
  }

  const allSucceeded = failedReservations.length === 0;

  // If any reservation failed, release all successful ones
  if (!allSucceeded) {
    console.error('[Reservation Manager] Reservation failures detected, rolling back...');
    await releaseReservations(reservationResults.filter(r => r.success));
  }

  return {
    ok: allSucceeded,
    reservations: reservationResults,
    failed_reservations: failedReservations,
    total_reserved: reservationResults.length,
    total_failed: failedReservations.length
  };
}

/**
 * Release reservations (checkout cancelled or payment failed)
 * @param {Array} reservations - Array of reservation objects with {farm_id, reservation_id}
 * @returns {Promise<Object>} Release result
 */
export async function releaseReservations(reservations) {
  console.log('[Reservation Manager] Releasing reservations:', reservations.length);

  const FARM_URLS = {
    'demo-farm-1': 'http://light-engine-demo-env.eba-smmuh8fc.us-east-1.elasticbeanstalk.com'
  };

  const releaseResults = [];

  for (const reservation of reservations) {
    const farmUrl = FARM_URLS[reservation.farm_id];
    
    if (!farmUrl) {
      console.warn(`[Reservation Manager] Cannot release: No URL for farm ${reservation.farm_id}`);
      continue;
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(`${farmUrl}/api/wholesale/release`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          reservation_id: reservation.reservation_id
        }),
        signal: controller.signal
      });

      clearTimeout(timeout);

      if (response.ok) {
        console.log(`  Released: ${reservation.reservation_id} from ${reservation.farm_name || reservation.farm_id}`);
        releaseResults.push({ ...reservation, released: true });
      } else {
        console.warn(`  Failed to release ${reservation.reservation_id}: HTTP ${response.status}`);
        releaseResults.push({ ...reservation, released: false });
      }

    } catch (error) {
      console.error(`[Reservation Manager] Error releasing ${reservation.reservation_id}:`, error.message);
      releaseResults.push({ ...reservation, released: false, error: error.message });
    }
  }

  return {
    ok: true,
    released_count: releaseResults.filter(r => r.released).length,
    failed_count: releaseResults.filter(r => !r.released).length,
    results: releaseResults
  };
}

/**
 * Confirm reservations (payment succeeded)
 * @param {Array} reservations - Array of reservation objects
 * @param {string} subOrderId - Sub-order ID for traceability
 * @returns {Promise<Object>} Confirmation result
 */
export async function confirmReservations(reservations, subOrderId) {
  console.log('[Reservation Manager] Confirming reservations for sub-order', subOrderId);

  const FARM_URLS = {
    'demo-farm-1': 'http://light-engine-demo-env.eba-smmuh8fc.us-east-1.elasticbeanstalk.com'
  };

  const confirmResults = [];

  for (const reservation of reservations) {
    const farmUrl = FARM_URLS[reservation.farm_id];
    
    if (!farmUrl) {
      console.error(`[Reservation Manager] Cannot confirm: No URL for farm ${reservation.farm_id}`);
      continue;
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(`${farmUrl}/api/wholesale/confirm`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          reservation_id: reservation.reservation_id,
          sub_order_id: subOrderId
        }),
        signal: controller.signal
      });

      clearTimeout(timeout);

      if (response.ok) {
        const data = await response.json();
        console.log(`  Confirmed: ${reservation.reservation_id} - inventory decremented`);
        confirmResults.push({ ...reservation, confirmed: true });
      } else {
        const errorData = await response.json().catch(() => ({}));
        console.error(`  Failed to confirm ${reservation.reservation_id}: ${errorData.error || response.status}`);
        confirmResults.push({ ...reservation, confirmed: false });
      }

    } catch (error) {
      console.error(`[Reservation Manager] Error confirming ${reservation.reservation_id}:`, error.message);
      confirmResults.push({ ...reservation, confirmed: false, error: error.message });
    }
  }

  return {
    ok: confirmResults.every(r => r.confirmed),
    confirmed_count: confirmResults.filter(r => r.confirmed).length,
    failed_count: confirmResults.filter(r => !r.confirmed).length,
    results: confirmResults
  };
}

export default {
  createReservations,
  releaseReservations,
  confirmReservations
};
