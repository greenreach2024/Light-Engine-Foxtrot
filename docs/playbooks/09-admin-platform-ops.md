# 09 — Admin & Platform Ops Playbook

**Owner:** Central admins; agent-supported by F.A.Y.E. + Admin-Ops-Agent + Setup-Agent
**Canonical reference:** `.github/COMPLETE_SYSTEM_MAP.md` §5.2 Platform Admin Sites & §5.7 Admin Tooling
**Related docs:** Playbook 01 (security), Playbook 02 (agents), Playbook 08 (deploy)

---

## 1. Purpose & scope

GreenReach Central is **the business**: it onboards farms, manages users, operates the wholesale marketplace, runs marketing, coordinates research governance, bills subscriptions, and provides cross-farm intelligence to admins and (in aggregated form) to the network. This playbook covers everything an admin or platform ops engineer does **outside** a single farm's runtime. Read it before adding admin endpoints, admin UI, cross-farm reports, or platform-ops automation.

## 2. Admin surfaces

| Surface | File | Purpose |
|---|---|---|
| Central Admin home | `greenreach-central/public/GR-central-admin.html` | Tabbed home — farms, users, wholesale, marketing, research governance, AI, billing (AI monitoring + platform monitoring live as views inside this file, not separate pages) |
| Admin login | `greenreach-central/public/GR-central-admin-login.html` | Central staff login (email + password + MFA) |
| Farm admin login | `greenreach-central/public/farm-admin-login.html` | Per-farm operator login (separate auth system from Central admins — see Playbook 01 §2) |
| Farm setup wizard | `greenreach-central/public/setup-wizard.html` | 12-phase farm registration |
| Driver enrollment | `greenreach-central/public/driver-enrollment.html` | Driver intake |
| F.A.Y.E. panel | Embedded in `GR-central-admin.html` | Cross-farm AI |
| Admin-Ops-Agent | Backend agent invoked from admin chat | Runbooks / platform ops |

## 3. Core data model

### 3.1 Platform-level tables
- `farms` — farm registry (id, slug, display_name, tier, status, stripe_customer_id, square_oauth_ref)
- `admin_users` — admin accounts (email, password_hash, role, MFA fields, lockout)
- `admin_sessions` — active admin JWTs
- `admin_audit_log` — every admin action
- `feature_flags` — global + per-farm overrides
- `platform_alerts` — system-level alerts (not farm alerts)

### 3.2 Network intelligence (aggregates)
- `crop_benchmarks`, `demand_signals`, `recipe_modifiers`, `environment_benchmarks`, `risk_alerts`, `pricing_intelligence`
- Populated by cross-farm aggregation jobs; exposed via `/api/network/*`

## 4. Farm onboarding (12-phase setup)

**Agent:** `Setup-Agent` (`greenreach-central/routes/setup-agent.js`)
**UI:** `greenreach-central/public/setup-wizard.html`

Phases (12 total, code-authoritative IDs in parentheses):
1. Farm Profile (`farm_profile`) -- identity, contact, location
2. Room Design (`room_design`) -- physical rooms with dimensions (length, width, area, ceiling height), installed grow-system templates from `grow-systems.json` (formerly separate `grow_rooms` + `room_specs` phases, merged Apr 2026)
3. Build Plan (`build_plan`) -- computed electrical/climate load plan per room (uses `farm-load-calculator.js` via `/api/grow-systems/compute-room-load`)
4. Climate Zones (`zones`) -- zone definitions within rooms
5. Grow Groups (`groups`) -- plant groupings within zones
6. Crop Selection (`crop_assignment`) -- assign crops to groups
7. Environment Targets (`env_targets`) -- temp/RH/VPD/CO2 targets per zone
8. Light Fixtures (`lights`) -- fixture types and placements
9. Light Schedules (`schedules`) -- photoperiod on/off cycles
10. IoT Devices (`devices`) -- SwitchBot sensor + relay mapping
11. Planting Plan (`planting`) -- initial seeding schedule
12. Integrations (`integrations`) -- Square, wholesale, external services

Progress stored per farm; admin + Setup-Agent can resume mid-phase. Old phase IDs (`grow_rooms`, `room_specs`) remap to `room_design` for backwards compatibility.

