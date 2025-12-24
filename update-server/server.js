/**
 * Light Engine Update Distribution Server
 * Serves updates with staged rollout support
 * Deploy to updates.greenreach.com
 */

import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import morgan from 'morgan';
import compression from 'compression';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3001;
const RELEASES_DIR = path.join(__dirname, 'releases');
const LOGS_DIR = path.join(__dirname, 'logs');

// Ensure directories exist
[RELEASES_DIR, LOGS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Middleware
app.use(compression());
app.use(express.json());
app.use(morgan('combined', {
  stream: fs.createWriteStream(path.join(LOGS_DIR, 'access.log'), { flags: 'a' })
}));
app.use(morgan('dev'));

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// Staged rollout configuration
// Format: { version: { stage: percentage } }
const rolloutConfig = new Map();

/**
 * Health check
 */
app.get('/health', (req, res) => {
  res.json({
    ok: true,
    service: 'Light Engine Update Server',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

/**
 * Get update manifest for specific channel and platform
 * GET /manifest/:channel/:platform
 */
app.get('/manifest/:channel/:platform', (req, res) => {
  try {
    const { channel, platform } = req.params;
    const { deviceId, currentVersion } = req.query;
    
    // Validate channel
    const validChannels = ['stable', 'beta', 'alpha'];
    if (!validChannels.includes(channel)) {
      return res.status(400).json({
        error: 'Invalid channel',
        validChannels
      });
    }
    
    // Find latest version for this channel/platform
    const manifestPath = path.join(RELEASES_DIR, channel, platform, 'manifest.json');
    
    if (!fs.existsSync(manifestPath)) {
      return res.status(404).json({
        error: 'No releases available',
        channel,
        platform
      });
    }
    
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    
    // Check staged rollout
    const rollout = rolloutConfig.get(manifest.version);
    if (rollout && rollout.enabled) {
      const eligible = isEligibleForRollout(deviceId || '', rollout.percentage);
      if (!eligible) {
        return res.json({
          version: currentVersion || '1.0.0',
          message: 'Update staged rollout in progress',
          rolloutPercentage: rollout.percentage
        });
      }
    }
    
    // Log update check
    logUpdateCheck(channel, platform, deviceId, currentVersion, manifest.version);
    
    res.json(manifest);
    
  } catch (error) {
    console.error('Manifest error:', error);
    res.status(500).json({
      error: 'Failed to get manifest',
      message: error.message
    });
  }
});

/**
 * Download binary
 * GET /download/:channel/:platform/:version/:filename
 */
app.get('/download/:channel/:platform/:version/:filename', (req, res) => {
  try {
    const { channel, platform, version, filename } = req.params;
    
    const filePath = path.join(RELEASES_DIR, channel, platform, version, filename);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        error: 'File not found',
        path: `${channel}/${platform}/${version}/${filename}`
      });
    }
    
    console.log(`[Download] ${filename} for ${platform} v${version}`);
    
    res.download(filePath, filename);
    
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({
      error: 'Download failed',
      message: error.message
    });
  }
});

/**
 * List all releases
 * GET /releases
 */
app.get('/releases', (req, res) => {
  try {
    const { channel, platform } = req.query;
    
    const releases = [];
    
    const channels = channel ? [channel] : fs.readdirSync(RELEASES_DIR);
    
    channels.forEach(ch => {
      const channelPath = path.join(RELEASES_DIR, ch);
      if (!fs.statSync(channelPath).isDirectory()) return;
      
      const platforms = platform ? [platform] : fs.readdirSync(channelPath);
      
      platforms.forEach(plt => {
        const platformPath = path.join(channelPath, plt);
        if (!fs.statSync(platformPath).isDirectory()) return;
        
        const manifestPath = path.join(platformPath, 'manifest.json');
        if (fs.existsSync(manifestPath)) {
          const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
          releases.push({
            channel: ch,
            platform: plt,
            ...manifest,
            rollout: rolloutConfig.get(manifest.version)
          });
        }
      });
    });
    
    res.json({
      ok: true,
      count: releases.length,
      releases
    });
    
  } catch (error) {
    console.error('Releases error:', error);
    res.status(500).json({
      error: 'Failed to list releases',
      message: error.message
    });
  }
});

/**
 * Configure staged rollout
 * POST /rollout/:version
 */
app.post('/rollout/:version', (req, res) => {
  try {
    const { version } = req.params;
    const { percentage, enabled } = req.body;
    
    if (percentage === undefined || enabled === undefined) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['percentage', 'enabled']
      });
    }
    
    rolloutConfig.set(version, {
      percentage: Math.min(100, Math.max(0, percentage)),
      enabled,
      updatedAt: new Date().toISOString()
    });
    
    console.log(`[Rollout] Version ${version}: ${percentage}% (${enabled ? 'enabled' : 'disabled'})`);
    
    res.json({
      ok: true,
      version,
      rollout: rolloutConfig.get(version)
    });
    
  } catch (error) {
    console.error('Rollout error:', error);
    res.status(500).json({
      error: 'Failed to configure rollout',
      message: error.message
    });
  }
});

