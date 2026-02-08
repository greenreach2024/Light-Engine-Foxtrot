#!/usr/bin/env node
/**
 * Comprehensive Test Script
 * Tests buttons, data workflow, and greenreach sync
 */

import { chromium } from 'playwright';

const BASE_URL = process.env.LE_BASE_URL || 'http://52.90.57.85:8091';
const FARM_ID = process.env.LE_FARM_ID || 'FARM-TEST-WIZARD-001';
const PASSWORD = process.env.LE_PASSWORD || 'Grow123';
const EMAIL = process.env.LE_EMAIL || '';
const CENTRAL_URL = process.env.CENTRAL_URL || 'http://127.0.0.1:3100';

const results = {
  pageChecks: [],
  auth: [],
  buttons: [],
  dataWorkflow: [],
  sync: [],
  summary: { passed: 0, failed: 0, warnings: 0 }
};

function log(category, type, message, details = '') {
  const entry = { type, message, details, timestamp: new Date().toISOString() };
  results[category].push(entry);
  
  const icon = type === 'PASS' ? '✓' : type === 'FAIL' ? '✗' : '⚠';
  const detailStr = details ? ` | ${details}` : '';
  console.log(`${icon} [${category.toUpperCase()}] ${message}${detailStr}`);
  
  if (type === 'PASS') results.summary.passed++;
  else if (type === 'FAIL') results.summary.failed++;
  else if (type === 'WARN') results.summary.warnings++;
}

// ============================================================================
// 1. PAGE & AUTH CHECKS
// ============================================================================

async function testPageStatus(page) {
  console.log('\n=== PAGE STATUS CHECKS ===');
  
  const pages = [
    '/login.html',
    '/farm-admin-login.html',
    '/LE-farm-admin.html',
    '/LE-dashboard.html',
    '/views/farm-summary.html'
  ];
  
  for (const path of pages) {
    try {
      const response = await page.goto(`${BASE_URL}${path}`, { 
        waitUntil: 'domcontentloaded', 
        timeout: 15000 
      });
      const status = response ? response.status() : 0;
      
      if (status === 200) {
        log('pageChecks', 'PASS', `${path} → ${status}`);
      } else {
        log('pageChecks', 'FAIL', `${path} → ${status}`);
      }
    } catch (error) {
      log('pageChecks', 'FAIL', `${path} error`, error.message);
    }
  }
}

async function testAuth(page) {
  console.log('\n=== AUTHENTICATION ===');
  
  try {
    await page.goto(`${BASE_URL}/farm-admin-login.html`, { waitUntil: 'domcontentloaded' });
    
    await page.fill('#farmId', FARM_ID);
    if (EMAIL) {
      const emailField = await page.$('#email');
      if (emailField) await page.fill('#email', EMAIL);
    }
    await page.fill('#password', PASSWORD);
    await page.click('#loginBtn');
    
    await page.waitForTimeout(2000);
    
    const currentUrl = page.url();
    if (currentUrl.includes('LE-farm-admin.html')) {
      log('auth', 'PASS', 'Login successful', currentUrl);
      return true;
    } else {
      log('auth', 'FAIL', 'Login failed or redirected', currentUrl);
      return false;
    }
  } catch (error) {
    log('auth', 'FAIL', 'Login error', error.message);
    return false;
  }
}

// ============================================================================
// 2. BUTTON & NAVIGATION CHECKS
// ============================================================================

