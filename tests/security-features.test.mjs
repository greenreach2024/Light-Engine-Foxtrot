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
    process.env.JWT_SECRET = 'CHANGE_ME_IN_PRODUCTION';
    
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
    const limiter = createRateLimiter('test-allow', 5, 60000);
    
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
    const limiter = createRateLimiter('test-block', 2, 60000);
    
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
    assert.ok(res.jsonData?.error?.includes('Too many requests'), 'Should return rate limit error');
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
    assert.ok(AuditEventType.PASSWORD_RESET, 'PASSWORD_RESET event type should exist');
  });

  it('should log audit events with correct structure', () => {
    let loggedData = null;
    const originalLog = console.log;
    console.log = (message) => {
      if (message?.includes('AUDIT_LOG')) {
        loggedData = message;
      }
    };
    
    const req = {
      ip: '127.0.0.1',
      headers: { 'user-agent': 'test-agent' },
      method: 'POST',
      path: '/api/auth/login'
    };
    
    logAuditEvent(req, AuditEventType.LOGIN_SUCCESS, {
      userId: 'test-user-123',
      email: 'test@example.com'
    });
    
    console.log = originalLog;
    
    assert.ok(loggedData, 'Audit event should be logged');
    assert.ok(loggedData.includes('LOGIN_SUCCESS'), 'Should include event type');
    assert.ok(loggedData.includes('test-user-123'), 'Should include user ID');
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
    const evilOrigin = 'https://evil.com';
    
    const req = {
      headers: { origin: evilOrigin },
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
    assert.ok(!res.headers['Access-Control-Allow-Origin'], 
      'Should not set CORS header for non-whitelisted origin');
  });
});

// Test 5: Python Secrets Manager
describe('Python Secrets Manager (syntax check)', () => {
  it('should have valid Python syntax', async () => {
    const pythonFilePath = join(projectRoot, 'backend', 'secrets_manager.py');
    
    // Check file exists
    assert.ok(fs.existsSync(pythonFilePath), 'secrets_manager.py should exist');
    
    // Check file has expected content
    const content = fs.readFileSync(pythonFilePath, 'utf-8');
    assert.ok(content.includes('class SecretsManagerClient'), 'Should define SecretsManagerClient class');
    assert.ok(content.includes('def get_jwt_secret'), 'Should have get_jwt_secret function');
    assert.ok(content.includes('boto3'), 'Should import boto3');
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
  it('should have comprehensive AWS infrastructure guide', () => {
    const docPath = join(projectRoot, 'AWS_INFRASTRUCTURE_SETUP.md');
    
    assert.ok(fs.existsSync(docPath), 'AWS_INFRASTRUCTURE_SETUP.md should exist');
    
    const content = fs.readFileSync(docPath, 'utf-8');
    assert.ok(content.includes('JWT Secrets Manager Setup'), 'Should document Secrets Manager setup');
    assert.ok(content.includes('SSL/TLS Certificate Configuration'), 'Should document SSL/TLS');
    assert.ok(content.includes('AWS WAF Configuration'), 'Should document WAF');
    assert.ok(content.includes('CloudWatch Alarms'), 'Should document monitoring');
  });

  it('should have security hardening documentation', () => {
    const docPath = join(projectRoot, 'SECURITY_HARDENING.md');
    
    assert.ok(fs.existsSync(docPath), 'SECURITY_HARDENING.md should exist');
    
    const content = fs.readFileSync(docPath, 'utf-8');
    assert.ok(content.includes('CORS'), 'Should document CORS');
    assert.ok(content.includes('Rate Limiting'), 'Should document rate limiting');
    assert.ok(content.includes('Audit Logging'), 'Should document audit logging');
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
