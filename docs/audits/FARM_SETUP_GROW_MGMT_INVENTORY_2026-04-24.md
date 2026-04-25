# Farm Setup & Grow Management — Complete Inventory (2026-04-24)

Pre-rebuild audit. READ-ONLY. Source of truth for the rebuild.

---

## TL;DR — Scope of the System

- **5 main UI pages:** `setup-wizard.html`, `farm-setup.html`, `tray-setup.html`, `grow-management.html`, `LE-farm-admin.html` (sections)
- **20+ API routes** spanning LE (`server-foxtrot.js`) and Central (`greenreach-central/server.js`)
- **4 AI agents:** E.V.I.E. (Gemini Flash), F.A.Y.E. (gateway), G.W.E.N. (Gemini Pro), Setup Agent (deterministic)
- **250+ exposed tools** across the agents
- **20+ JSON data files** under `public/data/` (LE) and `greenreach-central/public/data/` (Central, NOT synced)
- **5 PostgreSQL tables:** `farms`, `rooms`, `zones`, `farm_users`, `farm_room_configs`
- **3 years of accreted code.** Multiple field aliases, schema drift, legacy stubs.

---

## PART A — UI PAGES

### 1. `public/setup-wizard.html` (LE) + `greenreach-central/public/setup-wizard.html` (Central, identical)
- **Purpose:** First-time activation wizard (7 steps).
- **Auth:** Token check L6–11, redirects to `/farm-admin-login.html` if invalid.
- **Steps:**
  1. Welcome
  2. Change password (`#new-password`, `#confirm-password`)
  3. Farm profile (name, contact, email, phone, website, logo)
  4. Auto device discovery (`#device-scanner-container`)
  5–7. (Reserved / not fully populated)
- **CSS:** `/styles/evie-core.css` + inline dark theme.
- **TODO L21:** "Auth check — ensure user has a valid token" — basic only, no role validation.

### 2. `public/views/farm-setup.html` (LE only)
- **Purpose:** Advanced farm config (rooms, zones, lighting, IoT, equipment plans).
- **CSS chain:** `styles.foxtrot.css`, `le-foundation.css`, `le-dashboard-theme.css`, `switchbot-manager.css`, `iot-manager.css`, `nav-color-palette.css`, `setup-orchestrator.css`.
- **Panels (rendered by JS):** `#roomsList`, `#lightSetupsList`, `#iotDevicesList`, `#addedIoTDevicesList`.
- **Issue:** ~49 `!important` rules fighting `styles.foxtrot.css` global light theme.

### 3. `public/views/tray-setup.html`
- **Purpose:** Tray formats + plant spacing rules.
- **Reads:** `/data/tray-formats.json`.
- **Tabs:** Multiple tray categories.

### 4. `public/views/grow-management.html` (LE) + `greenreach-central/public/views/grow-management.html` (Central)
- **Page title:** "Farm Setup & Grow Management"
- **Purpose:** Unified 5-step workflow — Room → Zones → Grow Units & Groups → Equipment → Controllers.
- **Major IDs:**
  - `#groupsV2Status`, `#groupsV2StatusBadge` — header status
  - `#ffBreadcrumb` — 5-step nav
  - `#ffRoomBody` (length/width/height inputs)
  - `#ffZonesCountInput`, `#ffZonesCountApply`, `#ffZonesRecommend`
  - `#ffZoneDrawerOpen/Close/Save/Backdrop` — floor-plan drawer
  - `#rbpPrefillBtn`, `#rbpAssignLightsBtn`, `#rbpSavePlanBtn`, `#rbpClearBtn` (Room Build Plan)
  - `#groupsV2SaveAndDeploy`, `#groupsV2DeleteGroup`, `#groupsV2PrintLabels`, `#groupsV2HarvestBtn`
  - `#bulkEditGroupModal`, `#buildStockGroupModal` (native `<dialog>`)
  - `#btnOpenCalWizardFromGroups` — calibration wizard
- **Fetches (POST `/api/setup/save-rooms`, GET `/api/setup/rooms`, GET `/data/rooms.json`, GET `/api/grow-systems`, POST `/api/grow-systems/:id/score`, GET `/data/crop-registry.json`, GET/POST/DELETE `/api/controller-bindings*`).**
- **DataFlowBus events:** `groups`, `rooms`, `zones` propagate updates across pages.
- **Known UI tech debt:**
  - L1100+: Plan vs Light comparison cards hidden but persisted
  - L1300–1500: Legacy form controls (`#groupsV2RoomSelect`, `#groupsV2ZoneSelect`, `#groupsV2ZoneName`) hidden
  - Calibration mount `#calibrationPanel` is a placeholder

