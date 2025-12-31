/**
 * Light Engine: PostgreSQL Database Connection
 * Production-ready database connection with pooling and error handling
 * 
 * Environment Variables:
 * - DB_HOST: Database host (default: localhost)
 * - DB_PORT: Database port (default: 5432)
 * - DB_NAME: Database name (default: light_engine)
 * - DB_USER: Database user (default: postgres)
 * - DB_PASSWORD: Database password
 * - DB_POOL_MAX: Max pool connections (default: 20)
 * - DB_ENABLED: Enable PostgreSQL (default: false, uses NeDB if false)
 */

import pg from 'pg';
const { Pool } = pg;
import dotenv from 'dotenv';

dotenv.config();

// Check if database is enabled
const DB_ENABLED = String(process.env.DB_ENABLED || 'false').toLowerCase() === 'true';

// PostgreSQL connection pool
let pool = null;

if (DB_ENABLED) {
  pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME || 'light_engine',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    max: parseInt(process.env.DB_POOL_MAX) || 20,
    idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT) || 30000,
    connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT) || 2000,
  });

  // Handle pool errors
  pool.on('error', (err) => {
    console.error('[Database] Unexpected pool error:', err);
  });
}

/**
 * Initialize database connection
 * Test connectivity and create tables if needed
 */
export async function initDatabase() {
  if (!DB_ENABLED) {
    console.log('[Database] PostgreSQL disabled - using NeDB (in-memory/file)');
    return { mode: 'nedb', enabled: false };
  }

  try {
    const client = await pool.connect();
    const result = await client.query('SELECT NOW() as now, version() as version');
    
    console.log('[Database] ✅ PostgreSQL connection successful');
    console.log(`[Database] Timestamp: ${result.rows[0].now}`);
    console.log(`[Database] Version: ${result.rows[0].version.split(' ').slice(0, 2).join(' ')}`);
    
    client.release();
    
    // Create tables if they don't exist
    await createTables();
    
    return { mode: 'postgresql', enabled: true, pool };
  } catch (error) {
    console.error('[Database] ❌ PostgreSQL connection failed:', error.message);
    console.error('[Database] Falling back to NeDB mode');
    throw error;
  }
}

/**
 * Create database tables for Light Engine
 * Idempotent - safe to run multiple times
 */
async function createTables() {
  const tables = [
    // Farms table
    `CREATE TABLE IF NOT EXISTS farms (
      farm_id VARCHAR(100) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255) NOT NULL,
      phone VARCHAR(50),
      contact_name VARCHAR(255),
      plan_type VARCHAR(50) DEFAULT 'cloud',
      api_key VARCHAR(255) UNIQUE,
      api_secret VARCHAR(255),
      jwt_secret VARCHAR(255),
      square_payment_id VARCHAR(255),
      square_amount BIGINT,
      status VARCHAR(50) DEFAULT 'active',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`,
    
    // Users table
    `CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      farm_id VARCHAR(100) REFERENCES farms(farm_id) ON DELETE CASCADE,
      email VARCHAR(255) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      name VARCHAR(255),
      role VARCHAR(50) DEFAULT 'user',
      is_active BOOLEAN DEFAULT true,
      email_verified BOOLEAN DEFAULT false,
      must_change_password BOOLEAN DEFAULT false,
      last_login TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`,
    
    // Farm inventory table
    `CREATE TABLE IF NOT EXISTS farm_inventory (
      id SERIAL PRIMARY KEY,
      farm_id VARCHAR(100) NOT NULL,
      sku_id VARCHAR(100) NOT NULL,
      sku_name VARCHAR(255) NOT NULL,
      quantity_available INTEGER NOT NULL DEFAULT 0,
      quantity_reserved INTEGER NOT NULL DEFAULT 0,
      quantity_deducted INTEGER NOT NULL DEFAULT 0,
      unit VARCHAR(50),
      pack_size INTEGER,
      price_per_unit DECIMAL(10, 2),
      harvest_date_start DATE,
      harvest_date_end DATE,
      location VARCHAR(255),
      quality_flags JSONB DEFAULT '[]',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(farm_id, sku_id)
    )`,
    
    // Wholesale reservations table
    `CREATE TABLE IF NOT EXISTS wholesale_reservations (
      id SERIAL PRIMARY KEY,
      order_id VARCHAR(100) NOT NULL UNIQUE,
      farm_id VARCHAR(100) NOT NULL,
      items JSONB NOT NULL,
      status VARCHAR(50) DEFAULT 'active',
      ttl_minutes INTEGER DEFAULT 30,
      reserved_at TIMESTAMP DEFAULT NOW(),
      expires_at TIMESTAMP NOT NULL,
      confirmed_at TIMESTAMP,
      released_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`,
    
    // Wholesale deductions table (confirmed orders)
    `CREATE TABLE IF NOT EXISTS wholesale_deductions (
      id SERIAL PRIMARY KEY,
      order_id VARCHAR(100) NOT NULL,
      farm_id VARCHAR(100) NOT NULL,
      sku_id VARCHAR(100) NOT NULL,
      quantity INTEGER NOT NULL,
      payment_id VARCHAR(255),
      status VARCHAR(50) DEFAULT 'confirmed',
      reason TEXT,
      deducted_at TIMESTAMP DEFAULT NOW(),
      rolled_back_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`,
    
    // Farm API keys table
    `CREATE TABLE IF NOT EXISTS farm_api_keys (
      farm_id VARCHAR(100) PRIMARY KEY,
      api_key VARCHAR(255) NOT NULL UNIQUE,
      farm_name VARCHAR(255) NOT NULL,
      status VARCHAR(50) DEFAULT 'active',
      created_at TIMESTAMP DEFAULT NOW(),
      last_rotated TIMESTAMP DEFAULT NOW(),
      last_used TIMESTAMP
    )`,
    
    // Indexes for performance
    `CREATE INDEX IF NOT EXISTS idx_inventory_farm_sku ON farm_inventory(farm_id, sku_id)`,
    `CREATE INDEX IF NOT EXISTS idx_inventory_updated ON farm_inventory(updated_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_reservations_order ON wholesale_reservations(order_id)`,
    `CREATE INDEX IF NOT EXISTS idx_reservations_expires ON wholesale_reservations(expires_at)`,
    `CREATE INDEX IF NOT EXISTS idx_reservations_status ON wholesale_reservations(status)`,
    `CREATE INDEX IF NOT EXISTS idx_deductions_order ON wholesale_deductions(order_id)`,
    `CREATE INDEX IF NOT EXISTS idx_deductions_farm_sku ON wholesale_deductions(farm_id, sku_id)`,
    `CREATE INDEX IF NOT EXISTS idx_deductions_status ON wholesale_deductions(status)`,
    `CREATE INDEX IF NOT EXISTS idx_api_keys_key ON farm_api_keys(api_key)`
  ];

  for (const sql of tables) {
    try {
      await query(sql);
      const tableName = sql.match(/TABLE.*?(\w+)/)?.[1];
      console.log(`[Database] ✓ Table ready: ${tableName}`);
    } catch (error) {
      console.error(`[Database] Error creating table:`, error.message);
      throw error;
    }
  }
}

