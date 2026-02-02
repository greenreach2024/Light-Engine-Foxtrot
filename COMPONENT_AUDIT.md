# Component Audit: Dashboard Data Flow Analysis
**Created**: February 2, 2026  
**Related**: IMPLEMENTATION_PROPOSAL_DATA_FLOW_FIX.md, REVIEW_AGENT_ASSESSMENT_DATA_FLOW_FIX.md  
**Purpose**: Complete inventory of dashboard components requiring event-driven data flow pattern

---

## 📊 EXECUTIVE SUMMARY

**Total Components**: 18 dashboard sections + wizards  
**Completed**: 1 (Groups V2 - reference implementation)  
**Remaining**: 17 sections require event-driven pattern  
**Estimated Time**: 15-19 hours total

**Priority Tiers**:
- **Tier 1 (Critical)**: 5 components (data flow actively broken) - 6-8 hours
- **Tier 2 (High)**: 4 components (dropdowns needed) - 4-5 hours
- **Tier 3 (Medium)**: 5 components (wizards with dropdowns) - 3-4 hours
- **Tier 4 (Low)**: 3 components (read-only or minimal state) - 2 hours

---

## 🎯 COMPONENT INVENTORY

### ✅ TIER 1: CRITICAL (Data Flow Actively Broken)

#### 1.1 Farm Registration (`#farmPanel`, `data-panel="farm-registration"`)
**Location**: LE-dashboard.html line 425  
**Status**: ❌ Needs event-driven pattern  
**Priority**: CRITICAL (users report data not flowing)

**Current State**:
- Saves farm data to `/data/farm.json`
- Does NOT dispatch `farmDataChanged` event after save
- Other components don't know when farm updated

**Required Changes**:
```javascript
// In app.foxtrot.js - Farm Registration save function
async function saveFarmData() {
  const farm = getFarmFormData();
  STATE.farm = farm;
  const success = await saveJSON('/data/farm.json', farm);
  if (success) {
    window.dispatchEvent(new CustomEvent('farmDataChanged', { detail: farm })); // ✅ ADD THIS
    showToast('Farm saved successfully');
  }
}

// Add listener for initialization
document.addEventListener('DOMContentLoaded', () => {
  if (STATE.farm) {
    populateFarmForm(STATE.farm);
  }
});

// Add listener for updates from other components
window.addEventListener('farmDataChanged', (e) => {
  populateFarmForm(e.detail || STATE.farm);
});
```

**Data Inputs**:
- Farm name
- Address
- Contact info
- WiFi settings

**Data Consumers**:
- Groups V2 (room dropdown depends on farm configuration)
- Equipment Overview (farm name display)
- Profile section (farm details)

**Time Estimate**: 1.5 hours

---

#### 1.2 Grow Rooms (`#roomsPanel`, `data-panel="grow-rooms"`)
**Location**: LE-dashboard.html line 445  
**Status**: ❌ Needs event-driven pattern  
**Priority**: CRITICAL

**Current State**:
- Saves rooms data to `/data/rooms.json`
- Does NOT consistently dispatch `rooms-updated` event
- Groups V2 room dropdown shows stale data

**Required Changes**:
```javascript
// In app.foxtrot.js - Room save function
async function saveRooms() {
  const rooms = getRoomsFromForm();
  STATE.rooms = rooms;
  const success = await saveJSON('/data/rooms.json', rooms);
  if (success) {
    document.dispatchEvent(new Event('rooms-updated')); // ✅ ADD THIS
    showToast('Rooms saved successfully');
  }
}

// Add listener for initialization
document.addEventListener('DOMContentLoaded', () => {
  if (STATE.rooms) {
    populateRoomsTable(STATE.rooms);
  }
});

// Add listener for updates
document.addEventListener('rooms-updated', () => {
  populateRoomsTable(STATE.rooms);
});
```

**Data Inputs**:
- Room list (name, dimensions, hardware)
- Wizard: Room creation/editing

**Data Consumers**:
- **Groups V2** (CRITICAL - room dropdown broken)
- Bus Mapping (room selection)
- Equipment Overview (room filtering)
- IoT Devices (room assignment)

**Time Estimate**: 2 hours

---

