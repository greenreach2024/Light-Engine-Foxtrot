# Mock Data Fix Plan - GreenReach Central UI

**Issue**: GreenReach Central Admin dashboard displays fake/mock data instead of real data from Light Engine edge devices.

**Date**: January 31, 2026  
**Status**: 🔴 CRITICAL UI BUG

---

## Problems Identified

### 1. Plants Growing: 576 (INCORRECT - Mock Data)
**Location**: GR-central-admin.html line 1108, central-admin.js line 1480  
**Data Source**: `/api/admin/analytics/aggregate` endpoint  
**Current Behavior**: Returns `totalPlants: 576` (appears to be mock data)  
**Expected Behavior**: Calculate actual plant count from:
- Edge device `/api/groups` endpoint → count all trays × plants_per_tray
- Or `/api/farm/stats` endpoint → real-time tray count

### 2. Connected Sensors: 5 (INCORRECT - "Live data" label but shows wrong count)
**Location**: GR-central-admin.html line 3364  
**Data Source**: Platform monitoring endpoint  
**Current Behavior**: Shows "5" with "Live data" label  
**Expected Behavior**: Query edge device `/api/devices` endpoint, count sensors by type

### 3. Farm Profile Information (INCOMPLETE - Shows "--" for most fields)
**Location**: GR-central-admin.html lines 1221-1257, central-admin.js lines 3660-3700  
**Fields Affected**:
- Farm Owner: `--`
- Key Contact: `--`
- Phone: `--`
- Website: `--`
- Address: `--`
- Deployment Type: "Unknown"
- Internal Notes: Not populated

**Data Sources**:
- Edge device `/api/farm/config` endpoint → `contact` object
- Database farms table → `metadata` JSON column
- Local `farm.json` file → contact information

**Current Logic** (central-admin.js line 3670):
```javascript
ownerEl.textContent = contact.owner || mergedMetadata.owner || farm.owner || '--';
```

**Problem**: Falling through to `--` because:
1. Edge device `/api/farm/config` doesn't return `contact.owner`
2. Database `metadata` column is NULL or empty
3. Farm registration didn't capture this data

---

## Root Cause Analysis

### API Endpoint `/api/admin/analytics/aggregate` Returns Mock Data

**File**: `greenreach-central/routes/admin.js` (needs investigation)

**Expected Response Structure**:
```json
{
  "totalFarms": 1,
  "totalRooms": 4,
  "totalZones": 12,
  "totalDevices": 48,
  "totalTrays": 144,
  "totalPlants": 576,    // ← MOCK DATA (assumes 4 plants/tray)
  "mode": "live"
}
```

**Issues**:
1. `totalPlants` calculation is incorrect - not pulling from edge device reality
2. Endpoint doesn't aggregate from edge device APIs
3. Uses hardcoded multiplier (4 plants/tray) instead of reading from groups data

---

## Solution Plan

### Fix 1: Real-Time Plant Count from Edge Devices

**Update**: `greenreach-central/routes/admin.js` → `/api/admin/analytics/aggregate`

```javascript
async function calculateRealPlants(farmId, apiUrl) {
  try {
    // Method 1: Query groups endpoint
    const groupsResp = await fetch(`${apiUrl}/api/groups`);
    const groupsData = await groupsResp.json();
    
    let totalPlants = 0;
    groupsData.groups.forEach(group => {
      const trays = group.trays?.length || 0;
      const plantsPerTray = group.plants_per_tray || 4; // fallback
      totalPlants += trays * plantsPerTray;
    });
    
    return totalPlants;
  } catch (error) {
    console.error(`Failed to fetch plants for ${farmId}:`, error);
    return 0;
  }
}

// In aggregate endpoint:
router.get('/api/admin/analytics/aggregate', async (req, res) => {
  const farms = await query('SELECT farm_id, api_url FROM farms WHERE status = $1', ['active']);
  
  let totalPlants = 0;
  for (const farm of farms) {
    totalPlants += await calculateRealPlants(farm.farm_id, farm.api_url);
  }
  
  res.json({
    ...otherStats,
    totalPlants: totalPlants  // REAL DATA
  });
});
```

