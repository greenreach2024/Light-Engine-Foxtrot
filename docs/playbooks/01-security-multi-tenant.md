# 01 — Security & Multi-Tenant Isolation Playbook

**Owner:** F.A.Y.E. / platform admins
**Canonical references:** `.github/COMPLETE_SYSTEM_MAP.md` §9 (Authentication Architecture), `.github/RESEARCH_PLATFORM_AUDIT.md`, `docs/architecture/MULTI_TENANT_ARCHITECTURE.md`, `docs/security/`

---

## 1. Purpose & scope

This playbook governs how Foxtrot keeps one farm's business data **private to that farm**, while still allowing growing-environment and research data to be **shared with researchers and network intelligence**. Read this before you touch any of: auth middleware, DB query wrappers, JWT issuance, feature gates, API-key sync, tenant context resolution, or RLS policies.

## 2. The central design rule

> **Financial, customer, and wholesale-order data MUST be scoped to a single farm.
> Environmental, recipe, and research data MAY be shared — under governance.**

Every schema decision, route, and middleware in this repo must be compatible with that rule. If you cannot state in one sentence why a new endpoint does not leak a farm's private data, do not merge it.

## 3. Data classification

| Class | Examples | Isolation mechanism |
|---|---|---|
| **Farm-private** | `farm_users`, `wholesale_orders`, `payment_records`, `accounting_*`, `farm_inventory`, `products`, `delivery_orders`, `producer_accounts`, `farm_alerts`, POS transactions, Square OAuth tokens | PostgreSQL Row-Level Security + `farm_id` scoping + JWT / `X-Farm-ID` / middleware-derived tenant context (subdomain-based resolution is **planned**, not live today — see §7) |
| **Farm-owned operational** | `groups`, `rooms`, `schedules`, `devices`, `tray_runs`, `harvest_events`, `lot_records`, `farm_data` | `farm_id` scoping + farmStore per-farm Maps |
| **Network-shared aggregates** | `crop_benchmarks`, `demand_signals`, `recipe_modifiers`, `risk_alerts`, `environment_benchmarks`, `pricing_intelligence` | Admin-only cross-farm views; `/api/network/*` |
| **Research (governed sharing)** | `studies`, `datasets`, `recipe_versions`, `metadata_registry`, `data_dictionary_entries`, `grant_applications`, `grant_publications` | `farm_id` scoping + data-sharing agreements + ORCID-linked research roles |
| **Telemetry (aggregated)** | SwitchBot readings, VPD, kWh | Per-farm collection; anonymized/aggregated for cross-farm trends |

## 4. Authentication systems

Foxtrot runs **three** distinct authentication systems. Never mix them.

### 4.1 Farm user auth (JWT, 24h)
- Table: `farm_users` (bcrypt password hashing)
- Login: `POST /api/auth/login { farm_id, email, password }`
- JWT payload: `{ farm_id, user_id, role, email }`
- Secret: `JWT_SECRET` (Secret Manager)
- Storage on client: `localStorage.token` AND `sessionStorage.token` — UI pages must read from both
- Required headers outbound: `Authorization: Bearer <token>`, `x-farm-id: <farm>` when available
- Roles: `admin`, `manager`, `operator`, `viewer`, plus sales-only feature flag

### 4.2 Admin auth (JWT, 12h)
- Table: `admin_users` (bcrypt + MFA + lockout)
- Login: `POST /api/admin/auth/login { email, password }`
- JWT payload: `{ adminId, email, role, name }`
- Storage on client: `localStorage.admin_token`
- Session table: `admin_sessions` (auto-cleaned every 30 min)
- Roles: `admin`, `editor`, `viewer`
- Admin JWTs **can bypass RLS** via `app.is_admin = true`. Use this sparingly and always explicitly (`query(sql, params, { isAdmin: true })`).

### 4.3 LE ↔ Central sync (API key, no expiry)
- Headers: `X-API-Key` + `X-Farm-ID`
- Key source (farm side): `config/edge-config.json` → `apiKey` field
- Key validation (Central): `farms` table → `farm-api-keys.json` fallback
- Used by: `services/sync-service.js`, cross-server proxies (e.g., Central `/env` → LE `/env` fallback)
- Central→LE proxy uses `GREENREACH_API_KEY` env var

### 4.4 Farm context extraction priority (Central)
When a request hits Central, farm context is resolved in this exact order:
1. JWT `Authorization: Bearer <token>` → farm_id from payload
2. `X-Farm-ID` header (API key auth path)
3. Subdomain slug from `Host` header → DB lookup on `farms.farm_slug` (**planned path**; see §7 — subdomain routing is not live in production today)
4. `FARM_ID` env var (single-farm mode)

