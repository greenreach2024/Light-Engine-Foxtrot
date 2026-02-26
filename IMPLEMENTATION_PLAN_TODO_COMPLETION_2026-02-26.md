# Implementation Plan: TODO Completion

**Date:** 2026-02-26  
**Branch:** `recovery/feb11-clean` @ commit `d049919`  
**Status:** APPROVED (Architecture Agent + Review Agent)  
**Reference:** `IMPLEMENTATION_PLAN_AI_GROWTH_2026-02-21.md` (canonical roadmap)

---

## Review History

| Date | Agent | Verdict | Key Findings |
|------|-------|---------|-------------- |
| 2026-02-26 | Review Agent | CONDITIONAL | 4 issues: phase gate, dual-track, data volume, test verification |
| 2026-02-26 | Architecture Agent | APPROVED with revisions | All 4 Review Agent issues addressed + 3 architecture issues added |

### Architecture Agent Assessment

**Strategic Alignment:** Plan correctly identifies PostgreSQL as the #1 blocker and the learning pipeline as the core value proposition. Sprint 1→2 sequencing aligns with Central-first architecture (Rule 2.6) and Phase Gate rules (Rule 10.1).

**Issues Addressed in This Revision:**
1. **Phase Gate Violation (Review Agent #1):** Sprint 4 now has explicit gate requiring Sprint 2 exit criteria before starting. Parallelization note corrected.
2. **Missing Dual-Track (Review Agent #2):** S2.5, S3.1, S5.1 now include Central-Side sync path notes per Rule 2.1.
3. **Data Volume Check (Review Agent #3):** S4.1 now includes Rule 8.3 data gates — recipe modifier UI surfaces "Insufficient data" when below thresholds.
4. **Test Verification (Review Agent #4):** Exit criteria now include specific test commands, especially for ML and auth tickets.
5. **Stub Endpoints (Arch #1):** Sprint 2 now includes populating network-growers.js stubs (Rule 2.4) before Sprint 4 creates new UI.
6. **P0 Data Priority (Arch #2):** Sprint ordering enforces Rule 9.1 — P0 data (experiment records) flows before P1/P2 work begins.
7. **Central-First Sequencing (Arch #3):** Sprint 3 (wholesale) explicitly deferred behind Sprint 2 (learning pipeline), not parallel. Central bottleneck resolution takes priority per Rule 2.6.

---

## Context

The AI Growth Implementation Plan (Feb 21) defined 43 tickets across 5 phases. Commits since then show all phases were scaffolded (commits `e6aeb24` through `a55e90f`), but **many implementations are partial or stubbed**. This plan audits the actual state of each TODO, removes what's done, and sequences the remaining work into actionable sprints.

### What's Actually Working in Production (Verified Feb 26)

| System | Status | Evidence |
|--------|--------|----------|
| Central EB | Running, `databaseReady: false` | `/health` returns healthy |
| Foxtrot EB | Running, farm connected | Farm ID `FARM-MLTP9LVH-B0B85039` |
| 5-min farm sync | Operational | Groups, rooms, devices populate in-memory |
| 30-min AI push | Configured, **0 pushes** | `openai_configured: true`, `total_pushes: 0` |
| Tray formats | 9 formats persistent (8 default + 1 custom) | Verified via `/api/tray-formats` |
| Recipe library | 5 recipes, request form working | Verified via admin panel |
| Recipe modifiers | Basil `ppfd_offset_pct: +2%` | `network-recipe-modifiers.json` |
| Wholesale catalog | 4 SKUs | `/api/wholesale/catalog` |
| Delivery service | Phases 0-5 deployed | Quote, checkout, tracking endpoints live |
| Admin panel | Auth, farms, inventory, recipes, devices | All working via in-memory store |
| Harvest → experiment record auto-trigger | **Wired** (L10213-10256) | Calls `buildExperimentRecord()` + `syncExperimentToCenter()` |

### What's Broken or Incomplete

| Issue | Severity | Impact |
|-------|----------|--------|
| PostgreSQL not connected | **CRITICAL** | No persistent storage for experiments, benchmarks, delivery config, orders |
| AI pusher: 0 pushes sent | HIGH | GPT-4 configured but no recommendations generated |
| Experiment records: 0 on Central | HIGH | Learning loops have no data to learn from |
| Crop benchmarks: empty | HIGH | No network averages computed |
| 5 network-growers.js stubs return `[]` | HIGH | Rule 2.4 — must populate before building new UI endpoints |
| 11 commits not pushed to GitHub | MEDIUM | Code not backed up remotely |
| ML jobs stale 51+ days | MEDIUM | Anomaly detection and forecast not updating |
| Tray formats not synced Central ↔ Foxtrot | LOW | Custom formats stay local |
| `/api/ai/status` returns zeros (stub) | LOW | Cosmetic |

---

## Sprint Structure

Work is organized into 6 sprints with **strict sequencing**. Sprints 1→2 are serial (critical path). Sprints 3, 5, 6 may run in parallel after Sprint 2. Sprint 4 is gated behind Sprint 2 completion.

```
Sprint 1 (CRITICAL)  Fix Database + Push to GitHub          ~4 hours
Sprint 2 (HIGH)      Wire Learning Pipeline End-to-End      ~8 hours
Sprint 3 (HIGH)      Complete Wholesale Order Flow           ~8 hours
Sprint 4 (MEDIUM)    UI Gaps + Recipe Modifier Frontend      ~6 hours  ← GATED on Sprint 2
Sprint 5 (MEDIUM)    Notification System + Data Pipeline     ~6 hours
Sprint 6 (LOW)       Technical Debt Cleanup                  ~4 hours
                     ─────────────────────────────────────
                     TOTAL: ~36 hours across 6 sprints
```

### Dependency & Phase Gate Diagram

```
Sprint 1 (DB)
    │
    ├──→ Sprint 2 (Learning Pipeline — Central-first priority per Rule 2.6)
    │        │
    │        ├──→ Sprint 4 (UI) ← GATE: Sprint 2 exit criteria verified
    │        │
    │        └──→ Sprint 3 (Wholesale) ← starts after Sprint 2, not parallel
    │
    ├──→ Sprint 5 (Notifications) ← can start after Sprint 1
    │
    └──→ Sprint 6 (Tech Debt) ← independent, any time after Sprint 1
```

**Phase Gate Rule (10.1):** Sprint 4 MUST NOT begin until Sprint 2 exit criteria are verified — experiment records flowing, benchmarks non-empty, AI push active. This prevents surfacing UI for intelligence that doesn't exist yet.

---

## Sprint 1 — Fix Database + Push to GitHub

**Goal:** Restore Central PostgreSQL so persistent storage works. Push all commits to remote.

**Duration:** ~4 hours  
**Risk:** HIGH — longest-standing blocker  

### Tickets

| # | Task | Files | Effort |
|---|------|-------|--------|
| S1.1 | **Diagnose Central PostgreSQL** — SSH to Central EB, check RDS connection string, security groups, `pg_isready`. Fix connection or provision new RDS if needed. | EB environment config, RDS console | L |
| S1.2 | **Verify DB tables auto-create** — Central server.js has `initDatabase()` that creates tables on connect. Confirm all tables exist: `experiment_records`, `crop_benchmarks`, `network_recipe_modifiers`, `ab_experiments`, `recipe_requests`, `delivery_settings`, `delivery_zones`, `delivery_windows`. | `greenreach-central/server.js` (initDatabase) | S |
| S1.3 | **Git push to remote** — push `recovery/feb11-clean` (11 commits ahead). Resolve any conflicts with upstream. | `.git` | S |
| S1.4 | **Commit uncommitted changes** — 6 modified files + untracked docs. Stage sensible changes, commit. | `.elasticbeanstalk/config.yml`, `.env.example`, `AI_VISION_REPORT.md`, `DELIVERY_SERVICE_IMPLEMENTATION_PLAN.md`, `config/sync-queue.json`, `public/data/env.json` | S |

### Exit Criteria

- [ ] `curl https://www.greenreachgreens.com/health` returns `databaseReady: true`
- [ ] `git status` shows clean working tree
- [ ] `git log origin/recovery/feb11-clean..HEAD` shows 0 commits ahead

---

## Sprint 2 — Wire Learning Pipeline End-to-End

**Goal:** Make the learning loop produce real data: Harvest → Experiment Record → Central → Benchmarks → Recipe Modifiers → Push to Farm. Populate network-growers.js stubs with real data (Rule 2.4).

**Duration:** ~8 hours  
**Depends on:** Sprint 1 (PostgreSQL connected)  
**Phase Gate:** This sprint closes Phase 0 and Phase 1 exit criteria. Sprint 4 MUST NOT start until all exit criteria below are verified.

### Tickets

| # | Task | Farm-Side | Central-Side | Effort | Plan Ref |
|---|------|-----------|-------------- |--------|----------|
| S2.1 | **Verify harvest → experiment record auto-trigger** — `POST /api/harvest` calls `buildExperimentRecord()` (L10213) and persists to `harvestOutcomesDB`. Test with a real harvest on production. Code is wired — verify it executes. | Verify `harvestOutcomesDB.insert()` succeeds | Verify `POST /api/sync/experiment-records` receives record | S | Ticket 0.4 |
| S2.2 | **Verify experiment record sync to Central** — `syncExperimentToCenter()` (L10540) POSTs to Central. Check Central EB logs for ingest. If sync URL wrong (currently may point to `api.greenreach.com` per `edge-config.js`), fix to use production Central URL. | Fix `CENTRAL_URL` env var on Foxtrot EB if needed | Verify `/api/sync/experiment-records` endpoint processes and stores | S | Ticket 0.4 |
| S2.3 | **Trigger benchmark computation** — With experiment records in DB, call `POST /api/crop-benchmarks/compute` to force nightly job. Verify `GET /api/crop-benchmarks` returns data for at least 1 crop. | N/A | Verify `startBenchmarkScheduler()` produces aggregates | S | Ticket 1.1 |
| S2.4 | **Verify AI push includes network intelligence** — Check `ai-recommendations-pusher.js` push payload includes `crop_benchmarks`, `recipe_modifiers`, `risk_alerts`. If push count is still 0 after DB fix, diagnose: is `OPENAI_API_KEY` set? Is `FARM_EDGE_URL` reachable from Central? | Verify `POST /api/health/ai-recommendations` receives payload | Verify `analyzeAndPushToAllFarms()` completes a cycle | M | Ticket 1.2 |
| S2.5 | **Restart ML jobs** — diagnose IsolationForest + SARIMAX status on Foxtrot EB. Fix weather API fallback gating so ML runs without outdoor sensor. **Test verification:** run `python3 backend/simple-anomaly-detector.py` and confirm no dependency errors (Incident #3 pattern). | Fix Python deps, verify scripts run | Central receives ML anomaly classifications via sync (future — acknowledge path) | M | Ticket 0.1 |
| S2.6 | **Wire ML retrain pipeline to cron** — `lib/ml-training-pipeline.js` exists (165 lines) but no cron trigger. Add weekly schedule in `server-foxtrot.js`. | Add `setInterval`/cron trigger | N/A (farm-local model) | S | Ticket 3.4 |
| S2.7 | **Populate network-growers.js stubs (Rule 2.4)** — 5 endpoints return `[]` when DB unavailable: `comparative-analytics`, `trends`, `alerts`, `correlations`, `benchmarks`. Populate with data from in-memory sync store (groups, experiment records, telemetry) as fallback, matching the pattern used for admin endpoints. | N/A | `greenreach-central/routes/network-growers.js` (L166, L225, L408, L486, L895) | M | Ticket 1.3 |

### Exit Criteria (Phase 0 + Phase 1 Gate)

- [ ] `POST /api/harvest` with test data auto-generates experiment record  
  **Test:** `curl -X POST .../api/harvest -d '{"groupId":"...", "weight": 4.5}' | jq .experiment_record_id`
- [ ] Central `/api/experiment-records` returns records with `total > 0`  
  **Test:** `curl https://www.greenreachgreens.com/api/experiment-records | jq .total`
- [ ] Central `/api/crop-benchmarks` returns non-empty benchmarks for at least 1 crop  
  **Test:** `curl https://www.greenreachgreens.com/api/crop-benchmarks | jq '.benchmarks | length'`
- [ ] AI push `total_pushes > 0` in `/api/admin/ai/monitoring`  
  **Test:** `curl -H "Authorization: Bearer $TOKEN" .../api/admin/ai/monitoring | jq .total_pushes`
- [ ] ML script executes without dependency errors (not just "returns data")  
  **Test:** `python3 backend/simple-anomaly-detector.py 2>&1 | tail -5` — must not show import errors
- [ ] `/api/ml/insights` returns anomaly detection results < 1 hour old
- [ ] ML retrain pipeline has cron schedule (verified in server startup logs)
- [ ] Network-growers.js endpoints return real data (not empty arrays)  
  **Test:** `curl .../api/network/comparative-analytics | jq '.analytics.data | length'` — must be > 0

---

## Sprint 3 — Complete Wholesale Order Flow

**Goal:** Replace stubs in the wholesale order lifecycle: payment, refunds, deadline monitoring, alternative farm routing. Persist volatile stores (Rule 9.2).

**Duration:** ~8 hours  
**Depends on:** Sprint 1 (PostgreSQL for order persistence), Sprint 2 (Central learning pipeline — Rule 2.6 Central-first priority)  
**Note:** Per Rule 2.6, Sprint 2 (Central bottleneck resolution) takes priority over this sprint. Begin Sprint 3 only after Sprint 2 is underway or complete.

### Tickets

| # | Task | Farm-Side | Central-Side | Effort |
|---|------|-----------|--------------|--------|
| S3.1 | **Persist reservation manager** — replace in-memory `activeReservations` Map with NeDB. Reservations survive restart. Fix `buyer_id: 'buyer-placeholder'` (L51). | `lib/wholesale/reservation-manager.js` NeDB store | Central needs reservation data for demand analytics (Feedback Loop 5). Add reservation count to `syncFarmData()` payload or wholesale aggregator. Deferred — acknowledge sync path. | M |
| S3.2 | **Persist audit logger** — replace in-memory array with NeDB store. Audit trail survives restart. | `lib/wholesale/audit-logger.js` NeDB store | Audit records contribute to agent action tracking (Rule 9.2). Central sync deferred but path acknowledged. | S |
| S3.3 | **Wire buyer ID from JWT** — replace `buyerId = 1` hardcode with actual JWT decode in product requests. | `routes/wholesale-product-requests.js` (L34) | S |
| S3.4 | **Implement order modification flow** — complete the 12 TODOs in wholesale-orders.js L520-600: fetch order, validate, save modifications, recalculate totals. | `routes/wholesale-orders.js` | L |
| S3.5 | **Implement buyer accept/reject modifications** — complete 9 TODOs at L634-670: update quantities, adjust payment, handle partial cancels. | `routes/wholesale-orders.js` | L |
| S3.6 | **Implement payment refund/void** — stub at L426 needs real Square/Stripe integration or demo-mode passthrough. | `routes/wholesale-orders.js` | M |
| S3.7 | **Wire deadline monitor** — `services/deadline-monitor.js` has 10 TODOs (query DB, expire orders, find alternatives, send reminders). Implement core loop. | `services/deadline-monitor.js` | L |
| S3.8 | **Wire alternative farm service** — `services/alternative-farm-service.js` has 9 TODOs (farm matching, scoring, reallocation). Implement with real network farm data. | `services/alternative-farm-service.js` | L |

### Exit Criteria

- [ ] Reservations persist across Foxtrot restart
- [ ] Audit log entries survive restart
- [ ] Order modification endpoint returns real updated order (not stub)
- [ ] Deadline monitor runs on schedule, expires stale orders
- [ ] Alternative farm service scores and suggests real farms

---

## Sprint 4 — UI Gaps + Recipe Modifier Frontend

**Goal:** Surface existing backend intelligence in the frontend. Biggest gap: 10 recipe modifier endpoints with zero UI.

**Duration:** ~6 hours  
**Depends on:** Sprint 2 (learning data flowing)  
**PHASE GATE (Rule 10.1):** This sprint MUST NOT begin until ALL Sprint 2 exit criteria are verified. Recipe modifier UI requires experiment records flowing (Phase 1 complete) before Phase 3+ UI is exposed.

### Tickets

| # | Task | Files | Effort | Plan Ref |
|---|------|-------|--------|----------|
| S4.1 | **Recipe modifier UI panel** — add a section to farm-summary or farm-admin showing: current modifiers per crop, network suggestions (accept/dismiss with data source + confidence per Rule 8.4), champion vs challenger results. Connect to existing `/api/recipe-modifiers/*` endpoints. **Data volume gate (Rule 8.3):** Display "Insufficient data (N/10 local harvests required)" when farm has < 10 harvests for a crop. Display "Insufficient data (N/50 network harvests required)" for network modifiers below threshold. Verify basil modifier provenance before surfacing. | New UI component in `public/views/` | L | UX Sprint B |
| S4.2 | **Harvest readiness cards** — `GET /api/harvest/readiness` backend exists. Add cards to farm-summary dashboard showing which groups are ready to harvest + predicted yield. | `public/views/farm-summary.html` | M | UX Sprint A.1 |
| S4.3 | **Loss prediction alerts** — `GET /api/losses/predict` backend exists. Add alert badges in farm-summary for groups with high predicted loss. | `public/views/farm-summary.html` | S | UX Sprint A.2 |
| S4.4 | **AI status badge** — Activity Hub header should show count of pending AI recommendations. Wire to `/api/health/ai-recommendations`. | `public/views/tray-inventory.html` | S | UX Sprint A.3 |
| S4.5 | **Dashboard AI cards → live data** — 5 AI feature cards currently show static ON/OFF. Replace with live metrics from respective endpoints. | `public/views/farm-summary.html` or `farm-admin.js` | M | UX Sprint A.4 |
| S4.6 | **A/B Experiment Orchestrator admin UI** — Central admin dashboard for creating/managing A/B experiments. Currently API-only (`greenreach-central/jobs/experiment-orchestrator.js`). | New tab in `GR-central-admin.html` | M | UX-13 / Ticket D.1 |

### Exit Criteria

- [ ] Recipe modifier suggestions visible in farm UI with accept/dismiss buttons
- [ ] Harvest readiness cards show on farm summary
- [ ] Loss prediction badges visible for at-risk groups
- [ ] Farm summary AI cards show real metrics (not static ON/OFF)
- [ ] A/B experiments viewable/creatable in Central admin

---

## Sprint 5 — Notification System + Data Pipeline

**Goal:** Replace the 4 notification 501 stubs. Fill data pipeline gaps (admin analytics, energy monitoring, sync status).

**Duration:** ~6 hours  
**Depends on:** Sprint 1 (DB for persistence)

### Tickets

| # | Task | Farm-Side | Central-Side | Effort |
|---|------|-----------|--------------|--------|
| S5.1 | **Implement notifications** — `GET /api/notifications`, `POST /:id/read`, `POST /read-all` currently return 501. Implement with NeDB store. Notifications generated by: AI recommendations, harvest readiness, anomaly alerts, order updates. **Track interaction data (accept/dismiss) per Rule 8.1** — grower decisions on AI recommendations are a training signal. | `server-foxtrot.js` (L13241-13285), new NeDB `notificationsDB` | Notification interaction data (accept/dismiss on AI recommendations) should sync to Central as `aiDecisionsDB` records per Rule 9.1 priority P1. Initial implementation: local NeDB only; sync path acknowledged for next sprint. | L |
| S5.2 | **Implement notification preferences** — `PUT /api/users/:userId/notification-preferences` returns 501. Store preferences in NeDB, filter notifications by user prefs. | `server-foxtrot.js` (L13285) | M |
| S5.3 | **Admin analytics aggregate** — `totalTrays`, `totalPlants`, `totalEnergy24h`, `activeAlerts` all return 0. Compute from groups + tray formats + telemetry. | `server-foxtrot.js` (L15385-15388) | M |
| S5.4 | **Admin alerts endpoint** — currently returns empty array. Aggregate from anomaly-diagnostics + AI recommendations + order deadline warnings. | `server-foxtrot.js` (L15647) | M |
| S5.5 | **Energy monitoring** — admin endpoint returns hardcoded mock data. Wire to actual device telemetry (power consumption from IoT data). If no real data, compute estimates from light schedules × wattage. | `greenreach-central/routes/admin.js` (L3464) | M |
| S5.6 | **Sync status error tracking** — `recentErrors` always returns `[]`. Capture sync failures in a circular buffer. | `server-foxtrot.js` (L7030) | S |

### Exit Criteria

- [ ] `GET /api/notifications` returns real notifications (not 501)
- [ ] Notification read/unread state persists
- [ ] Admin analytics aggregate shows real totals (not all zeros)
- [ ] Admin alerts endpoint returns real alerts from anomaly system
- [ ] Energy monitoring shows computed or estimated data
- [ ] Sync status includes recent errors when they occur

---

## Sprint 6 — Technical Debt & Security

**Goal:** Close security gaps, remove stubs, clean up tech debt.

**Duration:** ~4 hours  
**Independent — can run in parallel with Sprint 4/5**

### Tickets

| # | Task | Files | Effort |
|---|------|-------|--------|
| S6.1 | **Fix 2FA — reject invalid TOTP codes** — admin auth accepts ANY 6-digit code. Implement proper TOTP verification with `speakeasy` or equivalent. **Test verification:** test with 3 invalid codes (all must reject), then test with valid code (must accept). Include test commands in PR. | `greenreach-central/routes/admin-auth.js` (L341) | M |
| S6.2 | **Fix edge-config Central URL** — hardcoded to `https://api.greenreach.com` (doesn't exist). Update to production Central URL or make configurable via env var. | `lib/edge-config.js` (L27) | S |
| S6.3 | **RSA signature verification for updates** — update agent accepts unsigned payloads. Add signature check or at minimum HMAC verification. | `lib/update-agent.js` (L296) | M |
| S6.4 | **Persist Stripe config** — in-memory storage lost on restart. Move to NeDB or farm-data-store. | `routes/farm-stripe-setup.js` (L18) | S |
| S6.5 | **Update `/api/ai/status`** — replace zeros stub with real data: count of active models, experiment records, recommendation acceptance rate, last ML run timestamp. | `greenreach-central/server.js` (L1825) | S |
| S6.6 | **Tray format sync** — add `tray-formats.json` to `SYNC_DATA_FILES` array so custom formats sync between Central and Foxtrot. | `greenreach-central/server.js` (L282) | S |
| S6.7 | **Replace misc-stubs.js** — 15 stub endpoints returning placeholder data. Assess which are needed and implement or remove. | `greenreach-central/routes/misc-stubs.js` | M |

### Exit Criteria

- [ ] 2FA rejects incorrect TOTP codes
- [ ] Edge config resolves to actual Central URL
- [ ] Stripe config persists across restarts
- [ ] `/api/ai/status` returns real metrics
- [ ] Custom tray formats sync between Central and Foxtrot
- [ ] `misc-stubs.js` endpoints either implemented or removed

---

## Cross-Cutting Concerns (All Sprints)

### Testing Protocol
Every ticket must be verified with a curl command or automated test before marking complete. Use the existing VS Code tasks (`Smoke test buyer auth`, `Test inventory reservation`, `Smoke test delivery quote`) as templates.

### Deployment Pattern
```
1. Validate syntax:     node -c <file>
2. Commit:              git add -A && git commit -m "fix: <description>"
3. Deploy Central:      cd greenreach-central && eb deploy greenreach-central-prod-v4 --staged --timeout 10
4. Deploy Foxtrot:      cd .. && eb deploy light-engine-foxtrot-prod-v3 --staged --timeout 10
5. Verify production:   curl endpoint | jq
```

### Data Format Rules (from DATA_FORMAT_STANDARDS.md)
- NEVER modify canonical data file schemas
- Use adapters from `lib/data-adapters.js` for format variations
- Run `npm run validate-schemas` before commit (use `--no-verify` if groups.json validation fails — known issue)

### Deployment Approval
Per `.github/copilot-instructions.md`: **NO production deployments without explicit "APPROVED FOR DEPLOYMENT" from user.**

---

## Reference: TODO Count by Source File

| File | TODOs | Category |
|------|-------|----------|
| `server-foxtrot.js` | ~45 | Notifications, analytics, tray registration, sync |
| `routes/wholesale-orders.js` | 33 | Order modification, payment, verification |
| `services/deadline-monitor.js` | 10 | Deadline expiration flow (all stubbed) |
| `services/alternative-farm-service.js` | 9 | Farm matching/reallocation (all stubbed) |
| `services/wholesale-integration.js` | 8 | Inventory/order DB queries (stubs) |
| `services/ai-agent.js` | 8 | Agent capabilities (frameworks/stubs) |
| `greenreach-central/routes/admin.js` | 2 | Energy monitoring, harvest success |
| `greenreach-central/routes/admin-auth.js` | 1 | 2FA verification |
| `lib/wholesale/reservation-manager.js` | 2 | DB persistence, buyer ID |
| `lib/wholesale/audit-logger.js` | 1 | DB persistence |
| `lib/edge-config.js` | 1 | Central URL |
| `lib/update-agent.js` | 1 | RSA signature |
| `lib/farm-provisioning.js` | 1 | Central API call |
| `routes/farm-stripe-setup.js` | 1 | DB persistence |
| `routes/wholesale-product-requests.js` | 1 | JWT decode |
| `greenreach-central/routes/misc-stubs.js` | 15 | Various stub endpoints |
| **Total** | **~155** | |

---

## Mapping to AI Growth Plan Phases

| AI Growth Plan Phase | Status | Sprint Coverage |
|---------------------|--------|-----------------|
| Phase 0 — Fix Foundations | **~70% done** (volatile stores persisted, experiment endpoint exists). ML jobs + harvest auto-trigger unverified. | Sprint 2 (S2.1, S2.5) |
| Phase 1 — Wire the Data | **~50% done** (code committed). Benchmarks empty, market data static, harvest predictions not in UI. | Sprint 2 (S2.3, S2.4), Sprint 4 (S4.2) |
| Phase 2 — Agent MVPs | **~60% done** (agent classes scaffolded). KPI dashboard, auto-print, marketing funnel partially stubbed. | Sprint 4 (S4.4), Sprint 5 (S5.3) |
| Phase 3 — Closed-Loop Learning | **~40% done** (recipe-modifier.js + yield-regression.js exist). Champion/challenger, dynamic pricing, model retrain not wired. | Sprint 2 (S2.6), Sprint 4 (S4.1) |
| Phase 4 — Network Coordination | **~30% done** (supply-demand-balancer exists). Codebase consolidation, planting suggestions UI, network dashboard pending. | Sprint 4 (S4.6) |
| Phase 5 — Autonomous Operations | **Scaffolded** (code committed). No real autonomous actions running. Blocked by data volume + accuracy gates. | Blocked until Sprints 1-4 complete |

---

## Priority Recommendation

**Start with Sprint 1.** PostgreSQL is the single biggest blocker — it gates experiment record persistence, benchmark computation, delivery config, and background service activation. Everything else cascades from database connectivity.

**Sprint 2 immediately after.** The learning pipeline is the core value proposition. With DB working, one successful harvest cycle proves the entire Recipe → Yield feedback loop end-to-end.

**Sprint 3** begins after Sprint 2 is underway (Central-first per Rule 2.6). **Sprints 5 and 6** can run in parallel after Sprint 1. **Sprint 4 is gated** behind Sprint 2 completion — no UI for intelligence that doesn't exist yet.

---

*This plan audits ~155 TODO items across 16 source files and organizes them into 6 sprints totaling ~34 hours. It is derived from the canonical AI Growth Implementation Plan (Feb 21) cross-referenced against production verification on Feb 26.*
