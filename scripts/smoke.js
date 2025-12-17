#!/usr/bin/env node
/*
 Simple smoke test for Light Engine Charlie server (ESM)
 - Assumes server already running on localhost:8091
 - Checks: /, /index.html, /config, /env, and POST /data/test-smoke.json
 - Exits 0 on success; non-zero with concise error message on failure
*/

import http from 'node:http';

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 8091);

function request(method, path, body, headers = {}) {
  const options = {
    hostname: HOST,
    port: PORT,
    path,
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  };

  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        resolve({ status: res.statusCode, headers: res.headers, body: data });
      });
    });
    req.setTimeout(2000, () => {
      req.destroy(new Error(`Timeout ${method} ${path}`));
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

async function waitForHealthz(retries = 10, delayMs = 300) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await request('GET', '/healthz');
      if (res.status === 200) return true;
    } catch (_) {}
    await new Promise(r => setTimeout(r, delayMs));
  }
  return false;
}

;(async () => {
  const failures = [];
  const log = (...args) => console.log('[smoke]', ...args);

  try {
    // 0) wait for server
    const ready = await waitForHealthz();
    if (!ready) throw new Error('Server not responding on /healthz');
    log('Server is responsive');

    // 1) GET / and /index.html should both be 200 and equivalent content length (served from Charlie)
    const root = await request('GET', '/');
    if (root.status !== 200) failures.push(`GET / expected 200, got ${root.status}`);
    const index = await request('GET', '/index.html');
    if (index.status !== 200 || !/<!DOCTYPE html>/i.test(index.body)) {
      failures.push(`GET /index.html invalid response (status ${index.status})`);
    }
    if (!failures.length) {
      const lenRoot = Number(root.headers['content-length'] || 0);
      const lenIndex = Number(index.headers['content-length'] || 0);
      if (!lenRoot || !lenIndex || Math.abs(lenRoot - lenIndex) > 32) {
        failures.push(`Root vs index.html content length mismatch (${lenRoot} vs ${lenIndex})`);
      } else {
        log('GET / and /index.html equivalence OK');
      }
    }

    // 2) Sidebar regression guardrails: Ensure Groups V2 present, Plans/Schedules absent
    const html = root.body || '';
    if (!/data-target="groups-v2"/i.test(html)) failures.push('Sidebar missing Groups V2 link');
    if (/data-target="plans"/i.test(html)) failures.push('Sidebar unexpectedly contains Plans link');
    if (/data-target="schedules"/i.test(html)) failures.push('Sidebar unexpectedly contains Schedules link');

    // 3) GET /config
    const configRes = await request('GET', '/config');
    if (configRes.status !== 200) failures.push(`GET /config expected 200, got ${configRes.status}`);
    else {
      try {
        const cfg = JSON.parse(configRes.body);
        if (typeof cfg !== 'object' || cfg == null) throw new Error('config not object');
        log('GET /config OK', cfg);
      } catch (e) {
        failures.push('GET /config returned non-JSON body');
      }
    }

    // 4) GET /env
    const envRes = await request('GET', '/env');
    if (envRes.status !== 200) failures.push(`GET /env expected 200, got ${envRes.status}`);
    else {
      try {
        const env = JSON.parse(envRes.body);
        if (!env || !Array.isArray(env.history)) log('GET /env OK (no history array; acceptable for fresh server)');
        else log(`GET /env OK (${env.history.length} entries)`);
      } catch (e) {
        failures.push('GET /env returned non-JSON body');
      }
    }

    // 5) POST /data/test-smoke.json
    const stamp = new Date().toISOString();
    const payload = { smoke: true, when: stamp };
  const postRes = await request('POST', '/data/test-smoke.json', payload);
    if (postRes.status !== 200) failures.push(`POST /data/test-smoke expected 200, got ${postRes.status}`);
    else {
      try {
        const ack = JSON.parse(postRes.body);
        if (!ack || !ack.ok) failures.push('POST /data/test-smoke ack missing ok=true');
        else log('POST /data/test-smoke OK');
      } catch (e) {
        failures.push('POST /data/test-smoke returned non-JSON body');
      }
    }
  } catch (err) {
    failures.push(err.message || String(err));
  }

  if (failures.length) {
    console.error('\nSmoke test FAILED:');
    for (const f of failures) console.error(' -', f);
    process.exit(1);
  } else {
    console.log('\nSmoke test PASSED');
    process.exit(0);
  }
})();
