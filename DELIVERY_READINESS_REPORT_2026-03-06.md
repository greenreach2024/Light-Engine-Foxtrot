# Farm-to-Door Delivery — Readiness Report

**Date:** 2026-03-06  
**Scope:** Full-stack review of all delivery code, UI, data models, and live endpoints  
**Prior Audit:** DELIVERY_SERVICE_AUDIT_REPORT_2026-02-22.md (12 days ago)  
**Verdict:** NOT READY — 4 Critical blockers, 14 High-severity issues

---

## 1. Feature Inventory

### Files Involved (34 files)

| Layer | File | Lines | Role |
|-------|------|-------|------|
| **Backend — LE** | `routes/farm-sales/delivery.js` | 1,109 | Primary multi-tenant delivery API (settings, windows, zones, quote, schedule, tracking, routes) |
| **Backend — LE** | `routes/farm-sales/fulfillment.js` | ~416 | Delivery manifest CSV generation |
| **Backend — LE** | `routes/farm-sales/orders.js` | — | Order schema with `DELIVERY` channel enum |
| **Backend — LE** | `routes/farm-sales/subscriptions.js` | — | Subscription plans with `delivery_day` |
| **Backend — LE** | `routes/edge-wholesale-webhook.js` | 479 | Accepts delivery fields on incoming wholesale orders |
| **Backend — Central** | `routes/admin-delivery.js` | 383 | Admin CRUD for delivery config, zones, drivers, fees, readiness |
| **Backend — Central** | `routes/farm-sales.js` | 694 | Duplicate delivery config endpoints (lines 272-411) |
| **Backend — Central** | `routes/wholesale.js` | — | Wholesale delivery quote endpoint |
| **Data** | `greenreach-central/config/database.js` | — | DDL for `farm_delivery_settings`, `farm_delivery_windows`, `farm_delivery_zones` |
| **Data** | `lib/database.js` | — | Duplicate DDL (structurally identical, minor timestamp type diff) |
| **Data** | `lib/farm-store.js` | — | In-memory `FarmScopedStore` for deliveries (no persistence) |
| **Frontend — Central Admin** | `GR-central-admin.html` | — | Delivery Management View (L4184-4327) |
| **Frontend — Central Admin** | `central-admin.js` | — | `loadDeliveryManagement()`, zone/driver render, settings save |
| **Frontend — Farm Admin** | `LE-farm-admin.html` | — | Delivery Settings card (L3561-3595) |
| **Frontend — Farm Admin** | `farm-admin.js` | — | `loadDeliverySettings()`, `saveDeliverySettings()` |
| **Frontend — D2C Shop** | `farm-sales-shop.html` | — | Delivery checkout (fulfillment method, address, date, window) |
| **Frontend — D2C Store** | `farm-sales-store.html` | — | POS delivery fields |
| **Frontend — Wholesale** | `GR-wholesale.html` | — | Full delivery checkout with address, zone lookup, quote |
| **Frontend — Wholesale** | `js/wholesale.js` | 2,600 | Delivery quote flow, zone mapping, fee display |
| **Frontend — Wholesale** | `wholesale.html` | — | Legacy wholesale with delivery fields |
| **Frontend — Marketing** | `wholesale-about.html` | — | "Farm-to-Door Delivery" marketing section |
| **Frontend — Marketing** | `js/components/service-intro-banner.js` | 145 | "New: Farm-to-Door Delivery" promotional banner |
| **Docs** | 5 markdown files | 1,597 | Architecture plan, implementation plan, task list, audit, review |

### Database Tables (PostgreSQL)

| Table | Purpose | Status |
|-------|---------|--------|
| `farm_delivery_settings` | Per-farm config (enabled, base_fee, min_order, lead_time, max_per_window) | Created ✅ |
| `farm_delivery_windows` | Per-farm time windows (morning/afternoon/evening with start/end times) | Created ✅ |
| `farm_delivery_zones` | Per-farm zones with fee, min_order, postal_prefix | Created ✅ |
| `delivery_orders` | Actual delivery records (schedule, tracking, status) | **MISSING** ❌ |
| `delivery_routes` | Optimized route records | **MISSING** ❌ |
| `delivery_drivers` | Driver records with status, availability | **MISSING** ❌ |

