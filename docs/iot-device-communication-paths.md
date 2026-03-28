# IoT Device Communication Paths

> **Last updated:** 2026-03-09 (session 5 — farm-summary /env stale data fix, Central proxy for live sensor readings)  
> **Files involved:** `app.foxtrot.js`, `server-foxtrot.js`, `LE-dashboard.html`, `LE-farm-admin.html`, `farm-admin.js`, `js/iot-manager.js`, `LE-switchbot.html`, `greenreach-central/server.js`, `farm-summary.html`, `routes/farm-ops-agent.js`, `greenreach-central/routes/env-proxy.js`

## Canonical Production Context (Read First)

- The farm is cloud-only. LE-EB is the farm runtime.
- User traffic is Central-first (`greenreachgreens.com`), with Central routing/proxying to LE where needed.
- Function names such as `resolveEdgeUrlForProxy()` use legacy terminology; they refer to the cloud-hosted LE farm runtime.
- Historical change-log sections below preserve incident chronology. Prefer `.github/CLOUD_ARCHITECTURE.md` and `.github/COMPLETE_SYSTEM_MAP.md` when there is any wording conflict.

---

## Change Log (2026-03-09)

### Fix: Farm-summary sensor readings not refreshing (Central /env returning stale data)

**Symptoms:**
- Farm Summary page (`/views/farm-summary.html`) loads sensor data on initial page load but readings never update
- Sensor `updatedAt` timestamps stuck at last sync time (up to 5 minutes old)
- GreenReach Central admin pages work fine (different data path)

**Root cause: Central's `GET /env` returned stale synced data instead of proxying to the Light Engine**

The data flow was:
1. Light Engine's `syncSensorData()` runs every 30s → updates `env.json` and `preEnvStore` ✓
2. Central's `syncFarmData()` fetches `env.json` from LE flat file every 5 min → stores in DB as `telemetry`
3. Central's `GET /env` route (L1316) returned `farmStore.get(farmId, 'telemetry')` — the stale DB copy
4. Farm-summary page fetches `/env?hours=24` → always hit the stale DB route, never the live LE

Three bugs compounded the issue:
- **Central `GET /env`** returned stale DB data instead of proxying to the LE's live `/env` endpoint
- **Central `GET /api/env`** (L1326) shadowed the `envProxyRoutes` mounted at `/api/env` (L2696), making the proxy dead code
- **`env-proxy.js`** referenced `targetFarm.endpoint` but `networkFarmsStore` returns `api_url` — proxy would always fail with "endpoint not configured"

**Architecture note:** `greenreachgreens.com` → CloudFront → Central (`greenreach-central/server.js`). Central serves the LE's `public/` directory via `express.static(path.join(__dirname, '..', 'public'))`. The Light Engine (`server-foxtrot.js`) runs separately on the same VPC and is accessible at the farm's `api_url` (e.g. `http://172.31.12.135:8080`).

**Fixes applied:**
- **`greenreach-central/server.js`**: Changed `GET /env` to proxy directly to the Light Engine's live `/env` endpoint using `resolveEdgeUrlForProxy()`. Falls back to stale DB data only if the LE is unreachable. Passes `?hours=` query param through.
- **`greenreach-central/server.js`**: Removed the stale `app.get('/api/env')` compat handler that was shadowing the `envProxyRoutes` proxy mount.
- **`greenreach-central/routes/env-proxy.js`**: Fixed endpoint field lookup to use `targetFarm.api_url || targetFarm.base_url || targetFarm.url || targetFarm.endpoint` (networkFarmsStore normalizes to `api_url`, not `endpoint`).

---

## Change Log (2026-03-08)

### Commit 943c254 — fix: POST /farm preserves integration credentials
- **`server-foxtrot.js`**: `POST /farm` handler was doing a destructive replace of the entire `farm.json` file. Any save from `farm-admin.js` setup wizard or `app.foxtrot.js` farm settings would overwrite the file without including `integrations.switchbot` credentials, wiping credentials saved via `/switchbot/discover` or `/api/credential-store`. Now merges existing integration credentials into incoming body before writing.

### Commit 1d64d1e — fix(daily-tasks): render specific alert titles, fix [object Object]
- **`routes/farm-ops-agent.js`**: Source D alert tasks now build actionable titles from `alert.type` + `details` object (e.g. "Overselling: SKU-TOMATO-5LB (oversold by 3)" instead of generic "critical alert"). `why` field now extracts `details.message` as a human-readable string instead of passing the raw details object (which rendered as `[object Object]` in the DOM). Added deduplication of identical alerts and type-specific action buttons.
- **`farm-summary.html`**: Client-side defensive rendering — if `task.why` is still an object, extracts `.message` or `.error`.

