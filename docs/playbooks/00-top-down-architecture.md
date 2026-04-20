# Light Engine Foxtrot — Top-Down Playbook

**Repository:** `greenreach2024/Light-Engine-Foxtrot`
**Prepared:** 2026-04-18
**Based on:** README.md, CONTRIBUTING.md, `.github/CLOUD_ARCHITECTURE.md`, `.github/COMPLETE_SYSTEM_MAP.md`, `.github/copilot-instructions.md`, `.github/AI_FIRST_VISION.md`, `.github/AGENT_SKILLS_FRAMEWORK.md`, `.github/RESEARCH_PLATFORM_AUDIT.md`, `docs/architecture/MULTI_TENANT_ARCHITECTURE.md`, `docs/ai-agents/AI_AGENT_DOCUMENTATION.md`, `greenreach-central/EVIE_VISION.md`, `greenreach-central/FAYE_VISION.md`, and direct review of `server-foxtrot.js`, `greenreach-central/server.js`, and route sources (assistant-chat, farm-ops-agent, admin-assistant, admin-ops-agent, gwen-research-agent, scott-marketing-agent, setup-agent).

> **Purpose.** Give a single, authoritative, top-down view of Foxtrot — what it is, who it serves, how it is structured, how its data and agents flow, and what security boundaries it must hold. This is meant to be the "first 30 minutes" read for any new operator, engineer, AI agent, or partner.

---

## 0. TL;DR

Foxtrot is the working name for GreenReach's cloud-native, multi-tenant indoor farming platform. One monorepo produces **two Cloud Run services** that together run **three customer-facing experiences** (per-farm operator app, central admin app, wholesale/marketing/distribution app) plus a **research workspace**, all orchestrated by a **family of named AI agents** (E.V.I.E., F.A.Y.E., G.W.E.N., S.C.O.T.T., Farm-Ops, Admin-Ops, Setup-Agent).

- **Light Engine (LE)** = "the farm" runtime. One logical instance per farm operator tenant; sensor polling, device control, farm dashboards, local E.V.I.E. UI.
- **GreenReach Central (GR-Central)** = "the hub". Multi-farm PostgreSQL/AlloyDB backend, admin + marketing + wholesale/distribution backends, AI assistant APIs, research platform, payments.
- **Data model is deliberately split**: each farm's **financial, customer, and business data is tenant-isolated** (RLS + farm_id scoping + JWT-resolved tenant context); **growing-environment, crop, and research data is sharable** with researchers and cross-farm intelligence.
- **GreenReach Central is the business**: distribution, admin, billing, marketing, wholesale marketplace, and network intelligence all live here.
- **Farm Builder is active, not passive.** A dedicated server-side stack (`greenreach-central/lib/farm-builder.js`, `equipment-db.js`, EVIE tool `recommend_farm_layout`) is in place to recommend rooms / zones / lights / HVAC / irrigation from location + building + growing system + crop plan. Until **Playbook 10** lands the UI wiring, the setup surfaces (`farm-setup.html`, `setup-wizard.html`, `LE-migration-wizard.html`) remain passive (user enters equipment; system visualizes).

---

## 1. Mission & Strategic Goals

### 1.1 Mission
Operate an AI-first indoor farming network where individual growers run an opinionated vertical-farm app ("Light Engine") that plugs into a shared central platform ("GreenReach Central") for distribution, sales, research, and intelligence.

### 1.2 Strategic goals (explicit in the code + docs)
1. **AI-first operations.** E.V.I.E. is the primary grower interface; dedicated pages consolidate into conversational/generated views over time (`.github/AI_FIRST_VISION.md`).
2. **Full cloud, no edge hardware.** "The LE Cloud Run service IS the farm." No Pi, no on-prem. Legacy "edge" terms are artifacts (`.github/CLOUD_ARCHITECTURE.md`).
3. **Multi-tenant SaaS, per-tenant isolation first.** Every farm has a `farm_slug` in the `farms` table and strict tenant isolation (RLS + JWT). Per-farm **`<slug>.greenreachgreens.com` subdomain routing is planned but NOT live in production today** — it is documented as a target in `docs/architecture/MULTI_TENANT_ARCHITECTURE.md`. At runtime right now, `greenreachgreens.com` is **Central's** custom domain (pending DNS migration from CloudFront), LE has no custom domain, and agents must **not** assume `<anything>.greenreachgreens.com` resolves to LE.
4. **Shared research, private finances.** Environmental/agronomic data and research artifacts are shared (with governance); financial/customer/wholesale data are tenant-private.
5. **GreenReach Central as the business layer.** Central runs admin, billing, marketing, wholesale marketplace, delivery/distribution, grant wizard, and cross-farm "network intelligence."
6. **Agent-mediated actions.** All consequential actions (device control, bulk updates, recipe deployments) route through an agent tool-gateway with audit + trust tiers, not ad-hoc UI logic.

---

## 2. One-Glance Architecture

