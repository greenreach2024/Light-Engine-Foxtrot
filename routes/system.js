/**
 * System Management API Routes
 * 
 * Remote management endpoints for farm servers
 * Enables headless operation without SSH access
 * 
 * Authentication: Requires SYSTEM_TOKEN environment variable
 * All endpoints return JSON responses
 */

import express from 'express';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const router = express.Router();

// Import logger
const logger = require('../lib/logger.cjs');

// System token authentication middleware
function requireSystemToken(req, res, next) {
  const systemToken = process.env.SYSTEM_TOKEN;
  
  if (!systemToken) {
    logger.warn('system_api_no_token_configured', {
      endpoint: req.path,
      ip: req.ip
    });
    return res.status(503).json({
      error: 'System API not configured',
      message: 'SYSTEM_TOKEN environment variable not set'
    });
  }

  const providedToken = req.headers.authorization?.replace('Bearer ', '');
  
  if (providedToken !== systemToken) {
    logger.warn('system_api_unauthorized', {
      endpoint: req.path,
      ip: req.ip,
      provided_token_length: providedToken?.length || 0
    });
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid system token'
    });
  }

  next();
}

// Helper: Execute shell command safely
function execCommand(command, options = {}) {
  try {
    const output = execSync(command, {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024, // 10MB
      timeout: options.timeout || 30000,
      ...options
    });
    return { success: true, output: output.trim() };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      stdout: error.stdout?.toString() || '',
      stderr: error.stderr?.toString() || ''
    };
  }
}

// Helper: Get PM2 process list
function getPM2Status() {
  const result = execCommand('pm2 jlist');
  if (result.success) {
    try {
      return JSON.parse(result.output);
    } catch (err) {
      return [];
    }
  }
  return [];
}

// Helper: Get recent logs
function getRecentLogs(service = 'lightengine-node', lines = 100) {
  const result = execCommand(`pm2 logs ${service} --nostream --lines ${lines} --raw`);
  if (result.success) {
    return result.output.split('\n').slice(-lines);
  }
  return [];
}

// Helper: Get disk usage
function getDiskUsage() {
  const result = execCommand("df -h / | tail -1 | awk '{print $2,$3,$4,$5}'");
  if (result.success) {
    const [total, used, available, percent] = result.output.split(' ');
    return { total, used, available, percent };
  }
  return null;
}

/**
 * GET /api/system/health
 * Detailed system health check
 */
router.get('/health', (req, res) => {
  const pm2Processes = getPM2Status();
  const diskUsage = getDiskUsage();
  
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: require('../package.json').version,
    device_id: process.env.DEVICE_ID || 'unknown',
    farm_id: process.env.FARM_ID || 'unknown',
    platform: {
      type: os.type(),
      platform: os.platform(),
      arch: os.arch(),
      release: os.release(),
      hostname: os.hostname()
    },
    memory: {
      total: os.totalmem(),
      free: os.freemem(),
      used: os.totalmem() - os.freemem(),
      percentUsed: ((os.totalmem() - os.freemem()) / os.totalmem() * 100).toFixed(2)
    },
    cpu: {
      model: os.cpus()[0]?.model || 'unknown',
      cores: os.cpus().length,
      loadAvg: os.loadavg()
    },
    disk: diskUsage,
    services: pm2Processes.map(proc => ({
      name: proc.name,
      status: proc.pm2_env?.status || 'unknown',
      uptime: proc.pm2_env?.pm_uptime || 0,
      restarts: proc.pm2_env?.restart_time || 0,
      memory: proc.monit?.memory || 0,
      cpu: proc.monit?.cpu || 0
    })),
    network: Object.entries(os.networkInterfaces()).map(([name, interfaces]) => ({
      name,
      addresses: interfaces.filter(i => !i.internal).map(i => ({
        family: i.family,
        address: i.address
      }))
    }))
  };

  logger.info('system_health_checked', {
    uptime: health.uptime,
    memory_percent: health.memory.percentUsed,
    services_count: health.services.length
  });

  res.json(health);
});

/**
 * GET /api/system/logs
 * Stream recent logs
 */
router.get('/logs', requireSystemToken, (req, res) => {
  const service = req.query.service || 'lightengine-node';
  const lines = parseInt(req.query.lines) || 100;
  const level = req.query.level; // ERROR, WARN, INFO, DEBUG

  const logs = getRecentLogs(service, lines);
  
  // Filter by level if specified
  let filteredLogs = logs;
  if (level) {
    filteredLogs = logs.filter(line => line.includes(`"level":"${level.toUpperCase()}"`));
  }

  logger.info('system_logs_accessed', {
    service,
    lines_requested: lines,
    lines_returned: filteredLogs.length,
    level: level || 'all'
  });

  res.json({
    service,
    lines: filteredLogs.length,
    logs: filteredLogs
  });
});

/**
 * GET /api/system/diagnostics
 * Comprehensive diagnostic bundle
 */
