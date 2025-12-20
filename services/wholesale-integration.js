/**
 * Wholesale Integration Service
 * 
 * Integrates edge device inventory with GreenReach Central wholesale catalog.
 * Handles automatic catalog updates, order webhooks, and fulfillment notifications.
 * 
 * Features:
 * - Automatic catalog sync (inventory → wholesale catalog)
 * - Order webhook handling (wholesale orders → local records)
 * - Inventory reservation on order placement
 * - Fulfillment notifications (status updates → central)
 * - Multi-farm order support
 * - Event-based architecture for monitoring
 */

import EventEmitter from 'events';
import https from 'https';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

class WholesaleIntegrationService extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.centralUrl = options.centralUrl || process.env.GREENREACH_CENTRAL_URL || 'https://api.greenreach.com';
    this.farmId = options.farmId || process.env.FARM_ID;
    this.apiKey = options.apiKey || process.env.GREENREACH_API_KEY;
    this.apiSecret = options.apiSecret || process.env.GREENREACH_API_SECRET;
    
    // Farm certifications and attributes
    this.farmCertifications = options.farmCertifications || [];
    this.farmPractices = options.farmPractices || [];
    this.farmAttributes = options.farmAttributes || [];
    
    // Certificate manager for mTLS
    this.certificateManager = options.certificateManager;
    
    // Database connections
    this.inventoryDB = options.inventoryDB;
    this.ordersDB = options.ordersDB;
    
    // Sync intervals (milliseconds)
    this.catalogSyncInterval = options.catalogSyncInterval || 5 * 60 * 1000; // 5 minutes
    this.priceSyncInterval = options.priceSyncInterval || 15 * 60 * 1000; // 15 minutes
    
    // State tracking
    this.state = {
      lastCatalogSync: null,
      lastPriceSync: null,
      pendingOrders: [],
      reservedInventory: new Map(), // productId -> reservedQuantity
      syncEnabled: true
    };
    
    // Timers
    this.catalogTimer = null;
    this.priceTimer = null;
    
    console.log('[wholesale] Integration service created');
  }
  
  /**
   * Initialize wholesale integration
   */
  async initialize() {
    console.log('[wholesale] Initializing integration service...');
    
    try {
      // Load state from disk
      await this.loadState();
      
      // Start automatic sync
      this.startAutomaticSync();
      
      // Initial catalog sync
      await this.syncCatalog();
      
      this.emit('initialized');
      console.log('[wholesale] Integration service initialized');
    } catch (error) {
      console.error('[wholesale] Initialization error:', error);
      this.emit('error', error);
      throw error;
    }
  }
  
  /**
   * Start automatic synchronization
   */
  startAutomaticSync() {
    if (!this.state.syncEnabled) {
      console.log('[wholesale] Automatic sync disabled');
      return;
    }
    
    // Catalog sync
    this.catalogTimer = setInterval(() => {
      this.syncCatalog().catch(err => {
        console.error('[wholesale] Catalog sync error:', err);
        this.emit('sync_error', { type: 'catalog', error: err });
      });
    }, this.catalogSyncInterval);
    
    // Price sync
    this.priceTimer = setInterval(() => {
      this.syncPrices().catch(err => {
        console.error('[wholesale] Price sync error:', err);
        this.emit('sync_error', { type: 'pricing', error: err });
      });
    }, this.priceSyncInterval);
    
    console.log('[wholesale] Automatic sync started');
  }
  
  /**
   * Stop automatic synchronization
   */
  stopAutomaticSync() {
    if (this.catalogTimer) {
      clearInterval(this.catalogTimer);
      this.catalogTimer = null;
    }
    
    if (this.priceTimer) {
      clearInterval(this.priceTimer);
      this.priceTimer = null;
    }
    
    console.log('[wholesale] Automatic sync stopped');
  }
  
  /**
   * Sync farm inventory to wholesale catalog
   */
  async syncCatalog() {
    console.log('[wholesale] Syncing catalog...');
    
    try {
      // Get current inventory
      const inventory = await this.getInventory();
      
      if (!inventory || inventory.length === 0) {
        console.log('[wholesale] No inventory to sync');
        this.state.lastCatalogSync = Date.now();
        return;
      }
      
      // Transform inventory to catalog format
      const catalogItems = inventory.map(item => this.transformInventoryToCatalog(item));
      
      // Send to GreenReach Central
      const response = await this.makeRequest('/api/wholesale/catalog/sync', {
        method: 'POST',
        body: {
          farmId: this.farmId,
          items: catalogItems,
          timestamp: new Date().toISOString()
        }
      });
      
      this.state.lastCatalogSync = Date.now();
      await this.saveState();
      
      this.emit('catalog_synced', { count: catalogItems.length, response });
      console.log(`[wholesale] Catalog synced: ${catalogItems.length} items`);
      
      return response;
    } catch (error) {
      console.error('[wholesale] Catalog sync error:', error);
      this.emit('sync_error', { type: 'catalog', error });
      throw error;
    }
  }
  
  /**
   * Sync pricing information
   */
  async syncPrices() {
    console.log('[wholesale] Syncing prices...');
    
    try {
      // Get current pricing
      const inventory = await this.getInventory();
      
      if (!inventory || inventory.length === 0) {
        console.log('[wholesale] No pricing to sync');
        this.state.lastPriceSync = Date.now();
        return;
      }
      
      // Extract pricing data
      const pricing = inventory.map(item => ({
        productId: item.id || item.productId,
        sku: item.sku,
        wholesalePrice: item.wholesalePrice || item.price * 0.7, // 30% discount
        retailPrice: item.price,
        bulkPricing: item.bulkPricing || [],
        currency: 'USD'
      }));
      
      // Send to GreenReach Central
      const response = await this.makeRequest('/api/wholesale/pricing/sync', {
        method: 'POST',
        body: {
          farmId: this.farmId,
          pricing: pricing,
          timestamp: new Date().toISOString()
        }
      });
      
      this.state.lastPriceSync = Date.now();
      await this.saveState();
      
      this.emit('pricing_synced', { count: pricing.length, response });
      console.log(`[wholesale] Pricing synced: ${pricing.length} items`);
      
      return response;
    } catch (error) {
      console.error('[wholesale] Price sync error:', error);
      this.emit('sync_error', { type: 'pricing', error });
      throw error;
    }
  }
  
  /**
   * Transform inventory item to catalog format
   */
  transformInventoryToCatalog(item) {
    // Calculate available quantity (total - reserved)
    const reserved = this.state.reservedInventory.get(item.id) || 0;
    const available = Math.max(0, (item.quantity || 0) - reserved);
    
    return {
      productId: item.id || item.productId,
      farmId: this.farmId,
      name: item.name,
      category: item.category || 'produce',
      sku: item.sku,
      quantity: available,
      unit: item.unit || 'lb',
      wholesalePrice: item.wholesalePrice || item.price * 0.7,
      retailPrice: item.price,
      organic: item.organic || false,
      harvestDate: item.harvestDate || new Date().toISOString(),
      shelfLife: item.shelfLife || 7, // days
      images: item.images || [],
      description: item.description || '',
      certifications: item.certifications || [],
      farmCertifications: this.farmCertifications || [],
      farmPractices: this.farmPractices || [],
      farmAttributes: this.farmAttributes || [],
      available: available > 0,
      lastUpdated: new Date().toISOString()
    };
  }
  
  /**
   * Handle incoming wholesale order webhook
   */
  async handleOrderWebhook(orderData) {
    console.log('[wholesale] Handling order webhook:', orderData.orderId);
    
    try {
      // Verify webhook signature
      if (!this.verifyWebhookSignature(orderData)) {
        throw new Error('Invalid webhook signature');
      }
      
      // Check if order already exists
      const existingOrder = await this.getOrder(orderData.orderId);
      if (existingOrder) {
        console.log('[wholesale] Order already exists:', orderData.orderId);
        return existingOrder;
      }
      
      // Create local order record
      const order = await this.createOrder(orderData);
      
      // Reserve inventory
      await this.reserveInventory(order);
      
      // Add to pending orders
      this.state.pendingOrders.push(order.id);
      await this.saveState();
      
      this.emit('order_received', order);
      console.log('[wholesale] Order created:', order.id);
      
      return order;
    } catch (error) {
      console.error('[wholesale] Order webhook error:', error);
      this.emit('order_error', { orderId: orderData.orderId, error });
      throw error;
    }
  }
  
  /**
   * Reserve inventory for an order
   */
  async reserveInventory(order) {
    console.log('[wholesale] Reserving inventory for order:', order.id);
    
    try {
      for (const item of order.items) {
        // Check if farm has this item
        if (item.farmId !== this.farmId) {
          continue; // Skip items from other farms
        }
        
        // Get current inventory
        const inventoryItem = await this.getInventoryItem(item.productId);
        
        if (!inventoryItem) {
          throw new Error(`Product not found: ${item.productId}`);
        }
        
        // Check available quantity
        const reserved = this.state.reservedInventory.get(item.productId) || 0;
        const available = inventoryItem.quantity - reserved;
        
        if (available < item.quantity) {
          throw new Error(`Insufficient inventory for ${item.productId}: available ${available}, requested ${item.quantity}`);
        }
        
        // Reserve inventory
        this.state.reservedInventory.set(item.productId, reserved + item.quantity);
        
        console.log(`[wholesale] Reserved ${item.quantity} ${inventoryItem.unit} of ${item.productId}`);
      }
      
      await this.saveState();
      
      this.emit('inventory_reserved', { orderId: order.id, items: order.items });
    } catch (error) {
      console.error('[wholesale] Inventory reservation error:', error);
      this.emit('reservation_error', { orderId: order.id, error });
      throw error;
    }
  }
  
  /**
   * Release reserved inventory
   */
  async releaseInventory(order) {
    console.log('[wholesale] Releasing inventory for order:', order.id);
    
    try {
      for (const item of order.items) {
        if (item.farmId !== this.farmId) {
          continue;
        }
        
        const reserved = this.state.reservedInventory.get(item.productId) || 0;
        const newReserved = Math.max(0, reserved - item.quantity);
        
        this.state.reservedInventory.set(item.productId, newReserved);
        
        console.log(`[wholesale] Released ${item.quantity} units of ${item.productId}`);
      }
      
      await this.saveState();
      
      this.emit('inventory_released', { orderId: order.id });
    } catch (error) {
      console.error('[wholesale] Inventory release error:', error);
      throw error;
    }
  }
  
  /**
   * Mark order as fulfilled
   */
  async fulfillOrder(orderId, fulfillmentData = {}) {
    console.log('[wholesale] Fulfilling order:', orderId);
    
    try {
      // Get order
      const order = await this.getOrder(orderId);
      
      if (!order) {
        throw new Error(`Order not found: ${orderId}`);
      }
      
      // Update order status
      order.status = 'fulfilled';
      order.fulfilledAt = new Date().toISOString();
      order.trackingNumber = fulfillmentData.trackingNumber;
      order.carrier = fulfillmentData.carrier;
      order.shippingLabel = fulfillmentData.shippingLabel;
      
      await this.updateOrder(order);
      
      // Deduct from actual inventory
      await this.deductInventory(order);
      
      // Release reservations
      await this.releaseInventory(order);
      
      // Remove from pending orders
      this.state.pendingOrders = this.state.pendingOrders.filter(id => id !== orderId);
      await this.saveState();
      
      // Send fulfillment notification to GreenReach Central
      await this.sendFulfillmentNotification(order);
      
      this.emit('order_fulfilled', order);
      console.log('[wholesale] Order fulfilled:', orderId);
      
      return order;
    } catch (error) {
      console.error('[wholesale] Fulfillment error:', error);
      this.emit('fulfillment_error', { orderId, error });
      throw error;
    }
  }
  
  /**
   * Cancel order
   */
  async cancelOrder(orderId, reason = '') {
    console.log('[wholesale] Canceling order:', orderId);
    
    try {
      const order = await this.getOrder(orderId);
      
      if (!order) {
        throw new Error(`Order not found: ${orderId}`);
      }
      
      // Update order status
      order.status = 'canceled';
      order.canceledAt = new Date().toISOString();
      order.cancelReason = reason;
      
      await this.updateOrder(order);
      
      // Release inventory
      await this.releaseInventory(order);
      
      // Remove from pending orders
      this.state.pendingOrders = this.state.pendingOrders.filter(id => id !== orderId);
      await this.saveState();
      
      // Notify GreenReach Central
      await this.sendCancellationNotification(order);
      
      this.emit('order_canceled', order);
      console.log('[wholesale] Order canceled:', orderId);
      
      return order;
    } catch (error) {
      console.error('[wholesale] Cancellation error:', error);
      throw error;
    }
  }
  
  /**
   * Send fulfillment notification to GreenReach Central
   */
  async sendFulfillmentNotification(order) {
    console.log('[wholesale] Sending fulfillment notification:', order.id);
    
    try {
      const response = await this.makeRequest(`/api/wholesale/orders/${order.id}/fulfill`, {
        method: 'POST',
        body: {
          farmId: this.farmId,
          orderId: order.id,
          status: 'fulfilled',
          fulfilledAt: order.fulfilledAt,
          trackingNumber: order.trackingNumber,
          carrier: order.carrier,
          items: order.items
        }
      });
      
      this.emit('fulfillment_notified', { orderId: order.id, response });
      console.log('[wholesale] Fulfillment notification sent:', order.id);
      
      return response;
    } catch (error) {
      console.error('[wholesale] Fulfillment notification error:', error);
      throw error;
    }
  }
  
  /**
   * Send cancellation notification to GreenReach Central
   */
  async sendCancellationNotification(order) {
    console.log('[wholesale] Sending cancellation notification:', order.id);
    
    try {
      const response = await this.makeRequest(`/api/wholesale/orders/${order.id}/cancel`, {
        method: 'POST',
        body: {
          farmId: this.farmId,
          orderId: order.id,
          status: 'canceled',
          canceledAt: order.canceledAt,
          reason: order.cancelReason
        }
      });
      
      this.emit('cancellation_notified', { orderId: order.id, response });
      console.log('[wholesale] Cancellation notification sent:', order.id);
      
      return response;
    } catch (error) {
      console.error('[wholesale] Cancellation notification error:', error);
      throw error;
    }
  }
  
  /**
   * Verify webhook signature
   */
  verifyWebhookSignature(data) {
    if (!data.signature || !data.timestamp) {
      return false;
    }
    
    // Create signature
    const payload = JSON.stringify({
      orderId: data.orderId,
      timestamp: data.timestamp
    });
    
    const hmac = crypto.createHmac('sha256', this.apiSecret);
    hmac.update(payload);
    const expectedSignature = hmac.digest('hex');
    
    // Constant-time comparison
    return crypto.timingSafeEqual(
      Buffer.from(data.signature),
      Buffer.from(expectedSignature)
    );
  }
  
  /**
   * Make authenticated request to GreenReach Central
   */
  async makeRequest(endpoint, options = {}) {
    const url = new URL(endpoint, this.centralUrl);
    
    // Get TLS options if certificate manager available
    let tlsOptions = {};
    if (this.certificateManager) {
      try {
        tlsOptions = this.certificateManager.getTLSOptions();
      } catch (err) {
        console.warn('[wholesale] TLS options not available:', err.message);
      }
    }
    
    const requestOptions = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
        'X-Farm-ID': this.farmId,
        'X-API-Secret': this.apiSecret,
        ...options.headers
      },
      ...tlsOptions
    };
    
    return new Promise((resolve, reject) => {
      const req = https.request(requestOptions, (res) => {
        let data = '';
        
        res.on('data', chunk => {
          data += chunk;
        });
        
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(data));
            } catch (err) {
              resolve(data);
            }
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          }
        });
      });
      
      req.on('error', reject);
      
      if (options.body) {
        req.write(JSON.stringify(options.body));
      }
      
      req.end();
    });
  }
  
  // Database operations (to be implemented with actual DB)
  
  async getInventory() {
    // TODO: Implement with actual inventory database
    return this.inventoryDB ? await this.inventoryDB.find({}) : [];
  }
  
  async getInventoryItem(productId) {
    // TODO: Implement with actual inventory database
    return this.inventoryDB ? await this.inventoryDB.findOne({ id: productId }) : null;
  }
  
  async deductInventory(order) {
    // TODO: Implement with actual inventory database
    for (const item of order.items) {
      if (item.farmId === this.farmId && this.inventoryDB) {
        await this.inventoryDB.update(
          { id: item.productId },
          { $inc: { quantity: -item.quantity } }
        );
      }
    }
  }
  
  async getOrder(orderId) {
    // TODO: Implement with actual orders database
    return this.ordersDB ? await this.ordersDB.findOne({ id: orderId }) : null;
  }
  
  async createOrder(orderData) {
    // TODO: Implement with actual orders database
    const order = {
      id: orderData.orderId,
      farmId: this.farmId,
      buyerId: orderData.buyerId,
      items: orderData.items,
      total: orderData.total,
      status: 'pending',
      createdAt: new Date().toISOString(),
      ...orderData
    };
    
    if (this.ordersDB) {
      await this.ordersDB.insert(order);
    }
    
    return order;
  }
  
  async updateOrder(order) {
    // TODO: Implement with actual orders database
    if (this.ordersDB) {
      await this.ordersDB.update({ id: order.id }, order);
    }
    return order;
  }
  
  // State persistence
  
  async loadState() {
    // TODO: Implement state loading from disk
    console.log('[wholesale] State loading not yet implemented');
  }
  
  async saveState() {
    // TODO: Implement state saving to disk
    // console.log('[wholesale] State saving not yet implemented');
  }
  
  /**
   * Get service status
   */
  getStatus() {
    return {
      enabled: this.state.syncEnabled,
      lastCatalogSync: this.state.lastCatalogSync,
      lastPriceSync: this.state.lastPriceSync,
      pendingOrders: this.state.pendingOrders.length,
      reservedItems: this.state.reservedInventory.size,
      catalogSyncInterval: this.catalogSyncInterval,
      priceSyncInterval: this.priceSyncInterval
    };
  }
  
  /**
   * Enable automatic sync
   */
  enable() {
    this.state.syncEnabled = true;
    this.startAutomaticSync();
    this.emit('enabled');
  }
  
  /**
   * Disable automatic sync
   */
  disable() {
    this.state.syncEnabled = false;
    this.stopAutomaticSync();
    this.emit('disabled');
  }
}

export default WholesaleIntegrationService;
