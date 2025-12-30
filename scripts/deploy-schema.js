#!/usr/bin/env node
/**
 * Deploy Database Schema to RDS
 * Runs migrations/001_create_farms_users.sql on production RDS
 */

import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbConfig = {
  host: process.env.DB_HOST || 'light-engine-db.c8rq44ew6swb.us-east-1.rds.amazonaws.com',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'lightengine',
  user: process.env.DB_USER || 'lightengine',
  password: process.env.DB_PASSWORD,
  ssl: { rejectUnauthorized: false }
};

async function deploySchema() {
  console.log('[Deploy Schema] Connecting to RDS...');
  console.log(`[Deploy Schema] Host: ${dbConfig.host}`);
  console.log(`[Deploy Schema] Database: ${dbConfig.database}`);
  
  if (!dbConfig.password) {
    console.error('[Deploy Schema] ERROR: DB_PASSWORD environment variable not set');
    console.error('[Deploy Schema] Set it with: export DB_PASSWORD="your-password"');
    process.exit(1);
  }

  const client = new pg.Client(dbConfig);

  try {
    await client.connect();
    console.log('[Deploy Schema] Connected to RDS');

    // Read migration file
    const migrationPath = path.join(__dirname, '../migrations/001_create_farms_users.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
    
    console.log('[Deploy Schema] Running migration: 001_create_farms_users.sql');
    console.log(`[Deploy Schema] SQL length: ${migrationSQL.length} characters`);

    // Execute migration
    await client.query(migrationSQL);
    console.log('[Deploy Schema] Migration completed successfully');

    // Verify tables created
    const tablesResult = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('farms', 'users', 'rooms')
      ORDER BY table_name;
    `);

    console.log('[Deploy Schema] Tables created:');
    tablesResult.rows.forEach(row => {
      console.log(`  - ${row.table_name}`);
    });

    // Show table structures
    for (const table of ['farms', 'users', 'rooms']) {
      const columnsResult = await client.query(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_name = $1
        ORDER BY ordinal_position;
      `, [table]);

      console.log(`\n[Deploy Schema] Table: ${table} (${columnsResult.rows.length} columns)`);
      columnsResult.rows.forEach(col => {
        console.log(`  - ${col.column_name}: ${col.data_type} ${col.is_nullable === 'NO' ? 'NOT NULL' : 'NULL'}`);
      });
    }

    console.log('\n[Deploy Schema] Schema deployment complete!');
    
  } catch (error) {
    console.error('[Deploy Schema] ERROR:', error.message);
    if (error.code) {
      console.error('[Deploy Schema] Error Code:', error.code);
    }
    process.exit(1);
  } finally {
    await client.end();
  }
}

deploySchema();
