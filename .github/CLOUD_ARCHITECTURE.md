# Cloud Architecture Reference

**Version**: 1.0.0
**Date**: March 19, 2026
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
- **Deployed via**: `eb deploy` from `greenreach-central/`

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

### 3. Central-to-LE Proxy Authentication
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
