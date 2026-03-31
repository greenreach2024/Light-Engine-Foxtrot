/**
 * LEAM -- Local Environment Agent Module
 * =======================================
 * Companion agent for GreenReach. Runs on the operator's Mac as a
 * background service (launchd) and connects to Central via WebSocket.
 *
 * Provides local-only capabilities that the cloud cannot access:
 *   - BLE (Bluetooth Low Energy) device scanning
 *   - Network device discovery (ARP, mDNS/Bonjour, SSDP/UPnP)
 *   - Local system information (CPU, memory, disks, Wi-Fi, USB)
 *
 * Architecture:
 *   LEAM <--WebSocket--> Central <--leamBridge--> E.V.I.E. tools
 *
 * Configuration via environment variables:
 *   CENTRAL_WS_URL    WebSocket URL (default: wss://www.greenreachgreens.com:3001)
 *   GREENREACH_API_KEY API key for authentication
 *   FARM_ID           Farm identifier
 *   LEAM_LOG_LEVEL    Log level: debug, info, warn, error (default: info)
 */

import WebSocket from 'ws';
import { execSync, exec } from 'child_process';
import os from 'os';

process.title = 'GreenReach-LEAM';
import dgram from 'dgram';
import { createRequire } from 'module';

// ── Configuration ──────────────────────────────────────────────────────
const CENTRAL_WS_URL = process.env.CENTRAL_WS_URL || 'wss://www.greenreachgreens.com';
const API_KEY = process.env.GREENREACH_API_KEY || '';
const FARM_ID = process.env.FARM_ID || '';
const LOG_LEVEL = process.env.LEAM_LOG_LEVEL || 'info';

const VERSION = '1.0.0';
const HEARTBEAT_INTERVAL_MS = 30000;
const RECONNECT_BASE_MS = 2000;
const RECONNECT_MAX_MS = 60000;

// ── Logging ────────────────────────────────────────────────────────────
const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const currentLevel = LOG_LEVELS[LOG_LEVEL] ?? 1;

function log(level, ...args) {
  if ((LOG_LEVELS[level] ?? 1) >= currentLevel) {
    const ts = new Date().toISOString();
    const prefix = `[${ts}] [LEAM] [${level.toUpperCase()}]`;
    if (level === 'error') console.error(prefix, ...args);
    else if (level === 'warn') console.warn(prefix, ...args);
    else console.log(prefix, ...args);
  }
}

// ── BLE Scanner (optional -- requires @abandonware/noble) ──────────────
let noble = null;
try {
  const require = createRequire(import.meta.url);
  noble = require('@abandonware/noble');
  log('info', 'BLE support available (noble loaded)');
} catch {
  log('warn', 'BLE support unavailable (@abandonware/noble not installed). BLE scans will use system_profiler fallback on macOS.');
}

// ── Command Handlers ───────────────────────────────────────────────────

function classifyBleDevice(name, serviceUuids) {
  const n = (name || '').toLowerCase();
  if (n.includes('switchbot') || n.includes('wohand') || n.includes('meter') || n.includes('wosensor')) return 'sensor';
  if (n.includes('speaker') || n.includes('jbl') || n.includes('sonos') || n.includes('airpods') || n.includes('beats')) return 'audio';
  if (n.includes('keyboard') || n.includes('mouse') || n.includes('trackpad')) return 'input';
  if (n.includes('light') || n.includes('bulb') || n.includes('hue') || n.includes('led')) return 'lighting';
  if (n.includes('lock') || n.includes('door')) return 'security';
  if (n.includes('watch') || n.includes('band') || n.includes('fitbit') || n.includes('garmin')) return 'wearable';
  if (n.includes('plug') || n.includes('outlet') || n.includes('power')) return 'power';
  if (n.includes('tv') || n.includes('roku') || n.includes('fire') || n.includes('chromecast')) return 'display';
  return 'unknown';
}

