# Farm Detail View Debugging

## Issue
Operations Overview shows farm FARM-MKLOMAT3-A9D8 correctly, but clicking into farm detail shows no data.

## Code Flow Analysis

### 1. Overview → Detail Click
```javascript
// From overview, user clicks farm
viewFarmDetail('FARM-MKLOMAT3-A9D8')
```

### 2. viewFarmDetail() Function (central-admin.js line 1479)
```javascript
// Fetches: GET /api/admin/farms/FARM-MKLOMAT3-A9D8
const response = await authenticatedFetch(`${API_BASE}/api/admin/farms/${farmId}`);
const payload = await response.json();
const farm = payload?.farm || payload;

// Checks: if (!farm || payload?.error || payload?.success === false)
// Then calls: await loadFarmDetails(farmId, farm);
```

### 3. API Response (admin.js line 164-247)
Returns:
```json
{
  "success": true,
  "farm": {
    "farmId": "FARM-MKLOMAT3-A9D8",
    "name": "Big Green Farm",
    "status": "active",
    "lastHeartbeat": "2026-01-27T...",
    "rooms": 2,
    "zones": 4,
    "environmental": {
      "zones": [...],
      "summary": {...}
    }
  }
}
```

### 4. loadFarmDetails() Function (central-admin.js line 1523)
```javascript
// Gets counts: rooms, zones, devices from farm object
const rooms = farm.rooms || farm.environmental?.zones?.length || 0;
const zones = farm.zones || farm.environmental?.zones?.length || 0;

// Then calls:
await loadFarmRooms(farmId, rooms);     // GET /api/admin/farms/:farmId/rooms
await loadFarmDevices(farmId, devices); // GET /api/admin/farms/:farmId/devices  
await loadFarmInventory(farmId, trays); // GET /api/admin/farms/:farmId/inventory
```

### 5. Sub-endpoints
- **GET /api/admin/farms/:farmId/rooms** (admin.js line 270)
  - Queries: `farm_data` WHERE `farm_id = $1` AND `data_type = 'rooms'`
  - Returns: `{ success: true, rooms: [...], count, farmId }`
  
- **GET /api/admin/farms/:farmId/zones** (admin.js line 301)
  - Queries: `farm_data` WHERE `farm_id = $1` AND `data_type = 'telemetry'`
  - Returns: `{ success: true, zones: telemetry.zones, count, farmId }`

## Potential Issues

### Issue #1: Empty Sub-endpoint Responses
If rooms/zones/devices API calls return empty arrays, the detail view will be blank.

**Check:** Are there rows in `farm_data` for FARM-MKLOMAT3-A9D8?

### Issue #2: Frontend Error Handling
If any of the loadFarm* functions fail, they catch errors silently:
```javascript
catch (error) {
    console.error('[Rooms] Failed to load farm rooms:', error);
    roomsData = [];
}
```

The page continues to render but with empty data.

### Issue #3: Element Visibility
The farm-detail-view div is set to `display: block`, but child sections might be hidden or not rendering.

## Next Steps

1. Test the farm detail API endpoint directly
2. Check farm_data table for FARM-MKLOMAT3-A9D8 entries
3. Add more console logging to trace where data is lost
4. Check browser console for JavaScript errors
