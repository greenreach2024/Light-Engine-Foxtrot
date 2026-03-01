# AI Assistant Infrastructure Management — Unified Implementation Plan

**Date:** 2026-02-28  
**Version:** 3.0 (merged from Architecture Review + Best Practice Recommendations + UI/Guardrail Update)  
**Branch:** `recovery/feb11-clean`  
**Status:** AWAITING APPROVAL

---

## 1. Executive Summary

The Light Engine Foxtrot AI assistant can manage inventory, orders, sales, monitoring, checklists, and reports — but **it cannot manage farm infrastructure**. It cannot add sensors, set up rooms, configure devices, create groups, or walk users through equipment setup. These capabilities all exist as manual UI wizards and 94 REST API endpoints, but the AI agent has zero infrastructure actions and its system prompt explicitly blocks hardware interaction.

This plan merges the Architecture Agent's code-level audit (94 endpoints mapped, 67 existing actions inventoried, all file/line references verified) with industry best practices for AI+IoT integration, multi-turn conversational design, human-in-the-loop safety, and UI integration. The result is a 5-phase implementation that bridges the AI agent to existing backend APIs through conversational wizard flows, adds deterministic slot validation to prevent hallucinations, keeps all write operations behind mandatory human approval, and introduces a conversational UI so users interact with the assistant in plain language — eliminating the need to learn manual workflows.

**Critical constraint:** Crop growth recipes and schedules are **immutable by design**. The agent will never suggest or enact changes to them. This is enforced through system prompt constraints, code-level checks, and UI locking.

---

## 2. Current State

### 2.1 AI Agent Service (`services/ai-agent.js` — 1,577 lines)

| Attribute | Detail |
|-----------|--------|
| **Engine** | OpenAI GPT-4o-mini |
| **Pipeline** | User NL → `parseCommand()` → OpenAI → structured JSON `{intent, confidence, parameters}` → `executeAction()` → response |
| **Permissions** | `data/agent-permissions.json` — 8 agent classes, 3 tiers (auto / recommend / require-approval) |
| **Categories** | 13 categories, 67 actions |

**Working Categories (Phase 1 complete):** inventory, orders, sales, reports, checklists, monitoring (read-only), system, developer  
**Stub/Partial Categories:** admin, marketing, payroll, deployment, viability

**System Prompt Constraint:**
> "Lighting and environmental controls are database-managed. You can VIEW status but cannot control hardware directly."

This constraint was appropriate when the agent only handled sales/inventory. It must be relaxed — with guardrails — to support infrastructure management.

### 2.2 Farm Assistant "Cheo" (`public/js/farm-assistant.js` — 1,358 lines)

Keyword/pattern-matching client-side assistant with voice I/O (Web Speech API + ResponsiveVoice TTS). No LLM, no multi-turn memory, no write operations. As industry research confirms, rule-based chatbots cannot understand natural language context or adapt to follow-up questions. Cheo will **not** be extended — all new capabilities route through the GPT-powered agent.

### 2.3 Infrastructure Backend (94 REST Endpoints — Fully Built, Not AI-Connected)

| Category | Read | Write | Total | Key Endpoints |
|----------|------|-------|-------|---------------|
| **Rooms** | 7 | 5 | 12 | `GET /api/rooms`, `POST /api/setup/save-rooms` |
| **Zones** | 5 | 5 | 10 | `GET /api/zones`, `POST /api/setup-wizard/zones` |
| **Groups** | 4 | 4 | 8 | `GET /api/groups`, `POST /groups`, `PUT /groups/:id` |
| **Devices/Sensors** | 24 | 23 | 47 | `GET /devices`, `POST /api/devices/scan`, `POST /api/device-wizard/*` |
| **SwitchBot** | 4 | 1 | 5 | `GET /api/switchbot/devices`, `POST /api/switchbot/devices/:id/commands` |
| **Kasa/Plugs** | 5 | 7 | 12 | `GET /api/kasa/devices`, `POST /api/kasa/devices/:id/control` |

### 2.4 Device Wizard (`lib/device-wizard.js` — 693 lines)

Fully implemented 6-step wizard with REST API. Supports 6 protocols (SwitchBot, Kasa, MQTT, Tasmota, Modbus, Generic) and 8 device types (Grow Light, Environment Sensor, Smart Plug, HVAC, Irrigation Controller, CO2 Controller, Camera, Other).

| Step | Endpoint | Description |
|------|----------|-------------|
| Start | `POST /api/device-wizard/start` | Creates wizard session |
| Protocol | `POST /:sessionId/protocol` | Select protocol |
| Config | `POST /:sessionId/config` | Connection credentials |
| Discover | `POST /:sessionId/discover` | Protocol-specific scan |
| Select | `POST /:sessionId/select-device` | Pick from discovered devices |
| Room | `POST /:sessionId/assign-room` | Assign to room/zone |
| Save | `POST /:sessionId/save` | Persist integration |

### 2.5 SwitchBot Integration (`server-foxtrot.js` L6645–8300)

- SwitchBot API v1.1 with HMAC signing (requires token + secret)
- Device listing with 30-min cache, status polling with 15-min cache
- Command execution (turnOn/turnOff) — Edge-only with rate limiting (1,000 calls/day)
- Used by `schedule-executor.js` (L811) and `automation-engine.js` (L241)

---

## 3. Gap Analysis

### 3.1 No Infrastructure Actions in AI Agent

The AI agent has **zero** actions for rooms, zones, groups, devices, sensors, or equipment. All 94 infrastructure endpoints exist but are unreachable by the AI. State-of-the-art AI+IoT systems allow agents to issue commands to physical devices in closed-loop control; our agent cannot even list rooms.

### 3.2 No Conversational Wizard Bridge

The Device Wizard has a clean multi-step REST API, but there is no AI-driven interface. The user must navigate to Settings → Integrations → Add Device and click through 6 steps manually. Modern conversational frameworks (e.g., Rasa) use multi-turn dialogue with slot filling to guide users through complex tasks — our system lacks this entirely for device setup.

