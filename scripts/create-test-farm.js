const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'lightengine.db');
const RECIPES_PATH = path.join(__dirname, '..', 'public', 'data', 'lighting-recipes.json');

// Farm configuration
const FARM_CONFIG = {
  farmId: 'TEST-FARM-001',
  farmName: 'GreenReach Test Farm',
  location: 'Denver, CO',
  timezone: 'America/Denver',
  rooms: [
    {
      name: 'Grow Room A',
      zones: [
        { name: 'Zone 1', groups: ['Group A1', 'Group A2'] },
        { name: 'Zone 2', groups: ['Group B1', 'Group B2'] }
      ]
    }
  ],
  trayFormat: {
    name: '12-Hole Standard',
    plantSiteCount: 12,
    systemType: 'NFT',
    isWeightBased: true,
    targetWeightPerSite: 4.0,
    weightUnit: 'oz'
  },
  locationsPerGroup: 3,
  traysPerCrop: 3,
  adminUser: {
    email: 'admin@test-farm.com',
    password: 'test123',
    name: 'Test Admin'
  }
};

// Load lighting recipes
function loadLightingRecipes() {
  const recipesData = fs.readFileSync(RECIPES_PATH, 'utf8');
  const recipes = JSON.parse(recipesData);
  return recipes.slice(0, 4); // Get first 4 crops
}

