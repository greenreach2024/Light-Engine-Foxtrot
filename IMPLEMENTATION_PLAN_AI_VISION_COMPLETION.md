# AI Vision Completion Plan

**Date**: February 23, 2026  
**Branch**: `recovery/feb11-clean` @ `5865bca`  
**Deployment**: Foxtrot prod-v3 Green, Central prod-v4 Green  
**Supersedes**: `IMPLEMENTATION_PLAN_AI_GROWTH_2026-02-21.md` (Phase 0 section)  
**Source**: Post-deployment audit findings (Feb 23, 2026)

---

## Audit Summary — Where We Actually Are

### What the reports claimed vs. reality

| Feature | Claimed | Actual |
|---------|---------|--------|
| P1: Device Discovery | COMPLETE & DEPLOYED | Library exists, **no `/api/devices/scan` endpoint** — frontend broken |
| P2: Adaptive Control Tier 1 | COMPLETE & DEPLOYED | Library exists, **never imported or instantiated** — dead code |
| P3: Harvest Prediction | COMPLETE & DEPLOYED | **Genuinely wired and live** — `/api/harvest/predictions/all` returns data |
| P4: Succession Planner | COMPLETE & DEPLOYED | Library exists (834 lines), **never imported, no API routes** — dead code |
| P8: Anomaly Diagnostics | COMPLETE & DEPLOYED | Library exists, **no `/api/ml/diagnostics` endpoint** — frontend broken |
| Phase 1 Farm Tasks (1.1–1.6) | Not tracked | **All 6 implemented** — experiment records, recipe logging, loss correlation, demand feed, learning correlations |
| Phase 1 Central Tasks (1.7–1.12) | Not tracked | **All 6 implemented** — experiment ingest, benchmarks, AI push, comparative analytics, leaderboard |
| Ticket 0.3 (purchase leads) | Volatile Map | **Already fixed** — NeDB-backed |
| Ticket 0.4 (auto-trigger experiment) | Not wired | **Already wired** — harvest handler calls `buildExperimentRecord()` at L10200 |
| Harvest predictions in dashboard | Not integrated | **Already integrated** — script loaded, badges rendering in farm-summary.html |
| Network grower stubs | 7 stubs | **Only 2 stubs remain** (contracts, invitations) — rest populate real SQL |

### Actual remaining work

| Category | Items | Effort |
|----------|-------|--------|
| **Wire existing dead code** (4 features) | P1, P2, P4, P8 | 1–2 days |
| **Fix data persistence** (1 ticket) | 5 volatile inventory arrays | 2–3 hours |
| **ML pipeline scheduling** | Add periodic execution for anomaly/forecast | 2–3 hours |
| **Market intelligence data** | Replace static fallback data with Central feed | 1 day |
| **Phase 2–5 roadmap** | Agents, workflow, closed-loop learning, coordination, autonomy | 30+ weeks |

---

## Sprint 0: Wire What's Built (Days 1–3)

**Goal**: Make the 4 unwired features callable. No new logic — just connect existing libraries to server endpoints.

### S0.1 — Wire P2 Adaptive Control

**Status**: Library complete at `lib/adaptive-control.js` (308 lines). Controller has injection point at `checkAndControlEnvironment.js` L98 (`if (options.adaptiveControl)`). Server call site at L27172 never passes the option.

**Changes**:

| File | Change |
|------|--------|
| `server-foxtrot.js` ~L224 | Add `import { AdaptiveControl } from './lib/adaptive-control.js';` |
| `server-foxtrot.js` module scope | Add `const adaptiveControl = new AdaptiveControl({ tier: 1 });` |
| `server-foxtrot.js` L27172 | Add `adaptiveControl` to the options object passed to `checkAndControlEnvironment()` |

**Effort**: 30 minutes  
**Risk**: Low — the controller already has the `if (options.adaptiveControl)` branch; this just activates it  
**Validation**: `GET /health` shows adaptive control enabled; environment log shows adjusted targets during extreme outdoor temps or 2–6pm peak hours

---

### S0.2 — Wire P8 Anomaly Diagnostics

**Status**: Library at `lib/anomaly-diagnostics.js` (491 lines). Frontend `public/anomaly-diagnostics.js` calls `GET /api/ml/diagnostics` which doesn't exist. ML routes only have `/api/ml/anomalies` and `/api/ml/effects`.

