/**
 * Edge Device Configuration
 * 
 * Manages configuration for edge device operation including:
 * - Edge vs Cloud mode detection
 * - GreenReach Central API connection
 * - Farm identification and API keys
 * - Sync intervals and settings
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration file path
const CONFIG_FILE = path.join(__dirname, '../config/edge-config.json');

// Default configuration
const DEFAULT_CONFIG = {
  mode: 'cloud', // 'edge' or 'cloud'
  farmId: null,
  farmName: null,
  apiKey: null,
  centralApiUrl: 'https://api.greenreach.com', // TODO: Update with actual URL
  syncInterval: 5 * 60 * 1000, // 5 minutes in milliseconds
  heartbeatInterval: 30 * 1000, // 30 seconds in milliseconds
  hardwareModel: 'Symcod W101M N97',
  version: '1.0.0',
  offlineMode: false,
  syncEnabled: true,
  registrationComplete: false,
  authoritative: false // Data loss prevention: retain local data when Central has none
};

class EdgeConfig {
  constructor() {
    this.config = { ...DEFAULT_CONFIG };
    this.loadConfig();
  }

  /**
   * Load configuration from file
   */
  loadConfig() {
    try {
      if (fs.existsSync(CONFIG_FILE)) {
        const fileConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        this.config = { ...DEFAULT_CONFIG, ...fileConfig };
        console.log(`✓ Loaded edge configuration: ${this.config.mode} mode`);
      }
    } catch (error) {
      console.warn('Warning: Could not load edge config, using defaults:', error.message);
    }
  }

  /**
   * Save configuration to file
   */
  saveConfig() {
    try {
      const configDir = path.dirname(CONFIG_FILE);
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(this.config, null, 2));
      console.log('✓ Saved edge configuration');
    } catch (error) {
      console.error('Error saving edge config:', error);
      throw error;
    }
  }

  /**
   * Check if running in edge mode
   */
  isEdgeMode() {
    return this.config.mode === 'edge' || process.env.EDGE_MODE === 'true';
  }

  /**
   * Check if running in cloud mode
   */
  isCloudMode() {
    return !this.isEdgeMode();
  }

  /**
   * Check if registration is complete
   */
  isRegistered() {
    return this.config.registrationComplete && 
           this.config.farmId && 
           this.config.apiKey;
  }

  /**
   * Get farm ID
   */
  getFarmId() {
    return this.config.farmId;
  }

  /**
   * Get farm name
   */
  getFarmName() {
    return this.config.farmName || 'Unknown Farm';
  }

  /**
   * Get API key for central server
   */
  getApiKey() {
    return this.config.apiKey;
  }

  /**
   * Get central API URL
   */
  getCentralApiUrl() {
    return process.env.GREENREACH_CENTRAL_URL || process.env.CENTRAL_API_URL || this.config.centralApiUrl;
  }

  /**
   * Get sync interval in milliseconds
   */
  getSyncInterval() {
    return this.config.syncInterval;
  }

  /**
   * Get heartbeat interval in milliseconds
   */
  getHeartbeatInterval() {
    return this.config.heartbeatInterval;
  }

  /**
   * Check if sync is enabled
   */
  isSyncEnabled() {
    return this.config.syncEnabled && this.isRegistered();
  }

  /**
   * Check if in offline mode
   */
  isOfflineMode() {
    return this.config.offlineMode;
  }

  /**
   * Set edge mode
   */
  setEdgeMode(enabled = true) {
    this.config.mode = enabled ? 'edge' : 'cloud';
    this.saveConfig();
  }

  /**
   * Register farm with central server
   */
  registerFarm(farmId, farmName, apiKey, options = {}) {
    this.config.farmId = farmId;
    this.config.farmName = farmName;
    this.config.apiKey = apiKey;
    this.config.registrationComplete = true;
    this.config.mode = 'edge';
    // Set authoritative flag (defaults to false unless explicitly set)
    if (options.authoritative !== undefined) {
      this.config.authoritative = options.authoritative;
    } else if (this.config.authoritative === undefined) {
      this.config.authoritative = false; // Ensure it's persisted
    }
    this.saveConfig();
    console.log(`✓ Farm registered: ${farmName} (${farmId})`);
  }

  /**
   * Update farm information
   */
  updateFarm(updates) {
    Object.assign(this.config, updates);
    this.saveConfig();
  }

  /**
   * Set offline mode
   */
  setOfflineMode(offline = true) {
    this.config.offlineMode = offline;
    console.log(`${offline ? '⚠' : '✓'} Offline mode ${offline ? 'enabled' : 'disabled'}`);
  }

  /**
   * Enable/disable sync
   */
  setSyncEnabled(enabled = true) {
    this.config.syncEnabled = enabled;
    this.saveConfig();
  }

  /**
   * Get hardware information
   */
  getHardwareInfo() {
    return {
      model: this.config.hardwareModel,
      version: this.config.version,
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version
    };
  }

  /**
   * Get all configuration
   */
  getAll() {
    return { ...this.config };
  }

  /**
   * Reset configuration to defaults
   */
  reset() {
    this.config = { ...DEFAULT_CONFIG };
    this.saveConfig();
    console.log('✓ Edge configuration reset to defaults');
  }
}

// Export singleton instance
export default new EdgeConfig();
