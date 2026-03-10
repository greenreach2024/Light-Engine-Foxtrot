# Integration Assistant — Detailed Proposal for Review

**Date:** 2026-02-22  
**Revision:** R3 — Deep Research Review Incorporated  
**Author:** AI Engineering Review  
**Branch:** main  
**Status:** PROPOSAL — REVISION 3 — DEEP RESEARCH REVIEW INTEGRATED  
**Constraint:** Research-only audit. No code edits, commits, or deploys were made.

> **Revision History**  
> R1 (2026-02-22): Initial proposal with codebase audit, gap analysis, and 10 tickets.  
> R2 (2026-02-22): Incorporated executive assessment. Upgraded safety envelope to control-system boundary (stateful, auditable, centralized). Upgraded privacy model from SHA-256 to HMAC. Added sync idempotency (UPSERT). Hardened manifest schema (Draft 2020-12, supply-chain governance). Added discovery hardening constraints. Added network intelligence governance. Expanded risk register (R8–R14). Added 6 new architecture decisions (AD-6 through AD-11). Added executive review summary, decision points, and governance sections.  
> R3 (2026-02-22): Incorporated deep research review. Added fail-safe/fail-closed posture for unknown safety state (AD-12). Corrected CO₂ thresholds to occupational standards (OSHA 5,000 ppm TWA / NIOSH 30,000 ppm STEL; comfort threshold 1,000 ppm per Health Canada IAQ). Added stale-state handling for cross-device interlocks (AD-13). Added pepper lifecycle governance (backup, rotation, recovery). Refined sync idempotency to use farm-provided `record_updated_at` instead of Central `updated_at` (AD-14). Upgraded manifest checksum enforcement posture (blocked in production, warn in development). Added Ajv dialect isolation requirement. Added MQTT telemetry conventions (topic naming, QoS, payload validation). Expanded discovery proxy governance. Added formal acceptance criteria (Section 16). Added targeted team questions (Section 17). Expanded risk register (R15–R18). Added architecture decisions AD-12 through AD-15.

---

## Table of Contents

