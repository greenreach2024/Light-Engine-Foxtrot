# Group v2 Workflow Comprehensive Review
**Farm:** FARM-MKLOMAT3-A9D8 (Big Green Farm)  
**Environment:** greenreach-central-prod-v4  
**Date:** February 3, 2026  
**Status:** SUPERSEDED in parts by group-level management updates (see `docs/features/GROUP_LEVEL_MANAGEMENT_UPDATES.md`, April 24, 2026). Per-tray data flow in this doc is retained for traceability; primary ops are now group-first.

> Update notice (2026-04-24): Farms reported tray-by-tray scanning was too tasking at scale. Recipe, environment, nutrient, schedule, and inventory management have moved to the group level. Group setup now starts from a template with tailorable user inputs. See `GROUP_LEVEL_MANAGEMENT_UPDATES.md` for the authoritative flow.

---

## 🎯 Review Objective

Perform page-by-page, card-by-card, tab-by-tab validation of Group v2 workflow to ensure all data flows correctly from upstream pages (Room Setup, Light Setup, IoT, Equipment, Room Mapper, Recipes) into Group v2 assignments.

---

## 📋 Workflow Dependencies (Upstream → Group v2)

### Data Flow Diagram
```
┌─────────────────────────────────────────────────────────────┐
│                    UPSTREAM DATA SOURCES                     │
└─────────────────────────────────────────────────────────────┘
                              ↓
    ┌──────────────┬──────────────┬──────────────┬──────────────┐
    │   Room       │    Light     │     IoT      │  Equipment   │
    │   Mapper     │    Setup     │    Devices   │    Setup     │
    └──────┬───────┴──────┬───────┴──────┬───────┴──────┬───────┘
           │              │               │              │
           └──────────────┴───────────────┴──────────────┘
                              ↓
                    ┌─────────────────┐
                    │    Recipes      │
                    │   (Plans)       │
                    └────────┬────────┘
                             ↓
                ┌────────────────────────┐
                │      GROUP V2          │
                │  (Critical Assembly)   │
                └────────────────────────┘
                             ↓
                    Farm Operations
```

---

## 🔍 Review Checklist

### Phase 1: Upstream Data Source Validation

#### A. Room Mapper (/views/room-mapper.html)
- [ ] **Load Page**: Verify room-map.json loads correctly
- [ ] **Room Structure**: Check rooms array with zones
- [ ] **Zone Configuration**: Validate zone IDs, names, coordinates
- [ ] **Persistence**: Verify changes save to room-map.json
- [ ] **API Integration**: Check if changes sync to /api/rooms
- [ ] **Test Farm**: FARM-MKLOMAT3-A9D8 room structure loads

**Expected Data Format:**
```json
{
  "schemaVersion": "1.0.0",
  "rooms": [
    {
      "id": "ROOM-A",
      "name": "Grow Room A",
      "zones": [
        {
          "zone": "1",
          "name": "Zone 1",
          "lights": []
        }
      ]
    }
  ]
}
```

#### B. Light Setup (/LE-dashboard.html#lights or setup wizard)
- [ ] **Load Page**: Verify lights configuration interface
- [ ] **Light Device List**: Check iot-devices.json for light devices
- [ ] **DMX Configuration**: Validate DMX channels and mappings
- [ ] **Zone Assignment**: Verify lights can be assigned to zones
- [ ] **Persistence**: Check lights save to iot-devices.json
- [ ] **Test Farm**: FARM-MKLOMAT3-A9D8 light devices load

**Expected Device Format:**
```json
{
  "id": "LIGHT-ROOM-A-Z1-01",
  "name": "Zone 1 Light Bar",
  "type": "led_light",
  "category": "light",
  "zone": "ROOM-A:1",
  "dmx": {
    "universe": 0,
    "channels": {
      "cw": 1,
      "ww": 2,
      "bl": 3,
      "rd": 4
    }
  }
}
```

#### C. IoT Devices (/LE-dashboard.html#iot or /views/iot-dashboard.html)
- [ ] **Load Page**: Verify iot-devices.json loads
- [ ] **Device Types**: Check sensors, lights, controllers
- [ ] **Zone Assignment**: Validate device-to-zone mappings
- [ ] **Telemetry**: Verify device status and readings
- [ ] **Persistence**: Check device config saves
- [ ] **Test Farm**: FARM-MKLOMAT3-A9D8 IoT devices load

