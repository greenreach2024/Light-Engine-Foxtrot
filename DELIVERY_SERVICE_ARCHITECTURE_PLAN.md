# Delivery Service: Architecture Review + Implementation Plan

**Version**: 1.1.0  
**Date**: 2026-02-22  
**Author**: Architecture Agent  
**Status**: Approved with constraints (implementation-ready for MVP only)

---

## 1) Architecture Review Verdict

### Decision
**APPROVED WITH CONSTRAINTS** for an MVP release.

### Why this is approved
- Aligns with workflow-centric UX: buyer can choose fulfillment without adding unnecessary steps.
- Uses existing platform shape (`routes/farm-sales/delivery.js`, Central + farm UI surfaces).
- Keeps Central in the loop for network visibility (future-ready), while keeping MVP risk low.

### Blocking corrections applied in this architecture plan
1. **Process gate enforced**: No implementation or deployment bypasses multi-agent workflow and explicit deployment approval.
2. **Design-system compliance**: No new hard-coded color/shadow system; use existing theme primitives/classes only.
3. **Tenancy/auth-first**: Every endpoint includes farm scope and auth requirements by contract.
4. **Geo strategy corrected**: Avoid invalid `JSONB::geometry` pattern; use an explicit staged geo model.

---

## 2) Scope Control

## MVP Scope (implement now)
1. Delivery service banner on selected pages (using existing design tokens/components only).
2. Delivery settings persistence per farm (fees, windows, service flags).
3. Wholesale checkout read-path for fulfillment selection (`pickup`/`delivery`) and fee display.
4. Central admin read-only network visibility for delivery readiness (counts/status only).

## Explicitly out of MVP
- Driver assignment, route optimization, live tracking.
- Polygon geofencing and geospatial containment queries.
- Multi-farm delivery balancing automation.
- New external mapping provider dependencies.

---

## 3) Architecture Decisions

### AD-01: Data model (MVP)
Use **non-geospatial normalized tables** first:
- `farm_delivery_settings`
- `farm_delivery_windows`
- `farm_delivery_zones` (zone by postal-prefix/radius metadata, not polygons in MVP)

Reason: fastest safe path, avoids premature PostGIS complexity, supports immediate go-live.

### AD-02: Geospatial evolution (Phase 2)
When polygon zones are needed:
- Add PostGIS extension via migration.
- Store geometry in `geometry(Polygon, 4326)` column.
- Keep canonical input as GeoJSON, transform at write-time.
- Add GIST index + containment tests using `ST_Contains` on real geometry.

### AD-03: API compatibility
All changes must be additive; no existing payload keys removed.

### AD-04: Tenant isolation
All write endpoints must resolve farm context from auth (JWT farm claim or farm API headers). Client-provided `farm_id` is ignored unless authorized for admin context.

---

## 4) Auth + Tenancy Contract (Mandatory)

| Endpoint Group | Auth Required | Farm Scope Source | Notes |
|---|---|---|---|
| Buyer checkout read/write | Buyer JWT | JWT claim + order context | No cross-farm writes |
| Farm delivery settings (CRUD) | Farm JWT or `X-Farm-ID` + API key | Server-resolved | Enforce same-farm only |
| Central admin delivery dashboards | Admin JWT | Admin role + explicit filters | Read-only in MVP |
| Public marketing/banner content | None | N/A | Static content only |

**Mandatory middleware order**: auth -> farm-scope resolution -> input validation -> handler.

---

## 5) API Plan (MVP)

### Reuse/extend existing delivery route surface
Base: `routes/farm-sales/delivery.js`

**MVP Endpoints**
- `GET /api/farm-sales/delivery/settings`
- `PUT /api/farm-sales/delivery/settings`
- `GET /api/farm-sales/delivery/windows`
- `PUT /api/farm-sales/delivery/windows`
- `POST /api/farm-sales/delivery/quote` (simple rules engine; no polygons)

**Quote input (MVP)**
- delivery postal/zip
- order subtotal
- requested window

**Quote output (MVP)**
- eligible: boolean
- fee
- minimum order requirement
- available windows
- reason (if ineligible)

---

## 6) UI Plan (MVP)

