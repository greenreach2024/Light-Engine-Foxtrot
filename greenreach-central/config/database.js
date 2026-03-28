/**
 * Database Configuration and Connection Management
 */

import fs from 'fs';
import path from 'path';
import pg from 'pg';
import logger from '../utils/logger.js';

const { Pool } = pg;

let pool = null;

// SSL rejectUnauthorized: respect DB_SSL_REJECT_UNAUTHORIZED env var override.
// Defaults to true in production, false otherwise.
const sslRejectUnauthorized = process.env.DB_SSL_REJECT_UNAUTHORIZED !== undefined
  ? process.env.DB_SSL_REJECT_UNAUTHORIZED !== "false"
  : process.env.NODE_ENV === "production";
let db = null;

/**
 * Initialize PostgreSQL connection pool
 * Supports DATABASE_URL (connection string) OR individual RDS / DB env vars.
 * Retries up to 3 times with exponential backoff on initial connection failure.
 */
export async function initDatabase() {
  if (pool) {
    logger.info('Database already initialized');
    return;
  }

  let poolConfig;

  // Support DATABASE_URL connection string (common in Heroku, Railway, manual configs)
  if (process.env.DATABASE_URL) {
    logger.info('Using DATABASE_URL connection string');
    poolConfig = {
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DB_SSL !== 'false' ? { rejectUnauthorized: sslRejectUnauthorized } : false,
      max: parseInt(process.env.DB_POOL_MAX) || 20,
      idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT) || 30000,
      connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT) || 10000,
    };
  } else {
    // Individual env vars (EB RDS auto-inject pattern)
    poolConfig = {
      host: process.env.RDS_HOSTNAME || process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.RDS_PORT || process.env.DB_PORT) || 5432,
      database: process.env.RDS_DB_NAME || process.env.DB_NAME || 'greenreach_central',
      user: process.env.RDS_USERNAME || process.env.DB_USER || 'postgres',
      password: process.env.RDS_PASSWORD || process.env.DB_PASSWORD,
      ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: sslRejectUnauthorized } : false,
      max: parseInt(process.env.DB_POOL_MAX) || 20,
      idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT) || 30000,
      connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT) || 10000,
    };
    logger.info(`Connecting to PostgreSQL at ${poolConfig.host}:${poolConfig.port}/${poolConfig.database}`);
  }

  // Retry logic: 3 attempts with exponential backoff (1s, 2s)
  const MAX_RETRIES = 3;
  let lastError;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      pool = new Pool(poolConfig);

      const client = await pool.connect();
      logger.info(`Database connection established (attempt ${attempt}/${MAX_RETRIES})`);

      // Run migrations (non-fatal — partial migration failures should not kill the pool)
      try {
        await runMigrations(client);
      } catch (migrationError) {
        logger.warn(`Database migrations incomplete (non-fatal): ${migrationError.message}`);
      }
      client.release();

      // Handle pool errors (reconnect-safe logging)
      pool.on('error', (err) => {
        logger.error('Unexpected database pool error:', err);
      });

      return; // Success — pool is active even if some migrations failed
    } catch (error) {
      lastError = error;
      logger.warn(`Database connection attempt ${attempt}/${MAX_RETRIES} failed: ${error.message}`);
      if (pool) { try { await pool.end(); } catch (_) { /* ignore */ } }
      pool = null;

      if (attempt < MAX_RETRIES) {
        const delay = Math.min(attempt * 1000, 2000); // 1s, 2s (fast retries)
        logger.info(`Retrying in ${delay / 1000}s...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  // All retries exhausted
  logger.error('Database connection failed after all retries:', lastError);
  pool = null;
  throw lastError;
}

/**
 * Run database migrations
 */
async function runMigrations(client) {
  logger.info('Running database migrations...');

  // Portable UUID v4 generator — works on ALL PostgreSQL versions without extensions
  try {
    await client.query(`
      CREATE OR REPLACE FUNCTION _gr_uuid() RETURNS UUID AS $$
        SELECT md5(random()::text || ':' || clock_timestamp()::text)::uuid;
      $$ LANGUAGE SQL VOLATILE;
    `);
  } catch (err) {
    logger.warn('_gr_uuid helper creation warning:', err.message);
  }

  // Create farms table
  await client.query(`
    CREATE TABLE IF NOT EXISTS farms (
      id SERIAL PRIMARY KEY,
      farm_id VARCHAR(255) UNIQUE NOT NULL,
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255),
      api_url VARCHAR(500),
      status VARCHAR(50) DEFAULT 'offline',
      last_heartbeat TIMESTAMP,
      metadata JSONB DEFAULT '{}',
      settings JSONB DEFAULT '{}',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
    
    CREATE INDEX IF NOT EXISTS idx_farms_farm_id ON farms(farm_id);
    CREATE INDEX IF NOT EXISTS idx_farms_status ON farms(status);
  `);
  
  // Add missing columns to existing farms table (migration for old schemas)
  try {
    await client.query(`
      ALTER TABLE farms ADD COLUMN IF NOT EXISTS last_heartbeat TIMESTAMP;
    `);
    logger.info('Added last_heartbeat column to farms table');
  } catch (err) {
    logger.warn('Could not add last_heartbeat column (may already exist):', err.message);
  }
  
  try {
    await client.query(`
      ALTER TABLE farms ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';
    `);
    logger.info('Added metadata column to farms table');
  } catch (err) {
    logger.warn('Could not add metadata column (may already exist):', err.message);
  }

  try {
    await client.query(`
      ALTER TABLE farms ADD COLUMN IF NOT EXISTS email VARCHAR(255);
    `);
    logger.info('Added email column to farms table');
  } catch (err) {
    logger.warn('Could not add email column (may already exist):', err.message);
  }

  try {
    await client.query(`
      ALTER TABLE farms ADD COLUMN IF NOT EXISTS api_url VARCHAR(500);
    `);
    logger.info('Added api_url column to farms table');
  } catch (err) {
    logger.warn('Could not add api_url column (may already exist):', err.message);
  }

  try {
    await client.query(`
      ALTER TABLE farms ADD COLUMN IF NOT EXISTS contact_name VARCHAR(255);
    `);
    logger.info('Added contact_name column to farms table');
  } catch (err) {
    logger.warn('Could not add contact_name column (may already exist):', err.message);
  }

  // Phase 4: Add slug column for subdomain routing (cloud SaaS)
  try {
    await client.query(`
      ALTER TABLE farms ADD COLUMN IF NOT EXISTS slug VARCHAR(100);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_farms_slug ON farms(slug) WHERE slug IS NOT NULL;
    `);
    logger.info('Added slug column to farms table (subdomain routing)');
  } catch (err) {
    logger.warn('Could not add slug column (may already exist):', err.message);
  }

  // Auto-generate slugs for farms that lack one (name → lowercase-dashed)
  try {
    await client.query(`
      UPDATE farms
         SET slug = LOWER(REGEXP_REPLACE(REGEXP_REPLACE(TRIM(name), '[^a-zA-Z0-9]+', '-', 'g'), '(^-|-$)', '', 'g'))
       WHERE slug IS NULL AND name IS NOT NULL AND TRIM(name) <> '';
    `);
    logger.info('Auto-generated slugs for existing farms');
  } catch (err) {
    logger.warn('Could not auto-generate slugs:', err.message);
  }

  // Create farm_backups table for farm server recovery (Phase 2)
  await client.query(`
    CREATE TABLE IF NOT EXISTS farm_backups (
      farm_id VARCHAR(255) PRIMARY KEY,
      groups JSONB NOT NULL DEFAULT '[]',
      rooms JSONB NOT NULL DEFAULT '[]',
      schedules JSONB NOT NULL DEFAULT '[]',
      config JSONB,
      last_synced TIMESTAMP DEFAULT NOW(),
      created_at TIMESTAMP DEFAULT NOW(),
      FOREIGN KEY (farm_id) REFERENCES farms(farm_id) ON DELETE CASCADE
    );
    
    CREATE INDEX IF NOT EXISTS idx_farm_backups_synced ON farm_backups(last_synced);
    CREATE INDEX IF NOT EXISTS idx_farm_backups_farm_id ON farm_backups(farm_id);
  `);
  logger.info('farm_backups table ready for farm server recovery');

  try {
    await client.query(`
      ALTER TABLE farms ADD COLUMN IF NOT EXISTS settings JSONB DEFAULT '{}';
    `);
    logger.info('Added settings column to farms table');
  } catch (err) {
    logger.warn('Could not add settings column (may already exist):', err.message);
  }
  
  // Make existing columns nullable (migration from old schema)
  try {
    await client.query(`
      ALTER TABLE farms ALTER COLUMN email DROP NOT NULL;
      ALTER TABLE farms ALTER COLUMN name DROP NOT NULL;
    `);
    logger.info('Made email and name columns nullable in farms table');
  } catch (err) {
    logger.warn('Could not alter column constraints:', err.message);
  }

  // Compatibility migration: older production schemas are missing columns used by sync/admin/accounting
  try {
    await client.query(`
      ALTER TABLE farms ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();
      ALTER TABLE farms ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();
      ALTER TABLE farms ADD COLUMN IF NOT EXISTS last_sync TIMESTAMP;
      ALTER TABLE farms ADD COLUMN IF NOT EXISTS farm_type VARCHAR(100);
      ALTER TABLE farms ADD COLUMN IF NOT EXISTS city VARCHAR(120);
      ALTER TABLE farms ADD COLUMN IF NOT EXISTS state VARCHAR(120);
      ALTER TABLE farms ADD COLUMN IF NOT EXISTS certifications JSONB DEFAULT '[]';
      ALTER TABLE farms ADD COLUMN IF NOT EXISTS practices JSONB DEFAULT '[]';
      ALTER TABLE farms ADD COLUMN IF NOT EXISTS attributes JSONB DEFAULT '[]';
      ALTER TABLE farms ADD COLUMN IF NOT EXISTS tier VARCHAR(50);
      ALTER TABLE farms ADD COLUMN IF NOT EXISTS registration_code VARCHAR(255);
      ALTER TABLE farms ADD COLUMN IF NOT EXISTS payment_provider VARCHAR(50) DEFAULT 'square';
      ALTER TABLE farms ADD COLUMN IF NOT EXISTS stripe_account_id VARCHAR(255);
      ALTER TABLE farms ADD COLUMN IF NOT EXISTS stripe_access_token JSONB;
      ALTER TABLE farms ADD COLUMN IF NOT EXISTS stripe_refresh_token JSONB;
      ALTER TABLE farms ADD COLUMN IF NOT EXISTS stripe_token_expiry TIMESTAMP;

      ALTER TABLE farms ALTER COLUMN contact_name DROP NOT NULL;
      ALTER TABLE farms ALTER COLUMN email DROP NOT NULL;
      ALTER TABLE farms ALTER COLUMN name DROP NOT NULL;

      UPDATE farms
         SET last_sync = COALESCE(last_sync, updated_at, NOW())
       WHERE last_sync IS NULL;
    `);
    logger.info('Added farm compatibility columns (sync/admin/accounting)');
  } catch (err) {
    logger.warn('Farm compatibility migration warning:', err.message);
  }

  // Add missing timestamp columns to tables from older schemas
  const tablesNeedingTimestamps = [
    'farms', 'farm_data', 'planting_assignments', 'products',
    'wholesale_buyers', 'wholesale_orders', 'device_integrations'
  ];
  for (const tbl of tablesNeedingTimestamps) {
    try {
      await client.query(`
        ALTER TABLE ${tbl} ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();
        ALTER TABLE ${tbl} ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();
      `);
    } catch (err) {
      // Table may not exist yet — that's fine, CREATE TABLE will handle it
    }
  }

  // Create farm_heartbeats table
  await client.query(`
    CREATE TABLE IF NOT EXISTS farm_heartbeats (
      id SERIAL PRIMARY KEY,
      farm_id VARCHAR(255) NOT NULL,
      cpu_usage FLOAT,
      memory_usage FLOAT,
      disk_usage FLOAT,
      metadata JSONB DEFAULT '{}',
      timestamp TIMESTAMP DEFAULT NOW(),
      FOREIGN KEY (farm_id) REFERENCES farms(farm_id) ON DELETE CASCADE
    );
    
    CREATE INDEX IF NOT EXISTS idx_heartbeats_farm_id ON farm_heartbeats(farm_id);
    CREATE INDEX IF NOT EXISTS idx_heartbeats_timestamp ON farm_heartbeats(timestamp);
  `);

  // Create farm_data table for synced farm data (rooms, groups, schedules)
  await client.query(`
    CREATE TABLE IF NOT EXISTS farm_data (
      id SERIAL PRIMARY KEY,
      farm_id VARCHAR(255) NOT NULL,
      data_type VARCHAR(50) NOT NULL,
      data JSONB NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      FOREIGN KEY (farm_id) REFERENCES farms(farm_id) ON DELETE CASCADE,
      UNIQUE(farm_id, data_type)
    );
    
    CREATE INDEX IF NOT EXISTS idx_farm_data_farm_id ON farm_data(farm_id);
    CREATE INDEX IF NOT EXISTS idx_farm_data_type ON farm_data(data_type);
    CREATE INDEX IF NOT EXISTS idx_farm_data_updated ON farm_data(updated_at);
  `);

  // Create planting_assignments table for crop selection persistence
  await client.query(`
    CREATE TABLE IF NOT EXISTS planting_assignments (
      id SERIAL PRIMARY KEY,
      farm_id VARCHAR(255) NOT NULL,
      group_id VARCHAR(255) NOT NULL,
      tray_id VARCHAR(255),
      crop_id VARCHAR(255) NOT NULL,
      crop_name VARCHAR(255) NOT NULL,
      seed_date DATE NOT NULL,
      harvest_date DATE,
      status VARCHAR(50) DEFAULT 'planned',
      notes TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      FOREIGN KEY (farm_id) REFERENCES farms(farm_id) ON DELETE CASCADE,
      UNIQUE(farm_id, group_id)
    );
    
    CREATE INDEX IF NOT EXISTS idx_planting_farm_id ON planting_assignments(farm_id);
    CREATE INDEX IF NOT EXISTS idx_planting_group_id ON planting_assignments(group_id);
    CREATE INDEX IF NOT EXISTS idx_planting_seed_date ON planting_assignments(seed_date);
    CREATE INDEX IF NOT EXISTS idx_planting_status ON planting_assignments(status);
  `);

  // ─── AI Vision Phase 1: Experiment Records & Crop Benchmarks ───────
  // Stores per-harvest experiment records from all farms (Rule 3.1, Task 1.7)
  await client.query(`
    CREATE TABLE IF NOT EXISTS experiment_records (
      id SERIAL PRIMARY KEY,
      farm_id VARCHAR(255) NOT NULL,
      crop VARCHAR(255) NOT NULL,
      recipe_id VARCHAR(255),
      grow_days INTEGER,
      planned_grow_days INTEGER,
      recipe_params_avg JSONB,
      environment_achieved_avg JSONB,
      outcomes JSONB NOT NULL,
      farm_context JSONB,
      recorded_at TIMESTAMP NOT NULL,
      ingested_at TIMESTAMP DEFAULT NOW(),
      FOREIGN KEY (farm_id) REFERENCES farms(farm_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_experiment_farm_id ON experiment_records(farm_id);
    CREATE INDEX IF NOT EXISTS idx_experiment_crop ON experiment_records(crop);
    CREATE INDEX IF NOT EXISTS idx_experiment_recorded_at ON experiment_records(recorded_at);
  `);

  // Nightly crop benchmark aggregations (Task 1.8)
  await client.query(`
    CREATE TABLE IF NOT EXISTS crop_benchmarks (
      id SERIAL PRIMARY KEY,
      crop VARCHAR(255) NOT NULL UNIQUE,
      farm_count INTEGER DEFAULT 0,
      harvest_count INTEGER DEFAULT 0,
      avg_weight_per_plant_oz DECIMAL(8,3),
      min_weight_per_plant_oz DECIMAL(8,3),
      max_weight_per_plant_oz DECIMAL(8,3),
      avg_grow_days DECIMAL(5,1),
      avg_loss_rate DECIMAL(5,3),
      avg_temp_c DECIMAL(5,1),
      avg_humidity_pct DECIMAL(5,1),
      avg_ppfd DECIMAL(6,1),
      computed_at TIMESTAMP DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_benchmark_crop ON crop_benchmarks(crop);
  `);

  // AI Vision Phase 3: Network recipe modifiers table (T31/T32)
  await client.query(`
    CREATE TABLE IF NOT EXISTS network_recipe_modifiers (
      id SERIAL PRIMARY KEY,
      modifiers JSONB NOT NULL,
      computed_at TIMESTAMP DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_network_recipe_modifiers_computed
      ON network_recipe_modifiers(computed_at DESC);
  `);

  // Device integration learning records (Integration Assistant, Ticket I-1.9)
  await client.query(`
    CREATE TABLE IF NOT EXISTS device_integrations (
      id SERIAL PRIMARY KEY,
      farm_id_hash VARCHAR(128) NOT NULL,
      record_id VARCHAR(255) NOT NULL,
      device_type VARCHAR(255),
      device_make_model VARCHAR(255),
      driver_id VARCHAR(255),
      driver_version VARCHAR(64),
      protocol VARCHAR(128),
      capabilities JSONB DEFAULT '{}',
      install_context JSONB DEFAULT '{}',
      validation_passed BOOLEAN,
      validation_signal_quality DECIMAL(8,2),
      validation_dropout_rate DECIMAL(8,4),
      validation_latency_ms INTEGER,
      grower_feedback_rating DECIMAL(4,2),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE (farm_id_hash, record_id)
    );

    CREATE INDEX IF NOT EXISTS idx_device_integrations_farm_hash ON device_integrations(farm_id_hash);
    CREATE INDEX IF NOT EXISTS idx_device_integrations_protocol ON device_integrations(protocol);
    CREATE INDEX IF NOT EXISTS idx_device_integrations_driver ON device_integrations(driver_id);
    CREATE INDEX IF NOT EXISTS idx_device_integrations_created_at ON device_integrations(created_at);
  `);

  // Create products table for inventory sync
  await client.query(`
    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      sku_id VARCHAR(255) NOT NULL,
      farm_id VARCHAR(255) NOT NULL,
      name VARCHAR(255) NOT NULL,
      quantity INTEGER DEFAULT 0,
      unit VARCHAR(50),
      price DECIMAL(10,2),
      organic BOOLEAN DEFAULT false,
      certifications JSONB DEFAULT '[]',
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      FOREIGN KEY (farm_id) REFERENCES farms(farm_id) ON DELETE CASCADE,
      UNIQUE(sku_id, farm_id)
    );
    
    CREATE INDEX IF NOT EXISTS idx_products_farm_id ON products(farm_id);
    CREATE INDEX IF NOT EXISTS idx_products_sku_id ON products(sku_id);
    CREATE INDEX IF NOT EXISTS idx_products_updated ON products(updated_at);
  `);

  // Compatibility migration: normalize farm_inventory schema expected by sync + admin routes
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS farm_inventory (
        id SERIAL PRIMARY KEY,
        farm_id VARCHAR(255) NOT NULL,
        product_id VARCHAR(255),
        product_name VARCHAR(255),
        sku VARCHAR(255),
        quantity NUMERIC(12,3) DEFAULT 0,
        quantity_available NUMERIC(12,3) DEFAULT 0,
        quantity_unit VARCHAR(50) DEFAULT 'unit',
        unit VARCHAR(50),
        price NUMERIC(10,2) DEFAULT 0,
        wholesale_price NUMERIC(10,2),
        retail_price NUMERIC(10,2),
        available_for_wholesale BOOLEAN DEFAULT TRUE,
        status VARCHAR(50) DEFAULT 'active',
        category VARCHAR(120),
        variety VARCHAR(255),
        source_data JSONB DEFAULT '{}',
        synced_at TIMESTAMP DEFAULT NOW(),
        last_updated TIMESTAMP DEFAULT NOW(),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        FOREIGN KEY (farm_id) REFERENCES farms(farm_id) ON DELETE CASCADE
      );

      ALTER TABLE farm_inventory ADD COLUMN IF NOT EXISTS product_id VARCHAR(255);
      ALTER TABLE farm_inventory ADD COLUMN IF NOT EXISTS product_name VARCHAR(255);
      ALTER TABLE farm_inventory ADD COLUMN IF NOT EXISTS sku VARCHAR(255);
      ALTER TABLE farm_inventory ADD COLUMN IF NOT EXISTS quantity NUMERIC(12,3) DEFAULT 0;
      ALTER TABLE farm_inventory ADD COLUMN IF NOT EXISTS quantity_available NUMERIC(12,3) DEFAULT 0;
      ALTER TABLE farm_inventory ADD COLUMN IF NOT EXISTS quantity_unit VARCHAR(50) DEFAULT 'unit';
      ALTER TABLE farm_inventory ADD COLUMN IF NOT EXISTS unit VARCHAR(50);
      ALTER TABLE farm_inventory ADD COLUMN IF NOT EXISTS price NUMERIC(10,2) DEFAULT 0;
      ALTER TABLE farm_inventory ADD COLUMN IF NOT EXISTS wholesale_price NUMERIC(10,2);
      ALTER TABLE farm_inventory ADD COLUMN IF NOT EXISTS retail_price NUMERIC(10,2);
      ALTER TABLE farm_inventory ADD COLUMN IF NOT EXISTS available_for_wholesale BOOLEAN DEFAULT TRUE;
      ALTER TABLE farm_inventory ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'active';
      ALTER TABLE farm_inventory ADD COLUMN IF NOT EXISTS category VARCHAR(120);
      ALTER TABLE farm_inventory ADD COLUMN IF NOT EXISTS variety VARCHAR(255);
      ALTER TABLE farm_inventory ADD COLUMN IF NOT EXISTS source_data JSONB DEFAULT '{}';
      ALTER TABLE farm_inventory ADD COLUMN IF NOT EXISTS synced_at TIMESTAMP DEFAULT NOW();
      ALTER TABLE farm_inventory ADD COLUMN IF NOT EXISTS last_updated TIMESTAMP DEFAULT NOW();
      ALTER TABLE farm_inventory ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();
      ALTER TABLE farm_inventory ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

      -- Ensure quantity column is NUMERIC (may have been created as INTEGER by older migration)
      ALTER TABLE farm_inventory ALTER COLUMN quantity TYPE NUMERIC(12,3) USING quantity::NUMERIC(12,3);

      -- Migration 024: dual-quantity columns for manual inventory
      ALTER TABLE farm_inventory ADD COLUMN IF NOT EXISTS auto_quantity_lbs DECIMAL(10,2) DEFAULT 0;
      ALTER TABLE farm_inventory ADD COLUMN IF NOT EXISTS manual_quantity_lbs DECIMAL(10,2) DEFAULT 0;
      ALTER TABLE farm_inventory ADD COLUMN IF NOT EXISTS inventory_source VARCHAR(10) DEFAULT 'auto';

      -- Migration 025: sold_quantity_lbs for persistent sales deductions (E-014 fix)
      ALTER TABLE farm_inventory ADD COLUMN IF NOT EXISTS sold_quantity_lbs DECIMAL(10,2) DEFAULT 0;
      ALTER TABLE farm_inventory ADD COLUMN IF NOT EXISTS lot_code VARCHAR(255);

      -- Migration 026: custom product fields (description, thumbnail, tax, custom flag)
      ALTER TABLE farm_inventory ADD COLUMN IF NOT EXISTS description TEXT;
      ALTER TABLE farm_inventory ADD COLUMN IF NOT EXISTS thumbnail_url VARCHAR(500);
      ALTER TABLE farm_inventory ADD COLUMN IF NOT EXISTS is_taxable BOOLEAN DEFAULT TRUE;
      ALTER TABLE farm_inventory ADD COLUMN IF NOT EXISTS is_custom BOOLEAN DEFAULT FALSE;

      UPDATE farm_inventory
         SET product_id = COALESCE(product_id, sku)
       WHERE product_id IS NULL;

      UPDATE farm_inventory
         SET quantity_available = COALESCE(quantity_available, quantity, 0)
       WHERE quantity_available IS NULL;

      CREATE INDEX IF NOT EXISTS idx_farm_inventory_farm_id ON farm_inventory(farm_id);
      CREATE INDEX IF NOT EXISTS idx_farm_inventory_product_id ON farm_inventory(product_id);
      CREATE INDEX IF NOT EXISTS idx_farm_inventory_sku ON farm_inventory(sku);
      CREATE INDEX IF NOT EXISTS idx_farm_inventory_last_updated ON farm_inventory(last_updated DESC);
      CREATE INDEX IF NOT EXISTS idx_farm_inventory_source ON farm_inventory(inventory_source);
      CREATE INDEX IF NOT EXISTS idx_farm_inventory_custom ON farm_inventory(is_custom) WHERE is_custom = TRUE;

      -- Required for ON CONFLICT (farm_id, product_id) UPSERT in sync + manual routes
      -- Deduplicate before creating unique index (keep row with highest id)
      DELETE FROM farm_inventory a USING farm_inventory b
        WHERE a.farm_id = b.farm_id AND a.product_id = b.product_id AND a.id < b.id;

      CREATE UNIQUE INDEX IF NOT EXISTS idx_farm_inventory_farm_product
        ON farm_inventory(farm_id, product_id);

      -- Backfill auto_quantity_lbs from existing quantity for rows that haven't been set yet
      UPDATE farm_inventory
         SET auto_quantity_lbs = COALESCE(quantity, 0)
       WHERE auto_quantity_lbs = 0 AND COALESCE(quantity, 0) > 0;
    `);
    logger.info('farm_inventory compatibility migration completed');
  } catch (err) {
    logger.warn('farm_inventory compatibility migration warning:', err.message);
  }

  // Create wholesale_buyers table for wholesale admin + buyer auth
  try {
  await client.query(`
    CREATE TABLE IF NOT EXISTS wholesale_buyers (
      id VARCHAR(255) PRIMARY KEY,
      business_name VARCHAR(255) NOT NULL,
      contact_name VARCHAR(255),
      email VARCHAR(255) UNIQUE NOT NULL,
      buyer_type VARCHAR(50),
      location JSONB DEFAULT '{}',
      password_hash VARCHAR(255) NOT NULL,
      status VARCHAR(50) DEFAULT 'active',
      phone VARCHAR(50),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_wholesale_buyers_email ON wholesale_buyers(email);
    CREATE INDEX IF NOT EXISTS idx_wholesale_buyers_created ON wholesale_buyers(created_at);
  `);
  } catch (err) { logger.warn('wholesale_buyers create warning:', err.message); }

  // Migrate existing wholesale_buyers table if id column is integer (SERIAL)
  try {
    const colCheck = await client.query(`
      SELECT data_type FROM information_schema.columns
      WHERE table_name = 'wholesale_buyers' AND column_name = 'id'
    `);
    if (colCheck.rows.length > 0 && colCheck.rows[0].data_type === 'integer') {
      await client.query(`
        ALTER TABLE wholesale_buyers ALTER COLUMN id TYPE VARCHAR(255) USING id::text;
      `);
    }
    // Add missing columns if they don't exist
    await client.query(`
      ALTER TABLE wholesale_buyers ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'active';
      ALTER TABLE wholesale_buyers ADD COLUMN IF NOT EXISTS phone VARCHAR(50);
    `);
  } catch (migErr) {
    console.warn('[DB Migration] wholesale_buyers schema update skipped:', migErr.message);
  }

  // Create wholesale_orders table for persisted wholesale orders
  try {
  await client.query(`
    CREATE TABLE IF NOT EXISTS wholesale_orders (
      id SERIAL PRIMARY KEY,
      master_order_id VARCHAR(64) UNIQUE NOT NULL,
      buyer_id VARCHAR(128) NOT NULL,
      buyer_email VARCHAR(255),
      status VARCHAR(50) DEFAULT 'confirmed',
      total_amount NUMERIC(12,2) DEFAULT 0,
      order_data JSONB NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_wholesale_orders_master ON wholesale_orders(master_order_id);
    CREATE INDEX IF NOT EXISTS idx_wholesale_orders_buyer ON wholesale_orders(buyer_id);
    CREATE INDEX IF NOT EXISTS idx_wholesale_orders_created ON wholesale_orders(created_at);
  `);
  } catch (err) { logger.warn('wholesale_orders create warning:', err.message); }

  // Migration: add total_amount column if missing (for existing production tables)
  try {
    await client.query(`ALTER TABLE wholesale_orders ADD COLUMN IF NOT EXISTS total_amount NUMERIC(12,2) DEFAULT 0;`);
  } catch (err) { logger.warn('wholesale_orders migration warning:', err.message); }

  // Create payment_records table for persistent payment storage
  try {
  await client.query(`
    CREATE TABLE IF NOT EXISTS payment_records (
      id SERIAL PRIMARY KEY,
      payment_id VARCHAR(64) UNIQUE NOT NULL,
      order_id VARCHAR(64) NOT NULL,
      amount NUMERIC(10,2) NOT NULL,
      currency VARCHAR(3) DEFAULT 'CAD',
      provider VARCHAR(50),
      status VARCHAR(30) DEFAULT 'pending',
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_payment_records_payment ON payment_records(payment_id);
    CREATE INDEX IF NOT EXISTS idx_payment_records_order ON payment_records(order_id);
    CREATE INDEX IF NOT EXISTS idx_payment_records_created ON payment_records(created_at);
  `);
  } catch (err) { logger.warn('payment_records create warning:', err.message); }

  // Canonical accounting ledger foundation
  try {
  await client.query(`
    CREATE TABLE IF NOT EXISTS accounting_sources (
      id SERIAL PRIMARY KEY,
      source_key VARCHAR(100) UNIQUE NOT NULL,
      source_name VARCHAR(255) NOT NULL,
      source_type VARCHAR(50) NOT NULL,
      active BOOLEAN DEFAULT TRUE,
      config JSONB DEFAULT '{}',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS accounting_accounts (
      id SERIAL PRIMARY KEY,
      account_code VARCHAR(20) UNIQUE NOT NULL,
      account_name VARCHAR(255) NOT NULL,
      account_class VARCHAR(50) NOT NULL,
      account_type VARCHAR(50) NOT NULL,
      parent_account_code VARCHAR(20),
      is_active BOOLEAN DEFAULT TRUE,
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS accounting_transactions (
      id BIGSERIAL PRIMARY KEY,
      source_id INTEGER REFERENCES accounting_sources(id) ON DELETE SET NULL,
      source_txn_id VARCHAR(255),
      idempotency_key VARCHAR(255) UNIQUE NOT NULL,
      txn_date DATE NOT NULL,
      description TEXT,
      currency VARCHAR(3) DEFAULT 'CAD',
      total_amount NUMERIC(12,2) DEFAULT 0,
      status VARCHAR(30) DEFAULT 'posted',
      raw_payload JSONB DEFAULT '{}',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS accounting_entries (
      id BIGSERIAL PRIMARY KEY,
      transaction_id BIGINT NOT NULL REFERENCES accounting_transactions(id) ON DELETE CASCADE,
      line_number INTEGER NOT NULL,
      account_code VARCHAR(20) NOT NULL REFERENCES accounting_accounts(account_code),
      debit NUMERIC(12,2) DEFAULT 0 CHECK (debit >= 0),
      credit NUMERIC(12,2) DEFAULT 0 CHECK (credit >= 0),
      memo TEXT,
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE (transaction_id, line_number),
      CHECK (NOT (debit > 0 AND credit > 0))
    );

    CREATE TABLE IF NOT EXISTS accounting_classifications (
      id BIGSERIAL PRIMARY KEY,
      transaction_id BIGINT REFERENCES accounting_transactions(id) ON DELETE CASCADE,
      entry_id BIGINT REFERENCES accounting_entries(id) ON DELETE CASCADE,
      suggested_category VARCHAR(100),
      confidence NUMERIC(5,4) DEFAULT 0,
      rule_applied VARCHAR(255),
      status VARCHAR(30) DEFAULT 'pending',
      reviewer VARCHAR(255),
      review_note TEXT,
      approved_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS accounting_period_closes (
      id SERIAL PRIMARY KEY,
      period_key VARCHAR(7) UNIQUE NOT NULL,
      status VARCHAR(20) DEFAULT 'open',
      opened_at TIMESTAMP DEFAULT NOW(),
      locked_at TIMESTAMP,
      locked_by VARCHAR(255),
      snapshot JSONB DEFAULT '{}',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS valuation_snapshots (
      id SERIAL PRIMARY KEY,
      snapshot_date DATE NOT NULL DEFAULT CURRENT_DATE,
      method VARCHAR(50) NOT NULL,
      valuation_low NUMERIC(14,2),
      valuation_base NUMERIC(14,2),
      valuation_high NUMERIC(14,2),
      confidence_score NUMERIC(5,4),
      assumptions JSONB DEFAULT '{}',
      notes TEXT,
      created_by VARCHAR(255),
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_accounting_sources_key ON accounting_sources(source_key);
    CREATE INDEX IF NOT EXISTS idx_accounting_transactions_date ON accounting_transactions(txn_date);
    CREATE INDEX IF NOT EXISTS idx_accounting_transactions_source ON accounting_transactions(source_id, source_txn_id);
    CREATE INDEX IF NOT EXISTS idx_accounting_entries_txn ON accounting_entries(transaction_id);
    CREATE INDEX IF NOT EXISTS idx_accounting_entries_account ON accounting_entries(account_code);
    CREATE INDEX IF NOT EXISTS idx_accounting_classifications_txn ON accounting_classifications(transaction_id);
    CREATE INDEX IF NOT EXISTS idx_accounting_period_closes_key ON accounting_period_closes(period_key);
    CREATE INDEX IF NOT EXISTS idx_valuation_snapshots_date ON valuation_snapshots(snapshot_date);
  `);
  } catch (err) { logger.warn('Accounting tables create warning:', err.message); }

  // Seed chart of accounts
  try {
  await client.query(`
    INSERT INTO accounting_accounts (account_code, account_name, account_class, account_type)
    VALUES
      ('100000', 'Cash', 'asset', 'current_asset'),
      ('110000', 'Accounts Receivable - Buyer', 'asset', 'current_asset'),
      ('120000', 'Accounts Receivable', 'asset', 'current_asset'),
      ('200000', 'Accounts Payable', 'liability', 'current_liability'),
      ('210000', 'Revenue - Subscriptions', 'income', 'operating_income'),
      ('250000', 'Accounts Payable - Farm Payouts', 'liability', 'current_liability'),
      ('300000', 'Owner Equity', 'equity', 'equity'),
      ('310000', 'Sales Tax Payable', 'liability', 'current_liability'),
      ('400000', 'Revenue', 'income', 'operating_income'),
      ('400100', 'Revenue - Wholesale', 'income', 'operating_income'),
      ('500000', 'Cost of Goods Sold', 'expense', 'cogs'),
      ('610000', 'Cloud Infrastructure', 'expense', 'operating_expense'),
      ('620000', 'Developer Tools', 'expense', 'operating_expense'),
      ('630000', 'Payment Processing Fees', 'expense', 'operating_expense'),
      ('640000', 'Broker Fee Revenue', 'income', 'operating_income'),
      ('710000', 'R&D Expense', 'expense', 'research_development')
    ON CONFLICT (account_code) DO NOTHING;
  `);
  } catch (err) { logger.warn('Chart of accounts seed warning:', err.message); }

  // Create audit_log table for persistent audit trail
  try {
  await client.query(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id SERIAL PRIMARY KEY,
      event_type VARCHAR(100) NOT NULL,
      entity_type VARCHAR(50),
      entity_id VARCHAR(100),
      actor VARCHAR(255),
      details JSONB DEFAULT '{}',
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id);
    CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at);
    CREATE INDEX IF NOT EXISTS idx_audit_log_event ON audit_log(event_type);
  `);
  } catch (err) { logger.warn('audit_log create warning:', err.message); }

  // Grant wizard tables (migration 011)
  if (process.env.ENABLE_GRANT_WIZARD !== 'false') {
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS grant_users (
          id              SERIAL PRIMARY KEY,
          email           VARCHAR(255) NOT NULL UNIQUE,
          password_hash   VARCHAR(255) NOT NULL,
          contact_name    VARCHAR(255) NOT NULL,
          business_name   VARCHAR(255),
          phone           VARCHAR(50),
          province        VARCHAR(50),
          postal_code     VARCHAR(10),
          organization_type VARCHAR(100),
          cra_business_number VARCHAR(50),
          incorporation_status VARCHAR(50),
          employee_count  INTEGER,
          ownership_demographics JSONB DEFAULT '{}',
          farm_details    JSONB DEFAULT '{}',
          consent_service_emails     BOOLEAN DEFAULT TRUE,
          consent_marketing_emails   BOOLEAN DEFAULT FALSE,
          consent_data_improvement   BOOLEAN DEFAULT FALSE,
          consent_obtained_at        TIMESTAMPTZ,
          consent_method             VARCHAR(50),
          created_at      TIMESTAMPTZ DEFAULT NOW(),
          updated_at      TIMESTAMPTZ DEFAULT NOW(),
          last_login_at   TIMESTAMPTZ,
          sign_in_count   INTEGER DEFAULT 0,
          deleted_at      TIMESTAMPTZ
        );

        CREATE TABLE IF NOT EXISTS grant_programs (
          id                  SERIAL PRIMARY KEY,
          program_code        VARCHAR(100) UNIQUE NOT NULL,
          program_name        VARCHAR(500) NOT NULL,
          administering_agency VARCHAR(255),
          source_url          TEXT,
          agpal_url           TEXT,
          intake_status       VARCHAR(50) DEFAULT 'unknown',
          intake_deadline     DATE,
          intake_opens        DATE,
          description         TEXT,
          objectives          TEXT,
          priority_areas      TEXT[],
          eligibility_summary TEXT,
          eligibility_rules   JSONB DEFAULT '{}',
          funding_type        VARCHAR(50),
          min_funding         NUMERIC(12,2),
          max_funding         NUMERIC(12,2),
          cost_share_ratio    VARCHAR(50),
          stacking_rules      TEXT,
          reimbursement_model VARCHAR(50),
          application_method  VARCHAR(50),
          application_url     TEXT,
          has_fillable_pdf    BOOLEAN DEFAULT FALSE,
          pdf_template_url    TEXT,
          required_documents  TEXT[],
          budget_template_url TEXT,
          question_map        JSONB DEFAULT '[]',
          priority_lexicon    TEXT[],
          evidence_snippets   JSONB DEFAULT '[]',
          success_stories_url TEXT,
          equity_enhanced     BOOLEAN DEFAULT FALSE,
          equity_details      JSONB DEFAULT '{}',
          last_checked_at     TIMESTAMPTZ,
          last_changed_at     TIMESTAMPTZ,
          change_log          JSONB DEFAULT '[]',
          source_type         VARCHAR(50) DEFAULT 'manual',
          active              BOOLEAN DEFAULT TRUE,
          created_at          TIMESTAMPTZ DEFAULT NOW(),
          updated_at          TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS grant_applications (
          id                  SERIAL PRIMARY KEY,
          user_id             INTEGER NOT NULL REFERENCES grant_users(id),
          program_id          INTEGER REFERENCES grant_programs(id),
          status              VARCHAR(50) DEFAULT 'draft',
          wizard_step         INTEGER DEFAULT 1,
          percent_complete    INTEGER DEFAULT 0,
          organization_profile JSONB DEFAULT '{}',
          project_profile      JSONB DEFAULT '{}',
          budget               JSONB DEFAULT '{}',
          contacts             JSONB DEFAULT '[]',
          attachments_checklist JSONB DEFAULT '[]',
          prior_funding        JSONB DEFAULT '[]',
          answers              JSONB DEFAULT '{}',
          facts_ledger         JSONB DEFAULT '{}',
          answers_document     TEXT,
          budget_workbook      JSONB,
          disclosure_notes     TEXT,
          procurement_items    JSONB DEFAULT '[]',
          started_at           TIMESTAMPTZ DEFAULT NOW(),
          last_saved_at        TIMESTAMPTZ DEFAULT NOW(),
          submitted_at         TIMESTAMPTZ,
          expires_at           TIMESTAMPTZ,
          outcome              VARCHAR(50),
          outcome_date         DATE,
          outcome_amount       NUMERIC(12,2),
          outcome_notes        TEXT,
          created_at           TIMESTAMPTZ DEFAULT NOW(),
          updated_at           TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS grant_export_packs (
          id                  SERIAL PRIMARY KEY,
          application_id      INTEGER NOT NULL REFERENCES grant_applications(id),
          user_id             INTEGER NOT NULL REFERENCES grant_users(id),
          pack_type           VARCHAR(50) DEFAULT 'daily',
          contents            JSONB DEFAULT '{}',
          emailed_at          TIMESTAMPTZ,
          email_status        VARCHAR(50),
          created_at          TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS grant_program_snapshots (
          id                  SERIAL PRIMARY KEY,
          program_id          INTEGER NOT NULL REFERENCES grant_programs(id),
          snapshot_date       DATE DEFAULT CURRENT_DATE,
          intake_status       VARCHAR(50),
          intake_deadline     DATE,
          eligibility_hash    VARCHAR(64),
          content_hash        VARCHAR(64),
          changes_detected    JSONB DEFAULT '[]',
          created_at          TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS grant_outcome_analytics (
          id                  SERIAL PRIMARY KEY,
          program_id          INTEGER REFERENCES grant_programs(id),
          program_type        VARCHAR(100),
          project_type        VARCHAR(100),
          budget_band         VARCHAR(50),
          had_quotes          BOOLEAN,
          had_budget_template BOOLEAN,
          submission_timing   VARCHAR(50),
          outcome             VARCHAR(50),
          disclosure_recipient VARCHAR(255),
          disclosure_amount    NUMERIC(12,2),
          disclosure_description TEXT,
          disclosure_source_url TEXT,
          created_at           TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_grant_users_email ON grant_users(email);
        CREATE INDEX IF NOT EXISTS idx_grant_programs_status ON grant_programs(intake_status);
        CREATE INDEX IF NOT EXISTS idx_grant_programs_active ON grant_programs(active);
        CREATE INDEX IF NOT EXISTS idx_grant_applications_user ON grant_applications(user_id);
        CREATE INDEX IF NOT EXISTS idx_grant_applications_status ON grant_applications(status);
        CREATE INDEX IF NOT EXISTS idx_grant_applications_expires ON grant_applications(expires_at);
        CREATE INDEX IF NOT EXISTS idx_grant_export_packs_app ON grant_export_packs(application_id);
        CREATE INDEX IF NOT EXISTS idx_grant_snapshots_program ON grant_program_snapshots(program_id);
      `);
      logger.info('Grant wizard tables ready (migration 011)');
    } catch (err) {
      logger.warn('Grant wizard migration warning:', err.message);
    }

    // Migration 012: Project Discovery columns + research jobs table
    try {
      await client.query(`
        ALTER TABLE grant_applications ADD COLUMN IF NOT EXISTS project_characterization JSONB DEFAULT '{}';
        ALTER TABLE grant_applications ADD COLUMN IF NOT EXISTS website_intelligence JSONB DEFAULT '{}';
        ALTER TABLE grant_users ADD COLUMN IF NOT EXISTS website_url TEXT;

        CREATE TABLE IF NOT EXISTS grant_research_jobs (
          id              SERIAL PRIMARY KEY,
          application_id  INTEGER REFERENCES grant_applications(id),
          user_id         INTEGER NOT NULL REFERENCES grant_users(id),
          job_type        VARCHAR(50) NOT NULL,
          status          VARCHAR(50) DEFAULT 'pending',
          input_data      JSONB DEFAULT '{}',
          result_data     JSONB DEFAULT '{}',
          error_message   TEXT,
          created_at      TIMESTAMPTZ DEFAULT NOW(),
          completed_at    TIMESTAMPTZ
        );

        CREATE INDEX IF NOT EXISTS idx_grant_research_jobs_app ON grant_research_jobs(application_id);
        CREATE INDEX IF NOT EXISTS idx_grant_research_jobs_user ON grant_research_jobs(user_id);
      `);
      logger.info('Project discovery tables ready (migration 012)');
    } catch (err) {
      logger.warn('Project discovery migration warning:', err.message);
    }

    // Migration 013: Grant wizard analytics + AI reference sites
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS grant_wizard_events (
          id              SERIAL PRIMARY KEY,
          user_id         INTEGER NOT NULL REFERENCES grant_users(id),
          application_id  INTEGER REFERENCES grant_applications(id),
          event_type      VARCHAR(50) NOT NULL,
          page_id         VARCHAR(100),
          duration_ms     INTEGER,
          created_at      TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_grant_wizard_events_user ON grant_wizard_events(user_id);
        CREATE INDEX IF NOT EXISTS idx_grant_wizard_events_app ON grant_wizard_events(application_id);
        CREATE INDEX IF NOT EXISTS idx_grant_wizard_events_page ON grant_wizard_events(page_id);
        CREATE INDEX IF NOT EXISTS idx_grant_wizard_events_created ON grant_wizard_events(created_at);

        CREATE TABLE IF NOT EXISTS ai_reference_sites (
          id          SERIAL PRIMARY KEY,
          title       TEXT NOT NULL,
          url         TEXT NOT NULL,
          category    TEXT,
          created_at  TIMESTAMPTZ DEFAULT NOW(),
          updated_at  TIMESTAMPTZ DEFAULT NOW()
        );

        INSERT INTO ai_reference_sites (title, url, category)
        SELECT * FROM (VALUES
          ('OpenAI Usage Policies', 'https://openai.com/policies/usage-policies', 'Policy'),
          ('OpenAI Safety Best Practices', 'https://openai.com/safety', 'Safety'),
          ('Government of Canada: AI and data', 'https://www.canada.ca/en/government/system/digital-government/digital-government-innovations/responsible-use-ai.html', 'Regulatory'),
          ('Treasury Board: Directive on Automated Decision-Making', 'https://www.tbs-sct.canada.ca/pol/doc-eng.aspx?id=32592', 'Regulatory'),
          ('OECD AI Principles', 'https://oecd.ai/en/ai-principles', 'Framework'),
          ('NIST AI Risk Management Framework', 'https://www.nist.gov/itl/ai-risk-management-framework', 'Framework')
        ) AS seed(title, url, category)
        WHERE NOT EXISTS (SELECT 1 FROM ai_reference_sites);
      `);
      logger.info('Grant analytics + AI reference tables ready (migration 013)');
    } catch (err) {
      logger.warn('Grant analytics migration warning:', err.message);
    }

    // Migration 014: Milestones + support letters JSONB columns
    try {
      await client.query(`
        ALTER TABLE grant_applications ADD COLUMN IF NOT EXISTS milestones JSONB DEFAULT '[]';
        ALTER TABLE grant_applications ADD COLUMN IF NOT EXISTS support_letters JSONB DEFAULT '[]';
      `);
      logger.info('Milestones & support letters columns ready (migration 014)');
    } catch (err) {
      logger.warn('Milestones migration warning:', err.message);
    }

    // Migration 015: Program budget guidance categories
    try {
      await client.query(`
        ALTER TABLE grant_programs ADD COLUMN IF NOT EXISTS budget_categories JSONB DEFAULT '[]';
      `);
      logger.info('Grant program budget categories ready (migration 015)');
    } catch (err) {
      logger.warn('Grant budget category migration warning:', err.message);
    }

    // Migration 016: Program verification + change alerts + snapshot confidence
    try {
      await client.query(`
        ALTER TABLE grant_programs ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;
        ALTER TABLE grant_programs ADD COLUMN IF NOT EXISTS verified_by VARCHAR(255);
        ALTER TABLE grant_programs ADD COLUMN IF NOT EXISTS needs_review BOOLEAN DEFAULT FALSE;

        ALTER TABLE grant_program_snapshots ADD COLUMN IF NOT EXISTS scraping_confidence VARCHAR(20) DEFAULT 'medium';

        CREATE TABLE IF NOT EXISTS grant_program_change_alerts (
          id SERIAL PRIMARY KEY,
          program_id INTEGER REFERENCES grant_programs(id),
          change_type VARCHAR(50),
          details JSONB DEFAULT '{}',
          acknowledged BOOLEAN DEFAULT FALSE,
          acknowledged_by VARCHAR(255),
          created_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_grant_program_change_alerts_program ON grant_program_change_alerts(program_id);
        CREATE INDEX IF NOT EXISTS idx_grant_program_change_alerts_ack ON grant_program_change_alerts(acknowledged);
        CREATE INDEX IF NOT EXISTS idx_grant_program_change_alerts_created ON grant_program_change_alerts(created_at);
      `);
      logger.info('Grant verification + alerting ready (migration 016)');
    } catch (err) {
      logger.warn('Grant verification migration warning:', err.message);
    }

    // Migration 017: Farm users table for multi-tenant authentication
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS farm_users (
          id UUID PRIMARY KEY DEFAULT _gr_uuid(),
          farm_id VARCHAR(255) NOT NULL REFERENCES farms(farm_id) ON DELETE CASCADE,
          email VARCHAR(255) NOT NULL,
          first_name VARCHAR(255),
          last_name VARCHAR(255),
          role VARCHAR(50) DEFAULT 'operator',
          password_hash VARCHAR(255) NOT NULL,
          status VARCHAR(50) DEFAULT 'active',
          last_login TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(farm_id, email)
        );

        CREATE INDEX IF NOT EXISTS idx_farm_users_farm_id ON farm_users(farm_id);
        CREATE INDEX IF NOT EXISTS idx_farm_users_email ON farm_users(email);
        CREATE INDEX IF NOT EXISTS idx_farm_users_status ON farm_users(status);
      `);
      logger.info('Farm users table ready (migration 017)');
    } catch (err) {
      logger.warn('Farm users migration warning:', err.message);
    }

    // Migration 019: Admin auth tables (admin_users, admin_sessions, admin_audit_log)
    // Required by admin-auth.js and adminAuth.js middleware when DB_ENABLED=true
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS admin_users (
          id SERIAL PRIMARY KEY,
          email VARCHAR(255) UNIQUE NOT NULL,
          password_hash VARCHAR(255) NOT NULL,
          name VARCHAR(255),
          role VARCHAR(50) DEFAULT 'admin',
          active BOOLEAN DEFAULT TRUE,
          mfa_enabled BOOLEAN DEFAULT FALSE,
          mfa_secret VARCHAR(255),
          permissions JSONB DEFAULT '{}',
          failed_attempts INTEGER DEFAULT 0,
          locked_until TIMESTAMPTZ,
          last_login TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_admin_users_email ON admin_users(email);
        CREATE INDEX IF NOT EXISTS idx_admin_users_active ON admin_users(active);

        CREATE TABLE IF NOT EXISTS admin_sessions (
          id SERIAL PRIMARY KEY,
          admin_id INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
          token_hash VARCHAR(255) NOT NULL,
          ip_address VARCHAR(45),
          user_agent TEXT,
          expires_at TIMESTAMPTZ NOT NULL,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_admin_sessions_token ON admin_sessions(token_hash);
        CREATE INDEX IF NOT EXISTS idx_admin_sessions_admin ON admin_sessions(admin_id);
        CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires ON admin_sessions(expires_at);

        CREATE TABLE IF NOT EXISTS admin_audit_log (
          id SERIAL PRIMARY KEY,
          admin_id INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
          action VARCHAR(100) NOT NULL,
          resource_type VARCHAR(50),
          resource_id VARCHAR(255),
          details JSONB DEFAULT '{}',
          ip_address VARCHAR(45),
          user_agent TEXT,
          success BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_admin_audit_admin ON admin_audit_log(admin_id);
        CREATE INDEX IF NOT EXISTS idx_admin_audit_action ON admin_audit_log(action);
        CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit_log(created_at);
      `);
      logger.info('Admin auth tables ready (migration 019)');
    } catch (err) {
      logger.warn('Admin auth tables migration warning:', err.message);
    }

    // Migration 018: Delivery service tables (farm-scoped, no FK constraints — app-level enforcement)
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS farm_delivery_settings (
          id SERIAL PRIMARY KEY,
          farm_id VARCHAR(255) NOT NULL,
          enabled BOOLEAN DEFAULT FALSE,
          base_fee NUMERIC(10,2) DEFAULT 0,
          min_order NUMERIC(10,2) DEFAULT 25,
          lead_time_hours INTEGER DEFAULT 24,
          max_deliveries_per_window INTEGER DEFAULT 20,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(farm_id)
        );

        CREATE INDEX IF NOT EXISTS idx_farm_delivery_settings_farm ON farm_delivery_settings(farm_id);

        CREATE TABLE IF NOT EXISTS farm_delivery_windows (
          id SERIAL PRIMARY KEY,
          farm_id VARCHAR(255) NOT NULL,
          window_id VARCHAR(50) NOT NULL,
          label VARCHAR(255),
          start_time VARCHAR(10),
          end_time VARCHAR(10),
          active BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(farm_id, window_id)
        );

        CREATE INDEX IF NOT EXISTS idx_farm_delivery_windows_farm ON farm_delivery_windows(farm_id);

        CREATE TABLE IF NOT EXISTS farm_delivery_zones (
          id SERIAL PRIMARY KEY,
          farm_id VARCHAR(255) NOT NULL,
          zone_id VARCHAR(50) NOT NULL,
          name VARCHAR(255) NOT NULL,
          description TEXT DEFAULT '',
          fee NUMERIC(10,2) DEFAULT 0,
          min_order NUMERIC(10,2) DEFAULT 25,
          postal_prefix VARCHAR(10),
          status VARCHAR(50) DEFAULT 'active',
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(farm_id, zone_id)
        );

        CREATE INDEX IF NOT EXISTS idx_farm_delivery_zones_farm ON farm_delivery_zones(farm_id);
        CREATE INDEX IF NOT EXISTS idx_farm_delivery_zones_status ON farm_delivery_zones(status);

        CREATE TABLE IF NOT EXISTS delivery_orders (
          id SERIAL PRIMARY KEY,
          farm_id VARCHAR(255) NOT NULL,
          delivery_id VARCHAR(100) NOT NULL,
          order_id VARCHAR(255) NOT NULL,
          delivery_date DATE NOT NULL,
          time_slot VARCHAR(50) NOT NULL,
          zone_id VARCHAR(50),
          route_id VARCHAR(100),
          driver_id VARCHAR(100),
          status VARCHAR(50) DEFAULT 'scheduled',
          address JSONB DEFAULT '{}'::jsonb,
          contact JSONB DEFAULT '{}'::jsonb,
          instructions TEXT,
          delivery_fee NUMERIC(10,2) DEFAULT 0,
          tip_amount NUMERIC(10,2) DEFAULT 0,
          driver_payout_amount NUMERIC(10,2) DEFAULT 0,
          platform_margin NUMERIC(10,2) DEFAULT 0,
          payload JSONB DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(farm_id, delivery_id)
        );

        CREATE INDEX IF NOT EXISTS idx_delivery_orders_farm_date_slot ON delivery_orders(farm_id, delivery_date, time_slot);
        CREATE INDEX IF NOT EXISTS idx_delivery_orders_status ON delivery_orders(status);
        CREATE INDEX IF NOT EXISTS idx_delivery_orders_route ON delivery_orders(route_id);

        CREATE TABLE IF NOT EXISTS delivery_routes (
          id SERIAL PRIMARY KEY,
          farm_id VARCHAR(255) NOT NULL,
          route_id VARCHAR(100) NOT NULL,
          route_date DATE NOT NULL,
          time_slot VARCHAR(50) NOT NULL,
          zone_id VARCHAR(50),
          status VARCHAR(50) DEFAULT 'pending',
          payload JSONB DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(farm_id, route_id)
        );

        CREATE INDEX IF NOT EXISTS idx_delivery_routes_farm_date_slot ON delivery_routes(farm_id, route_date, time_slot);
        CREATE INDEX IF NOT EXISTS idx_delivery_routes_status ON delivery_routes(status);

        CREATE TABLE IF NOT EXISTS delivery_drivers (
          id SERIAL PRIMARY KEY,
          farm_id VARCHAR(255) NOT NULL,
          driver_id VARCHAR(100) NOT NULL,
          name VARCHAR(255) NOT NULL,
          phone VARCHAR(50) NOT NULL,
          email VARCHAR(255),
          vehicle VARCHAR(255),
          zones JSONB DEFAULT '[]'::jsonb,
          pay_per_delivery NUMERIC(10,2) DEFAULT 5.50,
          cold_chain_bonus NUMERIC(10,2) DEFAULT 2.00,
          cold_chain_certified BOOLEAN DEFAULT FALSE,
          deliveries_30d INTEGER DEFAULT 0,
          rating NUMERIC(3,2),
          status VARCHAR(50) DEFAULT 'active',
          hired_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(farm_id, driver_id)
        );

        CREATE INDEX IF NOT EXISTS idx_delivery_drivers_farm ON delivery_drivers(farm_id);
        CREATE INDEX IF NOT EXISTS idx_delivery_drivers_status ON delivery_drivers(status);

        CREATE TABLE IF NOT EXISTS driver_payouts (
          id SERIAL PRIMARY KEY,
          farm_id VARCHAR(255) NOT NULL,
          driver_id VARCHAR(100) NOT NULL,
          delivery_id VARCHAR(100),
          order_id VARCHAR(255),
          base_amount NUMERIC(10,2) DEFAULT 0,
          cold_chain_bonus NUMERIC(10,2) DEFAULT 0,
          tip_amount NUMERIC(10,2) DEFAULT 0,
          total_payout NUMERIC(10,2) DEFAULT 0,
          payout_status VARCHAR(50) DEFAULT 'pending',
          paid_at TIMESTAMPTZ,
          payout_method VARCHAR(50),
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_driver_payouts_farm_driver ON driver_payouts(farm_id, driver_id);
        CREATE INDEX IF NOT EXISTS idx_driver_payouts_status ON driver_payouts(payout_status);

        ALTER TABLE delivery_orders ADD COLUMN IF NOT EXISTS delivery_fee NUMERIC(10,2) DEFAULT 0;
        ALTER TABLE delivery_orders ADD COLUMN IF NOT EXISTS tip_amount NUMERIC(10,2) DEFAULT 0;
        ALTER TABLE delivery_orders ADD COLUMN IF NOT EXISTS driver_payout_amount NUMERIC(10,2) DEFAULT 0;
        ALTER TABLE delivery_orders ADD COLUMN IF NOT EXISTS platform_margin NUMERIC(10,2) DEFAULT 0;
        ALTER TABLE delivery_drivers ADD COLUMN IF NOT EXISTS pay_per_delivery NUMERIC(10,2) DEFAULT 5.50;
        ALTER TABLE delivery_drivers ADD COLUMN IF NOT EXISTS cold_chain_bonus NUMERIC(10,2) DEFAULT 2.00;
        ALTER TABLE delivery_drivers ADD COLUMN IF NOT EXISTS cold_chain_certified BOOLEAN DEFAULT FALSE;
      `);
      logger.info('Delivery service tables ready (migration 018)');
    } catch (err) {
      logger.warn('Delivery tables migration warning:', err.message);
    }
  }

  // Migration 010: Wholesale pricing authority tables
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS farm_cost_surveys (
        id SERIAL PRIMARY KEY,
        farm_id VARCHAR(50) NOT NULL,
        crop VARCHAR(100) NOT NULL,
        cost_per_unit DECIMAL(10, 2) NOT NULL,
        unit VARCHAR(20) NOT NULL DEFAULT 'lb',
        cost_breakdown JSONB,
        survey_date DATE NOT NULL DEFAULT CURRENT_DATE,
        valid_until DATE,
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(farm_id, crop, survey_date)
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_farm_cost_surveys_farm_id ON farm_cost_surveys(farm_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_farm_cost_surveys_crop ON farm_cost_surveys(crop)`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS pricing_offers (
        offer_id VARCHAR(50) PRIMARY KEY,
        crop VARCHAR(100) NOT NULL,
        wholesale_price DECIMAL(10, 2) NOT NULL,
        unit VARCHAR(20) NOT NULL DEFAULT 'lb',
        reasoning TEXT,
        confidence DECIMAL(3, 2),
        predicted_acceptance DECIMAL(3, 2),
        offer_date TIMESTAMPTZ DEFAULT NOW(),
        effective_date DATE,
        expires_at TIMESTAMPTZ,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        created_by VARCHAR(100),
        tier VARCHAR(50),
        metadata JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_pricing_offers_crop ON pricing_offers(crop)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_pricing_offers_status ON pricing_offers(status)`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS pricing_responses (
        response_id SERIAL PRIMARY KEY,
        offer_id VARCHAR(50) NOT NULL,
        farm_id VARCHAR(50) NOT NULL,
        response VARCHAR(10) NOT NULL,
        counter_price DECIMAL(10, 2),
        justification TEXT,
        notes TEXT,
        responded_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(offer_id, farm_id)
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_pricing_responses_offer_id ON pricing_responses(offer_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_pricing_responses_farm_id ON pricing_responses(farm_id)`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS pricing_history (
        history_id SERIAL PRIMARY KEY,
        crop VARCHAR(100) NOT NULL,
        wholesale_price DECIMAL(10, 2) NOT NULL,
        unit VARCHAR(20) NOT NULL DEFAULT 'lb',
        offer_date DATE NOT NULL,
        total_farms_offered INT NOT NULL DEFAULT 0,
        farms_accepted INT NOT NULL DEFAULT 0,
        farms_rejected INT NOT NULL DEFAULT 0,
        farms_countered INT NOT NULL DEFAULT 0,
        acceptance_rate DECIMAL(5, 4),
        avg_counter_price DECIMAL(10, 2),
        reasoning TEXT,
        tier VARCHAR(50),
        metadata JSONB,
        archived_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_pricing_history_crop ON pricing_history(crop)`);

    logger.info('Wholesale pricing tables ready (migration 010)');
  } catch (err) {
    logger.warn('Wholesale pricing tables migration warning:', err.message);
  }

  // Migration 020: Driver applications table (public enrollment)
  {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS driver_applications (
          id SERIAL PRIMARY KEY,
          application_id VARCHAR(100) NOT NULL UNIQUE,
          name VARCHAR(255) NOT NULL,
          email VARCHAR(255) NOT NULL,
          phone VARCHAR(50) NOT NULL,
          address VARCHAR(500) DEFAULT '',
          city VARCHAR(100) DEFAULT 'Kingston',
          postal_code VARCHAR(10) DEFAULT '',
          vehicle_type VARCHAR(50) NOT NULL,
          vehicle_year INTEGER,
          vehicle_make_model VARCHAR(255) DEFAULT '',
          licence_class VARCHAR(20) DEFAULT '',
          insurance_info VARCHAR(500) DEFAULT '',
          availability JSONB DEFAULT '[]',
          preferred_zones TEXT DEFAULT '',
          food_cert_status VARCHAR(50) DEFAULT '',
          experience VARCHAR(50) DEFAULT '',
          agreements JSONB DEFAULT '{}',
          status VARCHAR(50) DEFAULT 'pending',
          reviewer_notes TEXT DEFAULT '',
          reviewed_at TIMESTAMPTZ,
          reviewed_by VARCHAR(255),
          submitted_at TIMESTAMPTZ DEFAULT NOW(),
          ip_address VARCHAR(45) DEFAULT '',
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_driver_applications_status ON driver_applications(status);
        CREATE INDEX IF NOT EXISTS idx_driver_applications_email ON driver_applications(email);
        CREATE INDEX IF NOT EXISTS idx_driver_applications_submitted ON driver_applications(submitted_at);
      `);
      logger.info('Driver applications table ready (migration 020)');
    } catch (err) {
      logger.warn('Driver applications migration warning:', err.message);
    }
  }

  // Migration 021: Marketing AI Agent tables — individual queries to avoid connection state issues
  {
    // site_settings
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS site_settings (
          key         TEXT PRIMARY KEY,
          value       TEXT NOT NULL,
          updated_at  TIMESTAMPTZ DEFAULT NOW()
        )
      `);
    } catch (err) { logger.warn('site_settings create warning:', err.message); }

    // marketing_posts
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS marketing_posts (
          id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          platform        TEXT NOT NULL CHECK (platform IN ('twitter','linkedin','instagram','facebook')),
          content         TEXT NOT NULL,
          image_url       TEXT,
          hashtags        TEXT[] DEFAULT '{}',
          status          TEXT NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft','approved','scheduled','published','failed','rejected')),
          rejection_reason TEXT,
          source_type     TEXT CHECK (source_type IN ('harvest','market','wholesale','sustainability','product','milestone','manual')),
          source_id       TEXT,
          source_context  JSONB DEFAULT '{}',
          scheduled_for   TIMESTAMPTZ,
          published_at    TIMESTAMPTZ,
          platform_post_id TEXT,
          metrics         JSONB DEFAULT '{"impressions":0,"clicks":0,"likes":0,"shares":0,"comments":0}',
          model_used      TEXT,
          prompt_tokens   INTEGER DEFAULT 0,
          output_tokens   INTEGER DEFAULT 0,
          generation_cost_usd NUMERIC(8,6) DEFAULT 0,
          skill_used      TEXT,
          created_by      TEXT,
          approved_by     TEXT,
          created_at      TIMESTAMPTZ DEFAULT NOW(),
          updated_at      TIMESTAMPTZ DEFAULT NOW()
        )
      `);
    } catch (err) { logger.warn('marketing_posts create warning:', err.message); }

    // marketing_post_history
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS marketing_post_history (
          id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          post_id     UUID NOT NULL REFERENCES marketing_posts(id) ON DELETE CASCADE,
          action      TEXT NOT NULL CHECK (action IN ('created','approved','rejected','published','failed','edited','auto_approved','scheduled')),
          actor_id    TEXT,
          details     JSONB DEFAULT '{}',
          created_at  TIMESTAMPTZ DEFAULT NOW()
        )
      `);
    } catch (err) { logger.warn('marketing_post_history create warning:', err.message); }

    // marketing_rules
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS marketing_rules (
          id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          rule_name   TEXT UNIQUE NOT NULL,
          rule_type   TEXT NOT NULL CHECK (rule_type IN ('auto_approve','always_block','rate_limit','content_filter','skill_gate')),
          conditions  JSONB DEFAULT '{}',
          enabled     BOOLEAN DEFAULT true,
          created_at  TIMESTAMPTZ DEFAULT NOW(),
          updated_at  TIMESTAMPTZ DEFAULT NOW()
        )
      `);
    } catch (err) { logger.warn('marketing_rules create warning:', err.message); }

    // marketing_skills
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS marketing_skills (
          id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          skill_name      TEXT UNIQUE NOT NULL,
          description     TEXT,
          category        TEXT CHECK (category IN ('content','analytics','engagement','scheduling','compliance')),
          risk_tier       INTEGER DEFAULT 1 CHECK (risk_tier BETWEEN 0 AND 4),
          approval_mode   TEXT DEFAULT 'required' CHECK (approval_mode IN ('none','spot-check','required','prohibited')),
          allowed_actions TEXT[] DEFAULT '{}',
          blocked_actions TEXT[] DEFAULT '{}',
          system_prompt   TEXT,
          enabled         BOOLEAN DEFAULT true,
          created_at      TIMESTAMPTZ DEFAULT NOW(),
          updated_at      TIMESTAMPTZ DEFAULT NOW()
        )
      `);
    } catch (err) { logger.warn('marketing_skills create warning:', err.message); }

    // Indexes
    try {
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_marketing_posts_status ON marketing_posts(status)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_marketing_posts_platform ON marketing_posts(platform)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_marketing_posts_scheduled ON marketing_posts(scheduled_for) WHERE status = 'scheduled'`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_marketing_posts_created ON marketing_posts(created_at)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_marketing_post_history_post ON marketing_post_history(post_id)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_marketing_rules_enabled ON marketing_rules(enabled) WHERE enabled = true`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_marketing_skills_enabled ON marketing_skills(enabled) WHERE enabled = true`);
    } catch (err) { logger.warn('marketing indexes warning:', err.message); }

    // Seed default rules
    try {
      await pool.query(`
        INSERT INTO marketing_rules (rule_name, rule_type, conditions, enabled) VALUES
          ('require_approval_all', 'always_block', '{"description":"Stage 1: all posts require human approval before publishing"}', true),
          ('rate_limit_daily', 'rate_limit', '{"max_per_day":10,"description":"Maximum 10 posts per day per platform"}', true),
          ('block_health_claims', 'content_filter', '{"blocked_phrases":["cures","treats","prevents disease","medical grade","doctor recommended","clinically proven"],"description":"Block unsubstantiated health or medical claims (CFIA compliance)"}', true),
          ('block_organic_misuse', 'content_filter', '{"blocked_phrases":["certified organic","all natural","chemical free","chemical-free","zero pesticides"],"description":"Block uncertified organic/natural claims"}', true),
          ('block_competitor_names', 'content_filter', '{"description":"Block posts mentioning competitor names by review"}', true),
          ('auto_approve_low_risk', 'auto_approve', '{"allowed_source_types":["market","milestone"],"min_published":50,"max_rejection_rate":0.05,"description":"Stage 2: auto-approve low-risk content types after trust threshold"}', false)
        ON CONFLICT (rule_name) DO NOTHING;
      `);
    } catch (err) { logger.warn('marketing rules seed warning:', err.message); }

    // Seed default skills
    try {
      await pool.query(`
        INSERT INTO marketing_skills (skill_name, description, category, risk_tier, approval_mode, allowed_actions, blocked_actions) VALUES
          ('content-drafter', 'Draft social media content from farm data, market intelligence, and seasonal context', 'content', 2, 'required',
           ARRAY['draft-caption','generate-calendar','repurpose-content','summarize-performance'],
           ARRAY['publish-post','send-direct-message','invent-testimonials']),
          ('compliance-screener', 'Check content against CFIA food marketing regulations and brand policy', 'compliance', 3, 'required',
           ARRAY['flag-risky-claims','block-draft','route-to-human-review'],
           ARRAY['override-human-decision','rewrite-policy']),
          ('analytics-summarizer', 'Summarize post performance metrics and engagement data', 'analytics', 0, 'none',
           ARRAY['summarize-metrics','compare-periods','surface-anomalies'],
           ARRAY['change-tracking','publish-external-report']),
          ('engagement-responder', 'Draft responses to social media interactions', 'engagement', 2, 'required',
           ARRAY['draft-reply','suggest-escalation','classify-sentiment'],
           ARRAY['send-external-message','change-account-status']),
          ('schedule-optimizer', 'Recommend optimal posting times from engagement data', 'scheduling', 1, 'spot-check',
           ARRAY['recommend-time','analyze-engagement-patterns','suggest-frequency'],
           ARRAY['auto-schedule-without-review','delete-scheduled-posts']),
          ('content-planner', 'Build content themes, weekly calendars, and test ideas based on campaign goals and performance data', 'content', 1, 'spot-check',
           ARRAY['build-calendar','suggest-topics','plan-test','audit-content-mix'],
           ARRAY['publish-post','modify-campaign']),
          ('learning-engine', 'Convert performance outcomes into updated strategy patterns and learning records', 'analytics', 0, 'none',
           ARRAY['update-patterns','retire-patterns','generate-learning-record','recommend-next-test'],
           ARRAY['override-brand-rules','auto-apply-strategy']),
          ('blog-writer', 'Draft blog articles optimized for clarity, search intent, and downstream social repurposing', 'content', 2, 'required',
           ARRAY['draft-article','suggest-internal-links','extract-social-posts','outline-article'],
           ARRAY['publish-article','invent-data'])
        ON CONFLICT (skill_name) DO NOTHING;
      `);
    } catch (err) { logger.warn('marketing skills seed warning:', err.message); }

    logger.info('Marketing AI agent tables ready (migration 021)');
  }

  // Migration 022 – Market Intelligence + ESG scoring tables
  {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS market_price_observations (
          id SERIAL PRIMARY KEY,
          product VARCHAR(128) NOT NULL,
          retailer VARCHAR(128) NOT NULL,
          price_cad NUMERIC(10,2) NOT NULL,
          unit VARCHAR(32) DEFAULT 'per_kg',
          source VARCHAR(64) DEFAULT 'manual',
          observed_at TIMESTAMPTZ DEFAULT NOW(),
          created_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_mpo_product ON market_price_observations(product);
        CREATE INDEX IF NOT EXISTS idx_mpo_observed ON market_price_observations(observed_at);

        CREATE TABLE IF NOT EXISTS market_price_trends (
          id SERIAL PRIMARY KEY,
          product VARCHAR(128) NOT NULL,
          avg_price_7d NUMERIC(10,2),
          avg_price_30d NUMERIC(10,2),
          min_price_30d NUMERIC(10,2),
          max_price_30d NUMERIC(10,2),
          trend VARCHAR(16) DEFAULT 'stable',
          trend_percent NUMERIC(6,2) DEFAULT 0,
          observation_count INT DEFAULT 0,
          updated_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(product)
        );

        CREATE TABLE IF NOT EXISTS esg_assessments (
          id SERIAL PRIMARY KEY,
          farm_id VARCHAR(64) NOT NULL,
          energy_score NUMERIC(5,2) DEFAULT 0,
          water_score NUMERIC(5,2) DEFAULT 0,
          carbon_score NUMERIC(5,2) DEFAULT 0,
          food_miles_score NUMERIC(5,2) DEFAULT 0,
          waste_score NUMERIC(5,2) DEFAULT 0,
          employment_score NUMERIC(5,2) DEFAULT 0,
          community_score NUMERIC(5,2) DEFAULT 0,
          food_access_score NUMERIC(5,2) DEFAULT 0,
          traceability_score NUMERIC(5,2) DEFAULT 0,
          transparency_score NUMERIC(5,2) DEFAULT 0,
          compliance_score NUMERIC(5,2) DEFAULT 0,
          environmental_composite NUMERIC(5,2) DEFAULT 0,
          social_composite NUMERIC(5,2) DEFAULT 0,
          governance_composite NUMERIC(5,2) DEFAULT 0,
          overall_score NUMERIC(5,2) DEFAULT 0,
          grade VARCHAR(2) DEFAULT 'C',
          metrics_json JSONB DEFAULT '{}',
          assessed_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_esg_farm ON esg_assessments(farm_id);
        CREATE INDEX IF NOT EXISTS idx_esg_date ON esg_assessments(assessed_at);
      `);

      logger.info('Market intelligence & ESG tables ready (migration 022)');
    } catch (err) {
      logger.warn('Market intelligence & ESG migration warning:', err.message);
    }
  }

  // Migration 023: Add must_change_password to farm_users + setup_completed to farms
  try {
    await pool.query(`ALTER TABLE farm_users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT false`);
    await pool.query(`ALTER TABLE farms ADD COLUMN IF NOT EXISTS setup_completed BOOLEAN DEFAULT false`);
    await pool.query(`ALTER TABLE farms ADD COLUMN IF NOT EXISTS setup_completed_at TIMESTAMPTZ`);
    logger.info('must_change_password + setup_completed columns ready (migration 023)');
  } catch (err) {
    logger.warn('Migration 023 warning:', err.message);
  }

  // Migration 024: Campaign supporters (Field of Dreams) — individual statements for robustness
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS campaign_supporters (
        id SERIAL PRIMARY KEY,
        name VARCHAR(200) NOT NULL,
        email VARCHAR(320) NOT NULL UNIQUE,
        postal_code VARCHAR(7) NOT NULL,
        postal_prefix VARCHAR(3) NOT NULL,
        city VARCHAR(100),
        province VARCHAR(30),
        ip_address VARCHAR(45),
        referral_source VARCHAR(100),
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    logger.info('Campaign supporters table ready (migration 024)');
  } catch (err) {
    logger.warn('Campaign supporters table creation warning:', err.message);
  }
  try {
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_campaign_postal_prefix ON campaign_supporters(postal_prefix)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_campaign_created_at ON campaign_supporters(created_at)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_campaign_email ON campaign_supporters(email)`);
  } catch (err) {
    logger.warn('Campaign supporters index warning:', err.message);
  }

  // Migration 025: Eager creation of checkout_sessions, purchase_leads, procurement tables,
  // API metering, and token blacklist / login lockout persistence
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS checkout_sessions (
        id SERIAL PRIMARY KEY,
        session_id VARCHAR(255) UNIQUE NOT NULL,
        square_order_id VARCHAR(255),
        square_payment_link_id VARCHAR(255),
        square_payment_link_url TEXT,
        plan_type VARCHAR(50) NOT NULL,
        amount_cents INTEGER NOT NULL,
        currency VARCHAR(3) DEFAULT 'CAD',
        farm_name VARCHAR(255) NOT NULL,
        contact_name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL,
        existing_farm_id VARCHAR(255),
        provisioned_farm_id VARCHAR(255),
        status VARCHAR(50) DEFAULT 'pending',
        payment_id VARCHAR(255),
        error_message TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        completed_at TIMESTAMPTZ,
        metadata JSONB DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS idx_checkout_sessions_email ON checkout_sessions(email);
      CREATE INDEX IF NOT EXISTS idx_checkout_sessions_status ON checkout_sessions(status);
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS purchase_leads (
        id SERIAL PRIMARY KEY,
        farm_name VARCHAR(255),
        contact_name VARCHAR(255),
        email VARCHAR(255) NOT NULL,
        plan VARCHAR(50),
        farm_id VARCHAR(255),
        status VARCHAR(50) DEFAULT 'new',
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_purchase_leads_email ON purchase_leads(email);
    `);
    logger.info('checkout_sessions + purchase_leads tables ready (migration 025a)');
  } catch (err) {
    logger.warn('Migration 025a warning:', err.message);
  }

  // 025b: Procurement dedicated tables
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS procurement_catalog (
        id SERIAL PRIMARY KEY,
        farm_id VARCHAR(255) NOT NULL,
        sku VARCHAR(255) NOT NULL,
        name VARCHAR(255),
        category VARCHAR(120),
        supplier_id VARCHAR(255),
        price NUMERIC(10,2) DEFAULT 0,
        in_stock BOOLEAN DEFAULT TRUE,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(farm_id, sku)
      );
      CREATE INDEX IF NOT EXISTS idx_procurement_catalog_farm ON procurement_catalog(farm_id);
      CREATE INDEX IF NOT EXISTS idx_procurement_catalog_sku ON procurement_catalog(sku);
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS procurement_suppliers (
        id VARCHAR(255) PRIMARY KEY,
        farm_id VARCHAR(255) NOT NULL,
        name VARCHAR(255) NOT NULL,
        contact_name VARCHAR(255),
        email VARCHAR(255),
        phone VARCHAR(50),
        status VARCHAR(50) DEFAULT 'active',
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_procurement_suppliers_farm ON procurement_suppliers(farm_id);
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS procurement_orders (
        id VARCHAR(255) PRIMARY KEY,
        farm_id VARCHAR(255) NOT NULL,
        supplier_id VARCHAR(255),
        status VARCHAR(50) DEFAULT 'pending',
        items JSONB DEFAULT '[]',
        subtotal NUMERIC(10,2) DEFAULT 0,
        commission NUMERIC(10,2) DEFAULT 0,
        payment_method VARCHAR(50) DEFAULT 'invoice',
        payment_status VARCHAR(50) DEFAULT 'pending',
        shipping_address JSONB,
        notes TEXT,
        received_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_procurement_orders_farm ON procurement_orders(farm_id);
      CREATE INDEX IF NOT EXISTS idx_procurement_orders_status ON procurement_orders(status);
    `);
    logger.info('Procurement dedicated tables ready (migration 025b)');
  } catch (err) {
    logger.warn('Migration 025b warning:', err.message);
  }

  // 025c: API metering table
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS api_usage_daily (
        id SERIAL PRIMARY KEY,
        farm_id VARCHAR(255) NOT NULL,
        usage_date DATE NOT NULL DEFAULT CURRENT_DATE,
        api_calls INTEGER DEFAULT 0,
        storage_bytes BIGINT DEFAULT 0,
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(farm_id, usage_date)
      );
      CREATE INDEX IF NOT EXISTS idx_api_usage_daily_farm ON api_usage_daily(farm_id);
      CREATE INDEX IF NOT EXISTS idx_api_usage_daily_date ON api_usage_daily(usage_date);
    `);
    logger.info('API metering table ready (migration 025c)');
  } catch (err) {
    logger.warn('Migration 025c warning:', err.message);
  }

  // 025d: Token blacklist + login lockout persistence
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS token_blacklist (
        id SERIAL PRIMARY KEY,
        token_hash VARCHAR(64) NOT NULL UNIQUE,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_token_blacklist_hash ON token_blacklist(token_hash);
      CREATE INDEX IF NOT EXISTS idx_token_blacklist_expires ON token_blacklist(expires_at);
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS login_lockouts (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) NOT NULL UNIQUE,
        attempt_count INTEGER DEFAULT 0,
        locked_until TIMESTAMPTZ,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_login_lockouts_email ON login_lockouts(email);
    `);
    logger.info('Token blacklist + login lockouts tables ready (migration 025d)');
  } catch (err) {
    logger.warn('Migration 025d warning:', err.message);
  }

  // ── Migration 026: Delivery tracking events ──
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tracking_events (
        id SERIAL PRIMARY KEY,
        order_id VARCHAR(100) NOT NULL,
        event VARCHAR(100) NOT NULL,
        location TEXT,
        notes TEXT,
        recorded_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_tracking_events_order ON tracking_events(order_id);
    `);
    logger.info('Tracking events table ready (migration 026)');
  } catch (err) {
    logger.warn('Migration 026 warning:', err.message);
  }

  // ── Migration 027: AI usage tracking per farm ──
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ai_usage (
        id SERIAL PRIMARY KEY,
        farm_id VARCHAR(255),
        endpoint VARCHAR(100) NOT NULL,
        model VARCHAR(100) NOT NULL,
        prompt_tokens INTEGER,
        completion_tokens INTEGER,
        total_tokens INTEGER,
        audio_chars INTEGER,
        estimated_cost NUMERIC(10,6),
        status VARCHAR(20) DEFAULT 'success',
        error_message TEXT,
        user_id VARCHAR(255),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_ai_usage_farm ON ai_usage(farm_id);
      CREATE INDEX IF NOT EXISTS idx_ai_usage_endpoint ON ai_usage(endpoint);
      CREATE INDEX IF NOT EXISTS idx_ai_usage_created ON ai_usage(created_at);
      CREATE INDEX IF NOT EXISTS idx_ai_usage_farm_date ON ai_usage(farm_id, created_at);
    `);
    logger.info('AI usage tracking table ready (migration 027)');
  } catch (err) {
    logger.warn('Migration 027 warning:', err.message);
  }

  // ── Migration 028: User memory, feedback persistence, engagement metrics ──
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_memory (
        id SERIAL PRIMARY KEY,
        farm_id VARCHAR(255) NOT NULL,
        key VARCHAR(100) NOT NULL,
        value TEXT NOT NULL,
        source VARCHAR(50) DEFAULT 'assistant',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(farm_id, key)
      );
      CREATE INDEX IF NOT EXISTS idx_user_memory_farm ON user_memory(farm_id);
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS assistant_feedback (
        id SERIAL PRIMARY KEY,
        farm_id VARCHAR(255) NOT NULL,
        conversation_id VARCHAR(100),
        rating VARCHAR(10) NOT NULL CHECK (rating IN ('up', 'down')),
        snippet TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_feedback_farm ON assistant_feedback(farm_id);
      CREATE INDEX IF NOT EXISTS idx_feedback_created ON assistant_feedback(created_at);
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS engagement_metrics (
        id SERIAL PRIMARY KEY,
        farm_id VARCHAR(255) NOT NULL,
        period_start DATE NOT NULL,
        period_end DATE NOT NULL,
        total_sessions INTEGER DEFAULT 0,
        total_messages INTEGER DEFAULT 0,
        total_tool_calls INTEGER DEFAULT 0,
        tools_used JSONB DEFAULT '{}',
        positive_feedback INTEGER DEFAULT 0,
        negative_feedback INTEGER DEFAULT 0,
        top_topics TEXT[],
        memory_facts_count INTEGER DEFAULT 0,
        report_sent_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(farm_id, period_start)
      );
      CREATE INDEX IF NOT EXISTS idx_engagement_farm ON engagement_metrics(farm_id);
      CREATE INDEX IF NOT EXISTS idx_engagement_period ON engagement_metrics(period_start);
    `);
    logger.info('User memory, feedback, engagement tables ready (migration 028)');
  } catch (err) {
    logger.warn('Migration 028 warning:', err.message);
  }

  // Migration 029: Conversation history persistence
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS conversation_history (
        id SERIAL PRIMARY KEY,
        farm_id VARCHAR(100) NOT NULL,
        conversation_id VARCHAR(200) NOT NULL,
        messages JSONB NOT NULL DEFAULT '[]',
        message_count INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(farm_id, conversation_id)
      );
      CREATE INDEX IF NOT EXISTS idx_conv_farm ON conversation_history(farm_id);
      CREATE INDEX IF NOT EXISTS idx_conv_updated ON conversation_history(updated_at);
    `);
    logger.info('Conversation history table ready (migration 029)');
  } catch (err) {
    logger.warn('Migration 029 warning:', err.message);
  }

  // Migration 030: Farm alerts table (self-solving error system) + load optimized planting schedule
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS farm_alerts (
        id SERIAL PRIMARY KEY,
        farm_id VARCHAR(100) NOT NULL,
        severity VARCHAR(20) DEFAULT 'warning',
        tool VARCHAR(100),
        error TEXT,
        recovery_attempted BOOLEAN DEFAULT false,
        recovery_strategy VARCHAR(100),
        resolved BOOLEAN DEFAULT false,
        conversation_id VARCHAR(200),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_farm_alerts_farm ON farm_alerts(farm_id);
      CREATE INDEX IF NOT EXISTS idx_farm_alerts_unresolved ON farm_alerts(farm_id, resolved) WHERE resolved = false;
    `);
    logger.info('Farm alerts table ready (migration 030a)');
  } catch (err) {
    logger.warn('Migration 030a warning:', err.message);
  }

  // Migration 030b: Load optimized planting schedule (78 assignments, succession planting)
  try {
    const scheduleFile = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'public', 'data', 'planting-schedule.json');
    if (fs.existsSync(scheduleFile)) {
      const schedule = JSON.parse(fs.readFileSync(scheduleFile, 'utf8'));
      const assignments = schedule.assignments || [];
      if (assignments.length > 0) {
        // Check if schedule already loaded (idempotent)
        const existing = await pool.query("SELECT COUNT(*) as cnt FROM planting_assignments WHERE farm_id = 'demo-farm'");
        const existingCount = parseInt(existing.rows[0].cnt);
        if (existingCount < assignments.length) {
          // Clear and reload — wrapped in transaction for atomicity
          const client = await pool.connect();
          try {
            await client.query('BEGIN');
            await client.query("DELETE FROM planting_assignments WHERE farm_id = 'demo-farm'");
            for (const a of assignments) {
              await client.query(
                `INSERT INTO planting_assignments (farm_id, group_id, crop_id, crop_name, seed_date, harvest_date, status, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
                 ON CONFLICT (farm_id, group_id) DO UPDATE SET crop_id=EXCLUDED.crop_id, crop_name=EXCLUDED.crop_name, seed_date=EXCLUDED.seed_date, harvest_date=EXCLUDED.harvest_date, status=EXCLUDED.status, updated_at=NOW()`,
                [a.farm_id, a.group_id, a.crop_id, a.crop_name, a.seed_date, a.harvest_date, a.status]
              );
            }
            await client.query('COMMIT');
            logger.info(`Planting schedule loaded: ${assignments.length} assignments (migration 030b)`);
          } catch (txErr) {
            await client.query('ROLLBACK');
            throw txErr;
          } finally {
            client.release();
          }
        } else {
          logger.info(`Planting schedule already loaded (${existingCount} assignments) — skipping (migration 030b)`);
        }
      }
    }
  } catch (err) {
    logger.warn('Migration 030b warning:', err.message);
  }

  // Migration 031: Conversation summaries for E.V.I.E. persistent memory
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS conversation_summaries (
        id SERIAL PRIMARY KEY,
        farm_id VARCHAR(255),
        summary TEXT NOT NULL,
        message_count INT DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_convsumm_farm ON conversation_summaries(farm_id);
      CREATE INDEX IF NOT EXISTS idx_convsumm_created ON conversation_summaries(created_at DESC);
    `);
    logger.info('Conversation summaries table ready (migration 031)');
  } catch (err) {
    logger.warn('Migration 031 warning:', err.message);
  }

  // Migration 032 — Nightly system audit results
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS system_audits (
        id SERIAL PRIMARY KEY,
        audit_date DATE NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'pass',
        checks JSONB DEFAULT '[]',
        summary JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(audit_date)
      );
      CREATE INDEX IF NOT EXISTS idx_system_audits_date ON system_audits(audit_date DESC);
      CREATE INDEX IF NOT EXISTS idx_system_audits_status ON system_audits(status);
    `);
    logger.info('System audits table ready (migration 032)');
  } catch (err) {
    logger.warn('Migration 032 warning:', err.message);
  }

  // Migration 033a — F.A.Y.E. admin assistant conversation/memory tables
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS admin_assistant_conversations (
        id SERIAL PRIMARY KEY,
        admin_id INTEGER NOT NULL,
        conversation_id VARCHAR(200) NOT NULL,
        messages JSONB NOT NULL DEFAULT '[]',
        message_count INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(admin_id, conversation_id)
      );
      CREATE INDEX IF NOT EXISTS idx_admin_conv_admin ON admin_assistant_conversations(admin_id);
      CREATE INDEX IF NOT EXISTS idx_admin_conv_updated ON admin_assistant_conversations(updated_at);
    `);
  } catch (err) {
    logger.warn('Migration 033a (conversations) warning:', err.message);
  }

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS admin_assistant_memory (
        id SERIAL PRIMARY KEY,
        admin_id INTEGER NOT NULL,
        key VARCHAR(100) NOT NULL,
        value TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(admin_id, key)
      );
      CREATE INDEX IF NOT EXISTS idx_admin_memory_admin ON admin_assistant_memory(admin_id);
    `);
  } catch (err) {
    logger.warn('Migration 033a (memory) warning:', err.message);
  }

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS admin_assistant_summaries (
        id SERIAL PRIMARY KEY,
        admin_id INTEGER NOT NULL,
        summary TEXT NOT NULL,
        message_count INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_admin_summaries_admin ON admin_assistant_summaries(admin_id);
    `);
  } catch (err) {
    logger.warn('Migration 033a (summaries) warning:', err.message);
  }

  // Migration 033b — admin_alerts (isolated so earlier table failures cannot block it)
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS admin_alerts (
        id BIGSERIAL PRIMARY KEY,
        domain VARCHAR(50) NOT NULL,
        severity VARCHAR(20) NOT NULL DEFAULT 'warning',
        title VARCHAR(255) NOT NULL,
        detail TEXT,
        source VARCHAR(100),
        metadata JSONB DEFAULT '{}',
        acknowledged BOOLEAN DEFAULT FALSE,
        acknowledged_by INTEGER,
        acknowledged_at TIMESTAMPTZ,
        resolved BOOLEAN DEFAULT FALSE,
        resolved_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_admin_alerts_open ON admin_alerts(resolved, created_at DESC) WHERE resolved = FALSE;
      CREATE INDEX IF NOT EXISTS idx_admin_alerts_domain ON admin_alerts(domain, created_at DESC);
    `);
    logger.info('F.A.Y.E. admin assistant tables ready (migration 033)');
  } catch (err) {
    logger.warn('Migration 033b (admin_alerts) warning:', err.message);
  }

  // Migration 034 — F.A.Y.E. Phase 3-4: Decision log + accounting classification uniqueness
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS faye_decision_log (
        id BIGSERIAL PRIMARY KEY,
        tool_name VARCHAR(100) NOT NULL,
        params JSONB DEFAULT '{}',
        result_ok BOOLEAN DEFAULT TRUE,
        result_summary TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_faye_decision_log_created ON faye_decision_log(created_at DESC);
    `);
    // Ensure unique index on accounting_classifications.transaction_id for ON CONFLICT
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_acct_class_txn_unique ON accounting_classifications(transaction_id);
    `).catch(() => {}); // may fail if duplicate rows exist — non-fatal
    logger.info('F.A.Y.E. Phase 3-4 tables ready (migration 034)');
  } catch (err) {
    logger.warn('Migration 034 warning:', err.message);
  }

  // Migration 035 — F.A.Y.E. Phase 5: Learning Engine (knowledge base, outcomes, patterns)
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS faye_knowledge (
        id BIGSERIAL PRIMARY KEY,
        domain VARCHAR(60) NOT NULL,
        topic VARCHAR(200) NOT NULL,
        insight TEXT NOT NULL,
        source VARCHAR(120) DEFAULT 'conversation',
        confidence NUMERIC(3,2) DEFAULT 0.7,
        access_count INT DEFAULT 0,
        archived BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(domain, topic)
      );
      CREATE INDEX IF NOT EXISTS idx_faye_knowledge_domain ON faye_knowledge(domain, confidence DESC);
      CREATE INDEX IF NOT EXISTS idx_faye_knowledge_active ON faye_knowledge(archived, confidence DESC, updated_at DESC) WHERE archived = FALSE;
    `);
  } catch (err) {
    logger.warn('Migration 035 (faye_knowledge) warning:', err.message);
  }

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS faye_outcomes (
        id BIGSERIAL PRIMARY KEY,
        decision_id BIGINT REFERENCES faye_decision_log(id) ON DELETE SET NULL,
        outcome VARCHAR(30) NOT NULL,
        feedback TEXT,
        admin_id INT DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_faye_outcomes_decision ON faye_outcomes(decision_id);
      CREATE INDEX IF NOT EXISTS idx_faye_outcomes_created ON faye_outcomes(created_at DESC);
    `);
  } catch (err) {
    logger.warn('Migration 035 (faye_outcomes) warning:', err.message);
  }

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS faye_patterns (
        id BIGSERIAL PRIMARY KEY,
        pattern_key VARCHAR(200) NOT NULL UNIQUE,
        domain VARCHAR(60) NOT NULL,
        description TEXT NOT NULL,
        metadata JSONB DEFAULT '{}',
        occurrence_count INT DEFAULT 1,
        suppressed BOOLEAN DEFAULT FALSE,
        first_seen_at TIMESTAMPTZ DEFAULT NOW(),
        last_seen_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_faye_patterns_domain ON faye_patterns(domain, occurrence_count DESC);
      CREATE INDEX IF NOT EXISTS idx_faye_patterns_active ON faye_patterns(suppressed, last_seen_at DESC) WHERE suppressed = FALSE;
    `);
    logger.info('F.A.Y.E. Phase 5 learning tables ready (migration 035)');
  } catch (err) {
    logger.warn('Migration 035 (faye_patterns) warning:', err.message);
  }

  // ─── Migration 036: Traceability, Lots, Harvest Events, Label System ──
  try {
    // harvest_events: records each harvest with yield and quality data
    await client.query(`
      CREATE TABLE IF NOT EXISTS harvest_events (
        id SERIAL PRIMARY KEY,
        farm_id VARCHAR(255) NOT NULL,
        group_id VARCHAR(255) NOT NULL,
        crop_id VARCHAR(255) NOT NULL,
        crop_name VARCHAR(255),
        harvest_date DATE NOT NULL,
        plants_harvested INTEGER,
        gross_weight_oz DECIMAL(10,2),
        net_weight_oz DECIMAL(10,2),
        quality_score DECIMAL(3,2) DEFAULT 0.70,
        quality_notes TEXT,
        harvested_by VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW(),
        FOREIGN KEY (farm_id) REFERENCES farms(farm_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_harvest_events_farm ON harvest_events(farm_id);
      CREATE INDEX IF NOT EXISTS idx_harvest_events_group ON harvest_events(group_id);
      CREATE INDEX IF NOT EXISTS idx_harvest_events_date ON harvest_events(harvest_date);
      CREATE INDEX IF NOT EXISTS idx_harvest_events_crop ON harvest_events(crop_id);
    `);

    // lot_records: each harvest creates a lot for traceability
    await client.query(`
      CREATE TABLE IF NOT EXISTS lot_records (
        id SERIAL PRIMARY KEY,
        lot_number VARCHAR(64) UNIQUE NOT NULL,
        farm_id VARCHAR(255) NOT NULL,
        harvest_event_id INTEGER,
        group_id VARCHAR(255),
        crop_id VARCHAR(255) NOT NULL,
        crop_name VARCHAR(255),
        seed_date DATE,
        harvest_date DATE NOT NULL,
        seed_source VARCHAR(255),
        seed_lot VARCHAR(255),
        weight_oz DECIMAL(10,2),
        quality_score DECIMAL(3,2),
        best_by_date DATE,
        status VARCHAR(50) DEFAULT 'active',
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT NOW(),
        FOREIGN KEY (farm_id) REFERENCES farms(farm_id) ON DELETE CASCADE,
        FOREIGN KEY (harvest_event_id) REFERENCES harvest_events(id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_lot_records_farm ON lot_records(farm_id);
      CREATE INDEX IF NOT EXISTS idx_lot_records_lot ON lot_records(lot_number);
      CREATE INDEX IF NOT EXISTS idx_lot_records_crop ON lot_records(crop_id);
      CREATE INDEX IF NOT EXISTS idx_lot_records_harvest_date ON lot_records(harvest_date);
      CREATE INDEX IF NOT EXISTS idx_lot_records_status ON lot_records(status);
    `);

    // Add traceability columns to existing tables
    await client.query(`
      ALTER TABLE planting_assignments ADD COLUMN IF NOT EXISTS seed_source VARCHAR(255);
      ALTER TABLE planting_assignments ADD COLUMN IF NOT EXISTS seed_lot VARCHAR(255);
    `);

    await client.query(`
      ALTER TABLE farm_inventory ADD COLUMN IF NOT EXISTS lot_number VARCHAR(64);
      ALTER TABLE farm_inventory ADD COLUMN IF NOT EXISTS quality_score DECIMAL(3,2);
      ALTER TABLE farm_inventory ADD COLUMN IF NOT EXISTS best_by_date DATE;
      ALTER TABLE farm_inventory ADD COLUMN IF NOT EXISTS harvest_event_id INTEGER;
      CREATE INDEX IF NOT EXISTS idx_farm_inventory_lot ON farm_inventory(lot_number);
    `);

    logger.info('Traceability, lots, harvest events tables ready (migration 036)');
  } catch (err) {
    logger.warn('Migration 036 warning:', err.message);
  }

  // ─── Migration 037: Producer Portal Tables ────────────────────────────────
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS producer_applications (
        id SERIAL PRIMARY KEY,
        business_name VARCHAR(255) NOT NULL,
        contact_name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL,
        phone VARCHAR(50),
        website TEXT,
        location JSONB DEFAULT '{}',
        certifications TEXT[] DEFAULT '{}',
        practices TEXT[] DEFAULT '{}',
        product_types TEXT[] DEFAULT '{}',
        description TEXT,
        password_hash VARCHAR(255) NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'pending',
        reviewed_by VARCHAR(255),
        review_notes TEXT,
        farm_id VARCHAR(255),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        reviewed_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_producer_applications_email ON producer_applications(email);
      CREATE INDEX IF NOT EXISTS idx_producer_applications_status ON producer_applications(status);
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS producer_accounts (
        id SERIAL PRIMARY KEY,
        farm_id VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        display_name VARCHAR(255),
        role VARCHAR(50) NOT NULL DEFAULT 'producer',
        status VARCHAR(50) NOT NULL DEFAULT 'active',
        last_login TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_producer_accounts_email ON producer_accounts(email);
      CREATE INDEX IF NOT EXISTS idx_producer_accounts_farm ON producer_accounts(farm_id);
    `);

    logger.info('Producer portal tables ready (migration 037)');
  } catch (err) {
    logger.warn('Migration 037 warning:', err.message);
  }

  // ─── Migration 038: App Errors table (FAYE error telemetry) ────────
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS app_errors (
        id SERIAL PRIMARY KEY,
        method TEXT NOT NULL,
        route TEXT NOT NULL,
        status_code INTEGER NOT NULL DEFAULT 500,
        error_type TEXT,
        message TEXT NOT NULL,
        stack_hash TEXT,
        count INTEGER NOT NULL DEFAULT 1,
        first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        metadata JSONB DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS idx_app_errors_last_seen ON app_errors(last_seen DESC);
      CREATE INDEX IF NOT EXISTS idx_app_errors_stack_hash ON app_errors(stack_hash);
    `);

    logger.info('App errors table ready (migration 038)');
  } catch (err) {
    logger.warn('Migration 038 warning:', err.message);
  }

  // ─── Migration 039: Fix farm_alerts schema — add alert_type and message columns ───
  // logSystemAlert() in assistant-chat.js inserts alert_type, severity, message, farm_id
  // but the original CREATE TABLE (migration 030) only had tool, error, recovery columns.
  try {
    await client.query(`
      ALTER TABLE farm_alerts ADD COLUMN IF NOT EXISTS alert_type VARCHAR(100);
      ALTER TABLE farm_alerts ADD COLUMN IF NOT EXISTS message TEXT;
    `);
    logger.info('Farm alerts columns aligned (migration 039)');
  } catch (err) {
    logger.warn('Migration 039 warning:', err.message);
  }

  // ─── Migration 040: Tenant RLS policies (phase A: ENABLE, no FORCE) ───
  try {
    await client.query(`
      DO $$
      DECLARE
        t text;
        tenant_tables text[] := ARRAY[
          'farms',
          'farm_backups',
          'farm_data',
          'farm_heartbeats',
          'planting_assignments',
          'experiment_records',
          'products',
          'farm_inventory',
          'farm_users',
          'farm_delivery_settings',
          'farm_delivery_windows',
          'farm_delivery_zones',
          'delivery_orders',
          'farm_alerts',
          'conversation_history',
          'harvest_events',
          'lot_records',
          'producer_accounts',
          'producer_applications'
        ];
      BEGIN
        FOREACH t IN ARRAY tenant_tables LOOP
          IF to_regclass(t) IS NOT NULL THEN
            EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
            EXECUTE format('DROP POLICY IF EXISTS gr_tenant_isolation ON %I', t);

            EXECUTE format($POLICY$
              CREATE POLICY gr_tenant_isolation ON %I
              USING (
                current_setting('app.is_admin', true) = 'true'
                OR farm_id::text = current_setting('app.current_farm_id', true)
              )
              WITH CHECK (
                current_setting('app.is_admin', true) = 'true'
                OR farm_id::text = current_setting('app.current_farm_id', true)
              )
            $POLICY$, t);
          END IF;
        END LOOP;
      END $$;
    `);

    logger.info('Tenant RLS policies applied (migration 040)');
  } catch (err) {
    logger.warn('Migration 040 warning:', err.message);
  }

  // Migration 041: agent_messages table for FAYE-EVIE inter-agent communication
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS agent_messages (
        id SERIAL PRIMARY KEY,
        sender VARCHAR(20) NOT NULL,
        recipient VARCHAR(20) NOT NULL,
        message_type VARCHAR(30) NOT NULL,
        subject VARCHAR(200) NOT NULL,
        body TEXT NOT NULL,
        context JSONB DEFAULT '{}',
        priority VARCHAR(10) DEFAULT 'normal',
        reply_to_id INTEGER REFERENCES agent_messages(id),
        status VARCHAR(10) DEFAULT 'unread',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_agent_messages_recipient_status
        ON agent_messages (recipient, status)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_agent_messages_created_at
        ON agent_messages (created_at DESC)
    `);
    logger.info('agent_messages table ensured (migration 041)');
  } catch (err) {
    logger.warn('Migration 041 warning:', err.message);
  }

// ─── Migration 042: Research Platform — Study Design & Protocol Management ───
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS studies (
        id SERIAL PRIMARY KEY,
        farm_id VARCHAR(255) NOT NULL REFERENCES farms(farm_id) ON DELETE CASCADE,
        title VARCHAR(500) NOT NULL,
        pi_user_id UUID REFERENCES farm_users(id),
        status VARCHAR(50) DEFAULT 'draft' CHECK (status IN ('draft','active','paused','completed','archived')),
        objectives TEXT,
        hypotheses TEXT,
        irb_number VARCHAR(100),
        funding_source VARCHAR(255),
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_studies_farm_id ON studies(farm_id);
      CREATE INDEX IF NOT EXISTS idx_studies_status ON studies(status);
      CREATE INDEX IF NOT EXISTS idx_studies_pi ON studies(pi_user_id);

      CREATE TABLE IF NOT EXISTS study_protocols (
        id SERIAL PRIMARY KEY,
        study_id INTEGER NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
        version INTEGER NOT NULL DEFAULT 1,
        title VARCHAR(500),
        content JSONB DEFAULT '{}',
        treatment_factors JSONB DEFAULT '{}',
        approved_by UUID REFERENCES farm_users(id),
        approved_at TIMESTAMPTZ,
        status VARCHAR(50) DEFAULT 'draft' CHECK (status IN ('draft','active','superseded')),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(study_id, version)
      );

      CREATE INDEX IF NOT EXISTS idx_study_protocols_study ON study_protocols(study_id);

      CREATE TABLE IF NOT EXISTS treatment_groups (
        id SERIAL PRIMARY KEY,
        protocol_id INTEGER NOT NULL REFERENCES study_protocols(id) ON DELETE CASCADE,
        group_name VARCHAR(255) NOT NULL,
        factor_definitions JSONB DEFAULT '{}',
        control_group BOOLEAN DEFAULT FALSE,
        replicate_count INTEGER DEFAULT 1,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_treatment_groups_protocol ON treatment_groups(protocol_id);

      CREATE TABLE IF NOT EXISTS study_links (
        id SERIAL PRIMARY KEY,
        study_id INTEGER NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
        entity_type VARCHAR(50) NOT NULL CHECK (entity_type IN ('room','device','recipe','lot','group','dataset')),
        entity_id VARCHAR(255) NOT NULL,
        linked_at TIMESTAMPTZ DEFAULT NOW(),
        linked_by UUID REFERENCES farm_users(id),
        UNIQUE(study_id, entity_type, entity_id)
      );

      CREATE INDEX IF NOT EXISTS idx_study_links_study ON study_links(study_id);
      CREATE INDEX IF NOT EXISTS idx_study_links_entity ON study_links(entity_type, entity_id);

      CREATE TABLE IF NOT EXISTS trial_milestones (
        id SERIAL PRIMARY KEY,
        study_id INTEGER NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
        milestone_type VARCHAR(100) NOT NULL,
        planned_date DATE,
        actual_date DATE,
        status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending','completed','skipped','delayed')),
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_trial_milestones_study ON trial_milestones(study_id);

      CREATE TABLE IF NOT EXISTS protocol_deviations (
        id SERIAL PRIMARY KEY,
        study_id INTEGER NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
        protocol_version_id INTEGER REFERENCES study_protocols(id),
        deviation_type VARCHAR(100),
        description TEXT NOT NULL,
        impact_assessment TEXT,
        recorded_by UUID REFERENCES farm_users(id),
        recorded_at TIMESTAMPTZ DEFAULT NOW(),
        reviewed_by UUID REFERENCES farm_users(id),
        reviewed_at TIMESTAMPTZ
      );

      CREATE INDEX IF NOT EXISTS idx_protocol_deviations_study ON protocol_deviations(study_id);

      ALTER TABLE experiment_records ADD COLUMN IF NOT EXISTS study_id INTEGER REFERENCES studies(id);
      CREATE INDEX IF NOT EXISTS idx_experiment_records_study ON experiment_records(study_id);
    `);
    logger.info('Research study design tables ready (migration 042)');
  } catch (err) {
    logger.warn('Migration 042 warning:', err.message);
  }

  // ─── Migration 043: Research Data Model & Provenance ───
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS research_datasets (
        id SERIAL PRIMARY KEY,
        study_id INTEGER REFERENCES studies(id) ON DELETE SET NULL,
        farm_id VARCHAR(255) NOT NULL REFERENCES farms(farm_id) ON DELETE CASCADE,
        name VARCHAR(500) NOT NULL,
        version INTEGER DEFAULT 1,
        description TEXT,
        variable_definitions JSONB DEFAULT '[]',
        unit_normalization JSONB DEFAULT '{}',
        timezone VARCHAR(50) DEFAULT 'UTC',
        status VARCHAR(50) DEFAULT 'draft' CHECK (status IN ('draft','collecting','locked','published')),
        created_by UUID REFERENCES farm_users(id),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        locked_at TIMESTAMPTZ
      );

      CREATE INDEX IF NOT EXISTS idx_research_datasets_study ON research_datasets(study_id);
      CREATE INDEX IF NOT EXISTS idx_research_datasets_farm ON research_datasets(farm_id);
      CREATE INDEX IF NOT EXISTS idx_research_datasets_status ON research_datasets(status);

      CREATE TABLE IF NOT EXISTS research_observations (
        id BIGSERIAL PRIMARY KEY,
        dataset_id INTEGER NOT NULL REFERENCES research_datasets(id) ON DELETE CASCADE,
        observation_type VARCHAR(50) NOT NULL CHECK (observation_type IN ('sensor','manual','derived')),
        device_id VARCHAR(255),
        sensor_id VARCHAR(255),
        sample_id VARCHAR(255),
        variable_name VARCHAR(255) NOT NULL,
        raw_value NUMERIC,
        cleaned_value NUMERIC,
        derived_value NUMERIC,
        unit VARCHAR(50),
        observed_at TIMESTAMPTZ NOT NULL,
        ingested_at TIMESTAMPTZ DEFAULT NOW(),
        is_immutable BOOLEAN DEFAULT TRUE
      );

      CREATE INDEX IF NOT EXISTS idx_research_obs_dataset ON research_observations(dataset_id);
      CREATE INDEX IF NOT EXISTS idx_research_obs_observed ON research_observations(observed_at);
      CREATE INDEX IF NOT EXISTS idx_research_obs_variable ON research_observations(variable_name);
      CREATE INDEX IF NOT EXISTS idx_research_obs_device ON research_observations(device_id);
      CREATE INDEX IF NOT EXISTS idx_research_obs_sample ON research_observations(sample_id);

      CREATE TABLE IF NOT EXISTS data_transformations (
        id SERIAL PRIMARY KEY,
        dataset_id INTEGER NOT NULL REFERENCES research_datasets(id) ON DELETE CASCADE,
        input_observation_ids BIGINT[] DEFAULT '{}',
        output_observation_ids BIGINT[] DEFAULT '{}',
        transformation_type VARCHAR(50) NOT NULL CHECK (transformation_type IN ('clean','normalize','aggregate','derive','interpolate')),
        parameters JSONB DEFAULT '{}',
        applied_by UUID REFERENCES farm_users(id),
        applied_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_data_transformations_dataset ON data_transformations(dataset_id);

      CREATE TABLE IF NOT EXISTS provenance_records (
        id SERIAL PRIMARY KEY,
        entity_type VARCHAR(50) NOT NULL CHECK (entity_type IN ('observation','dataset','export','analysis','transformation')),
        entity_id BIGINT NOT NULL,
        source_type VARCHAR(50) NOT NULL CHECK (source_type IN ('sensor','device','recipe','transformation','calibration','manual','import')),
        source_id VARCHAR(255),
        source_metadata JSONB DEFAULT '{}',
        recorded_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_provenance_entity ON provenance_records(entity_type, entity_id);
      CREATE INDEX IF NOT EXISTS idx_provenance_source ON provenance_records(source_type, source_id);

      CREATE TABLE IF NOT EXISTS calibration_logs (
        id SERIAL PRIMARY KEY,
        farm_id VARCHAR(255) NOT NULL REFERENCES farms(farm_id) ON DELETE CASCADE,
        device_id VARCHAR(255) NOT NULL,
        sensor_id VARCHAR(255),
        calibration_type VARCHAR(100),
        reference_value NUMERIC,
        measured_value NUMERIC,
        offset_value NUMERIC,
        status VARCHAR(50) DEFAULT 'current' CHECK (status IN ('current','superseded')),
        calibrated_by UUID REFERENCES farm_users(id),
        calibrated_at TIMESTAMPTZ DEFAULT NOW(),
        next_due TIMESTAMPTZ
      );

      CREATE INDEX IF NOT EXISTS idx_calibration_logs_farm ON calibration_logs(farm_id);
      CREATE INDEX IF NOT EXISTS idx_calibration_logs_device ON calibration_logs(device_id);
      CREATE INDEX IF NOT EXISTS idx_calibration_logs_status ON calibration_logs(status);

      CREATE TABLE IF NOT EXISTS device_maintenance (
        id SERIAL PRIMARY KEY,
        farm_id VARCHAR(255) NOT NULL REFERENCES farms(farm_id) ON DELETE CASCADE,
        device_id VARCHAR(255) NOT NULL,
        maintenance_type VARCHAR(100) NOT NULL,
        description TEXT,
        performed_by UUID REFERENCES farm_users(id),
        performed_at TIMESTAMPTZ DEFAULT NOW(),
        next_scheduled TIMESTAMPTZ
      );

      CREATE INDEX IF NOT EXISTS idx_device_maintenance_farm ON device_maintenance(farm_id);
      CREATE INDEX IF NOT EXISTS idx_device_maintenance_device ON device_maintenance(device_id);
    `);
    logger.info('Research data model and provenance tables ready (migration 043)');
  } catch (err) {
    logger.warn('Migration 043 warning:', err.message);
  }

  // ─── Migration 044: Research Exports & Data Quality ───
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS export_packages (
        id SERIAL PRIMARY KEY,
        study_id INTEGER REFERENCES studies(id) ON DELETE SET NULL,
        dataset_id INTEGER REFERENCES research_datasets(id) ON DELETE SET NULL,
        farm_id VARCHAR(255) NOT NULL REFERENCES farms(farm_id) ON DELETE CASCADE,
        format VARCHAR(50) NOT NULL CHECK (format IN ('csv','parquet','json','notebook')),
        includes_metadata BOOLEAN DEFAULT TRUE,
        includes_provenance BOOLEAN DEFAULT FALSE,
        includes_data_dictionary BOOLEAN DEFAULT TRUE,
        file_path TEXT,
        file_size BIGINT,
        generated_by UUID REFERENCES farm_users(id),
        generated_at TIMESTAMPTZ DEFAULT NOW(),
        checksum VARCHAR(128)
      );

      CREATE INDEX IF NOT EXISTS idx_export_packages_study ON export_packages(study_id);
      CREATE INDEX IF NOT EXISTS idx_export_packages_farm ON export_packages(farm_id);

      CREATE TABLE IF NOT EXISTS data_quality_flags (
        id SERIAL PRIMARY KEY,
        observation_id BIGINT NOT NULL REFERENCES research_observations(id) ON DELETE CASCADE,
        flag_type VARCHAR(50) NOT NULL CHECK (flag_type IN ('missing','outlier','suspect','calibration_drift','gap','range_exceeded')),
        severity VARCHAR(20) DEFAULT 'warning' CHECK (severity IN ('info','warning','critical')),
        description TEXT,
        flagged_by VARCHAR(50) DEFAULT 'system',
        reviewed_by UUID REFERENCES farm_users(id),
        review_status VARCHAR(50) DEFAULT 'pending' CHECK (review_status IN ('pending','accepted','dismissed')),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        reviewed_at TIMESTAMPTZ
      );

      CREATE INDEX IF NOT EXISTS idx_dq_flags_observation ON data_quality_flags(observation_id);
      CREATE INDEX IF NOT EXISTS idx_dq_flags_status ON data_quality_flags(review_status);

      CREATE TABLE IF NOT EXISTS qc_reviews (
        id SERIAL PRIMARY KEY,
        dataset_id INTEGER NOT NULL REFERENCES research_datasets(id) ON DELETE CASCADE,
        reviewer_id UUID REFERENCES farm_users(id),
        status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending','approved','requires_changes')),
        completeness_score NUMERIC(5,2),
        notes TEXT,
        reviewed_at TIMESTAMPTZ
      );

      CREATE INDEX IF NOT EXISTS idx_qc_reviews_dataset ON qc_reviews(dataset_id);

      CREATE TABLE IF NOT EXISTS study_alerts (
        id SERIAL PRIMARY KEY,
        study_id INTEGER NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
        device_id VARCHAR(255),
        alert_type VARCHAR(50) NOT NULL CHECK (alert_type IN ('offline','calibration_overdue','data_gap','outlier_cluster','completeness_low')),
        message TEXT NOT NULL,
        severity VARCHAR(20) DEFAULT 'warning',
        acknowledged_by UUID REFERENCES farm_users(id),
        acknowledged_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_study_alerts_study ON study_alerts(study_id);
      CREATE INDEX IF NOT EXISTS idx_study_alerts_type ON study_alerts(alert_type);
    `);
    logger.info('Research exports and data quality tables ready (migration 044)');
  } catch (err) {
    logger.warn('Migration 044 warning:', err.message);
  }

  // ─── Migration 045: Grant/DMP/Compliance & Budgeting ───
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS data_management_plans (
        id SERIAL PRIMARY KEY,
        study_id INTEGER NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
        template_type VARCHAR(50) DEFAULT 'custom' CHECK (template_type IN ('tri_agency','nih','horizon_europe','custom')),
        sections JSONB DEFAULT '{}',
        status VARCHAR(50) DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved')),
        reviewed_by UUID REFERENCES farm_users(id),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_dmp_study ON data_management_plans(study_id);

      CREATE TABLE IF NOT EXISTS retention_policies (
        id SERIAL PRIMARY KEY,
        study_id INTEGER NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
        retention_period_years INTEGER DEFAULT 10,
        archival_location VARCHAR(255),
        embargo_until DATE,
        sharing_level VARCHAR(50) DEFAULT 'private' CHECK (sharing_level IN ('private','team','institution','public')),
        auto_delete_after DATE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_retention_study ON retention_policies(study_id);

      CREATE TABLE IF NOT EXISTS grant_budgets (
        id SERIAL PRIMARY KEY,
        study_id INTEGER NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
        grant_application_id INTEGER,
        budget_name VARCHAR(255) NOT NULL,
        award_period_start DATE,
        award_period_end DATE,
        total_amount NUMERIC(12,2) DEFAULT 0,
        indirect_rate NUMERIC(5,2) DEFAULT 0,
        status VARCHAR(50) DEFAULT 'draft' CHECK (status IN ('draft','active','closed')),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_grant_budgets_study ON grant_budgets(study_id);

      CREATE TABLE IF NOT EXISTS budget_line_items (
        id SERIAL PRIMARY KEY,
        budget_id INTEGER NOT NULL REFERENCES grant_budgets(id) ON DELETE CASCADE,
        category VARCHAR(100) NOT NULL CHECK (category IN ('equipment','consumables','personnel','stipend','in_kind','overhead','travel','other')),
        description TEXT NOT NULL,
        planned_amount NUMERIC(12,2) DEFAULT 0,
        actual_amount NUMERIC(12,2) DEFAULT 0,
        cost_centre VARCHAR(100),
        experiment_phase VARCHAR(100),
        invoiced BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_budget_items_budget ON budget_line_items(budget_id);
      CREATE INDEX IF NOT EXISTS idx_budget_items_category ON budget_line_items(category);

      CREATE TABLE IF NOT EXISTS researcher_profiles (
        id SERIAL PRIMARY KEY,
        user_id UUID REFERENCES farm_users(id),
        farm_id VARCHAR(255) NOT NULL REFERENCES farms(farm_id) ON DELETE CASCADE,
        orcid_id VARCHAR(50),
        institution VARCHAR(255),
        department VARCHAR(255),
        role_title VARCHAR(100),
        affiliation_type VARCHAR(50) CHECK (affiliation_type IN ('pi','postdoc','grad_student','ra','external_collaborator','technician')),
        bio TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_researcher_profiles_farm ON researcher_profiles(farm_id);
      CREATE INDEX IF NOT EXISTS idx_researcher_profiles_user ON researcher_profiles(user_id);
      CREATE INDEX IF NOT EXISTS idx_researcher_profiles_orcid ON researcher_profiles(orcid_id);

      CREATE TABLE IF NOT EXISTS citation_records (
        id SERIAL PRIMARY KEY,
        study_id INTEGER REFERENCES studies(id) ON DELETE SET NULL,
        dataset_id INTEGER REFERENCES research_datasets(id) ON DELETE SET NULL,
        farm_id VARCHAR(255) NOT NULL REFERENCES farms(farm_id) ON DELETE CASCADE,
        citation_type VARCHAR(50) NOT NULL CHECK (citation_type IN ('dataset','protocol','report','publication')),
        title VARCHAR(500) NOT NULL,
        authors JSONB DEFAULT '[]',
        doi VARCHAR(255),
        repository VARCHAR(255),
        version VARCHAR(50),
        published_at TIMESTAMPTZ,
        metadata_schema VARCHAR(50) DEFAULT 'datacite' CHECK (metadata_schema IN ('datacite','dublin_core','custom')),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_citation_records_study ON citation_records(study_id);
      CREATE INDEX IF NOT EXISTS idx_citation_records_farm ON citation_records(farm_id);

      CREATE TABLE IF NOT EXISTS project_closeouts (
        id SERIAL PRIMARY KEY,
        study_id INTEGER NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
        checklist JSONB DEFAULT '{}',
        status VARCHAR(50) DEFAULT 'in_progress' CHECK (status IN ('in_progress','complete')),
        completed_by UUID REFERENCES farm_users(id),
        completed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_project_closeouts_study ON project_closeouts(study_id);
    `);
    logger.info('Research compliance and budgeting tables ready (migration 045)');
  } catch (err) {
    logger.warn('Migration 045 warning:', err.message);
  }

  // ─── Migration 046: Electronic Lab Notebook ───
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS eln_notebooks (
        id SERIAL PRIMARY KEY,
        study_id INTEGER REFERENCES studies(id) ON DELETE SET NULL,
        farm_id VARCHAR(255) NOT NULL REFERENCES farms(farm_id) ON DELETE CASCADE,
        title VARCHAR(500) NOT NULL,
        owner_id UUID REFERENCES farm_users(id),
        status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active','locked','archived')),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_eln_notebooks_farm ON eln_notebooks(farm_id);
      CREATE INDEX IF NOT EXISTS idx_eln_notebooks_study ON eln_notebooks(study_id);

      CREATE TABLE IF NOT EXISTS eln_templates (
        id SERIAL PRIMARY KEY,
        farm_id VARCHAR(255) NOT NULL REFERENCES farms(farm_id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        fields JSONB DEFAULT '[]',
        created_by UUID REFERENCES farm_users(id),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_eln_templates_farm ON eln_templates(farm_id);

      CREATE TABLE IF NOT EXISTS eln_entries (
        id SERIAL PRIMARY KEY,
        notebook_id INTEGER NOT NULL REFERENCES eln_notebooks(id) ON DELETE CASCADE,
        entry_type VARCHAR(50) DEFAULT 'note' CHECK (entry_type IN ('observation','note','protocol_note','milestone','deviation','measurement')),
        content JSONB DEFAULT '{}',
        template_id INTEGER REFERENCES eln_templates(id),
        created_by UUID REFERENCES farm_users(id),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        locked_at TIMESTAMPTZ,
        locked_by UUID REFERENCES farm_users(id)
      );

      CREATE INDEX IF NOT EXISTS idx_eln_entries_notebook ON eln_entries(notebook_id);
      CREATE INDEX IF NOT EXISTS idx_eln_entries_type ON eln_entries(entry_type);
      CREATE INDEX IF NOT EXISTS idx_eln_entries_created ON eln_entries(created_at);

      CREATE TABLE IF NOT EXISTS eln_attachments (
        id SERIAL PRIMARY KEY,
        entry_id INTEGER NOT NULL REFERENCES eln_entries(id) ON DELETE CASCADE,
        file_name VARCHAR(500) NOT NULL,
        file_type VARCHAR(50) CHECK (file_type IN ('image','pdf','spreadsheet','instrument_export','csv','other')),
        s3_key VARCHAR(1000),
        file_size BIGINT,
        checksum VARCHAR(128),
        uploaded_by UUID REFERENCES farm_users(id),
        uploaded_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_eln_attachments_entry ON eln_attachments(entry_id);

      CREATE TABLE IF NOT EXISTS eln_links (
        id SERIAL PRIMARY KEY,
        entry_id INTEGER NOT NULL REFERENCES eln_entries(id) ON DELETE CASCADE,
        linked_entity_type VARCHAR(50) NOT NULL CHECK (linked_entity_type IN ('study','room','device','dataset','trial','observation','treatment_group')),
        linked_entity_id VARCHAR(255) NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_eln_links_entry ON eln_links(entry_id);

      CREATE TABLE IF NOT EXISTS eln_signatures (
        id SERIAL PRIMARY KEY,
        entry_id INTEGER NOT NULL REFERENCES eln_entries(id) ON DELETE CASCADE,
        signer_id UUID NOT NULL REFERENCES farm_users(id),
        signature_type VARCHAR(50) NOT NULL CHECK (signature_type IN ('author','witness','pi_approval')),
        signed_at TIMESTAMPTZ DEFAULT NOW(),
        signature_hash VARCHAR(128)
      );

      CREATE INDEX IF NOT EXISTS idx_eln_signatures_entry ON eln_signatures(entry_id);

      CREATE TABLE IF NOT EXISTS eln_snapshots (
        id SERIAL PRIMARY KEY,
        entry_id INTEGER NOT NULL REFERENCES eln_entries(id) ON DELETE CASCADE,
        snapshot_content JSONB NOT NULL,
        snapshot_hash VARCHAR(128),
        milestone_id INTEGER REFERENCES trial_milestones(id),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_eln_snapshots_entry ON eln_snapshots(entry_id);
    `);
    logger.info('Electronic lab notebook tables ready (migration 046)');
  } catch (err) {
    logger.warn('Migration 046 warning:', err.message);
  }

  // ─── Migration 047: Research Collaboration & Access Control ───
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS study_collaborators (
        id SERIAL PRIMARY KEY,
        study_id INTEGER NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
        user_id UUID REFERENCES farm_users(id),
        email VARCHAR(255),
        role VARCHAR(50) NOT NULL CHECK (role IN ('pi','postdoc','grad_student','ra','external_collaborator','reviewer')),
        permissions JSONB DEFAULT '{"read":true,"write":false,"export":false,"approve":false}',
        invited_by UUID REFERENCES farm_users(id),
        accepted_at TIMESTAMPTZ,
        expires_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_study_collaborators_study ON study_collaborators(study_id);
      CREATE INDEX IF NOT EXISTS idx_study_collaborators_user ON study_collaborators(user_id);

      CREATE TABLE IF NOT EXISTS review_comments (
        id SERIAL PRIMARY KEY,
        study_id INTEGER NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
        entity_type VARCHAR(50) NOT NULL CHECK (entity_type IN ('dataset','entry','protocol','observation','export')),
        entity_id INTEGER NOT NULL,
        comment_text TEXT NOT NULL,
        commenter_id UUID REFERENCES farm_users(id),
        status VARCHAR(50) DEFAULT 'open' CHECK (status IN ('open','resolved')),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        resolved_at TIMESTAMPTZ
      );

      CREATE INDEX IF NOT EXISTS idx_review_comments_study ON review_comments(study_id);
      CREATE INDEX IF NOT EXISTS idx_review_comments_entity ON review_comments(entity_type, entity_id);

      CREATE TABLE IF NOT EXISTS share_links (
        id SERIAL PRIMARY KEY,
        study_id INTEGER NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
        created_by UUID REFERENCES farm_users(id),
        scope VARCHAR(50) NOT NULL CHECK (scope IN ('dataset','notebook','report','protocol')),
        entity_id INTEGER NOT NULL,
        access_level VARCHAR(50) DEFAULT 'read_only' CHECK (access_level IN ('read_only','download')),
        token_hash VARCHAR(128) NOT NULL,
        expires_at TIMESTAMPTZ,
        download_count INTEGER DEFAULT 0,
        max_downloads INTEGER,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_share_links_token ON share_links(token_hash);
      CREATE INDEX IF NOT EXISTS idx_share_links_study ON share_links(study_id);

      CREATE TABLE IF NOT EXISTS onboarding_checklists (
        id SERIAL PRIMARY KEY,
        user_id UUID REFERENCES farm_users(id),
        study_id INTEGER REFERENCES studies(id) ON DELETE CASCADE,
        farm_id VARCHAR(255) NOT NULL REFERENCES farms(farm_id) ON DELETE CASCADE,
        role VARCHAR(50) NOT NULL,
        checklist JSONB DEFAULT '[]',
        progress_pct INTEGER DEFAULT 0,
        completed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_onboarding_checklists_farm ON onboarding_checklists(farm_id);
      CREATE INDEX IF NOT EXISTS idx_onboarding_checklists_user ON onboarding_checklists(user_id);
    `);
    logger.info('Research collaboration tables ready (migration 047)');
  } catch (err) {
    logger.warn('Migration 047 warning:', err.message);
  }

    logger.info('Database migrations completed');
}

/**
 * Get database pool instance
 */
export function getDatabase() {
  if (!pool) {
    throw new Error('Database not initialized');
  }
  return pool;
}

/**
 * Check if database is available
 */
export function isDatabaseAvailable() {
  return pool !== null;
}

const ACCOUNTING_REQUIRED_TABLES = [
  'accounting_sources',
  'accounting_accounts',
  'accounting_transactions',
  'accounting_entries',
  'accounting_classifications',
  'accounting_period_closes',
  'valuation_snapshots'
];

export async function getAccountingReadiness() {
  if (!pool) {
    return {
      ready: false,
      reason: 'database_unavailable',
      required_tables: ACCOUNTING_REQUIRED_TABLES,
      missing_tables: ACCOUNTING_REQUIRED_TABLES,
      chart_of_accounts_seeded: false,
      account_count: 0
    };
  }

  const tableResult = await query(
    `SELECT table_name
       FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ANY($1::text[])`,
    [ACCOUNTING_REQUIRED_TABLES]
  );

  const present = new Set(tableResult.rows.map((row) => row.table_name));
  const missing = ACCOUNTING_REQUIRED_TABLES.filter((name) => !present.has(name));

  let accountCount = 0;
  if (present.has('accounting_accounts')) {
    const accountResult = await query('SELECT COUNT(*)::int AS count FROM accounting_accounts');
    accountCount = Number(accountResult.rows[0]?.count || 0);
  }

  return {
    ready: missing.length === 0,
    required_tables: ACCOUNTING_REQUIRED_TABLES,
    missing_tables: missing,
    chart_of_accounts_seeded: accountCount > 0,
    account_count: accountCount
  };
}

/**
 * Execute a query with automatic connection management
 */
export async function query(text, params = [], options = {}) {
  if (!pool) {
    throw new Error('Database not available');
  }

  const { farmId = null, isAdmin = false, skipTenantContext = false } = options;
  const client = await pool.connect();

  try {
    if (!skipTenantContext) {
      await client.query(
        "SELECT set_config('app.current_farm_id', $1, false)",
        [farmId ? String(farmId) : '']
      );
      await client.query(
        "SELECT set_config('app.is_admin', $1, false)",
        [isAdmin ? 'true' : 'false']
      );
    }

    const result = await client.query(text, params);
    return result;
  } finally {
    try {
      if (!skipTenantContext) {
        await client.query("RESET app.current_farm_id");
        await client.query("RESET app.is_admin");
      }
    } catch (_) {
      // Do not mask original query error with reset error
    }
    client.release();
  }
}

/**
 * Close database connection
 */
export async function closeDatabase() {
  if (pool) {
    await pool.end();
    pool = null;
    logger.info('Database connection closed');
  }
}
