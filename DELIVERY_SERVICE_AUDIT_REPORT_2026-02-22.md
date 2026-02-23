# Delivery Service — Audit Report

**Date:** 2026-02-22  
**Auditor:** AI Engineering Review  
**Scope:** All documents, source code, and UI assets related to the new delivery service  
**Status:** AUDIT COMPLETE — CRITICAL FINDINGS  
**Constraint:** Research-only audit. No code edits, commits, or deploys were made.

---

## 1. Documents Reviewed

| # | Document | Lines | Purpose |
|---|----------|-------|---------|
| 1 | `DELIVERY_SERVICE_ARCHITECTURE_PLAN.md` | 239 | Architecture review — approved with constraints for MVP |
| 2 | `DELIVERY_SERVICE_IMPLEMENTATION_PLAN.md` | 603 | 6-phase implementation plan with code samples |
| 3 | `DELIVERY_SERVICE_IMPLEMENTATION_TASK_LIST.md` | 107 | MVP task list — slices 1–6 with acceptance criteria |
| 4 | `public/delivery-platform.html` | 1,076 | Public-facing delivery platform landing page |
| 5 | `routes/farm-sales/delivery.js` | 716 | Farm-side delivery route handlers (Foxtrot) |
| 6 | `greenreach-central/routes/admin-delivery.js` | 221 | Central admin delivery API (zones, drivers, fees) |
| 7 | `src/modules/pricing/cost-allocator.ts` | 93 | Weighted cost allocation / simple fee calculator |

---

## 2. Executive Summary

The delivery service spans **3 planning documents**, **2 backend route files**, **1 pricing module**, and **1 marketing/landing page**. Progress has been made: the architecture plan is approved, slices 1–4 of the task list are marked complete, and two functional route files exist with farm-scoped settings, quoting, scheduling, and route optimization.

However, the audit reveals **significant gaps** between what the documents describe, what the landing page promises to the public, and what the code actually implements. Several of these gaps create **operational, legal, and data-integrity risks** if the service is launched in its current state.

### Verdict: NOT READY FOR PRODUCTION

The service has a sound MVP architecture plan, but the implementation is incomplete and the public-facing landing page dramatically overpromises relative to what exists in code. The 10 critical findings below must be addressed before any customer-facing launch.

---

## 3. Critical Findings

### F-1: CRITICAL — Landing Page Promises Features That Don't Exist

**Severity:** CRITICAL (legal/reputational risk)

The `delivery-platform.html` landing page describes a fully operational delivery platform with:

| Promised Feature | Code Status |
|-----------------|-------------|
| Driver application flow with background checks | **No `driver-apply.html` file exists** |
| Driver portal with shift management | **No `driver-portal.html` file exists** |
| DPWRA agreement flow | **No implementation** |
| Stripe Connect banking onboarding | **No implementation** |
| GPS tracking with 10–20s pings | **No implementation** |
| SSE streaming for live updates | **No implementation** |
| POD-gated payments (signature + photo + GPS) | **No implementation** |
| Weekly payout batches via Stripe Connect | **No implementation** |
| CRA T4A Box 048 reporting | **No implementation** |
| 24+ database tables (identity, commerce, delivery, pricing) | **Zero migrations exist** |
| 18 event topics | **No event system** |
| 40+ API endpoints across 4 groups | **Only ~12 endpoints exist** |

**Risk:** If this page is publicly accessible, it constitutes advertised commitments that the system cannot fulfill. Any driver who applies expecting the described onboarding, tracking, and payout features will find nothing. Any buyer expecting real-time delivery tracking, Proof of Delivery, or GPS-verified settlement will find none of it.

**Recommendation:** Either take the page offline or add a prominent "COMING SOON — Feature Preview" disclaimer. Do not link to `driver-apply.html` or `driver-portal.html` until those pages exist.

---

### F-2: CRITICAL — `admin-delivery.js` Is Not Mounted in Central Server

**Severity:** CRITICAL (dead code)

The file `greenreach-central/routes/admin-delivery.js` (221 lines) implements a full admin delivery CRUD API (config, zones, drivers, fees). However, **it is never imported or mounted** in `greenreach-central/server.js`. There is no `import` statement and no `app.use()` call for this router.

**Impact:** All admin delivery endpoints are unreachable. The Central admin dashboard cannot manage delivery zones, drivers, or fees via API. This file is effectively dead code.

**Recommendation:** Add to `greenreach-central/server.js`:
```javascript
import adminDeliveryRouter from './routes/admin-delivery.js';
app.use('/api/admin/delivery', requireAdmin, adminDeliveryRouter);
```

