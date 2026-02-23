# Delivery Service Implementation Plan

**Version**: 2.0.0  
**Date**: February 22, 2026 (updated from v1.0.0)  
**Review Agent**: Implementation Proposal  
**Status**: REVISED — Post-Audit Remediation  
**Supersedes**: v1.0.0 (same date)  
**Authoritative Scope Reference**: `DELIVERY_SERVICE_ARCHITECTURE_PLAN.md` (approved with constraints)

---

## Revision History

| Version | Date | Change Summary |
|---------|------|----------------|
| 1.0.0 | 2026-02-22 | Original 6-phase plan (28 days) |
| 2.0.0 | 2026-02-22 | Post-audit remediation rewrite. Reconciled with Architecture Plan. Added Phase 0 (compliance/persistence). Removed PostGIS from MVP. Added regulatory sections (DPWRA, CRA). Consolidated fee model. Added mandatory test gate. |

---

## Executive Summary

This plan introduces **delivery management capabilities** across four system touchpoints:
1. **Wholesale Portal** (buyer-facing) — GreenReach Central
2. **Light Engine** (farm-side) — Foxtrot
3. **GreenReach Central Admin** — Network coordination
4. **Marketing Pages** — Service announcement

### Post-Audit Assessment

The 2026-02-22 audit (`DELIVERY_SERVICE_AUDIT_REPORT_2026-02-22.md`) identified **10 findings** (3 Critical, 4 High, 3 Medium/Low) that collectively render the service **not ready for production**. This v2.0.0 plan restructures the implementation sequence to close those gaps before any customer-facing launch.

Key structural changes from v1.0.0:
- **New Phase 0** added as the first mandatory phase: marketing compliance, dead code cleanup, persistence migration, tenant isolation, and admin auth.
- **PostGIS removed from MVP** to align with Architecture Plan AD-02 (deferred to Phase 2 ADR).
- **Canonical fee model** selected and enforced; conflicting models archived.
- **Regulatory compliance sections** added (DPWRA, CRA T4A) as pre-scaling gates.
- **Mandatory test gate** with three automated suites before merge.
- **Effort estimate reconciled** with Architecture Plan (~10–13 engineering days for MVP, not 28).

### Current State Analysis

| Component | Existing Code | Audit Status |
|-----------|--------------|--------|
| Backend delivery routes | `routes/farm-sales/delivery.js` (716 lines) | Functional but in-memory only (F-3) |
| Delivery windows/zones | In-memory Map objects | No persistence — data lost on restart (F-3) |
| Wholesale checkout form | `GR-wholesale.html` delivery address fields | Partial |
| Farm Sales D2C delivery | `farm-sales-shop.html` delivery fields | Complete |
| Farm POS deliveries tab | `farm-sales-pos.html` delivery tab | Stub only |
| Marketing landing page | `delivery-platform.html` (1,076 lines) | **CRITICAL** — overpromises vs reality (F-1) |
| Central admin delivery API | `admin-delivery.js` (221 lines) | **DEAD CODE** — not mounted in server.js (F-2) |
| Pricing module | `cost-allocator.ts` (93 lines) | **DEAD CODE** — never imported (F-4) |
| Three referenced assets | `driver-apply.html`, `driver-portal.html`, `css/gr-delivery.css` | **DO NOT EXIST** (F-5) |
| Tenant isolation | Shared `routes` Map, no farm_id filter | **BROKEN** — cross-farm data exposure (F-8) |
| Admin auth | `admin-delivery.js` has no auth middleware | **MISSING** (F-7) |
| Tests | None | None (F-10) |

---

## Scope Definition

### Authoritative Scope Reference

The `DELIVERY_SERVICE_ARCHITECTURE_PLAN.md` is the single source of truth for MVP scope. This implementation plan must not exceed that scope. Where this document previously contradicted the Architecture Plan (e.g., PostGIS in Phase 3, 28-day timeline), those contradictions have been corrected in this revision.

### In Scope (MVP)

1. **Phase 0: Pre-Launch Remediation** — Marketing compliance, persistence, tenant isolation, admin auth, fee model consolidation, dead code resolution
2. **Phase 1: Service Introduction Banner** — Dismissible announcement on key pages
3. **Phase 2: Delivery Settings Persistence + Zone Configuration** — Farm-level zone/fee setup with durable storage
4. **Phase 3: Buyer Delivery Experience** — Enhanced wholesale checkout (no geospatial queries)
5. **Phase 4: Farm Admin Delivery Settings UI** — Minimal settings form
6. **Phase 5: Central Read-Only Readiness** — Network visibility
7. **Phase 6: Marketing Pages Update** — Announce only what is implemented
8. **Mandatory Test Gate** — Three automated suites before merge

### Explicitly Out of Scope (Phase 2+ / Future ADR Required)

- Polygon geofencing and PostGIS `ST_Contains` queries (Architecture Plan AD-02)
- Real-time driver GPS tracking / SSE streaming
- Driver application, onboarding, and portal
- Route optimization algorithms
- Third-party logistics integration (Uber Eats, DoorDash)
- Stripe Connect banking onboarding / POD-gated payouts
- Autonomous delivery scheduling
- Multi-farm delivery balancing automation
- Cross-farm delivery heatmaps