### 3.3 No Protocol-Specific Walkthrough

SwitchBot's Open API v1.1 requires a token and secret from the SwitchBot app (Profile → Developer Options). The AI agent has no knowledge of this flow. It cannot prompt for credentials, scan for devices, or confirm "did the device respond?" — all essential steps for guided setup.

### 3.4 No Unknown Equipment Handler

If a user mentions an unsupported device (e.g., "Philips Hue"), the agent has no logic to explain the limitation, suggest alternatives (MQTT bridge), or notify GreenReach. Best practice: clear fallback messaging with developer escalation when the AI cannot proceed.

### 3.5 System Prompt Blocks All Writes

The current prompt explicitly forbids hardware control. This was appropriate for Phase 1 (sales/inventory only). With the permission tier system already in place, we can safely relax this constraint — replacing the blanket ban with targeted constraints (recipe immutability, require-approval for writes) so that only reviewed actions are allowed.

### 3.6 No Multi-Turn State Management

The current chat pipeline processes each message independently. There is no mechanism to maintain wizard session context (session ID, current step, accumulated slot values) across conversation turns. This is required for any multi-step setup flow.

### 3.7 No Chat UI for Infrastructure Tasks

There is no conversational interface for infrastructure management. Users must navigate to specific admin pages and click through form wizards. A chat pane (or modal) with the assistant would let users speak naturally to manage devices, rooms, and groups — "no need to learn special commands or proprietary software." The UI must also display discovered device lists, approval prompts, and loading indicators inline with the conversation.

### 3.8 Grow Recipes Must Remain Immutable

Crop growth recipes (light schedules, nutrient plans, environmental targets) are the operational core of every farm. The UI exposes these via forms and wizards on the Crop Recipes / Grow Plans page. **Under no circumstance should the AI agent modify, propose changes to, or accept user requests to alter these recipes.** They are managed exclusively through the existing admin interface. Any user query involving recipe changes must elicit a clear refusal directing them to the Crop Recipes page.

---

## 4. Implementation Plan

### Design Principles

1. **Human-in-the-Loop for All Writes** — Every infrastructure write operation requires explicit user approval. "If an AI agent locks a door, there should be a manual override. If it recommends action, the user should understand why."
2. **Bridge, Don't Bypass** — Route through existing Device Wizard API rather than duplicating its validation, discovery, and cleanup logic.
3. **Deterministic Slot Validation** — After the user provides a value (protocol, room name, device), validate against whitelists before calling APIs. Never pass unvalidated LLM output to backend endpoints.
4. **Reconfirm Before Executing** — Before every write action, present a summary of exactly what will happen and wait for confirmation. This mirrors Rasa-like "validation actions."
5. **Graceful Degradation** — If OpenAI is unavailable, display a fallback message directing users to the manual UI. If SwitchBot API is rate-limited, inform the user and suggest retry timing.
6. **Grow Recipe Immutability** — The agent will **never** modify crop growth recipes or schedules. No intent for recipe editing will be created. If the LLM suggests changing a recipe, the agent detects and refuses with a safe message directing to the Crop Recipes page. Enforced triple: system prompt constraint + code-level check + UI field locking.
7. **Conversational UI Integration** — Build a chat interface so users can speak naturally about farm tasks. Mirror wizard prompts in the UI as clickable options for touchscreen devices. Always provide a "Use manual wizard" fallback so the chat never dead-ends.

---

### Phase IA: Infrastructure Read Actions
**Effort:** 4–6 hours | **Risk:** Low | **Dependencies:** None | **Priority:** P0

Add an `infrastructure` category to `SYSTEM_CAPABILITIES` with read-only actions. These simply retrieve data from existing APIs — zero risk and no approval needed.

**Actions & Endpoint Mapping:**

| Action | Endpoint | Returns |
|--------|----------|---------|
| `list_rooms` | `GET /api/rooms` | Room names, IDs, equipment counts |
| `list_zones` | `GET /api/zones` | Zone names, types, room assignments |
| `list_groups` | `GET /api/groups` | Group names, schedules, light counts |
| `list_devices` | `GET /devices` | All devices with protocol/type/status |
| `list_sensors` | `GET /api/automation/sensors` | Sensor cache from automation engine |
| `device_status` | `GET /api/switchbot/status` + `GET /api/kasa/devices` | Combined device status across protocols |
| `equipment_summary` | `GET /api/inventory/equipment` | Equipment inventory with room mapping |
| `scan_status` | `GET /discovery/capabilities` | Available discovery protocols (mDNS, BLE, etc.) |

**Files to Modify:**

| File | Change |
|------|--------|
| `services/ai-agent.js` | Add `infrastructure` to `SYSTEM_CAPABILITIES`, add `executeInfrastructureAction()` handler with switch cases for 8 read actions (~80–100 lines) |
| `data/agent-permissions.json` | Add `infrastructure` read capabilities to `farm-operator`, `admin-ops`, `grow-advisor` — all `tier: auto` |
| `services/ai-agent.js` | Update SYSTEM_PROMPT to mention infrastructure viewing capabilities |

**Validation Criteria:**
- [ ] `"Show me all rooms"` → returns room list from `/api/rooms`
- [ ] `"What devices are online?"` → returns combined SwitchBot + Kasa status
- [ ] `"List my SwitchBot devices"` → returns SwitchBot device inventory
- [ ] `"How many groups do I have?"` → returns group count with names
- [ ] `"What's the scan status?"` → returns discovery capabilities
- [ ] All actions execute with `tier: auto` — zero approval prompts
- [ ] `npm run validate-schemas` passes

---

### Phase IB: Conversational Device Setup Wizard
**Effort:** 12–16 hours | **Risk:** Medium | **Dependencies:** Phase IA | **Priority:** P1

Bridge the AI agent to the existing Device Wizard REST API for conversational equipment addition. This is the core capability gap — enabling "Add a new sensor" via natural language.

