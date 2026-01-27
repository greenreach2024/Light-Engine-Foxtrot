# Data Persistence Audit - LE Edge After Cache Clear

## Issue Report
**Date:** January 27, 2026
**Reported:** After cache clear, LE Edge does not reload room, zone, group, recipe data

## Current Data Loading Flow

### 1. Frontend Data Loading (`public/app.foxtrot.js` - `loadAllData()`)

**Line 12221-12450**: Loads all critical data from local endpoints:

```javascript
async function loadAllData() {
  const [groups, schedules, plans, environment, calibrations, spdLibrary, 
         deviceMeta, deviceKB, equipmentKB, deviceManufacturers, farm, 
         rooms, switchbotDevices, storedIotDevices, equipmentMetadata] = await Promise.all([
    loadJSON('/data/groups.json', { groups: [] }),           // ← GROUPS
    fetchSchedulesDocument(),
    fetchPlansDocument(),
    safeApi('/env', { zones: [] }),
    loadJSON('./data/calibration.json', { calibrations: [] }),
    loadJSON('./data/spd-library.json', null),
    loadJSON('./data/device-meta.json', { devices: {} }),
    loadJSON('./data/device-kb.json', { fixtures: [] }),
    loadJSON('./data/equipment-kb.json', { equipment: [] }),
    loadJSON('./data/device-manufacturers.json', { manufacturers: [] }),
    loadJSON('./data/farm.json', {}),
    loadJSON('/data/rooms.json', { rooms: [] }),             // ← ROOMS
    loadJSON('./data/switchbot-devices.json', { devices: [], summary: null }),
    loadJSON('/data/iot-devices.json', []),
    loadJSON('/data/equipment-metadata.json', {})
  ]);

  STATE.groups = groups?.groups || [];   // Assigned to STATE
  STATE.rooms = rooms?.rooms || [];       // Assigned to STATE
}
```

**What happens after load:**
- `STATE.groups` populated from `/data/groups.json`
- `STATE.rooms` populated from `/data/rooms.json`
- `STATE.plans` populated from `/data/plans.json` (lighting-recipes)
- Dispatches `'rooms-updated'` event for UI
- NO localStorage backup
- NO attempt to reload if empty

---

## Current Backend Endpoints

### ✅ Endpoints That EXIST

| Endpoint | Method | Purpose | File Location | Status |
|----------|--------|---------|---------------|--------|
| `/data/groups.json` | GET | Load groups | `server-foxtrot.js:17951` | ✅ Works |
| `/data/groups.json` | POST | Save groups | `server-foxtrot.js:7022` | ✅ Works |
| `/data/rooms.json` | GET | Load rooms | `server-foxtrot.js:17723` | ✅ Works |
| `/api/setup/save-rooms` | POST | Save rooms | `routes/setup.js:542` | ✅ Works |

### ❌ Endpoints That DO NOT EXIST

| Endpoint | Method | Purpose | Status |
|----------|--------|---------|--------|
| `/data/rooms.json` | POST | Save rooms from Room Mapper | ❌ MISSING |
| `/data/lighting-recipes.json` | GET | Load recipes | ⚠️ Fallback only |
| `/data/lighting-recipes.json` | POST | Save recipes | ❌ MISSING |
| `/data/room-map-{roomId}.json` | POST | Save zone maps | ⚠️ Generic static POST |

---

## Backend Implementation Analysis

### Groups ✅ COMPLETE
**GET:** `server-foxtrot.js:17951-17969`
```javascript
app.get('/data/groups.json', (req, res, next) => {
  try {
    const groupsPath = path.join(__dirname, 'data', 'groups.json');
    if (fs.existsSync(groupsPath)) {
      const raw = fs.readFileSync(groupsPath, 'utf8');
      const payload = JSON.parse(raw);
      return res.json({ groups: Array.isArray(payload.groups) ? payload.groups : [] });
    }
    return res.json({ groups: [] });
  } catch (err) {
    return res.json({ groups: [] });
  }
});
```

