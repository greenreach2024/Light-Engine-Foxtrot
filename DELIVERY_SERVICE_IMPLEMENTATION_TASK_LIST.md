# Delivery Service MVP — Implementation Agent Task List

Date: 2026-02-22  
Source Plan: DELIVERY_SERVICE_ARCHITECTURE_PLAN.md  
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

## Slice 2 — Delivery Settings API (MVP backend)

### Tasks
- [x] Add farm-scoped `GET/PUT /api/farm-sales/delivery/settings` in `routes/farm-sales/delivery.js`.
- [x] Add farm-scoped `GET/PUT /api/farm-sales/delivery/windows` in `routes/farm-sales/delivery.js`.
- [x] Keep compatibility with existing `/windows` response structure.
- [x] Enforce auth + farm scope from middleware (ignore arbitrary client farm IDs).

### Acceptance
- Settings and windows roundtrip per farm without cross-farm leakage.
- Unauthorized calls fail with correct status.

---

## Slice 3 — Delivery Quote Endpoint (MVP backend)

### Tasks
- [x] Add `POST /api/farm-sales/delivery/quote`.
- [x] Implement simple rules engine (delivery enabled flag, min order, fee, window availability).
- [x] Return additive payload: `{ ok, eligible, fee, minimum_order, windows, reason }`.

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
- [ ] Add minimal settings form and windows editor to farm admin surface.
- [ ] Read/write settings via new endpoints.
- [ ] Add basic validation and save feedback.

### Acceptance
- Farm can configure delivery enabled state, base fee, min order, and windows.

---

## Slice 6 — Central Read-Only Readiness

### Tasks
- [ ] Add a small readiness card/table to `GR-central-admin.html`.
- [ ] Show farms with delivery enabled + windows configured.
- [ ] Read-only only for MVP.

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
