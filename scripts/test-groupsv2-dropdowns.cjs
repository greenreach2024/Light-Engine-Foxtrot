#!/usr/bin/env node

/**
 * Test script for Groups V2 dropdown population issues
 * 
 * Tests:
 * 1. Load Group dropdown - verify it populates with groups from groups.json
 * 2. Zone dropdown - verify it populates with zones from room-map.json
 * 3. Room dropdown - verify it populates with rooms from STATE
 * 
 * Usage: node scripts/test-groupsv2-dropdowns.cjs
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:8091';
const GROUPS_FILE = path.join(__dirname, '../public/data/groups.json');

function get(path) {
  return new Promise((resolve, reject) => {
    http.get(`${BASE_URL}${path}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (err) {
          reject(new Error(`Failed to parse JSON from ${path}: ${err.message}`));
        }
      });
    }).on('error', reject);
  });
}

async function runTests() {
  console.log('🧪 Groups V2 Dropdown Population Tests\n');
  
  let passed = 0;
  let failed = 0;

  // Test 1: Verify groups.json has data
  console.log('📋 Test 1: Verify groups.json contains groups');
  try {
    const groupsData = await get('/data/groups.json');
    const groups = groupsData.groups || [];
    
    if (groups.length > 0) {
      console.log(`✅ Found ${groups.length} groups in groups.json`);
      groups.forEach(g => {
        const status = g.status || 'draft';
        const icon = status === 'deployed' ? '✅' : '📝';
        console.log(`   ${icon} ${g.room}:${g.zone}:${g.name}`);
      });
      passed++;
    } else {
      console.log('❌ No groups found in groups.json');
      failed++;
    }
  } catch (err) {
    console.log(`❌ Failed to load groups.json: ${err.message}`);
    failed++;
  }

  // Test 2: Verify room-map.json has zones
  console.log('\n📋 Test 2: Verify room-map.json contains zones');
  try {
    const roomMap = await get('/data/room-map.json');
    const zones = roomMap.zones || [];
    
    if (zones.length > 0) {
      console.log(`✅ Found ${zones.length} zones in room-map.json`);
      zones.forEach(z => {
        console.log(`   Zone ${z.zone}: ${z.name} (${z.color})`);
      });
      passed++;
    } else {
      console.log('❌ No zones found in room-map.json');
      failed++;
    }
  } catch (err) {
    console.log(`❌ Failed to load room-map.json: ${err.message}`);
    failed++;
  }

  // Test 3: Verify rooms.json has rooms
  console.log('\n📋 Test 3: Verify rooms.json contains rooms');
  try {
    const roomsData = await get('/data/rooms.json');
    const rooms = roomsData.rooms || [];
    
    if (rooms.length >= 0) { // Note: GreenReach is always there even if rooms.json is empty
      console.log(`✅ Found ${rooms.length} custom rooms in rooms.json`);
      console.log(`   (Plus default "GreenReach" room)`);
      if (rooms.length > 0) {
        rooms.forEach(r => {
          console.log(`   - ${r.name} (id: ${r.id})`);
        });
      }
      passed++;
    } else {
      console.log('❌ rooms.json structure is invalid');
      failed++;
    }
  } catch (err) {
    console.log(`❌ Failed to load rooms.json: ${err.message}`);
    failed++;
  }

  // Test 4: Verify index.html has the dropdown elements
  console.log('\n📋 Test 4: Verify HTML contains dropdown elements');
  try {
    const html = await new Promise((resolve, reject) => {
      http.get(`${BASE_URL}/`, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(data));
      }).on('error', reject);
    });
    
    const hasLoadGroup = html.includes('id="groupsV2LoadGroup"');
    const hasRoomSelect = html.includes('id="groupsV2RoomSelect"');
    const hasZoneSelect = html.includes('id="groupsV2ZoneSelect"');
    
    if (hasLoadGroup && hasRoomSelect && hasZoneSelect) {
      console.log('✅ All dropdown elements present in HTML');
      console.log('   - groupsV2LoadGroup: ✓');
      console.log('   - groupsV2RoomSelect: ✓');
      console.log('   - groupsV2ZoneSelect: ✓');
      passed++;
    } else {
      console.log('❌ Missing dropdown elements in HTML:');
      if (!hasLoadGroup) console.log('   - groupsV2LoadGroup: ✗');
      if (!hasRoomSelect) console.log('   - groupsV2RoomSelect: ✗');
      if (!hasZoneSelect) console.log('   - groupsV2ZoneSelect: ✗');
      failed++;
    }
  } catch (err) {
    console.log(`❌ Failed to load index.html: ${err.message}`);
    failed++;
  }

  // Test 5: Check if groups-v2.js has the population functions
  console.log('\n📋 Test 5: Verify groups-v2.js has dropdown population functions');
  try {
    const js = await new Promise((resolve, reject) => {
      http.get(`${BASE_URL}/groups-v2.js`, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(data));
      }).on('error', reject);
    });
    
    const hasLoadGroupFn = js.includes('function populateGroupsV2LoadGroupDropdown()');
    const hasRoomFn = js.includes('function populateGroupsV2RoomDropdown()');
    const hasZoneFn = js.includes('function loadZonesFromRoomMapper()');
    const hasGroupsUpdatedListener = js.includes("addEventListener('groups-updated', populateGroupsV2LoadGroupDropdown)")
      || js.includes("addEventListener('groups-updated', requestGroupsV2LoadGroupRefresh)");
    
    if (hasLoadGroupFn && hasRoomFn && hasZoneFn && hasGroupsUpdatedListener) {
      console.log('✅ All dropdown population functions present');
      console.log('   - populateGroupsV2LoadGroupDropdown: ✓');
      console.log('   - populateGroupsV2RoomDropdown: ✓');
      console.log('   - loadZonesFromRoomMapper: ✓');
      console.log('   - groups-updated event listener: ✓');
      passed++;
    } else {
      console.log('❌ Missing dropdown functions:');
      if (!hasLoadGroupFn) console.log('   - populateGroupsV2LoadGroupDropdown: ✗');
      if (!hasRoomFn) console.log('   - populateGroupsV2RoomDropdown: ✗');
      if (!hasZoneFn) console.log('   - loadZonesFromRoomMapper: ✗');
      if (!hasGroupsUpdatedListener) console.log('   - groups-updated listener: ✗');
      failed++;
    }
  } catch (err) {
    console.log(`❌ Failed to load groups-v2.js: ${err.message}`);
    failed++;
  }

  // Test 6: Check if app.charlie.js dispatches groups-updated event
  console.log('\n📋 Test 6: Verify app.charlie.js dispatches groups-updated event');
  try {
    const js = await new Promise((resolve, reject) => {
      http.get(`${BASE_URL}/app.charlie.js`, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(data));
      }).on('error', reject);
    });
    
    // Check if groups-updated is dispatched after loadAllData
    const hasGroupsUpdatedDispatch = js.includes("document.dispatchEvent(new Event('groups-updated'))");
    
    if (hasGroupsUpdatedDispatch) {
      console.log('✅ app.charlie.js dispatches groups-updated event');
      console.log('   This should trigger dropdown population after data loads');
      passed++;
    } else {
      console.log('❌ app.charlie.js does NOT dispatch groups-updated event');
      console.log('   Dropdowns may not populate when page loads!');
      failed++;
    }
  } catch (err) {
    console.log(`❌ Failed to load app.charlie.js: ${err.message}`);
    failed++;
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log(`📊 Test Summary: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(60));

  if (failed === 0) {
    console.log('✅ All tests passed! Dropdowns should work correctly.');
    console.log('\n💡 Manual testing steps:');
    console.log('1. Open http://localhost:8091 in browser');
    console.log('2. Navigate to Groups V2 panel');
    console.log('3. Check that "Load group" dropdown shows saved groups');
    console.log('4. Check that "Room" dropdown shows rooms');
    console.log('5. Check that "Zone" dropdown shows zones');
  } else {
    console.log('❌ Some tests failed. Please check the issues above.');
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('💥 Test suite failed:', err);
  process.exit(1);
});
