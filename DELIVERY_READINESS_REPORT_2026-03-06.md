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

## 12. Delivery Revenue Model & Driver Economics (Added 2026-03-08)

### 12.1 Revenue Streams — Current State in Code

| Stream | Rate / Amount | Code Location | Status |
|--------|---------------|---------------|--------|
| **Wholesale broker fee** (Central) | **12%** of produce subtotal | `wholesale.js:1103` → `squarePaymentService.js:44` | **Active** — collected via Square payment splits |
| **Legacy wholesale platform fee** (LE) | **10%** of order total | `wholesale-orders.js:259` | **Active** — older single-farm path |
| **Delivery zone fees** (customer-facing) | $0 / $5 / $10 by zone | `delivery.js:64-67`, `wholesale.js:208-211` | **Defined** but D2C checkout never charges (H-1). **Delivery fees are GreenReach revenue, not farm revenue.** |
| **Delivery base fee** (farm-level) | $0 default, configurable | `delivery.js:289` | **Stored in DB**, not surfaced to D2C buyer. Must route to GreenReach, not farm. |
| **Driver payouts** | — | — | **Not implemented** — no schema, no logic |
| **Tips** | — | — | **Not implemented** — no UI, no data flow |
| **Distance-based surcharges** | — | Comment at `delivery.js:866` "Phase 2" | **Not implemented** |
| **Free-delivery threshold** | — | — | **Not implemented** |

### 12.2 How Commission Is Collected (Working)

```
Customer places wholesale order:  produce subtotal = $X
                                         │
          ┌──────────────────────────────────────────┐
          │  squarePaymentService.js                 │
          │  brokerFeeCents = amountCents × 0.12     │
          │  (per farm sub-order)                    │
          └────────┬──────────────────────┬──────────┘
                   │                      │
            Farm receives            GreenReach keeps
              88% of $X               12% of $X
```

The broker fee is **embedded in the subtotal** — not a separate customer line item. Square processes one payment per farm sub-order with the broker fee split.

### 12.3 Proposed Delivery Fee Schedule (Skip-Style Model)

**Business model:** GreenReach operates as the delivery platform. Customer pays a delivery fee **to GreenReach** — farms do not receive any portion of delivery fees. GreenReach pays the driver a base rate per drop and keeps the margin. Drivers are independent contractors (1099/GST-HST responsible). Drivers receive 100% of tips.

**Minimum delivery fee: $8** (all zones). This ensures positive margin after driver payout in every zone.

| Zone | Name | Current Fee | **Proposed Fee** | Min Order (Current) | **Proposed Min Order** |
|------|------|:-----------:|:----------------:|:-------------------:|:----------------------:|
| A | Downtown / Core | $0 | **$8** | $25 | **$25** |
| B | Suburbs | $5 | **$8** | $35 | **$35** |
| C | Rural | $10 | **$12** | $50 | **$50** |

**Rationale for $8 minimum:**
- Driver base pay $5–6/drop (see §12.4) leaves $2–3 platform margin at $8 fee
- Zone A at $0 was guaranteeing a loss on every downtown delivery
- $8 is competitive with Skip ($3.99–6.99 + service fees that total ~$7–10)
- Kingston's short delivery distances (avg <10 km) make flat-fee viable

### 12.4 Driver Compensation Model

| Component | Amount | Funded By | Notes |
|-----------|--------|-----------|-------|
| **Base rate per delivery** | **$5.50** (recommended) | GreenReach from delivery fee | Flat per-drop, all zones initially. Zone-tier later if needed. |
| **Cold-chain bonus** | **+$2.00** | GreenReach from delivery fee | Drivers must maintain cooler/insulated bags. Tagged in driver profile. |
| **Distance bonus** | **Phase 2** | GreenReach from delivery fee | Per-km top-up for Rural zone (>15 km). Not built yet. |
| **Tips** | **100% to driver** | Customer | Added at checkout. GreenReach takes $0 of tips. |

**Driver does NOT pay:** No app fee, no commission deduction, no vehicle rental. Clean "earn per drop + tips" model per Skip/DoorDash norms.

