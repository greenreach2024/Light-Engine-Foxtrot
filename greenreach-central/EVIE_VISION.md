# E.V.I.E. Vision Document
## Environmental Vision & Intelligence Engine

**Version**: 1.0 | **Date**: 2026-03-21 | **Status**: Phase 1 Implementation

---

## One-Sentence Positioning

E.V.I.E. is the visible intelligence layer embedded within a single farm, helping growers and visitors understand, navigate, and interact with that farm in real time.

---

## Boundary Separation

| Attribute       | E.V.I.E.                          | F.A.Y.E.                              |
|-----------------|-----------------------------------|---------------------------------------|
| Scope           | One farm                          | All farms in the network              |
| Audience        | Growers, visitors, demo viewers   | Platform admins, operators            |
| Personality     | Warm, calm, explanatory           | Strategic, analytical, decisive       |
| Actions         | Farm tasks, crop guidance         | Network operations, policy, autonomy  |
| Visual Identity | Organic glow, living presence     | Geometric orb, command intelligence   |
| Escalation      | Escalates to F.A.Y.E. / admin    | Receives escalations, delegates down  |

**The rule**: E.V.I.E. is the face of one farm. F.A.Y.E. is the intelligence across many farms.

---

## Tone of Voice

- Calm and composed, never noisy or theatrical
- Explanatory: translates data into plain language
- Warm but professional: approachable without being gimmicky
- Proactive: surfaces observations without being asked
- Honest about uncertainty: says "I'm not sure" when confidence is low

---

## User Modes

### Mode A: Ambient Presence
Default idle state. E.V.I.E. is always there, not hidden behind a button.
Shows gentle visual state tied to farm health. Reacts to attention.

### Mode B: Grower Support
For daily farm operations. Practical, task-aware, crop-aware, concise.
Surfaces next tasks, environment drift, harvest timing, nutrient issues.

### Mode C: Public Demo
For investors, partners, hospitals, schools, public visitors.
More welcoming, more explanatory, less technical, more storytelling.
Shows the farm as advanced infrastructure, not just hardware.

### Mode D: Guided Tour
For partners, buyers, investors visiting the farm via screen.
Explains system features, highlights differentiation, walks through
the seed-to-table pipeline and software + hardware integration.

### Mode E: Escalation
When confidence is low or action exceeds E.V.I.E.'s authority,
seamlessly escalates to F.A.Y.E. or admin with full context passed through.

---

## Visual Identity Direction

### Color Language
- Primary: #10b981 (confident green -- farm vitality)
- Secondary: #06b6d4 (cyan -- awareness, sensing)
- Accent: #8b5cf6 (violet -- thinking, intelligence)
- Alert: #f59e0b (amber -- attention needed)
- Critical: #ef4444 (red -- urgent)
- Background: organic dark gradients, not the sharp geometric deep-navy of F.A.Y.E.

### Visual States
| State       | Meaning                           | Visual                              |
|-------------|-----------------------------------|-------------------------------------|
| idle        | Monitoring, all normal            | Gentle pulse, soft green glow       |
| wake        | Presence or attention detected    | Brightens, rings expand slightly    |
| listening   | User engaged, awaiting input      | Cyan glow, subtle oscillation       |
| thinking    | Processing query or data          | Violet shimmer, ring rotation       |
| explaining  | Delivering information            | Warm white, steady radiance         |
| confirming  | Action acknowledged               | Green flash, brief expansion        |
| alert       | Anomaly or drift detected         | Amber pulse, ring intensifies       |
| uncertain   | Low confidence, needs guidance    | Muted violet, gentle sway           |
| offline     | No connection                     | Dimmed gray, no animation           |

### Three Visual Levels
1. **Hero presence** -- full orb with rings, for dashboard and demo screens
2. **Companion form** -- smaller orb, for side-panel and chat interactions
3. **Indicator glyph** -- minimal dot/icon, for compact UI and notifications

---

## Architecture

### Existing Backend (Fully Built)
- `routes/assistant-chat.js`: 50+ tools, streaming chat, memory, briefings
- `routes/farm-ops-agent.js`: Tool gateway, daily todo, audit logging
- `public/js/farm-assistant.js`: 2,380-line chat widget (being enhanced)
- `public/styles/farm-assistant.css`: 1,286-line chat styling