**Actions & Endpoint Mapping:**

| Action | Endpoint | Tier |
|--------|----------|------|
| `start_device_setup` | `POST /api/device-wizard/start` | require-approval |
| `select_protocol` | `POST /api/device-wizard/:sid/protocol` | auto |
| `configure_connection` | `POST /api/device-wizard/:sid/config` | recommend |
| `discover_devices` | `POST /api/device-wizard/:sid/discover` | recommend |
| `select_device` | `POST /api/device-wizard/:sid/select-device` | auto |
| `assign_device_room` | `POST /api/device-wizard/:sid/assign-room` | recommend |
| `save_device` | `POST /api/device-wizard/:sid/save` | require-approval |
| `cancel_setup` | `DELETE /api/device-wizard/:sid` | auto |

**Multi-Turn Dialogue Design:**

The agent must maintain a wizard session across conversation turns using slot-filling dialogue management. Each turn collects one or more required "slots" and advances the wizard state.

| Turn | Agent Behavior | Slots Filled | Validation |
|------|---------------|--------------|------------|
| 1 | Ask device type + protocol | `device_type`, `protocol` | Validate protocol against `PROTOCOL_OPTIONS` whitelist |
| 2 | Request approval to start scan | — | `require-approval` gate |
| 3 | Present discovered devices as numbered list | `selected_device` | Validate selection index is in range |
| 4 | Ask room assignment (show available rooms) | `room_id` | Validate room exists in `/api/rooms` |
| 5 | Present full summary, request save approval | — | `require-approval` gate |
| 6 | Confirm success + expected behavior | — | Post-setup verification |

**Reference Conversation Flow:**
```
User: "Add a new temperature sensor."
AI:   "I can help set up a new sensor. What protocol does it use?
       1. SwitchBot (BLE/Cloud)
       2. TP-Link Kasa (WiFi)
       3. MQTT
       4. Tasmota (WiFi)
       5. Modbus (TCP/RTU)
       6. Other/Manual"

User: "It's SwitchBot."
AI:   "Got it — SwitchBot protocol. I'll start a device scan to find
       SwitchBot devices on your network/cloud.
       [Requires approval to start device scan]"

User: [Approves]
AI:   "Found 3 SwitchBot devices:
       1. Meter Plus (Temperature/Humidity) — Kitchen
       2. Hub Mini — Living Room
       3. Plug Mini — Office
       Which one is the sensor you want to add?"

User: "The Meter Plus."
AI:   "Selected: SwitchBot Meter Plus. Which room should this sensor
       be assigned to?
       Available rooms: Flower A, Veg B, Propagation"

User: "Flower A."
AI:   "Here's the setup summary. Does this look correct?
       ┌─────────────────────────────────────┐
       │ Device:   SwitchBot Meter Plus      │
       │ Type:     Environment Sensor        │
       │ Protocol: SwitchBot Cloud           │
       │ Room:     Flower A                  │
       └─────────────────────────────────────┘
       [Requires approval to save configuration]"

User: [Approves]
AI:   "✅ Sensor added! The SwitchBot Meter Plus is now monitoring
       temperature and humidity in Flower A. You'll see readings
       on the dashboard within 15 minutes."
```

**Slot Validation Rules:**

All user-provided values must be validated before passing to backend APIs. This prevents LLM hallucination from reaching infrastructure endpoints.

| Slot | Validation | On Failure |
|------|-----------|------------|
| `protocol` | Must be in `['switchbot', 'kasa', 'mqtt', 'tasmota', 'modbus', 'generic']` | Re-prompt with list; if truly unknown → Phase ID handler |
| `device_type` | Must be in `['light', 'sensor', 'plug', 'hvac', 'irrigation', 'co2', 'camera', 'other']` | Re-prompt with list |
| `selected_device` | Must be valid index from discovery results | Re-prompt with numbered list |
| `room_id` | Must exist in `/api/rooms` response | Re-prompt with available rooms |
| `session_id` | Must be active wizard session | Start new session or inform user |

**Session State Management:**

Add `activeWizardSession` to conversation context object:
```javascript
conversationContext.wizardState = {
  sessionId: 'wiz-abc123',
  currentStep: 'discover',        // tracks wizard progress
  protocol: 'switchbot',          // accumulated slots
  deviceType: 'sensor',
  selectedDevice: null,
  roomId: null,
  startedAt: Date.now(),
  ttl: 15 * 60 * 1000             // 15-minute timeout
};
```

On each turn, check `ttl`. If expired: auto-cancel via `DELETE /api/device-wizard/:sid`, inform user, offer to restart. Limit to **one active wizard session per farm** — if a new session starts, cancel the previous one with a warning.

**Files to Modify:**

| File | Change |
|------|--------|
| `services/ai-agent.js` | Add 8 wizard-bridging actions to `executeInfrastructureAction()` (~200 lines). Add wizard state tracking to conversation context. Add slot validation functions. |
| `services/ai-agent.js` | Update SYSTEM_PROMPT with device setup examples and slot-filling instructions |
| `data/agent-permissions.json` | Add wizard action permissions to `farm-operator` and `admin-ops` |
| `routes/farm-sales/ai-agent.js` | Thread wizard session context through `POST /chat` request/response |

**UI Integration (Phase IB):**

During wizard flows, the chat UI must mirror prompts as interactive elements:
- **Protocol selection** → render as clickable button list (not just text)
- **Device discovery results** → render as selectable card list with device name, type, and status
- **Approval prompts** → render as Confirm / Cancel button pair (not just text)
- **Scanning state** → show loading spinner with "Scanning for devices…" indicator
- **Manual fallback** → show "Use manual wizard" link that opens Settings → Integrations

This ensures touchscreen usability on iPads and reduces typing. Users can tap options instead of typing responses.