1. [Purpose](#1-purpose)
2. [System Context](#2-system-context)
3. [Current State — What Is Already Built](#3-current-state--what-is-already-built)
4. [Code Evidence — File-by-File Audit](#4-code-evidence--file-by-file-audit)
5. [What Has NOT Been Built](#5-what-has-not-been-built)
6. [Gap Analysis — Proposal vs Codebase](#6-gap-analysis--proposal-vs-codebase)
7. [Proposed Work — Detailed Tickets](#7-proposed-work--detailed-tickets)
8. [Architecture Decisions](#8-architecture-decisions)
9. [Data Flow Diagrams](#9-data-flow-diagrams)
10. [Risk Register](#10-risk-register)
11. [Timeline & Effort Estimates](#11-timeline--effort-estimates)
12. [Approval Checklist](#12-approval-checklist)
13. [Executive Review Summary](#13-executive-review-summary) *(R2)*
14. [Decision Points for Team](#14-decision-points-for-team) *(R2/R3)*
15. [Network Intelligence Governance](#15-network-intelligence-governance) *(R2)*
16. [Acceptance Criteria](#16-acceptance-criteria) *(R3)*
17. [Targeted Team Questions](#17-targeted-team-questions) *(R3)*
18. [Pepper Lifecycle Governance](#18-pepper-lifecycle-governance) *(R3)*
19. [MQTT Telemetry Conventions](#19-mqtt-telemetry-conventions) *(R3)*
20. [Implementation Plan for Review](#20-implementation-plan-for-review) *(R4)*

---

## 1. Purpose

This document provides a comprehensive, reviewer-friendly proposal for completing the Integration Assistant feature set within the Light Engine Foxtrot / GreenReach Central ecosystem.

**What this document covers:**
- Verified inventory of everything already built (with file paths, line counts, and API endpoints)
- Precise identification of what remains to be built
- Detailed, actionable tickets for each remaining feature
- Code-level specifications including function signatures, database schemas, and API contracts
- Priority ordering based on safety, value, and dependency analysis

**What this document does NOT do:**
- No code was edited, committed, or deployed during this review
- No assumptions made without verifying against the actual codebase

---

## 2. System Context

### Two Applications

| Application | Purpose | Runtime | Deployment |
|-------------|---------|---------|------------|
| **Light Engine Foxtrot** | Edge farming system — device control, AI agent, local automation | `server-foxtrot.js` (21,000+ lines) | Raspberry Pi / local |
| **GreenReach Central** | Multi-farm hub — analytics, AI push, network intelligence | `greenreach-central/server.js` | AWS Elastic Beanstalk |

### Communication Channels

| Channel | Direction | Frequency | Payload Today |
|---------|-----------|-----------|--------------|
| Farm Data Sync | Farm → Central | Every 5 min | telemetry, groups, config, **integration_records** (added by I-1.9) |
| AI Recommendations Push | Central → Farm | Every 30 min | recommendations, network_intelligence, **device_integrations** (added by I-4.9) |
| Experiment Records | Farm → Central | On harvest | structured outcome data |

### Persistence

| Layer | Technology | Pattern |
|-------|-----------|---------|
| Farm (Edge) | NeDB (file-backed) | `integrationDB`, `deviceHealthDB`, `equipmentInventoryDB` |
| Central (Cloud) | PostgreSQL | `device_integrations` table (migration 017) |

### AI Agent Architecture

The farm-side AI agent (`services/ai-agent.js`, 1,576 lines) uses:
- GPT-4o-mini for intent classification
- 13 capability categories with 67 total actions
- Permission matrix with 3 tiers: `auto`, `recommend`, `require-approval`
- Pattern: `parseCommand()` → intent JSON → `executeAction()` → category switch → handler function

**Currently NO `integrations` category exists in the agent.**

---

## 3. Current State — What Is Already Built

### Summary Table

| Ticket | Feature | File(s) | Lines | Status |
|--------|---------|---------|-------|--------|
| I-1.8 | Central DB Schema | `greenreach-central/migrations/017_device_integrations.sql` | 63 | ✅ Written, may not be applied to RDS |
| I-1.9 | Farm-Data Sync Extension | `routes/integrations.js` | 383 | ✅ Wired at `/api/integrations` |
| I-2.9 | Minimal Driver Interface | `lib/device-driver.js` | 382 | ✅ Base class + registry + generic driver |
| I-2.10 | Add Device Wizard MVP | `lib/device-wizard.js` | 645 | ✅ 6-step wizard, 10 REST endpoints |
| I-3.10 | Device Uptime Tracking | `lib/device-health-tracker.js` | 327 | ✅ NeDB-backed, per-type thresholds |
| I-3.11 | Network Device Analytics | `greenreach-central/routes/network-devices.js` | 407 | ✅ Central aggregation endpoints |
| I-4.9 | Push Integration Recommendations | `greenreach-central/services/ai-recommendations-pusher.js` | (lines 55–130) | ✅ Driver recommendations |
| I-4.10 | Driver Version Warnings | `greenreach-central/services/ai-recommendations-pusher.js` | (lines 117–130) | ✅ Failure rate warnings |
| — | SwitchBot Protocol Driver | `automation/drivers/switchbot-driver.js` | 213 | ✅ HTTP API, HMAC-SHA256 auth |
| — | Kasa Protocol Driver | `automation/drivers/kasa-driver.js` | 184 | ✅ Local network, power monitoring |
| — | Shelly Protocol Driver | `automation/drivers/shelly-driver.js` | 116 | ✅ HTTP RPC control |
| — | Device Discovery Engine | `lib/device-discovery.js` | 303 | ✅ Not wired into wizard |
| — | mDNS Discovery Routes | `routes/mdns-discovery.js` | 198 | ✅ mDNS-based local scan |
| — | Hardware Detection | `services/hardware-detection.js` | 268 | ✅ USB/serial/network scan |
| — | Central Discovery Proxy | `greenreach-central/routes/discovery-proxy.js` | 90 | ✅ Proxy endpoint |

**Total existing integration code: 3,579+ lines across 13+ files.**

---

## 4. Code Evidence — File-by-File Audit

### 4.1 `lib/device-driver.js` (382 lines)

**What it provides:**
- `DeviceDriver` base class — 5 core methods:
  1. `connect(connectionConfig)` → `{ok, error?}`
  2. `disconnect()` → `{ok, error?}`
  3. `discover(options)` → `{ok, devices[], error?}`
  4. `getStatus(deviceId)` → `{ok, status: {deviceId, online, power, lastSeen, telemetry}}`
  5. `sendCommand(deviceId, command, params)` → `{ok, result?, error?}`
- `getCapabilities()` → `{protocol, driverId, version, commands[], telemetry[], supportsDiscovery, supportsGroups}`
- `validateConfig(config)` → `{valid, errors[]}`
- `DriverRegistry` class — `register(protocol, DriverClass)`, `getDriver(protocol, config)`, `getProtocols()`, `hasProtocol(protocol)`
- `GenericDriver` — mock fallback driver registered automatically
- Singleton `driverRegistry` export

**What it's missing (for Phase 6):**
- `validate()` — validate device post-install
- `healthCheck()` — periodic health probe
- `subscribeTelemetry()` — event-based real-time data

### 4.2 `lib/device-wizard.js` (645 lines)

**What it provides:**
- `DeviceWizard` class with 6-step flow:
  1. `PROTOCOL_SELECT` — choose from 6 protocols (SwitchBot, Kasa, MQTT, Tasmota, Modbus, Generic)
  2. `CONNECTION_CONFIG` — protocol-specific fields
  3. `DEVICE_DISCOVERY` — calls `driver.discover()` (currently returns empty for most protocols)
  4. `CONNECTIVITY_TEST` — calls `driver.getStatus()`, computes signal quality score
  5. `ROOM_ASSIGNMENT` — assign to room/zone/group with function type
  6. `REVIEW_SAVE` — generates integration record and saves to `integrationDB`
- 8 device types: light, sensor, plug, hvac, irrigation, co2, camera, other
- Session timeout management
- `createWizardHandlers(db)` factory → REST handler functions
- 10 REST endpoints (all wired in `server-foxtrot.js:11617–11626`)

**What it's missing:**
- Frontend UI (backend-only, no HTML/JS wizard screens)
- Real device discovery (currently delegates to driver, most return empty)
- Calibration step

### 4.3 `routes/integrations.js` (383 lines)

**What it provides:**
- Full CRUD REST API:
  - `GET /api/integrations` — list all
  - `GET /api/integrations/:id` — get one
  - `POST /api/integrations` — create record (validates `device_type` + `protocol` required)
  - `PATCH /api/integrations/:id` — update (whitelisted fields: validation, feedback, room_id, zone_id, group_id, function, capabilities, install_context, config)
  - `DELETE /api/integrations/:id` — remove
  - `GET /api/integrations/pending-sync` — records needing Central sync
- `syncIntegrationsToCentral(farmId, centralUrl, apiKey)` — anonymizes via SHA-256 hash, max 50 records per sync, 24h window, marks synced
- `getIntegrationRecordsForSync(farmId)` — export for farm-data sync payload

> **⚠️ R2 — Executive Review Finding: Privacy Model Upgrade Required**  
> The current `hashFarmId()` uses plain SHA-256 of the farm ID. If farm identifiers are guessable (human-readable codes, sequential patterns), unsalted SHA-256 can be reversed via dictionary attack. Per NIST and security best-practice guidance on protecting sensitive identifiers:  
> - **Upgrade to HMAC-SHA-256** using a per-farm secret ("pepper") stored on-farm and never synced to Central  
> - Or use a keyed hash with a system-wide secret managed via environment variable  
> - This prevents Central's device registry from becoming re-identifiable if leaked or correlated  
> - See ticket **V-4** (new) and architecture decision **AD-6** for implementation details

**Record schema:**
```json
{
  "_id": "INT-20260222-ABCD",
  "device_type": "sensor",
  "device_make_model": "Sonoff TH16",
  "protocol": "mqtt",
  "driver_id": "mqtt.generic.v1",
  "driver_version": "1.0.0",
  "config": {},
  "room_id": null,
  "zone_id": null,
  "group_id": null,
  "function": null,
  "capabilities": { "telemetry": ["temp_c", "humidity_pct"], "commands": [] },
  "install_context": { "room_type": "grow_room", "system_type": "indoor_vertical" },
  "validation": { "passed": true, "signal_quality": 0.95, "dropout_rate": 0.02 },
  "feedback": { "rating": "thumbs_up" },
  "created_at": "2026-02-22T10:30:00Z",
  "updated_at": "2026-02-22T10:30:00Z",
  "synced_at": null
}
```

### 4.4 `lib/device-health-tracker.js` (327 lines)

**What it provides:**
- `initHealthTracker(db)` — bootstrap with NeDB
- `createHealthDB(dataDir)` — factory for auto-loading NeDB
- `recordDeviceCheck(deviceId, success, details)` — logs each heath check with timestamp, latency, error, protocol, device type
- Configurable thresholds from `data/device-thresholds.json`:
  - light: 95% uptime / 2 failures for alert
  - sensor: 85% / 5 failures
  - hvac: 95% / 2 failures
  - plug: 90% / 3 failures
  - irrigation: 90% / 3 failures
- Rolling 24-hour uptime percentage computation
- Consecutive failure alert triggering

### 4.5 `greenreach-central/migrations/017_device_integrations.sql` (63 lines)

**Table:** `device_integrations`

| Column | Type | Purpose |
|--------|------|---------|
| `id` | SERIAL PK | Auto-increment |
| `farm_id_hash` | VARCHAR(64) | SHA-256 of farm_id (privacy) |
| `device_type` | VARCHAR(50) | sensor, relay, dimmer, etc. |
| `device_make_model` | VARCHAR(255) | e.g. "Sonoff TH16" |
| `driver_id` | VARCHAR(100) | e.g. "mqtt.generic.v1" |
| `driver_version` | VARCHAR(20) | Semver |
| `protocol` | VARCHAR(50) | mqtt, http, modbus, etc. |
| `capabilities` | JSONB | telemetry + commands |
| `install_context` | JSONB | room_type, system_type, mounting |
| `validation_passed` | BOOLEAN | Yes/no |
| `signal_quality` | DECIMAL(3,2) | 0.00–1.00 |
| `dropout_rate` | DECIMAL(3,2) | 0.00–1.00 |
| `latency_ms` | INTEGER | Avg response ms |
| `grower_rating` | VARCHAR(20) | thumbs_up / thumbs_down |
| `grower_comment` | TEXT | Optional |
| `created_at` | TIMESTAMP | Default NOW() |
| `updated_at` | TIMESTAMP | Default NOW() |
| `record_id` | VARCHAR(100) | Original farm-side ID |
| `synced_at` | TIMESTAMP | When synced |

**Indexes (7):** driver_id, protocol, device_type, created_at, farm_id_hash, validation_passed, (driver_id, driver_version) composite.

> **⚠️ R2 — Executive Review Finding: Idempotent Ingestion Required**  
> The Central ingest API must use `(farm_id_hash, record_id)` as a composite unique key and perform UPSERT (INSERT ... ON CONFLICT UPDATE) to prevent duplicate rows from inflating adoption counts, failure rates, or recommendation quality. Without idempotent ingestion, retried syncs or overlapping sync windows will skew network intelligence. See ticket **V-3** (new) and architecture decision **AD-9**.

### 4.6 Protocol Drivers (3 implemented)

| Driver | File | Lines | Protocol | Auth | Discovery |
|--------|------|-------|----------|------|-----------|
| SwitchBot | `automation/drivers/switchbot-driver.js` | 213 | HTTPS REST API | HMAC-SHA256 (token + secret) | API query to hub |
| Kasa | `automation/drivers/kasa-driver.js` | 184 | Local TCP via `tplink-smarthome-api` | None (local) | UDP broadcast |
| Shelly | `automation/drivers/shelly-driver.js` | 116 | HTTP RPC | None (local) | Manual host config |

**Note:** These 3 drivers are NOT subclasses of `DeviceDriver` base class. They predate the base class and use their own interface (`getDevices()`, `discover()`, vendor-specific methods). SwitchBot and Kasa have dedicated routes in `server-foxtrot.js` (258 + 220 lines). Refactoring these to extend `DeviceDriver` is a future task.

### 4.7 AI Recommendations Pusher (Central)

**File:** `greenreach-central/services/ai-recommendations-pusher.js`

Already queries `device_integrations` table for:
- **Recommended drivers by protocol** (lines 55–90): Filters by success_rate ≥ threshold, builds recommendations like "87% of farms using driver X v2.1 report better stability"
- **Driver version warnings** (lines 117–130): Flags driver versions with failure_rate > 20%, pushes with severity + upgrade path
- Pushes via `network_intelligence.device_integrations` in the 30-minute AI push payload (line 391)

---

## 5. What Has NOT Been Built

These features have zero implementation:

### 5.1 Safety Envelope for Actuators

**Ticket 6.7** — `lib/device-safety-envelope.js`

No application-layer safety wrapper exists. The ESP32 firmware has independent safety logic (`firmware/esp32-empty-tank-safety/`) but it operates at the hardware level, not the software level.

**Risk:** Without a safety envelope, any actuator command (pump, heater, relay) sent via `driver.sendCommand()` would execute without rate limiting, interlock checking, or confirmation gates.

### 5.2 Integration Assistant Agent Skills

**Ticket 6.8** — Addition to `services/ai-agent.js`

The AI agent (1,576 lines) has 13 capability categories (inventory, orders, sales, reports, checklists, monitoring, system, admin, marketing, payroll, deployment, viability, developer) with 67 actions. There is NO `integrations` category. The word "integration" appears once in the entire file (line 1257, inside `deployment.network_topology`).

### 5.3 Driver Manifest Registry

**Ticket 6.2** — `lib/driver-registry.js`, `routes/drivers.js`

While `device-driver.js` includes a basic `DriverRegistry` class, there is:
- No manifest JSON schema
- No manifest files for any driver
- No auto-discovery of drivers on startup
- No `/api/drivers/list` endpoint
- No manifest validation

### 5.4 Full Driver SDK (7–8 methods)

**Ticket 6.1** — Expand `lib/device-driver.js`

Current base class has 5 methods. Plan calls for:
- `validate(device)` — post-install validation
- `healthCheck(device)` — periodic health probe
- `subscribeTelemetry(device, callback)` — event-based data (MQTT subscriptions, WebSocket)

### 5.5 Auto-Discovery Wired into Wizard

**Ticket 6.3** — Connect `lib/device-discovery.js` and `routes/mdns-discovery.js` into `lib/device-wizard.js`

The discovery modules exist (303 + 198 lines) but are standalone. The wizard's `DEVICE_DISCOVERY` step calls `driver.discover()` which returns empty arrays for most protocols because the actual discovery logic lives in separate modules.

### 5.6 Calibration Workflow

**Ticket 6.4** — `lib/calibration-manager.js`, wizard step extension

Calibration databases exist (`data/sensor-calibrations.db`, `data/pump-calibrations.db`) and ESP32 has `calibrate_sensors.sh`, but there is no application-layer calibration manager and no calibration step in the wizard.

### 5.7 Integration Pack Library

**Ticket 6.5** — Central-side versioned "known-good" driver + config templates

No code, no schema, no concept of distributable integration packs.

### 5.8 Network Integration Curator Agent

**Ticket 6.6** — Central-side agent for analyzing integration records

No code. Would be a new scheduled job at Central.

---

## 6. Gap Analysis — Proposal vs Codebase

| Feature | Built | Gaps | Completion % |
|---------|-------|------|-------------|
| Integration Records (create, store, sync) | Full CRUD + sync + Central ingest | None | **100%** |
| Central DB Schema | Migration file exists | May not be applied to live RDS | **95%** |
| Device Driver Base Class | 5 methods + registry | Missing validate, healthCheck, subscribeTelemetry | **70%** |
| Protocol Drivers | 3 drivers (SwitchBot, Kasa, Shelly) | Not subclasses of DeviceDriver; no manifests | **60%** |
| Add Device Wizard | 6-step backend, 10 endpoints | No frontend UI; discovery not wired | **80%** |
| Device Health Tracking | NeDB-backed, thresholds, alerts | Not integrated with Central analytics dashboard UI | **85%** |
| Network Analytics (Central) | Aggregation queries, admin-only | Dashboard UI not built | **90%** |
| AI Push with Device Intelligence | Recommendations + warnings | Functional | **100%** |
| Safety Envelope | Code template in docs only | No implementation | **0%** |
| AI Agent Skills | Agent exists with 13 categories | No integrations category at all | **0%** |
| Driver Manifests + Registry | Basic DriverRegistry exists | No manifests, no API endpoint, no auto-discovery | **15%** |
| Integration Pack Library | None | Entire feature missing | **0%** |
| Curator Agent | None | Entire feature missing | **0%** |
| Calibration Workflow | DBs exist | No manager, no wizard step | **10%** |
| Discovery ↔ Wizard Connection | Both exist separately | Not wired together | **40%** |

**Overall Integration Assistant Completion: ~55%**

---

## 7. Proposed Work — Detailed Tickets

### Priority 0: Verification (Pre-Requisite)

#### V-1: Verify Central Migration Applied

**Problem:** Migration `017_device_integrations.sql` exists as a file but may not be applied to the live RDS instance (`foxtrot-test.c8rq44ew6swb.us-east-1.rds.amazonaws.com`, database `foxtrot_prod`).

**Action:**
1. Connect to RDS: `psql -h foxtrot-test.c8rq44ew6swb.us-east-1.rds.amazonaws.com -U foxtrot -d foxtrot_prod`
2. Check: `SELECT table_name FROM information_schema.tables WHERE table_name = 'device_integrations';`
3. If missing, apply: `\i greenreach-central/migrations/017_device_integrations.sql`

**Effort:** 15 minutes  
**Risk:** Low  
**Dependency:** Blocks all Central-side analytics

#### V-2: Verify Integration Sync Is Flowing

**Problem:** `syncIntegrationsToCentral()` is implemented but needs to be called from the 5-minute sync job. Need to verify it's wired in `server-foxtrot.js`'s `syncFarmData()`.

**Action:**
1. Check `syncFarmData()` for call to `getIntegrationRecordsForSync()` or `syncIntegrationsToCentral()`
2. If missing, add `integration_records: await getIntegrationRecordsForSync(farmId)` to sync payload
3. Verify on Central side that `POST /api/sync/device-integrations` endpoint exists

**Effort:** 30 minutes  
**Risk:** Low  
**Dependency:** Blocks network intelligence data flow

#### V-3: Add Idempotent UPSERT to Central Ingest *(R2 — NEW)*

**Problem:** Without idempotent ingestion, retried syncs or overlapping 5-minute sync windows can create duplicate rows in `device_integrations`, skewing adoption counts, failure rates, and recommendation quality in the network intelligence layer.

**Action:**
1. Add a UNIQUE constraint on `(farm_id_hash, record_id)` to `device_integrations` table
2. Change the Central ingest endpoint to use `INSERT ... ON CONFLICT (farm_id_hash, record_id) DO UPDATE SET ...` (UPSERT)
3. On the farm side, always include `record_id` (the NeDB `_id`) in sync payloads
4. Add `sync_version` or `updated_at` comparison to prevent stale updates overwriting newer data

**SQL migration addition:**
```sql
-- Add to 017 or create 018:
ALTER TABLE device_integrations 
  ADD CONSTRAINT uq_farm_record UNIQUE (farm_id_hash, record_id);
```

**Central ingest pattern (R3 refined — uses farm-provided `record_updated_at`):**

> **R3 — Farm-Provided Timestamps for Monotonic Sync (AD-14)**  
> The R2 UPSERT guard compared Central's `updated_at` column against itself (`EXCLUDED.updated_at`), but `updated_at = NOW()` in the SET clause means the guard always becomes `< NOW()`, which is trivially true. The correct approach uses the **farm-provided** `record_updated_at` timestamp — the actual time the record was modified on the farm — as the monotonic guard.  
>
> This ensures:  
> - Retried syncs with identical payloads are no-ops (same `record_updated_at` = no update)  
> - Out-of-order syncs don't overwrite newer data with older data  
> - Central's own `updated_at` reflects when Central last processed the record, not when it changed on the farm

```sql
-- Migration 018: Add record_updated_at column
ALTER TABLE device_integrations 
  ADD COLUMN record_updated_at TIMESTAMP;

-- Backfill existing rows
UPDATE device_integrations SET record_updated_at = updated_at WHERE record_updated_at IS NULL;

ALTER TABLE device_integrations 
  ALTER COLUMN record_updated_at SET NOT NULL;
```

```sql
INSERT INTO device_integrations (farm_id_hash, record_id, device_type, record_updated_at, ...)
VALUES ($1, $2, $3, $4, ...)
ON CONFLICT (farm_id_hash, record_id) DO UPDATE SET
  device_type = EXCLUDED.device_type,
  validation_passed = EXCLUDED.validation_passed,
  signal_quality = EXCLUDED.signal_quality,
  record_updated_at = EXCLUDED.record_updated_at,
  updated_at = NOW()           -- Central's processing timestamp
WHERE device_integrations.record_updated_at < EXCLUDED.record_updated_at;
```

> **Note (R3):** The hash algorithm change from SHA-256 to HMAC (V-4) will produce different `farm_id_hash` values for existing records. This is a **data migration event**: all farms must re-sync their full integration records after the HMAC upgrade. Plan this as a coordinated cutover, not a rolling update.

**Effort:** 45 minutes  
**Risk:** Low  
**Dependency:** Requires V-1 (migration applied first)

#### V-4: Upgrade Farm ID Pseudonymization to HMAC *(R2 — NEW)*

**Problem:** Current `hashFarmId()` uses `SHA-256(farmId)`. If farm identifiers are human-readable codes (e.g., `FARM-MLTP9LVH-B0B85039`), they can be reversed via dictionary attack against the hash. This is a privacy risk if the Central database is compromised.

**Action:**
1. Generate a random 32-byte secret per farm on first setup, store in `data/farm-pepper.key` (never synced)
2. Replace `crypto.createHash('sha256').update(farmId)` with `crypto.createHmac('sha256', pepper).update(farmId)`
3. The pepper stays on-farm; Central only sees the HMAC pseudonym
4. Add `farm-pepper.key` to `.gitignore` and sync exclusion list
5. Handle "right-to-delete" / "farm leaves network": Central can tombstone all records matching a farm_id_hash without needing to reverse it

**Code change in `routes/integrations.js`:**
```javascript
// BEFORE (current):
function hashFarmId(farmId) {
  return crypto.createHash('sha256').update(farmId).digest('hex');
}

// AFTER (R2 upgrade):
import { readFileSync, writeFileSync, existsSync } from 'fs';

function getFarmPepper() {
  const pepperPath = path.join(process.cwd(), 'data', 'farm-pepper.key');
  if (!existsSync(pepperPath)) {
    const pepper = crypto.randomBytes(32).toString('hex');
    writeFileSync(pepperPath, pepper, { mode: 0o600 });
    return pepper;
  }
  return readFileSync(pepperPath, 'utf8').trim();
}

function hashFarmId(farmId) {
  const pepper = getFarmPepper();
  return crypto.createHmac('sha256', pepper).update(farmId).digest('hex');
}
```

**Effort:** 30 minutes  
**Risk:** Low — drop-in replacement; existing Central records will get new hash values on first sync after upgrade (handled by UPSERT from V-3, or a one-time re-sync)  
**Note:** If farms already have synced records with old SHA-256 hashes, a migration strategy is needed: either re-sync all records (simple) or run a one-time hash migration on Central using farm cooperation.

---

### Priority 1: Safety (Must-Have Before Actuator Control)

#### T-1: Safety Envelope for Actuators *(R2 — Upgraded to Control-System Boundary)*

**Ticket:** 6.7  
**Priority:** CRITICAL — must ship before any actuator command routing  
**File to create:** `lib/device-safety-envelope.js`

> **R2 Executive Review Upgrade:** The safety envelope must be treated as a control-system safety boundary, not just a helper function. Per ICS security guidance (NIST SP 800-82, OWASP IoT Top 10), it must be **stateful** (survive restarts), **auditable** (log every decision), and **centrally enforced** (impossible to bypass). Even though farms are not SCADA plants, actuator risks (pumps, heaters, cooling, relays) are analogous: equipment damage, crop loss, and physical harm from conflicting or runaway actuation.

**Three Required Properties (R2 additions):**

**1. Statefulness with Persistence**  
Min-off-time, max-cycles-per-hour, and max-on-time calculations require a trustworthy state store that survives process restarts. State must record the last N command events per device.

> **R3 — Fail-Safe Posture for Unknown State (AD-12)**  
> The most important decision is what happens when envelope state is missing, stale, or inconsistent. Per OT security guidance (NIST SP 800-82r3), control environments must prioritize continuity and safe operations under partial failure.  
> 
> **Policy:** Unknown state ⇒ **fail-closed** for high-risk actuators. Specifically:  
> - If no state record exists for a device: treat as "in cooldown" and deny actuation until state is established via a health check or telemetry refresh  
> - If state record is older than `staleThreshold` (configurable, default 2 hours): treat `currentState` as `unknown` and deny high-risk commands (pump, heater, CO₂ injection) until a fresh status check confirms device state  
> - Sensors and indicators (`safetyCategory: sensor | indicator`) may proceed with a logged warning  
> - `actuator-low` devices (plugs, dimmers) may proceed with confirmation required  
> - `actuator-high` devices (pumps, heaters, CO₂) are blocked until state is refreshed  
>
> ```javascript
> // In executeCommand(), after loadDeviceState():
> if (!currentState || currentState === null) {
>   return {
>     allowed: false,
>     reason: 'No safety state on record for this device. Run health check first.',
>     auditId,
>     remediation: 'GET /api/integrations/{deviceId}/health-check'
>   };
> }
> 
> const staleThreshold = config.staleThresholdMs || 2 * 60 * 60 * 1000; // 2 hours
> const stateAge = Date.now() - new Date(currentState.lastCommandAt).getTime();
> if (stateAge > staleThreshold) {
>   const category = getSafetyCategory(device);
>   if (category === 'actuator-high') {
>     return {
>       allowed: false,
>       reason: `Safety state is ${Math.round(stateAge/60000)} minutes old. Refresh required for actuator-high devices.`,
>       auditId,
>       remediation: 'Run device health check to refresh state'
>     };
>   }
>   // actuator-low: proceed but require confirmation
>   // sensor/indicator: proceed with warning logged
> }
> ```

```javascript
// State store: NeDB file at data/safety-envelope-state.db
// Schema per record:
{
  deviceId: 'INT-20260222-ABCD',
  deviceType: 'pump',
  lastCommandAt: '2026-02-22T10:30:00Z',
  lastCommand: 'turnOn',
  lastOffAt: '2026-02-22T10:25:00Z',
  cyclesInWindow: 3,          // Rolling 1-hour window
  windowStart: '2026-02-22T09:30:00Z',
  currentState: 'on',         // on | off | unknown
  continuousOnSince: '2026-02-22T10:30:00Z'
}
```

**2. Centralized Enforcement (Mandatory Command Gateway)**  
All actuator commands — from wizard, UI, automation rules, AI agent, and direct API — must pass through a **single mandatory gateway function**. Direct `driver.sendCommand()` calls must be forbidden via code review and lint rules.

```javascript
// lib/device-safety-envelope.js — THE gateway

/**
 * The ONLY function authorized to issue actuator commands.
 * All call sites must use this instead of driver.sendCommand() directly.
 *
 * @param {Object} device - Integration record with deviceId, device_type
 * @param {string} command - Command name (turnOn, turnOff, setLevel, etc.)
 * @param {Object} args - Command arguments
 * @param {Object} context - Caller context for audit
 * @param {string} context.source - 'wizard' | 'agent' | 'automation' | 'api' | 'ui'
 * @param {string} context.userId - Who initiated (user ID or 'system')
 * @param {string} context.sessionId - Session/request ID for traceability
 * @param {boolean} [context.confirmed] - Human confirmation flag
 * @returns {Promise<{allowed: boolean, executed?: boolean, result?: any, reason?: string, auditId: string}>}
 */
export async function executeCommand(device, command, args, context) {
  const auditId = generateAuditId();
  const currentState = await loadDeviceState(device.deviceId);
  
  // Step 1: Validate against safety limits
  const validation = validateCommand(device, command, args, currentState);
  
  // Step 2: Log the decision (allow or deny) — ALWAYS
  await recordDecision(auditId, device, command, args, context, currentState, validation);
  
  if (!validation.allowed) {
    return { allowed: false, reason: validation.reason, auditId };
  }
  
  if (validation.requires_confirmation && !context.confirmed) {
    return { 
      allowed: false, 
      requires_confirmation: true,
      reason: validation.reason || 'Human confirmation required for this actuator command',
      auditId
    };
  }
  
  // Step 3: Execute via driver
  const driver = driverRegistry.getDriver(device.protocol);
  const result = await driver.sendCommand(device.deviceId, command, args);
  
  // Step 4: Update state
  await updateDeviceState(device.deviceId, command, result);
  
  // Step 5: Log execution outcome
  await recordExecution(auditId, result);
  
  return { allowed: true, executed: true, result, auditId };
}
```

**3. Auditability and Explainability**  
Every deny/allow decision records: who requested, what was requested, what state was evaluated, and why it was allowed/blocked. This aligns with the project's "scientific instrument" philosophy — every meaningful action becomes data.

```javascript
// Audit record schema (NeDB: data/safety-audit-log.db)
{
  auditId: 'SAF-20260222-103000-A1B2',
  timestamp: '2026-02-22T10:30:00Z',
  deviceId: 'INT-20260222-ABCD',
  deviceType: 'pump',
  command: 'turnOn',
  args: { duration: 120 },
  source: 'automation',         // wizard | agent | automation | api | ui
  userId: 'system',
  sessionId: 'auto-rule-42',
  stateAtEvaluation: {
    currentState: 'off',
    lastOffAt: '2026-02-22T10:25:00Z',
    cyclesInWindow: 3,
    continuousOnSince: null
  },
  decision: 'allowed',          // allowed | denied | pending_confirmation
  reason: null,                 // Populated on deny
  checksEvaluated: [
    { check: 'interlock:no_simultaneous_pumps', passed: true },
    { check: 'timing:min_off_time_seconds', passed: true, value: 300, required: 120 },
    { check: 'rate:max_cycles_per_hour', passed: true, value: 3, limit: 10 },
    { check: 'confirmation', passed: true, confirmed: true }
  ],
  executionResult: { ok: true },  // Populated after execution
  executionAt: '2026-02-22T10:30:01Z'
}
```

**Confirmation Gating (R2 Upgrade):**  
Move from simple `args.confirmed` boolean to a signed, traceable approval:

```javascript
// Confirmation must include traceable context, not just a boolean flag
const validConfirmation = {
  confirmed: true,
  confirmedBy: 'user-abc123',       // Authenticated user ID
  confirmedAt: '2026-02-22T10:29:55Z',
  sessionId: 'sess-xyz789',        // Active session ID
  maxAge: 30000                    // Confirmation valid for 30 seconds
};

// validateConfirmation() checks:
// 1. confirmedBy matches an authenticated user (not anonymous)
// 2. confirmedAt is within maxAge of current time
// 3. sessionId matches a valid active session
```

**Safety Limits (unchanged from R1):**

```javascript
export const SAFETY_LIMITS = {
  relay: {
    max_on_time_seconds: 3600,      // 1 hour max continuous
    min_off_time_seconds: 60,       // 1 min cooldown
    max_cycles_per_hour: 20,        // Prevent rapid cycling
    requires_confirmation: true      // Human must approve
  },
  dimmer: {
    max_change_per_second: 10,      // 10% per second max ramp
    min_level: 0,
    max_level: 100,
    requires_confirmation: false     // Progressive changes OK
  },
  pump: {
    max_on_time_seconds: 300,       // 5 min max
    min_off_time_seconds: 120,      // 2 min cooldown
    max_cycles_per_hour: 10,
    requires_confirmation: true,
    interlocks: ["no_simultaneous_pumps"]
  },
  heater: {
    max_on_time_seconds: 1800,      // 30 min max
    min_off_time_seconds: 300,      // 5 min cooldown
    max_cycles_per_hour: 6,
    requires_confirmation: true,
    interlocks: ["no_heater_with_cooling"]
  },
  cooling: {
    max_on_time_seconds: 3600,      // 1 hour max
    min_off_time_seconds: 120,      // 2 min cooldown
    max_cycles_per_hour: 10,
    requires_confirmation: true,
    interlocks: ["no_heater_with_cooling"]
  }
};
```

**Interlock Model (R2 Upgrade, R3 Refined):**  
Interlocks must reference cross-device state, not just the target device. The envelope queries all active devices to check for conflicts.

> **R3 — Stale/Unknown State in Interlocks (AD-13)**  
> Cross-device interlocks depend on "all device states," but this is not a perfect snapshot. Devices may be offline, delayed, or have stale telemetry. The interlock evaluation must explicitly handle unknown/stale states rather than assuming "if not currently on, then safe."  
>
> **Policy:** If any device involved in an interlock check has `currentState === 'unknown'` or state older than `staleThreshold`:  
> - Treat as **potentially active** for "no simultaneous" interlocks (conservative: assume the other device might be on)  
> - Log a warning and include it in the audit record  
> - This prevents the scenario where intermittent telemetry causes a false "safe" reading

```javascript
// Cross-device interlock evaluation (R3: handles stale/unknown states)
async function checkInterlock(interlock, device, command, allDeviceStates, staleThreshold) {
  switch (interlock) {
    case 'no_simultaneous_pumps': {
      // Check if ANY other pump is currently on OR has unknown/stale state
      const otherPumps = allDeviceStates.filter(
        d => d.deviceType === 'pump' && d.deviceId !== device.deviceId
      );
      const activePumps = otherPumps.filter(d => d.currentState === 'on');
      const stalePumps = otherPumps.filter(d => 
        d.currentState === 'unknown' || 
        (Date.now() - new Date(d.lastCommandAt).getTime()) > staleThreshold
      );
      
      if (command === 'turnOn') {
        if (activePumps.length > 0) {
          return `Blocked: pump ${activePumps[0].deviceId} is already running. Only one pump may operate at a time.`;
        }
        if (stalePumps.length > 0) {
          return `Blocked: pump ${stalePumps[0].deviceId} has unknown/stale state (last update: ${stalePumps[0].lastCommandAt}). Cannot confirm it is off. Refresh device state first.`;
        }
      }
      return null;
    }

    case 'no_heater_with_cooling': {
      const conflictType = device.device_type === 'heater' ? 'cooling' : 'heater';
      const conflictDevices = allDeviceStates.filter(
        d => d.deviceType === conflictType
      );
      const activeConflicts = conflictDevices.filter(d => d.currentState === 'on');
      const staleConflicts = conflictDevices.filter(d =>
        d.currentState === 'unknown' ||
        (Date.now() - new Date(d.lastCommandAt).getTime()) > staleThreshold
      );

      if (command === 'turnOn') {
        if (activeConflicts.length > 0) {
          return `Blocked: ${conflictType} device ${activeConflicts[0].deviceId} is active. Cannot run heater and cooling simultaneously.`;
        }
        if (staleConflicts.length > 0) {
          return `Blocked: ${conflictType} device ${staleConflicts[0].deviceId} has unknown/stale state. Cannot confirm it is off. Refresh device state first.`;
        }
      }
      return null;
    }

    default:
      // R3: Unknown interlock type fails CLOSED (not open)
      console.error(`Unknown interlock type: ${interlock}. Failing closed.`);
      return `Blocked: unknown interlock type '${interlock}'. Cannot evaluate safety.`;
  }
}
```

**Scope Decision Required (R2, R3 Refined):**  
Should the safety envelope also govern dimmable lighting and CO₂ injection?

> **R3 — CO₂ Threshold Correction (Occupational Standards)**  
> The R2 statement that CO₂ "above ~1500ppm is hazardous to humans" overstates the risk. Accurate thresholds based on occupational and indoor air quality standards:  
>
> | Threshold | Level | Source | Purpose |
> |-----------|-------|--------|---------|
> | **1,000 ppm** | IAQ comfort / ventilation indicator | Health Canada Indoor Air Quality Guidelines | Indicates inadequate ventilation; minimize risks from CO₂ and other indoor pollutants. 24-hour average residential guideline. |
> | **5,000 ppm** | Occupational exposure limit (TWA) | OSHA PEL / NIOSH REL | 8-hour time-weighted average. Safe occupational limit for workplace exposure. |
> | **30,000 ppm** | Short-term exposure limit (STEL) | NIOSH STEL | 15-minute short-term limit. Emergency shutdown should trigger well below this. |
>
> **Recommended safety envelope for CO₂ injection (`actuator-high`):**
> ```javascript
> co2_injection: {
>   safety_category: 'actuator-high',
>   thresholds: {
>     comfort_warning: 1000,        // ppm — warn and recommend ventilation check (IAQ)
>     plant_optimization_max: 1500,  // ppm — typical enrichment ceiling for crops
>     hard_cutoff: 5000,            // ppm — aligned to OSHA/NIOSH TWA; auto-shutdown
>     emergency_threshold: 15000    // ppm — well below NIOSH STEL; emergency halt + alert
>   },
>   requires_confirmation: true,
>   interlocks: ['ventilation_active'],  // CO₂ injection requires ventilation fan running
>   max_injection_time_seconds: 600,     // 10 min max continuous
>   min_off_time_seconds: 300,           // 5 min cooldown
>   max_cycles_per_hour: 6
> }
> ```
> This framing separates **plant-optimization ranges** (up to 1,500 ppm) from **human-occupancy safety constraints** (5,000 ppm hard cutoff) and gives the AI agent a clean ruleset. It avoids overstating hazard at 1,500 ppm while still protecting human safety.

- High-intensity lighting in sealed spaces creates heat accumulation but is not directly life-threatening  
- **Recommended:** Include CO₂ as `actuator-high` with tiered thresholds above; defer lighting to Phase 2  
- See Decision Point #3 in Section 14

**Integration point:** `executeCommand()` is the ONLY path to actuator control. The wizard, agent, automation engine, and any `server-foxtrot.js` route handler must call `executeCommand()` instead of `driver.sendCommand()` directly.

**Effort:** L (2–3 days) *(upgraded from M due to statefulness + audit log)*  
**Tests:** Unit tests for each safety limit, cross-device interlock test, confirmation gate test, state persistence across restart test, audit log completeness test  
**Exit criteria:** No actuator command can bypass the safety envelope; every command decision is auditable

---

### Priority 2: Wire Existing Code Together

#### T-2: Connect Discovery Modules to Wizard

**Ticket:** 6.3 (partial)  
**Files to modify:** `lib/device-wizard.js`  
**Files to import:** `lib/device-discovery.js`, `routes/mdns-discovery.js`

**Current state:** Wizard step 3 (`DEVICE_DISCOVERY`) calls `this.driver.discover()` which delegates to the protocol driver. SwitchBot driver queries its API (works). Kasa uses `tplink-smarthome-api` (works). MQTT/Tasmota/Modbus/Generic return empty arrays.

**Proposed change:**
- In `DeviceWizard.discoverDevices()`, after calling `driver.discover()`, also call `device-discovery.js` scan functions for the selected protocol
- For `mdns` and `network` discovery methods, use `mdns-discovery.js` to find devices on the local network
- Merge results, deduplicate by device ID

> **R2 — Discovery Hardening Requirements (Executive Review)**  
> mDNS is designed for local-link DNS-like operations via multicast, but real networks sometimes violate "local only" assumptions. CERT has documented cases of mDNS being observable beyond the local segment. The following constraints must be applied:
>
> 1. **Strict timeouts:** Discovery scans must have a hard timeout (max 15 seconds) to prevent network flooding
> 2. **Result caps:** Maximum 50 discovered devices per scan to prevent UI/memory overload from noisy networks
> 3. **Service filtering:** Only discover device types matching the selected protocol (e.g., `_switchbot._tcp` for SwitchBot, `_http._tcp` for Shelly)
> 4. **Read-only isolation:** Discovery must NEVER be reachable from actuator control paths; it is strictly informational
> 5. **Rate limiting:** Maximum 1 discovery scan per wizard session per 30 seconds to prevent scan abuse
> 6. **RBAC:** Discovery endpoints must require authenticated session (existing auth middleware suffices)
> 7. **Graceful degradation:** When multicast is blocked (VLANs, Wi-Fi isolation), wizard should fall back to manual device entry rather than hanging
> 8. **No off-network exposure:** Discovery endpoints must only bind to localhost/LAN; verify they are not accessible via Central proxy without explicit authorization

```javascript
// In DeviceWizard.discoverDevices():
import { scanForDevices } from '../lib/device-discovery.js';

// After driver.discover():
if (this.state.protocol.discoveryMethod === 'network') {
  const networkDevices = await scanForDevices({ 
    protocol: this.state.protocol.id, 
    timeout: 10000 
  });
  // Merge with driver-discovered devices, deduplicate by deviceId
  const existingIds = new Set(this.state.discoveredDevices.map(d => d.deviceId));
  for (const dev of networkDevices) {
    if (!existingIds.has(dev.deviceId)) {
      this.state.discoveredDevices.push(dev);
    }
  }
}
```

**Effort:** S (half day)  
**Risk:** Low — additive, doesn't change existing behavior

#### T-3: Wizard Frontend UI

**Files to create:** `public/views/add-device.html`, `public/js/device-wizard-ui.js`

**Current state:** 10 REST endpoints exist with full backend logic. No frontend.

**Proposed UI (6 screens following Setup Wizard pattern):**

| Screen | Content | API Call |
|--------|---------|----------|
| 1. Protocol Select | 6 protocol cards with icons (🔄 SwitchBot, 💡 Kasa, 📡 MQTT, ⚡ Tasmota, 🔌 Modbus, 📦 Generic) | `POST /api/device-wizard/start`, `POST .../protocol` |
| 2. Connection Config | Dynamic form fields based on protocol (e.g., MQTT: broker URL, topic, client ID) | `POST .../config` |
| 3. Device Discovery | Scanning animation, discovered device list with checkboxes | `POST .../discover` |
| 4. Connectivity Test | Signal strength gauge, latency display, pass/fail badge | Auto-runs after device selection |
| 5. Room Assignment | Dropdown for room, zone, group, function type | `POST .../assign-room` |
| 6. Review & Save | Summary card with all details, Save / Back buttons | `POST .../save` |

**Pattern to follow:** `routes/setup-wizard.js` + setup wizard modal in `public/farm-admin.js` (uses step-based modal with progress indicator)

**Effort:** M (2–3 days)  
**Risk:** Low

---

### Priority 3: AI Agent Integration Skills

#### T-4: Add `integrations` Capability Category to AI Agent

**File to modify:** `services/ai-agent.js`

**Proposed addition to `SYSTEM_CAPABILITIES`:**

```javascript
// Add after 'developer' capability (line ~130 in ai-agent.js):
integrations: {
  description: 'Device integrations: list devices, check health, start wizard, driver info',
  actions: [
    'list_devices',       // List all integration records
    'device_health',      // Check health/uptime of a specific device
    'start_wizard',       // Return wizard URL/instructions
    'driver_info',        // Get info about available drivers
    'integration_status'  // Overall integration health summary
  ]
}
```

**Proposed `executeIntegrationsAction()` function:**

```javascript
async function executeIntegrationsAction(action, params, context) {
  const port = process.env.PORT || 8091;

  switch (action) {
    case 'list_devices': {
      const resp = await fetch(`http://localhost:${port}/api/integrations`);
      const data = await resp.json();
      return {
        success: true,
        message: `You have ${data.count || 0} device integration(s)`,
        data: {
          count: data.count,
          integrations: (data.integrations || []).map(i => ({
            id: i._id,
            type: i.device_type,
            model: i.device_make_model,
            protocol: i.protocol,
            driver: i.driver_id,
            room: i.room_id,
            validated: i.validation?.passed
          }))
        }
      };
    }

    case 'device_health': {
      const deviceId = params.deviceId || params.device_id;
      if (!deviceId) {
        return { success: false, message: 'Please specify a device ID' };
      }
      const resp = await fetch(`http://localhost:${port}/api/integrations/${deviceId}`);
      const data = await resp.json();
      if (!data.ok) {
        return { success: false, message: `Device ${deviceId} not found` };
      }
      const i = data.integration;
      return {
        success: true,
        message: `${i.device_make_model || 'Device'}: ${i.validation?.passed ? 'Healthy' : 'Issues detected'}`,
        data: {
          model: i.device_make_model,
          protocol: i.protocol,
          signal_quality: i.validation?.signal_quality,
          dropout_rate: i.validation?.dropout_rate,
          validated: i.validation?.passed,
          last_updated: i.updated_at
        }
      };
    }

    case 'start_wizard': {
      return {
        success: true,
        message: 'To add a new device, open the Add Device Wizard',
        data: {
          wizard_url: '/views/add-device.html',
          api_start: 'POST /api/device-wizard/start',
          supported_protocols: ['SwitchBot', 'Kasa', 'MQTT', 'Tasmota', 'Modbus', 'Generic']
        }
      };
    }

    case 'driver_info': {
      return {
        success: true,
        message: '3 protocol drivers available',
        data: {
          drivers: [
            { id: 'switchbot', name: 'SwitchBot', protocol: 'https', auth: 'HMAC-SHA256' },
            { id: 'kasa', name: 'TP-Link Kasa', protocol: 'local TCP', auth: 'none' },
            { id: 'shelly', name: 'Shelly', protocol: 'HTTP RPC', auth: 'none' }
          ]
        }
      };
    }

    case 'integration_status': {
      const resp = await fetch(`http://localhost:${port}/api/integrations`);
      const data = await resp.json();
      const integrations = data.integrations || [];
      const validated = integrations.filter(i => i.validation?.passed).length;
      const protocols = [...new Set(integrations.map(i => i.protocol))];
      return {
        success: true,
        message: `${integrations.length} device(s), ${validated} validated, ${protocols.length} protocol(s)`,
        data: {
          total: integrations.length,
          validated,
          protocols,
          by_type: Object.entries(
            integrations.reduce((acc, i) => { acc[i.device_type] = (acc[i.device_type] || 0) + 1; return acc; }, {})
          ).map(([type, count]) => ({ type, count }))
        }
      };
    }

    default:
      return { success: false, message: `Unknown integration action: ${action}` };
  }
}
```

**Changes required:**
1. Add `integrations` to `SYSTEM_CAPABILITIES` object (~line 130)
2. Add `case 'integrations':` to `executeAction()` switch statement (~line 305)
3. Add `executeIntegrationsAction()` function (~100 lines)
4. Add permissions to `data/agent-permissions.json`

**Agent permission entry:**
```json
{
  "integrations": {
    "list_devices": { "tier": "auto" },
    "device_health": { "tier": "auto" },
    "start_wizard": { "tier": "auto" },
    "driver_info": { "tier": "auto" },
    "integration_status": { "tier": "auto" }
  }
}
```

All integration read actions are `auto` tier — no confirmation needed for read-only operations.

**Effort:** S (half day)  
**Risk:** Low — read-only actions, follows existing pattern exactly

---

### Priority 4: Driver Manifest System

#### T-5: Driver Manifest Schema *(R2 — Upgraded: Draft 2020-12, Supply-Chain Governance)*

**File to create:** `data/driver-manifest.schema.json`

> **R2 Executive Review Upgrades:**  
> 1. **JSON Schema Draft 2020-12** (current standard) instead of Draft-07. Use AJV with 2020-12 support for validation.  
> 2. **`additionalProperties: false`** at all levels for schema hardening — manifests must not silently accept unexpected fields that might later be interpreted in unsafe ways.  
> 3. **`entryPoint` is a security boundary** — once the system loads executable code based on manifest contents, this becomes a supply-chain and permissioning problem. Require an allowlist, signature verification, or path-prefix restrictions.  
> 4. **`schema_version` field** — manifests must declare which schema version they conform to, enabling forward-compatible evolution.  
> 5. **`security_capabilities` section** — per NIST IR 8259A IoT device cybersecurity baseline, manifests should declare identity, auth, update path, logging, and telemetry integrity capabilities.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://lightengine.io/schemas/driver-manifest.json",
  "type": "object",
  "required": ["schema_version", "id", "name", "version", "protocol", "entryPoint"],
  "additionalProperties": false,
  "properties": {
    "schema_version": { "type": "string", "const": "1.0.0", "description": "Manifest schema version" },
    "id": { "type": "string", "pattern": "^[a-z0-9.-]+$", "description": "Driver ID, e.g. switchbot.plug.v1" },
    "name": { "type": "string" },
    "version": { "type": "string", "pattern": "^\\d+\\.\\d+\\.\\d+$" },
    "protocol": { "type": "string", "enum": ["switchbot", "kasa", "shelly", "mqtt", "tasmota", "modbus", "zigbee", "ble", "generic"] },
    "description": { "type": "string" },
    "author": { "type": "string" },
    "entryPoint": {
      "type": "string",
      "pattern": "^\\.\\/[a-zA-Z0-9_-]+-driver\\.js$",
      "description": "Relative path to driver JS file. MUST match pattern ./{name}-driver.js and reside in automation/drivers/. This is a SECURITY BOUNDARY — see AD-8."
    },
    "deviceTypes": { "type": "array", "items": { "type": "string" } },
    "capabilities": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "telemetry": { "type": "array", "items": { "type": "string" } },
        "commands": { "type": "array", "items": { "type": "string" } },
        "supportsDiscovery": { "type": "boolean" },
        "supportsGroups": { "type": "boolean" }
      }
    },
    "connection": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "type": { "type": "string", "enum": ["cloud-api", "local-network", "serial", "ble"] },
        "requiresAuth": { "type": "boolean" },
        "configFields": { "type": "array", "items": { "type": "string" } }
      }
    },
    "safety": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "isActuator": { "type": "boolean" },
        "requiresSafetyEnvelope": { "type": "boolean" },
        "maxPowerWatts": { "type": "number" },
        "safetyCategory": { "type": "string", "enum": ["sensor", "indicator", "actuator-low", "actuator-high"], "description": "Determines which safety limits apply" }
      }
    },
    "security_capabilities": {
      "type": "object",
      "additionalProperties": false,
      "description": "Per NIST IR 8259A IoT device cybersecurity baseline",
      "properties": {
        "device_identity": { "type": "boolean", "description": "Device has unique, verifiable identity" },
        "auth_method": { "type": "string", "enum": ["none", "token", "hmac", "tls-cert", "password"], "description": "Authentication mechanism" },
        "encrypted_transport": { "type": "boolean", "description": "Communication uses TLS/encryption" },
        "firmware_update_path": { "type": "string", "enum": ["ota", "manual", "vendor-cloud", "none"], "description": "How firmware is updated" },
        "logging_supported": { "type": "boolean", "description": "Device supports event/access logging" },
        "telemetry_integrity": { "type": "string", "enum": ["none", "checksum", "signed"], "description": "Telemetry data integrity mechanism" }
      }
    },
    "compatibility": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "minDriverVersion": { "type": "string" },
        "platforms": { "type": "array", "items": { "type": "string" } }
      }
    }
  }
}
```

**EntryPoint Governance (R2 — Supply-Chain Boundary, R3 Refined):**

The driver registry loader must enforce:
1. **Path allowlist:** `entryPoint` must resolve to a file within `automation/drivers/` — no `../` traversal, no absolute paths
2. **Filename convention:** Must match `*-driver.js` pattern
3. **Integrity verification (R3 — Environment-Controlled Posture):** On startup, compute SHA-256 hash of each driver file and compare against a known-good manifest (`data/driver-checksums.json`).
   - **Production:** Checksum mismatch → **block driver loading** and alert. Fail closed.
   - **Development:** Checksum mismatch → **warn** in console/log. Allow loading to continue. Developers frequently modify driver files; blocking would impede workflow.
   - Controlled via `NODE_ENV` or explicit `DRIVER_CHECKSUM_ENFORCE=strict|warn` environment variable.
4. **No remote loading:** Manifests with URLs as `entryPoint` must be rejected
5. **Future (R3 — SLSA Provenance):** Before implementing code-signing for integration packs (6.5), adopt a pre-signing discipline: generate SLSA provenance attestations for driver artifacts during CI/CD. This establishes a verifiable build-to-deploy chain per NIST SSDF practices. Signing with Ed25519 keys (RFC 8032) is recommended for its simplicity and performance.

> **R3 — Ajv Dialect Isolation Requirement (AD-15)**  
> JSON Schema Draft 2020-12 is **not backward-compatible** with Draft-07 or earlier. Specifically, vocabulary handling, `$dynamicRef`/`$dynamicAnchor`, and output format differ. If the codebase uses Ajv for other validation tasks under an earlier draft, the manifest validator **must use a separate Ajv instance** configured exclusively for Draft 2020-12. Mixing drafts in the same Ajv instance may cause silent validation failures or false passes.  
>
> ```javascript
> // CORRECT: Separate Ajv instances per dialect
> import Ajv2020 from 'ajv/dist/2020.js';
> import Ajv from 'ajv';  // Draft-07 for other schemas if needed
>
> const manifestValidator = new Ajv2020({ allErrors: true, strict: true });
> const otherValidator = new Ajv({ allErrors: true });  // Draft-07
>
> // INCORRECT: Reusing one instance for both
> // const ajv = new Ajv2020();
> // ajv.compile(draft07Schema); // ← May silently break
> ```

```javascript
// In driver registry loader:
function validateEntryPoint(manifest) {
  const entryPoint = manifest.entryPoint;
  // Must be relative
  if (!entryPoint.startsWith('./')) throw new Error(`Invalid entryPoint: must be relative`);
  // Must not traverse
  if (entryPoint.includes('..')) throw new Error(`Invalid entryPoint: directory traversal`);
  // Must match naming convention
  if (!entryPoint.match(/^\.\/(\w+-)+driver\.js$/)) throw new Error(`Invalid entryPoint: naming convention`);
  // Resolve and verify within allowed directory
  const resolved = path.resolve('automation/drivers', entryPoint);
  if (!resolved.startsWith(path.resolve('automation/drivers'))) {
    throw new Error(`Invalid entryPoint: outside allowed directory`);
  }
  return resolved;
}
```

#### T-6: Create Manifests for Existing Drivers *(R2 — Updated with security_capabilities)*

**Files to create:**

`automation/drivers/switchbot-manifest.json`:
```json
{
  "schema_version": "1.0.0",
  "id": "switchbot.hub.v1",
  "name": "SwitchBot Hub Driver",
  "version": "1.0.0",
  "protocol": "switchbot",
  "description": "SwitchBot smart devices via Cloud API (Hub required)",
  "entryPoint": "./switchbot-driver.js",
  "deviceTypes": ["plug", "sensor", "light", "hvac"],
  "capabilities": {
    "telemetry": ["power", "temperature", "humidity"],
    "commands": ["turnOn", "turnOff"],
    "supportsDiscovery": true,
    "supportsGroups": false
  },
  "connection": {
    "type": "cloud-api",
    "requiresAuth": true,
    "configFields": ["token", "secret"]
  },
  "safety": {
    "isActuator": true,
    "requiresSafetyEnvelope": true,
    "safetyCategory": "actuator-low"
  },
  "security_capabilities": {
    "device_identity": true,
    "auth_method": "hmac",
    "encrypted_transport": true,
    "firmware_update_path": "vendor-cloud",
    "logging_supported": false,
    "telemetry_integrity": "none"
  }
}
```

`automation/drivers/kasa-manifest.json`:
```json
{
  "schema_version": "1.0.0",
  "id": "kasa.plug.v1",
  "name": "TP-Link Kasa Driver",
  "version": "1.0.0",
  "protocol": "kasa",
  "description": "Kasa smart plugs via local network discovery",
  "entryPoint": "./kasa-driver.js",
  "deviceTypes": ["plug"],
  "capabilities": {
    "telemetry": ["power", "powerW"],
    "commands": ["turnOn", "turnOff"],
    "supportsDiscovery": true,
    "supportsGroups": false
  },
  "connection": {
    "type": "local-network",
    "requiresAuth": false,
    "configFields": []
  },
  "safety": {
    "isActuator": true,
    "requiresSafetyEnvelope": true,
    "safetyCategory": "actuator-low"
  },
  "security_capabilities": {
    "device_identity": false,
    "auth_method": "none",
    "encrypted_transport": false,
    "firmware_update_path": "vendor-cloud",
    "logging_supported": false,
    "telemetry_integrity": "none"
  }
}
```

`automation/drivers/shelly-manifest.json`:
```json
{
  "schema_version": "1.0.0",
  "id": "shelly.plug.v1",
  "name": "Shelly Plug Driver",
  "version": "1.0.0",
  "protocol": "shelly",
  "description": "Shelly devices via HTTP RPC (local network)",
  "entryPoint": "./shelly-driver.js",
  "deviceTypes": ["plug"],
  "capabilities": {
    "telemetry": ["power", "powerW"],
    "commands": ["turnOn", "turnOff"],
    "supportsDiscovery": false,
    "supportsGroups": false
  },
  "connection": {
    "type": "local-network",
    "requiresAuth": false,
    "configFields": ["host"]
  },
  "safety": {
    "isActuator": true,
    "requiresSafetyEnvelope": true,
    "safetyCategory": "actuator-low"
  },
  "security_capabilities": {
    "device_identity": false,
    "auth_method": "none",
    "encrypted_transport": false,
    "firmware_update_path": "ota",
    "logging_supported": true,
    "telemetry_integrity": "none"
  }
}
```

**Effort:** S (half day)  
**Risk:** Low — additive, no behavior change

#### T-7: Driver Registry API Endpoint

**File to create:** `routes/drivers.js`

```javascript
// GET /api/drivers — List all available drivers with manifest data
// GET /api/drivers/:driverId — Get specific driver manifest
// POST /api/drivers/scan — Rescan automation/drivers/ for new manifests
```

**Implementation:** On startup, scan `automation/drivers/*-manifest.json`, validate against schema, register in `driverRegistry`. Expose via REST API.

**Effort:** S (half day)  
**Risk:** Low

---

### Priority 5: Refactor Existing Drivers (Future)

#### T-8: Refactor SwitchBot/Kasa/Shelly to Extend DeviceDriver

**Problem:** The 3 existing protocol drivers (`SwitchBotDriver`, `KasaPlugDriver`, `ShellyPlugDriver`) predate the `DeviceDriver` base class and use different method signatures:
- SwitchBot: `getDevices()`, `_getAuthHeaders()`
- Kasa: `discover()`, `ensureClient()`, `syncManualDefinitions()`
- Shelly: `discover()`, `safeGetState()`, `request()`

**Proposed approach:** Create adapter wrappers that extend `DeviceDriver` and delegate to the existing driver implementations. This avoids breaking the existing 478 lines of working routes in `server-foxtrot.js`.

```javascript
// automation/drivers/switchbot-adapter.js
import { DeviceDriver } from '../../lib/device-driver.js';
import SwitchBotDriver from './switchbot-driver.js';

export class SwitchBotDeviceDriver extends DeviceDriver {
  constructor(config) {
    super({ ...config, protocol: 'switchbot' });
    this.inner = new SwitchBotDriver(config);
  }
  
  async connect(config) { /* store creds, test API */ }
  async discover() { /* delegate to this.inner.getDevices() */ }
  async getStatus(deviceId) { /* query specific device */ }
  async sendCommand(deviceId, cmd) { /* delegate to SwitchBot API */ }
  async disconnect() { /* cleanup */ }
}
```

**Effort:** M (1–2 days per driver)  
**Risk:** Medium — must not break existing SwitchBot/Kasa routes (8389–8867 in server-foxtrot.js)  
**Approach:** Keep existing routes working alongside new adapter. Gradually migrate.

---

### Priority 6: Future Phase (Phase 6 Scope)

| Ticket | Feature | Effort | Dependencies |
|--------|---------|--------|-------------|
| 6.1 | Full Driver SDK (add validate, healthCheck, subscribeTelemetry) | L | T-8 (adapters) |
| 6.4 | Calibration Manager + Wizard Step | M | T-2 (discovery wired), existing calibration DBs |
| 6.5 | Integration Pack Library (Central) | L | T-5 (manifests), T-7 (registry), Central table |
| 6.6 | Network Integration Curator Agent | L | V-1 (migration), V-2 (sync flowing), data volume |

---

## 8. Architecture Decisions

### AD-1: JavaScript, Not TypeScript

The original proposal suggested TypeScript interfaces. The entire codebase is JavaScript (ES modules with JSDoc comments). All new code should follow this pattern.

**Decision:** JavaScript with JSDoc type annotations. No TypeScript.

### AD-2: Adapter Pattern for Legacy Drivers

The 3 existing drivers don't extend `DeviceDriver`. Rather than rewrite them (and break 478 lines of working routes), use adapter wrappers.

**Decision:** Create `*-adapter.js` files that wrap existing drivers. Existing routes remain untouched.

### AD-3: Safety Envelope Is a Middleware, Not a Driver Feature

Safety validation should sit ABOVE the driver layer, not inside individual drivers. This ensures no driver can bypass safety checks.

**Decision:** `validateCommand()` is called by the wizard, agent, and any route handler BEFORE `driver.sendCommand()`. It is NOT a driver method.

### AD-4: Read-Only Agent Skills First

All initial Integration Assistant agent skills are read-only (`auto` tier). No agent action should create, modify, or delete integrations without human approval.

**Decision:** Phase 1 agent skills: list, read, query only. Phase 2: add `recommend` tier for "add device" flow.

### AD-5: Manifest Files Alongside Driver Files

Driver manifests live next to their driver files in `automation/drivers/`, named `{protocol}-manifest.json`.

**Decision:** Convention: `automation/drivers/{protocol}-driver.js` + `automation/drivers/{protocol}-manifest.json`.

### AD-6: HMAC-Based Farm ID Pseudonymization *(R2)*

Plain SHA-256 of guessable farm identifiers is vulnerable to dictionary attack. HMAC with a per-farm secret ("pepper") stored locally and never synced provides stronger pseudonymization.

**Decision:** Replace `crypto.createHash('sha256').update(farmId)` with `crypto.createHmac('sha256', pepper).update(farmId)`. Generate pepper on first setup, store at `data/farm-pepper.key` with `0o600` permissions. Add to `.gitignore` and sync exclusion.

### AD-7: Safety Envelope Is Stateful and Persistent *(R2)*

Safety calculations (min-off-time, max-cycles-per-hour, max-on-time) require state that survives process restarts. Without persistence, a server restart resets all safety counters, enabling immediate re-energization of equipment that should be in cooldown.

**Decision:** Safety envelope state stored in `data/safety-envelope-state.db` (NeDB). Audit log stored in `data/safety-audit-log.db` (NeDB). Both are append-friendly, crash-resistant, and consistent with the project's existing NeDB pattern.

### AD-8: Manifest EntryPoint Is a Security Boundary *(R2, R3 Refined)*

Once the system auto-discovers driver manifests and loads executable code from `entryPoint`, this becomes a supply-chain surface. OWASP IoT Top 10 explicitly flags insecure ecosystem interfaces and update mechanisms.

**Decision:** 
- `entryPoint` must be a relative path within `automation/drivers/`, matching `*-driver.js` naming convention
- Path traversal (`../`) is rejected at load time
- A checksums file (`data/driver-checksums.json`) records expected SHA-256 hashes; enforcement is **environment-controlled**:
  - Production (`NODE_ENV=production` or `DRIVER_CHECKSUM_ENFORCE=strict`): mismatch **blocks** driver loading
  - Development: mismatch logs a warning, driver loads normally
- No remote/URL-based entry points
- Future: SLSA provenance attestations for driver artifacts (pre-signing discipline), then Ed25519 code-signing (RFC 8032) when integration packs ship from Central

### AD-9: Idempotent Sync via UPSERT *(R2, R3 Refined)*

Duplicate integration records from retried syncs or overlapping windows would skew network intelligence (inflated adoption counts, incorrect failure rates). The transactional outbox pattern is the gold standard, but UPSERT on `(farm_id_hash, record_id)` is a pragmatic first step.

**Decision:** Central's ingest endpoint uses `INSERT ... ON CONFLICT (farm_id_hash, record_id) DO UPDATE SET ...` with a `record_updated_at` guard (farm-provided timestamp) to prevent stale overwrites. Add UNIQUE constraint via migration 018.  
**R3 refinement:** The guard compares farm-provided `record_updated_at` (the time the record actually changed on the farm), NOT Central's `updated_at`. This makes retried syncs true no-ops and prevents out-of-order overwrites. See AD-14.

### AD-10: Discovery Hardening *(R2)*

mDNS is a local-link protocol, but real deployments may leak beyond VLAN boundaries. Discovery endpoints must be defended against network noise, abuse, and reconnaissance.

**Decision:** Hard timeout (15s), result cap (50 devices), rate limit (1 scan / 30s per session), service-type filtering, graceful fallback to manual entry when multicast is blocked, RBAC via existing auth middleware.

### AD-11: Confirmation Gating via Traceable Approval *(R2)*

Simple `args.confirmed = true` boolean flags can be set by any API caller, including automated scripts, bypassing the intent of human-in-the-loop safety. Confirmation must be traceable to a real user action.

**Decision:** Confirmation requires `{ confirmedBy, confirmedAt, sessionId }` where `confirmedBy` maps to an authenticated user, `confirmedAt` is within 30 seconds, and `sessionId` is a valid active session. Prevents accidental bypass via API misuse.

### AD-12: Fail-Safe Posture for Unknown/Missing Safety State *(R3)*

Per NIST SP 800-82r3, OT control systems must prioritize safe operations when state information is incomplete. The default for missing or stale safety state must be fail-closed for high-risk actuators.

**Decision:** When safety envelope state is missing, null, or older than `staleThreshold` (configurable, default 2 hours):
- `actuator-high` (pumps, heaters, CO₂ injection): **blocked** until health check refreshes state
- `actuator-low` (plugs, dimmers): proceed with confirmation required
- `sensor` / `indicator`: proceed with logged warning
- No state record at all: treat device as "in cooldown" — deny actuation until state is established

### AD-13: Stale/Unknown State in Cross-Device Interlocks *(R3)*

Interlocks query "all device states" but this is not a perfect snapshot — devices may be offline, delayed, or have stale telemetry. Assuming "if not currently on, then safe" is dangerous.

**Decision:** If any device involved in an interlock check has `currentState === 'unknown'` or state older than `staleThreshold`, treat it as **potentially active** for "no simultaneous" interlocks (conservative assumption: assume it might be on). Log a warning and include in the audit record. Unknown interlock types fail **closed** (not open).

### AD-14: Farm-Provided Timestamps for Monotonic Sync *(R3)*

The sync idempotency guard must use farm-provided `record_updated_at` (the actual time the record was modified on the farm), not Central's `updated_at` column. Using Central's timestamp in the UPSERT guard is logically incorrect: `updated_at = NOW()` in the SET clause makes the `WHERE updated_at < EXCLUDED.updated_at` comparison trivially true, defeating the guard.

**Decision:** Add `record_updated_at TIMESTAMP NOT NULL` column to `device_integrations`. The UPSERT WHERE clause compares `device_integrations.record_updated_at < EXCLUDED.record_updated_at`. Central's `updated_at` column reflects when Central last processed the record — a separate concern. Retried syncs with identical payloads become true no-ops.

### AD-15: Ajv Dialect Isolation for Manifest Validation *(R3)*

JSON Schema Draft 2020-12 is not backward-compatible with Draft-07. Vocabulary handling, `$dynamicRef`/`$dynamicAnchor`, and output format differ fundamentally. Mixing drafts in the same Ajv instance can cause silent validation failures or false passes.

**Decision:** The driver manifest validator uses a **dedicated `Ajv2020` instance** (`ajv/dist/2020.js`) configured exclusively for Draft 2020-12 with `strict: true`. Any other validation tasks in the codebase that use Draft-07 must use a separate standard `Ajv` instance. Never share validator instances across schema dialects.

---

## 9. Data Flow Diagrams

### Device Registration Flow

```
Grower → Wizard UI → POST /api/device-wizard/start
                   → Select Protocol → driver = driverRegistry.getDriver(protocol)
                   → Config → driver.connect(config)
                   → Discover → driver.discover() + device-discovery.js scan
                   → Select Device → driver.getStatus(deviceId)
                   → Connectivity Test → compute signal quality
                   → Room Assignment → roomId, zoneId, groupId
                   → Save → integrationDB.insert(record) [NeDB]
                          → integration_records in syncFarmData() payload [5-min]
                          → Central POST /api/sync/device-integrations [PostgreSQL]
```

### Network Learning Loop

```
Farm A ──sync──→ Central DB (device_integrations)
Farm B ──sync──→ Central DB
Farm C ──sync──→ Central DB
                    ↓
           AI Push Scheduler (30 min)
                    ↓
           Query: drivers with success_rate ≥ threshold
           Query: drivers with failure_rate > 20%
                    ↓
           Farm ← POST /api/health/ai-recommendations
                   { network_intelligence.device_integrations:
                     { recommended_drivers: [...],
                       integration_warnings: [...] } }
```

### Safety Envelope Flow *(R2 — Updated with Audit Trail)*

```
Command Request (agent / wizard / automation / route handler / UI)
       │
       │  ALL paths must call executeCommand() — no direct driver access
       ▼
executeCommand(device, command, args, context)
       │
       ├─ Generate auditId (SAF-{date}-{time}-{random})
       ├─ Load device state from safety-envelope-state.db
       ├─ Load ALL device states for cross-device interlocks
       ▼
validateCommand(device, command, args, currentState)
       │
  ┌─ Check interlocks (cross-device: no_heater_with_cooling, no_simultaneous_pumps)
  ├─ Check timing (min_off_time_seconds since last off)
  ├─ Check rate limits (max_cycles_per_hour in rolling window)
  ├─ Check max continuous on-time
  └─ Check confirmation (requires traceable approval: userId + sessionId + timestamp)
       │
       ├── RECORD DECISION to safety-audit-log.db (ALWAYS, allow or deny)
       │
  { allowed: true } → driver.sendCommand(deviceId, command, params)
                     → Update safety-envelope-state.db
                     → Record execution result in audit log
                     → Return { allowed, executed, result, auditId }

  { allowed: false, reason: "..." } → BLOCK
                                    → Return { allowed: false, reason, auditId }
                                    → Log includes: who, what, why blocked, state at time

  { requires_confirmation: true } → HOLD
                                  → Return { requires_confirmation, reason, auditId }
                                  → UI/agent presents confirmation dialog
                                  → Re-submit with traceable { confirmedBy, confirmedAt, sessionId }
```

---

## 10. Risk Register

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|------------|
| R1 | Central migration 017 not applied | High | High | V-1 ticket: verify and apply before any analytics work |
| R2 | Integration sync not wired into syncFarmData() | Medium | High | V-2 ticket: verify and wire |
| R3 | Safety envelope bypassed by direct driver calls | Medium | Critical | AD-3: middleware pattern, linting rule, code review. R2: single gateway function `executeCommand()` |
| R4 | Existing SwitchBot/Kasa routes break during refactor | Medium | High | AD-2: adapter pattern, keep old routes working |
| R5 | Wizard UI not used by growers | Medium | Low | Keep wizard optional, support API-only usage |
| R6 | Discovery returns too many devices (network noise) | Low | Low | Filter by protocol, cap results, timeout. R2: AD-10 hardening constraints |
| R7 | Agent gives incorrect device advice | Medium | Medium | Read-only skills only (AD-4), no autonomous device control |
| **R8** | **Farm ID re-identification via unsalted SHA-256** *(R2)* | **Medium** | **High** | **V-4: upgrade to HMAC with per-farm pepper (AD-6). Central DB becomes non-correlatable without farm cooperation.** |
| **R9** | **Safety envelope state lost on process restart** *(R2)* | **Medium** | **Critical** | **AD-7: NeDB-backed state persistence. Envelope loads last-known state on startup; unknown states treated as "in cooldown".** |
| **R10** | **Manifest entryPoint used for arbitrary code loading** *(R2)* | **Low** | **Critical** | **AD-8: path allowlist, naming convention enforcement, directory traversal rejection, future code-signing. No remote/URL entrypoints.** |
| **R11** | **mDNS discovery leaks beyond local segment** *(R2)* | **Low** | **Medium** | **AD-10: service-type filtering, timeouts, result caps, rate limiting. Discovery read-only, separated from actuator paths.** |
| **R12** | **Duplicate sync records skew network intelligence** *(R2, R3 refined)* | **Medium** | **High** | **V-3: UPSERT on (farm_id_hash, record_id) with `record_updated_at` guard (AD-9, AD-14). Retried syncs are true no-ops. Out-of-order syncs cannot overwrite newer data.** |
| **R13** | **Integration packs from Central enable remote code execution** *(R2)* | **Low** | **Critical** | **Strict separation: Central pushes config/metadata only, never executable code. Integration packs = declarative templates, not driver binaries. Code updates only via normal deployment channel.** |
| **R14** | **Confirmation gate bypassed via direct API call with `confirmed: true`** *(R2)* | **Medium** | **High** | **AD-11: traceable approval requires authenticated userId, valid sessionId, timestamp within 30s window. Boolean-only confirmation rejected.** |
| **R15** | **Safety envelope allows actuation when device state is unknown/stale** *(R3)* | **Medium** | **Critical** | **AD-12: fail-closed for actuator-high when state is missing or older than staleThreshold. Sensors and actuator-low may proceed with logged warnings. Stale interlock devices treated as potentially active (AD-13).** |
| **R16** | **Pepper loss renders farm’s Central integration records unrecoverable** *(R3)* | **Low** | **High** | **§18 Pepper Lifecycle Governance: pepper file must be included in farm backup procedures. Loss of pepper = farm re-introduces as new identity; Central archives old records under tombstone. Never rotate unless compromised.** |
| **R17** | **Ajv Draft 2020-12 mixed with earlier drafts causes silent validation failures** *(R3)* | **Low** | **High** | **AD-15: separate Ajv instances per JSON Schema dialect. Never reuse Draft 2020-12 instance for Draft-07 schemas or vice versa.** |
| **R18** | **Driver checksum mismatch silently allowed in production** *(R3)* | **Low** | **Critical** | **AD-8 (R3 refined): environment-controlled enforcement. Production = block driver loading on mismatch. Development = warn only. Controlled via `DRIVER_CHECKSUM_ENFORCE` env var.** |

---

## 11. Timeline & Effort Estimates

### Sprint Plan *(R2 — Updated)*

| Sprint | Tickets | Total Effort | Deliverables |
|--------|---------|-------------|-------------|
| **Pre-req** | V-1, V-2, V-3, V-4 *(R2)* | 2 hours | Central migration verified, sync flowing, UPSERT constraint, HMAC pseudonymization |
| **Sprint 1** | T-1 (Safety Envelope) | 2–3 days *(R2: upgraded)* | `lib/device-safety-envelope.js` + state DB + audit log + tests |
| **Sprint 2** | T-2 (Discovery → Wizard), T-4 (Agent Skills) | 1–2 days | Discovery wired + hardened, agent has 5 integration skills |
| **Sprint 3** | T-3 (Wizard UI), T-5 (Manifest Schema), T-6 (3 Manifests) | 2–3 days | Frontend wizard, driver manifests with security_capabilities |
| **Sprint 4** | T-7 (Registry API + entryPoint governance), T-8 (Driver Adapters) | 2–3 days | `/api/drivers/*` with supply-chain checks, adapter wrappers |
| **Future** | 6.1, 6.4, 6.5, 6.6 | 15–20 days | Full SDK, calibration, packs, curator |

**Total active work: ~9–12 days for Sprints 1–4** *(R2: +1–2 days from R1 due to safety envelope upgrade)*  
**Running total with existing implementation: 8 tickets complete + 10 new tickets (V-1–V-4, T-1–T-8) = 18 tickets**

### Dependency Graph *(R2 — Updated)*

```
V-1 (migration) ──→ V-2 (sync) ──→ V-3 (UPSERT) ──→ Central analytics work
                                                       ──→ 6.6 (curator)

V-4 (HMAC pepper) ──→ V-3 (UPSERT handles hash change)

T-1 (safety envelope + state + audit) ──→ T-8 (adapters) ──→ 6.1 (full SDK)

T-2 (discovery wiring + hardening) ──→ T-3 (wizard UI) ──→ 6.4 (calibration)

T-4 (agent skills) ──→ (standalone, no blockers)

T-5 (schema 2020-12 + security_capabilities) ──→ T-6 (manifests) ──→ T-7 (registry API + governance) ──→ 6.5 (pack library)
```

---

## 12. Approval Checklist

Reviewers: Please mark your decision on each item.

| # | Decision Point | Options | Recommendation |
|---|---------------|---------|---------------|
| 1 | **Verify Central migration first?** | Yes / Defer | Yes — blocks analytics |
| 2 | **Safety envelope before any other work?** | Yes / After wizard | Yes — critical safety |
| 3 | **Wizard frontend priority** | Sprint 2 / Sprint 3 / Defer | Sprint 3 — backend works without it |
| 4 | **Agent skill tier** | All auto / Mix of auto+recommend | All auto (read-only first) |
| 5 | **Driver refactor approach** | Adapter wrappers / Full rewrite / Defer | Adapter wrappers (AD-2) |
| 6 | **Manifest location** | Alongside drivers / Centralized `data/` folder | Alongside drivers (AD-5) |
| 7 | **Phase 6 start timing** | After Sprint 4 / After Phase 5 / Parallel | After Sprint 4 for 6.1+6.4; after Phase 5 for 6.5+6.6 |
| **8** | **Farm ID pseudonymization method** *(R2)* | SHA-256 (current) / HMAC-SHA-256 / Keyed hash | **HMAC-SHA-256 with per-farm pepper (AD-6)** |
| **9** | **Safety envelope scope: CO₂ + lighting?** *(R2)* | Include / Exclude / Phase 2 | **Include CO₂ (hazardous >1500ppm); defer lighting to Phase 2** |
| **10** | **JSON Schema draft version** *(R2)* | Draft-07 / Draft 2020-12 | **Draft 2020-12 (AD-8, current standard)** |
| **11** | **Confirmation gating model** *(R2)* | Boolean flag / Traceable approval | **Traceable approval with userId + sessionId + timestamp (AD-11)** |
| **12** | **Integration pack code policy** *(R2)* | Packs include code / Packs are metadata-only | **Metadata-only; code updates via normal deploy channel (R13 mitigation)** |
| **13** | **Sync idempotency approach** *(R2)* | UPSERT on composite key / Full outbox pattern | **UPSERT first (AD-9); evaluate outbox if volume exceeds 1000 records/farm** |

---

## 13. Executive Review Summary *(R2)*

An executive assessment was conducted against the R1 proposal. The review validated the proposal as "technically coherent" with "meaningful progress" and confirmed alignment with established IoT lifecycle risk management guidance (NIST SP 800-183, SP 800-213, IR 8259A, OWASP IoT Top 10).

### What the Proposal Gets Right

1. **Inventory first, then intelligence** — Creating persistent integration records and syncing to Central matches NIST guidance that managing IoT cybersecurity/privacy risks starts with understanding device risk considerations and lifecycle challenges.

2. **Push-down intelligence via a single channel** — Keeping recommendations in the existing 30-minute push cadence reduces interface sprawl (fewer ecosystem interfaces = fewer failure modes).

3. **Protocol pragmatism** — Focusing on OASIS MQTT, mDNS, and Modbus reflects real-world device ecosystems. MQTT is designed as a lightweight publish/subscribe protocol; Modbus has vendor-specific mapping considerations — both realities support a driver model with strict schema and capability declarations.

4. **Read-only AI agent actions first** — Limiting early agent skills to list/read/health/status is consistent with recognized IoT risk patterns (interfaces and remote control are risk amplifiers).

### Four Critical Areas Identified

The review identified four areas that will determine whether the system becomes robust at scale and safe enough for actuator control:

| # | Area | Core Issue | Resolution |
|---|------|-----------|------------|
| 1 | **Safety Envelope** | Must be a control-system safety boundary: stateful, auditable, impossible to bypass | T-1 upgraded: persistent state, mandatory gateway, audit log, traceable confirmation (AD-7, AD-11) |
| 2 | **Device Identity & Privacy** | SHA-256 without salt/secret is vulnerable to re-identification when identifiers are guessable | V-4 added: HMAC-based pseudonymization with per-farm pepper (AD-6) |
| 3 | **Driver/Manifest Loading** | Auto-discovering drivers and loading executable code is a supply-chain boundary | T-5 upgraded: Draft 2020-12, entryPoint governance, path allowlist, checksums (AD-8) |
| 4 | **Discovery & Telemetry** | mDNS and MQTT have operational/security gotchas that need hard constraints | T-2 hardened: timeouts, caps, rate limits, graceful degradation, isolation (AD-10) |

### Additional Findings Incorporated

- **Sync idempotency:** V-3 added — UPSERT on `(farm_id_hash, record_id)` prevents duplicate records skewing analytics (AD-9)
- **Confirmation gating:** Upgraded from boolean flag to traceable approval with userId, sessionId, timestamp (AD-11)
- **Interlock model:** Upgraded to cross-device state evaluation (pumps, heater vs cooling)
- **Security capabilities in manifests:** `security_capabilities` section added per NIST IR 8259A baseline
- **Network intelligence governance:** Publication discipline thresholds, traceability requirements (Section 15)
- **Integration pack policy:** Metadata-only; code distribution only via normal deployment channel (R13 mitigation)

### R3 — Deep Research Review Findings *(R3)*

A deep research review of R2 validated the proposal's architectural direction and identified specific corrections, hardening items, and governance gaps:

| # | Finding | Correction / Addition |
|---|---------|----------------------|
| 1 | **Safety envelope: unknown state defaults** | Fail-closed for actuator-high when state is missing/stale (AD-12). Stale interlock devices treated as potentially active (AD-13). Unknown interlock types fail closed. |
| 2 | **CO₂ thresholds overstated** | Corrected: 1,000 ppm = IAQ comfort (Health Canada), 5,000 ppm = TWA (OSHA/NIOSH), 30,000 ppm = STEL (NIOSH). Tiered envelope model: plant-optimization ≤1,500 ppm, hard cutoff 5,000 ppm. |
| 3 | **Sync UPSERT guard logically incorrect** | Central's `updated_at = NOW()` makes `WHERE updated_at < EXCLUDED.updated_at` trivially true. Fixed to use farm-provided `record_updated_at` (AD-14). Hash algorithm change (V-4) requires coordinated re-sync. |
| 4 | **Pepper lifecycle ungoverned** | Added §18: generation, storage, backup, rotation policy ("never unless compromise"), loss recovery, right-to-delete integration. |
| 5 | **Checksum enforcement too permissive** | R2 "warn on mismatch" upgraded to environment-controlled: production = block, development = warn (AD-8 refined). |
| 6 | **Ajv dialect mixing risk** | Draft 2020-12 not backward-compatible with Draft-07. Must use separate Ajv instances (AD-15). |
| 7 | **Discovery proxy purpose unclear** | DP-10 expanded: team must decide admin tool vs remote onboarding. If retained: admin-only, rate-limited, opt-in, auditable. |
| 8 | **MQTT telemetry conventions unspecified** | Added §19: topic naming, QoS defaults, payload validation, retained message policy. |
| 9 | **No formal acceptance criteria** | Added §16: testable pass/fail criteria for safety, idempotency, supply-chain, discovery. |
| 10 | **No targeted team questions** | Added §17: pepper lifecycle ownership, Central single-writer, proxy purpose, MQTT standardization timing. |

**New Architecture Decisions (R3):** AD-12 (fail-safe posture), AD-13 (stale interlocks), AD-14 (farm timestamps), AD-15 (Ajv isolation)  
**New Risks (R3):** R15 (unknown state actuation), R16 (pepper loss), R17 (Ajv mixing), R18 (checksum enforcement gap)

---

## 14. Decision Points for Team *(R2/R3)*

These questions are designed to unblock implementation while keeping alignment with "Central-first" governance and safety guardrails. Each requires a team decision before the affected sprint begins.

### Integration Identity and Privacy

**DP-1:** Is `farm_id` potentially guessable (human-readable code, email-like format)? If yes, the HMAC upgrade (V-4/AD-6) is mandatory rather than optional.

**DP-2:** Do we need to support "right to delete" / "farm leaves the network"? If so, Central must handle deletion requests for hashed IDs — e.g., tombstone all records matching a `farm_id_hash`, or accept a signed deletion request from the farm that includes its pepper-derived hash.

### Safety Envelope Scope

**DP-3:** Should the safety envelope govern only traditional actuators (relay, pump, heater, cooling), or also include dimmable lighting and CO₂ injection?
- CO₂ enrichment targets for crops are typically 800–1,500 ppm. The **comfort/ventilation indicator** is 1,000 ppm (Health Canada IAQ). The **occupational TWA** is 5,000 ppm (OSHA/NIOSH). The **STEL** is 30,000 ppm (NIOSH). See T-1 for the corrected tiered threshold model.
- High-intensity lighting in sealed spaces creates heat accumulation
- **Recommended:** Include CO₂ as `actuator-high` safety category with tiered thresholds (1,000 / 5,000 / 15,000 ppm); defer lighting to Phase 2

**DP-4:** Where should the envelope state live? Options:
- `data/safety-envelope-state.db` (NeDB, consistent with project pattern) — **recommended**
- SQLite (better transaction guarantees, more complex)
- In-memory with periodic flush (risks state loss)

**DP-5:** How do we guarantee that every command path goes through `executeCommand()`? Options:
- ESLint rule flagging direct `driver.sendCommand()` calls — **recommended**
- Architectural constraint: drivers only accessible via envelope module (no direct import)
- Code review checklist item

### Manifest + Driver Governance

**DP-6:** Will farms be allowed to install new drivers from Central, or only receive recommendation metadata while code updates are handled via your normal deployment channel?
- **Recommended:** Metadata-only from Central; code updates via standard deploy (see R13 mitigation)
- This is a supply-chain boundary — OWASP IoT explicitly flags update mechanisms and ecosystem interfaces as risk areas

**DP-7:** Which JSON Schema draft for manifest validation?
- Draft-07 (older, wider tool support)
- **Draft 2020-12** (current standard, AJV supports it) — **recommended**

**DP-8:** Which validator runtime for manifest enforcement at startup?
- AJV with Draft 2020-12 support — **recommended**
- Joi (simpler but not JSON Schema standard)
- Custom validation (not recommended)

### Discovery and Network Behaviour

**DP-9:** Are the target farm networks flat LAN, VLAN-segmented, or mixed Wi-Fi?
- This determines how discovery UX should behave when multicast is blocked
- Discovery must degrade gracefully — show manual entry fallback, not an error

**DP-10:** Should discovery endpoints be accessible via the Central discovery proxy (`greenreach-central/routes/discovery-proxy.js`), or should they be local-only?
- **Recommended:** Local-only by default; proxy requires explicit admin opt-in
- Discovery as a remote reconnaissance tool on a compromised farm network is a risk (OWASP "insecure network services")
- **R3 Refinement:** The team must clarify the proxy's purpose: is it an **admin diagnostic tool** (acceptable with auth + audit + rate limit) or a **remote onboarding enabler** (much higher risk surface)? If retained, it must enforce:
  - Admin-only access (explicit role, not just "authenticated")
  - Rate limiting (1 request / 60s per admin)
  - Full audit logging (who, when, from where, results count)
  - Opt-in at the farm level (`DISCOVERY_PROXY_ENABLED=false` by default)
  - No device fingerprinting data in proxy responses (strip MAC addresses, serial numbers)

### Sync and Data Quality

**DP-11:** At what data volume should we consider upgrading from UPSERT to a full transactional outbox pattern?
- **Recommended threshold:** >1000 integration records per farm, or >50 farms syncing
- Below that, UPSERT with `updated_at` guard is sufficient

---

## 15. Network Intelligence Governance *(R2)*

This section addresses how Central should govern recommendations pushed to farms via the 30-minute AI push channel.

### Publication Discipline

Network recommendations must not be published until sufficient data exists to avoid noise-driven guidance. This is consistent with NIST's risk management framing: decisions should be appropriate to system risk and supported by evidence.

**Publication thresholds (for `device_integrations` recommendations):**

| Metric | Minimum Before Publishing | Rationale |
|--------|--------------------------|-----------|
| Farms contributing data | ≥ 5 | Avoid single-farm bias |
| Installs per driver version | ≥ 10 | Statistical minimum for reliability signal |
| Data window | ≥ 30 days | Capture seasonal/environmental variation |
| Confidence on failure rate | Failure rate ± margin < threshold | Prevent "winner's curse" from small samples |

**Separation of facts from recommendations:**

| Layer | Content | Example |
|-------|---------|---------|
| **Observed facts** | Dropout rate distribution, latency percentiles, failure counts | "Driver kasa.plug.v1 has median dropout rate 2.1% across 23 installs" |
| **Recommendations** | Actionable guidance derived from facts | "Consider upgrading to kasa.plug.v2 — 40% lower dropout rate" |

Each recommendation must include traceability:
- Data window (start/end dates)
- Filters applied (protocol, device type, region)
- Exclusion criteria (outliers, farms with <7 days data)
- Sample size and confidence level

### Recommendation Eligibility Score *(R2 — NEW)*

Central should compute a composite score for each driver/device combination that includes both **reliability outcomes** and **declared security posture** (from manifest `security_capabilities`):

```javascript
function computeRecommendationEligibility(driverStats, manifest) {
  const reliabilityScore = (
    (1 - driverStats.avg_dropout_rate) * 0.4 +
    (driverStats.avg_signal_quality) * 0.3 +
    (driverStats.validation_pass_rate) * 0.3
  );

  const securityScore = (
    (manifest.security_capabilities?.encrypted_transport ? 0.3 : 0) +
    (manifest.security_capabilities?.auth_method !== 'none' ? 0.3 : 0) +
    (manifest.security_capabilities?.device_identity ? 0.2 : 0) +
    (manifest.security_capabilities?.firmware_update_path !== 'none' ? 0.2 : 0)
  );

  return {
    reliability: reliabilityScore,     // 0.0–1.0
    security: securityScore,           // 0.0–1.0
    composite: (reliabilityScore * 0.6 + securityScore * 0.4),
    eligible: reliabilityScore >= 0.7 && securityScore >= 0.3,
    reason: reliabilityScore < 0.7
      ? 'Insufficient reliability data'
      : securityScore < 0.3
      ? 'Below security baseline'
      : 'Eligible for recommendation'
  };
}
```

### Integration Pack Security Posture *(R2)*

When the Integration Pack Library ships (6.5, future phase), the following governance must apply per OWASP IoT guidance:

| Requirement | Implementation |
|-------------|---------------|
| **Signed packs** | Central signs integration pack manifests with Ed25519 key; farms verify before applying |
| **Explicit compatibility** | Packs declare minimum Light Engine version, driver SDK version, platform |
| **Rollback path** | Farms store previous config before applying pack; one-command rollback |
| **No remote code execution** | Packs contain only declarative config/metadata — never executable driver code |
| **Separation of concerns** | "Data/config pushed from Central" is strictly separated from "code executed on farm" |
| **Audit trail** | Every pack application recorded with: pack version, applied_at, applied_by, previous_config_hash |

---

---

## 16. Acceptance Criteria *(R3)*

Formal, testable pass/fail criteria for the four critical boundaries. These must be verified before the corresponding feature ships.

### 16.1 Safety Boundary

| # | Criterion | Pass Condition |
|---|-----------|---------------|
| S-1 | No command path bypasses `executeCommand()` | Grep/lint confirms no direct `driver.sendCommand()` calls outside `executeCommand()`. ESLint rule passes. |
| S-2 | Safety state persists across restart | Kill process, restart. Verify `safety-envelope-state.db` loads and cooldown timers resume from last known state. |
| S-3 | Unknown state = constrained | Delete state file for an `actuator-high` device. Attempt `turnOn`. Verify response is `{ allowed: false, reason: '...health check first...' }`. |
| S-4 | Stale interlock = conservative | Set pump A's `lastCommandAt` to 3 hours ago. Attempt `turnOn` for pump B with `no_simultaneous_pumps` interlock. Verify blocked (stale pump A treated as potentially active). |
| S-5 | CO₂ hard cutoff enforced | Simulate CO₂ sensor reading of 5,100 ppm. Attempt CO₂ injection command. Verify auto-shutdown triggered. |
| S-6 | Audit log completeness | Execute 10 commands (mix of allowed/denied). Verify audit log contains all 10 with `auditId`, decision, reason, device, command, timestamp, context. |

### 16.2 Sync Idempotency

| # | Criterion | Pass Condition |
|---|-----------|---------------|
| I-1 | Repeated sync = no row count change | Sync 10 integration records. Re-sync identical payload. `SELECT COUNT(*)` is unchanged. |
| I-2 | Repeated sync = no aggregate shift | After re-sync, verify `AVG(signal_quality)`, `SUM(validation_passed::int)` are identical to pre-re-sync values. |
| I-3 | Monotonic updates via farm timestamp | Sync record with `record_updated_at = T1`. Re-sync with `record_updated_at = T0` (T0 < T1). Verify record retains T1 data. |
| I-4 | HMAC hash migration | After upgrading from SHA-256 to HMAC (V-4), re-sync all records. Verify Central contains exactly one row per (new_farm_id_hash, record_id). Old hash rows are orphaned or tombstoned per migration plan. |

### 16.3 Supply-Chain (Manifest/Driver Loading)

| # | Criterion | Pass Condition |
|---|-----------|---------------|
| SC-1 | Path traversal blocked | Create manifest with `"entryPoint": "../../../etc/passwd"`. Verify `validateEntryPoint()` throws and driver is not loaded. |
| SC-2 | Checksum mismatch in production | Set `NODE_ENV=production`. Modify a driver file. Restart. Verify driver is NOT loaded and alert is generated. |
| SC-3 | Checksum mismatch in development | Set `NODE_ENV=development`. Modify a driver file. Restart. Verify warning logged but driver loads normally. |
| SC-4 | Ajv dialect isolation | Compile a Draft-07 schema using the Draft 2020-12 Ajv instance. Verify it throws or fails validation (not silently accepted). |
| SC-5 | Invalid manifest rejected | Submit manifest missing required fields or with `additionalProperties`. Verify validation rejects it with clear error. |

### 16.4 Discovery

| # | Criterion | Pass Condition |
|---|-----------|---------------|
| D-1 | Timeout enforced | Start discovery scan on a network with no devices. Verify scan completes within 15 seconds (does not hang). |
| D-2 | Result cap enforced | Simulate >50 mDNS responses. Verify API returns at most 50 devices. |
| D-3 | Rate limit enforced | Attempt 2 scans within 30 seconds from same session. Verify second scan is rejected with rate-limit message. |
| D-4 | Multicast blocked fallback | Block multicast traffic. Trigger discovery. Verify wizard presents manual entry UI (not an error). |
| D-5 | Proxy default off | With default configuration, attempt discovery via Central proxy. Verify request is rejected. Verify `DISCOVERY_PROXY_ENABLED=true` is required. |

---

## 17. Targeted Team Questions *(R3)*

These questions surfaced during the deep research review and require team discussion before implementation can proceed on the affected areas.

### Q-1: Pepper Lifecycle Ownership

**Who owns the pepper file (`data/farm-pepper.key`) and its backup/recovery?**

The pepper is a single point of failure for farm identity continuity on Central. If lost, the farm's entire integration history on Central becomes an orphan. The team must decide:
- Is the pepper included in existing farm backup procedures?
- Who is responsible for documenting the recovery process?
- Is there a test scenario for "pepper lost, farm re-introduces to Central"?

*Affects: V-4, §18, R16*

### Q-2: Central Single-Writer Guarantee

**Is Central's `device_integrations` ingest endpoint a single-writer, and how do we guarantee monotonic updates?**

The UPSERT guard (`WHERE record_updated_at < EXCLUDED.record_updated_at`) assumes that for any given `(farm_id_hash, record_id)`, writes arrive sequentially. If multiple sync jobs or retries can write concurrently for the same farm, a race condition can defeat the guard. The team must confirm:
- Is there a queueing/locking mechanism for per-farm ingest?
- Should we add `SELECT ... FOR UPDATE` row-level locking in the UPSERT transaction?
- Or is the 5-minute sync interval sufficient to prevent overlap in practice?

*Affects: V-3, AD-14*

### Q-3: Discovery Proxy Purpose

**Is `greenreach-central/routes/discovery-proxy.js` intended as an admin diagnostic tool or a remote onboarding enabler?**

These two use cases have very different risk profiles:
- **Admin diagnostic:** Acceptable with auth + audit + rate limit. Useful for remote troubleshooting.
- **Remote onboarding:** Allows Central to discover devices on a farm's network without local login. Significantly higher risk surface — effectively a remote reconnaissance capability.

The team must decide the proxy's purpose and, if retained, the minimum authn/authz requirements.

*Affects: T-2, DP-10, AD-10*

### Q-4: MQTT Telemetry Standardization Timing

**Should MQTT topic naming, QoS defaults, retained message policy, and payload validation be standardized now (Phase 5), or deferred to Phase 6 with the full Driver SDK?**

The MQTT driver and any future MQTT-based telemetry subscriptions will benefit from consistent conventions. However, standardizing now may constrain Phase 6 design. The team must decide:
- Standardize now (§19 conventions) — lower risk of ad-hoc implementations
- Defer to Phase 6 — more flexibility but risk of inconsistency in interim

*Affects: §19, T-8, Phase 6 (6.1 subscribeTelemetry)*

---

## 18. Pepper Lifecycle Governance *(R3)*

This section governs the creation, storage, backup, rotation, compromise response, and recovery of the per-farm HMAC pepper (`data/farm-pepper.key`) introduced in V-4.

### 18.1 Generation

- Generated on first call to `getFarmPepper()` as `crypto.randomBytes(32).toString('hex')`
- Stored at `data/farm-pepper.key` with file permissions `0o600` (owner read/write only)
- 64-character hex string (256 bits of entropy)
- No user interaction required — fully automatic, silent

### 18.2 Storage Requirements

| Property | Requirement |
|----------|------------|
| File path | `data/farm-pepper.key` (relative to project root) |
| Permissions | `0o600` — owner read/write only |
| Git exclusion | Listed in `.gitignore` |
| Sync exclusion | Excluded from `syncFarmData()` payload — **never sent to Central** |
| Backup inclusion | **Must be included** in any farm backup procedure (see 18.3) |

### 18.3 Backup Semantics

The pepper file **must** be included in farm backup procedures alongside other critical farm data (`data/` directory, configuration files, NeDB databases). Without the pepper:
- The farm cannot regenerate its `farm_id_hash`
- All existing Central records for this farm become orphaned (unlinked to any known farm identity)
- The farm would need to re-introduce itself to Central as a **new identity**

**Backup checklist item:** `data/farm-pepper.key` must appear in any backup script, snapshot, or documentation that covers farm-critical data.

### 18.4 Rotation Policy

**Policy: Never rotate the pepper unless compromise is confirmed.**

Rationale: Rotating the pepper changes the `farm_id_hash`, which makes all existing Central records for this farm unreachable under the new hash. This is operationally equivalent to "farm leaves the network and re-joins as a new farm." Rotation should only occur if:
1. The pepper file was exfiltrated or exposed (e.g., committed to a public repository)
2. A security audit specifically requires it

**On rotation:**
1. Generate new pepper
2. Coordinate with Central: archive old `farm_id_hash` records under a tombstone marker
3. Farm re-syncs all integration records with new hash
4. Central associates new hash with the same farm entity (requires out-of-band verification)

### 18.5 Compromise Response

**If the pepper is confirmed compromised:**

1. **Immediately:** Generate a new pepper and store at same path
2. **Notify Central:** Send a signed pepper-rotation event (include old hash and new hash, authenticated via existing farm-Central channel)
3. **Central action:** Tombstone all records under old `farm_id_hash`. Mark as "identity rotated — do not correlate with new hash."
4. **Farm action:** Trigger full re-sync of all integration records under new `farm_id_hash`
5. **Audit:** Log rotation event with timestamp, reason, who authorized

### 18.6 Recovery from Loss

**If the pepper file is lost (not compromised, just missing):**

1. The farm can no longer produce the same `farm_id_hash` — existing Central records are orphaned
2. The farm generates a new pepper automatically on next `getFarmPepper()` call
3. Farm re-syncs all records — they appear on Central as a **new farm identity**
4. Central retains old records indefinitely under the orphaned hash (useful for historical analytics)
5. **Optional:** If the farm operator contacts Central admin, records can be manually re-associated via admin tooling (requires proof of farm ownership)

### 18.7 Integration with Right-to-Delete

When a farm requests data deletion ("leave the network"):
1. Farm provides its current `farm_id_hash` to Central (derived from pepper — Central can verify the hash is real because it matches stored records)
2. Central tombstones all records matching that `farm_id_hash`
3. Farm deletes its pepper file locally
4. No reverse lookup is needed — Central never needs to know the actual `farmId`

---

## 19. MQTT Telemetry Conventions *(R3)*

This section establishes conventions for MQTT-based device telemetry as the driver ecosystem expands. These conventions should be formalized in the Driver SDK (Phase 6, feature 6.1 `subscribeTelemetry()`) but are documented here to prevent ad-hoc implementations.

### 19.1 Topic Naming Convention

```
lightengine/{farmId}/devices/{deviceId}/telemetry/{metric}
lightengine/{farmId}/devices/{deviceId}/status
lightengine/{farmId}/devices/{deviceId}/commands/{commandId}
lightengine/{farmId}/system/health
```

| Segment | Description | Example |
|---------|-------------|---------|
| `lightengine` | Root namespace | — |
| `{farmId}` | Farm identifier (plain, NOT hashed — MQTT is local/farm-scoped) | `farm-001` |
| `devices/{deviceId}` | Device scope | `devices/shelly-plug-01` |
| `telemetry/{metric}` | Specific metric | `telemetry/power`, `telemetry/temperature` |
| `status` | Device online/offline/error status | — |
| `commands/{commandId}` | Command acknowledgment topic | — |

> **Note:** `farmId` in MQTT topics is the **local, unmasked** farm identifier — this is on the farm's own MQTT broker, not Central. The HMAC pseudonym is only used when data crosses the farm-Central boundary.

### 19.2 QoS Defaults

| Message Type | QoS Level | Rationale |
|-------------|-----------|-----------|
| Telemetry (periodic) | **QoS 0** (at most once) | High frequency, tolerant of occasional loss. Reduces broker load. |
| Status changes | **QoS 1** (at least once) | Must be delivered — device online/offline affects interlocks and health. |
| Commands | **QoS 1** (at least once) | Must be delivered — missed commands = safety risk. |
| Safety alerts | **QoS 1** (at least once) | Must be delivered — CO₂ threshold breach, equipment fault. |

### 19.3 Payload Validation

All MQTT payloads must be valid JSON and conform to a per-metric schema. The driver SDK should validate payloads on receipt before processing.

```javascript
// Expected telemetry payload structure
{
  "deviceId": "shelly-plug-01",
  "metric": "power",
  "value": 45.2,
  "unit": "W",
  "timestamp": "2026-02-22T14:30:00Z",
  "quality": "good"           // "good" | "uncertain" | "bad" | "stale"
}
```

**Quality indicator:** Each telemetry reading should include a `quality` field reflecting data trustworthiness. This feeds into the safety envelope's stale-state detection (AD-12).

### 19.4 Retained Message Policy

| Topic Pattern | Retained | Rationale |
|------|----------|-----------|
| `*/status` | **Yes** | New subscribers need current device state immediately |
| `*/telemetry/*` | **No** | Telemetry is time-series; stale retained values mislead |
| `*/commands/*` | **No** | Commands are ephemeral actions |

### 19.5 Session Behavior

- **Clean session:** `true` for telemetry subscribers (no need to replay missed readings)
- **Persistent session:** `false` for command publishers (commands must not be queued and replayed after reconnect — a command valid 5 minutes ago may be dangerous now)
- **Last Will and Testament (LWT):** Each device driver should publish an LWT to its `*/status` topic with payload `{ "status": "offline", "timestamp": "..." }`. This ensures the safety envelope detects device disconnection.

### 19.6 Modbus Register-Map Manifest Concept

For Modbus devices, each driver manifest should include a `register_map` section defining readable registers and their interpretations. This is analogous to MQTT topic naming but for the Modbus register address space:

```json
{
  "register_map": {
    "holding_registers": [
      { "address": 0, "name": "temperature", "type": "float32", "unit": "°C", "scale": 0.1 },
      { "address": 2, "name": "humidity", "type": "float32", "unit": "%", "scale": 0.1 }
    ],
    "coils": [
      { "address": 0, "name": "relay_1", "type": "bool", "safetyCategory": "actuator-low" }
    ]
  }
}
```

This register map should be validated against the manifest schema (Draft 2020-12, AD-15) and governs how the generic Modbus driver interprets raw register values.

---

## 20. Implementation Plan for Review *(R4)*

This section converts the proposal into an approval-ready implementation plan based on a direct code and document review performed against the current branch.

### 20.1 Review Findings Snapshot (Current Code)

Validated against current files:

- **Farm-side pseudonymization still uses plain SHA-256** in `routes/integrations.js` (`hashFarmId()`), so V-4 remains a blocker.
- **Central ingest uses UPSERT but without monotonic timestamp guard** in `greenreach-central/routes/sync.js` (`ON CONFLICT ... DO UPDATE` currently updates unconditionally).
- **Migration mismatch risk exists**: `greenreach-central/migrations/017_device_integrations.sql` does not define the composite uniqueness needed for robust conflict handling (`farm_id_hash, record_id`), while ingest expects conflict keys.
- **Discovery proxy hardening is not yet implemented** in `greenreach-central/routes/discovery-proxy.js` (no opt-in gate, role restriction, rate limiting, or audit trail enforcement).
- **AI agent has no `integrations` capability category** in `services/ai-agent.js`.
- **Integrations UI exists, but Device Wizard API flow is not wired from dashboard UX**: the Add Device action in `public/app.foxtrot.js` currently routes to `pair-devices` panel rather than executing `/api/device-wizard/*` flow.

These findings confirm that V-3/V-4/T-1/T-2/T-4/T-5/T-7 are still active and should remain prioritized.

### 20.2 Review Gate Sequence (Approval Before Build)

Before implementation starts, run these review gates in order:

1. **Gate A — Identity + Sync correctness**
  - Approve V-3 + V-4 design specifics
  - Approve hash migration/re-sync playbook
  - Confirm Central ingest single-writer assumptions (Q-2)

2. **Gate B — Safety boundary scope**
  - Approve T-1 actuator scope and unknown/stale fail-closed behavior
  - Confirm CO₂ tier thresholds and hard cutoff operating policy

3. **Gate C — Supply-chain + discovery governance**
  - Approve manifest security policy (T-5/T-6/T-7)
  - Approve discovery proxy policy (local-only default + explicit opt-in)

4. **Gate D — UX + Agent integration readiness**
  - Approve wizard UX scope for T-2/T-3
  - Approve `integrations` AI actions as read-only-first (T-4)

No code work should begin on a gate's tickets until that gate is marked approved.

### 20.3 Execution Plan (Implementation Sprints)

#### Sprint 0 — Preconditions (0.5 day)

**Scope:** V-1, V-2 validation + rollout prep

Deliverables:
- Migration state verification report (applied/pending)
- Sync flow verification artifact (farm → central ingest path)
- Baseline metrics snapshot for later regression checks

Exit criteria:
- Central schema status confirmed
- End-to-end sync evidence recorded
- Reviewer sign-off on baseline

#### Sprint 1 — Data Integrity & Privacy Foundation (1.5 days)

**Scope:** V-3, V-4

Deliverables:
- Idempotent sync with monotonic update guard based on farm-provided `record_updated_at`
- Composite uniqueness strategy for `(farm_id_hash, record_id)` aligned between migration and ingest behavior
- HMAC pseudonymization with pepper lifecycle controls in production paths
- Coordinated hash migration + replay/re-sync runbook

Validation:
- Acceptance criteria I-1 through I-4
- Migration replay dry-run in non-prod

Exit criteria:
- Duplicate sync no longer changes aggregate analytics
- Hash migration verified with deterministic record continuity policy

#### Sprint 2 — Safety Boundary (2.5 days)

**Scope:** T-1

Deliverables:
- `lib/device-safety-envelope.js` (stateful, mandatory command gateway)
- Persistent state + audit trail implementation
- Unknown/stale-state fail-closed interlock behavior

Validation:
- Acceptance criteria S-1 through S-6

Exit criteria:
- No bypass command path remains
- Safety decision records complete and queryable

#### Sprint 3 — Wiring, UX, and Agent Capability (2 days)

**Scope:** T-2, T-3, T-4

Deliverables:
- Discovery modules wired to wizard backend flow
- Dashboard UX wired to `/api/device-wizard/*` lifecycle
- AI agent `integrations` category with read-only-first action set and permission matrix entries

Validation:
- Discovery criteria D-1 through D-4
- Agent capability smoke tests for parse + execute + permission tiers

Exit criteria:
- Wizard flow is functional end-to-end from UI to persisted integration record
- AI integration actions do not bypass permission matrix

#### Sprint 4 — Manifest Governance & Registry Boundary (2.5 days)

**Scope:** T-5, T-6, T-7 (+ T-8 if capacity allows)

Deliverables:
- Draft 2020-12 manifest schema with `security_capabilities`
- Manifests for existing drivers
- Registry API with entry-point/path governance and checksum policy

Validation:
- Acceptance criteria SC-1 through SC-5

Exit criteria:
- Manifest validation and load policy enforced at startup/runtime boundaries
- Production checksum mismatch policy blocks unsafe loads

### 20.4 Required Review Artifacts per Sprint

Each sprint must produce the following artifacts for review:

- **Design diff** (what changed in proposal assumptions)
- **Implementation diff** (files/functions/endpoints)
- **Acceptance test evidence** (mapped to Section 16 criterion IDs)
- **Risk delta update** (new/retired risks in Section 10)
- **Central contract check** (backward compatibility statement)

### 20.5 Go/No-Go Checklist for Implementation Start

Implementation starts only when all are true:

- [ ] Gate A approved (identity + sync)
- [ ] Gate B approved (safety)
- [ ] Gate C approved (supply-chain + discovery)
- [ ] Gate D approved (UX + AI capability)
- [ ] Acceptance criteria ownership assigned (S, I, SC, D)
- [ ] Rollback plan documented for Sprints 1 and 2

### 20.6 Reviewer Assignment Matrix *(Execution-Ready)*

Use this matrix to run the review as a controlled handoff from decision gates to sprint execution.

#### Gate Owners and Decision Windows

| Gate | Primary Owner | Required Reviewers | Decision Window | Required Evidence |
|------|---------------|--------------------|-----------------|-------------------|
| **Gate A — Identity + Sync** | Implementation Agent (Data/Sync) | Review Agent, Architecture Agent | T+0 to T+1 day | V-3/V-4 design diff, migration plan, hash migration runbook, I-1..I-4 test plan |
| **Gate B — Safety Boundary** | Implementation Agent (Safety/Controls) | Review Agent, Architecture Agent | T+1 to T+2 day | T-1 control boundary design, interlock matrix, fail-closed policy, S-1..S-6 test plan |
| **Gate C — Supply Chain + Discovery** | Implementation Agent (Platform Security) | Review Agent, Architecture Agent | T+2 to T+3 day | Manifest governance spec, checksum policy matrix, discovery proxy policy, SC-1..SC-5 and D-1..D-5 test plan |
| **Gate D — UX + Agent Readiness** | Implementation Agent (UX/AI Agent) | Review Agent, Product/Architecture | T+3 to T+4 day | Wizard UX flow, API sequence diagram, permission matrix update, read-only integration action list |

#### Sprint Ownership and Review Cadence

| Sprint | Implementation Owner | Review Owner | Architecture Sign-off | Demo / Evidence Due |
|--------|----------------------|--------------|------------------------|---------------------|
| **Sprint 0** | Data Platform Engineer | Review Agent | Architecture Agent | End of day T+1 |
| **Sprint 1** | Farm+Central Sync Engineer | Review Agent | Architecture Agent | End of day T+3 |
| **Sprint 2** | Controls/Safety Engineer | Review Agent | Architecture Agent | End of day T+6 |
| **Sprint 3** | Full-stack UX + AI Agent Engineer | Review Agent | Architecture Agent | End of day T+8 |
| **Sprint 4** | Platform Security Engineer | Review Agent | Architecture Agent | End of day T+11 |

#### Acceptance Criteria Ownership Map

| Criteria Set | Owner | Secondary Reviewer | Required Artifact |
|--------------|-------|--------------------|-------------------|
| **S-1..S-6** (Safety) | Controls/Safety Engineer | Review Agent | Safety boundary test report + audit trail samples |
| **I-1..I-4** (Idempotency) | Data/Sync Engineer | Review Agent | DB before/after evidence + replay logs |
| **SC-1..SC-5** (Supply-chain) | Platform Security Engineer | Review Agent | Manifest validation logs + startup enforcement evidence |
| **D-1..D-5** (Discovery) | Full-stack Engineer | Review Agent | Discovery test capture + fallback UX evidence |

#### Decision Log Template (Fill During Review)

| Item | Decision | Owner | Date | Evidence Link | Status |
|------|----------|-------|------|---------------|--------|
| DP-1 farm ID guessability | **HMAC-SHA-256 required** | Data/Sync Lead | 2026-02-23 | docs/review/evidence/dp1-farm-id-risk.md | Proposed |
| DP-3 safety scope (CO₂/lighting) | **Include CO₂ in T-1, defer lighting to Phase 2** | Controls/Safety Lead | 2026-02-23 | docs/review/evidence/dp3-safety-scope.md | Proposed |
| DP-6 pack code policy | **Metadata-only packs; code via deploy channel** | Platform Security Lead | 2026-02-24 | docs/review/evidence/dp6-pack-policy.md | Proposed |
| DP-10 discovery proxy posture | **Local-only default; admin opt-in with audit + rate limits** | Platform Security Lead | 2026-02-24 | docs/review/evidence/dp10-discovery-proxy.md | Proposed |
| DP-11 outbox threshold | **UPSERT now; evaluate outbox >1000 records/farm or >50 farms** | Data Platform Lead | 2026-02-24 | docs/review/evidence/dp11-outbox-threshold.md | Proposed |

#### Week-1 Review Calendar (Suggested)

| Date | Session | Scope | Required Attendees | Output |
|------|---------|-------|--------------------|--------|
| 2026-02-23 (AM) | Gate A Review | V-3, V-4, DP-1, DP-11 | Data/Sync Lead, Review Agent, Architecture Agent | Gate A decision + migration/hashing action list |
| 2026-02-23 (PM) | Gate B Review | T-1, DP-3 | Controls/Safety Lead, Review Agent, Architecture Agent | Gate B decision + safety acceptance ownership |
| 2026-02-24 (AM) | Gate C Review | T-5/T-6/T-7, DP-6, DP-10 | Platform Security Lead, Review Agent, Architecture Agent | Gate C decision + manifest/proxy policy lock |
| 2026-02-24 (PM) | Gate D Review | T-2/T-3/T-4 | Full-stack Lead, AI Agent Lead, Review Agent | Gate D decision + sprint start checklist |

#### Operational Rule

No sprint starts until its prerequisite gate row is marked **Approved** and its acceptance criteria owner has posted initial evidence placeholders.

### 20.7 Implementation Kickoff (Initiated 2026-02-22)

The review plan is now converted into executable artifacts and an active first tranche.

#### Kickoff Status

- [x] Decision evidence placeholders created under `docs/review/evidence/`
- [x] Gate calendar defined for Week 1 (Section 20.6)
- [x] Acceptance ownership mapped (Section 20.6)
- [ ] Gate A approved (required before Sprint 1 code freeze)
- [ ] Gate B approved
- [ ] Gate C approved
- [ ] Gate D approved

#### Evidence Package Paths (Initialized)

- `docs/review/evidence/dp1-farm-id-risk.md`
- `docs/review/evidence/dp3-safety-scope.md`
- `docs/review/evidence/dp6-pack-policy.md`
- `docs/review/evidence/dp10-discovery-proxy.md`
- `docs/review/evidence/dp11-outbox-threshold.md`

#### First Implementation Tranche (Phase 1, P0)

Scope to begin immediately after Gate A decision:

1. Enforce stronger farm pseudonymization path (HMAC migration decision DP-1)
2. Harden idempotent sync/UPSERT monotonic guards (DP-11)
3. Capture end-to-end ingest evidence for `POST /api/sync/experiment-records`

Definition of done for this tranche:

- I-1..I-4 criteria evidence attached in the `docs/review/evidence/` package
- One replay/resubmission test demonstrates no stale overwrite
- Central ingest compatibility proof captured (request/response + schema validation)

---

## Appendix A: File Inventory

All files related to the Integration Assistant, verified to exist on disk:

```
lib/
  device-driver.js              382 lines  ✅ Base class + registry
  device-wizard.js              645 lines  ✅ 6-step wizard controller
  device-health-tracker.js      327 lines  ✅ Uptime tracking
  device-discovery.js           303 lines  ✅ Discovery engine (not wired to wizard)

routes/
  integrations.js               383 lines  ✅ CRUD + sync
  mdns-discovery.js             198 lines  ✅ mDNS discovery

automation/drivers/
  switchbot-driver.js           213 lines  ✅ SwitchBot protocol
  kasa-driver.js                184 lines  ✅ Kasa protocol
  shelly-driver.js              116 lines  ✅ Shelly protocol

services/
  hardware-detection.js         268 lines  ✅ USB/serial/network scan
  ai-agent.js                  1576 lines  ✅ No integration skills yet

greenreach-central/
  migrations/017_device_integrations.sql    63 lines  ✅ Central schema
  routes/network-devices.js               407 lines  ✅ Analytics
  routes/discovery-proxy.js                90 lines  ✅ Proxy
  services/ai-recommendations-pusher.js     — lines  ✅ Push recommendations

server-foxtrot.js (wiring):
  Line 11549: import integrationsRouter
  Line 11550: import createWizardHandlers
  Lines 11592-11600: /api/integrations mount
  Lines 11617-11626: /api/device-wizard/* mount
  Lines 8389-8647: SwitchBot routes
  Lines 8647-8867: Kasa routes
```

## Appendix B: Related Documents

| Document | Lines | Purpose |
|----------|-------|---------|
| `IMPLEMENTATION_PLAN_INTEGRATION_ASSISTANT_2026-02-22.md` | 561 | Existing ticket tracking (Phases 1–4 complete, Phase 6 deferred) |
| `INTEGRATION_ASSISTANT_IMPLEMENTATION_STRATEGY_2026-02-22.md` | 372 | Strategy evaluation (recommends Option B) |
| `IMPLEMENTATION_PLAN_AI_GROWTH_2026-02-21.md` | 350 | Master AI Growth roadmap (Phases 0–5, 43 tickets) |
| `AI_AGENT_DOCUMENTATION.md` | — | AI agent architecture docs |
| `AI_AGENT_OPERATING_ACTION_PLAN_2026-02-21.md` | — | Agent operating procedures |

---

*End of proposal (R3). Executive assessment (R2) and deep research review (R3) feedback have been incorporated. This document is ready for team review and decision on the targeted questions in §17.*
