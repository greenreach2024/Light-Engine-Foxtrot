/**
 * Order State Machine
 * Enforces valid status transitions for wholesale orders.
 * Prevents ad-hoc status mutations that could leave orders in invalid states.
 */

// ── Order status transitions (buyer/admin facing) ────────────────────
const ORDER_TRANSITIONS = {
  'new':         ['pending', 'confirmed', 'cancelled', 'rejected'],
  'pending':     ['confirmed', 'processing', 'cancelled', 'rejected'],
  'confirmed':   ['processing', 'shipped', 'cancelled'],
  'processing':  ['shipped', 'cancelled'],
  'shipped':     ['delivered', 'returned'],
  'delivered':   [],
  'cancelled':   [],
  'returned':    [],
  'rejected':    []
};

// ── Fulfillment status transitions (farm facing) ─────────────────────
const FULFILLMENT_TRANSITIONS = {
  'pending':     ['processing', 'fulfilled', 'canceled', 'shipped'],
  'processing':  ['fulfilled', 'canceled', 'shipped'],
  'fulfilled':   ['shipped', 'delivered'],
  'shipped':     ['delivered'],
  'canceled':    [],
  'delivered':   []
};

/**
 * Transition an order's status field with validation.
 * @param {object} order - The order object (mutated in place)
 * @param {string} newStatus - Target status
 * @returns {object} The mutated order
 * @throws {Error} If the transition is invalid
 */
export function transitionOrderStatus(order, newStatus) {
  const current = order.status || 'pending';
  const allowed = ORDER_TRANSITIONS[current];
  if (!allowed) {
    throw new Error(`Unknown order status: ${current}`);
  }
  if (!allowed.includes(newStatus)) {
    throw new Error(`Invalid order status transition: ${current} → ${newStatus}`);
  }
  order.status = newStatus;
  order.status_updated_at = new Date().toISOString();
  return order;
}

/**
 * Transition an order's fulfillment_status field with validation.
 * @param {object} order - The order object (mutated in place)
 * @param {string} newStatus - Target fulfillment status
 * @returns {object} The mutated order
 * @throws {Error} If the transition is invalid
 */
export function transitionFulfillmentStatus(order, newStatus) {
  const current = order.fulfillment_status || 'pending';
  const allowed = FULFILLMENT_TRANSITIONS[current];
  if (!allowed) {
    // Unknown current status — log warning but allow transition
    console.warn(`[OrderStateMachine] Unknown fulfillment status '${current}', allowing transition to '${newStatus}'`);
    order.fulfillment_status = newStatus;
    order.status_updated_at = new Date().toISOString();
    return order;
  }
  if (!allowed.includes(newStatus)) {
    throw new Error(`Invalid fulfillment status transition: ${current} → ${newStatus}`);
  }
  order.fulfillment_status = newStatus;
  order.status_updated_at = new Date().toISOString();
  return order;
}

/**
 * Check if an order status transition is valid without mutating.
 */
export function isValidOrderTransition(currentStatus, newStatus) {
  const current = currentStatus || 'pending';
  return ORDER_TRANSITIONS[current]?.includes(newStatus) ?? false;
}

/**
 * Check if a fulfillment status transition is valid without mutating.
 */
export function isValidFulfillmentTransition(currentStatus, newStatus) {
  const current = currentStatus || 'pending';
  return FULFILLMENT_TRANSITIONS[current]?.includes(newStatus) ?? false;
}

export const ORDER_STATUSES = Object.keys(ORDER_TRANSITIONS);
export const FULFILLMENT_STATUSES = Object.keys(FULFILLMENT_TRANSITIONS);