/**
 * Get update statistics
 * GET /stats
 */
app.get('/stats', (req, res) => {
  try {
    const logFile = path.join(LOGS_DIR, 'update-checks.log');
    
    if (!fs.existsSync(logFile)) {
      return res.json({
        ok: true,
        checks: 0,
        updates: 0,
        message: 'No logs yet'
      });
    }
    
    const logs = fs.readFileSync(logFile, 'utf-8').split('\n').filter(Boolean);
    
    const stats = {
      checks: logs.length,
      byChannel: {},
      byPlatform: {},
      byVersion: {}
    };
    
    logs.forEach(line => {
      try {
        const log = JSON.parse(line);
        stats.byChannel[log.channel] = (stats.byChannel[log.channel] || 0) + 1;
        stats.byPlatform[log.platform] = (stats.byPlatform[log.platform] || 0) + 1;
        stats.byVersion[log.latestVersion] = (stats.byVersion[log.latestVersion] || 0) + 1;
      } catch (e) {}
    });
    
    res.json({
      ok: true,
      ...stats
    });
    
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get stats',
      message: error.message
    });
  }
});

/**
 * Emergency rollback - disable version
 * POST /rollback/:version
 */
app.post('/rollback/:version', (req, res) => {
  try {
    const { version } = req.params;
    
    rolloutConfig.set(version, {
      percentage: 0,
      enabled: false,
      rolledBack: true,
      updatedAt: new Date().toISOString()
    });
    
    console.log(`[Rollback] ⚠️  Version ${version} rolled back`);
    
    res.json({
      ok: true,
      message: `Version ${version} rolled back`,
      version
    });
    
  } catch (error) {
    res.status(500).json({
      error: 'Rollback failed',
      message: error.message
    });
  }
});

// Helper functions

/**
 * Determine if device is eligible for rollout based on percentage
 */
function isEligibleForRollout(deviceId, percentage) {
  if (percentage >= 100) return true;
  if (percentage <= 0) return false;
  
  // Use device ID hash to deterministically assign to rollout group
  const hash = crypto.createHash('md5').update(deviceId).digest('hex');
  const hashValue = parseInt(hash.substring(0, 8), 16);
  const bucket = hashValue % 100;
  
  return bucket < percentage;
}

/**
 * Log update check
 */
function logUpdateCheck(channel, platform, deviceId, currentVersion, latestVersion) {
  const logFile = path.join(LOGS_DIR, 'update-checks.log');
  const logEntry = JSON.stringify({
    timestamp: new Date().toISOString(),
    channel,
    platform,
    deviceId,
    currentVersion,
    latestVersion
  }) + '\n';
  
  fs.appendFileSync(logFile, logEntry);
}

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not found',
    endpoints: {
      '/manifest/:channel/:platform': 'Get update manifest',
      '/download/:channel/:platform/:version/:filename': 'Download release file',
      '/releases': 'List all releases',
      '/rollout/:version': 'Configure staged rollout',
      '/rollback/:version': 'Emergency rollback',
      '/stats': 'Update statistics',
      '/health': 'Health check'
    }
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'An error occurred'
  });
});

// Start server
app.listen(PORT, () => {
  console.log('======================================');
  console.log('Light Engine Update Server');
  console.log('======================================');
  console.log(`Listening on port ${PORT}`);
  console.log(`Releases directory: ${RELEASES_DIR}`);
  console.log(`Logs directory: ${LOGS_DIR}`);
  console.log('');
  console.log('Endpoints:');
  console.log(`  GET  /manifest/:channel/:platform   - Update manifest`);
  console.log(`  GET  /download/:channel/:platform/:version/:file - Download`);
  console.log(`  GET  /releases                      - List releases`);
  console.log(`  POST /rollout/:version              - Configure rollout`);
  console.log(`  POST /rollback/:version             - Emergency rollback`);
  console.log(`  GET  /stats                         - Statistics`);
  console.log(`  GET  /health                        - Health check`);
  console.log('======================================');
});
