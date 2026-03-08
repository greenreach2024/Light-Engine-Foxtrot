# Natural-Language Farm Operations Agent — Build Plan

**Date:** 2026-03-08  
**Status:** In Progress  
**Branch:** recovery/feb11-clean

## Executive Summary

A natural-language farm operations agent is being built as a **mixed-initiative, tool-using operations controller**: it translates operator intent into a safe plan, asks minimal clarifying questions when needed, and executes only after confirmation when error cost is high.

The deployed AI Vision system (Foxtrot + Central) already contains the core primitives needed for: daily prioritised work planning, harvesting and loss risk readiness queries, network-level benchmarks/recommendations, and outcome-linked learning via experiment records.

---

## Pre-Implementation Gap Audit (2026-03-08)

| Gap | Status Before Build | After Audit |
|---|---|---|
| T6 — Learning correlations dashboard | ⚠️ Per Feb 23 report | ✅ **Already implemented**: `loadLearningCorrelations()` in farm-summary.html + `/api/ai/learning-correlations` API |
| T16 — Auto-print on harvest scan | ⚠️ Per Feb 23 report | ✅ **Already implemented**: Server-side auto-print in harvest endpoint + client-side `triggerAutoHarvestLabelPrint()` in tray-inventory.html |
| T19 — Auto-assign discovered lights to zones | ⚠️ | ❌ **Still missing**: mDNS discovery exists but no auto-assign logic; IoT manager is 111-line skeleton |
| T21 — Onboarding wizard benchmarks step | ⚠️ | ❌ **Still missing**: Setup wizard has room/zone/crop steps but no benchmark content |

**Remaining gap work: ~8h (T19 + T21 only). T6 and T16 are closed.**

---

## Agent Architecture

The agent follows a layered architecture:

1. **Command Taxonomy** — Structured intents with typed slots
2. **Dialogue Manager** — Mixed-initiative policy (ask vs execute vs abstain)
3. **Tool Gateway** — Schema validation, idempotency, audit trail
4. **Daily To-Do Generator** — Deterministic task scoring and prioritisation
5. **Explanation Layer** — "Why" support and undo/audit

### Command Families

| Family | Example | Execution Mode |
|---|---|---|
| Device onboarding | "Add a new light to Zone 3" | Two-phase commit |
| Planting/stagger | "Plant 10 groups of arugula weekly" | Plan preview + confirm |
| Harvest readiness | "What's ready to harvest today?" | Read-only |
| Wholesale | "What orders do we have to fill?" | Read-only; confirm on writes |
| Daily to-do | "What should we do today?" | Read-only list |
| Status | "How are we doing?" | Read-only; drill-down |

### Task Scoring Formula

$$\text{score} = 0.35 \cdot U + 0.25 \cdot I + 0.15 \cdot R + 0.15 \cdot C - 0.10 \cdot E$$

Where U=urgency, I=impact, R=risk reduction, C=confidence, E=effort.

### Safety Rules

- Abstain on high-impact writes when ambiguity is non-trivial
- Two-phase commit: draft → preview → confirm → apply
- Idempotency keys for all write actions
- Undo support for reversible actions
- Audit + explainability for every tool call

---

## Implementation Scope (this build)

### Phase 1: Close Remaining Gaps (~8h)
1. T19: Auto-assign discovered lights to zones
2. T21: Onboarding wizard benchmarks step

### Phase 2: Agent Infrastructure (~16h)
3. Daily to-do generator v1 (sources → scoring → task cards)
4. Tool gateway route with schema validation and audit
5. Agent command taxonomy route (intent parsing + slot extraction)

### Phase 3: Deployment & Verification
6. Deploy to both EB environments
7. Smoke test all new endpoints

---

## Files Modified/Created

### New Files
- `routes/farm-ops-agent.js` — Agent command taxonomy + daily to-do generator
- `greenreach-central/routes/farm-ops-agent.js` — Central-side agent proxy

### Modified Files
- `routes/mdns-discovery.js` — Add auto-assign logic for discovered devices
- `public/views/iot-manager.html` — Add auto-assign UI
- `routes/setup-wizard.js` — Add benchmarks onboarding step
- `greenreach-central/routes/setup-wizard.js` — Mirror benchmarks step
- `server-foxtrot.js` — Mount agent route, register tool schemas
- `greenreach-central/server.js` — Mount agent route