**Validation Criteria:**
- [ ] `"Add a new sensor"` → AI asks about protocol (multi-turn)
- [ ] Selecting "SwitchBot" → AI starts wizard session via `POST /api/device-wizard/start`
- [ ] AI presents discovered devices as numbered list for selection
- [ ] Invalid protocol name → AI re-prompts with valid options (no hallucination passed to API)
- [ ] Device save requires explicit user approval via `require-approval` tier
- [ ] Wizard session auto-cancels after 15-minute inactivity
- [ ] Starting second wizard cancels first with warning message
- [ ] User says "cancel" mid-flow → AI calls `DELETE /api/device-wizard/:sid`
- [ ] `npm run validate-schemas` passes

---

### Phase IC: Room & Group Setup via Natural Language
**Effort:** 8–10 hours | **Risk:** Medium | **Dependencies:** Phase IA | **Priority:** P1

Enable creation and configuration of rooms, zones, and lighting groups through conversation. All operations use existing APIs and require human approval.

**Actions & Endpoint Mapping:**

| Action | Endpoint | Tier |
|--------|----------|------|
| `create_room` | `POST /api/setup/save-rooms` | require-approval |
| `create_zone` | `POST /api/setup-wizard/zones` | require-approval |
| `create_group` | `POST /groups` | require-approval |
| `assign_light` | `PUT /groups/:id` (set light roster) | require-approval |
| `update_schedule` | `PUT /sched/:groupId` | require-approval |

**Slot-Filling Dialogue Examples:**

```
User: "Create a new grow room called Flower C."
AI:   "I'll create a new room named 'Flower C'.
       [Requires approval to create room]"
User: [Approves]
AI:   "✅ Room 'Flower C' created. You can now add zones, groups,
       and equipment to this room."
```

```
User: "Set up a new group in Flower A with 12/12 light schedule."
AI:   "I'll create a new group in Flower A:
       • Room: Flower A
       • Light Schedule: 12 hours ON / 12 hours OFF
       • Start Time: 08:00 (default)
       Which crop recipe should I assign?
       Available: Genovese Basil, Lettuce Mix, Microgreens…"
User: "Genovese Basil."
AI:   "Group summary:
       ┌───────────────────────────────────┐
       │ Room:     Flower A               │
       │ Schedule: 12h ON / 12h OFF       │
       │ Start:    08:00                  │
       │ Recipe:   Genovese Basil         │
       └───────────────────────────────────┘
       [Requires approval to create group]"
User: [Approves]
AI:   "✅ Group created. Go to Groups V2 to assign lights and start
       the schedule."
```

**Slot Validation:** Room names validated against existing rooms (for zone/group creation). Schedule parameters validated (hours must sum to 24 for full-cycle, start time in HH:MM format). Recipe validated against available crop recipes — the agent may prompt "Which recipe: Genovese Basil, Lettuce Mix…" to **assign** an existing recipe, but cannot alter any recipe's contents.

**Grow Recipe Guardrail (Phase IC):**

If the user attempts a recipe change via chat (e.g., "Adjust Flower A's recipe to 16h on" or "Change nutrient mix for Basil"), the agent refuses:

```
User: "Change the light schedule for Genovese Basil to 16 hours on."
AI:   "I'm not able to modify grow recipes or schedules through chat.
       Recipes are managed on the Crop Recipes page. I can show you
       how to get there, or help with other infrastructure tasks."
```

This is enforced by:
1. **System prompt constraint:** "Never modify crop growth recipes or schedules under any circumstances."
2. **Code-level check:** `executeInfrastructureAction()` detects recipe-related intents and returns the refusal message without calling any API.
3. **UI locking:** Recipe fields remain read-only in the chat context; the chat UI never renders recipe edit forms.

**Validation Criteria:**
- [ ] `"Create a room called Flower C"` → approval prompt → room appears in `/api/rooms`
- [ ] `"Set up a group with 12/12 schedule"` → AI asks clarifying questions → creates group
- [ ] Missing info (no room specified for group) → AI asks follow-up, not hallucination
- [ ] `"Change Basil recipe to 16h"` → agent refuses, directs to Crop Recipes page
- [ ] `"Modify nutrient plan"` → agent refuses, no API call made
- [ ] Room/group data persists across server restarts
- [ ] `npm run validate-schemas` passes

---

### Phase ID: Unknown Equipment Handler & GreenReach Notification
**Effort:** 4–6 hours | **Risk:** Low | **Dependencies:** Phase IB | **Priority:** P2

When a user describes equipment or a protocol outside the supported list, the agent should (1) explain clearly, (2) suggest alternatives, and (3) notify GreenReach Central.

**Action:**

| Action | Endpoint | Tier |
|--------|----------|------|
| `report_unknown_device` | `POST /api/support/feature-requests` (Central) | recommend |

**Protocol Detection Logic:**

```javascript
const KNOWN_PROTOCOLS = ['switchbot', 'kasa', 'mqtt', 'tasmota', 'modbus', 'generic'];
const PROTOCOL_ALIASES = {
  'zigbee': { brand: 'Philips Hue / Zigbee', unsupported: true },
  'hue': { brand: 'Philips Hue', unsupported: true, suggest: 'mqtt' },
  'zwave': { brand: 'Z-Wave', unsupported: true },
  'matter': { brand: 'Matter/Thread', unsupported: true },
  'homekit': { brand: 'Apple HomeKit', unsupported: true },
  'tuya': { brand: 'Tuya/Smart Life', unsupported: true, suggest: 'mqtt' },
  'shelly': { brand: 'Shelly', unsupported: false, map: 'mqtt' },
  // ... extensible lookup
};
```

If the user mentions a known-but-unsupported protocol, the agent can still be helpful:
- If the device has an MQTT bridge option (e.g., Tuya with custom firmware), suggest that path
- If truly unsupported, submit feature request and inform user