---

## Implementation Plan

### Phase 0: Pre-Launch Remediation (BLOCKING) — 3–4 days

**Objective**: Close all audit critical/high findings before any customer-facing work proceeds.

This phase has no customer-visible output. It exists solely to establish the safety, compliance, and integrity baseline that the rest of the plan depends on.

#### 0.1 Marketing Compliance — Landing Page (Audit F-1, F-5)

**Regulatory context**: Under the Canadian Competition Act, it is illegal to advertise or market in a way that is false or misleading. Both the "general impression" and literal meaning matter (Competition Bureau Canada guidance). The current `delivery-platform.html` describes 24+ database tables, 40+ API endpoints, GPS tracking, Stripe Connect payouts, and CRA compliance — none of which exist in code. This creates legal exposure.

**Actions:**

| # | Action | Detail |
|---|--------|--------|
| 0.1.1 | Gate or label the landing page | Either move `delivery-platform.html` behind an auth-gated route (internal only) OR add a prominent, above-the-fold "Feature Preview / Coming Soon" disclaimer that makes clear the described features are planned, not operational. |
| 0.1.2 | Remove broken links | Remove or disable all links to `driver-apply.html`, `driver-portal.html`, and the `css/gr-delivery.css` import. These files do not exist. |
| 0.1.3 | Split into "Available" vs "Planned" | If the page remains public, restructure content into two clearly labeled sections: **"Available in MVP"** (only features verifiably implemented end-to-end) and **"Planned"** (everything else). |
| 0.1.4 | Remove volume/capability claims | Remove or qualify claims about specific table counts, endpoint counts, event topics, and compliance features (DPWRA, CRA) that are not yet implemented. |

#### 0.2 Mount Admin Delivery Routes + Add Auth (Audit F-2, F-7)

**Security context**: OWASP lists Broken Access Control as a top risk. Missing authorization controls frequently lead to full data exposure or unauthorized modification.

**Actions:**

| # | Action | Detail |
|---|--------|--------|
| 0.2.1 | Mount `admin-delivery.js` in Central server | Add import and `app.use()` in `greenreach-central/server.js`. |
| 0.2.2 | Add admin auth middleware | Apply admin JWT + role verification middleware at the router level before any handler executes. Architecture Plan §4 mandates: "Admin JWT + Admin role + explicit filters." |
| 0.2.3 | Add input sanitization | Sanitize `name`, `description`, `vehicle`, and all string inputs on zone/driver creation endpoints. |

```javascript
// greenreach-central/server.js — mount with auth
import adminDeliveryRouter from './routes/admin-delivery.js';
app.use('/api/admin/delivery', requireAdmin, adminDeliveryRouter);
```

```javascript
// routes/admin-delivery.js — add at top of router
import { requireAdmin } from '../middleware/auth.js';
router.use(requireAdmin);
```

#### 0.3 Establish MVP Database Persistence (Audit F-3)

**Engineering context**: The Twelve-Factor methodology requires that persistent state live in a backing service (database, durable queue). Processes must be stateless and share-nothing. All current delivery data lives in in-memory `Map()` objects and is lost on process restart or EB deployment.

**Migration 1 — MVP Persistence Tables:**

Create additive-only migration. Backfill defaults with delivery disabled. No destructive schema changes.

```sql
-- Migration: 001_delivery_mvp_tables.sql

CREATE TABLE IF NOT EXISTS farm_delivery_settings (
  farm_id VARCHAR(255) PRIMARY KEY REFERENCES farms(farm_id),
  enabled BOOLEAN DEFAULT false,
  base_fee DECIMAL(10,2) DEFAULT 0,
  min_order DECIMAL(10,2) DEFAULT 0,
  lead_time_hours INT DEFAULT 24,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (farm_id)
);

CREATE TABLE IF NOT EXISTS farm_delivery_windows (
  id SERIAL PRIMARY KEY,
  farm_id VARCHAR(255) NOT NULL REFERENCES farms(farm_id),
  day_of_week INT NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (farm_id, day_of_week, start_time)
);

CREATE TABLE IF NOT EXISTS farm_delivery_zones (
  id SERIAL PRIMARY KEY,
  farm_id VARCHAR(255) NOT NULL REFERENCES farms(farm_id),
  zone_name VARCHAR(100) NOT NULL,
  zone_mode VARCHAR(20) NOT NULL CHECK (zone_mode IN ('postal_prefix', 'radius_km')),
  zone_value VARCHAR(255) NOT NULL,
  fee_override DECIMAL(10,2),
  min_order_override DECIMAL(10,2),
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (farm_id, zone_name)
);

CREATE INDEX idx_delivery_settings_farm ON farm_delivery_settings(farm_id);
CREATE INDEX idx_delivery_windows_farm ON farm_delivery_windows(farm_id);
CREATE INDEX idx_delivery_zones_farm ON farm_delivery_zones(farm_id);
```

**Idempotency pattern**: All write operations on these tables must use `INSERT ... ON CONFLICT DO UPDATE` (PostgreSQL upsert) to ensure deterministic behavior under retries, re-syncs, or duplicate submissions. Reference: PostgreSQL docs on `INSERT ... ON CONFLICT`.

