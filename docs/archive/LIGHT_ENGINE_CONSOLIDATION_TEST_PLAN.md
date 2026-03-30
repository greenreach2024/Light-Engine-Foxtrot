# Light Engine Consolidation - Comprehensive Test Plan

**Date**: February 3, 2026  
**Purpose**: Validate consolidated Light Engine UI (page-by-page, feature-by-feature)  
**Special Focus**: Admin Dashboard, Group v2  
**Source**: `light-engine/public/` (consolidated from edge)

---

## Test Environment Setup

### Prerequisites
```bash
# 1. Start edge server with consolidated files
cd /Users/petergilbert/Light-Engine-Foxtrot
PORT=8091 node server-foxtrot.js

# 2. Access via: http://localhost:8091/
# 3. Use edge device IP for full testing: http://100.65.187.59:8091/
```

### Test Data Requirements
- [ ] Valid farm profile (farm.json)
- [ ] Active groups (groups.json) - **CRITICAL for Group v2 testing**
- [ ] Room configuration (rooms.json)
- [ ] Device connections (for sensor/control testing)

---

## 🎯 PRIORITY 1: Admin Dashboard (LE-farm-admin.html)

**Test URL**: `/light-engine/public/LE-farm-admin.html`

### 1.1 Dashboard KPIs - CRITICAL TEST

**Issue Context**: All 4 KPI cards currently show MOCK DATA instead of real farm data

#### Test: Active Trays Card
- [ ] **Load page** - Record displayed value
- [ ] **Expected**: Calculate from groups.json → `sum of all group.trays`
- [ ] **Current Bug**: Shows hardcoded "320"
- [ ] **Verify**: Value matches actual tray count
- [ ] **Check Console**: Any API errors for `/api/inventory/current`

#### Test: Total Plants Card
- [ ] **Load page** - Record displayed value
- [ ] **Expected**: Calculate from groups.json → `sum of all group.plants`
- [ ] **Current Bug**: Shows hardcoded "7,680"
- [ ] **Verify**: Value matches actual plant count
- [ ] **Alternative**: If plants not in data, use `trays × 24` estimation

#### Test: Active Devices Card
- [ ] **Load page** - Record displayed value
- [ ] **Expected**: Query devices API or devices.json
- [ ] **Current Bug**: Shows hardcoded "24" with comment "mock data for now"
- [ ] **Verify**: Value matches actual connected devices
- [ ] **Check Console**: Look for device API calls

#### Test: Next Harvest Card
- [ ] **Load page** - Record displayed value
- [ ] **Expected**: Find group with lowest `days_to_harvest > 0`
- [ ] **Current Bug**: Shows hardcoded "14d Butterhead Lettuce"
- [ ] **Verify**: Shows real crop name and actual days
- [ ] **Check Console**: Any API errors for `/api/inventory/forecast`

**KPI Test Summary Template**:
```
BEFORE FIX:
- Active Trays: _____ (expected: _____)
- Total Plants: _____ (expected: _____)
- Active Devices: _____ (expected: _____)
- Next Harvest: _____ (expected: _____)

AFTER FIX:
- Active Trays: _____ ✓/✗
- Total Plants: _____ ✓/✗
- Active Devices: _____ ✓/✗
- Next Harvest: _____ ✓/✗
```

### 1.2 Quick Actions Panel
- [ ] **View Farm** link → Opens farm-summary.html
- [ ] **Financial Summary** → Shows accounting section
- [ ] **Crop Pricing** → Shows pricing management
- [ ] **Crop Value** → Shows valuation snapshot
- [ ] **AI Pricing Assistant** → Opens AI modal
- [ ] **Manage Users** → Shows user management

### 1.3 Navigation Menu
- [ ] **Dashboard** (active state)
- [ ] **Subscription** → Opens subscription panel
- [ ] **Accounting** → Opens accounting panel
- [ ] **Pricing** → Opens pricing panel
- [ ] **Crop Value** → Opens crop value panel
- [ ] **Users** → Opens user management
- [ ] **Settings** → Opens settings panel
- [ ] **Devices** → Opens device panel
- [ ] **Logout** button works