**Reference Conversation:**
```
User: "I want to add a Philips Hue light."
AI:   "Philips Hue uses the Zigbee protocol, which isn't currently
       supported by Light Engine. Supported protocols are:
       • SwitchBot (BLE/Cloud)
       • TP-Link Kasa (WiFi)
       • MQTT
       • Tasmota (WiFi)
       • Modbus (TCP/RTU)

       I've submitted a feature request to GreenReach for Philips Hue
       / Zigbee support. You'll be notified when it becomes available.

       If your Hue bridge exposes an MQTT interface, I can help set
       it up through that protocol instead."
```

**Files to Modify:**

| File | Change |
|------|--------|
| `services/ai-agent.js` | Add protocol alias lookup, `report_unknown_device` handler |
| `greenreach-central/server.js` | Add `POST /api/support/feature-requests` endpoint |
| `greenreach-central/server.js` | Store feature requests in database (farm_id, device_make, protocol, timestamp) |

**Validation Criteria:**
- [ ] `"Add a Zigbee sensor"` → AI explains unsupported, lists alternatives
- [ ] `"Add a Shelly plug"` → AI recognizes Shelly as MQTT-compatible, offers MQTT setup
- [ ] Feature request POST received by GreenReach Central with device details
- [ ] Agent does NOT hallucinate a fake setup for unsupported protocols

---

### Phase IE: SwitchBot-Specific Guided Setup
**Effort:** 6–8 hours | **Risk:** Low | **Dependencies:** Phase IB | **Priority:** P2

Enhanced walkthrough for SwitchBot — the most common protocol in the field. This is a specialization of Phase IB with SwitchBot-specific credential guidance, device categorization, and post-setup verification.

**Flow:**

```
┌─ Step 1: Check Credentials ─────────────────────────────┐
│ Read farm.json → integrations.switchbot                  │
│ If missing: guide user through token retrieval           │
│   "Open SwitchBot app → Profile → Developer Options      │
│    → Get Token. Paste it here."                          │
│ Validate: token format, secret present                   │
└──────────────────────────────────────────────────────────┘
          ↓
┌─ Step 2: Scan Devices ───────────────────────────────────┐
│ GET /api/switchbot/devices (honors 30-min cache)         │
│ If rate-limited: inform user, suggest retry time          │
│ Present devices with type explanations                   │
└──────────────────────────────────────────────────────────┘
          ↓
┌─ Step 3: Categorize & Select ────────────────────────────┐
│ AI explains each device type:                            │
│   Meter Plus → Temp/Humidity sensor                      │
│   Hub Mini/2 → Infrastructure hub (explain role)         │
│   Plug Mini  → Smart plug for equipment control          │
│   Bot        → Physical button presser                   │
│   Motion     → Security/automation trigger               │
│ User selects device to add                               │
└──────────────────────────────────────────────────────────┘
          ↓
┌─ Step 4: Assign Room & Configure ────────────────────────┐
│ Present available rooms for assignment                   │
│ If sensor: set up data polling interval                   │
│ If plug: associate with equipment (light, HVAC, etc.)     │
└──────────────────────────────────────────────────────────┘
          ↓
┌─ Step 5: Post-Setup Verification ────────────────────────┐
│ If sensor: "Checking for data…" → confirm readings       │
│ If plug: "Testing on/off cycle…" → confirm response      │
│ If no response: suggest troubleshooting steps             │
│   (check hub range, verify cloud connection)              │
└──────────────────────────────────────────────────────────┘
```

**SwitchBot Device Type Knowledge Base:**

| SwitchBot Type | Farm Category | AI Description for User |
|---------------|---------------|------------------------|
| Meter Plus | Environment Sensor | Monitors temperature and humidity |
| Hub Mini / Hub 2 | Infrastructure | Required gateway for BLE devices — explain that it bridges BLE sensors to cloud |
| Plug Mini | Smart Plug | Controls equipment power (lights, fans, pumps) |
| Bot | Actuator | Presses physical buttons — useful for legacy equipment with manual switches |
| Curtain | Window Control | May not be relevant for most indoor farms |
| Motion Sensor | Security/Trigger | Triggers automations on movement detection |
| Contact Sensor | Door/Window | Detects open/close state on vents or doors |

**Files to Modify:**

| File | Change |
|------|--------|
| `services/ai-agent.js` | Add SwitchBot credential detection, device type categorization, post-setup verification logic (~100 lines within `executeInfrastructureAction`) |

**Validation Criteria:**
- [ ] Missing SwitchBot credentials → AI provides step-by-step retrieval instructions
- [ ] With credentials → AI lists devices with type explanations
- [ ] Sensor setup → AI confirms readings are flowing after save
- [ ] Plug setup → AI tests on/off cycle and confirms response
- [ ] API rate limit → AI informs user with estimated wait time
- [ ] Hub Mini selected → AI explains it's infrastructure, not a sensor, asks if user wants to add it as a hub

---

## 5. Permission Matrix

New `infrastructure` block for `data/agent-permissions.json`, applied to relevant agent classes:

### farm-operator (default operators)
```json
"infrastructure": {
  "list_rooms":           { "tier": "auto" },
  "list_zones":           { "tier": "auto" },
  "list_groups":          { "tier": "auto" },
  "list_devices":         { "tier": "auto" },
  "list_sensors":         { "tier": "auto" },
  "device_status":        { "tier": "auto" },
  "equipment_summary":    { "tier": "auto" },
  "scan_status":          { "tier": "auto" },
  "start_device_setup":   { "tier": "require-approval" },
  "select_protocol":      { "tier": "auto" },
  "configure_connection": { "tier": "recommend" },
  "discover_devices":     { "tier": "recommend" },
  "select_device":        { "tier": "auto" },
  "assign_device_room":   { "tier": "recommend" },
  "save_device":          { "tier": "require-approval" },
  "cancel_setup":         { "tier": "auto" },
  "create_room":          { "tier": "require-approval" },
  "create_zone":          { "tier": "require-approval" },
  "create_group":         { "tier": "require-approval" },
  "assign_light":         { "tier": "require-approval" },
  "update_schedule":      { "tier": "require-approval" },
  "report_unknown_device":{ "tier": "recommend" }
}
```

