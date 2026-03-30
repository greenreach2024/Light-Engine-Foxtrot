/**
 * Reset password for Green farm
 * Email: info@greereachfarms.com
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

const FARM_ID = 'FARM-MJUKLMO0-9978';
const EMAIL = 'info@greereachfarms.com';
const NEW_PASSWORD = 'Green2025!';

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
    console.log('║         🔑 PASSWORD RESET SUCCESSFUL 🔑          ║');
    console.log('╚═══════════════════════════════════════════════════╝');
    console.log('');
    console.log('🏢 Farm ID:', FARM_ID);
    console.log('🏢 Farm Name: Green');
    console.log('👤 User:', user.name);
    console.log('📧 Email:', user.email);
    console.log('🔑 New Password:', NEW_PASSWORD);
    console.log('');
    console.log('🔗 Login URL: https://www.greenreachgreens.com/login.html');
    console.log('');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');

    await client.end();
    console.log('[Reset] ✅ Complete');
    
  } catch (error) {
    console.error('[Reset] ❌ Error:', error.message);
    await client.end();
    process.exit(1);
  }
}

resetPassword();