**Changes**:

| File | Change |
|------|--------|
| `routes/ml.js` | Import `AnomalyDiagnostics`. Add `GET /api/ml/diagnostics` handler that: (1) runs the existing anomaly detection, (2) passes each anomaly through `AnomalyDiagnostics.diagnose()`, (3) returns `{ ok: true, diagnostics: [...], summary: { total, critical, warning, info } }` |

**Effort**: 1–2 hours  
**Risk**: Low — diagnostics layer is additive over existing anomaly detection  
**Validation**: `GET /api/ml/diagnostics` returns diagnostics array; `anomaly-diagnostics-demo.html` loads and displays results

---

### S0.3 — Wire P4 Succession Planter

**Status**: Library at `lib/succession-planner.js` (834 lines, `SuccessionPlanner` class). Never imported. No API routes.

**Changes**:

| File | Change |
|------|--------|
| `server-foxtrot.js` | Import `SuccessionPlanner`, instantiate with data directory. Add 7 API routes: |

| Route | Method | Handler |
|-------|--------|---------|
| `/api/succession/schedule` | POST | `generateSchedule(params)` |
| `/api/succession/duration/:crop` | GET | `getGrowthDuration(crop)` |
| `/api/succession/suggest` | POST | `suggestFromDemand(params)` |
| `/api/succession/optimize` | POST | `requestAIOptimization(farmId, suggestions)` |
| `/api/succession/forecast/:crop` | GET | `getHarvestForecast(crop, weeks)` |
| `/api/succession/gaps/:crop` | GET | `detectInventoryGaps(crop, targetRate)` |
| `/api/succession/strategy/:crop` | GET | `getHarvestStrategy(crop)` |

**Effort**: 2–3 hours  
**Risk**: Low — all methods are self-contained in the library  
**Validation**: `POST /api/succession/schedule` returns a succession schedule; `GET /api/succession/strategy/basil` returns harvest strategy

---

### S0.4 — Fix P1 Device Discovery

**Status**: Library at `lib/device-discovery.js` (304 lines, `DeviceDiscovery` class). Frontend `public/device-scanner.js` calls `POST /api/devices/scan` which doesn't exist. Server has `GET /api/devices/discover-and-suggest` at L23811 with different response shape.

**Changes**:

| File | Change |
|------|--------|
| `server-foxtrot.js` | Add `POST /api/devices/scan` route that wraps the existing multi-protocol discovery logic and returns `{ ok: true, devices: [...], summary: { total, protocols } }` matching what `device-scanner.js` expects |

**Effort**: 1 hour  
**Risk**: Low — wrapping existing discovery logic with correct response shape  
**Validation**: Setup wizard device scanner page discovers devices; `POST /api/devices/scan` returns device list

---

### S0.5 — Persist 5 Volatile Inventory Arrays

**Status**: 5 `const inventory = []` arrays at `server-foxtrot.js` L17800–17804. Data lost on every restart.

**Variables**: `seedsInventory`, `packagingInventory`, `nutrientsInventory`, `equipmentInventory`, `suppliesInventory`

**Changes**:

| File | Change |
|------|--------|
| `server-foxtrot.js` L17798–17810 | Replace 5 arrays with 5 NeDB Datastores (`./data/seeds-inventory.db`, etc.). Load on boot (autoload). Convert array mutations (push, filter, splice) to NeDB insert/update/remove with write-through reads. |

**Effort**: 2–3 hours  
**Risk**: Medium — need to preserve existing API contracts for each inventory endpoint  
**Validation**: Add inventory items via API, restart server, verify items persist

---

### S0.6 — Add ML Periodic Scheduling

**Status**: Python anomaly detector and forecast scripts only run on API call. No background scheduling.

**Changes**:

| File | Change |
|------|--------|
| `server-foxtrot.js` | Add `setInterval` (every 15 min) that spawns `simple-anomaly-detector.py`, writes results to `anomalyResultsCache`. Add `setInterval` (every 30 min) for `predictive_forecast.py`, writes to `forecastCache`. API endpoints read from cache (fast) with option to force-refresh. |

**Effort**: 2–3 hours  
**Risk**: Medium — Python env must have sklearn/statsmodels installed on EB instance; need graceful failure if not  
**Validation**: Anomaly results refresh automatically; `GET /api/ml/anomalies` returns data < 15 min old

