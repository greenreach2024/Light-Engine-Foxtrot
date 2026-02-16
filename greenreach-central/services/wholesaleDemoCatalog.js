/**
 * Wholesale Demo Catalog Service
 * Provides demo catalog data for wholesale operations
 */

export async function loadWholesaleDemoCatalog() {
  // Return empty catalog for now
  return {
    skus: [],
    farms: []
  };
}

export async function allocateCartFromDemo(cartOrInput, sourcing) {
  const input = Array.isArray(cartOrInput)
    ? { cart: cartOrInput, sourcing }
    : (cartOrInput || {});
  const cart = Array.isArray(input.cart) ? input.cart : [];
  const commissionRate = Number(input.commissionRate ?? 0.12);

  // Demo path currently has no live allocation engine; return normalized empty result
  // matching checkout route expectations.
  const subtotal = 0;
  const brokerFeeTotal = Number((subtotal * commissionRate).toFixed(2));
  const netToFarmsTotal = Number((subtotal - brokerFeeTotal).toFixed(2));

  return {
    allocation: {
      subtotal,
      broker_fee_total: brokerFeeTotal,
      net_to_farms_total: netToFarmsTotal,
      grand_total: subtotal,
      farm_sub_orders: [],
      unavailable_items: cart
    },
    payment_split: [],
    allocations: [],
    unavailable: cart
  };
}
