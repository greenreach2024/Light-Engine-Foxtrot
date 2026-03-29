/**
 * System Info Module — Light Engine Access Manager
 * ==================================================
 * Collects hardware and OS information from the host machine.
 * Used by EVIE for diagnostics, environment awareness, and
 * adaptive recommendations.
 */

import os from 'os';

let si = null;
let siAvailable = false;

async function init() {
  try {
    si = await import('systeminformation');
    siAvailable = true;
    console.log('[LEAM:SYS] systeminformation loaded');
  } catch {
    console.warn('[LEAM:SYS] systeminformation not available — basic info only');
  }
}

/**
 * Quick snapshot: OS, CPU, memory, uptime. No external dependency needed.
 */
function getBasicInfo() {
  const cpus = os.cpus();
  return {
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    release: os.release(),
    uptime: os.uptime(),
    totalMemory: os.totalmem(),
    freeMemory: os.freemem(),
    usedMemoryPercent: Math.round((1 - os.freemem() / os.totalmem()) * 100),
    cpuModel: cpus[0]?.model || 'unknown',
    cpuCores: cpus.length,
    loadAvg: os.loadavg(),
    user: os.userInfo().username,
    homeDir: os.homedir(),
    tmpDir: os.tmpdir()
  };
}

/**
 * Detailed system snapshot using systeminformation (if available).
 * Includes: Bluetooth controller info, WiFi adapters, USB devices, disk usage.
 */
async function getDetailedInfo() {
  const basic = getBasicInfo();
  if (!siAvailable || !si) return { ...basic, detailed: false };

  try {
    const [bluetooth, wifi, usb, disk, battery, network, graphics] = await Promise.all([
      si.bluetoothDevices().catch(() => []),
      si.wifiNetworks().catch(() => []),
      si.usb().catch(() => []),
      si.fsSize().catch(() => []),
      si.battery().catch(() => ({})),
      si.networkInterfaces().catch(() => []),
      si.graphics().catch(() => ({ controllers: [], displays: [] }))
    ]);

    return {
      ...basic,
      detailed: true,
      bluetooth: {
        devices: bluetooth.map(d => ({
          name: d.name,
          macDevice: d.macDevice,
          macHost: d.macHost,
          batteryPercent: d.batteryPercent,
          type: d.type,
          connected: d.connected
        }))
      },
      wifi: {
        networks: wifi.map(n => ({
          ssid: n.ssid,
          bssid: n.bssid,
          channel: n.channel,
          frequency: n.frequency,
          signalLevel: n.signalLevel,
          security: n.security,
          quality: n.quality
        }))
      },
      usb: usb.map(d => ({
        id: d.id,
        name: d.name,
        type: d.type,
        vendor: d.vendor,
        serial: d.serial ? '[redacted]' : null
      })),
      disk: disk.map(d => ({
        fs: d.fs,
        type: d.type,
        size: d.size,
        used: d.used,
        available: d.available,
        usePercent: d.use
      })),
      battery: battery.hasBattery ? {
        percent: battery.percent,
        isCharging: battery.isCharging,
        timeRemaining: battery.timeRemaining,
        acConnected: battery.acConnected
      } : null,
      displays: graphics.displays?.map(d => ({
        model: d.model,
        resolution: `${d.resolutionX}x${d.resolutionY}`,
        connection: d.connection,
        main: d.main
      })) || [],
      networkAdapters: network.filter(n => !n.internal).map(n => ({
        iface: n.iface,
        type: n.type,
        ip4: n.ip4,
        mac: n.mac,
        speed: n.speed,
        operstate: n.operstate
      }))
    };
  } catch (err) {
    return { ...basic, detailed: false, error: err.message };
  }
}

/**
 * Get current resource usage (CPU load, memory, active processes).
 */
async function getResourceUsage() {
  const basic = {
    loadAvg: os.loadavg(),
    memoryUsedPercent: Math.round((1 - os.freemem() / os.totalmem()) * 100),
    freeMemoryMB: Math.round(os.freemem() / 1024 / 1024),
    uptime: os.uptime()
  };

  if (!siAvailable || !si) return basic;

  try {
    const [cpuLoad, processes] = await Promise.all([
      si.currentLoad().catch(() => null),
      si.processes().catch(() => null)
    ]);

    return {
      ...basic,
      cpuLoad: cpuLoad ? {
        current: Math.round(cpuLoad.currentLoad),
        idle: Math.round(cpuLoad.currentLoadIdle)
      } : null,
      processes: processes ? {
        all: processes.all,
        running: processes.running,
        sleeping: processes.sleeping,
        topCPU: processes.list
          ?.sort((a, b) => b.cpu - a.cpu)
          .slice(0, 5)
          .map(p => ({ name: p.name, cpu: p.cpu, mem: p.mem }))
      } : null
    };
  } catch {
    return basic;
  }
}

export default { init, getBasicInfo, getDetailedInfo, getResourceUsage };