### New Components (This Build)
- `public/styles/evie-core.css`: Visual identity + 3-layer presence design system
- `public/js/evie-presence.js`: Ambient orb + intelligence panel + conversation
- `public/evie-core.html`: Dedicated E.V.I.E. farm intelligence page
- `routes/assistant-chat.js` GET /state: Farm state aggregation endpoint

### Integration Points
- Replaces `farm-assistant.js` script tag on `LE-farm-admin.html`
- Adds `evie-core.css` to farm admin page head
- New E.V.I.E. Core page linked from farm sidebar navigation

---

## What E.V.I.E. Should Feel Like

The finished experience should have six visible qualities:
1. **Presence** -- always there, not hidden behind a button
2. **Awareness** -- reacts to context, attention, and farm state
3. **Intelligence** -- shows reasoning, not just answers
4. **Calmness** -- composed, not noisy or theatrical
5. **Embodiment** -- visual states that make her feel present
6. **Usefulness** -- helps the user do something real

---

## What E.V.I.E. Should Not Become

- A gimmicky kiosk greeter
- A generic "AI woman face"
- A customer-service avatar
- A novelty animation disconnected from the farm
- A surveillance system
- A confusing duplicate of F.A.Y.E.

---

## Phase Roadmap

| Phase | Focus                          | Status      |
|-------|--------------------------------|-------------|
| 1     | Product role + vision          | Complete    |
| 2     | Visual identity CSS system     | In Progress |
| 3     | Live presence (state-reactive) | In Progress |
| 4     | Voice + conversation embodiment| Planned     |
| 5     | Real farm data connection      | In Progress |
| 6     | Distinct experience modes      | Planned     |
| 7     | Farm intelligence UX           | In Progress |
| 8     | Memory + personalization       | Existing    |
| 9     | Controlled autonomy            | Existing    |
| 10    | Polish + product hardening     | Planned     |

---

## Lot System and Harvest Workflow

E.V.I.E. is the grower-facing interface for the entire seed-to-shelf traceability pipeline. When a grower interacts with the lot system, E.V.I.E. provides guidance, context, and plain-language explanations.

### E.V.I.E.'s Role in the Pipeline

| Step | What Happens | E.V.I.E.'s Involvement |
|------|-------------|----------------------|
| Planting | Grower assigns crop to group, records seed source and seed lot | E.V.I.E. surfaces planting reminders, confirms assignments, explains why seed traceability matters |
| Growing | Environment monitored via sensors, recipe targets tracked | E.V.I.E. monitors drift from recipe targets (PPFD, EC, pH, VPD), alerts on environment anomalies |
| Harvest Timing | `daysToHarvest` from crop registry determines readiness | E.V.I.E. proactively tells the grower when a tray is approaching harvest day, using crop-specific growth days from the registry (35-day fallback only when crop entry is missing) |
| Harvest Recording | `POST /api/lots/harvest` creates harvest_event + lot_record | E.V.I.E. can guide the grower through recording: weight, quality score, quality notes. Explains what the quality grade (A/B/C/D) means for pricing and shelf placement |
| Lot Lookup | `GET /api/lots/:farmId/lot/:lotNumber` shows full traceability | E.V.I.E. translates lot data into plain language: "This batch of Buttercrunch was seeded on March 5, harvested March 22, grade A, good until April 1" |
| Label Printing | `POST /api/lots/label` generates print-ready labels | E.V.I.E. can explain what goes on the label and why (lot number, best-by date, quality grade, seed source) |
| Quality Grading | Score 0-1 mapped to A/B/C/D grades | E.V.I.E. explains grading criteria to growers and suggests improvements when quality trends downward |

### Harvest Flow (Grower Perspective)

```
Grower harvests tray
       |
       v
E.V.I.E.: "Ready to record this harvest? I need the weight and a quality check."
       |
       v
POST /api/lots/harvest
  -> harvest_event created (yield, quality, harvested_by)
  -> lot_number generated (GREE-20260322-001)
  -> best_by_date calculated (category shelf life)
  -> farm_inventory updated (auto_quantity_lbs, lot linkage)
       |
       v
E.V.I.E.: "Lot GREE-20260322-001 recorded. Grade B, best by April 1.
           Label ready to print. Next harvest: Group B3 in 2 days."
```

### What E.V.I.E. Surfaces Proactively