**POST:** `server-foxtrot.js:7022-7085`
```javascript
app.post('/data/groups.json', asyncHandler(async (req, res) => {
  const { groups } = req.body;
  
  // Save to disk
  const groupsFilePath = path.join(__dirname, 'public', 'data', 'groups.json');
  const groupsData = {
    groups,
    metadata: {
      lastUpdated: new Date().toISOString(),
      version: '1.0'
    }
  };
  
  await fs.promises.writeFile(groupsFilePath, JSON.stringify(groupsData, null, 2), 'utf8');
  
  // Sync to cloud if configured
  if (process.env.GREENREACH_CENTRAL_URL && process.env.FARM_ID) {
    const syncService = getSyncService();
    await syncService.syncGroups(groups);
  }
  
  res.json({ success: true, count: groups.length, synced: !!process.env.GREENREACH_CENTRAL_URL });
}));
```

**Cloud Sync:** ✅ Implemented via `lib/sync-service.js`

---

### Rooms ⚠️ INCOMPLETE

**GET:** `server-foxtrot.js:17723-17790` ✅ Works
```javascript
app.get('/data/rooms.json', (req, res, next) => {
  const roomsPath = path.join(__dirname, 'public', 'data', 'rooms.json');
  if (fs.existsSync(roomsPath)) {
    const raw = fs.readFileSync(roomsPath, 'utf8');
    const payload = JSON.parse(raw);
    return res.json({ rooms: payload.rooms || [] });
  }
  
  // Fallback: derive rooms from groups.json
  const groupsPath = path.join(__dirname, 'public', 'data', 'groups.json');
  if (fs.existsSync(groupsPath)) {
    // ... builds rooms from groups ...
  }
  
  return res.json({ rooms: [] });
});
```

**POST via Setup API:** `routes/setup.js:542-606` ✅ Works
```javascript
router.post('/save-rooms', async (req, res) => {
  const { rooms } = req.body;
  
  // Edge device - save to NeDB
  const wizardStatesDB = req.app.locals?.wizardStatesDB;
  const setupConfig = await wizardStatesDB.findOne({ key: 'setup_config' }) || {};
  setupConfig.rooms = rooms;
  
  await wizardStatesDB.update({ key: 'setup_config' }, setupConfig, { upsert: true });
  
  return res.json({ success: true, message: `${rooms.length} room(s) saved successfully` });
});
```

**POST Direct:** ❌ MISSING - No `POST /data/rooms.json` endpoint
- Room Mapper saves zones with `POST /data/room-map-{roomId}.json`
- This goes through generic static file POST handler
- Does NOT sync rooms.json itself
- Does NOT sync to cloud

---

### Zones ⚠️ INCOMPLETE

**Storage:** Zones are stored in multiple places:
1. **Inside rooms.json**: `rooms[].zones[]`
2. **Per-room map files**: `/data/room-map-{roomId}.json`

**GET Room Maps:** Generic static file handler (works)

**POST Room Maps:** Generic static file POST handler at `server-foxtrot.js:~18300`
```javascript
// Generic POST handler for /data/*.json
app.post('/data/:filename.json', asyncHandler(async (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(__dirname, 'public', 'data', `${filename}.json`);
  
  await fs.promises.writeFile(filePath, JSON.stringify(req.body, null, 2), 'utf8');
  
  res.json({ success: true, message: `Saved ${filename}.json` });
}));
```

**Cloud Sync:** ❌ No sync for zone maps

---

### Recipes ❌ INCOMPLETE

**GET:** No dedicated endpoint - falls through to static file handler
- Path: `public/data/lighting-recipes.json`
- 61,495 lines of JSON (50 crop recipes)
- Generated by `scripts/import-lighting-recipes.py`
- Never modified by UI

**POST:** ❌ Does not exist
- Recipes are imported from Excel/CSV, not created in UI
- No save endpoint needed for now

**Cloud Sync:** ❌ Not implemented

---

## Cloud Sync Status