### 12.5 Unit Economics — P&L Per Delivery

#### Scenario A: Zone A (Downtown), $40 order, no tip
| Line | Amount | To Whom |
|------|-------:|---------|
| Produce subtotal | $40.00 | — |
| GreenReach broker fee (12%) | +$4.80 | → GreenReach |
| Farm net payout (88%) | $35.20 | → Farm |
| Delivery fee (Zone A) | $8.00 | — |
| Driver payout (base) | −$5.50 | → Driver |
| **GreenReach delivery margin** | **$2.50** | → GreenReach |
| **GreenReach total revenue** | **$7.30** | Broker + delivery margin |

#### Scenario B: Zone B (Suburbs), $60 order, $5 tip
| Line | Amount | To Whom |
|------|-------:|---------|
| Produce subtotal | $60.00 | — |
| GreenReach broker fee (12%) | +$7.20 | → GreenReach |
| Farm net payout (88%) | $52.80 | → Farm |
| Delivery fee (Zone B) | $8.00 | — |
| Driver payout (base) | −$5.50 | → Driver |
| Tip | $5.00 | → Driver (100%) |
| **GreenReach delivery margin** | **$2.50** | → GreenReach |
| **Driver total earnings** | **$10.50** | Base + tip |
| **GreenReach total revenue** | **$9.70** | Broker + delivery margin |

#### Scenario C: Zone C (Rural), $80 order, cold-chain, $8 tip
| Line | Amount | To Whom |
|------|-------:|---------|
| Produce subtotal | $80.00 | — |
| GreenReach broker fee (12%) | +$9.60 | → GreenReach |
| Farm net payout (88%) | $70.40 | → Farm |
| Delivery fee (Zone C) | $12.00 | — |
| Driver payout (base + cold) | −$7.50 | → Driver |
| Tip | $8.00 | → Driver (100%) |
| **GreenReach delivery margin** | **$4.50** | → GreenReach |
| **Driver total earnings** | **$15.50** | Base + cold + tip |
| **GreenReach total revenue** | **$14.10** | Broker + delivery margin |

#### Break-even analysis
| | Zone A ($8) | Zone B ($8) | Zone C ($12) |
|---|:-:|:-:|:-:|
| Driver base | $5.50 | $5.50 | $5.50 |
| Cold-chain (if applicable) | +$2.00 | +$2.00 | +$2.00 |
| **GreenReach margin (no cold)** | **$2.50** | **$2.50** | **$6.50** |
| **GreenReach margin (with cold)** | **$0.50** | **$0.50** | **$4.50** |
| **Min order prevents loss?** | ✅ Yes | ✅ Yes | ✅ Yes |

At $8 minimum fee and $5.50 driver base, **no zone produces a loss** even without tips. Cold-chain Zone A is tight ($0.50 margin) — monitor volume; if cold-chain dominates Zone A, consider $9 fee.

