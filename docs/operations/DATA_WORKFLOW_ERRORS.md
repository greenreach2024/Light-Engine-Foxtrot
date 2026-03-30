# Data Workflow Errors — Diagnosis & Fixes

**Created:** February 10, 2026  
**Last Updated:** March 19, 2026  
**Status:** All issues addressed — see fixes below  
**Latest Issue:** #15 — Crop Pricing 401 + missing /api/ prefix (March 19, 2026)

---

## Data Architecture Overview

### Core Data Files (Source of Truth)

| File | Location | Purpose | Consumers |
|------|----------|---------|-----------|
| `groups.json` | `public/data/` | Active grow groups, plans, zone assignments | Farm Summary, Farm Inventory, Crop Pricing, Activity Hub, Heatmap |
| `farm.json` | `public/data/` | Farm identity, URL, coordinates | All pages (header), Weather, GreenReach Central |
| `rooms.json` | `public/data/` | Room & zone structure | Heatmap, Farm Inventory, Farm Summary |
| `lighting-recipes.json` | `public/data/` | 50 crop grow recipes (days, PPFD, DLI, spectrum) | Crop Pricing, Harvest Forecast, Plan Engine |
| `crop-pricing.json` | `public/data/` | Per-crop pricing (retail + wholesale tiers) | Crop Pricing page, Wholesale Catalog |
| `room-map.json` | `public/data/` | Physical room layout with zone positions | Heatmap, Farm Summary zone cards |
| `iot-devices.json` | `public/data/` | IoT sensor/controller metadata | Heatmap, Farm Summary, Equipment page |
| `plans.json` | `public/data/` | Grow plans (merged with lighting-recipes at `/plans`) | Farm Summary, Schedule Engine |

### Data Flow Chain

```
┌──────────────────────────────────────────────────────────────┐
│                     LIGHT ENGINE (Foxtrot)                   │
│                                                              │
│  Two server components in ONE system:                        │
│                                                              │
│  ┌─ server-foxtrot.js (Port 8091) ────────────────────────┐  │
│  │  Device control, sensor polling, SwitchBot, lighting    │  │
│  │  schedules, flat-file data (public/data/*.json)         │  │
│  │                                                         │  │
│  │  JSON Data Files ──→ API Routes ──→ Frontend Views      │  │
│  │  (public/data/)      /api/inventory/current             │  │
│  │                      /api/inventory/forecast             │  │
│  │                      /api/crop-pricing                   │  │
│  │                      /api/tray-formats                   │  │
│  │                      /plans                              │  │
│  └─────────────────────────────────────────────────────────┘  │
│                          │                                    │
│                          │ Sync (every 5 min)                 │
│                          ▼                                    │
│  ┌─ greenreach-central/server.js (Port 3100) ─────────────┐  │
│  │  Cloud gateway at greenreachgreens.com                   │  │
│  │  PostgreSQL multi-tenant DB, web UI, wholesale,         │  │
│  │  billing, admin APIs                                    │  │
│  │                                                         │  │
│  │  greenreach-central/public/data/ ←── synced from above  │  │
│  │  PostgreSQL ←── heartbeats, multi-farm data             │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                              │
│  Both servers share public/views/ (mirrored files).          │
│  There is NO separate "edge" product — this is one system.   │
└──────────────────────────────────────────────────────────────┘
```

### Key Field: `plan` vs `crop` vs `recipe`

The `groups.json` file uses **`plan`** as the canonical field (e.g., `"plan": "crop-bibb-butterhead"`).  
Many consumers expect a **`crop`** field (e.g., `"crop": "Bibb Butterhead"`).

**Conversion:** `extractCropDisplayName(planId)` strips `"crop-"` prefix and title-cases:
- `"crop-bibb-butterhead"` → `"Bibb Butterhead"`
- `"crop-mei-qing-pak-choi"` → `"Mei Qing Pak Choi"`

This function is now available both server-side (server-foxtrot.js) and client-side (farm-inventory.html).

---

## Issues Found & Fixes Applied

### 1. Tray Setup — Standard Trays Not Populating

**Root Cause:** The NeDB database (`data/tray-formats.db`) contained a record from the test-farm-wizard using **snake_case** fields (`tray_format_id`, `cells`, `cell_height_mm`) while the frontend expects **camelCase** (`trayFormatId`, `plantSiteCount`). Since one record existed, the auto-seed check (`formats.length === 0`) didn't trigger.

