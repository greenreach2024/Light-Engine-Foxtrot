/**
 * Farm Settings Sync Client (Farm Server)
 * 
 * Polls GreenReach Central every 30 seconds for configuration changes
 * Applies changes to local farm.json and notifies Central of completion
 * 
 * Synced Settings:
 * - Certifications & practices
 * - Notification preferences
 * - Display preferences (units, timezone, etc.)
 */

import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';

export class FarmSettingsSyncClient {
  constructor(config = {}) {
    this.config = {
      centralUrl: config.centralUrl || process.env.GREENREACH_CENTRAL_URL || 'https://api.greenreach.com',
      farmId: config.farmId || process.env.FARM_ID,
      apiKey: config.apiKey || process.env.GREENREACH_API_KEY,
      pollInterval: config.pollInterval || 30000, // 30 seconds
      farmDataPath: config.farmDataPath || path.join(process.cwd(), 'data', 'farm.json'),
      ...config
    };
    
    this.state = {
      isPolling: false,
      lastSync: null,
      lastError: null,
      consecutiveErrors: 0,
      appliedChanges: []
    };
    
    this.pollTimer = null;
  }
  
  /**
   * Start polling for configuration changes
   */
  start() {
    if (this.pollTimer) {
      console.log('[Settings Sync] Already polling');
      return;
    }
    
    if (!this.config.centralUrl || !this.config.farmId || !this.config.apiKey) {
      console.log('[Settings Sync] ⚠️ Missing configuration, sync disabled');
      console.log('  - Set GREENREACH_CENTRAL_URL, FARM_ID, and GREENREACH_API_KEY to enable sync');
      return;
    }
    
    console.log('[Settings Sync] Starting sync client...');
    console.log(`  - Farm ID: ${this.config.farmId}`);
    console.log(`  - Central URL: ${this.config.centralUrl}`);
    console.log(`  - Poll interval: ${this.config.pollInterval}ms`);
    
    // Initial sync
    this.pollForChanges();
    
    // Set up polling timer
    this.pollTimer = setInterval(() => {
      this.pollForChanges();
    }, this.config.pollInterval);
    
    console.log('[Settings Sync] ✓ Sync client started');
  }
  
