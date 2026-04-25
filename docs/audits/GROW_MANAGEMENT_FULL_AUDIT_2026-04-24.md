# Grow Management — Full Audit (Apr 24, 2026)

Scope: `views/grow-management.html` and its entire dependency graph — persistence, 3D viewer seeding, cross‑page consumers (Crop Scheduler, Activity Hub, Farm Summary, Admin, Wholesale), lighting / environment / SpectraSync, Crop recipes, Controllers / IoT, and E.V.I.E. / G.W.E.N. / F.A.Y.E. integration. Includes a production smoke test and a prioritized gap + improvement list.

**Deployed revisions verified against this audit:**
- LE: `light-engine-00447-fmg` @ `sha256:0c44ed0e7c0079fb6f5d995e78cc9ccaf639c27e7a12bc3d32a20fd3eb5b1957`
- Central: `greenreach-central-00518-g9g` @ `sha256:11df4a86e0ec0309730693cedbd9b6d8996952b0f25e21c0a6178487a637d283`

---

## 1. Summary verdict

| Area | Status |
|------|--------|
| Room dimensions persist + hydrate | PASS |
| Zone count persist + hydrate | PASS |
| Zone **dimensions** persist | **FIXED** (2026-04-25) — `zoneRectsFromRoom()` now reads saved `length_m`/`width_m` per zone; equal-split fallback only for zones without geometry |
| Installed systems + build plan persist | PASS |
| Auto-reconciled groups from installedSystems | PASS (78 groups restored 2026-04-25; 30 was pre-wipe count) |
| 3D viewer seeded from saved data | PARTIAL — room dims OK, zone dims now FIXED, equipment markers missing |
| Cross-page links from Grow Mgmt | FAIL — only Crop Scheduler is linked; Farm Summary, 3D Viewer, Tray Inventory, Light Setup, Environment Setup, Controllers not linked |
| Crop recipe binding | FAIL — reconciled groups have `crop: null`, `plan: null` |
| Lighting / SpectraSync binding | FAIL — no UI on page, no backend tool, no persisted `lights[]` |
| Environment targets (`target-ranges.json`) | FAIL — file is empty (0 entries) in production, yet 3D “Status” overlay + zone-recommendations route depend on it |
| Controllers / IoT device drift | FAIL — LE=5 devices, Central=8 devices, 4 Central-only + 1 LE-only; single source-of-truth violated |
| E.V.I.E. on page | FAIL — 0 references on production HTML |
| G.W.E.N. on page | N/A (research-only; must stay off this page) |
| F.A.Y.E. on page | N/A (admin-only; keep off) |

---

## 2. Production smoke test

Executed against live Cloud Run from `/tmp`.

### HTML pages
```
https://greenreachgreens.com/views/grow-management.html          200 160927B
https://greenreach-central-.../views/grow-management.html        200 160927B
https://light-engine-.../views/grow-management.html              200 160811B
LE /views/3d-farm-viewer.html                                    200
CEN /views/3d-farm-viewer.html                                   200
```
LE and Central serve byte-identical Central copy except for ~116B of injected LE wrappers. Static mirroring is holding.

### Canonical data
```
LE  /data/rooms.json           200 1386 B
LE  /data/groups.json          200 21864 B
LE  /data/iot-devices.json     200 7090  B
LE  /data/target-ranges.json   200 1426  B (SHAPE: empty entries)
LE  /data/crop-registry.json   200 27273 B
LE  /data/grow-systems.json    200 25367 B

CEN /data/rooms.json           200 1386 B    (== LE)
CEN /data/groups.json          200 21864 B   (== LE)
CEN /data/iot-devices.json     200 7254 B    (DRIFT vs LE)
CEN /data/target-ranges.json   200 1426 B    (== LE but still empty)
```

### APIs (LE)
```
/api/setup-wizard/status    401   (auth-gated, expected)
/api/grow-systems           200 17720B
/api/rooms                  200 1376B
/api/groups                 200 10363B
/api/zone-recommendations   200 1727B
```

### Data-shape parity (production)
- `rooms.json[0]` has all dim aliases populated:
  `length_m / width_m / ceiling_height_m`, `lengthM / widthM / ceilingHeightM`, plus `dimensions.{…}`. `normalizeRoomShape()` is working end-to-end.