```javascript
// Example: upsert delivery settings
const upsertSettings = `
  INSERT INTO farm_delivery_settings (farm_id, enabled, base_fee, min_order, lead_time_hours, updated_at)
  VALUES ($1, $2, $3, $4, $5, NOW())
  ON CONFLICT (farm_id) DO UPDATE SET
    enabled = EXCLUDED.enabled,
    base_fee = EXCLUDED.base_fee,
    min_order = EXCLUDED.min_order,
    lead_time_hours = EXCLUDED.lead_time_hours,
    updated_at = NOW()
  RETURNING *;
`;
```

**Constraint**: `zone_mode` is restricted to `postal_prefix` or `radius_km` for MVP. No `polygon` mode until Phase 2 PostGIS ADR is accepted (Architecture Plan AD-02).

#### 0.4 Fix Tenant Isolation (Audit F-8)

**Security context**: OWASP multi-tenant guidance frames cross-tenant data exposure as a key risk. The current `routes` Map in `delivery.js` is declared outside farm scope and the `GET /routes` endpoint does not filter by `farm_id`.

**Actions:**

| # | Action | Detail |
|---|--------|--------|
| 0.4.1 | Add `farm_id` to all route/stop records | Every record created in the routes system must include `farm_id` at creation time. |
| 0.4.2 | Filter all reads by `req.farm_id` | Every endpoint that returns routes, stops, schedules, or windows must include `WHERE farm_id = req.farm_id` (or the Map-key equivalent if still pre-persistence). |
| 0.4.3 | Deny-by-default posture | If `farm_id` cannot be resolved from the auth context, the request must be rejected (403), not served with unscoped data. |
| 0.4.4 | Remove shared `routes` Map | Replace the module-level `const routes = new Map()` with farm-scoped storage (initially `Map<farm_id, Map<route_id, route>>`, then database-backed). |

**Mandatory middleware order** (per Architecture Plan §4):
```
auth → farm-scope resolution → input validation → handler
```

#### 0.5 Consolidate Fee Model (Audit F-4)

**Problem**: Three incompatible fee calculation approaches exist:

| Location | Fee Model | Status |
|----------|-----------|--------|
| `cost-allocator.ts` | Weighted proportional allocation (km/min/vol/equal) | Dead code — never imported |
| `delivery.js` quote endpoint | `max(base_fee, zone_fee)` — flat per-zone fee | Active in code |
| `delivery-platform.html` | Base $15 + $0.55/km + $0.18/min + $1.25/stop | Advertised only |

**Decision**: The **zone-based fee model** (`max(base_fee, zone_fee)`) is the canonical MVP pricing engine. This aligns with what can be measured reliably today (zone membership, order subtotal) without requiring mature routing outputs (km, minutes, stop count).

**Actions:**

| # | Action | Detail |
|---|--------|--------|
| 0.5.1 | Archive `cost-allocator.ts` | Move to `src/modules/pricing/_archived/cost-allocator.ts` or delete. Do not leave dead exports in the active module tree. |
| 0.5.2 | Remove advertised formula from landing page | The per-km/per-min/per-stop formula is not implemented. Remove it from `delivery-platform.html` or move to "Planned" section. |
| 0.5.3 | Document canonical model | Add a comment block to the quote endpoint identifying it as the single source of pricing truth for MVP. |
| 0.5.4 | Log estimated km/min | If routing data becomes available, log estimated distance and time alongside the zone-based fee so the platform can transition to a distance-based model in Phase 2 without losing historical data. |

**Phase 2 (future)**: Adopt a cost allocator that takes stable inputs (distance/time estimates, stop count, tote/weight) and wire it to the quote endpoint. Ensure the allocator, invoice, and any driver pay logic trace to the same configured model.

#### 0.6 Eliminate Self-Fetch Anti-Pattern (Audit F-9)

**Problem**: `delivery.js` line 411 `POST /schedule` calls itself via `fetch('http://localhost:8091/...')` to check window availability. This fails if the port changes, round-trips through the HTTP stack unnecessarily, and auth middleware may block the internal request.

**Action**: Extract window availability logic into a shared function. Call it directly from both the `/windows` endpoint and the `/schedule` handler.

```javascript
// Extract shared logic
async function getAvailableWindows(farmId, date, zone) {
  // ... window lookup logic (currently inline in GET /windows handler)
}

// In GET /windows handler:
router.get('/windows', farmAuthMiddleware, async (req, res) => {
  const windows = await getAvailableWindows(req.farm_id, req.query.date, req.query.zone);
  res.json({ ok: true, windows });
});

// In POST /schedule handler — direct call, no HTTP round-trip:
const windows = await getAvailableWindows(req.farm_id, delivery_date, zone);
```

---

### Phase 1: Service Introduction Banner (Effort: S) — 1–2 days

**Objective**: Add dismissible announcement banner across delivery-enabled pages.

**Prerequisite**: Phase 0 complete (persistence + isolation baseline established).

#### 1.1 Create Reusable Banner Component

**File**: `greenreach-central/public/js/components/service-intro-banner.js`

