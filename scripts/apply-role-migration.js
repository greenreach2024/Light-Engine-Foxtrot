#!/usr/bin/env node
/**
 * Apply Role Column Migration
 * Adds role column to admin_users table
 */

import pg from 'pg';
const { Pool } = pg;
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'light_engine',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

async function runMigration() {
  const client = await pool.connect();
  
  try {
    console.log('🔧 Starting role column migration...');
    console.log('📍 Database:', process.env.DB_HOST || 'localhost');
    
    const migrationSQL = readFileSync(
      join(__dirname, '../migrations/004_add_role_column.sql'),
      'utf8'
    );
    
    await client.query('BEGIN');
    
    // Execute migration
    await client.query(migrationSQL);
    
    await client.query('COMMIT');
    
    console.log('✅ Migration completed successfully');
    
    // Verify the column was added
    const result = await client.query(`
      SELECT column_name, data_type, column_default
      FROM information_schema.columns 
      WHERE table_name = 'admin_users' AND column_name = 'role'
    `);
    
    if (result.rows.length > 0) {
      console.log('✅ Role column verified:', result.rows[0]);
    } else {
      console.log('⚠️  Warning: Could not verify role column');
    }
    
    // Show current users
    const users = await client.query(`
      SELECT id, email, name, role 
      FROM admin_users 
      ORDER BY id
    `);
    
    console.log('\n📋 Current admin users:');
    users.rows.forEach(user => {
      console.log(`  - ${user.name} (${user.email}): role = ${user.role}`);
    });
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', error.message);
    console.error('Details:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
