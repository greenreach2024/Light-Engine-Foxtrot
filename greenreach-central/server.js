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

// Import routes
import farmRoutes from './routes/farms.js';
import authRoutes from './routes/auth.js';
import monitoringRoutes from './routes/monitoring.js';
import inventoryRoutes from './routes/inventory.js';
import ordersRoutes from './routes/orders.js';
import alertsRoutes from './routes/alerts.js';
import syncRoutes from './routes/sync.js';
import { hydrateFromDatabase, getInMemoryStore } from './routes/sync.js';
import wholesaleRoutes from './routes/wholesale.js';
import squareOAuthProxyRoutes from './routes/square-oauth-proxy.js';
// NOTE: farm-stripe-setup.js lives at root level and can't resolve express
// from greenreach-central/node_modules. Stripe setup should proxy to farm server.
import adminRoutes from './routes/admin.js';
import adminRecipesRoutes from './routes/admin-recipes.js';
import reportsRoutes from './routes/reports.js';
import farmSettingsRoutes from './routes/farm-settings.js';
import recipesRoutes from './routes/recipes.js';
import aiInsightsRoutes from './routes/ai-insights.js';
import envProxyRoutes from './routes/env-proxy.js';
import discoveryProxyRoutes from './routes/discovery-proxy.js';
import mlForecastRoutes from './routes/ml-forecast.js';
import billingRoutes from './routes/billing.js';
import procurementAdminRoutes from './routes/procurement-admin.js';
import remoteSupportRoutes from './routes/remote-support.js';
import plantingRoutes from './routes/planting.js';
import planningRoutes from './routes/planning.js';
import marketIntelligenceRoutes from './routes/market-intelligence.js';
import cropPricingRoutes from './routes/crop-pricing.js';

// Phase 2 — Cloud SaaS API gap routes
import farmUsersRouter, { userRouter, deviceTokenRouter } from './routes/farm-users.js';
import farmSalesRouter from './routes/farm-sales.js';
import networkGrowersRouter from './routes/network-growers.js';
import experimentRecordsRouter, { startBenchmarkScheduler } from './routes/experiment-records.js';
import wholesaleFulfillmentRouter from './routes/wholesale-fulfillment.js';
import wholesaleExportsRouter from './routes/wholesale-exports.js';
import miscStubsRouter from './routes/misc-stubs.js';

// Grant wizard — enabled by default (set ENABLE_GRANT_WIZARD=false to disable)
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
import { errorHandler } from './middleware/errorHandler.js';
import { requestLogger } from './middleware/logger.js';
import { authMiddleware } from './middleware/auth.js';
import { farmDataMiddleware, farmDataWriteMiddleware } from './middleware/farm-data.js';

// Phase 3 — Unified tenant-scoped data access layer
import { farmStore, initFarmStore } from './lib/farm-data-store.js';

// Import services
import { initDatabase, getDatabase, query, isDatabaseAvailable } from './config/database.js';
import { startHealthCheckService } from './services/healthCheck.js';
import { startSyncMonitor } from './services/syncMonitor.js';
import { startWholesaleNetworkSync } from './services/wholesaleNetworkSync.js';
import { seedDemoFarm } from './services/seedDemoFarm.js';
import { startAIPusher } from './services/ai-recommendations-pusher.js';
import { detectHarvestConflicts, analyzeSupplyDemand, generateNetworkRiskAlerts } from './jobs/supply-demand-balancer.js';
import { initExperimentTables, createExperiment, activateExperiment, recordObservation, analyzeExperiment, completeExperiment, listExperiments, getExperiment, getExperimentsForFarm } from './jobs/experiment-orchestrator.js';
import { generateWeeklyPlan, generateAndDistributePlan, gatherDemandForecast, getNetworkSupply } from './jobs/production-planner.js';
import { generateGovernanceReport, formatReportText } from './reports/governance-review.js';
// import deadlineMonitor from '../services/deadline-monitor.js'; // Not available in standalone deployment
import logger from './utils/logger.js';
import { upsertNetworkFarm } from './services/networkFarmsStore.js';

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

// Security middleware
// Note: the current standalone UI pages include inline <script> and inline event handlers.
// Configure CSP to allow inline scripts for public pages while maintaining security.
const isProduction = process.env.NODE_ENV === 'production';
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://unpkg.com", "https://web.squarecdn.com", "https://www.googletagmanager.com", "https://www.google-analytics.com", "https://code.responsivevoice.org"],
      scriptSrcAttr: ["'unsafe-inline'"],  // Allow inline event handlers (onclick, etc.)
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https:", "wss:", "https://connect.squareup.com", "https://pci-connect.squareup.com", "https://connect.stripe.com", "https://api.stripe.com", "https://www.google-analytics.com", "https://analytics.google.com", "https://code.responsivevoice.org"],
      fontSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'self'", "https://web.squarecdn.com", "https://connect.stripe.com"],  // Allow Square + Stripe iframes
      upgradeInsecureRequests: null
    },
  },
}));

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
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(farmDataWriteMiddleware(_inMemoryStore)); // PUT /data/*.json → DB
app.use(farmDataMiddleware(_inMemoryStore));       // GET /data/*.json → DB