async function bleScanNoble(durationMs) {
  return new Promise((resolve) => {
    const devices = [];
    const seen = new Set();
    const timeout = setTimeout(() => finish(), durationMs);

    function finish() {
      clearTimeout(timeout);
      try { noble.stopScanning(); } catch {}
      noble.removeAllListeners('discover');
      resolve(devices);
    }

    noble.on('discover', (peripheral) => {
      const addr = peripheral.address || peripheral.uuid;
      if (seen.has(addr)) return;
      seen.add(addr);
      devices.push({
        name: peripheral.advertisement?.localName || null,
        address: addr,
        rssi: peripheral.rssi,
        type: classifyBleDevice(peripheral.advertisement?.localName, peripheral.advertisement?.serviceUuids),
        services: peripheral.advertisement?.serviceUuids || [],
      });
    });

    if (noble.state === 'poweredOn') {
      noble.startScanning([], true);
    } else {
      noble.once('stateChange', (state) => {
        if (state === 'poweredOn') noble.startScanning([], true);
        else { clearTimeout(timeout); resolve([]); }
      });
    }
  });
}

async function bleScanFallback() {
  // macOS: use system_profiler for basic BLE info
  try {
    const raw = execSync('system_profiler SPBluetoothDataType -json 2>/dev/null', { timeout: 15000 }).toString();
    const data = JSON.parse(raw);
    const bt = data?.SPBluetoothDataType?.[0];
    const devices = [];

    // Connected devices
    const connected = bt?.device_connected || bt?.devices_connected || [];
    for (const group of (Array.isArray(connected) ? connected : [connected])) {
      if (!group || typeof group !== 'object') continue;
      for (const [name, info] of Object.entries(group)) {
        devices.push({
          name,
          address: info?.device_address || 'unknown',
          rssi: null,
          type: classifyBleDevice(name, []),
          services: [],
          connected: true,
        });
      }
    }

    // Recently discovered
    const notConnected = bt?.device_not_connected || bt?.devices_not_connected || [];
    for (const group of (Array.isArray(notConnected) ? notConnected : [notConnected])) {
      if (!group || typeof group !== 'object') continue;
      for (const [name, info] of Object.entries(group)) {
        devices.push({
          name,
          address: info?.device_address || 'unknown',
          rssi: parseInt(info?.device_rssi) || null,
          type: classifyBleDevice(name, []),
          services: [],
          connected: false,
        });
      }
    }

    return devices;
  } catch (err) {
    log('warn', 'BLE fallback scan failed:', err.message);
    return [];
  }
}

async function handleBleScan(params) {
  const duration = Math.min(params.duration || 10000, 30000);
  log('info', `Starting BLE scan (${duration}ms)`);

  let devices;
  if (noble) {
    devices = await bleScanNoble(duration);
  } else {
    devices = await bleScanFallback();
  }

  return {
    ok: true,
    data: {
      devices,
      count: devices.length,
      duration_ms: duration,
      method: noble ? 'noble' : 'system_profiler',
      timestamp: new Date().toISOString(),
    },
  };
}

