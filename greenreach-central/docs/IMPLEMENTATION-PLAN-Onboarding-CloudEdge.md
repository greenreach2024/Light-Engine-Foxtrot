# Implementation Plan: First-Time User Onboarding & Cloud/Edge Feature Clarity

**Date:** March 13, 2026  
**Priority:** High  
**Status:** Approved for implementation

---

## Problems Identified

### 1. Contact Data Never Saved from Setup Wizard (BUG — Critical)

The setup wizard (`setup-wizard.html`) collects contact name, email, and phone in Step 2, but the data is **never persisted** due to a field name mismatch between client and server:

**Client sends:**
```json
{
  "farmId": "...",
  "farmName": "...",
  "ownerName": "John Smith",        // ← top-level field
  "contactEmail": "john@farm.com",  // ← top-level field
  "contactPhone": "555-1234",       // ← top-level field
  "rooms": [...]
}
```

**Server expects:**
```js
const { farmName, contact, location, rooms, ... } = req.body;
// contact is undefined — all contact data is silently dropped
```

**Impact:** The `farms` table in production has `contact_name = NULL` and `email` = only what was set during purchase. The Farm Profile settings page shows no contact info because it was never saved.

**Fix:** Update `POST /api/setup/complete` to also accept the flat field names the wizard sends, and write them to the `farms` table (`contact_name`, `email`) and to `farmStore` profile.

---

### 2. Farm Settings Page Missing Contact Fields (GAP)

The Settings section in `LE-farm-admin.html` (line 3202) only shows:
- Farm ID (read-only)
- Registration Code (read-only)
- Network Configuration (read-only)

**Missing fields:** Farm Name (editable), Contact Name, Email, Phone, Website, Address/Location.

After the setup wizard, users have **no way to view or edit** their contact information, farm location, or business details.

**Fix:** Add editable contact/profile fields to the Farm Settings section with a save button that calls a new `PATCH /api/setup/farm-profile` endpoint.

---

### 3. No Guided First-Time User Experience (GAP)

After the setup wizard completes and redirects to `LE-farm-admin.html`, there is:
- No onboarding checklist showing what to configure next
- No tooltips or guided tour
- No indication of which sections need attention
- The "Cheo" assistant has no setup-related guidance

The `LE-dashboard.html` (embedded as Setup/Update iframe) contains complex wizards (Bus Mapping, Payment Processing, Online Store) but no guidance on which to do first or which are relevant to cloud vs edge users.

**Fix:** Add an onboarding checklist system that tracks completion of key setup tasks and guides users through them.

---

### 4. No Cloud vs Edge Feature Clarity (GAP — Critical UX)

