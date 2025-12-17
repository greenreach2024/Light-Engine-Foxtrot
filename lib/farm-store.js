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
 * Load crops from lighting-recipes.json
 */
async function loadRecipeCrops() {
  try {
    const fs = await import('fs');
    const path = await import('path');
    const { fileURLToPath } = await import('url');
    
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const recipesPath = path.join(__dirname, '../public/data/lighting-recipes.json');
    
    const data = fs.readFileSync(recipesPath, 'utf8');
    const recipes = JSON.parse(data);
    
    return Object.keys(recipes.crops || {});
  } catch (error) {
    console.error('[farm-store] Failed to load lighting-recipes.json:', error);
    return ['Bibb Butterhead', 'Mei Qing Pak Choi', 'Tatsoi']; // Fallback
  }
}

/**
 * Initialize demo data for each farm
 * Uses crops from lighting-recipes.json with tray-based inventory
 */
export async function initializeFarmDemoData(farmId) {
  console.log(`[farm-store] Initializing demo data for farm ${farmId}`);

  // Load actual crops from recipes
  const cropNames = await loadRecipeCrops();
  
  // Demo inventory - using tray-based units matching inventory system
  const demoProducts = cropNames.slice(0, 10).map((cropName, index) => {
    const sku = cropName.toUpperCase().replace(/[^A-Z0-9]/g, '-').substring(0, 15);
    
    // Pricing based on typical crop categories
    const isLeafy = cropName.toLowerCase().includes('lettuce') || 
                    cropName.toLowerCase().includes('kale') ||
                    cropName.toLowerCase().includes('chard');
    
    return {
      sku_id: `${sku}-${String(index + 1).padStart(3, '0')}`,
      name: cropName,
      category: isLeafy ? 'leafy_greens' : 'microgreens',
      unit: 'tray',
      quantity: Math.floor(Math.random() * 30) + 10,
      unit_price: isLeafy ? 5.00 : 4.00,
      retail_price: isLeafy ? 8.00 : 6.50,
      recipe_id: cropName
    };
  });

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
// DEMO_FARMS.forEach(farmId => initializeFarmDemoData(farmId)); // Disabled - use TEST-FARM-001 instead

export default farmStores;