async function createTestFarm() {
  const db = new sqlite3.Database(DB_PATH);
  
  return new Promise(async (resolve, reject) => {
    try {
      console.log('\n=== Creating Test Farm ===\n');
      
      const crops = loadLightingRecipes();
      console.log('Crops to use:', crops.map(c => c.name));
      
      // Clean up existing test farm data
      console.log('\n[CLEANUP] Removing existing TEST-FARM-001 data...');
      await runQuery(db, 'DELETE FROM tray_placements WHERE tray_run_id IN (SELECT tray_run_id FROM tray_runs WHERE tray_id IN (SELECT tray_id FROM trays WHERE farm_id = ?))', [FARM_CONFIG.farmId]);
      await runQuery(db, 'DELETE FROM tray_runs WHERE tray_id IN (SELECT tray_id FROM trays WHERE farm_id = ?)', [FARM_CONFIG.farmId]);
      await runQuery(db, 'DELETE FROM trays WHERE farm_id = ?', [FARM_CONFIG.farmId]);
      await runQuery(db, 'DELETE FROM locations WHERE group_id IN (SELECT group_id FROM groups WHERE zone_id IN (SELECT zone_id FROM zones WHERE room_id IN (SELECT room_id FROM rooms WHERE farm_id = ?)))', [FARM_CONFIG.farmId]);
      await runQuery(db, 'DELETE FROM groups WHERE zone_id IN (SELECT zone_id FROM zones WHERE room_id IN (SELECT room_id FROM rooms WHERE farm_id = ?))', [FARM_CONFIG.farmId]);
      await runQuery(db, 'DELETE FROM zones WHERE room_id IN (SELECT room_id FROM rooms WHERE farm_id = ?)', [FARM_CONFIG.farmId]);
      await runQuery(db, 'DELETE FROM rooms WHERE farm_id = ?', [FARM_CONFIG.farmId]);
      await runQuery(db, 'DELETE FROM users WHERE farm_id = ?', [FARM_CONFIG.farmId]);
      await runQuery(db, 'DELETE FROM farms WHERE farm_id = ?', [FARM_CONFIG.farmId]);
      
      // STEP 1: Create farm
      console.log(`\n[STEP 1] Creating farm: ${FARM_CONFIG.farmName} (${FARM_CONFIG.farmId})`);
      await runQuery(db, 
        'INSERT INTO farms (farm_id, name, location, timezone, created_at) VALUES (?, ?, ?, ?, datetime("now"))',
        [FARM_CONFIG.farmId, FARM_CONFIG.farmName, FARM_CONFIG.location, FARM_CONFIG.timezone]
      );
      
      // STEP 2: Create tray format
      console.log('\n[STEP 2] Creating tray format...');
      const trayFormatId = uuidv4();
      await runQuery(db,
        'INSERT INTO tray_formats (tray_format_id, name, plant_site_count, system_type, is_weight_based, target_weight_per_site, weight_unit) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [trayFormatId, FARM_CONFIG.trayFormat.name, FARM_CONFIG.trayFormat.plantSiteCount, FARM_CONFIG.trayFormat.systemType, FARM_CONFIG.trayFormat.isWeightBased ? 1 : 0, FARM_CONFIG.trayFormat.targetWeightPerSite, FARM_CONFIG.trayFormat.weightUnit]
      );
      
      // STEP 3: Create room structure
      console.log('\n[STEP 3] Creating room structure...');
      const roomData = FARM_CONFIG.rooms[0];
      const roomId = uuidv4();
      await runQuery(db,
        'INSERT INTO rooms (room_id, farm_id, name, description, created_at) VALUES (?, ?, ?, ?, datetime("now"))',
        [roomId, FARM_CONFIG.farmId, roomData.name, 'Main growing area', ]
      );
      
      const locationIds = [];
      let groupIndex = 0;
      
      for (const zoneData of roomData.zones) {
        const zoneId = uuidv4();
        console.log(`  Creating ${zoneData.name}...`);
        await runQuery(db,
          'INSERT INTO zones (zone_id, room_id, name, description, created_at) VALUES (?, ?, ?, ?, datetime("now"))',
          [zoneId, roomId, zoneData.name, `${zoneData.name} in ${roomData.name}`]
        );
        
        for (const groupName of zoneData.groups) {
          const groupId = uuidv4();
          console.log(`    Creating ${groupName}...`);
          await runQuery(db,
            'INSERT INTO groups (group_id, zone_id, name, type, created_at) VALUES (?, ?, ?, ?, datetime("now"))',
            [groupId, zoneId, groupName, 'NFT']
          );
          
          // Create locations for this group
          for (let i = 1; i <= FARM_CONFIG.locationsPerGroup; i++) {
            const locationId = uuidv4();
            const qrCode = `${FARM_CONFIG.farmId}-${groupName}-L${i}`;
            await runQuery(db,
              'INSERT INTO locations (location_id, group_id, name, qr_code_value, created_at) VALUES (?, ?, ?, ?, datetime("now"))',
              [locationId, groupId, `Location ${i}`, qrCode]
            );
            locationIds.push(locationId);
          }
          groupIndex++;
        }
      }
      
      console.log(`  Created ${locationIds.length} locations total`);
      
      // STEP 4: Create trays and plant crops
      console.log('\n[STEP 4] Planting crops...');
      let trayCount = 0;
      let locationIndex = 0;
      
      for (let cropIndex = 0; cropIndex < crops.length; cropIndex++) {
        const crop = crops[cropIndex];
        console.log(`  Planting ${FARM_CONFIG.traysPerCrop} trays of ${crop.name}...`);
        
        for (let trayNum = 1; trayNum <= FARM_CONFIG.traysPerCrop; trayNum++) {
          const trayId = uuidv4();
          const trayQrCode = `${FARM_CONFIG.farmId}-TRAY-${String(trayCount + 1).padStart(3, '0')}`;
          
          // Create tray
          await runQuery(db,
            'INSERT INTO trays (tray_id, farm_id, qr_code_value, tray_format_id, created_at) VALUES (?, ?, ?, ?, datetime("now"))',
            [trayId, FARM_CONFIG.farmId, trayQrCode, trayFormatId]
          );
          
          // Create tray run (planting record)
          const trayRunId = uuidv4();
          const seedDate = new Date();
          const expectedHarvestDate = new Date(seedDate);
          expectedHarvestDate.setDate(seedDate.getDate() + crop.daysToHarvest);
          
          await runQuery(db,
            'INSERT INTO tray_runs (tray_run_id, tray_id, recipe_id, seed_date, expected_harvest_date, status, planted_site_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime("now"))',
            [trayRunId, trayId, crop.id, seedDate.toISOString(), expectedHarvestDate.toISOString(), 'active', FARM_CONFIG.trayFormat.plantSiteCount]
          );
          
          // Place tray in location
          const locationId = locationIds[locationIndex % locationIds.length];
          await runQuery(db,
            'INSERT INTO tray_placements (tray_placement_id, tray_run_id, location_id, placed_at, created_at) VALUES (?, ?, ?, datetime("now"), datetime("now"))',
            [uuidv4(), trayRunId, locationId]
          );
          
          trayCount++;
          locationIndex++;
        }
      }
      
      console.log(`  Created ${trayCount} trays with active crops`);
      
      // STEP 5: Create admin user
      console.log('\n[STEP 5] Creating admin user...');
      const userId = uuidv4();
      const passwordHash = await bcrypt.hash(FARM_CONFIG.adminUser.password, 10);
      await runQuery(db,
        'INSERT INTO users (user_id, farm_id, email, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime("now"))',
        [userId, FARM_CONFIG.farmId, FARM_CONFIG.adminUser.email, passwordHash, 'admin', FARM_CONFIG.adminUser.name]
      );
      
      console.log('\n=== Test Farm Created Successfully ===\n');
      console.log('Farm Details:');
      console.log(`  Farm ID: ${FARM_CONFIG.farmId}`);
      console.log(`  Name: ${FARM_CONFIG.farmName}`);
      console.log(`  Location: ${FARM_CONFIG.location}`);
      console.log('\nStructure:');
      console.log(`  Rooms: 1`);
      console.log(`  Zones: 2`);
      console.log(`  Groups: 4`);
      console.log(`  Locations: ${locationIds.length}`);
      console.log('\nInventory:');
      console.log(`  Trays: ${trayCount}`);
      console.log(`  Crops: ${crops.length}`);
      crops.forEach((crop, idx) => {
        console.log(`    - ${crop.name} (${FARM_CONFIG.traysPerCrop} trays, ${crop.daysToHarvest} days to harvest)`);
      });
      console.log('\nAdmin Access:');
      console.log(`  Email: ${FARM_CONFIG.adminUser.email}`);
      console.log(`  Password: ${FARM_CONFIG.adminUser.password}`);
      console.log('\nAccess URLs:');
      console.log(`  Farm Admin: http://localhost:8091/farm-admin.html`);
      console.log(`  Farm Sales: http://localhost:8091/farm-sales.html`);
      console.log(`  Wholesale: http://localhost:8091/wholesale.html`);
      console.log('\n');
      
      db.close();
      resolve();
    } catch (error) {
      console.error('\n[ERROR] Failed to create test farm:', error);
      db.close();
      reject(error);
    }
  });
}

function runQuery(db, query, params = []) {
  return new Promise((resolve, reject) => {
    db.run(query, params, function(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

// Run the script
createTestFarm()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
