# AI Vision: Agent Rules & Skills

**Version**: 1.1.0  
**Date**: February 21, 2026  
**Source Authority**: `AI_VISION_REPORT.md` (v2, 52 opportunities, Central-first architecture)  
**Companion To**: `AGENT_SKILLS_FRAMEWORK.md` (v1.3.0)  
**Purpose**: Codify the AI Vision Report into enforceable agent rules, required skills, and implementation constraints. All agents working on AI/ML features, network intelligence, feedback loops, or workflow automation MUST read this document before proposing or implementing.

---

## Table of Contents

1. [Core Philosophy Rules](#1-core-philosophy-rules)
2. [Central-First Architecture Rules](#2-central-first-architecture-rules)
3. [Experiment Record Standard](#3-experiment-record-standard)
4. [Feedback Loop Rules](#4-feedback-loop-rules)
5. [Workflow Automation Rules](#5-workflow-automation-rules)
6. [Recipe Modifier Rules](#6-recipe-modifier-rules)
7. [Network Intelligence Rules](#7-network-intelligence-rules)
8. [Safety & Guardrail Rules](#8-safety--guardrail-rules)
9. [Data Collection Rules](#9-data-collection-rules)
10. [Phase Gate Rules](#10-phase-gate-rules)
11. [Agent Skills Required](#11-agent-skills-required)
12. [Pre-Implementation Checklist](#12-pre-implementation-checklist)
13. [Automatic Rejection Criteria](#13-automatic-rejection-criteria)
14. [Quick Reference: 52 Opportunities](#14-quick-reference-52-opportunities)
15. [CEA Environment Reference Sources](#15-cea-environment-reference-sources)

---

## 1. Core Philosophy Rules

These rules derive from the AI Vision Report's foundational principles. They override generic AI/ML best practices when conflicts arise.

### Rule 1.1: Every Grow Cycle Is an Experiment

**Mandate**: All code that touches the seed-to-harvest lifecycle MUST treat each grow cycle as a scientific experiment with recorded independent variables (recipe, spectrum, environment targets) and dependent variables (yield, quality, loss rate, grow time).

```
REQUIRED mindset:
  Seed → Grow → Harvest = Experiment with recorded inputs and measured outcomes

PROHIBITED mindset:
  Seed → Grow → Harvest = Task completed, data discarded
```

**Agent Checkpoint**: Before implementing any harvest-related code, ask: *"Does this record the experiment, or just complete the task?"*

### Rule 1.2: Connect Outcomes to Inputs

**Mandate**: The #1 architectural priority is closing feedback loops. Any code that captures an outcome (weight, quality, loss, energy) MUST also capture or link to the inputs that produced it (recipe, spectrum, environment, timing).

```
❌ PROHIBITED: Record harvest weight without linking to recipe + environment
❌ PROHIBITED: Record loss event without querying environment 24h prior
❌ PROHIBITED: Record quality score without linking to spectrum applied

✅ REQUIRED: Every outcome record includes input lineage
✅ REQUIRED: Every input adjustment references the outcome that triggered it
```

### Rule 1.3: Scientific Instrument, Not Task Runner

**Mandate**: Each Light Engine operates in three simultaneous modes: **Observe** (sensors, weights, quality), **Experiment** (adaptive recipes, environment, spectrum), **Learn** (outcome correlation). Code MUST serve at least one of these modes.

**Agent Checkpoint**: Before implementing any feature, identify which mode(s) it serves:

```markdown
Feature: [Name]
Mode(s) served:
  - [ ] OBSERVE — Captures data about the growing environment or outcomes
  - [ ] EXPERIMENT — Varies parameters to test hypotheses
  - [ ] LEARN — Correlates inputs with outcomes to improve future decisions
  - [ ] CONTRIBUTE — Shares anonymized data with Central for network learning
```

If zero modes checked → the feature does not belong in the AI/ML domain.

### Rule 1.4: 80% of Needed Data Already Exists

**Mandate**: Before proposing ANY new data collection, agents MUST audit what already exists. The AI Vision Report identifies 10 data sources already collected but not used (Section 7). New sensor data or infrastructure is rarely needed — connecting existing data is the priority.

```bash
# REQUIRED search before proposing new data collection:
grep -r "env.json\|crop-weight\|trayRun\|preAutomationLogger\|anomaly-history" server-foxtrot.js lib/ routes/
```

### Rule 1.5: Central Is the Mother Ship

**Mandate**: GreenReach Central is the network intelligence engine — the brain that makes every Light Engine smarter than it could be alone. Central is NOT a passive data warehouse. Central is NOT deferred to later phases. Central is active from Phase 1.

```
❌ PROHIBITED: "We'll add Central integration later"
❌ PROHIBITED: "This is a farm-only feature" (if it generates learnable data)
❌ PROHIBITED: Treating Central as optional or secondary

✅ REQUIRED: Every feature that generates experiment data includes a Central sync path
✅ REQUIRED: Every implementation phase includes both Farm-Side and Central-Side tasks
✅ REQUIRED: Central receives data from day 1, pushes intelligence from day 1
```

---

## 2. Central-First Architecture Rules

### Rule 2.1: Dual-Track Implementation

**Mandate**: Every implementation phase MUST include both Farm-Side and Central-Side tasks. Agents MUST NOT implement farm features that generate learnable data without simultaneously planning or implementing the Central ingestion path.

**Template for AI feature proposals:**

```markdown
## Proposal: [Feature Name]

### Farm-Side
- What data is captured: [fields]
- Where it's stored locally: [NeDB collection or file]
- Sync endpoint to Central: [POST /api/sync/... ]

### Central-Side
- Ingestion endpoint: [POST /api/sync/... ]
- Storage: [PostgreSQL table + column]
- Analysis: [What Central does with this data]
- Push-back: [What intelligence flows back to farms]
```

**Auto-reject if**: Farm-Side only, with no Central-Side plan.

### Rule 2.2: Use Existing Pipes

**Mandate**: Central already has operational infrastructure. Agents MUST use existing pipes before creating new ones.

| Existing Pipe | Direction | Frequency | Use For |
|--------------|-----------|-----------|---------|
| `syncFarmData()` | Farm → Central | Every 5 min | Telemetry, groups, rooms, inventory, config |
| `analyzeAndPushToAllFarms()` | Central → Farm | Every 30 min | AI recommendations, benchmarks, demand signals |
| `POST /api/health/ai-recommendations` | Central → Farm | Every 30 min | Intelligence push (extend payload) |
| `wholesaleNetworkAggregator.js` | Central internal | Every 5 min | Cross-farm SKU rollup |
| `/api/crop-weights/network-analytics` | Central API | On demand | Cross-farm weight stats |
| Farm heartbeat | Farm → Central | Continuous | CPU/mem/disk/uptime |

```
❌ PROHIBITED: Creating a new push channel when analyzeAndPushToAllFarms() can be extended
❌ PROHIBITED: Creating a new sync endpoint when syncFarmData() can be extended
❌ PROHIBITED: Polling from farm when Central already pushes data

✅ REQUIRED: Check existing pipes first
✅ REQUIRED: Extend existing payload before creating new endpoints
✅ REQUIRED: Document which pipe is used in every proposal
```

### Rule 2.3: Central's Role Progression

**Mandate**: Central's capabilities MUST follow the defined progression. Do not implement Phase 3+ Central capabilities before Phase 1-2 foundations are in place.

```
Phase 1:  Data Warehouse + Basic Benchmarks     (receive, store, compare)
Phase 2:  Intelligence Provider                   (analyze, push insights)
Phase 3:  Learning Engine                         (ML models, recipe modifiers)
Phase 4:  Network Coordinator                     (schedule, balance, experiment)
Phase 5:  Autonomous Orchestrator                 (plan, distribute, match)
```

**Agent Checkpoint**: *"What phase is Central currently at for this feature domain? Am I building on top of the right foundation?"*

### Rule 2.4: Seven Stub Endpoints Must Be Populated

**Mandate**: 7 of 9 cross-farm analytics endpoints in `network-growers.js` are stubs returning empty data (`[]` or score `0`). Agents implementing network analytics MUST populate these stubs before creating parallel endpoints.

```bash
# Find the stubs:
grep -n "return.*\[\]" greenreach-central/routes/network-growers.js
grep -n "score.*0" greenreach-central/routes/network-growers.js
```

```
❌ PROHIBITED: Creating /api/network/my-custom-analytics alongside empty /api/network/comparative-analytics
✅ REQUIRED: Populate existing stub endpoints first, then extend
```

### Rule 2.5: Central Intelligence Contract (Mandatory)

**Mandate**: Any GreenReach Central AI change MUST preserve the core intelligence contract and prove compatibility with existing farm integrations.

| Contract Area | Required Behavior | Evidence Required |
|--------------|-------------------|-------------------|
| Ingestion | Central accepts canonical experiment records | Request/response example for `POST /api/sync/experiment-records` |
| Aggregation | Nightly benchmark pipeline remains operational | Job trigger/log evidence or test output |
| Push payload | `POST /api/health/ai-recommendations` remains backward-compatible | Sample payload showing existing + `network_intelligence` keys |
| Analytics APIs | Existing `/api/network/*` endpoints are extended, not bypassed | Endpoint diff and sample response |

```
❌ PROHIBITED: Breaking existing AI recommendation payload keys consumed by farms
❌ PROHIBITED: Replacing existing endpoints without migration/adapters
✅ REQUIRED: Backward-compatible payload evolution with additive fields
✅ REQUIRED: Include proof of contract compatibility in PR notes
```

### Rule 2.6: Central-First Scope Control

**Mandate**: Central AI work must prioritize network leverage before farm-local optimization when both are possible in the same effort.

Priority order for ambiguous scope:
1. Enable Central ingestion of learnable data
2. Enable Central benchmark/insight generation
3. Enable Central push-back to farms
4. Add farm-local optimization refinements

```
❌ PROHIBITED: Spending a sprint on farm-local tuning while Central still cannot ingest experiment records
✅ REQUIRED: Resolve Central bottlenecks first when they block network learning
```

---

## 3. Experiment Record Standard

### Rule 3.1: Canonical Experiment Record Schema

**Mandate**: Every harvest generates exactly ONE experiment record with this structure. Agents MUST NOT deviate from this schema without Architecture Agent approval.

```json
{
  "farm_id": "string (farm identifier)",
  "crop": "string (crop name, lowercase-hyphenated)",
  "recipe_id": "string (recipe identifier used)",
  "grow_days": "number (actual days from seed to harvest)",
  "planned_grow_days": "number (recipe-defined target)",
  "recipe_params_avg": {
    "ppfd": "number (µmol/m²/s average over cycle)",
    "blue_pct": "number (0-100)",
    "red_pct": "number (0-100)",
    "green_pct": "number (0-100)",
    "far_red_pct": "number (0-100)",
    "temp_c": "number (°C target average)",
    "humidity_pct": "number (% target average)",
    "ec": "number (mS/cm)",
    "ph": "number"
  },
  "environment_achieved_avg": {
    "temp_c": "number (actual °C average)",
    "humidity_pct": "number (actual % average)",
    "co2_ppm": "number (actual ppm average)",
    "vpd_kpa": "number (actual kPa average)",
    "ppfd_actual": "number (actual µmol/m²/s average)"
  },
  "outcomes": {
    "weight_per_plant_oz": "number",
    "quality_score": "number (0-100, from AI vision if available)",
    "loss_rate": "number (0.0-1.0, fraction lost)",
    "energy_kwh_per_kg": "number"
  },
  "farm_context": {
    "region": "string (e.g., NE-US)",
    "altitude_m": "number",
    "season": "string (winter|spring|summer|fall)",
    "system_type": "string (nft|dwc|ebb-flow|drip|etc)",
    "tray_format": "string (e.g., 1020-flat)",
    "fixture_hours": "number (cumulative LED hours)"
  },
  "recorded_at": "ISO 8601 timestamp"
}
```

### Rule 3.2: Experiment Record Consumers

**Mandate**: The experiment record serves multiple consumers. Agents MUST ensure all consumers can read the record.

| Consumer | What It Reads | Location |
|----------|--------------|----------|
| Farm local NeDB | Full record | `harvestOutcomesDB` |
| Central ingest | Full record | `POST /api/sync/experiment-records` |
| AI training export | Subset + computed fields | `GET /api/ai/training-data` |
| Dashboard display | Outcomes + farm name label | Farm Summary UI |
| Recipe modifier engine | recipe_params_avg + outcomes | Phase 3 ML job |

```
❌ PROHIBITED: Modifying the experiment record schema to serve a single consumer
✅ REQUIRED: Use adapters or computed fields for consumer-specific needs
```

---

## 4. Feedback Loop Rules

### Rule 4.1: Five Canonical Feedback Loops

**Mandate**: The system has five defined feedback loops. Agents implementing AI features MUST identify which loop(s) their work closes and reference it in their proposal.

| Loop | Signal (Output) | Adjustable (Input) | Mechanism |
|------|-----------------|-------------------|-----------|
| **1. Recipe → Yield** | Harvest weight/plant | Spectrum, PPFD, temp, photoperiod | Per-crop regression after 10+ harvests |
| **2. Environment → Loss** | Loss events (reason, qty, timing) | Temp setpoint, humidity, airflow | Correlate losses with environment deviations |
| **3. Spectrum → Quality** | AI vision score, buyer ratings | Blue/red/green ratio, far-red % | Correlate spectrum with quality outcomes |
| **4. Timing → Efficiency** | Actual grow days, kWh/kg | DLI targets, temp day/night diff | Optimize for energy efficiency |
| **5. Demand → Production** | Wholesale orders, unfulfilled demand | What to plant, how many, when | Demand forecast → succession → seeding recs |

**Proposal template addition:**

```markdown
### Feedback Loop Alignment
This feature closes/advances loop(s): [1 / 2 / 3 / 4 / 5]
Signal captured: [what outcome]
Input it will eventually adjust: [what parameter]
Current phase of this loop: [open / partially closed / closed]
```

### Rule 4.2: Open Loop → Closed Loop Progression

**Mandate**: The architecture transitions from open-loop to closed-loop. Agents MUST NOT skip steps.

```
Step 1: Capture outcome data (OBSERVE)         ← Phase 1
Step 2: Link outcome to input parameters        ← Phase 1
Step 3: Analyze correlation across N cycles      ← Phase 2-3
Step 4: Generate modifier with confidence        ← Phase 3
Step 5: Apply modifier (human-approved)          ← Phase 4
Step 6: Apply modifier (autonomous + guardrails) ← Phase 5
```

```
❌ PROHIBITED: Jumping to Step 4 (modifier generation) without Steps 1-3 data
❌ PROHIBITED: Jumping to Step 6 (autonomous) without Step 5 validation history
✅ REQUIRED: Each step has data volume minimums (see Rule 8.3)
```

---

## 5. Workflow Automation Rules

### Rule 5.1: Target — 2-3 Steps from Seed to Harvest

**Mandate**: The grower workflow target is 2-3 manual actions (scan + confirm), down from 6-8 today. Every workflow feature MUST reduce steps, not add them.

**Current steps to eliminate/automate:**

| Step | Elimination Method | Phase |
|------|-------------------|-------|
| Select crop at seeding | AI recommends from zone history + demand + Central signals | 2 |
| Enter seed source | Auto-fill from last-used supplier per crop | 2 |
| Enter plant count | Auto-derive from tray format cell count | 2 |
| Assign seed date in group config | Eliminate — already set during seeding | 2 |
| Select recipe in group config | Auto-resolve from crop name | 2 |
| Configure schedule (photoperiod) | Auto-derive from recipe DLI + PPFD | 2 |
| Assign lights to group | Auto-discover from controller topology | 2 |
| Print label | Auto-trigger on harvest scan | 2 |

**Agent Checkpoint**: *"Does my feature add a grower step? If yes, can it be automated instead?"*

### Rule 5.2: Multi-Function Steps

**Mandate**: When possible, every grower action MUST serve multiple system functions. Single-duty steps are technical debt.

**Gold standard — Scan events that serve 5+ functions:**

| Scan Event | Minimum Functions Required |
|-----------|--------------------------|
| **Seed Scan** | Register tray, assign crop, set seed date, auto-assign group, start AI monitoring |
| **Harvest Scan** | Record harvest, generate lot code, create traceability, add to inventory, flag for weigh-in, record grow-days |
| **Weigh-In Scan** | Record weight, snapshot environment, update crop benchmark, calculate variance, contribute to network benchmark |
| **Quick Move Scan** | Update location, assign group, apply recipe, start grow timer, update capacity |

```
❌ PROHIBITED: Implementing a scan event that serves only 1 function
✅ REQUIRED: Document all functions served by each user action in the proposal
```

---

## 6. Recipe Modifier Rules

### Rule 6.1: Farm-Specific Recipe Modifiers

**Mandate**: Recipe modifiers are farm-specific offsets applied on top of base recipes. They are NOT modifications to the base recipe.

```javascript
// ✅ CORRECT: Modifier layer between recipe and solver
const baseRecipe = recipesDB.get(cropName);      // Universal, shared
const farmModifier = modifiersDB.get(cropName);   // Farm-specific offset
const effectiveTarget = applyModifier(baseRecipe, farmModifier);
spectralSolver.solve(effectiveTarget);

// ❌ WRONG: Modifying the base recipe directly
baseRecipe.blue += 3;  // BREAKS universal recipe for all farms
```

### Rule 6.2: Modifier Conservative Bounds

**Mandate**: Recipe modifiers MUST be bounded. No unbounded adjustments.

| Parameter | Max Modifier Per Cycle | Expands When |
|-----------|----------------------|--------------|
| Spectrum (per band) | ±5% | Confidence > 0.85, 20+ harvests |
| PPFD | ±10% | Confidence > 0.85, 20+ harvests |
| Temperature | ±2°C | Confidence > 0.85, 20+ harvests |
| Photoperiod | ±2 hours | Confidence > 0.90, 30+ harvests |

```
❌ PROHIBITED: Recipe modifier that adjusts blue by +15% in one cycle
❌ PROHIBITED: Recipe modifier without a confidence score
❌ PROHIBITED: Recipe modifier based on < 10 harvests
✅ REQUIRED: Every modifier includes { value, confidence, sample_size, revert_trigger }
```

### Rule 6.3: Modifier Revert on Regression

**Mandate**: If a modified recipe underperforms baseline for 2 consecutive cycles, auto-revert to baseline and flag for review. Agents MUST implement this safety mechanism in any modifier system.

```javascript
// REQUIRED pattern:
if (lastTwoCycles.every(c => c.yield < baseline.yield)) {
  revertToBaseline(cropName);
  flagForReview(cropName, 'Modifier underperformed for 2 consecutive cycles');
}
```

### Rule 6.4: Network vs Farm Modifiers

**Mandate**: Two sources of recipe modifiers exist. Farm-local modifiers take precedence when available; network modifiers serve as defaults.

```
Priority:
  1. Farm-specific modifier (from 10+ local harvests)     ← Highest
  2. Network modifier from Central (from 50+ network harvests)
  3. No modifier (use base recipe as-is)                   ← Default
```

---

## 7. Network Intelligence Rules

### Rule 7.1: Privacy-Safe Data Sharing

**Mandate**: Network data sharing MUST follow the privacy model. Agents MUST NOT expose farm-identifying information in cross-farm analytics.

| Data Level | Shared? | With Whom |
|-----------|---------|-----------|
| Raw sensor readings | **No** | Stays on-farm |
| Per-harvest experiment record | **Anonymized** | Central only |
| Aggregated crop benchmarks | **Yes** | All network farms |
| Farm-specific recommendations | **Yes** | Only that farm |
| Customer/buyer data | **Never** | N/A |
| Pricing data | **Never** | N/A |
| Farm identity in benchmarks | **Never** | Anonymous percentile ranking |
| Recipe modifiers | **Aggregated only** | Network-level recommendations |

```
❌ PROHIBITED: "Farm B gets 23% more yield using..." (identifies Farm B)
✅ REQUIRED: "Top quartile farms get 23% more yield using..." (anonymous)

❌ PROHIBITED: Exposing individual farm pricing in network analytics
✅ REQUIRED: Aggregate price ranges only ("$2.50-$3.50/lb network average")
```

### Rule 7.2: Intelligence Push Payload Extension

**Mandate**: Central's 30-minute AI push (`POST /api/health/ai-recommendations`) is the primary intelligence channel. New intelligence types MUST be added to the `network_intelligence` section of this payload, NOT as separate push mechanisms.

```json
{
  "ai_recommendations": ["...existing GPT-analyzed recs..."],
  "network_intelligence": {
    "crop_benchmarks": { "...per crop..." },
    "demand_signals": { "...per crop per region..." },
    "risk_alerts": [ "...pest, disease, equipment..." ],
    "recipe_modifiers": { "...per crop, from network data..." }
  }
}
```

```
❌ PROHIBITED: Creating POST /api/network/push-benchmarks as a separate channel
✅ REQUIRED: Extend network_intelligence section of existing push
```

### Rule 7.3: Minimum Data Volumes for Network Intelligence

**Mandate**: Network intelligence has minimum data volume requirements before it can be published. Agents MUST enforce these thresholds.

| Intelligence Type | Minimum Farms | Minimum Data Points | Confidence Threshold |
|------------------|--------------|---------------------|---------------------|
| Crop benchmarks | 5 | 30 harvests per crop | N/A (statistical) |
| Recipe modifiers | 5 | 50 harvests per crop | > 0.78 |
| Demand signals | 3 (buyers) | 12 weeks order history | N/A |
| Risk alerts | 3 (farms reporting) | N/A | N/A |
| Environmental optima | 10 | 100 harvests per crop | > 0.85 |

```
❌ PROHIBITED: Publishing network recipe modifier from 3 farms and 12 harvests
✅ REQUIRED: Check thresholds before publishing any network intelligence
```

---

## 8. Safety & Guardrail Rules

### Rule 8.1: AI Suggests, Grower Confirms (Phase 1-4)

**Mandate**: In Phases 1-4, AI NEVER autonomously changes recipes, temperatures, lighting, or any growing parameter without explicit grower approval. The only exception is safety overrides (freeze protection, fire risk, equipment over-temperature).

```
❌ PROHIBITED: Auto-applying recipe modifier without grower tap/click
❌ PROHIBITED: Changing temperature setpoint based on AI recommendation alone
❌ PROHIBITED: Modifying spectrum based on network data without approval

✅ REQUIRED: Present recommendation with dismiss/approve buttons
✅ REQUIRED: Log grower decision (accepted/dismissed) as training signal
✅ REQUIRED: Show data source, confidence, expected impact, rollback plan
```

### Rule 8.2: Safety Override Exceptions

**Mandate**: These conditions MAY trigger autonomous action without grower approval:

| Condition | Autonomous Action | Notification |
|-----------|-------------------|-------------|
| Temperature > 45°C (113°F) | Emergency cooling | Critical alert |
| Temperature < 2°C (35.6°F) | Emergency heating | Critical alert |
| Humidity > 95% for > 1 hour | Dehumidifier activation | Warning alert |
| Equipment over-temperature | Device shutdown | Critical alert |
| Power loss detected | Graceful shutdown sequence | Critical alert |

All other conditions require grower confirmation.

### Rule 8.3: Minimum Data Requirements

**Mandate**: AI features have minimum data volume requirements before activation. Agents MUST NOT activate features below these thresholds.

| Feature | Minimum Data Required |
|---------|----------------------|
| Farm recipe modifier | 10+ harvests of same crop on this farm |
| Network recipe modifier | 5+ farms, 50+ harvests of same crop |
| Network crop benchmark | 5+ farms contributing data |
| Autonomous recipe adjustment | 50+ successful AI-guided cycles |
| Loss prediction | 300+ loss events in training set |
| Quality classifier | 1,000+ labeled photos |
| Demand forecaster | 52+ weeks of order history |
| Harvest date predictor | 200+ harvests per crop per farm |

```
❌ PROHIBITED: Activating recipe modifier after 3 harvests
❌ PROHIBITED: Publishing network benchmark from 2 farms
✅ REQUIRED: Check data volume before enabling any AI feature
✅ REQUIRED: Display "Insufficient data (N/threshold required)" when below minimum
```

### Rule 8.4: Transparency in AI Recommendations

**Mandate**: Every AI recommendation displayed to the grower MUST include:

1. **Data source** — Where the recommendation came from (farm data, network data, or both)
2. **Confidence level** — Numeric confidence score (0.0-1.0)
3. **Sample size** — How many data points support this recommendation
4. **Expected impact** — What improvement is expected (e.g., "+12% yield")
5. **Rollback plan** — How to revert if the recommendation doesn't work

```
❌ PROHIBITED: "Try more blue light" (no context)
✅ REQUIRED: "Try Blue +2% — Network data from 47 farms shows +12% yield improvement (confidence: 0.78). Revert after 2 cycles if no improvement."
```

---

## 9. Data Collection Rules

### Rule 9.1: Priority Classification

**Mandate**: Data collection tasks have priority levels. Agents MUST implement P0 before P1, P1 before P2.

| Priority | Data | Why | Storage | Phase |
|----------|------|-----|---------|-------|
| **P0** | Recipe parameters applied per group per day | Foundation for all recipe learning | NeDB `appliedRecipesDB` | 1 |
| **P0** | Complete harvest outcome (experiment record) | Core experiment result | NeDB `harvestOutcomesDB` | 1 |
| **P1** | Environment achieved vs target (daily deviation) | Control accuracy per farm | Extend env.json | 1 |
| **P1** | User decisions on AI recommendations | Reinforcement signal | NeDB `aiDecisionsDB` | 2 |
| **P2** | QA checkpoint scores over time | Growth modeling | Extend QA DB | 3 |
| **P2** | Energy consumption per group per day | kWh/kg optimization | Extend duty logging | 3 |
| **P3** | Buyer satisfaction (ratings, returns, reorders) | Quality feedback | Central `buyerFeedbackDB` | 4 |
| **P3** | Recipe A/B test results | Controlled experiments | NeDB `experimentDB` | 4 |

```
❌ PROHIBITED: Implementing P2 data collection when P0 is not yet captured
✅ REQUIRED: Verify P0 data is flowing before working on P1
```

### Rule 9.2: Persist, Don't Discard

**Mandate**: 9 subsystems currently store data in-memory (volatile). These MUST be persisted to NeDB or PostgreSQL before being used for AI/ML.

| Subsystem | Current | Required |
|-----------|---------|----------|
| Fulfillment data | In-memory | Persist to NeDB |
| Audit log | In-memory | Persist to NeDB |
| Inventory (wholesale) | In-memory | Persist to NeDB |
| Reservations | In-memory | Persist to NeDB |
| Applied recipe params | Not captured | New NeDB collection |
| Harvest outcomes | Partial | Complete experiment record to NeDB |
| AI decision log | Not captured | New NeDB collection |
| Loss-environment correlation | Not linked | Link on capture |
| Wholesale order history | In-memory | Persist to NeDB |

```
❌ PROHIBITED: Building ML features on in-memory data (will lose training data on restart)
✅ REQUIRED: Persist first, then build features on persisted data
```

### Rule 9.3: AI Training Export API

**Mandate**: The existing `/api/crop-weights/ai-training-export` (16 fields) MUST be extended before creating new export endpoints. The target is a comprehensive training data API:

```
GET /api/ai/training-data
  ?type=harvest_outcomes      → experiment records
  ?type=environment_series    → time-series sensor data
  ?type=recipe_applications   → what recipes were actually applied
  ?type=loss_events           → loss correlation records
  ?type=quality_checkpoints   → QA scores + photos
  ?type=demand_history        → wholesale order patterns
  ?format=csv|json|parquet
  ?since=2025-01-01
  ?crop=genovese-basil
```

```
❌ PROHIBITED: Creating /api/my-custom-training-export as a separate endpoint
✅ REQUIRED: Extend /api/ai/training-data with new type parameter
```

---

## 10. Phase Gate Rules

### Rule 10.1: Phase Dependencies

**Mandate**: Implementation phases are sequential. Phase N prerequisites MUST be complete before Phase N+1 work begins.

```
Phase 1 → Phase 2: All P0 data captured + Central receiving experiment records [GATE PASSED]
Phase 2 → Phase 3: Workflow reduced to ≤4 steps + Central providing benchmarks [GATE PASSED]
Phase 3 → Phase 4: Farm recipe modifiers working + Central ML models trained
Phase 4 → Phase 5: Network coordination validated + grower acceptance >90%
```

### Rule 10.2: Phase Completion Criteria

| Phase | Farm-Side Complete When | Central-Side Complete When |
|-------|------------------------|--------------------------|
| **1** | Experiment records persisted + POSTed to Central | Experiment records ingested + nightly benchmarks running |
| **2** | Seed-to-harvest ≤4 steps + Central demand signals consumed | Demand aggregation running + benchmarks pushed to farms |
| **3** | Farm recipe modifiers active for ≥1 crop | Cross-farm yield regression producing modifiers |
| **4** | Farm accepts Central planting suggestions UI | Harvest coordination preventing market flooding |
| **5** | Farm operates with autonomous recipe adjustment | Central generates weekly seeding plans per farm |

### Rule 10.3: Phase-Appropriate Work

**Mandate**: Agents proposing AI features MUST identify the correct phase and verify prerequisites. Implementation of Phase 3+ features without Phase 1-2 foundations is prohibited.

```markdown
## Phase Validation (required in all AI feature proposals)

Target phase: [1 / 2 / 3 / 4 / 5]
Prerequisites met:
  - [ ] Phase N-1 Farm-Side criteria complete
  - [ ] Phase N-1 Central-Side criteria complete
  - [ ] Required data volume accumulated
  - [ ] Prior phase features validated in production
```

```
❌ PROHIBITED: "Let's build cross-farm yield regression" (Phase 3) when experiment records aren't captured (Phase 1)
✅ REQUIRED: "Phase 1 prerequisites: experiment records captured ✅, Central ingestion ✅ → proceed to Phase 2"
```

### Rule 10.4: Central Promotion Gate

**Mandate**: Central AI capabilities may only be promoted phase-by-phase after explicit validation of both data quality and downstream farm compatibility.

Promotion evidence required:
- Data quality checks passed (schema validity + threshold coverage)
- Backward compatibility confirmed for farm consumers
- At least one end-to-end sample from ingest → aggregate → push

```
❌ PROHIBITED: Promoting Central Phase 2/3 capability with only unit-level validation
✅ REQUIRED: End-to-end validation artifact per promoted capability
```

---

## 11. Agent Skills Required

### Skill 11.1: Understand the Stack

Agents working on AI/ML features MUST understand these components:

| Component | Location | Purpose |
|-----------|----------|---------|
| Crop recommendation engine | `lib/crop-recommendation-engine.js` | 6-factor scoring (demand, season, succession, etc.) |
| IsolationForest anomaly detection | `scripts/simple-anomaly-detector.py` | Unsupervised anomaly detection |
| SARIMAX forecasting | `backend/predictive_forecast.py` | Environmental time-series forecasting |
| Spectral solver | `lib/spectral-solver.js` | 3×4 NNLS spectrum mixing |
| Recipe engine | `automation/recipe-environmental-targets.js` | Daily target calculator from recipe DB |
| Adaptive control Tier 1 | `automation/outdoor-aware-adaptive-control.js` | Rule-based outdoor response |
| Weight reconciliation | `routes/crop-weight-reconciliation.js` | Harvest weight + environment snapshots |
| AI agent + vision | `routes/ai-vision.js`, `backend/ai_vision.py` | GPT-4o-mini analysis |
| AI recommendations pusher | `greenreach-central/services/ai-recommendations-pusher.js` | 30-min push channel |
| Wholesale network aggregator | `greenreach-central/wholesaleNetworkAggregator.js` | 5-min cross-farm inventory |
| Network growers (stubs) | `greenreach-central/routes/network-growers.js` | 7 stub endpoints |

### Skill 11.2: Know the Data Pipes

Agents MUST know the direction, frequency, and content of all data pipes:

```
Farm → Central (UP):
  Every 5 min:    syncFarmData() pulls groups, rooms, telemetry, inventory, config
  On harvest:     POST /api/sync/experiment-records (NEW - Phase 1)
  On loss:        Extend sync with loss + environment snapshot (NEW - Phase 1)
  Continuous:     Farm heartbeat (CPU/mem/disk/uptime)

Central → Farm (DOWN):
  Every 30 min:   analyzeAndPushToAllFarms() → POST /api/health/ai-recommendations
  On order:       POST /api/wholesale/order-events
  On reserve:     POST /api/wholesale/inventory/reserve

Central Internal:
  Every 5 min:    wholesaleNetworkAggregator refresh
  Nightly 2 AM:   Benchmark aggregation job (NEW - Phase 1)
  Weekly:         Recipe modifier computation (NEW - Phase 3)
```

### Skill 11.3: Identify Unused Data

Agents MUST be able to identify and leverage the 10 unused data sources from AI Vision Report Section 7:

1. Environment snapshots with every weigh-in → Yield optimization
2. Learning correlations (PPFD↔Blue, Temp↔RH) → Adaptive control
3. Loss events with crop + zone + reason → Root cause analysis
4. BME680 gas resistance (VOC proxy) → Air quality anomaly detection
5. Wholesale order history → Demand forecasting
6. Cross-farm weight benchmarks → Network yield optimization
7. Anomaly false positive feedback → IsolationForest tuning
8. Recipe parameters per group per day → Recipe-outcome correlation
9. QA checkpoint photos → Growth analysis + classifier training
10. Tray format → cell count mapping → Auto-fill plant count

### Skill 11.4: ML Data Volume Awareness

Agents MUST understand ML training data requirements:

| Model | Min Training Examples | Current Data |
|-------|----------------------|-------------|
| Yield predictor | 500+ harvests per crop | ~0 (feedback loop not closed) |
| Grow day estimator | 200+ per crop | Partial |
| Loss predictor | 300+ loss events | ~50 |
| Quality classifier | 1,000+ labeled photos | ~0 |
| Demand forecaster | 52+ weeks order data | ~months |
| Recipe optimizer | 50+ per crop per farm | 0 |

**Key insight**: Individual farms accumulate data slowly. Central reaches ML-viable volumes years faster by aggregating across the network. This is WHY Central-first.

---

## 12. Pre-Implementation Checklist

**REQUIRED before proposing or implementing ANY AI/ML feature:**

```markdown
## AI Vision Pre-Implementation Checklist

### Philosophy Alignment
- [ ] Feature treats grow cycle as experiment (Rule 1.1)
- [ ] Outcomes connected to inputs (Rule 1.2)
- [ ] Serves OBSERVE, EXPERIMENT, or LEARN mode (Rule 1.3)
- [ ] Checked existing data sources before proposing new collection (Rule 1.4)
- [ ] Central integration path defined (Rule 1.5)

### Architecture
- [ ] Proposal includes both Farm-Side and Central-Side (Rule 2.1)
- [ ] Uses existing pipes (Rule 2.2)
- [ ] Respects Central's current phase (Rule 2.3)
- [ ] Populates stubs before creating new endpoints (Rule 2.4)
- [ ] Preserves Central intelligence contract (Rule 2.5)
- [ ] Prioritizes Central bottlenecks before farm-only tuning (Rule 2.6)

### Data
- [ ] Uses canonical experiment record schema (Rule 3.1)
- [ ] Identifies which feedback loop(s) this advances (Rule 4.1)
- [ ] Respects data priority levels — P0 before P1 (Rule 9.1)
- [ ] Data persisted to NeDB/PostgreSQL, not in-memory (Rule 9.2)

### Safety
- [ ] AI suggests, grower confirms (Rule 8.1)
- [ ] Minimum data requirements met for activation (Rule 8.3)
- [ ] Transparency requirements met (Rule 8.4)
- [ ] Recipe modifier bounds enforced (Rule 6.2)
- [ ] Revert-on-regression implemented (Rule 6.3)

### Privacy
- [ ] Farm identity not exposed in network analytics (Rule 7.1)
- [ ] Only anonymized/aggregated data shared (Rule 7.1)

### Phase Gate
- [ ] Correct phase identified (Rule 10.3)
- [ ] Prerequisites for this phase met (Rule 10.1)
- [ ] Central promotion evidence captured (Rule 10.4)

Checklist completed: [DATE]
Agent: [designation]
```

---

## 13. Automatic Rejection Criteria

### Review Agent MUST auto-reject AI/ML proposals if:

1. **No Central integration path** — Farm-only feature that generates learnable data without a sync plan (Rule 2.1)
2. **New push channel** — Creates a separate push mechanism instead of extending `analyzeAndPushToAllFarms()` (Rule 2.2)
3. **Phase skip** — Implements Phase 3+ before Phase 1-2 foundations exist (Rule 10.1)
4. **Missing experiment record** — Harvest feature doesn't capture the canonical experiment record (Rule 3.1)
5. **No feedback loop reference** — AI feature doesn't identify which of the 5 loops it advances (Rule 4.1)
6. **Autonomous without approval** — AI changes growing parameters without grower confirmation in Phase 1-4 (Rule 8.1)
7. **Below data minimum** — Feature activated below minimum data thresholds (Rule 8.3)
8. **Privacy violation** — Proposal exposes farm identity or pricing in network analytics (Rule 7.1)
9. **Unbounded modifier** — Recipe modifier without conservative bounds or revert mechanism (Rules 6.2, 6.3)
10. **In-memory ML** — ML features built on volatile in-memory data (Rule 9.2)
11. **Single-duty scan** — Scan event that serves only 1 function (Rule 5.2)
12. **Adds grower steps** — Feature increases manual actions instead of reducing them (Rule 5.1)
13. **Central contract break** — Changes Central payload/API behavior without compatibility proof (Rule 2.5)
14. **No promotion evidence** — Advances Central capability without end-to-end validation artifact (Rule 10.4)

### Architecture Agent MUST auto-reject if:

1. **Central treated as passive** — Proposal defers Central to "later" or treats it as optional (Rule 1.5)
2. **Base recipe modification** — Proposal modifies universal recipes instead of using modifiers (Rule 6.1)
3. **Duplicate endpoint** — Creates new analytics endpoint alongside existing stubs (Rule 2.4)
4. **P0 data not captured yet** — Proposes P2 or P3 features while P0 data collection is incomplete (Rule 9.1)
5. **No scientific mode** — Feature doesn't serve OBSERVE, EXPERIMENT, or LEARN (Rule 1.3)
6. **Central-first violation** — Farm-local optimization prioritized while Central ingestion/push bottlenecks remain unresolved (Rule 2.6)

---

## 14. Quick Reference: 52 Opportunities

### Phase 1 — Wire the Data + Central Benchmarks (12 tasks) [COMPLETE]

| # | Task | Owner | Effort | Status |
|---|------|-------|--------|--------|
| 1 | Persist recipe parameters applied per day | Farm | S | Done |
| 2 | Build harvest outcome "experiment record" | Farm | M | Done |
| 3 | POST experiment records to Central on harvest | Farm | S | Done |
| 4 | Wire loss events → environment correlation | Farm | S | Done |
| 5 | Feed real demand into crop recommendation | Farm | S | Done |
| 6 | Surface learning correlations on dashboard | Farm | S | Done |
| 7 | Ingest experiment records endpoint | Central | S | Done |
| 8 | Nightly crop benchmark aggregation job | Central | M | Done |
| 9 | Push crop benchmarks in AI recommendation channel | Central | S | Done |
| 10 | Extend AI training export with recipe params | Farm | S | Done |
| 11 | Populate comparative analytics endpoint | Central | M | Done |
| 12 | Populate leaderboard with real scores | Central | S | Done |

Phase 1 Completion Notes:
- Backend: All 16 network endpoints live in network-growers.js with real PostgreSQL queries
- Scheduler: computeCropBenchmarks() runs nightly at 2AM via startBenchmarkScheduler()
- Push: AI recommendations pusher sends crop_benchmarks + demand_signals every 30 min
- Frontend: Network Dashboard view in GR-central-admin.html with KPIs, farm grid, charts
- Navigation: Network section added to sidebar, navigate() cases wired
- Farm correlation: Network Intelligence panel in LE-farm-admin.html showing benchmarks
- Leaderboard: Composite scoring (yield 40% + loss 30% + consistency 30%)

### Phase 2 — Workflow Automation + Central Intelligence (12 tasks) [COMPLETE]

| # | Task | Owner | Effort | Status |
|---|------|-------|--------|--------|
| 13 | Auto-derive plant count from tray format | Farm | S | Done |
| 14 | AI pre-fill crop at seeding + Central demand signals | Farm | S | Done |
| 15 | Combine seed + group assignment | Farm | M | Done |
| 16 | Auto-trigger label print on harvest | Farm | S | Done |
| 17 | Auto-derive photoperiod from recipe | Farm | S | Done |
| 18 | Remove duplicate seed date entry | Farm | S | Done |
| 19 | Auto-discover lights from controller | Farm | M | Done |
| 20 | Demand signal aggregation + push to farms | Central | M | Done |
| 21 | New farm onboarding with network benchmarks | Central | S | Done |
| 22 | Environmental benchmark push | Central | S | Done |
| 23 | Populate network trends endpoint | Central | M | Done |
| 24 | Buyer behavior analysis + churn detection | Central | M | Done |


#### Phase 2 Completion Notes

- **Farm-side workflow automation (Tasks 13-19):** All 7 tasks implemented in server-foxtrot.js. Auto-derive plant count from tray format, AI pre-fill crop at seeding with demand signals, combined seed + group assignment, auto-trigger label print on harvest, auto-derive photoperiod from DLI/PPFD, seed date sync to group, device auto-discovery with zone assignment.
- **Central intelligence (Tasks 20-24):** All 5 tasks implemented. Demand signal aggregation via analyzeDemandPatterns() pushed every 30 min. Farm onboarding seeds benchmarks from Central. Environmental benchmarks (actual achieved temp/humidity/PPFD/VPD/DLI per crop) added to network_intelligence payload. Network trends endpoint returns real PostgreSQL aggregations. Buyer behavior analysis with 3-tier churn classification (active/at_risk/churned).
- **Task 22 (Environmental benchmark push):** getEnvironmentBenchmarksForPush() in experiment-records.js queries actual environment_achieved_avg (with recipe_params_avg fallback) per crop. Provides temp/humidity min/max/avg, PPFD, VPD, DLI, photoperiod. Pushed as environment_benchmarks key in network_intelligence payload.

### Phase 3 — Adaptive Intelligence + Central ML (12 tasks)

| # | Task | Owner | Effort |
|---|------|-------|--------|
| 25 | Per-crop recipe modifier (farm-specific + Central) | Farm | L |
| 26 | Tier 2 adaptive control (HVAC learning) | Farm | M |
| 27 | LED aging detection | Farm | M |
| 28 | ML harvest date prediction | Farm | M |
| 29 | Loss prediction from environment trends | Farm | M |
| 30 | Quality trend analysis from AI vision | Farm | S |
| 31 | Cross-farm yield regression ML model | Central | L |
| 32 | Compute & push network recipe modifiers | Central | M |
| 33 | Cross-farm anomaly correlation | Central | M |
| 34 | Loss pattern network alerts | Central | M |
| 35 | Cross-farm energy benchmarks | Central | S |
| 36 | Per-farm performance tracking endpoint | Central | M |

### Phase 4 — Network Coordination (8 tasks)

| # | Task | Owner | Effort |
|---|------|-------|--------|
| 37 | Accept Central planting suggestions UI | Farm | M |
| 38 | Report harvest schedule to Central | Farm | S |
| 39 | One-tap recipe modifier approve/dismiss | Farm | M |
| 40 | Harvest schedule coordination (anti-flooding) | Central | L |
| 41 | Supply/demand balancing across farms | Central | L |
| 42 | A/B test orchestration across farms | Central | L |
| 43 | Quality-based order routing | Central | M |
| 44 | Dynamic pricing engine | Central | M |

### Phase 5 — Autonomous Operations (8 tasks)

| # | Task | Owner | Effort |
|---|------|-------|--------|
| 45 | Automated recipe adjustment (with guardrails) | Farm | L |
| 46 | AI-driven harvest timing (ready-based) | Farm | M |
| 47 | Voice-first Activity Hub | Farm | L |
| 48 | Network production planning (weekly seeding plans) | Central | L |
| 49 | Dynamic recipe distribution | Central | L |
| 50 | Predictive inventory / auto wholesale listing | Central | M |
| 51 | Autonomous wholesale matching | Central | L |
| 52 | Market intelligence integration | Central | M |

**Totals: 27 Farm-side, 25 Central-side across 5 phases.**

---

## 15. CEA Environment Reference Sources

These peer-reviewed and extension-service references underpin the daily environment targets in every grow recipe. Agents MUST cite the relevant source when proposing recipe modifications or defending parameter values. Do not invent targets -- trace them to a source below.

### Reference 15.1: Cornell CEA Lettuce Handbook

- **Scope**: Head lettuce, baby leaf, romaine, butterhead -- the benchmark for indoor lettuce production.
- **Key setpoints**: DLI ramp to ~17 mol/m2/d at maturity; PPFD ~295 umol/m2/s for a 16 h photoperiod; 60-70% RH; VPD 0.75-1.0 kPa.
- **When to use**: Default authority for any lettuce variety. Other lettuce sources must agree with or explicitly override Cornell values.

### Reference 15.2: UF/IFAS Extension HS1279 (Hydroponic Production)

- **Scope**: Broad hydroponic guidance -- spinach, basil, leafy greens, herbs.
- **Key insights**: Spinach and basil are susceptible to Pythium; maintain higher dissolved-O2 levels and cooler nutrient-solution temperatures. General indoor production best practices.
- **When to use**: Cross-reference whenever root-zone disease risk is elevated or solution temperature exceeds 22 C.

### Reference 15.3: Johnny's Selected Seeds (Crop Timing Data)

- **Scope**: Variety-specific days-to-harvest and cultural notes.
- **Key data points**: Mini-head lettuce 30-32 d post-transplant; full romaine 45-50 d; herb and specialty crop timing benchmarks.
- **When to use**: Validate or calibrate the day-count in any recipe. If a recipe's total days disagree with Johnny's data by more than 15%, flag it.

### Reference 15.4: Hydroponic Basil Production Studies

- **Scope**: Sweet basil, Genovese basil, Thai basil -- CEA-specific.
- **Key setpoints**: Day temp 24-26 C, night temp 18-20 C; PPFD 250-300 umol/m2/s; DLI 14-15 mol/m2/d; EC 1.4-1.8 mS/cm.
- **When to use**: Authority for all basil varieties. Override generic herb defaults with these basil-specific values.

### Reference 15.5: Arugula CEA Studies

- **Scope**: Arugula / rocket in controlled environment.
- **Key setpoints**: Day temp 20-25 C, night temp 15-18 C; DLI 10-15 mol/m2/d; <25-day crop cycle.
- **When to use**: Authority for arugula and related brassica greens with similar bolting sensitivity.

### Reference 15.6: Spinach & Chard CEA Review

- **Scope**: Spinach, Swiss chard -- cool-season leafy crops.
- **Key setpoints**: Day temp 18-20 C, night temp 12-15 C (cooler nights critical); VPD 0.8-1.2 kPa.
- **When to use**: Authority for spinach and chard varieties. These crops need the lowest night temperatures in the catalog.

### Reference 15.7: Light Spectrum Research (General Indoor Greens)

- **Scope**: LED spectrum ratios for photosynthesis, morphology, and secondary metabolite production.
- **Key ratios**: ~40% red (630-660 nm), 20-30% blue (440-470 nm), 20-30% green (500-550 nm), 5-15% far-red (720-740 nm); 16-18 h photoperiod.
- **When to use**: Default spectrum template for any crop lacking crop-specific spectrum data. Adjust blue upward for compact morphology, far-red upward for stem extension.

### Reference 15.8: VPD Control Studies

- **Scope**: Vapour Pressure Deficit management across growth stages.
- **Key setpoints**: Ideal range 0.8-1.2 kPa; seedling/clone stage ~0.75 kPa rising to ~1.0 kPa by harvest; >1.5 kPa triggers stomatal closure; <0.4 kPa invites fungal pressure.
- **When to use**: Cross-check every recipe's VPD column. Flag any day where VPD falls outside 0.4-1.5 kPa as an error.

### Reference 15.9: EC / pH Recommendations (Nutrient Management)

- **Scope**: Electrical conductivity and pH targets by crop category.
- **Key setpoints**: Most greens EC 1.2-1.8 mS/cm, pH 5.8-6.2; basil EC 1.4-1.8; spinach and chard tolerate up to EC 2.0; microgreens on pads EC 0.5-1.0; sprouts (rinse method) EC near 0.
- **When to use**: Validate every recipe's EC and pH columns. Recipes outside these ranges require an explicit justification note in the description field.

### Quick-Reference Setpoint Table

| Parameter | Lettuce | Basil | Arugula | Spinach/Chard | Microgreens | Sprouts |
|-----------|---------|-------|---------|---------------|-------------|---------|
| Day temp (C) | 20-24 | 24-26 | 20-25 | 18-20 | 20-24 | 18-22 |
| Night temp (C) | 16-18 | 18-20 | 15-18 | 12-15 | 16-20 | 16-20 |
| DLI (mol/m2/d) | 14-17 | 14-15 | 10-15 | 10-14 | 8-12 | 0-2 |
| PPFD (umol/m2/s) | 200-295 | 250-300 | 180-260 | 180-250 | 150-200 | 0-50 |
| VPD (kPa) | 0.75-1.0 | 0.8-1.2 | 0.8-1.2 | 0.8-1.2 | 0.6-1.0 | N/A |
| EC (mS/cm) | 1.2-1.6 | 1.4-1.8 | 1.2-1.6 | 1.4-2.0 | 0.5-1.0 | 0 |
| pH | 5.8-6.2 | 5.8-6.2 | 6.0-6.5 | 6.0-6.5 | 5.5-6.0 | N/A |
| Photoperiod (h) | 16-18 | 16-18 | 14-16 | 14-16 | 16 | 0 |

### Rule 15.1: Source-Traced Recipe Validation

- Every recipe parameter MUST be traceable to one of the references above (15.1-15.9) or to a documented farm-specific experiment record (Rule 3.1).
- When an agent proposes a recipe modification, it MUST cite the reference number (e.g. "Per Ref 15.4, basil day temp should be 24-26 C").
- If a parameter falls outside the ranges in the Quick-Reference Table, the recipe description field MUST contain a justification note explaining the deviation.
- During recipe review, flag any unjustified out-of-range parameter as a warning.



## 16. Foundational AI/ML Literature

Annotated bibliography of 20 peer-reviewed papers that form the intellectual foundation for GreenReach AI development. These references inform architecture decisions, safety guardrails, alignment methodology, governance practices, and future capability roadmap across all GreenReach agents (F.A.Y.E., E.V.I.E., and Copilot).

### Executive Summary

This collection spans five domains critical to building responsible, effective AI for controlled environment agriculture: (1) the core neural network architectures that underpin modern vision, language, and decision-making systems; (2) empirical scaling laws that govern how model capability grows with compute and data; (3) safety and alignment techniques that keep AI systems acting within intended boundaries; (4) governance and accountability frameworks that ensure transparency and auditability; and (5) multimodal and continual learning methods that point toward next-generation agent capabilities for farm intelligence.

### Reading Roadmap

| Priority | Domain | Start With | Then Read |
|----------|--------|------------|-----------|
| 1 | Safety & Alignment | Amodei et al. (2016) | Ouyang et al. (2022), Bai et al. (2022) |
| 2 | Governance | Mitchell et al. (2019) | Gebru et al. (2021), Raji et al. (2020) |
| 3 | Core Architectures | Vaswani et al. (2017) | He et al. (2016), Ho et al. (2020) |
| 4 | Scaling & Foundation Models | Kaplan et al. (2020) | Hoffmann et al. (2022), Brown et al. (2020) |
| 5 | Future Directions | Radford et al. (2021) | Li et al. (2023), Alayrac et al. (2022) |

### 16.1 Core Architectures & Methods

These four papers define the building blocks used across vision, language, reinforcement learning, and generative modelling.

#### Reference 16.1.1: Deep Residual Learning for Image Recognition

- **Authors**: He, K., Zhang, X., Ren, S., & Sun, J.
- **Year**: 2016
- **Venue**: IEEE Conference on Computer Vision and Pattern Recognition (CVPR)
- **Key contribution**: Introduced skip connections (residual blocks) enabling training of networks with 100+ layers without gradient degradation. ResNet-152 won ImageNet 2015 with 3.57% top-5 error.
- **GreenReach relevance**: Foundation for any plant health image classification, leaf disease detection, or growth-stage visual analysis. ResNet backbones remain the default starting point for agricultural computer vision tasks.
- **Cited by**: 200,000+

#### Reference 16.1.2: Attention Is All You Need

- **Authors**: Vaswani, A., Shazeer, N., Parmar, N., Uszkoreit, J., Jones, L., Gomez, A. N., Kaiser, L., & Polosukhin, I.
- **Year**: 2017
- **Venue**: Advances in Neural Information Processing Systems (NeurIPS)
- **Key contribution**: Replaced recurrence with multi-head self-attention, enabling parallel training and long-range dependency modeling. Introduced the Transformer architecture that underpins GPT, BERT, and all modern LLMs.
- **GreenReach relevance**: The Transformer is the engine behind E.V.I.E. and F.A.Y.E. conversational capabilities. Understanding attention mechanisms is essential for prompt engineering, context window management, and interpreting agent behavior.
- **Cited by**: 140,000+

#### Reference 16.1.3: Human-Level Control Through Deep Reinforcement Learning

- **Authors**: Mnih, V., Kavukcuoglu, K., Silver, D., Rusu, A. A., Veness, J., Bellemare, M. G., Graves, A., Riedmiller, M., Fidjeland, A. K., Ostrovski, G., Petersen, S., Beattie, C., Sadik, A., Antonoglou, I., King, H., Kumaran, D., Wierstra, D., Legg, S., & Hassabis, D.
- **Year**: 2015
- **Venue**: Nature, 518(7540), 529-533
- **Key contribution**: Deep Q-Network (DQN) combined convolutional neural networks with Q-learning to achieve human-level performance across 49 Atari games from raw pixel input. Demonstrated that a single architecture can learn diverse sequential decision-making tasks.
- **GreenReach relevance**: Conceptual foundation for future autonomous environment control -- an RL agent that learns optimal lighting, irrigation, and climate schedules from sensor feedback rather than fixed recipes. Relevant to F.A.Y.E. autonomy progression.
- **Cited by**: 30,000+

#### Reference 16.1.4: Denoising Diffusion Probabilistic Models

- **Authors**: Ho, J., Jain, A., & Abbeel, P.
- **Year**: 2020
- **Venue**: Advances in Neural Information Processing Systems (NeurIPS)
- **Key contribution**: Formalized the training of diffusion models as a sequence of denoising steps, producing high-fidelity image generation that rivals GANs with more stable training. Established the DDPM framework adopted by DALL-E 2, Stable Diffusion, and Imagen.
- **GreenReach relevance**: Potential for synthetic data augmentation (generating realistic plant images for training disease classifiers when labeled farm data is scarce) and for sensor data imputation (filling gaps in environmental time series).
- **Cited by**: 15,000+

### 16.2 Scaling Laws & Foundation Models

Empirical findings on how model performance scales with compute, data, and parameters -- critical for capacity planning and cost-benefit analysis.

#### Reference 16.2.1: Scaling Laws for Neural Language Models

- **Authors**: Kaplan, J., McCandlish, S., Henighan, T., Brown, T. B., Chess, B., Child, R., Gray, S., Radford, A., Wu, J., & Amodei, D.
- **Year**: 2020
- **Venue**: arXiv preprint (arXiv:2001.08361)
- **Key contribution**: Established power-law relationships between model performance and three factors: parameter count, dataset size, and compute budget. Showed that performance improves predictably with scale, and that larger models are more sample-efficient.
- **GreenReach relevance**: Informs decisions about which model sizes to deploy for E.V.I.E. and F.A.Y.E. -- smaller models for latency-sensitive farm operations, larger models for complex administrative reasoning. Guides compute budget allocation.

#### Reference 16.2.2: Training Compute-Optimal Large Language Models (Chinchilla)

- **Authors**: Hoffmann, J., Borgeaud, S., Mensch, A., Buchatskaya, E., Cai, T., Rutherford, E., Casas, D. de L., Hendricks, L. A., Welbl, J., Clark, A., Hennigan, T., Noland, E., Millican, K., van den Driessche, G., Damoc, B., Guy, A., Osindero, S., Simonyan, K., Rae, J. W., Vinyals, O., & Sifre, L.
- **Year**: 2022
- **Venue**: Advances in Neural Information Processing Systems (NeurIPS)
- **Key contribution**: Demonstrated that most large language models are significantly undertrained relative to their size. A 70B-parameter model trained on 4x more data (Chinchilla) outperformed the 280B Gopher model. Established the "Chinchilla scaling law": optimal training requires roughly equal scaling of parameters and data tokens.
- **GreenReach relevance**: Validates the strategy of using well-trained smaller models over undertrained larger ones for cost-effective farm AI. Directly relevant to model selection and fine-tuning decisions.

#### Reference 16.2.3: Language Models Are Few-Shot Learners (GPT-3)

- **Authors**: Brown, T. B., Mann, B., Ryder, N., Subbiah, M., Kaplan, J., Dhariwal, P., Neelakantan, A., Shyam, P., Sastry, G., Askell, A., Agarwal, S., Herbert-Voss, A., et al.
- **Year**: 2020
- **Venue**: Advances in Neural Information Processing Systems (NeurIPS)
- **Key contribution**: Demonstrated that a 175B parameter language model can perform tasks via in-context learning (zero-shot, one-shot, few-shot) without gradient updates. Showed emergent capabilities at scale including arithmetic, code generation, and structured data manipulation.
- **GreenReach relevance**: The few-shot learning paradigm is how E.V.I.E. and F.A.Y.E. operate -- they receive task context in the prompt (farm state, sensor data, recipes) and generate responses without fine-tuning. Understanding few-shot mechanics improves prompt design.

#### Reference 16.2.4: On the Opportunities and Risks of Foundation Models

- **Authors**: Bommasani, R., Hudson, D. A., Adeli, E., Altman, R., Arber, S., von Arx, S., Bernstein, M. S., Bohg, J., Bosselut, A., Brunskill, E., Brynjolfsson, E., et al. (Stanford CRFM, 100+ authors)
- **Year**: 2021
- **Venue**: arXiv preprint (arXiv:2108.07258)
- **Key contribution**: Comprehensive 200+ page survey defining "foundation models" as large pretrained models adapted to downstream tasks. Analyzed their capabilities, limitations, and societal impact across language, vision, robotics, healthcare, law, and education.
- **GreenReach relevance**: Strategic context for how GreenReach uses foundation models (OpenAI GPT) as the base for E.V.I.E. and F.A.Y.E. Highlights risks of homogenization, single-point-of-failure dependencies, and the importance of domain-specific guardrails.

### 16.3 Safety & Alignment

Techniques and frameworks for ensuring AI systems behave as intended, respect boundaries, and remain aligned with human values.

#### Reference 16.3.1: Explaining and Harnessing Adversarial Examples

- **Authors**: Goodfellow, I. J., Shlens, J., & Szegedy, C.
- **Year**: 2015
- **Venue**: International Conference on Learning Representations (ICLR)
- **Key contribution**: Introduced the Fast Gradient Sign Method (FGSM) for generating adversarial examples and demonstrated that imperceptible perturbations can cause confident misclassification. Proposed adversarial training as a defense mechanism.
- **GreenReach relevance**: Critical awareness for any future computer vision deployment (plant health assessment, quality grading). Sensor data can also contain adversarial-like noise from hardware faults. Defensive validation is already embedded in Rule 8 (Safety Guardrails).

#### Reference 16.3.2: Training Language Models to Follow Instructions with Human Feedback (InstructGPT / RLHF)

- **Authors**: Ouyang, L., Wu, J., Jiang, X., Almeida, D., Wainwright, C. L., Mishkin, P., Zhang, C., Agarwal, S., Slama, K., Ray, A., Schulman, J., Hilton, J., Kelton, F., Miller, L., Simens, M., Askell, A., Welinder, P., Christiano, P. F., Leike, J., & Lowe, R.
- **Year**: 2022
- **Venue**: Advances in Neural Information Processing Systems (NeurIPS)
- **Key contribution**: Described the three-step RLHF pipeline (supervised fine-tuning, reward model training, PPO optimization) that transformed GPT-3 into InstructGPT. A 1.3B InstructGPT model was preferred by humans over the 175B GPT-3.
- **GreenReach relevance**: RLHF is the alignment technique underlying the models E.V.I.E. and F.A.Y.E. use. Understanding this pipeline explains why the agents follow instructions, respect guardrails, and maintain helpful tone. Relevant to future fine-tuning of farm-specific behaviors.

#### Reference 16.3.3: Constitutional AI: Harmlessness from AI Feedback

- **Authors**: Bai, Y., Kadavath, S., Kundu, S., Askell, A., Kernion, J., Jones, A., Chen, A., Goldie, A., Mirhoseini, A., McKinnon, C., Chen, C., Olsson, C., Olah, C., Hernandez, D., Drain, D., Ganguli, D., Li, D., Tran-Johnson, E., Perez, E., Kerr, J., Mueller, J., Ladish, J., et al.
- **Year**: 2022
- **Venue**: arXiv preprint (arXiv:2212.08073)
- **Key contribution**: Proposed Constitutional AI (CAI) where the model self-critiques and revises outputs against a set of written principles, reducing reliance on human labelers for harmlessness training. Demonstrated that AI feedback can substitute for human feedback in alignment.
- **GreenReach relevance**: The CAI concept maps directly to F.A.Y.E.'s policy engine -- a set of non-negotiable hard boundaries (admin-ai-rules.json) that constrain autonomous behavior. The self-critique pattern could enhance future agent self-review capabilities.

#### Reference 16.3.4: Concrete Problems in AI Safety

- **Authors**: Amodei, D., Olah, C., Steinhardt, J., Christiano, P., Schulman, J., & Mane, D.
- **Year**: 2016
- **Venue**: arXiv preprint (arXiv:1606.06565)
- **Key contribution**: Catalogued five concrete safety problems in ML systems: avoiding negative side effects, avoiding reward hacking, scalable oversight, safe exploration, and robustness to distributional shift. Grounded abstract safety concerns in practical engineering challenges.
- **GreenReach relevance**: Directly maps to GreenReach agent design: (1) side effects -- F.A.Y.E. write safety rules prevent cascading actions; (2) reward hacking -- promotion metrics require diverse signal, not gaming a single metric; (3) scalable oversight -- shadow mode and decision logging; (4) safe exploration -- trust tier system with demotion; (5) distributional shift -- sensor sanity validation in ai-rules.json.

### 16.4 Governance, Ethics & Accountability

Frameworks for responsible AI deployment, documentation, and auditing.

#### Reference 16.4.1: On the Dangers of Stochastic Parrots: Can Language Models Be Too Big?

- **Authors**: Bender, E. M., Gebru, T., McMillan-Major, A., & Shmitchell, S.
- **Year**: 2021
- **Venue**: ACM Conference on Fairness, Accountability, and Transparency (FAccT)
- **Key contribution**: Argued that large language models carry environmental costs, encode biases present in training data, and generate fluent but unreliable text that can be mistaken for understanding. Called for careful documentation of training data and deployment context.
- **GreenReach relevance**: Reinforces the importance of E.V.I.E.'s "never fabricate data" guardrail and F.A.Y.E.'s "ground responses in live data" rule. LLM outputs must always be validated against actual sensor readings, not treated as ground truth.

#### Reference 16.4.2: Model Cards for Model Reporting

- **Authors**: Mitchell, M., Wu, S., Zaldivar, A., Barnes, P., Vasserman, L., Hutchinson, B., Spitzer, E., Raji, I. D., & Gebru, T.
- **Year**: 2019
- **Venue**: ACM Conference on Fairness, Accountability, and Transparency (FAccT)
- **Key contribution**: Proposed a standardized documentation framework ("model cards") for trained ML models, including intended use, performance metrics across subgroups, ethical considerations, and limitations. Became an industry standard adopted by Hugging Face, Google, and OpenAI.
- **GreenReach relevance**: Template for documenting any farm-specific models (quality grading, yield prediction, anomaly detection). F.A.Y.E.'s decision logging and E.V.I.E.'s recommendation format rules are the operational equivalent of model cards for agent outputs.

#### Reference 16.4.3: Datasheets for Datasets

- **Authors**: Gebru, T., Morgenstern, J., Vecchione, B., Vaughan, J. W., Wallach, H., Daume III, H., & Crawford, K.
- **Year**: 2021
- **Venue**: Communications of the ACM, 64(12), 86-92
- **Key contribution**: Proposed standardized documentation for datasets, covering motivation, composition, collection process, preprocessing, intended uses, distribution, and maintenance. Companion to Model Cards, focused on data provenance and quality.
- **GreenReach relevance**: Essential for documenting farm sensor datasets, harvest quality records, and market pricing data used in AI features. The experiment record standard (Rule 3.1) and lot traceability system already implement dataset documentation principles for agricultural data.

#### Reference 16.4.4: Closing the AI Accountability Gap

- **Authors**: Raji, I. D., Smart, A., White, R. N., Mitchell, M., Gebru, T., Hutchinson, B., Smith-Loud, J., Theron, D., & Barnes, P.
- **Year**: 2020
- **Venue**: ACM Conference on Fairness, Accountability, and Transparency (FAccT)
- **Key contribution**: Defined an end-to-end internal algorithmic auditing framework covering scoping, mapping, artifact collection, testing, reflection, and post-audit monitoring. Emphasized that accountability requires continuous institutional process, not one-time review.
- **GreenReach relevance**: Blueprint for auditing F.A.Y.E.'s autonomous decisions. The shadow mode, decision logging, outcome tracking, and demotion mechanisms already implement key elements of this framework. Validates the "earn trust, don't assume it" guiding principle.

### 16.5 Future Directions: Multimodal & Continual Learning

Emerging methods that point toward next-generation capabilities for farm intelligence agents.

#### Reference 16.5.1: Continual Lifelong Learning with Neural Networks: A Review

- **Authors**: Parisi, G. I., Kemker, R., Part, J. L., Kanan, C., & Wermter, S.
- **Year**: 2019
- **Venue**: Neural Networks, 113, 54-71
- **Key contribution**: Comprehensive survey of continual learning approaches addressing catastrophic forgetting -- the tendency of neural networks to lose previously learned knowledge when trained on new tasks. Reviewed replay methods, regularization approaches, and dynamic architectures.
- **GreenReach relevance**: Core challenge for farm AI that must adapt to seasonal changes, new crop varieties, and evolving market conditions without losing established knowledge. Directly relevant to F.A.Y.E.'s learning engine and knowledge base persistence.

#### Reference 16.5.2: Learning Transferable Visual Models From Natural Language Supervision (CLIP)

- **Authors**: Radford, A., Kim, J. W., Hallacy, C., Ramesh, A., Goh, G., Agarwal, S., Sastry, G., Askell, A., Mishkin, P., Clark, J., Krueger, G., & Sutskever, I.
- **Year**: 2021
- **Venue**: International Conference on Machine Learning (ICML)
- **Key contribution**: Trained a vision-language model on 400M image-text pairs using contrastive learning, enabling zero-shot image classification by matching images to natural language descriptions. CLIP transfers to new visual tasks without task-specific training data.
- **GreenReach relevance**: Enables future E.V.I.E. capability to classify plant conditions from photos using natural language descriptions ("yellowing leaves on basil," "root rot in lettuce") without training a custom classifier for each condition. Foundation for the image upload analysis feature.

#### Reference 16.5.3: Flamingo: A Visual Language Model for Few-Shot Learning

- **Authors**: Alayrac, J.-B., Donahue, J., Luc, P., Miech, A., Barr, I., Hasson, Y., Lenc, K., Mensch, A., Millican, K., Reynolds, M., Ring, R., Rutherford, E., Cabi, S., Han, T., Gong, Z., Samangooei, S., Marinier, R., Mourad, H., Borber, J., Sherber, J., Adler, A., et al.
- **Year**: 2022
- **Venue**: Advances in Neural Information Processing Systems (NeurIPS)
- **Key contribution**: Built a visual language model that interleaves text and image inputs, achieving state-of-the-art few-shot performance on visual question answering, captioning, and classification. Demonstrated that a frozen language model can be augmented with visual perception through cross-attention layers.
- **GreenReach relevance**: Architecture prototype for a future E.V.I.E. that can reason over mixed inputs -- sensor charts, crop photos, and grower questions in a single conversation turn. The interleaved text-image pattern matches the farm assistant use case.

#### Reference 16.5.4: BLIP-2: Bootstrapping Language-Image Pre-training

- **Authors**: Li, J., Li, D., Savarese, S., & Hoi, S.
- **Year**: 2023
- **Venue**: International Conference on Machine Learning (ICML)
- **Key contribution**: Introduced a lightweight Querying Transformer (Q-Former) that bridges frozen image encoders and frozen LLMs, achieving strong vision-language performance with minimal trainable parameters. Demonstrated that efficient bridging architecture can leverage existing foundation models without end-to-end retraining.
- **GreenReach relevance**: Most directly applicable architecture for adding visual understanding to E.V.I.E. -- a lightweight bridge between an image encoder (for crop photos) and the existing LLM backend, without requiring expensive full-model training. Cost-effective path to multimodal farm intelligence.

### Quick-Reference Sources Table

| # | Short Name | Authors | Year | Venue | Domain |
|---|-----------|---------|------|-------|--------|
| 16.1.1 | ResNet | He et al. | 2016 | CVPR | Architecture |
| 16.1.2 | Transformer | Vaswani et al. | 2017 | NeurIPS | Architecture |
| 16.1.3 | DQN | Mnih et al. | 2015 | Nature | Architecture |
| 16.1.4 | DDPM | Ho et al. | 2020 | NeurIPS | Architecture |
| 16.2.1 | Scaling Laws | Kaplan et al. | 2020 | arXiv | Scaling |
| 16.2.2 | Chinchilla | Hoffmann et al. | 2022 | NeurIPS | Scaling |
| 16.2.3 | GPT-3 | Brown et al. | 2020 | NeurIPS | Scaling |
| 16.2.4 | Foundation Models | Bommasani et al. | 2021 | arXiv | Scaling |
| 16.3.1 | FGSM / Adversarial | Goodfellow et al. | 2015 | ICLR | Safety |
| 16.3.2 | InstructGPT / RLHF | Ouyang et al. | 2022 | NeurIPS | Alignment |
| 16.3.3 | Constitutional AI | Bai et al. | 2022 | arXiv | Alignment |
| 16.3.4 | Concrete Safety | Amodei et al. | 2016 | arXiv | Safety |
| 16.4.1 | Stochastic Parrots | Bender et al. | 2021 | FAccT | Governance |
| 16.4.2 | Model Cards | Mitchell et al. | 2019 | FAccT | Governance |
| 16.4.3 | Datasheets | Gebru et al. | 2021 | CACM | Governance |
| 16.4.4 | Accountability Gap | Raji et al. | 2020 | FAccT | Governance |
| 16.5.1 | Continual Learning | Parisi et al. | 2019 | Neural Networks | Future |
| 16.5.2 | CLIP | Radford et al. | 2021 | ICML | Future |
| 16.5.3 | Flamingo | Alayrac et al. | 2022 | NeurIPS | Future |
| 16.5.4 | BLIP-2 | Li et al. | 2023 | ICML | Future |

### Rule 16.1: Literature-Informed Agent Development

- All new AI/ML features MUST reference at least one paper from Section 16 in their design rationale.
- Safety-critical features (autonomy tier promotion, sensor validation, write actions) MUST cite relevant papers from 16.3 (Safety & Alignment).
- Any future computer vision or multimodal feature MUST review papers from 16.1 and 16.5 before implementation.
- Governance decisions (logging, auditing, documentation) SHOULD follow frameworks from 16.4.

## Appendix: Integration with Agent Skills Framework

This document extends `AGENT_SKILLS_FRAMEWORK.md` with AI/ML-specific rules. The following sections of the parent framework are complemented:

| Framework Section | This Document Extends |
|------------------|----------------------|
| §Core Programming Themes | Rule 1.x (Scientific Instrument philosophy) |
| §GreenReach Ecosystem | Rule 2.x (Central-First architecture) |
| §Data Format Governance | Rule 3.x (Experiment Record Standard) |
| §ML/AI Systems & Network Learning | Rules 4-7 (Feedback loops, workflow, modifiers, network) |
| §Multi-Agent Collaboration | Rules 8, 12, 13 (Safety, checklists, rejection criteria) |
| §Agent Selection Criteria | Rule 11 (Required skills for AI work) |

**Conflict resolution**: When this document conflicts with `AGENT_SKILLS_FRAMEWORK.md`, the MORE RESTRICTIVE rule applies.

---

*"Each Light Engine is a scientific instrument. Every harvest is an experiment. Every farm contributes to the network. Central is the mother ship. This version is advanced training."*
