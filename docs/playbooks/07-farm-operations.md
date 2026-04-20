# 07 — Farm Operations Playbook (Light Engine runtime)

**Owner:** Farm operators (per tenant); agent-supported by E.V.I.E. + Farm-Ops-Agent
**Canonical reference:** `.github/SENSOR_DATA_PIPELINE.md`, `.github/COMPLETE_SYSTEM_MAP.md` §5–7
**Related docs:** `docs/features/`, `docs/operations/`, `docs/architecture/`

---

## 1. Purpose & scope

The Light Engine (LE) is the **per-tenant farm runtime** that operators use every day: read sensor telemetry, drive environment targets, run schedules, plant / rotate / harvest trays, track inventory, and surface alerts. Everything in this playbook runs in the LE service (`server-foxtrot.js`); cross-farm aggregation happens in Central (see Playbook 09).

## 2. Pages a farm operator uses (top 10)

| Page | URL | What it does |
|---|---|---|
| Farm Admin (shell) | `/LE-farm-admin.html` | Tesla-style tabbed shell (Operations / Growing / Business / Assistant); loads the sub-views below via iframe |
| Environment | `/views/environment.html` (iframe inside Farm Admin) | Live VPD, temp/RH/CO₂ by zone; target ranges |
| Activity Hub | `/views/tray-inventory.html` (iframe) | Tray lifecycle / movements / harvests (this is the current "grow management" surface) |
| 3D Farm Viewer | `/views/3d-farm-viewer.html` | **Canonical crop-assignment UI.** Click a group → pick crop → save writes all five scheduling fields (see §7A). Also the preview surface for Farm Builder proposals (Playbook 10). |
| Farm Setup | `/views/farm-setup.html` | Per-room hardware inventory, location / weather, WiFi + SwitchBot pairing. Will gain the Farm Builder `build` step in Phase B1 (Playbook 10). |
| Setup Wizard | `/setup-wizard.html` | First-boot 5-step linear wizard; thin UI over the Setup-Agent 12-phase catalogue (Playbook 09). |
| Planning | `/views/planning.html` (iframe) | Schedule next seeding + multi-week plan; embeds `planting-scheduler.html` which writes `planting_assignments` (see §15 gap G3). |
| Nutrient Management | `/views/nutrient-management.html` (iframe) | Nutrient targets and dosing |
| Farm Summary | `/views/farm-summary.html` (iframe) | Real-time zone dashboard (temp/RH/VPD/CO₂ + alerts) |
| Inventory | `/views/inventory.html` + `/views/farm-inventory.html` (iframes) | Crop + supplies |
| Supplies | `/views/supplies.html` (iframe) | Consumables / reorder |
| Calendar | `/views/calendar.html` | Task + harvest + delivery calendar |
| POS | `/farm-sales-pos.html` | In-person sales (Square terminal) |
| Wholesale Orders | `/LE-wholesale-orders.html` | Accept/fulfill wholesale orders |
| Assistant (E.V.I.E.) | `/evie-core.html` | Chat, briefings, ambient presence |

The shell nav-item `data-url` attributes in `public/LE-farm-admin.html` are the source of truth for which sub-view opens in which tab.

Many of the pages listed in `.github/UI_CONSOLIDATION_ROADMAP.md` are being folded into these via E.V.I.E.

## 3. Data model (operational core)

| Table | Purpose |
|---|---|
| `rooms` | Physical growing rooms / zones |
| `groups` | Plant groupings (batches) within a room |
| `schedules` | Environment + photoperiod targets per group |
| `devices` | SwitchBot IoT devices (sensors, hubs, relays) |
| `tray_runs` | Tray lifecycle: seeded → germinated → active → harvested |
| `harvest_events` | Per-harvest weight, lot, quality |
| `lot_records` | Traceability records per harvest lot |
| `farm_inventory` | Crop/product inventory (see Playbook 03 §7) |
| `farm_data` | JSONB blob store for supplies, configurations |
| `farm_alerts` | Alert events (sensor, automation, business) |
| `conversation_history` | E.V.I.E. chat memory per farm |
| `env_cache` | Latest env snapshot per zone |

Additional operational stores are JSONB keys under `farm_data` (e.g., `crop-registry.json`, `target-ranges.json`, `harvest-log.json`, `wholesale-orders-status.json`, `device-meta.json`).

## 4. Sensor data pipeline

**File:** `.github/SENSOR_DATA_PIPELINE.md` (canonical)