### Feature Flag

| Variable | Default | Location |
|----------|---------|----------|
| `DELIVERY_ENABLED` | `true` (enabled) | `routes/farm-sales/delivery.js` L18 |
| `WHOLESALE_DELIVERY_ENABLED` | `true` (enabled) | `routes/wholesale.js` L240 |

---

## 2. Architecture Assessment

```
┌──────────────────────────────┐     ┌──────────────────────────────┐
│   GreenReach Central         │     │   Light Engine (Foxtrot)     │
│                              │     │                              │
│  admin-delivery.js           │     │  delivery.js (primary)       │
│   - Config CRUD              │     │   - Settings (DB ✅)         │
│   - Zones (DB ✅)            │     │   - Windows (DB ✅)          │
│   - Drivers (RAM ❌)         │     │   - Zones (DB ✅)            │
│   - Fees (stub ❌)           │     │   - Quote (DB ✅)            │
│   - Readiness                │     │   - Schedule (RAM ❌)        │
│                              │     │   - Tracking (RAM ❌)        │
│  farm-sales.js (duplicate)   │     │   - Routes (RAM ❌)          │
│   - Config GET/PUT           │     │                              │
│   - Windows PUT              │     │  fulfillment.js              │
│                              │     │   - Manifest CSV             │
│  wholesale.js                │     │                              │
│   - Delivery quote           │     │                              │
│   (hardcoded zones ❌)       │     │                              │
└──────────────────────────────┘     └──────────────────────────────┘
         ▲                                      ▲
         │                                      │
    ┌────┴────────────────────┐    ┌────────────┴──────────────┐
    │ Central Admin UI        │    │ D2C Shop / Store / POS    │
    │  - View zones ✅        │    │  - Method selector ✅     │
    │  - View drivers ✅      │    │  - Address field ✅       │
    │  - Save settings ✅     │    │  - Quote/fee ❌           │
    │  - Add zone (stub ❌)   │    │  - Fee in total ❌        │
    │  - Add driver (stub ❌) │    │  - Min order check ❌     │
    │  - Edit zone (stub ❌)  │    │                           │
    │  - Edit driver (stub ❌)│    │                           │
    └─────────────────────────┘    └───────────────────────────┘
                                              ▲
    ┌─────────────────────────┐               │
    │ Wholesale Checkout      │    ┌──────────┴──────────────┐
    │  - Method selector ✅   │    │ Farm Admin UI           │
    │  - Address form ✅      │    │  - Enable toggle ✅     │
    │  - Zone lookup ✅       │    │  - Base fee/min ✅      │
    │  - Quote display ✅     │    │  - Window editor ✅     │
    │  - Fee in checkout ⚠️   │    │  - Add window ❌        │
    └─────────────────────────┘    │  - Zone config ❌       │
                                   └─────────────────────────┘
```

---

## 3. Critical Findings (4)

### C-1: All Delivery Records Lost on Every Deploy

**Severity:** CRITICAL  
**Files:** `lib/farm-store.js` L215, `routes/farm-sales/delivery.js` L56-57

The `deliveries` FarmScopedStore has no `persistPath` — all scheduled deliveries live purely in-memory. The `routes` Map for optimized delivery routes is also in-memory only. **Every deploy, restart, or crash wipes all delivery data.**

- Scheduled deliveries: gone
- Delivery tracking status: gone
- Optimized routes: gone
- Route ID sequence resets to 100 (ID collisions across restarts)

**Impact:** A customer schedules a delivery, farm deploys a code update → delivery record vanishes. No tracking, no proof of order.

**Fix required:** Create `delivery_orders` and `delivery_routes` PostgreSQL tables with proper schema. Migrate all reads/writes from in-memory stores to DB.

---

### C-2: Race Condition in Delivery Scheduling

**Severity:** CRITICAL  
**File:** `routes/farm-sales/delivery.js` L770-840

