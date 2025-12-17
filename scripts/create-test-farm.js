#!/usr/bin/env node
/**
 * Create a complete test farm from scratch
 * Tests the entire system: Farm Admin → Inventory → Farm Sales → Wholesale → GreenReach Admin
 * 
 * Farm Structure:
 * - 1 Room (Grow Room A)
 * - 2 Zones (Zone 1, Zone 2)
 * - 4 Groups (2 per zone)
 * - 4 Crops from lighting-recipes.json
 * - Full inventory setup
 */

import sqlite3 from 'sqlite3';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, '../lightengine.db');
const db = new sqlite3.Database(dbPath);

const dbRun = promisify(db.run.bind(db));
const dbGet = promisify(db.get.bind(db));
const dbAll = promisify(db.all.bind(db));

// Load lighting recipes
const recipesPath = path.join(__dirname, '../public/data/lighting-recipes.json');
const recipes = JSON.parse(fs.readFileSync(recipesPath, 'utf8'));
const cropNames = Object.keys(recipes.crops).slice(0, 4); // Take first 4 crops

console.log('\n=== Creating Test Farm ===\n');
console.log('Crops to use:', cropNames);

async function createTestFarm() {
  const farmId = 'TEST-FARM-001';
  const farmName = 'GreenReach Test Farm';
  
  console.log(`\n[STEP 1] Creating farm: ${farmName} (${farmId})`);
  
  // Clean up existing test farm
  await dbRun('DELETE FROM tray_placements WHERE tray_run_id IN (SELECT tray_run_id FROM tray_runs WHERE tray_id IN (SELECT tray_id FROM trays WHERE tray_id IN (SELECT tray_id FROM tray_runs WHERE tray_id IN (SELECT tray_id FROM trays))))');
  await dbRun('DELETE FROM tray_runs');
  await dbRun('DELETE FROM trays');
  await dbRun('DELETE FROM locations WHERE group_id IN (SELECT group_id FROM groups WHERE zone_id IN (SELECT zone_id FROM zones WHERE room_id IN (SELECT room_id FROM rooms WHERE farm_id = ?)))' , farmId);
  await dbRun('DELETE FROM groups WHERE zone_id IN (SELECT zone_id FROM zones WHERE room_id IN (SELECT room_id FROM rooms WHERE farm_id = ?))', farmId);
  await dbRun('DELETE FROM zones WHERE room_id IN (SELECT room_id FROM rooms WHERE farm_id = ?)', farmId);
  await dbRun('DELETE FROM rooms WHERE farm_id = ?', farmId);
  await dbRun('DELETE FROM farms WHERE farm_id = ?', farmId);
  
  console.log('[STEP 1] Cleaned up existing test farm data');
  
  // Create farm
  const farmUuid = uuidv4();
  await dbRun(
    'INSERT INTO farms (farm_id, name, location, timezone) VALUES (?, ?, ?, ?)',
    [farmId, farmName, 'Test Location, CA', 'America/Los_Angeles']
  );
  console.log('[STEP 1] ✓ Farm created');
  
  // Create room
  console.log('\n[STEP 2] Creating room structure');
  const roomId = uuidv4();
  await dbRun(
    'INSERT INTO rooms (room_id, farm_id, name, description) VALUES (?, ?, ?, ?)',
    [roomId, farmId, 'Grow Room A', 'Main growing area']
  );
  console.log('[STEP 2] ✓ Room created: Grow Room A');
  
  // Create zones
  const zones = [
    { id: uuidv4(), name: 'Zone 1', description: 'North section' },
    { id: uuidv4(), name: 'Zone 2', description: 'South section' }
  ];
  
  for (const zone of zones) {
    await dbRun(
      'INSERT INTO zones (zone_id, room_id, name, description) VALUES (?, ?, ?, ?)',
      [zone.id, roomId, zone.name, zone.description]
    );
    console.log(`[STEP 2] ✓ Zone created: ${zone.name}`);
  }
  
  // Create groups (2 per zone = 4 total)
  console.log('\n[STEP 3] Creating groups');
  const groups = [];
  for (let i = 0; i < zones.length; i++) {
    for (let j = 1; j <= 2; j++) {
      const groupId = uuidv4();
      const groupName = `Group ${zones[i].name}-${j}`;
      await dbRun(
        'INSERT INTO groups (group_id, zone_id, name, type) VALUES (?, ?, ?, ?)',
        [groupId, zones[i].id, groupName, 'rack']
      );
      groups.push({ id: groupId, name: groupName, zoneId: zones[i].id });
      console.log(`[STEP 3] ✓ Group created: ${groupName}`);
    }
  }
  
  // Create tray formats
  console.log('\n[STEP 4] Creating tray formats');
  const formatId = uuidv4();
  await dbRun(
    'INSERT OR REPLACE INTO tray_formats (tray_format_id, name, plant_site_count, system_type, is_weight_based, target_weight_per_site, weight_unit) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [formatId, '12-Hole Standard', 12, 'NFT', 1, 4.0, 'oz']
  );
  console.log('[STEP 4] ✓ Tray format created: 12-Hole Standard (12 sites, 4oz per site)');
  
  // Create locations (3 per group = 12 total)
  console.log('\n[STEP 5] Creating locations');
  const locations = [];
  for (const group of groups) {
    for (let i = 1; i <= 3; i++) {
      const locationId = uuidv4();
      const locationName = `${group.name}-L${i}`;
      await dbRun(
        'INSERT INTO locations (location_id, group_id, name, qr_code_value) VALUES (?, ?, ?, ?)',
        [locationId, group.id, locationName, `QR-${locationName}`]
      );
      locations.push({ id: locationId, name: locationName, groupId: group.id });
    }
  }
  console.log(`[STEP 5] ✓ Created ${locations.length} locations`);
  
  // Create trays with crops
  console.log('\n[STEP 6] Creating trays and planting crops');
  const today = new Date();
  let trayCount = 0;
  
  for (let i = 0; i < cropNames.length; i++) {
    const cropName = cropNames[i];
    const cropData = recipes.crops[cropName];
    const harvestDay = cropData[cropData.length - 1]?.day || 21;
    const expectedHarvest = new Date(today);
    expectedHarvest.setDate(expectedHarvest.getDate() + Math.round(harvestDay));
    
    // Create 3 trays per crop
    for (let j = 0; j < 3; j++) {
      const trayId = uuidv4();
      const trayRunId = uuidv4();
      const qrCode = `TRAY-${cropName.substring(0, 3).toUpperCase()}-${String(j + 1).padStart(3, '0')}`;
      
      // Create tray
      await dbRun(
        'INSERT INTO trays (tray_id, qr_code_value, tray_format_id) VALUES (?, ?, ?)',
        [trayId, qrCode, formatId]
      );
      
      // Create tray run (seeded and placed)
      await dbRun(
        'INSERT INTO tray_runs (tray_run_id, tray_id, recipe_id, seed_date, expected_harvest_date, status, planted_site_count) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [trayRunId, trayId, cropName, today.toISOString().split('T')[0], expectedHarvest.toISOString().split('T')[0], 'growing', 12]
      );
      
      // Place tray in a location
      const location = locations[trayCount % locations.length];
      await dbRun(
        'INSERT INTO tray_placements (tray_placement_id, tray_run_id, location_id, placed_at) VALUES (?, ?, ?, ?)',
        [uuidv4(), trayRunId, location.id, today.toISOString()]
      );
      
      trayCount++;
    }
    
    console.log(`[STEP 6] ✓ Created 3 trays for ${cropName} (${Math.round(harvestDay)} days to harvest)`);
  }
  
  console.log(`[STEP 6] ✓ Total trays created: ${trayCount}`);
  
  // Generate inventory summary
  console.log('\n[STEP 7] Generating inventory summary');
  const inventory = await dbAll(`
    SELECT 
      tr.recipe_id as crop,
      COUNT(DISTINCT t.tray_id) as tray_count,
      SUM(tr.planted_site_count) as total_sites,
      tf.target_weight_per_site,
      tf.weight_unit,
      MIN(tr.expected_harvest_date) as earliest_harvest,
      MAX(tr.expected_harvest_date) as latest_harvest
    FROM tray_runs tr
    JOIN trays t ON tr.tray_id = t.tray_id
    JOIN tray_formats tf ON t.tray_format_id = tf.tray_format_id
    JOIN tray_placements tp ON tr.tray_run_id = tp.tray_run_id
    JOIN locations l ON tp.location_id = l.location_id
    JOIN groups g ON l.group_id = g.group_id
    JOIN zones z ON g.zone_id = z.zone_id
    JOIN rooms r ON z.room_id = r.room_id
    WHERE r.farm_id = ? AND tr.status = 'growing' AND tp.removed_at IS NULL
    GROUP BY tr.recipe_id
  `, farmId);
  
  console.log('\n=== FARM INVENTORY ===');
  inventory.forEach(item => {
    const totalWeight = item.total_sites * item.target_weight_per_site;
    console.log(`\n${item.crop}:`);
    console.log(`  - ${item.tray_count} trays`);
    console.log(`  - ${item.total_sites} plants`);
    console.log(`  - ${totalWeight} ${item.weight_unit} estimated yield`);
    console.log(`  - Harvest: ${item.earliest_harvest} to ${item.latest_harvest}`);
  });
  
  // Create farm authentication
  console.log('\n[STEP 8] Setting up farm authentication');
  const users = await dbAll('SELECT * FROM users WHERE farm_id = ?', farmId);
  if (users.length === 0) {
    const userId = uuidv4();
    const bcrypt = await import('bcrypt');
    const hashedPassword = await bcrypt.hash('test123', 10);
    
    await dbRun(
      'INSERT INTO users (user_id, farm_id, email, password_hash, role, name) VALUES (?, ?, ?, ?, ?, ?)',
      [userId, farmId, 'admin@test-farm.com', hashedPassword, 'farm_admin', 'Test Admin']
    );
    console.log('[STEP 8] ✓ Admin user created: admin@test-farm.com (password: test123)');
  }
  
  // Summary
  console.log('\n=== FARM CREATION COMPLETE ===\n');
  console.log(`Farm ID: ${farmId}`);
  console.log(`Farm Name: ${farmName}`);
  console.log(`Structure: 1 room → 2 zones → 4 groups → ${locations.length} locations`);
  console.log(`Inventory: ${trayCount} trays across ${cropNames.length} crops`);
  console.log(`\nLogin credentials:`);
  console.log(`  Email: admin@test-farm.com`);
  console.log(`  Password: test123`);
  console.log(`\nAccess URLs:`);
  console.log(`  - Farm Admin: http://localhost:8091/farm-admin.html`);
  console.log(`  - Farm Sales: http://localhost:8091/farm-sales.html`);
  console.log(`  - Wholesale: http://localhost:8091/wholesale.html`);
  console.log(`\nAPI Endpoints:`);
  console.log(`  - Inventory: GET /api/inventory/current?farmId=${farmId}`);
  console.log(`  - Farm Sales: GET /api/farm-sales/inventory (requires auth)`);
  console.log(`  - Wholesale: GET /api/wholesale/catalog`);
  
  return {
    farmId,
    farmName,
    rooms: 1,
    zones: 2,
    groups: 4,
    locations: locations.length,
    trays: trayCount,
    crops: cropNames
  };
}

// Run the script
createTestFarm()
  .then(result => {
    console.log('\n[SUCCESS] Test farm created successfully!');
    db.close();
    process.exit(0);
  })
  .catch(error => {
    console.error('\n[ERROR] Failed to create test farm:', error);
    db.close();
    process.exit(1);
  });
