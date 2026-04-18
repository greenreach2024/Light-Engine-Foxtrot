# Farm Setup Workflow — Review & Proposal

**Repo:** `greenreach2024/Light-Engine-Foxtrot`
**Scope:** Review the current farm setup workflow, reconcile the "top-down"
model with the new template + agent-driven "build the farm" approach, and
recommend where light / IoT / controller assignments should live.
**Mode:** Analysis only — no code changes in this pass.

---

## 1. What the repo actually has today

There are **three** farm-setup surfaces running in parallel, each with a
slightly different mental model. That's the root of the ordering question.

### 1a. Linear Setup Wizard (top-down, first-run)

Files: `routes/setup-wizard.js`, `public/setup-wizard.html`,
`docs/onboarding/FIRST_RUN_GUIDE.md`,
`docs/features/SETUP_WIZARD_RECOMMENDATION.md`.

Order: `password → farm profile → certifications → desktop app → cloud
features → Activity Hub QR`. Rooms / zones / equipment are **not** in the
wizard; users are dropped into the dashboard to fill them in by hand.

APIs (`POST /api/setup/rooms`, `POST /api/setup/zones`) enforce the classic
top-down contract: a zone row can't exist without a `room_id`.

### 1b. Farm Setup dashboard (domain-oriented, post-wizard)

File: `public/views/farm-setup.html`.

Card order (not step order): **Farm Registration → Grow Rooms → Light
Fixtures → IoT Devices → Integrations**. The Grow Rooms modal walks a user
through: `room-info → hardware category chips (hvac / mini-split / dehumidifier /
fans / vents / controllers / energy monitor) → per-category setup → review`.
Light Fixtures is a separate modal ("Light Setup Wizard"), IoT Devices is
another modal. Each room persists a `category.{hvac|fans|dehumidifier|…}`
block in `public/data/rooms.json` with counts, manufacturer, wired/wifi,
selectedEquipment.

### 1c. EVIE Setup Agent (agent-driven, central)

File: `greenreach-central/routes/setup-agent.js`. This is the closest thing to
your "build the farm" workflow. It exposes **12 phases**, each with a
completion check and an EVIE prompt that deep-links into the right UI panel:

```
1. farm_profile     7. env_targets (auto from recipes)
2. grow_rooms       8. lights
3. room_specs  ←    9. schedules
4. zones           10. devices
5. groups          11. planting
6. crop_assignment 12. integrations
```

Notable:

- `room_specs` is already a **separate** phase from `grow_rooms`, checking
  `dimensions`, `ceiling_height_m`, `hydro_system` — the scaffolding for a
  "size + grow-system template" step already exists.
- `env_targets` is explicitly agent-derived from recipes via
  `RecipeEnvironmentalTargets` (per-zone weighted VPD / temp / maxRH from
  assigned crops). So the env-target step has already been eliminated as a
  manual step — see `docs/features/RECIPE_BASED_ENVIRONMENTAL_CONTROL.md`.
- `lights` and `devices` are evaluated by walking
  `groups[].lights[]` and `farm_profile.devices[]`. Assignments happen at
  the **group** level for lights and at the **farm/device registry** level
  for IoT devices; neither is first-class on rooms.

### 1d. What exists for load math (but isn't wired into setup)

`docs/features/VERTICAL_FARM_CALCULATOR_SPEC.md` encodes the exact
calculations you described — PPFD → kWh, transpiration g/day → BTU/hour →
cooling tons, pump W per 10k plants, reservoir gallons. It currently lives
inside the **Grant Wizard** (`greenreach-central/routes/grant-wizard.js`),
not the setup flow. These formulas are the natural engine for a
"build the farm" step.

### 1e. What's missing / loosely modelled

- **No `grow-systems.json` registry.** `rooms.json` has a `layout.type/rows/
  racks/levels` placeholder, but there is no catalog of grow-system templates
  (NFT rack, DWC pond, vertical tier rack, microgreen shelf, flood table…)
  with light / controller / pump / transpiration defaults.
- **Controller assignments are scattered.** Lights get a `dmx.universe/
  channels` block in `iot-devices.json`. HVAC/dehum/fan picks live in the
  room `category.*` block. SwitchBot/Kasa/Code3 hubs live in their own
  ecosystem cards. There is no single "controllers & bindings" surface.