Implementation:
- **LE side:** `server/middleware/multi-tenant.js` (`extractTenantId(req)` → `req.tenant = { slug, farmId }`); LE's `lib/farm-store.js` exports `FarmScopedStore` / `farmStores` / `ensureFarmInitialized` (no `farmIdFromReq` helper).
- **Central side:** `greenreach-central/lib/farm-data-store.js` exports `farmStore.farmIdFromReq(req)` (used throughout `greenreach-central/server.js`); there is no `middleware/tenant.js` and no request-middleware-based extraction — routes call `farmIdFromReq` inline. `X-Farm-ID` / JWT farm_id arrives from the client (or admin bypass is used).

## 5. Row-Level Security (RLS) — Phase A

PostgreSQL RLS is **ENABLED** (not FORCED) on 19 tenant-scoped tables via Migration 040 in `greenreach-central/config/database.js`. Phase B (FORCE owners) is planned but not active.

### 5.1 Policy
```sql
-- gr_tenant_isolation, applied per tenant table
USING (
  current_setting('app.current_farm_id', true) = farm_id::text
  OR current_setting('app.is_admin', true) = 'true'
)
```

### 5.2 Tenant-scoped tables (19)
`farms`, `farm_backups`, `farm_data`, `farm_heartbeats`, `planting_assignments`, `experiment_records`, `products`, `farm_inventory`, `farm_users`, `farm_delivery_settings`, `farm_delivery_windows`, `farm_delivery_zones`, `delivery_orders`, `farm_alerts`, `conversation_history`, `harvest_events`, `lot_records`, `producer_accounts`, `producer_applications`.

### 5.3 Query wrapper (mandatory)
Defined in `greenreach-central/config/database.js`. Always use it — do not call `pool.query` directly for tenant data.

```js
// Standard farm-scoped query
await query(sql, [farmId], { farmId });

// Admin cross-farm query (EXPLICIT opt-in)
await query(sql, params, { isAdmin: true });

// Migration / schema query (no tenant context)
await query(sql, params, { skipTenantContext: true });
```

The wrapper calls `set_config('app.current_farm_id', ...)` and `set_config('app.is_admin', ...)` on the acquired client, then **resets both** in a `finally` block before releasing. Anything that skips the wrapper defeats RLS.

### 5.4 Fail-closed endpoints (Phase A hardening)
These endpoints were hardened to **reject** requests lacking context, instead of silently falling back to unscoped reads:
- `/api/ai/status` — 401 if no farm context
- `/api/network/benchmarking` — 403 if not admin
- `/api/network/trends` — 401 if no farm context

When adding cross-farm endpoints, copy this fail-closed pattern.

### 5.5 Phase B (planned, not live)
- Add `FORCE ROW LEVEL SECURITY` so table owners (migrations / DB superuser) also subject to policy
- Audit every migration that assumes owner bypass
- Convert remaining fail-open feature gates to fail-closed

## 6. Client-side tenant isolation

On login and token expiry, all farm-scoped browser storage keys are cleared. This prevents a signed-out user from leaving behind data that a new user on the same browser could see.

- `clearStaleFarmData()` in `public/farm-admin.js` — on login success
- `clearFarmStorage()` in `public/auth-guard.js` — on all 5 expiry/invalid paths (401, expired JWT, logout, tenant mismatch, force-logout push)
- Storage keys scoped per-farm use prefixes; never store cross-farm blobs under a single key

Testing rule: after logout, opening devtools → Application → localStorage should show **no** `farm:*`, `groups:*`, `schedules:*`, `sales:*`, or `inventory:*` keys.

## 7. Subdomain multi-tenancy (PLANNED — not live today)

Per-farm `<slug>.greenreachgreens.com` routing is the target multi-tenant topology described in `docs/architecture/MULTI_TENANT_ARCHITECTURE.md`. **It is not live in production today.** Current runtime facts:

- `greenreachgreens.com` is **Central's** custom domain (pending DNS migration from CloudFront; `.github/CLOUD_ARCHITECTURE.md` §Cloud Run Services and §DNS/Custom Domains).
- LE has **no** custom domain. LE is reached via its Cloud Run default URL (`https://light-engine-*.run.app`).
- `*.greenreachgreens.com` wildcard DNS and wildcard TLS are **not** configured in production today.
- Do **not** assume `foxtrot.greenreachgreens.com` (or any `<slug>.greenreachgreens.com`) resolves — see `.github/copilot-instructions.md` "DO NOT assume `foxtrot.greenreachgreens.com` resolves (it does not)."

