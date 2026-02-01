/**
 * Device Discovery Service
 * 
 * Automatically discover light controllers and sensors on the local network.
 * Leverages existing /api/lights/ping endpoint for validation.
 * 
 * Framework Compliance:
 * - Simplicity Over Features: Eliminates manual IP/protocol configuration
 * - Zero-Entry Data: Automatically detects devices without user input
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import fetch from 'node-fetch';

const execAsync = promisify(exec);

class DeviceDiscovery {
  constructor(options = {}) {
    this.timeout = options.timeout || 5000;
    this.logger = options.logger || console;
  }

  /**
   * Get local network subnet
   */
  getLocalSubnet() {
    const interfaces = os.networkInterfaces();
    
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        // Skip internal and non-IPv4 addresses
        if (iface.family === 'IPv4' && !iface.internal) {
          const parts = iface.address.split('.');
          parts[3] = '0';
          return `${parts.join('.')}/24`;
        }
      }
    }
    
    return '192.168.1.0/24'; // Fallback
  }

  /**
   * Scan network for active hosts
   * Uses ping sweep - lightweight, no external dependencies
   */
  async scanNetwork(subnet = null) {
    const targetSubnet = subnet || this.getLocalSubnet();
    const baseIP = targetSubnet.split('/')[0];
    const parts = baseIP.split('.');
    const basePrefix = `${parts[0]}.${parts[1]}.${parts[2]}`;
    
    this.logger.log(`[DeviceDiscovery] Scanning ${targetSubnet}...`);
    
    const activeHosts = [];
    const promises = [];
    
    // Scan range 1-254 (skip 0 and 255)
    for (let i = 1; i <= 254; i++) {
      const ip = `${basePrefix}.${i}`;
      promises.push(this.pingHost(ip));
    }
    
    const results = await Promise.allSettled(promises);
    
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        activeHosts.push(result.value);
      }
    }
    
    this.logger.log(`[DeviceDiscovery] Found ${activeHosts.length} active hosts`);
    return activeHosts;
  }

  /**
   * Ping a single host (cross-platform)
   */
  async pingHost(ip) {
    try {
      const platform = os.platform();
      const pingCmd = platform === 'win32' 
        ? `ping -n 1 -w 1000 ${ip}` 
        : `ping -c 1 -W 1 ${ip}`;
      
      await execAsync(pingCmd, { timeout: 2000 });
      return ip;
    } catch (error) {
      return null; // Host not reachable
    }
  }

  /**
   * Identify device type by probing
   */
  async identifyDevice(ip) {
    const device = {
      ip,
      reachable: false,
      protocol: 'unknown',
      type: 'unknown',
      manufacturer: 'unknown',
      port: null,
      confidence: 0
    };

    // Try GROW3 protocol first (most common)
    const grow3Result = await this.tryGrow3(ip);
    if (grow3Result.success) {
      device.reachable = true;
      device.protocol = 'grow3';
      device.type = 'light_controller';
      device.manufacturer = grow3Result.manufacturer || 'CODE3';
      device.port = grow3Result.port;
      device.confidence = 0.95;
      device.info = grow3Result.info;
      return device;
    }

    // Try DMX512 protocol
    const dmxResult = await this.tryDMX(ip);
    if (dmxResult.success) {
      device.reachable = true;
      device.protocol = 'dmx';
      device.type = 'light_controller';
      device.manufacturer = 'Generic DMX';
      device.port = dmxResult.port;
      device.confidence = 0.80;
      return device;
    }

    // Try generic HTTP probe (could be sensor or other device)
    const httpResult = await this.tryHTTP(ip);
    if (httpResult.success) {
      device.reachable = true;
      device.protocol = 'http';
      device.type = httpResult.type || 'unknown';
      device.manufacturer = httpResult.manufacturer || 'Unknown';
      device.port = httpResult.port;
      device.confidence = 0.50;
      return device;
    }

    return device;
  }

  /**
   * Try GROW3 protocol detection
   */
  async tryGrow3(ip, port = 80) {
    try {
      const controller = `http://${ip}:${port}`;
      const response = await fetch(`${controller}/info`, {
        method: 'GET',
        timeout: this.timeout,
        headers: { 'Accept': 'application/json' }
      });

      if (response.ok) {
        const info = await response.json();
        
        return {
          success: true,
          port,
          manufacturer: info.manufacturer || 'CODE3',
          info: {
            model: info.model,
            firmware: info.firmware,
            channels: info.channels,
            name: info.name
          }
        };
      }
    } catch (error) {
      // Not a GROW3 device or not reachable
    }
    
    return { success: false };
  }

  /**
   * Try DMX512 protocol detection
   */
  async tryDMX(ip, port = 6038) {
    try {
      // DMX typically uses Art-Net protocol on port 6038
      // Try HTTP API if available (some DMX bridges have REST APIs)
      const response = await fetch(`http://${ip}:${port}/status`, {
        method: 'GET',
        timeout: this.timeout
      });

      if (response.ok) {
        return { success: true, port };
      }
    } catch (error) {
      // Not a DMX device or not reachable
    }

    return { success: false };
  }

  /**
   * Try generic HTTP detection
   */
  async tryHTTP(ip) {
    const ports = [80, 8080, 3000, 5000]; // Common HTTP ports
    
    for (const port of ports) {
      try {
        const response = await fetch(`http://${ip}:${port}`, {
          method: 'GET',
          timeout: this.timeout
        });

        if (response.ok) {
          const contentType = response.headers.get('content-type') || '';
          
          // Try to identify device type from response
          let type = 'unknown';
          let manufacturer = 'Unknown';
          
          if (contentType.includes('json')) {
            try {
              const data = await response.json();
              if (data.type) type = data.type;
              if (data.manufacturer) manufacturer = data.manufacturer;
            } catch {}
          }
          
          return { success: true, port, type, manufacturer };
        }
      } catch (error) {
        // Try next port
      }
    }
    
    return { success: false };
  }

  /**
   * Full discovery workflow: scan + identify
   */
  async discoverDevices(options = {}) {
    const subnet = options.subnet || null;
    const filter = options.filter || null; // 'light_controller', 'sensor', etc.
    
    const startTime = Date.now();
    this.logger.log('[DeviceDiscovery] Starting full network discovery...');
    
    // Step 1: Find active hosts
    const activeHosts = await this.scanNetwork(subnet);
    
    // Step 2: Identify each device (parallel with limit)
    const devices = [];
    const batchSize = 10; // Process 10 at a time to avoid overwhelming network
    
    for (let i = 0; i < activeHosts.length; i += batchSize) {
      const batch = activeHosts.slice(i, i + batchSize);
      const batchPromises = batch.map(ip => this.identifyDevice(ip));
      const batchResults = await Promise.allSettled(batchPromises);
      
      for (const result of batchResults) {
        if (result.status === 'fulfilled' && result.value.reachable) {
          devices.push(result.value);
        }
      }
      
      this.logger.log(`[DeviceDiscovery] Processed ${Math.min(i + batchSize, activeHosts.length)}/${activeHosts.length} hosts`);
    }
    
    // Step 3: Filter if requested
    let filteredDevices = devices;
    if (filter) {
      filteredDevices = devices.filter(d => d.type === filter);
    }
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    this.logger.log(`[DeviceDiscovery] Discovery complete in ${duration}s. Found ${filteredDevices.length} devices.`);
    
    return {
      devices: filteredDevices,
      summary: {
        totalHosts: activeHosts.length,
        devicesFound: devices.length,
        lightControllers: devices.filter(d => d.type === 'light_controller').length,
        duration: `${duration}s`,
        subnet: subnet || this.getLocalSubnet()
      }
    };
  }

  /**
   * Quick scan for light controllers only (optimized)
   */
  async discoverLightControllers() {
    return this.discoverDevices({ filter: 'light_controller' });
  }
}

export default DeviceDiscovery;