#### 1.3 Light Setup (`#lightsPanel`, `data-panel="light-setup"`)
**Location**: LE-dashboard.html line 457  
**Status**: ❌ Needs event-driven pattern  
**Priority**: CRITICAL

**Current State**:
- Saves light configuration to STATE/localStorage
- Does NOT dispatch events
- Bus Mapping doesn't see light changes

**Required Changes**:
```javascript
// In app.foxtrot.js - Light save function
async function saveLights() {
  const lights = getLightsFromWizard();
  STATE.lights = lights;
  // Save to persistent storage
  const success = await saveJSON('/data/lights.json', lights);
  if (success) {
    document.dispatchEvent(new Event('lights-updated')); // ✅ ADD THIS
    showToast('Lights saved successfully');
  }
}

// Add listeners
document.addEventListener('DOMContentLoaded', () => {
  if (STATE.lights) {
    populateLightsDisplay(STATE.lights);
  }
});

document.addEventListener('lights-updated', () => {
  populateLightsDisplay(STATE.lights);
});
```

**Data Inputs**:
- Light fixtures list
- Light controller configuration
- Wizard: 4-step light setup

**Data Consumers**:
- Bus Mapping (fixture-to-bus assignment)
- Groups V2 (light control in grow plans)
- Equipment Overview (light inventory)

**Time Estimate**: 2 hours

---

#### 1.4 Bus Mapping (`#bus-mapping`, `data-panel="bus-mapping"`)
**Location**: LE-dashboard.html line 1097  
**Status**: ❌ Needs event-driven pattern  
**Priority**: CRITICAL

**Current State**:
- Saves bus mapping configuration
- Does NOT listen for rooms/lights updates
- Dropdowns show stale data

**Required Changes**:
```javascript
// In app.foxtrot.js - Bus Mapping listeners
document.addEventListener('DOMContentLoaded', () => {
  populateBusMappingRoomDropdown(STATE.rooms);
  populateBusMappingFixtureDropdown(STATE.lights);
});

document.addEventListener('rooms-updated', () => {
  populateBusMappingRoomDropdown(STATE.rooms);
});

document.addEventListener('lights-updated', () => {
  populateBusMappingFixtureDropdown(STATE.lights);
});

// When saving bus mapping
async function saveBusMapping() {
  const mapping = getBusMappingFromForm();
  STATE.busMapping = mapping;
  const success = await saveJSON('/data/bus-mapping.json', mapping);
  if (success) {
    document.dispatchEvent(new Event('bus-mapping-updated')); // ✅ ADD THIS
    showToast('Bus mapping saved successfully');
  }
}
```

**Data Inputs**:
- Room dropdown (depends on Grow Rooms)
- Light fixture dropdown (depends on Light Setup)
- Bus/channel assignments

**Data Consumers**:
- Equipment Overview (visual map of connections)
- Calibration (fixture targeting)

**Time Estimate**: 1.5 hours

---

#### 1.5 IoT Devices (`#iotPanel`, `data-panel="iot-devices"`)
**Location**: LE-dashboard.html line 487  
**Status**: ❌ Needs event-driven pattern  
**Priority**: CRITICAL

**Current State**:
- Saves IoT device assignments
- Does NOT listen for rooms updates
- Room dropdown shows stale data

**Required Changes**:
```javascript
// In app.foxtrot.js - IoT Devices listeners
document.addEventListener('DOMContentLoaded', () => {
  populateIoTRoomDropdowns(STATE.rooms);
  renderIoTDeviceCards(STATE.iotDevices);
});

document.addEventListener('rooms-updated', () => {
  populateIoTRoomDropdowns(STATE.rooms);
});

document.addEventListener('iot-devices-updated', () => {
  renderIoTDeviceCards(STATE.iotDevices);
});

// When saving IoT device
async function saveIoTDevice(device) {
  // Update device in STATE
  const index = STATE.iotDevices.findIndex(d => d.id === device.id);
  if (index >= 0) {
    STATE.iotDevices[index] = device;
  } else {
    STATE.iotDevices.push(device);
  }
  
  const success = await saveJSON('/data/iot-devices.json', STATE.iotDevices);
  if (success) {
    document.dispatchEvent(new Event('iot-devices-updated')); // ✅ ADD THIS
    showToast('IoT device saved successfully');
  }
}
```