```javascript
class ServiceIntroBanner {
  constructor(options) {
    this.serviceId = options.serviceId;
    this.title = options.title;
    this.description = options.description;
    this.ctaText = options.ctaText || 'Learn More';
    this.ctaUrl = options.ctaUrl;
    this.dismissKey = `dismissed_banner_${this.serviceId}`;
  }

  render() {
    // Safe behavior when localStorage is unavailable
    try {
      if (localStorage.getItem(this.dismissKey)) return '';
    } catch (e) { /* localStorage blocked — show banner */ }
    return `
      <div class="service-intro-banner" id="banner-${this.serviceId}">
        <div class="banner-content">
          <div class="banner-icon">🚚</div>
          <div class="banner-text">
            <h3>${this.title}</h3>
            <p>${this.description}</p>
          </div>
          <a href="${this.ctaUrl}" class="banner-cta">${this.ctaText}</a>
          <button class="banner-dismiss" onclick="ServiceIntroBanner.dismiss('${this.serviceId}')">&times;</button>
        </div>
      </div>
    `;
  }

  static dismiss(serviceId) {
    try {
      localStorage.setItem(`dismissed_banner_${serviceId}`, Date.now());
    } catch (e) { /* fail silently */ }
    document.getElementById(`banner-${serviceId}`)?.remove();
  }
}
```

#### 1.2 Banner CSS

**File**: `greenreach-central/public/css/service-intro-banner.css`

**Constraint**: Use existing theme variables/classes only. No standalone new color palette or animation system (Architecture Plan §6).

#### 1.3 Banner Placement (3 pages for MVP)

| Page | Path | Priority |
|------|------|----------|
| Wholesale Portal | `GR-wholesale.html` | HIGH |
| Light Engine Admin | `LE-farm-admin.html` | HIGH |
| GR Central Admin | `GR-central-admin.html` | LOW |

Additional pages (`farm-sales-shop.html`, `wholesale-about.html`, `wholesale-learn-more.html`) may be added post-MVP if needed.

---

### Phase 2: Delivery Settings Persistence + Zone Configuration (Effort: M) — 2–3 days

**Objective**: Allow farms to configure delivery zones, fees, and service areas with durable (database-backed) storage.

**Prerequisite**: Phase 0 migration applied. Tables `farm_delivery_settings`, `farm_delivery_windows`, `farm_delivery_zones` exist.

#### 2.1 Refactor Existing Endpoints to Use Database

Replace all in-memory `Map` reads/writes in `routes/farm-sales/delivery.js` with PostgreSQL queries:

| Endpoint | Current Storage | Target Storage |
|----------|----------------|----------------|
| `GET /settings` | `deliverySettingsByFarm.get(farm_id)` | `SELECT * FROM farm_delivery_settings WHERE farm_id = $1` |
| `PUT /settings` | `deliverySettingsByFarm.set(farm_id, ...)` | Upsert into `farm_delivery_settings` |
| `GET /windows` | `deliveryWindowsByFarm.get(farm_id)` | `SELECT * FROM farm_delivery_windows WHERE farm_id = $1 AND active = true` |
| `PUT /windows` | `deliveryWindowsByFarm.set(farm_id, ...)` | Upsert into `farm_delivery_windows` |

All writes use `INSERT ... ON CONFLICT DO UPDATE` for idempotency.

#### 2.2 Zone Configuration API (MVP — No Geospatial)

**Zone model (MVP)**: `zone_mode` is either `postal_prefix` or `radius_km`. No polygon, no `ST_Contains`, no PostGIS dependency (Architecture Plan AD-01, AD-02).

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/farm-sales/delivery/zones` | List farm's delivery zones |
| POST | `/api/farm-sales/delivery/zones` | Create delivery zone |
| PATCH | `/api/farm-sales/delivery/zones/:id` | Update zone |
| DELETE | `/api/farm-sales/delivery/zones/:id` | Soft-deactivate zone (`active = false`) |

**Zone matching (MVP)**:

```javascript
// postal_prefix matching — no PostGIS required
async function findMatchingZone(farmId, postalCode) {
  const zones = await pool.query(`
    SELECT zone_name, fee_override, min_order_override
    FROM farm_delivery_zones
    WHERE farm_id = $1
      AND active = true
      AND zone_mode = 'postal_prefix'
      AND $2 LIKE zone_value || '%'
    ORDER BY LENGTH(zone_value) DESC
    LIMIT 1
  `, [farmId, postalCode.toUpperCase().replace(/\s/g, '')]);
  return zones.rows[0] || null;
}
```

#### 2.3 Admin Delivery Endpoints (Central — Now Mounted)

With `admin-delivery.js` properly mounted (Phase 0.2), enable the following admin endpoints:

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/admin/delivery/config` | Admin JWT | Get delivery config |
| PUT | `/api/admin/delivery/config` | Admin JWT | Update delivery config |
| GET | `/api/admin/delivery/zones` | Admin JWT | List zones |
| POST | `/api/admin/delivery/zones` | Admin JWT | Create zone |
| GET | `/api/admin/delivery/drivers` | Admin JWT | List drivers |
| POST | `/api/admin/delivery/drivers` | Admin JWT | Add driver |

All admin endpoints must verify admin role and apply input sanitization.

---

### Phase 3: Buyer Delivery Experience (Effort: M) — 2–3 days

**Objective**: Enhanced delivery selection in wholesale checkout. No geospatial queries.

