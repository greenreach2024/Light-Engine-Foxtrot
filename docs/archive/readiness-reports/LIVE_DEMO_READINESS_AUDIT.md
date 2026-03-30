# Live Demo Readiness Audit — Full Workflow Assessment

**Date**: 2026-02-12  
**Scope**: Tray registration → Seeding → Transfer → Harvest → Inventory → QR → Labels → Wholesale Sales  
**Purpose**: Confidence assessment for large-scale live demo  

---

## Executive Summary

The Light Engine Foxtrot system has a **functional wholesale marketplace** (buyer registration, catalog, checkout) and a **working inventory derivation** system from farm grow data. However, **critical gaps exist** in the middle of the pipeline — the tray lifecycle (registration, seeding, moving) consists of demo stubs, harvest does NOT feed wholesale inventory, and the checkout-to-farm notification link is broken. QR code scanning and label printing infrastructure is built but has integration mismatches.

### Verdict: NOT READY for live demo without targeted fixes

| Workflow Stage | Status | Demo Risk |
|---|---|---|
| Tray Registration | **BROKEN** — field mismatch, stub endpoint | BLOCKER |
| Seeding | **BROKEN** — stub, redirects to wrong page | BLOCKER |
| Transfer / Move | **BROKEN** — Quick Move route doesn't exist | BLOCKER |
| Group Management | **WORKS** — CRUD, lighting recipes | LOW RISK |
| Harvest Countdown | **WORKS** — calculated from seeding dates | LOW RISK |
| Harvest Execution | **PARTIAL** — two disconnected systems | MEDIUM |
| Wholesale Inventory | **WORKS** — derived from groups.json | LOW RISK |
| QR Code Generation | **WORKS** — bulk PDF + pairing QR | LOW RISK |
| QR Code Scanning | **PARTIAL** — pairing format mismatch | MEDIUM |
| Label Printing | **PARTIAL** — thermal labels work, harvest labels 404 | MEDIUM |
| Buyer Registration/Login | **WORKS** | LOW RISK |
| Catalog/Cart/Checkout | **WORKS** — but payment is stubbed | LOW RISK |
| Farm Order Notification | **BROKEN** — `base_url` vs `api_url` + missing auth | BLOCKER |
| Inventory Reservation via Checkout | **BROKEN** — same root cause | BLOCKER |
| Order Fulfillment | **DISCONNECTED** — webhook points to self | HIGH |

---

## Section 1: Tray Registration

### Current State: BROKEN

