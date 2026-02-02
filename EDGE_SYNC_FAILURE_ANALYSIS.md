# Edge Sync Failure Analysis - Post-Reboot Issues
**Date**: February 1, 2026  
**Status**: Critical - Production Edge device not syncing  
**Farm**: Big Green Farm (FARM-MKLOMAT3-A9D8) @ 100.65.187.59:8091

## 🚨 PROBLEM STATEMENT

After reboot, the Light Engine Edge device is:
1. ❌ **NOT syncing data** from GreenReach Central
2. ❌ **NOT receiving farm metadata updates** (phone number changes not pushed)
3. ❌ **NOT displaying correct room/zone information**
4. ❌ **Groups v2 UI not loading saved groups correctly**
5. ✅ **GreenReach Central HAS correct data** (shows proper info from LE)

User reports: "this has been working well" → **REGRESSION**

## 🔍 ROOT CAUSE ANALYSIS

### Issue 1: Wrong Farm ID in Edge Config
```json
// CURRENT (WRONG):
{
  "mode": "edge",
  "farmId": "GR-00001",  // ❌ DEMO FARM ID
  "syncEnabled": true,
  "centralApiUrl": "http://localhost:3000",  // ❌ WRONG URL
  "apiKey": "demo-api-key-..."  // ❌ DEMO KEY
}

// EXPECTED (CORRECT):
{
  "mode": "edge",
  "farmId": "FARM-MKLOMAT3-A9D8",  // ✅ Real farm
  "syncEnabled": true,
  "centralApiUrl": "https://greenreachgreens.com",  // ✅ Production Central
  "apiKey": "<production-api-key>"  // ✅ Real API key
}
```

**Source**: `ssh greenreach@100.65.187.59 "cat ~/Light-Engine-Foxtrot/config/edge-config.json"`

### Issue 2: Offline Mode Enabled
```bash
$ curl http://100.65.187.59:8091/api/edge/status | jq
{
  "mode": "edge",
  "farmId": "GR-00001",
  "syncEnabled": "demo-api-key-...",  // ❌ CORRUPTED (should be boolean)
  "offlineMode": true  // ❌ SYNC DISABLED
}
```

The Edge device is in **offline mode**, which disables all sync operations.

### Issue 3: Central Database Has NO Data
```bash
$ curl https://greenreachgreens.com/api/admin/operations-overview | jq
{
  "farms": null,
  "plants": null
}
```

Central database query returned **null** for all farms. This suggests:
- Farm registration incomplete OR
- Database connection issue OR
- Farm data never synced from Edge

### Issue 4: Edge Has Correct Local Data
```json
// farm.json (CORRECT):
{
  "farmId": "FARM-MKLOMAT3-A9D8",
  "name": "Big Green Farm",
  "contact": {
    "phone": "+1 (709) 398-3166"  // ✅ Correct
  }
}

// groups.json (CORRECT):
{
  "groups": [
    {"id": "GreenReach:1:Aeroponic Trays", "name": "Aeroponic Trays", ...},
    {"id": "GreenReach:1:Second Group", ...}
  ]
}

// rooms.json (INCOMPLETE):
{
  "rooms": [
    {
      "id": "room-knukf2",
      "name": "Big Green Farm - Room 1",
      "zoneCount": 0  // ❌ NO ZONES
    }
  ]
}
```

**Observation**: Edge has farm/groups data but rooms have zero zones.

## 📊 DATA FLOW ANALYSIS

### Expected Flow (BROKEN):
```
GreenReach Central (AWS)
   │
   │ 1. Farm metadata update (phone number)
   │ 2. Room/zone configuration
   │ 3. Recipe updates
   ↓
Edge Device (100.65.187.59)
   │
   │ lib/sync-service.js
   │ - pullFromCentral() ← NOT RUNNING (offline mode)
   │ - pushToCentral() ← NOT RUNNING (wrong farm ID)
   ↓
Local Data Files
   - public/data/farm.json ← NOT UPDATED
   - public/data/rooms.json ← ZONES EMPTY
   - public/data/groups.json ← OK (local edits)
```

