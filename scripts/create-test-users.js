#!/usr/bin/env node
/**
 * Create test users for multi-tenant isolation testing
 * 
 * This script creates test users for two farms to allow testing that
 * Farm A cannot access Farm B resources.
 */

import pg from 'pg';
import bcrypt from 'bcrypt';

const { Client } = pg;

async function createTestUsers() {
  console.log('\n=== Creating Test Users for Multi-Tenant Testing ===\n');

  const client = new Client({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
  });

  try {
    await client.connect();
    console.log('✓ Connected to database\n');

    // Get two farms for testing
    const farmsResult = await client.query(
      'SELECT farm_id, name FROM farms ORDER BY created_at LIMIT 2'
    );

    if (farmsResult.rows.length < 2) {
      console.error('✗ Need at least 2 farms for multi-tenant testing');
      return;
    }

    const farmA = farmsResult.rows[0];
    const farmB = farmsResult.rows[1];

    console.log(`Farm A: ${farmA.farm_id} (${farmA.name})`);
    console.log(`Farm B: ${farmB.farm_id} (${farmB.name})\n`);

    // Create or update users for both farms
    const testPassword = 'TestPassword123!';
    const passwordHash = await bcrypt.hash(testPassword, 10);

    for (const farm of [farmA, farmB]) {
      const email = `admin@${farm.farm_id.toLowerCase()}.test`;

      // Check if user exists
      const existingUser = await client.query(
        'SELECT user_id FROM users WHERE farm_id = $1 AND email = $2',
        [farm.farm_id, email]
      );

      if (existingUser.rows.length > 0) {
        // Update existing user
        await client.query(
          `UPDATE users
           SET password_hash = $1, is_active = true, role = 'admin'
           WHERE farm_id = $2 AND email = $3`,
          [passwordHash, farm.farm_id, email]
        );
        console.log(`✓ Updated user for ${farm.farm_id}: ${email}`);
      } else {
        // Create new user
        await client.query(
          `INSERT INTO users (farm_id, email, password_hash, name, role, is_active, email_verified, created_at)
           VALUES ($1, $2, $3, $4, 'admin', true, true, NOW())`,
          [farm.farm_id, email, passwordHash, `${farm.name} Admin`]
        );
        console.log(`✓ Created user for ${farm.farm_id}: ${email}`);
      }
    }

    console.log('\n=== Test User Credentials ===\n');
    console.log(`Farm A: ${farmA.farm_id}`);
    console.log(`  Email: admin@${farmA.farm_id.toLowerCase()}.test`);
    console.log(`  Password: ${testPassword}\n`);
    console.log(`Farm B: ${farmB.farm_id}`);
    console.log(`  Email: admin@${farmB.farm_id.toLowerCase()}.test`);
    console.log(`  Password: ${testPassword}\n`);

    console.log('✓ Test users created successfully!\n');

  } catch (error) {
    console.error('✗ Error:', error.message);
    throw error;
  } finally {
    await client.end();
  }
}

createTestUsers().catch(console.error);
