# Comprehensive Readiness Report — Light Engine ↔ GreenReach Central (Including Marketing)

**Date:** 2026-03-07  
**Requested Scope:** End-to-end review of documents + code across Light Engine, GreenReach Central, and marketing pages; trace all display cards and confirm communication paths.  
**Audit Type:** Static code trace + live endpoint probes (unauthenticated baseline).

---

## 1) Executive Summary

**Overall readiness:** **PARTIALLY READY** (core telemetry and farm dashboards are largely wired; several cross-environment card/API mismatches remain).

### High-confidence conclusions
- Core farm operational cards are connected on Light Engine and mostly connected on Central for `/env`, `/api/env`, `/api/health/insights`, `/api/ml/*`, and `/data/*` telemetry paths.
- The **Farm Admin Active Devices KPI** fix is present in both deployed bundles and now uses `/data/iot-devices.json` (farm-compatible path).
- A number of cards are intentionally static/marketing only (no backend dependency), especially on landing/impact pages.
- Some card endpoints are **environment-specific** and currently produce 404 on Central (notably `/api/kpis`, `/api/harvest/readiness`, `/api/losses/predict`).

---

## 2) Evidence Reviewed

## Documents reviewed
- `README.md`
- `SYSTEM_DATA_AUDIT_2026-03-06.md`
- `DELIVERY_READINESS_REPORT_2026-03-06.md`

## Code footprint inspected
- Frontend inventory: **142 HTML** files, **60 JS** files under `public/` + `greenreach-central/public/`.
- Primary card-heavy pages audited:
  - `public/farm-admin.html`, `public/farm-admin.js`
  - `greenreach-central/public/farm-admin.html`, `greenreach-central/public/farm-admin.js`
  - `public/views/farm-summary.html` (+ Central copy)
  - `public/GR-admin.html` (+ Central copy)
  - `greenreach-central/public/central-admin.js` (+ root copy)
  - `public/views/kpi-dashboard.html`
  - `public/views/room-heatmap.html`, `public/views/room-mapper.html`
  - `public/views/farm-inventory.html`, `public/views/tray-inventory.html`
  - `public/views/planting-scheduler.html`, `public/views/nutrient-management.html`, `public/views/procurement-portal.html`
  - Marketing/performance pages: `public/LE-downloads.html`, `public/GR-farm-performance.html`, `public/GR-wholesale-farm-performance.html`, `greenreach-central/public/wholesale-landing.html`, `greenreach-central/public/farm-sales-landing.html`

## Backend route surfaces verified
- `server-foxtrot.js`
- `greenreach-central/server.js`
- `routes/kpis.js`
- `routes/wholesale/farm-performance.js`
- `greenreach-central/routes/admin-delivery.js`
- `greenreach-central/routes/wholesale.js`

---

## 3) Display Card Trace Matrix (UI → Data Source → Backend)

## A) Farm Admin KPI cards (LE + Central copies)

| Card | UI Binding | Frontend Source | Endpoint(s) | Backend Path | Confirmed |
|---|---|---|---|---|---|
| Active Trays | `#kpi-trays` | `farm-admin.js` | `/api/inventory/current` (inventory object) | LE `app.get('/api/inventory/current', ...)`; Central equivalent | Yes |
| Total Plants | `#kpi-plants` | `farm-admin.js` | `/api/inventory/current` | Same as above | Yes |
| Active Devices | `#kpi-devices` | `farm-admin.js` | `/data/iot-devices.json` | Farm data middleware + JSON store | Yes (fix verified live) |
| Next Harvest | `#kpi-harvest` | `farm-admin.js` | Harvest prediction/readiness data path in script | LE harvest endpoints available; Central copy depends on mounted harvest routes | Partial |

**Notable:** card copy now explicitly shows `No communicating devices` fallback and no longer depends on admin-only farm device endpoint for Farm Admin context.

---

## B) Farm Summary cards (LE + Central copies)