> **Source of truth:** the runtime phase catalogue lives in `greenreach-central/routes/setup-agent.js` `PHASES[]` and is what `GET /api/setup-agent/progress` evaluates. Each phase today performs **existence checks only** (did the farm enter X?), no recommendation logic. The active Farm-Builder paradigm — where the system recommends rooms / zones / equipment from location + growing system + crop plan — is layered on top of these phases via **Playbook 10**. Phase 7 ("Rooms + groups") and Phase 8 ("Crop registry + target ranges") will gain a new `growing_system_choice` sub-phase between them in Playbook 10 Phase B1, so the builder can be invoked before crops are picked.

### 4.1 Farm Builder integration (Playbook 10)

When `PLATFORM_FARM_BUILDER_ENABLED=1`, the 12-phase graph gains:
- A `growing_system_choice` sub-phase (between 7 and 8) surfacing `grow-systems.json.templates[]` with suitability filters
- An optional `build` step backing onto `/api/farm-builder/propose` → reviewable proposal in `farm_proposals`
- An `accept` action (EVIE `explicit_confirm` tier) that writes rooms / zones / groups / devices in bulk and stamps `groups[*].planConfig.template_id`

Until the flag is on, the passive flow (phases 6–8 as-is) remains the only path.

## 5. User & role management

### 5.1 Admin users
- Roles: `admin` (full), `editor` (read/write except sensitive platform ops), `viewer` (read-only)
- MFA + lockout enforced on login
- Admin sessions auto-expire every 12h; cleanup every 30 min
- Audit log capture: every mutating handler writes to `admin_audit_log`; the reader is served inline in `greenreach-central/server.js` at `/api/audit/recent` (there is no dedicated `admin-audit.js` route file today)

### 5.2 Farm users (per tenant)
- Managed from the admin home (admin bypass) OR from LE farm-admin by the farm's own admin
- Roles: `admin`, `manager`, `operator`, `viewer` (+ sales-only flag)
- Password resets triggered by admin or self-service via email

## 6. Feature flags

**Middleware:** `server/middleware/feature-flags.js` (repo root; imported by `server-foxtrot.js` ~L211). Exposes `autoEnforceFeatures()` + per-route `requireFeature()` guards.
**Storage:** `feature_flags` table (global defaults per tier; per-farm overrides keyed by `farm_id`).
**Tiers:** `full`, `inventory-only`, `research`.

- LE wires `autoEnforceFeatures()` at boot; its gating is therefore active on every LE request path.
- **C1 gap (see Playbook 01 §8, Playbook 06 §7.4):** `greenreach-central/server.js` does **not** currently import or apply `autoEnforceFeatures()`. An earlier attempt to import the LE middleware into Central was reverted because the Central bundle excludes `server/middleware/`. Resolution paths under discussion: (a) duplicate the middleware into `greenreach-central/middleware/`, (b) extract into a shared package, or (c) add inline `requireFeature()` guards at each Central-side research/commerce route.
- No dedicated admin toggle endpoint (`admin-feature-flags.js`) exists today. Per-farm flag rows are currently modified via direct DB access / migration + the `feature_flags` table seed. Surfacing a toggle UI is open work.

**Fail-open caveat:** see Playbook 01 §8 — gate is fail-open on DB outage.

## 7. Network intelligence (cross-farm)

**File:** `greenreach-central/routes/network-growers.js`
**Admin UI:** `GR-central-admin.html` → Network tab

- Aggregates environment, crop, and demand data across farms into **anonymized benchmarks**
- Individual farm records are never exposed to other farms' admins
- Admin view shows identified per-farm data; aggregate view shows anonymized percentiles
- Powers F.A.Y.E.'s cross-farm recommendations + Farm-Ops-Agent's demand inputs

### 7.1 Key endpoints
| Path | Purpose |
|---|---|
| `/api/network/benchmarks` | Anonymized benchmarks (admin only or aggregated access) |
| `/api/network/trends` | Trend charts (farm-scoped must include own context) |
| `/api/network/demand` | Demand forecasts for each crop |
| `/api/network/recipe-modifiers` | Environment modifiers learned from the network |

## 8. Admin-Ops-Agent

**File:** `greenreach-central/routes/admin-ops-agent.js`
**LLM:** GPT-4o

- Runs ops-style actions: "which farms are down?", "rebuild a farm's env cache", "rotate a secret", "generate today's revenue report"
- All actions routed through F.A.Y.E. escalation where authority is ambiguous
- Cost tracked via `ai-usage-tracker.js`

## 9. Key admin endpoints

