#!/usr/bin/env node
/**
 * Load the generated planting schedule into the database.
 * Uses the farmStore and DB connection from the app.
 * 
 * Usage: node scripts/load-schedule-db.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schedulePath = path.join(__dirname, '..', 'public', 'data', 'planting-schedule.json');

const DATABASE_URL = process.env.DATABASE_URL || process.env.RDS_CONNECTION_STRING;

if (!DATABASE_URL) {
  console.log('No DATABASE_URL found — this script is for production use.');
  console.log('Locally, the schedule will be loaded automatically on the server via the API.');
  console.log('The schedule JSON file is already written and ready for the assistant to use.');
  process.exit(0);
}

async function main() {
  const schedule = JSON.parse(fs.readFileSync(schedulePath, 'utf8'));
  const assignments = schedule.assignments || [];
  
  console.log(`Loading ${assignments.length} planting assignments...`);
  
  const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  
  try {
    // Clear existing assignments
    await pool.query("DELETE FROM planting_assignments WHERE farm_id = 'demo-farm'");
    console.log('Cleared existing assignments.');
    
    // Insert in batches of 10
    let inserted = 0;
    for (let i = 0; i < assignments.length; i += 10) {
      const batch = assignments.slice(i, i + 10);
      const values = [];
      const placeholders = [];
      let paramIdx = 1;
      
      for (const a of batch) {
        placeholders.push(`($${paramIdx}, $${paramIdx+1}, $${paramIdx+2}, $${paramIdx+3}, $${paramIdx+4}, $${paramIdx+5}, $${paramIdx+6}, NOW())`);
        values.push(a.farm_id, a.group_id, a.crop_id, a.crop_name, a.seed_date, a.harvest_date, a.status);
        paramIdx += 7;
      }
      
      await pool.query(
        `INSERT INTO planting_assignments (farm_id, group_id, crop_id, crop_name, seed_date, harvest_date, status, updated_at)
         VALUES ${placeholders.join(', ')}
         ON CONFLICT (farm_id, group_id) DO UPDATE SET crop_id=EXCLUDED.crop_id, crop_name=EXCLUDED.crop_name, seed_date=EXCLUDED.seed_date, harvest_date=EXCLUDED.harvest_date, status=EXCLUDED.status, updated_at=NOW()`,
        values
      );
      inserted += batch.length;
    }
    
    console.log(`Inserted ${inserted} assignments successfully.`);
    
    // Verify
    const result = await pool.query("SELECT crop_name, COUNT(*) as cnt, MIN(seed_date) as first_seed, MAX(harvest_date) as last_harvest FROM planting_assignments WHERE farm_id = 'demo-farm' GROUP BY crop_name ORDER BY crop_name");
    console.log('\nVerification:');
    for (const row of result.rows) {
      console.log(`  ${row.crop_name}: ${row.cnt} groups, seed ${row.first_seed.toISOString().split('T')[0]} → harvest ${row.last_harvest.toISOString().split('T')[0]}`);
    }
    
  } finally {
    await pool.end();
  }
}

main().catch(err => { console.error('Error:', err.message); process.exit(1); });