**Prerequisite**: Phase 2 complete (settings and zones persisted).

#### 3.1 Wholesale Checkout Enhancement

**File**: `greenreach-central/public/GR-wholesale.html`

Replace static delivery fields with dynamic zone-based UI:
- Pickup/delivery fulfillment selector
- Postal code entry (not lat/lng — no geocoding in MVP)
- Server-quoted fee display
- Time window selection from available slots

```html
<div class="delivery-method-selector">
  <h3>Fulfillment Method</h3>
  <div class="method-options">
    <label class="method-option" data-method="pickup">
      <input type="radio" name="fulfillment" value="pickup">
      <div class="option-content">
        <div class="option-icon">🏪</div>
        <div class="option-text">
          <strong>Farm Pickup</strong>
          <span>Pick up at farm location</span>
        </div>
        <div class="option-price">Free</div>
      </div>
    </label>
    <label class="method-option" data-method="delivery">
      <input type="radio" name="fulfillment" value="delivery">
      <div class="option-content">
        <div class="option-icon">🚚</div>
        <div class="option-text">
          <strong>Farm Delivery</strong>
          <span>Delivered to your location</span>
        </div>
        <div class="option-price" id="delivery-fee">—</div>
      </div>
    </label>
  </div>
</div>

<div id="delivery-details" class="hidden">
  <div class="postal-input">
    <label for="delivery-postal">Postal Code</label>
    <input type="text" id="delivery-postal" placeholder="K7L 1A1" maxlength="7">
  </div>
  <div id="zone-result"><!-- Populated by quote API response --></div>
  <div class="time-slot-picker">
    <label>Preferred Delivery Window</label>
    <div id="time-slots" class="time-slot-grid"><!-- Populated via API --></div>
  </div>
</div>
```

#### 3.2 Quote Endpoint (MVP — Zone-Based, No Geospatial)

The existing `POST /api/farm-sales/delivery/quote` endpoint uses the canonical zone-based fee model:

**Input**: `{ postal_code, order_subtotal, requested_window }`  
**Output**: `{ ok, eligible, fee, minimum_order, windows[], reason }`

Zone matching uses `postal_prefix` lookup (Phase 2.2), not `ST_Contains` or PostGIS.

**Backward compatibility**: Existing checkout execute path remains unchanged when delivery is disabled (Architecture Plan AD-03).

---

### Phase 4: Farm Admin Delivery Settings UI (Effort: S) — 1–2 days

**Objective**: Minimal settings form and time-window editor in farm admin surface.

**Prerequisite**: Phase 2 API endpoints functional.

#### 4.1 Settings Form

Add to existing farm admin surface (not a new standalone page unless required):
- Enable/disable delivery toggle
- Base fee input
- Minimum order input
- Lead time (hours) input
- Time window editor (day, start, end, active toggle)

#### 4.2 Read/Write via API

- Read: `GET /api/farm-sales/delivery/settings` + `GET /api/farm-sales/delivery/windows`
- Write: `PUT /api/farm-sales/delivery/settings` + `PUT /api/farm-sales/delivery/windows`
- Basic validation and save feedback in the UI

---

### Phase 5: Central Read-Only Readiness (Effort: S) — 1 day

**Objective**: GreenReach Central admin can see delivery rollout readiness across farms.

#### 5.1 Readiness Card/Table

Add to `GR-central-admin.html`:
- Table showing farms with delivery enabled/disabled
- Windows configured count per farm
- Zones configured count per farm
- Read-only in MVP (Architecture Plan §2: Central admin read-only for MVP)

#### 5.2 Network Delivery API (Central)

Mount in `greenreach-central/server.js`:

```javascript
// Read-only network visibility — admin auth required
router.get('/api/admin/delivery/readiness', requireAdmin, async (req, res) => {
  const readiness = await pool.query(`
    SELECT
      f.name AS farm_name,
      f.farm_id,
      COALESCE(ds.enabled, false) AS delivery_enabled,
      (SELECT COUNT(*) FROM farm_delivery_windows w WHERE w.farm_id = f.farm_id AND w.active) AS window_count,
      (SELECT COUNT(*) FROM farm_delivery_zones z WHERE z.farm_id = f.farm_id AND z.active) AS zone_count
    FROM farms f
    LEFT JOIN farm_delivery_settings ds ON f.farm_id = ds.farm_id
    WHERE f.status = 'active'
    ORDER BY f.name
  `);
  res.json({ success: true, farms: readiness.rows });
});
```

---

### Phase 6: Marketing Pages Update (Effort: S) — 1 day

**Objective**: Announce delivery service on marketing/landing pages — **only what is actually implemented**.

**Constraint**: Every feature claim on a public-facing page must be verifiably implemented and operable end-to-end. Do not advertise Phase 2+ capabilities as available.

#### 6.1 Pages to Update

| Page | Update Type |
|------|-------------|
| `wholesale-about.html` | Add "Farm Delivery — Now Available" section (MVP features only) |
| `wholesale-learn-more.html` | Add delivery benefits |
| `farm-sales-landing.html` | Enhance delivery messaging |

#### 6.2 Content Rules

