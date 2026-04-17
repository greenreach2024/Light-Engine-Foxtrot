# GreenReach — GWEN / EVIE / FAYE + Automation + ML Review
**Date:** 2026-04-17
**Repo:** greenreach2024/Light-Engine-Foxtrot
**Scope:** Review of the three AI agents (GWEN, EVIE, FAYE), the automation engine, the ML/analytics stack, and the AI Vision documents. Identifies gaps, opportunities, and recommended features, extensions, tools, and skills.

**Companion plan:** `docs/ai-agents/GREENREACH_IMPLEMENTATION_PLAN_2026-04-17.md`

---

## 0A. Post-Review Addendum (2026-04-17 Nutrient Monitoring)

After this review was drafted, monitor-only nutrient controller visibility was implemented in LE/E.V.I.E.:

1. MQTT nutrient devices are now surfaced during discovery and mapped as nutrient-controller class devices.
2. Device Manager now shows a dedicated **Nutrient Controllers** group rather than generic MQTT-only labeling.
3. MQTT cards now use a **Monitor** action that opens live nutrient status from `/data/nutrient-dashboard`.
4. LE exposes nutrient controller inventory for discovery callers through `/api/nutrients/mqtt-devices` and `/api/devices/mqtt`.

This closes a portion of the previously identified EVIE infrastructure-visibility gap for monitor workflows (control workflows remain intentionally constrained).

---

## 0. TL;DR

You are at **96% of the declared AI Vision roadmap** (48/52 tasks, 5 feedback loops closed) and the network brain is live. The backend intelligence is mature. The visible gaps fall into four buckets:

1. **UX lag** — ~60% of the AI capability has no grower-facing UI. Recipe modifiers, loss predictions, learning correlations, experiment records, harvest readiness — all deployed, none shown. This is the highest ROI work.
2. **Agent–Infrastructure gap** — EVIE can explain the farm but cannot fully operate it. The GPT agent has 13 categories / 67 actions but **zero infrastructure write actions** despite 94 REST endpoints existing for rooms/zones/groups/devices. The farm-ops-agent and assistant-chat routes are 5K+ and 8K lines respectively — the plumbing exists, it just isn't wired to a unified tool surface.
3. **Operational durability** — 9 volatile in-memory stores, ML cron jobs configured but not running (last IsolationForest run Dec 7 2025), SARIMAX retrainer is a stub, edge backup script missing three of six critical files, Central backup endpoint never called from the edge. A single reboot can vaporize production data.
4. **Agent governance mechanics** — FAYE's trust tiers, shadow mode, outcome taxonomy, and policy engine are described beautifully in `FAYE_VISION.md` but only partially evident in code. The explainability layer, insider-threat monitoring, federated IoT detection, and cross-agent handoff protocol are on the backlog.

GWEN is the most conceptually coherent of the three (single large route, first-class code-execution policy, dynamic workspace, persistent memory) but lacks a published vision document and has no formal handoff surface to EVIE/FAYE for operational questions that should escape the research bubble.

The report below is organized by: **(A) Current State → (B) Gaps → (C) Opportunities → (D) Recommended features/extensions/tools/skills**, with a prioritized roadmap at the end.

---

## 1. Agent Portfolio — Current State

### 1.1 E.V.I.E. — Environmental Vision & Intelligence Engine
**Role:** Farm-level, grower-facing ambient assistant. Single-farm scope.
**Code:** `greenreach-central/routes/assistant-chat.js` (7,915 lines, 50+ tools), `routes/farm-ops-agent.js` (5,267 lines), frontend `public/js/farm-assistant.js` (1,358 lines keyword-matching UI).
**Modes:** Ambient Presence, Grower Support, Public Demo, Guided Tour, Escalation.
**Reports to:** F.A.Y.E. for network issues, admin for policy.
**LLM:** GPT-4o-mini (via `services/ai-agent.js`, 2,399 lines).
**Strengths:** Nightly checklist, lot-system integration, clear visual identity, scanning/onboarding flow well specified.
**Weakness:** Can describe infrastructure but can't change it. The keyword-matching "Cheo" frontend is explicitly end-of-life.

### 1.2 F.A.Y.E. — Farm Autonomy & Yield Engine
**Role:** Network operations intelligence. Governed autonomy across all farms.
**Code:** Distributed across Central — `admin-ops-agent.js`, `admin-ai-monitoring.js`, `market-intelligence.js`, `misc-stubs.js`, plus 7 `research-*.js` routes.
**Autonomy:** L0 Reactive → L4 Autonomous (currently Phase 6 Governed Autonomy).
**Trust tiers:** AUTO → QUICK_CONFIRM → CONFIRM → ADMIN.
**Action classes:** recommend, classify, notify, modify, transact, override.
**Domain ownership:** Alert Triage, Accounting Classification, Farm Health Monitoring, Order Oversight, Payment Processing, Network Management, EVIE Oversight, Market Intelligence.
**Strengths:** Explicit policy envelope, shadow mode, outcome taxonomy, nightly checklist, security workbook with research-grounded backlog.
**Weakness:** Governance mechanics (tier promotion, shadow→live, outcome log, explainability) are described in vision docs but the concrete state machine isn't obviously present in a single place in code.

