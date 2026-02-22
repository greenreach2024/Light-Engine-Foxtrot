# Integration Assistant - Implementation Strategy

Date: 2026-02-22  
Branch: recovery/feb11-clean  
Status: **REVIEW DRAFT**  
Related: IMPLEMENTATION_PLAN_AI_GROWTH_2026-02-21.md, AI_INTEGRATION_PROPOSAL.md

---

## Executive Summary

This document evaluates the Integration Assistant proposal against the existing Light Engine codebase and proposes a phased implementation strategy that:
1. Reuses existing infrastructure (NeDB stores, Central sync, AI push channel)
2. Follows established rules (Central-first, safety, recommend-before-automate)
3. Integrates with the in-progress AI Growth roadmap

**Verdict**: The proposal is architecturally sound and aligns with existing patterns. However, it should be scoped as **Phase 6** of the AI Growth roadmap (after Phase 5: Autonomous Operations) OR run as a parallel workstream that doesn't block the critical path for yield intelligence.

---

## Proposal Review: What's Valid ✅

### 1. Device Integration Layer (DIL) Concept
**Valid** — The system already has fragmented device code:
- `js/iot-manager.js` — Basic IoT device UI management
- `/api/switchbot/devices/*` — SwitchBot-specific routes (server-foxtrot.js:8389-8647)
- `/api/kasa/devices/*` — Kasa-specific routes (server-foxtrot.js:8647-8867)
- `/devices` — Generic device routes (server-foxtrot.js:6229-6262)
- `equipmentInventoryDB` — NeDB store for equipment (server-foxtrot.js:17939)

A unified DIL would consolidate these into a coherent module.

### 2. Driver/Adapter Pattern
**Valid** — Current device code is protocol-specific:
- `js/switchbot-helpers.js` — SwitchBot protocol helpers
- `lib/atlas-scientific/` — Atlas Scientific sensor drivers
- Manual Kasa/SwitchBot API calls scattered in server.js

Abstracting into a driver interface with manifests would enable:
- Plugin discovery
- Capability declaration
- Testable contracts

### 3. Use Existing Central Sync (Rule 7.2)
**Valid** — The proposal correctly identifies existing pipes:
- **Farm → Central**: 5-min sync via `syncFarmData()` 
- **Central → Farm**: 30-min AI push via `POST /api/health/ai-recommendations`
- **payload.network_intelligence**: Already extended for crop benchmarks, recipe modifiers, demand signals

Integration records can flow through the same channel.

### 4. Safety Model for Actuators
**Valid** — Aligns with Rule 8.2 (safety overrides). The proposal's "Control Safety Envelope" matches existing patterns:
- `requireRole(['manager', 'admin'])` in farm-auth.js
- VPD automation has limits/interlocks
- Automation rules have enable/disable states

### 5. Canonical Integration Record
**Valid** — Follows the experiment record pattern (server-foxtrot.js:10066):
- Structured data for aggregation
- farm_id anonymized before Central sync
- Grower feedback captured

### 6. Add Device Wizard Workflow
**Valid** — The 6-step flow matches existing wizard patterns:
- Setup Wizard (`routes/setup-wizard.js`) — multi-step onboarding
- Farm Registration (`routes/farms.js`) — registration code flow
- Activity Hub order flow — multi-step confirmation

---

## Proposal Review: Concerns & Gaps ⚠️

### 1. Scope Overlap with AI Growth Roadmap
**Concern**: The AI Growth roadmap (Phase 0-5) is the current execution priority. Adding Integration Assistant as a parallel workstream risks:
- Engineering bandwidth split
- Two roadmaps competing for same code areas
- Unclear prioritization when conflicts arise

**Recommendation**: Position as Phase 6, OR extract 2-3 high-value tickets into existing phases.