- **DO describe**: Zone-based delivery, configurable time windows, flexible scheduling, local coverage
- **DO NOT describe**: GPS tracking, SSE streaming, POD-gated payments, driver portals, Stripe Connect payouts, CRA reporting, background checks — unless implemented
- **DO NOT link to**: Pages that don't exist (`driver-apply.html`, `driver-portal.html`)
- **DO NOT claim**: Specific table counts, endpoint counts, or compliance certifications that aren't operational

---

## Mandatory Test Gate (Before Merge)

**No merge to main without all three suites passing.** The absence of tests is not a "nice to have" — multi-tenant scope errors and pricing drift are regression-prone.

### Suite 1: Tenant Isolation Tests

```
GIVEN Farm A creates delivery settings and zones
AND Farm B creates different delivery settings and zones
WHEN Farm A queries settings, windows, zones, and routes
THEN Farm A receives ONLY its own data
AND Farm A receives ZERO records belonging to Farm B
```

Minimum cases:
- Settings read isolation (farm A ≠ farm B)
- Windows read isolation
- Zone read isolation
- Route read isolation (if routes endpoint exists)
- Negative: Farm A cannot write to Farm B's settings

### Suite 2: Auth Matrix Tests

```
GIVEN the following role matrix:
| Endpoint Group           | No Auth | Buyer JWT | Farm JWT | Admin JWT |
|--------------------------|---------|-----------|----------|-----------|
| Farm delivery settings   | 401     | 403       | 200      | 200       |
| Farm delivery quote      | 401     | 200       | 200      | 200       |
| Admin delivery config    | 401     | 403       | 403      | 200       |
| Admin delivery zones     | 401     | 403       | 403      | 200       |
THEN each cell produces the expected HTTP status code
```

### Suite 3: Quote Determinism Tests

```
GIVEN a farm with:
  - delivery enabled
  - base_fee = 5.00
  - zone "K7L" with fee_override = 8.00, min_order_override = 25.00
WHEN POST /quote with postal_code="K7L 3N6", order_subtotal=30.00
THEN response.eligible = true AND response.fee = 8.00

WHEN POST /quote with postal_code="K7L 3N6", order_subtotal=20.00
THEN response.eligible = false AND response.reason contains "minimum order"

WHEN POST /quote with postal_code="M5V 1A1" (no matching zone)
THEN response.eligible = false AND response.reason contains "outside"
```

### Additional Quality Checks

- [ ] `npm run validate-schemas` passes
- [ ] Manual smoke test: banner renders and dismisses on three pages
- [ ] Manual smoke test: wholesale checkout with pickup and delivery
- [ ] Record evidence in PR notes

---

## Regulatory Compliance Requirements

### RC-1: Digital Platform Workers' Rights Act (DPWRA) — Ontario

**Applicability**: If the delivery service offers app-based delivery assignments to independent drivers in Ontario, DPWRA requirements apply for violations on or after July 1, 2025.

**Requirements** (per Ontario government DPWRA guidance):

| Obligation | Description | Implementation Status |
|------------|-------------|----------------------|
| Pay period / pay day | Establish a recurring pay period and pay day | NOT IMPLEMENTED |
| Pay calculation transparency | Provide information about how pay is calculated within a short time of platform access | NOT IMPLEMENTED |
| Assignment-level information | Provide pay and task details for each delivery assignment | NOT IMPLEMENTED |
| Timely payment | Pay must be made no later than the pay day for each pay period | NOT IMPLEMENTED |

**Decision point**: If Ontario driver onboarding is planned for MVP, these obligations become **pre-launch blocking** for any contractor-facing flows. If drivers are internal farm staff (employees), DPWRA does not apply.

**Recommendation**: Do not onboard independent/gig drivers until DPWRA-compliant pay disclosure, pay-period rules, and records are implemented. This is a Phase 2+ item unless the decision is made to launch with contractor drivers immediately.

### RC-2: CRA T4A Box 048 Reporting

**Applicability**: If independent drivers are paid as service providers in Canada, CRA requires that "fees for services" be reported on a T4A slip in box 048. Under CRA administrative policy, a slip must be issued if annual payments exceed $500 (or tax was deducted). GST/HST should not be included in the box amount.

**Requirements:**

| Obligation | Description | Implementation Status |
|------------|-------------|----------------------|
| Driver payment ledger | Ledger keyed by driver, tax year, gross totals, reconciled to payouts | NOT IMPLEMENTED |
| T4A slip generation | Annual T4A slip with box 048 amounts | NOT IMPLEMENTED |
| GST/HST exclusion | Report gross fees excluding sales tax | NOT IMPLEMENTED |

**Recommendation**: Build a `driver_pay_ledger` table before scaling to >5 contracted drivers. This is a Phase 2+ item but must be planned now if the timeline to external drivers is short.

### RC-3: Stripe Connect + POD-Gated Settlement (Phase 2+)

The design direction of POD-gated pay with delayed payouts is sound. Stripe's documentation confirms that manual payouts allow control over payout timing, and that delayed payouts are useful when delivery is delayed or when refunds are possible.

**Implementation path (Phase 2)**:
1. Gate driver settlement on recorded delivery events (POD: signature + photo + GPS)
2. Trigger payouts in scheduled batches (weekly)
3. Use Stripe manual payout controls for timing

**Not in MVP scope.**

---

## Real-Time Updates Architecture (Phase 2+)