What **is** real in the code today:

- Slug generated during setup via `lib/slug-generator.js`; stored in `farms.farm_slug` (UNIQUE).
- Middleware `server/middleware/multi-tenant.js` → `extractTenantId(req)` → `req.tenant = { slug, farmId }` exists and is exercised for requests that already carry tenant signals (JWT / `X-Farm-ID` / `X-Tenant-Id`).
- `validateTenant` enforces that the resolved farm exists and is active.
- Local dev override: `X-Tenant-Id` header.

When the subdomain rollout happens, the planned activation steps are: (a) create Cloud Run domain mapping(s) / Cloud Load Balancer + wildcard cert, (b) enable `Host`-header tenant resolution in `multi-tenant.js`, (c) extend CORS/CSP allowlists to cover `*.greenreachgreens.com`, (d) propagate subdomain-aware URLs to Square OAuth redirect URIs and marketing assets.

## 8. Feature gates

Plan tiers and the `autoEnforceFeatures()` / `requireFeature()` guards live in `server/middleware/feature-flags.js` (LE-side; imported by `server-foxtrot.js` ~L211). Per-farm overrides are stored in the `feature_flags` table. See Playbook 09 §6 for the Central-side C1 gap.

| Tier | Enables |
|---|---|
| `inventory-only` | Inventory + farm sales basics |
| `full` | All operator features |
| `research` | Research workspace + G.W.E.N. |
| (ad hoc) | Per-farm feature flags override tier defaults |

**Known gaps (from `.github/RESEARCH_PLATFORM_AUDIT.md`):**
- **C1 (open):** `autoEnforceFeatures()` is applied in LE (`server-foxtrot.js`) but **not** in `greenreach-central/server.js`. A direct import was attempted and reverted because Central's deploy bundle excludes the LE `server/middleware/` path. The audit's resolution path is: (a) duplicate the middleware under `greenreach-central/middleware/`, (b) extract it to a shared package, or (c) add inline `requireFeature('research_workspace')` checks at each Central research-route mount. Today, direct `/api/research/*` calls on Central are only gated by `authMiddleware`, not by tier — do not activate the research tier externally until this is resolved.
- **Secondary:** even when the gate is present, it is intentionally **fail-open** on DB outage (availability-first tradeoff). Close both issues before activating paid research tier to external customers.

## 9. Research platform governance (data sharing layer)

Even within the research bubble, sharing is explicit:

- `research-partners.js` — partner institutions, data-sharing agreements
- `research-security.js` — data classifications, access policies, security incidents
- `research-audit.js` — immutable audit log, COI declarations, signoffs, approval chains, contributions
- Roles (ORCID-linked): PI, Co-PI, Postdoc, Grad Student, Technician, Collaborator, Viewer
- Dataset exports require a matching data-sharing agreement

When building new research endpoints, every sub-resource handler must verify parent ownership (`C2` remediation in the research audit: 62/84 endpoints originally skipped this and were subsequently patched via `greenreach-central/middleware/research-tenant.js`).

## 10. Rate limiting & abuse controls

- Central global limit: **500 req / 15 min** per IP (skips `/api/debug/*` only; `/api/sync/*` is **not** exempt — see `greenreach-central/server.js` ~L1889)
- Per-route overrides on AI chat endpoints (20 req/min per farm)
- OAuth state tokens: HMAC-SHA256 signed, 15-minute TTL, nonce-based
- Admin login: lockout after repeated failures (`admin_users` lockout columns)
- Webhook endpoints: Square + Stripe signatures validated (`SQUARE_WEBHOOK_SIGNATURE_KEY`, `STRIPE_WEBHOOK_SECRET`)

## 11. Transport & headers

- Helmet with a **strict CSP** (iframe sources explicitly listed)
- HTTPS redirect in cloud mode
- HSTS enabled in production
- CORS allowlist today: `greenreachgreens.com`, `urbanyeild.ca`, `localhost`. `*.greenreachgreens.com` is listed in the registry in anticipation of the subdomain rollout but **no subdomains resolve in production today** (see §7).
- Never redirect UI page requests cross-origin between `light-engine` and `greenreach-central` — breaks CSP, iframes, session cookies

## 12. Secrets management

