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
import plantingRoutes from './routes/planting.js';
import planningRoutes from './routes/planning.js';
import marketIntelligenceRoutes from './routes/market-intelligence.js';
import cropPricingRoutes from './routes/crop-pricing.js';

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
      connectSrc: ["'self'", "https:", "wss:", "https://connect.squareup.com", "https://pci-connect.squareup.com", "https://www.google-analytics.com", "https://analytics.google.com", "https://code.responsivevoice.org"],
      fontSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'self'", "https://web.squarecdn.com"],  // Allow Square payment iframes
      upgradeInsecureRequests: null
    },
  },
}));

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

async function getInventoryTraysForCompat() {
  const traysDoc = await readDataJsonWithFallback('trays.json', []);
  const traysRaw = Array.isArray(traysDoc) ? traysDoc : (traysDoc?.trays || []);

  if (Array.isArray(traysRaw) && traysRaw.length > 0) {
    return normalizeInventoryTrays(traysRaw);
  }

  const groupsDoc = await readDataJsonWithFallback('groups.json', { groups: [] });
  const groups = Array.isArray(groupsDoc) ? groupsDoc : (groupsDoc?.groups || []);
  const syntheticTrays = buildSyntheticTraysFromGroups(groups);
  return normalizeInventoryTrays(syntheticTrays);
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

// Legacy compatibility routes used by existing farm/admin pages
app.get('/env', async (_req, res) => {
  try {
    const envPath = path.join(FARM_DATA_DIR, 'env.json');
    if (!fs.existsSync(envPath)) {
      return res.status(200).json({ zones: [] });
    }
    const raw = await fs.promises.readFile(envPath, 'utf8');
    const parsed = JSON.parse(raw);
    return res.status(200).json(parsed);
  } catch (error) {
    logger.warn('[Compat] /env fallback failed:', error.message);
    return res.status(200).json({ zones: [] });
  }
});

app.get('/api/env', async (_req, res) => {
  try {
    const envPath = path.join(FARM_DATA_DIR, 'env.json');
    if (!fs.existsSync(envPath)) {
      return res.status(200).json({ zones: [] });
    }
    const raw = await fs.promises.readFile(envPath, 'utf8');
    const parsed = JSON.parse(raw);
    return res.status(200).json(parsed);
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

app.get('/plans', async (_req, res) => {
  try {
    const plansPath = path.join(FARM_DATA_DIR, 'plans.json');
    if (fs.existsSync(plansPath)) {
      const raw = await fs.promises.readFile(plansPath, 'utf8');
      const parsed = JSON.parse(raw);
      const plans = Array.isArray(parsed) ? parsed : (parsed?.plans || []);
      return res.json({ plans: mergeCompatibilityPlans(plans) });
    }

    const schedulesPath = path.join(FARM_DATA_DIR, 'schedules.json');
    if (fs.existsSync(schedulesPath)) {
      const raw = await fs.promises.readFile(schedulesPath, 'utf8');
      const parsed = JSON.parse(raw);
      const plans = parsed?.plans || parsed?.schedules || [];
      return res.json({ plans: mergeCompatibilityPlans(Array.isArray(plans) ? plans : []) });
    }

    return res.json({ plans: [...COMPAT_DEFAULT_PLANS] });
  } catch (error) {
    logger.warn('[Compat] /plans fallback failed:', error.message);
    return res.json({ plans: [...COMPAT_DEFAULT_PLANS] });
  }
});

app.get('/api/farm/profile', async (_req, res) => {
  try {
    const farmPath = path.join(FARM_DATA_DIR, 'farm.json');
    const raw = await fs.promises.readFile(farmPath, 'utf8');
    const farm = JSON.parse(raw);
    const farmId = farm.farmId || farm.farm_id || 'FARM-TEST-WIZARD-001';

    return res.json({
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
    return res.status(500).json({ error: 'Failed to load farm profile' });
  }
});

app.get('/farm', async (_req, res) => {
  try {
    const farmPath = path.join(FARM_DATA_DIR, 'farm.json');
    const raw = await fs.promises.readFile(farmPath, 'utf8');
    return res.json(JSON.parse(raw));
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
    const payload = req.body && typeof req.body === 'object' ? req.body : {};
    await writeFarmDataJson('farm.json', payload);
    return res.json({ success: true, farm: payload });
  } catch (error) {
    logger.warn('[Compat] POST /farm failed:', error.message);
    return res.status(500).json({ success: false, error: 'Failed to save farm profile' });
  }
});

app.get('/api/setup/data', async (_req, res) => {
  try {
    const farmDoc = await readDataJsonWithFallback('farm.json', {});
    const roomsDoc = await readDataJsonWithFallback('rooms.json', { rooms: [] });
    const rooms = Array.isArray(roomsDoc) ? roomsDoc : (roomsDoc?.rooms || []);

    return res.json({
      success: true,
      config: {
        farmName: farmDoc?.farmName || farmDoc?.name || 'This is Your Farm',
        ownerName: farmDoc?.ownerName || farmDoc?.owner || '',
        contactEmail: farmDoc?.contactEmail || farmDoc?.email || '',
        contactPhone: farmDoc?.contactPhone || farmDoc?.phone || '',
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
    const payload = req.body || {};
    const rooms = Array.isArray(payload.rooms) ? payload.rooms : [];
    await writeFarmDataJson('rooms.json', { rooms });
    return res.json({ success: true, rooms, source: 'compat-file' });
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

app.get('/api/admin/farms/:farmId/devices', async (_req, res) => {
  try {
    const devicesPath = path.join(FARM_DATA_DIR, 'iot-devices.json');
    if (!fs.existsSync(devicesPath)) {
      return res.json({ success: true, farmId: _req.params.farmId, count: 0, devices: [] });
    }

    const raw = await fs.promises.readFile(devicesPath, 'utf8');
    const parsed = JSON.parse(raw);
    const devices = Array.isArray(parsed)
      ? parsed
      : (Array.isArray(parsed?.devices) ? parsed.devices : []);

    return res.json({
      success: true,
      farmId: _req.params.farmId,
      count: devices.length,
      devices
    });
  } catch (error) {
    logger.warn('[Compat] /api/admin/farms/:farmId/devices failed:', error.message);
    return res.json({ success: true, farmId: _req.params.farmId, count: 0, devices: [] });
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

app.get('/api/traceability/stats', (_req, res) => {
  return res.json({ ok: true, stats: { total_batches: 0, active_batches: 0, completed_batches: 0 } });
});

app.get('/api/traceability/batches/list', (_req, res) => {
  return res.json({ ok: true, batches: [] });
});

app.get('/api/traceability/search', (_req, res) => {
  return res.json({ ok: true, batches: [] });
});

app.get('/api/traceability/batches/:batchId', (req, res) => {
  return res.json({ ok: true, batch: { batch_id: req.params.batchId, status: 'pending', events: [] } });
});

app.post('/api/traceability/batches/create', (req, res) => {
  const payload = req.body || {};
  return res.json({ ok: true, batch_id: payload.batch_id || `batch-${Date.now()}` });
});

app.get('/api/traceability/batches/:batchId/report', (req, res) => {
  return res.json({ ok: true, report: { batch_id: req.params.batchId, generated_at: new Date().toISOString() } });
});

app.get('/api/planning/recommendations', (_req, res) => {
  return res.json({ ok: true, recommendations: [] });
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

app.get('/api/health/insights', async (_req, res) => {
  try {
    const envPath = path.join(FARM_DATA_DIR, 'env.json');
    if (!fs.existsSync(envPath)) {
      return res.json({ ok: true, zones: [] });
    }
    const raw = await fs.promises.readFile(envPath, 'utf8');
    const envData = JSON.parse(raw);
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

app.get('/api/health/vitality', async (_req, res) => {
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
    const trays = await getInventoryTraysForCompat();
    const activeTrays = trays.filter((tray) => (tray.status || '').toLowerCase() !== 'harvested');

    let envZones = [];
    try {
      const envPath = path.join(FARM_DATA_DIR, 'env.json');
      if (fs.existsSync(envPath)) {
        const raw = await fs.promises.readFile(envPath, 'utf8');
        const parsed = JSON.parse(raw);
        envZones = Array.isArray(parsed?.zones) ? parsed.zones : [];
      }
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

app.get('/api/inventory/current', async (_req, res) => {
  try {
    const trays = await getInventoryTraysForCompat();
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

app.get('/api/inventory/forecast', async (_req, res) => {
  try {
    const trays = await getInventoryTraysForCompat();
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

app.get('/api/tray-formats', async (_req, res) => {
  try {
    const formatsDoc = await readDataJsonWithFallback('tray-formats.json', []);
    const formats = Array.isArray(formatsDoc)
      ? formatsDoc
      : (formatsDoc?.formats || formatsDoc?.trayFormats || []);
    return res.json(Array.isArray(formats) ? formats : []);
  } catch (error) {
    logger.warn('[Compat] /api/tray-formats GET failed:', error.message);
    return res.json([]);
  }
});

app.post('/api/tray-formats', async (req, res) => {
  try {
    const formatsDoc = await readDataJsonWithFallback('tray-formats.json', []);
    const formats = Array.isArray(formatsDoc)
      ? formatsDoc
      : (formatsDoc?.formats || formatsDoc?.trayFormats || []);

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
    await writeFarmDataJson('tray-formats.json', formats);
    return res.status(201).json(format);
  } catch (error) {
    logger.warn('[Compat] /api/tray-formats POST failed:', error.message);
    return res.status(500).json({ error: 'Failed to create tray format' });
  }
});

app.put('/api/tray-formats/:formatId', async (req, res) => {
  try {
    const { formatId } = req.params;
    const formatsDoc = await readDataJsonWithFallback('tray-formats.json', []);
    const formats = Array.isArray(formatsDoc)
      ? formatsDoc
      : (formatsDoc?.formats || formatsDoc?.trayFormats || []);

    const index = formats.findIndex((item) => String(item.trayFormatId) === String(formatId));
    if (index < 0) {
      return res.status(404).json({ error: 'Format not found' });
    }

    formats[index] = {
      ...formats[index],
      ...(req.body || {}),
      trayFormatId: formats[index].trayFormatId
    };

    await writeFarmDataJson('tray-formats.json', formats);
    return res.json(formats[index]);
  } catch (error) {
    logger.warn('[Compat] /api/tray-formats PUT failed:', error.message);
    return res.status(500).json({ error: 'Failed to update tray format' });
  }
});

app.delete('/api/tray-formats/:formatId', async (req, res) => {
  try {
    const { formatId } = req.params;
    const formatsDoc = await readDataJsonWithFallback('tray-formats.json', []);
    const formats = Array.isArray(formatsDoc)
      ? formatsDoc
      : (formatsDoc?.formats || formatsDoc?.trayFormats || []);

    const nextFormats = formats.filter((item) => String(item.trayFormatId) !== String(formatId));
    await writeFarmDataJson('tray-formats.json', nextFormats);
    return res.json({ success: true });
  } catch (error) {
    logger.warn('[Compat] /api/tray-formats DELETE failed:', error.message);
    return res.status(500).json({ error: 'Failed to delete tray format' });
  }
});

app.get('/api/trays', async (_req, res) => {
  try {
    const traysDoc = await readDataJsonWithFallback('trays.json', []);
    const trays = Array.isArray(traysDoc) ? traysDoc : (traysDoc?.trays || []);
    return res.json(Array.isArray(trays) ? trays : []);
  } catch (error) {
    logger.warn('[Compat] /api/trays GET failed:', error.message);
    return res.json([]);
  }
});

app.post('/api/trays/register', async (req, res) => {
  try {
    const traysDoc = await readDataJsonWithFallback('trays.json', []);
    const trays = Array.isArray(traysDoc) ? traysDoc : (traysDoc?.trays || []);
    const formatsDoc = await readDataJsonWithFallback('tray-formats.json', []);
    const formats = Array.isArray(formatsDoc)
      ? formatsDoc
      : (formatsDoc?.formats || formatsDoc?.trayFormats || []);

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
    await writeFarmDataJson('trays.json', trays);
    return res.status(201).json({ success: true, tray });
  } catch (error) {
    logger.warn('[Compat] /api/trays/register POST failed:', error.message);
    return res.status(500).json({ error: 'Failed to register tray' });
  }
});

app.get('/data/nutrient-dashboard', async (_req, res) => {
  const payload = await readDataJsonWithFallback('nutrient-dashboard.json', {});
  return res.json(payload);
});

app.get('/data/equipment-metadata', async (_req, res) => {
  const payload = await readDataJsonWithFallback('equipment-metadata.json', {});
  return res.json(payload);
});

app.get('/data/room-map.json', async (_req, res) => {
  const payload = await readDataJsonWithFallback('room-map.json', { zones: [], devices: [] });
  return res.json(payload);
});

app.get('/data/room-map-:roomId.json', async (req, res) => {
  const roomId = String(req.params.roomId || '').trim();
  const roomSpecificName = roomId ? `room-map-${roomId}.json` : 'room-map.json';
  const roomSpecific = await readDataJsonWithFallback(roomSpecificName, null);
  if (roomSpecific) {
    return res.json(roomSpecific);
  }

  const generic = await readDataJsonWithFallback('room-map.json', { zones: [], devices: [] });
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

app.get('/configuration', async (_req, res) => {
  try {
    const configPath = path.join(FARM_DATA_DIR, 'configuration.json');
    if (!fs.existsSync(configPath)) {
      return res.json({
        network: { httpPort: '8080', wsPort: '8081' },
        integrations: {},
        notifications: {}
      });
    }
    const raw = await fs.promises.readFile(configPath, 'utf8');
    return res.json(JSON.parse(raw));
  } catch (error) {
    logger.warn('[Compat] /configuration read failed:', error.message);
    return res.json({ network: {}, integrations: {}, notifications: {} });
  }
});

app.get('/api/farm/configuration', async (_req, res) => {
  try {
    const configPath = path.join(FARM_DATA_DIR, 'configuration.json');
    if (!fs.existsSync(configPath)) {
      return res.json({
        network: { httpPort: '8080', wsPort: '8081' },
        integrations: {},
        notifications: {}
      });
    }
    const raw = await fs.promises.readFile(configPath, 'utf8');
    return res.json(JSON.parse(raw));
  } catch (error) {
    logger.warn('[Compat] /api/farm/configuration read failed:', error.message);
    return res.json({ network: {}, integrations: {}, notifications: {} });
  }
});

app.post('/api/farm/configuration', async (req, res) => {
  try {
    const configPath = path.join(FARM_DATA_DIR, 'configuration.json');
    await fs.promises.writeFile(configPath, JSON.stringify(req.body || {}, null, 2), 'utf8');
    return res.json({ success: true });
  } catch (error) {
    logger.warn('[Compat] /api/farm/configuration write failed:', error.message);
    return res.status(500).json({ success: false, error: 'Failed to save configuration' });
  }
});

app.get('/devices', async (_req, res) => {
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

app.post('/devices', async (req, res) => {
  try {
    const devicesPath = path.join(FARM_DATA_DIR, 'iot-devices.json');
    let current = { devices: [] };
    if (fs.existsSync(devicesPath)) {
      const raw = await fs.promises.readFile(devicesPath, 'utf8');
      const parsed = JSON.parse(raw);
      current = Array.isArray(parsed) ? { devices: parsed } : (parsed || { devices: [] });
      if (!Array.isArray(current.devices)) current.devices = [];
    }

    const payload = req.body || {};
    const nextDevice = {
      ...payload,
      id: payload.id || payload.deviceId || payload.device_id || `device-${Date.now()}`
    };
    current.devices.push(nextDevice);
    await fs.promises.writeFile(devicesPath, JSON.stringify(current, null, 2), 'utf8');
    return res.status(201).json({ success: true, device: nextDevice });
  } catch (error) {
    logger.warn('[Compat] POST /devices failed:', error.message);
    return res.status(500).json({ success: false, error: 'Failed to save device' });
  }
});

app.patch('/devices/:deviceId', async (req, res) => {
  try {
    const { deviceId } = req.params;
    const devicesPath = path.join(FARM_DATA_DIR, 'iot-devices.json');
    if (!fs.existsSync(devicesPath)) {
      return res.status(404).json({ error: 'Device not found' });
    }

    const raw = await fs.promises.readFile(devicesPath, 'utf8');
    const parsed = JSON.parse(raw);
    const payload = Array.isArray(parsed) ? { devices: parsed } : (parsed || { devices: [] });
    const devices = Array.isArray(payload.devices) ? payload.devices : [];

    const index = devices.findIndex((item) => String(item.id || item.deviceId || item.device_id) === String(deviceId));
    if (index < 0) {
      return res.status(404).json({ error: 'Device not found' });
    }

    devices[index] = { ...devices[index], ...(req.body || {}) };
    payload.devices = devices;
    await fs.promises.writeFile(devicesPath, JSON.stringify(payload, null, 2), 'utf8');
    return res.json({ success: true, device: devices[index] });
  } catch (error) {
    logger.warn('[Compat] PATCH /devices/:deviceId failed:', error.message);
    return res.status(500).json({ error: 'Failed to update device' });
  }
});

// Compatibility endpoints expected by legacy farm/admin pages
app.get('/api/groups', async (_req, res) => {
  try {
    const groupsPath = path.join(FARM_DATA_DIR, 'groups.json');
    if (!fs.existsSync(groupsPath)) return res.json([]);

    const raw = await fs.promises.readFile(groupsPath, 'utf8');
    const parsed = JSON.parse(raw);
    const groups = Array.isArray(parsed) ? parsed : (parsed?.groups || []);

    const formatted = groups.map((group) => ({
      id: group.id || group.name,
      name: group.name,
      zone: group.zone,
      crop: group.crop || group.recipe,
      plan: group.plan,
      trays: Number(group.trays || 0),
      plants: Number(group.plants || 0),
      devices: Array.isArray(group.devices) ? group.devices.length : 0
    }));

    return res.json(formatted);
  } catch (error) {
    logger.warn('[Compat] /api/groups fallback failed:', error.message);
    return res.json([]);
  }
});

app.get('/api/rooms', async (req, res) => {
  try {
    if (req.db) {
      try {
        const result = await req.db.query(
          `SELECT room_id, farm_id, name, type, capacity, description, created_at
           FROM rooms
           ORDER BY created_at ASC`
        );
        return res.json(result.rows);
      } catch (dbError) {
        logger.debug('[Compat] /api/rooms DB query failed, using file fallback', { error: dbError.message });
      }
    }

    const roomsPath = path.join(FARM_DATA_DIR, 'rooms.json');
    if (!fs.existsSync(roomsPath)) return res.json([]);

    const raw = await fs.promises.readFile(roomsPath, 'utf8');
    const parsed = JSON.parse(raw);
    const rooms = Array.isArray(parsed) ? parsed : (parsed?.rooms || [parsed]);
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
        farmName: data.name || data.farm_id,
        email: data.email,
        role: data.role,
        subscription: data.planType || 'cloud'
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
app.use('/api/planting', authMiddleware, plantingRoutes); // Planting scheduler recommendations with market intelligence
app.use('/api/planning', planningRoutes); // Production planning (integrates market + crop pricing)
app.use('/api/market-intelligence', marketIntelligenceRoutes); // North American market data + price alerts
app.use('/api/crop-pricing', cropPricingRoutes); // Farm-specific crop pricing

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

    // Load persisted buyers into memory on startup
    try {
      const { loadBuyersFromDb } = await import('./services/wholesaleMemoryStore.js');
      await loadBuyersFromDb();
    } catch (e) {
      logger.warn('Buyer DB load skipped:', e.message);
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