```
                         INTERNET
                            |
           ┌────────────────┴────────────────┐
           |                                 |
 light-engine-*.run.app               greenreachgreens.com
 (LE Cloud Run URL; no custom         (Central's custom domain,
  domain today)                        pending DNS migration
                                       → greenreach-central-*.run.app)
           |                                 |
           ▼                                 ▼
 ┌─────────────────────────┐      ┌─────────────────────────┐
 │  Light Engine (LE)      │      │  GreenReach Central     │
 │  Cloud Run: light-engine│      │  Cloud Run: greenreach- │
 │  Entry: server-foxtrot  │      │    central              │
 │                         │      │  Entry: server.js       │
 │  • Farm admin UI        │      │  • GR-central-admin UI  │
 │  • E.V.I.E. frontend    │      │  • F.A.Y.E. admin AI    │
 │  • SwitchBot polling    │      │  • Wholesale marketplace│
 │  • Device control       │      │  • Marketing + S.C.O.T.T│
 │  • Automation engine    │      │  • Delivery/Distribution│
 │  • Schedule executor    │      │  • Research platform    │
 │                         │      │  • Grant wizard         │
 │  env-state.json (local) │      │  • Accounting / Billing │
 │  NeDB / SQLite (local)  │      │  AlloyDB (Postgres)     │
 └─────────────▲───────────┘      └──────────▲──────────────┘
               |                            |
               |   POST /api/sync/telemetry (30s)
               └────────────────────────────┘
                              ▲
                              | SwitchBot Cloud API v1.1 (30s polling)
                   ┌──────────┴──────────┐
                   │ SwitchBot Hub + 4× │
                   │ WoIOSensor         │
                   └─────────────────────┘
```

**Deployment target (April 2026):** Google Cloud Run, region `us-east1`, project `project-5d00790f-13a9-4637-a40`, AlloyDB at `10.87.0.2` on `greenreach-vpc`. AWS Elastic Beanstalk is **deprecated** and must not be used (`.github/CLOUD_ARCHITECTURE.md`).

---

## 3. The Four Apps (Top-Level Categories)

Foxtrot can be read as **four customer-facing apps** sharing one backend:

### 3.1 App A — Farm Operator App ("Light Engine" UI)
- **Who:** Individual farm owner + their roles (`admin`, `manager`, `operator`, `viewer`).
- **Where served:** LE Cloud Run, main page `LE-farm-admin.html`, login at `farm-admin-login.html`.
- **Tenant URL:** LE Cloud Run default URL today (no custom domain). Per-farm `<slug>.greenreachgreens.com` routing is a **planned** future state — see `docs/architecture/MULTI_TENANT_ARCHITECTURE.md`. Do **not** assume `foxtrot.greenreachgreens.com` or `<slug>.greenreachgreens.com` resolves.
- **Primary agent:** E.V.I.E. (farm-scoped) with Farm-Ops-Agent tool gateway and Setup-Agent for onboarding.
- **Capabilities:** environment monitoring, device + lighting + plug + SwitchBot control, automation rules, schedules, groups, zones, rooms, tray/planting lifecycle, harvest, inventory, farm-sales POS, wholesale order fulfillment, alerts, notifications, grant wizard, research workspace (if tier includes it), accounting & billing (their own), onboarding wizards.
- **Data:** private to the farm (financial, customers, orders); telemetry synced upstream; recipes pulled from Central.

### 3.2 App B — Central Admin App ("GreenReach Central")
- **Who:** GreenReach staff — platform admins, editors, viewers. Authenticated via separate `admin_users` table with MFA + lockout.
- **Where served:** GR-Central, main page `GR-central-admin.html`, login at `GR-central-admin-login.html`.
- **Primary agent:** F.A.Y.E. (cross-farm admin AI) and Admin-Ops-Agent (operations/runbooks).
- **Capabilities:** farm registration, user management, billing/subscription management, wholesale admin, delivery admin, recipe library + deployment to farms, network intelligence, feature gating, AI monitoring, governance/compliance reports, system alerts, deep ops runbooks, AI-cost accounting.
- **Data:** can query across all farms (subject to admin role + RLS admin bypass).

### 3.3 App C — Marketing + Distribution App
This is actually **two tightly linked surfaces** that share a backend and the marketing agent S.C.O.T.T.

**C.1 Marketing Platform**
- **Public landing pages**: `landing-*.html`, `about.html`, `greenreach-grow.html`, `id-buy-local.html`, blog, etc.
- **Marketing agent (S.C.O.T.T.)**: `greenreach-central/routes/scott-marketing-agent.js` — "Social Content Optimization, Trends & Targeting." Generates social posts per platform, runs rule-engine auto-approval (`marketing-rules-engine.js`), publishes via `marketing-platforms.js`, tracks AI cost via `ai-usage-tracker.js`. Explicitly positioned as "junior to F.A.Y.E." with escalation.
- **Admin surface**: `/api/admin/marketing` (`greenreach-central/routes/admin-marketing.js`), campaigns (`greenreach-central/routes/campaign.js`), marketing skills registry (`greenreach-central/services/marketing-skills.js`).
- **Branding (planned):** per-farm subdomain stores (`*.greenreachgreens.com`) are the **intended** public face of each tenant; today the farm shop is reached via the LE Cloud Run URL or (once migrated) relative paths under Central's domain. Wildcard DNS and TLS for `*.greenreachgreens.com` are **not** configured in production today.

