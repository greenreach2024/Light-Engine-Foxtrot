/**
 * Sync Service
 * 
 * Handles synchronization between farm server and GreenReach Central API:
 * - Heartbeat monitoring (every 30 seconds)
 * - Inventory sync (every 5 minutes)
 * - Offline queue management
 * - Connection status tracking
 */

import os from 'os';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import edgeConfig from './edge-config.js';
import syncQueue from './sync-queue.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
      console.log('Not in farm server mode, sync service disabled');
      return;
    }

    if (!edgeConfig.isRegistered()) {
      console.warn('⚠ Farm not registered, sync service disabled');
      return;
    }

    this.running = true;
    console.log('✓ Starting sync service');

    // TEMPORARY FIX (2026-02-02): Prevents Central corruption overwrite
    // TODO: Remove after Central populated with real farm data
    // See: SYNC_INCIDENT_2026_02_02.md
    this.edgeConfig = edgeConfig;
    const isAuthoritative = this.edgeConfig.config?.authoritative === true;
    
    if (isAuthoritative) {
      console.log('🛡️  [sync-service] Edge is authoritative - skipping restoreFromCloud()');
    } else {
      // Restore initial data from Central if not authoritative
      this.restoreFromCloud().catch(err => {
        console.error('Failed to restore from cloud:', err.message);
      });
    }

    // Start heartbeat
    this.startHeartbeat();

    // Start inventory sync
    this.startInventorySync();

    // Start telemetry sync
    this.startTelemetrySync();

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

    if (this.telemetryTimer) {
      clearInterval(this.telemetryTimer);
      this.telemetryTimer = null;
    }

    console.log('✓ Sync service stopped');
  }

  /**
   * Register farm with Central on startup
   * Syncs farm.json metadata to Central database
   */
  async registerFarm() {
    try {
      const farmId = edgeConfig.getFarmId();
      const apiKey = edgeConfig.getApiKey();
      const centralUrl = edgeConfig.getCentralApiUrl();

      // Load farm.json
      const farmJsonPath = path.join(__dirname, '..', 'public', 'data', 'farm.json');
      let farmData = {};
      
      try {
        const farmJsonRaw = await fs.promises.readFile(farmJsonPath, 'utf8');
        farmData = JSON.parse(farmJsonRaw);
      } catch (error) {
        console.warn('[SyncService] Could not load farm.json:', error.message);
        return; // Skip registration if no farm data
      }

      // Validate required fields
      if (!farmData.farmId || !farmData.name) {
        console.warn('[SyncService] farm.json missing required fields (farmId, name)');
        return;
      }

      // Store farm name for heartbeat metadata
      this.farmName = farmData.farmName || farmData.name || null;

      // Add API URL: prefer explicit env var, then Cloud Run service URL, then local IP
      farmData.api_url = process.env.FARM_API_URL || process.env.LE_SERVICE_URL || `http://${this.getLocalIP()}:${process.env.PORT || 8091}`;

      const response = await axios.post(
        `${centralUrl}/api/sync/farm-registration`,
        { farmId, farmData },
        {
          headers: {
            'X-API-Key': apiKey,
            'X-Farm-ID': farmId,
            'Content-Type': 'application/json'
          },
          timeout: 15000
        }
      );

      console.log(`✓ Farm registration successful: ${farmData.name}`);
    } catch (error) {
      console.error('✗ Farm registration failed:', error.message);
      // Don't throw - allow farm server to continue with heartbeat
    }
  }

  /**
   * Get local IP address for API URL
   */
  getLocalIP() {
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name]) {
        // Skip internal and non-IPv4 addresses
        if (net.family === 'IPv4' && !net.internal) {
          return net.address;
        }
      }
    }
    return 'localhost';
  }

  /**
   * Start heartbeat monitoring
   */
  async startHeartbeat() {
    const interval = edgeConfig.getHeartbeatInterval();
    
    // Register farm on first start (one-time)
    await this.registerFarm();
    
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
            lights_online: stats.lights || 0,
            plan_type: 'cloud',
            farm_name: this.farmName || null,
            api_url: process.env.FARM_API_URL || process.env.LE_SERVICE_URL || `http://${this.getLocalIP()}:${process.env.PORT || 8091}`
          }
        },
        {
          headers: {
            'X-API-Key': apiKey,
            'X-Farm-Id': farmId,
            'Content-Type': 'application/json'
          },
          timeout: 10000
        }
      );

      this.lastHeartbeat = new Date();
      this.connectionStatus = 'connected';
      edgeConfig.setOfflineMode(false);

      console.log(`✓ Heartbeat sent successfully`);
      
      // Monitoring: Warn if edge is in protected mode
      if (this.edgeConfig?.config?.authoritative === true) {
        console.warn('⚠️  [sync-service] PROTECTED MODE: Farm authoritative flag active - Central data not syncing to farm server');
      }
    } catch (error) {
      console.error('✗ Heartbeat failed:', error.message);
      console.error('Full error:', error);
      console.error('Stack:', error.stack);
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
   * Start telemetry sync timer
   */
  startTelemetrySync() {
    const interval = 30 * 1000; // 30 seconds
    
    // Send initial sync
    this.syncTelemetry();

    // Setup recurring sync
    this.telemetryTimer = setInterval(() => {
      this.syncTelemetry();
    }, interval);

    console.log(`✓ Telemetry sync started (${interval / 1000}s interval)`);
  }

  /**
   * Sync environmental telemetry data
   */
  async syncTelemetry() {
    if (!edgeConfig.isSyncEnabled()) {
      console.log('[sync-service] Sync disabled, skipping telemetry sync');
      return;
    }

    try {
      const farmId = edgeConfig.getFarmId();
      const apiKey = edgeConfig.getApiKey();
      const centralUrl = edgeConfig.getCentralApiUrl();

      // Get environmental data from local API
      const envData = await this.getLocalEnvironmentalData();

      if (!envData || !envData.zones || envData.zones.length === 0) {
        console.log('[sync-service] No environmental data to sync');
        return;
      }

      const response = await axios.post(
        `${centralUrl}/api/sync/telemetry`,
        {
          zones: envData.zones,
          sensors: envData.sensors || {},
          timestamp: new Date().toISOString()
        },
        {
          headers: {
            'X-API-Key': apiKey,
            'X-Farm-ID': farmId,
            'Content-Type': 'application/json'
          },
          timeout: 30000
        }
      );

      console.log(`[sync-service] ✓ Synced telemetry: ${envData.zones.length} zones`);
    } catch (error) {
      console.error('[sync-service] ✗ Telemetry sync failed:', error.message);
      
      // Queue for later if offline
      if (edgeConfig.isOfflineMode()) {
        const envData = await this.getLocalEnvironmentalData();
        if (envData && envData.zones) {
          syncQueue.enqueue('telemetry_sync', { zones: envData.zones });
        }
      }
    }
  }

  /**
   * Get local environmental data
   */
  async getLocalEnvironmentalData() {
    try {
      const port = process.env.PORT || 8091;
      const url = `http://localhost:${port}/env`;
      console.log(`[sync-service] Fetching environmental data from ${url}`);
      
      const response = await axios.get(url);
      
      if (!response.data || !response.data.ok) {
        console.log('[sync-service] No environmental data available');
        return null;
      }

      // Extract zones from env response
      // Check for zones in env.json format or env API format
      let zones = response.data.zones || 
                 (response.data.env && response.data.env.zones) || 
                 [];
      
      // If no zones, try reading from env.json.zones file (sensor data)
      if (zones.length === 0) {
        try {
          const zonesUrl = `http://localhost:${port}/data/env.json.zones`;
          console.log(`[sync-service] Trying zones file: ${zonesUrl}`);
          const zonesResponse = await axios.get(zonesUrl);
          if (zonesResponse.data && zonesResponse.data.zones) {
            zones = zonesResponse.data.zones;
            console.log(`[sync-service] Retrieved ${zones.length} zones from env.json.zones file`);
          }
        } catch (err) {
          console.log(`[sync-service] No env.json.zones file available`);
        }
      }
      
      console.log(`[sync-service] Retrieved ${zones.length} environmental zones`);
      
      return {
        zones,
        sensors: response.data.sensors || {},
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('[sync-service] Failed to fetch environmental data:', error.message);
      return null;
    }
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
            'X-Farm-ID': farmId,
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
   * Get local inventory from Foxtrot wholesale API
   */
  async getLocalInventory() {
    try {
      const port = process.env.PORT || 8091;
      const url = `http://localhost:${port}/api/wholesale/inventory`;
      console.log(`[sync-service] Fetching inventory from ${url}`);
      
      const response = await axios.get(url);
      
      const data = response.data;
      console.log(`[sync-service] Received ${data.lots?.length || 0} inventory lots`);
      
      // Convert Foxtrot inventory format to sync format
      // Exclude manual/custom entries — they already exist in AlloyDB and syncing
      // them back creates a feedback loop (manual → sync → upsert as auto → hybrid)
      if (data.lots && Array.isArray(data.lots)) {
        return data.lots
          .filter(lot => {
            const flags = lot.quality_flags || [];
            return !flags.includes('manual_entry') && !flags.includes('custom_product');
          })
          .map(lot => ({
          product_id: lot.sku_id,
          product_name: lot.sku_name,
          sku: lot.sku_id,
          quantity: lot.qty_available,
          unit: lot.unit,
          price: lot.price_per_unit || 0,
          available_for_wholesale: lot.qty_available > 0 ? 1 : 0
        }));
      }
      
      return [];
    } catch (error) {
      console.error('[sync-service] Failed to fetch inventory from API:', error.message);
      if (error.response) {
        console.error('[sync-service] Response status:', error.response.status);
        console.error('[sync-service] Response data:', error.response.data);
      }
      return [];
    }
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

  /**
   * Sync rooms to central server
   */
  async syncRooms(rooms) {
    if (!edgeConfig.isSyncEnabled()) {
      console.log('[sync-service] Sync disabled, skipping rooms sync');
      return;
    }

    try {
      const farmId = edgeConfig.getFarmId();
      const apiKey = edgeConfig.getApiKey();
      const centralUrl = edgeConfig.getCentralApiUrl();

      const response = await axios.post(
        `${centralUrl}/api/sync/rooms`,
        { rooms },
        {
          headers: {
            'X-API-Key': apiKey,
            'X-Farm-ID': farmId,
            'Content-Type': 'application/json'
          },
          timeout: 30000
        }
      );

      console.log(`[sync-service] ✓ Synced ${rooms.length} rooms to central server`);
      return response.data;
    } catch (error) {
      console.error('[sync-service] ✗ Rooms sync failed:', error.message);
      throw error;
    }
  }

  /**
   * Sync groups to central server
   */
  async syncGroups(groups) {
    if (!edgeConfig.isSyncEnabled()) {
      console.log('[sync-service] Sync disabled, skipping groups sync');
      return;
    }

    try {
      const farmId = edgeConfig.getFarmId();
      const apiKey = edgeConfig.getApiKey();
      const centralUrl = edgeConfig.getCentralApiUrl();

      const response = await axios.post(
        `${centralUrl}/api/sync/groups`,
        { groups },
        {
          headers: {
            'X-API-Key': apiKey,
            'X-Farm-ID': farmId,
            'Content-Type': 'application/json'
          },
          timeout: 30000
        }
      );

      console.log(`[sync-service] ✓ Synced ${groups.length} groups to central server`);
      return response.data;
    } catch (error) {
      console.error('[sync-service] ✗ Groups sync failed:', error.message);
      throw error;
    }
  }

  /**
   * Sync schedules to central server (backup)
   */
  async syncSchedules() {
    if (!edgeConfig.isSyncEnabled()) return;

    try {
      const farmId = edgeConfig.getFarmId();
      const apiKey = edgeConfig.getApiKey();
      const centralUrl = edgeConfig.getCentralApiUrl();

      // Read local schedules file
      const schedulesPath = path.join(process.cwd(), 'public', 'data', 'schedules.json');
      if (!fs.existsSync(schedulesPath)) {
        console.log('[sync-service] No schedules.json found, skipping schedule sync');
        return;
      }

      const scheduleData = JSON.parse(fs.readFileSync(schedulesPath, 'utf8'));
      const schedules = scheduleData.schedules || scheduleData;

      const response = await axios.post(
        `${centralUrl}/api/sync/schedules`,
        { schedules: Array.isArray(schedules) ? schedules : [] },
        {
          headers: {
            'X-API-Key': apiKey,
            'X-Farm-ID': farmId,
            'Content-Type': 'application/json'
          },
          timeout: 30000
        }
      );

      console.log(`[sync-service] ✓ Synced schedules to central server`);
      return response.data;
    } catch (error) {
      console.error('[sync-service] ✗ Schedules sync failed:', error.message);
    }
  }

  /**
   * Sync config to central server (backup)
   */
  async syncConfig() {
    if (!edgeConfig.isSyncEnabled()) return;

    try {
      const farmId = edgeConfig.getFarmId();
      const apiKey = edgeConfig.getApiKey();
      const centralUrl = edgeConfig.getCentralApiUrl();

      // Read local config file
      const configPath = path.join(process.cwd(), 'public', 'data', 'farm-config.json');
      let config = {};
      if (fs.existsSync(configPath)) {
        config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      }

      // Also include edge-config settings
      const edgeSettings = {
        farmName: edgeConfig.config?.farmName,
        hardwareModel: edgeConfig.config?.hardwareModel,
        syncInterval: edgeConfig.config?.syncInterval,
        mode: edgeConfig.config?.mode
      };

      const response = await axios.post(
        `${centralUrl}/api/sync/config`,
        { config: { ...config, edgeSettings } },
        {
          headers: {
            'X-API-Key': apiKey,
            'X-Farm-ID': farmId,
            'Content-Type': 'application/json'
          },
          timeout: 30000
        }
      );

      console.log('[sync-service] ✓ Synced config to central server');
      return response.data;
    } catch (error) {
      console.error('[sync-service] ✗ Config sync failed:', error.message);
    }
  }

  /**
   * Full backup push — sends all data to Central for disaster recovery
   */
  async pushFullBackup() {
    console.log('[sync-service] Starting full backup push to Central...');
    
    // Read local data files
    const dataDir = path.join(process.cwd(), 'public', 'data');
    
    try {
      // Sync rooms
      const roomsPath = path.join(dataDir, 'rooms.json');
      if (fs.existsSync(roomsPath)) {
        const roomsData = JSON.parse(fs.readFileSync(roomsPath, 'utf8'));
        const rooms = roomsData.rooms || roomsData;
        if (Array.isArray(rooms) && rooms.length > 0) {
          await this.syncRooms(rooms);
        }
      }

      // Sync groups
      const groupsPath = path.join(dataDir, 'groups.json');
      if (fs.existsSync(groupsPath)) {
        const groupsData = JSON.parse(fs.readFileSync(groupsPath, 'utf8'));
        const groups = groupsData.groups || groupsData;
        if (Array.isArray(groups) && groups.length > 0) {
          await this.syncGroups(groups);
        }
      }

      // Sync schedules
      await this.syncSchedules();

      // Sync config
      await this.syncConfig();

      console.log('[sync-service] ✓ Full backup push complete');
      return { success: true };
    } catch (error) {
      console.error('[sync-service] ✗ Full backup push failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Restore data from central server (for disaster recovery)
   * Phase 1: rooms + groups (individual endpoints)
   * Phase 2: schedules + config (full restore endpoint)
   */
  async restoreFromCloud() {
    try {
      const farmId = edgeConfig.getFarmId();
      const apiKey = edgeConfig.getApiKey();
      const centralUrl = edgeConfig.getCentralApiUrl();

      console.log('[sync-service] Restoring data from cloud...');

      // --- Phase 1: Rooms + Groups (individual endpoints) ---
      // Restore rooms
      const roomsResponse = await axios.get(
        `${centralUrl}/api/sync/${farmId}/rooms`,
        {
          headers: {
            'X-API-Key': apiKey,
            'X-Farm-ID': farmId,
            'Content-Type': 'application/json'
          },
          timeout: 30000
        }
      );

      // Guard against empty array overwrites (data loss prevention)
      const roomsFromCentral = Array.isArray(roomsResponse.data.rooms) && roomsResponse.data.rooms.length > 0;
      if (roomsFromCentral) {
        await this.saveLocalRooms(roomsResponse.data.rooms);
        console.log(`[sync-service] ✓ Restored ${roomsResponse.data.rooms.length} rooms`);
      } else {
        console.log('[sync-service] ⚠ Central returned empty/no rooms - preserving local data');
      }

      // Restore groups
      const groupsResponse = await axios.get(
        `${centralUrl}/api/sync/${farmId}/groups`,
        {
          headers: {
            'X-API-Key': apiKey,
            'X-Farm-ID': farmId,
            'Content-Type': 'application/json'
          },
          timeout: 30000
        }
      );

      // Guard against empty array overwrites (data loss prevention)
      const groupsFromCentral = Array.isArray(groupsResponse.data.groups) && groupsResponse.data.groups.length > 0;
      if (groupsFromCentral) {
        await this.saveLocalGroups(groupsResponse.data.groups);
        console.log(`[sync-service] ✓ Restored ${groupsResponse.data.groups.length} groups`);
      } else {
        console.log('[sync-service] ⚠ Central returned empty/no groups - preserving local data');
      }

      // --- Phase 2: Schedules + Config (full restore endpoint) ---
      try {
        const fullRestore = await axios.post(
          `${centralUrl}/api/sync/restore/${farmId}`,
          {},
          {
            headers: {
              'X-API-Key': apiKey,
              'X-Farm-ID': farmId,
              'Content-Type': 'application/json'
            },
            timeout: 30000
          }
        );

        if (fullRestore.data?.success && fullRestore.data?.data) {
          const { schedules, config } = fullRestore.data.data;

          // Restore schedules
          if (Array.isArray(schedules) && schedules.length > 0) {
            await this.saveLocalSchedules(schedules);
            console.log(`[sync-service] ✓ Restored ${schedules.length} schedules from backup`);
          } else {
            console.log('[sync-service] ⚠ No schedules in backup - preserving local data');
          }

          // Restore config
          if (config && Object.keys(config).length > 0) {
            await this.saveLocalConfig(config);
            console.log('[sync-service] ✓ Restored config from backup');
          } else {
            console.log('[sync-service] ⚠ No config in backup - preserving local data');
          }
        }
      } catch (phase2Err) {
        // Phase 2 is optional — don't fail the whole restore if it's unavailable
        console.warn('[sync-service] ⚠ Phase 2 restore (schedules/config) unavailable:', phase2Err.message);
      }

      console.log('[sync-service] ✓ Cloud restore completed');
      return { success: true };
    } catch (error) {
      console.error('[sync-service] ✗ Cloud restore failed:', error.message);
      throw error;
    }
  }

  /**
   * Save rooms to local file
   */
  async saveLocalRooms(rooms) {
    const fs = await import('fs/promises');
    const path = await import('path');
    
    const roomsFilePath = path.join(process.cwd(), 'public', 'data', 'rooms.json');
    const roomsData = {
      rooms,
      metadata: {
        lastUpdated: new Date().toISOString(),
        version: '1.0',
        source: 'cloud_restore'
      }
    };
    
    await fs.writeFile(roomsFilePath, JSON.stringify(roomsData, null, 2), 'utf8');
  }

  /**
   * Save groups to local file
   */
  async saveLocalGroups(groups) {
    const fs = await import('fs/promises');
    const path = await import('path');
    
    const groupsFilePath = path.join(process.cwd(), 'public', 'data', 'groups.json');
    const groupsData = {
      groups,
      metadata: {
        lastUpdated: new Date().toISOString(),
        version: '1.0',
        source: 'cloud_restore'
      }
    };
    
    await fs.writeFile(groupsFilePath, JSON.stringify(groupsData, null, 2), 'utf8');
  }

  /**
   * Save schedules to local file (Phase 2 restore)
   */
  async saveLocalSchedules(schedules) {
    const fs = await import('fs/promises');
    const path = await import('path');
    
    const schedulesFilePath = path.join(process.cwd(), 'public', 'data', 'schedules.json');
    const schedulesData = {
      schedules,
      metadata: {
        lastUpdated: new Date().toISOString(),
        version: '1.0',
        source: 'cloud_restore'
      }
    };
    
    await fs.writeFile(schedulesFilePath, JSON.stringify(schedulesData, null, 2), 'utf8');
  }

  /**
   * Save config to local file (Phase 2 restore)
   */
  async saveLocalConfig(config) {
    const fs = await import('fs/promises');
    const path = await import('path');
    
    const configFilePath = path.join(process.cwd(), 'public', 'data', 'farm-config.json');
    const configData = {
      config,
      metadata: {
        lastUpdated: new Date().toISOString(),
        version: '1.0',
        source: 'cloud_restore'
      }
    };
    
    await fs.writeFile(configFilePath, JSON.stringify(configData, null, 2), 'utf8');
  }
}

export default SyncService;
