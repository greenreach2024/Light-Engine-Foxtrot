/**
 * Order State Machine
 * Enforces valid status transitions for wholesale orders.
 * Prevents ad-hoc status mutations that could leave orders in invalid states.
 */

// ── Order status transitions (buyer/admin facing) ────────────────────
const ORDER_TRANSITIONS = {
  'new':              ['pending', 'pending_verification', 'confirmed', 'cancelled', 'rejected'],
  'pending':          ['pending_verification', 'confirmed', 'processing', 'cancelled', 'rejected'],
  'pending_verification': ['confirmed', 'cancelled', 'rejected', 'expired'],
  'confirmed':        ['processing', 'shipped', 'cancelled'],
  'processing':       ['shipped', 'cancelled'],
  'shipped':          ['delivered', 'returned'],
  'delivered':        [],
  'cancelled':        [],
  'returned':         [],
  'rejected':         ['confirmed', 'cancelled'],
  'payment_failed':   ['confirmed', 'cancelled'],
  'pending_payment':  ['confirmed', 'cancelled'],
};

// ── Fulfillment status transitions (farm facing) ─────────────────────
// NOTE: uses 'cancelled' (double-L) to match ORDER_TRANSITIONS spelling.
const FULFILLMENT_TRANSITIONS = {
  'pending':     ['processing', 'fulfilled', 'cancelled', 'shipped'],
  'processing':  ['fulfilled', 'cancelled', 'shipped'],
  'fulfilled':   ['shipped', 'delivered'],
  'shipped':     ['delivered'],
  'cancelled':   [],
  'delivered':   []
};

// Map from fulfillment status to the corresponding order status.
// Used by promoteOrderStatus() to keep the two tracks in sync.
const FULFILLMENT_TO_ORDER = {
  'processing':  'processing',
  'fulfilled':   'processing',
  'shipped':     'shipped',
  'delivered':   'delivered',
  'cancelled':   'cancelled',
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
  // Normalize farm-facing statuses to fulfillment statuses
  const FARM_TO_FULFILLMENT = { 'confirmed': 'processing', 'packed': 'fulfilled', 'canceled': 'cancelled' };
  const normalized = FARM_TO_FULFILLMENT[newStatus] || newStatus;
  const current = order.fulfillment_status || 'pending';
  const currentNorm = current === 'canceled' ? 'cancelled' : current;
  const allowed = FULFILLMENT_TRANSITIONS[currentNorm];
  if (!allowed) {
    throw new Error(`Unknown fulfillment status: ${current}`);
  }
  if (!allowed.includes(normalized)) {
    throw new Error(`Invalid fulfillment status transition: ${currentNorm} → ${normalized}`);
  }
  order.fulfillment_status = normalized;
  order.status_updated_at = new Date().toISOString();
  return order;
}

/**
 * Promote order.status to match a fulfillment status change.
 * Only advances forward — never downgrades the order status.
 * Returns true if the order status was changed.
 */
export function promoteOrderStatus(order) {
  const fulfillment = order.fulfillment_status || 'pending';
  const target = FULFILLMENT_TO_ORDER[fulfillment];
  if (!target) return false;
  const current = order.status || 'pending';
  if (current === target) return false;
  const allowed = ORDER_TRANSITIONS[current];
  if (allowed && allowed.includes(target)) {
    order.status = target;
    order.status_updated_at = new Date().toISOString();
    return true;
  }
  return false;
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
  const current = (currentStatus === 'canceled' ? 'cancelled' : currentStatus) || 'pending';
  const target = newStatus === 'canceled' ? 'cancelled' : newStatus;
  return FULFILLMENT_TRANSITIONS[current]?.includes(target) ?? false;
}

export const ORDER_STATUSES = Object.keys(ORDER_TRANSITIONS);
export const FULFILLMENT_STATUSES = Object.keys(FULFILLMENT_TRANSITIONS);
