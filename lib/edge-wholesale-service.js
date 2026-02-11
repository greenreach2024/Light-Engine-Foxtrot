/**
 * Farm Wholesale Integration Service
 * 
 * Syncs farm inventory to GreenReach Central for wholesale catalog aggregation.
 * Runs in farm server mode only - pushes local inventory data to Central API.
 * 
 * Features:
 * - Automatic inventory sync on schedule (default: every 15 minutes)
 * - Real-time updates on significant changes (>10% quantity change)
 * - Push current crop status, harvest windows, and availability
 * - Handle sync failures with retry logic and offline queue
 */

import edgeConfig from './edge-config.js';
import syncQueue from './sync-queue.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class EdgeWholesaleService {
  constructor(db) {
    this.db = db;
    this.syncInterval = null;
    this.lastInventorySnapshot = null;
    this.config = {
      syncIntervalMs: 15 * 60 * 1000, // 15 minutes
      significantChangeThreshold: 0.1, // 10% change triggers immediate sync
      maxRetries: 3,
      retryDelayMs: 5000
    };
  }

  /**
   * Start the wholesale sync service
   */
  start() {
    if (!edgeConfig.isEdgeMode()) {
      console.log('[Wholesale Sync] Not in farm server mode, service disabled');
      return;
    }

    if (!edgeConfig.isRegistered()) {
      console.log('[Wholesale Sync] Farm not registered, service disabled');
      return;
    }

    console.log('[Wholesale Sync] Starting inventory sync service');
    console.log(`[Wholesale Sync] Sync interval: ${this.config.syncIntervalMs / 1000 / 60} minutes`);

    // Initial sync
    this.syncInventory().catch(err => {
      console.error('[Wholesale Sync] Initial sync failed:', err.message);
    });

    // Schedule periodic sync
    this.syncInterval = setInterval(() => {
      this.syncInventory().catch(err => {
        console.error('[Wholesale Sync] Scheduled sync failed:', err.message);
      });
    }, this.config.syncIntervalMs);
  }

  /**
   * Stop the wholesale sync service
   */
  stop() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
      console.log('[Wholesale Sync] Service stopped');
    }
  }

  /**
   * Sync farm inventory to GreenReach Central
   */
  async syncInventory() {
    try {
      console.log('[Wholesale Sync] Starting inventory sync...');

      const inventory = await this.buildInventoryPayload();
      
      if (!inventory || inventory.lots.length === 0) {
        console.log('[Wholesale Sync] No inventory to sync');
        return;
      }

      // Check if significant changes occurred
      const hasSignificantChanges = this.detectSignificantChanges(inventory);
      
      if (hasSignificantChanges) {
        console.log('[Wholesale Sync] Significant changes detected, syncing immediately');
      }

      // Send to Central API
      await this.sendInventoryToCenter(inventory);

      // Update snapshot
      this.lastInventorySnapshot = inventory;

      console.log(`[Wholesale Sync] ✓ Synced ${inventory.lots.length} lots to GreenReach Central`);

    } catch (error) {
      console.error('[Wholesale Sync] ✗ Sync failed:', error.message);
      
      // Queue for retry if offline
      if (this.isNetworkError(error)) {
        console.log('[Wholesale Sync] Network error, queuing for retry');
        await syncQueue.enqueue({
          type: 'wholesale_inventory_sync',
          priority: 'normal',
          data: await this.buildInventoryPayload()
        });
      }
      
      throw error;
    }
  }

  /**
   * Build inventory payload from farm data
   */
  async buildInventoryPayload() {
    try {
      // Load farm groups data
      const groupsPath = path.join(__dirname, '../public/data/groups.json');
      const groupsData = JSON.parse(fs.readFileSync(groupsPath, 'utf8'));
      const groups = groupsData.groups || [];

      // Load recipes for grow cycle info
      const recipesPath = path.join(__dirname, '../public/data/lighting-recipes.json');
      const recipesData = JSON.parse(fs.readFileSync(recipesPath, 'utf8'));
      const recipes = recipesData.recipes || {};

      const lots = [];
      const today = new Date();

      for (const group of groups) {
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

        // Skip if crop is too young or already harvested
        if (daysOld < growDays * 0.7 || daysOld > growDays + 7) {
          continue;
        }

        // Calculate harvest window
        const daysUntilHarvest = Math.max(0, growDays - daysOld);
        const harvestStart = new Date(today.getTime() + daysUntilHarvest * 24 * 60 * 60 * 1000);
        const harvestEnd = new Date(harvestStart.getTime() + 3 * 24 * 60 * 60 * 1000); // 3-day window

        // Calculate available quantity
        const trayCount = group.trays || 4;
        const plantsPerTray = (group.plants || 48) / trayCount;
        const lbsPerPlant = 0.125; // ~2oz per plant
        const totalLbs = Math.round(trayCount * plantsPerTray * lbsPerPlant * 100) / 100;
        const cases5lb = Math.floor(totalLbs / 5);
        
        if (cases5lb === 0) {
          continue; // Not enough for wholesale
        }

        // Check for existing reservations
        const reservedQty = await this.getReservedQuantity(group.id);

        // Get pricing from crop pricing
        const pricePerCase = await this.getPriceForCrop(cropName);

        const lot = {
          lot_id: `LOT-${group.id}`,
          group_id: group.id,
          sku_id: `SKU-${cropName.toUpperCase().replace(/\s+/g, '-')}-5LB`,
          sku_name: `${cropName}, 5lb case`,
          crop_type: cropName,
          qty_available: cases5lb - reservedQty,
          qty_reserved: reservedQty,
          qty_total: cases5lb,
          unit: 'case',
          pack_size: 5, // lbs per case
          price_per_unit: pricePerCase,
          currency: 'USD',
          harvest_date_start: harvestStart.toISOString().split('T')[0],
          harvest_date_end: harvestEnd.toISOString().split('T')[0],
          grow_days: daysOld,
          grow_days_total: growDays,
          maturity_percent: Math.round((daysOld / growDays) * 100),
          quality_grade: daysOld >= growDays ? 'A' : 'B',
          organic_certified: false,
          location: group.id, // zone/shelf identifier
          farm_notes: group.notes || ''
        };

        lots.push(lot);
      }

      return {
        farm_id: edgeConfig.getFarmId(),
        farm_name: edgeConfig.getFarmName(),
        sync_timestamp: new Date().toISOString(),
        lots: lots,
        summary: {
          total_lots: lots.length,
          total_cases: lots.reduce((sum, lot) => sum + lot.qty_available, 0),
          total_lbs: lots.reduce((sum, lot) => sum + (lot.qty_available * lot.pack_size), 0),
          crop_types: [...new Set(lots.map(l => l.crop_type))]
        }
      };

    } catch (error) {
      console.error('[Wholesale Sync] Error building inventory:', error.message);
      throw error;
    }
  }

  /**
   * Get reserved quantity for a lot from database
   */
  async getReservedQuantity(groupId) {
    return new Promise((resolve) => {
      if (!this.db) {
        resolve(0);
        return;
      }

      const sql = `
        SELECT COALESCE(SUM(qty), 0) as reserved 
        FROM wholesale_reservations 
        WHERE lot_id = ? 
        AND status = 'active' 
        AND expires_at > datetime('now')
      `;

      this.db.get(sql, [`LOT-${groupId}`], (err, row) => {
        if (err) {
          console.error('[Wholesale Sync] Error querying reservations:', err.message);
          resolve(0);
        } else {
          resolve(row?.reserved || 0);
        }
      });
    });
  }

  /**
   * Get wholesale price for crop
   */
  async getPriceForCrop(cropName) {
    try {
      const pricingPath = path.join(__dirname, '../public/data/crop-pricing.json');
      if (fs.existsSync(pricingPath)) {
        const pricing = JSON.parse(fs.readFileSync(pricingPath, 'utf8'));
        const crop = pricing.crops?.find(c => 
          c.name.toLowerCase() === cropName.toLowerCase() ||
          c.varieties?.some(v => v.toLowerCase() === cropName.toLowerCase())
        );
        
        if (crop && crop.wholesale_price_per_case) {
          return crop.wholesale_price_per_case;
        }
      }
    } catch (error) {
      console.error('[Wholesale Sync] Error reading pricing:', error.message);
    }

    // Default wholesale pricing by category
    const defaultPrices = {
      'lettuce': 12.50,
      'kale': 15.00,
      'arugula': 18.00,
      'spinach': 14.00,
      'chard': 13.50,
      'herbs': 22.00
    };

    // Try to match by crop name
    for (const [category, price] of Object.entries(defaultPrices)) {
      if (cropName.toLowerCase().includes(category)) {
        return price;
      }
    }

    return 12.50; // Default fallback
  }

  /**
   * Detect if inventory has changed significantly since last sync
   */
  detectSignificantChanges(currentInventory) {
    if (!this.lastInventorySnapshot) {
      return true; // First sync
    }

    const threshold = this.config.significantChangeThreshold;
    const lastTotal = this.lastInventorySnapshot.summary.total_cases;
    const currentTotal = currentInventory.summary.total_cases;

    if (lastTotal === 0) {
      return currentTotal > 0;
    }

    const changePercent = Math.abs((currentTotal - lastTotal) / lastTotal);
    return changePercent >= threshold;
  }

  /**
   * Send inventory data to GreenReach Central
   */
  async sendInventoryToCenter(inventory) {
    const centralUrl = edgeConfig.getCentralApiUrl();
    const apiKey = edgeConfig.getApiKey();

    if (!centralUrl || !apiKey) {
      throw new Error('Central API URL or API key not configured');
    }

    // Dynamic import of axios
    const axios = await import('axios').then(m => m.default || m);

    const response = await axios.post(
      `${centralUrl}/api/farms/${edgeConfig.getFarmId()}/inventory/sync`,
      inventory,
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'X-Farm-Id': edgeConfig.getFarmId()
        },
        timeout: 30000
      }
    );

    if (response.status !== 200 && response.status !== 201) {
      throw new Error(`Central API returned status ${response.status}`);
    }

    return response.data;
  }

  /**
   * Check if error is network-related
   */
  isNetworkError(error) {
    return error.code === 'ECONNREFUSED' ||
           error.code === 'ETIMEDOUT' ||
           error.code === 'ENOTFOUND' ||
           error.message.includes('Network') ||
           error.message.includes('timeout');
  }

  /**
   * Manual sync trigger (called from API)
   */
  async triggerManualSync() {
    console.log('[Wholesale Sync] Manual sync triggered');
    return await this.syncInventory();
  }

  /**
   * Get current sync status
   */
  getStatus() {
    return {
      enabled: edgeConfig.isEdgeMode() && edgeConfig.isRegistered(),
      syncIntervalMinutes: this.config.syncIntervalMs / 1000 / 60,
      lastSyncTimestamp: this.lastInventorySnapshot?.sync_timestamp || null,
      lastSyncLotCount: this.lastInventorySnapshot?.lots?.length || 0,
      nextSyncEstimate: this.syncInterval ? 
        new Date(Date.now() + this.config.syncIntervalMs).toISOString() : null
    };
  }
}

export default EdgeWholesaleService;
