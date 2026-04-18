/**
 * Security Features Test Suite
 * 
 * Tests for Phase 1 Security Hardening:
 * - JWT Secrets Manager integration
 * - Rate limiting middleware
 * - Audit logging
 * - CORS restrictions
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

// Test 1: Secrets Manager Utility
describe('Secrets Manager Utility', () => {
  let getJwtSecret;

  before(async () => {
    // Set test JWT_SECRET
    process.env.JWT_SECRET = 'test-jwt-secret-for-testing';
    
    // Import the module
    const module = await import('../server/utils/secrets-manager.js');
    getJwtSecret = module.getJwtSecret;
  });

  it('should fall back to JWT_SECRET environment variable when no ARN is set', async () => {
    // Remove JWT_SECRET_ARN if set
    delete process.env.JWT_SECRET_ARN;
    
    const secret = await getJwtSecret();
    assert.strictEqual(secret, 'test-jwt-secret-for-testing', 'Should return JWT_SECRET from env');
  });

  it('should warn about default JWT_SECRET', async () => {
    process.env.JWT_SECRET = 'your-secret-key-here-change-in-production';
    
    let warningLogged = false;
    const originalWarn = console.warn;
    console.warn = (...args) => {
      if (args[0]?.includes('default JWT_SECRET')) {
        warningLogged = true;
      }
    };
    
    await getJwtSecret();
    console.warn = originalWarn;
    
    assert.strictEqual(warningLogged, true, 'Should log warning for default secret');
    
    // Restore test secret
    process.env.JWT_SECRET = 'test-jwt-secret-for-testing';
  });

  after(() => {
    delete process.env.JWT_SECRET;
    delete process.env.JWT_SECRET_ARN;
  });
});

// Test 2: Rate Limiter Middleware
describe('Rate Limiter Middleware', () => {
  let createRateLimiter, rateLimiters;

  before(async () => {
    const module = await import('../server/middleware/rate-limiter.js');
    createRateLimiter = module.createRateLimiter;
    rateLimiters = {
      auth: module.authRateLimiter,
      api: module.apiRateLimiter,
      read: module.readRateLimiter,
      write: module.writeRateLimiter
    };
  });

  it('should export rate limiter middleware functions', () => {
    assert.ok(typeof rateLimiters.auth === 'function', 'authRateLimiter should be a function');
    assert.ok(typeof rateLimiters.api === 'function', 'apiRateLimiter should be a function');
    assert.ok(typeof rateLimiters.read === 'function', 'readRateLimiter should be a function');
    assert.ok(typeof rateLimiters.write === 'function', 'writeRateLimiter should be a function');
  });

  it('should create a rate limiter with correct configuration', () => {
    const limiter = createRateLimiter('test', 10, 60000);
    assert.ok(typeof limiter === 'function', 'Should return middleware function');
  });

  it('should allow requests within limit', () => {
    const limiter = createRateLimiter({
      windowMs: 60000,
      max: 5,
      message: 'Rate limit hit'
    });
    
    // Create mock request/response
    const req = { ip: '127.0.0.1', path: '/test' };
    const res = {
      status: function(code) {
        this.statusCode = code;
        return this;
      },
      json: function(data) {
        this.jsonData = data;
        return this;
      },
      setHeader: function() {}
    };
    let nextCalled = false;
    const next = () => { nextCalled = true; };
    
    // Should allow first request
    limiter(req, res, next);
    assert.strictEqual(nextCalled, true, 'Should call next() within limit');
  });

  it('should block requests over limit', () => {
    const limiter = createRateLimiter({
      windowMs: 60000,
      max: 2,
      message: 'Rate limit hit'
    });
    
    const req = { ip: '127.0.0.2', path: '/test' };
    const res = {
      status: function(code) {
        this.statusCode = code;
        return this;
      },
      json: function(data) {
        this.jsonData = data;
        return this;
      },
      setHeader: function() {}
    };
    const next = () => {};
    
    // Make 3 requests (limit is 2)
    limiter(req, res, next);
    limiter(req, res, next);
    limiter(req, res, next);
    
    // Third request should be blocked
    assert.strictEqual(res.statusCode, 429, 'Should return 429 status code');
    assert.ok(String(res.jsonData?.error || '').includes('Too Many Requests'), 'Should return rate limit error');
  });
});

// Test 3: Audit Logger Middleware
describe('Audit Logger Middleware', () => {
  let logAuditEvent, AuditEventType;

  before(async () => {
    const module = await import('../server/middleware/audit-logger.js');
    logAuditEvent = module.logAuditEvent;
    AuditEventType = module.AuditEventType;
  });

  it('should export audit event types', () => {
    assert.ok(AuditEventType, 'AuditEventType should be exported');
    assert.ok(AuditEventType.LOGIN_SUCCESS, 'LOGIN_SUCCESS event type should exist');
    assert.ok(AuditEventType.LOGIN_FAILURE, 'LOGIN_FAILURE event type should exist');
    assert.ok(AuditEventType.PASSWORD_RESET_REQUESTED, 'PASSWORD_RESET_REQUESTED event type should exist');
    assert.ok(AuditEventType.PASSWORD_RESET_COMPLETED, 'PASSWORD_RESET_COMPLETED event type should exist');
  });

  it('should log audit events with correct structure', () => {
    let loggedPrefix = null;
    let loggedData = null;
    const originalLog = console.log;
    console.log = (message, payload) => {
      if (message?.includes('[AUDIT]')) {
        loggedPrefix = message;
        loggedData = payload;
      }
    };
    
    const req = {
      ip: '127.0.0.1',
      headers: { 'user-agent': 'test-agent' },
      method: 'POST',
      path: '/api/auth/login',
      get(name) {
        return this.headers?.[String(name).toLowerCase()];
      }
    };
    
    logAuditEvent(AuditEventType.LOGIN_SUCCESS, {
      userId: 'test-user-123',
      email: 'test@example.com'
    }, req);
    
    console.log = originalLog;
    
    assert.ok(loggedPrefix, 'Audit event should be logged');
    assert.ok(loggedData?.includes(AuditEventType.LOGIN_SUCCESS), 'Should include event type');
    assert.ok(loggedData?.includes('test-user-123'), 'Should include user ID');
  });
});

// Test 4: CORS Configuration
describe('CORS Configuration', () => {
  let setCorsHeaders;

  before(async () => {
    const module = await import('../server/middleware/cors.js');
    setCorsHeaders = module.setCorsHeaders;
  });

  it('should export CORS middleware function', () => {
    assert.ok(typeof setCorsHeaders === 'function', 'setCorsHeaders should be a function');
  });

  it('should allow whitelisted origins', () => {
    const allowedOrigin = 'http://light-engine-demo-1765326376.s3-website-us-east-1.amazonaws.com';
    
    const req = {
      headers: { origin: allowedOrigin },
      method: 'GET'
    };
    const res = {
      headers: {},
      setHeader: function(key, value) {
        this.headers[key] = value;
      }
    };
    let nextCalled = false;
    const next = () => { nextCalled = true; };
    
    setCorsHeaders(req, res, next);
    
    assert.strictEqual(nextCalled, true, 'Should call next()');
    assert.strictEqual(res.headers['Access-Control-Allow-Origin'], allowedOrigin, 
      'Should set CORS header for whitelisted origin');
  });

  it('should reject non-whitelisted origins', () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    const evilOrigin = 'https://evil.com';
    
    const req = {
      headers: { origin: evilOrigin },
      method: 'GET'
    };
    const res = {
      headers: {},
      statusCode: 200,
      body: null,
      setHeader: function(key, value) {
        this.headers[key] = value;
      },
      status: function(code) {
        this.statusCode = code;
        return this;
      },
      json: function(data) {
        this.body = data;
        return this;
      }
    };
    let nextCalled = false;
    const next = () => { nextCalled = true; };
    
    setCorsHeaders(req, res, next);
    
    assert.strictEqual(nextCalled, false, 'Should not call next() for blocked production origin');
    assert.strictEqual(res.statusCode, 403, 'Should return 403 for blocked origin');
    assert.ok(!res.headers['Access-Control-Allow-Origin'], 
      'Should not set CORS header for non-whitelisted origin');

    process.env.NODE_ENV = originalEnv;
  });
});

// Test 5: Secret Management Documentation
describe('Secret Management Documentation', () => {
  it('should document the current Cloud Run secret configuration', async () => {
    const docPath = join(projectRoot, '.github', 'CRITICAL_CONFIGURATION.md');

    assert.ok(fs.existsSync(docPath), 'CRITICAL_CONFIGURATION.md should exist');

    const content = fs.readFileSync(docPath, 'utf-8');
    assert.ok(content.includes('Google Secret Manager'), 'Should document Google Secret Manager');
    assert.ok(content.includes('JWT_SECRET'), 'Should document JWT secret configuration');
    assert.ok(content.includes('Cloud Run'), 'Should document Cloud Run configuration');
  });
});

// Test 6: Setup Script
describe('JWT Setup Script', () => {
  it('should exist and have correct structure', () => {
    const scriptPath = join(projectRoot, 'scripts', 'setup-jwt-secret.js');
    
    assert.ok(fs.existsSync(scriptPath), 'setup-jwt-secret.js should exist');
    
    const content = fs.readFileSync(scriptPath, 'utf-8');
    assert.ok(content.includes('generateJwtSecret'), 'Should have generateJwtSecret function');
    assert.ok(content.includes('SecretsManagerClient'), 'Should use AWS SDK');
    assert.ok(content.includes('crypto.randomBytes(64)'), 'Should generate 64-byte secret');
  });
});

// Test 7: Documentation
describe('Security Documentation', () => {
  it('should have comprehensive cloud architecture guidance', () => {
    const docPath = join(projectRoot, '.github', 'CLOUD_ARCHITECTURE.md');

    assert.ok(fs.existsSync(docPath), 'CLOUD_ARCHITECTURE.md should exist');

    const content = fs.readFileSync(docPath, 'utf-8');
    assert.ok(content.includes('Google Cloud Run'), 'Should document Cloud Run deployment');
    assert.ok(content.includes('Google Secret Manager'), 'Should document secret management');
    assert.ok(content.includes('Direct VPC egress'), 'Should document private network connectivity');
    assert.ok(content.includes('AlloyDB'), 'Should document the production database');
  });

  it('should have security hardening documentation', () => {
    const docPath = join(projectRoot, '.github', 'copilot-instructions.md');

    assert.ok(fs.existsSync(docPath), 'copilot-instructions.md should exist');

    const content = fs.readFileSync(docPath, 'utf-8');
    assert.ok(content.includes('Secret Manager'), 'Should document secret handling guidance');
    assert.ok(content.includes('Cloud Run'), 'Should document current deployment target');
    assert.ok(content.includes('Google Cloud'), 'Should document the active infrastructure');
  });
});

// Test 8: Environment Configuration
describe('Environment Configuration', () => {
  it('should have security settings in .env.example', () => {
    const envPath = join(projectRoot, '.env.example');
    
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf-8');
      assert.ok(content.includes('RATE_LIMITING_ENABLED') || content.includes('security'), 
        'Should include security configuration');
    }
  });
});

console.log('\n🔒 Security Features Test Suite\n');
console.log('Testing Phase 1 Security Hardening implementation...\n');
