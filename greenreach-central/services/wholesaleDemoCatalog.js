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

export async function allocateCartFromDemo(cart, sourcing) {
  // Return empty allocation
  return {
    allocations: [],
    unavailable: cart
  };
}
