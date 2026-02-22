/**
 * Sync all data from Foxtrot edge (port 8091) into the farm_data DB table.
 * This is a one-time script to populate the DB with current data.
 * 
 * Usage: node scripts/tmp/sync-foxtrot-to-db.cjs
 */

const { Pool } = require('pg');
const http = require('http');

const FOXTROT_URL = 'http://127.0.0.1:8091';
const pool = new Pool({ host: 'localhost', port: 5432, database: 'greenreach_central', user: 'postgres' });

const FILES_TO_SYNC = [
  { file: 'groups.json', dataType: 'groups', normalize: d => Array.isArray(d) ? d : (d.groups || []) },
  { file: 'rooms.json', dataType: 'rooms', normalize: d => Array.isArray(d) ? d : (d.rooms || [d]) },
  { file: 'env.json', dataType: 'telemetry', normalize: d => d },
  { file: 'schedules.json', dataType: 'schedules', normalize: d => d },
  { file: 'iot-devices.json', dataType: 'devices', normalize: d => Array.isArray(d) ? d : (d.devices || []) },
  { file: 'farm.json', dataType: 'farm_profile', normalize: d => d },
  { file: 'room-map.json', dataType: 'room_map', normalize: d => d },
];

function fetch(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    }).on('error', reject);
  });
}

(async () => {
  // Get farmId from Foxtrot
  const farmResp = await fetch(`${FOXTROT_URL}/data/farm.json`);
  if (farmResp.status !== 200) {
    console.error('Cannot fetch farm.json from Foxtrot');
    process.exit(1);
  }
  const farmData = JSON.parse(farmResp.body);
  const farmId = farmData.farmId;
  console.log(`Farm ID: ${farmId} (${farmData.name})`);

  // Ensure farm exists and is up to date
  const existingFarm = await pool.query('SELECT farm_id FROM farms WHERE farm_id = $1', [farmId]);
  if (existingFarm.rows.length === 0) {
    // New farm — need registration_code
    const crypto = require('crypto');
    await pool.query(
      `INSERT INTO farms (farm_id, name, email, status, registration_code, created_at, updated_at)
       VALUES ($1, $2, $3, 'active', $4, NOW(), NOW())`,
      [farmId, farmData.name || '', farmData.contact?.email || farmData.email || '', crypto.randomBytes(8).toString('hex')]
    );
  } else {
    // Existing farm — just update name
    await pool.query(
      `UPDATE farms SET name = COALESCE(NULLIF($1, ''), name), updated_at = NOW() WHERE farm_id = $2`,
      [farmData.name || '', farmId]
    );
  }

  let synced = 0;
  for (const { file, dataType, normalize } of FILES_TO_SYNC) {
    try {
      const resp = await fetch(`${FOXTROT_URL}/data/${file}`);
      if (resp.status !== 200) {
        console.log(`  SKIP ${file}: HTTP ${resp.status}`);
        continue;
      }
      const raw = JSON.parse(resp.body);
      const data = normalize(raw);
      const jsonStr = JSON.stringify(data);

      await pool.query(
        `INSERT INTO farm_data (farm_id, data_type, data, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (farm_id, data_type)
         DO UPDATE SET data = $3, updated_at = NOW()`,
        [farmId, dataType, jsonStr]
      );
      console.log(`  OK ${file} → ${dataType} (${jsonStr.length} bytes)`);
      synced++;
    } catch (e) {
      console.error(`  ERR ${file}: ${e.message}`);
    }
  }

  console.log(`\nSynced ${synced}/${FILES_TO_SYNC.length} data types for ${farmId}`);

  // Verify
  const verify = await pool.query(
    "SELECT data_type, LENGTH(data::text) as size FROM farm_data WHERE farm_id = $1 ORDER BY data_type",
    [farmId]
  );
  console.log('\nDB verification:');
  verify.rows.forEach(r => console.log(`  ${r.data_type}: ${r.size} bytes`));

  pool.end();
})().catch(e => { console.error('FATAL:', e.message); pool.end(); process.exit(1); });