### 12.6 Money Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│  CUSTOMER PAYS                                                  │
│                                                                 │
│  Produce subtotal ($X) + Delivery fee ($Y) + Tip ($Z)          │
│         │                      │                  │             │
│         ▼                      ▼                  ▼             │
│   ┌───────────┐         ┌───────────┐       ┌──────────┐       │
│   │  Square   │         │ GreenReach│       │  Driver   │       │
│   │  Payment  │         │  Collects │       │  Payout   │       │
│   │  Split    │         │  ALL of   │       │  Ledger   │       │
│   │           │         │  $Y       │       │           │       │
│   └─────┬─────┘         └─────┬─────┘       └────┬─────┘       │
│         │                     │                   │             │
│    ┌────┴────┐           ┌────┴────┐         ┌────┴────┐        │
│    │ Farm    │           │Platform │         │ Driver  │        │
│    │ 88%    │           │ 12% of  │         │ base +  │        │
│    │ of $X  │           │ $X  +   │         │ 100%    │        │
│    │ ONLY   │           │ 100% of │         │ of $Z   │        │
│    │($0 of  │           │$Y minus │         │         │        │
│    │ deliv.) │           │drv cost │         │         │        │
│    └────────┘           └─────────┘         └─────────┘        │
│                                                                 │
│  Farm receives $0 of delivery fee. Delivery is a GreenReach     │
│  service; farm is paid only for produce (88% of subtotal).      │
└─────────────────────────────────────────────────────────────────┘
```

### 12.7 What the Notes Propose vs. What Exists — Evaluation

| Notes Proposal | Codebase Reality | Verdict |
|---|---|---|
| Driver base rate $5–6/drop | No driver pay in schema or code | **ADD** — recommend $5.50 flat |
| Raise Zone A from $0 → $5+ | Zone A hardcoded at $0, DB default $0 | **ADD** — raise to $8 minimum |
| $15 minimum order (Skip-style) | Current: Zone A=$25, B=$35, C=$50 | **KEEP CURRENT** — existing mins are already above $15, more appropriate for produce |
| Tip field in checkout | No tip UI, no tip column in orders | **ADD** — essential for driver retention |
| Weekly driver payouts | No payout logic exists | **ADD** — use e-transfer initially, Stripe Connect later |
| Cold-chain bonus $2 | Not in code | **ADD** — tag drivers with cold-cert, add $2/drop |
| Distance bonus per km | Noted as "Phase 2" in delivery.js | **DEFER** — Kingston routes are short; flat fee works initially |
| Free delivery threshold | Not in code | **DO NOT ADD** — conflicts with $8 minimum; use promo codes instead |
| Dynamic pricing | Not in code | **DEFER** — premature without volume data |
| Autonomous scheduling | Not in code | **DEFER** — requires reliable driver pool first |

### 12.8 Agent & AI Notes — Evaluation

The user's notes also include AI agent features. Cross-referencing with codebase:

| Notes Claim | Codebase Reality | Verdict |
|---|---|---|
| T6 correlations UI — ~4h gap | **ALREADY DONE** — API + UI in `farm-summary.html:5172` (commit `d682847`) | ✅ Remove from gap list |
| T16 auto-print on harvest — ~2h gap | **ALREADY DONE** — server `auto_print:true` + client `triggerAutoHarvestLabelPrint()` (commit `d682847`) | ✅ Remove from gap list |
| T19 auto-assign lights — ~4h gap | **DONE** — UI button added to IoT manager (commit `495ffc6`) | ✅ Remove from gap list |
| T21 onboarding benchmarks — ~4h gap | **DONE** — Step 6 added to setup wizard (commit `495ffc6`) | ✅ Remove from gap list |
| "Remaining gaps are minor (~14h)" | **All 4 gaps are now closed (0h remaining)** | ✅ Corrected |
| Farm ops agent (daily todo, tool gateway, command taxonomy) | **DONE** — `routes/farm-ops-agent.js` (commit `495ffc6`) | ✅ Already deployed |
| 5 feedback loops closed | Confirmed in code: Recipe→Yield, Env→Loss, Spectrum→Quality, Timing→Efficiency, Demand→Production | ✅ Accurate |
| Experiment record system | Confirmed: harvest events → structured records → training exports | ✅ Accurate |
| Central AI push every 30 min | Confirmed in `server-foxtrot.js` AI sync loop | ✅ Accurate |
| Skills matrix, roadmap, training schema | Valid planning content, not code-testable | ✅ Include as planning reference |

### 12.9 Items From Notes — Should NOT Be Added to This Document

| Item | Reason to Exclude |
|---|---|
| Full agent architecture diagram (NLU → DM → Planner → Tool Gateway) | Already documented in `FARM_OPS_AGENT_BUILD_PLAN_2026-03-08.md` — duplication |
| Command taxonomy & sample dialogues | Already implemented in `routes/farm-ops-agent.js` `COMMAND_FAMILIES` — duplication |
| Tool-calling safety rules (abstain, two-phase commit, idempotency) | Already implemented in farm-ops-agent tool gateway — duplication |
| Training data schema & dataset sizes | Belongs in a separate ML/data doc, not delivery readiness |
| Implementation skills matrix | Planning artifact, not delivery-specific |
| Full roadmap (short/mid/long-term) | Too broad for delivery doc; keep delivery-specific phases |

### 12.10 Implementation Priorities — Delivery Revenue Pipeline

| Priority | Item | Effort | Files |
|:---------|------|:------:|-------|
| **P0** | Update `DELIVERY_ZONES` constants: Zone A fee $0→$8, Zone B $5→$8, Zone C $10→$12 | 30min | `delivery.js:64-67`, `wholesale.js:208-211` |
| **P0** | Add `pay_per_delivery` and `cold_chain_bonus` columns to `delivery_drivers` table | 30min | `database.js`, `config/database.js` |
| **P0** | Wire `/quote` API into D2C shop + store checkouts (H-1 fix) | 3–4h | `farm-sales-shop.html`, `farm-sales-store.html` |
| **P0** | Add `tip` field to checkout UI + store on order record | 2–3h | `farm-sales-shop.html`, `farm-sales-store.html`, `orders.js` |
| **P1** | Build `driver_payouts` ledger table (driver_id, delivery_id, base_amount, cold_bonus, tip, paid_at) | 2h | `database.js`, `admin-delivery.js` |
| **P1** | Calculate & record driver payout on delivery completion (base + cold bonus) | 2h | `delivery.js` |
| **P1** | Route tips to driver payout ledger (100% pass-through) | 1h | `delivery.js` |
| **P1** | Split delivery fee accounting: platform_margin = fee − driver_base − cold_bonus. **Delivery fee is 100% GreenReach revenue — farm gets $0 of it.** | 1h | `delivery.js`, `admin-delivery.js` |
| **P1** | Populate `deliveryConfig.stats` with real aggregations (replace hardcoded zeros) | 2h | `admin-delivery.js` |
| **P2** | Weekly driver earnings report endpoint (`GET /api/admin/delivery/driver-payouts`) | 3h | `admin-delivery.js` |
| **P2** | Driver earnings view in Central Admin UI | 2h | `central-admin.js`, `GR-central-admin.html` |
| **P2** | A/B test Zone A fee ($8 vs $9) with cold-chain volume monitoring | — | Ops decision |

**Total estimated effort: ~18–20h** for P0+P1 (delivery revenue pipeline operational).

### 12.11 Legal / Compliance Notes

- **Independent contractor status:** Driver enrollment page already states IC terms + tax responsibility. Ensure no employment-like controls (no mandatory shifts, no exclusivity, driver chooses which deliveries to accept).
- **GST/HST on delivery fees:** Delivery of goods is generally taxable in Ontario. Delivery fee should have HST applied. Verify with accountant.
- **Tips:** Tips are not subject to HST when they are voluntary and not added to the price of the supply (CRA policy). Ensure tip is presented as optional.
- **T4A slips:** GreenReach must issue T4A slips to IC drivers earning >$500/year. Build reporting capability.
- **Insurance:** Drivers should carry their own vehicle insurance. Consider requiring proof of insurance during enrollment (field exists on enrollment form but not enforced).

---

## 13. Implementation Strategy — Delivery Revenue Pipeline (Added 2026-03-08)

### 13.1 Execution Phases

The delivery revenue pipeline is broken into 5 phases. Each phase produces a deployable, testable increment. **No phase ships free delivery to customers** — the $8 minimum fee must be in place before D2C checkout is wired.

```
Phase 1          Phase 2          Phase 3          Phase 4          Phase 5
Schema +         D2C Checkout     Driver Payout    Admin UX         Wholesale
Fee Constants    Fee + Tip        Pipeline         + Reporting      Integration
(2h)             (6-8h)           (6h)             (5-6h)           (3-4h)
    │                │                │                │                │
    ▼                ▼                ▼                ▼                ▼
 Deployable      Fees charging    Drivers paid     Admin manages    Full channel
 no behavior     customers        per delivery     zones/drivers    coverage
 change yet      correctly        correctly        with real data   complete