**Fix:**
- Added field normalization in `GET /api/tray-formats` endpoint to map snake_case → camelCase
- Expanded default tray formats from 2 to 8 (added 72-cell, 128-cell, NFT, tower, DWC raft, herb tray)
- Cleared corrupted NeDB file to trigger re-seeding

**Files Changed:**
- `server-foxtrot.js` — Tray format normalization & expanded defaults

---

### 2. Farm Inventory — Crop Varieties Not Populating

**Root Cause:** `farm-inventory.html` calculates unique crops via `groupsData.map(g => g.crop)` — but `groups.json` has no `crop` field, only `plan` (e.g., `"crop-bibb-butterhead"`). All values were `undefined`.

**Fix:** Updated crop counting to use: `g.crop || extractCropDisplayName(g.plan)`

**Files Changed:**
- `public/views/farm-inventory.html` — Line 711: Added `plan` field fallback

---

### 3. Farm Inventory — Group Cards Missing Variety/Location/Daily Info

**Root Cause:** Server-side inventory endpoints used `group.crop`, `group.roomId`, `group.recipe` directly — all `undefined` in the flat-file data. The forecast endpoint built `location` from `group.roomId || 'Room-1'` and `recipe` from `group.crop`.

**Fix:** Server now derives missing fields:
- `cropName = group.crop || extractCropDisplayName(group.plan) || 'Unknown'`
- `groupRoomId = group.roomId || group.room || 'Room-1'`
- `groupZoneId = group.zoneId || group.zone || 'Zone-1'`
- `recipe` field now uses derived crop name
- Harvest days now checks `VARIETY_GROW_DAYS[cropName]` fallback to `getCropHarvestDays(group.plan)`

**Files Changed:**
- `server-foxtrot.js` — `/api/inventory/current` and `/api/inventory/forecast` endpoints

---

### 4. Activity Hub — Active Trays Count Not Loading

**Root Cause:** The `/api/inventory/current` endpoint returned trays with `crop: undefined` and `recipe: undefined` due to the same missing `group.crop` field issue. The `activeTrays` count itself was correct (derived from `group.trays || 4`), but the empty crop data could cause display issues.

