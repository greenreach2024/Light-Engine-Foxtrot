# Cloud Architecture Reference

**Version**: 2.2.0
**Date**: April 10, 2026
**Authority**: This document is the canonical source of truth for system architecture. All agents MUST read this before modifying any infrastructure, deployment, data flow, or sensor-related code.

---

## THE FARM IS 100% CLOUD

There is NO physical farm device. No Raspberry Pi. No edge hardware. No on-premise server.

The "farm" runs entirely on Google Cloud Run. The Light Engine (LE) IS the farm. The terms "edge" and "cloud" are MERGED into a single cloud deployment. Any code references to "edge mode," "edge device," or "hardware" are legacy artifacts from when a physical device was planned but never deployed.

**If you are an AI agent reading this: DO NOT assume a physical device exists. DO NOT reference a "farm Pi," "edge device," or "local hardware." The LE Cloud Run service IS the farm.**

---

## PLATFORM HAS MIGRATED FROM AWS TO GOOGLE CLOUD (April 2026)

**AWS Elastic Beanstalk is DEPRECATED. All production workloads now run on Google Cloud Run.**

Agents MUST NOT:
- Reference EB environments (`light-engine-foxtrot-prod-v3`, `greenreach-central-prod-v4`)
- Use `eb deploy`, `eb setenv`, `eb printenv`, or any `eb` CLI command
- Use `aws elasticbeanstalk` CLI commands
- Reference EB CNAMEs or `.elasticbeanstalk.com` URLs
- Attempt to deploy to or configure AWS infrastructure
- Use `scp` or `ssh` to EB instances
- Reference RDS database endpoints (migrated to AlloyDB)

**The ONLY supported deployment target is Google Cloud Run.** See "Cloud Run Services" section below.

---

## Cloud Run Services (Production -- April 2026)

### GCP Project

| Property | Value |
|----------|-------|
| **Project ID** | `project-5d00790f-13a9-4637-a40` |
| **Project Number** | `1029387937866` |
| **Region** | `us-east1` |
| **Artifact Registry** | `us-east1-docker.pkg.dev/project-5d00790f-13a9-4637-a40/greenreach` |

### Light Engine (The Farm)

| Property | Value |
|----------|-------|
| **Service** | `light-engine` |
| **URL** | `https://light-engine-1029387937866.us-east1.run.app` |
| **Service Account** | `light-engine-sa@project-5d00790f-13a9-4637-a40.iam.gserviceaccount.com` |
| **Image** | `us-east1-docker.pkg.dev/project-5d00790f-13a9-4637-a40/greenreach/light-engine:latest` |
| **Entry Point** | `node server-foxtrot.js` |
| **CPU / Memory** | 1 vCPU / 1Gi (CPU always-allocated -- sensor timers) |
| **Min / Max Instances** | 1 / 2 |
| **Execution Environment** | Gen2 (Direct VPC egress) |
| **VPC** | `greenreach-vpc` / `greenreach-subnet` |
| **Deploy From** | Repo root: `/Volumes/CodeVault/Projects/Light-Engine-Foxtrot/` |

### GreenReach Central (The Hub)

| Property | Value |
|----------|-------|
| **Service** | `greenreach-central` |
| **URL** | `https://greenreach-central-1029387937866.us-east1.run.app` |
| **Custom Domain** | `greenreachgreens.com` (pending DNS migration) |
| **Service Account** | `greenreach-central-sa@project-5d00790f-13a9-4637-a40.iam.gserviceaccount.com` |
| **Image** | `us-east1-docker.pkg.dev/project-5d00790f-13a9-4637-a40/greenreach/greenreach-central:latest` |
| **Entry Point** | `node server.js` |
| **CPU / Memory** | 1 vCPU / 768Mi |
| **Min / Max Instances** | 1 / 5 |
| **Execution Environment** | Gen2 (Direct VPC egress) |
| **VPC** | `greenreach-vpc` / `greenreach-subnet` |
| **Deploy From** | `greenreach-central/` subdirectory |

### Database: AlloyDB (PostgreSQL-compatible)

| Property | Value |
|----------|-------|
| **Cluster** | `greenreach-db` |
| **Instance** | `greenreach-db-primary` |
| **Private IP** | `10.87.0.2` (VPC-only, no public endpoint) |
| **User** | `postgres` |
| **Database** | `greenreach_central` |
| **SSL** | ALLOW_UNENCRYPTED_AND_ENCRYPTED (VPC-internal, no public endpoint) |
| **Password** | Secret Manager: `ALLOYDB_PASSWORD` |

### Deployment Commands

