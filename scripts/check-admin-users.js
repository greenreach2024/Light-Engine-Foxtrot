#!/usr/bin/env node
/**
 * Check admin_users table structure and existing users
 */

const { Client } = require('pg');

const client = new Client({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
});

async function main() {
  try {
    await client.connect();
    console.log('✓ Connected to database\n');
    
    // Check admin_users table structure
    const cols = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'admin_users' 
      ORDER BY ordinal_position
    `);
    
    console.log('=== admin_users table columns ===');
    cols.rows.forEach(row => {
      console.log(`  - ${row.column_name} (${row.data_type})`);
    });
    
    // Check if any admin users exist
    const users = await client.query('SELECT id, username, role, email FROM admin_users LIMIT 5');
    
    console.log('\n=== Existing admin users ===');
    if (users.rows.length > 0) {
      users.rows.forEach(row => {
        console.log(`  - ${row.username} (${row.role}) - ${row.email || 'no email'}`);
      });
    } else {
      console.log('  (no users found)');
    }
    
    await client.end();
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
