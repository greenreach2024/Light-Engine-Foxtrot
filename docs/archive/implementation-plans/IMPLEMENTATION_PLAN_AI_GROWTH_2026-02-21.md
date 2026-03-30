# AI Growth Implementation Plan

Date: 2026-02-21  
Branch: main  
Status: REVIEW DRAFT  
Supersedes: AI_INTEGRATION_PROPOSAL.md, AI_GAPS_AND_OPPORTUNITIES.md (phasing sections), AI_AGENT_OPERATING_ACTION_PLAN_2026-02-21.md  
Source of truth for all AI agent growth execution.

---

## Guiding Principles

1. **Fix before build.** No new AI features until ML jobs run and volatile data stores are persistent.
2. **Central-first intelligence.** Farms collect and contribute; Central analyzes and pushes. The 5-min sync and 30-min AI push pipes are operational — put intelligence through them.
3. **Data before models.** Wire experiment records and recipe logging before building recommendation engines.
4. **Recommend before automate.** Every agent starts in recommendation-only mode. Autonomy unlocks only after proven accuracy and grower acceptance.
5. **One canonical roadmap.** This document is the single execution plan. All other proposal documents are reference material.

---

## Current State Summary

### What exists and works
| Asset | Location | Lines | Status |
|-------|----------|-------|--------|
| AI Agent (NL + actions) | `services/ai-agent.js` | 728 | Operational, GPT-4o-mini |
| Harvest Predictor | `lib/harvest-predictor.js` | 503 | Validated 39/39 |
| Adaptive VPD | `lib/adaptive-vpd.js` | 435 | Validated 56/56 |
| Anomaly Diagnostics | `lib/anomaly-diagnostics.js` | 490 | Validated 28/28 |
| Succession Planner | `lib/succession-planner.js` | 833 | Operational |
| Experiment Record API | `server-foxtrot.js:10066` | ~160 | Implemented, untested in prod |
| Applied Recipes DB (NeDB) | `appliedRecipesDB` | — | Logging recipe params per group/day |
| Central experiment ingest | `greenreach-central/routes/experiment-records.js` | 330 | Implemented |
| Central benchmark scheduler | `startBenchmarkScheduler()` | — | Wired, needs data volume |
| Central 5-min farm sync | `syncFarmData()` | — | Operational |
| Central 30-min AI push | `ai-recommendations-pusher.js` | — | Operational |
| Market Intelligence route | `routes/market-intelligence.js` | 302 | Static/hardcoded data |
| Purchase Leads CRM | `routes/purchase-leads.js` | 189 | Volatile in-memory Map |
| ML Training Pipeline | `lib/ml-training-pipeline.js` | 165 | Exists, not running |

### What is broken or missing
| Issue | Impact | Location |
|-------|--------|----------|
| ML jobs stale (51+ days) | IsolationForest + SARIMAX not running | Python backend scripts |
| 5 supply inventories in-memory | Data lost on restart | `server-foxtrot.js:17373-17377` |
| Purchase leads volatile | Lead CRM lost on restart | `routes/purchase-leads.js:12` |
| Market intelligence hardcoded | Pricing AI has no real data | `routes/market-intelligence.js` |
| 3 network analytics stubs | comparative-analytics, trends, alerts return `[]` | `greenreach-central/routes/network-growers.js` |
| 32 files drifted edge↔cloud | Every UI change applied twice | `public/` vs `greenreach-central/public/` |
| Harvest predictions not in dashboard | Backend done, no UI integration | `public/harvest-predictions.js` → farm-summary.html |
| Experiment records not auto-triggered | Endpoint exists, harvest flow doesn't call it | `POST /api/harvest/experiment-record` |
| Benchmarks endpoint empty | `/benchmarks` returns `[]` | `greenreach-central/server.js:2198` |

---

## Phase 0 — Fix Foundations (Days 1–10)

**Goal:** Stabilize data persistence and ML health so everything built on top is reliable.

### Tickets

