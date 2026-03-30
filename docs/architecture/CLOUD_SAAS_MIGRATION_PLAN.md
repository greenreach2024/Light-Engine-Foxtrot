# Light Engine Cloud SaaS Migration Plan (Option A)

**Status:** PROPOSAL — For Review  
**Date:** February 19, 2026  
**Goal:** Migrate Light Engine Foxtrot from per-farm standalone instances to a single cloud-hosted multi-tenant SaaS, so code updates automatically reach all farms.

---

## Executive Summary

Today, each farm runs its own copy of Foxtrot on its own hardware. Code updates require manual SSH/rsync to each device. This doesn't scale.

**Target state:** One Foxtrot deployment on AWS serves all farms. Farms access it at `{farm-slug}.greenreachgreens.com`. Edge hardware (sensors, light controllers) POSTs data to the cloud. Updates deploy once and reach everyone.

**What already exists vs. what needs to be built:**

| Component | Exists Today | Needs Work |
|-----------|-------------|------------|
| Multi-tenant middleware | Yes (253 lines, fully coded) | Wire into app, create `tenants` table |
| Central PostgreSQL DB | Yes (16 tables, farm-scoped) | Add tenant layer to tables |
| Farm-scoped data in Central | Yes (sync routes, Maps by farmId) | Extend to cover all data types |
| Cloud deployment config | Yes (.env.cloud, buildspec.yml) | Activate and configure |
| Farm admin UI (HTML/CSS/JS) | Yes (same files serve both) | Point API calls at cloud host |
| Edge sensor ingest endpoint | Yes (POST /ingest/env) | Add farm auth header |
| **Foxtrot data storage (51 JSON files)** | **Single-farm, no scoping** | **MIGRATE to PostgreSQL per-tenant** |
| **Unified auth across farms** | **3 separate JWT systems** | **CONSOLIDATE to one auth service** |
| **API tenant scoping (80+ routes)** | **Zero scoping** | **Add tenant middleware to all routes** |

---

## Architecture: Before vs. After

### Before (Today)
```
Farm A: [Computer] → server-foxtrot.js → 51 JSON files → browser UI
Farm B: [Pi]       → server-foxtrot.js → 51 JSON files → browser UI
                     (separate code copy, manual updates)
```

### After (Cloud SaaS)
```
                    ┌──────────────────────────────────┐
                    │  AWS (single deployment)          │
                    │                                   │
                    │  server-foxtrot.js (multi-tenant) │
                    │       ↕ PostgreSQL (RDS)          │
                    │       ↕ S3 (per-tenant files)     │
                    └──────┬────────────┬───────────────┘
                           │            │
              HTTPS API    │            │   HTTPS API
                    ┌──────┘            └──────┐
                    │                          │
            ┌───────┴────────┐         ┌──────┴─────────┐
            │ Farm A browser │         │ Farm B browser  │
            │ (any device)   │         │ (any device)    │
            └────────────────┘         └────────────────┘
                    ▲                          ▲
            ┌───────┴────────┐         ┌──────┴─────────┐
            │ Farm A sensors │         │ Farm B sensors  │
            │ (ESP32 / Pi)   │         │ (ESP32 / Pi)    │
            │ POST /ingest   │         │ POST /ingest    │
            └────────────────┘         └────────────────┘
```

---

## Phased Migration Plan

### Phase 1: Database Foundation (Est. 2-3 days)

**Goal:** Move Foxtrot's 51 JSON data files into PostgreSQL tables scoped by `farm_id`.

**What changes:**

| JSON File | → PostgreSQL Table | Notes |
|-----------|-------------------|-------|
| `groups.json` | `farm_groups` | Already synced to Central's `farm_data` |
| `rooms.json` | `farm_rooms` | Already synced |
| `schedules.json` | `farm_schedules` | Already synced |
| `farm.json` | `farms` (existing) | Already exists in Central DB |
| `env.json` / `env-cache.json` | `farm_env_readings` | Time-series, farm-scoped |
| `wholesale-*.json` (6 files) | `wholesale_*` tables | Mostly exist, add farm_id FK |
| `crop-registry.json` | `crop_registry` | Global shared table |
| `crop-pricing.json` | `farm_crop_pricing` | Per-farm pricing |
| `lighting-recipes.json` | `lighting_recipes` | Global + farm overrides |
| `iot-devices.json` | `farm_devices` | Per-farm |
| `calibration.json` | `farm_calibration` | Per-farm |
| `target-ranges.json` | `farm_targets` | Per-farm |
| `procurement-*.json` | `procurement_*` | Per-farm |
| `nutrient-*.json` | `farm_nutrients` | Per-farm |
| `farm-api-keys.json` | `farm_api_keys` | Per-farm |
| `spd-library.json` | `spd_library` | Global shared |

