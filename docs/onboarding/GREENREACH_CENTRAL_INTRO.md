# GreenReach Central: Intro & System Overview

**Version:** 1.0 (CODE-VERIFIED SUMMARY)
**Date:** February 3, 2026  
**Scope:** What GreenReach Central actually does, key features, and how the main pages map to code.

---

## 1. What GreenReach Central Is

GreenReach Central is the **cloud control plane** for Light Engine:

- Aggregates data from all farms running Light Engine Foxtrot.
- Exposes an **internal operations console** (Central Admin) for staff.
- Powers a **wholesale marketplace & buyer portal** on top of live farm inventory.

It does **not** run low-level control loops (lights, HVAC, dosing). Those stay on the edge device. Central focuses on:

- Multi-farm monitoring and analytics
- Wholesale catalog aggregation and buyer flows
- Alerts and anomaly surfacing
- Harvest forecasting and inventory transparency

**Code location:**
- Server entry: `greenreach-central/server.js`
- Routes: `greenreach-central/routes/*.js`
- Services: `greenreach-central/services/*.js`
- UI: `greenreach-central/public/*.html`, `greenreach-central/public/central-admin.js`
- Database & migrations: `greenreach-central/config/database.js`

Authoritative behavior and endpoint lists are documented in:
- `GREENREACH_CENTRAL_EMPLOYEE_GUIDE_ACCURATE.md`
- `ML_AI_FEATURES_REPORT.md`
- `ALERTS_VS_ANOMALY_DETECTION.md`

---

## 2. System Architecture (High Level)

**Edge Device (Farm / Light Engine Foxtrot):**
- Runs `server-foxtrot.js` on the reTerminal or edge host.
- Maintains local farm data: `public/data/farm.json`, `groups.json`, `trays.json`, `rooms.json`, `env.json`, `room-map.json`.
- Exposes farm APIs like `/api/wholesale/inventory`, `/api/health/insights`, etc.
- Controls devices and applies recipe-based environmental targets.

**GreenReach Central (AWS EB, Node + PostgreSQL):**
- Runs `greenreach-central/server.js` (Node 20 on Amazon Linux 2023).
- Stores aggregated farm data in PostgreSQL tables: `farms`, `rooms`, `zones`, `devices`, `groups`, `telemetry`, `wholesale_lots`, `orders`, `buyers`, `alerts`, `ai_insights`, etc.
- Receives sync from farms via `/api/sync/*` endpoints.
- Polls farms for wholesale inventory via `wholesaleNetworkSync.js`.
- Serves admin UI (`GR-central-admin.html`) and wholesale UIs.

**Data Flow (simplified):**
- **Farm → Central:**
  - `POST /api/sync/heartbeat` – farm status.
  - `POST /api/sync/telemetry` – environmental metrics.
  - `POST /api/sync/rooms` / `groups` / `schedules` / `inventory` – configuration + harvest lots.
- **Central → Farms (wholesale):**
  - `wholesaleNetworkSync.js` polls each farm’s `/api/wholesale/inventory`.
  - Aggregates live inventory into a marketplace catalog.
- **Buyers → Central:**
  - Browse catalog (`GET /api/wholesale/catalog`).
  - Register/login, place orders (`/api/wholesale/buyers/*`, `/api/wholesale/checkout/*`).

---

## 3. Core Capabilities & Why They Exist

### 3.1 Multi-Farm Monitoring

**What it does:**
- Centralizes visibility across all connected farms: status, rooms, zones, devices, crop groups, telemetry, inventory.

**Why:**
- Without central monitoring, ops has no single source of truth for which sites are online, what’s growing where, and whether environments are in spec.

**Where in code:**
- UI shell & views: `greenreach-central/public/GR-central-admin.html`
- Dashboard logic: `greenreach-central/public/central-admin.js`
- Admin APIs: `greenreach-central/routes/admin.js`, `greenreach-central/routes/farms.js`, `greenreach-central/routes/monitoring.js`
- DB schema: `greenreach-central/config/database.js`

---

### 3.2 Wholesale Portal & Network Aggregation