**C.2 Distribution / Wholesale / Delivery**
- **Wholesale marketplace**: `GR-wholesale.html`, buyer portal, driver-applications, catalog aggregation across farms. Backend (all under `greenreach-central/routes/`): `wholesale.js`, `admin-wholesale.js`, `wholesale-fulfillment.js`, `wholesale-exports.js`, `wholesale-donations.js`. LE also exposes companion wholesale surfaces at root `routes/wholesale/` and `routes/wholesale-*.js` for the farm-side of checkout and fulfillment.
- **Commission engine**: 12% broker commission (`WHOLESALE_COMMISSION_RATE=0.12`), implemented via Square `app_fee_money` — this is GreenReach's stated revenue model and must not change.
- **Delivery service**: `greenreach-central/routes/admin-delivery.js`, driver enrollment (`greenreach-central/public/driver-enrollment.html`), per-farm delivery settings, zones/windows, delivery orders. Architecture: MVP in `docs/delivery/DELIVERY_SERVICE_ARCHITECTURE_PLAN.md`.
- **Farm sales**: per-farm POS at `farm-sales-pos.html` (embedded into LE farm admin), direct-to-consumer shop at `farm-sales-shop.html` (served by LE Cloud Run; per-farm subdomain branding is planned, not live), Square OAuth per farm via `payment-setup.html` + `greenreach-central/routes/square-oauth-proxy.js`.

### 3.4 App D — Research Workspace
- **Who:** Farms on the research tier, plus external collaborators (PIs, Co-PIs, postdocs, grad students, technicians, viewers).
- **Where served:** `research-workspace.html` embedded into LE farm admin, with backend on GR-Central (`/api/research/*` — 20+ route files).
- **Primary agent:** G.W.E.N. ("Grants, Workplans, Evidence & Navigation") — `gwen-research-agent.js`, Gemini 2.5 Pro, most advanced agent in the family. Operates exclusively inside the research bubble; F.A.Y.E. retains security authority outside.
- **Capabilities:** studies, datasets, ELN, protocols, randomization plans, compliance (REB, biosafety, ethics), HQP/EDI tracking, collaborator management, grant lifecycle (NSERC/CIHR/SSHRC/CFI/MITACS), publication & citation tracking, equipment booking, data lineage/provenance, partner institutions, data sharing agreements, audit log, COI, signoffs, approval chains, change requests, milestone evidence.
- **Data model:** every research table carries `farm_id` for tenancy, but *governed sharing* is explicit (data sharing agreements, partner institutions, classifications).

---

## 4. Repository Structure (Top-Down)

```
/                                      ← Light Engine (LE) deploy root
  server-foxtrot.js                    ← LE monolith (~30K lines), Cloud Run entry
  package.json                         ← LE deps (Node 20)
  Procfile, Dockerfile                 ← LE container config

  routes/                              ← LE API routes (wholesale, farm-sales, auth, ...)
  lib/                                 ← LE libraries: automation, sync, spectral solver,
                                          event bus, device safety, ML automation, CW metrics
  services/                            ← LE services: sync-service, ai-agent, certificate,
                                          credential, notifications, gcs-storage
  middleware/                          ← LE middleware (auth, tenant, rate-limit)
  automation/                          ← Env. automation engine (env-store, VPD, rules)
  config/                              ← edge-config.json, feature flags, database
  public/                              ← Root LE static assets (NOTE: at runtime LE serves
                                          greenreach-central/public/ FIRST, then falls back
                                          to this root public/ — see server-foxtrot.js ~L25173)
  scripts/                             ← maintenance, deploy, migrations, smoke tests

  greenreach-central/                  ← GR-Central deploy root (independent image)
    server.js                          ← Central entry
    routes/                            ← 80+ route files (admin, wholesale, research,
                                          delivery, marketing, payments, assistant-chat,
                                          farm-ops-agent, scott-marketing-agent,
                                          gwen-research-agent, admin-assistant, ...)
    services/                          ← background services (AI pusher, sync monitor,
                                          ai-usage-tracker, marketing-ai-agent, gcs-storage)
    middleware/                        ← auth, feature-gate, research-tenant, agent-enforcement
    lib/                               ← farm-data-store, leam-bridge, gemini-client,
                                          marketing-rules-engine, payments
    migrations/                        ← PostgreSQL/AlloyDB schema migrations
    public/                            ← Central static assets (dashboards, admin UIs)
    public/views/                      ← embedded dashboard views (summary, inventory, 3D viewer)

  docs/                                ← Organized docs (architecture, security, delivery,
                                          wholesale, research, billing, onboarding,
                                          ai-agents, operations, features, archive)
  .github/                             ← CANONICAL operational documents (required reading)
  archive/                             ← Legacy code (not deployed)
```

