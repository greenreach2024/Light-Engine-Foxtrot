# Cloud Architecture Reference

**Version**: 1.1.0
**Date**: March 23, 2026
**Authority**: This document is the canonical source of truth for system architecture. All agents MUST read this before modifying any infrastructure, deployment, data flow, or sensor-related code.

---

## THE FARM IS 100% CLOUD

There is NO physical farm device. No Raspberry Pi. No edge hardware. No on-premise server.

The "farm" runs entirely on AWS Elastic Beanstalk. The Light Engine (LE) IS the farm. The terms "edge" and "cloud" are MERGED into a single cloud deployment. Any code references to "edge mode," "edge device," or "hardware" are legacy artifacts from when a physical device was planned but never deployed.

**If you are an AI agent reading this: DO NOT assume a physical device exists. DO NOT reference a "farm Pi," "edge device," or "local hardware." The LE-EB instance IS the farm.**

---

## Elastic Beanstalk Environments

### Light Engine (The Farm)

| Property | Value |
|----------|-------|
| **Application** | `light-engine-foxtrot` |
| **Active Environment** | `light-engine-foxtrot-prod-v3` |
| **CNAME (SWAPPED)** | `light-engine-foxtrot-prod-v2.eba-ukiyyqf9.us-east-1.elasticbeanstalk.com` |
| **Platform** | Node.js 20 on 64bit Amazon Linux 2023 |
| **Region** | us-east-1 |
| **Entry Point** | `node server-foxtrot.js` (via Procfile) |
| **Deploy From** | Repo root: `/Volumes/CodeVault/Projects/Light-Engine-Foxtrot/` |
| **Deploy Command** | `eb deploy light-engine-foxtrot-prod-v3` |

**CRITICAL: CNAME Swap Alert**
The v3 environment answers on the v2 CNAME due to a previous `eb swap`. This means:
- URL contains "v2" but the actual environment is v3
- All references to the LE URL will say "v2" in the hostname
- This is correct and expected. DO NOT "fix" this.

### Light Engine v2 (DEAD - DO NOT USE)

| Property | Value |
|----------|-------|
| **Environment** | `light-engine-foxtrot-prod-v2` |
| **CNAME** | `light-engine-foxtrot-prod-v3.us-east-1.elasticbeanstalk.com` |
| **Status** | Grey / Terminated / CloudFormation DELETE_FAILED |
| **DNS** | DOES NOT RESOLVE |

**NEVER deploy to v2. NEVER reference v2 as a target. It is dead.**

### GreenReach Central (The Hub)

| Property | Value |
|----------|-------|
| **Application** | `greenreach-central` |
| **Active Environment** | `greenreach-central-prod-v4` |
| **CNAME** | Standard EB CNAME in us-east-1 |
| **Custom Domain** | `greenreachgreens.com` (via Route53/CloudFront) |
| **Platform** | Node.js 20 on 64bit Amazon Linux 2023 |
| **Entry Point** | `npm start` (via Procfile) -> `greenreach-central/server.js` |
| **Deploy From** | `greenreach-central/` subdirectory |
| **Deploy Command** | `cd greenreach-central && eb deploy greenreach-central-prod-v4` |

---

## System Relationship Diagram

```
+---------------------------------------------------+
|              GreenReach Central (EB)               |
|              greenreach-central-prod-v4            |
|                                                     |
|  greenreach-central/server.js                       |
|  PostgreSQL (farm_data table)                       |
|  Dashboard (farm-summary.html)                      |
|  Routes: /api/sync/telemetry, /env, /api/farm/*    |
+--------------------+------------------------------+
                     ^
                     | POST /api/sync/telemetry
                     | (every 30s via sync-service)
                     |
+--------------------+------------------------------+
|           Light Engine Foxtrot (EB)                |
|           light-engine-foxtrot-prod-v3             |
|           (CNAME: ...prod-v2.eba-ukiyyqf9...)      |
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
- **Deployed via**: `eb deploy` from repo root

### 2. GreenReach Central (greenreach-central/)
- **Server**: `greenreach-central/server.js`
- **Data directory**: `greenreach-central/public/data/` (SEPARATE copy)
- **Routes**: `greenreach-central/routes/` (sync.js, auth.js, etc.)
- **Dashboard**: `greenreach-central/public/views/farm-summary.html`
- **Central Admin UI**: `greenreach-central/public/central-admin.js` (farm detail, devices table)
- **Deployed via**: `eb deploy` from `greenreach-central/`

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
| `greenreachgreens.com` | Central (CloudFront/ALB) | ACTIVE |
| `foxtrot.greenreachgreens.com` | Was supposed to point to LE-EB | BROKEN (does not resolve) |
| LE-EB direct | `light-engine-foxtrot-prod-v2.eba-ukiyyqf9.us-east-1.elasticbeanstalk.com` | ACTIVE (v3 on v2 CNAME) |

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
- `lib/edge-config.js` reads edge-config.json -- this runs on the LE-EB instance
- **There is no actual edge device.** The LE-EB cloud instance runs in "edge mode" because it IS the farm, just hosted in the cloud instead of on physical hardware
- The sync-service runs ON the LE-EB instance and pushes data to Central -- this is the "edge to cloud sync" path, except both are cloud instances

**DO NOT try to "fix" the edge/cloud mode distinction. It works correctly as-is. The LE-EB instance behaving as an "edge" device in the cloud is the intended architecture.**

---

## AI Vision & Network Intelligence Data Flow

**Phase Status**: Phase 1 COMPLETE, Phase 2 COMPLETE, Phase 3 COMPLETE, Phase 4 COMPLETE (March 27, 2026). All gates PASSED through Phase 4->5.

### Experiment Records Pipeline (Farm -> Central)

```
+---------------------------+       +---------------------------+
| Light Engine (LE-EB)      |       | GreenReach Central        |
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
| GreenReach Central        |       | Light Engine (LE-EB)      |
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

### Key Tables

| Table | Purpose | Updated |
|-------|---------|---------|
| experiment_records | Per-harvest experiment data (crop, recipe, env, outcomes) | On sync (every 5 min) |
| crop_benchmarks | Aggregated per-crop benchmarks (yield, loss, temp, humidity, PPFD) | Nightly 2 AM |
| loss_events | Individual loss occurrences with cause analysis | On sync |
| network_farms | Farm metadata for network intelligence | On farm registration |
| wholesale_orders | Order data powering demand signal analysis | On order events |

