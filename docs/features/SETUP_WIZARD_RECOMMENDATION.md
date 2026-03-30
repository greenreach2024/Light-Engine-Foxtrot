# Light Engine Cloud - Recommended First-Time Setup Flow

**Analysis Date:** January 4, 2026  
**Context:** LE Cloud customers (non-Edge) setup wizard optimization  
**Focus:** Simple, guided onboarding for new users

---

## Executive Summary

After reviewing the current setup wizard, hardware detection workflows, Activity Hub QR setup, and tray management documentation, here are the **recommended setup steps** for LE Cloud customers in optimal order.

### Key Findings:

1. **Current wizard has 7 steps** (0-6) but Step 1 (network config) only applies to Edge devices
2. **Missing critical onboarding steps** for practical farm operations (tray setup, QR printing)
3. **Activity Hub QR already implemented** in Step 6 (good!)
4. **Need to add** tray format creation, QR label generation guidance

---

## Current Setup Wizard (Cloud Customers)

### Existing Steps (as implemented)

**Step 0: Create Password** ✅
- Change temporary password to secure password
- **Status:** Implemented, working
- **Keep:** YES - Security critical

**Step 1: Welcome** ✅
- Overview of setup process
- **Status:** Implemented
- **Keep:** YES - Sets expectations

**Step 2: Farm Registration** ✅
- Pre-filled from purchase data
- Farm name, contact, email
- **Status:** Implemented, auto-populated
- **Keep:** YES - Core business info

**Step 3: Certifications & Practices** ✅
- GAP, Organic, Food Safety certs
- Pesticide-free, Non-GMO, Hydroponic
- Woman-owned, Family farm, etc.
- **Status:** Implemented
- **Keep:** YES - Important for wholesale marketplace

**Step 4: Desktop App Download** ✅
- Show desktop app info for Cloud customers
- macOS and Windows available
- **Status:** Implemented
- **Keep:** YES - But could be optional/skippable

**Step 5: Cloud Features Overview** ✅
- AI Assistant, Smart Pricing, Activity Hub mobile app links
- **Status:** Implemented
- **Keep:** YES - Feature education

**Step 6: Activity Hub QR Code** ✅
- Generate QR for iPad setup
- Shows Activity Hub URL with auth token
- **Status:** Implemented (Jan 4, 2026)
- **Keep:** YES - Critical for operations

---

## Gaps in Current Flow

### Missing Operational Setup Steps

#### 1. Room & Zone Structure ❌ NOT IN WIZARD
**What:** Define farm layout (Rooms → Zones → Groups)
**Why Needed:** Foundation for all inventory tracking
**Current State:** Users must create manually in dashboard after wizard
**Should Add:** Step after certifications, before Activity Hub

#### 2. Tray Format Registration ❌ NOT IN WIZARD
**What:** Define tray types (128-cell, 200-cell, 288-cell, custom)
**Why Needed:** Required before any tray can be scanned/registered
**Current State:** Users discover this when they try to use Activity Hub
**Should Add:** Step after room setup, explain tray formats exist

#### 3. QR Label Printing Guidance ❌ NOT IN WIZARD
**What:** How to generate and print QR labels for trays
**Why Needed:** Can't use Activity Hub without tray QR codes
**Current State:** Buried in documentation `/docs/tray-tracking.html`
**Should Add:** Explain QR printing process, link to generator tool

#### 4. Sensor Pairing ❌ NOT IN WIZARD
**What:** Connect environmental sensors (SwitchBot, ESP32, etc.)
**Why Needed:** Environmental monitoring requires sensor data
**Current State:** Hardware detection exists but only runs for Edge
**Should Add:** Optional step for Cloud + sensor users

---

## Recommended New Setup Flow

### Proposed 10-Step Wizard (Cloud Customers)

#### **Step 0: Create Password** (KEEP)
*Unchanged from current implementation*

#### **Step 1: Welcome** (KEEP)
*Update total step count to 10*

#### **Step 2: Farm Registration** (KEEP)
*Pre-filled business info, unchanged*