---

### Sprint 0 Exit Criteria

- [ ] `GET /api/ml/diagnostics` returns anomaly diagnostics
- [ ] `POST /api/devices/scan` returns discovered devices
- [ ] `POST /api/succession/schedule` returns succession plan
- [ ] Adaptive control adjusts environment targets during extreme conditions
- [ ] All 5 procurement inventories survive server restart
- [ ] ML anomaly detection runs on background schedule
- [ ] All 5 P-items callable via API (P1, P2, P3, P4, P8)
- [ ] Zero errors on `npm start`

**Total Sprint 0 effort**: 2–3 days

---

## Sprint 1: Close Phase 0 Gaps (Days 4–7)

**Goal**: Fix remaining foundation gaps from the Implementation Plan's Phase 0.

### S1.1 — Verify ML Jobs Run in Production

The `.ebignore` was previously excluding `simple-anomaly-detector.py`. That's now fixed (`!scripts/simple-anomaly-detector.py`). Need to verify:

1. Python3 is available on EB instance
2. `sklearn` and `statsmodels` are installed (or fail gracefully)
3. ML endpoints return non-error responses in production

**Changes**: SSH to EB instance, check Python env. If sklearn missing, add `requirements.txt` + prebuild hook for `pip install`. If Python unavailable, add fallback pure-JS anomaly scorer.

**Effort**: 1 day  
**Risk**: High — Python dependency management on EB is the #1 recurring deployment issue

---

### S1.2 — Replace Hardcoded Market Intelligence

**Status**: `routes/market-intelligence.js` has 3-tier pricing: (1) real wholesale orders (working), (2) Central benchmarks (assumed), (3) static `MARKET_DATA_SOURCES` fallback with frozen data from Jan 2026.

**Changes**:

| File | Change |
|------|--------|
| `routes/market-intelligence.js` | Replace Tier 3 static data with Central benchmark API fetch (`GET /api/crop-benchmarks` from Central). Cache for 6 hours. Keep current static data as Tier 4 last-resort fallback. Add `lastUpdated` timestamp from actual data source. |

**Effort**: 3–4 hours  
**Risk**: Low — additive change, existing fallback preserved

---

### S1.3 — Consolidate Implementation Docs

**Status**: 10+ partially overlapping proposal/plan documents, several claiming features are "complete" when they weren't wired.

**Changes**:
- Add superseded headers to: `AI_INTEGRATION_PROPOSAL.md`, `AI_GAPS_AND_OPPORTUNITIES.md`, `AI_AGENT_OPERATING_ACTION_PLAN_2026-02-21.md`
- Update `AI_IMPLEMENTATION_PROGRESS_REPORT.md` to accurately reflect wiring status after Sprint 0
- This document (`IMPLEMENTATION_PLAN_AI_VISION_COMPLETION.md`) becomes the canonical execution plan

**Effort**: 1–2 hours

---

### Sprint 1 Exit Criteria

- [ ] ML endpoints return fresh data in production (or graceful fallback)
- [ ] Market intelligence returns real pricing data from wholesale orders / Central
- [ ] All proposal docs annotated as superseded
- [ ] Implementation progress report accurate

**Total Sprint 1 effort**: 2–3 days

---

## Sprint 2: Phase 2 — Workflow Reduction + Agent MVPs (Days 8–30)

**Goal**: Reduce grower manual steps. Deploy first agent classes in recommendation-only mode. Derives from AI Vision Report Phase 2 + Implementation Plan Phase 2.

### S2.1 — Auto-Derive Plant Count from Tray Format
**Effort**: S | **Owner**: Farm  
When grower scans a tray at seeding, auto-fill plant count from tray format cell count mapping. Eliminate manual entry.

### S2.2 — Combine Seed + Group Assignment
**Effort**: M | **Owner**: Farm  
Scan tray at seeding → auto-assign to next available group in the target zone. Eliminate Quick Move as separate step.

### S2.3 — Auto-Trigger Label Print on Harvest Scan
**Effort**: S | **Owner**: Farm  
When harvest event fires via Activity Hub QR scan, auto-generate lot code and trigger print. Eliminate separate print action.

### S2.4 — Auto-Derive Photoperiod from Recipe
**Effort**: S | **Owner**: Farm  
Calculate `photoperiod_hrs = DLI / (PPFD × 3600) × 1e6`. Eliminate schedule configuration step. Already calculable from recipe data.

