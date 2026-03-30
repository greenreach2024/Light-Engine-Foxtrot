# Data Collection Catalog — Light Engine Foxtrot

> **Generated:** 2026-02-08  
> **Scope:** Exhaustive inventory of every data collection, storage, and ingestion point in the Foxtrot edge server (`server-foxtrot.js` + route modules)

---

## Table of Contents

1. [Storage Mechanisms Summary](#1-storage-mechanisms-summary)
2. [Sensor & Environmental Data](#2-sensor--environmental-data)
3. [Growth Lifecycle Events](#3-growth-lifecycle-events)
4. [Weight & Harvest Data](#4-weight--harvest-data)
5. [Light Recipe & Schedule Data](#5-light-recipe--schedule-data)
6. [Device Registry & Control](#6-device-registry--control)
7. [Wholesale / Demand Data](#7-wholesale--demand-data)
8. [Loss & Waste Data](#8-loss--waste-data)
9. [Quality Control & Photo/Image Data](#9-quality-control--photoimage-data)
10. [Traceability & Compliance](#10-traceability--compliance)
11. [Inventory Management](#11-inventory-management)
12. [ML / Forecast Data](#12-ml--forecast-data)
13. [User, Auth & Audit Data](#13-user-auth--audit-data)
14. [Farm Configuration](#14-farm-configuration)
15. [Weather Data](#15-weather-data)
16. [Nutrient System](#16-nutrient-system)
17. [Procurement](#17-procurement)
18. [Timed / Background Processes](#18-timed--background-processes)
19. [Data Volatility Risk Matrix](#19-data-volatility-risk-matrix)

---

## 1. Storage Mechanisms Summary

| Mechanism | Tech | Persistence | Location |
|---|---|---|---|
| **NeDB** | `nedb-promises` (file-backed, autoload, timestampData) | Disk | `./data/*.db` |
| **JSON files** | `fs.writeFileSync` / `writeJsonQueued` | Disk | `./public/data/*.json`, `./data/*.json` |
| **In-memory Map/Array** | JS `Map()` / `[]` | **Volatile — lost on restart** | server process heap |
| **PostgreSQL** | `pg` (when `DATABASE_URL` set, cloud mode only) | Disk (remote) | External DB |
| **SQLite** | `better-sqlite3` (referenced, mostly unused on edge) | Disk | `./data/lightengine.db` |

### NeDB Databases on Disk (`./data/`)

| File | Purpose | Auto-cleanup |
|---|---|---|
| `devices.nedb` | Device registry | — |
| `wizard-states.db` | Setup wizard persistence | 7-day TTL (daily cleanup) |
| `tray-runs.db` | Tray lifecycle runs | — |
| `tray-loss-events.db` | Loss/waste events | — |
| `trays.db` | Physical tray inventory | — |
| `tray-formats.db` | Tray format definitions | — |
| `tray-placements.db` | Tray location tracking | — |
| `nutrient-targets.db` | Nutrient dosing targets | — |
| `pump-calibrations.db` | Pump calibration data | — |
| `sensor-calibrations.db` | Sensor calibration offsets | — |

### Other Persisted Files in `./data/`

| File | Purpose |
|---|---|
| `crop-weight-records.json` | Backup of weigh-in records |
| `trace-records.json` | SFCR/CanadaGAP traceability records |
| `ai-recommendations.json` | AI-generated recommendations |
| `orders/` | Order files directory |
| `automation/` | Automation rule files |

---

## 2. Sensor & Environmental Data

### 2a. Environmental Readings (Primary)

| Property | Detail |
|---|---|
| **Endpoint** | `POST /env/readings` |
| **Fields** | `room` (string), `temp` (°C float), `rh` (% float), `vpd` (kPa float), `ppfd` (µmol/m²/s float), `kwh` (float), `masterPct` (0–100), `bluePct` (0–100), `source` (string), `timestamp` (ISO) |
| **Storage** | `public/data/env.json` → `readings[]` array |
| **Cap** | `MAX_ENV_READING_HISTORY = 10,000` entries (FIFO) |
| **Frequency** | On push from controller / ESP32 sensors |
| **Consumers** | Dashboard env cards, schedule executor, ML anomaly detection, automation engine, weather context overlay |

### 2b. Full Environment State Upsert

| Property | Detail |
|---|---|
| **Endpoint** | `POST /env` (PIN-protected) |
| **Fields** | Full zone array: `{ zones: [{ id, name, sensors: { tempC, rh, vpd, ppfd, co2 }, setpoints: { … } }] }` |
| **Storage** | `public/data/env.json` (atomic overwrite) |
| **Frequency** | Manual or controller push |

### 2c. Room Env Config Update

| Property | Detail |
|---|---|
| **Endpoint** | `PATCH /env/rooms/:roomId` |
| **Fields** | Partial room config merge (setpoints, automation params) |
| **Storage** | `public/data/env.json` |

### 2d. Sensor Sync (Live Hardware)

| Property | Detail |
|---|---|
| **Function** | `syncSensorData()` |
| **Frequency** | `setInterval` at `SYNC_INTERVAL` (configurable, default varies) |
| **Source** | Hardware controller API |
| **Fields** | Temperature, humidity, CO2, light levels from physical sensors |
| **Storage** | Merged into in-memory env state → periodically flushed to `env.json` |

### 2e. SwitchBot / IoT Sensor Data

| Property | Detail |
|---|---|
| **Source** | SwitchBot API, Shelly devices, Kasa smart plugs |
| **Cache** | `public/data/switchbot-devices.json` |
| **Fields** | Device ID, status, temperature, humidity, power state |
| **Frequency** | On-demand or periodic poll |

---

## 3. Growth Lifecycle Events

### 3a. Tray Seeding

| Property | Detail |
|---|---|
| **Endpoint** | `POST /api/trays/:trayId/seed` |
| **Fields** | `tray_id`, `recipe_id`, `crop`, `variety`, `planted_site_count`, `seed_source`, `target_weight_oz`, `target_weight_source`, `group_id` |
| **Derived** | `tray_run_id` (auto-generated UUID), `seeded_at` (ISO), `status: "GROWING"` |
| **Storage** | NeDB `tray-runs.db` (insert), also creates traceability record |
| **Consumers** | Tray tracker UI, harvest workflow, weight reconciliation, traceability |

### 3b. Tray Move/Placement

| Property | Detail |
|---|---|
| **Endpoint** | `POST /api/tray-runs/:id/move` |
| **Fields** | `location_qr` (destination QR code), optional `group_id` assignment |
| **Storage** | NeDB `tray-placements.db` (insert new placement, update `removed_at` on previous) |
| **Consumers** | Room map, tray location tracker, group assignment |

### 3c. Tray Harvest

| Property | Detail |
|---|---|
| **Endpoint** | `POST /api/tray-runs/:id/harvest` |
| **Fields** | Updates `status → "HARVESTED"`, sets `harvested_at` |
| **Storage** | NeDB `tray-runs.db` (update) |
| **Side Effects** | Triggers traceability lot code generation |

### 3d. Planting Assignments

| Property | Detail |
|---|---|
| **Endpoint** | `POST /api/planting/assignments` |
| **Fields** | Assignment data (tray-to-group mapping, schedule) |
| **Storage** | `public/data/planting-assignments.json` (writeFileSync) |
| **Consumers** | Planting scheduler UI, seed-to-harvest workflow |

---

## 4. Weight & Harvest Data

### 4a. Harvest Log

| Property | Detail |
|---|---|
| **Endpoint** | `POST /api/harvest` |
| **Fields** | `groupId`, `planId`, `harvestDate`, `variance` (days from planned), additional crop/yield metadata |
| **Storage** | `public/data/harvest-log.json` → `{ harvests: [], metadata: { lastUpdated, totalHarvests } }` |
| **Frequency** | On each harvest event |
| **Consumers** | Harvest analytics, prediction stubs, group lifecycle |

### 4b. Crop Weight Reconciliation (route: `crop-weight-reconciliation.js`)

| Property | Detail |
|---|---|
| **Endpoints** | `POST /api/crop-weight/record`, `GET /api/crop-weight/records`, `GET /api/crop-weight/benchmarks`, `GET /api/crop-weight/analytics`, `GET /api/crop-weight/ai-training-export`, `POST /api/crop-weight/bulk-import`, `GET /api/crop-weight/should-weigh` |
| **Fields per Record** | `weigh_in_id`, `tray_run_id`, `recipe_id`, `crop_name`, `tray_format_id`, `planted_site_count`, `total_weight_oz`, `weight_per_plant_oz` (calculated), `grow_days`, `zone`, `room`, `environment_data { temp, humidity, co2, light_hours }`, `variance_pct`, `farm_id`, `recorded_at` |
| **Storage** | **In-memory** `weighInRecords[]` + persisted to `data/crop-weight-records.json` |
| **Benchmarks** | In-memory `cropWeightBenchmarks{}` keyed by `recipe_id` with percentile stats |
| **⚠ Risk** | Primary store is in-memory; JSON backup is secondary |

---

## 5. Light Recipe & Schedule Data

### 5a. Lighting Recipes

| Property | Detail |
|---|---|
| **Endpoint** | `POST /data/lighting-recipes` (via save-data generic), individual plan CRUD via `/api/plans` |
| **Files** | `public/data/lighting-recipes.json` |
| **Fields** | `id`, `name`, `crop`, `phases[]` each with `duration_days`, `photoperiod_hours`, `dli_target`, `spectrum { red, blue, white, far_red }`, `ppfd_target` |
| **Storage** | JSON file (writeFileSync / writeJsonQueued) |
| **Consumers** | Schedule executor (60s tick), group assignment, DLI calculations |

### 5b. Schedules

| Property | Detail |
|---|---|
| **Endpoint** | `POST /data/schedules` |
| **Files** | `public/data/schedules.json` |
| **Fields** | `id`, `name`, `groups[]`, `active`, `time_blocks[]` with start/end/spectrum |
| **Storage** | JSON file |
| **Consumers** | Schedule executor, room lighting control |

### 5c. SPD Library

| Property | Detail |
|---|---|
| **Files** | `public/data/spd-library.json`, `public/data/spd-library-default.json` |
| **Fields** | Spectral Power Distribution curves per fixture/spectrum mode |
| **Storage** | JSON files (read-mostly) |

### 5d. Calibration Multipliers

| Property | Detail |
|---|---|
| **Endpoint** | `POST /calibration` |
| **Files** | `public/data/calibration.json` |
| **Fields** | Per-channel or per-fixture calibration multipliers |
| **Storage** | JSON file (writeFileSync) |
| **Consumers** | Schedule executor applies multipliers to light commands |

---

## 6. Device Registry & Control

### 6a. Device Registry

| Property | Detail |
|---|---|
| **Endpoints** | `POST /devices` (create), `PATCH /devices/:id` (update), `DELETE /devices/:id` |
| **Fields** | `id`, `deviceName`, `manufacturer`, `model`, `serial`, `watts`, `spectrumMode`, `transport` (RS-485/WiFi/BLE), `protocol` (DMX512/ModBus/SPI), `category`, `online`, `capabilities[]`, `assignedEquipment` |
| **Storage** | NeDB `devices.nedb` |
| **Seeded from** | `public/data/device-meta.json` on first boot |
| **Consumers** | Device management UI, schedule executor device registry, room setup |

### 6b. Device Cache

| Property | Detail |
|---|---|
| **Endpoint** | `POST /data/devices.cache` |
| **Files** | `public/data/devices.cache.json` |
| **Fields** | Cached controller device state |
| **Storage** | JSON file |

### 6c. Device Power & Spectrum Control

| Property | Detail |
|---|---|
| **Endpoints** | `POST /api/device/:deviceId/power`, `POST /api/device/:deviceId/spectrum` |
| **Action** | Sends commands to hardware controller; no data persisted |
| **Side Effect** | Controller state may update `env.json` readings |

### 6d. IoT Device Config

| Property | Detail |
|---|---|
| **Files** | `public/data/iot-devices.json`, `public/data/switchbot-devices.json` |
| **Fields** | Device IDs, API tokens, hub addresses, interval settings |
| **Storage** | JSON files |

### 6e. Equipment Metadata

| Property | Detail |
|---|---|
| **Files** | `public/data/equipment.catalog.json`, `public/data/equipment-metadata.json`, `public/data/equipment-kb.json` |
| **Endpoints** | `PUT /data/equipment-metadata`, others via generic save |
| **Storage** | JSON files |

### 6f. UI Controller/Equipment Maps

| Property | Detail |
|---|---|
| **Endpoints** | `POST /data/ui-ctrl-map`, `POST /data/ui-equipment` |
| **Files** | `public/data/ui-ctrl-map.json`, `public/data/ui-equipment.json` |
| **Storage** | JSON files (writeJsonQueued) |

---

## 7. Wholesale / Demand Data

### 7a. Inventory (Wholesale Catalog)

| Property | Detail |
|---|---|
| **Endpoint** | `GET /api/wholesale/inventory` |
| **Files** | `public/data/wholesale-products.json` |
| **Fields** | `lots[]` each with `sku_id`, `product_name`, `unit`, `price_per_unit`, `qty_available`, `qty_reserved`, `category`, `harvest_date`, `shelf_life_days` |
| **Storage** | JSON file |
| **Consumers** | Buyer marketplace, checkout flow, reservation system |

### 7b. Inventory Reservations (route: `wholesale-reservations.js`)

| Property | Detail |
|---|---|
| **Endpoints** | `POST /api/wholesale/inventory/reserve`, `GET /api/wholesale/inventory/reservations`, `DELETE /api/wholesale/inventory/reservations/:id` |
| **Fields** | `reservation_id`, `lot_id`, `sku_id`, `qty`, `order_id`, `buyer_id`, `status`, `created_at`, `expires_at` |
| **Storage** | **In-memory `Map()`** + periodic persist to `public/data/wholesale-reservations.json` |
| **TTL** | 24-hour expiry; hourly cleanup (`setInterval` every 60 min) |
| **⚠ Risk** | Primary store is volatile |

### 7c. Orders (route: `wholesale-orders.js`)

| Property | Detail |
|---|---|
| **Endpoints** | `POST /api/wholesale/webhook/order` (inbound from GreenReach), `GET /api/wholesale/orders`, `PATCH /api/wholesale/orders/:orderId/status` |
| **Fields** | `order_id`, `buyer_account { email, name }`, `cart[]`, `delivery_date`, `delivery_address`, `payment_provider`, `status` (15 states), `sub_orders[]`, `sourcing`, `timestamps` |
| **Storage** | `public/data/wholesale-orders-status.json`, `./data/orders/` directory |
| **Status Enum** | `pending_payment → payment_authorized → confirmed → processing → allocated → picking → picked → packing → packed → ready_for_pickup → shipped → in_transit → delivered → cancelled → returned` |
| **Consumers** | Order management UI, fulfillment workflow, buyer notifications |

### 7d. Order Events

| Property | Detail |
|---|---|
| **Files** | `public/data/wholesale-order-events.json` |
| **Fields** | `event_id`, `order_id`, `event_type`, `timestamp`, `details`, `actor` |
| **Storage** | JSON file (append) |
| **Consumers** | Order timeline UI, audit trail |

### 7e. Order Deductions

| Property | Detail |
|---|---|
| **Files** | `public/data/wholesale-deductions.json` |
| **Fields** | Deduction records for short-ships, quality issues, returns |
| **Storage** | JSON file |

### 7f. Fulfillment (route: `wholesale-fulfillment.js`)

| Property | Detail |
|---|---|
| **Endpoints** | `POST /api/wholesale/orders/:orderId/fulfill`, `PATCH /api/wholesale/fulfillment/:id/status` |
| **Fields** | `fulfillment_id`, `order_id`, `status` (`pending → picked → packed → shipped → delivered`), `picker`, `packer`, `tracking_number`, `carrier`, `timestamps` |
| **Storage** | **In-memory `Map()`** |
| **Side Effects** | Webhook POST to GreenReach Central on status changes |
| **⚠ Risk** | Entirely volatile — all fulfillment records lost on restart |

### 7g. Catalog & Pricing Sync

| Property | Detail |
|---|---|
| **Endpoints** | `POST /api/wholesale/sync/catalog`, `POST /api/wholesale/sync/pricing` |
| **Fields** | Product catalog updates, price adjustments |
| **Storage** | Updates `public/data/wholesale-products.json` |
| **Frequency** | On webhook from GreenReach Central or manual trigger |

### 7h. Demo Catalog

| Property | Detail |
|---|---|
| **Files** | `public/data/wholesale-demo-catalog.json` |
| **Purpose** | Demo mode seed data for wholesale marketplace |

### 7i. Farm API Keys

| Property | Detail |
|---|---|
| **Files** | `public/data/farm-api-keys.json` |
| **Fields** | `{ farm_id: { api_key, status, created_at, label } }` |
| **Storage** | JSON file |
| **Consumers** | API authentication middleware for wholesale endpoints |

---

## 8. Loss & Waste Data

### 8a. Tray Loss Events

| Property | Detail |
|---|---|
| **Endpoint** | `POST /api/tray-runs/:id/loss` |
| **Fields** | `tray_run_id`, `crop_name`, `crop_id`, `loss_reason` (enum: mold, pest, environmental, mechanical, other), `lost_quantity`, `notes`, `created_at` |
| **Storage** | NeDB `tray-loss-events.db` (insert), also updates tray run status → `"LOST"` in `tray-runs.db` |
| **Consumers** | Loss analytics, trend reporting, AI training data |

### 8b. Loss Statistics

| Property | Detail |
|---|---|
| **Endpoint** | `GET /api/losses/current` |
| **Aggregation** | Queries `trayLossEventsDB`, groups by reason and crop |
| **Returns** | `{ lossesByReason: {}, lossesByCrop: {}, recentLosses: [], totalLosses: int }` |
| **Consumers** | Loss dashboard, Iot alert triggers |

---

## 9. Quality Control & Photo/Image Data

### 9a. QA Checkpoints (route: `quality-control.js`)

| Property | Detail |
|---|---|
| **Endpoints** | `POST /api/qa/checkpoints`, `GET /api/qa/checkpoints`, `GET /api/qa/checkpoints/:id` |
| **Fields** | `batch_id`, `checkpoint_type` (8 types — see below), `inspector` (name), `result` (pass/fail/conditional), `notes`, `photo_data` (base64 encoded image), `metrics {}` (type-specific), `farm_id` |
| **Checkpoint Types** | `seeding`, `germination`, `transplant`, `growth_midpoint`, `pre_harvest`, `post_harvest`, `packing`, `pre_shipment` |
| **Storage** | PostgreSQL `qa_checkpoints` table (cloud mode only) |
| **⚠ Note** | Not functional in NeDB edge mode — requires `DATABASE_URL` |

### 9b. AI Vision Analysis (route: `ai-vision.js`)

| Property | Detail |
|---|---|
| **Endpoints** | `POST /api/qa/analyze-photo`, `POST /api/qa/checklist-photo` |
| **Input Fields** | `image_data` (base64 string), `crop_type`, `growth_stage`, `context` |
| **Output Fields** | `health_score` (0–100), `assessment`, `color_quality`, `disease_signs`, `pest_damage`, `recommendations[]`, `confidence` |
| **External API** | OpenAI Vision API (`gpt-4o-mini` model) |
| **Storage** | Response returned to caller; not persisted server-side |
| **Consumers** | QA checkpoint workflow, grower mobile/iPad interface |

---

## 10. Traceability & Compliance

### 10a. Trace Records (route: `traceability.js`)

| Property | Detail |
|---|---|
| **Endpoints** | `POST /api/traceability/records`, `GET /api/traceability/records`, `GET /api/traceability/records/:lotCode` |
| **Fields** | `lot_code`, `batch_id`, `tray_run_id`, `crop_name`, `variety`, `recipe_id`, `zone`, `room`, `seed_source`, `seeded_at`, `harvested_at`, `environmental_conditions`, `handler_id`, `certifications`, `events[]` |
| **Auto-creation** | Trace record auto-created on harvest via tray-run harvest endpoint |
| **Storage** | `data/trace-records.json` (file-backed) |
| **Standard** | SFCR (Safe Food for Canadians Regulations) / CanadaGAP compliance |
| **Consumers** | Lot lookup, recall tracing, compliance reporting, wholesale order provenance |

---

## 11. Inventory Management

### 11a. Seed Inventory

| Property | Detail |
|---|---|
| **Endpoints** | `POST /api/inventory/seeds`, `GET /api/inventory/seeds`, `PATCH /api/inventory/seeds/:id` |
| **Fields** | `id`, `crop`, `variety`, `lot_number`, `quantity`, `unit`, `supplier`, `received_date`, `expiry_date`, `germination_rate`, `cost_per_unit` |
| **Storage** | **In-memory array** |
| **⚠ Risk** | Lost on restart |

### 11b. Packaging Inventory

| Property | Detail |
|---|---|
| **Endpoints** | `POST /api/inventory/packaging`, `GET /api/inventory/packaging` |
| **Fields** | `id`, `name`, `type`, `quantity`, `unit`, `supplier` |
| **Storage** | **In-memory array** |
| **⚠ Risk** | Lost on restart |

### 11c. Nutrient Inventory

| Property | Detail |
|---|---|
| **Endpoints** | `GET /api/inventory/nutrients`, `POST /api/inventory/nutrients/:id/usage` |
| **Fields** | `id`, `name`, `quantity`, `unit`, `usage_history[]` |
| **Storage** | **In-memory array** |
| **⚠ Risk** | Lost on restart |

### 11d. Equipment Inventory

| Property | Detail |
|---|---|
| **Endpoints** | `GET /api/inventory/equipment`, `POST /api/inventory/equipment/:id/maintenance` |
| **Fields** | `id`, `name`, `category`, `status`, `maintenance_history[] { date, type, notes, cost }` |
| **Storage** | **In-memory array** |
| **⚠ Risk** | Lost on restart |

### 11e. Supplies Inventory

| Property | Detail |
|---|---|
| **Endpoints** | `GET /api/inventory/supplies`, `POST /api/inventory/supplies/:id/usage` |
| **Fields** | `id`, `name`, `quantity`, `unit`, `usage_history[]` |
| **Storage** | **In-memory array** |
| **⚠ Risk** | Lost on restart |

### 11f. Tray Formats

| Property | Detail |
|---|---|
| **Endpoints** | `POST /api/tray-formats`, `GET /api/tray-formats`, `PATCH /api/tray-formats/:id` |
| **Fields** | `trayFormatId`, `name`, `rows`, `cols`, `cellShape`, `cellDiameter`, `is_weight_based`, `target_weight_per_site` |
| **Storage** | NeDB `tray-formats.db` |

### 11g. Trays

| Property | Detail |
|---|---|
| **Endpoints** | `POST /api/trays`, `GET /api/trays`, `PATCH /api/trays/:id` |
| **Fields** | `tray_id`, `format_id`, `label`, `status` |
| **Storage** | NeDB `trays.db` |

---

## 12. ML / Forecast Data

### 12a. ML Prediction Metrics

| Property | Detail |
|---|---|
| **Endpoint** | `POST /api/ml/metrics/record` |
| **Fields** | `zone`, `metric_type`, `predicted_value`, `actual_value`, `error`, `timestamp` |
| **Storage** | In-memory (schedule executor state) |
| **Consumers** | ML accuracy dashboard |

### 12b. ML Anomaly Detection

| Property | Detail |
|---|---|
| **Source** | Schedule executor runs Python ML script periodically |
| **Output** | `anomalies[]` each with `zone`, `severity` (warning/critical/info), `reason`, `timestamp`, `temperature`, `humidity`, `vpd` |
| **Storage** | In-memory `scheduleExecutor.mlAnomalies[]` + file `public/data/ml-insights/anomalies-latest.json` |
| **Endpoint** | `GET /api/schedule-executor/ml/anomalies` |

### 12c. ML Forecast

| Property | Detail |
|---|---|
| **Files** | `public/data/ml-insights/forecast-main-latest.json`, `public/data/ml-insights/energy-forecast-latest.json` |
| **Fields** | Zone-level temperature, humidity, energy predictions |
| **Source** | Python ML pipeline (`ml-pipeline/`) |
| **Consumers** | Dashboard forecast widgets |

### 12d. ML Model Training History

| Property | Detail |
|---|---|
| **Files** | `public/data/ml-models/training-history.json`, `public/data/ml-models/flower-model-metadata.json` |
| **Endpoint** | `POST /api/ml/retrain/:zone` |
| **Fields** | `zone`, `training_date`, `accuracy`, `model_version`, `hyperparameters` |

### 12e. ML Metrics Check

| Property | Detail |
|---|---|
| **Files** | `public/data/ml-insights/metrics-check-latest.json` |
| **Fields** | Model performance metrics, drift detection |

### 12f. AI Recommendations

| Property | Detail |
|---|---|
| **Files** | `data/ai-recommendations.json` |
| **Fields** | AI-generated crop/environment recommendations |
| **Source** | AI analysis pipeline |

---

## 13. User, Auth & Audit Data

### 13a. User Management

| Property | Detail |
|---|---|
| **Endpoints** | `POST /api/users/create`, `GET /api/users` |
| **Fields** | `id`, `email`, `name`, `role`, `password_hash`, `farm_id`, `created_at` |
| **Storage** | PostgreSQL `users` table (cloud mode) |

### 13b. Farm Auth Login

| Property | Detail |
|---|---|
| **Endpoint** | `POST /api/farm/auth/login` |
| **Fields** | `email`, `password` → returns JWT token |
| **Side Effect** | Updates `last_login` timestamp in PostgreSQL |
| **Storage** | PostgreSQL |

### 13c. Audit Logger (lib: `wholesale/audit-logger.js`)

| Property | Detail |
|---|---|
| **Class** | `AuditLogger` |
| **Fields per Entry** | `id` (hex), `timestamp`, `user_id`, `entity_type`, `entity_id`, `action`, `old_value` (JSON), `new_value` (JSON), `ip_address`, `user_agent`, `metadata` |
| **Entity Types** | `order`, `payment`, `reservation`, `fulfillment`, `refund` |
| **Actions** | `create`, `status_change`, `cancel`, `update`, etc. |
| **Storage** | **In-memory array** (`this.logs[]`, max 10,000 entries, FIFO trim) |
| **⚠ Risk** | Entirely volatile; comment says "In production, would insert to database" |

### 13d. Setup Wizard State

| Property | Detail |
|---|---|
| **Endpoints** | `POST /api/setup/wizard`, `GET /api/setup/wizard/:id`, `PATCH /api/setup/wizard/:id` |
| **Fields** | `wizardId`, `currentStep`, `completed`, `data {}`, `startedAt`, `discoveryContext`, `discoveryDefaults` |
| **Storage** | NeDB `wizard-states.db` |
| **Cleanup** | 7-day TTL, daily cleanup via `setInterval(cleanupOldWizardStates, 86400000)` |

---

## 14. Farm Configuration

### 14a. Farm Identity

| Property | Detail |
|---|---|
| **Endpoints** | `PUT /data/farm`, `GET /data/farm` |
| **Files** | `public/data/farm.json` |
| **Fields** | `name`, `address`, `city`, `state`, `zip`, `country`, `coordinates { lat, lng }`, `timezone`, `dedicated_crops[]`, `integrations { switchbot, openai, mqtt }`, `registration_id` |
| **Consumers** | Dashboard header, weather lookups (coordinates), wholesale network identity |

### 14b. Room Configuration

| Property | Detail |
|---|---|
| **Endpoints** | `PUT /data/rooms`, `POST /api/setup/save-rooms` |
| **Files** | `public/data/rooms.json` |
| **Fields** | `id`, `name`, `type`, `zones[]`, `devices[]`, `hardware_categories[]`, `dimensions`, `automation_profile` |
| **Consumers** | Room selector, device management, env monitoring, schedule executor |

### 14c. Room Metadata

| Property | Detail |
|---|---|
| **Files** | `public/data/rooms-metadata.json`, `public/data/rooms-metadata-extracted.json` |
| **Fields** | Extended room descriptions, capabilities, layout info |

### 14d. Room Maps

| Property | Detail |
|---|---|
| **Files** | `public/data/room-map.json`, `public/data/room-map-room-*.json` |
| **Fields** | Spatial layout, zone positions, equipment placement |

### 14e. Groups Configuration

| Property | Detail |
|---|---|
| **Endpoints** | `PUT /data/groups`, `POST /api/groups` |
| **Files** | `public/data/groups.json` |
| **Fields** | `id`, `name`, `crop`, `variety`, `recipe`, `plan`, `schedule`, `status` (deployed/idle/harvested), `zone`, `room`, `seeded_at`, `expected_harvest`, `lights[]`, `controller` |
| **Consumers** | Schedule executor, planting scheduler, harvest predictions, env monitoring |

### 14f. Controller URL

| Property | Detail |
|---|---|
| **Endpoint** | `POST /controller` |
| **Files** | `public/data/controller.json` |
| **Fields** | `{ url: string }` — hardware controller base URL |

### 14g. Crop Registry

| Property | Detail |
|---|---|
| **Files** | `public/data/crop-registry.json` |
| **Fields** | `id`, `name`, `category`, `growth_params { days_to_harvest, optimal_temp, optimal_humidity }`, `pricing { wholesale_per_lb }`, `market { demand_level }`, `nutrientProfile` |
| **Consumers** | Crop selection UI, weight benchmarks, wholesale pricing |

### 14h. Crop Pricing

| Property | Detail |
|---|---|
| **Files** | `public/data/crop-pricing.json` |
| **Fields** | Per-crop wholesale/retail pricing |

### 14i. Target Ranges

| Property | Detail |
|---|---|
| **Files** | `public/data/target-ranges.json` |
| **Fields** | Per-zone environmental target ranges (temp, humidity, CO2, VPD, PPFD) |
| **Consumers** | Anomaly detection, automation rules |

### 14j. Field Mappings

| Property | Detail |
|---|---|
| **Files** | `public/data/field-mappings.json` |
| **Fields** | Field name mappings between systems |

---

## 15. Weather Data

### 15a. Weather Polling

| Property | Detail |
|---|---|
| **Source** | Open-Meteo API (free, no key required) |
| **Frequency** | `setInterval` every **10 minutes** (`10 * 60 * 1000`) |
| **Fields** | `outside_temperature_c`, `outside_humidity`, `outside_wind_kmh`, `weather_code`, `is_day` |
| **Storage** | **In-memory cache** (no file persistence) |
| **Consumers** | Automation engine (outdoor context), ML anomaly detection (outdoor context overlay), dashboard weather widget |
| **Geocoding** | Nominatim API (from farm.json coordinates) |

---

## 16. Nutrient System

### 16a. Nutrient Dashboard Telemetry

| Property | Detail |
|---|---|
| **Endpoint** | `POST /data/nutrient-dashboard` |
| **Files** | `public/data/nutrient-dashboard.json` |
| **Fields** | `pH`, `EC` (mS/cm), `water_temp` (°C), `tds` (ppm), `dissolved_oxygen`, with `history[]` arrays per metric |
| **Source** | ESP32 sensor firmware via MQTT or manual POST |
| **Consumers** | Nutrient dashboard UI, automation engine |

### 16b. Nutrient Targets

| Property | Detail |
|---|---|
| **Endpoint** | `POST /api/nutrients/targets` |
| **Storage** | NeDB `nutrient-targets.db` |
| **Fields** | `pH_target`, `EC_target`, `temp_target`, with tolerance ranges |

### 16c. Pump Calibration

| Property | Detail |
|---|---|
| **Endpoint** | `POST /api/nutrients/pump-calibration` |
| **Storage** | NeDB `pump-calibrations.db` |
| **Fields** | `pump_id`, `ml_per_second`, `calibrated_at` |

### 16d. Sensor Calibration

| Property | Detail |
|---|---|
| **Endpoint** | `POST /api/nutrients/sensor-calibration` |
| **Storage** | NeDB `sensor-calibrations.db` |
| **Fields** | `sensor_id`, `offset`, `slope`, `calibrated_at`, `reference_value` |

### 16e. Nutrient Commands (MQTT)

| Property | Detail |
|---|---|
| **Endpoint** | `POST /api/nutrients/command` |
| **Broker** | `mqtt://192.168.2.42:1883` (default) |
| **Topic** | `commands/NutrientRoom` |
| **Fields** | `command`, `pump_id`, `duration_ms`, `volume_ml` |
| **Storage** | Command sent via MQTT; not persisted |

### 16f. Nutrient Profiles

| Property | Detail |
|---|---|
| **Files** | `public/data/nutrient-profiles.json` |
| **Fields** | Named profiles with per-crop nutrient target sets |

### 16g. Nutrient Automation State

| Property | Detail |
|---|---|
| **Background** | `refreshNutrientAutomation()` runs via timer at `NUTRIENT_POLL_INTERVAL_MS` |
| **State** | In-memory `nutrientAutomationState.snapshot` with telemetry, targets, mix, dosing |
| **Consumers** | Automation engine, nutrient dashboard |

---

## 17. Procurement

### 17a. Procurement System (route: `procurement.js`)

| Property | Detail |
|---|---|
| **Base Path** | `/api/procurement` |
| **Endpoints** | `GET /catalog`, `GET /categories`, `GET /suppliers`, `GET|PUT /cart`, `POST /orders`, `GET /orders`, `POST /orders/:id/receive`, `GET /inventory`, `GET /commission-report` |
| **Files** | `public/data/procurement-catalog.json`, `public/data/procurement-orders.json`, `public/data/procurement-suppliers.json`, `public/data/procurement-units.json` |
| **Fields** | Product catalog (id, name, category, supplier, price, unit, moq), cart items, order records (order_id, items, total, status, delivery_date) |
| **Storage** | JSON files in `public/data/` |
| **Consumers** | Farm supply ordering UI |

---

## 18. Timed / Background Processes

| Process | Interval | What It Does | Data Touched |
|---|---|---|---|
| **Schedule Executor** | 60 seconds | Evaluates light schedules, sends commands to hardware | Reads `groups.json`, `schedules.json`, `lighting-recipes.json`, `rooms.json`; sends device commands |
| **ML Anomaly Detection** | Triggered by schedule executor | Runs Python ML script for anomaly detection | Reads env data; writes `ml-insights/anomalies-latest.json` |
| **Weather Polling** | 10 minutes | Fetches outdoor weather from Open-Meteo | Writes to in-memory weather cache |
| **Nutrient Automation** | `NUTRIENT_POLL_INTERVAL_MS` | Polls nutrient sensors, evaluates dosing | Reads/writes `nutrient-dashboard.json`, sends MQTT commands |
| **Sensor Sync** | `SYNC_INTERVAL` | Syncs physical sensor data from hardware | Merges into env state |
| **Reservation Cleanup** | 60 minutes | Expires wholesale reservations past TTL | Removes from in-memory Map |
| **Wizard State Cleanup** | 24 hours | Removes wizard states older than 7 days | Deletes from `wizard-states.db` |
| **Sync Service Status** | 5 seconds (WebSocket) | Pushes sync status to connected admin clients | Reads sync service state |
| **Zone Bindings Refresh** | 30 seconds (configurable) | Refreshes zone-to-device bindings | Reads device/zone config |
| **Certificate Manager** | 24 hours | Checks/renews TLS certificates | Certificate files |

---

## 19. Data Volatility Risk Matrix

| Data Category | Storage | Risk Level | Impact of Restart |
|---|---|---|---|
| Tray runs, loss events, placements | NeDB (disk) | ✅ Low | Survives |
| Device registry | NeDB (disk) | ✅ Low | Survives |
| Env readings, groups, rooms, farm | JSON files (disk) | ✅ Low | Survives |
| Lighting recipes, schedules | JSON files (disk) | ✅ Low | Survives |
| Harvest log | JSON file (disk) | ✅ Low | Survives |
| Traceability records | JSON file (disk) | ✅ Low | Survives |
| Wholesale products, orders | JSON files (disk) | ✅ Low | Survives |
| Nutrient targets, calibrations | NeDB (disk) | ✅ Low | Survives |
| Crop weight records | In-memory + JSON backup | ⚠️ Medium | May lose recent unsaved records |
| **Wholesale reservations** | In-memory Map + JSON | 🔴 **High** | All active reservations lost |
| **Wholesale fulfillment** | In-memory Map only | 🔴 **Critical** | All fulfillment records lost |
| **Audit log** | In-memory array only | 🔴 **Critical** | All audit history lost |
| **Seed inventory** | In-memory array only | 🔴 **Critical** | All seed inventory lost |
| **Packaging inventory** | In-memory array only | 🔴 **Critical** | All packaging records lost |
| **Nutrient inventory** | In-memory array only | 🔴 **Critical** | All nutrient usage history lost |
| **Equipment inventory** | In-memory array only | 🔴 **Critical** | All maintenance history lost |
| **Supplies inventory** | In-memory array only | 🔴 **Critical** | All supply records lost |
| **Weather cache** | In-memory only | ⚠️ Medium | Refetched within 10 min |
| **ML anomalies** | In-memory + JSON file | ⚠️ Medium | Recalculated on next ML tick |
| QA checkpoints | PostgreSQL (cloud only) | ✅ Low | Survives (but unavailable in edge mode) |
| Users / auth | PostgreSQL (cloud only) | ✅ Low | Survives (but unavailable in edge mode) |

---

## Appendix: JSON Files in `public/data/` (Complete List)

```
ai-recommendations.json          groups.json
calibration.json                 harvest-log.json
controller.json                  iot-devices.json
crop-pricing.json                lighting-recipes.json
crop-registry.json               lights-catalog.json
device-kb.json                   nutrient-dashboard.json
device-manufacturers.json        nutrient-profiles.json
device-meta.json                 planting-assignments.json
devices.cache.json               procurement-catalog.json
env.json                         procurement-orders.json
env-cache.json                   procurement-suppliers.json
equipment-kb.json                procurement-units.json
equipment-metadata.json          room-map.json
equipment.catalog.json           room-map-room-*.json
farm.json                        rooms.json
farm-api-keys.json               rooms-metadata.json
field-mappings.json              rooms-metadata-extracted.json
                                 schedules.json
ml-insights/                     spd-library.json
  anomalies-latest.json          spd-library-default.json
  energy-forecast-latest.json    switchbot-devices.json
  forecast-main-latest.json      system-alerts.json
  metrics-check-latest.json      target-ranges.json
                                 ui-ctrl-map.json
ml-models/                       ui-equipment.json
  flower-model-metadata.json     wholesale-demo-catalog.json
  training-history.json          wholesale-deductions.json
                                 wholesale-order-events.json
                                 wholesale-orders-status.json
                                 wholesale-products.json
                                 wholesale-reservations.json
```

---

*End of catalog. 9 in-memory-only subsystems identified as critical data loss risks.*