```

---

### 13.2 Phase 1 — Schema & Constants (Est. 2h)

**Goal:** Update fee constants and extend DB schemas. No runtime behavior change — pure foundation.

#### Tasks

| # | Task | File(s) | Est. |
|:--|------|---------|:----:|
| **1.1** | Update `DELIVERY_ZONES` constants: Zone A fee `$0→$8`, Zone B `$5→$8`, Zone C `$10→$12` | `delivery.js:64-67` | 10min |
| **1.2** | Update `DELIVERY_ZONE_RULES` to match: Zone A `$0→$8`, Zone B `$5→$8`, Zone C `$10→$12` | `wholesale.js:208-211` | 10min |
| **1.3** | Update default `base_fee` from `$0→$8` in `getDefaultDeliverySettings()` | `delivery.js:289` | 5min |
| **1.4** | Add columns to `delivery_orders` DDL: `delivery_fee NUMERIC(10,2) DEFAULT 0`, `tip_amount NUMERIC(10,2) DEFAULT 0`, `driver_payout_amount NUMERIC(10,2) DEFAULT 0`, `platform_margin NUMERIC(10,2) DEFAULT 0` | `lib/database.js`, `greenreach-central/config/database.js` | 15min |
| **1.5** | Add columns to `delivery_drivers` DDL: `pay_per_delivery NUMERIC(10,2) DEFAULT 5.50`, `cold_chain_bonus NUMERIC(10,2) DEFAULT 2.00`, `cold_chain_certified BOOLEAN DEFAULT FALSE` | `greenreach-central/config/database.js` | 10min |
| **1.6** | Create `driver_payouts` table DDL: `id SERIAL PRIMARY KEY`, `farm_id VARCHAR(255)`, `driver_id VARCHAR(100)`, `delivery_id VARCHAR(100)`, `order_id VARCHAR(100)`, `base_amount NUMERIC(10,2)`, `cold_chain_bonus NUMERIC(10,2) DEFAULT 0`, `tip_amount NUMERIC(10,2) DEFAULT 0`, `total_payout NUMERIC(10,2)`, `payout_status VARCHAR(50) DEFAULT 'pending'` (pending/paid), `paid_at TIMESTAMP`, `payout_method VARCHAR(50)`, `created_at TIMESTAMP DEFAULT NOW()` | `lib/database.js`, `greenreach-central/config/database.js` | 15min |
| **1.7** | Run `ALTER TABLE` migrations on prod DB for existing `delivery_orders` + `delivery_drivers` (add new columns) | Manual SQL / migration script | 15min |
| **1.8** | Mirror all file changes to greenreach-central counterparts | `cp` sync | 10min |

#### Acceptance Criteria
- `node -c delivery.js` passes (syntax check)
- Server starts without error
- Existing zone CRUD, quote, schedule endpoints still work (no behavior change)
- New columns visible in DB: `SELECT column_name FROM information_schema.columns WHERE table_name = 'delivery_orders'`

---

### 13.3 Phase 2 — D2C Checkout: Fee + Tip (Est. 6–8h)

**Goal:** Customer selecting "Home Delivery" sees a delivery fee, can add a tip, and total includes both. This fixes **H-1** (free delivery) and **H-2** (no minimum enforcement).

#### Tasks

| # | Task | File(s) | Est. |
|:--|------|---------|:----:|
| **2.1** | On delivery method selection, call `POST /api/farm-sales/delivery/quote` with `{ zone, subtotal }`. Display fee in order summary row. | `farm-sales-shop.html` | 2h |
| **2.2** | Add minimum order enforcement — if `subtotal < zone.min_order`, disable checkout button, show message. | `farm-sales-shop.html` | 30min |
| **2.3** | Add tip input field: preset buttons ($0, $2, $5, Custom) below delivery fee. Store in `tip_amount`. | `farm-sales-shop.html` | 1.5h |
| **2.4** | Update order total calculation: `total = subtotal + tax + delivery_fee + tip_amount` | `farm-sales-shop.html` | 30min |
| **2.5** | Repeat 2.1–2.4 for `farm-sales-store.html` (POS variant) | `farm-sales-store.html` | 1.5h |
| **2.6** | Update order schema in `orders.js`: add `pricing.delivery_fee`, `pricing.tip`, `delivery.zone`, `delivery.driver_id` fields. Recalculate `pricing.total` to include fee + tip. | `orders.js` | 1h |
| **2.7** | Ensure delivery fee is collected as **GreenReach revenue**: when order is processed via Square, `delivery_fee` must NOT be included in the `amountCents` sent to `squarePaymentService`. The delivery fee is a separate GreenReach charge. | `orders.js`, payment integration | 1h |
| **2.8** | Mirror `farm-sales-shop.html`, `farm-sales-store.html` to `greenreach-central/public/` | `cp` sync | 10min |

#### Acceptance Criteria
- Selecting "Home Delivery" triggers quote API call; fee displays as "$8.00" (Zone A/B) or "$12.00" (Zone C)
- Order below minimum shows "Minimum order for delivery: $35" (Zone B example) and checkout is disabled
- Tip buttons work; custom amount validated as ≥ $0
- Order JSON contains `pricing.delivery_fee`, `pricing.tip`, updated `pricing.total`
- Farm's Square payment only contains produce subtotal; delivery fee not in farm payment

#### Key Accounting Rule
```
Farm Square payment:     amountCents = produce_subtotal_cents
                         brokerFeeCents = amountCents × 0.12
                         Farm receives: amountCents - brokerFeeCents

