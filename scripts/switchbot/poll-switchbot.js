#!/usr/bin/env node
/**
 * Poll SwitchBot OpenAPI for devices and push environment readings to Charlie's /env endpoint.
 *
 * Env vars:
 *  - SWITCHBOT_TOKEN:    Required. The token from SwitchBot app.
 *  - SWITCHBOT_SECRET:   Required. The secret/key from SwitchBot app.
 *  - ZONE:               Optional. Zone name/id to tag readings (default: "SwitchBot").
 *  - HOST:               Optional. Charlie host (default 127.0.0.1)
 *  - PORT:               Optional. Charlie port (default 8091)
 *  - INTERVAL_MS:        Optional. If set (>0), runs in a loop with this interval.
 *  - INCLUDE_REGEX:      Optional. Regex to include devices by name (e.g., "CO2|TempHumid").
 *  - EXCLUDE_REGEX:      Optional. Regex to exclude devices by name.
 *
 * Usage examples:
 *  SWITCHBOT_TOKEN=... SWITCHBOT_SECRET=... node scripts/switchbot/poll-switchbot.js
 *  ZONE=LettuceRoom INTERVAL_MS=10000 node scripts/switchbot/poll-switchbot.js
 */

import crypto from 'crypto';
import http from 'http';
import https from 'https';

const API_HOST = 'api.switch-bot.com';
const API_BASE = '/v1.1';

const TOKEN = process.env.SWITCHBOT_TOKEN;
const SECRET = process.env.SWITCHBOT_SECRET;
const ZONE = process.env.ZONE || 'SwitchBot';
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 8091);
const INTERVAL_MS = Number(process.env.INTERVAL_MS || 0);
const INCLUDE_REGEX = process.env.INCLUDE_REGEX ? new RegExp(process.env.INCLUDE_REGEX) : null;
const EXCLUDE_REGEX = process.env.EXCLUDE_REGEX ? new RegExp(process.env.EXCLUDE_REGEX) : null;

if (!TOKEN || !SECRET) {
  console.error('Missing SWITCHBOT_TOKEN or SWITCHBOT_SECRET in env. Aborting.');
  process.exit(2);
}

function sbHeaders() {
  const t = Date.now().toString();
  const nonce = crypto.randomBytes(8).toString('hex');
  const strToSign = TOKEN + t + nonce;
  const sign = crypto.createHmac('sha256', SECRET).update(strToSign).digest('base64');
  return {
    'Authorization': TOKEN,
    't': t,
    'sign': sign,
    'nonce': nonce,
    'Content-Type': 'application/json; charset=utf8'
  };
}

function httpsGet(path) {
  return new Promise((resolve, reject) => {
    const options = { hostname: API_HOST, path: API_BASE + path, method: 'GET', headers: sbHeaders() };
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function postEnvironment(payload) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(payload));
    const req = http.request({ hostname: HOST, port: PORT, path: '/env', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': data.length } },
      (res) => { const chunks=[]; res.on('data', c=>chunks.push(c)); res.on('end', ()=>resolve({status:res.statusCode, body:Buffer.concat(chunks).toString('utf8')})); });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function pickNumber(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : undefined;
}

function deviceAllowed(name) {
  if (INCLUDE_REGEX && !INCLUDE_REGEX.test(name)) return false;
  if (EXCLUDE_REGEX && EXCLUDE_REGEX.test(name)) return false;
  return true;
}

async function pollOnce() {
  const res = await httpsGet('/devices');
  if (res.status !== 200 || res.body.statusCode !== 100) throw new Error('List devices failed');
  const devices = res.body.body?.deviceList || [];

  let sent = 0;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  for (const d of devices) {
    const name = d.deviceName || d.deviceId;
    if (!deviceAllowed(name)) continue;

    // Only query status for relevant device types
    const isEnv = /meter|thermo|humid|co2/i.test(d.deviceType || '') || /CO2|Temp|Hum/i.test(name);
    if (!isEnv) continue;

  const st = await httpsGet(`/devices/${encodeURIComponent(d.deviceId)}/status`);
    if (st.status !== 200 || st.body.statusCode !== 100) continue;
    const s = st.body.body || {};

    const temperature = pickNumber(s.temperature ?? s.temp ?? s.Temperature);
    const humidity = pickNumber(s.humidity ?? s.Humidity);
    const co2 = pickNumber(s.co2 ?? s.CO2);

    const sensors = {};
    if (temperature != null) sensors.temp = temperature;
    if (humidity != null) sensors.rh = humidity;
    if (co2 != null) sensors.co2 = co2;

    if (!Object.keys(sensors).length) continue;

    const meta = {
      name,
      deviceId: d.deviceId,
      location: d.roomName || d.room,
      battery: pickNumber(s.battery ?? s.Battery),
      rssi: pickNumber(s.rssi ?? s.RSSI),
      source: 'switchbot',
      type: d.deviceType,
    };
    Object.keys(meta).forEach((key) => { if (meta[key] == null) delete meta[key]; });

    const payload = {
      scope: ZONE,
      sensors,
      ts: Date.now() / 1000,
      meta,
    };

    try {
      const r = await postEnvironment(payload);
      if (r.status !== 200) console.error('ingest failed', r.status, r.body);
      else sent++;
    } catch (e) {
      console.error('POST error:', e.message);
    }
    // Gentle throttle between device requests to respect API limits
    await sleep(250);
  }
  return sent;
}

(async () => {
  try {
    if (INTERVAL_MS > 0) {
      console.log(`SwitchBot polling started. zone=${ZONE} host=${HOST}:${PORT} interval=${INTERVAL_MS}ms`);
      while (true) {
        try {
          const n = await pollOnce();
          console.log(`Sent ${n} updates`);
        } catch (e) {
          console.error('poll error:', e.message);
        }
        await new Promise(r => setTimeout(r, INTERVAL_MS));
      }
    } else {
      const n = await pollOnce();
      console.log(`Done. Sent ${n} updates.`);
    }
  } catch (e) {
    console.error('fatal:', e.message);
    process.exit(1);
  }
})();