### Pages in MVP
- `greenreach-central/public/GR-wholesale.html`
- `greenreach-central/public/LE-farm-admin.html`
- `greenreach-central/public/GR-central-admin.html`
- `greenreach-central/public/farm-sales-landing.html` (if already part of active flow)

### UI constraints
- Use existing CSS variables/theme classes/components only.
- No standalone new color palette.
- No new animation system.
- No additional modal/page unless required for MVP task completion.

### UX behavior
- Banner is dismissible via local storage key.
- Checkout toggles pickup/delivery with server-quoted fee.
- Farm admin has minimal delivery settings form and time-window editor.
- Central admin shows readiness summary (farms with delivery enabled, windows configured).

---

## 7) Data + Migration Plan

### Migration 1 (MVP)
Create:
- `farm_delivery_settings` (farm_id PK/FK, enabled, base_fee, min_order, lead_time_hours, updated_at)
- `farm_delivery_windows` (id, farm_id FK, day_of_week, start_time, end_time, active)
- `farm_delivery_zones` (id, farm_id FK, zone_name, zone_mode, zone_value, fee_override, min_order_override, active)

`zone_mode` values (MVP): `postal_prefix`, `radius_km`.

### Migration rules
- Additive only.
- Backfill defaults with delivery disabled.
- No destructive schema changes in same release.

---

## 8) Validation + Test Plan

### Must-pass checks before merge
1. Tenant isolation tests for settings and windows endpoints.
2. Auth matrix tests (buyer/farm/admin unauthorized permutations).
3. Quote endpoint tests for eligibility + fee resolution.
4. UI smoke tests:
   - banner renders/dismisses
   - checkout method toggle and quote fetch
   - farm settings save/load roundtrip

### Must-pass checks before deployment
- `npm run validate-schemas`
- targeted integration smoke tests for delivery endpoints
- zero regression on wholesale checkout execute flow

---

## 9) Rollout Plan

### Stage A (dev/local)
- Implement MVP backend + UI.
- Validate farm-scoped behavior with at least two farms.

### Stage B (staging)
- Enable for one pilot farm (`The Notable Sprout`) and one control farm.
- Observe quote accuracy + checkout conversion + errors for 48h.

### Stage C (production)
- Expand to all active farms after staging pass.
- Keep feature flag for rapid rollback.

---

## 10) Deployment Gate (Non-negotiable)

No production deployment actions until user sends exact approval:  
**"APPROVED FOR DEPLOYMENT"**

This includes `eb deploy`, `scp`, `ssh` file edits, and process restarts.

---

## 11) Implementation Work Breakdown (MVP)

### Workstream A: Backend (2-3 days)
- Add migration + repository methods.
- Extend `routes/farm-sales/delivery.js` with settings/windows/quote.
- Add auth + tenant middleware enforcement.

### Workstream B: Farm/Admin UI (1-2 days)
- Delivery settings view in existing admin surface.
- Validate + save windows/settings.

### Workstream C: Buyer checkout (1-2 days)
- Add fulfillment selector and quote call.
- Preserve current checkout behavior when delivery disabled.

### Workstream D: Central visibility (1 day)
- Read-only readiness cards in central admin.

### Workstream E: QA + hardening (1 day)
- API tests, regression checks, schema validation.

**Total MVP effort**: ~6-9 engineering days.

---

## 12) Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Cross-tenant write leakage | High | Server-resolved farm scope, role checks, integration tests |
| Quote mismatch vs farm policy | Medium | Centralized quote function with test fixtures |
| UI inconsistencies across pages | Medium | Shared existing components/theme tokens only |
| Geo feature pressure in MVP | Medium | Explicit defer to Phase 2 with PostGIS ADR |

---

## 13) Architecture Agent Conditions of Approval

1. Implement **MVP scope only** in this cycle.
2. Do not introduce polygon/PostGIS until Phase 2 ADR is accepted.
3. Enforce auth + tenant middleware contract on all delivery writes.
4. Maintain backward compatibility for existing wholesale checkout payloads.
5. Include validation artifacts in PR notes (tests + schema checks).

---

## 14) Next Action

Proceed to **Implementation Agent proposal** for MVP tasks only, then **Review Agent validation**, then return for final architecture confirmation prior to deployment request.
