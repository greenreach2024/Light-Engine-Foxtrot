#!/usr/bin/env node
/**
 * Production Schema Verification Script
 * Safely checks farms table structure before migration
 * READ-ONLY - no data modifications
 */

const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.RDS_HOSTNAME,
  port: parseInt(process.env.RDS_PORT),
  database: process.env.RDS_DB_NAME,
  user: process.env.RDS_USERNAME,
  password: process.env.RDS_PASSWORD,
  ssl: { rejectUnauthorized: false },
  max: 1, // Single connection for safety
  connectionTimeoutMillis: 5000
});

async function verifySchema() {
  try {
    console.log('🔍 Connecting to production database...');
    console.log(`   Host: ${process.env.RDS_HOSTNAME}`);
    console.log(`   Database: ${process.env.RDS_DB_NAME}\n`);

    // 1. Check if farms table exists
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'farms'
      );
    `);
    
    if (!tableCheck.rows[0].exists) {
      console.log('❌ farms table does not exist!');
      process.exit(1);
    }
    
    console.log('✅ farms table exists\n');

    // 2. Get current column structure
    const columns = await pool.query(`
      SELECT 
        column_name, 
        data_type, 
        is_nullable,
        column_default
      FROM information_schema.columns 
      WHERE table_name = 'farms'
      ORDER BY ordinal_position;
    `);

    console.log('📋 Current farms table columns:');
    console.log('=====================================');
    columns.rows.forEach(col => {
      const nullable = col.is_nullable === 'YES' ? 'NULL' : 'NOT NULL';
      const hasDefault = col.column_default ? ` DEFAULT ${col.column_default}` : '';
      console.log(`  ${col.column_name.padEnd(20)} ${col.data_type.padEnd(25)} ${nullable}${hasDefault}`);
    });
    console.log('');

    // 3. Count existing farms
    const farmCount = await pool.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(DISTINCT farm_id) as unique_farms,
        MAX(last_heartbeat) as latest_heartbeat
      FROM farms;
    `);

    const { total, unique_farms, latest_heartbeat } = farmCount.rows[0];
    console.log('📊 Farm data statistics:');
    console.log(`  Total rows: ${total}`);
    console.log(`  Unique farm_ids: ${unique_farms}`);
    console.log(`  Latest heartbeat: ${latest_heartbeat || 'N/A'}\n`);

    // 4. Sample farm data (first 3 farms)
    if (parseInt(total) > 0) {
      const sampleFarms = await pool.query(`
        SELECT farm_id, name, status, last_heartbeat
        FROM farms
        ORDER BY last_heartbeat DESC NULLS LAST
        LIMIT 3;
      `);

      console.log('📄 Sample farm records:');
      console.log('=====================================');
      sampleFarms.rows.forEach(farm => {
        console.log(`  Farm ID: ${farm.farm_id}`);
        console.log(`    Name: ${farm.name || 'N/A'}`);
        console.log(`    Status: ${farm.status || 'N/A'}`);
        console.log(`    Last heartbeat: ${farm.last_heartbeat || 'N/A'}`);
        console.log('');
      });
    }

    // 5. Check for columns that migration 002 will add
    const expectedColumns = [
      'email', 'phone', 'contact_name', 'plan_type', 'api_key', 'api_secret',
      'jwt_secret', 'square_payment_id', 'square_amount', 'timezone',
      'business_hours', 'certifications', 'registration_code'
    ];

    const existingColumnNames = columns.rows.map(c => c.column_name);
    const missingColumns = expectedColumns.filter(col => !existingColumnNames.includes(col));
    const existingMigrationColumns = expectedColumns.filter(col => existingColumnNames.includes(col));

    console.log('🔍 Migration 002 impact analysis:');
    console.log('=====================================');
    console.log(`  Columns to ADD: ${missingColumns.length}`);
    missingColumns.forEach(col => console.log(`    - ${col}`));
    console.log('');
    
    if (existingMigrationColumns.length > 0) {
      console.log(`  Columns already exist: ${existingMigrationColumns.length}`);
      existingMigrationColumns.forEach(col => console.log(`    - ${col}`));
      console.log('');
    }

    // 6. Check for created_at/updated_at
    const hasTimestamps = existingColumnNames.includes('created_at') && existingColumnNames.includes('updated_at');
    console.log(`  Timestamp columns: ${hasTimestamps ? '✅ Present' : '❌ Missing (need to add)'}\n`);

    console.log('✅ Schema verification complete');
    console.log('=====================================');
    console.log('Safe to proceed with migration 002');

  } catch (error) {
    console.error('❌ Error during schema verification:');
    console.error(error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run verification
verifySchema();
