/**
 * GreenReach Data Synchronization Service
 * 
 * Synchronizes farm data between farm servers and GreenReach Central.
 * Handles inventory, health metrics, alerts, and configuration updates.
 * 
 * Sync Intervals:
 * - Inventory: Every 5 minutes
 * - Health: Every 30 seconds
 * - Alerts: Immediate (real-time)
 * - Configuration: On change + daily check
 */

import EventEmitter from 'events';
import WebSocket from 'ws';
import fetch from 'node-fetch';

export default class SyncService extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      centralUrl: config.centralUrl || process.env.GREENREACH_CENTRAL_URL || 'https://api.greenreach.com',
      wsUrl: config.wsUrl || process.env.GREENREACH_WS_URL || 'wss://api.greenreach.com/ws',
      farmId: config.farmId || process.env.FARM_ID,
      apiKey: config.apiKey || process.env.GREENREACH_API_KEY,
      apiSecret: config.apiSecret || process.env.GREENREACH_API_SECRET,
      
      // Sync intervals (milliseconds)
      inventoryInterval: config.inventoryInterval || 5 * 60 * 1000, // 5 minutes
      healthInterval: config.healthInterval || 30 * 1000, // 30 seconds
      configInterval: config.configInterval || 24 * 60 * 60 * 1000, // 24 hours
      
      // Retry configuration
      maxRetries: config.maxRetries || 5,
      retryDelay: config.retryDelay || 5000, // 5 seconds
      retryBackoff: config.retryBackoff || 2, // Exponential backoff multiplier
      
      // Connection options
      heartbeatInterval: config.heartbeatInterval || 15000, // 15 seconds
      reconnectDelay: config.reconnectDelay || 3000, // 3 seconds
      
      ...config
    };
    
    this.state = {
      connected: false,
      lastSync: {
        inventory: null,
        health: null,
        alerts: null,
        config: null
      },
      syncErrors: {
        inventory: 0,
        health: 0,
        alerts: 0,
        config: 0
      },
      queue: [],
      processing: false
    };
    
    this.ws = null;
    this.intervals = {};
    this.reconnectTimeout = null;
    this.heartbeatTimeout = null;
  }
  
  /**
   * Start the sync service
   */
  async start() {
    console.log('[sync-service] Starting sync service...');
    
    // Validate configuration
    if (!this.config.farmId) {
      throw new Error('Farm ID is required');
    }
    if (!this.config.apiKey || !this.config.apiSecret) {
      throw new Error('API credentials are required');
    }
    
    // Connect to WebSocket for real-time updates
    await this.connectWebSocket();
    
    // Start sync intervals
    this.startInventorySync();
    this.startHealthSync();
    this.startConfigSync();
    
    // Process offline queue
    this.processQueue();
    
    console.log('[sync-service] Sync service started');
    this.emit('started');
  }
  
  /**
   * Stop the sync service
   */
  async stop() {
    console.log('[sync-service] Stopping sync service...');
    
    // Clear all intervals
    Object.values(this.intervals).forEach(interval => clearInterval(interval));
    this.intervals = {};
    
    // Clear reconnect timeout
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    
    // Clear heartbeat timeout
    if (this.heartbeatTimeout) {
      clearTimeout(this.heartbeatTimeout);
      this.heartbeatTimeout = null;
    }
    
    // Close WebSocket
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    
    this.state.connected = false;
    console.log('[sync-service] Sync service stopped');
    this.emit('stopped');
  }
  
  /**
   * Connect to GreenReach Central WebSocket
   */
  async connectWebSocket() {
    if (this.ws) {
      return;
    }
    
    try {
      console.log('[sync-service] Connecting to WebSocket:', this.config.wsUrl);
      
      this.ws = new WebSocket(this.config.wsUrl, {
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
          'X-Farm-ID': this.config.farmId
        }
      });
      
      this.ws.on('open', () => {
        console.log('[sync-service] WebSocket connected');
        this.state.connected = true;
        this.emit('connected');
        
        // Start heartbeat
        this.startHeartbeat();
        
        // Send authentication
        this.ws.send(JSON.stringify({
          type: 'auth',
          farmId: this.config.farmId,
          apiKey: this.config.apiKey
        }));
      });
      
      this.ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleWebSocketMessage(message);
        } catch (error) {
          console.error('[sync-service] Failed to parse WebSocket message:', error);
        }
      });
      
      this.ws.on('close', (code, reason) => {
        console.log(`[sync-service] WebSocket closed: ${code} ${reason}`);
        this.state.connected = false;
        this.emit('disconnected');
        
        // Clear heartbeat
        if (this.heartbeatTimeout) {
          clearTimeout(this.heartbeatTimeout);
          this.heartbeatTimeout = null;
        }
        
        this.ws = null;
        
        // Reconnect after delay
        this.scheduleReconnect();
      });
      
      this.ws.on('error', (error) => {
        console.error('[sync-service] WebSocket error:', error.message);
        this.emit('error', error);
      });
      
      this.ws.on('pong', () => {
        // Received pong response
        if (this.heartbeatTimeout) {
          clearTimeout(this.heartbeatTimeout);
          this.heartbeatTimeout = null;
        }
        this.scheduleHeartbeat();
      });
      
    } catch (error) {
      console.error('[sync-service] Failed to connect WebSocket:', error);
      this.scheduleReconnect();
    }
  }
  
  /**
   * Schedule WebSocket reconnection
   */
  scheduleReconnect() {
    if (this.reconnectTimeout) {
      return;
    }
    
    console.log(`[sync-service] Reconnecting in ${this.config.reconnectDelay}ms...`);
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      this.connectWebSocket();
    }, this.config.reconnectDelay);
  }
  
  /**
   * Start heartbeat to keep WebSocket alive
   */
  startHeartbeat() {
    this.scheduleHeartbeat();
  }
  
  /**
   * Schedule next heartbeat ping
   */
  scheduleHeartbeat() {
    if (this.heartbeatTimeout) {
      clearTimeout(this.heartbeatTimeout);
    }
    
    this.heartbeatTimeout = setTimeout(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.ping();
        
        // Set timeout to detect dead connection
        this.heartbeatTimeout = setTimeout(() => {
          console.log('[sync-service] Heartbeat timeout, closing connection');
          this.ws?.close();
        }, 5000);
      }
    }, this.config.heartbeatInterval);
  }
  
  /**
   * Handle incoming WebSocket messages
   */
  handleWebSocketMessage(message) {
    console.log('[sync-service] Received message:', message.type);
    
    switch (message.type) {
      case 'auth_success':
        console.log('[sync-service] Authentication successful');
        this.emit('authenticated');
        break;
        
      case 'auth_error':
        console.error('[sync-service] Authentication failed:', message.error);
        this.emit('auth_error', message.error);
        break;
        
      case 'config_update':
        console.log('[sync-service] Configuration update received');
        this.emit('config_update', message.data);
        break;
        
      case 'order_received':
        console.log('[sync-service] New order received');
        this.emit('order', message.data);
        break;
        
      case 'alert_ack':
        console.log('[sync-service] Alert acknowledged:', message.alertId);
        this.emit('alert_ack', message.alertId);
        break;
        
      default:
        console.log('[sync-service] Unknown message type:', message.type);
    }
  }
  
  /**
   * Start inventory sync interval
   */
  startInventorySync() {
    console.log(`[sync-service] Starting inventory sync (every ${this.config.inventoryInterval}ms)`);
    
    // Run immediately
    this.syncInventory();
    
    // Then run on interval
    this.intervals.inventory = setInterval(() => {
      this.syncInventory();
    }, this.config.inventoryInterval);
  }
  
  /**
   * Start health sync interval
   */
  startHealthSync() {
    console.log(`[sync-service] Starting health sync (every ${this.config.healthInterval}ms)`);
    
    // Run immediately
    this.syncHealth();
    
    // Then run on interval
    this.intervals.health = setInterval(() => {
      this.syncHealth();
    }, this.config.healthInterval);
  }
  
  /**
   * Start config sync interval
   */
  startConfigSync() {
    console.log(`[sync-service] Starting config sync (every ${this.config.configInterval}ms)`);
    
    // Run immediately
    this.syncConfig();
    
    // Then run on interval
    this.intervals.config = setInterval(() => {
      this.syncConfig();
    }, this.config.configInterval);
  }
  
  /**
   * Sync inventory to Central
   */
  async syncInventory() {
    try {
      console.log('[sync-service] Syncing inventory...');
      
      // Get inventory from local database
      const inventory = await this.getLocalInventory();
      
      // Send to Central API
      const response = await this.apiRequest('POST', '/api/sync/inventory', {
        farmId: this.config.farmId,
        timestamp: new Date().toISOString(),
        inventory
      });
      
      if (response.ok) {
        this.state.lastSync.inventory = new Date().toISOString();
        this.state.syncErrors.inventory = 0;
        console.log('[sync-service] Inventory synced successfully');
        this.emit('inventory_synced', inventory);
      } else {
        throw new Error(`Inventory sync failed: ${response.status}`);
      }
      
    } catch (error) {
      console.error('[sync-service] Inventory sync error:', error.message);
      this.state.syncErrors.inventory++;
      this.emit('sync_error', { type: 'inventory', error });
      
      // Queue for retry
      this.queueSync('inventory', await this.getLocalInventory());
    }
  }
  
  /**
   * Sync health metrics to Central
   */
  async syncHealth() {
    try {
      // Get health data from local system
      const health = await this.getHealthMetrics();
      
      // Send to Central API
      const response = await this.apiRequest('POST', '/api/sync/health', {
        farmId: this.config.farmId,
        timestamp: new Date().toISOString(),
        health
      });
      
      if (response.ok) {
        this.state.lastSync.health = new Date().toISOString();
        this.state.syncErrors.health = 0;
        this.emit('health_synced', health);
      } else {
        throw new Error(`Health sync failed: ${response.status}`);
      }
      
    } catch (error) {
      console.error('[sync-service] Health sync error:', error.message);
      this.state.syncErrors.health++;
      this.emit('sync_error', { type: 'health', error });
      
      // Queue for retry
      this.queueSync('health', await this.getHealthMetrics());
    }
  }
  
  /**
   * Sync configuration from Central
   */
  async syncConfig() {
    try {
      console.log('[sync-service] Syncing configuration...');
      
      // Get config from Central API
      const response = await this.apiRequest('GET', `/api/farms/${this.config.farmId}/config`);
      
      if (response.ok) {
        const config = await response.json();
        this.state.lastSync.config = new Date().toISOString();
        this.state.syncErrors.config = 0;
        console.log('[sync-service] Configuration synced successfully');
        this.emit('config_synced', config);
      } else {
        throw new Error(`Config sync failed: ${response.status}`);
      }
      
    } catch (error) {
      console.error('[sync-service] Config sync error:', error.message);
      this.state.syncErrors.config++;
      this.emit('sync_error', { type: 'config', error });
    }
  }

  /**
   * Sync rooms to Central
   */
  async syncRooms(rooms) {
    try {
      console.log(`[sync-service] Syncing ${rooms.length} rooms...`);
      
      const response = await this.apiRequest('POST', '/api/sync/rooms', {
        farmId: this.config.farmId,
        rooms
      });
      
      if (response.ok) {
        console.log('[sync-service] Rooms synced successfully');
        this.emit('rooms_synced', rooms);
        return true;
      } else {
        throw new Error(`Rooms sync failed: ${response.status}`);
      }
      
    } catch (error) {
      console.error('[sync-service] Rooms sync error:', error.message);
      this.emit('sync_error', { type: 'rooms', error });
      this.queueSync('rooms', rooms);
      return false;
    }
  }

  /**
   * Sync groups to Central
   */
  async syncGroups(groups) {
    try {
      console.log(`[sync-service] Syncing ${groups.length} groups...`);
      
      const response = await this.apiRequest('POST', '/api/sync/groups', {
        farmId: this.config.farmId,
        groups
      });
      
      if (response.ok) {
        console.log('[sync-service] Groups synced successfully');
        this.emit('groups_synced', groups);
        return true;
      } else {
        throw new Error(`Groups sync failed: ${response.status}`);
      }
      
    } catch (error) {
      console.error('[sync-service] Groups sync error:', error.message);
      this.emit('sync_error', { type: 'groups', error });
      this.queueSync('groups', groups);
      return false;
    }
  }

  /**
   * Sync schedules to Central
   */
  async syncSchedules(schedules) {
    try {
      console.log(`[sync-service] Syncing ${schedules.length} schedules...`);
      
      const response = await this.apiRequest('POST', '/api/sync/schedules', {
        farmId: this.config.farmId,
        schedules
      });
      
      if (response.ok) {
        console.log('[sync-service] Schedules synced successfully');
        this.emit('schedules_synced', schedules);
        return true;
      } else {
        throw new Error(`Schedules sync failed: ${response.status}`);
      }
      
    } catch (error) {
      console.error('[sync-service] Schedules sync error:', error.message);
      this.emit('sync_error', { type: 'schedules', error });
      this.queueSync('schedules', schedules);
      return false;
    }
  }

  /**
   * Sync telemetry (environmental/zone data) to Central
   * Sends zone sensor readings so Central can display room environmental data
   */
  async syncTelemetry(telemetryData) {
    try {
      const { zones, sensors, timestamp } = telemetryData;
      console.log(`[sync-service] Syncing telemetry: ${zones?.length || 0} zones...`);
      
      const response = await this.apiRequest('POST', '/api/sync/telemetry', {
        farmId: this.config.farmId,
        zones: zones || [],
        sensors: sensors || {},
        timestamp: timestamp || new Date().toISOString()
      });
      
      if (response.ok) {
        console.log('[sync-service] Telemetry synced successfully');
        this.emit('telemetry_synced', telemetryData);
        return true;
      } else {
        throw new Error(`Telemetry sync failed: ${response.status}`);
      }
      
    } catch (error) {
      console.error('[sync-service] Telemetry sync error:', error.message);
      this.emit('sync_error', { type: 'telemetry', error });
      // Don't queue telemetry - it's time-sensitive, next sync will send fresh data
      return false;
    }
  }
  
  /**
   * Send alert to Central immediately
   */
  async sendAlert(alert) {
    try {
      console.log('[sync-service] Sending alert:', alert.type);
      
      // Try WebSocket first (fastest)
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          type: 'alert',
          farmId: this.config.farmId,
          timestamp: new Date().toISOString(),
          alert
        }));
        
        console.log('[sync-service] Alert sent via WebSocket');
        this.emit('alert_sent', alert);
        return;
      }
      
      // Fallback to REST API
      const response = await this.apiRequest('POST', '/api/alerts', {
        farmId: this.config.farmId,
        timestamp: new Date().toISOString(),
        alert
      });
      
      if (response.ok) {
        console.log('[sync-service] Alert sent via REST API');
        this.state.lastSync.alerts = new Date().toISOString();
        this.emit('alert_sent', alert);
      } else {
        throw new Error(`Alert send failed: ${response.status}`);
      }
      
    } catch (error) {
      console.error('[sync-service] Alert send error:', error.message);
      this.emit('sync_error', { type: 'alert', error });
      
      // Queue for retry
      this.queueSync('alert', alert);
    }
  }
  
  /**
   * Queue data for retry when offline
   */
  queueSync(type, data) {
    this.state.queue.push({
      type,
      data,
      timestamp: new Date().toISOString(),
      retries: 0
    });
    
    console.log(`[sync-service] Queued ${type} for retry (queue size: ${this.state.queue.length})`);
    this.emit('queued', { type, queueSize: this.state.queue.length });
    
    // Process queue if not already processing
    if (!this.state.processing) {
      setTimeout(() => this.processQueue(), 1000);
    }
  }
  
  /**
   * Process offline queue
   */
  async processQueue() {
    if (this.state.processing || this.state.queue.length === 0) {
      return;
    }
    
    this.state.processing = true;
    console.log(`[sync-service] Processing queue (${this.state.queue.length} items)`);
    
    while (this.state.queue.length > 0) {
      const item = this.state.queue[0];
      
      try {
        // Try to sync the queued item
        let success = false;
        
        switch (item.type) {
          case 'inventory':
            const invResponse = await this.apiRequest('POST', '/api/sync/inventory', {
              farmId: this.config.farmId,
              timestamp: item.timestamp,
              inventory: item.data
            });
            success = invResponse.ok;
            break;
            
          case 'health':
            const healthResponse = await this.apiRequest('POST', '/api/sync/health', {
              farmId: this.config.farmId,
              timestamp: item.timestamp,
              health: item.data
            });
            success = healthResponse.ok;
            break;
            
          case 'alert':
            const alertResponse = await this.apiRequest('POST', '/api/alerts', {
              farmId: this.config.farmId,
              timestamp: item.timestamp,
              alert: item.data
            });
            success = alertResponse.ok;
            break;
            
          case 'rooms':
            const roomsResponse = await this.apiRequest('POST', '/api/sync/rooms', {
              farmId: this.config.farmId,
              rooms: item.data
            });
            success = roomsResponse.ok;
            break;
            
          case 'groups':
            const groupsResponse = await this.apiRequest('POST', '/api/sync/groups', {
              farmId: this.config.farmId,
              groups: item.data
            });
            success = groupsResponse.ok;
            break;
            
          case 'schedules':
            const schedulesResponse = await this.apiRequest('POST', '/api/sync/schedules', {
              farmId: this.config.farmId,
              schedules: item.data
            });
            success = schedulesResponse.ok;
            break;
        }
        
        if (success) {
          // Remove from queue
          this.state.queue.shift();
          console.log(`[sync-service] Queued ${item.type} synced successfully`);
          this.emit('queue_processed', { type: item.type, queueSize: this.state.queue.length });
        } else {
          // Increment retry count
          item.retries++;
          
          if (item.retries >= this.config.maxRetries) {
            // Max retries reached, remove from queue
            console.error(`[sync-service] Max retries reached for ${item.type}, dropping`);
            this.state.queue.shift();
            this.emit('queue_failed', { type: item.type, data: item.data });
          } else {
            // Wait before next retry with exponential backoff
            const delay = this.config.retryDelay * Math.pow(this.config.retryBackoff, item.retries - 1);
            console.log(`[sync-service] Retry ${item.retries}/${this.config.maxRetries} in ${delay}ms`);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
        
      } catch (error) {
        console.error(`[sync-service] Queue processing error for ${item.type}:`, error.message);
        item.retries++;
        
        if (item.retries >= this.config.maxRetries) {
          this.state.queue.shift();
          this.emit('queue_failed', { type: item.type, data: item.data });
        }
      }
    }
    
    this.state.processing = false;
    console.log('[sync-service] Queue processing complete');
  }
  
  /**
   * Make authenticated API request to Central
   */
  async apiRequest(method, path, body = null) {
    const url = `${this.config.centralUrl}${path}`;
    
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
        'X-Farm-ID': this.config.farmId,
        'X-API-Secret': this.config.apiSecret
      }
    };
    
    if (body) {
      options.body = JSON.stringify(body);
    }
    
    return fetch(url, options);
  }
  
  /**
   * Get local inventory data
   */
  async getLocalInventory() {
    // This would query the local database
    // Placeholder implementation
    return {
      products: [],
      lastUpdated: new Date().toISOString()
    };
  }
  
  /**
   * Get health metrics
   */
  async getHealthMetrics() {
    // This would collect system health data
    // Placeholder implementation
    return {
      cpu: 0,
      memory: 0,
      disk: 0,
      devices: 0,
      temperature: 0,
      uptime: process.uptime()
    };
  }
  
  /**
   * Get sync status
   */
  getStatus() {
    return {
      connected: this.state.connected,
      lastSync: this.state.lastSync,
      syncErrors: this.state.syncErrors,
      queueSize: this.state.queue.length,
      processing: this.state.processing
    };
  }
  
  /**
   * Trigger manual sync
   */
  async manualSync(type = 'all') {
    console.log(`[sync-service] Manual sync triggered: ${type}`);
    
    if (type === 'all' || type === 'inventory') {
      await this.syncInventory();
    }
    if (type === 'all' || type === 'health') {
      await this.syncHealth();
    }
    if (type === 'all' || type === 'config') {
      await this.syncConfig();
    }
    
    this.emit('manual_sync', type);
  }
}