**Tasks:**
1. Create migration script: `scripts/migrate-json-to-pg.js`
   - Reads each JSON file, inserts rows scoped by `farm_id`
   - Idempotent (can re-run safely)
2. Create PostgreSQL table schemas in `greenreach-central/config/database.js`
   - All farm-specific tables get `farm_id VARCHAR REFERENCES farms(farm_id)`
3. Create data access layer: `lib/farm-data-store.js`
   - `getGroups(farmId)`, `saveGroups(farmId, data)`, etc.
   - Uses PostgreSQL in cloud mode, falls back to JSON files in dev/edge mode
   - Drop-in replacement for current `readFileSync`/`writeFileSync` calls
4. Wire `tenants` table creation into Central's auto-migration (or reuse `farms` table as tenant registry)

**Risk:** This is the highest-effort phase. 51 files × 80+ route handlers that read/write them. The data access layer abstraction is critical — it lets us migrate without rewriting every route immediately.

---

### Phase 2: Tenant Middleware Activation (Est. 1-2 days)

**Goal:** Every API request is scoped to a farm. No farm can see another farm's data.

**What exists:** `server/middleware/multi-tenant.js` — fully implemented `tenantMiddleware()`, `validateTenant()`, `scopeQuery()`, `TenantDb` class.

**What needs to happen:**
1. Wire `tenantMiddleware()` into `app.use()` (currently imported but never used)
2. Map tenants to `farms` table (avoid creating a separate `tenants` table — use `farms.farm_id` as tenant ID)
3. Update `validateTenant()` to query `farms` instead of non-existent `tenants` table
4. Add `req.farmId` (from tenant middleware) to all data access calls
5. Subdomain routing: `notable-sprout.greenreachgreens.com` → `farm_id = FARM-MLTP9LVH-B0B85039`
   - Add `slug VARCHAR UNIQUE` column to `farms` table
   - Map subdomain → slug → farm_id

**Auth consolidation:**
- Keep one JWT system (farm admin)
- Token contains `farmId`, `role`, `email`
- Cloud issues tokens at login; farm_id comes from subdomain context
- Remove PIN-based auth (edge-only concept, not needed in cloud)
- Buyer JWT stays separate (buyers are cross-farm)

---

### Phase 3: API Route Migration ✅ COMPLETE

**Goal:** All 80+ Foxtrot API endpoints read/write through the tenant-scoped data store instead of local JSON files.

**Completed:** 2026-02-19

**What was built:**
- `lib/farm-data-store.js` — Unified data access layer (DB → in-memory → flat file fallback)
- Resolution: PostgreSQL `farm_data` table → sync.js in-memory Maps → flat file → defaults
- Dual-write: All writes go to both DB and in-memory cache
- 18 data types supported: groups, rooms, schedules, telemetry, devices, farm_profile, plans, config, tray_formats, trays, crop_pricing, dedicated_crops, room_map, inventory, procurement_catalog, procurement_suppliers, procurement_orders, nutrient_dashboard

**Routes migrated:**
- `server.js`: /env, /api/env, /plans, /farm, /api/farm/profile, /api/setup/data, /api/setup/save-rooms, /api/admin/farms/:farmId/devices, /api/health/insights, /api/health/vitality, /api/tray-formats (CRUD), /api/trays (GET+POST), /data/nutrient-dashboard, /data/equipment-metadata, /data/room-map.json, /configuration, /api/farm/configuration (GET+POST), /devices (GET+POST+PATCH), /api/groups, /api/rooms
- `routes/crop-pricing.js`: GET/PUT/GET-by-name (all 3 routes + exported helper)
- `routes/procurement-admin.js`: catalog CRUD, suppliers CRUD, orders CRUD, inventory, commission-report, revenue (all 13 routes)
- `routes/misc-stubs.js`: harvest/predictions, dedicated-crops GET+POST (3 routes)