async function handleNetworkScan(params) {
  log('info', 'Starting network scan');
  const results = { arp: [], mdns: [], ssdp: [] };

  // ARP table
  if (params.arp !== false) {
    try {
      const raw = execSync('arp -a 2>/dev/null', { timeout: 5000 }).toString();
      for (const line of raw.split('\n')) {
        const match = line.match(/^\?\s*\(([^)]+)\)\s+at\s+([0-9a-f:]+)/i) ||
                      line.match(/^([^\s]+)\s+\(([^)]+)\)\s+at\s+([0-9a-f:]+)/i);
        if (match) {
          const ip = match[1] || match[2];
          const mac = match[2] || match[3];
          const hostname = match[1] !== ip ? match[1] : null;
          if (mac && mac !== '(incomplete)' && mac !== 'ff:ff:ff:ff:ff:ff') {
            results.arp.push({ ip, mac, hostname });
          }
        }
      }
    } catch (err) {
      log('warn', 'ARP scan failed:', err.message);
    }
  }

  // mDNS / Bonjour
  if (params.mdns !== false) {
    try {
      const duration = Math.min(params.duration || 8000, 15000);
      const raw = execSync(`dns-sd -B _services._dns-sd._udp local 2>/dev/null & sleep ${Math.ceil(duration / 2000)} && kill %1 2>/dev/null; dns-sd -B _http._tcp local 2>/dev/null & sleep 2 && kill %1 2>/dev/null`, {
        timeout: duration + 5000,
        shell: '/bin/zsh',
      }).toString();
      const services = new Set();
      for (const line of raw.split('\n')) {
        const m = line.match(/\d+\s+\d+\s+\d+\s+\S+\s+(\S+)\s+(\S+)/);
        if (m) services.add(`${m[1]}.${m[2]}`);
      }
      results.mdns = [...services].map(s => ({ service: s }));
    } catch {
      // dns-sd may not produce clean output -- that's okay
      log('debug', 'mDNS scan returned partial results');
    }

    // Also try mdns-scan or avahi-browse if available
    try {
      const raw = execSync('dns-sd -Z _http._tcp local 2>/dev/null & sleep 3 && kill %1 2>/dev/null', {
        timeout: 8000, shell: '/bin/zsh'
      }).toString();
      for (const line of raw.split('\n')) {
        const m = line.match(/^(\S+)\s+.*\s+(\d+)\s+(\S+)/);
        if (m && m[3] !== 'local.') {
          results.mdns.push({ name: m[1], port: parseInt(m[2]), host: m[3] });
        }
      }
    } catch {}
  }

  // UPnP / SSDP
  if (params.ssdp !== false) {
    try {
      const ssdpDevices = await ssdpScan(Math.min(params.duration || 8000, 12000));
      results.ssdp = ssdpDevices;
    } catch (err) {
      log('warn', 'SSDP scan failed:', err.message);
    }
  }

  const totalDevices = results.arp.length + results.mdns.length + results.ssdp.length;
  return {
    ok: true,
    data: {
      ...results,
      total_devices: totalDevices,
      timestamp: new Date().toISOString(),
    },
  };
}

function ssdpScan(durationMs) {
  return new Promise((resolve) => {
    const devices = [];
    const seen = new Set();
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    const ssdpMsg = Buffer.from(
      'M-SEARCH * HTTP/1.1\r\n' +
      'HOST: 239.255.255.250:1900\r\n' +
      'MAN: "ssdp:discover"\r\n' +
      'MX: 3\r\n' +
      'ST: ssdp:all\r\n' +
      '\r\n'
    );

    const timeout = setTimeout(() => {
      try { socket.close(); } catch {}
      resolve(devices);
    }, durationMs);

    socket.on('message', (msg, rinfo) => {
      const text = msg.toString();
      const location = text.match(/LOCATION:\s*(.+)/i)?.[1]?.trim();
      const server = text.match(/SERVER:\s*(.+)/i)?.[1]?.trim();
      const st = text.match(/ST:\s*(.+)/i)?.[1]?.trim();
      const usn = text.match(/USN:\s*(.+)/i)?.[1]?.trim();

      const key = usn || `${rinfo.address}:${st}`;
      if (seen.has(key)) return;
      seen.add(key);

      devices.push({
        ip: rinfo.address,
        port: rinfo.port,
        server: server || null,
        service_type: st || null,
        location: location || null,
      });
    });

    socket.on('error', () => {
      clearTimeout(timeout);
      try { socket.close(); } catch {}
      resolve(devices);
    });

    socket.bind(() => {
      try {
        socket.addMembership('239.255.255.250');
      } catch {}
      socket.send(ssdpMsg, 0, ssdpMsg.length, 1900, '239.255.255.250');
    });
  });
}

async function handleScanAll(params) {
  const duration = Math.min(params.duration || 12000, 30000);
  log('info', `Starting full scan (${duration}ms)`);

  const [ble, network] = await Promise.all([
    handleBleScan({ duration: Math.min(duration, 15000) }),
    handleNetworkScan({ duration, arp: true, mdns: true, ssdp: true }),
  ]);

  return {
    ok: true,
    data: {
      ble: ble.data,
      network: network.data,
      total_devices: (ble.data?.count || 0) + (network.data?.total_devices || 0),
      timestamp: new Date().toISOString(),
    },
  };
}