### 2. Driver SDK Complexity
**Concern**: The proposed TypeScript interface is comprehensive but may be over-engineered for current needs:
```typescript
export interface DeviceDriver {
  discover?(ctx: DriverContext): Promise<DiscoveredDevice[]>;
  configure(ctx: DriverContext, input: ConfigInput): Promise<ConfiguredDevice>;
  readTelemetry(ctx: DriverContext, device: ConfiguredDevice): Promise<TelemetrySnapshot>;
  subscribeTelemetry?(...): Promise<Unsubscribe>;
  commands?: { [commandName: string]: (...) => Promise<CommandResult>; };
  validate(ctx: DriverContext, device: ConfiguredDevice): Promise<ValidationReport>;
  healthCheck(ctx: DriverContext, device: ConfiguredDevice): Promise<DeviceHealth>;
}
```

Current device integrations are simpler:
- SwitchBot: HTTP API calls, polling for status
- Kasa: Local network discovery, direct control
- Atlas: Serial/I2C communication

**Recommendation**: Start with minimal driver interface (connect, read, command) and expand as needed.

### 3. Missing MVP Definition
**Concern**: The proposal jumps to full architecture without defining:
- Which devices to support first?
- What's the minimum viable Add Device flow?
- What's the smallest Central integration that provides value?

**Recommendation**: Define MVP as "Add generic MQTT sensor with validation + Central sync."

### 4. No Central Database Schema
**Concern**: The proposal defines farm-side integration records but not Central tables:
- Where do integration records land in Central PostgreSQL?
- What indexes for aggregation queries?
- How does the "Integration Pack Library" store driver templates?

**Recommendation**: Add database migration tickets to Phase 1.

### 5. UI/UX Not Specified
**Concern**: No mockups or wireframes for:
- Add Device Wizard screens
- Device health dashboard
- Integration status indicators

**Recommendation**: Create low-fidelity wireframes before implementation.

### 6. Existing IoT Manager Conflict
**Concern**: `js/iot-manager.js` already has device UI logic (templates, room/zone assignment). The proposal doesn't mention refactoring this.

**Recommendation**: Either extend IoT Manager with new capabilities OR replace entirely (migration path needed).

---

## Existing Infrastructure Inventory

### Farm-Side (Light Engine)

| Component | Location | Status | Reusable For |
|-----------|----------|--------|--------------|
| IoT Devices Manager | `js/iot-manager.js` | Operational | Device list UI, assignment dropdowns |
| SwitchBot Routes | `server-foxtrot.js:8389-8647` | Operational | Refactor into SwitchBot driver |
| Kasa Routes | `server-foxtrot.js:8647-8867` | Operational | Refactor into Kasa driver |
| Atlas Scientific | `lib/atlas-scientific/` | Operational | Existing driver pattern |
| Equipment Inventory DB | `equipmentInventoryDB` (NeDB) | Operational | Store integration records |
| Device DB | `deviceDB` referenced at L6645 | Unknown | May need creation |
| Health Routes | `routes/health.js` | Operational | Receive AI recommendations |
| AI Agent Service | `services/ai-agent.js` | Operational | Add Integration Assistant skills |

### Central-Side (GreenReach Central)

| Component | Location | Status | Reusable For |
|-----------|----------|--------|--------------|
| AI Recommendations Pusher | `services/ai-recommendations-pusher.js` | Operational | Push integration packs |
| Experiment Records Ingest | `routes/experiment-records.js` | Operational | Pattern for integration records |
| Farm Data Sync | `POST /api/sync/farm-data` | Operational | Receive integration records |
| PostgreSQL | `config/database.js` | Operational | Store integration metadata |
| Network Growers | `routes/network-growers.js` | Stub | Add device analytics endpoints |

### Sync Contracts

| Channel | Direction | Frequency | Payload |
|---------|-----------|-----------|---------|
| Farm Data Sync | Farm → Central | 5 min | telemetry, groups, config, **NEW: integration_records** |
| AI Recommendations | Central → Farm | 30 min | recommendations, network_intelligence, **NEW: device_integrations** |
| Experiment Records | Farm → Central | On harvest | structured outcome data |

---

## Proposed Implementation Strategy