### 5. `public/LE-farm-admin.html` (sections related to grow management)

---

## PART B — JS MODULES

### `public/js/setup-orchestrator.js` (~460 lines)
- Cinematic phase progress UI.
- Mount: `#setupOrchestrator`.
- Endpoint: `GET /api/setup-agent/progress` (Auth Bearer + `x-farm-id`).
- Cache: `sessionStorage` key `setup_orchestrator_cache`, TTL 60 s.
- Calls `window._farmAssistant.chat()` with phase prompt.
- **Risk L165:** `escapeHTML()` / `escapeAttr()` not imported — XSS risk if missing.

### `public/js/onboarding-checklist.js` (~280 lines)
- Persistent task list (dashboards, settings, wizard).
- Endpoint: `GET /api/setup/onboarding-status`.
- localStorage keys: `onboarding_checklist_dismissed`, `onboarding_checklist_snoozed_until`, `onboarding_checklist_collapsed`.
- **Issue:** Task completion only client-side; clearing localStorage resets.

### `public/views/grow-management-room-build-plan.js` (~580 lines)
- Equipment sizing calculator: transpiration, heat, spatial fit.
- Listens to `grow-template:selected` custom event.
- Customization shape:
  ```js
  { levels, borderInPerSide, spacingIn, spacingLinked,
    locationsX, locationsY, locationsPerLevel, totalLocations,
    footprintLengthIn, footprintWidthIn,
    layoutMode: 'auto_by_spacing'|'manual_locations',
    anisotropic, anisotropicWarning }
  ```
- Default fallback room: 20 m × 15 m × 3.5 m.
- **TODO L52:** "Integrate 3D spatial solver for multi-zone fitting".
- **TODO L84:** `window.RoomLayoutSolver` external dep not guaranteed.

### `public/views/grow-management-template-gallery.js` (~420 lines)
- Cinematic template picker w/ scoring.
- Endpoints: `GET /api/grow-systems`, `POST /api/grow-systems/:id/score`.
- Score tiers: T/H lower=better (0–30 green, 30–60 amber, 60+ red); Env higher=better (70+ green).
- Emits `CustomEvent('grow-template:selected')`.

### `public/groups-v2.js` (~3000+ lines)
- Group CRUD, light assignment, harvest cycle, spectrum solver.
- Endpoints: `GET /api/groups`, `POST /api/groups`, `PUT /api/groups/:id`, `DELETE /api/groups/:id`, `GET /data/crop-registry.json`.
- Group ID format: `{roomId}:{zoneId}:{groupName}`.
- Validates schedules (no-overlap), computes harvest cycle (single vs cut-and-come-again), regrowth days.

### `public/lib/room-layout-solver.js`
- SVG floor-plan + zone-fitting solver.

### `public/js/data-flow-bus.js`
- Cross-page event bus + cache-busting helper.

### `public/js/auth-fetch.js`
- Fetch wrapper auto-attaching JWT.

---

## PART C — API ROUTES

### LE — Setup & Rooms (`routes/setup-wizard.js`, `routes/setup.js`)
- `POST /api/setup-wizard/change-password` — bcrypt 10, updates `farm_users` then `users` fallback.
- `GET  /api/setup-wizard/status` — checks `farms.setup_completed` or roomCount > 0.
- `POST /api/setup-wizard/complete`
- `GET  /api/setup-wizard/available-crops`
- `POST /api/setup-wizard/farm-profile` — sanitizes via `validator.escape()`; persists `dedicated_crops` to farm.json.
- `POST /api/setup-wizard/rooms` — txn insert into `rooms`.
- `GET  /api/setup-wizard/rooms`
- `POST /api/setup-wizard/zones` — stores zones in `rooms.configuration` JSONB (no separate table).
- `POST /api/setup/activate` — verifies activation code (in-memory), generates RSA-SHA256 license, writes `config/licenses/license.json`.
- `GET  /api/setup/hardware` — fingerprint (MAC+CPU+disk).
- `POST /api/setup/generate-code`
- `POST /api/setup/save-rooms` — writes `farm_room_configs` (JSONB) AND/OR `rooms.json`.
- `GET  /api/setup/rooms`
- `GET  /api/setup/data` — farm name/owner/contact + rooms summary.

