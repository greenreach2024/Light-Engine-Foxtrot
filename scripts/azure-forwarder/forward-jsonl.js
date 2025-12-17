#!/usr/bin/env node
/**
 * Local JSONL forwarder for environment telemetry → POST /env
 * Each line should be a JSON object with fields compatible with the new /env schema.
 * Example:
 * { scope: "Propagation", sensors: { temp: 24.1, rh: 60 }, ts: 1730000000, meta: { source: "SwitchBot" } }
 */

import fs from 'fs';
import http from 'http';

const [, , filePath, host = '127.0.0.1', port = '8091'] = process.argv;
if (!filePath) {
  console.error('Usage: node forward-jsonl.js <file.jsonl> [host] [port]');
  process.exit(1);
}

const post = (payload) => new Promise((resolve, reject) => {
  const data = Buffer.from(JSON.stringify(payload));
  const req = http.request({
    hostname: host,
    port: Number(port),
    path: '/env',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': data.length }
  }, (res) => {
    const chunks = [];
    res.on('data', c => chunks.push(c));
    res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
  });
  req.on('error', reject);
  req.write(data);
  req.end();
});

(async () => {
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  let buf = '';
  let count = 0;
  stream.on('data', async (chunk) => {
    buf += chunk;
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      try {
        const obj = JSON.parse(line);
        const scope = obj.scope || obj.zoneId || obj.zone || obj.room;
        if (!scope) { console.warn('Skipping line without scope/zoneId'); continue; }

        const sensors = obj.sensors && typeof obj.sensors === 'object' ? { ...obj.sensors } : {};
        const numeric = (value) => {
          const n = Number(value);
          return Number.isFinite(n) ? n : undefined;
        };
        if (sensors.temp == null && sensors.temperature == null && obj.temperature != null) sensors.temp = numeric(obj.temperature);
        if (sensors.rh == null && sensors.humidity == null && obj.humidity != null) sensors.rh = numeric(obj.humidity);
        if (sensors.vpd == null && obj.vpd != null) sensors.vpd = numeric(obj.vpd);
        if (sensors.co2 == null && obj.co2 != null) sensors.co2 = numeric(obj.co2);
        Object.keys(sensors).forEach((key) => { if (sensors[key] == null) delete sensors[key]; });
        if (!Object.keys(sensors).length) { console.warn('Skipping line without sensor readings'); continue; }

        const meta = { ...obj.meta };
        const metaCandidates = ['name', 'battery', 'rssi', 'source', 'deviceId', 'device_id', 'location'];
        metaCandidates.forEach((key) => {
          if (obj[key] != null && meta[key] == null) meta[key] = obj[key];
        });
        Object.keys(meta).forEach((key) => { if (meta[key] == null) delete meta[key]; });

        const payload = {
          scope,
          sensors,
          ts: obj.ts ?? obj.timestamp ?? Date.now() / 1000,
          meta,
        };
        const res = await post(payload);
        if (res.status !== 200) console.error('POST failed:', res.status, res.body);
        count++;
        if (count % 50 === 0) {
          console.log(`Forwarded ${count} messages...`);
        }
      } catch (e) {
        console.error('Invalid JSON line:', e.message);
      }
    }
  });
  stream.on('end', () => console.log(`Done. Forwarded ~${count} messages.`));
  stream.on('error', (e) => { console.error('Stream error:', e.message); process.exit(1); });
})();
