# Readiness Shortfall TODOs — 2026-03-07

Source: `COMPREHENSIVE_READINESS_REPORT_2026-03-07.md`

## P0 — API Parity Blocking Dashboard Accuracy

- [ ] **P0.1 Add Central parity for Farm Summary card feeds**
  - Scope:
    - Implement or proxy Central handlers for:
      - `GET /api/harvest/readiness`
      - `GET /api/losses/predict`
    - Keep response shape compatible with current `farm-summary.html` render logic.
  - Files likely impacted:
    - `greenreach-central/server.js`
    - `greenreach-central/routes/*` (new or existing route modules)
    - `greenreach-central/public/views/farm-summary.html` (only if fallback contract needed)
  - Acceptance:
    - Both endpoints return `200` on Central (unauthenticated farm context or valid farm auth, per current contract).
    - Farm Summary cards on Central no longer show fallback/error states for readiness/loss sections.

- [ ] **P0.2 Add Central parity for KPI dashboard endpoint**
  - Scope:
    - Add Central-compatible `GET /api/kpis` (proxy LE or native implementation).
    - Match LE `routes/kpis.js` response fields expected by `public/views/kpi-dashboard.html`.
  - Files likely impacted:
    - `greenreach-central/server.js`
    - `greenreach-central/routes/*` (new `kpis` route if native)
  - Acceptance:
    - `GET /api/kpis` returns `200` on Central.
    - KPI dashboard renders values on both LE and Central without host-specific failures.

## P1 — UI Communication Confidence and Card Integrity

- [ ] **P1.1 Validate GR Admin card hydration path**
  - Scope:
    - Confirm all visible cards in `GR-admin.html` are hydrated by loaded runtime scripts.
    - Verify script include/version alignment between:
      - `public/GR-admin.html`
      - `greenreach-central/public/GR-admin.html`
  - Acceptance:
    - Documented mapping: each major card section → script function → endpoint.
    - No placeholder-only cards in production without explicit “static/demo” label.

- [ ] **P1.2 Add host-aware fallback for Farm Summary (defensive)**
  - Scope:
    - Where card endpoints may differ by host, add guarded fallback logic in `farm-summary.html`.
    - Prefer server parity first; fallback remains protection for regressions.
  - Acceptance:
    - Card rendering degrades gracefully with explicit state text, never silent zeros from route mismatch.

## P1 — Automated Contract Verification

- [ ] **P1.3 Add card endpoint smoke test suite**
  - Scope:
    - Add script that checks card-critical endpoints on both hosts (`LE`, `Central`).
    - Include expected status classes (`200` for public/farm, `401` for admin unauthenticated).
  - Suggested endpoints:
    - `/api/config/app`
    - `/api/kpis`
    - `/api/health/insights`
    - `/api/harvest/readiness`
    - `/api/losses/predict`
    - `/api/ml/anomalies/statistics?hours=24`
    - `/api/ml/energy-forecast`
    - `/env`, `/api/env`, `/data/iot-devices.json`
    - `/api/admin/analytics/aggregate`
    - `/api/admin/farms/sync-all-stats`
    - `/api/admin/delivery/readiness`
  - Acceptance:
    - CI output clearly flags endpoint parity regressions by host.

## P2 — Drift Reduction Between LE and Central Static Trees

- [ ] **P2.1 Establish single source-of-truth for mirrored pages**
  - Scope:
    - Identify duplicated pages/scripts under `public/` and `greenreach-central/public/`.
    - Define canonical source and sync mechanism.
  - Options:
    - Build-time copy pipeline from canonical tree.
    - Shared include/bundle strategy.
  - Acceptance:
    - No manual dual-editing needed for mirrored pages.

- [ ] **P2.2 Add duplication guard check in CI**
  - Scope:
    - Add check that fails when mirrored files diverge unexpectedly.
  - Acceptance:
    - PRs that update one mirrored file without counterpart fail with actionable diff output.

## P2 — Auth Context Hardening

- [ ] **P2.3 Audit card APIs for token-context correctness**
  - Scope:
    - Ensure farm-facing pages use farm-compatible endpoints.
    - Ensure admin-only endpoints are only called in admin contexts.
  - Acceptance:
    - No farm page KPI/state derives from admin-only endpoint paths.

## Execution Order Recommendation

1. P0.1 Central harvest/loss parity
2. P0.2 Central `/api/kpis` parity
3. P1.3 Contract smoke tests
4. P1.1 GR Admin hydration validation
5. P2.1/P2.2 static-tree drift controls
6. P2.3 auth-context hardening sweep

## Definition of Done (Overall)

- All card-critical endpoints are available on intended hosts.
- Dashboard cards render consistent values across LE and Central.
- Automated endpoint contract tests run in CI and gate regressions.
- Mirrored UI assets are governed by enforced sync rules.