- `rooms.json[0].installedSystems[0]` persists full template + customization (levels, spacing, locationsX/Y, layoutMode).
- `rooms.json[0].buildPlan` persists `{ status, generatedAt, computedLoad, acceptedEquipment, reservedControllerSlots }`.
- `rooms.json[0].zones` = 2 zone objects. As of 2026-04-25 each zone includes full geometry fields (`id`, `name`, `x_m`, `y_m`, `length_m`, `width_m`, `area_m2`) once saved via the zone drawer.
- `groups.json` = 78 reconciled groups (ZipGrow Standard baseline, restored 2026-04-25). All in `Room 1`, distributed across `Zone 1` and `Zone 2`. All carry `room + roomId + zone`.
- All 30 groups have `crop: null`, `plan: null`, no `lights[]`, no `controller_id`, no `trays`, no `plants`.
- `target-ranges.json` has **zero entries** in production — the 3D viewer “Status” overlay, `/api/zone-recommendations`, and EVIE `get_environment_snapshot` all fall through their empty-range branches.

### Live page scan (Central HTML)
- `evie-presence | evie-core | evie-orb | askEVIE | "ask evie"` → **0 matches**. E.V.I.E. is not loaded on this page.
- `spectra*|lighting-recipes|light-setup|environment-setup|controllers.html` → **0 matches**.
- `3d-farm-viewer|farm-summary|planting-scheduler|tray-inventory` → **0 matches**.
- The only outbound link from this page is `/LE-farm-admin.html#growing/crop-scheduler`.

---

## 3. Input → persistence map (verified)

Source: [greenreach-central/public/views/grow-management.html](greenreach-central/public/views/grow-management.html), [greenreach-central/public/views/grow-management-room-build-plan.js](greenreach-central/public/views/grow-management-room-build-plan.js), [greenreach-central/public/groups-v2.js](greenreach-central/public/groups-v2.js), with LE mirrors under `public/`.

| Step | Control | In-memory | Persist call | Target |
|------|---------|-----------|--------------|--------|
| Room | `#roomName`, `#lengthM`, `#widthM`, `#heightM` | `STATE.rooms[]` | `POST /api/setup/save-rooms` (debounced 500ms via `_saveRoomsTimer`) | LE `public/data/rooms.json` (atomic tmp+rename, GCS mirrored) |
| Zones (count) | `#ffZonesCountInput`, apply button | `rooms[].zones = [{id,name}]` | `POST /api/setup/save-rooms` | same |
| Zones (drawer) | canvas drag → rect geometry | local rect state | **FIXED (2026-04-25)** — `zoneRectsFromRoom()` now uses saved `length_m`/`width_m`/`x_m`/`y_m` from each zone object | LE rooms.json |
| Units per room | Template Gallery → Room Build Plan sliders (`#rbpLevels`, `#rbpSpacingIn`, `#rbpLocationsX/Y`, `#rbpUnitCount`, `#rbpAutoFit`) | `__roomBuildPlan` + `state.customization` | `POST /api/setup/save-rooms` with `rooms[].installedSystems[]` + `rooms[].buildPlan` | LE rooms.json |
| Groups reconcile | derived from `installedSystems` server-side | — | `reconcileGroupsFromRooms()` in [server-foxtrot.js](server-foxtrot.js) runs inside `withGroupsLock()` | LE `public/data/groups.json`; emits SSE `data-changed{kind:'groups'}` |
| Build Stock Groups | `#bsgQuantity`, `#bsgStdLight`, `#bsgStdController`, `#bsgPrefillLighting` | `STATE.groups[]` | Directly mutates `STATE.groups` then `POST /data/groups.json` | LE groups.json |
| Summary source label | — | `__roomBuildPlan` live vs `rooms[].buildPlan` saved | none (render-only) | Summary card |
| Controllers step | read-only list | `iot-devices.json`, `/api/controllers` | none | — |

