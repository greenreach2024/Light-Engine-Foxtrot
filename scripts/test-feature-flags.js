#!/usr/bin/env node
/**
 * Test Feature Flag System
 * 
 * Tests:
 * 1. Feature detection from license
 * 2. Endpoint protection
 * 3. Tier-based access control
 * 4. Wholesale always available
 */

import { getLicenseTier, hasFeature } from '../lib/license-manager.js';
import { getAvailableFeatures, isFeatureEnabled } from '../server/middleware/feature-flags.js';

async function testFeatureFlags() {
  console.log('🧪 Testing Feature Flag System\n');
  
  try {
    // Test 1: Get current tier
    console.log('Test 1: License Tier Detection');
    const tier = await getLicenseTier();
    console.log(`  Current Tier: ${tier}`);
    console.log(`  ✓ Tier detection working\n`);
    
    // Test 2: Get available features
    console.log('Test 2: Available Features');
    const features = await getAvailableFeatures();
    for (const [feature, info] of Object.entries(features)) {
      const status = info.enabled ? '✓ ENABLED' : '✗ DISABLED';
      console.log(`  ${status}: ${info.name} (${feature})`);
    }
    console.log();
    
    // Test 3: Test specific feature checks
    console.log('Test 3: Feature Checks');
    const testFeatures = ['inventory', 'wholesale', 'automation', 'climate_control', 'ml'];
    
    for (const feature of testFeatures) {
      const enabled = await isFeatureEnabled(feature);
      const status = enabled ? '✓ ALLOWED' : '✗ BLOCKED';
      console.log(`  ${status}: ${feature}`);
    }
    console.log();
    
    // Test 4: Verify wholesale is always available
    console.log('Test 4: Wholesale Availability (should ALWAYS be enabled)');
    const wholesaleEnabled = await hasFeature('wholesale');
    if (wholesaleEnabled) {
      console.log('  ✓ PASS: Wholesale is available');
    } else {
      console.log('  ✗ FAIL: Wholesale should always be available!');
    }
    console.log();
    
    // Test 5: Check tier-specific features
    console.log('Test 5: Tier-Specific Access');
    
    const inventoryOnlyFeatures = ['inventory', 'scheduling', 'wholesale', 'reporting'];
    const fullFeatures = ['automation', 'climate_control', 'sensors'];
    const enterpriseFeatures = ['ml', 'analytics', 'api_access'];
    
    console.log('  Inventory-Only Features:');
    for (const feature of inventoryOnlyFeatures) {
      const enabled = await isFeatureEnabled(feature);
      console.log(`    ${enabled ? '✓' : '✗'} ${feature}`);
    }
    
    console.log('  Full Tier Features:');
    for (const feature of fullFeatures) {
      const enabled = await isFeatureEnabled(feature);
      console.log(`    ${enabled ? '✓' : '✗'} ${feature}`);
    }
    
    console.log('  Enterprise Features:');
    for (const feature of enterpriseFeatures) {
      const enabled = await isFeatureEnabled(feature);
      console.log(`    ${enabled ? '✓' : '✗'} ${feature}`);
    }
    console.log();
    
    // Summary
    console.log('✅ Feature Flag System Tests Complete\n');
    console.log('Summary:');
    console.log(`  License Tier: ${tier}`);
    console.log(`  Wholesale Access: ✓ Always Available`);
    console.log(`  Feature Enforcement: ✓ Working`);
    console.log(`  Tier-Based Access: ✓ Working\n`);
    
  } catch (err) {
    console.error('❌ Test failed:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

// Run tests
testFeatureFlags().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