### 1.4 Recent Activity Feed
- [ ] Activity table loads
- [ ] Shows timestamp, event, user, status
- [ ] Real data (not mock)
- [ ] Sortable columns
- [ ] Pagination works (if >10 items)

### 1.5 Subscription Panel
- [ ] Current plan displays
- [ ] Usage metrics shown
- [ ] Upgrade/downgrade options
- [ ] Billing history accessible
- [ ] Payment methods shown

### 1.6 Accounting Panel
- [ ] Revenue summary
- [ ] Expense tracking
- [ ] Transaction list
- [ ] Export functions
- [ ] Date filtering

### 1.7 Pricing Management
- [ ] Crop list loads from groups
- [ ] Retail prices editable
- [ ] WS1/WS2 discounts editable
- [ ] Bulk pricing toggle
- [ ] Save changes function
- [ ] Export pricing CSV

### 1.8 Crop Value Calculator
- [ ] Real-time valuation
- [ ] Grouped by crop type
- [ ] Stage-based pricing
- [ ] Total farm value
- [ ] Export valuation

### 1.9 User Management
- [ ] Active users list
- [ ] Role assignments
- [ ] Invite user function
- [ ] Edit permissions
- [ ] Deactivate users
- [ ] Last login timestamps

### 1.10 Settings Panel
- [ ] Farm profile editable
- [ ] Integration settings
- [ ] Wholesale marketplace toggle
- [ ] Tablet pairing QR generator
- [ ] Backup settings
- [ ] Security settings

---

## 🎯 PRIORITY 2: Group v2 Testing (groups.json interaction)

**Context**: Group v2 is the authoritative crop tracking system

### 2.1 Data Loading - Farm Summary (farm-summary.html)

**Test URL**: `/light-engine/public/views/farm-summary.html`

#### Groups Data Display
- [ ] **Load page** - All groups render
- [ ] **Group count** matches groups.json
- [ ] **Each group shows**:
  - [ ] Crop name
  - [ ] Stage/days since planted
  - [ ] Tray count
  - [ ] Plant count (if available)
  - [ ] Location/room
  - [ ] Days to harvest
  - [ ] Projected harvest date

#### Group Filtering
- [ ] Filter by crop type
- [ ] Filter by stage
- [ ] Filter by room/location
- [ ] Search by name
- [ ] Sort by harvest date
- [ ] Sort by days to harvest

#### Group Actions
- [ ] Click group → Opens detail view
- [ ] Edit group metadata
- [ ] Record activity (water, feed, etc.)
- [ ] Move group
- [ ] Harvest group

### 2.2 Tray Inventory (tray-inventory.html)

**Test URL**: `/light-engine/public/views/tray-inventory.html`

#### Tray Grid View
- [ ] All trays from groups.json displayed
- [ ] Tray status (active/idle/maintenance)
- [ ] Crop assignment shown
- [ ] Days in stage
- [ ] Color coding by crop type
- [ ] Hover shows details

#### Tray Operations
- [ ] **Move tray** function
  - [ ] Select tray
  - [ ] Choose destination
  - [ ] Updates group data
  - [ ] Audit log created
- [ ] **Harvest tray** function
  - [ ] Record harvest weight
  - [ ] Generate lot code
  - [ ] Update tray status
  - [ ] Reduces group tray count
- [ ] **Assign tray** to group
  - [ ] Select empty tray
  - [ ] Choose group
  - [ ] Updates immediately

#### Tray Filters
- [ ] View by room
- [ ] View by crop
- [ ] View by status
- [ ] Empty trays only
- [ ] Ready to harvest

### 2.3 Planting Scheduler (planting-scheduler.html)

**Test URL**: `/light-engine/public/views/planting-scheduler.html`

#### New Group Creation
- [ ] **Create new group form**
  - [ ] Select crop/recipe
  - [ ] Set tray count
  - [ ] Choose location
  - [ ] Set plant date
  - [ ] Auto-calculate harvest date
- [ ] **Validation**
  - [ ] Requires crop selection
  - [ ] Validates tray availability
  - [ ] Checks location capacity
