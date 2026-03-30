# Farm Summary Page Investigation
**Date**: February 3, 2026  
**Page**: http://localhost:8091/views/farm-summary.html  
**Issue**: JavaScript errors preventing page load  
**Farm**: Big Green Farm (FARM-MKLOMAT3-A9D8)

---

## Summary

Farm Summary page is failing to load despite all required data being present. User reported JavaScript errors after signing in with correct credentials. Investigation reveals authentication token issues and potential data loading failures.

---

## Data Availability Status

### ✅ DATA EXISTS AND IS ACCESSIBLE

**Farm Identity** (`/data/farm.json`):
```json
{
  "farmId": "FARM-MKLOMAT3-A9D8",
  "name": "Big Green Farm",
  "status": "online",
  "region": "Ontario, Canada",
  "contact": {
    "name": "Shelby Gilbert",
    "email": "shelbygilbert@rogers.com"
  },
  "coordinates": { "lat": 47.6062, "lng": -122.3321 }
}
```

**Room Structure** (`/data/rooms.json`):
- **1 room**: "Big Green Farm - Room 1"
- **Room ID**: room-knukf2

**Zone Layout** (`/data/room-map.json`):
- **1 zone**: room-knukf2:1 (Zone 1)
- **Width**: 800px, **Height**: 600px
- **Devices**: ESP32 Sensor (serial-0001) at position (400, 300)
- **Live telemetry**: 18.67°C, 65% humidity, VPD 0.65

**Active Groups** (`/data/groups.json`):
- **8 groups** currently growing
- **First group**: ROOM-A-Z1-G01
- **Zone**: ROOM-A-Z1
- **Crop**: Mei Qing Pak Choi
- **Recipe**: Mei Qing Pak Choi

**Sensor Data** (`/data/env.json`):
- **Last update**: 2026-02-03T22:52:21.811Z (live)
- **Source**: ESP32 Sensor (ttyUSB1) → serial-0001
- **Status**: Active, updating every 10 seconds via esp32-to-env.py bridge

---

## Authentication Status

### ❌ NO ACTIVE SESSION

**Token Check**:
```bash
$ cat ~/.le-token
# File does not exist
```

**Browser localStorage**:
- `localStorage.getItem('token')` → **NULL**
- User claims "signed in with correct credentials"
- **Mismatch**: User believes they're authenticated, but no token exists

**Implications**:
1. `/api/farm/profile` endpoint will NOT be called (requires Bearer token)
2. Page SHOULD fall back to `/data/farm.json` (which works)
3. **Question**: Where is user logging in? What login page did they use?

---

## Expected Page Load Sequence

**farm-summary.html** (7,084 lines) follows this workflow:

### Phase 1: Farm Name Loading (Lines 2020-2077)
```javascript
async function loadFarmNameIntoHeader() {
  const token = localStorage.getItem('token');  // ← Returns NULL
  
  if (token) {
    // Try: GET /api/farm/profile (with Authorization header)
    // ❌ SKIPPED - no token
  }
  
  // Fallback: GET /data/farm.json
  // ✅ SHOULD WORK - file exists, returns "Big Green Farm"
  
  // Update <h1> to "Big Green Farm Room Summary"
  // Update document.title
}
```

**Expected Outcome**: Header should show "Big Green Farm Room Summary"

### Phase 2: Mode Detection (Lines 2095-2103)
```javascript
// Test if sensor data available
const testResponse = await fetch('/env?hours=1');

if (testResponse.status === 403 || 404) {
  isCloudMode = true;  // Read-only, no sensors
} else {
  isCloudMode = false; // Edge mode, has sensors
}
```

**Expected Outcome**: `isCloudMode = false` (ESP32 sensor is active)

### Phase 3: Zone Summaries (Lines 2924-3050)
```javascript
async function loadZoneSummaries(envData) {
  // 1. GET /data/room-map.json     ✅ Exists
  // 2. GET /data/groups.json        ✅ Exists (8 groups)
  // 3. GET /plans                   ❓ Needs check
  // 4. GET /data/iot-devices.json   ✅ Exists (ESP32 sensor)
  
  // Build zone summary cards with:
  // - Temperature, humidity, VPD
  // - Active groups in zone
  // - Harvest countdown
  // - Group status (day X of Y)
}
```