### LE — Grow Systems (`routes/grow-systems.js`)
- `GET  /api/grow-systems` — registry from `public/data/grow-systems.json` (1.1.0 schema).
- `GET  /api/grow-systems/:templateId`
- `POST /api/grow-systems/compute-room-load` — runs farm-load-calculator.
- `POST /api/grow-systems/:templateId/score` — scores transpiration / heat / env.
- `POST /api/grow-systems/reload`

### LE — Zone Recommendations (`routes/zone-recommendations.js`)
- `GET /api/zone-recommendations`
- `GET /api/zone-recommendations/:zoneId`
- Reads `env-cache.json`, `target-ranges.json`, `groups.json`, `rooms.json`. Confidence scoring with penalties for missing data.

### Central — Setup Agent (`greenreach-central/routes/setup-agent.js`, ~1400 lines)
- 12 phases: farm_profile, room_design, zones, groups, lights, build_plan, devices, crop_assignment, env_targets, schedules, planting, integrations.
- Weighted (sum 100). Setup funnel = first 7. Operations = last 5.
- `GET /api/setup-agent/progress` — `{ ok, percentage, phases[], next_phase, all_complete, setup{}, operations{} }`.
- `GET /api/setup-agent/guidance/:phaseId`.
- Legacy phase ID remap: `grow_rooms`/`room_specs` → `room_design`.

### Central — Farm Ops Agent (`greenreach-central/routes/farm-ops-agent.js`, ~2200 lines)
- `GET /api/farm-ops/daily-todo` — ranked tasks, score = `0.35*urgency + 0.25*impact + 0.15*risk + 0.15*confidence – 0.10*effort`.
- `POST /api/farm-ops/tool-gateway` — schema-validated tool execution.
- `GET  /api/farm-ops/tool-catalog`.
- `POST /api/farm-ops/parse-command` — NLP intent extraction.
- `GET  /api/farm-ops/audit-log` — paginated.

### Central — Assistant Chat / E.V.I.E. (`greenreach-central/routes/assistant-chat.js`, ~2800 lines)
- `POST /api/assistant/chat`, `POST /api/assistant/chat/stream` (SSE), `POST /api/assistant/upload-image` (Gemini Flash vision), `GET /api/assistant/state`.

### Central — G.W.E.N. (`greenreach-central/routes/gwen-research-agent.js`)
- `POST /api/gwen-research/chat`, `GET /api/gwen-research/{status,state,workspace}`.
- Code execution gated by `GWEN_EXECUTE_CODE_ENABLED` + window + farm allowlist.

### Central — F.A.Y.E. (`greenreach-central/routes/admin-ops-agent.js`)
- `POST /api/admin-ops-agent/ask`, `GET /api/admin-ops-agent/{tools,status}`.

### Central — Inventory / Procurement / Sales — see existing audit.

---

## PART D — DATA FILES (under `public/data/`)

| File | Purpose | Phase |
|---|---|---|
| `farm.json` | Farm profile | farm_profile |
| `rooms.json` | Rooms + zones + buildPlan + installedSystems | room_design → devices |
| `grow-systems.json` | Template registry (v1.1.0 / 2026-04-18-v2) | groups |
| `groups.json` | Grow units (single instances of templates) | groups → schedules |
| `crop-registry.json` | Crops + cycle + harvest strategy | crop_assignment |
| `lighting-recipes.json` | Photoperiod + spectrum (~1.2 MB lazy-loaded) | lights → schedules |
| `schedules.json` | Photoperiod schedules | schedules |
| `target-ranges.json` | Per-zone env setpoints | env_targets |
| `controller.json`, `controller-bindings.json` | Controller config | devices |
| `device-meta.json` | IoT device inventory | devices |
| `room-map-{roomId}.json` | Per-room tray positions | room_design → planting |
| `harvest-log.json` | Harvest history | planting |
| `wholesale-orders-status.json` | Order tracking | operations |
| `demand-succession-suggestions.json` | AI-derived seeding forecast | operations |
| `system-alerts.json` | Anomalies | operations |
| `env-cache.json`, `env.json` | Sensor readings | operations |
| `tray-formats.json` | Tray definitions | tray_setup |
| `nutrient-profiles.json`, `spd-library.json` | Nutrient + SPD specs | lights / nutrients |

**Database tables:** `farms`, `rooms`, `zones`, `farm_users`, `farm_room_configs`.

**CRITICAL:** `public/data/` (LE) and `greenreach-central/public/data/` (Central) are NOT synced. This causes drift bugs.

---

## PART E — AI AGENTS

