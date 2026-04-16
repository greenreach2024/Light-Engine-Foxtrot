#!/usr/bin/env node

/**
 * Delete farm and associated users for admin@greenreachgreens.com
 * This allows testing the complete signup flow from scratch
 */

const pg = require('pg');

// Use production database configuration from environment
const pool = new pg.Pool({ 
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  max: 5,
  connectionTimeoutMillis: 10000
});

const EMAIL = 'admin@greenreachgreens.com';

async function deleteFarm() {
  try {
    console.log(`\n🔍 Searching for farms and users with email: ${EMAIL}\n`);
    
    // Find all farms
    const farmResult = await pool.query(
      'SELECT farm_id, name, email, plan_type, created_at FROM farms WHERE email = $1', 
      [EMAIL]
    );
    
    console.log('=== Farms Found ===');
    console.log(`Count: ${farmResult.rows.length}`);
    farmResult.rows.forEach(f => {
      console.log(`  - ${f.farm_id}: ${f.name} (${f.plan_type}) - Created: ${f.created_at}`);
    });
    
    // Find all users
    const userResult = await pool.query(
      'SELECT user_id, email, farm_id, role FROM users WHERE email = $1', 
      [EMAIL]
    );
    
    console.log('\n=== Users Found ===');
    console.log(`Count: ${userResult.rows.length}`);
    userResult.rows.forEach(u => {
      console.log(`  - ${u.user_id}: ${u.email} (Farm: ${u.farm_id}, Role: ${u.role})`);
    });
    
    if (farmResult.rows.length === 0 && userResult.rows.length === 0) {
      console.log('\n✓ No farms or users found with this email. Nothing to delete.');
      await pool.end();
      return;
    }
    
    // Delete users first (foreign key constraint)
    if (userResult.rows.length > 0) {
      console.log('\n🗑️  Deleting users...');
      const deleteUsers = await pool.query(
        'DELETE FROM users WHERE email = $1 RETURNING user_id', 
        [EMAIL]
      );
      console.log(`✓ Deleted ${deleteUsers.rows.length} user(s)`);
    }
    
    // Delete farms
    if (farmResult.rows.length > 0) {
      console.log('\n🗑️  Deleting farms...');
      const deleteFarms = await pool.query(
        'DELETE FROM farms WHERE email = $1 RETURNING farm_id, name', 
        [EMAIL]
      );
      console.log(`✓ Deleted ${deleteFarms.rows.length} farm(s):`);
      deleteFarms.rows.forEach(f => console.log(`  - ${f.farm_id}: ${f.name}`));
    }
    
    console.log('\n✅ Deletion complete! You can now test the signup flow from scratch.\n');
    await pool.end();
    
  } catch(e) {
    console.error('\n❌ Error:', e.message);
    console.error(e.stack);
    await pool.end();
    process.exit(1);
  }
}

deleteFarm();
