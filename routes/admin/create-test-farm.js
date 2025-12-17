const express = require('express');
const router = express.Router();
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', '..', 'lightengine.db');
const RECIPES_PATH = path.join(__dirname, '..', '..', 'public', 'data', 'lighting-recipes.json');

const FARM_CONFIG = {
  farmId: 'TEST-FARM-001',
  farmName: 'GreenReach Test Farm',
  locationsPerGroup: 3,
  traysPerCrop: 3,
  adminUser: { email: 'admin@test-farm.com', password: 'test123', name: 'Test Admin' }
};

// Demo farms to remove
const DEMO_FARM_IDS = ['FARM-001', 'FARM-002', 'FARM-003', 'LOCAL-FARM', 'GR-00001'];

function loadCrops() {
  const data = JSON.parse(fs.readFileSync(RECIPES_PATH, 'utf8'));
  return Object.keys(data.crops).slice(0, 4).map((name, idx) => ({
    id: `crop-${idx + 1}`, name, daysToHarvest: 28
  }));
}

async function cleanDemoData(db) {
  const run = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function(err) { err ? reject(err) : resolve(this); });
  });
  
  console.log('[create-test-farm] Cleaning demo farm data...');
  
  // Clean all demo farms
  for (const farmId of DEMO_FARM_IDS) {
    try {
      await run('DELETE FROM tray_placements WHERE tray_run_id IN (SELECT tray_run_id FROM tray_runs WHERE tray_id IN (SELECT tray_id FROM trays WHERE tray_id IN (SELECT tray_id FROM trays)))');
      await run('DELETE FROM tray_runs WHERE tray_id IN (SELECT tray_id FROM trays)');
      await run('DELETE FROM trays');
      await run('DELETE FROM locations WHERE group_id IN (SELECT group_id FROM groups WHERE zone_id IN (SELECT zone_id FROM zones WHERE room_id IN (SELECT room_id FROM rooms WHERE farm_id = ?)))', [farmId]);
      await run('DELETE FROM groups WHERE zone_id IN (SELECT zone_id FROM zones WHERE room_id IN (SELECT room_id FROM rooms WHERE farm_id = ?))', [farmId]);
      await run('DELETE FROM zones WHERE room_id IN (SELECT room_id FROM rooms WHERE farm_id = ?)', [farmId]);
      await run('DELETE FROM rooms WHERE farm_id = ?', [farmId]);
      await run('DELETE FROM users WHERE tenant_id = ?', [farmId]);
      await run('DELETE FROM farms WHERE farm_id = ?', [farmId]);
      console.log(`[create-test-farm] Cleaned ${farmId}`);
    } catch (error) {
      console.log(`[create-test-farm] Warning cleaning ${farmId}:`, error.message);
    }
  }
  
  // Also clean TEST-FARM-001 if it exists
  try {
    await run('DELETE FROM tray_placements WHERE tray_run_id IN (SELECT tray_run_id FROM tray_runs WHERE tray_id IN (SELECT tray_id FROM trays))');
    await run('DELETE FROM tray_runs');
    await run('DELETE FROM trays');
    await run('DELETE FROM locations WHERE group_id IN (SELECT group_id FROM groups WHERE zone_id IN (SELECT zone_id FROM zones WHERE room_id IN (SELECT room_id FROM rooms WHERE farm_id = ?)))', [FARM_CONFIG.farmId]);
    await run('DELETE FROM groups WHERE zone_id IN (SELECT zone_id FROM zones WHERE room_id IN (SELECT room_id FROM rooms WHERE farm_id = ?))', [FARM_CONFIG.farmId]);
    await run('DELETE FROM zones WHERE room_id IN (SELECT room_id FROM rooms WHERE farm_id = ?)', [FARM_CONFIG.farmId]);
    await run('DELETE FROM rooms WHERE farm_id = ?', [FARM_CONFIG.farmId]);
    await run('DELETE FROM users WHERE tenant_id = ?', [FARM_CONFIG.farmId]);
    await run('DELETE FROM farms WHERE farm_id = ?', [FARM_CONFIG.farmId]);
  } catch (error) {
    console.log('[create-test-farm] Note: TEST-FARM-001 may not exist yet');
  }
}