**What it does:**
- Aggregates SKU-level inventory from multiple Light Engine farms.
- Exposes a buyer-facing wholesale portal for restaurants/retailers.
- Lets ops manage the hyperlocal farm network from a central admin view.

**Why:**
- Farmers need predictable wholesale demand without intermediaries.
- Buyers want a single portal to shop from multiple local farms.

**Where in code:**
- Buyer portal UIs:
  - `greenreach-central/public/GR-wholesale.html`
  - `greenreach-central/public/wholesale-landing.html`
  - `greenreach-central/public/wholesale-about.html`
  - `greenreach-central/public/wholesale-learn-more.html`
- Wholesale routes (catalog, buyers, orders):
  - `greenreach-central/routes/wholesale.js` (plus related wholesale route files)
- Network sync services:
  - `greenreach-central/services/wholesaleNetworkSync.js`
  - `greenreach-central/services/wholesaleMemoryStore.js`
- Inventory source on edge:
  - `/api/wholesale/inventory` in `server-foxtrot.js` + edge data files.

**Current production reality:**
- Buyers can register, browse catalog, and place **demo** orders.
- Square integration is stubbed (no real charges yet) – see notes in `GREENREACH_CENTRAL_EMPLOYEE_GUIDE_ACCURATE.md` and `ML_AI_FEATURES_REPORT.md`.

---

### 3.3 Farm Sales Terminal & Online Store

**What it does:**
- Provides a POS terminal and simple online store for direct farm sales.
- Shares inventory with the same underlying data model used by Central and wholesale.

**Why:**
- Avoid double-entry between farm stand/market sales and central inventory.
- Give farms a software-native way to sell on-site that plugs into the same stack.

**Where in code:**
- UIs:
  - `greenreach-central/public/farm-sales-pos.html`
  - `greenreach-central/public/farm-sales-shop.html`
  - `greenreach-central/public/farm-sales-store.html`
  - Landing: `greenreach-central/public/farm-sales-landing.html`
- Supporting routes:
  - `routes/farm-sales/*.js`, `routes/farm-store-setup.js`

---

### 3.4 Recipe-Driven Forecasts & Inventory Transparency

**What it does:**
- Uses crop recipes + seed dates to show upcoming harvests (0–7, 8–14, 15–30, 30+ days).
- Exposes both **current inventory** (harvest lots) and **future inventory** (groups not yet harvested).

**Why:**
- Growers and Central ops need to see supply weeks in advance to align with demand.
- Buyers need confidence that listed quantities match actual production.

**Where in code:**
- Recipes:
  - Edge CSV recipes: `public/data/recipes-v2/*.csv` (edge side).
- Forecast endpoint:
  - `GET /api/admin/harvest/forecast` in `greenreach-central/routes/admin.js`.
- Inventory ingestion:
  - `POST /api/sync/inventory` in `greenreach-central/routes/sync.js` → `wholesale_lots` table.

**Note:** Forecasting here is deterministic math (seed_date + recipe_days), not ML.

---

### 3.5 Alerts vs ML Anomalies

**What it does:**
- Provides a rule-based alert system (thresholds, device failures, business rules).
- Separately surfaces ML-based anomaly insights (when edge jobs are active).

**Why:**
- Operators need clear, actionable alerts (**reactive**) and also early-warning signals from pattern analysis (**proactive**).
- Mixing them into a single undifferentiated stream creates noise and confusion.

**Where in code & docs:**
- Concept & API details: `ALERTS_VS_ANOMALY_DETECTION.md`
- Alert routes: `greenreach-central/routes/alerts.js`
- Alert dashboard: sections in `GR-central-admin.html` + logic in `central-admin.js`
- Anomaly endpoints (Central side):
  - `GET /api/schedule-executor/ml-anomalies`
  - `GET /api/ml/metrics/alerts`
  - Implemented in ML-related route files under `greenreach-central/routes/`.

**Reality check:**
- Edge ML (IsolationForest, SARIMAX, weather, AI vision) is implemented in the edge backend – see `ML_AI_FEATURES_REPORT.md` and `backend/*.py`.
- Central mostly **aggregates and displays** these outputs when they exist, and maintains its own `ai_insights` table.

---

### 3.6 AI & ML in the Central Context

