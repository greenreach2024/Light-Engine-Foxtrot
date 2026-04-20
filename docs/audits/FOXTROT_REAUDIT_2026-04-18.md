# Light Engine Foxtrot — Re-Audit (2026-04-18)

**Scope:** review `docs/playbooks/*.md` against the current codebase after PRs #5–#37, then focus on two architectural areas: (1) flipping the 3D viewer + setup wizard from a passive "tell me what you have" tool into an active **Farm Builder** that recommends equipment/design from location + growing-system inputs, and (2) end-to-end audit of the crop-scheduling loop (plan / recipe / anchor / seedDate) across the 3D viewer, tray-inventory, EVIE, and the daily resolver.

**Deliverable only.** No code is changed in this pass. Playbook edits and a new `10-farm-builder.md` are staged for review; PRs are held for your go/no-go.

---

## 0. TL;DR (what changed, what's broken, what to do)

1. **The Farm Builder engine already exists on the server side and is not wired to the UI.** `greenreach-central/lib/farm-builder.js` (467 L) + `greenreach-central/lib/equipment-db.js` (572 L) + EVIE tool `recommend_farm_layout` can already take `{ room_area_m2, ceiling_height_m, hydro_system, crops[] }` and return a full equipment recommendation. Nothing in `public/views/farm-setup.html`, `public/setup-wizard.html`, `public/views/3d-farm-viewer.html`, or `public/views/room-mapper.html` calls it. It is reachable **only** through EVIE chat, which is not where operators set up farms today.

2. **Two parallel equipment data models exist and disagree.** `public/data/grow-systems.json` (5 templates — NFT-rack 3-tier, DWC pond 4×8, vertical-tier microgreen, etc., with `plantsPerTrayByClass`, `defaultFixtureClass.ppfdTargetByClass`, `defaultControllerClass`) is the richer schema, intended for the UI. `greenreach-central/lib/equipment-db.js` ships its own `HYDRO_SYSTEM_DB` (6 systems) and `buildFarmLayout()` reads that one, not `grow-systems.json`. Pick one or reconcile.

3. **Location is captured but never used for equipment sizing.** `farm-setup.html` has `btnUseMyLocation` (line 813) + a weather display (line 831) and writes lat/lng into `farm_profile`. EVIE has `get_outdoor_weather` (assistant-chat.js:1091). Neither climate zone nor building envelope is an input to `buildFarmLayout()` — HVAC sizing is purely area × ceiling × ΔT assumptions. To recommend equipment from location we need at minimum design-day outdoor temp/RH (ASHRAE 99% / 1% design conditions), which we can fetch once per farm and cache.

4. **EVIE's `update_group_crop` silently breaks the daily resolver.** When a crop is assigned via EVIE, the group gets `crop` / `plan` / `planId` but **not** `planConfig.anchor.seedDate` (assistant-chat.js:4918–4950). The daily resolver's `computePlanDayNumber` therefore resolves to day 1 forever for EVIE-assigned groups — recipes never progress through their schedule. The 3D viewer writes the seedDate correctly after PR #37 (viewer lines 3679–3700); the EVIE path does not. Same bug in the tray-inventory "activity hub" batch-mode flow (no planId / seedDate emitted at all).

5. **Two disconnected scheduling systems coexist.** Per-group anchor (`group.planConfig.anchor.seedDate`) is what the daily resolver reads; `planting-scheduler.html` writes `seed_date` / `harvest_date` via `POST /api/planning/` into a separate `planting_assignments` store (planting-scheduler.html:1624 `savePlantingAssignment`). Nothing reconciles the two, so an operator can plan a seeding on the scheduler page and the daily resolver never sees it.

6. **Three playbooks disagree with reality.**
   - `07-farm-operations.md:198` — "Room mapper / 3D viewer experimental; not required for ops." Wrong. The 3D viewer is the canonical crop-assignment UI today; its `resolveCropRegistryEntry` flow is the code path that keeps `plan`/`planId`/`anchor.seedDate` in sync.
   - `07-farm-operations.md` "Pages a farm operator uses" (lines 13–28) never mentions 3D viewer, farm-setup, setup-wizard, or planning.html.
   - `00-top-down-architecture.md` does not document the `farm-builder.js` + `equipment-db.js` + `grow-systems.json` stack at all.

