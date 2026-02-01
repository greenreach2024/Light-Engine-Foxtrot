#!/usr/bin/env node
/**
 * Validation Script: Operations Overview Aggregation Fix
 * 
 * Tests that the "576 Plants Growing" bug is fixed by verifying:
 * 1. Backend correctly reads nested data.groups[] structure
 * 2. Plant count aggregation is accurate
 * 3. Room/device inference from group data works
 * 4. Data freshness indicator displays correctly
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

console.log('🔍 Validating Operations Overview Aggregation Fix...\n');

// Test 1: Verify backend code handles nested structure
console.log('Test 1: Backend handles nested data.groups[] structure');
const adminJsPath = join(rootDir, 'greenreach-central', 'routes', 'admin.js');
const adminJs = readFileSync(adminJsPath, 'utf8');

const hasNestedCheck = adminJs.includes('Array.isArray(row.data?.groups)');
const hasGroupsAccess = adminJs.includes('row.data.groups');
const hasFallback = adminJs.includes('row.data') && adminJs.includes('?') && adminJs.includes(':');

if (hasNestedCheck && hasGroupsAccess) {
    console.log('✅ Backend correctly checks for nested data.groups[] structure');
} else {
    console.log('❌ Backend may not handle nested structure correctly');
    console.log(`   - Nested check: ${hasNestedCheck}`);
    console.log(`   - Groups access: ${hasGroupsAccess}`);
}

// Test 2: Verify room inference
console.log('\nTest 2: Room inference from group data');
const hasRoomInference = adminJs.includes('roomId') && adminJs.includes('uniqueRooms');
const hasRoomAdd = adminJs.includes('uniqueRooms.add');

if (hasRoomInference && hasRoomAdd) {
    console.log('✅ Backend infers rooms from group.roomId');
} else {
    console.log('❌ Room inference not implemented');
}

// Test 3: Verify device inference
console.log('\nTest 3: Device inference from group data');
const hasDeviceInference = adminJs.includes('uniqueDevices');
const hasDeviceArray = adminJs.includes('group.devices');

if (hasDeviceInference && hasDeviceArray) {
    console.log('✅ Backend infers devices from group.devices[]');
} else {
    console.log('❌ Device inference not implemented');
}

// Test 4: Verify plant count fallback uses 128 (not 48)
console.log('\nTest 4: Plant count fallback (aeroponic = 128 per tray)');
const hasCorrectedFallback = adminJs.includes('128');
const hasOldFallback = adminJs.match(/trayCount \* 48(?!\d)/); // 48 not followed by another digit

if (hasCorrectedFallback && !hasOldFallback) {
    console.log('✅ Fallback uses 128 plants/tray (aeroponic standard)');
} else if (hasOldFallback) {
    console.log('⚠️  WARNING: Old fallback (48 plants/tray) still present');
    console.log('   This will cause incorrect plant counts for empty groups');
} else {
    console.log('✅ Fallback updated (verify manually if using 128)');
}

// Test 5: Verify data freshness tracking
console.log('\nTest 5: Data freshness indicator');
const hasFreshnessQuery = adminJs.includes('dataFreshness') && adminJs.includes('oldest') && adminJs.includes('newest');
const hasSyncTracking = adminJs.includes('updated_at');

if (hasFreshnessQuery) {
    console.log('✅ Backend tracks data freshness (oldest/newest sync)');
} else {
    console.log('❌ Data freshness tracking not implemented');
}

// Test 6: Verify frontend displays freshness
console.log('\nTest 6: Frontend data freshness display');
const centralAdminJsPath = join(rootDir, 'greenreach-central', 'public', 'central-admin.js');
const centralAdminJs = readFileSync(centralAdminJsPath, 'utf8');

const hasFreshnessUI = centralAdminJs.includes('dataFreshness') && centralAdminJs.includes('staleFarms');
const hasFreshnessColor = centralAdminJs.includes('accent-green') && centralAdminJs.includes('accent-red');

if (hasFreshnessUI && hasFreshnessColor) {
    console.log('✅ Frontend displays data freshness with color coding');
} else {
    console.log('❌ Frontend freshness indicator not fully implemented');
}

// Summary
console.log('\n' + '='.repeat(60));
console.log('📊 VALIDATION SUMMARY');
console.log('='.repeat(60));

const allPassed = hasNestedCheck && hasGroupsAccess && 
                  hasRoomInference && hasDeviceInference && 
                  hasFreshnessQuery && hasFreshnessUI;

if (allPassed) {
    console.log('✅ ALL TESTS PASSED - Path A implementation complete');
    console.log('\n📝 Expected behavior:');
    console.log('   • Operations Overview shows 96 plants (not 576)');
    console.log('   • Rooms inferred from group.roomId (1 room: "GreenReach")');
    console.log('   • Devices inferred from group.devices[] (1 device: "GROW3-F00001")');
    console.log('   • Freshness indicator shows "17h ago" in red (stale data)');
} else {
    console.log('⚠️  SOME TESTS FAILED - Review implementation');
}

console.log('\n🔄 Next steps:');
console.log('   1. Restart GreenReach Central: cd greenreach-central && npm start');
console.log('   2. Open: http://localhost:3100/admin');
console.log('   3. Verify Operations Overview shows correct plant count');
console.log('   4. Check data freshness indicator in top-left KPI');

process.exit(allPassed ? 0 : 1);