function getSystemInfo(detailed) {
  const info = {
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    release: os.release(),
    uptime_hours: Math.round(os.uptime() / 3600 * 10) / 10,
    cpus: os.cpus().length,
    cpu_model: os.cpus()[0]?.model || 'unknown',
    total_memory_gb: Math.round(os.totalmem() / (1024 ** 3) * 10) / 10,
    free_memory_gb: Math.round(os.freemem() / (1024 ** 3) * 10) / 10,
    load_average: os.loadavg(),
    user: os.userInfo().username,
    network_interfaces: {},
  };

  // Network interfaces (non-internal only)
  const ifaces = os.networkInterfaces();
  for (const [name, addrs] of Object.entries(ifaces)) {
    const external = addrs.filter(a => !a.internal);
    if (external.length > 0) {
      info.network_interfaces[name] = external.map(a => ({
        family: a.family,
        address: a.address,
        mac: a.mac,
      }));
    }
  }

  if (!detailed) return info;

  // Extended info for macOS
  if (os.platform() === 'darwin') {
    try {
      const bt = execSync('system_profiler SPBluetoothDataType -json 2>/dev/null', { timeout: 10000 }).toString();
      const btData = JSON.parse(bt);
      const controller = btData?.SPBluetoothDataType?.[0]?.controller_properties || btData?.SPBluetoothDataType?.[0];
      info.bluetooth = {
        state: controller?.controller_state || controller?.controller_chipset ? 'available' : 'unknown',
        chipset: controller?.controller_chipset || null,
        address: controller?.controller_address || null,
      };
    } catch {}

    try {
      const wifi = execSync('/System/Library/PrivateFrameworks/Apple80211.framework/Resources/airport -I 2>/dev/null', { timeout: 5000 }).toString();
      const ssid = wifi.match(/\bSSID:\s*(.+)/)?.[1]?.trim();
      const bssid = wifi.match(/\bBSSID:\s*(.+)/)?.[1]?.trim();
      const rssi = wifi.match(/agrCtlRSSI:\s*(-?\d+)/)?.[1];
      const channel = wifi.match(/channel:\s*(\S+)/)?.[1];
      info.wifi = { ssid, bssid, rssi: rssi ? parseInt(rssi) : null, channel };
    } catch {}

    try {
      const usb = execSync('system_profiler SPUSBDataType -json 2>/dev/null', { timeout: 10000 }).toString();
      const usbData = JSON.parse(usb);
      const devices = [];
      function extractUsb(items) {
        if (!Array.isArray(items)) return;
        for (const item of items) {
          if (item._name && !item._name.includes('USB Bus')) {
            devices.push({ name: item._name, vendor: item.manufacturer || null });
          }
          if (item._items) extractUsb(item._items);
        }
      }
      extractUsb(usbData?.SPUSBDataType);
      info.usb_devices = devices;
    } catch {}

    try {
      const disk = execSync("df -h / | tail -1 | awk '{print $2, $3, $4, $5}'", { timeout: 5000 }).toString().trim().split(' ');
      info.disk = { total: disk[0], used: disk[1], available: disk[2], percent: disk[3] };
    } catch {}

    try {
      const battery = execSync('pmset -g batt 2>/dev/null', { timeout: 5000 }).toString();
      const pct = battery.match(/(\d+)%/)?.[1];
      const charging = battery.includes('charging') || battery.includes('AC Power');
      if (pct) info.battery = { percent: parseInt(pct), charging };
    } catch {}
  }

  return info;
}

async function handleSystemInfo(params) {
  const detailed = params.detailed || params.command === 'system_detailed';
  log('info', `Gathering system info (detailed: ${detailed})`);
  const info = getSystemInfo(detailed);
  return { ok: true, data: info };
}

// ── Command Dispatch ───────────────────────────────────────────────────

const COMMAND_HANDLERS = {
  scan_all: handleScanAll,
  ble_scan: handleBleScan,
  network_scan: handleNetworkScan,
  system_info: (params) => handleSystemInfo({ ...params, detailed: false }),
  system_detailed: (params) => handleSystemInfo({ ...params, detailed: true }),
};