```
SwitchBot Cloud API (polled every 30s)
   ↓
`setupLiveSensorSync()` in `server-foxtrot.js` — polls SwitchBot API v1.1 per device
   ↓
`preEnvStore` (in-memory) + `data/automation/env-state.json` (file persistence)
   ↓
LE `GET /env` — serves current snapshot to local UI and to Central
   ↓
`lib/sync-service.js` (LE) → Central `POST /api/sync/telemetry` → AlloyDB `farm_data.telemetry`
   ↓
VPD + target-range evaluation (`public/spectrum_env_math.js` browser-side; server-side equivalents)
   ↓
Alert detection + automation triggers
```

(See `.github/SENSOR_DATA_PIPELINE.md` for the canonical stage-by-stage reference. Note: a separate `automation/drivers/switchbot-driver.js` exists for PlugManager relay control; it is **not** the primary sensor poller — sensor polling is inline in `server-foxtrot.js`.)

### 4.1 Credentials
- `SWITCHBOT_TOKEN`, `SWITCHBOT_SECRET` in Secret Manager
- Per-device mapping in `device-meta.json`

### 4.2 Polling cadence
- Default 30s per device
- Back-pressure / retry: 3 attempts with exponential backoff
- On sustained failure: alert raised (`SENSOR_OFFLINE`)

### 4.3 Central fallback
Central exposes `/env` that proxies LE's `/env` when the farm-side server is unreachable and falls back to the last cached snapshot. See `.github/TROUBLESHOOTING_ENV_DATA.md`.

## 5. VPD and target ranges

- **VPD:** Vapor Pressure Deficit, computed from temperature + relative humidity
- **Target ranges:** stored in `target-ranges.json` per (room, crop, stage)
- **Evaluation:** `public/spectrum_env_math.js` (shared browser-side math) + server-side equivalents
- **Alerts:** raised when outside target range for N consecutive polls (configurable)

## 6. Schedule executor

**File:** `lib/schedule-executor.js`

- Reads `schedules` for active groups
- Applies photoperiod (on/off cycles) to lights via SwitchBot relays
- Applies environment targets (setpoints for HVAC, humidifiers, CO₂ dosers if present)
- Records `schedule_runs` for audit

## 7. Tray lifecycle

```
Seed → Tray created (tray_runs INSERT)
  ↓
Germination window (environment target A)
  ↓
Active growth (environment target B)
  ↓
Harvest event (harvest_events INSERT)
  ↓ recalculateAutoInventoryFromGroups()
  ↓ farm_inventory.auto_quantity_lbs updated
  ↓
Lot record (lot_records INSERT) — traceability per harvest
```

## 8. Alerts

- Written to `farm_alerts`
- Categories: sensor offline, out-of-range environment, schedule deviation, automation fault, business (stock low, payment failed, wholesale expiring)
- Surfaced on Farm Admin home, environment page, and via E.V.I.E. briefings
- Resolve/snooze via tool gateway (`resolve_alert`)

## 9. ML features

**File:** `docs/ai-agents/ML_AI_FEATURES_REPORT.md`

- Crop weight predictions (stored per tray)
- Recipe anomaly detection (deviation from baseline)
- Demand forecast inputs to Central wholesale aggregator
- Yield trend analysis (cross-tray)
- Health risk scoring (environment + phenotype indicators)

Models are **offline-trained** externally; LE loads model artifacts from GCS or inference results from Central-side services.

## 10. Daily to-do + Farm-Ops-Agent

The Farm-Ops-Agent (Playbook 02 §4) produces a prioritized daily task list each morning for each farm using:
- Current alerts
- Schedule deviations
- Harvest windows
- Demand signals (from Central)
- Risk scores

E.V.I.E. surfaces this to the farm on the home page and in briefings.

## 11. Key files (LE)

| Path | Purpose |
|---|---|
| `server-foxtrot.js` | LE entrypoint (~30k lines; under decomposition) |
| `server-foxtrot.js` `setupLiveSensorSync()`, `data/automation/env-state.json` (GCS FUSE-mounted on Cloud Run) | Sensor polling + persistence (primary sensor pipeline — inline, not a separate module) |
| `automation/drivers/switchbot-driver.js` | SwitchBot relay control for PlugManager (not the sensor poller) |
| `automation/env-store.js` | Room/zone target + scope state store |
| `lib/schedule-executor.js` | Schedule engine |
| `lib/sync-service.js` | LE ↔ Central sync |
| `lib/farm-store.js` | Per-farm Maps + JSONB accessors |
| `automation/` | Automation routines (photoperiod, CO₂ dosing, alerts) |
| `routes/farm-sales/*.js` | DTC + POS |
| `routes/wholesale-*.js`, `routes/wholesale/*.js` | Wholesale LE endpoints |
| `public/LE-farm-admin.html` + `public/views/*.html` (environment, planning, tray-inventory, farm-summary, nutrient-management, inventory, supplies, …) | Operator UI shell + iframe sub-views |