### Tier Rationale

| Tier | Applied To | Rationale |
|------|-----------|-----------|
| **auto** | All read operations, protocol selection, device selection, cancel | Zero risk — retrieving data or making non-destructive choices |
| **recommend** | Discovery, credential config, room assignment, unknown device report | User sees what will happen and can confirm or reject |
| **require-approval** | Start setup, save device, create room/zone/group, assign light, update schedule | Irreversible operations with physical-world impact — explicit human confirmation mandatory |

### Additional Agent Classes

- **admin-ops**: Full `infrastructure` access (same permissions as farm-operator)
- **grow-advisor**: Read-only `infrastructure` access (list_* and device_status only)
- **deployment**: Read-only + `scan_status` for site readiness assessments
- **developer**: Full access with all writes at `require-approval`

---

## 6. System Prompt Update

### Remove

> "Lighting and environmental controls are database-managed. You can VIEW status but cannot control hardware directly."

### Replace With

> "You can view and manage farm infrastructure including rooms, zones, groups, devices, and sensors. Write operations (creating rooms, adding devices, modifying groups) require human approval before execution. For device setup, guide the user through a conversational wizard flow — ask about protocol, scan for devices, and assign rooms step by step. Always present a summary before saving and wait for confirmation.
>
> **CONSTRAINTS — Hard Rules (never violate):**
> - Never modify crop growth recipes or schedules under any circumstances. If a user asks to change a recipe, explain that recipes are managed on the Crop Recipes page and offer to help with other tasks.
> - Never modify order data directly.
> - Never bypass the approval step for write operations.
>
> When handling device setup:
> 1. Ask which protocol the device uses (SwitchBot, Kasa, MQTT, Tasmota, Modbus, or Other)
> 2. Validate the protocol against the supported list before proceeding
> 3. If the protocol is not supported, explain what IS supported and offer to submit a feature request
> 4. After each user answer, reconfirm the value before using it in API calls
> 5. Present discovered devices as a numbered list for clear selection
> 6. Always show a complete summary before the final save step
>
> For SwitchBot specifically: check if credentials are configured, guide through token retrieval if needed (SwitchBot app → Profile → Developer Options), and explain device types (Meter Plus = temp sensor, Plug Mini = smart plug, Hub Mini = gateway).
>
> If a user mentions unsupported equipment: explain the limitation, list supported protocols, offer MQTT as a potential bridge, and submit a feature request to GreenReach."

### Add Intent Examples

```
- "Show me all rooms" → {"intent": "infrastructure.list_rooms", "parameters": {}, "requires_confirmation": false}
- "Add a temperature sensor" → {"intent": "infrastructure.start_device_setup", "parameters": {"device_type": "sensor", "sensor_type": "temperature"}, "requires_confirmation": true}
- "Set up a SwitchBot device" → {"intent": "infrastructure.start_device_setup", "parameters": {"protocol": "switchbot"}, "requires_confirmation": true}
- "Create a new grow room called Flower C" → {"intent": "infrastructure.create_room", "parameters": {"name": "Flower C"}, "requires_confirmation": true}
- "What devices are online?" → {"intent": "infrastructure.device_status", "parameters": {}, "requires_confirmation": false}
- "Add a Zigbee light" → {"intent": "infrastructure.report_unknown_device", "parameters": {"device": "Zigbee light", "protocol": "zigbee"}, "requires_confirmation": false}
- "Change the Basil recipe to 16h" → REFUSED — "Editing grow recipes is not supported via chat. Please use the Crop Recipes page."
```

---

## 7. Timeline & Priority

| Phase | Scope | Effort | Priority | Risk | Dependencies |
|-------|-------|--------|----------|------|-------------|
| **IA** | Infrastructure read actions (8 actions) | 4–6 hrs | **P0 — Immediate** | Low | None |
| **IB** | Conversational device wizard (8 actions + state mgmt) | 12–16 hrs | **P1 — Next Sprint** | Medium | Phase IA |
| **IC** | Room & group NL setup (5 actions) | 8–10 hrs | **P1 — Next Sprint** | Medium | Phase IA |
| **ID** | Unknown equipment handler + GreenReach notification | 4–6 hrs | **P2** | Low | Phase IB |
| **IE** | SwitchBot-specific guided setup + verification | 6–8 hrs | **P2** | Low | Phase IB |

**Total:** 34–46 hours (4–6 developer-days)  
**New Actions:** 22 (8 read + 8 wizard + 5 room/group + 1 unknown device)

---

## 8. Architecture Decision Records

### ADR-1: Single `infrastructure` Category

**Decision:** Group all infrastructure actions under one `infrastructure` category with hierarchical action names (e.g., `infrastructure.list_rooms`, `infrastructure.save_device`).  
**Rationale:** Reduces `SYSTEM_CAPABILITIES` bloat. The AI agent's intent parser handles dotted actions cleanly. Permission tiers provide granular control within the single category. One `executeInfrastructureAction()` switch is simpler than 4+ new category handlers.  
**Rejected:** Separate `rooms`, `zones`, `groups`, `devices` categories — would fragment related operations and add 4 new case branches to `executeAction()`.

### ADR-2: Bridge Device Wizard, Don't Bypass

**Decision:** Route all device setup operations through the existing Device Wizard REST API (`/api/device-wizard/*`) rather than calling lower-level device APIs directly.  
**Rationale:** The wizard encapsulates multi-step state, protocol-specific discovery, credential validation, and cleanup logic. Bypassing it would duplicate 693 lines of battle-tested code and risk missing safety checks.  
**Tradeoff:** The AI must maintain wizard `sessionId` across conversation turns, adding state management complexity. This is acceptable given the existing conversation context mechanism.

### ADR-3: Require-Approval for All Write Operations

