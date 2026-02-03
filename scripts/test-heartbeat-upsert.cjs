#!/usr/bin/env node
/**
 * Test the EXACT UPSERT query from sync.js
 */

const { Pool } = require('pg');
const crypto = require('crypto');

const pool = new Pool({
  host: 'light-engine-db.c8rq44ew6swb.us-east-1.rds.amazonaws.com',
  database: 'lightengine',
  user: 'lightengine',
  password: 'LePphcacxDs35ciLLhnkhaXr7',
  port: 5432,
  ssl: { rejectUnauthorized: false }
});

async function testUpsert() {
  const client = await pool.connect();
  try {
    // Same values as heartbeat
    const farmId = 'FARM-MKLOMAT3-A9D8';
    const farmName = 'Big Green Farm';
    const contactName = 'Farm Admin';
    const planType = 'free';
    const apiKeyValue = 'ae61e0c94acc6c2f6611f2864902dfe8085d18c6aa4b975b33a10b3d6a0e9b3b';
    const apiSecret = 'auto-generated';
    const jwtSecret = crypto.randomBytes(32).toString('hex');
    const dbStatus = 'active';
    const metadata = JSON.stringify({ farmName: 'Big Green Farm' });
    
    console.log('Test values:');
    console.log('  farmId:', farmId);
    console.log('  jwtSecret length:', jwtSecret.length);
    console.log('  jwtSecret:', jwtSecret);
    
    console.log('\nExecuting UPSERT...');
    const result = await client.query(
      `INSERT INTO farms (
         farm_id, name, contact_name, plan_type, api_key, api_secret, jwt_secret,
         status, last_heartbeat, metadata, created_at, updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9, NOW(), NOW())
       ON CONFLICT (farm_id) 
       DO UPDATE SET 
         status = EXCLUDED.status,
         name = COALESCE(EXCLUDED.name, farms.name),
         contact_name = COALESCE(EXCLUDED.contact_name, farms.contact_name),
         plan_type = COALESCE(EXCLUDED.plan_type, farms.plan_type),
         jwt_secret = COALESCE(farms.jwt_secret, EXCLUDED.jwt_secret),
         last_heartbeat = NOW(),
         metadata = EXCLUDED.metadata,
         updated_at = NOW()`,
      [
        farmId, 
        farmName,
        contactName,
        planType,
        apiKeyValue,
        apiSecret,
        jwtSecret,
        dbStatus, 
        metadata
      ]
    );
    
    console.log('✅ SUCCESS! UPSERT worked');
    console.log('Result:', result.rowCount, 'rows affected');
    
    // Check the farm
    const check = await client.query('SELECT farm_id, jwt_secret IS NOT NULL as has_jwt, LENGTH(jwt_secret) as len FROM farms WHERE farm_id = $1', [farmId]);
    console.log('\nFarm after UPSERT:', check.rows[0]);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('Detail:', error.detail);
    console.error('Code:', error.code);
  } finally {
    client.release();
    await pool.end();
  }
}

testUpsert();
