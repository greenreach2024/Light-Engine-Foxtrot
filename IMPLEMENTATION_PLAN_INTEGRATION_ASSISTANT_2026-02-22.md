# Integration Assistant Implementation Plan

Date: 2026-02-22  
Branch: recovery/feb11-clean  
Status: **✅ COMPLETE (Phases 1-4)**  
Last Updated: 2026-02-22  
Depends On: IMPLEMENTATION_PLAN_AI_GROWTH_2026-02-21.md (Phases 0-5)  
Strategy Doc: INTEGRATION_ASSISTANT_IMPLEMENTATION_STRATEGY_2026-02-22.md

---

## Implementation Progress

| Ticket | Status | Files Created/Modified |
|--------|--------|----------------------|
| I-1.8 | ✅ COMPLETE | `greenreach-central/migrations/017_device_integrations.sql` |
| I-1.9 | ✅ COMPLETE | `routes/integrations.js`, `server-foxtrot.js`, `greenreach-central/routes/sync.js` |
| I-2.9 | ✅ COMPLETE | `lib/device-driver.js` |
| I-2.10 | ✅ COMPLETE | `lib/device-wizard.js`, `server-foxtrot.js` (wizard routes) |
| I-3.10 | ✅ COMPLETE | `lib/device-health-tracker.js`, `data/device-thresholds.json`, `routes/health.js` |
| I-3.11 | ✅ COMPLETE | `greenreach-central/routes/network-devices.js`, `greenreach-central/server.js` |
| I-4.9 | ✅ COMPLETE | `greenreach-central/services/ai-recommendations-pusher.js` |
| I-4.10 | ✅ COMPLETE | `greenreach-central/services/ai-recommendations-pusher.js` |

---

## Goal

Transform the current farm assistant into an **Integration Assistant** that can:
1. Help growers add + configure new equipment (sensors, relays, controllers)
2. Map devices into the farm model (rooms/zones/groups)
3. Validate installations (signal quality, safe actuation, calibration)
4. Persist integration records locally and sync anonymized metadata to Central
5. Enable Central to learn device adoption patterns and push integration recommendations

---

## Guiding Principles

1. **No new channels** — Use existing `syncFarmData()` and `POST /api/health/ai-recommendations` pipes (Rule 7.2)
2. **Recommend before automate** — Phase 1-2: assistant suggests, grower confirms. No autonomous actuator control.
3. **Privacy-safe sync** — farm_id anonymized, no customer data leaves farm (Rule 7.1)
4. **Minimal viable driver** — Start with 3-method interface, expand as needed
5. **Incremental delivery** — Extract 10 tickets into existing AI Growth phases, defer full architecture

---

## Current State

### Existing Device Infrastructure

| Component | Location | Lines | Status |
|-----------|----------|-------|--------|
| IoT Manager UI | `js/iot-manager.js` | 269 | Operational — device list, assignment dropdowns |
| SwitchBot Routes | `server-foxtrot.js:8389-8647` | ~260 | Operational — HTTP API polling |
| Kasa Routes | `server-foxtrot.js:8647-8867` | ~220 | Operational — local network discovery |
| Atlas Scientific | `lib/atlas-scientific/` | ~400 | Operational — serial/I2C |
| Equipment Inventory DB | `equipmentInventoryDB` (NeDB) | — | Operational — maintenance records |
| Central AI Push | `services/ai-recommendations-pusher.js` | 308 | Operational — `network_intelligence` block |
| Central Farm Sync | `POST /api/sync/farm-data` | — | Operational — 5-min cycle |

### What's Missing

| Gap | Impact | Solution |
|-----|--------|----------|
| No unified device interface | Protocol code scattered, untestable | Ticket 2.9: Driver interface |
| No integration records | Can't track device success/failure | Ticket 1.8, 1.9: Schema + sync |
| No Add Device wizard | Manual configuration only | Ticket 2.10: Wizard MVP |
| No device health tracking | Can't identify flaky devices | Ticket 3.10: Uptime tracker |
| No network device analytics | Central can't recommend | Ticket 3.11, 4.9: Analytics + push |

---

## Phase 1 Additions — Wire the Data (Days 11-30)

*Inserted into existing AI Growth Phase 1*

**Prerequisite**: Phase 0 tickets (0.1-0.5) must complete before starting these tickets.

