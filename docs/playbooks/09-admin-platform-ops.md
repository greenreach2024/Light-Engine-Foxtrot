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
| Central Admin home | `greenreach-central/public/GR-central-admin.html` | Tabbed home — farms, users, wholesale, marketing, research governance, AI, billing |
| Admin login | `greenreach-central/public/admin-login.html` | Email + password + MFA |
| Farm setup wizard | `greenreach-central/public/central-farm-setup.html` | 12-phase farm registration |
| Producer onboarding | `greenreach-central/public/producer-onboarding.html` | External producer intake |
| Driver enrollment | `greenreach-central/public/driver-application.html` | Driver intake |
| Admin AI monitoring | `greenreach-central/public/admin-ai-monitoring.html` | Agent health + cost dashboards |
| F.A.Y.E. panel | Embedded in admin home | Cross-farm AI |
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
**UI:** `central-farm-setup.html`

Phases (high level):
1. Farm owner identity + contact
2. Business legal + tax
3. Square OAuth connection (Playbook 03)
4. Stripe subscription selection
5. `farm_slug` selection + reservation (the slug is reserved today; DNS / `<slug>.greenreachgreens.com` activation is pending the subdomain rollout — see Playbook 01 §7)
6. Hardware registry (SwitchBot devices + mapping)
7. Rooms + groups (physical + logical layout)
8. Crop registry + target ranges
9. Schedules + photoperiod defaults
10. Inventory seed + pricing
11. Wholesale opt-in + SKU factor
12. Go-live review + activation

Progress stored per farm; admin + Setup-Agent can resume mid-phase.

## 5. User & role management

### 5.1 Admin users
- Roles: `admin` (full), `editor` (read/write except sensitive platform ops), `viewer` (read-only)
- MFA + lockout enforced on login
- Admin sessions auto-expire every 12h; cleanup every 30 min
- Audit log captures every change via `admin-audit.js`

### 5.2 Farm users (per tenant)
- Managed from the admin home (admin bypass) OR from LE farm-admin by the farm's own admin
- Roles: `admin`, `manager`, `operator`, `viewer` (+ sales-only flag)
- Password resets triggered by admin or self-service via email

## 6. Feature flags

**File:** `greenreach-central/config/feature-flags.js`, `routes/admin-feature-flags.js`

- Global flags default per tier (`full`, `inventory-only`, `research`)
- Per-farm overrides stored in `feature_flags` with `farm_id`
- `autoEnforceFeatures()` middleware gates endpoints
- Admin UI: toggle and view effective flag per farm

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

| Mount | File | Purpose |
|---|---|---|
| `/api/admin/auth` | `admin-auth.js` | Login, MFA, refresh, logout |
| `/api/admin/farms` | `admin-farms.js` | Farm CRUD |
| `/api/admin/users` | `admin-users.js` | Admin user mgmt |
| `/api/admin/farm-users` | `admin-farm-users.js` | Farm user mgmt (admin bypass) |
| `/api/admin/billing` | `billing.js`, `admin-billing.js` | Subscription admin |
| `/api/admin/accounting` | `accounting.js` | Ledger admin |
| `/api/admin/wholesale` | `admin-wholesale.js` | Marketplace admin |
| `/api/admin/marketing` | `admin-marketing.js` | Campaigns + S.C.O.T.T. admin |
| `/api/admin/research` | `research-*.js` | Research governance |
| `/api/admin/ai-monitoring` | `admin-ai-monitoring.js` | Agent cost + health |
| `/api/admin/feature-flags` | `admin-feature-flags.js` | Feature flag mgmt |
| `/api/admin/network` | `network-growers.js` | Cross-farm intelligence |
| `/api/admin/audit` | `admin-audit.js` | Audit log reader |
| `/api/admin/health` | `admin-health.js` | System health dashboard |

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
- `greenreach-central/routes/admin-*.js`, `network-growers.js`
- Playbook 01 (security), Playbook 02 (agents), Playbook 03 (commerce), Playbook 06 (research), Playbook 08 (deploy)