GreenReach collects:     brokerFeeCents (12% produce commission)
                       + delivery_fee_cents (100% of delivery fee)
                       - driver_payout_cents (Phase 3)
                       = platform_revenue

Customer is charged:     produce_subtotal + tax + delivery_fee + tip
```

---

### 13.4 Phase 3 — Driver Payout Pipeline (Est. 6h)

**Goal:** When a delivery is marked `delivered`, automatically calculate driver earnings and create a payout ledger entry.

#### Tasks

| # | Task | File(s) | Est. |
|:--|------|---------|:----:|
| **3.1** | On `PATCH /api/farm-sales/delivery/:id` with `status: 'delivered'`: look up assigned driver, get `pay_per_delivery` and `cold_chain_certified` from `delivery_drivers` table. | `delivery.js` | 1h |
| **3.2** | Calculate payout: `base = driver.pay_per_delivery`, `cold = driver.cold_chain_certified ? driver.cold_chain_bonus : 0`, `tip = delivery_order.tip_amount`. Insert into `driver_payouts` table with `total_payout = base + cold + tip`. | `delivery.js` | 1.5h |
| **3.3** | Update `delivery_orders` row: set `driver_payout_amount = base + cold`, `platform_margin = delivery_fee - base - cold`. (Tip is pass-through, not a platform cost.) | `delivery.js` | 30min |
| **3.4** | Route tips to driver: tip is included in `driver_payouts.tip_amount` and `driver_payouts.total_payout`. GreenReach takes $0 of tip. | `delivery.js` | 30min |
| **3.5** | Add `GET /api/admin/delivery/driver-payouts?driver_id=X&from=&to=` endpoint: returns payout history with filtering. | `admin-delivery.js` | 1.5h |
| **3.6** | Add `PATCH /api/admin/delivery/driver-payouts/:id` endpoint: mark payout as `paid` with `paid_at` timestamp and `payout_method` (e-transfer/cheque). | `admin-delivery.js` | 1h |

#### Acceptance Criteria
- Marking delivery as `delivered` creates a `driver_payouts` row automatically
- Payout row contains correct base ($5.50), cold bonus ($2.00 or $0), tip, total
- `delivery_orders` shows `platform_margin = fee - base - cold`
- Admin can query driver payouts by date range
- Admin can mark payouts as paid

---

### 13.5 Phase 4 — Admin UX & Reporting (Est. 5–6h)

**Goal:** Replace stub UI and hardcoded zeros with functional admin tools.

#### Tasks

| # | Task | File(s) | Est. |
|:--|------|---------|:----:|
| **4.1** | Replace hardcoded `stats: { deliveries_30d: 0, revenue_30d: 0, fees_collected: 0, driver_payouts: 0, platform_revenue: 0 }` with real SQL aggregations from `delivery_orders` + `driver_payouts`. | `admin-delivery.js:35-42` | 2h |
| **4.2** | Replace `alert()` stubs for zone CRUD: wire `showAddZoneModal()`, `editDeliveryZone()`, `deleteZone()` to actual API calls. | `central-admin.js`, `GR-central-admin.html` | 2h |
| **4.3** | Replace `alert()` stubs for driver CRUD: wire `showAddDriverModal()`, `editDriver()`, `toggleDriverStatus()` to actual API calls. Add `pay_per_delivery` and `cold_chain_certified` fields to driver forms. | `central-admin.js`, `GR-central-admin.html` | 2h |
| **4.4** | Add driver payouts view to admin panel: table of recent payouts with driver name, delivery date, base, cold, tip, total, status (pending/paid). Bulk "Mark Paid" button. | `central-admin.js`, `GR-central-admin.html` | 2h |
| **4.5** | Fix readiness check: require `active_zones > 0` in addition to `enabled && active_windows > 0`. | `admin-delivery.js` | 15min |

#### Acceptance Criteria
- Stats show real numbers from DB
- Admin can add/edit/delete zones through modals (no more `alert()`)
- Admin can add/edit drivers with pay rate and cold-chain fields
- Admin can view and bulk-mark driver payouts as paid
- Readiness check fails if farm has no active zones

---

### 13.6 Phase 5 — Wholesale Channel Integration (Est. 3–4h)

**Goal:** Wholesale checkout also charges delivery fee (currently uses hardcoded zones) and collects tips.

#### Tasks

| # | Task | File(s) | Est. |
|:--|------|---------|:----:|
| **5.1** | Wholesale quote endpoint: read zones from DB instead of hardcoded `DELIVERY_ZONE_RULES`. Fall back to constants if DB returns empty. | `wholesale.js:226-250` | 1h |
| **5.2** | Wholesale checkout: add delivery fee as line item in order summary (separate from broker fee). | `public/js/wholesale.js` | 1h |
| **5.3** | Wholesale checkout: add tip field matching D2C design. | `public/js/wholesale.js` | 1h |
| **5.4** | Ensure wholesale Square payment excludes delivery fee from farm `amountCents`. Delivery fee collected as GreenReach-only charge. | `wholesale.js:1199-1210` | 1h |
| **5.5** | Legacy `wholesale-orders.js:259`: align platform fee from 10% → 12% OR migrate orders to Central wholesale path. | `wholesale-orders.js` | 30min |

#### Acceptance Criteria
- Wholesale quote returns zone fee from DB
- Wholesale checkout shows delivery fee + tip in order summary
- Farm Square payment contains produce only; delivery fee is separate
- Legacy 10% rate aligned or migrated

---

### 13.7 Supporting Tasks (Any Phase)

| # | Task | File(s) | Est. |
|:--|------|---------|:----:|
| **S.1** | Fix CSV manifest: add `=`/`+`/`-`/`@` escaping for injection prevention. Add `driver_name`, `delivery_fee`, `tip` columns. | `fulfillment.js:385-410` | 1h |
| **S.2** | Add application→driver conversion endpoint: approve a `driver_application` and auto-create `delivery_drivers` row with default pay rate. | `admin-delivery.js` | 2h |
| **S.3** | Update driver enrollment page: replace vague "base rate per delivery" with concrete "$5.50 per delivery + $2.00 cold-chain bonus + 100% of tips". | `driver-enrollment.html` | 15min |
| **S.4** | Add `delivery_fee` and `tip_amount` to PDF invoice generator (already reads `o.tip_amount` — verify field alignment). | `services/pdf-generator.js` | 30min |

---

### 13.8 Dependency Graph

```
Phase 1 (Schema + Constants)
    │
    ├──────────────────────────────┐
    ▼                              ▼