### 1.3 G.W.E.N. — Grants, Workplans, Evidence & Navigation
**Role:** Research workspace assistant. Operates exclusively inside the research bubble.
**Code:** `greenreach-central/routes/gwen-research-agent.js` (6,362 lines) plus **27 `research-*.js` route files** (studies, collaborations, compliance, data, deadlines, ELN, equipment, ethics, exports, grants, HQP, integrations, invitations, lineage, partners, publications, recipes, reporting, security, workspace-ops, etc.).
**LLM:** Gemini 2.5 Pro via Vertex AI.
**Memory:** `gwen_memory`, `gwen_evolution_journal`, in-memory (2h TTL, 50 messages).
**Workspace:** Dynamic `workspaceDisplays` map for researcher-created charts/tables.
**Code execution:** Gated by `GWEN_EXECUTE_CODE_ENABLED` / windows / allowlist, logged to `code_execution_logs`.
**Strengths:** Deepest tool catalog (100+), most mature memory model, clean research isolation, code-exec policy is exemplary.
**Weakness:** No `GWEN_VISION.md`. No codified handoff to EVIE/FAYE when a research question bleeds into operations.

### 1.4 Agent portfolio as a whole
The three agents are designed to cover complementary scopes — grower, network, research — but the **inter-agent contract is implicit**. There is no shared message bus, no published "escalation envelope", no shared identity model (researcher who is also a grower), no shared outcome logger that lets FAYE learn from EVIE's dismissed recommendations or from GWEN's experiment outcomes.

---

## 2. Automation Engine — Current State

**Code layout:** `automation/` with `engine.js` (496 lines), `controller-orchestrator.js`, `fan-rotation.js`, `growth-stage-manager.js` (360 lines), `recipe-environmental-targets.js`, `psychrometrics.js`, `plug-manager.js`, `plug-registry.js`, `env-store.js`, `rules-store.js`, `hardware-capabilities.js`.

**Controllers:** `vpd-controller.js` (405 lines, hysteresis, min on/off, duty caps, decay), `irrigation-controller.js`, `mixing-controller.js`, `ventilation-controller.js`.

**Drivers:** `kasa-driver.js`, `shelly-driver.js`, `switchbot-driver.js`.

**Key capabilities verified:**
- Rule-based control with guard state (rate-limit events per plug).
- VPD orchestration through `ControllerOrchestrator` with psychrometric math.
- Idempotent optimization: skips actions already in desired state.
- Fan rotation controller for demand-based overrides.
- Growth stage manager with **ramped transitions** (linear interpolation over `rampDurationHours`) between propagation / vegetative / finishing.
- Absolute safe-limit bounds enforcement.
- Adaptive control tiers 1–2 active; tier 3 (neural) commented out.
- Device safety envelope + NeDB audit trail.
- Spectral solver (NNLS, 3×4 mixing matrix).

**ESP32 serial / env bridge:** `esp32-env-service.py`, `esp32-serial-reader.py`.

The automation stack is notably **more engineered** than the agent layer — it has real hysteresis, cooldowns, decay, ramping. This is where the scientific-instrument identity actually lives in code.

---

## 3. ML / Analytics — Current State

**ML Gateway:** `services/ml-gateway.js` — thin HTTP wrapper around ML service on :8091 with TTL caches (15s anomalies, 5min effects).

**Python scripts (not a package, loose files):**
- `scripts/ml-anomaly-cron.py` — IsolationForest driver.
- `scripts/simple-anomaly-detector.py` — lighter-weight detector.
- `scripts/effects-learner.py` — correlation learner.
- `scripts/import-lighting-recipes.py`, `scripts/convert-recipes-to-json.py` — data wrangling.
- `scripts/esp32-sensor-reader.py`, `scripts/mqtt-nutrient-monitor-unified.py` — ingestion.

**ML Models (5 active per AI_VISION_REPORT §12.2):**
1. IsolationForest anomaly detection (15-min).
2. Cross-farm yield OLS regression (weekly).
3. Per-crop yield + grow-day regression (weekly).
4. ML metrics + drift detection (data 15%, concept 30%).
5. SARIMAX retrainer — **stub** (mock training).

**Recommendation systems (7):** crop engine, recipe modifier (±5% capped), network recipe modifiers, AI recommendations pusher (GPT-4, 30-min), AI insights, device integration recs, device-to-group auto-assignment.

**Prediction systems (4):** harvest predictor, harvest readiness, loss predictor, ML temperature forecast.

**Learning systems (5):** experiment record, experiment sync, nightly crop benchmarks (2 AM), ML training pipeline, alert response learning.

