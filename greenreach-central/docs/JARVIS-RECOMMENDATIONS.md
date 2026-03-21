# Jarvis Goal: AI Assistant Improvement Recommendations

> **Date:** March 20, 2026  
> **Baseline:** 49 tools, GPT-4o-mini, request/response chat, 800 max tokens  
> **Vision:** Move Cheo from a "capable chat assistant" toward a "Jarvis-level" autonomous farm operations partner — one that anticipates, acts, learns, and orchestrates without being asked.

---

## Current State vs Jarvis Gap

| Capability | Current | Jarvis Target |
|-----------|---------|---------------|
| **Response mode** | Request → response (user asks, AI answers) | Proactive — AI initiates, monitors, acts |
| **Latency** | 2-4s per turn (full response after GPT completes) | Streaming tokens — first word in <300ms |
| **Context window** | 20 messages, system prompt rebuilt every 10 turns | Persistent long-term memory + summarization |
| **Tool loops** | Max 5 tool rounds per turn | Unlimited chained reasoning with planning |
| **Autonomy** | Suggests actions, waits for confirmation | Executes routine actions autonomously, asks only for policy decisions |
| **Multi-modal** | Text in, text + TTS out | Voice-first, image input (photo → diagnosis), chart rendering |
| **Proactive intelligence** | Rule-based nudges every 5 min | Event-driven real-time push via WebSocket |
| **Learning** | save_user_memory (key-value), feedback thumbs | Behavioural pattern learning, preference inference, farm model refinement |
| **Multi-step orchestration** | Single-task tools | Multi-step workflows ("set up succession planting for Q2") |
| **Monitoring** | Responds to alerts when asked | Continuous watch — auto-escalates, auto-remediates |

---

## Recommendations

### 1. Streaming Responses (Priority: High, Effort: Medium)

**Problem:** Every response blocks until GPT finishes generating. Complex answers with multiple tool calls can take 5-8 seconds with no feedback beyond "Thinking…".

**Jarvis standard:** Words appear as they're generated, like a human speaking. Tool calls show progress in real-time.

**Implementation:**
- Switch from `openai.chat.completions.create()` to `openai.chat.completions.create({ stream: true })` and use Server-Sent Events (SSE) or chunked responses to push tokens to the frontend as they arrive.
- Frontend `tryAIChat()` uses `EventSource` or `fetch` with `ReadableStream` to render tokens incrementally into the chat bubble.
- Tool calls show inline status: "📊 Pulling market data…" → "✅ Got 12 crop prices" → continues generating.
- Perceived latency drops from 3-4s to <500ms for first token.

**Why it matters:** This is the single highest-impact UX change. Jarvis doesn't make you stare at "Thinking…" — it starts talking immediately.

---

### 2. WebSocket Real-Time Push (Priority: High, Effort: Medium)

**Problem:** Nudges poll every 5 minutes via HTTP GET. Alerts require the user to ask or wait for the next poll cycle. Morning briefings only fire once per day on page load.

**Jarvis standard:** Instant notification the moment something happens — sensor spike, order received, device offline, harvest window opening.

**Implementation:**
- Add a WebSocket layer (Socket.IO or native `ws`) alongside the HTTP API.
- Backend event emitters for: sensor threshold breach, new order received, device status change, market price alert, harvest ready, dosing event, AI recommendation arrival.
- Frontend receives events and surfaces them as live chat bubbles, banner alerts, or badge counts.
- Replace the 5-minute nudge polling with push events.
- Enable the assistant to "talk first" — send a message to the chat unprompted when something requires attention.

**Why it matters:** True situational awareness. A farming Jarvis watches the farm 24/7 and calls *you* when it matters, not the other way around.

---

### 3. Autonomous Action Mode (Priority: High, Effort: Medium)

**Problem:** All 17 write tools require explicit user confirmation. This is correct for irreversible or high-impact actions, but overly cautious for routine, low-risk operations that the farmer does every day.

**Jarvis standard:** Routine actions execute autonomously within policy guardrails. Only novel or high-risk actions require approval.

**Implementation:**
- Introduce a **trust tier** system for write tools:

| Tier | Behaviour | Example Tools |
|------|-----------|---------------|
| **Auto** | Execute immediately, notify after | `dismiss_alert` (info-level), `save_user_memory` |
| **Quick-confirm** | Execute with 5-second undo window ("Done. Undo?") | `update_crop_price` (within ±10% of current), `mark_harvest_complete` (matching planting data) |
| **Confirm** | Ask before executing (current behaviour) | `create_planting_assignment`, `complete_setup`, big price changes |
| **Admin** | Require explicit typed confirmation | Bulk operations, delete operations, credential changes |

- Farm owners configure their autonomy level in Settings: Conservative (everything confirms) → Balanced (routine auto) → Autonomous (AI decides).
- The AI tracks its own accuracy over time. Tools with a track record of 100% positive feedback graduate from Confirm → Quick-confirm automatically.

**Why it matters:** Nobody asks Jarvis "are you sure?" when he dims the lights. High-confidence routine actions should flow, not block.

---

### 4. Multi-Step Workflow Orchestration (Priority: High, Effort: Large)

**Problem:** The system prompt has instructions for multi-step workflows (planting schedule, device registration, pricing update), but they rely on GPT remembering to chain 4-5 tool calls correctly. The 5-tool-loop ceiling and 800 max_tokens cap limit complex orchestrations.

**Jarvis standard:** "Prepare the farm for next quarter" triggers a complete orchestrated workflow: analyse current state → forecast demand → identify gaps → propose planting plan → review pricing → schedule succession → update targets.

**Implementation:**
- Create a **Workflow Engine** — named sequences of tool calls with branching logic:
  ```
  workflow: quarterly_planning
  steps:
    1. get_planting_assignments (current state)
    2. get_scheduled_harvests (upcoming)
    3. get_capacity (available space)
    4. get_market_intelligence (demand signals)
    5. create_planting_plan (generate)
    6. PAUSE → present plan to user
    7. ON CONFIRM → execute assignments
    8. update_target_ranges (optimize environment for new crops)
  ```
- Raise `MAX_TOOL_LOOPS` from 5 to 15 and `max_tokens` from 800 to 2000 for orchestration turns.
- Add a `get_workflow_status` tool so the AI can report progress on multi-step operations.
- Workflows persist across turns — "continue where we left off" if the user closes the chat.

**Why it matters:** The gap between "I can call one tool at a time" and "I can run the farm" is workflow orchestration. This is the leap from assistant to operator.

---

### 5. Persistent Intelligent Memory (Priority: Medium, Effort: Medium)

**Problem:** User memory is flat key-value (`user_name: "Bob"`, `preferred_units: "metric"`). Conversation history is 20 messages with 30-min TTL (or 24h from DB). No long-term learning about farm patterns, seasonal cycles, or operational preferences.

**Jarvis standard:** Remembers everything relevant — last season's yield, which crops failed, the farmer's weekly routine, buyer preferences, equipment quirks. Uses this context to give increasingly personalized advice.

**Implementation:**
- **Conversation summarization:** At TTL expiry, GPT summarizes the conversation into a structured note stored per-farm. Load recent summaries (last 10) into the system prompt as compressed context.
- **Farm knowledge graph:** Beyond key-value memory, maintain a structured farm model:
  ```json
  {
    "seasonal_patterns": { "spring": ["basil ramp-up", "lettuce peak"], "winter": ["reduced orders"] },
    "buyer_profiles": { "Fresh Roots": { "frequency": "weekly", "prefers": ["romaine", "basil"], "volume": "medium" } },
    "equipment_notes": { "zone-1-dehumidifier": "runs loud, needs filter replacement March" },
    "crop_performance": { "Genovese Basil": { "avg_yield": "0.7 lbs/tray", "common_issues": ["tip burn at high EC"] } }
  }
  ```
- **Auto-capture:** After each conversation, extract and persist farming insights without user prompting. "The farmer mentioned their wholesaler wants more kale" → auto-saves to buyer profile.
- **Conversation resumption:** When a user returns after hours/days, the AI opens with context: "Welcome back. Last time we were working on your Q2 planting schedule — ready to continue, or is there something more urgent?"

**Why it matters:** Jarvis knows you. The more data it accumulates about *your* farm, the more its advice converges toward what *you* need, not generic guidance.

---

### 6. Image Input for Crop Diagnosis (Priority: Medium, Effort: Medium)

**Problem:** No visual input. If a farmer sees leaf yellowing, tipburn, or pest damage, they must describe it in text. The AI has no way to see what they see.

**Jarvis standard:** "Hey Jarvis, what's wrong with this plant?" [snaps photo] → instant diagnosis with recommended action.