### Commit 60bb2ed — fix: add payment_failure + notification_failure alert type mappings
- **`routes/farm-ops-agent.js`**: Added missing alert type mappings for `payment_failure` and `notification_failure` (were falling through to generic "critical alert" title).

### ROOT CAUSE: SwitchBot sensor data stopped refreshing (2026-03-08)

**Symptoms:**
- `iot-devices.json` showed all 4 sensors with `lastSeen` timestamps from March 6 (2 days stale)
- `/env` endpoint returned fresh `evaluatedAt` timestamps but same stale values (15.6°C)
- `GET /api/switchbot/devices` returned `503: SwitchBot credentials are not configured`

**Root cause: POST /farm credential wipe**
1. SwitchBot credentials were saved to `farm.json` via `/switchbot/discover` endpoint ✓
2. Later, a `POST /farm` call (from setup wizard or farm settings save) replaced `farm.json` with a payload that did NOT include `integrations.switchbot`
3. `farm.json` now had `integrations.switchbot.token = ""`, `integrations.switchbot.secret = ""`
4. `ensureSwitchBotConfigured()` returned `false` → `refreshSwitchBotTelemetry()` returned `{ changed: false }` immediately
5. No SwitchBot API calls were ever made → `iot-devices.json` stopped updating
6. `syncSensorData()` still ran every 30s but re-read stale values from `iot-devices.json`
7. `preEnvStore.updateSensor()` was called with stale values + fresh timestamps, masking the problem