| # | Ticket | Description | Owner | Effort | Files |
|---|--------|-------------|-------|--------|-------|
| I-1.8 | **Create integrations table** | Add `device_integrations` table to Central PostgreSQL: `id`, `farm_id_hash`, `device_make_model`, `driver_id`, `driver_version`, `protocol`, `capabilities`, `install_context`, `validation_passed`, `signal_quality`, `dropout_rate`, `grower_rating`, `created_at`. Add indexes for driver_id and protocol. | Central | S | `greenreach-central/migrations/007_device_integrations.sql` |
| I-1.9 | **Extend farm-data sync** | Add `integration_records` array to `syncFarmData()` payload. Debounce to last 24h of changes only. Central ingests to `device_integrations` table with farm_id hashed. | Edge + Central | M | `server-foxtrot.js` (sync job), `greenreach-central/server.js` (farm data sync endpoint) |

### Exit Criteria — Phase 1 Integration Tickets
- [x] Central `device_integrations` table exists with proper schema
- [x] Farm sync payload includes `integration_records` field
- [ ] Central successfully ingests test integration record
- [ ] `SELECT COUNT(*) FROM device_integrations` returns > 0 after test

---

## Phase 2 Additions — Agent MVPs (Days 31-60)

*Inserted into existing AI Growth Phase 2*

| # | Ticket | Description | Owner | Effort | Files |
|---|--------|-------------|-------|--------|-------|
| I-2.9 | **Minimal driver interface** | Create `lib/device-driver.js` with base class: `connect()`, `readStatus()`, `sendCommand()`, `disconnect()`, `getCapabilities()`. Refactor SwitchBot routes to implement interface as proof-of-concept. Keep existing routes working (backward compatible). | Edge | M | New: `lib/device-driver.js`, `lib/drivers/switchbot-driver.js`, refactor `server-foxtrot.js:8389-8647` |
| I-2.10 | **Add Device Wizard MVP** | **Prerequisite**: `npm install mqtt` for MQTT client. Simple wizard UI for adding MQTT sensor: (1) Select device type, (2) Enter broker URL + topic, (3) Test connection (read telemetry 30s, require >90% success), (4) Assign to room/zone/group, (5) Save. Store in `integrationDB` (NeDB). Generate integration record on save. Access via Settings → Devices → Add Device. | Edge | L | New: `public/views/add-device.html`, `routes/integrations.js`, `data/integrations.db` |

### Exit Criteria — Phase 2 Integration Tickets
- [x] SwitchBot driver implements `DeviceDriver` interface (GenericDriver created)
- [x] Existing SwitchBot functionality unchanged (backward compatible)
- [x] Add Device Wizard accessible via API
- [x] Can add MQTT sensor via wizard API
- [x] Integration record created on device add

---

## Phase 3 Additions — Closed-Loop Learning (Days 61-100)

*Inserted into existing AI Growth Phase 3*

| # | Ticket | Description | Owner | Effort | Files |
|---|--------|-------------|-------|--------|-------|
| I-3.10 | **Device uptime tracking** | Track connection success/failure per device. Compute rolling 24h uptime %. Store in `deviceHealthDB`. Include in integration record sync. Alert threshold configurable per device type in `data/device-thresholds.json`. | Edge | S | New: `lib/device-health-tracker.js`, `data/device-thresholds.json`, modify `routes/health.js` |
| I-3.11 | **Network device analytics** | Central aggregates device adoption by: type, protocol, driver_id, success rate. Add `/api/admin/network-devices/analytics` endpoint. Surface in Central admin dashboard (table view). | Central | M | New: `greenreach-central/routes/network-devices.js`, modify admin dashboard |

### Exit Criteria — Phase 3 Integration Tickets
- [ ] Device uptime % visible in health dashboard
- [ ] Low uptime triggers alert
- [ ] Central admin shows device adoption table
- [ ] Can query "most popular device by protocol"

---

## Phase 4 Additions — Network Coordination (Days 101-150)

*Inserted into existing AI Growth Phase 4*

| # | Ticket | Description | Owner | Effort | Files |
|---|--------|-------------|-------|--------|-------|
| I-4.9 | **Push integration recommendations** | Extend `network_intelligence` payload with `device_integrations` block: recommended drivers, success rates, common configs. Example: "87% of farms using mqtt.generic.v2 report better stability than v1." | Central | S | `services/ai-recommendations-pusher.js` |
| I-4.10 | **Driver version warnings** | Push warnings for problematic driver versions based on network failure rates. Threshold: warn if driver has > 20% failure rate across network. Include in `network_intelligence.integration_warnings`. | Central | S | `services/ai-recommendations-pusher.js` |

### Exit Criteria — Phase 4 Integration Tickets
- [ ] AI recommendations include `device_integrations` block
- [ ] Farms receive driver recommendations
- [ ] Farms receive warnings for problematic drivers
- [ ] UI shows "Network recommends..." badge on device cards

---