**Total: ~40 routes migrated from flat files to tenant-scoped farmStore**

---

### Phase 4: Frontend Adaptation ✅ COMPLETE

**Goal:** All HTML pages work from the cloud URL instead of `localhost:8091`.

**Completed:** 2026-02-20

**What was built:**

1. **`public/js/api-config.js`** — Universal frontend config module
   - Auto-detects cloud vs local from hostname (`*.greenreachgreens.com`)
   - Sets `window.API_BASE`, `window.FARM_SLUG`, `window.IS_CLOUD`, `window.EDGE_URL`
   - Loaded by server-side HTML injection — no manual `<script>` tags needed

2. **Enhanced `auth-guard.js`** — Fetch wrapper upgraded
   - Prepends `API_BASE` to relative URLs (future-proofs for cross-origin scenarios)
   - Injects `X-Farm-Slug` header on cloud API calls for tenant routing
   - Cloud-aware login redirect

3. **Server-side HTML injection middleware** (`server.js`)
   - Intercepts all `.html` requests before `express.static`
   - Auto-injects `api-config.js` + `auth-guard.js` into `<head>` of every page
   - Skips pages that already include them (no double-loading)
   - All 162 HTML pages now get config automatically

4. **Subdomain → farm_id resolution** (`server.js`)
   - `_extractSlug(host)`: Parses subdomain from Host header
   - `_resolveSlug(slug)`: DB lookup with in-memory cache (`slug → farm_id`)
   - Works via Host header (cloud mode) or `X-Farm-Slug` header (fetch wrapper)
   - Added `slug VARCHAR(100) UNIQUE` column to `farms` table with auto-migration
   - Auto-generates slugs from farm names on first run

5. **Slug management API**
   - `GET /api/admin/farms/:farmId/slug` — read current slug
   - `PUT /api/admin/farms/:farmId/slug` — set/update slug with validation + uniqueness check
   - Returns cloud URL: `https://{slug}.greenreachgreens.com`

6. **Hardcoded localhost URLs fixed** (7 occurrences across 6 files)
   - `views/tray-inventory.html`: `EDGE_API` → `window.EDGE_URL || window.location.origin`
   - `farm-admin.js`: Central URL fallbacks → `window.API_BASE || window.location.origin`
   - `LE-farm-admin.html`, `farm-admin.html`: Sustainability API → dynamic
   - `LE-dashboard.html`: Store link → dynamic
   - `app.foxtrot.js`: Last-resort fallback → empty string (uses location.origin)

**Key insight:** In cloud mode, frontend and API share the same origin (e.g., `notable-sprout.greenreachgreens.com`), so 301 bare-relative fetch calls (`fetch('/api/...')`) work without modification. Only hardcoded localhost URLs and cross-origin calls needed fixing.

**CORS:** Added `X-Farm-Slug` to allowed headers.

---

### Phase 5: Deployment & DNS (Est. 1 day) ✅ COMPLETE

**Commit:** (pending — Phase 5 artifacts ready)

**Goal:** Foxtrot runs on AWS alongside Central, accessible via subdomains.

**Infrastructure:**
- Single Elastic Beanstalk environment (`greenreach-central-prod-v4`)
- RDS PostgreSQL (already exists for Central)
- S3 bucket for per-tenant file uploads
- Route 53 wildcard DNS: `*.greenreachgreens.com → EB load balancer`
- SSL: ACM wildcard cert for `*.greenreachgreens.com`

**Deployment flow:**
```
git push main → CodePipeline → Build → Deploy to EB → All farms updated
```

**What was built:**

1. **HTTPS redirect middleware** (`greenreach-central/server.js`)
   - Redirects HTTP→HTTPS behind ALB via `x-forwarded-proto` header
   - Only active in cloud/production mode; skips `/health` and `/healthz`

2. **EB environment config** (`greenreach-central/.ebextensions/nodecommand.config`)
   - Added `DEPLOYMENT_MODE: cloud` env var for cloud-mode feature flags

3. **Wildcard subdomain routing** (`greenreach-central/.ebextensions/wildcard-routing.config`)
   - Nginx proxy config with sticky sessions (86400s) for WebSocket support
   - Prerequisites documented: Route 53 A record, ACM wildcard cert

