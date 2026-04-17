# Sensor Data Pipeline: End-to-End Reference

**Version**: 2.1.0
**Date**: April 17, 2026
**Authority**: Canonical reference for how environmental sensor data flows from physical sensors to the user's dashboard. All agents MUST read this before modifying any code that touches environmental data.

---

## Pipeline Overview

```
Physical Sensors (BLE) -> SwitchBot Hub Mini (WiFi) -> SwitchBot Cloud API
    -> LE Cloud Run setupLiveSensorSync() [polls every 30s]
    -> preEnvStore (in-memory) + env.json (file persistence)
    -> GET /env on LE Cloud Run (serves snapshot)
    -> sync-service.js [reads /env, POSTs every 30s]
    -> Central POST /api/sync/telemetry
    -> AlloyDB farm_data table (key: telemetry)
    -> Central GET /env [reads from DB]
    -> Dashboard farm-summary.html [fetches /env every 60s]
```

Each stage is documented below with exact file locations, function names, and failure modes.

---

## Stage 1: Physical Sensors to SwitchBot Cloud

**Hardware:**
- 4x SwitchBot WoIOSensor (temperature + humidity)
  - Sen 1: MAC `CE2A81460E78`, deviceId `CE2A81460E78`
  - Sen 2: MAC `CE2A8606558E`, deviceId `CE2A8606558E`
  - Sen 3: MAC `C3343035702D`, deviceId `C3343035702D`
  - Sen 4: MAC `D0C841064453`, deviceId `D0C841064453`
- 1x SwitchBot Hub Mini: MAC `D3F85167A57E`, deviceId `D3F85167A57E`

**Data Flow:**
1. WoIOSensors broadcast temperature + humidity via BLE
2. Hub Mini receives BLE broadcasts
3. Hub Mini uploads readings to SwitchBot Cloud via WiFi
4. SwitchBot Cloud stores latest readings, accessible via API v1.1

**Failure Modes:**
- Sensor battery dead: that sensor stops reporting, others continue
- Hub Mini offline: ALL sensors go stale (Hub is the WiFi bridge)
- SwitchBot Cloud outage: API returns errors, LE retries on next poll cycle

**No code involved at this stage.** This is purely hardware/cloud infrastructure.

---

## Stage 2: SwitchBot Cloud API Polling (LE Cloud Run)

**File**: `server-foxtrot.js`
**Function**: `setupLiveSensorSync()` (line ~29252)
**Interval**: Every 30 seconds
**API**: `https://api.switch-bot.com/v1.1/devices/{deviceId}/status`

### How It Works

1. `setupLiveSensorSync()` is called during server startup on the LE Cloud Run instance
2. It calls `ensureSwitchBotConfigured()` (line ~8418) to check credentials exist
3. If no credentials found, **the entire sensor sync silently skips** (no error, no warning)
4. If credentials exist, it polls each sensor's status via SwitchBot API v1.1
5. Each API response contains: `temperature`, `humidity`, `battery`, `version`
6. Results are written to `preEnvStore` (in-memory) and persisted to `data/automation/env-state.json`

### Credential Resolution Chain

**Function**: `getFarmIntegrations()` (line ~6770)

```
1. Read public/data/farm.json -> integrations.switchbot.token / .secret
2. Fall back to process.env.SWITCHBOT_TOKEN / SWITCHBOT_SECRET (Cloud Run Secret Manager)
3. If neither found -> return empty -> ensureSwitchBotConfigured() returns false -> NO POLLING
```

**Current Production Config:**
- `SWITCHBOT_TOKEN` and `SWITCHBOT_SECRET` are stored in Google Secret Manager and mounted as env vars on the `light-engine` Cloud Run service
- `public/data/farm.json` also contains `integrations.switchbot` as belt-and-suspenders backup

### API Authentication

**Function**: `switchBotApiRequest()` (line ~8423)

SwitchBot API v1.1 requires HMAC-SHA256 authentication:
- Header `Authorization`: The token
- Header `sign`: HMAC-SHA256(secret, token + timestamp + nonce)
- Header `t`: Unix timestamp in milliseconds
- Header `nonce`: Random UUID

### Rate Limiting

- Minimum 6 seconds between SwitchBot API requests
- 15 minute cache for device status
- 30 minute cache for device list
- SwitchBot API limit: 10,000 requests/day

### Failure Modes

- **Missing credentials**: Polling silently skipped. This was the root cause of the March 6-19, 2026 outage (on the legacy EB deployment). env.json contained stale values from the last deploy, and the system recycled those stale values with fresh timestamps, making stale data appear current. On Cloud Run, credentials are managed via Secret Manager.
- **API rate limit**: Requests return 429, retried on next cycle
- **Invalid credentials**: API returns 401, logged as error
- **Network timeout**: Request fails, retried on next 30s cycle