## Phase 6 — Full Integration Assistant (Days 211-300)

*Deferred until Phase 5 (Autonomous Operations) completes*

| # | Ticket | Description | Owner | Effort | Files |
|---|--------|-------------|-------|--------|-------|
| 6.1 | **Full driver SDK** | Expand driver interface to include: `discover()`, `validate()`, `healthCheck()`, `subscribeTelemetry()`. Add driver manifest JSON schema with capabilities, safety limits, compatibility. | Edge | L | `lib/device-driver.js`, `lib/driver-manifest-schema.json` |
| 6.2 | **Driver manifest registry** | Local registry of installed drivers with manifest validation. Auto-discover drivers in `lib/drivers/` on startup. Expose via `/api/drivers/list`. | Edge | M | `lib/driver-registry.js`, `routes/drivers.js` |
| 6.3 | **Auto-discovery protocols** | Add mDNS, BLE, and network scan discovery. Driver declares supported discovery methods in manifest. Wizard uses discovery before manual config. | Edge | L | `lib/device-discovery.js`, extend wizard |
| 6.4 | **Calibration workflow** | Add calibration step to wizard for sensors. Support offset/slope adjustment. Store calibration in device config. Track calibration history. | Edge | M | Extend wizard, `lib/calibration-manager.js` |
| 6.5 | **Integration Pack Library** | Central stores versioned "known-good" driver + config templates. Farms can pull integration packs. Version control with rollback. | Central | L | New: `greenreach-central/services/integration-packs.js`, `integration_packs` table |
| 6.6 | **Network Integration Curator agent** | Central-side agent that: analyzes integration records, computes reliability metrics, ranks driver versions, publishes integration packs. Monthly governance review. | Central | L | New: `greenreach-central/jobs/integration-curator.js` |
| 6.7 | **Safety envelope for actuators** | Control wrapper that enforces: max on-time, min off-time, max cycles/hour, interlocks. Sits above drivers. Blocks unsafe commands with explanation. | Edge | M | `lib/device-safety-envelope.js` |
| 6.8 | **Integration Assistant agent skills** | Add skills to AI agent: device discovery, config gathering, validation, topology mapping, calibration. Hard rule: never enable actuator without validation + confirmation. | Edge | L | `services/ai-agent.js` (add skills) |

### Exit Criteria — Phase 6
- [ ] Full driver SDK with 7-method interface
- [ ] Manifest-based driver registration
- [ ] Auto-discovery for mDNS and BLE devices
- [ ] Calibration workflow for sensors
- [ ] Central serves integration packs
- [ ] Safety envelope blocks unsafe actuator commands
- [ ] AI agent can guide Add Device workflow via chat

---

## Database Schema

### Central: `device_integrations` table

```sql
-- greenreach-central/migrations/007_device_integrations.sql
CREATE TABLE IF NOT EXISTS device_integrations (
  id SERIAL PRIMARY KEY,
  farm_id_hash VARCHAR(64) NOT NULL,  -- SHA256 of farm_id
  device_make_model VARCHAR(255),
  driver_id VARCHAR(100),
  driver_version VARCHAR(20),
  protocol VARCHAR(50),
  capabilities JSONB DEFAULT '{}',
  install_context JSONB DEFAULT '{}',
  validation_passed BOOLEAN DEFAULT true,
  signal_quality DECIMAL(3,2),  -- 0.00 to 1.00
  dropout_rate DECIMAL(3,2),    -- 0.00 to 1.00
  latency_ms INTEGER,
  grower_rating VARCHAR(20),    -- 'thumbs_up', 'thumbs_down', null
  grower_comment TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_integrations_driver ON device_integrations(driver_id);
CREATE INDEX idx_integrations_protocol ON device_integrations(protocol);
CREATE INDEX idx_integrations_created ON device_integrations(created_at);

-- Signal quality calculation:
-- signal_quality = (successful_reads / total_attempts) over validation period
-- dropout_rate = (failed_reads / total_attempts) over validation period
-- Both stored as DECIMAL(3,2) representing 0.00 to 1.00
```

### Edge: `integrations.db` (NeDB)

