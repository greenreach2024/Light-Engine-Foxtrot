/**
 * mDNS/Bonjour Service Advertiser
 * Enables edge devices to be discovered as light-engine.local on the local network
 */

const os = require('os');

class MDNSAdvertiser {
  constructor(options = {}) {
    this.serviceName = options.serviceName || 'Light Engine';
    this.serviceType = options.serviceType || 'http';
    this.port = options.port || 3000;
    this.hostname = options.hostname || 'light-engine';
    this.txtRecord = options.txtRecord || {};
    this.advertisement = null;
    this.bonjour = null;
    this.isAdvertising = false;
    
    // Try to load bonjour-service (graceful fallback if not available)
    try {
      const Bonjour = require('bonjour-service');
      this.bonjour = new Bonjour();
      console.log('[mDNS] Bonjour service initialized');
    } catch (error) {
      console.warn('[mDNS] Bonjour not available:', error.message);
      console.warn('[mDNS] mDNS discovery will not be available. Install with: npm install bonjour-service');
    }
  }
  
  /**
   * Start advertising the service via mDNS
   */
  start() {
    if (!this.bonjour) {
      console.warn('[mDNS] Cannot start: Bonjour not initialized');
      return false;
    }
    
    if (this.isAdvertising) {
      console.log('[mDNS] Already advertising');
      return true;
    }
    
    try {
      // Get local IP addresses
      const addresses = this.getLocalAddresses();
      
      // Build TXT record with device info
      const txtRecord = {
        ...this.txtRecord,
        version: process.env.npm_package_version || '1.0.0',
        platform: os.platform(),
        arch: os.arch(),
        node: process.version,
        ...this.getDeviceInfo()
      };
      
      // Publish the service
      this.advertisement = this.bonjour.publish({
        name: this.serviceName,
        type: this.serviceType,
        port: this.port,
        host: `${this.hostname}.local`,
        txt: txtRecord
      });
      
      this.isAdvertising = true;
      
      console.log(`[mDNS] Advertising service: ${this.serviceName}`);
      console.log(`[mDNS] Service type: ${this.serviceType}`);
      console.log(`[mDNS] Port: ${this.port}`);
      console.log(`[mDNS] Hostname: ${this.hostname}.local`);
      console.log(`[mDNS] Local addresses:`, addresses);
      console.log(`[mDNS] TXT record:`, txtRecord);
      console.log(`[mDNS] Access via: http://${this.hostname}.local:${this.port}`);
      
      return true;
    } catch (error) {
      console.error('[mDNS] Failed to start advertising:', error);
      return false;
    }
  }
  
  /**
   * Stop advertising the service
   */
  stop() {
    if (!this.isAdvertising) {
      return;
    }
    
    try {
      if (this.advertisement) {
        this.advertisement.stop();
        this.advertisement = null;
      }
      
      this.isAdvertising = false;
      console.log('[mDNS] Stopped advertising');
    } catch (error) {
      console.error('[mDNS] Error stopping advertisement:', error);
    }
  }
  
  /**
   * Update TXT record without restarting the service
   */
  updateTxtRecord(newRecord) {
    if (!this.isAdvertising) {
      console.warn('[mDNS] Cannot update: not advertising');
      return false;
    }
    
    try {
      this.txtRecord = { ...this.txtRecord, ...newRecord };
      
      // Restart with new TXT record
      this.stop();
      this.start();
      
      console.log('[mDNS] Updated TXT record:', this.txtRecord);
      return true;
    } catch (error) {
      console.error('[mDNS] Failed to update TXT record:', error);
      return false;
    }
  }
  
  /**
   * Get local network IP addresses (IPv4 only)
   */
  getLocalAddresses() {
    const addresses = [];
    const interfaces = os.networkInterfaces();
    
    for (const ifname in interfaces) {
      for (const iface of interfaces[ifname]) {
        // Skip internal (loopback) and IPv6
        if (iface.internal || iface.family !== 'IPv4') {
          continue;
        }
        addresses.push(iface.address);
      }
    }
    
    return addresses;
  }
  
  /**
   * Get device information for TXT record
   */
  getDeviceInfo() {
    try {
      return {
        hostname: os.hostname(),
        cpus: os.cpus().length,
        memory: Math.round(os.totalmem() / (1024 * 1024 * 1024)) + 'GB',
        uptime: Math.round(os.uptime() / 60) + 'min'
      };
    } catch (error) {
      console.error('[mDNS] Error getting device info:', error);
      return {};
    }
  }
  
  /**
   * Cleanup on shutdown
   */
  destroy() {
    this.stop();
    
    if (this.bonjour) {
      try {
        this.bonjour.destroy();
        console.log('[mDNS] Bonjour service destroyed');
      } catch (error) {
        console.error('[mDNS] Error destroying Bonjour:', error);
      }
    }
  }
}

/**
 * mDNS Browser - Discover other Light Engine instances
 */
class MDNSBrowser {
  constructor(options = {}) {
    this.serviceType = options.serviceType || 'http';
    this.browser = null;
    this.bonjour = null;
    this.services = new Map();
    this.onServiceUp = options.onServiceUp || (() => {});
    this.onServiceDown = options.onServiceDown || (() => {});
    
    // Try to load bonjour-service
    try {
      const Bonjour = require('bonjour-service');
      this.bonjour = new Bonjour();
      console.log('[mDNS Browser] Bonjour service initialized');
    } catch (error) {
      console.warn('[mDNS Browser] Bonjour not available:', error.message);
    }
  }
  
  /**
   * Start browsing for services
   */
  start() {
    if (!this.bonjour) {
      console.warn('[mDNS Browser] Cannot start: Bonjour not initialized');
      return false;
    }
    
    if (this.browser) {
      console.log('[mDNS Browser] Already browsing');
      return true;
    }
    
    try {
      this.browser = this.bonjour.find({ type: this.serviceType });
      
      this.browser.on('up', (service) => {
        console.log('[mDNS Browser] Service found:', {
          name: service.name,
          host: service.host,
          port: service.port,
          addresses: service.addresses,
          txt: service.txt
        });
        
        this.services.set(service.name, service);
        this.onServiceUp(service);
      });
      
      this.browser.on('down', (service) => {
        console.log('[mDNS Browser] Service lost:', service.name);
        
        this.services.delete(service.name);
        this.onServiceDown(service);
      });
      
      console.log(`[mDNS Browser] Browsing for ${this.serviceType} services...`);
      return true;
    } catch (error) {
      console.error('[mDNS Browser] Failed to start browsing:', error);
      return false;
    }
  }
  
  /**
   * Stop browsing
   */
  stop() {
    if (this.browser) {
      try {
        this.browser.stop();
        this.browser = null;
        console.log('[mDNS Browser] Stopped browsing');
      } catch (error) {
        console.error('[mDNS Browser] Error stopping browser:', error);
      }
    }
  }
  
  /**
   * Get list of discovered services
   */
  getServices() {
    return Array.from(this.services.values());
  }
  
  /**
   * Cleanup
   */
  destroy() {
    this.stop();
    
    if (this.bonjour) {
      try {
        this.bonjour.destroy();
        console.log('[mDNS Browser] Bonjour service destroyed');
      } catch (error) {
        console.error('[mDNS Browser] Error destroying Bonjour:', error);
      }
    }
  }
}

module.exports = {
  MDNSAdvertiser,
  MDNSBrowser
};
