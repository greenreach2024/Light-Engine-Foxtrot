/**
 * Farm API Key Authentication Middleware
 * Shared middleware for authenticating farm→Central API callbacks.
 * Validates X-Farm-ID + X-API-Key headers against farm-api-keys.json.
 */
import crypto from 'crypto';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

let _farmApiKeys = null;

export function loadFarmApiKeys() {
  if (_farmApiKeys !== null) return _farmApiKeys;
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const keysPath = resolve(__dirname, '..', 'public', 'data', 'farm-api-keys.json');
    _farmApiKeys = JSON.parse(readFileSync(keysPath, 'utf8'));
  } catch {
    _farmApiKeys = {};
  }
  return _farmApiKeys;
}

export function requireFarmApiKey(req, res, next) {
  const farmId = req.headers['x-farm-id'] || req.body?.farm_id;
  const apiKey = req.headers['x-api-key'];

  if (!farmId || !apiKey) {
    return res.status(401).json({ status: 'error', message: 'Missing X-Farm-ID or X-API-Key header' });
  }

  // Validate against env-based key first
  const envKey = process.env.WHOLESALE_FARM_API_KEY;
  if (envKey && apiKey === envKey) {
    req.farmAuth = { farm_id: farmId };
    return next();
  }

  // Check farm-api-keys.json (timing-safe comparison)
  const keys = loadFarmApiKeys();
  const farmEntry = keys[farmId];
  if (farmEntry?.api_key && farmEntry?.status === 'active') {
    try {
      const keyBuf = Buffer.from(farmEntry.api_key, 'utf8');
      const inputBuf = Buffer.from(apiKey, 'utf8');
      if (keyBuf.length === inputBuf.length && crypto.timingSafeEqual(keyBuf, inputBuf)) {
        req.farmAuth = { farm_id: farmId };
        return next();
      }
    } catch { /* length mismatch or buffer error — fall through to 403 */ }
  }

  return res.status(403).json({ status: 'error', message: 'Invalid farm credentials' });
}
