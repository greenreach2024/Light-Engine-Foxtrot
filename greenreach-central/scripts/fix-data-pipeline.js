#!/usr/bin/env node
/**
 * Fix Data Pipeline — One-time script to sync/create/fix all broken data files.
 * Run: node scripts/fix-data-pipeline.js
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'public', 'data');

function readJSON(filename) {
  const fp = path.join(DATA_DIR, filename);
  if (!fs.existsSync(fp)) return null;
  return JSON.parse(fs.readFileSync(fp, 'utf8'));
}

function writeJSON(filename, data) {
  const fp = path.join(DATA_DIR, filename);
  fs.writeFileSync(fp, JSON.stringify(data, null, 2));
  console.log(`  ✓ ${filename} (${(fs.statSync(fp).size / 1024).toFixed(1)} KB)`);
}

console.log('\n=== Fix Data Pipeline ===\n');

// ---------------------------------------------------------------------------
// 1. device-meta.json — Sync from iot-devices.json
// ---------------------------------------------------------------------------
console.log('1. Syncing device-meta.json from iot-devices.json...');
const iotDevices = readJSON('iot-devices.json') || [];
const devices = {};
for (const d of iotDevices) {
  devices[d.id] = {
    name: d.name,
    type: (d.type || '').toLowerCase().includes('hub') ? 'hub' : 'sensor',
    protocol: d.protocol || 'switchbot',
    brand: d.brand || '',
    model: d.model || '',
    room_id: d.location ? 'room-3xxjln' : null,
    zone: d.zone ? `zone-${d.zone}` : null,
    status: 'online',
    registered_at: d.lastSeen || new Date().toISOString(),
    registered_by: 'scan_devices',
    assigned_at: d.zone ? (d.lastSeen || new Date().toISOString()) : null,
    assigned_by: d.zone ? 'scan_devices' : null,
    telemetry: d.telemetry || null
  };
}
writeJSON('device-meta.json', {
  devices,
  lastUpdated: new Date().toISOString(),
  version: '1.0.0'
});

// ---------------------------------------------------------------------------
// 2. switchbot-devices.json — Sync from iot-devices.json
// ---------------------------------------------------------------------------
console.log('2. Syncing switchbot-devices.json...');
const sbDevices = iotDevices.filter(d => d.protocol === 'switchbot');
writeJSON('switchbot-devices.json', {
  devices: sbDevices.map(d => ({
    id: d.id,
    name: d.name,
    type: d.type,
    zone: d.zone,
    brand: d.brand,
    deviceId: d.deviceId,
    hubDeviceId: d.telemetry?.hubDeviceId || null,
    battery: d.telemetry?.battery || null,
    temperature: d.telemetry?.temperature || null,
    humidity: d.telemetry?.humidity || null,
    lastSeen: d.lastSeen
  })),
  summary: {
    total: sbDevices.length,
    sensors: sbDevices.filter(d => (d.type || '').toLowerCase().includes('sensor')).length,
    hubs: sbDevices.filter(d => (d.type || '').toLowerCase().includes('hub')).length
  },
  lastSync: new Date().toISOString(),
  version: '1.0.0'
});

// ---------------------------------------------------------------------------
// 3. env-cache.json — Build from sensor telemetry, keyed by room_id
// ---------------------------------------------------------------------------
console.log('3. Building env-cache.json from sensor telemetry...');
const sensors = iotDevices.filter(d => d.telemetry && d.telemetry.temperature != null);
const zoneReadings = {};
for (const s of sensors) {
  const zoneKey = s.zone ? `zone-${s.zone}` : 'unassigned';
  if (!zoneReadings[zoneKey]) zoneReadings[zoneKey] = [];
  zoneReadings[zoneKey].push({
    temperature: s.telemetry.temperature,
    humidity: s.telemetry.humidity,
    battery: s.telemetry.battery,
    sensor_id: s.id,
    sensor_name: s.name
  });
}

// Aggregate per zone
const zoneAverages = {};
for (const [zoneId, readings] of Object.entries(zoneReadings)) {
  if (zoneId === 'unassigned') continue;
  const avgTemp = readings.reduce((s, r) => s + r.temperature, 0) / readings.length;
  const avgHum = readings.reduce((s, r) => s + r.humidity, 0) / readings.length;
  const avgBat = readings.reduce((s, r) => s + (r.battery || 0), 0) / readings.length;
  zoneAverages[zoneId] = {
    temperature: Math.round(avgTemp * 10) / 10,
    humidity: Math.round(avgHum * 10) / 10,
    avg_battery: Math.round(avgBat),
    sensor_count: readings.length,
    sensors: readings.map(r => r.sensor_name)
  };
}

// Room-level aggregate
const allReadings = sensors.filter(s => s.zone);
const roomTemp = allReadings.length > 0
  ? Math.round((allReadings.reduce((s, r) => s + r.telemetry.temperature, 0) / allReadings.length) * 10) / 10
  : null;
const roomHum = allReadings.length > 0
  ? Math.round((allReadings.reduce((s, r) => s + r.telemetry.humidity, 0) / allReadings.length) * 10) / 10
  : null;

writeJSON('env-cache.json', {
  'room-3xxjln': {
    temperature: roomTemp,
    humidity: roomHum,
    co2: null,
    par: null,
    vpd: null,
    zones: zoneAverages,
    sensor_count: allReadings.length,
    source: 'iot-devices.json'
  },
  meta: {
    updatedAt: new Date().toISOString(),
    source: 'fix-data-pipeline'
  }
});

// ---------------------------------------------------------------------------
// 4. harvest-log.json — Create empty array (tools expect [] or { harvests: [] })
// ---------------------------------------------------------------------------
console.log('4. Creating harvest-log.json...');
if (!fs.existsSync(path.join(DATA_DIR, 'harvest-log.json'))) {
  writeJSON('harvest-log.json', []);
} else {
  console.log('  · Already exists, skipping');
}

// ---------------------------------------------------------------------------
// 5. ai-recommendations.json — Create with seeded recommendations
// ---------------------------------------------------------------------------
console.log('5. Creating ai-recommendations.json...');
const currentTemp = roomTemp;
const currentHum = roomHum;
const recs = [];

// Seed environment recommendations based on actual sensor data
if (currentTemp != null && currentTemp < 18) {
  recs.push({
    id: 'rec-env-temp-low',
    type: 'environment',
    priority: 'high',
    title: 'Room temperature below optimal range',
    description: `Current room avg is ${currentTemp}°C — most crops need 18-24°C. Check HVAC settings, insulation, and heater capacity.`,
    recommended_action: 'Increase room temperature to at least 18°C',
    impact: 'Slow growth, reduced yield, potential cold stress',
    dismissed: false,
    completed: false,
    created_at: new Date().toISOString()
  });
}
if (currentHum != null && currentHum < 40) {
  recs.push({
    id: 'rec-env-hum-low',
    type: 'environment',
    priority: 'high',
    title: 'Humidity below optimal range',
    description: `Current room avg is ${currentHum}% — most crops need 50-70%. Low humidity causes leaf tip burn, slow transpiration, and wilting.`,
    recommended_action: 'Add humidifier or increase misting frequency',
    impact: 'Leaf damage, reduced growth rate, tip burn on greens',
    dismissed: false,
    completed: false,
    created_at: new Date().toISOString()
  });
}
recs.push({
  id: 'rec-ops-device-sync',
  type: 'operations',
  priority: 'medium',
  title: 'Run periodic device scans',
  description: 'Set up regular SwitchBot device scans to keep sensor data fresh and detect offline devices early.',
  recommended_action: 'Ask Cheo to scan devices weekly',
  impact: 'Better monitoring reliability, early detection of sensor failures',
  dismissed: false,
  completed: false,
  created_at: new Date().toISOString()
});
recs.push({
  id: 'rec-ops-harvest-tracking',
  type: 'operations',
  priority: 'medium',
  title: 'Start recording harvests',
  description: 'No harvest data found. Recording harvests enables yield tracking, cycle analysis, and revenue forecasting.',
  recommended_action: 'Tell Cheo when you harvest — crop, quantity, zone',
  impact: 'Enables yield analysis, cost-per-tray metrics, and succession planning',
  dismissed: false,
  completed: false,
  created_at: new Date().toISOString()
});

writeJSON('ai-recommendations.json', {
  farm_id: 'default',
  generated_at: new Date().toISOString(),
  recommended_actions: recs,
  source: 'data-pipeline-audit'
});

// ---------------------------------------------------------------------------
// 6. demand-succession-suggestions.json — Create with structure
// ---------------------------------------------------------------------------
console.log('6. Creating demand-succession-suggestions.json...');
if (!fs.existsSync(path.join(DATA_DIR, 'demand-succession-suggestions.json'))) {
  writeJSON('demand-succession-suggestions.json', {
    suggestions: [],
    upcoming: [],
    generated_at: null,
    version: '1.0.0'
  });
} else {
  console.log('  · Already exists, skipping');
}

// ---------------------------------------------------------------------------
// 7. wholesale-orders-status.json — Convert bare KV to proper order array
// ---------------------------------------------------------------------------
console.log('7. Fixing wholesale-orders-status.json format...');
const rawOrders = readJSON('wholesale-orders-status.json');
if (rawOrders && !Array.isArray(rawOrders) && !rawOrders.orders) {
  // It's a bare KV map like { "GRC-ORDER-xxx": "packed" }
  const fixedOrders = Object.entries(rawOrders).map(([orderId, status]) => ({
    order_id: orderId,
    status: typeof status === 'string' ? status : 'pending',
    buyer_name: null,
    delivery_date: null,
    total_items: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    notes: 'Migrated from legacy format'
  }));
  writeJSON('wholesale-orders-status.json', fixedOrders);
} else {
  console.log('  · Format is already correct, skipping');
}

// ---------------------------------------------------------------------------
// 8. devices.cache.json — Fix the cached 404
// ---------------------------------------------------------------------------
console.log('8. Fixing devices.cache.json...');
const devCache = readJSON('devices.cache.json');
if (devCache && devCache.detail === 'Not Found') {
  writeJSON('devices.cache.json', { devices: [], lastSync: null, version: '1.0.0' });
} else {
  console.log('  · Already valid, skipping');
}

console.log('\n=== All data pipelines fixed! ===\n');