| # | Ticket | Owner | Effort | Files |
|---|--------|-------|--------|-------|
| 0.1 | **Restart ML jobs** — diagnose why IsolationForest and SARIMAX stopped (outdoor sensor validation failure per ML report). Fix weather API fallback gating so ML runs even when outdoor sensor is absent. Validate both jobs complete a full cycle. | Edge | S | `backend/simple-anomaly-detector.py`, `backend/predictive_forecast.py`, `server-foxtrot.js` (ML job scheduling) |
| 0.2 | **Persist supply inventories** — move `seedsInventory`, `packagingInventory`, `nutrientsInventory`, `equipmentInventory`, `suppliesInventory` from in-memory arrays to NeDB stores. Load on boot, write-through on mutation. | Edge | M | `server-foxtrot.js:17373-17377` |
| 0.3 | **Persist purchase leads** — replace `const leads = new Map()` with NeDB-backed store. Preserve existing API contract. | Edge | S | `routes/purchase-leads.js:12` |
| 0.4 | **Wire experiment record into harvest flow** — when `POST /api/harvest` records a harvest, auto-call `buildExperimentRecord()` and persist + sync to Central. Currently the experiment endpoint exists but nothing calls it during normal harvest. | Edge | S | `server-foxtrot.js` (harvest endpoint ~L10392 → call experiment builder) |
| 0.5 | **Merge canonical roadmap doc** — add header notes to `AI_INTEGRATION_PROPOSAL.md`, `AI_GAPS_AND_OPPORTUNITIES.md`, and `AI_AGENT_OPERATING_ACTION_PLAN_2026-02-21.md` indicating they are superseded by this plan. | Docs | S | 3 markdown files |

### Exit Criteria
- [ ] `GET /api/ml/insights` returns fresh anomaly detection results (< 1 hour old)
- [ ] `GET /api/ml/forecast` returns SARIMAX predictions (< 1 hour old)
- [ ] Server restart preserves all supply inventories and purchase leads
- [ ] Every harvest auto-generates an experiment record in `harvestOutcomesDB`
- [ ] Central receives experiment records via `POST /api/sync/experiment-records`

---

## Phase 1 — Wire the Data (Days 11–30)

**Goal:** Close the data pipeline so Central has real experiment data flowing and can compute meaningful benchmarks.

### Tickets

| # | Ticket | Owner | Effort | Files |
|---|--------|-------|--------|-------|
| 1.1 | **Populate Central crop benchmarks** — ensure `startBenchmarkScheduler()` aggregates experiment records into per-crop network averages (weight/plant, grow days, loss rate). Verify the nightly job produces non-empty results. | Central | M | `greenreach-central/routes/experiment-records.js` |
| 1.2 | **Push crop benchmarks in AI recommendations** — extend `analyzeAndPushToAllFarms()` payload to include `network_intelligence.crop_benchmarks` alongside existing GPT recommendations. Farms receive: "your basil: 2.34 oz, network avg: 2.51 oz." | Central | S | `greenreach-central/services/ai-recommendations-pusher.js` |
| 1.3 | **Populate comparative analytics** — replace the 3 stub endpoints in `network-growers.js` that return `[]` with real queries against `farm_data` + experiment records. Start with yield comparison, loss rate, grow days. | Central | M | `greenreach-central/routes/network-growers.js:120,179,362` |
| 1.4 | **Replace hardcoded market data** — swap static crop prices in `routes/market-intelligence.js` with queries against actual wholesale order history from Central. If Central data unavailable, fall back to current static values (graceful degradation). | Edge | M | `routes/market-intelligence.js` |
| 1.5 | **Integrate harvest predictions into Farm Summary** — add `<script src="/harvest-predictions.js">` and render prediction badges on group cards in `farm-summary.html`. Backend is complete. | Edge | S | `public/views/farm-summary.html`, `public/harvest-predictions.js` |
| 1.6 | **Event taxonomy v1** — define canonical event names for: seed, transplant, harvest, loss, order, delivery, payout, quality-check, agent-action. Publish as `data/event-taxonomy.json`. Wire the 3 most common (seed, harvest, loss) to emit standardized events. | Edge | M | New: `data/event-taxonomy.json`, modify tray/harvest/loss handlers |
| 1.7 | **Agent permission matrix** — create `data/agent-permissions.json` defining per-agent-class action scopes and human-approval tiers (auto / recommend / require-approval). Load in `services/ai-agent.js` to gate actions. | Edge | S | New: `data/agent-permissions.json`, `services/ai-agent.js` |

