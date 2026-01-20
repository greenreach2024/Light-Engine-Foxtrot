/**
 * Structured Logging Utility for Light Engine Foxtrot
 * 
 * Provides JSON-formatted logging with levels, context, and metadata
 * Compatible with CloudWatch Logs and other log aggregation services
 * 
 * Usage:
 *   const logger = require('./lib/logger');
 *   logger.info('server_started', { port: 8091, mode: 'production' });
 *   logger.error('database_connection_failed', { error: err.message }, err);
 */

const fs = require('fs');
const path = require('path');

// Log levels (numeric for comparison)
const LOG_LEVELS = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3
};

// Configuration
const config = {
  level: process.env.LOG_LEVEL || 'INFO',
  deviceId: process.env.DEVICE_ID || 'unknown',
  farmId: process.env.FARM_ID || 'unknown',
  console: process.env.LOG_CONSOLE !== 'false', // default true
  file: process.env.LOG_FILE || null, // optional file logging
  json: process.env.LOG_JSON !== 'false' // default true (JSON format)
};

// Get numeric level
function getNumericLevel(level) {
  return LOG_LEVELS[level.toUpperCase()] ?? LOG_LEVELS.INFO;
}

// Check if level is enabled
function isLevelEnabled(level) {
  return getNumericLevel(level) <= getNumericLevel(config.level);
}

// Format log entry
function formatLogEntry(level, event, context = {}, error = null) {
  const entry = {
    timestamp: new Date().toISOString(),
    level: level.toUpperCase(),
    event,
    device_id: config.deviceId,
    farm_id: config.farmId,
    pid: process.pid,
    ...context
  };

  // Add error details if provided
  if (error) {
    entry.error = {
      message: error.message,
      stack: error.stack,
      code: error.code
    };
  }

  return entry;
}

// Write log entry
function writeLog(level, event, context, error) {
  if (!isLevelEnabled(level)) {
    return;
  }

  const entry = formatLogEntry(level, event, context, error);

  // Console output
  if (config.console) {
    if (config.json) {
      console.log(JSON.stringify(entry));
    } else {
      // Human-readable format for development
      const timestamp = entry.timestamp.split('T')[1].split('.')[0];
      const contextStr = Object.keys(context).length > 0 
        ? ` | ${JSON.stringify(context)}`
        : '';
      const errorStr = error ? ` | ERROR: ${error.message}` : '';
      console.log(`[${timestamp}] ${level.toUpperCase().padEnd(5)} ${event}${contextStr}${errorStr}`);
    }
  }

  // File output (optional)
  if (config.file) {
    try {
      const logDir = path.dirname(config.file);
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }
      fs.appendFileSync(config.file, JSON.stringify(entry) + '\n');
    } catch (err) {
      console.error('Failed to write log file:', err.message);
    }
  }
}

// Public API
const logger = {
  /**
   * Log error event
   * @param {string} event - Event name (e.g., 'database_connection_failed')
   * @param {object} context - Additional context data
   * @param {Error} error - Error object (optional)
   */
  error(event, context = {}, error = null) {
    writeLog('ERROR', event, context, error);
  },

  /**
   * Log warning event
   * @param {string} event - Event name (e.g., 'rate_limit_approaching')
   * @param {object} context - Additional context data
   */
  warn(event, context = {}) {
    writeLog('WARN', event, context);
  },

  /**
   * Log info event
   * @param {string} event - Event name (e.g., 'server_started')
   * @param {object} context - Additional context data
   */
  info(event, context = {}) {
    writeLog('INFO', event, context);
  },

  /**
   * Log debug event
   * @param {string} event - Event name (e.g., 'cache_hit')
   * @param {object} context - Additional context data
   */
  debug(event, context = {}) {
    writeLog('DEBUG', event, context);
  },

  /**
   * Create child logger with additional context
   * @param {object} childContext - Context to add to all log entries
   * @returns {object} Child logger
   */
  child(childContext) {
    return {
      error: (event, context = {}, error = null) => 
        logger.error(event, { ...childContext, ...context }, error),
      warn: (event, context = {}) => 
        logger.warn(event, { ...childContext, ...context }),
      info: (event, context = {}) => 
        logger.info(event, { ...childContext, ...context }),
      debug: (event, context = {}) => 
        logger.debug(event, { ...childContext, ...context }),
      child: (moreContext) => logger.child({ ...childContext, ...moreContext })
    };
  },

  /**
   * Update logger configuration at runtime
   * @param {object} newConfig - Configuration updates
   */
  configure(newConfig) {
    Object.assign(config, newConfig);
  }
};

module.exports = logger;
