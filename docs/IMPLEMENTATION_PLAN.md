# GreenReach Platform -- Consolidated Implementation Plan

**Last updated**: April 20, 2026
**Authority**: `.github/PLAYBOOK.md`
**Source audits**: See [Appendix A](#appendix-a--source-documents) for the full list of documents synthesized into this plan.

---

## How to Read This Plan

Work is organized into **workstreams** (vertical slices of the platform). Within each workstream, items are tiered:

| Tier | Meaning |
|------|---------|
| **P0** | Blocking: must ship before dependent work can begin, or fixes a data-integrity / safety issue. |
| **P1** | High value: unlocks significant operator capability or reduces a known risk. |
| **P2** | Important: quality-of-life, polish, or forward-looking architecture. |

**Cross-cutting concerns** that span multiple workstreams are called out in Section 1 and referenced by ID (e.g. `XC-3`) from workstream items.

Checked boxes = shipped to production. Unchecked = not started.

---

## 1. Cross-Cutting Concerns

These are platform-wide issues surfaced across multiple audits. Each workstream section references them by ID.

| ID | Issue | Impact | Fix Shape |
|----|-------|--------|-----------|
| `XC-1` | **Dual inventory (NeDB + PG)**: Seed/harvest writes to NeDB; `RecipeEnvironmentalTargets` reads PG. Trays can be invisible to environment targeting. | Incorrect zone targets, S.A.G.E. sees incomplete world. | Unify to one tray source of truth. Block scheduling simulation until resolved. |
| `XC-2` | **Unlocked `groups.json` writes**: Raw `readFileSync`/`writeFileSync` from 5+ call sites with no locking. Concurrent writes race. | Silent data loss on concurrent tablet operations. | File lock (short-term); DB-backed mutations (preferred). |
| `XC-3` | **Event bus durability**: `lib/event-bus.js` is in-process `EventEmitter` with 200-entry ring buffer. No persistence, no retry, no consumer cursor. | Mandatory S.A.G.E. precondition. Events lost on restart, slow handlers block request path. | Append-only event log (NDJSON or SQLite) + per-consumer cursor + async handler dispatch. |
| `XC-4` | **Free-text crop identity**: `recipe_id` overloaded with numeric PG IDs, string recipe names, or free-text crop strings. Silent drops in compromise engine. | Trays excluded from zone targets with no alert. Benchmark lookups return null. | Canonical `crop_key` resolved at seed time; reject unknown crops server-side. Client datalist shipped; server canonicalization NOT yet implemented. |
| `XC-5` | **Client-trusted timestamps**: Server uses `new Date(seedDate \|\| Date.now())` -- drifted tablet clocks silently shift recipe day. | Grow-day calculation off by one or more days. | Server-authoritative timestamps; accept client hint, override if delta > 15 min. |
| `XC-6` | **No automated tests on critical paths**: Zero tests for nutrient MQTT, compromise engine, crop workflow, group mutations. | Regressions ship undetected. CI runs green on PRs that break core paths. | Add tests incrementally with each workstream PR. |
| `XC-7` | **Recipe Modifier UI gap**: 10 Central endpoints for recipe modifiers, zero grower-facing UI. Single biggest AI-capability UX gap (~60% of AI has no UI). | Operators cannot see or act on AI recommendations for recipe tuning. | Build Recipe Modifier Management surface. |

---

## 2. Workstream: Crop Management Workflow

**Source audits**: crop-management-workflow-audit, crop-management-workflow-reaudit, crop-management-workflow-reaudit-verification-and-todos, crop-management-workflow-github-issue-checklist

This workstream must ship its P0 tier before S.A.G.E. (autonomous crop scheduler) can be introduced.

### P0 -- S.A.G.E. Prerequisites

Recommended execution order matches the dependency chain:

1. **Canonical crop identity at seed time** `XC-4`
   - [x] Client datalist from `/api/crops?active=true`
   - [ ] Server-side alias resolution and rejection of unknown crops
   - [ ] Canonical `crop_key` persisted in tray runs and seed events
   - [ ] Benchmark lookup routed through canonical key
   - [ ] Update all downstream recipe/environment consumers to use canonical key

2. **Server-authoritative timestamps** `XC-5`
   - [ ] Accept client timestamps as hints only
   - [ ] Override or clamp when drift exceeds threshold (15 min)
   - [ ] Normalize date-only seed input to farm-local authoritative timestamps
   - [ ] Return authoritative timestamp in seed/harvest API responses

3. **`groups.json` write safety** `XC-2`
   - [ ] Add file lock around all read-modify-write sequences (short-term)
   - [ ] Move group mutations behind a single storage abstraction or DB path (preferred)

4. **Durable event log** `XC-3`
   - [ ] Persist `seed`, `harvest`, `loss` (and future `partial_harvest`) events
   - [ ] Add per-consumer cursor state
   - [ ] Add trivial audit-log consumer before scheduler agent ships
   - [ ] Decouple handler execution from request latency (async dispatch)

5. **Unified tray source of truth** `XC-1`
   - [ ] Make seed/harvest workflow and environmental targeting observe the same tray state
   - [ ] Block scheduling simulation (`simulate_zone_impact`) until resolved

### P1 -- High Priority

- [ ] Add `partial_harvest` event and CCA tray-state model (`E7`)
  - `cut_number`, `remaining_cuts`, `next_expected_cut_date`
  - Prevent first-cut harvest from marking tray capacity as free
- [ ] Surface degraded compromise calculations (`E1`)
  - Return `{ degraded: true, dropped_trays: [...] }` when recipe lookup drops a tray
  - Show blocking UI banner in Zone view
- [ ] Add per-group scheduling autonomy override and global kill switch (`R3`, `R6`)
  - Class-wide defaults in `agent-permissions.json`
  - Per-group `autonomy.scheduling` override in `groups.json`
  - `autonomy.enabled` global flag
- [ ] Pin recipe snapshots at seed time (`R4`)
  - Persist `recipe_snapshot_hash` with each tray run
  - Simulate against pinned snapshot, not live recipe
- [ ] Relax chat-agent scheduling prohibition (`R12`)
  - Allow safe summarization and invocation of sanctioned scheduler tools
  - Prohibit direct schedule mutation only

### P2 -- Follow-On

- [ ] Offline seed queue parity with harvest (`E2`)
- [ ] Idempotency and debounce on demand refresh processing (`E10`)
- [ ] Scheduler decision ledger with outcome tracking (`R7`)
  - Append-only `data/agent-decisions/<agent>/<yyyy-mm-dd>.ndjson`
  - Log inputs, alternatives, chosen action, approval, outcome
- [ ] Sanity bounds on S.A.G.E. outputs (labor cap, capacity cap, tank compatibility)
- [ ] Seed-window confidence in human-readable language
- [ ] Whole-farm throughput optimization objective (ILP over trays x crops x demand)

---

## 3. Workstream: Grow Management

**Source audits**: grow-management-review, grow-management-review-2, grow-management-engineering-checklist, grow-management-review-validation-and-todos

### Shipped

- [x] `calculate_light_heat_load` tool in EVIE catalog
- [x] `recommend_dehumidifier` tool in EVIE catalog
- [x] `recommend_group_equipment` tool in EVIE catalog
- [x] Central route `GET /api/farm-ops/groups/:groupId/env-recommendation`
- [x] LE proxy route `GET /api/groups/:groupId/env-recommendation`
- [x] Grow Management environment recommendation card UI

### P0 -- Zone Rollup and Confidence

- [ ] Zone-aware recommendation rollup
  - Aggregate group-level recommendations to zone level
  - Identify conflicting requirements across groups sharing zone infrastructure
- [ ] Confidence scoring and data gap surfacing
  - Return confidence metadata when group context is incomplete (missing area, missing crop, missing equipment)
  - Render confidence indicator on recommendation card

### P1 -- Operator Actions and Explainability

- [ ] "Ask GWEN why" button on recommendation card
  - One-click handoff to GWEN with pre-filled context
- [ ] Bulk accept/dismiss workflow for multi-group recommendations
- [ ] Template schema enrichment (canopy height, footprint, spacing metadata) for grow-systems.json
- [ ] Reconcile group-room-zone equipment matching against room-map schema used by 3D viewer

### P2 -- Advanced Models

- [ ] Replace flat transpiration default with crop/stage-aware lookup from canonical crop data
- [ ] Recommendation-card write-back actions via existing EVIE tools
- [ ] Recommendation history / audit snapshots for change comparison
- [ ] Add recommendation tests using representative group fixtures

---

## 4. Workstream: Farm Setup

**Source audits**: farm-setup-workflow-proposal, GROW_SYSTEMS_TEMPLATE_SCHEMA

Two-phase architecture: **Phase A (Design)** = room geometry + grow system templates + equipment plan. **Phase B (Provision)** = controller bindings + device auto-assign.

### Shipped

- [x] `public/data/grow-systems.json` with 6 seed templates (nft-rack-3tier, dwc-pond-4x8, vertical-tier-5-microgreen, flood-table-4x6, ebb-flow-bench-4x8, drip-rail-gutter-24ft)
- [x] `docs/features/GROW_SYSTEMS_TEMPLATE_SCHEMA.md` (full spec)
- [x] `rooms.json` schema extension -- dimensions, buildPlan, installedSystems fields (PR #13)
- [x] `lib/farm-load-calculator.js` -- load computation from room dimensions + template quantities (PR #15)
- [x] CI schema validation for grow-systems.json (PR #13)

Note: grow-systems.json has **zero runtime consumers** -- no code reads this file yet. `rooms.json` schema accepts new fields but existing rooms have no dimensions data.

### P0 -- Phase A: Design (remaining)

4. **Merge setup-agent phases** (Step 4)
   - Collapse E.V.I.E. setup-agent "define room" + "assign equipment" steps into a single template-aware phase

### P1 -- Phase B: Provision

5. **`controller-bindings.json`** (Step 5)
   - Map physical controller channels to grow-system instances
   - Schema: `{ instanceId, controllerId, channel, controlType }`

6. **Auto-assign discovered devices** (Step 6)
   - Match SwitchBot/Atlas device discovery results to expected bindings
   - Offer one-click assignment in setup wizard

---

## 5. Workstream: Build Stock Groups

**Source audit**: build-stock-groups-review

### P0 -- Bug Fixes (15 issues, single PR)

- [ ] Enter-key closes dialog prematurely (dialog uses `<form>` with implicit submit)
- [ ] Duplicate light assignment allowed (no dedupe guard)
- [ ] Schema drift between group write and downstream consumers
- [ ] Fabricated zoneIds when zone context is missing
- [ ] Race condition on rapid group save
- [ ] Narrow catalog (only 6 lights, 2 fans, no pumps/controllers)
- [ ] Missing rollback on partial save failure
- [ ] Equipment selector normalization (case, whitespace)
- [ ] Discovery/refresh timing issues
- [ ] KPI metric display bugs

### P1 -- Polish and Catalog

- [ ] Stock equipment catalog (`public/data/stock-equipment.catalog.json`)
  - Manufacturer-keyed entries with validated specs
  - Replace hardcoded arrays in groups-v2.js
- [ ] Equipment selector sync with room equipment inventory
- [ ] Group layout metadata (position in room, bounding box)

### P2 -- 3D Integration

- [ ] Manufacturer browser with filterable catalog UI
- [ ] 3D viewer consumption of group layout metadata and catalog specs

---

## 6. Workstream: 3D Farm Viewer

**Source audits**: greenreach_ui_3d_gwen_audit_2026-04-17, farm-setup-workflow-proposal

### Shipped

- [x] Three.js r0.160 viewer (4,493 lines) with edit mode, timeline HUD, detail panel, GWEN FAB
- [x] Cache busting, zone gap reduction, dimension-aware placement, staleness indicator
- [x] Viewer copied to both `public/views/` and `greenreach-central/public/views/`

### P0 -- Live Data

- [ ] Wire live sensor telemetry to zone/group coloring
  - Replace random/mock data with real SwitchBot readings
  - Color zones by temperature, humidity, or VPD deviation from target
- [ ] Automation state overlay
  - Show active lighting schedules, HVAC state, dosing status

### P1 -- Operational Layers

- [ ] PPFD/DLI heatmap layer (toggle on/off)
- [ ] Device mesh overlay (fans, sensors, lights as instanced meshes at mapped positions)
- [ ] Grow system template-aware rendering
  - Consume `grow-systems.json` templates for accurate rack/table geometry
- [ ] Recipe annotation layer (show active recipe phase per group)
- [ ] Camera presets and deep-link support (`?room=X&zone=Y`)

### P2 -- UX and Accessibility

- [ ] Mobile touch controls (pinch zoom, swipe orbit)
- [ ] Experiment/trial overlay layer
- [ ] Keyboard navigation and screen reader support
- [ ] Performance profiling for rooms with 50+ groups

---

## 7. Workstream: Nutrient Management

**Source audit**: nutrient-management-audit-2026-04-17

### Shipped

- [x] P0 control-loop closure (PR #10: `nutrients: P0 control-loop closure + P1 recipe-driven dosing`)
- [x] Recipe-driven dosing pipeline
- [x] Tank scope preservation through MQTT acks
- [x] MQTT startup error guards

### P1 -- Multi-Tank and Safety

- [ ] Remove hardcoded 2-tank assumption
  - Support 1, 3, or N recirculating reservoirs
  - Dynamic tank card generation from configuration
- [ ] Integrate `nutrient-profiles.json` (currently orphaned)
  - Use crop-compatibility scores for tank-sharing validation
  - Surface "can crops X and Y share a tank?" in UI
- [ ] Add `requireEdgeForControl` to `pump-calibration` and `sensor-calibration` endpoints
- [ ] Add MQTT ack/confirmation correlation
  - Track publish-to-ack round trip
  - Surface "command sent but not acknowledged" state in UI
- [ ] Alert surface for nutrient events
  - Render `NutrientStore.recordAlert` events in an operator-visible inbox

### P2 -- Robustness

- [ ] Rate limiting on manual dose commands
- [ ] Tank 1 trending chart (parity with Tank 2)
- [ ] Reuse long-lived MQTT subscriber client for publishes (eliminate per-command client creation)
- [ ] Setpoint persistence (write applied config back to `nutrient-dashboard.json` on publish)
- [ ] Remove deprecated `fetchPythonBackend` dead code
- [ ] Custom nutrient formulation support (beyond 2 hardcoded products)

---

## 8. Workstream: AI Agents and Automation

**Source audits**: greenreach_review_2026-04-17, GreenReach_Audit_April2026_v3

### P1 -- Agent Infrastructure

- [ ] Recipe Modifier Management UI `XC-7`
  - Surface the 10 existing recipe modifier endpoints in a grower-facing interface
  - Show current modifiers per recipe, allow approve/reject/revert
- [ ] Agent infrastructure write actions
  - EVIE can explain but cannot fully operate; add sanctioned write tools for equipment, schedule, and recipe changes
- [ ] Inter-agent handoff protocol
  - Define structured handoff between EVIE, GWEN, FAYE, and future S.A.G.E.
- [ ] FAYE trust-tier state machine
  - Implement full `new -> learning -> trusted -> autonomous` lifecycle

### P2 -- ML Pipeline

- [ ] Reactivate ML cron jobs (last IsolationForest run: Dec 2025)
- [ ] Implement SARIMAX retrainer (currently a stub)
- [ ] Add confidence intervals to harvest predictor output
- [ ] Propagate forecast variance through scheduling decisions (not point estimates)

---

## 9. Workstream: Governance and CI

**Source audits**: GreenReach_Audit_April2026_v3, PLAYBOOK.md

### Shipped

- [x] Hardened pre-commit hook (commit message format + review notation enforcement)
- [x] `deploy-gate.sh` (blocks single-service deploys when changes span both)

Note: PLAYBOOK.md and DEPLOYMENT_LOG.md were created on a feature branch but have NOT been merged to main yet.

### P0 -- CI Health

- [ ] Fix shipping-on-red pattern
  - Audit required status checks in branch protection
  - Reduce required checks to only those that reliably pass
  - Add smoke test that validates startup of both services
- [ ] Pin pending SHA entries in deployment log
  - Fill in digests for any `pending` rows

### P1 -- Doc/Reality Reconciliation

- [ ] Resolve 5 documented contradictions from v3 audit
  - `writeJSON` dual-write claim vs actual single-write behavior
  - `schemaVersion` in docs vs missing in data files
  - Recipe v2 migration "complete" vs partially consumed
  - Sensor pipeline doc vs actual SwitchBot-only path
  - Demo mode doc vs actual implementation scope
- [ ] Add `schemaVersion` field to all JSON data files
- [ ] Secret rotation schedule (Square, SwitchBot, JWT)

---

## 10. Priority Summary -- Recommended Execution Order

This ordering respects dependency chains: items higher on the list unblock items below them.

### Phase 1: Data Integrity (P0 foundations)

| # | Item | Workstream | Ref |
|---|------|-----------|-----|
| 1 | Canonical crop key (server-side resolution) | Crop | `XC-4` |
| 2 | Server-authoritative timestamps | Crop | `XC-5` |
| 3 | `groups.json` write safety (file lock) | Crop | `XC-2` |
| 4 | Durable event log + audit consumer | Crop | `XC-3` |
| 5 | Unified tray source of truth | Crop | `XC-1` |
| 6 | Fix CI shipping-on-red | Governance | -- |
| 7 | Build Stock Groups bug fixes (15 issues) | Groups | -- |

### Phase 2: Operational Intelligence (P0/P1 features)

| # | Item | Workstream | Ref |
|---|------|-----------|-----|
| 8 | Zone-aware recommendation rollup + confidence | Grow Mgmt | -- |
| 9 | Wire 3D viewer to live sensor telemetry | 3D Viewer | -- |
| 10 | Remove 2-tank hardcoding; integrate nutrient-profiles.json | Nutrient | -- |
| 11 | Recipe Modifier Management UI | AI Agents | `XC-7` |
| 12 | Merge setup-agent phases (template-aware) | Farm Setup | Step 4 |

### Phase 3: Autonomy Foundations (P1 features)

| # | Item | Workstream | Ref |
|---|------|-----------|-----|
| 13 | `partial_harvest` event + CCA tray-state model | Crop | `E7` |
| 14 | Degraded compromise surfacing | Crop | `E1` |
| 15 | Per-group autonomy override + kill switch | Crop | `R3/R6` |
| 16 | Recipe snapshot pinning | Crop | `R4` |
| 17 | PPFD/DLI heatmap + device overlay in 3D viewer | 3D Viewer | -- |
| 18 | Agent write actions + inter-agent handoff | AI Agents | -- |

### Phase 4: Polish and Scale (P2)

| # | Item | Workstream | Ref |
|---|------|-----------|-----|
| 19 | Offline seed queue | Crop | `E2` |
| 20 | Demand refresh idempotency | Crop | `E10` |
| 21 | Scheduler decision ledger | Crop | `R7` |
| 22 | `controller-bindings.json` + auto-assign devices | Farm Setup | Steps 5-6 |
| 23 | Stock equipment catalog + manufacturer browser | Groups | -- |
| 24 | 3D viewer mobile controls + accessibility | 3D Viewer | -- |
| 25 | ML pipeline reactivation | AI Agents | -- |
| 26 | Advanced transpiration model | Grow Mgmt | -- |
| 27 | Doc/reality reconciliation | Governance | -- |
| 28 | Multi-tank nutrient support | Nutrient | -- |

---

## Appendix A -- Source Documents

| Document | Key Findings |
|----------|-------------|
| `GreenReach_Audit_April2026_v3.md` | 61/100 scorecard, CI ships red, 5 doc contradictions, recipe modifier UI gap |
| `greenreach_review_2026-04-17.md` | Agent architecture review, ML pipeline stale, FAYE trust tiers unimplemented |
| `greenreach_ui_3d_gwen_audit_2026-04-17.md` | 3D viewer read-only, no live data, no device overlay, no mobile |
| `farm-setup-workflow-proposal.md` | 2-phase setup (design + provision), 6 concrete steps, Step 1 done |
| `GROW_SYSTEMS_TEMPLATE_SCHEMA.md` | Full grow-systems.json schema spec, zero runtime consumers |
| `grow-management-review.md` | Grow management production plan, EVIE tool exposure needed |
| `grow-management-review-2.md` | AI recommendation card review, zone rollup P0 |
| `grow-management-engineering-checklist.md` | 4-phase engineering plan, transpiration model |
| `grow-management-review-validation-and-todos.md` | P0 tools shipped, P1/P2 remaining |
| `build-stock-groups-review.md` | 15 bugs, narrow catalog, manufacturer catalog proposal |
| `crop-management-workflow-audit.md` | G1-G20 gaps, S.A.G.E. initial spec, permission matrix |
| `crop-management-workflow-reaudit.md` | E1-E10 errors, R1-R12 risks, S.A.G.E. preconditions |
| `crop-management-workflow-reaudit-verification-and-todos.md` | Verified findings, closure todo list with execution order |
| `crop-management-workflow-github-issue-checklist.md` | Issue-ready P0/P1/P2 tasks |
| `nutrient-management-audit-2026-04-17.md` | Control loop gap (closed in PR #10), 2-tank hardcoding, orphaned profiles |
