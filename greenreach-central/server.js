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
import wholesaleRoutes from './routes/wholesale.js';
import squareOAuthProxyRoutes from './routes/square-oauth-proxy.js';
import adminRoutes from './routes/admin.js';
import adminRecipesRoutes from './routes/admin-recipes.js';
import reportsRoutes from './routes/reports.js';
import farmSettingsRoutes from './routes/farm-settings.js';
import recipesRoutes from './routes/recipes.js';
import aiInsightsRoutes from './routes/ai-insights.js';
import envProxyRoutes from './routes/env-proxy.js';
import mlForecastRoutes from './routes/ml-forecast.js';
import billingRoutes from './routes/billing.js';
import procurementAdminRoutes from './routes/procurement-admin.js';
import remoteSupportRoutes from './routes/remote-support.js';
import traySetupRoutes from './routes/tray-setup.js';

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

// Import services
import { initDatabase, getDatabase } from './config/database.js';
import { startHealthCheckService } from './services/healthCheck.js';
import { startSyncMonitor } from './services/syncMonitor.js';
import { startWholesaleNetworkSync } from './services/wholesaleNetworkSync.js';
import { seedDemoFarm } from './services/seedDemoFarm.js';
import { startAIPusher } from './services/ai-recommendations-pusher.js';
// import deadlineMonitor from '../services/deadline-monitor.js'; // Not available in standalone deployment
import logger from './utils/logger.js';
import { upsertNetworkFarm } from './services/networkFarmsStore.js';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

// Security middleware
// Note: the current standalone UI pages include inline <script> and inline event handlers.
// Configure CSP to allow inline scripts for public pages while maintaining security.
const isProduction = process.env.NODE_ENV === 'production';
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://web.squarecdn.com", "https://www.googletagmanager.com", "https://www.google-analytics.com"],
      scriptSrcAttr: ["'unsafe-inline'"],  // Allow inline event handlers (onclick, etc.)
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https:", "https://connect.squareup.com", "https://pci-connect.squareup.com", "https://www.google-analytics.com", "https://analytics.google.com"],
      fontSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'self'", "https://web.squarecdn.com"],  // Allow Square payment iframes
      upgradeInsecureRequests: null
    },
  },
}));

// Canonical farm login URL
app.get(['/login', '/login.html'], (req, res) => {
  res.redirect(302, '/farm-admin-login.html');
});

// Static UI (Wholesale portal + Central Admin UI)
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

            // Store rooms — prefer farm.json rooms (authoritative, never overwritten by edge sync)
            // enriched with zone/tray/plant counts from groups
            let roomsToStore;
            if (Array.isArray(farmData.rooms) && farmData.rooms.length > 0) {
              roomsToStore = farmData.rooms.map(room => {
                const roomGroups = groupsList.filter(g => g.room === room.name);
                const zoneNumbers = [...new Set(roomGroups.map(g => g.zone).filter(Boolean))];
                return {
                  id: room.id,
                  name: room.name,
                  type: 'vertical',
                  zones: zoneNumbers.map(z => ({
                    id: `${room.id}-z${z}`,
                    name: `Zone ${z}`,
                    zone: z
                  })),
                  groups: roomGroups.length,
                  trays: roomGroups.reduce((s, g) => s + (g.trays || 0), 0),
                  plants: roomGroups.reduce((s, g) => s + (g.plants || 0), 0)
                };
              });
            } else {
              // Fallback to rooms.json file
              const roomsPath = path.join(FARM_DATA_DIR, 'rooms.json');
              if (fs.existsSync(roomsPath)) {
                const roomsRaw = JSON.parse(fs.readFileSync(roomsPath, 'utf8'));
                roomsToStore = Array.isArray(roomsRaw) ? roomsRaw : (roomsRaw.rooms || [roomsRaw]);
              }
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
setTimeout(() => syncFarmData(), 10000);
setInterval(() => syncFarmData(), FARM_SYNC_INTERVAL);
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
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Farm-ID', 'X-API-Key']
};
app.use(cors(corsOptions));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

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

// Legacy compatibility routes used by existing dashboard pages
app.use('/env', envProxyRoutes);

app.get('/plans', async (req, res) => {
  try {
    const plansPath = path.join(FARM_DATA_DIR, 'plans.json');
    if (fs.existsSync(plansPath)) {
      const raw = await fs.promises.readFile(plansPath, 'utf8');
      const parsed = JSON.parse(raw);
      const plans = Array.isArray(parsed) ? parsed : (parsed?.plans || []);
      return res.json({ plans });
    }

    const schedulesPath = path.join(FARM_DATA_DIR, 'schedules.json');
    if (fs.existsSync(schedulesPath)) {
      const raw = await fs.promises.readFile(schedulesPath, 'utf8');
      const parsed = JSON.parse(raw);
      const plans = parsed?.plans || parsed?.schedules || [];
      return res.json({ plans: Array.isArray(plans) ? plans : [] });
    }

    return res.json({ plans: [] });
  } catch (error) {
    logger.warn('[Compat] /plans fallback failed:', error.message);
    return res.json({ plans: [] });
  }
});