### Fix 2: Real-Time Sensor Count

**Update**: `greenreach-central/routes/admin.js` → Platform monitoring endpoint

```javascript
async function calculateRealSensors(farmId, apiUrl) {
  try {
    const devicesResp = await fetch(`${apiUrl}/api/devices`);
    const devicesData = await devicesResp.json();
    
    // Count only sensor types (exclude controllers, relays)
    const sensorTypes = ['dht22', 'sht31', 'bme280', 'sensor'];
    const sensors = devicesData.devices.filter(d => 
      sensorTypes.some(type => d.type.toLowerCase().includes(type))
    );
    
    return sensors.length;
  } catch (error) {
    console.error(`Failed to fetch sensors for ${farmId}:`, error);
    return 0;
  }
}
```

### Fix 3: Farm Profile Data from Edge Device

**Update**: `central-admin.js` line 3670 (farm detail view)

**Current Logic Issues**:
- `contact.owner` doesn't exist in edge device `/api/farm/config`
- Need to read from `farm.json` via `/api/farm/info` endpoint

**Correct Edge API Call**:
```javascript
// In loadFarmDetail() function:
async function loadFarmDetail(farmId) {
  // Existing farm query from database
  const farmResp = await authenticatedFetch(`${API_BASE}/api/admin/farms/${farmId}`);
  const farm = await farmResp.json();
  
  // NEW: Fetch farm.json from edge device
  const edgeFarmResp = await fetch(`${farm.api_url}/api/farm/info`);
  const edgeFarmData = await edgeFarmResp.json();
  
  // Extract contact from farm.json
  const contact = edgeFarmData.contact || {};
  
  // Update UI with REAL DATA
  document.getElementById('detail-owner').textContent = contact.owner || edgeFarmData.owner || '--';
  document.getElementById('detail-contact').textContent = contact.name || contact.contactName || '--';
  document.getElementById('detail-phone').textContent = contact.phone || '--';
  document.getElementById('detail-email').textContent = contact.email || '--';
  document.getElementById('detail-website').textContent = contact.website || '--';
  
  // Address formatting
  const address = contact.address || [
    contact.street,
    contact.city,
    contact.state,
    contact.zip
  ].filter(Boolean).join(', ');
  document.getElementById('detail-address').textContent = address || '--';
  
  // Deployment type (from actual connection test)
  const isLocal = farm.api_url.includes('localhost') || farm.api_url.includes('192.168') || farm.api_url.includes('10.');
  document.getElementById('detail-deployment-type').textContent = isLocal ? 'Edge (Local Network)' : 'Cloud';
}
```

---

## Implementation Steps

### Phase 1: Backend Fixes (Routes)

1. **Update `/api/admin/analytics/aggregate`**:
   - Add `calculateRealPlants()` helper function
   - Loop through all active farms
   - Query each edge device `/api/groups` endpoint
   - Sum real plant counts
   - Cache for 5 minutes to reduce API load

2. **Add `/api/admin/farms/:farmId/sensors`**:
   - Query edge device `/api/devices`
   - Filter by sensor types
   - Return count and list

3. **Update `/api/admin/farms/:farmId` response**:
   - Include `contact` object from edge device
   - Merge with database `metadata` column
   - Priority: Edge device > Database > Defaults

### Phase 2: Frontend Fixes (UI)

1. **Update `central-admin.js` loadKPIs()**:
   - Remove fallback mock data
   - Add loading states ("Loading..." instead of "0")
   - Add error states ("Unable to load" instead of showing 0)

2. **Update `central-admin.js` loadFarmDetail()**:
   - Call `/api/farm/info` on edge device
   - Parse `contact` object correctly
   - Update all Farm Summary fields with real data

