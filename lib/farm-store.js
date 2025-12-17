/**
 * Multi-Tenant Data Store
 * Farm-scoped in-memory storage with automatic filtering by farm_id
 * All data keys are namespaced: {farm_id}:{entity_id}
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.resolve(__dirname, '../public');
const GROUPS_FILE = path.join(PUBLIC_DIR, 'data', 'groups.json');
const RECIPES_FILE = path.join(PUBLIC_DIR, 'data', 'lighting-recipes.json');
const FARM_FILE = path.join(PUBLIC_DIR, 'data', 'farm.json');

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
    { sku_id: 'LG-001', name: 'Baby Leaf Lettuce Mix', category: 'leafy_greens', unit: 'lb', quantity: 150, unit_price: 4.50, retail_price: 6.00, is_taxable: false },
    { sku_id: 'LG-002', name: 'Arugula', category: 'leafy_greens', unit: 'lb', quantity: 80, unit_price: 5.00, retail_price: 7.00, is_taxable: false },
    { sku_id: 'LG-003', name: 'Baby Kale', category: 'leafy_greens', unit: 'lb', quantity: 120, unit_price: 4.75, retail_price: 6.50, is_taxable: false },
    { sku_id: 'HB-001', name: 'Basil (Sweet)', category: 'herbs', unit: 'oz', quantity: 200, unit_price: 1.50, retail_price: 2.50, is_taxable: false },
    { sku_id: 'HB-002', name: 'Cilantro', category: 'herbs', unit: 'oz', quantity: 180, unit_price: 1.25, retail_price: 2.00, is_taxable: false },
    { sku_id: 'HB-003', name: 'Mint', category: 'herbs', unit: 'oz', quantity: 160, unit_price: 1.50, retail_price: 2.50, is_taxable: false },
    { sku_id: 'MG-001', name: 'Microgreens - Radish', category: 'microgreens', unit: 'oz', quantity: 100, unit_price: 2.00, retail_price: 3.50, is_taxable: false },
    { sku_id: 'MG-002', name: 'Microgreens - Sunflower', category: 'microgreens', unit: 'oz', quantity: 90, unit_price: 1.75, retail_price: 3.00, is_taxable: false },
    { sku_id: 'PR-001', name: 'Cherry Tomatoes', category: 'produce', unit: 'lb', quantity: 60, unit_price: 3.50, retail_price: 5.00, is_taxable: false },
    { sku_id: 'PR-002', name: 'Cucumber', category: 'produce', unit: 'ea', quantity: 45, unit_price: 1.25, retail_price: 2.00, is_taxable: false }
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

/**
 * Load REAL crop data from groups.json for the current farm
 */