**Network intelligence (7):** crop benchmark push, supply/demand balancer, harvest conflict detection, demand signal analysis, network risk alerts, farm leaderboard, market intelligence.

**Energy forecaster:** `analytics/energy-forecaster/` — independent sub-project with `adapters/`, `calculators/`, `cli/`, `pipelines/`, `services/`, `tests/`. Not wired into main dashboard per readiness report.

**Vision:** GPT-4o-mini plant health analysis (requires `OPENAI_API_KEY`).

**Automatic schedule (confirmed):** 18 timers from 30-second heartbeats to daily full syncs and weekly ML retrains.

---

## 4. AI Vision Docs — State of the Roadmap

Per `AI_VISION_READINESS_REPORT_2026-02-23.md` + `AI_VISION_REPORT.md`:

| Phase | Name | Done | Partial | % |
|:---:|---|:---:|:---:|:---:|
| 1 | Wire Data + Central Benchmarks | 11 | 1 | 96 |
| 2 | Workflow Automation + Central Intel | 9 | 3 | 88 |
| 3 | Adaptive Intelligence + Central ML | 12 | 0 | 100 |
| 4 | Network Coordination | 8 | 0 | 100 |
| 5 | Autonomous Operations | 8 | 0 | 100 |
| **Total** | | **48** | **4** | **96** |

**All five feedback loops closed:** Recipe→Yield, Environment→Loss, Spectrum→Quality, Timing→Efficiency, Demand→Production.

**Remaining partials (~14 h effort):** T6 learning-correlations dashboard, T16 auto-print, T19 auto-assign lights, T21 onboarding benchmarks step.

**Known risks (per vision report §12.7):** 39 commits ahead of main; 9 volatile in-memory stores; SARIMAX retrainer stub; UX ~60% missing; training-data volume insufficient for production-grade ML.

---

## 5. Gaps

### 5.1 UX ↔ Backend coverage gap (highest impact)
Per AI_VISION_REPORT §12.5, ~23 front-end tasks are missing against deployed backend:
- **UX-1 Recipe Modifier Management** — 10 endpoints, **zero UI**.
- **UX-2 Loss Prediction Alerts** — 48-h risk computed, not displayed.
- **UX-3 Learning correlations** — discovered, not shown.
- **UX-4 Harvest readiness** — data only reachable via voice.
- **UX-5 Experiment record viewer** — no history, no stats page.
- **UX-6/7 Harvest projections + growth analysis** — no calendars, no curves.
- **UX-10 Dashboard AI cards** — static display-only; not wired to real API data.
- **UX-12 LED aging alerts** — no admin UI.
- **UX-13–19 Central admin / wholesale** — experiment orchestrator, recipe version sharing, predictive inventory, dynamic pricing, demand analysis, harvest conflict timeline — mostly absent.

### 5.2 Agent ↔ Infrastructure gap
- `services/ai-agent.js` has no infrastructure write actions despite 94 REST endpoints (rooms, zones, groups, devices, bus mappings, schedules).
- EVIE scanning plan (`EVIE_SCANNING_INTEGRATION_IMPLEMENTATION_TODO_2026-03-28.md`) defines `scan_bus_channels`, `get_bus_mappings`, `save_bus_mapping`, and unified `scan_devices` but these are queued rather than shipped.
- No conversational onboarding state machine — each chat turn is stateless beyond memory.
- No "unknown equipment handler" — if SwitchBot returns an unrecognized device type, the agent has nothing to say.
- `farm-assistant.js` (Cheo) is keyword-matching only; it shouldn't be the front door but is still mounted.

### 5.3 Agent ↔ Agent handoff gap
- No formal escalation envelope from EVIE to FAYE (schema for "farm X sees cross-farm symptom Y").
- No research-to-operations bridge from GWEN to FAYE (e.g., a study concludes with a recipe recommendation → how does it reach production recipes?).
- No shared identity model: a grower who is also a researcher has two disjoint conversational surfaces.
- No shared outcome/feedback log. EVIE can be dismissed; FAYE can act; GWEN can conclude — none of those write into a single learnable ledger.

### 5.4 Governance / Trust-tier implementation gap
- FAYE_VISION.md describes trust tiers (AUTO/QUICK_CONFIRM/CONFIRM/ADMIN) but no single module implements tier promotion based on outcome metrics.
- Shadow mode is defined (action proposed but not executed, scored later) but there's no obvious shadow-decision log table feeding the learning engine.
- Outcome taxonomy (positive / negative / neutral / shadow / fp_confirmed / fp_rejected) is defined; the enumeration is not yet consistently emitted by all FAYE tools.
- Explainability layer (per Sharma et al. 2025 in `faye-security-workbook.md`) is only partially populated — `run_security_audit` got it first.