Central’s role in AI/ML is **aggregation and visualization** rather than raw model execution.

- **Edge AI/ML (real, per ML report):**
  - Weather via Open-Meteo.
  - IsolationForest anomaly detection.
  - SARIMAX forecasting.
  - AI vision via OpenAI GPT-4o-mini.
- **Central AI-like features:**
  - Deterministic harvest forecast endpoint in `routes/admin.js`.
  - Anomaly and AI insight aggregation endpoints (`/api/admin/ai-insights`, ML metrics routes).
  - Dashboards in `GR-central-admin.html` that display anomalies, alerts, and insights when upstream data is available.

Aspirational AI features like dynamic energy optimization, demand forecasting, and full vision-based quality scoring are **not** yet implemented in Central and are explicitly called out as such in `GREENREACH_CENTRAL_EMPLOYEE_GUIDE_ACCURATE.md`.

---

## 4. Central Admin – Page-by-Page Overview

All of these are implemented as views inside `GR-central-admin.html` and wired up in `central-admin.js`, matching the accurately-verified employee guide.

### 4.1 Login Page

- **File:** `greenreach-central/public/GR-central-admin-login.html`
- **Purpose:** Auth gate for staff.
- **Flow:**
  - `POST /api/admin/auth/login` on submit (see `routes/auth.js`).
  - On success, stores `admin_token` in `localStorage`.
  - Redirects to `GR-central-admin.html`.

### 4.2 Admin Shell & Navigation

- **File:** `greenreach-central/public/GR-central-admin.html`
- **Script:** `greenreach-central/public/central-admin.js`
- **Behavior:**
  - Pre-load check for `admin_token` (redirects to login if missing).
  - Left sidebar nav sections (Overview, Farms, Rooms, Devices, Inventory, Recipes, Analytics, Alerts, Wholesale, etc.).
  - `navigate('view-id')` toggles `<div class="view" id="...">` sections.

### 4.3 Overview View

- **Purpose:** Single-screen snapshot of the whole network.
- **Displays:**
  - KPIs: total farms, rooms, zones, active groups, plants/trays, revenue, alert counts.
  - Tables/cards for recent alerts, sync status, and high-level wholesale activity.
- **APIs:** `GET /api/admin/kpis`, `GET /api/admin/operations-overview`, `GET /api/admin/alerts`.

### 4.4 Farms View

- **Purpose:** List of all farms Central knows about.
- **Displays:**
  - Farm ID, name, location.
  - Online / offline / degraded status (based on last heartbeat).
  - Last sync timestamps and key metrics.
- **APIs:** `GET /api/admin/farms`.

### 4.5 Farm Detail View

- **Purpose:** Drilldown into one farm’s data.
- **Displays:**
  - Farm metadata: owner, contact, location, API key status.
  - Rooms and zones: layout, targets, current telemetry.
  - Devices: sensors, lights, actuators and status.
  - Crop groups: recipe, seed date, stage, tray counts.
  - Inventory: harvest lots from this farm.
  - Farm-specific alerts and AI insights.
- **APIs:**
  - `GET /api/admin/farms/:farmId`
  - `GET /api/admin/farms/:farmId/rooms`
  - `GET /api/admin/farms/:farmId/zones`
  - `GET /api/admin/farms/:farmId/groups`
  - `GET /api/admin/farms/:farmId/devices`
  - `GET /api/admin/alerts/:farmId`
  - `GET /api/admin/ai-insights/:farmId`

### 4.6 Rooms & Room Mapper

- **Rooms list view:**
  - Aggregated list of rooms and their status.

- **Room Mapper:**
  - **File:** `greenreach-central/public/views/room-mapper.html`
  - **Purpose:** Visual 2D editor for room layout and sensor placement.
  - **Displays:**
    - Canvas representing room floor plan (min height ~800px after recent fix).
    - Sensors and devices placed on the grid.
    - Zone heatmap coloring (cool/optimal/warm/hot).
  - **Data:**
    - Edge `room-map.json` synced via `/api/sync/rooms`.

### 4.7 Devices View

- **Purpose:** Central registry of all IoT devices across farms.
- **Displays:**
  - Device ID, type, farm, zone.
  - Last seen timestamp and health state.