### Actual Flow (CURRENT):
```
Edge Device
   │
   │ ❌ Sync disabled (offlineMode: true)
   │ ❌ Wrong farm ID (GR-00001)
   │ ❌ Wrong Central URL (localhost:3000)
   │ ❌ Demo API key
   ↓
NO COMMUNICATION WITH CENTRAL
```

## 🛠️ SYNC SERVICE INVESTIGATION

### Code Reference: `lib/sync-service.js`

**Lines 42-47**: Sync service checks for Edge mode and registration:
```javascript
if (!edgeConfig.isEdgeMode()) {
  console.log('[sync-service] Not in edge mode, sync disabled');
  return;
}
if (!edgeConfig.isRegistered()) {
  console.log('[sync-service] Edge device not registered');
  return;
}
```

**Lines 98-100**: Uses config values:
```javascript
const farmId = edgeConfig.getFarmId();  // → "GR-00001" ❌
const apiKey = edgeConfig.getApiKey();  // → "demo-api-key-..." ❌
const centralUrl = edgeConfig.getCentralApiUrl();  // → "http://localhost:3000" ❌
```

**Lines 295-303**: Sync telemetry (disabled):
```javascript
if (!edgeConfig.isSyncEnabled()) {
  console.log('[sync-service] Sync disabled, skipping telemetry sync');
  return;  // ← EXITS HERE
}
```

### Server Initialization: `server-foxtrot.js`

**Line 293**: Sync service declared but not initialized:
```javascript
let syncService = null;
```

**Line 26241**: Sync service initialized AFTER database ready:
```javascript
syncService = new SyncService(db);
```

**Lines 7309-7318**: getSyncService() tries to create instance:
```javascript
function getSyncService() {
  if (!syncServiceInstance) {
    const SyncServiceClass = require('./services/sync-service.js').default;
    syncServiceInstance = new SyncServiceClass({
      centralUrl: process.env.GREENREACH_CENTRAL_URL,
      wsUrl: process.env.GREENREACH_WS_URL,
      farmId: process.env.FARM_ID,
      apiKey: process.env.GREENREACH_API_KEY,
      apiSecret: process.env.GREENREACH_API_SECRET
    });
  }
  return syncServiceInstance;
}
```

**Problem**: Uses **environment variables** not **edge-config.json**!

## 📁 FILE STATE ON EDGE

```bash
PM2 Processes (5 minutes uptime):
- lightengine-node: ONLINE (PID 1343)
- lightengine-fastapi: ONLINE (PID 1338)

Config Files:
- edge-config.json: OUTDATED (demo farm ID)
- farm.json: CORRECT (Big Green Farm)
- groups.json: CORRECT (2 groups)
- rooms.json: INCOMPLETE (0 zones)

Deployed Code:
- groups-v2.js: 247K (Jan 27) ✅ Latest
- server-foxtrot.js: RUNNING (latest code)

Logs:
- 404 Not Found: /room-setup.js (file doesn't exist)
- SwitchBot credentials not configured (expected)
```

## 🎯 RECENT CODE CHANGES ANALYSIS

### Commit e3cbee1 (Jan 31): "Farm Edit & Sync Fix - Phase 1"
- **Changes**: 503,501 insertions, 4,304 deletions
- **Impact**: Massive sync-queue.json changes (504,495 lines)
- **Files Modified**:
  - `server-foxtrot.js` (32 lines changed)
  - `greenreach-central/public/central-admin.js` (53 lines)
  - `config/sync-queue.json` (HUGE)

**Hypothesis**: This commit may have:
1. ✅ Fixed Central frontend (null handling)
2. ❌ NOT updated edge-config.json for production
3. ❌ Left Edge in demo/dev configuration

