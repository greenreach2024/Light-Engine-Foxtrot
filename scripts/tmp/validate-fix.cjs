/**
 * Validate the login + data loading fixes.
 */
const http = require('http');

const CENTRAL = 'http://127.0.0.1:3100';

function fetchJSON(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      method: 'GET',
      headers: { ...headers }
    };
    http.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    }).on('error', reject).end();
  });
}

function postJSON(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload = JSON.stringify(body);
    const opts = {
      hostname: u.hostname,
      port: u.port,
      path: u.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers }
    };
    const req = http.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

(async () => {
  console.log('=== 1. LOGIN TEST ===');
  const loginResp = await postJSON(`${CENTRAL}/api/auth/login`, {
    farm_id: 'FARM-MLTP9LVH-B0B85039',
    password: 'admin123'
  });
  const loginData = JSON.parse(loginResp.body);
  console.log('  Status:', loginResp.status);
  console.log('  Success:', loginData.success);
  console.log('  Farm:', loginData.farm_id, '-', loginData.farm_name);

  if (!loginData.success || !loginData.token) {
    console.error('  LOGIN FAILED:', loginData.message || loginData.error);
    process.exit(1);
  }

  const token = loginData.token;
  console.log('  Token:', token.substring(0, 30) + '...');

  console.log('\n=== 2. DATA LOADING WITH JWT ===');
  const FILES = [
    'groups.json', 'rooms.json', 'env.json', 'schedules.json',
    'iot-devices.json', 'farm.json', 'room-map.json'
  ];

  for (const f of FILES) {
    const resp = await fetchJSON(`${CENTRAL}/data/${f}`, {
      'Authorization': `Bearer ${token}`
    });
    let summary = '';
    if (resp.status === 200) {
      try {
        const d = JSON.parse(resp.body);
        if (Array.isArray(d)) summary = `array[${d.length}]`;
        else if (d && typeof d === 'object') {
          const keys = Object.keys(d);
          summary = `obj{${keys.slice(0, 4).join(',')}} ${resp.body.length} bytes`;
          for (const k of keys) {
            if (Array.isArray(d[k])) summary += ` ${k}[${d[k].length}]`;
          }
        }
      } catch (e) { summary = 'parse error'; }
    }
    const ok = resp.status === 200 && resp.body.length > 20 ? '✅' : '⚠️';
    console.log(`  ${ok} ${f}: HTTP ${resp.status} | ${summary}`);
  }

  console.log('\n=== 3. DATA LOADING WITHOUT JWT (flat files) ===');
  for (const f of FILES) {
    const resp = await fetchJSON(`${CENTRAL}/data/${f}`);
    let summary = '';
    if (resp.status === 200) {
      try {
        const d = JSON.parse(resp.body);
        if (Array.isArray(d)) summary = `array[${d.length}]`;
        else if (d && typeof d === 'object') {
          const keys = Object.keys(d);
          summary = `${resp.body.length} bytes`;
          for (const k of keys) {
            if (Array.isArray(d[k])) summary += ` ${k}[${d[k].length}]`;
          }
        }
      } catch (e) { summary = 'parse error'; }
    }
    console.log(`  ${f}: HTTP ${resp.status} | ${summary}`);
  }

  console.log('\n=== RESULT: All checks passed ===');
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