## 12. Security & tenancy rules

- LE runs **single-tenant per deployment** (one farm) when scaled per-customer; or multi-tenant when farm context is resolved per request (default today)
- Every handler must derive `farm_id` from auth context, never from query/body
- Sensor endpoints require authenticated farm JWT or sync API key
- Inventory writes must use the DB `query()` wrapper (Playbook 01 §5.3)
- Do **not** import from `greenreach-central/routes/` (dual-deploy rule)

## 13. Configuration

| Env var | Purpose |
|---|---|
| `SWITCHBOT_TOKEN`, `SWITCHBOT_SECRET` | Sensor polling |
| `ENV_POLL_INTERVAL_MS` (default 30000) | Poll cadence |
| `GREENREACH_API_KEY` | Central ↔ LE auth |
| `ENV_TARGET_HYSTERESIS_SECONDS` | Smoothing for alert raising |
| Farm-level Square/Stripe creds (set per tenant) | Payments |

## 14. Never do

- Edit generated files (e.g., mass-generated CSVs, exported audit logs)
- Modify `target-ranges.json` without migration + per-room validation
- Write new endpoints bypassing `farm_store` / DB wrapper
- Poll SwitchBot faster than 30s (API rate limits + cost)
- Trust unauthenticated sensor posts (even on local network)
- Commit sensor raw data to the repo

## 15. Known gaps / open items

- `server-foxtrot.js` is a ~30k-line monolith; decomposition is ongoing
- Some pages in `public/` duplicate Central equivalents; dual-deploy registry prevents drift but risk remains
- Automation coverage varies by farm hardware; documented in `device-meta.json`
- Tray-to-inventory pipeline is mostly automatic but some farm-sales paths still skip inventory decrement (see Playbook 03 §7)
- **G1.** The 3D viewer is the canonical crop-assignment UI today; it is **not** experimental. `public/views/3d-farm-viewer.html` `applyGroupEdits` (lines ~3679–3710) is the one UI path that stamps all five scheduling fields correctly.
- **G2.** `update_group_crop` (EVIE, `greenreach-central/routes/assistant-chat.js:4918–4950`) does **not** stamp `planConfig.anchor.seedDate`; daily resolver therefore keeps EVIE-assigned groups at day 1 indefinitely. Fix planned in Farm-Builder Phase A (Playbook 10 §10).
- **G3.** `planting-scheduler.html` (`savePlantingAssignment`, line 1624) writes `seed_date` / `harvest_date` to the `planting_assignments` store, which `runDailyPlanResolver` (server-foxtrot.js:5086–5511) does **not** read. Fix planned in Farm-Builder Phase D.
- **G4.** `tray-inventory.html` batch-mode seeding emits no `planId` / `seedDate`; seedings initiated from the Activity Hub are invisible to the daily resolver.
- **G5.** Dual-deploy mirror reconciliation (`greenreach-central/public/`) has no CI drift guard; #9/#16/#17 divergence went undetected until #37 cleaned it up. Fix planned in Farm-Builder Phase E2.

## 7A. Crop-scheduling contract (authoritative)

Every UI or agent that assigns a crop to a group **must** stamp all five fields atomically (or delegate to a shared helper once Phase A lands):

| Field | Purpose | Who reads it |
|---|---|---|
| `group.crop` | Human-readable canonical crop name | UI, reports |
| `group.recipe` | Recipe key in `lighting-recipes.json` (usually the canonical crop name) | `resolvePlanLightTargets`, `resolvePlanEnvTargets`, nutrient-management enrichment (`server-foxtrot.js` ~L17002) |
| `group.plan` | Plan key in `plans.json` / registry | Daily resolver (`runDailyPlanResolver`) |
| `group.planId` | Same as `group.plan` (alias for backward compat) | Same |
| `group.planConfig.anchor.seedDate` | `YYYY-MM-DD`; day 1 anchor for recipe progression | `computePlanDayNumber` → `resolvePlanLightTargets(day)` |

Today, the 3D viewer stamps all five; `update_group_crop` (EVIE) stamps four (missing `anchor.seedDate`); tray-inventory batch-mode stamps zero. This is tracked as gap G2/G4 above.

## 16. References

- `.github/SENSOR_DATA_PIPELINE.md`
- `.github/TROUBLESHOOTING_ENV_DATA.md`
- `.github/COMPLETE_SYSTEM_MAP.md` §5 (rooms, groups, schedules, trays), §7 (automation)
- `docs/features/`, `docs/operations/`
- `docs/ai-agents/ML_AI_FEATURES_REPORT.md`, `FARM_OPS_AGENT_BUILD_PLAN_2026-03-08.md`
- Playbook 02 (Farm-Ops-Agent + E.V.I.E.)
