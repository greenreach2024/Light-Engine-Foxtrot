# Farm Operations Agent — Implementation Plan

**Version**: 1.0.1  
**Date**: February 23, 2026  
**Status**: REVISED — Post-Review Corrections Applied  
**Authoritative References**: `AI_VISION_READINESS_REPORT_2026-02-23.md`, `.github/AI_VISION_RULES_AND_SKILLS.md`, `PROPOSAL_INTEGRATION_ASSISTANT_2026-02-22.md`  
**Constraint**: Research-only audit. No code edits, commits, or deploys were made.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Deployed Baseline — What Already Exists](#2-deployed-baseline--what-already-exists)
3. [Architecture Gap Analysis](#3-architecture-gap-analysis)
4. [Design Principles](#4-design-principles)
5. [Command Taxonomy](#5-command-taxonomy)
6. [Agent Architecture](#6-agent-architecture)
7. [Phase 0 — Prerequisite Remediation](#7-phase-0--prerequisite-remediation)
8. [Phase 1 — Daily Briefing + Read-Only Agent Loop](#8-phase-1--daily-briefing--read-only-agent-loop)
9. [Phase 2 — Confirmable Write Actions](#9-phase-2--confirmable-write-actions)
10. [Phase 3 — Learning + Autonomy (Bounded)](#10-phase-3--learning--autonomy-bounded)
11. [Tool-Calling Safety Rules](#11-tool-calling-safety-rules)
12. [Daily To-Do Generation Algorithm](#12-daily-to-do-generation-algorithm)
13. ["How Are We Doing?" Operational Briefing](#13-how-are-we-doing-operational-briefing)
14. [Sample Dialogues](#14-sample-dialogues)
15. [Training Data Schema](#15-training-data-schema)
16. [Minimal Dataset Size Targets](#16-minimal-dataset-size-targets)
17. [Real-Time Updates Architecture](#17-real-time-updates-architecture)
18. [Voice Safety in Agricultural Environments](#18-voice-safety-in-agricultural-environments)
19. [Regulatory and Compliance Notes](#19-regulatory-and-compliance-notes)
20. [Skills Matrix](#20-skills-matrix)
21. [Mandatory Test Gate](#21-mandatory-test-gate)
22. [Timeline and Effort](#22-timeline-and-effort)
23. [Risk Register](#23-risk-register)
24. [Open Decision Points](#24-open-decision-points)
25. [UX Enhancement Recommendations](#25-ux-enhancement-recommendations)
26. [AWS Services Alignment](#26-aws-services-alignment)
27. [Deployment Gate](#27-deployment-gate)

---

## 1. Executive Summary

### Goal

Build a natural-language farm operations agent that turns plain-English requests into safe, correct actions and clear daily guidance — especially for operators without computer skills. The agent is not a chatbot; it is a **coordinator** that maps language to a small set of well-defined operational intents with structured parameters, plus a policy for when to ask questions versus act.

### Why Now

The AI Vision stack is production-ready (52 opportunities, 48 done, 4 partial, 96% complete — AI Vision Readiness Report, Feb 23, 2026). All five feedback loops are closed. Central infrastructure is operational. The remaining work is not "more ML first" — it is **agent UX + safe tool execution + deterministic daily planning** to translate raw capability into dependable farmer outcomes.

### What Already Exists (Critical Context)

This is NOT a greenfield project. Significant agent infrastructure is already deployed:

| Component | Location | Lines | Status |
|-----------|----------|:-----:|--------|
| NL command parser + action executor | `services/ai-agent.js` | 1,576 | Deployed — 13 categories, 67 actions, GPT-4o-mini |
| 3-tier permission matrix | `data/agent-permissions.json` | 255 | Deployed — auto / recommend / require-approval |
| NeDB audit logging | `services/ai-agent.js` | — | Deployed — agent action audit trail |
| AI agent REST API | `routes/farm-sales/ai-agent.js` | — | Mounted — 5 endpoints at `/api/farm-sales/ai-agent/*` |
| Voice assistant (Activity Hub) | `public/views/tray-inventory.html` | 6,162 | Deployed — 27+ voice commands, Web Speech API |
| Floating farm assistant widget | `public/js/farm-assistant.js` | 1,357 | Deployed — voice + text chat, context detection |
| AI Vision QA | `routes/ai-vision.js` + `backend/ai_vision.py` | 515 | Deployed — plant health scoring via OpenAI Vision |
| Setup assist heuristics | `backend/ai_assist.py` | 220 | Deployed — device config guidance |
| Harvest readiness engine | `lib/harvest-readiness.js` | 393 | Deployed — growth rate + quality analysis |
| Loss predictor | `lib/loss-predictor.js` | 175 | Deployed — environment-correlated risk profiles |
| Production planner | `greenreach-central/jobs/production-planner.js` | 353 | Deployed — demand → succession → seeding plans |
| Recipe modifier engine | `lib/recipe-modifier.js` | 598 | Deployed — ±5% clamp, champion/challenger |
| Harvest predictor | `lib/harvest-predictor.js` | — | Deployed — 50+ crop varieties, ±2 day accuracy |
| Test infrastructure | `test-ai-agent.js`, `ai-agent-test.html`, `LE-ai-agent-test.html` | 1,110 | Deployed — mock context + 8 test commands |

**The implementation plan must build ON this foundation, not beside it.**

### What This Plan Adds

1. **Phase 0**: Close 4 remaining AI Vision gaps (~14h), bridge voice → agent API, fix stub handlers
2. **Phase 1**: Daily briefing ("what should we do today?"), harvest readiness, orders due — as read-only + confirmable action cards
3. **Phase 2**: Confirmable write actions — planting plans, device onboarding, order fulfillment, status changes
4. **Phase 3**: Operator preference learning, network intelligence surfacing, bounded autonomy with guardrails

### Key Design Evidence

- **Mixed-initiative interaction**: The agent must explicitly model uncertainty, use short clarification dialogs, allow direct invocation/termination, and scope precision to match uncertainty ("do less, but correctly" when uncertain).
- **Conversational IoT management**: Successful systems support time-based rules, multi-turn contextual interactions, event management, and causality queries ("why did the light change?").
- **Tool-calling reliability**: Agentic systems must support abstention (don't call tools when params are missing), stateful multi-step use, and consistency under repeated trials and paraphrases.
- **Voice in agriculture**: Specialised vocabulary, anti-misactivation, and multimodal disambiguation are essential in noisy environments.

---

## 2. Deployed Baseline — What Already Exists

### 2.1 AI Agent Service (`services/ai-agent.js` — 1,576 lines)

The core agent is a GPT-4o-mini-backed intent classifier + action executor with:

- **`parseCommand(userMessage, history)`** — Sends user message to OpenAI with structured JSON output for intent classification
- **`executeAction(intent, context)`** — Routes parsed intent to category-specific handler functions
- **`checkPermission(agentClass, category, action)`** — 3-tier permission gate
- **`logAgentAction()` / `getAuditLog()`** — NeDB-backed audit logging

**13 capability categories with 67 total actions:**

| Category | Handler | Tier Status |
|----------|---------|-------------|
| inventory | `executeInventoryAction` | Phase 1 — functional |
| orders | `executeOrdersAction` | Phase 1 — functional |
| sales | `executeSalesAction` | Phase 1 — functional |
| reports | `executeReportsAction` | Phase 1 — functional |
| checklists | `executeChecklistsAction` | Phase 1 — functional |
| monitoring | `executeMonitoringAction` | Phase 1 — read-only |
| admin | `executeAdminAction` | Phase 2 — **stubs** |
| marketing | `executeMarketingAction` | Phase 2 — **stubs** |
| payroll | `executePayrollAction` | Phase 2 — **stubs** |
| deployment | `executeDeploymentAction` | Phase 3 — **stubs** |
| viability | `executeViabilityAction` | Phase 3 — **stubs** |
| developer | `executeDeveloperAction` | Phase 4 — imports `lib/developer-mode.js` |
| system | (core) | Internal |

### 2.2 Voice Infrastructure

Voice is deployed across **17 files** via Web Speech API:

- **Activity Hub (`tray-inventory.html`)**: `processVoiceCommand()` handles 27+ intents via regex pattern matching — harvest actions, readiness checks, predictions, seeding, quality checks, zone status, recipe status, inventory, tasks
- **Farm Assistant widget (`farm-assistant.js`)**: Floating chat widget with voice + text, STT via `webkitSpeechRecognition`, TTS via `speechSynthesis`, context detection, conversation history

### 2.3 REST API Surface

Agent endpoints currently mounted in `server-foxtrot.js`:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/farm-sales/ai-agent/chat` | POST | Main NL command entrypoint |
| `/api/farm-sales/ai-agent/capabilities` | GET | List agent capabilities |
| `/api/farm-sales/ai-agent/status` | GET | Agent health check |
| `/api/farm-sales/ai-agent/feedback` | POST | Response quality feedback |
| `/api/farm-sales/ai-agent/audit` | GET | Query audit log |

Additional AI endpoints:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/ai/recommendations/receive` | POST | Incoming Central intelligence |
| `/api/ai/training-data` | GET | Export training data |
| `/api/ai/learning-correlations` | GET | Learning correlations |
| `/api/ai/network-intelligence` | GET | Network intelligence data |
| `/api/ai/suggested-crop` | GET | Crop suggestion |
| `/api/ai/status` | GET | AI subsystem status |
| `/api/ai/record-decision` | POST | Record human decision on AI rec |

### 2.4 AI Vision Readiness (Feb 23, 2026)

| Metric | Value |
|--------|-------|
| Opportunities defined | 52 |
| Done | 48 |
| Partial | 4 (T6, T16, T19, T21) |
| Not started | 0 |
| Completion | 96% |
| Feedback loops closed | 5/5 |
| Remaining effort | ~14 hours |
| Environment health | Green / Ready |
| Branch | `recovery/feb11-clean` @ `b235d7e` |
| Commits ahead of `main` | 39 |

### 2.5 Closed Feedback Loops

All five loops are closed, meaning the agent can answer "what changed, why, and did it work?" rather than giving static guidance:

| Loop | What It Enables for the Agent |
|------|-------------------------------|
| Recipe → Yield | "This modifier improved your arugula yield by 12%" |
| Environment → Loss | "You're at risk because humidity exceeded threshold for 3 hours" |
| Spectrum → Quality | "Quality scores dropped after blue was reduced — correlation: 0.82" |
| Timing → Efficiency | "Your grow days are 15% above network median; recipe adjustment available" |
| Demand → Production | "3 wholesale orders need arugula next week; current supply covers 67%" |

---

## 3. Architecture Gap Analysis

### 3.1 Critical Gap: Voice → Agent API Bridge

The most impactful architectural gap is that **voice commands and the AI agent API are disconnected**:

| Surface | Command Handling | Uses Agent API? |
|---------|-----------------|:---------------:|
| Activity Hub voice (`tray-inventory.html`) | Local regex pattern matching (27+ intents) | **NO** |
| Farm Assistant widget (`farm-assistant.js`) | Local context detection | **NO** |
| Agent test pages (`ai-agent-test.html`) | `POST /api/farm-sales/ai-agent/chat` | **YES** |

The voice systems use client-side regex to match commands and call individual REST endpoints directly. They do NOT route through the GPT-backed agent that can handle ambiguity, multi-turn dialogs, and mixed-initiative clarification. This means:

- Voice commands only work for exact patterns
- No clarification dialogs ("did you mean Zone 3 or Zone 4?")
- No multi-step reasoning
- No audit trail through the agent's decision log
- No benefit from the 3-tier permission system

**Remediation**: Route voice commands through `POST /api/farm-sales/ai-agent/chat` as the single entrypoint. Keep regex as a fast-path fallback for unambiguous commands.

### 3.2 Gap: Phase 2/3 Agent Handlers Are Stubs

Six of 13 capability categories return placeholder data rather than connecting to real farm/Central APIs:

| Category | Current State | What It Should Do |
|----------|---------------|-------------------|
| admin | Returns static recommendations | Query Central admin endpoints, manage farm config |
| marketing | Returns static recommendations | Surface Central demand signals, buyer behavior |
| payroll | Returns static recommendations | Driver/worker pay data (if delivery service active) |
| deployment | Returns static recommendations | EB environment status, deploy coordination |
| viability | Returns static recommendations | ROI analysis from Central performance metrics |
| integrations | **Does not exist** | Device discovery, onboarding (proposed in Integration Assistant) |

### 3.3 Gap: No Daily Briefing / To-Do Generation

Despite having all the data sources (harvest readiness, orders, production plans, device health, loss risk), there is no endpoint or agent skill that aggregates these into a daily briefing. The agent can answer individual questions but cannot proactively say "here's what matters today."

### 3.4 Gap: No "How Are We Doing?" Aggregation

Network intelligence, comparative analytics, and leaderboard data flow from Central, but no agent skill synthesizes them into a conversational operational briefing.

### 3.5 Remaining AI Vision Gaps (4 items, ~14h)

| # | Task | Gap | Effort | Agent Impact |
|---|------|-----|:------:|-------------|
| T6 | Learning correlations dashboard | API exists, no front-end viz | ~4h | Medium — trust + learning |
| T16 | Auto-print on harvest scan | Server signals `auto_print: true`; client doesn't trigger | ~2h | High — daily friction removal |
| T19 | Auto-assign discovered lights to zones | Discovery works; auto-zone assignment incomplete | ~4h | High — device onboarding |
| T21 | Onboarding wizard with pre-seeded benchmarks | Push on registration works; no wizard step surfaces it | ~4h | Medium — adoption/retention |

### 3.6 Gap: In-Memory Volatile Stores

9 subsystems use in-memory storage (AI Vision Readiness Report §7). The agent cannot reliably query data that may vanish on restart:

| Data | Current Storage | Risk |
|------|----------------|------|
| Fulfillment records | In-memory | Lost on deploy |
| Audit log (non-agent) | In-memory | Lost on deploy |
| Wholesale inventory reservations | In-memory | Lost on deploy |
| Orders | In-memory | Lost on deploy |

This is the same class of issue identified in the Delivery Service audit (F-3). Agent reliability depends on durable persistence.

---

## 4. Design Principles

These principles govern all agent behavior. They are derived from peer-reviewed mixed-initiative interaction research, conversational IoT studies, and tool-calling reliability benchmarks.

### DP-1: Mixed-Initiative Interaction

The agent must:
- **(a)** Consider uncertainty about the user's goals
- **(b)** Use dialog to resolve key uncertainties
- **(c)** Allow direct invocation and termination
- **(d)** Scope the precision of service to match uncertainty ("do less, but correctly" when uncertain)

### DP-2: Read-Only by Default

Any request with missing slots or high downside potential defaults to showing information and proposing a plan. The agent never "guesses and commits" on write actions.

### DP-3: Confirm Before Write

Planting plan commits, device bindings, order status changes, and automated schedule changes require an explicit confirmation step with a plan preview card showing what will change.

### DP-4: Abstain When Parameters Are Missing

If a required parameter for a tool call is absent, do not invoke the function. Instead, request the missing inputs. This follows template-guided tool use best practices.

### DP-5: Fast Undo/Cancel

Every state-changing action provides "undo last action" capability using the command pattern. Command history enables causality queries.

### DP-6: Explainability and Causality

The agent must answer "why did X happen?" using executed command history, rule chains, and audit trails — a key capability for building trust in automated systems.

### DP-7: Multimodal Disambiguation

For ambiguous commands, provide text + visual cue selection to refine intent. Do not guess when the cost of a wrong guess is high.

### DP-8: Deterministic First, Learning Second

The daily to-do list and operational briefing are rule-based (deterministic) first. ML improves them over time but is never the sole source of truth.

### DP-9: Central-First Intelligence

The agent surfaces network-first intelligence (benchmarks, trends, recipe modifiers) from Central before falling back to farm-local-only data. This aligns with AI Vision Rule 1.5: "Central Is the Mother Ship."

### DP-10: AI Suggests, Grower Confirms (Phase 1–4)

AI never autonomously changes recipes, temperatures, lighting, or growing parameters without explicit grower approval. Exception: safety overrides (freeze, fire, equipment over-temp) per AI Vision Rule 8.2.

---

## 5. Command Taxonomy

The agent maps natural language to a small set of well-defined operational intents with structured parameters ("slots") and a policy for when to ask questions.

### 5.1 Command Families

| # | Command Family | Example Utterances | Required Slots | Optional Slots | Follow-Up Policy |
|---|----------------|-------------------|----------------|----------------|------------------|
| 1 | **Daily to-do list** | "What should we do today?" | date (default: today) | time_available, staffing, priority_style | Show prioritized tasks; let user drill down |
| 2 | **Harvest readiness** | "What's ready to harvest today?" | date (default: today) | include_ready_soon_window, min_confidence | Ranked list + confidence + why |
| 3 | **Wholesale operations** | "What wholesale orders do we have to fill today?" | date_window | sort_by, include_labels | Pick list + confirmations for status changes |
| 4 | **Production planning** | "Plant 10 full groups of arugula, stagger weekly" | crop, group_count, cadence | start_date, target_harvest_qty, allowed_rooms | Ask start week + constraints; show plan preview before commit |
| 5 | **Device onboarding** | "Help me add a new light in Zone 3" | device_type, zone | name, inherit_schedule, safety_limits | Ask only what's needed; preview mapping |
| 6 | **Status / briefing** | "How are we doing?" | timeframe (default: 7 days) | vs_plan, vs_network | Ask what comparison matters; summarize with drill-down |
| 7 | **Causality / explanations** | "Why did the lights change last night?" | entity (zone/group/device), time_window | show_rule_chain | Explain via audit/event history |
| 8 | **Inventory** | "How much basil do we have?" | — | crop, sku, include_reserved | Existing handler — functional |
| 9 | **Seeding** | "Seed basil in tray A1" | crop | tray_code, quantity | Existing voice command — wire to agent |
| 10 | **Quality check** | "Quality check for group 5" | group_id | checkpoint_type | Existing handler — trigger AI Vision |

### 5.2 Mapping to Existing Agent Categories

| Command Family | Existing Category in `ai-agent.js` | Status |
|----------------|-------------------------------------|--------|
| Daily to-do | **NEW** — `daily-briefing` | To be added |
| Harvest readiness | monitoring (partial) | Extend with harvest-readiness.js |
| Wholesale operations | orders (functional) | Extend with fulfillment flow |
| Production planning | **NEW** — extend inventory/admin | Wire to production-planner.js |
| Device onboarding | **NEW** — `integrations` | Per Integration Assistant proposal |
| Status / briefing | **NEW** — `daily-briefing` | To be added |
| Causality | **NEW** — `explanations` | Wire to audit log + event history |
| Inventory | inventory (functional) | Existing |
| Seeding | checklists (partial) | Extend |
| Quality check | monitoring (partial) | Wire to ai-vision.js |

---

## 6. Agent Architecture

### 6.1 Reference Architecture

```
Operator: voice / text / action card tap
         │
         ▼
┌─────────────────────────────────────┐
│  UI Layer                           │
│  Voice (Web Speech API)             │
│  Text input (Farm Assistant widget) │
│  Action cards (confirm/edit/cancel) │
└────────────────┬────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────┐
│  POST /api/farm-sales/ai-agent/chat │  ← Single entrypoint
│  (routes/farm-sales/ai-agent.js)    │
└────────────────┬────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────┐
│  Dialogue Manager                   │
│  (services/ai-agent.js)             │
│  - parseCommand() → intent + slots  │
│  - checkPermission() → auto/rec/req │
│  - Mixed-initiative policy          │
│  - Session context (multi-turn)     │
└────────────────┬────────────────────┘
                 │
         ┌───────┴───────┐
         ▼               ▼
┌────────────────┐ ┌────────────────┐
│  Planner       │ │  Read-Only     │
│  (write path)  │ │  Aggregator    │
│  goal → steps  │ │  (daily brief) │
│  draft → conf  │ │  harvest ready │
│  → apply       │ │  orders due    │
└───────┬────────┘ └───────┬────────┘
        │                  │
        ▼                  ▼
┌─────────────────────────────────────┐
│  Tool Gateway                       │
│  Typed schemas + validation         │
│  Abstention policy                  │
│  Idempotency keys (writes)          │
└────────────────┬────────────────────┘
                 │
     ┌───────────┼───────────┐
     ▼           ▼           ▼
 Farm APIs    Central APIs  Wholesale APIs
 (groups,     (benchmarks,  (orders,
  harvest,     plans,       reservations,
  devices)     network)     labels)
                 │
                 ▼
┌─────────────────────────────────────┐
│  Event Log + Audit Trail            │
│  (NeDB agent_actions + tool_calls)  │
│  Enables causality queries          │
└─────────────────────────────────────┘
```

### 6.2 Data Flow: Central ↔ Farm ↔ Agent

```
Central (30-min push)                Farm Server                    Agent
─────────────────────              ──────────────               ──────────
  Benchmarks         ──────────►  /api/ai/recommendations      parseCommand()
  Demand signals     ──────────►  /api/ai/network-intelligence  ├─► daily-briefing
  Recipe modifiers   ──────────►  Local feature store           ├─► harvest-readiness
  Risk alerts                     ├── harvest-readiness.js      ├─► orders
  Performance rank                ├── loss-predictor.js         ├─► planning
                                  ├── production-planner.js     ├─► status
  Farm data (5-min sync) ◄────── syncFarmData()                 └─► causality
  Experiment records  ◄───────── POST /api/sync/experiment-records
```

### 6.3 Mandatory Middleware Order

Per AI Vision Rule and Architecture Plan:

```
auth → farm-scope resolution → input validation → handler
```

For agent-specific paths:

```
auth → farm-scope → rate-limit → parseCommand → checkPermission → handler → audit-log
```

---

## 7. Phase 0 — Prerequisite Remediation (BLOCKING) — 3–5 days

**Objective**: Close the 4 remaining AI Vision gaps, bridge the voice → agent API disconnect, fix stub handlers, and establish the foundation for the daily briefing. No customer-visible agent features are shipped in Phase 0.

### 7.1 Close AI Vision Gaps (T6, T16, T19, T21) — ~14 hours

These gaps directly affect agent usefulness and daily friction:

| Task | Action | Why It Matters for the Agent | Effort |
|------|--------|------------------------------|:------:|
| T16 | Wire client-side auto-print trigger on harvest scan | "Scan → done" flow is the most frequent daily operation. Friction here undermines trust in the agent's "simplify everything" promise. | ~2h |
| T19 | Complete auto-assign discovered lights to zones | Device onboarding is a key agent skill (Command Family #5). If discovery works but zone assignment doesn't, the agent can't complete the workflow. | ~4h |
| T6 | Wire learning correlations API to front-end visualization | The agent can state correlations verbally, but operators need to see and explore them to build trust. | ~4h |
| T21 | Surface network benchmarks in onboarding wizard | New farm users should immediately benefit from Central intelligence. Without this, the agent's "how are we doing vs network?" skill has no first-run value. | ~4h |

**Priority order**: T16 → T19 → T6 → T21 (highest daily-frequency impact first).

### 7.2 Bridge Voice → Agent API — ~8 hours

Modify `tray-inventory.html` and `farm-assistant.js` to route commands through `POST /api/farm-sales/ai-agent/chat` as the single entrypoint:

| Step | Action | Detail |
|------|--------|--------|
| 7.2.1 | Add fast-path regex pre-filter (client side) | Keep the existing 27+ regex patterns as a **fast path** for unambiguous commands (e.g., "show inventory"). If a regex matches with high confidence, call the specific API directly — no round-trip to OpenAI. This preserves responsiveness. |
| 7.2.2 | Route unmatched/ambiguous commands to agent API | Any command that doesn't match a regex pattern (or matches multiple) is sent to `POST /api/farm-sales/ai-agent/chat`. This enables multi-turn clarification, mixed-initiative dialog, and the full permission matrix. |
| 7.2.3 | Unify TTS response | Agent API responses should include a `spoken` field (plain-language summary) that the voice system reads aloud, separate from the structured data payload. |
| 7.2.4 | Session context passing | Pass conversation history and current UI context (active page, selected group, visible zone) to the agent API for context-aware responses. |

**Architecture constraint**: The agent API is the **authoritative command path**. Voice and text are input channels, not separate command systems. The regex fast-path is a performance optimization, not an alternative architecture.

### 7.3 Add `daily-briefing` Capability Category — ~6 hours

Add a new capability category in `services/ai-agent.js`:

```javascript
// New category: daily-briefing
{
  category: 'daily-briefing',
  actions: [
    { name: 'daily-todo', description: 'Generate prioritized daily task list' },
    { name: 'harvest-readiness', description: 'What is ready to harvest today?' },
    { name: 'orders-due', description: 'Wholesale orders due today/this week' },
    { name: 'status-briefing', description: 'How are we doing?' },
    { name: 'risk-alerts', description: 'What is at risk?' }
  ],
  permission: 'auto'  // read-only — no confirmation needed
}
```

Wire the handler to aggregate from:
- `lib/harvest-readiness.js` → `scanHarvestReadiness()`
- `lib/loss-predictor.js` → `predictLossRisk()`
- Wholesale orders endpoint
- Production plan / seeding schedule
- Device health / sensor anomalies
- Central network intelligence (if available)

### 7.4 Add `explanations` Capability Category — ~4 hours

Add causality query support:

```javascript
{
  category: 'explanations',
  actions: [
    { name: 'why-changed', description: 'Explain why something changed' },
    { name: 'what-happened', description: 'Describe events in a time window' },
    { name: 'audit-trail', description: 'Show decision/action history' }
  ],
  permission: 'auto'
}
```

Wire to:
- Agent audit log (`getAuditLog()`)
- Light automation events (schedule changes, recipe applications)
- Environment deviations log
- Central push history

### 7.5 Persist Volatile Stores — ~8 hours

Per AI Vision Readiness Report §7 and Rule 9.2 ("Persist, Don't Discard"), migrate the highest-impact in-memory stores to NeDB or PostgreSQL:

| Store | Priority | Migrate To | Why |
|-------|:--------:|------------|-----|
| Orders | P0 | NeDB | Agent can't show "orders due today" if orders vanish on restart |
| Fulfillment records | P0 | NeDB | Agent can't track "pick list" or "packing status" without persistence |
| Inventory reservations | P1 | NeDB | Agent's "start picking → lock reservations" flow depends on durability |
| Audit log (non-agent) | P1 | NeDB | Causality queries require historical event data |

### 7.6 Merge / Rebase 39-Commit Divergence — Engineering Governance

The `recovery/feb11-clean` branch has 39 commits and 148 files changed (21K+ insertions) ahead of `main`. This is not a feature task but an engineering governance item that reduces long-term operational risk. Recommend merging to `main` before beginning Phase 1 feature work to establish a clean baseline.

---

## 8. Phase 1 — Daily Briefing + Read-Only Agent Loop — 4–6 days

**Objective**: Ship the highest daily-impact agent skill first: the daily to-do list, harvest readiness, and orders due — as read-only + confirmable action cards. This sequencing aligns with mixed-initiative principles: act conservatively under uncertainty while building trust and gathering usage signals.

**Risk level**: Low–Medium (primarily UX + integration).

### 8.1 Daily To-Do List

**Endpoint**: `POST /api/farm-sales/ai-agent/chat` with intent → `daily-briefing.daily-todo`

**User triggers**: "What should we do today?", "What's on the list?", "Morning briefing", or voice command "daily tasks"

**Output structure** (action cards):

```json
{
  "briefing_date": "2026-02-23",
  "sections": [
    {
      "label": "Must Do Now",
      "priority": "critical",
      "tasks": [
        {
          "task_type": "harvest",
          "target": "Group 7 — Genovese Basil",
          "reason": "92% readiness, optimal window closes in 8 hours",
          "confidence": 0.92,
          "action_card": {
            "confirm_label": "Start Harvest",
            "action": "harvest.start",
            "params": { "group_id": "group-7" }
          }
        }
      ]
    },
    {
      "label": "Today",
      "priority": "high",
      "tasks": [...]
    },
    {
      "label": "Optional / Improvement",
      "priority": "low",
      "tasks": [...]
    },
    {
      "label": "Monitor",
      "priority": "watch",
      "tasks": [...]
    }
  ]
}
```

See [§12 Daily To-Do Generation Algorithm](#12-daily-to-do-generation-algorithm) for the full deterministic algorithm.

### 8.2 Harvest Readiness Integration

**User triggers**: "What's ready to harvest?", "Harvest readiness", "What can we pick?"

Wire to existing `lib/harvest-readiness.js` → `scanHarvestReadiness()`. Output includes:
- Ranked list by confidence (highest first)
- Color-coded badges (green ≥85%, yellow 70–84%, red <70%)
- "Ready soon" expansion on demand ("also want 48-hour lookahead?")
- Action cards: "Start Harvest" → confirm → generate labels + update status

### 8.3 Orders Due

**User triggers**: "What orders need to go out?", "Wholesale orders", "Pick list"

Wire to existing wholesale order APIs. Output:
- Orders due today / next 24h (clarify if ambiguous)
- Pick list by crop
- Missing items risk check (harvest readiness vs order quantities)
- Action cards: "Start Picking" → confirm → lock reservations

### 8.4 Risk Alerts

**User triggers**: "What's at risk?", "Any problems?", "Loss alerts"

Wire to `lib/loss-predictor.js` → `predictLossRisk()` + device health endpoints. Output:
- Active risk profiles with confidence
- Environmental deviation warnings
- Sensor anomaly alerts
- Device health issues

### 8.5 Status Briefing v1

**User triggers**: "How are we doing?", "Status report", "Weekly summary"

See [§13 "How Are We Doing?" Operational Briefing](#13-how-are-we-doing-operational-briefing) for the full specification.

### 8.6 UI: Action Cards Component

All Phase 1 outputs render as **action cards** in the Activity Hub and Farm Assistant widget:

```
┌─────────────────────────────────────────────────┐
│ 🌿 Group 7 — Genovese Basil         92% ready  │
│ Optimal harvest window closes in 8 hours        │
│ Estimated yield: 4.2 kg (12 heads)              │
│                                                 │
│  [✓ Start Harvest]  [📋 Details]  [⏰ Remind]   │
└─────────────────────────────────────────────────┘
```

Card states: `pending` → `confirmed` → `in-progress` → `completed` | `cancelled`

Cards are **mixed-mode** in Phase 1: informational cards remain read-only, while operational cards are confirmable handoffs into existing workflows. No autonomous write path is introduced in Phase 1; any state change still requires explicit user confirmation in the target flow. The agent tracks which cards were acted on as training data for Phase 3 learning.

### 8.7 "Undo Last Action" Pattern

Implement the command pattern for all state-changing actions triggered via action cards:

```javascript
// Command pattern
class AgentCommand {
  constructor(type, params, executor, undoExecutor) {
    this.id = crypto.randomUUID();
    this.type = type;
    this.params = params;
    this.executor = executor;
    this.undoExecutor = undoExecutor;
    this.executed_at = null;
    this.undone_at = null;
  }

  async execute() { /* ... */ }
  async undo() { /* ... */ }
}
```

Store command history in NeDB for causality queries ("what did the agent do today?").

---

## 9. Phase 2 — Confirmable Write Actions — 3–6 weeks

**Objective**: Expand "do things for me" behaviours with strong guardrails. All write actions follow the two-phase commit pattern: draft → preview → confirm → apply.

**Risk level**: Medium (multi-step state changes; requires strong audit + RBAC).

### 9.1 Production Planning Commands

**User flow**:
```
User:   "Plant 10 full groups of arugula, stagger weekly"
Agent:  "Starting this week, or next Monday?"     (slot clarification)
User:   "This week"
Agent:  "1 group/week for 10 weeks, or 2/week for 5 weeks?"
User:   "One per week"
Agent:  [ACTION CARD: Plan Draft]
        10 batches, weekly cadence, each = 1 full group
        Groups allocated: Z3-G1, Z3-G2, Z3-G3 ...
        Expected harvest windows: Mar 22, Mar 29, Apr 5 ...
        [✓ Commit Plan]  [✏️ Edit]  [✗ Cancel]
```

**Wire to**: `greenreach-central/jobs/production-planner.js` → `generateWeeklyPlan()`

**Safety rules**:
- Plan preview shows all affected groups, dates, and assumptions
- Commit creates seeding tasks in the production schedule
- Edit allows parameter changes before commit
- Cancel discards the draft (no state change)
- Committed plans can be rolled back within 24 hours via undo

### 9.2 Device Onboarding Commands

**User flow**:
```
User:   "I installed a new light in Zone 3. Add it."
Agent:  "Is this a 4-channel grow light or a simple on/off light?"
User:   "4 channel"
Agent:  "How is it connected: the existing controller in Zone 3, or a new controller?"
User:   "Existing controller"
Agent:  [ACTION CARD: Device Binding]
        Bind new fixture to Zone 3
        Inherit Zone 3 schedule
        Apply safety envelope (max PPFD, max duty)
        Name: "Zone 3 – Light 5"
        [✓ Confirm]  [✏️ Edit]  [✗ Cancel]
```

**Wire to**: `lib/device-discovery.js` + T19 auto-zone assignment

**Safety rules** per Integration Assistant proposal:
- Safety envelope (max PPFD, max duty cycle) applied by default
- Device binding is audited
- Confirmation required before any device starts receiving commands

### 9.3 Order Fulfillment Flow

**User flow**:
```
User:   "Start picking order ORD-2041"
Agent:  [ACTION CARD: Pick List]
        Order ORD-2041 — Kingston Food Co-op
        Items: 5 kg Genovese Basil, 3 kg Arugula
        Available: Basil ✅ 6.2 kg, Arugula ⚠️ 2.8 kg (0.2 kg short)
        [✓ Start Picking]  [📋 Show Shortage Options]  [✗ Cancel]
User:   "Start picking"
Agent:  "Reservations locked. Mark items as picked when done."
```

**Wire to**: Wholesale order APIs + inventory reservation system

### 9.4 Multimodal Disambiguation

For ambiguous commands, the agent provides visual selection:

```
User:   "Turn up the lights"
Agent:  "Which zone?"
        [Zone 1 — Grow Room]  [Zone 2 — Nursery]  [Zone 3 — Staging]
        "And by how much?"
        [+10%]  [+25%]  [+50%]  [Set specific PPFD]
```

This is delivered as a card in the UI, not as a voice-only dialog.

### 9.5 Implement Formal Tool Reliability Tests

Implement evaluation concepts aligned with function-calling benchmarks (BFCL-style):
- **Abstention correctness**: Agent correctly declines to call a tool when required params are missing
- **Multi-step consistency**: Agent completes multi-step workflows (plan → confirm → execute) without state corruption
- **Paraphrase robustness**: Same intent phrased 5 different ways produces consistent results
- **Fault tolerance**: Agent handles API timeouts, rate limits, and schema drift gracefully

---

## 10. Phase 3 — Learning + Autonomy (Bounded) — 2–6 months

**Objective**: Learn operator preferences, surface Central-first network intelligence, and introduce bounded autonomy for low-risk actions.

**Risk level**: Medium–High (trust + safety).

### 10.1 Operator Preference Learning

Use `agent_sessions`, `agent_intents`, and `task_outcomes` data (see §15) to:
- Reduce clarifying questions (learn defaults per operator)
- Improve task prioritization (learn what operators actually do first)
- Personalize daily briefing ordering
- Learn preferred response verbosity and level of detail

### 10.2 Network Intelligence Surfacing

Push Central-first "network insights" into the agent's daily briefing:
- "You are below network median for arugula yield; here's the recommended adjustment"
- "Network alert: 3 farms reporting leaf curl on basil — check your environment"
- "Your energy efficiency is in the top quartile — good work"

Wire to existing Central push payload (`network_intelligence` section in AI recommendations).

### 10.3 Bounded Autonomy

Introduce "autonomy within guardrails" for low-risk actions:

| Action | Autonomy Level | Guardrail |
|--------|:-------------:|-----------|
| Auto-suggest schedule tweaks | Draft only | Human confirms |
| Create draft production plans | Draft only | Human confirms |
| Reorder daily to-do list | Autonomous | Revert on tap |
| Auto-dismiss stale notifications | Autonomous | Log + undo available |
| Apply recipe modifier within ±2% | **Autonomous** (Phase 5 only) | Revert on 2 consecutive regressions (Rule 6.3) |
| Adjust environment setpoint | **Never autonomous** | Safety overrides excepted (Rule 8.2) |

### 10.4 Resilience Under Production Perturbations

Add reliability evaluation under production-like conditions:
- Repeated trials (run planner twice; if plans differ materially, force clarification)
- API fault injection (timeouts, rate limits, schema drift)
- Stochastic stability checks for high-impact actions

---

## 11. Tool-Calling Safety Rules

### 11.1 Operational Rules

| Rule | When It Applies | Behaviour |
|------|----------------|-----------|
| Read-only by default | Any request with missing slots or high downside | Ask clarifying questions; propose a plan; never "guess and commit" |
| Confirm before write | Plan commit, device binding, order status change, schedule change | Show plan preview card (what will change) + require explicit confirmation |
| Abstain when params missing | Any tool call with required schema fields absent | Ask for missing values — do not call the function |
| Fast undo/cancel | Any state-changing action | Provide "undo last action" + store command history |
| Explainability | "Why did X happen?" or "What changed?" | Answer using audit log, rule chain, event history |
| Multimodal disambiguation | Ambiguous commands | Provide text + visual cue selection to refine intent |
| Voice safety | Noisy environment commands | Require confirmation for any write action triggered by voice |

### 11.2 Engineering Guardrails

| Guardrail | Detail |
|-----------|--------|
| Deterministic tool gateway | Typed schemas + JSON validation for all tool calls; reject malformed params |
| Idempotency keys for writes | Every write call includes an idempotency key; replay-safe by default |
| Two-phase commit | High-risk actions: draft → preview → confirm → apply |
| Stochastic stability check | Run planner twice for high-impact actions; if results differ materially, force clarification |
| Fault-aware retries | Bounded retries with exponential backoff; do not retry non-idempotent writes without replay-safe key |
| Rate limiting | Agent API rate-limited per farm per minute to prevent abuse |
| Permission escalation logging | Every permission check logged; every escalation to `require-approval` logged |

### 11.3 Permission Matrix Extension

Extend the existing 3-tier permission system in `data/agent-permissions.json`:

| Tier | Behaviour | Example Actions |
|------|-----------|----------------|
| `auto` | Execute immediately, no confirmation | Read operations, daily briefing, status queries |
| `recommend` | Show plan + recommend action; operator confirms or dismisses | Start picking, generate labels, apply recipe modifier |
| `require-approval` | Show plan + require typed confirmation ("I confirm"); block execution until confirmed | Commit production plan, bind device, change environment setpoint, delete records |

---

## 12. Daily To-Do Generation Algorithm

The daily to-do list is **deterministic first** (rule-based), then improved by learning. This reduces error risk and aligns with mixed-initiative principles.

### 12.1 Candidate Collection

Collect tasks from authoritative sources (all existing APIs):

| Source | API / Module | Task Types |
|--------|-------------|------------|
| Wholesale orders | Order APIs | Orders due, pick lists, packing tasks |
| Harvest readiness | `lib/harvest-readiness.js` | Harvests ready today + next 48h |
| Production plan | `production-planner.js` | Seeding windows, succession staggers |
| Loss predictor | `lib/loss-predictor.js` | At-risk crops, environmental deviations |
| Device health | Sensor/device endpoints | Anomalies, offline sensors, calibration due |
| QA schedule | QA checkpoint system | Growth inspections, weigh-ins due |
| Central intelligence | AI push channel | Network risk alerts, recipe modifier suggestions |

### 12.2 Task Schema

```typescript
interface DailyTask {
  task_id: string;
  task_type: 'harvest' | 'seeding' | 'order' | 'qa' | 'device' | 'move' | 'monitor' | 'experiment';
  target_entity: string;       // group ID, order ID, device ID
  target_label: string;        // human-readable name
  deadline: string | null;     // ISO timestamp or null
  dependencies: string[];      // task_ids that must complete first
  estimated_minutes: number;
  confidence: number;          // 0.0–1.0 (data completeness + prediction confidence)
  source: string;              // which API/module generated this
  urgency_score: number;       // computed: deadline proximity
  impact_score: number;        // computed: revenue at risk, crop loss risk, downstream blockage
  effort_score: number;        // computed: duration / complexity
}
```

### 12.3 Scoring Algorithm

Each task is scored using expected-utility ranking:

```
score = (urgency × 0.35) + (impact × 0.30) + (confidence × 0.20) + (dependency_weight × 0.15)
```

Where:
- **urgency** = `1.0 - (hours_to_deadline / 24)` (clamped 0–1; overdue = 1.0)
- **impact** = normalized revenue-at-risk + crop-loss-risk + downstream-blockage (0–1)
- **confidence** = data completeness score from source module (0–1)
- **dependency_weight** = 1.0 if this task blocks other tasks; 0.0 otherwise

### 12.4 Output Tiers

| Tier | Criteria | Max Items |
|------|----------|:---------:|
| **Must Do Now** | score ≥ 0.80 OR overdue | 5 |
| **Today** | score ≥ 0.50 AND deadline within 24h | 10 |
| **Optional / Improvement** | score < 0.50 OR no deadline | 5 |
| **Monitor** | informational; no action required | unlimited |

### 12.5 Action Mode

Every task includes an action mode:

| Mode | Behaviour |
|------|-----------|
| `read-only` | Show list + explain. No state change. |
| `confirmable` | Show plan preview + require confirmation. |
| `navigate` | Offer to navigate to the relevant UI page. |

### 12.6 Example Task Mix (Illustrative)

| Category | % of Typical Day |
|----------|:----------------:|
| Harvest & post-harvest (labels, weigh-ins) | ~35% |
| Wholesale fulfillment (pick/pack/ship) | ~25% |
| Seeding & staggering tasks | ~15% |
| Moves/placements & room work | ~10% |
| QA & monitoring (photos, checks) | ~10% |
| Device/sensor maintenance | ~5% |

---

## 13. "How Are We Doing?" Operational Briefing

### 13.1 Default Answer Bundle

When the operator asks "how are we doing?", the agent returns a structured briefing with drill-down:

| Section | Content | Source |
|---------|---------|--------|
| **Production pipeline** | Groups by stage; predicted harvest volume by week; "late vs on-time" estimates | harvest-readiness.js, production-planner.js |
| **Sales execution** | Orders due today/this week; fill risk; on-time delivery rate | Wholesale order APIs |
| **Quality and loss** | Quality trend (last 7–30 days); loss risk hotspots; active risk profiles | loss-predictor.js, ai-vision quality trends |
| **System reliability** | Sensor uptime %; recent anomalies; automation interventions; device health | Anomaly diagnostics, device health endpoints |
| **Network comparison** | Percentile vs network for key crops (yield, grow days, energy efficiency) | Central push payload (`network_intelligence.crop_benchmarks`) |

### 13.2 Clarification

If the timeframe or comparison basis is ambiguous:

```
Agent: "How are we doing compared to what — your plan, last month, or the network?"
       [vs Plan]  [vs Last Month]  [vs Network]
```

### 13.3 Drill-Down

Each section is expandable. The agent offers to drill into specifics:

```
Agent: "Production is 85% on-track. 2 groups are behind schedule.
        Want details on the late groups?"
       [Yes, show details]  [No, continue]
```

---

## 14. Sample Dialogues

### 14.1 Device Onboarding

```
User:   "I installed a new light in Zone 3. Add it."
Agent:  "Got it. Is this a 4-channel grow light (spectrum channels)
         or a simple on/off light?"
User:   "4 channel."
Agent:  "How is it connected: the existing controller in Zone 3,
         or a new controller?"
User:   "Existing controller."
Agent:  "I'll bind the new fixture to Zone 3, inherit Zone 3's schedule,
         and apply the safety envelope (max PPFD, max duty).
         Want to name it 'Zone 3 – Light 5'?"
User:   "Yes."
Agent:  ┌──────────────────────────────────────────┐
        │ Confirm Device Binding                   │
        │ • Bind to Zone 3 controller              │
        │ • Inherit Zone 3 schedule                │
        │ • Safety: max 600 PPFD, max 85% duty     │
        │ • Name: Zone 3 – Light 5                 │
        │ • Start monitoring immediately           │
        │                                          │
        │  [✓ Confirm]  [✏️ Edit]  [✗ Cancel]     │
        └──────────────────────────────────────────┘
```

Consistent with mixed-initiative principles: resolve key uncertainties with short dialog, then provide easy cancel/termination.

### 14.2 Planting with Stagger

```
User:   "I want to plant 10 full groups of arugula, stagger for
         regular weekly harvest."
Agent:  "Starting this week, or next Monday?"
User:   "This week."
Agent:  "Do you want 1 group seeded each week for 10 weeks,
         or 2 groups per week for 5 weeks?"
User:   "One group per week."
Agent:  ┌──────────────────────────────────────────┐
        │ Production Plan Draft                    │
        │ Crop: Astro Arugula                      │
        │ Cadence: 1 group/week × 10 weeks         │
        │ Start: Feb 23, 2026                      │
        │ Groups: Z3-G1 → Z3-G10                   │
        │ Expected harvests: Mar 22 – May 24       │
        │                                          │
        │  [✓ Commit Plan]  [✏️ Edit]  [✗ Cancel] │
        └──────────────────────────────────────────┘
```

### 14.3 Harvest Readiness

```
User:   "What is ready to be harvested today?"
Agent:  "Here are today's harvest priorities (high confidence first):

         🟢 Group 7 — Genovese Basil (92% ready)
            Est. yield: 4.2 kg | Optimal window: next 8 hours
            [Start Harvest]

         🟢 Group 3 — Astro Arugula (86% ready)
            Est. yield: 2.8 kg | Optimal window: next 12 hours
            [Start Harvest]

         Do you also want 'likely ready in the next 48 hours'?"
User:   "Yes."
Agent:  "Ready soon:
         🟡 Group 9 — Butterhead Lettuce (74%)
         🟡 Group 4 — Thai Basil (71%)

         Want me to generate a harvest route and label tasks
         after you confirm quantities?"
```

### 14.4 Wholesale Orders

```
User:   "What wholesale orders do we have to fill?"
Agent:  "For which date: today only, or next 24 hours?"
User:   "Today."
Agent:  "2 orders due today:
         • ORD-2041 — Kingston Food Co-op ($142.50)
           5 kg Basil ✅, 3 kg Arugula ⚠️ (0.2 kg short)
         • ORD-2042 — Farm Gate Market ($87.00)
           2 kg Lettuce ✅, 1 kg Kale ✅

         I can generate: (1) pick list by crop, (2) packing labels,
         (3) missing items risk check. Which first?"
User:   "Pick list."
Agent:  ┌──────────────────────────────────────────┐
        │ Pick List — Feb 23                       │
        │ Genovese Basil: 5.0 kg (avail: 6.2 kg)  │
        │ Astro Arugula:  3.0 kg (avail: 2.8 kg!) │
        │ Butterhead:     2.0 kg (avail: 4.1 kg)   │
        │ Curly Kale:     1.0 kg (avail: 1.5 kg)   │
        │                                          │
        │  [✓ Start Picking]  [📋 Details]  [✗]   │
        └──────────────────────────────────────────┘
        "Confirm when you start picking so I can lock reservations
         and avoid overselling."
```

### 14.5 Causality Query

```
User:   "Why did the lights change last night?"
Agent:  "Zone 2 lights adjusted at 11:42 PM last night.

         Cause chain:
         1. Outdoor temperature dropped to -8°C (sensor: outdoor-temp-1)
         2. Adaptive control Tier 1 triggered extreme cold rule
            → Temperature setpoint relaxed by -1°C
         3. Recipe engine recalculated DLI target
            → Photoperiod extended by 22 minutes to compensate
         4. Light schedule updated: off-time moved from 10:00 PM to 10:22 PM

         Source: adaptive-control.js rule 'extreme_cold_relaxation'
         Safety: within ±2°C bound (Rule 6.2)

         [View Full Audit Trail]  [OK]"
```

---

## 15. Training Data Schema

### 15.1 Agent-Specific Tables

| Table | Primary Key | Core Fields | Used By |
|-------|-------------|-------------|---------|
| `agent_sessions` | session_id | user_id, channel (voice/text), start/end time, context snapshot | UX + reliability tracing |
| `agent_intents` | intent_id | utterance, parsed_intent, slots, ambiguity_score, confidence | NLU improvement |
| `agent_tool_calls` | call_id | tool_name, params, validation_result, outcome, latency_ms, retry_count | Tool reliability analysis |
| `agent_actions` | action_id | planned_steps, confirmation_step, executed_steps, undo_events | Safety + audit + causality |
| `daily_task_lists` | list_id | date, generated_tasks, scores, chosen_top_tasks | Task prioritization learning |
| `task_outcomes` | task_outcome_id | task_id, completed (bool), completion_time, downstream_effect | Action → outcome learning |

### 15.2 Existing Tables (Already in System)

| Table | Location | Relevance |
|-------|----------|-----------|
| `experiment_records` | `harvestOutcomesDB` (NeDB) + Central PostgreSQL | Connect actions to outcomes |
| `device_inventory` | Discovery system | Improve device onboarding defaults |
| `applied_recipes` | `appliedRecipesDB` (NeDB) | Recipe → outcome correlation |
| `ai_decisions` | `aiDecisionsDB` (NeDB) | Human feedback on AI suggestions |

---

## 16. Minimal Dataset Size Targets

These are engineering targets. No peer-reviewed evidence was found for exact minimum counts; they depend on variance in operations.

| Model | Target | Suggested Minimum | Evidence Status |
|-------|--------|:-----------------:|-----------------|
| Harvest readiness | Predict "ready today" + confidence | 200–500 harvest cycles/crop/site | Engineering target |
| Loss predictor | Near-term loss risk | 200+ labelled loss events + environment windows | Engineering target |
| Yield model / recipe modifier | Yield response to recipe/env changes | 500+ experiment records/crop (network) | Internal readiness report |
| Quality model (vision) | Quality score / category | 1,000+ labelled images/crop/stage | Engineering target |
| Task prioritization | Rank daily tasks effectively | 500+ day-level task lists + outcomes | Engineering target |
| Operator preference | Reduce clarifying questions | 100+ sessions per operator | Engineering target |

Each model must publish: (a) training volume, (b) recency window, (c) validation metrics, (d) fallback deterministic rule set when volume is insufficient.

---

## 17. Real-Time Updates Architecture

### 17.1 Current State

The agent API uses synchronous request/response. No streaming or real-time push to client.

### 17.2 Phase 2+ SSE Architecture (If Live Tracking Required)

If live tracking or real-time updates become a Phase 2 requirement, implement SSE (Server-Sent Events) correctly per MDN EventSource API and WHATWG HTML specification:

| Feature | Purpose |
|---------|---------|
| `id:` field on every event | Enables `Last-Event-ID` on reconnect — prevents skipped status transitions |
| `retry:` field | Controls client reconnection timeout for intermittent mobile connectivity |
| Named event types | `status`, `location`, `eta`, `task-update` for clean client dispatch |
| `Last-Event-ID` header support | Server resumes from correct position on reconnect |

```javascript
// SSE endpoint (Phase 2+)
app.get('/api/farm-sales/ai-agent/events', farmAuthMiddleware, (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  const sendEvent = (type, data, id) => {
    res.write(`id: ${id}\n`);
    res.write(`event: ${type}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Subscribe to farm-scoped events
  const farmId = req.farm_id;
  eventBus.on(`farm:${farmId}:task-update`, (data) => {
    sendEvent('task-update', data, data.event_id);
  });

  req.on('close', () => {
    eventBus.removeAllListeners(`farm:${farmId}:task-update`);
  });
});
```

**Not in MVP scope.** Placeholder architecture note only. See Open Decision Point DP-3.

---

## 18. Voice Safety in Agricultural Environments

### 18.1 Environment Challenges

Agricultural environments (greenhouses, grow rooms) have:
- High ambient noise (fans, pumps, HVAC)
- Wet hands / gloves (touch interfaces unreliable)
- Specialized vocabulary not in standard speech models
- High cost of misactivation (wrong crop plan, wrong device mapping)

### 18.2 Safety Measures

| Measure | Detail |
|---------|--------|
| Wake word before commands | Require a wake phrase (e.g., "Hey Farm" or button press) before voice processing starts |
| Anti-misactivation | Voice commands that match a write action require visual confirmation (action card) before execution |
| Farm-specific vocabulary | Extend speech recognition hints with crop names, zone names, group IDs, and device names from the farm's database |
| Confidence threshold | Voice-parsed commands below 70% confidence are shown as text for visual confirmation, not executed |
| Write-action voice safety | ALL write actions triggered by voice require a confirmation tap on the action card, never voice-only confirmation |

### 18.3 Multimodal Strategy

Voice and visual work together:
- **Voice input** → Agent processes → **Visual output** (action card on screen)
- Operator confirms by **tapping** the action card (not by voice)
- This prevents misheard confirmations from triggering destructive actions

---

## 19. Regulatory and Compliance Notes

### 19.1 DPWRA (Ontario) — If Driver Operations Are Planned

If the delivery service (see `DELIVERY_SERVICE_IMPLEMENTATION_PLAN.md` v2.1.0) involves app-based delivery assignments to independent drivers in Ontario, DPWRA requirements apply. The agent must not create assignments or pay records without the compliance infrastructure described in the Delivery Service plan (RC-1).

### 19.2 CRA T4A Box 048 — If Driver Payments Exceed $500/year

If contractors are paid, ledger and reporting requirements apply per the Delivery Service plan (RC-2). The agent should not process payment actions without a compliant pay ledger.

### 19.3 Competition Act — Marketing Claims

Per the Delivery Service audit (F-1), any agent-generated content that is presented to the public (not just operators) must not contain materially false or misleading representations. The agent should not describe capabilities that don't exist.

---

## 20. Skills Matrix

Building this agent is a product + systems engineering effort, not just "add chat."

| Skill Domain | What You Need | Why It Matters |
|-------------|---------------|----------------|
| Product + UX research | Operator studies, task flows, cognitive load reduction, error-tolerant UI | Adoption depends on making complex actions simple and safe |
| Dialogue systems (mixed-initiative) | Slot filling, clarification policy, "when to ask vs act" | Effective automation requires resolving goal uncertainty |
| Multimodal disambiguation | Visual/text cue selection for ambiguous commands | Reduces ambiguity; aligns action with true intent |
| Tool-calling engineering | Typed schemas, validation, abstention policy, test harness | Tool-use fragility requires explicit abstain/clarify behavior |
| Reliability engineering | pass@k tests, fault injection, idempotency, observability | Agent reliability must be measured under paraphrases + API faults |
| Backend/API development | Stable farm + Central APIs, permissions, audit logs | Agent is only as reliable as its tools |
| Data engineering | Event sourcing, feature stores, join keys across systems | Required for "learn from outcomes" and explanations |
| ML/Stats | Calibration, confidence estimation, model monitoring | Confidence thresholds drive safe automation behavior |
| Domain agronomy + ops | Crop cycle realities, packaging/fulfillment, food safety | Prevents "technically correct but operationally wrong" suggestions |
| Voice systems (noisy environments) | Wake word, anti-misactivation, domain vocabulary adaptation | Agricultural environments need specialized protections |

---

## 21. Mandatory Test Gate

### Suite 1: Tool Abstention Tests

```
GIVEN the agent receives "Plant some stuff"
WHEN required slots (crop, group_count, cadence) are all missing
THEN the agent MUST NOT call generateWeeklyPlan()
AND the agent MUST ask for the missing parameters
AND the response includes a clarification question
```

### Suite 2: Permission Matrix Tests

```
GIVEN the permission matrix:
| Action              | auto | recommend | require-approval |
|---------------------|------|-----------|------------------|
| daily-briefing      | ✓    |           |                  |
| harvest-readiness   | ✓    |           |                  |
| start-picking       |      | ✓         |                  |
| commit-plan         |      |           | ✓                |
| bind-device         |      |           | ✓                |
THEN each action triggers the correct permission tier behavior
```

### Suite 3: Multi-Turn Consistency Tests

```
GIVEN the following 3-turn conversation:
  Turn 1: "Plant arugula"          → Agent asks: how many groups?
  Turn 2: "10"                     → Agent asks: cadence?
  Turn 3: "Weekly, start this week" → Agent shows plan preview
THEN the final plan includes crop=arugula, count=10, cadence=weekly, start=this_week
AND no intermediate state is committed
```

### Suite 4: Paraphrase Robustness Tests

```
GIVEN these 5 paraphrases of the same intent:
  "What's ready to harvest?"
  "Harvest readiness check"
  "Any crops ready to pick?"
  "What can we harvest today?"
  "Show me harvest-ready groups"
THEN all 5 produce the same structured response shape (same intent + same groups in materially consistent ranking)
AND confidence scores remain within an acceptable tolerance band rather than exact equality
```

### Suite 5: Undo/Replay Safety Tests

```
GIVEN the agent commits a production plan
WHEN the operator requests "undo last action"
THEN the plan is reverted
AND the seeding tasks are removed
AND the undo event is logged in the audit trail
AND the reverted state matches the pre-commit state exactly
```

### Suite 6: Voice Safety Tests

```
GIVEN a write action triggered by voice ("Commit the plan")
THEN the agent MUST NOT execute the write
AND the agent MUST display an action card for visual confirmation
AND only a tap on [Confirm] executes the write
```

---

## 22. Timeline and Effort

### Phase 0 — Prerequisite Remediation (BLOCKING)

| Task | Effort | Dependencies |
|------|:------:|-------------|
| Close T16 (auto-print) | ~2h | None |
| Close T19 (auto-zone assign) | ~4h | None |
| Close T6 (learning correlations viz) | ~4h | None |
| Close T21 (onboarding wizard benchmarks) | ~4h | None |
| Bridge voice → agent API | ~8h | None |
| Add daily-briefing capability | ~6h | None |
| Add explanations capability | ~4h | None |
| Persist volatile stores (P0) | ~8h | None |
| Merge/rebase to main | ~4h | Engineering coordination |
| **Phase 0 Total** | **~44h (~5.5 days)** | |

### Phase 1 — Daily Briefing + Read-Only Agent Loop

| Task | Effort | Dependencies |
|------|:------:|-------------|
| Daily to-do generation algorithm | ~12h | Phase 0 daily-briefing capability |
| Harvest readiness agent integration | ~4h | Phase 0 |
| Orders due agent integration | ~4h | Phase 0 + volatile store persistence |
| Risk alerts agent integration | ~4h | Phase 0 |
| Status briefing v1 | ~8h | Phase 0 + Central intelligence |
| Action cards UI component | ~12h | None |
| Undo pattern implementation | ~6h | None |
| Test suites 1-4 | ~8h | All Phase 1 features |
| **Phase 1 Total** | **~58h (~7.5 days)** | |

### Phase 2 — Confirmable Write Actions

| Task | Effort | Dependencies |
|------|:------:|-------------|
| Production planning commands | ~16h | Phase 1 + production-planner.js |
| Device onboarding commands | ~12h | Phase 0 T19 + Integration Assistant |
| Order fulfillment flow | ~12h | Phase 1 orders integration |
| Multimodal disambiguation UI | ~8h | Phase 1 action cards |
| Tool reliability test harness | ~8h | Phase 1 test suites |
| Wire Phase 2 agent stubs (admin, marketing) | ~16h | Central APIs |
| Test suites 5-6 | ~4h | Phase 2 features |
| **Phase 2 Total** | **~76h (~9.5 days)** | |

### Phase 3 — Learning + Autonomy

| Task | Effort | Dependencies | Timeline |
|------|:------:|-------------|----------|
| Operator preference learning | Large | 100+ sessions data | 2–3 months |
| Network intelligence surfacing | Medium | Central push operational | 1–2 months |
| Bounded autonomy (low-risk) | Large | Phase 2 complete + trust established | 3–6 months |
| Resilience evaluation | Medium | Phase 2 test harness | 2–3 months |

### Summary

| Phase | Effort | Calendar | Risk |
|-------|--------|----------|------|
| **Phase 0** | ~44h | 1–2 weeks | Low |
| **Phase 1** | ~58h | 2–3 weeks | Low–Medium |
| **Phase 2** | ~76h | 3–6 weeks | Medium |
| **Phase 3** | Large | 2–6 months | Medium–High |

---

## 23. Risk Register

| # | Risk | Severity | Mitigation |
|---|------|----------|------------|
| R-1 | Voice misactivation triggers wrong action in noisy greenhouse | **High** | Write actions require visual confirmation (§18); voice → read-only by default |
| R-2 | GPT-4o-mini latency makes voice feel sluggish (>2s) | **High** | Regex fast-path for unambiguous commands (§7.2.1); fallback to local parsing |
| R-3 | In-memory data loss corrupts daily briefing accuracy | **High** | Phase 0 volatile store persistence (§7.5) |
| R-4 | Multi-step plan commits partially and fails mid-way | **High** | Two-phase commit + idempotency keys + undo pattern (§11) |
| R-5 | Operator trusts agent too much, doesn't verify | **Medium** | Transparency rules: confidence scores, sample sizes, data sources on every recommendation (AI Vision Rule 8.4) |
| R-6 | Central push data stale or missing | **Medium** | Fallback to farm-local-only data; display "network data unavailable" when Central is unreachable |
| R-7 | Agent gives technically correct but operationally wrong advice | **Medium** | Domain agronomy skills in development; deterministic rules first (§12); human confirmation for writes |
| R-8 | 39-commit divergence from main causes merge conflicts | **Medium** | Merge to main before Phase 1 feature work (§7.6) |
| R-9 | OpenAI API unavailable or rate-limited | **Medium** | Regex fast-path handles common commands without API; graceful degradation message for complex queries |
| R-10 | Learning data insufficient for preference model | **Low** | Deterministic defaults always available; learning improves but never replaces rules |
| R-11 | Stochastic instability — same query yields different plans | **Low** | Run planner twice for high-impact actions; force clarification if results differ (§11.2) |

---

## 24. Open Decision Points

### DP-1: Voice-First or Text-First Launch?

> **Should Phase 1 launch with voice as the primary input modality, or text-first with voice as secondary?**

- If **Voice-first**: Requires T47 Activity Hub voice system upgrade + anti-misactivation testing. Adds ~1 week.
- If **Text-first**: Launch with Farm Assistant widget text input + action cards. Voice support follows as Phase 1.5. Lower risk, faster launch.
- **Recommendation**: Text-first launch with voice as Phase 1.5. Voice adds latency risk (R-2) and misactivation risk (R-1) that can be mitigated with more testing.

### DP-2: OpenAI Dependency vs Local Fallback

> **Should the agent require OpenAI API for all NL parsing, or should a local fallback be built?**

- If **OpenAI required**: Better NLU quality, multi-turn reasoning, slot extraction. But creates availability dependency (R-9).
- If **Local fallback**: Extend the existing 27+ regex patterns into a structured intent matcher. Handles 80% of commands without API call. OpenAI handles ambiguous/complex queries.
- **Recommendation**: Hybrid approach per §7.2 — regex fast-path for unambiguous commands, OpenAI for everything else. This is already the proposed architecture.

### DP-3: Live Tracking / SSE as Launch Requirement?

> **Do you want real-time task status updates (SSE) as a Phase 1 requirement?**

- If **YES**: Implement SSE with EventSource/Last-Event-ID. Adds ~3–5 days and requires event infrastructure (§17).
- If **NO**: Phase 1 uses polling (refresh action cards on 30-second interval or manual pull-to-refresh). SSE moves to Phase 2.
- **Recommendation**: NO for Phase 1. Polling with 30-second refresh is sufficient for daily briefing/task lists. SSE adds complexity without proportional value at this stage.

### DP-4: Multi-Tenant Agent Scope

> **Should the agent scope to a single farm per session, or support cross-farm queries for Central admin users?**

- If **Single farm**: Simpler, aligns with current architecture. Admin users must switch context.
- If **Cross-farm**: Admin can ask "how are all farms doing?" but this requires Central-side agent intelligence. Adds significant scope.
- **Recommendation**: Single farm for Phase 1–2. Cross-farm for Central admin in Phase 3 (aligns with AI Vision Phase 4–5 network coordination).

### DP-5: Remaining AI Vision Gaps (T6, T16, T19, T21) — Priority Order

> **Confirm the recommended priority: T16 → T19 → T6 → T21. Or should a different ordering apply?**

The recommended order prioritizes daily-frequency friction first (T16 auto-print), then device onboarding (T19), then trust/learning (T6), then adoption (T21).

---

## 25. UX Enhancement Recommendations

These recommendations come from the executive summary's UX review section and are aligned with the existing codebase.

### 25.1 Dashboard Grounding

- **User research first**: Before finalizing agent UI layouts, conduct quick interviews or remote tests with growers, admin staff, and tour guides to prioritize the most relevant metrics.
- **Simplify visualizations**: Use clear bar, line, or area charts. Avoid 3D charts. The existing confidence bars (green/yellow/red) already align with best practice.
- **Visual hierarchy**: Place high-priority information (harvest readiness, loss alerts) in the upper-left. Use F-pattern layout for scanning.

### 25.2 Customization

- Allow operators to hide unused action card categories or rearrange priority
- Collapsible sections for daily briefing tiers (Must Do / Today / Optional / Monitor)
- Saved filters (e.g., "show harvest tasks only")

### 25.3 Micro-Interactions

- Subtle progress indicator when agent is processing a command
- Animated transition when action cards change state (pending → confirmed)
- Haptic feedback on mobile when confirming write actions
- Visual pulse on new task cards added to the briefing

### 25.4 Adaptive Theming

- Dark mode toggle for greenhouse use (reduced eye strain, charts stand out)
- Use existing CSS theme variables per AI Vision Rule (no new standalone palette)

### 25.5 Data Storytelling

- When surfacing recipe modifier suggestions, include a narrative: "Network data from 47 farms shows +12% yield with Blue +2% (confidence: 0.78)"
- Experiment history highlights success stories or anomalies
- Daily briefing includes a one-sentence "today's headline" at the top

---

## 26. AWS Services Alignment

The executive summary identifies several AWS services. Here is how they map to the current and proposed architecture:

| AWS Service | Proposal Alignment | Current Status | Phase |
|-------------|-------------------|----------------|:-----:|
| **IoT Core / Greengrass** | Sensor data collection from greenhouses | Not currently used; sensors connect via local controllers + firmware | Phase 3+ (evaluate) |
| **SageMaker** | ML model training/deployment (yield, readiness, loss) | Not used; ML runs in-process (Node.js + Python scripts on EB) | Phase 3+ (evaluate if scale demands) |
| **Forecast** | Time-series forecasting (demand, harvest dates) | In-process: harvest-predictor.js, production-planner.js | Phase 3+ (evaluate) |
| **QuickSight** | BI visualization / anomaly detection | Not used; custom dashboard in HTML/JS | Phase 3+ (evaluate for Central admin) |
| **Amplify** | Web/mobile app hosting + CI/CD | Not used; EB deploys via `eb deploy --staged` | Evaluate if mobile app priority rises |
| **Lex & Polly** | Voice assistant (NLU + TTS) | Not used; Web Speech API for STT/TTS, GPT-4o-mini for NLU | Phase 2+ (evaluate if Web Speech API insufficient) |
| **Kinesis & Timestream** | Real-time streaming + time-series DB | Not used; sensor data stored in NeDB / PostgreSQL | Phase 3+ (evaluate for SSE/event infrastructure) |
| **Step Functions** | Multi-step workflow orchestration | Not used; agent handles multi-step via command pattern | Phase 3+ (evaluate for complex async workflows) |

**Recommendation**: The current architecture (Node.js/Python on EB, PostgreSQL/NeDB, OpenAI API, Web Speech API) is sufficient for Phase 0–2. AWS managed services should be evaluated for Phase 3+ if scale demands exceed what the current stack can handle. Avoid introducing new AWS dependencies before the agent is proven useful at current scale.

---

## 27. Deployment Gate

No production deployment actions until user sends exact approval:  
**"APPROVED FOR DEPLOYMENT"**

This includes `eb deploy`, `scp`, `ssh` file edits, and process restarts.

### Pre-Deployment Checklist

- [ ] Phase 0 remediation complete (all 4 AI Vision gaps closed)
- [ ] Voice → Agent API bridge operational
- [ ] Daily briefing aggregator returning valid data
- [ ] Volatile stores persisted (orders, fulfillment, reservations)
- [ ] All 6 test suites passing
- [ ] Permission matrix verified (auto/recommend/require-approval)
- [ ] Undo pattern functional for all write actions
- [ ] 39-commit divergence merged to main
- [ ] No materially misleading agent responses in test scenarios
- [ ] Agent audit log capturing all actions and decisions

---

## Appendix A: AI Vision Pre-Implementation Checklist (Required)

Per `.github/AI_VISION_RULES_AND_SKILLS.md` §12, the following checklist is completed for this proposal:

### Philosophy Alignment
- [x] Feature treats grow cycle as experiment (Rule 1.1) — Agent surfaces experiment outcomes and links to inputs
- [x] Outcomes connected to inputs (Rule 1.2) — Causality queries use experiment record lineage
- [x] Serves OBSERVE, EXPERIMENT, or LEARN mode (Rule 1.3) — OBSERVE (daily briefing), LEARN (outcome tracking)
- [x] Checked existing data sources before proposing new collection (Rule 1.4) — Uses all 14 key implementation files
- [x] Central integration path defined (Rule 1.5) — Network intelligence surfaces via existing push channel

### Architecture
- [x] Proposal includes both Farm-Side and Central-Side (Rule 2.1) — Farm agent + Central intelligence consumption
- [x] Uses existing pipes (Rule 2.2) — 30-min AI push, 5-min sync, existing agent API
- [x] Respects Central's current phase (Rule 2.3) — Central at Phase 5 (Autonomous Orchestrator)
- [x] Populates stubs before creating new endpoints (Rule 2.4) — Phase 2 wires existing stubs
- [x] Preserves Central intelligence contract (Rule 2.5) — Extends, does not replace
- [x] Prioritizes Central bottlenecks before farm-only tuning (Rule 2.6) — Network intelligence in Phase 1

### Data
- [x] Uses canonical experiment record schema (Rule 3.1) — Agent reads, does not modify
- [x] Identifies feedback loops advanced (Rule 4.1) — Daily briefing surfaces all 5 closed loops
- [x] Respects data priority levels (Rule 9.1) — P0 data captured; agent reads
- [x] Data persisted to NeDB/PostgreSQL (Rule 9.2) — Phase 0 volatile store migration

### Safety
- [x] AI suggests, grower confirms (Rule 8.1) — DP-3, DP-10; all writes require confirmation
- [x] Minimum data requirements checked (Rule 8.3) — Deterministic rules first; ML requires thresholds
- [x] Transparency requirements met (Rule 8.4) — Confidence, sample size, source on every recommendation
- [x] Recipe modifier bounds enforced (Rule 6.2) — Agent defers to recipe-modifier.js bounds
- [x] Revert-on-regression implemented (Rule 6.3) — Undo pattern + auto-revert on 2 regressions

### Privacy
- [x] Farm identity not exposed in network analytics (Rule 7.1) — Percentile rankings, not farm names
- [x] Only anonymized/aggregated data shared (Rule 7.1) — Agent surfaces network insights, not raw farm data

### Phase Gate
- [x] Correct phase identified (Rule 10.3) — Built on Phase 5 foundation (all phases complete)
- [x] Prerequisites met (Rule 10.1) — 48/52 done, 4 partial (addressed in Phase 0)
- [x] Central promotion evidence (Rule 10.4) — Central at Phase 5 operational

---

## Appendix B: File Inventory

### Existing Files Referenced by This Plan

| File | Lines | Role in Agent |
|------|:-----:|---------------|
| `services/ai-agent.js` | 1,576 | Core NL parser + action executor — extend |
| `data/agent-permissions.json` | 255 | Permission matrix — extend |
| `routes/farm-sales/ai-agent.js` | — | REST API router — extend |
| `public/views/tray-inventory.html` | 6,162 | Activity Hub + voice — bridge to agent API |
| `public/js/farm-assistant.js` | 1,357 | Floating widget — bridge to agent API |
| `routes/ai-vision.js` | 296 | QA photo analysis — wire to agent |
| `lib/harvest-readiness.js` | 393 | Readiness engine — aggregate in daily briefing |
| `lib/loss-predictor.js` | 175 | Risk profiles — aggregate in daily briefing |
| `lib/harvest-predictor.js` | — | Prediction engine — aggregate in daily briefing |
| `greenreach-central/jobs/production-planner.js` | 353 | Plan generation — wire to planning commands |
| `lib/recipe-modifier.js` | 598 | Modifier engine — surface suggestions |
| `lib/device-discovery.js` | 264 | Discovery — wire to onboarding commands |
| `lib/adaptive-control.js` | 260 | Environmental control — explain in causality |
| `lib/anomaly-diagnostics.js` | 573 | Anomaly detection — feed risk alerts |
| `test-ai-agent.js` | 129 | Test infrastructure — extend |

### New Files to Create

| File | Purpose | Phase |
|------|---------|:-----:|
| `lib/daily-briefing-generator.js` | Deterministic task aggregation + scoring | Phase 1 |
| `lib/agent-command-pattern.js` | Command pattern for undo/redo | Phase 1 |
| `public/js/components/action-cards.js` | Action card UI component | Phase 1 |
| `public/css/action-cards.css` | Action card styles (theme-compliant) | Phase 1 |
| `tests/agent-abstention.test.js` | Suite 1: Tool abstention tests | Phase 1 |
| `tests/agent-permissions.test.js` | Suite 2: Permission matrix tests | Phase 1 |
| `tests/agent-multi-turn.test.js` | Suite 3: Multi-turn consistency | Phase 1 |
| `tests/agent-paraphrase.test.js` | Suite 4: Paraphrase robustness | Phase 1 |
| `tests/agent-undo.test.js` | Suite 5: Undo/replay safety | Phase 2 |
| `tests/agent-voice-safety.test.js` | Suite 6: Voice safety | Phase 2 |

---

*End of implementation plan.*