**Data Inputs**:
- Room dropdown (depends on Grow Rooms)
- Device configuration

**Data Consumers**:
- Equipment Overview (device inventory)
- Groups V2 (environmental controls)

**Time Estimate**: 1.5 hours

---

### ⚠️ TIER 2: HIGH (Dropdowns Needed, Not Broken Yet)

#### 2.1 Equipment Overview (`#equipmentPanel`, `data-panel="equipment-overview"`)
**Location**: LE-dashboard.html line 1066  
**Status**: ❌ Needs event-driven pattern  
**Priority**: HIGH

**Current State**:
- Read-only display of equipment
- Should update when rooms/lights/devices change
- Currently requires page refresh

**Required Changes**:
```javascript
// In app.foxtrot.js - Equipment Overview listeners
document.addEventListener('DOMContentLoaded', () => {
  renderEquipmentOverview();
});

document.addEventListener('rooms-updated', renderEquipmentOverview);
document.addEventListener('lights-updated', renderEquipmentOverview);
document.addEventListener('iot-devices-updated', renderEquipmentOverview);
document.addEventListener('bus-mapping-updated', renderEquipmentOverview);

function renderEquipmentOverview() {
  const equipment = {
    rooms: STATE.rooms || [],
    lights: STATE.lights || [],
    devices: STATE.iotDevices || [],
    mapping: STATE.busMapping || {}
  };
  updateEquipmentDisplay(equipment);
}
```

**Data Inputs**:
- All setup data (rooms, lights, devices, bus mapping)

**Data Consumers**:
- None (display only)

**Time Estimate**: 1 hour

---

#### 2.2 Integrations (`#integrationsPanel`, `data-panel="integrations"`)
**Location**: LE-dashboard.html line 814  
**Status**: ❌ Needs event-driven pattern  
**Priority**: HIGH

**Current State**:
- Farm integration settings
- Does NOT listen for farm data changes

**Required Changes**:
```javascript
// In app.foxtrot.js - Integrations listeners
document.addEventListener('DOMContentLoaded', () => {
  if (STATE.farm) {
    populateIntegrationsForm(STATE.farm);
  }
});

window.addEventListener('farmDataChanged', (e) => {
  populateIntegrationsForm(e.detail || STATE.farm);
});

async function saveIntegrations() {
  const integrations = getIntegrationsFromForm();
  STATE.farm.integrations = integrations;
  const success = await saveJSON('/data/farm.json', STATE.farm);
  if (success) {
    window.dispatchEvent(new CustomEvent('farmDataChanged', { detail: STATE.farm })); // ✅ ADD THIS
    showToast('Integrations saved successfully');
  }
}
```

**Data Inputs**:
- Farm data (integration keys, API tokens)

**Data Consumers**:
- Profile section (displays integration status)

**Time Estimate**: 1 hour

---

#### 2.3 Profile Section (`#profilePanel`, `data-panel="profile"`)
**Location**: LE-dashboard.html line 539  
**Status**: ❌ Needs event-driven pattern  
**Priority**: HIGH

**Current State**:
- Displays user/farm info
- Does NOT listen for farm data changes

**Required Changes**:
```javascript
// In app.foxtrot.js - Profile listeners
document.addEventListener('DOMContentLoaded', () => {
  if (STATE.farm) {
    populateProfileDisplay(STATE.farm);
  }
});

window.addEventListener('farmDataChanged', (e) => {
  populateProfileDisplay(e.detail || STATE.farm);
});
```

**Data Inputs**:
- Farm data (name, contact, settings)

**Data Consumers**:
- None (display only)

**Time Estimate**: 1 hour

---

#### 2.4 Calibration Panel (`#calibrationPanel`, `data-panel="calibration"`)
**Location**: LE-dashboard.html line 523  
**Status**: ❌ Needs event-driven pattern  
**Priority**: HIGH

**Current State**:
- Calibration wizard
- Should listen for lights/bus-mapping updates

**Required Changes**:
```javascript
// In app.foxtrot.js - Calibration listeners
document.addEventListener('DOMContentLoaded', () => {
  populateCalibrationTargetDropdown(STATE.lights);
});

document.addEventListener('lights-updated', () => {
  populateCalibrationTargetDropdown(STATE.lights);
});

document.addEventListener('bus-mapping-updated', () => {
  populateCalibrationTargetDropdown(STATE.lights);
});
```