Confirmed server-side:
- LE `/api/setup/save-rooms` merges + normalizes rooms (all dim aliases), runs `reconcileGroupsFromRooms()` under `withGroupsLock()`, preserves existing group crop/plan/schedule/status/lights/grid for matching ids, passes through groups for rooms not in payload, mirrors to GCS via `__mirrorJsonToGCS`, emits `data-changed{kind:'rooms'|'groups'}`.
- Central has a proxy `POST /api/setup/save-rooms → LE` (no `authMiddleware`) to support Central-served pages.
- `syncZonesToRoomsJson()` will **not** overwrite canonical rooms unless called authoritatively. Fix verified in code and in production parity.

---

## 4. 3D viewer contract

Viewer files: [greenreach-central/public/views/3d-farm-viewer.html](greenreach-central/public/views/3d-farm-viewer.html), [public/js/3d-farm-viewer-v2.js](public/js/3d-farm-viewer-v2.js).

| Field 3D needs | Source | Status |
|----------------|--------|--------|
| Room L / W / H (m) | `rooms.json` (any alias) | OK |
| Zones as shape + pose | `rooms[].zones[].length_m/width_m/x/y` | **MISSING** — only id/name are saved |
| Group placement | `groups.json → group.room/roomId + group.zone` | OK for room membership; no (x,y) coords saved → fallback grid |
| Cell footprint (`cellW/cellD`) | `group.customization.cellW / cellD` | **MISSING** — Room Build Plan computes it, does not persist it on the group |
| Fixture markers | `groups[].lights[] + iot-devices.json` | GROUPS HAVE NO LIGHTS; IoT file drifts |
| Zone status coloring | `target-ranges.json + env-cache.json` | BROKEN — target-ranges empty |
| InstalledSystem footprint overlay | `rooms[].installedSystems[].customization.locationsX/Y × spacingIn` | not currently rendered in viewer |

---

## 5. Cross-page link audit

What the grow-management HTML **actually** links to, per production fetch:
- `/LE-farm-admin.html#growing/crop-scheduler` (Crop Scheduler).

Everything else is a consumer that reads the same canonical JSON but has no inbound link from Grow Mgmt:

| Consumer | Reads | Inbound link from Grow Mgmt? |
|----------|-------|------------------------------|
| 3D Viewer (`/views/3d-farm-viewer.html`) | rooms, groups, iot-devices, target-ranges, env | NO |
| Farm Summary (`/views/farm-summary.html`) | rooms, groups, env | NO |
| Activity Hub (`/views/tray-inventory.html`) | groups | NO |
| Planting / Crop Scheduler | rooms.zones, groups.planConfig | YES (only one) |
| LE-farm-admin (groups tab) | groups | NO |
| GR-central-admin (farms/rooms) | rooms, groups via `/api/farms/:farmId/*` | NO |
| Wholesale Admin | groups for allocation | NO |
| EVIE (`farm-ops-agent.js`) | rooms, groups, zones, devices, target-ranges | NO |
| GWEN (`gwen-research-agent.js`) | research tables only | N/A |
| FAYE (`admin-ops-agent.js`) | multi-farm rollups | N/A |

---

## 6. Lighting / Environment / SpectraSync

Current state:
- Grow Mgmt has no UI that writes lighting recipes or SpectraSync schedules.
- `groups-v2.js` legacy fields (`#groupsV2TargetTemp/Humidity/Gradient*`) exist but are not surfaced on the modern page.
- `target-ranges.json` is empty in production → environment intelligence is dark: zone status coloring, `/api/zone-recommendations`, EVIE `get_environment_snapshot`, and F.A.Y.E. environment roll-ups all have no thresholds to evaluate against.
- There is no `apply_light_recipe`, `get_spectra_sync_status`, `set_light_schedule`, or `update_zone_targets_bulk` in [greenreach-central/routes/farm-ops-agent.js](greenreach-central/routes/farm-ops-agent.js).

---

## 7. Crop recipes + IoT

- `crop-registry.json` and `recipes-v2/` are served and cached by `groups-v2.js` (`_cropRegistryCache`) but Grow Mgmt does not assign crops to auto-reconciled groups. All 30 production groups have `crop: null`, `plan: null`.
- IoT devices drift between LE and Central. Grow Mgmt’s Build Stock Groups controller picker can show different device lists depending on whether the user hit LE or Central, which can lead to dangling `controller_id` references after deploy.
- Recipe → group assignment happens only in Crop Scheduler, which is reached only by one hyperlink. That flow is functional but invisible from Grow Mgmt’s Step 3/4 context.