### Exit Criteria
- [ ] Central crop benchmarks return non-empty data for at least 1 crop
- [ ] AI recommendation push includes `network_intelligence` block
- [ ] Comparative analytics endpoints return real farm data (not `[]`)
- [ ] Market intelligence returns prices derived from order history
- [ ] Harvest prediction badges visible on Farm Summary dashboard
- [ ] Event taxonomy published and 3 event types emitting standardized payloads
- [ ] Agent permissions loaded and enforced by AI agent service

---

## Phase 2 — Agent MVPs + Workflow Reduction (Days 31–60)

**Goal:** Deploy first 3 agent classes in recommendation mode. Reduce grower manual steps.

### Tickets

| # | Ticket | Owner | Effort | Files |
|---|--------|-------|--------|-------|
| 2.1 | **Admin Ops Agent** — create prompt template + tool routing for cross-farm alert triage, SLA risk, and ops summaries. Uses existing `ai-agent.js` infrastructure. Recommendation-only: generates summary + suggests interventions, no autonomous action. | Edge | M | `services/ai-agent.js` (add admin-ops intent class), new: `prompts/admin-ops.md` |
| 2.2 | **Marketing Growth Agent** — prompt template for lead scoring, outreach copy generation, SEO page drafts, and conversion analytics. Pulls from persisted leads DB (ticket 0.3). Generates content drafts, does not publish autonomously. | Edge/Central | M | `services/ai-agent.js` (add marketing intent class), new: `prompts/marketing.md` |
| 2.3 | **Payroll & Settlement Agent** — prompt template for payout reconciliation, exception detection, policy compliance checks. Read-only analysis of payment data. Flags anomalies, does not execute payments. | Central | M | New: `greenreach-central/services/payroll-agent.js`, `prompts/payroll.md` |
| 2.4 | **Weekly KPI dashboard scaffold** — build a `/api/kpis` endpoint returning the 7 core business metrics: fill rate, OTIF, contribution margin, loss rate, forecast error, labor minutes/kg, user-input reduction. Frontend: simple KPI cards page. | Edge + Central | L | New: `routes/kpis.js`, `public/views/kpi-dashboard.html` |
| 2.5 | **Auto-derive plant count from tray format** — when grower scans a tray at seeding, auto-fill plant count from tray format cell count mapping. Eliminate manual entry. | Edge | S | `server-foxtrot.js` (seeding handler) |
| 2.6 | **Auto-trigger label print on harvest scan** — when harvest event is recorded via Activity Hub QR scan, auto-generate lot code and trigger print. Eliminate separate print step. | Edge | S | `server-foxtrot.js` (harvest handler), `public/views/tray-inventory.html` |
| 2.7 | **Agent action audit log** — instrument all 3 agent classes to log every recommendation and action to a persistent audit DB. Schema: `{ agent_class, action_type, input_summary, recommendation, human_decision, timestamp }`. | Edge + Central | S | New: NeDB `agentAuditDB`, modify agent services |
| 2.8 | **Marketing funnel instrumentation** — track visitor→lead→demo→pilot→paid conversion events. Wire lead form submissions and demo scheduling to event taxonomy. | Edge | S | `routes/purchase-leads.js`, event taxonomy |

### Exit Criteria
- [ ] Admin Ops, Marketing, and Payroll agents respond to natural language queries with actionable recommendations
- [ ] All agent actions logged in audit DB with full context
- [ ] KPI dashboard displays real metrics (even if partial data)
- [ ] Plant count auto-fills from tray format (no manual entry)
- [ ] Harvest scan auto-generates lot code + triggers print
- [ ] Marketing funnel events tracked end-to-end

---

## Phase 3 — Closed-Loop Learning (Days 61–100)

**Goal:** Connect outcomes to inputs. Enable recipe evolution and model retraining.

### Tickets