#### **Step 3: Farm Layout Setup** (NEW)
**What to add:**
- Create your first room (e.g., "Grow Room A")
- Create zones within room (e.g., "Zone 1", "Zone 2")
- Explain: Rooms → Zones → Groups → Trays hierarchy

**UI Elements:**
```html
<div class="wizard-step" id="step-3">
  <h1 class="step-title">Farm Layout Setup</h1>
  <p class="step-description">
    Organize your farm into rooms and zones. 
    This helps track inventory and manage different growing areas.
  </p>
  
  <div class="input-group">
    <label>Room Name</label>
    <input type="text" class="touch-input" id="room-name" placeholder="Grow Room A" required>
  </div>
  
  <div class="input-group">
    <label>Number of Zones</label>
    <select class="touch-input" id="zone-count">
      <option value="1">1 Zone</option>
      <option value="2">2 Zones</option>
      <option value="3">3 Zones</option>
      <option value="4">4 Zones</option>
      <option value="5">5 Zones</option>
    </select>
  </div>
  
  <div class="info-box">
    <strong>💡 Tip:</strong> Start simple! You can add more rooms and zones later from your dashboard.
  </div>
</div>
```

**Backend API:**
```javascript
POST /api/setup-wizard/create-room
{
  "farmId": "FARM-001",
  "roomName": "Grow Room A",
  "zoneCount": 2
}
```

---

#### **Step 4: Tray Formats** (NEW)
**What to add:**
- Explain what tray formats are
- Create at least one tray format
- Show common formats (128-cell, 200-cell, 288-cell)

**UI Elements:**
```html
<div class="wizard-step" id="step-4">
  <h1 class="step-title">Tray Format Setup</h1>
  <p class="step-description">
    Define the types of trays you use. Each tray type has a specific number of plant sites.
  </p>
  
  <h3>Select Your Tray Types</h3>
  
  <div class="checkbox-grid">
    <label class="checkbox-card">
      <input type="checkbox" name="tray-format" value="128" checked>
      <div class="card-content">
        <div class="card-title">128-Cell Tray</div>
        <div class="card-description">Standard 11x22 tray, 128 plant sites</div>
        <div class="card-icon">🌱</div>
      </div>
    </label>
    
    <label class="checkbox-card">
      <input type="checkbox" name="tray-format" value="200">
      <div class="card-content">
        <div class="card-title">200-Cell Tray</div>
        <div class="card-description">High-density tray, 200 plant sites</div>
        <div class="card-icon">🌱🌱</div>
      </div>
    </label>
    
    <label class="checkbox-card">
      <input type="checkbox" name="tray-format" value="288">
      <div class="card-content">
        <div class="card-title">288-Cell Tray</div>
        <div class="card-description">Microgreens tray, 288 plant sites</div>
        <div class="card-icon">🌿</div>
      </div>
    </label>
  </div>
  
  <div class="info-box success">
    <strong>✅ You can add custom tray formats later</strong> from Dashboard → Tray Setup
  </div>
</div>
```

**Backend API:**
```javascript
POST /api/setup-wizard/create-tray-formats
{
  "farmId": "FARM-001",
  "formats": [
    {
      "name": "128-Cell Standard",
      "plantSiteCount": 128,
      "systemType": "nft"
    },
    {
      "name": "200-Cell High-Density",
      "plantSiteCount": 200,
      "systemType": "nft"
    }
  ]
}
```

---

#### **Step 5: QR Label Printing** (NEW)
**What to add:**
- Explain need for QR labels
- Link to QR generator tool
- Show example label
- Provide printer recommendations

