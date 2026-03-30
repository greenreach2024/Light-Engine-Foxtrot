# 🧪 Farm Wizard End-to-End Testing Implementation Proposal

**Date**: February 4, 2026  
**Agent**: Implementation Agent  
**Status**: Awaiting Review Agent Approval  
**Priority**: HIGH - Critical UX Testing

---

## 📋 Executive Summary

**Objective**: Remove email requirement from LE login, create new test farm credentials, and execute comprehensive step-by-step wizard testing with data validation at each stage.

**Test Farm**: "This is Your Farm" / Password: Grow123  
**Scope**: First-time setup wizard → Farm registration → Room setup → Complete farm build with validation

---

## 🎯 Implementation Plan

### Phase 1: Remove Email Requirement from Login (15 min)

**Current State**:
- Login form requires: `farmId`, `email`, `password`
- Server validates all 3 fields
- Email field has HTML5 `required` attribute

**Proposed Changes**:

1. **farm-admin.js** (Line 142-153)
   - Make email optional in validation
   - Allow login with just `farmId` + `password`
   - If email provided, still validate format

2. **server-foxtrot.js** (Line 14520-14600)
   - Update `/api/farm/auth/login` to make email optional
   - Edge mode: Match on farmId + password only
   - Generate default email if not provided: `admin@{farmId}.local`

3. **LE-farm-admin.html**
   - Remove `required` attribute from email input
   - Update placeholder: "Email (optional)"
   - Keep email validation for when provided

**Rationale**: Edge devices often don't have internet/email during initial setup. FarmId + Password is sufficient for local authentication.

---

### Phase 2: Create Test Farm Credentials (5 min)

**New Farm Details**:
```javascript
{
  farmId: "FARM-TEST-WIZARD-001",
  farmName: "This is Your Farm",
  password: "Grow123",
  email: "optional@test.local", // Can be omitted
  role: "admin",
  edgeMode: true
}
```

**Implementation**:
- Add farm to Edge mode authentication
- Store in `.env` or local credentials file
- Update `ADMIN_EMAIL` and `ADMIN_PASSWORD` env vars for testing

**Storage Location**: 
```bash
# Add to .env.local or server-foxtrot.js edge credentials
FARM_TEST_ID=FARM-TEST-WIZARD-001
FARM_TEST_PASSWORD=Grow123
```

---

### Phase 3: Step-by-Step Wizard Testing (60 min)

#### 3.1 Login Testing
**URL**: `http://localhost:8091/light-engine/public/LE-farm-admin.html`

**Test Cases**:
1. ✅ Login with farmId + password only (no email)
2. ✅ Login with all 3 fields
3. ✅ Invalid password rejection
4. ✅ Session token generation
5. ✅ Redirect to dashboard

**Validation Points**:
- Token stored in localStorage
- FarmId matches "FARM-TEST-WIZARD-001"
- Session expiry set correctly
- Console logs no errors

---

#### 3.2 First-Time Setup Wizard

**File**: `LE-farm-admin.html` (Setup Modal, Lines 4370-4700)

**Steps to Test**:

**STEP 1: Welcome / Activation Code** (Optional - skip for Edge)
- Input: Activation code or skip button
- Validation: 8-character code format
- **Edge Mode**: Auto-skip or allow manual skip

**STEP 2: Farm Business Details** ✅ CRITICAL
- **Inputs**:
  - Farm Name: "This is Your Farm"
  - Contact Name: "Test Grower"
  - Email: test@yourfarm.local (now optional)
  - Phone: +1 (555) 123-4567
  - Website: https://thisisfarm.test
  
- **Validation Points**:
  - Required fields: Farm Name, Contact Name only
  - Email optional but validated if provided
  - Phone/Website optional
  
- **Data Flow Check**:
  ```javascript
  // After step, verify setupData object:
  console.log('Step 2 Data:', setupData);
  // Should contain: { farmName, contactName, contactEmail?, phone?, website? }
  ```

**STEP 3: Farm Location** ✅ CRITICAL
- **Inputs**:
  - Street Address: "123 Test Farm Road"
  - City: "Kingston"
  - State/Province: "Ontario"
  - Postal Code: "K7L 3N6"
  - Country: "Canada"
  - Lat/Lng: 44.2312, -76.4860 (auto-populate option)
  
