# Mobile App - Lost Inventory & Crop Integration Implementation

**Date:** December 11, 2025  
**Status:** COMPLETE - Ready for Testing  
**Version:** 1.2.0

## Overview

This document describes the implementation of lost inventory tracking and crop integration features for the Light Engine mobile app, based on the requirements outlined in the project notes.

---

## Features Implemented

### 1. Backend: Loss Tracking System

#### Database Structure

**New Database Collections:**

1. **`trayRunsDB`** (./data/tray-runs.db)
   - Tracks tray lifecycle with status field
   - Status values: `ACTIVE`, `HARVESTED`, `LOST`
   - Added `lost_at` timestamp field

2. **`trayLossEventsDB`** (./data/tray-loss-events.db)
   - Fields:
     - `_id`: Auto-generated unique identifier
     - `tray_run_id`: Reference to tray run
     - `crop_name`: Name of crop (optional)
     - `crop_id`: Crop identifier (optional)
     - `loss_reason`: Reason for loss (enum)
     - `lost_quantity`: Number of plants/units lost (optional)
     - `notes`: Additional details (optional)
     - `created_at`: Timestamp of loss event
     - `createdAt`, `updatedAt`: NeDB auto-timestamps

3. **`trayPlacementsDB`** (./data/tray-placements.db)
   - Tracks physical location of trays
   - `removed_at` and `removal_reason` fields for loss tracking

4. **`traysDB`** (./data/trays.db)
   - Master tray registry

#### REST API Endpoints

**GET /api/crops**
- Returns list of available crops from lighting-recipes.json
- Response format:
  ```json
  [
    {
      "id": "crop-1",
      "name": "Buttercrunch Lettuce",
      "variety": "Buttercrunch",
      "active": true,
      "default_recipe_id": "recipe-1"
    }
  ]
  ```
- Falls back to hardcoded crop list if recipes file not found
- Used by mobile app to populate crop dropdowns

**POST /api/tray-runs/:id/loss**
- Records a tray loss event
- Request body:
  ```json
  {
    "crop_name": "Buttercrunch Lettuce",
    "crop_id": "crop-1",
    "loss_reason": "disease",
    "lost_quantity": 24,
    "notes": "Powdery mildew outbreak"
  }
  ```
- Loss reason enum values:
  - `disease`
  - `pest`
  - `mechanical`
  - `nutrient`
  - `environmental`
  - `accident`
  - `contamination`
  - `other`
- Validation:
  - Verifies tray run exists
  - Rejects if already marked LOST or HARVESTED
  - Requires either crop_name or crop_id
  - Requires loss_reason
- Actions performed:
  1. Creates loss event record
  2. Updates tray run status to `LOST`
  3. Sets `lost_at` timestamp
  4. Closes active placements (sets `removed_at`)
- Demo mode: Accepts request and returns success without DB operations

**GET /api/tray-runs/:id/loss-events**
- Returns all loss events for a specific tray run
- Used for audit trail and reporting

**GET /api/losses/current**
- Returns aggregated loss statistics
- Query params: `farmId` or `tenant_id` (optional)
- Response includes:
  - `totalLosses`: Total count
  - `lossesByReason`: Breakdown by loss reason
  - `lossesByCrop`: Breakdown by crop
  - `recentLosses`: Last 10 loss events

#### Inventory Rollup Updates

- Trays with `status = 'LOST'` are excluded from current inventory
- Lost trays do not appear in active tray counts
- Placement records for lost trays are closed

---

### 2. Mobile App: Loss Reporting Flow

#### New Components

**`ReportLossScreen.js`**
- Full-screen form for recording tray losses
- Features:
  - Crop dropdown (populated from `/api/crops`)
  - Loss reason dropdown (8 predefined reasons)
  - Optional quantity input (numeric)
  - Optional notes field (multiline)
  - Validation before submission
  - Loading states and error handling
  - Confirmation on success
- Auto-navigates to Dashboard after successful submission
- Pre-selects crop if available in tray data
- Responsive design with React Native Paper components