- [ ] **Submit creates**:
  - [ ] New entry in groups.json
  - [ ] Assigns trays
  - [ ] Creates audit log
  - [ ] Shows in farm summary

#### Planting Schedule View
- [ ] Shows planned plantings
- [ ] Current groups displayed
- [ ] Future projections
- [ ] Capacity planning
- [ ] Succession planting suggestions

### 2.4 Group Detail/Edit

#### View Group Details
- [ ] Full group metadata
- [ ] Tray assignments list
- [ ] Activity timeline
- [ ] Growth metrics
- [ ] Projected vs actual
- [ ] Photos/observations

#### Edit Group
- [ ] Update crop name
- [ ] Adjust tray count
- [ ] Change location
- [ ] Update days to harvest
- [ ] Add notes
- [ ] Save persists to groups.json

### 2.5 Group v2 Schema Validation

**CRITICAL**: Verify data format standards compliance

- [ ] **Load groups.json** in browser console
- [ ] **Check required fields**:
  ```javascript
  {
    id: "string",
    crop: "string",
    trays: number,
    plants: number (optional),
    days_since_planted: number,
    days_to_harvest: number,
    stage: "string",
    location: "string",
    room: "string"
  }
  ```
- [ ] **No format violations**
- [ ] **Adapters working** (normalizeGroup, etc.)
- [ ] **Fallback patterns** for missing fields

---

## 📋 COMPLETE PAGE-BY-PAGE TEST

### Core Admin Pages (LE-*.html)

#### 3.1 LE-dashboard.html
- [ ] Loads without errors
- [ ] All widgets render
- [ ] Real-time data updates
- [ ] Navigation functional
- [ ] Feature detection loads (check console)
- [ ] Mobile responsive

#### 3.2 LE-billing.html
- [ ] Subscription status
- [ ] Payment methods
- [ ] Invoice history
- [ ] Usage metrics
- [ ] Billing alerts
- [ ] Export invoices

#### 3.3 LE-downloads.html
- [ ] Available downloads list
- [ ] Desktop app link
- [ ] Mobile app QR codes
- [ ] Documentation links
- [ ] Installer downloads
- [ ] Version info

#### 3.4 LE-notifications.html
- [ ] Notification list
- [ ] Mark as read
- [ ] Delete notifications
- [ ] Notification settings link
- [ ] Filter by type
- [ ] Real-time updates

#### 3.5 LE-notification-settings.html
- [ ] Email preferences
- [ ] SMS preferences
- [ ] Push notification settings
- [ ] Alert thresholds
- [ ] Quiet hours
- [ ] Save preferences

#### 3.6 LE-qr-generator.html
- [ ] Generate farm QR
- [ ] Generate tablet pairing QR
- [ ] Download QR image
- [ ] Print QR code
- [ ] QR expiration settings

#### 3.7 LE-setup-wizard-legacy.html
- [ ] Wizard navigation
- [ ] Step 1: Farm info
- [ ] Step 2: Room setup
- [ ] Step 3: Devices
- [ ] Step 4: Crops
- [ ] Complete setup

#### 3.8 LE-wholesale-orders.html
- [ ] Order list loads
- [ ] Filter orders (pending/completed)
- [ ] Order detail view
- [ ] Accept/modify order
- [ ] Generate packing slip
- [ ] Mark as shipped

#### 3.9 LE-wholesale-review.html
- [ ] Catalog review
- [ ] SKU list
- [ ] Pricing review
- [ ] Availability toggle
- [ ] Bulk updates
- [ ] Publish changes

#### 3.10 LE-ai-agent-test.html
- [ ] AI agent interface
- [ ] Chat functionality
- [ ] Command execution
- [ ] Response formatting
- [ ] Error handling

### Operations Views (views/*.html)

#### 3.11 farm-inventory.html
- [ ] Inventory dashboard
- [ ] Seeds inventory
- [ ] Packaging inventory
- [ ] Nutrients inventory
- [ ] Equipment status
- [ ] Reorder alerts

