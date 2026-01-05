/**
 * Create a farm account with user
 * Usage: node scripts/create-farm-account.js <email> <contact_name> <farm_name> [plan_type]
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
const contactName = process.argv[3];
const farmName = process.argv[4];
const planType = process.argv[5] || 'cloud';

if (!email || !contactName || !farmName) {
  console.error('Usage: node scripts/create-farm-account.js <email> <contact_name> <farm_name> [plan_type]');
  console.error('Example: node scripts/create-farm-account.js user@example.com "John Doe" "John\'s Farm" cloud');
  process.exit(1);
}

async function createFarmAccount() {
  try {
    console.log('[Setup] Connecting to production database...');
    await client.connect();
    console.log('[Setup] ✅ Connected\n');

    // Check if email already exists
    const existingUser = await client.query(
      'SELECT u.email, u.farm_id, f.name as farm_name FROM users u LEFT JOIN farms f ON u.farm_id = f.farm_id WHERE lower(u.email) = lower($1)',
      [email]
    );

    if (existingUser.rows.length > 0) {
      console.log('⚠️  Email already exists!');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      for (const user of existingUser.rows) {
        console.log('Email:', user.email);
        console.log('Farm ID:', user.farm_id);
        console.log('Farm Name:', user.farm_name || '(No farm)');
      }
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
      console.log('Use: node scripts/check-farm-login.js', email);
      await client.end();
      return;
    }

    // Generate farm ID
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = crypto.randomBytes(2).toString('hex').toUpperCase();
    const farmId = `FARM-${timestamp}-${random}`;
    
    console.log('[Setup] Generated Farm ID:', farmId);

    // Generate API credentials
    const apiKey = `sk_${crypto.randomBytes(24).toString('base64url')}`;
    const apiSecret = crypto.randomBytes(32).toString('hex');
    const jwtSecret = crypto.randomBytes(32).toString('hex');
    
    // Generate temporary password
    const tempPassword = crypto.randomBytes(8).toString('base64url');
    const passwordHash = await bcrypt.hash(tempPassword, 10);
    
    console.log('[Setup] Generated credentials');

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
      farmId,
      farmName,
      email,
      contactName,
      planType,
      apiKey,
      apiSecret,
      jwtSecret
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
      farmId,
      email,
      passwordHash,
      contactName
    ]);
    
    console.log('[Setup] ✅ Admin user created\n');

    // Display credentials
    console.log('╔═══════════════════════════════════════════════════╗');
    console.log('║         🌱 FARM ACCOUNT CREATED 🌱               ║');
    console.log('╚═══════════════════════════════════════════════════╝');
    console.log('');
    console.log('🏢 Farm Name:', farmName);
    console.log('🆔 Farm ID:', farmId);
    console.log('👤 Contact:', contactName);
    console.log('📧 Email:', email);
    console.log('🔑 Temporary Password:', tempPassword);
    console.log('📦 Plan Type:', planType);
    console.log('');
    console.log('🔗 Login URL:');
    console.log('   https://www.greenreachgreens.com/login.html');
    console.log('   http://light-engine-foxtrot-prod.eba-ukiyyqf9.us-east-1.elasticbeanstalk.com/login.html');
    console.log('');
    console.log('⚠️  IMPORTANT: Save these credentials and change the password after first login!');
    console.log('');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');

    await client.end();
    
  } catch (error) {
    console.error('[Setup] Error:', error.message);
    console.error(error);
    await client.end();
    process.exit(1);
  }
}

createFarmAccount();