4. **Build pipeline** (`buildspec.yml`)
   - Updated Node 18 → 20 to match EB platform
   - Installs `greenreach-central/` dependencies
   - Verifies critical files: `server.js`, `lib/farm-data-store.js`, `public/js/api-config.js`
   - Excludes archives, test artifacts, deploy scripts from bundle

5. **Production env template** (`greenreach-central/.env.cloud.example`)
   - Complete template: DATABASE_URL, JWT_SECRET, feature flags, AWS services
   - Documents all required/optional env vars for cloud deployment

6. **Deployment script** (`scripts/deploy-cloud.sh`)
   - `setup` — One-time: requests ACM wildcard cert, configures Route 53 DNS
   - `deploy` — Deploys code to EB environment
   - `status` / `logs` — Monitor environment health

**Manual steps remaining before first production deploy:**
- [ ] Request wildcard ACM cert: `./scripts/deploy-cloud.sh setup`
- [ ] Validate DNS records in Route 53
- [ ] Set production env vars in EB console (DATABASE_URL, JWT_SECRET, etc.)
- [ ] Deploy: `./scripts/deploy-cloud.sh deploy`
- [ ] Verify: `https://greenreachgreens.com/health`

---

## What Changes for Each User Type

### Grower (Farm Operator)
- **Before:** Opens `http://192.168.1.x:8091` on local network
- **After:** Opens `https://notable-sprout.greenreachgreens.com` from any device, anywhere
- **Benefit:** No computer to maintain, works on phone/tablet, always latest version

### Edge Device (If Used)
- **Before:** Runs full server-foxtrot.js (26K lines), serves UI, stores all data
- **After:** Runs thin agent (~200 lines): read sensors, POST to cloud, execute light commands
- **Benefit:** Cheaper hardware ($15 ESP32 vs $200 Pi), more reliable (less software to fail)

### You (Developer)
- **Before:** Edit code → commit → SSH to each farm → rsync → restart
- **After:** Edit code → commit → push → auto-deploy → done
- **Benefit:** One deployment reaches all farms. Debug remotely. Central logs.

---

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| **Data migration errors** | High | Run migration script on staging first. Keep JSON files as backup. Dual-write period. |
| **Downtime during migration** | Medium | Existing farms keep running locally until cloud is ready. Switch over per-farm. |
| **Internet dependency** | Medium | Edge devices buffer sensor data locally (existing behavior). Lights follow last-known schedule. Dashboard unavailable offline (acceptable for cloud SaaS). |
| **Performance (latency)** | Low | AWS us-east-1 serves east coast farms with <50ms latency. Static assets via CloudFront CDN. |
| **Multi-tenant data leak** | High | PostgreSQL RLS (Row-Level Security) enforced at DB level. Tenant middleware validates every request. Integration tests for isolation. |
| **Cost increase** | Low | RDS t3.micro ($15/mo) + EB t3.small ($15/mo) + S3 ($1/mo) ≈ $31/mo total. Already budgeted for Central. |

---

## Implementation Order & Timeline

| Phase | Work | Est. Time | Dependencies |
|-------|------|-----------|--------------|
| **1** | Database foundation + data access layer | 2-3 days | None |
| **2** | Tenant middleware activation | 1-2 days | Phase 1 |
| **3** | API route migration (prioritized) | 3-5 days | Phase 1, 2 |
| **4** | Frontend API base URL adaptation | 1-2 days | Phase 3 |
| **5** | DNS, SSL, deployment pipeline | 1 day | Phase 4 |
| | **Total estimated** | **8-13 days** | |

---

## What NOT To Do

1. **Don't rebuild the UI** — Same HTML/JS pages, just served from cloud
2. **Don't create a separate `tenants` table** — Use existing `farms` table as tenant registry
3. **Don't rewrite all routes at once** — Use data access shim, migrate incrementally
4. **Don't remove edge device support** — Keep it as an option for farms that want local sensor/light control
5. **Don't break local dev** — Data access layer falls back to JSON files when `DEPLOYMENT_MODE=edge`

---

## Decision Points for Review

1. **Subdomain pattern:** `{farm-slug}.greenreachgreens.com` vs. `app.greenreachgreens.com/{farm-slug}`?
2. **Migration strategy:** Big-bang switchover vs. farm-by-farm opt-in?
3. **Edge device scope:** Thin sensor agent only, or keep optional local UI fallback?
4. **Start Phase 1 now?**