async function createFarm(db) {
  const crops = loadCrops();
  const run = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function(err) { err ? reject(err) : resolve(this); });
  });
  
  // 1. Farm
  await run('INSERT INTO farms (farm_id, name, created_at, updated_at) VALUES (?, ?, datetime("now"), datetime("now"))', [FARM_CONFIG.farmId, FARM_CONFIG.farmName]);
  
  // 2. Tray format
  const formatId = uuidv4();
  await run('INSERT INTO tray_formats (tray_format_id, name, plant_site_count, system_type, is_weight_based, target_weight_per_site, weight_unit, is_custom, is_approved, created_at, updated_at) VALUES (?, ?, 12, "NFT", 1, 4.0, "oz", 0, 1, datetime("now"), datetime("now"))', [formatId, '12-Hole Standard']);
  
  // 3. Structure
  const roomId = uuidv4();
  await run('INSERT INTO rooms (room_id, farm_id, name, created_at, updated_at) VALUES (?, ?, ?, datetime("now"), datetime("now"))', [roomId, FARM_CONFIG.farmId, 'Grow Room A']);
  
  const locations = [];
  for (let z = 1; z <= 2; z++) {
    const zoneId = uuidv4();
    await run('INSERT INTO zones (zone_id, room_id, name, created_at, updated_at) VALUES (?, ?, ?, datetime("now"), datetime("now"))', [zoneId, roomId, `Zone ${z}`]);
    
    for (let g = 1; g <= 2; g++) {
      const groupId = uuidv4();
      const groupName = `Group ${String.fromCharCode(64 + z)}${g}`;
      await run('INSERT INTO groups (group_id, zone_id, name, created_at, updated_at) VALUES (?, ?, ?, datetime("now"), datetime("now"))', [groupId, zoneId, groupName]);
      
      for (let i = 1; i <= FARM_CONFIG.locationsPerGroup; i++) {
        const locId = uuidv4();
        await run('INSERT INTO locations (location_id, group_id, name, qr_code_value, created_at, updated_at) VALUES (?, ?, ?, ?, datetime("now"), datetime("now"))', [locId, groupId, `Location ${i}`, `${FARM_CONFIG.farmId}-${groupName}-L${i}`]);
        locations.push(locId);
      }
    }
  }
  
  // 4. Planting
  let trayNum = 0;
  for (const crop of crops) {
    for (let t = 0; t < FARM_CONFIG.traysPerCrop; t++) {
      const trayId = uuidv4();
      await run('INSERT INTO trays (tray_id, qr_code_value, tray_format_id, created_at, updated_at) VALUES (?, ?, ?, datetime("now"), datetime("now"))', [trayId, `${FARM_CONFIG.farmId}-TRAY-${String(trayNum + 1).padStart(3, '0')}`, formatId]);
      
      const runId = uuidv4();
      const seedDate = new Date();
      const harvestDate = new Date(seedDate.getTime() + crop.daysToHarvest * 24 * 60 * 60 * 1000);
      await run('INSERT INTO tray_runs (tray_run_id, tray_id, recipe_id, seed_date, expected_harvest_date, status, planted_site_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime("now"), datetime("now"))', [runId, trayId, crop.id, seedDate.toISOString(), harvestDate.toISOString(), 'active', 12]);
      
      await run('INSERT INTO tray_placements (placement_id, tray_run_id, location_id, placed_at, created_at, updated_at) VALUES (?, ?, ?, datetime("now"), datetime("now"), datetime("now"))', [uuidv4(), runId, locations[trayNum % locations.length]]);
      trayNum++;
    }
  }
  
  // 5. Admin user
  const userId = uuidv4();
  const hash = await bcrypt.hash(FARM_CONFIG.adminUser.password, 10);
  await run('INSERT INTO users (id, tenant_id, email, password_hash, role, first_name, last_name, email_verified, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, datetime("now"), datetime("now"))', [userId, FARM_CONFIG.farmId, FARM_CONFIG.adminUser.email, hash, 'admin', 'Test', 'Admin']);
  
  return { crops, locations: locations.length, trays: trayNum };
}

router.post('/create-test-farm', async (req, res) => {
  const db = new sqlite3.Database(DB_PATH);
  
  try {
    console.log('[create-test-farm] Starting test farm creation...');
    
    // Clean all demo data first
    await cleanDemoData(db);
    
    // Create test farm
    const result = await createFarm(db);
    db.close();
    
    console.log('[create-test-farm] Test farm created successfully');
    
    res.json({
      success: true,
      message: 'Test farm created successfully. All demo data removed.',
      farm: {
        id: FARM_CONFIG.farmId,
        name: FARM_CONFIG.farmName,
        structure: '1 room, 2 zones, 4 groups, ' + result.locations + ' locations',
        inventory: result.trays + ' trays with ' + result.crops.length + ' crops',
        crops: result.crops.map(c => c.name),
        login: {
          email: FARM_CONFIG.adminUser.email,
          password: FARM_CONFIG.adminUser.password
        }
      }
    });
  } catch (error) {
    console.error('[create-test-farm] Error:', error);
    db.close();
    res.status(500).json({ 
      success: false, 
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

module.exports = router;
