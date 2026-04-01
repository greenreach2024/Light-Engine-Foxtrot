/**
 * GreenReach Central — Cloud Gateway for the GreenReach IoT Platform
 *
 * Architecture: ONE Light Engine system with two server components:
 *   1. Light Engine (server-foxtrot.js) — device control, sensor polling,
 *      SwitchBot integration, lighting schedules, flat-file data storage.
 *   2. GreenReach Central (this file) — cloud gateway, PostgreSQL multi-tenant
 *      DB, web UI, wholesale/billing/admin APIs, syncs FROM Light Engine.
 *
 * Data flow:
 *   Browser → Central (DB + forwards to Light Engine) → Light Engine (flat files)
 *   Light Engine (sensor data) → Central sync (every 5 min) → DB
 *
 * There is NO separate "edge" version. The Light Engine IS the system.
 * Central is the cloud interface that keeps a database copy and provides
 * the multi-tenant web UI at greenreachgreens.com.
 */
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import fs from 'fs';
import { rateLimit } from 'express-rate-limit';
import dotenv from 'dotenv';
import { WebSocketServer } from 'ws';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { pathToFileURL } from 'url';
import { randomBytes, createHmac, randomUUID } from 'crypto';

// Import routes
import farmRoutes from './routes/farms.js';
import authRoutes from './routes/auth.js';
import monitoringRoutes from './routes/monitoring.js';
import inventoryRoutes from './routes/inventory.js';
import inventoryMgmtRoutes from './routes/inventory-mgmt.js';
import ordersRoutes from './routes/orders.js';
import alertsRoutes from './routes/alerts.js';
import syncRoutes from './routes/sync.js';
import { hydrateFromDatabase, migrateDefaultFarmData, getInMemoryStore } from './routes/sync.js';
import wholesaleRoutes from './routes/wholesale.js';
import squareOAuthProxyRoutes from './routes/square-oauth-proxy.js';
// NOTE: farm-stripe-setup.js lives at root level and can't resolve express
// from greenreach-central/node_modules. Stripe setup should proxy to farm server.
import adminRoutes from './routes/admin.js';
import adminAuthRoutes from './routes/admin-auth.js';
import driverApplicationsRoutes from './routes/driver-applications.js';
import campaignRoutes from './routes/campaign.js';
import { adminAuthMiddleware, requireAdminRole } from './middleware/adminAuth.js';
import networkDevicesRoutes from './routes/network-devices.js';
import reportsRoutes from './routes/reports.js';
import farmSettingsRoutes from './routes/farm-settings.js';
import recipesRoutes from './routes/recipes.js';
import aiInsightsRoutes from './routes/ai-insights.js';
import ttsRoutes from './routes/tts.js';
import envProxyRoutes from './routes/env-proxy.js';
import discoveryProxyRoutes from './routes/discovery-proxy.js';
import mlForecastRoutes from './routes/ml-forecast.js';
import billingRoutes from './routes/billing.js';
import procurementAdminRoutes from './routes/procurement-admin.js';
import accountingRoutes from './routes/accounting.js';
import remoteSupportRoutes from './routes/remote-support.js';
import plantingRoutes from './routes/planting.js';
import planningRoutes from './routes/planning.js';
import marketIntelligenceRoutes from './routes/market-intelligence.js';
import cropPricingRoutes from './routes/crop-pricing.js';
import qualityReportsRoutes from './routes/quality-reports.js';
import sustainabilityRoutes from './routes/sustainability.js';
import lotSystemRoutes, { startLotExpiryScheduler } from './routes/lot-system.js';

// Phase 2 — Cloud SaaS API gap routes
import farmUsersRouter, { userRouter, deviceTokenRouter } from './routes/farm-users.js';
import farmSalesRouter from './routes/farm-sales.js';
import customProductsRouter from './routes/custom-products.js';
import networkGrowersRouter from './routes/network-growers.js';
import experimentRecordsRouter, { startBenchmarkScheduler } from './routes/experiment-records.js';
import { runYieldRegression } from './jobs/yield-regression.js';
import { correlateAnomalies } from './jobs/anomaly-correlation.js';
import wholesaleFulfillmentRouter from './routes/wholesale-fulfillment.js';
import producerPortalRouter from './routes/producer-portal.js';
import wholesaleExportsRouter from './routes/wholesale-exports.js';
import miscStubsRouter from './routes/misc-stubs.js';

// Research Platform routes
import researchStudiesRouter from './routes/research-studies.js';
import researchDataRouter from './routes/research-data.js';
import researchExportsRouter from './routes/research-exports.js';
import researchComplianceRouter from './routes/research-compliance.js';
import researchElnRouter from './routes/research-eln.js';
import researchCollaborationRouter from './routes/research-collaboration.js';
import researchRecipesRouter from './routes/research-recipes.js';
import researchAuditRouter from './routes/research-audit.js';
import researchWorkspaceOpsRouter from './routes/research-workspace-ops.js';
import researchGrantsRouter from './routes/research-grants.js';
import researchEthicsRouter from './routes/research-ethics.js';
import researchHqpRouter from './routes/research-hqp.js';
import researchPartnersRouter from './routes/research-partners.js';
import researchSecurityRouter from './routes/research-security.js';
import researchReportingRouter from './routes/research-reporting.js';
import researchDeadlinesRouter from './routes/research-deadlines.js';
import researchPublicationsRouter from './routes/research-publications.js';
import researchEquipmentRouter from './routes/research-equipment.js';
import researchLineageRouter from './routes/research-lineage.js';
import { requireResearchTier } from './middleware/feature-gate.js';
import purchaseRouter from './routes/purchase.js';
import farmOpsAgentRouter from './routes/farm-ops-agent.js';
import assistantChatRouter from './routes/assistant-chat.js';
import stripePaymentsRouter from './routes/stripe-payments.js';
import paymentWebhooksRouter from './routes/payment-webhooks.js';
import adminAssistantRouter from './routes/admin-assistant.js';
import adminOpsAgentRouter from './routes/admin-ops-agent.js';
import scottMarketingRouter from './routes/scott-marketing-agent.js';
import researchIntegrationsRouter from './routes/research-integrations.js';
import gwenResearchRouter from './routes/gwen-research-agent.js';
import adminMarketingRouter from './routes/admin-marketing.js';

// Grant wizard — enabled by default (set ENABLE_GRANT_WIZARD=false to disable)
import adminPricingRoutes from './routes/admin-pricing.js';
import mountFarmJsonRoute from "./routes/farm-json-merge.js";
let grantWizardRoutes, startGrantProgramSync, seedGrantPrograms, cleanupExpiredApplications;
if (process.env.ENABLE_GRANT_WIZARD !== 'false') {
  const gwMod = await import('./routes/grant-wizard.js');
  grantWizardRoutes = gwMod.default;
  cleanupExpiredApplications = gwMod.cleanupExpiredApplications;
  const regMod = await import('./services/grantProgramRegistry.js');
  startGrantProgramSync = regMod.startGrantProgramSync;
  seedGrantPrograms = regMod.seedGrantPrograms;
}

// Import middleware
import { errorHandler, initErrorCapture } from './middleware/errorHandler.js';
import { requestLogger } from './middleware/logger.js';
import { authMiddleware, authOrAdminMiddleware } from './middleware/auth.js';
import { farmDataMiddleware, farmDataWriteMiddleware } from './middleware/farm-data.js';

// Phase 3 — Unified tenant-scoped data access layer
import { farmStore, initFarmStore } from './lib/farm-data-store.js';

// Import services
import { initDatabase, getDatabase, query, isDatabaseAvailable } from './config/database.js';
import { startHealthCheckService, stopHealthCheckService } from './services/healthCheck.js';
import { startNightlyAuditService } from './services/nightly-audit.js';
import { startNightlyChecklist } from './services/nightly-checklist.js';
import { startFayeIntelligence } from './services/faye-intelligence.js';
import { startSyncMonitor } from './services/syncMonitor.js';
import { startWholesaleNetworkSync } from './services/wholesaleNetworkSync.js';
import { seedDemoFarm } from './services/seedDemoFarm.js';
import { startAIPusher } from './services/ai-recommendations-pusher.js';
import { startAwsCostExplorerScheduler } from './services/awsCostExplorerSync.js';
import { startMarketDataFetcher } from './services/market-data-fetcher.js';
import { startMarketAnalysisAgent } from './services/market-analysis-agent.js';
import { detectHarvestConflicts, analyzeSupplyDemand, generateNetworkRiskAlerts } from './jobs/supply-demand-balancer.js';
import { generateHarvestPredictions } from './services/harvest-prediction-engine.js';
import { getCoordinatedPlantingRecommendations } from './services/network-planting-coordinator.js';
import { initExperimentTables, createExperiment, activateExperiment, recordObservation, analyzeExperiment, completeExperiment, listExperiments, getExperiment, getExperimentsForFarm } from './jobs/experiment-orchestrator.js';
import { generateWeeklyPlan, generateAndDistributePlan, gatherDemandForecast, getNetworkSupply } from './jobs/production-planner.js';
import { generateGovernanceReport, formatReportText } from './reports/governance-review.js';
// import deadlineMonitor from '../services/deadline-monitor.js'; // Not available in standalone deployment
import logger from './utils/logger.js';
import { upsertNetworkFarm } from './services/networkFarmsStore.js';
import leamBridge from './lib/leam-bridge.js';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Crop registry — single source of truth for all crop metadata (Phase 2a)
import { createRequire } from 'module';
const _require = createRequire(import.meta.url);
const cropUtils = _require('./public/js/crop-utils.js');
try {
  const registryData = JSON.parse(fs.readFileSync(path.join(__dirname, 'public/data/crop-registry.json'), 'utf8'));
  cropUtils.setRegistry(registryData);
  console.log(`[startup] Crop registry loaded: ${Object.keys(registryData.crops).length} crops (v${registryData.version})`);
} catch (err) {
  console.warn('[startup] Crop registry not loaded — falling back to plan-ID parsing:', err?.message);
}

// Version constants
const BUILD_TIME = Date.now().toString();
const APP_VERSION = (process.env.APP_VERSION
  || process.env.GIT_SHA
  || process.env.VERSION
  || process.env.API_VERSION
  || `build-${BUILD_TIME}`)
  .toString();

// Import setup wizard route
import setupWizardRoutes from './routes/setup-wizard.js';

const app = express();
const PORT = process.env.PORT || 3000;
const WS_PORT = process.env.WS_PORT || 3001;

// ── Environment config validation (#17) ──
// Check required env vars at startup in production
if (process.env.NODE_ENV === 'production' || process.env.DEPLOYMENT_MODE === 'cloud') {
  const required = [
    { keys: ['JWT_SECRET'], label: 'JWT_SECRET' },
    { keys: ['DATABASE_URL', 'RDS_HOSTNAME'], label: 'DATABASE_URL or RDS_HOSTNAME' },
    { keys: ['GREENREACH_API_KEY'], label: 'GREENREACH_API_KEY' }
  ];
  const missing = required
    .filter(r => !r.keys.some(k => process.env[k]))
    .map(r => r.label);
  if (missing.length > 0) {
    console.error(`[STARTUP] Missing required environment variables: ${missing.join(', ')}`);
    console.error('[STARTUP] Server cannot start safely in production without these.');
    process.exit(1);
  }
}

// Trust proxy for AWS ALB/ELB (required for rate limiting and client IP detection)
app.set('trust proxy', 1);
app.locals.databaseReady = false;

// ── Phase 5: HTTPS redirect behind ALB (production cloud mode) ──
// ALB terminates SSL and sends x-forwarded-proto header.
// Redirect HTTP → HTTPS for all requests except health checks.
const DEPLOYMENT_MODE = process.env.DEPLOYMENT_MODE || 'dev';
if (DEPLOYMENT_MODE === 'cloud' || process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (req.headers['x-forwarded-proto'] === 'http' && req.path !== '/health' && req.path !== '/healthz') {
      return res.redirect(301, `https://${req.headers.host}${req.url}`);
    }
    next();
  });
}

// ── Request correlation IDs (#19) ──
app.use((req, res, next) => {
  req.id = req.headers['x-request-id'] || randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
});

// ── Cookie security (#20) ──
// Set secure defaults for any cookies set by the application
app.use((req, res, next) => {
  const originalCookie = res.cookie.bind(res);
  res.cookie = (name, value, options = {}) => {
    const secureDefaults = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'Lax',
      ...options
    };
    return originalCookie(name, value, secureDefaults);
  };
  next();
});

// Security middleware
// Note: the current standalone UI pages include inline <script> and inline event handlers.
// Configure CSP to allow inline scripts for public pages while maintaining security.
const isProduction = process.env.NODE_ENV === 'production';
app.use(helmet({
  // Relax cross-origin headers for Safari private mode compatibility.
  // Safari ITP + private browsing blocks same-origin fetch() when these
  // are set to restrictive defaults.
  crossOriginResourcePolicy: { policy: 'same-site' },
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  // HSTS — enforce HTTPS for 1 year, include subdomains
  strictTransportSecurity: {
    maxAge: 31536000,
    includeSubDomains: true,
  },
  // Prevent MIME-type sniffing
  xContentTypeOptions: true,     // X-Content-Type-Options: nosniff (helmet default)
  // Prevent clickjacking
  xFrameOptions: { action: 'sameorigin' },
  // Control Referer header leakage
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  // Restrict browser features
  permittedCrossDomainPolicies: { permittedPolicies: 'none' },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://unpkg.com", "https://web.squarecdn.com", "https://www.googletagmanager.com", "https://www.google-analytics.com", "https://cdnjs.cloudflare.com", "https://cdn.plot.ly"],
      scriptSrcAttr: ["'unsafe-inline'"],  // Allow inline event handlers (onclick, etc.)
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com", "https://web.squarecdn.com"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https:", "wss:", "https://connect.squareup.com", "https://pci-connect.squareup.com", "https://connect.stripe.com", "https://api.stripe.com", "https://www.google-analytics.com", "https://analytics.google.com"],
      fontSrc: ["'self'", "data:", "https://cdn.jsdelivr.net", "https://cash-f.squarecdn.com"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'", "blob:"],
      frameSrc: ["'self'", "https://web.squarecdn.com", "https://pci-connect.squareup.com", "https://connect.stripe.com"],  // Allow Square + Stripe iframes
      upgradeInsecureRequests: null
    },
  },
}));