### 5.5 Data durability + ML reliability gap
Cross-referencing `AGENT_SKILLS_FRAMEWORK_UPDATE_2026-02-07.md` Incidents 6–8 and readiness report risks:
- **Incident #6:** `scripts/backup-edge-data.sh` backs up 3/6 critical files; `equipment-metadata.json`, `automation-rules.json`, `env.json` **never backed up**. `POST /api/farms/:farmId/backup` exists but the edge **never calls it**.
- **ML cron jobs defined via PM2 but not running** (per `ML_AI_FEATURES_REPORT.md`); last IsolationForest run was Dec 7 2025 — stale for months.
- 9 volatile in-memory stores (orders, audit, reservations, etc.) per readiness report.
- SARIMAX retrainer returns mock results.
- Energy forecaster sub-project has no wire into the dashboard.

### 5.6 Scientific-instrument gap (experiment design)
- Experiment records are auto-generated on harvest — good.
- A/B orchestrator exists — good.
- But there is **no hypothesis registry**: a grower or researcher cannot register a prospective claim ("I think +5% blue at propagation raises tray weight 8%") before the system collects evidence. Pre-registration is the scientific-instrument missing link.
- No power-analysis tool: how many replicate trays are required to reach 0.05 significance on a given effect?
- No negative-result surfacing: experiments that failed should be as visible as those that succeeded.

### 5.7 Observability / SRE gap for agents
- Agent call counts are tracked (`Admin AI Monitoring`) but there's no per-tool latency histogram, no tool-level error budget, no regression test suite for tool contracts.
- Conversation continuity bug (fixed 2026-03-28) is symptomatic — conversation_id persistence was only fixed after incident.
- No prompt-injection defense documented for EVIE/FAYE (the public demo mode is a vector).
- No token-spend budget alarm per farm.

### 5.8 Security gap (per faye-security-workbook.md)
- P1 behavioral baseline + P1 anomaly scoring: in-progress.
- P2 threat attribution: in-progress.
- P3 IoT sensor anomaly detection: in-progress.
- Federated IoT security (Hernandez-Ramos et al. 2025): deferred.
- No signed-action authorization for destructive write operations (JWT alone, no step-up).
- Incident log format is free text — not yet structured / queryable.

### 5.9 Automation gap (despite strong engineering)
- **No controllers for CO₂ enrichment, nutrient dosing, pH correction, or chilled-water loops** (only VPD, mixing, ventilation, irrigation).
- No driver abstraction for Modbus / BACnet / 0–10 V (Kasa, Shelly, SwitchBot only) — large swath of commercial HVAC/fertigation is unreachable.
- No simulation / dry-run mode for automation changes.
- Rule schema is not versioned; a bad rule can be edited in place without rollback.
- Recipe immutability is a principle (per `AI_ASSISTANT_CAPABILITIES_REVIEW.md`) but not enforced by a signed-recipe checksum or version lock.
- Guard state is in-memory and resets on restart → rate limits are weaker than advertised after a bounce.

### 5.10 Lot system + compliance gap
- SFCR compliance is described in FAYE_VISION but recall coordination, expiring-inventory triggers, and cross-farm quality correlation don't have visible dashboards.
- No COA (Certificate of Analysis) generation tool despite QA photos + grading being captured.
- No chain-of-custody export for a given lot ID (seed lot → transplant → harvest → pack → ship) as a single PDF.

### 5.11 Grower-mode ergonomics gap
- Activity Hub is tap-based; voice exists but is "limited command set, no continuous listening" (UX-20).
- No offline-first PWA mode documented, despite edge-first rhetoric.
- No multi-language UI (grower workforce often bilingual).
- Hands-free mode for transplant/harvest stations is specifically called out in AI_GAPS_AND_OPPORTUNITIES Opportunity 3 but unshipped.

---

## 6. Opportunities

### 6.1 Convert backend mastery to visible UX (Sprints A–D already scoped)
Vision report estimates 8–11 days for the full visual surface. Highest-impact cards:
- Harvest readiness + loss risk alert cards on grower dashboard.
- Recipe modifier accept/dismiss panel with champion/challenger view.
- Learning correlations widget.
- Experiment record table.
- Central experiment orchestrator CRUD.
- Predictive inventory + dynamic pricing in buyer portal.

### 6.2 Unify the three agents behind a single tool surface
The codebase has `assistant-chat.js`, `farm-ops-agent.js`, `gwen-research-agent.js`, plus `services/ai-agent.js`, plus `admin-ops-agent.js`, plus `admin-assistant.js`, plus `scott-marketing-agent.js`, plus `setup-agent.js`. That's **seven agent-shaped things**. Consolidating to a **single tool gateway** (schema-validated, audited, idempotent, per-tool permission matrix) would cut maintenance, unlock consistent eval, and make EVIE↔FAYE↔GWEN handoff trivial.

### 6.3 Complete the feedback loops with a shared outcome ledger
A single `agent_outcomes` table keyed by `(agent, tool, action, outcome_class, evidence_ref)` would let all three agents learn from each other and let FAYE's learning engine ingest EVIE's dismissals and GWEN's experiment results without bespoke pipes.