---

## Stage 3: EnvStore (In-Memory + File Persistence)

**File**: `automation/env-store.js` (329 lines)
**Class**: `EnvStore`

### Key Methods

| Method | Purpose |
|--------|---------|
| `updateSensor(sensorId, data)` | Updates a sensor reading in memory |
| `getSnapshot()` | Returns full environmental state (all scopes/zones/sensors) |
| `persist()` | Writes state to `data/automation/env-state.json` |

### Data Structure

```javascript
{
  scopes: {
    "scope-id": {
      sensors: {
        "sensor-id": {
          temperature: 20.1,
          humidity: 31.5,
          battery: 100,
          lastUpdate: "2026-03-19T01:02:11.878Z",
          history: [ /* up to 50 readings */ ]
        }
      },
      rooms: { /* room mappings */ }
    }
  }
}
```

### Constants

| Constant | Value | Purpose |
|----------|-------|---------|
| `LIVE_SENSOR_MAX_AGE_MS` | 10 minutes | Max age before sensor considered stale |
| `SENSOR_RETENTION_MS` | 6 hours | How long to keep sensor history |
| `MAX_SENSOR_HISTORY` | 50 | Maximum history entries per sensor |

### Persistence

- `env-state.json` is written to disk periodically
- On server restart, state is loaded from this file
- **If SwitchBot polling is broken, stale values from this file are served as if current**

---

## Stage 4: LE Cloud Run GET /env Endpoint

**File**: `server-foxtrot.js`
**Route**: `GET /env` (line ~5193)

### How It Works

1. Reads `preEnvStore.getSnapshot()`
2. Builds zones from scopes (maps sensor data to zone-1, zone-2, etc.)
3. Returns JSON response with zone temperatures, humidity, and timestamps

### Response Format

```json
{
  "zone-1": { "temperature": 20.1, "humidity": 31.5 },
  "zone-2": { "temperature": 19.9, "humidity": 32.5 },
  "lastUpdate": "2026-03-19T01:02:11.878Z",
  "sensorCount": 4,
  "source": "switchbot-cloud"
}
```

---

## Stage 5: Sync Service (LE Cloud Run to Central)

**File**: `lib/sync-service.js`
**Runs on**: LE Cloud Run instance (same server as the farm)
**Interval**: Every 30 seconds

### How It Works

1. Reads the LE Cloud Run's own `/env` endpoint (localhost)
2. POSTs the data to Central's `POST /api/sync/telemetry`
3. Uses Farm API key from `config/edge-config.json` for authentication
4. Headers: `X-Farm-ID` + `X-API-Key`

### Authentication

- **Farm ID**: `FARM-MLTP9LVH-B0B85039` (from edge-config.json)
- **API Key**: `3af913fb5fb02060c25bfdbe624ca75ee9075848e554417432d5382ccd3c7fda`
- **Central URL**: `https://greenreachgreens.com` (from edge-config.json centralApiUrl)

### Failure Modes

- **Central unreachable**: Data buffered or lost, retried on next cycle
- **Auth failure**: 401/403 response, telemetry rejected
- **LE /env returns stale data**: Sync service has no staleness check -- it will happily push stale data to Central

---

## Stage 6: Central Telemetry Ingestion

**File**: `greenreach-central/routes/sync.js` (1786 lines)
**Route**: `POST /api/sync/telemetry`

### How It Works

1. `authenticateFarm` middleware validates `X-API-Key` header
2. Validates against PostgreSQL `farms` table, then `config/farm-api-keys.json` fallback
3. Stores telemetry in PostgreSQL `farm_data` table via `farmStore.set(farmId, 'telemetry', data)`
4. Also updates in-memory farmStore Map for fast reads

### Database Storage

- **Table**: `farm_data` (AlloyDB)
- **Key**: `telemetry`
- **Farm ID**: Column value matches `FARM-MLTP9LVH-B0B85039`
- **Data**: JSON blob with zone temperatures, humidity, timestamps

---

## Stage 7: Central GET /env Endpoint

**File**: `greenreach-central/server.js`
**Route**: `GET /env` (line ~1554)

### How It Works (Current - Post March 19, 2026 Fix)

1. **First**: Try `farmStore.get(farmId, 'telemetry')` from AlloyDB/in-memory
2. **If found**: Return DB data with `envSource: "sync-service"`
3. **If empty**: Fall back to proxying request to LE Cloud Run via `FARM_EDGE_URL`
4. **Proxy uses**: `FARM_EDGE_URL` env var + `leProxyHeaders()` (X-Farm-ID + X-API-Key)