- **APIs:** `GET /api/admin/farms/:farmId/devices` and related monitoring endpoints.

### 4.8 Inventory & Forecast Views

- **Inventory view:**
  - Shows harvest lots (current inventory) from `wholesale_lots`.
  - Quantities available, reserved, and associated farms.
  - **APIs:** `POST /api/sync/inventory` (ingest), read endpoints under `routes/inventory.js` / `routes/admin.js`.

- **Harvest forecast view:**
  - Groups upcoming harvests into 0–7, 8–14, 15–30, 30+ days.
  - Based on seed dates and recipe grow-days.
  - **API:** `GET /api/admin/harvest/forecast`.

### 4.9 Recipes View

- **Purpose:** Read-only listing of recipes that farms are using.
- **Displays:**
  - Recipe list and per-recipe environmental targets by stage.
- **APIs:** `GET /api/admin/recipes`, `GET /api/admin/recipes/:recipeName`.

### 4.10 Alerts View

- **Purpose:** Primary console for triaging rule-based alerts.
- **Displays:**
  - Active / acknowledged / resolved alerts.
  - Filters by severity, farm, category.
  - Buttons to acknowledge or resolve.
- **APIs:**
  - `GET /api/admin/alerts`
  - `GET /api/admin/alerts?farm_id=...`
  - `POST /api/admin/alerts/:id/acknowledge` (or equivalent) and resolve endpoints.
- **Spec:** Data model and behavior defined in `ALERTS_VS_ANOMALY_DETECTION.md`.

### 4.11 Anomaly / AI Insights View

- **Purpose:** Display ML-detected anomalies and AI insights.
- **Displays:**
  - Anomaly rows with scores and context when edge ML jobs are running.
  - AI-insight cards from `ai_insights`.
- **APIs:**
  - `GET /api/schedule-executor/ml-anomalies`
  - `GET /api/ml/metrics/alerts`
  - `GET /api/admin/ai-insights`

### 4.12 Wholesale Admin View (inside Central)

- **Where:** Dedicated views in `GR-central-admin.html` that embed wholesale admin/buyer pages via `<iframe>`.
- **Files embedded:**
  - `greenreach-central/public/GR-wholesale-admin.html`
  - `greenreach-central/public/GR-wholesale.html`
- **Displays:**
  - Farm network registry.
  - Network snapshots and sync health.
  - Wholesale orders, buyers, and payment records.
- **APIs:** Wholesale admin routes in `greenreach-central/routes/wholesale.js` and supporting wholesale route files.

### 4.13 Farm Management & Support Tools

- **Purpose:** Admin-level tools for supporting farms (documented in `CENTRAL_ADMIN_READINESS_REPORT.md`).
- **Examples (some planned/partial):**
  - Impersonation tokens: `POST /api/admin/impersonate/:farmId`.
  - Farm data reset/export: `POST /api/admin/farms/:farmId/reset`, `GET /api/admin/farms/:farmId/export`.

---

## 5. Wholesale Buyer-Facing Pages (Quick Map)

These live alongside Central and share the same wholesale APIs.

- Marketing / info:
  - `greenreach-central/public/wholesale-landing.html`
  - `greenreach-central/public/wholesale-about.html`
  - `greenreach-central/public/wholesale-learn-more.html`

- Buyer portal:
  - `greenreach-central/public/GR-wholesale.html`
  - Legacy entry: `greenreach-central/public/wholesale.html`

They all call the same wholesale APIs documented in `GREENREACH_CENTRAL_EMPLOYEE_GUIDE_ACCURATE.md` (`/api/wholesale/catalog`, `/api/wholesale/buyers/*`, `/api/wholesale/checkout/*`, etc.).

---

## 6. How to Use This Document

- For **onboarding**: read this first, then drill into `GREENREACH_CENTRAL_EMPLOYEE_GUIDE_ACCURATE.md` for exhaustive endpoint and table lists.
- For **code navigation**: use the file references above as jump points into specific routes, services, and views.
- For **future edits**: keep this file code-accurate. If a feature description here stops matching the implementation, either update the code or update this doc – but don’t let them drift.
