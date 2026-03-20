# AI Assistant Upgrade Roadmap

> **Status:** Approved for implementation  
> **Date:** March 19, 2026  
> **Goal:** Transform the Farm Assistant from a pattern-matching FAQ widget into an intelligent, action-capable AI assistant that can query data, execute commands, and manage farm operations through natural conversation.

---

## Current State Assessment

### What Exists Today

| Component | Technology | Capability | Limitation |
|-----------|------------|-----------|------------|
| **Farm Assistant (Cheo)** | Client-side JS, regex patterns | 7 canned queries (harvest, temp, nav, setup, alerts, crop lookup, hardware blink) | No LLM — all responses are hardcoded templates. Can't answer anything outside ~20 regex patterns. Falls back to "I'm not sure" for everything else. |
| **Farm Ops Agent** | Server-side Express routes | Daily todo, tool gateway (dismiss alerts, auto-assign devices, seed benchmarks), NLP command parser, undo, audit log | **Not connected to farm-assistant.js at all.** Parse-command uses regex + fuzzy match, not GPT. Tool gateway has write capabilities but no UI invokes them. |
| **AI Pricing Assistant** | Frontend modal + backend API | Market analysis, pricing recommendations, decision recording | Separate modal — not part of the assistant chat. User must click a specific button. |
| **TTS (Text-to-Speech)** | OpenAI `tts-1-hd` | Audio playback of assistant responses | Works well but speaks responses to pattern-matched answers — limited value. |
| **Voice Input** | Browser SpeechRecognition | Microphone → text transcription | Feeds into the same pattern matcher — same limitations apply. |
| **AI Recommender Pusher** | GPT-4 on 30-min cron | Farm-specific operational recommendations pushed to edge servers | Backend only. Users never see these recommendations in Central. |
| **Market Analysis Agent** | GPT-4o-mini daily | Per-crop market outlook (bullish/bearish/stable) | Backend only. Data available via API but not surfaced in assistant chat. |
| **AI Insights** | GPT-4o-mini on-demand | Per-farm environmental recommendations with recipe targets | Endpoint exists (`/api/ai-insights/:farmId`) but not called from assistant. |

### Core Problem

The Farm Assistant is a **client-side pattern matcher** — it runs a fixed chain of regex/keyword checks and returns hardcoded HTML templates. It never calls an LLM. The backend has a sophisticated tool gateway (farm-ops-agent) with 7 tools, command parsing, undo capability, and audit logging — but the frontend doesn't use any of it.

**Result:** The assistant feels like a FAQ page, not an AI.

### Architectural Disconnect

```
CURRENT FLOW (broken):
  User types "How are my orders doing?" 
  → farm-assistant.js regex chain 
  → no match 
  → "I'm not sure how to help with that"

AVAILABLE BUT UNWIRED:
  /api/farm-ops/parse-command { text: "How are my orders doing?" }
  → intent: order_status, tool: get_orders, confidence: 0.85
  → /api/farm-ops/tool-gateway { tool: "get_orders" }
  → { ok: true, count: 5, orders: [...] }
```

---

## Implementation Roadmap

### Phase 1: Wire the Brain to the Mouth (Priority: Critical)

**Goal:** Connect the Farm Assistant frontend to the Farm Ops Agent backend so every user query goes through the server-side intelligence layer instead of client-side regex.

#### 1A. Add GPT Conversational Endpoint

Create `POST /api/assistant/chat` — a single endpoint that:
1. Accepts `{ message, conversation_id?, farm_id }` 
2. Builds a system prompt with farm context (current conditions, active alerts, pending orders, crop status)
3. Includes the **tool catalog** from farm-ops-agent as function definitions
4. Calls GPT-4o-mini with function calling enabled
5. If GPT wants to call a tool → executes via tool-gateway internally → returns result in conversation
6. Returns `{ reply, actions[], data?, conversation_id }`
7. Tracks via `trackAiUsage()`

**Files to create/modify:**
- Create: `routes/assistant-chat.js` — new chat endpoint with OpenAI function calling
- Modify: `server.js` — mount at `/api/assistant/chat`
- Modify: `public/js/farm-assistant.js` — replace `processQuery()` chain with API call