**Endpoint**: `POST /api/trays/register` — [server-foxtrot.js](server-foxtrot.js#L17968)

**Critical Bug — Field Mismatch**:  
The frontend (tray-setup.html, mobile app) sends `{ qrCodeValue, trayFormatId }`.  
The backend expects `{ trayId, format, plantCount }`.  
Result: Every registration returns **400 Bad Request** ("Missing required: trayId, format, plantCount").

**Demo Stub**: Even if fields matched, the handler is a stub that returns a canned response without writing to `traysDB`. Comment on line 17972: *"Demo mode - return registration success"*.

**Impact**: No trays can be registered in the system. The entire tray lifecycle cannot begin.

### Recommendation
- Fix field mapping to accept `qrCodeValue` as `trayId` and `trayFormatId` as `format`
- Replace stub with real `traysDB.insert()` call
- Priority: **MUST FIX before demo**

---

## Section 2: Seeding

### Current State: BROKEN

**Endpoint**: `POST /api/trays/:trayId/seed` — [server-foxtrot.js](server-foxtrot.js#L17989)

**Stub**: Returns success response without creating a `tray_run` record. No crop/recipe association is stored.

**UI Bug**: The "Seed Tray" button in Activity Hub calls `openScanModal('seed')` which on scan redirects to `/views/tray-setup.html?tray={code}` — this is the **registration** page, not a seeding page. There is no dedicated seeding UI flow.

**Impact**: Seeding data is never persisted. Harvest countdown and tray lifecycle tracking cannot work from real data.

### Recommendation
- Implement real tray-run creation in the seed endpoint (write to `trayRunsDB`)
- Create a seeding UI flow or modify tray-setup.html to handle both registration and seeding
- Priority: **MUST FIX before demo**

---

## Section 3: Transfer / Move Tray

### Current State: BROKEN

**Quick Move Bug**: The Activity Hub's "Quick Move" feature (two-step scan: tray QR → position QR) calls `POST /api/tray-runs/:id/move` — **this route does not exist** in server-foxtrot.js.

**Standard Move**: Redirect to `/views/tray-inventory.html?move={code}` but the move handler page has no backend to call.

**Tray Placements**: `POST /api/tray-placements` does exist ([server-foxtrot.js](server-foxtrot.js#L18081)) but it's also a stub returning demo data.

**Impact**: Trays cannot be physically tracked or moved between grow positions.

### Recommendation
- Implement `POST /api/tray-runs/:id/move` endpoint with real `trayPlacementsDB` writes
- Priority: **MUST FIX before demo** (unless move tracking is excluded from demo scope)

---

## Section 4: Group Management

### Current State: WORKS

**Endpoints** (all in server-foxtrot.js):
| Endpoint | Status |
|---|---|
| `GET /api/groups` | Works — reads groups.json |
| `POST /api/groups` | Works — creates group, writes back |
| `PUT /api/groups/:id` | Works — updates group |
| `DELETE /api/groups/:id` | **MISSING** — no delete endpoint |

**Lighting Recipes**: Full CRUD at `/api/lighting-recipes`, `/api/lighting-recipes/assignments`. Working.

**Duplicate Routes**: Two separate `/api/groups` GET handlers at different lines returning different schemas (one returns `{ groups: [...] }`, the other returns raw array). First registered wins.

### Recommendation
- Add `DELETE /api/groups/:id` endpoint
- Remove or reconcile duplicate route registration
- Priority: **NICE TO HAVE** — groups work for demo purposes

---

## Section 5: Harvest Countdown

### Current State: WORKS

Groups in `groups.json` have `seedDate`, `daysToHarvest`, and optional `harvestDate` fields. The frontend calculates days remaining from `seedDate + daysToHarvest - today`.

**AI Prediction Stub**: `POST /api/harvest/prediction` exists but returns mock data. Not blocking.

### Recommendation
- No changes needed for demo
- Priority: **NO ACTION REQUIRED**

---

## Section 6: Harvest Execution

### Current State: PARTIAL — Two Disconnected Systems

**System A — Node.js Harvest Log** (`POST /api/harvest`):
- Appends to `public/data/harvest-log.json`
- Does NOT create wholesale inventory
- Does NOT update groups.json
- Does NOT interact with the tray system

**System B — Python Tray Harvest** (`POST /api/tray-runs/{id}/harvest`):
- Updates tray run status to 'harvested'
- Generates lot code
- Records harvest weight
- Called by Activity Hub QR scanner's "Record Harvest" action

**Gap**: Neither system creates wholesale inventory. Wholesale inventory is **derived from living groups** in groups.json (a forecast), not from actual harvest output. This means:
- Harvesting a group doesn't add product to the wholesale catalog
- Harvesting a group doesn't reduce the living inventory forecast either
- There is no "harvested goods → saleable inventory" pipeline

**Impact**: For demo purposes, the wholesale catalog shows projected inventory from growing groups, which is actually fine for a demo. But it's not real harvested inventory.

### Recommendation
- For demo: Acceptable as-is (projected inventory works)
- Post-demo: Build harvest → wholesale inventory pipeline
- Priority: **ACCEPTABLE FOR DEMO** with explanation

---

## Section 7: Wholesale Inventory

### Current State: WORKS

**Foxtrot Endpoint**: `GET /api/wholesale/inventory` — [routes/wholesale-sync.js](routes/wholesale-sync.js#L190)
- Reads `groups.json`, calculates `qty_available` from tray count × plant density × yield estimate
- Subtracts active reservations and confirmed deductions
- Returns SKUs like `SKU-ROMAINE-5LB`

**Three Parallel Inventory Systems**:
1. **Groups-based virtual inventory** (wholesale-sync.js) — Used for wholesale catalog. **Primary system.**
2. **Farm supplies in-memory** (server-foxtrot.js) — Seeds, nutrients, etc. Lost on restart.
3. **farmStores multi-tenant** (server-foxtrot.js) — Another in-memory system for multi-farm.

Only system #1 feeds the wholesale catalog. Systems #2 and #3 are isolated.

### Recommendation
- No changes needed for demo (system #1 works)
- Post-demo: Consolidate inventory systems
- Priority: **NO ACTION REQUIRED**

---

## Section 8: QR Code Operations

### Current State: WORKS with format mismatch

**QR Generation**: Bulk QR PDF generator (`POST /api/qr-generator/generate`) works. Creates 4×6 grid PDF sheets, pre-registers codes in `tray_codes` table. Frontend at `LE-qr-generator.html`.

**QR Scanning**: Activity Hub uses `html5-qrcode` library for camera scanning. Two independent scanners:
- Pairing scanner — authenticates tablet to farm
- Action scanner — tray QR for seed/harvest/move operations

**Pairing Format Mismatch**:
- `activity-hub-qr.html` generates URL format: `?pair=token|farmId|farmName`
- `tray-inventory.html` pairing scanner expects: `DEVICE_PAIR|token|farmId|name`
- `farm-admin.js` generates the correct `DEVICE_PAIR|...` format

**Impact**: Pairing works if QR is generated from farm-admin dashboard. Fails if generated from `activity-hub-qr.html`.

**Tray Setup**: No camera scanner — manual text entry only. Users must type QR code unless using USB scanner.

### QR Code Formats in Use

| Type | Format | Example |
|---|---|---|
| Tray QR | `FARM-TRAY-{0001}` | `FARM-TRAY-0042` |
| Position QR | `{farmId}-{group}-L{n}` | `DEMO-FARM-RoomA-L5` |
| Pairing (admin) | `DEVICE_PAIR\|{JWT}\|{farmId}\|{name}` | `DEVICE_PAIR\|eyJ...\|GR-00001\|Demo Farm` |
| Harvest label | `LOT:{lotCode}` | `LOT:LOT-2024-001` |
| Packing label | `ORDER:{id}\|LOTS:{lots}\|BUYER:{name}` | Complex multi-field |

### Recommendation
- Fix `activity-hub-qr.html` to use `DEVICE_PAIR|...` format (or make scanner handle both)
- Priority: **FIX IF demoing tablet pairing via QR page**

---

## Section 9: Label Printing

### Current State: PARTIAL

**Thermal Printer API** (`routes/thermal-printer.js`): **WORKS**
- ZPL/EPL label generation for tray, harvest, and packing labels
- USB (via `lp`) and network TCP (port 9100) printing
- Job queue with status tracking
- Mounted at `/api/printer/`

**Python Label API** (`backend/labels.py`): **NOT CONNECTED**
- FastAPI app generating HTML harvest/packing labels with QR codes
- **NOT mounted in server-foxtrot.js** — runs as a separate Python process
- The `printHarvestLabel()` function in `tray-inventory.html` calls `/api/labels/harvest` which returns **404** on the Node.js server

**Batch Print Script** (`scripts/batch-print-labels.js`): Works for initial farm setup.

### Recommendation
- For demo: Use thermal printer API directly (it works)
- Fix `printHarvestLabel()` to use `/api/printer/print-harvest` instead of `/api/labels/harvest`
- Or: Mount Python labels.py behind a proxy in server-foxtrot.js
- Priority: **FIX IF demoing harvest label printing**

---

## Section 10: Wholesale Sales Flow

### Current State: FRONT HALF WORKS, BACK HALF BROKEN

#### What Works:
1. **Buyer registration** → JWT issued, in-memory + PostgreSQL backup
2. **Buyer login** → bcrypt auth, account lockout protection
3. **Catalog browsing** → aggregated from registered network farms every 5 min
4. **Checkout preview** → allocates cart items from farm inventory cache
5. **Checkout execute** → creates order record, returns order ID
6. **Order history** → buyer can list their orders
7. **Admin order management** → admin can list/update orders

#### What's Broken:

**CRITICAL BUG #1 — Farm Notification Never Fires**:
- [wholesale.js line 1204](greenreach-central/routes/wholesale.js#L1204): `if (!farm?.base_url) continue;`
- Network farms store uses `api_url`, not `base_url`
- `farm.base_url` is **always undefined** → the notification loop **silently skips ALL farms**
- Result: Orders exist in Central, but farms are NEVER notified

**CRITICAL BUG #2 — Missing Auth Headers**:
- Even if `base_url` were fixed, the `notify()` function at [line 1182](greenreach-central/routes/wholesale.js#L1182) sends no `X-Farm-ID` / `X-API-Key` headers
- Farm's `wholesaleAuthMiddleware` would reject the request with 401/403

**Result**: The entire checkout → farm → fulfillment pipeline is disconnected.

**Other Issues**:
- Square payment processing is **completely stubbed** (always returns success)
- Cart is not persisted (lost on page refresh)
- Fulfillment webhook URL defaults to `localhost:8091` (self) instead of Central
- Activity Hub orders page uses isolated empty Maps — no data from checkout flows in
- `GET /api/wholesale/orders/pending` on Central returns empty (stub shadows real route)
- `GET /api/wholesale/inventory` on Central returns empty (stub before real routes)

### Recommendation
- Fix `base_url` → `api_url` in checkout notification loop
- Add auth headers to farm notification calls
- Priority: **MUST FIX before demo** (if demoing order flow to farms)

---

## Section 11: Inventory Reservation System

### Current State: WORKS in isolation, DISCONNECTED from checkout

**New system** (wholesale-sync.js): Fully functional with real inventory validation, file-based persistence, 24-hour TTL, confirm/release/rollback operations.

**Old system** (wholesale-reservations.js): In-memory mock with hardcoded `available = 100`. Still mounted but not used by checkout.

**Disconnection**: Checkout tries to call farm reservations but fails due to `base_url` bug (Section 10). The reservation system has been validated by the smoke test task when called directly with proper auth headers.

### Recommendation
- Will work once Section 10 bugs are fixed
- Priority: **BLOCKED BY Section 10 fixes**

---

## Consolidated Bug List

### BLOCKERS (Must fix for any demo)

| # | Component | Bug | File | Fix Complexity |
|---|---|---|---|---|
| B1 | Tray Registration | Field mismatch: frontend sends `qrCodeValue`/`trayFormatId`, backend expects `trayId`/`format`/`plantCount` | server-foxtrot.js:17968 | 30 min |
| B2 | Tray Registration | Stub — never writes to database | server-foxtrot.js:17972 | 1 hr |
| B3 | Seeding | Stub — never creates tray_run record | server-foxtrot.js:17989 | 1 hr |
| B4 | Seeding UI | "Seed Tray" redirects to registration page, not seeding flow | tray-inventory.html:4633 | 2 hr |
| B5 | Quick Move | Route `POST /api/tray-runs/:id/move` doesn't exist | N/A (missing) | 2 hr |

### BLOCKERS (Must fix if demoing wholesale order-to-farm flow)

| # | Component | Bug | File | Fix Complexity |
|---|---|---|---|---|
| B6 | Farm Notification | `farm.base_url` should be `farm.api_url` — notifications never fire | wholesale.js:1204 | 15 min |
| B7 | Farm Notification | Missing `X-Farm-ID`/`X-API-Key` auth headers on farm calls | wholesale.js:1182-1196 | 30 min |

### HIGH (Should fix for demo)

| # | Component | Bug | File | Fix Complexity |
|---|---|---|---|---|
| H1 | Harvest Labels | `printHarvestLabel()` calls Python endpoint not mounted in Node.js → 404 | tray-inventory.html:4766 | 30 min |
| H2 | Packing Labels | activity-hub-orders.js constructs `/api/labels/packing` (Python-only) → 404 | activity-hub-orders.js:544 | 30 min |
| H3 | Fulfillment Webhook | `GREENREACH_WEBHOOK_URL` defaults to self (8091) not Central (3100) | wholesale-fulfillment.js:43 | 10 min |
| H4 | Activity Hub Orders | Uses isolated empty Maps — no data from checkout | activity-hub-orders.js:53 | 4 hr |
| H5 | Stub Shadow | `GET /api/wholesale/orders/pending` stub returns empty before real route | server.js:995 (Central) | 15 min |

### MEDIUM (Cosmetic / edge cases)

| # | Component | Bug | File | Fix Complexity |
|---|---|---|---|---|
| M1 | QR Pairing | activity-hub-qr.html encodes URL format, scanner expects `DEVICE_PAIR\|` format | activity-hub-qr.html:302 | 30 min |
| M2 | Tray Setup | No camera scanner — manual QR code text entry only | tray-setup.html:611 | 2 hr |
| M3 | Catalog stub | `if (true \|\| ...)` permanently bypasses DB catalog path | wholesale.js:228 | 5 min |
| M4 | Inventory stub | Central's `GET /api/wholesale/inventory` returns empty array | server.js:1731 | 10 min |
| M5 | Duplicate routes | Two `/api/groups` GET handlers with different response schemas | server-foxtrot.js | 15 min |
| M6 | Group delete | No `DELETE /api/groups/:id` endpoint | Missing | 30 min |
| M7 | Cart persistence | Shopping cart lost on page refresh (no localStorage) | wholesale.js (Central) | 30 min |

### LOW (Technical debt)

| # | Component | Bug | File |
|---|---|---|---|
| L1 | Old reservations | Hardcoded `available = 100` mock still mounted | wholesale-reservations.js:63 |
| L2 | In-memory stores | Buyer data, orders, payments lost on server restart without DB | wholesaleMemoryStore.js |
| L3 | Payment stub | Square payment always returns success | squarePaymentService.js:14 |
| L4 | Setup QR | External API dependency (api.qrserver.com) — fails offline | routes/setup.js:570 |
| L5 | Mobile scanner | `trayRunId: scanData` with TODO "parse actual tray run ID" | ScannerScreen.js:41 |
| L6 | Loss events | Don't reduce wholesale inventory | Architectural gap |
| L7 | AI prediction | Harvest prediction is stubbed | Stub |

---

## Demo Scenario Recommendations

### Scenario A: "Full Pipeline Demo" (Tray → Sale)
**Requires fixing**: B1-B7, H1-H2  
**Estimated effort**: 10-12 hours  
**Risk**: Medium — lots of moving parts  

### Scenario B: "Grow Operations Demo" (Group → Harvest)
**Requires fixing**: None (use group management directly, skip tray registration)  
**What to show**: Create groups → assign recipes → monitor countdown → record harvest (Python endpoint) → view harvest log  
**Risk**: Low  

### Scenario C: "Wholesale Marketplace Demo" (Browse → Buy)
**Requires fixing**: B6-B7 (for farm notification), or skip farm notification and show Central only  
**What to show**: Register buyer → browse catalog → add to cart → checkout → view order history → admin view  
**Risk**: Low-Medium  

### Scenario D: "QR + Label Demo" (Print → Scan → Track)
**Requires fixing**: M1 (pairing format), H1 (harvest label)  
**What to show**: Generate QR PDFs → pair tablet → scan tray → print thermal label  
**Risk**: Medium  

### Recommended Demo Path (Safest)
Combine **Scenario B + C** while fixing **B6-B7** only:
1. Show group management (create grow group, assign recipe, view countdown)
2. Show wholesale catalog (populated from groups)
3. Show buyer portal (register, browse, checkout)
4. Show admin dashboard (order management, buyer management)
5. Show thermal label printing (if printer available)

This path avoids all tray registration/seeding stubs and gives a credible end-to-end impression.

---

## Architecture Notes

### Data Flow (Current Reality)
```
groups.json (manual entry)
    ↓
wholesale-sync.js (derives SKUs from tray count × yield)
    ↓
Foxtrot GET /api/wholesale/inventory
    ↓
Central wholesaleNetworkSync (polls every 5 min)
    ↓
Central GET /api/wholesale/catalog (aggregated)
    ↓
Buyer SPA (GR-wholesale.html)
    ↓
Checkout Preview → Execute → Order in memory + DB
    ✗ (BROKEN: farm notification never fires)
    ✗ (BROKEN: inventory never reserved via checkout)
```

### Data Flow (Intended)
```
QR Code → Register Tray → Seed → Move to Position → Countdown
    ↓
Harvest → Lot Code → Wholesale Inventory
    ↓
Catalog → Cart → Checkout → Farm Notification → Reservation
    ↓
Fulfillment → Pick → Pack → Label → Ship
    ↓                                    ↓
Central Status Update          Buyer Order Tracking
```

### What Exists vs What Works

| Layer | Code Exists | Actually Works |
|---|---|---|
| Tray CRUD | Yes | No (stubs) |
| Tray Runs | Yes | Partially (Python harvest works) |
| Group Management | Yes | Yes |
| Harvest → Wholesale Inventory | No | No (architectural gap) |
| Wholesale Inventory Derivation | Yes | Yes (from groups) |
| Network Farm Discovery | Yes | Yes |
| Buyer Auth | Yes | Yes |
| Catalog/Cart | Yes | Yes |
| Checkout | Yes | Yes (Central side) |
| Farm Notification | Yes | No (2 bugs) |
| Reservation System | Yes | Yes (direct calls only) |
| Fulfillment | Yes | No (webhook misconfigured) |
| Label Printing (thermal) | Yes | Yes |
| Label Printing (harvest HTML) | Yes | No (wrong server) |
| QR Generation | Yes | Yes |
| QR Scanning | Yes | Yes (partial format issues) |
| Payment Processing | Yes | No (stubbed) |

---

## Files Referenced

| File | Purpose |
|---|---|
| [server-foxtrot.js](server-foxtrot.js) | Main Foxtrot server (25K+ lines) |
| [greenreach-central/server.js](greenreach-central/server.js) | Central marketplace server |
| [greenreach-central/routes/wholesale.js](greenreach-central/routes/wholesale.js) | Wholesale marketplace routes (buyer auth, catalog, checkout) |
| [routes/wholesale-sync.js](routes/wholesale-sync.js) | Farm inventory + reservation system |
| [routes/wholesale-reservations.js](routes/wholesale-reservations.js) | Old mock reservation system |
| [routes/wholesale-fulfillment.js](routes/wholesale-fulfillment.js) | Order fulfillment state machine |
| [routes/activity-hub-orders.js](routes/activity-hub-orders.js) | Activity Hub order management |
| [routes/qr-generator.js](routes/qr-generator.js) | Bulk QR code generation |
| [routes/thermal-printer.js](routes/thermal-printer.js) | Thermal label printing |
| [backend/labels.py](backend/labels.py) | Python harvest/packing label generation |
| [public/views/tray-inventory.html](public/views/tray-inventory.html) | Activity Hub (QR scanning, harvest, move) |
| [public/views/tray-setup.html](public/views/tray-setup.html) | Tray registration page |
| [greenreach-central/public/GR-wholesale.html](greenreach-central/public/GR-wholesale.html) | Buyer portal SPA |
| [greenreach-central/public/js/wholesale.js](greenreach-central/public/js/wholesale.js) | Buyer portal JS logic |
| [greenreach-central/services/wholesaleNetworkAggregator.js](greenreach-central/services/wholesaleNetworkAggregator.js) | Farm inventory aggregation |
| [greenreach-central/services/wholesaleMemoryStore.js](greenreach-central/services/wholesaleMemoryStore.js) | In-memory buyer/order/payment store |
| [greenreach-central/services/squarePaymentService.js](greenreach-central/services/squarePaymentService.js) | Stubbed Square payment |