**Data Inputs**:
- Light fixtures (target dropdown)
- Bus mapping (fixture addressing)

**Data Consumers**:
- None (calibration results saved to fixture config)

**Time Estimate**: 1.5 hours

---

### 📋 TIER 3: MEDIUM (Wizards with Dropdowns)

#### 3.1 Farm Registration Wizard (multi-step)
**Location**: LE-dashboard.html line 1704-1832  
**Status**: ❌ Needs event-driven pattern  
**Priority**: MEDIUM

**Steps with Dropdowns**:
- WiFi Select (step: wifi-select)
- Location (step: location)
- Spaces (step: spaces)

**Required Changes**:
```javascript
// Wizard should read from STATE
function showFarmWizardStep(stepName) {
  if (stepName === 'wifi-select') {
    populateWifiNetworks(STATE.networks || []);
  } else if (stepName === 'location') {
    prefillLocationIfAvailable(STATE.farm);
  }
}

// Wizard completion should trigger event
async function completeFarmWizard() {
  const farm = getFarmWizardData();
  STATE.farm = farm;
  const success = await saveJSON('/data/farm.json', farm);
  if (success) {
    window.dispatchEvent(new CustomEvent('farmDataChanged', { detail: farm })); // ✅ ADD THIS
    closeFarmWizard();
    showToast('Farm setup complete!');
  }
}
```

**Time Estimate**: 1 hour

---

#### 3.2 Room Creation Wizard (multi-step)
**Location**: LE-dashboard.html line 1558-1605  
**Status**: ❌ Needs event-driven pattern  
**Priority**: MEDIUM

**Steps with Data**:
- Room Info (step: room-info)
- Hardware (step: hardware)
- Category Setup (step: category-setup)

**Required Changes**:
```javascript
// Wizard completion should trigger event
async function completeRoomWizard() {
  const room = getRoomWizardData();
  STATE.rooms.push(room);
  const success = await saveJSON('/data/rooms.json', STATE.rooms);
  if (success) {
    document.dispatchEvent(new Event('rooms-updated')); // ✅ ADD THIS
    closeRoomWizard();
    showToast('Room created successfully!');
  }
}
```

**Time Estimate**: 45 minutes

---

#### 3.3 Light Setup Wizard (multi-step)
**Location**: LE-dashboard.html line 1385-1420  
**Status**: ❌ Needs event-driven pattern  
**Priority**: MEDIUM

**Steps with Data**:
- Fixtures (step: fixtures)
- Control (step: control)
- Add More (step: add-more)

**Required Changes**:
```javascript
// Wizard completion should trigger event
async function completeLightWizard() {
  const lights = getLightWizardData();
  STATE.lights = lights;
  const success = await saveJSON('/data/lights.json', lights);
  if (success) {
    document.dispatchEvent(new Event('lights-updated')); // ✅ ADD THIS
    closeLightWizard();
    showToast('Lights configured successfully!');
  }
}
```

**Time Estimate**: 45 minutes

---

#### 3.4 Calibration Wizard (multi-step)
**Location**: LE-dashboard.html line 1450-1512  
**Status**: ❌ Needs event-driven pattern  
**Priority**: MEDIUM

**Steps with Dropdowns**:
- Target (step: target) - should show fixtures from STATE.lights

**Required Changes**:
```javascript
// Wizard step should read from STATE
function showCalibrationStep(stepName) {
  if (stepName === 'target') {
    populateCalibrationTargets(STATE.lights || []);
  }
}
```

**Time Estimate**: 45 minutes

---

#### 3.5 Pair Devices Wizard (multi-step)
**Location**: LE-dashboard.html line 1624-1677  
**Status**: ❌ Needs event-driven pattern  
**Priority**: MEDIUM

**Steps with Data**:
- Scan (step: scan) - discovered devices
- WiFi/Bluetooth configuration

**Required Changes**:
```javascript
// Wizard completion should trigger event
async function completePairWizard(device) {
  STATE.iotDevices.push(device);
  const success = await saveJSON('/data/iot-devices.json', STATE.iotDevices);
  if (success) {
    document.dispatchEvent(new Event('iot-devices-updated')); // ✅ ADD THIS
    closePairWizard();
    showToast('Device paired successfully!');
  }
}
```