/**
 * Execute SQL query with error handling and logging
 * 
 * @param {string} text - SQL query
 * @param {Array} params - Query parameters
 * @returns {Promise<Object>} Query result
 */
export async function query(text, params = []) {
  if (!DB_ENABLED || !pool) {
    throw new Error('Database not enabled. Set DB_ENABLED=true in environment.');
  }

  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    
    if (duration > 1000) {
      console.warn(`[Database] Slow query (${duration}ms):`, text.substring(0, 100));
    }
    
    return result;
  } catch (error) {
    console.error('[Database] Query error:', {
      query: text.substring(0, 150),
      error: error.message,
      code: error.code
    });
    throw error;
  }
}

/**
 * Get a client from the pool for transactions
 * Remember to call client.release() when done!
 * 
 * @returns {Promise<Object>} Database client
 */
export async function getClient() {
  if (!DB_ENABLED || !pool) {
    throw new Error('Database not enabled. Set DB_ENABLED=true in environment.');
  }

  const client = await pool.connect();
  const originalQuery = client.query;
  const originalRelease = client.release;
  
  // Set a timeout warning for long-held clients
  const timeout = setTimeout(() => {
    console.warn('[Database] ⚠️  Client held for >5s - possible connection leak');
  }, 5000);
  
  // Override release to clear timeout
  client.release = () => {
    clearTimeout(timeout);
    client.query = originalQuery;
    client.release = originalRelease;
    return originalRelease.apply(client);
  };
  
  return client;
}

/**
 * Execute function within a transaction
 * Automatically handles BEGIN, COMMIT, and ROLLBACK
 * 
 * @param {Function} callback - Async function that receives client
 * @returns {Promise<any>} Result of callback
 */
export async function transaction(callback) {
  const client = await getClient();
  
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Check database health
 * Used by /health endpoint
 */
export async function checkHealth() {
  if (!DB_ENABLED || !pool) {
    return {
      enabled: false,
      connected: false,
      mode: 'nedb'
    };
  }

  const start = Date.now();
  try {
    const result = await pool.query('SELECT 1 as health_check');
    const latency = Date.now() - start;
    
    return {
      enabled: true,
      connected: true,
      latencyMs: latency,
      mode: 'postgresql',
      poolTotal: pool.totalCount,
      poolIdle: pool.idleCount,
      poolWaiting: pool.waitingCount
    };
  } catch (error) {
    return {
      enabled: true,
      connected: false,
      error: error.message,
      mode: 'postgresql'
    };
  }
}

/**
 * Close database pool
 * Call during graceful shutdown
 */
export async function closeDatabase() {
  if (pool) {
    await pool.end();
    console.log('[Database] Connection pool closed');
  }
}

/**
 * Get database mode
 */
export function getDatabaseMode() {
  return DB_ENABLED ? 'postgresql' : 'nedb';
}

/**
 * Check if PostgreSQL is enabled
 */
export function isDatabaseEnabled() {
  return DB_ENABLED;
}

export default {
  initDatabase,
  query,
  getClient,
  transaction,
  checkHealth,
  closeDatabase,
  getDatabaseMode,
  isDatabaseEnabled
};