**UI Elements:**
```html
<div class="wizard-step" id="step-5">
  <h1 class="step-title">Print Tray QR Labels</h1>
  <p class="step-description">
    Each tray needs a unique QR code label. Let's generate your first batch!
  </p>
  
  <div class="card highlight">
    <h3>What You'll Need</h3>
    <ul>
      <li>Thermal label printer (Brother or Zebra recommended)</li>
      <li>Waterproof labels (2" x 3" size)</li>
      <li>About 5 minutes to print your first 50-100 labels</li>
    </ul>
  </div>
  
  <div class="button-grid">
    <button class="touch-button primary" onclick="openQRGenerator()">
      <span>🖨️ Open QR Generator Tool</span>
    </button>
  </div>
  
  <div class="info-box">
    <strong>📝 Quick Instructions:</strong>
    <ol>
      <li>Choose "TRAY-" as prefix</li>
      <li>Start at number 1000</li>
      <li>Generate 50-100 labels</li>
      <li>Download PDF and print</li>
      <li>Stick labels on tray edges</li>
    </ol>
  </div>
  
  <div class="skip-option">
    <a href="#" onclick="skipQRPrinting()">
      Skip for now (you can print labels later)
    </a>
  </div>
</div>
```

**JavaScript:**
```javascript
function openQRGenerator() {
  // Open QR generator in new window
  const farmId = localStorage.getItem('farmId');
  window.open(`/tools/qr-generator.html?farmId=${farmId}&prefix=TRAY-&start=1000&count=50`, '_blank');
  
  // Show confirmation message
  showSetupMessage('QR Generator opened in new window. Come back here when done!');
}

function skipQRPrinting() {
  // Mark as skipped
  localStorage.setItem('qr_printing_skipped', 'true');
  nextStep();
}
```

---

#### **Step 6: Certifications & Practices** (KEEP, MOVED FROM STEP 3)
*Moved later in flow - keep existing implementation*

---

#### **Step 7: Desktop App Info** (KEEP, OPTIONAL)
*Show desktop app availability, but make it clearly optional*

**UI Update:**
```html
<div class="skip-option" style="text-align: center; margin-top: 2rem;">
  <button class="touch-button secondary" onclick="nextStep()">
    <span>Continue Without Desktop App</span>
  </button>
</div>
```

---

#### **Step 8: Sensor Pairing** (NEW, OPTIONAL)
**What to add:**
- Ask: "Do you have environmental sensors?"
- If YES → Guide through pairing process
- If NO → Skip to next step

**UI Elements:**
```html
<div class="wizard-step" id="step-8">
  <h1 class="step-title">Connect Sensors (Optional)</h1>
  <p class="step-description">
    Do you have environmental sensors to connect? (temperature, humidity, CO2)
  </p>
  
  <div class="button-grid">
    <button class="touch-button success" onclick="startSensorPairing()">
      <span>Yes, I Have Sensors</span>
    </button>
    <button class="touch-button" onclick="skipSensors()">
      <span>No Sensors Yet</span>
    </button>
  </div>
  
  <div id="sensor-pairing-section" style="display: none;">
    <h3>Sensor Pairing</h3>
    <div class="info-box">
      <strong>Supported Sensors:</strong>
      <ul>
        <li>SwitchBot Meter (Bluetooth)</li>
        <li>SwitchBot Meter Plus (WiFi)</li>
        <li>Custom ESP32 sensors</li>
        <li>Zigbee environmental sensors</li>
      </ul>
    </div>
    
    <button class="touch-button primary" onclick="scanForSensors()">
      <span>🔍 Scan for Sensors</span>
    </button>
    
    <div id="sensor-results">
      <!-- Sensor scan results appear here -->
    </div>
  </div>
  
  <div class="skip-option">
    <a href="#" onclick="nextStep()">
      I'll add sensors later
    </a>
  </div>
</div>
```

**JavaScript:**
```javascript
async function scanForSensors() {
  document.getElementById('sensor-results').innerHTML = '<div class="loading"></div> Scanning...';
  
  try {
    const response = await fetch('/api/hardware/scan-sensors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    
    const data = await response.json();
    displaySensorResults(data.sensors);
  } catch (error) {
    console.error('Sensor scan error:', error);
    document.getElementById('sensor-results').innerHTML = 
      '<div class="error-box">Scan failed. You can add sensors later from Settings.</div>';
  }
}

function skipSensors() {
  localStorage.setItem('sensors_skipped', 'true');
  nextStep();
}
```

---

#### **Step 9: Activity Hub QR Code** (KEEP, FROM CURRENT STEP 6)
*Unchanged - already implemented perfectly*