- **Validation Points**:
  - All address fields required
  - Lat/Lng validated as numbers
  - "Use Current Location" button works
  
- **Data Flow Check**:
  ```javascript
  console.log('Step 3 Data:', setupData.location);
  // Should contain: { address, city, state, postal, country, lat, lng }
  ```

**STEP 4: Room Configuration** ✅ CRITICAL
- **Actions**:
  1. Click "Add Room" button
  2. Room Name: "Grow Room A"
  3. Add Zone: "Zone 1" (shelves or grow area)
  4. Add Zone: "Zone 2"
  5. Save room
  6. Add second room: "Grow Room B" with 1 zone
  
- **Validation Points**:
  - At least 1 room required to proceed
  - Room IDs generated: `ROOM-{UUID}`
  - Zone IDs generated: `{ROOM_ID}-Z{N}`
  
- **Data Flow Check**:
  ```javascript
  console.log('Step 4 Data:', setupData.rooms);
  /* Expected structure:
  [
    {
      id: "ROOM-A",
      name: "Grow Room A",
      zones: [
        { id: "ROOM-A-Z1", name: "Zone 1" },
        { id: "ROOM-A-Z2", name: "Zone 2" }
      ]
    },
    {
      id: "ROOM-B",
      name: "Grow Room B",
      zones: [{ id: "ROOM-B-Z1", name: "Zone 1" }]
    }
  ]
  */
  ```

**STEP 5: Tray Formats** (Optional)
- **Actions**:
  1. Select standard format: "10x20 tray - 200 cells"
  2. Or create custom: "128-cell custom tray"
  
- **Validation Points**:
  - Formats are optional
  - If added, stored with ID, cell count, dimensions
  
- **Data Flow Check**:
  ```javascript
  console.log('Step 5 Data:', setupData.trayFormats);
  // Optional: [{ id, name, cells, width, length }]
  ```

**STEP 6: Certifications** (Optional)
- **Actions**:
  1. Select: "Organic (USDA)"
  2. Upload certificate (optional)
  
- **Validation Points**:
  - Certifications are optional
  - Multiple selections allowed
  
- **Data Flow Check**:
  ```javascript
  console.log('Step 6 Data:', setupData.certifications);
  // Optional: ["organic", "gmp", ...]
  ```

**STEP 7: Review & Complete**
- **Display**:
  - Summary of all entered data
  - Edit buttons for each section
  
- **Actions**:
  1. Review all data
  2. Click "Complete Setup"
  
- **Validation Points**:
  - All required data present
  - POST to `/api/farm/setup/complete`
  - Redirect to dashboard on success

---

#### 3.3 Farm Data Validation After Wizard

**Critical Checks**:

1. **Database/File Storage**:
   ```bash
   # Check farm.json was created/updated
   cat public/data/farm.json | jq .
   
   # Check rooms.json
   cat public/data/rooms.json | jq '.rooms'
   
   # Check groups.json initialized
   cat public/data/groups.json | jq '.groups'
   ```

2. **API Endpoints**:
   ```bash
   # Verify farm profile
   curl http://localhost:8091/api/farm/profile -H "Authorization: Bearer TOKEN"
   
   # Verify rooms endpoint
   curl http://localhost:8091/api/rooms
   
   # Verify groups endpoint (should be empty initially)
   curl http://localhost:8091/api/groups
   ```

3. **Dashboard Display**:
   - Farm name shows "This is Your Farm"
   - Rooms show: "Grow Room A (2 zones)", "Grow Room B (1 zone)"
   - Groups section empty (no groups created yet)
   - KPI cards show 0 trays, 0 plants (starting state)

---

### Phase 4: Post-Wizard Farm Building (30 min)

#### 4.1 Create First Group

**Page**: Groups v2 (`LE-groups-v2.html`)

**Actions**:
1. Click "Create Group" button
2. Fill form:
   - Name: "Test Group 1"
   - Room: "Grow Room A"
   - Zone: "Zone 1"
   - Crop: "Lettuce - Romaine"
   - Tray Count: 4
   - Plants per Tray: 96
