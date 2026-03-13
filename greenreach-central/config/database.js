/**
 * Database Configuration and Connection Management
 */

import pg from 'pg';
import logger from '../utils/logger.js';

const { Pool } = pg;

let pool = null;
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
      ssl: process.env.DB_SSL !== 'false' ? { rejectUnauthorized: false } : false,
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
      ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
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
    `);
    logger.info('farm_inventory compatibility migration completed');
  } catch (err) {
    logger.warn('farm_inventory compatibility migration warning:', err.message);
  }

  // Create wholesale_buyers table for wholesale admin + buyer auth
  await client.query(`
    CREATE TABLE IF NOT EXISTS wholesale_buyers (
      id SERIAL PRIMARY KEY,
      business_name VARCHAR(255) NOT NULL,
      contact_name VARCHAR(255),
      email VARCHAR(255) UNIQUE NOT NULL,
      buyer_type VARCHAR(50),
      location JSONB DEFAULT '{}',
      password_hash VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_wholesale_buyers_email ON wholesale_buyers(email);
    CREATE INDEX IF NOT EXISTS idx_wholesale_buyers_created ON wholesale_buyers(created_at);
  `);

  // Create wholesale_orders table for persisted wholesale orders
  await client.query(`
    CREATE TABLE IF NOT EXISTS wholesale_orders (
      id SERIAL PRIMARY KEY,
      master_order_id VARCHAR(64) UNIQUE NOT NULL,
      buyer_id VARCHAR(128) NOT NULL,
      buyer_email VARCHAR(255),
      status VARCHAR(50) DEFAULT 'confirmed',
      order_data JSONB NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_wholesale_orders_master ON wholesale_orders(master_order_id);
    CREATE INDEX IF NOT EXISTS idx_wholesale_orders_buyer ON wholesale_orders(buyer_id);
    CREATE INDEX IF NOT EXISTS idx_wholesale_orders_created ON wholesale_orders(created_at);
  `);

  // Create payment_records table for persistent payment storage
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

  // Canonical accounting ledger foundation
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

  // Seed minimal chart of accounts (pre-revenue baseline)
  await client.query(`
    INSERT INTO accounting_accounts (account_code, account_name, account_class, account_type)
    VALUES
      ('100000', 'Cash', 'asset', 'current_asset'),
      ('120000', 'Accounts Receivable', 'asset', 'current_asset'),
      ('200000', 'Accounts Payable', 'liability', 'current_liability'),
      ('300000', 'Owner Equity', 'equity', 'equity'),
      ('400000', 'Revenue', 'income', 'operating_income'),
      ('500000', 'Cost of Goods Sold', 'expense', 'cogs'),
      ('610000', 'Cloud Infrastructure', 'expense', 'operating_expense'),
      ('620000', 'Developer Tools', 'expense', 'operating_expense'),
      ('630000', 'Payment Processing Fees', 'expense', 'operating_expense'),
      ('710000', 'R&D Expense', 'expense', 'research_development')
    ON CONFLICT (account_code) DO NOTHING;
  `);

  // Create audit_log table for persistent audit trail
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
export async function query(text, params) {
  if (!pool) {
    throw new Error('Database not available');
  }
  const client = await pool.connect();
  try {
    const result = await client.query(text, params);
    return result;
  } finally {
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
