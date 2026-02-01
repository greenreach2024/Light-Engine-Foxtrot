/**
 * Register farm in PRODUCTION database (RDS)
 * 
 * This script connects directly to production and registers the farm
 * following the framework: investigate schema, then fix properly.
 */

import pg from 'pg';
const { Client } = pg;

// Production RDS credentials (from Elastic Beanstalk environment)
const PRODUCTION_CONFIG = {
  host: process.env.PROD_RDS_HOSTNAME || 'light-engine-db.c8rq44ew6swb.us-east-1.rds.amazonaws.com',
  port: 5432,
  database: process.env.PROD_RDS_DB_NAME || 'lightengine',
  user: process.env.PROD_RDS_USERNAME || 'lightengine',
  password: process.env.PROD_RDS_PASSWORD, // Must be set in environment
  ssl: { rejectUnauthorized: false }
};

async function queryProductionSchema() {
  console.log('🔍 Querying production database schema...\n');
  
  const client = new Client(PRODUCTION_CONFIG);
  
  try {
    await client.connect();
    console.log('✅ Connected to production database\n');
    
    // Query table structure
    const result = await client.query(`
      SELECT 
        column_name, 
        data_type, 
        is_nullable,
        column_default
      FROM information_schema.columns
      WHERE table_name = 'farms'
      ORDER BY ordinal_position;
    `);
    
    console.log('📋 Production "farms" table schema:\n');
    console.log('| Column | Type | Nullable | Default |');
    console.log('|--------|------|----------|---------|');
    
    result.rows.forEach(row => {
      console.log(`| ${row.column_name} | ${row.data_type} | ${row.is_nullable} | ${row.column_default || 'NULL'} |`);
    });
    
    console.log('\n---\n');
    
    // Check if farm already exists
    const checkFarm = await client.query(
      'SELECT * FROM farms WHERE farm_id = $1',
      ['FARM-MKLOMAT3-A9D8']
    );
    
    if (checkFarm.rows.length > 0) {
      console.log('⚠️  Farm FARM-MKLOMAT3-A9D8 already exists in production:\n');
      console.log(JSON.stringify(checkFarm.rows[0], null, 2));
      console.log('\nUse UPDATE instead of INSERT if you want to modify it.');
      return;
    }
    
    console.log('✅ Farm FARM-MKLOMAT3-A9D8 does not exist yet.\n');
    console.log('📝 Next step: Review schema above and add ALL required fields to registration.\n');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    
    if (error.code === 'ENOTFOUND') {
      console.error('\n⚠️  Cannot connect to production database.');
      console.error('   Set PROD_RDS_HOSTNAME and PROD_RDS_PASSWORD environment variables.');
      console.error('   Or run: eb printenv to get production credentials.\n');
    }
    
    process.exit(1);
  } finally {
    await client.end();
  }
}

async function registerFarmInProduction() {
  console.log('🚀 Registering farm in PRODUCTION database...\n');
  
  const client = new Client(PRODUCTION_CONFIG);
  
  try {
    await client.connect();
    
    // FRAMEWORK COMPLIANCE: This INSERT must include ALL required fields
    // discovered from schema query above
    const result = await client.query(`
      INSERT INTO farms (
        farm_id,
        name,
        contact_name,
        email,
        api_url,
        plan_type,
        api_key,
        api_secret,
        jwt_secret,
        status,
        last_heartbeat,
        metadata,
        settings,
        created_at,
        updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), $11, $12, NOW(), NOW()
      )
      ON CONFLICT (farm_id) DO UPDATE 
      SET 
        name = EXCLUDED.name,
        contact_name = EXCLUDED.contact_name,
        email = EXCLUDED.email,
        api_url = EXCLUDED.api_url,
        plan_type = EXCLUDED.plan_type,
        api_key = EXCLUDED.api_key,
        api_secret = EXCLUDED.api_secret,
        jwt_secret = EXCLUDED.jwt_secret,
        updated_at = NOW()
      RETURNING *
    `, [
      'FARM-MKLOMAT3-A9D8',                                            // $1 farm_id
      'Big Green Farm',                                                 // $2 name
      'Peter Gilbert',                                                  // $3 contact_name
      'peter@greenreachgreens.com',                                    // $4 email
      'http://192.168.2.222:8091',                                     // $5 api_url
      'free',                                                          // $6 plan_type
      'ae61e0c94acc6c2f6611f2864902dfe8085d18c6aa4b975b33a10b3d6a0e9b3b', // $7 api_key
      'auto-generated-secret',                                         // $8 api_secret
      'jwt-secret-placeholder',                                        // $9 jwt_secret
      'offline',                                                       // $10 status
      {},                                                              // $11 metadata
      {}                                                               // $12 settings
    ]);
    
    console.log('✅ Farm registered successfully in PRODUCTION:\n');
    console.log(JSON.stringify(result.rows[0], null, 2));
    console.log('\n🎉 Farm FARM-MKLOMAT3-A9D8 is now registered in GreenReach Central!\n');
    
  } catch (error) {
    console.error('❌ Registration failed:', error.message);
    console.error('\nFull error:');
    console.error(error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

// Main execution
const command = process.argv[2] || 'query';

if (command === 'query') {
  queryProductionSchema();
} else if (command === 'register') {
  registerFarmInProduction();
} else {
  console.log('Usage:');
  console.log('  node register-farm-production.js query     # Show schema');
  console.log('  node register-farm-production.js register  # Register farm');
  process.exit(1);
}
