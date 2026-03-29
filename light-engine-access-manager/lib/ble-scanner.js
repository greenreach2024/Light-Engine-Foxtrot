/**
 * BLE Scanner Module — Light Engine Access Manager
 * =================================================
 * Scans for nearby Bluetooth Low Energy devices using the host machine's
 * Bluetooth radio via @abandonware/noble. Returns structured device objects
 * compatible with the EVIE tool catalog format.
 *
 * Capabilities:
 *   - Passive BLE scanning (all nearby advertisers)
 *   - Active scanning with service UUID filtering
 *   - Continuous background monitoring with change detection
 *   - Device classification (sensor, speaker, display, plug, unknown)
 */

let noble = null;
let bleAvailable = false;
const discoveredDevices = new Map(); // id -> device record
let scanTimer = null;

// Common BLE service UUIDs mapped to device categories
const SERVICE_CATEGORIES = {
  '1800': 'generic_access',
  '1801': 'generic_attribute',
  '180a': 'device_information',
  '180f': 'battery_service',
  '1810': 'blood_pressure',       // health sensor
  '1816': 'cycling_speed',         // fitness
  '181a': 'environmental_sensing', // temp/humidity sensors
  '181c': 'user_data',
  '1812': 'hid',                   // keyboards, mice
  '110b': 'audio_sink',            // speakers, headphones
  '110a': 'audio_source',
  '111e': 'handsfree',
  'fe95': 'xiaomi_miio',           // Xiaomi smart home
  'fee7': 'tencent',
  'cba20d00-224d-11e6-9fb8-0002a5d5c51b': 'switchbot',
  'fef5': 'dialog_semi',           // smart plugs (Dialog chipset)
};

// Name pattern -> device type heuristics
const NAME_PATTERNS = [
  { pattern: /switchbot|woiosensor|meter|hub\s*mini/i, type: 'sensor', brand: 'SwitchBot' },
  { pattern: /jbl|bose|sonos|speaker|soundbar|echo|homepod|airpods|beats|buds/i, type: 'speaker' },
  { pattern: /samsung.*tv|lg.*tv|roku|fire.*tv|chromecast|apple.*tv|shield/i, type: 'display' },
  { pattern: /smart\s*plug|kasa|shelly|wemo|tp-link|tapo|tuya|meross/i, type: 'smart_plug' },
  { pattern: /bulb|light|hue|lifx|nanoleaf|wiz/i, type: 'smart_light' },
  { pattern: /lock|august|yale|schlage/i, type: 'smart_lock' },
  { pattern: /thermo|ecobee|nest|sensor|temp|humid|air\s*quality/i, type: 'sensor' },
  { pattern: /watch|band|fitbit|garmin|whoop/i, type: 'wearable' },
  { pattern: /keyboard|mouse|trackpad/i, type: 'input_device' },
  { pattern: /phone|iphone|galaxy|pixel/i, type: 'phone' },
  { pattern: /macbook|laptop|ipad|tablet/i, type: 'computer' },
  { pattern: /printer|scan/i, type: 'printer' },
];

function classifyDevice(name, serviceUuids) {
  // Check name patterns first (highest signal)
  if (name) {
    for (const { pattern, type, brand } of NAME_PATTERNS) {
      if (pattern.test(name)) return { type, brand };
    }
  }

  // Check advertised service UUIDs
  if (serviceUuids && serviceUuids.length > 0) {
    for (const uuid of serviceUuids) {
      const cat = SERVICE_CATEGORIES[uuid.toLowerCase()];
      if (cat === 'audio_sink' || cat === 'audio_source' || cat === 'handsfree') {
        return { type: 'speaker' };
      }
      if (cat === 'environmental_sensing') return { type: 'sensor' };
      if (cat === 'switchbot') return { type: 'sensor', brand: 'SwitchBot' };
      if (cat === 'hid') return { type: 'input_device' };
    }
  }

  return { type: 'unknown' };
}

