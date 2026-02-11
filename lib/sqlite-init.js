/**
 * SQLite Database Initialization for Farm Servers
 * Creates all necessary tables for Light Engine operation
 */

import sqlite3 from 'sqlite3';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Initialize SQLite database for farm servers
 * Creates tables if they don't exist
 */
export async function initSQLiteDatabase() {
  const dataDir = path.join(process.cwd(), 'data');
  
  // Ensure data directory exists
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
    console.log('[SQLite] Created data directory');
  }
  
  const dbPath = path.join(dataDir, 'lightengine.db');
  console.log('[SQLite] Initializing database at:', dbPath);
  
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, async (err) => {
      if (err) {
        console.error('[SQLite] Failed to open database:', err);
        reject(err);
        return;
      }
      
      try {
        console.log('[SQLite] Database opened successfully');
        await createTables(db);
        console.log('[SQLite] ✅ Database initialized with all tables');
        resolve(db);
      } catch (error) {
        console.error('[SQLite] Failed to create tables:', error);
        reject(error);
      }
    });
  });
}

/**
 * Create all required tables
 */
async function createTables(db) {
  const run = promisify(db.run.bind(db));
  
  // Sensors table
  await run(`
    CREATE TABLE IF NOT EXISTS sensors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sensor_id TEXT UNIQUE NOT NULL,
      sensor_name TEXT NOT NULL,
      sensor_type TEXT NOT NULL,
      zone_id TEXT,
      room_id TEXT,
      mac_address TEXT,
      ip_address TEXT,
      status TEXT DEFAULT 'offline',
      last_reading REAL,
      last_temp REAL,
      last_humidity REAL,
      last_co2 INTEGER,
      last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log('[SQLite] ✓ Created sensors table');
  
  // Zones table
  await run(`
    CREATE TABLE IF NOT EXISTS zones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      zone_id TEXT UNIQUE NOT NULL,
      zone_name TEXT NOT NULL,
      room_id TEXT,
      temp_c REAL,
      temp_target REAL,
      humidity REAL,
      humidity_target REAL,
      co2_ppm INTEGER,
      vpd_kpa REAL,
      ppfd REAL,
      status TEXT DEFAULT 'active',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log('[SQLite] ✓ Created zones table');
  
  // Rooms table
  await run(`
    CREATE TABLE IF NOT EXISTS rooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id TEXT UNIQUE NOT NULL,
      room_name TEXT NOT NULL,
      floor INTEGER DEFAULT 1,
      zone_count INTEGER DEFAULT 0,
      device_count INTEGER DEFAULT 0,
      temp_c REAL,
      humidity REAL,
      co2_ppm INTEGER,
      status TEXT DEFAULT 'active',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log('[SQLite] ✓ Created rooms table');
  
  // Devices table (lights, controllers, etc.)
  await run(`
    CREATE TABLE IF NOT EXISTS devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT UNIQUE NOT NULL,
      device_name TEXT NOT NULL,
      device_type TEXT NOT NULL,
      zone_id TEXT,
      room_id TEXT,
      vendor TEXT,
      model TEXT,
      serial_number TEXT,
      mac_address TEXT,
      ip_address TEXT,
      port INTEGER,
      protocol TEXT,
      status TEXT DEFAULT 'offline',
      power_state TEXT DEFAULT 'off',
      brightness INTEGER,
      last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log('[SQLite] ✓ Created devices table');
  
  // Trays table
  await run(`
    CREATE TABLE IF NOT EXISTS trays (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tray_id TEXT UNIQUE NOT NULL,
      tray_name TEXT,
      zone_id TEXT,
      room_id TEXT,
      crop_type TEXT,
      variety TEXT,
      plant_count INTEGER DEFAULT 0,
      planted_date DATE,
      harvest_date DATE,
      days_to_harvest INTEGER,
      recipe_id TEXT,
      status TEXT DEFAULT 'active',
      qr_code TEXT,
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log('[SQLite] ✓ Created trays table');
  
  // Sensor readings table (time series data)
  await run(`
    CREATE TABLE IF NOT EXISTS sensor_readings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sensor_id TEXT NOT NULL,
      zone_id TEXT,
      temp_c REAL,
      humidity REAL,
      co2_ppm INTEGER,
      vpd_kpa REAL,
      ppfd REAL,
      timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (sensor_id) REFERENCES sensors(sensor_id)
    )
  `);
  console.log('[SQLite] ✓ Created sensor_readings table');
  
  // Create index for faster queries
  await run(`
    CREATE INDEX IF NOT EXISTS idx_sensor_readings_timestamp 
    ON sensor_readings(timestamp DESC)
  `);
  
  await run(`
    CREATE INDEX IF NOT EXISTS idx_sensor_readings_sensor 
    ON sensor_readings(sensor_id, timestamp DESC)
  `);
  console.log('[SQLite] ✓ Created sensor_readings indexes');
  
  // Farm settings table
  await run(`
    CREATE TABLE IF NOT EXISTS farm_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT UNIQUE NOT NULL,
      value TEXT,
      category TEXT,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log('[SQLite] ✓ Created farm_settings table');
  
  // Alerts table
  await run(`
    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      alert_type TEXT NOT NULL,
      severity TEXT DEFAULT 'info',
      zone_id TEXT,
      device_id TEXT,
      sensor_id TEXT,
      message TEXT NOT NULL,
      details TEXT,
      acknowledged BOOLEAN DEFAULT 0,
      resolved BOOLEAN DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      acknowledged_at TIMESTAMP,
      resolved_at TIMESTAMP
    )
  `);
  console.log('[SQLite] ✓ Created alerts table');
  
  // Automation rules table
  await run(`
    CREATE TABLE IF NOT EXISTS automation_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rule_name TEXT NOT NULL,
      zone_id TEXT,
      enabled BOOLEAN DEFAULT 1,
      trigger_type TEXT NOT NULL,
      trigger_conditions TEXT,
      actions TEXT,
      schedule TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log('[SQLite] ✓ Created automation_rules table');
  
  // Insert default farm settings if not exist
  await run(`
    INSERT OR IGNORE INTO farm_settings (key, value, category)
    VALUES 
      ('farm_initialized', 'true', 'system'),
      ('database_version', '1.0.0', 'system')
  `);
  console.log('[SQLite] ✓ Inserted default settings');
}

/**
 * Get database handle with promisified methods
 */
export function getDatabaseHandle(db) {
  return {
    db,
    run: promisify(db.run.bind(db)),
    get: promisify(db.get.bind(db)),
    all: promisify(db.all.bind(db)),
    close: promisify(db.close.bind(db))
  };
}

/**
 * Check if database is initialized
 */
export async function isDatabaseInitialized() {
  const dataDir = path.join(process.cwd(), 'data');
  const dbPath = path.join(dataDir, 'lightengine.db');
  
  if (!fs.existsSync(dbPath)) {
    return false;
  }
  
  const stats = fs.statSync(dbPath);
  return stats.size > 0;
}

export default {
  initSQLiteDatabase,
  getDatabaseHandle,
  isDatabaseInitialized
};