| # | Ticket | Owner | Effort | Files |
|---|--------|-------|--------|-------|
| 3.1 | **Recipe modifier system** — after 10+ experiment records for a crop at a farm, compute per-crop recipe offset (±5% max per parameter: spectrum, PPFD, temp). Store as `data/recipe-modifiers.json`. Apply between recipe resolver and VPD/light controller. | Edge | L | New: `lib/recipe-modifier.js`, `data/recipe-modifiers.json` |
| 3.2 | **Cross-farm yield regression** — Central runs weekly: `weight/plant ~ f(blue_pct, red_pct, ppfd, temp_c, humidity_pct, grow_days)` across all farms' experiment records. Publishes network recipe modifiers per crop. | Central | L | New: `greenreach-central/jobs/yield-regression.js` or Python script |
| 3.3 | **Network recipe modifier push** — extend AI push channel to include `network_intelligence.recipe_modifiers` per crop. Farm UI shows: "Central suggests: +2% blue for basil (network data, 78% confidence)." Grower approves/dismisses with one tap. | Central + Edge | M | `greenreach-central/services/ai-recommendations-pusher.js`, edge: new UI component |
| 3.4 | **Weekly model retrain pipeline** — `lib/ml-training-pipeline.js` already exists (165 lines). Wire it to a weekly cron: retrain harvest predictor and anomaly detection with latest data. Log model performance metrics. Deploy if accuracy improves. | Edge | M | `lib/ml-training-pipeline.js`, add cron trigger in `server-foxtrot.js` |
| 3.5 | **Champion/challenger evaluation** — when a recipe modifier is applied on one group, track outcome vs. baseline (another group growing same crop without modifier). Report delta to Central. | Edge | M | `lib/recipe-modifier.js`, experiment record builder |
| 3.6 | **Dynamic pricing v1** — replace simulated pricing in `farm-admin.js` with real analysis: query own wholesale order history (price offered, accepted/rejected), compute price sensitivity per crop per buyer segment. Present suggestion with confidence range. | Edge + Central | M | `public/farm-admin.js` (L1176-1235), `routes/market-intelligence.js` |
| 3.7 | **Product Deployment Agent** — prompt + tool routing for new Light Engine site readiness scoring, preflight checks, deployment plan generation. Reads farm profile, network topology, and compliance baseline. Recommendation-only. | Central | M | New: `greenreach-central/services/deployment-agent.js`, `prompts/deployment.md` |
| 3.8 | **Strategy & Viability Agent** — prompt + tool routing for farm closure risk scoring and acquisition opportunity evaluation. Produces traffic-light scorecard (green/yellow/red) with 3 scenario options. Board-level review required before any action. | Central | M | New: `greenreach-central/services/viability-agent.js`, `prompts/viability.md` |
| 3.9 | **Alert prioritization model** — reduce alert fatigue by scoring anomaly alerts against farm context, historical dismiss rates, and severity. Only surface high-priority alerts. Track grower response to tune thresholds. | Edge | M | `lib/anomaly-diagnostics.js`, new: `lib/alert-prioritizer.js` |

### Exit Criteria
- [ ] Recipe modifiers computed and applied for at least 1 crop with 10+ experiment records
- [ ] Central publishes network recipe modifiers in AI push channel
- [ ] Model retrain pipeline runs weekly, logs accuracy metrics
- [ ] Champion/challenger delta tracked for modified vs. baseline groups
- [ ] Dynamic pricing shows real price suggestions based on order history
- [ ] 5 agent classes operational (Admin, Marketing, Payroll, Deployment, Viability)
- [ ] Alert noise reduced measurably (dismiss rate tracked)

---

## Phase 4 — Network Coordination + Scale (Days 101–150)

**Goal:** Central coordinates supply/demand across farms. Codebase consolidated for faster iteration.

### Tickets