### E.V.I.E. (Environmental Vision & Intelligence Engine)
- LLM: **Gemini 2.5 Flash** (Vertex AI).
- Endpoints: `/api/assistant/chat`, `/chat/stream`, `/upload-image`, `/state`.
- 120+ tools across: System & Health (6), Pricing & Market (3), Crop Planning (10), Environment & Sensors (6), Nutrients (2), Inventory & Orders (10), Custom Products (3), Salad Mixes (2), Devices & Equipment (7), Layout (3), Procurement (1), QC & Traceability (3), Sales (2), Reporting (4), Inter-agent (7), Skill (1), Feature Requests (1).
- Trust tiers: `auto` (60+) / `quick_confirm` (40+) / `confirm` (15+) / `admin` (0).
- Memory: hot 30 min, DB 24 h, summarize at ≥20, max 40 messages.

### F.A.Y.E. (Farm Autonomy & Yield Engine)
- No LLM — gateway pattern.
- Endpoints: `/api/admin-ops-agent/{ask,tools,status}`.
- 80+ admin tools: System Health, Accounting, Orders, Market Intel, Network Mgmt, AI/Cost, Delivery, Subscriptions, Engagement Reports.

### G.W.E.N. (Grants, Workplans, Evidence & Navigation)
- LLM: **Gemini 2.5 Pro**.
- Endpoints: `/api/gwen-research/{chat,status,state,workspace}`.
- 140+ tools: Studies, ELN, Documents, Grant Eligibility, Narrative CV, Budget, Compliance, Resubmission, Submission, Workspace Displays, Data Cards, Charts, Equipment, Flow Sims.
- Code execution gated by env vars.

### Setup Agent
- Deterministic phase evaluator (no LLM).
- 12 phases, weighted to 100.
- Endpoints: `/api/setup-agent/{progress,guidance/:phaseId}`.

### Env vars
- `VERTEX_AI_TOKEN`, `VERTEX_AI_PROJECT_ID`, `GOOGLE_APPLICATION_CREDENTIALS`, `K_SERVICE`, `GWEN_EXECUTE_CODE_ENABLED`, `GWEN_EXECUTE_CODE_WINDOW_*`, `GWEN_EXECUTE_CODE_ALLOWED_FARMS`, `FARM_ID`, `FARM_EDGE_URL`, `LIGHT_ENGINE_URL`, `GREENREACH_API_KEY`, `DATABASE_URL`, `USDA_NASS_API_KEY`.
- Removed/deprecated: `OPENAI_API_KEY`, `GRANT_OPENAI_API_KEY`, `ANTHROPIC_API_KEY`.

---

## PART F — KNOWN BUGS / TECH DEBT

### Critical
1. `setup-orchestrator.js` L165 — `escapeHTML/escapeAttr` undefined → XSS risk.
2. `routes/setup.js` L37 — activation codes lost on restart.
3. `routes/setup.js` L130 — missing private key crashes activation.
4. `setup-wizard.js` L293 — silent fallback to rooms.json if DB missing.
5. `LE` and `Central` `public/data/` are not synced.
6. Two `public/` trees (LE root + `greenreach-central/`) need files mirrored manually.

### High
- Tray lifecycle endpoints (seed/transplant/harvest) referenced but not formally exposed.
- Harvest log persistence not atomic — concurrent harvests may corrupt file.
- `recalculateAutoInventoryFromGroups` has had multiple phantom-inventory regressions.

### Medium
- Zones stored in `rooms.configuration` JSONB instead of `zones` table → query inefficiency.
- `_recipesCache` global without invalidation strategy.
- `rooms.json` has multiple field aliases (length_m vs lengthM, envelope vs envelopeClass).
- `groups.json` light field is sometimes IDs, sometimes objects.
- Crop cycle field naming inconsistent (cycle_days vs growthDays).
- ~49 `!important` CSS overrides fighting `styles.foxtrot.css`.
- Calibration wizard mount is a placeholder.

### Low
- Legacy form controls (`#groupsV2RoomSelect/ZoneSelect/ZoneName`) hidden but persisted.
- Plan vs Light comparison cards hidden but persisted.
- Native `<dialog>` backdrop blur fix.

---

## PART G — REBUILD PLAN (PROPOSED, awaiting sign-off)

The current system, while bug-prone, represents 3 years of working production code. A blind rewrite is reckless. The disciplined path:

### Phase 0 — TODAY (low risk, immediate value)
1. Empty-state default: ship the farm with **zero rooms / zero zones / zero groups / zero installedSystems / zero buildPlan**. New farms see "Begin setup" CTA instead of pre-seeded "Main Grow Room" with 30×20 m and stub equipment.
2. Fix the `XSS` risk in `setup-orchestrator.js` (`escapeHTML/escapeAttr` helpers).
3. Add CSS unification: remove `!important` rules in `farm-setup.html` and `grow-management.html` by scoping a single dark-theme stylesheet.
4. Validate post-deploy: `/api/setup-wizard/status` shows `setupCompleted=false` and `roomCount=0` on a fresh farm.