### S2.5 — Remove Duplicate Seed Date Entry
**Effort**: S | **Owner**: Farm  
Seed date set during seeding event → sync to group config. Remove the separate seed date field in group configuration.

### S2.6 — Event Taxonomy v1
**Effort**: M | **Owner**: Farm  
Define canonical event names in `data/event-taxonomy.json`: seed, transplant, harvest, loss, order, delivery, payout, quality-check, agent-action. Wire the 3 most common (seed, harvest, loss) to emit standardized events.

### S2.7 — Agent Permission Matrix
**Effort**: S | **Owner**: Farm  
Create `data/agent-permissions.json` defining per-agent-class action scopes and human-approval tiers (auto / recommend / require-approval). Load in `services/ai-agent.js` to gate actions.

### S2.8 — Admin Ops Agent (Recommendation-Only)
**Effort**: M | **Owner**: Farm  
Prompt template + tool routing for cross-farm alert triage, SLA risk, ops summaries. Uses existing `ai-agent.js` infrastructure. No autonomous actions.

### S2.9 — Weekly KPI Dashboard Scaffold
**Effort**: L | **Owner**: Farm + Central  
`/api/kpis` endpoint returning 7 core metrics: fill rate, OTIF, contribution margin, loss rate, forecast error, labor minutes/kg, user-input reduction. Frontend: KPI cards page.

### S2.10 — Agent Action Audit Log
**Effort**: S | **Owner**: Farm  
Instrument agent classes to log every recommendation/action to a persistent audit DB. Schema: `{ agent_class, action_type, input_summary, recommendation, human_decision, timestamp }`.

### Sprint 2 Exit Criteria

- [ ] Seeding flow: grower scans tray → plant count auto-fills → group auto-assigns
- [ ] Harvest scan auto-generates lot code + triggers label print
- [ ] Photoperiod auto-derived from recipe (no manual schedule config)
- [ ] Event taxonomy v1 published; seed/harvest/loss events standardized
- [ ] Admin Ops Agent responds to natural language queries with actionable recommendations
- [ ] KPI dashboard shows real metrics
- [ ] All agent actions logged in audit DB

**Total Sprint 2 effort**: ~3 weeks

---

## Sprint 3: Phase 3 — Closed-Loop Learning (Days 31–65)

**Goal**: Connect outcomes to inputs. Recipes evolve. Models retrain. This is the AI Vision Report's core differentiator.

### S3.1 — Recipe Modifier System
**Effort**: L | **Owner**: Farm  
After 10+ experiment records for a crop at a farm, compute per-crop recipe offset (±5% max per parameter: spectrum, PPFD, temp). Store as `data/recipe-modifiers.json`. Apply between recipe resolver and VPD/light controller. Revert on 2 consecutive regressions.

### S3.2 — Cross-Farm Yield Regression
**Effort**: L | **Owner**: Central  
Central runs weekly: `weight/plant ~ f(blue_pct, red_pct, ppfd, temp_c, humidity_pct, grow_days)` across all farms. Publishes network recipe modifiers per crop.

### S3.3 — Network Recipe Modifier Push
**Effort**: M | **Owner**: Central + Farm  
Extend AI push channel to include `network_intelligence.recipe_modifiers`. Farm UI shows "Central suggests: +2% blue for basil (78% confidence)." Grower one-tap approves/dismisses.

### S3.4 — Weekly Model Retrain Pipeline
**Effort**: M | **Owner**: Farm  
`lib/ml-training-pipeline.js` (165 lines) exists. Wire to weekly cron: retrain harvest predictor and anomaly detection with latest data. Log model metrics. Deploy if accuracy improves.

### S3.5 — Champion/Challenger Evaluation
**Effort**: M | **Owner**: Farm  
When recipe modifier applied on one group, track outcome vs. baseline (same crop, no modifier). Report delta to Central.

### S3.6 — Dynamic Pricing v1
**Effort**: M | **Owner**: Farm + Central  
Replace simulated pricing with real analysis: own wholesale order history (price offered, accepted/rejected), compute price sensitivity per crop per buyer segment. Suggestion with confidence range.