**Absolute rules** (from CONTRIBUTING.md and copilot-instructions.md):
- LE and Central **share no runtime imports** across the boundary as the default rule. A small set of explicitly audited exceptions exists today — treat this as the whitelist, do not add new ones without review:
  - `server-foxtrot.js` imports `./greenreach-central/services/notification-store.js` (notification storage used by LE).
  - `services/alternative-farm-service.js` and `lib/wholesale/reservation-manager.js` dynamically import `greenreach-central/services/networkFarmsStore.js` for wholesale/network farm lookup.
  - Any additional whitelisted Central dependencies bundled into LE are documented in `.github/CLOUD_ARCHITECTURE.md`; that doc is the source of truth.
- LE and Central must **not** cross-import each other's `routes/**`.
- Two `public/` directories exist. **At runtime, LE's Express static stack serves `greenreach-central/public/` FIRST, then falls back to root `public/`** (`server-foxtrot.js` ~L25173–L25194). So for any file that exists in both trees, the Central copy is the effective source of truth at request time. The "dual-deploy file registry" rule is: edit `greenreach-central/public/` first, then mirror listed files into root `public/` — but Central's copy wins if they drift.
- Never redirect UI page requests cross-origin between the two services — it breaks iframes, CSP, and HTTPS.

---

## 5. Agent Topology

Foxtrot is an explicitly **multi-agent** system. Every agent has a defined audience, LLM, and authority.

| Agent | Nickname meaning | Scope | Audience | LLM | Authority | Backend file |
|---|---|---|---|---|---|---|
| **E.V.I.E.** | Environmental Vision & Intelligence Engine | **One farm** | Growers, visitors, demo viewers | OpenAI GPT-4o (primary) + Anthropic Claude (fallback) | Farm-scoped read/suggest + act via Farm-Ops tool gateway | `greenreach-central/routes/assistant-chat.js` |
| **Farm-Ops-Agent** | Deterministic ops engine | One farm | Backend / E.V.I.E. tool-gateway | Deterministic + GPT-4o for NL parsing | Executes scored daily tasks, tool catalog, audit log | `greenreach-central/routes/farm-ops-agent.js` (canonical, ~5.3K lines); LE also ships a companion `routes/farm-ops-agent.js` (~1.1K lines, mounted in `server-foxtrot.js`) — see Playbook 02 §3 |
| **Setup-Agent** | Farm setup orchestrator | One farm | New farms onboarding with E.V.I.E. | GPT-4o | 12-phase setup progress, fills farm profile, rooms, zones, groups, crops | `greenreach-central/routes/setup-agent.js` |
| **F.A.Y.E.** | Farm Autonomy & Yield Engine | **All farms** | Platform admins / ops | GPT-4o primary | Observe, learn, recommend, progressively automate across network; receives escalations from E.V.I.E. and S.C.O.T.T.; safe-patch approval authority | `greenreach-central/routes/admin-assistant.js` |
| **Admin-Ops-Agent** | Platform ops agent | Platform-wide | Admins | GPT-4o | Ops runbooks, system health, revenue analysis, feature management | `greenreach-central/routes/admin-ops-agent.js` |
| **G.W.E.N.** | Grants, Workplans, Evidence & Navigation | Research bubble (across farms per study) | Researchers, PIs, HQP | Gemini 2.5 Pro (Vertex AI) | Research workspace actions, DMPs, grants, governance; `execute_code` disabled by default in cloud unless `GWEN_EXECUTE_CODE_ENABLED=true` | `greenreach-central/routes/gwen-research-agent.js` |
| **S.C.O.T.T.** | Social Content Optimization, Trends & Targeting | Marketing | Marketing/ops users | Gemini 2.5 Flash (Vertex AI) | Generates + publishes social posts, rules-based auto-approval, multi-platform; junior to F.A.Y.E. | `greenreach-central/routes/scott-marketing-agent.js` |

**Orchestration primitives**
- **Tool-gateway + audit log:** all consequential actions go through `farm-ops-agent.js`' tool gateway (`/tool-gateway`, `/tool-catalog`, `/parse-command`, `/audit-log`) with schema-validated calls.
- **Trust tiers:** tools declare tiers such as `quick_confirm`, used for example on bulk alert resolution.
- **Inter-agent escalation:** E.V.I.E. → F.A.Y.E. when confidence low or authority exceeded; S.C.O.T.T. → F.A.Y.E.; G.W.E.N. stays inside research bubble, F.A.Y.E. guards its perimeter.
- **Enforcement middleware:** `greenreach-central/middleware/agent-enforcement.js` injects an `ENFORCEMENT_PROMPT_BLOCK` into agent responses to keep them within sanctioned behavior.
- **AI usage accounting:** `greenreach-central/lib/ai-usage-tracker.js` (exports `trackAiUsage`, `estimateChatCost`, `estimateTtsCost`) plus `greenreach-central/lib/gemini-client.js` `estimateGeminiCost` record token/cost per agent conversation (visible in `/api/ai-monitoring`).

---