**System Prompt Context (injected per-request):**
```
You are Cheo, the GreenReach Farm Assistant. You help farmers manage their
indoor growing operations. You have access to real-time farm data and can
execute actions on behalf of the user.

CURRENT FARM STATE:
- Farm: {farm_name} ({farm_id})
- Active zones: {zone_count}
- Conditions: {avg_temp}°C, {avg_humidity}% RH
- Pending orders: {order_count}
- Active alerts: {alert_count}
- Crops growing: {crop_list}

RULES:
- Be concise (2-3 sentences max unless user asks for detail)
- When you execute an action, confirm what you did
- If unsure, say so — don't guess
- Canadian English (colour, favourite, centre)
- Never fabricate data — only report what the tools return
```

**Function Definitions for GPT:**
```json
[
  { "name": "get_daily_todo", "description": "Get today's prioritized task list", "parameters": { "category": "optional filter" } },
  { "name": "get_room_status", "description": "Get environment and crop status for a room", "parameters": { "room_id": "required" } },
  { "name": "get_orders", "description": "Get wholesale orders", "parameters": { "status": "optional", "limit": "optional" } },
  { "name": "get_harvest_log", "description": "Get recent harvest records", "parameters": { "crop": "optional", "limit": "optional" } },
  { "name": "get_alerts", "description": "Get active system alerts", "parameters": { "severity": "optional" } },
  { "name": "dismiss_alert", "description": "Dismiss an alert by ID", "parameters": { "alert_id": "required", "reason": "optional" } },
  { "name": "get_market_intelligence", "description": "Get market prices and AI analysis for crops", "parameters": { "crop": "optional" } },
  { "name": "get_pricing_recommendations", "description": "Get AI pricing recommendations", "parameters": {} },
  { "name": "update_crop_price", "description": "Update retail/wholesale price for a crop", "parameters": { "crop": "required", "retail_price": "optional", "ws1_discount": "optional" } },
  { "name": "get_planting_recommendations", "description": "Get smart planting recommendations", "parameters": {} },
  { "name": "get_demand_forecast", "description": "Get demand forecast for crops", "parameters": {} },
  { "name": "get_farm_insights", "description": "Get AI environmental insights and recipe targets", "parameters": {} }
]
```

**Cost estimate:** ~$0.002 per conversation turn (GPT-4o-mini, ~500 tokens avg)

#### 1B. Replace Client-Side Pattern Matching

Refactor `processQuery()` in `farm-assistant.js`:

```
BEFORE: processQuery() → matchSetupQuery() → matchHarvestQuery() → ... → fallback

AFTER:  processQuery() → POST /api/assistant/chat → display response + execute actions
        ↓ (offline fallback)
        → existing regex chain (graceful degradation if API unreachable)
```

Keep the existing pattern-matching chain as an **offline fallback** — if the API call fails (network down, API key missing), fall through to the current regex handlers. This ensures the assistant never fully breaks.

#### 1C. Conversation Memory (Session-Scoped)

Store conversation history server-side (in-memory with 30-min TTL, keyed by `conversation_id`). Pass last 10 messages as context to GPT so the assistant understands follow-up questions:

```
User: "Any alerts?"
AI: "You have 2 active alerts: High humidity in Zone A, sensor offline in Zone B."
User: "Dismiss the humidity one"
AI: [calls dismiss_alert with the correct alert_id] "Done — dismissed the high humidity alert for Zone A."
```

---

### Phase 2: Expand the Tool Catalog (Priority: High)

**Goal:** Give the assistant access to more farm operations so users can do real work through conversation.

#### 2A. New Read Tools

Add to `TOOL_CATALOG` in `farm-ops-agent.js`:

| Tool | Description | Data Source |
|------|-------------|-------------|
| `get_market_prices` | Current market prices + trends for all or specific crops | `market_price_trends` table |
| `get_ai_analysis` | Latest AI market outlook (bullish/bearish) | `market_ai_analysis` table |
| `get_pricing_decisions` | Recent pricing decisions and their outcomes | `pricing_decisions` table |
| `get_capacity` | Current farm capacity utilization | `/api/planning/capacity` |
| `get_demand_forecast` | AI-enriched demand forecast | `/api/planning/demand-forecast` |
| `get_planting_recommendations` | Smart planting recommendations with scoring | `/api/planning/recommendations` |
| `get_inventory_summary` | Current crop inventory counts and statuses | `crop-inventory.json` / DB |
| `get_wholesale_orders` | Wholesale order pipeline with fulfillment status | `wholesale-orders-status.json` |
| `get_farm_insights` | AI environmental recommendations | `/api/ai-insights/:farmId` |
| `get_crop_info` | Detailed crop registry info (growth params, pricing) | `crop-registry.json` |