### Phase 4: Environmental Data (Lines 2782-2800)
```javascript
const response = await fetch('/env?hours=24');
// Returns: Historical sensor data for sparkline charts
```

### Phase 5: Weather (Lines 2556-2590)
```javascript
const farmResponse = await fetch('/data/farm.json');
const coords = farmResponse.coordinates;  // 47.6062, -122.3321

const response = await fetch(`/api/weather?lat=${coords.lat}&lng=${coords.lng}`);
// External weather API for Ontario, Canada
```

### Phase 6: ML/AI Components (Lines 2132-2160)
```javascript
// If Chart.js loaded:
loadAnomalySparkline();      // Anomaly detection chart
loadEnergyForecast();         // Energy prediction
loadTempForecast();           // Temperature prediction

// P3 Harvest Predictions
GET /api/harvest/predictions

// P4 Succession Planner
window.successionPlanner = new SuccessionPlanner('');
```

---

## Potential Failure Points

### 1. Missing `/plans` Endpoint
**farm-summary.html Line 2954**:
```javascript
const plansResponse = await fetch('/plans');
```

**Check**:
```bash
curl -sS http://localhost:8091/plans
# Need to verify this endpoint exists
```

### 2. Zone ID Mismatch
**groups.json uses**: `"zone": "ROOM-A-Z1"`  
**room-map.json uses**: `"zone": "room-knukf2:1"`

**Incompatible zone identifiers may cause**:
- Groups not appearing in zone summaries
- "No active groups" message when groups exist
- Zone cards showing 0/8 groups

### 3. `/env?hours=1` Endpoint
**Check if this route exists in server-foxtrot.js**:
```javascript
app.get('/env', ...)  // Query param: hours=1 or hours=24
```

### 4. Chart.js Loading
**Lines 2140-2160**: Page waits up to 5 seconds for Chart.js
```javascript
let chartJsAttempts = 0;
const maxAttempts = 50; // 50 * 100ms = 5 seconds

if (typeof Chart === 'undefined') {
  // Timeout: ML widgets won't load
}
```

**If Chart.js fails**: Anomaly detection, energy forecast, temp forecast all fail

### 5. Browser Console Errors
**User reported**: "JS errors" (specific errors unknown)

**Most likely errors**:
1. `Uncaught TypeError: Cannot read property 'X' of null` → Data parsing failure
2. `Failed to fetch` → API endpoint missing (404)
3. `Uncaught ReferenceError: Chart is not defined` → Chart.js not loaded
4. `SyntaxError: Unexpected token` → Malformed JSON response

---

## Investigation Steps Required

### Immediate Actions

**1. Check server-foxtrot.js for missing routes**:
```bash
grep -n "app.get('/env" server-foxtrot.js
grep -n "app.get('/plans" server-foxtrot.js
grep -n "app.get('/api/weather" server-foxtrot.js
```

**2. Test endpoints directly**:
```bash
curl -sS http://localhost:8091/env?hours=1
curl -sS http://localhost:8091/plans | jq '.plans | length'
curl -sS http://localhost:8091/api/weather?lat=47.6062&lng=-122.3321
```

**3. Check browser console** (user must provide):
- Open http://localhost:8091/views/farm-summary.html
- Press F12 → Console tab
- Copy all red error messages
- Provide exact error text

**4. Check network tab**:
- F12 → Network tab
- Reload page
- Look for failed requests (red, 404 status)
- List all endpoints with 4xx/5xx errors

**5. Zone ID normalization**:
```bash
# Check if zone IDs are consistent
jq '.zones[].zone' public/data/room-map.json
jq 'if type == "array" then .[].zone else .groups[].zone end' public/data/groups.json
```

---

## Expected vs Actual Behavior

### Expected (if all working):
1. Header shows: "Big Green Farm Room Summary"
2. Timestamp shows: "Last updated: Feb 3, 2026 5:52 PM"
3. Weather card shows: Current conditions for Ontario
4. Zone 1 card shows:
   - Temperature: 18.67°C
   - Humidity: 65%
   - VPD: 0.65 kPa
   - Active groups: 8 groups listed
   - Harvest countdown: Days remaining for each group
5. ML widgets show:
   - Anomaly detection sparkline
   - Energy forecast chart
   - Temperature prediction chart
6. Bottom section shows:
   - Automation rules status
   - Schedule executor status
   - Group activity timeline

