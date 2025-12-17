// services/ml-gateway.js
import http from 'node:http';

const cache = {
  anomalies: { data: null, at: 0, ttl: 15_000 },
  effects:   { data: null, at: 0, ttl: 5 * 60_000 }
};

async function j(path) {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: 'localhost', port: 8091, path, timeout: 12_000 }, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        if (res.statusCode >= 400) return reject(new Error(`${path} -> ${res.statusCode}`));
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout: ${path}`)); });
    req.on('error', reject);
  });
}

export async function getAnomalies() {
  const now = Date.now();
  if (cache.anomalies.data && now - cache.anomalies.at < cache.anomalies.ttl) return cache.anomalies.data;
  const data = await j('/api/ml/anomalies');
  cache.anomalies = { data, at: now, ttl: cache.anomalies.ttl };
  return data;
}

export async function getEffects() {
  const now = Date.now();
  if (cache.effects.data && now - cache.effects.at < cache.effects.ttl) return cache.effects.data;
  const data = await j('/api/ml/effects');
  cache.effects = { data, at: now, ttl: cache.effects.ttl };
  return data;
}