These are the **Central-side** admin endpoints (platform admin surface). All paths are relative to `greenreach-central/`. Where the "File" column says *inline in `server.js`* or *inline in `routes/admin.js`*, no separate route file exists — the handlers live directly in that parent file. A smaller set of `/api/admin/*` endpoints is also served by **LE** (`server-foxtrot.js`) — see §9.1 for the LE-side admin surface.

| Mount | File | Purpose |
|---|---|---|
| `/api/admin/auth` | `routes/admin-auth.js` (mounted at `server.js` L3746) | Login, MFA, refresh, logout |
| `/api/admin` (root router) | `routes/admin.js` (mounted at `server.js` L3824) | Parent router; applies `adminAuthMiddleware` and sub-mounts the per-domain admin routers below |
| `/api/admin/wholesale` | `routes/admin-wholesale.js` (sub-mounted via `routes/admin.js`) | Marketplace admin |
| `/api/admin/recipes` | `routes/admin-recipes.js` (sub-mounted via `routes/admin.js`) | Recipe library + deployment |
| `/api/admin/pricing` | `routes/admin-pricing.js` (sub-mounted via `routes/admin.js`; also mounted directly at `server.js` L4112) | Wholesale pricing |
| `/api/admin/delivery` | `routes/admin-delivery.js` (sub-mounted via `routes/admin.js`) | Delivery zones, windows, driver intake (see Playbook 04) |
| `/api/admin/ai` | `routes/admin-ai-monitoring.js` (sub-mounted via `routes/admin.js`) | Agent cost + health dashboards |
| `/api/admin/marketing` | `routes/admin-marketing.js` (sub-mounted via `routes/admin.js`; also mounted directly at `server.js` L3832) | Campaign queue, publish, settings |
| `/api/admin/salad-mixes` | `routes/admin-salad-mixes.js` (direct mount `server.js` L3823) | Salad-mix SKU admin |
| `/api/admin/farms`, `/api/admin/users`, `/api/admin/grants/*`, `/api/admin/ai-rules`, `/api/admin/ai-reference-sites` | inline in `routes/admin.js` | Farm CRUD, admin user mgmt, farm-user mgmt (`/farms/users`, `/farms/:farmId/reset-credentials`), grant program admin, AI rules config |
| `/api/admin/farms/:farmId/slug`, `/api/admin/farms/:farmId/devices`, `/api/admin/seed-farm`, `/api/admin/seed-pricing`, `/api/admin/test-email` | inline in `server.js` (L1984–L2646 range) | Slug get/put, per-farm device list, seed helpers |
| `/api/admin/assistant` | `routes/admin-assistant.js` (direct mount `server.js` L3828) | F.A.Y.E. admin AI assistant |
| `/api/admin/ops` | `routes/admin-ops-agent.js` (direct mount `server.js` L3829) | Admin-Ops-Agent runbooks |
| `/api/admin/calendar` | `routes/admin-calendar.js` (direct mount `server.js` L3830) | F.A.Y.E. tool catalog & gateway |
| `/api/admin/scott` | `routes/scott-marketing-agent.js` (direct mount `server.js` L3831) | S.C.O.T.T. marketing agent |
| `/api/admin/network-devices` | `routes/network-devices.js` (direct mount `server.js` L3827) | Network device analytics (I-3.11) |
| `/api/network/*`, `/api/growers/*`, `/api/contracts/*`, `/api/farms/list` | `routes/network-growers.js` (mounted under `/api` at `server.js` L4218) | Cross-farm intelligence (not prefixed `/api/admin/`) |
| `/api/audit/recent` | inline in `server.js` (L2663) | Admin-readable audit log (not under `/api/admin/`) |
| `/api/billing`, `/api/billing/receipts` | `routes/billing.js`, `routes/billing-receipts.js` (mounted at `server.js` L4101–L4102 under `authOrAdminMiddleware`) | Subscription + receipts (accepts farm OR admin auth) |
| `/api/accounting` | `routes/accounting.js` (mounted at `server.js` L4105 under `authOrAdminMiddleware`) | Ledger + close controls |
| Research admin | `routes/research-*.js` (see Playbook 06 §4) | Research governance |

**Endpoints that are *not* implemented on Central today** (referenced in earlier drafts, kept for change-tracking): `/api/admin/audit` (use `/api/audit/recent` inline at `greenreach-central/server.js` L2663 instead), `/api/admin/feature-flags` (no toggle endpoint — see §6). `/api/admin/health` is not on Central but **is** on LE (see §9.1).