**Implementation:**
- Add image upload to the chat widget (camera button + drag-and-drop).
- Send images to GPT-4o (vision-capable) alongside the text message.
- Build a diagnostic prompt: "You are a plant pathologist specializing in indoor CEA crops. Analyze this image and identify: species, growth stage, visible issues (nutrient deficiency, pest damage, disease, environmental stress), severity, and recommended corrective action."
- Cross-reference diagnosis with the farm's current environment data — if the AI detects calcium deficiency, check the nutrient dashboard to confirm low Ca levels.
- Store diagnostic history per zone/crop for pattern detection.

**Cost note:** GPT-4o vision is ~$0.01 per image. At 5 photos/day = ~$1.50/month — negligible.

**Why it matters:** Farmers are visual. The fastest path to correct diagnosis is showing, not describing. This removes the translation layer between what the farmer sees and what the AI knows.

---

### 7. Voice-First Interaction Mode (Priority: Medium, Effort: Medium)

**Problem:** Voice input exists (SpeechRecognition → text → GPT) and TTS output exists (OpenAI TTS), but the experience is transactional — press button, speak, wait, hear response. Not conversational.

**Jarvis standard:** Continuous hands-free conversation while working in the grow room. "Hey Cheo" wake word → back-and-forth dialogue → auto-pause when farmer walks away.

**Implementation:**
- **Wake word detection:** Client-side wake word ("Hey Cheo") using a lightweight ML model (Porcupine or Picovoice — runs in-browser, ~50KB).
- **Continuous listening mode:** After wake word, mic stays active until 3 seconds of silence. No need to press the button for each utterance.
- **Streaming TTS:** Instead of waiting for the full response then speaking, stream audio chunks as GPT generates tokens. First word spoken within 1 second of query.
- **Interruption handling:** If the farmer speaks while TTS is playing, stop playback and process the new input immediately.
- **Smart audio routing:** Detect if using earbuds vs speaker. Adjust volume and verbosity (earbuds = more detail, speaker = concise).
- **Ambient mode:** Optional always-on display showing key metrics (temp, humidity, alerts) with voice-activated overlay for the chat.

**Why it matters:** In a grow room, your hands are wet, gloved, or full. Voice-first removes the phone/keyboard bottleneck.

---

### 8. Predictive Alerting and Auto-Remediation (Priority: Medium, Effort: Large)

**Problem:** Alerts are reactive — sensors must cross thresholds before an alert fires. The AI recommends actions but doesn't execute preventive measures.

**Jarvis standard:** Predicts issues before they happen and takes preventive action. "Zone 2 humidity trending toward 80% — I've increased the dehumidifier fan speed and will monitor for the next 30 minutes."

**Implementation:**
- **Trend analysis engine:** Continuously monitor sensor time-series. Detect trajectories that will breach thresholds within 30/60/120 minutes if uncorrected.
- **Predictive models:** Use the ML insights data already being generated (`ml-insights/forecast-*.json`, `anomalies-*.json`) to feed the AI's decision-making.
- **Auto-remediation actions** (graduated):
  1. **Predict:** "Humidity in Zone 2 will reach 80% in ~45 min based on current rate"
  2. **Suggest:** "Recommend increasing dehumidifier output"
  3. **Auto-act (if authorized):** Send command to SwitchBot/device controller to adjust
  4. **Monitor:** Check in 15 min, log outcome, learn from results
- **Digital twin / farm simulation:** Model the farm environment as a dynamic system. Use crop growth stage + occupancy + weather data to predict environment drift and pre-position controls.

**Why it matters:** The difference between a reactive assistant and a Jarvis is prediction. Preventing a humidity spike is worth more than detecting it after the crop is stressed.

---

### 9. Natural Language Reports and Insights Digest (Priority: Medium, Effort: Small)

**Problem:** The AI can query individual data points (get_market_intelligence, get_yield_forecast, get_cost_analysis), but there's no tool to synthesize a cross-domain narrative report: "How did we do this week?"

**Jarvis standard:** Weekly/monthly narrative report synthesizing operations, financials, market conditions, crop performance, and recommendations — all in natural language, delivered to email or chat.