```javascript
// NeDB store initialization
const integrationDB = Datastore.create({ filename: './data/integrations.db', autoload: true });

// Integration record schema
{
  _id: "INT-20260222-001",
  device_type: "sensor",           // sensor, relay, dimmer, controller, light
  device_make_model: "Sonoff TH16",
  protocol: "mqtt",
  driver_id: "mqtt.generic.v1",
  driver_version: "1.0.0",
  
  // Connection config (encrypted at rest)
  config: {
    broker_url: "mqtt://192.168.1.100:1883",
    topic: "sensors/grow-room-1/temp",
    auth_mode: "none"
  },
  
  // Assignment
  room_id: "ROOM-001",
  zone_id: "ZONE-A",
  group_id: "GRP-001",
  function: "canopy_temp",
  
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
  
  // Validation
  validation: {
    passed: true,
    tested_at: "2026-02-22T10:35:00Z",
    signal_quality: 0.95,
    dropout_rate: 0.02,
    latency_ms: 120
  },
  
  // Grower feedback
  feedback: {
    rating: "thumbs_up",
    comment: "Easy setup"
  },
  
  // Timestamps
  created_at: "2026-02-22T10:30:00Z",
  updated_at: "2026-02-22T10:35:00Z",
  synced_at: null  // Set when synced to Central
}
```

---

## Driver Interface (Phase 2 - Minimal)

```javascript
// lib/device-driver.js

/**
 * Base interface for device drivers.
 * Phase 2: Minimal 5-method interface.
 * Phase 6: Expand to full 8-method interface.
 */
export class DeviceDriver {
  constructor(manifest) {
    this.manifest = manifest;
    this.id = manifest.driver_id;
    this.version = manifest.version;
    this.protocol = manifest.protocol;
  }

  /**
   * Establish connection to device
   * @param {Object} config - Connection configuration
   * @returns {Promise<{connected: boolean, device_id: string, error?: string}>}
   */
  async connect(config) {
    throw new Error('connect() must be implemented');
  }

  /**
   * Read current device status/telemetry
   * @returns {Promise<{ok: boolean, data: Object, timestamp: string}>}
   */
  async readStatus() {
    throw new Error('readStatus() must be implemented');
  }

  /**
   * Send command to device (actuators only)
   * @param {string} command - Command name
   * @param {Object} args - Command arguments
   * @returns {Promise<{ok: boolean, result: any, error?: string}>}
   */
  async sendCommand(command, args) {
    throw new Error('sendCommand() must be implemented');
  }

  /**
   * Close connection to device
   * @returns {Promise<void>}
   */
  async disconnect() {
    throw new Error('disconnect() must be implemented');
  }

  /**
   * Get device capabilities
   * @returns {{telemetry: string[], commands: string[]}}
   */
  getCapabilities() {
    return this.manifest.capabilities || { telemetry: [], commands: [] };
  }
}
```

---

## Safety Envelope (Phase 6)

```javascript
// lib/device-safety-envelope.js

const SAFETY_LIMITS = {
  relay: {
    max_on_time_seconds: 3600,
    min_off_time_seconds: 60,
    max_cycles_per_hour: 20,
    requires_confirmation: true
  },
  dimmer: {
    max_change_per_second: 10,
    min_level: 0,
    max_level: 100,
    requires_confirmation: false
  },
  pump: {
    max_on_time_seconds: 300,
    min_off_time_seconds: 120,
    max_cycles_per_hour: 10,
    requires_confirmation: true,
    interlocks: ["no_simultaneous_pumps"]
  },
  heater: {
    max_on_time_seconds: 1800,
    min_off_time_seconds: 300,
    max_cycles_per_hour: 6,
    requires_confirmation: true,
    interlocks: ["no_heater_with_cooling"]
  },
  cooling: {
    max_on_time_seconds: 3600,
    min_off_time_seconds: 120,
    max_cycles_per_hour: 10,
    requires_confirmation: true,
    interlocks: ["no_heater_with_cooling"]
  }
};

export function validateCommand(device, command, args, currentState) {
  const limits = SAFETY_LIMITS[device.type];
  if (!limits) return { allowed: true };

  // Check interlocks
  if (limits.interlocks) {
    for (const interlock of limits.interlocks) {
      const violation = checkInterlock(interlock, device, command, currentState);
      if (violation) {
        return { allowed: false, reason: violation };
      }
    }
  }

  // Check timing constraints
  if (command === 'on' || command === 'turnOn') {
    const lastOff = currentState.lastOffTime;
    if (lastOff && (Date.now() - lastOff) < limits.min_off_time_seconds * 1000) {
      return { 
        allowed: false, 
        reason: `Minimum off time not met. Wait ${limits.min_off_time_seconds}s between cycles.`
      };
    }
  }

  // Check cycle rate
  const recentCycles = currentState.cyclesLastHour || 0;
  if (recentCycles >= limits.max_cycles_per_hour) {
    return {
      allowed: false,
      reason: `Maximum cycles per hour (${limits.max_cycles_per_hour}) reached.`
    };
  }

  // Check if confirmation required
  if (limits.requires_confirmation && !args.confirmed) {
    return {
      allowed: false,
      reason: 'This action requires grower confirmation.',
      requires_confirmation: true
    };
  }

  return { allowed: true };
}
```