```bash
# Build and push (ALWAYS use --platform linux/amd64 on Apple Silicon)
export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"

# Central
docker buildx build --platform linux/amd64 \
  -t us-east1-docker.pkg.dev/project-5d00790f-13a9-4637-a40/greenreach/greenreach-central:latest \
  --push ./greenreach-central/

# LE
docker buildx build --platform linux/amd64 \
  -t us-east1-docker.pkg.dev/project-5d00790f-13a9-4637-a40/greenreach/light-engine:latest \
  --push .

# Deploy (updates service to latest image)
gcloud run services update greenreach-central --region=us-east1 --image=us-east1-docker.pkg.dev/project-5d00790f-13a9-4637-a40/greenreach/greenreach-central:latest
gcloud run services update light-engine --region=us-east1 --image=us-east1-docker.pkg.dev/project-5d00790f-13a9-4637-a40/greenreach/light-engine:latest
```

### Environment Variables

Env vars are set via `--set-env-vars` / `--update-env-vars` on Cloud Run. Secrets use `--set-secrets` referencing Google Secret Manager.

**Updating env vars on Cloud Run is SAFE** (unlike EB). Cloud Run creates a new revision with the updated config and routes traffic to it. No npm install hooks to skip.

```bash
# Safe env var update
gcloud run services update greenreach-central --region=us-east1 --update-env-vars="KEY=value"

# Safe secret update (after updating value in Secret Manager)
echo -n "new-value" | gcloud secrets versions add SECRET_NAME --data-file=-
# Then force new revision to pick up latest secret version:
gcloud run services update greenreach-central --region=us-east1
```

### Secrets Management (Google Secret Manager)

All secrets are stored in Google Secret Manager and mounted as env vars via `--set-secrets`. Key secrets:

| Secret | Used By | Status |
|--------|---------|--------|
| JWT_SECRET | Both | Active |
| ALLOYDB_PASSWORD | Both (as DB_PASSWORD) | Active |
| SQUARE_ACCESS_TOKEN | Both | Active |
| GREENREACH_API_KEY | Both | Active |
| TOKEN_ENCRYPTION_KEY | LE | Active |
| SWITCHBOT_TOKEN, SWITCHBOT_SECRET | LE | Placeholder (needs real values) |
| SMTP_PASS | Central | Active (Google App Password for info@greenreachgreens.com) |
| STRIPE_* (3 keys) | Central | Placeholder (needs real values) |

### Networking

Both services use **Direct VPC egress** (Gen2 execution environment) on `greenreach-vpc` / `greenreach-subnet`. This allows direct TCP connections to AlloyDB at `10.87.0.2:5432` without a VPC connector.

No VPC connector is used (the `greenreach-connector` was deleted due to persistent health check failures).

### Docker Build Notes

- **ALWAYS** use `--platform linux/amd64` (Apple Silicon builds ARM64 by default, Cloud Run requires amd64)
- Docker binary path: `/Applications/Docker.app/Contents/Resources/bin/docker`
- Central `.dockerignore`: DO NOT exclude `reports/` (server.js imports `governance-review.js`)
- LE `.dockerignore`: Excludes most of `greenreach-central/` but whitelists `services/notification-store.js` and `config/database.js` (imported by server-foxtrot.js)

### DEPRECATED: Elastic Beanstalk (DO NOT USE)

The following EB environments are DEPRECATED and will be terminated:
- `light-engine-foxtrot-prod-v3` (was the LE farm)
- `greenreach-central-prod-v4` (was the Central hub)

**DO NOT deploy to, configure, or reference these environments.**
**DO NOT use `eb deploy`, `eb setenv`, `eb printenv`, or any EB CLI commands.**
**The `eb` CLI, `.ebextensions/`, `.platform/`, and `.ebignore` files are legacy artifacts.**


## Deployment Log

| Date | Service | Revision | Commit | Notes |
|------|---------|----------|--------|-------|
| 2026-04-10 | greenreach-central | 00090-9f8 | e0b85130 | Phantom inventory elimination: replace recalculateAutoInventoryFromGroups with DELETE-only cleanup (4 call sites) |
| 2026-04-10 | light-engine | 00050-78q | e0b85130 | Synced phantom inventory elimination fix |
| 2026-04-10 | greenreach-central | 00087-n7v | bc7853d4 | Fix crop inventory cards: POS doubling dedup, yieldFactor removal, Available Inventory from dbProducts |
| 2026-04-10 | light-engine | 00048-x2x | bc7853d4 | Synced crop inventory card fixes |
| 2026-04-10 | greenreach-central | 00086-8zh | 461cf8b5 | Wholesale admin cross-page: revenue source, farm name resolution, Square reconciliation |
| 2026-04-10 | light-engine | 00047-clx | 461cf8b5 | Synced wholesale-admin.js cross-page fixes |
| 2026-04-10 | greenreach-central | 00085-4km | 7b21850c | Fix phantom farm value ($99k auto-inventory cleanup), activity feed noise (JSONB upsert) |
| 2026-04-10 | greenreach-central | 00084-nbc | 2b91f62d | Fix farm accounting $0 revenue (field names, DB queries) |
| 2026-04-10 | greenreach-central | 00083-rwj | bfe9def8 | filterOrders/filterPayments, order status dropdown |
| 2026-04-10 | greenreach-central | 00082-gfm | 56e1138b | Revenue summary uses grand_total (not totals.total) |
| 2026-04-10 | greenreach-central | 00081-qvd | 3c17d5dc | Restore 12% broker commission across 12+ files |
| 2026-04-10 | light-engine | 00046-5m9 | 2b91f62d | Synced farm-admin.js fixes |
| 2026-04-08 | greenreach-central | 00048-fhx | latest | FAYE diagnostic tools fix (get_sync_status, search_codebase, get_page_route_map) |
| 2026-04-07 | greenreach-central | 00009-qsp | 72752e99 | GCP migration complete, AlloyDB connected, 168 tables |
| 2026-04-07 | light-engine | 00005-74n | 72752e99 | GCP migration complete, sensor data flowing |
| 2026-04-07 | greenreach-central | 00010-2rq | config | Optimized: memory 768Mi, concurrency 50, health probes |
| 2026-04-07 | light-engine | 00006-ghr | config | Optimized: CPU always-on, concurrency 25, max 2, health probes |