| # | Ticket | Owner | Effort | Files |
|---|--------|-------|--------|-------|
| 4.1 | **Consolidate Light Engine codebase** — execute the Consolidation Proposal: create `light-engine/` single source, symlink from Central, feature-detect edge vs. cloud. Eliminate 32-file drift. | Edge + Central | L | Per `LIGHT_ENGINE_CONSOLIDATION_PROPOSAL.md` |
| 4.2 | **Harvest schedule coordination** — Central detects when multiple farms plan the same crop harvest in the same week (market flooding risk). Push warning: "4 farms harvesting romaine this week — consider holding or redirecting." | Central | L | `greenreach-central/routes/experiment-records.js`, AI push |
| 4.3 | **Supply/demand balancing** — Central aggregates demand forecasts + harvest predictions across network. Identifies gaps: "Network needs 200 cases kale next month, trajectory: 150. Suggest 3 farms expand." Push recommendations. | Central | L | New: `greenreach-central/jobs/supply-demand-balancer.js` |
| 4.4 | **Accept Central planting suggestions UI** — Farm Summary shows: "Central recommends: seed 4 trays kale this week." One-tap accept/dismiss. Accept auto-creates group config draft. | Edge | M | `public/views/farm-summary.html` |
| 4.5 | **Multi-farm benchmarking dashboard** — Central admin view showing all farms ranked by yield efficiency, order fulfillment, energy efficiency, loss rate. Powered by real experiment records and crop benchmarks. | Central | M | New: `greenreach-central/public/views/network-dashboard.html` |
| 4.6 | **Developer mode exploration (Farm Assistant)** — per TOMORROW_TODOS: let Light Engine users make update requests via Farm Assistant. Agent evaluates feasibility, proposes changes, routes through safety gates. MVP: text-only requests, single-file scope, human approval required. | Edge | L | `services/ai-agent.js`, new: `lib/developer-mode.js` |
| 4.7 | **A/B recipe experiments** — Central assigns spectrum experiment parameters to specific farms/groups. Farms apply variant recipe to designated groups, report outcomes. Central analyzes and publishes findings network-wide. | Central + Edge | L | New: `greenreach-central/jobs/experiment-orchestrator.js` |
| 4.8 | **Governance cadence** — monthly AI governance review template. Covers: model accuracy trends, agent action audit summary, safety incidents, data quality scores, recommendation acceptance rates. Auto-generated report from audit DB + experiment records. | Central | S | New: `greenreach-central/reports/governance-review.js` |

### Exit Criteria
- [ ] Single Light Engine codebase serving both edge and cloud deployments
- [ ] Central detects and warns about harvest schedule conflicts
- [ ] Supply/demand gap analysis produced and pushed to farms
- [ ] Farms can accept/dismiss Central planting suggestions from UI
- [ ] Network dashboard shows real cross-farm rankings
- [ ] Developer mode MVP functional (text request → agent evaluation → human approval)
- [ ] Monthly governance report auto-generates

---

## Phase 5 — Autonomous Operations (Days 151–210)

**Goal:** AI makes decisions within guardrailed bounds. Grower approves or overrides. Central orchestrates the network.

### Tickets

| # | Ticket | Owner | Effort | Files |
|---|--------|-------|--------|-------|
| 5.1 | **Constrained autonomous recipe adjustment** — recipe modifiers auto-apply within guardrail bounds (±5% spectrum, ±1°C temp, ±15 PPFD) without grower tap. Auto-revert if 2 consecutive cycles underperform baseline. Log all autonomous actions in audit DB. | Edge | L | `lib/recipe-modifier.js` |
| 5.2 | **AI-driven harvest timing** — replace fixed harvest date with readiness-based notification: agent analyzes growth rate, weight trend, and quality scores to recommend optimal harvest window. Push: "Group 12 basil ready now — optimal quality window: next 48 hours." | Edge | M | `lib/harvest-predictor.js`, notifications |
| 5.3 | **Voice-first Activity Hub** — add Web Speech API to Activity Hub iPad PWA. Voice commands for harvest, seeding, quality checks. Intent recognition routes to existing API endpoints. No external API cost. | Edge | L | `public/views/tray-inventory.html` |
| 5.4 | **Network production planning** — Central auto-generates weekly seeding plans per farm based on demand forecast, succession needs, network supply balance, and farm capacity. Farms receive as suggestions (Phase 5 = auto-apply with override). | Central | L | `greenreach-central/jobs/production-planner.js` |
| 5.5 | **Autonomous wholesale matching** — Central matches buyer demand to farm supply across network without human intervention. Quality-based routing: orders go to farms with highest quality scores for that crop. | Central | L | `greenreach-central/routes/wholesale.js` |
| 5.6 | **Predictive inventory listing** — based on Central's harvest predictions, auto-list products on wholesale marketplace before harvest. Buyers see "Available Feb 28" with confidence level. | Central | M | `greenreach-central/services/wholesale-network-aggregator.js` |

### Exit Criteria
- [ ] Recipe modifiers auto-apply within bounds; auto-revert on regression
- [ ] Growers receive readiness-based harvest notifications (not fixed dates)
- [ ] Voice commands work for core Activity Hub actions on iPad
- [ ] Central generates weekly seeding plans per farm
- [ ] Wholesale orders auto-route to best-quality farms
- [ ] Predicted inventory visible to buyers before harvest