### Actual (reported):
- JavaScript errors (specific errors not provided)
- Page not loading correctly
- Farm information not displaying

---

## Resolution Path

### Priority 1: Get Browser Console Errors
**Cannot proceed without knowing which JavaScript errors are occurring.**

User must:
1. Open http://localhost:8091/views/farm-summary.html in browser
2. Open Developer Tools (F12)
3. Check Console tab
4. Copy ALL error messages (red text)
5. Provide error messages for analysis

### Priority 2: Verify Server Endpoints
**Check if all required API routes exist and respond correctly.**

Routes to verify:
- `GET /env?hours=X` → Environmental data
- `GET /plans` → Merged lighting-recipes + plans
- `GET /api/weather?lat=X&lng=Y` → External weather
- `GET /api/harvest/predictions` → P3 AI forecasts
- `GET /api/automation/rules` → Automation status
- `GET /api/schedule-executor/status` → Schedule status

### Priority 3: Zone ID Alignment
**Fix zone identifier mismatch between groups.json and room-map.json.**

Either:
- Update groups.json: `"zone": "ROOM-A-Z1"` → `"zone": "room-knukf2:1"`
- Update room-map.json: `"zone": "room-knukf2:1"` → `"zone": "ROOM-A-Z1"`
- Add zone normalization function in farm-summary.html

### Priority 4: Authentication Clarity
**Determine where user logged in and why token doesn't exist.**

Questions:
- What URL did user use to sign in?
- Is there a separate login page?
- Should farm-summary.html work WITHOUT authentication?
- Is authentication required or optional?

---

## Data Schema Observations

### groups.json Structure
```json
{
  "id": "ROOM-A-Z1-G01",
  "name": "ROOM-A-Z1-G01",
  "zone": "ROOM-A-Z1",           ← Zone format 1
  "recipe": "Mei Qing Pak Choi",
  "crop": "Mei Qing Pak Choi"
}
```

### room-map.json Structure
```json
{
  "zone": "room-knukf2:1",        ← Zone format 2 (incompatible)
  "name": "Zone 1",
  "room": "room-knukf2",
  "roomName": "Big Green Farm - Room 1"
}
```

**Issue**: Zone identifiers don't match. JavaScript code that tries to match groups to zones will fail:
```javascript
const zoneSensorDevices = iotDevices.filter(device => {
  if (device.zone !== zone.zone) return false;  // ← Comparison fails
});
```

**Impact**: Groups won't display in zone summary cards despite existing.

---

## Next Steps

1. **User provides browser console errors** (blocking - cannot proceed without this)
2. Test all API endpoints listed in "Priority 2" section
3. Fix zone ID mismatch (once confirmed as cause)
4. Add error handling for missing/failed API endpoints
5. Add authentication status indicator on page
6. Consider adding `/api/version` endpoint for deployment verification

---

## Files Involved

**Data Files** (all present, verified):
- `/public/data/farm.json` (372 bytes)
- `/public/data/rooms.json` (257 bytes)
- `/public/data/room-map.json` (842 bytes)
- `/public/data/room-map-room-knukf2.json` (628 bytes)
- `/public/data/groups.json` (6,045 bytes) - 8 groups
- `/public/data/env.json` (12 KB) - Live, updating
- `/public/data/iot-devices.json` - ESP32 sensor

**Code Files**:
- `/public/views/farm-summary.html` (7,084 lines)
- `/server-foxtrot.js` (API endpoints, needs route verification)
- `/scripts/esp32-to-env.py` (sensor bridge, running)

**Missing or Needs Verification**:
- `/plans` endpoint (referenced but not confirmed)
- `/api/farm/profile` endpoint (requires auth, not tested)
- `/env?hours=X` endpoint (referenced but not confirmed)

---

## Conclusion

**Data exists and is accessible. Page should load successfully.**

**Blocking issue**: JavaScript errors occurring in browser (specific errors not provided).

**Most likely causes**:
1. Missing server route (404 on critical endpoint)
2. Zone ID mismatch preventing group display
3. Chart.js not loading (timeout after 5 seconds)
4. Malformed API response causing parsing error

**Required to proceed**: Browser console error messages from user.

**Test command for user**:
```bash
# Open in browser and check console:
open http://localhost:8091/views/farm-summary.html

# Or test endpoints directly:
curl -sS http://localhost:8091/env?hours=1
curl -sS http://localhost:8091/plans | head -50
```