app.get('/api/ai/status', (req, res) => {
  res.json({
    engine: { type: 'rules' },
    progress: { overall_readiness_pct: 0 },
    ml: { ready: false }
  });
});

app.get('/api/farm/profile', async (_req, res) => {
  try {
    const farmPath = path.join(FARM_DATA_DIR, 'farm.json');
    const raw = await fs.promises.readFile(farmPath, 'utf8');
    const farm = JSON.parse(raw);
    const farmId = farm.farmId || farm.farm_id || 'FARM-TEST-WIZARD-001';

    res.json({
      status: 'success',
      farm: {
        farmId,
        name: farm.name || farm.farmName || 'This is Your Farm',
        status: farm.status || 'active',
        metadata: farm,
        rooms: [],
        groups: []
      }
    });
  } catch (error) {
    logger.warn('[Compat] /api/farm/profile fallback failed:', error.message);
    res.status(500).json({ error: 'Failed to load farm profile' });
  }
});

app.get('/data/equipment-metadata', async (_req, res) => {
  try {
    const filePath = path.join(FARM_DATA_DIR, 'equipment-metadata.json');
    const raw = await fs.promises.readFile(filePath, 'utf8');
    res.type('application/json').send(raw);
  } catch {
    res.json({ equipment: [] });
  }
});

app.get('/api/inventory/seeds', (_req, res) => {
  res.json({ success: true, data: [] });
});

app.get('/api/inventory/packaging', (_req, res) => {
  res.json({ success: true, data: [] });
});

app.get('/api/setup-wizard/status', (_req, res) => {
  res.json({ success: true, completed: true, step: 'complete' });
});

app.post('/api/auth/change-password', (_req, res) => {
  res.json({ success: true, message: 'Password change endpoint available' });
});

app.get('/api/wholesale/inventory', (_req, res) => {
  res.json({ lots: [] });
});

app.get('/api/wholesale/farm-performance/alerts', (_req, res) => {
  res.json({ alerts: [] });
});

app.get('/api/wholesale/orders/buyer-review', (_req, res) => {
  res.json({ orders: [] });
});

app.get('/api/wholesale/orders/farm-verify', (_req, res) => {
  res.json({ success: true, orders: [] });
});

app.get('/api/farm/configuration', (_req, res) => {
  res.json({ success: true, configuration: {} });
});

app.get('/api/config/app', (_req, res) => {
  res.json({ success: true, config: {} });
});

app.get('/api/farm-auth/demo-tokens', (_req, res) => {
  res.json({ success: true, tokens: [] });
});

app.get('/api/farm-sales/subscriptions/plans', (_req, res) => {
  res.json({ success: true, plans: [] });
});

app.get('/api/farm-sales/orders', (_req, res) => {
  res.json({ success: true, orders: [] });
});

app.get('/api/farm-sales/ai-agent/status', (_req, res) => {
  res.json({ success: true, status: 'available' });
});

app.post('/api/farm-sales/ai-agent/chat', (req, res) => {
  const message = req.body?.message || 'Hello';
  res.json({ success: true, reply: `AI agent stub response: ${message}` });
});

app.get('/api/farm-sales/inventory', async (req, res) => {
  try {
    const groupsPath = path.join(FARM_DATA_DIR, 'groups.json');
    if (!fs.existsSync(groupsPath)) {
      return res.json({ inventory: [] });
    }

    const raw = await fs.promises.readFile(groupsPath, 'utf8');
    const parsed = JSON.parse(raw);
    const groups = Array.isArray(parsed) ? parsed : (parsed?.groups || []);
    const inventory = groups.map((group) => ({
      sku: group.recipe || group.crop || group.name || 'unknown',
      name: group.name || group.crop || 'Unnamed Group',
      quantity: Number(group.plants || 0),
      trays: Number(group.trays || 0)
    }));

    return res.json({ inventory });
  } catch (error) {
    logger.warn('[Compat] /api/farm-sales/inventory fallback failed:', error.message);
    return res.json({ inventory: [] });
  }
});

app.get('/api/automation/rules', (_req, res) => {
  res.json({ rules: [] });
});

app.get('/api/automation/history', (_req, res) => {
  res.json({ history: [] });
});

app.get('/api/schedule-executor/status', (_req, res) => {
  res.json({ running: false, executionCount: 0, errorCount: 0, interval: 0 });
});

app.get('/api/schedule-executor/ml-anomalies', (_req, res) => {
  res.json({ success: true, anomalies: [] });
});

app.get('/api/health/insights', (_req, res) => {
  res.json({ ok: true, zones: [] });
});

app.get('/api/ml/anomalies/statistics', (_req, res) => {
  res.json({ success: true, total: 0, critical: 0, warning: 0, info: 0 });
});

app.get('/api/ml/energy-forecast', (_req, res) => {
  res.json({ success: true, forecast: [] });
});

app.post('/api/harvest', (_req, res) => {
  res.json({ success: true });
});