**Fix applied:**
- `POST /farm` handler now merges existing `integrations` credentials from the current `farm.json` before overwriting (incoming values win, but empty strings don't overwrite real credentials)
- Credentials restored via `POST /api/credential-store` with SwitchBot token + secret
- Verified: all 4 sensors now reporting fresh readings (20.3°C, 19.2°C, 20.2°C, 19.8°C)

---

## Change Log (2026-03-04 → 2026-03-05)

### Commit 1706665 (deployed 2026-03-04)
- **`js/iot-manager.js`**: All `/devices` and `/devices/:id` fetch calls replaced with `/data/iot-devices.json` read-modify-write (fixed 401 errors from auth-gated `/devices` route)
- **`app.foxtrot.js`**: SwitchBot wizard URL changed from `/api/switchbot/discover` to `/switchbot/discover` (fixed 404)

### Commit 5def58b (deployed 2026-03-05)
- **`LE-switchbot.html`**: `fetchDeviceMetadata()` — removed `/devices` call with auth header, now reads `/data/iot-devices.json` directly (fixed 401)
- **`LE-switchbot.html`**: `persistDeviceMetadata()` — replaced PATCH `/devices/{id}` + POST `/devices` with read-modify-write to `/data/iot-devices.json` (fixed 401)
- **`app.foxtrot.js`**: `patchDeviceDb()` — replaced PATCH `/devices/{id}` with read-modify-write to `/data/iot-devices.json` (fixed 401)
- **`app.foxtrot.js`**: Zone dropdown fallback changed from hardcoded Zone 1-9 to async load from `/data/farm.json`
- **`server-foxtrot.js`**: `syncZoneAssignmentsFromRoomMap()` — added logic to CREATE new `iot-devices.json` entries for devices in `room-map.json` not already in `iot-devices.json`. **PROBLEM: This incorrectly added 20 fan EQUIPMENT entries as IoT devices.** Fans are equipment placed via Room Mapper, not IoT sensor devices.
- **`server-foxtrot.js`**: `syncZoneAssignmentsFromRoomMap()` — removed early return when `iot-devices.json` is missing/empty

### ROOT CAUSE FOUND (session 3, 2026-03-05)

**Architecture discovery: Dual data store**
- `greenreachgreens.com` → CloudFront → `greenreach-central` (multi-tenant SaaS proxy)
- greenreach-central's `farmDataWriteMiddleware` intercepts ALL `/data/*.json` POST/PUT → writes to PostgreSQL `farm_data` table
- greenreach-central's `farmDataMiddleware` intercepts ALL `/data/*.json` GET → reads from PostgreSQL
- Direct EB URL → Light Engine's flat file handlers (different data store)
- **Browser on greenreachgreens.com NEVER touches the flat file — all data goes through PostgreSQL**

**Root cause: Sync job overwrites browser-saved data**
1. Browser's `persistIotDevices()` saves sensor data to PostgreSQL via greenreach-central ✓
2. Every 5 minutes, greenreach-central sync job fetches `iot-devices.json` flat file from Light Engine EB
3. `syncZoneAssignmentsFromRoomMap()` on Light Engine had auto-created 20 fan entries in the flat file
4. Sync job UPSERTS (overwrites) the PostgreSQL `devices` record with the flat file contents
5. Browser-saved sensor data gets overwritten with stale flat file data (20 fans, no sensors)
6. On next page load, farmDataMiddleware reads from PostgreSQL → returns fans instead of sensors

**Secondary issues:**
- SwitchBot credential DB lookup used hardcoded `'default'` farmId instead of `FARM_ID` env var (`FARM-MLTP9LVH-B0B85039`)
- `persistIotDevices()` and all `/data/*.json` fetches lacked Authorization headers (worked due to `FARM_ID` env var fallback, but fragile)

### Fixes Applied (session 3)
- **`server-foxtrot.js`**: Removed auto-create logic from `syncZoneAssignmentsFromRoomMap()` — only existing devices get zone assignments updated, no new entries created from room-map
- **`greenreach-central/server.js`**: Sync job devices upsert now checks if DB already has data; skips overwrite if browser has saved devices (browser is authoritative for device registry)
- **`greenreach-central/server.js`**: SwitchBot credential DB lookup uses `farmStore.farmIdFromReq(req)` instead of hardcoded `'default'`
- **`app.foxtrot.js`**: Added `fetchWithFarmAuth()` helper that auto-includes `Authorization: Bearer` from localStorage token
- **`app.foxtrot.js`**: All `/data/iot-devices.json` fetch calls (GET and POST) now use `fetchWithFarmAuth()`
- **`app.foxtrot.js`**: `loadJSON()` and `saveJSON()` now use `fetchWithFarmAuth()` for all data file operations
- **`LE-switchbot.html`**: Added `fetchWithFarmAuth()` helper and updated all `/data/iot-devices.json` calls
- **Database**: Cleared stale 20-fan entries from PostgreSQL `farm_data` table for `FARM-MLTP9LVH-B0B85039`
- **Flat file**: Cleared stale entries from Light Engine EB flat file

### Rollback (post-deploy 2026-03-05, session 2)
- **AWS (`iot-devices.json`)**: Cleared incorrectly-created fan entries back to `[]` via POST to `https://greenreachgreens.com/data/iot-devices.json`

### Key Discovery: Production URL
- User accesses app at `https://greenreachgreens.com/LE-farm-admin.html` (CloudFront → EB)
- CloudFront origin → `light-engine-foxtrot-prod-v3` EB environment
- EB environment CNAME is confusingly `light-engine-foxtrot-prod-v2.eba-ukiyyqf9...` (CNAMEs were swapped in prior blue/green deploy)
- Direct EB URL and CloudFront URL serve the same instance but CloudFront POST to `/data/*` returns `{"success":true,"source":"database"}` (different handler path vs direct EB)

---

## Architecture Overview

```
┌─────────────────────────────────┐
│     LE-farm-admin.html          │ ← Default page (GET /)
│     loads: farm-admin.js        │    NO IoT code
│                                 │
│  ┌───────────────────────────┐  │
│  │  iframe (admin-iframe)    │  │
│  │  LE-dashboard.html        │  │ ← Loaded when user clicks "Setup/Update"
│  │  loads: app.foxtrot.js    │  │    Primary IoT code
│  │  loads: groups-v2.js      │  │
│  │  loads: js/iot-manager.js │  │    IoTDevicesManager class (fetches /iot/devices)
│  │                           │  │
│  │  ┌─ #iotPanel ──────────┐ │  │
│  │  │  IoT Devices panel   │ │  │
│  │  │  #iotDevicesList     │ │  │
│  │  │  #addedIoTDevicesList│ │  │
│  │  └──────────────────────┘ │  │
│  └───────────────────────────┘  │
└─────────────────────────────────┘
         ▲           │
         │           ▼
┌─────────────────────────────────┐
│     server-foxtrot.js           │
│                                 │
│  GET  /devices                  │ ← DB-backed device list (L6389)
│  POST /devices                  │ ← Upsert device (L6422)
│  GET  /data/iot-devices.json    │ ← Read saved devices (static + L22836 demo)
│  POST /data/iot-devices.json    │ ← Write devices (L24614)
│  GET  /discovery/devices        │ ← Network device discovery (L25905)
│  GET  /switchbot/devices        │ ← SwitchBot device list (L8625)
│  GET  /api/switchbot/devices    │ ← SwitchBot devices via API (L8730)
│  GET  /data/rooms.json          │ ← Zone data for dropdowns
│  GET  /api/rooms                │ ← DB-backed rooms
│                                 │
│  ⚠ /iot/devices — NO route      │ ← iot-manager.js calls this (silent 404)
│                                 │
│  File: public/data/iot-devices.json
│  File: public/data/switchbot-devices.json
│  File: public/data/rooms.json
└─────────────────────────────────┘
```

---

## Live Sensor Telemetry Pipeline

> Added 2026-03-08. This is the pipeline that delivers live SwitchBot sensor readings to the Farm Summary page — distinct from the device discovery/registration flow above.

### Server-Side: Sensor Sync Loop

```
SENSOR_SYNC_TIMER (30s interval, L29929)
  └─ syncSensorData()                                [L29424]
       ├─ Read iot-devices.json from disk             (re-reads every cycle)
       ├─ Read env.json from disk
       ├─ refreshSwitchBotTelemetry(iotDevices)       [L29338]
       │    ├─ ensureSwitchBotConfigured()             [L8398]
       │    │    └─ getFarmIntegrations().switchbot     [L6754]
       │    │         ├─ 1. farm.json → integrations.switchbot.token/secret
       │    │         └─ 2. Fallback: SWITCHBOT_TOKEN / SWITCHBOT_SECRET env vars
       │    │
       │    ├─ fetchSwitchBotDevices({ force: false }) [L8570+]
       │    │    └─ GET https://api.switch-bot.com/v1.1/devices
       │    │         (cached 30 min: SWITCHBOT_DEVICE_CACHE_TTL_MS)
       │    │
       │    ├─ Filter: deviceType includes 'sensor'
       │    ├─ Round-robin batch: 3 devices per cycle  (SWITCHBOT_SENSOR_STATUS_BATCH)
       │    │
       │    ├─ For each batch device:
       │    │    └─ fetchSwitchBotDeviceStatus(id)     [L8570]
       │    │         └─ GET /v1.1/devices/{id}/status
       │    │              (cached 15 min: SWITCHBOT_STATUS_CACHE_TTL_MS)
       │    │              (rate limited: 6s between API calls)
       │    │
       │    ├─ normalizeSwitchBotStatus()              [L29309]
       │    │    └─ Returns { temperatureC, humidity, battery, updatedAt }
       │    │
       │    ├─ Mutates device.telemetry in-place
       │    │    ├─ device.telemetry.temperature = reading.temperatureC
       │    │    ├─ device.telemetry.humidity = reading.humidity
       │    │    ├─ device.telemetry.lastUpdate = reading.updatedAt
       │    │    └─ device.lastSeen = reading.updatedAt
       │    │
       │    └─ Returns { changed: fileChanged, readings: Map }
       │         (fileChanged only true if values differ from previous)
       │
       ├─ Map devices → zones by device.zone value
       │    └─ Derive zoneId: "1"→"zone-1", "Zone 1"→"zone-1"
       │
       ├─ preEnvStore.updateSensor(zoneId, 'tempC', value, timestamp)
       │    └─ In-memory store used by /env endpoint
       │
       ├─ Write iot-devices.json   (only if switchBotUpdated === true)
       │    └─ Re-reads file, merges telemetry, writes back
       │
       └─ Write env.json           (only if envUpdated === true)
```

### Server-Side: /env Endpoint

```
GET /env?hours=24                                    [L5173]
  ├─ preEnvStore.getSnapshot()
  │    └─ Returns scopes → { tempC: { sources }, rh: { sources }, ... }
  │
  ├─ zonesFromScopes()
  │    └─ Maps sensorData.value → sensors.tempC.current
  │
  ├─ Merge cloud zones (if Central connection)
  ├─ Filter mock devices
  └─ Response: { zones: [{ id, sensors, sensorDevices, ... }], meta }
```

### Client-Side: Farm Summary Page

```
farm-summary.html — Environmental Conditions card

loadData()                                           [L2908]
  └─ fetchEnvData()                                  [L2938]
       ├─ GET /env?hours=24
       ├─ 30s cache (ENV_CACHE_TTL_MS)
       ├─ Cache busted explicitly on 60s interval
       └─ visibilitychange handler refreshes on tab focus

loadEnvironmentalFromData(envData)                   [L3996]
  ├─ Fetch /data/iot-devices.json (IoT device registry)
  ├─ Fetch /data/room-map.json (zone→room assignments)
  ├─ Augment envData.zones with IoT telemetry averages
  └─ selectPreferredZone(zones)

renderEnvironmental(zone, envData)                   [L4319]
  ├─ Read zone.sensors.tempC.current / rh.current / vpd.current
  ├─ Render env-grid with temp, humidity, VPD cards
  └─ Status classification: Optimal / Acceptable / Alert
```

### Key Configuration Constants

| Constant | Value | Location |
|----------|-------|----------|
| `SYNC_INTERVAL` | 30,000 ms (30s) | L29212 |
| `SWITCHBOT_STATUS_CACHE_TTL_MS` | 900,000 ms (15 min) | L6738 |
| `SWITCHBOT_DEVICE_CACHE_TTL_MS` | 1,800,000 ms (30 min) | L6737 |
| `SWITCHBOT_RATE_LIMIT_MS` | 6,000 ms (6s) | L6735 |
| `SWITCHBOT_SENSOR_STATUS_BATCH` | 3 devices/cycle | L6736 |
| `SWITCHBOT_API_TIMEOUT_MS` | 8,000 ms | L6734 |
| `ENV_CACHE_TTL_MS` (frontend) | 30,000 ms (30s) | farm-summary.html |

### Credential Storage

```
Credentials are stored in farm.json → integrations.switchbot:
  {
    "integrations": {
      "switchbot": {
        "token": "...",   ← SwitchBot Open API token
        "secret": "..."   ← SwitchBot Open API secret
      }
    }
  }

Save paths:
  POST /switchbot/discover           → Saves token+secret to farm.json
  POST /api/credential-store         → Merges token+secret into farm.json
  POST /farm                         → ⚠ NOW preserves existing integrations
                                       (was destructive replace before 943c254)

Read path:
  getFarmIntegrations()              → farm.json → env var fallback
  ensureSwitchBotConfigured()        → Boolean(token && secret)
```

### Failure Modes

| Symptom | Likely Cause | Check |
|---------|-------------|-------|
| `/env` returns stale values but fresh timestamps | `ensureSwitchBotConfigured()` false | `GET /api/credential-store` → switchbot.configured |
| `iot-devices.json` lastSeen stuck days ago | No SwitchBot API calls being made | `GET /api/switchbot/devices` → 503 = no creds |
| Values update but never change | Sensors reporting same value (normal) | Check SwitchBot app directly |
| Partial updates (some sensors stale) | Round-robin batch not reaching all sensors | Wait 2+ minutes for full rotation |
| `[object Object]` in Farm Summary | API returning objects where strings expected | Check `/api/farm-ops/daily-todo` response |

---

## Page Loading Flow

### Step 1: User opens the app
```
Browser → GET / → 302 redirect → /LE-farm-admin.html
                                  ↓ loads farm-admin.js (6,460 lines)
                                  ↓ farm-admin.js has ZERO IoT code
                                  ↓ User sees farm dashboard (KPIs, nav sidebar)
```

### Step 2: User clicks "Setup/Update" 
```
farm-admin.js → renderEmbeddedView('/LE-dashboard.html', 'Setup/Update')
              → iframe.src = '/LE-dashboard.html?embedded=1'
              → LE-dashboard.html loads in iframe
              → <script src="/app.foxtrot.js?v=20260302-prodroot-fix" defer>
              → <script src="/groups-v2.js?v=20260302-prodroot-fix" defer>
              → <script src="/js/iot-manager.js?v={{BUILD_TIME}}" defer>
              → DOMContentLoaded fires (multiple listeners in app.foxtrot.js)
              → IoTDevicesManager auto-inits, fetches /iot/devices (⚠ 404)
```

### Step 3: User navigates away from "Setup/Update"
```
farm-admin.js → hides #section-iframe-view (display: none)
              → iframe remains in DOM but hidden
              → NO unload event fired
```

### Step 4: User returns to "Setup/Update"
```
farm-admin.js → renderEmbeddedView('/LE-dashboard.html', 'Setup/Update')
              → iframe.src = '/LE-dashboard.html?embedded=1' (FULL RELOAD)
              → DOMContentLoaded fires AGAIN from scratch
              → All IoT devices must be re-loaded from server + localStorage
```

---

## Data Flow: Device Discovery → Persistence → Reload

### Phase 1: Discovery (Universal Scanner)

```
User clicks "Run Universal Scanner" (#btnUniversalScan)
  ↓
window.runUniversalScan()                        [app.foxtrot.js]
  ↓
Scans by protocol: SwitchBot API, USB serial, network discovery
  ↓
Results displayed in #universalScanTableBody
Each row has "Accept" button → calls window.acceptDiscoveredDevice(index)
```

**Key function:** `acceptDiscoveredDevice()` → delegates to `addDeviceToIoT()`

### Phase 2: Acceptance & Persistence

```
addDeviceToIoT(device, deviceIndex, credentials)   [L3932]
  │
  ├─ sanitizeDevicePayload(device, { trust: 'trusted' })
  │    └─ Sets trust='trusted' (CRITICAL: renderIoTDeviceCards filters on this)
  │
  ├─ STATE.iotDevices = upsertDeviceList(STATE.iotDevices, sanitizedDevice)
  │    └─ In-memory update (visible immediately)
  │
  ├─ window.LAST_IOT_SCAN = upsertDeviceList(window.LAST_IOT_SCAN, sanitizedDevice)
  │
  ├─ await persistIotDevices(STATE.iotDevices)   [L2396]
  │    │
  │    ├─ 1. localStorage.setItem('gr.iotDevices', JSON.stringify(payload))
  │    │      └─ Synchronous backup (survives page reload even if server fails)
  │    │
  │    └─ 2. fetch('/data/iot-devices.json', { method: 'POST', body: payload })
  │           └─ Server writes to public/data/iot-devices.json via writeJsonQueued()
  │              └─ Dispatches 'iot-devices-updated' event on success
  │
  └─ renderIoTDeviceCards(window.LAST_IOT_SCAN)
       └─ Updates the visible IoT Devices panel
```

### Phase 3: Loading on Page Reload (Two Parallel Paths)

**Path A: Early Init (L6908)** — runs first, loads IoT specifically
```
DOMContentLoaded listener [L6908]
  ├─ await loadFarmData()
  ├─ await loadRoomsFromBackend()     ← zones needed for device card dropdowns
  ├─ await loadLightSetups()
  └─ await loadSavedIoTDevices()      [L6757]
       │
       ├─ 1. fetch('/data/iot-devices.json', { cache: 'no-store' })
       │      └─ Reads fresh data from server
       │
       ├─ 2. If server returns empty → try localStorage.getItem('gr.iotDevices')
       │      └─ Recovers devices from local backup
       │
       ├─ STATE.iotDevices = deviceArray.map(sanitizeDevicePayload)
       ├─ window.LAST_IOT_SCAN = STATE.iotDevices.slice()
       ├─ localStorage.setItem('gr.iotDevices', ...)  ← keep backup fresh
       └─ renderIoTDeviceCards(window.LAST_IOT_SCAN)
```

**Path B: Full Bootstrap (L21669)** — runs concurrently, loads everything
```
DOMContentLoaded listener [L21669]
  ├─ Guard: if (window.__charlieBootstrapped) return;
  ├─ UI setup (FarmWizard, DeviceManagerWindow, RoomWizard, LightWizard)
  └─ await loadAllData()              [L12814]
       │
       ├─ Promise.all([...16 data files...])
       │    ├─ loadJSON('/data/iot-devices.json', [])    { cache: 'no-store' }
       │    ├─ loadJSON('./data/switchbot-devices.json')
       │    ├─ loadJSON('/api/rooms', [])                ← rooms for zones
       │    └─ ...other data files...
       │
       ├─ Merge SwitchBot devices into IoT devices
       ├─ If server returned empty → try localStorage 'gr.iotDevices' fallback
       ├─ dedupeDevices()
       ├─ STATE.iotDevices = uniqueDevices
       ├─ localStorage.setItem('gr.iotDevices', ...)
       └─ setTimeout(() => renderIoTDeviceCards(...), 500)
```

---

## Data Storage Layers

### Layer 1: Server File System (Source of Truth)
```
File: public/data/iot-devices.json
Format: JSON array of device objects
Written by: POST /data/:name handler (L24614) via writeJsonQueued()
Read by: GET /data/iot-devices.json via express.static (L23492)
Seeded by: seedRuntimeDataFiles() on server boot (only if file missing)
Preserved by: EB deploy hooks (predeploy backup, postdeploy restore)
```

### Layer 2: localStorage (Backup/Fallback)
```
Key: 'gr.iotDevices'
Format: JSON string of device array
Written by: persistIotDevices() and loadSavedIoTDevices()
Read by: loadSavedIoTDevices() and loadAllData() when server returns empty
Purpose: Survive navigation, iframe reloads, and temporary server failures
```

### Layer 3: In-Memory State
```
STATE.iotDevices     — canonical device array
window.LAST_IOT_SCAN — copy used for rendering (includes unaccepted devices)
```

---

## Zone Dropdown Data Flow

### Source of Zone Data
```
rooms.json → { rooms: [{ name: "Main Grow Room", zones: ["Zone 1", "Zone 2"] }] }
```

### How Zones Reach the Dropdown
```
collectRoomsFromState()                 [L490]
  ├─ 1. Check STATE.rooms (populated by loadRoomsFromBackend)
  ├─ 2. Check STATE.farm.rooms (populated by loadFarmData)
  └─ 3. Fallback: localStorage.getItem('gr.rooms')

createDeviceEntryElement(device)        [L2430]
  ├─ Calls collectRoomsFromState() for zone options
  ├─ For each room → for each zone → add <option>
  ├─ If no zones found → fallback: Zone 1-9 (L2582)
  └─ On focus event → lazy re-populate from latest STATE.rooms
```

### Zone Dropdown Lifecycle
```
1. Page loads → loadRoomsFromBackend() fetches /api/rooms
2. DOMContentLoaded → loadSavedIoTDevices() → renderIoTDeviceCards()
3. Each device card gets createDeviceEntryElement()
4. Zone select calls collectRoomsFromState()
5. If STATE.rooms not yet populated (race condition) → uses localStorage fallback
6. On focus → re-checks collectRoomsFromState() and refreshes options
```

---

## Server-Side Endpoints (Complete Device Inventory)

| Method | Path | Handler Line | Auth? | Purpose |
|--------|------|-------------|-------|----------|
| GET | `/devices` | L6389 | No (demo-mode middleware only) | DB-backed device list |
| GET | `/devices/:id` | L6410 | No | Single device by ID |
| POST | `/devices` | L6422 | No | Upsert device |
| DELETE | `/devices/:id` | L6470 | No | Remove device |
| GET | `/data/iot-devices.json` | L22836 (demo) → static | No | Read saved devices (file) |
| POST | `/data/iot-devices.json` | L24614 | No | Write/update devices (file) |
| GET | `/discovery/devices` | L25905 | No | Network device discovery |
| GET | `/switchbot/devices` | L8625 | No | SwitchBot device list |
| GET | `/api/switchbot/devices` | L8730 | No | SwitchBot devices (API wrapper) |
| GET | `/api/switchbot/devices/:id/status` | L8810 | No | SwitchBot device status |
| POST | `/api/switchbot/devices/:id/commands` | L8846 | Farm runtime access required | SwitchBot control command |
| GET | `/data/switchbot-devices.json` | static | No | Read SwitchBot cache (file) |
| GET | `/data/rooms.json` | static | No | Read rooms/zones |
| GET | `/api/rooms` | varies | No | DB-backed rooms |
| GET | `/` | L22756 | No | 302 → /LE-farm-admin.html |

### ⚠ Missing Routes (called by client but not defined on server)

| Endpoint | Called By | Result |
|----------|-----------|--------|
| `GET /iot/devices` | `js/iot-manager.js` (L68) | **404** — no server route |
| `POST /iot/devices/scan` | `js/iot-manager.js` (L86) | **404** — no server route |
| `GET /iot/devices/:id` | `js/iot-manager.js` (L231) | **404** — no server route |
| `PUT /iot/devices/:id` | `js/iot-manager.js` (L257) | **404** — no server route |

### Server Boot Sequence
```
app.listen() [L29901]
  └─ seedRuntimeDataFiles() [L849]
       ├─ Creates iot-devices.json with [] if missing
       ├─ Creates switchbot-devices.json with default if missing
       ├─ Creates rooms.json with [] if missing
       └─ Only creates files — never overwrites existing data
```

### Deploy Hooks (EB Platform)
```
predeploy:  00_preserve_runtime_data.sh
            └─ Copies iot-devices.json and switchbot-devices.json to /tmp/

postdeploy: 00_recover_runtime_data.sh
            └─ Restores from /tmp/ if files exist (preserves runtime data)
```

---

## Rendering Pipeline

```
renderIoTDeviceCards(devices)            [L2821]
  │
  ├─ Find/create #iotDevicesList container
  │
  ├─ dedupeDevices(devices)
  │
  ├─ Filter: trustedDevices = devices.filter(d => d.trust === 'trusted')
  │    └─ ONLY trusted devices get rendered as cards
  │
  ├─ Filter: unknownDevices = devices.filter(d => d.trust === 'unknown')
  │    └─ Shown in editable table with Assign/Quarantine buttons
  │
  ├─ If no trusted and no unknown → show "No IoT devices found" message
  │
  ├─ Group trusted devices by vendor (SwitchBot, Kasa, etc.)
  │
  └─ For each vendor group:
       └─ For each device:
            └─ createDeviceEntryElement(device) [L2430]
                 ├─ Name, type, vendor labels
                 ├─ Zone dropdown (from collectRoomsFromState)
                 ├─ Status badge (online/offline)
                 ├─ Telemetry display (temp, humidity, CO2)
                 ├─ Actions: View Details, Refresh, Remove
                 └─ Zone change handler → saves zone to device → persistIotDevices
```

---

## Event System

| Event | Dispatched By | Consumed By |
|-------|--------------|-------------|
| `iot-devices-updated` | `persistIotDevices()` | Equipment panel, sensor sync |
| `rooms-updated` | Room wizard | IoT panel (re-renders device cards) |
| `DOMContentLoaded` | Browser | Multiple init handlers (12+ listeners) |

---

## Scripts Loaded per Page

### `LE-dashboard.html` (iframe from farm-admin)
| Script | Version Param | Purpose |
|--------|--------------|----------|
| `/app.foxtrot.js` | `v=20260302-prodroot-fix` (static) | Primary IoT + zone + dashboard logic (~23K lines) |
| `/groups-v2.js` | `v=20260302-prodroot-fix` (static) | Device groups |
| `/js/iot-manager.js` | `v={{BUILD_TIME}}` (template) | IoTDevicesManager class — fetches `/iot/devices` |
| `/js/net.guard.js` | `v={{BUILD_TIME}}` | Network guard |
| `/js/console-wrapper.js` | `v={{BUILD_TIME}}` | Console wrapper |

### `LE-switchbot.html`
| Script | Purpose |
|--------|---------|
| `/js/light-engine-help.js` | Help system |
| *(inline ~4K lines)* | SwitchBot device management — fetches `/devices`, `/api/switchbot/devices` |

### `LE-farm-admin.html`
| Script | Purpose |
|--------|---------|
| `/farm-admin.js` | Farm dashboard — NO IoT code, manages iframe loading |

### Files NOT Loaded by Any Page
| File | Size | Purpose |
|------|------|----------|
| `public/js/switchbot-helpers.js` | 2.2KB | SwitchBot helper functions (unused) |

> **Note:** `iot-manager.js` IS loaded by `LE-dashboard.html` (previously documented as not loaded — corrected 2026-03-04).

---

## Key Function Reference

| Function | Line | File | Purpose |
|----------|------|------|---------|
| `loadSavedIoTDevices()` | ~L6757 | app.foxtrot.js | Load devices from server + localStorage |
| `persistIotDevices(devices)` | ~L2396 | app.foxtrot.js | Save to server + localStorage |
| `renderIoTDeviceCards(devices)` | ~L2821 | app.foxtrot.js | Render device cards in panel |
| `createDeviceEntryElement(device)` | ~L2430 | app.foxtrot.js | Build single device card DOM |
| `addDeviceToIoT(device, idx, creds)` | ~L3952 | app.foxtrot.js | Accept discovered device |
| `collectRoomsFromState()` | ~L525 | app.foxtrot.js | Get rooms for zone dropdowns (zone-merge-aware) |
| `mergeRoomsWithZoneFallback()` | ~L508 | app.foxtrot.js | Merge rooms with static zone data |
| `getRoomZones()` | ~L490 | app.foxtrot.js | Extract zones from room object |
| `sanitizeDevicePayload(device)` | ~L1880 | app.foxtrot.js | Normalize device shape |
| `dedupeDevices(devices)` | varies | app.foxtrot.js | Remove duplicate devices |
| `loadAllData()` | ~L12878 | app.foxtrot.js | Full data bootstrap (token-gated /devices) |
| `seedRuntimeDataFiles()` | L849 | server-foxtrot.js | Create default data files |
| `renderEmbeddedView(url, title)` | L726 | farm-admin.js | Load page in iframe |
| `IoTDevicesManager` | class | js/iot-manager.js | Standalone device manager (calls missing /iot/devices routes) |
| `fetchDeviceMetadata()` | ~L2289 | LE-switchbot.html | Fetch device metadata from /data/iot-devices.json (was /devices — fixed 5def58b) |
| `persistDeviceMetadata()` | ~L2399 | LE-switchbot.html | Read-modify-write to /data/iot-devices.json (was PATCH/POST /devices — fixed 5def58b) |
| `patchDeviceDb()` | ~L13384 | app.foxtrot.js | Read-modify-write to /data/iot-devices.json (was PATCH /devices/{id} — fixed 5def58b) |

---

## Troubleshooting Checklist

1. **Devices disappear on navigation?**
   - Check browser console for `[IoT] Failed to persist` errors
   - Verify `localStorage.getItem('gr.iotDevices')` has data
   - `curl /data/iot-devices.json` — should show persisted array

2. **Zone dropdown shows Zone 1-9?**
   - Check console for `[ZoneDropdown] No zone options from rooms`
   - Verify `STATE.rooms` has zones: `collectRoomsFromState()` in console
   - Check `localStorage.getItem('gr.rooms')` for cached rooms
   - Click dropdown to trigger lazy re-populate

3. **Devices show in scanner but not in IoT panel?**
   - Device `trust` must be `'trusted'` to appear as a card
   - Unknown trust devices appear in the editable table above

4. **Server returns empty after deploy?**
   - Check EB hooks: `cat /tmp/pre-deploy-iot-backup/iot-devices.json`
   - Verify `seedRuntimeDataFiles()` ran: check server logs for `[seed]`