### Recent Deployment (Feb 1): rsync to live Edge
**Script**: `scripts/deploy-to-live-edge.sh`
```bash
# Synced files:
- public/*.js ✅
- lib/ ✅
- routes/ ✅
- server-foxtrot.js ✅

# EXCLUDED files (preserved):
- public/data/ ✅ (correct - live sensor data)
- config/ ❌ (PROBLEM - old edge-config.json preserved)
- .env* ❌ (PROBLEM - environment variables not updated)
```

**Root Cause**: Deployment script **preserves config/** directory, so outdated `edge-config.json` remains.

## 🏗️ FRAMEWORK COMPLIANCE ANALYSIS

### Agent Skills Framework Violations

**Principle 2: Database-Driven > Code Changes**
- ✅ PASS: Local data files (farm.json, groups.json) are correct
- ❌ FAIL: Sync config stored in JSON file, not synced from Central

**Principle 5: Zero Data Format Violations**
- ✅ PASS: No schema changes detected
- ❌ FAIL: Room zones missing (data loss during sync)

**Multi-Agent Review Required**:
- ✅ Implementation Agent: Root cause identified
- ⏳ Review Agent: Validation needed before fix
- ⏳ Architecture Agent: Sync architecture review needed

### DATA_FORMAT_STANDARDS Compliance
- ✅ farm.json: Uses canonical format
- ✅ groups.json: Nested `.groups[]` structure correct
- ❌ rooms.json: Missing zones (should have lighting plans)

## 💡 SOLUTION PROPOSAL

### Phase 1: Immediate Fix (Edge Configuration)

**Step 1**: Update `config/edge-config.json` on production Edge:
```json
{
  "mode": "edge",
  "farmId": "FARM-MKLOMAT3-A9D8",
  "farmName": "Big Green Farm",
  "apiKey": "<PRODUCTION_API_KEY>",
  "centralApiUrl": "https://greenreachgreens.com",
  "syncInterval": 300000,
  "heartbeatInterval": 30000,
  "syncEnabled": true,
  "registrationComplete": true
}
```

**Step 2**: Restart PM2 process:
```bash
ssh greenreach@100.65.187.59 "pm2 restart lightengine-node"
```

**Step 3**: Verify sync starts:
```bash
curl http://100.65.187.59:8091/api/edge/status
# Should show: offlineMode: false, farmId: FARM-MKLOMAT3-A9D8
```

### Phase 2: Farm Registration (Central Database)

**Issue**: Central database has NO farm data (all queries return null)

**Fix**: Re-register farm with Central:
```bash
cd ~/Light-Engine-Foxtrot/greenreach-central
node scripts/register-farm.js
# Input:
# - Farm ID: FARM-MKLOMAT3-A9D8
# - Name: Big Green Farm
# - Contact: shelbygilbert@rogers.com
# - Phone: +1 (709) 398-3166
```

### Phase 3: Initial Data Sync

**Manual sync** from Edge to Central:
```bash
curl -X POST http://100.65.187.59:8091/api/sync/push \
  -H "Content-Type: application/json" \
  -d '{"force": true}'
```

Or **trigger from Central**:
```bash
cd ~/Light-Engine-Foxtrot/greenreach-central
node -e "
import('./lib/db.js').then(async ({query}) => {
  const farmData = require('../public/data/farm.json');
  const groupsData = require('../public/data/groups.json');
  const roomsData = require('../public/data/rooms.json');
  
  await query(
    'INSERT INTO farm_data (farm_id, data_type, data) VALUES ($1, $2, $3) ON CONFLICT (farm_id, data_type) DO UPDATE SET data = $3, updated_at = NOW()',
    ['FARM-MKLOMAT3-A9D8', 'farm_profile', JSON.stringify(farmData)]
  );
  console.log('✓ Farm profile synced');
}).catch(console.error);
"
```

### Phase 4: Room/Zone Data Recovery

**Issue**: rooms.json has 0 zones (lighting plans missing)

**Investigation Needed**:
1. Check if zones exist in database
2. Check if zones lost during deployment
3. Rebuild zones from group configurations

**Fallback**: Restore from backup or recreate in Farm Admin UI

## 🔐 API KEY GENERATION

**Current**: Edge using demo API key  
**Required**: Production API key for FARM-MKLOMAT3-A9D8

**Generate new API key** (Central):
```javascript
const crypto = require('crypto');
const apiKey = `FARM-${crypto.randomBytes(32).toString('hex')}`;
console.log('New API Key:', apiKey);
```

**Store in Central database**:
```sql
INSERT INTO farm_credentials (farm_id, api_key, created_at)
VALUES ('FARM-MKLOMAT3-A9D8', '<new-api-key>', NOW());
```

## ✅ VALIDATION CHECKLIST

After implementing fixes:

- [ ] Edge API: GET /api/edge/status shows correct farmId
- [ ] Edge API: offlineMode = false
- [ ] Edge API: syncEnabled = true
- [ ] Central API: GET /api/admin/operations-overview returns farm data
- [ ] Central API: GET /api/admin/farms/FARM-MKLOMAT3-A9D8 returns farm details
- [ ] Farm Admin UI: Phone number shows updated value
- [ ] Room Setup UI: Zones display correctly
- [ ] Groups v2 UI: Saved groups load properly
- [ ] PM2 logs: No sync errors
- [ ] Database: farm_data table has recent updated_at timestamps

## 📋 REVIEW AGENT QUESTIONS

1. **Data Safety**: Will updating edge-config.json preserve local sensor data?  
   → YES (config/ separate from public/data/)

2. **Rollback Plan**: If sync fails, how to revert?  
   → Keep backup of edge-config.json, set syncEnabled=false

3. **Testing**: Should test on dev Edge first?  
   → No dev Edge available, but can test with syncEnabled=false first

4. **Central Registration**: Should we auto-register or manual?  
   → Manual (more control over farm metadata)

5. **API Key Security**: How to securely transfer production API key?  
   → Generate on Central, transmit via SSH, store in edge-config.json (file permissions 600)

## 🏛️ ARCHITECTURE AGENT REVIEW

**Sync Architecture Issues Identified**:

1. **Config Source**: Edge uses JSON file, not Central database  
   → Consider: Central-managed edge configurations

2. **Registration Flow**: Manual script, prone to errors  
   → Consider: Web UI for farm registration + auto-sync

3. **Deployment Gaps**: rsync preserves config/, may keep stale configs  
   → Consider: Include config template in deployment, require manual merge

4. **Environment Variables**: getSyncService() uses env vars, edge-config.js uses JSON  
   → **CONFLICT**: Two config sources for same values

5. **Offline Mode Detection**: Currently manual flag, not auto-detected  
   → Consider: Auto-detect Central unreachability, set offline mode

**Recommendation**: 
- Short-term: Fix edge-config.json (manual)
- Long-term: Refactor to Central-managed Edge configs with pull-based updates

## 🎯 NEXT STEPS

**Implementation Agent (NOW)**:
1. Create corrected edge-config.json template
2. Document API key generation process
3. Write deployment script for config updates
4. Present to Review Agent

**Review Agent (NEXT)**:
1. Validate config values (farm ID, URLs, intervals)
2. Check sync-service.js compatibility
3. Verify data safety (no overwrites)
4. Approve for deployment

**Architecture Agent (LATER)**:
1. Review sync architecture (two config sources)
2. Design Central-managed Edge config system
3. Plan migration strategy

## 📝 REFERENCES

- Edge Config: `/config/edge-config.json`
- Sync Service: `/lib/sync-service.js`
- Edge Routes: `/routes/edge.js`
- Server Init: `/server-foxtrot.js:26241`
- Farm Registration: `/greenreach-central/scripts/register-farm.js`
- Data Formats: `/DATA_FORMAT_STANDARDS.md`
- Agent Framework: `/.github/AGENT_SKILLS_FRAMEWORK.md`

---

**Status**: Ready for Review Agent validation  
**Priority**: P0 - Critical production issue  
**Impact**: Complete loss of sync functionality after reboot