async function testButtons(page) {
  console.log('\n=== BUTTON TESTS ===');
  
  try {
    await page.goto(`${BASE_URL}/LE-farm-admin.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);
    
    // Test navigation buttons
    const navItems = await page.$$('.nav-item');
    log('buttons', 'PASS', `Found ${navItems.length} nav items`);
    
    const navLabels = ['Dashboard', 'Inventory', 'Admin', 'Setup'];
    for (const label of navLabels) {
      const navItem = await page.$(`text=${label}`);
      if (navItem) {
        await navItem.click();
        await page.waitForTimeout(500);
        log('buttons', 'PASS', `Clicked: ${label}`);
      } else {
        log('buttons', 'WARN', `Nav item not found: ${label}`);
      }
    }
    
    // Test refresh button
    const refreshBtn = await page.$('button:has-text("Refresh")');
    if (refreshBtn) {
      await refreshBtn.click();
      await page.waitForTimeout(500);
      log('buttons', 'PASS', 'Clicked: Refresh button');
    } else {
      log('buttons', 'WARN', 'Refresh button not found');
    }
    
  } catch (error) {
    log('buttons', 'FAIL', 'Button test error', error.message);
  }
}

// ============================================================================
// 3. DATA WORKFLOW CHECKS
// ============================================================================

async function testDataWorkflow() {
  console.log('\n=== DATA WORKFLOW ===');
  
  // Get auth token first
  let token = '';
  try {
    const loginResp = await fetch(`${BASE_URL}/api/farm/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ farmId: FARM_ID, password: PASSWORD, email: EMAIL || undefined })
    });
    const loginData = await loginResp.json();
    token = loginData.token || '';
    
    if (!token) {
      log('dataWorkflow', 'FAIL', 'No auth token received');
      return;
    }
    log('dataWorkflow', 'PASS', 'Auth token obtained', `${token.substring(0, 20)}...`);
  } catch (error) {
    log('dataWorkflow', 'FAIL', 'Auth token request failed', error.message);
    return;
  }
  
  // Test farm profile API
  try {
    const profileResp = await fetch(`${BASE_URL}/api/setup-wizard/farm-profile`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        farmName: 'Test Farm',
        location: 'Toronto, ON',
        farmSize: 'Small',
        timezone: 'America/Toronto',
        cropTypes: ['Leafy Greens']
      })
    });
    
    const profileData = await profileResp.json();
    if (profileData.farm || profileData.success) {
      log('dataWorkflow', 'PASS', 'Farm profile API working');
    } else {
      log('dataWorkflow', 'WARN', 'Farm profile response unexpected', JSON.stringify(profileData).substring(0, 100));
    }
  } catch (error) {
    log('dataWorkflow', 'FAIL', 'Farm profile API error', error.message);
  }
  
  // Test groups API (inventory data)
  try {
    const groupsResp = await fetch(`${BASE_URL}/api/groups`);
    const groupsData = await groupsResp.json();
    
    if (Array.isArray(groupsData)) {
      log('dataWorkflow', 'PASS', `Groups API returned ${groupsData.length} groups`);
    } else {
      log('dataWorkflow', 'WARN', 'Groups API response unexpected', typeof groupsData);
    }
  } catch (error) {
    log('dataWorkflow', 'FAIL', 'Groups API error', error.message);
  }
  
  // Test wholesale inventory API
  try {
    const inventoryResp = await fetch(`${BASE_URL}/api/wholesale/inventory`);
    const inventoryData = await inventoryResp.json();
    
    if (inventoryData.lots) {
      log('dataWorkflow', 'PASS', `Wholesale inventory returned ${inventoryData.lots.length} lots`);
    } else {
      log('dataWorkflow', 'WARN', 'Wholesale inventory response unexpected', JSON.stringify(inventoryData).substring(0, 100));
    }
  } catch (error) {
    log('dataWorkflow', 'FAIL', 'Wholesale inventory API error', error.message);
  }
}

// ============================================================================
// 4. GREENREACH CENTRAL SYNC
// ============================================================================

