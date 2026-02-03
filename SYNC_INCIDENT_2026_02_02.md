# Sync Incident Report - February 2, 2026

## 🚨 Incident Summary

**Status:** ACTIVE - Protection mode deployed  
**Priority:** P1 - Data integrity issue  
**Affected System:** Edge Device (reTerminal @ 100.65.187.59) sync with GreenReach Central  
**Resolution Deadline:** February 4, 2026 (48 hours)

---

## Timeline

### Saturday, January 31, 2026 - 15:48:11 EST
- **Central Database Corrupted**
- `farm_data` table for FARM-MKLOMAT3-A9D8 seeded with fake demo data
- Groups: `GreenReach:1:Aeroponic Trays` (FAKE)
- Rooms: `GreenReach` with Zone 1 (FAKE)
- **Root Cause:** Unknown - likely manual seeding or dev environment data leak

### Saturday, February 1, 2026 - 13:41 EST
- **Edge Backup Created** (GOOD DATA)
- Contains real farm data: `room-knukf2`, 3 groups (Little/Big/Mid Green)
- Crops: Astro Arugula, Buttercrunch Lettuce, Genovese Basil
- This backup is SOURCE OF TRUTH

### Sunday, February 2, 2026 - 14:21 EST
- **Edge Device Restored** from Feb 1 backup
- Correct data deployed to reTerminal
- Groups: `room-knukf2:1:little-green`, `room-knukf2:1:big-green`, `room-knukf2:1:mid-green`

### Sunday, February 2, 2026 - 15:30 EST
- **Investigation Completed** (Root Cause Analysis)
- Queried Central PostgreSQL directly
- Confirmed: Central has fake data timestamped Jan 31
- Confirmed: Edge NEVER pushed corrupted data
- Conclusion: Central was seeded incorrectly before edge deployment

### Sunday, February 2, 2026 - 16:00 EST
- **Protection Deployed**
- Added `"authoritative": true` flag to edge config
- Modified `lib/sync-service.js` to skip `restoreFromCloud()`
- Deployed to reTerminal
- Edge now protected from Central corruption overwrite

---

## Technical Details

### Problem Statement
`lib/sync-service.js` lines 600-648 `restoreFromCloud()` pulls rooms/groups FROM Central and OVERWRITES edge's local files. When Central has corrupted data, this destroys edge's correct data.

### Architecture Flaw
- **Current:** Bi-directional sync (Central → Edge and Edge → Central)
- **Intended:** Uni-directional sync (Edge → Central only, Central is read-only aggregator)
- **Issue:** No authority check - edge blindly accepts Central's data

### Solution Implemented
**File:** `lib/sync-service.js` start() method
```javascript
// TEMPORARY FIX (2026-02-02): Prevents Central corruption overwrite
if (edgeConfig.get('authoritative')) {
  console.log('🛡️  Edge is authoritative - skipping restoreFromCloud()');
} else {
  await this.restoreFromCloud();
}
```

**File:** `config/edge-config.json` (on reTerminal)
```json
{
  "mode": "edge",
  "farmId": "FARM-MKLOMAT3-A9D8",
  "farmName": "Big Green Farm",
  "authoritative": true,  // ← PROTECTION FLAG
  "syncEnabled": true,
  "registrationComplete": true
}
```

### Monitoring Added
Heartbeat logs warning every 30 seconds while protection active:
```
⚠️  [sync-service] PROTECTED MODE: Edge authoritative flag active
```

---

## Data State

### Edge Device (CORRECT) ✅
**Location:** `public/data/groups.json` on reTerminal  
**Modified:** Feb 2, 2026 14:21:53  
**Source:** Restored from `backups/20260201-134153/groups.json`

```json
{
  "groups": [
    {
      "id": "room-knukf2:1:little-green",
      "name": "Little Green Group",
      "crop": "Astro Arugula",
      "roomId": "room-knukf2"
    },
    {
      "id": "room-knukf2:1:big-green",
      "name": "Big Green Group",
      "crop": "Buttercrunch Lettuce",
      "roomId": "room-knukf2"
    },
    {
      "id": "room-knukf2:1:mid-green",
      "name": "Mid Green Group",
      "crop": "Genovese Basil",
      "roomId": "room-knukf2"
    }
  ]
}
```

### Central Database (CORRUPTED) ❌
**Location:** PostgreSQL `farm_data` table  
**Updated:** Jan 31, 2026 15:48:11  
**Issue:** Contains fake demo data

```json
{
  "groups": [
    {
      "id": "GreenReach:1:Aeroponic Trays",
      "crop": "Astro Arugula",
      "name": "Aeroponic Trays",
      "zone": "GreenReach:1"
    }
  ]
}
```

---

## Recovery Plan

### Option A: Wipe Central and Re-sync (RECOMMENDED) ✅

**Rationale:** Clean slate, forces edge to push authoritative data

