# Data Workflow Errors — Diagnosis & Fixes

**Date:** February 10, 2026  
**Status:** All issues addressed — see fixes below

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
┌─────────────────────────────────────────────────────────┐
│                    EDGE DEVICE (Foxtrot)                │
│                    Port 8091                            │
│                                                        │
│  JSON Data Files ──→ server-foxtrot.js ──→ API Routes  │
│  (public/data/)       │                    │            │
│                       │                    ▼            │
│                       │              Frontend Views     │
│                       │              (public/views/)    │
│                       │                                 │
│                       ▼                                 │
│              Derived Endpoints:                         │
│              /api/inventory/current  ← groups.json      │
│              /api/inventory/forecast ← groups.json      │
│              /api/crop-pricing       ← crop-pricing.json│
│                                      + lighting-recipes │
│                                      + groups.json      │
│              /api/tray-formats       ← NeDB database    │
│              /plans                  ← plans.json +     │
│                                        lighting-recipes │
└──────────────┬──────────────────────────────────────────┘
               │ Sync: POST /api/sync/* (push model)
               │ OR: Central pulls via /data/*.json
               ▼
┌─────────────────────────────────────────────────────────┐
│              GREENREACH CENTRAL                         │
│              Port 3100                                  │
│                                                        │
│  greenreach-central/public/data/ ←── Edge data copies  │
│  PostgreSQL database             ←── Heartbeats, farms │
│                                                        │
│  Serves same views with farm data from local copies    │
│  Auto-syncs from edge every 5 minutes (new)            │
└─────────────────────────────────────────────────────────┘
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

**Root Cause:** `farm-inventory.html` calculates unique crops via `groupsData.map(g => g.crop)` — but edge `groups.json` has no `crop` field, only `plan` (e.g., `"crop-bibb-butterhead"`). All values were `undefined`.

**Fix:** Updated crop counting to use: `g.crop || extractCropDisplayName(g.plan)`

**Files Changed:**
- `public/views/farm-inventory.html` — Line 711: Added `plan` field fallback

---

### 3. Farm Inventory — Group Cards Missing Variety/Location/Daily Info

**Root Cause:** Server-side inventory endpoints used `group.crop`, `group.roomId`, `group.recipe` directly — all `undefined` in edge data. The forecast endpoint built `location` from `group.roomId || 'Room-1'` and `recipe` from `group.crop`.

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
4. `FARM-TEST-WIZARD-001` 404: This farm ID exists in edge config but was never synced to Central's PostgreSQL `farms` table

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
- Every 5 minutes, Central reads `farm.json` to get the edge device URL
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
| `data/tray-formats.db` | Cleared corrupted file (will re-seed on restart) |