async function dispatchCommand(id, command, params) {
  const handler = COMMAND_HANDLERS[command];
  if (!handler) {
    return { id, ok: false, error: `Unknown command: ${command}` };
  }

  try {
    const result = await handler(params || {});
    return { id, type: 'leam_response', ...result };
  } catch (err) {
    log('error', `Command '${command}' failed:`, err.message);
    return { id, type: 'leam_response', ok: false, error: err.message };
  }
}

// ── WebSocket Connection ───────────────────────────────────────────────

let ws = null;
let heartbeatTimer = null;
let reconnectAttempt = 0;
let shuttingDown = false;

function buildWsUrl() {
  const url = new URL(CENTRAL_WS_URL);
  if (API_KEY) url.searchParams.set('token', ''); // not JWT -- use headers
  return url.toString();
}

function connect() {
  if (shuttingDown) return;

  const wsUrl = buildWsUrl();
  log('info', `Connecting to Central: ${CENTRAL_WS_URL}`);

  ws = new WebSocket(wsUrl, {
    headers: {
      'x-api-key': API_KEY,
      'x-farm-id': FARM_ID,
    },
    handshakeTimeout: 10000,
  });

  ws.on('open', () => {
    log('info', 'Connected to Central WebSocket');
    reconnectAttempt = 0;

    // Register as LEAM client
    ws.send(JSON.stringify({
      type: 'leam_register',
      version: VERSION,
      capabilities: Object.keys(COMMAND_HANDLERS),
      system: {
        hostname: os.hostname(),
        platform: os.platform(),
        arch: os.arch(),
        node: process.version,
        ble_available: !!noble,
      },
    }));

    // Start heartbeat
    heartbeatTimer = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'leam_heartbeat' }));
      }
    }, HEARTBEAT_INTERVAL_MS);
  });

  ws.on('message', async (raw) => {
    let data;
    try {
      data = JSON.parse(raw.toString());
    } catch {
      log('warn', 'Received non-JSON message');
      return;
    }

    if (data.type === 'leam_registered') {
      log('info', `Registration confirmed by Central (farm: ${data.farmId})`);
      return;
    }

    if (data.type === 'leam_command') {
      log('info', `Received command: ${data.command} (id: ${data.id})`);
      const result = await dispatchCommand(data.id, data.command, data.params);
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(result));
        log('info', `Command '${data.command}' completed (ok: ${result.ok})`);
      }
      return;
    }

    if (data.type === 'connection') {
      log('debug', 'Central welcome:', data.message);
      return;
    }

    log('debug', 'Unhandled message type:', data.type);
  });

  ws.on('close', (code, reason) => {
    log('warn', `WebSocket closed (code: ${code}, reason: ${reason || 'none'})`);
    cleanup();
    scheduleReconnect();
  });

  ws.on('error', (err) => {
    log('error', 'WebSocket error:', err.message);
    // 'close' event will follow
  });
}

function cleanup() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  ws = null;
}

function scheduleReconnect() {
  if (shuttingDown) return;
  reconnectAttempt++;
  const delay = Math.min(RECONNECT_BASE_MS * Math.pow(2, Math.min(reconnectAttempt - 1, 5)), RECONNECT_MAX_MS);
  log('info', `Reconnecting in ${Math.round(delay / 1000)}s (attempt ${reconnectAttempt})`);
  setTimeout(connect, delay);
}

// ── Lifecycle ──────────────────────────────────────────────────────────

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  log('info', 'Shutting down LEAM agent');
  cleanup();
  if (ws) {
    try { ws.close(1000, 'LEAM shutting down'); } catch {}
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// ── Startup ────────────────────────────────────────────────────────────

if (!API_KEY) {
  log('error', 'GREENREACH_API_KEY is required. Set it in your environment or launchd plist.');
  process.exit(1);
}

if (!FARM_ID) {
  log('error', 'FARM_ID is required. Set it in your environment or launchd plist.');
  process.exit(1);
}

log('info', `LEAM Agent v${VERSION} starting`);
log('info', `Farm: ${FARM_ID}`);
log('info', `Host: ${os.hostname()} (${os.platform()} ${os.arch()})`);
log('info', `BLE: ${noble ? 'noble' : 'system_profiler fallback'}`);
log('info', `Target: ${CENTRAL_WS_URL}`);

connect();