Phase 2 (D2C Checkout)         Phase 5 (Wholesale)
    │                              │
    ▼                              │
Phase 3 (Driver Payouts)  ◄────────┘
    │
    ▼
Phase 4 (Admin UX + Reporting)
```

- **Phase 1** is prerequisite for all others (schema must exist)
- **Phase 2 and 5** can run in parallel (different checkout pages)
- **Phase 3** requires Phase 2 (orders must carry fee/tip before payout can calculate)
- **Phase 4** requires Phase 3 (stats and payout views need ledger data)
- **Supporting tasks (S.1–S.4)** can be done at any point

---

### 13.9 Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Delivery fee accidentally included in farm Square payment → farm gets paid for delivery fee | Medium | **Critical** — GreenReach pays farm for something GreenReach should keep | Task 2.7: explicit separation of produce vs. delivery in payment flow. Test with sandbox Square. |
| Driver payout calculated at wrong rate (cached stale pay_per_delivery) | Low | Medium — incorrect driver earnings | Task 3.1: always read driver's current rate from DB at delivery completion time |
| Cold-chain Zone A ($0.50 margin) becomes loss center with high volume | Medium | Medium — negative delivery margin | Monitor via Phase 4 stats; raise Zone A to $9 if cold-chain > 30% of downtown deliveries |
| HST not applied to delivery fee → tax compliance issue | Medium | Medium | Confirm with accountant before shipping Phase 2; add HST to delivery fee in checkout total |
| Tips treated as GreenReach revenue for tax purposes | Low | **High** — CRA audit risk | Tips must flow through to driver as pass-through, never booked as GreenReach revenue. Task 3.4 ensures $0 GreenReach cut. |
| `delivery_orders` table doesn't exist on prod (only DDL, never run) | Possible | High — Phase 2 inserts fail | Task 1.7: verify table exists with `SELECT 1 FROM delivery_orders LIMIT 0` before deploying Phase 2 |

---

### 13.10 Estimated Timeline

| Phase | Effort | Calendar (solo dev) | Cumulative |
|-------|:------:|:-------------------:|:----------:|
| **Phase 1** | 2h | Day 1 (morning) | Day 1 |
| **Phase 2** | 6–8h | Day 1 (afternoon) + Day 2 | Day 2 |
| **Phase 3** | 6h | Day 3 | Day 3 |
| **Phase 4** | 5–6h | Day 4 | Day 4 |
| **Phase 5** | 3–4h | Day 5 (morning) | Day 5 |
| **Supporting** | 3–4h | Day 5 (afternoon) | Day 5 |
| **Total** | **~26–30h** | **~5 working days** | |

---

### 13.11 Definition of Done

- [ ] All zones charge $8+ delivery fee (no $0 zones)
- [ ] D2C checkout displays delivery fee and enforces minimum order
- [ ] Tip field functional with $0/$2/$5/custom options
- [ ] Order total = subtotal + tax + delivery_fee + tip
- [ ] Farm Square payment excludes delivery fee (farm gets 88% of produce only)
- [ ] Delivery fee is 100% GreenReach revenue
- [ ] Driver payout calculated on delivery completion (base + cold bonus)
- [ ] 100% of tips routed to driver ($0 to GreenReach)
- [ ] `driver_payouts` ledger populated with every completed delivery
- [ ] Admin stats show real aggregated data (not zeros)
- [ ] Admin can CRUD zones and drivers through modals (no `alert()` stubs)
- [ ] Admin can view and mark driver payouts as paid
- [ ] CSV manifest escapes injection vectors
- [ ] Wholesale checkout charges delivery fee (from DB zones, not hardcoded)
- [ ] Legacy 10% platform fee aligned to 12%
- [ ] All changes mirrored to greenreach-central

---

*Original report generated from live code review of `recovery/feb11-clean` branch, commit `a2a4a21`.*
*§12 (Revenue Model) added 2026-03-08 from code audit of commits through `495ffc6`.*
*§13 (Implementation Strategy) added 2026-03-08.*