- **The template ↔ real-hardware binding step is implicit.** A template
  could declare "needs 2 × 100 W bar lights per tier on a 4-channel DMX
  controller", but nothing in the data model reserves those slots so a
  discovered fixture can slot into them later.

---

## 2. What order to use

The short answer: keep top-down as the **persistence contract** (you still
need Farm → Room → Zone → Group → Tray foreign keys), but split the
**UX into two phases** — a design phase that is load-driven and
agent-assisted, and a provision phase that is bottom-up and scan-driven.

### Phase A — Design (top-down, agent-assisted)

The minimum information the agent needs to size everything is **room
size + grow system template(s) + intended crop class**. Capture those
first, let the agent propose equipment counts, then persist the decisions
as a **room build plan** (a reservation / bill of materials).

```
1. Farm identity            (unchanged)
2. Room shell               name, L×W×H, envelope class
                            (sealed / mini-split / central HVAC / vented)
3. Grow Systems             pick 1..N templates from grow-systems.json
                            set quantity + position per template
4. Crop class               target recipe family (leafy / herbs / microgreens
                            / fruiting) — not a specific cultivar yet
5. Agent Build              compute: lighting kW, transpiration kg/day,
                            cooling tons, dehum L/day, fan CFM, water gal/day,
                            circuit load, controller channels required.
                            Present a proposed equipment list (HVAC class,
                            dehum PPD, fans/CFM, light fixtures, sensor
                            count, controller hierarchy). User edits counts
                            → accepted list becomes the room build plan.
```

### Phase B — Provision (bottom-up, scan-driven)

Now bind real hardware into the slots Phase A reserved.

```
6. Device discovery         run the existing multi-protocol scanner
                            (BLE, mDNS, SSDP, Kasa UDP, SwitchBot Cloud,
                            Code3) → discovered devices are matched to
                            reserved slots by category + channel count.
                            Unmatched devices become ad-hoc additions.
7. Zones                    auto-suggested from the template geometry
                            (per rack row / per tier / per bench), or
                            manually drawn. Zone sensors attach here.
8. Groups                   created inside zones. Lights and per-group
                            controllers finalize their binding here.
                            Recipe gets assigned → zone env targets go
                            live via recipe-derived targeting.
9. Trays                    print / scan QRs, seed, place. tray_runs
                            drive live automation.
```

### Why this order

- **Phase A breaks the chicken-and-egg problem.** You can't pick
  specific controllers before you know how many light/fan/valve channels
  you need; you can't know channels before you know template × quantity ×
  room size. Template + quantity + room size is the smallest input set that
  unlocks everything.
- **Phase B keeps identity discovery late.** Users should never type MAC
  addresses or DMX universes into a wizard; discovery does it for them
  and slots the result into the reservation.
- **The top-down FK chain is preserved** — Room rows still exist before
  Zone rows, groups still live under zones. You are only changing
  *when the equipment decisions happen relative to the hierarchy*, not the
  hierarchy itself.
- **Recipe-driven env targets already exist.** Phase A doesn't ask the user
  to set temp / RH / VPD numbers — those come from
  `RecipeEnvironmentalTargets` once a crop is assigned in Phase B (step 8).

---

## 3. Where each kind of assignment should live

| Concern | Data home | Why |
|---|---|---|
| Footprint, tier count, trays/tier, irrigation type (NFT/DWC/aero/flood), pump sizing curve, transpiration g/plant/day, default fixture **class** (PPFD/DLI), default controller **class** (DMX-4 / 0-10V / Modbus / smart-plug), required channel counts | **`public/data/grow-systems.json` (new registry)** | These are design-time invariants of the physical growing apparatus. They drive load math. They do **not** hold device identities. |
| Dimensions, ceiling, envelope class, installed `systems[]` (templateId × quantity × position), **room build plan** (computed load + accepted equipment list + reserved controller slots), room-level controller (edge PLC / mesh hub / gateway), electrical panel | **`rooms.json` (extend schema)** | Everything that depends on the *room as a whole* — HVAC sizing, dehum sizing, supply fans, panel load, edge/gateway controllers — belongs here, not on the template. |
| Climate envelope boundary, zone sensor(s), zone-level overrides (sub-controller, extra fans), recipe-derived env targets | **zones** (already in `groups.zone` / `rooms.zones[]` / `target_ranges.zones`) | Zones are the finest-grained climate control boundary. This is already where recipe targets resolve. |
| Light fixture binding, light schedule, crop + recipe assignment, group-level controller channel map | **groups** (`groups.json` + `groups-v2`) | Group is where "which crop, which recipe, which fixtures, which channels" converges. The setup agent already reads `g.lights` for the `lights` phase — keep it here. |
| Tray format, seed date, QR, planted site count, tray placement | **tray_runs + tray_placements** (already defined in `RECIPE_BASED_ENVIRONMENTAL_CONTROL.md`) | Unchanged. |
| Physical device IDs (MAC / DMX universe + chan / Kasa device / SwitchBot deviceId / Modbus address), protocol, firmware | **`iot-devices.json`** with `scope: { room_id, zone_id?, group_id? }` and `reservationId` linking back to the room build plan | Hardware identity is a provisioning concern, not a template concern. The `reservationId` is how a discovered light ends up filling the 4th of 4 "reserved fixtures" on rack 2, tier 3. |
| Controller → device bindings (which light/fan/pump/valve this controller drives, on which channel) | **`controller-bindings.json` (new)** or a `controllers` section in `iot-devices.json`, scoped by `room_id / zone_id / group_id` | There is no single surface for this today. A single bindings document is much easier to reason about than re-deriving it from three files. |