---

## 8. E.V.I.E. / G.W.E.N. / F.A.Y.E.

- **E.V.I.E.** — zero references in production `grow-management.html`. 65+ tools exist in [greenreach-central/routes/farm-ops-agent.js](greenreach-central/routes/farm-ops-agent.js) (get/update rooms, zones, groups, devices, target ranges, equipment, optimize_layout, bulk updates, alerts). None are reachable from Grow Mgmt, and none receive page-state context (selected room, unsaved plan, current zone).
- **G.W.E.N.** — research-only at [greenreach-central/public/gwen-core.html](greenreach-central/public/gwen-core.html) and [greenreach-central/routes/gwen-research-agent.js](greenreach-central/routes/gwen-research-agent.js). Correctly absent from Grow Mgmt; keep it off.
- **F.A.Y.E.** — admin/multi-farm only. Correctly absent from Grow Mgmt; keep it off.

---

## 9. Prioritized gaps

### P0 — data correctness / loss
1. **~~Zone dimensions are silently dropped on save.~~** **FIXED (2026-04-25)**: `zoneRectsFromRoom()` now reads persisted `length_m`/`width_m`/`x_m`/`y_m` from `room.zones[]` objects; equal-split is fallback only for zones without saved geometry.
2. **`target-ranges.json` is empty in production.** All downstream environment intelligence is inert. Either seed sensible defaults from the active templates + crop registry on first-room-save, or surface an on-page banner directing the user to Environment Setup.
3. **IoT device drift LE vs Central** (7090 vs 7254 B, different device sets). Central must fetch IoT from LE on read, not host its own copy. Today’s mirror is a stale duplicate.

### P1 — integration gaps (user-visible)
4. **No crop assignment on auto-reconciled groups.** Provide either (a) a bulk “assign crop + plan” action from Step 3, or (b) a one-click hop to Crop Scheduler filtered to the reconciled groups.
5. **No E.V.I.E. on page.** Add a contextual E.V.I.E. orb that ships page context to the chat (`farm_id`, `room_id`, `selected_group_id`, `zones[]`, `page='grow-management'`).
6. **No lighting / SpectraSync path.** Build Stock Groups accepts a controller + light, but production groups have `lights:[]` and no controller_id. Either finish that wiring or remove the placeholder UI.
7. **Cross-page links missing.** Step 4 summary should link to 3D Viewer, Farm Summary, Activity Hub, Environment Setup, Light Setup, Controllers.

### P2 — UX / observability
8. **Summary source label** (Live preview vs Saved snapshot) is correct but subtle; add timestamp + last-editor from `buildPlan.generatedAt`.
9. **Zone save-status auto-correction** works but has a 4.5s TTL — extend to 10s and log the correction so audits can confirm it fired.
10. **`/api/setup-wizard/status` 401** when unauthenticated — fine, but Grow Mgmt should hydrate via it too and surface a friendly “sign in to save” banner instead of silent failures on first load.

---

## 10. Proposed improvements (scoped, non-speculative)

### A. Persist zone geometry (P0, LE)
- Grow Mgmt: when the drawer emits a rect, store `length_m, width_m, x_m, y_m, height_m` on `rooms[].zones[]`. [grow-management.html: drawer save handler, persistRooms serializer].
- LE `normalizeRoomShape`: pass zone dims through; write aliased `length_m/lengthM/width_m/widthM`.
- 3D viewer: drop localStorage `farm3d_roomDims` fallback for zones; read persisted dims directly.

### B. Seed and maintain `target-ranges.json` (P0, LE)
- On first successful `POST /api/setup/save-rooms` when target-ranges are empty, seed one range per zone from the active template + crop defaults.
- Add a Grow Mgmt step-4 banner: “N of M zones have no environment targets — open Environment Setup”.

### C. Single-source IoT (P0, LE + Central)
- Central must stop serving `/data/iot-devices.json` from its own bundle; proxy to LE (same pattern used for wholesale events).
- Add a deploy check: on Central boot, fetch LE iot-devices.json and delete any local copy.