7. **Recommended phased work** (details in §§7–8): Phase A (2–3 PRs) — patch `update_group_crop` + tray flows to stamp `anchor.seedDate`; reconcile `grow-systems.json` ⇄ `HYDRO_SYSTEM_DB` to a single source. Phase B (2–3 PRs) — wire `recommend_farm_layout` into `farm-setup.html` as a new "Build the Farm" step; surface results in the 3D viewer. Phase C (3–4 PRs) — add a climate-zone / design-day envelope input; feed it into `buildFarmLayout()` for HVAC/dehumidification sizing. Phase D (1–2 PRs) — unify the two scheduling stores behind a single `/api/schedule` adapter so daily resolver, planting-scheduler, EVIE, and 3D viewer all read the same data.

---

## 1. Playbook × code alignment (current state per playbook)

| # | Playbook | Alignment with current code | Notable drift |
|---|---|---|---|
| 00 | Top-Down | Partial | Does not document `farm-builder.js` / `equipment-db.js` / `grow-systems.json` / `recommend_farm_layout` / `get_outdoor_weather` tools; "dual-deploy registry" mentions 3D viewer but not the crop-resolution reconciliation finished in #37. |
| 01 | Security & Multi-Tenant | Good | PRs #23 + runtime-storage work align; farm_id scoping verified in `farm-admin.js` hotfix. |
| 02 | AI Agent Platform | Partial | Tool catalog in docs lists some tools generically; does not mention that `update_group_crop` skips `anchor.seedDate` (a documented coordination rule is missing). `recommend_farm_layout` trust tier is `quick_confirm` but the tool is not surfaced anywhere in the UI. |
| 03 | Commerce | Good | No changes in this audit window beyond the `[ERR]` → em-dash fix in #35. |
| 04 | Distribution & Delivery | Good | No recent touch points. |
| 05 | Marketing | Good | No recent touch points. |
| 06 | Research | Good | No recent touch points. |
| 07 | Farm Operations | **Stale** | 3D viewer incorrectly called "experimental"; Pages table missing 3D viewer, farm-setup, setup-wizard, planning. Tray-lifecycle section silent on `planConfig.anchor.seedDate` contract. |
| 08 | DevOps & Deployment | Good with one caveat | Dual-deploy registry is authoritative; mirror-reconciliation work in #37 needs a callout so future drift gets flagged. |
| 09 | Admin & Platform Ops | Partial | References `setup-wizard.html` as the 12-phase farm registration UI but does not describe the setup-agent phase model (`greenreach-central/routes/setup-agent.js`) which is the real source of truth for phase progress. |

**Net:** 00, 02, 07 need the biggest updates. 09 needs a pointer into the setup-agent phase catalogue. 08 needs a mirror-reconciliation callout.

---

## 2. Inventory of the Farm Builder stack (what's already written)

### 2.1 Server-side
- `greenreach-central/lib/farm-builder.js` (467 L) — exports `buildFarmLayout(params)`; takes `room_area_m2`, `ceiling_height_m`, `hydro_system`, `hvac_type`, `crops[]`, optional `plant_count`; returns `{ room_specs, crops, environment_targets, plant_estimate, hydroponic_system, lights, fans, dehumidifier, hvac, placements, summary }`. Uses recipe targets from `public/data/lighting-recipes.json` for PPFD / DLI. See <ref_snippet file="/home/ubuntu/repos/Light-Engine-Foxtrot/greenreach-central/lib/farm-builder.js" lines="256-340" />.
- `greenreach-central/lib/equipment-db.js` (572 L) — `LIGHT_DB`, `FAN_DB`, `DEHUMIDIFIER_DB`, `HVAC_DB`, `HYDRO_SYSTEM_DB` (6 systems: NFT, DWC, ebb_flow, dutch_bucket, vertical_tower, aeroponics). Each hydro entry carries `water_usage_l_day_per_site`, `suitable_crops`, pump/timer flags. See <ref_snippet file="/home/ubuntu/repos/Light-Engine-Foxtrot/greenreach-central/lib/equipment-db.js" lines="267-340" />.