---

### F-3: HIGH — No Database Persistence for Delivery Data

**Severity:** HIGH (data loss on restart)

Both delivery route files use **in-memory storage**:

- `routes/farm-sales/delivery.js`: `deliverySettingsByFarm = new Map()`, `deliveryWindowsByFarm = new Map()`, `routes = new Map()`
- `greenreach-central/routes/admin-delivery.js`: `deliveryConfig = { ... }` (plain object)

All delivery settings, windows, scheduled deliveries, routes, zones, drivers, and fee data are **lost on process restart**. This includes any configured delivery zones, scheduled deliveries, and driver assignments.

The architecture plan specifies PostgreSQL tables (`farm_delivery_settings`, `farm_delivery_windows`, `farm_delivery_zones`), and the landing page describes 24+ tables across 4 domains. **Zero database migrations exist for any of these.**

**Impact:** 
- A single EB deployment or process restart deletes all delivery data
- No audit trail for delivery status changes
- No historical analytics possible
- Inconsistent with the rest of the platform (which uses PostgreSQL/NeDB for persistence)

**Recommendation:** Create migration(s) for MVP tables before any production use. Minimum: `farm_delivery_settings`, `farm_delivery_windows`, `farm_delivery_zones`.

---

### F-4: HIGH — `cost-allocator.ts` Is Unreferenced Dead Code

**Severity:** HIGH (design gap)

`src/modules/pricing/cost-allocator.ts` exports two functions (`allocateCost()`, `computeSimpleFee()`) that implement a weighted cost allocation model for multi-stop delivery fee distribution. However:

- **Neither function is imported anywhere** in the codebase
- The farm-side `delivery.js` has its own inline fee logic using hardcoded zone fees
- The admin-side `admin-delivery.js` has a separate hardcoded fee/zone model
- The landing page describes yet another pay formula (base $15 + $0.55/km + $0.18/engaged-min + $1.25/stop)

There are now **three separate, incompatible fee calculation approaches**:

| Location | Fee Model | Status |
|----------|-----------|--------|
| `cost-allocator.ts` | Weighted proportional allocation (km/min/vol/equal) | Dead code |
| `delivery.js` quote endpoint | `max(base_fee, zone_fee)` — flat per-zone fee | Active |
| `delivery-platform.html` | Base + per-km + per-min + per-stop | Advertised |

**Recommendation:** Decide on one canonical fee model. Remove or archive the others. Wire the chosen model into the quote endpoint.

---

### F-5: HIGH — Three Broken File References in Landing Page

**Severity:** HIGH (broken UX)

`delivery-platform.html` links to three files that **do not exist**:

| Referenced File | Occurrences | Exists? |
|----------------|-------------|---------|
| `driver-apply.html` | 4 links | **NO** |
| `driver-portal.html` | 2 links | **NO** |
| `css/gr-delivery.css` | 1 import | **NO** |

Visitors clicking "Apply to Drive" or "View Driver Portal" will receive a 404 error. The missing CSS file means the page may render with broken/unstyled components.

---

### F-6: HIGH — Document Contradictions

**Severity:** HIGH (team confusion)

The three planning documents contradict each other in several areas:

| Topic | Architecture Plan | Implementation Plan | Task List |
|-------|-------------------|---------------------|-----------|
| **PostGIS / geo queries** | Explicitly deferred to Phase 2 (AD-02). "No polygon/PostGIS until Phase 2 ADR." | Phase 3 includes `ST_Contains(zone_polygon::geometry, ...)` query. Phase 2 includes `zone_polygon JSONB` column. | Not mentioned |
| **Migration approach** | Create 3 tables: `farm_delivery_settings`, `farm_delivery_windows`, `farm_delivery_zones` | Create 3 tables + `farm_delivery_blackouts` + different column specs | No migration tasks |
| **Phase count** | N/A (workstreams A–E, ~6–9 days) | Phases 1–6 (~28 days) | Slices 1–6 |
| **Effort estimate** | 6–9 engineering days | 28 days (4 weeks) | Not estimated |
| **Zone model** | `zone_mode: postal_prefix | radius_km` (no polygons) | `zone_polygon JSONB` with `ST_Contains` geometry query | Not specified |

**Most concerning:** The Implementation Plan's Phase 3 (address-to-zone API) uses `ST_Contains(zone_polygon::geometry, ST_Point($2, $3))` — a PostGIS function — which the Architecture Plan explicitly forbids for MVP. If someone follows the Implementation Plan, they'll build something the Architecture Plan says not to build.