**`CropsContext.js`**
- Global state management for crop data
- Features:
  - Auto-fetch on mount
  - 5-minute cache duration
  - Force refresh capability
  - Error handling with cached fallback
  - Loading and error states
- Wraps entire app navigation tree

#### API Service Updates

**`api.js`** - New methods:
- `getCrops()`: Fetch crop list
- `reportTrayLoss(trayRunId, lossData)`: Submit loss report
- `getTrayLossEvents(trayRunId)`: Get loss history
- `getCurrentLosses(farmId)`: Get loss statistics

#### Scanner Integration

**`ScannerScreen.js`** - Updated:
- Added "Report Loss" button to QR scan dialog
- Button styling: Red text with alert icon
- Routes to ReportLossScreen with tray data
- Handles loss action in `handleAction()` function

#### Navigation Updates

**`App.js`** - Modified:
- Added ReportLossScreen to stack navigator
- Wrapped NavigationContainer with CropsProvider
- Screen title: "Report Loss"
- Accessible from scanner and potentially other screens

---

### 3. UI/UX Improvements: Emoji Removal

All emoji characters removed from codebase for professional enterprise appearance:

**Files Updated:**
- `mobile-app/README.md`: Feature list emojis → plain text
- `mobile-app/CHANGELOG.md`: Notification type emojis → plain text
- `mobile-app/TESTING_FINAL_REPORT.md`: Checkmarks → "PASS" text
- `mobile-app/src/screens/HarvestTrayScreen.js`: Removed plant, timer, target emojis
- `mobile-app/src/screens/PlaceTrayScreen.js`: Removed plant, target, building emojis
- `mobile-app/src/screens/SeedTrayScreen.js`: Removed plant emoji

**Icon Strategy:**
- UI uses `react-native-vector-icons/MaterialCommunityIcons`
- Professional icon set replaces emoji usage
- Consistent visual language throughout app

---

## Testing Recommendations

### Backend Testing

**Unit Tests:**
```bash
# Test loss recording endpoint
curl -X POST http://localhost:8091/api/tray-runs/test-123/loss \
  -H "Content-Type: application/json" \
  -d '{
    "crop_name": "Buttercrunch Lettuce",
    "loss_reason": "disease",
    "lost_quantity": 24,
    "notes": "Test loss event"
  }'

# Test crops endpoint
curl http://localhost:8091/api/crops

# Test loss statistics
curl http://localhost:8091/api/losses/current
```

**Integration Tests:**
1. Verify tray cannot be marked lost twice
2. Verify harvested tray cannot be marked lost
3. Verify lost tray excluded from inventory rollup
4. Verify placement closure on loss
5. Test with missing required fields (should return 400)

### Mobile App Testing

**Simulator Testing:**
1. Launch app in iOS/Android simulator
2. Navigate to Scanner screen
3. Scan tray QR code (or enter manually)
4. Select "Report Loss" from dialog
5. Verify crop dropdown populates
6. Select crop and loss reason
7. Add optional quantity and notes
8. Submit form
9. Verify success confirmation
10. Navigate to Dashboard
11. Verify lost tray no longer in inventory

**Physical Device Testing:**
1. Install on iOS/Android device
2. Connect to farm backend (local network or VPN)
3. Scan real tray QR codes
4. Complete loss reporting flow
5. Verify backend receives loss data
6. Check inventory updates

**Edge Cases:**
- Offline mode handling
- Invalid tray IDs
- Network timeouts
- Crop list load failures
- Form validation errors

---

## Architecture Decisions

### Why NeDB for Inventory?

- Embedded document database (no separate DB server)
- JSON-based, easy to inspect and debug
- Auto-timestamping (createdAt, updatedAt)
- Simple query API
- File-based persistence
- Suitable for single-instance deployment
- Easy to migrate to MongoDB/PostgreSQL later if needed

### Why Context API for Crops?

- Global state without Redux overhead
- Cache management built-in
- Automatic refresh on mount
- Fallback to cached data on error
- Simple API: `const { crops, isLoading, error, refresh } = useCrops()`
- Prevents redundant API calls

### Why Menu Components for Dropdowns?