**Steps:**
1. Verify edge has correct data (test at http://100.65.187.59:8091)
2. Delete Central data:
   ```sql
   DELETE FROM farm_data 
   WHERE farm_id = 'FARM-MKLOMAT3-A9D8' 
   AND data_type IN ('groups', 'rooms');
   ```
3. Wait for next heartbeat (30 seconds)
4. Edge will detect empty Central and push full data
5. Verify Central matches edge:
   ```sql
   SELECT data_type, updated_at, 
          jsonb_array_length(data->'groups') as group_count
   FROM farm_data 
   WHERE farm_id = 'FARM-MKLOMAT3-A9D8';
   ```
6. Expected: 3 groups with room-knukf2 IDs

### Option B: Manual SQL Insert

**Rationale:** Direct control, immediate fix

**Steps:**
1. Copy `groups.json` and `rooms.json` from edge backup
2. Convert JSON to SQL:
   ```sql
   UPDATE farm_data 
   SET data = '{"groups": [...]}', 
       updated_at = NOW()
   WHERE farm_id = 'FARM-MKLOMAT3-A9D8' 
   AND data_type = 'groups';
   ```
3. Verify with SELECT query
4. Test edge sync shows matching data

### Option C: Force Push from Edge (FUTURE ENHANCEMENT)

**Rationale:** Proper architecture - edge can override Central

**Implementation Required:**
- New endpoint: `POST /api/sync/force-push`
- Edge sends authoritative data with force flag
- Central replaces without merge
- **Not available in current codebase**

---

## Flag Removal Criteria

### Pre-Removal Checks
- [ ] Central database has correct data (room-knukf2, 3 groups)
- [ ] Timestamp verification: Central updated_at > edge restoration time
- [ ] Data match test: Query Central, compare to edge groups.json
- [ ] User verification: Admin confirms dashboard shows correct groups

### Removal Process
1. **Test Central data:**
   ```bash
   curl https://greenreachgreens.com/api/admin/farms \
     -H "Authorization: Bearer $ADMIN_TOKEN" | jq '.farms[] | select(.id=="FARM-MKLOMAT3-A9D8")'
   ```

2. **SSH to reTerminal:**
   ```bash
   ssh greenreach@100.65.187.59
   cd ~/Light-Engine-Foxtrot
   ```

3. **Remove flag from config:**
   ```bash
   nano config/edge-config.json
   # Delete line: "authoritative": true,
   ```

4. **Restart PM2:**
   ```bash
   pm2 restart lightengine-node --update-env
   ```

5. **Monitor logs:**
   ```bash
   pm2 logs lightengine-node --lines 50 | grep sync
   # Should show: restoreFromCloud() executing
   # Should NOT show: "Edge is authoritative"
   ```

6. **Verify data persists:**
   ```bash
   curl http://100.65.187.59:8091/api/wholesale/inventory
   # Should still show room-knukf2 groups
   ```

---

## Lessons Learned

### What Went Wrong
1. **Bi-directional sync design flaw** - Central should never overwrite edge
2. **No authority flags** - Edge blindly accepts Central's data
3. **Demo data in production** - Central seeded with fake GreenReach data
4. **No Central data validation** - Corrupted data went undetected until edge deployment

### Preventive Measures
1. **Architecture Change:** Implement uni-directional sync (Edge → Central only)
2. **Authority Flags:** All edge devices should have `authoritative: true` by default
3. **Data Validation:** Central should reject data not matching farm schema
4. **Environment Separation:** Demo data must never reach production database
5. **Monitoring:** Alert on data schema mismatches or unexpected group IDs

### Process Improvements
1. **Framework Compliance:** This incident followed Investigation-First properly
2. **Multi-Agent Review:** Review Agent caught missing documentation requirements
3. **Testing Protocol:** Root cause verified before deploying fix
4. **Documentation:** This incident report created before deployment

---

## Monitoring & Alerts

### Current Monitoring
- Edge PM2 logs show protection mode warning every 30 seconds
- Manual check: `pm2 logs lightengine-node --lines 20 | grep PROTECTED`
- Expected output: `⚠️  PROTECTED MODE: Edge authoritative flag active`

### Required Alerts (TODO)
- [ ] Dashboard indicator: "Edge in Protected Mode"
- [ ] Central admin panel: Show edge authority status
- [ ] Slack notification: Daily reminder while flag active
- [ ] Deadline countdown: "Protection expires in X hours"

---

## Sign-Off

**Incident Commander:** Implementation Agent  
**Technical Review:** Review Agent (APPROVED WITH CONDITIONS)  
**Architecture Review:** Architecture Agent (Recommended uni-directional sync)  
**Deployment Status:** LIVE - Protection active on reTerminal  
**Next Review:** February 4, 2026 (or when Central fixed, whichever is earlier)  

---

## Related Documentation
- `.github/AGENT_SKILLS_FRAMEWORK.md` - Framework principles
- `DATA_FORMAT_STANDARDS.md` - Canonical group schema
- `CLOUD_EDGE_SYNC_ARCHITECTURE.md` - Original sync design
- `backups/20260201-134153/` - Source of truth backup

## Contact
- Edge Device: http://100.65.187.59:8091
- Central API: https://greenreachgreens.com
- PostgreSQL: greenreach-central-prod-v3.cngxyjylabdj.us-east-1.rds.amazonaws.com
