# LE ↔ GC Multi-Farm Communication Readiness Report

**Date:** 2026-03-10  
**Scope:** Light Engine (LE) multi-farm server + GreenReach Central (GC) communication and operational readiness.  
**Method:** Code-level audit of active routes, service clients, auth paths, fallback logic, and endpoint contract compatibility.

---

## 1) Executive Readiness Verdict

**Overall:** **Medium-Low readiness** for full multi-farm production autonomy.

- Strength: broad feature surface exists across procurement, delivery, POS, wholesale, nutrient/env automation, light scheduling, AI/ML.
- Primary risk: **cross-service contract drift** (LE client assumptions no longer aligned with GC endpoints/auth) plus **demo/fallback pathways** still present in runtime code.
- Launch impact: system can operate partially, but end-to-end reliability and trustworthiness are degraded under real farm load and failure scenarios.

---

## 2) Domain Readiness Scores

| Domain | Score | Status | Notes |
|---|---:|---|---|
| Procurement | 6.0/10 | Amber | Functional APIs, but mixed persistence and simulated supplier channel behavior in LE.
| Delivery | 7.0/10 | Amber-Green | Strong route depth + DB paths; some fallback/in-memory admin metrics remain.
| POS | 6.5/10 | Amber | Rich workflow; internal localhost chaining and auth passthrough increase fragility.
| Wholesale | 5.5/10 | Amber-Red | Broad features but contract mismatch between LE integration service and GC wholesale router.
| Nutrient Management Automation | 7.0/10 | Amber-Green | Good command/calibration APIs; dependency on Python/MQTT backend uptime.
| Environment Management Automation | 6.5/10 | Amber | VPD/automation APIs are deep; mock/test pathways and init dependencies remain.
| Light Scheduling | 7.0/10 | Amber-Green | Schedule executor controls exist; startup/observability hardening still needed.
| AI/ML | 5.5/10 | Amber-Red | Comprehensive endpoint set, but multiple demo/synthetic responses remain in prod code paths.

---

## 3) Critical LE↔GC Contract Gaps (Blocking)

## A. Sync payload mismatch: inventory

- LE sends: `POST /api/sync/inventory` with body containing `inventory`.
  - Evidence: `services/sync-service.js` (`syncInventory`)
- GC expects: `POST /api/sync/inventory` with body containing `products`.
  - Evidence: `greenreach-central/routes/sync.js` (`router.post('/inventory', ...)`)

**Impact:** inventory sync may fail validation or silently produce empty updates.

## B. Missing/renamed endpoint mismatch: health + config

- LE calls:
  - `POST /api/sync/health`
  - `GET /api/farms/:farmId/config`
  - Evidence: `services/sync-service.js`
- GC provides:
  - `POST /api/sync/heartbeat`
  - `POST /api/sync/config` (plus restore/status read paths)
  - Evidence: `greenreach-central/routes/sync.js`

**Impact:** health/config sync reliability degrades; status appears stale despite active LE.

## C. WebSocket auth handshake mismatch

- LE WS client sends headers:
  - `Authorization: Bearer <apiKey>` and `X-Farm-ID`
  - Evidence: `services/sync-service.js`
- GC WS server accepts:
  - `?token=<jwt>` query param **or** (`x-api-key` + `x-farm-id`) header pair.
  - Evidence: `greenreach-central/server.js` WS connection auth block.

**Impact:** LE cannot reliably authenticate WS in production unless additional adapter logic is present.

## D. Wholesale integration contract mismatch

- LE integration calls:
  - `/api/wholesale/catalog/sync`
  - `/api/wholesale/pricing/sync`
  - Evidence: `services/wholesale-integration.js`
- GC wholesale router lacks matching sync endpoints in current route surface.
  - Evidence: `greenreach-central/routes/wholesale.js` (cancel route found; no catalog/pricing sync route signatures).

**Impact:** automatic wholesale catalog/pricing push from LE is not dependable.

## E. Farm settings sync auth too permissive

- GC farm-settings auth currently accepts any non-empty key.
  - Evidence: `greenreach-central/routes/farm-settings.js`

**Impact:** high auth bypass risk for settings mutation/ack flow.

---

## 4) Security & Reliability Risks (High)

1. **Fallback/dev secrets in runtime paths**
   - Examples: fallback JWT secret patterns and placeholder API key fallback in LE (`server-foxtrot.js` around experiment sync and auth handlers).