### D. Crop-assignment affordance on Step 3 (P1, Central)
- Add bulk-action “Assign crop + plan to N groups in Room X” modal that writes `crop, plan, planId, schedule.seed_date` onto each group. This is a compound UI; backend already accepts these fields.
- Alternative, same deploy: button “Open Crop Scheduler filtered to these groups”.

### E. E.V.I.E. on page (P1, Central + LE)
UI hooks on `grow-management.html`:
- Floating orb loaded from `/evie-presence.js` (existing). Same positions as the rest of the farm UI (orb 20px, help 100px, voice 160px).
- Context object pushed into chat open call:
  ```
  {
    farm_id, page: 'grow-management',
    room_id: STATE.currentRoom?.id,
    group_id: STATE.selectedGroup?.id,
    zones: (STATE.currentRoom?.zones || []).map(z => z.id),
    unsaved: STATE.__dirty === true
  }
  ```
- System prompt additions in [greenreach-central/routes/assistant-chat.js](greenreach-central/routes/assistant-chat.js): accept `page`, `room_id`, `group_id`, `zones[]` from request; pre-fill tool args so the user never has to type them.

New tools to add to [greenreach-central/routes/farm-ops-agent.js](greenreach-central/routes/farm-ops-agent.js) (all `quick_confirm` unless noted):
- `apply_light_recipe` — inputs: `group_id | match_name`, `recipe_name`; writes `groups[].recipe`, `groups[].lights[].spectrum`.
- `update_zone_targets_bulk` — inputs: `match_zone_name | apply_to_all`, temp/rh min/max; writes `target-ranges.json`.
- `create_planting_plan` (trust tier `confirm`) — inputs: `plan_name`, `groups:[{group_id,crop,seed_date}]`; writes `planting_assignments` + group fields.
- `get_spectra_sync_status` (read) — passthrough to LE `/api/spectra-sync` (stub today; return empty `{enabled:false, reason:'not configured'}` if route absent).

### F. Cross-page links on Step 4 summary (P1, Central)
Static hrefs, no logic:
- 3D Viewer → `/views/3d-farm-viewer.html?room={roomId}`
- Farm Summary → `/views/farm-summary.html`
- Activity Hub → `/views/tray-inventory.html?room={roomId}`
- Environment Setup → `/views/environment-setup.html`
- Light Setup → `/views/light-setup.html`
- Controllers → `/views/controllers.html`

### G. Observability (P2, LE)
- Add `data-changed{kind:'target-ranges'}` SSE when target-ranges.json is written, so Grow Mgmt and 3D Viewer can refresh without full reload.

---

## 11. Test plan

1. **Unit / server**
   - Extend `reconcileGroupsFromRooms()` test fixture to assert: zone dims preserved, lights[] preserved, crop/plan preserved when already set, new auto-reconciled groups default to `crop:null, lights:[]`.
   - Add a regression test that `persistRooms()` payload retains `zones[].length_m`.
2. **API smoke (this document, Section 2) — run before every Grow-Mgmt deploy.**
3. **Playwright flow** (add `tests/playwright/grow-management.spec.js`, install browsers once via `npx playwright install chromium`):
   - Load `/views/grow-management.html` against Central URL.
   - Assert breadcrumb + Step 1 render.
   - Change `#lengthM`, `#widthM`, `#heightM`, wait 1s, reload page, assert values persisted.
   - Open zone drawer, carve 2 zones, save, reload, assert zone count and dims persisted.
   - Select template in Step 3, set `#rbpUnitCount=4`, click `#rbpSavePlanBtn`, assert `rooms[].installedSystems[0].quantity===4` via API.
   - Assert `/api/groups` returns exactly `installedSystems[0].quantity` groups after save.
   - Call `/api/setup/save-rooms` with the same body twice, assert no duplicate groups (idempotency).

---

## 12. Known constraints / non-goals

- Do **not** put G.W.E.N. or F.A.Y.E. on this page. G.W.E.N. belongs on research, F.A.Y.E. on admin.
- Do **not** split Central into a separate rooms/groups writer — LE remains authoritative (previous 5-minute revert bug confirmed Central-only reconciler is wrong).
- Do **not** re-introduce EB references.
- Do **not** add cross-origin redirects between LE and Central.
