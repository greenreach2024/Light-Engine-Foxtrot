# IoT Device Communication Paths

> **Last updated:** 2025-06-14  
> **Files involved:** `app.foxtrot.js`, `server-foxtrot.js`, `LE-dashboard.html`, `LE-farm-admin.html`, `farm-admin.js`

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
│  │  loads: app.foxtrot.js    │  │    ALL IoT code lives here
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
│  POST /data/iot-devices.json    │ ← Write devices (L24614)
│  GET  /data/iot-devices.json    │ ← Read devices (express.static + L22836 demo)
│  POST /data/switchbot-devices   │ ← SwitchBot sync  
│  GET  /data/rooms.json          │ ← Zone data for dropdowns
│  GET  /api/rooms                │ ← DB-backed rooms
│                                 │
│  File: public/data/iot-devices.json
│  File: public/data/switchbot-devices.json
│  File: public/data/rooms.json
└─────────────────────────────────┘
```

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
              → DOMContentLoaded fires (multiple listeners in app.foxtrot.js)
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

## Server-Side Endpoints

| Method | Path | Handler Line | Purpose |
|--------|------|-------------|---------|
| GET | `/data/iot-devices.json` | L22836 (demo) → L23492 (static) | Read saved devices |
| POST | `/data/iot-devices.json` | L24614 | Write/update devices |
| GET | `/data/switchbot-devices.json` | L23492 (static) | Read SwitchBot cache |
| GET | `/data/rooms.json` | L23492 (static) | Read rooms/zones |
| GET | `/api/rooms` | varies | DB-backed rooms |
| GET | `/` | L22756 | 302 → /LE-farm-admin.html |

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

## Files NOT Currently Loaded

These files exist but are NOT included in any HTML `<script>` tag:

| File | Size | Purpose |
|------|------|---------|
| `public/js/iot-manager.js` | 10KB | Standalone IoT manager class (Jan 29) |
| `public/js/switchbot-helpers.js` | 2.2KB | SwitchBot helper functions |

All IoT functionality is consolidated in `app.foxtrot.js`.

---

## Key Function Reference

| Function | Line | File | Purpose |
|----------|------|------|---------|
| `loadSavedIoTDevices()` | ~L6757 | app.foxtrot.js | Load devices from server + localStorage |
| `persistIotDevices(devices)` | ~L2396 | app.foxtrot.js | Save to server + localStorage |
| `renderIoTDeviceCards(devices)` | ~L2821 | app.foxtrot.js | Render device cards in panel |
| `createDeviceEntryElement(device)` | ~L2430 | app.foxtrot.js | Build single device card DOM |
| `addDeviceToIoT(device, idx, creds)` | ~L3952 | app.foxtrot.js | Accept discovered device |
| `collectRoomsFromState()` | ~L490 | app.foxtrot.js | Get rooms for zone dropdowns |
| `sanitizeDevicePayload(device)` | ~L1880 | app.foxtrot.js | Normalize device shape |
| `dedupeDevices(devices)` | varies | app.foxtrot.js | Remove duplicate devices |
| `loadAllData()` | ~L12814 | app.foxtrot.js | Full data bootstrap |
| `seedRuntimeDataFiles()` | L849 | server-foxtrot.js | Create default data files |
| `renderEmbeddedView(url, title)` | L726 | farm-admin.js | Load page in iframe |

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
