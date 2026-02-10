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
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://web.squarecdn.com"],
      scriptSrcAttr: ["'unsafe-inline'"],  // Allow inline event handlers (onclick, etc.)
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https:", "https://connect.squareup.com", "https://pci-connect.squareup.com"],
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
// FARM DATA SYNC: Periodically pull live data from edge farms
// =====================================================
const FARM_DATA_DIR = path.join(__dirname, 'public', 'data');
const FARM_SYNC_INTERVAL = 5 * 60 * 1000; // 5 minutes
const SYNC_DATA_FILES = ['groups.json', 'rooms.json', 'farm.json', 'iot-devices.json', 'room-map.json'];

async function syncFarmData() {
  try {
    // Read farm.json to get edge device URL
    const farmJsonPath = path.join(FARM_DATA_DIR, 'farm.json');
    if (!fs.existsSync(farmJsonPath)) return;
    
    const farmData = JSON.parse(fs.readFileSync(farmJsonPath, 'utf8'));
    const edgeUrl = farmData.url;
    if (!edgeUrl) return;
    
    logger.info(`[FarmSync] Syncing data from edge device: ${edgeUrl}`);
    
    for (const file of SYNC_DATA_FILES) {
      if (file === 'farm.json') continue; // Don't overwrite farm.json with edge version
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const response = await fetch(`${edgeUrl}/data/${file}`, { signal: controller.signal });
        clearTimeout(timeout);
        
        if (response.ok) {
          const data = await response.text();
          const localPath = path.join(FARM_DATA_DIR, file);
          fs.writeFileSync(localPath, data, 'utf8');
          logger.info(`[FarmSync] Updated ${file} from edge device`);
        }
      } catch (err) {
        logger.warn(`[FarmSync] Could not fetch ${file} from ${edgeUrl}: ${err.message}`);
      }
    }
  } catch (error) {
    logger.error('[FarmSync] Sync error:', error.message);
  }
}

// Run initial sync after 10 seconds, then every 5 minutes
setTimeout(syncFarmData, 10000);
setInterval(syncFarmData, FARM_SYNC_INTERVAL);

// Manual sync endpoint
app.post('/api/sync/pull-farm-data', async (req, res) => {
  try {
    await syncFarmData();
    res.json({ ok: true, message: 'Farm data sync complete', timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
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