## 6. Security & Tenancy Model

### 6.1 The user-security / shared-data split (the central design insight)

The product goal is explicit: **each Light Engine is operated by a unique user; their financial data is private; their growing-environment data is sharable with researchers.** The codebase implements this with layered controls.

| Data class | Examples | Isolation mechanism |
|---|---|---|
| **Farm-private business data** | `farm_users`, `wholesale_orders`, `payment_records`, `accounting_*`, `farm_inventory`, `products`, `delivery_orders`, `producer_accounts`, `farm_alerts`, POS transactions, Square OAuth tokens | PostgreSQL **Row-Level Security** (`gr_tenant_isolation` policy) on 19 tenant-scoped tables, enforced via `set_config('app.current_farm_id', ...)` in the query wrapper; client-side `clearFarmStorage()` on login/expiry; tenant resolved from JWT (subdomain-based resolution is a planned future input, not live) |
| **Farm-owned operational data** | `groups`, `rooms`, `schedules`, `devices`, `tray_runs`, `harvest_events`, `lot_records` | `farm_id` scoping + farmStore per-farm Maps; sync auth via `X-API-Key` + `X-Farm-ID` for LE ↔ Central |
| **Network-shared / aggregate data** | `crop_benchmarks`, `demand_signals`, `recipe_modifiers`, `risk_alerts`, `environment_benchmarks`, `pricing_intelligence`, network anomaly correlations, energy benchmarks, performance leaderboards | Aggregated in Central; exposed via `/api/network/*`; **admin-only** for cross-farm raw views (`/api/network/benchmarking` returns 403 to non-admins after Phase A hardening) |
| **Research data (shared with governance)** | `studies`, `datasets`, `recipe_versions`, `protocol_design_elements`, `data_dictionary_entries`, `metadata_registry`, `event_markers`, `batch_traceability`, `grant_applications`, `grant_publications`, `data_quality_alerts` | Still `farm_id`-scoped by default, but sharable via `research-partners`, `research-collaboration`, `research-security` (classifications + policies), and data-sharing agreements; governed by ORCID-linked roles (PI, Co-PI, postdoc, technician, viewer) |
| **Telemetry (shared for intelligence)** | SwitchBot temperature/humidity, VPD, energy | Collected per farm; anonymized/aggregated for cross-farm trends and recipe learning |

### 6.2 Three authentication systems

| System | Mechanism | Expiry | Storage | Used by |
|---|---|---|---|---|
| Farm user auth | JWT (Bearer) | 24h | `localStorage.token` / `sessionStorage.token` | Farm dashboards, E.V.I.E. |
| Admin auth | JWT (Bearer) + MFA + lockout | 12h | `localStorage.admin_token` | GR-Central admin, F.A.Y.E. |
| LE ↔ Central sync | `X-API-Key` + `X-Farm-ID` | None | `config/edge-config.json` / `farms.api_key` | `sync-service.js`, cross-server proxies |

Farm context extraction priority (Central): JWT → `X-Farm-ID` header → subdomain slug (only when subdomain routing is activated per the multi-tenant architecture plan — NOT live today) → env default (`FARM_ID`).

### 6.3 Feature gates
- Plan tiers: `full`, `inventory-only`, `research`, etc.
- `autoEnforceFeatures()` middleware is applied in **LE** (`server-foxtrot.js`), but per `.github/RESEARCH_PLATFORM_AUDIT.md` (C1) it is **not** applied in `greenreach-central/server.js`, because Central's deploy bundle excludes the LE `server/middleware/` path and a direct import was attempted and reverted.
- **Known open risk (C1, Apr 2026):** Central-side research feature enforcement is the unresolved blocker for activating the research tier externally. The audit's resolution path is one of: (a) duplicate the middleware inside `greenreach-central/middleware/`, (b) extract it to a shared package, or (c) add inline `requireFeature('research_workspace')` checks to each research route mount. Until one of those lands, direct `/api/research/*` calls on Central are gated only by `authMiddleware`, not by tier.
- Secondary known risk: when enforcement is present, it is intentionally **fail-open** on DB outage (availability-first tradeoff, documented in the same audit). Close both issues before activating paid research tier to external customers.