async function init() {
  try {
    const nobleModule = await import('@abandonware/noble');
    noble = nobleModule.default || nobleModule;
    bleAvailable = true;
    console.log('[LEAM:BLE] Noble loaded — Bluetooth radio available');
  } catch (err) {
    console.warn('[LEAM:BLE] @abandonware/noble not available:', err.message);
    console.warn('[LEAM:BLE] BLE scanning disabled. Install with: npm install @abandonware/noble');
    bleAvailable = false;
  }
}

function isAvailable() {
  return bleAvailable && noble !== null;
}

function getState() {
  if (!noble) return 'unavailable';
  return noble.state || 'unknown';
}

/**
 * Perform a one-shot BLE scan for a given duration.
 * @param {object} opts
 * @param {number} opts.duration  - Scan duration in ms (default 10000)
 * @param {string[]} opts.serviceUuids - Filter by service UUIDs (empty = all)
 * @param {boolean} opts.allowDuplicates - Report same device multiple times
 * @returns {Promise<object[]>} Array of discovered device records
 */
function scan({ duration = 10000, serviceUuids = [], allowDuplicates = false } = {}) {
  return new Promise((resolve, reject) => {
    if (!bleAvailable || !noble) {
      return reject(new Error('BLE not available — no Bluetooth radio or noble not installed'));
    }

    const onStateChange = (state) => {
      if (state === 'poweredOn') {
        noble.removeListener('stateChange', onStateChange);
        startScan();
      } else if (state === 'poweredOff') {
        noble.removeListener('stateChange', onStateChange);
        reject(new Error('Bluetooth radio is powered off'));
      }
    };

    const startScan = () => {
      const results = [];

      const onDiscover = (peripheral) => {
        const deviceId = peripheral.id || peripheral.uuid || 'unknown';
        const record = {
          id: deviceId,
          name: peripheral.advertisement?.localName || null,
          mac: peripheral.address || null,
          rssi: peripheral.rssi,
          addressType: peripheral.addressType,
          serviceUuids: peripheral.advertisement?.serviceUuids || [],
          manufacturerData: peripheral.advertisement?.manufacturerData
            ? peripheral.advertisement.manufacturerData.toString('hex')
            : null,
          txPowerLevel: peripheral.advertisement?.txPowerLevel ?? null,
          connectable: peripheral.connectable ?? null,
          ...classifyDevice(
            peripheral.advertisement?.localName,
            peripheral.advertisement?.serviceUuids
          ),
          discoveredAt: new Date().toISOString(),
          source: 'ble'
        };

        // Update persistent map
        discoveredDevices.set(deviceId, record);
        results.push(record);
      };

      noble.on('discover', onDiscover);
      noble.startScanning(serviceUuids, allowDuplicates, (err) => {
        if (err) {
          noble.removeListener('discover', onDiscover);
          return reject(err);
        }
      });

      // Stop after duration
      scanTimer = setTimeout(() => {
        noble.stopScanning();
        noble.removeListener('discover', onDiscover);
        resolve(results);
      }, duration);
    };

    // If already powered on, start immediately
    if (noble.state === 'poweredOn') {
      startScan();
    } else {
      noble.on('stateChange', onStateChange);
    }
  });
}

/**
 * Stop any running scan.
 */
function stopScan() {
  if (scanTimer) {
    clearTimeout(scanTimer);
    scanTimer = null;
  }
  if (noble && bleAvailable) {
    try { noble.stopScanning(); } catch { /* ignore */ }
  }
}

/**
 * Return all devices discovered across all scans (persistent cache).
 */
function getDiscoveredDevices() {
  return Array.from(discoveredDevices.values());
}

/**
 * Clear the discovered devices cache.
 */
function clearCache() {
  discoveredDevices.clear();
}

export default { init, isAvailable, getState, scan, stopScan, getDiscoveredDevices, clearCache };
