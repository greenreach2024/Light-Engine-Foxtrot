#!/usr/bin/env node
/**
 * Fix: Add missing columns to farms table and register The Notable Sprout.
 * Then sync flat-file data into farm_data table.
 * Usage: node scripts/fix-and-sync.cjs
 */
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FARM_ID = 'FARM-MLTP9LVH-B0B85039';
const FARM_NAME = 'The Notable Sprout';

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'greenreach_central',
  user: 'postgres',
  password: process.env.DB_PASSWORD || undefined,
});

async function run() {
  const client = await pool.connect();
  try {
    // 1. Fix column lengths (farm_id may be too short)
    console.log('Fixing column lengths...');
    try {
      await client.query('ALTER TABLE farms ALTER COLUMN farm_id TYPE VARCHAR(255)');
      console.log('  farm_id widened to VARCHAR(255)');
    } catch (e) { console.log('  farm_id:', e.message); }

    try {
      await client.query('ALTER TABLE farm_data ALTER COLUMN farm_id TYPE VARCHAR(255)');
      console.log('  farm_data.farm_id widened to VARCHAR(255)');
    } catch (e) { console.log('  farm_data.farm_id:', e.message); }

    // 2. Add missing columns to farms table
    console.log('\nAdding missing columns if needed...');
    const cols = [
      'plan_type VARCHAR(50)',
      'api_key VARCHAR(255)',
      'api_secret VARCHAR(255)',
      'jwt_secret VARCHAR(512)',
      'contact_name VARCHAR(255)',
      'last_heartbeat TIMESTAMP',
      'metadata JSONB DEFAULT \'{}\'',
      'settings JSONB DEFAULT \'{}\'',
      'api_url VARCHAR(500)',
      'email VARCHAR(255)',
    ];
    for (const col of cols) {
      const name = col.split(' ')[0];
      try {
        await client.query(`ALTER TABLE farms ADD COLUMN IF NOT EXISTS ${col}`);
        console.log(`  + ${name} OK`);
      } catch (e) {
        console.log(`  ~ ${name}: ${e.message}`);
      }
    }

    // 3. Register (UPSERT) The Notable Sprout
    console.log(`\nRegistering farm "${FARM_NAME}" (${FARM_ID})...`);
    const crypto = require('crypto');
    const regCode = crypto.randomBytes(4).toString('hex').toUpperCase();
    await client.query(`
      INSERT INTO farms (farm_id, name, status, registration_code, created_at, updated_at)
      VALUES ($1, $2, 'active', $3, NOW(), NOW())
      ON CONFLICT (farm_id) DO UPDATE SET
        name = EXCLUDED.name,
        status = 'active',
        updated_at = NOW()
    `, [FARM_ID, FARM_NAME, regCode]);
    console.log('  Farm registered.');

    // 3. Verify farm exists
    const { rows } = await client.query('SELECT farm_id, name, status FROM farms WHERE farm_id = $1', [FARM_ID]);
    console.log('  Confirmed:', rows[0]);

    // 4. Sync flat-file data into farm_data table
    const SYNC_MAP = [
      { file: 'public/data/groups.json', dataType: 'groups' },
      { file: 'public/data/rooms.json', dataType: 'rooms' },
      { file: 'public/data/schedules.json', dataType: 'schedules' },
    ];

    for (const { file, dataType } of SYNC_MAP) {
      const fullPath = path.join(ROOT, file);
      if (!fs.existsSync(fullPath)) {
        console.log(`SKIP ${file} (not found)`);
        continue;
      }
      const raw = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
      const data = JSON.stringify(raw);
      console.log(`\nSyncing ${file} (${dataType}) → farm_data...`);
      
      await client.query(`
        INSERT INTO farm_data (farm_id, data_type, data, updated_at)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT (farm_id, data_type) DO UPDATE SET
          data = EXCLUDED.data,
          updated_at = NOW()
      `, [FARM_ID, dataType, data]);
      
      const keyCount = Array.isArray(raw) ? raw.length : 
                       (raw[dataType] ? (Array.isArray(raw[dataType]) ? raw[dataType].length : 1) : Object.keys(raw).length);
      console.log(`  OK (${keyCount} items)`);
    }

    // 5. Summary
    const summary = await client.query(
      "SELECT farm_id, data_type, octet_length(data::text) as bytes FROM farm_data WHERE farm_id = $1 ORDER BY data_type",
      [FARM_ID]
    );
    console.log('\nfarm_data for', FARM_ID, ':');
    for (const r of summary.rows) {
      console.log(`  ${r.data_type}: ${r.bytes} bytes`);
    }

    // 6. Show all farms
    const allFarms = await client.query('SELECT farm_id, name, status FROM farms ORDER BY farm_id');
    console.log('\nAll farms in DB:');
    for (const r of allFarms.rows) {
      console.log(`  ${r.farm_id}: ${r.name} (${r.status})`);
    }

  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