`POST /schedule` checks window availability via `getWindowAvailability()`, then writes the delivery as a separate step. Two concurrent requests for the last available slot **can both pass the check and both succeed**, exceeding `max_deliveries_per_window`.

There is no database lock, no atomic decrement, no `SELECT ... FOR UPDATE`.

**Impact:** A window with `max_deliveries_per_window: 20` could end up with 21+ deliveries booked.

**Fix required:** Wrap availability check + delivery insert in a PostgreSQL transaction with row-level locking (`SELECT ... FOR UPDATE` on the window/slot counter).

---

### C-3: Duplicate `GET /zones` Route Handler

**Severity:** CRITICAL  
**File:** `routes/farm-sales/delivery.js` L487 + L761

Two `router.get('/zones', ...)` handlers exist. The first (L487) queries `farm_delivery_zones` from the database. The second (L761) ignores the DB entirely and returns hardcoded `DELIVERY_ZONES` constants (`zone_a: $0, zone_b: $5, zone_c: $10`). Express matches the first registered handler, making the second dead code — but its presence indicates incomplete migration. If middleware ordering changes, the wrong handler could win.

**Fix required:** Remove the dead second handler at L761.

---

### C-4: Driver Storage is 100% In-Memory

**Severity:** CRITICAL  
**File:** `greenreach-central/routes/admin-delivery.js` L32-40, L256-290

`deliveryConfig.drivers` is a plain JavaScript array. There is no `delivery_drivers` database table. **Every deploy wipes all driver records.** Adding 5 drivers, deploying a CSS fix → all drivers gone.

**Fix required:** Create `delivery_drivers` PostgreSQL table. Migrate CRUD operations to DB.

---

## 4. High-Severity Findings (14)

| # | Finding | File(s) | Impact |
|---|---------|---------|--------|
| **H-1** | **D2C checkout never shows/charges delivery fee** — `farm-sales-shop.html` and `farm-sales-store.html` have method selectors and address fields but never call the `/quote` endpoint. Total = subtotal + tax only. Customers selecting "Home Delivery" get free delivery. | `farm-sales-shop.html`, `farm-sales-store.html` | Revenue loss — delivery is free |
| **H-2** | **D2C checkout has no minimum order enforcement** for delivery. A $2 order can request home delivery. | `farm-sales-shop.html`, `farm-sales-store.html` | Below-cost deliveries |
| **H-3** | **Scheduler validates zones against hardcoded constants only** — ignores farm's DB-backed custom zones. A farm with custom zones gets `invalid_zone` on every schedule request. | `delivery.js` L793 | Custom zones unusable |
| **H-4** | **Scheduler validates time slots against hardcoded windows only** — doesn't check if the window is actually *active* for the farm. A farm with only `morning` active will accept `evening` bookings. | `delivery.js` L785 | Phantom time slots |
| **H-5** | **No delivery status transition validation** — `PATCH /:deliveryId` accepts any status change. `delivered → scheduled` is allowed. No state machine. | `delivery.js` L890-940 | Invalid state transitions |
| **H-6** | **Central admin zone/driver CRUD are stub `alert()`s** — `showAddZoneModal()`, `showAddDriverModal()`, `editDeliveryZone()`, `editDriver()`, `toggleDriverStatus()` all show browser alerts. No API calls. Admin can view but not manage. | `central-admin.js` L10490-10513 | Admin cannot manage zones/drivers |
| **H-7** | **Stats/fees endpoints return hardcoded zeros** — `deliveryConfig.stats` is initialized to all zeros and never updated. `GET /fees` always returns `{ deliveries_30d: 0, revenue_30d: 0 }`. | `admin-delivery.js` L35-42 | KPI dashboard is useless |
| **H-8** | **Readiness check ignores zones** — `ready = enabled && active_windows > 0` but a farm with no zones configured shows as "ready" even though scheduling would fail. | `admin-delivery.js` L340-365 | False positives |
| **H-9** | **Wholesale quote uses hardcoded zones, not DB** — `DELIVERY_ZONE_RULES` in `wholesale.js` is a hardcoded copy (`zone_a: $0, zone_b: $5, zone_c: $10`). If a farm customizes zones in the DB, wholesale checkout returns stale fees. | `wholesale.js` L208-212 | Fee mismatch between channels |
| **H-10** | **Wholesale quote uses global env vars, not per-farm settings** — `WHOLESALE_DELIVERY_BASE_FEE` and `WHOLESALE_DELIVERY_MIN_ORDER` are process-wide. All farms get the same base fee. | `wholesale.js` L240-242 | Multi-tenant fee leakage |
| **H-11** | **Client-side zone mapping is hardcoded Ontario/Quebec only** — `getDeliveryZoneFromPostal()` maps first letter of Canadian postal code: M/H→ZONE_A, L/N/K→ZONE_B, else→ZONE_C. BC, Alberta, Atlantic provinces all get ZONE_C (Rural, $10). Zone should be determined server-side. | `wholesale.js` L1027+ | Wrong zones for non-ON/QC customers |
| **H-12** | **CSV manifest has CSV injection vulnerability** — Field values (customer names, addresses, instructions) are concatenated without escaping commas, quotes, or newlines. A value starting with `=`, `+`, `-`, `@` is a CSV injection vector when opened in Excel. | `fulfillment.js` L385-410 | Security — Excel formula injection |
| **H-13** | **Farm admin has no "Add Window" button** — can only edit existing windows returned by API. If API returns empty, the editor is blank with no way to add windows. | `LE-farm-admin.html` L3561-3595 | New farms cannot configure windows |
| **H-14** | **Delivery data accepted but never processed on webhook orders** — `edge-wholesale-webhook.js` accepts `delivery_method`, `delivery_address`, `delivery_fee` but no code path reads these fields for routing, scheduling, or fee reconciliation. | `edge-wholesale-webhook.js` L44-63 | Wholesale delivery orders are dead data |

