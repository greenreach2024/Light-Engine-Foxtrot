/**
 * Network Scanner Module — Light Engine Access Manager
 * =====================================================
 * Discovers devices on the local network using multiple protocols:
 *   - ARP table parsing (instant, finds all recently-active IP devices)
 *   - mDNS/Bonjour browsing (finds advertised services)
 *   - UPnP/SSDP discovery (finds smart TVs, media devices, routers)
 *   - Ping sweep fallback (active probing)
 *
 * All results are normalized into a common device record format.
 */

import { execFile } from 'child_process';
import { networkInterfaces } from 'os';
import dgram from 'dgram';
import Bonjour from 'bonjour-service';

const discoveredDevices = new Map(); // ip -> device record

// ============================================================================
// ARP Table Scanner
// ============================================================================

/**
 * Parse the system ARP table for recently-seen network devices.
 * Works on macOS and Linux without elevated privileges.
 */
function scanARP() {
  return new Promise((resolve) => {
    const cmd = process.platform === 'darwin' ? 'arp' : 'arp';
    const args = process.platform === 'darwin' ? ['-a'] : ['-a'];

    execFile(cmd, args, { timeout: 10000 }, (err, stdout) => {
      if (err) {
        console.warn('[LEAM:NET] ARP scan failed:', err.message);
        return resolve([]);
      }

      const devices = [];
      const lines = stdout.split('\n');
      for (const line of lines) {
        // macOS: hostname (ip) at mac on iface [ethernet/wifi]
        // Linux: hostname (ip) at mac [ether] on iface
        const match = line.match(/\((\d+\.\d+\.\d+\.\d+)\)\s+at\s+([0-9a-f:]+)/i);
        if (match) {
          const ip = match[1];
          const mac = match[2].toLowerCase();
          if (mac === 'ff:ff:ff:ff:ff:ff' || mac === '(incomplete)') continue;

          // Extract hostname if present
          const hostMatch = line.match(/^(\S+)\s+\(/);
          const hostname = hostMatch ? hostMatch[1] : null;

          devices.push({
            id: `net-${mac.replace(/:/g, '')}`,
            ip,
            mac,
            name: hostname !== '?' ? hostname : null,
            source: 'arp',
            discoveredAt: new Date().toISOString()
          });
        }
      }
      resolve(devices);
    });
  });
}

// ============================================================================
// mDNS / Bonjour Scanner
// ============================================================================

/**
 * Browse for mDNS services on the local network.
 * @param {object} opts
 * @param {number} opts.duration - Browse time in ms (default 8000)
 * @param {string[]} opts.types - Service types to browse (default: common types)
 */
function scanMDNS({ duration = 8000, types = null } = {}) {
  return new Promise((resolve) => {
    const bonjour = new Bonjour.default();
    const devices = [];
    const seen = new Set();

    const defaultTypes = [
      'http', 'https', 'hap',       // HomeKit
      'airplay', 'raop',            // AirPlay speakers/TVs
      'googlecast',                  // Chromecast
      'smb', 'afpovertcp',          // file shares
      'ipp', 'printer',             // printers
      'spotify-connect',            // Spotify speakers
      'mqtt',                        // IoT brokers
      'ssh', 'sftp-ssh',            // SSH servers
      'daap',                        // iTunes/DAAP
      'workstation',                 // Bonjour workstations
    ];

    const browseTypes = types || defaultTypes;
    const browsers = [];

    for (const type of browseTypes) {
      const browser = bonjour.find({ type }, (service) => {
        const key = `${service.host}:${service.port}:${service.type}`;
        if (seen.has(key)) return;
        seen.add(key);

        const record = {
          id: `mdns-${service.host}-${service.port}`,
          name: service.name || service.host,
          host: service.host,
          ip: service.addresses?.[0] || null,
          port: service.port,
          serviceType: service.type,
          protocol: type,
          txt: service.txt || {},
          type: classifyMDNSService(type, service.name),
          source: 'mdns',
          discoveredAt: new Date().toISOString()
        };

        devices.push(record);
      });
      browsers.push(browser);
    }

    setTimeout(() => {
      for (const b of browsers) {
        try { b.stop(); } catch { /* ignore */ }
      }
      bonjour.destroy();
      resolve(devices);
    }, duration);
  });
}

function classifyMDNSService(type, name) {
  const n = (name || '').toLowerCase();
  if (['airplay', 'raop', 'spotify-connect'].includes(type)) return 'speaker';
  if (type === 'googlecast') {
    if (/tv|shield|roku/i.test(n)) return 'display';
    return 'speaker'; // Chromecast Audio or generic
  }
  if (type === 'hap') return 'homekit_device';
  if (['ipp', 'printer'].includes(type)) return 'printer';
  if (['smb', 'afpovertcp'].includes(type)) return 'file_server';
  if (['ssh', 'sftp-ssh'].includes(type)) return 'computer';
  if (type === 'mqtt') return 'iot_broker';
  if (type === 'http' || type === 'https') return 'web_service';
  if (type === 'workstation') return 'computer';
  return 'network_service';
}

// ============================================================================
// UPnP / SSDP Scanner
// ============================================================================

/**
 * Send an SSDP M-SEARCH and collect responses.
 * Finds UPnP devices: smart TVs, media renderers, routers, etc.
 * @param {object} opts
 * @param {number} opts.duration - Listen time in ms (default 6000)
 */
function scanSSDP({ duration = 6000 } = {}) {
  return new Promise((resolve) => {
    const devices = [];
    const seen = new Set();

    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    const SSDP_ADDR = '239.255.255.250';
    const SSDP_PORT = 1900;
    const SEARCH_MSG = Buffer.from(
      'M-SEARCH * HTTP/1.1\r\n' +
      'HOST: 239.255.255.250:1900\r\n' +
      'MAN: "ssdp:discover"\r\n' +
      'ST: ssdp:all\r\n' +
      'MX: 3\r\n' +
      '\r\n'
    );

    socket.on('message', (msg, rinfo) => {
      const text = msg.toString();
      const key = rinfo.address;
      if (seen.has(key)) return;
      seen.add(key);

      // Parse headers
      const server = extractHeader(text, 'SERVER');
      const location = extractHeader(text, 'LOCATION');
      const st = extractHeader(text, 'ST') || extractHeader(text, 'NT');
      const usn = extractHeader(text, 'USN');

      const record = {
        id: `ssdp-${rinfo.address.replace(/\./g, '-')}`,
        ip: rinfo.address,
        name: server || null,
        location,
        serviceType: st,
        usn,
        type: classifySSDPDevice(server, st),
        source: 'ssdp',
        discoveredAt: new Date().toISOString()
      };

      devices.push(record);
    });

    socket.on('error', (err) => {
      console.warn('[LEAM:NET] SSDP error:', err.message);
    });

    socket.bind(() => {
      socket.addMembership(SSDP_ADDR);
      socket.send(SEARCH_MSG, 0, SEARCH_MSG.length, SSDP_PORT, SSDP_ADDR);
    });

    setTimeout(() => {
      try { socket.close(); } catch { /* ignore */ }
      resolve(devices);
    }, duration);
  });
}

function extractHeader(text, name) {
  const regex = new RegExp(`^${name}:\\s*(.+)$`, 'im');
  const match = text.match(regex);
  return match ? match[1].trim() : null;
}

function classifySSDPDevice(server, st) {
  const s = ((server || '') + (st || '')).toLowerCase();
  if (/samsung|lg|roku|fire.*tv|vizio|sony.*bravia|panasonic.*viera/i.test(s)) return 'display';
  if (/mediarenderer/i.test(s)) return 'media_renderer';
  if (/sonos|bose|denon|yamaha|harman/i.test(s)) return 'speaker';
  if (/router|gateway|upnp.*wan|upnp.*device/i.test(s)) return 'router';
  if (/printer/i.test(s)) return 'printer';
  return 'upnp_device';
}

// ============================================================================
// Unified Scan
// ============================================================================

/**
 * Get the local machine's network interfaces (non-internal).
 */
function getLocalInterfaces() {
  const ifaces = networkInterfaces();
  const results = [];
  for (const [name, addrs] of Object.entries(ifaces)) {
    for (const addr of addrs) {
      if (!addr.internal && addr.family === 'IPv4') {
        results.push({ name, ip: addr.address, mac: addr.mac, netmask: addr.netmask });
      }
    }
  }
  return results;
}

/**
 * Run all network discovery methods in parallel and merge results.
 * @param {object} opts
 * @param {boolean} opts.arp   - Enable ARP scan (default true)
 * @param {boolean} opts.mdns  - Enable mDNS scan (default true)
 * @param {boolean} opts.ssdp  - Enable SSDP scan (default true)
 * @param {number}  opts.duration - Duration for active scans in ms (default 8000)
 */
async function scanAll({ arp = true, mdns = true, ssdp = true, duration = 8000 } = {}) {
  const promises = [];
  if (arp) promises.push(scanARP().catch(() => []));
  if (mdns) promises.push(scanMDNS({ duration }).catch(() => []));
  if (ssdp) promises.push(scanSSDP({ duration }).catch(() => []));

  const results = await Promise.all(promises);
  const merged = [];

  for (const batch of results) {
    for (const device of batch) {
      discoveredDevices.set(device.id, device);
      merged.push(device);
    }
  }

  return {
    interfaces: getLocalInterfaces(),
    devices: merged,
    counts: {
      arp: arp ? results[0]?.length || 0 : 0,
      mdns: mdns ? results[arp ? 1 : 0]?.length || 0 : 0,
      ssdp: ssdp ? results[results.length - 1]?.length || 0 : 0,
      total: merged.length
    },
    scannedAt: new Date().toISOString()
  };
}

function getDiscoveredDevices() {
  return Array.from(discoveredDevices.values());
}

function clearCache() {
  discoveredDevices.clear();
}

export default { scanARP, scanMDNS, scanSSDP, scanAll, getLocalInterfaces, getDiscoveredDevices, clearCache };