### Known Non-Critical Issues (post-migration)

- Missing tables: `accounting_ledger_entries`, `loss_events` -- need additional migrations for FAYE Intelligence and SupplyDemand features
- Column mismatches in AI Pusher (`timestamp`) and SupplyDemand (`crop`) -- schema drift from EB-era code
- These do not affect core platform functionality (health endpoints, sensor data, admin UI, auth)

---

## Notification Infrastructure

### Email (Google Workspace SMTP)

Email is the primary notification channel. Uses Google Workspace SMTP through `info@greenreachgreens.com` (a Google address).

| Property | Value |
|----------|-------|
| **Transport** | Google Workspace SMTP (`smtp.gmail.com:587`) |
| **Sender Address** | `info@greenreachgreens.com` |
| **Authentication** | Google App Password (Secret Manager: `SMTP_PASS`) |
| **CAN-SPAM Compliance** | Business address included in all email footers |

**Email Service Files:**

| File | Purpose |
|------|---------|
| `greenreach-central/services/email-service.js` | Primary email service: Google Workspace SMTP -> stub. Order confirmations, research invites. |
| `greenreach-central/services/email.js` | Legacy email service: welcome emails, team invites, wrapper exports for new templates. |
| `greenreach-central/services/email-new-templates.js` | Rich HTML templates: buyer welcome, buyer/producer monthly statements (GAP traceability, ESG scoring). |

**Required env vars / secrets for email:**

| Variable | Secret Manager? | Value |
|----------|----------------|-------|
| `SMTP_HOST` | No (env var) | `smtp.gmail.com` |
| `SMTP_PORT` | No (env var) | `587` |
| `SMTP_USER` | No (env var) | `info@greenreachgreens.com` |
| `SMTP_PASS` | Yes | Google App Password (generate at myaccount.google.com/apppasswords) |
| `FROM_EMAIL` | No (env var) | `info@greenreachgreens.com` |
| `ADMIN_ALERT_EMAIL` | No (env var) | `info@greenreachgreens.com` |

**Email template types:**
- Welcome email (new farm subscriber with credentials)
- Team invite email (new team member with credentials)
- Buyer welcome email (wholesale buyer onboarding)
- Buyer monthly statement (GAP-traceable, ESG-scored, discount tiers)
- Producer monthly statement (revenue, broker fee, fulfillment, ESG)
- Order confirmation (text-only with in-app notification push)
- Research beta invite (Light Engine Research)
- Alert notification (severity-colored for high/critical alerts)

### SMS (Email-to-SMS Gateway)

SMS is used for critical/high severity alert notifications to the admin. Delivered via carrier email-to-SMS gateways through the same Google Workspace SMTP transport used for email.

| Property | Value |
|----------|-------|
| **Provider** | Email-to-SMS via Google Workspace SMTP (carrier gateways) |
| **Recipient Allowlist** | Hardcoded in `sms-service.js` with carrier gateway mapping (safety gate -- requires code change + deploy) |
| **Current Approved** | `+16138881031` -> `6138881031@txt.bell.ca` |
| **Fallback** | Console log stub (SMS not sent if SMTP unavailable) |

**Required env vars for SMS:** Same as email (SMTP_HOST, SMTP_USER, SMTP_PASS). Plus:

| Variable | Purpose |
|----------|---------|
| `ADMIN_ALERT_PHONE` | Admin phone for alert SMS notifications |

**File:** `greenreach-central/services/sms-service.js`

### Alert Notifier

Dispatches email + SMS when high/critical severity alerts fire. Uses Google Workspace SMTP for email and email-to-SMS gateway for SMS. Rate-limited to one notification per alert type per 15 minutes. Fire-and-forget (errors logged, never thrown).

**File:** `greenreach-central/services/alert-notifier.js`

| Property | Value |
|----------|-------|
| **Trigger** | `severity` = `critical` or `high` |
| **Rate Limit** | 1 notification per `alert_type` per 15 min |
| **Email Recipient** | `ADMIN_ALERT_EMAIL` env var |
| **SMS Recipient** | `ADMIN_ALERT_PHONE` env var |