#### 2B. New Write Tools

| Tool | Description | Confirmation Required | Undoable |
|------|-------------|----------------------|----------|
| `update_crop_price` | Set retail/wholesale price for a crop | Yes (GPT confirms before executing) | Yes |
| `create_planting_assignment` | Schedule a new planting | Yes | Yes |
| `mark_harvest_complete` | Record a harvest with yield data | Yes | No |
| `update_order_status` | Change wholesale order status (confirm → packed → shipped) | Yes | Yes |
| `set_environment_target` | Adjust target temp/humidity/light for a zone | Yes | Yes |
| `add_inventory_item` | Add a new crop to inventory | Yes | Yes |
| `trigger_light_identify` | Blink lights for a zone/group | No | N/A |
| `generate_report` | Generate a summary report (daily, weekly, harvest) | No | N/A |

#### 2C. Confirmation Flow for Write Operations

When GPT decides to call a write tool, the assistant should:
1. Show the proposed action in the chat: "I'll update Basil retail price to $4.50/unit. Confirm?"
2. Render **Confirm** / **Cancel** buttons
3. On Confirm → execute via tool-gateway → show result
4. On Cancel → "Cancelled. No changes made."

This prevents accidental mutations from ambiguous commands.

---

### Phase 3: Data Input & Quick Entry (Priority: High)

**Goal:** Let users input data through the assistant instead of navigating to specific pages.

#### 3A. Harvest Recording via Chat

```
User: "I just harvested 12 trays of basil from Zone A"
AI: "Recording harvest: 12 trays of Basil from Zone A. Estimated yield: 8.4 lbs. Confirm?"
User: "Yes"
AI: "Harvest recorded. Updated inventory: Basil now at 42 units available."
```

**Implementation:** New `record_harvest` tool that writes to `harvest-log.json` and updates inventory counts. GPT extracts crop, quantity, zone from natural language.

#### 3B. Order Fulfillment via Chat

```
User: "Pack the order for Fresh Roots"
AI: "Order #WO-2026-0047 for Fresh Roots Café: 5 × Romaine, 3 × Basil, 2 × Kale. Mark as packed?"
User: "Yes"
AI: "Done. Order marked as packed. Reminder: delivery is scheduled for tomorrow at 9 AM."
```

#### 3C. Price Updates via Chat

```
User: "Set basil retail to $4.50 and wholesale to $3.25"
AI: "Updating Genovese Basil: Retail $4.50, WS1 $3.25 (28% margin). Previous: $4.00, $3.00. Confirm?"
User: "Yes"  
AI: "Prices updated. Applied to online store and POS."
```

#### 3D. Quick Data Entry Forms in Chat

For structured data entry, the assistant can render inline forms within the chat:

```
User: "Add a new crop"
AI: [renders inline form]
  ┌──────────────────────────┐
  │ Crop Name: [_________]   │
  │ Category: [Lettuce ▾]    │  
  │ Zone: [Zone A ▾]         │
  │ Trays: [__]              │
  │ [Add Crop] [Cancel]      │
  └──────────────────────────┘
```

**Implementation:** Assistant returns structured `actions` with `type: "form"` — the frontend renders an inline form widget. On submit, the form data is sent back through the chat endpoint.

---

### Phase 4: Proactive Intelligence (Priority: Medium)

**Goal:** The assistant surfaces information before the user asks.

#### 4A. Morning Briefing

When the user opens the dashboard (first visit of the day), the assistant auto-expands with a morning briefing:

```
AI: "Good morning! Here's your daily briefing:
  📋 5 tasks today (2 high priority)
  🌡️ All zones within range (21-24°C)
  📦 3 orders due for delivery today
  💰 Basil prices up 8% — consider updating your retail price
  ⚠️ 1 alert: CO2 sensor in Zone B reading low
  
  Say 'show tasks' for the full list, or ask me anything."
```