---

## 5. Medium-Severity Findings (15)

| # | Finding | File(s) |
|---|---------|---------|
| M-1 | Default window times diverge: LE uses 8-12/12-4/4-8, Central uses 6-10/11-3/4-8 | `delivery.js` vs `farm-sales.js` |
| M-2 | Window bulk upsert has no transaction — partial failure = inconsistent state | `delivery.js` L192-205 |
| M-3 | Route optimization is naive zone-group with hardcoded 15min/stop, 3mi between stops | `delivery.js` L990-1060 |
| M-4 | `normalizeWindowsInput` silently drops unknown window IDs — no error feedback | `delivery.js` L211-226 |
| M-5 | Schema divergence: Central `PUT /config` uses COALESCE (preserves nulls), LE uses explicit merge | `farm-sales.js` vs `delivery.js` |
| M-6 | `ensureDeliveryTables()` called on every read request (CREATE TABLE IF NOT EXISTS per GET) | `farm-sales.js` L286 |
| M-7 | `DELETE /zones/:id` reads `farm_id` from body — unreliable for DELETE requests | `admin-delivery.js` L234 |
| M-8 | No input validation on `base_fee`/`min_order` ranges — negative values accepted | `admin-delivery.js` L96-106 |
| M-9 | Driver ID uses `Date.now().toString(36)` — not unique under concurrent requests | `admin-delivery.js` L273 |
| M-10 | Response envelope inconsistency: wholesale returns `{ status: 'ok', data }`, LE returns `{ ok: true, eligible }` | `wholesale.js` vs `delivery.js` |
| M-11 | No FK constraints — orphan windows/zones can exist for farms without settings | `database.js` |
| M-12 | `start_time`/`end_time` are VARCHAR(10), not TIME — no DB-level validation of `25:99` | `database.js` |
| M-13 | Missing index on `farm_delivery_zones(postal_prefix)` — zone lookup does LIKE scan | `database.js` |
| M-14 | Delivery manifest reads from `orders`, not `deliveries` — systems are disconnected | `fulfillment.js` |
| M-15 | Farm admin `toggleDeliveryFields` listener added inside `loadDeliverySettings()` — duplicate listeners on re-call | `farm-admin.js` |

---

## 6. What Works Today