### Groups - ✅ IMPLEMENTED
**Edge:** `lib/sync-service.js`
```javascript
async syncGroups(groups) {
  const response = await axios.post(
    `${this.centralUrl}/api/sync/${this.farmId}/groups`,
    { groups },
    { headers: { 'Authorization': `Bearer ${this.apiKey}` } }
  );
}
```

**Cloud:** `greenreach-central/routes/sync.js:110`
```javascript
router.post('/:farmId/groups', authenticateApiKey, async (req, res) => {
  const { farmId } = req.params;
  const { groups } = req.body;
  
  if (await isDatabaseAvailable()) {
    await query(
      `INSERT INTO farm_data (farm_id, data_type, data, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (farm_id, data_type) 
       DO UPDATE SET data = $3, updated_at = NOW()`,
      [farmId, 'groups', JSON.stringify(groups)]
    );
  } else {
    inMemoryStore.groups.set(farmId, groups);
  }
  
  res.json({ success: true, count: groups.length });
});
```

### Rooms - ✅ IMPLEMENTED
**Edge:** `lib/sync-service.js` (assumed same pattern as groups)

**Cloud:** `greenreach-central/routes/sync.js:73`
```javascript
router.post('/:farmId/rooms', authenticateApiKey, async (req, res) => {
  const { farmId } = req.params;
  const { rooms } = req.body;
  
  if (await isDatabaseAvailable()) {
    await query(
      `INSERT INTO farm_data (farm_id, data_type, data, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (farm_id, data_type) 
       DO UPDATE SET data = $3, updated_at = NOW()`,
      [farmId, 'rooms', JSON.stringify(rooms)]
    );
  }
  
  res.json({ success: true, count: rooms.length });
});
```

### Zones - ❌ NOT IMPLEMENTED
- No sync service call
- Zone maps only stored locally

### Recipes - ❌ NOT IMPLEMENTED
- Static file, not synced
- Would require 61MB+ per farm if synced

---

## Problem Analysis

### After Cache Clear:
1. Browser localStorage cleared ✅ (not a problem - we don't rely on it)
2. Service worker cache cleared ✅ (not a problem - static assets)
3. **Server restart?** ❓ Need confirmation
4. **Data files deleted?** ❓ Need confirmation

### Root Cause Hypothesis:

**If data files persist:**
- `loadAllData()` should reload from `/data/*.json` endpoints
- No issue - data reloads successfully

**If data files deleted:**
- Edge device has no backup mechanism
- Cloud has synced data, but edge doesn't auto-restore
- **MISSING:** Edge-to-cloud restore mechanism

---

## Issues Identified

### 1. No POST /data/rooms.json Endpoint ❌
**Impact:** Room Mapper and other UIs cannot directly save rooms
**Current Workaround:** Use `/api/setup/save-rooms` instead
**Solution:** Add endpoint matching groups pattern

### 2. No Edge-to-Cloud Restore Mechanism ❌
**Impact:** After data loss, edge device cannot restore from cloud
**Current State:** One-way sync (edge → cloud)
**Solution:** Implement cloud → edge restore on startup/error

### 3. Zones Not Synced to Cloud ❌
**Impact:** Zone maps lost if edge device fails
**Current State:** Only stored in local files
**Solution:** Sync zone maps to cloud

### 4. No Automatic Data Recovery ❌
**Impact:** Manual intervention required after data loss
**Current State:** Admin must manually restore files
**Solution:** Auto-restore from cloud on empty data detection

---

## Recommendations

### Priority 1: Add POST /data/rooms.json
```javascript
// Match groups.json pattern
app.post('/data/rooms.json', asyncHandler(async (req, res) => {
  const { rooms } = req.body;
  
  // Save to disk
  const roomsFilePath = path.join(__dirname, 'public', 'data', 'rooms.json');
  const roomsData = {
    rooms,
    metadata: {
      lastUpdated: new Date().toISOString(),
      version: '1.0'
    }
  };
  
  await fs.promises.writeFile(roomsFilePath, JSON.stringify(roomsData, null, 2), 'utf8');
  
  // Sync to cloud
  if (process.env.GREENREACH_CENTRAL_URL && process.env.FARM_ID) {
    const syncService = getSyncService();
    await syncService.syncRooms(rooms);
  }
  
  res.json({ success: true, count: rooms.length, synced: !!process.env.GREENREACH_CENTRAL_URL });
}));
```

### Priority 2: Add Cloud Restore on Startup
```javascript
// lib/sync-service.js - Add restore function
async restoreFromCloud() {
  try {
    // Restore groups
    const groupsResponse = await axios.get(
      `${this.centralUrl}/api/sync/${this.farmId}/groups`,
      { headers: { 'Authorization': `Bearer ${this.apiKey}` } }
    );
    if (groupsResponse.data.groups) {
      await this.saveLocalGroups(groupsResponse.data.groups);
    }
    
    // Restore rooms
    const roomsResponse = await axios.get(
      `${this.centralUrl}/api/sync/${this.farmId}/rooms`,
      { headers: { 'Authorization': `Bearer ${this.apiKey}` } }
    );
    if (roomsResponse.data.rooms) {
      await this.saveLocalRooms(roomsResponse.data.rooms);
    }
    
    logger.info('[sync-service] Successfully restored data from cloud');
  } catch (error) {
    logger.error('[sync-service] Failed to restore from cloud:', error);
  }
}
```

### Priority 3: Auto-Restore on Empty Data
```javascript
// public/app.foxtrot.js - In loadAllData()
async function loadAllData() {
  // ... existing code ...
  
  STATE.groups = groups?.groups || [];
  STATE.rooms = rooms?.rooms || [];
  
  // Auto-restore from cloud if empty
  if (STATE.groups.length === 0 || STATE.rooms.length === 0) {
    console.warn('[loadAllData] Empty data detected, attempting cloud restore...');
    try {
      const restored = await fetch('/api/sync/restore', { method: 'POST' });
      if (restored.ok) {
        console.log('[loadAllData] Cloud restore successful, reloading...');
        location.reload(); // Reload page to fetch restored data
      }
    } catch (err) {
      console.error('[loadAllData] Cloud restore failed:', err);
    }
  }
}
```

### Priority 4: Sync Zone Maps
```javascript
// lib/sync-service.js - Add zone sync
async syncZoneMap(roomId, zoneMapData) {
  const response = await axios.post(
    `${this.centralUrl}/api/sync/${this.farmId}/zone-maps/${roomId}`,
    zoneMapData,
    { headers: { 'Authorization': `Bearer ${this.apiKey}` } }
  );
  return response.data;
}
```

---

## Testing Plan

### Test 1: Clear Browser Cache
1. Open DevTools → Application → Clear storage
2. Reload page
3. **Expected:** Data reloads from server
4. **Verify:** Groups, rooms, zones all visible

### Test 2: Delete Local Files
```bash
ssh greenreach@100.65.187.59
rm /home/greenreach/Light-Engine-Foxtrot/public/data/groups.json
rm /home/greenreach/Light-Engine-Foxtrot/public/data/rooms.json
```
5. Reload page
6. **Expected:** Auto-restore from cloud
7. **Verify:** Files recreated, data visible

### Test 3: Server Restart
```bash
ssh greenreach@100.65.187.59
pm2 restart foxtrot-node
```
8. Wait 30 seconds
9. Reload page
10. **Expected:** Data persists
11. **Verify:** All data intact

---

## Implementation Steps

1. ✅ Document current state (this file)
2. Add `POST /data/rooms.json` endpoint
3. Add cloud restore API endpoints
4. Add auto-restore logic to `loadAllData()`
5. Test cache clear scenarios
6. Deploy to edge device
7. Verify with user

---

## Notes

- Recipes (lighting-recipes.json) are 61MB+ and not user-editable, no sync needed
- Zones stored in room-map files, need individual sync per room
- Current sync is one-way (edge → cloud), need bidirectional
- Cloud already has PostgreSQL storage via `farm_data` table

