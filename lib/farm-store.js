/**
 * Multi-Tenant Data Store
 * Farm-scoped in-memory storage with automatic filtering by farm_id
 * All data keys are namespaced: {farm_id}:{entity_id}
 */

export class FarmScopedStore {
  constructor(entityName) {
    this.entityName = entityName;
    this.store = new Map();
    this.sequences = new Map(); // Per-farm ID sequences
  }

  /**
   * Generate farm-scoped entity ID
   */
  generateId(farmId, prefix, length = 6) {
    const key = `${farmId}:sequence`;
    const current = this.sequences.get(key) || 1000;
    const newId = current + 1;
    this.sequences.set(key, newId);
    return `${prefix}-${String(newId).padStart(length, '0')}`;
  }

  /**
   * Create farm-scoped key
   */
  _key(farmId, entityId) {
    return `${farmId}:${entityId}`;
  }

  /**
   * Set entity for specific farm
   */
  set(farmId, entityId, data) {
    const key = this._key(farmId, entityId);
    const entity = {
      ...data,
      farm_id: farmId,
      _stored_at: new Date().toISOString()
    };
    this.store.set(key, entity);
    return entity;
  }

  /**
   * Get entity for specific farm
   */
  get(farmId, entityId) {
    const key = this._key(farmId, entityId);
    return this.store.get(key);
  }

  /**
   * Check if entity exists for farm
   */
  has(farmId, entityId) {
    const key = this._key(farmId, entityId);
    return this.store.has(key);
  }

  /**
   * Delete entity for farm
   */
  delete(farmId, entityId) {
    const key = this._key(farmId, entityId);
    return this.store.delete(key);
  }

  /**
   * Get all entities for specific farm
   */
  getAllForFarm(farmId) {
    const prefix = `${farmId}:`;
    const results = [];
    
    for (const [key, value] of this.store.entries()) {
      if (key.startsWith(prefix)) {
        results.push(value);
      }
    }
    
    return results;
  }

  /**
   * Count entities for farm
   */
  countForFarm(farmId) {
    return this.getAllForFarm(farmId).length;
  }

  /**
   * Clear all entities for farm (for testing)
   */
  clearFarm(farmId) {
    const prefix = `${farmId}:`;
    const keysToDelete = [];
    
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        keysToDelete.push(key);
      }
    }
    
    keysToDelete.forEach(key => this.store.delete(key));
    return keysToDelete.length;
  }

  /**
   * Get total size across all farms
   */
  size() {
    return this.store.size;
  }

  /**
   * Get statistics
   */
  getStats() {
    const farms = new Set();
    for (const key of this.store.keys()) {
      const farmId = key.split(':')[0];
      farms.add(farmId);
    }

    const stats = {
      total_entities: this.store.size,
      total_farms: farms.size,
      by_farm: {}
    };

    farms.forEach(farmId => {
      stats.by_farm[farmId] = this.countForFarm(farmId);
    });

    return stats;
  }
}

/**
 * Initialize farm-scoped stores for all entities
 */
export const farmStores = {
  inventory: new FarmScopedStore('inventory'),
  orders: new FarmScopedStore('orders'),
  payments: new FarmScopedStore('payments'),
  deliveries: new FarmScopedStore('deliveries'),
  subscriptions: new FarmScopedStore('subscriptions'),
  donations: new FarmScopedStore('donations'),
  programs: new FarmScopedStore('programs'),
  customers: new FarmScopedStore('customers'),
  lotTracking: new FarmScopedStore('lotTracking')
};

/**
 * Initialize demo data for each farm
 */
export function initializeFarmDemoData(farmId) {
  console.log(`[farm-store] Initializing demo data for farm ${farmId}`);

  // Demo inventory
  const demoProducts = [
    { sku_id: 'LG-001', name: 'Baby Leaf Lettuce Mix', category: 'leafy_greens', unit: 'lb', quantity: 150, unit_price: 4.50, retail_price: 6.00 },
    { sku_id: 'LG-002', name: 'Arugula', category: 'leafy_greens', unit: 'lb', quantity: 80, unit_price: 5.00, retail_price: 7.00 },
    { sku_id: 'LG-003', name: 'Baby Kale', category: 'leafy_greens', unit: 'lb', quantity: 120, unit_price: 4.75, retail_price: 6.50 },
    { sku_id: 'HB-001', name: 'Basil (Sweet)', category: 'herbs', unit: 'oz', quantity: 200, unit_price: 1.50, retail_price: 2.50 },
    { sku_id: 'HB-002', name: 'Cilantro', category: 'herbs', unit: 'oz', quantity: 180, unit_price: 1.25, retail_price: 2.00 },
    { sku_id: 'HB-003', name: 'Mint', category: 'herbs', unit: 'oz', quantity: 160, unit_price: 1.50, retail_price: 2.50 },
    { sku_id: 'MG-001', name: 'Microgreens - Radish', category: 'microgreens', unit: 'oz', quantity: 100, unit_price: 2.00, retail_price: 3.50 },
    { sku_id: 'MG-002', name: 'Microgreens - Sunflower', category: 'microgreens', unit: 'oz', quantity: 90, unit_price: 1.75, retail_price: 3.00 },
    { sku_id: 'PR-001', name: 'Cherry Tomatoes', category: 'produce', unit: 'lb', quantity: 60, unit_price: 3.50, retail_price: 5.00 },
    { sku_id: 'PR-002', name: 'Cucumber', category: 'produce', unit: 'ea', quantity: 45, unit_price: 1.25, retail_price: 2.00 }
  ];

  demoProducts.forEach(product => {
    farmStores.inventory.set(farmId, product.sku_id, {
      ...product,
      reserved: 0,
      available: product.quantity,
      lot_code: null, // Will be assigned when lot is created
      updated_at: new Date().toISOString()
    });
  });

  // Demo food security programs (shared across farms for now, but farm-scoped)
  const demoPrograms = [
    {
      program_id: 'PROG-001',
      name: 'Community Food Bank Partnership',
      type: 'food_bank',
      status: 'active',
      subsidy_percent: 100,
      max_weekly_amount: 500,
      eligible_items: 'all',
      grant: {
        source: 'USDA Emergency Food Assistance Program',
        grant_id: 'TEFAP-2025',
        start_date: '2025-01-01',
        end_date: '2025-12-31',
        total_budget: 25000,
        spent_to_date: 0
      }
    },
    {
      program_id: 'PROG-002',
      name: 'SNAP Match Program',
      type: 'snap_match',
      status: 'active',
      subsidy_percent: 50,
      max_weekly_amount: 50,
      eligible_items: 'fresh_produce',
      grant: {
        source: 'State SNAP Incentive Program',
        grant_id: 'SNAP-MATCH-2025',
        start_date: '2025-01-01',
        end_date: '2025-12-31',
        total_budget: 15000,
        spent_to_date: 0
      }
    }
  ];

  demoPrograms.forEach(program => {
    farmStores.programs.set(farmId, program.program_id, {
      ...program,
      created_at: new Date().toISOString()
    });
  });

  console.log(`[farm-store] Initialized ${demoProducts.length} products and ${demoPrograms.length} programs for farm ${farmId}`);
}

// Auto-initialize demo farms
const DEMO_FARMS = ['FARM-001', 'FARM-002', 'FARM-003'];
DEMO_FARMS.forEach(farmId => initializeFarmDemoData(farmId));

export default farmStores;