---

## Autonomy Unlock Gates

No phase unlocks autonomous operation until all conditions are met:

| Gate | Threshold | Measured By |
|------|-----------|-------------|
| Model accuracy | > 85% for that decision type | Holdout test set evaluation |
| Grower acceptance rate | > 90% for AI suggestions | Agent audit DB accept/dismiss ratio |
| Safety record | 0 safety incidents in previous 100 cycles | Incident log review |
| Data volume | Minimum per Training Data Strategy | Experiment record count query |
| Governance review | Monthly review completed and signed off | Governance report |

---

## Resource Assumptions

| Role | Allocation | Notes |
|------|-----------|-------|
| Founding engineer | 70% (primary) | Full-stack, all phases |
| AI agents (Copilot/GPT) | Support | Code generation, content drafts, analysis |
| OpenAI API | ~$25-50/month | GPT-4o-mini for all agent classes at current usage |
| Open-Meteo weather API | Free | Already integrated, no key required |
| External APIs | $0 initially | USDA AMS (free) if needed for pricing; own data preferred |
| Cloud compute (Central) | Existing AWS | Elastic Beanstalk already deployed |

**Total budget required for Phase 0–2: $0 beyond existing infrastructure + founder time.**

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| ML jobs fail to restart (Python env issue) | Medium | High | Document exact Python env; Docker container for ML if needed |
| Insufficient experiment records for regression | High (early) | Medium | Start rule-based recipe modifiers; switch to ML at 10+ records/crop |
| Grower ignores AI recommendations | Medium | Medium | Track acceptance rate; tune recommendations based on dismiss patterns |
| Agent generates harmful recommendation | Low | High | Permission matrix + human-approval tiers + audit logging |
| Central database grows large | Low (near-term) | Low | PostgreSQL handles scale; add retention policy at 10K+ records |
| Codebase consolidation breaks deployments | Medium | High | Feature-flag approach; run both paths during migration; E2E tests |
| Single engineer bottleneck | High | High | Prioritize ruthlessly; Phase 0-1 are small tickets that compound |

---

## Timeline Summary

```
Days 1-10    PHASE 0  Fix Foundations         5 tickets   (S-M effort)
Days 11-30   PHASE 1  Wire the Data           7 tickets   (S-M effort)
Days 31-60   PHASE 2  Agent MVPs + Workflow   8 tickets   (S-L effort)
Days 61-100  PHASE 3  Closed-Loop Learning    9 tickets   (M-L effort)
Days 101-150 PHASE 4  Network Coordination    8 tickets   (M-L effort)
Days 151-210 PHASE 5  Autonomous Operations   6 tickets   (M-L effort)
             ─────────────────────────────────────────
             TOTAL:   43 tickets across 210 days
```

### Critical Path
```
0.1 (ML jobs) ──→ 3.4 (retrain pipeline)
0.4 (experiment records) ──→ 1.1 (benchmarks) ──→ 1.2 (push) ──→ 3.2 (regression)
0.4 ──→ 3.1 (recipe modifiers) ──→ 3.5 (champion/challenger) ──→ 5.1 (autonomous)
1.7 (permissions) ──→ 2.1-2.3 (agents) ──→ 2.7 (audit) ──→ 4.8 (governance)
1.4 (market data) ──→ 3.6 (dynamic pricing) ──→ 5.5 (autonomous wholesale)
```

---

## Immediate Next Actions (This Week)

1. **Ticket 0.1** — SSH to edge device, diagnose ML job failure, fix outdoor sensor gating, restart jobs.
2. **Ticket 0.3** — Replace `const leads = new Map()` with NeDB in `purchase-leads.js`.
3. **Ticket 0.4** — Add `buildExperimentRecord()` call inside existing `POST /api/harvest` handler.
4. **Ticket 0.5** — Add superseded headers to 3 proposal docs.

These 4 tickets can be completed in 1-2 days and unblock Phases 1-3.

---

*This plan is derived from the consolidated review of 10 proposal documents and validated against the current codebase as of 2026-02-21. It represents the canonical execution roadmap for AI-driven growth at GreenReach.*