### In-App Notifications

Fallback notification channel stored in PostgreSQL (`farm_notifications` table). Automatically pushed after order confirmations and available for any email send.

**File:** `greenreach-central/services/notification-store.js`

---

## Google Cloud Storage (GCS)

| Property | Value |
|----------|-------|
| **Bucket** | `greenreach-storage` |
| **Location** | `us-east1` |
| **Access** | Uniform bucket-level, public access prevented |
| **Purpose** | Persistent file storage for Cloud Run (replaces local filesystem writes) |

Both service accounts (`light-engine-sa`, `greenreach-central-sa`) have `roles/storage.objectAdmin`.

### GCS FUSE Volume Mount

Both Cloud Run services mount the GCS bucket as a local filesystem via Cloud Storage FUSE:
- **Mount path**: `/app/data`
- **Volume name**: `gcs-data`

This allows NeDB datastores, JSON config files, and other local file writes to persist transparently across container restarts and scaling events.

### GCS Storage Helper Modules

- **Central**: `greenreach-central/services/gcs-storage.js` -- provides `uploadFile()`, `readFile()`, `writeFile()`, `readJSON()`, `writeJSON()`, `deleteFile()`, `getSignedUrl()`. Files stored under `central/` prefix in bucket.
- **LE**: `services/gcs-storage.js` -- same API, files stored under `le/` prefix.
- Auto-detects Cloud Run via `K_SERVICE` env var. Falls back to local filesystem in development.
- Env vars: `USE_GCS=true`, `GCS_BUCKET=greenreach-storage` (set on both Cloud Run services).

### Files Migrated to GCS

| File | Route | Migration |
|------|-------|-----------|
| Product images | `custom-products.js` | `uploadFile()` to GCS instead of `fs.writeFileSync` |
| `crop-pricing.json` | `admin-pricing.js` | `gcsReadJSON()`/`gcsWriteJSON()` |
| `crop-registry.json` | `admin-pricing.js` | `gcsReadJSON()`/`gcsWriteJSON()` |
| `lighting-recipes.json` | `admin-pricing.js` | `gcsReadJSON()` |
| Agent audit log | `farm-ops-agent.js` | Dual-write: local + GCS async |
| Sync monitor snapshot | `syncMonitor.js` | GCS on Cloud Run, local in dev |
| System alerts | `assistant-chat.js` | DB primary (AlloyDB), removed local file write |

---

## Cloud Scheduler

Cloud Scheduler jobs keep services warm and trigger critical background operations.

| Job | Schedule | Target | Purpose |
|-----|----------|--------|---------|
| `sensor-sync-keepalive` | Every 5 min | `GET /api/health` (LE) | Keep LE warm for setInterval loops |
| `central-keepalive` | Every 5 min | `GET /health` (Central) | Keep Central warm for sync intervals |
| `sensor-sync-cron` | Every 2 min | `POST /api/cron/sensor-sync` (LE) | Explicit sensor data pull trigger |

Service account: `scheduler-invoker@project-5d00790f-13a9-4637-a40.iam.gserviceaccount.com` (has `roles/run.invoker` on both services).

---

## System Relationship Diagram

```
+---------------------------------------------------+
|          GreenReach Central (Cloud Run)            |
|          greenreach-central service                |
|          us-east1                                   |
|                                                     |
|  greenreach-central/server.js                       |
|  AlloyDB (farm_data table) via VPC 10.87.0.2       |
|  Dashboard (farm-summary.html)                      |
|  Routes: /api/sync/telemetry, /env, /api/farm/*    |
+--------------------+------------------------------+
                     ^
                     | POST /api/sync/telemetry
                     | (every 30s via sync-service)
                     |
+--------------------+------------------------------+
|           Light Engine (Cloud Run)                 |
|           light-engine service                     |
|           us-east1                                  |
|                                                     |
|  server-foxtrot.js                                  |
|  +-----------------------------------------------+ |
|  | SwitchBot Cloud API Polling (every 30s)        | |
|  | setupLiveSensorSync() -> SwitchBot API v1.1    | |
|  +-------------------+---------------------------+ |
|                      |                              |
|                      v                              |
|  +-----------------------------------------------+ |
|  | EnvStore (in-memory) + env.json (persistence)  | |
|  | preEnvStore.updateSensor() / getSnapshot()     | |
|  +-------------------+---------------------------+ |
|                      |                              |
|                      v                              |
|  +-----------------------------------------------+ |
|  | GET /env endpoint (serves snapshot)            | |
|  | sync-service.js (reads /env, POSTs to Central) | |
|  +-----------------------------------------------+ |
+---------------------------------------------------+
                     ^
                     | SwitchBot Cloud API v1.1
                     | (HTTPS, not BLE)
                     |
+---------------------------------------------------+
|              SwitchBot Cloud                        |
|              api.switch-bot.com                     |
|                                                     |
|  4x WoIOSensor (temperature + humidity)             |
|  1x Hub Mini (W0702000, WiFi bridge)                |
|  Sensors report to Hub via BLE                      |
|  Hub uploads to SwitchBot Cloud via WiFi            |
+---------------------------------------------------+
```

