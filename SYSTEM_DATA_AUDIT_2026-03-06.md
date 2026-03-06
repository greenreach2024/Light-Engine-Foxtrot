# GreenReach System Architecture — Complete Data Audit

> **Date:** 2026-03-06  
> **Scope:** Full audit of Light Engine + GreenReach Central — all data flows, databases, storage tables, display fields, communication protocols, and known issues.  
> **Purpose:** Quick-reference document for debugging data issues, ML/AI integration, and system evolution.  
> **Rule:** No code changes were made as part of this audit.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Communication Protocols & Data Flow](#2-communication-protocols--data-flow)
3. [PostgreSQL Tables (GreenReach Central — AWS RDS)](#3-postgresql-tables-greenreach-central--aws-rds)
4. [farm_data Key-Value Store (Virtual Tables)](#4-farm_data-key-value-store-virtual-tables)
5. [NeDB File Stores (Light Engine)](#5-nedb-file-stores-light-engine)
6. [SQLite Database (Light Engine)](#6-sqlite-database-light-engine)
7. [JSON File Stores (Light Engine)](#7-json-file-stores-light-engine)
8. [In-Memory Stores (Light Engine)](#8-in-memory-stores-light-engine)
9. [API Endpoints — Light Engine](#9-api-endpoints--light-engine)
10. [API Endpoints — GreenReach Central](#10-api-endpoints--greenreach-central)
11. [Proxy & Forwarding Routes](#11-proxy--forwarding-routes)
12. [UI Pages & Display Fields](#12-ui-pages--display-fields)
13. [Outdoor Weather System — Status & Issues](#13-outdoor-weather-system--status--issues)
14. [Sensor Data Flow — End-to-End Trace](#14-sensor-data-flow--end-to-end-trace)
15. [ML/AI Data Dependencies](#15-mlai-data-dependencies)
16. [Known Issues & Gaps](#16-known-issues--gaps)
17. [Recent Fixes Log (March 2026)](#17-recent-fixes-log-march-2026)

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                           EXTERNAL SERVICES                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐            │
│  │  Open-Meteo   │  │  SwitchBot   │  │  Square/     │  │  Nominatim   │            │
│  │  Weather API  │  │  Cloud API   │  │  Stripe      │  │  Geocoding   │            │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘            │
│         │                  │                  │                  │                    │
└─────────┼──────────────────┼──────────────────┼──────────────────┼────────────────────┘
          │                  │                  │                  │
┌─────────▼──────────────────▼──────────────────┼──────────────────▼────────────────────┐
│  LIGHT ENGINE (server-foxtrot.js)             │                                       │
│  Host: light-engine-foxtrot-prod-v3           │                                       │
│  Port: 8091 | ~30,249 lines                   │                                       │
│                                                │                                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐    │                                       │
│  │ SwitchBot│  │ Kasa     │  │ MQTT     │    │                                       │
│  │ Polling  │  │ Control  │  │ Broker   │    │                                       │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘    │                                       │
│       │              │              │          │                                       │
│       ▼              ▼              ▼          │                                       │
│  ┌─────────────────────────────────────┐      │                                       │
│  │  In-Memory: LAST_WEATHER,           │      │                                       │
│  │  preEnvStore, device state          │      │                                       │
│  └─────────────┬───────────────────────┘      │                                       │
│                │                               │                                       │
│  ┌─────────────▼───────────┐                  │                                       │
│  │  Persistent Storage:     │                  │                                       │
│  │  • JSON files (data/)    │                  │                                       │
│  │  • NeDB (.db files) x41  │                  │                                       │
│  │  • SQLite (lightengine.db)│                 │                                       │
│  └──────────────────────────┘                  │                                       │
│                                                │                                       │
│  Endpoints: /env, /data/*, /api/weather,       │                                       │
│  /switchbot/*, /api/kasa/*, /api/ml/*,         │                                       │
│  /devices, /lights, /automation/*              │                                       │
└────────┬───────────────────────────────────────┘
         │  POST /api/sync/*         ▲
         │  POST /api/farm-settings  │  GET /env, /data/*
         ▼                           │  Proxy forwarding
┌────────┴───────────────────────────┴─────────────────────────────────────────────────┐
│  GREENREACH CENTRAL (greenreach-central/server.js)                                   │
│  Host: greenreach-central-prod-v4 | greenreachgreens.com                             │
│  Port: 8080 | ~4,119 lines                                                           │
│                                                                                       │
│  ┌──────────────────────────────────────────────────────────────┐                     │
│  │  PostgreSQL (AWS RDS) — Multi-Tenant                         │                     │
│  │  ~50 tables | farm_data key-value store (9 data_types)       │                     │
│  │  farmDataMiddleware: GET /data/*.json → farm_data table      │                     │
│  │  farmDataWriteMiddleware: POST /data/*.json → farm_data      │                     │
│  └──────────────────────────────────────────────────────────────┘                     │
│                                                                                       │
│  Proxy → Light Engine: /env, /switchbot, /kasa, /discovery                            │
│  Native: /api/auth, /api/farms, /api/admin, /api/wholesale,                           │
│          /api/accounting, /api/billing, /api/orders                                    │
│  ⚠  STUB: /api/weather (hardcoded 22°C — NOT REAL)                                   │
└───────────────────────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌───────────────────────────────────────────┐
│  BROWSER (Frontend UI)                     │
│  farm-summary.html  — Main dashboard       │
│  room-heatmap.html  — Sensor heat map      │
│  room-mapper.html   — Room layout editor   │
│  iot-manager.html   — Device management    │
│  + 12 more view pages                      │
└───────────────────────────────────────────┘
```

### Environment Details

| Component | Instance | URL | Status |
|-----------|----------|-----|--------|
| **Light Engine** | `light-engine-foxtrot-prod-v3` | `light-engine-foxtrot-prod-v2.eba-ukiyyqf9.us-east-1.elasticbeanstalk.com` | Green / Healthy |
| **GreenReach Central** | `greenreach-central-prod-v4` | `greenreachgreens.com` | Green / Healthy, DB Connected |
| **PostgreSQL** | AWS RDS | Internal to Central VPC | Connected |
| **Farm ID** | — | `FARM-MLTP9LVH-B0B85039` | Active |
| **Farm Name** | — | The Notable Sprout | — |
| **Farm Coordinates** | — | lat: 44.2588, lng: -76.3729 (Kingston, ON) | — |
| **Branch** | — | `recovery/feb11-clean` | — |

---

## 2. Communication Protocols & Data Flow

### 2.1 Authentication Mechanisms

| Server | Guard | Mechanism | Used For |
|--------|-------|-----------|----------|
| **Light Engine** | `pinGuard` | PIN code via body/header `x-farm-pin`/query | Device control, write operations |
| **Light Engine** | `requireEdgeForControl` | JWT `planType !== 'cloud'` | Prevents remote device commands |
| **Light Engine** | `authenticateToken` | JWT Bearer → `req.user` (farmId, email, role) | Farm-scoped API access |
| **Light Engine** | `requireBuyerAuth` | Wholesale JWT (`buyerId`/`sub`) | Wholesale buyer access |
| **Light Engine** | `adminAuthMiddleware` | Admin JWT/session | Admin dashboard |
| **Central** | Farm context middleware | Extracts farmId from: (1) JWT Bearer, (2) `X-Farm-ID` header, (3) subdomain slug, (4) `FARM_ID` env var | All farm-scoped endpoints |
| **Central** | `authMiddleware` | JWT verification | Sensitive routes |
| **Central** | `adminAuthMiddleware` | Admin JWT | `/api/admin/*` |
| **Central** | Rate limiter | 500 req/15min | `/api/*` |

### 2.2 Data Sync Flow

```
Light Engine                              GreenReach Central
═══════════                               ══════════════════
                  POST /api/sync/farm-data
farm.json    ──────────────────────────►  farm_data table (data_type='farm_profile')
rooms.json   ──────────────────────────►  farm_data table (data_type='rooms')
groups.json  ──────────────────────────►  farm_data table (data_type='groups')
env.json     ──────────────────────────►  farm_data table (data_type='telemetry')
plans.json   ──────────────────────────►  farm_data table (data_type='plans')
schedules.json ────────────────────────►  farm_data table (data_type='schedules')
iot-devices.json ──────────────────────►  farm_data table (data_type='devices')
room-map.json  ────────────────────────►  farm_data table (data_type='room_map')

                  POST /api/farm-settings/sync
Farm settings  ────────────────────────►  farms table (settings JSONB)

                  POST /devices (registration forwarding)
New SwitchBot  ────────────────────────►  farm_data table (data_type='devices')
devices
```

### 2.3 External API Integrations

| API | Protocol | Auth | What It Provides | Polling Interval |
|-----|----------|------|-------------------|-----------------|
| **Open-Meteo** | HTTPS REST | None (free API) | Weather: temp, humidity, wind, precip, WMO codes | 10 min (Light Engine only) |
| **SwitchBot Cloud** | HTTPS REST v1.1 | HMAC-SHA256 (token + secret) | Device list, status, commands | On-demand + telemetry ingest |
| **Kasa** | Local TCP/mDNS | None (LAN) | Smart plug discovery & control | On-demand scan |
| **Nominatim/OSM** | HTTPS REST | None | Geocoding (address ↔ coordinates) | On-demand |
| **Square** | HTTPS OAuth2 | OAuth tokens | Payment processing | On-demand |
| **Stripe** | HTTPS OAuth2 | OAuth tokens | Payment processing | On-demand |
| **IFTTT** | HTTPS Webhooks | Webhook key | Smart home automation triggers | Event-driven |

### 2.4 SwitchBot Credential Forwarding (Fixed 2026-03-05)

```
Browser                    Central                         Light Engine
═══════                    ═══════                         ════════════
POST /switchbot/discover ─────►
  {token, secret}          Store creds in DB
                           (credential-store) ────────────► Forward token+secret
                                                            via POST /api/credential-store
                           Forward discover ──────────────► POST /switchbot/discover
                                                            (LE uses forwarded creds)
                           ◄────────────────────────────── Return discovered devices
◄─────────────────────────
  {devices: [...]}         Forward device registration ───► POST /devices
                                                            (LE registers devices)
```

### 2.5 Device Registration Forwarding (Fixed 2026-03-05)

When a new device is discovered via Central, Central now forwards the device registration to the Light Engine so it appears in the LE's local device list and begins telemetry polling.

---

## 3. PostgreSQL Tables (GreenReach Central — AWS RDS)

~50 tables. All multi-tenant, scoped by `farm_id` where applicable.

### Core Tables

| Table | Key Columns | Purpose | Read By | Written By |
|-------|-------------|---------|---------|------------|
| `farms` | id, name, email, api_url, slug, plan_type, metadata, settings, status | Farm registration & config | Farm CRUD, admin, heartbeat | Farm registration, sync |
| `farm_data` | farm_id, data_type, data (JSONB), updated_at | **Multi-tenant key-value store** — see §4 | farmDataMiddleware (`/data/*.json`) | farmDataWriteMiddleware, sync |
| `farm_heartbeats` | farm_id, timestamp | Online/offline status | Admin monitoring | Heartbeat endpoint |
| `farm_backups` | farm_id, backup_data, created_at | Config backups | Restore endpoint | Backup endpoint |
| `farm_users` | farm_id, email, password_hash, role | Per-farm user accounts | Farm auth | User CRUD |
| `farm_api_keys` | farm_id, api_key | API auth keys | Auth middleware | Farm setup |
| `farm_inventory` | farm_id, crop, quantity, updated_at | Crop inventory | Admin, AI insights | Inventory sync |

### Delivery & Pricing Tables

| Table | Purpose |
|-------|---------|
| `farm_delivery_settings` | Delivery feature config per farm |
| `farm_delivery_windows` | Delivery time windows |
| `farm_delivery_zones` | Delivery zones with postal prefixes |
| `farm_cost_surveys` | Cost-of-production survey data |
| `pricing_offers` | Wholesale pricing offers to farms |
| `pricing_responses` | Farm responses to pricing |
| `pricing_history` | Historical pricing records |

### Orders & Payments

| Table | Purpose |
|-------|---------|
| `orders` | Customer orders (order_data JSONB) |
| `products` | Product catalog |
| `payment_records` | Payment transactions |
| `wholesale_buyers` | Wholesale buyer accounts |
| `wholesale_orders` | Wholesale order records |

### Accounting (Double-Entry)

| Table | Purpose |
|-------|---------|
| `accounting_sources` | Data sources (Square, Stripe) |
| `accounting_accounts` | Chart of accounts |
| `accounting_transactions` | Financial transactions |
| `accounting_entries` | Double-entry journal entries |
| `accounting_classifications` | Transaction categories |
| `accounting_period_closes` | Period close/lock |
| `valuation_snapshots` | Inventory/crop valuation |

### Admin & Audit

| Table | Purpose |
|-------|---------|
| `admin_users` | Admin portal users |
| `admin_sessions` | Admin login sessions |
| `admin_audit_log` | Admin action audit trail |
| `audit_log` | General audit log |

### AI & Experiments

| Table | Purpose |
|-------|---------|
| `experiment_records` | A/B experiment records |
| `ab_experiments` | A/B experiment definitions |
| `ab_experiment_observations` | Experiment data points |
| `crop_benchmarks` | Network crop benchmarks |
| `network_recipe_modifiers` | Network recipe modifier suggestions |
| `ai_rules` | AI automation rules |
| `ai_reference_sites` | AI research URLs |

### Grant Wizard

| Table | Purpose |
|-------|---------|
| `grant_users` | Grant wizard user accounts |
| `grant_programs` | Grant program definitions |
| `grant_applications` | User grant applications |
| `grant_export_packs` | Exported grant packages |
| `grant_program_snapshots` | Program point-in-time snapshots |
| `grant_outcome_analytics` | Outcome tracking |
| `grant_research_jobs` | Background research jobs |
| `grant_wizard_events` | User event tracking |
| `grant_program_change_alerts` | Program change alerts |

### Other Tables

| Table | Purpose |
|-------|---------|
| `devices` | Device registry |
| `device_integrations` | Third-party integration configs |
| `planting_assignments` | Planting assignment records |
| `recipe_requests` | Farm recipe requests |
| `rooms` | Room records |
| `users` | User records |
| `loss_events` | Waste/loss events |
| `farm_alerts` | Alert records |

---

## 4. farm_data Key-Value Store (Virtual Tables)

The `farm_data` table is the **primary data bridge** between Light Engine and Central. Each row has `(farm_id, data_type, data JSONB)`.

| data_type | Maps to File | Content Schema | UI Consumers |
|-----------|-------------|----------------|--------------|
| `farm_profile` | farm.json | `{name, location, coordinates: {lat, lng}, ...}` | farm-summary (farm name, weather coords) |
| `rooms` | rooms.json | `[{id, name, fixtures: [...], ...}]` | room-heatmap (room list), room-mapper |
| `groups` | groups.json | `[{id, name, crop, zone, ...}]` | planting-scheduler, farm-summary |
| `telemetry` | env.json | `{zones: [{id, sensors: {tempC, rh, vpd}, ...}], outdoor_conditions, ...}` | farm-summary (zone cards), heatmap (fallback) |
| `devices` | iot-devices.json | `[{id, name, type, zone, telemetry: {temperature, humidity}, ...}]` | farm-summary (sensor cards), heatmap (primary), iot-manager |
| `plans` | plans.json | `{plans: [...], schedules: [...]}` | farm-summary (light schedule) |
| `schedules` | schedules.json | `[{id, groupId, entries: [...]}]` | farm-summary |
| `room_map` | room-map.json | `{rooms: {roomId: {walls, placements: [...]}}, zones: [...]}` | room-heatmap (layout), room-mapper (edit) |
| `light_setups` | light-setups.json | Light hardware configurations | Setup wizard |

### farmDataMiddleware Flow

```
Browser: GET /data/iot-devices.json
    │
    ▼
Central: farmDataMiddleware intercepts
    │
    ├─ Extract farm_id from req context
    │
    ├─ Map filename → data_type:
    │   "iot-devices.json" → "devices"
    │   "room-map.json" → "room_map"
    │   "farm.json" → "farm_profile"
    │   etc.
    │
    ├─ SELECT data FROM farm_data WHERE farm_id=$1 AND data_type=$2
    │
    ├─ If found → return data as JSON
    │
    └─ If not found → fall through to express.static (serve from disk)
```

---

## 5. NeDB File Stores (Light Engine)

41 NeDB `.db` files in the `data/` directory. Each is a document store (MongoDB-like).

### Core NeDB Stores

| File | Variable | What It Stores |
|------|----------|----------------|
| `devices.nedb` | `store` | Device registry mirror |
| `trays.db` | `traysDB` | Individual tray records |
| `tray-runs.db` | `trayRunsDB` | Grow run sessions |
| `tray-formats.db` | `trayFormatsDB` | Tray format definitions |
| `tray-placements.db` | `trayPlacementsDB` | Tray spatial positions |
| `tray-loss-events.db` | `trayLossEventsDB` | Waste/loss events |
| `integrations.db` | `integrationDB` | Third-party integration configs |
| `wizard-states.db` | `wizardStatesDB` | Setup wizard state per session |
| `device-health.db` | `deviceHealthDB` | Device health/uptime records |

### AI & Agent NeDB Stores

| File | Variable | What It Stores |
|------|----------|----------------|
| `agent-audit.db` | `agentAuditDB` | AI agent action audit trail |
| `ai-feedback.db` | `aiFeedbackDB` | AI recommendation feedback |
| `applied-recipes.db` | `appliedRecipesDB` | Applied lighting recipe history |
| `harvest-outcomes.db` | `harvestOutcomesDB` | Harvest outcome records |

### Inventory NeDB Stores

| File | Variable | What It Stores |
|------|----------|----------------|
| `seeds-inventory.db` | `seedsInventoryDB` | Seeds inventory |
| `packaging-inventory.db` | `packagingInventoryDB` | Packaging materials |
| `nutrients-inventory.db` | `nutrientsInventoryDB` | Nutrients/fertilizer |
| `equipment-inventory.db` | `equipmentInventoryDB` | Equipment items |
| `supplies-inventory.db` | `suppliesInventoryDB` | General supplies |

### Wholesale NeDB Stores

| File | Variable | What It Stores |
|------|----------|----------------|
| `wholesale-orders.db` | `ordersDB` | Wholesale orders |
| `wholesale-sub-orders.db` | `subOrdersDB` | Order line items |
| `farm-perf-events.db` | `perfEventsDB` | Farm performance metrics |
| `wholesale-sla-rules.db` | `slaRulesDB` | SLA definitions |
| `wholesale-substitution-policies.db` | `substitutionPoliciesDB` | Substitution policies |
| `wholesale-buyer-preferences.db` | `buyerPreferencesDB` | Buyer preferences |
| `wholesale-sla-violations.db` | `slaViolationsDB` | SLA violation records |
| `wholesale-substitution-approvals.db` | `substitutionApprovalsDB` | Substitution approvals |
| `wholesale-payments.db` | `paymentsDB` | Payment records |
| `wholesale-refunds.db` | `refundsDB` | Refund records |
| `wholesale-broker-fee-reversals.db` | `brokerFeeReversalsDB` | Broker fee reversals |
| `inventory-reservations.db` | `reservationsDB` | Inventory hold reservations |

### OAuth & Security NeDB Stores

| File | Variable | What It Stores |
|------|----------|----------------|
| `oauth-states.db` | `oauthStatesDB` | OAuth flow nonces |
| `oauth-tokens.db` | `oauthTokensDB` | OAuth access/refresh tokens |
| `stripe-accounts.db` | `stripeAccountsDB` | Stripe Connect accounts |
| `stripe-oauth-states.db` | `oauthStatesDB` | Stripe OAuth states |
| `audit-log.db` | `auditDB` | Wholesale audit log |
| `safety-envelope-state.db` | (inline) | Device safety envelope state |
| `safety-audit-log.db` | (inline) | Safety override audit trail |

### Orphaned NeDB Files (no code references)

| File | Suspected Purpose |
|------|-------------------|
| `nutrient-targets.db` | Nutrient target settings |
| `sensor-calibrations.db` | Sensor calibration data |
| `pump-calibrations.db` | Pump calibration data |

---

## 6. SQLite Database (Light Engine)

| File | Tables |
|------|--------|
| `data/lightengine.db` | `sensors`, `zones`, `rooms`, `devices`, `trays`, `sensor_readings`, `farm_settings`, `alerts`, `automation_rules` |

---

## 7. JSON File Stores (Light Engine)

### Primary Data Files (`public/data/` or `data/`)

| File | Constant | What It Stores | Read Endpoint | Write Endpoint |
|------|----------|----------------|---------------|----------------|
| `env.json` | `ENV_PATH` | Live environmental readings per zone | `GET /data/env.json`, `/env` | `POST /env`, `/ingest/env` |
| `farm.json` | `FARM_PATH` | Farm identity, coordinates, config | `GET /data/farm.json`, `/farm` | `POST /farm` |
| `rooms.json` | `ROOMS_PATH` | Room definitions with fixtures | `GET /data/rooms.json` | `POST /data/rooms.json` |
| `groups.json` | `GROUPS_PATH` | Zone/crop group definitions | `GET /data/groups.json` | `PUT /groups`, `POST /data/groups.json` |
| `plans.json` | `PLANS_PATH` | Grow lighting plans | `GET /plans`, `/data/plans.json` | `POST /plans` |
| `schedules.json` | — | Light schedules | `GET /data/schedules.json`, `/sched` | `POST /sched` |
| `iot-devices.json` | `IOT_DEVICES_PATH` | IoT device registry with telemetry | `GET /data/iot-devices.json` | SwitchBot polling, device registration |
| `room-map.json` | — | Room spatial layout (walls, placements) | `GET /data/room-map.json` | Room Mapper save |
| `equipment.catalog.json` | `EQUIPMENT_CATALOG_PATH` | Equipment catalog with HVAC | `GET /data/equipment.json` | Equipment endpoints |
| `devices.cache.json` | `DEVICES_CACHE_PATH` | Cached device list | `GET /data/devices.cache.json` | Device discovery |
| `switchbot.cache.json` | `SWITCHBOT_CACHE_PATH` | SwitchBot device cache | SwitchBot integration | SwitchBot discovery |
| `calibration.json` | `CALIBRATIONS_PATH` | Sensor calibration offsets | `/calibration` | `/calibration` |
| `controller.json` | `CONTROLLER_PATH` | Controller URL | Internal | `POST /api/controller` |
| `forwarder.json` | `FORWARDER_PATH` | Forwarder URL | Internal | `POST /api/forwarder` |

### Secondary Data Files

| File | What It Stores |
|------|----------------|
| `nutrient-dashboard.json` | Nutrient dashboard state |
| `ui.equip.json` | UI equipment state |
| `ui.ctrlmap.json` | UI control mappings |
| `harvest-log.json` | Harvest log entries |
| `lighting-recipes.json` | Lighting recipe definitions |
| `planting-assignments.json` | Planting zone assignments |
| `ai-recommendations.json` | AI-generated recommendations |
| `crop-pricing.json` | Crop pricing data |
| `wholesale-products.json` | Wholesale product catalog |
| `target-ranges.json` | Environmental target ranges |
| `agent-permissions.json` | AI agent permission config |
| `alert-history.json` | Alert history |
| `crop-weight-records.json` | Crop weight tracking |
| `device-thresholds.json` | Device alarm thresholds |
| `ml-model-metrics.json` | ML model performance |
| `recipe-modifiers.json` | Recipe modifier config |

### Directory-Based Stores

| Directory | Contents |
|-----------|----------|
| `data/orders/` | Individual order JSON files |
| `data/automation/` | `env-state.json`, `events.ndjson`, `zone-device-mappings.json` |
| `data/recipes-v2/` | CSV recipe data per crop variety |
| `data/demo/` | Demo farm data |

---

## 8. In-Memory Stores (Light Engine)

These are **lost on restart**. Critical for understanding runtime behavior.

| Variable | What It Holds | Refreshed By |
|----------|---------------|--------------|
| `LAST_WEATHER` | Cached outdoor weather (temp, humidity, wind, description) | Open-Meteo polling every 10 min |
| `LAST_WEATHER_AT` | Timestamp of last weather fetch | Weather polling |
| `preEnvStore` | Pre-computed env zone snapshot for fast `/env` responses | Telemetry ingest |
| `switchBotStatusCache` | SwitchBot device status cache | SwitchBot status requests |
| `learningCorrelationCache` | AI learning correlation results | Correlation computation |
| `logBuffer` | Buffered log entries | Log writes |
| `cloudHist` | Cloud telemetry history buffer | Telemetry ingest |
| `global.farmAdminSessions` | Farm admin session tokens (Map) | Login |
| `wizardStates` | Setup wizard state cache (backed by NeDB) | Wizard interactions |
| `wizardDiscoveryContext` | Wizard discovery context | Device discovery |
| `__jsonWriteQueues` | Write-queue promise chains per file | JSON write operations |

---

## 9. API Endpoints — Light Engine

### Environmental Data

| Method | Path | Auth | Source | Returns |
|--------|------|------|--------|---------|
| GET | `/env` | none | `preEnvStore` + `readEnv()` + `LAST_WEATHER` + cloud zones | Zones, rooms, AI advisory, **outdoor conditions**, targets, control state |
| GET | `/env?legacy=1` | none | `readEnv()` → env.json | Legacy raw env state |
| POST | `/env` | pinGuard | → env.json | Upsert env state |
| POST | `/env/readings` | pinGuard | → env.json | Append sensor reading |
| PATCH | `/env/rooms/:roomId` | pinGuard | → env.json | Update room config |
| POST | `/ingest/env` | none | → in-memory + file | Telemetry ingest (zoneId, temp, humidity, vpd, co2, battery, rssi) |

### Weather (REAL — Open-Meteo)

| Method | Path | Auth | Source | Returns |
|--------|------|------|--------|---------|
| GET | `/api/weather?lat=&lng=` | none | Open-Meteo API (live) | Current conditions + hourly forecast |
| GET | `/api/weather/current` | none | `LAST_WEATHER` cache | Cached current weather (auto-refreshes if >15min stale) |
| GET | `/api/geocode?q=` | none | Nominatim API | Address → coordinates |
| GET | `/api/reverse-geocode?lat=&lng=` | none | Nominatim API | Coordinates → address |

### SwitchBot Integration

| Method | Path | Auth | Source | Returns |
|--------|------|------|--------|---------|
| GET | `/switchbot/devices` | none | SwitchBot API v1.1 (HMAC) | Device list |
| GET | `/api/switchbot/devices/:id/status` | none | SwitchBot API v1.1 | Device status |
| POST | `/api/switchbot/devices/:id/commands` | requireEdgeForControl | SwitchBot API v1.1 | Command result |
| POST | `/switchbot/discover` | none | SwitchBot API v1.1 | Discover devices |

### Device & Light Management

| Method | Path | Auth | Source | Returns |
|--------|------|------|--------|---------|
| GET | `/devices` | demo | In-memory/DB | Device list |
| CRUD | `/devices/:id` | various | In-memory/DB | Device CRUD |
| GET | `/lights` | none | In-memory/DB | Light list |
| CRUD | `/lights/:id` | none | In-memory/DB | Light CRUD |
| POST | `/api/devices/scan` | none | Network scan | Discovered devices |
| POST | `/api/device/:id/power` | requireEdge | Local device | Power control |

### ML & AI

| Method | Path | Auth | Source | Returns |
|--------|------|------|--------|---------|
| GET | `/api/ml/forecast` | none | Python `predictive_forecast.py` | Temp/humidity 1-4h prediction |
| GET | `/api/ml/insights/forecast/:zone` | none | In-memory cache | Cached ML forecast |
| GET | `/api/ml/diagnostics` | none | Python/in-memory | ML system diagnostics |
| POST | `/api/ml/retrain` | none | Python scripts | Retrain ML models |
| GET/POST | `/api/ai/*` | none | In-memory/NeDB | AI training, correlations, decisions |
| POST | `/api/recipe-modifiers/*` | none | In-memory | Recipe modifier computations |

### Automation

| Method | Path | Auth | Source | Returns |
|--------|------|------|--------|---------|
| POST | `/automation/run` | requireEdge + pin | In-memory + env.json | Automation tick result |
| CRUD | `/api/automation/rules` | none/requireEdge | In-memory | Rule CRUD |
| GET | `/api/automation/history` | none | In-memory | Action history |
| CRUD | `/api/automation/fan-rotation/*` | none | In-memory | Fan rotation control |
| CRUD | `/api/automation/vpd/*` | none | In-memory | VPD zone control |

### Harvest & Tray Management

| Method | Path | Source | Returns |
|--------|------|--------|---------|
| GET/POST | `/api/harvest` | NeDB (`harvests.db`) | Harvest records |
| CRUD | `/api/tray-formats`, `/api/trays`, `/api/tray-runs/*` | File + NeDB | Tray lifecycle |
| GET | `/api/harvest/predict/:groupId` | In-memory ML | Harvest predictions |

### Data Files

| Method | Path | Auth | Source | Returns |
|--------|------|------|--------|---------|
| GET | `/data/farm.json` | none | File or demo | Farm metadata |
| GET | `/data/rooms.json` | none | File or demo | Room list |
| GET | `/data/iot-devices.json` | none | File or demo | IoT devices with telemetry |
| GET | `/data/room-map.json` | none | File or demo | Room spatial layout |
| GET | `/data/groups.json` | none | File or demo | Crop groups |
| POST | `/data/:name` | none | → File write | Save any data file |

### Health & Infrastructure

| Method | Path | Returns |
|--------|------|---------|
| GET | `/healthz`, `/health`, `/api/health` | Health status + DB connectivity |
| GET | `/api/version` | Package version info |
| GET | `/metrics` | Prometheus metrics |
| GET | `/api/diagnostics` | System diagnostics |

---

## 10. API Endpoints — GreenReach Central

### Core Data (farmDataMiddleware)

| Method | Path | Auth | Source | Returns |
|--------|------|------|--------|---------|
| GET | `/data/*.json` | farm context | **PostgreSQL farm_data** | Farm-scoped data by data_type |
| POST/PUT | `/data/*.json` | farm context | → PostgreSQL farm_data | Save farm-scoped data |

### Environment

| Method | Path | Auth | Source | Returns |
|--------|------|------|--------|---------|
| GET | `/env`, `/api/env` | farm context | PostgreSQL (telemetry) | Stored telemetry |
| USE | `/api/env` (sub-paths) | via envProxyRoutes | **Proxy → Light Engine** `/env` | Live env from edge |

### Weather ⚠ STUB

| Method | Path | Auth | Source | Returns | Status |
|--------|------|------|--------|---------|--------|
| GET | `/api/weather?lat=&lng=` | none | **HARDCODED** | `{temperature_c: 22, humidity: 55, description: 'Clear'}` | **⚠ BROKEN — returns static fake data** |

### SwitchBot (Hybrid — Direct + Proxy)

| Method | Path | Source |
|--------|------|--------|
| POST | `/switchbot/discover` | SwitchBot API direct (HMAC) + forwards to LE |
| GET | `/switchbot/devices` | Proxy → Light Engine |
| GET | `/api/switchbot/devices/:id/status` | Tries LE first (5s timeout), falls back to SwitchBot API |
| POST | `/api/switchbot/devices/:id/commands` | Proxy → Light Engine |

### Mounted Router Files (35+ route files)

| Mount | Router File | Purpose |
|-------|-------------|---------|
| `/api/auth` | auth.js | Farm authentication |
| `/api/farms`, `/api/farm` | farms.js | Farm CRUD + profile |
| `/api/setup-wizard` | setup-wizard.js | First-time setup |
| `/api/monitoring` | monitoring.js | Monitoring |
| `/api/inventory` | inventory-mgmt.js + inventory.js | Inventory management |
| `/api/orders` | orders.js | Customer orders |
| `/api/alerts` | alerts.js | Alert management |
| `/api/sync` | sync.js | Farm data sync (API key auth) |
| `/api/farm-settings` | farm-settings.js | Settings sync LE ↔ Central |
| `/api/recipes` | recipes.js | Recipe library |
| `/api/wholesale` | wholesale.js + fulfillment + exports | Wholesale marketplace |
| `/api/admin` | admin.js + admin-recipes.js + delivery | Admin dashboard |
| `/api/reports` | reports.js | Financial reports |
| `/api/ai-insights` | ai-insights.js | GPT-4 AI insights |
| `/api/ml/insights` | ml-forecast.js | ML temperature forecast |
| `/api/billing` | billing.js | Billing/usage |
| `/api/accounting` | accounting.js | Double-entry accounting |
| `/api/procurement` | procurement-admin.js | Procurement catalog |
| `/api/planting` | planting.js | Planting scheduler |
| `/api/planning` | planning.js | Production planning |
| `/api/market-intelligence` | market-intelligence.js | Market data |
| `/api/sustainability` | sustainability.js | ESG dashboard |
| `/api/users` | farm-users.js | Farm user CRUD |
| `/api/grant-wizard` | grant-wizard.js | Grant wizard |
| `/discovery/devices` | discovery-proxy.js | Device discovery proxy |
| `/api/remote` | remote-support.js | Remote diagnostics |

---

## 11. Proxy & Forwarding Routes

### Central → Light Engine (Edge Proxy)

Central uses an `edgeProxy()` helper (resolves URL from `FARM_EDGE_URL` env → `farm.json` url → fallback `http://127.0.0.1:8091`, 15s timeout):

| Central Path | Proxied To (Light Engine) |
|-------------|--------------------------|
| `/discovery/capabilities` | `/discovery/capabilities` |
| `/discovery/scan` | `/discovery/scan` (hybrid: tries LE first, then SwitchBot cloud) |
| `/api/bus-mappings` | `/api/bus-mappings` |
| `/api/bus-mapping` | `/api/bus-mapping` |
| `/api/bus/:busId/scan` | `/api/bus/${busId}/scan` |
| `/api/kasa/discover` | `/api/kasa/discover` |
| `/api/kasa/configure` | `/api/kasa/configure` |
| `/api/kasa/device/:host/power` | `/api/kasa/device/${host}/power` |
| `/env` sub-paths (via envProxyRoutes) | `/env` |

### Light Engine → Central

| LE Path | Proxied To (Central) |
|---------|---------------------|
| `/api/accounting` | `greenreachgreens.com/api/accounting` |

### Light Engine → Hardware Controller

| LE Path | Proxied To |
|---------|-----------|
| `/api/*` (filtered — excludes env, weather, switchbot, kasa, etc.) | Local hardware controller process |
| `/controller/*` | Direct controller access |

---

## 12. UI Pages & Display Fields

### 12.1 Page Inventory

**16 view pages** in `public/views/` (17 in greenreach-central which also has `network-dashboard.html`):

| # | Page | Primary Purpose |
|---|------|-----------------|
| 1 | **farm-summary.html** | Main dashboard — zones, sensors, weather, AI, schedules (~8000 lines) |
| 2 | **room-heatmap.html** | Canvas-based sensor heat map with interpolated temp/humidity overlay |
| 3 | **room-mapper.html** | Interactive room layout editor — drag/drop sensors & equipment |
| 4 | **iot-manager.html** | IoT device management — SwitchBot, Kasa, Shelly, MQTT |
| 5 | **tray-inventory.html** | Tray lifecycle — register, grow, harvest, QA, orders |
| 6 | **tray-setup.html** | Tray format definitions & registration |
| 7 | **planting-scheduler.html** | Planting zone assignments & AI recommendations |
| 8 | **nutrient-management.html** | Nutrient pump control & sensor calibration |
| 9 | **farm-inventory.html** | Seed/supply inventory management |
| 10 | **crop-weight-analytics.html** | Crop weight trends & AI training data export |
| 11 | **fan-rotation-monitor.html** | Fan rotation analytics |
| 12 | **kpi-dashboard.html** | KPI metrics dashboard |
| 13 | **procurement-portal.html** | Procurement catalog & ordering |
| 14 | **farm-maintenance-checklist.html** | Maintenance task tracking |
| 15 | **field-mapping.html** | Field mapping configurations |
| 16 | **tray-inventory-old-backup.html** | Legacy backup |
| 17 | **network-dashboard.html** | Network-wide benchmarks & supply/demand (Central only) |

### 12.2 farm-summary.html — Field Map

The main dashboard. Fetches data from **15+ endpoints**.

| Section | Data Source | Fields Displayed |
|---------|------------|------------------|
| **Farm Header** | `/data/farm.json` | Farm name |
| **Weather Card** | `/api/weather?lat=&lng=` | Temperature °C/°F, description, humidity % |
| **Zone Cards** | `/env?hours=1` | Per-zone: Temperature °C, Humidity %, VPD kPa |
| **Outdoor Sensor Row** | `/env` → zones with "outdoor"/"outside" name | Outdoor temp °C, humidity % |
| **Sensor Cards** | `/data/iot-devices.json` | Per-device: name, temperature, humidity, battery, signal |
| **AI Insight Cards** | `/api/health/insights` | Health score, recommendations |
| **ML Anomaly Cards** | `/api/schedule-executor/ml-anomalies` | Anomaly type, outdoor_temp, outdoor_rh context |
| **Energy Forecast** | `/api/ml/energy-forecast` | Total daily kWh, hourly predictions |
| **ML Forecast** | `/api/ml/insights/forecast/:zone` | Temperature prediction 1-4h ahead |
| **Automation History** | `/api/automation/history` | Recent actions (device, action, time) |
| **Harvest Readiness** | `/api/harvest/readiness` | Readiness score per crop |
| **Loss Prediction** | `/api/losses/predict` | Predicted loss events |
| **Recipe Modifiers** | `/api/recipe-modifiers` | AI-suggested recipe adjustments |
| **Light Schedules** | `/data/schedules.json`, `/plans` | Active schedule, plan entries |
| **Groups** | `/data/groups.json` | Crop groups with zone assignments |

### 12.3 room-heatmap.html — Field Map

| Section | Data Source | Fields Displayed |
|---------|------------|------------------|
| **Room Selector** | `/data/rooms.json` | Room names, room IDs |
| **Heatmap Canvas** | `/data/iot-devices.json` (primary), `/env?hours=24` (fallback) | Temperature °C or Humidity % per sensor, color-interpolated |
| **Sensor Markers** | `/data/iot-devices.json` | Device name, live reading + unit, zone |
| **Equipment Markers** | `/data/room-map.json`, `/data/equipment-metadata.json` | Equipment name, type, status |
| **Sensor List Panel** | `/data/iot-devices.json` → `telemetry` | Name, temp °C, humidity %, VPD kPa |
| **Time Slider** | `/env?hours=24` → history arrays | Historical temp/humidity over 24h |

### 12.4 room-mapper.html — Field Map

| Section | Data Source | Fields Displayed |
|---------|------------|------------------|
| **Room Selector** | `/data/rooms.json` | Room names |
| **Canvas Layout** | `/data/room-map.json` | Walls, zones, sensor positions, equipment positions |
| **Device Palette** | `/data/iot-devices.json` | Available sensors/devices for placement |
| **Equipment Palette** | `/data/equipment-metadata.json` | Available equipment for placement |
| **Save** | `POST /data/room-map.json` | Persists layout to PostgreSQL via farmDataMiddleware |

---

## 13. Outdoor Weather System — Status & Issues

### Current State (as of 2026-03-06)

```
                    ┌──────────────────────────────────────────────┐
                    │  LIGHT ENGINE (Real Weather)                 │
                    │                                              │
                    │  Open-Meteo API ──10min──► LAST_WEATHER      │
                    │       │                         │             │
                    │       │                         ▼             │
                    │       │                   /env response       │
                    │       │                   outdoor_conditions  │
                    │       │                         │             │
                    │       ▼                         ▼             │
                    │  GET /api/weather      Automation engine      │
                    │  GET /api/weather/current  (virtual sensors)  │
                    │       (REAL DATA ✓)    outside_temperature_c  │
                    │                        outside_humidity       │
                    │                        outside_wind_kmh       │
                    └──────────────────────────────────────────────┘

                    ┌──────────────────────────────────────────────┐
                    │  GREENREACH CENTRAL (Broken Weather)         │
                    │                                              │
                    │  GET /api/weather ──► HARDCODED STUB ⚠       │
                    │       Returns: { temperature_c: 22,          │
                    │                   humidity: 55,               │
                    │                   description: 'Clear' }     │
                    │       Regardless of lat/lng input!            │
                    │                                              │
                    │  No proxy to Light Engine weather.            │
                    │  No Open-Meteo integration.                   │
                    │  No outdoor_conditions in env response.       │
                    └──────────────────────────────────────────────┘
```

### What the User Sees

| Page | What Should Happen | What Actually Happens |
|------|-------------------|----------------------|
| **farm-summary.html** (via Central) | Weather card shows real outdoor temp, humidity, conditions | Shows **22°C / 72°F / Clear / 55% humidity** always (stub data) |
| **farm-summary.html** (via LE directly) | Weather card shows real data from Open-Meteo | **Works correctly** ✓ |
| **farm-summary.html** — Outdoor sensor in zone card | Shows outdoor zone data if zone named "outdoor"/"outside" exists | No outdoor zone exists → **section hidden** |
| **farm-summary.html** — ML anomaly cards | Shows `outdoor_temp`, `outdoor_rh` context | Depends on LE ML; stale if LE weather not polling |

### Why Weather Is Broken on Central

1. **`/api/weather` on Central is a hardcoded stub** (greenreach-central/server.js line 2271) — it always returns 22°C, 55% humidity, "Clear" regardless of coordinates.

2. **No proxy exists to forward `/api/weather` to the Light Engine** — unlike SwitchBot and Kasa which have `edgeProxy()` forwarding, weather was never wired up.

3. **`/env` response from Central has `outdoor_conditions: null`** — the telemetry stored in the farm_data table doesn't include the `LAST_WEATHER` data that the Light Engine embeds in its `/env` response.

4. **Weather polling only runs on the Light Engine** — `setupWeatherPolling()` is in server-foxtrot.js, not in greenreach-central. Since users access the system via `greenreachgreens.com` (Central), they never hit the LE's real weather endpoint.

### Impact on ML/AI

The ML/AI systems need outdoor weather for:

| ML Feature | Weather Dependency | Current Status |
|------------|-------------------|----------------|
| **Predictive Forecast** (`predictive_forecast.py`) | `outside_temperature_c`, `outside_humidity` as input features | ⚠ Only works when LE has weather polling active |
| **Automation Engine** (virtual sensors) | `outside_temperature_c`, `outside_humidity`, `outside_wind_kmh` fed as virtual sensor readings | ⚠ Only on LE; Central has no outdoor data |
| **AI Learning Correlations** | `outdoorContext.temp`, `outdoorContext.rh` | ⚠ Only on LE from `LAST_WEATHER` |
| **Anomaly Detection** | `outdoor_temp`, `outdoor_rh` in anomaly context | ⚠ Stale or unavailable via Central |
| **Energy Forecast** | Outdoor temp affects HVAC energy prediction | ⚠ Missing data degrades accuracy |

### Fix Required (Not Implemented in This Audit)

Central's `/api/weather` endpoint needs to either:
- **Option A:** Proxy to the Light Engine's `/api/weather` (like SwitchBot/Kasa)
- **Option B:** Call Open-Meteo directly (like the Light Engine does)
- **Option C:** Both — proxy to LE with fallback to direct Open-Meteo call

Additionally, the `/env` response from Central should include `outdoor_conditions` from the stored telemetry or a fresh weather API call.

---

## 14. Sensor Data Flow — End-to-End Trace

### 14.1 How Sensor Readings Get from Hardware to Screen

```
SwitchBot Sensor (BLE/WiFi)
    │
    ▼
SwitchBot Cloud API (v1.1)
    │  Polled by Light Engine
    │  (interval configured in SwitchBot polling setup)
    ▼
Light Engine: /ingest/env or SwitchBot status handler
    │
    ├──► env.json (zone-aggregated: tempC, rh, vpd per zone)
    │         │
    │         └──► POST /api/sync/farm-data → Central farm_data (data_type='telemetry')
    │
    ├──► iot-devices.json (per-device: telemetry.temperature, telemetry.humidity)
    │         │
    │         └──► POST /api/sync/farm-data → Central farm_data (data_type='devices')
    │
    └──► In-memory preEnvStore (fast cached snapshot)
```

### 14.2 How farm-summary.html Reads Sensor Data (WORKING ✓)

```
Browser: fetch('/data/iot-devices.json')
    │
    ▼
Central: farmDataMiddleware → SELECT data FROM farm_data WHERE data_type='devices'
    │
    ▼
Returns: [{id, name, type, zone, telemetry: {temperature: 15.7, humidity: 28}}, ...]
    │
    ▼
farm-summary.html: device.telemetry.temperature → "15.7°C"
                   device.telemetry.humidity → "28%"
```

### 14.3 How room-heatmap.html Reads Sensor Data (FIXED 2026-03-06)

**Before fix (broken):**
```
Browser: fetch('/env?hours=24')
    │
    ▼
Central: farm_data (data_type='telemetry') → stale zone data (18.5°C from March 5)
    │
    ▼
getSensorReadingsForMetric() → zone.sensors.tempC.current = 18.5°C  ← STALE
    │
    ▼
Heatmap shows: 18.5°C (wrong — real is 15.5-15.7°C)
```

**After fix (working):**
```
Browser: fetch('/data/iot-devices.json')  ← NOW PRIMARY SOURCE
    │
    ▼
Central: farm_data (data_type='devices') → real per-device telemetry
    │
    ▼
getSensorReadingsForMetric():
  1. STATE.iotDevicesAll → device.telemetry.temperature = 15.7°C  ← REAL ✓
  2. sensor.telemetry (snapshot from load time) ← BACKUP
  3. /env zone data ← LAST RESORT FALLBACK
    │
    ▼
Heatmap shows: 15.7°C (correct)
```

### 14.4 Data Priority Matrix (After Fixes)

| Consumer | Priority 1 (Primary) | Priority 2 | Priority 3 (Fallback) |
|----------|---------------------|-----------|----------------------|
| **farm-summary sensor cards** | `/data/iot-devices.json` → `telemetry.temperature` | — | `/env` zones |
| **room-heatmap** | `/data/iot-devices.json` → `iotDevicesAll` | sensor.telemetry snapshot | `/env` zones |
| **heatmap getLiveSensorData()** | `iotDevicesAll` by deviceId | sensor.telemetry | `/env` zone current |
| **heatmap auto-refresh (3 min)** | `/data/iot-devices.json` (new!) | `/env?hours=24` | — |

---

## 15. ML/AI Data Dependencies

### What ML/AI Models Need

| Model/Feature | Input Data | Source Endpoint | Storage | Status |
|--------------|------------|-----------------|---------|--------|
| **Predictive Forecast** | Zone temp, humidity, VPD history + outdoor weather | `/env?hours=24`, `LAST_WEATHER` | env.json, in-memory | ⚠ Weather only on LE |
| **Anomaly Detection** | Zone readings + outdoor context | `/env`, `LAST_WEATHER` | env.json, in-memory | ⚠ Weather only on LE |
| **Learning Correlations** | Env readings + equipment state + outdoor context | `/env`, `/lights`, `LAST_WEATHER` | env.json, in-memory | ⚠ Weather only on LE |
| **Harvest Predictions** | Crop groups, env history, growth rates | `/env`, `/groups`, trays DB | JSON files, NeDB | ✓ Works |
| **Loss Prediction** | Historical loss events, env data | `/api/losses/predict`, trays DB | NeDB | ✓ Works |
| **Recipe Modifiers** | Zone readings, crop benchmarks, env targets | `/env`, `/api/crop-benchmarks` | env.json, PostgreSQL | ✓ Works |
| **Energy Forecast** | Env readings, light schedules, **outdoor temp** | `/env`, schedules, `LAST_WEATHER` | JSON files | ⚠ Weather only on LE |
| **Dynamic Pricing** | Crop weights, supply/demand, market data | PostgreSQL (wholesale) | PostgreSQL | ✓ Works |
| **AI Crop Recommendations** | Env capability + crop library | `/api/crops`, `/env` | In-memory, env.json | ✓ Works |

### Critical Gap: Outdoor Weather for ML

All ML models that use outdoor weather data (`outside_temperature_c`, `outside_humidity`, `outside_wind_kmh`) only function correctly when:

1. The Light Engine has valid farm coordinates in `farm.json`
2. Weather polling is active (`setupWeatherPolling()` running)
3. `LAST_WEATHER` is populated (not null)

**When Central is the primary access point**, outdoor weather is unavailable to ML features because:
- Central's `/api/weather` is a stub
- Central's `/env` response doesn't include `outdoor_conditions`
- ML forecast proxy stubs on Central return empty data

---

## 16. Known Issues & Gaps

### Critical Issues

| # | Issue | Impact | Component |
|---|-------|--------|-----------|
| **W-1** | Central `/api/weather` is hardcoded stub (22°C/55%/Clear) | Farm dashboard shows fake weather when accessed via greenreachgreens.com | greenreach-central/server.js:2271 |
| **W-2** | Central `/env` response has `outdoor_conditions: null` | No outdoor data available for ML/AI via Central | farm_data telemetry sync |
| **W-3** | No weather proxy from Central → Light Engine | Users accessing via Central never get real weather | Missing proxy route |
| **W-4** | Weather polling only on Light Engine | Central has no independent weather data source | Architecture gap |

### Data Staleness Issues

| # | Issue | Impact | Component |
|---|-------|--------|-----------|
| **S-1** | `/env` zone data (telemetry) can go stale if SwitchBot polling stops | Heatmap/zones show old readings (mitigated: heatmap now uses IoT registry primary) | env.json sync |
| **S-2** | room-map.json devices have `name=None`, `type=None`, `telemetry=None` | Heatmap sensor filter rejects all room-map devices; relies on IoT registry auto-positioning | room_map data quality |
| **S-3** | Sync from LE → Central may lag | Central's farm_data may be behind LE's local files | Sync interval |

### Stub Endpoints on Central

| Endpoint | What It Returns | Should Return |
|----------|----------------|---------------|
| `GET /api/weather` | `{temperature_c: 22, humidity: 55, description: 'Clear'}` | Real weather from Open-Meteo or LE proxy |
| `GET /api/reverse-geocode` | Stub response | Nominatim geocoding |
| `GET /forwarder/network/wifi/scan` | Stub response | Wi-Fi scan results |
| `GET /api/automation/rules` | `[]` | Real automation rules from LE |
| `GET /api/automation/history` | `[]` | Real action history from LE |
| `GET /api/schedule-executor/status` | Stub | Real executor status from LE |
| `GET /api/schedule-executor/ml-anomalies` | Stub/empty | Real ML anomalies from LE |
| `GET /api/ml/anomalies/statistics` | Stub | Real ML stats from LE |
| `GET /api/ml/energy-forecast` | Stub | Real energy forecast from LE |
| `GET /api/ml/insights/forecast/:zone` | Stub | Real ML forecast from LE |
| `GET /api/audit/recent` | `[]` | Real audit log |

---

## 17. Recent Fixes Log (March 2026)

### 2026-03-05: Architecture Fixes

| Fix | Description | Files Modified |
|-----|-------------|----------------|
| **Credential Forwarding** | Central now forwards SwitchBot token/secret to Light Engine when user saves credentials via `/switchbot/discover` | greenreach-central/server.js |
| **Device Registration Forwarding** | Central forwards new device registrations to Light Engine so devices appear in LE's local registry | greenreach-central/server.js |
| **Route Conflict Removal** | Removed duplicate `/api/switchbot/status` route that conflicted with SwitchBot proxy | greenreach-central/server.js |
| **Edge → Light Engine Terminology** | Updated all "edge" references to "Light Engine" in UI and server code | Multiple files |

### 2026-03-06: Farm Summary Sensor Regression Fix

| Fix | Description | Files Modified |
|-----|-------------|----------------|
| **Zone stale status uses `/env` freshness** | Farm Summary now treats `/env` zone freshness as authoritative before falling back to device registry timestamps, preventing false stale badges when device `lastSeen` lags behind rebuilt zone telemetry | farm-summary.html |
| **All-zones trend no longer collapses to 1 point** | Aggregate trend now uses the richest available history depth instead of the minimum shared depth, so a newly-restored zone with 1 sample no longer blanks the full chart | farm-summary.html |
| **Communication document updated** | Added this regression and fix to the system communication log per process requirement | SYSTEM_DATA_AUDIT_2026-03-06.md |

### 2026-03-06: Heatmap Sensor Data Fix

| Fix | Description | Files Modified |
|-----|-------------|----------------|
| **getSensorReadingsForMetric() priority** | Changed data priority: IoT registry telemetry (real) → sensor snapshot → /env zones (stale fallback) | room-heatmap.html |
| **getLiveSensorData() priority** | Same priority fix: IoT device registry first, then sensor telemetry, then /env zone | room-heatmap.html |
| **Auto-refresh includes IoT devices** | 3-minute refresh now fetches `/data/iot-devices.json` alongside `/env?hours=24` | room-heatmap.html |
| **STATE.iotDevicesAll** | Added dedicated array in global state to hold full IoT registry for telemetry lookups | room-heatmap.html |

### 2026-03-06: Room Mapper Save Button

| Fix | Description | Files Modified |
|-----|-------------|----------------|
| **Save Map button** | Added Save Map button next to + New Room button in room mapper | room-mapper.html |
| **Sync to Central** | Synced room-mapper.html to greenreach-central public folder | greenreach-central room-mapper.html |

### 2026-03-06: Sensor Data Flow — Two-Pass Aggregation Fix

**Root cause:** `syncSensorData()` in server-foxtrot.js called `updateValidDataHistory()` on zone-level sensor objects **inside** the per-device loop. When 2+ sensors shared a zone (Zone 2 has Sen 2 + Sen 3), both calls happened within the same JavaScript tick (~0ms apart), but the rate-limiter required 5 minutes between history pushes. The second device's call saw `lastPushMs` was just updated, so it **overwrote `history[0]`** instead of accumulating a new entry. Zone 2 was permanently stuck at 1 zone-level history entry. Zone-level `current` values also showed the last device's raw reading, not an average.

| Fix | Description | Files Modified |
|-----|-------------|----------------|
| **Two-pass aggregation** | Split `iotDevices.forEach` into Pass 1 (per-source updates only) and Pass 2 (zone-level aggregation after all devices processed). `updateValidDataHistory` now called once per zone per cycle, not per device. | server-foxtrot.js |
| **Averaged zone values** | Zone-level `current` is now the mean of all sources' `current` values, not the last device's raw reading. VPD computed from averaged temp + humidity. | server-foxtrot.js |
| **Zone history rebuild** | Added `rebuildZoneHistoryFromSources()` — when zone-level history length < 50% of max source history length, reconstructs zone-level arrays by time-aligning source histories and averaging values. Bootstraps Zone 2 from 1 → 14+ entries immediately. | server-foxtrot.js |
| **Fahrenheit guard fix** | Fahrenheit detection now also scrubs per-source histories that contain values > 40°C, preventing the bug where zone history was wiped but sources retained stale Fahrenheit data that re-polluted on next rebuild. | server-foxtrot.js |
| **Frontend fallback** | Added `ensureZoneHistoryFromSources()` defence-in-depth in farm-summary.html — before rendering trending charts, checks if zone-level history is too short vs per-source data and rebuilds in-memory. Called from both `buildAggregatedHistoryFromAllZones` and `buildHistoryFromZone`. | farm-summary.html, greenreach-central farm-summary.html |

---

## Appendix A: farm_data data_type Quick Reference

```sql
-- Query to see all farm_data entries for a farm:
SELECT data_type, updated_at, pg_column_size(data) as size_bytes
FROM farm_data
WHERE farm_id = 'FARM-MLTP9LVH-B0B85039'
ORDER BY data_type;

-- Expected data_types:
-- devices        → iot-devices.json (sensor telemetry)
-- farm_profile   → farm.json (name, coordinates)
-- groups         → groups.json (crop zones)
-- light_setups   → light-setups.json
-- plans          → plans.json (grow plans)
-- rooms          → rooms.json (room definitions)
-- room_map       → room-map.json (spatial layout)
-- schedules      → schedules.json (light schedules)
-- telemetry      → env.json (zone environmental data)
```

## Appendix B: Live API Response Samples (2026-03-06)

### /data/iot-devices.json (Real Telemetry — PRIMARY SOURCE)
```json
[
  {"name": "Sen 1", "telemetry": {"temperature": 15.7, "humidity": 28}, "zone": 1},
  {"name": "Sen 2", "telemetry": {"temperature": 15.7, "humidity": 28}, "zone": 2},
  {"name": "Sen 3", "telemetry": {"temperature": 15.5, "humidity": 30}, "zone": 2},
  {"name": "Sen 4", "telemetry": {"temperature": 15.6, "humidity": 29}, "zone": 1},
  {"name": "Hub Mini 7E", "telemetry": {"temperature": null, "humidity": null}, "zone": null}
]
```

### /env?hours=1 (Zone Aggregate — May Be Stale)
```json
{
  "zones": [{"id": "zone-1", "sensors": {"tempC": {"current": 18.5}, "rh": {"current": 45}}}],
  "outdoor_conditions": null
}
```

### /api/weather (Central — STUB ⚠)
```json
{"ok": true, "current": {"temperature_c": 22, "temperature_f": 72, "humidity": 55, "description": "Clear"}}
```

### /data/farm.json (Farm Profile)
```json
{"name": "The Notable Sprout", "location": "Kingston, ON", "coordinates": {"lat": 44.2588, "lng": -76.3729}}
```