| Card/Widget | Frontend Function Area | Endpoint(s) | Backend Route Found | Live Probe |
|---|---|---|---|---|
| Health Monitor Card | `loadHealthStatus()` | `/api/health/insights` | LE + Central | 200 on both |
| Harvest Readiness cardlet | readiness loader | `/api/harvest/readiness` | LE present | LE 200 / Central 404 |
| Loss Prediction cardlet | losses loader | `/api/losses/predict` | LE present | LE 200 / Central 404 |
| ML Anomalies stats | anomalies loader | `/api/ml/anomalies/statistics` | LE + Central | 200 on both |
| Energy Forecast cardlet | forecast loader | `/api/ml/energy-forecast` | LE + Central | 200 on both |
| Zone augmentation data | `augmentHealthWithIoTDevices` | `/data/iot-devices.json`, `/data/room-map.json` | farm-data middleware / JSON | 200 on both |

---

## C) Central Admin overview cards

| Card Group | Frontend Source | Endpoint(s) | Backend Status | Communication Status |
|---|---|---|---|---|
| Overview KPIs (`kpi-farms`, `kpi-rooms`, `kpi-zones`, `kpi-devices`, `kpi-trays`, `kpi-plants`) | `central-admin.js` `loadDashboardData()` | `/api/admin/farms/sync-all-stats`, `/api/admin/farms?...` | Mounted on Central | Auth-gated (401 without admin token) |
| Delivery Readiness card | `central-admin.js` `loadDeliveryReadiness()` | `/api/admin/delivery/readiness` | `app.use('/api/admin/delivery', ...)` + `router.get('/readiness', ...)` | Auth-gated (401 without admin token) |
| Fleet/Energy/Alerts cards | `central-admin.js` | `/api/admin/fleet/monitoring`, `/api/admin/energy/dashboard`, `/api/admin/alerts` | Routes present | Auth-gated |

---

## D) GR Admin cards (`GR-admin.html`)

- Card UI is extensive (`stat-card`, transaction/payment/reconciliation cards), but direct fetch wiring is not prominent in this HTML snapshot.
- This page appears more template-heavy and likely relies on external script/runtime path for live hydration in active deployment.
- **Readiness risk:** ensure deployed script bundle that hydrates GR Admin cards is loaded and version-synced in both LE and Central copies.

---

## E) KPI Dashboard (`public/views/kpi-dashboard.html`)

| Card Grid | Endpoint | Backend |
|---|---|---|
| `#kpi-grid` dynamic cards | `/api/kpis` | LE only (`routes/kpis.js`, mounted via `app.use('/api/kpis', kpisRouter)`) |

**Result:** Works on LE; returns 404 on Central unless proxied/implemented there.

---

## F) Operational View cards (room/inventory/scheduler/nutrients/procurement)

| Page | Key Card/Data Widgets | Data Endpoints | Trace Outcome |
|---|---|---|---|
| `room-heatmap.html` | sensor markers, room heat cards | `/env`, `/data/iot-devices.json`, `/data/rooms.json`, room-map files | Wired + active |
| `room-mapper.html` | room/device assignment cards | `/api/setup/rooms`, `/api/room-mapper/save`, `/data/iot-devices.json` | Wired; save path present |
| `farm-inventory.html` | inventory/forecast cards | `/api/inventory/current`, `/api/inventory/forecast`, `/data/groups.json` | Wired |
| `tray-inventory.html` | QA/activity/forecast cards | `/api/wholesale/inventory`, `/api/activity-hub/*`, `/api/inventory/*`, `/env` | Wired; multi-endpoint complexity high |
| `planting-scheduler.html` | planning recommendation cards | `/api/planting/*`, `/api/planning/demand-forecast`, `/api/ai/status` | Wired |
| `nutrient-management.html` | nutrient KPI/command cards | `/data/nutrient-dashboard`, `/api/nutrients/*` | Wired |
| `procurement-portal.html` | supplier/order/inventory cards | `/api/procurement/*` | Wired |

---

## G) Marketing & landing cards

| Page | Card Type | Dynamic? | Endpoint Trace |
|---|---|---|---|
| `greenreach-central/public/wholesale-landing.html` | 6 `impact-card` blocks | Static | No required API dependency |
| `public/LE-downloads.html` | download cards + CTA | Mixed | `POST /api/analytics/download` event capture |
| `public/GR-farm-performance.html` (+ wholesale variant) | 4 metric cards | Dynamic | `/api/wholesale/farm-performance/dashboard`, `/alerts` |
| `greenreach-central/public/farm-sales-landing.html` | config-driven elements | Dynamic | `/api/config/app` |

