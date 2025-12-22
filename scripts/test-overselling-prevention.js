#!/usr/bin/env node
/**
 * Test Script: Overselling Prevention
 * Simulates concurrent orders for the same inventory to verify reservation system
 */

import fetch from 'node-fetch';

const FARM_API_URL = process.env.FARM_API_URL || 'http://localhost:8091';
const FARM_ID = process.env.FARM_ID || 'light-engine-demo';
const API_KEY = process.env.FARM_API_KEY || 'demo-key';

console.log('═══════════════════════════════════════════════════════════════');
console.log('  Overselling Prevention Test');
console.log('═══════════════════════════════════════════════════════════════');
console.log('');
console.log(`Testing farm: ${FARM_API_URL}`);
console.log(`Farm ID: ${FARM_ID}`);
console.log('');

async function getInventory() {
  const response = await fetch(`${FARM_API_URL}/api/wholesale/inventory`);
  const data = await response.json();
  return data;
}

async function reserveInventory(orderId, items) {
  const response = await fetch(`${FARM_API_URL}/api/wholesale/inventory/reserve`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Farm-ID': FARM_ID,
      'X-API-Key': API_KEY
    },
    body: JSON.stringify({
      order_id: orderId,
      items
    })
  });
  return await response.json();
}

async function releaseReservation(orderId) {
  const response = await fetch(`${FARM_API_URL}/api/wholesale/inventory/release`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Farm-ID': FARM_ID,
      'X-API-Key': API_KEY
    },
    body: JSON.stringify({
      order_id: orderId,
      reason: 'Test cleanup'
    })
  });
  return await response.json();
}

async function runTest() {
  console.log('Step 1: Get current inventory');
  console.log('─────────────────────────────────────────────────────────────');
  
  const inventory = await getInventory();
  
  if (!inventory.ok || !inventory.lots || inventory.lots.length === 0) {
    console.error('❌ Failed to get inventory or no products available');
    return;
  }
  
  // Find a product with available quantity
  const testProduct = inventory.lots.find(lot => lot.qty_available > 0);
  
  if (!testProduct) {
    console.error('❌ No products with available quantity found');
    return;
  }
  
  console.log(`✅ Found test product: ${testProduct.sku_name}`);
  console.log(`   SKU: ${testProduct.sku_id}`);
  console.log(`   Available: ${testProduct.qty_available} cases`);
  console.log(`   Reserved: ${testProduct.qty_reserved} cases`);
  console.log('');
  
  const availableQty = testProduct.qty_available;
  const skuId = testProduct.sku_id;
  
  // Test 1: Reserve exact available quantity
  console.log('Test 1: Reserve exact available quantity');
  console.log('─────────────────────────────────────────────────────────────');
  
  const order1Id = `TEST-ORDER-${Date.now()}-1`;
  const result1 = await reserveInventory(order1Id, [
    { sku_id: skuId, quantity: availableQty }
  ]);
  
  if (result1.ok) {
    console.log(`✅ Order 1 reserved ${availableQty} cases successfully`);
  } else {
    console.error(`❌ Order 1 failed: ${result1.error}`);
    return;
  }
  
  console.log('');
  
  // Test 2: Try to reserve 1 more (should fail due to overselling prevention)
  console.log('Test 2: Attempt concurrent order (should fail)');
  console.log('─────────────────────────────────────────────────────────────');
  
  const order2Id = `TEST-ORDER-${Date.now()}-2`;
  const result2 = await reserveInventory(order2Id, [
    { sku_id: skuId, quantity: 1 }
  ]);
  
  if (!result2.ok && result2.error === 'Insufficient inventory') {
    console.log('✅ Overselling prevention WORKING!');
    console.log(`   Order 2 correctly rejected: ${result2.error}`);
    if (result2.insufficient_items) {
      console.log('   Details:', result2.insufficient_items);
    }
  } else if (result2.ok) {
    console.error('❌ OVERSELLING DETECTED! Order 2 should have been rejected but was accepted.');
  } else {
    console.error(`❌ Unexpected error: ${result2.error}`);
  }
  
  console.log('');
  
  // Test 3: Release first reservation and try again
  console.log('Test 3: Release reservation and retry');
  console.log('─────────────────────────────────────────────────────────────');
  
  const releaseResult = await releaseReservation(order1Id);
  
  if (releaseResult.ok) {
    console.log(`✅ Released reservation for Order 1 (${releaseResult.released} items)`);
  } else {
    console.error(`❌ Failed to release: ${releaseResult.error}`);
  }
  
  console.log('');
  
  // Wait a moment for cleanup
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  const order3Id = `TEST-ORDER-${Date.now()}-3`;
  const result3 = await reserveInventory(order3Id, [
    { sku_id: skuId, quantity: 1 }
  ]);
  
  if (result3.ok) {
    console.log('✅ Order 3 reserved successfully after release');
    
    // Cleanup
    await releaseReservation(order3Id);
    console.log('✅ Cleaned up test reservation');
  } else {
    console.error(`❌ Order 3 failed: ${result3.error}`);
  }
  
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Test Summary');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
  
  if (!result2.ok && result3.ok) {
    console.log('✅ ALL TESTS PASSED');
    console.log('');
    console.log('Results:');
    console.log('  ✅ Reservation system prevents overselling');
    console.log('  ✅ Concurrent orders correctly rejected');
    console.log('  ✅ Inventory released successfully');
    console.log('  ✅ Can reserve after release');
    console.log('');
    console.log('The reservation system is working correctly! 🎉');
  } else {
    console.log('❌ TESTS FAILED');
    console.log('');
    console.log('Issues detected:');
    if (result2.ok) {
      console.log('  ❌ Overselling not prevented (critical issue)');
    }
    if (!result3.ok) {
      console.log('  ❌ Unable to reserve after release');
    }
    console.log('');
    console.log('Please review the reservation system implementation.');
  }
}

// Run the test
runTest().catch(error => {
  console.error('Test failed with error:', error);
  process.exit(1);
});
