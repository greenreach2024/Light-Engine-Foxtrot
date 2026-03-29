/**
 * Command Handler — Light Engine Access Manager
 * ===============================================
 * Routes incoming commands from Central (via WebSocket) to the
 * appropriate local module and returns structured results.
 *
 * Command format (inbound):
 *   { id: 'uuid', command: 'ble_scan', params: { duration: 10000 } }
 *
 * Response format (outbound):
 *   { id: 'uuid', command: 'ble_scan', ok: true, data: {...}, duration_ms: 1234 }
 */

import bleScanner from './ble-scanner.js';
import netScanner from './network-scanner.js';
import systemInfo from './system-info.js';

const COMMAND_REGISTRY = {
  // ── BLE Commands ──────────────────────────────────────────────────
  'ble_scan': {
    description: 'Scan for nearby BLE devices using the host Bluetooth radio',
    category: 'scan',
    handler: async (params) => {
      const devices = await bleScanner.scan({
        duration: Math.min(params.duration || 10000, 30000), // cap at 30s
        serviceUuids: params.serviceUuids || [],
        allowDuplicates: false
      });
      return { devices, count: devices.length };
    }
  },

  'ble_status': {
    description: 'Check if BLE radio is available and its current state',
    category: 'info',
    handler: async () => ({
      available: bleScanner.isAvailable(),
      state: bleScanner.getState()
    })
  },

  'ble_cached': {
    description: 'Return all BLE devices found across previous scans',
    category: 'info',
    handler: async () => ({
      devices: bleScanner.getDiscoveredDevices(),
      count: bleScanner.getDiscoveredDevices().length
    })
  },

  'ble_stop': {
    description: 'Stop any running BLE scan',
    category: 'control',
    handler: async () => {
      bleScanner.stopScan();
      return { stopped: true };
    }
  },

  // ── Network Commands ──────────────────────────────────────────────
  'network_scan': {
    description: 'Full network scan: ARP + mDNS + SSDP/UPnP discovery',
    category: 'scan',
    handler: async (params) => {
      return await netScanner.scanAll({
        arp: params.arp !== false,
        mdns: params.mdns !== false,
        ssdp: params.ssdp !== false,
        duration: Math.min(params.duration || 8000, 20000)
      });
    }
  },

  'network_arp': {
    description: 'Scan ARP table for recently-active network devices',
    category: 'scan',
    handler: async () => {
      const devices = await netScanner.scanARP();
      return { devices, count: devices.length };
    }
  },

  'network_mdns': {
    description: 'Browse for mDNS/Bonjour services (AirPlay, HomeKit, printers, etc.)',
    category: 'scan',
    handler: async (params) => {
      const devices = await netScanner.scanMDNS({
        duration: Math.min(params.duration || 8000, 20000),
        types: params.types || null
      });
      return { devices, count: devices.length };
    }
  },

  'network_ssdp': {
    description: 'UPnP/SSDP discovery for smart TVs, media renderers, routers',
    category: 'scan',
    handler: async (params) => {
      const devices = await netScanner.scanSSDP({
        duration: Math.min(params.duration || 6000, 15000)
      });
      return { devices, count: devices.length };
    }
  },

  'network_interfaces': {
    description: 'List local network interfaces (IP, MAC, subnet)',
    category: 'info',
    handler: async () => ({
      interfaces: netScanner.getLocalInterfaces()
    })
  },

  // ── Unified Scan ──────────────────────────────────────────────────
  'scan_all': {
    description: 'Full device scan: BLE + ARP + mDNS + SSDP (all protocols)',
    category: 'scan',
    handler: async (params) => {
      const duration = Math.min(params.duration || 12000, 30000);
      const [bleResult, netResult] = await Promise.all([
        bleScanner.isAvailable()
          ? bleScanner.scan({ duration }).catch(err => ({ error: err.message, devices: [] }))
          : Promise.resolve({ devices: [], error: 'BLE not available' }),
        netScanner.scanAll({ duration }).catch(err => ({ error: err.message, devices: [] }))
      ]);

      const bleDevices = bleResult.devices || bleResult || [];
      const netDevices = netResult.devices || [];

      return {
        ble: {
          available: bleScanner.isAvailable(),
          devices: Array.isArray(bleDevices) ? bleDevices : [],
          count: Array.isArray(bleDevices) ? bleDevices.length : 0,
          error: bleResult.error || null
        },
        network: {
          interfaces: netResult.interfaces || netScanner.getLocalInterfaces(),
          devices: netDevices,
          counts: netResult.counts || { total: netDevices.length }
        },
        totalDevices: (Array.isArray(bleDevices) ? bleDevices.length : 0) + netDevices.length,
        scannedAt: new Date().toISOString()
      };
    }
  },

  // ── System Commands ───────────────────────────────────────────────
  'system_info': {
    description: 'Basic system info: OS, CPU, memory, hostname',
    category: 'info',
    handler: async () => systemInfo.getBasicInfo()
  },

  'system_detailed': {
    description: 'Detailed system info: Bluetooth controller, WiFi, USB, disk, battery, displays',
    category: 'info',
    handler: async () => await systemInfo.getDetailedInfo()
  },

  'system_resources': {
    description: 'Current resource usage: CPU load, memory, top processes',
    category: 'info',
    handler: async () => await systemInfo.getResourceUsage()
  },

  // ── LEAM Meta Commands ────────────────────────────────────────────
  'leam_status': {
    description: 'LEAM companion status: version, uptime, available modules',
    category: 'info',
    handler: async () => ({
      version: '1.0.0',
      uptime: process.uptime(),
      modules: {
        ble: bleScanner.isAvailable(),
        network: true,
        system: true
      },
      pid: process.pid,
      nodeVersion: process.version
    })
  },

  'leam_capabilities': {
    description: 'List all available LEAM commands with descriptions',
    category: 'info',
    handler: async () => ({
      commands: Object.entries(COMMAND_REGISTRY).map(([name, def]) => ({
        command: name,
        description: def.description,
        category: def.category
      }))
    })
  }
};

/**
 * Execute a command by name.
 * @param {string} command - Command name
 * @param {object} params - Command parameters
 * @returns {Promise<object>} Response with ok, data, and timing
 */
async function execute(command, params = {}) {
  const start = Date.now();
  const def = COMMAND_REGISTRY[command];

  if (!def) {
    return {
      ok: false,
      error: `Unknown command: ${command}`,
      available: Object.keys(COMMAND_REGISTRY)
    };
  }

  try {
    const data = await def.handler(params);
    return {
      ok: true,
      data,
      duration_ms: Date.now() - start
    };
  } catch (err) {
    return {
      ok: false,
      error: err.message,
      duration_ms: Date.now() - start
    };
  }
}

/**
 * Get the command catalog (for EVIE tool registration).
 */
function getCatalog() {
  return Object.entries(COMMAND_REGISTRY).map(([name, def]) => ({
    command: name,
    description: def.description,
    category: def.category
  }));
}

export { COMMAND_REGISTRY, execute, getCatalog };
export default { execute, getCatalog, COMMAND_REGISTRY };
