# Delivery Service MVP — Implementation Agent Task List

Date: 2026-02-22 (updated 2026-02-23 post-review, Phase 2 completed 2026-02-23)  
Source Plan: DELIVERY_SERVICE_ARCHITECTURE_PLAN.md + DELIVERY_SERVICE_IMPLEMENTATION_PLAN.md v2.0.0  
Execution Rule: Complete in order; do not expand scope without review.

---

## Slice 1 — Shared Banner Infrastructure (STARTED)

### Tasks
- [x] Verify existing references to banner component in target pages.
- [x] Refactor shared banner component to remove hard-coded color system and use existing theme variables.
- [x] Ensure safe behavior when `localStorage` is unavailable.
- [x] Enable banner on Central Admin page.

### Files
- `greenreach-central/public/js/components/service-intro-banner.js`
- `greenreach-central/public/GR-central-admin.html`

### Acceptance
- Banner appears on `GR-wholesale`, `LE-farm-admin`, and `GR-central-admin`.
- Banner can be dismissed and stays dismissed per browser profile.
- No new custom color palette or standalone theme system introduced.

---

## Slice 2 — Delivery Settings API (MVP backend) — NEEDS REWORK

> **⚠️ Post-Audit Note (v2.0.0)**: Slice 2 endpoints exist but use in-memory `Map()` storage. After Phase 0.3 migration applies, these endpoints must be **refactored to use PostgreSQL** (`farm_delivery_settings`, `farm_delivery_windows` tables). All reads become `SELECT ... WHERE farm_id = $1`, all writes become `INSERT ... ON CONFLICT DO UPDATE`. The checked boxes below reflect API shape completion only, not persistence.

### Tasks
- [x] Add farm-scoped `GET/PUT /api/farm-sales/delivery/settings` in `routes/farm-sales/delivery.js`.
- [x] Add farm-scoped `GET/PUT /api/farm-sales/delivery/windows` in `routes/farm-sales/delivery.js`.
- [x] Keep compatibility with existing `/windows` response structure.
- [x] Enforce auth + farm scope from middleware (ignore arbitrary client farm IDs).
- [x] **Refactor settings storage from `deliverySettingsByFarm` Map to `farm_delivery_settings` table.**
- [x] **Refactor windows storage from `deliveryWindowsByFarm` Map to `farm_delivery_windows` table.**
- [x] **Use upsert pattern (`INSERT ... ON CONFLICT DO UPDATE`) for all writes.**

### Acceptance
- Settings and windows roundtrip per farm without cross-farm leakage.
- Unauthorized calls fail with correct status.

---

## Slice 3 — Delivery Quote Endpoint (MVP backend) — NEEDS REWORK

> **⚠️ Post-Audit Note (v2.0.0)**: Quote endpoint currently reads settings/windows from in-memory Maps. After Phase 0.3, it must read from database. Zone matching must use `postal_prefix` LIKE query against `farm_delivery_zones` table (no PostGIS). The `routes` Map must also be farm-scoped (Phase 0.4 tenant isolation fix).

### Tasks
- [x] Add `POST /api/farm-sales/delivery/quote`.
- [x] Implement simple rules engine (delivery enabled flag, min order, fee, window availability).
- [x] Return additive payload: `{ ok, eligible, fee, minimum_order, windows, reason }`.
- [x] **Switch from in-memory zone lookup to `farm_delivery_zones` PostgreSQL query.**
- [x] **Replace `routes` Map reads with farm-scoped database queries.**

### Acceptance
- Deterministic quote behavior from test fixtures.
- No changes required to existing checkout execute path.

---

## Slice 4 — Wholesale Checkout Integration (MVP frontend)

### Tasks
- [x] Add pickup/delivery selector UI in `greenreach-central/public/GR-wholesale.html`.
- [x] Wire quote call from delivery inputs.
- [x] Display fee + eligibility state before checkout.
- [x] Preserve current checkout behavior when delivery disabled.

### Acceptance
- Buyer can switch methods and receive quote feedback.
- Checkout remains functional for pickup-only farms.

---

## Slice 5 — Farm Admin Delivery Settings UI

### Tasks
- [x] Add minimal settings form and windows editor to farm admin surface.
- [x] Read/write settings via new endpoints.
- [x] Add basic validation and save feedback.

### Acceptance
- Farm can configure delivery enabled state, base fee, min order, and windows.

---

## Slice 6 — Central Read-Only Readiness

### Tasks
- [x] Add a small readiness card/table to `GR-central-admin.html`.
- [x] Show farms with delivery enabled + windows configured.
- [x] Read-only only for MVP.

### Acceptance
- Admin can quickly see rollout readiness by farm.

---

## Validation + Quality Gate (Before Merge)

- [ ] `npm run validate-schemas`
- [ ] Targeted API checks for settings/windows/quote
- [ ] Manual smoke test for banner dismiss behavior on the three pages
- [ ] Manual smoke test for wholesale checkout with pickup and delivery
- [ ] Record evidence in PR notes

---

## Deployment Gate (Mandatory)

No production deployment commands until user provides exact approval:  
**APPROVED FOR DEPLOYMENT**
