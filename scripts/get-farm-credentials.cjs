#!/usr/bin/env node
/**
 * Get Big Green Farm API credentials from production
 */

const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.RDS_HOSTNAME,
  port: parseInt(process.env.RDS_PORT),
  database: process.env.RDS_DB_NAME,
  user: process.env.RDS_USERNAME,
  password: process.env.RDS_PASSWORD,
  ssl: { rejectUnauthorized: false },
  max: 1
});

async function getCredentials() {
  try {
    const result = await pool.query(`
      SELECT farm_id, name, api_key, api_secret, status, last_heartbeat
      FROM farms
      WHERE farm_id = 'FARM-MKLOMAT3-A9D8';
    `);

    if (result.rows.length === 0) {
      console.log('❌ Farm not found');
      process.exit(1);
    }

    const farm = result.rows[0];
    console.log('🔑 Big Green Farm Credentials:');
    console.log('================================');
    console.log(`Farm ID: ${farm.farm_id}`);
    console.log(`Name: ${farm.name}`);
    console.log(`API Key: ${farm.api_key}`);
    console.log(`API Secret: ${farm.api_secret}`);
    console.log(`Status: ${farm.status}`);
    console.log(`Last Heartbeat: ${farm.last_heartbeat}`);
    console.log('');
    console.log(`Test command:`);
    console.log(`curl -X POST https://greenreachgreens.com/api/sync/heartbeat \\`);
    console.log(`  -H 'Content-Type: application/json' \\`);
    console.log(`  -H 'X-API-Key: ${farm.api_key}' \\`);
    console.log(`  -H 'X-Farm-ID: ${farm.farm_id}' \\`);
    console.log(`  -d '{"status":"online","metadata":{"farmName":"${farm.name}"}}'`);

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

getCredentials();