### 6.4 Data-residency and secrets
- All secrets in **Google Secret Manager** (`JWT_SECRET`, `ALLOYDB_PASSWORD`, `SQUARE_*`, `SWITCHBOT_*`, `SMTP_PASS`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GREENREACH_API_KEY`, `TOKEN_ENCRYPTION_KEY`).
- Direct VPC egress to AlloyDB; no public DB endpoint.
- Cloud Storage bucket `greenreach-storage` mounted at `/app/data` for persistent files.

---

## 7. Data Flows (End-to-End)

### 7.1 Sensor → Dashboard (8 stages)
SwitchBot sensors → Hub Mini (WiFi) → SwitchBot Cloud → LE polls every 30s with HMAC-SHA256 auth → `EnvStore` (weighted median aggregation, 50-point history, persisted to `data/automation/env-state.json`) → LE `GET /env` → `sync-service.js` `POST /api/sync/telemetry` to Central every 30s with `X-API-Key` + `X-Farm-ID` → Central UPSERT `farm_data WHERE data_type='telemetry'` + async alert evaluator → farm-summary dashboard polls every 60s.

### 7.2 Farm data sync (LE → Central)
Every 5 min + daily 2 AM + manual trigger: LE static JSON (`groups.json`, `rooms.json`, `farm.json`, `iot-devices.json`, `room-map.json`, `env.json`, `tray-formats.json`, ...) → Central `farmStore` (per-farm Maps + `farm_data` table; never flat files, to prevent cross-farm leaks).

### 7.3 Wholesale order (buyer → farm → payment)
Buyer browses `GR-wholesale.html` → Central aggregates catalog across farms (fallback: direct `farm_inventory` query) → `POST /api/wholesale/checkout` → Square (12% `app_fee_money` commission) → `wholesale_orders` INSERT + inventory reservation → farm sees order in `LE-wholesale-orders.html` → farm accepts/fulfills → `/api/wholesale/orders/:id/fulfill`.

### 7.4 Per-farm point of sale
Farm opens `farm-sales-pos.html` (iframe inside LE farm admin, auto-login from admin session) → transactions go through Square using the farm's own OAuth tokens (`greenreach-central/routes/square-oauth-proxy.js`) → customer & payment records stay in farm tenant.

### 7.5 Recipe deployment (cross-farm research → farm)
Research creates `recipe_versions` (draft → review → approved_beta → live) → `recipe_deployments` targets farm + zone → farm operator acknowledges (`recipe_operator_acks`) → rollback supported. All governed through COI declarations, signoffs, and approval chains.

### 7.6 Marketing publish (S.C.O.T.T.)
User asks S.C.O.T.T. → agent proposes post(s) → `marketing-rules-engine.js` evaluates auto-approve rules → `marketing-platforms.js` publishes → `campaign.js` tracks campaign metrics → F.A.Y.E. can audit/override.

### 7.7 Delivery (MVP)
Buyer at checkout picks pickup or delivery → Central reads per-farm delivery settings (zones, windows, fees) → `delivery_orders` created → (post-MVP: driver assignment, routing, tracking).

---

## 8. Category → Subcategory Playbook

Use this as the canonical taxonomy when building features or briefing new agents.

### 8.1 Farm Operations (LE-owned)
- Environment: sensors (SwitchBot), EnvStore, VPD control, target ranges, anomaly history
- Device control: lights (spectral solver, PWM), Kasa plugs, Shelly, SwitchBot commands, smart plugs, MQTT nutrient controller
- Automation: rules engine, schedule executor, schedules per group, fan rotation
- Crop lifecycle: tray formats → trays → seeding → placement → grow → harvest → lot codes
- Quality & traceability: quality reports, lot system, FDA-compliant tracing
- Alerts: farm-scoped alerts, stale-alert auto-cleanup (48h), bulk resolve tools
- ML: anomaly detection, SARIMAX forecasting, LED aging, harvest date prediction

### 8.2 Commerce (Central + LE split)
- Farm sales (DTC): POS, shop, store (per-farm subdomain storefront planned, not live)
- Wholesale marketplace: catalog aggregation, checkout, 12% broker commission, fulfillment, exports, donations
- Pricing: `crop-pricing.js`, `admin-pricing.js`, cost surveys, pricing intelligence
- Inventory (two domains): supplies (inputs, JSONB in `farm_data`) vs. crop/product inventory (`farm_inventory` table, dual-quantity auto + manual)
- Custom products: `greenreach-central/routes/custom-products.js` with image upload
- Salad mixes: trait-based mix components, per-farm overrides (`farm_mix_overrides`)

### 8.3 Payments & Accounting (Central-owned)
- Square POS + wholesale
- Stripe subscriptions
- Per-farm Square OAuth (standalone `payment-setup.html`)
- Webhooks: `/api/webhooks/square`, `/api/webhooks/stripe`, `payment-webhooks.js`
- Stripe Connect control (`stripe-connect-control.js`)
- Accounting ledger, billing, receipts, QuickBooks integration (`node-quickbooks`)
- Governance: `FINANCIAL_AUDIT_REPORT.md`, `CORRECTION-REPORT.md`, `RE-AUDIT-REPORT.md` (tracked in repo root)

### 8.4 Distribution (Central-owned)
- Delivery settings (fees, windows, zones per farm)
- Driver applications + enrollment
- Delivery orders
- Admin delivery surface (`admin-delivery.js`)
- Farm-to-door roadmap (`docs/delivery/`)
- Producer portal (`producer-portal.js`) for upstream supply

### 8.5 Marketing (Central-owned)
- Public landing pages (`landing-*.html`)
- S.C.O.T.T. marketing agent (multi-platform social)
- Campaign management (`campaign.js`, `admin-marketing.js`)
- Per-farm subdomain storefronts (branding as marketing — **planned**, not live today)
- Email via Google Workspace SMTP (`SMTP_*`), Email-to-SMS gateway for critical alerts
- Blog system (`blog.html`, `blog-post.html`)

### 8.6 Research Platform (Central-owned, farm-consumed)
- Phase 1: studies, datasets, ELN, protocols, DMPs, data dictionaries, metadata registry, event markers, batch traceability, data-quality alerts, protocol design, approval chains, COI, signoffs
- Phase 2: grants (applications, reports, publications, milestones, extensions, amendments)
- Phase 3: ethics (REB), biosafety, HQP, EDI, partners, data sharing, security
- Phase 4: reporting, deadlines, publications, equipment, lineage, audit
- G.W.E.N. owns the interaction layer
- Feature-tier gated (research tier)

### 8.7 Network Intelligence (Central-owned)
- Cross-farm benchmarks (production, demand, growth)
- Recipe modifiers from yield regression
- Energy benchmarks
- Performance leaderboards
- Churn / buyer behavior classification
- Cross-farm anomaly correlation (weekly job)

### 8.8 Platform & Admin (Central-owned)
- Farm registration + `farm_slug` allocation (DNS / subdomain activation pending the multi-tenant rollout)
- User management (farm + admin)
- Feature flags + plan tiers
- AI monitoring + cost accounting
- Governance reports
- CloudWatch/Cloud Logging metrics (from LE), uptime

### 8.9 Security & Compliance (cross-cutting)
- Row-Level Security (Phase A enable; Phase B force planned)
- Tenant isolation middleware (server-side + client-side storage clear)
- Helmet CSP, HSTS, rate limiting
- Audit logging (`SECURITY_AUDIT_MIDDLEWARE`, tool-gateway audit log)
- Security hardening docs (`docs/security/`)
- Research-platform audit (`.github/RESEARCH_PLATFORM_AUDIT.md`)

### 8.10 AI Governance (cross-cutting)
- Agent enforcement middleware (`agent-enforcement.js`)
- Trust tiers on tools (`quick_confirm`, explicit-confirm, admin-only)
- Inter-agent escalation (E.V.I.E./S.C.O.T.T. → F.A.Y.E.; F.A.Y.E. guards G.W.E.N. perimeter)
- AI usage + cost tracking
- `.github/AGENT_SKILLS_FRAMEWORK.md` multi-agent review process (Implementation / Review / Architecture agents) — applied to human + AI contributors

### 8.11 DevOps / Deployment
- Google Cloud Run (`light-engine`, `greenreach-central`), `us-east1`, Gen2 Direct VPC egress
- Artifact Registry (`us-east1-docker.pkg.dev/.../greenreach`)
- `docker buildx --platform linux/amd64 --push` + `gcloud run services update`
- Cloud Scheduler: 3 keep-alive/cron jobs
- Secret Manager for all secrets
- AlloyDB auto-migrations on Central boot
- **AWS EB is deprecated** — banned CLI commands enumerated in `.github/copilot-instructions.md`

---

## 9. User Personas & Permission Model

| Persona | Auth | Primary app | Primary agent | Typical capabilities |
|---|---|---|---|---|
| Full Farm Operator (owner/admin) | Farm JWT (role=`admin`) | App A | E.V.I.E. | Everything on their farm + onboarding wizards |
| Farm Manager | Farm JWT (role=`manager`) | App A | E.V.I.E. | Inventory, scheduling, monitoring; no billing |
| Farm Operator (worker) | Farm JWT (role=`operator`) | App A | E.V.I.E. | Record data, acknowledge tasks, device control via rules |
| Farm Viewer | Farm JWT (role=`viewer`) | App A | E.V.I.E. (read) | Read-only dashboards |
| Sales-only User | Farm JWT, feature flag | App A (sales tiles only) | E.V.I.E. (commerce scope) | POS, wholesale portal, invoicing, financials |
| Wholesale Buyer | Buyer account | App C | — | Browse catalog, order, view history |
| Delivery Driver | Driver account | App C | — | Enroll, claim deliveries (post-MVP) |
| Grant Applicant | Farm JWT | `grant-wizard.html` | G.W.E.N. | Apply/manage grants |
| Researcher / PI | Farm JWT + ORCID-linked research role | App D | G.W.E.N. | Studies, datasets, ELN, publications |
| Trainee (HQP) | Farm JWT + HQP record | App D | G.W.E.N. | Supervised research activities |
| Central Admin | Admin JWT (role=`admin`) | App B | F.A.Y.E. | Platform-wide; can cross farm tenancy via admin bypass |
| Central Editor | Admin JWT (role=`editor`) | App B | F.A.Y.E. (limited) | Farm mgmt + recipes, no destructive ops |
| Central Viewer | Admin JWT (role=`viewer`) | App B | F.A.Y.E. (read) | Read-only |

---

## 10. Canonical References (Required Reading)

Kept in `.github/` at the repo root — treat as source of truth; do not paraphrase when in doubt, link them.

1. `.github/CLOUD_ARCHITECTURE.md` — Cloud Run topology, secrets, networking, deploy commands, banned commands
2. `.github/COMPLETE_SYSTEM_MAP.md` — Every page, every route, every table, every flow (3,000+ lines)
3. `.github/CRITICAL_CONFIGURATION.md` — All env vars + credentials + config files
4. `.github/SENSOR_DATA_PIPELINE.md` — Complete sensor flow
5. `.github/PAYMENT_WORKFLOW.md` — Payments, checkout, Square, accounting
6. `.github/AI_FIRST_VISION.md` — Long-term UX direction
7. `.github/AGENT_SKILLS_FRAMEWORK.md` — Multi-agent contribution process, review gates
8. `.github/RESEARCH_PLATFORM_AUDIT.md` — Research tenancy + security gaps and status
9. `greenreach-central/EVIE_VISION.md` — E.V.I.E. tone, visual identity, modes
10. `greenreach-central/FAYE_VISION.md` — F.A.Y.E. positioning, autonomy roadmap
11. `docs/architecture/MULTI_TENANT_ARCHITECTURE.md` — Subdomain multi-tenancy **plan** (target state, not current runtime)
12. `docs/security/` — Security audits + hardening
13. `CONTRIBUTING.md` — Workflow, dual-deploy rules, conventions
14. `docs/ai-agents/` — Agent capabilities, skill framework updates, forensic reports
15. `docs/delivery/` — Delivery architecture + readiness
16. `docs/wholesale/` — Wholesale integration guide

---

## 11. Operating Playbook (How To Work In This Repo)

### 11.1 Before making any change
1. Read the relevant canonical doc in `.github/`.
2. Search the codebase — do not assume features are missing (the Agent Skills Framework documents multiple regressions from agents re-building already-existing features).
3. Decide: LE-only, Central-only, or dual-deploy (UI files).
4. For any consequential change (bulk ops, new routes, cross-farm data, agent tools), follow the multi-agent review process: Implementation → Review → (Architecture for strategic changes) → approval annotations in commit.

### 11.2 Deploy matrix
| Change | Deploy |
|---|---|
| `server-foxtrot.js`, `routes/`, `lib/`, `services/`, root `public/` non-dual-deploy | LE only |
| `greenreach-central/**` non-shared | Central only |
| Files in the **dual-deploy registry** (`LE-farm-admin.html`, `LE-dashboard.html`, `farm-sales-pos.html`, `payment-setup.html`, `evie-core.css`, `evie-presence.js`, `farm-admin.js`, `auth-guard.js`, `research-workspace.html`, `3d-farm-viewer.html`, ...) | **Both**, edit Central first, copy to root |

### 11.3 Never
- Reference EB environments, `eb deploy`, `aws elasticbeanstalk`, EB CNAMEs, RDS endpoints (AWS is deprecated).
- Redirect UI page requests cross-origin between LE and Central.
- Change the 12% wholesale commission.
- Write flat files as the source of truth for cross-farm data (it leaks).
- Invent credentials (see Incident #5 in Agent Skills Framework).

---

## 12. Known Tensions / Open Items

Worth tracking alongside this playbook:

- **RLS Phase B** (FORCE owners) not yet enabled on tenant tables.
- **Research feature-gate fail-open** when DB unavailable (documented tradeoff).
- **SwitchBot credentials** currently placeholders in some env configs — sensors silently stop updating when missing.
- **Dual public/ maintenance burden** — no build system yet enforces the dual-deploy file registry; drift is easy and explicitly tracked in CANONICAL_FILES.txt.
- **Research Phase 1 UI completeness: 60/100** per the research audit — workspace Phase 1 tabs still have API-wiring gaps that are being closed incrementally.
- **AWS legacy artifacts** (`.ebextensions/`, `.platform/`, `.ebignore`, `aws-*` dirs, EB deploy scripts) still in the repo; explicitly banned from use but not yet purged.
- **Sensitive repo-root reports** (`FINANCIAL_AUDIT_REPORT.md`, `CORRECTION-REPORT.md`) contain financial narrative; verify before any external distribution.

---

## 13. Elevator Pitch for New Team Members / Agents

> Foxtrot is a two-service Cloud Run monorepo. `light-engine` is each farm's operator app (sensors, devices, E.V.I.E.). `greenreach-central` is the business: admin, wholesale, marketing, delivery, payments, research, grants, and network intelligence across farms. `greenreachgreens.com` is **Central's** custom domain (pending DNS migration); LE has no custom domain today and per-farm `<slug>.greenreachgreens.com` routing is planned, not live. Farms are isolated by `farm_id` with PostgreSQL RLS. Financial data stays private to the farm; environmental and research data is sharable under explicit governance. Actions flow through a family of named AI agents — E.V.I.E. for the farm, F.A.Y.E. for the platform, G.W.E.N. for research, S.C.O.T.T. for marketing, plus Setup-Agent, Farm-Ops-Agent, and Admin-Ops-Agent — all routed through a tool-gateway with audit and trust tiers. AWS is deprecated; everything runs on Google Cloud Run + AlloyDB + Secret Manager. Read the files in `.github/` before you change anything.