### S3.7 — Alert Prioritization Model
**Effort**: M | **Owner**: Farm  
Score anomaly alerts against farm context, historical dismiss rates, severity. Only surface high-priority alerts. Track response to tune thresholds. Reduces alert fatigue.

### Sprint 3 Exit Criteria

- [ ] Recipe modifiers computed and applied for at least 1 crop with 10+ experiment records
- [ ] Central publishes network recipe modifiers in AI push channel
- [ ] Model retrain pipeline runs weekly, logs accuracy metrics
- [ ] Champion/challenger delta tracked for modified vs. baseline groups
- [ ] Dynamic pricing shows real price suggestions
- [ ] Alert noise reduced measurably (dismiss rate tracked)

**Total Sprint 3 effort**: ~5 weeks

---

## Sprint 4: Phase 4 — Network Coordination (Days 66–110)

**Goal**: Central coordinates supply/demand. Farms accept network suggestions.

### S4.1 — Accept Central Planting Suggestions UI
**Effort**: M | **Owner**: Farm  
Farm Summary shows: "Central recommends: seed 4 trays kale this week." One-tap accept/dismiss. Accept auto-creates group config draft.

### S4.2 — Report Harvest Schedule to Central
**Effort**: S | **Owner**: Farm  
POST projected harvest dates from group seed dates + crop duration to Central.

### S4.3 — One-Tap Recipe Modifier Approve/Dismiss
**Effort**: M | **Owner**: Farm  
UI for reviewing Central recipe modifier suggestions. Approve applies modifier to next cycle. Dismiss logs as training signal.

### S4.4 — Harvest Schedule Coordination (Anti-Flooding)
**Effort**: L | **Owner**: Central  
Detect when multiple farms plan same crop harvest same week. Push warning: "4 farms harvesting romaine this week — consider holding."

### S4.5 — Supply/Demand Balancing
**Effort**: L | **Owner**: Central  
Aggregate demand forecasts + harvest predictions network-wide. Identify gaps: "Network needs 200 cases kale, trajectory: 150. Suggest 3 farms expand."

### S4.6 — A/B Test Orchestration
**Effort**: L | **Owner**: Central + Farm  
Central assigns spectrum experiments to specific farms/groups. Farms apply variant recipe, report outcomes. Central analyzes and publishes findings.

### S4.7 — Quality-Based Order Routing
**Effort**: M | **Owner**: Central  
Route buyer orders to farms with highest quality scores for that crop.

### S4.8 — Multi-Farm Benchmarking Dashboard
**Effort**: M | **Owner**: Central  
Admin view: all farms ranked by yield efficiency, order fulfillment, energy efficiency, loss rate.

### Sprint 4 Exit Criteria

- [ ] Farms can accept/dismiss Central planting suggestions from UI
- [ ] Central detects harvest schedule conflicts
- [ ] Supply/demand gap analysis produced and pushed weekly
- [ ] A/B experiment framework functional across 2+ farms
- [ ] Orders route to highest-quality farms
- [ ] Network dashboard shows real rankings

**Total Sprint 4 effort**: ~6 weeks

---

## Sprint 5: Phase 5 — Autonomous Operations (Days 111–150)

**Goal**: AI makes decisions within guardrailed bounds. Grower approves or overrides.

### S5.1 — Constrained Autonomous Recipe Adjustment
**Effort**: L | **Owner**: Farm  
Recipe modifiers auto-apply within bounds (±5% spectrum, ±1°C temp, ±15 PPFD) without grower tap. Auto-revert if 2 consecutive under-performance cycles. All autonomous actions logged in audit DB.

### S5.2 — AI-Driven Harvest Timing
**Effort**: M | **Owner**: Farm  
Replace fixed harvest date with readiness-based: agent analyzes growth rate, weight trend, quality scores → "Group 12 basil ready now — optimal window: next 48 hours."

### S5.3 — Voice-First Activity Hub
**Effort**: L | **Owner**: Farm  
Web Speech API on iPad PWA. Voice commands for harvest, seeding, quality checks. Intent recognition routes to existing API endpoints. No external API cost.

### S5.4 — Network Production Planning
**Effort**: L | **Owner**: Central  
Auto-generate weekly seeding plans per farm from demand forecast, succession needs, network supply balance, farm capacity.

### S5.5 — Autonomous Wholesale Matching
**Effort**: L | **Owner**: Central  
Match buyer demand to farm supply across network without human intervention. Quality-based routing.