If live tracking is a Phase 2 requirement, implement SSE (Server-Sent Events) correctly:

**Requirements** (per MDN EventSource API, WHATWG HTML specification, web.dev):

| Feature | Purpose |
|---------|---------|
| `id:` field on every event | Enables `Last-Event-ID` on reconnect — prevents skipped status transitions |
| `retry:` field | Controls client reconnection timeout for intermittent mobile connectivity |
| Reconnection handling | EventSource automatically reconnects; server must support `Last-Event-ID` header to resume from correct position |
| Event types | Use named event types (`status`, `location`, `eta`) for clean client dispatch |

**Not in MVP scope.** Placeholder architecture note only.

---

## Implementation Timeline (Revised)

| Phase | Description | Effort | Dependencies | Audit Findings Addressed |
|-------|-------------|--------|--------------|--------------------------|
| **0** | **Pre-Launch Remediation** | **3–4d** | None (blocking) | F-1, F-2, F-3, F-4, F-5, F-7, F-8, F-9 |
| 1 | Service Introduction Banner | 1–2d | Phase 0 | — |
| 2 | Delivery Settings Persistence + Zones | 2–3d | Phase 0 | F-3, F-6 (document reconciliation) |
| 3 | Buyer Delivery Experience | 2–3d | Phase 2 | F-4 (canonical fee), F-6 (no PostGIS) |
| 4 | Farm Admin Settings UI | 1–2d | Phase 2 | — |
| 5 | Central Read-Only Readiness | 1d | Phase 2 | F-2 (admin routes live) |
| 6 | Marketing Pages Update | 1d | Phase 3 | F-1 (claims match reality) |
| — | **Mandatory Test Gate** | included | All phases | F-10 |

**Total Estimated MVP Effort**: ~11–16 engineering days  
**Architecture Plan Estimate**: 6–9 engineering days (backend + UI + QA)  
**Reconciliation note**: The Architecture Plan's 6–9 day estimate covers workstreams A–E (backend, farm UI, buyer checkout, central visibility, QA). This plan adds Phase 0 remediation (3–4 days) and regulatory compliance research, bringing the total to 11–16 days. The v1.0.0 estimate of 28 days included Phase 2+ scope (PostGIS, driver dashboard, network coordination) that is now explicitly out of MVP.

---

## Files to Create/Modify

### New Files (Create)

| File | Purpose | Phase |
|------|---------|-------|
| `migrations/001_delivery_mvp_tables.sql` | MVP persistence tables | 0.3 |
| `greenreach-central/public/js/components/service-intro-banner.js` | Reusable banner component | 1 |
| `greenreach-central/public/css/service-intro-banner.css` | Banner styles (theme-compliant) | 1 |

### Existing Files to Modify

| File | Changes | Phase |
|------|---------|-------|
| `delivery-platform.html` | Gate/label as preview, remove broken links, split Available/Planned | 0.1 |
| `greenreach-central/server.js` | Mount `admin-delivery.js` with admin auth | 0.2 |
| `greenreach-central/routes/admin-delivery.js` | Add auth middleware, input sanitization | 0.2 |
| `routes/farm-sales/delivery.js` | Replace in-memory Maps with DB queries, fix tenant isolation, extract window function, remove self-fetch | 0.3, 0.4, 0.6 |
| `src/modules/pricing/cost-allocator.ts` | Archive or delete (dead code) | 0.5 |
| `GR-wholesale.html` | Add banner, enhance delivery checkout with postal code + quote | 1, 3 |
| `LE-farm-admin.html` | Add banner, add delivery settings form | 1, 4 |
| `GR-central-admin.html` | Add banner, add readiness table | 1, 5 |
| `greenreach-central/config/database.js` | Run delivery migration | 0.3 |

### Files to Remove or Archive

| File | Action | Reason | Phase |
|------|--------|--------|-------|
| `src/modules/pricing/cost-allocator.ts` | Archive to `_archived/` or delete | Dead code — never imported (F-4) | 0.5 |

### Files That Must NOT Be Created Yet (Phase 2+)

| File | Reason |
|------|--------|
| `driver-apply.html` | Driver onboarding not in MVP; requires DPWRA compliance first |
| `driver-portal.html` | Driver portal not in MVP |
| `css/gr-delivery.css` | Standalone delivery CSS not justified; use existing theme |
| `greenreach-central/public/views/delivery-calendar.html` | Delivery calendar is Phase 2+ |
| `greenreach-central/routes/network-delivery.js` | Full network coordination is Phase 2+ |

---

## Risk Assessment (Revised)

