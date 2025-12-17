#!/usr/bin/env node
/**
 * Seed Demo Farm Script
 * 
 * Seeds PostgreSQL database with demo farm data for realistic testing.
 * Use this when deploying to AWS RDS for a production-like demo environment.
 * 
 * Usage:
 *   node scripts/seed-demo-farm.js
 *   node scripts/seed-demo-farm.js --farm-id DEMO-FARM-002
 *   node scripts/seed-demo-farm.js --clean  # Remove existing demo data first
 * 
 * Environment Variables:
 *   DATABASE_URL - PostgreSQL connection string
 *   DEMO_FARM_ID - Farm ID to seed (default: DEMO-FARM-001)
 */

import 'dotenv/config';
import pg from 'pg';
import DemoDataGenerator from '../lib/demo-data-generator.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { Client } = pg;

// Parse command line arguments
const args = process.argv.slice(2);
const FARM_ID = args.find(arg => arg.startsWith('--farm-id='))?.split('=')[1] || 
                process.env.DEMO_FARM_ID || 
                'DEMO-FARM-001';
const CLEAN_FIRST = args.includes('--clean');
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL environment variable is required');
  console.error('   Set in .env file or export: DATABASE_URL=postgresql://user:pass@host:5432/dbname');
  process.exit(1);
}

console.log('🌱 Demo Farm Seeding Script');
console.log('============================');
console.log(`Farm ID: ${FARM_ID}`);
console.log(`Clean first: ${CLEAN_FIRST}`);
console.log('');