| Component | Status | Notes |
|-----------|--------|-------|
| **DB-backed settings** (CRUD) | ✅ Working | `farm_delivery_settings` table with proper upsert |
| **DB-backed windows** (CRUD) | ✅ Working | `farm_delivery_windows` table with upsert |
| **DB-backed zones** (CRUD) | ✅ Working | `farm_delivery_zones` table with soft-delete |
| **Farm admin settings UI** | ✅ Working | Enable/disable, base fee, min order, save button |
| **Farm admin windows editor** | ⚠️ Partial | Can edit existing windows, cannot add new ones |
| **Wholesale checkout UX** | ✅ Working | Method selector, address form, zone lookup, quote display, time slots |
| **Wholesale delivery quote API** | ⚠️ Partial | Works but uses hardcoded zones, not DB |
| **Feature flag** | ✅ Working | `DELIVERY_ENABLED=false` returns 503 on all LE endpoints |
| **"New: Farm-to-Door Delivery" banner** | ✅ Working | Dismissible, localStorage-backed |
| **Marketing page** | ✅ Working | wholesale-about.html#delivery section |
| **Central admin view (read-only)** | ⚠️ Partial | Can view zones/drivers/fees. All management buttons are stubs. |
| **Central admin settings save** | ✅ Working | PUT to /api/admin/delivery/config works |

---

## 7. What Does NOT Work

| Component | Status | Blocker Level |
|-----------|--------|---------------|
| Delivery scheduling (POST /schedule) | Validates against hardcoded zones/windows, stores in RAM | Critical |
| Delivery tracking (GET/PATCH /:id) | Data in RAM, lost on restart | Critical |
| Route optimization | In-memory Map, naive algorithm, no persistence | Critical |
| Driver management | In-memory array, lost on restart | Critical |
| D2C delivery fee display | Never fetched, never charged | High |
| D2C minimum order check | Not implemented | High |
| Admin zone CRUD (add/edit/delete) | `alert()` stubs | High |
| Admin driver CRUD (add/edit/toggle) | `alert()` stubs | High |
| Stats & KPI dashboard | Hardcoded zeros | High |
| Wholesale webhook delivery processing | Accepted and ignored | High |
| Delivery manifest CSV | No escaping, injection risk | High |

---

## 8. Comparison with Feb 22 Audit

| Feb 22 Finding | Status Today |
|----------------|--------------|
| F-1: Landing page promises features that don't exist (driver portal, background checks, Stripe) | **UNCHANGED** — `delivery-platform.html` still exists with unfulfilled promises. However, it is not prominently linked. |
| F-2: In-memory storage for settings/windows | **FIXED** ✅ — Settings, windows, zones now use PostgreSQL |
| F-3: In-memory storage for deliveries/routes | **UNCHANGED** ❌ — Still 100% RAM |
| F-4: No multi-tenant isolation in routes Map | **UNCHANGED** ❌ — `routes` Map is global, tenant-isolated only by filtering on farm_id field |
| Task list Slice 2 "NEEDS REWORK" | **Marked complete** — DB-backed settings/windows verified |
| Task list Slice 3 "NEEDS REWORK" | **Marked complete** — Quote reads from DB for zones, but wholesale quote still hardcoded |
| Validation & Quality Gate | **NOT DONE** — No items checked off |
| Deployment Gate | **NOT TRIGGERED** — No approval given |

---

## 9. Risk Matrix

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Customer books delivery, deploy wipes record | **Certain** (every deploy) | **Critical** — lost order, no tracking | Persist to PostgreSQL |
| Two customers book same last slot | **Likely** (concurrent access) | **High** — overbooked window | Transaction + row lock |
| D2C customer gets free delivery | **Certain** (no fee in checkout) | **High** — revenue loss on every delivery order | Wire quote API to D2C checkout |
| Admin adds drivers, deploy wipes them | **Certain** (every deploy) | **High** — operational disruption | Persist drivers to PostgreSQL |
| Wholesale customer in BC gets wrong zone/fee | **Likely** (hardcoded ON/QC mapping) | **Medium** — incorrect pricing | Server-side zone determination |
| CSV manifest opened in Excel triggers formula | **Possible** | **Medium** — security risk | Escape CSV fields properly |