**Time Estimate**: 45 minutes

---

### 📊 TIER 4: LOW (Read-Only or Minimal State)

#### 4.1 Top Card (`#topCard`)
**Location**: LE-dashboard.html line 272  
**Status**: ❌ Needs event-driven pattern  
**Priority**: LOW

**Current State**:
- Hero card displaying farm status
- Should update when farm data changes

**Required Changes**:
```javascript
// In app.foxtrot.js - Top Card listeners
document.addEventListener('DOMContentLoaded', () => {
  updateTopCardDisplay(STATE.farm);
});

window.addEventListener('farmDataChanged', (e) => {
  updateTopCardDisplay(e.detail || STATE.farm);
});
```

**Time Estimate**: 30 minutes

---

#### 4.2 Environmental AI Card (`#environmentalAiCard`)
**Location**: LE-dashboard.html line 323  
**Status**: ❌ Needs event-driven pattern  
**Priority**: LOW

**Current State**:
- AI-driven environmental recommendations
- Should update when groups/rooms change

**Required Changes**:
```javascript
// In app.foxtrot.js - Environmental AI listeners
document.addEventListener('DOMContentLoaded', () => {
  updateEnvironmentalAI(STATE.groups, STATE.rooms);
});

document.addEventListener('groups-updated', () => {
  updateEnvironmentalAI(STATE.groups, STATE.rooms);
});

document.addEventListener('rooms-updated', () => {
  updateEnvironmentalAI(STATE.groups, STATE.rooms);
});
```

**Time Estimate**: 1 hour

---

#### 4.3 Pair Devices Panel (`#pairDevicesPanel`)
**Location**: LE-dashboard.html line 473  
**Status**: ❌ Needs event-driven pattern  
**Priority**: LOW

**Current State**:
- Device pairing interface
- Minimal state dependencies

**Required Changes**:
```javascript
// In app.foxtrot.js - Pair Devices listeners
document.addEventListener('iot-devices-updated', () => {
  refreshPairDevicesDisplay();
});
```

**Time Estimate**: 30 minutes

---

## 📝 IMPLEMENTATION STRATEGY

### Phase 0: Pre-Implementation (30 minutes)
- ✅ Document created (this file)
- ⏳ Create git branch: `feature/event-driven-data-flow`
- ⏳ Add helper library to imports
- ⏳ Add `state-ready` event dispatch to loadAllData

### Phase 1: Tier 1 Components (6-8 hours)
**Critical path - fix data flow bugs first**

Order of implementation:
1. Grow Rooms (2h) - Fixes Groups V2 room dropdown
2. Farm Registration (1.5h) - Enables farm-wide data flow
3. Bus Mapping (1.5h) - Fixes light fixture assignments
4. IoT Devices (1.5h) - Fixes room assignments
5. Light Setup (2h) - Completes core setup flow

### Phase 2: Tier 2 Components (4-5 hours)
**High value - improve user experience**

Order of implementation:
1. Equipment Overview (1h) - Real-time equipment display
2. Calibration Panel (1.5h) - Fixture targeting
3. Profile Section (1h) - Farm info display
4. Integrations (1h) - API key management

### Phase 3: Tier 3 Components (3-4 hours)
**Wizards - ensure consistency**

Order of implementation:
1. Farm Registration Wizard (1h)
2. Room Creation Wizard (45min)
3. Light Setup Wizard (45min)
4. Calibration Wizard (45min)
5. Pair Devices Wizard (45min)

### Phase 4: Tier 4 Components (2 hours)
**Polish - complete coverage**

Order of implementation:
1. Environmental AI Card (1h)
2. Top Card (30min)
3. Pair Devices Panel (30min)

---

## ✅ VERIFICATION CHECKLIST

After implementing each component, verify:

- [ ] Component dispatches events after saving data
- [ ] Component listens for relevant update events
- [ ] Component reads from STATE object (not localStorage directly)
- [ ] Component populates dropdowns on DOMContentLoaded
- [ ] Component repopulates dropdowns on update events
- [ ] Manual test: Update data in one component, verify another updates
- [ ] Console test: `debugState()` shows correct data
- [ ] No errors in browser console

