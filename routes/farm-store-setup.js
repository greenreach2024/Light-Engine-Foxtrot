/**
 * Farm Online Store Setup API
 * 
 * Handles online store configuration, domain setup, and deployment.
 */

import express from 'express';
import fs from 'fs/promises';
import path from 'path';

const router = express.Router();

// In-memory storage (TODO: migrate to database)
const farmStores = new Map(); // farm_id -> store config
const subdomains = new Set(['demo', 'test', 'admin', 'api', 'www']); // Reserved subdomains

/**
 * GET /api/farm/store/status
 * 
 * Check farm store configuration status
 */
router.get('/status', async (req, res) => {
  try {
    const farmId = req.headers['x-farm-id'] || 'FARM-001';
    
    const store = farmStores.get(farmId);
    
    if (!store) {
      return res.json({
        ok: true,
        configured: false,
        message: 'Store not configured'
      });
    }
    
    res.json({
      ok: true,
      configured: true,
      data: {
        domain: store.domain,
        storeName: store.storeName,
        status: store.status,
        url: store.url,
        createdAt: store.createdAt,
        launchedAt: store.launchedAt
      }
    });
  } catch (error) {
    console.error('[farm-store] Status check error:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to check store status',
      message: error.message
    });
  }
});

/**
 * POST /api/farm/store/subdomain/check
 * 
 * Check if subdomain is available
 * 
 * Body:
 * {
 *   subdomain: string
 * }
 */
router.post('/subdomain/check', async (req, res) => {
  try {
    const { subdomain } = req.body;
    
    if (!subdomain) {
      return res.status(400).json({
        ok: false,
        error: 'subdomain is required'
      });
    }
    
    // Validate subdomain format
    const subdomainRegex = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
    if (!subdomainRegex.test(subdomain)) {
      return res.json({
        ok: false,
        available: false,
        message: 'Invalid subdomain format. Use lowercase letters, numbers, and hyphens only.'
      });
    }
    
    if (subdomain.length < 3 || subdomain.length > 63) {
      return res.json({
        ok: false,
        available: false,
        message: 'Subdomain must be between 3 and 63 characters'
      });
    }
    
    // Check if reserved
    if (subdomains.has(subdomain)) {
      return res.json({
        ok: false,
        available: false,
        message: 'This subdomain is reserved'
      });
    }
    
    // Check if already taken
    for (const store of farmStores.values()) {
      if (store.domain.type === 'subdomain' && store.domain.subdomain === subdomain) {
        return res.json({
          ok: false,
          available: false,
          message: 'This subdomain is already taken'
        });
      }
    }
    
    res.json({
      ok: true,
      available: true,
      subdomain: subdomain,
      fullDomain: `${subdomain}.lightengine.app`,
      message: 'Subdomain is available'
    });
  } catch (error) {
    console.error('[farm-store] Subdomain check error:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to check subdomain availability',
      message: error.message
    });
  }
});

/**
 * POST /api/farm/store/domain/validate
 * 
 * Validate custom domain
 * 
 * Body:
 * {
 *   domain: string
 * }
 */
router.post('/domain/validate', async (req, res) => {
  try {
    const { domain } = req.body;
    
    if (!domain) {
      return res.status(400).json({
        ok: false,
        error: 'domain is required'
      });
    }
    
    // Validate domain format
    const domainRegex = /^[a-z0-9]+([\-\.]{1}[a-z0-9]+)*\.[a-z]{2,}$/i;
    if (!domainRegex.test(domain)) {
      return res.json({
        ok: false,
        valid: false,
        message: 'Invalid domain format'
      });
    }
    
    // In production, check DNS configuration here
    res.json({
      ok: true,
      valid: true,
      domain: domain,
      message: 'Domain format is valid',
      dnsInstructions: {
        recordType: 'CNAME',
        name: domain.split('.')[0] === 'www' ? 'www' : '@',
        value: 'stores.lightengine.app',
        ttl: 3600
      }
    });
  } catch (error) {
    console.error('[farm-store] Domain validation error:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to validate domain',
      message: error.message
    });
  }
});

/**
 * POST /api/farm/store/setup
 * 
 * Configure farm store
 * 
 * Body:
 * {
 *   farmId: string,
 *   domain: {
 *     type: 'subdomain' | 'custom',
 *     subdomain?: string,
 *     customDomain?: string
 *   },
 *   branding: {
 *     storeName: string,
 *     tagline: string,
 *     logo?: string,
 *     primaryColor: string,
 *     accentColor: string
 *   },
 *   settings: {
 *     allowPickup: boolean,
 *     allowDelivery: boolean,
 *     allowShipping: boolean,
 *     deliveryRadius: number,
 *     minOrderAmount: number,
 *     storeDescription: string,
 *     storeEmail: string,
 *     storePhone: string
 *   }
 * }
 */