**Implementation:**
- Add a `generate_report` tool that:
  1. Calls 6-8 read tools internally (todo, orders, harvest, yield, pricing, alerts, environment, nutrients)
  2. Passes the combined data to GPT with a report template
  3. Returns a structured narrative: Executive Summary → Operations → Financials → Market → Recommendations
- Schedule auto-generation: weekly digest every Monday 8 AM, monthly summary on the 1st.
- Deliver via: chat (on-demand), email (scheduled), PDF export (click to download).
- Historical comparisons: "Yield was up 12% vs last month. Basil retail pricing outperformed market by 8%."

**Why it matters:** Farm owners don't always have time to ask 10 questions. A synthesized briefing that says "here's what happened and what to do next" is the Jarvis value proposition.

---

### 10. Multi-Farm Fleet Intelligence (Priority: Low, Effort: Large)

**Problem:** Cheo currently operates within a single farm context. The system prompt injects one farm's data. There's no cross-farm comparison, network-level insights, or fleet management.

**Jarvis standard:** "How do my three farms compare this month?" "Which farm is most efficient?" "Transfer the basil schedule from Farm A to Farm B."

**Implementation:**
- Add farm-switching capability — the AI can query tools for any farm the user has access to.
- Cross-farm comparison tools: `compare_farms`, `get_network_overview`, `get_best_practices` (what's working at the top-performing farm).
- Fleet-level alerts: "Farm B's humidity has been trending high for 3 days — Farm A had the same issue last month and resolved it by adjusting ventilation timing."
- Template sharing: planting schedules, environment targets, and pricing strategies that can be copied between farms.

**Why it matters:** As GreenReach scales, the AI's value multiplies with each farm. Network intelligence — learning from the fleet — is the ultimate competitive moat.

---

## Implementation Roadmap

### Phase 7: Immediacy (Next Sprint)
| # | Recommendation | Impact | Effort |
|---|---------------|--------|--------|
| 1 | Streaming responses | Perceived speed 5× faster | Medium |
| 2 | WebSocket push | Real-time aware | Medium |
| 3 | Autonomous action tiers | Removes friction for routine ops | Medium |

### Phase 8: Intelligence (Following Sprint)
| # | Recommendation | Impact | Effort |
|---|---------------|--------|--------|
| 4 | Workflow orchestration | AI can run multi-step operations | Large |
| 5 | Persistent intelligent memory | Increasingly personalized advice | Medium |
| 9 | NL reports and digests | Synthesized insights without asking | Small |

### Phase 9: Senses (Future)
| # | Recommendation | Impact | Effort |
|---|---------------|--------|--------|
| 6 | Image input for diagnosis | Visual → actionable in seconds | Medium |
| 7 | Voice-first mode | Hands-free in grow room | Medium |
| 8 | Predictive alerting + auto-remediation | Prevent issues, not just detect | Large |
| 10 | Multi-farm fleet intelligence | Scale-multiplied value | Large |

---

## Cost Impact Estimate

| Recommendation | Monthly Cost Delta |
|----------------|-------------------|
| Streaming responses | $0 (same tokens, different delivery) |
| WebSocket push | $0 (no LLM, event-driven) |
| Autonomous actions | $0 (same tools, less round-trips) |
| Workflow orchestration | +$2-5 (more tokens per complex turn) |
| Persistent memory | +$1-2 (summarization calls) |
| Image diagnosis | +$1-3 (GPT-4o vision, ~5 images/day) |
| Voice-first mode | +$0 (existing TTS, minimal extra) |
| Predictive alerting | +$0 (rule-based, no LLM) |
| NL reports | +$2-4 (weekly/monthly synthesis) |
| Multi-farm | +$3-8 (scaled by farm count) |
| **Total** | **+$9-22/month** (from current ~$23) |

Jarvis-level upgrade at ~$45/month total. The cost is trivial relative to the operational value.

---

## Key Config Changes Needed Now

These quick wins require no new features — just tuning existing code:

1. **Raise `max_tokens` from 800 → 1500** — complex planting plans and reports are regularly truncated.
2. **Raise `MAX_TOOL_LOOPS` from 5 → 10** — quarterly planning needs 7-8 tool calls.
3. **Rebuild system prompt every 5 turns, not 10** — stale context causes zone hallucination.
4. **Add `temperature: 0.4` for tool-calling turns** (lower = more deterministic tool selection), `0.7` for conversational turns.
5. **Increase `MAX_HISTORY` from 20 → 40 messages** — complex planning workflows run out of context.