- **Approaching harvest**: "Group A2 (Bibb Butterhead) is at day 30 of 32. Harvest window opens in 2 days."
- **Quality trends**: "Last 3 harvests of Salad Bowl Oakleaf scored below 0.75. Consider adjusting EC or light spectrum."
- **Shelf life urgency**: "Lot GREE-20260320-002 best-by is March 27 -- 5 days remaining. 4 lbs still in inventory."
- **Traceability gaps**: "Group C1 has no seed source recorded. Add it for SFCR compliance."

### Escalation to F.A.Y.E.

E.V.I.E. handles single-farm lot operations. She escalates to F.A.Y.E. when:
- Quality scoring reveals a cross-farm pattern (multiple farms seeing quality drops on the same crop)
- A lot needs recall (business operation with buyer impact)
- SFCR audit data is requested at the network level (multi-farm export)
- Pricing decisions are needed based on quality grades



---

## Nightly AI Checklist -- Self-Evolving Grower App

E.V.I.E. participates in a nightly self-improvement loop shared with F.A.Y.E. The checklist runs every night at 2 AM ET, immediately before the existing 3 AM system audit. E.V.I.E.'s role focuses on grower-facing workflow health, sensor data quality, and generating the daily User Use Note that feeds both agents' learning.

### E.V.I.E.'s Nightly Responsibilities

#### 1. Daily User Use Note (E.V.I.E. -> F.A.Y.E.)

Before the nightly questions run, E.V.I.E. compiles a User Use Note summarizing the day's grower interactions. This note is shared with F.A.Y.E. via inter-agent messaging and persisted to `faye_knowledge` for long-term learning. The note covers:

- **Interaction Summary**: Total conversations, unique growers, average turns per session
- **Top Questions Asked**: Most frequent topics (planting, pricing, devices, environment, harvest)
- **Tool Usage Patterns**: Which tools were called most, which were never used
- **Recommendation Adoption**: How many AI suggestions were accepted vs ignored
- **Workflow Completions**: Which grower workflows ran to completion vs abandoned mid-flow
- **Friction Points**: Where growers got stuck, repeated their question, or expressed confusion
- **Feature Gaps**: Requests E.V.I.E. could not fulfill (unsupported integrations, missing data)
- **Escalations to F.A.Y.E.**: Count, categories, and outcomes of business escalations

#### 2. Daily Learning Notes Exchange

Before running the nightly checklist questions, both agents share learning notes:

- **E.V.I.E. sends to F.A.Y.E.**: The User Use Note (above) plus a "Grower Health Pulse" (sensor coverage, environment compliance, nutrient drift across all farms)
- **F.A.Y.E. sends to E.V.I.E.**: A "Business Context Brief" (order trends, pricing changes, new buyers, upcoming deliveries, policy updates that affect grower advice)
- Both notes are tagged with the date and persisted for trend analysis

This exchange ensures E.V.I.E. gives growers advice informed by the latest business context, and F.A.Y.E. makes business decisions informed by actual grower behavior.

#### 3. E.V.I.E.'s Nightly Checklist Questions

| Theme | Question | Data to Check | Action if Flagged |
|-------|----------|---------------|-------------------|
| **User Workflows** | Did any grower's daily workflow (planting, monitoring, harvest logging) fail to complete critical steps? | Workflow status logs, task completion rates | Prompt user reminders, log gaps, update UI guidance |
| **User Workflows** | Are key metrics (yield targets, harvest dates) being updated when growers complete tasks? | End-of-day harvest logs vs planned schedules | Remind grower to log missing data, adjust forecasts |
| **User Workflows** | Are growers reporting inconsistent or contradicting advice from E.V.I.E.? | Feedback flags, support tickets | Flag for review, halt conflicting recs, issue correction |
| **Sensor Health** | Are all expected sensors online and reporting? | Sensor telemetry presence/absence, last-reported timestamp | Alert ops, disable affected auto-actions, schedule repair |
| **Sensor Health** | Are any sensor streams flatlining or showing impossible values? | Telemetry ranges, zero-hour variation analysis | Suppress bad data, flag device for calibration |
| **Sensor Health** | Is data coverage uniform across all zones (no blind spots)? | Sensor count and uptime per zone vs expected | Prompt grower to add missing instrumentation |
| **Environment** | Are environmental setpoints consistent with active crop recipes? | Current controls vs recipe targets | Ask grower to reconcile, roll back unintentional changes |
| **Environment** | Did any zone's DLI, VPD, or temperature deviate significantly from recipe targets? | Sensor averages vs recipe day targets | Flag deviation, propose corrective action |
| **Recommendations** | Are AI recommendations being utilized or ignored? | "Recommendation accepted" vs offered ratio | A/B test different advice styles, collect reasons |
| **Recommendations** | Is recommendation confidence changing unexpectedly? | Aggregate confidence scores | If confidence drops, slow updates, flag possible drift |
| **Experiments** | Did any trial results meet stopping criteria (success/failure)? | Trial metrics vs thresholds | Conclude trial, update recipe if success |
| **Experiments** | Are growers mixing variables in A/B tests (confounding trials)? | Trial change logs for simultaneous edits | Alert grower, recommend clean experiment design |