### 2.2 Data
- `public/data/grow-systems.json` — `schemaVersion 1.0.0`, `cropClasses: ['leafy_greens','microgreens','herbs','fruiting']`, `templates[5]` with rich per-class keys (`plantsPerTrayByClass`, `defaultFixtureClass.ppfdTargetByClass`, `defaultFixtureClass.dliTargetByClass`, `defaultFixtureClass.photoperiodHoursByClass`, `defaultControllerClass`, `requiredChannels`, `powerClassW`). Template IDs: `nft-rack-3tier`, `dwc-pond-4x8`, `vertical-tier-5-microgreen`, plus 2 more.
- `public/data/equipment-kb.json` — 66 real SKUs across `Lighting / HVAC / Dehumidifier / Mini-Split / Irrigation / Sensors / Controllers`; includes vendor + model + capacity + tags (e.g. Quest Dual 155 dehumidifier, 155 PPD).
- `public/data/lighting-recipes.json` — per-crop schedule: `{ crops: { "Bibb Butterhead": { schedule: [{day, ppfd, photoperiod, ...}] } } }`.
- `public/data/crop-registry.json` — 32 crops keyed by canonical name, carrying `aliases[]`, `planIds[]`, `nutrientProfile`, `growth`, `pricing`, `market`.
- `public/data/plans.json` — `{ sample, plans: [{ id:'sample-plan', ... }] }` — fallback spectrum mix.

### 2.3 EVIE tool
- `recommend_farm_layout` (assistant-chat.js:1449–1461, executor 4543–4574). Trust tier `quick_confirm`. Not wired to UI.
- Adjacent tools already exist: `update_room_specs`, `apply_crop_environment`, `list_available_crops`, `get_crop_recipe_targets`, `align_equipment_to_walls`, `optimize_layout`, `add_equipment`, `remove_equipment`, `update_equipment`.
- `get_outdoor_weather` (assistant-chat.js:1091) can already pull current conditions from the farm location.

### 2.4 What's missing to make it "active"
- **No UI entry point.** `farm-setup.html` has nothing that POSTs to `/api/farm-builder` or issues the equivalent EVIE intent. `setup-wizard.html` is a 12-step passive enumerator.
- **No climate-envelope input.** `buildFarmLayout()` assumes indoor-only cooling from plant transpiration + lights. Outdoor design conditions (ASHRAE 99% winter dry-bulb, 1% summer dry-bulb + mean coincident wet-bulb) are not an input. That means the HVAC / dehumidifier recommendation is under-sized for hot-humid climates and over-sized for cold-dry climates.
- **`grow-systems.json` is unused by `buildFarmLayout`.** It reads `HYDRO_SYSTEM_DB` from equipment-db.js, which has different key names (e.g. `sites_per_tower: 28` vs `plantsPerTrayByClass`). The JSON file's richer per-class PPFD/DLI/photoperiod logic is effectively orphan data.
- **No "review / accept recommendation" UX.** Even if we called the tool, operators need to see the proposed equipment, modify it, and commit. That UI doesn't exist.

---

## 3. Current setup workflow (the passive path)

Three overlapping UIs. The actual 12 phases live server-side in `setup-agent.js`; each UI covers a different subset.

### 3.1 `public/setup-wizard.html` (1042 L)
Linear 5-step in-browser wizard (first-boot flow):
1. Welcome
2. Password update
3. Farm profile (name, contact, location)
4. Add rooms (name, dims)
5. Finish — hands off to `/LE-farm-admin.html`

No equipment recommendation. No growing-system selection. No crop selection.

### 3.2 `public/views/farm-setup.html` (1191 L)
A separate, richer setup surface with sub-steps (`farm-step` / `room-step` / `pair-step`):
- `connection-choice`, `wifi-select`, `wifi-password`, `wifi-test` — on-prem networking
- `location` — uses browser geolocation + `btnUseMyLocation` (line 813), shows a weather preview
- `contact`, `spaces`, `review` — standard registration
- `room-info`, `hardware`, `category-setup`, `review` — per-room hardware inventory (dehumidifier / HVAC / lights manually registered)
- `transport`, `scan`, `wifi`, `bluetooth`, `review` — SwitchBot pairing

Has "AI suggestion" placeholders (`ai-suggestion__apply` in 5 spots) that accept suggestions from a knowledge base, but no suggestion-generator is wired in today. The suggestion slots are empty wrappers.

### 3.3 `greenreach-central/routes/setup-agent.js` — 12-phase catalogue
(server of truth for setup progress)