2. **Demo/synthetic response branches mixed with production routes**
   - AI/ML, automation, admin analytics, and selected farm flows include mock/demo data branches in main server runtime.

3. **Protocol inconsistency across modules**
   - Same concept represented by different endpoint names/body fields (`health` vs `heartbeat`, `inventory` vs `products`).

4. **Mixed persistence models**
   - DB + in-memory + file fallback behaviors are common; useful for resilience but currently reduce deterministic behavior in production triage.

---

## 5) Feature-by-Feature Operational Notes

## Procurement
- LE procurement route is extensive and usable for core workflows.
- Supplier API/email routing still includes simulated/log-first behavior rather than hard-fail transactional guarantees.

## Delivery
- LE delivery routes include multi-tenant scoping and DB-backed records.
- GC admin delivery control/readiness endpoints are mature enough for operations, with partial fallback metrics still present.

## POS
- LE POS checkout flow integrates orders/payments/customer credits and delivery quoting.
- Coupling to internal endpoint hops (`localhost`) and auth pass-through raises failure propagation risk.

## Wholesale
- GC wholesale route depth is strong for buyer-facing operations.
- LE wholesale integration service contract does not fully match GC wholesale API surface.

## Nutrient & Environment Automation
- Nutrient command/calibration/telemetry endpoints are robust and include input constraints.
- Runtime depends on Python backend + MQTT stack; missing subsystem handling exists but should be tightened with explicit degraded-state telemetry.

## Light Scheduling
- Scheduler control APIs and status endpoints exist and are usable.
- Needs stronger startup guarantees and audit trails for skipped/failed ticks under load.

## AI/ML
- Forecast, anomalies, metrics, retraining, and model operations are present.
- Production trust is reduced by embedded demo/synthetic branches and fallback-heavy responses.

---

## 6) Remediation Backlog (Priority-Ordered)

## Wave 1 — Contract Alignment (P0)

1. **Unify sync API contract in LE client** (`services/sync-service.js`)
   - `inventory` -> `products` payload field.
   - `POST /api/sync/health` -> `POST /api/sync/heartbeat`.
   - `GET /api/farms/:farmId/config` -> `GET /api/sync/:farmId/config` or introduce explicit GC endpoint and standardize.

2. **Unify WS auth protocol** (`services/sync-service.js`, `greenreach-central/server.js`)
   - Standard choice: `x-api-key` + `x-farm-id` headers or signed JWT token query.
   - Implement dual-support short term; deprecate one path with explicit logging.

3. **Wholesale sync endpoint parity** (`services/wholesale-integration.js`, `greenreach-central/routes/wholesale.js`)
   - Either add `/catalog/sync` + `/pricing/sync` in GC or change LE integration calls to existing GC contract.

4. **Harden farm-settings auth** (`greenreach-central/routes/farm-settings.js`)
   - Replace permissive key acceptance with DB/API-key validation equivalent to sync router standards.

## Wave 2 — Security Hardening (P1)

5. Remove fallback secrets from production runtime paths (LE + GC auth and sync helpers).
6. Enforce startup env validation for all required cross-service credentials.
7. Add structured correlation IDs to all inter-service requests and responses.

## Wave 3 — Runtime Trustworthiness (P1/P2)

8. Strictly gate demo/mock code behind non-production flags and runtime guard middleware.
9. Add explicit degraded-state contracts for Python/MQTT/edge unreachable conditions.
10. Normalize response envelope shape (`ok` vs `success`) at LE and GC API edges.

## Wave 4 — Verification & Observability (P2)

11. Add contract tests for LE↔GC sync and wholesale integration paths.
12. Add synthetic transaction monitoring for procurement, delivery, POS checkout, and order status propagation.
13. Add periodic drift checks that fail CI when endpoint signatures diverge.

---

## 7) Readiness Gate Recommendation

Declare **“multi-farm production ready”** only after these gate criteria pass:

- P0 contract alignment completed and deployed (sync + WS + wholesale + farm-settings auth).
- No fallback secret/default credential path reachable in production mode.
- Contract test suite green for LE↔GC communication matrix.
- Demo/mock responses disabled in production and verified by smoke tests.

---

## 8) Bottom Line

The platform has strong feature breadth and significant implementation depth.  
The immediate limiter is **cross-service consistency and operational rigor**, not raw functionality volume.  
A focused hardening sprint on contracts/auth + production gating can move readiness from **Medium-Low** to **High** quickly.