async function seedDemoFarm() {
  const client = new Client({
    connectionString: DATABASE_URL
  });

  try {
    await client.connect();
    console.log('✅ Connected to database');

    // Generate demo data
    console.log('📦 Generating demo farm data...');
    const generator = new DemoDataGenerator(FARM_ID, {
      roomCount: 2,
      zonesPerRoom: 4
    });
    const farmData = generator.generateFarm();
    console.log(`   - ${farmData.rooms.length} rooms`);
    console.log(`   - ${farmData.devices.lights.length} lights`);
    console.log(`   - ${farmData.devices.sensors.length} sensors`);
    console.log(`   - ${farmData.inventory.length} trays`);

    // Clean existing demo data if requested
    if (CLEAN_FIRST) {
      console.log('🧹 Cleaning existing demo data...');
      await client.query('DELETE FROM farm_alerts WHERE farm_id IN (SELECT id FROM farms WHERE farm_id = $1)', [FARM_ID]);
      await client.query('DELETE FROM farm_energy WHERE farm_id IN (SELECT id FROM farms WHERE farm_id = $1)', [FARM_ID]);
      await client.query('DELETE FROM farm_inventory WHERE farm_id IN (SELECT id FROM farms WHERE farm_id = $1)', [FARM_ID]);
      await client.query('DELETE FROM farm_devices WHERE farm_id IN (SELECT id FROM farms WHERE farm_id = $1)', [FARM_ID]);
      await client.query('DELETE FROM farm_zones WHERE farm_id IN (SELECT id FROM farms WHERE farm_id = $1)', [FARM_ID]);
      await client.query('DELETE FROM farm_rooms WHERE farm_id IN (SELECT id FROM farms WHERE farm_id = $1)', [FARM_ID]);
      await client.query('DELETE FROM farm_metrics WHERE farm_id IN (SELECT id FROM farms WHERE farm_id = $1)', [FARM_ID]);
      await client.query('DELETE FROM farms WHERE farm_id = $1', [FARM_ID]);
      console.log('   ✅ Cleaned existing data');
    }

    // Insert farm
    console.log('🏭 Inserting farm record...');
    const farmResult = await client.query(`
      INSERT INTO farms (farm_id, name, url, region, status, description, contact_email, contact_phone, latitude, longitude)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (farm_id) DO UPDATE SET
        name = EXCLUDED.name,
        url = EXCLUDED.url,
        region = EXCLUDED.region,
        status = EXCLUDED.status,
        updated_at = NOW()
      RETURNING id
    `, [
      farmData.farmId,
      farmData.name,
      farmData.url,
      farmData.region,
      farmData.status,
      farmData.metadata.description,
      farmData.contact.email,
      farmData.contact.phone,
      farmData.coordinates.lat,
      farmData.coordinates.lng
    ]);
    const dbFarmId = farmResult.rows[0].id;
    console.log(`   ✅ Farm inserted (DB ID: ${dbFarmId})`);

    // Insert rooms
    console.log('🏠 Inserting rooms...');
    const roomMap = new Map();
    for (const room of farmData.rooms) {
      const roomResult = await client.query(`
        INSERT INTO farm_rooms (farm_id, room_id, room_name, zone_count, temp_c, humidity, co2_ppm, vpd_kpa)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id
      `, [
        dbFarmId,
        room.roomId,
        room.name,
        room.zones.length,
        room.temperature,
        room.humidity,
        room.co2,
        room.vpd
      ]);
      roomMap.set(room.roomId, roomResult.rows[0].id);
    }
    console.log(`   ✅ ${farmData.rooms.length} rooms inserted`);

    // Insert zones
    console.log('🌐 Inserting zones...');
    const zoneMap = new Map();
    let zoneCount = 0;
    for (const room of farmData.rooms) {
      const dbRoomId = roomMap.get(room.roomId);
      for (const zone of room.zones) {
        const zoneResult = await client.query(`
          INSERT INTO farm_zones (farm_id, room_id, zone_id, zone_name, temp_c, humidity, co2_ppm, vpd_kpa, ppfd)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          RETURNING id
        `, [
          dbFarmId,
          dbRoomId,
          zone.zoneId,
          zone.name,
          zone.temperature,
          zone.humidity,
          zone.co2,
          zone.vpd,
          zone.ppfd
        ]);
        zoneMap.set(zone.zoneId, zoneResult.rows[0].id);
        zoneCount++;
      }
    }
    console.log(`   ✅ ${zoneCount} zones inserted`);

    // Insert devices (lights and sensors)
    console.log('💡 Inserting devices...');
    let deviceCount = 0;
    
    // Insert lights
    for (const light of farmData.devices.lights) {
      const zoneId = zoneMap.get(light.location);
      if (zoneId) {
        await client.query(`
          INSERT INTO farm_devices (farm_id, zone_id, device_id, device_name, device_type, vendor, model, status, last_seen)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `, [
          dbFarmId,
          zoneId,
          light.deviceId,
          light.name,
          'light',
          light.vendor,
          light.model,
          light.status,
          light.lastSeen
        ]);
        deviceCount++;
      }
    }
    
    // Insert sensors
    for (const sensor of farmData.devices.sensors) {
      const zoneId = zoneMap.get(sensor.location);
      if (zoneId) {
        await client.query(`
          INSERT INTO farm_devices (farm_id, zone_id, device_id, device_name, device_type, vendor, model, status, last_seen)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `, [
          dbFarmId,
          zoneId,
          sensor.deviceId,
          sensor.name,
          'sensor',
          sensor.vendor,
          sensor.model,
          sensor.status,
          sensor.lastSeen
        ]);
        deviceCount++;
      }
    }
    
    // Insert HVAC devices
    for (const hvac of farmData.devices.hvac) {
      const roomId = roomMap.get(hvac.location);
      if (roomId) {
        // Get first zone in this room
        const firstZone = farmData.rooms.find(r => r.roomId === hvac.location)?.zones[0];
        const zoneId = firstZone ? zoneMap.get(firstZone.zoneId) : null;
        
        if (zoneId) {
          await client.query(`
            INSERT INTO farm_devices (farm_id, zone_id, device_id, device_name, device_type, vendor, model, status, last_seen)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          `, [
            dbFarmId,
            zoneId,
            hvac.deviceId,
            hvac.name,
            'hvac',
            hvac.vendor,
            hvac.model,
            hvac.status,
            hvac.lastSeen
          ]);
          deviceCount++;
        }
      }
    }
    console.log(`   ✅ ${deviceCount} devices inserted`);

    // Insert inventory (trays)
    console.log('🌱 Inserting inventory...');
    for (const tray of farmData.inventory) {
      const zoneId = zoneMap.get(tray.zone);
      if (zoneId) {
        await client.query(`
          INSERT INTO farm_inventory (farm_id, zone_id, tray_id, recipe_name, crop_type, plant_count, seed_date, harvest_date, age_days, status, location)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        `, [
          dbFarmId,
          zoneId,
          tray.trayId,
          tray.recipe,
          tray.crop,
          tray.plantCount,
          tray.seedDate,
          tray.harvestDate,
          tray.ageDays,
          tray.status,
          tray.location
        ]);
      }
    }
    console.log(`   ✅ ${farmData.inventory.length} trays inserted`);

    // Insert farm metrics
    console.log('📊 Inserting farm metrics...');
    await client.query(`
      INSERT INTO farm_metrics (
        farm_id, room_count, zone_count, device_count, tray_count, plant_count, 
        energy_24h, alert_count, online_device_count, offline_device_count
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `, [
      dbFarmId,
      farmData.rooms.length,
      zoneCount,
      deviceCount,
      farmData.inventory.length,
      farmData.inventory.reduce((sum, t) => sum + t.plantCount, 0),
      Math.floor(Math.random() * 200) + 150, // Mock energy
      0, // No alerts in demo
      deviceCount, // All online
      0 // None offline
    ]);
    console.log('   ✅ Metrics inserted');

    // Save farm data to JSON for reference
    const outputPath = path.join(__dirname, '../data/demo', `${FARM_ID}-seeded.json`);
    fs.writeFileSync(outputPath, JSON.stringify(farmData, null, 2));
    console.log(`   ✅ Farm data saved to: ${outputPath}`);

    console.log('');
    console.log('✅ Demo farm seeded successfully!');
    console.log('');
    console.log('📋 Summary:');
    console.log(`   Farm ID: ${FARM_ID}`);
    console.log(`   Rooms: ${farmData.rooms.length}`);
    console.log(`   Zones: ${zoneCount}`);
    console.log(`   Devices: ${deviceCount}`);
    console.log(`   Trays: ${farmData.inventory.length}`);
    console.log(`   Plants: ${farmData.inventory.reduce((sum, t) => sum + t.plantCount, 0)}`);
    console.log('');
    console.log('🚀 You can now query this farm from your application!');

  } catch (error) {
    console.error('❌ Seeding failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await client.end();
  }
}

// Run seeding
seedDemoFarm().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