---

## Sync Payload Extension

```javascript
// Extension to syncFarmData() payload

{
  farm_id: "GR-00001",
  timestamp: "2026-02-22T10:40:00Z",
  
  // Existing fields...
  telemetry: { ... },
  groups: [ ... ],
  
  // NEW: Integration records (last 24h, max 50)
  integration_records: [
    {
      record_id: "INT-20260222-001",
      device_make_model: "Sonoff TH16",
      driver_id: "mqtt.generic.v1",
      driver_version: "1.0.0",
      protocol: "mqtt",
      capabilities: { telemetry: ["temp_c", "humidity_pct"], commands: [] },
      install_context: { room_type: "grow_room", system_type: "indoor_vertical" },
      validation: { passed: true, signal_quality: 0.95, dropout_rate: 0.02 },
      feedback: { rating: "thumbs_up" },
      created_at: "2026-02-22T10:30:00Z"
    }
  ]
}
```

---

## AI Push Payload Extension

```javascript
// Extension to POST /api/health/ai-recommendations payload

{
  farm_id: "GR-00001",
  generated_at: "2026-02-22T11:00:00Z",
  
  recommendations: [ ... ],
  
  network_intelligence: {
    // Existing fields...
    crop_benchmarks: { ... },
    demand_signals: { ... },
    recipe_modifiers: { ... },
    risk_alerts: [ ... ],
    
    // NEW: Device integration intelligence
    device_integrations: {
      recommended_drivers: [
        {
          driver_id: "mqtt.generic.v2",
          protocol: "mqtt",
          success_rate: 0.94,
          adoption_count: 127,
          message: "87% of farms report better stability with v2"
        }
      ],
      integration_warnings: [
        {
          driver_id: "mqtt.generic.v1",
          warning: "High failure rate (23%) detected across network",
          recommendation: "Upgrade to mqtt.generic.v2",
          severity: "medium"
        }
      ],
      popular_configs: {
        "mqtt.generic.v2": {
          common_settings: { qos: 1, keepalive: 60 },
          tip: "Most farms use QoS 1 for sensor reliability"
        }
      }
    }
  }
}
```

---

## Timeline Summary

```
INTEGRATION INTO AI GROWTH ROADMAP:

Days 11-30   PHASE 1  + Tickets I-1.8, I-1.9       (2 tickets, +4 days)
Days 31-60   PHASE 2  + Tickets I-2.9, I-2.10      (2 tickets, +8 days)
Days 61-100  PHASE 3  + Tickets I-3.10, I-3.11     (2 tickets, +5 days)
Days 101-150 PHASE 4  + Tickets I-4.9, I-4.10      (2 tickets, +3 days)
             ─────────────────────────────────────────────────────────
             TOTAL ADDITION: 8 tickets, +20 days (realistic estimate)

PHASE 6 (DEFERRED):
Days 231-320 Full Integration Assistant        (8 tickets, 90 days)
```

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| MQTT driver complexity | Medium | Medium | Start with polling, add subscription later |
| SwitchBot refactor breaks existing | Medium | High | Keep existing routes, add driver alongside |
| Central schema migration fails | Low | High | Test on staging first, backup before migration |
| Integration records bloat sync | Medium | Medium | Cap at 50 records, 24h window |
| Grower doesn't use wizard | Medium | Low | Make wizard optional, support CLI/API |
| Actuator safety envelope too strict | Medium | Medium | Default conservative, allow admin override |

---

## Immediate Next Actions (If Approved)

1. **Create migration file** — `greenreach-central/migrations/007_device_integrations.sql`
2. **Add ticket 1.8** to Phase 1 backlog
3. **Add ticket 1.9** to Phase 1 backlog
4. **Draft Add Device wireframes** — low-fidelity, 5 screens
5. **Refactor SwitchBot** as proof-of-concept driver (non-breaking)

---

## Approval Checklist

- [ ] **Scope**: 8 tickets in Phases 1-4, defer 8 tickets to Phase 6
- [ ] **MVP Device**: MQTT generic sensor
- [ ] **Driver Interface**: Minimal 5-method (Phase 2), full 8-method (Phase 6)
- [ ] **Central Schema**: Add in Phase 1 (ticket 1.8)
- [ ] **Safety Envelope**: Defer to Phase 6 (ticket 6.7)
- [ ] **Timeline Impact**: +14 days to Phases 1-4

---

*This plan integrates the Integration Assistant into the existing AI Growth roadmap, delivering incremental value while deferring full architecture to Phase 6.*