**Fix:** Server-side fix (same as #3) now provides proper crop names in tray records.

**Files Changed:**
- `server-foxtrot.js` — Inventory endpoint fixes (shared with #3)

---

### 5. QR Code Bulk Generator — Farm ID Not Pre-seeded

**Root Cause:** `LE-qr-generator.html` never read URL parameters or localStorage. The `farm-admin.js` constructs URLs with `?farmId=...` but the QR page ignored them.

**Fix:** Added initialization code that reads:
1. URL parameters (`?farmId=...&farmName=...`)
2. localStorage (`farmId`, `farm_id`)
3. Fallback: `fetch('/data/farm.json')`

Also auto-updates the code prefix with the farm ID.

**Files Changed:**
- `public/LE-qr-generator.html` — Added initialization block

---

### 6. Farm Summary — Group Dropdown (Working Correctly)

**Data Source:** Farm Summary uses `normalizeGroupRecord()` which resolves `planId` from 8 different possible fields:
- `record.planId`, `record.plan`, `record.planKey`, `record.plan_id`
- `planConfig.planId`, `planConfig.preview.planId`, `planConfig.preview.planKey`, `planConfig.preview.plan`

This normalization is why Farm Summary works while other pages don't. **The Farm Summary data pattern should be adopted by other consumers.**

**Key APIs used by Farm Summary:**
- `/data/groups.json` + `/data/room-map.json` + `/plans` + `/data/iot-devices.json`
- `/env?hours=24` for sensor data
- `/api/farm/profile` → fallback `/data/farm.json`

---

### 7. Heatmap — Room Not Loading + `let` Variable Error

**Root Cause:** `SyntaxError: Cannot declare a let variable twice: 'zoneId'` in `getSensorTargets()` function.

Line 1782 declares `let zoneId = sensor?.zone;` with smart fallback logic (single-zone farms).  
Line 1792 re-declares `let zoneId = sensor.zone;` — a **SyntaxError in strict mode** that crashes the entire script block. This also defeats the smart fallback logic.

**Fix:** Changed line 1792 from `let zoneId = sensor.zone;` to `zoneId = sensor.zone;` (assignment, not re-declaration).

**Files Changed:**
- `public/views/room-heatmap.html` — Line 1792: Removed duplicate `let`

---

### 8. Admin Pages — Connection Errors

**Root Cause:** Two issues:
1. `admin.js` set `API_BASE = window.location.origin.replace(':8091', ':8000')` — port 8000 is a Python backend that doesn't run by default
2. `LE-farm-admin.html` and `farm-admin.html` hardcoded `INVENTORY_API = 'http://localhost:8000/api/inventory'`
3. Missing endpoints: `/api/inventory/dashboard`, `/api/inventory/reorder-alerts`, `/api/inventory/seeds/list`, `/api/inventory/usage/weekly-summary`
4. `FARM-TEST-WIZARD-001` 404: This farm ID exists in local config but was never synced to Central's PostgreSQL `farms` table

**Fix:**
- Changed `admin.js` `API_BASE` to `window.location.origin` (uses current server)
- Changed all `INVENTORY_API` references from `localhost:8000` to `window.location.origin`
- Added 7 new endpoints to `server-foxtrot.js`: `/api/inventory/dashboard`, `/api/inventory/reorder-alerts`, `/api/inventory/seeds/list`, `/api/inventory/packaging/list`, `/api/inventory/nutrients/list`, `/api/inventory/equipment/list`, `/api/inventory/supplies/list`, `/api/inventory/usage/weekly-summary`

**Files Changed:**
- `admin.js` — Fixed API_BASE port
- `public/LE-farm-admin.html` — Fixed INVENTORY_API
- `public/farm-admin.html` — Fixed INVENTORY_API
- `greenreach-central/public/farm-admin.html` — Fixed INVENTORY_API
- `server-foxtrot.js` — Added missing inventory endpoints

---

### 9. Crop Pricing — Should Load All Grow Recipes

**Root Cause:** `crop-pricing.json` only listed 8 crops. `lighting-recipes.json` has 50 crops. No connection between the two. No indication of which crops are currently growing.

**Fix:** Enhanced `GET /api/crop-pricing` to:
1. Read all 50 crops from `lighting-recipes.json`
2. Merge with existing pricing data from `crop-pricing.json`
3. Read `groups.json` to determine which crops are currently growing
4. Return each crop with `isGrowing: true/false` and `hasPricing: true/false` flags
5. Include summary: `totalCrops`, `growingCrops`, `pricedCrops` counts

**Files Changed:**
- `routes/crop-pricing.js` — Enhanced GET endpoint

---

### 10. GreenReach Central — Not Updating with Farm Data

**Root Cause:** The sync service (`lib/sync-service.js`) only starts when `EDGE_MODE=true` and the farm is registered. The current `edge-config.json` has `"mode": "cloud"`, preventing sync. The API key format doesn't match Central's 64-hex requirement. Central has no pull mechanism.

**Fix:** Added a **pull-based sync** to Central's `server.js`:
- Every 5 minutes, Central reads `farm.json` to get the Light Engine URL
- Fetches `groups.json`, `rooms.json`, `iot-devices.json`, `room-map.json` from the edge
- Writes updated copies to `greenreach-central/public/data/`
- Added `POST /api/sync/pull-farm-data` endpoint for manual sync trigger
- Added `fs` import to Central server

**Files Changed:**
- `greenreach-central/server.js` — Added farm data sync, `fs` import

---

## Summary of All Files Changed

| File | Changes |
|------|---------|
| `server-foxtrot.js` | Added `extractCropDisplayName()`, fixed inventory endpoints, added admin inventory stubs, expanded tray defaults, added tray format normalization |
| `public/views/farm-inventory.html` | Fixed crop variety counting to use `plan` field |
| `public/views/room-heatmap.html` | Fixed `let zoneId` redeclaration |
| `public/LE-qr-generator.html` | Added farm ID pre-seeding from URL/localStorage/farm.json |
| `admin.js` | Fixed `API_BASE` from port 8000 to `window.location.origin` |
| `public/LE-farm-admin.html` | Fixed `INVENTORY_API` to use current origin |
| `public/farm-admin.html` | Fixed `INVENTORY_API` to use current origin |
| `greenreach-central/public/farm-admin.html` | Fixed `INVENTORY_API` to use current origin |
| `routes/crop-pricing.js` | Enhanced to merge all 50 recipes, mark growing crops |
| `greenreach-central/server.js` | Added pull-based farm data sync, `fs` import |

---

## 2026-03-19 — central-admin.js: 17 Bare fetch() Calls Sending Wrong Auth Token

**Date:** March 19, 2026  
**Timestamp:** 2026-03-19  
**Discovered on:** GR-central-admin.html (Farm Summary for FARM-MLTP9LVH-B0B85039)

### 11. Central Admin — Wholesale Pricing & Procurement 401 Errors

**Symptom:** Two console errors on page load:
```
Failed to load resource: 401 (current, line 0)    → /api/admin/pricing/current-prices
Failed to load resource: 401 (forecast, line 0)   → /api/admin/harvest/forecast
```

**Root Cause:** Two entire sections of `central-admin.js` (Wholesale Pricing Management and Procurement Management) used bare `fetch()` for authenticated endpoints. The globally-injected `auth-guard.js` wraps `window.fetch` and injects the farm JWT (`sessionStorage.token`), not the admin JWT (`localStorage.admin_token`). The admin endpoints reject farm JWTs, producing 401s.

This is a dual-token architecture conflict:
- Farm pages use farm JWTs (stored in `sessionStorage.token`)
- Admin pages use admin JWTs (stored in `localStorage.admin_token`)
- `auth-guard.js` always injects the farm token for any `/api/` call
- `authenticatedFetch()` explicitly sets the admin token and prevents auth-guard override

**Fix:** Replaced 17 bare `fetch()` calls with `authenticatedFetch()` across:
- 8 calls in Wholesale Pricing (loadPricingManagement, submitWholesalePrice, loadCurrentPricesIntoScanner, submitBatchPricing, cancelPriceOffer)
- 9 calls in Procurement (loadProcurementCatalog, loadProcurementSuppliers, loadProcurementRevenue, saveCatalogProduct, editCatalogProduct, deleteCatalogProduct, saveNewSupplier, editSupplier, updateSupplier)

Added null-safety checks since `authenticatedFetch()` returns null on auth failure.

**Files Changed:**
- `greenreach-central/public/central-admin.js` — 17 bare fetch() replaced with authenticatedFetch()

**Prevention Rule:** All new API calls in `central-admin.js` must use `authenticatedFetch()`, never bare `fetch()`. The auth-guard fetch wrapper will inject the wrong token for admin pages.

---

**Date:** March 19, 2026  
**Timestamp:** 2026-03-19  
**Commit:** `bde4fbf`  
**Discovered on:** room-heatmap.html (Heat Map for FARM-MLTP9LVH-B0B85039)

### 12. Heat Map — Color Gradient Not Reflecting Temperature Delta

**Symptom:** Sensor readings display correct numeric values, but the heat map renders a near-uniform color (mostly green) despite a dramatic temperature difference between sensors (one sensor moved to a cold climate).

**Root Cause:** Two compounding factors in the Gaussian RBF interpolation engine:

1. **Sigma uncapped for sparse sensors.** `computeLengthScale()` used `Math.max(avgNN * 1.2, roomDiag / 4)`. With only 2 sensors ~17 cells apart on a 20x15 grid, sigma computed to ~21 (nearly the room diagonal). This made every pixel receive near-equal weight from all sensors, collapsing the interpolated value to the room mean everywhere except within r^2 < 0.01 of a sensor marker.

2. **2.5x range expansion compressed data into 40% of palette.** `displayRange = dataRange * 2.5` mapped the actual sensor range to only 40% of the color stops. Combined with the flat interpolation, the resulting normalized values (0.47-0.53) fell in a narrow green band — visually indistinguishable.

**Combined effect:** Entire map rendered as uniform green. The ~2px ring at each sensor position showed correct colors but was hidden by the sensor marker overlay.

**Fix:**
- `computeLengthScale()`: Added upper cap `Math.min(..., roomDiag / 3)` and lowered floor from `roomDiag / 4` to `roomDiag / 6`. This preserves smooth interpolation for dense sensor arrays while preventing over-smoothing with sparse sensors.
- Range expansion: Reduced from `dataRange * 2.5` to `dataRange * 1.5` (data occupies ~67% of palette instead of 40%). Updated in both `renderHeatMap()` and the legend calculation.

**Files Changed:**
- `greenreach-central/public/views/room-heatmap.html` — computeLengthScale sigma formula, 2x displayRange calculation
- `public/views/room-heatmap.html` — identical changes (mirrored file)

**Impact:** Color rendering only. No change to sensor data extraction, numeric displays, telemetry values, zone aggregates, or any API data flow. VPD per-pixel computation unaffected (uses same interpolation engine with corrected sigma).

**Prevention Rule:** When tuning interpolation parameters, verify gradient visibility with both sparse (2 sensor) and dense (6+ sensor) configurations. The sigma cap ensures sparse layouts still produce visible gradients.

---

**Date:** March 19, 2026  
**Timestamp:** 2026-03-19  
**Commit:** `ef13d60`  
**Discovered on:** Farm Settings page (LE-farm-admin.html, Farm ID: FARM-MLTP9LVH-B0B85039)

### 13. Settings Page — "Error loading settings" + Fields Not Seeding / Not Persisting

**Original Problem (reported by user):**  
> "Audit setting page - Farm ID: FARM-MLTP9LVH-B0B85039 - Pop up error 'unable to load settings.' There are many fields that should be filled and pull from other location that are not seeding. Contact Information, Certifications & Practices, Display Preferences, System Configuration are all not seeding or persisting when I do add the data. There is no save button on this page."

**Symptom:** Settings page shows "Error loading settings" toast on load. Contact Information, Certifications & Practices, Display Preferences, System Configuration sections all appear empty. Changes entered by the user do not persist across page reloads. User could not find save buttons (page errored before full render).

**Root Cause — 3 compounding issues:**

1. **Missing DOM elements crash `loadSettings()`.** The HTML had been redesigned (Integration Settings card changed to Wholesale Marketplace, Hardware Detection and Square Status cards removed) but `loadSettings()` in `farm-admin.js` still referenced 7 removed element IDs: `greenreach-sync-enabled`, `greenreach-endpoint`, `settings-api-key`, `hardware-lights`, `hardware-fans`, `hardware-sensors`, `hardware-other`. Direct `.value =` / `.checked =` on null elements threw TypeError, caught by the function's try/catch, which showed the error toast and aborted — preventing ALL downstream field population (Display Preferences, Notifications, System Configuration, Farm Operations, API & Webhooks).

2. **No server-side persistence endpoint.** `saveSettings()` saved to `localStorage` AND attempted POST to `/data/farm-settings.json`, but no server route handled that endpoint (404). Settings were lost on cache clear or device switch. Only `saveProfileSettings()` (Contact Info) and `saveEditCertifications()` had working server persistence via `/api/setup/profile` PATCH and `/api/setup/certifications` POST respectively.

3. **Certifications edit modal HTML missing.** `openEditCertificationsModal()` and `saveEditCertifications()` referenced `editCertificationsForm` and `editCertificationsModal` elements that did not exist in the HTML. The certifications card had no Edit button, so users could not modify certifications after initial setup wizard completion.

**Fix:**
- Added null-safe DOM helpers (`setVal`, `setChk`, `setTxt`) to `loadSettings()` so missing elements are silently skipped instead of crashing. Applied same null-safety to `checkSquareStatus()`, `scanHardware()`, `openEditCertificationsModal()`, `closeEditCertificationsModal()`, and `saveEditCertifications()`.
- Added `val()`/`chk()` null-safe helpers to `saveSettings()` (mirrored copy had direct `.value`/`.checked` access without null checks).
- Added POST `/data/farm-settings.json` and GET `/data/farm-settings.json` routes in `greenreach-central/server.js` using `farmStore.set/get(fid, 'farm_settings', ...)` for server-side persistence.
- Updated `loadSettings()` to try loading from server endpoint first, falling back to localStorage.
- Added certifications edit modal HTML with checkbox forms for certifications and practices, plus an "Edit" button on the Certifications & Practices card.

**Files Changed:**
- `greenreach-central/public/farm-admin.js` — null-safe helpers in loadSettings, checkSquareStatus, scanHardware, modal functions; server-first settings load
- `greenreach-central/public/LE-farm-admin.html` — added editCertificationsModal, Edit button on certifications card
- `greenreach-central/server.js` — added POST/GET `/data/farm-settings.json` routes
- `public/farm-admin.js` — identical null-safety fixes + val/chk helpers in saveSettings (mirrored file)

**Impact:** Settings page load, field population, and persistence. No change to sensor data, telemetry, orders, or any other data flow.

**Prevention Rule:** All `document.getElementById()` calls in settings functions must use null-safe helpers. When HTML cards are removed or redesigned, the corresponding JS references must be updated in the same commit.

---

**Date:** March 19, 2026  
**Timestamp:** 2026-03-19  
**Discovered on:** Activity Hub (tray-inventory.html, Farm ID: FARM-MLTP9LVH-B0B85039)

### 14. Activity Hub — SyntaxError Kills Entire Script Block (openScanModal undefined)

**Original Problem (reported by user):**  
> "New errors in the activity hub. This hub was error free."  
> Console errors: `SyntaxError: Invalid escape in identifier: '\'` at line 4987, `ReferenceError: Can't find variable: openScanModal` at lines 1252, 1260, 1268.

**Symptom:** Three console errors on the Activity Hub page:
1. `SyntaxError: Invalid escape in identifier: '\'` at tray-inventory.html:4987
2. `ReferenceError: Can't find variable: openScanModal` at lines 1252, 1260, 1268
3. All scan buttons (Seed, Harvest, Move) non-functional

**Root Cause:** Commit `bfd42e4` ("feat: implement all readiness shortfall todos P0-P2") ran a bulk file sync ("P2.1: Sync 17 stale mirrored files from LE canonical to Central") that corrupted template literals in the `submitSeed()` function. Four lines had backslash-escaped backticks and dollar signs (`\`` and `\${`) instead of plain template literal syntax (`` ` `` and `${}`).

The corrupted lines in `greenreach-central/public/views/tray-inventory.html`:
- Line 4984: `` const res = await fetch(\`\${currentAPI}... `` (should be template literal)
- Line 5007: `` scanResult.innerHTML = \` `` (should be plain backtick)
- Line 5011: `` \${crop}\${document.getElementById... `` (should be `${...}`)
- Line 5021: `` \`; `` (should be plain `` `; ``)

The mirrored copy (`public/views/tray-inventory.html`) had one corrupted line at line 5011.

Since the entire main `<script>` block (lines 1694-6007) is parsed as a single unit, the SyntaxError at line 4984 prevented ALL functions in the block from being registered — including `openScanModal()` defined at line 4304. This single parse failure caused both the SyntaxError AND all three `ReferenceError: Can't find variable: openScanModal` errors.

**Fix:** Removed backslash escapes from all 4 lines in the central copy and the 1 affected line in the mirrored copy, restoring valid template literal syntax.

**Files Changed:**
- `greenreach-central/public/views/tray-inventory.html` — 4 lines in submitSeed() fixed
- `public/views/tray-inventory.html` — 1 line in submitSeed() fixed (mirrored file)

**Impact:** Restores Activity Hub scan functionality (Seed, Harvest, Move buttons). No change to data flow, APIs, or tray records.

**Prevention Rule:** File sync operations must not escape template literals. When mirroring files, verify no `\`` or `\${` patterns are introduced. A simple grep for `\\`` in `.html` files catches this class of corruption.

---

**Date:** March 19, 2026  
**Timestamp:** 2026-03-19  
**Discovered on:** Farm Admin page (LE-farm-admin.html, Farm ID: FARM-MLTP9LVH-B0B85039)

### 15. Crop Pricing — 401 from Missing /api/ Prefix + No Auth Headers

**Original Problem (reported by user):**  
> Console error: `401` on `crop-pricing, line 0`

**Symptom:** Console 401 error on farm admin page load when `loadCropsFromDatabase()` fires. Crop pricing falls back to localStorage instead of loading from the server API.

**Root Cause — 2 compounding issues:**

1. **Wrong URL path.** `farm-admin.js` fetched `${API_BASE}/crop-pricing` but the server route is mounted at `/api/crop-pricing`. The request to `/crop-pricing` (without `/api/`) hit no matching route on Central.

2. **No Authorization header.** The GET fetch used bare `fetch()` with no headers. On `LE-farm-admin.html` (which does NOT load `auth-guard.js`), this means no JWT is sent. The Central route at `/api/crop-pricing` requires `authMiddleware`, so even with the correct URL, the request would still 401 without a token.

The PUT fetch (save pricing) had the same URL bug and also lacked auth headers.

**Fix:**
- Changed GET URL from `${API_BASE}/crop-pricing` to `${API_BASE}/api/crop-pricing`
- Changed PUT URL from `${API_BASE}/crop-pricing` to `${API_BASE}/api/crop-pricing`
- Added `Authorization: Bearer ${currentSession.token}` header to both GET and PUT requests
- Applied to both `greenreach-central/public/farm-admin.js` and `public/farm-admin.js`

**Files Changed:**
- `greenreach-central/public/farm-admin.js` — lines 1258, 1507: URL + auth header fix
- `public/farm-admin.js` — lines 1273, 1522: identical changes (mirrored file)

**Impact:** Crop pricing now loads from server API instead of falling back to stale localStorage data. Pricing saves now persist to server.

**Prevention Rule:** All `fetch()` calls to `/api/*` routes must include the `/api/` prefix and an Authorization header. Never assume `auth-guard.js` is loaded — it is NOT present on `LE-farm-admin.html`.