### KPIs E.V.I.E. Tracks

| KPI | Calculation | Target |
|-----|-------------|--------|
| Sensor uptime | % of expected sensors reporting on time | >95% |
| Recipe compliance | % of zones within recipe target ranges | >90% |
| Recommendation adoption | % of suggestions acted upon | >60% |
| Workflow completion | % of started workflows finished | >80% |
| Grower satisfaction | Sentiment analysis of conversation tone | Positive trend |
| Closed-loop latency | Time from data collection to actionable insight | <24 hours |

---

## Foundational AI/ML Literature

Core references that inform E.V.I.E.'s capabilities, safety design, and future development roadmap. Full annotated bibliography with GreenReach-specific relevance notes is maintained in `.github/AI_VISION_RULES_AND_SKILLS.md` Section 16.

### Architecture Foundations

| Ref | Paper | Relevance to E.V.I.E. |
|-----|-------|----------------------|
| 16.1.1 | He et al. (2016) -- Deep Residual Learning (ResNet) | Backbone for future plant health image classification |
| 16.1.2 | Vaswani et al. (2017) -- Attention Is All You Need (Transformer) | Engine behind E.V.I.E.'s conversational understanding |
| 16.1.4 | Ho et al. (2020) -- Denoising Diffusion Probabilistic Models | Synthetic data augmentation for scarce farm imagery |

### Safety & Alignment

| Ref | Paper | Relevance to E.V.I.E. |
|-----|-------|----------------------|
| 16.3.1 | Goodfellow et al. (2015) -- Adversarial Examples | Sensor data validation, defensive input handling |
| 16.3.2 | Ouyang et al. (2022) -- InstructGPT / RLHF | The alignment technique underlying E.V.I.E.'s instruction-following behavior |
| 16.3.4 | Amodei et al. (2016) -- Concrete Problems in AI Safety | Maps to E.V.I.E.'s guardrails: side effects, safe exploration, distributional shift |

### Governance

| Ref | Paper | Relevance to E.V.I.E. |
|-----|-------|----------------------|
| 16.4.1 | Bender et al. (2021) -- Stochastic Parrots | Reinforces "never fabricate data" guardrail |
| 16.4.2 | Mitchell et al. (2019) -- Model Cards | Template for documenting E.V.I.E.'s recommendation format |
| 16.4.3 | Gebru et al. (2021) -- Datasheets for Datasets | Framework for farm sensor and harvest data documentation |

### Future Capabilities

| Ref | Paper | Relevance to E.V.I.E. |
|-----|-------|----------------------|
| 16.5.2 | Radford et al. (2021) -- CLIP | Zero-shot plant condition classification from photos |
| 16.5.3 | Alayrac et al. (2022) -- Flamingo | Mixed sensor chart + crop photo + text reasoning |
| 16.5.4 | Li et al. (2023) -- BLIP-2 | Lightweight bridge to add visual understanding to E.V.I.E.'s LLM backend |

### Key Principle

E.V.I.E. operates on foundation models whose behavior is shaped by RLHF alignment (Ref 16.3.2). Every response is grounded in actual sensor data and tool outputs -- never in model-generated fabrication (Ref 16.4.1). Safety guardrails map directly to the concrete problems catalogue (Ref 16.3.4). Future multimodal capabilities will follow the efficient bridging architecture of BLIP-2 (Ref 16.5.4) rather than expensive end-to-end retraining.