### 6.4 Formalize the scientific-instrument identity
Pre-registered hypotheses, power analysis, and negative-result surfacing would make every farm a publishable experiment platform — which is the vision report's stated position. This also unlocks grant narrative.

### 6.5 Network effects: you already have them, surface them
Central pushes recipe modifiers, benchmarks, harvest conflicts, and demand signals every 30 min — but Leaderboard, Benchmark-vs-your-farm, and "3 other farms improved basil yield this week" notifications don't exist in UI. Cheap to build, retention-positive.

### 6.6 Compliance-grade traceability
SFCR + CFIA + FSMA modules are adjacent. A single "lot passport" PDF with photos, environment summary, recipe fingerprint, harvest weight, grade, and QR chain-of-custody is a direct regulatory sell.

### 6.7 Grower hands-free mode
Continuous voice listening at the harvest station + speaker feedback. Web Speech API is free. This is specifically AI_GAPS Opportunity 3 and still unshipped. 80% data-entry time reduction is realistic.

### 6.8 Protocol expansion (Modbus/BACnet/0–10V)
The commercial indoor-farm HVAC/fertigation world runs on Modbus + BACnet. Adding two drivers opens up every serious installation. Also lets Central onboard greenhouse operations, not just container farms.

### 6.9 Edge resiliency as a product
Persist volatile stores, wire edge→Central backup cron, expand backup script to 6 files, add pre-stash hook, add signed actions for destructive ops. These are each 1–4 h but collectively raise the trust floor.

### 6.10 Federated learning for IoT security (per FAYE security workbook)
Deferred item but high-value once >5 farms are onboarded. Sensor-behavior baselines per-farm → anomaly scoring across farms → federated attribution without shipping raw telemetry.

### 6.11 GWEN as a first-class research product
There is no `GWEN_VISION.md`. Writing one — peer to EVIE/FAYE, explicit about the research bubble and code-exec policy — would:
- Make the agent legible to funders/IRBs.
- Seed the published handoff contract to FAYE.
- Give a home to the grant lifecycle, ELN, publications, and HQP modules (27 `research-*.js` files).
- Enable a **research → production recipe promotion** pipeline (see §7.3 below).

### 6.12 Embedded vision analytics
GPT-4o vision is used for plant health; it is not used for **pest identification, nutrient deficiency classification, or tray-fill estimation**. Each is a simple prompt variant. Tray-fill estimation alone would cut the "how many plants per tray?" question out of every Activity-Hub interaction.

### 6.13 Market intelligence for growers (not just admins)
FAYE's market intelligence module is admin-facing. Surfacing "basil wholesale up 12% NE-US this week, your basil grows cheaper than average — expand by 20 trays?" directly to a grower is a pricing-feedback loop most competitors miss.

### 6.14 AI-assisted SOP authoring
A farm accumulates tacit knowledge ("run fans 10 min before dehu cycles on Tuesdays"). GWEN (research) or FAYE (operations) could consume audit logs and emit draft SOPs for human approval. This makes institutional knowledge portable across staff turnover.

### 6.15 Digital twin for simulation
Every farm is already a state machine (rooms × zones × devices × schedules × recipes). A lightweight twin ("if I change the basil recipe to +2% blue and shift seeding by 3 days, what's my 4-week harvest curve?") would make every recommendation previewable before approval — satisfies FAYE's "draft → preview → confirm → apply" principle directly.

---

## 7. Recommended Features, Extensions, Tools, Skills

### 7.1 Features (user-visible)

| # | Feature | Owner | Effort | Impact |
|:--:|---|---|:--:|---|
| F1 | Recipe modifier accept/dismiss panel with champion/challenger | EVIE + Central admin | M | HIGH — single biggest UX gap |
| F2 | Harvest readiness + loss-risk cards on grower dashboard | EVIE | S | HIGH |
| F3 | Learning correlations widget ("your basil +12% yield with +5% blue, n=14, p=0.04") | EVIE | S | HIGH |
| F4 | Experiment record viewer + stats page | GWEN + EVIE | M | HIGH (scientific-instrument identity) |
| F5 | Hypothesis pre-registration + power analysis tool | GWEN | M | MEDIUM (grant+credibility) |
| F6 | Negative-results board | GWEN | S | MEDIUM |
| F7 | Harvest conflict timeline + supply/demand balance heatmap | FAYE (Central admin) | M | HIGH |
| F8 | Dynamic pricing + predictive inventory in wholesale buyer portal | FAYE | M | HIGH ($-direct) |
| F9 | Lot Passport PDF (seed→shelf one-click) | EVIE | M | HIGH (compliance) |
| F10 | Continuous voice mode at Activity Hub | EVIE | L | HIGH (80% entry-time cut) |
| F11 | Offline-first PWA for edge UI | Foxtrot | L | MEDIUM |
| F12 | Multi-language UI (FR/ES minimum) | Foxtrot | M | MEDIUM |
| F13 | Network Leaderboard / "peers improved this week" notifications | FAYE | S | MEDIUM (retention) |
| F14 | LED aging dashboard + replacement timeline | EVIE | S | MEDIUM |
| F15 | Digital twin preview for recipe/schedule changes | FAYE + EVIE | L | HIGH (trust) |
| F16 | Grower-facing market intelligence ("expand 20 trays basil") | FAYE → EVIE push | S | HIGH |
| F17 | Draft SOP generator (from audit logs) | FAYE or GWEN | M | MEDIUM |

