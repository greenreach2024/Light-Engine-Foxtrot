#!/usr/bin/env node
/**
 * Sync local flat-file data into the Central farm_data DB table
 * for The Notable Sprout (or whichever farm credentials are in farm-api-keys.json).
 *
 * Usage: node scripts/sync-local-to-db.js
 */
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// Load farm auth credentials — use The Notable Sprout specifically
const keysPath = path.join(ROOT, 'public/data/farm-api-keys.json');
const keys = JSON.parse(fs.readFileSync(keysPath, 'utf8'));
const NOTABLE_ID = 'FARM-MLTP9LVH-B0B85039';
const entry = keys[NOTABLE_ID];
if (!entry || !entry.api_key) { console.error('Notable Sprout API key not found'); process.exit(2); }
const FARM_ID = NOTABLE_ID;
const API_KEY = entry.api_key;
console.log(`Farm: ${FARM_ID}  API-Key prefix: ${API_KEY.slice(0, 12)}...`);

// Data files to sync
const SYNC_MAP = [
  { file: 'public/data/groups.json',    endpoint: '/groups',    wrapper: 'groups' },
  { file: 'public/data/rooms.json',     endpoint: '/rooms',     wrapper: 'rooms' },
  { file: 'public/data/schedules.json', endpoint: '/schedules', wrapper: 'schedules' },
];

function post(urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1', port: 3100,
      path: '/api/sync' + urlPath,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Farm-ID': FARM_ID,
        'X-API-Key': API_KEY,
        'Content-Length': Buffer.byteLength(data),
      },
    }, (res) => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(buf) }); }
        catch { resolve({ status: res.statusCode, body: buf }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

(async () => {
  // Step 0: Register the farm via heartbeat (ensures FK target exists)
  console.log('Registering farm via heartbeat...');
  const hb = await post('/heartbeat', {
    farmId: FARM_ID,
    farmName: 'The Notable Sprout',
    status: 'online',
    version: '1.0.0',
    metadata: { farmName: 'The Notable Sprout', plan_type: 'edge' }
  });
  console.log(`  Heartbeat: ${hb.status} ${JSON.stringify(hb.body).slice(0, 120)}`);

  for (const { file, endpoint, wrapper } of SYNC_MAP) {
    const fullPath = path.join(ROOT, file);
    if (!fs.existsSync(fullPath)) {
      console.log(`SKIP ${file} (not found)`);
      continue;
    }
    const raw = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
    const arr = Array.isArray(raw) ? raw : (raw[wrapper] || raw);
    const count = Array.isArray(arr) ? arr.length : '(object)';
    console.log(`\nSyncing ${file} → /api/sync${endpoint}  (${count} items)`);

    const payload = {};
    payload[wrapper] = Array.isArray(arr) ? arr : [arr];

    const res = await post(endpoint, payload);
    console.log(`  Status: ${res.status}  Response: ${JSON.stringify(res.body).slice(0, 200)}`);
  }
  console.log('\nDone.');
})();