  /**
   * Stop polling
   */
  stop() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
      console.log('[Settings Sync] Sync client stopped');
    }
  }
  
  /**
   * Poll GreenReach Central for pending changes
   */
  async pollForChanges() {
    if (this.state.isPolling) {
      return; // Already polling, skip this cycle
    }
    
    this.state.isPolling = true;
    
    try {
      const url = `${this.config.centralUrl}/api/farm-settings/${this.config.farmId}/pending`;
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'X-API-Key': this.config.apiKey,
          'X-Farm-ID': this.config.farmId,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      
      if (data.hasPendingChanges) {
        console.log('[Settings Sync] 📥 Pending changes detected');
        await this.applyChanges(data.changes);
      }
      
      this.state.lastSync = new Date().toISOString();
      this.state.lastError = null;
      this.state.consecutiveErrors = 0;
      
    } catch (error) {
      this.state.lastError = error.message;
      this.state.consecutiveErrors++;
      
      // Log error only if multiple consecutive failures
      if (this.state.consecutiveErrors === 1 || this.state.consecutiveErrors % 10 === 0) {
        console.error(`[Settings Sync] ❌ Poll error (${this.state.consecutiveErrors}x):`, error.message);
      }
    } finally {
      this.state.isPolling = false;
    }
  }
  
  /**
   * Apply changes to local farm.json
   */
  async applyChanges(changes) {
    const results = [];
    
    for (const [changeType, changeData] of Object.entries(changes)) {
      try {
        console.log(`[Settings Sync] Applying ${changeType}...`);
        
        switch (changeType) {
          case 'certifications':
            await this.applyCertifications(changeData);
            break;
          case 'notificationPreferences':
            await this.applyNotificationPreferences(changeData);
            break;
          case 'displayPreferences':
            await this.applyDisplayPreferences(changeData);
            break;
          default:
            console.log(`[Settings Sync] Unknown change type: ${changeType}`);
            continue;
        }
        
        // Acknowledge successful sync
        await this.acknowledgeSync(changeType, true);
        
        results.push({ changeType, success: true });
        this.state.appliedChanges.push({
          changeType,
          appliedAt: new Date().toISOString(),
          updatedBy: changeData.updatedBy
        });
        
        console.log(`[Settings Sync] ✓ ${changeType} applied successfully`);
        
      } catch (error) {
        console.error(`[Settings Sync] ❌ Error applying ${changeType}:`, error.message);
        
        // Acknowledge failed sync
        await this.acknowledgeSync(changeType, false, error.message);
        
        results.push({ changeType, success: false, error: error.message });
      }
    }
    
    // Keep only last 100 applied changes
    if (this.state.appliedChanges.length > 100) {
      this.state.appliedChanges = this.state.appliedChanges.slice(-100);
    }
    
    return results;
  }
  
  /**
   * Apply certification changes
   */
  async applyCertifications(data) {
    const farmData = this.loadFarmData();
    
    farmData.certifications = {
      certifications: data.certifications || [],
      practices: data.practices || [],
      lastSyncedAt: new Date().toISOString(),
      lastSyncedBy: data.updatedBy
    };
    
    this.saveFarmData(farmData);
  }
  
  /**
   * Apply notification preference changes
   */
  async applyNotificationPreferences(data) {
    const farmData = this.loadFarmData();
    
    farmData.notificationPreferences = {
      ...data,
      lastSyncedAt: new Date().toISOString()
    };
    
    this.saveFarmData(farmData);
  }
  
  /**
   * Apply display preference changes
   */
  async applyDisplayPreferences(data) {
    const farmData = this.loadFarmData();
    
    farmData.displayPreferences = {
      ...data,
      lastSyncedAt: new Date().toISOString()
    };
    
    this.saveFarmData(farmData);
  }
  
  /**
   * Load farm.json
   */
  loadFarmData() {
    try {
      if (fs.existsSync(this.config.farmDataPath)) {
        const fileContent = fs.readFileSync(this.config.farmDataPath, 'utf8');
        return JSON.parse(fileContent);
      }
    } catch (error) {
      console.warn('[Settings Sync] Could not load farm.json:', error.message);
    }
    
    return {};
  }
  
  /**
   * Save farm.json
   */
  saveFarmData(data) {
    const dataDir = path.dirname(this.config.farmDataPath);
    
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    
    fs.writeFileSync(this.config.farmDataPath, JSON.stringify(data, null, 2));
  }
  
  /**
   * Acknowledge sync to Central
   */
  async acknowledgeSync(changeType, success, error = null) {
    try {
      const url = `${this.config.centralUrl}/api/farm-settings/${this.config.farmId}/ack`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'X-API-Key': this.config.apiKey,
          'X-Farm-ID': this.config.farmId,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ changeType, success, error }),
        timeout: 5000
      });
      
      if (!response.ok) {
        console.warn('[Settings Sync] Failed to acknowledge sync:', response.statusText);
      }
    } catch (error) {
      console.warn('[Settings Sync] Failed to send ack:', error.message);
    }
  }
  
  /**
   * Get sync status
   */
  getStatus() {
    return {
      enabled: !!this.pollTimer,
      isPolling: this.state.isPolling,
      lastSync: this.state.lastSync,
      lastError: this.state.lastError,
      consecutiveErrors: this.state.consecutiveErrors,
      recentChanges: this.state.appliedChanges.slice(-10)
    };
  }
}

// Export singleton instance
let syncClient = null;

export function initializeSettingsSync(config) {
  if (!syncClient) {
    syncClient = new FarmSettingsSyncClient(config);
    syncClient.start();
  }
  return syncClient;
}

export function getSettingsSyncClient() {
  return syncClient;
}

export default FarmSettingsSyncClient;
