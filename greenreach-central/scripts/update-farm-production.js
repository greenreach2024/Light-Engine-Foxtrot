/**
 * Update existing farm in production with reTerminal configuration
 * 
 * [APPROVED:REVIEW] Investigation showed farm exists, needs UPDATE not INSERT
 * [APPROVED:ARCH] Updating farm metadata to enable sync
 */

import pg from 'pg';
const { Client } = pg;

const PRODUCTION_CONFIG = {
  host: process.env.PROD_RDS_HOSTNAME || 'light-engine-db.c8rq44ew6swb.us-east-1.rds.amazonaws.com',
  port: 5432,
  database: process.env.PROD_RDS_DB_NAME || 'lightengine',
  user: process.env.PROD_RDS_USERNAME || 'lightengine',
  password: process.env.PROD_RDS_PASSWORD,
  ssl: { rejectUnauthorized: false }
};

async function updateFarm() {
  console.log('🔄 Updating farm FARM-MKLOMAT3-A9D8 in production...\n');
  
  const client = new Client(PRODUCTION_CONFIG);
  
  try {
    await client.connect();
    console.log('✅ Connected to production database\n');
    
    // Update farm with reTerminal configuration
    const result = await client.query(`
      UPDATE farms SET
        api_url = $1,
        api_key = $2,
        contact_name = $3,
        email = $4,
        central_linked = true,
        central_linked_at = NOW(),
        updated_at = NOW()
      WHERE farm_id = $5
      RETURNING *
    `, [
      'http://192.168.2.222:8091',                                     // $1 api_url
      'ae61e0c94acc6c2f6611f2864902dfe8085d18c6aa4b975b33a10b3d6a0e9b3b', // $2 api_key
      'Peter Gilbert',                                                  // $3 contact_name
      'peter@greenreachgreens.com',                                    // $4 email
      'FARM-MKLOMAT3-A9D8'                                             // $5 farm_id
    ]);
    
    if (result.rowCount === 0) {
      console.error('❌ No farm found with ID FARM-MKLOMAT3-A9D8');
      process.exit(1);
    }
    
    console.log('✅ Farm updated successfully:\n');
    console.log(JSON.stringify(result.rows[0], null, 2));
    console.log('\n🎉 Farm is now configured for GreenReach Central sync!\n');
    console.log('📋 Updated fields:');
    console.log('  - api_url: http://192.168.2.222:8091');
    console.log('  - api_key: ae61e0c9... (64 chars)');
    console.log('  - contact_name: Peter Gilbert');
    console.log('  - email: peter@greenreachgreens.com');
    console.log('  - central_linked: true');
    console.log('\n✅ Now test heartbeat from reTerminal!\n');
    
  } catch (error) {
    console.error('❌ Update failed:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

updateFarm();