### Option A: Phase 6 (Sequential)
Add as Phase 6 to AI Growth roadmap, after Phase 5 completes (~Day 210).

**Pros**: Clean separation, no conflicts, full focus on yield intelligence first  
**Cons**: Delays integration features by 6+ months

### Option B: Extract High-Value Tickets (Recommended)
Pull 4-5 integration tickets into existing phases, defer full architecture.

**Pros**: Deliver value incrementally, validate assumptions, avoid over-engineering  
**Cons**: Requires careful scoping to avoid bloat

### Option C: Parallel Workstream
Run as independent workstream alongside AI Growth.

**Pros**: Progress on both fronts  
**Cons**: Engineering bandwidth split, coordination overhead, merge conflicts

---

## Recommended Path: Option B — Extracted Tickets

### Phase 1 Additions (Wire the Data)

| # | Ticket | Owner | Effort | Files |
|---|--------|-------|--------|-------|
| 1.8 | **Create device registry schema** — Add `integrations` table to Central: device_make_model, driver_id, protocol, capabilities, success_count, failure_count. Index by driver_id for aggregation. | Central | S | `greenreach-central/migrations/`, `config/database.js` |
| 1.9 | **Extend farm-data sync with integrations** — Add `integration_records` array to `syncFarmData()` payload (debounced, last 24h of changes only). Central ingests to `integrations` table. | Edge + Central | M | `server-foxtrot.js` (sync job), `greenreach-central/routes/farms.js` |

### Phase 2 Additions (Agent MVPs)

| # | Ticket | Owner | Effort | Files |
|---|--------|-------|--------|-------|
| 2.9 | **Minimal driver interface** — Create `lib/device-driver.js` with base interface: `connect()`, `readStatus()`, `sendCommand()`, `disconnect()`. Refactor SwitchBot routes to use interface. | Edge | M | New: `lib/device-driver.js`, refactor `routes/switchbot.js` |
| 2.10 | **Add Device Wizard MVP** — Simple wizard UI for adding MQTT sensor: enter broker URL, topic, test connection, assign to room/zone. Store in `integrationDB`. | Edge | M | New: `public/views/add-device.html`, `routes/integrations.js` |

### Phase 3 Additions (Closed-Loop Learning)

| # | Ticket | Owner | Effort | Files |
|---|--------|-------|--------|-------|
| 3.10 | **Device uptime tracking** — Track connection success/failure per device, compute uptime %. Sync to Central. | Edge | S | `lib/device-health-tracker.js` |
| 3.11 | **Network device adoption analytics** — Central aggregates device adoption by type, protocol, success rate. Surface in admin dashboard. | Central | M | `greenreach-central/routes/network-devices.js` |

### Phase 4 Additions (Network Coordination)

| # | Ticket | Owner | Effort | Files |
|---|--------|-------|--------|-------|
| 4.9 | **Push integration recommendations** — Extend `network_intelligence` payload with `device_integrations`: "87% of farms using driver X v2.1 report better stability." | Central | S | `services/ai-recommendations-pusher.js` |
| 4.10 | **Driver version warnings** — Push warnings for problematic driver versions based on network failure rates. | Central | S | `services/ai-recommendations-pusher.js` |

### Phase 6 (Full Integration Assistant) — Future

Defer until Phase 5 complete:
- Full driver SDK with manifests
- Auto-discovery protocols (mDNS, BLE scan)
- Calibration workflows
- Integration Pack Library with versioning
- Network Integration Curator agent

---

## Minimal Viable Integration Record