**Expected Sensor Format:**
```json
{
  "id": "SENSOR-ROOM-A-Z1",
  "name": "Zone 1 Sensor",
  "type": "environmental",
  "category": "sensor",
  "zone": "ROOM-A:1",
  "telemetry": {
    "temperature": 22.5,
    "humidity": 65,
    "timestamp": "2026-02-03T19:00:00Z"
  }
}
```

#### D. Equipment Setup
- [ ] **Load Page**: Verify equipment configuration
- [ ] **Equipment Types**: Check HVAC, irrigation, etc.
- [ ] **Zone Assignment**: Validate equipment-to-zone links
- [ ] **Control Integration**: Verify equipment can be controlled
- [ ] **Persistence**: Check config saves
- [ ] **Test Farm**: FARM-MKLOMAT3-A9D8 equipment loads

#### E. Recipes/Plans (/views/recipes.html or /LE-dashboard.html#recipes)
- [ ] **Load Page**: Verify plans.json or /api/plans loads
- [ ] **Recipe List**: Check available crop recipes
- [ ] **Plan Structure**: Validate days array with stages
- [ ] **Light Schedules**: Check photoperiod and DLI
- [ ] **Environmental Settings**: Verify temp/humidity targets
- [ ] **Persistence**: Check recipe saves
- [ ] **Test Farm**: FARM-MKLOMAT3-A9D8 recipes accessible

**Expected Recipe Format:**
```json
{
  "id": "mei-qing-pak-choi",
  "name": "Mei Qing Pak Choi",
  "crop": "Mei Qing Pak Choi",
  "days": [
    {
      "day": 1,
      "stage": "Seed",
      "ppfd": 150,
      "tempC": 20,
      "rh": 65
    }
  ]
}
```

---

### Phase 2: Group v2 Page Validation

#### Panel: Groups V2 (#groupsV2Panel in /LE-dashboard.html)

##### Card 1: Group List/Overview
- [ ] **Load Groups**: Verify groups.json loads with schemaVersion
- [ ] **Group Display**: Check all groups render correctly
- [ ] **Group Fields**: Validate id, name, zone, crop, plan
- [ ] **Status Indicators**: Check active/inactive status
- [ ] **Test Farm**: FARM-MKLOMAT3-A9D8 groups load

**Expected Format:**
```json
{
  "schemaVersion": "1.0.0",
  "groups": [
    {
      "id": "ROOM-A-Z1-G01",
      "name": "Zone 1 Lettuce",
      "zone": "ROOM-A:1",
      "crop": "Mei Qing Pak Choi",
      "plan": "mei-qing-pak-choi",
      "planId": "mei-qing-pak-choi",
      "active": true
    }
  ]
}
```

##### Card 2: Create/Edit Group Form
- [ ] **Zone Dropdown**: Populated from room-map.json
- [ ] **Light Assignment**: Shows lights from selected zone (iot-devices.json)
- [ ] **Recipe Dropdown**: Populated from plans.json
- [ ] **Plan Preview**: Shows plan details when selected
- [ ] **Seed Date**: Date picker for anchor.seedDate
- [ ] **DPS Mode**: Alternative to seed date (anchor.dps)
- [ ] **Validation**: Required fields enforced
- [ ] **Save Action**: Creates group in groups.json

**Data Flow Test:**
1. Select Zone → Should filter lights to zone
2. Select Recipe → Should show plan preview
3. Set Seed Date → Should calculate current day
4. Save → Should write to groups.json with schemaVersion

##### Card 3: Group Details View
- [ ] **Group Info**: Displays name, crop, zone, plan
- [ ] **Current Status**: Shows day, stage, harvest countdown
- [ ] **Assigned Lights**: Lists lights from zone
- [ ] **Light Recipe**: Shows today's PPFD, spectrum, photoperiod
- [ ] **Environmental Targets**: Displays temp, humidity, VPD
- [ ] **Nutrient Tank**: Shows tank selection (Tank 1/2)
- [ ] **Edit Button**: Opens edit form with pre-filled data
- [ ] **Delete Button**: Removes group from groups.json

##### Card 4: Harvest Tracking
- [ ] **Harvest Button**: Records harvest event
- [ ] **Variance Logging**: Compares actual vs planned harvest day
- [ ] **Lot Creation**: Creates traceability lot
- [ ] **Inventory Update**: Updates farm inventory
- [ ] **History**: Shows past harvests for group