router.get('/diagnostics', requireSystemToken, (req, res) => {
  const pm2Processes = getPM2Status();
  const recentLogs = getRecentLogs('lightengine-node', 50);
  const errorLogs = recentLogs.filter(line => line.includes('"level":"ERROR"'));

  const diagnostics = {
    timestamp: new Date().toISOString(),
    version: require('../package.json').version,
    device_id: process.env.DEVICE_ID || 'unknown',
    farm_id: process.env.FARM_ID || 'unknown',
    uptime: process.uptime(),
    platform: {
      type: os.type(),
      platform: os.platform(),
      arch: os.arch(),
      release: os.release(),
      hostname: os.hostname(),
      cpus: os.cpus().length
    },
    memory: {
      totalMB: (os.totalmem() / 1024 / 1024).toFixed(0),
      freeMB: (os.freemem() / 1024 / 1024).toFixed(0),
      usedMB: ((os.totalmem() - os.freemem()) / 1024 / 1024).toFixed(0),
      percentUsed: ((os.totalmem() - os.freemem()) / os.totalmem() * 100).toFixed(2)
    },
    disk: getDiskUsage(),
    loadAverage: os.loadavg(),
    services: pm2Processes.map(proc => ({
      name: proc.name,
      status: proc.pm2_env?.status,
      uptime: proc.pm2_env?.pm_uptime,
      restarts: proc.pm2_env?.restart_time,
      memoryMB: (proc.monit?.memory / 1024 / 1024).toFixed(0),
      cpu: proc.monit?.cpu
    })),
    recentErrors: errorLogs.slice(-10),
    environment: {
      node_version: process.version,
      db_enabled: process.env.DB_ENABLED === 'true',
      log_level: process.env.LOG_LEVEL || 'INFO'
    }
  };

  logger.info('system_diagnostics_generated', {
    services_count: diagnostics.services.length,
    recent_errors: diagnostics.recentErrors.length
  });

  res.json(diagnostics);
});

/**
 * POST /api/system/restart
 * Restart services gracefully
 */
router.post('/restart', requireSystemToken, (req, res) => {
  const service = req.body.service || 'all';

  logger.warn('system_restart_requested', {
    service,
    requested_by: req.ip
  });

  try {
    if (service === 'all') {
      execSync('pm2 restart all', { timeout: 10000 });
    } else {
      execSync(`pm2 restart ${service}`, { timeout: 10000 });
    }

    logger.info('system_restart_completed', { service });

    res.json({
      success: true,
      message: `Service(s) restarted: ${service}`,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('system_restart_failed', { service, error: error.message }, error);

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/system/update
 * Trigger git pull and restart
 */
router.post('/update', requireSystemToken, async (req, res) => {
  logger.warn('system_update_requested', {
    requested_by: req.ip
  });

  const steps = [];
  let success = true;

  try {
    // Get current version
    const currentVersion = execCommand('git rev-parse --short HEAD');
    steps.push({
      step: 'get_current_version',
      success: currentVersion.success,
      version: currentVersion.output
    });

    // Git pull
    const gitPull = execCommand('git pull', { timeout: 60000 });
    steps.push({
      step: 'git_pull',
      success: gitPull.success,
      output: gitPull.output?.slice(0, 200) // Truncate
    });

    if (!gitPull.success) {
      throw new Error('Git pull failed: ' + gitPull.error);
    }

    // Get new version
    const newVersion = execCommand('git rev-parse --short HEAD');
    steps.push({
      step: 'get_new_version',
      success: newVersion.success,
      version: newVersion.output
    });

    // Install dependencies if package.json changed
    const packageChanged = gitPull.output?.includes('package.json');
    if (packageChanged) {
      logger.info('system_update_installing_deps');
      const npmInstall = execCommand('npm install --production', { timeout: 120000 });
      steps.push({
        step: 'npm_install',
        success: npmInstall.success,
        output: npmInstall.success ? 'Dependencies installed' : npmInstall.error
      });
    }

    // Restart services
    execSync('pm2 restart all', { timeout: 10000 });
    steps.push({
      step: 'restart_services',
      success: true
    });

    logger.info('system_update_completed', {
      from_version: currentVersion.output,
      to_version: newVersion.output
    });

    res.json({
      success: true,
      message: 'System updated successfully',
      from_version: currentVersion.output,
      to_version: newVersion.output,
      steps
    });

  } catch (error) {
    logger.error('system_update_failed', { error: error.message }, error);

    res.status(500).json({
      success: false,
      error: error.message,
      steps
    });
  }
});

/**
 * POST /api/system/config
 * Update environment configuration
 */
router.post('/config', requireSystemToken, (req, res) => {
  const updates = req.body;

  logger.warn('system_config_update_requested', {
    keys: Object.keys(updates),
    requested_by: req.ip
  });

  try {
    const envPath = path.join(__dirname, '../.env');
    
    // Read current .env
    let envContent = '';
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, 'utf8');
    }

    // Update or add each key
    const updatedKeys = [];
    for (const [key, value] of Object.entries(updates)) {
      const regex = new RegExp(`^${key}=.*$`, 'm');
      if (regex.test(envContent)) {
        envContent = envContent.replace(regex, `${key}=${value}`);
      } else {
        envContent += `\n${key}=${value}`;
      }
      updatedKeys.push(key);
      
      // Update runtime env (won't affect current process fully, but available for new code)
      process.env[key] = value;
    }

    // Write updated .env
    fs.writeFileSync(envPath, envContent);

    logger.info('system_config_updated', {
      keys: updatedKeys,
      restart_required: true
    });

    res.json({
      success: true,
      message: 'Configuration updated',
      updated_keys: updatedKeys,
      restart_required: true
    });

  } catch (error) {
    logger.error('system_config_update_failed', { error: error.message }, error);

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/system/version
 * Get current version info
 */
router.get('/version', (req, res) => {
  const gitVersion = execCommand('git rev-parse --short HEAD');
  const gitBranch = execCommand('git rev-parse --abbrev-ref HEAD');
  const gitRemote = execCommand('git config --get remote.origin.url');

  res.json({
    version: require('../package.json').version,
    git: {
      commit: gitVersion.output || 'unknown',
      branch: gitBranch.output || 'unknown',
      remote: gitRemote.output || 'unknown'
    },
    node_version: process.version,
    platform: os.platform(),
    arch: os.arch()
  });
});

export default router;
