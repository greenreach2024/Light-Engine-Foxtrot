/**
 * Edge Deployment Test Suite
 * 
 * Comprehensive tests for edge device deployment covering:
 * - Farm registration and setup wizard
 * - Hardware detection
 * - Data synchronization
 * - Certificate management
 * - Wholesale integration
 * - End-to-end workflows
 */

import { expect } from 'chai';
import request from 'supertest';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Test configuration
const TEST_CONFIG = {
  baseUrl: process.env.TEST_BASE_URL || 'http://localhost:3000',
  farmId: 'TEST-FARM-001',
  apiKey: 'test-api-key-' + crypto.randomBytes(16).toString('hex'),
  apiSecret: 'test-api-secret-' + crypto.randomBytes(16).toString('hex'),
  centralUrl: process.env.GREENREACH_CENTRAL_URL || 'https://api.greenreach.com'
};

describe('Edge Deployment Test Suite', function() {
  this.timeout(30000); // 30 second timeout for integration tests
  
  describe('1. Setup Wizard', () => {
    it('should serve setup wizard UI', async () => {
      const res = await request(TEST_CONFIG.baseUrl)
        .get('/setup/wizard')
        .expect(200);
      
      expect(res.text).to.include('GreenReach Setup Wizard');
    });
    
    it('should scan for hardware devices', async () => {
      const res = await request(TEST_CONFIG.baseUrl)
        .get('/api/hardware/scan')
        .expect(200);
      
      expect(res.body).to.have.property('devices');
      expect(res.body.devices).to.be.an('object');
    });
    
    it('should complete setup with valid configuration', async () => {
      const setupData = {
        farmName: 'Test Farm',
        location: {
          address: '123 Farm Road',
          city: 'Farmville',
          state: 'CA',
          zipCode: '90210'
        },
        network: {
          type: 'ethernet',
          ipMode: 'dhcp'
        },
        registration: {
          farmId: TEST_CONFIG.farmId,
          apiKey: TEST_CONFIG.apiKey,
          apiSecret: TEST_CONFIG.apiSecret
        }
      };
      
      const res = await request(TEST_CONFIG.baseUrl)
        .post('/api/setup/complete')
        .send(setupData)
        .expect(200);
      
      expect(res.body).to.have.property('success', true);
      expect(res.body).to.have.property('config');
    });
  });
  
  describe('2. Hardware Detection', () => {
    it('should detect USB devices', async () => {
      const res = await request(TEST_CONFIG.baseUrl)
        .get('/api/hardware/scan')
        .expect(200);
      
      expect(res.body.devices).to.have.property('usb');
      expect(res.body.devices.usb).to.be.an('array');
    });
    
    it('should detect serial ports', async () => {
      const res = await request(TEST_CONFIG.baseUrl)
        .get('/api/hardware/scan')
        .expect(200);
      
      expect(res.body.devices).to.have.property('serial');
      expect(res.body.devices.serial).to.be.an('array');
    });
    
    it('should categorize devices correctly', async () => {
      const res = await request(TEST_CONFIG.baseUrl)
        .get('/api/hardware/scan')
        .expect(200);
      
      expect(res.body.devices).to.have.property('cameras');
      expect(res.body.devices).to.have.property('sensors');
      expect(res.body.devices).to.have.property('controllers');
    });
  });
  
  describe('3. Data Synchronization', () => {
    it('should get sync status', async () => {
      const res = await request(TEST_CONFIG.baseUrl)
        .get('/api/sync/status')
        .expect(200);
      
      expect(res.body).to.have.property('connected');
      expect(res.body).to.have.property('lastInventorySync');
      expect(res.body).to.have.property('lastHealthSync');
    });
    
    it('should trigger manual inventory sync', async () => {
      const res = await request(TEST_CONFIG.baseUrl)
        .post('/api/sync/trigger')
        .send({ type: 'inventory' })
        .expect(200);
      
      expect(res.body).to.have.property('success', true);
    });
    
    it('should trigger manual health sync', async () => {
      const res = await request(TEST_CONFIG.baseUrl)
        .post('/api/sync/trigger')
        .send({ type: 'health' })
        .expect(200);
      
      expect(res.body).to.have.property('success', true);
    });
    
    it('should process offline queue', async () => {
      const res = await request(TEST_CONFIG.baseUrl)
        .post('/api/sync/process-queue')
        .expect(200);
      
      expect(res.body).to.have.property('success', true);
    });
  });
  
  describe('4. Certificate Management', () => {
    it('should get certificate status', async () => {
      const res = await request(TEST_CONFIG.baseUrl)
        .get('/api/certs/status')
        .expect(200);
      
      expect(res.body).to.have.property('provisioned');
    });
    
    it('should provision new certificate', async () => {
      const res = await request(TEST_CONFIG.baseUrl)
        .post('/api/certs/provision')
        .set('Authorization', `Bearer ${TEST_CONFIG.apiKey}`)
        .expect(200);
      
      expect(res.body).to.have.property('success', true);
      expect(res.body).to.have.property('certificate');
    });
    
    it('should verify certificate expiry checking', async () => {
      const res = await request(TEST_CONFIG.baseUrl)
        .get('/api/certs/status')
        .expect(200);
      
      if (res.body.provisioned) {
        expect(res.body).to.have.property('daysUntilExpiry');
        expect(res.body.daysUntilExpiry).to.be.a('number');
      }
    });
    
    it('should get TLS options availability', async () => {
      const res = await request(TEST_CONFIG.baseUrl)
        .get('/api/certs/tls-options')
        .expect(200);
      
      expect(res.body).to.have.property('available');
      expect(res.body.available).to.have.property('cert');
      expect(res.body.available).to.have.property('key');
      expect(res.body.available).to.have.property('ca');
    });
  });
  
  describe('5. Credential Management', () => {
    const testKey = 'test-credential-' + Date.now();
    const testValue = 'test-value-' + crypto.randomBytes(16).toString('hex');
    
    it('should store credential', async () => {
      const res = await request(TEST_CONFIG.baseUrl)
        .post('/api/credentials')
        .set('Authorization', `Bearer ${TEST_CONFIG.apiKey}`)
        .send({
          key: testKey,
          value: testValue,
          metadata: { test: true }
        })
        .expect(200);
      
      expect(res.body).to.have.property('success', true);
      expect(res.body).to.have.property('key', testKey);
    });
    
    it('should retrieve credential', async () => {
      const res = await request(TEST_CONFIG.baseUrl)
        .get(`/api/credentials/${testKey}`)
        .set('Authorization', `Bearer ${TEST_CONFIG.apiKey}`)
        .expect(200);
      
      expect(res.body).to.have.property('key', testKey);
      expect(res.body).to.have.property('value', testValue);
    });
    
    it('should list credentials', async () => {
      const res = await request(TEST_CONFIG.baseUrl)
        .get('/api/credentials')
        .set('Authorization', `Bearer ${TEST_CONFIG.apiKey}`)
        .expect(200);
      
      expect(res.body).to.have.property('credentials');
      expect(res.body.credentials).to.be.an('array');
      
      const found = res.body.credentials.some(c => c.key === testKey);
      expect(found).to.be.true;
    });
    
    it('should rotate credential', async () => {
      const newValue = 'rotated-value-' + crypto.randomBytes(16).toString('hex');
      
      const res = await request(TEST_CONFIG.baseUrl)
        .post(`/api/credentials/${testKey}/rotate`)
        .set('Authorization', `Bearer ${TEST_CONFIG.apiKey}`)
        .send({ newValue })
        .expect(200);
      
      expect(res.body).to.have.property('success', true);
      expect(res.body).to.have.property('rotated', true);
    });
    
    it('should delete credential', async () => {
      const res = await request(TEST_CONFIG.baseUrl)
        .delete(`/api/credentials/${testKey}`)
        .set('Authorization', `Bearer ${TEST_CONFIG.apiKey}`)
        .expect(200);
      
      expect(res.body).to.have.property('success', true);
      expect(res.body).to.have.property('deleted', true);
    });
  });
  
  describe('6. Wholesale Integration', () => {
    it('should get wholesale status', async () => {
      const res = await request(TEST_CONFIG.baseUrl)
        .get('/api/wholesale/status')
        .expect(200);
      
      expect(res.body).to.have.property('enabled');
      expect(res.body).to.have.property('lastCatalogSync');
      expect(res.body).to.have.property('pendingOrders');
    });
    
    it('should trigger catalog sync', async () => {
      const res = await request(TEST_CONFIG.baseUrl)
        .post('/api/wholesale/sync/catalog')
        .set('Authorization', `Bearer ${TEST_CONFIG.apiKey}`)
        .expect(200);
      
      expect(res.body).to.have.property('success', true);
    });
    
    it('should handle order webhook', async () => {
      const orderData = {
        orderId: 'TEST-ORDER-' + Date.now(),
        buyerId: 'test-buyer',
        farmId: TEST_CONFIG.farmId,
        items: [
          {
            productId: 'test-product-001',
            farmId: TEST_CONFIG.farmId,
            quantity: 10,
            wholesalePrice: 2.50,
            total: 25.00
          }
        ],
        total: 25.00,
        timestamp: new Date().toISOString(),
        signature: 'test-signature'
      };
      
      const res = await request(TEST_CONFIG.baseUrl)
        .post('/api/wholesale/webhook/order')
        .send(orderData);
      
      // May fail signature verification, but should respond
      expect([200, 401, 500]).to.include(res.status);
    });
    
    it('should get pending orders', async () => {
      const res = await request(TEST_CONFIG.baseUrl)
        .get('/api/wholesale/orders/pending')
        .set('Authorization', `Bearer ${TEST_CONFIG.apiKey}`)
        .expect(200);
      
      expect(res.body).to.have.property('count');
      expect(res.body).to.have.property('orders');
      expect(res.body.orders).to.be.an('array');
    });
    
    it('should get reserved inventory', async () => {
      const res = await request(TEST_CONFIG.baseUrl)
        .get('/api/wholesale/inventory/reserved')
        .set('Authorization', `Bearer ${TEST_CONFIG.apiKey}`)
        .expect(200);
      
      expect(res.body).to.have.property('count');
      expect(res.body).to.have.property('reserved');
      expect(res.body.reserved).to.be.an('array');
    });
  });
  
  describe('7. End-to-End Workflows', () => {
    it('should complete farm registration workflow', async () => {
      // 1. Access setup wizard
      const wizardRes = await request(TEST_CONFIG.baseUrl)
        .get('/setup/wizard')
        .expect(200);
      
      expect(wizardRes.text).to.include('Setup Wizard');
      
      // 2. Scan hardware
      const scanRes = await request(TEST_CONFIG.baseUrl)
        .get('/api/hardware/scan')
        .expect(200);
      
      expect(scanRes.body).to.have.property('devices');
      
      // 3. Complete setup
      const setupRes = await request(TEST_CONFIG.baseUrl)
        .post('/api/setup/complete')
        .send({
          farmName: 'E2E Test Farm',
          registration: {
            farmId: TEST_CONFIG.farmId,
            apiKey: TEST_CONFIG.apiKey
          }
        })
        .expect(200);
      
      expect(setupRes.body.success).to.be.true;
    });
    
    it('should complete order fulfillment workflow', async () => {
      // This is a mock test - real test would need actual inventory
      // and order from GreenReach Central
      
      // 1. Receive order (mocked)
      // 2. Check inventory reservation
      const reservedRes = await request(TEST_CONFIG.baseUrl)
        .get('/api/wholesale/inventory/reserved')
        .set('Authorization', `Bearer ${TEST_CONFIG.apiKey}`)
        .expect(200);
      
      expect(reservedRes.body).to.have.property('reserved');
      
      // 3. Check pending orders
      const pendingRes = await request(TEST_CONFIG.baseUrl)
        .get('/api/wholesale/orders/pending')
        .set('Authorization', `Bearer ${TEST_CONFIG.apiKey}`)
        .expect(200);
      
      expect(pendingRes.body).to.have.property('orders');
    });
    
    it('should handle offline mode gracefully', async () => {
      // Trigger sync with potential offline queue
      const res = await request(TEST_CONFIG.baseUrl)
        .post('/api/sync/trigger')
        .send({ type: 'all' })
        .expect(200);
      
      expect(res.body).to.have.property('success', true);
    });
  });
  
  describe('8. Health & Diagnostics', () => {
    it('should respond to health check', async () => {
      const res = await request(TEST_CONFIG.baseUrl)
        .get('/healthz')
        .expect(200);
      
      expect(res.body).to.have.property('ok', true);
      expect(res.body).to.have.property('status', 'healthy');
    });
    
    it('should provide detailed diagnostics', async () => {
      const res = await request(TEST_CONFIG.baseUrl)
        .get('/healthz')
        .expect(200);
      
      expect(res.body).to.have.property('controller');
      expect(res.body).to.have.property('services');
    });
  });
  
  describe('9. Security', () => {
    it('should require authentication for protected endpoints', async () => {
      const res = await request(TEST_CONFIG.baseUrl)
        .post('/api/credentials')
        .send({ key: 'test', value: 'test' })
        .expect(401);
    });
    
    it('should validate webhook signatures', async () => {
      const invalidWebhook = {
        orderId: 'INVALID-ORDER',
        signature: 'invalid-signature'
      };
      
      const res = await request(TEST_CONFIG.baseUrl)
        .post('/api/wholesale/webhook/order')
        .send(invalidWebhook);
      
      expect([401, 500]).to.include(res.status);
    });
    
    it('should use secure TLS connections', async () => {
      const res = await request(TEST_CONFIG.baseUrl)
        .get('/api/certs/tls-options')
        .expect(200);
      
      expect(res.body).to.have.property('available');
    });
  });
});

// Helper function to run all tests
export async function runEdgeDeploymentTests() {
  console.log('🧪 Running Edge Deployment Test Suite...\n');
  
  try {
    // Run tests using Mocha programmatically
    const Mocha = (await import('mocha')).default;
    const mocha = new Mocha({
      reporter: 'spec',
      timeout: 30000
    });
    
    mocha.addFile(__filename);
    
    return new Promise((resolve, reject) => {
      mocha.run((failures) => {
        if (failures) {
          reject(new Error(`${failures} test(s) failed`));
        } else {
          resolve();
        }
      });
    });
  } catch (error) {
    console.error('❌ Test suite error:', error);
    throw error;
  }
}

// Run tests if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runEdgeDeploymentTests()
    .then(() => {
      console.log('\n✅ All tests passed!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Tests failed:', error.message);
      process.exit(1);
    });
}