| # | Risk | Severity | Mitigation | Audit Finding |
|---|------|----------|------------|---------------|
| R-1 | Landing page claims trigger Competition Act review | **Critical** | Phase 0.1 — gate page or add disclaimer immediately | F-1 |
| R-2 | Data loss on EB deploy / process restart | **Critical** | Phase 0.3 — migrate to PostgreSQL before launch | F-3 |
| R-3 | Cross-farm route/address data exposure | **High** | Phase 0.4 — farm_id scoping on all reads/writes | F-8 |
| R-4 | Admin endpoints accessible without auth | **High** | Phase 0.2 — add admin middleware before mounting | F-2, F-7 |
| R-5 | Pricing disputes from inconsistent fee models | **High** | Phase 0.5 — choose one canonical model | F-4 |
| R-6 | DPWRA non-compliance if drivers onboarded in Ontario | **High** | Do not onboard contractors until pay disclosure implemented | RC-1 |
| R-7 | CRA reporting gap for contractor payments | **Medium** | Build ledger before >5 drivers at >$500/year | RC-2 |
| R-8 | Broken 404 links reduce trust | **Medium** | Phase 0.1 — remove links to non-existent files | F-5 |
| R-9 | Self-fetch on localhost fails on different port | **Medium** | Phase 0.6 — replace with direct function call | F-9 |
| R-10 | No regression safety net | **Medium** | Mandatory test gate — 3 suites before merge | F-10 |
| R-11 | Document contradictions cause team confusion | **Medium** | This v2.0.0 supersedes v1.0.0; Architecture Plan is authoritative | F-6 |

---

## Open Decision Points

These questions must be answered before implementation proceeds. The answers will change Phase 0 priorities and schema design.

### DP-1: Ontario Driver Operations Timeline

> **Are you intending to operate the delivery marketplace (drivers receiving assignments) in Ontario immediately?**

- If **YES**: DPWRA disclosure + recurring pay-period/pay-day handling is **pre-launch blocking** for any contractor onboarding flows. Add Phase 0.7 for DPWRA compliance.
- If **NO** (or drivers are farm employees): DPWRA requirements move to Phase 2+ planning. MVP proceeds without contractor-specific flows.

### DP-2: Multi-Tenant Runtime

> **Is the delivery service intended to be multi-tenant across farms in the same runtime instance?**

- If **YES**: Tenant isolation cannot be deferred even for an "internal pilot." The same patterns that leak routes will leak customer addresses. Phase 0.4 is non-negotiable.
- If **NO** (single-farm pilot only): Tenant isolation is still required architecturally but the blast radius is limited. Phase 0.4 remains mandatory but can be validated with simpler tests.

### DP-3: Live Tracking Requirement

> **Do you want "live tracking" as a launch requirement?**

- If **YES**: Implement SSE with event IDs and reconnect semantics (`EventSource` / `Last-Event-ID`) so mobile dropouts don't break the timeline. This adds ~3–5 days and requires event infrastructure. Add Phase 2.5.
- If **NO**: Live tracking moves to Phase 2+. MVP uses manual status updates (scheduled → en route → delivered).

---

## Deployment Gate (Non-Negotiable)

No production deployment actions until user sends exact approval:  
**"APPROVED FOR DEPLOYMENT"**

This includes `eb deploy`, `scp`, `ssh` file edits, and process restarts.

### Pre-Deployment Checklist

- [ ] Phase 0 remediation complete
- [ ] All three test suites passing
- [ ] `npm run validate-schemas` clean
- [ ] Landing page compliance verified (no misleading claims)
- [ ] Admin auth middleware confirmed active
- [ ] Tenant isolation verified with two-farm test
- [ ] Migration applied to target database
- [ ] Architecture Plan conditions of approval met (§13)
- [ ] PR notes include test evidence

---

## Document Reconciliation

This section resolves the contradictions identified in Audit Finding F-6.

| Topic | Architecture Plan (authoritative) | v1.0.0 Implementation Plan | v2.0.0 Resolution |
|-------|-----------------------------------|-----------------------------|--------------------|
| **PostGIS / geo queries** | Deferred to Phase 2 (AD-02) | Phase 3 used `ST_Contains()` | **REMOVED** from MVP. Zone matching uses `postal_prefix` LIKE query. |
| **Zone model** | `zone_mode: postal_prefix \| radius_km` (no polygons) | `zone_polygon JSONB` with geometry cast | **CORRECTED** to `zone_mode` + `zone_value` (string). No polygon column in MVP. |
| **Migration tables** | 3 tables: settings, windows, zones | 3 tables + blackouts, different column specs | **ALIGNED** to Architecture Plan schema. Blackouts deferred. |
| **Effort estimate** | 6–9 engineering days | 28 days (4 weeks) | **RECONCILED**: 11–16 days (6–9 base + 3–4 Phase 0 remediation + buffer). Phase 2+ scope removed. |
| **Phase structure** | Workstreams A–E | Phases 1–6 | **RESTRUCTURED**: Phase 0 (remediation) + Phases 1–6 (aligned to Architecture Plan workstreams). |

---

## Approval Request

**Implementation Plan v2.0.0 Assessment**: Revised post-audit. Addresses all 10 findings from `DELIVERY_SERVICE_AUDIT_REPORT_2026-02-22.md`.

**Conditions for proceeding**:
1. Phase 0 remediation is **blocking** — no customer-facing work until complete.
2. Architecture Plan is the authoritative scope reference. No PostGIS in MVP.
3. All delivery writes must use upsert patterns for idempotency.
4. All endpoints must enforce auth + tenant isolation (deny-by-default).
5. Three test suites must pass before merge.
6. Open decision points (DP-1, DP-2, DP-3) should be answered before Phase 2 work begins.
7. Marketing claims must match operational reality at all times.

---

**Next Step**: Answer open decision points (DP-1, DP-2, DP-3), then begin Phase 0 implementation.