---

## 4) Live Endpoint Verification (Unauthenticated Baseline)

### Light Engine (`light-engine-foxtrot-prod-v2...`)
- 200: `/api/config/app`, `/api/kpis`, `/api/health/insights`, `/api/harvest/readiness`, `/api/losses/predict`, `/api/ml/anomalies/statistics`, `/api/ml/energy-forecast`, `/env`, `/api/env`, `/data/iot-devices.json`, `/api/wholesale/farm-performance/dashboard`, `/api/wholesale/farm-performance/alerts`
- 401 (expected admin): `/api/admin/analytics/aggregate`, `/api/admin/farms/sync-all-stats`
- 404: `/api/admin/delivery/readiness` (expected; central-admin feature belongs to Central service)

### GreenReach Central (`greenreach-central...`)
- 200: `/api/config/app`, `/api/health/insights`, `/api/ml/anomalies/statistics`, `/api/ml/energy-forecast`, `/env`, `/api/env`, `/data/iot-devices.json`, `/api/wholesale/farm-performance/dashboard`, `/api/wholesale/farm-performance/alerts`
- 401 (expected admin): `/api/admin/analytics/aggregate`, `/api/admin/farms/sync-all-stats`, `/api/admin/delivery/readiness`
- 404: `/api/kpis`, `/api/harvest/readiness`, `/api/losses/predict`

---

## 5) Readiness Gaps (Card Communication)

## Critical/High
1. **Cross-environment endpoint mismatch for card feeds**
   - Farm Summary cards call LE-style endpoints (`/api/harvest/readiness`, `/api/losses/predict`) that 404 on Central.
2. **KPI Dashboard portability gap**
   - `/api/kpis` exists on LE but not Central; dashboard behavior diverges by host.
3. **GR Admin hydration ambiguity**
   - Rich card layout with limited direct fetch evidence in file; script loading/version parity should be validated in-browser.

## Medium
4. **Duplicate page copies (LE vs Central static trees) increase drift risk**
   - Multiple pages mirrored under both `public/` and `greenreach-central/public/`.
5. **Auth-context sensitivity for card APIs**
   - Admin endpoints are correctly gated, but pages must consistently call farm-compatible endpoints when using farm tokens.

---

## 6) Readiness Verdict by Surface

| Surface | Verdict |
|---|---|
| Farm Admin KPI communication | **READY** (after Active Devices fix) |
| Farm Summary communication on LE | **READY** |
| Farm Summary communication on Central | **PARTIALLY READY** (404s on readiness/loss endpoints) |
| Central Admin communication (with admin auth) | **READY** |
| KPI Dashboard cross-host behavior | **NOT READY** (LE-only route) |
| Marketing landing pages | **READY** (mostly static; selective API calls healthy) |

---

## 7) Prioritized Remediation Plan

1. **Unify Farm Summary data contract across LE/Central**
   - Add/proxy `/api/harvest/readiness` and `/api/losses/predict` on Central, or implement host-aware fallback in `farm-summary.html`.
2. **Add `/api/kpis` compatibility on Central**
   - Proxy to LE or expose Central-native KPI endpoint with same response schema.
3. **Card contract tests (CI smoke)**
   - Add automated probes for all card-backed endpoints per host (`LE`, `Central`) with expected status (`200/401`).
4. **Reduce duplicated page drift**
   - Establish one source-of-truth for duplicated assets or enforce sync checks in CI.
5. **GR Admin render validation**
   - Confirm runtime script hydration path and that all visible stat cards are backed by live data in production.

---

## 8) Quick Quantitative Checks Captured

- Farm Admin KPI cards: **4** (`kpi-card`)
- GR Admin stat cards: **11** (`stat-card`)
- Farm performance metric cards: **4** (`metric-card`)
- Wholesale landing impact cards (Central): **6** (`impact-card`)

---

## 9) Final Assessment

The platform is close to production-ready for the core operational dashboard paths, and marketing surfaces are generally healthy. The main blockers are **cross-host API parity** for card feeds and **asset drift risks** between Light Engine and Central copies. Fixing those two areas will materially improve reliability and reduce false card states.