### Why DB-First Matters

The sync-service pushes data every 30s. The DB always has the freshest data from LE Cloud Run. Proxying to LE adds latency and an extra network hop. DB-first is both faster and more reliable.

### Central Environment Variables (for this endpoint)

| Variable | Value | Purpose |
|----------|-------|---------|
| `FARM_EDGE_URL` | `https://light-engine-1029387937866.us-east1.run.app` | LE Cloud Run URL |
| `FARM_ID` | `FARM-MLTP9LVH-B0B85039` | Farm identifier |
| `GREENREACH_API_KEY` | (set on EB) | For proxy auth headers |

---

## Stage 8: Dashboard Display

**File**: `greenreach-central/public/views/farm-summary.html` (~8400 lines)

### How It Works

1. `fetchEnvData()` calls `GET /env?hours=24` on Central
2. Uses `fetchWithFarmAuth()` which adds JWT Bearer token from localStorage
3. Auto-refreshes every 60 seconds
4. Renders temperature/humidity cards for each zone
5. Cloud mode detection logic determines display format

### Companion Views: Inventory + Sustainability

The farm dashboard ecosystem includes additional views that call protected APIs:
- `/api/inventory/current`
- `/api/inventory/forecast`
- `/api/sustainability/metrics`
- `/api/sustainability/utility-bills`
- `/api/sustainability/food-miles`
- `/api/sustainability/trends`

Required client behavior (Mar 2026 fix):
1. Pull token from BOTH `sessionStorage` and `localStorage`
2. Send `Authorization: Bearer <token>` when token exists
3. Send `x-farm-id` from storage (`farm_id` / `farmId`) when available
4. Fail soft on non-OK responses (render partial data, avoid hard popup/parsing failures)

Reference files:
- `greenreach-central/public/views/farm-inventory.html`
- `greenreach-central/public/LE-farm-admin.html`

### Device Status Display (Central Admin)

**Primary File**: `greenreach-central/public/central-admin.js`

The Central Devices table does not always receive a top-level `status` field from
`/api/sync/:farmId/devices`. For SwitchBot payloads, online state is often carried
in `telemetry.online` and freshness timestamps (`lastSeen`, `telemetry.lastUpdate`).

Current status derivation rules (Mar 2026 fix):
1. Use explicit `status` when present (`online`, `offline`, `warning`, `critical`)
2. Otherwise use `telemetry.online` (or `deviceData.online`)
3. Otherwise infer from recency: `lastSeen < 5 minutes => online`, else `offline`

This matches the field contract in `field-mapping.html` and prevents false offline
badges when telemetry is healthy but `status` is omitted.

---

## Nutrient Dosing Telemetry Pipeline (Atlas EZO ESP32)

The environmental pipeline above is separate from nutrient dosing telemetry. Nutrient telemetry currently flows through MQTT and is surfaced by LE for monitor workflows.

```
Atlas EZO Sensors (pH/EC/RTD) on ESP32
  -> ESP32 publishes MQTT telemetry (sensors/nutrient/reading)
  -> LE nutrient snapshot builder (getNutrientAutomationState)
  -> LE monitor endpoints (/data/nutrient-dashboard, /api/nutrients/mqtt-devices, /api/devices/mqtt)
  -> Discovery scan includes MQTT nutrient controller
  -> Device manager "Nutrient Controllers" section -> Monitor modal
```

### Nutrient Controller Runtime Defaults

- Safe target pH: `5.80`
- Safe target EC: `1300`
- pH tolerance deadband: `+/- 0.15`
- EC tolerance deadband: `+/- 50`
- Autodose enabled by default with dose-pause (cooldown) behavior

### Nutrient MQTT Topics

| Topic | Direction | Purpose |
|-------|-----------|---------|
| `sensors/nutrient/reading` | ESP32 -> LE/tools | Telemetry packet (pH, EC, temperature, target state) |
| `commands/NutrientRoom` | LE/tools -> ESP32 | Dosing and status commands |
| `sensors/NutrientRoom/ack` | ESP32 -> LE/tools | Command acknowledgement |

### Nutrient Monitoring Notes

- Device discovery now classifies nutrient MQTT devices as `Nutrient Controller` (not generic MQTT).
- Monitor flow is read-oriented; it opens live status from `/data/nutrient-dashboard`.
- If USB serial output is noisy/garbled, prefer MQTT packet capture for accurate numeric readings.

## Common Failure Scenarios

### Scenario: All Sensor Data Stale (No Updates)