3. **Add UI Loading Indicators**:
   - Show spinner while fetching KPIs
   - Show "Connecting to edge device..." for farm details
   - Handle offline farms gracefully (show cached data)

### Phase 3: Testing & Validation

1. **Test with Light Engine Foxtrot** (http://localhost:8091):
   - Verify `/api/groups` returns real tray counts
   - Verify `/api/farm/info` returns contact data
   - Verify `/api/devices` returns sensor list

2. **Test Aggregate Endpoint**:
   - Call `/api/admin/analytics/aggregate`
   - Verify `totalPlants` matches manual count
   - Verify response time < 3 seconds

3. **Test Farm Profile UI**:
   - Open farm detail view
   - Verify all fields populated with real data
   - Verify "Deployment Type" shows correct value

---

## Edge Device API Endpoints (Reference)

### Light Engine Foxtrot (Port 8091)

**GET `/api/farm/info`** - Farm configuration and contact
```json
{
  "farm_id": "light-engine-demo",
  "name": "Light Engine Foxtrot Demo",
  "owner": "Peter Gilbert",
  "contact": {
    "name": "Peter Gilbert",
    "email": "peter@greenreachgreens.com",
    "phone": "(555) 123-4567",
    "address": "123 Farm Road, City, State 12345"
  },
  "location": {
    "lat": 40.7128,
    "lng": -74.0060,
    "timezone": "America/New_York"
  }
}
```

**GET `/api/groups`** - All growing groups
```json
{
  "groups": [
    {
      "group_id": "group-1",
      "name": "Butterhead Lettuce",
      "recipe": "butterhead-lettuce",
      "trays": ["tray-1-1", "tray-1-2", "tray-1-3"],
      "plants_per_tray": 24,
      "days_since_seed": 12
    }
  ],
  "total_groups": 1,
  "total_trays": 3,
  "total_plants": 72
}
```

**GET `/api/devices`** - All connected devices
```json
{
  "devices": [
    {
      "device_id": "esp32-sensor-01",
      "type": "DHT22_SENSOR",
      "status": "online",
      "last_seen": "2026-01-31T10:30:00Z"
    },
    {
      "device_id": "esp32-sensor-02",
      "type": "SHT31_SENSOR",
      "status": "online",
      "last_seen": "2026-01-31T10:29:55Z"
    }
  ],
  "total_devices": 2,
  "sensors": 2,
  "controllers": 0
}
```

---

## Expected Outcome

After fixes:

### Dashboard KPIs
- **Plants Growing**: Real count from edge device (e.g., 72 instead of 576)
- **Connected Sensors**: Real count from edge device (e.g., 8 instead of 5)
- **Connected Farms**: Correct count (1 instead of multiple mock farms)

### Farm Profile
- **Farm Owner**: "Peter Gilbert" (from farm.json)
- **Key Contact**: "Peter Gilbert" (from contact.name)
- **Phone**: "(555) 123-4567" (from contact.phone)
- **Email**: "peter@greenreachgreens.com" (from contact.email)
- **Website**: "https://greenreachgreens.com" (from contact.website)
- **Address**: "123 Farm Road, City, State 12345" (from contact.address)
- **Deployment Type**: "Edge (Local Network)" (from API URL analysis)
- **Internal Notes**: Admin-entered notes (from database)

---

## Next Steps

1. **@ImplementationAgent**: Implement backend fixes first (Phase 1)
2. **@ReviewAgent**: Validate API responses match expected structure
3. **@ImplementationAgent**: Implement frontend fixes (Phase 2)
4. **@ImplementationAgent**: Run integration tests (Phase 3)
5. **@ReviewAgent**: Visual UI testing - verify no mock data remains

**Estimated Time**: 3-4 hours  
**Priority**: 🔴 HIGH (User-facing data accuracy issue)

---

**Document Version**: 1.0  
**Last Updated**: January 31, 2026  
**Status**: READY FOR IMPLEMENTATION