### S5.6 — Predictive Inventory Listing
**Effort**: M | **Owner**: Central  
Based on harvest predictions, auto-list products on wholesale marketplace before harvest: "Available Feb 28 (85% confidence)."

### Sprint 5 Exit Criteria

- [ ] Recipe modifiers auto-apply within bounds; auto-revert on regression
- [ ] Growers receive readiness-based harvest notifications
- [ ] Voice commands work for core Activity Hub actions on iPad
- [ ] Central generates weekly seeding plans per farm
- [ ] Wholesale orders auto-route to best-quality farms
- [ ] Predicted inventory visible to buyers before harvest

**Total Sprint 5 effort**: ~6 weeks

---

## Autonomy Unlock Gates

No sprint unlocks autonomous operation without all conditions met:

| Gate | Threshold | Measured By |
|------|-----------|-------------|
| Model accuracy | > 85% for that decision type | Holdout test set |
| Grower acceptance rate | > 90% for AI suggestions | Audit DB accept/dismiss ratio |
| Safety record | 0 safety incidents in prior 100 cycles | Incident log |
| Data volume | Minimums per Training Data Strategy | Experiment record count |
| Governance review | Monthly review completed | Governance report |

---

## Critical Path

```
Sprint 0                    Sprint 1              Sprint 2               Sprint 3
┌─────────────────────┐     ┌──────────────┐      ┌─────────────────┐    ┌──────────────────┐
│ Wire P2/P4/P8/P1    │────▶│ Verify ML    │─────▶│ Workflow reduce │───▶│ Recipe modifiers │
│ Persist inventories │     │ Market data  │      │ Agent MVPs      │    │ Yield regression │
│ ML scheduling       │     │ Doc cleanup  │      │ KPI dashboard   │    │ Model retrain    │
└─────────────────────┘     └──────────────┘      └─────────────────┘    └──────────────────┘
~3 days                      ~3 days               ~3 weeks              ~5 weeks

Sprint 4                    Sprint 5
┌──────────────────────┐    ┌───────────────────┐
│ Network coordination │───▶│ Autonomous ops    │
│ A/B testing          │    │ Voice interface   │
│ Supply/demand balance│    │ Production plan   │
└──────────────────────┘    └───────────────────┘
~6 weeks                     ~6 weeks
```

**Total timeline**: ~24 weeks (Sprint 0–1 can start immediately)

---

## Immediate Next Actions (This Week)

1. **S0.1** — Wire P2 Adaptive Control (import, instantiate, pass to options) — 30 min
2. **S0.2** — Wire P8 Anomaly Diagnostics (add `/api/ml/diagnostics` route) — 1–2 hours
3. **S0.3** — Wire P4 Succession Planner (import, 7 routes) — 2–3 hours
4. **S0.4** — Fix P1 Device Discovery (add `POST /api/devices/scan`) — 1 hour
5. **S0.5** — Persist 5 volatile inventories to NeDB — 2–3 hours
6. **S0.6** — Add ML periodic scheduling — 2–3 hours

**After Sprint 0**: All 5 P-items are callable via API, data survives restarts, ML runs automatically. Then commit, push, request deployment approval.

---

## 52 AI Opportunities — Tracking Matrix

Per the AI Vision Report appendix. Status updated from audit.