**Check in order:**
1. Are SwitchBot credentials configured? (Cloud Run secrets + farm.json)
2. Is `setupLiveSensorSync()` running? (Check LE Cloud Run logs)
3. Is SwitchBot API returning data? (curl test with auth headers)
4. Is sync-service running? (Check LE Cloud Run logs for POST attempts)
5. Is Central receiving telemetry? (Check AlloyDB: `farm_data` where key='telemetry')

### Scenario: Central Shows Stale but LE Cloud Run Has Fresh Data

**Check in order:**
1. Is sync-service posting to correct Central URL?
2. Is the API key valid? (Check edge-config.json apiKey matches Central's farm-api-keys.json)
3. Is Central's /env reading from DB? (Check `envSource` field in response)

### Scenario: Dashboard Shows Nothing

**Check in order:**
1. Is the user logged in? (JWT in localStorage)
2. Is Central's /env endpoint responding? (curl test)
3. Is the dashboard JS auto-refreshing? (Check browser console)

### Scenario: Devices Page Shows "Offline" But Sensors Are Fresh

**Check in order:**
1. Confirm `/api/sync/FARM-MLTP9LVH-B0B85039/devices` returns `telemetry.online: true`
2. Confirm `lastSeen`/`telemetry.lastUpdate` are recent (< 5 minutes)
3. Confirm deployed `central-admin.js` includes `deriveDeviceStatus()` helper

If steps 1-2 are true and UI still shows offline, the client mapping likely fell
back to `device.status || 'offline'` instead of derived status.

### Scenario: Nutrient Controller Shows No Fresh Readings

**Check in order:**
1. Confirm ESP32 is connected to expected broker and scope (`NutrientRoom`)
2. Confirm broker/topic traffic on `sensors/nutrient/reading` (typically port 1884 in current setup)
3. Confirm LE endpoint `GET /data/nutrient-dashboard` returns updated `metadata.updatedAt`
4. Confirm LE discovery returns nutrient device in `POST /discovery/scan` when protocol includes MQTT
5. If serial text is unreadable, treat MQTT telemetry as source of truth for pH/EC/temperature

---

## File Quick Reference

| Stage | File | Key Function/Route |
|-------|------|--------------------|
| SwitchBot Polling | `server-foxtrot.js` | `setupLiveSensorSync()` (~line 29252) |
| Credential Check | `server-foxtrot.js` | `ensureSwitchBotConfigured()` (~line 8418) |
| Credential Source | `server-foxtrot.js` | `getFarmIntegrations()` (~line 6770) |
| API Request | `server-foxtrot.js` | `switchBotApiRequest()` (~line 8423) |
| EnvStore | `automation/env-store.js` | `EnvStore` class |
| Pre-Automation | `automation/index.js` | `createPreAutomationLayer()` |
| LE /env | `server-foxtrot.js` | `GET /env` (~line 5193) |
| Sync Push | `lib/sync-service.js` | Main loop |
| Central Ingest | `greenreach-central/routes/sync.js` | `POST /api/sync/telemetry` |
| Central /env | `greenreach-central/server.js` | `GET /env` (~line 1554) |
| Dashboard | `greenreach-central/public/views/farm-summary.html` | `fetchEnvData()` |
| Farm Config | `public/data/farm.json` | `integrations.switchbot` |
| Edge Config | `config/edge-config.json` | `farmId`, `apiKey`, `centralApiUrl` |
| IoT Devices | `public/data/iot-devices.json` | Device registry (sensors, hub) |
| Env State | `data/automation/env-state.json` | EnvStore persistence file |
| Nutrient Snapshot | `server-foxtrot.js` | `getNutrientAutomationState()` |
| Nutrient MQTT Inventory | `server-foxtrot.js` | `GET /api/nutrients/mqtt-devices`, `GET /api/devices/mqtt` |
| Nutrient UI Monitor | `public/app.foxtrot.js` | `openMqttMonitor()` and Nutrient Controllers grouping |

---

## Cloud Run Specifics

On Cloud Run, the sensor pipeline has these differences from the legacy EB deployment:

- **Credentials**: Stored in Google Secret Manager, mounted as env vars (not EB env vars)
- **Persistence**: env-state.json persists to GCS FUSE mount (`/app/data`) across container restarts
- **Keepalive**: Cloud Scheduler `sensor-sync-keepalive` pings LE every 5 min to prevent cold starts
- **Cron trigger**: Cloud Scheduler `sensor-sync-cron` POSTs to `/api/cron/sensor-sync` every 2 min as a redundant sync trigger
- **Scaling**: Min 1 instance with CPU always-allocated ensures sensor polling timers survive