export function loadRealCropInventory(farmId) {
  try {
    console.log(`[farm-store] Loading real crop inventory for farm ${farmId} from groups.json`);
    
    // Load groups data
    const groupsData = JSON.parse(fs.readFileSync(GROUPS_FILE, 'utf8'));
    const groups = groupsData.groups || [];
    
    // Load recipes for grow cycle info
    const recipesData = JSON.parse(fs.readFileSync(RECIPES_FILE, 'utf8'));
    const recipes = recipesData.recipes || {};
    
    // Load crop pricing configuration
    const PRICING_FILE = path.join(PUBLIC_DIR, 'data', 'crop-pricing.json');
    let pricingMap = {};
    try {
      const pricingData = JSON.parse(fs.readFileSync(PRICING_FILE, 'utf8'));
      pricingData.crops.forEach(crop => {
        pricingMap[crop.crop] = {
          unit: crop.unit || 'lb',
          retailPrice: crop.retailPrice,
          wholesalePrice: crop.wholesalePrice,
          isTaxable: crop.isTaxable || false
        };
      });
      console.log(`[farm-store] Loaded pricing for ${Object.keys(pricingMap).length} crops`);
    } catch (error) {
      console.warn(`[farm-store] Could not load crop pricing, using defaults:`, error.message);
    }
    
    const today = new Date();
    let productsLoaded = 0;
    
    groups.forEach((group) => {
      const cropName = group.crop || group.recipe;
      const recipe = recipes[cropName];
      
      // Get grow days from recipe
      let growDays = 35;
      if (recipe && recipe.day_by_day && Array.isArray(recipe.day_by_day)) {
        growDays = recipe.day_by_day.length;
      }
      
      // Calculate days since seed
      let daysOld = 0;
      if (group.planConfig?.anchor?.seedDate) {
        const seedDate = new Date(group.planConfig.anchor.seedDate);
        daysOld = Math.floor((today - seedDate) / (1000 * 60 * 60 * 24));
      }
      
      // Calculate harvest readiness
      const daysUntilHarvest = Math.max(0, growDays - daysOld);
      const isHarvestReady = daysUntilHarvest <= 2; // Ready within 2 days
      
      // Calculate available quantity (conservative estimate for retail)
      const trayCount = group.trays || 4;
      const plantsPerTray = (group.plants || 48) / trayCount;
      const lbsPerPlant = 0.125; // ~2oz per plant average
      const totalLbs = Math.round(trayCount * plantsPerTray * lbsPerPlant * 10) / 10; // Round to 0.1 lb
      
      // Get pricing from configuration, fallback to defaults
      const pricing = pricingMap[cropName] || {
        unit: 'lb',
        retailPrice: 6.00,
        wholesalePrice: 4.20,
        isTaxable: false
      };
      const unit = pricing.unit;
      const retailPrice = pricing.retailPrice;
      const wholesalePrice = pricing.wholesalePrice;
      const isTaxable = pricing.isTaxable;
      
      // Create SKU ID from crop name
      const skuId = `${cropName.toUpperCase().replace(/\s+/g, '-').substring(0, 20)}-${group.id.split('-').pop()}`;
      
      // Only add if harvest ready or within 3 days
      const available = isHarvestReady ? totalLbs : 0;
      
      farmStores.inventory.set(farmId, skuId, {
        sku_id: skuId,
        name: cropName,
        category: 'leafy_greens',
        unit: unit,
        quantity: totalLbs,
        available: available,
        reserved: 0,
        unit_price: wholesalePrice,
        retail_price: retailPrice,
        is_taxable: isTaxable,
        lot_code: group.id,
        harvest_date: daysUntilHarvest === 0 ? today.toISOString() : 
                      new Date(today.getTime() + daysUntilHarvest * 24 * 60 * 60 * 1000).toISOString(),
        days_to_harvest: daysUntilHarvest,
        location: group.zone || group.roomId || 'Unknown',
        updated_at: new Date().toISOString()
      });
      
      productsLoaded++;
    });
    
    console.log(`[farm-store] Loaded ${productsLoaded} real crop products for farm ${farmId}`);
    return productsLoaded;
    
  } catch (error) {
    console.error(`[farm-store] Failed to load real crop inventory:`, error);
    return 0;
  }
}

// Auto-initialize demo farms
const DEMO_FARMS = ['FARM-001', 'FARM-002', 'FARM-003'];
DEMO_FARMS.forEach(farmId => initializeFarmDemoData(farmId));

// Load current farm ID and initialize with REAL crop data
try {
  const farmData = JSON.parse(fs.readFileSync(FARM_FILE, 'utf8'));
  const currentFarmId = farmData.farmId || 'light-engine-demo';
  console.log(`[farm-store] Initializing current farm: ${currentFarmId}`);
  
  // Load real crop inventory for current farm
  loadRealCropInventory(currentFarmId);
  
  // Also initialize programs for current farm
  initializeFarmDemoData(currentFarmId);
  
} catch (error) {
  console.error('[farm-store] Failed to load current farm, using default');
  loadRealCropInventory('light-engine-demo');
  initializeFarmDemoData('light-engine-demo');
}

export default farmStores;