---

## Two Separate Codebases, One Repository

The monorepo contains two independently deployed applications:

### 1. Light Engine (root)
- **Server**: `server-foxtrot.js` (~30,000+ lines)
- **Data directory**: `public/data/` (farm.json, iot-devices.json, groups.json, etc.)
- **Config**: `config/edge-config.json`
- **Automation**: `automation/` (env-store.js, index.js, rules, plugins)
- **Sync**: `lib/sync-service.js` (pushes telemetry to Central)
- **Deployed via**: Docker build + push to Artifact Registry, then `gcloud run services update`

### 2. GreenReach Central (greenreach-central/)
- **Server**: `greenreach-central/server.js`
- **Data directory**: `greenreach-central/public/data/` (SEPARATE copy)
- **Routes**: `greenreach-central/routes/` (sync.js, auth.js, etc.)
- **Dashboard**: `greenreach-central/public/views/farm-summary.html`
- **Central Admin UI**: `greenreach-central/public/central-admin.js` (farm detail, devices table)
- **Deployed via**: Docker build + push to Artifact Registry, then `gcloud run services update`

### Research Ownership Boundary (Authoritative)

- **Central's role**: Record keeping, admin, password resets, business management (including research data management), and multi-farm data hub. Central hosts `/api/research/*` routes for multi-tenant data, governance, and admin/reporting. Central is NOT the research workspace -- it is the backend that stores and serves research data.
- **LE's role**: The farm-facing research UX. G.W.E.N. UI and Research Workspace UI are Light Engine features accessed through LE-farm-admin.html.
- **UI files exist on BOTH servers** (`greenreach-central/public/views/research-workspace.html` and `public/views/research-workspace.html`). Both servers serve them directly as static files. DO NOT add redirects between them -- LE has no custom domain, and cross-origin redirects break iframe loading and CSP.
- **API routing**: LE proxies `/api/research/*` requests to Central. The Research Workspace UI uses relative `/api/research/*` paths, which resolve against whichever server is hosting the page. On LE, the proxy forwards them to Central. On Central, they resolve locally.
- **DO NOT redirect UI pages from Central to LE or vice versa.** Both servers serve the same static files. No redirect middleware is needed or wanted.

**Import Boundary Rule (Critical)**:
- Central deploy bundle does NOT include `../server/` from repo root.
- `greenreach-central/server.js` must only import files inside `greenreach-central/`.
- Attempting to import LE middleware (for example `../server/middleware/feature-flags`) will crash Central at runtime.

**AI Route Import Exception (LE imports from Central)**:
- server-foxtrot.js imports 3 route files from `greenreach-central/routes/`:
  1. `assistant-chat.js` (E.V.I.E.) -- mounted at `/api/assistant` with `farmAuthMiddleware`
  2. `admin-assistant.js` (F.A.Y.E.) -- mounted at `/api/admin/assistant` with `adminAuthMiddleware + role guard`
  3. `admin-ops-agent.js` -- mounted at `/api/admin/ops` with `adminAuthMiddleware + role guard`
- These are the ONLY cross-boundary imports. They work because Central route files' dependencies (pg, OpenAI, Anthropic) are installed on LE via the shared repo root `node_modules/`.
- **KNOWN GAP (Apr 2, 2026)**: `admin-calendar.js` is NOT imported or proxied on LE. The Activity Hub's EVIE task panel calls `/api/admin/calendar/tasks` which will 404 on LE. Fix: import adminCalendarRouter following the same pattern as the 3 AI routes.
- DO NOT add more cross-boundary imports without verifying all transitive dependencies exist in the LE `node_modules/`.

### Central Devices Status Contract

`GET /api/sync/:farmId/devices` can return devices without a top-level `status`.
For SwitchBot sensors, online state is commonly represented by:
1. `telemetry.online` boolean
2. `lastSeen` / `telemetry.lastUpdate` timestamp recency

Central UI must derive status from these fields rather than defaulting to offline.
Canonical rule: if explicit status is missing, use `telemetry.online`; else infer
online when last-seen is within 5 minutes.

**These data directories are NOT automatically synced.** Changes to `public/data/farm.json` do NOT affect `greenreach-central/public/data/farm.json` and vice versa.

---

## Authentication Architecture

There are TWO separate authentication systems:

### 1. Farm-to-Central Sync Authentication
- **Mechanism**: API key in `X-API-Key` header + `X-Farm-ID` header
- **Key source (farm side)**: `config/edge-config.json` apiKey field
- **Key validation (Central side)**: PostgreSQL `farms` table, then `config/farm-api-keys.json` fallback
- **Used by**: sync-service.js, any LE -> Central communication

### 2. Central Dashboard/API Authentication
- **Mechanism**: JWT Bearer token in Authorization header
- **Token source**: Login flow via `/api/farm/auth/login`
- **Used by**: Dashboard (farm-summary.html), admin pages
- **GREENREACH_API_KEY env var**: Used by Central's authMiddleware for server-to-server calls