**Recommendation:** Reconcile the three documents into a single source of truth. The Architecture Plan should be authoritative for MVP scope.

---

### F-7: MEDIUM — `admin-delivery.js` Has No Auth Middleware

**Severity:** MEDIUM (security gap)

Unlike `routes/farm-sales/delivery.js` (which applies `farmAuthMiddleware` on all routes), `admin-delivery.js` **has no authentication or authorization middleware**. All endpoints are publicly accessible if mounted.

The Architecture Plan mandates: "Admin JWT + Admin role + explicit filters" for Central admin delivery dashboards. This is not implemented.

**Recommendation:** Add admin auth middleware:
```javascript
import { requireAdmin } from '../middleware/auth.js';
router.use(requireAdmin);
```

---

### F-8: MEDIUM — Route Optimization Bypass for Tenant Isolation

**Severity:** MEDIUM (data leak)

In `delivery.js`, the `routes` Map (line 17) is declared **outside of farm scope**:
```javascript
const routes = new Map();
```

All optimized routes from all farms are stored in this single shared Map. The `GET /routes` endpoint filters by `date`, `time_slot`, and `status` — but **not by farm ID**. Any authenticated farm can query routes for all farms.

Additionally, the `POST /routes/optimize` endpoint creates routes in the shared Map but doesn't tag them with a farm ID, making tenant isolation impossible for route queries.

**Impact:** Cross-farm data exposure. Farm A can see Farm B's delivery routes and customer addresses.

**Recommendation:** Add `farm_id` to route records and filter by `req.farm_id` in the GET endpoint.

---

### F-9: MEDIUM — Schedule Endpoint Calls Itself (Internal Fetch Anti-Pattern)

**Severity:** MEDIUM (fragility)

In `delivery.js` line 411, the `POST /schedule` endpoint makes an HTTP fetch to itself to check window availability:

```javascript
const windowCheck = await fetch(
  `http://localhost:8091/api/farm-sales/delivery/windows?date=${delivery_date}&zone=${zone}`
);
```

**Issues:**
- Hardcoded `localhost:8091` port — fails if the server runs on a different port
- Round-trips through the full HTTP stack unnecessarily
- Auth middleware may block the internal request (no auth headers forwarded)
- Creates a circular dependency that's hard to test

**Recommendation:** Extract window availability logic into a shared function called directly from both endpoints.

---

### F-10: LOW — No Tests Exist

**Severity:** LOW (quality gap)

Zero test files exist for any delivery functionality. The task list includes a "Validation + Quality Gate" section with 5 manual checks, but none are automated. The architecture plan requires:
- Tenant isolation tests
- Auth matrix tests  
- Quote endpoint tests
- UI smoke tests

None exist.

---

## 4. Implementation Progress Assessment

### Task List Status (per `DELIVERY_SERVICE_IMPLEMENTATION_TASK_LIST.md`)

| Slice | Description | Status | Verified in Code? |
|-------|-------------|--------|--------------------|
| 1 | Banner Infrastructure | ✅ STARTED (tasks checked) | Partially — banner component exists per grep results but wasn't independently verified |
| 2 | Delivery Settings API | ✅ All tasks checked | **YES** — `GET/PUT /settings` and `GET/PUT /windows` exist in `delivery.js` with farm scoping |
| 3 | Delivery Quote Endpoint | ✅ All tasks checked | **YES** — `POST /quote` exists with rules engine, returns additive payload |
| 4 | Wholesale Checkout Integration | ✅ All tasks checked | Not verified (HTML changes, grep matched delivery in GR-wholesale) |
| 5 | Farm Admin Settings UI | ❌ Not started | No |
| 6 | Central Read-Only Readiness | ❌ Not started | No |
| — | Validation + Quality Gate | ❌ Not started | No |

**Assessment:** MVP backend (slices 2–3) appears functional but uses in-memory storage. Frontend work (slices 4–6) is partially done or not started. No validation gate items are complete.

---

## 5. Architecture Alignment

### Architecture Plan Conditions of Approval

| # | Condition | Status |
|---|-----------|--------|
| 1 | Implement MVP scope only | **VIOLATED** — Landing page describes full Phase 2+ features as if operational |
| 2 | No polygon/PostGIS until Phase 2 ADR | **VIOLATED** — Implementation Plan Phase 3 uses `ST_Contains()` PostGIS function |
| 3 | Auth + tenant middleware on all delivery writes | **PARTIALLY MET** — Farm routes have auth; admin routes do not |
| 4 | Backward compatibility for wholesale checkout | Unknown — not audited |
| 5 | Validation artifacts in PR notes | **NOT MET** — no tests exist |

---

## 6. Data Model Gap Analysis

### What's Described vs. What Exists

| Domain | Tables Described (Landing Page) | Tables in Migration Plans | Tables in Code | Actual Migrations |
|--------|-------------------------------|--------------------------|----------------|-------------------|
| Identity & Access | 7 (users, customers, drivers, docs, background checks, payout accts, members) | 0 | 0 | 0 |
| Commerce & Fulfillment | 3 (orders, order_lines, pick_packs) | 0 | 0 | 0 |
| Delivery Execution | 8 (shipments, routes, stops, pods, events, telemetry, etc.) | 0 | In-memory Maps | 0 |
| Pricing & Settlement | 6 (fee_quotes, driver_offers, pay_statements, payouts, etc.) | 0 | 0 | 0 |
| Farm Settings (MVP) | 0 | 3–4 (settings, windows, zones, blackouts) | In-memory Maps | 0 |
| **Totals** | **24+ tables** | **3–4 tables** | **0 tables (Maps only)** | **0 migrations** |

---

## 7. Security Findings

| # | Finding | Severity | Location |
|---|---------|----------|----------|
| S-1 | Admin delivery API has no auth | MEDIUM | `admin-delivery.js` — no middleware |
| S-2 | Cross-farm route data exposure | MEDIUM | `delivery.js` — shared `routes` Map, no farm_id filter on GET |
| S-3 | No input sanitization on zone/driver creation | LOW | `admin-delivery.js` — `name`, `description`, `vehicle` not sanitized |
| S-4 | Driver PII (phone, email) stored in plain memory | LOW | `admin-delivery.js` — `deliveryConfig.drivers[]` |
| S-5 | Hardcoded port in internal fetch | LOW | `delivery.js:411` — `localhost:8091` |

---

## 8. Recommendations Summary

### Must-Do Before Launch (Blocking)

1. **Take `delivery-platform.html` offline or add "Feature Preview" disclaimer** (F-1)
2. **Mount `admin-delivery.js` in Central server with admin auth** (F-2, F-7)
3. **Create database migrations for MVP tables** (F-3)
4. **Fix tenant isolation leak in routes Map** (F-8)
5. **Reconcile the three planning documents** (F-6)

### Should-Do Before Launch (Important)

6. Remove or redirect broken links (`driver-apply.html`, `driver-portal.html`, `css/gr-delivery.css`) (F-5)
7. Choose one canonical fee model and wire it into the quote endpoint (F-4)
8. Replace internal `fetch` with direct function call in schedule endpoint (F-9)
9. Add input validation/sanitization to admin endpoints (S-3)
10. Write minimum test coverage: tenant isolation, auth matrix, quote determinism (F-10)

### Should-Do Post-Launch (Good Practice)

11. Add `farm_id` to route records for proper multi-tenant route management
12. Plan PostGIS migration for Phase 2 if polygon zones are needed
13. Evaluate whether `cost-allocator.ts` should replace inline fee logic or be removed
14. Implement the event topic system described in the landing page (or remove from page)

---

## 9. File Inventory

| File | Lines | Location | Status |
|------|-------|----------|--------|
| `DELIVERY_SERVICE_ARCHITECTURE_PLAN.md` | 239 | CodeVault | Plan — approved with constraints |
| `DELIVERY_SERVICE_IMPLEMENTATION_PLAN.md` | 603 | CodeVault | Plan — partially followed |
| `DELIVERY_SERVICE_IMPLEMENTATION_TASK_LIST.md` | 107 | CodeVault | Task list — slices 1–4 checked, 5–6 pending |
| `routes/farm-sales/delivery.js` | 716 | CodeVault + local | Active — mounted in `server-foxtrot.js` at line 11946 |
| `greenreach-central/routes/admin-delivery.js` | 221 | CodeVault | **Dead code — not mounted** |
| `public/delivery-platform.html` | 1,076 | Local clone | Active — publicly accessible landing page |
| `src/modules/pricing/cost-allocator.ts` | 93 | Local clone | **Dead code — never imported** |
| `css/gr-delivery.css` | — | — | **MISSING — referenced but doesn't exist** |
| `driver-apply.html` | — | — | **MISSING — linked but doesn't exist** |
| `driver-portal.html` | — | — | **MISSING — linked but doesn't exist** |

---

*End of audit report.*