---

## 10. Recommended Remediation Priority

### Phase 1 — Critical Fixes (Required Before Any Customer Use)

| Priority | Task | Effort | Files |
|----------|------|--------|-------|
| **P0** | Create `delivery_orders` PostgreSQL table + migrate scheduling/tracking from RAM to DB | 4-6h | `delivery.js`, `database.js`, `config/database.js` |
| **P0** | Create `delivery_routes` PostgreSQL table + migrate route optimization from RAM to DB | 2-3h | `delivery.js`, `database.js` |
| **P0** | Create `delivery_drivers` PostgreSQL table + migrate driver CRUD from RAM to DB | 2-3h | `admin-delivery.js`, `database.js` |
| **P0** | Add transaction + row lock to `POST /schedule` (atomic slot reservation) | 1-2h | `delivery.js` |
| **P0** | Remove duplicate `GET /zones` handler at L761 | 15min | `delivery.js` |

### Phase 2 — High-Priority Fixes (Required Before D2C Launch)

| Priority | Task | Effort | Files |
|----------|------|--------|-------|
| **P1** | Wire `/quote` API into D2C shop + store checkouts; display fee; add to total | 3-4h | `farm-sales-shop.html`, `farm-sales-store.html` |
| **P1** | Add minimum order enforcement for delivery to D2C checkouts | 1h | Same |
| **P1** | Make scheduler validate against DB-backed zones and active windows | 2h | `delivery.js` |
| **P1** | Implement delivery status state machine (scheduled→assigned→en_route→delivered) | 1-2h | `delivery.js` |
| **P1** | Wire admin zone/driver CRUD modals to actual API calls | 3-4h | `central-admin.js`, `GR-central-admin.html` |
| **P1** | Implement real stats aggregation for delivery KPIs | 2h | `admin-delivery.js` |
| **P1** | Fix wholesale quote to read zones from DB, not hardcoded constants | 1h | `wholesale.js` |
| **P1** | Fix CSV manifest escaping + CSV injection protection | 1h | `fulfillment.js` |

### Phase 3 — Medium-Priority Improvements

| Priority | Task | Effort |
|----------|------|--------|
| **P2** | Unify default window times between LE and Central | 30min |
| **P2** | Add transactions to bulk window upserts | 1h |
| **P2** | Move zone determination server-side (from client postal code) | 2h |
| **P2** | Add "Add Window" button to farm admin UI | 1h |
| **P2** | Validate `start_time < end_time` and no overlaps in window editor | 1h |
| **P2** | Add FK constraints and `postal_prefix` index to delivery tables | 30min |
| **P2** | Remove or gate `delivery-platform.html` landing page | 30min |

---

## 11. Verdict

### Overall Readiness: NOT READY — 4 Critical Blockers

```
Feature Completeness:     ████████░░░░░░░░░░░░  40%
Backend Stability:        ██████░░░░░░░░░░░░░░  30%  (RAM-only for core data)
Frontend Completeness:    ████████████░░░░░░░░  60%  (Wholesale good, D2C incomplete)
Data Integrity:           ████░░░░░░░░░░░░░░░░  20%  (3 missing tables, race condition)
Admin Tooling:            ████████░░░░░░░░░░░░  40%  (read-only; CRUD stubs)
Production Confidence:    ████░░░░░░░░░░░░░░░░  20%
```

**The foundational plumbing is in place** — PostgreSQL tables for settings/windows/zones, feature flags, farm-scoped auth, and a solid wholesale checkout flow. But the runtime data layer (deliveries, routes, drivers) is entirely in-memory, meaning the system cannot reliably operate through a single deploy cycle.

**Recommended path:** Complete Phase 1 (critical DB migration, ~10-14h) before enabling for any customer. Phase 2 (~15-18h) before D2C launch. The wholesale channel is closest to ready and could be launched first after Phase 1.

---

*Report generated from live code review of `recovery/feb11-clean` branch, commit `a2a4a21`.*
