/**
 * GreenReach: Order Allocation Engine
 * Splits buyer cart into FarmSubOrders based on inventory, geography, and harvest windows
 */

/**
 * Allocate a cart into FarmSubOrders
 * 
 * @param {Object} cart - Buyer's cart
 * @param {Array} cart.items - Cart items: [{sku_id, qty, unit}]
 * @param {Object} cart.delivery - Delivery details: {address, delivery_date, zip}
 * @param {Object} catalog - Aggregated catalog from /api/wholesale/catalog
 * @param {Object} options - Allocation options
 * @param {number} options.broker_fee_percent - Broker fee percentage (default: 10%)
 * @param {string} options.allocation_strategy - 'closest' | 'cheapest' | 'earliest' (default: 'closest')
 * @returns {Object} Allocation result
 */
export async function allocateOrder(cart, catalog, options = {}) {
  const {
    broker_fee_percent = 10.0,
    allocation_strategy = 'closest',
    tax_rate = 0,
    tax_label = 'TAX'
  } = options;

  console.log('[Order Allocator] Starting allocation...');
  console.log(`  Cart items: ${cart.items.length}`);
  console.log(`  Delivery date: ${cart.delivery?.delivery_date}`);
  console.log(`  Strategy: ${allocation_strategy}`);

  const allocations = new Map(); // Map<farm_id, FarmSubOrder>
  const unallocatedItems = [];

  // Process each cart item
  for (const cartItem of cart.items) {
    const { sku_id, qty } = cartItem;

    // Find this SKU in catalog
    const catalogItem = catalog.items.find(item => item.sku_id === sku_id);
    
    if (!catalogItem) {
      console.warn(`[Order Allocator] SKU ${sku_id} not found in catalog`);
      unallocatedItems.push({
        sku_id,
        requested_qty: qty,
        reason: 'sku_not_found'
      });
      continue;
    }

    if (catalogItem.total_available < qty) {
      console.warn(`[Order Allocator] Insufficient inventory for ${sku_id}: need ${qty}, available ${catalogItem.total_available}`);
      unallocatedItems.push({
        sku_id,
        sku_name: catalogItem.sku_name,
        requested_qty: qty,
        available_qty: catalogItem.total_available,
        reason: 'insufficient_inventory'
      });
      continue;
    }

    // Sort farms by allocation strategy
    let sortedFarms = [...catalogItem.farms];
    if (allocation_strategy === 'closest') {
      sortedFarms.sort((a, b) => (a.distance_miles || 999) - (b.distance_miles || 999));
    } else if (allocation_strategy === 'cheapest') {
      sortedFarms.sort((a, b) => a.price_per_unit - b.price_per_unit);
    } else if (allocation_strategy === 'earliest') {
      sortedFarms.sort((a, b) => new Date(a.harvest_date_start) - new Date(b.harvest_date_start));
    }

    // Allocate quantity across farms
    let remainingQty = qty;

    for (const farmAvailability of sortedFarms) {
      if (remainingQty <= 0) break;

      const allocateQty = Math.min(remainingQty, farmAvailability.qty_available);
      
      if (allocateQty === 0) continue;

      // Get or create FarmSubOrder for this farm
      if (!allocations.has(farmAvailability.farm_id)) {
        allocations.set(farmAvailability.farm_id, {
          farm_id: farmAvailability.farm_id,
          farm_name: farmAvailability.farm_name,
          region: farmAvailability.region,
          line_items: [],
          subtotal: 0,
          broker_fee_amount: 0,
          tax_amount: 0,
          total: 0,
          reservations: [] // For tracking reservation IDs
        });
      }

      const subOrder = allocations.get(farmAvailability.farm_id);

      // Calculate line total
      const line_total = allocateQty * farmAvailability.price_per_unit;

      // Add line item
      subOrder.line_items.push({
        sku_id,
        sku_name: catalogItem.sku_name,
        lot_id: farmAvailability.lot_id,
        qty: allocateQty,
        unit: catalogItem.unit,
        unit_price: farmAvailability.price_per_unit,
        line_total,
        traceability: {
          harvest_date_start: farmAvailability.harvest_date_start,
          harvest_date_end: farmAvailability.harvest_date_end,
          quality_flags: farmAvailability.quality_flags
        }
      });

      subOrder.subtotal += line_total;

      remainingQty -= allocateQty;

      console.log(`  Allocated ${allocateQty} x ${sku_id} to ${farmAvailability.farm_name} at $${farmAvailability.price_per_unit}/unit`);
    }

    // If we couldn't allocate all quantity, mark as partial allocation
    if (remainingQty > 0) {
      console.warn(`[Order Allocator] Partial allocation for ${sku_id}: ${remainingQty} units unallocated`);
      unallocatedItems.push({
        sku_id,
        sku_name: catalogItem.sku_name,
        requested_qty: qty,
        allocated_qty: qty - remainingQty,
        unallocated_qty: remainingQty,
        reason: 'insufficient_inventory'
      });
    }
  }

  // Calculate broker fees and totals for each sub-order
  const subOrders = Array.from(allocations.values()).map(subOrder => {
    subOrder.broker_fee_amount = Math.round(subOrder.subtotal * (broker_fee_percent / 100) * 100) / 100;
    
    // Calculate tax from farm-configured rate
    subOrder.tax_rate = tax_rate;
    subOrder.tax_label = tax_label;
    subOrder.tax_amount = Math.round(subOrder.subtotal * tax_rate * 100) / 100;
    
    subOrder.total = subOrder.subtotal + subOrder.broker_fee_amount + subOrder.tax_amount;

    return subOrder;
  });

  // Calculate master order totals
  const master_subtotal = subOrders.reduce((sum, sub) => sum + sub.subtotal, 0);
  const master_broker_fee = subOrders.reduce((sum, sub) => sum + sub.broker_fee_amount, 0);
  const master_tax = subOrders.reduce((sum, sub) => sum + sub.tax_amount, 0);
  const master_total = subOrders.reduce((sum, sub) => sum + sub.total, 0);

  const allocation_result = {
    ok: unallocatedItems.length === 0,
    allocation_strategy,
    broker_fee_percent,
    master_order: {
      subtotal: master_subtotal,
      broker_fee_total: master_broker_fee,
      tax_total: master_tax,
      total: master_total
    },
    sub_orders: subOrders,
    unallocated_items: unallocatedItems,
    summary: {
      total_farms: subOrders.length,
      total_line_items: subOrders.reduce((sum, sub) => sum + sub.line_items.length, 0),
      fully_allocated: unallocatedItems.length === 0
    }
  };

  console.log('[Order Allocator] Allocation complete:');
  console.log(`  Sub-orders: ${subOrders.length}`);
  console.log(`  Master total: $${master_total.toFixed(2)}`);
  console.log(`  Broker fee: $${master_broker_fee.toFixed(2)} (${broker_fee_percent}%)`);
  console.log(`  Unallocated items: ${unallocatedItems.length}`);

  return allocation_result;
}