- Native feel with React Native Paper
- Consistent with app theme
- Better UX than Picker on iOS
- Search-friendly (can add filter later)
- Icon support for visual clarity
- Accessibility built-in

### Loss Reason Enum

Predefined reasons based on common indoor farming issues:
- **Disease**: Fungal, bacterial, viral infections
- **Pest**: Aphids, thrips, fungus gnats
- **Mechanical**: Physical damage during handling
- **Nutrient**: Deficiencies or toxicities
- **Environmental**: Temperature, humidity, light stress
- **Accident**: Spills, drops, system failures
- **Contamination**: Chemical or biological contamination
- **Other**: Catch-all for uncommon cases

---

## Future Enhancements

### Backend

1. **Loss Analytics Dashboard**
   - Trend analysis over time
   - Loss rate by crop type
   - Cost impact calculations
   - Recommendations for reducing losses

2. **Photo Upload**
   - Attach photos to loss events
   - Visual documentation for audit trail
   - ML analysis of loss patterns

3. **Automated Loss Detection**
   - Computer vision for disease detection
   - Weight sensors for theft/loss detection
   - Environmental trigger alerts

4. **Loss Approval Workflow**
   - Manager approval for high-value losses
   - Multi-level authorization
   - Audit trail with user attribution

### Mobile App

1. **Loss History View**
   - Per-tray loss timeline
   - Farm-wide loss statistics
   - Filterable by date, crop, reason

2. **Bulk Loss Reporting**
   - Report multiple trays at once
   - Batch operations for widespread issues
   - CSV import for large incidents

3. **Offline Support**
   - Queue loss reports when offline
   - Sync when connection restored
   - Conflict resolution

4. **Crop Photos**
   - Capture photo with loss report
   - Image gallery in loss history
   - Before/after comparisons

---

## API Documentation

### Crops Endpoint

**GET /api/crops**

Returns available crop definitions from lighting recipes.

**Response:**
```json
[
  {
    "id": "crop-1",
    "name": "Buttercrunch Lettuce",
    "variety": "Buttercrunch",
    "active": true,
    "default_recipe_id": "recipe-1"
  },
  {
    "id": "crop-2",
    "name": "Basil",
    "variety": "Genovese",
    "active": true,
    "default_recipe_id": "recipe-2"
  }
]
```

### Loss Tracking Endpoints

**POST /api/tray-runs/:id/loss**

Record a tray loss event.

**Request:**
```json
{
  "crop_name": "Buttercrunch Lettuce",
  "crop_id": "crop-1",
  "loss_reason": "disease",
  "lost_quantity": 24,
  "notes": "Powdery mildew outbreak in Zone A"
}
```

**Response (Success):**
```json
{
  "success": true,
  "message": "Loss recorded successfully",
  "trayRunId": "tray-run-123",
  "lossEventId": "loss-event-456",
  "status": "LOST"
}
```

**Response (Error):**
```json
{
  "error": "Tray already marked as lost"
}
```

**GET /api/tray-runs/:id/loss-events**

Get loss event history for a tray.

**Response:**
```json
{
  "trayRunId": "tray-run-123",
  "lossEvents": [
    {
      "_id": "loss-event-456",
      "tray_run_id": "tray-run-123",
      "crop_name": "Buttercrunch Lettuce",
      "crop_id": "crop-1",
      "loss_reason": "disease",
      "lost_quantity": 24,
      "notes": "Powdery mildew outbreak",
      "created_at": "2025-12-11T10:30:00Z"
    }
  ]
}
```

**GET /api/losses/current**

Get aggregated loss statistics.

**Query Params:**
- `farmId` (optional): Filter by farm

**Response:**
```json
{
  "totalLosses": 15,
  "lossesByReason": {
    "disease": 6,
    "pest": 3,
    "mechanical": 2,
    "nutrient": 2,
    "environmental": 1,
    "other": 1
  },
  "lossesByCrop": {
    "Buttercrunch Lettuce": 8,
    "Basil": 4,
    "Arugula": 3
  },
  "recentLosses": [
    {
      "_id": "loss-event-456",
      "tray_run_id": "tray-run-123",
      "crop_name": "Buttercrunch Lettuce",
      "loss_reason": "disease",
      "created_at": "2025-12-11T10:30:00Z"
    }
  ]
}
```

