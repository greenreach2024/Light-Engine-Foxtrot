#!/usr/bin/env node
/**
 * Light Engine Access Manager (LEAM) — Local Companion Agent
 * ============================================================
 * Runs on the operator's local machine (Mac/Linux/Windows).
 * Connects to GreenReach Central via WebSocket and exposes local
 * hardware capabilities (BLE radio, WiFi, system info) to EVIE.
 *
 * Usage:
 *   node index.js                          # Connect to production Central
 *   node index.js --central=http://localhost:3000  # Local dev
 *   node index.js --verbose                # Debug logging
 *   CENTRAL_URL=https://greenreachgreens.com FARM_TOKEN=jwt... node index.js
 *
 * Environment Variables:
 *   CENTRAL_URL    - GreenReach Central base URL (default: https://greenreachgreens.com)
 *   CENTRAL_WS_PORT - WebSocket port on Central (default: 8443)
 *   FARM_TOKEN     - JWT token for authentication
 *   FARM_API_KEY   - API key (alternative to JWT)
 *   FARM_ID        - Farm ID (required with API key auth)
 *   LEAM_VERBOSE   - Enable verbose logging (true/false)
 */

import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import bleScanner from './lib/ble-scanner.js';
import systemInfo from './lib/system-info.js';
import commandHandler from './lib/command-handler.js';

// ── Load .env file (no external dependency) ────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (val && !process.env[key]) {
      process.env[key] = val;
    }
  }
}

// ── Configuration ──────────────────────────────────────────────────────
const args = process.argv.slice(2);
const verbose = args.includes('--verbose') || process.env.LEAM_VERBOSE === 'true';

function getArg(name) {
  const flag = args.find(a => a.startsWith(`--${name}=`));
  return flag ? flag.split('=').slice(1).join('=') : null;
}

const CENTRAL_URL = getArg('central') || process.env.CENTRAL_URL || 'https://greenreachgreens.com';
const WS_PORT = getArg('ws-port') || process.env.CENTRAL_WS_PORT || '8443';
const FARM_TOKEN = getArg('token') || process.env.FARM_TOKEN || null;
const FARM_API_KEY = process.env.FARM_API_KEY || null;
const FARM_ID = process.env.FARM_ID || null;

const RECONNECT_INTERVAL_MS = 5000;
const HEARTBEAT_INTERVAL_MS = 30000;
const MAX_RECONNECT_BACKOFF_MS = 60000;

let ws = null;
let reconnectAttempts = 0;
let heartbeatTimer = null;
let connected = false;

// ── Logging ────────────────────────────────────────────────────────────
function log(level, ...args_) {
  const ts = new Date().toISOString().slice(11, 23);
  if (level === 'debug' && !verbose) return;
  const prefix = { info: '[LEAM]', warn: '[LEAM WARN]', error: '[LEAM ERROR]', debug: '[LEAM DEBUG]' }[level] || '[LEAM]';
  console.log(`${ts} ${prefix}`, ...args_);
}

// ── WebSocket Connection ───────────────────────────────────────────────
function buildWsUrl() {
  const base = CENTRAL_URL.replace(/^http/, 'ws').replace(/\/$/, '');
  // If Central URL has a port, use that host with the WS port
  const url = new URL(CENTRAL_URL);
  const wsProtocol = url.protocol === 'https:' ? 'wss' : 'ws';
  const wsHost = url.hostname;

  let wsUrl = `${wsProtocol}://${wsHost}:${WS_PORT}`;

  // Add auth params
  const params = new URLSearchParams();
  if (FARM_TOKEN) {
    params.set('token', FARM_TOKEN);
  }
  params.set('client', 'leam');
  params.set('version', '1.0.0');

  return `${wsUrl}?${params.toString()}`;
}

