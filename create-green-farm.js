/**
 * Create farm account for Green farm
 * Email: info@greereachfarms.com
 */

import pg from 'pg';
const { Client } = pg;
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

// Use AWS production database directly
const client = new Client({
  host: 'light-engine-db.c8rq44ew6swb.us-east-1.rds.amazonaws.com',
  port: 5432,
  database: 'lightengine',
  user: 'lightengine',
  password: 'LePphcacxDs35ciLLhnkhaXr7',
  ssl: { rejectUnauthorized: false }
});

// Farm details
const FARM_DATA = {
  name: 'Green',
  email: 'info@greereachfarms.com',
  contact_name: 'Reach',
  plan_type: 'cloud'
};

async function createFarm() {
  try {
    console.log('[Setup] Connecting to database...');
    await client.connect();
    console.log('[Setup] ✅ Connected to PostgreSQL');

    // Generate farm ID
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = crypto.randomBytes(2).toString('hex').toUpperCase();
    const farm_id = `FARM-${timestamp}-${random}`;
    
    console.log('[Setup] Generated Farm ID:', farm_id);

    // Generate API credentials
    const api_key = `sk_${crypto.randomBytes(24).toString('base64url')}`;
    const api_secret = crypto.randomBytes(32).toString('hex');
    const jwt_secret = crypto.randomBytes(32).toString('hex');
    
    // Generate temporary password
    const temp_password = crypto.randomBytes(8).toString('base64url');
    const password_hash = await bcrypt.hash(temp_password, 10);
    
    console.log('[Setup] Generated temporary password');

    // Check if email already exists
    const existingUser = await client.query(
      'SELECT email FROM users WHERE email = $1',
      [FARM_DATA.email]
    );

    if (existingUser.rows.length > 0) {
      console.log('[Setup] ⚠️  Email already exists in database');
      console.log('[Setup] Retrieving existing account...');
      
      const existingFarm = await client.query(
        `SELECT f.farm_id, f.name, u.email 
         FROM users u 
         JOIN farms f ON u.farm_id = f.farm_id 
         WHERE u.email = $1`,
        [FARM_DATA.email]
      );
      
      if (existingFarm.rows.length > 0) {
        const farm = existingFarm.rows[0];
        console.log('\n[Setup] ✅ EXISTING ACCOUNT FOUND:');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('Farm ID:', farm.farm_id);
        console.log('Farm Name:', farm.name);
        console.log('Email:', farm.email);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('\n[Setup] Use the admin panel to reset the password.');
        await client.end();
        return;
      }
    }

    // Create farm record
    console.log('[Setup] Creating farm record...');
    await client.query(`
      INSERT INTO farms (
        farm_id,
        name,
        email,
        contact_name,
        plan_type,
        api_key,
        api_secret,
        jwt_secret,
        status,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active', NOW())
    `, [
      farm_id,
      FARM_DATA.name,
      FARM_DATA.email,
      FARM_DATA.contact_name,
      FARM_DATA.plan_type,
      api_key,
      api_secret,
      jwt_secret
    ]);
    
    console.log('[Setup] ✅ Farm record created');

    // Create admin user
    console.log('[Setup] Creating admin user...');
    await client.query(`
      INSERT INTO users (
        farm_id,
        email,
        password_hash,
        name,
        role,
        is_active,
        email_verified,
        created_at
      ) VALUES ($1, $2, $3, $4, 'admin', true, true, NOW())
    `, [
      farm_id,
      FARM_DATA.email,
      password_hash,
      FARM_DATA.contact_name
    ]);
    
    console.log('[Setup] ✅ Admin user created');

    // Display credentials
    console.log('\n╔═══════════════════════════════════════════════════╗');
    console.log('║         🌱 FARM ACCOUNT CREATED 🌱               ║');
    console.log('╚═══════════════════════════════════════════════════╝');
    console.log('');
    console.log('🏢 Farm Name:', FARM_DATA.name);
    console.log('🆔 Farm ID:', farm_id);
    console.log('📧 Email:', FARM_DATA.email);
    console.log('🔑 Temporary Password:', temp_password);
    console.log('');
    console.log('🔗 Login URL: http://light-engine-foxtrot-prod.eba-ukiyyqf9.us-east-1.elasticbeanstalk.com/login.html');
    console.log('');
    console.log('⚠️  IMPORTANT: Change your password immediately after first login!');
    console.log('');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');

    await client.end();
    console.log('[Setup] ✅ Database connection closed');

  } catch (error) {
    console.error('[Setup] ❌ Error:', error.message);
    console.error('[Setup] Error details:', error);
    await client.end();
    process.exit(1);
  }
}

createFarm();