### 7.2 Extensions (system-level capabilities)

| # | Extension | Subsystem | Effort |
|:--:|---|---|:--:|
| E1 | Unified tool gateway: schema-validate + audit + idempotency keys + per-tool rate limit for all agent writes | All agents | L |
| E2 | Shared `agent_outcomes` ledger consumed by the learning engine | FAYE + EVIE + GWEN | M |
| E3 | FAYE trust-tier state machine + shadow-decision log + promotion policy | FAYE | M |
| E4 | Outcome-taxonomy enforcement (every FAYE tool returns one of 6 classes) | FAYE | S |
| E5 | Explainability layer: every risk score returns weighting + rationale + undo plan | FAYE | M |
| E6 | Persist all 9 volatile stores to NeDB/PostgreSQL | Foxtrot | M |
| E7 | Edge backup: expand script to 6 critical files + wire `POST /api/farms/:id/backup` every 6 h + pre-stash git hook | Foxtrot + Central | S |
| E8 | Signed destructive-action tokens (step-up auth for reboot/rebuild/stash) | Central + Foxtrot | S |
| E9 | ML cron reliability: confirm PM2 jobs run, add dead-man switch + stale-model alarm | Foxtrot | S |
| E10 | SARIMAX retrainer real training pipeline (currently stub) | Foxtrot | M |
| E11 | Energy forecaster → grower dashboard integration | Foxtrot | M |
| E12 | Modbus + BACnet + 0–10 V drivers | Automation | L |
| E13 | CO₂ / nutrient / pH / chiller controllers with same hysteresis/duty/decay pattern as VPD | Automation | L |
| E14 | Rule-schema versioning + rollback + dry-run simulation | Automation | M |
| E15 | Signed-recipe checksums + immutable recipe audit trail | Automation | S |
| E16 | Persist automation guard state across restarts | Automation | S |
| E17 | Federated IoT anomaly learning (per Hernandez-Ramos 2025) | FAYE | L |
| E18 | Prompt-injection defenses for public-demo EVIE mode | EVIE | S |
| E19 | Per-farm LLM token budget + cost dashboard | All agents | S |
| E20 | Per-tool latency histogram + tool-level error budget + regression suite | All agents | M |

### 7.3 Tools (agent-callable verbs)

Organize under a single tool catalog. Missing / recommended:

**EVIE (farm-scope writes + reads):**
- `scan_devices({mode: wireless|wired|all})` — unified scan (planned in scanning-integration doc).
- `scan_bus_channels({bus_id})`, `get_bus_mappings()`, `save_bus_mapping()` (confirm-tier).
- `assign_device_to_zone({device_id, zone_id})`.
- `acknowledge_recommendation({recommendation_id, outcome})`.
- `accept_recipe_modifier({crop, modifier_id})`, `dismiss_recipe_modifier({id, reason})`.
- `record_harvest_voice({tray_id, weight, grade})` — voice-friendly variant.
- `start_guided_tour({persona})` for public demo mode.
- `request_escalation_to_faye({topic, evidence_ref})` — formal handoff.
- `draft_sop({audit_window_hours})` — propose SOP to grower.
- `preview_change({change_kind, payload})` — returns digital-twin projection.

**FAYE (network-scope governed writes):**
- `propose_trust_tier_promotion({tool, window_days})`.
- `log_shadow_decision({tool, action, would_have_done, evidence})`.
- `classify_outcome({decision_id, class})` (one of 6).
- `run_policy_check({action})` — returns allow / abstain / escalate with rationale.
- `trigger_recall({lot_id, reason})` (ADMIN tier).
- `balance_supply_demand({horizon_days})` — returns planting deltas.
- `match_buyers({crop, horizon, quality_min})`.
- `diagnose_cross_farm_pattern({symptom, window})` — correlate anomalies across farms.
- `push_market_nudge_to_farm({farm_id, suggestion})`.
- `run_security_audit({scope})` (already exists; extend with explainability+baseline — partially done).
- `generate_explainability_report({decision_id})`.