#### Browser Auth Header Contract (UI Pages)

Some UI pages are standalone HTML/JS files and do not always run through shared helpers.
To avoid 401 regressions on protected APIs, farm-facing views must:

1. Read JWT token from both `sessionStorage` and `localStorage`
2. Send `Authorization: Bearer <token>` when available
3. Send `x-farm-id` when available (`farm_id` or `farmId` in storage)

This contract is required for endpoints such as:
- `/api/inventory/current`
- `/api/inventory/forecast`
- `/api/sustainability/metrics`
- `/api/sustainability/utility-bills`
- `/api/sustainability/food-miles`
- `/api/sustainability/trends`

Reference implementations:
- `greenreach-central/public/views/farm-inventory.html` (`fetchWithFarmAuth`)
- `greenreach-central/public/LE-farm-admin.html` (`fetchWithFarmAuth`)

### 3. Multi-Tenant Data Isolation (Phase A -- March 2026)

PostgreSQL Row-Level Security (RLS) is enabled on all tenant-scoped tables to prevent cross-farm data access. This is layered on top of application-level `WHERE farm_id = $1` filtering.

**Phase A (current)**: RLS policies are `ENABLE`d but NOT `FORCE`d. The table owner (app pool user) bypasses RLS, meaning the policies are scaffolded but inert for the application connection. This is a safety net, not a primary enforcement mechanism yet.

**RLS Policy**: `gr_tenant_isolation` on each table. Uses `current_setting('app.current_farm_id', true)` for farm scoping and `current_setting('app.is_admin', true)` for admin bypass.

**Tenant context**: The `query()` wrapper in `greenreach-central/config/database.js` accepts an `options` parameter:
- `{ farmId: 'FARM-...' }` -- sets `app.current_farm_id` via `set_config()` before each query
- `{ isAdmin: true }` -- sets `app.is_admin` for cross-farm admin queries
- `{ skipTenantContext: true }` -- bypasses context setting (migrations, schema queries)

Context is reset in a `finally` block after each query, before the client is released back to the pool.

**RLS-protected tables** (19 total):
farms, farm_backups, farm_data, farm_heartbeats, planting_assignments, experiment_records, products, farm_inventory, farm_users, farm_delivery_settings, farm_delivery_windows, farm_delivery_zones, delivery_orders, farm_alerts, conversation_history, harvest_events, lot_records, producer_accounts, producer_applications

**Migration**: 040 in `greenreach-central/config/database.js` (inline, idempotent)

**Phase B (planned)**: Enable `FORCE ROW LEVEL SECURITY` table-by-table after all query call sites pass tenant context. Migrate remaining raw `db.query()` calls to use the tenant-context `query()` wrapper.

#### Client-Side Tenant Isolation

On login and token expiry, all farm-scoped browser storage keys are cleared to prevent cross-farm data leakage:

- **farm-admin.js**: `clearStaleFarmData()` runs before new credentials are written on successful login
- **auth-guard.js**: `clearFarmStorage()` runs in all 5 token/session expiry paths

Cleared keys include: farm_id, farmId, farm_name, farmName, token, auth_token, farm_admin_session, gr.farm, farmSettings, qualityStandards, setup_completed, ai_pricing_recommendations, ai_pricing_last_check, ai_pricing_history, pricing_version, usd_to_cad_rate, impersonation_token, impersonation_farm, impersonation_expires, adminFarmId, plus dynamic `pricing_<crop>` keys.

### 4. Central-to-LE Proxy Authentication
- **Mechanism**: `X-Farm-ID` + `X-API-Key` headers (uses GREENREACH_API_KEY)
- **URL**: `FARM_EDGE_URL` env var on Central
- **Used by**: Central's `/env` endpoint when falling back to LE proxy

---

## DNS and Domain Configuration

| Domain | Points To | Status |
|--------|-----------|--------|
| `greenreachgreens.com` | Central Cloud Run (pending DNS migration from CloudFront) | MIGRATION PENDING |
| Central Cloud Run | `https://greenreach-central-1029387937866.us-east1.run.app` | ACTIVE |
| LE Cloud Run | `https://light-engine-1029387937866.us-east1.run.app` | ACTIVE |

**DNS migration TODO**: Map `greenreachgreens.com` to Central Cloud Run via `gcloud run domain-mappings create`.

---

## Farm Identity

| Property | Value |
|----------|-------|
| **Farm ID** | `FARM-MLTP9LVH-B0B85039` |
| **Farm Name** | The Notable Sprout |
| **Hardware Model** | AWS Cloud (not a physical device) |

---

## What "Edge Mode" Means in This Codebase

The codebase contains references to "edge mode," "cloud mode," and mode detection logic. Here is the reality:

- `config/edge-config.json` has `"mode": "edge"` -- this is a LEGACY setting
- The dashboard (farm-summary.html) has cloud mode detection logic -- this runs on Central, not the farm
- `lib/edge-config.js` reads edge-config.json -- this runs on the LE Cloud Run instance
- **There is no actual edge device.** The LE Cloud Run instance runs in "edge mode" because it IS the farm, just hosted in the cloud instead of on physical hardware
- The sync-service runs ON the LE Cloud Run instance and pushes data to Central -- this is the "edge to cloud sync" path, except both are cloud instances

**DO NOT try to "fix" the edge/cloud mode distinction. It works correctly as-is. The LE Cloud Run instance behaving as an "edge" device in the cloud is the intended architecture.**

---

## AI Vision & Network Intelligence Data Flow

**Phase Status**: Phase 1 COMPLETE, Phase 2 COMPLETE, Phase 3 COMPLETE, Phase 4 COMPLETE, Phase 5 COMPLETE (March 28, 2026). ALL 52 AI VISION TASKS COMPLETE.

### Experiment Records Pipeline (Farm -> Central)

```
+---------------------------+       +---------------------------+
| Light Engine (Cloud Run)      |       | GreenReach Central        |
|                           |       |                           |
| Harvest Event             |       | POST /api/sync/           |
|   -> experiment record    | ----> |   experiment-records      |
|   (crop, recipe, env,     |       |   -> deduplicate          |
|    yield, loss_rate)       |       |   -> experiment_records   |
|                           |       |      (PostgreSQL)         |
| sync-service.js (5 min)   |       |                           |
+---------------------------+       | Nightly 2 AM:             |
                                    |   computeCropBenchmarks() |
                                    |   -> crop_benchmarks tbl  |
                                    +---------------------------+
```

### Intelligence Push (Central -> Farm, every 30 min)

```
+---------------------------+       +---------------------------+
| GreenReach Central        |       | Light Engine (Cloud Run)      |
|                           |       |                           |
| analyzeAndPushToAllFarms()|       | POST /api/health/         |
|   crop_benchmarks         | ----> |   ai-recommendations      |
|   demand_signals          |       |   -> ai-recommendations   |
|   recipe_modifiers        |       |      .json (file)         |
|   risk_alerts             |       |                           |
|   environment_benchmarks  |       | Consumed by:              |
|   pricing_intelligence    |       |   - farm-admin.js         |
|   device_integrations     |       |   - eventBus listeners    |
|                           |       |   - /api/ai/suggested-crop|
| Every 30 min              |       |   - /api/ai/network-intel |
+---------------------------+       +---------------------------+
```


---

## Research Platform Architecture (Added 2026-03-28)

### Overview

The Research Platform is a gated tier (`research` in feature-flags.js) that adds experiment design, research-grade data management, electronic lab notebooks, compliance tracking, and collaboration tools on top of the existing farm management platform.

### Feature Gating

- **Deployment mode**: `research` added to valid modes in `getDeploymentMode()`
- **FEATURE_DEFINITIONS**: 6 new features: `research_workspace`, `research_data`, `research_eln`, `research_exports`, `research_compliance`, `research_collaboration`
- **ENDPOINT_FEATURES**: `/api/research` mapped to `research_workspace`
- **Access**: `autoEnforceFeatures()` middleware auto-gates all `/api/research/*` endpoints

### Research Platform Tables (30 tables, migrations 042-047)

| Migration | Tables | Purpose |
|-----------|--------|---------|
| 042 | studies, study_protocols, treatment_groups, study_links, trial_milestones, protocol_deviations | Study design and protocol management |
| 043 | research_datasets, research_observations, data_transformations, provenance_records, calibration_logs, device_maintenance | Data model, provenance, calibration |
| 044 | export_packages, data_quality_flags, qc_reviews, study_alerts | Exports and data quality |
| 045 | data_management_plans, retention_policies, grant_budgets, budget_line_items, researcher_profiles, citation_records, project_closeouts | Compliance, grants, identity |
| 046 | eln_notebooks, eln_templates, eln_entries, eln_attachments, eln_links, eln_signatures, eln_snapshots | Electronic lab notebooks |
| 047 | study_collaborators, review_comments, share_links, onboarding_checklists | Collaboration and review |

### Route Files (Central only, 88+ endpoints)

| Route File | Mount | Endpoints |
|------------|-------|-----------|
| research-studies.js | /api/research/studies | 15 endpoints: CRUD studies, protocols, treatments, milestones, deviations, links |
| research-data.js | /api/research/datasets | 12 endpoints: datasets, observations (BIGSERIAL), provenance, calibrations, maintenance |
| research-exports.js | /api/research/exports | 12 endpoints: export packages with SHA-256 checksums, quality flags, QC reviews, alerts |
| research-compliance.js | /api/research/studies/:id/dmps | 16 endpoints: DMPs, retention, budgets with variance, profiles (ORCID), citations, closeouts |
| research-eln.js | /api/research/notebooks | 20 endpoints: notebooks, entries, attachments, signatures (SHA-256), snapshots, templates |
| research-collaboration.js | /api/research/studies/:id/collaborators | 13 endpoints: collaborators, review comments, share links (token-based), onboarding checklists |

