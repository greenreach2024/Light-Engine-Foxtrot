# LE-Dashboard.html Complete Workflow Trace
**Date**: February 3, 2026  
**Page**: http://localhost:8091/LE-dashboard.html  
**Scope**: Farm Registration → Groups V2 with Rooms, Zones, Groups, Recipes loading

---

## Executive Summary

**LE-dashboard.html** is the main management interface for Light Engine Foxtrot. It orchestrates farm setup, device management, and grow operations through a multi-panel workflow. The page loads farm configuration from both local storage (`window.STATE`) and backend APIs (`/data/rooms.json`, `/data/groups.json`, `/plans`), with Groups V2 acting as the central hub for assigning rooms, zones, recipes, and schedules to growing groups.

---

## Page Load Sequence

### Phase 1: Initial HTML Parse (Lines 1-300)

**1. Meta Configuration**:
```html
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#10b981">
<meta name="apple-mobile-web-app-capable" content="yes">
```
- Sets up Progressive Web App (PWA) capabilities
- Enables fullscreen mode on mobile devices
- Green theme color (#10b981 - GreenReach brand)

**2. Build-Time Cache Busting**:
```html
<link rel="stylesheet" href="./styles.foxtrot.css?v={{BUILD_TIME}}">
<script src="/app.foxtrot.js?v={{BUILD_TIME}}" defer></script>
<script src="/groups-v2.js?v={{BUILD_TIME}}" defer></script>
```
- `{{BUILD_TIME}}` replaced at server startup with git commit hash
- Forces browser to reload CSS/JS after deployments
- Prevents outdated file issues reported by user

**3. API Base Configuration** (Line 21):
```javascript
window.API_BASE = window.location.origin;
// Result: http://localhost:8091 (local) or https://greenreachgreens.com (production)
```

**4. Inline Diagnostic Script** (Lines 97-145):
- Runs immediately on page load (not deferred)
- Loads IoT devices from `/data/iot-devices.json`
- Sets `window.STATE.iotDevices` and `window.LAST_IOT_SCAN`
- Calls `window.renderIoTDeviceCards()` after 2-second delay
- **Purpose**: Debug IoT device rendering issues

### Phase 2: DOMContentLoaded Event Cascade

When browser finishes parsing HTML, multiple DOMContentLoaded listeners fire:

**app.foxtrot.js** (Lines 6428-6432):
```javascript
document.addEventListener('DOMContentLoaded', async () => {
  await loadFarmData();       // Load farm identity
  await loadRoomsFromBackend(); // Load rooms, zones, groups
  // ... 20+ more initialization tasks
});
```

**groups-v2.js** (Lines 5863-6064):
- 15 separate DOMContentLoaded listeners (modular loading)
- Each listener wires up specific UI component
- Example listeners:
  - `loadZonesFromRoomMapper()` - Populate zone dropdown
  - `populateGroupsV2RoomDropdown()` - Populate room dropdown
  - `populateGroupsV2LoadGroupDropdown()` - Load saved groups
  - Button click handlers (Save, Load, Delete groups)
  - Anchor mode toggles (Seed Date vs DPS)
  - Cycle management (Add/Remove Cycle 2)

---

## Farm Registration Workflow

### Entry Point: "Register Farm" Button

**Location**: Line 432
```html
<button id="btnLaunchFarm" type="button" class="primary">Register Farm</button>
```

**Handler**: app.foxtrot.js line 6696
```javascript
document.getElementById('btnLaunchFarm').addEventListener('click', () => {
  // Open farm registration wizard modal
  openFarmWizard();
});
```

### Farm Registration Wizard Steps

**Step 1: Farm Identity** (app.foxtrot.js ~line 7000):
```javascript
function openFarmWizard() {
  const wizardHTML = `
    <div class="wizard-modal">
      <div class="wizard-container">
        <div class="wizard-header">
          <h2>Farm Registration</h2>
          <p class="wizard-subtitle">Let's set up your farm profile</p>
        </div>
        <div class="wizard-content">
          <div class="wizard-panel" data-step="1">
            <h3>Farm Details</h3>
            <label>Farm Name
              <input id="wizardFarmName" type="text" placeholder="e.g., Green Acres Farm">
            </label>
            <label>Farm Address
              <input id="wizardFarmAddress" type="text">
            </label>
            <label>Contact Name
              <input id="wizardContactName" type="text">
            </label>
            <label>Contact Email
              <input id="wizardContactEmail" type="email">
            </label>
          </div>
        </div>
      </div>
    </div>
  `;
  // Render wizard...
}
```

**Step 2: Rooms Configuration** (~line 7200):
```javascript
// Wizard panel 2: Add rooms
<div class="wizard-panel" data-step="2" style="display:none;">
  <h3>Grow Rooms</h3>
  <p>Define the physical rooms in your facility</p>
  <div id="wizardRoomsList">
    <!-- Dynamically added room inputs -->
  </div>
  <button id="wizardAddRoom">+ Add Room</button>
</div>
```

**Rooms are stored in**:
```javascript
window.STATE.farm.rooms = [
  { name: "Big Green Farm - Room 1", id: "room-knukf2" }
];
```

**Step 3: Zones Configuration** (~line 7400):
```javascript
// Each room can have multiple zones
<div class="wizard-panel" data-step="3" style="display:none;">
  <h3>Define Zones</h3>
  <p>Divide rooms into growing zones (benches, racks, etc.)</p>
  <select id="wizardRoomForZones">
    <option>Select room...</option>
  </select>
  <div id="wizardZonesList">
    <label>Zone Name
      <input type="text" placeholder="e.g., Propagation Bench A">
    </label>
  </div>
</div>
```

**Zones are saved to** `/data/room-map.json`:
```json
{
  "name": "Big Green Farm - Room 1",
  "zones": [
    {
      "zone": "room-knukf2:1",
      "name": "Zone 1",
      "room": "room-knukf2"
    }
  ]
}
```

**Step 4: Branding (Optional)** (~line 8500):
```javascript
// Upload farm logo and set colors
<div class="wizard-panel" data-step="4" style="display:none;">
  <h3>Farm Branding</h3>
  <label>Farm Logo
    <input type="file" id="wizardLogoUpload" accept="image/*">
  </label>
  <div class="wizard-color-picker">
    <label>Primary Color
      <input type="color" id="wizardPrimaryColor" value="#10b981">
    </label>
    <label>Secondary Color
      <input type="color" id="wizardSecondaryColor" value="#2e7d32">
    </label>
  </div>
</div>
```

**Saved to**:
```javascript
window.STATE.farm.branding = {
  logo: "data:image/png;base64,...",
  primaryColor: "#10b981",
  secondaryColor: "#2e7d32"
};
```

### Farm Registration Completion

**Final Step Handler** (app.foxtrot.js ~line 7619):
```javascript
async function completeFarmRegistration(formData) {
  // 1. Build farm object
  const farm = {
    farmId: generateFarmId(),
    name: formData.farmName,
    address: formData.farmAddress,
    contact: {
      name: formData.contactName,
      email: formData.contactEmail
    },
    rooms: formData.rooms, // From Step 2
    zones: formData.zones, // From Step 3
    branding: formData.branding // From Step 4
  };
  
  // 2. Save to backend
  const response = await fetch('/api/farm/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(farm)
  });
  
  // 3. Update local state
  window.STATE.farm = farm;
  
  // 4. Save to local storage
  localStorage.setItem('farm', JSON.stringify(farm));
  
  // 5. Write to data files
  await fetch('/data/farm.json', {
    method: 'PUT',
    body: JSON.stringify(farm)
  });
  
  await fetch('/data/rooms.json', {
    method: 'PUT',
    body: JSON.stringify({ rooms: farm.rooms })
  });
  
  // 6. Trigger UI updates
  document.dispatchEvent(new Event('farmDataChanged'));
  document.dispatchEvent(new Event('rooms-updated'));
  
  // 7. Close wizard
  closeFarmWizard();
  
  // 8. Show completion message
  showToast({
    title: 'Farm Registered',
    msg: `${farm.name} is ready for grow operations!`,
    kind: 'success',
    icon: '✅'
  });
}
```

**After Registration**:
- Farm panel collapses to summary badge
- "Edit Farm" button appears (line 433)
- Rooms panel becomes active
- Zones are available in Groups V2

---

## Groups V2 Panel Initialization

### Entry Point: Sidebar Button Click

**Location**: LE-dashboard.html line 252
```html
<button type="button" class="sidebar-link" data-sidebar-link data-target="groups-v2">
  Groups V2
</button>
```

**Handler**: groups-v2.js lines 5927-5938
```javascript
document.addEventListener('DOMContentLoaded', () => {
  const groupsV2Btn = document.querySelector('[data-sidebar-link][data-target="groups-v2"]');
  if (groupsV2Btn) {
    groupsV2Btn.addEventListener('click', (e) => {
      e.preventDefault();
      setActivePanel('groups-v2'); // app.foxtrot.js function
    });
  }
});
```

**Panel Reveal** (app.foxtrot.js ~line 1200):
```javascript
function setActivePanel(panelName) {
  // Hide all panels
  document.querySelectorAll('[data-panel]').forEach(panel => {
    panel.style.display = 'none';
    panel.setAttribute('hidden', '');
  });
  
  // Show selected panel
  const targetPanel = document.querySelector(`[data-panel="${panelName}"]`);
  if (targetPanel) {
    targetPanel.style.display = 'block';
    targetPanel.removeAttribute('hidden');
  }
}
```

### Groups V2 Panel Structure

**HTML**: Lines 586-800 in LE-dashboard.html

```html
<section id="groupsV2Panel" class="card hud-shell gr-card" data-panel="groups-v2" hidden>
  <div class="hud-shell__header">
    <h2>Groups V2</h2>
    <span id="groupsV2Status"></span>
  </div>
  
  <div class="panel-body">
    <!-- SECTION 1: Room/Zone/Group Selection -->
    <div id="groupsV2PlanForm">
      <select id="groupsV2RoomSelect">
        <option>(select room)</option>
      </select>
      <select id="groupsV2ZoneSelect">
        <option>(none)</option>
      </select>
      <input id="groupsV2ZoneName" type="text" placeholder="Group name">
      <button id="groupsV2SaveGroup">Save Group</button>
      <select id="groupsV2LoadGroup">
        <option>(none)</option>
      </select>
      <button id="groupsV2DeleteGroup">Delete selected group</button>
    </div>
    
    <!-- SECTION 2: Recipe/Plan Selection -->
    <div>
      <select id="groupsV2PlanSearch">
        <option>All plans</option>
      </select>
      <select id="groupsV2PlanSelect">
        <option>(select plan)</option>
      </select>
      <button id="applyPlanToGroupBtn">Apply to Current Plan</button>
    </div>
    
    <!-- SECTION 3: Schedule & Anchor -->
    <div class="groupsV2-anchor">
      <button id="groupsV2SeedDateBtn">Seed date</button>
      <button id="groupsV2DpsBtn">DPS (Days Post Seeding)</button>
      <input id="groupsV2SeedDate" type="date">
      <select id="groupsV2Dps">
        <option value="1">1 day</option>
        ...
      </select>
    </div>
    
    <!-- SECTION 4: Light Assignment -->
    <div>
      <select id="groupsV2UnassignedLightsSelect" multiple></select>
      <button id="assignLightsToGroupBtn">Assign Selected Light</button>
    </div>
    
    <!-- SECTION 5: Assigned Lights & Controls -->
    <div>
      <button id="groupsV2RunGroup">▶️ Run Group</button>
      <button id="groupsV2TestGroupLights">🔦 Test Assigned Lights</button>
    </div>
  </div>
</section>
```

---

## Groups V2 Data Loading Workflow

### 1. Load Rooms

**Trigger**: DOMContentLoaded event
**Function**: groups-v2.js line 5903
```javascript
function populateGroupsV2RoomDropdown() {
  const select = document.getElementById('groupsV2RoomSelect');
  if (!select) return;
  
  // Clear existing options
  select.innerHTML = '<option value="">(select room)</option>';
  
  // Load from window.STATE.rooms (populated by app.foxtrot.js)
  if (window.STATE && Array.isArray(window.STATE.rooms)) {
    window.STATE.rooms.forEach(room => {
      if (!room || !room.name) return;
      const opt = document.createElement('option');
      opt.value = room.name;
      opt.textContent = room.name;
      select.appendChild(opt);
    });
  }
  
  console.log('[Groups V2] Room dropdown populated with', select.options.length - 1, 'rooms');
}
```

**Data Source**:
```javascript
// window.STATE.rooms loaded from:
// 1. Backend API: GET /api/farm/rooms
// 2. Fallback: /data/rooms.json
// 3. Farm Registration wizard
```

**Example STATE.rooms**:
```json
[
  {
    "name": "Big Green Farm - Room 1",
    "id": "room-knukf2",
    "zones": [...]
  }
]
```

### 2. Load Zones

**Trigger**: DOMContentLoaded event OR room selection change
**Function**: groups-v2.js line 512
```javascript
async function loadZonesFromRoomMapper() {
  const zoneSelect = document.getElementById('groupsV2ZoneSelect');
  if (!zoneSelect) return;

  try {
    // Load room map data
    const response = await fetch('/data/room-map.json');
    if (!response.ok) {
      console.warn('[Groups V2] No room map data, using default zones');
      populateDefaultZones(zoneSelect);
      return;
    }

    const roomMap = await response.json();
    const zones = roomMap.zones || [];

    if (zones.length === 0) {
      console.warn('[Groups V2] No zones found in room mapper');
      populateDefaultZones(zoneSelect);
      return;
    }

    // Clear and populate with mapped zones
    zoneSelect.innerHTML = '';
    const noneOpt = document.createElement('option');
    noneOpt.value = '';
    noneOpt.textContent = '(none)';
    zoneSelect.appendChild(noneOpt);

    // Add each zone from room mapper
    zones.forEach(zone => {
      const opt = document.createElement('option');
      opt.value = String(zone.zone);
      opt.textContent = zone.name || `Zone ${zone.zone}`;
      zoneSelect.appendChild(opt);
    });

    console.log(`[Groups V2] Loaded ${zones.length} zones from room mapper`);
  } catch (error) {
    console.error('[Groups V2] Failed to load zones:', error);
    populateDefaultZones(zoneSelect);
  }
}
```

**Data Source**: `/data/room-map.json`
```json
{
  "name": "Big Green Farm - Room 1",
  "zones": [
    {
      "zone": "room-knukf2:1",
      "name": "Zone 1",
      "room": "room-knukf2",
      "roomName": "Big Green Farm - Room 1"
    }
  ],
  "devices": [...]
}
```

**Fallback**: If room-map.json missing, creates default zones (Zone 1-9)

### 3. Load Saved Groups

**Trigger**: DOMContentLoaded event OR groups-updated event
**Function**: groups-v2.js line 5845
```javascript
function populateGroupsV2LoadGroupDropdown() {
  const select = document.getElementById('groupsV2LoadGroup');
  if (!select) return;
  
  // Clear existing
  select.innerHTML = '<option value="">(none)</option>';
  
  // Get all saved groups from window.STATE.groups
  const groups = (window.STATE && Array.isArray(window.STATE.groups)) 
    ? window.STATE.groups 
    : [];
  
  if (!groups.length) {
    console.log('[Groups V2] No saved groups found');
    return;
  }
  
  // Optional filtering by current room/zone
  const roomSelect = document.getElementById('groupsV2RoomSelect');
  const zoneSelect = document.getElementById('groupsV2ZoneSelect');
  const currentRoom = roomSelect ? roomSelect.value : '';
  const currentZone = zoneSelect ? zoneSelect.value : '';
  
  // Add each group as an option
  groups.forEach(group => {
    // Filter by room/zone if selected
    if (currentRoom && group.room !== currentRoom) return;
    if (currentZone && group.zone !== currentZone) return;
    
    const opt = document.createElement('option');
    opt.value = group.id || formatGroupsV2GroupLabel(group);
    opt.textContent = group.name || formatGroupsV2GroupLabel(group);
    select.appendChild(opt);
  });
  
  console.log('[Groups V2] Load dropdown populated with', select.options.length - 1, 'groups');
}
```

**Data Source**: `window.STATE.groups` (loaded from `/data/groups.json`)
```json
[
  {
    "id": "ROOM-A-Z1-G01",
    "name": "ROOM-A-Z1-G01",
    "zone": "ROOM-A-Z1",
    "room": "Big Green Farm - Room 1",
    "recipe": "Mei Qing Pak Choi",
    "crop": "Mei Qing Pak Choi",
    "seedDate": "2026-01-15",
    "lights": [...],
    "planConfig": {...}
  }
]
```

### 4. Load Recipes/Plans

**Trigger**: DOMContentLoaded event
**Function**: groups-v2.js lines 1584-1700
```javascript
async function loadGroupsV2Plans() {
  try {
    // Fetch merged plans from backend
    const response = await fetch('/plans');
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const data = await response.json();
    
    // Plans can be in different formats:
    // Format 1: { plans: [...] }
    // Format 2: { recipes: [...] }
    // Format 3: Array directly [...]
    
    let plans = [];
    if (Array.isArray(data)) {
      plans = data;
    } else if (data.plans && Array.isArray(data.plans)) {
      plans = data.plans;
    } else if (data.recipes && Array.isArray(data.recipes)) {
      plans = data.recipes;
    }
    
    // Store in global state
    window.STATE = window.STATE || {};
    window.STATE.plans = plans;
    
    // Populate dropdowns
    populateGroupsV2PlanDropdowns(plans);
    
    console.log(`[Groups V2] Loaded ${plans.length} plans/recipes`);
    
  } catch (error) {
    console.error('[Groups V2] Failed to load plans:', error);
    // Fallback to empty
    window.STATE = window.STATE || {};
    window.STATE.plans = [];
  }
}

function populateGroupsV2PlanDropdowns(plans) {
  const searchSelect = document.getElementById('groupsV2PlanSearch');
  const planSelect = document.getElementById('groupsV2PlanSelect');
  
  if (!planSelect) return;
  
  // Clear plan select
  planSelect.innerHTML = '<option value="">(select plan)</option>';
  
  // Add each plan
  plans.forEach(plan => {
    const opt = document.createElement('option');
    opt.value = plan.id || plan.name;
    opt.textContent = plan.name || plan.crop || plan.id;
    
    // Store additional data as data attributes
    opt.dataset.crop = plan.crop || '';
    opt.dataset.stages = plan.stages ? JSON.stringify(plan.stages) : '';
    
    planSelect.appendChild(opt);
  });
  
  // Populate search dropdown (grouped by crop type)
  if (searchSelect) {
    searchSelect.innerHTML = '<option value="">All plans</option>';
    
    // Group plans by crop
    const cropGroups = {};
    plans.forEach(plan => {
      const crop = plan.crop || 'Other';
      if (!cropGroups[crop]) cropGroups[crop] = [];
      cropGroups[crop].push(plan);
    });
    
    // Add optgroups
    Object.keys(cropGroups).sort().forEach(crop => {
      const optgroup = document.createElement('optgroup');
      optgroup.label = crop;
      
      cropGroups[crop].forEach(plan => {
        const opt = document.createElement('option');
        opt.value = plan.id || plan.name;
        opt.textContent = plan.name || plan.id;
        optgroup.appendChild(opt);
      });
      
      searchSelect.appendChild(optgroup);
    });
  }
}
```

**Data Source**: `/plans` endpoint (merges multiple sources)
```javascript
// server-foxtrot.js
app.get('/plans', (req, res) => {
  // Merge:
  // 1. /data/lighting-recipes.json
  // 2. /data/plans.json
  // 3. User-created custom plans
  
  const recipes = JSON.parse(fs.readFileSync('./data/lighting-recipes.json'));
  const plans = JSON.parse(fs.readFileSync('./data/plans.json'));
  
  const merged = [...recipes.recipes, ...plans.plans];
  
  res.json({ plans: merged });
});
```

**Example Recipe**:
```json
{
  "id": "mei-qing-pak-choi",
  "name": "Mei Qing Pak Choi",
  "crop": "Pak Choi",
  "stages": [
    {
      "name": "Germination",
      "duration_days": 3,
      "ppfd": 50,
      "spectrum": { "blue": 20, "red": 80 },
      "temperature": 22
    },
    {
      "name": "Vegetative",
      "duration_days": 18,
      "ppfd": 200,
      "spectrum": { "blue": 30, "red": 70 },
      "temperature": 20
    },
    {
      "name": "Mature",
      "duration_days": 7,
      "ppfd": 180,
      "spectrum": { "blue": 25, "red": 75 },
      "temperature": 18
    }
  ],
  "total_days": 28
}
```

---

## Groups V2 Workflow: Create New Group

### Step-by-Step Process

**1. Select Room** (User Action):
```javascript
// User clicks: groupsV2RoomSelect dropdown
// Selects: "Big Green Farm - Room 1"
const roomSelect = document.getElementById('groupsV2RoomSelect');
roomSelect.value = "Big Green Farm - Room 1";
// Triggers change event → updates zone dropdown filter
```

**2. Select Zone** (User Action):
```javascript
// User clicks: groupsV2ZoneSelect dropdown
// Selects: "room-knukf2:1" (Zone 1)
const zoneSelect = document.getElementById('groupsV2ZoneSelect');
zoneSelect.value = "room-knukf2:1";
// Updates groupsV2FormState.zone
```

**3. Enter Group Name** (User Action):
```javascript
// User types: "Pak Choi Batch 2026-02-03"
const nameInput = document.getElementById('groupsV2ZoneName');
nameInput.value = "Pak Choi Batch 2026-02-03";
```

**4. Select Recipe/Plan** (User Action):
```javascript
// User selects from dropdown: "Mei Qing Pak Choi"
const planSelect = document.getElementById('groupsV2PlanSelect');
planSelect.value = "mei-qing-pak-choi";
// Triggers change event → loads recipe details
planSelect.addEventListener('change', () => {
  const selectedPlan = window.STATE.plans.find(p => p.id === planSelect.value);
  
  // Auto-fill target temperature from recipe
  document.getElementById('groupsV2TargetTemp').textContent = 
    selectedPlan.stages[0].temperature + '°C';
  
  // Update preview card
  updateGroupsV2Preview();
});
```

**5. Set Anchor (Seed Date or DPS)** (User Action):
```javascript
// Option A: Seed Date
document.getElementById('groupsV2SeedDateBtn').click();
document.getElementById('groupsV2SeedDate').value = '2026-02-03';

// Option B: Days Post Seeding
document.getElementById('groupsV2DpsBtn').click();
document.getElementById('groupsV2Dps').value = '7'; // 7 days into grow
```

**6. Configure Schedule** (User Action):
```javascript
// Cycle 1: 08:00 - 20:00 (12 hours)
document.getElementById('groupsV2Cycle1On').value = '08:00';
document.getElementById('groupsV2Cycle1Hours').value = '12';
// Auto-calculates end time: 20:00

// Optional Cycle 2:
document.getElementById('groupsV2AddCycle2Btn').click();
document.getElementById('groupsV2Cycle2Hours').value = '6';
// Auto-starts after Cycle 1 ends (20:00-02:00)
```

**7. Set Environmental Targets** (Optional):
```javascript
// Target humidity (temperature comes from recipe)
document.getElementById('groupsV2TargetHumidity').value = '65';
```

**8. Save Group** (User Action):
```javascript
document.getElementById('groupsV2SaveGroup').addEventListener('click', async () => {
  // Collect form data
  const groupData = {
    id: generateGroupId(), // e.g., "ROOM-A-Z1-G02"
    name: document.getElementById('groupsV2ZoneName').value,
    room: document.getElementById('groupsV2RoomSelect').value,
    zone: document.getElementById('groupsV2ZoneSelect').value,
    plan: document.getElementById('groupsV2PlanSelect').value,
    seedDate: document.getElementById('groupsV2SeedDate').value,
    schedule: {
      mode: 'one', // or 'two' if Cycle 2 active
      cycles: [
        {
          on: document.getElementById('groupsV2Cycle1On').value,
          off: calculateEndTime() // Based on hours
        }
      ]
    },
    targetHumidity: document.getElementById('groupsV2TargetHumidity').value,
    lights: [], // Empty until lights assigned
    status: 'configured'
  };
  
  // Add to global state
  if (!window.STATE.groups) window.STATE.groups = [];
  window.STATE.groups.push(groupData);
  
  // Save to backend
  await fetch('/api/groups', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(groupData)
  });
  
  // Update data file
  await fetch('/data/groups.json', {
    method: 'PUT',
    body: JSON.stringify(window.STATE.groups)
  });
  
  // Trigger refresh
  document.dispatchEvent(new Event('groups-updated'));
  
  showToast({
    title: 'Group Saved',
    msg: `${groupData.name} saved successfully`,
    kind: 'success'
  });
  
  // Refresh load dropdown
  populateGroupsV2LoadGroupDropdown();
});
```

**Result**:
- New group added to `/data/groups.json`
- Appears in "Load group" dropdown
- Ready for light assignment

---

## Groups V2 Workflow: Load Existing Group

**Trigger**: User selects group from "Load group" dropdown

```javascript
document.getElementById('groupsV2LoadGroup').addEventListener('change', (e) => {
  const groupId = e.target.value;
  if (!groupId) return;
  
  // Find group in STATE
  const group = window.STATE.groups.find(g => 
    g.id === groupId || formatGroupsV2GroupLabel(g) === groupId
  );
  
  if (!group) {
    alert('Group not found');
    return;
  }
  
  // Populate form fields
  document.getElementById('groupsV2RoomSelect').value = group.room || '';
  document.getElementById('groupsV2ZoneSelect').value = group.zone || '';
  document.getElementById('groupsV2ZoneName').value = group.name || '';
  document.getElementById('groupsV2PlanSelect').value = group.plan || '';
  document.getElementById('groupsV2SeedDate').value = group.seedDate || '';
  
  // Load schedule
  if (group.schedule && group.schedule.cycles) {
    const cycle1 = group.schedule.cycles[0];
    if (cycle1) {
      document.getElementById('groupsV2Cycle1On').value = cycle1.on;
      const duration = computeCycleDuration(cycle1.on, cycle1.off) / 60;
      document.getElementById('groupsV2Cycle1Hours').value = duration;
    }
    
    // Show Cycle 2 if exists
    if (group.schedule.mode === 'two' && group.schedule.cycles[1]) {
      document.getElementById('groupsV2Cycle2Container').style.display = 'flex';
      const cycle2 = group.schedule.cycles[1];
      document.getElementById('groupsV2Cycle2Hours').value = 
        computeCycleDuration(cycle2.on, cycle2.off) / 60;
    }
  }
  
  // Load assigned lights
  if (group.lights && group.lights.length) {
    renderGroupsV2AssignedLights(group.lights);
  }
  
  // Update preview
  updateGroupsV2Preview();
  
  console.log('[Groups V2] Loaded group:', group.name);
});
```

**Result**:
- All form fields populated with saved data
- Assigned lights displayed
- Recipe preview shown
- Ready to edit or run

---

## Groups V2 Workflow: Assign Lights

**Prerequisites**:
- Group must be created/loaded
- Lights must exist in `window.STATE.lights` (from Light Setup wizard or IoT devices)

**Step 1: Populate Unassigned Lights Dropdown**

```javascript
function populateGroupsV2UnassignedLights() {
  const select = document.getElementById('groupsV2UnassignedLightsSelect');
  if (!select) return;
  
  // Get all lights
  const allLights = (window.STATE && Array.isArray(window.STATE.lights)) 
    ? window.STATE.lights 
    : [];
  
  // Get currently assigned lights across all groups
  const assignedIds = new Set();
  if (window.STATE && Array.isArray(window.STATE.groups)) {
    window.STATE.groups.forEach(group => {
      if (group.lights) {
        group.lights.forEach(light => {
          const id = light.id || light.serial || light.deviceId || light.name;
          if (id) assignedIds.add(String(id));
        });
      }
    });
  }
  
  // Filter to unassigned lights only
  const unassigned = allLights.filter(light => {
    const id = light.id || light.serial || light.deviceId || light.name;
    return id && !assignedIds.has(String(id));
  });
  
  // Clear dropdown
  select.innerHTML = '';
  
  if (unassigned.length === 0) {
    const opt = document.createElement('option');
    opt.disabled = true;
    opt.textContent = 'No unassigned lights available';
    select.appendChild(opt);
    return;
  }
  
  // Add each unassigned light
  unassigned.forEach(light => {
    const opt = document.createElement('option');
    opt.value = light.id || light.serial || light.deviceId || light.name;
    opt.textContent = `${light.name || light.label} (${light.vendor || 'Unknown'})`;
    
    // Add capability info if available
    if (light.ppfd) {
      opt.textContent += ` - ${light.ppfd} µmol`;
    }
    if (light.spectrally_tunable) {
      opt.textContent += ' [Tunable]';
    }
    
    select.appendChild(opt);
  });
  
  console.log(`[Groups V2] ${unassigned.length} unassigned lights available`);
}
```

**Step 2: Assign Light Button Click**

```javascript
document.getElementById('assignLightsToGroupBtn').addEventListener('click', () => {
  const select = document.getElementById('groupsV2UnassignedLightsSelect');
  const selectedValue = select.value;
  
  if (!selectedValue) {
    alert('Select a light to assign');
    return;
  }
  
  // Get active group
  const group = getGroupsV2ActiveGroup();
  if (!group) {
    alert('Load or create a group first');
    return;
  }
  
  // Find light details
  const light = window.STATE.lights.find(l => 
    l.id === selectedValue || 
    l.serial === selectedValue ||
    l.deviceId === selectedValue ||
    l.name === selectedValue
  );
  
  if (!light) {
    alert('Light not found');
    return;
  }
  
  // Add to group
  if (!Array.isArray(group.lights)) group.lights = [];
  
  group.lights.push({
    id: light.id || selectedValue,
    name: light.name || light.label,
    vendor: light.vendor || light.manufacturer,
    // Preserve capability data
    ppfd: light.ppfd,
    ppf: light.ppf,
    spectrally_tunable: light.spectrally_tunable,
    dynamicSpectrum: light.dynamicSpectrum,
    spectrum: light.spectrum,
    // Control metadata
    control: light.control,
    deviceId: light.deviceId,
    serial: light.serial
  });
  
  // Save changes
  document.dispatchEvent(new Event('groups-updated'));
  
  // Refresh UI
  populateGroupsV2UnassignedLights(); // Remove from unassigned
  renderGroupsV2AssignedLights(group.lights); // Show in assigned
  
  showToast({
    title: 'Light Assigned',
    msg: `${light.name} assigned to ${group.name}`,
    kind: 'success',
    icon: '💡'
  });
});
```

**Step 3: Save Light Assignments**

```javascript
document.getElementById('groupsV2SaveLightAssignments').addEventListener('click', async () => {
  const group = getGroupsV2ActiveGroup();
  if (!group) return;
  
  // Save to backend
  await fetch(`/api/groups/${group.id}/lights`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lights: group.lights })
  });
  
  // Update groups.json
  await fetch('/data/groups.json', {
    method: 'PUT',
    body: JSON.stringify(window.STATE.groups)
  });
  
  showToast({
    title: 'Assignments Saved',
    msg: `${group.lights.length} light(s) saved to ${group.name}`,
    kind: 'success'
  });
});
```

---

## Groups V2 Workflow: Run Group

**Trigger**: "▶️ Run Group" button click

```javascript
document.getElementById('groupsV2RunGroup').addEventListener('click', async () => {
  const group = getGroupsV2ActiveGroup();
  if (!group) {
    alert('Load a group first');
    return;
  }
  
  if (!group.lights || group.lights.length === 0) {
    alert('Assign lights to this group before running');
    return;
  }
  
  if (!group.plan) {
    alert('Select a recipe/plan for this group');
    return;
  }
  
  // Confirm action
  const confirmed = confirm(
    `Start growing ${group.name}?\n\n` +
    `Recipe: ${group.plan}\n` +
    `Lights: ${group.lights.length}\n` +
    `Schedule: ${scheduleSummary(group.schedule)}`
  );
  
  if (!confirmed) return;
  
  // Calculate current stage based on seed date
  const today = new Date();
  const seedDate = new Date(group.seedDate);
  const daysPostSeeding = Math.floor((today - seedDate) / (1000 * 60 * 60 * 24));
  
  const plan = window.STATE.plans.find(p => p.id === group.plan || p.name === group.plan);
  if (!plan || !plan.stages) {
    alert('Recipe not found');
    return;
  }
  
  // Find current stage
  let accumulatedDays = 0;
  let currentStage = null;
  for (const stage of plan.stages) {
    if (daysPostSeeding < accumulatedDays + stage.duration_days) {
      currentStage = stage;
      break;
    }
    accumulatedDays += stage.duration_days;
  }
  
  if (!currentStage) {
    currentStage = plan.stages[plan.stages.length - 1]; // Use final stage
  }
  
  // Build lighting command
  const lightingCommand = {
    ppfd: currentStage.ppfd,
    spectrum: currentStage.spectrum, // { blue: 30, red: 70 }
    schedule: group.schedule, // { mode: 'one', cycles: [...] }
    temperature: currentStage.temperature || group.targetTemp
  };
  
  // Apply to each light in group
  for (const lightRef of group.lights) {
    const lightId = lightRef.id || lightRef.serial || lightRef.deviceId;
    
    // Send command to light controller
    await fetch('/api/lights/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lightId: lightId,
        command: 'set_spectrum_schedule',
        params: lightingCommand
      })
    });
  }
  
  // Update group status
  group.status = 'running';
  group.startedAt = new Date().toISOString();
  group.currentStage = currentStage.name;
  group.daysPostSeeding = daysPostSeeding;
  
  // Save state
  await fetch(`/api/groups/${group.id}`, {
    method: 'PUT',
    body: JSON.stringify(group)
  });
  
  // Show running indicator
  document.getElementById('groupsV2RunningIndicator').style.display = 'flex';
  
  showToast({
    title: 'Group Running',
    msg: `${group.name} - ${currentStage.name} (Day ${daysPostSeeding})`,
    kind: 'success',
    icon: '▶️'
  });
  
  // Update group status in UI
  document.dispatchEvent(new Event('groups-updated'));
});
```

---

## Data Flow Summary

### Farm Registration → Groups V2

```
┌─────────────────────────────────────────────────────────────────┐
│                     FARM REGISTRATION WIZARD                    │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ├──→ Step 1: Farm Identity
                               │    └──→ STATE.farm = { name, address, contact }
                               │
                               ├──→ Step 2: Rooms
                               │    └──→ STATE.farm.rooms = [{ name, id }]
                               │
                               ├──→ Step 3: Zones
                               │    └──→ /data/room-map.json = { zones: [...] }
                               │
                               └──→ Step 4: Branding (optional)
                                    └──→ STATE.farm.branding = { logo, colors }
                               │
                               ▼
                  ┌────────────────────────────┐
                  │  SAVE TO BACKEND & FILES   │
                  └────────────────────────────┘
                               │
                    ┌──────────┴──────────┐
                    │                     │
                    ▼                     ▼
          POST /api/farm/register    PUT /data/farm.json
                    │                 PUT /data/rooms.json
                    │                     │
                    └──────────┬──────────┘
                               │
                               ▼
                  ┌────────────────────────────┐
                  │  TRIGGER EVENTS            │
                  │  - farmDataChanged         │
                  │  - rooms-updated           │
                  └────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                          GROUPS V2 PANEL                        │
└─────────────────────────────────────────────────────────────────┘
                               │
                  ┌────────────┴────────────┐
                  │                         │
                  ▼                         ▼
        LOAD ROOMS & ZONES          LOAD RECIPES/PLANS
                  │                         │
    GET /data/rooms.json              GET /plans
    GET /data/room-map.json           (merges lighting-recipes.json
                  │                    + plans.json)
                  │                         │
                  └────────────┬────────────┘
                               │
                               ▼
                  ┌────────────────────────────┐
                  │  POPULATE DROPDOWNS        │
                  │  - groupsV2RoomSelect      │
                  │  - groupsV2ZoneSelect      │
                  │  - groupsV2PlanSelect      │
                  └────────────────────────────┘
                               │
                               ▼
                  ┌────────────────────────────┐
                  │  USER CREATES GROUP        │
                  │  1. Select room/zone       │
                  │  2. Name group             │
                  │  3. Select recipe          │
                  │  4. Set seed date          │
                  │  5. Configure schedule     │
                  │  6. Save group             │
                  └────────────────────────────┘
                               │
                               ▼
                  ┌────────────────────────────┐
                  │  SAVE GROUP                │
                  │  STATE.groups.push(...)    │
                  │  POST /api/groups          │
                  │  PUT /data/groups.json     │
                  └────────────────────────────┘
                               │
                               ▼
                  ┌────────────────────────────┐
                  │  ASSIGN LIGHTS             │
                  │  group.lights = [...]      │
                  └────────────────────────────┘
                               │
                               ▼
                  ┌────────────────────────────┐
                  │  RUN GROUP                 │
                  │  → Calculate current stage │
                  │  → Send spectrum commands  │
                  │  → Activate schedule       │
                  └────────────────────────────┘
```

---

## Key Files & Functions

### HTML Structure
- **File**: `/public/LE-dashboard.html` (3,010 lines)
- **Farm Registration Panel**: Lines 425-450
- **Groups V2 Panel**: Lines 586-800
- **Sidebar Navigation**: Lines 133-252

### JavaScript Modules
- **File**: `/public/app.foxtrot.js` (22,424 lines)
  - `loadFarmData()` - Line 6330
  - `loadRoomsFromBackend()` - Line 5046
  - `completeFarmRegistration()` - Line ~7619
  - `setActivePanel()` - Line ~1200

- **File**: `/public/groups-v2.js` (6,064 lines)
  - `loadZonesFromRoomMapper()` - Line 512
  - `populateGroupsV2RoomDropdown()` - Line 5903
  - `populateGroupsV2LoadGroupDropdown()` - Line 5845
  - `loadGroupsV2Plans()` - Line 1584
  - `assignLightsToGroupBtn` handler - Line ~575

### Data Files
- `/data/farm.json` - Farm identity (372 bytes)
- `/data/rooms.json` - Room list (257 bytes)
- `/data/room-map.json` - Zone layout (842 bytes)
- `/data/groups.json` - Saved groups (6,045 bytes, 8 groups)
- `/data/lighting-recipes.json` - Recipe library
- `/data/plans.json` - Custom grow plans

### API Endpoints
- `POST /api/farm/register` - Save farm registration
- `GET /api/farm/rooms` - Fetch rooms (with auth)
- `GET /data/rooms.json` - Fallback rooms
- `GET /plans` - Merged recipes + plans
- `POST /api/groups` - Save new group
- `PUT /api/groups/:id` - Update group
- `PUT /api/groups/:id/lights` - Save light assignments
- `POST /api/lights/command` - Send light control commands

---

## Common Issues & Solutions

### Issue 1: Zone Dropdown Empty
**Symptom**: Zone dropdown shows only "(none)" option

**Cause**: `/data/room-map.json` not loaded or missing zones

**Solution**: groups-v2.js line 512-573
```javascript
async function loadZonesFromRoomMapper() {
  // Fetches room-map.json
  // Falls back to default zones (Zone 1-9) if file missing
}
```

### Issue 2: No Rooms in Dropdown
**Symptom**: Room dropdown shows only "(select room)"

**Cause**: `window.STATE.rooms` not populated

**Solution**: app.foxtrot.js line 5046
```javascript
async function loadRoomsFromBackend() {
  // Loads from /data/rooms.json
  // Populates window.STATE.rooms
  // Triggers 'rooms-updated' event
}
```

### Issue 3: Recipes Not Loading
**Symptom**: Plan dropdown shows only "(select plan)"

**Cause**: `/plans` endpoint failing or returning empty

**Solution**: Check server-foxtrot.js `/plans` route
```javascript
app.get('/plans', (req, res) => {
  // Verify files exist:
  // - /data/lighting-recipes.json
  // - /data/plans.json
});
```

### Issue 4: Assigned Lights Not Saving
**Symptom**: Lights disappear after page reload

**Cause**: Changes only in `window.STATE`, not persisted to disk

**Solution**: Always call save after assignment
```javascript
await fetch('/data/groups.json', {
  method: 'PUT',
  body: JSON.stringify(window.STATE.groups)
});
```

---

## Testing Checklist

### Farm Registration
- [ ] Open wizard
- [ ] Enter farm name, address, contact
- [ ] Add room "Test Room 1"
- [ ] Add zone "Test Zone A" to room
- [ ] Upload logo (optional)
- [ ] Complete registration
- [ ] Verify farm badge appears
- [ ] Check `/data/farm.json` updated
- [ ] Check `/data/rooms.json` updated

### Groups V2 - Room/Zone Loading
- [ ] Click "Groups V2" in sidebar
- [ ] Verify room dropdown populates
- [ ] Verify zone dropdown populates
- [ ] Select room → verify zones filtered
- [ ] Console: No errors loading room-map.json

### Groups V2 - Recipe Loading
- [ ] Verify plan search dropdown populates
- [ ] Verify plan select dropdown populates
- [ ] Select plan → verify preview updates
- [ ] Check target temperature auto-fills
- [ ] Console: Check plans loaded count

### Groups V2 - Create Group
- [ ] Select room, zone, name
- [ ] Select recipe
- [ ] Set seed date
- [ ] Configure schedule (Cycle 1)
- [ ] Click "Save Group"
- [ ] Verify toast confirmation
- [ ] Verify group appears in "Load group" dropdown
- [ ] Check `/data/groups.json` updated

### Groups V2 - Load Group
- [ ] Select group from "Load group" dropdown
- [ ] Verify all fields populate correctly
- [ ] Verify schedule loads
- [ ] Verify assigned lights display (if any)

### Groups V2 - Assign Lights
- [ ] Verify unassigned lights dropdown populated
- [ ] Select light
- [ ] Click "Assign Selected Light"
- [ ] Verify light moves to assigned section
- [ ] Click "💾 Save Assigned Lights"
- [ ] Reload page → verify assignment persists

### Groups V2 - Run Group
- [ ] Load group with lights assigned
- [ ] Click "▶️ Run Group"
- [ ] Verify confirmation dialog
- [ ] Confirm → verify running indicator
- [ ] Check lights activate (visual or API log)
- [ ] Verify group status = "running"

---

## Conclusion

The LE-dashboard.html page provides a complete workflow from farm registration through to actively running grow groups. Data flows from Farm Registration → Rooms → Zones → Groups, with all configurations saved to both `window.STATE` (memory) and data files (persistence). Groups V2 acts as the central orchestrator, loading rooms, zones, recipes, and lights from various sources and assembling them into executable grow operations.

**Key Success Factors**:
1. Farm must be registered first (provides rooms)
2. Zones must be mapped (provides growing locations)
3. Recipes/plans must exist (provides grow parameters)
4. Lights must be set up (provides control capability)
5. All data files must be accessible via `/data/` endpoints
6. `window.STATE` must be kept in sync with data files

**Current Status**:
- ✅ Farm registered: Big Green Farm
- ✅ 1 room configured
- ✅ 1 zone mapped
- ✅ 8 groups saved
- ✅ ESP32 sensor active
- ✅ Recipes available via `/plans`
- ⏳ Need to verify Groups V2 loads all data correctly
