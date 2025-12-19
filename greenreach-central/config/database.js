import pg from 'pg';
const { Pool } = pg;
import dotenv from 'dotenv';
import logger from '../utils/logger.js';

dotenv.config();

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'greenreach_central',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  max: parseInt(process.env.DB_POOL_MAX) || 20,
  idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT) || 30000,
  connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT) || 2000,
});

// Test database connection
export async function initDatabase() {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT NOW()');
    logger.info('Database connection test successful', {
      timestamp: result.rows[0].now
    });
    client.release();
    return true;
  } catch (error) {
    logger.error('Database connection failed', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

// Execute query with error handling
export async function query(text, params) {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    logger.debug('Query executed', {
      text: text.substring(0, 100),
      duration,
      rows: result.rowCount
    });
    return result;
  } catch (error) {
    logger.error('Query error', {
      text: text.substring(0, 100),
      error: error.message
    });
    throw error;
  }
}

// Get a client from the pool for transactions
export async function getClient() {
  const client = await pool.connect();
  const query = client.query;
  const release = client.release;
  
  // Set a timeout of 5 seconds after which the client will be released
  const timeout = setTimeout(() => {
    logger.error('Client checkout timeout', {
      message: 'A client has been checked out for more than 5 seconds!'
    });
  }, 5000);
  
  // Override release to clear the timeout
  client.release = () => {
    clearTimeout(timeout);
    client.query = query;
    client.release = release;
    return release.apply(client);
  };
  
  return client;
}

// Close pool (for graceful shutdown)
export async function closeDatabase() {
  await pool.end();
  logger.info('Database pool closed');
}

export default { initDatabase, query, getClient, closeDatabase };