3. Submit

**Validation**:
```bash
# Check group created
curl http://localhost:8091/api/groups | jq '.[] | select(.name=="Test Group 1")'

# Verify group file
cat public/data/groups.json | jq '.groups[] | select(.name=="Test Group 1")'

# Validate structure
{
  "id": "ROOM-A-Z1-G01",
  "name": "Test Group 1",
  "roomId": "ROOM-A",
  "zone": "ROOM-A-Z1",
  "crop": "Lettuce - Romaine",
  "trays": 4,
  "plants": 384, // 4 * 96
  "status": "vegetative"
}
```

#### 4.2 Configure Light Plan

**Page**: Group Detail (`LE-group-detail.html?id=ROOM-A-Z1-G01`)

**Actions**:
1. Navigate to "Plan" tab
2. Set photoperiod: 16 hours on / 8 hours off
3. Set total light hours: 16
4. Save plan

**Validation**:
```javascript
// Check group's planConfig
{
  "planConfig": {
    "anchor": {
      "type": "seedDate",
      "date": "2026-02-04"
    },
    "schedule": {
      "photoperiodHours": 16,
      "totalOnHours": 16
    }
  }
}
```

#### 4.3 Assign Light Devices

**Page**: Group Detail → Lights tab

**Actions**:
1. Click "Add Light Device"
2. Select device: "LED Panel 1"
3. Set intensity: 80%
4. Set spectrum: "Full Spectrum"
5. Save

**Validation**:
```javascript
// Check group's lights array
{
  "lights": [
    {
      "deviceId": "LED-001",
      "name": "LED Panel 1",
      "intensity": 80,
      "spectrum": "full",
      "recipe": "vegetative"
    }
  ]
}
```

---

## 🔍 Success Criteria

### Phase 1 (Email Optional Login)
- ✅ Login succeeds with just farmId + password
- ✅ Login succeeds with farmId + email + password
- ✅ Session token generated correctly
- ✅ No console errors

### Phase 2 (Test Farm Creation)
- ✅ Farm credentials stored
- ✅ Authentication works
- ✅ Farm ID "FARM-TEST-WIZARD-001" recognized

### Phase 3 (Wizard Completion)
- ✅ All 7 wizard steps complete without errors
- ✅ Required fields validated correctly
- ✅ Optional fields accepted when blank
- ✅ Data flows to correct setupData object
- ✅ farm.json created with complete profile
- ✅ rooms.json created with 2 rooms, 3 zones total
- ✅ groups.json initialized (empty or with setup defaults)
- ✅ Dashboard displays farm data correctly

### Phase 4 (Farm Building)
- ✅ Group created successfully
- ✅ Group appears in /api/groups endpoint
- ✅ Light plan configured and saved
- ✅ Light devices assigned
- ✅ Dashboard KPIs update: 4 trays, 384 plants
- ✅ No data format violations

---

## 📊 Data Flow Diagram

```
Login (farmId + password)
  ↓
Session Token Stored
  ↓
First-Time Wizard Detected
  ↓
Step 1: Activation (Skip in Edge)
  ↓
Step 2: Business Details → setupData.{farmName, contact...}
  ↓
Step 3: Location → setupData.location
  ↓
Step 4: Rooms → setupData.rooms[]
  ↓
Step 5: Tray Formats → setupData.trayFormats[] (optional)
  ↓
Step 6: Certifications → setupData.certifications[] (optional)
  ↓
Step 7: Review
  ↓
POST /api/farm/setup/complete
  ↓
  ├─ farm.json created/updated
  ├─ rooms.json created
  └─ groups.json initialized
  ↓
Redirect to Dashboard
  ↓
Verify Data Display
  ↓
Create First Group
  ↓
Configure Plan & Lights
  ↓
Validate groups.json structure
```

---

## 🚨 Risk Assessment

### HIGH RISK
- **Email removal breaks existing auth**: Mitigated by making email optional, not removing it
- **Wizard data not persisted**: Test after each step with console logging