function connect() {
  const wsUrl = buildWsUrl();
  log('info', `Connecting to Central: ${wsUrl.replace(/token=[^&]+/, 'token=[redacted]')}`);

  const headers = {};
  if (FARM_API_KEY && FARM_ID) {
    headers['x-api-key'] = FARM_API_KEY;
    headers['x-farm-id'] = FARM_ID;
  }
  headers['x-leam-version'] = '1.0.0';

  ws = new WebSocket(wsUrl, { headers, rejectUnauthorized: true });

  ws.on('open', () => {
    connected = true;
    reconnectAttempts = 0;
    log('info', 'Connected to GreenReach Central');

    // Register as LEAM client
    sendMessage({
      type: 'leam_register',
      capabilities: commandHandler.getCatalog(),
      system: systemInfo.getBasicInfo(),
      version: '1.0.0'
    });

    // Start heartbeat
    heartbeatTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        sendMessage({ type: 'leam_heartbeat', uptime: process.uptime() });
      }
    }, HEARTBEAT_INTERVAL_MS);
  });

  ws.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      log('warn', 'Received non-JSON message');
      return;
    }

    log('debug', 'Received:', msg.type || msg.command || 'unknown');

    // Handle command requests from Central/EVIE
    if (msg.type === 'leam_command' && msg.command) {
      log('info', `Executing command: ${msg.command}`);
      const result = await commandHandler.execute(msg.command, msg.params || {});
      sendMessage({
        type: 'leam_response',
        id: msg.id,
        command: msg.command,
        ...result
      });
      log('info', `Command ${msg.command} completed (${result.duration_ms}ms, ok=${result.ok})`);
    }

    // Handle connection acknowledgements
    if (msg.type === 'connection') {
      log('info', 'Server acknowledged connection');
    }

    // Handle subscribed confirmation
    if (msg.type === 'subscribed') {
      log('info', `Subscribed to farm: ${msg.farmId}`);
    }
  });

  ws.on('close', (code, reason) => {
    connected = false;
    clearInterval(heartbeatTimer);
    log('warn', `Disconnected (code: ${code}, reason: ${reason || 'none'})`);

    if (code !== 4001) { // 4001 = auth required, don't retry
      scheduleReconnect();
    } else {
      log('error', 'Authentication failed. Check FARM_TOKEN or FARM_API_KEY + FARM_ID.');
      log('error', 'Set environment variables and restart LEAM.');
    }
  });

  ws.on('error', (err) => {
    log('error', 'WebSocket error:', err.message);
  });
}

function sendMessage(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ ...msg, timestamp: new Date().toISOString() }));
  }
}

function scheduleReconnect() {
  reconnectAttempts++;
  const delay = Math.min(RECONNECT_INTERVAL_MS * Math.pow(1.5, reconnectAttempts - 1), MAX_RECONNECT_BACKOFF_MS);
  log('info', `Reconnecting in ${Math.round(delay / 1000)}s (attempt ${reconnectAttempts})...`);
  setTimeout(connect, delay);
}

// ── Initialization ─────────────────────────────────────────────────────
async function start() {
  console.log('');
  console.log('  Light Engine Access Manager (LEAM) v1.0.0');
  console.log('  Local companion agent for GreenReach / EVIE');
  console.log('  ------------------------------------------');
  console.log('');

  // Initialize modules
  log('info', 'Initializing modules...');
  await bleScanner.init();
  await systemInfo.init();

  const sysBasic = systemInfo.getBasicInfo();
  log('info', `Host: ${sysBasic.hostname} (${sysBasic.platform} ${sysBasic.arch})`);
  log('info', `CPU: ${sysBasic.cpuModel} (${sysBasic.cpuCores} cores)`);
  log('info', `Memory: ${Math.round(sysBasic.totalMemory / 1024 / 1024)}MB total, ${sysBasic.usedMemoryPercent}% used`);
  log('info', `BLE radio: ${bleScanner.isAvailable() ? 'AVAILABLE' : 'NOT AVAILABLE'}`);

  if (!bleScanner.isAvailable()) {
    log('warn', 'BLE scanning disabled. On macOS, ensure Bluetooth is enabled.');
    log('warn', 'If noble fails to build, try: xcode-select --install');
  }

  log('info', `Available commands: ${commandHandler.getCatalog().length}`);

  // Connect to Central
  if (!FARM_TOKEN && !FARM_API_KEY) {
    log('warn', 'No auth credentials configured.');
    log('warn', 'Set FARM_TOKEN (JWT) or FARM_API_KEY + FARM_ID environment variables.');
    log('warn', 'Starting in local-only mode (no Central connection).');
    log('info', 'LEAM is running. Use --token=<jwt> to connect to Central.');

    // Run in local-only mode — useful for testing
    startLocalREPL();
  } else {
    connect();
  }
}

// ── Local REPL (no-auth mode for testing) ──────────────────────────────
async function startLocalREPL() {
  const rl = await import('readline');
  const iface = rl.createInterface({ input: process.stdin, output: process.stdout });
  const prompt = () => iface.question('leam> ', async (line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed === 'exit' || trimmed === 'quit') {
      log('info', 'Shutting down...');
      process.exit(0);
    }

    // Parse: command_name [json_params]
    const parts = trimmed.split(/\s+/);
    const cmd = parts[0];
    let params = {};
    if (parts.length > 1) {
      try { params = JSON.parse(parts.slice(1).join(' ')); } catch { /* ignore */ }
    }

    const result = await commandHandler.execute(cmd, params);
    console.log(JSON.stringify(result, null, 2));
    prompt();
  });
  prompt();
}

// ── Graceful Shutdown ──────────────────────────────────────────────────
process.on('SIGINT', () => {
  log('info', 'Shutting down...');
  bleScanner.stopScan();
  clearInterval(heartbeatTimer);
  if (ws) ws.close(1000, 'LEAM shutdown');
  process.exit(0);
});

process.on('SIGTERM', () => {
  bleScanner.stopScan();
  clearInterval(heartbeatTimer);
  if (ws) ws.close(1000, 'LEAM shutdown');
  process.exit(0);
});

start().catch(err => {
  log('error', 'Failed to start:', err.message);
  process.exit(1);
});
