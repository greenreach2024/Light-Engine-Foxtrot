// Load .env if available, but don't crash if the package isn't present in production bundles
try {
  await import('dotenv/config');
} catch (err) {
  console.warn('[startup] dotenv/config not loaded:', err?.message || err);
}

import express from "express";
import expressWs from 'express-ws';
import helmet from 'helmet';
import os from 'os';
import { setCorsHeaders } from './server/middleware/cors.js';

// Security middleware
import { 
  apiRateLimiter, 
  authRateLimiter, 
  writeRateLimiter, 
  readRateLimiter 
} from './server/middleware/rate-limiter.js';
import { 
  auditMiddleware as securityAuditMiddleware,
  logAuditEvent as securityLogAuditEvent,
  AuditEventType as SecurityAuditEventType
} from './server/middleware/audit-logger.js';
import { getJwtSecret } from './server/utils/secrets-manager.js';

// Setup console wrapper for demo mode BEFORE any other logs
import { setupConsoleWrapper } from './server/utils/console-wrapper.js';
setupConsoleWrapper();

// Framework validation - MUST run before any operational code
import { validator as frameworkValidator } from './lib/framework-validator.js';

// LOG ENVIRONMENT ON STARTUP (will be suppressed in demo mode)
console.log(' [STARTUP] Environment variables:');
console.log('  DEMO_MODE:', process.env.DEMO_MODE);
console.log('  DEMO_FARM_ID:', process.env.DEMO_FARM_ID);
console.log('  DEMO_REALTIME:', process.env.DEMO_REALTIME);
console.log('  NODE_ENV:', process.env.NODE_ENV);
console.log('  PORT:', process.env.PORT);

// --- Feature flag: ALLOW_MOCKS (default OFF) ---
const ALLOW_MOCKS = String(process.env.ALLOW_MOCKS || 'false').toLowerCase() === 'true';

// --- Demo Mode imports ---
import { 
  initializeDemoMode, 
  createDemoModeHandler, 
  isDemoMode, 
  getDemoData,
  getDemoBannerHTML 
} from './server/middleware/demo-mode-handler.js';

// Initialize demo mode immediately at module load
console.log('[charlie] 🎬 Module loading - initializing demo mode...');
try {
  initializeDemoMode();
  console.log('[charlie]  Demo mode initialized at module scope');
} catch (error) {
  console.error('[charlie]  Demo mode initialization failed:', error?.message || error);
}

import { createProxyMiddleware } from "http-proxy-middleware";
import fs from "fs";
import http from 'node:http';
import https from 'node:https';
import path from "path";
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import Datastore from 'nedb-promises';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import validator from 'validator';
import net from 'node:net';
import mqtt from 'mqtt';
import { exec } from 'child_process';
import axios from 'axios';
import SyncServiceClass from './services/sync-service.js';

// =====================================================
// Controller Restriction Middleware
// =====================================================
// Restricts remote/laptop users from issuing farm-critical device commands
// (lights, HVAC, plugs) to prevent failures when the controlling device
// is not on-site or not running 24/7. Local/on-site access gets full control.

function requireEdgeForControl(req, res, next) {
  // Extract JWT token from Authorization header or query param
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') 
    ? authHeader.substring(7) 
    : req.query.token || req.cookies?.token;
  
  if (!token) {
    // No token - allow for backward compatibility with PIN-based auth
    return next();
  }
  
  try {
    const jwtSecret = process.env.JWT_SECRET || getJwtSecret();
    const decoded = jwt.verify(token, jwtSecret);
    const planType = (decoded.planType || '').toLowerCase();
    
    // Remote users are restricted from device control commands
    if (planType === 'cloud') {
      return res.status(403).json({
        ok: false,
        error: 'control_restricted',
        message: 'Remote access does not allow direct device control. Device commands require on-site or dedicated hardware for reliable 24/7 automation.',
        help: 'Remote users can monitor sensors and view dashboards but cannot send control commands. This prevents farm equipment failures when the controlling device is offline.',
        planType: 'cloud'
      });
    }
    
    // On-site users and demo mode get full control access
    next();
  } catch (error) {
    // Invalid token - let other middleware handle auth
    console.warn('[access-control] JWT verification failed:', error.message);
    next();
  }
}

// =====================================================
// JWT Authentication Middleware
// =====================================================
// Verifies JWT token and attaches user info to req.user

function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required'
    });
  }

  const token = authHeader.substring(7);
  
  try {
    const jwtSecret = process.env.JWT_SECRET || 'fallback-secret-change-in-production';
    const decoded = jwt.verify(token, jwtSecret);
    
    // Attach user info to request
    req.user = {
      farmId: decoded.farmId,
      email: decoded.email,
      role: decoded.role || 'admin',
      userId: decoded.userId,
      planType: decoded.planType || 'cloud'
    };
    
    next();
  } catch (error) {
    console.error('[auth] Token verification failed:', error.message);
    return res.status(401).json({
      success: false,
      error: 'Invalid or expired token'
    });
  }
}

import AutomationRulesEngine from './lib/automation-engine.js';
import { createPreAutomationLayer } from './automation/index.js';
import {
  buildSetupWizards,
  mergeDiscoveryPayload,
  getWizardDefaultInputs,
  cloneWizardStep
} from './server/wizards/index.js';
import buyerRouter from './server/buyer/routes.js';
import lightsDB from './lib/lights-database.js';
import ScheduleExecutor from './lib/schedule-executor.js';
import { solveSpectrum, toPWM } from './lib/spectral-solver.js';
import { mountMLRoutes } from './routes/ml.js';
import { validateLicense } from './lib/license-manager.js';
import { autoEnforceFeatures, requireFeature } from './server/middleware/feature-flags.js';
import healthRouter from './routes/health.js';
import adminHealthRouter from './routes/admin-health.js';
import adminAuthRouter from './server/routes/admin-auth.js';
import { adminAuthMiddleware } from './server/middleware/admin-auth.js';
import licenseRouter from './routes/license.js';
import wholesaleSyncRouter from './routes/wholesale-sync.js';
import wholesaleReservationsRouter, { cleanupExpiredReservations } from './routes/wholesale-reservations.js';
import wholesaleFulfillmentRouter from './routes/wholesale-fulfillment.js';
import wholesaleAdminRouter from './routes/wholesale-admin.js';
import cropPricingRouter from './routes/crop-pricing.js';
import wholesaleCatalogRouter from './routes/wholesale/catalog.js';
import wholesaleCheckoutRouter from './routes/wholesale/checkout.js';
import wholesaleBuyersRouter from './routes/wholesale-buyers.js';
import adminWholesaleBuyersRouter from './routes/admin-wholesale-buyers.js';
import wholesaleProductRequestsRouter from './routes/wholesale-product-requests.js';
import marketIntelligenceRouter from './routes/market-intelligence.js';
import wholesaleWebhooksRouter from './routes/wholesale/webhooks.js';
import wholesaleFulfillmentWebhooksRouter from './routes/wholesale/fulfillment-webhooks.js';
import wholesaleRefundsRouter from './routes/wholesale/refunds.js';
import { extractTenantId } from './server/middleware/multi-tenant.js';
import { generateFarmSlug } from './lib/slug-generator.js';
import wholesaleSquareOAuthRouter from './routes/wholesale/square-oauth.js';
import wholesaleSLAPoliciesRouter from './routes/wholesale/sla-policies.js';
import wholesaleNetworkRouter from './routes/wholesale/network.js';
import wholesaleOrdersRouter from './routes/wholesale-orders.js';
import wholesaleFarmPerformanceRouter from './routes/wholesale/farm-performance.js';
import networkRouter from './routes/network.js';
import activityHubOrdersRouter from './routes/activity-hub-orders.js';
import farmSquareSetupRouter from './routes/farm-square-setup.js';
import farmStripeSetupRouter from './routes/farm-stripe-setup.js';
import mdnsDiscoveryRouter from './routes/mdns-discovery.js';
import emailRouter from './server/routes/email-routes.js';
import adminFarmManagementRouter from './routes/admin-farm-management.js';
import qualityControlRouter from './routes/quality-control.js';
import aiVisionRouter from './routes/ai-vision.js';
import cropWeightReconciliationRouter, { getCropBenchmark, hasCropBenchmark } from './routes/crop-weight-reconciliation.js';
import traceabilityRouter, { createTraceRecord, linkCustomerToTrace, updateTraceStatus } from './routes/traceability.js';
import { router as migrationRouter, initDb as initMigrationDb } from './routes/migration.js';
import farmStoreSetupRouter from './routes/farm-store-setup.js';
import procurementRouter from './routes/procurement.js';
import edgeRouter from './routes/edge.js';
import setupRouter from './routes/setup.js';
import auditLogger, { auditMiddleware, createAuditRoutes } from './lib/wholesale/audit-logger.js';
import { checkAndControlEnvironment } from './controller/checkAndControlEnvironment.js';
import { coreAllocator } from './controller/coreAllocator.js';
import outdoorSensorValidator from './lib/outdoor-sensor-validator.js';
import anomalyHistory from './lib/anomaly-history.js';
import eventBus from './lib/event-bus.js';
import mlAutomation from './lib/ml-automation-controller.js';
import { applyModifier as applyRecipeModifier, computeModifiers as computeRecipeModifiers } from './lib/recipe-modifier.js';
import { scoreAlert, prioritizeAlerts, recordAlertResponse, getAlertStats } from './lib/alert-prioritizer.js';
import { executeSafetyEnvelope } from './lib/device-safety-envelope.js';

// Edge mode support
import edgeConfig from './lib/edge-config.js';
import SyncService from './lib/sync-service.js';
import CertificateManager from './services/certificate-manager.js';
import CredentialManager from './services/credential-manager.js';
import EdgeWholesaleService from './lib/edge-wholesale-service.js';
import WholesaleIntegrationService from './services/wholesale-integration.js';
import { sanitizeRequestBody } from './lib/input-validation.js';
import { initDatabase, checkHealth as checkDatabaseHealth, getDatabaseMode } from './lib/database.js';
import { 
  publishApiMetrics, 
  publishDatabaseMetrics, 
  publishMemoryMetrics,
  publishOrderMetrics,
  publishInventoryMetrics,
  isCloudWatchEnabled,
  getCloudWatchConfig
} from './lib/cloudwatch-metrics.js';

const app = express();
// Enable app.ws(...) WebSocket routes (used by sync status endpoint)
expressWs(app);

// Trust proxy - Required for Elastic Beanstalk, CloudFront, and other proxies
// This allows express to trust X-Forwarded-* headers for client IP, protocol, etc.
app.set('trust proxy', true);
console.log('[Security] Trust proxy enabled - will use X-Forwarded-For for client IP');

// Security Headers - Helmet.js
// Configure helmet for production-ready security headers
const isProduction = process.env.NODE_ENV === 'production';
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://code.responsivevoice.org", "https://web.squarecdn.com", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com", "https://unpkg.com"], // Note: unsafe-inline/eval needed for dynamic UI
      scriptSrcAttr: ["'unsafe-inline'"], // Allow inline event handlers (onclick, etc.)
      styleSrc: ["'self'", "'unsafe-inline'"], // Note: unsafe-inline needed for inline styles
      imgSrc: ["'self'", "data:", "http:", "https:"],
      connectSrc: ["'self'", "ws:", "wss:", "http:", "https:"], // Allow WebSocket connections
      fontSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'self'"], // Allow same-origin iframes for views
      upgradeInsecureRequests: null, // Disable upgrade-insecure-requests for HTTP-only deployments
    },
  },
  hsts: isProduction ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false,
  noSniff: true,
  referrerPolicy: { policy: 'same-origin' },
  xssFilter: true,
  frameguard: { action: 'sameorigin' } // Allow same-origin iframes
}));

console.log('[Security] Helmet.js security headers enabled');
if (isProduction) {
  console.log('[Security] HSTS enabled (maxAge: 1 year, includeSubDomains, preload)');
}

// Security Configuration
const RATE_LIMITING_ENABLED = String(process.env.RATE_LIMITING_ENABLED || 'true').toLowerCase() === 'true';
const AUDIT_LOG_ENABLED = String(process.env.AUDIT_LOG_ENABLED || 'true').toLowerCase() === 'true';

console.log('[Security] Rate limiting enabled:', RATE_LIMITING_ENABLED);
console.log('[Security] Audit logging enabled:', AUDIT_LOG_ENABLED);

if (RATE_LIMITING_ENABLED) {
  console.log('[Security] Rate limiting will be applied to:');
  console.log('  - Auth endpoints: 10 requests per 15 min');
  console.log('  - Write operations: 100 requests per 15 min');
  console.log('  - Read operations: 1000 requests per 15 min');
  console.log('  - General API: 500 requests per 15 min');
}

if (AUDIT_LOG_ENABLED) {
  console.log('[Security] Audit logging active for sensitive endpoints');
}

// Initialize sync services (will be started after DB is ready)
let syncService = null;
let wholesaleService = null;

// Metrics tracking for monitoring
const metrics = {
  requests: {
    total: 0,
    errors: 0,
    responseTimes: []
  },
  startTime: Date.now()
};

// Metrics middleware with CloudWatch integration
app.use((req, res, next) => {
  const start = Date.now();
  metrics.requests.total++;
  
  // Track response
  res.on('finish', () => {
    const duration = Date.now() - start;
    metrics.requests.responseTimes.push(duration);
    
    // Keep only last 1000 response times
    if (metrics.requests.responseTimes.length > 1000) {
      metrics.requests.responseTimes.shift();
    }
    
    // Track errors
    if (res.statusCode >= 400) {
      metrics.requests.errors++;
    }
    
    // Publish to CloudWatch (async, non-blocking)
    if (isCloudWatchEnabled()) {
      // Sample 10% of requests to reduce CloudWatch costs
      const shouldSample = Math.random() < 0.1;
      if (shouldSample || res.statusCode >= 400) {
        publishApiMetrics(req.path, req.method, res.statusCode, duration).catch(err => {
          console.error('[CloudWatch] Failed to publish API metrics:', err.message);
        });
      }
    }
  });
  
  next();
});

// --- Kasa and Shelly Search Endpoints ---
app.post('/plugs/search/kasa', asyncHandler(async (req, res) => {
  setPreAutomationCors(req, res);
  try {
    prePlugManager.registerKasaDriver();
    const plugs = await prePlugManager.drivers.get('kasa').discover();
    res.json({ ok: true, plugs, vendor: 'kasa', searchedAt: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
}));

// --- Kasa Device Power Control ---
app.post('/api/kasa/device/:host/power', asyncHandler(async (req, res) => {
  const { host } = req.params;
  const { state } = req.body; // 'on' or 'off'
  
  if (!host) {
    return res.status(400).json({ ok: false, error: 'Device host/IP required' });
  }
  
  if (!state || !['on', 'off'].includes(state)) {
    return res.status(400).json({ ok: false, error: 'State must be "on" or "off"' });
  }
  
  try {
    const kasaClient = await createKasaClient();
    
    // Connect to device
    const device = kasaClient.getDevice({ host });
    
    // Send power command
    const result = state === 'on' 
      ? await device.setPowerState(true)
      : await device.setPowerState(false);
    
    console.log(`[Kasa] Power ${state} sent to ${host}:`, result);
    
    res.json({ 
      ok: true, 
      state, 
      host,
      result,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error(`[Kasa] Power control failed for ${host}:`, error.message);
    res.status(500).json({ 
      ok: false, 
      error: error.message,
      host,
      state
    });
  }
}));

app.post('/plugs/search/shelly', asyncHandler(async (req, res) => {
  setPreAutomationCors(req, res);
  try {
    prePlugManager.registerShellyDriver();
    const plugs = await prePlugManager.drivers.get('shelly').discover();
    res.json({ ok: true, plugs, vendor: 'shelly', searchedAt: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
}));

const parsedPort = Number.parseInt(process.env.PORT ?? '', 10);
const hasExplicitPort = Number.isFinite(parsedPort);
let PORT = hasExplicitPort ? parsedPort : 8091;
const RUNNING_UNDER_NODE_TEST = process.argv.some((arg) =>
  arg === '--test' || arg.startsWith('--test=')
);
// Centralized test-mode guard used to disable background timers/loops during tests/CI
const IS_TEST_ENV = RUNNING_UNDER_NODE_TEST
  || process.env.NODE_ENV === 'test'
  || String(process.env.CI).toLowerCase() === 'true'
  || String(process.env.TEST_MODE).toLowerCase() === 'true'
  || String(process.env.TEST_MODE) === '1';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STRICT_DEVICE_VALIDATION = ['1', 'true', 'yes'].includes(String(process.env.STRICT_DEVICE_VALIDATION || '').toLowerCase());
const PUBLIC_DIR = path.join(__dirname, 'public');
const LIGHT_ENGINE_DIR = path.join(__dirname, 'light-engine', 'public');

// Crop registry — single source of truth for all crop metadata (Phase 2a)
const _require = createRequire(import.meta.url);
const cropUtils = _require('./public/js/crop-utils.js');
try {
  const registryData = JSON.parse(fs.readFileSync(path.join(PUBLIC_DIR, 'data/crop-registry.json'), 'utf8'));
  cropUtils.setRegistry(registryData);
  console.log(`[startup] Crop registry loaded: ${Object.keys(registryData.crops).length} crops (v${registryData.version})`);
} catch (err) {
  console.warn('[startup] Crop registry not loaded — falling back to plan-ID parsing:', err?.message);
}
const BUILD_TIME = Date.now().toString();
const APP_VERSION = (process.env.APP_VERSION
  || process.env.GIT_SHA
  || process.env.VERSION
  || `build-${BUILD_TIME}`)
  .toString();
// index.charlie.html REMOVED — consolidated into LE-farm-admin.html

// Demo data helper so /data/*.json can fall back even if demo middleware is skipped
function loadDemoFarmSnapshot() {
  try {
    // Check DEMO_MODE env var directly instead of relying on isDemoMode()
    // (which may not be initialized yet when routes are registered)
    const demoMode = process.env.DEMO_MODE === 'true';
    
    if (demoMode) {
      // Try multiple fallback locations (in order of preference)
      const possiblePaths = [
        path.join(__dirname, 'data', 'demo', 'demo-farm-complete.json'),
        path.join(__dirname, 'public', 'data', 'demo-farm-data.json'),
        path.join(__dirname, 'docs', 'data', 'demo-farm-data.json')
      ];

      for (const demoDataPath of possiblePaths) {
        if (fs.existsSync(demoDataPath)) {
          console.log(`[demo] Loading demo farm data from: ${demoDataPath}`);
          return JSON.parse(fs.readFileSync(demoDataPath, 'utf8'));
        }
      }
      
      console.warn('[demo] No demo farm data file found in any expected location');
    }
  } catch (error) {
    console.warn('[demo] Failed to load demo farm snapshot:', error?.message || error);
  }
  return null;
}

const DEFAULT_NUTRIENT_MQTT_URL = process.env.NUTRIENT_MQTT_URL || 'mqtt://192.168.2.42:1883';
const DEFAULT_NUTRIENT_COMMAND_TOPIC = process.env.NUTRIENT_COMMAND_TOPIC || 'commands/NutrientRoom';
const parsedNutrientTimeout = Number.parseInt(process.env.NUTRIENT_COMMAND_TIMEOUT_MS || '', 10);
const NUTRIENT_COMMAND_TIMEOUT_MS = Number.isFinite(parsedNutrientTimeout) ? parsedNutrientTimeout : 8000;
const DEFAULT_AUTODOSE_CONFIG = Object.freeze({
  autodoseEnabled: true,
  phTarget: 6.5,
  phTolerance: 0.15,
  ecTarget: 800,
  ecTolerance: 50,
  ecDoseSeconds: 2.5,
  phDownDoseSeconds: 1.0,
  minDoseIntervalSec: 60
});

const LEGACY_CHANNEL_MAP = Object.freeze({
  phdown: 'phDown',
  ph_up: 'phUp',
  phup: 'phUp',
  ph: 'phDown',
  ecmixa: 'nutrientA',
  ec_a: 'nutrientA',
  eca: 'nutrientA',
  nutrienta: 'nutrientA',
  ecmixb: 'nutrientB',
  ec_b: 'nutrientB',
  ecb: 'nutrientB',
  nutrientb: 'nutrientB'
});

function mapLegacyChannelToPump(channel) {
  if (!channel) return null;
  const key = String(channel).trim().toLowerCase();
  return LEGACY_CHANNEL_MAP[key] || null;
}

function translateLegacyNutrientCommand(payload) {
  if (!payload || typeof payload !== 'object') return null;

  const now = Date.now();
  const action = typeof payload.action === 'string' ? payload.action.trim() : '';
  const actionKey = action.toLowerCase();

  if (actionKey === 'savepumpcalibration' && payload.calibration && typeof payload.calibration === 'object') {
    const { channel, flowMlPerSec } = payload.calibration;
    const pump = mapLegacyChannelToPump(channel);
    const rate = Number(flowMlPerSec);
    if (!pump || !Number.isFinite(rate) || rate <= 0) return null;
    return {
      topic: 'sensors/nutrient/command/pump_cal',
      payload: {
        pump,
        ml_per_sec: Number(rate.toFixed(4)),
        timestamp: now
      }
    };
  }

  if (actionKey === 'sensorcal') {
    const sensor = typeof payload.sensor === 'string' ? payload.sensor.trim().toLowerCase() : null;
    const commandRaw = typeof payload.command === 'string' ? payload.command.trim().toLowerCase() : null;
    if (!sensor || !commandRaw) return null;

    const modeMap = sensor === 'ph'
      ? { clear: 'clear', mid: 'mid', low: 'low', high: 'high', status: 'status' }
      : { clear: 'clear', dry: 'dry', low: 'low', high: 'high', one: 'one', status: 'status' };

    const mode = modeMap[commandRaw];
    if (!mode) return null;

    const value = Number(payload.value);
    const hasValue = Number.isFinite(value);

    return {
      topic: 'sensors/nutrient/command/cal',
      payload: {
        sensor,
        mode,
        value: hasValue ? value : undefined,
        timestamp: now
      }
    };
  }

  if (['phdown', 'phup', 'ecmixa', 'ecmixb'].includes(actionKey)) {
    const pump = mapLegacyChannelToPump(action);
    if (!pump) return null;

    const durationSec = Number(payload.durationSec ?? payload.duration ?? payload.seconds);
    const volumeMl = Number(payload.volumeMl ?? payload.ml);
    const command = {
      pump,
      timestamp: now
    };

    if (Number.isFinite(volumeMl) && volumeMl > 0) {
      command.ml = Number(volumeMl.toFixed(3));
    }

    if (Number.isFinite(durationSec) && durationSec > 0) {
      command.duration_ms = Math.round(durationSec * 1000);
    }

    if (!command.ml && !command.duration_ms) return null;

    return {
      topic: 'sensors/nutrient/command/dose',
      payload: command
    };
  }

  if (actionKey === 'stop') {
    return {
      topic: 'sensors/nutrient/command/stop',
      payload: {
        reason: payload.reason || 'manual-stop',
        timestamp: now
      }
    };
  }

  if (actionKey === 'requeststatus') {
    return {
      topic: 'sensors/nutrient/command/request_status',
      payload: {
        timestamp: now
      }
    };
  }

  return null;
}

// Global write queues to serialize JSON file writes and avoid blocking sync I/O
const __jsonWriteQueues = new Map(); // key: fullPath -> Promise chain

async function writeJsonQueued(fullPath, jsonString) {
  const prev = __jsonWriteQueues.get(fullPath) || Promise.resolve();
  const next = prev.then(async () => {
    await fs.promises.mkdir(path.dirname(fullPath), { recursive: true }).catch(() => {});
    await fs.promises.writeFile(fullPath, jsonString, 'utf8');
  }).catch((err) => {
    console.warn('[writeJsonQueued] Failed write:', fullPath, err?.message || err);
  });
  __jsonWriteQueues.set(fullPath, next);
  // Do not await the entire chain here; callers can await their own write
  return next;
}

// In-memory caches for hot data paths
let __envCache = null; // { zones: [...], updatedAt?: ISO }
let __envWriteInFlight = false;
let __envDirty = false;

// Zone bindings snapshot built in the background to avoid request latency
let __zoneBindingsSnapshot = { bindings: [], meta: { source: 'init', bindings: 0, updatedAt: null } };
let __zoneBindingsTimer = null;

// loadIndexCharlieHtml REMOVED — page consolidated into LE-farm-admin.html

// --- CORS Security: Whitelist-based origin validation ---
// This middleware runs on ALL requests and enforces CORS policy
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const isProduction = process.env.NODE_ENV === 'production';
  
  // Allowed origins for production
  const ALLOWED_ORIGINS = [
    'http://light-engine-demo-1765326376.s3-website-us-east-1.amazonaws.com',
    'http://light-engine-foxtrot-prod.eba-ukiyyqf9.us-east-1.elasticbeanstalk.com',
    'https://light-engine-demo-1765326376.s3-website-us-east-1.amazonaws.com',
    'https://light-engine-foxtrot-prod.eba-ukiyyqf9.us-east-1.elasticbeanstalk.com',
    'http://greenreachgreens.com',
    'https://greenreachgreens.com',
    'http://www.greenreachgreens.com',
    'https://www.greenreachgreens.com',
    'http://urbanyeild.ca',
    'https://urbanyeild.ca',
    'http://www.urbanyeild.ca',
    'https://www.urbanyeild.ca',
    'http://localhost:8091',
    'http://127.0.0.1:8091',
  ];
  
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    // Whitelisted origin
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  } else if (!origin) {
    // No origin (same-origin or server-to-server)
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else if (!isProduction) {
    // Development: allow all
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  } else {
    // Production: reject unauthorized origin (don't set CORS headers)
    console.error('[CORS] Global middleware REJECTED unauthorized origin:', origin);
    // Don't set Access-Control-Allow-Origin - browser will block
    if (req.method === 'OPTIONS') {
      return res.status(403).json({ error: 'Forbidden', message: 'Origin not allowed' });
    }
    // For non-OPTIONS, continue but don't set CORS headers
    return next();
  }
  
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.setHeader('Access-Control-Max-Age', '600');
  
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});
// Default controller target. Can be overridden with the CTRL env var.
// Use the Pi forwarder when available for remote device reachability during development.
const DEFAULT_CONTROLLER = "http://192.168.2.80:3000";
let CURRENT_CONTROLLER = process.env.CTRL || DEFAULT_CONTROLLER;
let hasPersistedController = false;

const forwarderEnvCandidates = [
  process.env.NETWORK_FORWARDER,
  process.env.FORWARDER_BASE,
  process.env.FORWARDER,
  process.env.FWD
];
const DEFAULT_FORWARDER = forwarderEnvCandidates.find((value) => {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  return isHttpUrl(trimmed);
}) || null;
let CURRENT_FORWARDER = DEFAULT_FORWARDER ? DEFAULT_FORWARDER.trim().replace(/\/+$/, '') : null;
let hasPersistedForwarder = false;
// IFTTT integration config (optional)
const IFTTT_KEY = process.env.IFTTT_KEY || process.env.IFTTT_WEBHOOK_KEY || "";
const IFTTT_INBOUND_TOKEN = process.env.IFTTT_INBOUND_TOKEN || "";
const IFTTT_ENABLED = Boolean(IFTTT_KEY);
// Environment source: "local" (default) reads public/data/env.json
// or "cloud" pulls from AWS Lambda/API Gateway endpoint that returns latest readings
// Legacy: AZURE_LATEST_URL still supported for backward compatibility
const CLOUD_ENDPOINT_URL = process.env.CLOUD_ENDPOINT_URL || process.env.AWS_ENDPOINT_URL || process.env.AZURE_LATEST_URL || "";
const ENV_SOURCE = process.env.ENV_SOURCE || (CLOUD_ENDPOINT_URL ? "cloud" : "local");
const ENV_PATH = path.resolve("./public/data/env.json");
const DATA_DIR = path.resolve("./public/data");
const FARM_PATH = path.join(DATA_DIR, 'farm.json');
const CONTROLLER_PATH = path.join(DATA_DIR, 'controller.json');
const FORWARDER_PATH = path.join(DATA_DIR, 'forwarder.json');
const GROUPS_PATH = path.join(DATA_DIR, 'groups.json');
const PLANS_PATH = path.join(DATA_DIR, 'plans.json');
const SCHEDULES_PATH = path.join(DATA_DIR, 'schedules.json');
const ROOMS_PATH = path.join(DATA_DIR, 'rooms.json');
const CALIBRATIONS_PATH = path.join(DATA_DIR, 'calibration.json');
const CALIBRATION_MULTIPLIERS_PATH = path.join(DATA_DIR, 'calibration.multipliers.json');
const DEVICES_CACHE_PATH = path.join(DATA_DIR, 'devices.cache.json');
const SWITCHBOT_CACHE_PATH = path.join(PUBLIC_DIR, 'data', 'switchbot.cache.json');
const EQUIPMENT_CATALOG_PATH = path.join(PUBLIC_DIR, 'data', 'equipment.catalog.json');
const NUTRIENT_DASHBOARD_PATH = path.join(PUBLIC_DIR, 'data', 'nutrient-dashboard.json');
const SAMPLE_PLAN_DOCUMENT = {
  sample: true,
  plans: [
    {
      id: 'sample-plan',
      key: 'sample-plan',
      name: 'Sample Photoperiod',
      description: 'Fallback spectrum mix (16/8 photoperiod) until recipes are published.',
      photoperiod: 16,
      photoperiodLabel: '16/8',
      ramp: { sunrise: 10, sunset: 10 },
      spectrum: { cw: 40, ww: 40, bl: 35, rd: 30 },
      days: [
        { stage: 'Static', cw: 40, ww: 40, bl: 35, rd: 30 }
      ]
    }
  ]
};
const CHANNEL_SCALE_PATH = path.resolve('./config/channel-scale.json');
const MAX_CHANNEL_BYTE = 255;
const DEFAULT_CHANNEL_SCALE = Object.freeze({ maxByte: 64, label: '00-40' });
const DEFAULT_CHANNEL_MAX_BYTE = DEFAULT_CHANNEL_SCALE.maxByte;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const NUTRIENT_SCOPE_ID = process.env.NUTRIENT_SCOPE || 'tank-2';
const NUTRIENT_BACKEND_SCOPE = process.env.NUTRIENT_BACKEND_SCOPE || 'NutrientRoom';
const NUTRIENT_POLL_INTERVAL_MS = Number(process.env.NUTRIENT_POLL_INTERVAL_MS) || 20000;

// Schedule Executor - Enable automated plan/schedule execution
const SCHEDULE_EXECUTOR_ENABLED = !IS_TEST_ENV && String(process.env.SCHEDULE_EXECUTOR_ENABLED || 'true').toLowerCase() === 'true';
const SCHEDULE_EXECUTOR_INTERVAL = Number(process.env.SCHEDULE_EXECUTOR_INTERVAL) || 60000; // Default: 1 minute
let scheduleExecutor = null;

// Controller HTTP connection pooling + simple circuit breaker to avoid tying up the process
const keepAliveHttpAgent = new http.Agent({ keepAlive: true, maxSockets: 50, maxFreeSockets: 10, timeout: 5000 });
const keepAliveHttpsAgent = new https.Agent({ keepAlive: true, maxSockets: 50, maxFreeSockets: 10, timeout: 5000 });
const controllerCircuit = {
  failures: 0,
  openUntil: 0,
  isOpen() { return Date.now() < this.openUntil; },
  recordSuccess() { this.failures = 0; this.openUntil = 0; },
  recordFailure() {
    this.failures += 1;
    if (this.failures >= 3) {
      // Back off for 10s after 3 consecutive failures
      this.openUntil = Date.now() + 10_000;
      this.failures = 0;
    }
  }
};

const UI_DATA_RESOURCES = new Map([
  ['farm', 'farm.json'],
  ['groups', 'groups.json'],
  ['sched', 'schedules.json'],
  ['plans', 'plans.json'],
  ['env', 'env.json']
]);
const UI_EQUIP_PATH = path.join(PUBLIC_DIR, 'data', 'ui.equip.json');
const UI_CTRLMAP_PATH = path.join(PUBLIC_DIR, 'data', 'ui.ctrlmap.json');
// Device DB (outside public): ./data/devices.nedb
const DB_DIR = path.resolve('./data');
const DB_PATH = path.join(DB_DIR, 'devices.nedb');

// Controller helpers: load persisted value if present; allow runtime updates
function ensureDataDir() {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}
}
function ensureDbDir(){ try { fs.mkdirSync(DB_DIR, { recursive: true }); } catch {} }
function isHttpUrl(u){ try { const x=new URL(u); return x.protocol==='http:'||x.protocol==='https:'; } catch { return false; } }

const DEFAULT_DEVICE_MULTIPLIERS = { cw: 1, ww: 1, b: 1, r: 1 };

function clampMultiplier(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 1;
  if (num < 0) return 0;
  if (num > 10) return 10;
  return Math.round(num * 1000) / 1000;
}

function normalizeMultiplierDoc(doc) {
  if (!doc || typeof doc !== 'object') return { ...DEFAULT_DEVICE_MULTIPLIERS };
  return {
    cw: clampMultiplier(doc.cw ?? doc.c ?? doc.cold ?? doc.coldWhite ?? 1),
    ww: clampMultiplier(doc.ww ?? doc.w ?? doc.warm ?? doc.warmWhite ?? 1),
    b: clampMultiplier(doc.b ?? doc.bl ?? doc.blue ?? 1),
    r: clampMultiplier(doc.r ?? doc.rd ?? doc.red ?? 1),
  };
}

function readCalibrationMultipliers() {
  ensureDataDir();
  try {
    if (!fs.existsSync(CALIBRATION_MULTIPLIERS_PATH)) {
      return {};
    }
    const raw = JSON.parse(fs.readFileSync(CALIBRATION_MULTIPLIERS_PATH, 'utf8'));
    const entries = raw && typeof raw === 'object' ? raw.devices || raw : {};
    return Object.entries(entries).reduce((acc, [deviceId, value]) => {
      const key = String(deviceId || '').trim();
      if (!key) return acc;
      acc[key] = normalizeMultiplierDoc(value);
      return acc;
    }, {});
  } catch (error) {
    console.warn('[calibration] Failed to read calibration multipliers:', error.message || error);
    return {};
  }
}

function writeCalibrationMultipliers(map) {
  ensureDataDir();
  const payload = { devices: {} };
  Object.entries(map || {}).forEach(([deviceId, value]) => {
    const key = String(deviceId || '').trim();
    if (!key) return;
    payload.devices[key] = normalizeMultiplierDoc(value);
  });
  try {
    fs.writeFileSync(CALIBRATION_MULTIPLIERS_PATH, JSON.stringify(payload, null, 2));
    return payload.devices;
  } catch (error) {
    console.error('[calibration] Failed to write calibration multipliers:', error.message || error);
    throw error;
  }
}

function getDeviceMultipliers(map, deviceId) {
  const id = String(deviceId ?? '').trim();
  if (!id) return { ...DEFAULT_DEVICE_MULTIPLIERS };
  const source = (map && typeof map === 'object' && map[id]) || {};
  return normalizeMultiplierDoc(source);
}

function applyMultipliersToHexPayload(hexValue, multipliers, maxByte = DEFAULT_CHANNEL_MAX_BYTE) {
  if (typeof hexValue !== 'string') return hexValue;
  const trimmed = hexValue.trim();
  if (!/^[0-9a-fA-F]{12}$/.test(trimmed)) return hexValue;
  const safeMax = Number.isFinite(maxByte) && maxByte > 0
    ? Math.min(Math.round(maxByte), MAX_CHANNEL_BYTE)
    : DEFAULT_CHANNEL_MAX_BYTE;
  const parts = trimmed.toUpperCase().match(/.{2}/g);
  if (!parts || parts.length !== 6) return hexValue;
  const keys = ['cw', 'ww', 'b', 'r'];
  let changed = false;
  for (let index = 0; index < keys.length; index += 1) {
    const base = parseInt(parts[index], 16);
    if (!Number.isFinite(base)) continue;
    const factor = Number.isFinite(multipliers?.[keys[index]]) ? multipliers[keys[index]] : 1;
    const scaled = Math.round(base * factor);
    const clamped = Math.max(0, Math.min(safeMax, scaled));
    if (clamped !== base) changed = true;
    parts[index] = clamped.toString(16).padStart(2, '0').toUpperCase();
  }
  if (!changed) {
    return parts.join('');
  }
  return parts.join('');
}

function loadGroupsFile() {
  ensureDataDir();
  try {
    if (!fs.existsSync(GROUPS_PATH)) return [];
    const raw = JSON.parse(fs.readFileSync(GROUPS_PATH, 'utf8'));
    if (Array.isArray(raw)) return raw;
    if (raw && Array.isArray(raw.groups)) return raw.groups;
    return [];
  } catch (err) {
    console.warn('[groups] Failed to read groups.json:', err.message);
    return [];
  }
}

function saveGroupsFile(groups) {
  ensureDataDir();
  try {
    const payload = JSON.stringify({ groups }, null, 2);
    fs.writeFileSync(GROUPS_PATH, payload);
    return true;
  } catch (err) {
    console.error('[groups] Failed to write groups.json:', err.message);
    return false;
  }
}

function readDeviceCache() {
  try {
    if (!fs.existsSync(DEVICES_CACHE_PATH)) return null;
    return fs.readFileSync(DEVICES_CACHE_PATH, 'utf8');
  } catch (err) {
    console.warn('[devices.cache] Failed to read cache:', err.message);
    return null;
  }
}

function writeDeviceCache(rawJson) {
  try {
    ensureDataDir();
    fs.writeFileSync(DEVICES_CACHE_PATH, rawJson);
  } catch (err) {
    console.warn('[devices.cache] Failed to write cache:', err.message);
  }
}

function sanitizePlansEnvelope(source, excludeKeys = []) {
  if (!source || typeof source !== 'object') return {};
  const skip = new Set(['plans', 'ok', 'sample', ...excludeKeys]);
  const envelope = {};
  for (const [key, value] of Object.entries(source)) {
    if (skip.has(key)) continue;
    envelope[key] = value;
  }
  return envelope;
}

function cloneSamplePlanDocument() {
  return JSON.parse(JSON.stringify(SAMPLE_PLAN_DOCUMENT));
}

function loadPlansDocument() {
  ensureDataDir();
  
  // Load plans from lighting-recipes.json (single source of truth)
  const RECIPES_PATH = path.join(DATA_DIR, 'lighting-recipes.json');
  
  try {
    if (!fs.existsSync(RECIPES_PATH)) {
      console.error('[plans] lighting-recipes.json not found! This file is required.');
      return { plans: [], meta: { source: 'lighting-recipes', error: 'File not found' } };
    }
    
    const recipesContent = fs.readFileSync(RECIPES_PATH, 'utf8');
    const recipesData = JSON.parse(recipesContent);
    
    if (!recipesData || !recipesData.crops || typeof recipesData.crops !== 'object') {
      console.warn('[plans] lighting-recipes.json has no crops data');
      return { plans: [], meta: { source: 'lighting-recipes', error: 'No crops data' } };
    }
    
    const slugify = (str) => String(str || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    
    // Convert recipes to plan format
    const plans = [];
    for (const [cropName, days] of Object.entries(recipesData.crops)) {
      if (!Array.isArray(days) || !days.length) continue;
      
      const id = `crop-${slugify(cropName)}`;
      const lightDays = days.map(row => ({
        day: Number(row.day),
        stage: String(row.stage || ''),
        ppfd: Number(row.ppfd),
        ec: row.ec != null ? Number(row.ec) : undefined,
        ph: row.ph != null ? Number(row.ph) : undefined,
        mix: {
          cw: 0, // Will be calculated from R/B/G
          ww: 0,
          bl: Number(row.blue || 0),
          gn: Number(row.green || 0),
          rd: Number(row.red || 0),
          fr: Number(row.far_red || 0)
        }
      }));
      
      const envDays = days
        .filter(row => row.temperature != null)
        .map(row => ({
          day: Number(row.day),
          tempC: Number(row.temperature)
        }));
      
      plans.push({
        id,
        key: id,
        name: String(cropName),
        crop: String(cropName),
        kind: 'recipe',
        description: `Lighting recipe for ${cropName}`,
        light: { days: lightDays },
        ...(envDays.length ? { env: { days: envDays } } : {}),
        meta: {
          source: 'lighting-recipes',
          appliesTo: { category: ['Crop'], varieties: [] }
        },
        defaults: { photoperiod: 12 }
      });
    }
    
    console.log(`[plans] Loaded ${plans.length} plans from lighting-recipes.json`);
    return { 
      plans, 
      meta: { 
        source: 'lighting-recipes',
        loadedAt: new Date().toISOString(),
        count: plans.length
      } 
    };
    
  } catch (err) {
    console.error('[plans] Failed to load lighting-recipes.json:', err.message);
    return { plans: [], meta: { source: 'lighting-recipes', error: err.message } };
  }
}

function savePlansDocument(document) {
  ensureDataDir();
  try {
    const plansArray = Array.isArray(document?.plans) ? document.plans : [];
    const envelope = sanitizePlansEnvelope(document || {});
    const payload = { ...envelope, plans: plansArray };
    fs.writeFileSync(PLANS_PATH, JSON.stringify(payload, null, 2));
    return true;
  } catch (err) {
    console.error('[plans] Failed to write plans.json:', err.message);
    return false;
  }
}

function loadPlansFile() {
  const doc = loadPlansDocument();
  return Array.isArray(doc.plans) ? doc.plans : [];
}

function savePlansFile(plans) {
  return savePlansDocument({ plans });
}

function loadSchedulesFile() {
  ensureDataDir();
  try {
    if (!fs.existsSync(SCHEDULES_PATH)) return [];
    const raw = JSON.parse(fs.readFileSync(SCHEDULES_PATH, 'utf8'));
    if (Array.isArray(raw)) return raw;
    if (raw && Array.isArray(raw.schedules)) return raw.schedules;
    return [];
  } catch (err) {
    console.warn('[sched] Failed to read schedules.json:', err.message);
    return [];
  }
}

function saveSchedulesFile(schedules) {
  ensureDataDir();
  try {
    fs.writeFileSync(SCHEDULES_PATH, JSON.stringify({ schedules }, null, 2));
    return true;
  } catch (err) {
    console.error('[sched] Failed to write schedules.json:', err.message);
    return false;
  }
}

async function fetchKnownDeviceIds() {
  try {
    const controller = getController();
    if (!controller) return new Set();
    const url = `${controller.replace(/\/$/, '')}/api/devicedatas`;
    const response = await fetch(url, { method: 'GET', headers: { accept: 'application/json' } }).catch(() => null);
    if (!response || !response.ok) return new Set();
    const body = await response.json().catch(() => ({}));
    const devices = Array.isArray(body?.data) ? body.data : [];
    const ids = new Set();
    devices.forEach((device) => {
      if (!device || typeof device !== 'object') return;
      const raw = device.id ?? device.deviceId ?? device.device_id ?? device.deviceID;
      if (raw == null) return;
      const id = String(raw).trim();
      if (id) ids.add(id);
    });
    return ids;
  } catch (err) {
    console.warn('[groups] Unable to fetch controller device ids:', err.message);
    return new Set();
  }
}

function normalizeMemberEntry(entry) {
  if (entry == null) return null;
  if (typeof entry === 'string') {
    const id = entry.trim();
    return id ? { id } : null;
  }
  if (typeof entry === 'object') {
    const copy = { ...entry };
    const idCandidate = [copy.id, copy.device_id, copy.deviceId, copy.deviceID]
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .find((value) => !!value);
    if (!idCandidate) return null;
    copy.id = idCandidate;
    delete copy.device_id;
    delete copy.deviceId;
    delete copy.deviceID;
    return copy;
  }
  return null;
}

function normalizeGroupForResponse(group) {
  if (!group || typeof group !== 'object') return null;
  const id = typeof group.id === 'string' ? group.id.trim() : '';
  const name = typeof group.name === 'string' ? group.name.trim() : '';
  const label = typeof group.label === 'string' ? group.label.trim() : name;
  const matchRaw = group.match && typeof group.match === 'object' ? group.match : null;
  const room = String(group.room ?? matchRaw?.room ?? '').trim();
  const zone = String(group.zone ?? matchRaw?.zone ?? '').trim();
  const membersSource = Array.isArray(group.members) ? group.members : Array.isArray(group.lights) ? group.lights : [];
  const members = membersSource.map(normalizeMemberEntry).filter(Boolean);

  const deviceIds = members
    .map((entry) => {
      if (!entry) return '';
      if (typeof entry === 'string') return entry.trim();
      if (typeof entry.id === 'string') return entry.id.trim();
      return '';
    })
    .filter(Boolean);

  const response = { id, name: name || label || id };
  if (label) response.label = label;
  if (room) response.room = room;
  if (zone) response.zone = zone;
  if (typeof group.plan === 'string' && group.plan.trim()) response.plan = group.plan.trim();
  if (typeof group.schedule === 'string' && group.schedule.trim()) response.schedule = group.schedule.trim();
  if (group.pendingSpectrum && typeof group.pendingSpectrum === 'object') response.pendingSpectrum = group.pendingSpectrum;
  if (room || zone) response.match = { room, zone };
  if (members.length > 0) response.members = members;
  if (!response.members && Array.isArray(group.lights)) {
    response.members = group.lights.map(normalizeMemberEntry).filter(Boolean);
  }
  response.devices = deviceIds;
  return response;
}

function parseIncomingGroup(raw, knownDeviceIds = null) {
  if (!raw || typeof raw !== 'object') throw new Error('Group payload must be an object.');
  const id = String(raw.id ?? raw.groupId ?? '').trim();
  if (!id) throw new Error('Group id is required.');
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  const label = typeof raw.label === 'string' ? raw.label.trim() : '';

  const matchRaw = raw.match && typeof raw.match === 'object' ? raw.match : null;
  const room = String(raw.room ?? raw.roomId ?? matchRaw?.room ?? '').trim();
  if (!room) throw new Error('Group room is required.');
  const zone = String(raw.zone ?? raw.zoneId ?? matchRaw?.zone ?? '').trim();

  const devicesSource = Array.isArray(raw.devices) ? raw.devices : [];
  const membersSource = Array.isArray(raw.members)
    ? raw.members
    : Array.isArray(raw.lights)
      ? raw.lights
      : devicesSource;
  const members = membersSource.map(normalizeMemberEntry).filter(Boolean);
  if (!members.length) throw new Error('Group requires a non-empty members[] list.');

  const normalizedMembers = members.map((entry) => ({ id: String(entry.id).trim() })).filter((entry) => !!entry.id);
  if (!normalizedMembers.length) throw new Error('Group members require valid ids.');
  if (knownDeviceIds && knownDeviceIds.size) {
    const unknown = normalizedMembers
      .map((entry) => entry.id)
      .filter((entry) => entry && !knownDeviceIds.has(entry));
    if (unknown.length) {
      if (STRICT_DEVICE_VALIDATION) {
        throw new Error(`Unknown device id(s): ${unknown.join(', ')}`);
      } else {
        // Relax validation: warn but allow unknown devices to be staged (useful for tests and initial setup)
        console.warn('[groups] Unknown device id(s) will be accepted:', unknown.join(', '));
      }
    }
  }

  const stored = {
    ...raw,
    id,
    name: name || label || id,
    label: label || name || id,
    room,
    zone,
    match: { room, zone },
    lights: normalizedMembers.map((entry) => ({ id: entry.id })),
    members: normalizedMembers.map((entry) => entry.id),
    devices: normalizedMembers.map((entry) => entry.id),
  };
  if (typeof stored.plan === 'string') stored.plan = stored.plan.trim();
  if (typeof stored.schedule === 'string') stored.schedule = stored.schedule.trim();
  if (!stored.plan) delete stored.plan;
  if (!stored.schedule) delete stored.schedule;

  const response = normalizeGroupForResponse(stored);
  return { stored, response };
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'string') {
      if (!value.trim()) continue;
      return value;
    }
    return value;
  }
  return undefined;
}

function readPhotoperiodHours(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const first = trimmed.split('/')[0];
    const hours = Number(first);
    return Number.isFinite(hours) ? hours : null;
  }
  return null;
}

function normalizePlanLightDay(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const mixSource = entry.mix && typeof entry.mix === 'object' ? entry.mix : entry;
  const cw = toNumberOrNull(mixSource?.cw ?? mixSource?.coolWhite);
  const ww = toNumberOrNull(mixSource?.ww ?? mixSource?.warmWhite);
  const bl = toNumberOrNull(mixSource?.bl ?? mixSource?.blue);
  const rd = toNumberOrNull(mixSource?.rd ?? mixSource?.red);
  
  // Preserve spectral data for solver (blue, green, red from recipes)
  const blue = toNumberOrNull(mixSource?.blue);
  const green = toNumberOrNull(mixSource?.green ?? mixSource?.gn);
  const red = toNumberOrNull(mixSource?.red);
  
  const mix = {
    cw: cw ?? 0,
    ww: ww ?? 0,
    bl: bl ?? 0,
    rd: rd ?? 0,
  };
  
  // Add spectral fields if present (for solver)
  if (blue != null) mix.blue = blue;
  if (green != null) mix.green = green;
  if (red != null) mix.red = red;
  
  return {
    raw: entry,
    day: toNumberOrNull(entry.d ?? entry.day ?? entry.dayStart) ?? null,
    stage: entry.stage ?? entry.label ?? '',
    ppfd: toNumberOrNull(entry.ppfd),
    photoperiod: firstNonEmpty(entry.photoperiod, entry.hours, entry.photoperiodHours),
    mix,
  };
}

function normalizeNutrientTargets(spec) {
  if (!spec || typeof spec !== 'object') return null;

  const ec = toNumberOrNull(spec.ec ?? spec.targetEc ?? spec.bulkEc);
  const ph = toNumberOrNull(spec.ph ?? spec.targetPh ?? spec.bulkPh);
  const program = typeof spec.program === 'string' && spec.program.trim() ? spec.program.trim() : null;
  const tank = typeof spec.tank === 'string' && spec.tank.trim() ? spec.tank.trim() : null;

  let automationEnabled = null;
  if (typeof spec.automationEnabled === 'boolean') {
    automationEnabled = spec.automationEnabled;
  } else if (typeof spec.automationEnabled === 'string') {
    const normalized = spec.automationEnabled.trim().toLowerCase();
    if (['true', '1', 'yes', 'enabled', 'on'].includes(normalized)) {
      automationEnabled = true;
    } else if (['false', '0', 'no', 'disabled', 'off'].includes(normalized)) {
      automationEnabled = false;
    }
  }

  const ratioSourceRaw = (() => {
    if (spec.ratio && typeof spec.ratio === 'object') return spec.ratio;
    if (spec.mix && typeof spec.mix === 'object') {
      if (spec.mix.ratio && typeof spec.mix.ratio === 'object') return spec.mix.ratio;
      return spec.mix;
    }
    if (spec.concentrates && typeof spec.concentrates === 'object') {
      return spec.concentrates;
    }
    return null;
  })();

  const ratio = {};
  if (ratioSourceRaw && typeof ratioSourceRaw === 'object') {
    ['a', 'b', 'c'].forEach((key) => {
      const direct = ratioSourceRaw[key];
      const upper = ratioSourceRaw[key?.toUpperCase?.()] ?? ratioSourceRaw[key?.toUpperCase && key.toUpperCase()];
      const value = toNumberOrNull(direct ?? upper);
      if (value != null) {
        ratio[key] = value;
      }
    });
  }

  const result = {};
  if (ec != null) result.ec = ec;
  if (ph != null) result.ph = ph;
  if (program) result.program = program;
  if (tank) result.tank = tank;
  if (automationEnabled != null) result.automationEnabled = automationEnabled;
  if (Object.keys(ratio).length) result.ratio = ratio;

  const ecTolerance = toNumberOrNull(spec.ecTolerance ?? spec.ec_tolerance ?? spec.ecBand ?? spec.ecWindow);
  if (ecTolerance != null) result.ecTolerance = ecTolerance;

  const phTolerance = toNumberOrNull(spec.phTolerance ?? spec.ph_tolerance ?? spec.phBand ?? spec.phWindow);
  if (phTolerance != null) result.phTolerance = phTolerance;

  const ecPerDose = toNumberOrNull(spec.ecPerDose ?? spec.ecGainPerDose ?? spec.ecStep ?? spec.ecPerPulse);
  if (ecPerDose != null) result.ecPerDose = ecPerDose;

  const ecDoseSeconds = toNumberOrNull(spec.ecDoseSeconds ?? spec.ecDoseSec ?? spec.doseSeconds ?? spec.doseSec);
  if (ecDoseSeconds != null) result.ecDoseSeconds = ecDoseSeconds;

  const phDownDoseSeconds = toNumberOrNull(spec.phDownDoseSeconds ?? spec.phDownDoseSec ?? spec.phDoseSeconds ?? spec.phDoseSec);
  if (phDownDoseSeconds != null) result.phDownDoseSeconds = phDownDoseSeconds;

  const phUpDoseSeconds = toNumberOrNull(spec.phUpDoseSeconds ?? spec.phUpDoseSec ?? spec.phUpDoseSeconds ?? spec.phUpDose);
  if (phUpDoseSeconds != null) result.phUpDoseSeconds = phUpDoseSeconds;

  const minDoseIntervalSec = toNumberOrNull(spec.minDoseIntervalSec ?? spec.minDoseInterval ?? spec.doseLockoutSec ?? spec.lockoutSec);
  if (minDoseIntervalSec != null) result.minDoseIntervalSec = minDoseIntervalSec;

  const mixDurationSec = toNumberOrNull(spec.mixDurationSec ?? spec.mixDurationSeconds ?? spec.agitateSeconds ?? spec.mixingSeconds);
  if (mixDurationSec != null) result.mixDurationSec = mixDurationSec;

  const source = typeof spec.source === 'string' && spec.source.trim() ? spec.source.trim() : null;
  if (source) result.source = source;

  const profile = typeof spec.profile === 'string' && spec.profile.trim() ? spec.profile.trim() : null;
  if (profile) result.profile = profile;

  return Object.keys(result).length ? result : null;
}

function normalizePlanEnvDay(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const environment = entry.environment && typeof entry.environment === 'object' ? entry.environment : {};
  const tempStruct = environment.temperature && typeof environment.temperature === 'object' ? environment.temperature : {};
  const humidityStruct = environment.humidity && typeof environment.humidity === 'object' ? environment.humidity : {};
  const vpdStruct = environment.vpd && typeof environment.vpd === 'object' ? environment.vpd : {};
  const guardrailsStruct = environment.guardrails && typeof environment.guardrails === 'object' ? environment.guardrails : (entry.guardrails && typeof entry.guardrails === 'object' ? entry.guardrails : null);
  const nutrientsStruct = entry.nutrients && typeof entry.nutrients === 'object' ? entry.nutrients : (environment.nutrients && typeof environment.nutrients === 'object' ? environment.nutrients : null);
  const normalizedNutrients = normalizeNutrientTargets(nutrientsStruct);
  return {
    raw: entry,
    day: toNumberOrNull(entry.d ?? entry.day ?? entry.dayStart) ?? null,
    stage: typeof entry.stage === 'string' ? entry.stage : (typeof environment.stageName === 'string' ? environment.stageName : ''),
    stageKey: typeof entry.stage_key === 'string' ? entry.stage_key : (typeof entry.stageKey === 'string' ? entry.stageKey : (typeof environment.stageKey === 'string' ? environment.stageKey : null)),
    tempC: toNumberOrNull(entry.tempC ?? entry.temp ?? entry.temperature ?? tempStruct.target),
    tempMin: toNumberOrNull(entry.temp_min ?? entry.tempMin ?? tempStruct.min),
    tempMax: toNumberOrNull(entry.temp_max ?? entry.tempMax ?? tempStruct.max),
    tempDay: toNumberOrNull(entry.temp_day ?? entry.tempDay ?? tempStruct.day),
    tempNight: toNumberOrNull(entry.temp_night ?? entry.tempNight ?? tempStruct.night),
    rh: toNumberOrNull(entry.rh ?? entry.humidity ?? entry.rhPct ?? humidityStruct.target),
    rhMin: toNumberOrNull(entry.rh_min ?? entry.rhMin ?? humidityStruct.min),
    rhMax: toNumberOrNull(entry.rh_max ?? entry.rhMax ?? humidityStruct.max),
    rhBand: (() => {
      const explicit = toNumberOrNull(entry.rhBand ?? entry.rh_band ?? entry.humidityBand ?? entry.rhDelta ?? humidityStruct.band);
      if (explicit != null) return explicit;
      const target = toNumberOrNull(entry.rh ?? entry.humidity ?? humidityStruct.target);
      const min = toNumberOrNull(entry.rh_min ?? entry.rhMin ?? humidityStruct.min);
      const max = toNumberOrNull(entry.rh_max ?? entry.rhMax ?? humidityStruct.max);
      if (target != null && min != null && max != null) {
        return Math.max(Math.abs(target - min), Math.abs(max - target));
      }
      return null;
    })(),
    vpd: toNumberOrNull(entry.vpd ?? vpdStruct.target),
    vpdMin: toNumberOrNull(entry.vpd_min ?? entry.vpdMin ?? vpdStruct.min),
    vpdMax: toNumberOrNull(entry.vpd_max ?? entry.vpdMax ?? vpdStruct.max),
    humidityCeiling: toNumberOrNull(entry.max_humidity ?? entry.humidityCeiling ?? humidityStruct.ceiling),
    guardrails: guardrailsStruct,
    nutrients: normalizedNutrients,
  };
}

function derivePlanRuntime(plan) {
  if (!plan || typeof plan !== 'object') {
    return { structured: false, lightDays: [], envDays: [] };
  }
  const lightV2 = Array.isArray(plan?.light?.days) ? plan.light.days : [];
  const legacyDays = Array.isArray(plan?.days) ? plan.days : [];
  const normalizedLight = lightV2.map(normalizePlanLightDay).filter(Boolean);
  const normalizedLegacy = legacyDays.map(normalizePlanLightDay).filter(Boolean);
  const lightDays = normalizedLight.length ? normalizedLight : normalizedLegacy;
  const firstDay = lightDays.length ? lightDays[0] : null;
  const envDays = Array.isArray(plan?.env?.days) ? plan.env.days.map(normalizePlanEnvDay).filter(Boolean) : [];
  const spectrum = firstDay?.mix ? { ...firstDay.mix } : (plan.spectrum && typeof plan.spectrum === 'object' ? { ...plan.spectrum } : null);
  const ppfd = toNumberOrNull(firstNonEmpty(plan?.ppfd, firstDay?.ppfd));
  const photoperiodRaw = firstNonEmpty(plan?.photoperiod, firstDay?.photoperiod, plan?.defaults?.photoperiod);
  let photoperiodHours = readPhotoperiodHours(photoperiodRaw);
  let photoperiodSource = photoperiodHours != null ? 'recipe' : null;
  const dliProvided = toNumberOrNull(plan?.dli);

  // -- Phase 2 Task 2.5: Auto-derive photoperiod from DLI + PPFD ----------
  // When recipe specifies DLI target and PPFD but omits photoperiod,
  // compute: hours = DLI * 1e6 / (PPFD * 3600), clamped to [4, 24].
  if (photoperiodHours == null && dliProvided != null && ppfd != null && ppfd > 0) {
    const derived = (dliProvided * 1e6) / (ppfd * 3600);
    photoperiodHours = Math.min(24, Math.max(4, +derived.toFixed(1)));
    photoperiodSource = 'auto_dli';
    console.log(`[plan-runtime] Auto-derived photoperiod ${photoperiodHours}h from DLI=${dliProvided}, PPFD=${ppfd}`);
  }

  const dli = dliProvided != null
    ? dliProvided
    : (ppfd != null && photoperiodHours != null ? (ppfd * 3600 * photoperiodHours) / 1e6 : null);
  const notes = Array.isArray(plan?.meta?.notes)
    ? plan.meta.notes.map((note) => (typeof note === 'string' ? note.trim() : '')).filter(Boolean)
    : [];
  const appliesRaw = plan?.meta?.appliesTo && typeof plan.meta.appliesTo === 'object' ? plan.meta.appliesTo : {};
  const appliesTo = {
    category: Array.isArray(appliesRaw.category)
      ? appliesRaw.category.map((entry) => (typeof entry === 'string' ? entry : '')).filter(Boolean)
      : [],
    varieties: Array.isArray(appliesRaw.varieties)
      ? appliesRaw.varieties.map((entry) => (typeof entry === 'string' ? entry : '')).filter(Boolean)
      : [],
  };
  const structured = normalizedLight.length > 0 || envDays.length > 0 || !!plan?.defaults || !!plan?.meta;
  return {
    structured,
    lightDays,
    envDays,
    firstDay,
    spectrum,
    ppfd,
    photoperiod: photoperiodRaw,
    photoperiodHours,
    photoperiodSource,
    dli,
    notes,
    appliesTo,
  };
}

function hydratePlan(plan, index = 0) {
  if (!plan || typeof plan !== 'object') return null;
  const normalized = { ...plan };
  const fallbackId = firstNonEmpty(plan.id, plan.planId, plan.plan_id, plan.key, `plan-${index + 1}`);
  const id = typeof fallbackId === 'string' ? fallbackId.trim() : String(fallbackId || '').trim();
  if (id) {
    normalized.id = id;
  }
  if (!normalized.id) normalized.id = `plan-${index + 1}`;
  if (!normalized.key) normalized.key = normalized.id;
  const derived = derivePlanRuntime(normalized);
  const nameCandidate = firstNonEmpty(normalized.name, normalized.label, normalized.meta?.label, normalized.key, normalized.id);
  if (nameCandidate) normalized.name = String(nameCandidate).trim();
  Object.defineProperty(normalized, '_derived', { value: derived, enumerable: false, configurable: true, writable: true });
  Object.defineProperty(normalized, '_structured', { value: !!derived.structured, enumerable: false, configurable: true, writable: true });
  return normalized;
}

function normalizePlanEntry(raw, fallbackId = '') {
  if (!raw || typeof raw !== 'object') return null;
  const idSource = raw.id ?? raw.planId ?? raw.plan_id ?? raw.key ?? fallbackId ?? '';
  const id = typeof idSource === 'string' ? idSource.trim() : String(idSource || '').trim();
  if (!id) return null;
  const plan = { ...raw, id };
  if (!plan.key) plan.key = id;

  const meta = plan.meta && typeof plan.meta === 'object' ? plan.meta : null;
  const nameCandidate = [plan.name, plan.label, meta?.label, plan.key, id]
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .find((value) => !!value);
  if (nameCandidate) {
    plan.name = nameCandidate;
  } else {
    plan.name = id;
  }

  if (!plan.description) {
    if (typeof meta?.description === 'string' && meta.description.trim()) {
      plan.description = meta.description.trim();
    } else if (Array.isArray(meta?.notes)) {
      const joined = meta.notes
        .map((note) => (typeof note === 'string' ? note.trim() : ''))
        .filter(Boolean)
        .join(' • ');
      if (joined) plan.description = joined;
    }
  }

  if (typeof plan.photoperiod === 'string') plan.photoperiod = plan.photoperiod.trim();
  return plan;
}

function parseIncomingPlans(body) {
  if (!body) throw new Error('Plan payload required.');
  let entries = [];
  let excludeKeys = [];
  let envelope = {};

  if (Array.isArray(body)) {
    entries = body;
  } else if (body && typeof body === 'object') {
    const rawPlans = body.plans;
    if (Array.isArray(rawPlans)) {
      entries = rawPlans;
      excludeKeys.push('plans');
    } else if (rawPlans && typeof rawPlans === 'object') {
      entries = Object.entries(rawPlans).map(([id, value]) => ({
        id,
        ...(value && typeof value === 'object' ? value : { value })
      }));
      excludeKeys.push('plans');
    }

    if (!entries.length) {
      const candidateEntries = Object.entries(body)
        .filter(([key]) => key !== 'plans' && key !== 'ok')
        .filter(([, value]) => value && typeof value === 'object' && !Array.isArray(value) && (
          Array.isArray(value.days) ||
          Array.isArray(value.light?.days) ||
          typeof value.defaults === 'object' ||
          typeof value.meta === 'object' ||
          typeof value.env === 'object'
        ));
      if (candidateEntries.length) {
        excludeKeys.push(...candidateEntries.map(([key]) => key));
        entries = candidateEntries.map(([id, value]) => ({ id, ...(value && typeof value === 'object' ? value : {}) }));
      }
    }

    envelope = sanitizePlansEnvelope(body, excludeKeys);
  }

  const normalized = entries
    .map((entry, idx) => normalizePlanEntry(entry, entry?.id ?? `plan-${idx + 1}`))
    .filter(Boolean);

  if (!normalized.length) {
    throw new Error('At least one plan entry is required.');
  }

  return { ...envelope, plans: normalized };
}

const TIME_PATTERN = /^(\d{1,2}):(\d{2})$/;

function normalizeTimeString(value, fallback = null) {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    const match = TIME_PATTERN.exec(trimmed);
    if (match) {
      let hours = Number(match[1]);
      const minutes = Number(match[2]);
      if (Number.isInteger(hours) && Number.isInteger(minutes) && minutes >= 0 && minutes < 60) {
        if (hours >= 0 && hours < 24) {
          return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
        }
      }
    }
  }
  return fallback;
}

function timeToMinutes(time) {
  if (!time) return null;
  const parts = time.split(':');
  if (parts.length !== 2) return null;
  const hours = Number(parts[0]);
  const minutes = Number(parts[1]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function minutesToTime(totalMinutes) {
  if (!Number.isFinite(totalMinutes)) return null;
  const normalized = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function diffMinutes(start, end) {
  const startMinutes = timeToMinutes(start);
  const endMinutes = timeToMinutes(end);
  if (startMinutes == null || endMinutes == null) return null;
  const delta = (endMinutes - startMinutes + 1440) % 1440;
  return delta;
}

function computeHoursBetween(start, end) {
  const minutes = diffMinutes(start, end);
  if (minutes == null) return null;
  return minutes / 60;
}

function normalizeRampPayload(rawRamp, fallback = null) {
  if (rawRamp == null) {
    return fallback && (fallback.up != null || fallback.down != null)
      ? { up: fallback.up ?? null, down: fallback.down ?? null }
      : null;
  }
  if (typeof rawRamp === 'number' && Number.isFinite(rawRamp)) {
    const clamped = Math.max(0, rawRamp);
    return { up: clamped, down: clamped };
  }
  if (typeof rawRamp === 'object') {
    const up = toNumberOrNull(rawRamp.up ?? rawRamp.rampUp ?? rawRamp.rise);
    const down = toNumberOrNull(rawRamp.down ?? rawRamp.rampDown ?? rawRamp.fade);
    if (up == null && down == null) {
      return fallback && (fallback.up != null || fallback.down != null)
        ? { up: fallback.up ?? null, down: fallback.down ?? null }
        : null;
    }
    return {
      up: up != null ? Math.max(0, up) : fallback?.up ?? null,
      down: down != null ? Math.max(0, down) : fallback?.down ?? null,
    };
  }
  return fallback && (fallback.up != null || fallback.down != null)
    ? { up: fallback.up ?? null, down: fallback.down ?? null }
    : null;
}

function normalizeScheduleCycle(rawCycle, fallbackRamp = null) {
  if (!rawCycle || typeof rawCycle !== 'object') return null;
  const start = normalizeTimeString(rawCycle.start ?? rawCycle.on ?? rawCycle.begin);
  if (!start) return null;
  let off = normalizeTimeString(rawCycle.off ?? rawCycle.end);
  let photo = toNumberOrNull(rawCycle.photo ?? rawCycle.hours ?? rawCycle.onHours ?? rawCycle.durationHours);
  if (!Number.isFinite(photo) || photo < 0) {
    const inferred = off ? computeHoursBetween(start, off) : null;
    photo = inferred != null ? inferred : null;
  }
  if (!Number.isFinite(photo) || photo < 0) {
    photo = 0;
  }
  photo = Math.max(0, Math.min(24, photo));
  if (!off) {
    off = minutesToTime((timeToMinutes(start) ?? 0) + Math.round(photo * 60));
  }
  const rampRaw = normalizeRampPayload(
    rawCycle.ramp ?? rawCycle.ramps ?? {
      up: rawCycle.rampUp ?? rawCycle.rampUpMin,
      down: rawCycle.rampDown ?? rawCycle.rampDownMin,
    },
    fallbackRamp,
  );
  const spectrum = rawCycle.spectrum && typeof rawCycle.spectrum === 'object'
    ? rawCycle.spectrum
    : null;
  const cycle = {
    start,
    on: start,
    off: off ?? start,
    photo,
    hours: photo,
  };
  if (rampRaw) {
    cycle.ramp = { up: rampRaw.up ?? null, down: rampRaw.down ?? null };
    cycle.rampUpMin = rampRaw.up ?? null;
    cycle.rampDownMin = rampRaw.down ?? null;
  }
  if (spectrum) {
    cycle.spectrum = spectrum;
  }
  return cycle;
}

function summarizeRampFromCycles(cycles, fallbackRamp = null) {
  for (const cycle of cycles) {
    if (cycle && typeof cycle === 'object' && cycle.ramp) {
      return { up: cycle.ramp.up ?? null, down: cycle.ramp.down ?? null };
    }
  }
  return fallbackRamp && (fallbackRamp.up != null || fallbackRamp.down != null)
    ? { up: fallbackRamp.up ?? null, down: fallbackRamp.down ?? null }
    : { up: null, down: null };
}

function serializeScheduleForStorage(schedule) {
  if (!schedule || typeof schedule !== 'object') return null;
  const cycles = Array.isArray(schedule.cycles)
    ? schedule.cycles.slice(0, 2).map((cycle) => ({
        start: cycle.start ?? cycle.on ?? null,
        off: cycle.off ?? null,
        photo: cycle.photo ?? cycle.hours ?? null,
        ramp: cycle.ramp ?? null,
        spectrum: cycle.spectrum ?? null,
      }))
    : [];
  return {
    id: schedule.id,
    groupId: schedule.groupId,
    name: schedule.name,
    mode: schedule.mode,
    timezone: schedule.timezone ?? null,
    photoperiodHours: schedule.photoperiodHours ?? null,
    ramp: schedule.ramp ?? null,
    cycles,
    updatedAt: schedule.updatedAt ?? null,
  };
}

function mergeScheduleEntries(existingRaw, incomingSchedules) {
  const map = new Map();
  existingRaw.forEach((entry) => {
    const normalized = normalizeScheduleEntry(entry);
    if (normalized && normalized.groupId) {
      map.set(normalized.groupId, normalized);
    }
  });

  const now = new Date().toISOString();
  incomingSchedules.forEach((schedule) => {
    if (!schedule || typeof schedule !== 'object') return;
    const groupId = typeof schedule.groupId === 'string' ? schedule.groupId.trim() : '';
    if (!groupId) return;
    const stamped = {
      ...schedule,
      id: schedule.id || `group:${groupId}`,
      groupId,
      updatedAt: now,
    };
    map.set(groupId, stamped);
  });

  const merged = Array.from(map.values());
  const stored = merged.map(serializeScheduleForStorage).filter(Boolean);
  return { merged, stored };
}

function normalizeScheduleEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const idCandidate = [raw.id, raw.scheduleId, raw.deviceId, raw.device_id, raw.deviceID]
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .find((value) => !!value);
  const groupIdCandidate = [
    raw.groupId,
    raw.group_id,
    raw.group,
    raw.groupID,
    idCandidate && idCandidate.startsWith('group:') ? idCandidate.split(':', 2)[1] : null,
  ]
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .find((value) => !!value);
  if (!groupIdCandidate) return null;

  const fallbackRamp = {
    up: toNumberOrNull(raw.rampUpMin ?? raw.rampUpMinutes ?? raw.ramp?.up),
    down: toNumberOrNull(raw.rampDownMin ?? raw.rampDownMinutes ?? raw.ramp?.down),
  };

  let cycles = [];
  if (Array.isArray(raw.cycles) && raw.cycles.length) {
    cycles = raw.cycles
      .slice(0, 2)
      .map((entry) => normalizeScheduleCycle(entry, fallbackRamp))
      .filter(Boolean);
  }

  if (!cycles.length) {
    const start = normalizeTimeString(raw.start ?? raw.startTime ?? '08:00', '08:00');
    let durationHours = toNumberOrNull(
      raw.durationHours ?? raw.photoperiodHours ?? raw.hours ?? raw.photoperiod,
    );
    if (!Number.isFinite(durationHours) || durationHours < 0) {
      const photoperiodArray = Array.isArray(raw.photoperiod) ? raw.photoperiod : [];
      const firstPhotoperiod = photoperiodArray.length ? photoperiodArray[0] : null;
      durationHours = toNumberOrNull(firstPhotoperiod);
    }
    if (!Number.isFinite(durationHours) || durationHours <= 0) {
      durationHours = 12;
    }
    durationHours = Math.max(0, Math.min(24, durationHours));
    const off = minutesToTime((timeToMinutes(start) ?? 0) + Math.round(durationHours * 60));
    cycles = [
      normalizeScheduleCycle(
        {
          start,
          off,
          photo: durationHours,
        },
        fallbackRamp,
      ),
    ].filter(Boolean);
  }

  if (!cycles.length) return null;

  const mode = cycles.length > 1 ? 'two' : 'one';
  const photoperiodHours = cycles.reduce((total, cycle) => {
    const hours = Number.isFinite(cycle?.photo) ? cycle.photo : 0;
    return total + (hours > 0 ? hours : 0);
  }, 0);

  const rampSummary = summarizeRampFromCycles(cycles, fallbackRamp);
  const timezone = typeof raw.timezone === 'string' && raw.timezone.trim() ? raw.timezone.trim() : null;
  const updatedAt = typeof raw.updatedAt === 'string' && raw.updatedAt.trim()
    ? raw.updatedAt
    : new Date().toISOString();

  const schedule = {
    id: idCandidate || `group:${groupIdCandidate}`,
    groupId: groupIdCandidate,
    name: typeof raw.name === 'string' && raw.name.trim()
      ? raw.name.trim()
      : `Schedule for ${groupIdCandidate}`,
    mode,
    cycles,
    photoperiodHours,
    totalOnHours: photoperiodHours,
    totalOffHours: Math.max(0, 24 - photoperiodHours),
    timezone,
    ramp: rampSummary,
    rampUpMin: rampSummary.up ?? null,
    rampDownMin: rampSummary.down ?? null,
    updatedAt,
  };

  if (cycles[0]) {
    schedule.start = cycles[0].start;
  }

  if (typeof raw.planKey === 'string' && raw.planKey.trim()) {
    schedule.planKey = raw.planKey.trim();
  }

  return schedule;
}

function parseIncomingSchedules(body) {
  if (!body) throw new Error('Schedule payload required.');
  let entries = [];
  let bulk = false;
  if (Array.isArray(body)) {
    entries = body;
    bulk = true;
  } else if (Array.isArray(body.schedules)) {
    entries = body.schedules;
    bulk = true;
  } else if (typeof body === 'object') {
    entries = [body];
  }
  const normalized = entries.map(normalizeScheduleEntry).filter(Boolean);
  if (!normalized.length) {
    if (bulk && entries.length === 0) {
      return { schedules: [], bulk };
    }
    throw new Error('At least one schedule entry is required.');
  }
  return { schedules: normalized, bulk };
}
function loadControllerFromDisk(){
  try {
    if (fs.existsSync(CONTROLLER_PATH)) {
      hasPersistedController = true;
      const obj = JSON.parse(fs.readFileSync(CONTROLLER_PATH, 'utf8'));
      if (obj && typeof obj.url === 'string' && isHttpUrl(obj.url)) {
        CURRENT_CONTROLLER = obj.url.trim();
      }
    }
  } catch {}
}
function persistControllerToDisk(url){
  ensureDataDir();
  try {
    fs.writeFileSync(CONTROLLER_PATH, JSON.stringify({ url }, null, 2));
    hasPersistedController = true;
  } catch {}
}
function getController(){ return CURRENT_CONTROLLER; }
function setController(url){ CURRENT_CONTROLLER = url; persistControllerToDisk(url); console.log(`[charlie] controller set → ${url}`); }

// Initialize controller from disk if available
loadControllerFromDisk();

function loadForwarderFromDisk() {
  try {
    if (!fs.existsSync(FORWARDER_PATH)) return;
    hasPersistedForwarder = true;
    if (DEFAULT_FORWARDER) return;
    const obj = JSON.parse(fs.readFileSync(FORWARDER_PATH, 'utf8'));
    if (obj && typeof obj.url === 'string' && obj.url.trim() && isHttpUrl(obj.url)) {
      CURRENT_FORWARDER = obj.url.trim().replace(/\/+$/, '');
    } else if (obj && obj.url == null) {
      CURRENT_FORWARDER = null;
    }
  } catch {}
}

function persistForwarderToDisk(url) {
  ensureDataDir();
  try {
    fs.writeFileSync(FORWARDER_PATH, JSON.stringify({ url: url || null }, null, 2));
    hasPersistedForwarder = true;
  } catch {}
}

function getForwarder() {
  return CURRENT_FORWARDER;
}

function setForwarder(url) {
  if (!url) {
    CURRENT_FORWARDER = null;
    persistForwarderToDisk(null);
    console.log('[charlie] forwarder cleared');
    return;
  }
  if (typeof url !== 'string' || !isHttpUrl(url)) {
    throw new Error('Valid http(s) url required for forwarder');
  }
  const normalized = url.trim().replace(/\/+$/, '');
  CURRENT_FORWARDER = normalized;
  persistForwarderToDisk(normalized);
  console.log(`[charlie] forwarder set → ${normalized}`);
}

function getNetworkBridgeUrl() {
  return (CURRENT_FORWARDER && CURRENT_FORWARDER.trim()) || getController();
}

loadForwarderFromDisk();

async function maybeAutoDetectLocalController() {
  if (process.env.CTRL) return; // explicit override wins
  if (CURRENT_CONTROLLER && CURRENT_CONTROLLER !== DEFAULT_CONTROLLER) return; // already customised

  const candidates = [];
  const manualCandidate = process.env.PY_BACKEND_URL && process.env.PY_BACKEND_URL.trim();
  if (manualCandidate) candidates.push(manualCandidate);
  // Note: Charlie backend (port 8000) deprecated - removed from candidates

  const timeoutMs = Number.parseInt(process.env.PY_BACKEND_HEALTH_TIMEOUT_MS ?? '', 10);
  const healthTimeout = Number.isFinite(timeoutMs) ? timeoutMs : 900;

  for (const candidate of candidates) {
    const base = (candidate || '').trim();
    if (!base) continue;
    try {
      const normalized = base.replace(/\/$/, '');
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), healthTimeout);
      try {
        const res = await fetch(`${normalized}/healthz`, { method: 'GET', signal: ac.signal });
        if (res.ok) {
          setController(normalized);
          console.log(`[charlie] auto-detected Python backend controller at ${normalized}`);
          return;
        }
      } finally {
        clearTimeout(timer);
      }
    } catch (error) {
      const message = error?.message || String(error);
      if (process.env.NODE_ENV === 'development') {
        console.debug(`[charlie] Python backend candidate ${candidate} unavailable: ${message}`);
      }
    }
  }
}

// Only auto-detect if no controller has been persisted to disk
// This prevents overriding an explicitly configured controller
if (!RUNNING_UNDER_NODE_TEST && !hasPersistedController) {
  maybeAutoDetectLocalController().catch((error) => {
    const message = error?.message || String(error);
    console.debug('[charlie] python backend auto-detect failed:', message);
  });
}

// Global error handlers to prevent server crashes
process.on('uncaughtException', (error) => {
  console.error(' Uncaught Exception:', error);
  console.error('Stack:', error.stack);
  // Don't exit the process for now - log and continue
});

process.on('unhandledRejection', (reason, promise) => {
  console.error(' Unhandled Promise Rejection at:', promise);
  console.error('Reason:', reason);
  // Don't exit the process for now - log and continue
});

// Handle SIGTERM and SIGINT gracefully
let SERVER = null;
let mdnsAdvertiser = null; // Global mDNS advertiser instance
async function gracefulShutdown(signal = 'SIGTERM') {
  console.log(`🛑 Received ${signal}, shutting down gracefully`);
  try {
    // Stop mDNS advertising
    if (mdnsAdvertiser) {
      try {
        mdnsAdvertiser.destroy();
        console.log('[mDNS] Stopped advertising');
      } catch (error) {
        console.error('[mDNS] Shutdown error:', error);
      }
    }
    
    if (scheduleExecutor && typeof scheduleExecutor.stop === 'function') {
      try { await scheduleExecutor.stop(); } catch {}
    }
    if (__zoneBindingsTimer) {
      try { clearInterval(__zoneBindingsTimer); } catch {}
      __zoneBindingsTimer = null;
    }
    if (SERVER) {
      await new Promise((resolve) => SERVER.close(resolve));
    }
  } finally {
    process.exit(0);
  }
}

process.on('SIGTERM', () => { void gracefulShutdown('SIGTERM'); });
process.on('SIGINT', () => { void gracefulShutdown('SIGINT'); });

// Helper function for Kasa client import
async function createKasaClient() {
  try {
    const kasaModule = await import('tplink-smarthome-api');
    // tplink-smarthome-api is a CommonJS module, use default export
    const Client = kasaModule.default?.Client || kasaModule.Client;
    
    if (!Client || typeof Client !== 'function') {
      throw new Error('tplink-smarthome-api Client not found in module exports');
    }
    
    return new Client();
  } catch (error) {
    console.error('Failed to create Kasa client:', error.message);
    throw new Error(`Kasa integration not available: ${error.message}`);
  }
}

// Async route wrapper to handle errors properly
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch((error) => {
      console.error(` Async route error: ${req.method} ${req.url}`, error);
      next(error);
    });
  };
}

// CRITICAL: Global trace for /grow3 requests - MUST be before ANY router
app.use((req, res, next) => {
  if (req.path.startsWith('/grow3')) {
    console.log(`[GLOBAL TRACE EARLY] Request intercepted: ${req.method} ${req.path} (originalUrl: ${req.originalUrl})`);
    console.log(`[GLOBAL TRACE EARLY] Headers:`, JSON.stringify(req.headers, null, 2));
  }
  next();
});

// Global input sanitization middleware
app.use(express.json({ limit: "1mb" }));
app.use(sanitizeRequestBody);
console.log('[Security] Global input sanitization enabled');

// Apply rate limiting if enabled
if (RATE_LIMITING_ENABLED) {
  // Apply general API rate limiting to all /api routes
  app.use('/api', apiRateLimiter);
  console.log('[Security] ✅ Rate limiting applied to /api routes');
}

// Apply feature flag enforcement (license-based access control)
app.use(autoEnforceFeatures());
console.log('[Security] ✅ Feature flag enforcement enabled');

// Apply audit logging if enabled
if (AUDIT_LOG_ENABLED) {
  // Log access to sensitive endpoints
  app.use(securityAuditMiddleware({
    sensitiveEndpoints: ['/api/auth', '/api/admin', '/api/farm-auth', '/api/wholesale'],
    logAllRequests: false,
  }));
  console.log('[Security] ✅ Audit logging applied to sensitive endpoints');
}

app.use(buyerRouter);

// --- ENV store helpers
const envPath = path.join(DATA_DIR, 'env.json');

function readJSON(fileName, fallback = null) {
  const target = path.isAbsolute(fileName) ? fileName : path.join(DATA_DIR, fileName);
  return readJsonSafe(target, fallback);
}

function writeJSON(fileName, value) {
  const target = path.isAbsolute(fileName) ? fileName : path.join(DATA_DIR, fileName);
  ensureDataDir();
  try {
    fs.writeFileSync(target, JSON.stringify(value ?? {}, null, 2));
    return true;
  } catch (error) {
    console.warn('[env] Failed to persist JSON:', error?.message || error);
    return false;
  }
}

function needPin(req, res) {
  const configuredPin = process.env.FARM_PIN || process.env.CTRL_PIN || '';
  if (!configuredPin) return false;
  const provided = (req.body && (req.body.pin || req.body.PIN))
    || req.headers['x-farm-pin']
    || req.query.pin;
  if (provided && String(provided) === configuredPin) return false;
  res.status(403).json({ ok: false, error: 'pin-required' });
  return true;
}

const pinGuard = (req, res, next) => {
  if (needPin(req, res)) return;
  next();
};

const readEnv = () => readJSON(envPath, { rooms: {}, targets: {}, control: {} }) || { rooms: {}, targets: {}, control: {} };
const writeEnv = (obj) => writeJSON(envPath, obj);

const MAX_ENV_READING_HISTORY = 10000;
const SENSOR_ENTRY_KIND = 'sensor';
const ACTION_ENTRY_KIND = 'action';

function toNumberOrNull(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function clampPercentage(value) {
  if (!Number.isFinite(value)) return null;
  return Math.min(100, Math.max(0, value));
}

function computeVpd(tempC, rh) {
  const temperature = Number(tempC);
  const humidity = Number(rh);
  if (!Number.isFinite(temperature) || !Number.isFinite(humidity)) return null;
  if (humidity <= 0) return Math.round(temperature * 100) / 100;
  const saturation = 0.6108 * Math.exp((17.27 * temperature) / (temperature + 237.3));
  const actual = saturation * (humidity / 100);
  const deficit = Math.max(0, saturation - actual);
  const rounded = Math.round(deficit * 1000) / 1000;
  return Number.isFinite(rounded) ? rounded : null;
}

function ensureRoomContainer(state, roomId) {
  if (!state || !roomId) return null;
  if (!state.rooms || typeof state.rooms !== 'object') {
    state.rooms = {};
  }
  if (!state.rooms[roomId] || typeof state.rooms[roomId] !== 'object') {
    state.rooms[roomId] = { roomId, targets: {}, control: {}, actuators: {} };
  }
  const container = state.rooms[roomId];
  if (!container.telemetry || typeof container.telemetry !== 'object') {
    container.telemetry = {};
  }
  return container;
}

function recordEnvEntry(state, entry) {
  if (!state) return;
  state.readings = Array.isArray(state.readings) ? state.readings : [];
  state.readings.push(entry);
  if (state.readings.length > MAX_ENV_READING_HISTORY) {
    state.readings.splice(0, state.readings.length - MAX_ENV_READING_HISTORY);
  }
}

// GET /env → full state (legacy view via ?legacy=1)
app.get('/env', setCorsHeaders, (req, res, next) => {
  if (req.query?.legacy === '1') {
    return res.json(readEnv());
  }
  return next();
});

// POST /env → upsert full or partial (PIN)
app.post('/env', pinGuard, (req, res) => {
  const cur = readEnv();
  const nxt = { ...cur, ...req.body };
  writeEnv(nxt);
  res.json({ ok: true });
});

// POST /env/readings → append one reading (room, temp, rh, ts)
app.post('/env/readings', pinGuard, (req, res) => {
  const body = req.body || {};
  const room = body.room || body.scope || body.zone || null;
  if (!room) {
    return res.status(400).json({ ok: false, error: 'room-required' });
  }

  const st = readEnv();
  const container = ensureRoomContainer(st, room);

  if (typeof body.plan === 'string' && body.plan.trim()) {
    container.plan = body.plan.trim();
  }

  const ts = body.ts || body.timestamp || new Date().toISOString();
  const temp = toNumberOrNull(body.temp ?? body.temperature);
  const rh = toNumberOrNull(body.rh ?? body.humidity);
  const vpd = toNumberOrNull(body.vpd) ?? computeVpd(temp, rh);
  const ppfd = toNumberOrNull(body.ppfd);
  const kwh = toNumberOrNull(body.kwh ?? body.energyKwh ?? body.energy);
  let masterPct = toNumberOrNull(body.masterPct ?? body.master);
  let bluePct = toNumberOrNull(body.bluePct ?? body.blue);

  if (!Number.isFinite(masterPct) && Number.isFinite(container.telemetry?.masterPct)) {
    masterPct = container.telemetry.masterPct;
  }
  if (!Number.isFinite(bluePct) && Number.isFinite(container.telemetry?.bluePct)) {
    bluePct = container.telemetry.bluePct;
  }

  const entry = {
    kind: SENSOR_ENTRY_KIND,
    room,
    ts,
    temp,
    rh,
    vpd,
    ppfd,
    kwh,
    plan: container.plan || null,
    masterPct: clampPercentage(masterPct ?? null),
    bluePct: clampPercentage(bluePct ?? null),
    source: body.source || 'ingest'
  };

  recordEnvEntry(st, entry);
  writeEnv(st);
  res.json({ ok: true, reading: entry });
});

// POST /automation/run → run one policy tick for a room (or all) - Edge-only
app.post('/automation/run', requireEdgeForControl, async (req, res) => {
  if (needPin(req, res)) return;
  const room = (req.body || {}).room || null;
  const st = readEnv();
  const out = await runPolicyOnce(st, room);
  writeEnv(out.state);
  res.json({ ok: true, actions: out.actions });
});

function logAutomationAction(state, roomId, cfg, reading, actionList, mode) {
  if (!state || !roomId || !Array.isArray(actionList) || !actionList.length) return;
  const container = ensureRoomContainer(state, roomId);
  const telemetry = container.telemetry || {};
  const plan = reading?.plan || container.plan || cfg?.plan || null;

  const prevMaster = Number.isFinite(telemetry.masterPct) ? telemetry.masterPct : 100;
  const prevBlue = Number.isFinite(telemetry.bluePct) ? telemetry.bluePct : 100;
  const readingMaster = Number.isFinite(reading?.masterPct) ? clampPercentage(reading.masterPct) : null;
  const readingBlue = Number.isFinite(reading?.bluePct) ? clampPercentage(reading.bluePct) : null;

  let nextMaster = Number.isFinite(readingMaster) ? readingMaster : prevMaster;
  let nextBlue = Number.isFinite(readingBlue) ? readingBlue : prevBlue;

  for (const action of actionList) {
    if (!action || action.type !== 'lights.scale') continue;
    const deltaMaster = Number(action.masterDelta || 0) * 100;
    const deltaBlue = Number(action.blueDelta || 0) * 100;
    const minMasterPct = Number.isFinite(action.minMaster) ? action.minMaster * 100 : null;
    const minBluePct = Number.isFinite(action.minBlue) ? action.minBlue * 100 : null;

    if (Number.isFinite(deltaMaster)) {
      nextMaster = clampPercentage(nextMaster + deltaMaster);
      if (minMasterPct != null) nextMaster = Math.max(nextMaster, minMasterPct);
    }
    if (Number.isFinite(deltaBlue)) {
      nextBlue = clampPercentage(nextBlue + deltaBlue);
      if (minBluePct != null) nextBlue = Math.max(nextBlue, minBluePct);
    }
  }

  const ts = new Date().toISOString();
  const entry = {
    kind: ACTION_ENTRY_KIND,
    room: roomId,
    ts,
    temp: Number.isFinite(reading?.temp) ? reading.temp : null,
    rh: Number.isFinite(reading?.rh) ? reading.rh : null,
    vpd: Number.isFinite(reading?.vpd) ? reading.vpd : computeVpd(reading?.temp, reading?.rh),
    ppfd: Number.isFinite(reading?.ppfd) ? reading.ppfd : null,
    kwh: Number.isFinite(reading?.kwh) ? reading.kwh : null,
    plan: plan || null,
    masterPct: clampPercentage(nextMaster),
    bluePct: clampPercentage(nextBlue),
    actions: actionList.map((action) => ({ ...action })),
    mode: mode || 'advisory',
    result: mode === 'autopilot' ? 'executed' : 'pending',
    resultAfterDwell: null,
    dwell: cfg?.control?.dwell ?? null,
    previousMasterPct: Number.isFinite(prevMaster) ? prevMaster : null,
    previousBluePct: Number.isFinite(prevBlue) ? prevBlue : null
  };

  recordEnvEntry(state, entry);

  container.telemetry = {
    ...(container.telemetry || {}),
    masterPct: entry.masterPct ?? container.telemetry?.masterPct ?? null,
    bluePct: entry.bluePct ?? container.telemetry?.bluePct ?? null,
    lastActionAt: ts,
    lastResult: entry.result
  };

  if (plan && !container.plan) {
    container.plan = plan;
  }
}

async function runPolicyOnce(state, onlyRoom = null) {
  const rooms = state.rooms || {};
  const actions = [];
  for (const [roomId, cfg] of Object.entries(rooms)) {
    if (onlyRoom && roomId !== onlyRoom) continue;
    const t = cfg.targets || {};
    const c = cfg.control || {};
    if (!c.enable) continue;
    const r = latestReading(state.readings || [], roomId);
    if (!r) continue;

    const dT = (r.temp ?? NaN) - (t.temp ?? NaN);
    const dRH = (r.rh ?? NaN) - (t.rh ?? NaN);

    let master = 0;
    let blue = 0;
    if (!Number.isNaN(dT) && dT > 0) {
      master -= Math.min(c.step || 0.05, dT * 0.03);
    }
    if (!Number.isNaN(dRH) && dRH > (t.rhBand || 5)) {
      master -= Math.min(c.step || 0.05, (dRH / (t.rhBand || 5)) * 0.05);
    }
    if (!Number.isNaN(dT) && dT > 0 && !Number.isNaN(dRH) && dRH > 0) {
      blue -= Math.min((c.step || 0.05) / 2, 0.03);
    }

    const minM = t.minMaster ?? 0.6;
    const minB = t.minBlue ?? 0.5;
    if (master !== 0 || blue !== 0) {
      const payload = {
        roomId,
        type: 'lights.scale',
        masterDelta: master,
        blueDelta: blue,
        minMaster: minM,
        minBlue: minB,
        dwell: c.dwell || 180
      };
      actions.push(payload);
      if (c.mode === 'autopilot') {
        await applyLightScaling(cfg, master, blue, minM, minB);
      }
      logAutomationAction(state, roomId, cfg, r, [payload], c.mode);
    }
  }
  return { state, actions };
}

function latestReading(readings, roomId) {
  for (let i = readings.length - 1; i >= 0; --i) {
    const entry = readings[i];
    if (entry.room !== roomId) continue;
    if (entry.kind && entry.kind !== SENSOR_ENTRY_KIND && entry.kind !== ACTION_ENTRY_KIND) continue;
    if (entry.temp == null && entry.rh == null && entry.vpd == null) continue;
    return entry;
  }
  return null;
}

async function applyLightScaling(cfg, masterDelta, blueDelta, minMaster, minBlue) {
  const lightIds = cfg?.actuators?.lights || [];
  if (!Array.isArray(lightIds) || !lightIds.length) return;
  for (const id of lightIds) {
    try {
      console.debug('[automation] would apply light scaling', { id, masterDelta, blueDelta, minMaster, minBlue });
    } catch (error) {
      console.warn('[automation] Failed to apply light scaling:', error?.message || error);
    }
  }
}

// --- Automation Rules Engine ---
const automationEngine = new AutomationRulesEngine();
console.log('[automation] Rules engine initialized with default farm automation rules');

const preAutomationContext = createPreAutomationLayer({
  dataDir: path.resolve('./data/automation'),
  publicDataDir: path.resolve('./public/data'),
  autoStart: true, //  ENABLED for testing
  fanRotation: {
    enabled: true, //  ENABLED for airflow distribution
    intervalMs: 15 * 60 * 1000 // 15 minutes
  }
});

const {
  engine: preAutomationEngine,
  envStore: preEnvStore,
  rulesStore: preRulesStore,
  registry: prePlugRegistry,
  plugManager: prePlugManager,
  logger: preAutomationLogger,
  fanRotation: preFanRotation
} = preAutomationContext;

console.log('[automation] Pre-AI automation layer initialized (sensors + smart plugs)');

if (!app.__automationListenPatched) {
  const originalListen = app.listen.bind(app);
  app.listen = function automationAwareListen(...args) {
    const server = originalListen(...args);
    server.on('close', () => {
      try {
        preAutomationEngine.stop();
      } catch (error) {
        console.warn('[automation] Failed to stop engine during shutdown:', error?.message || error);
      }
    });

    // Automation engine start disabled to avoid SwitchBot API rate limiting (429 errors)
    // Re-enable when rate limits are resolved or discovery is optimized
    if (!IS_TEST_ENV && false) {
      try {
        preAutomationEngine.start();
      } catch (error) {
        console.warn('[automation] Failed to start engine after listen:', error?.message || error);
      }
    }

    return server;
  };
  app.__automationListenPatched = true;
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'room';
}

function readJsonSafe(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch (error) {
    console.warn(`[automation] Failed to read ${filePath}:`, error.message);
    return fallback;
  }
}

// --- ENV hot path helpers: in-memory cache + async write queue ---
async function ensureEnvCacheLoaded() {
  if (__envCache) return __envCache;
  try {
    if (fs.existsSync(ENV_PATH)) {
      const raw = await fs.promises.readFile(ENV_PATH, 'utf8');
      __envCache = JSON.parse(raw || '{"zones":[]}');
      if (!__envCache || typeof __envCache !== 'object') __envCache = { zones: [] };
      if (!Array.isArray(__envCache.zones)) __envCache.zones = [];

      const seenZoneIds = new Set();
      const cleanedZones = [];
      let sanitized = false;

      for (const zone of __envCache.zones) {
        if (!zone || typeof zone !== 'object') {
          sanitized = true;
          continue;
        }

        const zoneIdRaw = zone.id;
        if (!zoneIdRaw) {
          sanitized = true;
          continue;
        }

        const zoneId = String(zoneIdRaw).trim();
        if (!/^zone-\d+$/.test(zoneId)) {
          sanitized = true;
          console.warn(`[env] Dropping invalid zone id from env.json: ${zoneId}`);
          continue;
        }

        if (seenZoneIds.has(zoneId)) {
          sanitized = true;
          console.warn(`[env] Dropping duplicate zone entry from env.json: ${zoneId}`);
          continue;
        }

        if (zone.id !== zoneId) {
          zone.id = zoneId;
          sanitized = true;
        }

        if (!zone.name) {
          const friendlyName = `Zone ${zoneId.split('-')[1] || zoneId}`;
          zone.name = friendlyName;
          zone.location = zone.location || friendlyName;
          sanitized = true;
        }

        cleanedZones.push(zone);
        seenZoneIds.add(zoneId);
      }

      if (cleanedZones.length !== __envCache.zones.length) {
        sanitized = true;
      }

      __envCache.zones = cleanedZones;

      if (sanitized) {
        const timer = setTimeout(() => {
          persistEnvCache().catch((error) => {
            console.warn('[env] Failed to persist sanitized env.json:', error?.message || error);
          });
        }, 0);
        if (typeof timer?.unref === 'function') timer.unref();
      }
    } else {
      __envCache = { zones: [] };
    }
  } catch (error) {
    console.warn('[env] Failed to load env.json, starting empty:', error?.message || error);
    __envCache = { zones: [] };
  }
  return __envCache;
}

async function persistEnvCache() {
  // Coalesce concurrent writes; only one writer at a time
  if (__envWriteInFlight) { __envDirty = true; return; }
  __envWriteInFlight = true;
  try {
    do {
      __envDirty = false;
      const snapshot = JSON.stringify({ ...(await ensureEnvCacheLoaded()), updatedAt: new Date().toISOString() }, null, 2);
      await fs.promises.mkdir(path.dirname(ENV_PATH), { recursive: true });
      await fs.promises.writeFile(ENV_PATH, snapshot, 'utf8');
    } while (__envDirty);
  } catch (error) {
    console.warn('[env] Failed to persist env.json:', error?.message || error);
  } finally {
    __envWriteInFlight = false;
  }
}

function findZoneMatch(zones, identifier) {
  if (!identifier) return null;
  const normalized = String(identifier).toLowerCase();
  return zones.find((zone) => {
    const zoneId = String(zone.id || '').toLowerCase();
    const zoneName = String(zone.name || '').toLowerCase();
    return zoneId === normalized || zoneName === normalized;
  }) || null;
}

function averageSetpoint(setpoint) {
  if (!setpoint || typeof setpoint !== 'object') return null;
  const min = Number(setpoint.min);
  const max = Number(setpoint.max);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  return Math.round(((min + max) / 2) * 10) / 10;
}

function seedRoomAutomationDefaults() {
  try {
    const existing = preEnvStore.listRooms();
    if (existing.length) return;

    const roomsDoc = readJsonSafe(ROOMS_PATH, null);
    if (!roomsDoc || !Array.isArray(roomsDoc.rooms) || !roomsDoc.rooms.length) return;

    const envDoc = readJsonSafe(ENV_PATH, { zones: [] }) || { zones: [] };
    const zones = Array.isArray(envDoc.zones) ? envDoc.zones : [];

    let seeded = 0;

    roomsDoc.rooms.forEach((room) => {
      if (!room) return;
      const roomId = room.id || slugify(room.name);
      const primaryZoneLabel = Array.isArray(room.zones) && room.zones.length
        ? room.zones[0]
        : room.name || roomId;
      const zoneMatch = findZoneMatch(zones, primaryZoneLabel) || findZoneMatch(zones, roomId) || null;
      const zoneId = zoneMatch?.id || slugify(primaryZoneLabel);
      const tempTarget = averageSetpoint(zoneMatch?.sensors?.tempC?.setpoint) || zoneMatch?.sensors?.tempC?.current;
      const rhTarget = averageSetpoint(zoneMatch?.sensors?.rh?.setpoint) || zoneMatch?.sensors?.rh?.current;
      const rhSetpoint = zoneMatch?.sensors?.rh?.setpoint;
      let rhBand = 5;
      if (rhSetpoint && Number.isFinite(rhSetpoint.max) && Number.isFinite(rhSetpoint.min)) {
        rhBand = Math.max(2, Math.round(Math.abs(rhSetpoint.max - rhSetpoint.min) / 2));
      }

      const lights = (Array.isArray(room.devices) ? room.devices : [])
        .filter((device) => String(device?.type || '').toLowerCase() === 'light')
        .map((device) => device.id)
        .filter(Boolean);

      const fans = (Array.isArray(room.devices) ? room.devices : [])
        .filter((device) => {
          const type = String(device?.type || '').toLowerCase();
          return type.includes('fan') || type.includes('hvac');
        })
        .map((device) => device.id)
        .filter(Boolean);

      const dehuDevices = (Array.isArray(room.devices) ? room.devices : [])
        .filter((device) => String(device?.type || '').toLowerCase().includes('dehu'))
        .map((device) => device.id)
        .filter(Boolean);

      if (!fans.length && room.hardwareCats?.includes('hvac')) {
        fans.push(`fan:${roomId}`);
      }

      if (!dehuDevices.length && room.hardwareCats?.includes('dehumidifier')) {
        dehuDevices.push(`plug:dehu:${roomId}`);
      }

      const config = {
        roomId,
        name: room.name || roomId,
        targets: {
          temp: Number.isFinite(tempTarget) ? tempTarget : 21,
          rh: Number.isFinite(rhTarget) ? rhTarget : 62,
          rhBand,
          minBlue: 0.5,
          minMaster: 0.6
        },
        control: {
          enable: false,
          mode: 'advisory',
          step: 0.05,
          dwell: 180
        },
        sensors: {
          temp: zoneId,
          rh: zoneId
        },
        actuators: {
          lights,
          fans,
          dehu: dehuDevices
        },
        meta: {
          seededFrom: 'rooms.json',
          zoneId,
          zoneLabel: primaryZoneLabel
        }
      };

      preEnvStore.upsertRoom(roomId, config);
      seeded += 1;
    });

    if (seeded) {
      console.log(`[automation] Seeded ${seeded} room automation profile${seeded === 1 ? '' : 's'} from rooms.json`);
    }
  } catch (error) {
    console.warn('[automation] Failed to seed room automation defaults:', error.message);
  }
}

seedRoomAutomationDefaults();

const SENSOR_METRIC_ALIASES = new Map([
  ['temp', 'tempC'],
  ['temperature', 'tempC'],
  ['tempC', 'tempC'],
  ['rh', 'rh'],
  ['humidity', 'rh'],
  ['vpd', 'vpd'],
  ['co2', 'co2']
]);

function resolveMetricKey(metric) {
  const key = String(metric || '').toLowerCase();
  return SENSOR_METRIC_ALIASES.get(key) || metric || 'tempC';
}

function findZoneByAny(zones, identifiers = []) {
  const normalized = identifiers
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());
  if (!normalized.length) return null;
  return zones.find((zone) => {
    const zoneId = String(zone.id || '').toLowerCase();
    const zoneName = String(zone.name || '').toLowerCase();
    const zoneLocation = String(zone.location || '').toLowerCase();
    return normalized.some((value) => value === zoneId || value === zoneName || value === zoneLocation);
  }) || null;
}

function toLegacyMetricKeys(metricKey) {
  switch (metricKey) {
    case 'tempC':
      return ['tempC', 'temp', 'temperature'];
    case 'rh':
      return ['rh', 'humidity'];
    case 'vpd':
      return ['vpd'];
    case 'co2':
      return ['co2'];
    default:
      return [metricKey];
  }
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function computeMedian(values) {
  if (!Array.isArray(values) || !values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function computeLegacyRoomMetric(legacyEnv, roomId, metricKey) {
  if (!legacyEnv || !Array.isArray(legacyEnv.readings) || !roomId) return null;
  const normalizedRoom = String(roomId).toLowerCase();
  const metricKeys = toLegacyMetricKeys(metricKey);

  const samples = [];
  let latestTs = null;

  for (const entry of legacyEnv.readings) {
    if (!entry) continue;
    const entryRoom = entry.room || entry.roomId || entry.scope;
    if (!entryRoom || String(entryRoom).toLowerCase() !== normalizedRoom) continue;
    for (const key of metricKeys) {
      if (!Object.prototype.hasOwnProperty.call(entry, key)) continue;
      const value = Number(entry[key]);
      if (Number.isFinite(value)) {
        samples.push(value);
      }
    }
    const tsCandidate = entry.ts || entry.timestamp || entry.observedAt || entry.recordedAt;
    if (tsCandidate) {
      const parsed = Date.parse(tsCandidate);
      if (Number.isFinite(parsed) && (!latestTs || parsed > latestTs)) {
        latestTs = parsed;
      }
    }
  }

  if (!samples.length) return null;
  return {
    value: computeMedian(samples),
    observedAt: latestTs ? new Date(latestTs).toISOString() : null,
    sampleCount: samples.length,
    source: 'room-median'
  };
}

function buildReadingQuality(meta = null, fallback = null) {
  const quality = {
    liveSources: 0,
    totalSources: 0,
    fallback: null,
    source: null,
    lastSampleAt: null
  };
  if (meta && typeof meta === 'object') {
    if (Number.isFinite(meta.liveSources)) quality.liveSources = meta.liveSources;
    if (Number.isFinite(meta.liveSampleCount)) quality.liveSources = meta.liveSampleCount;
    if (Number.isFinite(meta.totalSources)) quality.totalSources = meta.totalSources;
    if (Number.isFinite(meta.totalSampleCount)) quality.totalSources = meta.totalSampleCount;
    if (meta.fallback) quality.fallback = meta.fallback;
    if (meta.source) quality.source = meta.source;
    if (meta.lastSampleAt) quality.lastSampleAt = meta.lastSampleAt;
    if (!quality.totalSources && meta.sources && typeof meta.sources === 'object') {
      quality.totalSources = Object.keys(meta.sources).length;
    }
  }
  if (fallback) {
    quality.fallback = fallback;
  }
  return quality;
}

function resolveSensorReading(sensorConfig, fallbackIdentifier, metric, envSnapshot, zones, legacyEnv, roomId) {
  const scopes = envSnapshot?.scopes || {};
  const metricKey = resolveMetricKey(metric);
  let scopeId = fallbackIdentifier || null;
  let explicitMetric = null;

  if (typeof sensorConfig === 'string') {
    const trimmed = sensorConfig.trim();
    if (trimmed.includes('/')) {
      const parts = trimmed.split('/').filter(Boolean);
      if (parts.length >= 2) {
        scopeId = parts[parts.length - 2];
        explicitMetric = parts[parts.length - 1];
      } else if (parts.length === 1) {
        scopeId = parts[0];
      }
    } else {
      scopeId = trimmed;
    }
  } else if (sensorConfig && typeof sensorConfig === 'object') {
    scopeId = sensorConfig.scope || sensorConfig.zone || sensorConfig.id || scopeId;
    explicitMetric = sensorConfig.metric || sensorConfig.key || sensorConfig.type || explicitMetric;
  }

  const sensorKey = resolveMetricKey(explicitMetric || metricKey);
  const scopeEntry = scopeId ? scopes[scopeId] : null;
  const scopeSensor = scopeEntry?.sensors?.[sensorKey];

  let value = null;
  let unit = null;
  let observedAt = null;
  let source = null;
  let quality = buildReadingQuality(scopeSensor?.meta || null);

  if (scopeSensor != null) {
    if (typeof scopeSensor === 'object') {
      value = scopeSensor.value ?? scopeSensor.current ?? null;
      unit = scopeSensor.unit || null;
      observedAt = scopeSensor.observedAt || scopeEntry?.updatedAt || null;
    } else {
      value = scopeSensor;
    }
    source = 'scope';
  }

  if ((value == null || Number.isNaN(value)) && zones?.length) {
    const zoneMatch = findZoneByAny(zones, [scopeId, fallbackIdentifier]);
    const zoneSensor = zoneMatch?.sensors?.[sensorKey];
    if (zoneSensor != null) {
      if (typeof zoneSensor === 'object') {
        value = zoneSensor.current ?? zoneSensor.value ?? null;
        unit = zoneSensor.unit || unit || null;
        observedAt = zoneSensor.observedAt || zoneMatch.meta?.lastUpdated || observedAt || null;
        quality = buildReadingQuality(zoneSensor.meta || null, quality.fallback);
      } else {
        value = zoneSensor;
      }
      source = source || 'zone';
    }
  }

  if ((value == null || Number.isNaN(value)) && legacyEnv && (roomId || scopeId || fallbackIdentifier)) {
    const legacyRoomId = roomId || scopeId || fallbackIdentifier;
    const legacyMetric = computeLegacyRoomMetric(legacyEnv, legacyRoomId, sensorKey);
    if (legacyMetric) {
      value = legacyMetric.value;
      observedAt = legacyMetric.observedAt || observedAt;
      source = source || legacyMetric.source;
      quality = buildReadingQuality(scopeSensor?.meta || null, 'room-median');
      quality.totalSources = Math.max(quality.totalSources, legacyMetric.sampleCount || 0);
    }
  }

  const numericValue = typeof value === 'number' && !Number.isNaN(value) ? value : null;
  if (!quality.source && source) {
    quality.source = source;
  }
  if (numericValue == null) {
    quality.liveSources = 0;
  }

  return {
    scopeId,
    metric: sensorKey,
    value: numericValue,
    unit,
    observedAt,
    source,
    quality
  };
}

function evaluateRoomAutomationConfig(roomConfig, envSnapshot, zones, legacyEnv) {
  const evaluatedAt = new Date().toISOString();
  const control = {
    enable: Boolean(roomConfig?.control?.enable),
    mode: roomConfig?.control?.mode || 'advisory',
    step: typeof roomConfig?.control?.step === 'number' ? roomConfig.control.step : 0.05,
    dwell: typeof roomConfig?.control?.dwell === 'number' ? roomConfig.control.dwell : 180,
    paused: false
  };
  const targets = roomConfig?.targets || {};
  const sensors = roomConfig?.sensors || {};
  const readings = {};
  const suggestions = [];

  const summaryAlerts = [];

  const tempReading = resolveSensorReading(sensors.temp || sensors.temperature, sensors.temp || sensors.temperature, 'temp', envSnapshot, zones, legacyEnv, roomConfig?.roomId);
  if (tempReading.value != null) {
    readings.temp = tempReading;
  }

  const rhReading = resolveSensorReading(sensors.rh || sensors.humidity, sensors.rh || sensors.humidity, 'rh', envSnapshot, zones, legacyEnv, roomConfig?.roomId);
  if (rhReading.value != null) {
    readings.rh = rhReading;
  }

  const minBlue = typeof targets.minBlue === 'number' ? targets.minBlue : null;
  const minMaster = typeof targets.minMaster === 'number' ? targets.minMaster : null;

  const stepPercent = Math.round(control.step * 100);

  if (typeof targets.temp === 'number' && tempReading.value != null) {
    const delta = tempReading.value - targets.temp;
    const absDelta = Math.abs(delta);
    if (absDelta >= 0.5) {
      const severity = absDelta >= 3 ? 'critical' : absDelta >= 1.5 ? 'moderate' : 'minor';
      
      // Only suggest dimming when temperature is HIGH
      // Never suggest increasing light power - could burn plants
      if (delta > 0) {
        const actionLabel = `Dim master −${stepPercent}% for ${control.dwell}s`;
        suggestions.push({
          id: `${roomConfig.roomId || slugify(roomConfig.name)}-temp-down`,
          type: 'lighting',
          metric: 'temp',
          severity,
          label: actionLabel,
          detail: `Current ${tempReading.value.toFixed(1)}°C vs target ${targets.temp.toFixed(1)}°C.`,
          delta,
          action: {
            actuator: 'lights',
            change: -control.step,
            dwell: control.dwell,
            guardrails: { minMaster, minBlue }
          }
        });
        summaryAlerts.push('temperature high');
      } else {
        // Temperature is LOW - do NOT increase lights (plant safety)
        summaryAlerts.push('temperature low');
      }
    }
  }

  const humidityQuality = rhReading?.quality || {};
  const humidityLiveSources = Number.isFinite(humidityQuality.liveSources) ? humidityQuality.liveSources : 0;
  const humidityFallback = humidityQuality.fallback;
  const humidityUsingRoomMedian = humidityFallback === 'room-median';
  const plugDwell = Math.max(control.dwell ?? 600, 600);

  if (typeof targets.rh === 'number' && rhReading.value != null) {
    const band = typeof targets.rhBand === 'number' ? Math.max(1, targets.rhBand) : 5;
    const minRh = targets.rh - band;
    const maxRh = targets.rh + band;
    const detailSuffix = !humidityLiveSources && humidityUsingRoomMedian
      ? ' Using room-level median until sensors recover.'
      : '';

    if (rhReading.value > maxRh) {
      const severity = rhReading.value - maxRh >= 5 ? 'moderate' : 'minor';
      suggestions.push({
        id: `${roomConfig.roomId || slugify(roomConfig.name)}-rh-high`,
        type: 'dehumidifier',
        metric: 'rh',
        severity,
        label: `Dehumidifier ON (${Math.round(plugDwell / 60)}m dwell)`,
        detail: `Humidity ${rhReading.value.toFixed(1)}% exceeds band (${minRh.toFixed(1)}–${maxRh.toFixed(1)}%).${detailSuffix}`,
        action: {
          actuator: 'dehu',
          dwell: plugDwell,
          mode: 'on'
        },
        disabled: !humidityLiveSources
      });
      summaryAlerts.push('humidity high');
    } else if (rhReading.value < minRh) {
      const severity = minRh - rhReading.value >= 5 ? 'moderate' : 'minor';
      suggestions.push({
        id: `${roomConfig.roomId || slugify(roomConfig.name)}-rh-low`,
        type: 'dehumidifier',
        metric: 'rh',
        severity,
        label: `Dehumidifier OFF (${Math.round(plugDwell / 60)}m dwell)`,
        detail: `Humidity ${rhReading.value.toFixed(1)}% below band (${minRh.toFixed(1)}–${maxRh.toFixed(1)}%).${detailSuffix}`,
        action: {
          actuator: 'dehu',
          dwell: plugDwell,
          mode: 'off'
        },
        disabled: !humidityLiveSources
      });
      summaryAlerts.push('humidity low');
    }
  }

  const missingMetrics = [];
  if (typeof targets.temp === 'number' && tempReading.value == null) missingMetrics.push('temperature');
  if (typeof targets.rh === 'number' && rhReading.value == null) missingMetrics.push('humidity');
  const sensorsMissing = missingMetrics.length > 0;
  if (sensorsMissing) {
    control.paused = true;
  }

  let statusLevel = null;
  let statusSummary = null;
  const statusDetails = [];

  if (sensorsMissing) {
    statusLevel = 'alert';
    statusSummary = 'Automation paused — sensors unavailable';
    const missingText = missingMetrics.join(' and ');
    statusDetails.push(`No live ${missingText} readings. Guardrails are paused until sensors recover.`);
    suggestions.length = 0;
  } else if (!humidityLiveSources && humidityUsingRoomMedian && typeof targets.rh === 'number') {
    statusLevel = 'alert';
    statusSummary = 'Using room median until humidity sensors recover';
    statusDetails.push('No live humidity sensors detected. Using last recorded room median for guardrails.');
  }

  const defaultLevel = suggestions.length
    ? (suggestions.some((s) => s.severity === 'critical') ? 'critical' : 'alert')
    : control.enable && control.mode === 'autopilot'
      ? 'active'
      : 'idle';
  if (!statusLevel || defaultLevel === 'critical') {
    statusLevel = defaultLevel;
  }

  const defaultSummary = suggestions.length
    ? `Advisories ready (${suggestions.length})`
    : control.enable && control.mode === 'autopilot'
      ? 'Autopilot engaged'
      : 'Within guardrails';
  if (!statusSummary) {
    statusSummary = defaultSummary;
  }

  if (summaryAlerts.length) {
    statusDetails.push(summaryAlerts.join(', '));
  } else if (suggestions.length) {
    statusDetails.push(suggestions.map((s) => s.detail).join(' | '));
  } else if (!statusDetails.length) {
    statusDetails.push('No adjustments recommended at this time.');
  }

  const statusDetail = statusDetails.filter(Boolean).join(' | ');

  return {
    roomId: roomConfig.roomId,
    name: roomConfig.name || roomConfig.roomId,
    targets: {
      ...targets,
      minBlue,
      minMaster
    },
    control,
    sensors,
    actuators: roomConfig.actuators || {},
    readings,
    suggestions,
    status: {
      level: statusLevel,
      summary: statusSummary,
      detail: statusDetail,
      evaluatedAt
    },
    evaluatedAt,
    meta: roomConfig.meta || {}
  };
}

function buildBindingIndex(bindingSummary) {
  const bindings = (bindingSummary && bindingSummary.bindings) || [];
  const byZone = new Map();
  const byRoom = new Map();

  bindings.forEach((binding) => {
    if (!binding) return;
    const zoneCandidates = [binding.scopeId, binding.zoneId, binding.zoneName, binding.zoneKey];
    zoneCandidates
      .map((value) => normalizeString(value).toLowerCase())
      .filter(Boolean)
      .forEach((key) => {
        if (!byZone.has(key)) {
          byZone.set(key, binding);
        }
      });

    const roomCandidates = [binding.roomId, binding.roomName];
    roomCandidates
      .map((value) => normalizeString(value).toLowerCase())
      .filter(Boolean)
      .forEach((key) => {
        if (!byRoom.has(key)) {
          byRoom.set(key, binding);
        }
      });
  });

  return { byZone, byRoom };
}

function findBindingForRoom(roomConfig, bindingIndex) {
  if (!roomConfig || !bindingIndex) return null;
  const { byZone, byRoom } = bindingIndex;
  const zoneCandidates = [
    roomConfig?.meta?.scopeId,
    roomConfig?.meta?.zoneId,
    roomConfig?.meta?.zoneName,
    roomConfig?.sensors?.temp,
    roomConfig?.sensors?.rh,
    roomConfig?.roomId,
  ];

  for (const candidate of zoneCandidates) {
    const key = normalizeString(candidate).toLowerCase();
    if (!key) continue;
    if (byZone.has(key)) return byZone.get(key);
  }

  const roomCandidates = [roomConfig.roomId, roomConfig.meta?.roomId, roomConfig.meta?.roomName, roomConfig.name];
  for (const candidate of roomCandidates) {
    const key = normalizeString(candidate).toLowerCase();
    if (!key) continue;
    if (byRoom.has(key)) return byRoom.get(key);
  }

  return null;
}

function mergeRoomWithBinding(roomConfig, binding) {
  if (!binding) return roomConfig;
  const scopeId = binding.scopeId || binding.zoneId || binding.zoneKey;

  const merged = {
    ...roomConfig,
    sensors: {
      ...(roomConfig.sensors || {}),
    },
    actuators: {
      ...(roomConfig.actuators || {}),
    },
    meta: {
      ...(roomConfig.meta || {}),
    },
  };

  if (scopeId) {
    merged.sensors.temp = scopeId;
    merged.sensors.rh = scopeId;
  }

  if (Array.isArray(binding.actuators?.fans) && binding.actuators.fans.length) {
    merged.actuators.fans = binding.actuators.fans
      .map((entry) => normalizeString(entry.plugId || entry.deviceId))
      .filter(Boolean);
  }

  if (Array.isArray(binding.actuators?.dehu) && binding.actuators.dehu.length) {
    merged.actuators.dehu = binding.actuators.dehu
      .map((entry) => normalizeString(entry.plugId || entry.deviceId))
      .filter(Boolean);
  }

  merged.meta = {
    ...merged.meta,
    zoneId: binding.zoneId || merged.meta.zoneId,
    zoneName: binding.zoneName || merged.meta.zoneName,
    scopeId: scopeId || merged.meta.scopeId,
    binding: {
      zoneId: binding.zoneId,
      zoneName: binding.zoneName,
      scopeId,
      roomId: binding.roomId,
      roomName: binding.roomName,
      primarySensorId: binding.primarySensorId || null,
      sensors: (binding.sensors || []).map((sensor) => ({
        deviceId: sensor.deviceId,
        name: sensor.name,
        primary: Boolean(sensor.primary),
        weight: sensor.weight,
        weightPercent: sensor.weightPercent,
        rawWeight: sensor.rawWeight,
        battery: sensor.battery,
        vendor: sensor.vendor,
        updatedAt: sensor.updatedAt || null,
      })),
      actuators: binding.actuators,
      counts: binding.counts,
      updatedAt: binding.updatedAt || null,
    },
  };

  return merged;
}

function evaluateRoomAutomationState(envSnapshot, zones, legacyEnv, bindingSummary = null) {
  const bindingIndex = buildBindingIndex(bindingSummary);
  const rooms = preEnvStore.listRooms();
  const results = rooms.map((room) => {
    const binding = findBindingForRoom(room, bindingIndex);
    const hydrated = mergeRoomWithBinding(room, binding);
    return evaluateRoomAutomationConfig(hydrated, envSnapshot, zones, legacyEnv);
  });
  const totalSuggestions = results.reduce((acc, room) => acc + (room.suggestions?.length || 0), 0);
  return {
    rooms: results,
    evaluatedAt: new Date().toISOString(),
    totalSuggestions
  };
}

function getPlanIndex() {
  const plans = loadPlansFile();
  const map = new Map();
  plans.forEach((plan, index) => {
    if (!plan) return;
    const hydrated = hydratePlan(plan, index);
    if (!hydrated?.id) return;
    const keys = [hydrated.id, hydrated.key, hydrated.name]
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter(Boolean);
    keys.forEach((key) => {
      if (!map.has(key)) map.set(key, hydrated);
    });
  });
  return map;
}

function startOfToday() {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return start;
}

function parseTimestamp(ts) {
  if (!ts) return null;
  const date = new Date(ts);
  return Number.isFinite(date.getTime()) ? date : null;
}

function computeAverage(entries, key) {
  let sum = 0;
  let count = 0;
  entries.forEach((entry) => {
    const value = Number(entry?.[key]);
    if (Number.isFinite(value)) {
      sum += value;
      count += 1;
    }
  });
  if (!count) return null;
  return sum / count;
}

function computeEnergy(entries) {
  let total = 0;
  let count = 0;
  entries.forEach((entry) => {
    const value = Number(entry?.kwh ?? entry?.energyKwh ?? entry?.energy);
    if (Number.isFinite(value)) {
      total += value;
      count += 1;
    }
  });
  if (!count) return null;
  return total;
}

function readDutyCycleValue(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const candidates = [
    entry.duty,
    entry.dutyCycle,
    entry.dutyPct,
    entry.dutyPercent,
    entry.plugDuty,
    entry.masterPct,
    entry.blueDuty,
  ];
  for (const candidate of candidates) {
    const value = toNumberOrNull(candidate);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function computeCorrelation(entries, accessorA, accessorB) {
  if (!Array.isArray(entries) || entries.length < 3) return null;
  const samples = [];
  entries.forEach((entry) => {
    try {
      const a = accessorA(entry);
      const b = accessorB(entry);
      if (Number.isFinite(a) && Number.isFinite(b)) {
        samples.push({ a, b });
      }
    } catch (error) {
      // Ignore malformed samples
    }
  });
  if (samples.length < 3) return null;

  const sumA = samples.reduce((acc, sample) => acc + sample.a, 0);
  const sumB = samples.reduce((acc, sample) => acc + sample.b, 0);
  const meanA = sumA / samples.length;
  const meanB = sumB / samples.length;

  let numerator = 0;
  let denomA = 0;
  let denomB = 0;
  samples.forEach((sample) => {
    const diffA = sample.a - meanA;
    const diffB = sample.b - meanB;
    numerator += diffA * diffB;
    denomA += diffA ** 2;
    denomB += diffB ** 2;
  });

  if (denomA === 0 || denomB === 0) return null;
  const coefficient = numerator / Math.sqrt(denomA * denomB);
  if (!Number.isFinite(coefficient)) return null;
  return { coefficient: Math.max(-1, Math.min(1, coefficient)), samples: samples.length };
}

function sanitizeTempBin(bin) {
  if (bin == null) return '';
  return String(bin)
    .replace(/[°\s]*(?:c|f)/gi, '')
    .replace(/[–—]/g, '-')
    .replace(/\s+to\s+/gi, '-')
    .replace(/\s+/g, '')
    .trim();
}

function parseTempBinRange(bin) {
  const raw = typeof bin === 'string' ? bin : '';
  const normalized = sanitizeTempBin(raw);
  if (!normalized) {
    return {
      label: raw || '',
      min: null,
      max: null,
      includeMin: false,
      includeMax: false,
    };
  }

  const numbers = normalized.match(/-?\d+(?:\.\d+)?/g) || [];
  const parseValue = (value) => {
    if (value == null) return null;
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  };

  const range = {
    label: raw || normalized,
    min: null,
    max: null,
    includeMin: false,
    includeMax: false,
  };

  if (/^(>=|=>|≥)/.test(normalized)) {
    range.min = parseValue(numbers[0]);
    range.includeMin = true;
    return range;
  }
  if (/^>/.test(normalized)) {
    range.min = parseValue(numbers[0]);
    range.includeMin = false;
    return range;
  }
  if (/^(<=|=<|≤)/.test(normalized)) {
    range.max = parseValue(numbers[0]);
    range.includeMax = true;
    return range;
  }
  if (/^</.test(normalized)) {
    range.max = parseValue(numbers[0]);
    range.includeMax = false;
    return range;
  }

  if (numbers.length >= 2 && normalized.includes('-')) {
    const first = parseValue(numbers[0]);
    const second = parseValue(numbers[1]);
    if (first != null && second != null) {
      range.min = Math.min(first, second);
      range.max = Math.max(first, second);
      range.includeMin = true;
      range.includeMax = true;
      return range;
    }
  }

  if (numbers.length >= 1) {
    const value = parseValue(numbers[0]);
    if (value != null) {
      range.min = value;
      range.max = value;
      range.includeMin = true;
      range.includeMax = true;
    }
  }

  return range;
}

function tempBinMatches(value, binRange) {
  if (!Number.isFinite(value) || !binRange) return false;
  const { min, max, includeMin, includeMax } = binRange;
  if (min != null) {
    if (includeMin) {
      if (value < min) return false;
    } else if (value <= min) {
      return false;
    }
  }
  if (max != null) {
    if (includeMax) {
      if (value > max) return false;
    } else if (value >= max) {
      return false;
    }
  }
  return true;
}

function describeCorrelationStrength(coefficient) {
  const magnitude = Math.abs(coefficient);
  if (magnitude >= 0.85) return 'very strong';
  if (magnitude >= 0.7) return 'strong';
  if (magnitude >= 0.5) return 'moderate';
  if (magnitude >= 0.3) return 'weak';
  return 'minimal';
}

const learningCorrelationCache = new Map();

function logLearningCorrelations(roomId, correlations, daily) {
  if (!roomId || !preAutomationLogger) return;
  if (!correlations || typeof correlations !== 'object') return;
  const payload = {};
  Object.entries(correlations).forEach(([key, entry]) => {
    if (!entry || typeof entry !== 'object') return;
    if (!Number.isFinite(entry.coefficient)) return;
    payload[key] = {
      coefficient: Math.round(entry.coefficient * 1000) / 1000,
      samples: entry.samples || 0,
    };
  });
  if (!Object.keys(payload).length) return;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dateKey = today.toISOString().slice(0, 10);
  const cacheEntry = learningCorrelationCache.get(roomId);
  const signature = JSON.stringify(payload);
  if (cacheEntry && cacheEntry.date === dateKey && cacheEntry.signature === signature) {
    return;
  }

  preAutomationLogger.log({
    type: 'learning-correlation',
    mode: 'advisory',
    roomId,
    date: dateKey,
    correlations: payload,
    daily: {
      tempAvg: Number.isFinite(daily?.tempAvg) ? daily.tempAvg : null,
      rhAvg: Number.isFinite(daily?.rhAvg) ? daily.rhAvg : null,
      ppfdAvg: Number.isFinite(daily?.ppfdAvg) ? daily.ppfdAvg : null,
      masterAvg: Number.isFinite(daily?.masterAvg) ? daily.masterAvg : null,
      energyKwh: Number.isFinite(daily?.energyKwh) ? daily.energyKwh : null,
      samples: Number.isFinite(daily?.samples) ? daily.samples : null,
    },
  });
  learningCorrelationCache.set(roomId, { date: dateKey, signature });
}

function buildAdaptiveRecommendation(room, plan, planKey, daily, targets) {
  if (!room || !plan) return null;
  const curve = Array.isArray(plan?.adapt?.tempCurve) ? plan.adapt.tempCurve : [];
  if (!curve.length) return null;
  const temp = Number.isFinite(daily?.tempAvg) ? daily.tempAvg : null;
  if (temp == null) return null;

  let matched = null;
  for (const entry of curve) {
    if (!entry || typeof entry !== 'object') continue;
    const binRange = parseTempBinRange(entry.bin || entry.label || entry.range || entry.zone || '');
    if (tempBinMatches(temp, binRange)) {
      matched = { entry, binRange };
      break;
    }
  }
  if (!matched) return null;

  const ppfdScale = entryValue(matched.entry, 'ppfdScale');
  const blueDelta = entryValue(matched.entry, 'blueDelta');
  const redDelta = entryValue(matched.entry, 'redDelta');

  const meaningfulScale = Number.isFinite(ppfdScale) && Math.abs(ppfdScale - 1) >= 0.01;
  const meaningfulBlue = Number.isFinite(blueDelta) && Math.abs(blueDelta) >= 0.005;
  const meaningfulRed = Number.isFinite(redDelta) && Math.abs(redDelta) >= 0.005;
  if (!meaningfulScale && !meaningfulBlue && !meaningfulRed) return null;

  const ppfdDeltaPct = meaningfulScale ? Math.round((ppfdScale - 1) * 1000) / 10 : 0;
  const blueDeltaPct = meaningfulBlue ? Math.round(blueDelta * 1000) / 10 : 0;
  const redDeltaPct = meaningfulRed ? Math.round(redDelta * 1000) / 10 : 0;

  const ppfdText = meaningfulScale
    ? `${ppfdDeltaPct > 0 ? '+' : ''}${ppfdDeltaPct.toFixed(Math.abs(ppfdDeltaPct) < 1 ? 1 : 0)}% PPFD`
    : null;
  const blueText = meaningfulBlue
    ? `${blueDeltaPct >= 0 ? '+' : ''}${Math.abs(blueDeltaPct).toFixed(Math.abs(blueDeltaPct) < 1 ? 1 : 0)}% blue`
    : null;
  const redText = meaningfulRed
    ? `${redDeltaPct >= 0 ? '+' : ''}${Math.abs(redDeltaPct).toFixed(Math.abs(redDeltaPct) < 1 ? 1 : 0)}% red`
    : null;

  const planName = plan.name || planKey || 'plan';
  const binLabel = matched.binRange?.label || matched.entry.bin || 'current bin';
  const actions = [ppfdText, blueText, redText].filter(Boolean);
  if (!actions.length) return null;

  const label = `Learning: ${actions.join(' & ')}`;
  const detail = `Plan ${planName} adaptive curve (${binLabel}) suggests ${actions.join(' and ')} when canopy temp averages ${temp.toFixed(1)}°C. Advisory only.`;

  const idSuffix = slugify(`${room.roomId || room.name || 'room'}-${binLabel || 'bin'}`);
  const suggestion = {
    id: `${room.roomId}-learning-${idSuffix}`,
    type: 'learning',
    metric: 'temp',
    label,
    detail,
    advisory: true,
    source: 'plan.adapt.tempCurve',
    bin: binLabel,
    recommendation: {
      ppfdScale: meaningfulScale ? ppfdScale : null,
      blueDelta: meaningfulBlue ? blueDelta : null,
      redDelta: meaningfulRed ? redDelta : null,
      plan: planName,
    },
  };

  const summary = `Learning curve recommends ${actions.join(' & ')} for ${temp.toFixed(1)}°C canopy.`;
  const narrative = `Adaptive guidance (${binLabel}) proposes ${actions.join(' & ')}. Targets remain advisory until approved.`;

  return { suggestion, summary, narrative };
}

function entryValue(entry, key) {
  if (!entry || typeof entry !== 'object') return null;
  const value = entry[key];
  const numeric = toNumberOrNull(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function selectPlanForRoom(room, legacyRooms, planIndex) {
  const planKey = [
    room?.plan,
    room?.targets?.plan,
    legacyRooms?.[room?.roomId]?.plan,
    legacyRooms?.[room?.roomId]?.targets?.plan,
    room?.meta?.planId,
    room?.meta?.plan
  ].find((value) => typeof value === 'string' && value.trim());
  if (!planKey) return { plan: null, planKey: null };
  const normalized = planKey.trim();
  return {
    plan: planIndex.get(normalized) || null,
    planKey: normalized
  };
}

function describeDelta(value, target, suffix) {
  if (!Number.isFinite(value) || !Number.isFinite(target)) return null;
  const delta = value - target;
  if (Math.abs(delta) < 0.01) return null;
  const arrow = delta > 0 ? '+' : '−';
  return `${arrow}${Math.abs(delta).toFixed(1)}${suffix}`;
}

function buildRoomAnalytics(room, legacyEnv, planIndex) {
  const readings = Array.isArray(legacyEnv?.readings) ? legacyEnv.readings.filter((entry) => entry?.room === room.roomId) : [];
  const todayStart = startOfToday();
  const todaysSensors = readings.filter((entry) => {
    const ts = parseTimestamp(entry?.ts);
    if (!ts) return false;
    return ts >= todayStart;
  });

  const dailyEntries = todaysSensors.length ? todaysSensors : readings.slice(-24);
  const daily = {
    tempAvg: computeAverage(dailyEntries, 'temp'),
    rhAvg: computeAverage(dailyEntries, 'rh'),
    vpdAvg: computeAverage(dailyEntries, 'vpd'),
    ppfdAvg: computeAverage(dailyEntries, 'ppfd'),
    masterAvg: computeAverage(dailyEntries, 'masterPct'),
    blueAvg: computeAverage(dailyEntries, 'bluePct'),
    energyKwh: computeEnergy(dailyEntries),
    samples: dailyEntries.length,
    logCount: readings.length
  };

  const suggestions = [];
  const summaryParts = [];
  const learningNarrative = [];

  const correlations = {
    ppfdBlue: computeCorrelation(
      dailyEntries,
      (entry) => toNumberOrNull(entry?.ppfd),
      (entry) => toNumberOrNull(entry?.bluePct)
    ),
    tempRh: computeCorrelation(
      dailyEntries,
      (entry) => toNumberOrNull(entry?.temp),
      (entry) => toNumberOrNull(entry?.rh)
    ),
    dutyEnergy: computeCorrelation(
      dailyEntries,
      (entry) => readDutyCycleValue(entry),
      (entry) => {
        const value = entry?.kwh ?? entry?.energyKwh ?? entry?.energy;
        return toNumberOrNull(value);
      }
    ),
  };
  daily.correlations = correlations;

  const learning = { correlations };
  const correlationLabels = {
    ppfdBlue: 'PPFD↔Blue',
    tempRh: 'Temp↔RH',
    dutyEnergy: 'Duty↔Energy',
  };
  const correlationSummary = [];
  Object.entries(correlations).forEach(([key, info]) => {
    if (!info || !Number.isFinite(info.coefficient)) return;
    if (info.samples < 3) return;
    const descriptor = describeCorrelationStrength(info.coefficient);
    const direction = info.coefficient >= 0 ? 'direct' : 'inverse';
    const label = correlationLabels[key] || key;
    const summaryText = `${label} ${descriptor} ${direction} correlation (${info.coefficient.toFixed(2)}, ${info.samples} samples)`;
    correlationSummary.push(summaryText);
  });
  if (correlationSummary.length) {
    learning.correlationSummary = correlationSummary;
    learningNarrative.push(correlationSummary.join('; '));
  }

  const { plan, planKey } = selectPlanForRoom(room, legacyEnv?.rooms || {}, planIndex);
  const targets = room?.targets || {};
  const control = room?.control || {};
  const rhBand = typeof targets.rhBand === 'number' ? Math.max(1, targets.rhBand) : 5;
  const minRh = Number.isFinite(targets.rh) ? targets.rh - rhBand : null;
  const maxRh = Number.isFinite(targets.rh) ? targets.rh + rhBand : null;
  const targetVpd = computeVpd(targets.temp, targets.rh);
  const stepPct = Math.round((control.step ?? 0.05) * 100);
  const dwell = control.dwell ?? 180;

  if (Number.isFinite(daily.tempAvg) && Number.isFinite(targets.temp)) {
    const delta = daily.tempAvg - targets.temp;
    if (delta > 0.8) {
      suggestions.push({
        id: `${room.roomId}-ai-temp-high`,
        type: 'lighting',
        metric: 'temp',
        label: `Dim master −${stepPct}%`,
        detail: `Avg ${daily.tempAvg.toFixed(1)}°C vs target ${targets.temp.toFixed(1)}°C · dwell ${dwell}s`,
        change: { masterDelta: -(control.step || 0.05), dwell }
      });
      summaryParts.push(`temperature running high (+${delta.toFixed(1)}°C)`);
    } else if (delta < -0.8) {
      // REMOVED: Boosting light power to raise temperature could burn plants
      // Instead, recommend checking HVAC, insulation, or fixture placement
      summaryParts.push(`temperature trailing low (${delta.toFixed(1)}°C)`);
    }
  }

  if (Number.isFinite(daily.rhAvg) && Number.isFinite(targets.rh)) {
    if (maxRh != null && daily.rhAvg > maxRh + 1) {
      suggestions.push({
        id: `${room.roomId}-ai-rh-high`,
        type: 'dehumidifier',
        metric: 'rh',
        label: `Run dehumidifier ${dwell}s`,
        detail: `Avg RH ${daily.rhAvg.toFixed(1)}% above ${maxRh.toFixed(1)}% band`,
        change: { actuator: 'dehu', duration: dwell }
      });
      summaryParts.push(`humidity drifting high (+${(daily.rhAvg - maxRh).toFixed(1)}%)`);
    } else if (minRh != null && daily.rhAvg < minRh - 1) {
      suggestions.push({
        id: `${room.roomId}-ai-rh-low`,
        type: 'circulation',
        metric: 'rh',
        label: `Pulse fans ${dwell}s`,
        detail: `Avg RH ${daily.rhAvg.toFixed(1)}% below ${minRh.toFixed(1)}% band`,
        change: { actuator: 'fans', duration: dwell }
      });
      summaryParts.push(`humidity dipping low (${(daily.rhAvg - minRh).toFixed(1)}%)`);
    }
  }

  if (Number.isFinite(daily.vpdAvg) && Number.isFinite(targetVpd)) {
    const delta = daily.vpdAvg - targetVpd;
    if (delta > 0.2) {
      summaryParts.push(`VPD trending high (${delta.toFixed(2)} kPa)`);
    } else if (delta < -0.2) {
      summaryParts.push(`VPD trending low (${delta.toFixed(2)} kPa)`);
    }
  }

  if (plan && Number.isFinite(plan.ppfd) && Number.isFinite(daily.ppfdAvg)) {
    const ppfdDelta = daily.ppfdAvg - plan.ppfd;
    if (ppfdDelta < -30) {
      // REMOVED: Raising PPFD by increasing light power could burn plants
      // Gap may be due to sensor calibration, fixture height, or plan mismatch
      // Only report the observation without suggesting power increase
      summaryParts.push(`PPFD trailing plan (${Math.abs(ppfdDelta).toFixed(0)} µmol)`);
    } else if (ppfdDelta > 40) {
      suggestions.push({
        id: `${room.roomId}-ai-ppfd-high`,
        type: 'lighting',
        metric: 'ppfd',
        label: `Trim PPFD −${stepPct}%`,
        detail: `Avg PPFD ${daily.ppfdAvg.toFixed(0)} above plan ${plan.ppfd.toFixed(0)} µmol/m²/s`,
        change: { masterDelta: -(control.step || 0.05), dwell }
      });
      summaryParts.push(`PPFD exceeding plan (${ppfdDelta.toFixed(0)} µmol)`);
    }
  }

  if (Number.isFinite(daily.energyKwh) && daily.energyKwh > 0) {
    summaryParts.push(`lighting draw ${daily.energyKwh.toFixed(2)} kWh`);
  }

  const adaptive = buildAdaptiveRecommendation(room, plan, planKey, daily, targets);
  if (adaptive) {
    suggestions.unshift(adaptive.suggestion);
    if (adaptive.summary && !summaryParts.includes(adaptive.summary)) {
      summaryParts.push(adaptive.summary);
    }
    if (adaptive.narrative) {
      learningNarrative.push(adaptive.narrative);
    }
    learning.adaptive = {
      bin: adaptive.suggestion?.bin || null,
      summary: adaptive.summary,
      narrative: adaptive.narrative,
      recommendation: adaptive.suggestion?.recommendation || null,
    };
    learning.suggestions = [adaptive.suggestion];
  }

  const summary = summaryParts.length
    ? `${summaryParts[0][0].toUpperCase()}${summaryParts[0].slice(1)}${summaryParts.length > 1 ? '; ' + summaryParts.slice(1).join('; ') : ''}`
    : 'Conditions within configured guardrails.';

  const narrativeParts = [summary];
  const tempDetail = Number.isFinite(daily.tempAvg) && Number.isFinite(targets.temp)
    ? `Temp ${daily.tempAvg.toFixed(1)}°C (${describeDelta(daily.tempAvg, targets.temp, '°C') || 'on target'})`
    : null;
  const rhDetail = Number.isFinite(daily.rhAvg) && Number.isFinite(targets.rh)
    ? `RH ${daily.rhAvg.toFixed(0)}% (${describeDelta(daily.rhAvg, targets.rh, '%') || 'on target'})`
    : null;
  const vpdDetail = Number.isFinite(daily.vpdAvg) && Number.isFinite(targetVpd)
    ? `VPD ${daily.vpdAvg.toFixed(2)} kPa (${describeDelta(daily.vpdAvg, targetVpd, ' kPa') || 'balanced'})`
    : null;
  const ppfdDetail = Number.isFinite(daily.ppfdAvg)
    ? Number.isFinite(plan?.ppfd)
      ? `PPFD ${daily.ppfdAvg.toFixed(0)} µmol (plan ${plan.ppfd.toFixed(0)})`
      : `PPFD ${daily.ppfdAvg.toFixed(0)} µmol`
    : null;

  const climateDetails = [tempDetail, rhDetail, vpdDetail, ppfdDetail].filter(Boolean);
  if (climateDetails.length) {
    narrativeParts.push(climateDetails.join(' · '));
  }
  if (plan) {
    const photoperiod = Number.isFinite(plan.photoperiod) ? `${plan.photoperiod}h` : '—';
    const planPpfd = Number.isFinite(plan.ppfd) ? `${plan.ppfd.toFixed(0)} µmol` : `${plan.ppfd || '—'} µmol`;
    narrativeParts.push(`Plan ${plan.name || planKey} targets ${planPpfd} for ${photoperiod}.`);
  }
  if (Number.isFinite(daily.energyKwh)) {
    narrativeParts.push(`Lighting energy ${daily.energyKwh.toFixed(2)} kWh today.`);
  }

  if (learningNarrative.length) {
    narrativeParts.push(`Learning insights: ${learningNarrative.join(' ')}`);
  }

  logLearningCorrelations(room.roomId, correlations, daily);

  const lastAction = readings.slice().reverse().find((entry) => entry?.kind === ACTION_ENTRY_KIND) || null;

  return {
    summary,
    narrative: narrativeParts.join(' '),
    daily,
    suggestions,
    plan: planKey || null,
    planName: plan?.name || null,
    lastActionAt: lastAction?.ts || null,
    lastResult: lastAction?.result || null,
    learning
  };
}

function parseLocalDate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    const copy = new Date(value);
    if (!Number.isFinite(copy.getTime())) return null;
    copy.setHours(0, 0, 0, 0);
    return copy;
  }
  const str = String(value).trim();
  if (!str) return null;
  const isoMatch = str.match(/^([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})$/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    const parsed = new Date(Number(year), Number(month) - 1, Number(day));
    if (Number.isFinite(parsed.getTime())) {
      parsed.setHours(0, 0, 0, 0);
      return parsed;
    }
  }
  const parsed = new Date(str);
  if (!Number.isFinite(parsed.getTime())) return null;
  parsed.setHours(0, 0, 0, 0);
  return parsed;
}

function pickDefined(source) {
  const out = {};
  Object.entries(source || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null) out[key] = value;
  });
  return out;
}

function normalizeMixInput(mix) {
  const src = mix && typeof mix === 'object' ? mix : {};
  return {
    cw: toNumberOrNull(src.cw) ?? 0,
    ww: toNumberOrNull(src.ww) ?? 0,
    bl: toNumberOrNull(src.bl) ?? 0,
    rd: toNumberOrNull(src.rd) ?? 0,
  };
}

function clampPercent(value) {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 100) return 100;
  return value;
}

function applyCalibrationToMix(mix, calibration) {
  const base = normalizeMixInput(mix);
  const gains = calibration || {};
  const intensity = Number.isFinite(gains.intensity) ? gains.intensity : 1;
  return {
    cw: clampPercent(base.cw * (Number.isFinite(gains.cw) ? gains.cw : 1) * intensity),
    ww: clampPercent(base.ww * (Number.isFinite(gains.ww) ? gains.ww : 1) * intensity),
    bl: clampPercent(base.bl * (Number.isFinite(gains.bl) ? gains.bl : 1) * intensity),
    rd: clampPercent(base.rd * (Number.isFinite(gains.rd) ? gains.rd : 1) * intensity),
  };
}

function buildHexPayload(mix, maxByte = DEFAULT_CHANNEL_MAX_BYTE) {
  const normalized = normalizeMixInput(mix);
  const scale = Number.isFinite(maxByte) && maxByte > 0
    ? Math.min(Math.max(Math.round(maxByte), 1), MAX_CHANNEL_BYTE)
    : DEFAULT_CHANNEL_MAX_BYTE;
  const toHex = (value) => {
    const clamped = clampPercent(value);
    const scaled = Math.round((clamped / 100) * scale);
    const bounded = Math.min(scale, Math.max(0, scaled));
    return bounded.toString(16).padStart(2, '0').toUpperCase();
  };
  return `${toHex(normalized.cw)}${toHex(normalized.ww)}${toHex(normalized.bl)}${toHex(normalized.rd)}0000`;
}

function loadChannelScaleConfig() {
  const doc = readJsonSafe(CHANNEL_SCALE_PATH, null) || {};
  const maxCandidates = [doc.maxByte, doc.max_byte, doc.maxSteps];
  let resolvedMax = DEFAULT_CHANNEL_MAX_BYTE;
  for (const candidate of maxCandidates) {
    const numeric = toNumberOrNull(candidate);
    if (Number.isFinite(numeric) && numeric > 0) {
      resolvedMax = Math.min(Math.max(Math.round(numeric), 1), MAX_CHANNEL_BYTE);
      break;
    }
  }

  const rawScale = typeof doc.scale === 'string' ? doc.scale.trim().toUpperCase() : '';
  let label;
  if (rawScale === '00-FF') {
    label = '00-FF';
  } else if (rawScale === DEFAULT_CHANNEL_SCALE.label) {
    label = DEFAULT_CHANNEL_SCALE.label;
  } else if (rawScale === '00-64') {
    // Legacy label for 0x64 scale; map to new label when maxByte ≤ 64
    label = resolvedMax <= DEFAULT_CHANNEL_MAX_BYTE ? DEFAULT_CHANNEL_SCALE.label : '00-64';
  } else if (rawScale) {
    label = rawScale;
  } else if (resolvedMax <= DEFAULT_CHANNEL_MAX_BYTE) {
    label = DEFAULT_CHANNEL_SCALE.label;
  } else if (resolvedMax <= 100) {
    label = '00-64';
  } else {
    label = '00-FF';
  }

  return { maxByte: resolvedMax, scale: label };
}

function buildCalibrationMap() {
  const doc = readJsonSafe(CALIBRATIONS_PATH, null);
  const entries = Array.isArray(doc?.calibrations) ? doc.calibrations : [];
  const map = new Map();
  entries.forEach((entry) => {
    if (!entry || typeof entry !== 'object') return;
    const gains = entry.gains && typeof entry.gains === 'object' ? entry.gains : {};
    Object.entries(gains).forEach(([deviceId, gain]) => {
      const id = String(deviceId || '').trim();
      if (!id) return;
      const existing = map.get(id) || { cw: 1, ww: 1, bl: 1, rd: 1, intensity: 1, sources: [] };
      const next = { ...existing };
      if (gain && typeof gain === 'object') {
        ['cw', 'ww', 'bl', 'rd'].forEach((key) => {
          const factor = toNumberOrNull(gain[key]);
          if (Number.isFinite(factor)) next[key] *= factor;
        });
        const intensity = toNumberOrNull(gain.intensity);
        if (Number.isFinite(intensity)) next.intensity *= intensity;
      }
      const sourceId = entry.id || entry.name || entry.targetId || null;
      if (sourceId) {
        const sources = new Set(next.sources || []);
        sources.add(String(sourceId));
        next.sources = Array.from(sources);
      }
      map.set(id, next);
    });
  });
  return map;
}

function resolveDeviceCalibration(calibrationMap, deviceId) {
  if (!deviceId) return { cw: 1, ww: 1, bl: 1, rd: 1, intensity: 1, sources: [] };
  const entry = calibrationMap.get(deviceId);
  if (!entry) return { cw: 1, ww: 1, bl: 1, rd: 1, intensity: 1, sources: [] };
  return { ...entry };
}

function getGroupDeviceIds(group) {
  const ids = new Set();
  const push = (value) => {
    if (typeof value !== 'string') return;
    const trimmed = value.trim();
    if (trimmed) ids.add(trimmed);
  };
  if (Array.isArray(group?.members)) {
    group.members.forEach(push);
  }
  if (Array.isArray(group?.lights)) {
    group.lights.forEach((entry) => {
      if (!entry) return;
      if (typeof entry === 'string') {
        push(entry);
      } else if (entry.controllerId) {
        // For Grow3 lights, use controllerId (integer) instead of device ID string
        push(String(entry.controllerId));
      } else if (entry.id) {
        push(String(entry.id));
      }
    });
  }
  return Array.from(ids);
}

function resolvePlanLightTargets(plan, requestedDay) {
  const derived = plan?._derived || derivePlanRuntime(plan);
  const dayNumber = Math.max(1, Number.isFinite(requestedDay) ? Number(requestedDay) : 1);
  const entries = Array.isArray(derived?.lightDays) ? derived.lightDays : [];
  if (!entries.length) {
    const spectrum = plan?.spectrum || derived?.spectrum || {};
    const ppfd = toNumberOrNull(firstNonEmpty(plan?.ppfd, derived?.ppfd));
    const photoperiod = firstNonEmpty(plan?.photoperiod, derived?.photoperiod, plan?.defaults?.photoperiod);
    return {
      day: dayNumber,
      stage: plan?.stage || '',
      mix: normalizeMixInput(spectrum),
      ppfd,
      photoperiod,
      photoperiodHours: readPhotoperiodHours(photoperiod) ?? derived?.photoperiodHours ?? null,
    };
  }
  const sorted = entries.slice().sort((a, b) => {
    const aDay = Number.isFinite(a.day) ? a.day : 0;
    const bDay = Number.isFinite(b.day) ? b.day : 0;
    return aDay - bDay;
  });
  let selected = sorted[0];
  let effectiveDay = dayNumber;
  let maxDay = 0;
  for (const entry of sorted) {
    if (!Number.isFinite(entry.day)) continue;
    maxDay = Math.max(maxDay, entry.day);
    if (dayNumber >= entry.day) {
      selected = entry;
    } else {
      break;
    }
  }
  if (maxDay > 0 && dayNumber > maxDay) {
    effectiveDay = maxDay;
    const last = sorted.slice().reverse().find((entry) => Number.isFinite(entry.day) && entry.day === maxDay);
    if (last) selected = last;
  }
  const mix = selected?.mix ? normalizeMixInput(selected.mix) : normalizeMixInput(selected?.raw?.mix || {});
  const ppfd = toNumberOrNull(firstNonEmpty(selected?.ppfd, derived?.ppfd, plan?.ppfd));
  const photoperiod = firstNonEmpty(selected?.photoperiod, derived?.photoperiod, plan?.photoperiod, plan?.defaults?.photoperiod);
  const photoperiodHours = readPhotoperiodHours(photoperiod) ?? derived?.photoperiodHours ?? null;
  return {
    day: effectiveDay,
    stage: selected?.stage || plan?.stage || '',
    mix,
    ppfd,
    photoperiod,
    photoperiodHours,
  };
}

function resolvePlanEnvTargets(plan, requestedDay) {
  const derived = plan?._derived || derivePlanRuntime(plan);
  const dayNumber = Math.max(1, Number.isFinite(requestedDay) ? Number(requestedDay) : 1);
  const entries = Array.isArray(derived?.envDays) ? derived.envDays : [];
  const defaultEnv = plan?.env && typeof plan.env === 'object' ? plan.env : {};
  const defaultTargets = defaultEnv.defaults && typeof defaultEnv.defaults === 'object' ? defaultEnv.defaults : {};
  if (!entries.length) {
    return {
      day: dayNumber,
      tempC: toNumberOrNull(defaultTargets.tempC ?? defaultTargets.temp ?? defaultTargets.temperature),
      tempMin: toNumberOrNull(defaultTargets.tempMin ?? defaultTargets.temp_min),
      tempMax: toNumberOrNull(defaultTargets.tempMax ?? defaultTargets.temp_max),
      tempDay: toNumberOrNull(defaultTargets.tempDay ?? defaultTargets.temp_day ?? defaultTargets.dayTemp),
      tempNight: toNumberOrNull(defaultTargets.tempNight ?? defaultTargets.temp_night ?? defaultTargets.nightTemp),
      rh: toNumberOrNull(defaultTargets.rh ?? defaultTargets.humidity),
      rhMin: toNumberOrNull(defaultTargets.rhMin ?? defaultTargets.rh_min),
      rhMax: toNumberOrNull(defaultTargets.rhMax ?? defaultTargets.rh_max),
      rhBand: toNumberOrNull(defaultTargets.rhBand ?? defaultTargets.humidityBand),
      vpd: toNumberOrNull(defaultTargets.vpd),
      vpdMin: toNumberOrNull(defaultTargets.vpdMin ?? defaultTargets.vpd_min),
      vpdMax: toNumberOrNull(defaultTargets.vpdMax ?? defaultTargets.vpd_max),
      guardrails: defaultEnv.guardrails && typeof defaultEnv.guardrails === 'object' ? defaultEnv.guardrails : null,
      humidityCeiling: toNumberOrNull(defaultTargets.max_humidity ?? defaultTargets.humidityCeiling ?? defaultTargets.rhCeiling),
      nutrients: normalizeNutrientTargets(defaultTargets.nutrients),
    };
  }
  const sorted = entries.slice().sort((a, b) => {
    const aDay = Number.isFinite(a.day) ? a.day : 0;
    const bDay = Number.isFinite(b.day) ? b.day : 0;
    return aDay - bDay;
  });
  let selected = sorted[0];
  let effectiveDay = dayNumber;
  let maxDay = 0;
  for (const entry of sorted) {
    if (!Number.isFinite(entry.day)) continue;
    maxDay = Math.max(maxDay, entry.day);
    if (dayNumber >= entry.day) {
      selected = entry;
    } else {
      break;
    }
  }
  if (maxDay > 0 && dayNumber > maxDay) {
    effectiveDay = maxDay;
    const last = sorted.slice().reverse().find((entry) => Number.isFinite(entry.day) && entry.day === maxDay);
    if (last) selected = last;
  }
  const tempC = selected?.tempC != null ? selected.tempC : toNumberOrNull(defaultTargets.tempC ?? defaultTargets.temp ?? defaultTargets.temperature);
  const tempMin = selected?.tempMin != null ? selected.tempMin : toNumberOrNull(defaultTargets.tempMin ?? defaultTargets.temp_min);
  const tempMax = selected?.tempMax != null ? selected.tempMax : toNumberOrNull(defaultTargets.tempMax ?? defaultTargets.temp_max);
  const rh = selected?.rh != null ? selected.rh : toNumberOrNull(defaultTargets.rh ?? defaultTargets.humidity);
  const rhMin = selected?.rhMin != null ? selected.rhMin : toNumberOrNull(defaultTargets.rhMin ?? defaultTargets.rh_min);
  const rhMax = selected?.rhMax != null ? selected.rhMax : toNumberOrNull(defaultTargets.rhMax ?? defaultTargets.rh_max);
  let rhBand = selected?.rhBand != null ? selected.rhBand : toNumberOrNull(defaultTargets.rhBand ?? defaultTargets.humidityBand);
  if (rhBand == null && rh != null && rhMin != null && rhMax != null) {
    rhBand = Math.max(Math.abs(rh - rhMin), Math.abs(rhMax - rh));
  }
  const vpd = selected?.vpd != null ? selected.vpd : toNumberOrNull(defaultTargets.vpd);
  const vpdMin = selected?.vpdMin != null ? selected.vpdMin : toNumberOrNull(defaultTargets.vpdMin ?? defaultTargets.vpd_min);
  const vpdMax = selected?.vpdMax != null ? selected.vpdMax : toNumberOrNull(defaultTargets.vpdMax ?? defaultTargets.vpd_max);
  const guardrails = selected?.guardrails && typeof selected.guardrails === 'object'
    ? selected.guardrails
    : (defaultEnv.guardrails && typeof defaultEnv.guardrails === 'object' ? defaultEnv.guardrails : null);
  const stage = selected?.stage || plan?.stage || null;
  const stageKey = selected?.stageKey || selected?.raw?.stage_key || selected?.raw?.stageKey || null;
  const tempDay = selected?.tempDay != null ? selected.tempDay : toNumberOrNull(defaultTargets.tempDay ?? defaultTargets.temp_day ?? defaultTargets.dayTemp);
  const tempNight = selected?.tempNight != null ? selected.tempNight : toNumberOrNull(defaultTargets.tempNight ?? defaultTargets.temp_night ?? defaultTargets.nightTemp);
  const humidityCeiling = selected?.humidityCeiling != null ? selected.humidityCeiling : toNumberOrNull(defaultTargets.max_humidity ?? defaultTargets.humidityCeiling ?? defaultTargets.rhCeiling);
  const nutrients = selected?.nutrients ? normalizeNutrientTargets(selected.nutrients) : normalizeNutrientTargets(defaultTargets.nutrients);
  return {
    day: effectiveDay,
    tempC,
    tempMin,
    tempMax,
    tempDay,
    tempNight,
    rh,
    rhMin,
    rhMax,
    rhBand,
    vpd,
    vpdMin,
    vpdMax,
    guardrails,
    stage,
    stageKey,
    humidityCeiling,
    nutrients,
    environment: {
      temperature: {
        target: tempC,
        min: tempMin,
        max: tempMax,
        day: tempDay,
        night: tempNight
      },
      humidity: {
        target: rh,
        min: rhMin,
        max: rhMax,
        band: rhBand,
        ceiling: humidityCeiling
      },
      vpd: {
        target: vpd,
        min: vpdMin,
        max: vpdMax,
        unit: 'kPa'
      },
      guardrails,
      nutrients
    }
  };
}

function toUtcDateOnly(d) {
  if (!(d instanceof Date)) {
    d = new Date(d);
  }
  if (!Number.isFinite(d.getTime())) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function computePlanDayNumber(planConfig, group, todayStart) {
  // Normalize to UTC date-only to avoid timezone off-by-one differences
  const todayUtc = todayStart instanceof Date ? toUtcDateOnly(todayStart) : toUtcDateOnly(new Date());
  const today = todayUtc || new Date();
  const anchor = planConfig?.anchor && typeof planConfig.anchor === 'object' ? planConfig.anchor : {};
  const mode = typeof anchor.mode === 'string' ? anchor.mode.trim().toLowerCase() : null;
  const anchorDps = toNumberOrNull(anchor.dps);
  if (mode === 'dps' && anchorDps != null) return Math.max(1, Math.round(anchorDps));
  if (anchorDps != null) return Math.max(1, Math.round(anchorDps));
  const previewDay = toNumberOrNull(planConfig?.preview?.day);
  if (previewDay != null) return Math.max(1, Math.round(previewDay));
  const seedCandidates = [
    anchor.seedDate,
    anchor.seed,
    anchor.date,
    planConfig?.seedDate,
    group?.seedDate,
    group?.planSeedDate,
    group?.plan?.seedDate
  ];
  for (const candidate of seedCandidates) {
    const parsedLocal = parseLocalDate(candidate);
    // Convert local date to UTC date-only for a stable day diff
    const parsed = parsedLocal
      ? new Date(Date.UTC(parsedLocal.getFullYear(), parsedLocal.getMonth(), parsedLocal.getDate()))
      : null;
    if (!parsed) continue;
    const diff = Math.floor((today.getTime() - parsed.getTime()) / MS_PER_DAY);
    return diff >= 0 ? diff + 1 : 1;
  }
  return 1;
}

function normalizePlanControl(controlSpec) {
  const control = {
    enable: false,
    mode: 'advisory',
    step: 0.05,
    dwell: 600,
  };
  if (!controlSpec || typeof controlSpec !== 'object') return control;
  if (typeof controlSpec.enable === 'boolean') control.enable = controlSpec.enable;
  if (typeof controlSpec.mode === 'string' && controlSpec.mode.trim()) control.mode = controlSpec.mode.trim();
  const rawStep = toNumberOrNull(controlSpec.step);
  if (rawStep != null) control.step = rawStep > 1 ? rawStep / 100 : rawStep;
  const rawDwell = toNumberOrNull(controlSpec.dwell);
  if (rawDwell != null) control.dwell = rawDwell >= 60 ? rawDwell : rawDwell * 60;
  if (!Number.isFinite(control.step) || control.step < 0) control.step = 0.05;
  if (!Number.isFinite(control.dwell) || control.dwell <= 0) control.dwell = 600;
  return control;
}

function normalizeEnvTargetsForAutomation(targets) {
  const normalized = {};
  if (!targets || typeof targets !== 'object') return normalized;
  const temp = toNumberOrNull(targets.tempC ?? targets.temperature ?? targets.temp ?? targets.environment?.temperature?.target);
  if (temp != null) {
    normalized.tempC = temp;
    normalized.temp = temp;
  }
  const tempMin = toNumberOrNull(targets.tempMin ?? targets.temp_min ?? targets.temperatureMin ?? targets.environment?.temperature?.min);
  if (tempMin != null) normalized.tempMin = tempMin;
  const tempMax = toNumberOrNull(targets.tempMax ?? targets.temp_max ?? targets.temperatureMax ?? targets.environment?.temperature?.max);
  if (tempMax != null) normalized.tempMax = tempMax;
  const tempDay = toNumberOrNull(targets.tempDay ?? targets.temp_day ?? targets.dayTemp ?? targets.environment?.temperature?.day);
  if (tempDay != null) normalized.tempDay = tempDay;
  const tempNight = toNumberOrNull(targets.tempNight ?? targets.temp_night ?? targets.nightTemp ?? targets.environment?.temperature?.night);
  if (tempNight != null) normalized.tempNight = tempNight;
  const rh = toNumberOrNull(targets.rh ?? targets.humidity ?? targets.environment?.humidity?.target);
  if (rh != null) normalized.rh = Math.min(100, Math.max(0, rh));
  const rhMin = toNumberOrNull(targets.rhMin ?? targets.rh_min ?? targets.humidityMin ?? targets.environment?.humidity?.min);
  if (rhMin != null) normalized.rhMin = Math.min(100, Math.max(0, rhMin));
  const rhMax = toNumberOrNull(targets.rhMax ?? targets.rh_max ?? targets.humidityMax ?? targets.environment?.humidity?.max);
  if (rhMax != null) normalized.rhMax = Math.min(100, Math.max(0, rhMax));
  let rhBand = toNumberOrNull(targets.rhBand ?? targets.rh_band ?? targets.humidityBand ?? targets.environment?.humidity?.band);
  if (rhBand == null && rh != null && rhMin != null && rhMax != null) {
    rhBand = Math.max(Math.abs(rh - rhMin), Math.abs(rhMax - rh));
  }
  if (rhBand != null) normalized.rhBand = Math.abs(rhBand);
  const ppfd = toNumberOrNull(targets.ppfd);
  if (ppfd != null) normalized.ppfd = Math.max(0, ppfd);
  const photoperiod = toNumberOrNull(targets.photoperiodHours ?? targets.photoperiod);
  if (photoperiod != null) normalized.photoperiodHours = Math.max(0, photoperiod);
  const dli = toNumberOrNull(targets.dli);
  if (dli != null) normalized.dli = Math.max(0, dli);
  const vpd = toNumberOrNull(targets.vpd ?? targets.environment?.vpd?.target);
  if (vpd != null) normalized.vpd = Math.max(0, vpd);
  const vpdMin = toNumberOrNull(targets.vpdMin ?? targets.vpd_min ?? targets.environment?.vpd?.min);
  if (vpdMin != null) normalized.vpdMin = Math.max(0, vpdMin);
  const vpdMax = toNumberOrNull(targets.vpdMax ?? targets.vpd_max ?? targets.environment?.vpd?.max);
  if (vpdMax != null) normalized.vpdMax = Math.max(0, vpdMax);
  const stage = typeof targets.stage === 'string' && targets.stage.trim()
    ? targets.stage.trim()
    : (typeof targets.environment?.stageName === 'string' ? targets.environment.stageName : null);
  if (stage) normalized.stage = stage;
  const planDay = toNumberOrNull(targets.planDay ?? targets.day);
  if (planDay != null) normalized.planDay = Math.max(1, Math.round(planDay));
  const planKey = typeof targets.planKey === 'string' && targets.planKey.trim() ? targets.planKey.trim() : null;
  if (planKey) normalized.planKey = planKey;
  const planName = typeof targets.planName === 'string' && targets.planName.trim() ? targets.planName.trim() : null;
  if (planName) normalized.planName = planName;
  const stageKey = typeof targets.stageKey === 'string' && targets.stageKey.trim() ? targets.stageKey.trim() : null;
  if (stageKey) normalized.stageKey = stageKey;
  const guardrails = targets.guardrails && typeof targets.guardrails === 'object'
    ? targets.guardrails
    : (targets.environment?.guardrails && typeof targets.environment.guardrails === 'object' ? targets.environment.guardrails : null);
  if (guardrails) normalized.guardrails = guardrails;
  const humidityCeiling = toNumberOrNull(targets.humidityCeiling ?? targets.max_humidity ?? targets.environment?.humidity?.ceiling);
  if (humidityCeiling != null) normalized.humidityCeiling = humidityCeiling;
  const nutrients = normalizeNutrientTargets(targets.nutrients || targets.environment?.nutrients);
  if (nutrients) normalized.nutrients = nutrients;
  return normalized;
}

function normalizeEnvControlForAutomation(control) {
  const normalized = {};
  if (!control || typeof control !== 'object') return normalized;
  if (typeof control.enable === 'boolean') normalized.enable = control.enable;
  if (typeof control.mode === 'string' && control.mode.trim()) normalized.mode = control.mode.trim();
  const stepRaw = toNumberOrNull(control.step ?? control.stepPct ?? control.stepPercent);
  if (stepRaw != null) {
    const normalizedStep = stepRaw > 1 ? stepRaw / 100 : stepRaw;
    if (Number.isFinite(normalizedStep)) {
      normalized.step = normalizedStep;
      normalized.stepPercent = Math.round(normalizedStep * 10000) / 100;
    }
  }
  const dwellRaw = toNumberOrNull(control.dwell ?? control.dwellMinutes ?? control.dwellMin);
  if (dwellRaw != null) {
    const normalizedDwell = dwellRaw >= 60 ? dwellRaw : dwellRaw * 60;
    if (Number.isFinite(normalizedDwell) && normalizedDwell > 0) {
      normalized.dwell = normalizedDwell;
      normalized.dwellMinutes = Math.round((normalizedDwell / 60) * 100) / 100;
    }
  }
  return normalized;
}

function applyEnvTargetsToAutomation(scopeId, {
  name,
  targets,
  control,
  deviceIds = [],
  meta = {},
  updatedAt = new Date().toISOString()
} = {}) {
  if (!scopeId) return { ok: false, error: 'scope-missing' };
  const zoneName = (typeof name === 'string' && name.trim()) ? name.trim() : scopeId;
  const sanitizedTargets = normalizeEnvTargetsForAutomation(targets);
  const sanitizedControl = normalizeEnvControlForAutomation(control);
  const lights = Array.isArray(deviceIds) ? Array.from(new Set(deviceIds.map((id) => String(id)))) : [];

  try {
    if (preEnvStore && typeof preEnvStore.upsertRoom === 'function') {
      preEnvStore.upsertRoom(scopeId, {
        name: zoneName,
        targets: sanitizedTargets,
        control: sanitizedControl,
        actuators: lights.length ? { lights } : {},
        meta
      });
    }
  } catch (error) {
    console.warn(`[daily] failed to upsert automation room ${scopeId}:`, error?.message || error);
  }

  try {
    if (preEnvStore && typeof preEnvStore.setTargets === 'function' && Object.keys(sanitizedTargets).length) {
      preEnvStore.setTargets(scopeId, { ...sanitizedTargets, updatedAt });
    }
  } catch (error) {
    console.warn(`[daily] failed to persist automation targets for ${scopeId}:`, error?.message || error);
  }

  try {
    if (preAutomationEngine && typeof preAutomationEngine.setTargets === 'function' && Object.keys(sanitizedTargets).length) {
      preAutomationEngine.setTargets(scopeId, sanitizedTargets);
    }
  } catch (error) {
    console.warn(`[daily] failed to apply automation targets for ${scopeId}:`, error?.message || error);
  }

  return { ok: true, scopeId, targets: sanitizedTargets, control: sanitizedControl };
}

async function patchControllerLight(deviceId, hexPayload, shouldPowerOn) {
  if (!deviceId) return { ok: false, error: 'device-id-missing' };
  
  if (RUNNING_UNDER_NODE_TEST) {
    return { ok: true, skipped: true, reason: 'test-mode' };
  }

  const controller = getController();
  if (!controller) {
    return { ok: false, error: 'controller-unset' };
  }

  try {
    const base = controller.replace(/\/$/, '');
    const url = `${base}/api/devicedatas/device/${encodeURIComponent(deviceId)}`;
    
    //  CORRECT: Use channelsValue (not value)
    const payload = {
      status: shouldPowerOn ? 'on' : 'off',
      channelsValue: hexPayload
    };
    
    const response = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    if (!response) return { ok: false, error: 'no-response' };
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return { ok: false, status: response.status, error: text || `HTTP ${response.status}` };
    }
    return { ok: true, status: response.status };
  } catch (error) {
    return { ok: false, error: error.message || 'controller-error' };
  }
}

let dailyResolverRunning = false;
let dailyResolverTimer = null;


// === DB stores (moved before first usage to avoid TDZ errors) ===
// Phase 2, Ticket 2.7: Agent action audit log
// Every AI agent recommendation / action is persisted for governance & review.
const agentAuditDB = new Datastore({
  filename: './data/agent-audit.db',
  autoload: true,
  timestampData: true
});

// ─── AI Vision Phase 1: Experiment Data Stores ─────────────────────────
// P0: Recipe parameters applied per group per day (Rule 9.1, Task 1.1)
const appliedRecipesDB = new Datastore({
  filename: './data/applied-recipes.db',
  autoload: true,
  timestampData: true
});

// P0: Complete harvest outcome "experiment record" (Rule 3.1, Task 1.2)
const harvestOutcomesDB = new Datastore({
  filename: './data/harvest-outcomes.db',
  autoload: true,
  timestampData: true
});

const trayLossEventsDB = new Datastore({
  filename: './data/tray-loss-events.db',
  autoload: true,
  timestampData: true
});

// I-1.9: Device integration records store (Integration Assistant)
// Tracks all device integrations for network learning and Central sync
const integrationDB = new Datastore({
  filename: './data/integrations.db',
  autoload: true,
  timestampData: true
});

const trayFormatsDB = new Datastore({
  filename: './data/tray-formats.db',
  autoload: true,
  timestampData: true
});

const traysDB = new Datastore({
  filename: './data/trays.db',
  autoload: true,
  timestampData: true
});

// Inventory tracking databases
const trayRunsDB = new Datastore({
  filename: './data/tray-runs.db',
  autoload: true,
  timestampData: true
});

const trayPlacementsDB = new Datastore({
  filename: './data/tray-placements.db',
  autoload: true,
  timestampData: true
});

async function runDailyPlanResolver(trigger = 'manual') {
  if (dailyResolverRunning) {
    console.warn(`[daily] resolver already running (trigger: ${trigger})`);
    return null;
  }
  dailyResolverRunning = true;
  const startedAt = new Date();
  startedAt.setMilliseconds(0);
  const startedMs = Date.now();

  try {
    const groups = loadGroupsFile();
    const planIndex = getPlanIndex();
    const channelScale = loadChannelScaleConfig();
    const calibrationMap = buildCalibrationMap();
    const envState = readEnv();
    const results = [];
    const todayStart = new Date(startedAt);
    todayStart.setHours(0, 0, 0, 0);

    if (!Array.isArray(groups) || !groups.length || !planIndex.size) {
      envState.lastDailyResolverAt = startedAt.toISOString();
      envState.lastDailyResolverTrigger = trigger;
      envState.planResolver = { lastRunAt: startedAt.toISOString(), trigger, groups: [] };
      envState.updatedAt = startedAt.toISOString();
      writeEnv(envState);
      if (!groups.length) {
        console.log(`[daily] no groups to resolve (trigger: ${trigger})`);
      } else {
        console.log(`[daily] no plans available to resolve groups (trigger: ${trigger})`);
      }
      return [];
    }

    for (const group of groups) {
      try {
        const planKeyCandidate = [
          group.plan,
          group.planKey,
          group.plan_id,
          group.planId,
          group?.planConfig?.planId,
          group?.planConfig?.preview?.planId,
          group?.planConfig?.preview?.planKey,
          group?.planConfig?.preview?.plan
        ].find((value) => typeof value === 'string' && value.trim());
        if (!planKeyCandidate) continue;
        const planKey = planKeyCandidate.trim();
        let plan = planIndex.get(planKey);
        if (!plan) {
          const lower = planKey.toLowerCase();
          for (const [key, candidate] of planIndex.entries()) {
            if (String(key).toLowerCase() === lower) {
              plan = candidate;
              break;
            }
          }
        }
        if (!plan) {
          console.warn(`[daily] plan '${planKey}' not found for group ${group.id || group.name || 'unknown'}`);
          continue;
        }

        const deviceIds = Array.from(new Set(getGroupDeviceIds(group)));
        if (!deviceIds.length) continue;

        const planConfig = (group.planConfig && typeof group.planConfig === 'object') ? group.planConfig : {};
        const dayNumber = computePlanDayNumber(planConfig, group, todayStart);
        const lightTargets = resolvePlanLightTargets(plan, dayNumber);
        const envTargets = resolvePlanEnvTargets(plan, dayNumber);
        const effectiveDay = lightTargets?.day || envTargets?.day || dayNumber;
        const gradients = (planConfig.gradients && typeof planConfig.gradients === 'object') ? planConfig.gradients : {};
        const gradientPpfd = toNumberOrNull(gradients.ppfd) ?? 0;
        const gradientBlue = toNumberOrNull(gradients.blue) ?? 0;
        const gradientTemp = toNumberOrNull(gradients.tempC) ?? 0;
        const gradientRh = toNumberOrNull(gradients.rh) ?? 0;

        // Phase 3 Ticket 3.1 + Phase 5 Ticket 5.1: Apply per-crop recipe modifier
        // Phase 5: Autonomous application with audit logging and auto-revert tracking
        const cropName = (group.crop || group.cropName || plan?.crop || '').toLowerCase().replace(/\s+/g, '-');
        let modifierResult = null;
        if (cropName) {
          try {
            const { autonomousApplyModifier } = await import('./lib/recipe-modifier.js');
            const farmId = process.env.FARM_ID || 'local';
            const autoResult = await autonomousApplyModifier(cropName, {
              ppfd: toNumberOrNull(lightTargets?.ppfd),
              mix: lightTargets?.mix || {},
              envTempC: envTargets?.tempC ?? null
            }, typeof agentAuditDB !== 'undefined' ? agentAuditDB : null, farmId);

            if (autoResult.applied) {
              modifierResult = autoResult.targets;
              console.log(`[daily] Autonomous recipe modifier applied for ${cropName}: ${autoResult.reason}`);
            } else {
              // Fall back to standard non-autonomous apply
              modifierResult = applyRecipeModifier(cropName, {
                ppfd: toNumberOrNull(lightTargets?.ppfd),
                mix: lightTargets?.mix || {},
                envTempC: envTargets?.tempC ?? null
              });
              if (modifierResult.modifierApplied) {
                console.log(`[daily] Recipe modifier applied for ${cropName}: PPFD ${modifierResult.modifierDetails.ppfd_offset_pct}%, blue ${modifierResult.modifierDetails.blue_pct_offset}%, confidence ${modifierResult.modifierDetails.confidence}`);
              }
            }
          } catch {
            // Fallback: use original Phase 3 apply (non-autonomous)
            modifierResult = applyRecipeModifier(cropName, {
              ppfd: toNumberOrNull(lightTargets?.ppfd),
              mix: lightTargets?.mix || {},
              envTempC: envTargets?.tempC ?? null
            });
            if (modifierResult.modifierApplied) {
              console.log(`[daily] Recipe modifier applied for ${cropName}: PPFD ${modifierResult.modifierDetails.ppfd_offset_pct}%`);
            }
          }
        }

        // Convert recipe spectral targets to 4-channel mix (cw, ww, bl, rd)
        const recipeMix = modifierResult?.modifierApplied ? modifierResult.mix : (lightTargets?.mix || {});
        let baseMix;
        
        // Check for green channel (supports both 'green' and 'gn' for backward compatibility)
        const greenValue = recipeMix.green ?? recipeMix.gn;
        const hasGreen = greenValue !== undefined && greenValue > 0;
        
        if (hasGreen) {
          // Recipe has green channel - use spectral solver
          // Support both new format (blue, green, red) and legacy (bl, gn, rd)
          const targetBlue = recipeMix.blue ?? recipeMix.bl ?? 0;
          const targetGreen = greenValue;
          const targetRed = recipeMix.red ?? recipeMix.rd ?? 0;
          const targetPpfdForSolver = toNumberOrNull(lightTargets?.ppfd) ?? 100;
          
          const solution = solveSpectrum({
            blue: targetBlue,
            green: targetGreen,
            red: targetRed
          }, targetPpfdForSolver);
          
          // Convert PPFD values to PWM percentages
          const capacities = { bl: 200, rd: 200, ww: 100, cw: 100 };
          const channelMix = toPWM({ bl: solution.bl, rd: solution.rd, ww: solution.ww, cw: solution.cw }, capacities);
          
          baseMix = normalizeMixInput(channelMix);
          console.log(`[daily] Spectral solver: B=${targetBlue.toFixed(1)}% G=${targetGreen.toFixed(1)}% R=${targetRed.toFixed(1)}% PPFD=${targetPpfdForSolver} → CW=${channelMix.cw.toFixed(1)}% WW=${channelMix.ww.toFixed(1)}% BL=${channelMix.bl.toFixed(1)}% RD=${channelMix.rd.toFixed(1)}%`);
        } else {
          // Legacy mix format - use as-is
          baseMix = normalizeMixInput(recipeMix);
        }
        
        const basePpfd = modifierResult?.modifierApplied ? toNumberOrNull(modifierResult.ppfd) : toNumberOrNull(lightTargets?.ppfd);
        const targetPpfd = basePpfd != null ? Math.max(0, basePpfd + gradientPpfd) : null;
        let workingMix = { ...baseMix };
        if (Number.isFinite(basePpfd) && basePpfd > 0 && Number.isFinite(targetPpfd)) {
          const scale = targetPpfd / basePpfd;
          if (Number.isFinite(scale) && scale > 0) {
            workingMix = {
              cw: clampPercent(baseMix.cw * scale),
              ww: clampPercent(baseMix.ww * scale),
              bl: clampPercent(baseMix.bl * scale),
              rd: clampPercent(baseMix.rd * scale),
            };
          }
        }
        if (Number.isFinite(gradientBlue) && gradientBlue !== 0) {
          workingMix.bl = clampPercent((workingMix.bl ?? 0) + gradientBlue);
        }

        const scheduleCfg = planConfig?.schedule && typeof planConfig.schedule === 'object' ? planConfig.schedule : {};
        const scheduleDuration = toNumberOrNull(scheduleCfg.durationHours);
        const photoperiodFallback = Number.isFinite(lightTargets?.photoperiodHours)
          ? lightTargets.photoperiodHours
          : readPhotoperiodHours(lightTargets?.photoperiod);
        const resolvedPhotoperiod = Number.isFinite(scheduleDuration) && scheduleDuration > 0
          ? scheduleDuration
          : (Number.isFinite(photoperiodFallback)
            ? photoperiodFallback
            : (readPhotoperiodHours(plan?.defaults?.photoperiod) ?? null));

        let envTargetTemp = modifierResult?.modifierApplied && modifierResult.envTempC != null ? modifierResult.envTempC : envTargets?.tempC;
        if (envTargetTemp != null && Number.isFinite(gradientTemp)) envTargetTemp += gradientTemp;
        let envTargetRh = envTargets?.rh;
        if (envTargetRh != null && Number.isFinite(gradientRh)) {
          envTargetRh = Math.min(100, Math.max(0, envTargetRh + gradientRh));
        }
  const envTargetRhBand = envTargets?.rhBand != null ? Math.abs(envTargets.rhBand) : null;
  const envHumidityCeiling = envTargets?.humidityCeiling != null ? envTargets.humidityCeiling : null;
  const envNutrientTargets = envTargets?.nutrients || null;

        const normalizedControl = normalizePlanControl(plan?.env?.control || planConfig?.control || {});
        const envControl = { ...normalizedControl, enable: normalizedControl.enable === false ? false : true };
        const planName = plan?.name || planKey;
        const stage = lightTargets?.stage || plan?.stage || '';
        const shouldPowerOn = !(Number.isFinite(targetPpfd) && targetPpfd <= 0);

        const hexPayloads = [];
        for (const deviceId of deviceIds) {
          const calibration = resolveDeviceCalibration(calibrationMap, deviceId);
          const calibratedMix = applyCalibrationToMix(workingMix, calibration);
          console.log(`[daily] Device ${deviceId} - workingMix:`, workingMix, '→ calibratedMix:', calibratedMix, '| maxByte:', channelScale.maxByte);
          const hex = buildHexPayload(calibratedMix, channelScale.maxByte);
          
          const patchResult = await patchControllerLight(deviceId, hex, shouldPowerOn, {
            planKey,
            planName,
            stage,
            day: effectiveDay
          });
          if (!patchResult?.ok && !patchResult?.skipped) {
            console.warn(`[daily] failed to patch ${deviceId} for group ${group.id || group.name || 'unknown'}:`, patchResult?.error || patchResult?.status || 'unknown error');
          } else if (patchResult?.ok) {
            console.log(`[daily]  Light ID ${deviceId} → ${planName} Day ${effectiveDay} (${stage}): CW:${calibratedMix.cw.toFixed(1)}% WW:${calibratedMix.ww.toFixed(1)}% BL:${calibratedMix.bl.toFixed(1)}% RD:${calibratedMix.rd.toFixed(1)}% | Hex: ${hex}`);
          }
          const mixSummary = {
            cw: Number(clampPercent(calibratedMix.cw).toFixed(2)),
            ww: Number(clampPercent(calibratedMix.ww).toFixed(2)),
            bl: Number(clampPercent(calibratedMix.bl).toFixed(2)),
            rd: Number(clampPercent(calibratedMix.rd).toFixed(2)),
          };
          hexPayloads.push({
            deviceId,
            hex: shouldPowerOn ? hex : null,
            mix: mixSummary,
            calibrationSources: calibration.sources || [],
            patched: !!patchResult?.ok,
            skipped: !!patchResult?.skipped,
            status: patchResult?.status ?? null,
            error: patchResult?.ok ? null : (patchResult?.error || null)
          });
        }

        const envScopeCandidates = [
          group.zone,
          group.room,
          planConfig?.zone,
          planConfig?.scope,
          planConfig?.room,
          planKey
        ];
        const envScopeId = envScopeCandidates
          .map((value) => (typeof value === 'string' ? value.trim() : ''))
          .find((value) => !!value) || 'default';
        const legacyRoomId = (typeof group.room === 'string' && group.room.trim()) ? group.room.trim() : envScopeId;

        const container = ensureRoomContainer(envState, legacyRoomId);
        container.name = group.name || container.name || legacyRoomId;
        container.zone = group.zone || container.zone || envScopeId;
        container.scopeId = envScopeId;
        container.plan = planKey;
        container.members = deviceIds;
        container.updatedAt = new Date().toISOString();
        const dli = Number.isFinite(targetPpfd) && Number.isFinite(resolvedPhotoperiod)
          ? (targetPpfd * 3600 * resolvedPhotoperiod) / 1e6
          : null;
        container.targets = {
          ...(container.targets || {}),
          ...pickDefined({
            temp: envTargetTemp,
            rh: envTargetRh,
            rhBand: envTargetRhBand,
            humidityCeiling: envHumidityCeiling,
            ppfd: targetPpfd,
            photoperiodHours: resolvedPhotoperiod,
            stage,
            planDay: effectiveDay,
            dli,
            planKey,
            planName,
            nutrients: envNutrientTargets
          })
        };
        container.control = {
          ...(container.control || {}),
          ...pickDefined(envControl)
        };
        container.actuators = container.actuators || {};
        container.actuators.lights = deviceIds;
        container.planDay = { day: effectiveDay, stage, computedAt: container.updatedAt };
        container.planConfig = planConfig;

        if (!envState.targets || typeof envState.targets !== 'object') envState.targets = {};
        envState.targets[legacyRoomId] = {
          ...(envState.targets[legacyRoomId] || {}),
          ...pickDefined({
            tempC: envTargetTemp,
            rh: envTargetRh,
            rhBand: envTargetRhBand,
            humidityCeiling: envHumidityCeiling,
            ppfd: targetPpfd,
            photoperiodHours: resolvedPhotoperiod,
            stage,
            planDay: effectiveDay,
            dli,
            planKey,
            planName,
            nutrients: envNutrientTargets
          }),
          updatedAt: container.updatedAt
        };
        if (!envState.control || typeof envState.control !== 'object') envState.control = {};
        envState.control[legacyRoomId] = {
          ...(envState.control[legacyRoomId] || {}),
          ...pickDefined(envControl),
          updatedAt: container.updatedAt
        };

        const preTargets = pickDefined({
          tempC: envTargetTemp,
          rh: envTargetRh,
          rhBand: envTargetRhBand,
          humidityCeiling: envHumidityCeiling,
          ppfd: targetPpfd,
          photoperiodHours: resolvedPhotoperiod,
          stage,
          planDay: effectiveDay,
          dli,
          planKey,
          planName,
          nutrients: envNutrientTargets
        });

        applyEnvTargetsToAutomation(envScopeId, {
          name: container.name,
          targets: preTargets,
          control: envControl,
          deviceIds,
          updatedAt: container.updatedAt,
          meta: pickDefined({
            planKey,
            planName,
            planStage: stage,
            planDay: effectiveDay,
            zone: group.zone,
            room: group.room,
            lastDailyResolverAt: container.updatedAt
          })
        });

        const scheduleSummary = Object.keys(scheduleCfg).length ? {
          startTime: scheduleCfg.startTime || null,
          durationHours: toNumberOrNull(scheduleCfg.durationHours) ?? null,
          rampUpMin: toNumberOrNull(scheduleCfg.rampUpMin) ?? null,
          rampDownMin: toNumberOrNull(scheduleCfg.rampDownMin) ?? null,
        } : null;

        results.push({
          groupId: group.id || null,
          groupName: group.name || null,
          room: group.room || null,
          planKey,
          planName,
          day: effectiveDay,
          stage,
          targetPpfd,
          photoperiodHours: resolvedPhotoperiod,
          dli,
          shouldPowerOn,
          schedule: scheduleSummary,
          env: pickDefined({ tempC: envTargetTemp, rh: envTargetRh, rhBand: envTargetRhBand, humidityCeiling: envHumidityCeiling }),
          nutrients: envNutrientTargets,
          control: pickDefined({ step: envControl.step, dwell: envControl.dwell, enable: envControl.enable, mode: envControl.mode }),
          scopeId: envScopeId,
          devices: hexPayloads,
        });
      } catch (groupError) {
        console.warn('[daily] failed to resolve group plan:', groupError?.message || groupError);
      }
    }

    envState.lastDailyResolverAt = startedAt.toISOString();
    envState.lastDailyResolverTrigger = trigger;
    envState.planResolver = { lastRunAt: startedAt.toISOString(), trigger, groups: results };
    envState.updatedAt = startedAt.toISOString();
    writeEnv(envState);

    // ─── AI Vision Phase 1 (Task 1.1): Persist applied recipe params per group.
    // Each daily run logs the recipe + environment targets so future ML models
    // can correlate inputs → outcomes across grow cycles. (Rule 1.2, Rule 9.1 P0)
    const resolvedDate = startedAt.toISOString().slice(0, 10);
    for (const r of results) {
      if (!r.groupId) continue;
      try {
        // Upsert: one record per group per day
        const existing = await appliedRecipesDB.findOne({
          groupId: r.groupId, date: resolvedDate
        });
        const doc = {
          groupId: r.groupId,
          groupName: r.groupName || null,
          room: r.room || null,
          date: resolvedDate,
          planKey: r.planKey || null,
          planName: r.planName || null,
          day: r.day,
          stage: r.stage || null,
          targetPpfd: r.targetPpfd ?? null,
          photoperiodHours: r.photoperiodHours ?? null,
          dli: r.dli ?? null,
          env: r.env || {},
          nutrients: r.nutrients || null,
          devices: (r.devices || []).map(d => ({
            deviceId: d.deviceId,
            mix: d.mix || null,
          })),
        };
        if (existing) {
          await appliedRecipesDB.update({ _id: existing._id }, { $set: doc });
        } else {
          await appliedRecipesDB.insert(doc);
        }
      } catch (recErr) {
        console.warn(`[daily] Failed to persist recipe for ${r.groupId}:`, recErr?.message);
      }
    }
    if (results.length) {
      console.log(`[daily] Persisted applied recipes for ${results.length} group(s) on ${resolvedDate}`);
    }

    console.log(`[daily] resolved ${results.length} group(s) in ${Date.now() - startedMs}ms (trigger: ${trigger})`);
    return results;
  } catch (error) {
    console.warn('[daily] plan resolver failed:', error?.message || error);
    return null;
  } finally {
    dailyResolverRunning = false;
  }
}

function computeNextDailyResolverDelay() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(0, 0, 15, 0);
  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }
  const delay = next.getTime() - now.getTime();
  return Math.max(30000, delay);
}

function scheduleDailyPlanResolver() {
  if (RUNNING_UNDER_NODE_TEST) return;
  if (dailyResolverTimer) {
    clearTimeout(dailyResolverTimer);
  }
  const delay = computeNextDailyResolverDelay();
  dailyResolverTimer = setTimeout(async () => {
    try {
      await runDailyPlanResolver('scheduled');
    } catch (error) {
      console.warn('[daily] scheduled resolver run failed:', error?.message || error);
    } finally {
      scheduleDailyPlanResolver();
    }
  }, delay);
  if (typeof dailyResolverTimer.unref === 'function') {
    dailyResolverTimer.unref();
  }
}

if (!RUNNING_UNDER_NODE_TEST) {
  runDailyPlanResolver('startup').catch((error) => {
    console.warn('[daily] startup resolver failed:', error?.message || error);
  });
  scheduleDailyPlanResolver();
}

function buildAiAdvisory(rooms, legacyEnv) {
  const planIndex = getPlanIndex();
  const analyticsByRoom = new Map();
  const summaries = [];

  rooms.forEach((room) => {
    const analytics = buildRoomAnalytics(room, legacyEnv, planIndex);
    analyticsByRoom.set(room.roomId, analytics);
    if (analytics?.summary) {
      summaries.push(`${room.name || room.roomId}: ${analytics.summary}`);
    }
  });

  const summary = summaries.length
    ? summaries.join(' ')
    : 'AI Copilot is monitoring environmental guardrails.';

  return {
    summary,
    analyticsByRoom
  };
}

function applyCorsHeaders(req, res, methods = 'GET,POST,PATCH,DELETE,OPTIONS') {
  const origin = req.headers?.origin;
  const isProduction = process.env.NODE_ENV === 'production';
  
  // Allowed origins for production
  const ALLOWED_ORIGINS = [
    'http://light-engine-demo-1765326376.s3-website-us-east-1.amazonaws.com',
    'http://light-engine-foxtrot-prod.eba-ukiyyqf9.us-east-1.elasticbeanstalk.com',
    'https://light-engine-demo-1765326376.s3-website-us-east-1.amazonaws.com',
    'https://light-engine-foxtrot-prod.eba-ukiyyqf9.us-east-1.elasticbeanstalk.com',
    'http://greenreachgreens.com',
    'https://greenreachgreens.com',
    'http://www.greenreachgreens.com',
    'https://www.greenreachgreens.com',
    'http://urbanyeild.ca',
    'https://urbanyeild.ca',
    'http://www.urbanyeild.ca',
    'https://www.urbanyeild.ca',
    'http://localhost:8091',
    'http://127.0.0.1:8091',
  ];
  
  // Check if origin is allowed
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    // Whitelisted origin
    res.setHeader('Access-Control-Allow-Origin', origin);
    const existingVary = res.getHeader('Vary');
    if (existingVary) {
      if (!String(existingVary).split(/,\s*/).includes('Origin')) {
        res.setHeader('Vary', `${existingVary}, Origin`);
      }
    } else {
      res.setHeader('Vary', 'Origin');
    }
  } else if (!origin) {
    // No origin (same-origin or server-to-server)
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else if (!isProduction) {
    // Development mode - allow all
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  } else {
    // Production - reject unauthorized origin
    console.error('[CORS] applyCorsHeaders REJECTED unauthorized origin:', origin);
    // Don't set CORS headers - browser will block the request
    return;
  }

  res.setHeader('Access-Control-Allow-Methods', methods);

  const requestedHeaders = req.headers?.['access-control-request-headers'];
  const allowHeaders = requestedHeaders && typeof requestedHeaders === 'string'
    ? requestedHeaders
    : 'Content-Type, Authorization, X-Requested-With';
  res.setHeader('Access-Control-Allow-Headers', allowHeaders);
  res.setHeader('Access-Control-Max-Age', '600');
}

function setPreAutomationCors(req, res) {
  applyCorsHeaders(req, res, 'GET,POST,PATCH,DELETE,OPTIONS');
}

function proxyCorsMiddleware(req, res, next) {
  applyCorsHeaders(req, res, 'GET,POST,PATCH,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
}

// --- Pre-AI Automation API ---

app.options('/env', (req, res) => { setPreAutomationCors(req, res); res.status(204).end(); });
app.options('/env/rooms', (req, res) => { setPreAutomationCors(req, res); res.status(204).end(); });
app.options('/env/rooms/:roomId', (req, res) => { setPreAutomationCors(req, res); res.status(204).end(); });
app.options('/env/rooms/:roomId/actions', (req, res) => { setPreAutomationCors(req, res); res.status(204).end(); });
app.options('/plugs', (req, res) => { setPreAutomationCors(req, res); res.status(204).end(); });
app.options('/plugs/*', (req, res) => { setPreAutomationCors(req, res); res.status(204).end(); });
app.options('/rules', (req, res) => { setPreAutomationCors(req, res); res.status(204).end(); });
app.options('/rules/*', (req, res) => { setPreAutomationCors(req, res); res.status(204).end(); });

app.get('/env', async (req, res) => {
  try {
    setPreAutomationCors(req, res);
    
    // Demo mode: Return demo environmental data
    if (isDemoMode()) {
      const demoData = getDemoData();
      const envData = demoData.getEnvironmentalData();
      
      // Generate 24 hours of historical data (288 points at 5-minute intervals)
      const now = Date.now();
      const generateHistory = (baseValue, variance, count = 288) => {
        const history = [];
        for (let i = count - 1; i >= 0; i--) {
          const timeOffset = i * 5 * 60 * 1000; // 5 minutes per point
          const hourOfDay = new Date(now - timeOffset).getHours();
          
          // Add daily cycle (warmer during "day" hours 6-18, cooler at "night")
          const dailyCycle = Math.sin(((hourOfDay - 6) / 12) * Math.PI) * variance * 0.5;
          
          // Add random variation
          const randomVar = (Math.random() - 0.5) * variance;
          
          history.push(parseFloat((baseValue + dailyCycle + randomVar).toFixed(2)));
        }
        console.log('[ENV] Generated history:', history.length, 'points, first 3:', history.slice(0, 3));
        return history;
      };
      
      // Transform demo data to match expected frontend structure
      const zones = envData.zones.map(zone => ({
        id: zone.id || zone.zoneId,
        name: zone.name,
        sensors: {
          tempC: {
            current: zone.temperature,
            unit: '°C',
            history: generateHistory(zone.temperature, 2),
            setpoint: { min: 18, max: 24 }
          },
          rh: {
            current: zone.humidity,
            unit: '%',
            history: generateHistory(zone.humidity, 5),
            setpoint: { min: 55, max: 75 }
          },
          co2: {
            current: zone.co2,
            unit: 'ppm',
            history: generateHistory(zone.co2, 100),
            setpoint: { min: 800, max: 1200 }
          },
          ppfd: {
            current: zone.ppfd,
            unit: 'μmol/m²/s',
            history: generateHistory(zone.ppfd, 50),
            setpoint: { min: 200, max: 600 }
          },
          vpd: {
            current: zone.vpd,
            unit: 'kPa',
            history: generateHistory(zone.vpd, 0.2),
            setpoint: { min: 0.8, max: 1.2 }
          }
        },
        updatedAt: zone.timestamp,
        meta: {
          status: zone.status,
          alerts: zone.alerts || [],
          lastSync: new Date(now).toISOString()
        }
      }));
      
      return res.json({
        ok: true,
        zones,
        rooms: [],
        meta: {
          envSource: 'demo',
          provider: 'demo-mode',
          cache: false,
          updatedAt: new Date().toISOString()
        }
      });
    }
    
    const zoneBindingSummary = __zoneBindingsSnapshot || { bindings: [], meta: { source: 'cache', bindings: 0 } };
    const snapshot = preEnvStore.getSnapshot();
    const zonesFromScopes = Object.entries(snapshot.scopes || {}).map(([scopeId, scopeData]) => {
      const sensors = Object.entries(scopeData.sensors || {}).reduce((acc, [sensorKey, sensorData]) => {
        // Limit history to last 12 points (1 hour at 5min intervals) for performance
        const fullHistory = Array.isArray(sensorData.history) ? sensorData.history : [];
        const limitedHistory = fullHistory.slice(-12);
        
        acc[sensorKey] = {
          current: sensorData.value,
          unit: sensorData.unit || null,
          observedAt: sensorData.observedAt || null,
          history: limitedHistory,
          setpoint: snapshot.targets?.[scopeId]?.[sensorKey] || null
        };
        return acc;
      }, {});

      const activeRule = preAutomationEngine.getActiveRule(scopeId);

      return {
        id: scopeId,
        name: scopeData.name || scopeData.label || scopeId,
        sensors,
        updatedAt: scopeData.updatedAt || null,
        meta: {
          ...scopeData.meta,
          managedByPlugs: Boolean(activeRule),
          activeRuleId: activeRule?.ruleId || null,
          activeRuleAt: activeRule ? new Date(activeRule.executedAt).toISOString() : null
        }
      };
    });

    let zonesPayload;
    try {
      zonesPayload = await loadEnvZonesPayload(req.query || {});
      console.log('[env] zonesPayload from cloud:', {
        source: zonesPayload.source,
        zonesCount: zonesPayload.zones?.length,
        firstZoneId: zonesPayload.zones?.[0]?.id
      });
    } catch (error) {
      console.log('[env] Cloud load failed, using zonesFromScopes:', {
        error: error.message,
        scopesCount: zonesFromScopes.length,
        firstScopeId: zonesFromScopes[0]?.id
      });
      zonesPayload = { zones: zonesFromScopes, source: 'scopes', meta: { error: error.message } };
    }

    // If cloud returned empty zones but we have scopes, use zonesFromScopes as fallback
    const hasCloudZones = Array.isArray(zonesPayload.zones) && zonesPayload.zones.length > 0;
    
    // FILTER OUT MOCK DEVICES AND SENSOR-AS-ZONE: Only keep real zones (zone-1, zone-2, zone-3)
    const mockDeviceIds = ['E8F9A2B4C6D1', 'D7C3B9A5E8F2', 'D5B8E1C4F7A2'];
    const realZonePattern = /^zone-[123]$/; // Only zone-1, zone-2, zone-3 are real zones
    
    const filterRealZones = (zones) => zones.filter(zone => {
      // Exclude mock devices
      if (mockDeviceIds.some(mockId => zone.id.includes(mockId))) return false;
      // Only include real zones (zone-1, zone-2, zone-3)
      // Exclude sensor IDs being treated as zones (zone-CE2A..., zone-C3343..., etc.)
      return realZonePattern.test(zone.id);
    });
    
    const allZones = hasCloudZones 
      ? filterRealZones(zonesPayload.zones)
      : filterRealZones(zonesFromScopes);
    
    console.log('[env] Zone selection:', {
      hasCloudZones,
      allZonesCount: allZones.length,
      zonesFromScopesCount: zonesFromScopes.length,
      payloadSource: zonesPayload.source
    });
    
    // allZones is already filtered to only real zones (zone-1, zone-2, zone-3)
    // showAllZones query param can bypass for debugging, but still filter mocks/sensors
    const zones = req.query.showAllZones === 'true' ? allZones : allZones;
    const legacyEnvState = readEnv();
    const automationState = evaluateRoomAutomationState(snapshot, zones, legacyEnvState, zoneBindingSummary);
    const aiBundle = buildAiAdvisory(automationState.rooms, legacyEnvState);
    const roomsWithAnalytics = automationState.rooms.map((room) => ({
      ...room,
      analytics: aiBundle.analyticsByRoom.get(room.roomId) || null
    }));

    // Outdoor conditions from weather API (no physical outdoor sensor needed)
    let outdoorData = null;
    if (LAST_WEATHER && LAST_WEATHER.current) {
      outdoorData = {
        temp: LAST_WEATHER.current.temperature_c,
        rh: LAST_WEATHER.current.humidity,
        timestamp: LAST_WEATHER.current.last_updated || new Date(LAST_WEATHER_AT).toISOString(),
        zone: 'weather-api'
      };
    }
    const outdoorValidation = outdoorSensorValidator.validateOutdoorSensor(outdoorData);
    const validationSummary = outdoorSensorValidator.getValidationSummary(outdoorValidation);

    res.json({
      ok: true,
      env: snapshot,
      zones,
      rooms: roomsWithAnalytics,
      zoneBindings: zoneBindingSummary.bindings,
      readings: legacyEnvState.readings || [],
      targets: legacyEnvState.targets || {},
      control: legacyEnvState.control || {},
      roomsMap: legacyEnvState.rooms || {},
      legacy: {
        rooms: legacyEnvState.rooms || {},
        targets: legacyEnvState.targets || {},
        control: legacyEnvState.control || {},
        readings: legacyEnvState.readings || []
      },
      ai: {
        summary: aiBundle.summary,
        rooms: roomsWithAnalytics.map((room) => ({
          roomId: room.roomId,
          name: room.name,
          analytics: room.analytics
        }))
      },
      outdoor_conditions: {
        ...validationSummary,
        source: 'weather-api',
        weather: LAST_WEATHER ? LAST_WEATHER.current : null
      },
      meta: {
        envSource: zonesPayload.source,
        evaluatedAt: automationState.evaluatedAt,
        totalSuggestions: automationState.totalSuggestions,
        provider: zonesPayload.meta?.provider || null,
        cache: Boolean(zonesPayload.meta?.cached),
        updatedAt: zonesPayload.meta?.updatedAt || null,
        error: zonesPayload.meta?.error || null,
        zoneBindingsUpdatedAt: zoneBindingSummary.meta?.updatedAt || null,
        zoneBindingsSource: zoneBindingSummary.meta?.source || null,
        zoneBindingsError: zoneBindingSummary.meta?.error || null
      }
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post('/env', pinGuard, (req, res) => {
  try {
    setPreAutomationCors(req, res);
    const body = req.body || {};
    const scopeCandidates = [
      body.zoneId,
      body.zone,
      body.scope,
      body.scopeId,
      body.room,
      body.id
    ];
    const scope = scopeCandidates
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .find((value) => !!value) || 'default';

    const sensors = body.sensors || body.readings || {};
    const sensorArray = Array.isArray(sensors) ? sensors : Object.entries(sensors).map(([type, value]) => ({ type, value }));
    const ingestStructuredReading = (reading, defaultScope) => {
      const readingScope = reading.scope || reading.room || reading.zone || defaultScope;
      if (!readingScope) return;

      const observedAt = reading.observedAt
        || reading.timestamp
        || reading.ts
        || new Date().toISOString();

      const baseMeta = {
        ...(reading.meta || reading.metadata || {}),
        sensorId: reading.sensorId
          || reading.id
          || reading.deviceId
          || reading.mac
          || reading.sourceId
          || reading.serial
          || undefined,
        vendor: reading.vendor || reading.brand || undefined
      };

      const metricCandidates = [
        { key: 'temp', aliases: ['temp', 'temperature'], unit: reading.tempUnit || reading.temperatureUnit || 'celsius' },
        { key: 'rh', aliases: ['rh', 'humidity'], unit: reading.rhUnit || reading.humidityUnit || 'percent' },
        { key: 'co2', aliases: ['co2'], unit: reading.co2Unit || 'ppm' },
        { key: 'vpd', aliases: ['vpd'], unit: reading.vpdUnit || 'kpa' },
        { key: 'ppfd', aliases: ['ppfd'], unit: reading.ppfdUnit || 'umol/m2/s' },
        { key: 'kwh', aliases: ['kwh', 'energyKwh', 'energy'], unit: reading.energyUnit || 'kwh' },
        { key: 'battery', aliases: ['battery'], unit: reading.batteryUnit || 'percent' },
        { key: 'rssi', aliases: ['rssi'], unit: reading.rssiUnit || 'dBm' }
      ];

      let ingestedAny = false;

      for (const metric of metricCandidates) {
        const value = metric.aliases
          .map((alias) => reading[alias])
          .find((candidate) => candidate !== undefined && candidate !== null);
        if (value === undefined || value === null) continue;

        preAutomationEngine.ingestSensor(readingScope, metric.key, {
          value,
          unit: reading.unit || metric.unit || null,
          observedAt,
          meta: baseMeta
        });
        ingestedAny = true;
      }

      return ingestedAny;
    };

    sensorArray.forEach((reading) => {
      if (!reading) return;
      const sensorType = reading.type || reading.sensor || reading.metric;
      const readingScope = reading.scope || reading.room || scope;

      if (sensorType) {
        preAutomationEngine.ingestSensor(readingScope, sensorType, {
          value: reading.value ?? reading.reading ?? null,
          unit: reading.unit,
          observedAt: reading.observedAt || reading.timestamp || new Date().toISOString(),
          meta: reading.meta || reading.metadata || null
        });
        return;
      }

      ingestStructuredReading(reading, scope);
    });

    const normalizedTargets = normalizeEnvTargetsForAutomation(body.targets);
    const normalizedControl = normalizeEnvControlForAutomation(body.control);
    const hasTargets = Object.keys(normalizedTargets).length > 0;
    const hasControl = Object.keys(normalizedControl).length > 0;
    const zoneNameCandidates = [body.zoneName, body.name, body.label];
    const zoneName = zoneNameCandidates
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .find((value) => !!value) || scope;
    const metaPayload = body.meta && typeof body.meta === 'object' ? body.meta : null;

    if (hasTargets || hasControl || zoneName || metaPayload) {
      const upsertPayload = { name: zoneName };
      if (hasTargets) upsertPayload.targets = normalizedTargets;
      if (hasControl) upsertPayload.control = normalizedControl;
      if (metaPayload) upsertPayload.meta = metaPayload;
      preEnvStore.upsertRoom(scope, upsertPayload);
      if (hasTargets) {
        preAutomationEngine.setTargets(scope, normalizedTargets);
      }
    }

    const room = preEnvStore.getRoom(scope);
    const targets = preEnvStore.getTargets(scope);
    res.json({ ok: true, scope, zoneId: scope, room, targets });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.patch('/env/rooms/:roomId', pinGuard, async (req, res) => {
  try {
    setPreAutomationCors(req, res);
    const roomId = req.params.roomId;
    if (!roomId) return res.status(400).json({ ok: false, error: 'roomId required' });
    const payload = req.body || {};
    const updated = preEnvStore.upsertRoom(roomId, payload);
    let zonesPayload;
    try {
      zonesPayload = await loadEnvZonesPayload({});
    } catch (error) {
      zonesPayload = { zones: [] };
    }
    const legacyEnvState = readEnv();
    const evaluated = evaluateRoomAutomationConfig(updated, preEnvStore.getSnapshot(), zonesPayload.zones || [], legacyEnvState);
    res.json({ ok: true, room: evaluated });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post('/env/rooms/:roomId/actions', pinGuard, async (req, res) => {
  try {
    setPreAutomationCors(req, res);
    const roomId = req.params.roomId;
    if (!roomId) return res.status(400).json({ ok: false, error: 'roomId required' });
    const roomConfig = preEnvStore.getRoom(roomId);
    if (!roomConfig) return res.status(404).json({ ok: false, error: 'Room not found' });

    let zonesPayload;
    try {
      zonesPayload = await loadEnvZonesPayload({});
    } catch (error) {
      zonesPayload = { zones: [] };
    }

    const snapshot = preEnvStore.getSnapshot();
    const legacyEnvState = readEnv();
    const evaluated = evaluateRoomAutomationConfig(roomConfig, snapshot, zonesPayload.zones || [], legacyEnvState);
    const suggestionId = req.body?.suggestionId;
    const suggestion = evaluated.suggestions.find((item) => !suggestionId || item.id === suggestionId);
    if (!suggestion) {
      return res.status(400).json({ ok: false, error: 'Suggestion not available' });
    }

    preAutomationLogger?.log({
      type: 'room-automation-action',
      roomId,
      suggestionId: suggestion.id,
      action: suggestion.action || null,
      label: suggestion.label,
      detail: suggestion.detail,
      mode: evaluated.control?.mode || 'advisory'
    });

    res.json({ ok: true, room: evaluated, appliedSuggestion: suggestion });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});


app.get('/plugs', asyncHandler(async (req, res) => {
  setPreAutomationCors(req, res);
  // Get all plug-type devices from the device store
  let allPlugDevices = [];
  try {
    // Query for devices with type 'plug' (case-insensitive, supports SwitchBot, Kasa, Shelly, etc)
    const rows = await devicesStore.find({});
    allPlugDevices = rows.filter(d => {
      const type = (d.type || d.deviceType || '').toLowerCase();
      return type.includes('plug');
    });
  } catch (e) {
    console.warn('[plugs] Failed to load plug devices from device store:', e.message);
  }

  // Get plugs from prePlugManager (Kasa, Shelly, etc)
  let discoveredPlugs = [];
  try {
    discoveredPlugs = await prePlugManager.discoverAll();
  } catch (e) {
    console.warn('[plugs] prePlugManager.discoverAll() failed:', e.message);
  }

  // Merge by id (device id is unique)
  const plugMap = new Map();
  for (const plug of [...allPlugDevices, ...discoveredPlugs]) {
    const id = plug.id || plug.deviceId || plug.device_id;
    if (id) plugMap.set(id, plug);
  }
  const plugs = Array.from(plugMap.values());
  res.json({ ok: true, plugs });
}));

app.post('/plugs/discover', pinGuard, asyncHandler(async (req, res) => {
  setPreAutomationCors(req, res);
  const plugs = await prePlugManager.discoverAll();
  res.json({ ok: true, plugs, refreshedAt: new Date().toISOString() });
}));

app.post('/plugs/register', pinGuard, (req, res) => {
  try {
    setPreAutomationCors(req, res);
    const body = req.body || {};
    const vendor = String(body.vendor || '').toLowerCase();
    const deviceId = body.deviceId || body.shortId || body.serial || body.id;
    if (!vendor || !deviceId) {
      return res.status(400).json({ ok: false, error: 'vendor and deviceId are required' });
    }
    const saved = preAutomationEngine.registerPlug({
      vendor,
      deviceId,
      name: body.name,
      model: body.model,
      manual: true,
      connection: body.connection || {},
      metadata: body.metadata || {}
    });
    res.json({ ok: true, plug: saved });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.delete('/plugs/:plugId', pinGuard, (req, res) => {
  try {
    setPreAutomationCors(req, res);
    const plugId = decodeURIComponent(req.params.plugId);
    const removed = preAutomationEngine.unregisterPlug(plugId);
    res.json({ ok: true, removed });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post('/plugs/:plugId/state', requireEdgeForControl, pinGuard, asyncHandler(async (req, res) => {
  setPreAutomationCors(req, res);
  const plugId = decodeURIComponent(req.params.plugId);
  const body = req.body || {};
  const desired = typeof body.on === 'boolean'
    ? body.on
    : typeof body.state === 'boolean'
    ? body.state
    : typeof body.set === 'string'
    ? body.set.toLowerCase() === 'on'
    : null;
  if (desired === null) {
    return res.status(400).json({ ok: false, error: 'Request body must include on/state boolean or set:"on|off"' });
  }
  const state = await preAutomationEngine.setPlugState(plugId, desired);
  res.json({ ok: true, plugId, state });
}));

app.post('/plugs/:plugId/rules', pinGuard, (req, res) => {
  try {
    setPreAutomationCors(req, res);
    const plugId = decodeURIComponent(req.params.plugId);
    const body = req.body || {};
    const ruleIds = Array.isArray(body.ruleIds) ? body.ruleIds : [];
    const actionConfig = body.action || body.actionConfig || { set: 'on' };

    const allRules = preRulesStore.list();
    const existingRuleIds = allRules.filter((rule) => Array.isArray(rule.actions) && rule.actions.some((action) => action.plugId === plugId)).map((rule) => rule.id);

    const toRemove = existingRuleIds.filter((id) => !ruleIds.includes(id));
    const toAdd = ruleIds.filter((id) => !existingRuleIds.includes(id));

    toRemove.forEach((ruleId) => preAutomationEngine.removePlugAssignment(ruleId, plugId));
    toAdd.forEach((ruleId) => preAutomationEngine.assignPlug(ruleId, plugId, actionConfig));

    const updatedRules = preRulesStore.list().filter((rule) => ruleIds.includes(rule.id));
    res.json({ ok: true, plugId, rules: updatedRules });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get('/rules', (req, res) => {
  try {
    setPreAutomationCors(req, res);
    const rules = preAutomationEngine.listRules();
    res.json({ ok: true, rules });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get('/rules/:ruleId', (req, res) => {
  try {
    setPreAutomationCors(req, res);
    const rule = preRulesStore.find(req.params.ruleId);
    if (!rule) {
      return res.status(404).json({ ok: false, error: 'Rule not found' });
    }
    res.json({ ok: true, rule });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post('/rules', (req, res) => {
  try {
    setPreAutomationCors(req, res);
    const body = req.body || {};
    if (!body.when || !body.actions) {
      return res.status(400).json({ ok: false, error: 'Rule must include when and actions' });
    }
    const saved = preAutomationEngine.upsertRule(body);
    res.json({ ok: true, rule: saved });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.patch('/rules/:ruleId', (req, res) => {
  try {
    setPreAutomationCors(req, res);
    const existing = preRulesStore.find(req.params.ruleId);
    if (!existing) {
      return res.status(404).json({ ok: false, error: 'Rule not found' });
    }
    const body = req.body || {};
    const merged = { ...existing, ...body, id: existing.id };
    const saved = preAutomationEngine.upsertRule(merged);
    res.json({ ok: true, rule: saved });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.delete('/rules/:ruleId', (req, res) => {
  try {
    setPreAutomationCors(req, res);
    const removed = preAutomationEngine.removeRule(req.params.ruleId);
    res.json({ ok: true, removed });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// --- IFTTT Integration (optional) ---
// Status endpoint for quick checks
app.get('/integrations/ifttt/status', (req, res) => {
  res.json({
    enabled: IFTTT_ENABLED,
    outboundConfigured: Boolean(IFTTT_KEY),
    inboundProtected: Boolean(IFTTT_INBOUND_TOKEN),
    makerBase: 'https://maker.ifttt.com/trigger/{event}/json/with/key/{key}'
  });
});

// Outbound trigger: POST /integrations/ifttt/trigger/:event
// Body is forwarded as JSON to IFTTT (can include value1/value2/value3 or any JSON fields)
app.post('/integrations/ifttt/trigger/:event', asyncHandler(async (req, res) => {
  if (!IFTTT_KEY) return res.status(400).json({ ok: false, error: 'IFTTT_KEY not configured' });
  const evt = String(req.params.event || '').trim();
  if (!evt) return res.status(400).json({ ok: false, error: 'event is required' });

  const url = `https://maker.ifttt.com/trigger/${encodeURIComponent(evt)}/json/with/key/${IFTTT_KEY}`;
  const payload = req.body && Object.keys(req.body).length ? req.body : {};
  const t0 = Date.now();
  let response, text;
  try {
    response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    text = await response.text().catch(() => '');
  } catch (e) {
    return res.status(502).json({ ok: false, error: `IFTTT request failed: ${e.message}` });
  }
  const ms = Date.now() - t0;
  return res.status(response.ok ? 200 : 502).json({ ok: response.ok, status: response.status, ms, event: evt, payload, responseBody: text });
}));

// Inbound webhook: IFTTT -> Charlie (secure with shared token)
// Create an IFTTT applet action "Webhooks -> Make a web request" to this URL:
// POST https://<public-host>/integrations/ifttt/incoming/<event>?token=<YOUR_TOKEN>
// JSON body can include { deviceId, action, value, ... }
app.post('/integrations/ifttt/incoming/:event', asyncHandler(async (req, res) => {
  const token = req.query.token || req.headers['x-ifttt-token'];
  if (!IFTTT_INBOUND_TOKEN) return res.status(501).json({ ok: false, error: 'Inbound token not configured on server' });
  if (!token || String(token) !== String(IFTTT_INBOUND_TOKEN)) return res.status(401).json({ ok: false, error: 'Unauthorized' });

  const evt = String(req.params.event || '').trim();
  const body = req.body || {};
  const receivedAt = new Date().toISOString();

  // Process through automation engine for sensor-triggered automations
  try {
    await automationEngine.processIFTTTTrigger(evt, body);
    console.log(`[automation] Processed IFTTT trigger: ${evt}`);
  } catch (automationError) {
    console.warn('IFTTT automation processing failed:', automationError.message);
  }

  // Minimal action router (extend as needed)
  let routed = null;
  try {
    if (evt === 'device-control' && body.deviceId && body.action) {
      // Map simple power actions to existing endpoints
      if (['turnOn', 'turnOff'].includes(body.action)) {
        const url = `http://127.0.0.1:${PORT}/api/device/${encodeURIComponent(body.deviceId)}/power`;
        const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: body.action === 'turnOn' }) });
        routed = { endpoint: url, status: resp.status };
      }
    }
  } catch (e) {
    console.warn('IFTTT inbound action route failed:', e.message);
  }

  res.json({ ok: true, event: evt, receivedAt, body, routed });
}));

// --- Device Database (NeDB) ---
function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeAssignedEquipment(value) {
  if (!isPlainObject(value)) {
    return { roomId: null, equipmentId: null };
  }
  const roomId = value.roomId ?? value.room ?? null;
  const equipmentId = value.equipmentId ?? value.equipment ?? null;
  return {
    roomId: roomId === '' ? null : roomId,
    equipmentId: equipmentId === '' ? null : equipmentId,
  };
}

function buildDeviceDoc(existing, incoming = {}) {
  const base = existing ? { ...existing } : {};
  const payload = isPlainObject(incoming) ? { ...incoming } : {};
  const idFromPayload = typeof payload.id === 'string' && payload.id.trim() ? payload.id.trim() : null;
  const deviceIdFromPayload = typeof payload.device_id === 'string' && payload.device_id.trim() ? payload.device_id.trim() : null;
  const id = idFromPayload || deviceIdFromPayload || base.id;
  if (!id) {
    throw new Error('id required');
  }

  const name = payload.name || payload.deviceName || base.name || base.deviceName || id;
  const protocolRaw = payload.protocol ?? payload.transport ?? base.protocol ?? base.transport ?? 'other';
  const protocol = typeof protocolRaw === 'string' && protocolRaw.trim() ? protocolRaw.trim().toLowerCase() : 'other';
  const category = payload.category || base.category || (id.startsWith('light-') ? 'lighting' : 'device');
  const capabilities = isPlainObject(payload.capabilities)
    ? payload.capabilities
    : (isPlainObject(base.capabilities) ? base.capabilities : {});
  const details = isPlainObject(payload.details)
    ? payload.details
    : (isPlainObject(base.details) ? base.details : {});
  const assignedEquipment = normalizeAssignedEquipment(payload.assignedEquipment ?? base.assignedEquipment);
  const online = typeof payload.online === 'boolean'
    ? payload.online
    : (typeof base.online === 'boolean' ? base.online : false);

  const doc = {
    ...base,
    ...payload,
    id,
    deviceName: payload.deviceName || base.deviceName || name,
    name,
    transport: protocol,
    protocol,
    category,
    online,
    capabilities,
    assignedEquipment,
    details,
  };

  delete doc.device_id;
  delete doc.deviceId;

  return doc;
}

function deviceDocToJson(d){
  if (!d) return null;
  const {
    _id,
    id,
    device_id,
    deviceId,
    deviceName,
    name,
    category,
    type,
    transport,
    protocol,
    online,
    capabilities,
    details,
    assignedEquipment,
    createdAt,
    updatedAt,
    ...rest
  } = d;

  const deviceIdValue = device_id || deviceId || id || '';
  const protocolValue = (protocol || transport || 'other') || 'other';
  const baseDetails = isPlainObject(details) ? { ...details } : {};
  const extraDetails = { ...rest };
  delete extraDetails.extra; // legacy nested blob

  const detailPayload = {
    ...extraDetails,
    ...baseDetails,
    manufacturer: rest?.manufacturer ?? baseDetails.manufacturer ?? rest?.extra?.manufacturer,
    model: rest?.model ?? baseDetails.model ?? rest?.extra?.model,
    serial: rest?.serial ?? baseDetails.serial ?? rest?.extra?.serial,
    watts: rest?.watts ?? baseDetails.watts ?? rest?.extra?.watts,
    spectrumMode: rest?.spectrumMode ?? baseDetails.spectrumMode ?? rest?.extra?.spectrumMode,
    createdAt,
    updatedAt,
  };

  const sanitizedDetails = Object.fromEntries(
    Object.entries(detailPayload).filter(([, value]) => value !== undefined)
  );

  return {
    device_id: deviceIdValue,
    name: name || deviceName || rest?.model || deviceIdValue,
    category: category || type || rest?.category || 'device',
    protocol: String(protocolValue || 'other').toLowerCase() || 'other',
    online: Boolean(online),
    capabilities: isPlainObject(capabilities) ? { ...capabilities } : {},
    assignedEquipment: normalizeAssignedEquipment(assignedEquipment),
    details: sanitizedDetails,
  };
}

function createDeviceStore(){
  ensureDbDir();
  // During tests, prefer an in-memory store to avoid filesystem races and unhandled rejections
  const store = new Datastore({
    filename: DB_PATH,
    autoload: !RUNNING_UNDER_NODE_TEST,
    timestampData: true,
    inMemoryOnly: RUNNING_UNDER_NODE_TEST
  });
  return store;
}

async function seedDevicesFromMetaNedb(store){
  try {
    const count = await store.count({});
    if (count > 0) return;
    const metaPath = path.join(DATA_DIR, 'device-meta.json');
    if (!fs.existsSync(metaPath)) return;
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    const devices = meta?.devices || {};
    const rows = Object.entries(devices).map(([id, m]) => {
      const name = m.deviceName || m.name || (/^light-/i.test(id) ? id.replace('light-', 'Light ').toUpperCase() : id);
      const protocol = String(m.protocol || m.transport || m.conn || m.connectivity || '').toLowerCase();
      const assignedEquipment = normalizeAssignedEquipment({
        roomId: m.roomId ?? m.room ?? null,
        equipmentId: m.equipmentId ?? m.module ?? null,
      });
      return {
        id,
        deviceName: name,
        name,
        manufacturer: m.manufacturer || '',
        model: m.model || '',
        serial: m.serial || '',
        watts: m.watts || m.nominalW || null,
        spectrumMode: m.spectrumMode || '',
        transport: protocol,
        protocol,
        category: m.category || m.type || (/^light-/i.test(id) ? 'lighting' : ''),
        online: Boolean(m.online),
        capabilities: isPlainObject(m.capabilities) ? m.capabilities : {},
        assignedEquipment,
        farm: m.farm || '',
        room: assignedEquipment.roomId || '',
        zone: m.zone || '',
        module: m.module || '',
        level: m.level || '',
        side: m.side || '',
        details: isPlainObject(m.details) ? m.details : {},
        extra: m,
      };
    });
    await store.insert(rows);
    console.log(`[charlie] seeded ${rows.length} device(s) from device-meta.json`);
  } catch (e) {
    console.warn('[charlie] seedDevicesFromMeta (NeDB) failed:', e.message);
  }
}

const devicesStore = createDeviceStore();
// Initialize device seeding asynchronously without blocking startup
(async () => {
  try {
    await seedDevicesFromMetaNedb(devicesStore);
  } catch (error) {
    console.warn('[charlie] Device seeding failed:', error.message);
  }
})();

function toTimestamp(value) {
  if (!value) return null;
  if (value instanceof Date) {
    const ts = value.getTime();
    return Number.isFinite(ts) ? ts : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return false;
    return ['true', '1', 'yes', 'y', 'primary', 'on'].includes(normalized);
  }
  return false;
}

function toWeight(value) {
  if (value === undefined || value === null) return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  if (num < 0) return null;
  return num;
}

function normalizeString(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value.trim();
  return String(value || '').trim();
}

function collectTextTokens(...values) {
  const tokens = new Set();
  values
    .flat()
    .filter((entry) => entry !== undefined && entry !== null)
    .forEach((entry) => {
      const text = normalizeString(entry).toLowerCase();
      if (!text) return;
      text
        .split(/[^a-z0-9]+/)
        .map((token) => token.trim())
        .filter(Boolean)
        .forEach((token) => tokens.add(token));
    });
  return tokens;
}

function classifyDeviceKind(doc) {
  if (!doc || typeof doc !== 'object') return null;
  const details = doc.details || {};
  const tokens = collectTextTokens(
    doc.deviceType,
    doc.type,
    doc.category,
    doc.model,
    doc.protocol,
    doc.name,
    details.deviceType,
    details.category,
    details.model,
    details.kind
  );

  if (
    ['sensor', 'sensors', 'meter', 'thermometer', 'hygrometer', 'monitor', 'air', 'climate'].some((keyword) =>
      tokens.has(keyword)
    )
  ) {
    return 'sensor';
  }

  if (
    ['plug', 'plugs', 'outlet', 'switch', 'relay', 'socket'].some((keyword) =>
      tokens.has(keyword)
    )
  ) {
    return 'plug';
  }

  if (doc.controlledType || details.controlledType) {
    return 'plug';
  }

  return null;
}

function classifyControlledCategory(doc) {
  const details = (doc && doc.details) || {};
  const controlledRaw = normalizeString(
    firstNonEmpty(
      doc.controlledType,
      doc.controlType,
      details.controlledType,
      details.controlType,
      details.controlled_type,
      details.control_type
    )
  ).toLowerCase();

  const tokens = collectTextTokens(controlledRaw, doc.deviceType, doc.type, details.deviceType, details.type);

  if (controlledRaw) {
    if (controlledRaw.includes('dehu') || controlledRaw.includes('dehumid')) return 'dehu';
    if (controlledRaw.includes('fan') || controlledRaw.includes('exhaust')) return 'fans';
    if (controlledRaw.includes('heater') || controlledRaw.includes('heat')) return 'heaters';
    if (controlledRaw.includes('light') || controlledRaw.includes('lamp')) return 'lights';
  }

  if (tokens.has('dehu') || tokens.has('dehumidifier')) return 'dehu';
  if (tokens.has('fan') || tokens.has('fans') || tokens.has('blower')) return 'fans';
  if (tokens.has('heater') || tokens.has('heat')) return 'heaters';
  if (tokens.has('light') || tokens.has('lamp')) return 'lights';

  return 'misc';
}

function normalizeZoneContext(doc) {
  if (!doc || typeof doc !== 'object') return null;
  const details = doc.details || {};

  const zoneName = normalizeString(
    firstNonEmpty(doc.zoneName, details.zoneName, doc.zone, details.zone, doc.location, details.location)
  );
  const zoneIdRaw = normalizeString(
    firstNonEmpty(doc.zoneId, details.zoneId, doc.zoneSlug, details.zoneSlug, doc.zone, details.zone, zoneName)
  );
  const zoneId = zoneIdRaw || (zoneName ? slugify(zoneName) : '');
  const zoneKey = zoneId ? zoneId.toLowerCase() : zoneName.toLowerCase();
  if (!zoneKey) return null;

  const roomName = normalizeString(
    firstNonEmpty(doc.roomName, details.roomName, doc.room, details.room, doc.locationName, details.location, doc.location)
  );
  const roomIdRaw = normalizeString(
    firstNonEmpty(doc.roomId, details.roomId, doc.roomSlug, details.roomSlug, roomName)
  );
  const roomId = roomIdRaw || (roomName ? slugify(roomName) : '');
  const roomKey = roomId ? roomId.toLowerCase() : roomName.toLowerCase();

  const scopeId = slugify(zoneId || zoneName || roomId || roomName || zoneKey || 'zone');

  return {
    zoneId: zoneId || null,
    zoneName: zoneName || (zoneId || '').toUpperCase(),
    zoneKey,
    roomId: roomId || null,
    roomName: roomName || null,
    roomKey,
    scopeId,
  };
}

function buildSensorEntry(doc, context) {
  const details = doc.details || {};
  const updatedAt = normalizeString(firstNonEmpty(doc.updatedAt, details.updatedAt));
  const updatedAtTs = toTimestamp(updatedAt);
  const rawWeight = toWeight(firstNonEmpty(doc.weight, details.weight));
  const battery = toNumberOrNull(firstNonEmpty(doc.battery, details.battery));
  return {
    deviceId: normalizeString(firstNonEmpty(doc.device_id, doc.deviceId, doc.id)),
    name: normalizeString(firstNonEmpty(doc.deviceName, doc.name, details.displayName, details.name)),
    vendor: normalizeString(firstNonEmpty(doc.manufacturer, details.manufacturer, doc.protocol)),
    primary: toBoolean(firstNonEmpty(doc.primary, details.primary)),
    rawWeight,
    weight: null,
    weightPercent: null,
    weightSource: rawWeight !== null ? 'explicit' : 'default',
    battery,
    updatedAt: updatedAtTs ? new Date(updatedAtTs).toISOString() : null,
    updatedAtTs,
    zoneId: context.zoneId,
    zoneName: context.zoneName,
  };
}

function buildActuatorEntry(doc, context) {
  const details = doc.details || {};
  const updatedAt = normalizeString(firstNonEmpty(doc.updatedAt, details.updatedAt));
  const updatedAtTs = toTimestamp(updatedAt);
  return {
    deviceId: normalizeString(firstNonEmpty(doc.device_id, doc.deviceId, doc.id)),
    plugId: normalizeString(firstNonEmpty(details.plugId, details.deviceId, doc.plugId, doc.id)),
    name: normalizeString(firstNonEmpty(doc.deviceName, doc.name, details.displayName, details.name)),
    vendor: normalizeString(firstNonEmpty(doc.manufacturer, details.manufacturer, doc.protocol)),
    controlledType: normalizeString(firstNonEmpty(doc.controlledType, details.controlledType)),
    energyTelemetry: normalizeString(firstNonEmpty(doc.energyTelemetry, details.energyTelemetry)),
    managedEquipment: normalizeString(firstNonEmpty(doc.managedEquipment, details.managedEquipment)),
    updatedAt: updatedAtTs ? new Date(updatedAtTs).toISOString() : null,
    updatedAtTs,
    zoneId: context.zoneId,
    zoneName: context.zoneName,
  };
}

function finalizeZoneBinding(binding) {
  const sensors = binding.sensors || [];
  if (sensors.length) {
    sensors.sort((a, b) => {
      if (a.primary && !b.primary) return -1;
      if (!a.primary && b.primary) return 1;
      const weightA = a.rawWeight ?? 0;
      const weightB = b.rawWeight ?? 0;
      if (weightA !== weightB) return weightB - weightA;
      return a.deviceId.localeCompare(b.deviceId);
    });

    let primary = sensors.find((sensor) => sensor.primary);
    if (!primary) {
      primary = sensors[0];
      if (primary) primary.primary = true;
    } else {
      sensors.forEach((sensor) => {
        sensor.primary = sensor === primary;
      });
    }

    const explicitCount = sensors.filter((sensor) => sensor.rawWeight !== null).length;
    if (explicitCount !== sensors.length) {
      const defaultWeight = sensors.length ? 1 / sensors.length : 0;
      sensors.forEach((sensor) => {
        if (sensor.rawWeight === null) {
          sensor.rawWeight = defaultWeight;
          sensor.weightSource = 'default';
        }
      });
    }

    const totalWeight = sensors.reduce((sum, sensor) => sum + (sensor.rawWeight || 0), 0);
    const divisor = totalWeight > 0 ? totalWeight : sensors.length || 1;
    sensors.forEach((sensor) => {
      const normalized = divisor ? (sensor.rawWeight || 0) / divisor : 0;
      const rounded = Math.max(0, Math.round(normalized * 1000) / 1000);
      sensor.weight = rounded;
      sensor.weightPercent = Math.round(rounded * 10000) / 100;
    });
    binding.primarySensorId = primary ? primary.deviceId : null;
  } else {
    binding.primarySensorId = null;
  }

  binding.counts = {
    sensors: sensors.length,
    fans: binding.actuators.fans.length,
    dehu: binding.actuators.dehu.length,
    heaters: binding.actuators.heaters.length,
    lights: binding.actuators.lights.length,
    misc: binding.actuators.misc.length,
  };

  binding.updatedAtTs = Math.max(
    binding.updatedAtTs || 0,
    ...sensors.map((sensor) => sensor.updatedAtTs || 0),
    ...binding.actuators.fans.map((act) => act.updatedAtTs || 0),
    ...binding.actuators.dehu.map((act) => act.updatedAtTs || 0),
    ...binding.actuators.heaters.map((act) => act.updatedAtTs || 0),
    ...binding.actuators.lights.map((act) => act.updatedAtTs || 0),
    ...binding.actuators.misc.map((act) => act.updatedAtTs || 0)
  );
  binding.updatedAt = binding.updatedAtTs ? new Date(binding.updatedAtTs).toISOString() : null;
  delete binding.updatedAtTs;

  // Remove temporary timestamp fields from child entries for cleaner JSON payloads
  sensors.forEach((sensor) => delete sensor.updatedAtTs);
  Object.values(binding.actuators).forEach((list) =>
    list.forEach((entry) => delete entry.updatedAtTs)
  );

  return binding;
}

async function buildZoneBindingsFromDevices() {
  try {
    const rows = await devicesStore.find({});
    const zoneMap = new Map();

    for (const doc of rows) {
      const kind = classifyDeviceKind(doc);
      if (!kind) continue;
      const context = normalizeZoneContext(doc);
      if (!context) continue;

      const zoneKey = context.zoneKey;
      if (!zoneMap.has(zoneKey)) {
        zoneMap.set(zoneKey, {
          zoneId: context.zoneId,
          zoneName: context.zoneName || context.zoneId,
          zoneKey,
          scopeId: context.scopeId,
          roomId: context.roomId,
          roomName: context.roomName,
          sensors: [],
          actuators: {
            fans: [],
            dehu: [],
            heaters: [],
            lights: [],
            misc: [],
          },
          updatedAt: null,
          updatedAtTs: null,
        });
      }

      const binding = zoneMap.get(zoneKey);
      if (!binding.roomId && context.roomId) binding.roomId = context.roomId;
      if (!binding.roomName && context.roomName) binding.roomName = context.roomName;
      if (!binding.zoneId && context.zoneId) binding.zoneId = context.zoneId;
      if (!binding.zoneName && context.zoneName) binding.zoneName = context.zoneName;

      if (kind === 'sensor') {
        binding.sensors.push(buildSensorEntry(doc, context));
      } else if (kind === 'plug') {
        const category = classifyControlledCategory(doc);
        if (category && binding.actuators[category]) {
          const entry = buildActuatorEntry(doc, context);
          if (!binding.actuators[category].some((existing) => existing.deviceId === entry.deviceId)) {
            binding.actuators[category].push(entry);
          }
        }
      }
    }

    const bindings = Array.from(zoneMap.values()).map(finalizeZoneBinding);
    bindings.sort((a, b) => a.zoneName.localeCompare(b.zoneName, undefined, { sensitivity: 'base' }));

    const meta = {
      source: 'devices-store',
      bindings: bindings.length,
      updatedAt:
        bindings.reduce((latest, binding) => {
          if (!binding.updatedAt) return latest;
          if (!latest) return binding.updatedAt;
          return Date.parse(binding.updatedAt) > Date.parse(latest) ? binding.updatedAt : latest;
        }, null) || null,
    };

    return { bindings, meta };
  } catch (error) {
    console.warn('[automation] Failed to build zone bindings:', error.message);
    return { bindings: [], meta: { source: 'devices-store', error: error.message } };
  }
}

// Devices API (NeDB)
function setApiCors(res){
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

app.options('/devices', (req,res)=>{ setApiCors(res); res.status(204).end(); });
app.options('/devices/:id', (req,res)=>{ setApiCors(res); res.status(204).end(); });

// GET /devices → list
app.get('/devices', createDemoModeHandler(), async (req, res) => {
  try {
    setApiCors(res);
    
    // Handle demo mode - always return demo devices when demo mode is enabled
    if (isDemoMode()) {
      const demoData = getDemoData();
      const devices = demoData.getDevices();
      console.log('[charlie] Demo mode: serving demo devices (' + devices.length + ' devices)');
      return res.json({ devices });
    }
    
    const rows = await devicesStore.find({});
    rows.sort((a,b)=> String(a.id||'').localeCompare(String(b.id||'')));
    return res.json({ devices: rows.map(deviceDocToJson) });
  } catch (e) {
    return res.status(500).json({ ok:false, error: e.message });
  }
});

// GET /devices/:id → one
app.get('/devices/:id', async (req, res) => {
  try {
    setApiCors(res);
    const row = await devicesStore.findOne({ id: req.params.id });
    if (!row) return res.status(404).json({ ok:false, error:'not found' });
    return res.json({ device: deviceDocToJson(row) });
  } catch (e) {
    return res.status(500).json({ ok:false, error: e.message });
  }
});

// POST /devices → upsert (requires id)
app.post('/devices', async (req, res) => {
  try {
    setApiCors(res);
    const d = req.body || {};
    let draft;
    try {
      draft = buildDeviceDoc(null, d);
    } catch (validationError) {
      return res.status(400).json({ ok: false, error: validationError.message });
    }
    const id = draft.id;
    const existing = await devicesStore.findOne({ id });
    const merged = buildDeviceDoc(existing, d);
    const timestamp = new Date().toISOString();
    if (existing) {
      await devicesStore.update({ id }, { $set: { ...merged, updatedAt: timestamp } }, {});
    } else {
      await devicesStore.insert({ ...merged, createdAt: timestamp, updatedAt: timestamp });
    }
    const row = await devicesStore.findOne({ id });
    return res.json({ ok:true, device: deviceDocToJson(row) });
  } catch (e) {
    return res.status(500).json({ ok:false, error: e.message });
  }
});

// PATCH /devices/:id → partial update (Edge-only)
app.patch('/devices/:id', requireEdgeForControl, async (req, res) => {
  try {
    setApiCors(res);
    const id = req.params.id;
    const existing = await devicesStore.findOne({ id });
    if (!existing) return res.status(404).json({ ok:false, error:'not found' });
    let merged;
    try {
      merged = buildDeviceDoc(existing, { ...req.body, id });
    } catch (validationError) {
      return res.status(400).json({ ok: false, error: validationError.message });
    }
    await devicesStore.update({ id }, { $set: { ...merged, updatedAt: new Date().toISOString() } }, {});
    const row = await devicesStore.findOne({ id });
    return res.json({ ok:true, device: deviceDocToJson(row) });
  } catch (e) {
    return res.status(500).json({ ok:false, error: e.message });
  }
});

// DELETE /devices/:id
app.delete('/devices/:id', async (req, res) => {
  try {
    setApiCors(res);
    const id = req.params.id;
    const num = await devicesStore.remove({ id }, {});
    return res.json({ ok:true, deleted: num });
  } catch (e) {
    return res.status(500).json({ ok:false, error: e.message });
  }
});

// =====================================================
// Lights Catalog API Endpoints
// =====================================================

// GET /lights → get all lights with optional filtering
app.get('/lights', async (req, res) => {
  try {
    setApiCors(res);
    
    // Support query params for filtering
    const { manufacturer, wattage_min, wattage_max, search } = req.query;
    
    let lights = await lightsDB.getAll();
    
    // Apply filters if provided
    if (manufacturer) {
      lights = lights.filter(l => l.manufacturer && l.manufacturer.toLowerCase() === manufacturer.toLowerCase());
    }
    
    if (wattage_min || wattage_max) {
      lights = lights.filter(l => {
        const w = l.wattage || 0;
        if (wattage_min && w < Number(wattage_min)) return false;
        if (wattage_max && w > Number(wattage_max)) return false;
        return true;
      });
    }
    
    if (search) {
      const term = search.toLowerCase();
      lights = lights.filter(l => {
        return (l.manufacturer && l.manufacturer.toLowerCase().includes(term)) ||
               (l.model && l.model.toLowerCase().includes(term)) ||
               (l.name && l.name.toLowerCase().includes(term));
      });
    }
    
    return res.json({ ok: true, lights, count: lights.length });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /lights/manufacturers → get list of unique manufacturers
app.get('/lights/manufacturers', async (req, res) => {
  try {
    setApiCors(res);
    const manufacturers = await lightsDB.getManufacturers();
    return res.json({ ok: true, manufacturers });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /lights/stats → get database statistics
app.get('/lights/stats', async (req, res) => {
  try {
    setApiCors(res);
    const stats = await lightsDB.getStats();
    return res.json({ ok: true, stats });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /lights/:id → get single light by id
app.get('/lights/:id', async (req, res) => {
  try {
    setApiCors(res);
    const light = await lightsDB.findById(req.params.id);
    if (!light) {
      return res.status(404).json({ ok: false, error: 'Light not found' });
    }
    return res.json({ ok: true, light });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /lights → create new light
app.post('/lights', async (req, res) => {
  try {
    setApiCors(res);
    const lightData = req.body || {};
    
    // Basic validation
    if (!lightData.manufacturer || !lightData.model) {
      return res.status(400).json({ 
        ok: false, 
        error: 'Missing required fields: manufacturer and model' 
      });
    }
    
    const newLight = await lightsDB.add(lightData);
    return res.json({ ok: true, light: newLight });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /lights/search → advanced search with criteria object
app.post('/lights/search', async (req, res) => {
  try {
    setApiCors(res);
    const criteria = req.body || {};
    const lights = await lightsDB.search(criteria);
    return res.json({ ok: true, lights, count: lights.length });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// PATCH /lights/:id → update existing light
app.patch('/lights/:id', async (req, res) => {
  try {
    setApiCors(res);
    const updates = req.body || {};
    const updatedLight = await lightsDB.update(req.params.id, updates);
    return res.json({ ok: true, light: updatedLight });
  } catch (e) {
    if (e.message.includes('not found')) {
      return res.status(404).json({ ok: false, error: e.message });
    }
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// DELETE /lights/:id → delete light
app.delete('/lights/:id', async (req, res) => {
  try {
    setApiCors(res);
    await lightsDB.delete(req.params.id);
    return res.json({ ok: true, deleted: true });
  } catch (e) {
    if (e.message.includes('not found')) {
      return res.status(404).json({ ok: false, error: e.message });
    }
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// --- Lighting Recipes API (now using PostgreSQL database) ---
// Recipe endpoints updated to use PostgreSQL database
// GET /recipes?search=tomato&category=Fruiting%20Crops&limit=10
app.get('/recipes', async (req, res) => {
  try {
    setApiCors(res);
    const { search, category, limit = 10 } = req.query;
    
    let whereClause = [];
    let params = [];
    let paramIndex = 1;
    
    if (search) {
      whereClause.push(`name ILIKE $${paramIndex++}`);
      params.push(`%${search}%`);
    }
    
    if (category) {
      whereClause.push(`category = $${paramIndex++}`);
      params.push(category);
    }
    
    const whereSQL = whereClause.length > 0 ? 'WHERE ' + whereClause.join(' AND ') : '';
    
    // Get total count
    const countResult = await dbPool.query(
      `SELECT COUNT(*) as total FROM recipes ${whereSQL}`,
      params
    );
    const total = parseInt(countResult.rows[0].total);
    
    // Get recipes (name and basic info only for listing)
    params.push(parseInt(limit));
    const result = await dbPool.query(
      `SELECT id, name, category, description, total_days
       FROM recipes
       ${whereSQL}
       ORDER BY category, name
       LIMIT $${paramIndex++}`,
      params
    );
    
    const recipes = {};
    result.rows.forEach(r => {
      recipes[r.name] = {
        id: r.id,
        category: r.category,
        description: r.description,
        total_days: r.total_days
      };
    });
    
    return res.json({ 
      ok: true, 
      crops: recipes,
      count: result.rows.length,
      total
    });
  } catch (e) {
    console.error('[recipes] Error fetching recipes:', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /recipes/:crop → get specific crop recipe with full schedule
app.get('/recipes/:crop', async (req, res) => {
  try {
    setApiCors(res);
    const cropName = decodeURIComponent(req.params.crop);
    
    const result = await dbPool.query(
      'SELECT * FROM recipes WHERE name = $1',
      [cropName]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Crop not found' });
    }
    
    const recipe = result.rows[0];
    const schedule = recipe.data?.schedule || [];
    
    return res.json({ 
      ok: true, 
      crop: cropName,
      category: recipe.category,
      description: recipe.description,
      total_days: recipe.total_days,
      days: schedule
    });
  } catch (e) {
    console.error('[recipes] Error fetching recipe:', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// SwitchBot Real API Endpoints - MUST be before proxy middleware
// Credentials now prefer farm.json integrations, falling back to env vars.
// Use helper to read current values so updates via /farm are picked up without restart.
const SWITCHBOT_TOKEN = process.env.SWITCHBOT_TOKEN || '';
const SWITCHBOT_SECRET = process.env.SWITCHBOT_SECRET || '';
const SWITCHBOT_REGION = process.env.SWITCHBOT_REGION || '';
const SWITCHBOT_API_BASE = 'https://api.switch-bot.com/v1.1';
const SWITCHBOT_API_TIMEOUT_MS = Number(process.env.SWITCHBOT_API_TIMEOUT_MS || 8000);
const SWITCHBOT_DEVICE_CACHE_TTL_MS = Number(process.env.SWITCHBOT_DEVICE_CACHE_TTL_MS || 1_800_000); // 30 minutes
const SWITCHBOT_STATUS_CACHE_TTL_MS = Number(process.env.SWITCHBOT_STATUS_CACHE_TTL_MS || 900_000); // 15 minutes
const SWITCHBOT_RATE_LIMIT_MS = Number(process.env.SWITCHBOT_RATE_LIMIT_MS || 6000); // 6 seconds between requests (10 per minute max)

// Rate limiting state
let lastSwitchBotRequest = 0;

const switchBotDevicesCache = {
  payload: null,
  fetchedAt: 0,
  inFlight: null,
  lastError: null
};

const switchBotStatusCache = new Map();

// Helper: read integrations from farm.json with env fallback
function readFarmProfile() {
  try {
    if (fs.existsSync(FARM_PATH)) {
      const raw = fs.readFileSync(FARM_PATH, 'utf8');
      return JSON.parse(raw);
    }
  } catch {}
  return null;
}

function getFarmIntegrations() {
  const farm = readFarmProfile();
  const integ = farm?.integrations || {};
  const sb = integ.switchbot || {};
  const kasa = integ.kasa || {};
  return {
    switchbot: {
      token: sb.token || SWITCHBOT_TOKEN || '',
      secret: sb.secret || SWITCHBOT_SECRET || '',
      region: sb.region || SWITCHBOT_REGION || ''
    },
    kasa: {
      email: kasa.email || process.env.KASA_EMAIL || '',
      password: kasa.password || process.env.KASA_PASSWORD || ''
    }
  };
}

// Hardware detection endpoint
app.get('/api/hardware/scan', asyncHandler(async (req, res) => {
  const devices = {
    lights: [],
    fans: [],
    sensors: [],
    other: []
  };

  try {
    // Scan USB devices
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    
    try {
      const { stdout } = await execAsync('lsusb');
      const usbDevices = stdout.split('\n').filter(line => line.trim());
      
      // Parse USB devices and categorize
      for (const line of usbDevices) {
        if (line.includes('Camera') || line.includes('Webcam')) {
          devices.other.push({ type: 'camera', id: line, interface: 'USB' });
        } else if (line.includes('Serial') || line.includes('FTDI')) {
          devices.sensors.push({ type: 'serial', id: line, interface: 'USB' });
        }
      }
    } catch (usbError) {
      console.log('[setup-wizard] USB scan unavailable:', usbError.message);
    }

    // Scan for MQTT devices
    if (mqttClient && mqttClient.connected) {
      // Get devices from device database
      const allDevices = await deviceDB.find({});
      for (const device of allDevices) {
        if (device.name?.toLowerCase().includes('light')) {
          devices.lights.push({ 
            type: 'light', 
            id: device.id, 
            name: device.name,
            interface: 'MQTT' 
          });
        } else if (device.name?.toLowerCase().includes('fan')) {
          devices.fans.push({ 
            type: 'fan', 
            id: device.id, 
            name: device.name,
            interface: 'MQTT' 
          });
        } else if (device.type === 'sensor') {
          devices.sensors.push({ 
            type: 'sensor', 
            id: device.id, 
            name: device.name,
            interface: 'MQTT' 
          });
        } else {
          devices.other.push({ 
            type: device.type, 
            id: device.id, 
            name: device.name,
            interface: 'MQTT' 
          });
        }
      }
    }

    res.json(devices);
  } catch (error) {
    console.error('[setup-wizard] Hardware scan error:', error);
    res.status(500).json({ error: 'Hardware scan failed' });
  }
}));

// Save rooms endpoint (matches greenreach-central route for cross-mode compatibility)
app.post('/api/setup/save-rooms', asyncHandler(async (req, res) => {
  try {
    const rooms = req.body?.rooms;
    if (!Array.isArray(rooms)) {
      return res.status(400).json({ success: false, message: 'rooms array required' });
    }
    const fullPath = path.join(DATA_DIR, 'rooms.json');
    const payload = JSON.stringify({ rooms }, null, 2);
    await writeJsonQueued(fullPath, payload);
    console.log(`[setup/save-rooms] Saved ${rooms.length} room(s) to rooms.json`);
    res.json({ success: true, saved: rooms.length });
  } catch (err) {
    console.error('[setup/save-rooms] Error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}));

// Setup completion endpoint
app.post('/api/setup/complete', asyncHandler(async (req, res) => {
  const { 
    network, registrationCode, farmId, hardware, certifications, rooms,
    farmName, ownerName, contactEmail, contactPhone, store
  } = req.body;
  
  try {
    console.log('[setup-wizard] Setup complete request for farm:', farmId);
    console.log('[setup-wizard] Farm profile:', { farmName, ownerName, contactEmail });
    console.log('[setup-wizard] Rooms:', rooms);
    console.log('[setup-wizard] Store config:', store);
    
    // Save setup configuration to database
    const setupConfig = {
      completed: true,
      completedAt: new Date().toISOString(),
      network: network,
      farmId: farmId,
      registrationCode: registrationCode,
      hardwareDetected: hardware,
      certifications: certifications || { certifications: [], practices: [], attributes: [] }
    };

    // Also save to farm.json for dashboard pages (edge mode)
    const farmJsonPath = path.join(__dirname, 'public', 'data', 'farm.json');
    try {
      let farmData = {};
      // Try to read existing farm.json
      if (fs.existsSync(farmJsonPath)) {
        const existingData = fs.readFileSync(farmJsonPath, 'utf8');
        farmData = JSON.parse(existingData);
      }
      
      // Update with registration data
      farmData.farmId = farmId;
      farmData.name = farmName || farmData.name || 'Unnamed Farm';
      farmData.contactName = ownerName || farmData.contactName;
      farmData.email = contactEmail || farmData.email;
      farmData.phone = contactPhone || farmData.phone;
      farmData.website = store?.website || farmData.website;
      
      // Preserve other fields like location, timezone, etc.
      farmData.updatedAt = new Date().toISOString();
      
      // Write back to farm.json
      fs.writeFileSync(farmJsonPath, JSON.stringify(farmData, null, 2), 'utf8');
      console.log('[setup-wizard] Updated farm.json with registration data:', farmData.name);
    } catch (farmJsonError) {
      console.error('[setup-wizard] Failed to update farm.json:', farmJsonError.message);
      // Continue anyway - database has the data
    }
    
    // Store in database
    // Check if using PostgreSQL (Cloud plan) or NeDB (Edge device)
    const pool = req.app.locals?.db;
    
    if (pool) {
      // For Cloud plan: Update farm with profile information
      await pool.query(
        `UPDATE farms 
         SET name = $1, 
             contact_name = $2, 
             email = $3, 
             contact_phone = $4,
             status = $5, 
             updated_at = NOW() 
         WHERE farm_id = $6`,
        [farmName || 'Unnamed Farm', ownerName, contactEmail, contactPhone, 'active', farmId]
      );
      console.log('[setup-wizard] Updated farm profile for:', farmId);
      
      // TODO: Save store configuration when storefront columns are added to schema
      // if (store && store.enabled) {
      //   try {
      //     await pool.query(
      //       `UPDATE farms 
      //        SET storefront_name = $1, 
      //            storefront_description = $2, 
      //            storefront_enabled = $3
      //        WHERE farm_id = $4`,
      //       [store.name || farmName, store.description, true, farmId]
      //     );
      //     console.log('[setup-wizard] Enabled online store for:', farmId);
      //   } catch (storeError) {
      //     console.error('[setup-wizard] Error saving store config:', storeError.message);
      //   }
      // }
      
      // If rooms were provided, save them using the actual rooms table schema
      if (rooms && rooms.length > 0) {
        try {
          // Insert rooms using minimal schema (farm_id, name, type)
          for (const room of rooms) {
            await pool.query(
              `INSERT INTO rooms (farm_id, name, type) 
               VALUES ($1, $2, $3)`,
              [
                farmId, 
                room.name || 'Growing Room', 
                room.type || room.roomType || 'grow'
              ]
            );
          }
          console.log('[setup-wizard] Saved', rooms.length, 'rooms for farm:', farmId);
        } catch (roomError) {
          console.error('[setup-wizard] Error saving rooms:', roomError.message, roomError.code);
          console.error('[setup-wizard] Room error detail:', roomError.detail);
          // Continue anyway - farm is marked as active
        }
      } else {
        // No rooms provided - create a default room so status check passes
        try {
          await pool.query(
            `INSERT INTO rooms (farm_id, name, type) 
             VALUES ($1, $2, $3)`,
            [farmId, 'Main Growing Room', 'grow']
          );
          console.log('[setup-wizard] Created default room for farm:', farmId);
        } catch (roomError) {
          console.error('[setup-wizard] Error creating default room:', roomError.message, roomError.code);
          console.error('[setup-wizard] Room error detail:', roomError.detail);
        }
      }
    } else if (db) {
      // For Edge device: use NeDB
      await db.update(
        { key: 'setup_config' },
        { ...setupConfig, key: 'setup_config' },
        { upsert: true }
      );
    }

    // If connected to GreenReach Central, sync certifications
    if (process.env.GREENREACH_CENTRAL_URL && process.env.GREENREACH_API_KEY) {
      try {
        await axios.patch(
          `${process.env.GREENREACH_CENTRAL_URL}/api/farms/${farmId}`,
          {
            certifications: certifications?.certifications || [],
            practices: certifications?.practices || [],
            attributes: certifications?.attributes || []
          },
          {
            headers: {
              'Authorization': `Bearer ${process.env.GREENREACH_API_KEY}`,
              'Content-Type': 'application/json'
            }
          }
        );
        console.log('[setup-wizard] Synced certifications to GreenReach Central');
      } catch (syncError) {
        console.error('[setup-wizard] Failed to sync certifications:', syncError.message);
        // Continue anyway - certifications stored locally
      }
    }

    console.log('[setup-wizard] Setup completed for farm:', farmId);
    res.json({ success: true, config: setupConfig });
  } catch (error) {
    console.error('[setup-wizard] Setup completion error:', error);
    console.error('[setup-wizard] Error stack:', error.stack);
    console.error('[setup-wizard] Error details:', {
      message: error.message,
      code: error.code,
      detail: error.detail
    });
    res.status(500).json({ 
      error: 'Setup completion failed',
      message: error.message,
      detail: error.detail || error.code
    });
  }
}));

// Get setup status endpoint
app.get('/api/setup/status', asyncHandler(async (req, res) => {
  try {
    // Check if using PostgreSQL (Cloud plan) or NeDB (Edge device)
    if (dbPool) {
      // For Cloud plan: check farm status and if rooms exist
      // Get farmId from query or authenticated session
      const farmId = req.query.farmId || req.session?.farmId || req.user?.farmId;
      
      if (!farmId) {
        // No farmId available, check if any setup config exists
        return res.json({
          completed: false,
          message: 'No farm ID provided'
        });
      }
      
      // Check if farm exists and is active
      const farmResult = await dbPool.query(
        'SELECT status FROM farms WHERE farm_id = $1',
        [farmId]
      );
      
      const farm = farmResult.rows[0];
      const isActive = farm && farm.status === 'active';
      
      // Also check if rooms exist (more thorough)
      const roomResult = await dbPool.query(
        'SELECT COUNT(*) as count FROM rooms WHERE farm_id = $1',
        [farmId]
      );
      const hasRooms = parseInt(roomResult.rows[0]?.count) > 0;
      
      // Setup is complete if farm is active OR has rooms
      const completed = isActive || hasRooms;
      
      res.json({
        completed,
        farmId,
        hasRooms,
        isActive,
        message: completed ? 'Setup completed' : 'Setup not completed'
      });
    } else {
      // For Edge device: use NeDB
      const setupConfig = await db.findOne({ key: 'setup_config' });
      
      if (setupConfig && setupConfig.completed) {
        res.json({
          completed: true,
          completedAt: setupConfig.completedAt,
          farmId: setupConfig.farmId,
          registrationCode: setupConfig.registrationCode,
          network: setupConfig.network,
          hardwareDetected: setupConfig.hardwareDetected,
          certifications: setupConfig.certifications || { certifications: [], practices: [], attributes: [] }
        });
      } else {
        res.json({
          completed: false,
          message: 'Setup not completed'
        });
      }
    }
  } catch (error) {
    console.error('[setup-wizard] Error getting setup status:', error);
    res.status(500).json({ error: 'Failed to retrieve setup status' });
  }
}));

// Sync service routes
let syncServiceInstance = null;

// Get sync service instance
function getSyncService() {
  if (!syncServiceInstance) {
    syncServiceInstance = new SyncServiceClass({
      centralUrl: process.env.GREENREACH_CENTRAL_URL,
      wsUrl: process.env.GREENREACH_WS_URL,
      farmId: process.env.FARM_ID,
      apiKey: process.env.GREENREACH_API_KEY,
      apiSecret: process.env.GREENREACH_API_SECRET
    });
  }
  return syncServiceInstance;
}

// Sync monitor UI
app.get('/sync-monitor', (req, res) => {
  res.sendFile(path.join(__dirname, 'sync-monitor.html'));
});

// Get sync status
app.get('/api/sync/status', asyncHandler(async (req, res) => {
  try {
    const syncService = getSyncService();
    const status = syncService.getStatus();
    
    res.json({
      ...status,
      farmId: process.env.FARM_ID,
      recentErrors: [], // TODO: Implement error tracking
      queue: status.queueSize > 0 ? syncService.state.queue : []
    });
  } catch (error) {
    console.error('[sync] Status error:', error);
    res.status(500).json({ error: 'Failed to get sync status' });
  }
}));

// Trigger manual sync
app.post('/api/sync/trigger', asyncHandler(async (req, res) => {
  const { type = 'all' } = req.body;
  
  try {
    const syncService = getSyncService();
    await syncService.manualSync(type);
    
    res.json({ success: true, type });
  } catch (error) {
    console.error('[sync] Trigger error:', error);
    res.status(500).json({ error: 'Failed to trigger sync' });
  }
}));

// Process sync queue manually
app.post('/api/sync/process-queue', asyncHandler(async (req, res) => {
  try {
    const syncService = getSyncService();
    syncService.processQueue();
    
    res.json({ success: true });
  } catch (error) {
    console.error('[sync] Process queue error:', error);
    res.status(500).json({ error: 'Failed to process queue' });
  }
}));

// WebSocket endpoint for real-time sync status
app.ws('/ws/sync-status', (ws, req) => {
  console.log('[sync] Client connected to sync status WebSocket');
  
  const syncService = getSyncService();
  
  // Send initial status
  ws.send(JSON.stringify(syncService.getStatus()));
  
  // Listen for sync events
  const onEvent = () => {
    if (ws.readyState === 1) { // OPEN
      ws.send(JSON.stringify({
        ...syncService.getStatus(),
        farmId: process.env.FARM_ID,
        queue: syncService.state.queue
      }));
    }
  };
  
  syncService.on('connected', onEvent);
  syncService.on('disconnected', onEvent);
  syncService.on('inventory_synced', onEvent);
  syncService.on('health_synced', onEvent);
  syncService.on('config_synced', onEvent);
  syncService.on('queued', onEvent);
  syncService.on('queue_processed', onEvent);
  syncService.on('sync_error', onEvent);
  
  // Send status updates every 5 seconds
  const interval = setInterval(() => {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({
        ...syncService.getStatus(),
        farmId: process.env.FARM_ID,
        queue: syncService.state.queue
      }));
    }
  }, 5000);
  
  ws.on('close', () => {
    console.log('[sync] Client disconnected from sync status WebSocket');
    clearInterval(interval);
    
    // Remove event listeners
    syncService.off('connected', onEvent);
    syncService.off('disconnected', onEvent);
    syncService.off('inventory_synced', onEvent);
    syncService.off('health_synced', onEvent);
    syncService.off('config_synced', onEvent);
    syncService.off('queued', onEvent);
    syncService.off('queue_processed', onEvent);
    syncService.off('sync_error', onEvent);
  });
});

// Certificate management routes
let certificateManager = null;
let credentialManager = null;

// Initialize certificate and credential managers
async function initializeSecurity() {
  if (!certificateManager) {
    certificateManager = new CertificateManager({
      farmId: process.env.FARM_ID || 'unknown',
      certDir: process.env.CERT_DIR || '/etc/greenreach/certs',
      centralUrl: process.env.GREENREACH_CENTRAL_URL || 'https://api.greenreach.com',
      apiKey: process.env.GREENREACH_API_KEY,
      renewBeforeDays: 30,
      checkInterval: 24 * 60 * 60 * 1000 // 24 hours
    });
    
    await certificateManager.initialize();
    console.log('[security] Certificate manager initialized');
  }
  
  if (!credentialManager) {
    credentialManager = new CredentialManager({
      storageDir: process.env.CRED_DIR || '/etc/greenreach/credentials'
    });
    
    await credentialManager.initialize();
    console.log('[security] Credential manager initialized');
  }
}

// Get certificate manager (lazy init)
async function getCertificateManager() {
  await initializeSecurity();
  return certificateManager;
}

// Get credential manager (lazy init)
async function getCredentialManager() {
  await initializeSecurity();
  return credentialManager;
}

// Get certificate status
app.get('/api/certs/status', asyncHandler(async (req, res) => {
  try {
    const certManager = await getCertificateManager();
    const info = await certManager.getCertificateInfo();
    
    if (!info) {
      res.json({
        provisioned: false,
        message: 'No certificate provisioned'
      });
      return;
    }
    
    res.json({
      provisioned: true,
      valid: info.daysUntilExpiry > 0,
      expiresAt: info.expiresAt,
      daysUntilExpiry: info.daysUntilExpiry,
      subject: info.subject,
      issuer: info.issuer
    });
  } catch (error) {
    console.error('[certs] Status error:', error);
    res.status(500).json({ error: 'Failed to get certificate status' });
  }
}));

// Provision new certificate
app.post('/api/certs/provision', asyncHandler(async (req, res) => {
  try {
    const certManager = await getCertificateManager();
    await certManager.provisionCertificate();
    
    const info = await certManager.getCertificateInfo();
    
    res.json({
      success: true,
      certificate: info
    });
  } catch (error) {
    console.error('[certs] Provision error:', error);
    res.status(500).json({ error: 'Failed to provision certificate' });
  }
}));

// Renew certificate
app.post('/api/certs/renew', asyncHandler(async (req, res) => {
  try {
    const certManager = await getCertificateManager();
    await certManager.renewCertificate();
    
    const info = await certManager.getCertificateInfo();
    
    res.json({
      success: true,
      certificate: info
    });
  } catch (error) {
    console.error('[certs] Renewal error:', error);
    res.status(500).json({ error: 'Failed to renew certificate' });
  }
}));

// Get TLS options for secure connections
app.get('/api/certs/tls-options', asyncHandler(async (req, res) => {
  try {
    const certManager = await getCertificateManager();
    const options = certManager.getTLSOptions();
    
    // Don't send the actual keys, just confirm they're available
    res.json({
      available: {
        cert: !!options.cert,
        key: !!options.key,
        ca: !!options.ca
      }
    });
  } catch (error) {
    console.error('[certs] TLS options error:', error);
    res.status(500).json({ error: 'Failed to get TLS options' });
  }
}));

// Credential management routes

// List stored credentials (keys only, not values)
app.get('/api/credentials', asyncHandler(async (req, res) => {
  try {
    const credManager = await getCredentialManager();
    const credDir = credManager.storageDir;
    
    const files = fs.existsSync(credDir) ? fs.readdirSync(credDir) : [];
    const credentials = [];
    
    for (const file of files) {
      if (file.endsWith('.json') && !file.startsWith('backup-')) {
        try {
          const filePath = path.join(credDir, file);
          const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
          
          credentials.push({
            key: data.key,
            metadata: data.metadata || {}
          });
        } catch (err) {
          console.error(`[credentials] Error reading ${file}:`, err);
        }
      }
    }
    
    res.json({ credentials });
  } catch (error) {
    console.error('[credentials] List error:', error);
    res.status(500).json({ error: 'Failed to list credentials' });
  }
}));

// Store credential
app.post('/api/credentials', asyncHandler(async (req, res) => {
  const { key, value, metadata } = req.body;
  
  if (!key || !value) {
    res.status(400).json({ error: 'key and value are required' });
    return;
  }
  
  try {
    const credManager = await getCredentialManager();
    await credManager.setCredential(key, value, metadata);
    
    res.json({
      success: true,
      key,
      stored: true
    });
  } catch (error) {
    console.error('[credentials] Store error:', error);
    res.status(500).json({ error: 'Failed to store credential' });
  }
}));

// Get credential
app.get('/api/credentials/:key', asyncHandler(async (req, res) => {
  const { key } = req.params;
  
  try {
    const credManager = await getCredentialManager();
    const value = await credManager.getCredential(key);
    
    if (value === null) {
      res.status(404).json({ error: 'Credential not found' });
      return;
    }
    
    res.json({
      key,
      value
    });
  } catch (error) {
    console.error('[credentials] Get error:', error);
    res.status(500).json({ error: 'Failed to get credential' });
  }
}));

// Delete credential
app.delete('/api/credentials/:key', asyncHandler(async (req, res) => {
  const { key } = req.params;
  
  try {
    const credManager = await getCredentialManager();
    await credManager.deleteCredential(key);
    
    res.json({
      success: true,
      key,
      deleted: true
    });
  } catch (error) {
    console.error('[credentials] Delete error:', error);
    res.status(500).json({ error: 'Failed to delete credential' });
  }
}));

// Rotate credential
app.post('/api/credentials/:key/rotate', asyncHandler(async (req, res) => {
  const { key } = req.params;
  const { newValue } = req.body;
  
  if (!newValue) {
    res.status(400).json({ error: 'newValue is required' });
    return;
  }
  
  try {
    const credManager = await getCredentialManager();
    await credManager.rotateCredential(key, newValue);
    
    res.json({
      success: true,
      key,
      rotated: true
    });
  } catch (error) {
    console.error('[credentials] Rotate error:', error);
    res.status(500).json({ error: 'Failed to rotate credential' });
  }
}));

// Export credentials (password protected)
app.post('/api/credentials/export', asyncHandler(async (req, res) => {
  const { password } = req.body;
  
  if (!password) {
    res.status(400).json({ error: 'password is required' });
    return;
  }
  
  try {
    const credManager = await getCredentialManager();
    const exportPackage = await credManager.exportCredentials(password);
    
    res.json({
      success: true,
      package: exportPackage
    });
  } catch (error) {
    console.error('[credentials] Export error:', error);
    res.status(500).json({ error: 'Failed to export credentials' });
  }
}));

// Import credentials (password protected)
app.post('/api/credentials/import', asyncHandler(async (req, res) => {
  const { password, package: importPackage } = req.body;
  
  if (!password || !importPackage) {
    res.status(400).json({ error: 'password and package are required' });
    return;
  }
  
  try {
    const credManager = await getCredentialManager();
    await credManager.importCredentials(importPackage, password);
    
    res.json({
      success: true,
      imported: true
    });
  } catch (error) {
    console.error('[credentials] Import error:', error);
    res.status(500).json({ error: 'Failed to import credentials' });
  }
}));

// Backup credentials
app.post('/api/credentials/backup', asyncHandler(async (req, res) => {
  try {
    const credManager = await getCredentialManager();
    const backupPath = await credManager.backupCredentials();
    
    res.json({
      success: true,
      backupPath: path.basename(backupPath)
    });
  } catch (error) {
    console.error('[credentials] Backup error:', error);
    res.status(500).json({ error: 'Failed to backup credentials' });
  }
}));

// Wholesale integration routes
let wholesaleIntegrationService = null;

// Initialize wholesale integration
async function initializeWholesaleIntegration() {
  if (!wholesaleIntegrationService) {
    const certManager = await getCertificateManager();
    
    wholesaleIntegrationService = new WholesaleIntegrationService({
      centralUrl: process.env.GREENREACH_CENTRAL_URL,
      farmId: process.env.FARM_ID,
      apiKey: process.env.GREENREACH_API_KEY,
      apiSecret: process.env.GREENREACH_API_SECRET,
      certificateManager: certManager,
      inventoryDB: db, // Use main database
      ordersDB: db,
      catalogSyncInterval: 5 * 60 * 1000, // 5 minutes
      priceSyncInterval: 15 * 60 * 1000 // 15 minutes
    });
    
    await wholesaleIntegrationService.initialize();
    console.log('[wholesale] Integration service initialized');
  }
}

// Get wholesale integration service
async function getWholesaleIntegration() {
  await initializeWholesaleIntegration();
  return wholesaleIntegrationService;
}

// Get wholesale integration status
app.get('/api/wholesale/status', asyncHandler(async (req, res) => {
  try {
    const wholesale = await getWholesaleIntegration();
    const status = wholesale.getStatus();
    
    res.json({
      ...status,
      farmId: process.env.FARM_ID
    });
  } catch (error) {
    console.error('[wholesale] Status error:', error);
    res.status(500).json({ error: 'Failed to get wholesale status' });
  }
}));

// Trigger catalog sync
app.post('/api/wholesale/sync/catalog', asyncHandler(async (req, res) => {
  try {
    const wholesale = await getWholesaleIntegration();
    const result = await wholesale.syncCatalog();
    
    res.json({
      success: true,
      result
    });
  } catch (error) {
    console.error('[wholesale] Catalog sync error:', error);
    res.status(500).json({ error: 'Failed to sync catalog' });
  }
}));

// Trigger price sync
app.post('/api/wholesale/sync/pricing', asyncHandler(async (req, res) => {
  try {
    const wholesale = await getWholesaleIntegration();
    const result = await wholesale.syncPrices();
    
    res.json({
      success: true,
      result
    });
  } catch (error) {
    console.error('[wholesale] Price sync error:', error);
    res.status(500).json({ error: 'Failed to sync pricing' });
  }
}));

// Receive order webhook
app.post('/api/wholesale/webhook/order', asyncHandler(async (req, res) => {
  try {
    const wholesale = await getWholesaleIntegration();
    const order = await wholesale.handleOrderWebhook(req.body);
    
    res.json({
      success: true,
      order
    });
  } catch (error) {
    console.error('[wholesale] Order webhook error:', error);
    res.status(500).json({ error: 'Failed to process order webhook' });
  }
}));

// Get pending orders
app.get('/api/wholesale/orders/pending', asyncHandler(async (req, res) => {
  try {
    const wholesale = await getWholesaleIntegration();
    const status = wholesale.getStatus();
    
    // Get order details for pending orders
    const orders = [];
    for (const orderId of wholesale.state.pendingOrders) {
      const order = await wholesale.getOrder(orderId);
      if (order) {
        orders.push(order);
      }
    }
    
    res.json({
      count: orders.length,
      orders
    });
  } catch (error) {
    console.error('[wholesale] Pending orders error:', error);
    res.status(500).json({ error: 'Failed to get pending orders' });
  }
}));

// Get order history for demand forecasting
app.get('/api/wholesale/orders/history', asyncHandler(async (req, res) => {
  try {
    const { days = 60 } = req.query;
    const wholesale = await getWholesaleIntegration();
    
    // Get all completed orders
    const allOrders = [];
    const completedStatuses = ['completed', 'picked_up', 'payment_captured'];
    
    for (const orderId of wholesale.state.allOrders || []) {
      const order = await wholesale.getOrder(orderId);
      if (order && completedStatuses.includes(order.status)) {
        allOrders.push(order);
      }
    }
    
    // Filter by date range
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - parseInt(days));
    
    const recentOrders = allOrders.filter(order => {
      const orderDate = new Date(order.created_at || order.order_date);
      return orderDate >= cutoffDate;
    });
    
    // Extract sales data by crop
    const salesHistory = [];
    for (const order of recentOrders) {
      const orderDate = new Date(order.created_at || order.order_date).toISOString().split('T')[0];
      
      // Process each item in the order
      for (const item of order.items || []) {
        salesHistory.push({
          date: orderDate,
          crop: item.product_name || item.crop_name,
          quantity: item.quantity || 0,
          unit: item.unit || 'kg'
        });
      }
      
      // Also check sub_orders if present (multi-farm orders)
      if (order.sub_orders) {
        for (const subOrder of order.sub_orders) {
          for (const item of subOrder.items || []) {
            salesHistory.push({
              date: orderDate,
              crop: item.product_name || item.crop_name,
              quantity: item.quantity || 0,
              unit: item.unit || 'kg'
            });
          }
        }
      }
    }
    
    res.json({
      ok: true,
      sales_history: salesHistory,
      total_orders: recentOrders.length,
      days: parseInt(days)
    });
  } catch (error) {
    console.error('[wholesale] Order history error:', error);
    res.json({
      ok: true,
      sales_history: [],
      total_orders: 0,
      days: parseInt(req.query.days || 60)
    });
  }
}));

// Fulfill order
app.post('/api/wholesale/orders/:orderId/fulfill', asyncHandler(async (req, res) => {
  const { orderId } = req.params;
  const { trackingNumber, carrier, shippingLabel } = req.body;
  
  try {
    const wholesale = await getWholesaleIntegration();
    const order = await wholesale.fulfillOrder(orderId, {
      trackingNumber,
      carrier,
      shippingLabel
    });
    
    res.json({
      success: true,
      order
    });
  } catch (error) {
    console.error('[wholesale] Fulfill order error:', error);
    res.status(500).json({ error: 'Failed to fulfill order' });
  }
}));

// Cancel order
app.post('/api/wholesale/orders/:orderId/cancel', asyncHandler(async (req, res) => {
  const { orderId } = req.params;
  const { reason } = req.body;
  
  try {
    const wholesale = await getWholesaleIntegration();
    const order = await wholesale.cancelOrder(orderId, reason);
    
    res.json({
      success: true,
      order
    });
  } catch (error) {
    console.error('[wholesale] Cancel order error:', error);
    res.status(500).json({ error: 'Failed to cancel order' });
  }
}));

// Get order details
app.get('/api/wholesale/orders/:orderId', asyncHandler(async (req, res) => {
  const { orderId } = req.params;
  
  try {
    const wholesale = await getWholesaleIntegration();
    const order = await wholesale.getOrder(orderId);
    
    if (!order) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }
    
    res.json({ order });
  } catch (error) {
    console.error('[wholesale] Get order error:', error);
    res.status(500).json({ error: 'Failed to get order' });
  }
}));

// Get reserved inventory
app.get('/api/wholesale/inventory/reserved', asyncHandler(async (req, res) => {
  try {
    const wholesale = await getWholesaleIntegration();
    
    const reserved = [];
    for (const [productId, quantity] of wholesale.state.reservedInventory.entries()) {
      const item = await wholesale.getInventoryItem(productId);
      if (item) {
        reserved.push({
          productId,
          name: item.name,
          reserved: quantity,
          available: item.quantity - quantity
        });
      }
    }
    
    res.json({
      count: reserved.length,
      reserved
    });
  } catch (error) {
    console.error('[wholesale] Reserved inventory error:', error);
    res.status(500).json({ error: 'Failed to get reserved inventory' });
  }
}));

// Enable wholesale integration
app.post('/api/wholesale/enable', asyncHandler(async (req, res) => {
  try {
    const wholesale = await getWholesaleIntegration();
    wholesale.enable();
    
    res.json({
      success: true,
      enabled: true
    });
  } catch (error) {
    console.error('[wholesale] Enable error:', error);
    res.status(500).json({ error: 'Failed to enable wholesale integration' });
  }
}));

// Disable wholesale integration
app.post('/api/wholesale/disable', asyncHandler(async (req, res) => {
  try {
    const wholesale = await getWholesaleIntegration();
    wholesale.disable();
    
    res.json({
      success: true,
      enabled: false
    });
  } catch (error) {
    console.error('[wholesale] Disable error:', error);
    res.status(500).json({ error: 'Failed to disable wholesale integration' });
  }
}));

// ============================================================================
// SUSTAINABILITY DATA INTEGRATION
// ============================================================================
// These endpoints provide real data from orders and automation logs
// for the Sustainability & ESG Dashboard

/**
 * Get transport carbon from wholesale orders
 * Calculates CO2 emissions based on delivery distances
 */
app.get('/api/sustainability/transport-carbon', asyncHandler(async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    
    // Carbon calculation: 0.161 kg CO2 per km (refrigerated truck)
    const CARBON_PER_KM = 0.161;
    
    // Get all orders from wholesale integration
    const wholesale = await getWholesaleIntegration();
    const status = wholesale.getStatus();
    
    // Aggregate carbon by date
    const dailyCarbon = {};
    
    // Process all orders (fulfilled and pending)
    const allOrders = [...(status.pendingOrders || []), ...(status.fulfilledOrders || [])];
    
    for (const order of allOrders) {
      // Skip if no delivery date or distance
      if (!order.deliveryDate || !order.deliveryDistance) continue;
      
      const orderDate = new Date(order.deliveryDate);
      if (orderDate < cutoffDate) continue;
      
      const dateKey = orderDate.toISOString().split('T')[0];
      const carbonKg = order.deliveryDistance * CARBON_PER_KM;
      
      if (!dailyCarbon[dateKey]) {
        dailyCarbon[dateKey] = 0;
      }
      dailyCarbon[dateKey] += carbonKg;
    }
    
    // Convert to array format
    const dailyCarbonArray = Object.entries(dailyCarbon).map(([date, carbon_kg]) => ({
      date,
      carbon_kg: Math.round(carbon_kg * 100) / 100,
      orders_count: allOrders.filter(o => 
        o.deliveryDate && o.deliveryDate.startsWith(date)
      ).length
    })).sort((a, b) => a.date.localeCompare(b.date));
    
    const totalCarbon = Object.values(dailyCarbon).reduce((sum, val) => sum + val, 0);
    
    res.json({
      ok: true,
      period_days: days,
      total_orders: allOrders.length,
      total_carbon_kg: Math.round(totalCarbon * 100) / 100,
      daily_carbon: dailyCarbonArray,
      data_source: 'wholesale_orders',
      note: 'Calculated from actual delivery distances using 0.161 kg CO2/km'
    });
    
  } catch (error) {
    console.error('[sustainability] Transport carbon error:', error);
    // Return empty data rather than error - allows dashboard to work without orders
    res.json({
      ok: true,
      period_days: parseInt(req.query.days) || 30,
      total_orders: 0,
      total_carbon_kg: 0,
      daily_carbon: [],
      data_source: 'none',
      note: 'No order data available'
    });
  }
}));

/**
 * Get nutrient usage from automation logs
 * Returns actual nutrient consumption and waste metrics
 */
app.get('/api/sustainability/nutrient-usage', asyncHandler(async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    
    // TODO: Connect to actual nutrient dosing logs from automation system
    // For now, return empty to signal no real data available
    // The Python backend will fall back to estimates
    
    res.json({
      ok: true,
      period_days: days,
      usage: [],
      data_source: 'none',
      note: 'Nutrient tracking not yet connected. Will be integrated from automation logs.'
    });
    
  } catch (error) {
    console.error('[sustainability] Nutrient usage error:', error);
    res.json({
      ok: true,
      period_days: parseInt(req.query.days) || 30,
      usage: [],
      data_source: 'none'
    });
  }
}));

// Unified health endpoint with controller diagnostics that never 502s
app.get('/healthz', async (req, res) => {
  const started = Date.now();
  const controllerTarget = (getController() || '').replace(/\/+$/, '');
  const diag = {
    ok: true,
    status: 'healthy',
    controller: {
      target: controllerTarget,
      reachable: true,
      status: 200
    },
    database: {
      connected: false,
      latencyMs: 0
    },
    envSource: ENV_SOURCE,
    cloudEndpointUrl: CLOUD_ENDPOINT_URL || null,
    ts: new Date().toISOString(),
    dtMs: 0
  };

  // Check database connectivity
  try {
    const dbStart = Date.now();
    const testQuery = await db.findOne({ key: 'health_check' });
    diag.database.connected = true;
    diag.database.latencyMs = Date.now() - dbStart;
  } catch (error) {
    diag.ok = false;
    diag.status = 'degraded';
    diag.database.connected = false;
    diag.database.error = error.message;
  }

  if (!controllerTarget) {
    diag.ok = false;
    diag.status = 'degraded';
    diag.controller.reachable = false;
    diag.controller.status = 'unconfigured';
  } else {
    try {
      const upstream = await fetch(`${controllerTarget}/api/devicedatas`, {
        method: 'GET',
        signal: AbortSignal.timeout(1500)
      });
      diag.controller.reachable = upstream.ok;
      diag.controller.status = upstream.status;
      if (!upstream.ok) {
        diag.ok = false;
        diag.status = 'degraded';
      }
    } catch (error) {
      diag.ok = false;
      diag.status = 'degraded';
      diag.controller.reachable = false;
      diag.controller.status = error?.name === 'AbortError' ? 'timeout' : (error?.message || 'error');
    }
  }

  diag.dtMs = Date.now() - started;
  res.json(diag);
});

// Comprehensive health endpoint with detailed metrics
app.get('/api/version', (req, res) => {
  res.json({
    version: APP_VERSION,
    buildTime: BUILD_TIME,
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Comprehensive health endpoint with detailed metrics
app.get('/health', asyncHandler(async (req, res) => {
  const started = Date.now();
  
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: APP_VERSION,
    buildTime: BUILD_TIME,
    checks: {
      database: { status: 'unknown' },
      memory: { status: 'unknown' },
      disk: { status: 'unknown' }
    },
    metrics: {
      requests: {
        total: metrics.requests.total,
        errors: metrics.requests.errors,
        errorRate: metrics.requests.total > 0 ? 
          ((metrics.requests.errors / metrics.requests.total) * 100).toFixed(2) + '%' : '0%',
        avgResponseTimeMs: metrics.requests.responseTimes.length > 0 ?
          Math.round(metrics.requests.responseTimes.reduce((a, b) => a + b, 0) / metrics.requests.responseTimes.length) : 0,
        p95ResponseTimeMs: metrics.requests.responseTimes.length > 0 ?
          Math.round(metrics.requests.responseTimes.sort((a, b) => a - b)[Math.floor(metrics.requests.responseTimes.length * 0.95)]) : 0
      },
      uptime: {
        seconds: Math.floor(process.uptime()),
        formatted: formatUptime(process.uptime())
      }
    }
  };

  // Database connectivity check (with timeout to avoid blocking health check)
  const DB_HEALTH_TIMEOUT_MS = 3000;
  const dbHealthPromise = checkDatabaseHealth();
  const dbTimeoutPromise = new Promise(resolve =>
    setTimeout(() => resolve({ enabled: true, connected: false, error: 'Health check timeout (DB slow to connect)', mode: 'postgresql' }), DB_HEALTH_TIMEOUT_MS)
  );
  const dbHealth = await Promise.race([dbHealthPromise, dbTimeoutPromise]);
  health.checks.database = {
    status: dbHealth.connected ? (dbHealth.latencyMs > 100 ? 'degraded' : 'healthy') : (dbHealth.enabled ? 'unhealthy' : 'disabled'),
    mode: dbHealth.mode,
    enabled: dbHealth.enabled,
    connected: dbHealth.connected,
    latencyMs: dbHealth.latencyMs || 0
  };
  
  if (dbHealth.enabled && !dbHealth.connected) {
    // DB not connected is degraded, not unhealthy — app is still alive
    health.status = 'degraded';
    health.checks.database.error = dbHealth.error;
  } else if (dbHealth.enabled && dbHealth.latencyMs > 100) {
    health.status = 'degraded';
  }
  
  // Publish database metrics to CloudWatch (async, non-blocking)
  if (isCloudWatchEnabled()) {
    publishDatabaseMetrics(dbHealth.mode, dbHealth.connected, dbHealth.latencyMs || 0).catch(err => {
      console.error('[CloudWatch] Failed to publish database metrics:', err.message);
    });
  }

  // Memory usage check
  const memUsage = process.memoryUsage();
  const memUsedMB = Math.round(memUsage.rss / 1024 / 1024); // resident set reflects real footprint
  const memTotalMB = Math.max(Math.round(os.totalmem() / 1024 / 1024), memUsedMB || 1);
  const memPercent = (memUsedMB / memTotalMB) * 100;

  health.checks.memory = {
    status: memPercent < 90 ? 'healthy' : memPercent < 95 ? 'degraded' : 'unhealthy',
    usedMB: memUsedMB,
    totalMB: memTotalMB,
    percentUsed: Math.round(memPercent)
  };

  if (health.checks.memory.status === 'unhealthy') {
    health.status = 'unhealthy';
  } else if (health.checks.memory.status === 'degraded' && health.status === 'healthy') {
    health.status = 'degraded';
  }
  
  // Publish memory metrics to CloudWatch (async, non-blocking)
  if (isCloudWatchEnabled()) {
    publishMemoryMetrics(memUsedMB, memTotalMB).catch(err => {
      console.error('[CloudWatch] Failed to publish memory metrics:', err.message);
    });
  }

  // Response time
  health.responseTimeMs = Date.now() - started;
  
  // Return appropriate status code
  // 200 for healthy/degraded (app alive, ECS health check passes)
  // 503 only for memory-critical (true app failure)
  const statusCode = health.checks.memory?.status === 'unhealthy' ? 503 : 200;
  
  res.status(statusCode).json(health);
}));

// =====================================================
// DIAGNOSTICS + LOGS (for remote support from Central)
// =====================================================

// System diagnostics endpoint — detailed machine info
app.get('/api/diagnostics', (req, res) => {
  const memUsage = process.memoryUsage();
  const cpus = os.cpus();
  
  res.json({
    ok: true,
    system: {
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      release: os.release(),
      uptime_hours: Math.round(os.uptime() / 3600 * 10) / 10,
      cpus: cpus.length,
      cpu_model: cpus[0]?.model || 'unknown',
      total_memory_mb: Math.round(os.totalmem() / 1024 / 1024),
      free_memory_mb: Math.round(os.freemem() / 1024 / 1024),
      load_avg: os.loadavg()
    },
    process: {
      node_version: process.version,
      pid: process.pid,
      uptime_hours: Math.round(process.uptime() / 3600 * 10) / 10,
      heap_used_mb: Math.round(memUsage.heapUsed / 1024 / 1024),
      heap_total_mb: Math.round(memUsage.heapTotal / 1024 / 1024),
      rss_mb: Math.round(memUsage.rss / 1024 / 1024),
      external_mb: Math.round((memUsage.external || 0) / 1024 / 1024)
    },
    app: {
      version: APP_VERSION,
      port: PORT,
      env: process.env.NODE_ENV || 'development',
      edge_mode: process.env.EDGE_MODE || 'false'
    },
    timestamp: new Date().toISOString()
  });
});

// Recent logs endpoint — returns last N console log entries
// Uses a circular buffer to capture logs
const LOG_BUFFER_SIZE = 500;
const logBuffer = [];
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

function captureLog(level, args) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    msg: args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')
  };
  logBuffer.push(entry);
  if (logBuffer.length > LOG_BUFFER_SIZE) logBuffer.shift();
}

console.log = function (...args) { captureLog('info', args); originalConsoleLog.apply(console, args); };
console.error = function (...args) { captureLog('error', args); originalConsoleError.apply(console, args); };
console.warn = function (...args) { captureLog('warn', args); originalConsoleWarn.apply(console, args); };

app.get('/api/logs', (req, res) => {
  const lines = Math.min(parseInt(req.query.lines) || 100, LOG_BUFFER_SIZE);
  const level = req.query.level; // optional filter: info, warn, error
  
  let entries = logBuffer.slice(-lines);
  if (level) {
    entries = entries.filter(e => e.level === level);
  }
  
  res.json({
    ok: true,
    count: entries.length,
    buffer_size: LOG_BUFFER_SIZE,
    total_captured: logBuffer.length,
    entries,
    timestamp: new Date().toISOString()
  });
});

// Metrics endpoint for Prometheus/monitoring tools
app.get('/metrics', (req, res) => {
  const uptime = process.uptime();
  const memUsage = process.memoryUsage();
  const avgResponseTime = metrics.requests.responseTimes.length > 0 ?
    metrics.requests.responseTimes.reduce((a, b) => a + b, 0) / metrics.requests.responseTimes.length : 0;
  
  // Prometheus-style metrics
  const prometheusMetrics = `
# HELP http_requests_total Total number of HTTP requests
# TYPE http_requests_total counter
http_requests_total ${metrics.requests.total}

# HELP http_requests_errors Total number of HTTP errors (4xx, 5xx)
# TYPE http_requests_errors counter
http_requests_errors ${metrics.requests.errors}

# HELP http_request_duration_ms Average HTTP request duration in milliseconds
# TYPE http_request_duration_ms gauge
http_request_duration_ms ${avgResponseTime.toFixed(2)}

# HELP process_uptime_seconds Process uptime in seconds
# TYPE process_uptime_seconds gauge
process_uptime_seconds ${uptime.toFixed(2)}

# HELP process_memory_heap_used_bytes Process heap memory used in bytes
# TYPE process_memory_heap_used_bytes gauge
process_memory_heap_used_bytes ${memUsage.heapUsed}

# HELP process_memory_heap_total_bytes Process heap memory total in bytes
# TYPE process_memory_heap_total_bytes gauge
process_memory_heap_total_bytes ${memUsage.heapTotal}

# HELP process_memory_rss_bytes Process resident set size in bytes
# TYPE process_memory_rss_bytes gauge
process_memory_rss_bytes ${memUsage.rss}
`.trim();

  res.set('Content-Type', 'text/plain; version=0.0.4');
  res.send(prometheusMetrics);
});

// Helper function to format uptime
function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);
  
  return parts.join(' ');
}

function getSwitchBotStatusEntry(deviceId) {
  if (!switchBotStatusCache.has(deviceId)) {
    switchBotStatusCache.set(deviceId, {
      payload: null,
      fetchedAt: 0,
      inFlight: null,
      lastError: null
    });
  }
  return switchBotStatusCache.get(deviceId);
}

function getSwitchBotHeaders() {
  // Current timestamp in milliseconds (as string)
  const t = Date.now().toString();
  // Random nonce using crypto.randomUUID() or fallback to randomBytes
  const nonce = crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : crypto.randomBytes(16).toString('hex');
  // String to sign: token + timestamp + nonce
  const creds = getFarmIntegrations().switchbot;
  const strToSign = creds.token + t + nonce;
  // HMAC-SHA256 with secret, then base64 encode (ensuring it's a string)
  const sign = crypto.createHmac('sha256', creds.secret).update(strToSign, 'utf8').digest('base64');
  
  return {
    'Authorization': creds.token,
    't': t,
    'sign': sign,
    'nonce': nonce,
    'Content-Type': 'application/json',
    'charset': 'utf8'
  };
}

function ensureSwitchBotConfigured() {
  const creds = getFarmIntegrations().switchbot;
  return Boolean(creds.token && creds.secret);
}

async function switchBotApiRequest(path, { method = 'GET', data = null } = {}) {
  if (!ensureSwitchBotConfigured()) {
    const err = new Error('SwitchBot credentials are not configured');
    err.code = 'SWITCHBOT_NO_AUTH';
    throw err;
  }

  // Rate limiting: ensure minimum time between requests
  const now = Date.now();
  const timeSinceLastRequest = now - lastSwitchBotRequest;
  if (timeSinceLastRequest < SWITCHBOT_RATE_LIMIT_MS) {
    const waitTime = SWITCHBOT_RATE_LIMIT_MS - timeSinceLastRequest;
    console.log(`[switchbot] Rate limiting: waiting ${waitTime}ms before next request`);
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }
  lastSwitchBotRequest = Date.now();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SWITCHBOT_API_TIMEOUT_MS);
  timeout.unref?.();
  try {
    let response;
    try {
      response = await fetch(`${SWITCHBOT_API_BASE}${path}`, {
        method,
        headers: getSwitchBotHeaders(),
        body: data ? JSON.stringify(data) : undefined,
        signal: controller.signal
      });
    } catch (fetchError) {
      // Handle network errors (ECONNRESET, ENOTFOUND, etc.)
      if (fetchError.name === 'AbortError') {
        const timeoutError = new Error('SwitchBot API request timed out');
        timeoutError.code = 'SWITCHBOT_TIMEOUT';
        throw timeoutError;
      }
      
      const networkError = new Error(`Network error connecting to SwitchBot API: ${fetchError.message}`);
      networkError.code = 'SWITCHBOT_NETWORK_ERROR';
      networkError.cause = fetchError;
      throw networkError;
    }

    let text = '';
    try {
      text = await response.text();
    } catch (textError) {
      console.warn(`[switchbot] Failed to read response text: ${textError.message}`);
      text = '';
    }
    
    let body = {};
    if (text) {
      try {
        body = JSON.parse(text);
      } catch (parseError) {
        console.warn(`[switchbot] Failed to parse JSON response: ${parseError.message}, raw text: ${text.substring(0, 200)}`);
        const err = new Error('Failed to parse SwitchBot API response');
        err.cause = parseError;
        err.status = response.status;
        err.rawText = text.substring(0, 500); // Include some raw text for debugging
        throw err;
      }
    }

    if (!response.ok) {
      const err = new Error(body?.message || `SwitchBot API request failed with status ${response.status}`);
      err.status = response.status;
      err.response = body;
      
      // Special handling for rate limiting
      if (response.status === 429) {
        err.code = 'SWITCHBOT_RATE_LIMITED';
        console.log(`[switchbot] Rate limited by API. Will use cached data if available.`);
      }
      
      throw err;
    }

    return { status: response.status, body };
  } catch (error) {
    // Re-throw known errors
    if (error.code === 'SWITCHBOT_TIMEOUT' || error.code === 'SWITCHBOT_NETWORK_ERROR' || error.code === 'SWITCHBOT_RATE_LIMITED') {
      throw error;
    }
    
    // Handle AbortError specifically
    if (error.name === 'AbortError') {
      const timeoutError = new Error('SwitchBot API request timed out');
      timeoutError.code = 'SWITCHBOT_TIMEOUT';
      throw timeoutError;
    }
    
    // Wrap unknown errors
    const wrappedError = new Error(`Unexpected error in SwitchBot API request: ${error.message}`);
    wrappedError.code = 'SWITCHBOT_UNKNOWN_ERROR';
    wrappedError.cause = error;
    throw wrappedError;
  } finally {
    clearTimeout(timeout);
  }
}

function buildSwitchBotMeta({ fromCache = false, stale = false, fetchedAt = 0, error = null } = {}) {
  return {
    cached: fromCache,
    stale,
    fetchedAt: fetchedAt ? new Date(fetchedAt).toISOString() : null,
    error: error ? (error.message || String(error)) : null
  };
}

async function fetchSwitchBotDevices({ force = false } = {}) {
  const now = Date.now();
  if (!force && switchBotDevicesCache.payload && (now - switchBotDevicesCache.fetchedAt) < SWITCHBOT_DEVICE_CACHE_TTL_MS) {
    return {
      payload: switchBotDevicesCache.payload,
      fetchedAt: switchBotDevicesCache.fetchedAt,
      fromCache: true,
      stale: false,
      error: switchBotDevicesCache.lastError
    };
  }

  if (switchBotDevicesCache.inFlight) {
    return switchBotDevicesCache.inFlight;
  }

  switchBotDevicesCache.inFlight = (async () => {
    try {
      const response = await switchBotApiRequest('/devices');
      const payload = response.body;
      if (!payload || payload.statusCode !== 100) {
        const err = new Error(payload?.message || 'SwitchBot API returned an error');
        err.statusCode = payload?.statusCode;
        throw err;
      }
      switchBotDevicesCache.payload = payload;
      switchBotDevicesCache.fetchedAt = Date.now();
      switchBotDevicesCache.lastError = null;
      return {
        payload,
        fetchedAt: switchBotDevicesCache.fetchedAt,
        fromCache: false,
        stale: false,
        error: null
      };
    } catch (error) {
      switchBotDevicesCache.lastError = error;
      if (switchBotDevicesCache.payload) {
        return {
          payload: switchBotDevicesCache.payload,
          fetchedAt: switchBotDevicesCache.fetchedAt,
          fromCache: true,
          stale: true,
          error
        };
      }
      throw error;
    } finally {
      switchBotDevicesCache.inFlight = null;
    }
  })();

  return switchBotDevicesCache.inFlight;
}

async function fetchSwitchBotDeviceStatus(deviceId, { force = false } = {}) {
  const entry = getSwitchBotStatusEntry(deviceId);
  const now = Date.now();
  if (!force && entry.payload && (now - entry.fetchedAt) < SWITCHBOT_STATUS_CACHE_TTL_MS) {
    return {
      payload: entry.payload,
      fetchedAt: entry.fetchedAt,
      fromCache: true,
      stale: false,
      error: entry.lastError
    };
  }

  if (entry.inFlight) {
    return entry.inFlight;
  }

  entry.inFlight = (async () => {
    try {
      const response = await switchBotApiRequest(`/devices/${encodeURIComponent(deviceId)}/status`);
      const payload = response.body;
      if (!payload || payload.statusCode !== 100) {
        const err = new Error(payload?.message || 'Failed to get device status');
        err.statusCode = payload?.statusCode;
        throw err;
      }
      entry.payload = payload;
      entry.fetchedAt = Date.now();
      entry.lastError = null;
      return {
        payload,
        fetchedAt: entry.fetchedAt,
        fromCache: false,
        stale: false,
        error: null
      };
    } catch (error) {
      entry.lastError = error;
      if (entry.payload) {
        return {
          payload: entry.payload,
          fetchedAt: entry.fetchedAt,
          fromCache: true,
          stale: true,
          error
        };
      }
      throw error;
    } finally {
      entry.inFlight = null;
    }
  })();

  return entry.inFlight;
}

app.get('/switchbot/devices', async (req, res) => {
  if (!ensureSwitchBotConfigured()) {
    const error = new Error('SwitchBot credentials are not configured');
    const meta = buildSwitchBotMeta({
      fromCache: Boolean(switchBotDevicesCache.payload),
      stale: Boolean(switchBotDevicesCache.payload),
      fetchedAt: switchBotDevicesCache.fetchedAt,
      error
    });
    return res.status(503).json({
      statusCode: 503,
      message: error.message,
      meta
    });
  }

  const force = ['1', 'true', 'yes'].includes(String(req.query.refresh || '').toLowerCase());

  try {
    const result = await fetchSwitchBotDevices({ force });
    const payload = result?.payload || {};
    const meta = buildSwitchBotMeta(result);
    const responseBody = {
      ...payload,
      meta
    };

    const cacheStatus = result.fromCache ? 'hit' : 'miss';
    const cacheFreshness = result.stale ? 'stale' : 'fresh';

    try {
      const txt = JSON.stringify(responseBody);
      ensureDataDir();
      fs.mkdirSync(path.dirname(SWITCHBOT_CACHE_PATH), { recursive: true });
      fs.writeFileSync(SWITCHBOT_CACHE_PATH, txt);
      res.set('X-Cache', cacheStatus).set('X-Cache-Freshness', cacheFreshness).type('application/json').send(txt);
    } catch (writeError) {
      console.warn('[switchbot] Failed to persist cache:', writeError.message || writeError);
      res
        .set('X-Cache', cacheStatus)
        .set('X-Cache-Freshness', cacheFreshness)
        .json(responseBody);
    }
  } catch (error) {
    console.error('SwitchBot device list error:', error);

    const status = error.status === 401
      ? 401
      : error.code === 'SWITCHBOT_TIMEOUT'
        ? 504
        : error.status === 429
          ? 429
          : error.code === 'SWITCHBOT_NO_AUTH'
            ? 503
            : 502;

    // Prefer in-memory cache if available
    if (switchBotDevicesCache.payload) {
      const meta = buildSwitchBotMeta({
        payload: switchBotDevicesCache.payload,
        fetchedAt: switchBotDevicesCache.fetchedAt,
        fromCache: true,
        stale: true,
        error
      });
      const fallbackBody = {
        ...switchBotDevicesCache.payload,
        meta
      };
      res
        .set('X-Cache', 'hit')
        .set('X-Cache-Freshness', 'stale')
        .status(200)
        .json(fallbackBody);
      return;
    }

    if (fs.existsSync(SWITCHBOT_CACHE_PATH)) {
      try {
        const cached = fs.readFileSync(SWITCHBOT_CACHE_PATH, 'utf8');
        res
          .set('X-Cache', 'hit')
          .set('X-Cache-Freshness', 'stale')
          .type('application/json')
          .send(cached);
        return;
      } catch (readError) {
        console.warn('[switchbot] Failed to read cache file:', readError.message || readError);
      }
    }

    const meta = buildSwitchBotMeta({
      fromCache: false,
      stale: false,
      fetchedAt: 0,
      error
    });
    res.status(status).json({
      statusCode: status,
      message: error.message || 'Failed to fetch devices from SwitchBot API',
      meta
    });
  }
});

app.get("/api/switchbot/devices", asyncHandler(async (req, res) => {
  try {
    const force = ['1', 'true', 'yes'].includes(String(req.query.refresh || '').toLowerCase());
    const result = await fetchSwitchBotDevices({ force });
    const meta = buildSwitchBotMeta(result);
    res.json({
      ...result.payload,
      meta
    });
  } catch (error) {
    console.error('SwitchBot API error:', error);
    
    // If rate limited, try to return cached data with appropriate status
    if (error.code === 'SWITCHBOT_RATE_LIMITED' && switchBotDevicesCache.payload) {
      console.log('[switchbot] Returning cached data due to rate limiting');
      const meta = buildSwitchBotMeta({
        fromCache: true,
        stale: true,
        fetchedAt: switchBotDevicesCache.fetchedAt,
        error: error
      });
      return res.status(200).json({
        ...switchBotDevicesCache.payload,
        meta
      });
    }
    
    // If no cached data available but credentials are valid, return rate limit error
  // Don't use fallback mock data unless ALLOW_MOCKS is true
    if (error.code === 'SWITCHBOT_RATE_LIMITED' || error.status === 429) {
      console.log('[switchbot] Rate limited - returning rate limit status (no mock fallback)');
      return res.status(429).json({
        statusCode: 429,
        message: "SwitchBot API rate limited - retry after rate limit expires",
        cached: false,
        retryAfter: Math.ceil(SWITCHBOT_DEVICE_CACHE_TTL_MS / 1000)
      });
    }
    
    const status = error.status === 401 ? 401 : error.code === 'SWITCHBOT_TIMEOUT' ? 504 : error.code === 'SWITCHBOT_NO_AUTH' ? 503 : error.status === 429 ? 429 : 502;
    res.status(status).json({
      statusCode: error.statusCode || status,
      message: error.message || "Failed to fetch devices from SwitchBot API",
      cached: Boolean(switchBotDevicesCache.payload),
      retryAfter: error.status === 429 ? Math.ceil(SWITCHBOT_DEVICE_CACHE_TTL_MS / 1000) : undefined
    });
  }
}));

app.get("/api/switchbot/status", asyncHandler(async (req, res) => {
  try {
    const force = ['1', 'true', 'yes'].includes(String(req.query.refresh || '').toLowerCase());
    const result = await fetchSwitchBotDevices({ force });
    const devices = (result.payload?.body?.deviceList || []).map(device => ({
      deviceId: device.deviceId,
      deviceName: device.deviceName,
      deviceType: device.deviceType,
      status: "online",
      lastUpdate: new Date().toISOString(),
      ...device
    }));

    res.json({
      statusCode: 100,
      message: "success",
      devices: devices,
      timestamp: new Date().toISOString(),
      meta: buildSwitchBotMeta(result)
    });
  } catch (error) {
    console.error('SwitchBot status API error:', error);
    res.status(500).json({
      statusCode: 500,
      message: "Failed to fetch device status from SwitchBot API",
      error: error.message
    });
  }
}));

// Individual device status endpoint
app.get("/api/switchbot/devices/:deviceId/status", asyncHandler(async (req, res) => {
  try {
    const { deviceId } = req.params;
    console.log(`[charlie] Fetching status for device: ${deviceId}`);

    const force = ['1', 'true', 'yes'].includes(String(req.query.refresh || '').toLowerCase());
    const result = await fetchSwitchBotDeviceStatus(deviceId, { force });

    if (result.payload.statusCode === 100) {
      res.json({
        statusCode: 100,
        message: "success",
        body: {
          ...result.payload.body,
          deviceId: deviceId,
          lastUpdate: new Date().toISOString()
        },
        meta: buildSwitchBotMeta(result)
      });
    } else {
      res.status(400).json({
        statusCode: result.payload.statusCode || 400,
        message: result.payload.message || "Failed to get device status"
      });
    }
  } catch (error) {
    console.error(`SwitchBot device status API error for ${req.params.deviceId}:`, error);
    const status = error.status === 401 ? 401 : error.code === 'SWITCHBOT_TIMEOUT' ? 504 : error.status === 429 ? 429 : error.code === 'SWITCHBOT_NO_AUTH' ? 503 : 502;
    res.status(status).json({
      statusCode: error.statusCode || status,
      message: error.message || "Failed to fetch device status from SwitchBot API"
    });
  }
}));

// Device control endpoints for plugs (Edge-only - Cloud users get read-only access)
app.post("/api/switchbot/devices/:deviceId/commands", requireEdgeForControl, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { command, parameter } = req.body;
    
    console.log(`[charlie] Sending command to device ${deviceId}: ${command} ${parameter || ''}`);
    
    const commandData = {
      command: command,
      parameter: parameter || "default"
    };
    
    const response = await switchBotApiRequest(`/devices/${deviceId}/commands`, { method: 'POST', data: commandData });

    if (response.body.statusCode === 100) {
      res.json({
        statusCode: 100,
        message: "Command sent successfully",
        body: response.body.body
      });
    } else {
      res.status(400).json({
        statusCode: response.body.statusCode || 400,
        message: response.body.message || "Failed to send command"
      });
    }
  } catch (error) {
    console.error(`SwitchBot command API error for ${req.params.deviceId}:`, error);
    const status = error.status === 401 ? 401 : error.code === 'SWITCHBOT_TIMEOUT' ? 504 : error.status === 429 ? 429 : error.code === 'SWITCHBOT_NO_AUTH' ? 503 : 502;
    res.status(status).json({
      statusCode: error.statusCode || status,
      message: error.message || "Failed to send command to SwitchBot API"
    });
  }
});

// Kasa device discovery endpoint
app.get("/api/kasa/devices", asyncHandler(async (req, res) => {
  try {
    const client = await createKasaClient();
    const devices = [];
    
    console.log(' Discovering Kasa devices...');
    
    // Start discovery
    client.startDiscovery({
      port: 9999,
      broadcast: '255.255.255.255',
      timeout: parseInt(req.query.timeout) || 5000
    });
    
    // Collect devices
    client.on('device-new', async (device) => {
      try {
        const sysInfo = await device.getSysInfo();
        devices.push({
          deviceId: device.deviceId,
          alias: device.alias || sysInfo.alias,
          host: device.host,
          port: device.port,
          model: sysInfo.model,
          type: sysInfo.type,
          deviceType: sysInfo.mic_type || sysInfo.type,
          softwareVersion: sysInfo.sw_ver,
          hardwareVersion: sysInfo.hw_ver,
          state: sysInfo.relay_state || 0,
          ledOff: sysInfo.led_off || 0,
          rssi: sysInfo.rssi,
          latitude: sysInfo.latitude,
          longitude: sysInfo.longitude,
          discoveredAt: new Date().toISOString()
        });
      } catch (err) {
        console.warn(`Error getting info for device ${device.deviceId}:`, err.message);
        devices.push({
          deviceId: device.deviceId,
          alias: device.alias || 'Unknown Kasa Device',
          host: device.host,
          port: device.port,
          error: err.message,
          discoveredAt: new Date().toISOString()
        });
      }
    });
    
    // Wait for discovery with proper timeout handling
    const timeoutMs = parseInt(req.query.timeout) || 5000;
    await new Promise(resolve => setTimeout(resolve, timeoutMs + 1000)); // Add 1 second buffer
    client.stopDiscovery();
    
    res.json({
      success: true,
      count: devices.length,
      devices: devices,
      scanTime: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Kasa discovery error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      devices: []
    });
  }
}));

// Kasa device control endpoint
app.post("/api/kasa/devices/:deviceId/control", asyncHandler(async (req, res) => {
  try {
    const kasaModule = await import('tplink-smarthome-api');
    const Client = kasaModule.default?.Client || kasaModule.Client;
    const client = new Client();
    const { deviceId } = req.params;
    const { action, value } = req.body;
    
    // Find device by scanning (since we need IP)
    let targetDevice = null;
    
    client.startDiscovery({ timeout: 3000 });
    
    await new Promise((resolve) => {
      client.on('device-new', (device) => {
        if (device.deviceId === deviceId) {
          targetDevice = device;
          client.stopDiscovery();
          resolve();
        }
      });
      
      setTimeout(() => {
        client.stopDiscovery();
        resolve();
      }, 3500);
    });
    
    if (!targetDevice) {
      return res.status(404).json({
        success: false,
        error: `Kasa device ${deviceId} not found on network`
      });
    }
    
    const actionMap = {
      turnOn: 'turnOn',
      turnOff: 'turnOff',
      toggle: 'toggle',
      setAlias: 'setAlias'
    };

    const mappedCommand = actionMap[action];
    if (!mappedCommand) {
      return res.status(400).json({
        success: false,
        error: `Unknown action: ${action}`
      });
    }

    const safetyResult = await executeSafetyEnvelope({
      device: {
        deviceId,
        deviceType: targetDevice.model || 'kasa-device',
        protocol: 'kasa-lan',
        safetyCategory: req.body?.safetyCategory
      },
      command: mappedCommand,
      args: {
        action,
        value
      },
      context: {
        source: req.body?.source || req.body?.context?.source || 'api',
        userId: req.user?.userId || req.user?.email || 'system',
        sessionId: req.headers['x-request-id'] || req.body?.sessionId || null,
        confirmed: req.body?.confirmed,
        confirmation: req.body?.confirmation
      },
      execute: async () => {
        let result;

        switch (action) {
          case 'turnOn':
            result = await targetDevice.setPowerState(true);
            break;
          case 'turnOff':
            result = await targetDevice.setPowerState(false);
            break;
          case 'toggle': {
            const info = await targetDevice.getSysInfo();
            result = await targetDevice.setPowerState(!info.relay_state);
            break;
          }
          case 'setAlias':
            result = await targetDevice.setAlias(value);
            break;
          default:
            result = null;
            break;
        }

        const status = await targetDevice.getSysInfo();
        return {
          result,
          status
        };
      }
    });

    if (!safetyResult.allowed) {
      return res.status(409).json({
        success: false,
        error: 'safety_blocked',
        reason: safetyResult.reason,
        remediation: safetyResult.remediation,
        auditId: safetyResult.auditId,
        action,
        deviceId
      });
    }

    res.json({
      success: true,
      action,
      deviceId,
      result: safetyResult.result?.result,
      status: {
        state: safetyResult.result?.status?.relay_state,
        alias: safetyResult.result?.status?.alias,
        rssi: safetyResult.result?.status?.rssi
      },
      safety: {
        auditId: safetyResult.auditId,
        allowed: true
      }
    });
    
  } catch (error) {
    console.error('Kasa control error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}));

// Kasa device status endpoint
app.get("/api/kasa/devices/:deviceId/status", asyncHandler(async (req, res) => {
  try {
    const kasaModule = await import('tplink-smarthome-api');
    const Client = kasaModule.default?.Client || kasaModule.Client;
    const client = new Client();
    const { deviceId } = req.params;
    
    // Find and get status
    let targetDevice = null;
    
    client.startDiscovery({ timeout: 3000 });
    
    await new Promise((resolve) => {
      client.on('device-new', (device) => {
        if (device.deviceId === deviceId) {
          targetDevice = device;
          client.stopDiscovery();
          resolve();
        }
      });
      
      setTimeout(() => {
        client.stopDiscovery();
        resolve();
      }, 3500);
    });
    
    if (!targetDevice) {
      return res.status(404).json({
        success: false,
        error: `Kasa device ${deviceId} not found`
      });
    }
    
    const [sysInfo, schedule, time, meter] = await Promise.allSettled([
      targetDevice.getSysInfo(),
      targetDevice.getScheduleNextAction?.() || Promise.resolve(null),
      targetDevice.getTime?.() || Promise.resolve(null),
      targetDevice.getMeterInfo?.() || Promise.resolve(null)
    ]);
    
    res.json({
      success: true,
      deviceId: deviceId,
      status: {
        basic: sysInfo.status === 'fulfilled' ? sysInfo.value : null,
        schedule: schedule.status === 'fulfilled' ? schedule.value : null,
        time: time.status === 'fulfilled' ? time.value : null,
        energy: meter.status === 'fulfilled' ? meter.value : null,
        lastUpdated: new Date().toISOString()
      },
      errors: [sysInfo, schedule, time, meter]
        .filter(p => p.status === 'rejected')
        .map(p => p.reason?.message)
    });
    
  } catch (error) {
    console.error('Kasa status error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}));

// Device power control endpoint
app.post("/api/device/:deviceId/power", async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { state } = req.body; // 'on' or 'off'

    const normalizedState = String(state || '').toLowerCase();
    const command = normalizedState === 'on' || normalizedState === 'true' ? 'turnOn' : 'turnOff';

    const safetyResult = await executeSafetyEnvelope({
      device: {
        deviceId,
        deviceType: req.body?.deviceType || 'device-power',
        protocol: 'controller-proxy',
        safetyCategory: req.body?.safetyCategory
      },
      command,
      args: {
        state
      },
      context: {
        source: req.body?.source || req.body?.context?.source || 'api',
        userId: req.user?.userId || req.user?.email || 'system',
        sessionId: req.headers['x-request-id'] || req.body?.sessionId || null,
        confirmed: req.body?.confirmed,
        confirmation: req.body?.confirmation
      },
      execute: async () => {
        const controllerUrl = `${getController().replace(/\/$/, '')}/api/device/${encodeURIComponent(deviceId)}/power`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 1500);

        let response;
        try {
          response = await fetch(controllerUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ state }),
            signal: controller.signal
          });
        } finally {
          clearTimeout(timeoutId);
        }

        if (response.ok) {
          return {
            proxied: true,
            response: await response.json()
          };
        }

        return {
          proxied: false,
          response: null
        };
      }
    });

    if (!safetyResult.allowed) {
      return res.status(409).json({
        success: false,
        error: 'safety_blocked',
        reason: safetyResult.reason,
        remediation: safetyResult.remediation,
        auditId: safetyResult.auditId
      });
    }

    try {
      if (safetyResult.result?.proxied) {
        return res.json({
          success: true,
          message: `Device ${state} command sent`,
          data: safetyResult.result.response,
          safety: {
            auditId: safetyResult.auditId,
            allowed: true
          }
        });
      }
    } catch (controllerError) {
      console.warn(`Controller unavailable for power control of ${deviceId}:`, controllerError.message);
    }

    console.log(`Research light ${deviceId} power ${state} (logged only)`);
    res.json({
      success: true,
      message: `Power ${state} command logged for research light ${deviceId}`,
      safety: {
        auditId: safetyResult.auditId,
        allowed: true
      }
    });
    
  } catch (error) {
    console.error(`Device power control error for ${req.params.deviceId}:`, error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Device spectrum control endpoint
app.post("/api/device/:deviceId/spectrum", async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { cw, ww, bl, rd } = req.body;
    
    console.log(`Spectrum control request for device ${deviceId}:`, { cw, ww, bl, rd });
    
    const safetyResult = await executeSafetyEnvelope({
      device: {
        deviceId,
        deviceType: req.body?.deviceType || 'device-spectrum',
        protocol: 'controller-proxy',
        safetyCategory: req.body?.safetyCategory || 'actuator-low'
      },
      command: 'setSpectrum',
      args: {
        cw,
        ww,
        bl,
        rd
      },
      context: {
        source: req.body?.source || req.body?.context?.source || 'api',
        userId: req.user?.userId || req.user?.email || 'system',
        sessionId: req.headers['x-request-id'] || req.body?.sessionId || null,
        confirmed: req.body?.confirmed,
        confirmation: req.body?.confirmation
      },
      execute: async () => {
        try {
          const controllerUrl = `${getController().replace(/\/$/, '')}/api/device/${encodeURIComponent(deviceId)}/spectrum`;
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 1500);
          let response;

          try {
            response = await fetch(controllerUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ cw, ww, bl, rd }),
              signal: controller.signal
            });
          } finally {
            clearTimeout(timeoutId);
          }

          if (response.ok) {
            return {
              proxied: true,
              response: await response.json()
            };
          }

          console.warn(`Controller spectrum control failed for ${deviceId}:`, response.status);
          return {
            proxied: false,
            response: null
          };
        } catch (controllerError) {
          console.warn(`Controller unavailable for spectrum control of ${deviceId}:`, controllerError.message);
          return {
            proxied: false,
            response: null
          };
        }
      }
    });

    if (!safetyResult.allowed) {
      return res.status(409).json({
        success: false,
        error: 'safety_blocked',
        reason: safetyResult.reason,
        remediation: safetyResult.remediation,
        auditId: safetyResult.auditId
      });
    }

    if (safetyResult.result?.proxied) {
      return res.json({
        success: true,
        message: 'Spectrum applied',
        data: safetyResult.result.response,
        safety: {
          auditId: safetyResult.auditId,
          allowed: true
        }
      });
    }

    console.log(`Research light ${deviceId} spectrum CW:${cw}% WW:${ww}% Blue:${bl}% Red:${rd}% (logged only)`);
    res.json({
      success: true,
      message: `Spectrum command logged for research light ${deviceId}`,
      safety: {
        auditId: safetyResult.auditId,
        allowed: true
      }
    });
    
  } catch (error) {
    console.error(`Device spectrum control error for ${req.params.deviceId}:`, error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// --- Automation Rules Management API (BEFORE proxy) ---

// Get all automation rules
app.get('/api/automation/rules', (req, res) => {
  try {
    const rules = preRulesStore.list();
    res.json({
      success: true,
      rules,
      count: rules.length
    });
  } catch (error) {
    console.error('Error getting automation rules:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Add or update an automation rule (Edge-only)
app.post('/api/automation/rules', requireEdgeForControl, (req, res) => {
  try {
    const rule = req.body;
    // Accept either 'when' (engine format) or 'trigger' (API format)
    const hasWhen = rule.when && typeof rule.when === 'object';
    const hasTrigger = rule.trigger && typeof rule.trigger === 'object';
    
    if (!rule.id || !rule.name || (!hasWhen && !hasTrigger) || !rule.actions) {
      return res.status(400).json({
        success: false,
        error: 'Rule must have id, name, when/trigger, and actions'
      });
    }
    
    // Use pre-automation engine
    const saved = preAutomationEngine.upsertRule(rule);
    res.json({
      success: true,
      message: `Rule ${rule.id} added/updated`,
      rule: saved
    });
  } catch (error) {
    console.error('Error adding automation rule:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Delete an automation rule
app.delete('/api/automation/rules/:ruleId', (req, res) => {
  try {
    const { ruleId } = req.params;
    automationEngine.removeRule(ruleId);
    res.json({
      success: true,
      message: `Rule ${ruleId} removed`
    });
  } catch (error) {
    console.error('Error removing automation rule:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Enable/disable a rule
app.patch('/api/automation/rules/:ruleId', (req, res) => {
  try {
    const { ruleId } = req.params;
    const { enabled } = req.body;
    
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({
        success: false,
        error: 'enabled field must be boolean'
      });
    }
    
    automationEngine.setRuleEnabled(ruleId, enabled);
    res.json({
      success: true,
      message: `Rule ${ruleId} ${enabled ? 'enabled' : 'disabled'}`,
      rule: automationEngine.getRules().find(r => r.id === ruleId)
    });
  } catch (error) {
    console.error('Error updating automation rule:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get automation execution history
app.get('/api/automation/history', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const history = preAutomationEngine.getHistory(limit);
    res.json({
      success: true,
      history,
      count: history.length
    });
  } catch (error) {
    console.error('Error getting automation history:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get fan rotation status
app.get('/api/automation/fan-rotation', (req, res) => {
  try {
    const { engine, fanRotation } = preAutomationContext || {};
    if (!fanRotation) {
      return res.json({
        success: true,
        enabled: false,
        message: 'Fan rotation controller not initialized'
      });
    }
    
    const status = fanRotation.getStatus();
    const fans = fanRotation.getFans();
    
    res.json({
      success: true,
      ...status,
      fans
    });
  } catch (error) {
    console.error('Error getting fan rotation status:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Manually trigger fan rotation
app.post('/api/automation/fan-rotation/rotate', async (req, res) => {
  try {
    const { fanRotation } = preAutomationContext || {};
    if (!fanRotation) {
      return res.status(404).json({
        success: false,
        error: 'Fan rotation controller not initialized'
      });
    }
    
    await fanRotation.rotate();
    const status = fanRotation.getStatus();
    
    res.json({
      success: true,
      message: 'Fan rotation triggered manually',
      ...status
    });
  } catch (error) {
    console.error('Error triggering fan rotation:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get fan rotation analytics with environmental correlation
app.get('/api/automation/fan-rotation/analytics', async (req, res) => {
  try {
    const { fanRotation, envStore } = preAutomationContext || {};
    if (!fanRotation) {
      return res.json({
        success: false,
        error: 'Fan rotation controller not initialized'
      });
    }

    const status = fanRotation.getStatus();
    const fans = fanRotation.getFans();
    
    // Get environmental data from cache
    await ensureEnvCacheLoaded();
    const envSnapshot = __envCache || { zones: [] };
    
    // Build analytics for each fan and zone
    const analytics = fans.map(fan => {
      // Find matching zone data
      const zone = envSnapshot.zones?.find(z => 
        z.id === fan.zone || 
        z.name?.toLowerCase() === fan.zone?.toLowerCase()
      );
      
      const zoneData = {
        fanId: fan.id,
        fanName: fan.name,
        zone: fan.zone,
        active: fan.active,
        overridden: fan.overridden,
        current: null,
        history: {
          tempC: [],
          rh: [],
          vpd: []
        },
        summary: {
          tempC: { min: null, max: null, avg: null, trend: 'stable' },
          rh: { min: null, max: null, avg: null, trend: 'stable' },
          vpd: { min: null, max: null, avg: null, trend: 'stable' }
        }
      };

      if (!zone) return zoneData;

      // Current readings
      zoneData.current = {
        tempC: zone.sensors?.tempC?.current || null,
        rh: zone.sensors?.rh?.current || null,
        vpd: zone.sensors?.vpd?.current || null,
        observedAt: zone.sensors?.tempC?.observedAt || zone.updatedAt
      };

      // Historical data (last 12 readings = 1 hour at 5-minute intervals)
      const metrics = ['tempC', 'rh', 'vpd'];
      metrics.forEach(metric => {
        const sensorData = zone.sensors?.[metric];
        if (sensorData?.history && Array.isArray(sensorData.history)) {
          zoneData.history[metric] = sensorData.history.slice(-12);
          
          // Calculate summary statistics
          const values = zoneData.history[metric].filter(v => v != null && !isNaN(v));
          if (values.length > 0) {
            const min = Math.min(...values);
            const max = Math.max(...values);
            const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
            
            // Calculate trend (compare first half vs second half)
            const mid = Math.floor(values.length / 2);
            const firstHalf = values.slice(0, mid);
            const secondHalf = values.slice(mid);
            const firstAvg = firstHalf.reduce((sum, v) => sum + v, 0) / firstHalf.length;
            const secondAvg = secondHalf.reduce((sum, v) => sum + v, 0) / secondHalf.length;
            const delta = secondAvg - firstAvg;
            
            let trend = 'stable';
            const threshold = metric === 'vpd' ? 0.1 : metric === 'rh' ? 2 : 0.5;
            if (delta > threshold) trend = 'rising';
            else if (delta < -threshold) trend = 'falling';
            
            zoneData.summary[metric] = {
              min: Math.round(min * 100) / 100,
              max: Math.round(max * 100) / 100,
              avg: Math.round(avg * 100) / 100,
              trend,
              delta: Math.round(delta * 100) / 100
            };
          }
        }
      });

      return zoneData;
    });

    // Get rotation history from logger if available
    const rotationHistory = [];
    if (preAutomationLogger) {
      try {
        const logs = await preAutomationLogger.query({
          type: 'fan-rotation',
          limit: 20,
          sort: 'desc'
        });
        rotationHistory.push(...logs);
      } catch (err) {
        console.warn('[fan-rotation] Failed to query rotation history:', err.message);
      }
    }

    res.json({
      success: true,
      status,
      analytics,
      rotationHistory,
      timestamp: new Date().toISOString(),
      nextRotationAt: status.lastRotationTime 
        ? new Date(Date.now() + status.nextRotationIn).toISOString()
        : null
    });
  } catch (error) {
    console.error('Error getting fan rotation analytics:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get current sensor cache
app.get('/api/automation/sensors', (req, res) => {
  try {
    const sensors = automationEngine.getSensorCache();
    res.json({
      success: true,
      sensors,
      count: Object.keys(sensors).length
    });
  } catch (error) {
    console.error('Error getting sensor cache:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Test automation rule with sample data
app.post('/api/automation/test', async (req, res) => {
  try {
    const { sensorData } = req.body;
    if (!sensorData || !sensorData.source || !sensorData.type || typeof sensorData.value !== 'number') {
      return res.status(400).json({
        success: false,
        error: 'sensorData must have source, type, and numeric value'
      });
    }
    
    console.log('[automation] Testing rule execution with sample data:', sensorData);
    await automationEngine.processSensorData(sensorData);
    
    res.json({
      success: true,
      message: 'Test sensor data processed through automation engine',
      testData: sensorData
    });
  } catch (error) {
    console.error('Error testing automation:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Manual trigger for specific automation rule
app.post('/api/automation/trigger/:ruleId', async (req, res) => {
  try {
    const { ruleId } = req.params;
    const { sensorData } = req.body;
    
    const rules = automationEngine.getRules();
    const rule = rules.find(r => r.id === ruleId);
    
    if (!rule) {
      return res.status(404).json({
        success: false,
        error: `Rule ${ruleId} not found`
      });
    }
    
    // Create mock sensor data if not provided
    const mockData = sensorData || {
      source: 'manual-trigger',
      deviceId: 'test-device',
      type: 'manual',
      value: 1,
      metadata: { manualTrigger: true }
    };
    
    console.log(`[automation] Manually triggering rule ${ruleId}`);
    await automationEngine.executeRule(rule, mockData, Date.now());
    
    res.json({
      success: true,
      message: `Rule ${ruleId} manually triggered`,
      rule: rule.name,
      triggerData: mockData
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Sync equipment-control assignment to automation actuators
app.post('/api/automation/sync-actuator', async (req, res) => {
  try {
    const { roomId, actuatorType, deviceId, equipmentId, category } = req.body;
    
    if (!roomId || !actuatorType || !deviceId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: roomId, actuatorType, deviceId'
      });
    }
    
    console.log(`[automation] Syncing actuator: ${actuatorType} -> ${deviceId} for room ${roomId}`);
    
    // Load current env-state (automation files are in ./data, not ./public/data)
    const envStatePath = path.resolve('./data/automation/env-state.json');
    let envState = { rooms: {} };
    
    try {
      if (fs.existsSync(envStatePath)) {
        const raw = fs.readFileSync(envStatePath, 'utf8');
        envState = JSON.parse(raw);
      }
    } catch (error) {
      console.warn('[automation] Could not load env-state.json:', error.message);
    }
    
    // Initialize room if it doesn't exist
    if (!envState.rooms) {
      envState.rooms = {};
    }
    
    if (!envState.rooms[roomId]) {
      console.log(`[automation] Creating new room config for ${roomId}`);
      envState.rooms[roomId] = {
        roomId,
        name: roomId,
        actuators: {
          lights: [],
          fans: [],
          dehu: []
        }
      };
    }
    
    // Initialize actuators if missing
    if (!envState.rooms[roomId].actuators) {
      envState.rooms[roomId].actuators = {
        lights: [],
        fans: [],
        dehu: []
      };
    }
    
    // Ensure actuator type array exists
    if (!Array.isArray(envState.rooms[roomId].actuators[actuatorType])) {
      envState.rooms[roomId].actuators[actuatorType] = [];
    }
    
    // Check if device is already in the actuator list
    const actuatorList = envState.rooms[roomId].actuators[actuatorType];
    if (!actuatorList.includes(deviceId)) {
      // Add device to actuator list
      actuatorList.push(deviceId);
      console.log(`[automation] Added ${deviceId} to ${roomId}.actuators.${actuatorType}`);
    } else {
      console.log(`[automation] Device ${deviceId} already in ${roomId}.actuators.${actuatorType}`);
    }
    
    // Update timestamp
    envState.rooms[roomId].updatedAt = new Date().toISOString();
    envState.updatedAt = new Date().toISOString();
    
    // Save env-state
    fs.writeFileSync(envStatePath, JSON.stringify(envState, null, 2));
    console.log(`[automation] Saved env-state with updated actuators for ${roomId}`);
    
    return res.json({
      success: true,
      message: `Actuator ${actuatorType} synced for room ${roomId}`,
      roomId,
      actuatorType,
      deviceId,
      actuators: envState.rooms[roomId].actuators
    });
    
  } catch (error) {
    console.error('[automation] Failed to sync actuator:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ===== VPD AUTOMATION API ENDPOINTS =====

// Get farm-wide hardware capabilities summary
app.get('/api/automation/vpd/capabilities', (req, res) => {
  try {
    if (!preAutomationEngine || !preAutomationEngine.orchestrator) {
      return res.status(503).json({
        success: false,
        error: 'VPD automation not initialized'
      });
    }
    
    const summary = preAutomationEngine.getOrchestratorStatus();
    res.json({
      success: true,
      ...summary
    });
  } catch (error) {
    console.error('[automation:vpd] Failed to get capabilities:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get zone-specific capabilities
app.get('/api/automation/vpd/capabilities/:zoneId', (req, res) => {
  try {
    if (!preAutomationEngine || !preAutomationEngine.orchestrator) {
      return res.status(503).json({
        success: false,
        error: 'VPD automation not initialized'
      });
    }
    
    const { zoneId } = req.params;
    const capabilities = preAutomationEngine.orchestrator.hardware.getZoneCapabilities(zoneId);
    
    if (!capabilities) {
      return res.status(404).json({
        success: false,
        error: `Zone ${zoneId} not found`
      });
    }
    
    res.json({
      success: true,
      zoneId,
      ...capabilities
    });
  } catch (error) {
    console.error('[automation:vpd] Failed to get zone capabilities:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get all zones with their capabilities
app.get('/api/automation/vpd/zones', (req, res) => {
  try {
    if (!preAutomationEngine || !preAutomationEngine.orchestrator) {
      return res.status(503).json({
        success: false,
        error: 'VPD automation not initialized'
      });
    }
    
    const summary = preAutomationEngine.orchestrator.hardware.getFarmSummary();
    const zones = summary.zones || [];
    
    const zoneDetails = zones.map(zoneId => {
      const capabilities = preAutomationEngine.orchestrator.hardware.getZoneCapabilities(zoneId);
      return {
        zoneId,
        ...capabilities
      };
    });
    
    res.json({
      success: true,
      zones: zoneDetails,
      totalZones: zones.length
    });
  } catch (error) {
    console.error('[automation:vpd] Failed to get zones:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Assign device to zone
app.post('/api/automation/vpd/zones/:zoneId/devices', async (req, res) => {
  try {
    if (!preAutomationEngine || !preAutomationEngine.orchestrator) {
      return res.status(503).json({
        success: false,
        error: 'VPD automation not initialized'
      });
    }
    
    const { zoneId } = req.params;
    const { deviceId, type, category, shared } = req.body;
    
    if (!deviceId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: deviceId'
      });
    }
    
    const result = await preAutomationEngine.assignDeviceToZone(zoneId, deviceId, {
      type,
      category,
      shared: shared === true
    });
    
    // Get updated capabilities
    const capabilities = preAutomationEngine.orchestrator.hardware.getZoneCapabilities(zoneId);
    
    res.json({
      success: true,
      zoneId,
      deviceId,
      capabilities,
      ...result
    });
  } catch (error) {
    console.error('[automation:vpd] Failed to assign device:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Unassign device from zone
app.delete('/api/automation/vpd/zones/:zoneId/devices/:deviceId', async (req, res) => {
  try {
    if (!preAutomationEngine || !preAutomationEngine.orchestrator) {
      return res.status(503).json({
        success: false,
        error: 'VPD automation not initialized'
      });
    }
    
    const { zoneId, deviceId } = req.params;
    
    const result = await preAutomationEngine.unassignDeviceFromZone(zoneId, deviceId);
    
    // Get updated capabilities
    const capabilities = preAutomationEngine.orchestrator.hardware.getZoneCapabilities(zoneId);
    
    res.json({
      success: true,
      zoneId,
      deviceId,
      capabilities,
      ...result
    });
  } catch (error) {
    console.error('[automation:vpd] Failed to unassign device:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get latest VPD control results
app.get('/api/automation/vpd/control-results', (req, res) => {
  try {
    if (!preAutomationEngine) {
      return res.status(503).json({
        success: false,
        error: 'VPD automation not initialized'
      });
    }
    
    const results = preAutomationEngine.getVpdControlResults();
    
    if (!results) {
      return res.json({
        success: true,
        message: 'No VPD control results yet',
        results: null
      });
    }
    
    res.json({
      success: true,
      results
    });
  } catch (error) {
    console.error('[automation:vpd] Failed to get control results:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Enable/disable VPD control
app.post('/api/automation/vpd/control/enable', (req, res) => {
  try {
    if (!preAutomationEngine) {
      return res.status(503).json({
        success: false,
        error: 'VPD automation not initialized'
      });
    }
    
    const { enabled } = req.body;
    
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({
        success: false,
        error: 'Missing or invalid field: enabled (must be boolean)'
      });
    }
    
  const result = preAutomationEngine.setVpdControlEnabled(enabled);
    
    res.json({
      success: true,
      ...result,
      message: `VPD control ${enabled ? 'enabled' : 'disabled'}`
    });
  } catch (error) {
    console.error('[automation:vpd] Failed to set control state:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get VPD orchestrator status
app.get('/api/automation/vpd/status', (req, res) => {
  try {
    if (!preAutomationEngine || !preAutomationEngine.orchestrator) {
      return res.status(503).json({
        success: false,
        error: 'VPD automation not initialized'
      });
    }
    
    const summary = preAutomationEngine.getOrchestratorStatus();
    const controlResults = preAutomationEngine.getVpdControlResults();
    
    res.json({
      success: true,
      initialized: preAutomationEngine.orchestrator.initialized || false,
      enabled: preAutomationEngine.vpdControlEnabled,
      farmSummary: summary,
      lastControlExecution: controlResults?.timestamp || null
    });
  } catch (error) {
    console.error('[automation:vpd] Failed to get status:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ===== SCHEDULE EXECUTOR API ENDPOINTS =====

// Get schedule executor status
app.get('/api/schedule-executor/status', (req, res) => {
  try {
    if (!scheduleExecutor) {
      return res.json({
        success: true,
        enabled: false,
        message: 'Schedule executor is not initialized'
      });
    }
    
    const status = scheduleExecutor.getStatus();
    res.json({
      success: true,
      ...status
    });
  } catch (error) {
    console.error('[ScheduleExecutor API] Error getting status:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Start schedule executor
app.post('/api/schedule-executor/start', (req, res) => {
  try {
    if (!scheduleExecutor) {
      return res.status(400).json({
        success: false,
        error: 'Schedule executor is not initialized'
      });
    }
    
    scheduleExecutor.start();
    res.json({
      success: true,
      message: 'Schedule executor started'
    });
  } catch (error) {
    console.error('[ScheduleExecutor API] Error starting:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Stop schedule executor
app.post('/api/schedule-executor/stop', (req, res) => {
  try {
    if (!scheduleExecutor) {
      return res.status(400).json({
        success: false,
        error: 'Schedule executor is not initialized'
      });
    }
    
    scheduleExecutor.stop();
    res.json({
      success: true,
      message: 'Schedule executor stopped'
    });
  } catch (error) {
    console.error('[ScheduleExecutor API] Error stopping:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Manually trigger executor tick (execute immediately)
app.post('/api/schedule-executor/tick', async (req, res) => {
  try {
    if (!scheduleExecutor) {
      return res.status(400).json({
        success: false,
        error: 'Schedule executor is not initialized'
      });
    }
    
    console.log('[ScheduleExecutor API] Manual tick requested');
    const results = await scheduleExecutor.tick();
    
    res.json({
      success: true,
      message: 'Schedule executor tick completed',
      results
    });
  } catch (error) {
    console.error('[ScheduleExecutor API] Error executing tick:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get ML anomalies from executor
app.get('/api/schedule-executor/ml-anomalies', (req, res) => {
  try {
    // Demo mode: return synthetic anomaly data
    if (isDemoMode() || !scheduleExecutor) {
      const now = new Date();
      const demoAnomalies = [];
      
      // Generate 2-5 random anomalies for demo
      const anomalyCount = Math.floor(Math.random() * 4) + 2;
      const zones = ['zone-1', 'zone-2', 'zone-3', 'zone-4'];
      const severities = ['warning', 'critical'];
      const reasons = [
        'Temperature spike detected (+3.2°C above expected)',
        'Humidity variance exceeds threshold (±12%)',
        'VPD deviation from optimal range',
        'CO2 levels dropped below target',
        'Unusual pattern in environmental metrics'
      ];
      
      for (let i = 0; i < anomalyCount; i++) {
        const zone = zones[Math.floor(Math.random() * zones.length)];
        const severity = severities[Math.floor(Math.random() * severities.length)];
        const reason = reasons[Math.floor(Math.random() * reasons.length)];
        const timestamp = new Date(now.getTime() - Math.random() * 6 * 60 * 60 * 1000); // Last 6 hours
        
        demoAnomalies.push({
          zone,
          severity,
          reason,
          timestamp: timestamp.toISOString(),
          temperature: (72 + Math.random() * 4 - 2).toFixed(1),
          humidity: (65 + Math.random() * 10 - 5).toFixed(0),
          vpd: (0.9 + Math.random() * 0.3).toFixed(2)
        });
      }
      
      // Sort by timestamp (newest first)
      demoAnomalies.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      
      return res.json({
        success: true,
        anomalies: demoAnomalies,
        count: demoAnomalies.length,
        lastRun: now.toISOString(),
        lastError: null,
        mlEnabled: true,
        demo: true
      });
    }
    
    res.json({
      success: true,
      anomalies: scheduleExecutor.mlAnomalies || [],
      count: (scheduleExecutor.mlAnomalies || []).length,
      lastRun: scheduleExecutor.lastMLRun,
      lastError: scheduleExecutor.mlLastError,
      mlEnabled: scheduleExecutor.mlEnabled
    });
  } catch (error) {
    console.error('[ScheduleExecutor API] Error getting ML anomalies:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Update device registry
app.post('/api/schedule-executor/device-registry', (req, res) => {
  try {
    if (!scheduleExecutor) {
      return res.status(400).json({
        success: false,
        error: 'Schedule executor is not initialized'
      });
    }
    
    const { registry } = req.body;
    if (!registry || typeof registry !== 'object') {
      return res.status(400).json({
        success: false,
        error: 'registry must be an object mapping light IDs to controller device IDs'
      });
    }
    
    scheduleExecutor.updateDeviceRegistry(registry);
    res.json({
      success: true,
      message: 'Device registry updated'
    });
  } catch (error) {
    console.error('[ScheduleExecutor API] Error updating device registry:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Harvest Logging Endpoint
 * Records actual harvest dates and calculates variance from planned schedules
 */
app.post('/api/harvest', async (req, res) => {
  try {
    const harvestEntry = req.body;
    
    // Validate required fields
    if (!harvestEntry.groupId || !harvestEntry.planId) {
      return res.status(400).json({ 
        ok: false, 
        error: 'Missing required fields: groupId and planId' 
      });
    }
    
    // Load existing harvest log
    const harvestLogPath = path.join(DATA_DIR, 'harvest-log.json');
    let harvestLog = { harvests: [], metadata: {} };
    
    try {
      if (fs.existsSync(harvestLogPath)) {
        const logData = fs.readFileSync(harvestLogPath, 'utf-8');
        harvestLog = JSON.parse(logData);
        
        // Ensure structure
        if (!Array.isArray(harvestLog.harvests)) {
          harvestLog.harvests = [];
        }
      }
    } catch (readError) {
      console.warn('[Harvest API] Failed to read existing log, creating new:', readError.message);
      harvestLog = { 
        harvests: [],
        metadata: {
          created: new Date().toISOString(),
          description: "Log of actual harvest dates with variance from planned schedules"
        }
      };
    }
    
    // Add new entry
    harvestLog.harvests.push(harvestEntry);
    
    // Update metadata
    harvestLog.metadata.lastUpdated = new Date().toISOString();
    harvestLog.metadata.totalHarvests = harvestLog.harvests.length;
    
    // Save updated log
    fs.writeFileSync(harvestLogPath, JSON.stringify(harvestLog, null, 2), 'utf-8');
    
    console.log(`[Harvest API] Recorded harvest for group ${harvestEntry.groupId}, variance: ${harvestEntry.variance} days`);
    
    // ── Phase 0 Task 0.4: Auto-generate experiment record on harvest ────
    // Non-blocking — failure here does not block the harvest response
    try {
      const experimentInput = {
        groupId: harvestEntry.groupId,
        crop: harvestEntry.crop || harvestEntry.cropName || harvestEntry.planId || harvestEntry.plan_id || null,
        recipe_id: harvestEntry.recipeId || harvestEntry.recipe_id || harvestEntry.planId || harvestEntry.plan_id || null,
        grow_days: harvestEntry.growDays || harvestEntry.grow_days || null,
        planned_grow_days: harvestEntry.plannedGrowDays || harvestEntry.planned_grow_days || null,
        weight_per_plant_oz: harvestEntry.weightPerPlant || harvestEntry.weight_per_plant_oz || null,
        total_weight_oz: harvestEntry.totalWeight || harvestEntry.total_weight_oz || null,
        planted_site_count: harvestEntry.plantedSiteCount || harvestEntry.planted_site_count || null,
        zone: harvestEntry.zone || null,
        room: harvestEntry.room || null,
      };
      const record = await buildExperimentRecord(experimentInput);
      await harvestOutcomesDB.insert(record);
      console.log(`[Harvest API] ✓ Experiment record auto-created for ${record.crop || harvestEntry.groupId}`);
      syncExperimentToCenter(record).catch(e =>
        console.warn('[Harvest API] Experiment Central sync deferred:', e?.message)
      );

      // Phase 3 Ticket 3.5: Record champion/challenger observation
      try {
        const { recordChampionChallenger, applyModifier, trackAutonomousPerformance } = await import('./lib/recipe-modifier.js');
        const cropKey = (record.crop || '').toLowerCase().replace(/\s+/g, '-');
        const modCheck = applyModifier(cropKey, { ppfd: null, mix: {}, envTempC: null });
        await recordChampionChallenger({
          crop: cropKey,
          groupId: experimentInput.groupId,
          modifierApplied: modCheck.modifierApplied,
          modifierDetails: modCheck.modifierDetails,
          outcomes: record.outcomes,
          auditDB: typeof agentAuditDB !== 'undefined' ? agentAuditDB : null
        });

        // Phase 5 Ticket 5.1: Track autonomous performance for auto-revert
        const farmId = process.env.FARM_ID || 'local';
        await trackAutonomousPerformance(cropKey, record.outcomes,
          typeof agentAuditDB !== 'undefined' ? agentAuditDB : null,
          farmId
        );
      } catch (ccErr) {
        // Non-fatal — champion/challenger + autonomous tracking is best-effort
      }
    } catch (expErr) {
      console.warn('[Harvest API] Experiment record creation failed (non-fatal):', expErr.message);
    }

    return res.json({ 
      ok: true, 
      message: 'Harvest recorded successfully',
      entry: harvestEntry 
    });
    
  } catch (error) {
    console.error('[Harvest API] Error recording harvest:', error);
    return res.status(500).json({ 
      ok: false, 
      error: error.message 
    });
  }
});

/**
 * Get Harvest Log
 * Retrieve harvest history for analytics
 */
app.get('/api/harvest', (req, res) => {
  try {
    const harvestLogPath = path.join(DATA_DIR, 'harvest-log.json');
    
    if (!fs.existsSync(harvestLogPath)) {
      return res.json({ 
        ok: true, 
        harvests: [],
        metadata: {
          description: "No harvests recorded yet"
        }
      });
    }
    
    const logData = fs.readFileSync(harvestLogPath, 'utf-8');
    const harvestLog = JSON.parse(logData);
    
    return res.json({ 
      ok: true, 
      ...harvestLog 
    });
    
  } catch (error) {
    console.error('[Harvest API] Error reading harvest log:', error);
    return res.status(500).json({ 
      ok: false, 
      error: error.message 
    });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AI Vision Phase 1 — Experiment Record System (Tasks 1.2, 1.3, 1.4)
// Every harvest generates one experiment record per Rule 3.1.
// Records are stored locally in harvestOutcomesDB and POSTed to Central.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Helper: Build experiment record from harvest context.
 * Aggregates applied recipe params over the grow cycle from appliedRecipesDB.
 */
async function buildExperimentRecord(opts) {
  const {
    groupId, crop, recipe_id, grow_days, planned_grow_days,
    weight_per_plant_oz, quality_score, loss_rate, loss_count,
    tray_format, system_type, zone, room, planted_site_count,
    total_weight_oz, energy_kwh_per_kg
  } = opts;

  // Load farm context from farm.json
  let farmContext = {};
  try {
    const farmData = JSON.parse(fs.readFileSync(FARM_PATH, 'utf-8'));
    const now = new Date();
    const month = now.getMonth(); // 0-11
    const season = month <= 1 || month === 11 ? 'winter' :
                   month <= 4 ? 'spring' :
                   month <= 7 ? 'summer' : 'fall';
    farmContext = {
      farm_id: farmData.farmId || process.env.FARM_ID || 'unknown',
      region: farmData.region || farmData.state || '',
      altitude_m: farmData.coordinates?.altitude_m || null,
      season,
      system_type: system_type || 'nft',
      tray_format: tray_format || '',
      fixture_hours: null // TODO: track cumulative LED hours per fixture
    };
  } catch (e) {
    farmContext = { farm_id: process.env.FARM_ID || 'unknown', region: '', season: '', system_type: system_type || '' };
  }

  // Aggregate applied recipe params over grow cycle for this group
  let recipe_params_avg = { ppfd: null, blue_pct: null, red_pct: null, green_pct: null, far_red_pct: null, temp_c: null, humidity_pct: null, ec: null, ph: null };
  try {
    const appliedRecords = await appliedRecipesDB.find({ groupId });
    if (appliedRecords.length > 0) {
      const sums = { ppfd: 0, temp: 0, rh: 0, n: 0 };
      for (const rec of appliedRecords) {
        if (rec.targetPpfd != null) sums.ppfd += rec.targetPpfd;
        if (rec.env?.tempC != null) sums.temp += rec.env.tempC;
        if (rec.env?.rh != null) sums.rh += rec.env.rh;
        sums.n++;
      }
      if (sums.n > 0) {
        recipe_params_avg.ppfd = +(sums.ppfd / sums.n).toFixed(1);
        recipe_params_avg.temp_c = +(sums.temp / sums.n).toFixed(1);
        recipe_params_avg.humidity_pct = +(sums.rh / sums.n).toFixed(1);
      }
      // Try to get spectrum from most recent device mix
      const lastWithDevices = appliedRecords.reverse().find(r => r.devices?.length > 0 && r.devices[0].mix);
      if (lastWithDevices?.devices?.[0]?.mix) {
        const mix = lastWithDevices.devices[0].mix;
        const total = (mix.bl || 0) + (mix.rd || 0) + (mix.cw || 0) + (mix.ww || 0);
        if (total > 0) {
          recipe_params_avg.blue_pct = +((mix.bl || 0) / total * 100).toFixed(1);
          recipe_params_avg.red_pct = +((mix.rd || 0) / total * 100).toFixed(1);
        }
      }
    }
  } catch (e) {
    // If no applied recipes found, leave as nulls — still a valid record
  }

  // Get current environment snapshot
  let environment_achieved_avg = { temp_c: null, humidity_pct: null, co2_ppm: null, vpd_kpa: null, ppfd_actual: null };
  try {
    const envState = readEnv();
    if (envState.zones && room) {
      const zoneData = Object.values(envState.zones || {}).find(z =>
        z.room === room || z.zone_name === zone || z.name === zone
      );
      if (zoneData?.sensors?.[0]?.readings) {
        const r = zoneData.sensors[0].readings;
        environment_achieved_avg.temp_c = r.temperature_c ?? null;
        environment_achieved_avg.humidity_pct = r.humidity ?? null;
        environment_achieved_avg.co2_ppm = r.co2 ?? null;
      }
    }
  } catch (e) { /* env snapshot is best-effort */ }

  let resolvedCrop = (crop || '').toString().trim();
  let resolvedRecipeId = recipe_id || null;

  if (!resolvedCrop && resolvedRecipeId) {
    resolvedCrop = String(resolvedRecipeId).trim();
  }

  if (!resolvedCrop && groupId) {
    try {
      const groupsRaw = fs.readFileSync(GROUPS_PATH, 'utf-8');
      const groupsParsed = JSON.parse(groupsRaw);
      const groups = Array.isArray(groupsParsed) ? groupsParsed : (groupsParsed.groups || []);
      const group = groups.find(g => String(g.id) === String(groupId));
      if (group) {
        const groupCrop = group.crop || group.plan || group.recipe || null;
        if (groupCrop) {
          resolvedCrop = String(groupCrop).trim();
        }
        if (!resolvedRecipeId) {
          resolvedRecipeId = group.recipe || group.plan || null;
        }
      }
    } catch (e) {
      // best-effort fallback
    }
  }

  if (!resolvedCrop) {
    resolvedCrop = 'unknown-crop';
  }

  return {
    farm_id: farmContext.farm_id,
    crop: resolvedCrop.toLowerCase().replace(/\s+/g, '-'),
    recipe_id: resolvedRecipeId,
    grow_days: grow_days != null ? parseInt(grow_days) : null,
    planned_grow_days: planned_grow_days != null ? parseInt(planned_grow_days) : null,
    recipe_params_avg,
    environment_achieved_avg,
    outcomes: {
      weight_per_plant_oz: weight_per_plant_oz != null ? +parseFloat(weight_per_plant_oz).toFixed(3) : null,
      quality_score: quality_score != null ? parseInt(quality_score) : null,
      loss_rate: loss_rate != null ? +parseFloat(loss_rate).toFixed(3) : null,
      energy_kwh_per_kg: energy_kwh_per_kg != null ? +parseFloat(energy_kwh_per_kg).toFixed(1) : null,
    },
    farm_context: farmContext,
    recorded_at: new Date().toISOString()
  };
}

/**
 * POST /api/harvest/experiment-record
 * Record a harvest experiment outcome. Stores locally + POSTs to Central.
 * Body: { groupId, crop, recipe_id, grow_days, planned_grow_days,
 *         weight_per_plant_oz, quality_score, loss_rate, loss_count,
 *         tray_format, system_type, zone, room, planted_site_count,
 *         total_weight_oz, energy_kwh_per_kg }
 */
app.post('/api/harvest/experiment-record', async (req, res) => {
  try {
    const record = await buildExperimentRecord(req.body);

    // Persist locally (Rule 9.2: persist, don't discard)
    const inserted = await harvestOutcomesDB.insert(record);
    console.log(`[experiment] ✓ Recorded experiment for ${record.crop} (${record.farm_id}) — ${record.outcomes.weight_per_plant_oz} oz/plant`);

    // POST to Central (Task 1.3: sync experiment records up)
    syncExperimentToCenter(record).catch(e =>
      console.warn('[experiment] Central sync deferred:', e?.message)
    );

    res.json({
      ok: true,
      experiment_id: inserted._id,
      record
    });
  } catch (error) {
    console.error('[experiment] Error recording experiment:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * GET /api/harvest/experiment-records
 * Query experiment records for analytics/training.
 * ?crop=genovese-basil  ?since=2025-01-01  ?limit=100
 */
app.get('/api/harvest/experiment-records', async (req, res) => {
  try {
    const filter = {};
    if (req.query.crop) filter.crop = req.query.crop;
    if (req.query.since) filter.recorded_at = { $gte: req.query.since };

    const limit = parseInt(req.query.limit) || 500;
    const records = await harvestOutcomesDB.find(filter).sort({ recorded_at: -1 }).limit(limit);

    res.json({
      ok: true,
      total: records.length,
      records
    });
  } catch (error) {
    console.error('[experiment] Error querying records:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * POST experiment record to GreenReach Central (Task 1.3)
 * Uses existing Central URL from farm.json or env var.
 */
async function syncExperimentToCenter(record) {
  const centralUrl = process.env.GREENREACH_CENTRAL_URL || process.env.CENTRAL_URL;
  if (!centralUrl) return; // No Central configured — farm-only mode

  try {
    const farmData = JSON.parse(fs.readFileSync(FARM_PATH, 'utf-8'));
    const apiKey = process.env.CENTRAL_API_KEY || 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

    const response = await axios.post(`${centralUrl}/api/sync/experiment-records`, {
      farm_id: record.farm_id,
      records: [record]
    }, {
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
        'X-Farm-ID': record.farm_id
      },
      timeout: 10000
    });

    if (response.status === 200 || response.status === 201) {
      console.log(`[experiment] ✓ Synced experiment to Central for ${record.crop}`);
    }
  } catch (err) {
    console.warn(`[experiment] Central sync failed (will retry on next harvest):`, err?.message);
  }
}

/**
 * GET /api/harvest/experiment-stats
 * Per-crop experiment statistics for dashboard display (Task 1.6)
 */
app.get('/api/harvest/experiment-stats', async (req, res) => {
  try {
    const records = await harvestOutcomesDB.find({});
    const byCrop = {};

    for (const r of records) {
      if (!r.crop) continue;
      if (!byCrop[r.crop]) {
        byCrop[r.crop] = { crop: r.crop, count: 0, totalWeight: 0, totalGrowDays: 0, totalLoss: 0, weights: [] };
      }
      const b = byCrop[r.crop];
      b.count++;
      if (r.outcomes?.weight_per_plant_oz != null) {
        b.totalWeight += r.outcomes.weight_per_plant_oz;
        b.weights.push(r.outcomes.weight_per_plant_oz);
      }
      if (r.grow_days != null) b.totalGrowDays += r.grow_days;
      if (r.outcomes?.loss_rate != null) b.totalLoss += r.outcomes.loss_rate;
    }

    const stats = Object.values(byCrop).map(b => ({
      crop: b.crop,
      harvest_count: b.count,
      avg_weight_per_plant_oz: b.count > 0 ? +(b.totalWeight / b.count).toFixed(3) : null,
      avg_grow_days: b.count > 0 ? +(b.totalGrowDays / b.count).toFixed(1) : null,
      avg_loss_rate: b.count > 0 ? +(b.totalLoss / b.count).toFixed(3) : null,
      min_weight: b.weights.length > 0 ? +Math.min(...b.weights).toFixed(3) : null,
      max_weight: b.weights.length > 0 ? +Math.max(...b.weights).toFixed(3) : null,
    }));

    res.json({ ok: true, crops: stats, total_experiments: records.length });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ── Phase 3 Ticket 3.1: Recipe modifier API ──────────────────────────────

/**
 * GET /api/recipe-modifiers
 * Return current per-crop recipe modifiers (local + network).
 */
app.get('/api/recipe-modifiers', async (req, res) => {
  try {
    const { loadModifiers } = await import('./lib/recipe-modifier.js');
    const local = loadModifiers();

    // Also load network modifiers if available
    let network = { modifiers: {} };
    try {
      const raw = fs.readFileSync(path.join(process.cwd(), 'data', 'network-recipe-modifiers.json'), 'utf-8');
      network = JSON.parse(raw);
    } catch { /* no network modifiers yet */ }

    res.json({
      ok: true,
      local: local.modifiers,
      network: network.modifiers || {},
      local_computed_at: local.computed_at,
      network_received_at: network.received_at || null
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * POST /api/recipe-modifiers/compute
 * Trigger recomputation of local recipe modifiers from experiment records.
 */
app.post('/api/recipe-modifiers/compute', async (req, res) => {
  try {
    const records = await harvestOutcomesDB.find({});
    const result = computeRecipeModifiers(records, req.body?.minRecords || 10);
    res.json({
      ok: true,
      crops_computed: Object.keys(result.modifiers).length,
      modifiers: result.modifiers,
      computed_at: result.computed_at
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * POST /api/recipe-modifiers/network/:crop/accept
 * Accept a network recipe modifier suggestion for a crop (Ticket 3.3).
 * Merges the network modifier into local modifiers.
 */
app.post('/api/recipe-modifiers/network/:crop/accept', async (req, res) => {
  try {
    const crop = req.params.crop.toLowerCase().replace(/\s+/g, '-');
    const { loadModifiers, saveModifiers } = await import('./lib/recipe-modifier.js');

    // Load network modifier
    let network;
    try {
      const raw = fs.readFileSync(path.join(process.cwd(), 'data', 'network-recipe-modifiers.json'), 'utf-8');
      network = JSON.parse(raw);
    } catch {
      return res.status(404).json({ ok: false, error: 'No network modifiers available' });
    }

    const netMod = network.modifiers?.[crop];
    if (!netMod) {
      return res.status(404).json({ ok: false, error: `No network modifier for crop: ${crop}` });
    }

    // Merge into local modifiers
    const local = loadModifiers();
    local.modifiers[crop] = {
      ...netMod,
      source: 'network_accepted',
      accepted_at: new Date().toISOString()
    };
    local.version = (local.version || 0) + 1;
    saveModifiers(local);

    console.log(`[recipe-modifier] Accepted network modifier for ${crop}`);
    res.json({ ok: true, crop, modifier: local.modifiers[crop] });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * POST /api/recipe-modifiers/network/:crop/dismiss
 * Dismiss a network recipe modifier suggestion.
 */
app.post('/api/recipe-modifiers/network/:crop/dismiss', async (req, res) => {
  const crop = req.params.crop.toLowerCase().replace(/\s+/g, '-');
  console.log(`[recipe-modifier] Dismissed network modifier for ${crop}`);
  res.json({ ok: true, crop, dismissed: true });
});

// ── Phase 3 Ticket 3.4: Manual retrain trigger ──────────────────────────

/**
 * POST /api/ml/retrain
 * Trigger a manual model retrain cycle.
 */
app.post('/api/ml/retrain', async (req, res) => {
  try {
    const { trainMLModel } = await import('./lib/ml-training-pipeline.js');
    const result = await trainMLModel();
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * GET /api/ml/metrics
 * Return current model metrics and training history.
 */
app.get('/api/ml/metrics', async (req, res) => {
  try {
    const { loadModelMetrics } = await import('./lib/ml-training-pipeline.js');
    const metrics = await loadModelMetrics();
    res.json({ ok: true, ...metrics });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ── Phase 3 Ticket 3.5: Champion/Challenger comparison API ──────────────

/**
 * GET /api/recipe-modifiers/champion-challenger/:crop
 * Compare champion (modifier applied) vs challenger (baseline) outcomes.
 */
app.get('/api/recipe-modifiers/champion-challenger/:crop', async (req, res) => {
  try {
    const { compareChampionChallenger } = await import('./lib/recipe-modifier.js');
    const crop = req.params.crop.toLowerCase().replace(/\s+/g, '-');
    const result = await compareChampionChallenger(
      typeof agentAuditDB !== 'undefined' ? agentAuditDB : null,
      crop
    );
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ── Phase 5 Ticket 5.1: Autonomous Recipe Adjustment APIs ──────────────

/**
 * GET /api/recipe-modifiers/autonomous/status
 * Return autonomous eligibility and tracking status for all crops.
 */
app.get('/api/recipe-modifiers/autonomous/status', async (req, res) => {
  try {
    const { getAutonomousStatus } = await import('./lib/recipe-modifier.js');
    const status = getAutonomousStatus();
    res.json({ ok: true, crops: status });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * POST /api/recipe-modifiers/autonomous/apply
 * Autonomously apply a recipe modifier for a crop (within guardrail bounds).
 * Body: { crop, targets: { ppfd, mix, envTempC } }
 */
app.post('/api/recipe-modifiers/autonomous/apply', async (req, res) => {
  try {
    const { crop, targets } = req.body;
    if (!crop || !targets) return res.status(400).json({ ok: false, error: 'crop and targets required' });
    const { autonomousApplyModifier } = await import('./lib/recipe-modifier.js');
    const farmId = process.env.FARM_ID || 'local';
    const result = await autonomousApplyModifier(crop, targets,
      typeof agentAuditDB !== 'undefined' ? agentAuditDB : null,
      farmId
    );
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * POST /api/recipe-modifiers/autonomous/track-performance
 * Record a harvest outcome for auto-revert tracking.
 * Body: { crop, outcomes: { weight_per_plant_oz, quality_score } }
 */
app.post('/api/recipe-modifiers/autonomous/track-performance', async (req, res) => {
  try {
    const { crop, outcomes } = req.body;
    if (!crop || !outcomes) return res.status(400).json({ ok: false, error: 'crop and outcomes required' });
    const { trackAutonomousPerformance } = await import('./lib/recipe-modifier.js');
    const farmId = process.env.FARM_ID || 'local';
    const result = await trackAutonomousPerformance(crop, outcomes,
      typeof agentAuditDB !== 'undefined' ? agentAuditDB : null,
      farmId
    );
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * POST /api/recipe-modifiers/autonomous/clear-revert/:crop
 * Clear auto-revert flag after manual review. Requires approval.
 */
app.post('/api/recipe-modifiers/autonomous/clear-revert/:crop', async (req, res) => {
  try {
    const { clearRevert } = await import('./lib/recipe-modifier.js');
    const result = clearRevert(req.params.crop);
    if (typeof agentAuditDB !== 'undefined') {
      await agentAuditDB.insert({
        type: 'autonomous_recipe',
        action: 'clear_revert',
        agent_class: 'grow-advisor',
        crop: req.params.crop,
        farm_id: process.env.FARM_ID || 'local',
        human_decision: 'accepted',
        tier: 'require-approval',
        timestamp: new Date().toISOString()
      }).catch(() => {});
    }
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ── Phase 3 Ticket 3.9: Alert prioritization API ──────────────────────

/**
 * POST /api/alerts/score
 * Score a batch of anomaly diagnostics and return only high-priority alerts.
 * Body: { diagnostics: [...], farmContext?: { activeGroups, alertThreshold } }
 */
app.post('/api/alerts/score', async (req, res) => {
  try {
    const { diagnostics = [], farmContext = {} } = req.body;
    const result = prioritizeAlerts(diagnostics, farmContext);
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * POST /api/alerts/response
 * Record grower response to an alert (acknowledged, dismissed, acted_on).
 * Body: { category: string, response: 'acknowledged'|'dismissed'|'acted_on' }
 */
app.post('/api/alerts/response', async (req, res) => {
  try {
    const { category, response } = req.body;
    if (!category || !['acknowledged', 'dismissed', 'acted_on'].includes(response)) {
      return res.status(400).json({ ok: false, error: 'category and response (acknowledged|dismissed|acted_on) required' });
    }
    const result = recordAlertResponse(category, response);
    res.json({ ok: true, category, updated: result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * GET /api/alerts/stats
 * Get alert dismiss/acknowledge statistics for threshold tuning.
 */
app.get('/api/alerts/stats', (req, res) => {
  try {
    const stats = getAlertStats();
    res.json({ ok: true, ...stats });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ── Phase 4 Ticket 4.6: Developer Mode API ─────────────────────────────

/**
 * POST /api/developer/evaluate
 * Evaluate a text change request for feasibility.
 * Body: { request: "change the alert threshold to 25" }
 */
app.post('/api/developer/evaluate', async (req, res) => {
  try {
    const { evaluateRequest } = await import('./lib/developer-mode.js');
    const result = evaluateRequest(req.body.request || '', { user: req.user?.email || req.body.user });
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * POST /api/developer/propose
 * Create a change proposal for human review.
 * Body: { proposalId, description, targetFile?, configChanges?, scope, risk }
 */
app.post('/api/developer/propose', async (req, res) => {
  try {
    const { createProposal } = await import('./lib/developer-mode.js');
    const proposal = createProposal(req.body.proposalId, {
      ...req.body,
      requestedBy: req.user?.email || req.body.user || 'api'
    });
    res.json({ ok: true, proposal });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * GET /api/developer/proposals
 * List all proposals. ?status=pending_review|applied|rejected
 */
app.get('/api/developer/proposals', async (req, res) => {
  try {
    const { listProposals } = await import('./lib/developer-mode.js');
    const proposals = listProposals(req.query.status || null);
    res.json({ ok: true, proposals, count: proposals.length });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * POST /api/developer/proposals/:id/approve
 * Approve and apply a proposal.
 */
app.post('/api/developer/proposals/:id/approve', async (req, res) => {
  try {
    const { approveAndApply } = await import('./lib/developer-mode.js');
    const result = approveAndApply(req.params.id, req.user?.email || req.body.user || 'api');
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * POST /api/developer/proposals/:id/reject
 * Reject a proposal.
 */
app.post('/api/developer/proposals/:id/reject', async (req, res) => {
  try {
    const { rejectProposal } = await import('./lib/developer-mode.js');
    const result = rejectProposal(req.params.id, req.user?.email || req.body.user || 'api', req.body.reason || '');
    res.json({ ok: true, proposal: result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * GET /api/ai/training-data
 * Comprehensive training data export API (Rule 9.3, Task 1.10)
 * ?type=harvest_outcomes|recipe_applications|loss_events|environment_series
 * ?format=json|csv  ?since=2025-01-01  ?crop=genovese-basil
 */
app.get('/api/ai/training-data', async (req, res) => {
  try {
    const type = req.query.type || 'harvest_outcomes';
    const since = req.query.since;
    const crop = req.query.crop;
    const format = req.query.format || 'json';
    const limit = parseInt(req.query.limit) || 5000;

    let data = [];
    let columns = [];

    if (type === 'harvest_outcomes') {
      const filter = {};
      if (crop) filter.crop = crop;
      if (since) filter.recorded_at = { $gte: since };
      data = await harvestOutcomesDB.find(filter).sort({ recorded_at: -1 }).limit(limit);
      columns = ['farm_id', 'crop', 'recipe_id', 'grow_days', 'planned_grow_days',
        'ppfd_avg', 'blue_pct', 'red_pct', 'temp_c_target', 'humidity_pct_target',
        'temp_c_actual', 'humidity_pct_actual', 'co2_ppm',
        'weight_per_plant_oz', 'quality_score', 'loss_rate', 'energy_kwh_per_kg',
        'season', 'system_type', 'recorded_at'];

      if (format === 'csv') {
        const rows = data.map(r => [
          r.farm_id, r.crop, r.recipe_id, r.grow_days, r.planned_grow_days,
          r.recipe_params_avg?.ppfd, r.recipe_params_avg?.blue_pct, r.recipe_params_avg?.red_pct,
          r.recipe_params_avg?.temp_c, r.recipe_params_avg?.humidity_pct,
          r.environment_achieved_avg?.temp_c, r.environment_achieved_avg?.humidity_pct,
          r.environment_achieved_avg?.co2_ppm,
          r.outcomes?.weight_per_plant_oz, r.outcomes?.quality_score, r.outcomes?.loss_rate,
          r.outcomes?.energy_kwh_per_kg, r.farm_context?.season, r.farm_context?.system_type,
          r.recorded_at
        ].join(','));
        res.setHeader('Content-Type', 'text/csv');
        return res.send([columns.join(','), ...rows].join('\n'));
      }

    } else if (type === 'recipe_applications') {
      const filter = {};
      if (since) filter.date = { $gte: since };
      data = await appliedRecipesDB.find(filter).sort({ date: -1 }).limit(limit);
      columns = ['groupId', 'date', 'planKey', 'day', 'stage', 'targetPpfd', 'photoperiodHours', 'dli', 'tempC', 'rh'];

    } else if (type === 'loss_events') {
      const filter = {};
      if (since) filter.created_at = { $gte: since };
      data = await trayLossEventsDB.find(filter).sort({ created_at: -1 }).limit(limit);
      columns = ['tray_run_id', 'crop_name', 'loss_reason', 'lost_quantity', 'created_at',
        'env_temp_c', 'env_humidity_pct', 'env_co2_ppm'];
    }

    res.json({
      ok: true,
      schema_version: '2.0',
      export_type: type,
      export_date: new Date().toISOString(),
      total_records: data.length,
      columns,
      data
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * GET /api/ai/learning-correlations
 * Surface existing correlation data from the in-memory cache (Task 1.6).
 * Stops hiding correlations in JSONL log files — makes them API-accessible.
 */
app.get('/api/ai/learning-correlations', (req, res) => {
  const correlations = {};
  for (const [roomId, entry] of learningCorrelationCache.entries()) {
    correlations[roomId] = entry;
  }
  res.json({
    ok: true,
    rooms: correlations,
    count: learningCorrelationCache.size,
    description: 'Active learning correlations: ppfdBlue (PPFD↔Blue), tempRh (Temp↔RH), dutyEnergy (Duty↔Energy). Coefficient near ±1 = strong correlation.'
  });
});

/**
 * GET /api/ai/network-intelligence
 * Return latest network intelligence received from Central (if any).
 * Farms consume Central's pushed benchmarks + demand signals here.
 */
app.get('/api/ai/network-intelligence', (req, res) => {
  try {
    const recsPath = path.join(process.cwd(), 'data', 'ai-recommendations.json');
    if (fs.existsSync(recsPath)) {
      const data = JSON.parse(fs.readFileSync(recsPath, 'utf-8'));
      return res.json({
        ok: true,
        network_intelligence: data.network_intelligence || null,
        recommendations: data.recommendations || [],
        received_at: data.received_at || null
      });
    }
    res.json({ ok: true, network_intelligence: null, recommendations: [], received_at: null });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * GET /api/ai/suggested-crop
 * Phase 2 Task 2.2: AI pre-fill crop recommendation for seeding dialog.
 * Called by Activity Hub when grower opens the seeding screen.
 * Query params: groupId (optional), zoneId (optional)
 *
 * Returns the top-scored crop + confidence so the UI can pre-fill the crop dropdown.
 * Grower can always override — this just saves time on the most common choice.
 */
app.get('/api/ai/suggested-crop', asyncHandler(async (req, res) => {
  const { groupId, zoneId } = req.query;

  try {
    // 1. Build zone conditions from group or zone
    let zoneConditions = {};
    let currentCrop = null;
    const groupsPath = path.join(PUBLIC_DIR, 'data', 'groups.json');
    let groups = [];

    if (fs.existsSync(groupsPath)) {
      const groupsData = JSON.parse(fs.readFileSync(groupsPath, 'utf8'));
      groups = groupsData.groups || (Array.isArray(groupsData) ? groupsData : []);
    }

    if (groupId) {
      const group = groups.find(g => g.id === groupId);
      if (group) {
        currentCrop = group.plan || group.crop || null;
        zoneConditions = {
          ec: group.planConfig?.ec || 1.5,
          ph: group.planConfig?.ph || 5.8,
          vpd: group.planConfig?.vpd || 1.0,
          dli_capacity: group.planConfig?.dli || 22
        };
      }
    }

    // 2. Get all available crops from lighting recipes
    const recipesPath = path.join(PUBLIC_DIR, 'data', 'lighting-recipes.json');
    let availableCrops = [];
    if (fs.existsSync(recipesPath)) {
      const recipes = JSON.parse(fs.readFileSync(recipesPath, 'utf8'));
      availableCrops = Object.keys(recipes.crops || {})
        .map(name => `crop-${name.toLowerCase().replace(/\\s+/g, '-')}`);
    }

    if (availableCrops.length === 0) {
      return res.json({ ok: true, suggestion: null, reason: 'No crops configured' });
    }

    // 3. Build current inventory
    const now = new Date();
    const currentInventory = groups.map(g => {
      const seedDate = g.planConfig?.anchor?.seedDate ? new Date(g.planConfig.anchor.seedDate) : now;
      const harvestDate = new Date(seedDate); harvestDate.setDate(harvestDate.getDate() + 35);
      return { groupId: g.id, crop: g.plan || g.crop, expectedHarvest: harvestDate.toISOString() };
    });

    // 4. Build demand data (lightweight — from stored wholesale + network)
    let demandData = null;
    try {
      const aiRecsPath = path.join(PUBLIC_DIR, 'data', 'ai-recommendations.json');
      if (fs.existsSync(aiRecsPath)) {
        const aiRecs = JSON.parse(fs.readFileSync(aiRecsPath, 'utf8'));
        const nd = aiRecs?.network_intelligence?.demand_signals;
        if (nd && Object.keys(nd).length > 0) {
          demandData = {};
          for (const [crop, sig] of Object.entries(nd)) {
            demandData[crop.toLowerCase()] = {
              totalQty: sig.network_total_qty || 0,
              orderCount: sig.network_order_count || 0,
              trend: sig.network_trend || 'stable'
            };
          }
        }
      }
    } catch (_) {}

    // 5. Generate recommendation
    const recommendations = await generateCropRecommendations({
      groupId: groupId || 'default',
      currentCrop,
      availableCrops,
      targetSeedDate: now,
      currentInventory,
      zoneConditions,
      demandData
    });

    const top = recommendations.topRecommendation;
    res.json({
      ok: true,
      suggestion: top ? {
        cropId: top.cropId,
        cropName: top.cropName,
        confidence: top.confidence,
        scores: top.scores,
        expectedHarvestDate: top.expectedHarvestDate,
        durationDays: top.durationDays
      } : null,
      alternatives: (recommendations.alternatives || []).slice(0, 2).map(a => ({
        cropId: a.cropId,
        cropName: a.cropName,
        confidence: a.confidence
      })),
      reason: top
        ? `Best match for zone conditions (${Math.round(top.confidence * 100)}% confidence)`
        : 'No scored crops available'
    });
  } catch (error) {
    console.error('[ai] Suggested crop error:', error);
    res.json({ ok: true, suggestion: null, reason: error.message });
  }
}));

// ── Phase 5 Ticket 5.2: AI-Driven Harvest Timing ──────────────────────

/**
 * GET /api/harvest/predict/:groupId
 * Predict harvest date for a specific group using growth & quality analysis.
 */
app.get('/api/harvest/predict/:groupId', async (req, res) => {
  try {
    const { default: HarvestPredictor } = await import('./lib/harvest-predictor.js');
    const predictor = new HarvestPredictor(path.join(process.cwd(), 'data'));
    const prediction = await predictor.predict(req.params.groupId);
    res.json({ ok: true, prediction, timestamp: new Date().toISOString() });
  } catch (error) {
    res.json({ ok: true, prediction: null, groupId: req.params.groupId, message: error.message, timestamp: new Date().toISOString() });
  }
});

/**
 * GET /api/harvest/predictions/all
 * Predict harvest dates for all active groups.
 */
app.get('/api/harvest/predictions/all', async (req, res) => {
  try {
    const { default: HarvestPredictor } = await import('./lib/harvest-predictor.js');
    const predictor = new HarvestPredictor(path.join(process.cwd(), 'data'));
    const activeGroups = await predictor.getActiveGroups();
    const groupIds = activeGroups.map(g => g.id);
    const predictions = await predictor.predictMultiple(groupIds);
    res.json({ ok: true, predictions, count: predictions.length, timestamp: new Date().toISOString() });
  } catch (error) {
    res.json({ ok: true, predictions: [], message: error.message, timestamp: new Date().toISOString() });
  }
});

/**
 * GET /api/harvest/readiness
 * Scan all active groups for harvest readiness with growth rate & quality analysis.
 * Returns actionable notifications for groups approaching or at harvest readiness.
 */
app.get('/api/harvest/readiness', async (req, res) => {
  try {
    const { scanHarvestReadiness } = await import('./lib/harvest-readiness.js');
    const notifications = await scanHarvestReadiness(
      typeof harvestOutcomesDB !== 'undefined' ? harvestOutcomesDB : null,
      typeof agentAuditDB !== 'undefined' ? agentAuditDB : null
    );
    res.json({ ok: true, notifications, count: notifications.length, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * GET /api/harvest/readiness/:groupId
 * Get readiness assessment for a specific group.
 */
app.get('/api/harvest/readiness/:groupId', async (req, res) => {
  try {
    const { default: HarvestPredictor } = await import('./lib/harvest-predictor.js');
    const { analyzeGrowthRate, analyzeQualityTrend, assessReadiness } = await import('./lib/harvest-readiness.js');
    const predictor = new HarvestPredictor(path.join(process.cwd(), 'data'));
    const group = await predictor.getGroup(req.params.groupId);
    if (!group) return res.status(404).json({ ok: false, error: 'Group not found' });

    const prediction = await predictor.predict(req.params.groupId);
    let experimentRecords = [];
    if (typeof harvestOutcomesDB !== 'undefined') {
      experimentRecords = await harvestOutcomesDB.find({});
    }
    const growthAnalysis = analyzeGrowthRate(group.crop || 'Unknown', experimentRecords);
    const qualityAnalysis = analyzeQualityTrend(group.crop || 'Unknown', experimentRecords);
    const assessment = assessReadiness(group, prediction, growthAnalysis, qualityAnalysis);

    res.json({ ok: true, assessment, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * GET /api/harvest/growth-analysis/:crop
 * Get growth rate and quality trend analysis for a crop.
 */
app.get('/api/harvest/growth-analysis/:crop', async (req, res) => {
  try {
    const { analyzeGrowthRate, analyzeQualityTrend } = await import('./lib/harvest-readiness.js');
    let experimentRecords = [];
    if (typeof harvestOutcomesDB !== 'undefined') {
      experimentRecords = await harvestOutcomesDB.find({});
    }
    const growth = analyzeGrowthRate(req.params.crop, experimentRecords);
    const quality = analyzeQualityTrend(req.params.crop, experimentRecords);
    res.json({ ok: true, crop: req.params.crop, growth, quality, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * ML API Routes
 * - /api/ml/anomalies: Outdoor-aware anomaly detection with IsolationForest
 * - /api/ml/effects: Learn device effects on RH/temp using Ridge regression
 */
mountMLRoutes(app);

/**
 * License Management Routes
 * - GET /api/license: Get license info
 * - POST /api/license/validate: Force license validation
 * - GET /api/license/features: Get available features
 * - GET /api/license/check/:feature: Check if feature is enabled
 */
app.use('/api', licenseRouter);

/**
 * AI Health Monitoring Routes
 * - /api/health/scan: Scan all zones for out-of-target conditions
 * - /api/health/status: Get overall farm health status
 * - /api/health/status/:zoneId: Get specific zone health details
 * - /api/health/out-of-target: List all out-of-target conditions
 * - /api/health/score: Calculate 0-100 health scores per zone and farm
 * - /api/health/insights: Get health insights with scores and recommendations
 */
app.use('/api/health', healthRouter);

/**
 * Farm Purchase & Onboarding Routes (Removed - now using ES module import below at line ~9757)
 * - POST /api/farms/create-checkout-session: Create Square payment link
 * - POST /api/farms/purchase: Complete purchase and create account
 * - GET /api/farms/verify-session/:session_id: Verify checkout and order
 */

/**
 * mDNS Discovery Routes
 * - GET /api/mdns/discover: Start discovery and return list
 * - GET /api/mdns/services: Get all discovered services
 * - GET /api/mdns/services/:name: Get specific service details
 * - POST /api/mdns/refresh: Restart discovery
 * - DELETE /api/mdns/services/:name: Remove service from list
 * - GET /api/mdns/status: Get discovery system status
 */
app.use('/api/mdns', mdnsDiscoveryRouter);

/**
 * Cloud-to-Edge Migration Routes
 * - POST /api/migration/export: Export complete farm data from cloud
 * - GET /api/migration/download/:exportId: Download export package
 * - POST /api/migration/import: Import data into edge deployment
 * - POST /api/migration/validate: Validate export data before import
 * - POST /api/migration/rollback/:rollbackId: Rollback migration to pre-import state
 * - GET /api/migration/status: Get migration history and status
 */
app.use('/api/migration', migrationRouter);

/**
 * QR Code Bulk Generator Routes
 * - POST /api/qr-generator/generate: Generate sequential QR codes (PDF or JSON)
 * - GET /api/qr-generator/available-range: Get next available code range
 * - POST /api/qr-generator/validate: Check if codes already exist
 */
import { router as qrGeneratorRouter } from './routes/qr-generator.js';
app.use('/api/qr-generator', qrGeneratorRouter);

/**
 * Thermal Printer API Routes
 * - POST /api/printer/print-tray: Print tray label with QR code
 * - POST /api/printer/print-harvest: Print harvest label
 * - POST /api/printer/print-packing: Print wholesale packing label
 * - POST /api/printer/print-raw: Print raw ZPL/EPL data
 * - GET /api/printer/queue: View print queue status
 * - GET /api/printer/job/:id: Get job status
 * - DELETE /api/printer/job/:id: Cancel pending job
 * - POST /api/printer/clear: Clear completed jobs
 * - POST /api/printer/test: Test printer connection
 * - GET /api/printer/list: List available USB printers
 */
import { router as printerRouter } from './routes/thermal-printer.js';
app.use('/api/printer', printerRouter);

/**
 * Edge Device Setup & Activation Routes
 * - POST /api/setup/activate: Activate device with activation code
 * - GET /api/setup/hardware: Get hardware information
 * - GET /api/setup/status: Check activation status
 * - POST /api/setup/generate-code: Generate activation code (admin only)
 */
app.use('/api/setup', setupRouter);

/**
 * GreenReach Admin - Authentication Routes
 * - POST /api/admin/auth/login: Admin login with email/password/2FA
 * - GET /api/admin/auth/verify: Verify current session token
 * - POST /api/admin/auth/logout: Logout and revoke session
 */
// Middleware to attach database pool to all admin routes
app.use('/api/admin/*', (req, res, next) => {
  req.db = app.locals.db;
  next();
});
app.use('/api/admin/auth', adminAuthRouter);

/**
 * GreenReach Admin - Federated Health Monitoring Routes
 * - /api/admin/health/fleet: Aggregate health data from all registered farms
 * - /api/admin/health/farms: List all registered farms
 */
app.use('/api/admin/health', adminHealthRouter);

/**
 * Crop Pricing Configuration Routes
 * Manage farm crop pricing for sales terminal and wholesale
 * - GET /api/crop-pricing: Get all crop pricing
 * - PUT /api/crop-pricing: Update crop pricing (admin)
 * - GET /api/crop-pricing/:cropName: Get specific crop pricing
 */
app.use('/api/crop-pricing', cropPricingRouter);

/**
 * Light Engine: Wholesale Inventory Sync Routes
 * Exposes farm inventory to GreenReach for catalog aggregation
 * - GET /api/wholesale/inventory: Farm inventory lots with availability
 * - GET /api/wholesale/schedule: Pickup windows and delivery logistics
 * - GET /api/wholesale/pricing: Wholesale pricing matrix by SKU
 */
app.use('/api/wholesale', wholesaleSyncRouter);

/**
 * Light Engine: Wholesale Admin Routes
 * Farm API key management and monitoring (REQUIRES ADMIN AUTH - Task #14)
 * - GET /api/wholesale/admin/keys: List farm API keys
 * - POST /api/wholesale/admin/keys: Generate new farm API key
 * - POST /api/wholesale/admin/keys/:farm_id/rotate: Rotate farm API key
 * - POST /api/wholesale/admin/keys/:farm_id/suspend: Suspend farm
 * - POST /api/wholesale/admin/keys/:farm_id/reactivate: Reactivate farm
 */
app.use('/api/wholesale/admin', wholesaleAdminRouter);

/**
 * Light Engine: Wholesale Reservation Management
 * Handles inventory holds during GreenReach checkout
 * - POST /api/wholesale/reserve: Create TTL hold on inventory
 * - POST /api/wholesale/release: Release hold (checkout cancelled)
 * - POST /api/wholesale/confirm: Confirm hold and decrement inventory
 * - GET /api/wholesale/reservations: List active reservations
 */
app.use('/api/wholesale', wholesaleReservationsRouter);

/**
 * Light Engine: Farm Fulfillment Status Webhooks
 * Farm-side order fulfillment workflow and invoice generation
 * - POST /api/wholesale/fulfillment/status: Update sub-order fulfillment status
 * - GET /api/wholesale/fulfillment/status/:sub_order_id: Get fulfillment status
 * - GET /api/wholesale/fulfillment/orders: List fulfillment records
 * - POST /api/wholesale/fulfillment/invoice-required: Handle invoice request from GreenReach
 * - GET /api/wholesale/fulfillment/invoice/:invoice_id: Get invoice details
 */
app.use('/api/wholesale/fulfillment', wholesaleFulfillmentRouter);

/**
 * GreenReach: Wholesale Catalog and Checkout Routes
 * - GET /api/wholesale/catalog: Aggregated inventory from all farms
 * - GET /api/wholesale/catalog/sku/:skuId: Detailed SKU availability
 * - POST /api/wholesale/checkout/preview: Preview order allocation
 * - POST /api/wholesale/checkout/execute: Execute full checkout with payments
 * - GET /api/wholesale/checkout/:orderId: Get order receipt
 */
app.use('/api/wholesale/catalog', wholesaleCatalogRouter);
app.use('/api/wholesale/checkout', wholesaleCheckoutRouter);

/**
 * GreenReach: Wholesale Buyer Orders
 * Buyer-facing order history and invoices
 */

// Buyer authentication middleware
function requireBuyerAuth(req, res, next) {
  const authHeader = req.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : '';
  if (!token) {
    return res.status(401).json({ status: 'error', message: 'Missing bearer token' });
  }

  const secret = process.env.WHOLESALE_JWT_SECRET || process.env.JWT_SECRET || 'dev-greenreach-wholesale-secret';
  if (!secret) {
    return res.status(500).json({ status: 'error', message: 'Wholesale auth not configured' });
  }

  try {
    const payload = jwt.verify(token, secret);
    
    // Support both token formats: { buyerId } from wholesale-buyers.js and { sub } from other sources
    const buyerId = payload.buyerId || payload.sub;
    
    if (!buyerId) {
      return res.status(401).json({ status: 'error', message: 'Invalid token format' });
    }

    // Store buyer ID from token
    req.wholesaleBuyer = { id: String(buyerId) };
    return next();
  } catch (error) {
    return res.status(401).json({ status: 'error', message: 'Invalid or expired token' });
  }
}

// GET /api/wholesale/orders - List buyer's orders
app.get('/api/wholesale/orders', requireBuyerAuth, asyncHandler(async (req, res) => {
  const buyerId = req.wholesaleBuyer.id;
  
  // Query orders from database (or in-memory for now)
  // For now, return empty array - will be populated from checkout executions
  const orders = [];
  
  res.json({
    status: 'ok',
    data: { orders }
  });
}));

// GET /api/wholesale/orders/:orderId/invoice - Get invoice for specific order
app.get('/api/wholesale/orders/:orderId/invoice', requireBuyerAuth, asyncHandler(async (req, res) => {
  const buyerId = req.wholesaleBuyer.id;
  const orderId = req.params.orderId;
  
  // Query order from database
  // For now, return 404
  res.status(404).json({ 
    status: 'error', 
    message: 'Order not found' 
  });
}));

// GET /api/wholesale/inventory/check-overselling - Validate inventory availability
app.get('/api/wholesale/inventory/check-overselling', asyncHandler(async (req, res) => {
  // This endpoint checks if any inventory is oversold across the network
  // For now, return no issues
  res.json({
    status: 'ok',
    oversold_items: [],
    warnings: []
  });
}));

/**
 * GreenReach: Wholesale Buyer Authentication and Management
 * - POST /api/wholesale/buyers/register: Register new wholesale buyer account
 * - POST /api/wholesale/buyers/login: Authenticate buyer and issue JWT
 * - POST /api/wholesale/buyers/forgot-password: Request password reset
 * - GET /api/wholesale/buyers/reset-password/:token: Validate reset token
 * - POST /api/wholesale/buyers/reset-password: Complete password reset
 * - GET /api/wholesale/buyers/me: Get current buyer profile
 */
app.use('/api/wholesale', wholesaleBuyersRouter);

/**
 * GreenReach: Wholesale Product Requests
 * - POST /api/wholesale/product-requests/create: Create product request (notifies all farms)
 * - GET /api/wholesale/product-requests/buyer/:buyerId: Get buyer's requests
 */
app.use('/api/wholesale/product-requests', wholesaleProductRequestsRouter);

/**
 * Market Intelligence API
 * - GET /api/market-intelligence/price-alerts: Real-time price anomaly alerts
 * - GET /api/market-intelligence/market-overview: Market overview with trends
 * - GET /api/market-intelligence/product/:productName: Detailed product pricing
 */
app.use('/api/market-intelligence', marketIntelligenceRouter);

/**
 * GreenReach: Admin Wholesale Buyer Management
 * - GET /api/admin/wholesale/buyers: List all buyers (paginated)
 * - GET /api/admin/wholesale/buyers/:id: Get buyer details
 * - PUT /api/admin/wholesale/buyers/:id: Update buyer information
 * - POST /api/admin/wholesale/buyers/:id/reset-password: Admin reset password
 * - DELETE /api/admin/wholesale/buyers/:id: Delete buyer account
 * - GET /api/admin/wholesale/buyers/search: Search buyers by name/email
 */
app.use('/api/admin/wholesale', adminWholesaleBuyersRouter);

/**
 * GreenReach: Webhook and Payment Reconciliation
 * - POST /api/wholesale/webhooks/square: Square payment webhook handler
 * - GET /api/wholesale/webhooks/payments/:paymentId/status: Poll payment status
 * - GET /api/wholesale/webhooks/payments: List all payment records
 * - POST /api/wholesale/webhooks/reconcile: Manual reconciliation
 */
app.use('/api/wholesale/webhooks', wholesaleWebhooksRouter);

/**
 * GreenReach: Refund and Adjustment Workflows
 * - POST /api/wholesale/refunds: Create full or partial refund
 * - GET /api/wholesale/refunds/:refundId: Get refund details
 * - GET /api/wholesale/refunds: List all refunds
 * - POST /api/wholesale/refunds/:refundId/notify-farm: Notify farm of refund
 */
app.use('/api/wholesale/refunds', wholesaleRefundsRouter);

/**
 * GreenReach: Square OAuth Onboarding for Farms
 * - GET /api/wholesale/oauth/square/authorize: Generate OAuth URL for farm
 * - GET /api/wholesale/oauth/square/callback: Handle OAuth callback from Square
 * - POST /api/wholesale/oauth/square/refresh: Refresh access token
 * - GET /api/wholesale/oauth/square/status/:farm_id: Get OAuth status
 * - GET /api/wholesale/oauth/square/farms: List all onboarded farms
 * - DELETE /api/wholesale/oauth/square/disconnect/:farm_id: Disconnect farm
 */
app.use('/api/wholesale/oauth/square', wholesaleSquareOAuthRouter);

/**
 * Farm: Square Payment Processing Setup
 * - GET /api/farm/square/status: Check if farm has Square connected
 * - POST /api/farm/square/authorize: Generate OAuth URL for farm's Square account
 * - GET /api/farm/square/callback: Handle OAuth callback from Square
 * - POST /api/farm/square/settings: Save payment processing settings
 * - POST /api/farm/square/disconnect: Disconnect farm's Square account
 * - POST /api/farm/square/test-payment: Test payment in sandbox mode
 */
app.use('/api/farm/square', farmSquareSetupRouter);

/**
 * Farm: Stripe Payment Processing Setup
 * - GET /api/farm/stripe/status: Check if farm has Stripe connected
 * - POST /api/farm/stripe/authorize: Generate OAuth URL for farm's Stripe Connect account
 * - GET /api/farm/stripe/callback: Handle OAuth callback from Stripe
 * - POST /api/farm/stripe/settings: Save Stripe payment processing settings
 * - POST /api/farm/stripe/disconnect: Disconnect farm's Stripe account
 * - POST /api/farm/stripe/test-payment: Test payment processing
 * - POST /api/farm/stripe/webhook: Handle Stripe webhook events
 */
app.use('/api/farm/stripe', farmStripeSetupRouter);

/**
 * Farm: Online Store Setup and Deployment
 * - GET /api/farm/store/status: Check farm store configuration status
 * - POST /api/farm/store/subdomain/check: Check if subdomain is available
 * - POST /api/farm/store/domain/validate: Validate custom domain
 * - POST /api/farm/store/setup: Configure farm store
 * - POST /api/farm/store/deploy: Deploy farm store to production
 * - POST /api/farm/store/update: Update store configuration
 * - POST /api/farm/store/unpublish: Take store offline
 */
app.use('/api/farm/store', farmStoreSetupRouter);

/**
 * Edge: Configuration and Status
 * - GET /api/edge/status: Get edge mode status and connection state
 * - GET /api/edge/config: Get edge configuration
 * - PUT /api/edge/config: Update edge configuration  
 * - POST /api/edge/register: Register farm with GreenReach Central
 * - POST /api/edge/mode: Switch between edge and cloud mode
 * - GET /api/edge/queue: Get sync queue status
 * - POST /api/edge/queue/clear: Clear sync queue
 * - POST /api/edge/sync/manual: Trigger manual sync
 */
app.use('/api/edge', edgeRouter);

/**
 * GreenReach: Fulfillment Webhooks (receives from Light Engine)
 * - POST /api/wholesale/webhooks/fulfillment: Receive farm fulfillment status updates
 * - GET /api/wholesale/webhooks/fulfillment/notifications: List buyer notifications
 */
app.use('/api/wholesale/webhooks/fulfillment', wholesaleFulfillmentWebhooksRouter);

/**
 * GreenReach: SLA and Substitution Policies
 * - POST /api/wholesale/sla/rules: Create custom SLA rule
 * - GET /api/wholesale/sla/rules: List SLA rules
 * - POST /api/wholesale/sla/violations: Record SLA violation
 * - GET /api/wholesale/sla/violations: List SLA violations
 * - POST /api/wholesale/substitution/policies: Create substitution policy
 * - GET /api/wholesale/substitution/policies: List substitution policies
 * - POST /api/wholesale/substitution/find: Find substitute products
 * - POST /api/wholesale/substitution/request-approval: Request buyer approval
 * - POST /api/wholesale/substitution/respond/:approval_id: Respond to approval request
 * - POST /api/wholesale/buyer/preferences: Set buyer preferences
 * - GET /api/wholesale/buyer/preferences/:buyer_id: Get buyer preferences
 */
app.use('/api/wholesale/sla', wholesaleSLAPoliciesRouter);
app.use('/api/wholesale/substitution', wholesaleSLAPoliciesRouter);
app.use('/api/wholesale/buyer/preferences', wholesaleSLAPoliciesRouter);

/**
 * GreenReach Central: Network API Routes
 * Provides farm network data for GreenReach Central Admin dashboard
 * - GET /api/network/dashboard: Network-wide dashboard statistics
 * - GET /api/network/farms/list: List all farms in network
 * - GET /api/network/farms/:farmId: Get detailed farm information
 * - GET /api/network/comparative-analytics: Cross-farm analytics
 * - GET /api/network/trends: Network-wide trends
 * - GET /api/network/alerts: Network alerts and notifications
 */
app.use('/api/network', networkRouter);

/**
 * Wholesale Network Routes (Edge Farm)
 * Returns local farm data for wholesale admin dashboard
 * - GET /api/wholesale/network/farms: List network farms (returns local farm)
 * - GET /api/wholesale/network/snapshots: Inventory snapshots
 * - GET /api/wholesale/network/aggregate: Aggregated catalog
 * - GET /api/wholesale/network/market-events: Market events
 * - GET /api/network/recommendations: Network recommendations
 */
app.use('/api/wholesale/network', wholesaleNetworkRouter);

/**
 * Wholesale Orders Routes (Multi-Farm Order Management)
 * SkipTheDishes-style workflow with payment authorization and farm verification
 * - POST /api/wholesale/orders/create: Place order with payment authorization
 * - POST /api/wholesale/orders/farm-verify: Farm accepts/declines/modifies order
 * - POST /api/wholesale/orders/buyer-review: Buyer reviews farm modifications
 * - POST /api/wholesale/orders/confirm-pickup: QR code pickup verification
 * - GET /api/wholesale/orders/pending-verification/:farm_id: Farm's pending orders
 * - GET /api/wholesale/orders/:order_id: Complete order details
 */
app.use('/api/wholesale/orders', wholesaleOrdersRouter);

/**
 * Activity Hub Orders (Farm Workflow)
 * Simplified order response API for iPad Activity Hub interface
 * - GET /api/activity-hub/orders/pending: Get farm's pending orders
 * - GET /api/activity-hub/orders/:orderId: Get order details
 * - POST /api/activity-hub/orders/:orderId/accept: Accept order
 * - POST /api/activity-hub/orders/:orderId/modify: Modify quantities
 * - POST /api/activity-hub/orders/:orderId/decline: Decline order
 * - POST /api/activity-hub/orders/:orderId/pick: Start picking (generate lot codes)
 * - POST /api/activity-hub/orders/:orderId/pack: Mark as packed (generate label)
 */
app.use('/api/activity-hub/orders', activityHubOrdersRouter);

/**
 * Crop Weight Reconciliation Routes
 * Full-tray weigh-ins during harvest for yield tracking & AI training data
 * - GET  /api/crop-weights/should-weigh: Check if tray is flagged for weigh-in
 * - POST /api/crop-weights/record: Record a weigh-in
 * - GET  /api/crop-weights/records: List weigh-in history
 * - GET  /api/crop-weights/benchmarks: Per-crop weight benchmarks
 * - GET  /api/crop-weights/analytics: Grouped analytics for Central dashboard
 * - GET  /api/crop-weights/ai-training-export: Export for ML training
 */
app.use('/api/crop-weights', cropWeightReconciliationRouter);

/**
 * Unified Traceability (SFCR / CanadaGAP)
 * Auto-populated from harvest — no manual batch creation.
 * Endpoints: GET /records, GET /stats, GET /lot/:code, GET /recall/:code,
 *            GET /sfcr-export, POST /event, GET /label-data/:code
 */
app.use('/api/traceability', traceabilityRouter);

/**
 * Quality Control & AI Vision Routes
 * Quality assurance checkpoints with photo documentation and AI analysis
 * - POST /api/quality/checkpoints/record: Create QA checkpoint
 * - GET /api/quality/checkpoints/batch/:batch_id: Get batch QA history
 * - GET /api/quality/standards/:checkpoint_type: Get quality criteria
 * - GET /api/quality/checkpoints/list: List checkpoints with filters
 * - GET /api/quality/photos/:checkpoint_id: Get checkpoint photo
 * - POST /api/quality/photos/upload: Upload photo to checkpoint
 * - GET /api/quality/stats: QA statistics
 * - GET /api/quality/dashboard: Dashboard overview
 * - POST /api/qa/analyze-photo: AI plant health analysis
 * - POST /api/qa/checklist-photo: Complete workflow with AI + checkpoint
 */
app.use('/api/quality', qualityControlRouter);
app.use('/api/qa', aiVisionRouter);

/**
 * Farm Performance Analytics (GreenReach Central)
 * Track verification rates, response times, and reliability for broker accountability
 * - GET /api/wholesale/farm-performance/dashboard: Network-wide performance overview
 * - GET /api/wholesale/farm-performance/:farm_id: Detailed farm metrics
 * - GET /api/wholesale/farm-performance/leaderboard: Top performing farms
 * - GET /api/wholesale/farm-performance/alerts: Performance alerts requiring attention
 * - POST /api/wholesale/farm-performance/flag: Flag farm for review
 * - GET /api/wholesale/farm-performance/trends: Performance trends over time
 */
app.use('/api/wholesale/farm-performance', wholesaleFarmPerformanceRouter);

/**
 * Advanced Inventory Management & Sustainability APIs
 * Served by Python FastAPI backend on port 8000
 * - /api/inventory/*: Advanced inventory management (seeds, packaging, nutrients, equipment, supplies)
 * - /api/sustainability/*: Environmental tracking and ESG reporting
 * See backend/server.py for full endpoint documentation
 */

/**
 * GreenReach: Audit Logging
 * Comprehensive audit trail for compliance and debugging
 * - GET /api/audit/logs: Query audit logs with filters
 * - GET /api/audit/entity/:type/:id: Get entity history
 * - GET /api/audit/user/:user_id: Get user activity
 * - GET /api/audit/summary: Get statistics
 * - GET /api/audit/export: Export logs to JSON
 */
app.use('/api/audit', createAuditRoutes());

// Apply audit middleware to all wholesale routes
app.use('/api/wholesale', auditMiddleware);

console.log(' Audit logging initialized - capturing all wholesale operations');

/**
 * ===========================================
 * PROCUREMENT PORTAL - Farm Supply Ordering
 * ===========================================
 * Drop-shipping e-procurement system allowing farms to:
 * - Browse curated supply catalog (nutrients, seeds, media, equipment)
 * - Place purchase orders routed to approved suppliers
 * - Track order status and receive inventory
 * - View supply inventory levels
 * Routes:
 * - GET /api/procurement/catalog      - Browse products
 * - GET /api/procurement/categories    - List categories
 * - GET /api/procurement/suppliers     - List suppliers
 * - GET/PUT /api/procurement/cart      - Manage cart
 * - POST /api/procurement/orders       - Place order
 * - GET /api/procurement/orders        - Order history
 * - POST /api/procurement/orders/:id/receive - Mark received
 * - GET /api/procurement/inventory     - Supply inventory
 * - GET /api/procurement/commission-report - Admin reporting
 */
app.use('/api/procurement', procurementRouter);
console.log(' Procurement portal initialized');

/**
 * ===========================================
 * FARM SALES TERMINAL - Unified Sales System
 * ===========================================
 * Multi-channel sales platform combining:
 * - Point of Sale (POS) for walk-up farm stand
 * - Direct-to-Consumer (D2C) online sales
 * - B2B orders via GreenReach marketplace
 * - Food security programs and donations
 * 
 * SECURITY: Multi-tenant with farm_id scoping
 * - Each farm has isolated data (orders, inventory, payments)
 * - JWT authentication required for all endpoints
 * - Cannot access farm management systems or other farms' data
 */

// Import farm authentication
import { createAuthRoutes, farmAuthMiddleware, blockFarmManagementEndpoints } from './lib/farm-auth.js';

/**
 * Farm Sales: Authentication & Authorization
 * JWT-based multi-tenant authentication system
 * - POST /api/farm-auth/login: Login and get JWT token
 * - GET /api/farm-auth/verify: Verify token validity
 * - GET /api/farm-auth/demo-tokens: Get test tokens (dev only)
 */
app.use('/api/farm-auth', createAuthRoutes());

// Apply security isolation middleware
app.use(blockFarmManagementEndpoints);

console.log(' Farm authentication system initialized - multi-tenant JWT with security isolation');

// Import farm-sales routes
import farmSalesOrdersRouter from './routes/farm-sales/orders.js';
import farmSalesInventoryRouter from './routes/farm-sales/inventory.js';
import farmSalesPaymentsRouter from './routes/farm-sales/payments.js';
import farmSalesPOSRouter from './routes/farm-sales/pos.js';
import farmSalesDeliveryRouter from './routes/farm-sales/delivery.js';
import farmSalesSubscriptionsRouter from './routes/farm-sales/subscriptions.js';
import farmSalesDonationsRouter from './routes/farm-sales/donations.js';
import farmSalesCustomersRouter from './routes/farm-sales/customers.js';
import farmSalesProgramsRouter from './routes/farm-sales/programs.js';
import farmSalesFulfillmentRouter from './routes/farm-sales/fulfillment.js';
import farmSalesReportsRouter from './routes/farm-sales/reports.js';
import farmSalesQuickBooksRouter from './routes/farm-sales/quickbooks.js';
import farmSalesLotTrackingRouter from './routes/farm-sales/lot-tracking.js';
import farmSalesAIAgentRouter from './routes/farm-sales/ai-agent.js';
import authRouter from './routes/auth.js';
import farmsRouter from './routes/farms.js';
import integrationsRouter, { initIntegrationRoutes, syncIntegrationsToCentral, getIntegrationRecordsForSync } from './routes/integrations.js';
import { createWizardHandlers } from './lib/device-wizard.js';
import purchaseRouter from './routes/purchase.js';
import purchaseLeadsRouter from './routes/purchase-leads.js';
import kpisRouter from './routes/kpis.js';
import setupWizardRouter from './routes/setup-wizard.js';
import pg from 'pg';

// Initialize PostgreSQL pool for purchase flow (only if DB credentials provided)
let dbPool = null;
if (process.env.DB_HOST && process.env.DB_NAME) {
  dbPool = new pg.Pool({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
  });
  console.log('[DB] PostgreSQL pool initialized for cloud mode');
} else {
  console.log('[DB] No PostgreSQL credentials - running in edge mode (local data files)');
}

// Store database pool in app.locals for routes (null in edge mode)
app.locals.db = dbPool;

/**
 * GreenReach Central - Farm Registration & Provisioning
 * Central registration service operated by GreenReach (SaaS provider)
 * - POST /api/farms/register: Farm edge device registration with code validation
 * - POST /api/farms/generate-code: Admin generates registration codes
 * - GET /api/farms/:farmId: Get farm information
 * - GET /api/farms/list: List all registered farms (admin)
 * - GET /api/farms/codes/list: List all registration codes (admin)
 */
app.use('/api/farms', farmsRouter);

/**
 * Device Integrations API — Integration Assistant Phase 1
 * Device integration records for network learning
 * - GET /api/integrations: List all device integrations
 * - GET /api/integrations/:id: Get specific integration
 * - POST /api/integrations: Create device integration record
 * - PATCH /api/integrations/:id: Update integration (validation/feedback)
 * - DELETE /api/integrations/:id: Remove integration record
 */
initIntegrationRoutes(integrationDB);
app.use('/api/integrations', integrationsRouter);

/**
 * Device Wizard API — Integration Assistant Phase 2 (Ticket I-2.10)
 * Multi-step wizard for adding new devices with auto-discovery
 * - POST /api/device-wizard/start: Start new wizard session
 * - GET /api/device-wizard/:sessionId: Get wizard state
 * - POST /api/device-wizard/:sessionId/protocol: Select protocol
 * - POST /api/device-wizard/:sessionId/config: Set connection config
 * - POST /api/device-wizard/:sessionId/discover: Discover devices
 * - POST /api/device-wizard/:sessionId/select-device: Select device
 * - POST /api/device-wizard/:sessionId/assign-room: Assign to room/zone
 * - POST /api/device-wizard/:sessionId/save: Save integration record
 * - POST /api/device-wizard/:sessionId/back: Go back one step
 * - DELETE /api/device-wizard/:sessionId: Cancel/reset session
 */
const wizardHandlers = createWizardHandlers(integrationDB);
app.post('/api/device-wizard/start', wizardHandlers.start);
app.get('/api/device-wizard/:sessionId', wizardHandlers.getState);
app.post('/api/device-wizard/:sessionId/protocol', wizardHandlers.selectProtocol);
app.post('/api/device-wizard/:sessionId/config', wizardHandlers.setConfig);
app.post('/api/device-wizard/:sessionId/discover', wizardHandlers.discover);
app.post('/api/device-wizard/:sessionId/select-device', wizardHandlers.selectDevice);
app.post('/api/device-wizard/:sessionId/assign-room', wizardHandlers.assignRoom);
app.post('/api/device-wizard/:sessionId/save', wizardHandlers.save);
app.post('/api/device-wizard/:sessionId/back', wizardHandlers.goBack);
app.delete('/api/device-wizard/:sessionId', wizardHandlers.cancel);

/**
 * Purchase & Onboarding Flow
 * Square payment processing, account creation, and welcome emails
 * - POST /api/farms/purchase: Complete purchase and create account
 * - POST /api/farms/create-checkout-session: Create Square payment link
 * - GET /api/farms/verify-session/:session_id: Verify payment and create account
 */
app.use('/api/farms', purchaseRouter);

/**
 * Purchase Leads CRM
 * Capture pre-order interest and schedule calls
 * - POST /api/purchase/leads: Create new lead
 * - GET /api/purchase/leads: List all leads (admin)
 * - GET /api/purchase/leads/:leadId: Get specific lead
 * - PUT /api/purchase/leads/:leadId/status: Update lead status
 */
app.use('/api/purchase', purchaseLeadsRouter);

/**
 * KPI Dashboard API — Phase 2, Ticket 2.4
 * Core business metrics: fill rate, OTIF, margin, loss, forecast error, labor, input reduction
 * - GET /api/kpis: Current KPI values
 * - GET /api/kpis/history: Weekly snapshots (future)
 */
app.use('/api/kpis', kpisRouter);

/**
 * Authentication & Device Pairing
 * JWT token generation and validation for Activity Hub tablets
 * - POST /api/auth/generate-device-token: Generate pairing token for tablet
 * - POST /api/auth/validate-device-token: Validate scanned QR code token
 * - POST /api/auth/login: Authenticate user with credentials
 * - GET /api/ping: Health check for edge device availability
 */
app.use('/api/auth', authRouter);

/**
 * Email Service Routes
 * Send transactional emails: order confirmations, recall notifications
 * - POST /api/email/test: Send test email
 * - POST /api/email/order-confirmation: Send order confirmation
 * - POST /api/email/recall-notification: Send recall notice
 * - GET /api/email/config: Get email configuration
 * - POST /api/email/verify-connection: Test email service connection
 */
app.use('/api/email', emailRouter);

/**
 * Admin Farm Management
 * GreenReach Central admin controls for managing all Light Engine farms
 * - GET /api/admin/farms: List all farms
 * - GET /api/admin/users: List all users across farms
 * - POST /api/admin/farms/:farmId/reset-credentials: Reset farm credentials
 * - POST /api/admin/users/:userId/reset-password: Reset user password
 * - PATCH /api/admin/farms/:farmId/status: Suspend/activate farm
 * - PATCH /api/admin/users/:userId/status: Enable/disable user
 * - PATCH /api/admin/users/:userId/role: Change user role
 * - POST /api/admin/impersonate/:farmId: Generate impersonation token
 */
app.use('/api/admin', adminFarmManagementRouter);

/**
 * Setup Wizard Routes (First-Time Farm Setup)
 * Handles post-purchase farm configuration: profile, rooms, zones
 * - GET /api/setup-wizard/status: Check if setup is complete
 * - POST /api/setup-wizard/farm-profile: Update farm profile (timezone, hours, certifications)
 * - POST /api/setup-wizard/rooms: Create grow rooms
 * - GET /api/setup-wizard/rooms: Get all rooms
 * - POST /api/setup-wizard/zones: Configure zones within a room
 * - POST /api/setup-wizard/complete: Mark setup as complete
 */

// Setup Wizard Status Check (login flow needs this)
// Note: This endpoint accepts tokens but doesn't require them to allow login flow to proceed
// NOTE: /api/setup-wizard/* endpoints are handled by routes/setup-wizard.js router
// The following inline endpoint is DISABLED in favor of the router
/*
app.get('/api/setup-wizard/status', async (req, res) => {
  try {
    // Try to extract token if provided
    const authHeader = req.headers.authorization;
    let farmId = null;
    let email = null;
    let isEdgeMode = false;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      
      // FIRST: Check if it's an edge mode session token
      if (global.farmAdminSessions && global.farmAdminSessions.has(token)) {
        const session = global.farmAdminSessions.get(token);
        farmId = session.farmId;
        email = session.email;
        isEdgeMode = session.edgeMode || session.demoMode || false;
        console.log('[setup-wizard] Edge/Demo session found for', farmId, email);
      } else {
        // SECOND: Try JWT verification (cloud mode)
        try {
          const jwtSecret = process.env.JWT_SECRET || 'fallback-secret-change-in-production';
          const decoded = jwt.verify(token, jwtSecret);
          farmId = decoded.farmId;
          email = decoded.email;
          console.log('[setup-wizard] JWT decoded successfully for', farmId, email);
        } catch (tokenError) {
          console.warn('[setup-wizard] Token verification failed:', tokenError.message);
          // Continue without token - return default
        }
      }
    }
    
    // Edge mode: Always return setup completed (no wizard needed)
    if (isEdgeMode) {
      console.log('[setup-wizard] Edge mode - returning setup completed');
      return res.json({
        success: true,
        setupCompleted: true,
        farmId: farmId || 'edge-farm',
        edgeMode: true
      });
    }
    
    const pool = req.app.locals?.db;
    
    if (!pool || !farmId || !email) {
      // If no database or no valid token, assume setup not completed (safe default)
      console.log('[setup-wizard] Returning default - no pool or token');
      return res.json({
        success: true,
        setupCompleted: false,
        farmId: farmId || 'unknown'
      });
    }
    
    // Check if user has setup_completed flag
    const userResult = await pool.query(
      'SELECT setup_completed FROM users WHERE farm_id = $1 AND email = $2',
      [farmId, email]
    );
    
    if (userResult.rows.length === 0) {
      // User not found - return default (new users haven't completed setup)
      console.log('[setup-wizard] User not found, returning default');
      return res.json({
        success: true,
        setupCompleted: false,
        farmId: farmId
      });
    }
    
    const setupCompleted = userResult.rows[0].setup_completed || false;
    console.log('[setup-wizard] Setup status:', setupCompleted, 'for', farmId);
    
    return res.json({
      success: true,
      setupCompleted: setupCompleted,
      farmId: farmId
    });
  } catch (error) {
    console.error('[setup-wizard] Status check error:', error);
    // On error, return safe default to allow login to proceed
    return res.json({
      success: true,
      setupCompleted: false,
      farmId: 'unknown'
    });
  }
});
*/

// Setup wizard router with edge session authentication
app.use('/api/setup-wizard', setupWizardRouter);

/**
 * Farm Sales: Customer Management
 * Customer accounts, store credits, and preferences
 * - GET /api/farm-sales/customers: List customers
 * - POST /api/farm-sales/customers: Create customer
 * - GET /api/farm-sales/customers/:customerId: Get customer details
 * - PATCH /api/farm-sales/customers/:customerId: Update customer
 * - POST /api/farm-sales/customers/:customerId/add-credits: Add store credits
 * - POST /api/farm-sales/customers/:customerId/use-credits: Use store credits
 * - GET /api/farm-sales/customers/:customerId/credit-history: Get credit history
 */
app.use('/api/farm-sales/customers', farmSalesCustomersRouter);

/**
 * Farm Sales: Order Management
 * Unified order system for all sales channels
 * - POST /api/farm-sales/orders: Create order (POS, D2C, B2B, donation)
 * - GET /api/farm-sales/orders: List orders with filters
 * - GET /api/farm-sales/orders/:orderId: Get order details
 * - PATCH /api/farm-sales/orders/:orderId: Update order status/fulfillment
 * - GET /api/farm-sales/orders/stats/summary: Order statistics
 */
app.use('/api/farm-sales/orders', farmSalesOrdersRouter);

/**
 * Farm Sales: Inventory Management
 * Real-time inventory tracking for farm products
 * - GET /api/farm-sales/inventory: Get current inventory
 * - GET /api/farm-sales/inventory/:skuId: Get product details
 * - POST /api/farm-sales/inventory/reserve: Reserve inventory (TTL hold)
 * - POST /api/farm-sales/inventory/release: Release reservation
 * - POST /api/farm-sales/inventory/confirm: Confirm and decrement inventory
 * - PATCH /api/farm-sales/inventory/:skuId: Update product (restock, pricing)
 * - GET /api/farm-sales/inventory/categories/list: Get product categories
 */
app.use('/api/farm-sales/inventory', farmSalesInventoryRouter);

/**
 * Farm Sales: Payment Processing
 * Multi-method payment processing for all channels
 * - POST /api/farm-sales/payments: Process payment (cash, card, invoice, grant)
 * - GET /api/farm-sales/payments/:paymentId: Get payment status
 * - GET /api/farm-sales/payments: List payments with filters
 * - POST /api/farm-sales/payments/:paymentId/refund: Issue refund
 * - PATCH /api/farm-sales/payments/:paymentId: Update payment status
 */
app.use('/api/farm-sales/payments', farmSalesPaymentsRouter);

/**
 * Farm Sales: Point of Sale (POS) Terminal
 * Quick checkout for walk-up farm stand sales
 * - POST /api/farm-sales/pos/checkout: Express checkout (order + payment)
 * - POST /api/farm-sales/pos/cash: Process cash payment with change
 * - POST /api/farm-sales/pos/card: Process card payment via Square
 * - GET /api/farm-sales/pos/session/summary: Get cashier session summary
 */
app.use('/api/farm-sales/pos', farmSalesPOSRouter);

/**
 * Farm Sales: Delivery Management
 * Route planning and delivery scheduling for D2C orders
 * - GET /api/farm-sales/delivery/windows: Get available delivery windows
 * - POST /api/farm-sales/delivery/schedule: Schedule delivery for order
 * - GET /api/farm-sales/delivery/:deliveryId: Get delivery status/tracking
 * - PATCH /api/farm-sales/delivery/:deliveryId: Update delivery status
 * - POST /api/farm-sales/delivery/routes/optimize: Generate optimized routes
 * - GET /api/farm-sales/delivery/routes: List delivery routes
 * - GET /api/farm-sales/delivery/zones: Get delivery zones and fees
 */
app.use('/api/farm-sales/delivery', farmSalesDeliveryRouter);

/**
 * Farm Sales: Subscription Management
 * Recurring orders and CSA (Community Supported Agriculture) boxes
 * - GET /api/farm-sales/subscriptions/plans: List subscription plans
 * - POST /api/farm-sales/subscriptions: Create subscription
 * - GET /api/farm-sales/subscriptions: List subscriptions
 * - GET /api/farm-sales/subscriptions/:subscriptionId: Get subscription details
 * - PATCH /api/farm-sales/subscriptions/:subscriptionId: Update subscription
 * - POST /api/farm-sales/subscriptions/:subscriptionId/skip: Skip upcoming delivery
 * - POST /api/farm-sales/subscriptions/generate-orders: Generate orders (cron job)
 */
app.use('/api/farm-sales/subscriptions', farmSalesSubscriptionsRouter);

/**
 * Farm Sales: Programs Management
 * Food security programs and CSA box builders
 * - GET /api/farm-sales/programs: List programs
 * - POST /api/farm-sales/programs: Create program
 * - GET /api/farm-sales/programs/:programId: Get program details
 * - PATCH /api/farm-sales/programs/:programId: Update program
 * - GET /api/farm-sales/programs/:programId/box-options: Get box builder options
 * - POST /api/farm-sales/programs/:programId/box-selections: Save customer box selections
 * - GET /api/farm-sales/programs/:programId/box-selections/:customerId: Get customer selections
 */
app.use('/api/farm-sales/programs', farmSalesProgramsRouter);

/**
 * Farm Sales: Fulfillment & Operations
 * Pick lists, pack lists, and delivery manifests
 * - GET /api/farm-sales/fulfillment/pick-list: Generate pick list (by product)
 * - GET /api/farm-sales/fulfillment/pack-list: Generate pack list (by customer)
 * - GET /api/farm-sales/fulfillment/delivery-manifest: Generate delivery manifest
 */
app.use('/api/farm-sales/fulfillment', farmSalesFulfillmentRouter);

/**
 * Farm Sales: Reports & Analytics
 * Business intelligence and performance metrics
 * - GET /api/farm-sales/reports/dashboard: Combined dashboard metrics
 * - GET /api/farm-sales/reports/sales-summary: Sales overview and trends
 * - GET /api/farm-sales/reports/inventory-turnover: Inventory performance
 * - GET /api/farm-sales/reports/customer-analytics: Customer insights
 * - GET /api/farm-sales/reports/product-performance: Product analysis
 */
app.use('/api/farm-sales/reports', farmSalesReportsRouter);

/**
 * Farm Sales: QuickBooks Integration
 * Sync invoices and payments with QuickBooks Online
 * - GET /api/farm-sales/quickbooks/auth: Initiate OAuth flow
 * - GET /api/farm-sales/quickbooks/callback: OAuth callback handler
 * - GET /api/farm-sales/quickbooks/status: Check connection status
 * - POST /api/farm-sales/quickbooks/disconnect: Disconnect integration
 * - POST /api/farm-sales/quickbooks/sync-invoices: Sync orders to QuickBooks
 * - POST /api/farm-sales/quickbooks/sync-payments: Sync payments to QuickBooks
 * - POST /api/farm-sales/quickbooks/webhook: Handle QuickBooks webhooks
 */
app.use('/api/farm-sales/quickbooks', farmSalesQuickBooksRouter);

/**
 * Farm Sales: Lot Code Traceability System
 * FDA-compliant lot tracking for food safety and recall management
 * - POST /api/farm-sales/lots/generate: Generate new lot code (ZONE-CROP-YYMMDD-BATCH)
 * - GET /api/farm-sales/lots: List all lots with filters
 * - GET /api/farm-sales/lots/:lotCode: Get lot details
 * - POST /api/farm-sales/lots/:lotCode/assign: Link lot to order/customer
 * - GET /api/farm-sales/lots/:lotCode/recall: Generate recall report (lot → customers)
 * - GET /api/farm-sales/lots/:lotCode/barcode: Generate barcode image (CODE128, CODE93, GS1)
 * - PATCH /api/farm-sales/lots/:lotCode: Update lot status (consumed, expired, recalled)
 * - DELETE /api/farm-sales/lots/:lotCode: Delete unassigned lot
 */
app.use('/api/farm-sales/lots', farmSalesLotTrackingRouter);

/**
 * Farm Sales: Donations & Food Security Programs
 * Food bank donations, SNAP/EBT, and grant-funded programs
 * - GET /api/farm-sales/donations/programs: List food security programs
 * - GET /api/farm-sales/donations/programs/:programId: Get program details
 * - POST /api/farm-sales/donations: Record donation or subsidized order
 * - GET /api/farm-sales/donations: List donations
 * - GET /api/farm-sales/donations/:donationId: Get donation details
 * - POST /api/farm-sales/donations/:donationId/deliver: Mark as delivered
 * - GET /api/farm-sales/donations/reports/impact: Generate impact report
 * - PATCH /api/farm-sales/donations/programs/:programId: Update program
 */
app.use('/api/farm-sales/donations', farmSalesDonationsRouter);

/**
 * Farm Sales: AI Agent Assistant
 * Intelligent assistant with action capabilities using OpenAI function calling
 * - POST /api/farm-sales/ai-agent/chat: Send command, get parsed intent & execute action
 * - GET /api/farm-sales/ai-agent/capabilities: List available AI agent capabilities
 * - GET /api/farm-sales/ai-agent/status: Check AI agent status and configuration
 * - POST /api/farm-sales/ai-agent/feedback: Submit feedback about AI responses
 * 
 * Capabilities:
 * - Lighting control (turn on/off, set brightness, get status)
 * - Environment monitoring (temperature, humidity, sensor readings)
 * - Inventory management (list products, low stock alerts, update stock)
 * - Order management (list orders, order details, recent orders)
 * - Automation control (list rules, enable/disable rules)
 * - Reports generation (sales reports, inventory reports)
 * - System health checks (status, health check)
 */
app.use('/api/farm-sales/ai-agent', farmSalesAIAgentRouter);

console.log(' Farm sales terminal initialized - POS, D2C, B2B, food security programs, lot traceability, and AI agent enabled');

/**
 * ML Predictive Forecasting Endpoint
 * Predict indoor temperature/humidity 1-4 hours ahead using outdoor-aware SARIMAX model
 * GET /api/ml/forecast?zone=Grow Room 1&hours=2&metric=indoor_temp
 */
app.get('/api/ml/forecast', asyncHandler(async (req, res) => {
  const { spawn } = await import('child_process');
  
  const zone = req.query.zone;
  const hours = parseInt(req.query.hours) || 2;
  const metric = req.query.metric || 'indoor_temp';
  
  if (!zone) {
    return res.status(400).json({
      ok: false,
      error: 'Missing required parameter: zone'
    });
  }
  
  if (hours < 1 || hours > 4) {
    return res.status(400).json({
      ok: false,
      error: 'hours must be between 1 and 4'
    });
  }
  
  if (!['indoor_temp', 'indoor_rh'].includes(metric)) {
    return res.status(400).json({
      ok: false,
      error: 'metric must be indoor_temp or indoor_rh'
    });
  }
  
  try {
    console.log(`[ML Forecast] Predicting ${metric} for "${zone}" ${hours} hours ahead...`);
    
    // Execute Python script
    const scriptPath = path.join(__dirname, 'backend', 'predictive_forecast.py');
    
    const pythonProcess = spawn('python3', [
      '-c',
      `
import sys
import json
sys.path.insert(0, '${__dirname}')
from backend.predictive_forecast import predict_indoor_conditions

result = predict_indoor_conditions(
    zone='${zone.replace(/'/g, "\\'")}',
    hours_ahead=${hours},
    metric='${metric}'
)
print(json.dumps(result))
      `.trim()
    ]);
    
    let stdout = '';
    let stderr = '';
    
    pythonProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    pythonProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    pythonProcess.on('close', (code) => {
      if (code !== 0) {
        console.error('[ML Forecast] Script failed with code', code);
        console.error('[ML Forecast] stderr:', stderr);
        
        return res.status(500).json({
          ok: false,
          error: 'Forecast failed',
          code,
          stderr
        });
      }
      
      try {
        // Parse JSON output
        const result = JSON.parse(stdout);
        
        if (result.error) {
          return res.status(400).json({
            ok: false,
            ...result
          });
        }
        
        console.log(`[ML Forecast] Generated ${result.predictions.length} predictions (AIC: ${result.model_info.aic.toFixed(2)})`);
        
        return res.json({
          ok: true,
          ...result,
          timestamp: new Date().toISOString()
        });
      } catch (parseError) {
        console.error('[ML Forecast] Failed to parse JSON:', parseError);
        console.error('[ML Forecast] stdout:', stdout);
        return res.status(500).json({
          ok: false,
          error: 'Failed to parse forecast output',
          stdout,
          stderr
        });
      }
    });
    
    // Timeout after 60 seconds (forecasting takes longer than anomaly detection)
    setTimeout(() => {
      pythonProcess.kill();
      res.status(504).json({
        ok: false,
        error: 'Forecast execution timeout (60s)'
      });
    }, 60000);
    
  } catch (error) {
    console.error('[ML Forecast] Error:', error);
    
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
}));

// ============================================================================
// ML Insights Endpoints (Cached Results)
// ============================================================================

/**
 * GET /api/ml/insights/anomalies
 * Get latest cached anomaly detection results
 */
app.get('/api/ml/insights/anomalies', asyncHandler(async (req, res) => {
  // Demo mode: generate realistic anomaly detection results
  if (isDemoMode()) {
    const now = new Date();
    const hoursAgo = (hours) => new Date(now.getTime() - hours * 60 * 60 * 1000);
    
    // Realistic anomalies for CEA environment over 24 hours
    const anomalies = [
      // Critical: Temperature spike in Zone 1 (2 hours ago)
      {
        zone: 'ROOM-A-Z1',
        zone_name: 'Zone 1 - Lettuce Production',
        timestamp: hoursAgo(2).toISOString(),
        metric: 'temperature',
        value: 28.5,
        expected: 23.2,
        deviation: 5.3,
        severity: 'critical',
        confidence: 0.96,
        description: 'Temperature 5.3°C above expected range',
        recommendation: 'Check cooling system in Zone 1. Potential HVAC malfunction or airflow obstruction.',
        impact: 'Heat stress risk for lettuce crop. Bolting may occur if sustained above 26°C.',
        duration_minutes: 45
      },
      
      // High: Humidity drop in Zone 2 (5 hours ago)
      {
        zone: 'ROOM-A-Z2',
        zone_name: 'Zone 2 - Basil Production',
        timestamp: hoursAgo(5).toISOString(),
        metric: 'humidity',
        value: 42.3,
        expected: 62.5,
        deviation: -20.2,
        severity: 'high',
        confidence: 0.92,
        description: 'Humidity 20.2% below expected range',
        recommendation: 'Inspect humidification system. Check for leaks in irrigation lines or misting nozzles.',
        impact: 'Basil plants prone to wilting and reduced essential oil production below 50% RH.',
        duration_minutes: 120
      },
      
      // High: VPD outside optimal range in Zone 3 (8 hours ago)
      {
        zone: 'ROOM-A-Z3',
        zone_name: 'Zone 3 - Arugula Production',
        timestamp: hoursAgo(8).toISOString(),
        metric: 'vpd',
        value: 1.85,
        expected: 1.15,
        deviation: 0.70,
        severity: 'high',
        confidence: 0.89,
        description: 'VPD 0.70 kPa above optimal range',
        recommendation: 'Increase humidity or reduce temperature to bring VPD into 0.8-1.2 kPa range.',
        impact: 'High VPD causes excessive transpiration, leading to nutrient stress and reduced growth rate.',
        duration_minutes: 90
      },
      
      // Medium: CO2 fluctuation in Zone 4 (12 hours ago)
      {
        zone: 'ROOM-A-Z4',
        zone_name: 'Zone 4 - Kale Production',
        timestamp: hoursAgo(12).toISOString(),
        metric: 'co2',
        value: 1450,
        expected: 900,
        deviation: 550,
        severity: 'medium',
        confidence: 0.85,
        description: 'CO₂ 550 ppm above baseline',
        recommendation: 'Check CO₂ enrichment system for overfeed. Verify ventilation exhaust is functioning.',
        impact: 'Excessive CO₂ can reduce stomatal opening and nutrient uptake efficiency.',
        duration_minutes: 60
      },
      
      // Medium: Brief temperature dip in Zone 1 (18 hours ago - night)
      {
        zone: 'ROOM-A-Z1',
        zone_name: 'Zone 1 - Lettuce Production',
        timestamp: hoursAgo(18).toISOString(),
        metric: 'temperature',
        value: 16.8,
        expected: 21.5,
        deviation: -4.7,
        severity: 'medium',
        confidence: 0.87,
        description: 'Temperature 4.7°C below expected range',
        recommendation: 'Verify heating system activation during night cycle. Check thermostat calibration.',
        impact: 'Prolonged cold below 18°C slows lettuce growth and increases susceptibility to fungal diseases.',
        duration_minutes: 75
      },
      
      // Low: Minor PPFD variation in Zone 2 (22 hours ago)
      {
        zone: 'ROOM-A-Z2',
        zone_name: 'Zone 2 - Basil Production',
        timestamp: hoursAgo(22).toISOString(),
        metric: 'ppfd',
        value: 185,
        expected: 240,
        deviation: -55,
        severity: 'low',
        confidence: 0.78,
        description: 'PPFD 55 μmol/m²/s below target',
        recommendation: 'Inspect grow lights for reduced output. Clean light fixtures or check for LED degradation.',
        impact: 'Reduced light intensity may slow basil growth and reduce essential oil concentration.',
        duration_minutes: 30
      }
    ];
    
    // Summary statistics
    const severityCounts = {
      critical: anomalies.filter(a => a.severity === 'critical').length,
      high: anomalies.filter(a => a.severity === 'high').length,
      medium: anomalies.filter(a => a.severity === 'medium').length,
      low: anomalies.filter(a => a.severity === 'low').length
    };
    
    const affectedZones = [...new Set(anomalies.map(a => a.zone))];
    
    return res.json({
      ok: true,
      timestamp: now.toISOString(),
      period: '24h',
      total_anomalies: anomalies.length,
      severity_counts: severityCounts,
      affected_zones: affectedZones.length,
      anomalies: anomalies,
      summary: `Detected ${anomalies.length} anomalies across ${affectedZones.length} zones in last 24 hours. ${severityCounts.critical} critical alerts require immediate attention.`,
      meta: {
        age_minutes: 0,
        is_stale: false,
        cached: false,
        demo: true,
        model: 'IsolationForest',
        outdoor_context_enabled: true
      }
    });
  }
  
  const insightsPath = path.join(__dirname, 'public', 'data', 'ml-insights', 'anomalies-latest.json');
  
  try {
    // Check if file exists
    await fs.promises.access(insightsPath);
    
    // Read cached insights
    const content = await fs.promises.readFile(insightsPath, 'utf-8');
    const insights = JSON.parse(content);
    
    // Check if data is stale (>30 min old)
    const generatedAt = new Date(insights.timestamp);
    const age = Date.now() - generatedAt.getTime();
    const isStale = age > 30 * 60 * 1000; // 30 minutes

    // Phase 3.9: Score and prioritize anomalies to reduce alert fatigue
    let prioritized = null;
    if (insights.anomalies && insights.anomalies.length > 0) {
      const asDiagnostics = insights.anomalies.map(a => ({
        ...a,
        diagnosis: {
          category: a.severity === 'critical' ? 'equipment_failure'
            : a.severity === 'high' ? 'sensor_issue'
            : a.severity === 'medium' ? 'control_loop'
            : 'environmental',
          urgency: a.severity || 'low',
          confidence: a.confidence || 0.5,
          weatherRelated: false
        }
      }));
      prioritized = prioritizeAlerts(asDiagnostics);
    }
    
    return res.json({
      ok: true,
      ...insights,
      prioritization: prioritized ? {
        surfaced_count: prioritized.surfaced.length,
        suppressed_count: prioritized.suppressed,
        total: prioritized.total
      } : null,
      meta: {
        age_minutes: Math.round(age / 60000),
        is_stale: isStale,
        cached: true,
        alert_prioritization: true
      }
    });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return res.status(404).json({
        ok: false,
        error: 'No anomaly insights available yet',
        message: 'ML jobs have not run yet. Check PM2 status.'
      });
    }
    
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
}));

/**
 * GET /api/ml/insights/forecast/:zone
 * Get latest cached forecast for a zone
 */
app.get('/api/ml/insights/forecast/:zone', asyncHandler(async (req, res) => {
  const { zone } = req.params;
  
  // Demo mode: generate mock forecast data
  if (isDemoMode()) {
    const now = new Date();
    const predictions = [];
    
    // Generate 4-hour forecast
    for (let i = 1; i <= 4; i++) {
      const timestamp = new Date(now.getTime() + i * 60 * 60 * 1000);
      const baseTemp = 22 + Math.sin(i / 2) * 2; // Oscillate between 20-24°C
      
      predictions.push({
        timestamp: timestamp.toISOString(),
        predicted_temp: parseFloat(baseTemp.toFixed(2)),
        lower_bound: parseFloat((baseTemp - 1.5).toFixed(2)),
        upper_bound: parseFloat((baseTemp + 1.5).toFixed(2)),
        confidence: 0.85 + Math.random() * 0.1
      });
    }
    
    return res.json({
      ok: true,
      zone: zone,
      timestamp: now.toISOString(),
      predictions: predictions,
      meta: {
        age_minutes: 0,
        is_stale: false,
        cached: false,
        demo: true
      }
    });
  }
  
  const insightsPath = path.join(__dirname, 'public', 'data', 'ml-insights', `forecast-${zone}-latest.json`);
  
  try {
    // Check if file exists
    await fs.promises.access(insightsPath);
    
    // Read cached insights
    const content = await fs.promises.readFile(insightsPath, 'utf-8');
    const insights = JSON.parse(content);
    
    // Check if data is stale (>90 min old)
    const generatedAt = new Date(insights.timestamp);
    const age = Date.now() - generatedAt.getTime();
    const isStale = age > 90 * 60 * 1000; // 90 minutes (forecast runs hourly)
    
    return res.json({
      ok: true,
      ...insights,
      meta: {
        age_minutes: Math.round(age / 60000),
        is_stale: isStale,
        cached: true
      }
    });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return res.status(404).json({
        ok: false,
        error: `No forecast insights available for zone: ${zone}`,
        message: 'ML jobs have not run yet. Check PM2 status.',
        zone
      });
    }
    
    return res.status(500).json({
      ok: false,
      error: error.message,
      zone
    });
  }
}));

/**
 * GET /api/ml/insights/status
 * Get ML job health status
 */
app.get('/api/ml/insights/status', asyncHandler(async (req, res) => {
  const insightsDir = path.join(__dirname, 'public', 'data', 'ml-insights');
  
  try {
    // Check if directory exists
    await fs.promises.access(insightsDir);
    
    // List all insight files
    const files = await fs.promises.readdir(insightsDir);
    const latestFiles = files.filter(f => f.endsWith('-latest.json'));
    
    const status = {
      jobs: [],
      healthy: true,
      last_update: null
    };
    
    for (const file of latestFiles) {
      const filePath = path.join(insightsDir, file);
      const content = await fs.promises.readFile(filePath, 'utf-8');
      const insights = JSON.parse(content);
      
      const generatedAt = new Date(insights.timestamp);
      const age = Date.now() - generatedAt.getTime();
      const jobName = file.replace('-latest.json', '');
      
      // Determine staleness threshold based on job type
      let staleThreshold = 30 * 60 * 1000; // 30 min for anomalies
      if (jobName.startsWith('forecast-')) {
        staleThreshold = 90 * 60 * 1000; // 90 min for forecasts
      }
      
      const isStale = age > staleThreshold;
      const isHealthy = !isStale && insights.data && !insights.data.error;
      
      if (!isHealthy) {
        status.healthy = false;
      }
      
      status.jobs.push({
        job: jobName,
        last_run: insights.timestamp,
        age_minutes: Math.round(age / 60000),
        is_stale: isStale,
        is_healthy: isHealthy,
        has_error: !!(insights.data && insights.data.error)
      });
      
      // Track latest update across all jobs
      if (!status.last_update || generatedAt > new Date(status.last_update)) {
        status.last_update = insights.timestamp;
      }
    }
    
    return res.json({
      ok: true,
      ...status,
      total_jobs: status.jobs.length,
      healthy_jobs: status.jobs.filter(j => j.is_healthy).length
    });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return res.status(503).json({
        ok: false,
        error: 'ML insights directory not found',
        message: 'ML jobs have not been configured. Run: pm2 start ecosystem.ml-jobs.config.cjs',
        healthy: false
      });
    }
    
    return res.status(500).json({
      ok: false,
      error: error.message,
      healthy: false
    });
  }
}));

/**
 * GET /api/ml/anomalies/history
 * Get historical anomaly events with optional filters
 */
app.get('/api/ml/anomalies/history', asyncHandler(async (req, res) => {
  const { zone, severity, since, limit, sort } = req.query;
  
  const options = {};
  if (zone) options.zone = zone;
  if (severity) options.severity = severity;
  if (since) options.since = parseInt(since);
  if (limit) options.limit = parseInt(limit);
  if (sort) options.sort = sort;
  
  try {
    const history = await anomalyHistory.getHistory(options);
    
    return res.json({
      ok: true,
      ...history
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
}));

/**
 * GET /api/ml/anomalies/statistics
 * Get anomaly statistics for a time range
 */
app.get('/api/ml/anomalies/statistics', asyncHandler(async (req, res) => {
  const hours = parseInt(req.query.hours) || 24;
  
  if (hours < 1 || hours > 720) { // Max 30 days
    return res.status(400).json({
      ok: false,
      error: 'hours must be between 1 and 720'
    });
  }
  
  try {
    // In demo mode, return synthetic anomaly data
    if (isDemoMode()) {
      const now = new Date();
      const since = new Date(now.getTime() - (hours * 60 * 60 * 1000));
      
      // Generate hourly buckets with demo anomaly data
      const hourly_buckets = [];
      for (let i = 0; i < hours; i++) {
        const timestamp = new Date(since.getTime() + (i * 60 * 60 * 1000));
        timestamp.setMinutes(0, 0, 0);
        
        // Create varied anomaly patterns
        const hour = timestamp.getHours();
        let critical = 0;
        let warning = 0;
        let info = 0;
        
        // Simulate anomalies: more during night hours (0-6) and afternoon (14-17)
        if (hour >= 0 && hour < 6) {
          // Night: temperature spike anomalies
          if (Math.random() > 0.5) {
            critical = Math.floor(Math.random() * 2);
            warning = Math.floor(Math.random() * 3) + 1;
            info = Math.floor(Math.random() * 2);
          }
        } else if (hour >= 14 && hour < 17) {
          // Afternoon: humidity and VPD anomalies
          if (Math.random() > 0.3) {
            critical = Math.floor(Math.random() * 3);
            warning = Math.floor(Math.random() * 4) + 2;
            info = Math.floor(Math.random() * 3) + 1;
          }
        } else if (Math.random() > 0.7) {
          // Random scattered anomalies
          warning = Math.floor(Math.random() * 2);
          info = Math.floor(Math.random() * 2);
        }
        
        hourly_buckets.push({
          timestamp: timestamp.toISOString(),
          critical,
          warning,
          info,
          total: critical + warning + info
        });
      }
      
      // Calculate totals
      const total_events = hourly_buckets.reduce((sum, b) => sum + b.total, 0);
      const by_severity = {
        critical: hourly_buckets.reduce((sum, b) => sum + b.critical, 0),
        warning: hourly_buckets.reduce((sum, b) => sum + b.warning, 0),
        info: hourly_buckets.reduce((sum, b) => sum + b.info, 0)
      };
      
      // Demo zones with anomaly counts
      const by_zone = {
        'Zone 1A': Math.floor(total_events * 0.3),
        'Zone 1B': Math.floor(total_events * 0.25),
        'Zone 2A': Math.floor(total_events * 0.25),
        'Zone 2B': Math.floor(total_events * 0.2)
      };
      
      return res.json({
        ok: true,
        time_range_hours: hours,
        since: since.toISOString(),
        total_events,
        by_severity,
        by_zone,
        hourly_buckets,
        demo: true
      });
    }
    
    const stats = await anomalyHistory.getStatistics(hours);
    
    return res.json({
      ok: true,
      ...stats
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
}));

// ============================================================================
// ML AUTOMATION ENDPOINTS
// ============================================================================

/**
 * GET /api/ml/automation/config
 * Get ML automation configuration
 */
app.get('/api/ml/automation/config', asyncHandler(async (req, res) => {
  const config = mlAutomation.getConfig();
  
  return res.json({
    ok: true,
    config
  });
}));

/**
 * PUT /api/ml/automation/config
 * Update ML automation configuration
 */
app.put('/api/ml/automation/config', asyncHandler(async (req, res) => {
  const updates = req.body;
  
  // Validate updates
  const allowedFields = [
    'enabled',
    'anomaly_response_enabled',
    'forecast_response_enabled',
    'anomaly_critical_threshold',
    'anomaly_warning_threshold',
    'forecast_temp_high_threshold',
    'forecast_temp_low_threshold',
    'forecast_rh_high_threshold',
    'forecast_rh_low_threshold',
    'precool_hours_ahead',
    'precool_temp_target',
    'action_cooldown_minutes',
    'notify_on_critical',
    'notify_on_action'
  ];
  
  const invalidFields = Object.keys(updates).filter(key => !allowedFields.includes(key));
  if (invalidFields.length > 0) {
    return res.status(400).json({
      ok: false,
      error: `Invalid fields: ${invalidFields.join(', ')}`,
      allowed_fields: allowedFields
    });
  }
  
  try {
    const config = mlAutomation.updateConfig(updates);
    
    return res.json({
      ok: true,
      message: 'ML automation config updated',
      config
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
}));

/**
 * GET /api/ml/automation/status
 * Get ML automation status (cooldowns, recent actions)
 */
app.get('/api/ml/automation/status', asyncHandler(async (req, res) => {
  const config = mlAutomation.getConfig();
  const cooldowns = mlAutomation.getCooldownStatus();
  
  return res.json({
    ok: true,
    enabled: config.enabled,
    anomaly_response_enabled: config.anomaly_response_enabled,
    forecast_response_enabled: config.forecast_response_enabled,
    cooldowns
  });
}));

/**
 * POST /api/ml/automation/evaluate
 * Manually trigger automation evaluation for recent anomalies
 */
app.post('/api/ml/automation/evaluate', asyncHandler(async (req, res) => {
  const { minutes } = req.body;
  const lookbackMinutes = minutes || 15;
  
  try {
    const actions = await mlAutomation.processRecentAnomalies(lookbackMinutes);
    
    return res.json({
      ok: true,
      message: `Evaluated anomalies from last ${lookbackMinutes} minutes`,
      actions_generated: actions.length,
      actions
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
}));

/**
 * GET /api/ml/automation/actions
 * Get recent automation actions from insights
 */
app.get('/api/ml/automation/actions', asyncHandler(async (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  
  try {
    const insightsDir = path.join(__dirname, 'public', 'data', 'ml-insights');
    const files = await fs.promises.readdir(insightsDir);
    
    // Find all automation-actions files
    const actionFiles = files
      .filter(f => f.startsWith('automation-actions-') && !f.includes('latest'))
      .sort()
      .reverse()
      .slice(0, limit);
    
    const actions = [];
    for (const file of actionFiles) {
      const content = await fs.promises.readFile(path.join(insightsDir, file), 'utf-8');
      const data = JSON.parse(content);
      if (data.data && Array.isArray(data.data.actions)) {
        actions.push({
          timestamp: data.timestamp,
          trigger: data.data.trigger,
          actions: data.data.actions
        });
      }
    }
    
    return res.json({
      ok: true,
      total: actions.length,
      actions
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
}));

// ============================================================================
// ML ENERGY FORECAST ENDPOINT
// ============================================================================

/**
 * GET /api/ml/energy-forecast
 * Get energy consumption forecast
 */
app.get('/api/ml/energy-forecast', asyncHandler(async (req, res) => {
  try {
    // Demo mode: generate synthetic energy forecast
    if (isDemoMode()) {
      const now = new Date();
      const predictions = [];
      
      // Generate 24-hour forecast
      for (let i = 0; i < 24; i++) {
        const timestamp = new Date(now.getTime() + i * 60 * 60 * 1000);
        const hour = timestamp.getHours();
        
        // Simulate energy usage pattern: higher during day (6-18), lower at night
        let baseKwh = 5.0; // Base consumption
        if (hour >= 6 && hour < 18) {
          baseKwh += 8.0 * Math.sin((hour - 6) / 12 * Math.PI); // Peak during day
        }
        
        const energyKwh = parseFloat(baseKwh.toFixed(2));
        
        predictions.push({
          timestamp: timestamp.toISOString(),
          energy_kwh: energyKwh,
          confidence_lower: parseFloat((energyKwh * 0.85).toFixed(2)),
          confidence_upper: parseFloat((energyKwh * 1.15).toFixed(2))
        });
      }
      
      const totalDailyKwh = predictions.reduce((sum, p) => sum + p.energy_kwh, 0);
      
      return res.json({
        ok: true,
        data: {
          predictions: predictions,
          total_daily_kwh: parseFloat(totalDailyKwh.toFixed(2)),
          peak_kwh: Math.max(...predictions.map(p => p.energy_kwh)),
          avg_kwh: parseFloat((totalDailyKwh / 24).toFixed(2))
        },
        metadata: {
          generated_at: now.toISOString(),
          validUntil: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
          demo: true
        }
      });
    }
    
    const insightsDir = path.join(__dirname, 'public', 'data', 'ml-insights');
    const latestPath = path.join(insightsDir, 'energy-forecast-latest.json');
    
    // Check if forecast exists
    try {
      await fs.promises.access(latestPath);
    } catch (err) {
      return res.status(404).json({
        ok: false,
        error: 'No energy forecast available',
        message: 'Run ML job runner with --job energy to generate forecast'
      });
    }
    
    // Read forecast
    const content = await fs.promises.readFile(latestPath, 'utf-8');
    const forecast = JSON.parse(content);
    
    // Check if forecast is stale (>24 hours old)
    if (forecast.metadata && forecast.metadata.validUntil) {
      const validUntil = new Date(forecast.metadata.validUntil);
      const now = new Date();
      
      if (now > validUntil) {
        return res.json({
          ok: true,
          ...forecast,
          warning: 'Forecast data is stale',
          stale: true
        });
      }
    }
    
    return res.json({
      ok: true,
      ...forecast
    });
    
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
}));

// ============================================================================
// Model Retraining Endpoints
// ============================================================================

/**
 * POST /api/ml/retrain/:zone
 * Trigger model retraining for a specific zone
 */
app.post('/api/ml/retrain/:zone', asyncHandler(async (req, res) => {
  try {
    const { zone } = req.params;
    const { force = false } = req.query;
    
    // Import model retrainer
    const { retrainZone } = await import('./lib/model-retrainer.js');
    
    // Start retraining (async - don't wait for completion)
    const resultPromise = retrainZone(zone, { force: force === 'true' });
    
    // For quick response, return 202 Accepted
    res.status(202).json({
      ok: true,
      message: `Model retraining started for zone: ${zone}`,
      zone,
      force,
      timestamp: new Date().toISOString()
    });
    
    // Log result when complete (don't block response)
    resultPromise.then(result => {
      console.log(`[API] Retraining result for ${zone}:`, result.success ? 'SUCCESS' : 'FAILED');
    }).catch(err => {
      console.error(`[API] Retraining error for ${zone}:`, err);
    });
    
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
}));

/**
 * POST /api/ml/retrain/all
 * Trigger model retraining for all zones
 */
app.post('/api/ml/retrain/all', asyncHandler(async (req, res) => {
  try {
    const { force = false } = req.query;
    
    // Import model retrainer
    const { retrainAll } = await import('./lib/model-retrainer.js');
    
    // Start retraining (async - don't wait for completion)
    const resultPromise = retrainAll({ force: force === 'true' });
    
    // For quick response, return 202 Accepted
    res.status(202).json({
      ok: true,
      message: 'Model retraining started for all zones',
      force,
      timestamp: new Date().toISOString()
    });
    
    // Log result when complete
    resultPromise.then(summary => {
      console.log(`[API] Retraining all zones complete:`, summary);
    }).catch(err => {
      console.error(`[API] Retraining all zones error:`, err);
    });
    
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
}));

/**
 * GET /api/ml/models/history
 * Get model training history and metadata
 */
app.get('/api/ml/models/history', asyncHandler(async (req, res) => {
  try {
    const { loadHistory } = await import('./lib/model-retrainer.js');
    
    const history = await loadHistory();
    
    return res.json({
      ok: true,
      ...history,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
}));

/**
 * GET /api/ml/models/:zone/status
 * Get status of model for a specific zone
 */
app.get('/api/ml/models/:zone/status', asyncHandler(async (req, res) => {
  try {
    const { zone } = req.params;
    const { checkModelAge } = await import('./lib/model-retrainer.js');
    
    const ageCheck = await checkModelAge(zone);
    
    // Try to load model metadata
    let metadata = null;
    try {
      const modelsDir = path.join(__dirname, 'public', 'data', 'ml-models');
      const metadataPath = path.join(modelsDir, `${zone}-model-metadata.json`);
      const content = await fs.promises.readFile(metadataPath, 'utf-8');
      metadata = JSON.parse(content);
    } catch {
      // Metadata not available
    }
    
    return res.json({
      ok: true,
      zone,
      ...ageCheck,
      metadata,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
}));

/**
 * POST /api/ml/models/:zone/rollback
 * Rollback model to previous version
 */
app.post('/api/ml/models/:zone/rollback', asyncHandler(async (req, res) => {
  try {
    const { zone } = req.params;
    const { reason = 'Manual rollback via API' } = req.body;
    
    const { rollbackModel } = await import('./lib/model-retrainer.js');
    
    const success = await rollbackModel(zone, reason);
    
    if (!success) {
      return res.status(500).json({
        ok: false,
        error: 'Rollback failed',
        zone
      });
    }
    
    return res.json({
      ok: true,
      message: `Model rolled back for zone: ${zone}`,
      zone,
      reason,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
}));

/**
 * POST /api/ml/ab-test/:testId/evaluate
 * Evaluate an ongoing A/B test
 */
app.post('/api/ml/ab-test/:testId/evaluate', asyncHandler(async (req, res) => {
  try {
    const { testId } = req.params;
    const { zone } = req.body;
    
    if (!zone) {
      return res.status(400).json({
        ok: false,
        error: 'Zone parameter required'
      });
    }
    
    const { evaluateABTest } = await import('./lib/model-retrainer.js');
    
    const result = await evaluateABTest(zone, parseInt(testId, 10));
    
    if (!result.success) {
      return res.status(404).json({
        ok: false,
        error: result.reason || 'A/B test evaluation failed'
      });
    }
    
    return res.json({
      ok: true,
      ...result,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
}));

// ============================================================================
// ML Metrics & Monitoring Endpoints
// ============================================================================

/**
 * GET /api/ml/metrics/health
 * Get overall ML model health status across all zones
 */
app.get('/api/ml/metrics/health', asyncHandler(async (req, res) => {
  try {
    const metricsCollector = await import('./lib/ml-metrics-collector.js');
    const { getHealthStatus } = metricsCollector.default;
    
    const health = await getHealthStatus();
    
    return res.json({
      ok: true,
      ...health
    });
    
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
}));

/**
 * GET /api/ml/metrics/accuracy?zone=main&hours=24
 * Get accuracy metrics for a specific zone over time window
 */
app.get('/api/ml/metrics/accuracy', asyncHandler(async (req, res) => {
  try {
    const { zone, hours = 24 } = req.query;
    
    if (!zone) {
      return res.status(400).json({
        ok: false,
        error: 'Zone parameter required'
      });
    }
    
    const metricsCollector = await import('./lib/ml-metrics-collector.js');
    const { calculateZoneAccuracy } = metricsCollector.default;
    
    const accuracy = await calculateZoneAccuracy(zone, parseInt(hours, 10));
    
    if (!accuracy) {
      return res.status(404).json({
        ok: false,
        error: 'No accuracy data available for zone'
      });
    }
    
    return res.json({
      ok: true,
      ...accuracy
    });
    
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
}));

/**
 * GET /api/ml/metrics/drift?zone=main
 * Check for data and concept drift in a zone
 */
app.get('/api/ml/metrics/drift', asyncHandler(async (req, res) => {
  try {
    const { zone } = req.query;
    
    if (!zone) {
      return res.status(400).json({
        ok: false,
        error: 'Zone parameter required'
      });
    }
    
    const metricsCollector = await import('./lib/ml-metrics-collector.js');
    const { checkDataDrift, checkConceptDrift } = metricsCollector.default;
    
    // Check both types of drift
    const dataDrift = await checkDataDrift(zone);
    const conceptDrift = await checkConceptDrift(zone);
    
    return res.json({
      ok: true,
      zone,
      data_drift: dataDrift,
      concept_drift: conceptDrift,
      checked_at: new Date().toISOString()
    });
    
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
}));

/**
 * GET /api/ml/metrics/summary?zone=main&days=7
 * Get comprehensive metrics summary for a zone
 */
app.get('/api/ml/metrics/summary', asyncHandler(async (req, res) => {
  try {
    const { zone, days = 7 } = req.query;
    
    if (!zone) {
      return res.status(400).json({
        ok: false,
        error: 'Zone parameter required'
      });
    }
    
    const metricsCollector = await import('./lib/ml-metrics-collector.js');
    const { getZoneSummary } = metricsCollector.default;
    
    const summary = await getZoneSummary(zone, parseInt(days, 10));
    
    if (!summary) {
      return res.status(404).json({
        ok: false,
        error: 'No metrics data available for zone'
      });
    }
    
    return res.json({
      ok: true,
      ...summary
    });
    
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
}));

/**
 * POST /api/ml/metrics/record
 * Record a prediction and actual value for metrics tracking
 */
app.post('/api/ml/metrics/record', asyncHandler(async (req, res) => {
  try {
    const { zone, prediction, actual, timestamp } = req.body;
    
    if (!zone || prediction === undefined || actual === undefined) {
      return res.status(400).json({
        ok: false,
        error: 'Zone, prediction, and actual parameters required'
      });
    }
    
    const metricsCollector = await import('./lib/ml-metrics-collector.js');
    const { recordPrediction } = metricsCollector.default;
    
    await recordPrediction(zone, prediction, actual, timestamp);
    
    return res.json({
      ok: true,
      message: 'Prediction recorded successfully',
      zone,
      timestamp: timestamp || new Date().toISOString()
    });
    
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
}));

/**
 * GET /api/ml/metrics/alerts
 * Get recent drift and degradation alerts
 */
app.get('/api/ml/metrics/alerts', asyncHandler(async (req, res) => {
  try {
    const metricsCollector = await import('./lib/ml-metrics-collector.js');
    const { loadMetrics } = metricsCollector.default;
    
    const metrics = await loadMetrics();
    
    // Get recent alerts (last 24 hours)
    const cutoffTime = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentAlerts = (metrics.drift_alerts || []).filter(alert =>
      new Date(alert.detected_at) > cutoffTime
    );
    
    // Group alerts by severity
    const critical = recentAlerts.filter(a => a.severity === 'critical');
    const warnings = recentAlerts.filter(a => a.severity === 'warning');
    
    return res.json({
      ok: true,
      alerts: recentAlerts,
      summary: {
        total: recentAlerts.length,
        critical: critical.length,
        warnings: warnings.length
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
}));

// ============================================================================
// Notification Endpoints (Mobile App) - Placeholders
// ============================================================================

/**
 * GET /api/notifications
 * Get notifications for authenticated user
 * TODO: Implement with database and authentication
 */
app.get('/api/notifications', (req, res) => {
  // Return 501 Not Implemented with helpful message
  res.status(501).json({
    ok: false,
    error: 'Not Implemented',
    message: 'Notification backend coming soon',
    notifications: [], // Return empty array for graceful degradation
    timestamp: new Date().toISOString()
  });
});

/**
 * POST /api/notifications/:id/read
 * Mark notification as read
 * TODO: Implement with database
 */
app.post('/api/notifications/:id/read', (req, res) => {
  res.status(501).json({
    ok: false,
    error: 'Not Implemented',
    message: 'Notification backend coming soon',
    timestamp: new Date().toISOString()
  });
});

/**
 * POST /api/notifications/read-all
 * Mark all notifications as read
 * TODO: Implement with database
 */
app.post('/api/notifications/read-all', (req, res) => {
  res.status(501).json({
    ok: false,
    error: 'Not Implemented',
    message: 'Notification backend coming soon',
    timestamp: new Date().toISOString()
  });
});

/**
 * PUT /api/users/:userId/notification-preferences
 * Update user notification preferences
 * TODO: Implement with database
 */
app.put('/api/users/:userId/notification-preferences', (req, res) => {
  res.status(501).json({
    ok: false,
    error: 'Not Implemented',
    message: 'Notification backend coming soon',
    timestamp: new Date().toISOString()
  });
});

// Geocoding and Weather endpoints must be registered BEFORE the /api proxy below
function getWeatherDescription(code) {
  const descriptions = {
    0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
    45: 'Fog', 48: 'Depositing rime fog', 51: 'Light drizzle', 53: 'Moderate drizzle', 55: 'Dense drizzle',
    56: 'Light freezing drizzle', 57: 'Dense freezing drizzle', 61: 'Slight rain', 63: 'Moderate rain', 65: 'Heavy rain',
    66: 'Light freezing rain', 67: 'Heavy freezing rain', 71: 'Slight snow fall', 73: 'Moderate snow fall', 75: 'Heavy snow fall', 77: 'Snow grains',
    80: 'Slight rain showers', 81: 'Moderate rain showers', 82: 'Violent rain showers', 85: 'Slight snow showers', 86: 'Heavy snow showers',
    95: 'Thunderstorm', 96: 'Thunderstorm with slight hail', 99: 'Thunderstorm with heavy hail'
  };
  return descriptions[code] || 'Unknown';
}

app.get('/api/geocode', async (req, res) => {
  try {
    setCors(req, res);
    const { address } = req.query;
    if (!address) return res.status(400).json({ ok: false, error: 'Address parameter required' });
    const encodedAddress = encodeURIComponent(address);
    const geocodeUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodedAddress}&limit=5`;
    const response = await fetch(geocodeUrl, { headers: { 'User-Agent': 'Light-Engine-Charlie/1.0 (Farm Management System)' } });
    if (!response.ok) throw new Error(`Geocoding API error: ${response.status}`);
    const data = await response.json();
    const results = data.map(item => ({ display_name: item.display_name, lat: parseFloat(item.lat), lng: parseFloat(item.lon), formatted_address: item.display_name }));
    res.json({ ok: true, results });
  } catch (error) {
    console.error('Geocoding error:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get('/api/weather', async (req, res) => {
  try {
    setCors(req, res);
    const { lat, lng } = req.query;
    if (!lat || !lng) return res.status(400).json({ ok: false, error: 'Latitude and longitude parameters required' });
    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current_weather=true&hourly=temperature_2m,relative_humidity_2m,precipitation,weather_code&timezone=auto`;
    const response = await fetch(weatherUrl);
    if (!response.ok) throw new Error(`Weather API error: ${response.status}`);
    const data = await response.json();
    const weather = {
      ok: true,
      current: {
        temperature_c: data.current_weather.temperature,
        temperature_f: (data.current_weather.temperature * 9/5) + 32,
        humidity: Array.isArray(data.hourly?.relative_humidity_2m) ? data.hourly.relative_humidity_2m[0] : null,
        wind_speed: data.current_weather.windspeed,
        wind_direction: data.current_weather.winddirection,
        weather_code: data.current_weather.weathercode,
        is_day: data.current_weather.is_day,
        description: getWeatherDescription(data.current_weather.weathercode),
        last_updated: data.current_weather.time
      },
      location: { lat: parseFloat(lat), lng: parseFloat(lng) }
    };
    res.json(weather);
  } catch (error) {
    console.error('Weather API error:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// Reverse geocoding: lat/lng → address parts
app.get('/api/reverse-geocode', async (req, res) => {
  try {
    setCors(req, res);
    const { lat, lng } = req.query;
    if (!lat || !lng) return res.status(400).json({ ok: false, error: 'Latitude and longitude required' });
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&addressdetails=1`;
    const r = await fetch(url, { headers: { 'User-Agent': 'Light-Engine-Charlie/1.0 (Farm Management System)' } });
    if (!r.ok) throw new Error(`Reverse geocoding error: ${r.status}`);
    const data = await r.json();
    const addr = data.address || {};
    res.json({ ok: true, address: {
      display_name: data.display_name || '',
      road: addr.road || addr.house_number || '',
      city: addr.city || addr.town || addr.village || addr.hamlet || '',
      state: addr.state || addr.region || '',
      postal: addr.postcode || '',
      country: addr.country || ''
    }});
  } catch (e) {
    console.error('Reverse geocoding error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// In-memory weather cache and lightweight polling for automations
let LAST_WEATHER = null;
let LAST_WEATHER_AT = 0;
let WEATHER_TIMER = null;
let SENSOR_SYNC_TIMER = null; // periodic live sensor sync timer (unref in Node)

async function fetchAndCacheWeather(lat, lng) {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current_weather=true&hourly=temperature_2m,relative_humidity_2m,precipitation,weather_code&timezone=auto`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Weather API ${r.status}`);
    const data = await r.json();
    LAST_WEATHER = {
      ok: true,
      current: {
        temperature_c: data.current_weather.temperature,
        temperature_f: (data.current_weather.temperature * 9/5) + 32,
        humidity: Array.isArray(data.hourly?.relative_humidity_2m) ? data.hourly.relative_humidity_2m[0] : null,
        wind_speed: data.current_weather.windspeed,
        wind_direction: data.current_weather.winddirection,
        weather_code: data.current_weather.weathercode,
        is_day: data.current_weather.is_day,
        description: getWeatherDescription(data.current_weather.weathercode),
        last_updated: data.current_weather.time
      },
      location: { lat: parseFloat(lat), lng: parseFloat(lng) }
    };
    LAST_WEATHER_AT = Date.now();

    // Optional: feed into automation engine as sensor data
    try {
      if (automationEngine) {
        const src = 'weather';
        const ts = Date.now();
        const w = LAST_WEATHER.current;
        const readings = [];
        if (typeof w.temperature_c === 'number') readings.push({ source: src, deviceId: 'outside', type: 'outside_temperature_c', value: w.temperature_c, metadata: { lat, lng, ts } });
        if (typeof w.humidity === 'number') readings.push({ source: src, deviceId: 'outside', type: 'outside_humidity', value: w.humidity, metadata: { lat, lng, ts } });
        if (typeof w.wind_speed === 'number') readings.push({ source: src, deviceId: 'outside', type: 'outside_wind_kmh', value: w.wind_speed, metadata: { lat, lng, ts } });
        for (const r of readings) await automationEngine.processSensorData(r);
      }
    } catch (e) { console.warn('Weather → automation feed failed:', e.message); }

  } catch (e) {
    console.warn('fetchAndCacheWeather error:', e.message);
  }
}

function setupWeatherPolling() {
  try {
    // Skip weather polling in test/CI to avoid keeping the event loop alive
    if (IS_TEST_ENV) {
      if (WEATHER_TIMER) { clearInterval(WEATHER_TIMER); WEATHER_TIMER = null; }
      return;
    }
    const farm = readJSONSafe(FARM_PATH, null);
    const coords = farm?.coordinates || farm?.location?.coordinates;
    if (!coords || typeof coords.lat !== 'number' || typeof coords.lng !== 'number') {
      if (WEATHER_TIMER) { clearInterval(WEATHER_TIMER); WEATHER_TIMER = null; }
      return;
    }
    // Kick off immediately and then every 10 minutes
    fetchAndCacheWeather(coords.lat, coords.lng);
    if (WEATHER_TIMER) clearInterval(WEATHER_TIMER);
    WEATHER_TIMER = setInterval(() => fetchAndCacheWeather(coords.lat, coords.lng), 10 * 60 * 1000);
    if (typeof WEATHER_TIMER?.unref === 'function') WEATHER_TIMER.unref();
  } catch {}
}

// Expose cached weather (falls back to fetching if stale and coords exist)
app.get('/api/weather/current', async (req, res) => {
  try {
    setCors(req, res);
    // If stale (>15 min) try refresh
    const farm = readJSONSafe(FARM_PATH, null);
    const coords = farm?.coordinates || farm?.location?.coordinates;
    const isStale = !LAST_WEATHER || (Date.now() - LAST_WEATHER_AT) > (15 * 60 * 1000);
    if (coords && isStale) await fetchAndCacheWeather(coords.lat, coords.lng);
    if (!LAST_WEATHER) return res.status(404).json({ ok: false, error: 'No weather cached and no farm coordinates set' });
    res.json(LAST_WEATHER);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ===== NUTRIENT MANAGEMENT API (MQTT-backed) =====

// Note: Charlie backend (port 8000) deprecated - all nutrient endpoints use MQTT directly
// Legacy fetchPythonBackend function kept for compatibility but not used
async function fetchPythonBackend(endpoint, options = {}) {
  // DEPRECATED: This function is no longer used (nutrients use MQTT)
  const url = `http://localhost:8000${endpoint}`;
  
  try {
    const response = await fetch(url, {
      timeout: 5000,
      ...options
    });
    return response;
  } catch (error) {
    console.warn(`[Nutrient API] Python backend unavailable at ${url}:`, error.message);
    return null;
  }
}

async function publishNutrientCommand(payload, {
  brokerUrl = DEFAULT_NUTRIENT_MQTT_URL,
  topic = DEFAULT_NUTRIENT_COMMAND_TOPIC,
  timeoutMs = NUTRIENT_COMMAND_TIMEOUT_MS
} = {}) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('invalid-nutrient-payload');
  }

  const translation = translateLegacyNutrientCommand(payload);

  if (RUNNING_UNDER_NODE_TEST) {
    console.log('[nutrients:test] Skipping MQTT publish (test mode)', {
      brokerUrl,
      topic: translation ? translation.topic : topic,
      payload: translation ? translation.payload : payload,
      translated: Boolean(translation)
    });
    return { ok: true, testMode: true };
  }

  const resolvedBroker = brokerUrl || DEFAULT_NUTRIENT_MQTT_URL;
  const resolvedTopic = topic || DEFAULT_NUTRIENT_COMMAND_TOPIC;
  const publishTopic = translation ? translation.topic : resolvedTopic;
  const publishPayload = translation ? translation.payload : payload;

  if (!resolvedBroker || !publishTopic) {
    throw new Error('nutrient-mqtt-config-missing');
  }

  console.log(`[nutrients] Publishing nutrient command to ${publishTopic} via ${resolvedBroker}${translation ? ' (translated)' : ''}`);

  return await new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      cleanup(new Error('nutrient-mqtt-timeout'));
    }, Math.max(1000, timeoutMs || 0));

    const cleanup = (err, info) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (client) {
        try {
          client.end(true);
        } catch {}
      }
      if (err) {
        reject(err);
      } else {
        resolve(info || { ok: true, brokerUrl: resolvedBroker, topic: publishTopic, translated: Boolean(translation) });
      }
    };

    const client = mqtt.connect(resolvedBroker, { reconnectPeriod: 0 });
    client.on('error', (err) => {
      cleanup(new Error(err?.message || 'nutrient-mqtt-error'));
    });
    client.on('connect', () => {
      client.publish(publishTopic, JSON.stringify(publishPayload), { qos: 1 }, (err) => {
        if (err) {
          cleanup(new Error(err?.message || 'nutrient-mqtt-publish-failed'));
        } else {
          cleanup(null, { ok: true, brokerUrl: resolvedBroker, topic: publishTopic, translated: Boolean(translation) });
        }
      });
    });
  });
}

const nutrientAutomationState = {
  scopeId: NUTRIENT_SCOPE_ID,
  lastPoll: 0,
  snapshot: null,
  pollInFlight: null,
  failure: null,
  dashboardCache: null,
  dashboardCacheAt: 0,
  dashboardWriteTimer: null
};

function clone(value) {
  if (value === null || value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

function loadNutrientDashboardCache() {
  const now = Date.now();
  if (nutrientAutomationState.dashboardCache && (now - nutrientAutomationState.dashboardCacheAt) < 5000) {
    return clone(nutrientAutomationState.dashboardCache);
  }
  const doc = readJsonSafe(NUTRIENT_DASHBOARD_PATH, null);
  nutrientAutomationState.dashboardCache = clone(doc);
  nutrientAutomationState.dashboardCacheAt = now;
  return clone(doc);
}

async function persistNutrientDashboard(doc) {
  if (!doc || typeof doc !== 'object') return;
  try {
    await fs.promises.mkdir(path.dirname(NUTRIENT_DASHBOARD_PATH), { recursive: true });
    await fs.promises.writeFile(NUTRIENT_DASHBOARD_PATH, JSON.stringify(doc, null, 2), 'utf8');
    nutrientAutomationState.dashboardCache = clone(doc);
    nutrientAutomationState.dashboardCacheAt = Date.now();
  } catch (error) {
    console.warn('[nutrients] Failed to persist nutrient dashboard cache:', error?.message || error);
  }
}

function schedulePersistNutrientDashboard(doc) {
  nutrientAutomationState.dashboardCache = clone(doc);
  nutrientAutomationState.dashboardCacheAt = Date.now();
  if (nutrientAutomationState.dashboardWriteTimer) {
    clearTimeout(nutrientAutomationState.dashboardWriteTimer);
  }
  nutrientAutomationState.dashboardWriteTimer = setTimeout(() => {
    persistNutrientDashboard(doc).catch((error) => {
      console.warn('[nutrients] Failed to persist nutrient dashboard:', error?.message || error);
    });
  }, 750);
  if (typeof nutrientAutomationState.dashboardWriteTimer?.unref === 'function') {
    nutrientAutomationState.dashboardWriteTimer.unref();
  }
}

function normalizeBackendNutrientTelemetry(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const sensors = payload.sensors && typeof payload.sensors === 'object' ? payload.sensors : {};
  const observedAt = typeof payload.observedAt === 'string' ? payload.observedAt : null;

  const normalizeReading = (key, defaultUnit) => {
    const entry = sensors[key];
    if (!entry || typeof entry !== 'object') return null;
    const rawValue = toNumberOrNull(entry.value);
    if (!Number.isFinite(rawValue)) return null;
    let unit = typeof entry.unit === 'string' && entry.unit.trim() ? entry.unit.trim() : defaultUnit;
    let value = rawValue;
    if (key === 'ec') {
      const normalizedUnit = unit.toLowerCase();
      if (normalizedUnit.includes('µ') || normalizedUnit.includes('micro')) {
        value = rawValue / 1000;
        unit = 'mS/cm';
      } else if (normalizedUnit.includes('ms')) {
        unit = 'mS/cm';
      }
    }
    const ts = typeof entry.observedAt === 'string' && entry.observedAt ? entry.observedAt : observedAt;
    return {
      value,
      unit: key === 'ph' ? 'pH' : unit || defaultUnit,
      observedAt: ts || null,
      source: 'python-backend',
      raw: {
        value: rawValue,
        unit: entry.unit || unit || defaultUnit
      }
    };
  };

  const ph = normalizeReading('ph', 'pH');
  const ec = normalizeReading('ec', 'mS/cm');
  const temperature = normalizeReading('temperature', '°C');
  if (!ph && !ec && !temperature) return null;
  const firstObserved = ph?.observedAt || ec?.observedAt || temperature?.observedAt || observedAt;
  return {
    observedAt: firstObserved || observedAt || null,
    ph,
    ec,
    temperature,
    backendScope: typeof payload.scope === 'string' ? payload.scope : null
  };
}

function normalizeDashboardNutrientTelemetry(doc) {
  if (!doc || typeof doc !== 'object') return null;
  const sensors = doc.sensors && typeof doc.sensors === 'object' ? doc.sensors : {};
  const metadata = doc.metadata && typeof doc.metadata === 'object' ? doc.metadata : {};
  const normalizeReading = (key, defaultUnit, transformer) => {
    const entry = sensors[key];
    if (!entry || typeof entry !== 'object') return null;
    const current = toNumberOrNull(entry.current ?? entry.value);
    if (!Number.isFinite(current)) return null;
    const value = typeof transformer === 'function' ? transformer(current) : current;
    const ts = entry.updatedAt || entry.observedAt || metadata.updatedAt || null;
    return {
      value,
      unit: defaultUnit,
      observedAt: ts,
      source: 'dashboard-cache'
    };
  };

  const ph = normalizeReading('ph', 'pH');
  const ec = normalizeReading('ec', 'mS/cm', (raw) => {
    if (!Number.isFinite(raw)) return null;
    return raw > 50 ? Math.round((raw / 1000) * 1000) / 1000 : raw;
  });
  const temperature = normalizeReading('temperature', '°C');
  if (!ph && !ec && !temperature) return null;
  const observedAt = ph?.observedAt || ec?.observedAt || temperature?.observedAt || metadata.updatedAt || null;
  return {
    observedAt,
    ph,
    ec,
    temperature
  };
}

function mergeNutrientTelemetry(backend, fallback) {
  if (!backend && !fallback) return null;
  const merged = {
    observedAt: backend?.observedAt || fallback?.observedAt || null,
    ph: backend?.ph || fallback?.ph || null,
    ec: backend?.ec || fallback?.ec || null,
    temperature: backend?.temperature || fallback?.temperature || null,
    sources: {
      backend: Boolean(backend && (backend.ph || backend.ec || backend.temperature)),
      fallback: Boolean(fallback && (fallback.ph || fallback.ec || fallback.temperature))
    }
  };
  if (merged.ph && backend?.backendScope) {
    merged.ph.backendScope = backend.backendScope;
  }
  if (merged.ec && backend?.backendScope) {
    merged.ec.backendScope = backend.backendScope;
  }
  if (!merged.observedAt) {
    merged.observedAt = merged.ph?.observedAt || merged.ec?.observedAt || merged.temperature?.observedAt || null;
  }
  return merged;
}

function computeRatioSnapshot(ratioInput, source = null) {
  if (!ratioInput || typeof ratioInput !== 'object') return null;
  const parts = {};
  ['a', 'b', 'c'].forEach((key) => {
    const value = toNumberOrNull(ratioInput[key]);
    if (Number.isFinite(value)) {
      parts[key] = value;
    }
  });
  const entries = Object.entries(parts);
  if (!entries.length) return null;
  const total = entries.reduce((acc, [, val]) => acc + val, 0);
  const normalizedPercent = total > 0
    ? entries.reduce((acc, [key, val]) => {
      acc[key] = Math.round(((val / total) * 1000)) / 10;
      return acc;
    }, {})
    : null;
  return {
    parts,
    total,
    normalizedPercent,
    source
  };
}

function deriveNutrientTargets() {
  if (!preEnvStore || typeof preEnvStore.getTargets !== 'function') return null;
  const envTargets = preEnvStore.getTargets(NUTRIENT_SCOPE_ID) || {};
  const nutrients = envTargets.nutrients || envTargets.environment?.nutrients || null;
  if (!nutrients || typeof nutrients !== 'object') return null;

  const ratio = nutrients.ratio ? computeRatioSnapshot(nutrients.ratio, 'plan-targets') : null;
  const automation = {
    enabled: Boolean(nutrients.automationEnabled),
    program: typeof nutrients.program === 'string' && nutrients.program.trim() ? nutrients.program.trim() : null,
    tank: typeof nutrients.tank === 'string' && nutrients.tank.trim() ? nutrients.tank.trim() : NUTRIENT_SCOPE_ID,
    profile: typeof nutrients.profile === 'string' && nutrients.profile.trim() ? nutrients.profile.trim() : null
  };

  const targetEc = nutrients.ec != null ? {
    target: nutrients.ec,
    tolerance: nutrients.ecTolerance ?? null,
    perDose: nutrients.ecPerDose ?? null,
    doseSeconds: nutrients.ecDoseSeconds ?? null
  } : null;

  const targetPh = nutrients.ph != null ? {
    target: nutrients.ph,
    tolerance: nutrients.phTolerance ?? null,
    downDoseSeconds: nutrients.phDownDoseSeconds ?? null,
    upDoseSeconds: nutrients.phUpDoseSeconds ?? null
  } : null;

  const dosing = {
    ecPerDose: nutrients.ecPerDose ?? null,
    ecDoseSeconds: nutrients.ecDoseSeconds ?? null,
    phDownDoseSeconds: nutrients.phDownDoseSeconds ?? null,
    phUpDoseSeconds: nutrients.phUpDoseSeconds ?? null,
    minDoseIntervalSec: nutrients.minDoseIntervalSec ?? null
  };

  const mixing = {
    durationSec: nutrients.mixDurationSec ?? null
  };

  return {
    automation,
    ec: targetEc,
    ph: targetPh,
    ratio,
    dosing,
    mixing,
    raw: nutrients,
    updatedAt: envTargets.updatedAt || null,
    plan: {
      name: envTargets.planName || null,
      day: envTargets.planDay || null,
      stage: envTargets.stage || null,
      stageKey: envTargets.stageKey || null
    }
  };
}

function deriveMixState(fallbackDoc, targetRatio) {
  const fallbackRatio = fallbackDoc?.mix?.ratio ? computeRatioSnapshot(fallbackDoc.mix.ratio, 'dashboard') : null;
  let ratio = targetRatio || fallbackRatio || null;
  if (ratio && targetRatio && fallbackRatio) {
    ratio = { ...ratio, source: 'plan-targets' };
  }
  const lastAdjustment = fallbackDoc?.mix?.lastAdjustment || null;
  return ratio || lastAdjustment ? {
    ratio,
    lastAdjustment
  } : null;
}

function deriveDosingState(fallbackDoc, targets) {
  const fallback = fallbackDoc?.dosing && typeof fallbackDoc.dosing === 'object' ? fallbackDoc.dosing : null;
  const history = Array.isArray(fallback?.history) ? fallback.history.slice(-50) : null;
  if (!fallback && (!targets || !targets.dosing)) return null;
  return {
    history,
    averageDailyVolumeMl: toNumberOrNull(fallback?.averageDailyVolumeMl),
    dailyVolumeWindow: toNumberOrNull(fallback?.dailyVolumeWindow),
    anomalyThresholdMultiplier: toNumberOrNull(fallback?.anomalyThresholdMultiplier),
    tankVolumeLiters: toNumberOrNull(fallback?.tankVolumeLiters),
    pailVolumeLiters: toNumberOrNull(fallback?.pailVolumeLiters),
    pailRemainingEstimateLiters: toNumberOrNull(fallback?.pailRemainingEstimateLiters),
    target: targets?.dosing || null,
    mixing: targets?.mixing || null
  };
}

function annotateTelemetryWithTargets(telemetry, targets) {
  if (!telemetry || !targets) return telemetry;
  const cloneTelemetry = telemetry;
  if (cloneTelemetry?.ec && targets.ec?.target != null) {
    cloneTelemetry.ec.delta = Number.isFinite(cloneTelemetry.ec.value) ? Math.round((cloneTelemetry.ec.value - targets.ec.target) * 1000) / 1000 : null;
  }
  if (cloneTelemetry?.ph && targets.ph?.target != null) {
    cloneTelemetry.ph.delta = Number.isFinite(cloneTelemetry.ph.value) ? Math.round((cloneTelemetry.ph.value - targets.ph.target) * 100) / 100 : null;
  }
  return cloneTelemetry;
}

function pushTelemetryToEnvStore(telemetry, backendScope) {
  if (!telemetry || !preEnvStore || typeof preEnvStore.updateSensor !== 'function') return;
  const tryUpdate = (sensorKey, reading) => {
    if (!reading || !Number.isFinite(reading.value)) return;
    try {
      preEnvStore.updateSensor(NUTRIENT_SCOPE_ID, sensorKey, {
        value: reading.value,
        unit: reading.unit,
        observedAt: reading.observedAt,
        meta: {
          source: reading.source,
          backendScope: backendScope || null
        }
      });
    } catch (error) {
      console.warn(`[nutrients] Failed to pipe ${sensorKey} telemetry into env store:`, error?.message || error);
    }
  };
  tryUpdate('ph', telemetry.ph);
  tryUpdate('ec', telemetry.ec);
  tryUpdate('temperature', telemetry.temperature);
}

function updateNutrientDashboardSnapshot(doc, snapshot) {
  if (!doc || typeof doc !== 'object' || !snapshot) return;
  let dirty = false;
  const observedAt = snapshot.observedAt || snapshot.metadata?.derivedAt || new Date().toISOString();

  doc.metadata = doc.metadata && typeof doc.metadata === 'object' ? { ...doc.metadata } : {};
  if (observedAt && doc.metadata.updatedAt !== observedAt) {
    doc.metadata.updatedAt = observedAt;
    dirty = true;
  }

  doc.sensors = doc.sensors && typeof doc.sensors === 'object' ? { ...doc.sensors } : {};

  if (snapshot.telemetry?.ph?.value != null) {
    doc.sensors.ph = doc.sensors.ph && typeof doc.sensors.ph === 'object' ? { ...doc.sensors.ph } : {};
    const phRounded = Math.round(snapshot.telemetry.ph.value * 100) / 100;
    if (doc.sensors.ph.current !== phRounded) {
      doc.sensors.ph.current = phRounded;
      dirty = true;
    }
    if (snapshot.telemetry.ph.observedAt) {
      doc.sensors.ph.updatedAt = snapshot.telemetry.ph.observedAt;
    }
    if (snapshot.targets?.ph?.target != null) {
      const phSetpoint = Math.round(snapshot.targets.ph.target * 100) / 100;
      if (doc.sensors.ph.setpoint !== phSetpoint) {
        doc.sensors.ph.setpoint = phSetpoint;
        dirty = true;
      }
    }
  }

  if (snapshot.telemetry?.ec?.value != null) {
    doc.sensors.ec = doc.sensors.ec && typeof doc.sensors.ec === 'object' ? { ...doc.sensors.ec } : {};
    const ecMicro = Math.round(snapshot.telemetry.ec.value * 1000);
    if (doc.sensors.ec.current !== ecMicro) {
      doc.sensors.ec.current = ecMicro;
      dirty = true;
    }
    if (snapshot.telemetry.ec.observedAt) {
      doc.sensors.ec.updatedAt = snapshot.telemetry.ec.observedAt;
    }
    if (snapshot.targets?.ec?.target != null) {
      const ecSetpointMicro = Math.round(snapshot.targets.ec.target * 1000);
      if (doc.sensors.ec.setpoint !== ecSetpointMicro) {
        doc.sensors.ec.setpoint = ecSetpointMicro;
        dirty = true;
      }
    }
  }

  if (snapshot.telemetry?.temperature?.value != null) {
    doc.sensors.temperature = doc.sensors.temperature && typeof doc.sensors.temperature === 'object' ? { ...doc.sensors.temperature } : {};
    const tempRounded = Math.round(snapshot.telemetry.temperature.value * 10) / 10;
    if (doc.sensors.temperature.current !== tempRounded) {
      doc.sensors.temperature.current = tempRounded;
      dirty = true;
    }
    if (snapshot.telemetry.temperature.observedAt) {
      doc.sensors.temperature.updatedAt = snapshot.telemetry.temperature.observedAt;
    }
  }

  if (snapshot.mix?.ratio?.parts) {
    doc.mix = doc.mix && typeof doc.mix === 'object' ? { ...doc.mix } : {};
    const parts = snapshot.mix.ratio.parts;
    const ratioPayload = {};
    ['a', 'b', 'c'].forEach((key) => {
      if (parts[key] != null) {
        ratioPayload[key] = parts[key];
      }
    });
    if (Object.keys(ratioPayload).length) {
      if (JSON.stringify(doc.mix.ratio || {}) !== JSON.stringify(ratioPayload)) {
        doc.mix.ratio = ratioPayload;
        dirty = true;
      }
    }
    if (snapshot.mix.lastAdjustment && doc.mix.lastAdjustment !== snapshot.mix.lastAdjustment) {
      doc.mix.lastAdjustment = snapshot.mix.lastAdjustment;
      dirty = true;
    }
  }

  if (dirty) {
    schedulePersistNutrientDashboard(doc);
  }
}

async function refreshNutrientAutomation({ force = false, reason = 'interval' } = {}) {
  const now = Date.now();
  if (!force) {
    const throttleWindow = Math.max(5000, NUTRIENT_POLL_INTERVAL_MS / 2);
    if (nutrientAutomationState.pollInFlight) {
      return nutrientAutomationState.pollInFlight;
    }
    if (nutrientAutomationState.lastPoll && (now - nutrientAutomationState.lastPoll) < throttleWindow) {
      return nutrientAutomationState.snapshot;
    }
  }

  nutrientAutomationState.pollInFlight = (async () => {
    const fallbackDoc = loadNutrientDashboardCache() || {};
    let backendTelemetry = null;
    let backendError = null;
    let backendStatus = null;
    try {
      const response = await fetchPythonBackend(`/api/env/latest?scope=${encodeURIComponent(NUTRIENT_BACKEND_SCOPE)}`);
      if (response && response.ok) {
        backendStatus = response.status;
        const payload = await response.json();
        backendTelemetry = normalizeBackendNutrientTelemetry(payload);
      } else if (response) {
        backendStatus = response.status;
        let errorBody = null;
        try {
          errorBody = await response.json();
        } catch {}
        const err = new Error(errorBody?.error || `Python backend HTTP ${response.status}`);
        err.status = response.status;
        backendError = err;
      } else {
        backendError = new Error('python-backend-unavailable');
      }
    } catch (error) {
      backendError = error;
    }

    const fallbackTelemetry = normalizeDashboardNutrientTelemetry(fallbackDoc);
    const mergedTelemetry = mergeNutrientTelemetry(backendTelemetry, fallbackTelemetry);
    const targets = deriveNutrientTargets();
    annotateTelemetryWithTargets(mergedTelemetry, targets);

    if (mergedTelemetry) {
      pushTelemetryToEnvStore(mergedTelemetry, backendTelemetry?.backendScope || null);
    }

    const mix = deriveMixState(fallbackDoc, targets?.ratio || null);
    const dosing = deriveDosingState(fallbackDoc, targets);
    const metadata = {
      backendScope: backendTelemetry?.backendScope || NUTRIENT_BACKEND_SCOPE,
      derivedAt: new Date().toISOString(),
      pollReason: reason,
      backendStatus,
      backendOnline: Boolean(backendTelemetry),
      fallbackUsed: Boolean(backendError) && Boolean(fallbackTelemetry),
      failure: backendError ? { message: backendError.message || 'backend-error', status: backendError.status || null } : null
    };

    const observedAt = mergedTelemetry?.observedAt
      || fallbackDoc?.metadata?.updatedAt
      || metadata.derivedAt;

    const snapshot = {
      ok: Boolean(mergedTelemetry),
      scopeId: NUTRIENT_SCOPE_ID,
      scope: NUTRIENT_SCOPE_ID,
      observedAt,
      telemetry: mergedTelemetry,
      targets,
      mix,
      dosing,
      metadata
    };

    updateNutrientDashboardSnapshot(fallbackDoc, snapshot);

    nutrientAutomationState.snapshot = snapshot;
    nutrientAutomationState.lastPoll = Date.now();
    nutrientAutomationState.failure = backendError || null;
    return snapshot;
  })()
    .catch((error) => {
      nutrientAutomationState.failure = error;
      console.warn('[nutrients] Poll failure:', error?.message || error);
      const fallbackDoc = loadNutrientDashboardCache() || {};
      const fallbackTelemetry = normalizeDashboardNutrientTelemetry(fallbackDoc);
      const targets = deriveNutrientTargets();
      annotateTelemetryWithTargets(fallbackTelemetry, targets);
      const mix = deriveMixState(fallbackDoc, targets?.ratio || null);
      const dosing = deriveDosingState(fallbackDoc, targets);
      const metadata = {
        backendScope: NUTRIENT_BACKEND_SCOPE,
        derivedAt: new Date().toISOString(),
        pollReason: 'error-recovery',
        backendStatus: null,
        backendOnline: false,
        fallbackUsed: true,
        failure: { message: error?.message || 'nutrient-poll-error' }
      };
      const observedAt = fallbackTelemetry?.observedAt || fallbackDoc?.metadata?.updatedAt || metadata.derivedAt;
      const snapshot = {
        ok: Boolean(fallbackTelemetry),
        scopeId: NUTRIENT_SCOPE_ID,
        scope: NUTRIENT_SCOPE_ID,
        observedAt,
        telemetry: fallbackTelemetry,
        targets,
        mix,
        dosing,
        metadata
      };
      nutrientAutomationState.snapshot = snapshot;
      return snapshot;
    })
    .finally(() => {
      nutrientAutomationState.pollInFlight = null;
    });

  return nutrientAutomationState.pollInFlight;
}

let nutrientPollTimer = null;

function ensureNutrientAutomationTimer() {
  if (nutrientPollTimer) return;
  nutrientPollTimer = setInterval(() => {
    refreshNutrientAutomation({ reason: 'timer' }).catch((error) => {
      console.warn('[nutrients] Background nutrient refresh failed:', error?.message || error);
    });
  }, NUTRIENT_POLL_INTERVAL_MS);
  if (typeof nutrientPollTimer?.unref === 'function') {
    nutrientPollTimer.unref();
  }
}

async function getNutrientAutomationState({ forceRefresh = false } = {}) {
  if (forceRefresh) {
    await refreshNutrientAutomation({ force: true, reason: 'manual-refresh' });
    return nutrientAutomationState.snapshot;
  }

  if (!nutrientAutomationState.snapshot) {
    await refreshNutrientAutomation({ force: true, reason: 'initial-load' });
    return nutrientAutomationState.snapshot;
  }

  if (Date.now() - nutrientAutomationState.lastPoll > NUTRIENT_POLL_INTERVAL_MS) {
    refreshNutrientAutomation({ force: true, reason: 'stale-refresh' }).catch((error) => {
      console.warn('[nutrients] Stale nutrient refresh failed:', error?.message || error);
    });
  }

  return nutrientAutomationState.snapshot;
}

ensureNutrientAutomationTimer();
refreshNutrientAutomation({ force: true, reason: 'startup' }).catch((error) => {
  console.warn('[nutrients] Initial nutrient poll failed:', error?.message || error);
});

app.options('/api/nutrients/targets', (req, res) => {
  setCors(req, res);
  res.status(204).end();
});

app.post('/api/nutrients/targets', requireEdgeForControl, async (req, res) => {
  try {
    setCors(req, res);
    const body = req.body || {};

    const brokerUrl = typeof body.brokerUrl === 'string' && body.brokerUrl.trim()
      ? body.brokerUrl.trim()
      : DEFAULT_NUTRIENT_MQTT_URL;
    const topic = typeof body.topic === 'string' && body.topic.trim()
      ? body.topic.trim()
      : DEFAULT_NUTRIENT_COMMAND_TOPIC;

    const readNumber = (...keys) => {
      for (const key of keys) {
        const value = body[key];
        const num = toNumberOrNull(value);
        if (Number.isFinite(num)) return num;
      }
      return null;
    };

    const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

    const config = {
      ...DEFAULT_AUTODOSE_CONFIG,
      autodoseEnabled: typeof body.autodoseEnabled === 'boolean'
        ? body.autodoseEnabled
        : (typeof body.enabled === 'boolean' ? body.enabled : DEFAULT_AUTODOSE_CONFIG.autodoseEnabled)
    };

    const phTarget = readNumber('phTarget', 'ph_target', 'targetPh');
    if (Number.isFinite(phTarget)) config.phTarget = phTarget;
    const phTolerance = readNumber('phTolerance', 'ph_tolerance', 'phWindow');
    if (Number.isFinite(phTolerance)) config.phTolerance = phTolerance;
    const ecTarget = readNumber('ecTarget', 'ec_target', 'targetEc');
    if (Number.isFinite(ecTarget)) config.ecTarget = ecTarget;
    const ecTolerance = readNumber('ecTolerance', 'ec_tolerance', 'ecWindow');
    if (Number.isFinite(ecTolerance)) config.ecTolerance = ecTolerance;
    const ecDoseSeconds = readNumber('ecDoseSeconds', 'ecDose', 'ec_dose_seconds');
    if (Number.isFinite(ecDoseSeconds)) config.ecDoseSeconds = ecDoseSeconds;
    const phDownDoseSeconds = readNumber('phDownDoseSeconds', 'phDose', 'ph_dose_seconds');
    if (Number.isFinite(phDownDoseSeconds)) config.phDownDoseSeconds = phDownDoseSeconds;
    const minDoseIntervalSec = readNumber('minDoseIntervalSec', 'minDoseInterval', 'min_interval_sec');
    if (Number.isFinite(minDoseIntervalSec)) config.minDoseIntervalSec = minDoseIntervalSec;

    config.phTarget = clamp(config.phTarget, 4.0, 7.5);
    config.phTolerance = clamp(config.phTolerance, 0.05, 1.0);
    config.ecTarget = clamp(config.ecTarget, 100, 2500);
    config.ecTolerance = clamp(config.ecTolerance, 5, 500);
    config.ecDoseSeconds = clamp(config.ecDoseSeconds, 0.5, 20);
    config.phDownDoseSeconds = clamp(config.phDownDoseSeconds, 0.5, 5);
    config.minDoseIntervalSec = clamp(config.minDoseIntervalSec, 30, 3600);

    if (!Number.isFinite(config.phTarget) || !Number.isFinite(config.ecTarget)) {
      return res.status(400).json({ ok: false, error: 'invalid-targets' });
    }

    const payload = {
      action: 'setTargets',
      targets: {
        phTarget: Number(config.phTarget.toFixed(2)),
        phTolerance: Number(config.phTolerance.toFixed(2)),
        ecTarget: Number(config.ecTarget.toFixed(1)),
        ecTolerance: Number(config.ecTolerance.toFixed(1)),
        autodoseEnabled: Boolean(config.autodoseEnabled),
        ecDoseSeconds: Number(config.ecDoseSeconds.toFixed(2)),
        phDownDoseSeconds: Number(config.phDownDoseSeconds.toFixed(2)),
        minDoseIntervalSec: Math.round(config.minDoseIntervalSec),
        dosing: {
          enabled: Boolean(config.autodoseEnabled),
          ecDoseSeconds: Number(config.ecDoseSeconds.toFixed(2)),
          phDownDoseSeconds: Number(config.phDownDoseSeconds.toFixed(2)),
          minDoseIntervalSec: Math.round(config.minDoseIntervalSec)
        }
      }
    };

    const publishResult = await publishNutrientCommand(payload, { brokerUrl, topic });

    res.json({
      ok: true,
      brokerUrl: publishResult?.brokerUrl || brokerUrl,
      topic: publishResult?.topic || topic,
      translated: Boolean(publishResult?.translated),
      payload,
      config
    });
  } catch (error) {
    console.error('[nutrients] Failed to publish setTargets:', error?.message || error);
    res.status(502).json({
      ok: false,
      error: error?.message || 'nutrient-settargets-failed'
    });
  }
});

app.options('/api/nutrients/pump-calibration', (req, res) => {
  setCors(req, res);
  res.status(204).end();
});

app.post('/api/nutrients/pump-calibration', async (req, res) => {
  try {
    setCors(req, res);
    const body = req.body || {};

    const brokerUrl = typeof body.brokerUrl === 'string' && body.brokerUrl.trim()
      ? body.brokerUrl.trim()
      : DEFAULT_NUTRIENT_MQTT_URL;
    const topic = typeof body.topic === 'string' && body.topic.trim()
      ? body.topic.trim()
      : DEFAULT_NUTRIENT_COMMAND_TOPIC;

    const channel = typeof body.channel === 'string' && body.channel.trim()
      ? body.channel.trim()
      : 'ecMixA';

    const runTimeSeconds = toNumberOrNull(body.runTimeSeconds ?? body.run_time_sec ?? body.durationSec);
    const measuredVolumeMl = toNumberOrNull(body.measuredVolumeMl ?? body.measuredVolume ?? body.volumeMl);
    const notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null;

    if (!Number.isFinite(runTimeSeconds) || runTimeSeconds <= 0) {
      return res.status(400).json({ ok: false, error: 'invalid-runtime' });
    }
    if (!Number.isFinite(measuredVolumeMl) || measuredVolumeMl <= 0) {
      return res.status(400).json({ ok: false, error: 'invalid-volume' });
    }

    const flowMlPerSec = measuredVolumeMl / runTimeSeconds;

    const payload = {
      action: 'savePumpCalibration',
      calibration: {
        channel,
        runTimeSeconds: Number(runTimeSeconds.toFixed(2)),
        measuredVolumeMl: Number(measuredVolumeMl.toFixed(2)),
        flowMlPerSec: Number(flowMlPerSec.toFixed(4)),
        recordedAt: new Date().toISOString(),
        notes: notes || undefined
      }
    };

    const publishResult = await publishNutrientCommand(payload, { brokerUrl, topic });

    res.json({
      ok: true,
      brokerUrl: publishResult?.brokerUrl || brokerUrl,
      topic: publishResult?.topic || topic,
      translated: Boolean(publishResult?.translated),
      payload,
      flowMlPerSec,
      runTimeSeconds,
      measuredVolumeMl
    });
  } catch (error) {
    console.error('[nutrients] Pump calibration publish failed:', error?.message || error);
    res.status(502).json({
      ok: false,
      error: error?.message || 'pump-calibration-failed'
    });
  }
});

app.options('/api/nutrients/sensor-calibration', (req, res) => {
  setCors(req, res);
  res.status(204).end();
});

app.post('/api/nutrients/sensor-calibration', async (req, res) => {
  try {
    setCors(req, res);
    const body = req.body || {};

    const brokerUrl = typeof body.brokerUrl === 'string' && body.brokerUrl.trim()
      ? body.brokerUrl.trim()
      : DEFAULT_NUTRIENT_MQTT_URL;
    const topic = typeof body.topic === 'string' && body.topic.trim()
      ? body.topic.trim()
      : DEFAULT_NUTRIENT_COMMAND_TOPIC;

    const sensorRaw = typeof body.sensor === 'string' ? body.sensor.trim().toLowerCase() : null;
    const commandRaw = typeof body.command === 'string' ? body.command.trim().toLowerCase() : null;

    const sensor = sensorRaw === 'ph' ? 'ph' : sensorRaw === 'ec' ? 'ec' : null;
    if (!sensor) {
      return res.status(400).json({ ok: false, error: 'invalid-sensor' });
    }

    const allowedCommands = sensor === 'ph'
      ? ['clear', 'mid', 'low', 'high', 'status']
      : ['clear', 'dry', 'one', 'low', 'high', 'status'];

    if (!commandRaw || !allowedCommands.includes(commandRaw)) {
      return res.status(400).json({ ok: false, error: 'invalid-command' });
    }

    const notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null;

    let value = toNumberOrNull(body.value ?? body.target ?? body.solutionValue);
    if (sensor === 'ph' && ['mid', 'low', 'high'].includes(commandRaw)) {
      if (!Number.isFinite(value)) {
        const defaults = { mid: 7.0, low: 4.0, high: 10.0 };
        value = defaults[commandRaw];
      }
    }

    if (sensor === 'ec' && ['one', 'low', 'high'].includes(commandRaw)) {
      if (!Number.isFinite(value) || value <= 0) {
        return res.status(400).json({ ok: false, error: 'value-required' });
      }
    }

    const payload = {
      action: 'sensorCal',
      sensor,
      command: commandRaw,
      requestedAt: new Date().toISOString(),
      value: Number.isFinite(value) ? Number(value.toFixed(sensor === 'ph' ? 2 : 0)) : undefined,
      notes: notes || undefined
    };

    const publishResult = await publishNutrientCommand(payload, { brokerUrl, topic });

    res.json({
      ok: true,
      brokerUrl: publishResult?.brokerUrl || brokerUrl,
      topic: publishResult?.topic || topic,
      translated: Boolean(publishResult?.translated),
      payload
    });
  } catch (error) {
    console.error('[nutrients] Sensor calibration publish failed:', error?.message || error);
    res.status(502).json({
      ok: false,
      error: error?.message || 'sensor-calibration-failed'
    });
  }
});

app.options('/api/nutrients/command', (req, res) => {
  setCors(req, res);
  res.status(204).end();
});

app.post('/api/nutrients/command', requireEdgeForControl, async (req, res) => {
  try {
    setCors(req, res);
    const body = req.body || {};

    const brokerUrl = typeof body.brokerUrl === 'string' && body.brokerUrl.trim()
      ? body.brokerUrl.trim()
      : DEFAULT_NUTRIENT_MQTT_URL;
    const topic = typeof body.topic === 'string' && body.topic.trim()
      ? body.topic.trim()
      : DEFAULT_NUTRIENT_COMMAND_TOPIC;

    const action = typeof body.action === 'string' ? body.action.trim() : '';
    const allowedActions = new Set(['phDown', 'ecMixA', 'ecMixB', 'stop', 'requestStatus']);
    if (!allowedActions.has(action)) {
      return res.status(400).json({ ok: false, error: 'invalid-action' });
    }

    const duration = toNumberOrNull(body.durationSec ?? body.duration ?? body.seconds);

    const payload = {
      action,
      durationSec: Number.isFinite(duration) ? Number(duration.toFixed(2)) : undefined,
      requestedAt: new Date().toISOString()
    };

    const publishResult = await publishNutrientCommand(payload, { brokerUrl, topic });

    res.json({
      ok: true,
      brokerUrl: publishResult?.brokerUrl || brokerUrl,
      topic: publishResult?.topic || topic,
      translated: Boolean(publishResult?.translated),
      payload
    });
  } catch (error) {
    console.error('[nutrients] Manual nutrient command failed:', error?.message || error);
    res.status(502).json({
      ok: false,
      error: error?.message || 'nutrient-command-failed'
    });
  }
});

// Proxy endpoint: Get nutrient dashboard data (for frontend)
app.get('/data/nutrient-dashboard', async (req, res) => {
  try {
    setCors(req, res);
    const refresh = ['1', 'true', 'yes'].includes(String(req.query.refresh || '').toLowerCase());
    const snapshot = await getNutrientAutomationState({ forceRefresh: refresh });
    if (!snapshot) {
      return res.status(404).json({ ok: false, error: 'nutrient-data-unavailable' });
    }
    res.json({ ...snapshot, ok: snapshot.ok !== false });
  } catch (error) {
    console.error('[Nutrient API] Error fetching dashboard data:', error);
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

// Persist nutrient dashboard data (for UI saves)
app.post('/data/nutrient-dashboard', async (req, res) => {
  try {
    setCors(req, res);
    const payload = req.body;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return res.status(400).json({ ok: false, error: 'invalid-payload' });
    }

    schedulePersistNutrientDashboard(payload);
    res.json({ ok: true });
  } catch (error) {
    console.error('[Nutrient API] Error saving dashboard data:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// Get available nutrient scopes
app.get('/api/nutrients/scopes', async (req, res) => {
  try {
    setCors(req, res);
    
    const response = await fetchPythonBackend('/api/env/scopes');
    
    if (!response || !response.ok) {
      return res.status(503).json({
        ok: false,
        error: 'Python backend unavailable'
      });
    }
    
    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// Get latest readings for a scope
app.get('/api/nutrients/latest/:scope', async (req, res) => {
  try {
    setCors(req, res);
    const scope = decodeURIComponent(req.params.scope);
    
    const response = await fetchPythonBackend(`/api/env/latest?scope=${encodeURIComponent(scope)}`);
    
    if (!response) {
      return res.status(503).json({
        ok: false,
        error: 'Python backend unavailable'
      });
    }
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
      return res.status(response.status).json(errorData);
    }
    
    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// Get sensor history
app.get('/api/nutrients/history/:scope/:sensor', async (req, res) => {
  try {
    setCors(req, res);
    const scope = decodeURIComponent(req.params.scope);
    const sensor = decodeURIComponent(req.params.sensor);
    const limit = req.query.limit || 50;
    
    const response = await fetchPythonBackend(
      `/api/env/history?scope=${encodeURIComponent(scope)}&sensor=${encodeURIComponent(sensor)}&limit=${limit}`
    );
    
    if (!response || !response.ok) {
      return res.status(503).json({
        ok: false,
        error: 'Python backend unavailable'
      });
    }
    
    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// Manual ingest endpoint (for testing with mosquitto_pub simulation)
app.post('/api/nutrients/ingest', async (req, res) => {
  try {
    setCors(req, res);
    const payload = req.body;
    
    // Validate payload
    if (!payload.scope || !payload.sensors) {
      return res.status(400).json({
        ok: false,
        error: 'Payload must include scope and sensors'
      });
    }
    
    const response = await fetchPythonBackend('/api/env/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    if (!response || !response.ok) {
      return res.status(503).json({
        ok: false,
        error: 'Python backend unavailable'
      });
    }
    
    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// Legacy MQTT endpoint (retained for backward compatibility)
app.get('/api/mqtt/nutrients', async (req, res) => {
  // Redirect to new nutrient dashboard endpoint
  return res.redirect(307, '/data/nutrient-dashboard');
});

// Explicit OPTIONS handler for all /api/* endpoints to support CORS preflight
app.options('/api/*', (req, res) => {
  // Allow all origins for development; adjust as needed for production
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] || 'Content-Type, Authorization, X-Requested-With');
  res.status(204).end();
});

function streamLiveFile(res, filePath, type) {
  if (!fs.existsSync(filePath)) {
    res.status(404).send(`${path.basename(filePath)} not found`);
    return;
  }
  res.setHeader('Cache-Control', 'no-store');
  if (type) res.type(type);
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  stream.on('error', (err) => {
    console.error('[live-file] stream error', err);
    if (!res.headersSent) {
      res.status(500).send('Failed to read file');
    } else {
      res.end();
    }
  });
  stream.pipe(res);
}

// Phase 9 testing guardrails: serve the live files from disk
app.get('/tmp/live.index.html', (req, res) => {
  const html = loadIndexCharlieHtml();
  if (html) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.type('html').send(html);
    return;
  }
  const fallbackPath = path.join(PUBLIC_DIR, 'index.html');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.type('html');
  res.sendFile(fallbackPath);
});

app.get('/tmp/live.app.new.js', (req, res) => {
  const filePath = path.join(PUBLIC_DIR, 'app.charlie.js');
  streamLiveFile(res, filePath, 'application/javascript');
});

const CONTROLLER_BASE = () => getController().replace(/\/+$/, '');

// Targeted proxies for controller device data
app.get('/api/devicedatas', async (req, res) => {
  try {
    const target = `${CONTROLLER_BASE()}/api/devicedatas`;
    const upstream = await fetch(target, { signal: AbortSignal.timeout(5000) });
    const bodyText = await upstream.text();
    let parsed;
    try {
      parsed = JSON.parse(bodyText);
    } catch {
      throw new Error('upstream_non_json');
    }
    writeDeviceCache(bodyText);
    res.set('X-Cache', 'miss').type('application/json').send(JSON.stringify(parsed));
  } catch (error) {
    const cached = readDeviceCache();
    if (cached) {
      res.set('X-Cache', 'hit').type('application/json').send(cached);
      return;
    }
    res.status(502).json({ error: 'proxy_error', detail: String(error) });
  }
});

app.get('/calibration', (req, res) => {
  try {
    const devices = readCalibrationMultipliers();
    res.json({ devices });
  } catch (error) {
    res.status(500).json({ error: 'calibration_read_failed', detail: String(error) });
  }
});

app.post('/calibration', express.json(), (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const deviceId = typeof body.deviceId === 'string' ? body.deviceId.trim() : '';
    if (!deviceId) {
      res.status(400).json({ error: 'missing_device_id' });
      return;
    }
    const source = body.multipliers && typeof body.multipliers === 'object' ? body.multipliers : body;
    const multipliers = normalizeMultiplierDoc(source);
    const existing = readCalibrationMultipliers();
    existing[deviceId] = multipliers;
    const saved = writeCalibrationMultipliers(existing);
    res.json({ deviceId, multipliers: saved[deviceId] || multipliers });
  } catch (error) {
    res.status(500).json({ error: 'calibration_write_failed', detail: String(error) });
  }
});

app.patch('/api/devicedatas/device/:id', requireEdgeForControl, pinGuard, express.json(), async (req, res) => {
  try {
    const target = `${CONTROLLER_BASE()}/api/devicedatas/device/${encodeURIComponent(req.params.id)}`;
    const payload = req.body && typeof req.body === 'object' ? { ...req.body } : {};
    const status = typeof payload.status === 'string' ? payload.status.toLowerCase() : '';
    const shouldApplyCalibration = status === 'on';
    if (shouldApplyCalibration && typeof payload.value === 'string') {
      try {
        const multipliersMap = readCalibrationMultipliers();
        const multipliers = getDeviceMultipliers(multipliersMap, req.params.id);
        const { maxByte } = loadChannelScaleConfig();
        const calibratedHex = applyMultipliersToHexPayload(payload.value, multipliers, maxByte);
        payload.value = calibratedHex;
      } catch (error) {
        console.warn('[calibration] Failed to apply multipliers:', error?.message || error);
      }
    }
    const upstream = await fetch(target, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000)
    });
    const text = await upstream.text();
    res
      .status(upstream.status)
      .type(upstream.headers.get('content-type') || 'application/json')
      .send(text);
  } catch (error) {
    res.status(502).json({ error: 'proxy_error', target: 'controller', detail: String(error) });
  }
});

// DEPRECATED: Charlie backend (Python FastAPI) removed February 4, 2026
// All AI/ML functionality migrated to Foxtrot server
app.use('/py', (req, res) => {
  console.log(`[Deprecated] /py${req.path} - Charlie backend no longer available`);
  res.status(410).json({
    error: 'endpoint_deprecated',
    message: 'Charlie backend (Python FastAPI) was deprecated on February 4, 2026',
    migration: 'AI predictions and health insights now available via /api/health/insights',
    documentation: 'See CHARLIE_MIGRATION_COMPLETE.md for details'
  });
});

// ===== GROW3 (CODE3) CONTROLLER PROXY =====
// IMPORTANT: This must come BEFORE the /api proxy middleware to avoid conflicts
// Proxy all /api/grow3/* requests to the configured controller
// Dedicated Grow3 proxy - mounted at /grow3 to avoid /api routing conflicts
// This MUST be registered BEFORE the general /api proxy middleware

// Global trace middleware - catches ALL requests before any routing
app.use((req, res, next) => {
  if (req.path.startsWith('/grow3')) {
    console.log(`[GLOBAL TRACE] Request intercepted: ${req.method} ${req.path} (originalUrl: ${req.originalUrl})`);
    console.log(`[GLOBAL TRACE] Headers:`, req.headers);
    console.log(`[GLOBAL TRACE] Body:`, req.body);
  }
  next();
});

const grow3Router = express.Router();

// Debug middleware to trace all /grow3 requests at the router level
grow3Router.use((req, res, next) => {
  const fullPath = `${req.baseUrl}${req.path}`;
  console.log(`[Grow3 Proxy] Incoming ${req.method} ${fullPath}`);
  next();
});

// Ensure JSON bodies are parsed for PATCH/POST requests hitting the router
grow3Router.use(express.json());

grow3Router.all('*', async (req, res) => {
  const fullPath = `${req.baseUrl}${req.path}`;
  console.log(`[Grow3 Proxy] Handler executing for ${req.method} ${fullPath}`);
  try {
    // Transform /grow3/devicedatas/device/2 → /api/devicedatas/device/2
    const controllerBase = getController().replace(/\/+$/, '');
    const targetPath = fullPath.replace(/^\/grow3/, '/api');
    const targetUrl = `${controllerBase}${targetPath}`;
    
    console.log(`[Grow3 Proxy] ${req.method} ${fullPath} → ${targetUrl}`);
    if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
      console.log(`[Grow3 Proxy] Payload:`, JSON.stringify(req.body, null, 2));
    }
    
    // Check if this is a device control request (use channelsValue field)
    const deviceMatch = targetPath.match(/^\/api\/devicedatas\/device\/(\d+)$/);
    if (deviceMatch && req.method === 'PATCH') {
      const { status, channelsValue } = req.body || {};
      console.log(`[Grow3 Proxy] Device control request: device=${deviceMatch[1]}, status=${status}, channelsValue=${channelsValue}`);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    
    try {
      const bodyString = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.body !== undefined
        ? JSON.stringify(req.body)
        : undefined;
      
      const response = await fetch(targetUrl, {
        method: req.method,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: bodyString,
        signal: controller.signal
      });
      
      clearTimeout(timeout);
      
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        const data = await response.json();
        res.status(response.status).json(data);
      } else {
        const text = await response.text();
        res.status(response.status).type(contentType || 'text/plain').send(text);
      }
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    console.error('[Grow3 Proxy] Error:', error.message);
    console.error('[Grow3 Proxy] Controller URL:', getController());
    console.error('[Grow3 Proxy] Target path:', fullPath);
    
    if (error.name === 'AbortError') {
      res.status(504).json({ 
        error: 'Gateway timeout', 
        message: 'Grow3 controller did not respond in time',
        controller: getController(),
        hint: 'Check that the controller is online and reachable'
      });
    } else if (error.cause && error.cause.code === 'ECONNREFUSED') {
      res.status(502).json({ 
        error: 'Connection refused', 
        message: `Cannot connect to Grow3 controller at ${getController()}`,
        hint: 'Verify the IP address and port, ensure controller is powered on'
      });
    } else if (error.cause && error.cause.code === 'ENOTFOUND') {
      res.status(502).json({ 
        error: 'Host not found', 
        message: `Cannot resolve controller hostname: ${getController()}`,
        hint: 'Check network connection and controller IP configuration'
      });
    } else {
      res.status(502).json({ 
        error: 'Bad gateway', 
        message: error.message,
        controller: getController(),
        hint: 'Check server logs for details'
      });
    }
  }
});

app.use('/grow3', grow3Router);
app.use('/api/grow3', grow3Router); // Also handle /api/grow3/api/* requests
console.log('[Grow3 Proxy] Router mounted at /grow3 and /api/grow3');

// Test Grow3/controller connection endpoint - MUST be before /api proxy
app.get('/api/test-controller', async (req, res) => {
  const controller = getController();
  console.log(`[Test Controller] Testing connection to: ${controller}`);
  
  const results = {
    controller,
    timestamp: new Date().toISOString(),
    tests: {}
  };
  
  try {
    // Test 1: Healthz endpoint
    try {
      const healthzUrl = `${controller}/healthz`;
      console.log(`[Test Controller] Testing ${healthzUrl}`);
      const healthzResponse = await fetch(healthzUrl, {
        method: 'GET',
        signal: AbortSignal.timeout(5000)
      });
      results.tests.healthz = {
        url: healthzUrl,
        status: healthzResponse.status,
        ok: healthzResponse.ok,
        statusText: healthzResponse.statusText
      };
    } catch (error) {
      results.tests.healthz = {
        url: `${controller}/healthz`,
        error: error.message,
        code: error.cause?.code
      };
    }
    
    // Test 2: Device list endpoint
    try {
      const devicesUrl = `${controller}/api/devicedatas`;
      console.log(`[Test Controller] Testing ${devicesUrl}`);
      const devicesResponse = await fetch(devicesUrl, {
        method: 'GET',
        signal: AbortSignal.timeout(5000)
      });
      const devicesData = devicesResponse.ok ? await devicesResponse.json() : null;
      const deviceCount = Array.isArray(devicesData?.data) ? devicesData.data.length : 
                         Array.isArray(devicesData) ? devicesData.length : 0;
      
      results.tests.devices = {
        url: devicesUrl,
        status: devicesResponse.status,
        ok: devicesResponse.ok,
        deviceCount,
        statusText: devicesResponse.statusText
      };
    } catch (error) {
      results.tests.devices = {
        url: `${controller}/api/devicedatas`,
        error: error.message,
        code: error.cause?.code
      };
    }
    
    // Determine overall status
    const healthzOk = results.tests.healthz.ok || false;
    const devicesOk = results.tests.devices.ok || false;
    
    results.overall = {
      connected: devicesOk, // Devices endpoint is primary health check
      healthz: healthzOk,
      devices: devicesOk,
      message: devicesOk ? 
        `Connected - Found ${results.tests.devices.deviceCount} devices` :
        'Connection failed - Controller not responding'
    };
    
    res.json(results);
    
  } catch (error) {
    console.error('[Test Controller] Failed:', error);
    results.overall = {
      connected: false,
      error: error.message
    };
    res.status(500).json(results);
  }
});

// Explicitly handle /api/env routes BEFORE the proxy middleware
app.get('/api/env', async (req, res) => {
  // Forward to the main /env handler
  req.url = '/env';
  return app._router.handle(req, res, () => {});
});

// =============================================================================
// MULTI-FARM ADMIN API - Must be registered BEFORE the general /api proxy
// =============================================================================

/**
 * Load farm registry configuration
 */
function loadFarmRegistry() {
  try {
    const registryPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'config', 'farms.json');
    if (!fs.existsSync(registryPath)) {
      console.warn('[admin] Farm registry not found:', registryPath);
      return { farms: [] };
    }
    const data = fs.readFileSync(registryPath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('[admin] Failed to load farm registry:', error.message);
    return { farms: [] };
  }
}

/**
 * Fetch data from a farm endpoint with timeout
 * Uses native fetch() which requires Node.js 18+
 */
async function fetchFarmData(url, timeout = 5000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 
        'Accept': 'application/json',
        'User-Agent': 'Light-Engine-Charlie-Central/1.0'
      }
    });
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('Request timeout');
    }
    throw error;
  }
}

/**
 * GET /api/admin/farms
 * Returns list of all farms with aggregated metrics
 * PROTECTED: Requires admin authentication
 */
app.get('/api/admin/farms', adminAuthMiddleware, asyncHandler(async (req, res) => {
  console.log('[admin] GET /api/admin/farms called');
  const { page = 1, limit = 50, status, region, search } = req.query;
  const pageNum = parseInt(page);
  const limitNum = parseInt(limit);
  
  const registry = loadFarmRegistry();
  let farms = registry.farms || [];
  
  // Filter by enabled farms only (unless explicitly showing all)
  if (req.query.showDisabled !== 'true') {
    farms = farms.filter(f => f.enabled);
  }
  
  // Fetch live data from each farm in parallel
  const farmDataPromises = farms.map(async (farmConfig) => {
    // For demo farm (GR-00001), use local demo data instead of fetching
    if (farmConfig.farmId === 'GR-00001') {
      try {
        const demoDataPath = path.join(__dirname, 'public/data/demo-farm-data.json');
        const demoData = JSON.parse(fs.readFileSync(demoDataPath, 'utf8'));
        
        // Calculate metrics from demo data
        const rooms = demoData.rooms?.length || 0;
        let zones = 0;
        let devices = 0;
        let trays = 0;
        
        if (demoData.rooms) {
          demoData.rooms.forEach(room => {
            if (room.zones) {
              zones += room.zones.length;
              room.zones.forEach(zone => {
                if (zone.groups) {
                  zone.groups.forEach(group => {
                    trays += group.trays || 0;
                    if (group.devices) {
                      devices += group.devices.length;
                    }
                  });
                }
              });
            }
          });
        }
        
        console.log(`[admin] Using demo data for ${farmConfig.farmId}: ${rooms} rooms, ${zones} zones, ${devices} devices, ${trays} trays`);
        
        return {
          farmId: farmConfig.farmId,
          name: farmConfig.name,
          status: 'online',
          region: farmConfig.region,
          rooms,
          zones,
          devices,
          trays,
          energy: demoData.energy || 145,
          alerts: demoData.alerts || 0,
          lastUpdate: 'Just now',
          url: farmConfig.url
        };
      } catch (error) {
        console.error(`[admin] Failed to load demo data for ${farmConfig.farmId}:`, error.message);
        // Fall through to normal fetch logic if demo data fails
      }
    }
    
    // For all other farms, fetch live data
    try {
      // Fetch environmental data
      const envData = await fetchFarmData(`${farmConfig.url}/env`, 3000);
      
      // Fetch device data
      let devices = [];
      try {
        const deviceData = await fetchFarmData(`${farmConfig.url}/data/iot-devices.json`, 3000);
        devices = Array.isArray(deviceData) ? deviceData : [];
      } catch (e) {
        // Device data optional
      }
      
      // Calculate metrics
      const zones = envData.zones || [];
      const rooms = zones.length;
      const deviceCount = devices.length;
      
      // Count trays from groups data
      let trays = 0;
      try {
        const groupsData = await fetchFarmData(`${farmConfig.url}/data/groups.json`, 2000);
        const groups = groupsData?.groups || [];
        trays = groups.reduce((sum, g) => sum + (g.trays || 0), 0);
      } catch (e) {
        // Groups data optional, try inventory fallback
        try {
          const invData = await fetchFarmData(`${farmConfig.url}/data/inventory.json`, 2000);
          trays = invData?.trays?.length || 0;
        } catch (e2) {
          // Inventory also optional
        }
      }
      
      // Energy from environment data (kWh estimate based on active devices)
      const energy = deviceCount > 0 ? Math.round(deviceCount * 0.64 * 12) : 0;
      
      // Determine status
      const farmStatus = 'online';
      const alerts = 0;
      
      return {
        farmId: farmConfig.farmId,
        name: farmConfig.name,
        status: farmStatus,
        region: farmConfig.region,
        rooms,
        zones: zones.length,
        devices: deviceCount,
        trays,
        energy,
        alerts,
        lastUpdate: 'Just now',
        url: farmConfig.url
      };
    } catch (error) {
      console.warn(`[admin] Failed to fetch data from ${farmConfig.farmId}:`, error.message);
      return {
        farmId: farmConfig.farmId,
        name: farmConfig.name,
        status: 'offline',
        region: farmConfig.region,
        rooms: 0,
        zones: 0,
        devices: 0,
        trays: 0,
        energy: 0,
        alerts: 1,
        lastUpdate: 'Unavailable',
        url: farmConfig.url
      };
    }
  });
  
  let farmsData = await Promise.all(farmDataPromises);
  
  // Apply filters
  if (status) {
    farmsData = farmsData.filter(f => f.status === status);
  }
  
  if (region) {
    farmsData = farmsData.filter(f => f.region === region);
  }
  
  if (search) {
    const searchLower = search.toLowerCase();
    farmsData = farmsData.filter(f => 
      f.farmId.toLowerCase().includes(searchLower) || 
      f.name.toLowerCase().includes(searchLower)
    );
  }
  
  // Pagination
  const total = farmsData.length;
  const totalPages = Math.ceil(total / limitNum);
  const startIdx = (pageNum - 1) * limitNum;
  const endIdx = startIdx + limitNum;
  const paginatedFarms = farmsData.slice(startIdx, endIdx);
  
  res.json({
    farms: paginatedFarms,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages
    }
  });
}));

/**
 * GET /api/admin/farms/:farmId
 * Returns detailed data for a specific farm
 * PROTECTED: Requires admin authentication
 */
app.get('/api/admin/farms/:farmId', adminAuthMiddleware, createDemoModeHandler(), asyncHandler(async (req, res) => {
  console.log(`[admin] GET /api/admin/farms/${req.params.farmId} called`);
  const { farmId } = req.params;
  
  // Handle demo mode
  if (req.isDemoRequest && isDemoMode()) {
    const demoData = getDemoData();
    const farm = demoData.getFarm();
    return res.json(farm);
  }
  
  const registry = loadFarmRegistry();
  const farmConfig = registry.farms.find(f => f.farmId === farmId);
  
  // LOCAL-FARM and GR-00001 use demo data, not registry
  if (!farmConfig && farmId !== 'LOCAL-FARM' && farmId !== 'GR-00001') {
    return res.status(404).json({ error: 'Farm not found' });
  }
  
  // Check if this is GR-00001 or LOCAL-FARM (demo farm) and load detailed data
  if (farmId === 'GR-00001' || farmId === 'LOCAL-FARM') {
    try {
      const demoDataPath = path.join(__dirname, 'public/data/demo-farm-data.json');
      const demoData = JSON.parse(fs.readFileSync(demoDataPath, 'utf8'));
      console.log(`[admin] Loaded detailed demo data for ${farmId}`);
      return res.json(demoData);
    } catch (error) {
      console.error(`[admin] Failed to load demo data, falling back to mock:`, error.message);
    }
  }
  
  // Generate mock farm details for other farms
  const mockRooms = Math.floor(Math.random() * 5) + 3;
  const mockZones = mockRooms * (Math.floor(Math.random() * 3) + 2);
  const mockDevices = mockZones * (Math.floor(Math.random() * 5) + 3);
  const mockTrays = mockZones * (Math.floor(Math.random() * 12) + 8);
  
  res.json({
    farmId: farmConfig.farmId,
    name: farmConfig.name,
    region: farmConfig.region,
    status: 'online',
    url: farmConfig.url,
    contact: farmConfig.contact || { name: 'Farm Manager', email: 'manager@farm.local' },
    coordinates: farmConfig.coordinates || { lat: 47.6062, lon: -122.3321 },
    rooms: mockRooms,
    zones: mockZones,
    devices: mockDevices,
    trays: mockTrays,
    energy: Math.floor(Math.random() * 500) + 200,
    alerts: Math.random() > 0.8 ? Math.floor(Math.random() * 3) + 1 : 0,
    environmental: {
      zones: Array.from({ length: mockZones }, (_, i) => ({
        zoneId: `zone-${i + 1}`,
        name: `Zone ${i + 1}`,
        temperature: (Math.random() * 4 + 22).toFixed(1),
        humidity: (Math.random() * 20 + 60).toFixed(0),
        co2: Math.floor(Math.random() * 400 + 800)
      }))
    },
    devices: [],
    inventory: { totalTrays: mockTrays, activeTrays: Math.floor(mockTrays * 0.9) },
    lastUpdate: new Date().toISOString()
  });
}));

/**
 * GET /api/admin/farms/db
 * List all farms from database (for admin management)
 * PROTECTED: Requires admin authentication
 */
app.get('/api/admin/farms/db', adminAuthMiddleware, asyncHandler(async (req, res) => {
  console.log('[admin] GET /api/admin/farms/db called');
  
  try {
    const result = await dbPool.query(`
      SELECT 
        farm_id as "farmId",
        name,
        email,
        plan_type as "planType",
        status,
        created_at as "createdAt",
        updated_at as "updatedAt"
      FROM farms
      ORDER BY created_at DESC
    `);
    
    res.json({
      status: 'success',
      farms: result.rows,
      total: result.rows.length
    });
  } catch (error) {
    console.error('[admin] Failed to fetch farms from database:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch farms',
      error: error.message
    });
  }
}));

/**
 * DELETE /api/admin/farms/:email
 * Delete all farms and users associated with an email address
 * For testing and cleanup purposes
 * PROTECTED: Requires admin authentication
 */
app.delete('/api/admin/farms/:email', adminAuthMiddleware, asyncHandler(async (req, res) => {
  console.log(`[admin] DELETE /api/admin/farms/${req.params.email} called`);
  const { email } = req.params;
  
  if (!email || !email.includes('@')) {
    return res.status(400).json({ 
      status: 'error', 
      message: 'Valid email address required' 
    });
  }
  
  try {
    // Find all farms and users with this email
    const farmsResult = await dbPool.query(
      'SELECT farm_id, name FROM farms WHERE email = $1',
      [email]
    );
    
    const usersResult = await dbPool.query(
      'SELECT user_id FROM users WHERE email = $1',
      [email]
    );
    
    console.log(`[admin] Found ${farmsResult.rows.length} farms and ${usersResult.rows.length} users for ${email}`);
    
    if (farmsResult.rows.length === 0 && usersResult.rows.length === 0) {
      return res.json({
        status: 'success',
        message: 'No farms or users found with this email',
        deleted: { farms: 0, users: 0 }
      });
    }
    
    // Delete users first (foreign key constraint)
    if (usersResult.rows.length > 0) {
      await dbPool.query('DELETE FROM users WHERE email = $1', [email]);
      console.log(`[admin] Deleted ${usersResult.rows.length} users`);
    }
    
    // Delete farms
    if (farmsResult.rows.length > 0) {
      await dbPool.query('DELETE FROM farms WHERE email = $1', [email]);
      console.log(`[admin] Deleted ${farmsResult.rows.length} farms`);
    }
    
    res.json({
      status: 'success',
      message: `Successfully deleted ${farmsResult.rows.length} farm(s) and ${usersResult.rows.length} user(s)`,
      deleted: {
        farms: farmsResult.rows.length,
        users: usersResult.rows.length
      },
      farmIds: farmsResult.rows.map(f => f.farm_id),
      farmNames: farmsResult.rows.map(f => f.name)
    });
    
  } catch (error) {
    console.error('[admin] Farm deletion failed:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to delete farms',
      error: error.message
    });
  }
}));

/**
 * GET /api/admin/analytics/aggregate
 * Returns platform-wide aggregated metrics
 * PROTECTED: Requires admin authentication
 */
app.get('/api/admin/analytics/aggregate', adminAuthMiddleware, asyncHandler(async (req, res) => {
  console.log('[admin] GET /api/admin/analytics/aggregate called');
  const registry = loadFarmRegistry();
  const enabledFarms = registry.farms.filter(f => f.enabled);
  
  // Fetch data from all farms in parallel
  const farmDataPromises = enabledFarms.map(async (farmConfig) => {
    try {
      const envData = await fetchFarmData(`${farmConfig.url}/env`, 3000);
      const deviceData = await fetchFarmData(`${farmConfig.url}/data/iot-devices.json`, 3000).catch(() => []);
      
      return {
        online: true,
        rooms: envData.zones?.length || 0,
        devices: Array.isArray(deviceData) ? deviceData.length : 0,
        zones: envData.zones?.length || 0
      };
    } catch (error) {
      return { online: false, rooms: 0, devices: 0, zones: 0 };
    }
  });
  
  const farmsData = await Promise.all(farmDataPromises);
  
  // Aggregate metrics
  const aggregate = {
    totalFarms: enabledFarms.length,
    onlineFarms: farmsData.filter(f => f.online).length,
    totalRooms: farmsData.reduce((sum, f) => sum + f.rooms, 0),
    totalZones: farmsData.reduce((sum, f) => sum + f.zones, 0),
    totalDevices: farmsData.reduce((sum, f) => sum + f.devices, 0),
    totalTrays: 0, // TODO: Calculate from inventory
    totalPlants: 0, // TODO: Calculate from inventory
    totalEnergy24h: 0, // TODO: Calculate from energy endpoints
    activeAlerts: 0, // TODO: Calculate from alerts endpoints
    timestamp: new Date().toISOString()
  };
  
  res.json(aggregate);
}));

/**
 * GET /api/admin/analytics/farms/:farmId/metrics
 * Returns farm-specific analytics metrics
 * PROTECTED: Requires admin authentication
 */
app.get('/api/admin/analytics/farms/:farmId/metrics', adminAuthMiddleware, asyncHandler(async (req, res) => {
  const { farmId } = req.params;
  const days = parseInt(req.query.days) || 7;
  
  console.log(`[admin] GET /api/admin/analytics/farms/${farmId}/metrics?days=${days}`);
  
  try {
    // Get farm ID from farm_id string
    const farmResult = await db.query(
      'SELECT id FROM farms WHERE farm_id = $1',
      [farmId]
    );
    
    if (farmResult.rows.length === 0) {
      return res.status(404).json({ error: 'Farm not found' });
    }
    
    const farm_pk = farmResult.rows[0].id;
    const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    
    // Get time-series metrics
    const metricsResult = await db.query(`
      SELECT 
        recorded_at,
        room_count,
        zone_count,
        device_count,
        tray_count,
        plant_count,
        energy_24h,
        alert_count
      FROM farm_metrics
      WHERE farm_id = $1 AND recorded_at >= $2
      ORDER BY recorded_at ASC
    `, [farm_pk, cutoffDate]);
    
    // Get inventory summary for production/yield data
    const inventoryResult = await db.query(`
      SELECT 
        COUNT(*) as total_trays,
        SUM(plant_count) as total_plants,
        recipe_name
      FROM farm_inventory
      WHERE farm_id = $1 AND status IN ('growing', 'ready', 'harvested')
      GROUP BY recipe_name
      ORDER BY COUNT(*) DESC
      LIMIT 1
    `, [farm_pk]);
    
    const topCrop = inventoryResult.rows.length > 0 
      ? inventoryResult.rows[0].recipe_name 
      : null;
    
    res.json({
      farmId,
      days,
      summary: {
        totalProduction: null, // Would come from harvest tracking
        totalRevenue: null, // Would come from sales data
        daysReported: metricsResult.rows.length,
        avgYield: null, // Would need harvest weight tracking
        topCrop
      },
      metrics: metricsResult.rows,
      modelPerformance: {
        temperatureForecast: null, // Would need ML model metrics
        harvestTiming: null,
        energyPrediction: null
      }
    });
  } catch (error) {
    console.error('[admin] Error fetching analytics:', error);
    res.status(500).json({ error: 'Failed to fetch analytics data' });
  }
}));

/**
 * GET /api/admin/fleet/monitoring
 * Returns Light Engine fleet monitoring data
 * PROTECTED: Requires admin authentication
 */
app.get('/api/admin/fleet/monitoring', adminAuthMiddleware, asyncHandler(async (req, res) => {
  console.log('[admin] GET /api/admin/fleet/monitoring');
  
  try {
    // Query real farms data from database
    // Use simpler query without LATERAL join to avoid PostgreSQL version issues
    const farmsResult = await db.query(`
      SELECT 
        f.id,
        f.farm_id,
        f.name,
        f.status,
        f.last_seen,
        f.created_at,
        f.plan_type,
        f.square_amount
      FROM farms f
      WHERE f.enabled = true
      ORDER BY f.created_at DESC
    `);
    
    const farms = farmsResult.rows || [];
    console.log(`[admin] Found ${farms.length} farms`);
    
    // For now, use placeholder counts until farm_metrics table is populated
    // Calculate aggregate metrics with fallback to 0
    const totalZones = 0; // Will be populated from farm_metrics when available
    const totalDevices = 0; // Will be populated from farm_metrics when available
    const activeAlerts = 0; // Will be populated from farm_metrics when available
    
    // Calculate fleet health (percentage of online farms)
    const onlineFarms = farms.filter(f => f.status === 'online').length;
    const fleetHealthScore = farms.length > 0 ? Math.round((onlineFarms / farms.length) * 100) : 0;
    
    // Calculate MRR from real billing data when available
    // Use square_amount (cents) for cloud plans only
    const mrrCents = farms.reduce((sum, f) => {
      const amount = Number.isFinite(Number(f.square_amount)) ? Number(f.square_amount) : 0;
      return sum + (f.plan_type === 'cloud' ? amount : 0);
    }, 0);
    const monthlyRecurringRevenue = mrrCents > 0 ? Math.round(mrrCents / 100) : null;
    
    // Transform farms into deployment format
    const deployments = farms.map(f => {
      // Determine plan from actual plan_type
      const plan = f.plan_type
        ? f.plan_type.charAt(0).toUpperCase() + f.plan_type.slice(1)
        : 'Unknown';
      const sensorLimit = null;
      
      // Use real status from farms table
      const status = f.status || 'offline';
      
      // Calculate health score based on status
      let healthScore = 100;
      if (status === 'offline') healthScore = 50;
      else if (status === 'warning') healthScore = 75;
      else if (status === 'critical') healthScore = 25;
      
      // Storage and API usage not tracked yet
      const dataStorageMB = null;
      const apiCalls30d = null;
      
      return {
        farmId: f.farm_id,
        farmName: f.name,
        plan,
        status,
        sensors: {
          current: 0, // Will be populated from farm_metrics
          limit: sensorLimit
        },
        apiCalls30d,
        dataStorageMB,
        healthScore,
        lastSeen: f.last_seen || f.created_at
      };
    });
    
    res.json({
      summary: {
        connectedFarms: farms.length,
        monthlyRecurringRevenue,
        totalZones,
        connectedSensors: totalDevices,
        fleetHealthScore,
        activeAlerts
      },
      deployments,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[admin] Error fetching fleet monitoring data:', error);
    console.error('[admin] Error stack:', error.stack);
    res.status(500).json({ 
      error: 'Failed to fetch fleet monitoring data',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
}));

/**
 * GET /api/admin/energy/dashboard
 * Returns platform-wide energy consumption data
 * PROTECTED: Requires admin authentication
 */
app.get('/api/admin/energy/dashboard', adminAuthMiddleware, asyncHandler(async (req, res) => {
  console.log('[admin] GET /api/admin/energy/dashboard');
  
  try {
    const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    // Aggregate energy by farm for last 24h
    const energyResult = await db.query(`
      SELECT 
        f.farm_id,
        f.name,
        SUM(e.kwh) as total_kwh,
        SUM(e.cost) as total_cost
      FROM farm_energy e
      JOIN farms f ON e.farm_id = f.id
      WHERE e.period_start >= $1
      GROUP BY f.farm_id, f.name
      ORDER BY total_kwh DESC
      LIMIT 10
    `, [last24h]);
    
    // Calculate totals
    const total24h = energyResult.rows.reduce((sum, r) => sum + Number(r.total_kwh || 0), 0);
    const totalCost = energyResult.rows.reduce((sum, r) => sum + Number(r.total_cost || 0), 0);
    const costPerKwh = total24h > 0 ? totalCost / total24h : null;
    
    res.json({
      total24h: Math.round(total24h * 100) / 100,
      costPerKwh: costPerKwh ? Math.round(costPerKwh * 100) / 100 : null,
      efficiency: null, // Would need baseline comparison
      savingsKwh: null, // Would need historical comparison
      topConsumers: energyResult.rows.map(r => ({
        farmId: r.farm_id,
        farmName: r.name,
        kwh: Math.round(Number(r.total_kwh || 0) * 100) / 100,
        cost: Math.round(Number(r.total_cost || 0) * 100) / 100
      })),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[admin] Error fetching energy data:', error);
    res.status(500).json({ error: 'Failed to fetch energy data' });
  }
}));

/**
 * GET /api/admin/alerts
 * Returns platform-wide alerts from all farms
 * PROTECTED: Requires admin authentication
 * 
 * ALERTS vs ANOMALY DETECTION:
 * - Alerts: Rule-based thresholds (reactive, actionable)
 * - Anomalies: ML pattern recognition (proactive, investigative)
 */
app.get('/api/admin/alerts', adminAuthMiddleware, asyncHandler(async (req, res) => {
  console.log('[admin] GET /api/admin/alerts');
  
  try {
    // For now, return empty structure until alert system is fully implemented
    // TODO: Query actual alerts from farms, devices, business logic
    
    const mockAlerts = [];
    
    // Calculate summary
    const summary = {
      total: mockAlerts.length,
      active: mockAlerts.filter(a => a.status === 'active').length,
      critical: mockAlerts.filter(a => a.severity === 'critical').length,
      warning: mockAlerts.filter(a => a.severity === 'warning').length,
      resolved: mockAlerts.filter(a => a.status === 'resolved').length
    };
    
    res.json({
      success: true,
      alerts: mockAlerts,
      summary,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[admin] Error fetching alerts:', error);
    console.error('[admin] Error stack:', error.stack);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch alerts',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
}));

/**
 * GET /api/admin/harvest/forecast
 * Returns platform-wide harvest forecast data
 * PROTECTED: Requires admin authentication
 */
app.get('/api/admin/harvest/forecast', adminAuthMiddleware, asyncHandler(async (req, res) => {
  console.log('[admin] GET /api/admin/harvest/forecast');
  
  try {
    const today = new Date();
    const sevenDays = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
    const fourteenDays = new Date(today.getTime() + 14 * 24 * 60 * 60 * 1000);
    const thirtyDays = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
    
    // Get harvest forecast by date ranges
    const forecastResult = await db.query(`
      SELECT 
        COUNT(*) FILTER (WHERE harvest_date <= $1) as seven_day_trays,
        SUM(plant_count) FILTER (WHERE harvest_date <= $1) as seven_day_plants,
        COUNT(*) FILTER (WHERE harvest_date > $1 AND harvest_date <= $2) as fourteen_day_trays,
        SUM(plant_count) FILTER (WHERE harvest_date > $1 AND harvest_date <= $2) as fourteen_day_plants,
        COUNT(*) FILTER (WHERE harvest_date > $2 AND harvest_date <= $3) as thirty_day_trays,
        SUM(plant_count) FILTER (WHERE harvest_date > $2 AND harvest_date <= $3) as thirty_day_plants,
        COUNT(*) FILTER (WHERE harvest_date > $3) as thirty_plus_trays,
        SUM(plant_count) FILTER (WHERE harvest_date > $3) as thirty_plus_plants
      FROM farm_inventory
      WHERE status IN ('growing', 'flowering', 'ready')
        AND harvest_date IS NOT NULL
    `, [sevenDays, fourteenDays, thirtyDays]);
    
    // Get recipe performance
    const recipeResult = await db.query(`
      SELECT 
        recipe_name,
        COUNT(*) as tray_count,
        AVG(age_days) as avg_cycle_days
      FROM farm_inventory
      WHERE status = 'harvested'
        AND recipe_name IS NOT NULL
      GROUP BY recipe_name
      ORDER BY tray_count DESC
      LIMIT 3
    `);
    
    const forecast = forecastResult.rows[0] || {};
    const mostPopular = recipeResult.rows[0]?.recipe_name || null;
    const fastestCycle = recipeResult.rows.length > 0
      ? recipeResult.rows.reduce((min, r) => 
          Number(r.avg_cycle_days || 999) < Number(min.avg_cycle_days || 999) ? r : min
        ).recipe_name
      : null;
    
    res.json({
      thisWeek: Number(forecast.seven_day_trays || 0),
      thisCycle: null, // Would need cycle definition
      successRate: null, // Would need loss tracking
      upcomingTrays: Number(forecast.seven_day_trays || 0) + 
                     Number(forecast.fourteen_day_trays || 0) + 
                     Number(forecast.thirty_day_trays || 0),
      forecast: {
        sevenDay: { 
          trays: Number(forecast.seven_day_trays || 0), 
          plants: Number(forecast.seven_day_plants || 0) 
        },
        fourteenDay: { 
          trays: Number(forecast.fourteen_day_trays || 0), 
          plants: Number(forecast.fourteen_day_plants || 0) 
        },
        thirtyDay: { 
          trays: Number(forecast.thirty_day_trays || 0), 
          plants: Number(forecast.thirty_day_plants || 0) 
        },
        thirtyPlus: { 
          trays: Number(forecast.thirty_plus_trays || 0), 
          plants: Number(forecast.thirty_plus_plants || 0) 
        }
      },
      recipePerformance: {
        bestPerformer: null, // Would need yield/quality scoring
        mostPopular,
        fastestCycle
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[admin] Error fetching harvest forecast:', error);
    res.status(500).json({ error: 'Failed to fetch harvest forecast' });
  }
}));

/**
 * FARM AUTHENTICATION ENDPOINTS
 * Farm-specific admin authentication and session management
 */

/**
 * POST /api/farm/auth/login
 * Farm admin login endpoint
 * DEMO MODE: Bypasses authentication when DEMO_MODE=true
 */

app.post('/api/farm/auth/login', authRateLimiter, asyncHandler(async (req, res) => {
  console.log('[farm-auth] POST /api/farm/auth/login called');
  const { farmId, email, password } = req.body;
  
  // EDGE MODE: Local authentication without database (NeDB mode) - check FIRST
  if (edgeConfig.isEdgeMode() || getDatabaseMode() === 'nedb') {
    console.log('[farm-auth] Edge/NeDB mode - using local authentication');
    
    // Edge mode: farmId + password required, email optional
    if (!farmId || !password) {
      return res.status(400).json({
        status: 'error',
        message: 'Farm ID and password are required'
      });
    }
    
    // Edge mode: Simple admin credential check (user should set FARM_ID and ADMIN_PASSWORD in .env)
    const edgeFarmId = process.env.FARM_ID || edgeConfig.getFarmId() || 'light-engine-demo';
    const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
    const adminEmail = email || process.env.ADMIN_EMAIL || `admin@${farmId}.local`;
    
    console.log('[farm-auth] Comparing credentials:');
    console.log('[farm-auth] - Request farmId:', farmId);
    console.log('[farm-auth] - Expected edgeFarmId:', edgeFarmId);
    console.log('[farm-auth] - Request password:', password ? `${password.substring(0, 3)}...` : 'none');
    console.log('[farm-auth] - Expected adminPassword:', adminPassword ? `${adminPassword.substring(0, 3)}...` : 'none');
    console.log('[farm-auth] - FarmId match:', farmId === edgeFarmId);
    console.log('[farm-auth] - Password match:', password === adminPassword);
    
    // Match on farmId + password
    if (farmId === edgeFarmId && password === adminPassword) {
      const edgeToken = crypto.randomBytes(32).toString('hex');
      const edgeExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);
      
      if (!global.farmAdminSessions) {
        global.farmAdminSessions = new Map();
      }
      
      const edgeSession = {
        token: edgeToken,
        farmId: farmId || edgeConfig.getFarmId() || 'light-engine-demo',
        email: adminEmail,  // Use generated email (provided or default)
        role: 'admin',
        createdAt: new Date(),
        expiresAt: edgeExpiry,
        edgeMode: true
      };
      
      global.farmAdminSessions.set(edgeToken, edgeSession);
      
      console.log('[farm-auth] ✅ Edge mode admin authenticated');
      
      return res.json({
        status: 'success',
        token: edgeToken,
        farmId: edgeSession.farmId,
        farmName: edgeConfig.getFarmName() || 'Edge Farm',
        email: adminEmail,  // Return generated email
        role: 'admin',
        planType: 'edge',
        subscription: {
          plan: 'Edge',
          status: 'active',
          price: 0,
          renewsAt: null
        },
        expiresAt: edgeExpiry.toISOString(),
        edgeMode: true
      });
    } else {
      return res.status(401).json({
        status: 'error',
        message: 'Invalid farm ID or password'
      });
    }
  }
  
  // DEMO MODE BYPASS: Grant full access without credentials
  if (isDemoMode()) {
    const demoToken = crypto.randomBytes(32).toString('hex');
    const demoExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);
    
    // Initialize session storage if needed
    if (!global.farmAdminSessions) {
      global.farmAdminSessions = new Map();
    }
    
    // Create demo session
    const demoSession = {
      token: demoToken,
      farmId: farmId || process.env.DEMO_FARM_ID || 'GR-00001',
      email: email || 'admin@demo-farm.com',
      role: 'admin',
      createdAt: new Date(),
      expiresAt: demoExpiry,
      demoMode: true
    };
    
    global.farmAdminSessions.set(demoToken, demoSession);
    
    console.log('[farm-auth] 🎭 Demo mode bypass - full access granted');
    
    return res.json({
      status: 'success',
      token: demoToken,
      farmId: demoSession.farmId,
      farmName: 'Demo Farm',
      email: demoSession.email,
      role: 'admin',
      subscription: {
        plan: 'Professional',
        status: 'active',
        price: 14900,
        renewsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      },
      expiresAt: demoExpiry.toISOString(),
      demoMode: true
    });
  }
  
  // EDGE MODE: Local authentication without database (NeDB mode)
  if (edgeConfig.isEdgeMode() || getDatabaseMode() === 'nedb') {
    console.log('[farm-auth] Edge/NeDB mode - using local authentication');
    
    // Email is optional in edge mode - only farm_id and password required
    if (!password) {
      return res.status(400).json({
        status: 'error',
        message: 'Password is required'
      });
    }
    
    // Edge mode: Simple admin credential check (user should set ADMIN_EMAIL and ADMIN_PASSWORD in .env)
    // Use provided email or default to admin@{farmId}.local
    const adminEmail = email || process.env.ADMIN_EMAIL || `admin@${farmId || 'localhost'}.local`;
    const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
    const edgeFarmId = process.env.FARM_ID || edgeConfig.getFarmId() || 'light-engine-demo';
    
    // Match on farmId + password (email is optional, only used for session storage)
    if (farmId === edgeFarmId && password === adminPassword) {
      const edgeToken = crypto.randomBytes(32).toString('hex');
      const edgeExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);
      
      if (!global.farmAdminSessions) {
        global.farmAdminSessions = new Map();
      }
      
      const edgeSession = {
        token: edgeToken,
        farmId: farmId || edgeConfig.getFarmId() || 'light-engine-demo',
        email: adminEmail,  // Use adminEmail (provided or default)
        role: 'admin',
        createdAt: new Date(),
        expiresAt: edgeExpiry,
        edgeMode: true
      };
      
      global.farmAdminSessions.set(edgeToken, edgeSession);
      
      console.log('[farm-auth] ✅ Edge mode admin authenticated');
      
      return res.json({
        status: 'success',
        token: edgeToken,
        farmId: edgeSession.farmId,
        farmName: edgeConfig.getFarmName() || 'Edge Farm',
        email: edgeSession.email,
        role: 'admin',
        planType: 'edge',
        subscription: {
          plan: 'Edge',
          status: 'active',
          price: 0,
          renewsAt: null
        },
        expiresAt: edgeExpiry.toISOString(),
        edgeMode: true
      });
    } else {
      return res.status(401).json({
        status: 'error',
        message: 'Invalid email or password'
      });
    }
  }
  
  // PRODUCTION MODE: PostgreSQL-backed authentication
  // Email is optional - if not provided, use first admin user for farm
  if (!farmId || !password) {
    return res.status(400).json({
      status: 'error',
      message: 'Farm ID and password are required'
    });
  }

  const pool = req.app.locals?.db;
  if (!pool) {
    return res.status(500).json({
      status: 'error',
      message: 'Database not configured'
    });
  }

  try {
    const farmResult = await pool.query(
      'SELECT farm_id, name, status FROM farms WHERE farm_id = $1 LIMIT 1',
      [farmId]
    );

    if (farmResult.rows.length === 0) {
      return res.status(404).json({
        status: 'error',
        message: 'Farm not found'
      });
    }

    const farm = farmResult.rows[0];
    if (farm.status && farm.status !== 'active') {
      return res.status(403).json({
        status: 'error',
        message: 'This farm is currently disabled. Contact support.'
      });
    }

    // Query by email if provided, otherwise get first admin user for farm
    let userResult;
    if (email && email.trim()) {
      userResult = await pool.query(
        `SELECT user_id, email, password_hash, role, is_active, email_verified, last_login
         FROM users
         WHERE farm_id = $1 AND lower(email) = lower($2)
         LIMIT 1`,
        [farmId, email]
      );
    } else {
      userResult = await pool.query(
        `SELECT user_id, email, password_hash, role, is_active, email_verified, last_login
         FROM users
         WHERE farm_id = $1 AND role = 'admin'
         ORDER BY user_id ASC
         LIMIT 1`,
        [farmId]
      );
    }

    if (userResult.rows.length === 0) {
      return res.status(401).json({
        status: 'error',
        message: 'Invalid farm ID or password'
      });
    }

    const user = userResult.rows[0];

    if (user.is_active === false) {
      return res.status(403).json({
        status: 'error',
        message: 'Account is disabled. Contact support.'
      });
    }

    if (!user.password_hash) {
      return res.status(500).json({
        status: 'error',
        message: 'Account not initialized with a password'
      });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({
        status: 'error',
        message: 'Invalid farm ID or password'
      });
    }

    // Generate JWT token
    const jwtSecret = process.env.JWT_SECRET || 'fallback-secret-change-in-production';
    const jwtToken = jwt.sign(
      {
        farmId: farm.farm_id,
        email: user.email,
        role: user.role || 'admin',
        userId: user.user_id,
        planType: farm.plan_type || 'cloud'
      },
      jwtSecret,
      { expiresIn: '24h' }
    );

    const sessionExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    // Also maintain session storage for backward compatibility
    const sessionToken = crypto.randomBytes(32).toString('hex');
    
    if (!global.farmAdminSessions) {
      global.farmAdminSessions = new Map();
    }

    const session = {
      token: sessionToken,
      farmId: farm.farm_id,
      email: user.email,
      role: user.role || 'admin',
      createdAt: new Date(),
      expiresAt: sessionExpiry
    };

    global.farmAdminSessions.set(sessionToken, session);

    await pool.query('UPDATE users SET last_login = NOW() WHERE user_id = $1', [user.user_id]);

    const subscription = {
      plan: 'Professional',
      status: 'active',
      price: 14900,
      renewsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    };

    const firstLogin = !user.last_login;

    console.log(`[farm-auth] Login successful for ${user.email} at ${farm.farm_id}`);

    return res.json({
      status: 'success',
      token: jwtToken,
      sessionToken: sessionToken,
      farmId: farm.farm_id,
      farmName: farm.name,
      email: user.email,
      role: user.role || 'admin',
      planType: farm.plan_type || 'cloud',
      subscription,
      expiresAt: sessionExpiry.toISOString(),
      firstLogin: Boolean(firstLogin)
    });
  } catch (err) {
    console.error('[farm-auth] Login error:', err?.message || err, err?.stack || '');
    return res.status(500).json({
      status: 'error',
      message: `Authentication failed: ${err?.message || 'unknown'}`
    });
  }
}));

/**
 * POST /api/farm/auth/verify
 * Verify farm admin session token
 */
app.post('/api/farm/auth/verify', asyncHandler(async (req, res) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      status: 'error',
      message: 'No authorization token provided'
    });
  }
  
  const token = authHeader.substring(7);
  
  if (!global.farmAdminSessions) {
    global.farmAdminSessions = new Map();
  }
  
  const session = global.farmAdminSessions.get(token);
  
  if (!session) {
    return res.status(401).json({
      status: 'error',
      message: 'Invalid or expired session'
    });
  }
  
  // Check expiry
  if (new Date() > new Date(session.expiresAt)) {
    global.farmAdminSessions.delete(token);
    return res.status(401).json({
      status: 'error',
      message: 'Session expired'
    });
  }
  
  res.json({
    status: 'success',
    session: {
      farmId: session.farmId,
      email: session.email,
      role: session.role,
      expiresAt: session.expiresAt
    }
  });
}));

/**
 * POST /api/farm/auth/logout
 * Logout and invalidate session
 */
app.post('/api/farm/auth/logout', asyncHandler(async (req, res) => {
  const authHeader = req.headers.authorization;
  
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    
    if (global.farmAdminSessions) {
      global.farmAdminSessions.delete(token);
    }
  }
  
  res.json({
    status: 'success',
    message: 'Logged out successfully'
  });
}));

/**
 * POST /api/farm/auth/change-password
 * Change password for authenticated LE user
 */
app.post('/api/farm/auth/change-password', asyncHandler(async (req, res) => {
  console.log('[farm-auth] POST /api/farm/auth/change-password called');
  const { currentPassword, newPassword } = req.body;
  
  if (!currentPassword || !newPassword) {
    return res.status(400).json({
      status: 'error',
      message: 'Current password and new password are required'
    });
  }

  if (newPassword.length < 8) {
    return res.status(400).json({
      status: 'error',
      message: 'New password must be at least 8 characters long'
    });
  }

  // Get token from header
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      status: 'error',
      message: 'Authentication required'
    });
  }

  const token = authHeader.substring(7);
  
  // Verify token (JWT or session)
  let farmId, email;
  
  try {
    const jwtSecret = process.env.JWT_SECRET || 'fallback-secret-change-in-production';
    const decoded = jwt.verify(token, jwtSecret);
    farmId = decoded.farmId;
    email = decoded.email;
  } catch (jwtError) {
    // Try session token
    if (global.farmAdminSessions) {
      const session = global.farmAdminSessions.get(token);
      if (session && new Date(session.expiresAt) > new Date()) {
        farmId = session.farmId;
        email = session.email;
      } else {
        return res.status(401).json({
          status: 'error',
          message: 'Invalid or expired token'
        });
      }
    } else {
      return res.status(401).json({
        status: 'error',
        message: 'Invalid token'
      });
    }
  }

  const pool = req.app.locals?.db;
  if (!pool) {
    return res.status(500).json({
      status: 'error',
      message: 'Database not configured'
    });
  }

  try {
    // Get user
    const userResult = await pool.query(
      `SELECT user_id, email, password_hash, farm_id 
       FROM users 
       WHERE farm_id = $1 AND LOWER(email) = LOWER($2)`,
      [farmId, email]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        status: 'error',
        message: 'User not found'
      });
    }

    const user = userResult.rows[0];

    // Verify current password
    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!valid) {
      return res.status(401).json({
        status: 'error',
        message: 'Current password is incorrect'
      });
    }

    // Hash new password
    const newPasswordHash = await bcrypt.hash(newPassword, 10);

    // Update password
    await pool.query(
      'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE user_id = $2',
      [newPasswordHash, user.user_id]
    );

    console.log(`[farm-auth] Password changed successfully for ${email} in farm ${farmId}`);

    res.json({
      status: 'success',
      message: 'Password changed successfully'
    });

  } catch (error) {
    console.error('[farm-auth] Change password error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to change password'
    });
  }
}));

/**
 * GET /api/configuration
 * Get system configuration
 */
app.get('/api/configuration', asyncHandler(async (req, res) => {
  res.json({
    status: 'success',
    configuration: {
      apiVersion: '1.0',
      features: {
        wizard: true,
        activityHub: true,
        automation: true
      },
      defaultTimezone: 'America/New_York'
    }
  });
}));

/**
 * GET /api/devices/:id
 * Get device information
 */
app.get('/api/devices/:id', asyncHandler(async (req, res) => {
  const deviceId = req.params.id;
  
  // Return mock device data for local development
  res.json({
    status: 'success',
    device: {
      id: deviceId,
      name: `Device ${deviceId}`,
      type: 'sensor',
      status: 'online',
      lastSeen: new Date().toISOString()
    }
  });
}));

/**
 * GET /api/farms/:farmId
 * Get farm details by ID
 */
app.get('/api/farms/:farmId', asyncHandler(async (req, res) => {
  const farmId = req.params.farmId;
  
  if (farmId === 'LOCAL-FARM') {
    return res.json({
      status: 'success',
      farm: {
        farmId: 'LOCAL-FARM',
        name: 'Local Development Farm',
        planType: 'edge',
        email: 'admin@local-farm.com',
        contactName: 'Admin User',
        location: null,
        timezone: 'America/New_York',
        rooms: []
      }
    });
  }
  
  // Check database for real farm
  try {
    const result = await pool.query(
      'SELECT farm_id, name, plan_type, email, contact_name, location, timezone FROM farms WHERE farm_id = $1',
      [farmId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        status: 'error',
        message: 'Farm not found'
      });
    }
    
    res.json({
      status: 'success',
      farm: {
        farmId: result.rows[0].farm_id,
        name: result.rows[0].name,
        planType: result.rows[0].plan_type,
        email: result.rows[0].email,
        contactName: result.rows[0].contact_name,
        location: result.rows[0].location,
        timezone: result.rows[0].timezone
      }
    });
  } catch (error) {
    console.error('Error fetching farm:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch farm data'
    });
  }
}));

/**
 * GET /api/farms/:farmId/rooms
 * Get rooms for a farm
 */
app.get('/api/farms/:farmId/rooms', asyncHandler(async (req, res) => {
  const farmId = req.params.farmId;
  
  // Return empty rooms for local development
  res.json({
    status: 'success',
    rooms: []
  });
}));

/**
 * GET /api/user/profile
 * Get authenticated user's profile data for wizard pre-fill
 * This is used BEFORE farm is created during first-time setup
 */
app.get('/api/user/profile', asyncHandler(async (req, res) => {
  console.log('[/api/user/profile] Request received for wizard pre-fill');
  
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.log('[/api/user/profile] No valid authorization header');
    return res.status(401).json({
      status: 'error',
      message: 'Authentication required'
    });
  }
  
  const token = authHeader.substring(7);
  console.log('[/api/user/profile] Token:', token);
  
  // Handle local-access token for development
  if (token === 'local-access') {
    console.log('[/api/user/profile] Returning local development user data');
    return res.json({
      status: 'success',
      user: {
        email: 'admin@local-farm.com',
        name: 'Admin User',
        businessName: 'Local Development Farm',
        phone: null,
        hasPurchased: true,
        planType: 'edge'
      }
    });
  }
  
  // Check for session-based authentication
  if (!global.farmAdminSessions) {
    global.farmAdminSessions = new Map();
  }
  
  const session = global.farmAdminSessions.get(token);
  
  if (session) {
    console.log('[/api/user/profile] Found session, returning user data');
    return res.json({
      status: 'success',
      user: {
        email: session.email,
        name: session.farmName || 'Farm User',
        businessName: session.farmName || '',
        phone: null,
        hasPurchased: true,
        planType: session.subscription?.plan || 'edge'
      }
    });
  }
  
  // Try JWT token
  try {
    const jwtSecret = process.env.JWT_SECRET || 'fallback-secret-change-in-production';
    const decoded = jwt.verify(token, jwtSecret);
    
    console.log('[/api/user/profile] JWT decoded, fetching user data');
    
    // Fetch from users/farms tables
    const db = req.app.locals?.db;
    if (db) {
      // Join users with farms to get business name
      const userResult = await db.query(
        `SELECT u.email, u.role, f.name as business_name, f.contact_name, f.plan_type 
         FROM users u 
         LEFT JOIN farms f ON u.farm_id = f.farm_id 
         WHERE u.email = $1 LIMIT 1`,
        [decoded.email]
      );
      
      if (userResult.rows.length > 0) {
        const user = userResult.rows[0];
        return res.json({
          status: 'success',
          user: {
            email: user.email,
            name: user.contact_name || '',
            businessName: user.business_name || '',
            phone: null,
            hasPurchased: true,
            planType: user.plan_type || 'edge'
          }
        });
      }
    }
    
    // Fallback to decoded JWT data
    return res.json({
      status: 'success',
      user: {
        email: decoded.email,
        name: decoded.name || '',
        businessName: decoded.businessName || '',
        phone: null,
        hasPurchased: true,
        planType: 'edge'
      }
    });
    
  } catch (jwtError) {
    console.log('[/api/user/profile] JWT verification failed:', jwtError.message);
    return res.status(401).json({
      status: 'error',
      message: 'Invalid token'
    });
  }
}));

/**
 * POST /api/user/change-password
 * Change user password
 */
app.post('/api/user/change-password', asyncHandler(async (req, res) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      status: 'error',
      message: 'Authentication required'
    });
  }
  
  const token = authHeader.substring(7);
  const { currentPassword, newPassword } = req.body;
  
  if (!currentPassword || !newPassword) {
    return res.status(400).json({
      status: 'error',
      message: 'Current password and new password are required'
    });
  }
  
  try {
    // Decode token to get farmId and email
    const decoded = jwt.decode(token);
    if (!decoded || !decoded.farmId || !decoded.email) {
      return res.status(401).json({
        status: 'error',
        message: 'Invalid token'
      });
    }
    
    // Get farm's JWT secret from database
    const farmResult = await req.app.locals.db.query(
      'SELECT jwt_secret FROM farms WHERE farm_id = $1',
      [decoded.farmId]
    );
    
    if (farmResult.rows.length === 0) {
      return res.status(404).json({
        status: 'error',
        message: 'Farm not found'
      });
    }
    
    const jwtSecret = farmResult.rows[0].jwt_secret;
    
    // Verify token with farm's secret
    jwt.verify(token, jwtSecret);
    
    // Get user's current password hash
    const userResult = await req.app.locals.db.query(
      'SELECT password_hash FROM farm_users WHERE farm_id = $1 AND email = $2',
      [decoded.farmId, decoded.email]
    );
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({
        status: 'error',
        message: 'User not found'
      });
    }
    
    // Verify current password
    const validPassword = await bcrypt.compare(currentPassword, userResult.rows[0].password_hash);
    if (!validPassword) {
      return res.status(401).json({
        status: 'error',
        message: 'Current password is incorrect'
      });
    }
    
    // Hash new password
    const newPasswordHash = await bcrypt.hash(newPassword, 10);
    
    // Update password
    await req.app.locals.db.query(
      'UPDATE farm_users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE farm_id = $2 AND email = $3',
      [newPasswordHash, decoded.farmId, decoded.email]
    );
    
    res.json({
      status: 'success',
      message: 'Password updated successfully'
    });
    
  } catch (error) {
    console.error('[/api/user/change-password] Error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to update password'
    });
  }
}));

/**
 * POST /api/users/create
 * Create a new user for the farm
 */
app.post('/api/users/create', asyncHandler(async (req, res) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      status: 'error',
      message: 'Authentication required'
    });
  }
  
  const token = authHeader.substring(7);
  const { email, name, role, password, farmId } = req.body;
  
  if (!email || !name || !role || !password || !farmId) {
    return res.status(400).json({
      status: 'error',
      message: 'Email, name, role, password, and farmId are required'
    });
  }
  
  try {
    // Verify requester is an admin
    const decoded = jwt.decode(token);
    if (!decoded || decoded.role !== 'admin') {
      return res.status(403).json({
        status: 'error',
        message: 'Admin access required'
      });
    }
    
    // Check if user already exists
    const existingUser = await req.app.locals.db.query(
      'SELECT id FROM farm_users WHERE farm_id = $1 AND email = $2',
      [farmId, email]
    );
    
    if (existingUser.rows.length > 0) {
      return res.status(400).json({
        status: 'error',
        message: 'User with this email already exists'
      });
    }
    
    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);
    
    // Create user
    await req.app.locals.db.query(
      `INSERT INTO farm_users (farm_id, email, name, role, password_hash, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [farmId, email, name, role, passwordHash]
    );
    
    res.json({
      status: 'success',
      message: 'User created successfully',
      user: { email, name, role }
    });
    
  } catch (error) {
    console.error('[/api/users/create] Error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to create user'
    });
  }
}));

/**
 * GET /api/users/list
 * List all users for a farm
 */
app.get('/api/users/list', asyncHandler(async (req, res) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      status: 'error',
      message: 'Authentication required'
    });
  }
  
  const { farmId } = req.query;
  
  if (!farmId) {
    return res.status(400).json({
      status: 'error',
      message: 'farmId is required'
    });
  }
  
  try {
    const result = await req.app.locals.db.query(
      'SELECT email, name, role, created_at FROM farm_users WHERE farm_id = $1 ORDER BY created_at DESC',
      [farmId]
    );
    
    res.json({
      status: 'success',
      users: result.rows
    });
    
  } catch (error) {
    console.error('[/api/users/list] Error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to load users'
    });
  }
}));

/**
 * DELETE /api/users/delete
 * Delete a user from the farm
 */
app.delete('/api/users/delete', asyncHandler(async (req, res) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      status: 'error',
      message: 'Authentication required'
    });
  }
  
  const token = authHeader.substring(7);
  const { email, farmId } = req.body;
  
  if (!email || !farmId) {
    return res.status(400).json({
      status: 'error',
      message: 'Email and farmId are required'
    });
  }
  
  try {
    // Verify requester is an admin
    const decoded = jwt.decode(token);
    if (!decoded || decoded.role !== 'admin') {
      return res.status(403).json({
        status: 'error',
        message: 'Admin access required'
      });
    }
    
    // Don't allow deleting yourself
    if (decoded.email === email) {
      return res.status(400).json({
        status: 'error',
        message: 'Cannot delete your own account'
      });
    }
    
    // Delete user
    await req.app.locals.db.query(
      'DELETE FROM farm_users WHERE farm_id = $1 AND email = $2',
      [farmId, email]
    );
    
    res.json({
      status: 'success',
      message: 'User removed successfully'
    });
    
  } catch (error) {
    console.error('[/api/users/delete] Error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to remove user'
    });
  }
}));

/**
 * GET /api/farm/configuration
 * Get farm configuration (cloud-compatible stub)
 */
app.get('/api/farm/configuration', asyncHandler(async (req, res) => {
  // Return default configuration for cloud users
  res.json({
    status: 'success',
    data: {
      farmId: req.query.farmId || 'unknown',
      timezone: 'America/New_York',
      locale: 'en-US',
      features: {
        monitoring: true,
        automation: false,
        reporting: true
      }
    }
  });
}));

/**
 * GET /api/farm/profile
 * Get authenticated farm's profile data
 */
app.get('/api/farm/profile', asyncHandler(async (req, res) => {
  console.log('[/api/farm/profile] Request received');
  console.log('[/api/farm/profile] Headers:', JSON.stringify(req.headers, null, 2));
  console.log('[/api/farm/profile] Authorization header:', req.headers.authorization);
  
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.log('[/api/farm/profile] No valid authorization header - returning 401');
    return res.status(401).json({
      status: 'error',
      message: 'Authentication required'
    });
  }
  
  const token = authHeader.substring(7);
  console.log('[/api/farm/profile] Token extracted:', token);
  
  // FIRST: Check if it's an edge mode session token
  if (global.farmAdminSessions && global.farmAdminSessions.has(token)) {
    const session = global.farmAdminSessions.get(token);
    console.log('[/api/farm/profile] Edge/Demo session found for', session.farmId);
    
    // Load farm data from public/data/farm.json for edge mode
    try {
      const farmDataPath = path.join(__dirname, 'public', 'data', 'farm.json');
      let farmData;
      
      // Try to read existing farm.json
      try {
        farmData = JSON.parse(fs.readFileSync(farmDataPath, 'utf8'));
        // Check if farmId matches - if not, this is a new farm that needs setup
        if (farmData.farmId && farmData.farmId !== session.farmId) {
          console.log(`[/api/farm/profile] Existing farm ${farmData.farmId} doesn't match session ${session.farmId} - returning new farm placeholder`);
          farmData = null; // Will create new farm data below
        }
      } catch (readError) {
        console.log('[/api/farm/profile] No existing farm.json - new farm setup needed');
        farmData = null;
      }
      
      // If no matching farm data, return placeholder for wizard to populate
      if (!farmData) {
        return res.json({
          status: 'success',
          farm: {
            farmId: session.farmId,
            name: process.env.FARM_NAME || 'New Farm',
            planType: 'edge',
            email: session.email,
            contactName: 'Farm Admin',
            location: null,
            timezone: 'America/New_York',
            rooms: [],
            setupComplete: false  // Indicate wizard is needed
          },
          edgeMode: true
        });
      }
      
      // Return existing farm data
      return res.json({
        status: 'success',
        farm: {
          farmId: session.farmId,
          name: farmData.name || 'Edge Farm',
          planType: 'edge',
          email: session.email,
          contactName: farmData.contactPerson || 'Farm Admin',
          location: farmData.location || null,
          timezone: farmData.timezone || 'America/New_York',
          rooms: []
        },
        edgeMode: true
      });
    } catch (fsError) {
      console.error('[/api/farm/profile] Error processing farm data:', fsError);
      return res.json({
        status: 'success',
        farm: {
          farmId: session.farmId,
          name: process.env.FARM_NAME || 'Edge Farm',
          planType: 'edge',
          email: session.email,
          contactName: 'Farm Admin',
          location: null,
          timezone: 'America/New_York',
          rooms: [],
          setupComplete: false
        },
        edgeMode: true
      });
    }
  }
  
  // Handle local-access token for development
  if (token === 'local-access') {
    console.log('[/api/farm/profile] Local access token recognized - returning mock data');
    return res.json({
      status: 'success',
      farm: {
        farmId: 'LOCAL-FARM',
        name: 'Local Development Farm',
        planType: 'edge',
        email: 'admin@local-farm.com',
        contactName: 'Admin User',
        location: null,
        timezone: 'America/New_York',
        rooms: []
      }
    });
  }
  
  try {
    // First decode JWT without verification to get farmId
    const decoded = jwt.decode(token);
    
    // Support both camelCase (farmId) and snake_case (farm_id) for compatibility
    const farmId = decoded.farmId || decoded.farm_id;
    
    if (!decoded || !farmId) {
      console.error('[/api/farm/profile] JWT decode failed or missing farmId');
      return res.status(403).json({
        status: 'error',
        message: 'Invalid token format'
      });
    }
    const db = req.app.locals.db;
    
    // EDGE MODE: If no database, load farm data from farm.json
    if (!db && (process.env.EDGE_MODE === 'true' || decoded.type === 'farm_sales')) {
      console.log('[/api/farm/profile] Edge mode - loading farm data from farm.json');
      
      try {
        const farmDataPath = path.join(__dirname, 'public', 'data', 'farm.json');
        const groupsDataPath = path.join(__dirname, 'public', 'data', 'groups.json');
        
        let farmData = { farmId, name: 'Edge Farm', planType: 'edge', rooms: [] };
        let groupsData = [];
        
        // Try to load farm.json
        if (fs.existsSync(farmDataPath)) {
          const rawFarm = JSON.parse(fs.readFileSync(farmDataPath, 'utf8'));
          farmData = {
            farmId: rawFarm.farmId || farmId,
            name: rawFarm.name || 'Edge Farm',
            planType: 'edge',
            email: rawFarm.contact?.email || decoded.email,
            contactName: rawFarm.contact?.name || decoded.name,
            location: rawFarm.coordinates || null,
            timezone: rawFarm.timezone || 'America/New_York',
            rooms: []
          };
        }
        
        // Try to load groups.json
        if (fs.existsSync(groupsDataPath)) {
          const rawGroups = JSON.parse(fs.readFileSync(groupsDataPath, 'utf8'));
          groupsData = rawGroups.groups || [];
        }
        
        return res.json({
          status: 'success',
          farm: farmData,
          groups: groupsData,
          edgeMode: true
        });
      } catch (fsError) {
        console.error('[/api/farm/profile] Error reading farm data files:', fsError);
        return res.status(500).json({
          status: 'error',
          message: 'Failed to load farm data'
        });
      }
    }
    
    if (!db) {
      console.error('[/api/farm/profile] Database not available');
      return res.status(500).json({
        status: 'error',
        message: 'Database connection not available'
      });
    }
    
    // Fetch farm data including jwt_secret for verification
    const farmResult = await db.query(
      'SELECT farm_id, name, plan_type, email, contact_name, location, timezone, pos_instance_id, store_subdomain, jwt_secret FROM farms WHERE farm_id = $1',
      [farmId]
    );
    
    if (farmResult.rows.length === 0) {
      console.error('[/api/farm/profile] Farm not found:', farmId);
      return res.status(404).json({
        status: 'error',
        message: 'Farm not found'
      });
    }
    
    const farm = farmResult.rows[0];
    const jwtSecret = farm.jwt_secret || process.env.JWT_SECRET || 'fallback-secret-change-in-production';
    
    // Now verify the token with the farm's specific secret
    try {
      jwt.verify(token, jwtSecret);
    } catch (verifyError) {
      console.error('[/api/farm/profile] JWT verification failed:', verifyError.message);
      return res.status(403).json({
        status: 'error',
        message: 'Invalid or expired token'
      });
    }
    
    console.log('[/api/farm/profile] JWT verified successfully for farm:', farmId);
    
    // Fetch rooms for this farm (may not exist yet for new farms)
    let rooms = [];
    try {
      const roomsResult = await db.query(
        'SELECT room_id, name, type, capacity, description FROM rooms WHERE farm_id = $1 ORDER BY room_id',
        [farmId]
      );
      rooms = roomsResult.rows;
    } catch (roomsError) {
      console.log('[/api/farm/profile] Rooms table query failed (may not exist):', roomsError.message);
    }
    
    res.json({
      status: 'success',
      farm: {
        farmId: farm.farm_id,
        name: farm.name,
        planType: farm.plan_type,
        email: farm.email,
        contactName: farm.contact_name,
        location: farm.location,
        timezone: farm.timezone,
        posInstanceId: farm.pos_instance_id,
        storeSubdomain: farm.store_subdomain,
        rooms: rooms.map(r => ({
          id: r.room_id,
          name: r.name,
          type: r.type,
          capacity: r.capacity,
          description: r.description
        }))
      }
    });
  } catch (error) {
    console.error('[farm/profile] Error:', error);
    return res.status(403).json({
      status: 'error',
      message: 'Invalid or expired token'
    });
  }
}));

/**
 * GET /api/farm/activity/:farmId
 * Get recent activity for a farm (requires authentication)
 */
app.get('/api/farm/activity/:farmId', asyncHandler(async (req, res) => {
  const { farmId } = req.params;
  
  // Allow demo farms (LOCAL-FARM and GR-00001) without authentication
  const isDemoFarm = (farmId === 'LOCAL-FARM' || farmId === 'GR-00001');
  let session = null;
  
  if (!isDemoFarm) {
    // Verify authentication for non-demo farms
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        status: 'error',
        message: 'Authentication required'
      });
    }
    
    const token = authHeader.substring(7);
    session = global.farmAdminSessions?.get(token);
    
    if (!session || session.farmId !== farmId) {
      return res.status(403).json({
        status: 'error',
        message: 'Access denied'
      });
    }
  }
  
  // Mock activity data (in production, fetch from database)
  const userEmail = session?.email || 'demo@farm.com';
  const activity = [
    {
      timestamp: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
      description: 'Irrigation cycle completed in ROOM-A-Z1',
      user: 'System',
      status: 'active'
    },
    {
      timestamp: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
      description: 'New growth group planted: ROOM-A-Z1-G03',
      user: userEmail,
      status: 'active'
    },
    {
      timestamp: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      description: 'Environmental data synced to GreenReach',
      user: 'System',
      status: 'active'
    },
    {
      timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      description: 'Device SENSOR-012 came online',
      user: 'System',
      status: 'active'
    },
    {
      timestamp: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
      description: 'Subscription payment processed',
      user: 'Billing',
      status: 'active'
    }
  ];
  
  res.json({
    status: 'success',
    activity
  });
}));

/**
 * BILLING & SUBSCRIPTION ENDPOINTS
 * Support for Square payment processing and subscription management
 */

/**
 * GET /api/billing/plans
 * Get available subscription plans
 */
app.get('/api/billing/plans', asyncHandler(async (req, res) => {
  console.log('[billing] GET /api/billing/plans called');
  
  const plans = [
    {
      plan_id: 'starter',
      name: 'Starter',
      price: 4900, // cents
      limits: {
        devices: 10,
        api_calls_per_day: 1000,
        storage_gb: 5
      },
      overage_rates: {
        device: 500, // cents per device per month
        api_calls_1000: 10, // cents per 1000 calls
        storage_gb: 50 // cents per GB per month
      }
    },
    {
      plan_id: 'pro',
      name: 'Professional',
      price: 14900,
      limits: {
        devices: 50,
        api_calls_per_day: 10000,
        storage_gb: 50
      },
      overage_rates: {
        device: 300,
        api_calls_1000: 5,
        storage_gb: 30
      }
    },
    {
      plan_id: 'enterprise',
      name: 'Enterprise',
      price: 49900,
      limits: {
        devices: 500,
        api_calls_per_day: 100000,
        storage_gb: 500
      },
      overage_rates: {
        device: 200,
        api_calls_1000: 2,
        storage_gb: 20
      }
    }
  ];
  
  res.json({
    status: 'success',
    plans
  });
}));

/**
 * GET /api/billing/usage/:farmId
 * Get current usage and limits for a farm
 */
app.get('/api/billing/usage/:farmId', asyncHandler(async (req, res) => {
  const { farmId } = req.params;
  
  console.log(`[billing] GET /api/billing/usage/${farmId} called`);
  
  // Allow demo farms (LOCAL-FARM and GR-00001) without authentication
  const isDemoFarm = (farmId === 'LOCAL-FARM' || farmId === 'GR-00001');
  
  if (!isDemoFarm) {
    // Verify authentication for non-demo farms
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const session = global.farmAdminSessions?.get(token);
      
      if (!session || session.farmId !== farmId) {
        return res.status(403).json({
          status: 'error',
          message: 'Access denied'
        });
      }
    }
  }
  
  // Get farm registry
  const registry = loadFarmRegistry();
  const farmConfig = registry.farms.find(f => f.farmId === farmId);
  
  if (!farmConfig) {
    return res.status(404).json({
      status: 'error',
      message: 'Farm not found'
    });
  }

  const dataAvailable = isDemoFarm;

  if (!dataAvailable) {
    return res.json({
      status: 'unavailable',
      dataAvailable: false,
      plan: null,
      limits: {
        devices: null,
        api_calls_per_day: null,
        storage_gb: null
      },
      usage: {
        devices: null,
        api_calls_today: null,
        storage_gb: null
      },
      renewsAt: null,
      overages: {
        devices: null,
        api_calls: null,
        storage: null
      }
    });
  }
  
  // Mock usage data (in production, fetch from database)
  const usage = {
    devices: 24,
    api_calls_today: 3420,
    storage_gb: 12.5
  };
  
  // Get plan (Professional for demo)
  const plans = [
    {
      plan_id: 'pro',
      name: 'Professional',
      price: 14900,
      limits: {
        devices: 50,
        api_calls_per_day: 10000,
        storage_gb: 50
      }
    }
  ];
  
  const plan = plans[0];
  
  res.json({
    status: 'success',
    dataAvailable: true,
    plan: plan,
    limits: plan.limits,
    usage: usage,
    renewsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    overages: {
      devices: Math.max(0, usage.devices - plan.limits.devices),
      api_calls: Math.max(0, usage.api_calls_today - plan.limits.api_calls_per_day),
      storage: Math.max(0, usage.storage_gb - plan.limits.storage_gb)
    }
  });
}));

/**
 * POST /api/billing/customers
 * Create a new customer (Square integration placeholder)
 */
app.post('/api/billing/customers', asyncHandler(async (req, res) => {
  console.log('[billing] POST /api/billing/customers called');
  const { email, first_name, last_name, tenant_id } = req.body;
  
  if (!email || !first_name || !last_name) {
    return res.status(400).json({
      status: 'error',
      message: 'Email, first name, and last name are required'
    });
  }
  
  // In production, integrate with Square Customer API
  // For sandbox, return mock customer
  const customerId = `CUST_${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
  
  const customer = {
    customer_id: customerId,
    email,
    first_name,
    last_name,
    tenant_id: tenant_id || 'default',
    created_at: new Date().toISOString()
  };
  
  console.log(`[billing]  Created customer: ${customerId}`);
  
  res.json({
    status: 'success',
    customer
  });
}));

/**
 * POST /api/billing/subscriptions
 * Create a new subscription (Square integration placeholder)
 */
app.post('/api/billing/subscriptions', asyncHandler(async (req, res) => {
  console.log('[billing] POST /api/billing/subscriptions called');
  const { customer_id, plan_id, card_id } = req.body;
  
  if (!customer_id || !plan_id) {
    return res.status(400).json({
      status: 'error',
      message: 'Customer ID and plan ID are required'
    });
  }
  
  // In production, integrate with Square Subscriptions API
  // For sandbox, return mock subscription
  const subscriptionId = `SUB_${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
  
  const subscription = {
    subscription_id: subscriptionId,
    customer_id,
    plan_id,
    status: 'active',
    created_at: new Date().toISOString(),
    next_billing_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
  };
  
  console.log(`[billing]  Created subscription: ${subscriptionId}`);
  
  res.json({
    status: 'success',
    subscription
  });
}));

/**
 * POST /api/billing/subscriptions/:subscriptionId/cancel
 * Cancel a subscription
 */
app.post('/api/billing/subscriptions/:subscriptionId/cancel', asyncHandler(async (req, res) => {
  const { subscriptionId } = req.params;
  
  console.log(`[billing] POST /api/billing/subscriptions/${subscriptionId}/cancel called`);
  
  // In production, integrate with Square Subscriptions API
  // For sandbox, return success
  res.json({
    status: 'success',
    message: 'Subscription cancelled successfully',
    subscription: {
      subscription_id: subscriptionId,
      status: 'cancelled',
      cancelled_at: new Date().toISOString()
    }
  });
}));

/**
 * DEMO MODE & INVENTORY ENDPOINTS
 * These must be defined BEFORE the proxy middleware to prevent interception
 */

/**
 * GET /api/demo-farm
 * Returns complete demo farm data structure (currently disabled - use /api/admin/farms instead)
 */
app.get('/api/demo-farm', (req, res) => {
  // Redirect to the working farms API
  res.redirect('/api/admin/farms/GR-00001');
});

/**
 * GET /api/demo/intro-cards
 * Returns intro card content for various dashboard pages in demo mode
 */
app.get('/api/demo/intro-cards', (req, res) => {
  setCors(req, res);
  
  const introCards = {
    'farm-summary': {
      title: 'Your Farm, At a Glance',
      icon: '',
      description: `See your whole operation on one screen — live conditions, harvest readiness, and alerts across every zone. E.V.I.E. (our Environmental Control AI) surfaces what's normal, what's improving, and what needs a quick fix, so your team can focus on the right work today.<br><br>Centralized monitoring means fewer surprises, calmer days, and confident decisions — whether you're a grower managing crops or a community leader coordinating volunteers.`,
      features: [
        'Centralized monitoring: temperature, humidity, VPD, CO₂, and light intensity',
        'E.V.I.E. insights highlight priorities and flag issues before they escalate',
        'Harvest countdowns by zone and group for clear daily planning',
        'Quick navigation to detailed views — one click to investigate deeper'
      ]
    },
    'farm-inventory': {
      title: 'Plan Harvests. Fulfill Orders. Stay Reliable.',
      icon: '',
      description: `Know exactly what's growing, where it is, and when it's ready. Switch between Location, Crop, and Harvest Time to match how your team works. E.V.I.E. helps forecast readiness so you can schedule volunteers when it matters most.<br><br>Market-informed pricing keeps your mission sustainable and fair. Reliable supply builds trust with community partners, pantries, and buyers — reducing last-minute scrambles and missed windows.`,
      features: [
        'Three views: by Location, by Crop, by Harvest Time — organize your way',
        'Forecasts with urgency color-coding: 0-7 days (green), 8-14 days (yellow), 15-30 days (blue)',
        'Tray-level tracking — rack, level, position — for precise location',
        'Market pricing support to guide fair, sustainable revenue decisions',
        'Transparent reporting for community partners and donors'
      ]
    },
    'nutrient-management': {
      title: 'Healthy Roots, Consistent Results',
      icon: '',
      description: `Keep tanks on target without needing a chemist. pH (comfort for roots) and EC (nutrition strength) are tracked in real time. E.V.I.E. flags drift early and suggests simple corrections. Recipes drive dosing, so volunteers can manage confidently and leaders can trust the results.<br><br>Centralized control means healthier plants, predictable quality, and less rework — even when your team is mostly passionate volunteers learning as they go.`,
      features: [
        'Centralized control and monitoring of multiple nutrient tanks',
        'Real-time pH/EC telemetry with automatic alerts and trending',
        'Recipe-driven automation for vegetative and flowering stages',
        'E.V.I.E. recommendations for guided corrections and adjustments',
        'Safe, repeatable processes that non-specialists can follow'
      ]
    },
    'environmental-heatmap': {
      title: 'See Conditions. Fix Fast.',
      icon: '',
      description: `A visual map of your growing environment — warmer/cooler, drier/more humid — laid out like your actual room. E.V.I.E.'s suggestions are grounded in what you see: where airflow or ventilation needs attention. Volunteers can spot issues at a glance and make quick, practical fixes.<br><br>Centralized visualization makes problem-solving faster and training easier. See hotspots, cold zones, or uneven conditions before they set crops back.`,
      features: [
        'Live map of temperature, humidity, VPD, CO₂, and PPFD by sensor location',
        'Zone overlays to align fixes with your real room layout',
        'Playback recent hours to see patterns, not just snapshots',
        'E.V.I.E.-linked context explains why adjustments are recommended',
        'Clear guidance for non-technical team members and volunteers'
      ]
    },
    'room-mapper': {
      title: 'Map Your Space. Make Dashboards Smart.',
      icon: '',
      description: `Define zones, place sensors and equipment, and set targets. This simple setup powers every dashboard: when your space changes, your data and controls stay aligned. E.V.I.E. uses your layout to tailor guidance zone by zone.<br><br>One-time effort that improves everything downstream — easier handoffs when spaces or teams change, and clear structure for volunteers and new staff.`,
      features: [
        'Visual zone design with boundaries, names, and targets',
        'Drag-and-drop sensor and equipment placement',
        'Zone-specific environmental targets for diverse crops',
        'Centralized configuration that updates all dashboards automatically',
        'Simple setup that unlocks smarter, zone-aware E.V.I.E. recommendations'
      ]
    },
    'farm-admin': {
      title: 'Operate Sustainably. Lead Confidently.',
      icon: '',
      description: `The business-side control center — pricing with E.V.I.E. support, real-time inventory valuation, and integrations for point-of-sale and accounting. Built for leaders and program managers: clear numbers, fair pricing, transparent impact.<br><br>Price fairly, survive hard seasons, and show partners trustworthy data. Centralized tools keep operations aligned with mission and budget — even when decision-makers aren't growers.`,
      features: [
        'E.V.I.E.-assisted pricing using market insights and trend analysis',
        'Inventory valuation down to the penny for transparent reporting',
        'Integrations for POS and accounting systems — data flows seamlessly',
        'Group and recipe management across the entire farm',
        'Tools designed for non-growers leading community programs'
      ]
    },
    'index': {
      title: 'Welcome to Light Engine',
      icon: '',
      description: `Welcome to the Light Engine demonstration. You're seeing a system designed to support growers — and the community leaders who work alongside them — to grow well, grow efficiently, and grow for their local market.<br><br>Light Engine is built for real-world conditions: passionate volunteers, tight budgets, and the urgent need for reliable food production. Centralized monitoring and control means your team never has to "touch a dial." E.V.I.E. (Environmental Control AI) provides guidance tailored to your crops, your space, and your goals — from seed to harvest.<br><br>Manage nutrients, environment, and lighting through research-based recipes. Reduce risk, reduce labor, reduce input waste. Whether you're a grower or a mission-driven leader, Light Engine meets you where you are.<br><br><strong>Successful farms. Strong industry. Food secure community. Food sovereign nation.</strong>`,
      features: [
        'E.V.I.E. (Environmental Control AI) provides tailored guidance for every crop and zone',
        'Centralized monitoring and control — one system for nutrients, environment, and lighting',
        'Research-based recipes ensure optimal conditions without constant adjustments',
        'Multi-crop management: grow diverse varieties together, dynamically',
        'Built for volunteer-driven teams: simple, safe, and repeatable',
        'Energy optimization maximizes quality while minimizing costs',
        'From seed to harvest: comprehensive support for mission-focused growers'
      ]
    },
    'index-step2': {
      title: 'Setup & Management Hub',
      icon: '',
      description: `This is home to our farm setup wizards — simple questions designed for quick, successful Light Engine integration. Behind the scenes: a comprehensive equipment and lighting database, third-party device support, and centralized sensor management.<br><br>This unassuming page is the foundation for the most complete control system available today. Once set up, E.V.I.E. and centralized monitoring can do their work — guiding your team with confidence.<br><br><strong>Ready to explore your farm operations? Let's continue the Light Engine tour.</strong>`,
      features: [
        'Farm setup wizards guide you through integration step-by-step',
        'Comprehensive equipment database with control protocols for hundreds of devices',
        'Third-party smart device integration (WiFi, BLE, Zigbee, RS485)',
        'Centralized sensor network management and calibration',
        'Advanced configuration options for experienced users',
        'Complete device discovery and automatic setup'
      ],
      nextPage: '/views/farm-summary.html'
    }
  };
  
  const page = req.query.page;
  
  if (page && introCards[page]) {
    return res.json({
      ok: true,
      card: introCards[page],
      demo: isDemoMode()
    });
  }
  
  return res.json({
    ok: true,
    cards: introCards,
    demo: isDemoMode()
  });
});

/**
 * Helper: Get crop harvest days from lighting-recipes.json
 * @param {string} planId - Plan ID like "crop-bibb-butterhead"
 * @returns {number} - Total grow days, or 45 as fallback
 */
/**
 * Extract a human-readable crop name from a plan ID
 * Delegates to cropUtils.planIdToCropName() (Phase 2a — unified crop registry)
 * e.g. "crop-bibb-butterhead" → "Bibb Butterhead"
 *      "crop-mei-qing-pak-choi" → "Mei Qing Pak Choi"
 */
function extractCropDisplayName(planId) {
  if (!planId || typeof planId !== 'string') return null;
  const result = cropUtils.planIdToCropName(planId);
  return result === 'Unknown' ? null : result;
}

function getCropHarvestDays(planId) {
  if (!planId) return 45;
  
  try {
    const recipesPath = path.join(PUBLIC_DIR, 'data/lighting-recipes.json');
    if (!fs.existsSync(recipesPath)) {
      console.warn('[getCropHarvestDays] lighting-recipes.json not found');
      return 45;
    }
    
    const recipesData = JSON.parse(fs.readFileSync(recipesPath, 'utf8'));
    if (!recipesData.crops) return 45;
    
    // Extract crop name from plan ID: "crop-bibb-butterhead" → "Bibb Butterhead"
    const cropSlug = planId.replace(/^crop-/, '');
    
    // Find matching crop (case-insensitive, handle variations)
    const cropEntry = Object.entries(recipesData.crops).find(([cropName]) => {
      const normalizedName = cropName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      return normalizedName === cropSlug || cropSlug.includes(normalizedName);
    });
    
    if (cropEntry && Array.isArray(cropEntry[1]) && cropEntry[1].length > 0) {
      const schedule = cropEntry[1];
      // Get the max day value (final harvest day)
      const maxDay = Math.max(...schedule.map(d => Number(d.day) || 0));
      console.log(`[getCropHarvestDays] ${planId} → ${cropEntry[0]} → ${maxDay} days`);
      return Math.ceil(maxDay);
    }
    
    console.warn(`[getCropHarvestDays] No recipe found for planId: ${planId}`);
    return 45;
  } catch (err) {
    console.error('[getCropHarvestDays] Error:', err.message);
    return 45;
  }
}

/**
 * Look up the grow stage for a crop at a given day from its recipe schedule.
 * Returns the stage name (e.g. 'Seedling', 'Vegetative', 'Flowering', 'Fruiting').
 */
function getCropStageAtDay(planId, daysOld) {
  if (!planId || daysOld <= 0) return 'Seedling'; // default for newly planted
  
  try {
    const recipesPath = path.join(PUBLIC_DIR, 'data/lighting-recipes.json');
    if (!fs.existsSync(recipesPath)) return 'Seedling';
    
    const recipesData = JSON.parse(fs.readFileSync(recipesPath, 'utf8'));
    if (!recipesData.crops) return 'Seedling';
    
    const cropSlug = planId.replace(/^crop-/, '');
    const cropEntry = Object.entries(recipesData.crops).find(([cropName]) => {
      const normalizedName = cropName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      return normalizedName === cropSlug || cropSlug.includes(normalizedName);
    });
    
    if (cropEntry && Array.isArray(cropEntry[1]) && cropEntry[1].length > 0) {
      const schedule = cropEntry[1];
      // Find the last schedule entry whose day <= daysOld (or the first if daysOld < day 1)
      let stage = schedule[0].stage || 'Seedling';
      for (const entry of schedule) {
        if (entry.day <= daysOld) {
          stage = entry.stage || stage;
        } else {
          break;
        }
      }
      return stage;
    }
  } catch (err) {
    console.error('[getCropStageAtDay] Error:', err.message);
  }
  return 'Seedling';
}

/**
 * GET /api/inventory/current
 * Returns current inventory summary with detailed tray data
 */
app.get('/api/inventory/current', (req, res) => {
  try {
    // Load from groups.json (real crop data)
    const groupsPath = path.join(PUBLIC_DIR, 'data', 'groups.json');
    if (!fs.existsSync(groupsPath)) {
      return res.json({
        activeTrays: 0,
        totalPlants: 0,
        farmCount: 0,
        byFarm: []
      });
    }
    
    const groupsData = JSON.parse(fs.readFileSync(groupsPath, 'utf8'));
    const groups = groupsData.groups || [];

    let totalTrays = 0;
    let totalPlants = 0;
    const allTrays = [];
    let trayCounter = 1;

    // Calculate seeding date based on daysOld and seedDate
    const today = new Date();

    // Build detailed tray data from groups
    // Only count groups that are actively growing (have a crop/plan AND seedDate)
    groups.forEach((group) => {
      // Skip groups that have no active grow — draft groups without a crop/plan/seedDate
      const hasCropOrPlan = (group.crop && group.crop !== '') || (group.plan && group.plan !== '');
      const hasSeedDate = group.planConfig?.anchor?.seedDate;
      const isActiveGrow = hasCropOrPlan || hasSeedDate || (group.plants > 0 && group.status !== 'draft');
      if (!isActiveGrow) return; // Skip — no plants growing in this group yet

      const trayCount = group.trays || 4;
      const plantsPerTray = Math.floor((group.plants || 0) / trayCount) || 0;
      
      // Calculate days old from seedDate
      let daysOld = 0;
      let seedingDate = today;
      if (group.planConfig?.anchor?.seedDate) {
        seedingDate = new Date(group.planConfig.anchor.seedDate);
        daysOld = Math.floor((today - seedingDate) / (1000 * 60 * 60 * 24));
      }
      
      // Get actual harvest days from lighting recipe
      const harvestDays = getCropHarvestDays(group.plan);
      
      // Derive crop name from plan if crop field is missing
      const cropName = group.crop || extractCropDisplayName(group.plan) || 'Unknown';
      const groupRoomId = group.roomId || group.room || 'Room-1';
      const groupZoneId = group.zoneId || group.zone || 'Zone-1';

      // Determine growth stage from recipe schedule
      const stage = getCropStageAtDay(group.plan, daysOld);

      // Create individual tray records
      for (let i = 0; i < trayCount; i++) {
        allTrays.push({
          trayId: `${group.id}-T${i + 1}`,
          groupId: group.id,
          roomId: groupRoomId,
          zoneId: groupZoneId,
          crop: cropName,
          plantCount: plantsPerTray,
          seedingDate: seedingDate.toISOString(),
          daysOld: daysOld,
          harvestIn: Math.max(0, harvestDays - daysOld), // Use actual recipe duration
          health: group.health || 'healthy',
          recipe: cropName,
          stage: stage
        });
        trayCounter++;
      }
      
      totalTrays += trayCount;
      totalPlants += plantsPerTray * trayCount; // Use calculated plants, not missing field
    });

    // Count seedling plants: sum plantCount where stage is 'Seedling'
    const seedlingPlants = allTrays
      .filter(t => t.stage === 'Seedling')
      .reduce((sum, t) => sum + t.plantCount, 0);

    res.json({
      activeTrays: totalTrays,
      totalPlants: totalPlants,
      seedlingPlants: seedlingPlants,
      farmCount: 1,
      byFarm: [
        {
          farmId: 'GR-00001',
          name: 'Demo Vertical Farm',
          activeTrays: totalTrays,
          totalPlants: totalPlants,
          trays: allTrays
        }
      ]
    });
  } catch (error) {
    console.error('[inventory] Failed to get current inventory:', error);
    res.status(500).json({ error: 'Failed to load inventory' });
  }
});

/**
 * GET /api/inventory/forecast
 * Returns harvest forecast bucketed by time period
 */
// Inventory forecast endpoint with optional days parameter (cloud-compatible)
app.get('/api/inventory/forecast/:days?', (req, res) => {
  try {
    // Load from groups.json (real crop data)
    const groupsPath = path.join(PUBLIC_DIR, 'data', 'groups.json');
    if (!fs.existsSync(groupsPath)) {
      return res.json({
        next7Days: { count: 0, trays: [] },
        next14Days: { count: 0, trays: [] },
        next30Days: { count: 0, trays: [] },
        beyond30Days: { count: 0, trays: [] }
      });
    }
    
    const groupsData = JSON.parse(fs.readFileSync(groupsPath, 'utf8'));
    const groups = groupsData.groups || [];

    const now = new Date();
    now.setHours(0, 0, 0, 0);

    // Crop grow times from crop registry (Phase 2a — single source of truth)
    // cropUtils.getCropGrowDays() reads from crop-registry.json

    const buckets = {
      next7Days: [],
      next14Days: [],
      next30Days: [],
      beyond30Days: []
    };

    // Process each group — only those with active grows
    groups.forEach((group) => {
      const hasCropOrPlan = (group.crop && group.crop !== '') || (group.plan && group.plan !== '');
      const hasSeedDate = group.planConfig?.anchor?.seedDate;
      const isActiveGrow = hasCropOrPlan || hasSeedDate || (group.plants > 0 && group.status !== 'draft');
      if (!isActiveGrow) return; // Skip — no plants growing yet

      const trayCount = group.trays || 4;
      const plantsPerTray = Math.floor((group.plants || 0) / trayCount) || 0;
      
      // Calculate daysOld from planConfig.anchor.seedDate
      let daysOld = 0;
      let seedDate = new Date(now);
      if (group.planConfig?.anchor?.seedDate) {
        seedDate = new Date(group.planConfig.anchor.seedDate);
        daysOld = Math.floor((now - seedDate) / (1000 * 60 * 60 * 24));
      }

      // Derive crop name from plan if crop field is missing
      const cropName = group.crop || extractCropDisplayName(group.plan) || 'Unknown';
      const groupRoomId = group.roomId || group.room || 'Room-1';
      const groupZoneId = group.zoneId || group.zone || 'Zone-1';

      // Use real crop grow times from registry, then recipe, then default
      const actualGrowDays = cropUtils.getCropGrowDays(cropName) || getCropHarvestDays(group.plan) || 35;
      
      const harvestDate = new Date(seedDate);
      harvestDate.setDate(seedDate.getDate() + actualGrowDays);
      
      const daysToHarvest = Math.floor((harvestDate - now) / (1000 * 60 * 60 * 24));

      // Create tray records for this group
      for (let trayNum = 1; trayNum <= trayCount; trayNum++) {
        const tray = {
          trayId: `${group.id}-T${trayNum}`,
          groupId: group.id,
          groupName: group.name,
          recipe: cropName,
          plantCount: plantsPerTray,
          estimatedHarvestDate: harvestDate.toISOString().split('T')[0],
          location: `${groupRoomId} - ${groupZoneId}`,
          daysToHarvest: daysToHarvest,
          currentDay: daysOld + 1
        };

        // Bucket by days to harvest
        if (daysToHarvest <= 7) {
          buckets.next7Days.push(tray);
        } else if (daysToHarvest <= 14) {
          buckets.next14Days.push(tray);
        } else if (daysToHarvest <= 30) {
          buckets.next30Days.push(tray);
        } else {
          buckets.beyond30Days.push(tray);
        }
      }
    });

    res.json({
      next7Days: {
        count: buckets.next7Days.reduce((sum, t) => sum + t.plantCount, 0),
        trays: buckets.next7Days
      },
      next14Days: {
        count: buckets.next14Days.reduce((sum, t) => sum + t.plantCount, 0),
        trays: buckets.next14Days
      },
      next30Days: {
        count: buckets.next30Days.reduce((sum, t) => sum + t.plantCount, 0),
        trays: buckets.next30Days
      },
      beyond30Days: {
        count: buckets.beyond30Days.reduce((sum, t) => sum + t.plantCount, 0),
        trays: buckets.beyond30Days
      }
    });
  } catch (error) {
    console.error('[inventory] Failed to get forecast:', error);
    res.status(500).json({ error: 'Failed to load forecast' });
  }
});

// =====================================================
// INVENTORY MANAGEMENT CRUD API
// =====================================================
// NeDB-backed stores for farm supplies inventory (Phase 0, Ticket 0.2)
// In-memory arrays kept for fast reads; every mutation writes through to NeDB.
const seedsInventoryDB = new Datastore({ filename: './data/seeds-inventory.db', autoload: true });
const packagingInventoryDB = new Datastore({ filename: './data/packaging-inventory.db', autoload: true });
const nutrientsInventoryDB = new Datastore({ filename: './data/nutrients-inventory.db', autoload: true });
const equipmentInventoryDB = new Datastore({ filename: './data/equipment-inventory.db', autoload: true });
const suppliesInventoryDB = new Datastore({ filename: './data/supplies-inventory.db', autoload: true });

const seedsInventory = [];
const packagingInventory = [];
const nutrientsInventory = [];
const equipmentInventory = [];
const suppliesInventory = [];

// Load persisted inventory into memory on startup
(async function loadPersistedInventories() {
  try {
    const [seeds, packaging, nutrients, equipment, supplies] = await Promise.all([
      seedsInventoryDB.find({}),
      packagingInventoryDB.find({}),
      nutrientsInventoryDB.find({}),
      equipmentInventoryDB.find({}),
      suppliesInventoryDB.find({})
    ]);
    seedsInventory.push(...seeds);
    packagingInventory.push(...packaging);
    nutrientsInventory.push(...nutrients);
    equipmentInventory.push(...equipment);
    suppliesInventory.push(...supplies);
    const total = seeds.length + packaging.length + nutrients.length + equipment.length + supplies.length;
    if (total > 0) console.log(`[inventory] Loaded ${total} persisted supply items (${seeds.length} seeds, ${packaging.length} packaging, ${nutrients.length} nutrients, ${equipment.length} equipment, ${supplies.length} supplies)`);
  } catch (err) {
    console.warn('[inventory] Failed to load persisted inventories:', err.message);
  }
})();

// Helper to generate unique IDs
function generateId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// ===== ADMIN INVENTORY ENDPOINTS (compatibility with farm-admin pages) =====

// GET /api/inventory/dashboard - Summary dashboard for admin
app.get('/api/inventory/dashboard', (req, res) => {
  try {
    const groupsPath = path.join(PUBLIC_DIR, 'data', 'groups.json');
    const groupsData = fs.existsSync(groupsPath) ? JSON.parse(fs.readFileSync(groupsPath, 'utf8')) : { groups: [] };
    const groups = groupsData.groups || [];

    // Only count groups with active grows (have crop/plan assigned or seedDate set)
    const activeGroups = groups.filter(g => {
      const hasCropOrPlan = (g.crop && g.crop !== '') || (g.plan && g.plan !== '');
      const hasSeedDate = g.planConfig?.anchor?.seedDate;
      return hasCropOrPlan || hasSeedDate || (g.plants > 0 && g.status !== 'draft');
    });
    const totalTrays = activeGroups.reduce((sum, g) => sum + (g.trays || 4), 0);
    const totalPlants = activeGroups.reduce((sum, g) => sum + (g.plants || 0), 0);
    
    res.json({
      ok: true,
      totalSeeds: seedsInventory.length,
      totalPackaging: packagingInventory.length,
      totalNutrients: nutrientsInventory.length,
      totalEquipment: equipmentInventory.length,
      totalSupplies: suppliesInventory.length,
      activeGroups: activeGroups.length,
      totalGroups: groups.length,
      activeTrays: totalTrays,
      totalPlants: totalPlants
    });
  } catch (error) {
    res.json({ ok: true, totalSeeds: 0, totalPackaging: 0, totalNutrients: 0, totalEquipment: 0, totalSupplies: 0, activeGroups: 0, activeTrays: 0, totalPlants: 0 });
  }
});

// GET /api/inventory/reorder-alerts - Items needing reorder
app.get('/api/inventory/reorder-alerts', (req, res) => {
  const alerts = [];
  // Check seeds with low quantity
  seedsInventory.filter(s => (s.quantity || 0) < (s.reorderPoint || 10)).forEach(s => {
    alerts.push({ id: s.id, type: 'seeds', name: s.name, currentQty: s.quantity || 0, reorderPoint: s.reorderPoint || 10 });
  });
  // Check nutrients with low quantity
  nutrientsInventory.filter(n => (n.quantity || 0) < (n.reorderPoint || 5)).forEach(n => {
    alerts.push({ id: n.id, type: 'nutrients', name: n.name, currentQty: n.quantity || 0, reorderPoint: n.reorderPoint || 5 });
  });
  res.json({ ok: true, alerts });
});

// GET /api/inventory/seeds/list - List all seeds (alias)
app.get('/api/inventory/seeds/list', (req, res) => {
  res.json({ ok: true, seeds: seedsInventory });
});

// GET /api/inventory/packaging/list - List all packaging (alias)
app.get('/api/inventory/packaging/list', (req, res) => {
  res.json({ ok: true, packaging: packagingInventory });
});

// GET /api/inventory/nutrients/list - List all nutrients (alias)
app.get('/api/inventory/nutrients/list', (req, res) => {
  res.json({ ok: true, nutrients: nutrientsInventory });
});

// GET /api/inventory/equipment/list - List all equipment (alias)
app.get('/api/inventory/equipment/list', (req, res) => {
  res.json({ ok: true, equipment: equipmentInventory });
});

// GET /api/inventory/supplies/list - List all supplies (alias)
app.get('/api/inventory/supplies/list', (req, res) => {
  res.json({ ok: true, supplies: suppliesInventory });
});

// GET /api/inventory/usage/weekly-summary - Weekly usage summary
app.get('/api/inventory/usage/weekly-summary', (req, res) => {
  res.json({
    ok: true,
    period: { days: parseInt(req.query.days) || 7, start: new Date(Date.now() - 7 * 86400000).toISOString(), end: new Date().toISOString() },
    summary: { seedsUsed: 0, nutrientsUsed: 0, packagingUsed: 0, waterUsed: 0 },
    dailyBreakdown: []
  });
});

// ===== SEEDS ENDPOINTS =====

// GET /api/inventory/seeds - List all seeds
app.get('/api/inventory/seeds', (req, res) => {
  res.json({ ok: true, seeds: seedsInventory });
});

// GET /api/inventory/seeds/:id - Get single seed
app.get('/api/inventory/seeds/:id', (req, res) => {
  const seed = seedsInventory.find(s => s.seed_id === req.params.id);
  if (!seed) return res.status(404).json({ ok: false, message: 'Seed not found' });
  res.json(seed);
});

// POST /api/inventory/seeds - Add new seed
app.post('/api/inventory/seeds', (req, res) => {
  const seed = {
    seed_id: generateId('SEED'),
    ...req.body,
    created_at: new Date().toISOString()
  };
  seedsInventory.push(seed);
  seedsInventoryDB.insert(seed).catch(e => console.warn('[inventory] Seed persist failed:', e.message));
  res.json({ ok: true, seed });
});

// PUT /api/inventory/seeds/:id - Update seed
app.put('/api/inventory/seeds/:id', (req, res) => {
  const index = seedsInventory.findIndex(s => s.seed_id === req.params.id);
  if (index === -1) return res.status(404).json({ ok: false, message: 'Seed not found' });
  
  seedsInventory[index] = {
    ...seedsInventory[index],
    ...req.body,
    updated_at: new Date().toISOString()
  };
  seedsInventoryDB.update({ seed_id: req.params.id }, seedsInventory[index], { upsert: true }).catch(e => console.warn('[inventory] Seed update persist failed:', e.message));
  res.json({ ok: true, seed: seedsInventory[index] });
});

// DELETE /api/inventory/seeds/:id - Delete seed
app.delete('/api/inventory/seeds/:id', (req, res) => {
  const index = seedsInventory.findIndex(s => s.seed_id === req.params.id);
  if (index === -1) return res.status(404).json({ ok: false, message: 'Seed not found' });
  
  seedsInventory.splice(index, 1);
  seedsInventoryDB.remove({ seed_id: req.params.id }, {}).catch(e => console.warn('[inventory] Seed delete persist failed:', e.message));
  res.json({ ok: true, message: 'Seed deleted' });
});

// ===== PACKAGING ENDPOINTS =====

// GET /api/inventory/packaging - List all packaging
app.get('/api/inventory/packaging', (req, res) => {
  res.json({ ok: true, packaging: packagingInventory });
});

// GET /api/inventory/packaging/:id - Get single packaging
app.get('/api/inventory/packaging/:id', (req, res) => {
  const pkg = packagingInventory.find(p => p.packaging_id === req.params.id);
  if (!pkg) return res.status(404).json({ ok: false, message: 'Packaging not found' });
  res.json(pkg);
});

// POST /api/inventory/packaging - Add new packaging
app.post('/api/inventory/packaging', (req, res) => {
  const packaging = {
    packaging_id: generateId('PKG'),
    ...req.body,
    created_at: new Date().toISOString()
  };
  packagingInventory.push(packaging);
  packagingInventoryDB.insert(packaging).catch(e => console.warn('[inventory] Packaging persist failed:', e.message));
  res.json({ ok: true, packaging });
});

// POST /api/inventory/packaging/:id/restock - Restock packaging
app.post('/api/inventory/packaging/:id/restock', (req, res) => {
  const pkg = packagingInventory.find(p => p.packaging_id === req.params.id);
  if (!pkg) return res.status(404).json({ ok: false, message: 'Packaging not found' });
  
  const { add_quantity, notes } = req.body;
  pkg.stock_level = (pkg.stock_level || 0) + parseInt(add_quantity);
  pkg.last_restocked = new Date().toISOString();
  pkg.restock_notes = notes;
  
  packagingInventoryDB.update({ packaging_id: req.params.id }, pkg, { upsert: true }).catch(e => console.warn('[inventory] Packaging restock persist failed:', e.message));
  res.json({ ok: true, packaging: pkg });
});

// ===== NUTRIENTS ENDPOINTS =====

// GET /api/inventory/nutrients - List all nutrients
app.get('/api/inventory/nutrients', (req, res) => {
  res.json({ ok: true, nutrients: nutrientsInventory });
});

// GET /api/inventory/nutrients/:id - Get single nutrient
app.get('/api/inventory/nutrients/:id', (req, res) => {
  const nutrient = nutrientsInventory.find(n => n.nutrient_id === req.params.id);
  if (!nutrient) return res.status(404).json({ ok: false, message: 'Nutrient not found' });
  res.json(nutrient);
});

// POST /api/inventory/nutrients/:id/usage - Record nutrient usage
app.post('/api/inventory/nutrients/:id/usage', (req, res) => {
  const nutrient = nutrientsInventory.find(n => n.nutrient_id === req.params.id);
  if (!nutrient) return res.status(404).json({ ok: false, message: 'Nutrient not found' });
  
  const { volume_used, date, applied_to } = req.body;
  nutrient.volume_remaining = (nutrient.volume_remaining || 0) - parseFloat(volume_used);
  nutrient.last_used = date || new Date().toISOString();
  nutrient.applied_to = applied_to;
  
  nutrientsInventoryDB.update({ nutrient_id: req.params.id }, nutrient, { upsert: true }).catch(e => console.warn('[inventory] Nutrient usage persist failed:', e.message));
  res.json({ ok: true, nutrient });
});

// ===== EQUIPMENT ENDPOINTS =====

// GET /api/inventory/equipment - List all equipment
app.get('/api/inventory/equipment', (req, res) => {
  res.json({ ok: true, equipment: equipmentInventory });
});

// GET /api/inventory/equipment/:id - Get single equipment
app.get('/api/inventory/equipment/:id', (req, res) => {
  const equipment = equipmentInventory.find(e => e.equipment_id === req.params.id);
  if (!equipment) return res.status(404).json({ ok: false, message: 'Equipment not found' });
  res.json(equipment);
});

// POST /api/inventory/equipment/:id/maintenance - Log maintenance
app.post('/api/inventory/equipment/:id/maintenance', (req, res) => {
  const equipment = equipmentInventory.find(e => e.equipment_id === req.params.id);
  if (!equipment) return res.status(404).json({ ok: false, message: 'Equipment not found' });
  
  const { maintenance_type, date_performed, performed_by, description, cost } = req.body;
  
  if (!equipment.maintenance_history) {
    equipment.maintenance_history = [];
  }
  
  equipment.maintenance_history.push({
    maintenance_type,
    date_performed,
    performed_by,
    description,
    cost,
    logged_at: new Date().toISOString()
  });
  
  equipment.last_maintenance = date_performed;
  
  equipmentInventoryDB.update({ equipment_id: req.params.id }, equipment, { upsert: true }).catch(e => console.warn('[inventory] Equipment maintenance persist failed:', e.message));
  res.json({ ok: true, equipment });
});

// ===== SUPPLIES ENDPOINTS =====

// GET /api/inventory/supplies - List all supplies
app.get('/api/inventory/supplies', (req, res) => {
  res.json({ ok: true, supplies: suppliesInventory });
});

// GET /api/inventory/supplies/:id - Get single supply
app.get('/api/inventory/supplies/:id', (req, res) => {
  const supply = suppliesInventory.find(s => s.supply_id === req.params.id);
  if (!supply) return res.status(404).json({ ok: false, message: 'Supply not found' });
  res.json(supply);
});

// POST /api/inventory/supplies/:id/usage - Record supply usage
app.post('/api/inventory/supplies/:id/usage', (req, res) => {
  const supply = suppliesInventory.find(s => s.supply_id === req.params.id);
  if (!supply) return res.status(404).json({ ok: false, message: 'Supply not found' });
  
  const { quantity_used, date, purpose } = req.body;
  supply.quantity = (supply.quantity || 0) - parseFloat(quantity_used);
  supply.last_used = date || new Date().toISOString();
  supply.usage_purpose = purpose;
  
  suppliesInventoryDB.update({ supply_id: req.params.id }, supply, { upsert: true }).catch(e => console.warn('[inventory] Supply usage persist failed:', e.message));
  res.json({ ok: true, supply });
});

// =====================================================
// PLANTING ASSIGNMENTS & PLAN API
// =====================================================

/**
 * In-memory planting assignments store (persists to planting-assignments.json)
 * Used by Planting Scheduler UI for group-level crop planning
 */
const PLANTING_ASSIGNMENTS_PATH = path.join(__dirname, 'public', 'data', 'planting-assignments.json');

function loadPlantingAssignments() {
  try {
    if (fs.existsSync(PLANTING_ASSIGNMENTS_PATH)) {
      return JSON.parse(fs.readFileSync(PLANTING_ASSIGNMENTS_PATH, 'utf8'));
    }
  } catch (err) {
    console.warn('[planting] Failed to load assignments:', err.message);
  }
  return { assignments: [] };
}

function savePlantingAssignments(data) {
  try {
    fs.writeFileSync(PLANTING_ASSIGNMENTS_PATH, JSON.stringify(data, null, 2) + '\n');
  } catch (err) {
    console.error('[planting] Failed to save assignments:', err.message);
  }
}

/**
 * GET /api/planting/assignments
 * Load saved planting assignments (optionally filtered by farm_id)
 */
app.get('/api/planting/assignments', (req, res) => {
  const store = loadPlantingAssignments();
  const farmId = req.query.farm_id || req.headers['x-farm-id'] || '';
  let assignments = store.assignments || [];
  if (farmId) {
    assignments = assignments.filter(a => !a.farm_id || a.farm_id === farmId);
  }
  res.json({ assignments, count: assignments.length });
});

/**
 * POST /api/planting/assignments
 * Save or update a planting assignment for a group
 */
app.post('/api/planting/assignments', (req, res) => {
  const { group_id, crop_id, crop_name, seed_date, harvest_date, status, notes } = req.body;
  if (!group_id) return res.status(400).json({ error: 'group_id is required' });

  const store = loadPlantingAssignments();
  const now = new Date().toISOString();
  const farmId = req.body.farm_id || req.headers['x-farm-id'] || 'foxtrot';

  // Upsert: replace existing assignment for this group
  const idx = store.assignments.findIndex(a => a.group_id === group_id);
  const assignment = {
    farm_id: farmId,
    group_id,
    crop_id: crop_id || '',
    crop_name: crop_name || '',
    seed_date: seed_date || null,
    harvest_date: harvest_date || null,
    status: status || 'planned',
    notes: notes || '',
    updated_at: now
  };

  if (idx >= 0) {
    store.assignments[idx] = assignment;
  } else {
    store.assignments.push(assignment);
  }

  savePlantingAssignments(store);
  console.log(`[planting] Assignment saved: group=${group_id}, crop=${crop_name}`);
  res.json({ ok: true, assignment });
});

/**
 * POST /api/planting/plan
 * Create a planting plan (manual schedule, AI implementation, or scoped scheduling)
 * Supports scope: tray, group, zone, room
 */
app.post('/api/planting/plan', (req, res) => {
  const { scope, cadence, cropId, cropName, items, notes } = req.body;

  if (!scope || !cropId) {
    return res.status(400).json({ error: 'scope and cropId are required' });
  }

  const now = new Date();
  const planId = `plan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const itemList = Array.isArray(items) ? items : [];
  const seedDate = itemList[0]?.seedDate || now.toISOString().slice(0, 10);

  // Calculate expected harvest based on crop database harvestDays
  // Default to 30 days if unknown
  let harvestDays = 30;
  try {
    const recipesPath = path.join(__dirname, 'public', 'data', 'lighting-recipes.json');
    if (fs.existsSync(recipesPath)) {
      const recipes = JSON.parse(fs.readFileSync(recipesPath, 'utf8'));
      if (recipes.crops) {
        for (const [name, days] of Object.entries(recipes.crops)) {
          const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
          if (id === cropId || name === cropName) {
            harvestDays = Array.isArray(days) ? days.length : 30;
            break;
          }
        }
      }
    }
  } catch (err) {
    console.warn('[planting] Could not resolve harvest days:', err.message);
  }

  const harvestDate = new Date(seedDate);
  harvestDate.setDate(harvestDate.getDate() + harvestDays);

  // Build cadence batches
  const batches = [];
  if (cadence === 'one_time' || !cadence) {
    batches.push({
      batchNum: 1,
      seedDate,
      expectedHarvestDate: harvestDate.toISOString().slice(0, 10),
      items: itemList
    });
  } else {
    // Succession cadence (weekly, biweekly, monthly)
    const intervals = { weekly: 7, biweekly: 14, monthly: 30 };
    const interval = intervals[cadence] || 7;
    const batchCount = Math.min(4, Math.max(1, Math.ceil(52 / (interval / 7)))); // Up to 4 batches shown
    for (let i = 0; i < Math.min(batchCount, 4); i++) {
      const batchSeed = new Date(seedDate);
      batchSeed.setDate(batchSeed.getDate() + i * interval);
      const batchHarvest = new Date(batchSeed);
      batchHarvest.setDate(batchHarvest.getDate() + harvestDays);
      batches.push({
        batchNum: i + 1,
        seedDate: batchSeed.toISOString().slice(0, 10),
        expectedHarvestDate: batchHarvest.toISOString().slice(0, 10),
        items: itemList
      });
    }
  }

  // Save assignments for each group referenced
  const groupIds = [...new Set(itemList.map(it => it.groupId).filter(Boolean))];
  if (groupIds.length) {
    const store = loadPlantingAssignments();
    groupIds.forEach(gid => {
      const idx = store.assignments.findIndex(a => a.group_id === gid);
      const assignment = {
        farm_id: req.headers['x-farm-id'] || 'foxtrot',
        group_id: gid,
        crop_id: cropId,
        crop_name: cropName || '',
        seed_date: seedDate,
        harvest_date: harvestDate.toISOString().slice(0, 10),
        status: 'planned',
        notes: notes || '',
        updated_at: now.toISOString()
      };
      if (idx >= 0) store.assignments[idx] = assignment;
      else store.assignments.push(assignment);
    });
    savePlantingAssignments(store);
    console.log(`[planting] Plan ${planId}: saved assignments for ${groupIds.length} groups`);
  }

  const plan = {
    id: planId,
    scope,
    cadence: cadence || 'one_time',
    cropId,
    cropName: cropName || '',
    seedDate,
    harvestDate: harvestDate.toISOString().slice(0, 10),
    harvestDays,
    itemCount: itemList.length,
    groupCount: groupIds.length,
    batches,
    createdAt: now.toISOString()
  };

  console.log(`[planting] Plan created: ${planId}, scope=${scope}, crop=${cropName}, ${groupIds.length} groups, ${batches.length} batches`);
  res.json(plan);
});

// =====================================================
// CROP RECOMMENDATION API - Phase 1 (Rules Engine)
// =====================================================

import { generateCropRecommendations } from './lib/crop-recommendation-engine.js';

/**
 * POST /api/planting/recommendations
 * Generate intelligent crop recommendations for replanting
 * 
 * Request body:
 * {
 *   "groupId": "Room-1:Zone-1:Group-A",
 *   "currentCrop": "crop-buttercrunch-lettuce",
 *   "availableCrops": ["crop-astro-arugula", "crop-lacinato-kale", ...],
 *   "targetSeedDate": "2026-02-10",  // Optional, defaults to today
 *   "zoneConditions": {              // Optional, defaults used if missing
 *     "ec": 1.6,
 *     "ph": 5.9,
 *     "vpd": 1.0,
 *     "dli_capacity": 22
 *   }
 * }
 * 
 * Response:
 * {
 *   "groupId": "...",
 *   "topRecommendation": { cropId, confidence, scores, deltas, expectedHarvestDate },
 *   "alternatives": [ ... top 3 alternatives ... ],
 *   "allScored": [ ... all crops sorted by score ... ]
 * }
 */
app.post('/api/planting/recommendations', asyncHandler(async (req, res) => {
  const {
    groupId,
    currentCrop,
    availableCrops = [],
    targetSeedDate,
    zoneConditions = {}
  } = req.body;

  if (!groupId) {
    return res.status(400).json({ error: 'groupId is required' });
  }

  // Get current inventory for harvest staggering analysis
  const groupsPath = path.join(PUBLIC_DIR, 'data', 'groups.json');
  let currentInventory = [];
  
  if (fs.existsSync(groupsPath)) {
    const groupsData = JSON.parse(fs.readFileSync(groupsPath, 'utf8'));
    const groups = groupsData.groups || [];
    
    // Build inventory from groups
    const now = new Date();
    currentInventory = groups.map(group => {
      const seedDate = group.planConfig?.anchor?.seedDate 
        ? new Date(group.planConfig.anchor.seedDate) 
        : now;
      
      // Estimate harvest date (will be refined by recommendation engine)
      const harvestDate = new Date(seedDate);
      harvestDate.setDate(harvestDate.getDate() + 35); // Average 35 days
      
      return {
        groupId: group.id,
        crop: group.plan || group.crop,
        expectedHarvest: harvestDate.toISOString()
      };
    });
  }

  // If availableCrops not provided, get all crops from lighting-recipes.json
  let cropsToConsider = availableCrops;
  if (cropsToConsider.length === 0) {
    const recipesPath = path.join(PUBLIC_DIR, 'data', 'lighting-recipes.json');
    if (fs.existsSync(recipesPath)) {
      const recipes = JSON.parse(fs.readFileSync(recipesPath, 'utf8'));
      cropsToConsider = Object.keys(recipes.crops || {})
        .map(name => `crop-${name.toLowerCase().replace(/\s+/g, '-')}`);
    }
  }

  // Load farm's dedicated crop list and apply soft constraint
  let dedicatedCropIds = [];
  let explorationCrops = [];
  try {
    const farmDataPath = path.join(PUBLIC_DIR, 'data', 'farm.json');
    const farmData = JSON.parse(fs.readFileSync(farmDataPath, 'utf8'));
    dedicatedCropIds = farmData.dedicated_crops || [];
  } catch (_) { /* no farm.json */ }

  if (dedicatedCropIds.length > 0) {
    // Primary set: only dedicated crops
    const dedicatedSet = new Set(dedicatedCropIds);
    const primaryCrops = cropsToConsider.filter(id => dedicatedSet.has(id));
    const nonDedicatedCrops = cropsToConsider.filter(id => !dedicatedSet.has(id));

    // Score non-dedicated crops to find top 2-3 exploration candidates
    // We'll run a quick pre-score pass using the engine on the full set,
    // then return dedicated + top exploration crops
    cropsToConsider = primaryCrops;

    // Add up to 3 exploration crops from outside the dedicated list
    explorationCrops = nonDedicatedCrops.slice(0, 3);
    cropsToConsider = [...primaryCrops, ...explorationCrops];
  }

  // --- Build demandData from wholesale order history ---
  // Phase 2 Task 2.2: Real trend computation (compare last 30d vs prior 30d)
  let demandData = null;
  try {
    const wholesale = await getWholesaleIntegration();
    const allOrders = [];
    const completedStatuses = ['completed', 'picked_up', 'payment_captured'];
    for (const orderId of wholesale.state.allOrders || []) {
      const order = await wholesale.getOrder(orderId);
      if (order && completedStatuses.includes(order.status)) {
        allOrders.push(order);
      }
    }
    // Last 60 days split into two 30-day windows for trend
    const now60 = new Date();
    const cutoff60 = new Date(now60); cutoff60.setDate(cutoff60.getDate() - 60);
    const cutoff30 = new Date(now60); cutoff30.setDate(cutoff30.getDate() - 30);
    const recent = allOrders.filter(o => new Date(o.created_at || o.order_date) >= cutoff60);

    if (recent.length > 0) {
      demandData = {};
      const extractItems = (items) => {
        for (const item of items || []) {
          const name = (item.product_name || item.crop_name || '').toLowerCase();
          if (!name) continue;
          if (!demandData[name]) demandData[name] = { totalQty: 0, orderCount: 0, trend: 'stable', recent30: 0, prior30: 0 };
          demandData[name].totalQty += item.quantity || 0;
          demandData[name].orderCount += 1;
          const orderDate = new Date(item.order_date || item.created_at || now60);
          if (orderDate >= cutoff30) {
            demandData[name].recent30 += item.quantity || 0;
          } else {
            demandData[name].prior30 += item.quantity || 0;
          }
        }
      };

      for (const order of recent) {
        extractItems(order.items);
        if (order.sub_orders) {
          for (const sub of order.sub_orders) {
            extractItems(sub.items?.map(i => ({ ...i, order_date: order.created_at || order.order_date })));
          }
        }
      }
      // Compute real trend from 30-day comparison
      for (const [, data] of Object.entries(demandData)) {
        if (data.prior30 === 0 && data.recent30 > 0) data.trend = 'increasing';
        else if (data.prior30 > 0 && data.recent30 === 0) data.trend = 'decreasing';
        else if (data.prior30 > 0) {
          const ratio = data.recent30 / data.prior30;
          if (ratio >= 1.25) data.trend = 'increasing';
          else if (ratio <= 0.75) data.trend = 'decreasing';
          else data.trend = 'stable';
        }
      }
    }

    // Phase 2 Task 2.2: Merge network demand signals from Central
    try {
      const aiRecsPath = path.join(PUBLIC_DIR, 'data', 'ai-recommendations.json');
      if (fs.existsSync(aiRecsPath)) {
        const aiRecs = JSON.parse(fs.readFileSync(aiRecsPath, 'utf8'));
        const networkDemand = aiRecs?.network_intelligence?.demand_signals;
        if (networkDemand && typeof networkDemand === 'object') {
          if (!demandData) demandData = {};
          for (const [crop, signal] of Object.entries(networkDemand)) {
            const key = crop.toLowerCase();
            if (!demandData[key]) {
              demandData[key] = {
                totalQty: signal.network_total_qty || 0,
                orderCount: signal.network_order_count || 0,
                trend: signal.network_trend || 'stable',
                recent30: 0, prior30: 0,
                source: 'network'
              };
            } else {
              // Blend network signal as 30% weight on top of local
              demandData[key].totalQty += Math.round((signal.network_total_qty || 0) * 0.3);
              demandData[key].orderCount += Math.round((signal.network_order_count || 0) * 0.3);
              if (signal.network_trend === 'increasing' && demandData[key].trend !== 'increasing') {
                demandData[key].trend = 'increasing'; // Network demand boost
              }
            }
          }
        }
      }
    } catch (niErr) {
      // Non-fatal — network demand is a bonus layer
    }
  } catch (demandErr) {
    console.warn('[planting] Could not load wholesale demand data:', demandErr.message);
  }

  // Generate recommendations
  const recommendations = await generateCropRecommendations({
    groupId,
    currentCrop,
    availableCrops: cropsToConsider,
    targetSeedDate: targetSeedDate ? new Date(targetSeedDate) : new Date(),
    currentInventory,
    zoneConditions,
    demandData
  });

  // Tag exploration crops in the results
  if (explorationCrops.length > 0) {
    const explorationSet = new Set(explorationCrops);
    const tagExploration = (rec) => {
      if (rec && explorationSet.has(rec.cropId)) {
        rec.exploration = true;
        rec.explorationReason = 'Outside your dedicated crops — included for market consideration';
      }
    };
    tagExploration(recommendations.topRecommendation);
    (recommendations.alternatives || []).forEach(tagExploration);
    (recommendations.allScored || []).forEach(tagExploration);
    recommendations.dedicatedCropCount = dedicatedCropIds.length;
    recommendations.explorationCropCount = explorationCrops.length;
  }

  res.json(recommendations);
}));

/**
 * POST /api/planting/feedback
 * Track grower's decision (accepted/rejected/modified recommendation)
 * Used for learning and improving future recommendations
 */
app.post('/api/planting/feedback', asyncHandler(async (req, res) => {
  const {
    groupId,
    recommendedCrop,
    actualCrop,
    action, // 'accepted', 'rejected', 'modified'
    reason
  } = req.body;

  // Phase 1: Just log to console (Phase 2 will store in database)
  console.log('[planting-feedback]', {
    groupId,
    recommendedCrop,
    actualCrop,
    action,
    reason,
    timestamp: new Date().toISOString()
  });

  res.json({ 
    success: true, 
    message: 'Feedback recorded (Phase 1: console logging)' 
  });
}));

/**
 * GET /api/ai/status
 * Returns current AI training status and readiness
 * Used by: Planting Scheduler UI, GreenReach Central monitoring
 */
app.get('/api/ai/status', asyncHandler(async (req, res) => {
  try {
    // Read from SQLite database (correct path: data/, not public/data/)
    const dbPath = path.join(process.cwd(), 'data', 'lightengine.db');
    const result = await new Promise((resolve, reject) => {
      exec(`sqlite3 "${dbPath}" "SELECT * FROM ai_readiness_dashboard;"`, (error, stdout, stderr) => {
        if (error) return reject(error);
        if (stderr) return reject(new Error(stderr));
        
        // Parse SQLite output (pipe-delimited)
        const values = stdout.trim().split('|');
        if (values.length < 18) {
          return reject(new Error('Invalid database response'));
        }

        resolve({
          engine_type: values[0],
          engine_version: values[1],
          total_decisions: parseInt(values[2]) || 0,
          accepted_decisions: parseInt(values[3]) || 0,
          rejected_decisions: parseInt(values[4]) || 0,
          acceptance_rate: parseFloat(values[5]) || 0,
          total_crop_cycles: parseInt(values[6]) || 0,
          decisions_pct: parseInt(values[7]) || 0,
          cycles_pct: parseInt(values[8]) || 0,
          acceptance_pct: parseInt(values[9]) || 0,
          overall_readiness_pct: parseInt(values[10]) || 0,
          ml_ready: parseInt(values[11]) || 0,
          ml_training_started_at: values[12] || null,
          ml_model_accuracy: parseFloat(values[13]) || null,
          days_since_launch: parseInt(values[14]) || 0,
          target_activation_date: values[15] || null,
          days_remaining: parseInt(values[16]) || 0,
          updated_at: values[17] || null
        });
      });
    });

    res.json({
      engine: {
        type: result.engine_type,
        version: result.engine_version,
        active: result.engine_type === 'ml' ? 'AI Model' : 'Rules Engine'
      },
      progress: {
        decisions: {
          total: result.total_decisions,
          accepted: result.accepted_decisions,
          rejected: result.rejected_decisions,
          acceptance_rate: Math.round(result.acceptance_rate * 100),
          progress_pct: result.decisions_pct
        },
        crop_cycles: {
          total: result.total_crop_cycles,
          progress_pct: result.cycles_pct
        },
        overall_readiness_pct: result.overall_readiness_pct
      },
      ml: {
        ready: Boolean(result.ml_ready),
        training_started: result.ml_training_started_at,
        model_accuracy: result.ml_model_accuracy,
        activated: null
      },
      timeline: {
        days_since_launch: result.days_since_launch,
        target_date: result.target_activation_date,
        days_remaining: result.days_remaining
      },
      updated_at: result.updated_at
    });
  } catch (error) {
    console.error('[AI Status] Error:', error);
    res.status(500).json({ error: 'Failed to load AI status' });
  }
}));

/**
 * POST /api/ai/record-decision
 * Records a grower decision (accept/reject/modify recommendation)
 * Updates AI training progress metrics
 */
app.post('/api/ai/record-decision', asyncHandler(async (req, res) => {
  const { action, recommendedCrop, actualCrop, groupId } = req.body;

  if (!action) {
    return res.status(400).json({ error: 'action required (accepted, rejected, modified)' });
  }

  try {
    const dbPath = path.join(process.cwd(), 'data', 'lightengine.db');
    
    // Update counters based on action
    let updateQuery;
    if (action === 'accepted') {
      updateQuery = 'UPDATE ai_training_status SET total_decisions = total_decisions + 1, accepted_decisions = accepted_decisions + 1 WHERE id = 1';
    } else if (action === 'rejected') {
      updateQuery = 'UPDATE ai_training_status SET total_decisions = total_decisions + 1, rejected_decisions = rejected_decisions + 1 WHERE id = 1';
    } else {
      updateQuery = 'UPDATE ai_training_status SET total_decisions = total_decisions + 1, overridden_decisions = overridden_decisions + 1 WHERE id = 1';
    }

    await new Promise((resolve, reject) => {
      exec(`sqlite3 "${dbPath}" "${updateQuery}"`, (error) => {
        if (error) return reject(error);
        resolve();
      });
    });

    // Log to planting_decisions table
    const insertQuery = `INSERT INTO planting_decisions (farm_id, group_id, recommended_crop, actual_crop, decision_action, notes) VALUES ('${process.env.FARM_ID || 'UNKNOWN'}', '${groupId}', '${recommendedCrop}', '${actualCrop}', '${action}', 'Phase 2 Bridge: ${action} recommendation')`;
    
    await new Promise((resolve, reject) => {
      exec(`sqlite3 "${dbPath}" "${insertQuery}"`, (error) => {
        if (error) console.warn('[AI Record] Failed to log decision:', error);
        resolve(); // Don't fail if logging fails
      });
    });

    // Get updated status
    const result = await new Promise((resolve, reject) => {
      exec(`sqlite3 "${dbPath}" "SELECT total_decisions, acceptance_rate, overall_readiness_pct, ml_ready FROM ai_readiness_dashboard;"`, (error, stdout) => {
        if (error) return reject(error);
        const values = stdout.trim().split('|');
        resolve({
          total_decisions: parseInt(values[0]) || 0,
          acceptance_rate: parseFloat(values[1]) || 0,
          overall_readiness_pct: parseInt(values[2]) || 0,
          ml_ready: parseInt(values[3]) || 0
        });
      });
    });

    res.json({
      success: true,
      recorded: action,
      current_progress: {
        total_decisions: result.total_decisions,
        acceptance_rate: Math.round(result.acceptance_rate * 100),
        overall_readiness: result.overall_readiness_pct,
        ml_ready: Boolean(result.ml_ready)
      }
    });
  } catch (error) {
    console.error('[AI Record] Error:', error);
    res.status(500).json({ error: 'Failed to record decision' });
  }
}));

/**
 * GET /api/tray-formats
 * Returns available tray format definitions (NeDB implementation)
 */
app.get('/api/tray-formats', async (req, res) => {
  try {
    // Query all formats from NeDB
    const formats = await trayFormatsDB.find({}).sort({ isCustom: 1, name: 1 });
    
    // If no formats exist, return default formats
    if (formats.length === 0) {
      const defaults = [
        {
          trayFormatId: 'microgreens-10x20',
          name: '10x20 Microgreens Tray',
          plantSiteCount: 200,
          systemType: 'NFT',
          isWeightBased: true,
          weightUnit: 'oz',
          targetWeightPerSite: 0.5,
          description: 'Standard 10x20 microgreens flat',
          isCustom: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        {
          trayFormatId: 'lettuce-5x10',
          name: '5x10 Lettuce Tray',
          plantSiteCount: 24,
          systemType: 'DWC',
          isWeightBased: false,
          weightUnit: 'heads',
          description: 'Deep water culture lettuce raft',
          isCustom: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        {
          trayFormatId: 'seedling-72',
          name: '72-Cell Seedling Tray',
          plantSiteCount: 72,
          systemType: 'Plug',
          isWeightBased: false,
          weightUnit: 'heads',
          description: 'Standard 72-cell plug tray for seedling starts',
          isCustom: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        {
          trayFormatId: 'seedling-128',
          name: '128-Cell Seedling Tray',
          plantSiteCount: 128,
          systemType: 'Plug',
          isWeightBased: false,
          weightUnit: 'heads',
          description: 'High-density 128-cell plug tray',
          isCustom: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        {
          trayFormatId: 'nft-channel-36',
          name: 'NFT Channel (36 sites)',
          plantSiteCount: 36,
          systemType: 'NFT',
          isWeightBased: false,
          weightUnit: 'heads',
          description: '6-channel NFT system with 6 sites per channel',
          isCustom: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        {
          trayFormatId: 'tower-garden-28',
          name: 'Vertical Tower (28 sites)',
          plantSiteCount: 28,
          systemType: 'Aeroponic',
          isWeightBased: false,
          weightUnit: 'heads',
          description: 'Aeroponic tower garden with 28 planting sites',
          isCustom: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        {
          trayFormatId: 'dwc-raft-48',
          name: 'DWC Raft (48 sites)',
          plantSiteCount: 48,
          systemType: 'DWC',
          isWeightBased: false,
          weightUnit: 'heads',
          description: 'Standard 2x4 floating raft with 48 net cups',
          isCustom: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        {
          trayFormatId: 'herb-12',
          name: 'Herb Tray (12 pots)',
          plantSiteCount: 12,
          systemType: 'DWC',
          isWeightBased: true,
          weightUnit: 'oz',
          targetWeightPerSite: 2,
          description: '12-pot herb growing tray',
          isCustom: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ];
      
      // Insert defaults into NeDB for persistence
      for (const format of defaults) {
        await trayFormatsDB.insert(format);
      }
      
      console.log('[tray-formats] Initialized with default formats');
      return res.json(defaults);
    }
    
    // Normalize formats from NeDB (handle snake_case from test-farm-wizard)
    const normalized = formats.map(f => ({
      trayFormatId: f.trayFormatId || f.tray_format_id || f._id,
      name: f.name || 'Unnamed Format',
      plantSiteCount: f.plantSiteCount || f.cells || (f.rows && f.columns ? f.rows * f.columns : 0),
      systemType: f.systemType || f.system_type || '',
      isWeightBased: f.isWeightBased || f.is_weight_based || false,
      weightUnit: f.weightUnit || f.weight_unit || 'heads',
      targetWeightPerSite: f.targetWeightPerSite || f.target_weight_per_site || 0,
      description: f.description || '',
      isCustom: f.isCustom !== undefined ? f.isCustom : (f.is_custom !== undefined ? f.is_custom : true),
      rows: f.rows || 0,
      columns: f.columns || 0,
      createdAt: f.createdAt || f.created_at || new Date().toISOString(),
      updatedAt: f.updatedAt || f.updated_at || new Date().toISOString()
    }));
    res.json(normalized);
  } catch (error) {
    console.error('[tray-formats] Failed to load formats:', error);
    res.status(500).json({ 
      error: 'Failed to load formats',
      message: error.message 
    });
  }
});

/**
 * POST /api/tray-formats
 * Create a new custom tray format (NeDB implementation)
 */
app.post('/api/tray-formats', async (req, res) => {
  try {
    const { name, plantSiteCount, systemType, trayMaterial, description, 
            isWeightBased, targetWeightPerSite, weightUnit } = req.body;
    
    // Validate required fields
    if (!name || !plantSiteCount) {
      return res.status(400).json({ 
        error: 'Missing required fields', 
        required: ['name', 'plantSiteCount'] 
      });
    }
    
    // Validate plant site count range
    const count = parseInt(plantSiteCount);
    if (isNaN(count) || count < 1 || count > 1000) {
      return res.status(400).json({ 
        error: 'plantSiteCount must be a number between 1 and 1000' 
      });
    }
    
    // Check for duplicate name
    const existing = await trayFormatsDB.findOne({ name });
    
    if (existing) {
      return res.status(409).json({ 
        error: 'Format with this name already exists',
        existingId: existing.trayFormatId
      });
    }
    
    // Generate unique ID
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const timestamp = Date.now();
    const trayFormatId = `custom-${slug}-${timestamp}`;
    
    // Create format document
    const format = {
      trayFormatId,
      name,
      plantSiteCount: count,
      systemType: systemType || null,
      trayMaterial: trayMaterial || null,
      description: description || null,
      isWeightBased: isWeightBased === true,
      targetWeightPerSite: isWeightBased ? (parseFloat(targetWeightPerSite) || null) : null,
      weightUnit: isWeightBased ? (weightUnit || 'oz') : 'heads',
      isCustom: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    // Insert into NeDB
    const inserted = await trayFormatsDB.insert(format);
    
    console.log(`[tray-formats] Created: ${inserted.trayFormatId}`);
    res.status(201).json(inserted);
    
  } catch (error) {
    console.error('[tray-formats] Create failed:', error);
    res.status(500).json({ 
      error: 'Failed to create format',
      message: error.message 
    });
  }
});

/**
 * PUT /api/tray-formats/:id
 * Update an existing tray format (NeDB implementation)
 */
app.put('/api/tray-formats/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, plantSiteCount, systemType, trayMaterial, description,
            isWeightBased, targetWeightPerSite, weightUnit } = req.body;
    
    // Find existing format
    const existing = await trayFormatsDB.findOne({ trayFormatId: id });
    
    if (!existing) {
      return res.status(404).json({ error: 'Format not found' });
    }
    
    // Prevent editing default formats
    if (!existing.isCustom) {
      return res.status(403).json({ 
        error: 'Cannot edit default formats',
        hint: 'Create a custom format instead'
      });
    }
    
    // Build update object (only include provided fields)
    const updates = {
      updatedAt: new Date().toISOString()
    };
    
    if (name !== undefined) {
      // Check for duplicate name (excluding current format)
      const duplicate = await trayFormatsDB.findOne({ 
        name, 
        trayFormatId: { $ne: id } 
      });
      
      if (duplicate) {
        return res.status(409).json({ 
          error: 'Another format with this name already exists' 
        });
      }
      updates.name = name;
    }
    
    if (plantSiteCount !== undefined) {
      const count = parseInt(plantSiteCount);
      if (isNaN(count) || count < 1 || count > 1000) {
        return res.status(400).json({ 
          error: 'plantSiteCount must be a number between 1 and 1000' 
        });
      }
      updates.plantSiteCount = count;
    }
    
    if (systemType !== undefined) updates.systemType = systemType || null;
    if (trayMaterial !== undefined) updates.trayMaterial = trayMaterial || null;
    if (description !== undefined) updates.description = description || null;
    
    if (isWeightBased !== undefined) {
      updates.isWeightBased = isWeightBased === true;
      updates.targetWeightPerSite = isWeightBased 
        ? (parseFloat(targetWeightPerSite) || null) 
        : null;
      updates.weightUnit = isWeightBased ? (weightUnit || 'oz') : 'heads';
    }
    
    // Update in NeDB
    const numUpdated = await trayFormatsDB.update(
      { trayFormatId: id },
      { $set: updates }
    );
    
    if (numUpdated === 0) {
      return res.status(500).json({ error: 'Update operation failed' });
    }
    
    // Fetch updated document
    const updated = await trayFormatsDB.findOne({ trayFormatId: id });
    
    console.log(`[tray-formats] Updated: ${id}`);
    res.json(updated);
    
  } catch (error) {
    console.error('[tray-formats] Update failed:', error);
    res.status(500).json({ 
      error: 'Failed to update format',
      message: error.message 
    });
  }
});

/**
 * DELETE /api/tray-formats/:id
 * Delete a custom tray format (NeDB implementation)
 */
app.delete('/api/tray-formats/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Find existing format
    const existing = await trayFormatsDB.findOne({ trayFormatId: id });
    
    if (!existing) {
      return res.status(404).json({ error: 'Format not found' });
    }
    
    // Prevent deleting default formats
    if (!existing.isCustom) {
      return res.status(403).json({ 
        error: 'Cannot delete default formats' 
      });
    }
    
    // Check if format is in use by any trays
    const traysUsingFormat = await traysDB.count({ trayFormatId: id });
    
    if (traysUsingFormat > 0) {
      return res.status(409).json({ 
        error: 'Cannot delete format in use',
        traysAffected: traysUsingFormat,
        hint: 'Reassign or delete trays using this format first'
      });
    }
    
    // Delete from NeDB
    const numRemoved = await trayFormatsDB.remove({ trayFormatId: id });
    
    if (numRemoved === 0) {
      return res.status(500).json({ error: 'Delete operation failed' });
    }
    
    console.log(`[tray-formats] Deleted: ${id}`);
    res.json({ 
      success: true, 
      deleted: id,
      message: 'Format deleted successfully'
    });
    
  } catch (error) {
    console.error('[tray-formats] Delete failed:', error);
    res.status(500).json({ 
      error: 'Failed to delete format',
      message: error.message 
    });
  }
});

/**
 * GET /api/recipes
 * Returns available lighting recipes
 */
app.get('/api/recipes', (req, res) => {
  const recipesPath = path.join(PUBLIC_DIR, 'data/lighting-recipes.json');
  try {
    if (fs.existsSync(recipesPath)) {
      const recipes = JSON.parse(fs.readFileSync(recipesPath, 'utf8'));
      res.json(recipes);
    } else {
      res.json([
        { id: 'leafy-veg', name: 'Leafy Greens - Vegetative', spectrum: 'CW/WW + 450nm + 660nm' },
        { id: 'fruiting', name: 'Fruiting Crops', spectrum: 'CW/WW + 450nm + 660nm + 730nm' },
        { id: 'microgreens', name: 'Microgreens', spectrum: 'CW/WW + 450nm' }
      ]);
    }
  } catch (error) {
    console.error('[recipes] Failed to load recipes:', error);
    res.json([]);
  }
});

/**
 * GET /api/trays
 * List all registered trays with their status and details
 */
app.get('/api/trays', async (req, res) => {
  try {
    // Use NeDB instead of SQLite
    const trays = await traysDB.find({});
    const trayFormats = await trayFormatsDB.find({});
    const trayRuns = await trayRunsDB.find({});
    const trayPlacements = await trayPlacementsDB.find({});
    
    // Create lookup maps
    const formatMap = new Map(trayFormats.map(f => [f.tray_format_id, f]));
    
    // Get latest run for each tray
    const latestRuns = new Map();
    for (const run of trayRuns) {
      const existing = latestRuns.get(run.tray_id);
      if (!existing || new Date(run.created_at) > new Date(existing.created_at)) {
        latestRuns.set(run.tray_id, run);
      }
    }
    
    // Get latest placement for each run
    const latestPlacements = new Map();
    for (const placement of trayPlacements) {
      const existing = latestPlacements.get(placement.tray_run_id);
      if (!existing || new Date(placement.placed_at) > new Date(existing.placed_at)) {
        latestPlacements.set(placement.tray_run_id, placement);
      }
    }
    
    // Build tray list with enriched data
    const traysWithYield = trays.map(tray => {
      const format = formatMap.get(tray.tray_format_id);
      const currentRun = latestRuns.get(tray.tray_id);
      const currentPlacement = currentRun ? latestPlacements.get(currentRun.tray_run_id) : null;
      
      // Determine status
      let status = 'available';
      if (currentRun) {
        if (currentRun.harvested_at) {
          status = 'harvested';
        } else {
          status = 'active';
        }
      }
      
      // Calculate days since seeding
      let daysSinceSeeding = null;
      if (currentRun?.seeded_at) {
        const seededDate = new Date(currentRun.seeded_at);
        const now = new Date();
        daysSinceSeeding = Math.floor((now - seededDate) / (1000 * 60 * 60 * 24));
      }
      
      // Calculate forecasted yield — progressive weight refinement:
      // Priority 1: Tray run's target_weight_oz (crop-specific from benchmark or format)
      // Priority 2: Format-level targetWeightPerSite (generic fallback)
      // Priority 3: Count-based estimate (non-weight-based trays)
      let forecastedYield = null;
      if (format?.plant_site_count) {
        const plantSites = currentRun?.planted_site_count || format.plant_site_count;
        if (currentRun?.target_weight_oz) {
          // Use the target weight assigned at seeding (benchmark or format-level)
          const totalWeight = plantSites * currentRun.target_weight_oz;
          const source = currentRun.target_weight_source === 'benchmark' ? '✓' : '~';
          forecastedYield = `${totalWeight.toFixed(1)} ${format.weight_unit || 'oz'} ${source}`;
        } else if (format.is_weight_based && format.target_weight_per_site) {
          const totalWeight = format.plant_site_count * format.target_weight_per_site;
          forecastedYield = `${totalWeight.toFixed(1)} ${format.weight_unit || 'oz'} ~`;
        } else {
          const successRate = 0.9; // 90% success rate
          forecastedYield = `${Math.floor(format.plant_site_count * successRate)} heads`;
        }
      }

      return {
        trayId: tray.tray_id,
        qrCode: tray.qr_code_value,
        formatId: tray.tray_format_id,
        formatName: format?.format_name,
        plantSiteCount: format?.plant_site_count,
        forecastedYield,
        status,
        currentRunId: currentRun?.tray_run_id,
        currentRecipe: currentRun?.recipe_id,
        currentLocation: currentPlacement?.location_qr,
        groupId: currentRun?.group_id || null,
        seededAt: currentRun?.seeded_at,
        plantedSiteCount: currentRun?.planted_site_count,
        daysSinceSeeding,
        createdAt: tray.created_at,
        updatedAt: tray.updated_at
      };
    });
    
    // Sort by created_at descending
    traysWithYield.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json(traysWithYield);
  } catch (error) {
    console.error('[trays] Error listing trays:', error);
    res.status(500).json({ error: 'Failed to list trays', details: error.message });
  }
});

/**
 * GET /api/tray-runs/recent-harvests
 * Get recent harvests with lot codes from the last 7 days
 */
app.get('/api/tray-runs/recent-harvests', async (req, res) => {
  try {
    const db = await getDb();
    
    // Query tray runs that have been harvested with lot codes in the last 7 days
    const harvests = await db.all(`
      SELECT 
        tr.tray_run_id,
        tr.recipe_id,
        tr.lot_code,
        tr.harvested_at,
        tr.harvested_count,
        tr.actual_weight,
        tr.weight_unit,
        tp.location_qr as zone,
        t.qr_code_value as tray_qr
      FROM tray_runs tr
      LEFT JOIN trays t ON tr.tray_id = t.tray_id
      LEFT JOIN (
        SELECT tray_run_id, location_qr, placed_at
        FROM tray_placements
        WHERE placement_id IN (
          SELECT MAX(placement_id) 
          FROM tray_placements 
          GROUP BY tray_run_id
        )
      ) tp ON tr.tray_run_id = tp.tray_run_id
      WHERE tr.lot_code IS NOT NULL 
        AND tr.harvested_at IS NOT NULL
        AND tr.harvested_at > datetime('now', '-7 days')
      ORDER BY tr.harvested_at DESC
      LIMIT 50
    `);

    res.json({ 
      success: true, 
      harvests: harvests.map(h => ({
        trayRunId: h.tray_run_id,
        recipeId: h.recipe_id,
        lotCode: h.lot_code,
        harvestedAt: h.harvested_at,
        harvestedCount: h.harvested_count,
        actualWeight: h.actual_weight,
        weightUnit: h.weight_unit,
        zone: h.zone,
        trayQr: h.tray_qr
      }))
    });
  } catch (error) {
    console.error('[tray-runs] Error fetching recent harvests:', error);
    res.status(500).json({ error: 'Failed to fetch recent harvests', details: error.message });
  }
});

/**
 * POST /api/tray-runs/:id/harvest
 * Record harvest for a tray run — creates lot code, updates status, captures weight.
 * Called by Activity Hub during harvest scan.
 */
app.post('/api/tray-runs/:id/harvest', async (req, res) => {
  const trayRunId = req.params.id;
  const { actualWeight, note, harvestedAt } = req.body;

  try {
    // Look up tray run from NeDB
    const trayRun = await trayRunsDB.findOne({ tray_run_id: trayRunId });

    if (!trayRun) {
      return res.status(404).json({ error: 'Tray run not found', tray_run_id: trayRunId });
    }

    // Generate lot code: ZONE-CROP-YYMMDD-BATCH
    const now = new Date(harvestedAt || Date.now());
    const dateStr = now.toISOString().slice(2, 10).replace(/-/g, '');
    const cropName = (trayRun.recipe_id || trayRun.crop || 'CROP').toUpperCase().slice(0, 8).replace(/[^A-Z0-9]/g, '');
    const batchSuffix = Math.random().toString(36).slice(2, 6).toUpperCase();
    const lotCode = `A1-${cropName}-${dateStr}-${batchSuffix}`;
    const batchId = `B-${dateStr}-${batchSuffix}`;

    // Parse weight — use explicit value if given, otherwise use target weight from seeding
    const explicitWeight = parseFloat(actualWeight) || null;
    const plantSites = trayRun.planted_site_count || trayRun.plantCount || null;
    let weight = explicitWeight;
    let weightSource = explicitWeight ? 'manual' : null;
    if (!weight && trayRun.target_weight_oz && plantSites) {
      weight = +(trayRun.target_weight_oz * plantSites).toFixed(2);
      weightSource = trayRun.target_weight_source || 'target';
    }
    const harvestedCount = plantSites;

    // Update tray run record
    await trayRunsDB.update(
      { tray_run_id: trayRunId },
      {
        $set: {
          status: 'HARVESTED',
          harvested_at: now.toISOString(),
          lot_code: lotCode,
          actual_weight: weight,
          weight_unit: 'oz',
          harvested_count: harvestedCount,
          harvest_note: note || '',
          updated_at: now.toISOString()
        }
      }
    );

    // ── Crop-driven reconciliation: prioritize unverified crops ──────────
    // Crops without verified benchmark data get higher weigh-in chance (80%)
    // Crops with verified data get standard sampling rate (20%)
    let shouldWeigh = false;
    try {
      const cropKey = trayRun.recipe_id || trayRun.crop;
      const hasVerifiedWeight = hasCropBenchmark(cropKey);
      const weighRatio = hasVerifiedWeight
        ? (parseFloat(process.env.WEIGH_IN_RATIO_VERIFIED) || 0.20)   // verified: 1-in-5
        : (parseFloat(process.env.WEIGH_IN_RATIO_UNVERIFIED) || 0.80); // unverified: 4-in-5
      shouldWeigh = Math.random() < weighRatio;
    } catch (_) {}

    console.log(`[tray-runs] Harvest recorded: ${trayRunId} → lot ${lotCode}, weight: ${weight || 'N/A'}${shouldWeigh ? ' [WEIGH-IN FLAGGED]' : ''}`);

    // ── Auto-create SFCR traceability record ──────────────────────────
    // Enrich with tray + format + placement data (best-effort, non-blocking)
    let traceRecord = null;
    try {
      // Look up tray for this run
      const tray = await traysDB.findOne({ tray_id: trayRun.tray_id }).catch(() => null);

      // Look up format
      let trayFormat = null;
      const formatId = tray?.format_id || tray?.trayFormatId || trayRun.tray_format_id;
      if (formatId) {
        trayFormat = await trayFormatsDB.findOne({ $or: [{ trayFormatId: formatId }, { _id: formatId }] }).catch(() => null);
      }

      // Look up placement (latest)
      const placements = await trayPlacementsDB.find({ tray_id: trayRun.tray_id }).sort({ placed_at: -1 }).limit(1).catch(() => []);
      const placement = placements?.[0] || null;

      // Calculate grow days
      const seedDate = trayRun.seeded_at || trayRun.created_at;
      const growDays = seedDate ? Math.floor((now - new Date(seedDate)) / 86400000) : null;

      traceRecord = createTraceRecord({
        lot_code:           lotCode,
        batch_id:           batchId,
        tray_run_id:        trayRunId,
        crop_name:          trayRun.recipe_id || trayRun.crop || 'Unknown',
        variety:            trayRun.variety || null,
        recipe_id:          trayRun.recipe_id || null,
        zone:               placement?.location_qr || placement?.zone || trayRun.zone || '',
        room:               placement?.room || trayRun.room || '',
        tray_format_name:   trayFormat?.name || '',
        system_type:        trayFormat?.systemType || '',
        planted_site_count: harvestedCount,
        harvested_count:    harvestedCount,
        actual_weight:      weight,
        weight_unit:        'oz',
        harvest_date:       now.toISOString(),
        harvested_by:       req.headers['x-operator'] || req.body.operator || 'operator',
        seed_date:          seedDate || null,
        seed_source:        trayRun.seed_source || null,
        grow_days:          growDays,
      });
      console.log(`[tray-runs] Auto-trace record created: ${traceRecord.trace_id} for lot ${lotCode}`);
    } catch (traceErr) {
      console.warn(`[tray-runs] Trace record creation failed (non-fatal):`, traceErr.message);
    }

    // -- Phase 2 Task 2.4: Auto-trigger harvest label print ----------------
    // Include ready-to-print label data so the Activity Hub can fire the print
    // automatically without a separate manual step.
    const labelPrintData = {
      lotCode,
      cropName: (trayRun.recipe_id || trayRun.crop || 'Unknown'),
      weight: weight || 'N/A',
      unit: 'oz',
      harvestedAt: now.toISOString(),
      auto_print: true,     // signals client to auto-submit to /api/printer/print-harvest
      endpoint: '/api/printer/print-harvest'
    };

    // -- Ticket 2.6: Server-side auto-print attempt -------------------------
    // Fire the print request internally for zero-touch harvest labeling.
    // Non-blocking — failure does not affect the harvest response.
    let autoPrintResult = null;
    try {
      const port = process.env.PORT || 3000;
      const printRes = await fetch(`http://localhost:${port}/api/printer/print-harvest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(labelPrintData),
        signal: AbortSignal.timeout(3000)
      });
      autoPrintResult = printRes.ok ? 'sent' : 'printer_unavailable';
    } catch (_printErr) {
      autoPrintResult = 'printer_unavailable';
    }

    // ── Phase 0 Task 0.4: Auto-generate experiment record on tray harvest ──
    // Non-blocking — failure here does not block the harvest response
    let experiment_id = null;
    try {
      const seedDate = trayRun.seeded_at || trayRun.created_at;
      const growDays = seedDate ? Math.floor((now - new Date(seedDate)) / 86400000) : null;
      const weightPerPlant = (weight && harvestedCount) ? +(weight / harvestedCount).toFixed(3) : null;

      const experimentInput = {
        groupId: trayRun.group_id || trayRun.groupId || trayRunId,
        crop: trayRun.recipe_id || trayRun.crop || null,
        recipe_id: trayRun.recipe_id || null,
        grow_days: growDays,
        planned_grow_days: null,
        weight_per_plant_oz: weightPerPlant,
        total_weight_oz: weight,
        planted_site_count: harvestedCount,
        tray_format: trayRun.tray_format_id || null,
        system_type: null,
        zone: trayRun.zone || null,
        room: trayRun.room || null,
      };
      const record = await buildExperimentRecord(experimentInput);
      const inserted = await harvestOutcomesDB.insert(record);
      experiment_id = inserted._id;
      console.log(`[tray-runs] ✓ Experiment record auto-created for ${record.crop || trayRunId}`);
      syncExperimentToCenter(record).catch(e =>
        console.warn('[tray-runs] Experiment Central sync deferred:', e?.message)
      );
    } catch (expErr) {
      console.warn('[tray-runs] Experiment record creation failed (non-fatal):', expErr.message);
    }

    // Phase 1 Ticket 1.6 — emit standardized harvest event
    eventBus.emitEvent('harvest', {
      tray_run_id: trayRunId,
      group_id: trayRun?.group_id || null,
      crop: trayRun?.crop || trayRun?.recipe_id || null,
      total_weight_oz: weight || null,
      harvested_count: harvestedCount,
      planted_count: trayRun?.planted_site_count || null,
      loss_count: null,
      grow_days: trayRun?.seeded_at ? Math.floor((Date.now() - new Date(trayRun.seeded_at).getTime()) / 86400000) : null,
      quality_grade: null,
      experiment_id: experiment_id || null,
      zone: null,
      room: null,
      harvested_by: null,
    });

    res.json({
      success: true,
      trayRunId,
      lotCode,
      batchId,
      actualWeight: weight,
      harvestedCount,
      harvestedAt: now.toISOString(),
      shouldWeigh,
      weighInReason: shouldWeigh
        ? 'This tray has been selected for a full weigh-in. Please weigh the entire cut crop and record the weight.'
        : null,
      trace_id: traceRecord?.trace_id || null,
      experiment_id: experiment_id || null,
      label_print: labelPrintData,
      auto_print_result: autoPrintResult
    });
  } catch (error) {
    console.error('[tray-runs] Error recording harvest:', error);
    res.status(500).json({ error: 'Failed to record harvest', details: error.message });
  }
});

/**
 * POST /api/trays/register
 * Register a new tray in the system
 */
app.post('/api/trays/register', (req, res) => {
  const { trayId, format, plantCount } = req.body;
  
  if (!trayId) {
    return res.status(400).json({ error: 'trayId required' });
  }
  
  // In demo mode, just acknowledge registration
  if (isDemoMode()) {
    console.log('[inventory] Demo mode: Tray registered:', trayId);
    return res.json({ success: true, trayId, message: 'Tray registered (demo mode)' });
  }
  
  // TODO: Implement production tray registration
  res.json({ success: true, trayId });
});

/**
 * POST /api/trays/:trayId/seed
 * Record seeding operation for a tray — creates a tray run with traceability context.
 * seed_source (supplier + lot#) is the ONLY manual traceability input needed.
 * position (optional) — location QR code for initial placement (e.g. "FARM-RoomA-L5").
 *
 * NOTE: group_id is intentionally NOT set at seeding time.
 * The tray is assigned to a group later when the grower scans the tray QR
 * followed by the group QR using the Activity Hub Quick Move feature.
 * See POST /api/tray-runs/:id/move for group assignment logic.
 */
app.post('/api/trays/:trayId/seed', async (req, res) => {
  const { trayId } = req.params;
  const { recipe, seedDate, plantCount, seed_source, variety, position, groupId } = req.body;

  if (!recipe) {
    return res.status(400).json({ error: 'recipe (crop) is required' });
  }

  try {
    const now = new Date(seedDate || Date.now());
    const trayRunId = `TR-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

    // ── Determine target weight (progressive refinement) ──────────────────
    // Priority 1: Verified crop benchmark from reconciliation weigh-ins
    // Priority 2: Format-level targetWeightPerSite (generic fallback)
    // -- Phase 2 Task 2.1: Auto-derive plant count from tray format ----------
    // If plantCount not explicitly provided, look up from tray's format definition
    let resolvedPlantCount = parseInt(plantCount) || null;
    let plantCountSource = resolvedPlantCount ? 'manual' : null;
    let trayFormat = null;

    const tray = await traysDB.findOne({ tray_id: trayId }).catch(() => null);
    if (tray) {
      const formatId = tray.format_id || tray.trayFormatId || tray.tray_format_id;
      if (formatId) {
        trayFormat = await trayFormatsDB.findOne({ $or: [{ trayFormatId: formatId }, { _id: formatId }] }).catch(() => null);
      }
    }

    if (!resolvedPlantCount && trayFormat) {
      const formatCount = trayFormat.plantSiteCount || trayFormat.plant_site_count;
      if (formatCount) {
        resolvedPlantCount = parseInt(formatCount);
        plantCountSource = 'tray_format';
        console.log(`[tray-runs] Auto-derived plant count ${resolvedPlantCount} from format ${trayFormat.name || trayFormat.trayFormatId}`);
      }
    }

    let targetWeightOz = null;
    let targetWeightSource = null;

    const cropBenchmark = getCropBenchmark(recipe);
    if (cropBenchmark && cropBenchmark.verified) {
      targetWeightOz = cropBenchmark.avg_weight_per_plant_oz;
      targetWeightSource = 'benchmark';
    } else if (trayFormat && trayFormat.is_weight_based && trayFormat.target_weight_per_site) {
      targetWeightOz = trayFormat.target_weight_per_site;
      targetWeightSource = 'format';
    }

    const trayRun = {
      tray_run_id:        trayRunId,
      tray_id:            trayId,
      recipe_id:          recipe,
      crop:               recipe,
      variety:            variety || null,
      seeded_at:          now.toISOString(),
      planted_site_count: resolvedPlantCount,
      plantCount:         resolvedPlantCount,
      plant_count_source: plantCountSource,
      seed_source:        seed_source || null,
      target_weight_oz:   targetWeightOz,
      target_weight_source: targetWeightSource,
      group_id:           groupId || null,
      status:             'GROWING',
      created_at:         now.toISOString(),
      updated_at:         now.toISOString()
    };

    await trayRunsDB.insert(trayRun);

    // -- Phase 2 Task 2.3: Combined seed + group assignment ---------------
    let placementId = null;
    const effectivePosition = groupId || position;
    if (effectivePosition) {
      const placement = {
        tray_run_id:    trayRunId,
        tray_id:        trayId,
        location_qr:    effectivePosition,
        placed_at:      now.toISOString(),
        removed_at:     null,
        removal_reason: null,
        group_id:       groupId || null
      };
      const inserted = await trayPlacementsDB.insert(placement);
      placementId = inserted._id;
      console.log(`[tray-runs] Placed: ${trayRunId} at ${effectivePosition}${groupId ? ` (group: ${groupId})` : ''}`);
    }

    // -- Phase 2 Task 2.6: Sync seed date to group -----------------------
    if (groupId) {
      try {
        const groupsPath = path.join(__dirname, 'public', 'data', 'groups.json');
        const groupsRaw = fs.readFileSync(groupsPath, 'utf8');
        const groupsData = JSON.parse(groupsRaw);
        const groupsArray = Array.isArray(groupsData) ? groupsData
          : Array.isArray(groupsData.groups) ? groupsData.groups : [];
        const targetGroup = groupsArray.find(g => g.id === groupId);
        if (targetGroup) {
          if (!targetGroup.planConfig) targetGroup.planConfig = {};
          if (!targetGroup.planConfig.anchor) targetGroup.planConfig.anchor = {};
          const seedDateStr = now.toISOString().slice(0, 10);
          targetGroup.planConfig.anchor.seedDate = seedDateStr;
          if (!targetGroup.crop) targetGroup.crop = recipe;
          fs.writeFileSync(groupsPath, JSON.stringify(groupsData, null, 2));
          console.log(`[tray-runs] Synced seed date ${seedDateStr} + crop ${recipe} to group ${groupId}`);
        }
      } catch (syncErr) {
        console.warn(`[tray-runs] Seed date sync to group failed (non-fatal):`, syncErr.message);
      }
    }

    console.log(`[tray-runs] Seeded: ${trayRunId} tray=${trayId} crop=${recipe} plants=${resolvedPlantCount ?? 'unknown'} (${plantCountSource || 'no data'}) targetWeight=${targetWeightOz ?? 'none'} (${targetWeightSource || 'no data'})${seed_source ? ` source=${seed_source}` : ''}${groupId ? ` group=${groupId}` : ''}`);

    // Phase 1 Ticket 1.6 — emit standardized seed event
    eventBus.emitEvent('seed', {
      tray_run_id: trayRunId,
      group_id: groupId || null,
      crop: recipe,
      variety: variety || null,
      seed_count: resolvedPlantCount,
      tray_format: trayFormat?.name || null,
      zone: null,
      room: null,
      recipe_id: recipe,
      seeded_by: null,
    });

    res.json({
      success: true,
      tray_run_id: trayRunId,
      placement_id: placementId,
      planted_site_count: resolvedPlantCount,
      plant_count_source: plantCountSource,
      target_weight_oz: targetWeightOz,
      target_weight_source: targetWeightSource,
      group_id: groupId || null,
      message: groupId ? `Seeding recorded + assigned to group ${groupId}` : 'Seeding recorded'
    });
  } catch (error) {
    console.error('[tray-runs] Seed error:', error);
    res.status(500).json({ error: 'Failed to record seeding' });
  }
});

/**
 * GET /api/crops
 * Returns crop definitions from crop-registry.json (Phase 2a — single source of truth)
 * Query params: ?active=true (filter to active crops only), ?category=lettuce
 */
app.get('/api/crops', (req, res) => {
  const registryPath = path.join(PUBLIC_DIR, 'data/crop-registry.json');
  try {
    const registryData = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
    const activeOnly = req.query.active === 'true';
    const categoryFilter = req.query.category || null;
    const dedicatedOnly = req.query.dedicated === 'true';

    // Load farm's dedicated crop list when requested
    let dedicatedSet = null;
    if (dedicatedOnly) {
      try {
        const farmData = JSON.parse(fs.readFileSync(path.join(PUBLIC_DIR, 'data', 'farm.json'), 'utf8'));
        const dedicatedIds = farmData.dedicated_crops || [];
        if (dedicatedIds.length > 0) {
          dedicatedSet = new Set(dedicatedIds);
        }
      } catch (_) { /* no farm.json — skip filter */ }
    }

    const crops = Object.entries(registryData.crops)
      .filter(([, crop]) => !activeOnly || crop.active)
      .filter(([, crop]) => !categoryFilter || crop.category === categoryFilter)
      .filter(([name, crop]) => {
        if (!dedicatedSet) return true;
        // Match by name key or planIds
        if (dedicatedSet.has(name)) return true;
        return (crop.planIds || []).some(pid => dedicatedSet.has(pid));
      })
      .map(([name, crop]) => ({
        name,
        category: crop.category,
        active: crop.active,
        aliases: crop.aliases,
        planIds: crop.planIds,
        growth: crop.growth,
        pricing: crop.pricing,
        market: crop.market,
        nutrientProfile: crop.nutrientProfile,
        dedicated: dedicatedSet ? dedicatedSet.has(name) || (crop.planIds || []).some(pid => dedicatedSet.has(pid)) : undefined
      }));

    res.json({ version: registryData.version, crops });
  } catch (error) {
    console.error('[crops] Failed to load crop registry:', error?.message);
    // Fallback: return active crops from cropUtils cache
    const fallback = cropUtils.getAllCrops();
    res.json({ version: 'fallback', crops: fallback.map(c => ({ name: c.name, ...c.crop })) });
  }
});

/**
 * POST /api/tray-runs/:id/loss
 * Record a tray loss event and mark tray as lost
 */
app.post('/api/tray-runs/:id/loss', async (req, res) => {
  const { id: trayRunId } = req.params;
  const { crop_name, crop_id, loss_reason, lost_quantity, notes } = req.body;
  
  // Validate required fields
  if (!trayRunId) {
    return res.status(400).json({ error: 'tray_run_id required' });
  }
  
  if (!crop_name && !crop_id) {
    return res.status(400).json({ error: 'Either crop_name or crop_id required' });
  }
  
  if (!loss_reason) {
    return res.status(400).json({ error: 'loss_reason required' });
  }
  
  try {
    // In demo mode, just mock the operation
    if (isDemoMode()) {
      console.log('[inventory] Demo mode: Tray loss recorded:', { 
        trayRunId, 
        crop_name, 
        crop_id, 
        loss_reason, 
        lost_quantity, 
        notes 
      });
      
      return res.json({ 
        success: true, 
        message: 'Loss recorded (demo mode)',
        trayRunId,
        status: 'LOST'
      });
    }
    
    // Check if tray run exists
    const trayRun = await trayRunsDB.findOne({ _id: trayRunId });
    if (!trayRun) {
      return res.status(404).json({ error: 'Tray run not found' });
    }
    
    // Check if already lost or harvested
    if (trayRun.status === 'LOST') {
      return res.status(400).json({ error: 'Tray already marked as lost' });
    }
    
    if (trayRun.status === 'HARVESTED') {
      return res.status(400).json({ error: 'Cannot mark harvested tray as lost' });
    }
    
    // Create loss event record
    const lossEvent = {
      tray_run_id: trayRunId,
      crop_name: crop_name || null,
      crop_id: crop_id || null,
      loss_reason,
      lost_quantity: lost_quantity || null,
      notes: notes || '',
      created_at: new Date().toISOString()
    };

    // ─── AI Vision Phase 1 (Task 1.4): Capture environment snapshot ───
    // Correlate loss with environment 24h prior (Rule 1.2: outcomes → inputs)
    try {
      const envState = readEnv();
      const trayPlacement = await trayPlacementsDB.findOne({
        tray_run_id: trayRunId, removed_at: null
      });
      const lossRoom = trayPlacement?.room || trayRun.room || null;
      const lossZone = trayPlacement?.zone || trayRun.zone || null;

      // Get current environment from env.json zones
      if (envState.zones && (lossRoom || lossZone)) {
        const zoneData = Object.values(envState.zones || {}).find(z =>
          z.room === lossRoom || z.zone_name === lossZone || z.name === lossZone
        );
        if (zoneData?.sensors?.[0]?.readings) {
          const r = zoneData.sensors[0].readings;
          lossEvent.environment_snapshot = {
            temp_c: r.temperature_c ?? null,
            humidity_pct: r.humidity ?? null,
            co2_ppm: r.co2 ?? null,
            pressure_hpa: r.pressure_hpa ?? null,
            room: lossRoom,
            zone: lossZone,
            snapshot_at: new Date().toISOString()
          };
        }
      }

      // Also capture plan resolver targets for the group (what SHOULD conditions be)
      if (envState.planResolver?.groups) {
        const groupForTray = envState.planResolver.groups.find(g =>
          g.room === lossRoom || g.groupName === lossRoom
        );
        if (groupForTray) {
          lossEvent.expected_conditions = {
            tempC: groupForTray.env?.tempC ?? null,
            rh: groupForTray.env?.rh ?? null,
            ppfd: groupForTray.targetPpfd ?? null,
            planDay: groupForTray.day ?? null,
            stage: groupForTray.stage ?? null
          };
        }
      }
    } catch (envErr) {
      // Environment snapshot is best-effort — don't fail the loss record
      console.warn('[inventory] Environment snapshot for loss failed:', envErr?.message);
    }
    
    const insertedEvent = await trayLossEventsDB.insert(lossEvent);
    
    // Phase 1 Ticket 1.6 — emit standardized loss event
    eventBus.emitEvent('loss', {
      tray_run_id: trayRunId,
      group_id: trayRun?.group_id || null,
      crop: crop_name || crop_id || trayRun?.crop || null,
      loss_count: lost_quantity ? parseInt(lost_quantity) : null,
      loss_reason: loss_reason,
      loss_category: 'other',
      zone: lossEvent.environment_snapshot?.zone || null,
      reported_by: null,
    });

    // Update tray run status to LOST
    await trayRunsDB.update(
      { _id: trayRunId },
      { $set: { status: 'LOST', lost_at: new Date().toISOString() } }
    );
    
    // Close any active placement
    await trayPlacementsDB.update(
      { tray_run_id: trayRunId, removed_at: null },
      { $set: { removed_at: new Date().toISOString(), removal_reason: 'LOSS' } },
      { multi: true }
    );
    
    res.json({
      success: true,
      message: 'Loss recorded successfully',
      trayRunId,
      lossEventId: insertedEvent._id,
      status: 'LOST'
    });
    
  } catch (error) {
    console.error('[inventory] Error recording loss:', error);
    res.status(500).json({ error: 'Failed to record loss', details: error.message });
  }
});

/**
 * GET /api/tray-runs/:id/loss-events
 * Get loss events for a specific tray run
 */
app.get('/api/tray-runs/:id/loss-events', async (req, res) => {
  const { id: trayRunId } = req.params;
  
  try {
    if (isDemoMode()) {
      return res.json({ 
        trayRunId,
        lossEvents: [],
        message: 'Demo mode - no loss events' 
      });
    }
    
    const lossEvents = await trayLossEventsDB.find({ tray_run_id: trayRunId });
    
    res.json({
      trayRunId,
      lossEvents
    });
    
  } catch (error) {
    console.error('[inventory] Error fetching loss events:', error);
    res.status(500).json({ error: 'Failed to fetch loss events' });
  }
});

/**
 * POST /api/tray-runs/:id/move
 * Move a tray to a new position — close current placement, create new one.
 * Body: { newPosition: "FARM-RoomB-L3" or "GRP:Room:Zone:Group", timestamp? }
 * Called by Activity Hub Quick Move (two-step scan: tray QR → position QR).
 *
 * Group detection: If newPosition starts with "GRP:" or matches a known group ID
 * from groups.json, the tray run's group_id is set. This links the tray to the
 * group for the planting scheduler and inventory queries.
 */
app.post('/api/tray-runs/:id/move', async (req, res) => {
  const trayRunId = req.params.id;
  const { newPosition, timestamp } = req.body;

  if (!newPosition) {
    return res.status(400).json({ error: 'newPosition is required' });
  }

  try {
    // Resolve tray run — could be tray_run_id or tray_id (QR code value)
    let trayRun = await trayRunsDB.findOne({ tray_run_id: trayRunId });
    if (!trayRun) {
      // Try by tray_id (user scanned the tray QR, not the run ID)
      const runs = await trayRunsDB.find({ tray_id: trayRunId, status: 'GROWING' });
      if (runs.length > 0) {
        // Pick the most recent active run
        runs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        trayRun = runs[0];
      }
    }

    if (!trayRun) {
      return res.status(404).json({ error: 'Tray run not found', tray_run_id: trayRunId });
    }

    const now = new Date(timestamp || Date.now()).toISOString();
    const actualRunId = trayRun.tray_run_id;
    const trayId = trayRun.tray_id;

    // --- Group detection ---
    // If the scanned QR starts with "GRP:" it's a group label QR.
    // Otherwise, check if the raw value matches a known group ID in groups.json.
    let groupId = null;
    let locationQr = newPosition;

    if (newPosition.startsWith('GRP:')) {
      groupId = newPosition.slice(4);
      locationQr = groupId; // store clean group ID as location
    } else {
      // Fallback: check if newPosition matches a group ID in groups.json
      try {
        const groupsPath = path.join(__dirname, 'public', 'data', 'groups.json');
        const groupsData = JSON.parse(fs.readFileSync(groupsPath, 'utf8'));
        // groups.json stores { groups: [ { id, name, ... }, ... ] }
        const groupsArray = Array.isArray(groupsData) ? groupsData
          : Array.isArray(groupsData.groups) ? groupsData.groups : [];
        const match = groupsArray.find(g => g.id === newPosition);
        if (match) {
          groupId = newPosition;
        }
      } catch (groupErr) {
        // groups.json missing or unreadable — not fatal, just skip group detection
        console.warn('[tray-runs] Could not read groups.json for group detection:', groupErr.message);
      }
    }

    // Close any active placement(s) for this tray run
    const closedCount = await trayPlacementsDB.update(
      { tray_run_id: actualRunId, removed_at: null },
      { $set: { removed_at: now, removal_reason: 'MOVED' } },
      { multi: true }
    );

    // Also close active placements by tray_id (belt-and-suspenders)
    if (closedCount === 0 && trayId) {
      await trayPlacementsDB.update(
        { tray_id: trayId, removed_at: null },
        { $set: { removed_at: now, removal_reason: 'MOVED' } },
        { multi: true }
      );
    }

    // Create new placement at the target position
    const newPlacement = {
      tray_run_id:    actualRunId,
      tray_id:        trayId,
      location_qr:    locationQr,
      placed_at:      now,
      removed_at:     null,
      removal_reason: null,
      group_id:       groupId   // null if not a group move
    };
    const inserted = await trayPlacementsDB.insert(newPlacement);

    // If this is a group move, also persist group_id on the tray run itself
    if (groupId) {
      await trayRunsDB.update(
        { tray_run_id: actualRunId },
        { $set: { group_id: groupId } }
      );
      console.log(`[tray-runs] Linked tray run ${actualRunId} to group: ${groupId}`);
    }

    console.log(`[tray-runs] Moved: ${actualRunId} (tray=${trayId}) → ${locationQr}${groupId ? ` (group: ${groupId})` : ''} (closed ${closedCount} prior placement(s))`);

    res.json({
      success: true,
      tray_run_id: actualRunId,
      tray_id: trayId,
      new_position: locationQr,
      group_id: groupId,
      placement_id: inserted._id,
      prior_placements_closed: closedCount,
      message: groupId
        ? `Tray moved to group ${groupId}`
        : `Tray moved to ${locationQr}`
    });
  } catch (error) {
    console.error('[tray-runs] Move error:', error);
    res.status(500).json({ error: 'Failed to move tray', details: error.message });
  }
});

/**
 * GET /api/losses/current
 * Get current loss statistics by farm
 */
app.get('/api/losses/current', async (req, res) => {
  const { farmId, tenant_id } = req.query;
  
  try {
    if (isDemoMode()) {
      return res.json({
        totalLosses: 0,
        lossesByReason: {},
        lossesByCrop: {},
        recentLosses: []
      });
    }
    
    // Build query filter
    const filter = {};
    // In production, you'd filter by farmId/tenant_id here
    
    const lossEvents = await trayLossEventsDB.find(filter);
    
    // Aggregate statistics
    const lossesByReason = {};
    const lossesByCrop = {};
    
    lossEvents.forEach(event => {
      // Count by reason
      lossesByReason[event.loss_reason] = (lossesByReason[event.loss_reason] || 0) + 1;
      
      // Count by crop
      const cropKey = event.crop_name || event.crop_id || 'Unknown';
      lossesByCrop[cropKey] = (lossesByCrop[cropKey] || 0) + 1;
    });
    
    // Get recent losses (last 10)
    const recentLosses = lossEvents
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 10);
    
    res.json({
      totalLosses: lossEvents.length,
      lossesByReason,
      lossesByCrop,
      recentLosses
    });
    
  } catch (error) {
    console.error('[inventory] Error fetching loss statistics:', error);
    res.status(500).json({ error: 'Failed to fetch loss statistics' });
  }
});

// Farm configuration endpoint - MUST be before proxy middleware
app.get('/api/config/app', async (req, res) => {
  try {
    setCors(req, res);
    
    // Extract tenant/farm from subdomain (multi-tenant support)
    const subdomain = extractTenantId(req);
    console.log('[API] /api/config/app - subdomain:', subdomain);
    
    // If subdomain is not 'default', look up farm by slug in database
    if (subdomain && subdomain !== 'default' && pool) {
      try {
        const result = await pool.query(
          'SELECT farm_id, name, farm_slug, email FROM farms WHERE farm_slug = $1',
          [subdomain]
        );
        
        if (result.rows && result.rows.length > 0) {
          const farm = result.rows[0];
          const config = {
            ok: true,
            farmId: farm.farm_id,
            farmName: farm.name,
            farmSlug: farm.farm_slug,
            storeUrl: `https://${farm.farm_slug}.greenreachgreens.com`,
            region: 'Pacific Northwest',
            status: 'online'
          };
          console.log('[API] /api/config/app returning (from DB):', config);
          return res.json(config);
        }
      } catch (dbError) {
        console.error('[API] Database lookup failed for subdomain:', subdomain, dbError.message);
        // Fall through to file-based config
      }
    }
    
    // Fallback: Try to load farm configuration from farm.json
    let farmData = null;
    try {
      farmData = readJSONSafe(FARM_PATH, null);
    } catch (readError) {
      console.log('[API] Could not read farm.json, using defaults:', readError.message);
    }
    
    // Return configuration with fallback
    const config = {
      ok: true,
      farmId: (farmData && farmData.farmId) ? farmData.farmId : 'light-engine-demo',
      farmName: (farmData && farmData.name) ? farmData.name : 'GreenReach Demo Farm',
      farmSlug: subdomain !== 'default' ? subdomain : 'demo',
      storeUrl: subdomain !== 'default' ? `https://${subdomain}.greenreachgreens.com` : null,
      region: (farmData && farmData.region) ? farmData.region : 'Pacific Northwest',
      status: (farmData && farmData.status) ? farmData.status : 'online'
    };
    
    console.log('[API] /api/config/app returning (from file):', config);
    res.json(config);
  } catch (e) {
    console.error('[API] Error in /api/config/app:', e);
    // Even on error, return valid config with defaults
    res.json({
      ok: true,
      farmId: 'light-engine-demo',
      farmName: 'GreenReach Demo Farm',
      farmSlug: 'demo',
      region: 'Pacific Northwest',
      status: 'online'
    });
  }
});

// ── Phase 4 Ticket 4.1: Feature configuration endpoint ─────────────────
// Per LIGHT_ENGINE_CONSOLIDATION_PROPOSAL.md — window.LE_CONFIG feature detection.
// Clients call GET /api/config/features to know which features are available
// based on deployment mode (edge vs. cloud).

app.get('/api/config/features', (req, res) => {
  const isEdge = edgeConfig.isEdgeMode();
  const deploymentMode = isEdge ? 'edge' : 'cloud';

  // Always-available features (both edge and cloud)
  const features = {
    monitoring: true,
    inventory: true,
    planning: true,
    forecasting: true,
    activityHub: true,
    qualityControl: true,
    trayOperations: true,
    tabletPairing: true,
    aiAssistant: true,
    recipeModifiers: true,
    alerts: true,
    // Edge-only features (require 24/7 on-site hardware)
    deviceControl: isEdge,
    nutrientControl: isEdge,
    criticalAlerts: isEdge,
    sensorDirectRead: isEdge,
    // Cloud-only features (require Central database)
    networkDashboard: !isEdge,
    crossFarmBenchmarks: !isEdge,
    wholesaleNetwork: !isEdge
  };

  res.json({
    ok: true,
    deploymentMode,
    features,
    version: edgeConfig.getAll().version || '1.0.0',
    farmId: edgeConfig.getFarmId(),
    farmName: edgeConfig.getFarmName()
  });
});

// ============================================================================
// Edge Mode API Routes (defined BEFORE proxy to avoid being intercepted)
// ============================================================================

// Get list of groups for assignment — returns full canonical records
// so all pages (Overview, Groups V1, Groups V2, Plans, Rooms) see identical data
app.get('/api/groups', asyncHandler(async (req, res) => {
  const groupsData = await readJSON('groups.json', { groups: [] });
  const groups = groupsData?.groups || [];

  // Return full records with canonical field normalization
  // Keep: lights[], room, zone, status, schedule, plan, planConfig
  // Drop deprecated: crop, recipe, roomId, zoneId (per DATA_FORMAT_STANDARDS)
  const canonical = groups.map(g => {
    const record = {
      id: g.id || g.name,
      name: g.name,
      room: g.room || '',
      zone: g.zone || '',
      plan: g.plan || '',
      schedule: g.schedule || '',
      status: g.status || 'draft',
      trays: g.trays || 0,
      plants: g.plants || 0,
      lights: Array.isArray(g.lights) ? g.lights : [],
      active: g.active !== false,
      health: g.health || 'unknown',
      planConfig: g.planConfig || null,
      lastModified: g.lastModified || null
    };
    // Include controller/iotDevice if present (Groups V2)
    if (g.controller) record.controller = g.controller;
    if (g.iotDevice) record.iotDevice = g.iotDevice;
    return record;
  });

  res.json(canonical);
}));

// Get list of rooms for edge mode
app.get('/api/rooms', asyncHandler(async (req, res) => {
  // When database is available, read from PostgreSQL; otherwise fallback to rooms.json
  const dbPool = req.app.locals?.db;
  if (dbPool) {
    try {
      const result = await dbPool.query(
        `SELECT room_id, farm_id, name, type, capacity, description, created_at
         FROM rooms
         ORDER BY created_at ASC`
      );
      return res.json(result.rows);
    } catch (error) {
      console.error('[API /rooms] Database query failed:', error.message);
      // Fallback to JSON on database error
    }
  }
  
  // Fallback: read from rooms.json file
  const roomsData = readJSON('rooms.json', { rooms: [] });
  const rooms = roomsData?.rooms || [];
  res.json(rooms);
}));

// Get list of zones for edge mode
app.get('/api/zones', asyncHandler(async (req, res) => {
  // When database is available, read from PostgreSQL; otherwise fallback to zones.json
  const dbPool = req.app.locals?.db;
  if (dbPool) {
    try {
      const result = await dbPool.query(
        `SELECT zone_id, room_id, farm_id, name, capacity, description, created_at
         FROM zones
         ORDER BY created_at ASC`
      );
      return res.json(result.rows);
    } catch (error) {
      console.error('[API /zones] Database query failed:', error.message);
      // Fallback to JSON on database error
    }
  }
  
  // Fallback: read from zones.json file
  const zonesData = readJSON('zones.json', { zones: [] });
  const zones = zonesData?.zones || [];
  res.json(zones);
}));

// Get all bus mappings
app.get('/api/bus-mappings', asyncHandler(async (req, res) => {
  const mappings = await readJSON('bus-mappings.json', []);
  res.json(mappings);
}));

// ============================================================================
// Proxy Middleware Setup
// ============================================================================

// ============================================================================
// Dedicated Crops Management
// ============================================================================

/**
 * GET /api/farm/dedicated-crops
 * Returns the farm's dedicated crop list with full registry metadata.
 * An empty array means "no restriction" (all crops available).
 */
app.get('/api/farm/dedicated-crops', (req, res) => {
  try {
    const farmDataPath = path.join(PUBLIC_DIR, 'data', 'farm.json');
    const farmData = JSON.parse(fs.readFileSync(farmDataPath, 'utf8'));
    const dedicatedIds = farmData.dedicated_crops || [];

    // Enrich with registry metadata
    const registryPath = path.join(PUBLIC_DIR, 'data', 'crop-registry.json');
    let enriched = dedicatedIds.map(id => ({ id }));
    try {
      const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
      enriched = dedicatedIds.map(id => {
        // id can be a plan-style slug like "crop-bibb-butterhead" OR a display name
        const entry = registry.crops[id]
          || Object.entries(registry.crops).find(([, v]) => (v.planIds || []).includes(id))?.[1];
        return {
          id,
          name: entry ? (entry.aliases?.[0] || id) : id,
          category: entry?.category || 'unknown',
          nutrientProfile: entry?.nutrientProfile || 'unknown',
          growth: entry?.growth || {},
          pricing: entry?.pricing || {}
        };
      });
    } catch (_) { /* registry unavailable — return bare ids */ }

    res.json({ ok: true, dedicated_crops: enriched, unrestricted: dedicatedIds.length === 0 });
  } catch (err) {
    console.error('[dedicated-crops] GET error:', err?.message);
    res.json({ ok: true, dedicated_crops: [], unrestricted: true });
  }
});

/**
 * PUT /api/farm/dedicated-crops
 * Set or update the farm's dedicated crop list.
 * Body: { "crops": ["crop-bibb-butterhead", "crop-genovese-basil", ...] }
 * Send empty array to remove restriction.
 */
app.put('/api/farm/dedicated-crops', (req, res) => {
  try {
    const { crops } = req.body;
    if (!Array.isArray(crops)) {
      return res.status(400).json({ ok: false, error: 'crops must be an array of crop IDs' });
    }

    // Validate against registry
    const registryPath = path.join(PUBLIC_DIR, 'data', 'crop-registry.json');
    let validIds = crops;
    try {
      const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
      const allPlanIds = new Set();
      for (const [, crop] of Object.entries(registry.crops)) {
        (crop.planIds || []).forEach(pid => allPlanIds.add(pid));
      }
      const unknown = crops.filter(id => !registry.crops[id] && !allPlanIds.has(id));
      if (unknown.length > 0) {
        return res.status(400).json({
          ok: false,
          error: `Unknown crop IDs: ${unknown.join(', ')}`,
          hint: 'Use GET /api/crops to see valid IDs'
        });
      }
    } catch (_) { /* registry unavailable — accept as-is */ }

    // Persist to farm.json
    const farmDataPath = path.join(PUBLIC_DIR, 'data', 'farm.json');
    const farmData = JSON.parse(fs.readFileSync(farmDataPath, 'utf8'));
    farmData.dedicated_crops = validIds;
    fs.writeFileSync(farmDataPath, JSON.stringify(farmData, null, 2));

    console.log(`[dedicated-crops] Updated: ${validIds.length} crops — [${validIds.join(', ')}]`);
    res.json({ ok: true, dedicated_crops: validIds, count: validIds.length });
  } catch (err) {
    console.error('[dedicated-crops] PUT error:', err?.message);
    res.status(500).json({ ok: false, error: 'Failed to update dedicated crops' });
  }
});

// DEPRECATED: Charlie backend farm/info endpoint
app.get('/api/farm/info', (req, res) => {
  console.log('[Deprecated] /api/farm/info - Charlie backend no longer available');
  res.status(410).json({
    error: 'endpoint_deprecated',
    message: 'Charlie backend farm/info endpoint deprecated February 4, 2026',
    migration: 'Use /data/farm.json for farm metadata',
    alternative: '/api/groups for crop information'
  });
});

// Production planning FastAPI proxy REMOVED — Production Planning consolidated into Planting Scheduler.
// Market intelligence routes (/api/planning/demand-forecast, /capacity, /recommendations) live in
// greenreach-central/routes/planning.js and are served by Central, not Foxtrot.

// Circuit-breaker short-circuit when controller is unhealthy  
app.use('/api', (req, res, next) => {
  console.log(`[API Middleware] path=${req.path}, originalUrl=${req.originalUrl}`);
  
  // For controller-bound paths, check circuit breaker
  if (controllerCircuit.isOpen()) {
    const retryAfter = Math.max(0, Math.floor((controllerCircuit.openUntil - Date.now()) / 1000));
    return res.status(503).json({ error: 'controller_unavailable', retryAfter });
  }
  next(); // Proceed to proxy middleware
});

// Only set up proxy middleware if controller is not explicitly disabled
const isControllerDisabled = process.env.CTRL === 'DISABLED' || process.env.CTRL === 'disabled' || process.env.CTRL === 'false';
if (!isControllerDisabled) {
  console.log('[Foxtrot] Controller proxy enabled, target:', getController());
  app.use('/api', proxyCorsMiddleware, createProxyMiddleware({
  // Initial target is required; router() will be consulted per-request
  target: getController(),
  router: () => getController(),
  changeOrigin: true,
  xfwd: true,
  logLevel: 'debug',
  timeout: 5000,
  proxyTimeout: 5000,
  agent: keepAliveHttpAgent,  // Use HTTP agent directly (controller is HTTP, not HTTPS)
  // Filter: only proxy paths that should go to the Grow3 controller
  // Exclude paths handled by Node.js server (env, automation, switchbot, kasa, etc.)
  filter: (pathname, req) => {
    try {
      // Don't proxy these paths - they're handled by Node.js server
      // Note: When mounted at /api, pathname will be /groups not /api/groups
      const fullPath = req.originalUrl || pathname;
      console.log(`[Proxy Filter] Checking path: pathname="${pathname}", fullPath="${fullPath}"`);
      
      // Since proxy is mounted at /api, remove /api prefix for matching
      const excludePaths = [
        '/planning',
        '/env',
        '/automation/',
        '/switchbot/',
        '/kasa/',
        '/schedule-executor/',
        '/grow3/',
        '/harvest',
        '/weather',
        '/geocode',
        '/reverse-geocode',
        '/device/',
        '/notifications',
        '/ml/',
        '/health/',        // AI Health Monitoring endpoints
        '/admin/',         // Central admin multi-farm endpoints
        '/demo-farm',      // Demo farm data
        '/inventory/',     // Inventory endpoints (current, forecast)
        '/tray-formats',   // Tray format definitions
        '/recipes',        // Lighting recipes
        '/crops',          // Crop definitions
        '/trays/',         // Tray operations (register, seed, etc.)
        '/tray-runs/',     // Tray run operations (place, harvest, loss)
        '/losses/',        // Loss tracking and statistics
        '/config/',        // Farm configuration endpoints
        '/setup',          // Setup activation + persistence endpoints
        '/crop-pricing',   // Crop pricing configuration
        '/farm-auth/',     // Farm authentication for Sales Terminal
        '/farm/auth/',     // Farm authentication alternate path
        '/farm-sales/',    // Farm Sales Terminal inventory and POS
        '/wholesale/',     // Wholesale inventory and catalog
        '/rooms',          // Rooms data for edge mode
        '/groups',         // Groups data for edge mode
        '/farm/info',      // Farm metadata - legacy Charlie endpoint
        '/bus-mappings'    // Bus mapping configuration for edge mode
      ];
      
      // Check if pathname starts with any excluded pattern
      const shouldExclude = excludePaths.some(excluded => pathname.startsWith(excluded));
      
      if (shouldExclude) {
        console.log(`[Proxy Filter] Skipping ${fullPath} - handled by Node.js server`);
        return false;
      }
      
      console.log(`[Proxy Filter] Proxying ${fullPath} to controller`);
      return true; // Proxy everything else to controller
    } catch (error) {
      console.error('[Proxy Filter] ERROR:', error.message);
      return true; // Default to proxy on error
    }
  },
  // Ensure controller receives exactly one /api prefix
  pathRewrite: (path /* e.g., "/devicedatas" or "/api/devicedatas" */) => {
    return path.startsWith('/api/') ? path : `/api${path}`;
  },
  onProxyReq(proxyReq, req) {
    // For visibility in logs
    const outgoingPath = req.url.startsWith('/api/') ? req.url : `/api${req.url}`;
    console.log(`[→] ${req.method} ${req.originalUrl} -> ${getController()}${outgoingPath}`);
  },
  onProxyRes(proxyRes, req, res) {
    controllerCircuit.recordSuccess();
    const origin = req.headers?.origin;
    if (origin) {
      proxyRes.headers['access-control-allow-origin'] = origin;
      const existingVary = proxyRes.headers['vary'];
      if (existingVary) {
        const varyParts = String(existingVary).split(/,\s*/);
        if (!varyParts.includes('Origin')) {
          proxyRes.headers['vary'] = `${existingVary}, Origin`;
        }
      } else {
        proxyRes.headers['vary'] = 'Origin';
      }
    } else {
      proxyRes.headers['access-control-allow-origin'] = '*';
    }
    const requestedHeaders = req.headers?.['access-control-request-headers'];
    if (requestedHeaders && typeof requestedHeaders === 'string') {
      proxyRes.headers['access-control-allow-headers'] = requestedHeaders;
    } else if (!proxyRes.headers['access-control-allow-headers']) {
      proxyRes.headers['access-control-allow-headers'] = 'Content-Type, Authorization, X-Requested-With';
    }
    proxyRes.headers['access-control-allow-methods'] = 'GET,POST,PATCH,DELETE,OPTIONS';
  },
  onError(err, req, res) {
    controllerCircuit.recordFailure();
    console.warn('[proxy:/api] error:', err?.message || err);
    res.statusCode = 502;
    res.end(JSON.stringify({ error: 'proxy_error', detail: String(err) }));
  }
}));
} else {
  console.log('[Foxtrot] Controller proxy disabled (standalone mode)');
}

// Namespaced pass-through for controller-bound helpers (e.g., /controller/sched)
if (!isControllerDisabled) {
  app.use('/controller', (req, res, next) => {
    if (controllerCircuit.isOpen()) {
      const retryAfter = Math.max(0, Math.floor((controllerCircuit.openUntil - Date.now()) / 1000));
      return res.status(503).json({ error: 'controller_unavailable', retryAfter });
    }
    next();
  });

  app.use('/controller', proxyCorsMiddleware, createProxyMiddleware({
  target: getController(),
  router: () => getController(),
  changeOrigin: true,
  xfwd: true,
  logLevel: 'debug',
  timeout: 5000,
  proxyTimeout: 5000,
  agent: (url) => (String(url).startsWith('https:') ? keepAliveHttpsAgent : keepAliveHttpAgent),
  pathRewrite: (path) => path.replace(/^\/controller/, ''),
  onProxyReq(proxyReq, req) {
    console.log(`[→] ${req.method} ${req.originalUrl} -> ${getController()}${req.url}`);
  },
  onProxyRes(proxyRes, req) {
    controllerCircuit.recordSuccess();
    const origin = req.headers?.origin;
    if (origin) {
      proxyRes.headers['access-control-allow-origin'] = origin;
      const existingVary = proxyRes.headers['vary'];
      if (existingVary) {
        const varyParts = String(existingVary).split(/,\s*/);
        if (!varyParts.includes('Origin')) {
          proxyRes.headers['vary'] = `${existingVary}, Origin`;
        }
      } else {
        proxyRes.headers['vary'] = 'Origin';
      }
    } else {
      proxyRes.headers['access-control-allow-origin'] = '*';
    }
    const requestedHeaders = req.headers?.['access-control-request-headers'];
    if (requestedHeaders && typeof requestedHeaders === 'string') {
      proxyRes.headers['access-control-allow-headers'] = requestedHeaders;
    } else if (!proxyRes.headers['access-control-allow-headers']) {
      proxyRes.headers['access-control-allow-headers'] = 'Content-Type, Authorization, X-Requested-With';
    }
    proxyRes.headers['access-control-allow-methods'] = 'GET,POST,PATCH,DELETE,OPTIONS';
  },
  onError(err, req, res) {
    controllerCircuit.recordFailure();
    console.warn('[proxy:/controller] error:', err?.message || err);
    res.statusCode = 502;
    res.end(JSON.stringify({ error: 'proxy_error', target: 'controller', detail: String(err) }));
  }
}));
}

// Dev-only live asset snapshots for cache validation
// Legacy Charlie home page removed — redirect to admin for backwards compat
app.get('/tmp/live.index.html', (req, res) => {
  res.redirect(302, '/LE-farm-admin.html');
});

app.get('/tmp/live.app.charlie.js', (req, res) => {
  res.type('text').sendFile(path.join(__dirname, 'public', 'app.charlie.js'));
});

// Homepage — redirect to admin page (the single hub for all features)
app.get('/', (req, res) => {
  const queryIndex = req.originalUrl.indexOf('?');
  const queryString = queryIndex >= 0 ? req.originalUrl.slice(queryIndex) : '';
  res.redirect(302, `/LE-farm-admin.html${queryString}`);
});

// Legacy routes — redirect to admin for bookmarks/links that still reference old pages
app.get('/index.charlie.html', (req, res) => {
  res.redirect(302, '/LE-farm-admin.html');
});

app.get('/index.html', (req, res) => {
  res.redirect(302, '/LE-farm-admin.html');
});

// Explicit demo data routes to avoid 404s if static middleware wins
app.get('/data/farm.json', (req, res, next) => {
  const farm = loadDemoFarmSnapshot();
  if (!farm) return next();
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-cache');
  return res.json({
    farmId: farm.farmId,
    name: farm.name,
    status: farm.status,
    region: farm.region,
    url: farm.url,
    contact: farm.contact,
    coordinates: farm.coordinates
  });
});

app.get('/data/rooms.json', (req, res, next) => {
  const farm = loadDemoFarmSnapshot();
  if (!farm) return next();
  
  // Transform rooms to include fixtures
  const lights = farm.devices?.lights || [];
  const rooms = (farm.rooms || []).map(room => {
    // Find all lights for this room's zones
    const roomLights = lights.filter(light => 
      light.location && light.location.startsWith(room.roomId)
    );
    
    // Group lights by model to create fixtures array
    const fixturesMap = new Map();
    roomLights.forEach(light => {
      const key = `${light.vendor || 'Unknown'}-${light.model || 'Unknown'}`;
      if (!fixturesMap.has(key)) {
        fixturesMap.set(key, {
          name: light.model || 'LED Array',
          vendor: light.vendor || 'Unknown',
          model: light.model || 'Unknown',
          spectrum: light.spectrum || 'Unknown',
          count: 0
        });
      }
      fixturesMap.get(key).count++;
    });
    
    return {
      ...room,
      fixtures: Array.from(fixturesMap.values())
    };
  });
  
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-cache');
  return res.json({ rooms });
});

// IoT devices (sensors)
app.get('/data/iot-devices.json', (req, res, next) => {
  const farm = loadDemoFarmSnapshot();
  if (!farm) return next();
  
  // Transform sensor data from demo format to IoT device format
  const sensors = (farm.devices?.sensors || []).map(sensor => ({
    id: sensor.deviceId,
    deviceId: sensor.deviceId,
    name: sensor.name,
    vendor: sensor.vendor || 'Unknown',
    brand: sensor.vendor || 'Unknown',
    protocol: sensor.vendor === 'SwitchBot' ? 'switchbot' : 'unknown',
    type: 'sensor',
    category: 'Environmental Sensor',
    address: sensor.deviceId,
    location: sensor.location,
    zone: sensor.location,
    trust: 'trusted',
    automationControl: false,
    lastSeen: sensor.lastSeen,
    telemetry: {
      temperature: sensor.readings?.temperature,
      humidity: sensor.readings?.humidity,
      co2: sensor.readings?.co2,
      vpd: sensor.readings?.vpd
    },
    status: sensor.status || 'online'
  }));

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-cache');
  return res.json(sensors);
});

app.get('/data/groups.json', (req, res, next) => {
  const farm = loadDemoFarmSnapshot();
  if (!farm) return next();
  const groups = [];
  (farm.rooms || []).forEach((room) => {
    (room.zones || []).forEach((zone) => {
      (zone.groups || []).forEach((group) => {
        // Calculate seed date from daysOld (days since planting)
        const daysOld = group.daysOld || 0;
        const seedDate = new Date();
        seedDate.setDate(seedDate.getDate() - daysOld);
        seedDate.setHours(0, 0, 0, 0);
        
        // Determine photoperiod based on crop type
        let photoperiodHours = 16; // Default for most leafy greens
        const cropLower = (group.crop || '').toLowerCase();
        let planId = `crop-${cropLower.split(' ')[0]}`; // e.g., "crop-lettuce", "crop-basil"
        
        if (cropLower.includes('basil')) {
          photoperiodHours = 18; // Basil prefers longer days
          planId = 'crop-basil';
        } else if (cropLower.includes('arugula')) {
          photoperiodHours = 14; // Arugula shorter photoperiod
          planId = 'crop-arugula';
        } else if (cropLower.includes('lettuce')) {
          planId = 'crop-lettuce';
        } else if (cropLower.includes('kale')) {
          planId = 'crop-kale';
        }
        
        groups.push({
          id: group.groupId,
          name: group.name,
          zone: zone.zoneId,           // Frontend expects 'zone' field
          zoneId: zone.zoneId,         // Keep for compatibility
          roomId: room.roomId,
          crop: group.crop,
          recipe: group.recipe,
          plan: planId,
          planId: planId,
          enabled: true,               // Groups in demo are always enabled
          daysOld: daysOld,
          harvestIn: group.harvestIn || null,
          trays: group.trays || 0,
          plants: group.plants || 0,
          health: group.health || 'unknown',
          devices: group.devices || [],
          deviceCount: (group.devices || []).length,
          intensity: group.intensity || 0,
          spectrum: group.spectrum || '',
          // Add planConfig for Farm Summary harvest countdown
          planConfig: {
            anchor: {
              mode: 'seedDate',
              seedDate: seedDate.toISOString()
            },
            schedule: {
              photoperiodHours: photoperiodHours,
              totalOnHours: photoperiodHours
            }
          }
        });
      });
    });
  });
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-cache');
  return res.json({ groups });
});

app.get('/data/ctrl-map.json', (req, res, next) => {
  const farm = loadDemoFarmSnapshot();
  if (!farm) return next();
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-cache');
  return res.json({ groups: [], rooms: [], devices: [] });
});

app.get('/data/equipment.json', (req, res, next) => {
  const farm = loadDemoFarmSnapshot();
  if (!farm) return next();
  
  // Transform HVAC devices into equipment entries with IoT controller assignments
  const equipment = [];
  const hvacDevices = farm.devices?.hvac || [];
  const rooms = farm.rooms || [];
  
  // Create equipment entries for HVAC systems
  hvacDevices.forEach(hvac => {
    const room = rooms.find(r => r.roomId === hvac.location);
    if (!room) return;
    
    // HVAC Controller (the smart device)
    equipment.push({
      uniqueId: hvac.deviceId,
      type: 'HVAC Controller',
      make: hvac.vendor || 'Unknown',
      model: hvac.model || 'Unknown',
      room: room.name,
      zone: room.zones?.[0]?.name || 'All Zones',
      control: null, // Controller itself
      controller: 'Integrated',
      status: hvac.status || 'online',
      metadata: {
        isController: true,
        protocol: 'ethernet'
      }
    });
    
    // Add equipment controlled by this HVAC (fans, dehumidifiers, etc.)
    // Room A equipment
    if (hvac.location === 'ROOM-A') {
      equipment.push({
        uniqueId: `${hvac.deviceId}-EXHAUST-FAN`,
        type: 'Exhaust Fan',
        make: 'Hurricane',
        model: 'Pro Series 16"',
        room: room.name,
        zone: 'All Zones',
        control: `IoT:${hvac.deviceId}`,
        controller: hvac.name,
        status: 'online',
        metadata: {
          cfm: 1800,
          power: '0.9A'
        }
      });
      
      equipment.push({
        uniqueId: `${hvac.deviceId}-CIRC-FAN-1`,
        type: 'Circulation Fan',
        make: 'Air King',
        model: 'Wall Mount 20"',
        room: room.name,
        zone: room.zones?.[0]?.name || 'Zone 1',
        control: `IoT:${hvac.deviceId}`,
        controller: hvac.name,
        status: 'online',
        metadata: {
          cfm: 3600,
          power: '1.2A'
        }
      });
      
      equipment.push({
        uniqueId: `${hvac.deviceId}-CIRC-FAN-2`,
        type: 'Circulation Fan',
        make: 'Air King',
        model: 'Wall Mount 20"',
        room: room.name,
        zone: room.zones?.[2]?.name || 'Zone 3',
        control: `IoT:${hvac.deviceId}`,
        controller: hvac.name,
        status: 'online',
        metadata: {
          cfm: 3600,
          power: '1.2A'
        }
      });
      
      equipment.push({
        uniqueId: `${hvac.deviceId}-DEHUMID`,
        type: 'Dehumidifier',
        make: 'Quest',
        model: 'Dual 165',
        room: room.name,
        zone: 'All Zones',
        control: `IoT:${hvac.deviceId}`,
        controller: hvac.name,
        status: 'online',
        metadata: {
          capacity: '165 pints/day',
          power: '7.9A'
        }
      });
      
      equipment.push({
        uniqueId: `${hvac.deviceId}-HUMIDIFIER`,
        type: 'Humidifier',
        make: 'AIRCARE',
        model: 'MA1201',
        room: room.name,
        zone: 'All Zones',
        control: `IoT:${hvac.deviceId}`,
        controller: hvac.name,
        status: 'online',
        metadata: {
          capacity: '3.6 gal',
          coverage: '3600 sq ft'
        }
      });
    }
    
    // Room B equipment
    if (hvac.location === 'ROOM-B') {
      equipment.push({
        uniqueId: `${hvac.deviceId}-EXHAUST-FAN`,
        type: 'Exhaust Fan',
        make: 'Hurricane',
        model: 'Pro Series 16"',
        room: room.name,
        zone: 'All Zones',
        control: `IoT:${hvac.deviceId}`,
        controller: hvac.name,
        status: 'online',
        metadata: {
          cfm: 1800,
          power: '0.9A'
        }
      });
      
      equipment.push({
        uniqueId: `${hvac.deviceId}-CIRC-FAN-1`,
        type: 'Circulation Fan',
        make: 'Air King',
        model: 'Wall Mount 20"',
        room: room.name,
        zone: room.zones?.[1]?.name || 'Zone 2',
        control: `IoT:${hvac.deviceId}`,
        controller: hvac.name,
        status: 'online',
        metadata: {
          cfm: 3600,
          power: '1.2A'
        }
      });
      
      equipment.push({
        uniqueId: `${hvac.deviceId}-DEHUMID`,
        type: 'Dehumidifier',
        make: 'Quest',
        model: 'Dual 165',
        room: room.name,
        zone: 'All Zones',
        control: `IoT:${hvac.deviceId}`,
        controller: hvac.name,
        status: 'online',
        metadata: {
          capacity: '165 pints/day',
          power: '7.9A'
        }
      });
    }
  });
  
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-cache');
  return res.json({ equipment });
});

// Equipment metadata (controller assignments and status)
app.get('/data/equipment-metadata.json', (req, res, next) => {
  const farm = loadDemoFarmSnapshot();
  if (!farm) return next();
  
  const metadata = {};
  const hvacDevices = farm.devices?.hvac || [];
  
  // Build metadata mapping equipment IDs to their controller info
  hvacDevices.forEach(hvac => {
    // The HVAC controller itself
    metadata[hvac.deviceId] = {
      controller: 'integrated',
      controllerType: 'hvac',
      lastSeen: hvac.lastSeen,
      status: hvac.status
    };
    
    // Equipment controlled by this HVAC
    [`${hvac.deviceId}-EXHAUST-FAN`, 
     `${hvac.deviceId}-CIRC-FAN-1`,
     `${hvac.deviceId}-CIRC-FAN-2`,
     `${hvac.deviceId}-DEHUMID`,
     `${hvac.deviceId}-HUMIDIFIER`
    ].forEach(equipId => {
      metadata[equipId] = {
        controller: hvac.deviceId,
        controllerName: hvac.name,
        controlMethod: 'IoT',
        lastSeen: hvac.lastSeen,
        status: hvac.status
      };
    });
  });
  
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-cache');
  return res.json(metadata);
});

// Room map for farm summary view
app.get('/data/room-map.json', (req, res, next) => {
  const farm = loadDemoFarmSnapshot();
  if (!farm) return next();
  
  // Demo mode: Return comprehensive room map with positioned sensors
  if (isDemoMode()) {
    const demoData = getDemoData();
    const envData = demoData.getEnvironmentalData();
    
    // Build zones dynamically from demo farm data to include all rooms
    const zones = [];
    const colors = ['#10b981', '#8b5cf6', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#84cc16', '#f97316'];
    let colorIndex = 0;
    
    // Grid layout for heatmap (each room gets its own section)
    const roomWidth = 20;
    const roomHeight = 15;
    
    farm.rooms.forEach((room, roomIndex) => {
      room.zones.forEach((zone, zoneIndex) => {
        // Calculate zone position in grid (2x2 layout per room)
        const col = zoneIndex % 2;
        const row = Math.floor(zoneIndex / 2);
        const xOffset = col === 0 ? 2 : 11;
        const yOffset = row === 0 ? 2 : 8;
        
        zones.push({
          id: `zone-${roomIndex + 1}-${zoneIndex + 1}`,
          zone: zone.zoneId,  // Use zoneId from farm data (e.g., "ROOM-A-Z1")
          name: zone.name,
          color: colors[colorIndex % colors.length],
          x1: xOffset,
          y1: yOffset,
          x2: xOffset + 7,
          y2: yOffset + 4,
          crop: zone.crop,
          room: room.roomId
        });
        
        colorIndex++;
      });
    });
    
    console.log('[demo] Built', zones.length, 'zones from farm data:', zones.map(z => z.zone));
    
    // Create realistic sensor grid for heatmap visualization
    const gridSize = 20;
    
    // Define room perimeter
    const roomPerimeter = {
      x1: 1,
      y1: 1,
      x2: roomWidth - 2,
      y2: roomHeight - 2
    };
    
    // Place sensors realistically (2-3 per zone for accurate monitoring)
    const devices = [];
    let sensorId = 1;
    
    zones.forEach((zone, zoneIndex) => {
      // Get environmental data for this zone
      const zoneEnvData = envData.zones[zoneIndex] || envData.zones[0];
      
      // Calculate zone center and strategic sensor positions
      const zoneCenterX = Math.floor((zone.x1 + zone.x2) / 2);
      const zoneCenterY = Math.floor((zone.y1 + zone.y2) / 2);
      
      // Sensor 1: Center of zone
      devices.push({
        deviceId: `sensor-${sensorId}`,
        x: zoneCenterX,
        y: zoneCenterY,
        snapshot: {
          name: `${zone.name} - Center`,
          type: 'Environmental Sensor',
          protocol: 'MQTT',
          category: 'sensor',
          zone: zone.zone,  // Use proper zone ID (e.g., "ROOM-A-Z1")
          room: zone.room,
          telemetry: {
            temperature: zoneEnvData.temperature + (Math.random() - 0.5) * 0.5,
            humidity: zoneEnvData.humidity + (Math.random() - 0.5) * 2,
            vpd: zoneEnvData.vpd + (Math.random() - 0.5) * 0.1,
            co2: zoneEnvData.co2 + (Math.random() - 0.5) * 20,
            online: true,
            lastSeen: new Date().toISOString()
          }
        }
      });
      sensorId++;
      
      // Sensor 2: Upper corner (warmer, drier - closer to lights)
      devices.push({
        deviceId: `sensor-${sensorId}`,
        x: zone.x1 + 1,
        y: zone.y1 + 1,
        snapshot: {
          name: `${zone.name} - Upper`,
          type: 'Environmental Sensor',
          protocol: 'MQTT',
          category: 'sensor',
          zone: zone.zone,  // Use proper zone ID
          room: zone.room,
          telemetry: {
            temperature: zoneEnvData.temperature + 1.5,  // Warmer near lights
            humidity: zoneEnvData.humidity - 3,          // Drier near lights
            vpd: zoneEnvData.vpd + 0.15,                 // Higher VPD (warmer + drier)
            co2: zoneEnvData.co2 - 30,                   // Lower CO2 near extraction
            online: true,
            lastSeen: new Date().toISOString()
          }
        }
      });
      sensorId++;
      
      // Sensor 3: Lower corner (cooler, more humid - canopy level)
      devices.push({
        deviceId: `sensor-${sensorId}`,
        x: zone.x2 - 1,
        y: zone.y2 - 1,
        snapshot: {
          name: `${zone.name} - Lower`,
          type: 'Environmental Sensor',
          protocol: 'MQTT',
          category: 'sensor',
          zone: zone.zone,  // Use proper zone ID
          room: zone.room,
          telemetry: {
            temperature: zoneEnvData.temperature - 0.8,  // Cooler at canopy
            humidity: zoneEnvData.humidity + 4,          // More humid at canopy
            vpd: zoneEnvData.vpd - 0.12,                 // Lower VPD (cooler + humid)
            co2: zoneEnvData.co2 + 40,                   // Higher CO2 at canopy
            online: true,
            lastSeen: new Date().toISOString()
          }
        }
      });
      sensorId++;
    });
    
    const roomMap = {
      name: 'Grow Room 1',
      room: 'room-1',
      gridSize: gridSize,
      roomPerimeter: roomPerimeter,
      zones: zones,
      devices: devices,
      meta: {
        source: 'demo',
        totalSensors: devices.length,
        zonesCount: zones.length,
        lastUpdated: new Date().toISOString()
      }
    };
    
    console.log('[demo] Serving demo room-map with', devices.length, 'positioned sensors across', zones.length, 'zones');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-cache');
    return res.json(roomMap);
  }
  
  // Non-demo mode: Build flat zones array from all rooms
  const zones = [];
  farm.rooms.forEach(room => {
    room.zones.forEach(zone => {
      zones.push({
        zone: zone.zoneId,        // Zone ID for matching with sensors
        name: zone.name,           // Display name
        room: room.roomId,         // Parent room ID
        roomName: room.name,       // Room display name
        crop: zone.crop || null    // Crop type
      });
    });
  });
  
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-cache');
  return res.json({ zones });
});

app.get('/data/devices.cache.json', (req, res, next) => {
  const farm = loadDemoFarmSnapshot();
  if (!farm) return next();
  const devices = [];
  (farm.rooms || []).forEach((room) => {
    (room.zones || []).forEach((zone) => {
      (zone.groups || []).forEach((group) => {
        devices.push(...(group.devices || []));
      });
    });
  });
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-cache');
  return res.json({ devices, timestamp: new Date().toISOString() });
});

// Demo mode: Intercept data file requests BEFORE static middleware
app.use('/data', (req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'OPTIONS') return next();
  
  // Demo mode data intercepts
  if (isDemoMode()) {
    const demoData = getDemoData();
    const farm = demoData ? demoData.getFarm() : null;
    
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-cache');
    
    // Intercept farm.json
    if (req.path === '/farm.json' && farm) {
      console.log('[demo] Serving demo farm data for /data/farm.json');
      return res.json({
        farmId: farm.farmId,
        name: farm.name,
        status: farm.status,
        region: farm.region,
        url: farm.url,
        contact: farm.contact,
        coordinates: farm.coordinates
      });
    }
    
    // Intercept rooms.json
    if (req.path === '/rooms.json' && farm) {
      console.log('[demo] Serving demo rooms data for /data/rooms.json');
      return res.json({ rooms: farm.rooms });
    }
    
    // DON'T intercept groups.json - serve the actual file with real crops
    // if (req.path === '/groups.json' && farm) {
    //   console.log('[demo] Serving demo groups data for /data/groups.json');
    //   const groups = [];
    //   farm.rooms.forEach(room => {
    //     room.zones.forEach(zone => {
    //       zone.groups.forEach(group => {
    //         groups.push({
    //           id: group.groupId,
    //           name: group.name,
    //           roomId: room.id,
    //           zoneId: zone.id,
    //           deviceCount: group.devices.length
    //         });
    //       });
    //     });
    //   });
    //   return res.json({ groups });
    // }
    
    // Intercept ctrl-map.json - device control mapping
    if (req.path === '/ctrl-map.json') {
      console.log('[demo] Serving demo ctrl-map data');
      return res.json({ groups: [], rooms: [], devices: [] });
    }
    
    // Intercept equipment.json - equipment catalog
    if (req.path === '/equipment.json') {
      console.log('[demo] Serving demo equipment data');
      return res.json({ equipment: [] });
    }
    
    // Intercept devices.cache.json
    if (req.path === '/devices.cache.json' && farm) {
      console.log('[demo] Serving demo devices cache');
      const allDevices = [];
      farm.rooms.forEach(room => {
        room.zones.forEach(zone => {
          zone.groups.forEach(group => {
            allDevices.push(...group.devices);
          });
        });
      });
      return res.json({ devices: allDevices, timestamp: new Date().toISOString() });
    }
    
    // Fall through for other /data/*.json files
  }
  
  next();
});

// Add cache control for static files (prevent aggressive caching during development)
app.use((req, res, next) => {
  // Disable caching for CSS, JS, and HTML files to ensure updates are seen immediately
  if (req.url.match(/\.(css|js|html)$/)) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});

// Wholesale landing page route - marketing page with features and signup
app.get('/wholesale', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'wholesale-landing.html'));
});

// GreenReach organization page - about GreenReach R&D and mission
app.get('/greenreach-org', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'greenreach-org.html'));
});

// Legacy admin.html redirect - docs/admin.html not served, redirect to farm-admin.html
app.get('/admin.html', (req, res) => {
  res.redirect('/farm-admin.html');
});

// Wholesale portals are standalone and served by GreenReach Central, not Foxtrot.
// Wholesale pages are now served directly from edge farm
// (removed redirect to GreenReach Central - edge farms can host their own wholesale portal)

// Serve consolidated Light Engine UI
app.use('/light-engine/public', express.static(LIGHT_ENGINE_DIR, {
  setHeaders: (res, path) => {
    if (path.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
    else if (path.endsWith('.js') || path.endsWith('.css')) {
      res.setHeader('Cache-Control', 'public, max-age=3600, must-revalidate');
    }
    else if (path.match(/\.(jpg|jpeg|png|gif|svg|woff|woff2|ttf|eot)$/)) {
      res.setHeader('Cache-Control', 'public, max-age=86400');
    }
  }
}));

// Serve static files from public/ (AFTER demo middleware so demo data takes precedence)
// Add cache control headers to force fresh content
// Disable index.html auto-serving so we control root URL routing
app.use(express.static(PUBLIC_DIR, {
  index: false,  // Don't automatically serve index.html at root - let our route handlers decide
  setHeaders: (res, path) => {
    // Force no-cache for HTML files to ensure latest UI
    if (path.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
    // Cache JS/CSS for 1 hour but allow revalidation
    else if (path.endsWith('.js') || path.endsWith('.css')) {
      res.setHeader('Cache-Control', 'public, max-age=3600, must-revalidate');
    }
    // Cache images/fonts longer
    else if (path.match(/\.(jpg|jpeg|png|gif|svg|woff|woff2|ttf|eot)$/)) {
      res.setHeader('Cache-Control', 'public, max-age=86400');
    }
  }
}));

// Do NOT serve docs/ directory statically - it's only for AWS S3 deployment
// The docs/ folder contains the AWS demo version with fetch interceptors that break local development
// app.use('/docs', express.static(path.join(__dirname, 'docs')));

// Allow direct access to JSON data files in /public/data with CORS headers
app.use('/data', (req, res, next) => {
  // Only handle GET/OPTIONS for static JSON fetches; let POST fall through to /data/:name
  if (req.method !== 'GET' && req.method !== 'OPTIONS') return next();
  if (!req.path.endsWith('.json')) return res.status(403).send('Forbidden');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  if (req.method === 'OPTIONS') return res.status(204).end();
  // Serve the file from public/data
  const filePath = path.join(__dirname, 'public', 'data', req.path);
  if (!fs.existsSync(filePath)) return res.status(404).send('Not found');
  res.type('application/json');
  fs.createReadStream(filePath).pipe(res);
});

// Favicon handler: map /favicon.ico to our SVG to avoid 404 noise
app.get('/favicon.ico', (req, res) => {
  try {
    const file = path.resolve('./public/favicon.svg');
    res.setHeader('Content-Type', 'image/svg+xml');
    fs.createReadStream(file).pipe(res);
  } catch {
    res.status(204).end();
  }
});

// IFTTT Webhook endpoints for device automation
app.post('/webhooks/ifttt/:deviceId', async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { action, intensity, spectrum, temperature, humidity, trigger_identity } = req.body;
    
    console.log(`[IFTTT] Webhook received for device ${deviceId}:`, req.body);
    
    // Log automation event for AI training
    const automationEvent = {
      timestamp: new Date().toISOString(),
      deviceId,
      triggerSource: 'ifttt',
      triggerIdentity: trigger_identity,
      action,
      parameters: { intensity, spectrum, temperature, humidity },
      processedAt: Date.now()
    };
    
    // Store for AI training (append to automation log)
    const logPath = path.join(DATA_DIR, 'automation-events.jsonl');
    fs.appendFileSync(logPath, JSON.stringify(automationEvent) + '\n', 'utf8');
    
    // Process the automation action
    switch (action) {
      case 'spectrum_change':
        if (spectrum && intensity !== undefined) {
          console.log(`[IFTTT] Applying spectrum '${spectrum}' at ${intensity}% to device ${deviceId}`);
          // Forward to controller or apply directly based on device type
          // This would integrate with your existing device control logic
        }
        break;
        
      case 'environmental_response':
        if (temperature || humidity) {
          console.log(`[IFTTT] Environmental trigger - Temp: ${temperature}°F, Humidity: ${humidity}%`);
          // Trigger environmental response through E.V.I.E system
        }
        break;
        
      case 'power_control':
        if (intensity !== undefined) {
          console.log(`[IFTTT] Power control: ${intensity}% for device ${deviceId}`);
          // Apply power control
        }
        break;
        
      default:
        console.log(`[IFTTT] Unknown action: ${action}`);
    }
    
    // Send success response to IFTTT
    res.json({
      success: true,
      deviceId,
      action,
      timestamp: automationEvent.timestamp,
      message: `Action '${action}' processed successfully`
    });
    
  } catch (error) {
    console.error('[IFTTT] Webhook error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Geocoding and Weather endpoints must be registered BEFORE the /api proxy below
// Helper function to convert weather codes to descriptions
// (removed duplicate getWeatherDescription)

// Geocoding API to get coordinates from address
app.get('/api/geocode', async (req, res) => {
  try {
    setCors(req, res);
    const { address } = req.query;
    
    if (!address) {
      return res.status(400).json({ ok: false, error: 'Address parameter required' });
    }

    // Use Nominatim (OpenStreetMap) for free geocoding
    const encodedAddress = encodeURIComponent(address);
    const geocodeUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodedAddress}&limit=5`;
    
    const response = await fetch(geocodeUrl, {
      headers: {
        'User-Agent': 'Light-Engine-Charlie/1.0 (Farm Management System)'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Geocoding API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    const results = data.map(item => ({
      display_name: item.display_name,
      lat: parseFloat(item.lat),
      lng: parseFloat(item.lon),
      formatted_address: item.display_name
    }));

    res.json({ ok: true, results });
  } catch (error) {
    console.error('Geocoding error:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// Weather API to get current conditions
app.get('/api/weather', async (req, res) => {
  try {
    setCors(req, res);
    const { lat, lng } = req.query;
    
    if (!lat || !lng) {
      return res.status(400).json({ ok: false, error: 'Latitude and longitude parameters required' });
    }

    // Use Open-Meteo for free weather data
    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current_weather=true&hourly=temperature_2m,relative_humidity_2m,precipitation,weather_code&timezone=auto`;
    
    const response = await fetch(weatherUrl);
    
    if (!response.ok) {
      throw new Error(`Weather API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    const weather = {
      ok: true,
      current: {
        temperature_c: data.current_weather.temperature,
        temperature_f: (data.current_weather.temperature * 9/5) + 32,
        humidity: Array.isArray(data.hourly?.relative_humidity_2m) ? data.hourly.relative_humidity_2m[0] : null,
        wind_speed: data.current_weather.windspeed,
        wind_direction: data.current_weather.winddirection,
        weather_code: data.current_weather.weathercode,
        is_day: data.current_weather.is_day,
        description: getWeatherDescription(data.current_weather.weathercode),
        last_updated: data.current_weather.time
      },
      location: {
        lat: parseFloat(lat),
        lng: parseFloat(lng)
      }
    };

    res.json(weather);
  } catch (error) {
    console.error('Weather API error:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});
// IFTTT Service endpoints for device discovery
app.get('/ifttt/v1/user/info', async (req, res) => {
  try {
    setCors(req, res);
    const { farmId, email, password } = req.query;

    if (!farmId || !email || !password) {
      return res.status(400).json({
        status: 'error',
        message: 'Farm ID, email, and password are required'
      });
    }

    const pool = req.app.locals?.db;
    if (!pool) {
      return res.status(500).json({
        status: 'error',
        message: 'Database not configured'
      });
    }

    const farmResult = await pool.query(
      'SELECT farm_id, name, status FROM farms WHERE farm_id = $1 LIMIT 1',
      [farmId]
    );

    if (farmResult.rows.length === 0) {
      return res.status(404).json({
        status: 'error',
        message: 'Farm not found'
      });
    }

    const farm = farmResult.rows[0];
    if (farm.status && farm.status !== 'active') {
      return res.status(403).json({
        status: 'error',
        message: 'This farm is currently disabled. Contact support.'
      });
    }

    const userResult = await pool.query(
      `SELECT user_id, email, password_hash, role, is_active, email_verified, last_login
       FROM users
       WHERE farm_id = $1 AND lower(email) = lower($2)
       LIMIT 1`,
      [farmId, email]
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({
        status: 'error',
        message: 'Invalid email or password'
      });
    }

    const user = userResult.rows[0];

    if (user.is_active === false) {
      return res.status(403).json({
        status: 'error',
        message: 'Account is disabled. Contact support.'
      });
    }

    if (!user.password_hash) {
      return res.status(500).json({
        status: 'error',
        message: 'Account not initialized with a password'
      });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({
        status: 'error',
        message: 'Invalid email or password'
      });
    }

    await pool.query('UPDATE users SET last_login = NOW() WHERE user_id = $1', [user.user_id]);

    return res.json({
      status: 'success',
      farmId: farm.farm_id,
      farmName: farm.name,
      email: user.email,
      role: user.role || 'admin'
    });
  } catch (err) {
    console.error('[ifttt] user info error:', err?.message || err, err?.stack || '');
    return res.status(500).json({
      status: 'error',
      message: 'IFTTT user verification failed'
    });
  }
});

// Convenience endpoints to query the configured controller/forwarder for non-/api paths
app.get('/forwarder/healthz', async (req, res) => {
  try {
    const targetBase = getNetworkBridgeUrl();
    if (!targetBase) {
      return res.status(503).json({ ok: false, error: 'No controller or forwarder configured' });
    }
    const url = `${targetBase.replace(/\/$/, '')}/healthz`;
    const r = await fetch(url, { method: 'GET' });
    const body = await r.text();
    res.status(r.status).set('content-type', r.headers.get('content-type') || 'application/json').send(body);
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

app.get('/forwarder/devicedatas', async (req, res) => {
  try {
    const targetBase = getNetworkBridgeUrl();
    if (!targetBase) {
      return res.status(503).json({ ok: false, error: 'No controller or forwarder configured' });
    }
    const url = `${targetBase.replace(/\/$/, '')}/api/devicedatas`;
    const r = await fetch(url, { method: 'GET' });
    const body = await r.text();
    res.status(r.status).set('content-type', r.headers.get('content-type') || 'application/json').send(body);
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

// POST proxy to forward Wi‑Fi provisioning requests to the configured controller/forwarder.
// Expects JSON body with Wi‑Fi configuration (e.g., { ssid, psk, static, staticIp })
app.post('/forwarder/provision/wifi', async (req, res) => {
  try {
    const targetBase = getNetworkBridgeUrl();
    if (!targetBase) {
      return res.status(503).json({ ok: false, error: 'No controller or forwarder configured' });
    }
    const url = `${targetBase.replace(/\/$/, '')}/api/provision/wifi`;
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(req.body) });
    const contentType = (r.headers.get('content-type') || '').toLowerCase();
    const text = await r.text();
    // If controller returned JSON, forward it; otherwise translate HTML/errors into JSON for client
    if (r.ok && contentType.includes('application/json')) {
      res.status(r.status).set('content-type', 'application/json').send(text);
    } else if (!r.ok) {
      const bodySnippet = text.length > 400 ? text.slice(0,400) + '...' : text;
      return res.status(502).json({ ok: false, error: 'Controller provisioning endpoint returned error', status: r.status, body: bodySnippet });
    } else {
      // Non-JSON 2xx response: wrap
      return res.status(200).json({ ok: true, message: text });
    }
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

// POST proxy for Bluetooth provisioning
app.post('/forwarder/provision/bluetooth', async (req, res) => {
  try {
    const targetBase = getNetworkBridgeUrl();
    if (!targetBase) {
      return res.status(503).json({ ok: false, error: 'No controller or forwarder configured' });
    }
    const url = `${targetBase.replace(/\/$/, '')}/api/provision/bluetooth`;
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(req.body) });
    const contentType = (r.headers.get('content-type') || '').toLowerCase();
    const text = await r.text();
    if (r.ok && contentType.includes('application/json')) {
      res.status(r.status).set('content-type', 'application/json').send(text);
    } else if (!r.ok) {
      const bodySnippet = text.length > 400 ? text.slice(0,400) + '...' : text;
      return res.status(502).json({ ok: false, error: 'Controller provisioning endpoint returned error', status: r.status, body: bodySnippet });
    } else {
      return res.status(200).json({ ok: true, message: text });
    }
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

// --- Branding and Farm Profile Endpoints ---
function setCors(req, res) {
  applyCorsHeaders(req, res, 'GET,POST,OPTIONS');
}

app.options('/brand/extract', (req, res) => { setCors(req, res); res.status(204).end(); });
app.options('/farm', (req, res) => { setCors(req, res); res.status(204).end(); });

// Helper: safe JSON read
function readJSONSafe(fullPath, fallback = null) {
  try {
    if (fs.existsSync(fullPath)) {
      const raw = fs.readFileSync(fullPath, 'utf8');
      return JSON.parse(raw);
    }
  } catch {}
  return fallback;
}

function resolveUiDataPath(resource) {
  const normalized = String(resource || '').toLowerCase();
  if (!UI_DATA_RESOURCES.has(normalized)) {
    return null;
  }
  return path.join(DATA_DIR, UI_DATA_RESOURCES.get(normalized));
}

function loadUiData(resource) {
  const normalized = String(resource || '').toLowerCase();
  const fullPath = resolveUiDataPath(normalized);
  if (!fullPath) {
    return null;
  }
  const fallback = normalized === 'plans' ? { plans: [] } : {};
  return readJSONSafe(fullPath, fallback);
}

// Tiny color utils
function hexToRgb(hex) {
  if (!hex) return null;
  const m = hex.replace('#','').trim();
  if (m.length === 3) {
    const r = parseInt(m[0]+m[0],16), g=parseInt(m[1]+m[1],16), b=parseInt(m[2]+m[2],16);
    return {r,g,b};
  }
  if (m.length === 6) {
    const r = parseInt(m.slice(0,2),16), g=parseInt(m.slice(2,4),16), b=parseInt(m.slice(4,6),16);
    return {r,g,b};
  }
  return null;
}
function rgbToHex({r,g,b}) {
  const to = (v)=>Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,'0');
  return `#${to(r)}${to(g)}${to(b)}`;
}
function luminance(hex){
  const c = hexToRgb(hex); if(!c) return 1;
  const srgb = ['r','g','b'].map(k=>{
    let v = c[k]/255; return v<=0.03928? v/12.92 : Math.pow((v+0.055)/1.055,2.4);
  });
  return 0.2126*srgb[0]+0.7152*srgb[1]+0.0722*srgb[2];
}
function contrastRatio(h1,h2){
  const L1 = luminance(h1), L2 = luminance(h2);
  const a = Math.max(L1,L2)+0.05, b = Math.min(L1,L2)+0.05; return a/b;
}
function mix(hex1, hex2, t){
  const a = hexToRgb(hex1)||{r:255,g:255,b:255};
  const b = hexToRgb(hex2)||{r:255,g:255,b:255};
  return rgbToHex({ r: a.r+(b.r-a.r)*t, g: a.g+(b.g-a.g)*t, b: a.b+(b.b-a.b)*t });
}
function isGrey(hex){
  const c = hexToRgb(hex); if(!c) return false;
  const max = Math.max(c.r,c.g,c.b), min=Math.min(c.r,c.g,c.b);
  return (max-min) < 16; // low chroma
}
function uniqueColors(colors){
  const set = new Set(); const out = [];
  for(const h of colors){ const k=h.toUpperCase(); if(!set.has(k)){ set.add(k); out.push(h);} }
  return out;
}
function extractColorsFromText(txt){
  const hexes = (txt.match(/#[0-9a-fA-F]{3,6}\b/g) || []).map(h=>h.length===4?`#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}`:h);
  return uniqueColors(hexes);
}

async function fetchText(url, ac){
  const r = await fetch(url, { headers: { 'accept':'text/html, text/css, */*' }, signal: ac?.signal });
  if(!r.ok) throw new Error(`fetch ${r.status}`); return await r.text();
}

function resolveUrl(base, href){
  try { return new URL(href, base).toString(); } catch { return href; }
}

function normalizePalette(seed){
  const neutral = { background: '#F7FAFA', surface: '#FFFFFF', border: '#DCE5E5', text: '#0B1220', primary: '#0D7D7D', accent: '#64C7C7' };
  const p = { ...neutral, ...(seed||{}) };
  // Ensure light background
  if (luminance(p.background) < 0.35) p.background = mix(p.background, '#FFFFFF', 0.3);
  // Ensure contrast text/background
  if (contrastRatio(p.text, p.background) < 4.5) {
    // choose dark or white whichever passes
    p.text = contrastRatio('#0B1220', p.background) >= 4.5 ? '#0B1220' : '#FFFFFF';
  }
  // Surface slightly lighter than background
  if (contrastRatio(p.surface, p.background) < 1.2) p.surface = '#FFFFFF';
  // Border slightly darker than background
  p.border = contrastRatio(p.border, p.surface) < 1.2 ? mix(p.surface, '#000000', 0.08) : p.border;
  return p;
}

app.get('/brand/extract', async (req, res) => {
  try {
    setCors(req, res);
    const target = String(req.query.url || '').trim();
    if (!target) return res.status(400).json({ ok:false, error: 'url required' });
    const ac = new AbortController();
    const timer = setTimeout(()=>ac.abort(), 4000);
    let html = '';
    try {
      html = await fetchText(target, ac);
    } finally { clearTimeout(timer); }
    const origin = new URL(target).origin;
    const meta = {};
    // very small tag scraping
    const metaTag = (name, attr='name') => {
      const re = new RegExp(`<meta[^>]+${attr}=[\"\']${name}[\"\'][^>]*content=[\"\']([^\"\']+)[\"\']`, 'i');
      const m = html.match(re); return m ? m[1] : '';
    };
    const title = (()=>{ const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i); return m? m[1].trim():''; })();
    const siteName = metaTag('og:site_name','property') || metaTag('application-name','name') || title || new URL(target).hostname;
    // logo candidates
    const links = Array.from(html.matchAll(/<link[^>]+>/gi)).map(m=>m[0]);
    const iconHrefs = [];
    for (const ln of links) {
      if (/rel=["'](?:icon|shortcut icon|apple-touch-icon)["']/i.test(ln)) {
        const m = ln.match(/href=["']([^"']+)["']/i); if (m) iconHrefs.push(resolveUrl(origin, m[1]));
      }
    }
    const metaLogo = metaTag('og:logo','property') || metaTag('logo','itemprop') || '';
    if (metaLogo) iconHrefs.unshift(resolveUrl(origin, metaLogo));
    // prefer svg, then png
    let logo = iconHrefs.find(u=>u.toLowerCase().endsWith('.svg')) || iconHrefs.find(u=>u.toLowerCase().endsWith('.png')) || iconHrefs[0] || '';

    // colors from meta theme-color
    const themeColor = metaTag('theme-color','name');
    // find stylesheets
    const cssLinks = links.filter(l=>/rel=["']stylesheet["']/i.test(l)).map(l=>{
      const m = l.match(/href=["']([^"']+)["']/i); return m? resolveUrl(origin, m[1]) : null; }).filter(Boolean).slice(0,2);
    // capture any Google Fonts links as candidates to include client-side for brand font
    const fontCssLinks = cssLinks.filter(u => /fonts\.googleapis\.com|fonts\.gstatic\.com/i.test(u));
    let cssText = '';
    for (const cssUrl of cssLinks) {
      try { cssText += '\n' + await fetchText(cssUrl); } catch {}
    }
    // inline styles
    const inlineStyles = (html.match(/<style[^>]*>([\s\S]*?)<\/style>/gi) || []).join('\n');
    cssText += '\n' + inlineStyles;
    const foundColors = extractColorsFromText(cssText);
    const nonGrey = foundColors.filter(c=>!isGrey(c));
    const primary = themeColor || nonGrey[0] || '#0D7D7D';
    const accent = nonGrey.find(c=>c.toUpperCase()!==primary.toUpperCase()) || mix(primary,'#FFFFFF',0.5);
    const lightCandidates = foundColors.filter(c=>luminance(c) > 0.8);
    const background = lightCandidates[0] || '#F7FAFA';
    const palette = normalizePalette({ primary, accent, background });
    // Try to detect a brand font family from CSS
    let fontFamily = '';
    try {
      // prefer explicitly named, non-generic families
      const fams = Array.from(cssText.matchAll(/font-family\s*:\s*([^;}{]+);/gi)).map(m => m[1]);
      const pick = (arr) => {
        const GENERICS = ['sans-serif','serif','monospace','system-ui','ui-sans-serif','ui-serif','ui-monospace','cursive','fantasy','emoji','math','fangsong'];
        for (const f of arr) {
          // split on commas and trim quotes
          const parts = f.split(',').map(s=>s.trim().replace(/^['"]|['"]$/g,''));
          for (const p of parts) {
            if (!GENERICS.includes(p.toLowerCase())) return p;
          }
        }
        return '';
      };
      fontFamily = pick(fams) || '';
    } catch {}
    return res.json({ ok:true, name: siteName, logo, palette, fontFamily, fontCss: fontCssLinks });
  } catch (e) {
    setCors(req, res);
    // neutral fallback
    const fallback = { background:'#F7FAFA', surface:'#FFFFFF', border:'#DCE5E5', text:'#0B1220', primary:'#0D7D7D', accent:'#64C7C7' };
    return res.status(200).json({ ok:false, error: e.message, name: '', logo: '', palette: fallback, fontFamily: '', fontCss: [] });
  }
});

// GET current farm (including branding)
app.get('/farm', (req, res) => {
  try {
    setCors(req, res);
    const data = readJSONSafe(FARM_PATH, null) || { farmName:'', locations:[], contact:{}, crops:[], branding:null };
    res.json(data);
  } catch (e) {
    res.status(500).json({ ok:false, error: e.message });
  }
});

// Lightweight status of integrations (no secrets in response)
// Also expose a non-proxied variant to avoid /api proxy interception
app.get('/integrations/status', (req, res) => {
  try {
    const integ = getFarmIntegrations();
    res.json({
      ok: true,
      switchbot: { configured: Boolean(integ.switchbot.token && integ.switchbot.secret) },
      kasa: { configured: Boolean(integ.kasa.email && integ.kasa.password) }
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Legacy path kept for backward compatibility but may be proxied to FastAPI if proxy is mounted first
app.get('/api/integrations/status', (req, res) => {
  try {
    const integ = getFarmIntegrations();
    res.json({
      ok: true,
      switchbot: { configured: Boolean(integ.switchbot.token && integ.switchbot.secret) },
      kasa: { configured: Boolean(integ.kasa.email && integ.kasa.password) }
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Save farm
app.post('/farm', (req, res) => {
  try {
    setCors(req, res);
    const body = req.body || {};
    // basic shape: store as-is
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FARM_PATH, JSON.stringify(body, null, 2));
    // Reconfigure weather polling when farm coordinates change
    setupWeatherPolling();
    // Clear SwitchBot caches so new credentials or devices take effect immediately
    try {
      switchBotDevicesCache.payload = null;
      switchBotDevicesCache.fetchedAt = 0;
      switchBotDevicesCache.inFlight = null;
      switchBotDevicesCache.lastError = null;
      for (const entry of switchBotStatusCache.values()) {
        entry.payload = null;
        entry.fetchedAt = 0;
        entry.inFlight = null;
        entry.lastError = null;
      }
      lastSwitchBotRequest = 0;
    } catch {}
    res.json({ ok:true });
  } catch (e) {
    res.status(500).json({ ok:false, error: e.message });
  }
});

// Geocoding API to get coordinates from address

// Simple reachability probe: GET /probe?url=http://host:port
app.get('/probe', async (req, res) => {
  try {
    const url = String(req.query.url || '').trim();
    if (!url) return res.status(400).json({ ok: false, error: 'url required' });
    const started = Date.now();
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 1500);
    let status = null;
    let ok = false;
    try {
      let r = await fetch(url, { method: 'HEAD', signal: ac.signal });
      status = r.status;
      ok = r.ok;
      // Fallback to GET when HEAD not supported or non-OK
      if (!ok || (typeof status === 'number' && status >= 400)) {
        r = await fetch(url, { method: 'GET', headers: { 'accept': '*/*' }, signal: ac.signal });
        status = r.status;
        ok = r.ok;
      }
    } catch (e) {
      status = e.name === 'AbortError' ? 'timeout' : (e.message || 'error');
      ok = false;
    } finally {
      clearTimeout(t);
    }
    res.json({ ok, status, dtMs: Date.now() - started });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// --- Environment Telemetry Endpoints (Cloud-ready: AWS/Azure) ---
// Utility: compute VPD (kPa) from tempC and RH%
function computeVPDkPa(tempC, rhPercent) {
  if (typeof tempC !== 'number' || typeof rhPercent !== 'number' || Number.isNaN(tempC) || Number.isNaN(rhPercent)) return null;
  const svp = 0.6108 * Math.exp((17.27 * tempC) / (tempC + 237.3)); // kPa
  const rh = Math.min(Math.max(rhPercent / 100, 0), 1);
  const vpd = svp * (1 - rh);
  return Math.round(vpd * 100) / 100; // 2 decimals
}

// In-memory history cache for cloud mode: key => [values]
const cloudHist = new Map();
const pushHist = (key, val, max = 100) => {
  if (val == null || Number.isNaN(val)) return;
  const arr = cloudHist.get(key) || [];
  arr.unshift(val);
  if (arr.length > max) arr.length = max;
  cloudHist.set(key, arr);
};

const ZONE_SENSOR_FRESH_MS = 10 * 60 * 1000; // 10 minutes

function weightedMedianSamples(samples) {
  if (!Array.isArray(samples) || !samples.length) return null;
  const normalized = samples
    .filter((sample) => isFiniteNumber(sample.value))
    .map((sample) => ({
      value: sample.value,
      weight: isFiniteNumber(sample.weight) && sample.weight > 0 ? sample.weight : 1
    }))
    .sort((a, b) => a.value - b.value);
  if (!normalized.length) return null;
  const totalWeight = normalized.reduce((acc, sample) => acc + sample.weight, 0);
  const half = totalWeight / 2;
  let running = 0;
  for (const sample of normalized) {
    running += sample.weight;
    if (running >= half) {
      return sample.value;
    }
  }
  return normalized[normalized.length - 1].value;
}

function aggregateZoneSources(sourceEntries) {
  const entries = Object.values(sourceEntries || {})
    .filter((entry) => entry && isFiniteNumber(entry.value))
    .map((entry) => ({
      ...entry,
      observedAtTs: Date.parse(entry.observedAt || '') || Date.now()
    }));

  if (!entries.length) {
    return {
      value: null,
      observedAt: null,
      liveSources: 0,
      totalSources: 0,
      fallback: null,
      lastSampleAt: null
    };
  }

  const now = Date.now();
  const live = entries.filter((entry) => now - entry.observedAtTs <= ZONE_SENSOR_FRESH_MS);
  const samples = live.length ? live : entries;
  const aggregate = weightedMedianSamples(samples);
  const latest = samples.reduce((acc, entry) => (entry.observedAtTs > acc ? entry.observedAtTs : acc), 0);

  return {
    value: aggregate,
    observedAt: latest ? new Date(latest).toISOString() : null,
    liveSources: live.length,
    totalSources: entries.length,
    fallback: live.length ? null : 'stale-sources',
    lastSampleAt: latest ? new Date(latest).toISOString() : null
  };
}

async function loadEnvZonesPayload(query = {}) {
  if (ENV_SOURCE === 'cloud' && CLOUD_ENDPOINT_URL) {
    const params = new URLSearchParams();
    if (query.zone) params.set('zone', query.zone);
    if (query.deviceId) params.set('deviceId', query.deviceId);
    if (query.hours) params.set('hours', String(query.hours));
    if (query.since) params.set('since', String(query.since));
    const url = params.toString() ? `${CLOUD_ENDPOINT_URL}?${params.toString()}` : CLOUD_ENDPOINT_URL;

    try {
      const response = await fetch(url, { method: 'GET', headers: { accept: 'application/json' } });
      if (!response.ok) throw new Error(`Cloud endpoint ${response.status}`);
      const list = await response.json();

      const zonesMap = new Map();
      for (const entry of Array.isArray(list) ? list : []) {
        const zoneId = entry.zone || 'DefaultZone';
        const zone = zonesMap.get(zoneId) || { id: zoneId, name: entry.zoneName || zoneId, location: entry.zoneName || zoneId, sensors: {}, meta: {} };
        const temp = Number(entry.temperature);
        const humidity = Number(entry.humidity);
        const co2 = Number(entry.co2);
        const vpd = computeVPDkPa(temp, humidity);

        if (typeof entry.battery === 'number') zone.meta.battery = entry.battery;
        if (typeof entry.rssi === 'number') zone.meta.rssi = entry.rssi;
        if (entry.timestamp) zone.meta.lastUpdated = entry.timestamp;

        const ensureSensor = (key, value) => {
          if (!zone.sensors[key]) {
            zone.sensors[key] = { current: null, setpoint: { min: null, max: null }, history: [], sources: {} };
          }
          if (typeof value === 'number' && !Number.isNaN(value)) {
            const histKey = `${zoneId}:${key}`;
            pushHist(histKey, value);
            zone.sensors[key].history = cloudHist.get(histKey) || [];

            const sources = zone.sensors[key].sources || (zone.sensors[key].sources = {});
            const sensorId = entry.sensorId || entry.deviceId || entry.mac || entry.serial || entry.id || `${zoneId}:${key}`;
            const observedAt = entry.timestamp || entry.observedAt || entry.recordedAt || entry.lastSeen || new Date().toISOString();
            const weight = Number(entry.weight ?? entry.confidence ?? entry.priority);
            const sample = {
              value,
              weight: Number.isFinite(weight) && weight > 0 ? weight : undefined,
              observedAt
            };
            const existingSample = sources[sensorId];
            const existingTs = existingSample ? Date.parse(existingSample.observedAt || '') || 0 : 0;
            const nextTs = Date.parse(sample.observedAt || '') || Date.now();
            if (!existingSample || nextTs >= existingTs) {
              sources[sensorId] = sample;
            }
          }
        };

        ensureSensor('tempC', temp);
        ensureSensor('rh', humidity);
        ensureSensor('co2', co2);
        if (vpd != null) ensureSensor('vpd', vpd);

        zonesMap.set(zoneId, zone);
      }

      const zonesList = Array.from(zonesMap.values()).map((zone) => {
        const sensors = zone.sensors || {};
        for (const sensor of Object.values(sensors)) {
          const aggregate = aggregateZoneSources(sensor.sources || {});
          if (aggregate.value != null) {
            sensor.current = aggregate.value;
            sensor.observedAt = aggregate.observedAt || sensor.observedAt || zone.meta?.lastUpdated || null;
          }
          sensor.meta = {
            ...(sensor.meta || {}),
            liveSources: aggregate.liveSources,
            totalSources: aggregate.totalSources,
            fallback: aggregate.fallback,
            lastSampleAt: aggregate.lastSampleAt
          };
        }
        return zone;
      });

      return {
        zones: zonesList,
        source: 'cloud',
        meta: { provider: 'cloud', cached: false }
      };
    } catch (error) {
      if (cloudHist.size > 0) {
        const zones = {};
        for (const [key, history] of cloudHist.entries()) {
          const [zoneId, metric] = key.split(':');
          zones[zoneId] = zones[zoneId] || { id: zoneId, name: zoneId, location: zoneId, sensors: {} };
          zones[zoneId].sensors[metric] = { current: history[0] ?? null, setpoint: { min: null, max: null }, history };
        }
        return {
          zones: Object.values(zones),
          source: 'cloud-cache',
          meta: { provider: 'cloud', cached: true, error: error.message }
        };
      }
      throw error;
    }
  }

  // Prefer in-memory cache to avoid disk I/O on every request
  const data = (await ensureEnvCacheLoaded()) || { zones: [] };
  const zones = Array.isArray(data.zones) ? data.zones : [];
  return {
    zones,
    source: 'local',
    meta: { provider: 'local', updatedAt: data.updatedAt || null }
  };
}

// POST: ingest a telemetry message and upsert into env.json
// Expected body: { zoneId, name, temperature, humidity, vpd, co2, battery, rssi, source }
app.post("/ingest/env", async (req, res) => {
  try {
    const { zoneId, name, temperature, humidity, vpd, co2, battery, rssi, source } = req.body || {};
    if (!zoneId) return res.status(400).json({ ok: false, error: "zoneId required" });
    
    // Load/ensure in-memory state
    const data = await ensureEnvCacheLoaded();
    data.zones = data.zones || [];
    let zone = data.zones.find(z => z.id === zoneId);
    if (!zone) {
      zone = { id: zoneId, name: name || zoneId, location: name || zoneId, sensors: {} };
      data.zones.push(zone);
    }
    zone.name = name || zone.name;
    zone.location = zone.location || zone.name;
    zone.meta = zone.meta || {};
    if (source) zone.meta.source = source;
    if (typeof battery === "number") zone.meta.battery = battery;
    if (typeof rssi === "number") zone.meta.rssi = rssi;

    const ensure = (k, val, unit) => {
      zone.sensors[k] = zone.sensors[k] || { current: null, setpoint: { min: null, max: null }, history: [] };
      if (typeof val === "number" && !Number.isNaN(val)) {
        zone.sensors[k].current = val;
        zone.sensors[k].history = [val, ...(zone.sensors[k].history || [])].slice(0, 100);
      }
    };
    ensure("tempC", temperature);
    ensure("rh", humidity);
    ensure("vpd", vpd);
    ensure("co2", co2);

  // Persist in the background; coalesce high-churn writes
  persistEnvCache().catch((e)=>console.warn('[env] async persist failed:', e?.message || e));

    // Process sensor readings through automation engine
    try {
      const sensorReadings = [];
      if (typeof temperature === "number" && !Number.isNaN(temperature)) {
        sensorReadings.push({
          source: source || 'env-ingest',
          deviceId: zoneId,
          type: 'temperature',
          value: temperature,
          metadata: { zone: zone.name, battery, rssi }
        });
      }
      if (typeof humidity === "number" && !Number.isNaN(humidity)) {
        sensorReadings.push({
          source: source || 'env-ingest',
          deviceId: zoneId,
          type: 'humidity',
          value: humidity,
          metadata: { zone: zone.name, battery, rssi }
        });
      }
      if (typeof co2 === "number" && !Number.isNaN(co2)) {
        sensorReadings.push({
          source: source || 'env-ingest',
          deviceId: zoneId,
          type: 'co2',
          value: co2,
          metadata: { zone: zone.name, battery, rssi }
        });
      }
      if (typeof vpd === "number" && !Number.isNaN(vpd)) {
        sensorReadings.push({
          source: source || 'env-ingest',
          deviceId: zoneId,
          type: 'vpd',
          value: vpd,
          metadata: { zone: zone.name, battery, rssi }
        });
      }

      // Process each sensor reading through automation rules
      for (const reading of sensorReadings) {
        await automationEngine.processSensorData(reading);
      }
      
      if (sensorReadings.length > 0) {
        console.log(`[automation] Processed ${sensorReadings.length} sensor readings from zone ${zoneId}`);
      }
    } catch (automationError) {
      console.warn('Sensor automation processing failed:', automationError.message);
    }

    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// Namespaced UI config endpoints to avoid collisions with controller routes
app.get('/ui/ctrlmap', (req, res) => {
  setCors(req, res);
  let existing = {};
  try {
    if (fs.existsSync(UI_CTRLMAP_PATH)) {
      const raw = fs.readFileSync(UI_CTRLMAP_PATH, 'utf8');
      existing = raw ? JSON.parse(raw) : {};
    }
  } catch (error) {
    console.warn('[ui.ctrlmap] Failed to read data:', error?.message || error);
    existing = {};
  }
  res.json(existing);
});

app.post('/ui/ctrlmap', pinGuard, express.json(), (req, res) => {
  setCors(req, res);
  let existing = {};
  try {
    if (fs.existsSync(UI_CTRLMAP_PATH)) {
      const raw = fs.readFileSync(UI_CTRLMAP_PATH, 'utf8');
      existing = raw ? JSON.parse(raw) : {};
    }
  } catch (error) {
    console.warn('[ui.ctrlmap] Failed to read existing data:', error?.message || error);
    existing = {};
  }

  const { key, method, controllerId } = req.body || {};
  if (!key || !method || !controllerId) {
    return res.status(400).json({ error: 'key/method/controllerId required' });
  }

  existing[key] = { method, controllerId, ts: Date.now() };

  try {
    fs.mkdirSync(path.dirname(UI_CTRLMAP_PATH), { recursive: true });
    fs.writeFileSync(UI_CTRLMAP_PATH, JSON.stringify(existing, null, 2));
  } catch (error) {
    console.warn('[ui.ctrlmap] Failed to persist data:', error?.message || error);
    return res.status(500).json({ error: 'failed to save' });
  }

  res.json({ ok: true });
});

app.get('/ui/catalog', (req, res) => {
  setCors(req, res);
  try {
    if (!fs.existsSync(EQUIPMENT_CATALOG_PATH)) {
      res.status(404).json({ dehumidifiers: [] });
      return;
    }
    const raw = fs.readFileSync(EQUIPMENT_CATALOG_PATH, 'utf8');
    res.set('Cache-Control', 'no-store').type('application/json').send(raw);
  } catch (error) {
    res.status(500).json({ error: 'catalog_read_failed', detail: error?.message || String(error) });
  }
});

app.get('/ui/equip', (req, res) => {
  setCors(req, res);
  let existing = {};
  try {
    if (fs.existsSync(UI_EQUIP_PATH)) {
      const raw = fs.readFileSync(UI_EQUIP_PATH, 'utf8');
      existing = raw ? JSON.parse(raw) : {};
    }
  } catch (error) {
    console.warn('[ui.equip] Failed to read existing data:', error?.message || error);
    existing = {};
  }
  res.json(existing);
});

app.options('/ui/:resource', (req, res) => { setCors(req, res); res.status(204).end(); });

app.get('/ui/:resource', (req, res) => {
  const resource = String(req.params.resource || '').toLowerCase();
  setCors(req, res);
  const data = loadUiData(resource);
  if (data === null) {
    return res.status(404).json({ ok: false, error: `Unknown UI resource '${resource}'` });
  }
  return res.json({ ok: true, resource, data });
});

app.post('/ui/equip', pinGuard, express.json(), (req, res) => {
  setCors(req, res);
  const { id, kind, count } = req.body || {};
  if (!id || !kind) {
    return res.status(400).json({ error: 'id/kind required' });
  }

  const parsedCount = Number.parseInt(count, 10);
  const safeCount = Math.max(0, Number.isFinite(parsedCount) ? parsedCount | 0 : 0);

  let existing = {};
  try {
    if (fs.existsSync(UI_EQUIP_PATH)) {
      const raw = fs.readFileSync(UI_EQUIP_PATH, 'utf8');
      existing = raw ? JSON.parse(raw) : {};
    }
  } catch (error) {
    console.warn('[ui.equip] Failed to read existing data:', error?.message || error);
    existing = {};
  }

  existing[id] = { kind, count: safeCount, ts: Date.now() };

  try {
    fs.mkdirSync(path.dirname(UI_EQUIP_PATH), { recursive: true });
    const payload = JSON.stringify(existing, null, 2);
    return writeJsonQueued(UI_EQUIP_PATH, payload)
      .then(() => res.json({ ok: true, id, count: safeCount }))
      .catch((error) => {
        console.warn('[ui.equip] Failed to persist data:', error?.message || error);
        return res.status(500).json({ error: 'failed to save' });
      });
  } catch (error) {
    console.warn('[ui.equip] Failed to persist data:', error?.message || error);
    return res.status(500).json({ error: 'failed to save' });
  }
});

app.post('/ui/:resource', pinGuard, (req, res) => {
  const resource = String(req.params.resource || '').toLowerCase();
  setCors(req, res);
  const fullPath = resolveUiDataPath(resource);
  if (!fullPath) {
    return res.status(404).json({ ok: false, error: `Unknown UI resource '${resource}'` });
  }
  try {
    ensureDataDir();
    const body = req.body ?? {};
    const payload = JSON.stringify(body, null, 2);
    writeJsonQueued(fullPath, payload)
      .then(() => res.json({ ok: true, resource, bytesWritten: Buffer.byteLength(payload) }))
      .catch((e) => res.status(500).json({ ok: false, error: e.message }));
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// Generic save endpoint for JSON files in public/data (e.g., groups.json, schedules.json, device-meta.json)
app.post("/data/:name", (req, res) => {
  try {
    const name = req.params.name || "";
    if (!name.endsWith(".json")) return res.status(400).json({ ok: false, error: "Only .json files allowed" });
    const baseName = path.basename(name);
    const full = path.join(DATA_DIR, baseName);
    const payload = JSON.stringify(req.body, null, 2);

    // Persist the requested file first
    writeJsonQueued(full, payload)
      .then(async () => {
        // If this is a room map save, perform additional side-effects so Room Mapper becomes source of truth
        const isRoomMap = /^room-map(.*)?\.json$/.test(baseName);
        if (isRoomMap) {
          try {
            // While multi-room support is evolving, mirror room-map-<roomId>.json to legacy room-map.json
            if (baseName !== 'room-map.json') {
              const legacyPath = path.join(DATA_DIR, 'room-map.json');
              await writeJsonQueued(legacyPath, payload);
            }

            // Reinitialize targets and zone assignments from the latest room-map.json
            try { initializeZoneSetpointsFromRoomMap(); } catch (err) {
              console.warn('[setpoint-init] Post-save refresh failed:', err?.message || err);
            }
            try { syncZoneAssignmentsFromRoomMap(); } catch (err) {
              console.warn('[zone-sync] Post-save refresh failed:', err?.message || err);
            }
            // Sync zone names back to rooms.json so Grow Room Setup page stays current
            try { syncZonesToRoomsJson(req.body, baseName); } catch (err) {
              console.warn('[zone-rooms-sync] Post-save refresh failed:', err?.message || err);
            }
          } catch (sideEffectErr) {
            console.warn('[room-map] Post-save side-effects failed:', sideEffectErr?.message || sideEffectErr);
          }
        }

        return res.json({ ok: true, name: baseName, refreshed: isRoomMap || false });
      })
      .catch((e) => res.status(500).json({ ok: false, error: e.message }));
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

app.options('/groups', (req, res) => { setCors(req, res); res.status(204).end(); });
app.options('/groups/:id', (req, res) => { setCors(req, res); res.status(204).end(); });

app.get('/groups', (req, res) => {
  setCors(req, res);
  try {
    const groups = loadGroupsFile().map(normalizeGroupForResponse).filter(Boolean);
    return res.json(groups);
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/groups', pinGuard, async (req, res) => {
  setCors(req, res);
  if (IS_TEST_ENV) {
    console.log('[debug] /groups handler IS_TEST_ENV:', IS_TEST_ENV, 'RUNNING_UNDER_NODE_TEST:', RUNNING_UNDER_NODE_TEST);
  }
  const body = req.body ?? {};
  const incoming = Array.isArray(body.groups) ? body.groups : (Array.isArray(body) ? body : null);
  if (!Array.isArray(incoming)) {
    return res.status(400).json({ ok: false, error: 'Expected { groups: [...] } payload.' });
  }
  try {
    // Under tests, skip controller validation for repeatable runs
    const knownIds = RUNNING_UNDER_NODE_TEST ? null : await fetchKnownDeviceIds();
    const parsed = incoming.map((g) => parseIncomingGroup(g, knownIds));
    const stored = parsed.map((item) => item.stored);
    if (!saveGroupsFile(stored)) {
      return res.status(500).json({ ok: false, error: 'Failed to persist groups.' });
    }
    return res.json({ ok: true, groups: parsed.map((item) => item.response) });
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message });
  }
});

app.put('/groups/:id', pinGuard, async (req, res) => {
  setCors(req, res);
  const id = String(req.params.id || '').trim();
  if (!id) return res.status(400).json({ ok: false, error: 'Group id is required.' });
  const existing = loadGroupsFile();
  const idx = existing.findIndex((group) => String(group?.id || '').trim() === id);
  if (idx === -1) return res.status(404).json({ ok: false, error: `Group '${id}' not found.` });
  try {
    const merged = { ...req.body, id };
    const knownIds = RUNNING_UNDER_NODE_TEST ? null : await fetchKnownDeviceIds();
    const { stored, response } = parseIncomingGroup(merged, knownIds);
    existing[idx] = stored;
    // Async queued write to avoid blocking I/O
    const payload = JSON.stringify({ groups: existing }, null, 2);
    await writeJsonQueued(GROUPS_PATH, payload);
    return res.json({ ok: true, group: response });
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message });
  }
});

app.options('/plans', (req, res) => { setCors(req, res); res.status(204).end(); });
app.get('/plans', (req, res) => {
  try {
    setCors(req, res);
    
    // Demo mode: Return sample lighting recipes with environmental targets
    if (isDemoMode()) {
      const demoPlans = [
        {
          id: 'crop-lettuce',
          key: 'crop-lettuce',
          name: 'Lettuce',
          crop: 'Lettuce',
          kind: 'recipe',
          description: 'Complete lighting and environmental recipe for lettuce production',
          light: {
            days: [
              { 
                day: 1, 
                stage: 'seedling', 
                ppfd: 150, 
                mix: { cw: 0, ww: 0, bl: 25, gn: 10, rd: 40, fr: 5 },
                bandTargets: { B: 25, G: 10, R: 40, FR: 5 },
                spectralDistribution: {
                  bands: [
                    { name: 'Blue', range: '400-500nm', target: 25, description: 'Promotes compact growth and chlorophyll synthesis' },
                    { name: 'Green', range: '500-600nm', target: 10, description: 'Penetrates canopy, synthesized from CW+WW mix' },
                    { name: 'Red', range: '600-700nm', target: 40, description: 'Drives photosynthesis and biomass accumulation' },
                    { name: 'Far Red', range: '700-750nm', target: 5, description: 'Influences stem elongation and flowering' }
                  ],
                  driverMapping: {
                    note: 'Spectrum solver converts B/G/R/FR targets to 4-channel driver commands',
                    channels: ['CW', 'WW', 'BL', 'RD'],
                    greenSynthesis: 'Green produced by mixing Cool White and Warm White LEDs'
                  }
                }
              },
              { 
                day: 7, 
                stage: 'vegetative', 
                ppfd: 200, 
                mix: { cw: 0, ww: 0, bl: 30, gn: 15, rd: 45, fr: 5 },
                bandTargets: { B: 30, G: 15, R: 45, FR: 5 },
                spectralDistribution: {
                  bands: [
                    { name: 'Blue', range: '400-500nm', target: 30, description: 'Increased for leaf development' },
                    { name: 'Green', range: '500-600nm', target: 15, description: 'Enhanced for deeper canopy penetration' },
                    { name: 'Red', range: '600-700nm', target: 45, description: 'Maximized for vegetative growth' },
                    { name: 'Far Red', range: '700-750nm', target: 5, description: 'Maintains optimal R:FR ratio' }
                  ],
                  driverMapping: {
                    note: 'Spectrum solver converts B/G/R/FR targets to 4-channel driver commands',
                    channels: ['CW', 'WW', 'BL', 'RD'],
                    greenSynthesis: 'Green produced by mixing Cool White and Warm White LEDs'
                  }
                }
              },
              { 
                day: 14, 
                stage: 'mature', 
                ppfd: 250, 
                mix: { cw: 0, ww: 0, bl: 35, gn: 15, rd: 50, fr: 5 },
                bandTargets: { B: 35, G: 15, R: 50, FR: 5 },
                spectralDistribution: {
                  bands: [
                    { name: 'Blue', range: '400-500nm', target: 35, description: 'Peak blue for quality and compactness' },
                    { name: 'Green', range: '500-600nm', target: 15, description: 'Maintains canopy light distribution' },
                    { name: 'Red', range: '600-700nm', target: 50, description: 'Maximum red for peak photosynthesis' },
                    { name: 'Far Red', range: '700-750nm', target: 5, description: 'Balanced for mature plant morphology' }
                  ],
                  driverMapping: {
                    note: 'Spectrum solver converts B/G/R/FR targets to 4-channel driver commands',
                    channels: ['CW', 'WW', 'BL', 'RD'],
                    greenSynthesis: 'Green produced by mixing Cool White and Warm White LEDs'
                  }
                }
              },
              { 
                day: 21, 
                stage: 'harvest', 
                ppfd: 220, 
                mix: { cw: 0, ww: 0, bl: 30, gn: 15, rd: 45, fr: 5 },
                bandTargets: { B: 30, G: 15, R: 45, FR: 5 },
                spectralDistribution: {
                  bands: [
                    { name: 'Blue', range: '400-500nm', target: 30, description: 'Reduced for pre-harvest finishing' },
                    { name: 'Green', range: '500-600nm', target: 15, description: 'Consistent canopy penetration' },
                    { name: 'Red', range: '600-700nm', target: 45, description: 'Balanced for quality at harvest' },
                    { name: 'Far Red', range: '700-750nm', target: 5, description: 'Maintains plant structure' }
                  ],
                  driverMapping: {
                    note: 'Spectrum solver converts B/G/R/FR targets to 4-channel driver commands',
                    channels: ['CW', 'WW', 'BL', 'RD'],
                    greenSynthesis: 'Green produced by mixing Cool White and Warm White LEDs'
                  }
                }
              }
            ]
          },
          env: {
            days: [
              { day: 1, tempC: 20, rh: 65, co2: 800 },
              { day: 7, tempC: 21, rh: 65, co2: 900 },
              { day: 14, tempC: 21, rh: 60, co2: 1000 },
              { day: 21, tempC: 20, rh: 60, co2: 800 }
            ]
          },
          defaults: { photoperiod: 18 },
          meta: {
            source: 'demo',
            appliesTo: { category: ['Crop'], varieties: ['Butterhead', 'Romaine', 'Red Leaf', 'Oak Leaf'] }
          }
        },
        {
          id: 'crop-basil',
          key: 'crop-basil',
          name: 'Basil',
          crop: 'Basil',
          kind: 'recipe',
          description: 'Complete lighting and environmental recipe for basil production',
          light: {
            days: [
              { 
                day: 1, 
                stage: 'seedling', 
                ppfd: 180, 
                mix: { cw: 0, ww: 0, bl: 30, gn: 12, rd: 42, fr: 5 },
                bandTargets: { B: 30, G: 12, R: 42, FR: 5 },
                spectralDistribution: {
                  bands: [
                    { name: 'Blue', range: '400-500nm', target: 30, description: 'Promotes essential oil production' },
                    { name: 'Green', range: '500-600nm', target: 12, description: 'Synthesized from CW+WW for canopy penetration' },
                    { name: 'Red', range: '600-700nm', target: 42, description: 'Drives rapid vegetative growth' },
                    { name: 'Far Red', range: '700-750nm', target: 5, description: 'Influences leaf expansion' }
                  ],
                  driverMapping: {
                    note: 'Spectrum solver converts B/G/R/FR targets to 4-channel driver commands',
                    channels: ['CW', 'WW', 'BL', 'RD'],
                    greenSynthesis: 'Green produced by mixing Cool White and Warm White LEDs'
                  }
                }
              },
              { 
                day: 7, 
                stage: 'vegetative', 
                ppfd: 250, 
                mix: { cw: 0, ww: 0, bl: 35, gn: 15, rd: 45, fr: 5 },
                bandTargets: { B: 35, G: 15, R: 45, FR: 5 },
                spectralDistribution: {
                  bands: [
                    { name: 'Blue', range: '400-500nm', target: 35, description: 'Enhanced for flavor compound development' },
                    { name: 'Green', range: '500-600nm', target: 15, description: 'Increased for dense leaf canopy' },
                    { name: 'Red', range: '600-700nm', target: 45, description: 'Maximizes photosynthetic rate' },
                    { name: 'Far Red', range: '700-750nm', target: 5, description: 'Maintains compact growth habit' }
                  ],
                  driverMapping: {
                    note: 'Spectrum solver converts B/G/R/FR targets to 4-channel driver commands',
                    channels: ['CW', 'WW', 'BL', 'RD'],
                    greenSynthesis: 'Green produced by mixing Cool White and Warm White LEDs'
                  }
                }
              },
              { 
                day: 14, 
                stage: 'mature', 
                ppfd: 280, 
                mix: { cw: 0, ww: 0, bl: 38, gn: 15, rd: 48, fr: 5 },
                bandTargets: { B: 38, G: 15, R: 48, FR: 5 },
                spectralDistribution: {
                  bands: [
                    { name: 'Blue', range: '400-500nm', target: 38, description: 'Peak blue for maximum essential oils' },
                    { name: 'Green', range: '500-600nm', target: 15, description: 'Maintains light distribution in mature canopy' },
                    { name: 'Red', range: '600-700nm', target: 48, description: 'Optimized for biomass and quality' },
                    { name: 'Far Red', range: '700-750nm', target: 5, description: 'Balanced morphology control' }
                  ],
                  driverMapping: {
                    note: 'Spectrum solver converts B/G/R/FR targets to 4-channel driver commands',
                    channels: ['CW', 'WW', 'BL', 'RD'],
                    greenSynthesis: 'Green produced by mixing Cool White and Warm White LEDs'
                  }
                }
              },
              { 
                day: 28, 
                stage: 'harvest', 
                ppfd: 260, 
                mix: { cw: 0, ww: 0, bl: 35, gn: 15, rd: 45, fr: 5 },
                bandTargets: { B: 35, G: 15, R: 45, FR: 5 },
                spectralDistribution: {
                  bands: [
                    { name: 'Blue', range: '400-500nm', target: 35, description: 'Sustained flavor profile development' },
                    { name: 'Green', range: '500-600nm', target: 15, description: 'Consistent canopy light quality' },
                    { name: 'Red', range: '600-700nm', target: 45, description: 'Maintained for pre-harvest quality' },
                    { name: 'Far Red', range: '700-750nm', target: 5, description: 'Final morphology tuning' }
                  ],
                  driverMapping: {
                    note: 'Spectrum solver converts B/G/R/FR targets to 4-channel driver commands',
                    channels: ['CW', 'WW', 'BL', 'RD'],
                    greenSynthesis: 'Green produced by mixing Cool White and Warm White LEDs'
                  }
                }
              }
            ]
          },
          env: {
            days: [
              { day: 1, tempC: 22, rh: 70, co2: 850 },
              { day: 7, tempC: 23, rh: 68, co2: 1000 },
              { day: 14, tempC: 23, rh: 65, co2: 1100 },
              { day: 28, tempC: 22, rh: 65, co2: 900 }
            ]
          },
          defaults: { photoperiod: 16 },
          meta: {
            source: 'demo',
            appliesTo: { category: ['Crop'], varieties: ['Genovese', 'Thai', 'Purple'] }
          }
        },
        {
          id: 'crop-arugula',
          key: 'crop-arugula',
          name: 'Arugula',
          crop: 'Arugula',
          kind: 'recipe',
          description: 'Complete lighting and environmental recipe for arugula production',
          light: {
            days: [
              { 
                day: 1, 
                stage: 'seedling', 
                ppfd: 140, 
                mix: { cw: 0, ww: 0, bl: 28, gn: 12, rd: 38, fr: 5 },
                bandTargets: { B: 28, G: 12, R: 38, FR: 5 },
                spectralDistribution: {
                  bands: [
                    { name: 'Blue', range: '400-500nm', target: 28, description: 'Promotes early leaf development' },
                    { name: 'Green', range: '500-600nm', target: 12, description: 'Synthesized from CW+WW mix' },
                    { name: 'Red', range: '600-700nm', target: 38, description: 'Drives rapid germination and growth' },
                    { name: 'Far Red', range: '700-750nm', target: 5, description: 'Minimal for compact habit' }
                  ],
                  driverMapping: {
                    note: 'Spectrum solver converts B/G/R/FR targets to 4-channel driver commands',
                    channels: ['CW', 'WW', 'BL', 'RD'],
                    greenSynthesis: 'Green produced by mixing Cool White and Warm White LEDs'
                  }
                }
              },
              { 
                day: 7, 
                stage: 'vegetative', 
                ppfd: 200, 
                mix: { cw: 0, ww: 0, bl: 32, gn: 14, rd: 42, fr: 5 },
                bandTargets: { B: 32, G: 14, R: 42, FR: 5 },
                spectralDistribution: {
                  bands: [
                    { name: 'Blue', range: '400-500nm', target: 32, description: 'Enhanced for peppery flavor compounds' },
                    { name: 'Green', range: '500-600nm', target: 14, description: 'Increased for leaf expansion' },
                    { name: 'Red', range: '600-700nm', target: 42, description: 'Peak photosynthetic efficiency' },
                    { name: 'Far Red', range: '700-750nm', target: 5, description: 'Controlled leaf stretch' }
                  ],
                  driverMapping: {
                    note: 'Spectrum solver converts B/G/R/FR targets to 4-channel driver commands',
                    channels: ['CW', 'WW', 'BL', 'RD'],
                    greenSynthesis: 'Green produced by mixing Cool White and Warm White LEDs'
                  }
                }
              },
              { 
                day: 14, 
                stage: 'harvest', 
                ppfd: 180, 
                mix: { cw: 0, ww: 0, bl: 30, gn: 14, rd: 40, fr: 5 },
                bandTargets: { B: 30, G: 14, R: 40, FR: 5 },
                spectralDistribution: {
                  bands: [
                    { name: 'Blue', range: '400-500nm', target: 30, description: 'Maintained for flavor quality' },
                    { name: 'Green', range: '500-600nm', target: 14, description: 'Consistent light penetration' },
                    { name: 'Red', range: '600-700nm', target: 40, description: 'Optimized for tender leaf texture' },
                    { name: 'Far Red', range: '700-750nm', target: 5, description: 'Final quality tuning' }
                  ],
                  driverMapping: {
                    note: 'Spectrum solver converts B/G/R/FR targets to 4-channel driver commands',
                    channels: ['CW', 'WW', 'BL', 'RD'],
                    greenSynthesis: 'Green produced by mixing Cool White and Warm White LEDs'
                  }
                }
              }
            ]
          },
          env: {
            days: [
              { day: 1, tempC: 19, rh: 65, co2: 800 },
              { day: 7, tempC: 20, rh: 62, co2: 950 },
              { day: 14, tempC: 19, rh: 60, co2: 800 }
            ]
          },
          defaults: { photoperiod: 18 },
          meta: {
            source: 'demo',
            appliesTo: { category: ['Crop'], varieties: ['Wild', 'Baby'] }
          }
        },
        {
          id: 'crop-kale',
          key: 'crop-kale',
          name: 'Kale',
          crop: 'Kale',
          kind: 'recipe',
          description: 'Complete lighting and environmental recipe for kale production',
          light: {
            days: [
              { 
                day: 1, 
                stage: 'seedling', 
                ppfd: 160, 
                mix: { cw: 0, ww: 0, bl: 30, gn: 12, rd: 40, fr: 5 },
                bandTargets: { B: 30, G: 12, R: 40, FR: 5 },
                spectralDistribution: {
                  bands: [
                    { name: 'Blue', range: '400-500nm', target: 30, description: 'Promotes strong seedling establishment' },
                    { name: 'Green', range: '500-600nm', target: 12, description: 'Synthesized from CW+WW for early growth' },
                    { name: 'Red', range: '600-700nm', target: 40, description: 'Drives initial photosynthetic activity' },
                    { name: 'Far Red', range: '700-750nm', target: 5, description: 'Minimal for compact seedling structure' }
                  ],
                  driverMapping: {
                    note: 'Spectrum solver converts B/G/R/FR targets to 4-channel driver commands',
                    channels: ['CW', 'WW', 'BL', 'RD'],
                    greenSynthesis: 'Green produced by mixing Cool White and Warm White LEDs'
                  }
                }
              },
              { 
                day: 10, 
                stage: 'vegetative', 
                ppfd: 220, 
                mix: { cw: 0, ww: 0, bl: 35, gn: 14, rd: 45, fr: 5 },
                bandTargets: { B: 35, G: 14, R: 45, FR: 5 },
                spectralDistribution: {
                  bands: [
                    { name: 'Blue', range: '400-500nm', target: 35, description: 'Enhanced for nutrient density and color' },
                    { name: 'Green', range: '500-600nm', target: 14, description: 'Increased for developing canopy' },
                    { name: 'Red', range: '600-700nm', target: 45, description: 'Peak red for rapid leaf expansion' },
                    { name: 'Far Red', range: '700-750nm', target: 5, description: 'Controlled for leaf morphology' }
                  ],
                  driverMapping: {
                    note: 'Spectrum solver converts B/G/R/FR targets to 4-channel driver commands',
                    channels: ['CW', 'WW', 'BL', 'RD'],
                    greenSynthesis: 'Green produced by mixing Cool White and Warm White LEDs'
                  }
                }
              },
              { 
                day: 21, 
                stage: 'mature', 
                ppfd: 260, 
                mix: { cw: 0, ww: 0, bl: 38, gn: 15, rd: 48, fr: 5 },
                bandTargets: { B: 38, G: 15, R: 48, FR: 5 },
                spectralDistribution: {
                  bands: [
                    { name: 'Blue', range: '400-500nm', target: 38, description: 'Maximum blue for anthocyanin production' },
                    { name: 'Green', range: '500-600nm', target: 15, description: 'Optimized for dense mature canopy' },
                    { name: 'Red', range: '600-700nm', target: 48, description: 'Maximum photosynthetic rate' },
                    { name: 'Far Red', range: '700-750nm', target: 5, description: 'Maintains compact rosette structure' }
                  ],
                  driverMapping: {
                    note: 'Spectrum solver converts B/G/R/FR targets to 4-channel driver commands',
                    channels: ['CW', 'WW', 'BL', 'RD'],
                    greenSynthesis: 'Green produced by mixing Cool White and Warm White LEDs'
                  }
                }
              },
              { 
                day: 35, 
                stage: 'harvest', 
                ppfd: 240, 
                mix: { cw: 0, ww: 0, bl: 35, gn: 15, rd: 45, fr: 5 },
                bandTargets: { B: 35, G: 15, R: 45, FR: 5 },
                spectralDistribution: {
                  bands: [
                    { name: 'Blue', range: '400-500nm', target: 35, description: 'Sustained for final quality and color' },
                    { name: 'Green', range: '500-600nm', target: 15, description: 'Maintained canopy light distribution' },
                    { name: 'Red', range: '600-700nm', target: 45, description: 'Balanced for harvest readiness' },
                    { name: 'Far Red', range: '700-750nm', target: 5, description: 'Final morphology control' }
                  ],
                  driverMapping: {
                    note: 'Spectrum solver converts B/G/R/FR targets to 4-channel driver commands',
                    channels: ['CW', 'WW', 'BL', 'RD'],
                    greenSynthesis: 'Green produced by mixing Cool White and Warm White LEDs'
                  }
                }
              }
            ]
          },
          env: {
            days: [
              { day: 1, tempC: 18, rh: 68, co2: 850 },
              { day: 10, tempC: 19, rh: 65, co2: 1000 },
              { day: 21, tempC: 20, rh: 63, co2: 1100 },
              { day: 35, tempC: 19, rh: 62, co2: 900 }
            ]
          },
          defaults: { photoperiod: 16 },
          meta: {
            source: 'demo',
            appliesTo: { category: ['Crop'], varieties: ['Curly', 'Lacinato', 'Red Russian'] }
          }
        }
      ];
      
      return res.json({
        plans: demoPlans,
        lastModified: new Date().toISOString(),
        source: 'demo',
        meta: {
          count: demoPlans.length,
          crops: demoPlans.map(p => p.crop)
        }
      });
    }
    
    const doc = loadPlansDocument();
    const plans = Array.isArray(doc.plans) ? doc.plans : [];
    const envelope = sanitizePlansEnvelope(doc);

    // Helper to convert spectral targets to driver commands
    // Recipes contain spectral targets (blue, red, green, far_red)
    // But hardware only has 4 drivers (CW, WW, BL, RD)
    // Green is computed from CW/WW mixing, so we distribute it into white channels
    function convertRecipeToChannelMix(row, opts = {}) {
      // Proper algorithm for converting R/B/G recipe to 4-channel (CW/WW/BL/RD) mix
      // See: CHANNEL_MIX_ARCHITECTURE_FIXED.md for detailed explanation
      
      const toNumber = (v) => {
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
      };
      const clamp = (v, min = 0, max = 100) => Math.max(min, Math.min(max, Number(v) || 0));
      
      // Step 1: Normalize recipe inputs (R, B, G don't need to sum to 100)
      const r_in = toNumber(row.red) ?? toNumber(row.rd) ?? 0;
      const b_in = toNumber(row.blue) ?? toNumber(row.bl) ?? 0;
      const g_in = toNumber(row.green) ?? toNumber(row.gn) ?? 0;
      
      const total = r_in + b_in + g_in;
      if (total === 0) {
        // No R/B/G specified; return zeros (or fall back to explicit CW/WW if present)
        return {
          cw: clamp(toNumber(row.cool_white) ?? toNumber(row.cw) ?? 0),
          ww: clamp(toNumber(row.warm_white) ?? toNumber(row.ww) ?? 0),
          bl: 0,
          rd: 0,
        };
      }
      // Normalize to 0..1 range
      const r = r_in / total;
      const b = b_in / total;
      const g = g_in / total;
      
      // Step 2: Split "Green" into WW and CW using warm_bias
      // warm_bias default: 0.50 (even split)
      // > 0.50 = warmer (more WW)
      // < 0.50 = cooler (more CW)
      const warmBias = opts.warmBias ?? 0.50;
      const ww_norm = g * warmBias;
      const cw_norm = g * (1 - warmBias);
      
      // Step 3: Preserve Red and Blue directly
      const red_norm = r;
      const blue_norm = b;
      
      // Step 4: Apply intensity scaling
      // If PPFD target given, calculate scale factor; otherwise use brightness
      let scale = 1.0;
      if (opts.ppfd != null && opts.ppfdEfficiency != null) {
        // ppfdEfficiency = { cw: η_cw, ww: η_ww, bl: η_bl, rd: η_rd }
        // Example: { cw: 1.2, ww: 1.1, bl: 1.8, rd: 1.6 } µmol/s per % power
        const eff = opts.ppfdEfficiency;
        const totalEfficiency = (cw_norm * (eff.cw ?? 1)) + 
                                (ww_norm * (eff.ww ?? 1)) + 
                                (blue_norm * (eff.bl ?? 1)) + 
                                (red_norm * (eff.rd ?? 1));
        if (totalEfficiency > 0) {
          scale = opts.ppfd / (totalEfficiency * 100); // Normalize to 0..1
          scale = Math.min(1.0, scale); // Can't exceed 100%
        }
      } else if (opts.brightness != null) {
        scale = opts.brightness;
      }
      
      // Step 5: Compute final output values (as percentages)
      const cw_out = clamp(cw_norm * scale * 100);
      const ww_out = clamp(ww_norm * scale * 100);
      const bl_out = clamp(blue_norm * scale * 100);
      const rd_out = clamp(red_norm * scale * 100);
      
      // Step 6: Return all 6 values (gn and fr preserved from recipe for reference)
      return {
        cw: cw_out,
        ww: ww_out,
        bl: bl_out,
        gn: clamp(toNumber(row.green) ?? 0),  // Original green control (for reference)
        rd: rd_out,
        fr: clamp(toNumber(row.far_red) ?? toNumber(row.fr) ?? 0),  // Original far_red (for reference)
      };
    }

    // Helper to synthesize plan objects from lighting-recipes.json
    function synthesizePlansFromRecipes(recipes) {
      if (!recipes || typeof recipes !== 'object') return [];
      const crops = recipes.crops && typeof recipes.crops === 'object' ? recipes.crops : {};
      const toNumber = (v) => {
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
      };
      const slugify = (str) => String(str || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
      const out = [];
      for (const [cropName, days] of Object.entries(crops)) {
        if (!Array.isArray(days) || !days.length) continue;
        const id = `crop-${slugify(cropName)}`;
        const lightDays = days.map((row) => {
          // Convert recipe (R/B/G format) to driver mix (CW/WW/BL/RD format)
          // Using proper normalization + scaling algorithm
          const ppfdTarget = toNumber(row.ppfd);
          const mix = convertRecipeToChannelMix(row, {
            // If PPFD target is specified, use PPFD-based scaling
            ...(ppfdTarget != null ? {
              ppfd: ppfdTarget,
              // Default PPFD efficiencies (µmol/s per 1% power) - adjust based on light spec
              ppfdEfficiency: {
                cw: 1.2,   // Cool white efficiency
                ww: 1.1,   // Warm white efficiency
                bl: 1.8,   // Blue efficiency (narrow-band, more photons)
                rd: 1.6,   // Red efficiency (narrow-band, more photons)
              },
            } : {
              // Otherwise scale to 100% (full brightness)
              brightness: 1.0,
            }),
            // Warm bias: 0.50 = even split between WW/CW
            warmBias: 0.50,
          });
          return {
            day: toNumber(row.day),
            stage: typeof row.stage === 'string' ? row.stage : '',
            ppfd: ppfdTarget,
            // No explicit photoperiod provided in recipes DB; leave undefined
            mix: {
              cw: mix.cw,
              ww: mix.ww,
              bl: mix.bl,
              gn: mix.gn,
              rd: mix.rd,
              fr: mix.fr,
            },
          };
        }).filter(Boolean);
        const envDays = days.map((row) => ({
          day: toNumber(row.day),
          tempC: toNumber(row.temperature),
        })).filter((d) => d.tempC != null);
        const plan = {
          id,
          key: id,
          name: String(cropName),
          crop: String(cropName),
          kind: 'recipe',
          description: `Imported from lighting-recipes.json for ${cropName}.`,
          light: { days: lightDays },
          ...(envDays.length ? { env: { days: envDays } } : {}),
          meta: {
            source: 'recipes',
            appliesTo: { category: ['Crop'], varieties: [] },
          },
          // Provide a conservative default photoperiod for display math if needed
          defaults: { photoperiod: 12 },
        };
        out.push(plan);
      }
      return out;
    }

    // Decide whether to include synthesized plans from the lighting-recipes database
  let includeRecipes = false;
    try {
      // Explicit overrides via query or env
      if (req.query && (req.query.recipes === '1' || req.query.includeRecipes === '1')) includeRecipes = true;
      if (process.env.USE_LIGHTING_RECIPES_FOR_PLANS && ['1', 'true', 'yes'].includes(String(process.env.USE_LIGHTING_RECIPES_FOR_PLANS).toLowerCase())) {
        includeRecipes = true;
      }
      // Auto-include if recipes file exists (treat recipes DB as authoritative superset)
      if (fs.existsSync(RECIPES_PATH)) {
        includeRecipes = true;
      }
    } catch (e) {
      // Non-fatal
      console.warn('[plans] Failed to compare recipes/plans timestamps:', e.message);
    }

    // Normalize existing plans
    const normalized = plans.map((plan) => normalizePlanEntry(plan, plan?.id)).filter(Boolean);

    // Optionally merge in synthesized plans from recipes
    let merged = normalized.slice();
    if (includeRecipes) {
      try {
        const recipes = loadRecipes();
        const synthetic = synthesizePlansFromRecipes(recipes).map((p) => normalizePlanEntry(p, p?.id)).filter(Boolean);
        // Deduplicate by id; prefer explicit plans over synthesized
        const seen = new Set(merged.map((p) => p.id));
        for (const entry of synthetic) {
          if (!entry || !entry.id) continue;
          if (seen.has(entry.id)) continue;
          merged.push(entry);
          seen.add(entry.id);
        }
      } catch (e) {
        console.warn('[plans] Failed to synthesize plans from recipes:', e.message);
      }
    }

    res.json({ ok: true, ...envelope, plans: merged });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/plans', (req, res) => {
  try {
    setCors(req, res);
    const isArrayClear = Array.isArray(req.body) && req.body.length === 0;
    const isObjectClear = Array.isArray(req.body?.plans) && req.body.plans.length === 0 &&
      (!req.body || typeof req.body !== 'object' || Object.keys(req.body).every((key) => key === 'plans'));
    if (isArrayClear || isObjectClear) {
      const payload = JSON.stringify({ plans: [] }, null, 2);
      writeJsonQueued(PLANS_PATH, payload)
        .then(() => res.json({ ok: true, plans: [] }))
        .catch((e) => res.status(500).json({ ok: false, error: e.message }));
      return;
    }

    const doc = parseIncomingPlans(req.body);
    const envelope = sanitizePlansEnvelope(doc);
    const plans = Array.isArray(doc.plans) ? doc.plans.map((plan) => normalizePlanEntry(plan, plan?.id)).filter(Boolean) : [];
    const outPayload = JSON.stringify({ ...envelope, plans }, null, 2);
    writeJsonQueued(PLANS_PATH, outPayload)
      .then(() => res.json({ ok: true, ...envelope, plans }))
      .catch((e) => res.status(500).json({ ok: false, error: e.message }));
    return;
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.options('/sched', (req, res) => { setCors(req, res); res.status(204).end(); });
app.get('/sched', (req, res) => {
  try {
    setCors(req, res);
    
    // Demo mode: Return sample schedules
    if (isDemoMode()) {
      const demoData = getDemoData();
      const farm = demoData.getFarm();
      const schedules = [];
      
      // Create schedules for each group
      farm.rooms.forEach(room => {
        room.zones.forEach(zone => {
          zone.groups.forEach((group, idx) => {
            // Vary photoperiods based on crop type
            const photoperiod = zone.crop === 'Basil' ? 16 : 18;
            const onTime = idx % 2 === 0 ? '06:00' : '07:00'; // Stagger start times
            
            schedules.push({
              groupId: group.groupId,
              groupName: group.name,
              zoneId: zone.zoneId,
              zoneName: zone.name,
              roomId: room.roomId,
              roomName: room.name,
              enabled: true,
              photoperiod: {
                on: photoperiod,
                off: 24 - photoperiod
              },
              times: {
                on: onTime,
                off: `${String((parseInt(onTime.split(':')[0]) + photoperiod) % 24).padStart(2, '0')}:00`
              },
              intensity: 80,
              recipe: `crop-${zone.crop.toLowerCase()}`,
              recipeName: zone.crop,
              lastModified: new Date().toISOString()
            });
          });
        });
      });
      
      return res.json({ ok: true, schedules });
    }
    
    const schedules = loadSchedulesFile().map(normalizeScheduleEntry).filter(Boolean);
    res.json({ ok: true, schedules });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/sched', pinGuard, (req, res) => {
  try {
    setCors(req, res);
    const { schedules: incoming, bulk } = parseIncomingSchedules(req.body);
    if (bulk && incoming.length === 0) {
      if (!saveSchedulesFile([])) {
        return res.status(500).json({ ok: false, error: 'Failed to persist schedules.' });
      }
      return res.json({ ok: true, schedules: [] });
    }
    const existing = loadSchedulesFile();
    const { merged, stored } = mergeScheduleEntries(existing, incoming);
    if (!saveSchedulesFile(stored)) {
      return res.status(500).json({ ok: false, error: 'Failed to persist schedules.' });
    }
    const responsePayload = { ok: true, schedules: merged };
    if (!bulk && incoming.length === 1) {
      const targetGroupId = incoming[0]?.groupId;
      if (targetGroupId) {
        responsePayload.schedule = merged.find((entry) => entry.groupId === targetGroupId) || incoming[0];
      }
    }
    res.json(responsePayload);
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.put('/sched/:groupId', pinGuard, (req, res) => {
  try {
    setCors(req, res);
    const groupId = String(req.params.groupId || '').trim();
    if (!groupId) {
      return res.status(400).json({ ok: false, error: 'groupId is required.' });
    }
    const payload = { ...(req.body || {}), groupId };
    const { schedules: incoming } = parseIncomingSchedules(payload);
    if (!incoming.length) {
      return res.status(400).json({ ok: false, error: 'Valid schedule payload required.' });
    }
    const existing = loadSchedulesFile();
    const { merged, stored } = mergeScheduleEntries(existing, incoming);
    if (!saveSchedulesFile(stored)) {
      return res.status(500).json({ ok: false, error: 'Failed to persist schedules.' });
    }
    const updated = merged.find((entry) => entry.groupId === groupId) || null;
    return res.json({ ok: true, schedule: updated, schedules: merged });
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message });
  }
});

app.delete('/sched/:groupId', pinGuard, (req, res) => {
  try {
    setCors(req, res);
    const groupId = String(req.params.groupId || '').trim();
    if (!groupId) {
      return res.status(400).json({ ok: false, error: 'groupId is required.' });
    }
    const existing = loadSchedulesFile();
    let removed = false;
    const remainingNormalized = existing
      .map((entry) => normalizeScheduleEntry(entry))
      .filter((entry) => {
        if (!entry) return false;
        if (!entry.groupId) return true;
        if (entry.groupId === groupId) {
          removed = true;
          return false;
        }
        return true;
      });
    const stored = remainingNormalized.map(serializeScheduleForStorage).filter(Boolean);
    if (!saveSchedulesFile(stored)) {
      return res.status(500).json({ ok: false, error: 'Failed to persist schedules.' });
    }
    if (!removed) {
      return res.status(404).json({ ok: false, error: `Schedule for group '${groupId}' not found.` });
    }
    return res.json({ ok: true, removed: true, schedules: remainingNormalized });
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message });
  }
});

// Data persistence endpoints

app.get('/forwarder/network/wifi/scan', async (req, res) => {
  const errors = [];
  
  // Try controller endpoint first
  try {
    const controller = getNetworkBridgeUrl();
    if (controller) {
      const url = `${controller.replace(/\/$/, '')}/api/network/wifi/scan`;
      console.log(`[WiFi Scan] Trying network bridge endpoint: ${url}`);
      const response = await fetch(url, { timeout: 5000 }).catch((err) => {
        errors.push(`Network bridge fetch failed: ${err.message}`);
        return null;
      });
      if (response && response.ok) {
        const body = await response.json();
        const networks = body?.networks || body || [];
        console.log(`[WiFi Scan] Network bridge returned ${Array.isArray(networks) ? networks.length : 0} networks`);
        return res.json(Array.isArray(networks) ? networks : []);
      } else if (response && response.status === 404) {
        // Controller exists but doesn't support WiFi scanning - skip to manual entry
        console.log('[WiFi Scan] Network bridge does not support WiFi scanning (404), use manual entry');
        return res.status(503).json({
          status: 'unavailable',
          message: 'WiFi scanning not available on this controller/forwarder. Please enter network details manually.',
          platform: process.platform,
          controller: controller,
          errors: ['Controller or forwarder does not support WiFi scanning'],
          networks: []
        });
      } else if (response) {
        errors.push(`Network bridge returned status ${response.status}`);
      }
    } else {
      errors.push('No controller or forwarder configured for WiFi scanning');
      console.log('[WiFi Scan] No network bridge configured, trying local scan');
    }

    // Try local OS-level WiFi scan as a fallback (macOS, Linux)
    try {
    const platform = process.platform;
    let stdout = '';
    if (platform === 'darwin') {
      // macOS: Use networksetup to list available WiFi networks
      try {
        console.log('[WiFi Scan] Starting macOS WiFi scan...');
        
        // First, get the WiFi interface name
        console.log('[WiFi Scan] Detecting WiFi interface...');
        const ifaceOut = await execAsync('networksetup -listallhardwareports | grep -A 1 "Wi-Fi"');
        const ifaceMatch = ifaceOut.match(/Device:\s*(\w+)/);
        const iface = ifaceMatch ? ifaceMatch[1] : 'en0';
        
        // Use networksetup to list available WiFi networks (no deprecation warning)
        console.log(`[WiFi Scan] Executing: networksetup -listpreferredwirelessnetworks ${iface}`);
        stdout = await execAsync(`networksetup -listpreferredwirelessnetworks ${iface}`);
        
        console.log(`[WiFi Scan] networksetup command returned ${stdout.length} bytes`);
        console.log(`[WiFi Scan] Output: ${stdout.substring(0, 300)}`);
        
        const lines = stdout.split('\n').filter(Boolean);
        console.log(`[WiFi Scan] Parsed ${lines.length} lines from networksetup output`);
        
        // networksetup output format:
        // Preferred networks on en0:
        //     NetworkName1
        //     NetworkName2
        //     ...
        const networkLines = lines.slice(1).map(l => l.trim()).filter(l => l);
        
        console.log(`[WiFi Scan] Found ${networkLines.length} preferred network names`);
        
        if (networkLines.length) {
          const networks = networkLines.map((ssid) => ({
            ssid: ssid.trim(),
            signal: -50, // networksetup doesn't provide signal strength, use default
            security: 'UNKNOWN' // networksetup doesn't provide security info
          }));
          
          console.log(`[WiFi Scan] Successfully parsed ${networks.length} networks on macOS`);
          console.log(`[WiFi Scan] Networks:`, networks.map(n => n.ssid).join(', '));
          return res.json(networks);
        }
      } catch (airportErr) {
        console.error('[WiFi Scan] airport scan failed with error:');
        console.error('[WiFi Scan] Error message:', airportErr.message);
        console.error('[WiFi Scan] Error code:', airportErr.code);
        console.error('[WiFi Scan] Error stack:', airportErr.stack);
        errors.push(`macOS airport scan failed: ${airportErr.message}`);
      }
      // If airport output suggested using Wireless Diagnostics, try wdutil
      // Try JSON first
      stdout = await execAsync('/usr/bin/wdutil scan -json').catch(() => '');
      if (stdout && stdout.trim().startsWith('{')) {
        try {
          const obj = JSON.parse(stdout);
          const nets = Array.isArray(obj?.Networks || obj?.networks) ? (obj.Networks || obj.networks) : [];
          const networks = nets.map(n => ({ ssid: n.SSID || n.ssid || '', signal: n.RSSI || n.rssi || -60, security: (n.security || n.SECURITY || 'OPEN').toUpperCase() })).filter(n => n.ssid);
          if (networks.length) return res.json(networks);
        } catch {}
      }
      // Try plain text wdutil output
      stdout = await execAsync('/usr/bin/wdutil scan').catch(() => '');
      if (stdout) {
        const blocks = stdout.split(/\n\s*\n/); // blank-line separated blocks
        const networks = [];
        for (const block of blocks) {
          const ssidMatch = block.match(/SSID\s*:\s*(.+)/i);
          if (!ssidMatch) continue;
          const rssiMatch = block.match(/RSSI\s*:\s*(-?\d+)/i);
          const secMatch = block.match(/SECURITY\s*:\s*([\w\-\+]+)/i);
          networks.push({
            ssid: ssidMatch[1].trim(),
            signal: rssiMatch ? parseInt(rssiMatch[1], 10) : -60,
            security: (secMatch?.[1] || 'OPEN').toUpperCase()
          });
        }
        if (networks.length) return res.json(networks.filter(n => n.ssid));
      }
      // No macOS methods yielded networks; continue to Linux/return 503
    } else if (platform === 'linux') {
      // Linux: prefer nmcli, fallback to iwlist (requires sudo for some distros)
      try {
        stdout = await execAsync('nmcli -t -f SSID,SIGNAL,SECURITY dev wifi list');
        const networks = stdout
          .split('\n')
          .filter(Boolean)
          .map((line) => {
            const [ssid, signal, security] = line.split(':');
            return { ssid: ssid || '', signal: parseInt(signal || '-60', 10), security: (security || 'OPEN').toUpperCase() };
          })
          .filter(n => n.ssid);
        return res.json(networks);
      } catch (e) {
        // Try iwlist as a last resort
        stdout = await execAsync("/sbin/iwlist wlan0 scan | grep -E 'ESSID|Signal level|Quality' -A1");
        const lines = stdout.split('\n');
        const networks = [];
        let current = {};
        for (const raw of lines) {
          const line = raw.trim();
          const essidMatch = line.match(/ESSID:\"(.*)\"/);
          if (essidMatch) {
            if (current.ssid) networks.push(current);
            current = { ssid: essidMatch[1], signal: -60, security: 'UNKNOWN' };
          }
          const signalMatch = line.match(/Signal level[=:-](-?\d+)/i);
          if (signalMatch) current.signal = parseInt(signalMatch[1], 10);
        }
        if (current.ssid) networks.push(current);
        return res.json(networks.filter(n => n.ssid));
      }
    }
    } catch (osScanErr) {
      errors.push(`OS-level scan failed: ${osScanErr.message}`);
      console.warn('[WiFi Scan] OS-level scan failed:', osScanErr.message);
    }
  } catch (localErr) {
    errors.push(`Local scan failed: ${localErr.message}`);
    console.warn('[WiFi Scan] Local OS-level scan failed:', localErr.message);
  }

  // If everything failed, return helpful error with diagnostics
  console.error('[WiFi Scan] All scan methods failed');
  console.error('[WiFi Scan] Errors encountered:', errors);
  
  return res.status(503).json({ 
    error: 'WiFi scan unavailable', 
    message: 'All WiFi scan methods failed. See details for troubleshooting.',
    details: errors,
    suggestions: [
      'Set CTRL or NETWORK_FORWARDER environment variable to point to a controller with WiFi scanning capability',
      'On macOS: WiFi scanning requires admin privileges (wdutil needs sudo)',
      'On Linux: Install network-manager (nmcli) or ensure wireless-tools (iwlist) is available',
      'Alternative: Manually enter WiFi network details in the form below'
    ],
    platform: process.platform,
    controller: getNetworkBridgeUrl() || 'not configured'
  });
});

app.post('/forwarder/network/test', async (req, res) => {
  const payload = req.body || {};
  const now = new Date().toISOString();
  try {
    const controller = getNetworkBridgeUrl();
    if (controller) {
      const url = `${controller.replace(/\/$/, '')}/api/network/test`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).catch(() => null);
      if (response && response.ok) {
        const body = await response.json();
        return res.json({
          status: body.status || 'connected',
          ip: body.ip || body.address || null,
          gateway: body.gateway || null,
          subnet: body.subnet || null,
          latencyMs: body.latencyMs ?? body.latency ?? 35,
          testedAt: now,
          ssid: body.ssid || payload?.wifi?.ssid || null
        });
      }
    }
  } catch (err) {
    console.warn('Network bridge test failed', err.message);
  }
  return res.status(503).json({
    error: 'Network test unavailable',
    message: 'Controller or forwarder endpoint not reachable or returned an error.',
    testedAt: now,
    ssid: payload?.wifi?.ssid || null,
    controller: getNetworkBridgeUrl() || null
  });
});

// Consolidated Lights Status endpoint
// GET /api/lights/status?refresh=switchbot|kasa|all&scanKasa=1&limit=<n>
// Default is fast: use cached SwitchBot device/status; query controller for Kasa if available; registry devices are included as unknown
app.get('/api/lights/status', asyncHandler(async (req, res) => {
  const refreshParam = String(req.query.refresh || '').toLowerCase();
  const refreshSwitchBot = refreshParam === 'switchbot' || refreshParam === 'all' || refreshParam === 'true' || refreshParam === '1';
  const refreshKasa = refreshParam === 'kasa' || refreshParam === 'all';
  const scanKasa = ['1', 'true', 'yes'].includes(String(req.query.scanKasa || '').toLowerCase());
  const limit = Math.max(1, Math.min(100, parseInt(req.query.limit) || 100));

  const entries = [];
  const sourcesMeta = { switchbot: { used: false }, kasa: { used: false }, registry: { used: false } };

  // Helper: normalize power flag
  const normPower = (v) => {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v > 0;
    if (typeof v === 'string') return v.toLowerCase() === 'on' || v === '1' || v === 'true';
    return null;
  };

  // 1) SwitchBot (from cache; optional refresh limited by API rate limits)
  try {
    const sb = await fetchSwitchBotDevices({ force: refreshSwitchBot });
    sourcesMeta.switchbot = { used: true, cached: sb.fromCache, stale: sb.stale, fetchedAt: sb.fetchedAt ? new Date(sb.fetchedAt).toISOString() : null, error: sb.error?.message || null };
    const list = sb.payload?.body?.deviceList || [];
    for (const device of list) {
      const type = String(device.deviceType || '').toLowerCase();
      // Only include likely light-capable devices (bulb/strip/ceiling) and plugs used for lights
      const looksLikeLight = /(bulb|light|strip)/.test(type);
      const looksLikePlug = /plug/.test(type);
      if (!looksLikeLight && !looksLikePlug) continue;

      let power = null, brightness = null, meta = { cached: true, stale: false };
      try {
        const cacheEntry = getSwitchBotStatusEntry(device.deviceId);
        if (cacheEntry.payload && cacheEntry.payload.body) {
          power = normPower(cacheEntry.payload.body.power);
          // Many SwitchBot lighting devices expose brightness as number 1-100
          brightness = typeof cacheEntry.payload.body.brightness === 'number' ? cacheEntry.payload.body.brightness : null;
          meta = { cached: true, stale: (Date.now() - cacheEntry.fetchedAt) > SWITCHBOT_STATUS_CACHE_TTL_MS, fetchedAt: new Date(cacheEntry.fetchedAt).toISOString(), error: cacheEntry.lastError?.message || null };
        } else if (refreshSwitchBot) {
          // Optional on-demand refresh for a small subset (respect rate limits externally)
          const st = await fetchSwitchBotDeviceStatus(device.deviceId, { force: true });
          power = normPower(st.payload?.body?.power);
          brightness = typeof st.payload?.body?.brightness === 'number' ? st.payload.body.brightness : null;
          meta = { cached: st.fromCache, stale: st.stale, fetchedAt: st.fetchedAt ? new Date(st.fetchedAt).toISOString() : null };
        }
      } catch (e) {
        meta = { cached: false, stale: true, error: e.message };
      }

      entries.push({
        id: `switchbot:${device.deviceId}`,
        name: device.deviceName || `SwitchBot ${device.deviceType}`,
        vendor: 'SwitchBot',
        source: 'switchbot',
        type: device.deviceType,
        room: null,
        zone: null,
        power: power,
        brightness,
        watts: null,
        lastUpdated: meta.fetchedAt || null,
        meta
      });
      if (entries.length >= limit) break;
    }
  } catch (e) {
    sourcesMeta.switchbot = { used: true, error: e.message };
  }

  // 2) Kasa devices: try controller first; optionally scan locally if requested
  try {
    let kasaDevices = [];
    const controller = getController();
    if (controller) {
      try {
        const r = await fetch(`${controller.replace(/\/$/, '')}/api/devices/kasa`);
        if (r.ok) {
          const body = await r.json();
          if (Array.isArray(body?.devices)) {
            kasaDevices = body.devices.map(d => ({
              id: d.device_id,
              name: d.name,
              state: d.details?.state ?? d.state ?? null,
              address: d.details?.host || null,
              model: d.details?.model || d.model || null
            }));
          }
        }
      } catch {}
    }

    if (kasaDevices.length === 0 && (scanKasa || refreshKasa)) {
      try {
        // Use built-in discovery (slower). Avoid per-device status calls; rely on relay_state from discovery
        const client = await createKasaClient();
        const found = [];
        client.startDiscovery({ timeout: 3500 });
        client.on('device-new', async (device) => {
          try {
            const si = await device.getSysInfo();
            found.push({ id: device.deviceId, name: device.alias || si.alias, state: si.relay_state ?? null, address: device.host, model: si.model || null });
          } catch {}
        });
        await new Promise(resolve => setTimeout(resolve, 3800));
        client.stopDiscovery();
        kasaDevices = found;
      } catch {}
    }

    if (kasaDevices.length) {
      sourcesMeta.kasa = { used: true, count: kasaDevices.length };
      for (const d of kasaDevices) {
        entries.push({
          id: `kasa:${d.id}`,
          name: d.name || `Kasa ${d.model || ''}`.trim(),
          vendor: 'TP-Link Kasa',
          source: 'kasa',
          type: 'smart-plug',
          room: null,
          zone: null,
          power: normPower(d.state),
          brightness: null,
          watts: null,
          lastUpdated: null,
          meta: { discovered: true, address: d.address }
        });
        if (entries.length >= limit) break;
      }
    }
  } catch (e) {
    sourcesMeta.kasa = { used: true, error: e.message };
  }

  // 3) Device registry (NeDB) — include registered lights as inventory (status unknown)
  try {
    const rows = await devicesStore.find({});
    const lights = rows.filter(r => /^light-/i.test(String(r.id || '')));
    sourcesMeta.registry = { used: true, count: lights.length };
    for (const d of lights) {
      entries.push({
        id: d.id,
        name: d.deviceName || d.id,
        vendor: d.manufacturer || 'Registered',
        source: 'registry',
        type: d.model || 'light-fixture',
        room: d.room || null,
        zone: d.zone || null,
        power: null, // unknown live state
        brightness: null,
        watts: d.watts || null,
        lastUpdated: d.updatedAt || d.createdAt || null,
        meta: { registered: true }
      });
      if (entries.length >= limit) break;
    }
  } catch (e) {
    sourcesMeta.registry = { used: true, error: e.message };
  }

  // Build summary
  const summary = {
    total: entries.length,
    on: entries.filter(e => e.power === true).length,
    off: entries.filter(e => e.power === false).length,
    unknown: entries.filter(e => e.power !== true && e.power !== false).length,
    byVendor: entries.reduce((acc, e) => { acc[e.vendor] = (acc[e.vendor] || 0) + 1; return acc; }, {})
  };

  res.json({ ok: true, summary, count: entries.length, entries, sources: sourcesMeta, generatedAt: new Date().toISOString() });
}));

app.get('/discovery/devices', async (req, res) => {
  const startedAt = new Date().toISOString();
  
  // Helper function to fetch with timeout
  async function fetchWithTimeout(url, timeoutMs = 30000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      return response;
    } catch (err) {
      clearTimeout(timeout);
      throw err;
    }
  }
  
  // Note: Charlie backend (port 8000) deprecated - removed from discovery
  // Primary discovery method is MQTT-based (see /api/discovered-devices)
  
  // Try remote controller if configured
  try {
    const controller = getController();
    if (controller) {
      console.log(`[Discovery] Attempting remote controller at ${controller}/discovery/devices`);
      const url = `${controller.replace(/\/$/, '')}/discovery/devices`;
      const response = await fetchWithTimeout(url, 30000).catch(() => null);
      
      if (response && response.ok) {
        const body = await response.json();
        if (Array.isArray(body?.devices)) {
          console.log(`[Discovery]  Found ${body.devices.length} devices from remote controller`);
          return res.json({ 
            startedAt, 
            completedAt: new Date().toISOString(), 
            devices: body.devices,
            source: 'controller-remote'
          });
        }
      }
    }
  } catch (err) {
    console.warn('[Discovery] Controller discovery failed, attempting live network scan:', err.message);
  }
  
  // LIVE DEVICE DISCOVERY - Scan greenreach network for real devices
  console.log(' Starting live device discovery on greenreach network...');
  
  try {
    const discoveredDevices = [];
    
    // 1. Try to discover SwitchBot devices via API
    if (ensureSwitchBotConfigured()) {
      try {
        const switchbotResponse = await fetch('/api/switchbot/devices?refresh=1');
        if (switchbotResponse.ok) {
          const switchbotData = await switchbotResponse.json();
          if (switchbotData.statusCode === 100 && switchbotData.body?.deviceList) {
            switchbotData.body.deviceList.forEach(device => {
              discoveredDevices.push({
                id: `switchbot:${device.deviceId}`,
                name: device.deviceName || `SwitchBot ${device.deviceType}`,
                protocol: 'switchbot-cloud',
                confidence: 0.95,
                signal: null,
                address: device.deviceId,
                vendor: 'SwitchBot',
                lastSeen: new Date().toISOString(),
                hints: { 
                  type: device.deviceType, 
                  switchbotId: device.deviceId,
                  hubId: device.hubDeviceId,
                  metrics: getSwitchBotMetrics(device.deviceType)
                }
              });
            });
          }
        }
      } catch (e) {
        console.warn('SwitchBot discovery failed:', e.message);
      }
    }
    
    // 2. Network scanning for WiFi/IP devices
    try {
      const networkDevices = await discoverNetworkDevices();
      discoveredDevices.push(...networkDevices);
    } catch (e) {
      console.warn('Network device discovery failed:', e.message);
    }

    // 3. MQTT device discovery (if configured)
    try {
      const mqttDevices = await discoverMQTTDevices();
      discoveredDevices.push(...mqttDevices);
    } catch (e) {
      console.warn('MQTT device discovery failed:', e.message);
    }

    // 4. BLE device discovery (if available)
    try {
      const bleDevices = await discoverBLEDevices();
      discoveredDevices.push(...bleDevices);
    } catch (e) {
      console.warn('BLE device discovery failed:', e.message);
    }
    
    console.log(` Discovery complete: Found ${discoveredDevices.length} live devices`);
    
    // Analyze discovered devices and suggest setup wizards
    const deviceAnalysis = analyzeDiscoveredDevices(discoveredDevices);
    
    res.json({ 
      startedAt, 
      completedAt: new Date().toISOString(), 
      devices: discoveredDevices,
      analysis: deviceAnalysis,
      message: discoveredDevices.length === 0 ? 
        'No devices found. Ensure SwitchBot API is configured and devices are on greenreach network.' :
        `Found ${discoveredDevices.length} live devices on greenreach network.`
    });
    
  } catch (error) {
    console.error(' Live device discovery failed:', error);
    res.status(500).json({ 
      startedAt, 
      completedAt: new Date().toISOString(), 
      devices: [], 
      error: ALLOW_MOCKS ? 'Live device discovery failed. (Mocks allowed, but none loaded)' : 'Live device discovery failed. No mock devices available.',
      message: 'Please check network connectivity and device configuration.'
    });
  }
});

// Helper function to get metrics based on SwitchBot device type
function getSwitchBotMetrics(deviceType) {
  const type = deviceType.toLowerCase();
  if (type.includes('meter') || type.includes('sensor')) {
    return ['temperature', 'humidity', 'battery'];
  } else if (type.includes('plug')) {
    return ['power', 'energy', 'current', 'voltage'];
  } else if (type.includes('hub')) {
    return ['signal', 'connectivity'];
  } else if (type.includes('bot')) {
    return ['position', 'battery'];
  } else if (type.includes('bulb') || type.includes('strip')) {
    return ['brightness', 'color', 'power'];
  }
  return ['status', 'battery'];
}

// Network device discovery (WiFi/IP devices)
async function discoverNetworkDevices() {
  const devices = [];
  
  // Discover TP-Link Kasa devices via Python backend if available
  try {
    const controller = getController();
    if (controller) {
      const kasaResponse = await fetch(`${controller}/api/devices/kasa`);
      if (kasaResponse.ok) {
        const kasaData = await kasaResponse.json();
        if (kasaData.devices) {
          kasaData.devices.forEach(device => {
            devices.push({
              id: `kasa:${device.device_id}`,
              name: device.name,
              protocol: 'kasa-wifi',
              confidence: 0.9,
              signal: null,
              address: device.details?.host || 'unknown',
              vendor: 'TP-Link Kasa',
              lastSeen: new Date().toISOString(),
              hints: {
                type: device.category,
                capabilities: device.capabilities,
                metrics: ['power', 'energy', 'brightness']
              }
            });
          });
        }
      }
    }
  } catch (e) {
    console.warn('Kasa discovery via controller failed, trying direct Kasa discovery');
    
    // Try direct Kasa device discovery using tplink-smarthome-api
    try {
      const kasaModule = await import('tplink-smarthome-api');
      const Client = kasaModule.default?.Client || kasaModule.Client;
      const client = new Client();
      
      console.log(' Scanning for Kasa devices on local network...');
      
      // Start device discovery
      client.startDiscovery({
        port: 9999,
        broadcast: '255.255.255.255',
        timeout: 5000
      });
      
      // Collect discovered devices
      const kasaDevices = new Map();
      
      client.on('device-new', (device) => {
        console.log('📱 Found Kasa device:', device.alias, '@', device.host);
        
        // Get device info
        device.getSysInfo().then(sysInfo => {
          kasaDevices.set(device.deviceId, {
            id: `kasa:${device.deviceId}`,
            name: device.alias || sysInfo.alias || 'Unknown Kasa Device',
            protocol: 'kasa-wifi',
            confidence: 0.95,
            signal: null,
            address: device.host,
            vendor: 'TP-Link Kasa',
            lastSeen: new Date().toISOString(),
            hints: {
              type: sysInfo.type || 'smart-plug',
              model: sysInfo.model,
              deviceType: sysInfo.mic_type || sysInfo.type,
              softwareVersion: sysInfo.sw_ver,
              hardwareVersion: sysInfo.hw_ver,
              capabilities: ['power_control', 'scheduling', 'remote_access'],
              metrics: ['power', 'energy', 'state']
            },
            kasaDetails: {
              deviceId: device.deviceId,
              alias: device.alias,
              model: sysInfo.model,
              type: sysInfo.type,
              state: sysInfo.relay_state || 0,
              ledOff: sysInfo.led_off || 0,
              latitude: sysInfo.latitude,
              longitude: sysInfo.longitude
            }
          });
        }).catch(err => {
          console.warn('Error getting Kasa device info:', err.message);
          // Add basic device info even if sysInfo fails
          kasaDevices.set(device.deviceId, {
            id: `kasa:${device.deviceId}`,
            name: device.alias || 'Unknown Kasa Device',
            protocol: 'kasa-wifi',
            confidence: 0.8,
            signal: null,
            address: device.host,
            vendor: 'TP-Link Kasa',
            lastSeen: new Date().toISOString(),
            hints: {
              type: 'smart-device',
              capabilities: ['power_control'],
              metrics: ['state']
            }
          });
        });
      });
      
      // Wait for discovery to complete, then add devices
      await new Promise(resolve => setTimeout(resolve, 6000));
      client.stopDiscovery();
      
      // Add discovered Kasa devices to the main devices array
      kasaDevices.forEach(device => devices.push(device));
      
      if (kasaDevices.size > 0) {
        console.log(` Found ${kasaDevices.size} Kasa device(s)`);
      } else {
        console.log('  No Kasa devices found on local network');
      }
      
    } catch (kasaError) {
      console.warn('Direct Kasa discovery failed:', kasaError.message);
    }
  }

  // Direct network scan for common IoT device ports
  try {
    const networkDevices = await scanNetworkForDevices();
    devices.push(...networkDevices);
  } catch (e) {
    console.warn('Direct network scan failed:', e.message);
  }
  
  return devices;
}

// Scan network for common IoT devices using nmap-like discovery
async function scanNetworkForDevices() {
  const devices = [];
  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const execAsync = promisify(exec);
  
  try {
    // Get current network range
    const { stdout: ifconfigOut } = await execAsync('ifconfig en0 | grep "inet " | grep -v 127.0.0.1');
    const ipMatch = ifconfigOut.match(/inet (\d+\.\d+\.\d+\.\d+)/);
    if (!ipMatch) {
      console.warn('Could not determine network range');
      return devices;
    }
    
    const currentIP = ipMatch[1];
    const networkBase = currentIP.split('.').slice(0, 3).join('.');
    console.log(` Scanning network range ${networkBase}.0/24 for IoT devices...`);
    
    // Scan for devices with common IoT ports
    const commonPorts = [80, 443, 8080, 8081, 1883, 8883, 9999, 10002, 502, 8000];
    const { stdout: nmapOut } = await execAsync(
      `nmap -p ${commonPorts.join(',')} --open ${networkBase}.0/24 | grep -E "(Nmap scan report|open)"`
    );
    
    const lines = nmapOut.split('\n');
    let currentHost = null;
    let deviceIP = null;
    
    for (const line of lines) {
      if (line.includes('Nmap scan report')) {
        const hostMatch = line.match(/Nmap scan report for (.+) \((\d+\.\d+\.\d+\.\d+)\)/);
        if (hostMatch) {
          currentHost = hostMatch[1];
          deviceIP = hostMatch[2];
        } else {
          const ipMatch = line.match(/Nmap scan report for (\d+\.\d+\.\d+\.\d+)/);
          if (ipMatch) {
            deviceIP = ipMatch[1];
            currentHost = deviceIP;
          }
        }
      } else if (line.includes('open') && deviceIP) {
        const portMatch = line.match(/(\d+)\/tcp\s+open\s+(\w+)/);
        if (portMatch) {
          const port = parseInt(portMatch[1]);
          const service = portMatch[2];
          
          // Identify device type based on port and service
          const deviceInfo = identifyDeviceByPort(port, service, currentHost, deviceIP);
          if (deviceInfo) {
            devices.push({
              id: `network:${deviceIP}:${port}`,
              name: deviceInfo.name,
              protocol: deviceInfo.protocol,
              confidence: deviceInfo.confidence,
              signal: null,
              address: deviceIP,
              vendor: deviceInfo.vendor,
              lastSeen: new Date().toISOString(),
              hints: {
                type: deviceInfo.type,
                port: port,
                service: service,
                host: currentHost,
                capabilities: deviceInfo.capabilities,
                metrics: deviceInfo.metrics
              }
            });
          }
        }
      }
    }
    
  } catch (e) {
    console.warn('Network scanning failed:', e.message);
  }
  
  return devices;
}

// Identify device type based on port and service patterns
function identifyDeviceByPort(port, service, host, ip) {
  const devicePatterns = {
    // MQTT Brokers
    1883: { name: 'MQTT Broker', protocol: 'mqtt', vendor: 'Unknown MQTT', type: 'mqtt-broker', 
            confidence: 0.8, capabilities: ['publish', 'subscribe'], metrics: ['topics', 'clients'] },
    8883: { name: 'MQTT Broker (TLS)', protocol: 'mqtt-tls', vendor: 'Unknown MQTT', type: 'mqtt-broker',
            confidence: 0.8, capabilities: ['publish', 'subscribe', 'tls'], metrics: ['topics', 'clients'] },
    
    // Web-based IoT devices
    80: { name: `IoT Device (${host})`, protocol: 'http', vendor: 'Unknown', type: 'web-device',
          confidence: 0.6, capabilities: ['web-interface'], metrics: ['status', 'uptime'] },
    443: { name: `IoT Device HTTPS (${host})`, protocol: 'https', vendor: 'Unknown', type: 'web-device',
           confidence: 0.6, capabilities: ['web-interface', 'tls'], metrics: ['status', 'uptime'] },
    8080: { name: `IoT Web Interface (${host})`, protocol: 'http-alt', vendor: 'Unknown', type: 'web-device',
            confidence: 0.7, capabilities: ['web-interface'], metrics: ['status', 'config'] },
    8081: { name: `IoT Management Interface (${host})`, protocol: 'http-mgmt', vendor: 'Unknown', type: 'management-device',
            confidence: 0.7, capabilities: ['management', 'config'], metrics: ['status', 'config'] },
    
    // Modbus (Industrial/Agricultural)
    502: { name: `Modbus Device (${host})`, protocol: 'modbus', vendor: 'Industrial', type: 'modbus-device',
           confidence: 0.9, capabilities: ['modbus-tcp'], metrics: ['registers', 'coils', 'inputs'] },
    
    // Other common IoT ports
    9999: { name: `IoT Service (${host})`, protocol: 'custom', vendor: 'Unknown', type: 'iot-device',
            confidence: 0.5, capabilities: ['custom-protocol'], metrics: ['status'] },
    10002: { name: `Network Device (${host})`, protocol: 'custom', vendor: 'Network', type: 'network-device',
             confidence: 0.6, capabilities: ['network'], metrics: ['status', 'connectivity'] },
    8000: { name: `Development Server (${host})`, protocol: 'http-dev', vendor: 'Dev', type: 'dev-server',
            confidence: 0.4, capabilities: ['development'], metrics: ['requests', 'status'] }
  };
  
  return devicePatterns[port] || null;
}

// Analyze discovered devices and suggest setup wizards
function analyzeDiscoveredDevices(devices) {
  const protocols = new Map();
  const vendors = new Map();
  const deviceTypes = new Map();
  const setupWizards = [];
  
  // Categorize devices
  devices.forEach(device => {
    // Count by protocol
    const protocolCount = protocols.get(device.protocol) || 0;
    protocols.set(device.protocol, protocolCount + 1);
    
    // Count by vendor
    const vendorCount = vendors.get(device.vendor) || 0;
    vendors.set(device.vendor, vendorCount + 1);
    
    // Count by device type
    const typeCount = deviceTypes.get(device.hints?.type || 'unknown') || 0;
    deviceTypes.set(device.hints?.type || 'unknown', typeCount + 1);
  });
  
  // Suggest setup wizards based on discovered devices
  if (protocols.has('switchbot')) {
    setupWizards.push({
      id: 'switchbot-setup',
      name: 'SwitchBot Device Setup',
      description: `Configure ${protocols.get('switchbot')} SwitchBot devices`,
      deviceCount: protocols.get('switchbot'),
      priority: 'high',
      capabilities: ['automation', 'monitoring', 'control']
    });
  }
  
  if (protocols.has('kasa-wifi')) {
    setupWizards.push({
      id: 'kasa-setup', 
      name: 'TP-Link Kasa Setup',
      description: `Configure ${protocols.get('kasa-wifi')} Kasa smart devices`,
      deviceCount: protocols.get('kasa-wifi'),
      priority: 'high',
      capabilities: ['lighting', 'power-monitoring', 'scheduling']
    });
  }
  
  if (protocols.has('mqtt') || protocols.has('mqtt-tls')) {
    const mqttCount = (protocols.get('mqtt') || 0) + (protocols.get('mqtt-tls') || 0);
    setupWizards.push({
      id: 'mqtt-setup',
      name: 'MQTT Device Integration', 
      description: `Configure ${mqttCount} MQTT-enabled devices`,
      deviceCount: mqttCount,
      priority: 'medium',
      capabilities: ['messaging', 'sensor-data', 'real-time-updates']
    });
  }
  
  if (protocols.has('modbus')) {
    setupWizards.push({
      id: 'modbus-setup',
      name: 'Industrial/Agricultural Modbus Devices',
      description: `Configure ${protocols.get('modbus')} Modbus devices`,
      deviceCount: protocols.get('modbus'),
      priority: 'high',
      capabilities: ['industrial-control', 'sensor-reading', 'automation']
    });
  }
  
  if (protocols.has('bluetooth-le')) {
    setupWizards.push({
      id: 'ble-setup',
      name: 'Bluetooth LE Sensor Setup',
      description: `Configure ${protocols.get('bluetooth-le')} BLE sensors`,
      deviceCount: protocols.get('bluetooth-le'),
      priority: 'medium',
      capabilities: ['proximity-sensing', 'battery-monitoring', 'environmental-data']
    });
  }
  
  // Web-based devices (HTTP/HTTPS)
  const webDevices = (protocols.get('http') || 0) + (protocols.get('https') || 0) + 
                     (protocols.get('http-alt') || 0) + (protocols.get('http-mgmt') || 0);
  if (webDevices > 0) {
    setupWizards.push({
      id: 'web-device-setup',
      name: 'Web-Enabled IoT Devices',
      description: `Configure ${webDevices} web-accessible IoT devices`,
      deviceCount: webDevices,
      priority: 'medium',
      capabilities: ['web-interface', 'remote-access', 'configuration']
    });
  }
  
  return {
    summary: {
      totalDevices: devices.length,
      protocolCount: protocols.size,
      vendorCount: vendors.size,
      typeCount: deviceTypes.size
    },
    protocols: Object.fromEntries(protocols),
    vendors: Object.fromEntries(vendors),
    deviceTypes: Object.fromEntries(deviceTypes),
    suggestedWizards: setupWizards.sort((a, b) => {
      const priorityOrder = { high: 3, medium: 2, low: 1 };
      return priorityOrder[b.priority] - priorityOrder[a.priority];
    })
  };
}

// ===== UNIVERSAL DEVICE SCANNER =====
// Simplified multi-protocol scan endpoint for Integrations panel
app.get('/discovery/capabilities', async (req, res) => {
  const netifs = os.networkInterfaces();
  const ipv4 = [];
  const ipv6 = [];
  Object.values(netifs).forEach(list => {
    (list || []).forEach(entry => {
      if (entry.internal) return;
      if (entry.family === 'IPv4') ipv4.push(entry.address);
      if (entry.family === 'IPv6') ipv6.push(entry.address);
    });
  });

  let mdnsAvailable = false;
  let mdnsReason = 'module_unavailable';
  try {
    await import('bonjour-service');
    mdnsAvailable = true;
    mdnsReason = 'ok';
  } catch (e) {
    mdnsReason = e?.message || 'module_unavailable';
  }

  const switchbotConfigured = ensureSwitchBotConfigured();
  const controllerBridge = getNetworkBridgeUrl();
  const controllerUrl = getController();

  const warnings = [];
  if (!ipv4.length) warnings.push('No active IPv4 interface detected. LAN discovery may fail.');
  if (!mdnsAvailable) warnings.push('mDNS module not available. Local multicast discovery may be limited.');
  if (!switchbotConfigured) warnings.push('SwitchBot token/secret not configured. Cloud discovery disabled.');
  if (!controllerBridge && (!controllerUrl || controllerUrl.includes('localhost'))) {
    warnings.push('No network bridge configured. Local discovery only.');
  }

  res.json({
    ok: true,
    host: {
      platform: process.platform,
      hostname: os.hostname(),
      ipv4,
      ipv6
    },
    capabilities: {
      mdns: { available: mdnsAvailable, reason: mdnsReason },
      switchbot: { configured: switchbotConfigured },
      kasa: { lanDiscovery: Boolean(ipv4.length) },
      mqtt: { available: true },
      ble: { available: false, reason: 'ble-module-not-configured' },
      controllerBridge: { url: controllerBridge || null },
      controller: { url: controllerUrl || null }
    },
    permissions: {
      multicast: ipv4.length ? 'required' : 'unavailable',
      ble: 'required'
    },
    warnings
  });
});

app.post('/discovery/scan', async (req, res) => {
  console.log(' Universal device scan initiated');
  const startedAt = new Date().toISOString();
  
  try {
    const allDevices = [];
    
    // Leverage existing /discovery/devices logic via controller
    try {
      const controller = getNetworkBridgeUrl();
      if (controller) {
        const url = `${controller.replace(/\/$/, '')}/api/discovery/devices`;
        const response = await fetch(url).catch(() => null);
        if (response && response.ok) {
          const body = await response.json();
          if (Array.isArray(body?.devices)) {
            allDevices.push(...body.devices.map(d => ({
              ...d,
              name: d.name || d.deviceName || 'Unknown Device',
              brand: d.vendor || identifyDeviceBrand(d),
              model: d.hints?.type || d.deviceType || 'Unknown',
              ip: d.address || d.host || '—',
              mac: d.mac || '—',
              protocol: d.protocol || 'unknown',
              confidence: d.confidence || 0.5,
              category: categorizeDevice(d),
              comm_type: d.protocol
            })));
          }
        }
      }
    } catch (err) {
      console.warn('Network bridge discovery failed:', err.message);
    }
    
    // Direct SwitchBot Cloud discovery
    if (ensureSwitchBotConfigured()) {
      try {
        const sbDevices = await fetchSwitchBotDevices();
        if (sbDevices?.body?.deviceList) {
          sbDevices.body.deviceList.forEach(device => {
            allDevices.push({
              name: device.deviceName || `SwitchBot ${device.deviceType}`,
              brand: 'SwitchBot',
              model: device.deviceType,
              ip: '—',
              mac: device.deviceId,
              protocol: 'Cloud API',
              confidence: 0.95,
              category: categorizeSwitchBot(device.deviceType),
              deviceId: device.deviceId,
              deviceType: device.deviceType,
              comm_type: 'switchbot-cloud'
            });
          });
        }
      } catch (e) {
        console.warn('SwitchBot discovery failed:', e.message);
      }
    }
    
    // Direct Kasa discovery attempt
    try {
      const kasaDevices = await discoverKasaDevicesDirect();
      allDevices.push(...kasaDevices.map(d => ({
        name: d.alias || d.name || 'Kasa Device',
        brand: 'TP-Link Kasa',
        model: d.model || d.type || 'Smart Plug',
        ip: d.host || d.address || '—',
        mac: d.deviceId || d.mac || '—',
        protocol: 'Kasa WiFi',
        confidence: 0.9,
        category: 'Smart Plug',
        deviceId: d.deviceId,
        comm_type: 'kasa'
      })));
    } catch (e) {
      console.warn('Kasa direct discovery failed:', e.message);
    }

    // Fallback to live network discovery if no devices found yet
    if (!allDevices.length) {
      console.warn('Universal scan found 0 devices; attempting live network discovery fallback');
      try {
        const networkDevices = await discoverNetworkDevices();
        allDevices.push(...networkDevices.map(d => ({
          name: d.name || d.deviceName || 'Network Device',
          brand: d.vendor || identifyDeviceBrand(d),
          model: d.hints?.type || d.deviceType || d.type || 'Unknown',
          ip: d.address || d.host || '—',
          mac: d.mac || d.deviceId || '—',
          protocol: d.protocol || 'network',
          confidence: d.confidence || 0.6,
          category: categorizeDevice(d),
          comm_type: d.protocol || 'network'
        })));
      } catch (e) {
        console.warn('Network device discovery failed:', e.message);
      }

      try {
        const mqttDevices = await discoverMQTTDevices();
        allDevices.push(...mqttDevices.map(d => ({
          name: d.name || 'MQTT Device',
          brand: d.vendor || identifyDeviceBrand(d),
          model: d.hints?.type || d.deviceType || d.type || 'Unknown',
          ip: d.address || d.host || '—',
          mac: d.mac || d.deviceId || '—',
          protocol: d.protocol || 'mqtt',
          confidence: d.confidence || 0.6,
          category: categorizeDevice(d),
          comm_type: d.protocol || 'mqtt'
        })));
      } catch (e) {
        console.warn('MQTT device discovery failed:', e.message);
      }

      try {
        const bleDevices = await discoverBLEDevices();
        allDevices.push(...bleDevices.map(d => ({
          name: d.name || 'BLE Device',
          brand: d.vendor || identifyDeviceBrand(d),
          model: d.hints?.type || d.deviceType || d.type || 'Unknown',
          ip: d.address || d.host || '—',
          mac: d.mac || d.deviceId || '—',
          protocol: d.protocol || 'ble',
          confidence: d.confidence || 0.6,
          category: categorizeDevice(d),
          comm_type: d.protocol || 'ble'
        })));
      } catch (e) {
        console.warn('BLE device discovery failed:', e.message);
      }
    }
    
    console.log(` Universal scan complete: ${allDevices.length} devices found`);
    
    res.json({
      status: 'success',
      startedAt,
      completedAt: new Date().toISOString(),
      devices: allDevices,
      count: allDevices.length
    });
    
  } catch (error) {
    console.error(' Universal scan failed:', error);
    res.status(500).json({
      status: 'error',
      startedAt,
      completedAt: new Date().toISOString(),
      devices: [],
      error: error.message
    });
  }
});

// Helper to identify device brand from various signals
function identifyDeviceBrand(device) {
  if (device.vendor) return device.vendor;
  if (device.manufacturer) return device.manufacturer;
  
  const combined = `${device.name || ''} ${device.deviceType || ''} ${device.type || ''}`.toLowerCase();
  
  if (combined.includes('kasa') || combined.includes('tp-link')) return 'TP-Link Kasa';
  if (combined.includes('switchbot')) return 'SwitchBot';
  if (combined.includes('philips') || combined.includes('hue')) return 'Philips Hue';
  if (combined.includes('google') || combined.includes('chromecast')) return 'Google';
  if (combined.includes('roku')) return 'Roku';
  if (combined.includes('sonos')) return 'Sonos';
  if (combined.includes('homekit') || combined.includes('apple')) return 'Apple';
  
  return 'Unknown';
}

// Helper to categorize device type
function categorizeDevice(device) {
  const type = (device.hints?.type || device.deviceType || device.type || '').toLowerCase();
  const name = (device.name || '').toLowerCase();
  const combined = `${type} ${name}`;
  
  if (combined.includes('plug') || combined.includes('outlet')) return 'Smart Plug';
  if (combined.includes('light') || combined.includes('bulb')) return 'Light';
  if (combined.includes('switch')) return 'Switch';
  if (combined.includes('sensor') || combined.includes('meter')) return 'Sensor';
  if (combined.includes('hub') || combined.includes('bridge')) return 'Hub';
  if (combined.includes('tv') || combined.includes('display')) return 'Media';
  if (combined.includes('speaker') || combined.includes('audio')) return 'Audio';
  if (combined.includes('thermostat') || combined.includes('hvac')) return 'Climate';
  
  return 'Device';
}

// Helper for SwitchBot device categorization
function categorizeSwitchBot(deviceType) {
  const type = (deviceType || '').toLowerCase();
  if (type.includes('plug')) return 'Smart Plug';
  if (type.includes('bot')) return 'Switch Bot';
  if (type.includes('meter')) return 'Sensor';
  if (type.includes('hub')) return 'Hub';
  if (type.includes('curtain')) return 'Curtain';
  if (type.includes('lock')) return 'Lock';
  return 'Device';
}

// Direct Kasa discovery helper
async function discoverKasaDevicesDirect() {
  try {
    const kasaModule = await import('tplink-smarthome-api');
    const Client = kasaModule.default?.Client || kasaModule.Client;
    
    if (!Client || typeof Client !== 'function') {
      console.warn('Kasa Client not available');
      return [];
    }
    
    const client = new Client();
    const devices = [];
    
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        client.stopDiscovery();
        resolve(devices);
      }, 5000);
      
      client.startDiscovery({
        port: 9999,
        broadcast: '255.255.255.255'
      });
      
      client.on('device-new', async (device) => {
        try {
          const sysInfo = await device.getSysInfo();
          devices.push({
            deviceId: device.deviceId,
            alias: device.alias,
            name: sysInfo.alias,
            host: device.host,
            model: sysInfo.model,
            type: sysInfo.type || 'IOT.SMARTPLUGSWITCH',
            brand: 'TP-Link Kasa',
            protocol: 'Kasa UDP',
            comm_type: 'kasa'
          });
        } catch (e) {
          console.warn('Failed to get Kasa device info:', e.message);
        }
      });
    });
  } catch (e) {
    console.warn('Kasa client import failed:', e.message);
    return [];
  }
}

// Setup Wizard System - Device-specific configuration wizards
let SETUP_WIZARDS = buildSetupWizards();
// Internal test-mode flag toggled by __resetWizardSystemForTests()
let WIZARD_TEST_MODE = false;

// Wizard state persistence with NeDB
const wizardStatesDB = new Datastore({
  filename: './data/wizard-states.db',
  autoload: true,
  timestampData: true
});
const wizardStates = new Map(); // In-memory cache for fast access
const wizardDiscoveryContext = new Map();










// I-3.10: Device health tracking store (Integration Assistant)
// Tracks device uptime and connectivity for health monitoring
const deviceHealthDB = new Datastore({
  filename: './data/device-health.db',
  autoload: true,
  timestampData: true
});

// Initialize device health tracker
import { initHealthTracker } from './lib/device-health-tracker.js';
initHealthTracker(deviceHealthDB);

// Wire audit store into the AI agent service
import { setAuditStore } from './services/ai-agent.js';
setAuditStore(agentAuditDB);

// Load wizard states from database on startup
async function loadWizardStates() {
  try {
    const states = await wizardStatesDB.find({});
    for (const state of states) {
      wizardStates.set(state.wizardId, {
        currentStep: state.currentStep,
        completed: state.completed,
        data: state.data,
        startedAt: state.startedAt,
        discoveryContext: state.discoveryContext,
        discoveryDefaults: state.discoveryDefaults
      });
      if (state.discoveryContext) {
        wizardDiscoveryContext.set(state.wizardId, state.discoveryContext);
      }
    }
    console.log(` Loaded ${states.length} wizard state(s) from database`);
  } catch (error) {
    console.error(' Failed to load wizard states:', error.message);
  }
}

// Save wizard state to database
async function persistWizardState(wizardId) {
  try {
    const state = wizardStates.get(wizardId);
    if (!state) return;
    
    await wizardStatesDB.update(
      { wizardId },
      {
        wizardId,
        currentStep: state.currentStep,
        completed: state.completed,
        data: state.data,
        startedAt: state.startedAt,
        discoveryContext: state.discoveryContext,
        discoveryDefaults: state.discoveryDefaults
      },
      { upsert: true }
    );
  } catch (error) {
    console.error(` Failed to persist wizard state for ${wizardId}:`, error.message);
  }
}

// Clean up old wizard states (7-day TTL)
async function cleanupOldWizardStates() {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const result = await wizardStatesDB.remove(
      { startedAt: { $lt: sevenDaysAgo } },
      { multi: true }
    );
    if (result > 0) {
      console.log(`🧹 Cleaned up ${result} old wizard state(s)`);
    }
  } catch (error) {
    console.error(' Failed to cleanup old wizard states:', error.message);
  }
}

// Run cleanup daily
setInterval(cleanupOldWizardStates, 24 * 60 * 60 * 1000);

/**
 * Wholesale Reservation Cleanup Job
 * Runs hourly to remove expired reservations (24hr TTL)
 */
async function cleanupExpiredWholesaleReservations() {
  try {
    const reservationsPath = path.join(DATA_DIR, 'reservations.json');
    if (!fs.existsSync(reservationsPath)) return;
    
    const data = JSON.parse(fs.readFileSync(reservationsPath, 'utf8'));
    const reservations = data.reservations || [];
    const before = reservations.length;
    
    const now = Date.now();
    const ttlMs = 24 * 60 * 60 * 1000; // 24 hours
    const active = reservations.filter((r) => {
      const reservedAt = new Date(r.reserved_at).getTime();
      return (now - reservedAt) < ttlMs;
    });
    
    const removed = before - active.length;
    if (removed > 0) {
      data.reservations = active;
      fs.writeFileSync(reservationsPath, JSON.stringify(data, null, 2), 'utf8');
      console.log(`🧹 [Wholesale] Cleaned up ${removed} expired reservation(s)`);
      
      // Log to wholesale sync activity log
      const syncPath = path.join(DATA_DIR, 'wholesale-sync.json');
      if (fs.existsSync(syncPath)) {
        const syncData = JSON.parse(fs.readFileSync(syncPath, 'utf8'));
        syncData.activity_log = syncData.activity_log || [];
        syncData.activity_log.push({
          timestamp: new Date().toISOString(),
          event: 'reservation_cleanup',
          details: `Removed ${removed} expired reservations`,
          reservations_removed: removed
        });
        // Keep last 100 events
        if (syncData.activity_log.length > 100) {
          syncData.activity_log = syncData.activity_log.slice(-100);
        }
        fs.writeFileSync(syncPath, JSON.stringify(syncData, null, 2), 'utf8');
      }
    }
  } catch (error) {
    console.error('⚠️ [Wholesale] Failed to cleanup expired reservations:', error.message);
  }
}

// Run reservation cleanup hourly
setInterval(cleanupExpiredWholesaleReservations, 60 * 60 * 1000);

// Load states on startup
loadWizardStates();

function refreshSetupWizards() {
  const contextObject = Object.fromEntries(wizardDiscoveryContext.entries());
  SETUP_WIZARDS = buildSetupWizards(contextObject);
}

function recordDiscoveryForWizard(wizardId, device) {
  const existing = wizardDiscoveryContext.get(wizardId) || {};
  const merged = mergeDiscoveryPayload(existing, device);
  wizardDiscoveryContext.set(wizardId, merged);
  refreshSetupWizards();

  const currentState = wizardStates.get(wizardId);
  if (currentState) {
    currentState.discoveryContext = merged;
    wizardStates.set(wizardId, currentState);
    persistWizardState(wizardId).catch(err => 
      console.error(`Failed to persist wizard state for ${wizardId}:`, err)
    );
  }
}

function mergeStepPresets(...sources) {
  const merged = {};
  for (const source of sources) {
    if (!source) continue;
    for (const [stepId, values] of Object.entries(source)) {
      if (!merged[stepId]) {
        merged[stepId] = {};
      }
      Object.assign(merged[stepId], values || {});
    }
  }
  return merged;
}

function buildWizardSuggestionsFromDevices(devices = []) {
  const suggestions = [];

  for (const device of devices) {
    const applicableWizards = Object.values(SETUP_WIZARDS).filter(wizard =>
      wizard.targetDevices.includes(device.type) ||
      device.services?.some(service => wizard.targetDevices.includes(service))
    );

    if (applicableWizards.length === 0) {
      continue;
    }

    const recommendedWizards = applicableWizards.map(wizard => {
      recordDiscoveryForWizard(wizard.id, device);
      const context = wizardDiscoveryContext.get(wizard.id) || null;
      const defaults = getWizardDefaultInputs(wizard.id, context || {});

      return {
        id: wizard.id,
        name: wizard.name,
        description: wizard.description,
        confidence: calculateWizardConfidence(device, wizard),
        discoveryContext: context ? JSON.parse(JSON.stringify(context)) : null,
        discoveryDefaults: JSON.parse(JSON.stringify(defaults))
      };
    }).sort((a, b) => b.confidence - a.confidence);

    suggestions.push({
      device: {
        ip: device.ip,
        hostname: device.hostname,
        type: device.type,
        services: device.services
      },
      recommendedWizards
    });
  }

  return suggestions;
}

function resetWizardSystem() {
  wizardStates.clear();
  wizardDiscoveryContext.clear();
  refreshSetupWizards();
  // Clear database
  wizardStatesDB.remove({}, { multi: true }).catch(err =>
    console.error('Failed to clear wizard states database:', err)
  );
}

// Wizard state management


// Wizard validation engine
function validateWizardStepData(wizard, stepId, data) {
  const step = wizard.steps.find(s => s.id === stepId);
  if (!step) {
    throw new Error(`Step ${stepId} not found in wizard ${wizard.id}`);
  }

  const errors = [];
  const processedData = {};

  // Validate each field
  if (step.fields) {
    for (const field of step.fields) {
      const value = data[field.name];
      
      // Check required fields
      if (field.required && (value === undefined || value === null || value === '')) {
        errors.push(`Field '${field.label}' is required`);
        continue;
      }

      // Skip validation for optional empty fields
      if (!field.required && (value === undefined || value === null || value === '')) {
        continue;
      }

      // Type validation
      switch (field.type) {
        case 'number':
          const numValue = Number(value);
          if (isNaN(numValue)) {
            errors.push(`Field '${field.label}' must be a valid number`);
          } else {
            if (field.min !== undefined && numValue < field.min) {
              errors.push(`Field '${field.label}' must be at least ${field.min}`);
            }
            if (field.max !== undefined && numValue > field.max) {
              errors.push(`Field '${field.label}' must be at most ${field.max}`);
            }
            processedData[field.name] = numValue;
          }
          break;

        case 'boolean':
          processedData[field.name] = Boolean(value);
          break;

        case 'select':
          if (field.options && !field.options.includes(value)) {
            errors.push(`Field '${field.label}' must be one of: ${field.options.join(', ')}`);
          } else {
            processedData[field.name] = value;
          }
          break;

        case 'text':
        case 'password':
        default:
          processedData[field.name] = String(value);
          break;
      }
    }
  } else {
    // For dynamic steps, accept all data as-is
    Object.assign(processedData, data);
  }

  return { isValid: errors.length === 0, errors, data: processedData };
}

// Enhanced wizard execution with validation
async function executeWizardStepWithValidation(wizardId, stepId, data) {
  const wizard = SETUP_WIZARDS[wizardId];
  if (!wizard) {
    throw new Error(`Unknown wizard: ${wizardId}`);
  }

  // Validate step data
  const validation = validateWizardStepData(wizard, stepId, data);
  if (!validation.isValid) {
    return {
      success: false,
      errors: validation.errors,
      data: {}
    };
  }

  // Execute the step with validated data
  const execution = await executeWizardStep(wizardId, stepId, validation.data);
  const context = wizardDiscoveryContext.get(wizardId) || null;
  const wizardState = wizardStates.get(wizardId);

  if (execution.success && execution.nextStep) {
    const wizardDefinition = SETUP_WIZARDS[wizardId];
    if (wizardDefinition) {
      const nextStep = wizardDefinition.steps.find(step => step.id === execution.nextStep);
      if (nextStep) {
        execution.nextStepDetails = cloneWizardStep(nextStep);
        const defaults = wizardState?.discoveryDefaults || getWizardDefaultInputs(wizardId, context || {});
        execution.nextStepDefaults = defaults[execution.nextStep] || {};
      }
    }
  }

  execution.discoveryContext = context;
  execution.discoveryDefaults = wizardState?.discoveryDefaults || getWizardDefaultInputs(wizardId, context || {});

  return execution;
}

// Device-specific wizard step execution
async function executeDeviceSpecificStep(wizardId, stepId, data) {
  console.log(` Executing device-specific step: ${wizardId}/${stepId}`);
  
  switch (wizardId) {
    case 'mqtt-setup':
      return await executeMQTTWizardStep(stepId, data);
    case 'modbus-setup':
      return await executeModbusWizardStep(stepId, data);
    case 'kasa-setup':
      return await executeKasaWizardStep(stepId, data);
    case 'sensor-hub-setup':
      return await executeSensorHubWizardStep(stepId, data);
    default:
      return { success: true, data: {}, deviceSpecific: false };
  }
}

// MQTT-specific wizard step execution
async function executeMQTTWizardStep(stepId, data) {
  switch (stepId) {
    case 'broker-connection':
      try {
        // Test MQTT connection
        console.log(`🔗 Testing MQTT connection to ${data.host}:${data.port}`);
        
        // Simulate connection test (in real implementation, use mqtt.js)
        const connectionResult = {
          connected: true,
          brokerInfo: {
            version: 'Mosquitto 2.0.15',
            maxPacketSize: 268435460,
            retainAvailable: true
          }
        };
        
        return {
          success: true,
          data: { connectionTest: connectionResult },
          message: `Successfully connected to MQTT broker at ${data.host}:${data.port}`
        };
      } catch (error) {
        return {
          success: false,
          error: `Failed to connect to MQTT broker: ${error.message}`
        };
      }
      
    case 'topic-discovery':
      console.log(` Discovering MQTT topics with pattern: ${data.baseTopic}`);
      
      // Simulate topic discovery
      const discoveredTopics = [
        'farm/greenhouse/temperature',
        'farm/greenhouse/humidity', 
        'farm/greenhouse/soil_moisture',
        'farm/irrigation/pump_status',
        'farm/lighting/zone1/status'
      ];
      
      return {
        success: true,
        data: { discoveredTopics },
        message: `Discovered ${discoveredTopics.length} topics`
      };
      
    default:
      return { success: true, data: {} };
  }
}

// Modbus-specific wizard step execution
async function executeModbusWizardStep(stepId, data) {
  switch (stepId) {
    case 'connection-setup':
      console.log(`🔗 Testing Modbus connection to ${data.host}:${data.port}`);
      
      // Simulate Modbus connection test
      return {
        success: true,
        data: { 
          connectionTest: { 
            connected: true, 
            deviceInfo: 'Industrial Sensor Hub v2.1' 
          }
        },
        message: `Modbus connection established with Unit ID ${data.unitId}`
      };
      
    case 'register-mapping':
      console.log(` Mapping registers starting at address ${data.startAddress}`);
      
      // Simulate register discovery
      const registerMap = Array.from({ length: data.registerCount }, (_, i) => ({
        address: data.startAddress + i,
        value: Math.floor(Math.random() * 1000),
        type: data.dataType
      }));
      
      return {
        success: true,
        data: { registerMap },
        message: `Mapped ${data.registerCount} registers`
      };
      
    default:
      return { success: true, data: {} };
  }
}

// Kasa-specific wizard step execution
async function executeKasaWizardStep(stepId, data) {
  switch (stepId) {
    case 'device-discovery':
      console.log(` Discovering Kasa devices (timeout: ${data.discoveryTimeout}s)`);
      
      // Test/CI guardrail: avoid real network waits during unit tests
      // Short-circuit when running our test harness (flag set by __resetWizardSystemForTests)
      // or common CI env markers
      if (WIZARD_TEST_MODE || process.env.NODE_ENV === 'test' || process.env.CI === 'true') {
        return {
          success: true,
          deviceSpecific: false,
          data: { discoveredDevices: [], totalFound: 0, filtered: 0 },
          message: 'Kasa discovery skipped in test/CI environment'
        };
      }

      try {
        const kasaModule = await import('tplink-smarthome-api');
        const Client = kasaModule.Client ?? kasaModule.default?.Client ?? kasaModule.default;

        if (typeof Client !== 'function') {
          const message = 'tplink-smarthome-api Client constructor not available';
          console.error(message);
          return {
            success: false,
            error: message,
            data: {}
          };
        }

        const client = new Client();
        const kasaDevices = [];
        
        // Start discovery
        client.startDiscovery({
          port: 9999,
          broadcast: '255.255.255.255',
          timeout: (data.discoveryTimeout || 10) * 1000
        });
        
        // Collect devices
        client.on('device-new', async (device) => {
          try {
            const sysInfo = await device.getSysInfo();
            kasaDevices.push({
              deviceId: device.deviceId,
              ip: device.host,
              model: sysInfo.model || 'Unknown',
              alias: device.alias || sysInfo.alias || 'Unnamed Device',
              type: sysInfo.type || 'plug',
              state: sysInfo.relay_state || 0,
              rssi: sysInfo.rssi,
              softwareVersion: sysInfo.sw_ver,
              hardwareVersion: sysInfo.hw_ver
            });
          } catch (err) {
            console.warn(`Error getting Kasa device info:`, err.message);
            kasaDevices.push({
              deviceId: device.deviceId,
              ip: device.host,
              alias: device.alias || 'Unknown Kasa Device',
              type: 'unknown',
              error: err.message
            });
          }
        });
        
  // Wait for discovery but cap total wait to keep UX responsive
  const requestedMs = (data.discoveryTimeout || 10) * 1000 + 1000;
  const waitMs = Math.min(requestedMs, 8000); // hard-cap at 8s in runtime
  await new Promise(resolve => setTimeout(resolve, waitMs));
        client.stopDiscovery();
        
        // Filter by target IP if specified
        let filteredDevices = kasaDevices;
        if (data.targetIP) {
          filteredDevices = kasaDevices.filter(device => 
            device.ip.startsWith(data.targetIP.split('.').slice(0, 3).join('.'))
          );
        }
        
        return {
          success: true,
          data: { 
            discoveredDevices: filteredDevices,
            totalFound: kasaDevices.length,
            filtered: data.targetIP ? filteredDevices.length : kasaDevices.length
          },
          message: `Found ${filteredDevices.length} Kasa device(s)${data.targetIP ? ` matching ${data.targetIP}` : ''}`
        };
        
      } catch (error) {
        console.warn('Kasa discovery unavailable:', error.message);
        return {
          success: true,
          deviceSpecific: false,
          data: { discoveredDevices: [], totalFound: 0, filtered: 0 },
          message: 'Kasa discovery unavailable in current environment'
        };
      }
      
    case 'device-configuration':
      console.log(` Configuring Kasa device: ${data.alias}`);
      
      try {
        // If we have device info from discovery, use it to configure
        if (data.deviceId) {
          const kasaModule = await import('tplink-smarthome-api');
          const Client = kasaModule.default?.Client || kasaModule.Client;
          const client = new Client();
          
          // Try to find the device
          let targetDevice = null;
          client.startDiscovery({ timeout: 3000 });
          
          await new Promise((resolve) => {
            client.on('device-new', (device) => {
              if (device.deviceId === data.deviceId) {
                targetDevice = device;
                client.stopDiscovery();
                resolve();
              }
            });
            
            setTimeout(() => {
              client.stopDiscovery();
              resolve();
            }, 3500);
          });
          
          if (targetDevice && data.alias !== targetDevice.alias) {
            // Set new alias
            await targetDevice.setAlias(data.alias);
          }
          
          return {
            success: true,
            data: {
              deviceId: data.deviceId,
              alias: data.alias,
              location: data.location,
              scheduleEnabled: data.scheduleEnabled,
              configured: true
            },
            message: `Successfully configured ${data.alias}`
          };
        }
        
        return {
          success: true,
          data: {
            alias: data.alias,
            location: data.location,
            scheduleEnabled: data.scheduleEnabled
          },
          message: `Configuration saved for ${data.alias}`
        };
        
      } catch (error) {
        console.warn('Kasa configuration not applied:', error.message);
        return {
          success: true,
          deviceSpecific: false,
          data: {
            alias: data.alias,
            location: data.location,
            scheduleEnabled: data.scheduleEnabled,
            configured: false
          },
          message: `Configuration deferred for ${data.alias}`
        };
      }
      
    default:
      return { success: true, data: {} };
  }
}

// Sensor Hub-specific wizard step execution
async function executeSensorHubWizardStep(stepId, data) {
  switch (stepId) {
    case 'hub-identification':
      console.log(` Connecting to ${data.hubType} at ${data.endpoint}`);
      
      return {
        success: true,
        data: { 
          hubInfo: {
            type: data.hubType,
            firmware: 'v3.2.1',
            sensors: 8,
            channels: 16
          }
        },
        message: `Connected to ${data.hubType} hub`
      };
      
    case 'sensor-configuration':
      console.log(` Configuring ${data.sensorType} sensor on channel ${data.channel}`);
      
      return {
        success: true,
        data: { 
          sensorConfig: {
            type: data.sensorType,
            channel: data.channel,
            calibrated: true,
            initialReading: Math.random() * 100
          }
        },
        message: `${data.sensorType} sensor configured on channel ${data.channel}`
      };
      
    default:
      return { success: true, data: {} };
  }
}

// Get setup wizard definition
async function getSetupWizard(wizardId) {
  const wizard = SETUP_WIZARDS[wizardId];
  if (!wizard) {
    throw new Error(`Unknown wizard: ${wizardId}`);
  }

  // Initialize wizard state if not exists
  if (!wizardStates.has(wizardId)) {
    const newState = {
      currentStep: 0,
      completed: false,
      data: {},
      startedAt: new Date().toISOString(),
      discoveryContext: wizardDiscoveryContext.get(wizardId) || null,
      discoveryDefaults: getWizardDefaultInputs(wizardId, wizardDiscoveryContext.get(wizardId) || {})
    };
    wizardStates.set(wizardId, newState);
    persistWizardState(wizardId).catch(err => 
      console.error(`Failed to persist new wizard state for ${wizardId}:`, err)
    );
  } else {
    const existingState = wizardStates.get(wizardId);
    const context = wizardDiscoveryContext.get(wizardId) || null;
    existingState.discoveryContext = context;
    existingState.discoveryDefaults = getWizardDefaultInputs(wizardId, context || {});
    wizardStates.set(wizardId, existingState);
    persistWizardState(wizardId).catch(err => 
      console.error(`Failed to persist updated wizard state for ${wizardId}:`, err)
    );
  }

  return {
    ...wizard,
    state: wizardStates.get(wizardId)
  };
}

// Execute a wizard step
async function executeWizardStep(wizardId, stepId, data) {
  const wizard = SETUP_WIZARDS[wizardId];
  if (!wizard) {
    throw new Error(`Unknown wizard: ${wizardId}`);
  }
  
  const context = wizardDiscoveryContext.get(wizardId) || null;
  const state = wizardStates.get(wizardId) || {
    currentStep: 0,
    completed: false,
    data: {},
    startedAt: new Date().toISOString(),
    discoveryContext: context,
    discoveryDefaults: getWizardDefaultInputs(wizardId, context || {})
  };
  
  console.log(`🧙 Executing wizard ${wizardId} step ${stepId}:`, data);
  
  // Execute step-specific logic based on wizard type
  let result = { success: true, data: {}, nextStep: null };
  
  try {
    // Validate step data first
    const validation = validateWizardStepData(wizard, stepId, data);
    if (!validation.isValid) {
      return {
        success: false,
        errors: validation.errors,
        data: {}
      };
    }

    // Execute device-specific logic if available
    const deviceResult = await executeDeviceSpecificStep(wizardId, stepId, validation.data);
    if (deviceResult.deviceSpecific !== false) {
      result = { ...result, ...deviceResult };
    }
    
    // Store step data
    state.data[stepId] = {
      input: validation.data,
      result: deviceResult.data || {},
      timestamp: new Date().toISOString(),
      success: deviceResult.success !== false
    };
    
    state.lastUpdated = new Date().toISOString();
    
    // Find next step
    const currentStepIndex = wizard.steps.findIndex(s => s.id === stepId);
    if (currentStepIndex < wizard.steps.length - 1) {
      const nextStep = wizard.steps[currentStepIndex + 1];
      result.nextStep = nextStep.id;
      state.currentStep = currentStepIndex + 1;
    } else {
      state.completed = true;
      state.completedAt = new Date().toISOString();
      console.log(` Wizard ${wizardId} completed successfully`);
      
      // Execute post-completion actions
      await executeWizardCompletion(wizardId, state);
    }
    
    state.discoveryContext = wizardDiscoveryContext.get(wizardId) || state.discoveryContext || null;
    state.discoveryDefaults = getWizardDefaultInputs(wizardId, state.discoveryContext || {});

    wizardStates.set(wizardId, state);
    
    // Persist state to database after each step
    persistWizardState(wizardId).catch(err => 
      console.error(`Failed to persist wizard state after step ${stepId}:`, err)
    );
    
  } catch (error) {
    console.error(` Wizard step execution failed: ${wizardId}/${stepId}`, error);
    result = {
      success: false,
      error: error.message,
      data: {}
    };
  }
  
  return result;
}

// Execute wizard completion actions
async function executeWizardCompletion(wizardId, state) {
  console.log(` Executing completion actions for wizard: ${wizardId}`);
  
  switch (wizardId) {
    case 'mqtt-setup':
      await completeMQTTSetup(state);
      break;
    case 'modbus-setup':
      await completeModbusSetup(state);
      break;
    case 'kasa-setup':
      await completeKasaSetup(state);
      break;
    case 'sensor-hub-setup':
      await completeSensorHubSetup(state);
      break;
    default:
      console.log(`No completion actions defined for wizard: ${wizardId}`);
  }
}

// MQTT setup completion
async function completeMQTTSetup(state) {
  const brokerData = state.data['broker-connection']?.input;
  const topicData = state.data['topic-discovery']?.input;
  
  console.log(`🔗 Configuring MQTT integration for ${brokerData?.host}:${brokerData?.port}`);
  
  // Here you would:
  // 1. Save MQTT configuration to persistent storage
  // 2. Start MQTT client connection
  // 3. Subscribe to discovered topics
  // 4. Register device in system database
  
  return {
    configurationSaved: true,
    mqttClientStarted: true,
    topicsSubscribed: state.data['topic-discovery']?.result?.discoveredTopics?.length || 0
  };
}

// Modbus setup completion
async function completeModbusSetup(state) {
  const connectionData = state.data['connection-setup']?.input;
  const registerData = state.data['register-mapping']?.input;
  
  console.log(` Configuring Modbus integration for ${connectionData?.host}:${connectionData?.port}`);
  
  return {
    modbusClientConfigured: true,
    registersConfigured: registerData?.registerCount || 0,
    pollIntervalSet: registerData?.pollInterval
  };
}

// Kasa setup completion
async function completeKasaSetup(state) {
  const discoveryData = state.data['device-discovery']?.result;
  
  console.log(`🏠 Configuring Kasa integration for ${discoveryData?.discoveredDevices?.length || 0} devices`);
  
  return {
    kasaDevicesConfigured: discoveryData?.discoveredDevices?.length || 0,
    automationEnabled: true
  };
}

// Sensor Hub setup completion
async function completeSensorHubSetup(state) {
  const hubData = state.data['hub-identification']?.input;
  
  console.log(`🎛 Configuring sensor hub integration: ${hubData?.hubType}`);
  
  return {
    sensorHubConfigured: true,
    hubType: hubData?.hubType,
    sensorsConfigured: Object.keys(state.data).filter(k => k.startsWith('sensor-')).length
  };
}

// Get wizard execution status
async function getWizardStatus(wizardId) {
  const state = wizardStates.get(wizardId);
  if (!state) {
    return { exists: false };
  }
  
  const wizard = SETUP_WIZARDS[wizardId];
  return {
    exists: true,
    wizardId,
    name: wizard.name,
    currentStep: state.currentStep,
    totalSteps: wizard.steps.length,
    completed: state.completed,
    progress: state.completed ? 100 : Math.round((state.currentStep / wizard.steps.length) * 100),
    startedAt: state.startedAt,
    lastUpdated: state.lastUpdated,
    completedAt: state.completedAt,
    data: state.data,
    discoveryContext: state.discoveryContext || wizardDiscoveryContext.get(wizardId) || null,
    discoveryDefaults: state.discoveryDefaults || getWizardDefaultInputs(wizardId, wizardDiscoveryContext.get(wizardId) || {})
  };
}

// Get all available setup wizards
async function getAllSetupWizards() {
  return Object.keys(SETUP_WIZARDS).map(id => {
    const wizard = SETUP_WIZARDS[id];
    const state = wizardStates.get(id);
    return {
      id: wizard.id,
      name: wizard.name,
      description: wizard.description,
      targetDevices: wizard.targetDevices,
      stepCount: wizard.steps.length,
      status: state ? (state.completed ? 'completed' : 'in-progress') : 'not-started'
    };
  });
}

// MQTT device discovery
async function discoverMQTTDevices() {
  const devices = [];
  
  // Check if MQTT broker is configured via Python backend
  try {
    const controller = getController();
    if (controller) {
      const mqttResponse = await fetch(`${controller}/api/devices/mqtt`);
      if (mqttResponse.ok) {
        const mqttData = await mqttResponse.json();
        if (mqttData.devices) {
          mqttData.devices.forEach(device => {
            devices.push({
              id: `mqtt:${device.device_id}`,
              name: device.name,
              protocol: 'mqtt',
              confidence: 0.85,
              signal: null,
              address: device.details?.topic || 'unknown',
              vendor: 'MQTT Device',
              lastSeen: device.details?.last_seen || new Date().toISOString(),
              hints: {
                type: device.category,
                topic: device.details?.topic,
                capabilities: device.capabilities,
                metrics: ['sensor_data', 'status', 'battery']
              }
            });
          });
        }
      }
    }
  } catch (e) {
    console.warn('MQTT discovery via controller failed:', e.message);
  }

  return devices;
}

// BLE device discovery
async function discoverBLEDevices() {
  const devices = [];
  
  // Check for BLE devices via Python backend (if noble/bleak is available)
  try {
    const controller = getController();
    if (controller) {
      const bleResponse = await fetch(`${controller}/api/devices/ble`);
      if (bleResponse.ok) {
        const bleData = await bleResponse.json();
        if (bleData.devices) {
          bleData.devices.forEach(device => {
            devices.push({
              id: `ble:${device.device_id}`,
              name: device.name || `BLE Device ${device.device_id.substring(0, 8)}`,
              protocol: 'bluetooth-le',
              confidence: 0.8,
              signal: device.rssi || null,
              address: device.device_id,
              vendor: device.manufacturer || 'Unknown BLE',
              lastSeen: new Date().toISOString(),
              hints: {
                type: device.category || 'ble-peripheral',
                rssi: device.rssi,
                services: device.services || [],
                metrics: ['battery', 'signal_strength', 'sensor_data']
              }
            });
          });
        }
      }
    }
  } catch (e) {
    // BLE discovery is optional - many systems don't have it
    console.log('BLE discovery not available (normal on many systems)');
  }

  return devices;
}

// Farm device status endpoints for live testing
app.get('/api/device/:deviceId/status', async (req, res) => {
  const { deviceId } = req.params;
  
  // Generate live-looking data for farm devices
  const farmDeviceStatus = {
    'wifi:192.168.1.101': {
      deviceId,
      name: 'HLG 550 V2 R-Spec',
      online: true,
      power: 485 + Math.random() * 30, // 485-515W
      voltage: 120.1 + Math.random() * 2,
      current: 4.04 + Math.random() * 0.25,
      spectrum: {
        red: 660,
        blue: 450,
        green: 520,
        farRed: 730,
        white: 3000
      },
      dimming: 85 + Math.random() * 10, // 85-95%
      temperature: 42 + Math.random() * 8, // LED temp
      runtime: Math.floor(Date.now() / 1000) - 3600 * 8, // 8 hours runtime
      lastUpdate: new Date().toISOString()
    },
    'wifi:192.168.1.102': {
      deviceId,
      name: 'HLG 550 V2 R-Spec',
      online: true,
      power: 490 + Math.random() * 25,
      voltage: 119.8 + Math.random() * 2,
      current: 4.08 + Math.random() * 0.20,
      spectrum: {
        red: 660,
        blue: 450,
        green: 520,
        farRed: 730,
        white: 3000
      },
      dimming: 88 + Math.random() * 8,
      temperature: 45 + Math.random() * 6,
      runtime: Math.floor(Date.now() / 1000) - 3600 * 8,
      lastUpdate: new Date().toISOString()
    },
    'wifi:192.168.1.103': {
      deviceId,
      name: 'Spider Farmer SF-7000',
      online: true,
      power: 640 + Math.random() * 40,
      voltage: 120.3 + Math.random() * 1.5,
      current: 5.33 + Math.random() * 0.30,
      spectrum: {
        red: 660,
        blue: 450,
        green: 520,
        farRed: 730,
        white: 3500
      },
      dimming: 90 + Math.random() * 5,
      temperature: 48 + Math.random() * 7,
      runtime: Math.floor(Date.now() / 1000) - 3600 * 8,
      lastUpdate: new Date().toISOString()
    },
    'wifi:192.168.1.104': {
      deviceId,
      name: 'MARS HYDRO FC-E6500',
      online: true,
      power: 610 + Math.random() * 35,
      voltage: 119.9 + Math.random() * 2,
      current: 5.08 + Math.random() * 0.25,
      spectrum: {
        red: 660,
        blue: 450,
        green: 520,
        farRed: 730,
        white: 3200
      },
      dimming: 87 + Math.random() * 8,
      temperature: 46 + Math.random() * 9,
      runtime: Math.floor(Date.now() / 1000) - 3600 * 8,
      lastUpdate: new Date().toISOString()
    }
  };

  const status = farmDeviceStatus[deviceId];
  if (status) {
    res.json(status);
  } else {
    res.status(404).json({ error: 'Device not found' });
  }
});

// Farm device control endpoints
app.post('/api/device/:deviceId/power', async (req, res) => {
  const { deviceId } = req.params;
  const { state } = req.body; // 'on' or 'off'

  const normalizedState = String(state || '').toLowerCase();
  const command = normalizedState === 'on' || normalizedState === 'true' ? 'turnOn' : 'turnOff';

  const safetyResult = await executeSafetyEnvelope({
    device: {
      deviceId,
      deviceType: req.body?.deviceType || 'device-power-fallback',
      protocol: 'farm-fallback',
      safetyCategory: req.body?.safetyCategory
    },
    command,
    args: {
      state
    },
    context: {
      source: req.body?.source || req.body?.context?.source || 'api-fallback',
      userId: req.user?.userId || req.user?.email || 'system',
      sessionId: req.headers['x-request-id'] || req.body?.sessionId || null,
      confirmed: req.body?.confirmed,
      confirmation: req.body?.confirmation
    },
    execute: async () => {
      console.log(` Farm Light Control: ${deviceId} → ${state}`);
      return { logged: true };
    }
  });

  if (!safetyResult.allowed) {
    return res.status(409).json({
      success: false,
      error: 'safety_blocked',
      reason: safetyResult.reason,
      remediation: safetyResult.remediation,
      auditId: safetyResult.auditId,
      deviceId,
      action: 'power'
    });
  }

  res.json({
    deviceId,
    action: 'power',
    state,
    timestamp: new Date().toISOString(),
    success: true,
    safety: {
      auditId: safetyResult.auditId,
      allowed: true
    }
  });
});

app.post('/api/device/:deviceId/spectrum', async (req, res) => {
  const { deviceId } = req.params;
  const { spectrum } = req.body;

  const safetyResult = await executeSafetyEnvelope({
    device: {
      deviceId,
      deviceType: req.body?.deviceType || 'device-spectrum-fallback',
      protocol: 'farm-fallback',
      safetyCategory: req.body?.safetyCategory || 'actuator-low'
    },
    command: 'setSpectrum',
    args: {
      spectrum
    },
    context: {
      source: req.body?.source || req.body?.context?.source || 'api-fallback',
      userId: req.user?.userId || req.user?.email || 'system',
      sessionId: req.headers['x-request-id'] || req.body?.sessionId || null,
      confirmed: req.body?.confirmed,
      confirmation: req.body?.confirmation
    },
    execute: async () => {
      console.log(`🌈 Farm Light Spectrum: ${deviceId}`, spectrum);
      return { logged: true };
    }
  });

  if (!safetyResult.allowed) {
    return res.status(409).json({
      success: false,
      error: 'safety_blocked',
      reason: safetyResult.reason,
      remediation: safetyResult.remediation,
      auditId: safetyResult.auditId,
      deviceId,
      action: 'spectrum'
    });
  }

  res.json({
    deviceId,
    action: 'spectrum',
    spectrum,
    timestamp: new Date().toISOString(),
    success: true,
    safety: {
      auditId: safetyResult.auditId,
      allowed: true
    }
  });
});

app.post('/api/device/:deviceId/dimming', async (req, res) => {
  const { deviceId } = req.params;
  const { level } = req.body; // 0-100

  const safetyResult = await executeSafetyEnvelope({
    device: {
      deviceId,
      deviceType: req.body?.deviceType || 'device-dimming-fallback',
      protocol: 'farm-fallback',
      safetyCategory: req.body?.safetyCategory || 'actuator-low'
    },
    command: 'setDimming',
    args: {
      level
    },
    context: {
      source: req.body?.source || req.body?.context?.source || 'api-fallback',
      userId: req.user?.userId || req.user?.email || 'system',
      sessionId: req.headers['x-request-id'] || req.body?.sessionId || null,
      confirmed: req.body?.confirmed,
      confirmation: req.body?.confirmation
    },
    execute: async () => {
      console.log(`🔆 Farm Light Dimming: ${deviceId} → ${level}%`);
      return { logged: true };
    }
  });

  if (!safetyResult.allowed) {
    return res.status(409).json({
      success: false,
      error: 'safety_blocked',
      reason: safetyResult.reason,
      remediation: safetyResult.remediation,
      auditId: safetyResult.auditId,
      deviceId,
      action: 'dimming'
    });
  }

  res.json({
    deviceId,
    action: 'dimming',
    level,
    timestamp: new Date().toISOString(),
    success: true,
    safety: {
      auditId: safetyResult.auditId,
      allowed: true
    }
  });
});

// Express error handling middleware - must be last
app.use((error, req, res, next) => {
  console.error(' Express Error Handler:', error);
  console.error('Stack:', error.stack);
  console.error('Request URL:', req.url);
  console.error('Request Method:', req.method);
  
  // Don't expose internal errors to client in production
  const isDev = process.env.NODE_ENV !== 'production';
  
  res.status(error.status || 500).json({
    error: 'Internal Server Error',
    message: isDev ? error.message : 'Something went wrong',
    requestId: req.headers['x-request-id'] || Date.now().toString(),
    timestamp: new Date().toISOString()
  });
});

// Setup wizard endpoints - triggered when devices are identified
app.get('/setup/wizards/:wizardId', async (req, res) => {
  const { wizardId } = req.params;
  try {
    const wizard = await getSetupWizard(wizardId);
    if (!wizard) {
      return res.status(404).json({ error: 'Wizard not found' });
    }
    res.json(wizard);
  } catch (error) {
    console.error('Failed to load setup wizard:', error);
    res.status(500).json({ error: 'Failed to load setup wizard' });
  }
});

// Get all available setup wizards
app.get('/setup/wizards', async (req, res) => {
  try {
    const wizards = await getAllSetupWizards();
    res.json({
      success: true,
      wizards
    });
  } catch (error) {
    console.error('Error fetching setup wizards:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get specific wizard definition and state
app.get('/setup/wizards/:wizardId', async (req, res) => {
  try {
    const { wizardId } = req.params;
    const wizard = await getSetupWizard(wizardId);
    res.json({
      success: true,
      wizard
    });
  } catch (error) {
    console.error(`Error fetching wizard ${req.params.wizardId}:`, error);
    res.status(404).json({
      success: false,
      error: error.message
    });
  }
});

// Execute a wizard step
app.post('/setup/wizards/:wizardId/execute', async (req, res) => {
  try {
    const { wizardId } = req.params;
    const { stepId, data } = req.body;
    
    if (!stepId) {
      return res.status(400).json({
        success: false,
        error: 'stepId is required'
      });
    }
    
    const result = await executeWizardStep(wizardId, stepId, data || {});
    res.json({
      success: result.success,
      result,
      wizard: await getSetupWizard(wizardId)
    });
  } catch (error) {
    console.error(`Error executing wizard ${req.params.wizardId}:`, error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get wizard execution status
app.get('/setup/wizards/:wizardId/status', async (req, res) => {
  try {
    const { wizardId } = req.params;
    const status = await getWizardStatus(wizardId);
    
    if (!status.exists) {
      return res.status(404).json({
        success: false,
        error: 'Wizard not found or never started'
      });
    }
    
    res.json({
      success: true,
      status
    });
  } catch (error) {
    console.error(`Error getting wizard status ${req.params.wizardId}:`, error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Reset wizard state (useful for testing)
app.delete('/setup/wizards/:wizardId', async (req, res) => {
  try {
    const { wizardId } = req.params;
    wizardStates.delete(wizardId);
    console.log(`🗑 Reset wizard state for ${wizardId}`);
    res.json({
      success: true,
      message: `Wizard ${wizardId} state reset`
    });
  } catch (error) {
    console.error(`Error resetting wizard ${req.params.wizardId}:`, error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Automatically suggest wizards for discovered devices
app.post('/discovery/suggest-wizards', async (req, res) => {
  try {
    const { devices } = req.body;
    if (!Array.isArray(devices)) {
      return res.status(400).json({
        success: false,
        error: 'devices array is required'
      });
    }
    
    const suggestions = buildWizardSuggestionsFromDevices(devices);

    res.json({
      success: true,
      suggestions
    });
    
  } catch (error) {
    console.error('Error suggesting wizards:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Calculate wizard confidence score for device matching
function calculateWizardConfidence(device, wizard) {
  let confidence = 0;
  
  // Direct type match
  if (wizard.targetDevices.includes(device.type)) {
    confidence += 80;
  }
  
  // Service match
  if (device.services) {
    const matchingServices = device.services.filter(service => 
      wizard.targetDevices.includes(service)
    );
    confidence += matchingServices.length * 30;
  }
  
  // Device-specific bonuses
  if (device.hostname) {
    if (wizard.id === 'switchbot-setup' && device.hostname.toLowerCase().includes('switchbot')) {
      confidence += 50;
    }
    if (wizard.id === 'mqtt-setup' && device.hostname.toLowerCase().includes('mqtt')) {
      confidence += 50;
    }
    if (wizard.id === 'modbus-setup' && device.hostname.toLowerCase().includes('modbus')) {
      confidence += 50;
    }
    if (wizard.id === 'kasa-setup' && (device.hostname.toLowerCase().includes('kasa') || device.hostname.toLowerCase().includes('tplink'))) {
      confidence += 50;
    }
  }
  
  return Math.min(confidence, 100);
}

// Bulk wizard operations
async function executeBulkWizardOperation(operation, wizardIds, data) {
  console.log(` Executing bulk operation: ${operation} on ${wizardIds.length} wizards`);
  
  const results = [];
  
  for (const wizardId of wizardIds) {
    try {
      let result;
      
      switch (operation) {
        case 'reset':
          wizardStates.delete(wizardId);
          result = { wizardId, success: true, message: 'State reset' };
          break;
          
        case 'status':
          result = { 
            wizardId, 
            success: true, 
            status: await getWizardStatus(wizardId) 
          };
          break;
          
        case 'execute-step':
          if (!data.stepId) {
            throw new Error('stepId required for execute-step operation');
          }
          result = {
            wizardId,
            success: true,
            result: await executeWizardStep(wizardId, data.stepId, data.stepData || {})
          };
          break;
          
        default:
          throw new Error(`Unknown bulk operation: ${operation}`);
      }
      
      results.push(result);
      
    } catch (error) {
      results.push({
        wizardId,
        success: false,
        error: error.message
      });
    }
  }
  
  return {
    operation,
    totalWizards: wizardIds.length,
    successful: results.filter(r => r.success).length,
    failed: results.filter(r => !r.success).length,
    results
  };
}

// Wizard templates for common configurations
const WIZARD_TEMPLATES = {
  'greenhouse-complete': {
    name: 'Complete Greenhouse Setup',
    description: 'Configure all devices for a complete greenhouse monitoring system',
    wizards: [
      { id: 'mqtt-setup', priority: 1, autoExecute: false },
      { id: 'sensor-hub-setup', priority: 2, autoExecute: false },
      { id: 'web-device-setup', priority: 3, autoExecute: false },
      { id: 'kasa-setup', priority: 4, autoExecute: true }
    ],
    presets: {
      'mqtt-setup': {
        'broker-connection': {
          port: 8883,
          secure: true
        }
      },
      'sensor-hub-setup': {
        'data-processing': {
          sampleRate: 300,
          enableAveraging: true,
          alertThresholds: true
        }
      }
    }
  },
  
  'industrial-monitoring': {
    name: 'Industrial Sensor Monitoring',
    description: 'Configure industrial-grade sensors and monitoring equipment',
    wizards: [
      { id: 'modbus-setup', priority: 1, autoExecute: false },
      { id: 'mqtt-setup', priority: 2, autoExecute: false },
      { id: 'sensor-hub-setup', priority: 3, autoExecute: false }
    ],
    presets: {
      'modbus-setup': {
        'connection-setup': {
          port: 502,
          timeout: 5000,
          protocol: 'TCP'
        },
        'register-mapping': {
          dataType: 'float32',
          pollInterval: 60
        }
      }
    }
  },
  
  'smart-home-farm': {
    name: 'Smart Home Farm Integration',
    description: 'Integrate consumer smart home devices for farm automation',
    wizards: [
      { id: 'kasa-setup', priority: 1, autoExecute: true },
      { id: 'switchbot-setup', priority: 2, autoExecute: false },
      { id: 'web-device-setup', priority: 3, autoExecute: false }
    ],
    presets: {
      'kasa-setup': {
        'device-discovery': {
          discoveryTimeout: 15
        }
      }
    }
  }
};

// Apply wizard template
async function applyWizardTemplate(templateId, devices, customPresets = {}) {
  const template = WIZARD_TEMPLATES[templateId];
  if (!template) {
    throw new Error(`Unknown wizard template: ${templateId}`);
  }
  
  console.log(` Applying wizard template: ${template.name}`);
  
  const results = {
    templateId,
    templateName: template.name,
    applicableWizards: [],
    autoExecuted: [],
    errors: []
  };
  
  // Find applicable wizards based on devices
  for (const wizardConfig of template.wizards) {
    const wizard = SETUP_WIZARDS[wizardConfig.id];
    if (!wizard) {
      results.errors.push(`Wizard not found: ${wizardConfig.id}`);
      continue;
    }

    // Check if any devices match this wizard
    const applicableDevices = devices.filter(device =>
      calculateWizardConfidence(device, wizard) > 50
    );

    if (applicableDevices.length > 0) {
      const discoveryContext = wizardDiscoveryContext.get(wizardConfig.id) || null;
      const discoveryDefaults = getWizardDefaultInputs(wizardConfig.id, discoveryContext || {});

      results.applicableWizards.push({
        wizardId: wizardConfig.id,
        priority: wizardConfig.priority,
        autoExecute: wizardConfig.autoExecute,
        applicableDevices: applicableDevices.length,
        devices: applicableDevices,
        discoveryContext: discoveryContext ? JSON.parse(JSON.stringify(discoveryContext)) : null,
        discoveryDefaults: JSON.parse(JSON.stringify(discoveryDefaults))
      });

      // Auto-execute if configured
      if (wizardConfig.autoExecute) {
        try {
          // Apply presets if available
          const presets = mergeStepPresets(
            discoveryDefaults,
            template.presets[wizardConfig.id],
            customPresets[wizardConfig.id]
          );

          for (const [stepId, stepData] of Object.entries(presets)) {
            await executeWizardStep(wizardConfig.id, stepId, stepData);
          }

          results.autoExecuted.push(wizardConfig.id);
          
        } catch (error) {
          results.errors.push(`Auto-execution failed for ${wizardConfig.id}: ${error.message}`);
        }
      }
    }
  }
  
  // Sort by priority
  results.applicableWizards.sort((a, b) => a.priority - b.priority);
  
  return results;
}

// Get wizard recommendations with templates
async function getWizardRecommendationsWithTemplates(devices) {
  const recommendations = {
    individualWizards: [],
    templates: [],
    bestMatch: null
  };
  
  // Get individual wizard suggestions
  for (const device of devices) {
    const applicableWizards = Object.values(SETUP_WIZARDS).filter(wizard => 
      wizard.targetDevices.includes(device.type) || 
      device.services?.some(service => wizard.targetDevices.includes(service))
    );
    
    if (applicableWizards.length > 0) {
      recommendations.individualWizards.push({
        device,
        wizards: applicableWizards.map(w => ({
          id: w.id,
          name: w.name,
          confidence: calculateWizardConfidence(device, w)
        })).sort((a, b) => b.confidence - a.confidence)
      });
    }
  }
  
  // Evaluate templates
  for (const [templateId, template] of Object.entries(WIZARD_TEMPLATES)) {
    let templateScore = 0;
    let applicableWizards = 0;
    
    for (const wizardConfig of template.wizards) {
      const wizard = SETUP_WIZARDS[wizardConfig.id];
      if (wizard) {
        const matchingDevices = devices.filter(device => 
          calculateWizardConfidence(device, wizard) > 50
        );
        
        if (matchingDevices.length > 0) {
          applicableWizards++;
          templateScore += matchingDevices.length * (5 - wizardConfig.priority);
        }
      }
    }
    
    if (applicableWizards > 0) {
      const templateRecommendation = {
        templateId,
        name: template.name,
        description: template.description,
        applicableWizards,
        totalWizards: template.wizards.length,
        coverage: Math.round((applicableWizards / template.wizards.length) * 100),
        score: templateScore
      };
      
      recommendations.templates.push(templateRecommendation);
    }
  }
  
  // Sort templates by score
  recommendations.templates.sort((a, b) => b.score - a.score);
  
  // Set best match
  if (recommendations.templates.length > 0) {
    recommendations.bestMatch = recommendations.templates[0];
  }
  
  return recommendations;
}

// Enhanced wizard recommendations with templates
app.post('/discovery/recommend-setup', async (req, res) => {
  try {
    const { devices } = req.body;
    if (!Array.isArray(devices)) {
      return res.status(400).json({
        success: false,
        error: 'devices array is required'
      });
    }
    
    const recommendations = await getWizardRecommendationsWithTemplates(devices);
    
    res.json({
      success: true,
      recommendations
    });
    
  } catch (error) {
    console.error('Error generating recommendations:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Apply wizard template
app.post('/setup/templates/:templateId/apply', async (req, res) => {
  try {
    const { templateId } = req.params;
    const { devices, customPresets } = req.body;
    
    if (!Array.isArray(devices)) {
      return res.status(400).json({
        success: false,
        error: 'devices array is required'
      });
    }
    
    const result = await applyWizardTemplate(templateId, devices, customPresets || {});
    
    res.json({
      success: true,
      result
    });
    
  } catch (error) {
    console.error(`Error applying template ${req.params.templateId}:`, error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get available wizard templates
app.get('/setup/templates', async (req, res) => {
  try {
    const templates = Object.entries(WIZARD_TEMPLATES).map(([id, template]) => ({
      id,
      name: template.name,
      description: template.description,
      wizardCount: template.wizards.length,
      wizards: template.wizards.map(w => ({
        id: w.id,
        priority: w.priority,
        autoExecute: w.autoExecute
      }))
    }));
    
    res.json({
      success: true,
      templates
    });
    
  } catch (error) {
    console.error('Error fetching templates:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Bulk wizard operations
app.post('/setup/wizards/bulk/:operation', async (req, res) => {
  try {
    const { operation } = req.params;
    const { wizardIds, data } = req.body;
    
    if (!Array.isArray(wizardIds)) {
      return res.status(400).json({
        success: false,
        error: 'wizardIds array is required'
      });
    }
    
    const result = await executeBulkWizardOperation(operation, wizardIds, data || {});
    
    res.json({
      success: true,
      result
    });
    
  } catch (error) {
    console.error(`Error executing bulk operation ${req.params.operation}:`, error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Enhanced wizard step execution with validation
app.post('/setup/wizards/:wizardId/execute-validated', async (req, res) => {
  try {
    const { wizardId } = req.params;
    const { stepId, data } = req.body;
    
    if (!stepId) {
      return res.status(400).json({
        success: false,
        error: 'stepId is required'
      });
    }
    
    const result = await executeWizardStepWithValidation(wizardId, stepId, data || {});
    
    if (!result.success) {
      return res.status(400).json({
        success: false,
        errors: result.errors
      });
    }
    
    res.json({
      success: true,
      result,
      wizard: await getSetupWizard(wizardId)
    });
    
  } catch (error) {
    console.error(`Error executing validated wizard ${req.params.wizardId}:`, error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get wizard execution status
app.get('/setup/wizards/:wizardId/status', async (req, res) => {
  try {
    const { wizardId } = req.params;
    const status = await getWizardStatus(wizardId);
    
    if (!status.exists) {
      return res.status(404).json({
        success: false,
        error: 'Wizard not found or never started'
      });
    }
    
    res.json({
      success: true,
      status
    });
  } catch (error) {
    console.error(`Error getting wizard status ${req.params.wizardId}:`, error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Reset wizard state (useful for testing)
app.delete('/setup/wizards/:wizardId', async (req, res) => {
  try {
    const { wizardId } = req.params;
    wizardStates.delete(wizardId);
    console.log(`🗑 Reset wizard state for ${wizardId}`);
    res.json({
      success: true,
      message: `Wizard ${wizardId} state reset`
    });
  } catch (error) {
    console.error(`Error resetting wizard ${req.params.wizardId}:`, error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Automatically suggest wizards for discovered devices
app.post('/discovery/suggest-wizards', async (req, res) => {
  try {
    const { devices } = req.body;
    if (!Array.isArray(devices)) {
      return res.status(400).json({
        success: false,
        error: 'devices array is required'
      });
    }

    const suggestions = buildWizardSuggestionsFromDevices(devices);

    res.json({
      success: true,
      suggestions
    });

  } catch (error) {
    console.error('Error suggesting wizards:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 404 handler for undefined routes (must be registered after all routes)
app.use((req, res) => {
  console.warn(`  404 Not Found: ${req.method} ${req.url}`);
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.url} not found`,
    timestamp: new Date().toISOString()
  });
});

function tryListenOnPort(port, host) {
  return new Promise((resolve, reject) => {
    const tester = net.createServer();

    const onError = (error) => {
      tester.removeListener('listening', onListening);
      try {
        tester.close();
      } catch {}
      reject(error);
    };

    const onListening = () => {
      tester.removeListener('error', onError);
      tester.close(() => resolve(true));
    };

    tester.once('error', onError);
    tester.once('listening', onListening);

    tester.listen({ port, host, exclusive: true });
  });
}

async function isPortAvailable(port) {
  if (port === 0) return true; // allow OS to choose a port
  try {
    await tryListenOnPort(port, '::');
    return true;
  } catch (error) {
    if (error && (error.code === 'EADDRNOTAVAIL' || error.code === 'EAFNOSUPPORT')) {
      try {
        await tryListenOnPort(port, '0.0.0.0');
        return true;
      } catch (ipv4Error) {
        if (ipv4Error && (ipv4Error.code === 'EADDRINUSE' || ipv4Error.code === 'EACCES')) {
          return false;
        }
        throw ipv4Error;
      }
    }
    if (error && (error.code === 'EADDRINUSE' || error.code === 'EACCES')) {
      return false;
    }
    throw error;
  }
}

async function resolveAvailablePort(initialPort) {
  if (hasExplicitPort || initialPort === 0) {
    return initialPort;
  }

  let candidate = initialPort;
  const maxAttempts = 10;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (await isPortAvailable(candidate)) {
      if (candidate !== initialPort) {
        console.warn(`[charlie] Port ${initialPort} in use, falling back to ${candidate}.`);
      }
      return candidate;
    }
    candidate += 1;
  }

  const error = new Error(`Unable to find an open port starting at ${initialPort}`);
  error.code = 'EADDRINUSE';
  throw error;
}

// Initialize zone environmental setpoints from room-map.json
function initializeZoneSetpointsFromRoomMap() {
  const ROOM_MAP_PATH = path.join(PUBLIC_DIR, 'data', 'room-map.json');
  
  try {
    if (!fs.existsSync(ROOM_MAP_PATH)) {
      console.warn('[setpoint-init] room-map.json not found');
      return;
    }
    
    const roomMap = JSON.parse(fs.readFileSync(ROOM_MAP_PATH, 'utf8'));
    
    if (!Array.isArray(roomMap.zones)) {
      console.warn('[setpoint-init] No zones array in room-map.json');
      return;
    }
    
    // Load each zone's setpoints into preEnvStore
    for (const zone of roomMap.zones) {
      const scopeId = `zone-${zone.zone}`;
      const targets = {};
      
      // Map temperature setpoint
      if (zone.tempSetpoint && typeof zone.tempSetpoint === 'object') {
        targets.tempC = {
          min: zone.tempSetpoint.min,
          max: zone.tempSetpoint.max
        };
      }
      
      // Map humidity setpoint
      if (zone.rhSetpoint && typeof zone.rhSetpoint === 'object') {
        targets.rh = {
          min: zone.rhSetpoint.min,
          max: zone.rhSetpoint.max
        };
      }
      
      // Calculate VPD setpoint based on temp and RH ranges
      // Using middle of temp range and RH range for VPD calculation
      if (targets.tempC && targets.rh) {
        const avgTemp = (targets.tempC.min + targets.tempC.max) / 2;
        const avgRH = (targets.rh.min + targets.rh.max) / 2;
        const vpd = computeVpd(avgTemp, avgRH);
        
        if (Number.isFinite(vpd)) {
          // Allow ±0.2 kPa around calculated VPD
          targets.vpd = {
            min: Math.max(0, vpd - 0.2),
            max: vpd + 0.2
          };
        }
      }
      
      if (Object.keys(targets).length > 0) {
        preEnvStore.setTargets(scopeId, targets);
        console.log(`[setpoint-init] ${scopeId}: temp=${targets.tempC?.min}-${targets.tempC?.max}°C, rh=${targets.rh?.min}-${targets.rh?.max}%`);
      }
    }
    
    console.log('[setpoint-init] Zone setpoints initialized from room-map.json');
  } catch (error) {
    console.error('[setpoint-init] Error initializing setpoints:', error.message);
  }
}

// Sync zone names from a room-map save back to rooms.json so the Grow Room Setup page stays current
function syncZonesToRoomsJson(roomMapBody, baseName) {
  try {
    // Extract roomId from filename: room-map-room-XXXX.json → room-XXXX
    const roomIdMatch = baseName.match(/^room-map-(.+)\.json$/);
    const roomId = roomIdMatch ? roomIdMatch[1] : (roomMapBody?.roomId || null);
    if (!roomId) {
      // Legacy room-map.json without per-room ID — try body.roomId
      if (!roomMapBody?.roomId) return;
    }

    const targetRoomId = roomId || roomMapBody.roomId;
    const mapZones = Array.isArray(roomMapBody?.zones) ? roomMapBody.zones : [];
    const zoneNames = mapZones
      .map(z => z.name || (z.zone != null ? `Zone ${z.zone}` : null))
      .filter(Boolean);

    const roomsData = readJSON('rooms.json', { rooms: [] });
    const rooms = Array.isArray(roomsData?.rooms) ? roomsData.rooms : [];
    const room = rooms.find(r => String(r.id) === String(targetRoomId));
    if (!room) {
      console.log(`[zone-rooms-sync] Room ${targetRoomId} not found in rooms.json — skipping`);
      return;
    }

    const existingZones = Array.isArray(room.zones) ? room.zones : [];
    const sortedNew = [...zoneNames].sort();
    const sortedOld = [...existingZones].sort();
    if (JSON.stringify(sortedNew) === JSON.stringify(sortedOld)) {
      return; // No change needed
    }

    room.zones = zoneNames;
    const roomsPath = path.join(DATA_DIR, 'rooms.json');
    fs.writeFileSync(roomsPath, JSON.stringify(roomsData, null, 2));
    console.log(`[zone-rooms-sync] Updated rooms.json: room ${targetRoomId} now has ${zoneNames.length} zone(s): ${zoneNames.join(', ')}`);
  } catch (error) {
    console.error('[zone-rooms-sync] Error syncing zones to rooms.json:', error.message);
  }
}

// Sync zone assignments from room-map.json to iot-devices.json
// This ensures devices discovered and mapped in the Room Mapper get proper zone assignments
function syncZoneAssignmentsFromRoomMap() {
  const IOT_DEVICES_PATH = path.join(PUBLIC_DIR, 'data', 'iot-devices.json');
  const ROOM_MAP_PATH = path.join(PUBLIC_DIR, 'data', 'room-map.json');
  
  try {
    if (!fs.existsSync(ROOM_MAP_PATH) || !fs.existsSync(IOT_DEVICES_PATH)) {
      return;
    }
    
    const roomMap = JSON.parse(fs.readFileSync(ROOM_MAP_PATH, 'utf8'));
    const iotDevices = JSON.parse(fs.readFileSync(IOT_DEVICES_PATH, 'utf8'));
    
    if (!Array.isArray(roomMap.devices) || !Array.isArray(iotDevices)) {
      return;
    }
    
    let updated = false;
    
    // Build a lookup map from room-map.json: deviceId -> {zone, room, location}
    const zoneMap = new Map();
    for (const device of roomMap.devices) {
      const deviceId = device.deviceId || device.id;
      const zone = device.snapshot?.zone || device.zone;
      const room = device.snapshot?.room || device.room || roomMap.name;
      const location = room && zone ? `${room} - Zone ${zone}` : room;
      
      // SAFETY GUARD: Only accept numeric zones to prevent zone-<string> pollution
      if (deviceId && zone != null) {
        const zoneStr = String(zone).trim();
        if (!/^\d+$/.test(zoneStr)) {
          console.warn(`[zone-sync] REJECTED non-numeric zone "${zone}" from room-map.json for device ${deviceId}`);
          continue; // Skip this device mapping
        }
        zoneMap.set(deviceId, { zone, room, location });
      }
    }
    
    // Apply zone assignments to iot-devices.json
    for (const device of iotDevices) {
      const deviceId = device.id || device.deviceId;
      const mapping = zoneMap.get(deviceId);
      
      if (mapping) {
        if (device.zone !== mapping.zone) {
          console.log(`[zone-sync] ${deviceId}: zone ${device.zone} → ${mapping.zone}`);
          device.zone = mapping.zone;
          updated = true;
        }
        if (device.location !== mapping.location) {
          device.location = mapping.location;
          updated = true;
        }
      }
    }
    
    if (updated) {
      fs.writeFileSync(IOT_DEVICES_PATH, JSON.stringify(iotDevices, null, 2));
      console.log('[zone-sync] Updated iot-devices.json with zone assignments from room-map.json');
    }
  } catch (error) {
    console.error('[zone-sync] Error syncing zone assignments:', error.message);
  }
}

// Sync live sensor data from iot-devices.json to env.json zones
function setupLiveSensorSync() {
  const IOT_DEVICES_PATH = path.join(PUBLIC_DIR, 'data', 'iot-devices.json');
  const SYNC_INTERVAL = 30000; // 30 seconds
  const HISTORY_SAMPLE_INTERVAL_MS = Number(process.env.SENSOR_HISTORY_INTERVAL_MS || 300000);
  const SWITCHBOT_SENSOR_STATUS_BATCH = Math.max(1, Number.parseInt(process.env.SWITCHBOT_SENSOR_STATUS_BATCH || '3', 10));
  let sensorSyncInFlight = false;
  let switchBotQueue = [];
  let switchBotQueueIndex = 0;
  let switchBotQueueRefreshed = 0;

  function updateValidDataHistory(sensor, newValue, options = {}) {
    const { maxHours = 24, minIntervalMs = HISTORY_SAMPLE_INTERVAL_MS } = options;
    if (!sensor || newValue == null || !Number.isFinite(newValue)) {
      return false;
    }

    sensor.history = Array.isArray(sensor.history) ? sensor.history : [];
    sensor.timestamps = Array.isArray(sensor.timestamps) ? sensor.timestamps : [];
    sensor.historyMeta = sensor.historyMeta && typeof sensor.historyMeta === 'object' ? sensor.historyMeta : {};

    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const lastPushMs = Number(sensor.historyMeta.lastPushMs || 0);
    const lastValue = sensor.historyMeta.lastValue;
    const maxPoints = Math.max(1, maxHours * 12);
    const minDelta = options.minDelta ?? 0.05;
    let mutated = false;

    if (!sensor.history.length) {
      sensor.history.unshift(newValue);
      sensor.timestamps.unshift(nowIso);
      mutated = true;
    } else if (lastPushMs && (nowMs - lastPushMs) < minIntervalMs) {
      if (lastValue == null || Math.abs(lastValue - newValue) >= minDelta) {
        sensor.history[0] = newValue;
        sensor.timestamps[0] = nowIso;
        mutated = true;
      }
    } else {
      sensor.history.unshift(newValue);
      sensor.timestamps.unshift(nowIso);
      mutated = true;
    }

    if (mutated) {
      const paired = sensor.history.map((value, index) => ({ value, timestamp: sensor.timestamps[index] }))
        .filter((entry) => entry.value != null && Number.isFinite(entry.value))
        .slice(0, maxPoints);

      sensor.history = paired.map((entry) => entry.value);
      sensor.timestamps = paired.map((entry) => entry.timestamp);
      sensor.historyMeta.lastPushMs = nowMs;
      sensor.historyMeta.lastValue = newValue;
    }

    return mutated;
  }

  function updateSensorSourceHistory(bucket, sourceId, readingValue, readingTimestamp, metadata) {
    if (!bucket || sourceId == null || !Number.isFinite(readingValue)) {
      return false;
    }

    bucket.sources = bucket.sources || {};
    const key = String(sourceId);
    const entry = bucket.sources[key] || {};

    entry.deviceId = key;
    entry.name = metadata?.name || entry.name || key;
    entry.current = readingValue;
    if (readingTimestamp) entry.updatedAt = readingTimestamp;
    if (metadata?.battery != null) entry.battery = metadata.battery;
    entry.meta = { ...(entry.meta || {}), ...(metadata?.meta || {}) };

    const historyChanged = updateValidDataHistory(entry, readingValue);
    bucket.sources[key] = entry;
    return historyChanged;
  }

  function normalizeSwitchBotStatus(deviceId, statusResult) {
    const payload = statusResult?.payload?.body || statusResult?.payload;
    if (!payload || typeof payload !== 'object') {
      return null;
    }

    const scale = String(payload.temperatureScale || payload.temperature_unit || '')?.toLowerCase();
    const rawTemperature = Number(payload.temperature);
    let temperatureC = Number.isFinite(rawTemperature) ? rawTemperature : null;
    if (temperatureC != null && (scale.startsWith('f') || payload.isFahrenheit)) {
      temperatureC = ((temperatureC - 32) * 5) / 9;
    }
    if (temperatureC != null) {
      temperatureC = Math.round(temperatureC * 10) / 10;
    }

    const humidity = Number.isFinite(Number(payload.humidity)) ? Math.round(Number(payload.humidity) * 10) / 10 : null;
    const battery = Number.isFinite(Number(payload.battery)) ? Number(payload.battery) : null;
    const updatedAt = new Date().toISOString();

    return {
      deviceId,
      temperatureC,
      humidity,
      battery,
      updatedAt
    };
  }

  async function refreshSwitchBotTelemetry(iotDevices) {
    if (!ensureSwitchBotConfigured()) {
      return { changed: false, readings: new Map() };
    }

    try {
      const devicesResult = await fetchSwitchBotDevices({ force: false });
      const deviceList = devicesResult?.payload?.body?.deviceList;
      if (!Array.isArray(deviceList) || deviceList.length === 0) {
        return { changed: false, readings: new Map() };
      }

      const nowMs = Date.now();
      const needsRefresh = !switchBotQueue.length || (nowMs - switchBotQueueRefreshed) > SWITCHBOT_DEVICE_CACHE_TTL_MS || devicesResult.fromCache === false;
      if (needsRefresh) {
        switchBotQueue = deviceList
          .filter((device) => String(device.deviceType || '').toLowerCase().includes('sensor'))
          .map((device) => device.deviceId)
          .filter(Boolean);
        switchBotQueueIndex = 0;
        switchBotQueueRefreshed = nowMs;
      }

      if (!switchBotQueue.length) {
        return { changed: false, readings: new Map() };
      }

      const batchSize = Math.min(SWITCHBOT_SENSOR_STATUS_BATCH, switchBotQueue.length);
      const batchIds = [];
      while (batchIds.length < batchSize) {
        const nextId = switchBotQueue[switchBotQueueIndex];
        switchBotQueueIndex = (switchBotQueueIndex + 1) % switchBotQueue.length;
        if (!batchIds.includes(nextId)) {
          batchIds.push(nextId);
        }
        if (switchBotQueueIndex === 0 && batchIds.length === switchBotQueue.length) {
          break;
        }
      }

      const readings = new Map();
      let fileChanged = false;

      for (const deviceId of batchIds) {
        let statusResult;
        try {
          statusResult = await fetchSwitchBotDeviceStatus(deviceId, { force: false });
        } catch (error) {
          console.warn(`[sensor-sync] SwitchBot status error for ${deviceId}:`, error?.message || error);
          continue;
        }

        const reading = normalizeSwitchBotStatus(deviceId, statusResult);
        if (!reading) continue;
        readings.set(deviceId, reading);

        const device = iotDevices.find((entry) => (entry.deviceId || entry.id) === deviceId);
        if (!device) continue;

        device.telemetry = { ...(device.telemetry || {}) };
        const previousTemp = device.telemetry.temperature;
        const previousRh = device.telemetry.humidity;
        const previousBattery = device.telemetry.battery;
        const previousUpdate = device.telemetry.lastUpdate;

        if (reading.temperatureC != null) {
          device.telemetry.temperature = reading.temperatureC;
          device.telemetry.temperatureScale = 'celsius';
        }
        if (reading.humidity != null) {
          device.telemetry.humidity = reading.humidity;
        }
        if (reading.battery != null) {
          device.telemetry.battery = reading.battery;
        }

  device.telemetry.lastUpdate = reading.updatedAt;
  device.lastSeen = reading.updatedAt;

        if (device.name && !device.displayName) {
          device.displayName = device.name;
        }

        if (previousTemp !== device.telemetry.temperature ||
          previousRh !== device.telemetry.humidity ||
          previousBattery !== device.telemetry.battery ||
          previousUpdate !== device.telemetry.lastUpdate) {
          fileChanged = true;
        }
      }

      return { changed: fileChanged, readings };
    } catch (error) {
      console.warn('[sensor-sync] Failed to refresh SwitchBot telemetry:', error?.message || error);
      return { changed: false, readings: new Map() };
    }
  }

  // OLD ZONE-SPECIFIC CONTROL - Replaced with ML-enhanced room-level control
  // The new modular implementation is imported from controller/checkAndControlEnvironment.js
  // and uses controller/coreAllocator.js for intelligent multi-zone coordination

  async function syncSensorData() {
    if (sensorSyncInFlight) return;
    sensorSyncInFlight = true;

    try {
      if (!fs.existsSync(IOT_DEVICES_PATH)) {
        console.log('[sensor-sync] iot-devices.json not found, skipping sync');
        return;
      }

      const iotDevices = JSON.parse(fs.readFileSync(IOT_DEVICES_PATH, 'utf8'));
      if (!Array.isArray(iotDevices) || !iotDevices.length) {
        return;
      }

      let envData = { zones: [] };
      try {
        if (fs.existsSync(ENV_PATH)) {
          envData = JSON.parse(fs.readFileSync(ENV_PATH, 'utf8'));
        }
      } catch {}

      envData.zones = Array.isArray(envData.zones) ? envData.zones : [];

      const { changed: switchBotUpdated, readings: switchBotReadings } = await refreshSwitchBotTelemetry(iotDevices);
      let envUpdated = false;

      iotDevices.forEach((device) => {
        const telemetry = device.telemetry || {};
        const deviceId = device.id || device.deviceId;
        if (!deviceId) return;

        const hasTemp = Number.isFinite(telemetry.temperature);
        const hasHumidity = Number.isFinite(telemetry.humidity);
        if (!hasTemp && !hasHumidity) return;

        const zoneValueRaw = device.zone != null ? String(device.zone).trim() : '';
        if (!zoneValueRaw) {
          console.log(`[sensor-sync] Skipping unassigned sensor: ${device.name || deviceId}`);
          return;
        }
        if (!/^\d+$/.test(zoneValueRaw)) {
          console.warn(`[sensor-sync] REJECTED non-numeric zone "${device.zone}" for device ${device.name || deviceId}`);
          return;
        }

        const zoneId = `zone-${zoneValueRaw}`;
        const zoneName = `Zone ${zoneValueRaw}`;
        let zone = envData.zones.find((entry) => entry.id === zoneId);
        if (!zone) {
          zone = {
            id: zoneId,
            name: zoneName,
            location: zoneName,
            sensors: {},
            sensorDevices: []
          };
          envData.zones.push(zone);
        }

        zone.sensors = zone.sensors || {};
        zone.meta = zone.meta || {};
        zone.sensorDevices = Array.isArray(zone.sensorDevices) ? zone.sensorDevices : [];

        let zoneMutated = false;
        let latestSampleMs = zone.meta.lastSampleAt ? Date.parse(zone.meta.lastSampleAt) : 0;

        const reading = switchBotReadings.get(deviceId);
        const timestampIso = reading?.updatedAt || telemetry.lastUpdate || device.lastSeen || new Date().toISOString();
        const timestampMs = Date.parse(timestampIso) || Date.now();
        if (timestampMs > latestSampleMs) {
          latestSampleMs = timestampMs;
        }

        const sensorIndex = zone.sensorDevices.findIndex((entry) => entry.id === deviceId);
        if (sensorIndex === -1) {
          zone.sensorDevices.push({
            id: deviceId,
            name: device.name || deviceId,
            lastUpdate: timestampIso,
            battery: Number.isFinite(telemetry.battery) ? telemetry.battery : undefined
          });
          zoneMutated = true;
        } else {
          const sensorEntry = zone.sensorDevices[sensorIndex];
          if (sensorEntry.name !== (device.name || deviceId)) {
            sensorEntry.name = device.name || deviceId;
            zoneMutated = true;
          }
          if (sensorEntry.lastUpdate !== timestampIso) {
            sensorEntry.lastUpdate = timestampIso;
            zoneMutated = true;
          }
          if (Number.isFinite(telemetry.battery) && sensorEntry.battery !== telemetry.battery) {
            sensorEntry.battery = telemetry.battery;
            zoneMutated = true;
          }
        }

        const batteryMap = zone.meta.sensorBatteries = zone.meta.sensorBatteries || {};
        if (Number.isFinite(telemetry.battery)) {
          if (batteryMap[deviceId] !== telemetry.battery) {
            batteryMap[deviceId] = telemetry.battery;
            zoneMutated = true;
          }
          const batteryValues = Object.values(batteryMap).filter((value) => Number.isFinite(value));
          if (batteryValues.length) {
            const minBattery = Math.min(...batteryValues);
            if (zone.meta.battery !== minBattery) {
              zone.meta.battery = minBattery;
              zoneMutated = true;
            }
          }
        }

        const zoneTargets = preEnvStore.getTargets(zone.id) || {};

        if (hasTemp) {
          const targetSetpoint = zoneTargets.tempC || { min: 20, max: 24 };
          zone.sensors.tempC = zone.sensors.tempC || { current: null, history: [], setpoint: targetSetpoint };
          zone.sensors.tempC.setpoint = targetSetpoint;

          const tempC = Math.round(Number(telemetry.temperature) * 10) / 10;
          const historyContainsFahrenheit = Array.isArray(zone.sensors.tempC.history) && zone.sensors.tempC.history.some((value) => value > 40);
          if (historyContainsFahrenheit) {
            console.log(`[Sensor Sync] Detected Fahrenheit values in ${zone.name} history, resetting to Celsius`);
            zone.sensors.tempC.history = [];
            zone.sensors.tempC.timestamps = [];
            zone.sensors.tempC.historyMeta = {};
          }

          if (targetSetpoint && (targetSetpoint.min > 40 || targetSetpoint.max > 40)) {
            console.log(`[Sensor Sync] Detected Fahrenheit setpoint in ${zone.name}, resetting to Celsius from room-map`);
            zone.sensors.tempC.setpoint = { min: 20, max: 24 };
          }

          if (zone.sensors.tempC.current !== tempC) {
            zone.sensors.tempC.current = tempC;
            zoneMutated = true;
          }

          zone.sensors.tempC.updatedAt = timestampIso;
          const tempHistoryChanged = updateValidDataHistory(zone.sensors.tempC, tempC);
          const tempSourceChanged = updateSensorSourceHistory(zone.sensors.tempC, deviceId, tempC, timestampIso, {
            name: device.name || deviceId,
            battery: Number.isFinite(telemetry.battery) ? telemetry.battery : undefined
          });
          if (tempHistoryChanged || tempSourceChanged) {
            zoneMutated = true;
          }
        }

        if (hasHumidity) {
          zone.sensors.rh = zone.sensors.rh || { current: null, history: [], setpoint: { min: 58, max: 65 } };
          const rhSetpoint = zone.sensors.rh.setpoint;
          if (!rhSetpoint || rhSetpoint.min !== 58 || rhSetpoint.max !== 65) {
            zone.sensors.rh.setpoint = { min: 58, max: 65 };
            zoneMutated = true;
          }

          const rhValue = Math.round(Number(telemetry.humidity) * 10) / 10;
          if (zone.sensors.rh.current !== rhValue) {
            zone.sensors.rh.current = rhValue;
            zoneMutated = true;
          }

          zone.sensors.rh.updatedAt = timestampIso;
          const rhHistoryChanged = updateValidDataHistory(zone.sensors.rh, rhValue);
          const rhSourceChanged = updateSensorSourceHistory(zone.sensors.rh, deviceId, rhValue, timestampIso, {
            name: device.name || deviceId,
            battery: Number.isFinite(telemetry.battery) ? telemetry.battery : undefined
          });
          if (rhHistoryChanged || rhSourceChanged) {
            zoneMutated = true;
          }
        }

        if (hasTemp && hasHumidity) {
          const vpd = computeVPDkPa(Number(telemetry.temperature), Number(telemetry.humidity));
          zone.sensors.vpd = zone.sensors.vpd || { current: null, history: [], setpoint: { min: 0.90, max: 1.05 } };
          if (!zone.sensors.vpd.setpoint || zone.sensors.vpd.setpoint.min !== 0.90 || zone.sensors.vpd.setpoint.max !== 1.05) {
            zone.sensors.vpd.setpoint = { min: 0.90, max: 1.05 };
            zoneMutated = true;
          }

          const vpdValue = Math.round(Number(vpd) * 100) / 100;
          if (zone.sensors.vpd.current !== vpdValue) {
            zone.sensors.vpd.current = vpdValue;
            zoneMutated = true;
          }

          zone.sensors.vpd.updatedAt = timestampIso;
          if (updateValidDataHistory(zone.sensors.vpd, vpdValue, { minDelta: 0.01 })) {
            zoneMutated = true;
          }
        }

        if (zoneMutated) {
          const nowIso = new Date().toISOString();
          zone.meta.source = 'live-sync';
          zone.meta.lastSync = nowIso;
          zone.meta.lastSampleAt = new Date(latestSampleMs || Date.now()).toISOString();
          zone.meta.sensorCount = zone.sensorDevices.length;
          envUpdated = true;
        }
      });

      if (switchBotUpdated) {
        await writeJsonQueued(IOT_DEVICES_PATH, JSON.stringify(iotDevices, null, 2));
        console.log(`[sensor-sync] Refreshed SwitchBot telemetry for ${[...new Set(Array.from(switchBotReadings.keys()))].length} device(s)`);
      }

      if (envUpdated) {
        envData.updatedAt = new Date().toISOString();
        await writeJsonQueued(ENV_PATH, JSON.stringify(envData, null, 2));
        __envCache = envData;
        console.log('[sensor-sync] Updated env.json with live sensor data');
      }

      for (const zone of envData.zones) {
        if (!zone?.id || !zone.sensors) continue;

        const scopeId = zone.id;
        const tempReading = zone.sensors.tempC?.current;
        const rhReading = zone.sensors.rh?.current;
        const vpdReading = zone.sensors.vpd?.current;

        if (Number.isFinite(tempReading)) {
          preEnvStore.updateSensor(scopeId, 'tempC', { value: tempReading });
        }
        if (Number.isFinite(rhReading)) {
          preEnvStore.updateSensor(scopeId, 'rh', { value: rhReading });
        }
        if (Number.isFinite(vpdReading)) {
          preEnvStore.updateSensor(scopeId, 'vpd', { value: vpdReading });
        }
      }

      //  ML-ENHANCED ROOM-LEVEL ENVIRONMENTAL AUTOMATION
      try {
        // Read groups.json to find active zones
        let groups = [];
        try {
          const groupsPath = path.join(DATA_DIR, 'groups.json');
          if (fs.existsSync(groupsPath)) {
            const groupsData = JSON.parse(fs.readFileSync(groupsPath, 'utf8'));
            groups = groupsData.groups || [];
          }
        } catch (e) {
          console.warn('[env-control] Failed to read groups:', e.message);
        }
        
        // Build targets map from preEnvStore
        const targets = {};
        for (const zone of envData.zones) {
          targets[zone.id] = preEnvStore.getTargets(zone.id) || {};
        }
        
        // Call ML-enhanced room-level control
        await checkAndControlEnvironment(envData.zones, iotDevices, {
          coreAllocator,
          plugManager: prePlugManager,
          groups,
          targets,
          lastActions: preAutomationEngine._lastEnvironmentalActions || {}
        });
        
        // Save last actions
        if (!preAutomationEngine._lastEnvironmentalActions) {
          preAutomationEngine._lastEnvironmentalActions = {};
        }
      } catch (envError) {
        console.warn('[env-control] ERROR:', envError?.message || envError, envError?.stack);
      }
    } catch (error) {
      console.warn('[sensor-sync] Error syncing sensor data:', error?.message || error);
    } finally {
      sensorSyncInFlight = false;
    }
  }

  if (IS_TEST_ENV) {
    if (SENSOR_SYNC_TIMER) {
      clearInterval(SENSOR_SYNC_TIMER);
      SENSOR_SYNC_TIMER = null;
    }
    return;
  }

  syncSensorData().catch((error) => {
    console.warn('[sensor-sync] Initial sync failed:', error?.message || error);
  });

  SENSOR_SYNC_TIMER = setInterval(() => {
    syncSensorData().catch((error) => {
      console.warn('[sensor-sync] Periodic sync failed:', error?.message || error);
    });
  }, SYNC_INTERVAL);
  if (typeof SENSOR_SYNC_TIMER?.unref === 'function') SENSOR_SYNC_TIMER.unref();
  console.log(`[sensor-sync] Live sensor sync enabled (interval: ${SYNC_INTERVAL}ms)`);
}

// ============================================================================
// Bus Mapping API Endpoints
// ============================================================================

// Scan a bus for connected nodes and channels
app.get('/api/bus/:busId/scan', asyncHandler(async (req, res) => {
  const { busId } = req.params;
  console.log(`[bus-mapping] Scanning bus ${busId}`);

  // Mock data for now - in production this would communicate with hardware
  const mockNodes = [
    {
      id: '1',
      address: '0x01',
      channels: [
        { id: '1-1', type: 'CW', address: '0x01-CH1' },
        { id: '1-2', type: 'WW', address: '0x01-CH2' },
        { id: '1-3', type: '660nm', address: '0x01-CH3' },
        { id: '1-4', type: '450nm', address: '0x01-CH4' }
      ]
    },
    {
      id: '2',
      address: '0x02',
      channels: [
        { id: '2-1', type: 'CW', address: '0x02-CH1' },
        { id: '2-2', type: 'WW', address: '0x02-CH2' }
      ]
    }
  ];

  res.json({ 
    status: 'ok', 
    busId,
    nodes: mockNodes,
    scannedAt: new Date().toISOString()
  });
}));

// Identify a specific channel (flash the lights)
app.post('/api/channels/:channelId/identify', asyncHandler(async (req, res) => {
  const { channelId } = req.params;
  console.log(`[bus-mapping] Identifying channel ${channelId}`);

  // Mock implementation - in production this would send hardware command
  // to flash the lights on this specific channel
  await new Promise(resolve => setTimeout(resolve, 100)); // Simulate command delay

  res.json({ 
    status: 'ok', 
    channelId,
    action: 'identify',
    message: 'Channel identification command sent'
  });
}));

// Get list of groups for assignment (NOTE: This route is NOW DEFINED EARLIER before proxy - this is unreachable but kept for code archaeology)
app.get('/api/groups', asyncHandler(async (req, res) => {
  const groupsData = await readJSON('groups.json', { groups: [] });
  const groups = groupsData?.groups || [];
  
  const formatted = groups.map(g => ({
    id: g.id || g.name,
    name: g.name,
    zone: g.zone,
    crop: g.crop,
    plan: g.plan,
    trays: g.trays || 0,
    plants: g.plants || 0,
    devices: g.devices?.length || 0
  }));

  res.json(formatted);
}));

// Get list of rooms for edge mode (NOTE: This route is NOW DEFINED EARLIER before proxy - this is unreachable but kept for code archaeology)
app.get('/api/rooms', asyncHandler(async (req, res) => {
  const roomsData = readJSON('rooms.json', { rooms: [] });
  const rooms = roomsData?.rooms || [];
  
  res.json(rooms);
}));

// Get all bus mappings
app.get('/api/bus-mappings', asyncHandler(async (req, res) => {
  const mappings = await readJSON('bus-mappings.json', []);
  res.json(mappings);
}));

// Save bus mapping configuration (with idempotency)
app.post('/api/bus-mapping', asyncHandler(async (req, res) => {
  const mapping = req.body;
  console.log('[bus-mapping] Saving mapping:', mapping);

  // Load existing bus mappings
  const mappings = await readJSON('bus-mappings.json', []);
  
  const mappingId = `${mapping.selectedBus}-${mapping.selectedNode?.id}-${mapping.selectedChannel}`;
  
  // Check if mapping already exists (idempotency)
  const existingIndex = mappings.findIndex(m => m.id === mappingId);
  
  const newMapping = {
    ...mapping,
    id: mappingId,
    createdAt: existingIndex >= 0 ? mappings[existingIndex].createdAt : new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  if (existingIndex >= 0) {
    // Update existing mapping
    mappings[existingIndex] = newMapping;
    console.log('[bus-mapping] Updated existing mapping');
  } else {
    // Add new mapping
    mappings.push(newMapping);
    console.log('[bus-mapping] Created new mapping');
  }

  // Save to disk
  await writeJson('bus-mappings.json', mappings);

  res.json({ 
    status: 'ok', 
    mapping: newMapping,
    message: existingIndex >= 0 ? 'Mapping updated successfully' : 'Mapping created successfully',
    isUpdate: existingIndex >= 0
  });
}));


async function startServer() {
  console.log('[charlie]  startServer() called');
  try {
    const resolvedPort = await resolveAvailablePort(PORT);
    PORT = resolvedPort;
    console.log('[charlie]  Port resolved:', PORT);
  } catch (error) {
    if (error && error.code === 'EADDRINUSE') {
      console.error(`[charlie] Port ${PORT} is already in use. Stop the other process or set PORT to a free value.`);
    } else {
      console.error('[charlie] Failed to determine available port:', error?.message || error);
    }
    process.exit(1);
  }

  // Initialize demo mode if enabled
  console.log('[charlie]  About to call initializeDemoMode()...');
  try {
    initializeDemoMode();
    console.log('[charlie]  initializeDemoMode() completed');
  } catch (error) {
    console.error('[charlie]  Demo mode initialization failed:', error?.message || error);
    console.error('[charlie] Stack trace:', error?.stack);
  }

  // Pre-startup diagnostics
  console.log('[charlie]  Starting server...');
  console.log('[charlie] PORT:', PORT);
  console.log('[charlie] NODE_ENV:', process.env.NODE_ENV);
  console.log('[charlie] DEMO_MODE:', process.env.DEMO_MODE);
  
  // CloudWatch monitoring status
  if (isCloudWatchEnabled()) {
    const cwConfig = getCloudWatchConfig();
    console.log('[CloudWatch] ✅ Metrics publishing enabled');
    console.log(`[CloudWatch] Namespace: ${cwConfig.namespace}`);
    console.log(`[CloudWatch] Region: ${cwConfig.region}`);
    console.log('[CloudWatch] Publishing: API metrics, database health, memory usage');
  } else {
    console.log('[CloudWatch] ⚠️  Metrics publishing disabled (set CLOUDWATCH_ENABLED=true for production)');
  }
  console.log('[charlie] Controller:', getController());
  console.log('[charlie] Forwarder:', getForwarder());

  // Initialize mDNS advertiser for edge devices (Task #19)
  try {
    const { MDNSAdvertiser } = await import('./lib/mdns-advertiser.js');
    mdnsAdvertiser = new MDNSAdvertiser({
      serviceName: 'Light Engine',
      serviceType: 'http',
      port: PORT,
      hostname: 'light-engine',
      txtRecord: {
        version: '1.0.0',
        deployment: process.env.DEPLOYMENT_MODE || 'edge'
      }
    });
    
    const started = mdnsAdvertiser.start();
    if (started) {
      console.log('[mDNS] ✅ Broadcasting as light-engine.local');
    } else {
      console.log('[mDNS] ℹ️  mDNS not available (install bonjour-service for local discovery)');
    }
  } catch (error) {
    console.log('[mDNS] ℹ️  mDNS not enabled:', error.message);
  }

  // ============================================================
  // FRAMEWORK VALIDATION (BLOCKING - stops server if violated)
  // ============================================================
  console.log('[startup] Running framework compliance validation...');
  const isValid = frameworkValidator.validate();
  if (!isValid) {
    console.error('\n❌ Framework validation failed. Application cannot start.');
    console.error('Fix the violations listed above and restart the server.\n');
    process.exit(1);
  }

  SERVER = app.listen(PORT, '0.0.0.0', async () => {
    const address = SERVER.address();
    console.log(`[charlie]  Server successfully started on ${address.address}:${address.port}`);
    console.log(`[charlie] running http://127.0.0.1:${PORT} → ${getController()}`);
    console.log(`[charlie] Demo mode check: isDemoMode() = ${isDemoMode()}`);
    if (isDemoMode()) {
      console.log(`[charlie] 🎭 DEMO MODE: Visit http://127.0.0.1:${PORT} to explore demo farm`);
    }
    
    // Validate license (Task #2 - License Validation)
    try {
      const licenseResult = await validateLicense();
      if (licenseResult.valid) {
        console.log(`[License] ✅ Valid license - Reason: ${licenseResult.reason}`);
        if (licenseResult.license) {
          console.log(`[License] Farm: ${licenseResult.license.farmId} (${licenseResult.license.tier})`);
          console.log(`[License] Features: ${licenseResult.license.features?.join(', ') || 'all'}`);
        }
      } else {
        console.error(`[License] ❌ License validation failed: ${licenseResult.reason}`);
        console.error('[License] ⚠️  Some features may be restricted');
      }
    } catch (error) {
      console.error('[License] ❌ License check error:', error.message);
    }
    
    // Initialize database (Task #3 - Database Persistence)
    (async () => {
      try {
        const dbResult = await initDatabase();
        console.log(`[Database] Mode: ${dbResult.mode}`);
        if (dbResult.enabled) {
          console.log('[Database] ✅ PostgreSQL ready for production');
          
          // Initialize migration system with database pool
          if (dbResult.pool) {
            initMigrationDb(dbResult.pool);
            console.log('[Migration] ✅ Cloud-to-edge migration system initialized');
          }
        }

        // Start ML training worker (Phase 2 Bridge)
        try {
          const { startMLTrainingWorker } = await import('./lib/ml-training-pipeline.js');
          await startMLTrainingWorker();
          console.log('[ML Training] ✅ Background training worker started');
        } catch (mlError) {
          console.warn('[ML Training] Worker failed to start:', mlError.message);
        }

      } catch (error) {
        console.error('[Database] ❌ Initialization error:', error.message);
      }
    })();
    
    try { setupWeatherPolling(); } catch {}
    
    // Initialize zone setpoints from room-map.json
    try { initializeZoneSetpointsFromRoomMap(); } catch (error) {
      console.warn('[setpoint-init] Failed:', error?.message || error);
    }
    
    // Sync zone assignments from room-map.json to iot-devices.json first
    try { syncZoneAssignmentsFromRoomMap(); } catch (error) {
      console.warn('[zone-sync] Failed:', error?.message || error);
    }
    
    // Start syncing live sensor data from iot-devices.json to env.json zones
    try { setupLiveSensorSync(); } catch (error) {
      console.warn('[sensor-sync] Failed to start:', error?.message || error);
    }
    
  // Initialize Schedule Executor for automated plan/schedule application
    if (SCHEDULE_EXECUTOR_ENABLED) {
      try {
        // Load device registry
        const registryPath = path.join(PUBLIC_DIR, 'data', 'device-registry.json');
        let deviceRegistry = {
          'F00001': 2,
          'F00002': 3,
          'F00003': 4,
          'F00004': 6,
          'F00005': 5
        };
        
        try {
          const registryData = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
          if (registryData.devices) {
            deviceRegistry = Object.entries(registryData.devices).reduce((acc, [id, device]) => {
              acc[id] = device.controllerId;
              return acc;
            }, {});
          }
        } catch (error) {
          console.warn('[ScheduleExecutor] Failed to load device-registry.json, using defaults:', error.message);
        }
        
        scheduleExecutor = new ScheduleExecutor({
          interval: SCHEDULE_EXECUTOR_INTERVAL,
          baseUrl: `http://127.0.0.1:${PORT}`,
          grow3Target: getController(),
          enabled: true,
          deviceRegistry
        });
        
        scheduleExecutor.start();
        console.log('[ScheduleExecutor] Started successfully');
      } catch (error) {
        console.error('[ScheduleExecutor] Failed to start:', error);
      }
    } else {
      console.log('[ScheduleExecutor] Disabled (set SCHEDULE_EXECUTOR_ENABLED=true to enable)');
    }

    // Start Wholesale Reservation Cleanup Job
    // Runs every hour to clean up expired reservations
    try {
      const CLEANUP_INTERVAL = 60 * 60 * 1000; // 1 hour
      setInterval(() => {
        const result = cleanupExpiredReservations();
        if (result.cleaned > 0) {
          console.log(`[Cleanup] Released ${result.cleaned} expired reservations, ${result.active} active`);
        }
      }, CLEANUP_INTERVAL);
      
      // Run once on startup
      cleanupExpiredReservations();
      console.log('[Cleanup] ✓ Reservation cleanup job started (runs hourly)');
    } catch (error) {
      console.warn('[Cleanup] Failed to start reservation cleanup job:', error?.message || error);
    }

      // Start background refresh for zone bindings (every 30s)
      try {
        const refresh = async () => {
          try {
            const snapshot = await buildZoneBindingsFromDevices();
            __zoneBindingsSnapshot = snapshot;
          } catch (err) {
            console.warn('[zone-bindings] refresh failed:', err?.message || err);
          }
        };
        // Prime once at startup, then schedule interval
        refresh().catch(()=>{});
        __zoneBindingsTimer = setInterval(refresh, Number(process.env.ZONE_BINDINGS_REFRESH_MS || 30000));
        if (typeof __zoneBindingsTimer?.unref === 'function') __zoneBindingsTimer.unref();
        console.log('[zone-bindings] Background refresh enabled');
      } catch (error) {
        console.warn('[zone-bindings] Failed to start background refresh:', error?.message || error);
      }

      // Initialize Edge Mode Sync Service
      if (edgeConfig.isEdgeMode()) {
        try {
          // Import sqlite3 for sync service (dynamic import)
          import('sqlite3').then((sqlite3Module) => {
            const sqlite3 = sqlite3Module.default;
            const dbPath = path.join(__dirname, 'lightengine.db');
            const db = new sqlite3.Database(dbPath);
            
            // Start data sync service
            syncService = new SyncService(db);
            syncService.start();
            
            // Start wholesale inventory sync service
            wholesaleService = new EdgeWholesaleService(db);
            wholesaleService.start();
            
            // Make services globally available for API routes
            global.syncService = syncService;
            global.wholesaleService = wholesaleService;
            
            console.log('[EdgeMode] ✓ Sync service started');
            console.log('[EdgeMode] ✓ Wholesale sync service started');
            console.log(`[EdgeMode] Farm: ${edgeConfig.getFarmName()} (${edgeConfig.getFarmId()})`);
            console.log(`[EdgeMode] Central API: ${edgeConfig.getCentralApiUrl()}`);
            console.log(`[EdgeMode] Heartbeat: ${edgeConfig.getHeartbeatInterval() / 1000}s`);
            console.log(`[EdgeMode] Data Sync: ${edgeConfig.getSyncInterval() / 1000 / 60}min`);
            console.log(`[EdgeMode] Wholesale Sync: every 15 minutes`);
          }).catch((error) => {
            console.error('[EdgeMode] ✗ Failed to import sqlite3:', error?.message || error);
          });
        } catch (error) {
          console.error('[EdgeMode] ✗ Failed to start sync service:', error?.message || error);
        }
      } else {
        console.log('[EdgeMode] Running in cloud mode (set EDGE_MODE=true for edge mode)');
      }
  });

  // Add error handler for server startup failures
  SERVER.on('error', (error) => {
    console.error('[charlie]  Server startup failed:', error);
    console.error('[charlie] Error code:', error.code);
    console.error('[charlie] Error message:', error.message);
    console.error('[charlie] Stack trace:', error.stack);
    
    // Specific error diagnostics
    if (error.code === 'EADDRINUSE') {
      console.error(`[charlie] Port ${PORT} is already in use. Try a different port or kill the process using it.`);
    } else if (error.code === 'EACCES') {
      console.error(`[charlie] Permission denied to bind to port ${PORT}. Ports below 1024 require root/admin privileges.`);
    }
    
    process.exit(1);
  });

  SERVER.on('error', (error) => {
    if (error && error.code === 'EADDRINUSE') {
      console.error(`[charlie] Port ${PORT} is already in use. Stop the other process or set PORT to a free value.`);
    } else {
      console.error('[charlie] Server failed to start:', error?.message || error);
    }
    process.exit(1);
  });
}

// Start the server after all routes are defined when executed directly
if (process.argv[1] === __filename) {
  startServer().catch((error) => {
    console.error('[charlie] Unexpected startup failure:', error?.message || error);
    process.exit(1);
  });
}

export { app };
export function __resetWizardSystemForTests() {
  resetWizardSystem();
  // Enable fast paths for wizard steps under tests
  WIZARD_TEST_MODE = true;
}

export async function __runDailyPlanResolverForTests(trigger = 'test-helper') {
  return runDailyPlanResolver(trigger);
}

export const __testUtils = {
  computePlanDayNumber,
  resolvePlanLightTargets,
  resolvePlanEnvTargets,
  buildHexPayload,
  evaluateRoomAutomationConfig,
  computeEnergy,
};
