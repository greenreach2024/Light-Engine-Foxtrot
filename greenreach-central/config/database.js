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
 */
export async function initDatabase() {
  if (pool) {
    logger.info('Database already initialized');
    return;
  }

  const dbConfig = {
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

  logger.info(`Connecting to PostgreSQL at ${dbConfig.host}:${dbConfig.port}/${dbConfig.database}`);
  
  pool = new Pool(dbConfig);

  // Test connection
  try {
    const client = await pool.connect();
    logger.info('Database connection established');
    
    // Run migrations
    await runMigrations(client);
    
    client.release();
  } catch (error) {
    logger.error('Database connection failed:', error);
    throw error;
  }

  // Handle pool errors
  pool.on('error', (err) => {
    logger.error('Unexpected database pool error:', err);
  });
}

/**
 * Run database migrations
 */
async function runMigrations(client) {
  logger.info('Running database migrations...');

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