---

#### **Step 10: Complete** (KEEP)
**What to update:**
- Add checklist of what was completed
- Show quick-start actions
- Link to video tutorials

**Enhanced UI:**
```html
<div class="wizard-step" id="step-10">
  <h1 class="step-title">🎉 Setup Complete!</h1>
  <p class="step-description">
    Your GreenReach farm is ready for operation!
  </p>
  
  <div class="completion-checklist">
    <h3>✅ What You've Set Up</h3>
    <ul class="checklist">
      <li id="check-password">✓ Secure password created</li>
      <li id="check-profile">✓ Farm profile configured</li>
      <li id="check-layout">✓ Room and zones created</li>
      <li id="check-trays">✓ Tray formats defined</li>
      <li id="check-qr-labels">⚠️ QR labels (print soon!)</li>
      <li id="check-sensors">⚠️ Sensors (optional)</li>
      <li id="check-activity-hub">✓ Activity Hub ready on iPad</li>
    </ul>
  </div>
  
  <div class="next-steps-card">
    <h3>🚀 Next Steps</h3>
    <ol>
      <li><strong>Print QR Labels</strong> (if you skipped earlier)</li>
      <li><strong>Register Your First Trays</strong> - Use Activity Hub on iPad</li>
      <li><strong>Seed Your First Crop</strong> - Scan tray, select recipe</li>
      <li><strong>Track Growth</strong> - Update status as crops mature</li>
      <li><strong>Record Harvest</strong> - Scan tray when ready</li>
    </ol>
  </div>
  
  <div class="resources-card">
    <h3>📚 Resources</h3>
    <ul>
      <li><a href="/docs/tray-tracking.html" target="_blank">Tray Tracking Guide</a></li>
      <li><a href="/docs/activity-hub.html" target="_blank">Activity Hub Tutorial</a></li>
      <li><a href="https://www.youtube.com/watch?v=..." target="_blank">Video: Your First Week</a></li>
    </ul>
  </div>
  
  <div class="button-grid">
    <button class="touch-button primary large" onclick="completeSetup()">
      <span>Go to Dashboard →</span>
    </button>
  </div>
</div>
```

---

## Implementation Priority

### Phase 1: Critical (Week 1)
1. ✅ **Password Change** - Already implemented
2. ✅ **Activity Hub QR** - Already implemented  
3. **Room/Zone Setup** - Add Step 3 (NEW)
4. **Tray Formats** - Add Step 4 (NEW)

### Phase 2: Important (Week 2)
5. **QR Label Printing Guide** - Add Step 5 (NEW)
6. **Enhanced Completion** - Update Step 10 checklist

### Phase 3: Nice-to-Have (Week 3)
7. **Sensor Pairing** - Add Step 8 (OPTIONAL)
8. **Video Tutorials** - Embed in completion screen

---

## API Endpoints Needed

### New Endpoints for Wizard

```javascript
// Room & Zone Creation
POST /api/setup-wizard/create-room
{
  "farmId": "FARM-001",
  "roomName": "Grow Room A",
  "zoneCount": 2
}

// Tray Format Bulk Creation
POST /api/setup-wizard/create-tray-formats
{
  "farmId": "FARM-001",
  "formats": [
    { "name": "128-Cell", "plantSiteCount": 128, "systemType": "nft" },
    { "name": "200-Cell", "plantSiteCount": 200, "systemType": "nft" }
  ]
}

// Sensor Scan (Already exists, just expose in wizard)
POST /api/hardware/scan-sensors
{
  "farmId": "FARM-001",
  "timeout": 30000
}

// Setup Completion Tracking
POST /api/setup-wizard/complete
{
  "farmId": "FARM-001",
  "stepsCompleted": {
    "password": true,
    "profile": true,
    "rooms": true,
    "trayFormats": true,
    "qrLabels": false,
    "sensors": false,
    "activityHub": true
  }
}
```

---