/**
 * Validate cart before allocation
 * @param {Object} cart - Buyer's cart
 * @returns {Object} Validation result: {valid, errors}
 */
export function validateCart(cart) {
  const errors = [];

  if (!cart || !cart.items || !Array.isArray(cart.items)) {
    errors.push('Cart must have items array');
  } else {
    if (cart.items.length === 0) {
      errors.push('Cart cannot be empty');
    }

    for (let i = 0; i < cart.items.length; i++) {
      const item = cart.items[i];
      if (!item.sku_id) {
        errors.push(`Item ${i}: missing sku_id`);
      }
      if (!item.qty || item.qty <= 0) {
        errors.push(`Item ${i}: qty must be greater than zero`);
      }
    }
  }

  if (!cart.delivery) {
    errors.push('Cart must have delivery details');
  } else {
    if (!cart.delivery.address) {
      errors.push('Delivery address is required');
    }
    if (!cart.delivery.delivery_date) {
      errors.push('Delivery date is required');
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Calculate distance between two zip codes
 * TODO: Implement actual geocoding and distance calculation
 * @param {string} zip1 - First zip code
 * @param {string} zip2 - Second zip code
 * @returns {number} Distance in miles (approximated)
 */
export function calculateDistance(zip1, zip2) {
  // Mock implementation - in production, use geocoding service
  if (zip1 === zip2) return 0;
  
  // Crude approximation based on first 3 digits of zip
  const region1 = parseInt(zip1.substring(0, 3));
  const region2 = parseInt(zip2.substring(0, 3));
  
  return Math.abs(region1 - region2) * 10; // ~10 miles per zip region difference
}

export default {
  allocateOrder,
  validateCart,
  calculateDistance
};
