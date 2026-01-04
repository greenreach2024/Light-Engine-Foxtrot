#!/usr/bin/env node
/**
 * Create Admin User in Database
 * Usage: node scripts/create-admin.js <email> <password> <name>
 */

import pg from 'pg';
import bcrypt from 'bcrypt';

const { Pool } = pg;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  user: process.env.DB_USER || 'lightengine',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'lightengine',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
});

async function createAdminUser(email, password, name) {
  try {
    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    // Check if user already exists
    const existing = await pool.query('SELECT id FROM admin_users WHERE email = $1', [email.toLowerCase()]);

    if (existing.rows.length > 0) {
      console.log(`❌ Admin user ${email} already exists with ID ${existing.rows[0].id}`);
      console.log('To update password, use: node scripts/reset-admin-password.js');
      process.exit(1);
    }

    // Create admin user
    const result = await pool.query(
      `INSERT INTO admin_users (email, password_hash, name, active, role, mfa_enabled, created_at)
       VALUES ($1, $2, $3, true, 'super_admin', false, NOW())
       RETURNING id, email, name, role`,
      [email.toLowerCase(), passwordHash, name]
    );

    const user = result.rows[0];
    console.log('✅ Admin user created successfully!');
    console.log(`   ID: ${user.id}`);
    console.log(`   Email: ${user.email}`);
    console.log(`   Name: ${user.name}`);
    console.log(`   Role: ${user.role}`);
    console.log('');
    console.log('You can now login at: https://www.greenreachgreens.com/GR-central-admin-login.html');

  } catch (error) {
    console.error('❌ Error creating admin user:', error.message);
    if (error.code === '42P01') {
      console.error('   The admin_users table does not exist.');
      console.error('   Run database migrations first: npm run migrate');
    }
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Parse command line arguments
const args = process.argv.slice(2);

if (args.length < 3) {
  console.log('Usage: node scripts/create-admin.js <email> <password> <name>');
  console.log('Example: node scripts/create-admin.js admin@example.com MyPassword123 "Admin User"');
  process.exit(1);
}

const [email, password, name] = args;

if (password.length < 8) {
  console.error('❌ Password must be at least 8 characters long');
  process.exit(1);
}

createAdminUser(email, password, name);