**Rule of thumb for the template vs room vs zone vs group question:**

> Templates declare *classes and required channel counts*. Rooms
> declare *quantities and physical envelope*. Zones declare *climate
> boundaries*. Groups declare *crop + recipe + channel bindings*. Device
> records declare *identities and protocols*. Bindings glue identities to
> the channels the group / zone / room expects.

Said another way: **the template is a recipe for equipment; the room is
the oven; the zone is a shelf; the group is the pan; the device is a
specific heating element you bought.** Don't bake the serial number into
the recipe.

---

## 4. Concrete next steps (if you want to move on this)

Ordered smallest → largest impact:

1. **Add `public/data/grow-systems.json`** with 4-6 seed templates
   (NFT rack 3-tier, DWC pond, microgreen shelf, flood table, vertical
   propagation rack, single bench). Fields per §3.
2. **Extend the `rooms.json` room schema** with `dimensions`,
   `ceiling_height_m`, `envelope`, `installedSystems[]`, `buildPlan`.
   Keep the existing `category.*` block — `buildPlan` will eventually
   supersede it, but both can coexist during migration.
3. **Promote `/api/setup/rooms`** (`routes/setup-wizard.js`) to accept
   the new fields, and add `/api/setup/room-build-plan` that runs the
   load math from `VERTICAL_FARM_CALCULATOR_SPEC.md` and returns a
   proposed equipment list.
4. **Merge `grow_rooms` + `room_specs` phases** in
   `greenreach-central/routes/setup-agent.js` into one **"Room + Template
   + Load"** phase, and add a **"Build Plan"** phase before `lights` and
   `devices`. Keep the other phases as-is.
5. **Introduce `controller-bindings.json`** and a small "Controllers &
   Bindings" view that pulls together DMX channels, Kasa plugs, SwitchBot
   meters, Code3 channels, Modbus registers. Feed `iot-devices.json`'s
   discovery output into it.
6. **Auto-assign discovered lights to zones** — this is the `T19` gap
   already flagged in `docs/ai-agents/FARM_OPS_AGENT_BUILD_PLAN_2026-03-08.md`.
   The build plan gives auto-assign a target: each discovered fixture
   slots into the next open reservation matching its class.

Items 1–3 are the smallest viable change that gets the agent from "I need
room/zone structure before I can help" to "give me a room and a template
and I'll propose the equipment." Items 4–6 make it end-to-end.

---

## 5. Summary

- The top-down hierarchy is still correct as a **data model** — don't
  break the FK chain.
- The **UX** should flip mid-stream: Phase A (Farm → Room → Grow-system
  template → Crop class → Agent build) is design/top-down-plus-math;
  Phase B (Discover → Zone → Group → Tray) is provision/bottom-up.
- **Grow-system templates** should declare *classes and required
  channels* for lights, irrigation, and controllers — not device IDs.
- **Room** is the right home for HVAC/dehum/fan sizing, the build plan,
  and room-level controllers/gateways.
- **Zone** owns climate boundary + zone sensors + recipe-derived targets.
- **Group** owns the crop + recipe + final light/channel binding.
- **Device IDs and controller bindings** are provisioning artifacts —
  keep them in `iot-devices.json` + a new `controller-bindings.json`,
  and link back to room build-plan reservations.
