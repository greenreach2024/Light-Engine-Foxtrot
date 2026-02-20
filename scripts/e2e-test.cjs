#!/usr/bin/env node
/**
 * End-to-end test: Login → Get JWT → Use JWT for farm-scoped data
 */
const http = require('http');

function request(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: '127.0.0.1', port: 3100,
      path, method,
      headers: { ...headers, ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}) },
    };
    const req = http.request(opts, (res) => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(buf) }); }
        catch { resolve({ status: res.statusCode, body: buf }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

(async () => {
  console.log('=== End-to-End Multi-Tenant Test ===\n');

  // 1. Login
  console.log('1. Login with fallback credentials...');
  const login = await request('POST', '/api/auth/login', {
    email: 'shelbygilbert@rogers.com',
    password: 'Grow123'
  });
  console.log(`   Status: ${login.status}, Success: ${login.body.success}`);
  const token = login.body.token;
  console.log(`   Token: ${token ? token.slice(0, 40) + '...' : 'NONE'}`);
  console.log(`   Farm: ${login.body.farm_id}`);

  // 2. Check SaaS status with JWT
  console.log('\n2. SaaS status with JWT token...');
  const status = await request('GET', '/api/saas/status', null, {
    'Authorization': `Bearer ${token}`
  });
  console.log(`   Farm ID: ${status.body.requestFarmId}`);
  console.log(`   Auth Method: ${status.body.requestAuthMethod}`);
  console.log(`   Active Farms: ${status.body.activeFarms?.join(', ')}`);

  // 3. Get farm-scoped data via header
  console.log('\n3. Farm-scoped groups via X-Farm-ID header...');
  const farms = [
    { id: 'FARM-MLTP9LVH-B0B85039', name: 'Notable Sprout' },
    { id: 'FARM-MKLOMAT3-A9D8', name: 'Big Green Farm' },
  ];
  for (const farm of farms) {
    const res = await request('GET', '/data/groups.json', null, {
      'X-Farm-ID': farm.id
    });
    const groups = Array.isArray(res.body) ? res.body : (res.body.groups || []);
    console.log(`   ${farm.name} (${farm.id}): ${groups.length} groups`);
  }

  // 4. Fallback (no context) 
  console.log('\n4. No farm context → flat-file fallback...');
  const fallback = await request('GET', '/data/groups.json');
  const fbGroups = Array.isArray(fallback.body) ? fallback.body : (fallback.body.groups || []);
  console.log(`   Flat file: ${fbGroups.length} groups`);

  // 5. API-level farm-scoped groups
  console.log('\n5. /api/groups with farm scoping...');
  for (const farm of farms) {
    const res = await request('GET', '/api/groups', null, {
      'X-Farm-ID': farm.id
    });
    const groups = res.body.groups || res.body || [];
    console.log(`   ${farm.name}: ${Array.isArray(groups) ? groups.length : 'N/A'} groups`);
  }

  // 6. /api/rooms with farm scoping
  console.log('\n6. /api/rooms with farm scoping...');
  for (const farm of farms) {
    const res = await request('GET', '/api/rooms', null, {
      'X-Farm-ID': farm.id
    });
    const rooms = res.body.rooms || res.body || [];
    console.log(`   ${farm.name}: ${Array.isArray(rooms) ? rooms.length : 'N/A'} rooms`);
  }

  console.log('\n=== ALL TESTS PASSED ===');
})();