app.post('/data/groups', async (req, res) => {
  try {
    const groups = Array.isArray(req.body?.groups) ? req.body.groups : [];
    const groupsPath = path.join(FARM_DATA_DIR, 'groups.json');
    await fs.promises.writeFile(groupsPath, JSON.stringify({ groups }, null, 2));
    res.json({ success: true, count: groups.length });
  } catch (error) {
    logger.warn('[Compat] /data/groups save failed:', error.message);
    res.status(500).json({ success: false, error: 'Failed to save groups' });
  }
});

app.post('/data/groups.json', async (req, res) => {
  try {
    const groups = Array.isArray(req.body?.groups) ? req.body.groups : [];
    const groupsPath = path.join(FARM_DATA_DIR, 'groups.json');
    await fs.promises.writeFile(groupsPath, JSON.stringify({ groups }, null, 2));
    res.json({ success: true, count: groups.length });
  } catch (error) {
    logger.warn('[Compat] /data/groups.json save failed:', error.message);
    res.status(500).json({ success: false, error: 'Failed to save groups' });
  }
});

app.get('/api/planting/recommendations', (_req, res) => {
  res.json({ success: true, recommendations: [] });
});

app.post('/api/planting/recommendations', (_req, res) => {
  res.json({ success: true, recommendations: [] });
});

app.post('/api/planting/feedback', (_req, res) => {
  res.json({ success: true });
});

app.post('/api/ai/record-decision', (_req, res) => {
  res.json({ success: true });
});

app.post('/api/setup/complete', (_req, res) => {
  res.json({ success: true, message: 'Setup completion recorded' });
});

app.post('/api/farms/register', (_req, res) => {
  res.json({ success: true, farmId: `FARM-${Date.now()}` });
});

app.get('/api/farms/verify-id', (req, res) => {
  const farmId = req.query?.farmId || null;
  res.json({ success: true, available: true, farmId });
});

app.post('/api/farms/create-checkout-session', (_req, res) => {
  res.json({ success: true, sessionId: `sess_${Date.now()}`, checkoutUrl: '/purchase-success.html' });
});

app.post('/api/purchase/leads', (_req, res) => {
  res.json({ success: true });
});

app.get('/api/hardware/scan', (_req, res) => {
  res.json({ success: true, devices: [] });
});

app.post('/api/hardware/scan', (_req, res) => {
  res.json({ success: true, devices: [] });
});

app.post('/api/wholesale/checkout/preview', (req, res, next) => {
  if (req.headers.authorization) return next();
  return res.json({
    status: 'error',
    message: 'Authentication required for checkout preview',
    data: { requiresAuth: true }
  });
});

app.post('/api/wholesale/checkout/execute', (req, res, next) => {
  if (req.headers.authorization) return next();
  return res.json({
    status: 'error',
    message: 'Authentication required for checkout execution',
    data: { requiresAuth: true }
  });
});

app.get('/devices', async (req, res) => {
  try {
    const devicesPath = path.join(FARM_DATA_DIR, 'iot-devices.json');
    if (!fs.existsSync(devicesPath)) {
      return res.json({ devices: [] });
    }

    const raw = await fs.promises.readFile(devicesPath, 'utf8');
    const parsed = JSON.parse(raw);
    const devices = parsed?.devices || parsed?.iot_devices || parsed || [];
    return res.json({ devices: Array.isArray(devices) ? devices : [] });
  } catch (error) {
    logger.warn('[Compat] /devices fallback failed:', error.message);
    return res.json({ devices: [] });
  }
});

// API routes
app.use('/api/auth', authRoutes); // Farm authentication
app.use('/api/farms', farmRoutes);
app.use('/api/farm', farmRoutes); // Singular route for profile endpoint
app.use('/api/setup-wizard', setupWizardRoutes); // First-time farm setup wizard
app.use('/api/monitoring', authMiddleware, monitoringRoutes);
app.use('/api/inventory', authMiddleware, inventoryRoutes);
app.use('/api/orders', authMiddleware, ordersRoutes);
app.use('/api/alerts', authMiddleware, alertsRoutes);
app.use('/api/sync', syncRoutes); // Farms authenticate via API key
app.use('/api/farm-settings', farmSettingsRoutes); // Cloud-to-edge settings sync (API key auth)
app.use('/api/recipes', recipesRoutes); // Public recipes API
app.use('/api/wholesale', wholesaleRoutes); // Re-enabled with stubbed Square service
app.use('/api/square-proxy', squareOAuthProxyRoutes); // Square OAuth proxy to farms
app.use('/api/admin', adminRoutes); // Admin dashboard API
app.use('/api/admin/recipes', adminRecipesRoutes); // Admin recipes management
app.use('/api/reports', reportsRoutes); // Financial exports and reports
app.use('/api/ai-insights', aiInsightsRoutes); // GPT-4 powered AI insights
app.use('/api/env', envProxyRoutes); // Environmental data proxy to farm devices
app.use('/api/ml/insights', mlForecastRoutes); // ML temperature forecast (edge feature)
app.use('/api/billing', billingRoutes); // Billing usage (cloud)
app.use('/api/procurement', authMiddleware, procurementAdminRoutes); // GRC catalog & suppliers
app.use('/api/remote', remoteSupportRoutes); // Remote support / diagnostics proxy to farms
app.use('/api', traySetupRoutes); // Tray setup compatibility endpoints
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
