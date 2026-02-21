# Light Engine AI Vision Report

**Date:** February 2026
**Version:** Foxtrot (recovery/feb11-clean)
**Philosophy:** *Each Light Engine is a scientific instrument — studying, learning, and improving. With proper training, future versions will be completely AI. This version is advanced training.*

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current AI Maturity Assessment](#2-current-ai-maturity-assessment)
3. [The Scientific Instrument Architecture](#3-the-scientific-instrument-architecture)
4. [GreenReach Central: The Mother Ship](#4-greenreach-central-the-mother-ship)
5. [AI Opportunity Map](#5-ai-opportunity-map)
   - 5.1 [Eliminate User Steps](#51-eliminate-user-steps)
   - 5.2 [Combine Multi-Function Steps](#52-combine-multi-function-steps)
   - 5.3 [Adaptive Growing Intelligence](#53-adaptive-growing-intelligence)
   - 5.4 [Cross-Farm Learning Network](#54-cross-farm-learning-network)
   - 5.5 [Predictive Risk Reduction](#55-predictive-risk-reduction)
   - 5.6 [Quality & Yield Optimization](#56-quality--yield-optimization)
   - 5.7 [Market & Demand Intelligence](#57-market--demand-intelligence)
6. [The Feedback Loop: Closing the Learning Gap](#6-the-feedback-loop-closing-the-learning-gap)
7. [Data Already Collected But Not Used](#7-data-already-collected-but-not-used)
8. [Implementation Roadmap](#8-implementation-roadmap)
9. [Network Intelligence Architecture](#9-network-intelligence-architecture)
10. [Training Data Strategy](#10-training-data-strategy)
11. [Risk & Guardrails](#11-risk--guardrails)

---

## 1. Executive Summary

Light Engine Foxtrot has built significant AI infrastructure — an anomaly detection pipeline (IsolationForest), environmental forecasting (SARIMAX), a GPT-4o vision system, a natural language agent, and a 6-factor crop recommendation engine. **However, almost none of these systems learn from outcomes.** The system collects rich data (sensor readings, harvest weights, environmental snapshots, spectrum correlations) but never closes the feedback loop to improve future decisions.

The central opportunity: **connect outcomes to inputs.** Every harvest, every weigh-in, every loss event, every buyer rating is a training signal. The system already captures 80% of the data needed — it just doesn't use it.

**GreenReach Central is the mother ship.** Individual farms are scientific instruments — Central is the brain that coordinates them. A single farm might harvest basil 10 times per year. The network harvests basil 500 times. Central reaches ML-viable data volumes years before any individual farm does. The intelligence architecture must be Central-first: farms collect and contribute data, Central analyzes and pushes insights back. Central should be the active intelligence hub from Phase 1 — not deferred to Phase 4. The 5-minute sync pipeline and the 30-minute AI recommendation push channel already exist. The pipe is built. It just needs intelligence flowing through it.

### Key Numbers

| Metric | Current | Opportunity |
|--------|---------|-------------|
| AI/ML modules | 17 identified | 17 (all can learn) |
| Modules that learn from outcomes | 1 (SARIMAX re-fits) | All 17 |
| Lighting recipes | 50 crops, ~150 day-entries each | Recipes should evolve per farm |
| Data fields per harvest weigh-in | 16 (incl. environment) | 16 collected, 0 used for optimization |
| Cross-farm analytics endpoints | 9 endpoints | 7 are stubs returning empty data |
| User steps: seed → harvest | 6-8 manual actions | Target: 2-3 (scan + confirm) |
| Duplicate data entry points | 3 (seed date, crop, location) | 0 |
| Workflow steps doing single duty | Most | Target: every step serves ≥2 functions |

---

## 2. Current AI Maturity Assessment

### What's Working (Production)

| System | Intelligence Type | Learns? |
|--------|------------------|---------|
| IsolationForest anomaly detection | Unsupervised ML | No — static contamination threshold |
| SARIMAX environmental forecasting | Time-series ML | Yes — re-fits per call |
| GPT-4o-mini AI agent | LLM (natural language) | No — read-only, no fine-tuning |
| GPT-4o-mini plant vision | LLM (computer vision) | No — static prompts |
| Crop recommendation engine | Rules engine (6 factors) | No — deterministic scoring |
| Anomaly diagnostics | Rule cascade | No — hardcoded thresholds |
| Outdoor-aware adaptive control (Tier 1) | Rule-based | No — fixed rules |
| Spectral solver | Mathematical (NNLS) | No — fixed mixing matrix |
| Harvest predictor | Statistical (baseline + variance) | Minimal — rolling variance only |
| Weight reconciliation benchmarks | Statistical (rolling average) | Minimal — no correlation analysis |
| Automation engine | Rule-triggered actions | No — does not learn from outcomes |

### What's Stubbed (Needs Activation)

| System | Intended Intelligence | Blocker |
|--------|----------------------|---------|
| ML training pipeline | Prophet (demand), LSTM (crop sequencing) | Requires 500+ decisions, 100+ cycles |
| Adaptive control Tier 2 | Historical pattern regression | Not implemented |
| Adaptive control Tier 3 | Neural network multi-objective optimization | Not implemented |
| Harvest prediction API | ML-based harvest date prediction | Returns empty |
| Market intelligence | Live market pricing & trends | Static hardcoded data |
| Cross-farm comparative analytics | Network benchmarking | 7 endpoints return `[]` |
| Leaderboard | Farm performance ranking | All farms score 0 |

### What's Collecting Data With No Consumer

| Data Source | Storage | Potential |
|-------------|---------|-----------|
| Weight + environment snapshots | crop-weight-reconciliation records | Yield optimization models |
| Learning correlations (PPFD↔Blue, Temp↔RH, Duty↔Energy) | preAutomationLogger JSONL | Feed Tier 2/3 adaptive control |
| Loss event patterns (reason, crop, zone) | Tray run NeDB | Root cause analysis |
| BME680 gas resistance (VOC) | ESP32 sensor readings | Air quality anomaly detection |
| Wholesale order history | Orders DB | Demand forecasting |
| Cross-farm weight benchmarks | GreenReach Central aggregation | Network yield optimization |
| Anomaly false positive history | anomaly-history.js | IsolationForest threshold tuning |

---

## 3. The Scientific Instrument Architecture

Each Light Engine should function as a scientific instrument with three modes running simultaneously:

```
┌─────────────────────────────────────────────────────────────────┐
│                    LIGHT ENGINE: SCIENTIFIC MODE                 │
│                                                                 │
│  ┌─────────────┐   ┌──────────────┐   ┌─────────────────────┐  │
│  │  OBSERVE     │   │  EXPERIMENT  │   │  LEARN              │  │
│  │              │   │              │   │                     │  │
│  │ Sensors      │──▸│ Adaptive     │──▸│ Outcome             │  │
│  │ Weights      │   │ Recipes      │   │ Correlation         │  │
│  │ Growth Rate  │   │ Environment  │   │                     │  │
│  │ Quality      │   │ Spectrum Mix │   │ Recipe → Yield      │  │
│  │ Loss Events  │   │ Timing       │   │ Spectrum → Quality  │  │
│  │ Energy Use   │   │              │   │ Environment → Loss  │  │
│  │ Demand       │   │              │   │ Timing → Weight     │  │
│  └──────┬───────┘   └──────────────┘   └──────────┬──────────┘  │
│         │                                         │             │
│         │           ┌──────────────┐               │             │
│         └──────────▸│  CONTRIBUTE  │◂──────────────┘             │
│                     │              │                             │
│                     │ → Central    │                             │
│                     │ → Network    │                             │
│                     │ → All Farms  │                             │
│                     └──────────────┘                             │
└─────────────────────────────────────────────────────────────────┘
```

### What Makes It Scientific

1. **Every grow cycle is an experiment.** The system records: crop, recipe, environment achieved (not just target), spectrum applied, grow duration, final weight, quality score, loss events. This is the experiment record.

2. **Variables are tracked.** The independent variables (recipe parameters, spectrum, environment targets) are recorded alongside the dependent variables (yield, quality, loss rate, grow time). The system already captures these — just never connects them.

3. **Hypotheses are tested.** When the AI suggests a recipe adjustment (↑ blue 5% for denser basil), the next cycle's outcome validates or rejects that hypothesis.

4. **Results are shared.** Via GreenReach Central, each farm's experiment results improve the network's collective knowledge.

---

## 4. GreenReach Central: The Mother Ship

Central is not a passive data warehouse. It is the **network intelligence engine** — the brain that makes every Light Engine smarter than it could be alone.

### Why Central-First

| Factor | Individual Farm | Central (Network) |
|--------|----------------|-------------------|
| Basil harvests per year | ~10-20 | 500+ (across all farms) |
| Data points to find optimal temp | Needs 2+ years | Has enough in weeks |
| Pest/disease detection | After it hits your farm | Before it reaches you |
| Demand forecasting accuracy | One buyer's order history | All buyers, all regions |
| Recipe optimization confidence | Low (small sample) | High (large sample + multi-farm) |
| New farm onboarding | Starts from zero | Starts from network knowledge |

**The critical insight:** ML models need hundreds of training examples to be useful. An individual farm might never reach that threshold for rare crops or unusual conditions. But the network reaches it quickly. Central should be where intelligence lives first, with farm-level learning as a secondary refinement layer.

### Central's Role Per Phase

```
Phase 1:  CENTRAL = Data Warehouse + Basic Benchmarks
          Receive experiment records → compute crop averages → push comparisons

Phase 2:  CENTRAL = Intelligence Provider
          Network-aware crop recommendations → recipe suggestions → demand signals

Phase 3:  CENTRAL = Learning Engine
          Cross-farm ML models → recipe modifiers → anomaly correlation

Phase 4:  CENTRAL = Network Coordinator
          Supply/demand optimization → harvest scheduling → A/B test assignment

Phase 5:  CENTRAL = Autonomous Orchestrator
          Network-wide production planning → dynamic recipe distribution → market coordination
```

### What Central Already Has (Infrastructure Ready)

| Infrastructure | Status | Location |
|---------------|--------|----------|
| **5-minute farm data sync** | OPERATIONAL | `syncFarmData()` — pulls groups, rooms, telemetry, inventory, config |
| **PostgreSQL farm_data table** | OPERATIONAL | Stores synced data as JSONB per farm per data type |
| **30-minute AI push channel** | OPERATIONAL | `analyzeAndPushToAllFarms()` → `POST /api/health/ai-recommendations` |
| **Wholesale inventory aggregation** | OPERATIONAL | `wholesaleNetworkAggregator.js` — 5-min refresh, cross-farm SKU rollup |
| **Weight data aggregation** | OPERATIONAL | `/api/crop-weights/network-analytics` — on-demand cross-farm weight stats |
| **Farm heartbeat monitoring** | OPERATIONAL | CPU/mem/disk/uptime per farm, auto-registration |
| **Comparative analytics endpoints** | 7 STUBS | `network-growers.js` — all return empty `[]` or score `0` |
| **Leaderboard** | STUB | All farms score 0 |
| **Network trends** | STUB | Returns `{ networkGrowth: [] }` |

### What Central Needs (Per Phase)

#### Phase 1 — Central as Data Warehouse

| Task | What It Does | Existing Pipe |
|------|-------------|---------------|
| **Ingest experiment records** | Farms POST harvest outcomes to Central on each harvest | New endpoint: `POST /api/sync/experiment-records` |
| **Compute crop benchmarks nightly** | Scheduled job: aggregate weight/plant, grow days, loss rate per crop | Extend existing `syncFarmData()` cron |
| **Push simple comparisons** | Include "your basil: 2.34 oz, network avg: 2.51 oz" in AI recommendations | Extend existing `analyzeAndPushToAllFarms()` |
| **Store training data centrally** | Central becomes the canonical training dataset across all farms | Extend `farm_data` table with `experiment_records` type |

#### Phase 2 — Central as Intelligence Provider

| Task | What It Does | Existing Pipe |
|------|-------------|---------------|
| **Network-aware crop recommendations** | "Kale demand up 30% in your region" pushed alongside AI recs | Extend AI push payload |
| **Starter recipe suggestions for new farms** | New farm gets "best known recipe modifiers" from network on registration | Extend farm registration response |
| **Demand signal aggregation** | Aggregate buyer search + order patterns → planting signals per region | New scheduled job on Central |
| **Environmental benchmark push** | "Network optimal temp for basil: 22°C. You're running 24°C." | Extend AI push payload |

#### Phase 3 — Central as Learning Engine

| Task | What It Does | Existing Pipe |
|------|-------------|---------------|
| **Cross-farm yield regression** | Train `weight/plant ~ f(spectrum, temp, humidity, grow_days)` on ALL farms' data | New ML job (Python) on Central |
| **Network recipe modifiers** | Compute crop-level recipe offsets from regression results | New: `network-recipe-modifiers.json` per crop |
| **Cross-farm anomaly correlation** | "3 farms with SwitchBot Hub v3.2 showing sensor dropout" | Aggregate anomaly-history across farms |
| **Loss pattern network alerts** | "Lettuce pest reports increasing in NE region this week" | Aggregate loss events, push alerts |

#### Phase 4 — Central as Network Coordinator

| Task | What It Does | Existing Pipe |
|------|-------------|---------------|
| **Harvest schedule coordination** | Prevent 5 farms flooding market with romaine same week | New: query all farms' group seed dates → predict harvest overlap |
| **Supply/demand balancing** | "Network needs 200 cases kale next month, current trajectory: 150. 3 farms should expand." | Aggregate demand forecast + harvest predictions |
| **A/B test orchestration** | Assign spectrum experiments across farms for controlled testing | New: Central assigns, farms report |
| **Quality-based routing** | Route buyer orders to farms with highest quality scores for that crop | Extend wholesale network aggregator |

#### Phase 5 — Central as Autonomous Orchestrator

| Task | What It Does |
|------|-------------|
| **Network production planning** | Central generates recommended seeding plans per farm per week |
| **Dynamic recipe distribution** | Central publishes evolved recipes, farms auto-adopt |
| **Market intelligence integration** | Real-time pricing feeds → planting signal adjustments |
| **Autonomous wholesale** | Central matches supply to demand across farms without human intervention |

---

## 5. AI Opportunity Map

### 5.1 Eliminate User Steps

**Current: 6-8 manual actions from seed to harvest. Target: 2-3.**

| Current Step | AI Replacement | How |
|--------------|---------------|-----|
| Select crop at seeding | **AI recommends** based on zone history, season, demand, succession plan | Crop recommendation engine already scores 6 factors — wire to seeding UI as default |
| Enter seed source | **Auto-fill** from last-used supplier for this crop | Track supplier per crop in NeDB |
| Enter plant count | **Auto-derive** from tray format cell count | Tray format → cell count mapping already exists |
| Assign seed date in group config | **Eliminate** — seed date already set during seeding | Remove duplicate entry, sync from tray seed event |
| Select recipe in group config | **AI assigns** from crop selection at seeding | Recipe is deterministic from crop name — auto-resolve |
| Configure schedule (photoperiod) | **Auto-derive** from recipe DLI + PPFD targets | `photoperiod_hrs = DLI / (PPFD × 3600) × 1e6` — already calculable |
| Manually assign lights to group | **Auto-discover** from controller topology | Controller API returns device lists — auto-assign by zone |
| Print label separately | **Auto-trigger** on harvest scan | Print action fires when harvest event is recorded |

**Result:** Grower scans a tray, confirms AI-recommended crop, scans the group location. Everything else is automatic.

### 5.2 Combine Multi-Function Steps

**"When possible, steps should have multiple functions."**

| Combined Action | Functions Served |
|-----------------|-----------------|
| **Seed Scan** (scan tray QR at seeding) | 1. Register tray run 2. Assign crop 3. Set seed date 4. Auto-assign to group 5. Print tray label 6. Start succession clock 7. Begin AI monitoring |
| **Harvest Scan** (scan tray QR at harvest) | 1. Record harvest event 2. Generate lot code 3. Create traceability record 4. Add to wholesale inventory 5. Print harvest label 6. Flag for weigh-in 7. Record grow-days for AI training 8. Trigger AI quality check (camera) |
| **Weigh-In Scan** (place tray on scale) | 1. Record weight 2. Snapshot environment 3. Update crop benchmark 4. Train yield model 5. Calculate variance 6. Update wholesale lot weight 7. Contribute to network benchmark |
| **Quick Move Scan** (scan tray → scan group) | 1. Update tray location 2. Assign group 3. Apply recipe 4. Start grow timer 5. Update capacity tracking 6. Log placement for analytics |

### 5.3 Adaptive Growing Intelligence

**"Each Light Engine should adapt to farm-to-farm variables."**

#### 5.3.1 Recipe Evolution

The 50 lighting recipes are static curves — same parameters on day 14 regardless of whether the plant is thriving or struggling. The system should:

1. **Observe**: On every weigh-in, record the full recipe trajectory (spectrum/ppfd/temp/humidity per day) that the group experienced, alongside the outcome (weight/plant, quality score, grow days).

2. **Correlate**: After 10+ cycles of a crop, compute: "When basil got 5% more blue light during days 7-14 at this farm, yield was 12% higher." The learning correlations infrastructure (`PPFD↔Blue`, `Temp↔RH`) already computes these — they just log to JSONL instead of feeding back.

3. **Adjust**: Introduce "recipe modifiers" — farm-specific offsets applied on top of the base recipe. Start conservative (±5% per parameter), expand as confidence grows. The adaptive control Tier 2/3 stubs are designed for exactly this.

4. **Validate**: Track whether the modified recipe outperforms baseline. If not, revert. This is the hypothesis-test cycle.

**Implementation leverage**: The spectral solver already handles arbitrary spectrum targets. The daily plan resolver already interpolates day-by-day. Adding a `farm_modifier` layer between the recipe and the solver is architecturally clean — one lookup table per crop per farm.

#### 5.3.2 Environmental Adaptation

Each farm has unique characteristics — building insulation, HVAC capacity, local climate, altitude, water quality. The system should learn these:

| Variable | Current | AI Opportunity |
|----------|---------|---------------|
| Thermal mass | Unknown | Learn from outdoor temp → indoor response lag (data exists in env.json history) |
| HVAC capacity | Unknown | Learn from duty cycle at temperature extremes (duty↔energy correlation exists) |
| Humidity baseline | Unknown | Learn from dehumidifier effectiveness by season |
| Light uniformity | Unknown | Compare PPFD setpoint vs sensor readings across zones |
| Water quality | Manual EC/pH | Learn baseline EC/pH per water source, detect drift |
| Growing medium | Configured once | Track root zone conditions → yield correlation per medium type |

#### 5.3.3 Spectrum Intelligence

The 3×4 mixing matrix in the spectral solver uses fixed coefficients. In reality, LED degradation, ambient light, and canopy absorption all shift the actual spectrum delivered. The system should:

1. Use PPFD sensor readings to validate delivered vs. target light levels
2. Track LED aging per fixture (declining efficiency over hours)
3. Adjust channel intensities to compensate for degradation
4. Correlate spectrum mix with quality outcomes (color, density, flavor indicators)
5. Test spectrum variations across groups growing the same crop in the same room — controlled experiment within a single farm

### 5.4 Cross-Farm Learning Network

**"Each farm should contribute to the learning for all Light Engine systems."**

#### Current State

GreenReach Central has a hub-and-spoke architecture. Every 5 minutes, it syncs: groups, rooms, schedules, inventory, telemetry, and config from registered farms. It also aggregates wholesale inventory across the network for buyer checkout. But **7 of 9 cross-farm analytics endpoints are stubs returning empty data.**

#### Network Intelligence Opportunities

| Intelligence | Data Source (Already Exists) | Network Value |
|-------------|------------------------------|---------------|
| **Yield benchmarks** | Weight reconciliation records (16 fields each) | "Your basil yields 15% below network avg. Farm B gets 23% more using 5% higher blue." |
| **Recipe effectiveness** | Harvest outcomes + recipe parameters | "This Genovese Basil recipe variant outperforms baseline in 8 of 12 farms." |
| **Loss pattern alerts** | Loss events (reason, crop, zone) | "3 farms reported aphid issues on lettuce this week in your region." |
| **Environmental optima** | Sensor data × yield outcomes | "Farms achieving >95th percentile basil yield maintain 22±0.5°C, not 24°C." |
| **Demand signals** | Wholesale order history aggregated | "Kale demand in NE region up 30% vs last month. Recommend expanding." |
| **Spectrum optimization** | Cross-farm experiment results | "Farm C tried 35% blue (vs standard 30%) for Buttercrunch — 18% better density." |
| **Seasonal patterns** | Multi-year sensor + yield data | "March indoor growing across network shows 8% yield drop — adjust expectations." |
| **Equipment reliability** | Anomaly detection events | "SwitchBot Hub firmware v3.2 correlates with 3× sensor dropout rate." |
| **Energy benchmarks** | Duty cycle × energy × yield | "Your kWh/kg for lettuce is 40% above network — check HVAC efficiency." |

#### Network Learning Architecture

```
Farm A ──[experiment results]──▸ ┌────────────────────────────┐
Farm B ──[experiment results]──▸ │    GREENREACH CENTRAL      │
Farm C ──[experiment results]──▸ │                            │
                                 │  Aggregate → Analyze →     │
                                 │  Rank → Recommend          │
                                 │                            │
Farm A ◂──[network insights]──── │  Push: recipe modifiers,   │
Farm B ◂──[network insights]──── │  benchmarks, alerts,       │
Farm C ◂──[network insights]──── │  demand signals            │
                                 └────────────────────────────┘
```

**What to share** (privacy-safe): Crop-level aggregated metrics (avg yield, spectrum used, environment achieved, grow days). Never share: customer data, pricing, farm identity in benchmarks.

**Push mechanism already exists**: `POST /api/health/ai-recommendations` pushes GPT-analyzed recommendations every 30 minutes. Extend this to push network intelligence alongside AI recommendations.

### 5.5 Predictive Risk Reduction

**"Reduce risk."**

| Risk | Prediction | Data Source | Action |
|------|-----------|-------------|--------|
| **Crop loss** | "Group 12 has 40% loss probability in next 48h" | Anomaly detection + loss history + environment trends | Alert + suggest intervention (adjust temp, increase airflow) |
| **Equipment failure** | "Light controller 3 showing declining duty cycle efficiency" | Duty↔Energy correlation trending | Maintenance alert before failure |
| **Harvest miss** | "Basil Group 5 will be 3 days late vs. planned" | Growth rate tracking + historical variance | Adjust delivery commitments, notify buyers |
| **Quality degradation** | "Color quality declining — possible nutrient deficiency" | AI vision checkpoint trend + leaf color analysis | Suggest EC/pH adjustment |
| **Supply surplus** | "5 farms harvesting romaine this week — price pressure likely" | Network harvest schedule aggregation | Suggest holding or redirecting to different buyer channel |
| **Pest/disease spread** | "Farm in your region reported powdery mildew on basil" | Network loss event sharing | Preventive measures before it arrives |
| **Energy cost spike** | "Peak pricing window 2-6pm — shifting to maintenance lighting" | TOU rate schedule + adaptive control | Automated schedule adjustment |
| **Buyer churn** | "Buyer X hasn't ordered in 3 weeks — previous pattern: weekly" | Order history analysis | Proactive outreach suggestion |

### 5.6 Quality & Yield Optimization

**"Improve quality of produce."**

#### The Missing Feedback Loop

This is the single most impactful AI opportunity. The data exists. The connection doesn't.

```
Current:                          Target:
Recipe → Grow → Harvest           Recipe → Grow → Harvest
   ↓                                 ↓                ↓
 (end)                             Environment     Weight + Quality
                                   Snapshot             ↓
                                      ↓           Outcome Record
                                      ↓                ↓
                                      └────────────────┘
                                              ↓
                                    Recipe Modifier Update
                                              ↓
                                    Next Cycle: Improved Recipe
```

**What needs to happen:**

1. **Harvest event** → capture `{ recipe_id, day_entries_applied[], environment_achieved[], weight_per_plant, quality_score, loss_rate, grow_days }`

2. **Correlation engine** → after N harvests of same crop: regress `weight_per_plant ~ f(blue%, red%, ppfd, temp, humidity, grow_days, season)`

3. **Recipe modifier** → generate farm-specific offset: `{ blue: +3%, temp: -1°C, ppfd: +15 }` with confidence interval

4. **A/B testing** → when growing same crop in 2+ groups, apply modifier to one, baseline to other

5. **Network sharing** → publish anonymized `{ crop, modifier, outcome_delta }` to Central

#### AI Training Export Enhancement

The existing `/api/crop-weights/ai-training-export` endpoint exports 16 fields per weigh-in. It should be extended to include:

| Current (16 fields) | Add |
|---------------------|-----|
| crop_name, recipe_id, system_type, tray_format | **recipe_blue_avg, recipe_red_avg, recipe_ppfd_avg** (avg over grow cycle) |
| planted_site_count, total_weight_oz, weight_per_plant_oz | **loss_count, loss_rate** |
| grow_days, zone, room | **season, grow_start_month** |
| temp_f, humidity_pct, co2_ppm, light_hours | **vpd_avg, ec_avg, ph_avg** (from recipe targets) |
| variance_pct, recorded_at | **quality_score** (from AI vision if available) |

### 5.7 Market & Demand Intelligence

**"Identifying sales trends."**

#### Current State
- Market intelligence endpoint has **static hardcoded data** for 6 crops
- Wholesale order history exists but isn't analyzed for trends
- Crop recommendation engine uses demand as one factor (25% weight) but relies on heuristic fallback

#### AI Opportunities

| Intelligence | Implementation |
|-------------|----------------|
| **Demand forecasting** | ARIMA/Prophet on wholesale order history per crop per buyer per season |
| **Price optimization** | Dynamic pricing based on: supply (network inventory), demand (order velocity), seasonality, quality tier |
| **Buyer behavior prediction** | Cluster buyers by ordering patterns → predict churn, upsell potential |
| **Succession planning** | AI succession planner already exists (`lib/succession-planner.js`) — feed it real demand forecasts instead of heuristics |
| **Network supply coordination** | Prevent market flooding: if 4 farms growing romaine, suggest 2 switch to higher-demand crop |
| **Regional trends** | Aggregate network demand by geography → push "kale trending in NE" signals |

---

## 6. The Feedback Loop: Closing the Learning Gap

The fundamental architectural change needed: **every outcome must flow back to improve the next decision.**

### Current Architecture (Open Loop)

```
Configuration → Execution → Outcome → (stored but ignored)
```

### Target Architecture (Closed Loop)

```
Configuration → Execution → Outcome → Analysis → Modifier → Configuration
                                         ↓
                                    Network Share → Other Farms
```

### Five Feedback Loops to Close

#### Loop 1: Recipe → Yield
- **Signal**: Harvest weight per plant
- **Input adjustable**: Spectrum mix, PPFD, temperature, photoperiod
- **Mechanism**: Per-crop regression after 10+ harvests → recipe modifier
- **Network effect**: Cross-farm regression with farm-specific intercept

#### Loop 2: Environment → Loss
- **Signal**: Loss events (reason, quantity, timing)
- **Input adjustable**: Temperature setpoint, humidity control, airflow
- **Mechanism**: Correlate loss spikes with environmental deviations preceding them
- **Network effect**: "Lettuce loss rate doubles when temp variance exceeds 2°C/hr across 15 farms"

#### Loop 3: Spectrum → Quality
- **Signal**: AI vision quality score, buyer ratings, returns
- **Input adjustable**: Blue/red/green ratio, far-red percentage
- **Mechanism**: Correlate spectrum with color quality, density, visual health score
- **Network effect**: "Far-red >5% improves stem elongation for transplant basil across 8 farms"

#### Loop 4: Timing → Efficiency
- **Signal**: Actual grow days vs. predicted, energy consumed per kg
- **Input adjustable**: DLI targets, temperature day/night differential
- **Mechanism**: Optimize for energy-efficient growth (not just fastest)
- **Network effect**: "20-hour photoperiods reduce grow time 10% but increase energy 25% — 16-hour optimal"

#### Loop 5: Demand → Production
- **Signal**: Wholesale orders, buyer search behavior, unfulfilled demand
- **Input adjustable**: What crops to plant, how many trays, when to seed
- **Mechanism**: Demand forecast → succession planner → seeding recommendations
- **Network effect**: Coordinate supply across farms to match aggregate demand without oversupply

---

## 7. Data Already Collected But Not Used

This is the most actionable section. **No new sensors or infrastructure needed** — just connect existing data to new consumers.

| # | Data | Where It Lives | What It Could Do |
|---|------|----------------|------------------|
| 1 | **Environment snapshots with every weigh-in** (temp, humidity, CO2, light hours) | `crop-weight-reconciliation.js` records | **Yield optimization model** — correlate environment achieved → weight/plant. This is the #1 ML opportunity. |
| 2 | **Learning correlations** (PPFD↔Blue, Temp↔RH, Duty↔Energy) | `preAutomationLogger` JSONL files | **Feed Tier 2/3 adaptive control** — stop logging and start acting. PPFD↔Blue degradation = LED aging alert. |
| 3 | **Loss events with crop + zone + reason** | Tray run NeDB records | **Root cause analysis** — environment × loss correlation. "Zone 3 lettuce losses 3× higher than Zone 1 — temp variance 40% wider." |
| 4 | **BME680 gas resistance (VOC proxy)** | ESP32 sensor readings | **Air quality anomaly detection** — rising gas resistance = mold/bacteria risk. Currently collected and ignored. |
| 5 | **Wholesale order history** | Orders in-memory (needs persistence) | **Demand forecasting** — Prophet/ARIMA time series. Feed succession planner. Currently, crop recommendation uses heuristic demand. |
| 6 | **Cross-farm weight benchmarks** | GreenReach Central `/api/crop-weights/network-analytics` | **Network yield optimization** — push "you're below avg" signals + recipe suggestions. Endpoint exists, never consumed. |
| 7 | **Anomaly false positive feedback** | `anomaly-history.js` with user actions | **IsolationForest threshold tuning** — track which anomaly alerts users dismiss → adjust contamination parameter. |
| 8 | **Recipe parameters applied per group per day** | Daily plan resolver execution logs | **Recipe→outcome correlation** — essential but not persisted. Need to log `applied_recipe_params` per group per day. |
| 9 | **QA checkpoint photos** | Uploaded via quality-control.js | **Growth time-lapse analysis** — track visual progress across growing cycle. Train plant health classifier per crop. |
| 10 | **Tray format → cell count** | Tray format database | **Auto-fill plant count at seeding** — eliminate a manual entry entirely. |

---

## 8. Implementation Roadmap

Each phase has two tracks: **Farm-side** (on each Light Engine) and **Central-side** (on GreenReach Central). Central is active from Phase 1 — not deferred.

### Phase 1: Wire the Data + Central Benchmarks (Weeks 1-4)

**Goal:** Connect outcomes to inputs on-farm. Central begins receiving and analyzing from day 1.

#### Farm-Side

| Task | Effort | Impact |
|------|--------|--------|
| **1.1** Persist recipe parameters applied per group per day (log to NeDB) | S | Foundation for all recipe learning |
| **1.2** Build harvest outcome record: recipe trajectory + environment achieved + weight + quality + loss | M | The core "experiment record" |
| **1.3** POST experiment records to Central on every harvest via new sync endpoint | S | Feeds Central intelligence |
| **1.4** Wire loss events → environment correlation (query env.json 24h before loss) | S | Immediate root cause insights |
| **1.5** Feed wholesale order history into crop recommendation demand factor (replace heuristic) | S | Better planting decisions now |
| **1.6** Surface learning correlations as dashboard insights (stop logging, start showing) | S | Make existing data visible |

#### Central-Side

| Task | Effort | Impact |
|------|--------|--------|
| **1.7** `POST /api/sync/experiment-records` — ingest experiment records from farms | S | Central data warehouse begins |
| **1.8** Nightly benchmark job: aggregate weight/plant, grow days, loss rate per crop across farms | M | Network benchmarks from day 1 |
| **1.9** Extend `analyzeAndPushToAllFarms()` to include crop benchmarks in AI recommendation push | S | Farms get network comparisons immediately |
| **1.10** Extend AI training export with recipe avg parameters + quality score | S | Enables external ML training |
| **1.11** Populate `GET /api/network/comparative-analytics` (currently returns `[]`) | M | First real cross-farm analytics |
| **1.12** Populate `GET /api/leaderboard` with yield efficiency + order fulfillment scores | S | Farm performance visibility |

### Phase 2: Workflow Automation + Central Intelligence (Weeks 3-6)

**Goal:** Reduce grower steps to 2-3. Central begins providing intelligence, not just benchmarks.

#### Farm-Side

| Task | Effort | Impact |
|------|--------|--------|
| **2.1** Auto-derive plant count from tray format | S | Eliminate manual entry |
| **2.2** Auto-fill crop at seeding from AI recommendation + zone history + **Central demand signals** | S | Pre-fill, grower confirms |
| **2.3** Combine seed + group assignment (scan tray at seeding → auto-assign to next available group) | M | Eliminate Quick Move as separate step |
| **2.4** Auto-trigger harvest label print on harvest scan | S | Eliminate separate print action |
| **2.5** Auto-derive photoperiod from recipe DLI + PPFD | S | Eliminate schedule configuration |
| **2.6** Remove duplicate seed date entry (sync from seeding event → group config) | S | Eliminate duplicate data |
| **2.7** Auto-discover light devices from controller API → auto-assign to zones | M | Eliminate manual light pairing |

#### Central-Side

| Task | Effort | Impact |
|------|--------|--------|
| **2.8** Demand signal aggregation: analyze wholesale order patterns per crop per region | M | "Kale demand up 30% in NE" pushed to farms |
| **2.9** New farm onboarding: push network best-known benchmarks on registration | S | New farms start from network knowledge, not zero |
| **2.10** Environmental benchmark push: include "network optimal temp for basil: 22°C" in AI recs | S | Farms know where they stand from week 1 |
| **2.11** Populate `GET /api/network/trends` with weekly crop yield and demand trends | M | Network-level trend visibility |
| **2.12** Buyer behavior analysis: cluster buyers, detect churn risk, flag to farm | M | Proactive buyer retention |

### Phase 3: Adaptive Intelligence + Central ML (Weeks 5-10)

**Goal:** Each farm learns from its own data. Central runs cross-farm ML models.

#### Farm-Side

| Task | Effort | Impact |
|------|--------|--------|
| **3.1** Per-crop recipe modifier: after 10 farm harvests OR Central pushes network modifier | L | Recipes evolve per farm |
| **3.2** Implement Tier 2 adaptive control: historical HVAC efficiency regression | M | Energy optimization |
| **3.3** LED aging detection: track PPFD↔channel trend per fixture over time | M | Predictive maintenance |
| **3.4** Harvest date prediction: ML model from {crop, recipe, environment} → actual grow days | M | Accurate delivery promises |
| **3.5** Loss prediction: environment trend → loss probability (alert before loss occurs) | M | Preventive intervention |
| **3.6** Quality trend analysis: GPT vision scores over time → quality degradation alert | S | Early quality intervention |

#### Central-Side

| Task | Effort | Impact |
|------|--------|--------|
| **3.7** Cross-farm yield regression: `weight/plant ~ f(spectrum, temp, humidity, grow_days)` on ALL farms | L | Network-level yield model |
| **3.8** Compute & publish network recipe modifiers per crop (pushed to farms via AI channel) | M | Farms benefit from network learning immediately |
| **3.9** Cross-farm anomaly correlation: detect equipment/firmware patterns across farms | M | "SwitchBot v3.2 → 3× dropout rate" |
| **3.10** Loss pattern network alerts: "Lettuce pest reports increasing in NE region" | M | Regional risk alerting |
| **3.11** Cross-farm energy benchmarks: kWh/kg per crop per farm → efficiency rankings | S | Energy optimization incentive |
| **3.12** Populate remaining stub endpoints: `GET /api/performance/:growerId` with real metrics | M | Per-farm performance tracking |

### Phase 4: Network Coordination (Weeks 8-14)

**Goal:** Central coordinates production and market across the network.

#### Farm-Side

| Task | Effort | Impact |
|------|--------|--------|
| **4.1** Accept Central's planting suggestions: UI shows "Central recommends: seed 4 trays kale this week" | M | Network-coordinated planting |
| **4.2** Report harvest schedule to Central (projected harvest dates from group seed dates + crop duration) | S | Enables supply coordination |
| **4.3** Accept recipe modifier push from Central with one-tap approve/dismiss | M | Frictionless network learning adoption |

#### Central-Side

| Task | Effort | Impact |
|------|--------|--------|
| **4.4** Harvest schedule coordination: detect market flooding risk (5 farms harvesting romaine same week) | L | Network supply optimization |
| **4.5** Supply/demand balancing: "Network needs 200 cases kale, trajectory: 150. Suggest 3 farms expand." | L | Supply-demand coordination |
| **4.6** A/B test orchestration: assign spectrum experiments across farms for controlled testing | L | Scientific network-wide experiments |
| **4.7** Quality-based order routing: route buyer orders to farms with highest quality scores per crop | M | Quality incentive + buyer satisfaction |
| **4.8** Dynamic pricing engine: recommend prices from supply, demand, quality, seasonality | M | Revenue optimization |

### Phase 5: Autonomous Operations (Weeks 12-20)

**Goal:** AI makes decisions, grower approves or overrides. Central orchestrates the network.

#### Farm-Side

| Task | Effort | Impact |
|------|--------|--------|
| **5.1** Automated recipe adjustment: apply Central modifiers without grower intervention (with guardrails) | L | Hands-off recipe optimization |
| **5.2** AI-driven harvest scheduling: notify grower when each group is ready (not fixed date) | M | Quality-based harvest timing |
| **5.3** Voice-first Activity Hub: "Seeded basil in tray 47, zone 3" → AI processes | L | Hands-free farming |

#### Central-Side

| Task | Effort | Impact |
|------|--------|--------|
| **5.4** Network production planning: auto-generate weekly seeding plans per farm from demand + succession + capacity | L | Central coordinates what every farm grows |
| **5.5** Dynamic recipe distribution: Central publishes evolved recipes, farms auto-adopt | L | Recipes improve continuously |
| **5.6** Predictive inventory: auto-list wholesale products based on Central's harvest predictions | M | Auto wholesale listing |
| **5.7** Autonomous wholesale matching: Central matches supply to demand across farms | L | No human intervention in order routing |
| **5.8** Market intelligence integration: real-time pricing feeds → planting signal adjustments | M | Real-world market response |

---

## 9. Network Intelligence Architecture

### Central as the Brain — Farms as Instruments

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        GREENREACH CENTRAL (Mother Ship)                         │
│                                                                                 │
│  ┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────────────┐  │
│  │   DATA WAREHOUSE     │  │  INTELLIGENCE ENGINE  │  │   PUSH ORCHESTRATOR  │  │
│  │                      │  │                       │  │                      │  │
│  │  Experiment records  │  │  Yield regression     │  │  AI recommendations │  │
│  │  Sensor telemetry    │──▸  Recipe modifiers     │──▸  Crop benchmarks    │  │
│  │  Loss events         │  │  Demand forecasting   │  │  Demand signals     │  │
│  │  Order history       │  │  Anomaly correlation  │  │  Risk alerts        │  │
│  │  Weight benchmarks   │  │  Quality ranking      │  │  Recipe modifiers   │  │
│  │  Farm profiles       │  │  Loss pattern alerts  │  │  Schedule coord.    │  │
│  └──────────────────────┘  └──────────────────────┘  └──────────────────────┘  │
│                                                                                 │
│  Existing pipes:   5-min sync (pull)  │  30-min AI push  │  Real-time orders   │
└────────────┬───────────────────────────────────┬────────────────────────────────┘
             │                                   │
        FARMS CONTRIBUTE                   CENTRAL PUSHES
        (experiment data flows up)         (intelligence flows down)
             │                                   │
     ┌───────┴───────┐                   ┌───────┴───────┐
     ▼               ▼                   ▼               ▼
┌─────────┐   ┌─────────┐         ┌─────────┐   ┌─────────┐
│ Farm A  │   │ Farm B  │         │ Farm A  │   │ Farm B  │
│ Basil   │   │ Basil   │         │ "You're │   │ "Try    │
│ 2.34    │   │ 2.71    │         │  7%     │   │  +2%    │
│ oz/plant│   │ oz/plant│         │  below" │   │  blue"  │
└─────────┘   └─────────┘         └─────────┘   └─────────┘
```

### The Experiment Record (What Flows Up)

Every harvest generates one experiment record that the farm POSTs to Central:

```json
{
  "farm_id": "farm-abc",
  "crop": "genovese-basil",
  "recipe_id": "basil-standard-v2",
  "grow_days": 31,
  "planned_grow_days": 28,
  "recipe_params_avg": {
    "ppfd": 210, "blue_pct": 32, "red_pct": 48,
    "green_pct": 14, "far_red_pct": 6,
    "temp_c": 22.1, "humidity_pct": 58,
    "ec": 1.4, "ph": 5.9
  },
  "environment_achieved_avg": {
    "temp_c": 22.3, "humidity_pct": 61,
    "co2_ppm": 820, "vpd_kpa": 0.92, "ppfd_actual": 198
  },
  "outcomes": {
    "weight_per_plant_oz": 2.34,
    "quality_score": 87,
    "loss_rate": 0.08,
    "energy_kwh_per_kg": 14.2
  },
  "farm_context": {
    "region": "NE-US", "altitude_m": 52,
    "season": "winter", "system_type": "nft",
    "tray_format": "1020-flat",
    "fixture_hours": 2400
  },
  "recorded_at": "2026-02-15T14:30:00Z"
}
```

### The Intelligence Push (What Flows Down)

Central's 30-minute AI push (already operational via `POST /api/health/ai-recommendations`) is extended to include network intelligence:

```json
{
  "ai_recommendations": ["...existing GPT-analyzed recs..."],
  "network_intelligence": {
    "crop_benchmarks": {
      "genovese-basil": {
        "network_avg_weight": 2.51,
        "your_weight": 2.34,
        "percentile": 35,
        "network_optimal_spectrum": { "blue": "28-32%", "red": "50-55%" },
        "network_optimal_temp": "21.5-22.5°C",
        "suggestion": "Try Blue +2% (network data shows +12% yield improvement)",
        "confidence": 0.78,
        "contributing_farms": 47
      }
    },
    "demand_signals": {
      "kale": { "trend": "+30%", "region": "NE-US", "action": "consider expanding" }
    },
    "risk_alerts": [
      { "type": "pest", "crop": "lettuce", "region": "NE-US", "farms_reporting": 3 }
    ],
    "recipe_modifiers": {
      "genovese-basil": {
        "blue_offset_pct": +2, "red_offset_pct": +4,
        "temp_offset_c": -0.5,
        "confidence": 0.78, "sample_size": 312
      }
    }
  }
}
```

### Data Flow Timeline

| When | What Happens | Pipe |
|------|-------------|------|
| **Every 5 min** | Central pulls telemetry, groups, rooms, inventory from each farm | `syncFarmData()` (exists) |
| **On harvest** | Farm POSTs experiment record to Central | `POST /api/sync/experiment-records` (new) |
| **On loss event** | Farm POSTs loss + environment snapshot to Central | Extend existing sync (new) |
| **Nightly (2 AM)** | Central runs benchmark aggregation: per-crop network stats | Scheduled job (new) |
| **Every 30 min** | Central pushes AI recs + network intelligence to all farms | `analyzeAndPushToAllFarms()` (extend) |
| **On wholesale order** | Central pushes order to farm + aggregates demand patterns | Existing order flow + demand tracking (new) |
| **Weekly** | Central computes recipe modifiers from cross-farm regression | ML job (new — Phase 3) |
| **On buyer registration** | Central provides network supply catalog | Existing wholesale aggregator |

### Privacy & Data Sharing Model

| Data Level | Shared? | With Whom |
|-----------|---------|-----------|
| Raw sensor readings | No | Stays on-farm |
| Per-harvest experiment record | Anonymized | Central only |
| Aggregated crop benchmarks | Yes | All network farms |
| Farm-specific recommendations | Yes | Only that farm |
| Customer/buyer data | Never | N/A |
| Pricing | Never | N/A |
| Farm identity in benchmarks | Never | N/A (anonymous percentile ranking) |
| Recipe modifiers | Aggregated only | Network-level recommendations |

---

## 10. Training Data Strategy

**"This version should be considered advanced training."**

Every action in Foxtrot generates training data for future ML models. The strategy:

### Data Collection Priorities (What to Start Logging Now)

| Priority | Data | Why | Storage |
|----------|------|-----|---------|
| **P0** | Recipe parameters applied per group per day | Foundation for recipe→yield correlation | NeDB `appliedRecipesDB` |
| **P0** | Complete harvest outcome record | The "experiment result" — must include recipe + environment + outcome | NeDB `harvestOutcomesDB` |
| **P1** | Environment achieved vs. target (daily deviation) | Understand control accuracy per farm | Append to existing env.json |
| **P1** | User decisions (accepted/overrode AI recommendation) | Reinforcement signal for recommendation quality | NeDB `aiDecisionsDB` |
| **P2** | QA checkpoint scores over time per group | Plant health trajectory for growth modeling | Extend existing QA DB |
| **P2** | Energy consumption per group per day | kWh/kg optimization | Extend duty cycle logging |
| **P3** | Buyer satisfaction signals (ratings, returns, reorders) | Quality feedback loop | Central `buyerFeedbackDB` |
| **P3** | Recipe A/B test results | Controlled experiment data | NeDB `experimentDB` |

### ML Models to Train (Future Versions)

| Model | Input Features | Output | Training Set Size Needed | Current Data Available |
|-------|---------------|--------|--------------------------|----------------------|
| **Yield predictor** | crop, recipe_params, environment, grow_days, season, farm_context | weight/plant | 500+ harvests per crop | ~0 (not linked) |
| **Grow day estimator** | crop, recipe, environment, season | actual_grow_days | 200+ per crop | Partial (harvest log has variance) |
| **Loss predictor** | crop, environment_trend_48h, zone, season | loss_probability | 300+ loss events | ~50 (loss tracking exists) |
| **Quality classifier** | crop, photo, environment, recipe_phase | quality_score (0-100) | 1000+ labeled photos | ~0 (QA checkpoint stub) |
| **Demand forecaster** | crop, season, region, buyer_history | orders_next_week | 52+ weeks of order data | ~months (wholesale is new) |
| **Energy optimizer** | crop, recipe, equipment_profile, climate | optimal_schedule | 200+ crop cycles | Partial (duty logging exists) |
| **Recipe optimizer** | crop, farm_context, past_outcomes | recipe_modifier | 50+ per crop per farm | 0 (feedback loop not closed) |

### Training Data Export API

The existing `/api/crop-weights/ai-training-export` endpoint should be expanded into a comprehensive training data API:

```
GET /api/ai/training-data
  ?type=harvest_outcomes    → experiment records
  ?type=environment_series  → time-series sensor data
  ?type=recipe_applications → what recipes were actually applied
  ?type=loss_events         → loss correlation records
  ?type=quality_checkpoints → QA scores + photos
  ?type=demand_history      → wholesale order patterns
  ?format=csv|json|parquet
  ?since=2025-01-01
  ?crop=genovese-basil
```

This feeds both on-farm ML models and Central's network-wide training pipeline.

---

## 11. Risk & Guardrails

### Safety Principles

1. **AI suggests, grower confirms** (Phase 1-4). AI never autonomously changes recipes, temperatures, or lighting without grower approval. Exception: safety overrides (freeze protection, fire risk).

2. **Guardrail bounds per parameter**: Recipe modifiers capped at ±10% per cycle. Temperature adjustments max ±2°C. Spectrum changes max ±5% per band. These widen as confidence increases.

3. **Revert on regression**: If modified recipe underperforms baseline for 2 consecutive cycles, auto-revert to baseline and flag for review.

4. **Minimum data requirements**: No recipe modifiers until 10+ harvests of same crop. No network recommendations until 5+ farms contributing. No autonomous operation until 50+ successful AI-guided cycles.

5. **Human override always available**: Every AI decision has a "dismiss" or "override" button. These dismissals become training signals.

6. **Transparency**: Every AI recommendation shows: data source, confidence level, contributing farms (anonymous), expected impact, rollback plan.

### Data Integrity Risks

| Risk | Mitigation |
|------|------------|
| In-memory data loss (9 subsystems are volatile) | Persist to NeDB: fulfillment, audit log, inventory, reservations |
| groups.json ↔ trayRunsDB disconnect | Canonical sync: tray operations update groups.json |
| Sensor data gaps (SwitchBot connectivity) | Outdoor sensor validator already gates ML operations — extend to all sensors |
| Cross-farm data quality variance | Standardized experiment record schema validated at Central ingestion |
| Model drift over time | Periodic re-training triggers + performance monitoring against holdout set |

### The Path to Fully Autonomous

```
Phase 1:  Farm wires data + Central benchmarks   ← Current target
Phase 2:  Farm automates workflow + Central provides intelligence
Phase 3:  Farm learns locally + Central runs cross-farm ML
Phase 4:  Central coordinates network (supply/demand/experiments)
Phase 5:  Central orchestrates + farms operate autonomously
Future:   Fully autonomous Light Engine network  ← Human sets goals, AI executes
```

**Central's progression:**
```
Phase 1:  Data warehouse + basic benchmarks      (receive, store, compare)
Phase 2:  Intelligence provider                   (analyze, push insights)
Phase 3:  Learning engine                         (ML models, recipe modifiers)
Phase 4:  Network coordinator                     (schedule, balance, experiment)
Phase 5:  Autonomous orchestrator                 (plan, distribute, match)
```

Each phase unlocks when:
- Model accuracy exceeds threshold (>85% for that decision type)
- Grower acceptance rate exceeds 90% for AI suggestions
- No safety incidents in previous 100 cycles
- Minimum data volume accumulated per Training Data Strategy

---

## Appendix: Summary of All AI Opportunities

| # | Opportunity | Owner | Category | Phase | Effort | Impact |
|---|------------|-------|----------|-------|--------|--------|
| 1 | Persist recipe parameters applied per day | Farm | Data | 1 | S | Critical |
| 2 | Build harvest outcome "experiment record" | Farm | Data | 1 | M | Critical |
| 3 | POST experiment records to Central on harvest | Farm | Network | 1 | S | Critical |
| 4 | Wire loss events → environment correlation | Farm | Learning | 1 | S | High |
| 5 | Feed real demand into crop recommendation | Farm | Intelligence | 1 | S | High |
| 6 | Surface learning correlations on dashboard | Farm | UX | 1 | S | Medium |
| 7 | Ingest experiment records endpoint | Central | Data | 1 | S | Critical |
| 8 | Nightly crop benchmark aggregation job | Central | Intelligence | 1 | M | Critical |
| 9 | Push crop benchmarks in AI recommendation channel | Central | Network | 1 | S | High |
| 10 | Extend AI training export with recipe params | Farm | Data | 1 | S | High |
| 11 | Populate comparative analytics endpoint | Central | Network | 1 | M | High |
| 12 | Populate leaderboard with real scores | Central | Network | 1 | S | Medium |
| 13 | Auto-derive plant count from tray format | Farm | Workflow | 2 | S | Medium |
| 14 | AI pre-fill crop at seeding + Central demand signals | Farm | Workflow | 2 | S | High |
| 15 | Combine seed + group assignment | Farm | Workflow | 2 | M | High |
| 16 | Auto-trigger label print on harvest | Farm | Workflow | 2 | S | Medium |
| 17 | Auto-derive photoperiod from recipe | Farm | Workflow | 2 | S | Medium |
| 18 | Remove duplicate seed date entry | Farm | Workflow | 2 | S | Medium |
| 19 | Auto-discover lights from controller | Farm | Workflow | 2 | M | Medium |
| 20 | Demand signal aggregation + push to farms | Central | Intelligence | 2 | M | High |
| 21 | New farm onboarding with network benchmarks | Central | Network | 2 | S | High |
| 22 | Environmental benchmark push | Central | Network | 2 | S | Medium |
| 23 | Populate network trends endpoint | Central | Network | 2 | M | Medium |
| 24 | Buyer behavior analysis + churn detection | Central | Intelligence | 2 | M | High |
| 25 | Per-crop recipe modifier (farm-specific + Central) | Farm | Intelligence | 3 | L | Critical |
| 26 | Tier 2 adaptive control (HVAC learning) | Farm | Intelligence | 3 | M | High |
| 27 | LED aging detection | Farm | Maintenance | 3 | M | Medium |
| 28 | ML harvest date prediction | Farm | Intelligence | 3 | M | High |
| 29 | Loss prediction from environment trends | Farm | Risk | 3 | M | High |
| 30 | Quality trend analysis from AI vision | Farm | Quality | 3 | S | Medium |
| 31 | Cross-farm yield regression ML model | Central | Intelligence | 3 | L | Critical |
| 32 | Compute & push network recipe modifiers | Central | Network | 3 | M | Critical |
| 33 | Cross-farm anomaly correlation | Central | Risk | 3 | M | High |
| 34 | Loss pattern network alerts | Central | Risk | 3 | M | High |
| 35 | Cross-farm energy benchmarks | Central | Network | 3 | S | Medium |
| 36 | Per-farm performance tracking endpoint | Central | Network | 3 | M | Medium |
| 37 | Accept Central planting suggestions UI | Farm | Workflow | 4 | M | High |
| 38 | Report harvest schedule to Central | Farm | Network | 4 | S | High |
| 39 | One-tap recipe modifier approve/dismiss | Farm | Workflow | 4 | M | High |
| 40 | Harvest schedule coordination (anti-flooding) | Central | Network | 4 | L | High |
| 41 | Supply/demand balancing across farms | Central | Intelligence | 4 | L | Critical |
| 42 | A/B test orchestration across farms | Central | Intelligence | 4 | L | High |
| 43 | Quality-based order routing | Central | Network | 4 | M | High |
| 44 | Dynamic pricing engine | Central | Intelligence | 4 | M | High |
| 45 | Automated recipe adjustment (with guardrails) | Farm | Autonomy | 5 | L | Critical |
| 46 | AI-driven harvest timing (ready-based) | Farm | Autonomy | 5 | M | High |
| 47 | Voice-first Activity Hub | Farm | Autonomy | 5 | L | High |
| 48 | Network production planning (weekly seeding plans) | Central | Autonomy | 5 | L | Critical |
| 49 | Dynamic recipe distribution | Central | Autonomy | 5 | L | Critical |
| 50 | Predictive inventory / auto wholesale listing | Central | Autonomy | 5 | M | High |
| 51 | Autonomous wholesale matching | Central | Autonomy | 5 | L | High |
| 52 | Market intelligence integration | Central | Autonomy | 5 | M | High |

**Total: 52 AI opportunities across 5 phases — 27 Farm-side, 25 Central-side.**

### Phase Summary

| Phase | Farm Tasks | Central Tasks | Central Role |
|-------|-----------|---------------|-------------|
| **1** | 6 (wire data) | 6 (warehouse + benchmarks) | Data warehouse + basic benchmarks |
| **2** | 7 (automate workflow) | 5 (provide intelligence) | Intelligence provider |
| **3** | 6 (local learning) | 6 (cross-farm ML) | Learning engine |
| **4** | 3 (accept coordination) | 5 (coordinate network) | Network coordinator |
| **5** | 3 (operate autonomously) | 5 (orchestrate network) | Autonomous orchestrator |

---

*"Each Light Engine is a scientific instrument. Every harvest is an experiment. Every farm contributes to the network. This version is advanced training."*
