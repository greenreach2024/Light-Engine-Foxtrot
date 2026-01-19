/**
 * Reset password for ReTerminal farm
 */

import pg from 'pg';
const { Client } = pg;
import bcrypt from 'bcryptjs';

const client = new Client({
  host: 'light-engine-db.c8rq44ew6swb.us-east-1.rds.amazonaws.com',
  port: 5432,
  database: 'lightengine',
  user: 'lightengine',
  password: 'LePphcacxDs35ciLLhnkhaXr7',
  ssl: { rejectUnauthorized: false }
});

const FARM_ID = 'FARM-MKLOMAT3-A9D8';
const EMAIL = 'shelbygilbert@rogers.com';
const NEW_PASSWORD = 'ReTerminal2026!';

async function resetPassword() {
  try {
    console.log('[Reset] Connecting to database...');
    await client.connect();
    console.log('[Reset] ✅ Connected to PostgreSQL');

    // Hash the new password
    const password_hash = await bcrypt.hash(NEW_PASSWORD, 10);
    console.log('[Reset] Password hashed');

    // Update the user password
    const result = await client.query(
      `UPDATE users 
       SET password_hash = $1
       WHERE email = $2 AND farm_id = $3
       RETURNING user_id, email, name`,
      [password_hash, EMAIL, FARM_ID]
    );

    if (result.rows.length === 0) {
      console.log('[Reset] ❌ User not found');
      await client.end();
      return;
    }

    const user = result.rows[0];
    
    console.log('\n╔═══════════════════════════════════════════════════╗');
    console.log('║         🔐 PASSWORD RESET SUCCESSFUL 🔐          ║');
    console.log('╚═══════════════════════════════════════════════════╝');
    console.log('');
    console.log('👤 User:', user.name);
    console.log('📧 Email:', user.email);
    console.log('🆔 Farm ID:', FARM_ID);
    console.log('🔑 New Password:', NEW_PASSWORD);
    console.log('');
    console.log('🔗 Login at:');
    console.log('   http://192.168.2.222:8091');
    console.log('   https://www.greenreachgreens.com/login.html');
    console.log('');
    console.log('⚠️  IMPORTANT: Change this password after first login!');
    console.log('');

    await client.end();
    console.log('[Reset] ✅ Database connection closed');

  } catch (error) {
    console.error('[Reset] ❌ Error:', error.message);
    console.error(error);
    await client.end();
    process.exit(1);
  }
}

resetPassword();