---

## 🧪 TESTING STRATEGY

### Unit Testing (per component)
```javascript
// Test pattern for each component
describe('Component: Grow Rooms', () => {
  it('should dispatch rooms-updated after save', async () => {
    const eventSpy = jest.spyOn(document, 'dispatchEvent');
    await saveRooms();
    expect(eventSpy).toHaveBeenCalledWith(expect.objectContaining({
      type: 'rooms-updated'
    }));
  });
  
  it('should update dropdown on rooms-updated event', () => {
    const dropdown = document.getElementById('roomDropdown');
    document.dispatchEvent(new Event('rooms-updated'));
    expect(dropdown.options.length).toBeGreaterThan(0);
  });
});
```

### Integration Testing (cross-component)
```javascript
// Test data flow between components
describe('Data Flow: Rooms → Groups V2', () => {
  it('should update Groups V2 room dropdown when room saved', async () => {
    // Save room in Grow Rooms component
    await saveRooms();
    
    // Verify Groups V2 dropdown updated
    const dropdown = document.getElementById('groupsV2RoomDropdown');
    expect(dropdown.options.length).toBe(STATE.rooms.length);
  });
});
```

### Manual Testing Checklist
- [ ] Update room name in Grow Rooms → Verify Groups V2 dropdown updates
- [ ] Add new room → Verify all dropdowns include new room
- [ ] Update farm name → Verify top card, profile, equipment overview update
- [ ] Save light configuration → Verify bus mapping, calibration dropdowns update
- [ ] Pair IoT device → Verify equipment overview, device inventory update

---

## 📊 TIME ESTIMATES BY PHASE

| Phase | Components | Estimated Time | Priority |
|-------|-----------|---------------|----------|
| Phase 0: Pre-implementation | Setup | 30 minutes | CRITICAL |
| Phase 1: Tier 1 (Critical) | 5 components | 6-8 hours | CRITICAL |
| Phase 2: Tier 2 (High) | 4 components | 4-5 hours | HIGH |
| Phase 3: Tier 3 (Medium) | 5 wizards | 3-4 hours | MEDIUM |
| Phase 4: Tier 4 (Low) | 3 components | 2 hours | LOW |
| **TOTAL** | **18 components** | **15-19 hours** | - |

**Risk Buffer**: +20% (3-4 hours) for unexpected issues  
**Total with Buffer**: 18-23 hours

---

## 🚨 ROLLBACK STRATEGY

### Git Branching
```bash
# Create feature branch
git checkout -b feature/event-driven-data-flow

# Commit after each component
git commit -m "feat(data-flow): Add event-driven pattern to Grow Rooms"

# If component breaks, revert single commit
git revert HEAD
```

### Staged Deployment
1. Develop locally (localhost:8091)
2. Test on local edge device (VM or test device)
3. Deploy to production edge device (100.65.187.59)
4. Monitor for 24 hours
5. If issues, revert via git: `git revert <commit-hash>`

### Feature Flags (Optional)
```javascript
// Enable/disable event-driven pattern per component
const FEATURE_FLAGS = {
  eventDrivenRooms: true,
  eventDrivenGroups: true,
  eventDrivenFarm: true
};

if (FEATURE_FLAGS.eventDrivenRooms) {
  // Use new event-driven pattern
  document.addEventListener('rooms-updated', updateDropdowns);
} else {
  // Fall back to old pattern
  updateDropdowns();
}
```

---

## 📚 RELATED DOCUMENTS

- Implementation Proposal: `IMPLEMENTATION_PROPOSAL_DATA_FLOW_FIX.md`
- Review Agent Assessment: `REVIEW_AGENT_ASSESSMENT_DATA_FLOW_FIX.md`
- Architecture Agent Assessment: `ARCHITECTURE_AGENT_ASSESSMENT_DATA_FLOW_FIX.md`
- Architecture Vision: `DASHBOARD_ARCHITECTURE_VISION.md`
- Helper Library: `public/lib/data-flow-helpers.js`

---

**Status**: Ready for Implementation  
**Next Step**: Begin Phase 0 (pre-implementation setup)  
**Owner**: Implementation Agent  
**Last Updated**: February 2, 2026