**Decision:** All infrastructure write operations use `require-approval` tier with explicit user confirmation before execution.  
**Rationale:** Creating rooms, adding devices, and modifying groups have physical-world consequences (sensors start reporting, lights change schedule, etc.). The existing permission system handles this cleanly — the AI presents a summary, user confirms, then it executes. This satisfies the human-in-the-loop principle: "a smart system should always have a human backup."  
**Future:** After sufficient operational trust, low-risk writes (e.g., room creation) could be downgraded to `recommend` tier.

### ADR-4: GPT Agent Only, Not Cheo

**Decision:** All new capabilities go through the GPT-4o-mini agent. Cheo (client-side keyword matcher) is not extended.  
**Rationale:** Rule-based chatbots cannot understand context, handle multi-turn flows, or extract parameters from natural language. The GPT agent already has the architecture for intent parsing, conversation history, and structured action execution. Cheo remains available for simple page navigation and voice-activated quick queries.

### ADR-5: Deterministic Slot Validation

**Decision:** All slot values extracted from LLM output (protocol, room name, device selection) are validated against whitelists or backend data before being passed to API endpoints.  
**Rationale:** LLMs can hallucinate values — e.g., inventing a protocol name or room that doesn't exist. Deterministic validation (check against `PROTOCOL_OPTIONS`, query `/api/rooms` to verify room existence) prevents invalid data from reaching infrastructure APIs. This mirrors Rasa's "validation actions" pattern: accept user input → validate → reconfirm → proceed.

### ADR-6: Grow Recipe Immutability

**Decision:** The AI agent will never modify, propose changes to, or create intents for editing crop growth recipes or schedules. No `update_recipe`, `modify_schedule`, or similar intent will exist.  
**Rationale:** Grow recipes are the operational core of indoor farming — incorrect changes to light schedules or nutrient plans can destroy an entire crop cycle. The risk/reward ratio of AI-driven recipe editing is unacceptable. Recipes require domain expertise and deliberate admin action through the existing Grow Plans UI. This mirrors proven patterns (e.g., "Never modify order data directly") used in the existing agent constraints.  
**Enforcement:** Triple layer — (1) System prompt hard constraint, (2) code-level intent detection and refusal in `executeInfrastructureAction()`, (3) UI locks recipe fields as read-only in chat context.  
**Future:** This decision is permanent. Even with full operational trust, recipe editing will remain admin-UI-only.

---

## 9. Risk Mitigations

| Risk | Impact | Probability | Mitigation |
|------|--------|------------|------------|
| **LLM hallucinates protocol or room name** | Invalid API call, device setup fails | Medium | Validate all slots against whitelists before API calls. Re-prompt on mismatch. Never pass raw LLM output to endpoints. |
| **Wizard session timeout** | User loses progress mid-setup | Low | 15-min TTL on wizard sessions. Warn user at 12 min. Auto-cancel with explanation at timeout. Offer restart. |
| **User approves wrong device** | Incorrect sensor added to farm | Low | Show full device details (name, MAC, type, protocol) in approval summary. Ask "Does this look correct?" |
| **SwitchBot API rate limit** | Discovery scan fails | Low | Honor existing 30-min device cache. If rate-limited, show "SwitchBot API limit reached. Cached data shown. Full scan available in X minutes." |
| **Concurrent wizard sessions** | State confusion between tabs/sessions | Low | Limit to 1 active wizard per farm. Auto-cancel previous session with warning if new one starts. |
| **OpenAI API unavailable** | AI agent offline entirely | Low | Fallback: "AI assistant is temporarily unavailable. Use Settings → Integrations to manage devices manually." Link to manual UI. |
| **User abandons mid-flow** | Orphaned wizard session | Medium | Auto-cleanup on session timeout. Track orphaned sessions in logs. Cancel on explicit "cancel" / "never mind" / "stop". |
| **Credentials entered via chat** | SwitchBot token visible in chat history | Low | Mark credential fields as sensitive in conversation context. Do not echo tokens back. Store directly to `farm.json`. |
| **Recipe modification attempt** | Crop damage from incorrect recipe change | Low (blocked) | Triple enforcement: system prompt ban, code-level intent detection, UI field locking. Agent refuses and directs to Crop Recipes page. No recipe-editing intent exists. |
| **UI confusion** | User unsure what to do in chat | Medium | Provide clear UI cues: highlight clickable options, include example phrases as placeholder text, show "Help" fallback responses. Offer "Use manual wizard" link at all times. |
| **AI drift over time** | Assistant quality degrades | Low | Monitor acceptance/rejection rates monthly. Review system prompt quarterly. Use feedback metrics to identify regression. Retrain slot validation patterns from conversation logs. |

---

## 10. Files Inventory

| File | Phase | Lines Added (est.) | Changes |
|------|-------|--------------------|---------|
| `services/ai-agent.js` | IA–IE | 400–600 | New `infrastructure` in SYSTEM_CAPABILITIES, updated SYSTEM_PROMPT (with recipe constraint), `executeInfrastructureAction()` with read/write/wizard handlers, slot validation, wizard state management, SwitchBot knowledge base, recipe-intent detection and refusal |
| `data/agent-permissions.json` | IA | 40–60 | New `infrastructure` block in `farm-operator`, `admin-ops`, `grow-advisor`, `deployment`, `developer` |
| `routes/farm-sales/ai-agent.js` | IB | 20–30 | Thread wizard session context through `POST /chat` req/res; return `wizardState` in response |
| `public/views/partials/chat-pane.ejs` | IB | 150–250 | **NEW** — Chat interface component: message list, input field, clickable option renderer, approval button pair, loading spinner, "Use manual wizard" link |
| `public/css/chat-pane.css` | IB | 80–120 | **NEW** — Chat pane styling: message bubbles, option buttons, approval dialog, responsive/iPad layout |
| `public/js/chat-pane.js` | IB | 200–300 | **NEW** — Chat client: WebSocket or fetch-based message transport, option click handlers, approval flow, wizard state display, feedback controls (thumbs up/down) |
| `greenreach-central/server.js` | ID | 40–60 | New `POST /api/support/feature-requests` endpoint; store in database |
| `lib/device-wizard.js` | — | 0 | No changes — existing REST API is sufficient |
| `server-foxtrot.js` | — | 0 | No changes — existing 94 endpoints are sufficient |

