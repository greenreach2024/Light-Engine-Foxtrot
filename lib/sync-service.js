/**
 * Sync Service
 * 
 * Handles synchronization between edge device and GreenReach Central API:
 * - Heartbeat monitoring (every 30 seconds)
 * - Inventory sync (every 5 minutes)
 * - Offline queue management
 * - Connection status tracking
 */

import os from 'os';
import axios from 'axios';
import edgeConfig from './edge-config.js';
import syncQueue from './sync-queue.js';

class SyncService {
  constructor(db) {
    this.db = db;
    this.heartbeatTimer = null;
    this.syncTimer = null;
    this.running = false;
    this.lastHeartbeat = null;
    this.lastSync = null;
    this.connectionStatus = 'disconnected';
  }

  /**
   * Start sync service
   */
  start() {
    if (this.running) {
      console.log('Sync service already running');
      return;
    }

    if (!edgeConfig.isEdgeMode()) {
      console.log('Not in edge mode, sync service disabled');
      return;
    }

    if (!edgeConfig.isRegistered()) {
      console.warn('⚠ Farm not registered, sync service disabled');
      return;
    }

    this.running = true;
    console.log('✓ Starting sync service');

    // Start heartbeat
    this.startHeartbeat();

    // Start inventory sync
    this.startInventorySync();

    // Process queued items
    this.processQueue();
  }

  /**
   * Stop sync service
   */
  stop() {
    this.running = false;
    
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }

    console.log('✓ Sync service stopped');
  }

  /**
   * Start heartbeat monitoring
   */
  startHeartbeat() {
    const interval = edgeConfig.getHeartbeatInterval();
    
    // Send initial heartbeat
    this.sendHeartbeat();

    // Setup recurring heartbeat
    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat();
    }, interval);

    console.log(`✓ Heartbeat monitoring started (${interval / 1000}s interval)`);
  }

  /**
   * Send heartbeat to central server
   */
  async sendHeartbeat() {
    try {
      const farmId = edgeConfig.getFarmId();
      const apiKey = edgeConfig.getApiKey();
      const centralUrl = edgeConfig.getCentralApiUrl();

      // Get system stats
      const stats = await this.getSystemStats();

      const response = await axios.post(
        `${centralUrl}/api/farms/${farmId}/heartbeat`,
        {
          cpu_usage: stats.cpu,
          memory_usage: stats.memory,
          disk_usage: stats.disk,
          metadata: {
            uptime: process.uptime(),
            sensors_online: stats.sensors || 0,
            lights_online: stats.lights || 0
          }
        },
        {
          headers: {
            'X-API-Key': apiKey,
            'Content-Type': 'application/json'
          },
          timeout: 10000
        }
      );

      this.lastHeartbeat = new Date();
      this.connectionStatus = 'connected';
      edgeConfig.setOfflineMode(false);

      console.log(`✓ Heartbeat sent successfully`);
    } catch (error) {
      console.error('✗ Heartbeat failed:', error.message);
      this.connectionStatus = 'disconnected';
      edgeConfig.setOfflineMode(true);
    }
  }

  /**
   * Get system statistics
   */
  async getSystemStats() {
    // CPU usage (simplified)
    const cpus = os.cpus();
    let totalIdle = 0, totalTick = 0;
    cpus.forEach(cpu => {
      for (let type in cpu.times) {
        totalTick += cpu.times[type];
      }
      totalIdle += cpu.times.idle;
    });
    const cpu = 100 - (100 * totalIdle / totalTick);

    // Memory usage
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const memory = ((totalMem - freeMem) / totalMem) * 100;

    // Disk usage (would need more sophisticated check in production)
    const disk = 50; // Placeholder

    return {
      cpu: parseFloat(cpu.toFixed(2)),
      memory: parseFloat(memory.toFixed(2)),
      disk,
      sensors: 0, // TODO: Get from database
      lights: 0   // TODO: Get from database
    };
  }

  /**
   * Start inventory sync
   */
  startInventorySync() {
    const interval = edgeConfig.getSyncInterval();
    
    // Send initial sync
    this.syncInventory();

    // Setup recurring sync
    this.syncTimer = setInterval(() => {
      this.syncInventory();
    }, interval);

    console.log(`✓ Inventory sync started (${interval / 1000 / 60}min interval)`);
  }

  /**
   * Sync inventory to central server
   */
  async syncInventory() {
    if (!edgeConfig.isSyncEnabled()) {
      console.log('Sync disabled, skipping');
      return;
    }

    try {
      const farmId = edgeConfig.getFarmId();
      const apiKey = edgeConfig.getApiKey();
      const centralUrl = edgeConfig.getCentralApiUrl();

      // Get all products from local database
      const products = await this.getLocalInventory();

      if (products.length === 0) {
        console.log('No inventory to sync');
        return;
      }

      const response = await axios.post(
        `${centralUrl}/api/inventory/${farmId}/sync`,
        { products },
        {
          headers: {
            'X-API-Key': apiKey,
            'Content-Type': 'application/json'
          },
          timeout: 30000
        }
      );

      this.lastSync = new Date();
      console.log(`✓ Synced ${products.length} products to central server`);
    } catch (error) {
      console.error('✗ Inventory sync failed:', error.message);
      
      // Queue for later if offline
      if (edgeConfig.isOfflineMode()) {
        const products = await this.getLocalInventory();
        syncQueue.enqueue('inventory_sync', { products });
      }
    }
  }

  /**
   * Get local inventory from database
   */
  async getLocalInventory() {
    return new Promise((resolve, reject) => {
      this.db.all(
        `SELECT 
          crop_id as product_id,
          crop_name as product_name,
          COALESCE(sku, '') as sku,
          COALESCE(stock_quantity, 0) as quantity,
          COALESCE(unit, 'unit') as unit,
          COALESCE(current_price, 0) as price,
          1 as available_for_wholesale
         FROM crops 
         WHERE is_deleted = 0`,
        [],
        (err, rows) => {
          if (err) {
            reject(err);
          } else {
            resolve(rows || []);
          }
        }
      );
    });
  }

  /**
   * Process queued sync operations
   */
  async processQueue() {
    if (!this.running || edgeConfig.isOfflineMode()) {
      return;
    }

    try {
      const processed = await syncQueue.processQueue();
      if (processed > 0) {
        console.log(`✓ Processed ${processed} queued operations`);
      }
    } catch (error) {
      console.error('Error processing queue:', error);
    }

    // Schedule next queue processing
    setTimeout(() => {
      if (this.running) {
        this.processQueue();
      }
    }, 60000); // Check queue every minute
  }

  /**
   * Get connection status
   */
  getStatus() {
    return {
      running: this.running,
      connectionStatus: this.connectionStatus,
      offlineMode: edgeConfig.isOfflineMode(),
      lastHeartbeat: this.lastHeartbeat,
      lastSync: this.lastSync,
      queueSize: syncQueue.getSize()
    };
  }

  /**
   * Manual sync trigger
   */
  async manualSync() {
    console.log('Manual sync triggered');
    await this.sendHeartbeat();
    await this.syncInventory();
  }
}

export default SyncService;
