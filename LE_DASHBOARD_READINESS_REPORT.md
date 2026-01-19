# LE-dashboard.html Readiness Report
**Date:** 2026-01-20  
**Issue:** Dashboard loading mock data instead of setup wizard data  
**Severity:** 🔴 CRITICAL - Complete data flow disconnect

---

## Executive Summary

LE-dashboard.html is **completely disconnected** from the setup wizard data persistence system. The dashboard loads from a static demo file (`/data/rooms.json`) containing 812 lines of hardcoded demo farm data, instead of reading the user's configuration saved during setup.

### Root Cause
The dashboard's JavaScript (`app.foxtrot.js`) calls `loadRoomsFromBackend()` which fetches `/data/rooms.json` - a static demo file served by the backend. This file contains:
- **Room A**: "Leafy Greens Production" with 5 lettuce racks (192 plants each)
- **Room B**: "Herb Production" with multiple herb groups  
- **Room C**: "Microgreens & Specialty"
- Total: 812 lines of demo data that has nothing to do with user's setup

### Impact
- ✅ Setup wizard saves user data correctly to NeDB: `wizardStatesDB` with key `'setup_config'`
- ❌ Dashboard never reads from NeDB - only loads demo data
- ❌ User sees fake farm with lettuce, herbs, microgreens they never configured
- ❌ All setup wizard work (farm name, rooms, contact info) is ignored

---

## Critical Issues

