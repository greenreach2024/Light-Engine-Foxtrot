# Critical Configuration Reference

**Version**: 1.1.0
**Date**: March 23, 2026
**Authority**: Canonical reference for all credentials, API keys, environment variables, and configuration files. Agents MUST NOT modify any value listed here without explicit user approval.

---

## EB Environment Variables

### Light Engine (`light-engine-foxtrot-prod-v3`)

| Variable | Purpose | Notes |
|----------|---------|-------|
| `SWITCHBOT_TOKEN` | SwitchBot Cloud API authentication | Required for sensor data. If missing, sensors silently stop updating. |
| `SWITCHBOT_SECRET` | SwitchBot Cloud API HMAC signing | Required for sensor data. Paired with token. |
| `NODE_ENV` | Node environment | Should be `production` |

**To view current EB env vars:**
```bash
cd /Volumes/CodeVault/Projects/Light-Engine-Foxtrot
/Users/petergilbert/Library/Python/3.9/bin/eb printenv light-engine-foxtrot-prod-v3
```

**To set EB env vars:**
```bash
/Users/petergilbert/Library/Python/3.9/bin/eb setenv KEY=value -e light-engine-foxtrot-prod-v3
```
Note: `eb setenv` triggers an environment restart. Variables persist across deploys.

### GreenReach Central (`greenreach-central-prod-v4`)

| Variable | Purpose | Notes |
|----------|---------|-------|
| `GREENREACH_API_KEY` | Central's authMiddleware for server-to-server calls | Used when Central proxies to LE-EB |
| `FARM_ID` | Identifies the farm | `FARM-MLTP9LVH-B0B85039` |
| `FARM_EDGE_URL` | LE-EB direct URL for proxy fallback | `http://light-engine-foxtrot-prod-v2.eba-ukiyyqf9.us-east-1.elasticbeanstalk.com` |
| `DATABASE_URL` | PostgreSQL connection string | Managed by EB/RDS |
| `NODE_ENV` | Node environment | Should be `production` |

**To view/set Central env vars:**
```bash
cd /Volumes/CodeVault/Projects/Light-Engine-Foxtrot/greenreach-central
/Users/petergilbert/Library/Python/3.9/bin/eb printenv greenreach-central-prod-v4
```

---

## Configuration Files

### `config/edge-config.json` (LE-side)

```json
{
  "mode": "edge",
  "farmId": "FARM-MLTP9LVH-B0B85039",
  "farmName": "The Notable Sprout",
  "apiKey": "<farm-api-key>",
  "centralApiUrl": "https://greenreachgreens.com",
  "syncInterval": 300000,
  "heartbeatInterval": 30000,
  "hardwareModel": "AWS Cloud",
  "offlineMode": false,
  "syncEnabled": true,
  "registrationComplete": true
}
```

**Key fields:**
- `hardwareModel`: "AWS Cloud" -- NOT a physical device
- `apiKey`: Farm-to-Central sync authentication key
- `centralApiUrl`: Where sync-service sends telemetry
- `mode`: "edge" is a legacy label; the LE-EB runs as the farm in the cloud

### `public/data/farm.json` (LE-side)

Contains farm profile and integrations. Git-ignored but deployed via .ebignore.

**Critical section:**
```json
{
  "integrations": {
    "switchbot": {
      "token": "<switchbot-token>",
      "secret": "<switchbot-secret>"
    }
  }
}
```

This is the secondary credential source for SwitchBot (EB env vars are primary).

### `public/data/iot-devices.json` (LE-side, git-tracked)

IoT device registry. Contains SwitchBot device IDs and sensor metadata. Also contains credentials in Sen 3's `credentials` field, but **the code does NOT read credentials from this file** -- it reads from farm.json / env vars instead.

### `greenreach-central/config/farm-api-keys.json` (Central-side)

Fallback farm API key validation. Used by `authenticateFarm` middleware when DB lookup fails.

### `greenreach-central/public/data/farm.json` (Central-side)

Separate copy of farm profile for Central. NOT automatically synced with `public/data/farm.json`.

---

## Authentication Keys Summary

| Key | Location | Used By | Validates Against |
|-----|----------|---------|-------------------|
| Farm API Key | `config/edge-config.json` apiKey | sync-service.js (LE -> Central) | Central DB `farms` table + `farm-api-keys.json` |
| GREENREACH_API_KEY | Central EB env var | Central authMiddleware | Compared directly in middleware |
| SWITCHBOT_TOKEN | LE EB env var + farm.json | `switchBotApiRequest()` | SwitchBot Cloud API |
| SWITCHBOT_SECRET | LE EB env var + farm.json | `switchBotApiRequest()` | SwitchBot Cloud API |
| JWT Bearer Token | Browser localStorage | Dashboard fetch calls | Central JWT verification |

### Browser Storage Contract (Farm UI)

Protected farm UI API calls must treat browser storage as dual-source:

1. Token lookup order:
  - `sessionStorage.getItem('token')`
  - `localStorage.getItem('token')`