#### 3.12 nutrient-management.html
- [ ] Nutrient formulas list
- [ ] Dosing schedule
- [ ] pH/EC monitoring
- [ ] Tank levels
- [ ] Dosing history
- [ ] Create custom formula

#### 3.13 room-heatmap.html
- [ ] Room layout visualization
- [ ] Temperature heatmap
- [ ] Humidity heatmap
- [ ] VPD visualization
- [ ] Historical data
- [ ] Export heatmap

#### 3.14 room-mapper.html
- [ ] Room layout editor
- [ ] Add/remove zones
- [ ] Tray placement
- [ ] Device placement
- [ ] Save layout
- [ ] Export map

#### 3.15 tray-setup.html
- [ ] Tray configuration
- [ ] Growing media setup
- [ ] Seed type selection
- [ ] Planting pattern
- [ ] Save tray profile

#### 3.16 field-mapping.html
- [ ] Field layout
- [ ] Plot assignment
- [ ] Outdoor crop tracking
- [ ] Weather integration
- [ ] Harvest zones

#### 3.17 iot-manager.html
- [ ] Device list
- [ ] Connection status
- [ ] Device configuration
- [ ] Add new device
- [ ] Firmware updates
- [ ] Device logs

#### 3.18 fan-rotation-monitor.html
- [ ] Fan status grid
- [ ] Rotation schedule
- [ ] Alert on stuck fan
- [ ] Manual override
- [ ] Rotation history

### Legacy/Specialty Pages

#### 3.19 LE-admin-legacy.html
- [ ] Legacy admin functions
- [ ] Data migration tools
- [ ] System diagnostics
- [ ] Database tools

#### 3.20 LE-create-test-farm.html
- [ ] Create demo farm
- [ ] Generate test data
- [ ] Populate groups
- [ ] Seed database

#### 3.21 LE-migration-wizard.html
- [ ] Migration steps
- [ ] Data export
- [ ] Format conversion
- [ ] Import validation
- [ ] Complete migration

#### 3.22 LE-offline.html
- [ ] Offline mode indicator
- [ ] Cached data display
- [ ] Sync status
- [ ] Queue pending actions

#### 3.23 LE-switchbot.html
- [ ] SwitchBot integration
- [ ] Device pairing
- [ ] Scene management
- [ ] Status monitoring

#### 3.24 LE-vpd.html
- [ ] VPD calculator
- [ ] Target VPD by stage
- [ ] Current VPD display
- [ ] Recommendations
- [ ] Historical trends

---

## 🔍 Feature-Specific Tests

### 4.1 Feature Detection System

**Test**: Verify config.js loading

```javascript
// Open browser console on any LE page
console.log(window.LE_CONFIG);

// Expected output:
{
  deployment: "edge" or "cloud",
  features: {
    monitoring: true,
    inventory: true,
    planning: true,
    forecasting: true,
    activityHub: true,
    qualityControl: true,
    trayOperations: true,
    tabletPairing: true,
    deviceControl: true/false,  // edge only
    nutrientControl: true/false, // edge only
    criticalAlerts: true/false   // edge only
  },
  restrictions: {
    reason: "..." // if cloud mode
  }
}
```

- [ ] Config loads on page load
- [ ] Correct deployment mode
- [ ] Feature flags accurate
- [ ] No console errors
- [ ] Custom event `le:config:ready` fires

### 4.2 Critical Controls Restriction (Cloud Mode Only)

**Test**: If testing on cloud deployment

- [ ] Device control buttons show restriction message
- [ ] Nutrient dosing disabled with explanation
- [ ] Message: "Critical controls require 24/7 reliable connection (use edge device)"
- [ ] Safe operations still functional
- [ ] No JavaScript errors

### 4.3 Data Persistence

**Test**: Verify changes save correctly

- [ ] Edit group → Refresh → Changes persist
- [ ] Update pricing → Refresh → Prices saved
- [ ] Create new group → Refresh → Group exists
- [ ] User preferences → Refresh → Preferences kept

### 4.4 Real-time Updates

**Test**: Multi-tab synchronization

