#!/usr/bin/env node
/**
 * Create First Admin User
 * Run this script to create the initial admin user for GreenReach Central
 * 
 * Usage: node scripts/create-admin-user.js
 */

import pg from 'pg';
import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import readline from 'readline';

const { Pool } = pg;

// Database connection
const pool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

// Create readline interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

async function createAdminUser() {
  console.log('\n=== GreenReach Central - Create Admin User ===\n');

  try {
    // Check if admin_users table exists
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'admin_users'
      );
    `);

    if (!tableCheck.rows[0].exists) {
      console.error('❌ Error: admin_users table does not exist');
      console.log('Please run the database migration first:');
      console.log('  psql $DATABASE_URL -f migrations/003_create_admin_tables.sql');
      process.exit(1);
    }

    // Get admin details from user
    const email = await question('Email address: ');
    if (!email || !email.includes('@')) {
      console.error('❌ Invalid email address');
      process.exit(1);
    }

    // Check if user already exists
    const existingUser = await pool.query(
      'SELECT admin_user_id FROM admin_users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (existingUser.rows.length > 0) {
      console.error(`❌ User with email ${email} already exists`);
      process.exit(1);
    }

    const fullName = await question('Full name: ');
    const password = await question('Password (minimum 8 characters): ');

    if (password.length < 8) {
      console.error('❌ Password must be at least 8 characters');
      process.exit(1);
    }

    const passwordConfirm = await question('Confirm password: ');

    if (password !== passwordConfirm) {
      console.error('❌ Passwords do not match');
      process.exit(1);
    }

    // Hash password
    console.log('\n⏳ Hashing password...');
    const passwordHash = await bcrypt.hash(password, 12);

    // Create admin user
    console.log('⏳ Creating admin user...');
    const result = await pool.query(`
      INSERT INTO admin_users (
        admin_user_id,
        email,
        password_hash,
        full_name,
        role,
        is_active
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING admin_user_id, email, full_name, role
    `, [
      uuidv4(),
      email.toLowerCase(),
      passwordHash,
      fullName || email,
      'super_admin',
      true
    ]);

    const newUser = result.rows[0];

    console.log('\n✅ Admin user created successfully!\n');
    console.log('Details:');
    console.log(`  User ID:   ${newUser.admin_user_id}`);
    console.log(`  Email:     ${newUser.email}`);
    console.log(`  Name:      ${newUser.full_name}`);
    console.log(`  Role:      ${newUser.role}`);
    console.log('\nYou can now login at:');
    console.log('  http://localhost:8091/GR-central-admin-login.html');
    console.log('  (or your production URL)\n');

  } catch (error) {
    console.error('\n❌ Error creating admin user:', error.message);
    process.exit(1);
  } finally {
    rl.close();
    await pool.end();
  }
}

// Run
createAdminUser().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
