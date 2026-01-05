/**
 * Check farm login credentials and create farm if needed
 * Usage: node scripts/check-farm-login.js <email> [farm_id]
 */

import pg from 'pg';
const { Client } = pg;
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

// Production database
const client = new Client({
  host: 'light-engine-db.c8rq44ew6swb.us-east-1.rds.amazonaws.com',
  port: 5432,
  database: 'lightengine',
  user: 'lightengine',
  password: 'LePphcacxDs35ciLLhnkhaXr7',
  ssl: { rejectUnauthorized: false }
});

const email = process.argv[2];
const farmIdArg = process.argv[3];

if (!email) {
  console.error('Usage: node scripts/check-farm-login.js <email> [farm_id]');
  process.exit(1);
}

async function checkFarmLogin() {
  try {
    console.log('[Check] Connecting to production database...');
    await client.connect();
    console.log('[Check] ✅ Connected\n');

    // Check if user exists
    const userResult = await client.query(
      `SELECT u.user_id, u.email, u.farm_id, u.role, u.is_active, f.name as farm_name, f.status as farm_status
       FROM users u
       LEFT JOIN farms f ON u.farm_id = f.farm_id
       WHERE lower(u.email) = lower($1)`,
      [email]
    );

    if (userResult.rows.length > 0) {
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('✅ USER FOUND');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      
      for (const user of userResult.rows) {
        console.log('\nUser Email:', user.email);
        console.log('Farm ID:', user.farm_id);
        console.log('Farm Name:', user.farm_name || '(Farm not found)');
        console.log('Farm Status:', user.farm_status || '(Farm not found)');
        console.log('User Role:', user.role);
        console.log('User Active:', user.is_active);
        
        if (!user.farm_name) {
          console.log('\n⚠️  WARNING: User exists but farm record is missing!');
        }
        
        if (user.farm_status !== 'active') {
          console.log('\n⚠️  WARNING: Farm status is not active!');
        }
        
        if (!user.is_active) {
          console.log('\n⚠️  WARNING: User account is not active!');
        }
      }
      
      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
      
      if (userResult.rows.length === 1 && userResult.rows[0].farm_name && userResult.rows[0].farm_status === 'active') {
        console.log('✅ Login should work with:');
        console.log(`   Farm ID: ${userResult.rows[0].farm_id}`);
        console.log(`   Email: ${email}`);
        console.log('   Password: (use your password or request reset)\n');
      }
      
    } else {
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('❌ NO USER FOUND');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
      console.log('Would you like to create a new farm account?');
      console.log('Run: node scripts/create-farm-account.js <email> <name> <farm_name>\n');
    }

    // If farm ID was provided, check if it exists
    if (farmIdArg) {
      console.log('\n[Check] Checking specific farm ID:', farmIdArg);
      
      const farmResult = await client.query(
        'SELECT farm_id, name, email, status, plan_type, created_at FROM farms WHERE farm_id = $1',
        [farmIdArg]
      );
      
      if (farmResult.rows.length > 0) {
        const farm = farmResult.rows[0];
        console.log('\n✅ FARM EXISTS:');
        console.log('   Farm ID:', farm.farm_id);
        console.log('   Name:', farm.name);
        console.log('   Email:', farm.email);
        console.log('   Status:', farm.status);
        console.log('   Plan:', farm.plan_type);
        console.log('   Created:', farm.created_at);
        
        // Check if user has access to this farm
        const userFarmCheck = await client.query(
          'SELECT email, role FROM users WHERE farm_id = $1 AND lower(email) = lower($2)',
          [farmIdArg, email]
        );
        
        if (userFarmCheck.rows.length === 0) {
          console.log('\n⚠️  This farm exists but the email', email, 'is not associated with it!');
        }
      } else {
        console.log('\n❌ FARM NOT FOUND:', farmIdArg);
        console.log('This farm ID does not exist in the database.');
      }
    }

    await client.end();
    
  } catch (error) {
    console.error('[Check] Error:', error.message);
    await client.end();
    process.exit(1);
  }
}

checkFarmLogin();