### Data Flow: Research Observations

```
+-----------------------------------+       +-----------------------------------+
| Light Engine (Cloud Run)              |       | GreenReach Central                |
|                                   |       |                                   |
| SwitchBot sensors (30s poll)      |       | POST /api/research/datasets/      |
|   -> env.json snapshot            | ----> |   :id/observations                |
|                                   |       |   -> research_observations        |
| EVIE: record_observation tool     |       |      (BIGSERIAL, provenance)      |
|   -> manual observation entry     | ----> |   -> provenance_records           |
|                                   |       |      (auto-recorded)              |
| EVIE: scan_bus_channels           |       |                                   |
|   -> device discovery scan        |       | Calibration tracking:             |
|   -> save_bus_mapping             |       |   calibration_logs (offset, next  |
|                                   |       |   due, superseded chain)          |
+-----------------------------------+       +-----------------------------------+
```

### AI Tool Integration

**EVIE (farm-ops-agent.js) -- 10 research + 3 scanning tools:**
- get_my_studies, get_study_timeline, record_observation, get_dataset_summary
- get_eln_entries, get_calibration_status, get_study_budget
- scan_bus_channels, get_bus_mappings, save_bus_mapping

**FAYE (admin-ops-agent.js) -- 4 admin tools:**
- get_research_dashboard, get_study_compliance_status, get_research_audit_log, manage_study_collaborators

### Key Tables

| Table | Purpose | Updated |
|-------|---------|---------|
| experiment_records | Per-harvest experiment data (crop, recipe, env, outcomes) | On sync (every 5 min) |
| crop_benchmarks | Aggregated per-crop benchmarks (yield, loss, temp, humidity, PPFD) | Nightly 2 AM |
| loss_events | Individual loss occurrences with cause analysis | On sync |
| network_farms | Farm metadata for network intelligence | On farm registration |
| wholesale_orders | Order data powering demand signal analysis | On order events |

---

## Payment Infrastructure

See `.github/PAYMENT_WORKFLOW.md` for the complete payment reference including Square integration, checkout flow, accounting, and webhook processing.

### Payment Services Summary

| Component | File | Purpose |
|-----------|------|---------|
| Square Payments | `greenreach-central/services/squarePaymentService.js` | Multi-tenant Square payments with farm-split + direct-charge fallback |
| Square OAuth | `greenreach-central/routes/square-oauth-proxy.js` | Per-farm Square OAuth flow (12 endpoints) |
| Webhooks | `greenreach-central/routes/payment-webhooks.js` | Square + Stripe webhook handlers with HMAC verification |
| Accounting | `greenreach-central/services/revenue-accounting-connector.js` | Double-entry ledger (10 accounts, 4 journal entry functions) |
| Order Store | `greenreach-central/services/wholesaleMemoryStore.js` | In-memory + DB order/buyer persistence |
| Wholesale | `greenreach-central/routes/wholesale.js` | Marketplace checkout, pricing, admin tools |

### Payment Data Flow

```
Buyer -> POST /checkout/execute -> allocateCartFromNetwork()
  -> processSquarePayments() (farm-split) or processGreenReachDirectPayment() (fallback)
  -> Square API -> webhook callback -> POST /api/webhooks/square
  -> ingestPaymentRevenue() + ingestFarmPayables() -> accounting journal
  -> Order confirmed -> fulfillment -> farm payout -> ingestFarmPayout()
```

### Key Payment Constants

| Constant | Value |
|----------|-------|
| Broker commission | 12% (app_fee_money on Square) |
| SKU factor | 0.65 default (range 0.50-0.75) |
| Square processing fee | 2.6% |
| Stripe processing fee | 2.9% |
| Currency | CAD |

### Payment Database Tables

`payment_records`, `wholesale_orders`, `wholesale_buyers`, `wholesale_order_logs`, `accounting_sources`, `accounting_accounts`, `accounting_transactions`, `accounting_entries`, `accounting_classifications`, `accounting_period_closes`, `webhook_events_processed`

---

## AI Agent Diagnostic Tools

### FAYE (admin-ops-agent.js)

FAYE has diagnostic tools for platform health monitoring:

| Tool | Purpose |
|------|---------|
| `get_sync_status` | Queries farm_data table for data freshness (uses actual `data_type` and `updated_at` columns) |
| `search_codebase` | Cross-file grep search with regex support (max 5 files, 3 matches/file) |
| `get_page_route_map` | Returns architecture mapping of pages to code files, routes, and data flows |
| `check_dependencies` | Checks platform dependencies and health status |
| `get_research_dashboard` | Research platform overview for admin |

### Diagnostic Workflow

FAYE follows a structured diagnostic approach:
1. Use `get_sync_status` to check data freshness
2. Use `search_codebase` to trace code paths
3. Use `get_page_route_map` to understand page-to-route architecture
4. Use `check_dependencies` for service health

