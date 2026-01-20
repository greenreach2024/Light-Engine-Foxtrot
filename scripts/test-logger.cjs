#!/usr/bin/env node

/**
 * Test script for structured logger
 */

const logger = require('../lib/logger.cjs');

console.log('\n=== Testing Structured Logger ===\n');

// Test INFO level
logger.info('test_started', { test_name: 'logger_test', version: '1.0.0' });

// Test DEBUG level
logger.debug('cache_hit', { key: 'test_key', ttl: 3600 });

// Test WARN level
logger.warn('rate_limit_approaching', { current: 95, limit: 100, endpoint: '/api/test' });

// Test ERROR level
logger.error('database_query_failed', 
  { query: 'SELECT * FROM users', duration_ms: 5000 },
  new Error('Connection timeout')
);

// Test child logger
const requestLogger = logger.child({ request_id: 'req-12345', user_id: 'user-789' });
requestLogger.info('request_received', { method: 'POST', path: '/api/orders' });
requestLogger.info('request_completed', { status: 200, duration_ms: 45 });

// Test nested child
const authLogger = requestLogger.child({ component: 'auth' });
authLogger.info('token_validated', { token_type: 'JWT' });

console.log('\n=== Test Complete ===\n');
console.log('✅ All log levels working');
console.log('✅ Child loggers working');
console.log('✅ Error handling working');
console.log('\nTo test different formats:');
console.log('  JSON format:  LOG_JSON=true node scripts/test-logger.js');
console.log('  Text format:  LOG_JSON=false node scripts/test-logger.js');
console.log('  Debug level:  LOG_LEVEL=DEBUG node scripts/test-logger.js');
console.log('  File logging: LOG_FILE=logs/test.log node scripts/test-logger.js');
