# GreenReach Wholesale Readiness Investigation

**Date:** 2026-03-11  
**Scope:** End-to-end wholesale readiness from farm inventory (LE) → GreenReach Central aggregation/order entry → fulfillment/delivery paths.  
**Method:** Code-path audit + targeted production probes against `https://app.greenreachgreens.com`.

---

## 1) Executive Verdict

**Overall readiness: Medium-Low (5.4/10).**

The wholesale platform is feature-rich and API-complete for core flow control, but production reliability is constrained by:

1. **Upstream farm connectivity/auth gaps** in network aggregation
2. **Forced limited-mode catalog logic** bypassing DB path
3. **Best-effort asynchronous inventory reservation/confirmation after order creation** (no hard transactional guarantee)
4. **Mixed persistence and overlapping route surfaces** that can cause state drift under failure

**Bottom line:** The system is close to operational, but current behavior can produce partial reliability (catalog available, orders accepted) without consistent farm-side fulfillment guarantees.

---

## 2) End-to-End Architecture Trace

## A. Farm inventory source (LE)

Primary farm-side wholesale source is `routes/wholesale-sync.js`:
- Builds lots from `public/data/groups.json` + `lighting-recipes.json`
- Applies reservation and deduction overlays for ATP (`qty_available`)
- Exposes:
  - `GET /api/wholesale/inventory`
  - `POST /api/wholesale/inventory/reserve|confirm|release|rollback`
  - `POST /api/wholesale/order-events`

Auth for write operations is enforced by `lib/wholesale-auth.js` (`X-Farm-ID` + `X-API-Key`).

## B. GreenReach aggregation (GC)

Aggregation is driven by `greenreach-central/services/wholesaleNetworkAggregator.js`:
- Polls registered farms from `networkFarmsStore`
- Calls each farm’s `/api/wholesale/inventory`
- Builds aggregated SKU view used by catalog/checkout allocation

Buyer catalog endpoint in `greenreach-central/routes/wholesale.js` currently has a **hard-coded hotfix path**:
- `if (true || req.app?.locals?.databaseReady === false)`
- This means it **always** uses in-memory/network aggregation path, never DB catalog path.

## C. Order entry and allocation (GC)

`greenreach-central/routes/wholesale.js` handles buyer-facing flow:
- `POST /api/wholesale/checkout/preview` (auth required)
- `POST /api/wholesale/checkout/execute` (auth required)
- Allocation from `buildAggregateCatalog` + `allocateCartFromNetwork`
- Creates order/payment objects in `wholesaleMemoryStore`

After order creation, farm notifications and inventory operations are performed asynchronously:
- notify farm (`/api/wholesale/order-events`)
- reserve inventory (`/api/wholesale/inventory/reserve`)
- confirm inventory if payment success (`/api/wholesale/inventory/confirm`)

These are **best-effort** and intentionally non-blocking for checkout response.

## D. Delivery/Fulfillment path

Delivery quote and tracking support is present:
- `POST /api/wholesale/delivery/quote` (auth required)
- per-farm settings via `farm_delivery_settings` / `farm_delivery_zones` fallback logic
- fulfillment callbacks:
  - `POST /api/wholesale/orders/:orderId/fulfill`
  - `POST /api/wholesale/orders/:orderId/cancel-by-farm`
- admin tracking patch:
  - `PATCH /api/wholesale/admin/orders/:orderId/farms/:farmId/tracking`

Additional fulfillment router is also mounted at the same base path:
- `greenreach-central/routes/wholesale-fulfillment.js`

---

## 3) Production Probe Evidence (Current)

## API behavior (`app.greenreachgreens.com`)

- `GET /api/wholesale/catalog` → **200**
- `GET /api/wholesale/network/aggregate` → **200**
- `POST /api/wholesale/checkout/preview` (unauth) → **401** (expected)
- `POST /api/wholesale/delivery/quote` (unauth) → **401** (expected)
- `POST /api/wholesale/catalog/sync` (unauth) → **401** (expected)

## Catalog quality observed

Current live catalog is extremely thin:
- `sku_count = 1`
- SKU: `SKU-AUDIT-GENOVESE-BASIL-5LB`
- Product name includes `(fallback)`
- Quantity: 4

This indicates production availability is currently relying on fallback/minimal inventory path, not broad farm feed.

## Network aggregation diagnostics observed

Live `/api/wholesale/network/aggregate` diagnostics showed:
- `error_count = 2`
- fetch failures for 2 registered farms
- failure details include `auth_headers=missing`

Live `/api/wholesale/network/farms` showed:
- 3 farms registered
- all with `auth_farm_id=null`
- all with `api_key` absent

Implication: multiple farms are configured without credentials needed for authenticated inventory fetch, directly reducing catalog completeness.

---

## 4) Readiness by Stage

## Stage 1 — Farm Inventory Generation (LE): **6.5/10**

**Strengths**
- Inventory lots are computed with reservation/deduction overlays
- Reservation lifecycle endpoints exist and are guarded

