#!/usr/bin/env node
/**
 * Emergency fix: Set jwt_secret for farms with NULL values
 * Production-safe: Only updates NULL jwt_secret values
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

async function fixNullJwtSecrets() {
  const client = await pool.connect();
  try {
    // Find farms with NULL jwt_secret
    const checkResult = await client.query(
      'SELECT farm_id, name FROM farms WHERE jwt_secret IS NULL'
    );
    
    console.log(`Found ${checkResult.rows.length} farms with NULL jwt_secret:`);
    checkResult.rows.forEach(row => {
      console.log(`  - ${row.farm_id}: ${row.name}`);
    });
    
    if (checkResult.rows.length === 0) {
      console.log('✅ No farms need fixing!');
      return;
    }
    
    // Update each farm with a secure jwt_secret
    for (const farm of checkResult.rows) {
      const jwtSecret = crypto.randomBytes(32).toString('hex');
      await client.query(
        'UPDATE farms SET jwt_secret = $1, updated_at = NOW() WHERE farm_id = $2',
        [jwtSecret, farm.farm_id]
      );
      console.log(`✅ Fixed ${farm.farm_id}`);
    }
    
    // Verify fix
    const verifyResult = await client.query(
      'SELECT COUNT(*) FROM farms WHERE jwt_secret IS NULL'
    );
    
    if (verifyResult.rows[0].count === '0') {
      console.log('\n✅ SUCCESS: All farms now have jwt_secret values');
    } else {
      console.log(`\n⚠️  Warning: ${verifyResult.rows[0].count} farms still have NULL jwt_secret`);
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

fixNullJwtSecrets().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