| # | Opportunity | Phase | Status |
|---|------------|:-----:|:------:|
| 1 | Persist recipe params per group/day | 1 | **DONE** |
| 2 | Build harvest outcome experiment record | 1 | **DONE** |
| 3 | POST experiment records to Central on harvest | 1 | **DONE** (auto-triggered at L10200) |
| 4 | Wire loss events → environment correlation | 1 | **DONE** |
| 5 | Feed real demand into crop recommendation | 1 | **DONE** |
| 6 | Surface learning correlations on dashboard | 1 | **DONE** (API live, dashboard TBD) |
| 7 | Ingest experiment records endpoint (Central) | 1 | **DONE** |
| 8 | Nightly crop benchmark aggregation (Central) | 1 | **DONE** |
| 9 | Push crop benchmarks in AI recommendation channel | 1 | **DONE** |
| 10 | Extend AI training export with recipe params | 1 | **DONE** |
| 11 | Populate comparative analytics endpoint (Central) | 1 | **DONE** |
| 12 | Populate leaderboard with real scores (Central) | 1 | **DONE** |
| 13 | Auto-derive plant count from tray format | 2 | Sprint 2 |
| 14 | AI pre-fill crop at seeding + Central demand signals | 2 | Sprint 2 |
| 15 | Combine seed + group assignment | 2 | Sprint 2 |
| 16 | Auto-trigger label print on harvest | 2 | Sprint 2 |
| 17 | Auto-derive photoperiod from recipe | 2 | Sprint 2 |
| 18 | Remove duplicate seed date entry | 2 | Sprint 2 |
| 19 | Auto-discover lights from controller | 2 | Sprint 0 (P1 fix) |
| 20 | Demand signal aggregation + push to farms (Central) | 2 | Sprint 2 |
| 21 | New farm onboarding with network benchmarks (Central) | 2 | **DONE** (in AI push) |
| 22 | Environmental benchmark push (Central) | 2 | **DONE** (in AI push) |
| 23 | Populate network trends endpoint (Central) | 2 | **DONE** (real SQL) |
| 24 | Buyer behavior analysis + churn detection (Central) | 2 | **DONE** (real SQL) |
| 25 | Per-crop recipe modifier (farm-specific + Central) | 3 | Sprint 3 |
| 26 | Tier 2 adaptive control (HVAC learning) | 3 | Sprint 3 |
| 27 | LED aging detection | 3 | Sprint 3 |
| 28 | ML harvest date prediction | 3 | **DONE** (P3 harvest predictor) |
| 29 | Loss prediction from environment trends | 3 | Sprint 3 |
| 30 | Quality trend analysis from AI vision | 3 | Sprint 3 |
| 31 | Cross-farm yield regression ML model (Central) | 3 | Sprint 3 |
| 32 | Compute & push network recipe modifiers (Central) | 3 | Sprint 3 |
| 33 | Cross-farm anomaly correlation (Central) | 3 | **DONE** (real SQL in network-growers) |
| 34 | Loss pattern network alerts (Central) | 3 | **DONE** (alerts endpoint populated) |
| 35 | Cross-farm energy benchmarks (Central) | 3 | **DONE** (energy-benchmarks endpoint) |
| 36 | Per-farm performance tracking endpoint (Central) | 3 | **DONE** (performance/:growerId) |
| 37 | Accept Central planting suggestions UI | 4 | Sprint 4 |
| 38 | Report harvest schedule to Central | 4 | Sprint 4 |
| 39 | One-tap recipe modifier approve/dismiss | 4 | Sprint 4 |
| 40 | Harvest schedule coordination (anti-flooding) | 4 | Sprint 4 |
| 41 | Supply/demand balancing across farms (Central) | 4 | Sprint 4 |
| 42 | A/B test orchestration across farms (Central) | 4 | Sprint 4 |
| 43 | Quality-based order routing (Central) | 4 | Sprint 4 |
| 44 | Dynamic pricing engine (Central) | 4 | Sprint 3 (v1) |
| 45 | Automated recipe adjustment (with guardrails) | 5 | Sprint 5 |
| 46 | AI-driven harvest timing (ready-based) | 5 | Sprint 5 |
| 47 | Voice-first Activity Hub | 5 | Sprint 5 |
| 48 | Network production planning (Central) | 5 | Sprint 5 |
| 49 | Dynamic recipe distribution (Central) | 5 | Sprint 5 |
| 50 | Predictive inventory / auto wholesale listing (Central) | 5 | Sprint 5 |
| 51 | Autonomous wholesale matching (Central) | 5 | Sprint 5 |
| 52 | Market intelligence integration (Central) | 5 | Sprint 5 |

### Score: 22/52 complete (42%)

| Phase | Total | Done | Remaining |
|:-----:|:-----:|:----:|:---------:|
| 1 | 12 | **12** | 0 |
| 2 | 12 | **4** | 8 |
| 3 | 12 | **6** | 6 |
| 4 | 8 | **0** | 8 |
| 5 | 8 | **0** | 8 |

Phase 1 is **100% complete**. Phase 2–3 are partially done (Central-side work ahead of farm-side). Phases 4–5 are entirely ahead.

---

*This plan is based on the February 23, 2026 post-deployment code audit. It corrects inaccuracies in prior reports and provides verified status for all 52 AI opportunities.*