## User Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│ PURCHASE COMPLETE                                           │
│ - Email sent with temp password                            │
│ - Redirected to LE-login.html                              │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│ LOGIN                                                       │
│ - Enter temp password                                      │
│ - JWT token issued                                         │
│ - Redirect to setup-wizard.html (first-time users)        │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 0: Create Password (SECURITY)                         │
│ - Change temp password to secure password                  │
│ - Minimum 8 characters                                     │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 1: Welcome                                            │
│ - Overview of 10-step process                             │
│ - Estimated time: 15 minutes                              │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 2: Farm Registration                                  │
│ - Pre-filled from purchase                                │
│ - Farm name, contact, email                               │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 3: Farm Layout (NEW)                                  │
│ - Create first room                                        │
│ - Define zones (1-5)                                       │
│ - Foundation for inventory tracking                        │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 4: Tray Formats (NEW)                                 │
│ - Select tray types (128, 200, 288 cell)                  │
│ - Create custom formats (optional)                         │
│ - Required for Activity Hub operations                     │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 5: QR Label Printing (NEW)                            │
│ - Explain QR label system                                  │
│ - Link to generator tool                                   │
│ - Can skip and do later                                    │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 6: Certifications                                     │
│ - GAP, Organic, Food Safety                                │
│ - Practices (pesticide-free, non-GMO)                      │
│ - Attributes (woman-owned, family farm)                    │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 7: Desktop App (OPTIONAL)                             │
│ - Show desktop app info                                    │
│ - macOS and Windows available                              │
│ - Can skip                                                  │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 8: Sensor Pairing (NEW, OPTIONAL)                     │
│ - Ask if user has sensors                                  │
│ - If YES → Scan and pair                                   │
│ - If NO → Skip                                              │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 9: Activity Hub QR Code                               │
│ - Generate QR with auth token                              │
│ - iPad scanning instructions                               │
│ - Bookmark for future access                               │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 10: Complete                                          │
│ - Show completion checklist                                │
│ - Display next steps                                       │
│ - Link to resources and tutorials                          │
│ - Redirect to dashboard                                    │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│ DASHBOARD                                                   │
│ - Ready to use all features                                │
│ - Activity Hub paired and functional                       │
│ - Trays ready to register and scan                         │
└─────────────────────────────────────────────────────────────┘
```

---

## Recommended Changes Summary

### What to ADD:
1. **Step 3: Room/Zone Setup** - Critical foundation
2. **Step 4: Tray Formats** - Required for operations
3. **Step 5: QR Printing Guide** - Practical necessity
4. **Step 8: Sensor Pairing** - Optional but valuable

### What to KEEP:
- Step 0: Password creation ✅
- Step 1: Welcome ✅
- Step 2: Farm registration ✅
- Step 6: Certifications ✅ (moved)
- Step 7: Desktop app ✅ (make optional)
- Step 9: Activity Hub QR ✅
- Step 10: Completion ✅

### What to ENHANCE:
- Make desktop app step clearly optional
- Add completion checklist showing what's done
- Add skip options for QR printing and sensors
- Link to video tutorials in completion screen

---

## Success Metrics

### User Completion Rates (Goals)
- **Complete wizard:** >90%
- **Create at least 1 room:** >95%
- **Create at least 1 tray format:** >95%
- **Generate QR labels:** >70%
- **Pair sensors:** >30% (optional)
- **Setup Activity Hub:** >85%

### Time to First Operation
- **Goal:** Users scan first tray within 1 week of setup
- **Current:** Unknown (no tracking)
- **Measure:** Days between wizard completion and first tray scan

### Support Tickets Reduction
- **Target:** 50% reduction in "How do I..." tickets
- **Focus areas:** Tray setup, QR printing, Activity Hub access

---

## Conclusion

The current setup wizard is good for account creation but **lacks practical operational setup**. New users complete the wizard but then struggle with:
1. "How do I track trays?" → Need tray formats first
2. "Where do I get QR codes?" → Not explained in wizard
3. "Why can't I scan trays?" → No tray formats created
4. "How do I use Activity Hub?" → QR setup is good, but needs context

**Recommended priority:** Add Steps 3-5 (rooms, tray formats, QR printing) immediately. These are **critical** for basic operations. Sensor pairing can wait for Phase 2.