| # | Phase ID | What it checks | Data source |
|---|---|---|---|
| 1 | `farm_profile` | name / contact / location | `farm_profile` jsonb |
| 2 | `grow_rooms` | ≥1 room | `rooms` jsonb |
| 3 | `room_specs` | per-room dims + ceiling + hydro_system | `rooms[*]` |
| 4 | `zones` | ≥1 zone extracted from rooms[*].zones or groups[*].zone | `rooms`, `groups` |
| 5 | `groups` | ≥1 group | `groups` |
| 6 | `crop_assignment` | ≥1 group has `crop` / `crop_name` / `assigned_crop` | `groups` |
| 7 | `env_targets` | targets present per group (auto from crop recipe) | derived |
| 8 | `lights` | fixtures registered + assigned | `devices` / light records |
| 9 | `schedules` | ≥1 active schedule | schedule store |
| 10 | `devices` | SwitchBot devices paired | `devices` |
| 11 | `planting` | ≥1 planting assignment | `planting_assignments` |
| 12 | `integrations` | credentials present | secrets store |

Every phase is an **existence check** — did the user enter X? None of the phases call `recommend_farm_layout` or inject a "here is what we recommend" step. The system is fundamentally asking instead of telling.

**Implication.** Making setup active means inserting a new phase between (3) `room_specs` and (6) `crop_assignment`, call it `growing_system_choice`, that takes `(location, cropClass?, system_template)` and runs `buildFarmLayout()`. Phases 4–10 would then become "review / accept recommendation" steps instead of blank-slate entry forms.

---

## 4. Current crop-scheduling loop (end-to-end)

```
                      OPERATOR
                         │
       ┌─────────────────┼─────────────────────────┐
       ▼                 ▼                         ▼
 3D Viewer         Planting-Scheduler        EVIE chat
 (viewer #37)      (planning.html tab)      (update_group_crop)
       │                 │                         │
       ▼                 ▼                         ▼
 group.crop        /api/planning/            group.crop
 group.plan        savePlantingAssign.       group.plan
 group.planId      writes seed_date,         group.planId
 group.planConfig. harvest_date to           (NO anchor.seedDate ✗)
   anchor.seedDate ✓ planting_assignments
                   (separate store)
       │                 │                         │
       └─────────┬───────┘                         │
                 ▼                                 ▼
         groups.json ←──────────────────── groups.json
                 │                                 │
                 ▼                                 ▼
         runDailyPlanResolver(server-foxtrot.js:5086)
                 │
         reads group.plan | group.planId | group.planConfig.preview.planId
         + group.planConfig.anchor.seedDate
                 │
         resolvePlanLightTargets(day) + resolvePlanEnvTargets(day)
                 │
         applyEnvTargetsToAutomation / schedule-executor
                 │
                 ▼
         SwitchBot relays + target-ranges + alerts
```

### 4.1 3D viewer path (canonical, good)
`public/views/3d-farm-viewer.html` line 3679–3700 (`applyGroupEdits`) stamps all five fields: `crop`, `recipe`, `plan`, `planId`, and `planConfig.anchor.seedDate` (defaults to today if absent). Via PR #37 this is now byte-identical in the Central mirror. See <ref_snippet file="/home/ubuntu/repos/Light-Engine-Foxtrot/public/views/3d-farm-viewer.html" lines="3685-3710" />.

### 4.2 EVIE path (broken, silent)
`assistant-chat.js` `update_group_crop` case (lines 4918–4950) sets:
```
groupMatch.crop = cropName;
groupMatch.plan = planId;
groupMatch.planId = planId;
```
It does **not** touch `planConfig.anchor.seedDate`. Same for the bulk-update path at lines 3760–3777. Daily resolver then sees `planKey` but no anchor, so `computePlanDayNumber` returns 1 regardless of how many days have passed. Net effect: EVIE-assigned groups never age through their recipe.

### 4.3 Planting-scheduler path (orphan)
`public/views/planting-scheduler.html:1624` `savePlantingAssignment(groupId, cropId, cropName, seedDate, harvestDate)` posts to `/api/planning/` with `{ seed_date, harvest_date, ... }`. This writes `planting_assignments` (a separate store referenced by the setup-agent phase 11 check). The daily resolver does not read `planting_assignments`; it reads `groups[*].planConfig.anchor.seedDate`. So you can plan a seeding here and the resolver never notices.

