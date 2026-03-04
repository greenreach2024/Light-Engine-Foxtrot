# SwitchBot Sensor → Zone Data Flow

## Overview

This document traces how SwitchBot sensor zone assignments propagate through the Light Engine, from initial assignment to consumption by UI pages.

---

## 1. Zone Data Sources (Where Zones Are Defined)

| Source | File | Zone Format | Example |
|--------|------|-------------|---------|
| Farm Profile | `public/data/farm.json` → `rooms[].zones[]` | String | `"Zone 1"` |
| Rooms Config | `public/data/rooms.json` → `rooms[].zones[]` | String | `"Zone 1"` |
| Room Mapper | `public/data/room-map.json` → `zones[].zone` | **Numeric** | `1` |
| Room Mapper (devices) | `room-map.json` → `devices[].snapshot.zone` | **Numeric** | `2` |

**⚠️ FORMAT MISMATCH:** Farm/rooms use string `"Zone 1"`, room-map uses numeric `1`.

---

## 2. Zone Assignment Paths

### Path A: IoT Device Card Dropdown (Frontend)

```
User selects zone in dropdown
    ↓
app.foxtrot.js L2607: zoneSelect change handler
    value = "Zone 1" (string from dropdown option)
    ↓
app.foxtrot.js L3155: updateDeviceZone(deviceId, "Zone 1")
    ↓
app.foxtrot.js L1923: sanitizeDevicePayload({ zone: "Zone 1" })
    zone preserved as-is (string)
    ↓
app.foxtrot.js L2421: updateDeviceRecord(updated, { persist: true })
    ↓
app.foxtrot.js L2388: persistIotDevices()
    POST /data/iot-devices.json  →  device.zone = "Zone 1"
    ↓
server-foxtrot.js L24577: writeJsonQueued() → writes to disk
```

**Result in iot-devices.json:** `{ "zone": "Zone 1" }` (string)

### Path B: Room Mapper Placement

```
User drags sensor onto grid inside zone boundary
    ↓
room-mapper.html L2017: findZoneForPosition(x, y) → returns zone.zone (numeric 1)
    ↓
room-mapper.html L2037: snapshot.zone = 1 (numeric)
    ↓
room-mapper.html L2064: POST /data/room-map-{roomId}.json
    ↓
server-foxtrot.js L24593: syncZoneAssignmentsFromRoomMap()
    ↓
server-foxtrot.js L29042: zone = device.snapshot?.zone || device.zone → 1 (numeric)
    ↓
server-foxtrot.js L29047: ⚠️ GUARD: /^\d+$/.test("1") → PASS
    ↓
server-foxtrot.js L29064: device.zone = 1 (numeric) written to iot-devices.json
```

**Result in iot-devices.json:** `{ "zone": 1 }` (numeric integer)

### Path C: Room Mapper → rooms.json Sensor Assignments

```
room-mapper.html L2073: updateRoomsSensorAssignments()
    ↓
room-mapper.html L1893: parseInt(deviceZone) → zoneNum
    ↓
rooms.json zone lookup: parseInt(zone.id || zone.zone || '1')
    ⚠️ BUG: room.zones are strings like "Zone 1", zone.id is undefined
    parseInt("Zone 1") → NaN → no match → sensors not assigned
```

---

## 3. Zone Data Consumption (syncSensorData)

```
server-foxtrot.js L29295: syncSensorData() runs every 30s
    ↓
Reads iot-devices.json → device.zone
    ↓
Zone normalization (L29345-29368):
    "1"      → zone-1 / "Zone 1"     ✅
    "Zone 1" → zone-1 / "Zone 1"     ✅
    "zone-1" → zone-1 / "1"          ✅
    1        → zone-1 / "Zone 1"     ✅ (String(1) = "1")
    null     → SKIP                   ✅
    ↓
Writes to env.json → zones[].id = "zone-1", zones[].sensors = {...}
```

---

## 4. Zone Data Serving (GET /env)

```
server-foxtrot.js L5284: realZonePattern = /^zone-(\d{1,2}|[a-z][a-z0-9-]*[a-z][a-z0-9-]*)$/
server-foxtrot.js L5285: hexOnlyPattern = /^zone-[0-9a-f]{4,}$/i

Filter: zone-1 ✅, zone-main-grow ✅, zone-C3343AB ❌ (hex excluded)
    ↓
Returns filtered zones array to frontend
    ↓
app.foxtrot.js L12871: STATE.environment = zones
```

---

## 5. Zone Data Consumption (Frontend Pages)

| Page | Code Location | How It Reads Zones |
|------|---------------|-------------------|
| Environment | L16596: `renderEnvironment()` | `STATE.environment.map(zone => ...)` |
| Grow Room Overview | L16054 | `STATE.environment` array |
| Dashboard | L20780 | `STATE.environment` array |
| Groups v2 | L9453 | `collectRoomsFromState()` for dropdown |
| IoT Device Cards | L2552 | `collectRoomsFromState()` for dropdown, fuzzy match to pre-select |

---

## 6. Identified Bugs

### BUG 1: `syncZoneAssignmentsFromRoomMap` rejects ALL non-numeric zones
**Location:** server-foxtrot.js L29047-29051
**Impact:** If a device gets `zone: "Zone 1"` from the IoT card dropdown, then room mapper save triggers `syncZoneAssignmentsFromRoomMap`, the function can't map it back because room-map stores numeric zones. More critically, if room-map has numeric zone `2` for a device, but the device already has `zone: "Zone 1"` from the dropdown, the guard passes for the room-map zone (`"2"` is numeric) and **overwrites** the string zone with numeric, creating inconsistency.

### BUG 2: `updateRoomsSensorAssignments` uses parseInt on zone names
**Location:** room-mapper.html L1893, L1924
**Impact:** `parseInt("Zone 1")` → `NaN`. Zone lookup fails. Sensors never get assigned to rooms.json zone entries. This means the rooms.json `envSensor` and `sensors` fields are never populated from room mapper placement → other pages that rely on rooms.json sensor bindings get no data.

### BUG 3: Toast shows "Zone Zone 1" (double prefix)
**Location:** app.foxtrot.js L3159
**Impact:** `zone ? "Zone ${zone}" : 'Unassigned'` — when zone is `"Zone 1"`, displays `"Zone Zone 1"`.

### BUG 4: 401 errors from `/switchbot/devices`
**Location:** Browser console
**Impact:** `loadSwitchBotDevices()` fires on startup if `STATE.farm.integrations.switchbot` has token+secret. If credentials are stale, invalid, or not yet configured on this instance, the SwitchBot API returns 401. The server correctly passes this through. The frontend handles it gracefully (renders empty list), but logs console errors.
**Root Cause:** Credentials in farm.json are runtime data — they were present when the server was running before, but the farm.json on disk (restored from git) has empty credential fields. The deployed server (AWS) has its own farm.json with potentially valid credentials.

### BUG 5: Zone format inconsistency across the system
**Impact:** Two parallel zone format conventions exist:
- **Room Mapper / room-map.json:** Numeric (`1`, `2`)
- **IoT Card Dropdown / farm.json / rooms.json:** String (`"Zone 1"`, `"Zone 2"`)
- **syncSensorData:** Normalizes both → `zone-1` (works correctly)
- **syncZoneAssignmentsFromRoomMap:** Only accepts numeric (breaks on strings)
- **updateRoomsSensorAssignments:** Uses parseInt (breaks on zone name strings)

The normalization in `syncSensorData` correctly handles both formats. But the room-mapper sync and rooms.json sensor assignment functions do NOT handle the string format.