router.post('/setup', async (req, res) => {
  try {
    const { farmId, domain, branding, settings } = req.body;
    
    if (!farmId || !domain || !branding) {
      return res.status(400).json({
        ok: false,
        error: 'farmId, domain, and branding are required'
      });
    }
    
    // Determine store URL
    let storeUrl;
    if (domain.type === 'subdomain') {
      storeUrl = `https://${domain.subdomain}.lightengine.app`;
      subdomains.add(domain.subdomain);
    } else {
      storeUrl = `https://${domain.customDomain}`;
    }
    
    const storeConfig = {
      farmId,
      domain,
      branding,
      settings: settings || {},
      url: storeUrl,
      status: 'configured',
      createdAt: new Date().toISOString(),
      launchedAt: null
    };
    
    farmStores.set(farmId, storeConfig);
    
    res.json({
      ok: true,
      message: 'Store configured successfully',
      data: {
        storeId: farmId,
        url: storeUrl,
        status: 'configured'
      }
    });
  } catch (error) {
    console.error('[farm-store] Setup error:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to configure store',
      message: error.message
    });
  }
});

/**
 * POST /api/farm/store/deploy
 * 
 * Deploy farm store to production
 * 
 * Body:
 * {
 *   farmId: string
 * }
 */
router.post('/deploy', async (req, res) => {
  try {
    const { farmId } = req.body;
    
    if (!farmId) {
      return res.status(400).json({
        ok: false,
        error: 'farmId is required'
      });
    }
    
    const store = farmStores.get(farmId);
    if (!store) {
      return res.status(404).json({
        ok: false,
        error: 'Store not configured. Please configure store first.'
      });
    }
    
    // Update store status
    store.status = 'live';
    store.launchedAt = new Date().toISOString();
    farmStores.set(farmId, store);
    
    // In production:
    // 1. Generate static store files with branding
    // 2. Configure CDN/hosting
    // 3. Set up SSL certificate
    // 4. Configure DNS (if custom domain)
    
    res.json({
      ok: true,
      message: 'Store deployed successfully',
      data: {
        storeId: farmId,
        url: store.url,
        status: 'live',
        launchedAt: store.launchedAt
      }
    });
  } catch (error) {
    console.error('[farm-store] Deploy error:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to deploy store',
      message: error.message
    });
  }
});

/**
 * POST /api/farm/store/update
 * 
 * Update store configuration
 */
router.post('/update', async (req, res) => {
  try {
    const { farmId, branding, settings } = req.body;
    
    if (!farmId) {
      return res.status(400).json({
        ok: false,
        error: 'farmId is required'
      });
    }
    
    const store = farmStores.get(farmId);
    if (!store) {
      return res.status(404).json({
        ok: false,
        error: 'Store not found'
      });
    }
    
    if (branding) {
      store.branding = { ...store.branding, ...branding };
    }
    
    if (settings) {
      store.settings = { ...store.settings, ...settings };
    }
    
    store.updatedAt = new Date().toISOString();
    farmStores.set(farmId, store);
    
    res.json({
      ok: true,
      message: 'Store updated successfully',
      data: store
    });
  } catch (error) {
    console.error('[farm-store] Update error:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to update store',
      message: error.message
    });
  }
});

/**
 * POST /api/farm/store/unpublish
 * 
 * Take store offline
 */
router.post('/unpublish', async (req, res) => {
  try {
    const { farmId } = req.body;
    
    if (!farmId) {
      return res.status(400).json({
        ok: false,
        error: 'farmId is required'
      });
    }
    
    const store = farmStores.get(farmId);
    if (!store) {
      return res.status(404).json({
        ok: false,
        error: 'Store not found'
      });
    }
    
    store.status = 'offline';
    store.unpublishedAt = new Date().toISOString();
    farmStores.set(farmId, store);
    
    res.json({
      ok: true,
      message: 'Store taken offline',
      data: {
        storeId: farmId,
        status: 'offline'
      }
    });
  } catch (error) {
    console.error('[farm-store] Unpublish error:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to unpublish store',
      message: error.message
    });
  }
});

export default router;