##### Card 5: Repeat Planting
- [ ] **Quick Repeat**: Creates new group with same plan
- [ ] **PSD +7**: Offsets seed date by 7 days
- [ ] **Zone Copy**: Uses same zone as original
- [ ] **Auto-naming**: Generates new group name

---

### Phase 3: Integration Testing

#### Test Scenario 1: End-to-End Group Creation
**Steps:**
1. Open Room Mapper → Create zone "ROOM-A:3"
2. Open IoT Devices → Assign light "LIGHT-A3" to "ROOM-A:3"
3. Open Recipes → Verify "Mei Qing Pak Choi" exists
4. Open Group v2 → Click "New Group"
5. Select Zone "ROOM-A:3"
6. Select Recipe "Mei Qing Pak Choi"
7. Set Seed Date to today
8. Save group

**Expected Result:**
- Group created with ID "ROOM-A-Z3-G0X"
- Light "LIGHT-A3" assigned to group
- Current day = 1
- Today's recipe shows: PPFD, spectrum, temp
- Group visible in list

#### Test Scenario 2: Data Persistence Across Sessions
**Steps:**
1. Create group in Group v2
2. Close browser/logout
3. Login again
4. Navigate to Group v2

**Expected Result:**
- Group still exists in list
- All fields preserved
- Plan config intact
- Light assignments preserved

#### Test Scenario 3: Schema Version Validation
**Steps:**
1. Open browser console
2. Fetch /data/groups.json
3. Check schemaVersion field
4. Verify canonical format {groups: [...]}

**Expected Result:**
```json
{
  "schemaVersion": "1.0.0",
  "groups": [...]
}
```

#### Test Scenario 4: Farm-Specific Data (FARM-MKLOMAT3-A9D8)
**Steps:**
1. Login with Big Green Farm credentials
2. Verify farm.json shows: `"farmId": "FARM-MKLOMAT3-A9D8"`
3. Check rooms specific to this farm load
4. Verify lights/devices for this farm
5. Confirm groups for this farm only

**Expected Result:**
- Only FARM-MKLOMAT3-A9D8 data displays
- No cross-farm contamination
- All IDs include farm prefix

---

### Phase 4: Error Handling & Edge Cases

#### Error Case 1: Missing Upstream Data
**Test:** Delete rooms.json
**Expected:** Group v2 shows "No zones available" message

#### Error Case 2: Invalid Recipe Reference
**Test:** Set plan = "nonexistent-recipe"
**Expected:** Plan preview shows "Recipe not found"

#### Error Case 3: Duplicate Group IDs
**Test:** Try to create group with existing ID
**Expected:** Error message or auto-increment ID

#### Error Case 4: Schema Version Mismatch
**Test:** Remove schemaVersion from groups.json
**Expected:** Validator warning, graceful fallback

#### Error Case 5: Zone Not Found
**Test:** Group references zone not in room-map.json
**Expected:** Warning indicator, zone shown as "(Not Found)"

---

## 📊 Test Results Matrix

| Component | Load | Display | Edit | Save | Sync | Status |
|-----------|------|---------|------|------|------|--------|
| Room Mapper | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | Pending |
| Light Setup | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | Pending |
| IoT Devices | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | Pending |
| Equipment | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | Pending |
| Recipes | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | Pending |
| Group v2 List | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | Pending |
| Group v2 Form | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | Pending |
| Group v2 Details | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | Pending |
| Harvest Tracking | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | Pending |
| Repeat Planting | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | Pending |

**Legend:**
- ⏳ Pending
- 🔄 In Progress
- ✅ Pass
- ❌ Fail
- ⚠️ Warning

---

## 🐛 Issues Found

### Critical Issues
*None yet*

### Warnings
*None yet*

### Enhancement Opportunities
*To be identified during review*

---

## 📝 Next Steps

1. ✅ Deploy schema-fix-e882256-260203_135502 to v4
2. ⏳ Wait for deployment to complete
3. ⏳ Access v4 environment: greenreach-central.us-east-1.elasticbeanstalk.com
4. ⏳ Login with FARM-MKLOMAT3-A9D8 credentials
5. ⏳ Begin Phase 1: Upstream Data Source Validation
6. ⏳ Progress through Phase 2: Group v2 Page Validation
7. ⏳ Execute Phase 3: Integration Testing
8. ⏳ Test Phase 4: Error Handling
9. ⏳ Document all findings
10. ⏳ Create fix plan for any issues

---

**Review Status:** 🔄 Deployment in progress - Waiting for v4 to be Ready with schema fixes

**Last Updated:** February 3, 2026 19:45 EST
