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
import { initSQLiteDatabase, getDatabaseHandle, isDatabaseInitialized } from './sqlite-init.js';

dotenv.config();

// Check if database is enabled
const DB_ENABLED = String(process.env.DB_ENABLED || 'false').toLowerCase() === 'true';
const EDGE_MODE = String(process.env.EDGE_MODE || 'false').toLowerCase() === 'true';

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
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
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
  // Farm server mode: Use SQLite
  if (!DB_ENABLED && EDGE_MODE) {
    console.log('[Database] Farm server mode detected - initializing SQLite');
    
    try {
      const initialized = await isDatabaseInitialized();
      if (!initialized) {
        console.log('[Database] Database not initialized, creating tables...');
      }
      
      const db = await initSQLiteDatabase();
      const dbHandle = getDatabaseHandle(db);
      
      return { 
        mode: 'sqlite', 
        enabled: true, 
        sqlite: db,
        ...dbHandle
      };
    } catch (error) {
      console.error('[Database] ❌ SQLite initialization failed:', error.message);
      console.log('[Database] Falling back to NeDB mode');
      return { mode: 'nedb', enabled: false };
    }
  }
  
  // Cloud mode without database: Use NeDB
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
      farm_slug VARCHAR(100) UNIQUE,
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
    
    // QA Checkpoints table (Quality Control)
    `CREATE TABLE IF NOT EXISTS qa_checkpoints (
      id SERIAL PRIMARY KEY,
      batch_id VARCHAR(255) NOT NULL,
      checkpoint_type VARCHAR(50) NOT NULL,
      inspector VARCHAR(255) NOT NULL,
      result VARCHAR(50) NOT NULL,
      notes TEXT,
      photo_data TEXT,
      metrics JSONB,
      corrective_action TEXT,
      farm_id VARCHAR(255),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    
    // QA Standards table
    `CREATE TABLE IF NOT EXISTS qa_standards (
      id SERIAL PRIMARY KEY,
      checkpoint_type VARCHAR(50) NOT NULL UNIQUE,
      crop_type VARCHAR(100) DEFAULT 'all',
      criteria JSONB NOT NULL,
      pass_threshold VARCHAR(255),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    
    // QA Photos table (for future S3 migration)
    `CREATE TABLE IF NOT EXISTS qa_photos (
      id SERIAL PRIMARY KEY,
      checkpoint_id INTEGER REFERENCES qa_checkpoints(id) ON DELETE CASCADE,
      photo_data TEXT NOT NULL,
      photo_url VARCHAR(500),
      file_size INTEGER,
      mime_type VARCHAR(50) DEFAULT 'image/jpeg',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    
    // Farm metadata table for dashboard analytics
    `CREATE TABLE IF NOT EXISTS farm_metadata (
      farm_id VARCHAR(100) PRIMARY KEY REFERENCES farms(farm_id) ON DELETE CASCADE,
      metadata JSONB DEFAULT '{}',
      room_count INTEGER DEFAULT 0,
      zone_count INTEGER DEFAULT 0,
      device_count INTEGER DEFAULT 0,
      tray_count INTEGER DEFAULT 0,
      plant_count INTEGER DEFAULT 0,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    
    // Admin users table for central admin authentication
    `CREATE TABLE IF NOT EXISTS admin_users (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      first_name VARCHAR(100),
      last_name VARCHAR(100),
      permissions JSONB DEFAULT '{"role":"viewer","scopes":[]}',
      status VARCHAR(50) DEFAULT 'active',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_login TIMESTAMP
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
    `CREATE INDEX IF NOT EXISTS idx_api_keys_key ON farm_api_keys(api_key)`,
    `CREATE INDEX IF NOT EXISTS idx_admin_users_email ON admin_users(email)`,
    
    // QA indexes
    `CREATE INDEX IF NOT EXISTS idx_qa_checkpoints_batch_id ON qa_checkpoints(batch_id)`,
    `CREATE INDEX IF NOT EXISTS idx_qa_checkpoints_checkpoint_type ON qa_checkpoints(checkpoint_type)`,
    `CREATE INDEX IF NOT EXISTS idx_qa_checkpoints_result ON qa_checkpoints(result)`,
    `CREATE INDEX IF NOT EXISTS idx_qa_checkpoints_farm_id ON qa_checkpoints(farm_id)`,
    `CREATE INDEX IF NOT EXISTS idx_qa_checkpoints_created_at ON qa_checkpoints(created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_qa_photos_checkpoint_id ON qa_photos(checkpoint_id)`,
    
    // Farm location columns for public discovery (migration)
    `ALTER TABLE farms ADD COLUMN IF NOT EXISTS address_line1 VARCHAR(255)`,
    `ALTER TABLE farms ADD COLUMN IF NOT EXISTS address_city VARCHAR(100)`,
    `ALTER TABLE farms ADD COLUMN IF NOT EXISTS address_province VARCHAR(50)`,
    `ALTER TABLE farms ADD COLUMN IF NOT EXISTS postal_code VARCHAR(20)`,
    `ALTER TABLE farms ADD COLUMN IF NOT EXISTS latitude DECIMAL(10, 8)`,
    `ALTER TABLE farms ADD COLUMN IF NOT EXISTS longitude DECIMAL(11, 8)`,
    `ALTER TABLE farms ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT false`,
    `ALTER TABLE farms ADD COLUMN IF NOT EXISTS delivery_radius_km INTEGER DEFAULT 50`,
    `ALTER TABLE farms ADD COLUMN IF NOT EXISTS description TEXT`,
    `ALTER TABLE farms ADD COLUMN IF NOT EXISTS logo_url TEXT`,
    `ALTER TABLE farms ADD COLUMN IF NOT EXISTS store_enabled BOOLEAN DEFAULT false`,
    
    // Index for geolocation search
    `CREATE INDEX IF NOT EXISTS idx_farms_public ON farms(is_public) WHERE is_public = true`,
    `CREATE INDEX IF NOT EXISTS idx_farms_location ON farms(latitude, longitude) WHERE latitude IS NOT NULL`
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
  
  // Initialize QA standards data
  await initializeQAStandards();
}

/**
 * Initialize QA Standards with default criteria
 * Idempotent - uses INSERT ... ON CONFLICT DO NOTHING
 */
async function initializeQAStandards() {
  const standards = [
    {
      type: 'seeding',
      criteria: ['Seeds placed correctly in medium', 'Proper spacing maintained', 'Medium moisture level adequate', 'No contamination visible', 'Tray labels applied correctly'],
      threshold: 'All criteria met'
    },
    {
      type: 'germination',
      criteria: ['Germination rate above 85%', 'Seedlings uniform in size', 'No mold or fungus present', 'Root development visible', 'Cotyledons fully opened'],
      threshold: 'Minimum 85% germination'
    },
    {
      type: 'transplant',
      criteria: ['Plants transferred without damage', 'Roots properly positioned', 'Proper depth in growing medium', 'No wilting observed', 'Spacing meets specifications'],
      threshold: 'Less than 5% damage'
    },
    {
      type: 'growth_midpoint',
      criteria: ['Growth rate on target', 'Color and vigor good', 'No pest damage visible', 'No nutrient deficiency signs', 'Proper size for stage'],
      threshold: 'No major issues'
    },
    {
      type: 'pre_harvest',
      criteria: ['Size meets harvest specifications', 'Color appropriate for variety', 'No pest damage or disease', 'Firmness and texture correct', 'Ready for harvest timing'],
      threshold: 'Meets all harvest criteria'
    },
    {
      type: 'post_harvest',
      criteria: ['Harvest completed without damage', 'Proper handling maintained', 'Temperature controlled', 'No wilting or bruising', 'Trimming and cleaning adequate'],
      threshold: 'Less than 2% waste'
    },
    {
      type: 'packing',
      criteria: ['Proper packaging materials used', 'Weight meets specifications', 'Labeling correct and legible', 'No damaged product included', 'Temperature maintained'],
      threshold: 'All packing standards met'
    },
    {
      type: 'pre_shipment',
      criteria: ['Final visual inspection passed', 'Temperature logs verified', 'Documentation complete', 'Packaging integrity intact', 'Ready for customer delivery'],
      threshold: 'Ready to ship'
    }
  ];

  try {
    for (const std of standards) {
      await query(
        `INSERT INTO qa_standards (checkpoint_type, criteria, pass_threshold)
         VALUES ($1, $2, $3)
         ON CONFLICT (checkpoint_type) DO NOTHING`,
        [std.type, JSON.stringify(std.criteria), std.threshold]
      );
    }
    console.log('[Database] ✓ QA standards initialized');
  } catch (error) {
    console.error('[Database] Error initializing QA standards:', error.message);
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
  if (!DB_ENABLED && EDGE_MODE) {
    return 'sqlite';
  }
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