```javascript
{
  record_id: "INT-20260222-001",
  farm_id: "GR-00001",  // Anonymized before sync
  timestamp: "2026-02-22T10:35:00Z",
  
  // Device info
  device_type: "sensor",
  device_make_model: "Sonoff TH16",
  protocol: "mqtt",
  driver_id: "mqtt.generic.v1",
  driver_version: "1.0.0",
  
  // Capabilities
  capabilities: {
    telemetry: ["temp_c", "humidity_pct"],
    commands: []
  },
  
  // Install context (for network learning)
  install_context: {
    room_type: "grow_room",
    system_type: "indoor_vertical",
    mounting: "canopy_level"
  },
  
  // Validation results
  validation: {
    passed: true,
    signal_quality: 0.95,
    dropout_rate: 0.02,
    latency_ms: 120
  },
  
  // Grower feedback
  feedback: {
    rating: "thumbs_up",
    comment: "Easy setup"
  }
}
```

---

## Safety Envelope (Required for Actuators)

```javascript
// lib/device-safety-envelope.js
export const SAFETY_LIMITS = {
  relay: {
    max_on_time_seconds: 3600,      // 1 hour max
    min_off_time_seconds: 60,       // 1 minute cooldown
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
    max_on_time_seconds: 300,       // 5 minutes max
    min_off_time_seconds: 120,      // 2 minute cooldown
    max_cycles_per_hour: 10,
    requires_confirmation: true,
    interlocks: ["no_simultaneous_pumps"]
  }
};

export function validateCommand(device, command, args) {
  const limits = SAFETY_LIMITS[device.type];
  if (!limits) return { allowed: true };
  
  // Check interlocks
  // Check timing constraints
  // Check rate limits
  // Return { allowed: boolean, reason?: string }
}
```

---

## Implementation Timeline

```
EXISTING ROADMAP:
Days 1-10    PHASE 0  Fix Foundations         5 tickets
Days 11-30   PHASE 1  Wire the Data           7 tickets + 2 NEW (1.8, 1.9)
Days 31-60   PHASE 2  Agent MVPs              8 tickets + 2 NEW (2.9, 2.10)
Days 61-100  PHASE 3  Closed-Loop Learning    9 tickets + 2 NEW (3.10, 3.11)
Days 101-150 PHASE 4  Network Coordination    8 tickets + 2 NEW (4.9, 4.10)
Days 151-210 PHASE 5  Autonomous Operations   6 tickets

FUTURE:
Days 211-300 PHASE 6  Full Integration Assistant (deferred)
```

**Net Addition**: 10 new tickets spread across existing phases.  
**Effort Impact**: ~15% increase to timeline (adds ~30 days).

---

## Decision Points for Review

1. **Scope**: Accept Option B (extracted tickets) or prefer Option A/C?
2. **MVP Device**: Start with MQTT generic OR SwitchBot (already integrated)?
3. **UI Priority**: Build wizard UI in Phase 2 OR defer to Phase 3?
4. **Central Schema**: Add `integrations` table in Phase 1 OR wait for more data?
5. **Driver SDK**: Minimal interface (3 methods) OR full interface (7 methods)?

---

## Immediate Next Actions (If Approved)

1. **Add ticket 1.8** to Phase 1 — Central database schema
2. **Add ticket 1.9** to Phase 1 — Extend sync payload
3. **Draft wireframes** for Add Device Wizard
4. **Refactor SwitchBot** routes as proof-of-concept driver

---

## Appendix: Proposal-to-Codebase Mapping

| Proposal Component | Existing Asset | Gap |
|-------------------|----------------|-----|
| Device Integration Layer | Scattered routes | Needs consolidation |
| Driver/Adapter Model | Atlas Scientific, protocol helpers | Needs interface abstraction |
| Device Capability Registry | `equipmentInventoryDB` | Needs capability schema |
| Integration Wizard UI | Setup Wizard pattern | Needs new wizard |
| Network Device Registry | `farms` table | Needs `integrations` table |
| Integration Pack Library | None | Future (Phase 6) |
| AI Push Channel | `ai-recommendations-pusher.js` | Ready to extend |
| Integration Assistant Agent | `ai-agent.js` | Needs new skills |
| Network Integration Curator | None | Future (Phase 6) |

---

*This strategy aligns the Integration Assistant vision with the existing AI Growth roadmap, delivering incremental value without disrupting the critical path for yield intelligence.*
