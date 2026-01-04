#!/usr/bin/env node
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  host: 'light-engine-db.c8rq44ew6swb.us-east-1.rds.amazonaws.com',
  port: 5432,
  user: 'lightengine',
  password: 'LePphcacxDs35ciLLhnkhaXr7',
  database: 'lightengine',
  ssl: { rejectUnauthorized: false }
});

async function createAdmin() {
  try {
    const result = await pool.query(
      `INSERT INTO admin_users (email, password_hash, name, active, mfa_enabled, created_at)
       VALUES ($1, $2, $3, true, false, NOW())
       RETURNING id, email, name`,
      ['info@greenreachfarms.com', '$2b$12$yhwYsvrY1WzHfIPB/RNZQOvpUXtiSx1u7z33ukpTrSmmWg1eHlYmi', 'GreenReach Admin']
    );
    console.log('✅ Admin created:', result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      console.log('⚠️  Admin already exists, updating password...');
      await pool.query(
        `UPDATE admin_users SET password_hash = $1 WHERE email = $2`,
        ['$2b$12$yhwYsvrY1WzHfIPB/RNZQOvpUXtiSx1u7z33ukpTrSmmWg1eHlYmi', 'info@greenreachfarms.com']
      );
      console.log('✅ Password updated for info@greenreachfarms.com');
    } else {
      console.error('❌ Error:', error.message);
    }
  } finally {
    await pool.end();
  }
}

createAdmin();
