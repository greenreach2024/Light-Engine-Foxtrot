# Farm Metadata Reporting Guide

## Overview

Farms can report their operational statistics (room count, zone count, device count, tray count, plant count) to GreenReach Central for dashboard analytics.

## Endpoint

**POST** `https://greenreachgreens.com/api/admin/farms/{farmId}/metadata`

No authentication required for farms to report their own metadata.

## Request Body

```json
{
  "room_count": 4,
  "zone_count": 12,
  "device_count": 48,
  "tray_count": 256,
  "plant_count": 15360,
  "metadata": {
    "version": "1.0",
    "last_harvest": "2026-01-15",
    "custom_field": "any_value"
  }
}
```

### Parameters

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `room_count` | integer | No | Number of grow rooms |
| `zone_count` | integer | No | Number of cultivation zones |
| `device_count` | integer | No | Number of connected devices (sensors, controllers) |
| `tray_count` | integer | No | Number of active growing trays |
| `plant_count` | integer | No | Total number of plants currently growing |
| `metadata` | object | No | Additional custom metadata (stored as JSONB) |

All numeric fields default to 0 if not provided.

## Response

### Success (200)
```json
{
  "success": true,
  "farm_id": "greenreach-hq"
}
```

### Farm Not Found (404)
```json
{
  "error": "Farm not found"
}
```

### Demo Mode (200)
```json
{
  "success": false,
  "error": "Database not available",
  "mode": "demo"
}
```

## Example Implementation

### JavaScript/Node.js
```javascript
async function reportFarmMetadata(farmId, stats) {
  const response = await fetch(`https://greenreachgreens.com/api/admin/farms/${farmId}/metadata`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      room_count: stats.rooms,
      zone_count: stats.zones,
      device_count: stats.devices,
      tray_count: stats.trays,
      plant_count: stats.plants
    })
  });
  
  const result = await response.json();
  console.log('Metadata reported:', result);
}

// Report every 5 minutes
setInterval(() => {
  const stats = getFarmStatistics(); // Your function to get current counts
  reportFarmMetadata('my-farm-id', stats);
}, 5 * 60 * 1000);
```

### Python
```python
import requests
import time

def report_farm_metadata(farm_id, stats):
    url = f"https://greenreachgreens.com/api/admin/farms/{farm_id}/metadata"
    response = requests.post(url, json={
        "room_count": stats["rooms"],
        "zone_count": stats["zones"],
        "device_count": stats["devices"],
        "tray_count": stats["trays"],
        "plant_count": stats["plants"]
    })
    return response.json()

# Report every 5 minutes
while True:
    stats = get_farm_statistics()  # Your function
    result = report_farm_metadata("my-farm-id", stats)
    print(f"Metadata reported: {result}")
    time.sleep(300)  # 5 minutes
```

### cURL
```bash
curl -X POST https://greenreachgreens.com/api/admin/farms/greenreach-hq/metadata \
  -H "Content-Type: application/json" \
  -d '{
    "room_count": 4,
    "zone_count": 12,
    "device_count": 48,
    "tray_count": 256,
    "plant_count": 15360
  }'
```

## Recommended Reporting Frequency

- **Every 5 minutes**: For active farms with dynamic operations
- **Every 15 minutes**: For stable operations
- **On change events**: When rooms/zones/devices are added or removed

## Admin Dashboard Integration

The GreenReach Central Admin Dashboard:
- Displays aggregated statistics from all farms
- Updates automatically when farms report new data
- Has a "Sync Farm Stats" button to trigger a manual refresh
- Shows data mode (live/demo/database) for transparency

## Database Schema

Metadata is stored in the `farm_metadata` table:

```sql
CREATE TABLE farm_metadata (
  farm_id VARCHAR(100) PRIMARY KEY REFERENCES farms(farm_id),
  room_count INTEGER DEFAULT 0,
  zone_count INTEGER DEFAULT 0,
  device_count INTEGER DEFAULT 0,
  tray_count INTEGER DEFAULT 0,
  plant_count INTEGER DEFAULT 0,
  metadata JSONB DEFAULT '{}',
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## Future Enhancements

Planned features:
- Historical trending (track changes over time)
- Alerts when counts drop significantly
- Energy consumption reporting
- Harvest/yield tracking
- Quality metrics integration