### 9.1 LE-side admin surface

LE (`server-foxtrot.js`) mounts its own `/api/admin/*` endpoints that farm admins hit directly against LE (all paths relative to the LE repo root):

| Mount | File | Purpose |
|---|---|---|
| `/api/admin/auth` | `server/routes/admin-auth.js` (mounted `server-foxtrot.js` L13559) | LE admin auth (separate from Central `admin_users` table) |
| `/api/admin/health` | `routes/admin-health.js` (mounted `server-foxtrot.js` L13566) | LE-side health dashboard |
| `/api/admin/pricing` | `routes/admin-pricing.js` (mounted `server-foxtrot.js` L13576) | LE-side pricing admin |
| `/api/admin/wholesale` | `routes/admin-wholesale-buyers.js` (mounted `server-foxtrot.js` L14011) | LE-side wholesale-buyers admin (distinct from Central's `admin-wholesale.js`) |
| `/api/admin` (farm management) | `routes/admin-farm-management.js` (mounted `server-foxtrot.js` L14623) | LE-side farm-management endpoints |
| `/api/admin/assistant`, `/api/admin/calendar` | Proxy middleware in `server-foxtrot.js` L24097, L24145 | Forwarded to Central's F.A.Y.E. calendar + assistant |
| `/api/audit/*` | `createAuditRoutes()` factory mounted at `server-foxtrot.js` L14328 | LE-side audit log query API (`/logs`, `/entity/:type/:id`, `/user/:user_id`, `/summary`, `/export`) |

Note: Central's `/api/admin/*` routes are the canonical platform-admin surface; LE's `/api/admin/*` routes are per-farm administrative endpoints scoped to that farm's tenant. Do not conflate them when adding new admin endpoints.

## 10. Security & tenancy rules

- All admin endpoints require valid admin JWT + (where sensitive) MFA
- RLS admin bypass is **explicit** via `{ isAdmin: true }` (Playbook 01 §5.3)
- Sensitive endpoints (billing, secrets, farm deletion) restricted to `admin` role
- All state-changing admin actions must write to `admin_audit_log`
- Admin UI pages must not embed LE farm UIs cross-origin (CSP blocks it; use Central equivalents)

## 11. Platform alerting

- `platform_alerts` table for system-level events (not farm alerts)
- F.A.Y.E. surfaces unresolved alerts on the admin home
- Categories: deployment failure, DB pool saturation, webhook signature failure, AI spend spike, mass subscription failure

## 12. Reports & exports

- Revenue report, commission report, per-farm payout report (`/api/reports/*`)
- Research governance reports (signoff status, COI coverage, HQP funding) — Playbook 06
- Network health report (anonymized) — shared with partner institutions under agreement
- CSV + PDF exports; large exports run async via Cloud Scheduler

## 13. Never do

- Expose per-farm identified data across farms in anonymized network views
- Grant `admin` role without MFA enrollment
- Skip `admin_audit_log` write on a mutating admin action
- Delete a farm's data via admin UI without backups and written authorization
- Bypass feature flag middleware in admin-authored endpoints (admin should respect tiers for farm experience parity)
- Ship platform-wide rules engine changes without a staged rollout

## 14. Known gaps / open items

- Feature gate fail-open on DB outage (Playbook 01)
- MFA is email-based today; TOTP / FIDO2 pending
- Reports are mostly CSV; BI integration (Looker/Metabase) is future work
- Admin audit log schema partially normalized; rich diff capture pending
- Driver operations (Playbook 04) incomplete beyond MVP intake

## 15. References

- `.github/COMPLETE_SYSTEM_MAP.md` §5.2, §5.7, §6 (data flows)
- `.github/READINESS_REPORT_APR2026.md`
- `greenreach-central/routes/setup-agent.js`, `admin-ops-agent.js`, `admin-assistant.js` (F.A.Y.E.)
- `greenreach-central/routes/admin.js` (parent admin router with inline farms/users/grants handlers) + the `admin-*.js` siblings listed in §9
- `greenreach-central/routes/network-growers.js`, `network-devices.js`
- `server/middleware/feature-flags.js` (LE-side gate; C1 gap on Central — see §6)
- Playbook 01 (security), Playbook 02 (agents), Playbook 03 (commerce), Playbook 06 (research), Playbook 08 (deploy)