### Phase 1 — Stabilize data layer  ✅ COMPLETE (2026-04-25, LE rev `light-engine-00432-9zv`)
5. Single source of truth — eliminate `public/data/` divergence by reading exclusively from LE and proxying from Central. **DONE** via PR #108 (`greenreach-central/server.js` L465-468 proxies rooms/groups to LE).
6. Atomic writes for `harvest-log.json`, `groups.json` (already has `withGroupsLock`), `rooms.json`. **DONE** — `writeJsonQueued` upgraded to temp-file + rename (server-foxtrot.js L732). All non-atomic call sites converted: harvest-log writes (L12087, L12311), rooms.json writes (L33269, L33366), iot-devices.json zone-cascade write.
7. Schema normalization helper: read any-alias, write canonical (`length_m`, `width_m`, `ceiling_height_m`, `envelope_class`). **DONE** — `normalizeRoomShape()` added (server-foxtrot.js ~L7667) and applied in `/api/setup/save-rooms` after merge. Smoke test verified: input `lengthM/widthM/dimensions.heightM/envelope` produced canonical `length_m/width_m/ceiling_height_m/area_m2/envelope_class` plus camelCase aliases for backwards compat.
8. Migrate zones to a separate `zones` table. **DEFERRED** — DB schema migration too risky for this phase; current zone storage on `room.zones` works with cascade logic in place. Revisit after UI rebuild stabilizes consumer expectations.

### Phase 2 — Rebuild Farm Setup UI  ✅ COMPLETE (2026-04-25, LE rev `light-engine-00433-8b6`, Central rev `greenreach-central-00508-584`)
9. New `/views/farm-setup.html` with a clear linear flow and the same backend. **DONE** in Phase 0/1 (consolidated to: Rooms-zones-lights pointer card → Farm profile pointer → Integrations → IoT Devices → Checklists; legacy onboarding cards already moved to Grow Management + Settings).
10. Remove legacy hidden controls; replace with current-spec components. **AUDITED** — `groupsV2RoomSelect/ZoneSelect/ZoneName` still bound by `groups-v2.js` at 20+ call sites (build-stock-group + bulk-edit dialogs); kept hidden until groups-v2.js is rewritten in Phase 3. `btnLaunchFarm/EditFarm/LaunchRoom/LaunchLightSetup` retained as hidden wiring hosts (documented inline). No safe removals this phase.
11. Empty-state cards with explicit CTAs. **DONE** — `#fsEmptyStateHero` added at top of `public/views/farm-setup.html` (mirrored to Central). Fetches `/api/setup-wizard/status` (with `/data/rooms.json` fallback), shows "Your farm is empty" hero with "Begin setup" → grow-management.html#flow-room and "Open setup wizard" CTAs only when `roomCount === 0`. Verified live on both services.

### Phase 3 — Rebuild Grow Management UI ✅ COMPLETE (2026-04-25, LE rev `light-engine-00434-2vs`, Central rev `greenreach-central-00509-glh`)
12. New `/views/grow-management.html` with 5-step flow + fully-interactive zone drawer. **DONE** (already shipped prior; verified still active: Zone Drawer open/close/save controls and 5-step badges remain live in both public trees).
13. Tray lifecycle: formal `POST /api/trays/seed`, `/transplant`, `/harvest` endpoints. **DONE** — added compatibility endpoints in `server-foxtrot.js` that normalize payload aliases and delegate to canonical handlers (`/api/trays/:trayId/seed`, `/api/tray-runs/:id/move`, `/api/tray-runs/:id/harvest`) so behavior stays single-sourced.
14. Deprecate stale modals; consolidate Build Stock Groups + Bulk Edit. **DONE** — added unified "Group actions" entry point in `grow-management.html` (`#groupsV2ActionsBtn` + `#groupsV2ActionModal`) that launches existing Build Stock / Bulk Edit modals. Legacy modal internals retained for groups-v2.js compatibility while UI now has one consolidated actions surface.

### Phase 4 — Cross-validate
15. Smoke tests: empty farm boot, single-room setup, full setup, bulk operations.
16. Site-wide audit: every page renders, no 404s, every dashboard reflects state.

---

**End of inventory. Awaiting user sign-off on Phase 0 → Phase 4 sequence before destroying any working code.**