// =====================================================
// CORS — MUST be mounted BEFORE farmDataMiddleware & express.static
// so that ALL responses (including /data/*.json and static files)
// include Access-Control-Allow-Origin headers.  Safari private mode
// sends Origin headers on same-origin fetch() when custom headers
// (Authorization) are present, and blocks responses lacking CORS headers.
// =====================================================
const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    const requestHost = origin.replace(/^https?:\/\//, '').replace(/:\d+$/, '');
    const serverHost = (process.env.SERVER_HOST || '').replace(/:\d+$/, '');
    if (requestHost === serverHost || origin.includes('elasticbeanstalk.com')) {
      return callback(null, true);
    }
    const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [
      'http://localhost:3000',
      'http://localhost:8091',
      'https://greenreachgreens.com',
      'http://greenreachgreens.com',
      'https://www.greenreachgreens.com',
      'http://www.greenreachgreens.com'
    ];
    const host = origin.replace(/^https?:\/\//, '').replace(/:\d+$/, '');
    if (host.endsWith('.greenreachgreens.com')) {
      return callback(null, true);
    }
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn('[CORS] Rejected origin:', origin);
      callback(null, false);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Farm-ID', 'X-API-Key', 'X-Farm-Slug']
};
app.use(cors(corsOptions));

// CSRF protection for state-changing requests (SPA + JSON API)
// Since this is a pure API server (no server-rendered forms), CSRF is
// mitigated by: (1) CORS origin whitelist above, (2) Content-Type check,
// (3) custom auth headers (trigger preflight). This middleware adds an
// extra Origin/Referer check for mutating requests.
app.use((req, res, next) => {
  // Only check state-changing methods
  if (!['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) return next();
  // Skip for API-key authenticated edge devices (no browser origin)
  if (req.headers['x-api-key']) return next();
  // Skip for non-browser clients (no Origin header)
  const origin = req.headers.origin;
  if (!origin) return next();
  // Verify origin against CORS whitelist (same logic)
  const host = origin.replace(/^https?:\/\//, '').replace(/:\d+$/, '');
  const serverHost = (process.env.SERVER_HOST || '').replace(/:\d+$/, '');
  const allowed = host === serverHost ||
    origin.includes('elasticbeanstalk.com') ||
    host.endsWith('.greenreachgreens.com') ||
    host === 'greenreachgreens.com' || host === 'www.greenreachgreens.com' ||
    host === 'localhost';
  if (!allowed) {
    logger.warn('[CSRF] Blocked state-changing request from:', origin);
    return res.status(403).json({ error: 'Origin not allowed' });
  }
  next();
});

// Input validation middleware — sanitize common request body fields
app.use((req, res, next) => {
  // Basic sanitization for string fields in request body
  if (req.body && typeof req.body === 'object') {
    const sanitize = (val) => {
      if (typeof val !== 'string') return val;
      // Strip null bytes and trim
      return val.replace(/\0/g, '').trim();
    };
    for (const [key, val] of Object.entries(req.body)) {
      if (typeof val === 'string') {
        req.body[key] = sanitize(val);
      }
    }
  }
  next();
});

// =====================================================
// MULTI-TENANT FARM DATA MIDDLEWARE
// Intercepts /data/*.json requests and serves farm-scoped data from
// the farm_data PostgreSQL table when a farm context (JWT/API key) exists.
// Must be mounted BEFORE static file serving so DB data takes precedence.
// =====================================================
const _inMemoryStore = getInMemoryStore();
initFarmStore(_inMemoryStore);                     // Phase 3 — init data store
// Body parser MUST run before farmDataWriteMiddleware so req.body is available
// for POST/PUT /data/*.json. Without this, req.body is undefined and the
// middleware crashes on payload.groups → TypeError (causes 502).
app.use(express.json({
  limit: '10mb',
  verify: (req, _res, buf) => {
    // Preserve raw body bytes for routes that need HMAC signature verification.
    // Use startsWith so query-strings / trailing slashes don't skip capture.
    if (req.url.startsWith('/api/purchase/webhook')) {
      req.rawBody = buf;
    }
  }
}));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(farmDataWriteMiddleware(_inMemoryStore)); // PUT /data/*.json → DB
app.use(farmDataMiddleware(_inMemoryStore));       // GET /data/*.json → DB

// Inject farmStore into every request for route files
app.use((req, _res, next) => { req.farmStore = farmStore; next(); });

// ── API metering middleware — count calls per farm per day ──────────
app.use((req, _res, next) => {
  const farmId = req.headers['x-farm-id'] || req.farmId;
  if (farmId && isDatabaseAvailable()) {
    query(
      `INSERT INTO api_usage_daily (farm_id, usage_date, api_calls, updated_at)
       VALUES ($1, CURRENT_DATE, 1, NOW())
       ON CONFLICT (farm_id, usage_date) DO UPDATE
       SET api_calls = api_usage_daily.api_calls + 1, updated_at = NOW()`,
      [farmId]
    ).catch(() => {}); // fire-and-forget; never block request
  }
  next();
});

// ── Room-map routes MUST be before express.static to avoid flat-file fallback ──
// These handle farm-scoped room-map data via PostgreSQL farm_data table.
app.get('/data/room-map.json', async (req, res) => {
  const fid = farmStore.farmIdFromReq(req);
  const payload = await farmStore.get(fid, 'room_map') || { zones: [], devices: [] };
  return res.json(payload);
});

app.get('/data/room-map-:roomId.json', async (req, res) => {
  const fid = farmStore.farmIdFromReq(req);
  // Room-specific suffix is deprecated; all room maps now stored as farm-scoped room_map
  // The data includes roomId field to identify which room the map is for
  const payload = await farmStore.get(fid, 'room_map') || { zones: [], devices: [] };
  return res.json(payload);
});

app.post('/data/room-map.json', async (req, res) => {
  const fid = farmStore.farmIdFromReq(req);
  if (!fid) {
    return res.status(401).json({ success: false, error: 'Not authenticated' });
  }
  try {
    await farmStore.set(fid, 'room_map', req.body);
    return res.json({ success: true, dataType: 'room_map', farmId: fid });
  } catch (err) {
    logger.error('[Room Map] Save failed:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/data/room-map-:roomId.json', async (req, res) => {
  const fid = farmStore.farmIdFromReq(req);
  if (!fid) {
    return res.status(401).json({ success: false, error: 'Not authenticated' });
  }
  try {
    // Normalize: store as room_map regardless of roomId suffix (data contains roomId field)
    await farmStore.set(fid, 'room_map', req.body);
    return res.json({ success: true, dataType: 'room_map', farmId: fid, roomId: req.params.roomId });
  } catch (err) {
    logger.error('[Room Map] Save failed:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── Farm Profile: merge DB data on top of static farm.json ─────────────────
mountFarmJsonRoute(app, { farmStore, logger });

// ── Farm Settings: persist display prefs, notifications, system config ──────
app.post('/data/farm-settings.json', async (req, res) => {
  const fid = farmStore.farmIdFromReq(req);
  if (!fid) {
    return res.status(401).json({ success: false, error: 'Not authenticated' });
  }
  try {
    await farmStore.set(fid, 'farm_settings', req.body);
    return res.json({ success: true, dataType: 'farm_settings', farmId: fid });
  } catch (err) {
    logger.error('[Farm Settings] Save failed:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Load saved farm settings on GET
app.get('/data/farm-settings.json', async (req, res) => {
  const fid = farmStore.farmIdFromReq(req);
  if (!fid) {
    return res.status(401).json({ success: false, error: 'Not authenticated' });
  }
  try {
    const settings = await farmStore.get(fid, 'farm_settings') || {};
    return res.json(settings);
  } catch (err) {
    logger.error('[Farm Settings] Load failed:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── One-time DB seed: bootstrap farm_profile + rooms from flat file ─────────
// Call POST /api/admin/seed-farm after deploy to ensure DB has all profile data.
// Idempotent: skips if farm_profile already has meaningful data in DB.
app.post("/api/admin/seed-farm", async (req, res) => {
  const fid = process.env.FARM_ID;
  if (!fid) return res.status(400).json({ error: "No FARM_ID configured" });
  try {
    const existing = await farmStore.get(fid, "farm_profile");
    const hasCompleteProfile = existing && typeof existing === "object"
      && existing.contact && existing.contact.name
      && existing.setup_completed;
    if (hasCompleteProfile) {
      return res.json({ success: true, message: "Profile already exists in DB", seeded: false });
    }
    const flatPath = path.join(__dirname, "public", "data", "farm.json");
    let base = {};
    try { base = JSON.parse(fs.readFileSync(flatPath, "utf8")); } catch (_) {}
    if (!base.farmId) return res.status(400).json({ error: "Flat file has no farmId" });
    const seedProfile = {
      farmId: base.farmId,
      name: base.farmName || base.name,
      farmName: base.farmName || base.name,
      contact: base.contact || {},
      location: {
        address: base.address || "",
        city: base.city || "",
        state: base.state || "",
        postalCode: base.postalCode || "",
        timezone: base.timezone || "America/New_York",
        latitude: base.coordinates?.lat || null,
        longitude: base.coordinates?.lng || null
      },
      coordinates: base.coordinates || {},
      certifications: base.certifications || {},
      tax: base.tax || {},
      dedicated_crops: base.dedicated_crops || [],
      status: "active",
      setup_completed: true,
      setup_completed_at: base.setup_completed_at || new Date().toISOString()
    };
    await farmStore.set(fid, "farm_profile", seedProfile);
    if (base.rooms && Array.isArray(base.rooms) && base.rooms.length > 0) {
      await farmStore.set(fid, "rooms", base.rooms);
    }
    try {
      const { query: dbQuery } = await import("./config/database.js");
      // Update farms table with contact info + setup_completed flag
      const contact = seedProfile.contact || {};
      const loc = seedProfile.location || {};
      await dbQuery(
        `UPDATE farms SET
          setup_completed = true,
          setup_completed_at = COALESCE(setup_completed_at, NOW()),
          contact_name = COALESCE($2, contact_name),
          email = COALESCE($3, email),
          contact_phone = COALESCE($4, contact_phone),
          location = COALESCE($5, location)
        WHERE farm_id = $1`,
        [fid, contact.name || null, contact.email || null, contact.phone || null,
         JSON.stringify({ address: loc.address, city: loc.city, state: loc.state, postalCode: loc.postalCode })]
      );
    } catch (dbErr) {
      logger.warn("[Seed] farms table update failed (non-fatal):", dbErr.message);
    }
    logger.info("[Seed] Farm profile seeded for " + fid);
    return res.json({ success: true, message: "Farm profile seeded from flat file", seeded: true, farmId: fid });
  } catch (err) {
    logger.error("[Seed] Failed:", err.message);
    return res.status(500).json({ error: err.message });
  }
});


// Seed crop pricing from flat file into DB
app.post("/api/admin/seed-pricing", async (req, res) => {
  const fid = process.env.FARM_ID;
  if (!fid) return res.status(400).json({ error: "No FARM_ID configured" });
  try {
    // Check if DB already has pricing (skip unless force=true)
    const forceReseed = req.body && req.body.force === true;
    if (!forceReseed) {
      const existing = await farmStore.get(fid, "crop_pricing");
      if (existing && existing.crops && existing.crops.length > 0) {
        return res.json({ success: true, message: "Crop pricing already in DB", seeded: false, count: existing.crops.length });
      }
    }
    // Load from flat file
    const flatPath = path.join(__dirname, "public", "data", "crop-pricing.json");
    let pricingFile = {};
    try { pricingFile = JSON.parse(fs.readFileSync(flatPath, "utf8")); } catch (_) {}
    if (!pricingFile.crops || !pricingFile.crops.length) {
      return res.status(400).json({ error: "crop-pricing.json has no crops" });
    }
    await farmStore.set(fid, "crop_pricing", { crops: pricingFile.crops, lastUpdated: new Date().toISOString() });
    logger.info("[Seed] Crop pricing seeded: " + pricingFile.crops.length + " crops for " + fid);
    return res.json({ success: true, message: "Crop pricing seeded from flat file", seeded: true, count: pricingFile.crops.length });
  } catch (err) {
    logger.error("[Seed Pricing] Failed:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── IoT Devices: save to DB + forward to Light Engine ──────────────────────
// The browser's room-mapper saves device registry data (zone assignments,
// sensor placements) via POST /data/iot-devices.json. This handler persists
// to the database AND forwards the payload to the Light Engine so its
// syncSensorData() loop has the device list it needs to poll SwitchBot.
app.post('/data/iot-devices.json', async (req, res) => {
  const fid = farmStore.farmIdFromReq(req);
  if (!fid) {
    return res.status(401).json({ success: false, error: 'Not authenticated' });
  }
  try {
    const payload = req.body;
    const devicesList = Array.isArray(payload) ? payload : (payload.devices || payload);

    // 1. Save to DB (source of truth for multi-tenant data)
    await farmStore.set(fid, 'devices', devicesList);
    logger.info(`[IoT Devices] Saved ${Array.isArray(devicesList) ? devicesList.length : '?'} device(s) for farm ${fid} to DB`);

    // 2. Forward to Light Engine so flat-file storage is updated and
    //    zone-assignment side-effects (syncZoneAssignmentsFromRoomMap) run.
    const lightEngineUrl = resolveEdgeUrlForProxy();
    if (lightEngineUrl) {
      fetch(`${lightEngineUrl}/data/iot-devices.json`, {
        method: 'POST',
        headers: leProxyHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000)
      })
        .then(r => logger.info(`[IoT Devices] Forwarded to Light Engine: ${r.status}`))
        .catch(err => logger.warn(`[IoT Devices] Light Engine forward failed (non-fatal): ${err.message}`));
    }

    return res.json({ success: true, dataType: 'devices', farmId: fid });
  } catch (err) {
    logger.error('[IoT Devices] Save failed:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── Phase 4: Auto-inject api-config.js + auth-guard.js into all HTML responses ──
// Serves HTML pages with injected config/auth scripts so every page gets
// environment detection + the enhanced fetch wrapper without editing 160+ files.
// Non-HTML requests fall through to express.static below.
// ── Server-side access control for admin pages ──────────────────────────────
// Prevent search engine indexing of internal/admin pages and add
// X-Robots-Tag: noindex to discourage crawling. Client-side auth-guard.js
// handles the actual redirect-to-login check (tokens are in localStorage).
const ADMIN_PAGES = new Set([
  '/GR-central-admin.html',
  '/GR-admin.html',
  '/GR-wholesale.html',
  '/GR-wholesale-integrations.html',
  '/GR-wholesale-order-review.html',
  '/GR-wholesale-farm-performance.html',
  '/GR-wholesale-legacy.html',
  '/GR-farm-performance.html',
  '/LE-dashboard.html',
  '/LE-dashboard-consolidated.html',
  '/LE-farm-admin.html',
  '/LE-qr-generator.html',
  '/LE-wholesale-orders.html',
  '/LEMarketing-downloads.html',
  '/farm-admin.html',
  '/farm-vitality.html',
  '/farm-sales-pos.html',
  '/farm-sales-store.html',
  '/farm-wall-cad-renderer.html',
  '/setup-wizard.html',
  '/schedule.html',
  '/activity-hub-qr.html',
  '/farm-admin-login.html',
  '/GR-central-admin-login.html',
  '/login.html',
]);

app.use((req, res, next) => {
  if (ADMIN_PAGES.has(req.path)) {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Cache-Control', 'no-store, private');
  }
  next();
});

const _CONFIG_TAG = '<script src="/js/api-config.js"></script>';
const _GUARD_TAG  = '<script src="/auth-guard.js"></script>';
const _INJECT_MARK = '<!-- api-config-injected -->';
const _htmlDirs = [
  path.join(__dirname, 'public'),
  path.join(__dirname, '..', 'public')
];

app.use((req, res, next) => {
  // Only intercept .html requests (skip API routes, data files, JS/CSS/images)
  const reqPath = req.path;
  if (!reqPath.endsWith('.html')) return next();

  // Find the HTML file in our static directories
  for (const dir of _htmlDirs) {
    const filePath = path.join(dir, reqPath);
    // Security: prevent path traversal
    if (!filePath.startsWith(dir)) continue;
    if (!fs.existsSync(filePath)) continue;

    let html = fs.readFileSync(filePath, 'utf8');
    // Don't double-inject
    if (!html.includes(_INJECT_MARK) && html.includes('<head')) {
      // Skip injection if page already has both scripts
      const hasConfig = html.includes('api-config.js');
      const hasGuard  = html.includes('auth-guard.js');
      const inject = _INJECT_MARK + '\n  ' +
        (hasConfig ? '' : _CONFIG_TAG + '\n  ') +
        (hasGuard  ? '' : _GUARD_TAG);
      html = html.replace(/(<head[^>]*>)/i, `$1\n  ${inject}`);
    }
    res.type('html').send(html);
    return;
  }
  next();
});

// Static UI — non-HTML assets (JS, CSS, images, JSON, fonts)
// ── Static asset caching (#21) ──
const staticCacheOptions = {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    } else if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
      res.setHeader('Cache-Control', 'public, max-age=3600, must-revalidate');
    } else if (filePath.match(/\.(jpg|jpeg|png|gif|svg|woff|woff2|ttf|eot|ico)$/)) {
      res.setHeader('Cache-Control', 'public, max-age=86400');
    }
  }
};
// ── Fix 1C: Block unauthenticated access to sensitive data files ──
const SENSITIVE_DATA_FILES = /\/(iot-devices|farm-api-keys|env)\.json$/i;
app.use('/data', (req, res, next) => {
  if (SENSITIVE_DATA_FILES.test(req.path)) {
    // Allow only authenticated requests (JWT or session)
    const hasAuth = req.headers.authorization || req.session?.farmId;
    if (!hasAuth) {
      return res.status(403).json({ error: 'Authentication required for this resource' });
    }
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public'), staticCacheOptions));
// Fallback to root public directory for shared assets
app.use(express.static(path.join(__dirname, '..', 'public'), staticCacheOptions));

// =====================================================
// FARM DATA SYNC: Periodically pull live data from farm servers
// All farm data flows to GreenReach Central.
// Configurable via env vars:
//   FARM_SYNC_INTERVAL_MS  - polling interval (default 300000 = 5 min)
//   FARM_EDGE_URL          - farm server URL (overrides farm.json url field)
//   FARM_DAILY_SYNC_HOUR   - hour (0-23) for daily full sync (default 2 = 2 AM)
// =====================================================
const FARM_DATA_DIR = path.join(__dirname, 'public', 'data');
const LEGACY_DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_SEARCH_DIRS = [FARM_DATA_DIR, LEGACY_DATA_DIR];
const FARM_SYNC_INTERVAL = parseInt(process.env.FARM_SYNC_INTERVAL_MS) || 5 * 60 * 1000;
const DAILY_SYNC_HOUR = parseInt(process.env.FARM_DAILY_SYNC_HOUR) || 2; // 2 AM default
const SYNC_DATA_FILES = ['groups.json', 'rooms.json', 'farm.json', 'iot-devices.json', 'room-map.json', 'env.json', 'tray-formats.json'];

// Sync status tracking
const syncStatus = {
  lastSync: null,
  lastSyncResult: null,
  lastDailySync: null,
  syncCount: 0,
  errorCount: 0,
  filesUpdated: 0
};

async function readDataJsonWithFallback(fileName, fallbackValue = {}) {
  for (const dir of DATA_SEARCH_DIRS) {
    const filePath = path.join(dir, fileName);
    if (!fs.existsSync(filePath)) continue;
    try {
      const raw = await fs.promises.readFile(filePath, 'utf8');
      return JSON.parse(raw);
    } catch (error) {
      logger.warn(`[Compat] Failed parsing ${filePath}:`, error.message);
    }
  }
  return fallbackValue;
}

async function writeFarmDataJson(fileName, payload) {
  await fs.promises.mkdir(FARM_DATA_DIR, { recursive: true });
  const filePath = path.join(FARM_DATA_DIR, fileName);
  await fs.promises.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');
}

function formatDateYYYYMMDD(dateValue) {
  if (!(dateValue instanceof Date) || Number.isNaN(dateValue.getTime())) return null;
  return dateValue.toISOString().slice(0, 10);
}

function getDaysBetween(startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.floor((end - start) / msPerDay);
}

/**
 * Extract a human-readable crop name from a plan ID.
 * Delegates to cropUtils.planIdToCropName() (Phase 2a — unified crop registry).
 */
function extractCropNameFromPlanId(planId) {
  if (!planId || typeof planId !== 'string') return 'Unknown';
  return cropUtils.planIdToCropName(planId);
}

function buildSyntheticTraysFromGroups(groups) {
  if (!Array.isArray(groups) || groups.length === 0) return [];

  // Load crop registry and tray formats
  let cropRegistry = {};
  let trayFormats = [];
  try {
    const registryPath = path.join(process.cwd(), 'public', 'data', 'crop-registry.json');
    if (fs.existsSync(registryPath)) {
      const registryData = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
      cropRegistry = registryData.crops || {};
    }
  } catch (_) { /* optional */ }
  try {
    const tfPath = path.join(process.cwd(), 'public', 'data', 'tray-formats.json');
    if (fs.existsSync(tfPath)) {
      trayFormats = JSON.parse(fs.readFileSync(tfPath, 'utf8'));
    }
  } catch (_) { /* optional */ }

  let trayFormatMap = {};
  for (const fmt of trayFormats) {
    if (fmt.trayFormatId) trayFormatMap[fmt.trayFormatId] = fmt;
  }

  const now = new Date();
  const fallbackGrowthDays = 35;
  const syntheticTrays = [];

  groups.forEach((group) => {
    const groupId = group?.id || group?.groupId;
    if (!groupId) return;

    // Skip draft groups with no plan or crop assigned (not actively growing)
    const groupStatus = (group?.status || '').toLowerCase();
    const hasPlan = !!(group?.plan || group?.planId);
    const hasCrop = !!(group?.recipe || group?.crop);
    if (groupStatus === 'draft' && !hasPlan && !hasCrop) return;

    const trayCount = Math.max(0, Number(group?.trays || 0));
    if (!trayCount) return;

    // Resolve crop info from registry
    const planId = group?.plan || group?.planId || null;
    const recipeName = group?.recipe || group?.crop || extractCropNameFromPlanId(planId);
    const cropEntry = cropRegistry[recipeName] || null;
    const cropGrowthDays = cropEntry?.growth?.daysToHarvest || fallbackGrowthDays;
    const yieldFactor = cropEntry?.growth?.yieldFactor || 0.85;

    // Resolve tray format if linked
    const trayFormat = group?.trayFormatId ? trayFormatMap[group.trayFormatId] : null;

    const totalPlants = Number(group?.plants || 0);
    const plantCountPerTray = trayFormat
      ? trayFormat.plantSiteCount
      : Math.max(1, Math.round((totalPlants > 0 ? totalPlants : trayCount * 12) / trayCount));

    const seedDateRaw = group?.planConfig?.anchor?.seedDate;
    const seedDate = seedDateRaw ? new Date(seedDateRaw) : null;
    const daysOld = seedDate && !Number.isNaN(seedDate.getTime())
      ? Math.max(1, getDaysBetween(seedDate, now) + 1)
      : 1;

    const currentDay = daysOld;
    const daysToHarvest = Math.max(0, cropGrowthDays - currentDay);
    const estimatedHarvestDateObj = new Date(now);
    estimatedHarvestDateObj.setDate(estimatedHarvestDateObj.getDate() + daysToHarvest);

    // Estimate weight per tray
    const weightPerSiteOz = trayFormat?.isWeightBased && trayFormat.targetWeightPerSite
      ? trayFormat.targetWeightPerSite
      : null;
    const estimatedWeightOz = weightPerSiteOz
      ? plantCountPerTray * yieldFactor * weightPerSiteOz
      : null;

    const roomLabel = group?.roomId || group?.room || 'ROOM-1';
    const zoneLabel = group?.zoneId || (group?.zone != null ? `ZONE-${group.zone}` : 'ZONE-1');
    const location = `${roomLabel} - ${zoneLabel}`;

    for (let index = 0; index < trayCount; index += 1) {
      const tray = {
        trayId: `${groupId}#${index + 1}`,
        groupId,
        recipe: recipeName,
        plan: planId,
        plantCount: plantCountPerTray,
        currentDay,
        daysOld,
        daysToHarvest,
        harvestIn: daysToHarvest,
        crop_growth_days: cropGrowthDays,
        seedingDate: seedDate && !Number.isNaN(seedDate.getTime()) ? seedDate.toISOString() : null,
        estimatedHarvestDate: formatDateYYYYMMDD(estimatedHarvestDateObj),
        location,
        status: group?.active === false ? 'inactive' : 'active'
      };

      if (trayFormat) {
        tray.trayFormatId = trayFormat.trayFormatId;
        tray.trayFormatName = trayFormat.name;
        tray.systemType = trayFormat.systemType;
      }
      if (estimatedWeightOz !== null) {
        tray.estimated_weight_oz = Math.round(estimatedWeightOz * 100) / 100;
      }
      if (yieldFactor) {
        tray.yield_factor = yieldFactor;
      }

      syntheticTrays.push(tray);
    }
  });

  return syntheticTrays;
}

function normalizeInventoryTrays(rawTrays) {
  if (!Array.isArray(rawTrays)) return [];

  const now = new Date();
  return rawTrays.map((tray, index) => {
    const trayId = tray?.trayId || tray?.id || `tray-${index + 1}`;
    const plantCount = Math.max(0, Number(tray?.plantCount || tray?.plants || 0));
    const currentDay = Math.max(1, Number(tray?.currentDay || tray?.daysOld || 1));
    const seedingDate = tray?.seedingDate || tray?.seedDate || null;

    let daysToHarvest = Number.isFinite(Number(tray?.daysToHarvest)) ? Number(tray.daysToHarvest) : null;
    if (daysToHarvest == null && Number.isFinite(Number(tray?.harvestIn))) {
      daysToHarvest = Number(tray.harvestIn);
    }

    if (daysToHarvest == null && tray?.estimatedHarvestDate) {
      const harvestDate = new Date(tray.estimatedHarvestDate);
      if (!Number.isNaN(harvestDate.getTime())) {
        daysToHarvest = Math.max(0, getDaysBetween(now, harvestDate));
      }
    }

    if (daysToHarvest == null) daysToHarvest = Math.max(0, 35 - currentDay);

    const estimatedHarvestDateObj = tray?.estimatedHarvestDate
      ? new Date(tray.estimatedHarvestDate)
      : new Date(now.getTime() + (daysToHarvest * 24 * 60 * 60 * 1000));

    return {
      ...tray,
      trayId,
      groupId: tray?.groupId || tray?.location || 'unassigned',
      recipe: tray?.recipe || tray?.crop || extractCropNameFromPlanId(tray?.plan || tray?.planId),
      plantCount,
      currentDay,
      daysOld: Math.max(1, Number(tray?.daysOld || currentDay)),
      daysToHarvest,
      harvestIn: Number.isFinite(Number(tray?.harvestIn)) ? Number(tray.harvestIn) : daysToHarvest,
      seedingDate,
      estimatedHarvestDate: formatDateYYYYMMDD(estimatedHarvestDateObj),
      location: tray?.location || 'ROOM-1 - ZONE-1',
      status: tray?.status || 'active'
    };
  });
}

function splitForecastBuckets(trays) {
  const buckets = {
    next7Days: [],
    next14Days: [],
    next30Days: [],
    beyond30Days: []
  };

  trays.forEach((tray) => {
    if ((tray?.status || '').toLowerCase() === 'harvested') return;
    const days = Math.max(0, Number(tray?.daysToHarvest || 0));
    if (days <= 7) buckets.next7Days.push(tray);
    else if (days <= 14) buckets.next14Days.push(tray);
    else if (days <= 30) buckets.next30Days.push(tray);
    else buckets.beyond30Days.push(tray);
  });

  return buckets;
}

/**
 * Get inventory trays for compatibility routes.
 * Priority: farm-scoped DB data → flat trays.json → synthetic from groups.
 * @param {string} [farmId] - Farm ID for scoped data lookup
 */
async function getInventoryTraysForCompat(farmId) {
  // 1. Try farm-scoped groups from DB
  const groups = await farmStore.get(farmId, 'groups') || [];
  if (groups.length > 0) {
    const syntheticTrays = buildSyntheticTraysFromGroups(groups);
    return normalizeInventoryTrays(syntheticTrays);
  }

  // 2. Try trays data type
  const traysRaw = await farmStore.get(farmId, 'trays') || [];
  if (Array.isArray(traysRaw) && traysRaw.length > 0) {
    return normalizeInventoryTrays(traysRaw);
  }

  return normalizeInventoryTrays([]);
}

/**
 * Build auth headers for Central-to-LE proxy requests.
 * Sends API key + farm ID so the LE's auth middleware accepts the request.
 */
function leProxyHeaders(extra = {}) {
  const headers = { 'Accept': 'application/json', ...extra };
  const farmId = process.env.FARM_ID;
  if (farmId && !headers['X-Farm-ID']) headers['X-Farm-ID'] = farmId;
  const apiKey = process.env.GREENREACH_API_KEY;
  if (apiKey) headers['X-API-Key'] = apiKey;
  return headers;
}

function resolveEdgeUrl() {
  // Resolves the Light Engine URL. FARM_EDGE_URL env var takes priority.
  if (process.env.FARM_EDGE_URL) return process.env.FARM_EDGE_URL;
  
  const farmJsonPath = path.join(FARM_DATA_DIR, 'farm.json');
  if (!fs.existsSync(farmJsonPath)) return null;
  
  try {
    const farmData = JSON.parse(fs.readFileSync(farmJsonPath, 'utf8'));
    return farmData.url || null;
  } catch { return null; }
}

/**
 * Sync farm identity from the Light Engine to the farms DB row.
 * Does NOT write to the local farm.json file — only updates the database.
 * Called alongside syncFarmData() on the same interval.
 *
 * Architecture note: GreenReach Central and the Light Engine are two
 * components of a single system. Central is the cloud gateway (UI, DB,
 * multi-tenant API). The Light Engine handles device control and sensor
 * polling. There is ONE Light Engine — not separate "edge" and "cloud"
 * versions.
 */
async function syncFarmIdentity(edgeUrl) {
  if (!edgeUrl) edgeUrl = resolveEdgeUrl();
  if (!edgeUrl) return { ok: false, reason: 'no_edge_url' };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const response = await fetch(`${edgeUrl}/data/farm.json`, { headers: leProxyHeaders(), signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) {
      logger.warn(`[SyncIdentity] Failed to fetch farm.json from ${edgeUrl}: ${response.status}`);
      return { ok: false, reason: 'fetch_failed' };
    }

    const farmData = await response.json();
    const farmId = farmData.farmId;
    if (!farmId) {
      logger.warn('[SyncIdentity] Light Engine farm.json has no farmId');
      return { ok: false, reason: 'no_farm_id' };
    }

    const { query: dbQuery, isDatabaseAvailable } = await import('./config/database.js');
    if (!await isDatabaseAvailable()) {
      return { ok: false, reason: 'db_unavailable' };
    }

    // Update farms DB row with current identity from Light Engine
    const farmMeta = {
      contact: farmData.contact || {},
      location: farmData.location || '',
      address: farmData.address || '',
      city: farmData.city || '',
      state: farmData.state || '',
      postalCode: farmData.postalCode || '',
      region: farmData.region || '',
      coordinates: farmData.coordinates || {},
      website: farmData.contact?.website || farmData.website || '',
      phone: farmData.contact?.phone || farmData.phone || '',
      contactName: farmData.contact?.name || farmData.contactName || '',
      roomsList: farmData.rooms || [],
      tax: farmData.tax || null
    };

    await dbQuery(
      `INSERT INTO farms (farm_id, name, email, api_url, metadata, status, registration_code, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, 'active', encode(gen_random_bytes(8), 'hex'), NOW(), NOW())
       ON CONFLICT (farm_id) DO UPDATE SET
         name = COALESCE(NULLIF($2, ''), farms.name),
         email = COALESCE(NULLIF($3, ''), farms.email),
         api_url = COALESCE(NULLIF($4, ''), farms.api_url),
         metadata = COALESCE(farms.metadata, '{}'::jsonb) || $5::jsonb,
         updated_at = NOW()`,
      [farmId, farmData.name || '', farmData.contact?.email || farmData.email || '',
       edgeUrl, JSON.stringify(farmMeta)]
    );

    logger.info(`[SyncIdentity] Updated farm identity for ${farmId}: "${farmData.name}"`);
    return { ok: true, farmId, name: farmData.name };
  } catch (err) {
    logger.error('[SyncIdentity] Error:', err.message);
    return { ok: false, error: err.message };
  }
}

async function syncFarmData(options = {}) {
  const { isDaily = false, manual = false } = options;
  const syncLabel = isDaily ? 'DailySync' : manual ? 'ManualSync' : 'FarmSync';
  
  try {
    const edgeUrl = resolveEdgeUrl();
    if (!edgeUrl) {
      logger.warn(`[${syncLabel}] No Light Engine URL configured (set FARM_EDGE_URL env var or farm.json url)`);
      return { ok: false, reason: 'no_edge_url' };
    }
    
    logger.info(`[${syncLabel}] Syncing data from Light Engine: ${edgeUrl}`);
    let updated = 0;
    let errors = 0;
    const fetched = {}; // file -> parsed JSON from Light Engine

    // Fetch ALL data files from Light Engine (including farm.json for farmId)
    for (const file of SYNC_DATA_FILES) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        const response = await fetch(`${edgeUrl}/data/${file}`, { headers: leProxyHeaders(), signal: controller.signal });
        clearTimeout(timeout);
        
        if (response.ok) {
          const text = await response.text();
          try { fetched[file] = JSON.parse(text); } catch { /* non-JSON */ }
          // DO NOT write to flat files — flat files in public/data/ are
          // served by express.static to unauthenticated requests, causing
          // cross-farm data leaks. In-memory store + DB are the correct
          // persistence paths for multi-tenant mode.
          logger.info(`[${syncLabel}] Fetched ${file} from Light Engine`);
          updated++;
        }
      } catch (err) {
        errors++;
        logger.warn(`[${syncLabel}] Could not fetch ${file} from ${edgeUrl}: ${err.message}`);
      }
    }

    // Also fetch extra files not in SYNC_DATA_FILES
    for (const extra of ['schedules.json', 'light-setups.json', 'plans.json']) {
      if (fetched[extra]) continue;
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        const response = await fetch(`${edgeUrl}/data/${extra}`, { headers: leProxyHeaders(), signal: controller.signal });
        clearTimeout(timeout);
        if (response.ok) {
          const text = await response.text();
          try { fetched[extra] = JSON.parse(text); } catch { /* non-JSON */ }
          logger.info(`[${syncLabel}] Fetched ${extra} from Light Engine`);
        }
      } catch { /* optional files — ignore errors */ }
    }
    
    // Update sync status
    syncStatus.lastSync = new Date().toISOString();
    syncStatus.lastSyncResult = errors === 0 ? 'success' : `partial (${errors} errors)`;
    syncStatus.syncCount++;
    syncStatus.errorCount += errors;
    syncStatus.filesUpdated += updated;
    if (isDaily) syncStatus.lastDailySync = new Date().toISOString();

    // Resolve farmId: FARM_ID env var takes priority (canonical ID), then
    // fetched farm.json, then local farm.json. The Light Engine may have a
    // stale wizard-generated ID while the env var has the real production ID.
    let farmId = process.env.FARM_ID;
    const fetchedFarmId = fetched['farm.json']?.farmId;
    if (!farmId) farmId = fetchedFarmId;
    if (!farmId) {
      const farmJsonPath = path.join(FARM_DATA_DIR, 'farm.json');
      if (fs.existsSync(farmJsonPath)) {
        try { farmId = JSON.parse(fs.readFileSync(farmJsonPath, 'utf8')).farmId; } catch { /* ignore */ }
      }
    }
    if (!farmId) {
      logger.warn(`[${syncLabel}] Cannot determine farm ID — skipping data storage`);
      return { ok: true, updated, errors, warning: 'no_farm_id' };
    }

    // If Light Engine farmId differs from canonical, log it and store under both
    const aliasFarmIds = new Set([farmId]);
    if (fetchedFarmId && fetchedFarmId !== farmId) {
      aliasFarmIds.add(fetchedFarmId);
      logger.info(`[${syncLabel}] Light Engine farmId '${fetchedFarmId}' differs from canonical '${farmId}' — storing under both`);
    }

    // ── Always populate in-memory store (primary storage when DB is down) ──
    const store = getInMemoryStore();
    const farmData = fetched['farm.json'] || {};

    if (fetched['groups.json']) {
      const raw = fetched['groups.json'];
      const groupsList = Array.isArray(raw) ? raw : (raw.groups || []);
      for (const fid of aliasFarmIds) store.groups.set(fid, groupsList);
      logger.info(`[${syncLabel}] In-memory: ${groupsList.length} groups for ${[...aliasFarmIds].join(', ')}`);
    }

    if (fetched['rooms.json']) {
      const raw = fetched['rooms.json'];
      const roomsList = Array.isArray(raw) ? raw : (raw.rooms || [raw]);
      for (const fid of aliasFarmIds) store.rooms.set(fid, roomsList);
      logger.info(`[${syncLabel}] In-memory: ${roomsList.length} rooms for ${[...aliasFarmIds].join(', ')}`);
    }

    if (fetched['env.json']) {
      if (!store.telemetry) store.telemetry = new Map();
      for (const fid of aliasFarmIds) store.telemetry.set(fid, fetched['env.json']);
      logger.info(`[${syncLabel}] In-memory: telemetry for ${[...aliasFarmIds].join(', ')}`);
    }

    if (fetched['schedules.json']) {
      for (const fid of aliasFarmIds) store.schedules.set(fid, fetched['schedules.json']);
      logger.info(`[${syncLabel}] In-memory: schedules for ${[...aliasFarmIds].join(', ')}`);
    }

    // Devices: prefer iot-devices.json, but extract from room-map.json if empty
    if (!store.devices) store.devices = new Map();
    let devicesList = [];
    if (fetched['iot-devices.json']) {
      const raw = fetched['iot-devices.json'];
      devicesList = Array.isArray(raw) ? raw : (raw.devices || []);
    }
    if (devicesList.length === 0 && fetched['room-map.json']) {
      const rmDevices = fetched['room-map.json'].devices || [];
      devicesList = rmDevices.map(d => ({
        device_code: d.deviceId || d.id,
        device_type: d.snapshot?.category || d.snapshot?.type || 'unknown',
        name: d.snapshot?.name || d.deviceId || 'Unknown Device',
        zone: d.snapshot?.zone != null ? `Zone ${d.snapshot.zone}` : 'Unassigned',
        room: d.snapshot?.room || 'Main Grow Room',
        status: 'online',
        last_seen: new Date().toISOString()
      }));
      logger.info(`[${syncLabel}] Extracted ${devicesList.length} devices from room-map.json`);
    }
    if (devicesList.length > 0) {
      for (const fid of aliasFarmIds) store.devices.set(fid, devicesList);
      logger.info(`[${syncLabel}] In-memory: ${devicesList.length} devices for ${[...aliasFarmIds].join(', ')}`);
    }

    // Room map: store in-memory for potential future use
    if (!store.room_map) store.room_map = new Map();
    if (fetched['room-map.json']) {
      for (const fid of aliasFarmIds) store.room_map.set(fid, fetched['room-map.json']);
      logger.info(`[${syncLabel}] In-memory: room_map for ${[...aliasFarmIds].join(', ')}`);
    }

    // Farm profile: store farm.json as farm_profile for admin API
    if (farmData && (farmData.name || farmData.farmName || farmData.farmId)) {
      if (!store.farm_profile) store.farm_profile = new Map();
      for (const fid of aliasFarmIds) store.farm_profile.set(fid, farmData);
      logger.info(`[${syncLabel}] In-memory: farm_profile for ${[...aliasFarmIds].join(', ')}`);
    }

    // Tray formats: hydrate in-memory from flat file if not already populated
    // (tray formats are created via UI, not synced from the Light Engine,
    //  so they only live in the flat file / DB — seed them into memory on startup)
    if (!store.tray_formats) store.tray_formats = new Map();
    for (const fid of aliasFarmIds) {
      if (!store.tray_formats.has(fid)) {
        try {
          const tfPath = path.join(FARM_DATA_DIR, 'tray-formats.json');
          if (fs.existsSync(tfPath)) {
            const tfData = JSON.parse(fs.readFileSync(tfPath, 'utf8'));
            if (Array.isArray(tfData) && tfData.length > 0) {
              store.tray_formats.set(fid, tfData);
              logger.info(`[${syncLabel}] In-memory: ${tfData.length} tray_formats from flat file for ${fid}`);
            }
          }
        } catch (tfErr) {
          logger.warn(`[${syncLabel}] Failed to load tray-formats.json:`, tfErr.message);
        }
      }
    }

    // ── DB upsert (when available) ──
    try {
      const { query: dbQuery, isDatabaseAvailable } = await import('./config/database.js');
      if (farmId && await isDatabaseAvailable()) {
        async function upsertFarmData(dataType, data) {
          await dbQuery(
            `INSERT INTO farm_data (farm_id, data_type, data, updated_at)
             VALUES ($1, $2, $3, NOW())
             ON CONFLICT (farm_id, data_type)
             DO UPDATE SET data = $3, updated_at = NOW()`,
            [farmId, dataType, JSON.stringify(data)]
          );
        }

        // Use fetched data (from Light Engine), falling back to local files
        const resolve = (fetchedKey, localFile, extractor) => {
          if (fetched[fetchedKey]) return extractor ? extractor(fetched[fetchedKey]) : fetched[fetchedKey];
          const p = path.join(FARM_DATA_DIR, localFile || fetchedKey);
          if (fs.existsSync(p)) {
            const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
            return extractor ? extractor(raw) : raw;
          }
          return null;
        };

        const telemetry = resolve('env.json', 'env.json');
        if (telemetry) { await upsertFarmData('telemetry', telemetry); logger.info(`[${syncLabel}] DB: telemetry for ${farmId}`); }

        const groups = resolve('groups.json', 'groups.json', r => Array.isArray(r) ? r : (r.groups || []));
        if (groups) { await upsertFarmData('groups', groups); logger.info(`[${syncLabel}] DB: ${groups.length} groups for ${farmId}`); }

        const rooms = resolve('rooms.json', 'rooms.json', r => Array.isArray(r) ? r : (r.rooms || [r]));
        if (rooms) { await upsertFarmData('rooms', rooms); logger.info(`[${syncLabel}] DB: ${rooms.length} rooms for ${farmId}`); }

        const schedules = resolve('schedules.json', 'schedules.json');
        if (schedules) { await upsertFarmData('schedules', schedules); logger.info(`[${syncLabel}] DB: schedules for ${farmId}`); }

        const devices = resolve('iot-devices.json', 'iot-devices.json', r => Array.isArray(r) ? r : (r.devices || []));
        // IMPORTANT: The browser's persistIotDevices() saves device registry
        // data directly to the DB via farmDataWriteMiddleware (which also
        // forwards to the Light Engine). The Light Engine's flat file mirrors
        // the DB — only seed if the DB has no existing device data.
        if (devices && Array.isArray(devices) && devices.length > 0) {
          let existingArr = [];
          try {
            const existResult = await dbQuery(
              `SELECT data FROM farm_data WHERE farm_id = $1 AND data_type = $2`,
              [farmId, 'devices']
            );
            if (existResult.rows.length > 0 && existResult.rows[0].data != null) {
              const existData = existResult.rows[0].data;
              existingArr = Array.isArray(existData) ? existData : (existData?.devices || []);
            }
          } catch (_) { /* DB read failed — allow upsert */ }
          if (existingArr.length === 0) {
            await upsertFarmData('devices', devices);
            logger.info(`[${syncLabel}] DB: ${devices.length} devices for ${farmId} (DB was empty, seeded from Light Engine)`);
          } else {
            logger.info(`[${syncLabel}] DB: Skipping devices upsert — DB already has ${existingArr.length} device(s) for ${farmId} (browser is authoritative)`);
          }
        }

        if (Object.keys(farmData).length > 0) {
          await upsertFarmData('farm_profile', farmData);
          logger.info(`[${syncLabel}] DB: farm_profile for ${farmId}`);
        }

        // IMPORTANT: The browser's room-mapper saves room map data directly
        // to the DB via farmDataWriteMiddleware. The Light Engine flat file
        // may be stale (missing sensors, old positions). Only seed if DB is empty.
        const roomMap = resolve('room-map.json', 'room-map.json');
        if (roomMap) {
          let existingRoomMap = null;
          try {
            const existResult = await dbQuery(
              `SELECT data FROM farm_data WHERE farm_id = $1 AND data_type = $2`,
              [farmId, 'room_map']
            );
            if (existResult.rows.length > 0 && existResult.rows[0].data != null) {
              existingRoomMap = existResult.rows[0].data;
            }
          } catch (_) { /* DB read failed — allow upsert */ }
          const hasExistingDevices = existingRoomMap &&
            Array.isArray(existingRoomMap.devices) &&
            existingRoomMap.devices.length > 0;
          if (!hasExistingDevices) {
            await upsertFarmData('room_map', roomMap);
            logger.info(`[${syncLabel}] DB: room_map for ${farmId} (DB was empty, seeded from Light Engine)`);
          } else {
            logger.info(`[${syncLabel}] DB: Skipping room_map upsert — DB already has ${existingRoomMap.devices.length} device(s) for ${farmId} (browser is authoritative)`);
          }
        }

        const lightSetups = resolve('light-setups.json', 'light-setups.json');
        if (lightSetups) { await upsertFarmData('light_setups', lightSetups); logger.info(`[${syncLabel}] DB: light_setups for ${farmId}`); }

        const plans = resolve('plans.json', 'plans.json');
        if (plans) { await upsertFarmData('plans', plans); logger.info(`[${syncLabel}] DB: plans for ${farmId}`); }

        // Update farms table metadata
        const farmMeta = {
          contact: farmData.contact || {},
          location: farmData.location || '',
          address: farmData.address || '',
          city: farmData.city || '',
          state: farmData.state || '',
          postalCode: farmData.postalCode || '',
          region: farmData.region || '',
          coordinates: farmData.coordinates || {},
          website: farmData.contact?.website || farmData.website || '',
          phone: farmData.contact?.phone || farmData.phone || '',
          contactName: farmData.contact?.name || farmData.contactName || '',
          roomsList: farmData.rooms || []
        };
        await dbQuery(
          `UPDATE farms SET
            name = COALESCE(NULLIF($1, ''), name),
            email = COALESCE(NULLIF($2, ''), email),
            metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb,
            updated_at = NOW()
          WHERE farm_id = $4`,
          [farmData.name || '', farmData.contact?.email || farmData.email || '', JSON.stringify(farmMeta), farmId]
        );
        logger.info(`[${syncLabel}] DB: Updated farm metadata for ${farmId}: name="${farmData.name}"`);
      }
    } catch (telErr) {
      logger.warn(`[${syncLabel}] DB upsert skipped or failed:`, telErr.message);
    }

    // Also register this farm in the wholesale network store
    // so the aggregator can fetch its inventory
    if (updated > 0 && farmId && edgeUrl) {
      try {
        await upsertNetworkFarm(farmId, {
          name: farmData.name || farmId,
          api_url: edgeUrl,
          url: edgeUrl,
          status: 'active',
          contact: farmData.contact || {},
          location: { region: farmData.region, city: farmData.location }
        });
        // Also persist api_url to DB so heartbeats can rediscover it after restart
        try {
          const { query: dbQuery, isDatabaseAvailable } = await import('./config/database.js');
          if (await isDatabaseAvailable()) {
            await dbQuery('UPDATE farms SET api_url = $1 WHERE farm_id = $2 AND (api_url IS NULL OR api_url != $1)', [edgeUrl, farmId]);
          }
        } catch (dbErr) {
          logger.warn(`[${syncLabel}] Failed to persist api_url to DB:`, dbErr.message);
        }
        logger.info(`[${syncLabel}] Registered farm ${farmId} in wholesale network (${edgeUrl})`);
      } catch (regErr) {
        logger.warn(`[${syncLabel}] Failed to register farm in network store:`, regErr.message);
      }
    }
    
    return { ok: true, updated, errors, timestamp: syncStatus.lastSync };
  } catch (error) {
    syncStatus.errorCount++;
    syncStatus.lastSyncResult = `error: ${error.message}`;
    logger.error(`[${syncLabel}] Sync error:`, error.message);
    return { ok: false, error: error.message };
  }
}

// Daily sync scheduler — runs once at the configured hour
function scheduleDailySync() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(DAILY_SYNC_HOUR, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  
  const msUntilNext = next - now;
  logger.info(`[DailySync] Next daily sync scheduled for ${next.toISOString()} (in ${Math.round(msUntilNext / 60000)} min)`);
  
  setTimeout(() => {
    syncFarmData({ isDaily: true });
    // Reschedule for next day
    setInterval(() => syncFarmData({ isDaily: true }), 24 * 60 * 60 * 1000);

  // Phase 3 Task 33: Weekly anomaly correlation
  setTimeout(() => {
    correlateAnomalies();
    setInterval(correlateAnomalies, 7 * 24 * 60 * 60 * 1000);
  }, 10 * 60 * 1000);  }, msUntilNext);
}

// Run initial sync after 10 seconds, then at configured interval + daily schedule
setTimeout(() => { syncFarmData(); syncFarmIdentity(); }, 10000);
setInterval(() => { syncFarmData(); syncFarmIdentity(); }, FARM_SYNC_INTERVAL);
scheduleDailySync();

logger.info(`[FarmSync] Sync interval: ${FARM_SYNC_INTERVAL / 1000}s, Daily sync hour: ${DAILY_SYNC_HOUR}:00`);

// Manual sync endpoint
app.post('/api/sync/pull-farm-data', authMiddleware, async (req, res) => {
  try {
    const result = await syncFarmData({ manual: true });
    res.json({ ok: true, message: 'Farm data sync complete', ...result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// Sync status endpoint
app.get('/api/sync/status', authMiddleware, (req, res) => {
  res.json({
    ok: true,
    config: {
      intervalMs: FARM_SYNC_INTERVAL,
      dailySyncHour: DAILY_SYNC_HOUR,
      edgeUrl: resolveEdgeUrl() || 'not configured'
    },
    status: syncStatus
  });
});

// CORS is now mounted early (before farmDataMiddleware & express.static)
// See the CORS section above helmet middleware for the corsOptions definition.


// Request logging
app.use(requestLogger);

// Attach database pool to request when available
app.use((req, res, next) => {
  if (app.locals.databaseReady) {
    try {
      req.db = getDatabase();
    } catch (error) {
      req.db = null;
    }
  }
  next();
});

// Farm context extractor — lightweight middleware that attaches farmId
// to every request from JWT token, API key header, subdomain, or env default.
// This enables all compatibility routes to use req.farmId for scoped queries.
import _jwtLib from 'jsonwebtoken';
function get_JWT_SECRET() {
  if (!process.env.JWT_SECRET && (process.env.NODE_ENV === 'production' || process.env.DEPLOYMENT_MODE === 'cloud')) {
    throw new Error('JWT_SECRET environment variable is required in production');
  }
  return process.env.JWT_SECRET || randomBytes(32).toString('hex');
}
const _JWT_SECRET = get_JWT_SECRET();

// Cache: slug → farm_id (populated lazily, cleared on farm upsert)
const _slugCache = new Map();

/** Resolve a subdomain slug to a farm_id via DB lookup (cached). */
async function _resolveSlug(slug) {
  if (!slug) return null;
  if (_slugCache.has(slug)) return _slugCache.get(slug);
  try {
    if (!(await isDatabaseAvailable())) return null;
    const { rows } = await query(
      'SELECT farm_id FROM farms WHERE slug = $1 LIMIT 1', [slug]
    );
    if (rows.length) {
      _slugCache.set(slug, rows[0].farm_id);
      return rows[0].farm_id;
    }
  } catch (_) { /* DB not available — fall through */ }
  return null;
}

/** Extract subdomain slug from Host header. Returns null for bare/apex domains. */
function _extractSlug(host) {
  if (!host) return null;
  // Strip port
  const hostname = host.split(':')[0];
  // Must be *.greenreachgreens.com (not the apex itself)
  if (!hostname.endsWith('.greenreachgreens.com')) return null;
  const parts = hostname.split('.');
  // parts: ['notable-sprout', 'greenreachgreens', 'com']
  if (parts.length !== 3) return null;
  const slug = parts[0];
  if (!slug || slug === 'www' || slug === 'api') return null;
  return slug;
}

app.use(async (req, res, next) => {
  // 1. JWT token
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const payload = _jwtLib.verify(authHeader.substring(7), _JWT_SECRET, {
        issuer: 'greenreach-central',
        audience: 'greenreach-farms'
      });
      req.farmId = payload.farm_id;
      req.plan_type = payload.plan_type || 'light-engine';
      req.farmAuth = { method: 'jwt', role: payload.role, email: payload.email };
      return next();
    } catch (_) { /* fall through */ }
  }

  // 2. API key header — validate against GREENREACH_API_KEY
  if (req.headers['x-api-key'] && req.headers['x-farm-id']) {
    const expected = process.env.GREENREACH_API_KEY;
    if (expected) {
      try {
        const a = Buffer.from(req.headers['x-api-key'], 'utf8');
        const b = Buffer.from(expected, 'utf8');
        if (a.length === b.length && (await import('crypto')).timingSafeEqual(a, b)) {
          req.farmId = req.headers['x-farm-id'];
          req.farmAuth = { method: 'api-key' };
          return next();
        }
      } catch (_) { /* invalid key */ }
    }
    // Key provided but invalid — still allow farm-id for non-production
    if (process.env.NODE_ENV !== 'production') {
      req.farmId = req.headers['x-farm-id'];
      req.farmAuth = { method: 'api-key-unverified' };
      return next();
    }
  }

  // 3. x-farm-id header only (no API key) — allow for non-mutating requests
  if (req.headers['x-farm-id']) {
    req.farmId = req.headers['x-farm-id'];
    req.farmAuth = { method: 'header' };
    return next();
  }

  // 4. Subdomain slug (cloud SaaS mode)
  const slug = req.headers['x-farm-slug'] || _extractSlug(req.headers.host);
  if (slug) {
    const farmId = await _resolveSlug(slug);
    if (farmId) {
      req.farmId = farmId;
      req.farmSlug = slug;
      req.farmAuth = { method: 'subdomain' };
      return next();
    }
  }

  // 5. Env default (single-farm mode) — only in non-production
  if (process.env.FARM_ID && process.env.NODE_ENV !== 'production') {
    req.farmId = process.env.FARM_ID;
    req.farmAuth = { method: 'env-default' };
    return next();
  }

  // No farm context — null farmId (route handlers should check)
  req.farmId = null;
  req.farmAuth = { method: 'none' };
  next();
});

// Rate limiting - increased limits for dashboard usage
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 500, // 500 requests per 15 min
  message: { success: false, error: 'Too many requests from this IP, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting for debug/tracking endpoints (logging only)
    return req.path.startsWith('/api/debug/') || req.path.startsWith('/api/sync/');
  },
  skipFailedRequests: true
});
app.use('/api/', limiter);

// Strict rate limiter for authentication endpoints (brute-force protection)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: { success: false, error: 'Too many login attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/auth/login', authLimiter);
app.use('/api/farm/auth/login', authLimiter);
app.use('/api/farm-auth/login', authLimiter);
app.use('/api/admin/auth/login', authLimiter);
app.use('/api/wholesale/auth', authLimiter);
app.use('/api/producer/auth', authLimiter);

// Health check endpoint (no auth required)
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    databaseReady: Boolean(req.app.locals.databaseReady),
    timestamp: new Date().toISOString(),
    version: process.env.API_VERSION || 'v1.0.1', // Force version bump for restart
    uptime: process.uptime()
  });
});

// Diagnostic: check marketing table existence
app.get('/health/marketing-tables', async (req, res) => {
  try {
    const { query: dbQuery, isDatabaseAvailable } = await import('./config/database.js');
    if (!isDatabaseAvailable()) return res.json({ status: 'no-db' });
    const result = await dbQuery(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('marketing_posts','marketing_rules','marketing_skills','marketing_post_history','site_settings') ORDER BY tablename`);
    const found = result.rows.map(r => r.tablename);
    res.json({ status: found.length >= 5 ? 'ok' : 'missing', tables: found });
  } catch (error) {
    res.json({ status: 'error', error: error.message });
  }
});

// Version endpoint (lightweight alternative to /health)
app.get('/api/version', (req, res) => {
  res.json({
    version: APP_VERSION,
    buildTime: BUILD_TIME,
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// SaaS status endpoint — returns multi-tenant state and farm context info
app.get('/api/saas/status', async (req, res) => {
  const store = getInMemoryStore();
  const farmCount = new Set([
    ...store.rooms.keys(),
    ...store.groups.keys(),
    ...store.schedules.keys(),
    ...store.inventory.keys(),
    ...(store.telemetry?.keys?.() || []),
  ]).size;

  const farmIds = [...new Set([
    ...store.rooms.keys(),
    ...store.groups.keys(),
  ])];

  res.json({
    mode: 'multi-tenant',
    databaseReady: Boolean(req.app.locals.databaseReady),
    requestFarmId: req.farmId || null,
    requestFarmSlug: req.farmSlug || null,
    requestAuthMethod: req.farmAuth?.method || null,
    inMemoryFarmCount: farmCount,
    activeFarms: farmIds,
    storeStats: {
      rooms: store.rooms.size,
      groups: store.groups.size,
      schedules: store.schedules.size,
      inventory: store.inventory.size,
      telemetry: store.telemetry?.size || 0,
    },
    timestamp: new Date().toISOString()
  });
});

// ── Farm slug management (Phase 4: Cloud SaaS subdomain routing) ─────────
// GET  /api/admin/farms/:farmId/slug — read current slug
// PUT  /api/admin/farms/:farmId/slug — set/update slug (body: { slug })
app.get('/api/admin/farms/:farmId/slug', adminAuthMiddleware, async (req, res) => {
  try {
    if (!(await isDatabaseAvailable())) return res.status(503).json({ error: 'Database unavailable' });
    const { rows } = await query('SELECT slug FROM farms WHERE farm_id = $1', [req.params.farmId]);
    if (!rows.length) return res.status(404).json({ error: 'Farm not found' });
    res.json({ farm_id: req.params.farmId, slug: rows[0].slug });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/admin/farms/:farmId/slug', adminAuthMiddleware, async (req, res) => {
  try {
    if (!(await isDatabaseAvailable())) return res.status(503).json({ error: 'Database unavailable' });
    const rawSlug = (req.body?.slug || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/(^-|-$)/g, '');
    if (!rawSlug || rawSlug.length < 3) return res.status(400).json({ error: 'Slug must be at least 3 chars (a-z, 0-9, hyphens)' });
    // Check uniqueness
    const { rows: existing } = await query('SELECT farm_id FROM farms WHERE slug = $1 AND farm_id != $2', [rawSlug, req.params.farmId]);
    if (existing.length) return res.status(409).json({ error: `Slug "${rawSlug}" already in use by farm ${existing[0].farm_id}` });
    await query('UPDATE farms SET slug = $1, updated_at = NOW() WHERE farm_id = $2', [rawSlug, req.params.farmId]);
    // Clear slug cache so the subdomain middleware picks up the change
    _slugCache.delete(rawSlug);
    _slugCache.forEach((fid, key) => { if (fid === req.params.farmId) _slugCache.delete(key); });
    res.json({ farm_id: req.params.farmId, slug: rawSlug, url: `https://${rawSlug}.greenreachgreens.com` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Debug tracking endpoint - receives client-side debug events for server logging
app.post('/api/debug/track', express.json(), (req, res) => {
  const { events, sessionId } = req.body;
  
  if (!events || !Array.isArray(events)) {
    return res.status(400).json({ error: 'Invalid events data' });
  }
  
  // Log each event to console with prominent styling
  events.forEach(event => {
    const timestamp = event.timestamp || new Date().toISOString();
    const eventType = event.type || 'UNKNOWN';
    const eventData = { ...event };
    delete eventData.timestamp;
    delete eventData.type;
    
    // Color-coded log prefix based on event type
    let prefix = '🔵 [DEBUG]';
    if (eventType === 'ERROR') prefix = '🔴 [ERROR]';
    else if (eventType === 'API_CALL') prefix = '🌐 [API]';
    else if (eventType === 'PAGE_VIEW') prefix = '📄 [PAGE]';
    else if (eventType === 'CLICK') prefix = '🖱️  [CLICK]';
    
    console.log(`${prefix} ${eventType}`, JSON.stringify(eventData, null, 2));
  });
  
  res.json({ success: true, logged: events.length });
});

// Live environmental data — prefer DB telemetry (pushed by sync-service from the
// actual farm device every 30s) over LE-EB proxy (which only has static deploy data).
// Fall back to LE proxy when DB has no telemetry (e.g. fresh install, DB down).
app.get('/env', authMiddleware, async (req, res) => {
  const hours = req.query.hours || 24;
  const farmId = farmStore.farmIdFromReq(req);

  // 1. Try DB telemetry first — sync-service pushes live data from the farm device
  try {
    const dbData = await farmStore.get(farmId, 'telemetry');
    if (dbData && Array.isArray(dbData.zones) && dbData.zones.length > 0) {
      logger.info(`[Env] Serving DB telemetry for farm ${farmId} (${dbData.zones.length} zones)`);
      return res.json({
        ...dbData,
        meta: {
          ...(dbData.meta || {}),
          envSource: 'sync-service',
          updatedAt: dbData.timestamp || dbData.lastUpdated || new Date().toISOString()
        }
      });
    }
  } catch (dbErr) {
    logger.warn(`[Env] DB telemetry read failed: ${dbErr.message}`);
  }

  // 2. Fall back to LE proxy (cloud LE instance)
  try {
    const leUrl = resolveEdgeUrlForProxy();
    if (!leUrl) throw new Error('No Light Engine URL configured');
    const upstream = `${leUrl}/env?hours=${hours}`;
    logger.info(`[Env] No DB telemetry, proxying to Light Engine: ${upstream}`);
    const response = await fetch(upstream, {
      method: 'GET',
      headers: leProxyHeaders(),
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) throw new Error(`LE returned ${response.status}`);
    const data = await response.json();
    return res.json(data);
  } catch (proxyErr) {
    logger.warn(`[Env] LE proxy also failed: ${proxyErr.message}`);
    return res.status(200).json({ zones: [] });
  }
});

// /api/env is handled by envProxyRoutes (mounted later at L~2696).
// Do NOT add an app.get('/api/env') handler here — it would shadow the proxy.

const COMPAT_DEFAULT_PLANS = [
  {
    id: 'crop-bibb-butterhead',
    name: 'Bibb Butterhead',
    crop: 'Bibb Butterhead',
    ppfd: 220,
    light: {
      days: [
        { day: 1, stage: 'seedling', ppfd: 180, dli: 10 },
        { day: 8, stage: 'vegetative', ppfd: 220, dli: 12 },
        { day: 15, stage: 'finish', ppfd: 250, dli: 14 }
      ]
    }
  },
  {
    id: 'crop-buttercrunch-lettuce',
    name: 'Buttercrunch Lettuce',
    crop: 'Buttercrunch Lettuce',
    ppfd: 220,
    light: {
      days: [
        { day: 1, stage: 'seedling', ppfd: 180, dli: 10 },
        { day: 8, stage: 'vegetative', ppfd: 220, dli: 12 },
        { day: 15, stage: 'finish', ppfd: 260, dli: 14 }
      ]
    }
  },
  {
    id: 'crop-salad-bowl-oakleaf',
    name: 'Salad Bowl Oakleaf',
    crop: 'Salad Bowl Oakleaf',
    ppfd: 230,
    light: {
      days: [
        { day: 1, stage: 'seedling', ppfd: 185, dli: 10 },
        { day: 8, stage: 'vegetative', ppfd: 230, dli: 13 },
        { day: 15, stage: 'finish', ppfd: 270, dli: 15 }
      ]
    }
  },
  {
    id: 'crop-astro-arugula',
    name: 'Astro Arugula',
    crop: 'Astro Arugula',
    ppfd: 240,
    light: {
      days: [
        { day: 1, stage: 'seedling', ppfd: 190, dli: 11 },
        { day: 8, stage: 'vegetative', ppfd: 240, dli: 13 },
        { day: 15, stage: 'finish', ppfd: 280, dli: 15 }
      ]
    }
  }
];

function mergeCompatibilityPlans(plans) {
  const currentPlans = Array.isArray(plans) ? plans : [];
  const seen = new Set(currentPlans.map((plan) => String(plan?.id || plan?.name || '').trim()).filter(Boolean));
  const merged = [...currentPlans];

  for (const fallbackPlan of COMPAT_DEFAULT_PLANS) {
    if (!seen.has(fallbackPlan.id)) {
      merged.push(fallbackPlan);
    }
  }

  return merged;
}

app.get('/plans', authMiddleware, async (req, res) => {
  try {
    const fid = farmStore.farmIdFromReq(req);
    let plans = await farmStore.get(fid, 'plans');
    if (!plans || (Array.isArray(plans) && plans.length === 0)) {
      // Fallback: try schedules data type
      const schedData = await farmStore.get(fid, 'schedules');
      plans = schedData?.plans || schedData?.schedules || schedData || [];
    }
    plans = Array.isArray(plans) ? plans : [];
    return res.json({ plans: mergeCompatibilityPlans(plans) });
  } catch (error) {
    logger.warn('[Compat] /plans fallback failed:', error.message);
    return res.json({ plans: [...COMPAT_DEFAULT_PLANS] });
  }
});

app.get('/api/farm/profile', authMiddleware, async (req, res) => {
  try {
    const fid = farmStore.farmIdFromReq(req);
    let farm = await farmStore.get(fid, 'farm_profile');

    // If farm_data has no profile for this farm, try the farms table directly
    if ((!farm || !farm.name) && fid && req.db) {
      try {
        const result = await req.db.query(
          'SELECT farm_id, name, status, slug, plan_type, created_at FROM farms WHERE farm_id = $1 LIMIT 1',
          [fid]
        );
        if (result.rows.length > 0) {
          const row = result.rows[0];
          farm = {
            farmId: row.farm_id,
            farm_id: row.farm_id,
            name: row.name || row.farm_id,
            status: row.status || 'active',
            planType: row.plan_type || 'cloud',
            slug: row.slug,
            createdAt: row.created_at
          };
        }
      } catch (dbErr) {
        logger.debug('[farm/profile] farms table lookup failed:', dbErr.message);
      }
    }

    farm = farm || {};
    const farmId = farm.farmId || farm.farm_id || fid || 'LOCAL-FARM';

    return res.json({
      status: 'success',
      farm: {
        farmId,
        name: farm.name || farm.farmName || farmId,
        farmName: farm.farmName || farm.name || farmId,
        status: farm.status || 'active',
        contact: farm.contact || {},
        email: farm.email || farm.contact?.email || null,
        phone: farm.phone || farm.contact?.phone || null,
        address: farm.address || null,
        city: farm.city || null,
        state: farm.state || null,
        location: farm.location || null,
        timezone: farm.timezone || null,
        coordinates: farm.coordinates || null,
        metadata: farm,
        rooms: Array.isArray(farm.rooms) ? farm.rooms : [],
        groups: []
      }
    });
  } catch (error) {
    logger.warn('[Compat] /api/farm/profile fallback failed:', error.message);
    return res.status(500).json({ error: 'Failed to load farm profile' });
  }
});

// ── Credential Store (SwitchBot / Kasa integration credentials) ────────────
app.get('/api/credential-store', authMiddleware, (req, res) => {
  try {
    const farmJsonPath = path.join(FARM_DATA_DIR, 'farm.json');
    const farm = JSON.parse(fs.readFileSync(farmJsonPath, 'utf8'));
    const integrations = farm.integrations || {};
    return res.json({
      ok: true,
      switchbot: { configured: !!(integrations.switchbot && integrations.switchbot.token) },
      kasa:      { configured: !!(integrations.kasa && integrations.kasa.email) }
    });
  } catch (err) {
    logger.warn('[credential-store] GET error:', err.message);
    return res.json({ ok: true, switchbot: { configured: false }, kasa: { configured: false } });
  }
});

app.post('/api/credential-store', authMiddleware, express.json(), (req, res) => {
  try {
    const farmJsonPath = path.join(FARM_DATA_DIR, 'farm.json');
    let farm = {};
    try { farm = JSON.parse(fs.readFileSync(farmJsonPath, 'utf8')); } catch (_) { /* new file */ }
    if (!farm.integrations) farm.integrations = {};
    const body = req.body || {};
    if (body.switchbot) {
      farm.integrations.switchbot = {
        token:  body.switchbot.token  || '',
        secret: body.switchbot.secret || '',
        region: body.switchbot.region || ''
      };
    }
    if (body.kasa) {
      farm.integrations.kasa = {
        email:    body.kasa.email    || '',
        password: body.kasa.password || ''
      };
    }
    fs.writeFileSync(farmJsonPath, JSON.stringify(farm, null, 2));
    const integrations = farm.integrations;
    return res.json({
      ok: true,
      switchbot: { configured: !!(integrations.switchbot && integrations.switchbot.token) },
      kasa:      { configured: !!(integrations.kasa && integrations.kasa.email) }
    });
  } catch (err) {
    logger.error('[credential-store] POST error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});


// ── SwitchBot Discover ─────────────────────────────────────────────────────
// Saves credentials to the DB and forwards them to the Light Engine so
// the sensor polling loop (syncSensorData) can authenticate with SwitchBot.
// Also queries the SwitchBot Cloud API directly to return discovered devices.
const SWITCHBOT_API_BASE = 'https://api.switch-bot.com/v1.1';

async function switchBotDiscover(req, res) {
  try {
    const { token, secret } = req.body || {};
    if (!token || !secret) {
      return res.status(400).json({ ok: false, error: 'Both token and secret are required', devices: [] });
    }

    // 1. Persist credentials to farmStore (database) — deployment-persistent
    try {
      const fid = farmStore.farmIdFromReq(req) || process.env.FARM_ID || 'default';
      await farmStore.set(fid, 'switchbot_credentials', {
        token: token.trim(),
        secret: secret.trim(),
        updatedAt: new Date().toISOString()
      });
      logger.info('[switchbot/discover] Credentials saved to farmStore (DB)');
    } catch (dbErr) {
      logger.warn('[switchbot/discover] farmStore save failed (non-fatal):', dbErr.message);
    }

    // 2. Forward credentials to the Light Engine so it can persist them
    //    locally (farm.json) and start polling SwitchBot sensors.
    //    Fire-and-forget — don't block the response on this.
    const lightEngineUrl = resolveEdgeUrlForProxy();
    if (lightEngineUrl) {
      fetch(`${lightEngineUrl}/switchbot/discover`, {
        method: 'POST',
        headers: leProxyHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ token: token.trim(), secret: secret.trim() }),
        signal: AbortSignal.timeout(12000)
      })
        .then(r => logger.info(`[switchbot/discover] Forwarded credentials to Light Engine: ${r.status}`))
        .catch(err => logger.warn(`[switchbot/discover] Light Engine credential forward failed (non-fatal): ${err.message}`));
    } else {
      logger.warn('[switchbot/discover] No Light Engine URL configured — credentials saved to DB only');
    }

    // 3. Call SwitchBot Cloud API v1.1 to discover devices
    const t = Date.now().toString();
    const nonce = randomUUID ? randomUUID().replace(/-/g, '') : randomBytes(16).toString('hex');
    const strToSign = token.trim() + t + nonce;
    const sign = createHmac('sha256', secret.trim()).update(strToSign, 'utf8').digest('base64');

    const controller = new AbortController();
    const fetchTimeout = setTimeout(() => controller.abort(), 10000);
    if (fetchTimeout.unref) fetchTimeout.unref();

    let response;
    try {
      response = await fetch(`${SWITCHBOT_API_BASE}/devices`, {
        method: 'GET',
        headers: {
          'Authorization': token.trim(),
          't': t,
          'sign': sign,
          'nonce': nonce,
          'Content-Type': 'application/json'
        },
        signal: controller.signal
      });
    } catch (fetchErr) {
      clearTimeout(fetchTimeout);
      const status = fetchErr.name === 'AbortError' ? 504 : 502;
      return res.status(status).json({ ok: false, error: fetchErr.message || 'Network error', devices: [] });
    }
    clearTimeout(fetchTimeout);

    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.statusCode !== 100) {
      const status = response.status === 401 ? 401 : response.status === 429 ? 429 : 502;
      return res.status(status).json({
        ok: false,
        error: body.message || `SwitchBot API error (${response.status})`,
        devices: []
      });
    }

    const deviceList = body.body?.deviceList || [];
    const infraredList = body.body?.infraredRemoteList || [];
    const allDevices = [...deviceList, ...infraredList].map(d => ({
      name: d.deviceName || d.remoteType || `SwitchBot ${d.deviceType}`,
      deviceName: d.deviceName || d.remoteType || `SwitchBot ${d.deviceType}`,
      deviceId: d.deviceId,
      deviceType: d.deviceType || d.remoteType || 'Unknown',
      hubDeviceId: d.hubDeviceId || '',
    }));

    logger.info(`[switchbot/discover] Found ${allDevices.length} device(s)`);
    res.json({ ok: true, devices: allDevices, count: allDevices.length });
  } catch (error) {
    logger.error('[switchbot/discover] Error:', error.message);
    res.status(502).json({ ok: false, error: error.message || 'Failed to discover SwitchBot devices', devices: [] });
  }
}

app.post('/api/switchbot/discover', authMiddleware, express.json(), switchBotDiscover);
app.post('/switchbot/discover', authMiddleware, express.json(), switchBotDiscover);
app.get('/farm', authMiddleware, async (req, res) => {
  try {
    const fid = farmStore.farmIdFromReq(req);
    const farm = await farmStore.get(fid, 'farm_profile');
    return res.json(farm || {
      farmId: fid || 'LOCAL-FARM',
      farmName: 'Local Farm',
      ownerName: '',
      contactEmail: '',
      contactPhone: ''
    });
  } catch (_error) {
    return res.json({
      farmId: 'LOCAL-FARM',
      farmName: 'Local Farm',
      ownerName: '',
      contactEmail: '',
      contactPhone: ''
    });
  }
});

app.post('/farm', authMiddleware, async (req, res) => {
  try {
    const fid = farmStore.farmIdFromReq(req);
    const payload = req.body && typeof req.body === 'object' ? req.body : {};
    await farmStore.set(fid, 'farm_profile', payload);
    return res.json({ success: true, farm: payload });
  } catch (error) {
    logger.warn('[Compat] POST /farm failed:', error.message);
    return res.status(500).json({ success: false, error: 'Failed to save farm profile' });
  }
});

app.get('/api/setup/data', authMiddleware, async (req, res) => {
  try {
    const fid = farmStore.farmIdFromReq(req);
    const farmDoc = await farmStore.get(fid, 'farm_profile') || {};
    const rooms = await farmStore.get(fid, 'rooms') || [];
    const contact = farmDoc?.contact || {};

    return res.json({
      success: true,
      config: {
        farmName: farmDoc?.farmName || farmDoc?.name || 'This is Your Farm',
        ownerName: farmDoc?.ownerName || farmDoc?.owner || contact.name || '',
        contactEmail: farmDoc?.contactEmail || farmDoc?.email || contact.email || '',
        contactPhone: farmDoc?.contactPhone || farmDoc?.phone || contact.phone || '',
        contact: contact,
        rooms: Array.isArray(rooms) ? rooms : []
      }
    });
  } catch (error) {
    logger.warn('[Compat] /api/setup/data fallback failed:', error.message);
    return res.json({ success: true, config: { farmName: 'This is Your Farm', ownerName: '', contactEmail: '', contactPhone: '', rooms: [] } });
  }
});

app.post('/api/setup/save-rooms', authMiddleware, async (req, res) => {
  try {
    const fid = farmStore.farmIdFromReq(req);
    const payload = req.body || {};
    const rooms = Array.isArray(payload.rooms) ? payload.rooms : [];
    await farmStore.set(fid, 'rooms', rooms);
    return res.json({ success: true, rooms, source: 'farm-store' });
  } catch (error) {
    logger.warn('[Compat] /api/setup/save-rooms failed:', error.message);
    return res.status(500).json({ success: false, message: 'Failed to save rooms' });
  }
});

app.get('/api/reverse-geocode', authMiddleware, (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ ok: false, error: 'lat and lng are required' });
  }

  return res.json({
    ok: true,
    display_name: `Lat ${lat.toFixed(5)}, Lng ${lng.toFixed(5)}`,
    address: {
      city: 'Local City',
      state: 'NY',
      country: 'USA',
      postcode: '00000'
    }
  });
});

app.get('/forwarder/network/wifi/scan', authMiddleware, (_req, res) => {
  return res.json({
    ok: true,
    networks: [
      { ssid: 'Farm-WiFi', signal: -52, security: 'WPA2' },
      { ssid: 'Farm-Guest', signal: -67, security: 'WPA2' }
    ]
  });
});

app.get('/forwarder/network/scan', authMiddleware, (_req, res) => {
  return res.json({
    ok: true,
    devices: []
  });
});

app.get('/api/admin/farms/:farmId/devices', adminAuthMiddleware, async (req, res) => {
  try {
    const fid = req.params.farmId || farmStore.farmIdFromReq(req);
    const devices = await farmStore.get(fid, 'devices') || [];

    return res.json({
      success: true,
      farmId: req.params.farmId,
      count: devices.length,
      devices
    });
  } catch (error) {
    logger.warn('[Compat] /api/admin/farms/:farmId/devices failed:', error.message);
    return res.json({ success: true, farmId: req.params.farmId, count: 0, devices: [] });
  }
});

app.get('/api/audit/recent', authMiddleware, (_req, res) => {
  return res.json({ ok: true, activities: [] });
});

app.get('/api/activity-hub/orders/pending', authMiddleware, (_req, res) => {
  return res.json({ ok: true, orders: [] });
});

// Inventory management stubs removed — now served by inventoryMgmtRoutes

// ─── Traceability API proxy (routes requests to the farm's unified traceability API) ─────
import { listNetworkFarms as listTraceFarms } from './services/networkFarmsStore.js';

async function getFirstActiveFarmUrl() {
  try {
    const farms = await listTraceFarms();
    const active = farms.find(f => f.status === 'active' && f.api_url);
    return active ? active.api_url : null;
  } catch { return null; }
}

app.get('/api/traceability', authMiddleware, async (req, res) => {
  const farmUrl = await getFirstActiveFarmUrl();
  if (!farmUrl) return res.json({ ok: true, records: [] });
  try {
    const r = await fetch(`${farmUrl}/api/traceability?${new URLSearchParams(req.query)}`, { headers: leProxyHeaders(), signal: AbortSignal.timeout(5000) });
    return res.json(await r.json());
  } catch { return res.json({ ok: true, records: [] }); }
});

app.get('/api/traceability/stats', authMiddleware, async (req, res) => {
  const farmUrl = await getFirstActiveFarmUrl();
  if (!farmUrl) return res.json({ ok: true, stats: { total_records: 0, active_records: 0, crops_tracked: 0, total_events: 0 } });
  try {
    const r = await fetch(`${farmUrl}/api/traceability/stats`, { headers: leProxyHeaders(), signal: AbortSignal.timeout(5000) });
    return res.json(await r.json());
  } catch { return res.json({ ok: true, stats: { total_records: 0, active_records: 0, crops_tracked: 0, total_events: 0 } }); }
});

app.get('/api/traceability/lot/:lotCode', authMiddleware, async (req, res) => {
  const farmUrl = await getFirstActiveFarmUrl();
  if (!farmUrl) return res.json({ ok: false, error: 'No farm connected' });
  try {
    const r = await fetch(`${farmUrl}/api/traceability/lot/${req.params.lotCode}`, { headers: leProxyHeaders(), signal: AbortSignal.timeout(5000) });
    return res.json(await r.json());
  } catch (e) { return res.status(502).json({ ok: false, error: e.message }); }
});

app.get('/api/traceability/sfcr-export', authMiddleware, async (req, res) => {
  const farmUrl = await getFirstActiveFarmUrl();
  if (!farmUrl) return res.json({ ok: false, error: 'No farm connected' });
  try {
    const r = await fetch(`${farmUrl}/api/traceability/sfcr-export?${new URLSearchParams(req.query)}`, { headers: leProxyHeaders(), signal: AbortSignal.timeout(10000) });
    const ct = r.headers.get('content-type');
    if (ct) res.set('content-type', ct);
    const cd = r.headers.get('content-disposition');
    if (cd) res.set('content-disposition', cd);
    const body = await r.text();
    return res.send(body);
  } catch (e) { return res.status(502).json({ ok: false, error: e.message }); }
});

// Sustainability stubs — MOVED to routes/sustainability.js

app.get('/api/automation/rules', authMiddleware, (_req, res) => {
  return res.json({ success: true, rules: [] });
});

app.get('/api/automation/history', authMiddleware, (_req, res) => {
  return res.json({ success: true, history: [] });
});

app.get('/api/schedule-executor/status', authMiddleware, (_req, res) => {
  return res.json({
    success: true,
    enabled: false,
    message: 'Schedule executor compatibility mode',
    running: false
  });
});

app.get('/api/schedule-executor/ml-anomalies', authMiddleware, (_req, res) => {
  return res.json({ success: true, anomalies: [], count: 0 });
});

app.get('/api/ml/anomalies/statistics', authMiddleware, (_req, res) => {
  const now = Date.now();
  const hourly_buckets = [];
  for (let index = 23; index >= 0; index -= 1) {
    hourly_buckets.push({
      timestamp: new Date(now - (index * 60 * 60 * 1000)).toISOString(),
      critical: 0,
      warning: 0,
      info: 0
    });
  }

  return res.json({
    ok: true,
    total_events: 0,
    by_severity: { critical: 0, warning: 0, info: 0 },
    by_zone: {},
    hourly_buckets
  });
});

app.get('/api/ml/energy-forecast', authMiddleware, (_req, res) => {
  const now = new Date();
  const predictions = [];
  for (let index = 0; index < 12; index += 1) {
    const timestamp = new Date(now.getTime() + (index * 60 * 60 * 1000));
    predictions.push({
      timestamp: timestamp.toISOString(),
      energy_kwh: 0,
      confidence_lower: 0,
      confidence_upper: 0
    });
  }

  return res.json({
    ok: true,
    data: {
      predictions,
      total_daily_kwh: 0,
      peak_kwh: 0,
      avg_kwh: 0
    }
  });
});

app.get('/api/ml/insights/forecast/:zone', authMiddleware, (_req, res) => {
  const now = new Date();
  const predictions = [];
  for (let index = 0; index < 6; index += 1) {
    const timestamp = new Date(now.getTime() + (index * 60 * 60 * 1000));
    predictions.push({
      timestamp: timestamp.toISOString(),
      predicted_temp: 22,
      lower_bound: 21,
      upper_bound: 23
    });
  }
  return res.json({ ok: true, predictions });
});

// ── P0.1: Harvest Readiness compat (parity with LE /api/harvest/readiness) ──
app.get('/api/harvest/readiness', authMiddleware, async (req, res) => {
  try {
    const fid = farmStore.farmIdFromReq(req);
    const groups = await farmStore.get(fid, 'groups') || [];
    const trays = await farmStore.get(fid, 'trays') || [];

    const now = new Date();
    const notifications = groups
      .filter(g => (g.status || '').toLowerCase() !== 'harvested')
      .map(g => {
        // Estimate days remaining from tray data
        const groupTrays = trays.filter(t => t.groupId === g.id || t.group_id === g.id);
        let daysRemaining = null;
        if (g.estimatedHarvestDate) {
          const hd = new Date(g.estimatedHarvestDate);
          if (!Number.isNaN(hd.getTime())) daysRemaining = Math.max(0, Math.round((hd - now) / 86400000));
        }
        if (daysRemaining == null && Number.isFinite(Number(g.harvestIn))) {
          daysRemaining = Number(g.harvestIn);
        }
        // Simple readiness score: closer to harvest = higher score
        let readiness_score = 0;
        if (daysRemaining != null) {
          const maxDays = 30;
          readiness_score = Math.min(1, Math.max(0, (maxDays - daysRemaining) / maxDays));
        }
        return {
          group_id: g.id,
          group_name: g.name || g.crop || g.id,
          crop: g.crop || 'Unknown',
          readiness_score,
          days_remaining: daysRemaining,
          predicted_yield: null,
          tray_count: groupTrays.length,
          message: daysRemaining != null
            ? (daysRemaining <= 3 ? 'Harvest soon' : daysRemaining <= 7 ? 'Approaching harvest' : null)
            : 'No harvest date set'
        };
      });

    return res.json({
      ok: true,
      notifications,
      count: notifications.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.warn('[Compat] /api/harvest/readiness error:', error.message);
    return res.json({ ok: true, notifications: [], count: 0, timestamp: new Date().toISOString() });
  }
});

// ── P0.1: Loss Prediction compat (parity with LE /api/losses/predict) ──
app.get('/api/losses/predict', authMiddleware, async (req, res) => {
  try {
    const fid = farmStore.farmIdFromReq(req);
    const envData = await farmStore.get(fid, 'telemetry') || {};
    const zones = Array.isArray(envData?.zones) ? envData.zones : [];

    const alerts = [];
    for (const zone of zones) {
      const readings = Array.isArray(zone?.sensors)
        ? zone.sensors?.[0]?.readings
        : (zone?.sensors || zone || null);
      if (!readings) continue;

      const tempC = readings.temperature_c ?? readings.temp ?? readings.tempC ?? null;
      const rh = readings.humidity ?? readings.humidity_pct ?? readings.rh ?? null;

      // Simple risk heuristics matching LE loss-predictor patterns
      const factors = [];
      let risk = 0;
      if (tempC != null) {
        if (tempC > 32) { risk += 0.4; factors.push('High temperature'); }
        else if (tempC < 15) { risk += 0.3; factors.push('Low temperature'); }
      }
      if (rh != null) {
        if (rh > 85) { risk += 0.3; factors.push('High humidity'); }
        else if (rh < 30) { risk += 0.2; factors.push('Low humidity'); }
      }

      if (factors.length > 0) {
        alerts.push({
          zone: zone.id || zone.zone_id,
          zone_name: zone.name || zone.zone_name || zone.id,
          risk_score: Math.min(1, risk),
          factors,
          reason: factors[0],
          message: `${factors.join(', ')} detected`
        });
      }
    }

    return res.json({
      alerts: alerts.sort((a, b) => b.risk_score - a.risk_score),
      profiles_summary: { total_events: 0, reasons_profiled: 0, status: 'compatibility' }
    });
  } catch (error) {
    logger.warn('[Compat] /api/losses/predict error:', error.message);
    return res.json({ alerts: [], profiles_summary: { total_events: 0, reasons_profiled: 0, status: 'error' } });
  }
});

// ── P0.2: KPI endpoint compat (parity with LE /api/kpis) ──
app.get('/api/kpis', authMiddleware, async (req, res) => {
  try {
    const fid = farmStore.farmIdFromReq(req);
    const trays = await farmStore.get(fid, 'trays') || [];
    const groups = await farmStore.get(fid, 'groups') || [];

    const activeTrays = trays.filter(t => (t.status || '').toLowerCase() !== 'harvested');
    const harvested = trays.filter(t => (t.status || '').toLowerCase() === 'harvested');

    // Simple KPI derivation from available farm_data
    const kpis = {
      fill_rate: { value: null, unit: '%', source: 'not_available_on_central' },
      otif: { value: null, unit: '%', source: 'not_yet_instrumented' },
      contribution_margin: { value: null, unit: 'USD', source: 'not_available_on_central' },
      loss_rate: {
        value: harvested.length > 0
          ? +((trays.filter(t => (t.status || '').toLowerCase() === 'lost').length / trays.length) * 100).toFixed(1)
          : null,
        unit: '%',
        source: 'farm_data_trays'
      },
      forecast_error: { value: null, unit: '%', source: 'not_available_on_central' },
      labor_minutes_per_kg: { value: null, unit: 'min/kg', source: 'not_yet_instrumented' },
      input_reduction: { value: null, unit: '%', source: 'not_available_on_central' }
    };

    return res.json({
      ok: true,
      generated_at: new Date().toISOString(),
      period: 'current',
      kpis
    });
  } catch (error) {
    logger.warn('[Compat] /api/kpis error:', error.message);
    return res.json({
      ok: true,
      generated_at: new Date().toISOString(),
      period: 'current',
      kpis: {
        fill_rate: { value: null, unit: '%', source: 'error' },
        otif: { value: null, unit: '%', source: 'error' },
        contribution_margin: { value: null, unit: 'USD', source: 'error' },
        loss_rate: { value: null, unit: '%', source: 'error' },
        forecast_error: { value: null, unit: '%', source: 'error' },
        labor_minutes_per_kg: { value: null, unit: 'min/kg', source: 'error' },
        input_reduction: { value: null, unit: '%', source: 'error' }
      }
    });
  }
});

app.get('/api/health/insights', authMiddleware, async (req, res) => {
  try {
    const fid = farmStore.farmIdFromReq(req);
    const envData = await farmStore.get(fid, 'telemetry') || { zones: [] };
    const zones = Array.isArray(envData?.zones) ? envData.zones : [];
    const zoneScores = zones.map((zone) => ({
      zone_id: zone.id,
      zone_name: zone.name || zone.id,
      score: 80,
      grade: 'B',
      status: 'healthy'
    }));

    return res.json({
      ok: true,
      farm_score: 80,
      grade: 'B',
      zones: zoneScores,
      summary: {
        total_zones: zoneScores.length,
        excellent: 0,
        good: zoneScores.length,
        fair: 0,
        poor: 0
      },
      insights: [
        {
          message: 'Using compatibility health data while full ML pipeline initializes.',
          source: 'Compatibility Layer',
          priority: 'low'
        }
      ]
    });
  } catch (error) {
    logger.warn('[Compat] /api/health/insights fallback failed:', error.message);
    return res.json({
      ok: true,
      farm_score: 0,
      grade: 'N/A',
      zones: [],
      summary: { total_zones: 0, excellent: 0, good: 0, fair: 0, poor: 0 },
      insights: []
    });
  }
});

app.get('/api/health/vitality', authMiddleware, async (req, res) => {
  const scoreToStatus = (score) => {
    if (score >= 85) return 'excellent';
    if (score >= 70) return 'good';
    if (score >= 50) return 'fair';
    if (score >= 30) return 'poor';
    return 'critical';
  };

  const freshnessFor = (ageMinutes, staleAfterMinutes) => ({
    age_minutes: ageMinutes,
    stale: ageMinutes > staleAfterMinutes,
    status: ageMinutes > staleAfterMinutes ? 'stale' : 'fresh'
  });

  try {
    const trays = await getInventoryTraysForCompat(req.farmId);
    const activeTrays = trays.filter((tray) => (tray.status || '').toLowerCase() !== 'harvested');

    let envZones = [];
    try {
      const envData = await farmStore.get(farmStore.farmIdFromReq(req) || req.farmId, 'telemetry');
      envZones = Array.isArray(envData?.zones) ? envData.zones : [];
    } catch (_error) {
      envZones = [];
    }

    const environmentScore = envZones.length > 0 ? 82 : 70;
    const cropReadinessScore = activeTrays.length > 0 ? Math.min(95, 60 + activeTrays.length * 2) : 50;
    const nutrientScore = envZones.length > 0 ? 78 : 65;
    const operationsScore = 84;
    const overallScore = Math.round((environmentScore + cropReadinessScore + nutrientScore + operationsScore) / 4);

    return res.json({
      ok: true,
      timestamp: new Date().toISOString(),
      overall_score: overallScore,
      overall_status: scoreToStatus(overallScore),
      components: {
        environment: {
          score: environmentScore,
          status: scoreToStatus(environmentScore),
          status_reason: envZones.length > 0 ? `${envZones.length} zones reporting` : 'No zone telemetry available',
          data_freshness: freshnessFor(5, 30)
        },
        crop_readiness: {
          score: cropReadinessScore,
          status: scoreToStatus(cropReadinessScore),
          status_reason: `${activeTrays.length} active trays tracked`,
          data_freshness: freshnessFor(3, 60)
        },
        nutrient_health: {
          score: nutrientScore,
          status: scoreToStatus(nutrientScore),
          status_reason: envZones.length > 0 ? 'Nutrient conditions inferred from environment telemetry' : 'Limited nutrient telemetry',
          data_freshness: freshnessFor(8, 60)
        },
        operations: {
          score: operationsScore,
          status: scoreToStatus(operationsScore),
          status_reason: 'Core services operational',
          data_freshness: freshnessFor(2, 15)
        }
      },
      data_freshness: {
        environment: freshnessFor(5, 30),
        nutrients: freshnessFor(8, 60),
        inventory: freshnessFor(3, 60)
      }
    });
  } catch (error) {
    logger.warn('[Compat] /api/health/vitality fallback failed:', error.message);
    return res.status(500).json({ ok: false, error: 'Failed to load vitality data' });
  }
});

app.get('/api/ai/status', authMiddleware, async (req, res) => {
  try {
    // Count experiment records
    let experimentCount = 0;
    let benchmarkCount = 0;
    let modifierCount = 0;
    let lastMLRun = null;

    if (app.locals.databaseReady) {
      const db = (await import('./config/database.js')).getDatabase();
      if (db) {
        try {
          const aiFarmId = req.farmId || req.user?.farmId || req.headers['x-farm-id'];
          if (!aiFarmId) {
            return res.status(401).json({ error: 'Missing farm context' });
          }
          const expResult = await db.query('SELECT COUNT(*) as count FROM experiment_records WHERE farm_id = $1', [aiFarmId]);
          experimentCount = parseInt(expResult.rows[0]?.count) || 0;
        } catch (_) {}
        try {
          const bmResult = await db.query('SELECT COUNT(*) as count FROM crop_benchmarks');
          benchmarkCount = parseInt(bmResult.rows[0]?.count) || 0;
        } catch (_) {}
        try {
          const modResult = await db.query('SELECT COUNT(*) as count FROM network_recipe_modifiers');
          modifierCount = parseInt(modResult.rows[0]?.count) || 0;
        } catch (_) {}
      }
    }

    // Check file-based model metrics
    try {
      const fs = await import('fs');
      const metricsPath = path.join(__dirname, '..', 'data', 'ml-model-metrics.json');
      if (fs.existsSync(metricsPath)) {
        const metrics = JSON.parse(fs.readFileSync(metricsPath, 'utf-8'));
        lastMLRun = metrics.last_trained_at || null;
      }
    } catch (_) {}

    const activeModels = experimentCount > 0 ? Math.min(Math.floor(experimentCount / 10), 7) : 0;
    const readinessPct = Math.min(100, Math.round((experimentCount / 50) * 40 + (benchmarkCount > 0 ? 30 : 0) + (modifierCount > 0 ? 30 : 0)));

    return res.json({
      engine: { type: experimentCount > 10 ? 'ml+rules' : 'rules' },
      progress: {
        overall_readiness_pct: readinessPct,
        decisions: { total: experimentCount, acceptance_rate: experimentCount > 0 ? 0.85 : 0 },
        crop_cycles: { total: experimentCount }
      },
      active_models: activeModels,
      experiment_records: experimentCount,
      crop_benchmarks: benchmarkCount,
      recipe_modifiers: modifierCount,
      last_ml_run: lastMLRun,
      timeline: { days_remaining: Math.max(0, 210 - Math.floor((Date.now() - new Date('2026-02-21').getTime()) / 86400000)) },
      ml: { ready: experimentCount >= 10 }
    });
  } catch (error) {
    logger.warn('[ai-status] Error computing AI status:', error.message);
    return res.json({
      engine: { type: 'rules' },
      progress: { overall_readiness_pct: 0, decisions: { total: 0, acceptance_rate: 0 }, crop_cycles: { total: 0 } },
      timeline: { days_remaining: 0 },
      ml: { ready: false }
    });
  }
});

app.get('/api/inventory/current', authOrAdminMiddleware, async (req, res) => {
  try {
    const trays = await getInventoryTraysForCompat(req.farmId);
    const activeTrays = trays.filter((tray) => (tray.status || '').toLowerCase() !== 'harvested');
    const totalPlants = activeTrays.reduce((sum, tray) => sum + (Number(tray.plantCount) || 0), 0);
    const farmCount = new Set(activeTrays.map((tray) => String(tray.location || '').split(' - ')[0]).filter(Boolean)).size || 1;
    const cropSet = new Set(activeTrays.map((tray) => tray.recipe).filter(Boolean));

    return res.json({
      inventory: trays,
      byFarm: [{ farmId: 'local-farm', trays }],
      activeTrays: activeTrays.length,
      seedlingPlants: 0,
      totalPlants,
      farmCount,
      crops: Array.from(cropSet),
      summary: { total: trays.length }
    });
  } catch (error) {
    logger.warn('[Compat] /api/inventory/current fallback failed:', error.message);
    return res.json({ inventory: [], byFarm: [{ farmId: 'local-farm', trays: [] }], activeTrays: 0, seedlingPlants: 0, totalPlants: 0, farmCount: 0, crops: [], summary: { total: 0 } });
  }
});

app.get('/api/inventory/forecast', authOrAdminMiddleware, async (req, res) => {
  try {
    const trays = await getInventoryTraysForCompat(req.farmId);
    const buckets = splitForecastBuckets(trays);

    return res.json({
      forecast: trays,
      next7Days: { count: buckets.next7Days.length, trays: buckets.next7Days },
      next14Days: { count: buckets.next14Days.length, trays: buckets.next14Days },
      next30Days: { count: buckets.next30Days.length, trays: buckets.next30Days },
      beyond30Days: { count: buckets.beyond30Days.length, trays: buckets.beyond30Days }
    });
  } catch (error) {
    logger.warn('[Compat] /api/inventory/forecast fallback failed:', error.message);
    return res.json({
      forecast: [],
      next7Days: { count: 0, trays: [] },
      next14Days: { count: 0, trays: [] },
      next30Days: { count: 0, trays: [] },
      beyond30Days: { count: 0, trays: [] }
    });
  }
});

app.get('/api/tray-formats', authMiddleware, async (req, res) => {
  try {
    const fid = farmStore.farmIdFromReq(req);
    const formats = await farmStore.get(fid, 'tray_formats') || [];
    return res.json(Array.isArray(formats) ? formats : []);
  } catch (error) {
    logger.warn('[Compat] /api/tray-formats GET failed:', error.message);
    return res.json([]);
  }
});

app.post('/api/tray-formats', authMiddleware, async (req, res) => {
  try {
    const fid = farmStore.farmIdFromReq(req);
    const formats = await farmStore.get(fid, 'tray_formats') || [];

    const payload = req.body || {};
    const trayFormatId = payload.trayFormatId || `fmt-${Date.now()}`;
    const format = {
      trayFormatId,
      name: payload.name || 'Custom Format',
      plantSiteCount: Number(payload.plantSiteCount || 0),
      systemType: payload.systemType || null,
      trayMaterial: payload.trayMaterial || null,
      description: payload.description || null,
      isWeightBased: Boolean(payload.isWeightBased),
      targetWeightPerSite: payload.targetWeightPerSite ?? null,
      weightUnit: payload.weightUnit || 'oz',
      isCustom: payload.isCustom !== false
    };

    formats.push(format);
    await farmStore.set(fid, 'tray_formats', formats);
    return res.status(201).json(format);
  } catch (error) {
    logger.warn('[Compat] /api/tray-formats POST failed:', error.message);
    return res.status(500).json({ error: 'Failed to create tray format' });
  }
});

app.put('/api/tray-formats/:formatId', authMiddleware, async (req, res) => {
  try {
    const { formatId } = req.params;
    const fid = farmStore.farmIdFromReq(req);
    const formats = await farmStore.get(fid, 'tray_formats') || [];

    const index = formats.findIndex((item) => String(item.trayFormatId) === String(formatId));
    if (index < 0) {
      return res.status(404).json({ error: 'Format not found' });
    }

    formats[index] = {
      ...formats[index],
      ...(req.body || {}),
      trayFormatId: formats[index].trayFormatId
    };

    await farmStore.set(fid, 'tray_formats', formats);
    return res.json(formats[index]);
  } catch (error) {
    logger.warn('[Compat] /api/tray-formats PUT failed:', error.message);
    return res.status(500).json({ error: 'Failed to update tray format' });
  }
});

app.delete('/api/tray-formats/:formatId', authMiddleware, async (req, res) => {
  try {
    const { formatId } = req.params;
    const fid = farmStore.farmIdFromReq(req);
    const formats = await farmStore.get(fid, 'tray_formats') || [];

    const nextFormats = formats.filter((item) => String(item.trayFormatId) !== String(formatId));
    await farmStore.set(fid, 'tray_formats', nextFormats);
    return res.json({ success: true });
  } catch (error) {
    logger.warn('[Compat] /api/tray-formats DELETE failed:', error.message);
    return res.status(500).json({ error: 'Failed to delete tray format' });
  }
});

app.get('/api/trays', authMiddleware, async (req, res) => {
  try {
    const fid = farmStore.farmIdFromReq(req);
    const trays = await farmStore.get(fid, 'trays') || [];
    return res.json(Array.isArray(trays) ? trays : []);
  } catch (error) {
    logger.warn('[Compat] /api/trays GET failed:', error.message);
    return res.json([]);
  }
});

app.post('/api/trays/register', authMiddleware, async (req, res) => {
  try {
    const fid = farmStore.farmIdFromReq(req);
    const trays = await farmStore.get(fid, 'trays') || [];
    const formats = await farmStore.get(fid, 'tray_formats') || [];

    const payload = req.body || {};
    const selectedFormat = formats.find((format) => String(format.trayFormatId) === String(payload.trayFormatId));

    const tray = {
      trayId: payload.trayId || `tray-${Date.now()}`,
      qrCode: payload.qrCodeValue || payload.qrCode || null,
      trayFormatId: payload.trayFormatId || null,
      formatName: selectedFormat?.name || 'Unknown',
      plantSiteCount: selectedFormat?.plantSiteCount || 0,
      forecastedYield: selectedFormat?.targetWeightPerSite || 0,
      status: 'available',
      currentLocation: payload.currentLocation || null,
      createdAt: new Date().toISOString()
    };

    trays.push(tray);
    await farmStore.set(fid, 'trays', trays);
    return res.status(201).json({ success: true, tray });
  } catch (error) {
    logger.warn('[Compat] /api/trays/register POST failed:', error.message);
    return res.status(500).json({ error: 'Failed to register tray' });
  }
});

app.get('/data/nutrient-dashboard', async (req, res) => {
  const fid = farmStore.farmIdFromReq(req);
  const payload = await farmStore.get(fid, 'nutrient_dashboard') || {};
  return res.json(payload);
});

app.get('/data/equipment-metadata', async (req, res) => {
  const payload = await farmStore.getGlobal('equipment-metadata.json') || {};
  return res.json(payload);
});

// Weather API — proxy to Light Engine (which calls Open-Meteo)
// Previously returned hardcoded stub data; now forwards to LE for real weather.
app.get('/api/weather', authMiddleware, async (req, res) => {
  let lat = Number(req.query.lat);
  let lng = Number(req.query.lng);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    const fid = farmStore.farmIdFromReq(req);

    try {
      const profile = await farmStore.get(fid, 'farm_profile');
      const profileCoords = profile?.coordinates
        || profile?.location?.coordinates
        || profile?.metadata?.location?.coordinates;
      if (Number.isFinite(Number(profileCoords?.lat)) && Number.isFinite(Number(profileCoords?.lng))) {
        lat = Number(profileCoords.lat);
        lng = Number(profileCoords.lng);
      }
    } catch (err) {
      logger.warn('[WeatherProxy] Failed to read farm profile coordinates:', err.message);
    }

    // Single-tenant fallback: use static farm profile only when it matches the farm context.
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      try {
        const staticProfile = farmStore.readFileSync('farm_profile', null);
        const staticFarmId = staticProfile?.farmId || staticProfile?.farm_id || null;
        const staticCoords = staticProfile?.coordinates
          || staticProfile?.location?.coordinates
          || staticProfile?.metadata?.location?.coordinates;

        if (
          Number.isFinite(Number(staticCoords?.lat))
          && Number.isFinite(Number(staticCoords?.lng))
          && (!fid || !staticFarmId || staticFarmId === fid)
        ) {
          lat = Number(staticCoords.lat);
          lng = Number(staticCoords.lng);
        }
      } catch (err) {
        logger.warn('[WeatherProxy] Failed to read static farm profile coordinates:', err.message);
      }
    }
  }

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ ok: false, error: 'lat and lng are required (or farm profile must include coordinates)' });
  }

  // Try proxying to Light Engine first (real Open-Meteo data)
  const leUrl = resolveEdgeUrlForProxy();
  if (leUrl) {
    try {
      const url = `${leUrl}/api/weather?lat=${lat}&lng=${lng}`;
      logger.info(`[WeatherProxy] Fetching from ${url}`);
      const upstream = await fetch(url, { headers: leProxyHeaders(), signal: AbortSignal.timeout(10000) });
      const text = await upstream.text();
      return res.status(upstream.status).type('json').send(text);
    } catch (err) {
      logger.warn('[WeatherProxy] Light Engine unreachable, falling back to direct Open-Meteo:', err.message);
    }
  }

  // Fallback: call Open-Meteo directly (same logic as Light Engine)
  try {
    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current_weather=true&hourly=temperature_2m,relative_humidity_2m,precipitation,weather_code&timezone=auto`;
    const response = await fetch(weatherUrl, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`Open-Meteo HTTP ${response.status}`);
    const data = await response.json();
    const weatherCodes = { 0: 'Clear', 1: 'Mainly Clear', 2: 'Partly Cloudy', 3: 'Overcast',
      45: 'Foggy', 48: 'Depositing Rime Fog', 51: 'Light Drizzle', 53: 'Moderate Drizzle',
      55: 'Dense Drizzle', 61: 'Slight Rain', 63: 'Moderate Rain', 65: 'Heavy Rain',
      71: 'Slight Snow', 73: 'Moderate Snow', 75: 'Heavy Snow', 77: 'Snow Grains',
      80: 'Slight Rain Showers', 81: 'Moderate Rain Showers', 82: 'Violent Rain Showers',
      85: 'Slight Snow Showers', 86: 'Heavy Snow Showers', 95: 'Thunderstorm',
      96: 'Thunderstorm with Slight Hail', 99: 'Thunderstorm with Heavy Hail' };
    return res.json({
      ok: true,
      current: {
        temperature_c: data.current_weather.temperature,
        temperature_f: (data.current_weather.temperature * 9 / 5) + 32,
        humidity: Array.isArray(data.hourly?.relative_humidity_2m) ? data.hourly.relative_humidity_2m[0] : null,
        wind_speed: data.current_weather.windspeed,
        wind_direction: data.current_weather.winddirection,
        weather_code: data.current_weather.weathercode,
        is_day: data.current_weather.is_day,
        description: weatherCodes[data.current_weather.weathercode] || 'Unknown',
        last_updated: data.current_weather.time
      },
      location: { lat, lng }
    });
  } catch (err) {
    logger.error('[WeatherProxy] Direct Open-Meteo also failed:', err.message);
    return res.status(502).json({ ok: false, error: 'Weather service unavailable' });
  }
});

app.get('/configuration', authMiddleware, async (req, res) => {
  try {
    const fid = farmStore.farmIdFromReq(req);
    const config = await farmStore.get(fid, 'config');
    return res.json(config || {
      network: { httpPort: '8080', wsPort: '8081' },
      integrations: {},
      notifications: {}
    });
  } catch (error) {
    logger.warn('[Compat] /configuration read failed:', error.message);
    return res.json({ network: {}, integrations: {}, notifications: {} });
  }
});

app.get('/api/farm/configuration', authMiddleware, async (req, res) => {
  try {
    const fid = farmStore.farmIdFromReq(req);
    const config = await farmStore.get(fid, 'config');
    return res.json(config || {
      network: { httpPort: '8080', wsPort: '8081' },
      integrations: {},
      notifications: {}
    });
  } catch (error) {
    logger.warn('[Compat] /api/farm/configuration read failed:', error.message);
    return res.json({ network: {}, integrations: {}, notifications: {} });
  }
});

app.post('/api/farm/configuration', authMiddleware, async (req, res) => {
  try {
    const fid = farmStore.farmIdFromReq(req);
    await farmStore.set(fid, 'config', req.body || {});
    return res.json({ success: true });
  } catch (error) {
    logger.warn('[Compat] /api/farm/configuration write failed:', error.message);
    return res.status(500).json({ success: false, error: 'Failed to save configuration' });
  }
});

app.get('/devices', authMiddleware, async (req, res) => {
  try {
    const fid = farmStore.farmIdFromReq(req);
    const devices = await farmStore.get(fid, 'devices') || [];
    return res.json({ devices: Array.isArray(devices) ? devices : [] });
  } catch (error) {
    logger.warn('[Compat] /devices fallback failed:', error.message);
    return res.json({ devices: [] });
  }
});

app.post('/devices', authMiddleware, async (req, res) => {
  try {
    const fid = farmStore.farmIdFromReq(req);
    const devices = await farmStore.get(fid, 'devices') || [];

    const payload = req.body || {};
    const nextDevice = {
      ...payload,
      id: payload.id || payload.deviceId || payload.device_id || `device-${Date.now()}`
    };
    devices.push(nextDevice);
    await farmStore.set(fid, 'devices', devices);
    return res.status(201).json({ success: true, device: nextDevice });
  } catch (error) {
    logger.warn('[Compat] POST /devices failed:', error.message);
    return res.status(500).json({ success: false, error: 'Failed to save device' });
  }
});

app.patch('/devices/:deviceId', authMiddleware, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const fid = farmStore.farmIdFromReq(req);
    const devices = await farmStore.get(fid, 'devices') || [];

    const index = devices.findIndex((item) => String(item.id || item.deviceId || item.device_id) === String(deviceId));
    if (index < 0) {
      return res.status(404).json({ error: 'Device not found' });
    }

    devices[index] = { ...devices[index], ...(req.body || {}) };
    await farmStore.set(fid, 'devices', devices);
    return res.json({ success: true, device: devices[index] });
  } catch (error) {
    logger.warn('[Compat] PATCH /devices/:deviceId failed:', error.message);
    return res.status(500).json({ error: 'Failed to update device' });
  }
});

// Groups endpoint — returns full canonical records so all pages see identical data
// Keeps: lights[], room, zone, status, schedule, plan, planConfig
// Drops deprecated: crop, recipe, roomId, zoneId (per DATA_FORMAT_STANDARDS)
app.get('/api/groups', authMiddleware, async (req, res) => {
  try {
    const fid = farmStore.farmIdFromReq(req);
    const groups = await farmStore.get(fid, 'groups') || [];

    const canonical = groups.map(g => {
      const record = {
        id: g.id || g.name,
        name: g.name,
        room: g.room || '',
        zone: g.zone || '',
        plan: g.plan || '',
        schedule: g.schedule || '',
        status: g.status || 'draft',
        trays: Number(g.trays || 0),
        plants: Number(g.plants || 0),
        lights: Array.isArray(g.lights) ? g.lights : [],
        active: g.active !== false,
        health: g.health || 'unknown',
        planConfig: g.planConfig || null,
        lastModified: g.lastModified || null
      };
      if (g.controller) record.controller = g.controller;
      if (g.iotDevice) record.iotDevice = g.iotDevice;
      return record;
    });

    return res.json(canonical);
  } catch (error) {
    logger.warn('[Compat] /api/groups fallback failed:', error.message);
    return res.json([]);
  }
});

app.get('/api/rooms', authMiddleware, async (req, res) => {
  try {
    const fid = farmStore.farmIdFromReq(req);
    const rooms = await farmStore.get(fid, 'rooms') || [];

    // Also try legacy DB table if empty
    if (rooms.length === 0 && req.db) {
      try {
        const result = await req.db.query(
          `SELECT room_id, farm_id, name, type, capacity, description, created_at
           FROM rooms
           ORDER BY created_at ASC`
        );
        if (result.rows.length > 0) return res.json(result.rows);
      } catch (dbError) {
        logger.debug('[Compat] /api/rooms DB query failed', { error: dbError.message });
      }
    }

    return res.json(Array.isArray(rooms) ? rooms : []);
  } catch (error) {
    logger.warn('[Compat] /api/rooms fallback failed:', error.message);
    return res.json([]);
  }
});

// Farm auth login (same interface as Light Engine): /api/farm/auth/login
// Translates Light Engine format { farmId } → central format { farm_id }
// and response { success } → { status: 'success' }
app.post('/api/farm/auth/login', (req, res, next) => {
  const { farmId, email, password } = req.body;
  // Sanitize farm ID: strip trailing commas, semicolons, periods, and whitespace
  const cleanFarmId = typeof farmId === 'string' ? farmId.replace(/[,;.\s]+$/, '').trim() : farmId;
  // Rewrite to central field names
  req.body = { farm_id: cleanFarmId, email, password };
  // Rewrite URL so the auth router matches /login
  req.url = '/login';
  // Wrap res.json to translate response format
  const origJson = res.json.bind(res);
  res.json = function(data) {
    if (data && data.success && data.token) {
      return origJson({
        status: 'success',
        token: data.token,
        farmId: data.farm_id,
        farmName: data.farm_name || data.name || data.farm_id,
        email: data.email,
        role: data.role,
        planType: data.planType || 'cloud',
        mustChangePassword: data.must_change_password || false,
        setupCompleted: data.setup_completed || false
      });
    }
    return origJson({
      status: 'error',
      message: data.message || data.error || 'Authentication failed'
    });
  };
  // Forward to auth router
  authRoutes(req, res, next);
});

// API routes
app.use('/api/auth', authRoutes); // Farm authentication
app.use('/api/admin/auth', adminAuthRoutes); // Central admin authentication
// Farm Square payment setup routes (proxied to LE)
app.get('/api/farm/square/status', (req, res) => edgeProxy(req, res, '/api/farm/square/status'));
app.post('/api/farm/square/authorize', express.json(), (req, res) => edgeProxy(req, res, '/api/farm/square/authorize', 'POST', req.body));
app.get('/api/farm/square/callback', async (req, res) => {
  // Custom proxy for callback -- returns HTML, not JSON
  const edgeUrl = resolveEdgeUrlForProxy();
  if (!edgeUrl) return res.status(503).send('Light Engine not available');
  const qs = new URLSearchParams(req.query).toString();
  try {
    const cbHeaders = leProxyHeaders();
    if (req.headers['x-farm-id']) cbHeaders['X-Farm-ID'] = req.headers['x-farm-id'];
    logger.info('[SquareCallbackProxy] Proxying to LE: ' + edgeUrl + '/api/farm/square/callback');
    const response = await fetch(edgeUrl + '/api/farm/square/callback?' + qs, {
      headers: cbHeaders,
      signal: AbortSignal.timeout(15000)
    });
    const text = await response.text();
    const ct = response.headers.get('content-type') || 'text/html';
    logger.info('[SquareCallbackProxy] LE responded: ' + response.status + ' (' + ct + ')');
    res.status(response.status).type(ct).send(text);
  } catch (err) {
    logger.error('[SquareCallbackProxy] error:', err.message);
    res.status(502).send('Square callback proxy failed');
  }
});
app.post('/api/farm/square/refresh', express.json(), (req, res) => edgeProxy(req, res, '/api/farm/square/refresh', 'POST', req.body));
app.post('/api/farm/square/settings', express.json(), (req, res) => edgeProxy(req, res, '/api/farm/square/settings', 'POST', req.body));
app.post('/api/farm/square/disconnect', express.json(), (req, res) => edgeProxy(req, res, '/api/farm/square/disconnect', 'POST', req.body));
app.post('/api/farm/square/test-payment', express.json(), (req, res) => edgeProxy(req, res, '/api/farm/square/test-payment', 'POST', req.body));

app.use('/api', customProductsRouter);                       // /api/farm/products/* -- Custom product CRUD (MUST precede /api/farm auth)
app.use('/api/farms', authOrAdminMiddleware, farmRoutes);
app.use('/api/farm', authOrAdminMiddleware, farmRoutes); // Singular route for profile endpoint
app.use('/api/setup-wizard', authMiddleware, setupWizardRoutes); // First-time farm setup wizard
app.use('/api/setup', authMiddleware, setupWizardRoutes); // Legacy setup API alias used by dashboard/app.foxtrot

// Device scanner endpoint — cloud stub returns empty, edge would scan network
app.get('/api/devices/scan', authMiddleware, (req, res) => {
  if (process.env.DEPLOYMENT_MODE === 'cloud') {
    return res.json({ devices: [], message: 'Device scanning requires Light Engine Edge hardware.' });
  }
  // Edge mode: placeholder for network scan (mDNS / ARP discovery)
  // In production edge deployment, this would use mdns/bonjour to discover controllers
  res.json({ devices: [], message: 'No devices discovered. Ensure controllers are powered on and connected to the same network.' });
});

app.use('/api/monitoring', authMiddleware, monitoringRoutes);

// Path alias: frontend calls /api/inventory/tray-formats but handler is at /api/tray-formats
app.get('/api/inventory/tray-formats', (req, res) => { res.redirect(307, '/api/tray-formats'); });

app.use('/api/inventory', authOrAdminMiddleware, inventoryMgmtRoutes);  // seeds, nutrients, packaging, equipment, supplies
app.use('/api/inventory', authOrAdminMiddleware, inventoryRoutes);     // crop inventory (current, forecast, sync)
app.use('/api/lots', authOrAdminMiddleware, lotSystemRoutes);

// Research Platform API -- auth + tier-based feature gate (resolves audit C1)
// Guard only /api/research/* traffic here; avoid intercepting unrelated /api routes
// such as /api/admin/auth/login before their dedicated routers run.
const researchFeatureGate = requireResearchTier();
const researchAuthGuard = (req, res, next) => {
  if (req.path.startsWith('/research/')) {
    return authMiddleware(req, res, (authErr) => {
      if (authErr) return next(authErr);
      return researchFeatureGate(req, res, next);
    });
  }
  return next();
};

app.use('/api', researchAuthGuard, researchStudiesRouter);
app.use('/api', researchAuthGuard, researchDataRouter);
app.use('/api', researchAuthGuard, researchExportsRouter);
app.use('/api', researchAuthGuard, researchComplianceRouter);
app.use('/api', researchAuthGuard, researchElnRouter);
app.use('/api', researchAuthGuard, researchCollaborationRouter);
app.use('/api', researchAuthGuard, researchRecipesRouter);
app.use('/api', researchAuthGuard, researchAuditRouter);
app.use('/api', researchAuthGuard, researchWorkspaceOpsRouter);
app.use('/api', researchAuthGuard, researchGrantsRouter);
app.use('/api', researchAuthGuard, researchEthicsRouter);
app.use('/api', researchAuthGuard, researchHqpRouter);
app.use('/api', researchAuthGuard, researchPartnersRouter);
app.use('/api', researchAuthGuard, researchSecurityRouter);
app.use('/api', researchAuthGuard, researchReportingRouter);
app.use('/api', researchAuthGuard, researchDeadlinesRouter);
app.use('/api', researchAuthGuard, researchPublicationsRouter);
app.use('/api', researchAuthGuard, researchEquipmentRouter);
app.use('/api', researchAuthGuard, researchLineageRouter);
app.use('/api', researchAuthGuard, researchIntegrationsRouter); // Research integrations: ORCID, DataCite, OSF, protocols.io, instruments, workflows, Globus, governance, CFD
app.use('/api/research/gwen', researchAuthGuard, gwenResearchRouter); // G.W.E.N. research intelligence agent
app.use('/api/orders', authMiddleware, ordersRoutes);
app.use('/api/alerts', authMiddleware, alertsRoutes);
app.use('/api/sync', syncRoutes); // Farms authenticate via API key
app.use('/api/farm-settings', farmSettingsRoutes); // Settings sync between Central and Light Engine (API key auth)
app.use('/api/recipes', recipesRoutes); // Read-only public recipes API
app.use('/api/wholesale', wholesaleRoutes); // Core wholesale: catalog, orders, payments, network farms
app.use('/api/square-proxy', squareOAuthProxyRoutes); // Square OAuth proxy to farms
// Stripe setup proxied to farm server (root-level routes can't resolve express from central node_modules)
app.use('/api/admin', adminRoutes); // Admin dashboard API (sub-mounts /wholesale, /recipes, /pricing, /delivery, /ai)
app.use('/api/delivery/driver-applications', driverApplicationsRoutes); // Public driver enrollment
app.use('/api/campaign', campaignRoutes); // Field of Dreams campaign (public)
app.use('/api/admin/network-devices', adminAuthMiddleware, networkDevicesRoutes); // I-3.11: Network device analytics
app.use('/api/admin/assistant', adminAuthMiddleware, requireAdminRole('admin', 'editor'), adminAssistantRouter); // F.A.Y.E. admin AI assistant
app.use('/api/admin/ops', adminAuthMiddleware, requireAdminRole('admin'), adminOpsAgentRouter); // F.A.Y.E. tool catalog & gateway
app.use('/api/admin/scott', adminAuthMiddleware, requireAdminRole('admin', 'editor'), scottMarketingRouter); // S.C.O.T.T. marketing agent
app.use('/api/admin/marketing', adminAuthMiddleware, requireAdminRole('admin', 'editor'), adminMarketingRouter); // Marketing dashboard endpoints (queue, publish, settings)
app.use('/api/reports', authOrAdminMiddleware, reportsRoutes); // Financial exports and reports
app.use('/api/ai-insights', authOrAdminMiddleware, aiInsightsRoutes); // GPT-4 powered AI insights
app.use('/api/tts', ttsRoutes); // OpenAI TTS voice synthesis (rate-limited per IP, no auth needed)
app.use('/api/env', authMiddleware, envProxyRoutes); // Environmental data proxy to farm devices
app.use('/discovery/devices', authMiddleware, discoveryProxyRoutes); // Device discovery proxy to farm devices
app.use('/api/discovery/devices', authMiddleware, discoveryProxyRoutes); // API alias for discovery proxy

// ── Light Engine Proxy — forwards IoT/device API calls to the Light Engine ──
function resolveEdgeUrlForProxy() {
  if (process.env.FARM_EDGE_URL) return process.env.FARM_EDGE_URL.replace(/\/$/, '');
  try {
    const farmJsonPath = path.join(FARM_DATA_DIR, 'farm.json');
    const farm = JSON.parse(fs.readFileSync(farmJsonPath, 'utf8'));
    if (farm.url) return farm.url.replace(/\/$/, '');
  } catch (_) { /* ignore */ }
  return 'http://127.0.0.1:8091'; // Fallback: local development (both on same machine)
}

async function edgeProxy(req, res, edgePath, method = 'GET', body = null, timeoutMs = 15000) {
  const edgeUrl = resolveEdgeUrlForProxy();
  if (!edgeUrl) {
    return res.status(503).json({
      error: 'No Light Engine URL configured',
      message: 'Set FARM_EDGE_URL or configure farm.json url field',
      timestamp: new Date().toISOString()
    });
  }
  const url = `${edgeUrl}${edgePath}`;
  // Forward browser's X-Farm-ID so farm-scoped routes resolve correctly
  const proxyExtra = { 'Content-Type': 'application/json' };
  if (req.headers && req.headers['x-farm-id']) proxyExtra['X-Farm-ID'] = req.headers['x-farm-id'];
  const opts = {
    method,
    headers: leProxyHeaders(proxyExtra),
    signal: AbortSignal.timeout(timeoutMs)
  };
  if (body && method !== 'GET') opts.body = JSON.stringify(body);
  try {
    logger.info(`[LightEngineProxy] ${method} ${url}`);
    const response = await fetch(url, opts);
    const text = await response.text();
    res.status(response.status).type('json').send(text);
  } catch (err) {
    if (err?.name === 'AbortError' || err?.name === 'TimeoutError') {
      return res.status(504).json({ error: 'Gateway timeout', message: 'Light Engine did not respond', timestamp: new Date().toISOString() });
    }
    logger.error(`[LightEngineProxy] ${method} ${edgePath} error:`, err.message);
    return res.status(502).json({ error: 'Light Engine proxy failure', message: err.message, timestamp: new Date().toISOString() });
  }
}

// Discovery endpoints
app.get('/discovery/capabilities', authMiddleware, (req, res) => edgeProxy(req, res, '/discovery/capabilities'));

// ─── Cloud-native Discovery Scanner (SwitchBot) ────────────────────────
// Tries the Light Engine first; if unreachable, queries SwitchBot API
// directly using stored credentials from the database or farm.json.
async function cloudNativeScan(req, res) {
  const devices = [];
  let edgeReachable = false;

  // 1. Try Light Engine first (fast 8s timeout)
  const edgeUrl = resolveEdgeUrlForProxy();
  if (edgeUrl) {
    try {
      logger.info(`[CloudScan] Trying Light Engine at ${edgeUrl}/discovery/scan`);
      const edgeResp = await fetch(`${edgeUrl}/discovery/scan`, {
        method: 'POST',
        headers: leProxyHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(req.body || {}),
        signal: AbortSignal.timeout(8000)
      });
      if (edgeResp.ok) {
        const edgeData = await edgeResp.json();
        const edgeDevices = Array.isArray(edgeData.devices) ? edgeData.devices : [];
        devices.push(...edgeDevices);
        edgeReachable = true;
        logger.info(`[CloudScan] Light Engine returned ${edgeDevices.length} device(s)`);
      }
    } catch (edgeErr) {
      logger.warn(`[CloudScan] Light Engine unreachable: ${edgeErr.message}`);
    }
  }

  // 2. Cloud-native SwitchBot scan using stored credentials
  try {
    // Check farmStore (database) first — persists across deploys
    let sb = null;
    try {
      // Use the request's farmId (via env var or JWT), not a hardcoded 'default'
      const fid = farmStore.farmIdFromReq(req) || process.env.FARM_ID || 'default';
      const dbCreds = await farmStore.get(fid, 'switchbot_credentials');
      if (dbCreds?.token && dbCreds?.secret) {
        sb = dbCreds;
        logger.info(`[CloudScan] Found SwitchBot credentials in farmStore (DB) for ${fid}`);
      }
    } catch (_) {}

    // Fall back to farm.json filesystem
    if (!sb) {
      const farmJsonPath = path.join(FARM_DATA_DIR, 'farm.json');
      let farm = {};
      try { farm = JSON.parse(fs.readFileSync(farmJsonPath, 'utf8')); } catch (_) {}
      sb = farm?.integrations?.switchbot;
      if (sb?.token) logger.info('[CloudScan] Found SwitchBot credentials in farm.json');
    }
    if (sb?.token && sb?.secret) {
      const hasSwitchBotFromLightEngine = devices.some(d =>
        (d.protocol || '').toLowerCase() === 'switchbot' ||
        (d.brand || '').toLowerCase() === 'switchbot'
      );
      if (!hasSwitchBotFromLightEngine) {
        logger.info('[CloudScan] Querying SwitchBot API with stored credentials');
        const t = Date.now().toString();
        const nonce = randomUUID ? randomUUID().replace(/-/g, '') : randomBytes(16).toString('hex');
        const strToSign = sb.token + t + nonce;
        const sign = createHmac('sha256', sb.secret).update(strToSign, 'utf8').digest('base64');

        const sbResp = await fetch(`${SWITCHBOT_API_BASE}/devices`, {
          method: 'GET',
          headers: {
            'Authorization': sb.token,
            't': t,
            'sign': sign,
            'nonce': nonce,
            'Content-Type': 'application/json'
          },
          signal: AbortSignal.timeout(10000)
        });
        const sbBody = await sbResp.json().catch(() => ({}));
        if (sbResp.ok && sbBody.statusCode === 100) {
          const deviceList = sbBody.body?.deviceList || [];
          const infraredList = sbBody.body?.infraredRemoteList || [];
          const sbDevices = [...deviceList, ...infraredList].map(d => ({
            name: d.deviceName || d.remoteType || `SwitchBot ${d.deviceType}`,
            deviceName: d.deviceName || d.remoteType || `SwitchBot ${d.deviceType}`,
            deviceId: d.deviceId,
            deviceType: d.deviceType || d.remoteType || 'Unknown',
            hubDeviceId: d.hubDeviceId || '',
            protocol: 'switchbot',
            brand: 'SwitchBot',
            source: 'cloud-api'
          }));
          devices.push(...sbDevices);
          logger.info(`[CloudScan] SwitchBot API returned ${sbDevices.length} device(s)`);
        } else {
          logger.warn(`[CloudScan] SwitchBot API error: ${sbBody.message || sbResp.status}`);
        }
      }
    } else {
      logger.info('[CloudScan] No SwitchBot credentials stored - skipping cloud SwitchBot scan');
    }
  } catch (sbErr) {
    logger.warn(`[CloudScan] SwitchBot cloud scan error: ${sbErr.message}`);
  }

  res.json({
    ok: true,
    devices,
    count: devices.length,
    source: edgeReachable ? 'light-engine+cloud' : 'cloud',
    timestamp: new Date().toISOString()
  });
}
app.post('/discovery/scan', authMiddleware, express.json(), cloudNativeScan);
app.get('/discovery/scan', authMiddleware, cloudNativeScan);


// ─── Cloud-native SwitchBot Device Status ────────────────────────────────
// Tries Light Engine first; falls back to SwitchBot API v1.1 /devices/{id}/status
// using stored credentials from farmStore (DB) or farm.json.
async function cloudSwitchBotStatus(req, res) {
  const deviceId = req.params.id;
  if (!deviceId) return res.status(400).json({ error: 'Device ID required' });

  // 1. Try Light Engine (fast 5s timeout)
  const edgeUrl = resolveEdgeUrlForProxy();
  if (edgeUrl) {
    try {
      const qs = new URLSearchParams(req.query).toString();
      const edgeResp = await fetch(
        `${edgeUrl}/api/switchbot/devices/${encodeURIComponent(deviceId)}/status${qs ? '?' + qs : ''}`,
        { signal: AbortSignal.timeout(5000) }
      );
      if (edgeResp.ok) {
        const edgeData = await edgeResp.json();
        if (edgeData?.statusCode === 100 && edgeData?.body) {
          logger.info(`[SwitchBotStatus] Light Engine returned status for ${deviceId}`);
          return res.json(edgeData);
        }
      }
    } catch (edgeErr) {
      logger.warn(`[SwitchBotStatus] Light Engine unreachable for ${deviceId}: ${edgeErr.message}`);
    }
  }

  // 2. Cloud-native: call SwitchBot API directly
  try {
    let sb = null;
    try {
      const fid = farmStore.farmIdFromReq(req) || process.env.FARM_ID || 'default';
      const dbCreds = await farmStore.get(fid, 'switchbot_credentials');
      if (dbCreds?.token && dbCreds?.secret) sb = dbCreds;
    } catch (_) {}
    if (!sb) {
      const farmJsonPath = path.join(FARM_DATA_DIR, 'farm.json');
      try {
        const farm = JSON.parse(fs.readFileSync(farmJsonPath, 'utf8'));
        sb = farm?.integrations?.switchbot;
      } catch (_) {}
    }
    if (!sb?.token || !sb?.secret) {
      return res.status(503).json({
        statusCode: 190,
        message: 'No SwitchBot credentials configured',
        body: {}
      });
    }

    const t = Date.now().toString();
    const nonce = randomUUID ? randomUUID().replace(/-/g, '') : randomBytes(16).toString('hex');
    const strToSign = sb.token + t + nonce;
    const sign = createHmac('sha256', sb.secret).update(strToSign, 'utf8').digest('base64');
    const headers = {
      'Authorization': sb.token,
      't': t,
      'sign': sign,
      'nonce': nonce,
      'Content-Type': 'application/json'
    };

    const sbResp = await fetch(`${SWITCHBOT_API_BASE}/devices/${encodeURIComponent(deviceId)}/status`, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(10000)
    });
    const sbData = await sbResp.json().catch(() => ({}));
    logger.info(`[SwitchBotStatus] Cloud API response for ${deviceId}: statusCode=${sbData.statusCode}`);
    return res.json(sbData);
  } catch (err) {
    logger.error(`[SwitchBotStatus] Cloud API error for ${deviceId}: ${err.message}`);
    return res.status(502).json({
      statusCode: 190,
      message: `SwitchBot API error: ${err.message}`,
      body: {}
    });
  }
}
// SwitchBot endpoints
// NOTE: POST /api/switchbot/discover is handled by switchBotDiscover() (registered earlier)
// which saves credentials to the DB AND forwards them to the Light Engine.
// No edge proxy needed here — the switchBotDiscover handler is the single entry point.
app.get('/switchbot/devices', authMiddleware, (req, res) => edgeProxy(req, res, '/switchbot/devices'));
app.get('/api/switchbot/devices/:id/status', authMiddleware, cloudSwitchBotStatus);
app.post('/api/switchbot/devices/:id/commands', authMiddleware, express.json(), (req, res) => edgeProxy(req, res, `/api/switchbot/devices/${req.params.id}/commands`, 'POST', req.body));

// Kasa endpoints
app.post('/api/kasa/discover', authMiddleware, express.json(), (req, res) => edgeProxy(req, res, '/api/kasa/discover', 'POST', req.body));
app.post('/api/kasa/configure', authMiddleware, express.json(), (req, res) => edgeProxy(req, res, '/api/kasa/configure', 'POST', req.body));
app.post('/api/kasa/device/:host/power', authMiddleware, express.json(), (req, res) => edgeProxy(req, res, `/api/kasa/device/${req.params.host}/power`, 'POST', req.body));

// Bus/DMX endpoints
app.get('/api/bus-mappings', authMiddleware, (req, res) => edgeProxy(req, res, '/api/bus-mappings'));
app.post('/api/bus-mapping', authMiddleware, express.json(), (req, res) => edgeProxy(req, res, '/api/bus-mapping', 'POST', req.body));
app.get('/api/bus/:busId/scan', authMiddleware, (req, res) => edgeProxy(req, res, `/api/bus/${req.params.busId}/scan`));


app.use('/api/ml/insights', authMiddleware, mlForecastRoutes); // ML temperature forecast (Light Engine feature)
app.use('/api/billing', authOrAdminMiddleware, billingRoutes); // Billing usage (cloud)
app.use('/api/stripe', authOrAdminMiddleware, stripePaymentsRouter); // Stripe payment operations
app.use('/api/webhooks', paymentWebhooksRouter); // Square + Stripe webhook receivers (no auth — signature-verified)
app.use('/api/accounting', authOrAdminMiddleware, accountingRoutes); // Canonical accounting ledger + close controls (accepts farm OR admin auth)
app.use('/api/procurement', authOrAdminMiddleware, procurementAdminRoutes); // GRC catalog & suppliers (accepts farm OR admin auth)
app.use('/api/remote', authOrAdminMiddleware, remoteSupportRoutes); // Remote support / diagnostics proxy to farms
app.use('/api/planting', authMiddleware, plantingRoutes); // Planting scheduler recommendations with market intelligence
app.use('/api/planning', authMiddleware, planningRoutes); // Production planning (integrates market + crop pricing)
app.use('/api/market-intelligence', authOrAdminMiddleware, marketIntelligenceRoutes); // North American market data + price alerts
app.use('/api/crop-pricing', authMiddleware, cropPricingRoutes); // Farm-specific crop pricing
app.use('/api/admin/pricing', adminAuthMiddleware, adminPricingRoutes); // Wholesale pricing management
app.use('/api/quality', authMiddleware, qualityReportsRoutes);                 // Quality reports + QA checkpoint proxies
app.use('/api/sustainability', authMiddleware, sustainabilityRoutes);          // Sustainability & ESG dashboard

// ─── Crop Weight Analytics (cross-farm aggregation) ────────────────────
import { listNetworkFarms as listWeightNetworkFarms } from './services/networkFarmsStore.js';

app.get('/api/crop-weights/network-analytics', authMiddleware, async (req, res) => {
  try {
    const allFarms = await listWeightNetworkFarms();
    const farms = allFarms.filter(f => f.status === 'active' && f.api_url);
    const allRecords = [];
    
    await Promise.allSettled(farms.map(async (farm) => {
      try {
        const url = `${farm.api_url}/api/crop-weights/records?days=${req.query.days || 90}&limit=500`;
        const farmRes = await fetch(url, { signal: AbortSignal.timeout(5000) });
        if (farmRes.ok) {
          const data = await farmRes.json();
          (data.records || []).forEach(r => {
            r.farm_id = r.farm_id || farm.farm_id;
            r.farm_name = farm.name;
            allRecords.push(r);
          });
        }
      } catch (_) {}
    }));

    // Group by requested dimension
    const groupBy = req.query.group_by || 'crop';
    const groups = {};
    for (const r of allRecords) {
      let key;
      switch (groupBy) {
        case 'farm': key = r.farm_name || r.farm_id || 'unknown'; break;
        case 'system_type': key = r.system_type || 'unknown'; break;
        case 'tray_format': key = r.tray_format_name || 'unknown'; break;
        case 'crop': default: key = r.crop_name || r.recipe_id || 'unknown';
      }
      if (!groups[key]) groups[key] = { key, records: [], sample_count: 0 };
      groups[key].records.push(r);
      groups[key].sample_count++;
    }

    const result = Object.values(groups).map(g => {
      const totalPP = g.records.reduce((s, r) => s + (r.weight_per_plant_oz || 0), 0);
      const totalPT = g.records.reduce((s, r) => s + (r.total_weight_oz || 0), 0);
      return {
        key: g.key,
        sample_count: g.sample_count,
        avg_weight_per_plant_oz: +(totalPP / g.sample_count).toFixed(3),
        avg_weight_per_tray_oz: +(totalPT / g.sample_count).toFixed(2),
        farms: [...new Set(g.records.map(r => r.farm_name || r.farm_id))],
        min_per_plant_oz: +Math.min(...g.records.map(r => r.weight_per_plant_oz || 0)).toFixed(3),
        max_per_plant_oz: +Math.max(...g.records.map(r => r.weight_per_plant_oz || 0)).toFixed(3),
      };
    });

    result.sort((a, b) => b.sample_count - a.sample_count);

    res.json({
      group_by: groupBy,
      groups: result,
      total_records: allRecords.length,
      farms_queried: farms.length,
      generated_at: new Date().toISOString()
    });
  } catch (error) {
    console.error('[crop-weights] Network analytics error:', error);
    res.status(500).json({ error: 'Failed to aggregate crop weight data' });
  }
});

// Proxy single-farm crop weight endpoints through Central
app.use('/api/crop-weights', async (req, res, next) => {
  // If farm_id specified, proxy to that farm
  const farmId = req.query.farm_id || req.headers['x-farm-id'];
  if (farmId) {
    const allFarms = await listWeightNetworkFarms();
    const farm = allFarms.find(f => f.farm_id === farmId);
    if (farm?.api_url) {
      const targetUrl = `${farm.api_url}/api/crop-weights${req.path}?${new URLSearchParams(req.query).toString()}`;
      return fetch(targetUrl, {
        method: req.method,
        headers: { 'Content-Type': 'application/json' },
        body: ['POST', 'PUT'].includes(req.method) ? JSON.stringify(req.body) : undefined,
      }).then(async r => {
        const data = await r.json();
        res.status(r.status).json(data);
      }).catch(err => {
        res.status(502).json({ error: 'Farm unreachable', details: err.message });
      });
    }
  }
  // No farm_id — return empty (Central doesn't have its own weight data)
  if (req.path === '/records') return res.json({ total: 0, records: [] });
  if (req.path === '/benchmarks') return res.json({ benchmarks: [] });
  if (req.path === '/analytics') return res.json({ group_by: req.query.group_by || 'crop', groups: [], total_records: 0 });
  next();
});

// Phase 2 — Cloud SaaS API gap routes
app.use('/api/users', authMiddleware, farmUsersRouter);     // Farm-scoped user CRUD
app.use('/api/user', authMiddleware, userRouter);            // /api/user/change-password
app.use('/api/auth', deviceTokenRouter);                     // /api/auth/generate-device-token
app.use('/api', farmSalesRouter);                            // /api/config/app, /api/farm-sales/*, /api/farm-auth/*, /api/demo/*
app.use('/api', authMiddleware, networkGrowersRouter);                       // /api/network/*, /api/growers/*, /api/contracts/*, /api/farms/list
app.use('/api', authMiddleware, experimentRecordsRouter);                    // /api/sync/experiment-records, /api/experiment-records, /api/crop-benchmarks
app.use('/api/wholesale', authMiddleware, wholesaleFulfillmentRouter);       // /api/wholesale/order-statuses, tracking, events
app.use('/api/wholesale/exports', authOrAdminMiddleware, wholesaleExportsRouter);   // /api/wholesale/exports/orders, payments, tax-summary
app.use('/api/producer', producerPortalRouter);                           // Producer portal: registration, login, products, orders

// Phase 2 Task 2.8: Demand analysis endpoint
app.get('/api/wholesale/demand-analysis', authMiddleware, async (req, res) => {
  try {
    const { analyzeDemandPatterns } = await import('./services/wholesaleMemoryStore.js');
    const patterns = await analyzeDemandPatterns();
    const sorted = Object.entries(patterns)
      .sort(([, a], [, b]) => b.network_total_qty - a.network_total_qty);
    res.json({
      ok: true,
      crop_count: sorted.length,
      generated_at: new Date().toISOString(),
      demand_signals: Object.fromEntries(sorted)
    });
  } catch (error) {
    console.error('[demand-analysis] Error:', error.message);
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.use('/', purchaseRouter);                                // Purchase/checkout pipeline (Square)
app.use('/', miscStubsRouter);                               // Misc stubs + path aliases (full /api/* paths)
app.use('/api/farm-ops', authMiddleware, farmOpsAgentRouter);                 // Farm operations agent (daily to-do, tool gateway, command taxonomy)
app.use('/api/assistant', authMiddleware, assistantChatRouter);                // AI assistant chat (GPT-4o-mini + function calling)

// ── Phase 4 Ticket 4.2: Harvest schedule conflict detection ────────────
app.get('/api/network/harvest-conflicts', authMiddleware, async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 14;
    const conflicts = await detectHarvestConflicts(days);
    res.json({ ok: true, look_ahead_days: days, conflicts, count: conflicts.length });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ── Phase 4 Ticket 4.3: Supply/demand balance analysis ────────────────
app.get('/api/network/supply-demand', authMiddleware, async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const analysis = await analyzeSupplyDemand(days);
    res.json({ ok: true, ...analysis });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get('/api/network/risk-alerts', authMiddleware, async (req, res) => {
  try {
    const alerts = await generateNetworkRiskAlerts();
    res.json({ ok: true, alerts, count: alerts.length });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});


// ── Sprint 4 Central additions: S4.1 + S4.2 receive + S4.8 ──────────────

// S4.2: Receive farm-reported harvest projections
app.post('/api/network/harvest-projections', authMiddleware, async (req, res) => {
  try {
    const { farm_id, projections, reported_at } = req.body;
    if (!farm_id || !projections) {
      return res.status(400).json({ ok: false, error: 'farm_id and projections required' });
    }

    // Store in DB
    const db = getDatabase();
    if (db) {
      await query(`
        INSERT INTO farm_data (farm_id, data_type, data, timestamp)
        VALUES ($1, 'harvest_projections', $2, NOW())
        ON CONFLICT (farm_id, data_type)
        DO UPDATE SET data = $2, timestamp = NOW()
      `, [farm_id, JSON.stringify({ projections, reported_at })]);
    }

    console.log(`[harvest-projections] Received ${projections.length} projections from ${farm_id}`);
    res.json({ ok: true, received: projections.length });
  } catch (error) {
    console.error('[harvest-projections] Error:', error.message);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// S4.1: Generate planting suggestions for farms based on supply/demand analysis
app.get('/api/network/planting-suggestions', authMiddleware, async (req, res) => {
  try {
    const farmId = req.query.farm_id || null;

    // Get supply/demand analysis
    const analysis = await analyzeSupplyDemand(30);

    // Generate per-farm suggestions from gaps
    const suggestions = [];
    for (const gap of analysis.gaps) {
      const additionalFarms = Math.ceil(gap.shortfall / 2);
      suggestions.push({
        crop: gap.crop,
        action: 'plant',
        urgency: gap.severity === 'critical' ? 'high' : 'medium',
        message: `Network needs more ${gap.crop}: demand ${gap.monthly_demand}/mo, supply ${gap.projected_supply}/mo. Seed ${Math.max(2, Math.ceil(gap.shortfall / 4))} trays this week.`,
        recommended_trays: Math.max(2, Math.ceil(gap.shortfall / 4)),
        shortfall: gap.shortfall,
        current_farms: gap.active_farms,
        target_farms: gap.active_farms + additionalFarms
      });
    }

    for (const surplus of analysis.surpluses) {
      if (surplus.excess > 3) {
        suggestions.push({
          crop: surplus.crop,
          action: 'reduce',
          urgency: 'low',
          message: `${surplus.crop} oversupplied: supply ${surplus.projected_supply}/mo vs demand ${surplus.monthly_demand}/mo. Consider reallocating ${Math.ceil(surplus.excess / 2)} groups.`,
          excess: surplus.excess,
          current_farms: surplus.active_farms
        });
      }
    }

    // Sort by urgency
    suggestions.sort((a, b) => {
      const order = { high: 0, medium: 1, low: 2 };
      return (order[a.urgency] || 3) - (order[b.urgency] || 3);
    });

    res.json({
      ok: true,
      farm_id: farmId,
      suggestions,
      count: suggestions.length,
      supply_demand_summary: {
        gaps: analysis.gaps.length,
        surpluses: analysis.surpluses.length,
        analyzed_at: analysis.analyzed_at
      }
    });
  } catch (error) {
    console.error('[planting-suggestions] Error:', error.message);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ─── Harvest Prediction Engine (Claim #17) ─────────────────────────────
// Statistical harvest predictions with confidence intervals, std dev, and probability windows
app.get('/api/harvest/predictions', authMiddleware, async (req, res) => {
  try {
    const db = getDatabase();
    if (!db) return res.status(503).json({ ok: false, error: 'Database unavailable' });

    const pool = getDatabase();
    const farmId = req.query.farm_id || null;
    const horizonDays = parseInt(req.query.horizon) || 45;
    const minHarvests = parseInt(req.query.min_harvests) || 3;

    const result = await generateHarvestPredictions(pool, {
      farmId,
      horizonDays,
      minHarvests
    });

    res.json(result);
  } catch (error) {
    console.error('[harvest-predictions] Error:', error.message);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ─── Network Planting Coordinator (Claim #19) ──────────────────────────
// Cross-farm demand coordination with saturation index and stagger recommendations
app.get('/api/network/coordinated-planting', authMiddleware, async (req, res) => {
  try {
    const db = getDatabase();
    if (!db) return res.status(503).json({ ok: false, error: 'Database unavailable' });

    const pool = getDatabase();
    const farmId = req.query.farm_id;

    if (!farmId) {
      return res.status(400).json({ ok: false, error: 'farm_id query parameter required' });
    }

    const result = await getCoordinatedPlantingRecommendations(pool, farmId, {
      forecastDays: parseInt(req.query.forecast_days) || 30
    });

    res.json(result);
  } catch (error) {
    console.error('[coordinated-planting] Error:', error.message);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// S4.8: Unified Multi-Farm Benchmarking Dashboard API
app.get('/api/network/benchmarking', authMiddleware, async (req, res) => {
  try {
    const db = getDatabase();
    if (!db) return res.status(503).json({ ok: false, error: 'Database unavailable' });

    const isAdminRequest = !!req.admin || req.user?.authMethod === 'admin-jwt' || req.user?.farmId === 'ADMIN';
    if (!isAdminRequest) {
      return res.status(403).json({ ok: false, error: 'Admin access required' });
    }

    // 1. Yield rankings
    const yieldResult = await query(`
      SELECT
        er.farm_id,
        f.name AS farm_name,
        er.crop,
        COUNT(*) AS harvest_count,
        AVG((er.outcomes->>'weight_per_plant_oz')::float) AS avg_yield,
        AVG(COALESCE((er.outcomes->>'loss_rate')::float, 0)) AS avg_loss,
        AVG(COALESCE((er.outcomes->>'quality_score')::float, 0)) AS avg_quality,
        STDDEV((er.outcomes->>'weight_per_plant_oz')::float) AS yield_stddev
      FROM experiment_records er
      JOIN farms f ON f.farm_id = er.farm_id
      WHERE er.recorded_at > NOW() - INTERVAL '90 days'
        AND (er.outcomes->>'weight_per_plant_oz')::float > 0
      GROUP BY er.farm_id, f.name, er.crop
      HAVING COUNT(*) >= 2
      ORDER BY avg_yield DESC
    `, [], { isAdmin: true });

    // 2. Build per-farm composite scores
    const farmScores = {};
    for (const row of yieldResult.rows) {
      if (!farmScores[row.farm_id]) {
        farmScores[row.farm_id] = {
          farm_id: row.farm_id,
          farm_name: row.farm_name,
          crops: [],
          total_harvests: 0,
          avg_yield: 0,
          avg_loss: 0,
          avg_quality: 0,
          consistency: 0,
          composite_score: 0
        };
      }
      const fs = farmScores[row.farm_id];
      fs.crops.push({
        crop: row.crop,
        harvest_count: parseInt(row.harvest_count),
        avg_yield: +parseFloat(row.avg_yield).toFixed(2),
        avg_loss: +parseFloat(row.avg_loss).toFixed(3),
        avg_quality: +parseFloat(row.avg_quality || 0).toFixed(2),
        consistency: row.yield_stddev ? +(1 - Math.min(parseFloat(row.yield_stddev) / parseFloat(row.avg_yield), 1)).toFixed(2) : null
      });
      fs.total_harvests += parseInt(row.harvest_count);
    }

    // Compute composite score per farm: yield 40%, low-loss 30%, consistency 30%
    const rankings = Object.values(farmScores).map(fs => {
      const avgYield = fs.crops.reduce((s, c) => s + c.avg_yield * c.harvest_count, 0) / Math.max(fs.total_harvests, 1);
      const avgLoss = fs.crops.reduce((s, c) => s + c.avg_loss * c.harvest_count, 0) / Math.max(fs.total_harvests, 1);
      const avgConsistency = fs.crops.filter(c => c.consistency != null).reduce((s, c) => s + c.consistency, 0)
        / Math.max(fs.crops.filter(c => c.consistency != null).length, 1);

      fs.avg_yield = +avgYield.toFixed(2);
      fs.avg_loss = +avgLoss.toFixed(3);
      fs.consistency = +avgConsistency.toFixed(2);

      // Normalize: yield (0-5oz range), loss (invert, 0-0.5 range), consistency (0-1)
      const yieldScore = Math.min(avgYield / 5, 1) * 40;
      const lossScore = Math.max(1 - avgLoss * 2, 0) * 30;
      const consistencyScore = avgConsistency * 30;
      fs.composite_score = +(yieldScore + lossScore + consistencyScore).toFixed(1);

      return fs;
    });

    // Sort by composite score
    rankings.sort((a, b) => b.composite_score - a.composite_score);

    // Anonymize farm identifiers -- requesting farm sees own data, others get labels
    const callerFarmId = req.farmId || req.headers['x-farm-id'];
    const anonymized = rankings.map((r, idx) => {
      const isOwnFarm = callerFarmId && r.farm_id === callerFarmId;
      return {
        rank: idx + 1,
        farm_label: isOwnFarm ? r.farm_name : `Farm #${idx + 1}`,
        is_own_farm: isOwnFarm,
        crops: r.crops,
        total_harvests: r.total_harvests,
        avg_yield: r.avg_yield,
        avg_loss: r.avg_loss,
        consistency: r.consistency,
        composite_score: r.composite_score,
      };
    });

    // 3. Network-level aggregates
    const networkAvgYield = rankings.length > 0
      ? +(rankings.reduce((s, r) => s + r.avg_yield, 0) / rankings.length).toFixed(2) : 0;
    const networkAvgLoss = rankings.length > 0
      ? +(rankings.reduce((s, r) => s + r.avg_loss, 0) / rankings.length).toFixed(3) : 0;

    res.json({
      ok: true,
      generated_at: new Date().toISOString(),
      network_summary: {
        total_farms: rankings.length,
        total_harvests_90d: rankings.reduce((s, r) => s + r.total_harvests, 0),
        avg_yield_oz: networkAvgYield,
        avg_loss_rate: networkAvgLoss,
        top_crop: yieldResult.rows[0]?.crop || null
      },
      rankings: anonymized,
      scoring_weights: {
        yield_efficiency: '40%',
        low_loss_rate: '30%',
        consistency: '30%'
      }
    });
  } catch (error) {
    console.error('[benchmarking] Error:', error.message);
    res.status(500).json({ ok: false, error: error.message });
  }
});


// ── Phase 4 Ticket T43: Quality-Based Order Routing ────────────────────

/**
 * POST /api/wholesale/orders/route
 * Routes a buyer order to the best farm based on quality scores, distance, and capacity.
 * Uses quality-weighted scoring: quality (40%), proximity (30%), capacity (20%), price (10%).
 */
app.post('/api/wholesale/orders/route', async (req, res) => {
  try {
    const { sku_id, quantity, buyer_location, preferences } = req.body;
    if (!sku_id || !quantity) {
      return res.status(400).json({ ok: false, error: 'sku_id and quantity required' });
    }

    const db = getDatabase();

    // 1. Get all active network farms with their quality data
    let farms = [];
    try {
      const { rows } = await db.query("SELECT * FROM farms WHERE status = 'active'");
      farms = rows;
    } catch (_) {
      // Fallback to registered farms
      farms = [];
    }

    if (farms.length === 0) {
      return res.json({ ok: true, routed: false, reason: 'no_active_farms', suggestions: [] });
    }

    // 2. Query each farm for inventory + quality scores
    const candidates = [];
    for (const farm of farms) {
      if (!farm.api_url) continue;
      try {
        const invResp = await fetch(`${farm.api_url}/api/wholesale/inventory`, {
          signal: AbortSignal.timeout(5000)
        });
        if (!invResp.ok) continue;
        const inv = await invResp.json();
        const lot = (inv.lots || []).find(l =>
          l.sku_id === sku_id && (l.qty_available || 0) >= quantity
        );
        if (!lot) continue;

        // Quality score: from lot data or farm benchmark
        const qualityScore = lot.quality_score || lot.grade_score || 0.7;

        // Proximity score: if buyer location provided
        let proximityScore = 0.5; // default neutral
        if (buyer_location?.lat && buyer_location?.lng && farm.location?.lat && farm.location?.lng) {
          const dist = Math.sqrt(
            Math.pow(buyer_location.lat - farm.location.lat, 2) +
            Math.pow(buyer_location.lng - farm.location.lng, 2)
          ) * 69; // rough miles
          proximityScore = Math.max(0, 1 - dist / 500); // 0-500 mile scale
        }

        // Capacity score: how much excess the farm has
        const capacityScore = Math.min((lot.qty_available - quantity) / 50, 1);

        // Price score: lower is better (inverted)
        const priceScore = lot.price_per_case
          ? Math.max(0, 1 - lot.price_per_case / 100)
          : 0.5;

        // Weighted composite
        const weights = { quality: 0.40, proximity: 0.30, capacity: 0.20, price: 0.10 };
        const composite =
          qualityScore * weights.quality +
          proximityScore * weights.proximity +
          capacityScore * weights.capacity +
          priceScore * weights.price;

        candidates.push({
          farm_id: farm.farm_id,
          farm_name: farm.name,
          api_url: farm.api_url,
          sku_id: lot.sku_id,
          qty_available: lot.qty_available,
          quality_score: +qualityScore.toFixed(3),
          proximity_score: +proximityScore.toFixed(3),
          capacity_score: +capacityScore.toFixed(3),
          price_score: +priceScore.toFixed(3),
          composite_score: +composite.toFixed(3),
          price_per_case: lot.price_per_case || null
        });
      } catch (e) {
        // Farm unreachable — skip
      }
    }

    // Sort by composite score (highest first)
    candidates.sort((a, b) => b.composite_score - a.composite_score);

    const best = candidates[0] || null;

    // Apply preference filters
    if (best && preferences?.min_quality && best.quality_score < preferences.min_quality) {
      return res.json({
        ok: true,
        routed: false,
        reason: 'quality_below_threshold',
        min_quality: preferences.min_quality,
        best_available: best.quality_score,
        candidates: candidates.length
      });
    }

    logger.info(`[quality-routing] Routed ${sku_id} x${quantity}: best=${best?.farm_id} (score=${best?.composite_score})`, {
      candidates: candidates.length,
      best_farm: best?.farm_id
    });

    res.json({
      ok: true,
      routed: !!best,
      best_farm: best,
      alternatives: candidates.slice(1, 4),
      total_candidates: candidates.length,
      routing_weights: { quality: 0.40, proximity: 0.30, capacity: 0.20, price: 0.10 }
    });
  } catch (error) {
    logger.error('[quality-routing] Error:', { error: error.message });
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * GET /api/wholesale/quality-scores
 * Returns aggregated quality scores per farm per crop for routing decisions.
 */
app.get('/api/wholesale/quality-scores', async (req, res) => {
  try {
    const db = getDatabase();
    let farms = [];
    try {
      const { rows } = await db.query("SELECT * FROM farms WHERE status = 'active'");
      farms = rows;
    } catch (_) {}

    const scores = {};
    for (const farm of farms) {
      if (!farm.api_url) continue;
      try {
        const resp = await fetch(`${farm.api_url}/api/wholesale/inventory`, {
          signal: AbortSignal.timeout(5000)
        });
        if (!resp.ok) continue;
        const inv = await resp.json();
        scores[farm.farm_id] = {
          farm_name: farm.name,
          crops: {}
        };
        for (const lot of (inv.lots || [])) {
          const crop = lot.crop || lot.sku_id;
          if (!scores[farm.farm_id].crops[crop]) {
            scores[farm.farm_id].crops[crop] = {
              quality_score: lot.quality_score || lot.grade_score || null,
              qty_available: 0,
              lots: 0
            };
          }
          scores[farm.farm_id].crops[crop].qty_available += lot.qty_available || 0;
          scores[farm.farm_id].crops[crop].lots++;
        }
      } catch (_) {}
    }

    res.json({ ok: true, scores, farm_count: Object.keys(scores).length });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ── Phase 4 Ticket T44: Dynamic Pricing Engine ─────────────────────────

/**
 * POST /api/wholesale/dynamic-pricing
 * Calculates recommended wholesale pricing based on:
 * - Supply levels (network-wide inventory)
 * - Demand signals (buyer order trends)
 * - Quality scores
 * - Seasonality
 * - Competition (number of farms offering same crop)
 */
app.post('/api/wholesale/dynamic-pricing', async (req, res) => {
  try {
    const { crops } = req.body;
    const targetCrops = crops || [];

    const db = getDatabase();

    // 1. Gather network supply
    let farms = [];
    try {
      const { rows } = await db.query("SELECT * FROM farms WHERE status = 'active'");
      farms = rows;
    } catch (_) {}

    const supplyMap = {};
    const qualityMap = {};
    for (const farm of farms) {
      if (!farm.api_url) continue;
      try {
        const resp = await fetch(`${farm.api_url}/api/wholesale/inventory`, {
          signal: AbortSignal.timeout(5000)
        });
        if (!resp.ok) continue;
        const inv = await resp.json();
        for (const lot of (inv.lots || [])) {
          const crop = (lot.crop || lot.sku_id || '').toLowerCase().replace(/\s+/g, '-');
          if (!crop) continue;
          if (!supplyMap[crop]) supplyMap[crop] = { total: 0, farms: 0 };
          supplyMap[crop].total += lot.qty_available || 0;
          supplyMap[crop].farms++;
          if (lot.quality_score) {
            if (!qualityMap[crop]) qualityMap[crop] = [];
            qualityMap[crop].push(lot.quality_score);
          }
        }
      } catch (_) {}
    }

    // 2. Gather demand signals
    let demandSignals = {};
    try {
      const aiRecsPath = path.join(__dirname, 'data', 'ai-recommendations-cache.json');
      if (fs.existsSync(aiRecsPath)) {
        const cache = JSON.parse(fs.readFileSync(aiRecsPath, 'utf8'));
        demandSignals = cache.network_intelligence?.demand_signals || {};
      }
    } catch (_) {}

    // 3. Base pricing: prefer DB crop_pricing, fall back to hardcoded
    let dbCropPrices = {};
    try {
      const fid = process.env.FARM_ID || 'default';
      const cpData = await farmStore.get(fid, 'crop_pricing');
      if (cpData && cpData.crops) {
        for (const c of cpData.crops) {
          if (c.wholesalePrice > 0) {
            dbCropPrices[c.crop.toLowerCase().replace(/\s+/g, '-')] = c.wholesalePrice;
            dbCropPrices[c.crop] = c.wholesalePrice;
          }
        }
      }
    } catch (_) {}
    const basePricing = {
      'genovese-basil': 28, 'basil': 28, 'kale': 18,
      'lettuce': 14, 'arugula': 24, 'spinach': 20,
      'microgreens': 45, 'cilantro': 22, 'mint': 26,
      'chard': 16, 'bok-choy': 18, 'watercress': 30,
      ...dbCropPrices
    };

    // 4. Calculate dynamic prices
    const month = new Date().getMonth();
    const seasonMultiplier = month >= 10 || month <= 2 ? 1.15 : month >= 5 && month <= 8 ? 0.85 : 1.0;

    const pricing = {};
    const allCrops = targetCrops.length > 0
      ? targetCrops
      : [...new Set([...Object.keys(supplyMap), ...Object.keys(basePricing)])];

    for (const crop of allCrops) {
      const base = basePricing[crop] || 20;
      const supply = supplyMap[crop] || { total: 0, farms: 0 };
      const demand = demandSignals[crop] || {};
      const qualities = qualityMap[crop] || [];
      const avgQuality = qualities.length > 0
        ? qualities.reduce((a, b) => a + b, 0) / qualities.length
        : 0.7;

      // Supply factor: low supply → higher price (1.0–1.3)
      const supplyFactor = supply.total > 100 ? 0.90
        : supply.total > 50 ? 1.00
        : supply.total > 20 ? 1.10
        : supply.total > 0 ? 1.20
        : 1.30;

      // Demand factor: high demand → higher price (0.9–1.25)
      const demandTrend = demand.network_trend || 'stable';
      const demandFactor = demandTrend === 'increasing' ? 1.15
        : demandTrend === 'decreasing' ? 0.90
        : 1.0;

      // Quality premium: higher quality → higher price (0.95–1.15)
      const qualityFactor = 0.85 + (avgQuality * 0.30);

      // Competition factor: more farms → lower price
      const competitionFactor = supply.farms > 5 ? 0.90
        : supply.farms > 3 ? 0.95
        : supply.farms > 1 ? 1.00
        : 1.10; // sole supplier premium

      const recommended = +(base * seasonMultiplier * supplyFactor * demandFactor * qualityFactor * competitionFactor).toFixed(2);
      const floor = +(base * 0.70).toFixed(2);
      const ceiling = +(base * 1.80).toFixed(2);

      pricing[crop] = {
        base_price: base,
        recommended_price: Math.max(floor, Math.min(ceiling, recommended)),
        price_floor: floor,
        price_ceiling: ceiling,
        factors: {
          season: +seasonMultiplier.toFixed(2),
          supply: +supplyFactor.toFixed(2),
          demand: +demandFactor.toFixed(2),
          quality: +qualityFactor.toFixed(2),
          competition: +competitionFactor.toFixed(2)
        },
        supply_qty: supply.total,
        supply_farms: supply.farms,
        avg_quality: +avgQuality.toFixed(2),
        demand_trend: demandTrend
      };
    }

    logger.info(`[dynamic-pricing] Calculated prices for ${Object.keys(pricing).length} crops`);
    res.json({
      ok: true,
      pricing,
      crop_count: Object.keys(pricing).length,
      calculated_at: new Date().toISOString()
    });
  } catch (error) {
    logger.error('[dynamic-pricing] Error:', { error: error.message });
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * GET /api/wholesale/pricing-recommendations
 * Quick pricing recommendations for all crops (no body needed).
 */
app.get('/api/wholesale/pricing-recommendations', async (req, res) => {
  try {
    // Internally call the dynamic pricing engine with no filters
    const basePricing = {
      'genovese-basil': 28, 'basil': 28, 'kale': 18,
      'lettuce': 14, 'arugula': 24, 'spinach': 20,
      'microgreens': 45, 'cilantro': 22, 'mint': 26
    };

    const month = new Date().getMonth();
    const seasonMultiplier = month >= 10 || month <= 2 ? 1.15 : month >= 5 && month <= 8 ? 0.85 : 1.0;

    const recommendations = {};
    for (const [crop, base] of Object.entries(basePricing)) {
      recommendations[crop] = {
        base_price: base,
        recommended_price: +(base * seasonMultiplier).toFixed(2),
        season: seasonMultiplier > 1 ? 'winter_premium' : seasonMultiplier < 1 ? 'summer_discount' : 'neutral'
      };
    }

    res.json({ ok: true, recommendations, season_multiplier: seasonMultiplier });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ── Phase 2 Ticket T23: Network Trends Endpoint (Central) ──────────────

/**
 * GET /api/network/trends
 * Aggregated network-wide trends — crop performance, yield, demand over time.
 * Consumed by Foxtrot's /api/network/trends proxy.
 */
app.get('/api/network/trends', authMiddleware, async (req, res) => {
  try {
    const period = req.query.period || '30d';
    const days = parseInt(period) || 30;

    const db = getDatabase();

    // 1. Yield trends from experiment records
    const trendsFarmId = req.farmId || req.user?.farmId || req.headers['x-farm-id'];
    if (!trendsFarmId) {
      return res.status(401).json({ ok: false, error: 'Missing farm context' });
    }
    let yieldTrends = [];
    try {
      const { rows: records } = await db.query(
        'SELECT * FROM experiment_records WHERE farm_id = $1 ORDER BY recorded_at DESC LIMIT 200',
        [trendsFarmId]
      );

      const cropYields = {};
      for (const r of records) {
        const crop = r.crop || r.recipe;
        if (!crop) continue;
        if (!cropYields[crop]) cropYields[crop] = [];
        cropYields[crop].push({
          yield_oz: r.outcomes?.weight_per_plant_oz || null,
          recorded_at: r.recorded_at,
          farm_id: r.farm_id
        });
      }

      for (const [crop, data] of Object.entries(cropYields)) {
        const yields = data.filter(d => d.yield_oz).map(d => d.yield_oz);
        const avg = yields.length > 0 ? yields.reduce((a, b) => a + b, 0) / yields.length : 0;
        const recent = yields.slice(0, Math.ceil(yields.length / 2));
        const earlier = yields.slice(Math.ceil(yields.length / 2));
        const recentAvg = recent.length > 0 ? recent.reduce((a, b) => a + b, 0) / recent.length : avg;
        const earlierAvg = earlier.length > 0 ? earlier.reduce((a, b) => a + b, 0) / earlier.length : avg;
        const trend = recentAvg > earlierAvg * 1.05 ? 'improving'
          : recentAvg < earlierAvg * 0.95 ? 'declining'
          : 'stable';

        yieldTrends.push({
          crop,
          avg_yield_oz: +avg.toFixed(2),
          recent_avg: +recentAvg.toFixed(2),
          samples: data.length,
          farms: [...new Set(data.map(d => d.farm_id))].length,
          trend
        });
      }
    } catch (e) {
      logger.warn('[network-trends] Yield query failed:', { error: e.message });
    }

    // 2. Demand trends from AI recs cache
    let demandTrends = [];
    try {
      const cachePath = path.join(__dirname, 'data', 'ai-recommendations-cache.json');
      if (fs.existsSync(cachePath)) {
        const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
        const signals = cache.network_intelligence?.demand_signals || {};
        for (const [crop, sig] of Object.entries(signals)) {
          demandTrends.push({
            crop,
            network_demand_qty: sig.network_total_qty || 0,
            trend: sig.network_trend || 'stable',
            buyer_count: sig.buyer_count || 0
          });
        }
      }
    } catch (_) {}

    // 3. Farm activity trends
    let farmActivity = { active_farms: 0, total_experiments: 0 };
    try {
      const { rows: [{ count: farmCountStr }] } = await db.query("SELECT COUNT(*) FROM farms WHERE status = 'active'");
      const { rows: [{ count: expCountStr }] } = await db.query('SELECT COUNT(*) FROM experiment_records WHERE farm_id = $1', [trendsFarmId]);
      farmActivity = { active_farms: parseInt(farmCountStr) || 0, total_experiments: parseInt(expCountStr) || 0 };
    } catch (_) {}

    res.json({
      ok: true,
      period_days: days,
      yield_trends: yieldTrends,
      demand_trends: demandTrends,
      farm_activity: farmActivity,
      generated_at: new Date().toISOString()
    });
  } catch (error) {
    logger.error('[network-trends] Error:', { error: error.message });
    res.status(500).json({ ok: false, error: error.message });
  }
});


// ── Phase 4 Ticket 4.7: A/B Recipe Experiment API ─────────────────────
app.post('/api/experiments', async (req, res) => {
  try {
    const exp = await createExperiment(req.body);
    res.json({ ok: true, experiment: exp });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get('/api/experiments', async (req, res) => {
  try {
    const status = req.query.status || null;
    const experiments = await listExperiments(status);
    res.json({ ok: true, experiments });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get('/api/experiments/:id', async (req, res) => {
  try {
    const exp = await getExperiment(req.params.id);
    if (!exp) return res.status(404).json({ ok: false, error: 'Experiment not found' });
    res.json({ ok: true, experiment: exp });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post('/api/experiments/:id/activate', async (req, res) => {
  try {
    const exp = await activateExperiment(req.params.id);
    if (!exp) return res.status(404).json({ ok: false, error: 'Experiment not found or not in draft' });
    res.json({ ok: true, experiment: exp });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post('/api/experiments/:id/observe', async (req, res) => {
  try {
    const { farm_id, arm, outcomes, group_id } = req.body;
    await recordObservation(req.params.id, farm_id, arm, outcomes, group_id);
    res.json({ ok: true, message: 'Observation recorded' });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post('/api/experiments/:id/analyze', async (req, res) => {
  try {
    const analysis = await analyzeExperiment(req.params.id);
    res.json({ ok: true, analysis });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post('/api/experiments/:id/complete', async (req, res) => {
  try {
    const { findings } = req.body;
    const exp = await completeExperiment(req.params.id, findings);
    if (!exp) return res.status(404).json({ ok: false, error: 'Experiment not found' });
    res.json({ ok: true, experiment: exp });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get('/api/experiments/farm/:farmId', async (req, res) => {
  try {
    const experiments = await getExperimentsForFarm(req.params.farmId);
    res.json({ ok: true, experiments });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ── Phase 4 Ticket 4.8: Governance Review Report ──────────────────────
app.get('/api/governance/report', async (req, res) => {
  try {
    const months = parseInt(req.query.months) || 1;
    const report = await generateGovernanceReport({ months });
    const format = req.query.format || 'json';
    if (format === 'text') {
      res.type('text/plain').send(formatReportText(report));
    } else {
      res.json({ ok: true, report });
    }
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ── Phase 5 Ticket 5.4: Network Production Planning ──────────────────

/**
 * GET /api/production/plan
 * Generate weekly seeding plan for the network without distributing.
 */
app.get('/api/production/plan', async (req, res) => {
  try {
    const forecastWeeks = parseInt(req.query.weeks) || 4;
    const result = await generateWeeklyPlan({ forecastWeeks });
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * POST /api/production/plan/distribute
 * Generate and push weekly seeding plans to all farms.
 */
app.post('/api/production/plan/distribute', async (req, res) => {
  try {
    const forecastWeeks = parseInt(req.body?.weeks) || 4;
    const result = await generateAndDistributePlan({ forecastWeeks });
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * GET /api/production/demand
 * Get demand forecast from wholesale order history.
 */
app.get('/api/production/demand', async (req, res) => {
  try {
    const forecast = await gatherDemandForecast();
    res.json({ ok: true, forecast });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * GET /api/production/supply
 * Get current network supply status.
 */
app.get('/api/production/supply', async (req, res) => {
  try {
    const supply = await getNetworkSupply();
    res.json({ ok: true, supply, count: supply.length });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ── Phase 5 Ticket 5.6: Predictive Inventory Listing ────────────────

/**
 * GET /api/wholesale/predicted-inventory
 * Get predicted inventory — products available before harvest with confidence levels.
 * Buyers see "Available Feb 28" with confidence level for pre-ordering.
 */
app.get('/api/wholesale/predicted-inventory', async (req, res) => {
  try {
    const { generatePredictedInventory } = await import('./services/wholesaleNetworkAggregator.js');
    const predictions = await generatePredictedInventory();
    const minConfidence = parseFloat(req.query.min_confidence) || 0;
    const filtered = minConfidence > 0
      ? predictions.filter(p => p.confidence >= minConfidence)
      : predictions;
    res.json({
      ok: true,
      predicted_inventory: filtered,
      count: filtered.length,
      note: 'Predicted availability based on farm harvest patterns. Subject to change.',
      generated_at: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// --- Crop Registry API (Phase 2a — single source of truth) ---
app.get('/api/crops', (req, res) => {
  const registryPath = path.join(__dirname, 'public/data/crop-registry.json');
  try {
    const registryData = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
    const activeOnly = req.query.active === 'true';
    const categoryFilter = req.query.category || null;

    const crops = Object.entries(registryData.crops)
      .filter(([, crop]) => !activeOnly || crop.active)
      .filter(([, crop]) => !categoryFilter || crop.category === categoryFilter)
      .map(([name, crop]) => ({
        name,
        category: crop.category,
        active: crop.active,
        aliases: crop.aliases,
        planIds: crop.planIds,
        growth: crop.growth,
        pricing: crop.pricing,
        market: crop.market,
        nutrientProfile: crop.nutrientProfile
      }));

    res.json({ version: registryData.version, crops });
  } catch (error) {
    console.error('[crops] Failed to load crop registry:', error?.message);
    const fallback = cropUtils.getAllCrops();
    res.json({ version: 'fallback', crops: fallback.map(c => ({ name: c.name, ...c.crop })) });
  }
});

app.get('/api/crops/:name', (req, res) => {
  const registryPath = path.join(__dirname, 'public/data/crop-registry.json');
  try {
    const registryData = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
    const cropName = req.params.name;
    // Try exact match first, then normalize
    const crop = registryData.crops[cropName] || registryData.crops[cropUtils.normalizeCropName(cropName)];
    if (!crop) {
      return res.status(404).json({ error: `Crop not found: ${cropName}` });
    }
    res.json({ name: cropName, ...crop });
  } catch (error) {
    console.error('[crops] Failed to load crop:', error?.message);
    res.status(500).json({ error: 'Failed to load crop data' });
  }
});
if (grantWizardRoutes) app.use('/api/grant-wizard', grantWizardRoutes); // Grant wizard (env-gated)

// Root route - redirect to main landing page
app.get('/', (req, res) => {
  res.redirect('/greenreach-org.html');
});

app.get('/farm-summary.html', (req, res) => {
  res.redirect('/views/farm-summary.html');
});

app.get('/admin.html', (req, res) => {
  res.redirect('/farm-admin.html');
});

// LE-dashboard.html, LE-farm-admin.html, farm-vitality.html now served
// directly as static files from public/ (no redirects needed)

// Scanner-noise suppression for public internet probe traffic.
// This reduces false Red health transitions caused by high-volume 404 scans
// against known exploit paths that are not part of GreenReach routes.
const SCANNER_PROBE_PATTERNS = [
  /^\/wp-admin/i,
  /^\/wp-login/i,
  /^\/wordpress/i,
  /^\/phpmyadmin/i,
  /^\/\.env/i,
  /^\/boaform/i,
  /^\/cgi-bin/i,
  /^\/HNAP1/i,
  /^\/actuator\//i,
  /^\/manager\//i,
  /^\/solr\//i,
  /^\/(portal|login|admin-ng|geoserver|arcgis|cas|webui|nagios|webmail|pmuser)\b/i,
  /\.(php|asp|aspx|jsp|cgi|do|nsf)(\?.*)?$/i
];

function isLikelyScannerProbe(req) {
  const p = req.path || '';
  if (!p || p === '/' || p.startsWith('/api/')) return false;
  if (req.headers.authorization || req.headers['x-api-key']) return false;
  return SCANNER_PROBE_PATTERNS.some((rx) => rx.test(p));
}

app.use((req, res, next) => {
  if (!isLikelyScannerProbe(req)) return next();
  logger.warn(`[ScannerProbe] Suppressed ${req.method} ${req.path}`);
  return res.status(204).end();
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.path} not found`,
    timestamp: new Date().toISOString()
  });
});

// Error handling middleware
app.use(errorHandler);

// Global process error handlers (prevent silent crashes)
process.on('unhandledRejection', (reason, promise) => {
  logger.error('[Process] Unhandled Promise Rejection', {
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined
  });
});

process.on('uncaughtException', (error) => {
  logger.error('[Process] Uncaught Exception — shutting down', {
    error: error.message,
    stack: error.stack
  });
  process.exit(1);
});

// Initialize database and start server
async function startServer() {
  try {
    // Initialize database connection (optional in local/dev)
    logger.info('Initializing database connection...');
    try {
      await initDatabase();
      app.locals.databaseReady = true;
      app.locals.dbPool = getDatabase();
      logger.info('Database connected successfully');
      // Wire error capture to database for F.A.Y.E. diagnostics
      initErrorCapture(query, isDatabaseAvailable);

      // Sync marketing skill system prompts with correct brand identity
      try {
        const { syncSkillPrompts } = await import('./services/marketing-ai-agent.js');
        await syncSkillPrompts();
      } catch (e) { /* marketing module may not be loaded yet */ }
      
      // Hydrate in-memory Maps from farm_data table (multi-tenant SaaS)
      const hydrationResult = await hydrateFromDatabase();
      if (hydrationResult.hydrated) {
        logger.info(`[SaaS] Hydrated ${hydrationResult.datasets} datasets for ${hydrationResult.farms} farm(s)`);
      }

      // Migrate data stored under farm_id='default' to the real farm ID
      await migrateDefaultFarmData();
      
      // Seed demo farm data in development
      if (process.env.NODE_ENV !== 'production') {
        await seedDemoFarm();
      }

      // Start periodic admin session cleanup (every 30 minutes)
      setInterval(async () => {
        try {
          const { query: dbQuery } = await import('./config/database.js');
          const result = await dbQuery('DELETE FROM admin_sessions WHERE expires_at < NOW()');
          if (result.rowCount > 0) {
            logger.info(`[Admin Sessions] Cleaned up ${result.rowCount} expired session(s)`);
          }
        } catch (err) {
          // Table may not exist yet or DB temporarily unavailable — silently skip
        }
      }, 30 * 60 * 1000); // 30 minutes
    } catch (error) {
      app.locals.databaseReady = false;
      logger.warn('Database unavailable; starting in limited mode', {
        error: error.message
      });
    }

    // Create HTTP server
    const server = http.createServer(app);

    // Start HTTP server
    server.listen(PORT, () => {
      logger.info(`GreenReach Central API server running on port ${PORT}`);
      logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
    });

    // Setup WebSocket server attached to the HTTP server (shares port 8080 via upgrade)
    const wss = new WebSocketServer({ server });
    logger.info(`WebSocket server attached to HTTP server on port ${PORT}`);

    wss.on('connection', (ws, req) => {
      // Authenticate WebSocket connection via query param or header
      let farmId = null;
      let authMethod = 'none';
      try {
        const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        const token = url.searchParams.get('token');
        if (token) {
          const payload = _jwtLib.verify(token, _JWT_SECRET, {
            issuer: 'greenreach-central',
            audience: 'greenreach-farms'
          });
          farmId = payload.farm_id;
          authMethod = 'jwt';
        } else if (req.headers['x-api-key'] && req.headers['x-farm-id']) {
          // API key auth for edge devices
          const expected = process.env.GREENREACH_API_KEY;
          if (expected && req.headers['x-api-key'] === expected) {
            farmId = req.headers['x-farm-id'];
            authMethod = 'api-key';
          }
        }
      } catch (err) {
        logger.warn('[WS] Auth failed:', err.message);
      }

      if (!farmId && process.env.NODE_ENV === 'production') {
        logger.warn('[WS] Rejecting unauthenticated connection in production');
        ws.close(4001, 'Authentication required');
        return;
      }

      ws.farmId = farmId;
      ws.authMethod = authMethod;
      logger.info(`New WebSocket connection established (farm: ${farmId || 'dev'}, auth: ${authMethod})`);
      
      // Send welcome message
      ws.send(JSON.stringify({
        type: 'connection',
        message: 'Connected to GreenReach Central',
        timestamp: new Date().toISOString()
      }));

      // Handle incoming messages
      ws.on('message', async (message) => {
        try {
          const data = JSON.parse(message);
          logger.debug('WebSocket message received', { type: data.type });

          // LEAM companion agent messages (ble_scan, network_scan, etc.)
          if (data.type && data.type.startsWith('leam_')) {
            // Network watchlist alert from LEAM monitor
            if (data.type === 'leam_network_alert') {
              const alertFarmId = ws.farmId || farmId;
              logger.warn(`[LEAM] Network watchlist alert from farm ${alertFarmId}: ${data.matches?.length || 0} match(es)`);
              // Store as admin alert for F.A.Y.E. security analysis
              if (app.locals.databaseReady) {
                try {
                  for (const match of (data.matches || [])) {
                    await query(
                      `INSERT INTO admin_alerts (domain, severity, title, detail, source, metadata)
                       VALUES ($1, $2, $3, $4, $5, $6)`,
                      [
                        'network_security',
                        'high',
                        `Watchlist domain detected: ${match.domain}`,
                        match.process
                          ? `Connection to ${match.domain} (${match.remote_ip}) by process ${match.process} (PID ${match.pid}). Method: ${match.detection_method}`
                          : `DNS activity for ${match.domain} detected via ${match.detection_method}`,
                        'leam_network_monitor',
                        JSON.stringify({ ...match, farm_id: alertFarmId })
                      ]
                    );
                  }
                } catch (alertErr) {
                  logger.warn(`[LEAM] Failed to store network alert: ${alertErr.message}`);
                }
              }
              return;
            }

            // LEAM requesting its current watchlist
            if (data.type === 'leam_request_watchlist') {
              if (app.locals.databaseReady) {
                try {
                  const result = await query(
                    `SELECT domain, reason, added_by, created_at FROM network_watchlist
                     WHERE farm_id = $1 AND active = TRUE ORDER BY created_at DESC`,
                    [ws.farmId || farmId]
                  );
                  ws.send(JSON.stringify({
                    type: 'leam_watchlist_update',
                    watchlist: result.rows.map(r => ({ domain: r.domain, reason: r.reason }))
                  }));
                } catch (wlErr) {
                  logger.warn(`[LEAM] Failed to load watchlist: ${wlErr.message}`);
                  ws.send(JSON.stringify({ type: 'leam_watchlist_update', watchlist: [] }));
                }
              } else {
                ws.send(JSON.stringify({ type: 'leam_watchlist_update', watchlist: [] }));
              }
              return;
            }

            leamBridge.processMessage(ws, ws.farmId || farmId, data);
            return;
          }
          
          // Handle different message types
          if (data.type === 'subscribe') {
            // Subscribe to farm updates
            ws.farmId = data.farmId;
            ws.send(JSON.stringify({
              type: 'subscribed',
              farmId: data.farmId,
              timestamp: new Date().toISOString()
            }));
          }
        } catch (error) {
          logger.error('WebSocket message error', { error: error.message });
        }
      });

      ws.on('close', () => {
        leamBridge.handleDisconnect(ws.farmId || farmId, ws);
        logger.info('WebSocket connection closed');
      });

      ws.on('error', (error) => {
        logger.error('WebSocket error', { error: error.message });
      });
    });

    // Store WebSocket server for use in other modules
    app.locals.wss = wss;
    app.locals.leamBridge = leamBridge;

    /**
     * Broadcast an event to all WebSocket clients subscribed to a specific farm.
     * @param {string} farmId - Target farm ID (or '*' for all clients)
     * @param {object} event  - Event payload { type, ... }
     */
    app.locals.broadcastToFarm = (farmId, event) => {
      const payload = JSON.stringify({ ...event, timestamp: new Date().toISOString() });
      let sent = 0;
      wss.clients.forEach((client) => {
        if (client.readyState === 1 /* OPEN */ && (farmId === '*' || client.farmId === farmId)) {
          client.send(payload);
          sent++;
        }
      });
      if (sent > 0) logger.debug(`[WS] Broadcast ${event.type} to ${sent} client(s) for farm ${farmId}`);
    };

    // Start background services (require DB)
    if (app.locals.databaseReady) {
      logger.info('Starting background services...');
      startHealthCheckService(app);
      startNightlyAuditService();
      startSyncMonitor(app);
      startAIPusher(); // AI recommendations pusher (GPT-4)
      startAwsCostExplorerScheduler(); // Optional AWS Cost Explorer accounting sync
      startBenchmarkScheduler(); // AI Vision Phase 1: nightly crop benchmark aggregation
      startLotExpiryScheduler(); // Nightly: auto-expire lots past best-by date
      startMarketDataFetcher(); // Phase 1A: daily USDA price ingestion
      startMarketAnalysisAgent(); // Phase 2A: daily GPT market analysis
      startFayeIntelligence(); // F.A.Y.E. Phase 3: anomaly detection + daily briefing
      startNightlyChecklist(); // Nightly AI Checklist: learning notes exchange + self-eval questions

      // AI Vision Phase 3: weekly cross-farm yield regression (T31/T32)
      // Run once after 5 min, then weekly
      setTimeout(() => {
        runYieldRegression().catch(e => logger.warn('Initial yield regression failed', { error: e.message }));
      }, 5 * 60 * 1000);
      setInterval(() => {
        runYieldRegression().catch(e => logger.warn('Yield regression failed', { error: e.message }));
      }, 7 * 24 * 60 * 60 * 1000); // Weekly
      logger.info('Yield regression scheduler enabled (weekly + initial 5min delay)');

      // Phase 4: Initialize A/B experiment tables
      try {
        await initExperimentTables();
        logger.info('A/B experiment tables initialized');
      } catch (expErr) {
        logger.warn('A/B experiment table init failed (non-fatal)', { error: expErr.message });
      }


// ── Sprint 5 Ticket S5.4: Weekly Production Plan Auto-Scheduler ─────────

/**
 * Automatically runs the production planner weekly.
 * Distributes plans to all active network farms.
 */
(function wireProductionPlanScheduler() {
  async function runWeeklyProductionPlan() {
    try {
      console.log('[production-planner] Running weekly auto-plan...');
      const result = await generateAndDistributePlan({ forecastWeeks: 4 });
      console.log(`[production-planner] Weekly plan generated: ${result?.plan?.length || 0} items, distributed to ${result?.distributed_to?.length || 0} farms`);
    } catch (err) {
      console.warn('[production-planner] Weekly auto-plan failed (non-fatal):', err?.message);
    }
  }

  // Run weekly (every 7 days), first run after 10 minutes of boot
  setTimeout(runWeeklyProductionPlan, 10 * 60 * 1000);
  setInterval(runWeeklyProductionPlan, 7 * 24 * 60 * 60 * 1000);
  console.log('[production-planner] Weekly auto-scheduler wired');
})();

// ── Sprint 5 Ticket S5.5: Network Recipe Version Tracking ───────────────

/**
 * GET /api/network/recipe-versions
 * Returns recipe versions across the network (which farms have adopted which versions).
 *
 * POST /api/network/recipe-versions/push
 * Pushes a recipe version update to all active farms in the network.
 */
app.get('/api/network/recipe-versions', async (req, res) => {
  try {
    const versionsPath = path.join(__dirname, 'data', 'network-recipe-versions.json');
    if (!fs.existsSync(versionsPath)) {
      return res.json({ ok: true, versions: {}, farms: [] });
    }
    const data = JSON.parse(fs.readFileSync(versionsPath, 'utf8'));
    res.json({ ok: true, ...data });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post('/api/network/recipe-versions/push', async (req, res) => {
  try {
    const { crop, modifiers, version, push_mode } = req.body;
    if (!crop || !modifiers) {
      return res.status(400).json({ ok: false, error: 'crop and modifiers required' });
    }

    const ver = version || Date.now();
    const mode = push_mode || 'suggest'; // 'suggest' or 'auto_adopt'

    // Get active network farms
    let farms = [];
    try {
      const { rows } = await db.query("SELECT * FROM farms WHERE status = 'active'");
      farms = rows;
    } catch (_) {}

    const results = [];
    for (const farm of farms) {
      if (!farm.api_url) continue;
      try {
        const endpoint = mode === 'auto_adopt'
          ? `${farm.api_url}/api/recipe-modifiers/network/auto-adopt`
          : `${farm.api_url}/api/ai/recommendations/receive`;

        const pushResp = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ crop, modifiers, version: ver, source: 'central_push' }),
          signal: AbortSignal.timeout(5000)
        });
        results.push({ farm_id: farm.farm_id, status: pushResp.ok ? 'pushed' : 'failed' });
      } catch (e) {
        results.push({ farm_id: farm.farm_id, status: 'unreachable' });
      }
    }

    // Track versions
    const versionsPath = path.join(__dirname, 'data', 'network-recipe-versions.json');
    let versionData = {};
    try { versionData = JSON.parse(fs.readFileSync(versionsPath, 'utf8')); } catch (_) {}
    if (!versionData.recipes) versionData.recipes = {};
    versionData.recipes[crop] = {
      version: ver,
      modifiers,
      pushed_at: new Date().toISOString(),
      mode,
      farm_results: results
    };
    fs.writeFileSync(versionsPath, JSON.stringify(versionData, null, 2));

    console.log(`[recipe-versions] Pushed ${crop} v${ver} to ${results.length} farms (${results.filter(r => r.status === 'pushed').length} ok)`);
    res.json({ ok: true, crop, version: ver, results });
  } catch (error) {
    console.error('[recipe-versions] Push error:', error.message);
    res.status(500).json({ ok: false, error: error.message });

// ── Phase 5 T50: Predictive Inventory / Auto Wholesale Listing ──────────

/**
 * GET /api/inventory/predicted-surplus
 * Forecasts surplus inventory from active growing groups + harvest predictions.
 * Returns per-crop projected surplus with auto-listing recommendations.
 */
app.get('/api/inventory/predicted-surplus', authOrAdminMiddleware, async (req, res) => {
  try {
    // 1. Get active growing groups with projected harvest dates/quantities
    const activeGroups = await query(
      `SELECT er.crop, er.zone,
              er.data->>'tray_count' as tray_count,
              er.data->>'plants_per_tray' as plants_per_tray,
              er.data->>'seeded_at' as seeded_at,
              er.data->>'estimated_harvest_date' as estimated_harvest_date,
              er.data->>'estimated_weight_kg' as estimated_weight_kg
       FROM experiment_records er
       WHERE er.status = 'active'
         AND er.data->>'estimated_harvest_date' IS NOT NULL
       ORDER BY er.data->>'estimated_harvest_date' ASC`
    );

    // 2. Get existing wholesale orders (committed demand)
    const committedDemand = await query(
      `SELECT product_name as crop, SUM((data->>'quantity')::numeric) as committed_qty
       FROM wholesale_orders
       WHERE status IN ('pending', 'confirmed', 'processing')
       GROUP BY product_name`
    );

    const demandMap = {};
    for (const d of committedDemand.rows || []) {
      demandMap[d.crop?.toLowerCase()] = parseFloat(d.committed_qty) || 0;
    }

    // 3. Calculate surplus per crop
    const surplusByCrop = {};
    for (const g of activeGroups.rows || []) {
      const crop = (g.crop || '').toLowerCase();
      if (!crop) continue;
      const estWeight = parseFloat(g.estimated_weight_kg) || 0;
      if (!surplusByCrop[crop]) surplusByCrop[crop] = { crop: g.crop, projected_kg: 0, committed_kg: 0, groups: 0 };
      surplusByCrop[crop].projected_kg += estWeight;
      surplusByCrop[crop].groups += 1;
    }

    const predictions = [];
    for (const [cropKey, info] of Object.entries(surplusByCrop)) {
      info.committed_kg = demandMap[cropKey] || 0;
      info.surplus_kg = Math.max(0, info.projected_kg - info.committed_kg);
      info.surplus_ratio = info.projected_kg > 0 ? info.surplus_kg / info.projected_kg : 0;
      info.recommend_listing = info.surplus_kg > 0.5 && info.surplus_ratio > 0.2;
      predictions.push(info);
    }

    predictions.sort((a, b) => b.surplus_kg - a.surplus_kg);
    res.json({ success: true, predictions, generated_at: new Date().toISOString() });
  } catch (error) {
    console.error('[predictive-inventory] surplus forecast error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/inventory/auto-list
 * Automatically creates wholesale catalog listings for crops with predicted surplus.
 * Applies dynamic pricing from T44 pricing engine when available.
 */
app.post('/api/inventory/auto-list', authOrAdminMiddleware, async (req, res) => {
  try {
    const { min_surplus_kg = 0.5, min_surplus_ratio = 0.2 } = req.body || {};

    // 1. Get predicted surplus
    const activeGroups = await query(
      `SELECT er.farm_id, er.crop,
              er.data->>'estimated_weight_kg' as estimated_weight_kg,
              er.data->>'estimated_harvest_date' as estimated_harvest_date,
              er.data->>'quality_grade' as quality_grade
       FROM experiment_records er
       WHERE er.status = 'active'
         AND er.data->>'estimated_harvest_date' IS NOT NULL`
    );

    const committedDemand = await query(
      `SELECT product_name as crop, farm_id, SUM((data->>'quantity')::numeric) as committed_qty
       FROM wholesale_orders
       WHERE status IN ('pending', 'confirmed', 'processing')
       GROUP BY product_name, farm_id`
    );

    const demandMap = {};
    for (const d of committedDemand.rows || []) {
      const key = (d.farm_id || '') + ':' + (d.crop || '').toLowerCase();
      demandMap[key] = (demandMap[key] || 0) + (parseFloat(d.committed_qty) || 0);
    }

    // 2. Aggregate surplus by farm+crop
    const surplusMap = {};
    for (const g of activeGroups.rows || []) {
      const crop = (g.crop || '').toLowerCase();
      const farmId = g.farm_id || 'unknown';
      if (!crop) continue;
      const key = farmId + ':' + crop;
      if (!surplusMap[key]) surplusMap[key] = { farm_id: farmId, crop: g.crop, projected_kg: 0, quality_grade: g.quality_grade || 'A' };
      surplusMap[key].projected_kg += parseFloat(g.estimated_weight_kg) || 0;
    }

    const listings = [];
    for (const [key, info] of Object.entries(surplusMap)) {
      const committed = demandMap[key] || 0;
      const surplus = info.projected_kg - committed;
      const ratio = info.projected_kg > 0 ? surplus / info.projected_kg : 0;
      if (surplus < min_surplus_kg || ratio < min_surplus_ratio) continue;

      // 3. Create listing entry
      const listing = {
        farm_id: info.farm_id,
        crop: info.crop,
        available_kg: parseFloat(surplus.toFixed(2)),
        quality_grade: info.quality_grade,
        source: 'auto_predictive',
        listed_at: new Date().toISOString()
      };

      // 4. Try to get dynamic pricing
      try {
        const pricingResult = await query(
          `SELECT data->>'suggested_price' as price FROM farm_data
           WHERE farm_id = $1 AND data_type = 'dynamic_pricing'
           ORDER BY updated_at DESC LIMIT 1`,
          [info.farm_id]
        );
        if (pricingResult.rows?.[0]?.price) {
          listing.price_per_kg = parseFloat(pricingResult.rows[0].price);
        }
      } catch (_) {}

      listings.push(listing);

      // 5. Upsert into wholesale catalog
      try {
        await query(
          `INSERT INTO farm_data (farm_id, data_type, data, updated_at)
           VALUES ($1, 'auto_listing', $2::jsonb, NOW())
           ON CONFLICT (farm_id, data_type)
           DO UPDATE SET data = farm_data.data || $2::jsonb, updated_at = NOW()`,
          [info.farm_id, JSON.stringify({ listings: [listing] })]
        );
      } catch (dbErr) {
        console.warn('[auto-list] DB write skipped for', info.farm_id, ':', dbErr.message);
      }
    }

    console.log('[auto-list] Generated ' + listings.length + ' auto-listings from predicted surplus');
    res.json({ success: true, listings, count: listings.length, generated_at: new Date().toISOString() });
  } catch (error) {
    console.error('[auto-list] Error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Auto-listing scheduler: runs daily to scan for surplus and create listings.
 */
(function wireAutoListingScheduler() {
  const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
  setInterval(async () => {
    try {
      console.log('[auto-list] Running daily surplus scan...');
      const activeGroups = await query(
        `SELECT er.farm_id, er.crop,
                er.data->>'estimated_weight_kg' as estimated_weight_kg
         FROM experiment_records er WHERE er.status = 'active'
           AND er.data->>'estimated_harvest_date' IS NOT NULL`
      );
      const committedDemand = await query(
        `SELECT product_name as crop, farm_id, SUM((data->>'quantity')::numeric) as committed_qty
         FROM wholesale_orders WHERE status IN ('pending', 'confirmed', 'processing')
         GROUP BY product_name, farm_id`
      );
      const demandMap = {};
      for (const d of committedDemand.rows || []) {
        const key = (d.farm_id || '') + ':' + (d.crop || '').toLowerCase();
        demandMap[key] = (demandMap[key] || 0) + (parseFloat(d.committed_qty) || 0);
      }
      let autoListCount = 0;
      const surplusMap = {};
      for (const g of activeGroups.rows || []) {
        const crop = (g.crop || '').toLowerCase();
        const farmId = g.farm_id || 'unknown';
        if (!crop) continue;
        const key = farmId + ':' + crop;
        if (!surplusMap[key]) surplusMap[key] = { farm_id: farmId, crop: g.crop, projected_kg: 0 };
        surplusMap[key].projected_kg += parseFloat(g.estimated_weight_kg) || 0;
      }
      for (const [key, info] of Object.entries(surplusMap)) {
        const committed = demandMap[key] || 0;
        const surplus = info.projected_kg - committed;
        if (surplus < 0.5) continue;
        autoListCount++;
        try {
          await query(
            `INSERT INTO farm_data (farm_id, data_type, data, updated_at)
             VALUES ($1, 'auto_listing', $2::jsonb, NOW())
             ON CONFLICT (farm_id, data_type)
             DO UPDATE SET data = $2::jsonb, updated_at = NOW()`,
            [info.farm_id, JSON.stringify({ listings: [{ farm_id: info.farm_id, crop: info.crop, available_kg: parseFloat(surplus.toFixed(2)), source: 'auto_predictive', listed_at: new Date().toISOString() }] })]
          );
        } catch (_) {}
      }
      console.log('[auto-list] Daily scan complete: ' + autoListCount + ' auto-listings generated');
    } catch (err) {
      console.warn('[auto-list] Daily scan failed (non-fatal):', err?.message);
    }
  }, TWENTY_FOUR_HOURS);
  console.log('[auto-list] Daily surplus scanner wired');
})();

  }
});


            // Grant wizard (enabled by default)
      if (seedGrantPrograms) {
        const grantPool = getDatabase();
        await seedGrantPrograms(grantPool).catch(e => logger.warn('Grant seed skipped', { error: e.message }));
        startGrantProgramSync(grantPool);
        setInterval(() => cleanupExpiredApplications(grantPool).catch(e => logger.warn('Grant cleanup error', { error: e.message })), 6 * 60 * 60 * 1000);
        logger.info('Grant wizard enabled (AI drafting + PDF export available)');
      }
      
      // Start deadline monitor for wholesale orders (disabled in standalone deployment)
      // logger.info('Starting deadline monitor service...');
      // deadlineMonitor.start();
    } else {
      logger.warn('Skipping background services (database not ready)');
    }

    // Wholesale network sync (DB optional)
    startWholesaleNetworkSync(app);

    // Load persisted buyers and payments into memory on startup
    try {
      const { loadBuyersFromDb, loadPaymentsFromDb, loadRefundsFromDb } = await import('./services/wholesaleMemoryStore.js');
      await loadBuyersFromDb();
      await loadPaymentsFromDb();
      await loadRefundsFromDb();
    } catch (e) {
      logger.warn('Buyer/Payment DB load skipped:', e.message);
    }

    // Graceful shutdown
    const shutdown = async (signal) => {
      logger.info(`${signal} received, shutting down gracefully...`);
      
      server.close(() => {
        logger.info('HTTP server closed');
      });

      wss.close(() => {
        logger.info('WebSocket server closed');
      });

      stopHealthCheckService();

      if (typeof app.locals.stopWholesaleNetworkSync === 'function') {
        app.locals.stopWholesaleNetworkSync();
      }

      // Close database connections
      // await closeDatabase();
      
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

  } catch (error) {
    logger.error('Failed to start server', { error: error.message, stack: error.stack });
    process.exit(1);
  }
}

// Start the server
startServer();

export default app;
