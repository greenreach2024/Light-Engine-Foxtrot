/**
 * Error Handler Middleware
 * Captures errors into app_errors table for F.A.Y.E. diagnostics.
 * Callers only see generic messages — internals stay server-side.
 */

import crypto from 'crypto';

let _query = null;
let _dbReady = false;

export function initErrorCapture(queryFn, isDbAvailable) {
  _query = queryFn;
  _dbReady = typeof isDbAvailable === 'function' ? isDbAvailable : () => true;
}

let _tableEnsured = false;
async function ensureTable() {
  if (_tableEnsured || !_query || !_dbReady()) return;
  try {
    await _query(`CREATE TABLE IF NOT EXISTS app_errors (
      id SERIAL PRIMARY KEY, method TEXT NOT NULL, route TEXT NOT NULL,
      status_code INTEGER NOT NULL DEFAULT 500, error_type TEXT,
      message TEXT NOT NULL, stack_hash TEXT,
      count INTEGER NOT NULL DEFAULT 1,
      first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      metadata JSONB DEFAULT '{}'
    )`);
    await _query('CREATE INDEX IF NOT EXISTS idx_app_errors_last_seen ON app_errors (last_seen DESC)');
    await _query('CREATE INDEX IF NOT EXISTS idx_app_errors_stack_hash ON app_errors (stack_hash)');
    _tableEnsured = true;
  } catch { _tableEnsured = false; }
}

function hashStack(stack) {
  if (!stack) return null;
  // Keep first 3 meaningful lines for grouping
  const lines = stack.split('\n').slice(0, 4).join('\n');
  return crypto.createHash('sha256').update(lines).digest('hex').slice(0, 16);
}

async function captureError(method, route, statusCode, err) {
  if (!_query || !_dbReady()) return;
  try {
    await ensureTable();
    const hash = hashStack(err.stack);
    const errType = err.name || err.constructor?.name || 'Error';
    const msg = (err.message || 'Unknown error').slice(0, 500);

    // Upsert: group by stack hash + route (bumps count + last_seen)
    if (hash) {
      const upsert = await _query(
        `UPDATE app_errors SET count = count + 1, last_seen = NOW(),
           status_code = $1, metadata = jsonb_set(COALESCE(metadata, '{}'), '{last_method}', to_jsonb($2::text))
         WHERE stack_hash = $3 AND route = $4
         RETURNING id`,
        [statusCode, method, hash, route]
      );
      if (upsert.rows.length > 0) return;
    }

    await _query(
      `INSERT INTO app_errors (method, route, status_code, error_type, message, stack_hash, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [method, route, statusCode, errType, msg, hash, JSON.stringify({ user_agent: 'server' })]
    );
  } catch { /* capture must never throw */ }
}

// Custom error classes
export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.statusCode = 400;
  }
}

export class NotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NotFoundError';
    this.statusCode = 404;
  }
}

export class UnauthorizedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UnauthorizedError';
    this.statusCode = 401;
  }
}

export function errorHandler(err, req, res, next) {
  const statusCode = err.statusCode || err.status || 500;
  const message = err.message || 'Something went wrong';

  // Log to CloudWatch (server-side only)
  console.error(`[ErrorHandler] ${req.method} ${req.path} -> ${statusCode}: ${message}`);
  if (statusCode >= 500) console.error('Stack:', err.stack);

  // Capture to app_errors table for F.A.Y.E. diagnostics
  captureError(req.method, req.path, statusCode, err);

  // Return sanitized response — never expose internals
  res.status(statusCode).json({
    error: statusCode >= 500 ? 'Internal Server Error' : message,
    requestId: Date.now().toString(),
    timestamp: new Date().toISOString()
  });
}