---

## 11. UI Integration

### 11.1 Chat Interface

Add a conversational UI element accessible from the main dashboard via an **"Ask Assistant"** button. This opens a chat pane (slide-in panel or modal) where the user types or speaks commands. The interface displays the turn-by-turn dialogue with the AI agent.

**Components:**
- **Message list** — Scrollable conversation history with user/AI message bubbles
- **Input field** — Text input with mic button for voice (leveraging existing Web Speech API from Cheo)
- **Option renderer** — When the AI presents choices (protocols, devices, rooms), render as clickable buttons/cards, not just text. This enables touchscreen interaction on iPads.
- **Approval dialog** — `require-approval` actions render as Confirm / Cancel button pair with action summary
| Recipe modification blocks | 100% of recipe-change attempts refused | Log recipe-intent detections in `executeInfrastructureAction()` |
| User feedback sentiment | > 85% positive (thumbs up) | Thumbs up/down ratio from chat feedback controls |
| Intent classification accuracy | > 90% correct parsing | Compare parsed intent vs user correction/feedback |
- **Loading indicator** — Spinner with status text ("Scanning for devices…", "Creating room…") during async operations
- **Feedback controls** — Thumbs up / thumbs down after each assistant response for quality tracking

### 11.2 Wizard UI Sync

During multi-turn wizard flows, the chat UI mirrors each step:
- **Protocol selection** → Button grid (SwitchBot, Kasa, MQTT, etc.)
- **Device discovery** → Card list with device name, type, and online/offline badge
- **Room assignment** → Dropdown or button list of available rooms
- **Final summary** → Formatted card with all settings + Confirm/Cancel

This lets users click instead of type, reducing errors and improving speed on mobile/tablet.

### 11.3 Manual Fallback

The chat UI always shows a **"Use manual wizard"** link that navigates to the appropriate settings page (Settings → Integrations for devices, Farm Admin for rooms). If the AI fails to understand or the service is unavailable, the UI displays: *"AI assistant is temporarily unavailable. Use the manual setup wizard instead."* with a direct link.

### 11.4 Recipe Field Locking

In the chat context, all grow recipe fields are visually marked as read-only (grayed out, no edit controls). If the user types a recipe-change request, the agent's refusal message includes a link to the Crop Recipes page.

---

## 12. Monitoring, Feedback & Continuous Learning

### 12.1 Conversation Logging

Log all assistant conversations (with user consent toggle in settings) to enable:
- Intent classification accuracy analysis
- Slot validation failure pattern detection
- User abandonment tracking (where do users drop off in wizard flows?)
- Feature request aggregation from `report_unknown_device` calls

Logs are stored locally on the farm (not sent to cloud) and can be exported for analysis.

### 12.2 User Feedback Loop

After each chat session or significant action, display thumbs up/down controls. Optionally, a "Was this helpful?" prompt with a free-text field for corrections. Use this feedback to:
- Identify frequently misunderstood intents
- Detect slot validation gaps (user says valid thing, agent rejects it)
- Track approval acceptance rate (are users always confirming, or frequently canceling?)

### 12.3 Performance Monitoring

Track metrics continuously:

| Metric | Purpose | Alert Threshold |
|--------|---------|-----------------|
| Intent classification accuracy | Are user requests parsed correctly? | < 85% → review prompt |
| Approval acceptance rate | Are summaries correct before save? | < 90% → review slot filling |
| Wizard completion rate | Do users finish what they start? | < 60% → review UX flow |
| Average turns per wizard | Is the conversation efficient? | > 8 turns → simplify flow |
| Feedback sentiment | Overall satisfaction | > 15% negative → investigate |

### 12.4 Prompt Review Schedule

- **Monthly:** Review conversation logs for misclassified intents. Adjust system prompt examples.
- **Quarterly:** Review slot validation patterns. Add new protocol aliases. Update SwitchBot device type knowledge base if new products ship.
- **Per release:** Run full validation criteria suite (all phases) before deploying prompt changes.

### 12.5 Documentation & Training

- Update user guides (in-app help, onboarding flow) to explain assistant capabilities
- Add tooltip on "Ask Assistant" button: *"Ask me to add devices, create rooms, check sensor status, and more"*
- Include example phrases as placeholder text in chat input: *"Try: 'Add a new sensor' or 'Show my rooms'"*

---

## 13. Success Metrics

Post-implementation, measure:

| Metric | Target | Measurement |
|--------|--------|-------------|
| Device setup completion rate (via AI vs manual UI) | > 70% completion once started | Track wizard sessions started via AI vs abandoned |
| Time to add a device | < 3 minutes via AI conversation | Timestamp from first message to `save_device` |
| Recipe modification blocks | 100% of recipe-change attempts refused | Log recipe-intent detections in `executeInfrastructureAction()` |
| User feedback sentiment | > 85% positive (thumbs up) | Thumbs up/down ratio from chat feedback controls |
| Intent classification accuracy | > 90% correct parsing | Compare parsed intent vs user correction/feedback |
| Unknown device feature requests submitted | 100% of unsupported devices logged | Count `POST /api/support/feature-requests` calls |
| Zero unapproved writes | 100% writes have `require-approval` confirmation | Audit log in `services/ai-agent.js` |
| Slot validation catch rate | 0 invalid values reach backend APIs | Log validation rejections vs total intent calls |

---

*This plan follows the Agent Skills Framework multi-agent review process.*  
*Implementation requires explicit user approval ("APPROVED FOR IMPLEMENTATION") before code changes begin.*  
*Deployment requires separate "APPROVED FOR DEPLOYMENT" approval per the Deployment Gate.*