### 4.4 Tray-inventory / Activity Hub path (missing)
`public/views/tray-inventory.html` has batch-mode (tray scanning, per-tray weight/photo capture for harvest) but no code path emits `planId` or `seedDate`. Seeding done via the Activity Hub is invisible to the resolver.

### 4.5 Tray-setup.html (1034 L, unlinked)
Separate page, not reachable from the main nav. Intended for tray-level seed date entry. Status: partial, unintegrated.

### 4.6 Daily resolver (tolerant, reads `group.*`)
`server-foxtrot.js:5086` `runDailyPlanResolver(trigger)` iterates `groups[]` and picks the first non-empty of 8 fields:
```
group.plan, group.planKey, group.plan_id, group.planId,
group.planConfig.planId, group.planConfig.preview.planId,
group.planConfig.preview.planKey, group.planConfig.preview.plan
```
Good tolerance. **But** if none of those are set (e.g. Activity Hub seeding), the group is skipped with `[daily] no plans available…` at line 5113. And when they are set but `anchor.seedDate` is absent (EVIE path), `computePlanDayNumber` falls back to day 1.

---

## 5. Risks and opportunities

### 5.1 Risks (prioritized)
| # | Risk | Likelihood | Impact | Evidence |
|---|---|---|---|---|
| R1 | EVIE-assigned groups never progress through recipes (no anchor.seedDate) | High | High — silent, hard to detect | assistant-chat.js:4918–4950 |
| R2 | `grow-systems.json` drifts vs `equipment-db.js` HYDRO_SYSTEM_DB; operators get inconsistent equipment recommendations if a future UI pulls from the JSON | High | Medium | grow-systems.json vs equipment-db.js HYDRO_SYSTEM_DB |
| R3 | Planting-scheduler writes to `planting_assignments` that daily resolver does not read | Medium | High — operator believes schedule is live | planting-scheduler.html:1624, server-foxtrot.js:5124 |
| R4 | `buildFarmLayout` HVAC sizing is location-agnostic; will under-size in hot/humid and over-size in cold/dry climates | High | Medium — money & humidity control | farm-builder.js; no ASHRAE envelope input |
| R5 | `setup-wizard.html` and `farm-setup.html` diverge in field set; operators can finish one and still have phase gaps | Medium | Medium | setup-agent.js 12 phases vs either wizard |
| R6 | 3D viewer is the only UI writing a complete scheduling payload; it's also the least discoverable page | Medium | Medium | no primary-nav entry |
| R7 | Mirror reconciliation one-shot (PR #37) did not land a CI check that re-detects drift | Medium | Medium — future drift silently returns | .github/workflows/ci.yml |
| R8 | Playbooks 00/07 describe 3D viewer as experimental, which contradicts reality and misleads new contributors | High | Low-Medium | 07-farm-operations.md:198 |

### 5.2 Opportunities
1. **One tool, one UI step.** Wiring `recommend_farm_layout` into a new "Build the Farm" step in `farm-setup.html` is a ~500-LOC UI delta with near-zero backend change.
2. **`grow-systems.json` already has the schema we need.** Collapse `HYDRO_SYSTEM_DB` into `grow-systems.json.templates` (or generate one from the other); single source of truth.
3. **Location → weather → envelope.** `get_outdoor_weather` already hits a weather provider; adding a `get_design_conditions` tool that returns 99%/1% design values from the same lat/lng is a small lift.
4. **EVIE patch + seeding contract.** Define a single server-side helper `stampPlanAnchor(group, { seedDate? })` that EVIE / planting-scheduler / tray-inventory all call; daily resolver becomes trivial.
5. **Unified scheduling store.** A `/api/schedule` adapter that fans out to both `groups[*].planConfig.anchor` and `planting_assignments` (write-once, read-both) keeps legacy pages working while consolidating the source of truth.
6. **Mirror-drift CI guard.** A lightweight CI step that `sha256sum`s the dual-deploy registry files in both `public/` and `greenreach-central/public/` and fails if any pair diverges would prevent another multi-PR divergence like the #9/#16/#17 situation that #37 finally cleaned up.

---

## 6. Focus area 1 — Farm Builder (active paradigm)

### 6.1 Desired contract
Inputs an operator can provide *once*:
- `location` → `(lat, lng, country, region, tz)` → design-day outdoor conditions (ASHRAE 99%/1%)
- `building` → `(floor area, ceiling height, insulation tier [light / med / heavy], envelope U-value or "unknown")`
- `growing_system` → one of `nft_rack | dwc_pond | vertical_tower | ebb_flow | dutch_bucket | aeroponics` (or a template ID from `grow-systems.json`)
- `crop_plan` → `[{ cropClass | cropName, trayCount | siteCount, priority }]`

Outputs the system produces:
- Zone architecture (how many zones, each zone's tray/site count, walkway width assumptions)
- Lighting — fixture model × count, PPFD target, DLI target, photoperiod, power draw
- HVAC — cooling tonnage, mini-split vs central, dehumidification PPD, ventilation CFM
- Irrigation — pump capacity, reservoir volume, plumbing notes
- Controls — required channels (0-10V lights, smart-plug pumps/fans, SwitchBot sensor plan)
- BOM — grouped by `equipment-kb.json` SKUs with quantities
- Operating envelope — target tempC / RH / VPD / CO₂ / EC / pH pulled from recipe

### 6.2 Proposed data flow
```
Location (lat,lng)     Building (area, ceiling, insulation)
         │                         │
         ▼                         │
 get_design_conditions            │
 (new EVIE tool + cached          │
  per-farm on farm_profile)        │
         │                         │
         └─────────────┬───────────┘
                       ▼
             designEnvelope: {
               winter_99_dryBulb_C,
               summer_1_dryBulb_C,
               summer_meanCoincidentWetBulb_C,
               climateZone: 'ASHRAE 6A' | 'Köppen Dfa',
               envelope_U_Wm2K
             }
                       │
  + grow-systems.json.template (NFT rack 3-tier, etc.)
  + crop_plan[]
                       ▼
           buildFarmLayout_v2(inputs)   ← superset of today's buildFarmLayout
                       │
                       ▼
          { zones, lights, hvac, dehu, irrigation, controls, bom, env_targets }
                       │
         ┌─────────────┼────────────────┐
         ▼             ▼                ▼
 farm-setup.html   3D viewer       EVIE apply tool
  "Review Plan"    renders plan    (accept → writes rooms/groups/devices)
```

### 6.3 UI touchpoints
- `public/views/farm-setup.html` — new step `farm-step="build"` between `spaces` (867) and `review` (878). Posts to a new `/api/farm-builder/run` (LE-side thin proxy to `buildFarmLayout_v2`) and renders the proposal in a review card.
- `public/views/3d-farm-viewer.html` — accept a `?proposal=<id>` param; render proposed zone outlines + equipment sprites as a preview overlay before commit.
- `public/LE-migration-wizard.html` — mirror the same step for migration users (retrofit flow).

### 6.4 Backend touchpoints
- `greenreach-central/lib/farm-builder.js` — add `buildFarmLayout_v2(inputs)` that additionally takes `designEnvelope` and `template` (from `grow-systems.json`). Keep v1 for back-compat.
- New `greenreach-central/lib/design-conditions.js` — wraps ASHRAE / TMY / simple lat-band fallback.
- New tool `get_design_conditions` in `assistant-chat.js` tools catalog.
- Unify `HYDRO_SYSTEM_DB` with `grow-systems.json.templates` — recommended approach: generate `HYDRO_SYSTEM_DB` at import time from `grow-systems.json` so the JSON is canonical.

---

## 7. Focus area 2 — Crop scheduling (one loop, everyone writes/reads it)

### 7.1 Minimum fix (Phase A — 1 PR, low risk)
1. Add a helper `lib/plan-anchor.js` with `stampPlanAnchor(group, { planId, cropName, seedDate? })` that sets `crop`, `recipe`, `plan`, `planId`, `planConfig.anchor.seedDate` (defaulting to `YYYY-MM-DD` today if absent). Lives in both LE and Central.
2. Make `update_group_crop` call it (assistant-chat.js:4918–4950).
3. Make bulk-create-groups from crop call it (assistant-chat.js:3760–3777).
4. Make tray-inventory batch-seeding emit it (new code path; currently there is no seeding write at all).
5. Add a one-time server-startup migration that stamps `anchor.seedDate=today` on any group with `planId` and no anchor — **behind a flag**, so operators opt in.

### 7.2 Reconcile the two scheduling stores (Phase D — 2 PRs, medium risk)
- Add `/api/schedule/seedings` that on POST (a) writes `planting_assignments` (legacy) **and** (b) locates the target group(s) and stamps `planConfig.anchor.seedDate`.
- Migrate `planting-scheduler.html:1624` `savePlantingAssignment` to hit `/api/schedule/seedings`.
- Daily resolver stays unchanged; it reads `group.planConfig.anchor.seedDate` which is now authoritative.
- Export a read-side `/api/schedule/by-group/:id` that merges the two views (planted, scheduled, forecast harvest).

### 7.3 Nutrient resolver coupling
`server-foxtrot.js:17002` logs `"[nutrients] Failed to enrich groups with plans"` when a group is missing a plan — the nutrient-management UI is already plan-aware. With 7.1 in place, the nutrient resolver gets correct targets across all groups (not just 3D-viewer-assigned ones).

### 7.4 Harvest + traceability coupling
`harvest-log.json` + `lot_records` already key on `planId` (server-foxtrot.js:11428–11478). With 7.1 in place, EVIE-assigned harvests will carry the correct recipe_id into lot records — currently they can carry `planId` but no `seedDate` context, so yield-vs-days analysis is wrong for that cohort.

---

## 8. Phased roadmap (what to ship, in what order)

Estimates assume we keep to the PR size discipline of the last cycle (one PR per logical concern).

| Phase | Goal | PRs | Risk | Depends on | Blast radius |
|---|---|---|---|---|---|
| **A** | Fix silent scheduling break | A1: `stampPlanAnchor` helper + EVIE patch; A2: tray-inventory seeding hook; A3 (optional): startup migration behind flag | Low | — | Groups assigned via EVIE / Activity Hub |
| **B** | Make Farm Builder reachable | B1: wire `recommend_farm_layout` into `farm-setup.html` new `build` step; B2: 3D-viewer proposal overlay | Low-Medium | `buildFarmLayout` v1 (already exists) | Setup flow only; new UI, no behavior change to existing groups |
| **C** | Active = location-aware | C1: new `design-conditions.js` + `get_design_conditions` tool; C2: `buildFarmLayout_v2` with `designEnvelope` input; C3: farm-setup.html posts location+envelope; C4: `grow-systems.json` ⇄ `HYDRO_SYSTEM_DB` reconciliation | Medium | B; external weather / ASHRAE provider | HVAC / dehumidifier sizing changes for new builds only |
| **D** | Unified scheduling store | D1: `/api/schedule/seedings` adapter; D2: planting-scheduler.html migration | Medium | A | Planning / tray-inventory / daily resolver all share one source |
| **E** (housekeeping) | Playbook + CI guardrails | E1: playbook updates (this audit's proposals); E2: mirror-drift CI check | Low | — | Docs + CI only |

Suggested commit order: **E1 → A → B → D → C → E2.** (Docs first so the audit is durable; active-builder climate work last because it has the most external dependencies.)

---

## 9. Proposed playbook edits (what this audit will land if approved)

1. `docs/playbooks/07-farm-operations.md`
   - Replace line 198 — "Room mapper / 3D viewer experimental; not required for ops." — with a section describing the 3D viewer as the canonical crop-assignment UI and the `resolveCropRegistryEntry` contract.
   - Expand the "Pages a farm operator uses" table to include `3d-farm-viewer.html`, `farm-setup.html`, `planning.html`, `planting-scheduler.html`, `room-mapper.html` with their actual roles.
   - Add a "Crop scheduling contract" section describing the five fields (`crop` / `recipe` / `plan` / `planId` / `planConfig.anchor.seedDate`) and which UIs must stamp all five.

2. `docs/playbooks/00-top-down-architecture.md`
   - Add an "Active Farm Builder" sub-section under "One-Glance Architecture" referencing `farm-builder.js`, `equipment-db.js`, `grow-systems.json`, `recommend_farm_layout`, `get_outdoor_weather`.
   - Add a reference to new `docs/playbooks/10-farm-builder.md`.

3. `docs/playbooks/02-ai-agent-platform.md`
   - Add a "Tool coordination rules" callout that every group-mutating tool must stamp the five scheduling fields (or delegate to `stampPlanAnchor`).
   - Mark `recommend_farm_layout` as "UI-backed from farm-setup.html" once B1 lands; until then flag as "chat-only."

4. `docs/playbooks/09-admin-platform-ops.md`
   - Cross-link to `setup-agent.js` 12-phase catalogue as the source of truth; clarify that `setup-wizard.html` is a UI over that catalogue, not a separate spec.

5. `docs/playbooks/08-devops-deployment.md`
   - Add a "Mirror drift" section describing the dual-deploy registry risk (revealed by the #9/#16/#17 → #37 saga) and the proposed CI check from E2.

6. **New** `docs/playbooks/10-farm-builder.md`
   - Dedicated playbook for the active Farm Builder: inputs, data flow, outputs, UI surfaces, data contracts, phased rollout (A→E), acceptance criteria, never-do rules.

---

## 10. Open questions for the operator

Answer any or all before we start ticketing:

1. **Climate envelope source.** ASHRAE design conditions are paywalled; TMY (NREL) is free for North America. OK to fall back to lat-band default for non-NA farms, or do we ship a paid ASHRAE lookup?
2. **`grow-systems.json` vs `HYDRO_SYSTEM_DB` — which is canonical?** Recommend `grow-systems.json` as canon and auto-generate `HYDRO_SYSTEM_DB` from it. Agree?
3. **Migration for existing groups missing `anchor.seedDate`.** Default to today on first resolver run, or leave unstamped and show an operator-visible alert? Recommend alert; less surprising.
4. **Setup-wizard vs farm-setup** — do we keep both (first-boot minimal + richer re-entry) or collapse `setup-wizard.html` into `farm-setup.html`?
5. **Planting-scheduler store** — preserve `planting_assignments` for historical analytics, or migrate it fully into `group.planConfig`?
6. **Blast radius for Phase C.** Do we roll out location-aware sizing only to *new* farms, or include a one-click "re-run builder with my current location" for existing tenants?

---

## 11. Appendix — file:line citations used

- `greenreach-central/lib/farm-builder.js` 256-340 — `buildFarmLayout`
- `greenreach-central/lib/equipment-db.js` 267-340 — `HYDRO_SYSTEM_DB` (6 systems)
- `greenreach-central/routes/setup-agent.js` 31-140 — 12-phase catalogue
- `greenreach-central/routes/assistant-chat.js` 1091 — `get_outdoor_weather`
- `greenreach-central/routes/assistant-chat.js` 1449-1461 + 4543-4574 — `recommend_farm_layout`
- `greenreach-central/routes/assistant-chat.js` 4918-4950 — `update_group_crop` (missing `anchor.seedDate` — root of R1)
- `greenreach-central/routes/assistant-chat.js` 3760-3777 — bulk crop assignment (same gap)
- `public/views/3d-farm-viewer.html` 740-778 — `resolveCropRegistryEntry` (PR #37 canonical path)
- `public/views/3d-farm-viewer.html` 3679-3710 — `applyGroupEdits` (writes all five scheduling fields)
- `public/views/farm-setup.html` 750-1150 — step catalogue (`farm-step` / `room-step` / `pair-step`)
- `public/views/farm-setup.html` 813, 831 — location + weather
- `public/setup-wizard.html` 486-635 — 5-step linear wizard
- `public/views/planning.html` — iframe shell to planting-scheduler + tray-setup
- `public/views/planting-scheduler.html` 1624, 1670, 2221 — `savePlantingAssignment`, reads `group.planConfig.anchor.seedDate`
- `public/views/tray-inventory.html` — batch mode; no `planId` / `seedDate` emission
- `public/views/tray-setup.html` — 1034 L, not in primary nav
- `public/data/grow-systems.json` — 5 templates, `cropClasses`, `defaultFixtureClass`
- `public/data/equipment-kb.json` — 66 SKUs
- `public/data/lighting-recipes.json` — per-crop schedule
- `public/data/crop-registry.json` — 32 crops with `aliases`, `planIds`, `nutrientProfile`
- `server-foxtrot.js` 5086-5511 — `runDailyPlanResolver` (8-field plan key tolerance, anchor-driven day numbering)
- `server-foxtrot.js` 11428-11478 — harvest + lot_records keyed on `planId`
- `server-foxtrot.js` 17002 — "Failed to enrich groups with plans" log
- `docs/playbooks/07-farm-operations.md` 198 — "Room mapper / 3D viewer experimental" (stale)
- `docs/playbooks/09-admin-platform-ops.md` 20, 42 — setup-wizard reference (needs cross-link to setup-agent.js)
