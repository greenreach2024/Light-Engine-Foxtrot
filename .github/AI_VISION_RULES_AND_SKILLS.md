# AI Vision: Agent Rules & Skills

**Version**: 1.0.0  
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
Phase 1 → Phase 2: All P0 data captured + Central receiving experiment records
Phase 2 → Phase 3: Workflow reduced to ≤4 steps + Central providing benchmarks
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
| Weight reconciliation | `lib/crop-weight-reconciliation.js` | Harvest weight + environment snapshots |
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

### Architecture Agent MUST auto-reject if:

1. **Central treated as passive** — Proposal defers Central to "later" or treats it as optional (Rule 1.5)
2. **Base recipe modification** — Proposal modifies universal recipes instead of using modifiers (Rule 6.1)
3. **Duplicate endpoint** — Creates new analytics endpoint alongside existing stubs (Rule 2.4)
4. **P0 data not captured yet** — Proposes P2 or P3 features while P0 data collection is incomplete (Rule 9.1)
5. **No scientific mode** — Feature doesn't serve OBSERVE, EXPERIMENT, or LEARN (Rule 1.3)

---

## 14. Quick Reference: 52 Opportunities

### Phase 1 — Wire the Data + Central Benchmarks (12 tasks)

| # | Task | Owner | Effort |
|---|------|-------|--------|
| 1 | Persist recipe parameters applied per day | Farm | S |
| 2 | Build harvest outcome "experiment record" | Farm | M |
| 3 | POST experiment records to Central on harvest | Farm | S |
| 4 | Wire loss events → environment correlation | Farm | S |
| 5 | Feed real demand into crop recommendation | Farm | S |
| 6 | Surface learning correlations on dashboard | Farm | S |
| 7 | Ingest experiment records endpoint | Central | S |
| 8 | Nightly crop benchmark aggregation job | Central | M |
| 9 | Push crop benchmarks in AI recommendation channel | Central | S |
| 10 | Extend AI training export with recipe params | Farm | S |
| 11 | Populate comparative analytics endpoint | Central | M |
| 12 | Populate leaderboard with real scores | Central | S |

### Phase 2 — Workflow Automation + Central Intelligence (12 tasks)

| # | Task | Owner | Effort |
|---|------|-------|--------|
| 13 | Auto-derive plant count from tray format | Farm | S |
| 14 | AI pre-fill crop at seeding + Central demand signals | Farm | S |
| 15 | Combine seed + group assignment | Farm | M |
| 16 | Auto-trigger label print on harvest | Farm | S |
| 17 | Auto-derive photoperiod from recipe | Farm | S |
| 18 | Remove duplicate seed date entry | Farm | S |
| 19 | Auto-discover lights from controller | Farm | M |
| 20 | Demand signal aggregation + push to farms | Central | M |
| 21 | New farm onboarding with network benchmarks | Central | S |
| 22 | Environmental benchmark push | Central | S |
| 23 | Populate network trends endpoint | Central | M |
| 24 | Buyer behavior analysis + churn detection | Central | M |

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