### 1. 🔴 CRITICAL: Wrong Data Source
**Location:** [public/app.foxtrot.js](public/app.foxtrot.js#L4977-L4984)  
**Line:** 4977-4984

```javascript
async function loadRoomsFromBackend() {
  try {
    const resp = await fetch('/data/rooms.json');  // ❌ Static demo file!
    if (resp.ok) {
      const data = await resp.json();
      STATE.rooms = data.rooms || [];
    }
  } catch (e) { console.warn('Failed to reload rooms:', e); }
}
```

**Problem:**  
- Fetches from `/data/rooms.json` (static file) instead of API endpoint
- Never calls `/api/setup/status` or reads from NeDB
- Ignores all setup wizard data saved to `wizardStatesDB`

**Expected Behavior:**  
Should call `/api/setup/status` which returns:
```javascript
{
  success: true,
  setupCompleted: true,
  config: {
    farmName: "User's Farm",
    ownerName: "User's Name",
    rooms: [/* actual user rooms */],
    // ... user's actual setup data
  }
}
```

**Fix Required:**  
Replace static file fetch with API call to setup data source.

---

### 2. 🔴 CRITICAL: Demo Data File Still Exists
**Location:** [public/data/rooms.json](public/data/rooms.json)  
**Size:** 812 lines of mock data

**Content Sample:**
```json
{
  "rooms": [
    {
      "id": "ROOM-A",
      "name": "Room A - Leafy Greens Production",
      "zones": [
        {
          "zoneId": "ROOM-A-Z1",
          "name": "Zone 1 - Lettuce Production",
          "crop": "Lettuce",
          "groups": [
            {
              "groupId": "ROOM-A-Z1-G01",
              "name": "Butterhead Lettuce Rack 1",
              "plants": 192,
              // ... hundreds more lines
```

**Problem:**  
- This file should have been deleted weeks ago per user statement
- Contains elaborate demo farm with lettuce racks, herb production, microgreens
- User sees this fake data instead of their real configuration
- Creates confusion about what data is real vs demo

**Fix Required:**  
Delete file OR modify backend to serve real user data at this endpoint.

---

### 3. 🟠 HIGH: Wrong Authentication Endpoint
**Location:** [public/LE-dashboard.html](public/LE-dashboard.html#L2422)  
**Line:** 2422

```javascript
const response = await fetch('/api/farm/auth/change-password', {
```

**Problem:**  
- Uses deprecated `/api/farm/auth/` prefix (wrong for edge devices)
- Should use `/api/auth/change-password` 
- Same issue that was fixed in 6 other files (commit e337d48)
- LE-dashboard.html was missed in that batch update

**Evidence:**  
Previous fix updated these files:
- `public/farm-admin.js` line 162
- `admin.js` line 40
- `farm-admin.js` line 119
- `public/admin.js` line 57
- `docs/farm-admin.js` line 177
- `docs/farm-admin-login.html` line 458

But LE-dashboard.html was overlooked.

**Fix Required:**  
Change `/api/farm/auth/change-password` → `/api/auth/change-password`

---

### 4. 🟠 HIGH: Demo Mode References Throughout
**Location:** [public/LE-dashboard.html](public/LE-dashboard.html)  
**Lines:** 19, 2373, 2558, 2839

```html
Line 19: <!-- Console wrapper for demo mode - loaded FIRST -->
Line 2373: // Show intro card sequence when page loads (only in demo mode)
Line 2558: // Simulate successful connection for demo
Line 2839: ? 'http://localhost:8091/Farmsales-store.html' // For demo
```

**Problem:**  
- Multiple "demo mode" comments and logic paths
- Suggests dashboard may have demo fallback behavior
- Creates ambiguity about when real vs demo data is shown
- Should be production-ready without demo code paths

**Fix Required:**  
- Remove all demo mode references
- Ensure dashboard only shows real user data
- No fallback to demo/mock data

---

### 5. 🟡 MEDIUM: Backend Serves Demo Data
**Location:** [server-foxtrot.js](server-foxtrot.js#L17081-L17120)  
**Line:** 17081-17120

```javascript
app.get('/data/rooms.json', (req, res, next) => {
  const farm = loadDemoFarmSnapshot();  // ❌ Loads demo data
  if (!farm) return next();
  
  // Transform rooms to include fixtures
  const lights = farm.devices?.lights || [];
  const rooms = (farm.rooms || []).map(room => {
    // ... demo data transformation
```

**Problem:**  
- Backend endpoint explicitly loads demo farm snapshot
- Even if frontend called correct endpoint, backend serves demo data
- No code path to serve real user data from NeDB
- Disconnected from setup wizard persistence layer

**Fix Required:**  
- Change endpoint to read from `wizardStatesDB` instead of demo snapshot
- Return user's actual setup data saved during setup wizard
- Match data structure that setup wizard saves

---

### 6. 🟡 MEDIUM: No Connection to Setup Wizard Output
**Gap Analysis:**

**Setup Wizard Saves** (setup-wizard.html → server-foxtrot.js):
```javascript
// POST /api/setup/complete
await wizardStatesDB.updateAsync(
  { key: 'setup_config' },
  {
    key: 'setup_config',
    completed: true,
    completedAt: new Date().toISOString(),
    farmName: formData.farmName,
    ownerName: formData.ownerName,
    contactEmail: formData.contactEmail,
    contactPhone: formData.contactPhone,
    rooms: rooms  // Array of user's rooms
  },
  { upsert: true }
);
```

**Dashboard Expects** (from /data/rooms.json):
```json
{
  "rooms": [
    {
      "id": "ROOM-A",
      "roomId": "ROOM-A", 
      "name": "Room A - Leafy Greens Production",
      "zones": [...],
      "fixtures": [...]
    }
  ]
}
```

**Data Structure Mismatch:**
- Setup wizard saves: `{ key: 'setup_config', farmName, ownerName, rooms: [...] }`
- Dashboard expects: `{ rooms: [{ id, roomId, name, zones, fixtures }] }`
- No adapter layer connects the two
- Room structure may differ (setup likely simpler than dashboard expects)

---

## Working Reference: How It Should Work

### Farm-Admin.html Pattern (CORRECT)
The working farm admin interface likely reads from a proper API:

```javascript
// Load farm data from authenticated API
const resp = await fetch('/api/farm/profile', {
  headers: { 'Authorization': `Bearer ${token}` }
});

if (resp.ok) {
  const data = await resp.json();
  if (data.status === 'success' && data.farm) {
    STATE.farm = data.farm;
    if (Array.isArray(data.farm.rooms)) {
      STATE.rooms = data.farm.rooms;
    }
  }
}
```

This shows the **correct pattern**:
1. Fetch from authenticated API endpoint
2. Pass token for authentication
3. Read actual farm data from backend
4. Populate STATE with real user data

---

## Recommended Fixes

### Priority 1: Create Setup Data API Endpoint

**Add to server-foxtrot.js:**
```javascript
// Replace demo data endpoint with real user data from NeDB
app.get('/api/setup/data', async (req, res) => {
  try {
    // Check if using NeDB (edge device)
    if (!req.app.locals.db) {
      const setupConfig = await wizardStatesDB.findOne({ key: 'setup_config' });
      
      if (!setupConfig) {
        return res.status(404).json({
          success: false,
          error: 'No setup configuration found'
        });
      }
      
      // Return user's actual setup data
      return res.json({
        success: true,
        setupCompleted: setupConfig.completed || false,
        config: {
          farmName: setupConfig.farmName,
          ownerName: setupConfig.ownerName,
          contactEmail: setupConfig.contactEmail,
          contactPhone: setupConfig.contactPhone,
          rooms: setupConfig.rooms || []
        }
      });
    }
    
    // Cloud/PostgreSQL path (if needed)
    const pool = req.app.locals.db;
    // ... query PostgreSQL for setup data
    
  } catch (error) {
    console.error('[api/setup/data] Error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to load setup data'
    });
  }
});
```

### Priority 2: Update Dashboard to Use Real Data

**Modify app.foxtrot.js loadRoomsFromBackend():**
```javascript
async function loadRoomsFromBackend() {
  try {
    // Try to load from setup data API first
    const token = localStorage.getItem('token');
    
    const resp = await fetch('/api/setup/data', {
      headers: token ? { 'Authorization': `Bearer ${token}` } : {}
    });
    
    if (resp.ok) {
      const data = await resp.json();
      if (data.success && data.config) {
        // Store farm metadata
        STATE.farm = {
          farmId: 'USER-FARM',  // or generate proper ID
          name: data.config.farmName,
          ownerName: data.config.ownerName,
          contactEmail: data.config.contactEmail,
          contactPhone: data.config.contactPhone
        };
        
        // Load user's actual rooms
        STATE.rooms = data.config.rooms || [];
        
        console.log('[loadRoomsFromBackend] Loaded real user data:', 
                    STATE.rooms.length, 'rooms');
        return;
      }
    }
    
    // Fallback: empty state (not demo data)
    console.warn('[loadRoomsFromBackend] No setup data found, starting fresh');
    STATE.rooms = [];
    
  } catch (e) {
    console.error('[loadRoomsFromBackend] Failed to load:', e);
    STATE.rooms = [];
  }
}
```

### Priority 3: Remove Demo Data

**Delete or archive:**
```bash
# Move demo file out of public directory
mv public/data/rooms.json public/data/rooms.json.demo-backup

# Or delete entirely
rm public/data/rooms.json
```

### Priority 4: Fix Authentication Endpoint

**In LE-dashboard.html line 2422:**
```javascript
// OLD: const response = await fetch('/api/farm/auth/change-password', {
const response = await fetch('/api/auth/change-password', {
```

### Priority 5: Clean Up Demo Mode Code

**Remove from LE-dashboard.html:**
- Line 19: Demo mode console wrapper comment
- Line 2373: Demo mode intro card logic
- Line 2558: Simulated connection comments
- Line 2839: Demo URL references

---

## Data Flow Diagram

### Current (BROKEN) Flow:
```
User → Setup Wizard → NeDB (setup_config) → ❌ DISCONNECTED ❌
                                                    ↓
Dashboard → app.foxtrot.js → /data/rooms.json (static demo file) → Demo Data
```

### Fixed Flow:
```
User → Setup Wizard → NeDB (setup_config)
                           ↓
                    /api/setup/data endpoint
                           ↓
Dashboard → app.foxtrot.js → /api/setup/data → Real User Data → STATE.rooms
```

---

## Testing Checklist

After implementing fixes, verify:

1. **Setup Wizard Saves Data:**
   ```bash
   # Check NeDB after completing setup
   curl http://localhost:8091/api/setup-wizard/status
   # Should return: { success: true, setupCompleted: true }
   ```

2. **New API Returns User Data:**
   ```bash
   curl http://localhost:8091/api/setup/data
   # Should return user's actual farmName, rooms, etc.
   ```

3. **Dashboard Loads Real Data:**
   - Open http://localhost:8091/LE-dashboard.html
   - Check console: Should log "Loaded real user data: X rooms"
   - Verify farm name in header matches setup wizard input
   - Verify rooms match what was entered in setup

4. **No Demo Data:**
   - Search page for "Butterhead Lettuce", "Room A", etc.
   - Should find ZERO matches if demo data removed
   - All displayed data should match user input

5. **Authentication Works:**
   - Test password change functionality
   - Should use `/api/auth/change-password` endpoint
   - Should not error with 404 or wrong endpoint

---

## Risk Assessment

**If Not Fixed:**
- ❌ Every edge device user sees fake lettuce farm data
- ❌ Setup wizard is completely useless (data goes nowhere)
- ❌ Users cannot manage their actual rooms/equipment
- ❌ Cannot build on dashboard (all features based on fake data)
- ❌ Production deployment impossible with demo data

**Effort Estimate:**
- Priority 1-2 fixes: 2-3 hours (new endpoint + frontend update)
- Priority 3-5 cleanup: 30 minutes (deletions + small fixes)
- Testing: 1 hour
- **Total: ~4 hours to complete data flow connection**

---

## Related Files

### Frontend Files:
- `/public/LE-dashboard.html` - Main dashboard HTML (uses app.foxtrot.js)
- `/public/app.foxtrot.js` - Dashboard JavaScript (22,092 lines)
  - Line 4977: `loadRoomsFromBackend()` function (needs fixing)
  - Line 6178: `STATE` global variable initialization
  - Line 6190: `loadFarmData()` function reference
  - Line 6249: `removeDemoRooms()` function (legacy cleanup)

### Backend Files:
- `/server-foxtrot.js` - Main Express server
  - Line 17081: `/data/rooms.json` endpoint (serves demo data)
  - Line 6675: Setup complete endpoint (saves to NeDB)
  - Line 10399: `/api/setup-wizard/status` endpoint (reads NeDB)

### Data Files:
- `/public/data/rooms.json` - 812 lines of demo data (DELETE)
- `./data/wizard-states.db` - NeDB file with real user data (CORRECT SOURCE)

### Reference Files (Working Examples):
- `/public/setup-wizard.html` - Correctly saves to NeDB
- `/public/farm-admin.html` - Likely uses correct API pattern

---

## Comparison to Other Dashboards

**LE-dashboard.html** (BROKEN):
- Loads from static `/data/rooms.json`
- Shows demo farm data
- Disconnected from setup wizard

**farm-admin.html** (WORKING?):
- Likely loads from `/api/farm/profile`
- Uses authentication token
- Connected to real farm data

**Recommendation:**  
Review farm-admin.html implementation as reference for correct data loading pattern.

---

## Next Steps

1. ✅ **Review Report** - Understand full scope of disconnect
2. 🔧 **Implement Priority 1-2** - Create API endpoint + update frontend
3. 🧹 **Implement Priority 3-5** - Delete demo data + fix endpoints
4. ✅ **Test End-to-End** - Setup wizard → save → dashboard → display
5. 📝 **Document** - Update any docs about dashboard data flow
6. 🚀 **Deploy** - Test on reTerminal edge device
7. 🔍 **Verify** - Confirm no demo data visible to users

---

**Report Generated:** 2026-01-20  
**Agent:** GitHub Copilot  
**Related Reports:** 
- `EDGE_DEPLOYMENT_READINESS_REPORT.md` (12 issues fixed)
- All previous issues in readiness report now resolved
- This is the final major gap preventing production deployment

**Status:** 🔴 **CRITICAL - BLOCKS PRODUCTION USE**  
All other edge issues are fixed. This is the last showstopper.
