/**
 * mDNS Discovery API Routes
 * Provides REST API for discovering and managing local network devices
 */

import express from 'express';
import { MDNSBrowser } from '../lib/mdns-advertiser.js';

const router = express.Router();

// Store discovered services
let discoveredServices = [];
let browser = null;

/**
 * Initialize mDNS browser
 */
function initializeBrowser() {
  if (browser) {
    return;
  }
  
  browser = new MDNSBrowser({
    serviceType: 'http',
    onServiceUp: (service) => {
      // Check if it's a Light Engine service
      if (service.name && service.name.toLowerCase().includes('light engine')) {
        const deviceInfo = {
          name: service.name,
          host: service.host,
          port: service.port,
          addresses: service.addresses || [],
          url: `http://${service.host}:${service.port}`,
          txt: service.txt || {},
          discoveredAt: new Date().toISOString(),
          status: 'online'
        };
        
        // Update or add service
        const index = discoveredServices.findIndex(s => s.name === service.name);
        if (index >= 0) {
          discoveredServices[index] = deviceInfo;
        } else {
          discoveredServices.push(deviceInfo);
        }
      }
    },
    onServiceDown: (service) => {
      const index = discoveredServices.findIndex(s => s.name === service.name);
      if (index >= 0) {
        discoveredServices[index].status = 'offline';
        discoveredServices[index].lastSeen = new Date().toISOString();
      }
    }
  });
  
  browser.start();
}

/**
 * GET /api/mdns/discover
 * Start discovery and return list of discovered devices
 */
router.get('/discover', (req, res) => {
  try {
    initializeBrowser();
    
    // Return current list
    res.json({
      ok: true,
      services: discoveredServices,
      scanning: true
    });
  } catch (error) {
    console.error('[mDNS API] Discovery error:', error);
    res.status(500).json({
      ok: false,
      error: error.message,
      available: false
    });
  }
});

/**
 * GET /api/mdns/services
 * Get list of all discovered services
 */
router.get('/services', (req, res) => {
  res.json({
    ok: true,
    services: discoveredServices,
    count: discoveredServices.length
  });
});

/**
 * GET /api/mdns/services/:name
 * Get details of a specific service
 */
router.get('/services/:name', (req, res) => {
  const { name } = req.params;
  const service = discoveredServices.find(s => s.name === name);
  
  if (!service) {
    return res.status(404).json({
      ok: false,
      error: 'Service not found'
    });
  }
  
  res.json({
    ok: true,
    service
  });
});

/**
 * POST /api/mdns/refresh
 * Clear cache and restart discovery
 */
router.post('/refresh', (req, res) => {
  try {
    // Stop existing browser
    if (browser) {
      browser.destroy();
      browser = null;
    }
    
    // Clear services
    discoveredServices = [];
    
    // Restart
    initializeBrowser();
    
    res.json({
      ok: true,
      message: 'Discovery restarted'
    });
  } catch (error) {
    console.error('[mDNS API] Refresh error:', error);
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

/**
 * DELETE /api/mdns/services/:name
 * Remove a service from the list (manual cleanup)
 */
router.delete('/services/:name', (req, res) => {
  const { name } = req.params;
  const index = discoveredServices.findIndex(s => s.name === name);
  
  if (index === -1) {
    return res.status(404).json({
      ok: false,
      error: 'Service not found'
    });
  }
  
  discoveredServices.splice(index, 1);
  
  res.json({
    ok: true,
    message: 'Service removed'
  });
});

/**
 * GET /api/mdns/status
 * Get mDNS system status
 */
router.get('/status', (req, res) => {
  res.json({
    ok: true,
    browserRunning: browser !== null,
    servicesCount: discoveredServices.length,
    onlineCount: discoveredServices.filter(s => s.status === 'online').length,
    offlineCount: discoveredServices.filter(s => s.status === 'offline').length
  });
});

// Cleanup on shutdown
process.on('SIGINT', () => {
  if (browser) {
    browser.destroy();
  }
});

process.on('SIGTERM', () => {
  if (browser) {
    browser.destroy();
  }
});

export default router;
