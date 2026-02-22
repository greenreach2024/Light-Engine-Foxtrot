const fs = require('fs');

const BASE = 'http://127.0.0.1:3100';
const FOXTROT = 'http://127.0.0.1:8091';

function nowIso() { return new Date().toISOString(); }

async function req(method, url, { headers = {}, body } = {}) {
  try {
    const res = await fetch(url, {
      method,
      headers: {
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (_) {}
    return { ok: res.ok, status: res.status, text, json, error: null };
  } catch (error) {
    return { ok: false, status: 0, text: '', json: null, error: error.message || String(error) };
  }
}

function record(results, section, name, outcome, details = {}) {
  results.push({ section, name, outcome, ...details });
}

async function main() {
  const creds = JSON.parse(fs.readFileSync('/tmp/audit-farm.json', 'utf8'));
  const results = [];

  // 1) Auth and tenant scoping
  const login = await req('POST', `${BASE}/api/auth/login`, {
    body: { farm_id: creds.farmId, email: creds.email, password: creds.password }
  });
  const token = login.json?.token || login.json?.data?.token;
  record(results, 'auth', 'farm login', login.ok && !!token ? 'PASS' : 'FAIL', { status: login.status, message: login.json?.message || login.text.slice(0, 160) });

  const saas = await req('GET', `${BASE}/api/saas/status`, {
    headers: token ? { authorization: `Bearer ${token}` } : {}
  });
  record(results, 'auth', 'saas scoped status', saas.ok ? 'PASS' : 'FAIL', { status: saas.status, farm: saas.json?.requestFarmId || null });

  // 2) Setup + batch seeding data via sync
  const rooms = [{ id: 'room-audit-1', name: 'Audit Main Room' }];
  const groups = [
    {
      id: 'group-audit-batch-1',
      name: 'Batch Basil 001',
      crop: 'genovese-basil',
      recipe: 'basil-standard',
      status: 'active',
      trayCount: 24,
      plants: 1728,
      seedDate: '2026-02-20',
      planConfig: { anchor: { seedDate: '2026-02-20' }, growDays: 28 }
    }
  ];
  const schedules = [{ id: 'sched-a1', groupId: 'group-audit-batch-1', recipe: 'basil-standard' }];
  const config = { mode: 'audit', batchEnabled: true, maxBatchSize: 24 };
  const inventory = [{
    sku_id: 'AUDIT-BASIL-1LB',
    product_name: 'Audit Basil 1lb',
    quantity_available: 40,
    unit: 'lb',
    price_per_unit: 12.5,
    organic: true,
    certifications: ['audit']
  }];
  const telemetry = {
    zones: [{ zone: 'zone-1', temp: 22.3, humidity: 61, co2: 480, vpd: 1.1 }],
    timestamp: nowIso()
  };

  for (const [name, payload] of [
    ['rooms', { rooms }],
    ['groups', { groups }],
    ['schedules', { schedules }],
    ['config', { config }],
    ['inventory', { products: inventory }],
    ['telemetry', telemetry],
  ]) {
    const r = await req('POST', `${BASE}/api/sync/${name}`, {
      headers: { 'x-farm-id': creds.farmId, 'x-api-key': creds.apiKey },
      body: payload,
    });
    record(results, 'setup', `sync ${name}`, r.ok ? 'PASS' : 'FAIL', { status: r.status, message: r.json?.message || r.text.slice(0, 140) });
  }

  const getGroups = await req('GET', `${BASE}/api/groups`, { headers: { 'x-farm-id': creds.farmId } });
  const getRooms = await req('GET', `${BASE}/api/rooms`, { headers: { 'x-farm-id': creds.farmId } });
  const groupsCount = Array.isArray(getGroups.json?.groups) ? getGroups.json.groups.length : (Array.isArray(getGroups.json) ? getGroups.json.length : 0);
  const roomsCount = Array.isArray(getRooms.json?.rooms) ? getRooms.json.rooms.length : (Array.isArray(getRooms.json) ? getRooms.json.length : 0);
  record(results, 'setup', 'read groups', getGroups.ok && groupsCount > 0 ? 'PASS' : 'FAIL', { status: getGroups.status, count: groupsCount });
  record(results, 'setup', 'read rooms', getRooms.ok && roomsCount > 0 ? 'PASS' : 'FAIL', { status: getRooms.status, count: roomsCount });

  // 3) Inventory + environment + harvest + traceability + planning
  const invCurrent = await req('GET', `${BASE}/api/inventory/current`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  const invForecast = await req('GET', `${BASE}/api/inventory/forecast/30`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  record(results, 'operations', 'inventory current', invCurrent.ok ? 'PASS' : 'FAIL', { status: invCurrent.status });
  record(results, 'operations', 'inventory forecast', invForecast.ok ? 'PASS' : 'FAIL', { status: invForecast.status });

  const harvestPred = await req('GET', `${BASE}/api/harvest/predictions`, { headers: { 'x-farm-id': creds.farmId } });
  const harvestPost = await req('POST', `${BASE}/api/harvest`, { body: { crop: 'genovese-basil', quantity: 12, lotCode: `AUDIT-${Date.now()}` } });
  record(results, 'operations', 'harvest predictions', harvestPred.ok ? 'PASS' : 'FAIL', { status: harvestPred.status });
  record(results, 'operations', 'harvest record', harvestPost.ok ? 'PASS' : 'FAIL', { status: harvestPost.status });

  for (const p of ['/api/traceability', '/api/traceability/stats']) {
    const t = await req('GET', `${BASE}${p}`);
    record(results, 'operations', `traceability ${p}`, t.ok ? 'PASS' : 'FAIL', { status: t.status });
  }

  for (const p of ['/api/planning/capacity', '/api/planning/demand-forecast', '/api/planning/recommendations']) {
    const r = await req('GET', `${BASE}${p}`);
    record(results, 'planning', p, r.ok ? 'PASS' : 'FAIL', { status: r.status });
  }

  // 4) Wholesale flow
  const networkFarms = await req('GET', `${BASE}/api/wholesale/network/farms`);
  record(results, 'wholesale', 'network farms list', networkFarms.ok ? 'PASS' : 'FAIL', { status: networkFarms.status });

  const upsertFarm = await req('POST', `${BASE}/api/wholesale/network/farms`, {
    body: { farm_id: creds.farmId, name: 'Audit Isolation Farm', api_url: FOXTROT, status: 'active' }
  });
  record(results, 'wholesale', 'network farm upsert auth guard', upsertFarm.status === 401 ? 'PASS' : 'FAIL', {
    status: upsertFarm.status,
    message: upsertFarm.text.slice(0, 120)
  });

  const buyerEmail = `audit.buyer+${Date.now()}@local.test`;
  const buyerPass = 'test1234';
  const buyerReg = await req('POST', `${BASE}/api/wholesale/buyers/register`, {
    body: {
      businessName: 'Audit Buyer Co',
      contactName: 'Audit Buyer',
      email: buyerEmail,
      password: buyerPass,
      buyerType: 'restaurant',
      location: { zip: '12345', state: 'NY', lat: 40.73, lng: -73.93 }
    }
  });
  const buyerToken = buyerReg.json?.data?.token || buyerReg.json?.token;
  record(results, 'wholesale', 'buyer registration', buyerReg.ok && !!buyerToken ? 'PASS' : 'FAIL', { status: buyerReg.status });

  const farmInv = await req('GET', `${FOXTROT}/api/wholesale/inventory`);
  const skuId = farmInv.json?.lots?.find(l => (l.qty_available || 0) > 0)?.sku_id || null;
  record(results, 'wholesale', 'foxtrot inventory source', farmInv.ok && !!skuId ? 'PASS' : 'FAIL', { status: farmInv.status, skuId });

  if (buyerToken && skuId) {
    const preview = await req('POST', `${BASE}/api/wholesale/checkout/preview`, {
      headers: { authorization: `Bearer ${buyerToken}` },
      body: {
        cart: [{ sku_id: skuId, quantity: 1 }],
        recurrence: { cadence: 'one_time' },
        sourcing: { mode: 'auto_network' }
      }
    });
    record(results, 'wholesale', 'checkout preview', preview.ok ? 'PASS' : 'FAIL', { status: preview.status });

    const execute = await req('POST', `${BASE}/api/wholesale/checkout/execute`, {
      headers: { authorization: `Bearer ${buyerToken}` },
      body: {
        buyer_account: { email: buyerEmail, name: 'Audit Buyer' },
        delivery_date: '2026-03-01',
        delivery_address: { street: '1 Audit St', city: 'Testville', zip: '12345' },
        cart: [{ sku_id: skuId, quantity: 1 }],
        payment_provider: 'demo',
        sourcing: { mode: 'auto_network' }
      }
    });
    record(results, 'wholesale', 'checkout execute', execute.ok ? 'PASS' : 'FAIL', { status: execute.status, orderId: execute.json?.order?.order_id || null });
  }

  for (const p of ['/api/wholesale/exports/orders', '/api/wholesale/exports/payments', '/api/wholesale/exports/tax-summary']) {
    const r = await req('GET', `${BASE}${p}`);
    record(results, 'finance', p, r.ok ? 'PASS' : 'FAIL', { status: r.status, ct: r.text.slice(0, 24) });
  }

  // 5) AI readiness
  const experimentRecord = {
    farm_id: creds.farmId,
    crop: 'genovese-basil',
    recipe_id: 'basil-standard',
    grow_days: 28,
    planned_grow_days: 28,
    recipe_params_avg: { ppfd: 220, blue_pct: 20, red_pct: 70, green_pct: 10, far_red_pct: 0, temp_c: 22, humidity_pct: 60, ec: 1.8, ph: 6.1 },
    environment_achieved_avg: { temp_c: 22.3, humidity_pct: 61, co2_ppm: 480, vpd_kpa: 1.1, ppfd_actual: 215 },
    outcomes: { weight_per_plant_oz: 1.2, quality_score: 82, loss_rate: 0.03, energy_kwh_per_kg: 2.2 },
    farm_context: { region: 'NE-US', altitude_m: 100, season: 'winter', system_type: 'nft', tray_format: '1020-flat', fixture_hours: 1200 },
    recorded_at: nowIso()
  };

  const expIngest = await req('POST', `${BASE}/api/sync/experiment-records`, {
    body: {
      farm_id: creds.farmId,
      records: [experimentRecord]
    }
  });
  const expList = await req('GET', `${BASE}/api/experiment-records?farm_id=${encodeURIComponent(creds.farmId)}&limit=5`);
  const bench = await req('GET', `${BASE}/api/crop-benchmarks`);
  record(results, 'ai', 'experiment ingest', expIngest.ok ? 'PASS' : 'FAIL', { status: expIngest.status });
  record(results, 'ai', 'experiment list', expList.ok ? 'PASS' : 'FAIL', { status: expList.status, count: expList.json?.count || 0 });
  record(results, 'ai', 'crop benchmarks', bench.ok ? 'PASS' : 'FAIL', { status: bench.status, count: bench.json?.count || 0 });

  for (const p of ['/api/network/comparative-analytics', '/api/network/trends', '/api/network/buyer-behavior', '/api/network/alerts']) {
    const r = await req('GET', `${BASE}${p}`);
    record(results, 'ai', p, r.ok ? 'PASS' : 'FAIL', { status: r.status });
  }

  const aiInsights = await req('GET', `${BASE}/api/ai-insights/${encodeURIComponent(creds.farmId)}`);
  const aiPush = await req('POST', `${FOXTROT}/api/health/ai-recommendations`, {
    headers: {
      'x-api-key': process.env.CENTRAL_API_KEY || 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    },
    body: {
      farm_id: creds.farmId,
      generated_at: nowIso(),
      recommendations: [
        {
          type: 'audit-test',
          title: 'Audit recommendation',
          message: 'Synthetic recommendation for endpoint validation',
          confidence: 0.5,
          timestamp: nowIso()
        }
      ],
      network_intelligence: {
        crop_benchmarks: {},
        demand_signals: {},
        risk_alerts: []
      }
    }
  });
  const mlForecast = await req('GET', `${BASE}/api/ml/insights/forecast/zone-1`);
  record(results, 'ai', 'ai insights endpoint', aiInsights.ok ? 'PASS' : 'FAIL', { status: aiInsights.status, message: aiInsights.json?.message || aiInsights.text.slice(0, 120) });
  record(results, 'ai', 'ai recommendations push endpoint', aiPush.ok ? 'PASS' : 'FAIL', {
    status: aiPush.status,
    message: aiPush.error || aiPush.json?.error || aiPush.text.slice(0, 140)
  });
  record(results, 'ai', 'ml forecast proxy', mlForecast.ok ? 'PASS' : 'FAIL', { status: mlForecast.status, message: mlForecast.json?.error || mlForecast.text.slice(0, 120) });

  // Summary
  const totals = { PASS: 0, FAIL: 0 };
  for (const r of results) totals[r.outcome] = (totals[r.outcome] || 0) + 1;
  const bySection = {};
  for (const r of results) {
    bySection[r.section] = bySection[r.section] || { PASS: 0, FAIL: 0, total: 0 };
    bySection[r.section][r.outcome] += 1;
    bySection[r.section].total += 1;
  }

  const report = {
    generatedAt: nowIso(),
    isolatedFarm: { farmId: creds.farmId, email: creds.email },
    totals,
    bySection,
    failedChecks: results.filter(r => r.outcome === 'FAIL'),
    allChecks: results
  };

  fs.writeFileSync('/tmp/comprehensive-audit-results.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    generatedAt: report.generatedAt,
    isolatedFarm: report.isolatedFarm,
    totals: report.totals,
    bySection: report.bySection,
    failedCount: report.failedChecks.length,
    resultsPath: '/tmp/comprehensive-audit-results.json'
  }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