**GWEN (research-scope):**
- `preregister_hypothesis({study_id, claim, power, n, alpha})`.
- `power_analysis({effect_size, alpha, power})` — returns required n.
- `propose_experiment_variant({recipe_id, delta, cohort_size})`.
- `analyze_experiment({experiment_id})` — returns effect size + CI + negative-result flag.
- `promote_recipe_to_production({experiment_id, target_crop})` — FAYE-gated.
- `draft_manuscript({study_id, template})`.
- `export_compliance_package({study_id, format: ORCID|CRediT|…})`.
- `run_in_sandbox({code, dataset_ref})` — extend existing code-exec tool with sandboxed datasets.

**Shared cross-agent:**
- `emit_outcome({agent, tool, action_id, class, evidence})` → single ledger.
- `lookup_lot_passport({lot_id})` → chain-of-custody JSON.
- `generate_lot_passport_pdf({lot_id})`.
- `handoff({from, to, topic, evidence_refs, requested_action})` — formal message-passing.

### 7.4 Skills (reusable playbooks / runbooks)

Using the `.github/skills/` + agent-skills-framework structure already present:

| Skill | Owner | Purpose |
|---|---|---|
| `evie-onboarding-device` | EVIE | Unified wired+wireless scan → register → map → verify |
| `evie-nightly-checklist` | EVIE | Hardened nightly walkthrough (exists in vision; codify) |
| `evie-harvest-voice` | EVIE | Continuous listening harvest flow |
| `evie-escalation-to-faye` | EVIE | When and how to escalate |
| `faye-trust-tier-promotion` | FAYE | Outcome window → promotion rule |
| `faye-shadow-mode-evaluation` | FAYE | Record/score shadow decisions |
| `faye-recall-coordination` | FAYE | SFCR-compliant multi-farm recall |
| `faye-market-nudge` | FAYE | Price + demand → grower suggestion |
| `faye-cross-farm-diagnosis` | FAYE | Correlate anomalies across farms |
| `faye-security-incident-triage` | FAYE | (Extend existing security workbook) |
| `gwen-preregister-study` | GWEN | Pre-registration + power analysis |
| `gwen-experiment-to-recipe-promotion` | GWEN → FAYE | Research → production handoff |
| `gwen-grant-narrative-from-experiments` | GWEN | Auto-draft grant sections from evidence |
| `gwen-compliance-export` | GWEN | IRB / ethics / CRediT packaging |
| `automation-recipe-rollback` | Ops | Undo a bad rule/recipe |
| `edge-pre-destructive-backup` | Ops | Incident #6 prevention |
| `edge-failover-to-cloud` | Ops | When edge dies, degrade to Central-only reads |

### 7.5 Missing documents

- **`GWEN_VISION.md`** (peer to EVIE/FAYE) — publish research mission, bubble boundary, code-exec policy.
- **`AGENT_HANDOFF_PROTOCOL.md`** — formal schema for EVIE→FAYE→GWEN handoffs.
- **`TOOL_CATALOG.md`** — single source of truth for all agent-callable verbs with schemas.
- **`OUTCOME_TAXONOMY.md`** — codify the 6-class outcome enumeration as machine-readable enum.
- **`EXPERIMENT_LIFECYCLE.md`** — pre-registration → power → variant → record → analysis → promotion path.
- **`DATA_DURABILITY_RUNBOOK.md`** — edge-backup expansion + Central sync + pre-stash hooks.
- **`AUTOMATION_DRIVER_SPEC.md`** — so community can add Modbus/BACnet drivers.

---

## 8. Cross-cutting observations

### 8.1 Architectural drift: too many "agents"
Seven distinct agent-shaped modules (assistant-chat, farm-ops-agent × Central+Foxtrot, gwen-research-agent, services/ai-agent, admin-ops-agent, admin-assistant, scott-marketing-agent, setup-agent) is more than three. Either rename the non-user-facing ones to "services" and keep three conceptual agents, or publish a registry that explains which internal module answers to which agent persona.

### 8.2 LLM choice asymmetry
EVIE + FAYE run GPT-4o-mini; GWEN runs Gemini 2.5 Pro. This is fine if intentional (Gemini for tool use + long research context) but should be documented and cost-monitored. No per-farm token budget exists.

### 8.3 Recipe immutability principle is a load-bearing wall
`AI_ASSISTANT_CAPABILITIES_REVIEW.md` explicitly forbids recipe mutation by any agent. This is correct but needs enforcement: a signed checksum on recipes, an agent-level system-prompt assertion, and a pre-merge test that no tool schema has `recipe.mutate` or equivalent.

### 8.4 "Advanced training" framing
The vision report closes with *"This version is advanced training"* — accumulating real harvest data while UX catches up. That's honest but means **every shipped UX card should display its confidence + data volume** so growers know when to trust it. Opportunity: a shared `<Confidence n=? />` component across every ML-powered card.

### 8.5 The 39-commit drift in the readiness report
Unrelated to agents, but material for any plan above: the branch drift cited in readiness is a merge-risk that grows with every sprint. Merging `main → main` (or whatever the rebase path is) before Sprints A–D starts is basic hygiene.

---