**All** production secrets live in Google Secret Manager and are injected as env vars on Cloud Run.

| Secret | Purpose |
|---|---|
| `JWT_SECRET` | Farm user + admin JWT signing |
| `ALLOYDB_PASSWORD` (a.k.a. `DB_PASSWORD`) | PostgreSQL |
| `SQUARE_APP_ID`, `SQUARE_APP_SECRET`, `SQUARE_ACCESS_TOKEN`, `SQUARE_LOCATION_ID`, `SQUARE_WEBHOOK_SIGNATURE_KEY` | Payments |
| `STRIPE_WEBHOOK_SECRET` | Subscription webhooks |
| `SWITCHBOT_TOKEN`, `SWITCHBOT_SECRET` | Sensor polling |
| `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` | Google Workspace SMTP |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` | E.V.I.E. / F.A.Y.E. LLMs |
| Google Vertex AI | ADC (no explicit key) — used by S.C.O.T.T. and G.W.E.N. |
| `GREENREACH_API_KEY` | Central→LE proxy API key |
| `TOKEN_ENCRYPTION_KEY` | At-rest encryption of stored OAuth tokens |

Do **not** log secrets; `greenreach-central/utils/logger.js` redacts well-known keys but cannot save you from a `console.log(process.env)`. LE-side logging uses `lib/logger.cjs`.

## 13. Audit logging

- **Tool gateway audit log**: every agent-invoked action writes to `/audit-log` (see Playbook 02 §5)
- **Admin audit**: `admin_audit_log` table records admin actions (login, user changes, farm creation, etc.)
- **Research audit**: `research_audit` tables record immutable study events, COI declarations, signoffs
- **Security audit middleware**: logs suspicious patterns (failed logins, RLS violations, over-fetch attempts)

## 14. Security testing checklist

Before merging any change that touches auth, RLS, or tenancy:

- [ ] New tenant tables have `farm_id NOT NULL` and RLS enabled with `gr_tenant_isolation`
- [ ] New endpoints resolve `req.farmId` via middleware, not query params
- [ ] Sub-resource endpoints verify `parent.farm_id === req.farmId`
- [ ] Cross-farm endpoints return 403 unless `req.adminAuthenticated`
- [ ] Every SQL call uses the `query(sql, params, options)` wrapper
- [ ] No secrets in logs, errors, or response bodies
- [ ] Farm subdomain still resolves to correct `farm_id`
- [ ] Client storage cleared on logout

## 15. Never do

- Call `pool.query` directly for tenant data (bypasses RLS)
- Pass `farm_id` from a query param / request body instead of from auth context
- Use admin bypass (`{ isAdmin: true }`) in non-admin routes
- Cross-origin redirect between LE and Central UIs
- Store secrets in git, `.env.local`, docker images, or `config/*.json`
- Share a JWT across tenants or allow the client to choose its farm
- Disable RLS to "temporarily" debug a migration

## 16. Known gaps / open items

- **RLS Phase B (FORCE)** not yet applied
- **Feature gate fail-open** on DB outage (documented tradeoff)
- **Client-side dual-storage** (localStorage + sessionStorage) — drift risk when only one is cleared; keep both in sync
- **Legacy AWS artifacts** (`.ebextensions/`, `.platform/`, `aws-*/`) still in repo; banned from use but could mislead new agents
- **`public/data/farm-api-keys.json` (root) + `greenreach-central/public/data/farm-api-keys.json` dual-deployed fallback** — should be retired once all farms have DB-stored API keys

## 17. References

- `.github/COMPLETE_SYSTEM_MAP.md` §9 (Authentication), §6.1–6.2 (Login flows)
- `.github/RESEARCH_PLATFORM_AUDIT.md` — C1–C5 findings
- `docs/architecture/MULTI_TENANT_ARCHITECTURE.md`
- `docs/security/SECURITY.md`, `SECURITY_AUDIT_REPORT.md`, `SECURITY_HARDENING.md`, `PRODUCTION_SECURITY_CONFIG.md`
- `greenreach-central/config/database.js` — query wrapper
- `greenreach-central/middleware/auth.js`, `adminAuth.js`, `farmApiKeyAuth.js`, `farm-data.js`, `feature-gate.js`, `research-tenant.js`, `agent-enforcement.js`, `webhook-signature.js` (there is no `greenreach-central/middleware/tenant.js` — tenant context is resolved LE-side by `server/middleware/multi-tenant.js` or supplied explicitly to Central via `X-Farm-ID` / JWT)