The platform currently serves the same UI to both cloud and edge users. There is no runtime feature gating based on `plan_type`. Users on the cloud plan see:
- "Auto-Discover Light Controllers" in setup wizard (broken — `device-scanner.js` doesn't exist)
- Bus Mapping wizard (requires physical hardware)
- Light control interfaces (not functional without Edge hardware)
- No indication of what requires an Edge upgrade

**Cloud capabilities** (should be clearly labeled):
- ✅ IoT / wired sensor monitoring
- ✅ Farm environment monitoring (read-only dashboards)
- ✅ Inventory management
- ✅ POS (Point of Sale)
- ✅ Online sales / e-commerce
- ✅ Wholesale portal access
- ✅ AI operations agent
- ✅ Grant wizard
- ✅ Sustainability tracking

**Edge-only capabilities** (should show "Edge Light Engine Required" badge):
- 🔒 Light control (LED recipes, schedules, dimming)
- 🔒 Environment management (HVAC, ventilation, CO₂ control)
- 🔒 Nutrient management (dosing, pH, EC control)
- 🔒 Auto-discover light controllers
- 🔒 Bus mapping wizard
- 🔒 Device/hardware direct control

**Fix:** Implement plan-type-aware UI that disables edge-only features for cloud users with clear "Upgrade to Edge" badges and messaging.

---

### 5. `device-scanner.js` Missing (BUG)

`setup-wizard.html` line 451 references `<script src="device-scanner.js">` but this file does not exist anywhere in the codebase. The auto-discover feature is completely broken for all users.

**Fix:** Create a stub `device-scanner.js` that works on Edge (mDNS/network scan) and shows "Edge Required" on Cloud. For the Cloud version, the scanner UI should be replaced with an informational panel explaining that auto-discovery requires the Edge hardware.

---

## Implementation Plan

### Phase 1: Fix Contact Data Bug (Day 1)

**Effort:** ~1 hour  
**Files:** `routes/setup-wizard.js`, `setup-wizard.html`

#### 1a. Fix `POST /api/setup/complete` to accept flat contact fields

```js
// In routes/setup-wizard.js, POST /complete handler:
const { farmName, contact, location, rooms, certifications, credentials, endpoints } = req.body;

// ADD: Also accept flat field names from wizard
const ownerName = req.body.ownerName || contact?.name;
const contactEmail = req.body.contactEmail || contact?.email;
const contactPhone = req.body.contactPhone || contact?.phone;

// Build normalized contact object
const normalizedContact = {
  name: ownerName || '',
  email: contactEmail || '',
  phone: contactPhone || ''
};
```

#### 1b. Write contact data to farms table

```sql
UPDATE farms 
SET setup_completed = true, 
    setup_completed_at = NOW(), 
    name = COALESCE($2, name),
    contact_name = COALESCE($3, contact_name),
    email = COALESCE($4, email)
WHERE farm_id = $1
```

#### 1c. Add `contact_phone` column to farms table

```sql
ALTER TABLE farms ADD COLUMN IF NOT EXISTS contact_phone VARCHAR(50);
```

Then also persist phone:
```sql
UPDATE farms SET ... contact_phone = COALESCE($5, contact_phone) ...
```

#### 1d. Store contact in farmStore profile

```js
const farmProfile = {
  ...existing,
  contact: normalizedContact,  // ← now populated
};
```

---

### Phase 2: Expand Farm Settings Page (Day 1-2)

**Effort:** ~2-3 hours  
**Files:** `public/LE-farm-admin.html`, `public/farm-admin.js` or inline JS

#### 2a. Add editable fields to Settings section

Add to `section-settings` in `LE-farm-admin.html` after the read-only Farm ID/Registration Code block:

| Field | ID | Type | Source |
|-------|----|------|--------|
| Farm Name | `settings-farm-name` | text | `farms.name` |
| Contact Name | `settings-contact-name` | text | `farms.contact_name` |
| Email | `settings-contact-email` | email | `farms.email` |
| Phone | `settings-contact-phone` | tel | `farms.contact_phone` |
| Website | `settings-website` | url | farmStore profile |
| Address | `settings-address` | text | farmStore profile |
| City | `settings-city` | text | farmStore profile |
| Province/State | `settings-province` | text | farmStore profile |
| Plan Type | `settings-plan-type` | badge (read-only) | `farms.plan_type` |

#### 2b. Create `GET /api/setup/profile` endpoint

Returns full farm profile data for the settings page:

```json
{
  "farmId": "FARM-...",
  "name": "GreenReach Greens",
  "contactName": "Peter Gilbert",
  "email": "peter@example.com",
  "phone": "555-1234",
  "website": "https://...",
  "address": { "street": "", "city": "", "province": "", "country": "CA" },
  "planType": "cloud",
  "setupCompleted": true,
  "createdAt": "2026-03-13T..."
}
```

#### 2c. Create `PATCH /api/setup/profile` endpoint

Accepts partial updates and writes to both `farms` table and `farmStore`.

#### 2d. Wire `loadSettings()` to populate new fields

Update the existing `loadSettings()` function to call `GET /api/setup/profile` and populate all new fields.

#### 2e. Wire `saveSettings()` to persist changes

Update `saveSettings()` to collect all field values and call `PATCH /api/setup/profile`.

---

### Phase 3: First-Time Onboarding Checklist (Day 2-3)

**Effort:** ~3-4 hours  
**Files:** `public/LE-farm-admin.html`, new `public/js/onboarding-checklist.js`, `routes/setup-wizard.js`

#### 3a. Define onboarding tasks

| # | Task | How to Check Completion | Cloud | Edge |
|---|------|------------------------|-------|------|
| 1 | ✅ Complete setup wizard | `farms.setup_completed = true` | ✅ | ✅ |
| 2 | Update farm profile (contact, location) | `farms.contact_name IS NOT NULL AND farms.email IS NOT NULL` | ✅ | ✅ |
| 3 | Add at least one grow room | `rooms count > 0` | ✅ | ✅ |
| 4 | Set display preferences (units, timezone) | farmStore `display_prefs` exists | ✅ | ✅ |
| 5 | Configure payment processing | farmStore `payment_configured = true` | ✅ | ✅ |
| 6 | Set up online store | farmStore `store_configured = true` | ✅ | ✅ |
| 7 | Add inventory items | `inventory count > 0` | ✅ | ✅ |
| 8 | Install Activity Hub (iPad) | farmStore `activity_hub_installed = true` | ✅ | ✅ |
| 9 | Connect light controllers | farmStore `controllers_connected = true` | ❌ | ✅ |
| 10 | Run bus mapping | farmStore `bus_mapped = true` | ❌ | ✅ |

#### 3b. Create `GET /api/setup/onboarding-status` endpoint

Returns completion status for all applicable tasks based on plan_type:

```json
{
  "planType": "cloud",
  "completedCount": 3,
  "totalCount": 8,
  "tasks": [
    { "id": "setup_wizard", "label": "Complete setup wizard", "completed": true, "link": "/setup-wizard.html" },
    { "id": "farm_profile", "label": "Update farm profile", "completed": false, "link": "#settings" },
    ...
  ]
}
```

#### 3c. Onboarding checklist UI

A persistent, collapsible panel that appears on the dashboard when not all tasks are complete:

- Shows progress bar (e.g., "3 of 8 steps complete")
- Each task is a clickable link to the relevant section
- Completed tasks show green checkmark
- Incomplete tasks show circle outline
- "Dismiss" option after 80%+ complete
- Stores dismissal in localStorage

#### 3d. AI Assistant (Cheo) — Add setup awareness

Add setup-related patterns to `farm-assistant.js`:

```js
// New patterns for Cheo to recognize:
"how do I set up" → Check onboarding status, suggest next incomplete task
"what should I do next" → Same
"help me get started" → Walk through onboarding checklist
"how do I add a room" → Navigate to Setup/Update section
"set up payments" → Navigate to Payment Processing wizard
"configure store" → Navigate to Online Store wizard
```

---

### Phase 4: Cloud vs Edge Feature Gating (Day 3-4)

**Effort:** ~4-5 hours  
**Files:** Multiple frontend files, `routes/setup-wizard.js`, new `public/js/plan-features.js`

#### 4a. Create plan feature registry (`public/js/plan-features.js`)

```js
const PLAN_FEATURES = {
  cloud: {
    monitoring: true,        // Sensor/IoT monitoring
    inventory: true,         // Inventory management
    pos: true,               // Point of sale
    onlineSales: true,       // E-commerce
    wholesale: true,         // Wholesale portal
    aiAgent: true,           // AI operations agent
    grantWizard: true,       // Grant application wizard
    sustainability: true,    // ESG & sustainability tracking
    activityHub: true,       // iPad activity hub
    
    lightControl: false,     // LED control
    envControl: false,       // HVAC/ventilation control
    nutrientControl: false,  // Dosing/pH/EC control
    deviceScanner: false,    // Auto-discover controllers
    busMapping: false,       // Bus mapping wizard
    hardwareControl: false,  // Direct device control
  },
  edge: {
    // All cloud features plus:
    lightControl: true,
    envControl: true,
    nutrientControl: true,
    deviceScanner: true,
    busMapping: true,
    hardwareControl: true,
  }
};
```

#### 4b. Inject plan_type into frontend

The `GET /api/setup/status` endpoint already returns `planType`. Ensure this is stored in localStorage on login/setup for frontend checks:

```js
localStorage.setItem('plan_type', data.farm.planType);
```

#### 4c. Setup Wizard — Cloud/Edge differentiation

**Step 3 (Grow Rooms & Light Controllers):**

For **cloud** users:
- Hide "Auto-Discover Light Controllers" section entirely
- Show info box: "💡 Light controller management requires Light Engine Edge. Your cloud plan includes environment monitoring, inventory, POS, and online sales."
- Room creation still works (rooms are used for inventory, monitoring, etc.)
- Remove light controller dropdown from room cards
- Add "Upgrade to Edge" CTA link

For **edge** users:
- Show auto-discover section (once `device-scanner.js` is implemented)
- Show light controller assignment in room cards
- Full functionality

#### 4d. LE-Dashboard — Feature badges

In `LE-dashboard.html`, add visual indicators to the navigation/wizard cards:

```html
<!-- Cloud-available feature -->
<div class="feature-card">
  <span class="badge badge-cloud">☁️ Cloud</span>
  <h3>Payment Processing</h3>
  ...
</div>

<!-- Edge-only feature -->
<div class="feature-card feature-locked">
  <span class="badge badge-edge">🔒 Edge Required</span>
  <h3>Bus Mapping</h3>
  <p>Map and configure light controller channels</p>
  <div class="upgrade-overlay">
    <p>Upgrade to Light Engine Edge for hardware control</p>
    <a href="/purchase.html?upgrade=edge" class="btn-upgrade">Upgrade Now</a>
  </div>
</div>
```

#### 4e. Settings page — Plan type display

Add a plan type badge to the settings page:

```html
<div class="plan-badge plan-cloud">
  ☁️ Light Engine Cloud
  <small>Monitoring • Inventory • POS • Sales</small>
</div>
<!-- or -->
<div class="plan-badge plan-edge">
  ⚡ Light Engine Edge  
  <small>Full control • Lighting • Environment • Nutrients</small>
</div>
```

With an "Upgrade to Edge" button for cloud users.

#### 4f. Navigation menu items — Edge badges

In `LE-farm-admin.html`, add small badges next to nav items that require Edge:

```
📊 Dashboard
🌱 Grow Rooms
📦 Inventory
💰 POS
🛒 Online Store
🔧 Setup/Update
⚙️ Settings
💡 Light Control     🔒 Edge
🌡️ Environment      🔒 Edge
🧪 Nutrients         🔒 Edge
```

---

### Phase 5: Create `device-scanner.js` (Day 4)

**Effort:** ~2-3 hours  
**Files:** New `public/device-scanner.js`

#### 5a. Cloud version (stub)

When `planType === 'cloud'`:
- `scanLightControllers()` immediately returns empty array
- `renderScanButton()` returns an "Edge Required" info panel instead of a scan button
- No network requests attempted

#### 5b. Edge version (functional)

When `planType === 'edge'`:
- Calls `GET /api/devices/scan` on the edge server
- Edge server performs mDNS/network scan for GROW3 and DMX controllers
- Returns discovered devices with IP, port, protocol, manufacturer
- Renders scan button and device list

#### 5c. Server endpoint `GET /api/devices/scan`

Only active in edge deployment mode:
```js
router.get('/scan', (req, res) => {
  if (process.env.DEPLOYMENT_MODE === 'cloud') {
    return res.json({ devices: [], message: 'Device scanning requires Light Engine Edge' });
  }
  // Perform network scan...
});
```

---

### Phase 6: AI Assistant Setup Integration (Day 5)

**Effort:** ~2-3 hours  
**Files:** `public/js/farm-assistant.js`

#### 6a. Add onboarding awareness to Cheo

```js
// New command patterns:
const SETUP_PATTERNS = [
  { match: /set\s*up|get\s*started|first\s*time|new\s*here|help\s*me\s*start/i,
    handler: 'showOnboardingStatus' },
  { match: /what.*next|what.*do|todo|to-do/i,
    handler: 'suggestNextTask' },
  { match: /add.*room|create.*room|new.*room/i,
    handler: 'navigateToRoomSetup' },
  { match: /payment|square|pay/i,
    handler: 'navigateToPaymentSetup' },
  { match: /store|online.*sale|e-?commerce/i,
    handler: 'navigateToStoreSetup' },
  { match: /inventory|stock|product/i,
    handler: 'navigateToInventory' },
  { match: /upgrade|edge|light.*engine/i,
    handler: 'showUpgradeInfo' },
];
```

#### 6b. Proactive first-time greeting

When `setup_completed` is recent (< 24 hours) and user opens dashboard, Cheo pops up:

> "Welcome to GreenReach! 🌱 I'm Cheo, your farm assistant. You've completed the initial setup — great start! Here's what I'd suggest doing next:
> 
> 1. **Update your farm profile** with contact details and location
> 2. **Set up payment processing** to accept orders
> 3. **Add your first inventory items**
> 
> Type 'help' anytime to see what I can do!"

#### 6c. Context-aware suggestions

When user navigates to a section for the first time, Cheo offers a brief explanation:
- First visit to Inventory: "This is where you manage your produce. Add items with crop type, quantity, and quality scores."
- First visit to POS: "Set up your register here. You'll need to configure Square payment processing first."
- First visit to Settings: "Don't forget to set your timezone and display preferences!"

---

## File Change Summary

| File | Changes |
|------|---------|
| `routes/setup-wizard.js` | Fix contact data persistence, add profile GET/PATCH endpoints, add onboarding-status endpoint |
| `public/setup-wizard.html` | Cloud/edge differentiation on Step 3, hide auto-discover for cloud |
| `public/LE-farm-admin.html` | Expand settings with contact fields, add plan badge, add onboarding checklist panel, add edge badges to nav |
| `public/farm-admin.js` (or inline) | Wire loadSettings/saveSettings for new fields |
| `public/js/farm-assistant.js` | Add setup patterns, onboarding awareness, proactive greeting |
| `public/js/plan-features.js` | NEW — Plan feature registry |
| `public/js/onboarding-checklist.js` | NEW — Onboarding checklist widget |
| `public/device-scanner.js` | NEW — Device scanner (cloud stub + edge functional) |
| `public/LE-dashboard.html` | Add edge-required badges to Bus Mapping and hardware wizards |
| `config/database.js` | Add `contact_phone` column migration |

---

## Deployment Order

1. **Phase 1** → Deploy immediately (bug fix, data integrity)
2. **Phase 2** → Deploy with Phase 1 (settings page expansion)
3. **Phase 3** → Deploy next (onboarding UX improvement)
4. **Phase 4** → Deploy with Phase 3 (cloud/edge clarity)
5. **Phase 5** → Deploy after Phase 4 (device scanner)
6. **Phase 6** → Deploy last (AI assistant, least urgent)

---

## Testing Checklist

- [ ] Complete setup wizard as new cloud user → verify contact data saved to DB
- [ ] Open Settings page → verify contact fields populated
- [ ] Edit contact fields in Settings → verify saved
- [ ] Onboarding checklist appears on first login
- [ ] Checklist correctly reflects completed/incomplete tasks
- [ ] Cloud user sees "Edge Required" badges on light control features
- [ ] Cloud user cannot access auto-discover in setup wizard
- [ ] Edge user sees full functionality (when edge is available)
- [ ] Cheo greets first-time user with setup guidance
- [ ] Cheo responds to "what should I do next" with checklist status
- [ ] Plan badge shows correctly in Settings
- [ ] "Upgrade to Edge" CTAs link to purchase page

---

*GreenReach Central — Onboarding & Cloud/Edge Implementation Plan*