2. Farm ID lookup order:
  - `sessionStorage.getItem('farm_id')`
  - `sessionStorage.getItem('farmId')`
  - `localStorage.getItem('farm_id')`
  - `localStorage.getItem('farmId')`
3. Request headers:
  - `Authorization: Bearer <token>` when token exists
  - `x-farm-id: <farm-id>` when farm ID exists

This prevents auth/context drift between login flows and standalone pages.
Reference implementations:
- `greenreach-central/public/views/farm-inventory.html`
- `greenreach-central/public/LE-farm-admin.html`

### Multi-Tenant Storage Cleanup

On login and token expiry, all farm-scoped keys are purged from both localStorage and sessionStorage to prevent cross-farm data leakage.

**Cleanup functions**:
- `clearStaleFarmData()` in `greenreach-central/public/farm-admin.js` -- runs on login success, before new credentials are written
- `clearFarmStorage()` in `greenreach-central/public/auth-guard.js` (and root `public/auth-guard.js`) -- runs on all token/session expiry paths

**Cleared keys**: farm_id, farmId, farm_name, farmName, email, token, auth_token, farm_admin_session, gr.farm, farmSettings, qualityStandards, setup_completed, ai_pricing_recommendations, ai_pricing_last_check, ai_pricing_history, pricing_version, usd_to_cad_rate, impersonation_token, impersonation_farm, impersonation_expires, adminFarmId, plus dynamic `pricing_<crop>` keys.

### PostgreSQL Row-Level Security (RLS)

**Status**: Phase A (ENABLE without FORCE) -- deployed March 23, 2026
**Migration**: 040 in `greenreach-central/config/database.js`
**Policy name**: `gr_tenant_isolation` on 19 tenant tables

The `query()` function in database.js accepts `options`:
```js
await query('SELECT * FROM farm_data WHERE farm_id = $1', [farmId], { farmId });
await query('SELECT * FROM farms', [], { isAdmin: true });
await query('SELECT 1', [], { skipTenantContext: true });
```

Phase A is safe: table owner bypasses RLS policies. Phase B will enable `FORCE` after all call sites migrate.

---

## Device Status Data Contract (Central UI)

For `GET /api/sync/:farmId/devices` and `/data/iot-devices.json`, do not assume
`device.status` is always present.

Expected online/offline derivation order:
1. `device.status` when provided (`online`, `offline`, `warning`, `critical`)
2. `device.telemetry.online` or `device.deviceData.online`
3. Timestamp recency from `lastSeen` / `last_seen` / `telemetry.lastUpdate`

Operational threshold: treat a device as online when last-seen is within 5 minutes.

This contract is implemented in:
- `greenreach-central/public/central-admin.js` (`deriveDeviceStatus`, `getDeviceSeenAt`)
- `greenreach-central/public/views/field-mapping.html` (`device.online` mapping)

---

## SwitchBot Device Registry

| Device Name | Type | Device ID (MAC) | Location |
|-------------|------|-----------------|----------|
| Sen 1 | WoIOSensor | CE2A81460E78 | Zone 1 |
| Sen 2 | WoIOSensor | CE2A8606558E | Zone 1 |
| Sen 3 | WoIOSensor | C3343035702D | Zone 2 |
| Sen 4 | WoIOSensor | D0C841064453 | Zone 2 |
| Hub Mini 7E | Hub Mini (W0702000) | D3F85167A57E | WiFi bridge |

Hub Mini is the WiFi bridge. Sensors communicate to Hub via BLE, Hub uploads to SwitchBot Cloud via WiFi. LE-EB polls SwitchBot Cloud API -- there is no direct BLE connection from LE-EB to sensors.

---

## Files That MUST NOT Be Modified Without Full Pipeline Understanding

| File | Why It's Critical |
|------|-------------------|
| `server-foxtrot.js` functions: `setupLiveSensorSync()`, `ensureSwitchBotConfigured()`, `getFarmIntegrations()`, `switchBotApiRequest()` | These are the sensor data SOURCE. Breaking them stops all environmental data. |
| `automation/env-store.js` | In-memory data store for all sensor readings. Corruption here means bad data everywhere downstream. |
| `lib/sync-service.js` | Pushes data from LE-EB to Central. Breaking this disconnects the farm from Central. |
| `greenreach-central/routes/sync.js` | Receives telemetry at Central. Breaking auth here rejects all farm data. |
| `greenreach-central/server.js` `/env` route | Serves data to the dashboard. Breaking this makes the dashboard show stale/no data. |
| `config/edge-config.json` | Contains farm identity and sync credentials. Wrong values = auth failures. |
| `public/data/farm.json` | Contains SwitchBot credentials (backup). Removing integrations section breaks credential fallback. |

---

## EB CLI Path

The `eb` CLI is installed via pip for the local user:
```
/Users/petergilbert/Library/Python/3.9/bin/eb
```

This path must be used explicitly -- it is NOT on the system PATH.