### MEDIUM RISK
- **Data format mismatches**: Follow DATA_FORMAT_STANDARDS.md exactly
- **Browser cache issues**: Use version parameters, hard refresh

### LOW RISK
- **Test farm conflicts**: Use unique farmId prefix FARM-TEST-*
- **Session expiry during testing**: Set 24-hour expiry

---

## 📝 File Changes Required

### 1. server-foxtrot.js (Lines 14520-14600)
**Change**: Make email optional in `/api/farm/auth/login`
```javascript
// Before
if (!email || !password) {
  return res.status(400).json({ message: 'Email and password required' });
}

// After
if (!password) {
  return res.status(400).json({ message: 'Password required' });
}

const loginEmail = email || `admin@${farmId || 'edge'}.local`;
```

### 2. farm-admin.js (Lines 142-153)
**Change**: Update login validation
```javascript
// Before
if (!farmId || !email || !password) {
  showAlert('error', 'Please fill in all fields');
  return;
}

// After
if (!farmId || !password) {
  showAlert('error', 'Please fill in Farm ID and password');
  return;
}
```

### 3. LE-farm-admin.html (Login form)
**Change**: Update email input
```html
<!-- Before -->
<input type="email" id="email" required placeholder="Email">

<!-- After -->
<input type="email" id="email" placeholder="Email (optional)">
```

### 4. Add Test Farm Credentials
**New**: Environment variable or inline credentials
```javascript
// In server-foxtrot.js edge mode section
const testFarms = [
  {
    farmId: 'FARM-TEST-WIZARD-001',
    password: 'Grow123',
    name: 'This is Your Farm',
    role: 'admin'
  }
];
```

---

## 🎬 Testing Script

```bash
#!/bin/bash
# Farm Wizard Testing Script

echo "=== Phase 1: Start Server ==="
PORT=8091 EDGE_MODE=true FARM_ID=FARM-TEST-WIZARD-001 node server-foxtrot.js &
SERVER_PID=$!
sleep 3

echo "=== Phase 2: Open Browser ==="
open "http://localhost:8091/light-engine/public/LE-farm-admin.html"

echo "=== Phase 3: Manual Testing ==="
echo "1. Login with:"
echo "   Farm ID: FARM-TEST-WIZARD-001"
echo "   Password: Grow123"
echo "   Email: (leave blank)"
echo ""
echo "2. Complete wizard steps 1-7"
echo "3. After each step, check console: setupData"
echo ""
echo "Press Enter after wizard completion..."
read

echo "=== Phase 4: Verify Data Files ==="
echo "--- farm.json ---"
cat public/data/farm.json | jq '.'

echo "--- rooms.json ---"
cat public/data/rooms.json | jq '.rooms'

echo "--- groups.json ---"
cat public/data/groups.json | jq '.groups'

echo "=== Phase 5: Test API Endpoints ==="
curl -s http://localhost:8091/api/rooms | jq '.'
curl -s http://localhost:8091/api/groups | jq '.'

echo "=== Testing Complete ==="
kill $SERVER_PID
```

---

## 🔄 Review Agent Checklist

- [ ] Email optional change preserves backward compatibility
- [ ] Test farm credentials don't conflict with production
- [ ] Wizard validation logic remains intact
- [ ] Data flow follows canonical schema (DATA_FORMAT_STANDARDS.md)
- [ ] No security regressions (password still required)
- [ ] Error handling for each wizard step
- [ ] Console logging adequate for debugging
- [ ] File changes are minimal and focused
- [ ] No modification of existing farm data

---

## 🏁 Next Steps

1. **Review Agent**: Approve/reject this proposal
2. **Implementation Agent**: Execute Phase 1-2 changes
3. **User**: Execute manual Phase 3-4 testing with script
4. **Implementation Agent**: Fix any issues discovered
5. **Architecture Agent**: Review data format compliance

---

**Estimated Total Time**: 2 hours (30 min implementation + 90 min testing)  
**Complexity**: MEDIUM (UI changes + manual testing workflow)  
**User Involvement**: HIGH (manual wizard testing required)

---

**AWAITING REVIEW AGENT APPROVAL TO PROCEED** ✋