- [ ] Open same page in 2 tabs
- [ ] Make change in tab 1
- [ ] Tab 2 updates (if WebSocket enabled)
- [ ] No data conflicts

### 4.5 Mobile Responsiveness

**Test**: Each page at mobile viewport (375px)

- [ ] Layout adapts
- [ ] Navigation accessible
- [ ] Forms usable
- [ ] Tables scroll/collapse
- [ ] Touch targets adequate

---

## 🐛 Known Issues to Verify Fixed

### Issue 1: Dashboard KPI Mock Data
**Status**: KNOWN BUG - Needs fix
- [ ] Active Trays shows real value (not 320)
- [ ] Total Plants shows real value (not 7,680)
- [ ] Active Devices shows real value (not 24)
- [ ] Next Harvest shows real value (not "14d Butterhead Lettuce")

### Issue 2: Activity Hub Missing APIs
**Status**: KNOWN BUG - 24 endpoints missing on cloud
- [ ] Verify Activity Hub functional on edge
- [ ] Document which APIs unavailable on cloud
- [ ] Graceful error handling when APIs missing

### Issue 3: Schema Validation Failures
**Status**: PRE-EXISTING - groups.json ID format
- [ ] groups.json IDs don't break functionality
- [ ] Adapters handle ID format variations
- [ ] No runtime errors from invalid IDs

---

## ✅ Test Execution Checklist

### Pre-Test Setup
- [ ] Server running (edge or cloud)
- [ ] Test data loaded (farm, groups, rooms)
- [ ] Browser console open for errors
- [ ] Network tab open for API monitoring
- [ ] Screenshot tool ready

### During Testing
- [ ] Document every page tested
- [ ] Record all errors in console
- [ ] Note failed API calls
- [ ] Screenshot any visual bugs
- [ ] Test both happy path and edge cases

### Post-Test Reporting
- [ ] Count pages tested: ___ of 29
- [ ] Count features tested: ___ of ___
- [ ] Critical bugs found: ___
- [ ] Minor bugs found: ___
- [ ] Blockers for deployment: ___

---

## 📊 Test Results Template

```markdown
# Light Engine Consolidation Test Results

**Tested By**: ___________
**Date**: ___________
**Environment**: Edge / Cloud
**Browser**: ___________

## Summary
- Pages Tested: ___ / 29
- Features Working: ___ / ___
- Critical Issues: ___
- Deployment Ready: YES / NO

## Critical Issues
1. ___________
2. ___________

## Minor Issues
1. ___________
2. ___________

## Admin Dashboard Results
- KPI Cards: PASS / FAIL (details: ___)
- Navigation: PASS / FAIL
- Data Loading: PASS / FAIL

## Group v2 Results
- Data Display: PASS / FAIL
- CRUD Operations: PASS / FAIL
- Schema Compliance: PASS / FAIL

## Recommendations
1. ___________
2. ___________
```

---

## 🚀 Testing Priority Order

### Phase 1: Critical Path (1-2 hours)
1. ✅ Admin Dashboard (LE-farm-admin.html)
   - Focus: KPI cards with real data
2. ✅ Farm Summary (farm-summary.html)
   - Focus: Groups display correctly
3. ✅ Tray Inventory (tray-inventory.html)
   - Focus: Group v2 integration

### Phase 2: Core Operations (2-3 hours)
4. Planting Scheduler
5. Nutrient Management
6. Inventory Management
7. Wholesale Orders

### Phase 3: Supporting Pages (1-2 hours)
8. All remaining LE-*.html pages
9. All remaining views/*.html pages
10. Legacy/specialty pages

### Phase 4: Feature Validation (1 hour)
11. Feature detection system
12. Mobile responsiveness
13. Data persistence
14. Real-time updates

---

**Total Estimated Testing Time**: 5-8 hours for comprehensive validation

**Test Completion Criteria**:
- [ ] All 29 HTML pages load without errors
- [ ] Admin Dashboard KPIs show REAL data
- [ ] Group v2 CRUD operations functional
- [ ] No critical blockers for deployment
- [ ] Schema validation passing (or documented exceptions)
- [ ] Feature flags working correctly