**Gaps**
- Some schedule/pricing responses in `wholesale-sync.js` are static/demo-style payloads
- Auth key verification in `lib/wholesale-auth.js` uses direct comparison (no timing-safe compare)

## Stage 2 — Ingestion & Aggregation (GC): **4.5/10**

**Strengths**
- Aggregator diagnostics are surfaced and useful
- Network farm registry auto-seeds from DB

**Gaps**
- Hard-coded `if (true || ...)` permanently locks catalog into hotfix mode
- Farm connectivity/auth completeness is insufficient (missing auth fields, unreachable farm URLs)
- Catalog reflects fallback inventory instead of broad production inventory

## Stage 3 — Order Entry & Payment Split: **5.5/10**

**Strengths**
- Buyer auth, checkout preview/execute, split payment scaffolding implemented
- Order/payout objects and audit events are present

**Gaps**
- Post-checkout notify/reserve/confirm flow is async best-effort and can silently fail
- This can produce order acceptance without deterministic inventory lock confirmation
- Memory-store + DB hybrid model increases drift risk under partial failures

## Stage 4 — Delivery & Fulfillment: **5.0/10**

**Strengths**
- Delivery quote endpoint with farm settings/zones fallback
- Fulfillment/cancellation callbacks and tracking updates exist

**Gaps**
- Multiple fulfillment surfaces (main wholesale router + wholesale-fulfillment router) increase contract complexity
- Some fulfillment status updates target top-level order fields rather than consistent sub-order model
- No single canonical, enforced state machine across all fulfillment paths

---

## 5) Critical Risks (Priority Ordered)

## P0 — Must fix before scale-up

1. **Farm registry credential completeness**
   - Missing `auth_farm_id`/`api_key` for registered farms causes fetch failures and sparse catalog.

2. **Forced hotfix catalog mode**
   - `if (true || ...)` prevents intended DB/catalog path recovery and masks schema readiness.

3. **Non-transactional async reserve/confirm after checkout**
   - Checkout success can race ahead of actual farm inventory reservation success.

## P1 — High priority

4. **Route surface overlap / state-model divergence**
   - Wholesale + wholesale-fulfillment mounted under same base path with mixed storage semantics.

5. **Farm-side auth hardening**
   - Move key compare to timing-safe semantics and centralize secret handling.

6. **Connectivity posture for farm endpoints**
   - At least one expected farm domain (`foxtrot.greenreachgreens.com`) was not resolvable from probes; direct LE CNAME checks timed out in this environment.

## P2 — Medium priority

7. **Demo/static payload remnants in operational routes**
   - Schedule/pricing placeholders reduce production confidence and forecasting quality.

8. **Automated end-to-end smoke as deployment gate**
   - Existing `scripts/ci/run-wholesale-smokes.sh` should be required pre-deploy with environment parity.

---

## 6) Recommended Remediation Plan

## Wave 1 (24–48h): Stabilize ingestion + catalog truth

1. Populate `network_farms` auth fields (`auth_farm_id`, `api_key`) for all active farms.
2. Validate each farm `api_url` reachability from GC runtime (not local shell).
3. Remove hard-coded `if (true || ...)`; gate by real health flag/feature flag.
4. Confirm catalog breadth after fixes (SKU count and farm count targets).

## Wave 2 (48–72h): Hard transactional order integrity

5. Convert checkout execute to explicit transactional orchestration:
   - reserve all farms → payment capture/authorize → confirm all farms
   - if any step fails, compensating rollback and deterministic failure response
6. Persist and enforce one canonical order/sub-order state machine across all fulfillment paths.

## Wave 3 (3–5 days): Delivery/fulfillment hardening

7. Consolidate fulfillment endpoints or enforce strict adapter layer to one canonical model.
8. Add automated contract tests for:
   - catalog aggregation
   - reservation lifecycle
   - fulfill/cancel callbacks
   - tracking updates

---

## 7) Investigation Artifacts Reviewed

Key files audited:
- `routes/wholesale-sync.js`
- `lib/wholesale-auth.js`
- `services/wholesale-integration.js`
- `services/inventory-reservation-service.js`
- `routes/wholesale-orders.js`
- `routes/wholesale/checkout.js`
- `greenreach-central/routes/wholesale.js`
- `greenreach-central/routes/wholesale-fulfillment.js`
- `greenreach-central/services/wholesaleNetworkAggregator.js`
- `greenreach-central/services/networkFarmsStore.js`
- `greenreach-central/services/wholesaleMemoryStore.js`

---

## 8) Final Readiness Statement

Wholesale is **functionally integrated but not yet operationally robust** for high-confidence multi-farm production scale. Current deployment can support controlled usage, but catalog completeness and order-to-fulfillment reliability are constrained by farm connectivity/auth setup and non-transactional orchestration.

**Recommendation:** treat this as a **hardening-ready** system, not yet a **fully reliable scaled production rail**, until P0 items are complete and re-verified by deterministic smoke + contract tests.
