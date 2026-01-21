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

  pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME || 'greenreach_central',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD,
    max: parseInt(process.env.DB_POOL_MAX) || 20,
    idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT) || 30000,
    connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT) || 2000,
  });

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
      status VARCHAR(50) DEFAULT 'offline',
      last_heartbeat TIMESTAMP,
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
    
    CREATE INDEX IF NOT EXISTS idx_farms_farm_id ON farms(farm_id);
    CREATE INDEX IF NOT EXISTS idx_farms_status ON farms(status);
  `);

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