async function testGreenreachSync() {
  console.log('\n=== GREENREACH CENTRAL SYNC ===');
  
  // Test Central health
  try {
    const healthResp = await fetch(`${CENTRAL_URL}/health`, { timeout: 5000 });
    const healthData = await healthResp.json();
    
    if (healthData.status === 'healthy' || healthData.status === 'ok') {
      log('sync', 'PASS', 'Central health check', `${CENTRAL_URL}/health`);
    } else {
      log('sync', 'WARN', 'Central health unexpected', JSON.stringify(healthData));
    }
  } catch (error) {
    log('sync', 'FAIL', 'Central unreachable', `${CENTRAL_URL} - ${error.message}`);
    return;
  }
  
  // Test wholesale catalog endpoint
  try {
    const catalogResp = await fetch(`${CENTRAL_URL}/api/wholesale/catalog`, { timeout: 5000 });
    const catalogData = await catalogResp.json();
    
    if (catalogData.status === 'ok' || Array.isArray(catalogData)) {
      const itemCount = catalogData.items?.length || catalogData.length || 0;
      log('sync', 'PASS', `Central catalog API working`, `${itemCount} items`);
    } else {
      log('sync', 'WARN', 'Central catalog response unexpected', JSON.stringify(catalogData).substring(0, 100));
    }
  } catch (error) {
    log('sync', 'FAIL', 'Central catalog API error', error.message);
  }
  
  // Test network farms endpoint
  try {
    const farmsResp = await fetch(`${CENTRAL_URL}/api/wholesale/network/farms`, { timeout: 5000 });
    const farmsData = await farmsResp.json();
    
    if (farmsData.status === 'ok' || Array.isArray(farmsData)) {
      const farmCount = farmsData.farms?.length || farmsData.length || 0;
      log('sync', 'PASS', `Central farms API working`, `${farmCount} farms`);
    } else {
      log('sync', 'WARN', 'Central farms response unexpected', JSON.stringify(farmsData).substring(0, 100));
    }
  } catch (error) {
    log('sync', 'FAIL', 'Central farms API error', error.message);
  }
  
  // Test order event simulation (edge → central)
  try {
    const orderEventResp = await fetch(`${BASE_URL}/api/wholesale/order-events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Farm-ID': FARM_ID,
        'X-Farm-API-Key': 'test-api-key'
      },
      body: JSON.stringify({
        type: 'test_order_created',
        order_id: `TEST-${Date.now()}`,
        farm_id: FARM_ID,
        delivery_date: '2026-02-15',
        items: [{ sku_id: 'SKU-TEST-001', quantity: 1 }]
      })
    });
    
    const orderEventData = await orderEventResp.json();
    if (orderEventData.ok || orderEventData.status === 'ok') {
      log('sync', 'PASS', 'Order event webhook working');
    } else {
      log('sync', 'WARN', 'Order event response unexpected', JSON.stringify(orderEventData).substring(0, 100));
    }
  } catch (error) {
    log('sync', 'FAIL', 'Order event webhook error', error.message);
  }
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

async function runTests() {
  console.log('========================================');
  console.log('COMPREHENSIVE TEST SUITE');
  console.log(`Target: ${BASE_URL}`);
  console.log(`Central: ${CENTRAL_URL}`);
  console.log(`Farm: ${FARM_ID}`);
  console.log('========================================');
  
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  try {
    // 1. Page checks
    await testPageStatus(page);
    
    // 2. Auth
    const authenticated = await testAuth(page);
    
    // 3. Buttons (only if authenticated)
    if (authenticated) {
      await testButtons(page);
    }
    
    // 4. Data workflow (API tests)
    await testDataWorkflow();
    
    // 5. Greenreach sync
    await testGreenreachSync();
    
  } catch (error) {
    console.error('\n✗ CRITICAL ERROR:', error.message);
    results.summary.failed++;
  } finally {
    await browser.close();
  }
  
  // Print summary
  console.log('\n========================================');
  console.log('TEST SUMMARY');
  console.log('========================================');
  console.log(`✓ Passed:   ${results.summary.passed}`);
  console.log(`✗ Failed:   ${results.summary.failed}`);
  console.log(`⚠ Warnings: ${results.summary.warnings}`);
  console.log('========================================');
  
  // Exit code
  process.exit(results.summary.failed > 0 ? 1 : 0);
}

runTests().catch(error => {
  console.error('FATAL ERROR:', error);
  process.exit(1);
});
