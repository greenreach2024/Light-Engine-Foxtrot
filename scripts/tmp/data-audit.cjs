const http = require('http');

const BASE = 'http://127.0.0.1:8091';
const FILES = [
  'groups.json', 'rooms.json', 'env.json', 'schedules.json',
  'iot-devices.json', 'farm.json', 'plans.json', 'light-setups.json',
  'room-map.json'
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
  console.log('=== Foxtrot (edge) data files ===');
  for (const f of FILES) {
    try {
      const r = await fetch(`${BASE}/data/${f}`);
      let size = r.body.length;
      let summary = '';
      if (r.status === 200) {
        try {
          const d = JSON.parse(r.body);
          if (Array.isArray(d)) summary = `array[${d.length}]`;
          else if (d && typeof d === 'object') {
            const keys = Object.keys(d);
            summary = `obj{${keys.slice(0, 5).join(',')}}`;
            // Check nested arrays
            for (const k of keys) {
              if (Array.isArray(d[k])) summary += ` ${k}[${d[k].length}]`;
            }
          }
        } catch (e) { summary = 'parse error'; }
      }
      console.log(`  ${f}: HTTP ${r.status} | ${size} bytes | ${summary}`);
    } catch (e) {
      console.log(`  ${f}: ERROR ${e.message}`);
    }
  }

  // Also check Central's view of the same farm
  const CENTRAL = 'http://127.0.0.1:3100';
  console.log('\n=== Central view of FARM-MLTP9LVH-B0B85039 ===');
  for (const f of FILES) {
    try {
      const r = await fetch(`${CENTRAL}/data/${f}`);
      let size = r.body.length;
      let summary = '';
      if (r.status === 200) {
        try {
          const d = JSON.parse(r.body);
          if (Array.isArray(d)) summary = `array[${d.length}]`;
          else if (d && typeof d === 'object') {
            const keys = Object.keys(d);
            summary = `obj{${keys.slice(0, 5).join(',')}}`;
            for (const k of keys) {
              if (Array.isArray(d[k])) summary += ` ${k}[${d[k].length}]`;
            }
          }
        } catch (e) { summary = 'parse error'; }
      }
      console.log(`  ${f}: HTTP ${r.status} | ${size} bytes | ${summary}`);
    } catch (e) {
      console.log(`  ${f}: ERROR ${e.message}`);
    }
  }

  // Check with farm header
  console.log('\n=== Central with X-Farm-ID header ===');
  for (const f of FILES) {
    try {
      const r = await new Promise((resolve, reject) => {
        const opts = new URL(`${CENTRAL}/data/${f}`);
        http.get({ hostname: opts.hostname, port: opts.port, path: opts.pathname, headers: { 'X-Farm-ID': 'FARM-MLTP9LVH-B0B85039' } }, res => {
          let data = '';
          res.on('data', c => data += c);
          res.on('end', () => resolve({ status: res.statusCode, body: data }));
        }).on('error', reject);
      });
      let size = r.body.length;
      let summary = '';
      if (r.status === 200) {
        try {
          const d = JSON.parse(r.body);
          if (Array.isArray(d)) summary = `array[${d.length}]`;
          else if (d && typeof d === 'object') {
            const keys = Object.keys(d);
            summary = `obj{${keys.slice(0, 5).join(',')}}`;
            for (const k of keys) {
              if (Array.isArray(d[k])) summary += ` ${k}[${d[k].length}]`;
            }
          }
        } catch (e) { summary = 'parse error'; }
      }
      console.log(`  ${f}: HTTP ${r.status} | ${size} bytes | ${summary}`);
    } catch (e) {
      console.log(`  ${f}: ERROR ${e.message}`);
    }
  }

  // Check admin/farms endpoint
  console.log('\n=== Admin farms list ===');
  try {
    const r = await fetch(`${CENTRAL}/api/admin/farms`);
    const d = JSON.parse(r.body);
    const farms = d.data?.farms || d.farms || d;
    if (Array.isArray(farms)) {
      console.log(`  Total farms: ${farms.length}`);
      farms.forEach(f => console.log(`  ${f.farm_id} | ${f.name} | ${f.status}`));
    } else {
      console.log('  Response:', r.body.substring(0, 300));
    }
  } catch (e) {
    console.log(`  ERROR: ${e.message}`);
  }
})();