---

## Files Modified

### Backend (server-charlie.js)

**Line ~16181:** Added database collections
```javascript
const trayRunsDB = Datastore.create({ filename: './data/tray-runs.db', autoload: true, timestampData: true });
const trayLossEventsDB = Datastore.create({ filename: './data/tray-loss-events.db', autoload: true, timestampData: true });
const traysDB = Datastore.create({ filename: './data/trays.db', autoload: true, timestampData: true });
const trayPlacementsDB = Datastore.create({ filename: './data/tray-placements.db', autoload: true, timestampData: true });
```

**Line ~12177:** Added crops endpoint
**Line ~12215:** Added loss tracking endpoints
**Line ~12442:** Updated proxy filter exclusions

### Mobile App

**New Files:**
- `src/context/CropsContext.js` - Global crop state management
- `src/screens/ReportLossScreen.js` - Loss reporting UI

**Modified Files:**
- `src/services/api.js` - Added loss and crop API methods
- `src/screens/ScannerScreen.js` - Added "Report Loss" button
- `App.js` - Added CropsProvider and ReportLoss route
- `README.md` - Removed emojis from feature list
- `CHANGELOG.md` - Removed emojis from notification types
- `TESTING_FINAL_REPORT.md` - Replaced checkmarks with "PASS"
- `src/screens/HarvestTrayScreen.js` - Removed emojis
- `src/screens/PlaceTrayScreen.js` - Removed emojis
- `src/screens/SeedTrayScreen.js` - Removed emojis

---

## Deployment Notes

### Environment Variables

No new environment variables required. Existing variables apply:
- `DEMO_MODE`: Enables demo mode with mock data
- `PORT`: Server port (default 8091)

### Database Files

Ensure `./data/` directory exists and is writable:
```bash
mkdir -p ./data
chmod 755 ./data
```

Database files created automatically:
- `./data/tray-runs.db`
- `./data/tray-loss-events.db`
- `./data/trays.db`
- `./data/tray-placements.db`

### Mobile App Dependencies

No new dependencies added. Existing React Native Paper and navigation libraries handle all UI needs.

### Backend Startup

```bash
cd /path/to/Light-Engine-Delta
npm install
PORT=8091 node server-charlie.js
```

### Mobile App Startup

```bash
cd mobile-app
npm install
npm start
```

---

## Troubleshooting

### "Failed to load crops" Error

**Cause:** Crops endpoint unreachable or lighting-recipes.json missing

**Solution:**
1. Check server is running on correct port
2. Verify `/api/crops` endpoint responds:
   ```bash
   curl http://localhost:8091/api/crops
   ```
3. Check `public/data/lighting-recipes.json` exists
4. Review server logs for errors

### Loss Report Submission Fails

**Cause:** Invalid tray run ID or tray already lost/harvested

**Solution:**
1. Verify tray run exists in database
2. Check tray status is `ACTIVE`
3. Review validation errors in response
4. Check server logs for detailed error messages

### Crops Dropdown Empty

**Cause:** CropsContext not fetching data or API error

**Solution:**
1. Check CropsProvider wraps NavigationContainer
2. Verify network connectivity
3. Check browser/app console for errors
4. Try force refresh in app

---

## Success Criteria

- [x] Backend loss tracking endpoints functional
- [x] Crops API returns valid data
- [x] Mobile app can report losses via UI
- [x] Lost trays excluded from inventory
- [x] Placement records closed on loss
- [x] Emojis removed from mobile app codebase
- [x] Demo mode handles all new endpoints
- [ ] Unit tests written and passing
- [ ] End-to-end testing on physical devices
- [ ] Documentation complete

---

## Contact & Support

For questions or issues:
- Review backend logs: `server-charlie.js` console output
- Review mobile logs: React Native debugger console
- Check API responses: Use curl or Postman
- Verify database contents: Inspect `.db` files with NeDB viewer

**Implementation Date:** December 11, 2025  
**Last Updated:** December 11, 2025  
**Version:** 1.2.0