**Implementation:** 
- Modify `checkProactiveGreeting()` → call `POST /api/assistant/chat` with system message `"Generate morning briefing"` 
- Briefing function calls multiple tools internally: `get_daily_todo`, `get_alerts`, `get_market_prices`, `get_orders`
- Cache briefing for 4 hours (don't re-generate on every page load)

#### 4B. Contextual Nudges

When specific conditions are detected, the assistant nudges:

| Trigger | Nudge |
|---------|-------|
| Market price increase > 10% | "Basil market prices are up 12% this week. Want me to update your pricing?" |
| Order due within 4 hours | "Order for Terra Greens is due at 2 PM. 3 of 5 items packed. Want to see details?" |
| Crop ready to harvest (harvestIn ≤ 0) | "Romaine in Zone A is ready to harvest (Day 32/28). Want me to log a harvest?" |
| Environment out of range for > 30 min | "Zone B humidity has been at 78% for 45 minutes (target: 65%). Check the HVAC?" |
| AI Pusher recommendation received | "Network intelligence update: Consider increasing kale production — demand is up across the network." |

**Implementation:** Background polling job (every 5 min) checks conditions → queues nudges → assistant displays them on next interaction or page load.

#### 4C. Wire AI Pusher Recommendations into Assistant

Currently, AI Pusher sends recommendations to farm edge servers but Central's UI never shows them. Add:
- New `get_ai_recommendations` tool that reads the latest pushed recommendations from DB
- Display in morning briefing and on demand: "Show me AI recommendations"

---

### Phase 5: Multi-Modal Interaction (Priority: Medium)

**Goal:** Enhance voice and visual capabilities.

#### 5A. Voice Command → Action Pipeline

Complete the voice loop:
```
User speaks: "Harvest 10 trays of basil from zone A"
  → SpeechRecognition transcribes
  → POST /api/assistant/chat
  → GPT calls record_harvest tool
  → Returns confirmation text
  → TTS speaks: "Recorded 10 trays of basil. Inventory updated."
```

Currently voice input feeds into client-side regex. After Phase 1, it automatically feeds into GPT.

#### 5B. TTS Voice Selection

Add a settings option for TTS voice (currently hardcoded to 'echo'):
- Show voice selector in assistant settings: alloy, ash, ballad, coral, echo, nova, onyx, sage, shimmer
- Save preference to localStorage + user profile
- Play sample on selection

#### 5C. Rich Response Cards

Extend assistant responses beyond text to include:
- **Chart cards** — inline sparkline for price trends, temperature history
- **Table cards** — order lists, inventory counts, task lists
- **Map cards** — zone heatmap thumbnail with link to full view
- **Action cards** — grouped buttons for common next steps

---

### Phase 6: Learning & Personalization (Priority: Low)

#### 6A. Usage Pattern Learning

Track which tools users invoke most → surface those actions prominently. If a user checks orders every morning, auto-include order summary in briefing.

#### 6B. Farm-Specific Context Window

Build a persistent context document per farm that GPT receives as background:
- Farm type (leafy greens, herbs, mixed)
- Typical crops grown
- Number of zones
- Usual order patterns
- Known issues / preferences

This avoids the assistant asking basic questions every time.

#### 6C. Feedback Loop

After assistant actions, show thumbs up/down. Log feedback with the action to fine-tune system prompts and tool selection over time.

---

## Implementation Priority Matrix

| Phase | Effort | Impact | Priority |
|-------|--------|--------|----------|
| **1A** GPT Chat Endpoint | Medium (new route + OpenAI function calling) | **Critical** — unlocks everything | **P0** |
| **1B** Replace client-side regex | Small (refactor processQuery) | **Critical** — makes AI feel real | **P0** |
| **1C** Conversation memory | Small (in-memory store) | High — enables follow-ups | **P0** |
| **2A** New read tools | Medium (10 tools) | High — expands what assistant knows | **P1** |
| **2B** New write tools | Medium (8 tools) | **High** — enables real actions | **P1** |
| **2C** Confirmation flow | Small (UI buttons) | High — safety for write ops | **P1** |
| **3A-D** Data input via chat | Medium (harvest, orders, pricing, forms) | **High** — biggest UX improvement | **P1** |
| **4A** Morning briefing | Small (compose from existing tools) | Medium — daily value | **P2** |
| **4B** Contextual nudges | Medium (background polling) | Medium — proactive value | **P2** |
| **4C** Wire AI Pusher recs | Small (new tool + display) | Medium — surfaces hidden data | **P2** |
| **5A** Voice → Action | Free (automatic after Phase 1) | Medium — hands-free ops | **P2** |
| **5B** TTS Voice selection | Small | Low — cosmetic | **P3** |
| **5C** Rich response cards | Medium (HTML components) | Medium — visual polish | **P3** |
| **6A-C** Learning & feedback | Medium | Low — optimization | **P3** |

---

## Cost Projections

| Feature | Model | Est. Monthly Cost |
|---------|-------|-------------------|
| Assistant chat (50 queries/day avg) | GPT-4o-mini | ~$3.00 |
| Morning briefings (1/day × 30 farms) | GPT-4o-mini | ~$0.50 |
| Contextual nudges | No LLM (rule-based triggers) | $0.00 |
| Function calling overhead | included in chat | $0.00 |
| TTS (existing) | tts-1-hd | ~$15.00 |
| Market analysis (existing) | GPT-4o-mini | ~$2.50 |
| AI Pusher (existing) | GPT-4o-mini | ~$2.50 |
| **Total** | | **~$23.50/month** |

Incremental cost over current ($20/month): **~$3.50/month** — the chat endpoint is very cheap with GPT-4o-mini.

---

## Technical Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    FRONTEND                              │
│                                                          │
│  farm-assistant.js (Cheo widget)                        │
│    ├── Text input + Voice input (SpeechRecognition)     │
│    ├── POST /api/assistant/chat ──────────────────┐     │
│    ├── Display text + action buttons + inline forms│     │
│    └── TTS playback (OpenAI tts-1-hd)             │     │
│                                                    │     │
└────────────────────────────────────────────────────│─────┘
                                                     │
┌────────────────────────────────────────────────────│─────┐
│                    BACKEND                          │     │
│                                                     ▼     │
│  routes/assistant-chat.js (NEW)                          │
│    ├── Build context (farm state, alerts, orders)        │
│    ├── Maintain conversation memory (30-min TTL)         │
│    ├── Call GPT-4o-mini with function calling            │
│    ├── Execute tool calls via farm-ops-agent gateway     │
│    └── Return { reply, actions[], data }                 │
│                                                          │
│  routes/farm-ops-agent.js (EXPANDED)                     │
│    ├── TOOL_CATALOG: 7 existing + 18 new tools          │
│    ├── Tool gateway with validation + audit              │
│    ├── Undo support for write operations                 │
│    └── Idempotency cache                                 │
│                                                          │
│  EXISTING AI ENGINES (unchanged):                        │
│    ├── market-analysis-agent.js (daily)                  │
│    ├── ai-recommendations-pusher.js (30 min)             │
│    ├── market-data-fetcher.js (daily USDA + BOC FX)     │
│    └── ai-insights.js (on-demand)                        │
│                                                          │
│  DATA LAYER:                                             │
│    ├── PostgreSQL (market_*, farms, ai_usage, orders)    │
│    ├── JSON files (rooms, env, devices, harvest-log)     │
│    └── farmStore (per-farm key-value)                    │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

---

## Migration Strategy

The frontend refactor is **backward compatible**:
1. `processQuery()` first tries the API — if it succeeds, display the GPT response
2. If the API call fails (timeout, 503, no API key), fall through to the existing regex handlers
3. Existing TTS, voice input, and UI chrome remain unchanged
4. Conversation history format extends (adds `conversation_id`, `tool_calls`) but old history still renders

**No breaking changes to any existing page or endpoint.**

---

## Success Metrics

| Metric | Current | Target (30 days) | Target (90 days) |
|--------|---------|-------------------|-------------------|
| Queries answered (not "I'm not sure") | ~35% (7 patterns) | 85%+ | 95%+ |
| User actions completed via chat | 0 | 5+ per farm/day | 15+ per farm/day |
| Average response time | <100ms (client) | <2s (GPT) | <1.5s (optimized prompts) |
| Daily active assistant users | Unknown | Track baseline | 2× baseline |
| Write operations via assistant | 0 | 10% of total writes | 30% of total writes |
| Morning briefing engagement | 0 (doesn't exist) | 50% open rate | 70% open rate |

---

## Immediate Next Steps

1. **Build Phase 1A** — `routes/assistant-chat.js` with GPT function calling + 12 tool definitions
2. **Build Phase 1B** — Refactor `processQuery()` → API call with regex fallback
3. **Build Phase 1C** — In-memory conversation store
4. **Test** — Verify all 7 example queries work through GPT + at least 20 new free-form queries
5. **Deploy** — Ship Phase 1, gather usage data, iterate on tools