// Inject farmStore into every request for route files
app.use((req, _res, next) => { req.farmStore = farmStore; next(); });

// ── Phase 4: Auto-inject api-config.js + auth-guard.js into all HTML responses ──
// Serves HTML pages with injected config/auth scripts so every page gets
// environment detection + the enhanced fetch wrapper without editing 160+ files.
// Non-HTML requests fall through to express.static below.
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
app.use(express.static(path.join(__dirname, 'public')));
// Fallback to root public directory for shared assets
app.use(express.static(path.join(__dirname, '..', 'public')));

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
const SYNC_DATA_FILES = ['groups.json', 'rooms.json', 'farm.json', 'iot-devices.json', 'room-map.json', 'env.json'];

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

    const totalPlants = Number(group?.plants || 0);
    const plantCountPerTray = Math.max(1, Math.round((totalPlants > 0 ? totalPlants : trayCount * 12) / trayCount));
    const planId = group?.plan || group?.planId || null;
    const recipeName = group?.recipe || group?.crop || extractCropNameFromPlanId(planId);

    const seedDateRaw = group?.planConfig?.anchor?.seedDate;
    const seedDate = seedDateRaw ? new Date(seedDateRaw) : null;
    const daysOld = seedDate && !Number.isNaN(seedDate.getTime())
      ? Math.max(1, getDaysBetween(seedDate, now) + 1)
      : 1;

    const currentDay = daysOld;
    const daysToHarvest = Math.max(0, fallbackGrowthDays - currentDay);
    const estimatedHarvestDateObj = new Date(now);
    estimatedHarvestDateObj.setDate(estimatedHarvestDateObj.getDate() + daysToHarvest);

    const roomLabel = group?.roomId || group?.room || 'ROOM-1';
    const zoneLabel = group?.zoneId || (group?.zone != null ? `ZONE-${group.zone}` : 'ZONE-1');
    const location = `${roomLabel} - ${zoneLabel}`;

    for (let index = 0; index < trayCount; index += 1) {
      syntheticTrays.push({
        trayId: `${groupId}#${index + 1}`,
        groupId,
        recipe: recipeName,
        plan: planId,
        plantCount: plantCountPerTray,
        currentDay,
        daysOld,
        daysToHarvest,
        harvestIn: daysToHarvest,
        seedingDate: seedDate && !Number.isNaN(seedDate.getTime()) ? seedDate.toISOString() : null,
        estimatedHarvestDate: formatDateYYYYMMDD(estimatedHarvestDateObj),
        location,
        status: group?.active === false ? 'inactive' : 'active'
      });
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

function resolveEdgeUrl() {
  // Env var override takes priority (works around broken Tailscale IPs in farm.json)
  if (process.env.FARM_EDGE_URL) return process.env.FARM_EDGE_URL;
  
  const farmJsonPath = path.join(FARM_DATA_DIR, 'farm.json');
  if (!fs.existsSync(farmJsonPath)) return null;
  
  try {
    const farmData = JSON.parse(fs.readFileSync(farmJsonPath, 'utf8'));
    return farmData.url || null;
  } catch { return null; }
}

/**
 * Sync farm identity from edge device to the farms DB row.
 * Does NOT write to the local farm.json file — only updates the database.
 * Called alongside syncFarmData() on the same interval.
 */
async function syncFarmIdentity(edgeUrl) {
  if (!edgeUrl) edgeUrl = resolveEdgeUrl();
  if (!edgeUrl) return { ok: false, reason: 'no_edge_url' };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const response = await fetch(`${edgeUrl}/data/farm.json`, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) {
      logger.warn(`[SyncIdentity] Failed to fetch farm.json from ${edgeUrl}: ${response.status}`);
      return { ok: false, reason: 'fetch_failed' };
    }

    const farmData = await response.json();
    const farmId = farmData.farmId;
    if (!farmId) {
      logger.warn('[SyncIdentity] Edge farm.json has no farmId');
      return { ok: false, reason: 'no_farm_id' };
    }

    const { query: dbQuery, isDatabaseAvailable } = await import('./config/database.js');
    if (!await isDatabaseAvailable()) {
      return { ok: false, reason: 'db_unavailable' };
    }

    // Update farms DB row with current identity from edge
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
      `INSERT INTO farms (farm_id, name, email, api_url, metadata, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, 'active', NOW(), NOW())
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
      logger.warn(`[${syncLabel}] No edge URL configured (set FARM_EDGE_URL env var or farm.json url)`);
      return { ok: false, reason: 'no_edge_url' };
    }
    
    logger.info(`[${syncLabel}] Syncing data from edge device: ${edgeUrl}`);
    let updated = 0;
    let errors = 0;
    
    for (const file of SYNC_DATA_FILES) {
      if (file === 'farm.json') continue; // Don't overwrite farm.json with edge version
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        const response = await fetch(`${edgeUrl}/data/${file}`, { signal: controller.signal });
        clearTimeout(timeout);
        
        if (response.ok) {
          const data = await response.text();
          const localPath = path.join(FARM_DATA_DIR, file);
          fs.writeFileSync(localPath, data, 'utf8');
          logger.info(`[${syncLabel}] Updated ${file} from edge device`);
          updated++;
        }
      } catch (err) {
        errors++;
        logger.warn(`[${syncLabel}] Could not fetch ${file} from ${edgeUrl}: ${err.message}`);
      }
    }
    
    // Update sync status
    syncStatus.lastSync = new Date().toISOString();
    syncStatus.lastSyncResult = errors === 0 ? 'success' : `partial (${errors} errors)`;
    syncStatus.syncCount++;
    syncStatus.errorCount += errors;
    syncStatus.filesUpdated += updated;
    if (isDaily) syncStatus.lastDailySync = new Date().toISOString();
    
    // After syncing files, store env.json as telemetry in the farm_data DB table
    // so the GET /api/sync/:farmId/telemetry endpoint can return it
    try {
      const envJsonPath = path.join(FARM_DATA_DIR, 'env.json');
      const farmJsonPath = path.join(FARM_DATA_DIR, 'farm.json');
      if (fs.existsSync(envJsonPath) && fs.existsSync(farmJsonPath)) {
        const envData = JSON.parse(fs.readFileSync(envJsonPath, 'utf8'));
        const farmData = JSON.parse(fs.readFileSync(farmJsonPath, 'utf8'));
        const farmId = farmData.farmId;
        if (farmId) {
          const { query: dbQuery, isDatabaseAvailable } = await import('./config/database.js');
          if (await isDatabaseAvailable()) {
            // Store telemetry (env zones)
            if (envData.zones) {
              const telemetryData = {
                zones: envData.zones || [],
                sensors: {},
                timestamp: envData.updatedAt || new Date().toISOString()
              };
              await dbQuery(
                `INSERT INTO farm_data (farm_id, data_type, data, updated_at)
                 VALUES ($1, $2, $3, NOW())
                 ON CONFLICT (farm_id, data_type)
                 DO UPDATE SET data = $3, updated_at = NOW()`,
                [farmId, 'telemetry', JSON.stringify(telemetryData)]
              );
              logger.info(`[${syncLabel}] Stored telemetry (${envData.zones.length} zones) in DB for ${farmId}`);
            }

            // Store groups (always store as flat array so consumers get Array.isArray() = true)
            const groupsPath = path.join(FARM_DATA_DIR, 'groups.json');
            let groupsList = [];
            if (fs.existsSync(groupsPath)) {
              const groupsRaw = JSON.parse(fs.readFileSync(groupsPath, 'utf8'));
              groupsList = Array.isArray(groupsRaw) ? groupsRaw : (groupsRaw.groups || []);
              await dbQuery(
                `INSERT INTO farm_data (farm_id, data_type, data, updated_at)
                 VALUES ($1, 'groups', $2, NOW())
                 ON CONFLICT (farm_id, data_type)
                 DO UPDATE SET data = $2, updated_at = NOW()`,
                [farmId, JSON.stringify(groupsList)]
              );
              logger.info(`[${syncLabel}] Stored groups (${groupsList.length}) for ${farmId}`);
            }

            // Store rooms — preserve canonical format from rooms.json or farm.json
            // NEVER transform zone strings to objects; consumers expect string arrays
            let roomsToStore;
            const roomsPath = path.join(FARM_DATA_DIR, 'rooms.json');
            if (fs.existsSync(roomsPath)) {
              // Prefer rooms.json — it has full room data (zones, category, equipment)
              const roomsRaw = JSON.parse(fs.readFileSync(roomsPath, 'utf8'));
              roomsToStore = Array.isArray(roomsRaw) ? roomsRaw : (roomsRaw.rooms || [roomsRaw]);
            } else if (Array.isArray(farmData.rooms) && farmData.rooms.length > 0) {
              // Fall back to farm.json rooms (slim but correct format)
              roomsToStore = farmData.rooms;
            }
            if (roomsToStore) {
              await dbQuery(
                `INSERT INTO farm_data (farm_id, data_type, data, updated_at)
                 VALUES ($1, 'rooms', $2, NOW())
                 ON CONFLICT (farm_id, data_type)
                 DO UPDATE SET data = $2, updated_at = NOW()`,
                [farmId, JSON.stringify(roomsToStore)]
              );
              logger.info(`[${syncLabel}] Stored rooms (${roomsToStore.length}) for ${farmId}`);
            }

            // Update farms table with name, email, contact, location from farm.json
            // Merge into existing metadata so heartbeat data isn't overwritten
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
            logger.info(`[${syncLabel}] Updated farm metadata for ${farmId}: name="${farmData.name}"`);
          }
        }
      }
    } catch (telErr) {
      logger.warn(`[${syncLabel}] Failed to store synced data in DB:`, telErr.message);
    }

    // Also register this edge farm in the wholesale network store
    // so the aggregator can fetch its inventory
    if (updated > 0) {
      try {
        const farmJsonPath = path.join(FARM_DATA_DIR, 'farm.json');
        if (fs.existsSync(farmJsonPath)) {
          const farmData = JSON.parse(fs.readFileSync(farmJsonPath, 'utf8'));
          const farmId = farmData.farmId;
          if (farmId && edgeUrl) {
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
          }
        }
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
  }, msUntilNext);
}

// Run initial sync after 10 seconds, then at configured interval + daily schedule
setTimeout(() => { syncFarmData(); syncFarmIdentity(); }, 10000);
setInterval(() => { syncFarmData(); syncFarmIdentity(); }, FARM_SYNC_INTERVAL);
scheduleDailySync();

logger.info(`[FarmSync] Sync interval: ${FARM_SYNC_INTERVAL / 1000}s, Daily sync hour: ${DAILY_SYNC_HOUR}:00`);

// Manual sync endpoint
app.post('/api/sync/pull-farm-data', async (req, res) => {
  try {
    const result = await syncFarmData({ manual: true });
    res.json({ ok: true, message: 'Farm data sync complete', ...result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// Sync status endpoint
app.get('/api/sync/status', (req, res) => {
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

// CORS configuration - Allow same-origin requests and configured origins
const corsOptions = {
  origin: (origin, callback) => {
    // Allow same-origin requests (no origin header)
    if (!origin) {
      return callback(null, true);
    }
    
    // Allow same-origin requests (when page and API are on same domain)
    const requestHost = origin.replace(/^https?:\/\//, '').replace(/:\d+$/, '');
    const serverHost = (process.env.SERVER_HOST || '').replace(/:\d+$/, '');
    
    if (requestHost === serverHost || origin.includes('elasticbeanstalk.com')) {
      return callback(null, true);
    }
    
    const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [
      'http://localhost:3000',
      'http://localhost:8091',
      'https://greenreachgreens.com'
    ];
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn('[CORS] Rejected origin:', origin);
      callback(null, false); // Reject but don't throw error
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Farm-ID', 'X-API-Key', 'X-Farm-Slug']
};
app.use(cors(corsOptions));

// Body parsing middleware — already mounted earlier (before farmDataWriteMiddleware)\n// so req.body is available for POST/PUT /data/*.json writes.

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
const _JWT_SECRET = process.env.JWT_SECRET || 'greenreach-jwt-secret-2025';

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
      req.farmAuth = { method: 'jwt', role: payload.role, email: payload.email };
      return next();
    } catch (_) { /* fall through */ }
  }

  // 2. API key header
  if (req.headers['x-farm-id']) {
    req.farmId = req.headers['x-farm-id'];
    req.farmAuth = { method: 'api-key' };
    return next();
  }

  // 3. Subdomain slug (cloud SaaS mode)
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

  // 4. Env default (single-farm mode)
  req.farmId = process.env.FARM_ID || null;
  req.farmAuth = { method: 'default' };
  next();
});

// Rate limiting - increased limits for dashboard usage
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 500, // 500 requests per 15 min
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting for debug/tracking endpoints (logging only)
    return req.path.startsWith('/api/debug/') || req.path.startsWith('/api/sync/');
  }
});
app.use('/api/', limiter);

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
app.get('/api/admin/farms/:farmId/slug', async (req, res) => {
  try {
    if (!(await isDatabaseAvailable())) return res.status(503).json({ error: 'Database unavailable' });
    const { rows } = await query('SELECT slug FROM farms WHERE farm_id = $1', [req.params.farmId]);
    if (!rows.length) return res.status(404).json({ error: 'Farm not found' });
    res.json({ farm_id: req.params.farmId, slug: rows[0].slug });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/admin/farms/:farmId/slug', async (req, res) => {
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

// Legacy compatibility routes used by existing farm/admin pages
app.get('/env', async (req, res) => {
  try {
    const data = await farmStore.get(farmStore.farmIdFromReq(req), 'telemetry');
    return res.status(200).json(data || { zones: [] });
  } catch (error) {
    logger.warn('[Compat] /env fallback failed:', error.message);
    return res.status(200).json({ zones: [] });
  }
});

app.get('/api/env', async (req, res) => {
  try {
    const data = await farmStore.get(farmStore.farmIdFromReq(req), 'telemetry');
    return res.status(200).json(data || { zones: [] });
  } catch (error) {
    logger.warn('[Compat] /api/env fallback failed:', error.message);
    return res.status(200).json({ zones: [] });
  }
});

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

app.get('/plans', async (req, res) => {
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

app.get('/api/farm/profile', async (req, res) => {
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

app.get('/farm', async (req, res) => {
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

app.post('/farm', async (req, res) => {
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

app.get('/api/setup/data', async (req, res) => {
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

app.post('/api/setup/save-rooms', async (req, res) => {
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

app.get('/api/reverse-geocode', (req, res) => {
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

app.get('/forwarder/network/wifi/scan', (_req, res) => {
  return res.json({
    ok: true,
    networks: [
      { ssid: 'Farm-WiFi', signal: -52, security: 'WPA2' },
      { ssid: 'Farm-Guest', signal: -67, security: 'WPA2' }
    ]
  });
});

app.get('/forwarder/network/scan', (_req, res) => {
  return res.json({
    ok: true,
    devices: []
  });
});

app.get('/api/admin/farms/:farmId/devices', async (req, res) => {
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

app.get('/api/audit/recent', (_req, res) => {
  return res.json({ ok: true, activities: [] });
});

app.get('/api/activity-hub/orders/pending', (_req, res) => {
  return res.json({ ok: true, orders: [] });
});

app.get('/api/inventory/dashboard', async (_req, res) => {
  return res.json({
    ok: true,
    total_value: 0,
    alerts_by_category: {
      seeds: [],
      nutrients: [],
      packaging: [],
      equipment: [],
      supplies: []
    }
  });
});

app.get('/api/inventory/reorder-alerts', (_req, res) => {
  return res.json({ ok: true, alerts: [] });
});

app.get('/api/inventory/usage/weekly-summary', (_req, res) => {
  return res.json({
    ok: true,
    summary: {
      seeds_used: {},
      nutrients_used_ml: {},
      grow_media_kg: 0
    }
  });
});

app.get('/api/inventory/seeds/list', (_req, res) => {
  return res.json({ ok: true, seeds: [] });
});

app.get('/api/inventory/nutrients/list', (_req, res) => {
  return res.json({ ok: true, nutrients: [] });
});

app.get('/api/inventory/packaging/list', (_req, res) => {
  return res.json({ ok: true, packaging: [] });
});

app.get('/api/inventory/equipment/list', (_req, res) => {
  return res.json({ ok: true, equipment: [] });
});

app.get('/api/inventory/supplies/list', (_req, res) => {
  return res.json({ ok: true, supplies: [] });
});

// ─── Traceability API proxy (routes requests to the farm's unified traceability API) ─────
import { listNetworkFarms as listTraceFarms } from './services/networkFarmsStore.js';

async function getFirstActiveFarmUrl() {
  try {
    const farms = await listTraceFarms();
    const active = farms.find(f => f.status === 'active' && f.api_url);
    return active ? active.api_url : null;
  } catch { return null; }
}

app.get('/api/traceability', async (req, res) => {
  const farmUrl = await getFirstActiveFarmUrl();
  if (!farmUrl) return res.json({ ok: true, records: [] });
  try {
    const r = await fetch(`${farmUrl}/api/traceability?${new URLSearchParams(req.query)}`, { signal: AbortSignal.timeout(5000) });
    return res.json(await r.json());
  } catch { return res.json({ ok: true, records: [] }); }
});

app.get('/api/traceability/stats', async (req, res) => {
  const farmUrl = await getFirstActiveFarmUrl();
  if (!farmUrl) return res.json({ ok: true, stats: { total_records: 0, active_records: 0, crops_tracked: 0, total_events: 0 } });
  try {
    const r = await fetch(`${farmUrl}/api/traceability/stats`, { signal: AbortSignal.timeout(5000) });
    return res.json(await r.json());
  } catch { return res.json({ ok: true, stats: { total_records: 0, active_records: 0, crops_tracked: 0, total_events: 0 } }); }
});

app.get('/api/traceability/lot/:lotCode', async (req, res) => {
  const farmUrl = await getFirstActiveFarmUrl();
  if (!farmUrl) return res.json({ ok: false, error: 'No farm connected' });
  try {
    const r = await fetch(`${farmUrl}/api/traceability/lot/${req.params.lotCode}`, { signal: AbortSignal.timeout(5000) });
    return res.json(await r.json());
  } catch (e) { return res.status(502).json({ ok: false, error: e.message }); }
});

app.get('/api/traceability/sfcr-export', async (req, res) => {
  const farmUrl = await getFirstActiveFarmUrl();
  if (!farmUrl) return res.json({ ok: false, error: 'No farm connected' });
  try {
    const r = await fetch(`${farmUrl}/api/traceability/sfcr-export?${new URLSearchParams(req.query)}`, { signal: AbortSignal.timeout(10000) });
    const ct = r.headers.get('content-type');
    if (ct) res.set('content-type', ct);
    const cd = r.headers.get('content-disposition');
    if (cd) res.set('content-disposition', cd);
    const body = await r.text();
    return res.send(body);
  } catch (e) { return res.status(502).json({ ok: false, error: e.message }); }
});

app.get('/api/sustainability/esg-report', (_req, res) => {
  return res.json({
    ok: true,
    esg_score: {
      total_score: 0,
      grade: 'N/A',
      breakdown: { energy: 0, water: 0, nutrients: 0, waste: 0, carbon: 0 },
      metrics: { renewable_energy_percent: 0, water_recycling_percent: 0, waste_diversion_percent: 0 }
    }
  });
});

app.get('/api/sustainability/energy/usage', (_req, res) => {
  return res.json({ ok: true, total_kwh: 0, by_source: {}, total_carbon_kg: 0, total_cost_cad: 0 });
});

app.get('/api/sustainability/water/usage', (_req, res) => {
  return res.json({ ok: true, total_liters_used: 0, average_efficiency_percent: 0, total_liters_recycled: 0 });
});

app.get('/api/sustainability/carbon-footprint', (_req, res) => {
  return res.json({ ok: true, total_carbon_kg: 0, daily_average_kg: 0 });
});

app.get('/api/sustainability/waste/tracking', (_req, res) => {
  return res.json({ ok: true, total_waste_kg: 0, diversion_rate_percent: 0, total_diverted_kg: 0 });
});

app.get('/api/sustainability/trends', (_req, res) => {
  return res.json({ ok: true, trends: [] });
});

app.get('/api/automation/rules', (_req, res) => {
  return res.json({ success: true, rules: [] });
});

app.get('/api/automation/history', (_req, res) => {
  return res.json({ success: true, history: [] });
});

app.get('/api/schedule-executor/status', (_req, res) => {
  return res.json({
    success: true,
    enabled: false,
    message: 'Schedule executor compatibility mode',
    running: false
  });
});

app.get('/api/schedule-executor/ml-anomalies', (_req, res) => {
  return res.json({ success: true, anomalies: [], count: 0 });
});

app.get('/api/ml/anomalies/statistics', (_req, res) => {
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

app.get('/api/ml/energy-forecast', (_req, res) => {
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

app.get('/api/ml/insights/forecast/:zone', (_req, res) => {
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

app.get('/api/health/insights', async (req, res) => {
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

app.get('/api/health/vitality', async (req, res) => {
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

app.get('/api/ai/status', (_req, res) => {
  return res.json({
    engine: { type: 'rules' },
    progress: {
      overall_readiness_pct: 0,
      decisions: { total: 0, acceptance_rate: 0 },
      crop_cycles: { total: 0 }
    },
    timeline: { days_remaining: 0 },
    ml: { ready: false }
  });
});

app.get('/api/inventory/current', async (req, res) => {
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

app.get('/api/inventory/forecast', async (req, res) => {
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

app.get('/api/tray-formats', async (req, res) => {
  try {
    const fid = farmStore.farmIdFromReq(req);
    const formats = await farmStore.get(fid, 'tray_formats') || [];
    return res.json(Array.isArray(formats) ? formats : []);
  } catch (error) {
    logger.warn('[Compat] /api/tray-formats GET failed:', error.message);
    return res.json([]);
  }
});

app.post('/api/tray-formats', async (req, res) => {
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

app.put('/api/tray-formats/:formatId', async (req, res) => {
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

app.delete('/api/tray-formats/:formatId', async (req, res) => {
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

app.get('/api/trays', async (req, res) => {
  try {
    const fid = farmStore.farmIdFromReq(req);
    const trays = await farmStore.get(fid, 'trays') || [];
    return res.json(Array.isArray(trays) ? trays : []);
  } catch (error) {
    logger.warn('[Compat] /api/trays GET failed:', error.message);
    return res.json([]);
  }
});

app.post('/api/trays/register', async (req, res) => {
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

app.get('/data/room-map.json', async (req, res) => {
  const fid = farmStore.farmIdFromReq(req);
  const payload = await farmStore.get(fid, 'room_map') || { zones: [], devices: [] };
  return res.json(payload);
});

app.get('/data/room-map-:roomId.json', async (req, res) => {
  const fid = farmStore.farmIdFromReq(req);
  const roomId = String(req.params.roomId || '').trim();
  // Try room-specific map first (stored as room_map with room ID embedded)
  const roomSpecificName = roomId ? `room-map-${roomId}.json` : 'room-map.json';
  const roomSpecific = await farmStore.getGlobal(roomSpecificName);
  if (roomSpecific) {
    return res.json(roomSpecific);
  }

  const generic = await farmStore.get(fid, 'room_map') || { zones: [], devices: [] };
  return res.json(generic);
});

app.get('/api/weather', (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ ok: false, error: 'lat and lng are required' });
  }

  return res.json({
    ok: true,
    current: {
      temperature_c: 22,
      temperature_f: 72,
      humidity: 55,
      description: 'Clear'
    }
  });
});

app.get('/configuration', async (req, res) => {
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

app.get('/api/farm/configuration', async (req, res) => {
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

app.post('/api/farm/configuration', async (req, res) => {
  try {
    const fid = farmStore.farmIdFromReq(req);
    await farmStore.set(fid, 'config', req.body || {});
    return res.json({ success: true });
  } catch (error) {
    logger.warn('[Compat] /api/farm/configuration write failed:', error.message);
    return res.status(500).json({ success: false, error: 'Failed to save configuration' });
  }
});

app.get('/devices', async (req, res) => {
  try {
    const fid = farmStore.farmIdFromReq(req);
    const devices = await farmStore.get(fid, 'devices') || [];
    return res.json({ devices: Array.isArray(devices) ? devices : [] });
  } catch (error) {
    logger.warn('[Compat] /devices fallback failed:', error.message);
    return res.json({ devices: [] });
  }
});

app.post('/devices', async (req, res) => {
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

app.patch('/devices/:deviceId', async (req, res) => {
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
app.get('/api/groups', async (req, res) => {
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

app.get('/api/rooms', async (req, res) => {
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

// Edge-compatible login: /api/farm/auth/login
// Translates edge format { farmId } → central format { farm_id }
// and response { success } → { status: 'success' }
app.post('/api/farm/auth/login', (req, res, next) => {
  const { farmId, email, password } = req.body;
  // Rewrite to central field names
  req.body = { farm_id: farmId, email, password };
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
        planType: data.planType || 'cloud'
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
app.use('/api/farms', farmRoutes);
app.use('/api/farm', farmRoutes); // Singular route for profile endpoint
app.use('/api/setup-wizard', setupWizardRoutes); // First-time farm setup wizard
app.use('/api/setup', setupWizardRoutes); // Legacy setup API alias used by dashboard/app.foxtrot
app.use('/api/monitoring', authMiddleware, monitoringRoutes);

// Path alias: frontend calls /api/inventory/tray-formats but handler is at /api/tray-formats
app.get('/api/inventory/tray-formats', (req, res) => { res.redirect(307, '/api/tray-formats'); });

app.use('/api/inventory', authMiddleware, inventoryRoutes);
app.use('/api/orders', authMiddleware, ordersRoutes);
app.use('/api/alerts', authMiddleware, alertsRoutes);
app.use('/api/sync', syncRoutes); // Farms authenticate via API key
app.use('/api/farm-settings', farmSettingsRoutes); // Cloud-to-edge settings sync (API key auth)
app.use('/api/recipes', recipesRoutes); // Public recipes API
app.use('/api/wholesale', wholesaleRoutes); // Re-enabled with stubbed Square service
app.use('/api/square-proxy', squareOAuthProxyRoutes); // Square OAuth proxy to farms
// Stripe setup proxied to farm server (root-level routes can't resolve express from central node_modules)
app.use('/api/admin', adminRoutes); // Admin dashboard API
app.use('/api/admin/recipes', adminRecipesRoutes); // Admin recipes management
app.use('/api/reports', reportsRoutes); // Financial exports and reports
app.use('/api/ai-insights', aiInsightsRoutes); // GPT-4 powered AI insights
app.use('/api/env', envProxyRoutes); // Environmental data proxy to farm devices
app.use('/discovery/devices', discoveryProxyRoutes); // Device discovery proxy to farm devices
app.use('/api/discovery/devices', discoveryProxyRoutes); // API alias for discovery proxy
app.use('/api/ml/insights', mlForecastRoutes); // ML temperature forecast (edge feature)
app.use('/api/billing', billingRoutes); // Billing usage (cloud)
app.use('/api/procurement', authMiddleware, procurementAdminRoutes); // GRC catalog & suppliers
app.use('/api/remote', remoteSupportRoutes); // Remote support / diagnostics proxy to farms
app.use('/api/planting', authMiddleware, plantingRoutes); // Planting scheduler recommendations with market intelligence
app.use('/api/planning', planningRoutes); // Production planning (integrates market + crop pricing)
app.use('/api/market-intelligence', marketIntelligenceRoutes); // North American market data + price alerts
app.use('/api/crop-pricing', cropPricingRoutes); // Farm-specific crop pricing

// ─── Crop Weight Analytics (cross-farm aggregation) ────────────────────
import { listNetworkFarms as listWeightNetworkFarms } from './services/networkFarmsStore.js';

app.get('/api/crop-weights/network-analytics', async (req, res) => {
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
app.use('/api', networkGrowersRouter);                       // /api/network/*, /api/growers/*, /api/contracts/*, /api/farms/list
app.use('/api', experimentRecordsRouter);                    // /api/sync/experiment-records, /api/experiment-records, /api/crop-benchmarks
app.use('/api/wholesale', wholesaleFulfillmentRouter);       // /api/wholesale/order-statuses, tracking, events
app.use('/api/wholesale/exports', wholesaleExportsRouter);   // /api/wholesale/exports/orders, payments, tax-summary

// Phase 2 Task 2.8: Demand analysis endpoint
app.get('/api/wholesale/demand-analysis', async (req, res) => {
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

app.use('/', miscStubsRouter);                               // Misc stubs + path aliases (full /api/* paths)

// ── Phase 4 Ticket 4.2: Harvest schedule conflict detection ────────────
app.get('/api/network/harvest-conflicts', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 14;
    const conflicts = await detectHarvestConflicts(days);
    res.json({ ok: true, look_ahead_days: days, conflicts, count: conflicts.length });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ── Phase 4 Ticket 4.3: Supply/demand balance analysis ────────────────
app.get('/api/network/supply-demand', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const analysis = await analyzeSupplyDemand(days);
    res.json({ ok: true, ...analysis });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get('/api/network/risk-alerts', async (req, res) => {
  try {
    const alerts = await generateNetworkRiskAlerts();
    res.json({ ok: true, alerts, count: alerts.length });
  } catch (error) {
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

// Initialize database and start server
async function startServer() {
  try {
    // Initialize database connection (optional in local/dev)
    logger.info('Initializing database connection...');
    try {
      await initDatabase();
      app.locals.databaseReady = true;
      logger.info('Database connected successfully');
      
      // Hydrate in-memory Maps from farm_data table (multi-tenant SaaS)
      const hydrationResult = await hydrateFromDatabase();
      if (hydrationResult.hydrated) {
        logger.info(`[SaaS] Hydrated ${hydrationResult.datasets} datasets for ${hydrationResult.farms} farm(s)`);
      }
      
      // Seed demo farm data in development
      if (process.env.NODE_ENV !== 'production') {
        await seedDemoFarm();
      }
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

    // Setup WebSocket server for real-time updates
    const wss = new WebSocketServer({ port: WS_PORT });
    logger.info(`WebSocket server running on port ${WS_PORT}`);

    wss.on('connection', (ws, req) => {
      logger.info('New WebSocket connection established');
      
      // Send welcome message
      ws.send(JSON.stringify({
        type: 'connection',
        message: 'Connected to GreenReach Central',
        timestamp: new Date().toISOString()
      }));

      // Handle incoming messages
      ws.on('message', (message) => {
        try {
          const data = JSON.parse(message);
          logger.debug('WebSocket message received', { type: data.type });
          
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
        logger.info('WebSocket connection closed');
      });

      ws.on('error', (error) => {
        logger.error('WebSocket error', { error: error.message });
      });
    });

    // Store WebSocket server for use in other modules
    app.locals.wss = wss;

    // Start background services (require DB)
    if (app.locals.databaseReady) {
      logger.info('Starting background services...');
      startHealthCheckService(app);
      startSyncMonitor(app);
      startAIPusher(); // AI recommendations pusher (GPT-4)
      startBenchmarkScheduler(); // AI Vision Phase 1: nightly crop benchmark aggregation

      // Phase 4: Initialize A/B experiment tables
      try {
        await initExperimentTables();
        logger.info('A/B experiment tables initialized');
      } catch (expErr) {
        logger.warn('A/B experiment table init failed (non-fatal)', { error: expErr.message });
      }

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
      const { loadBuyersFromDb, loadPaymentsFromDb } = await import('./services/wholesaleMemoryStore.js');
      await loadBuyersFromDb();
      await loadPaymentsFromDb();
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