## 9. Prioritized recommendation roadmap

### Sprint 1 (≤1 week) — Trust floor + visible value
1. **Data durability** (E7): expand edge backup to 6 files, wire Central backup every 6 h, add pre-stash hook.
2. **ML cron reliability** (E9): confirm all PM2 jobs running, add dead-man alarm.
3. **Persist volatile stores** (E6) for the top 3 (orders, reservations, audit).
4. **Dashboard AI cards go live** (F2, F14, UX-10/A.4): wire the 5 dashboard cards to real API data.
5. **Auto-print on harvest** (UX-11 / T16 / 2 h).

### Sprint 2 (1–2 weeks) — Highest-ROI UX
6. **Recipe Modifier Panel** (F1, UX-1) — single biggest gap.
7. **Learning correlations widget** (F3, UX-3).
8. **Experiment record viewer** (F4, UX-5).
9. **Harvest readiness + loss risk cards** (F2, UX-2, UX-4).

### Sprint 3 (1–2 weeks) — Agent surface unification
10. **Unified tool gateway** (E1): schema + audit + idempotency keys + permission matrix.
11. **Shared outcome ledger** (E2).
12. **Outcome-taxonomy enforcement** (E4).
13. **Agent handoff protocol** (doc + `handoff()` tool).

### Sprint 4 (2–3 weeks) — Scientific-instrument identity
14. **`GWEN_VISION.md`** + **`EXPERIMENT_LIFECYCLE.md`**.
15. **Hypothesis pre-registration + power analysis** (F5).
16. **Negative-results board** (F6).
17. **Research → production recipe promotion** (tool `promote_recipe_to_production` with FAYE gate).

### Sprint 5 (2–3 weeks) — Compliance + revenue
18. **Lot Passport PDF** (F9).
19. **Dynamic pricing + predictive inventory in buyer portal** (F8, UX-17/18).
20. **Harvest conflict timeline + supply/demand heatmap** (F7).
21. **Grower-facing market nudges** (F16).

### Sprint 6 (2–4 weeks) — Governance + autonomy
22. **FAYE trust-tier state machine + shadow-decision log** (E3).
23. **Explainability layer** (E5).
24. **Signed destructive-action tokens** (E8).
25. **Digital twin preview** (F15).

### Later (planned, not sequenced)
- Modbus + BACnet + 0–10 V drivers (E12).
- CO₂ / nutrient / pH / chiller controllers (E13).
- Continuous voice mode (F10).
- Offline-first PWA (F11).
- Multi-language UI (F12).
- Federated IoT anomaly learning (E17).
- Tier 3 neural adaptive control (currently commented out).

---

## 10. Answers to the original prompt — condensed

**Additional features:** F1–F17 above — priority cluster is recipe-modifier panel, harvest/loss cards, learning correlations, experiment viewer, hypothesis pre-reg, lot passport PDF, dynamic pricing in buyer portal, continuous voice, digital twin.

**Additional extensions:** E1–E20 above — priority cluster is unified tool gateway, outcome ledger, trust-tier state machine, explainability, volatile-store persistence, edge backup expansion, Modbus/BACnet drivers, SARIMAX real training.

**Additional tools:** Per §7.3 — EVIE gets write tools for onboarding/devices/modifiers/escalation; FAYE gets the governance verbs (trust tier, shadow, classify, recall, supply/demand, market nudge, explainability, cross-farm diagnosis); GWEN gets preregister/power/promote-recipe/grant narrative; plus the shared outcome ledger + handoff verb.

**Additional skills:** Per §7.4 — 17 playbook-style skills spanning the three agents plus automation/ops, plus three runbooks (recipe rollback, pre-destructive backup, edge-failover-to-cloud).

The backend is further ahead than the documentation of the agents implies, and the agent layer is less unified than the automation layer. The single highest-leverage bet is **consolidate the tool surface, add the shared outcome ledger, then ship the UX cards that expose what the backend already computes**.

---

*Prepared by Devin — review based on EVIE_VISION.md, FAYE_VISION.md, faye-security-workbook.md, gwen-research-agent.js, AI_VISION_REPORT.md, AI_VISION_READINESS_REPORT_2026-02-23.md, AI_GAPS_AND_OPPORTUNITIES.md, AI_IMPLEMENTATION_PROGRESS_REPORT.md, AI_ASSISTANT_CAPABILITIES_REVIEW.md, ML_AI_FEATURES_REPORT.md, AI_AGENT_DOCUMENTATION.md, FARM_OPS_AGENT_BUILD_PLAN_2026-03-08.md, EVIE_SCANNING_INTEGRATION_IMPLEMENTATION_TODO_2026-03-28.md, AGENT_SKILLS_FRAMEWORK_UPDATE_2026-02-07.md, automation/engine.js, automation/controllers/vpd-controller.js, automation/growth-stage-manager.js, services/ml-gateway.js, and the greenreach-central/routes/ directory listing.*